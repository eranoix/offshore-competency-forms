/**
 * The writing endpoint. The browser has no credential: this adds the key from
 * the environment, and accepts the upstream's own certificate server side,
 * which browsers refuse. Reached only with a session (middleware.js gates /api/*).
 */
import https from "node:https";
import { db, session } from "./_supabase.js";

/* The ceiling on one answer. It must clear what a many-area document asks
   for: a lower cap does not shorten the request, it truncates the document. */
const MAX_TOKENS = 8000;
/* Our own prompt, not the user's. Room for the house style plus the rules a
   particular document adds, so a rule is never silently cut off the end. */
const SYSTEM_CHARS = 12_000;
/* A statement being repaired arrives whole: three A4 pages of prose plus the
   faults to fix. Cut it and the repair quietly loses the end of the document. */
const MESSAGE_CHARS = 24_000;
const PASSAGES = 8;
const CONTEXT_CHARS = 7000;

/* Words the library is searched with. Anything that is not a plain word is
   dropped, so what reaches to_tsquery is always a list of words joined by OR —
   a person typing a quote mark cannot break the query or reach past their own
   documents. */
function terms(hint = {}) {
  const words = Object.values(hint)
    .filter((v) => typeof v === "string")
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && w.length < 24 && !STOP.has(w));
  return [...new Set(words)].slice(0, 24).join(" | ");
}
const STOP = new Set(["the","and","for","with","that","this","from","their","them","has","had","was","were","are","its","his","her","who","which","into","out","over","per","any","all","one","two"]);

/** The few passages of this person's own library that bear on what is written. */
async function fromLibrary(req, hint, facts = false) {
  const who = session(req);
  if (!who?.sub) return "";
  const q = terms(hint);
  if (!q) return "";
  try {
    const rows = await db("rpc/offshore_report_library_context", {
      method: "POST",
      body: { uid: who.sub, terms: q, n: PASSAGES },
    });
    if (!Array.isArray(rows) || !rows.length) return "";
    let out = "";
    for (const r of rows) {
      const piece = `\n--- from ${r.doc}\n${String(r.passage || "").trim()}\n`;
      if (out.length + piece.length > CONTEXT_CHARS) break;
      out += piece;
    }
    if (!out) return "";
    /* Two ways to use a person's own paperwork. A trip feedback borrows its
       voice and must invent nothing from it — those documents belong to other
       people. Competence evidence is the opposite: it may say only what the
       records show, because the records are the evidence. */
    return facts
      ? `THE RECORDS — this person's own completed paperwork. Everything you write
must come from here. Every task, system, tool, place, condition and action you
state as fact has to appear in these records; you may reword freely, join two
records into one sentence, or say it more plainly, but you may not add a fact
that is not here, and you may not soften that rule to fill space. Where the
records do not cover something, say less rather than invent. Do not copy a
name, a vessel or a date out of them: those come from the form.
${out}`
      : `Reference material — real paperwork from this person's own library, most of
it the same forms you are filling in. Follow the way these documents word
things: the vocabulary, the level of detail, the tone a reader in this company
expects. Ignore the printed parts of the form — the headings, the block capitals,
the confirmation wording — and follow only how the statement itself is written.
Do NOT take facts from them: no name, vessel, date, incident or person mentioned
here belongs in what you write. The facts come only from the form.
${out}`;
  } catch {
    return ""; // the library is a help, never a condition
  }
}

function callUpstream(payload) {
  const url = new URL(process.env.AI_UPSTREAM || "https://203.0.113.10:9443/v1/messages");
  const body = JSON.stringify(payload);
  const options = {
    method: "POST",
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname,
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
      "x-api-key": process.env.AI_KEY,
      "anthropic-version": "2023-06-01",
    },
    // The upstream presents its own certificate. Either pin it with AI_CA, or
    // accept it knowingly — this is a fixed host we control, not the open web.
    ...(process.env.AI_CA
      ? { ca: process.env.AI_CA }
      : { rejectUnauthorized: false, servername: url.hostname }),
    timeout: 60_000,
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("timeout", () => req.destroy(new Error("upstream timed out")));
    req.on("error", reject);
    req.end(body);
  });
}

export default async function handler(req, res) {
  // The page probes with HEAD before offering to write; answer quietly
  // instead of logging a method error in every console.
  if (req.method === "HEAD" || req.method === "OPTIONS") {
    res.setHeader("allow", "POST, HEAD");
    return res.status(204).end();
  }
  if (req.method !== "POST") return res.status(405).json({ error: "use POST" });
  if (!process.env.AI_KEY) return res.status(500).json({ error: "the server has no AI key" });

  const input = req.body || {};

  /* The page can ask for the reference material itself: what is written has to
     be checked against the same passages it was written from, and the check
     happens in the browser. */
  if (input.want === "passages") {
    const who = session(req);
    if (!who?.sub) return res.status(401).json({ error: "not signed in" });
    const q = terms(input.context || {});
    if (!q) return res.status(200).json({ passages: [] });
    try {
      const rows = await db("rpc/offshore_report_library_context", {
        method: "POST",
        body: { uid: who.sub, terms: q, n: Math.min(Number(input.n) || 10, 20) },
      });
      return res.status(200).json({
        passages: (Array.isArray(rows) ? rows : []).map((r) => ({
          doc: r.doc,
          text: String(r.passage || "").trim().slice(0, 2400),
        })),
      });
    } catch {
      return res.status(200).json({ passages: [] });
    }
  }

  const library = input.context ? await fromLibrary(req, input.context, input.use === "facts") : "";
  const messages = (Array.isArray(input.messages) ? input.messages : [])
    .slice(0, 4)
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, MESSAGE_CHARS),
    }));
  if (!messages.length) return res.status(400).json({ error: "no messages" });

  // The page chooses neither the model nor how much it may spend.
  const payload = {
    model: process.env.AI_MODEL || "claude-sonnet-4-6",
    max_tokens: Math.min(Number(input.max_tokens) || 400, MAX_TOKENS),
    temperature: typeof input.temperature === "number" ? input.temperature : 0.85,
    system: [String(input.system || "").slice(0, SYSTEM_CHARS), library].filter(Boolean).join("\n\n"),
    messages,
  };

  try {
    const upstream = await callUpstream(payload);
    res.status(upstream.status).setHeader("content-type", "application/json");
    return res.send(upstream.body);
  } catch (e) {
    return res.status(502).json({ error: `upstream unreachable: ${e.message}` });
  }
}
