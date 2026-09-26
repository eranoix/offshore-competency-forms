/**
 * Renders the filled .docx with an engine that reads Word, so the page matches
 * Word's own layout (a JavaScript reader only approximates it). The engine key
 * stays server-side.
 */
import { requireSession } from "./_supabase.js";
import { ask, engineReady } from "./_engine.js";
import { bytesOf, draftOf, extOf, holdDraft, isSheet, keep, live, manifest, typeOf, versions } from "./_templates.js";
import { editorSays, signedForEditor, ticketFor, ticketSays } from "./_ticket.js";

export const config = { api: { bodyParser: false } };

const LIMIT = 8 * 1024 * 1024;

/**
 * The document server handing a form back. It autosaves on its own schedule,
 * so the bytes are kept as a draft only; publishing stays a guarded step.
 * Statuses 2 and 6 carry a saved file; the rest only need an acknowledgement.
 */
async function saved(req, kind) {
  const body = JSON.parse((await raw(req, LIMIT))?.toString() || "{}");
  /* Signed by the document server with the key only it and this have. Without
     checking it, anyone who learns the address of this route replaces a form. */
  const token = body.token || String(req.headers.authorization || "").replace(/^Bearer /, "");
  const said = editorSays(token);
  if (!said) return { error: 1, message: "that was not signed by the document server" };
  const payload = said.payload || said;
  const status = Number(payload.status ?? body.status);
  if (status !== 2 && status !== 6) return { error: 0 };
  const from = payload.url || body.url;
  if (!from) return { error: 1, message: "it said it had saved but sent nowhere to fetch it" };
  const got = await fetch(from);
  if (!got.ok) return { error: 1, message: `the saved file could not be fetched (${got.status})` };
  const bytes = Buffer.from(await got.arrayBuffer());
  if (bytes.length < 5 || bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    return { error: 1, message: `what came back is not a ${isSheet(kind) ? "workbook" : "Word document"}` };
  await holdDraft(kind, bytes);
  return { error: 0 };
}

async function raw(req, limit) {
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) return null;
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

export default async function handler(req, res) {
  /* The document server's own calls carry no session, only an edge-checked
     ticket for one form and one job, so they are answered before the session
     check, which would refuse them. */
  const asked = String(req.query?.t || "");
  if (asked === "doc" || asked === "saved") {
    const said = ticketSays(req.query?.tk);
    if (!said || said.job !== asked) return res.status(401).json({ error: "no ticket" });
    try {
      if (asked === "doc") {
        const got = await bytesOf(said.kind);
        if (!got) return res.status(404).json({ error: "no such form" });
        res.setHeader("content-type", typeOf(said.kind));
        res.setHeader("cache-control", "no-store");
        return res.status(200).send(got.bytes);
      }
      return res.status(200).json(await saved(req, said.kind));
    } catch (e) {
      /* The document server reads this answer and shows the person a message.
         It only understands its own shape, so even a failure speaks it. */
      return res.status(200).json({ error: 1, message: String(e.message).slice(0, 120) });
    }
  }

  const who = requireSession(req, res);
  if (!who) return;

  /* The forms share this handler because the plan's twelve functions are all
     used. Everything about them is behind `t`; without it this is a render. */
  const t = String(req.query?.t || "");
  if (t) {
    try {
      if (req.method === "GET" && t === "manifest") return res.status(200).json({ forms: await manifest() });
      if (req.method === "GET" && t === "versions")
        return res.status(200).json({ versions: await versions(req.query.kind) });
      if (req.method === "GET" && t === "bytes") {
        const got = await bytesOf(req.query.kind, req.query.v);
        if (!got) return res.status(404).json({ error: "no such form" });
        res.setHeader("content-type", typeOf(req.query.kind));
        /* The bytes are the same for everyone and change only when a version
           does, and the name carries what they are. */
        res.setHeader("cache-control", "private, max-age=3600");
        res.setHeader("etag", `"${got.sha256}"`);
        return res.status(200).send(got.bytes);
      }
      /* Where the lines and boxes land on an unpublished form, for a preview.
         The labels come off the form being asked about, not a list in code. */
      if (req.method === "POST" && t === "map") {
        if (!engineReady()) return res.status(500).json({ error: "the server cannot draw documents yet" });
        const bytes = await raw(req, LIMIT);
        if (bytes === null) return res.status(413).json({ error: "that document is too big" });
        if (!bytes?.length) return res.status(400).json({ error: "no document" });
        const out = await ask(bytes, {
          where: "map",
          headers: { "x-labels": String(req.headers["x-labels"] || "[]") },
          timeout: 120_000,
        });
        if (out.status !== 200) {
          const mine = out.status >= 400 && out.status < 500;
          return res.status(mine ? 400 : 502).json({
            error: mine ? "that form could not be read" : `could not be mapped (${out.status})`,
          });
        }
        res.setHeader("content-type", "application/json");
        return res.status(200).send(out.body);
      }
      if (req.method === "POST" && t === "publish") {
        const bytes = await raw(req, LIMIT);
        if (bytes === null) return res.status(413).json({ error: "that document is too big" });
        let extra = {};
        try {
          extra = JSON.parse(String(req.headers["x-form"] || "{}"));
        } catch {
          return res.status(400).json({ error: "the form details are not readable" });
        }
        const row = await keep(who, req.query.kind, bytes, extra);
        return res.status(200).json({ version: row.version, id: row.id });
      }
      if (req.method === "PATCH" && t === "live")
        return res.status(200).json(await live(who, req.query.kind, req.query.v));

      /* Editor config for the document server, signed: without a signature it
         opens and saves whatever anybody asks, and its address is public. */
      if (req.method === "GET" && t === "editor") {
        const kind = String(req.query.kind || "");
        const at = String(process.env.ONLYOFFICE_URL || "");
        if (!at) return res.status(503).json({ error: "no document server is set up" });
        const got = await manifest();
        const now = got?.[kind];
        if (!now) return res.status(404).json({ error: "no such form" });
        const site = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
        /* The editor type is read from the kind, never assumed: the document
           server opens an .xlsx given "word" as a corrupt file. It maps `cell`
           to xlsx and refuses types outside word/cell/slide/pdf/diagram. */
        const config = {
          document: {
            fileType: extOf(kind),
            /* The key is what the document server caches a session under. It
               carries the version, so publishing a new one is a new document
               rather than the old one served out of its cache. */
            key: `${kind}-${now.version}-${String(now.sha256 || "").slice(0, 12)}`,
            title: `${kind}.${extOf(kind)}`,
            url: `${site}/api/render?t=doc&tk=${encodeURIComponent(ticketFor(kind, "doc", who.email))}`,
            permissions: { edit: true, download: true, print: true },
          },
          documentType: isSheet(kind) ? "cell" : "word",
          editorConfig: {
            mode: "edit",
            lang: "en",
            callbackUrl: `${site}/api/render?t=saved&tk=${encodeURIComponent(ticketFor(kind, "saved", who.email))}`,
            user: { id: String(who.sub || who.email), name: String(who.email || "you") },
            customization: {
              autosave: true,
              forcesave: true,
              compactHeader: false,
              help: false,
              /* Disable the editor's first-visit tour. */
              features: { featuresTips: false },
              featuresTips: false,
              hideNotes: true,
              uiTheme: "theme-dark",
            },
          },
        };
        /* Checks the site's own leg to the document server. The browser's leg
           can fail separately (e.g. TLS-inspecting networks), so this tells
           "down on our side" from "blocked on yours". */
        const up = await fetch(`${at}/healthcheck`, { signal: AbortSignal.timeout(4000) })
          .then((r) => r.ok)
          .catch(() => false);
        return res.status(200).json({ at, up, config, token: signedForEditor(config) });
      }

      /* Asks the document server to hand the file back now instead of after
         its own pause; it answers through the same callback. */
      if (req.method === "POST" && t === "now") {
        const at = String(process.env.ONLYOFFICE_URL || "");
        const kind = String(req.query.kind || "");
        if (!at) return res.status(503).json({ error: "no document server is set up" });
        const got = await manifest();
        const now = got?.[kind];
        if (!now) return res.status(404).json({ error: "no such form" });
        const body = {
          c: "forcesave",
          key: `${kind}-${now.version}-${String(now.sha256 || "").slice(0, 12)}`,
        };
        const said = await fetch(`${at}/coauthoring/CommandService.ashx`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${signedForEditor({ payload: body })}`,
          },
          body: JSON.stringify({ ...body, token: signedForEditor(body) }),
        }).then((r) => r.json()).catch((e) => ({ error: 9, message: e.message }));
        /* 0 is saved, 4 is "nothing has changed since the last one" — both mean
           what is kept is what is on screen. */
        const code = Number(said?.error ?? 9);
        if (code !== 0 && code !== 4)
          return res.status(502).json({ error: `the document server would not save it (${code})` });
        return res.status(200).json({ saved: code === 0 });
      }

      /* The last editor draft, so what is published is what somebody saw and
         the guard runs on these bytes first. */
      if (req.method === "GET" && t === "draft") {
        const got = await draftOf(req.query.kind);
        if (!got) return res.status(404).json({ error: "nothing has been edited yet" });
        res.setHeader("content-type", typeOf(req.query.kind));
        res.setHeader("cache-control", "no-store");
        return res.status(200).send(got);
      }
      return res.status(400).json({ error: "no such request" });
    } catch (e) {
      const mine = /admin|no such/.test(e.message);
      return res.status(mine ? 403 : 500).json({ error: e.message.slice(0, 160) });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "use POST" });
  if (!engineReady()) return res.status(500).json({ error: "the server cannot draw documents yet" });

  const bytes = await raw(req, LIMIT);
  if (bytes === null) return res.status(413).json({ error: "that document is too big to draw" });
  if (!bytes.length) return res.status(400).json({ error: "no document" });

  try {
    const out = await ask(bytes);
    if (out.status !== 200 || !String(out.type || "").includes("pdf")) {
      /* A file that is not a document is the caller's mistake, not the
         server's: answering 502 to it says the far end broke when nothing
         did, and hides a real breakage among the noise. */
      const mine = out.status >= 400 && out.status < 500;
      return res.status(mine ? out.status : 502).json({
        error: mine ? "that is not a Word document" : `could not be drawn (${out.status})`,
      });
    }
    res.setHeader("content-type", "application/pdf");
    res.setHeader("cache-control", "private, no-store");
    return res.status(200).send(out.body);
  } catch (e) {
    return res.status(502).json({ error: `could not be drawn: ${e.message}` });
  }
}
