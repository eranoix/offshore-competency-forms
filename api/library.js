/**
 * The shared library: paperwork people hand over so the writing gets better.
 * Bytes go to the Supabase server's storage disk, the row to its database. A document is listed
 * only to its uploader and the site's administrator, and only the administrator can remove it.
 */
import crypto from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { extractText, getDocumentProxy } from "unpdf";
import { db, storage, requireSession, isAdmin, isId } from "./_supabase.js";
import { PRINTED, PRINTED_RUN, PRINTED_WORDS, flatten } from "./_printed.js";
import { ask, engineReady } from "./_engine.js";

const BUCKET = "offshore-report-library";
const CHUNK = 1200;
const TEXT_CAP = 200_000;

const entities = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");

/** A .docx or .docm is a zip; the words are in one part of it. */
function fromWord(bytes) {
  const part = unzipSync(new Uint8Array(bytes))["word/document.xml"];
  if (!part) return "";
  const xml = strFromU8(part)
    .replace(/<w:tab[^>]*\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n");
  return entities(xml.replace(/<[^>]+>/g, "")).replace(/\n{3,}/g, "\n\n").trim();
}

/** A PDF with a text layer — including a scan that has been through OCR. */
async function fromPdf(bytes) {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return String(text || "").replace(/\n{3,}/g, "\n\n").trim();
}

/* Below this, whatever came back is a page number and a letterhead, not
   words: the file is a scan, or a format this cannot open. */
const THIN = 200;

/** A second try on the machine that can look harder: it draws the page and reads it, opens
 *  pre-2007 Word, reads a spreadsheet cell by cell. Many donations are photographed handwritten forms. */
async function readHarder(bytes, name) {
  if (!engineReady()) return "";
  try {
    const out = await ask(bytes, { where: "read", headers: { "x-name": String(name || "").slice(0, 200) }, timeout: 300_000 });
    if (out.status !== 200) return "";
    return String(JSON.parse(out.body.toString("utf8")).text || "");
  } catch {
    /* the engine being away does not fail an upload */
    return "";
  }
}

/** The words in a donation, whatever it arrived as. A file we cannot read is
 *  still kept — it simply has nothing for the writing to learn from yet. */
export async function readWords(bytes, kind, name) {
  const ext = String(name || "").toLowerCase();
  let words = "";
  try {
    if (/^text\/|json|csv|markdown/.test(kind)) return bytes.toString("utf8");
    if (kind === "application/pdf" || ext.endsWith(".pdf")) words = await fromPdf(bytes);
    else if (/wordprocessingml|ms-word/.test(kind) || ext.endsWith(".docx") || ext.endsWith(".docm"))
      words = fromWord(bytes);
  } catch {
    /* a file we cannot open is not a failed upload */
  }
  /* Long enough is not the same as readable: a scanner can write its own garbled reading into
     a PDF, so a text layer must also look like words before it is trusted. */
  if (words.replace(/\s/g, "").length >= THIN && wordliness(words) >= 0.5) return words;
  const harder = await readHarder(bytes, name);
  if (!harder) return words;
  /* Nothing read is not a reading to beat: an empty result scores as perfect
     under a measure built to leave blank lines alone, and the good reading
     lost to it. */
  if (!words.trim()) return harder;
  return wordliness(harder) >= wordliness(words) ? harder : words;
}

/**
 * Is this writing, or a reader guessing at smudges?
 *
 * Proper words tell them apart: about a tenth of the tokens in a mangled
 * letterhead are words, against three quarters of them on a page read well.
 */
function wordliness(line) {
  const toks = String(line).split(/\s+/).filter(Boolean);
  if (!toks.length) return 1;
  const words = toks.filter((t) => /^[A-Za-z][A-Za-z'-]{2,}$/.test(t.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "")));
  return words.length / toks.length;
}

/* Form text is mostly labels and boxes: keep the sentences, mark the headings, cut it into passages.
   What the blank form already prints is thrown away: it holds the very words a search uses, so
   left in it would win the search over the paragraph a person wrote. */
function markdown(raw) {
  const seen = new Set();
  const lines = [];
  for (const line of String(raw).split(/\r?\n/)) {
    const t = line.split(/\s+/).filter(Boolean).join(" ");
    if (t.length < 3 || /^[-_=.·•\s]+$/.test(t) || /^(page \d+ of \d+|\d+)$/i.test(t)) continue;
    if (PRINTED.has(t)) continue;
    /* Read off a scan the same sentence arrives broken elsewhere and with its
       dashes changed, so it is recognised by being part of what the forms
       print rather than by matching a line. Four words keep a name or a
       vessel from being mistaken for furniture. */
    const flat = flatten(t);
    const words = flat ? flat.split(" ") : [];
    if (words.length >= 4 && PRINTED_RUN.includes(flat)) continue;
    /* A scan breaks a printed sentence into scraps — "Program" on a line of
       its own. Too short to be contained, it is still furniture when every
       word in it is one the blank form prints; a person's name or a vessel
       never is. */
    if (words.length && words.length < 4 && words.every((w) => PRINTED_WORDS.has(w))) continue;
    /* The letterhead read off a photograph comes back as "SLJ sffi€ y
       WWW.N0RTHW1ND.C0M" — confident, shaped like text, meaningless. Real
       writing is mostly words; this is mostly not. */
    if (words.length >= 5 && wordliness(t) < 0.4) continue;
    if (t.length < 60 && seen.has(t)) continue;
    seen.add(t);
    lines.push(t === t.toUpperCase() && t.length < 80 ? `\n## ${t}` : t);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function passages(text) {
  const out = [];
  let buf = "";
  for (const line of markdown(text).split("\n")) {
    if (buf.length + line.length + 1 > CHUNK && buf) {
      out.push(buf.trim());
      buf = "";
    }
    buf += line + "\n";
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter((p) => p.length > 140).slice(0, 80);
}

/** Index a donation so the writing can be shown the parts that matter. */
async function index(userId, docId, text) {
  const rows = passages(text).map((t, ord) => ({ user_id: userId, doc_id: docId, ord, text: t }));
  if (!rows.length) return 0;
  try {
    await db("offshore_report_library_chunks", { method: "POST", body: rows, prefer: "return=minimal" });
    return rows.length;
  } catch {
    return 0;
  }
}
const LIMIT = 4 * 1024 * 1024;

const safe = (name) =>
  String(name || "document")
    .replace(/[^\w.\- ]+/g, "_")
    .slice(-90)
    .trim() || "document";

export default async function handler(req, res) {
  const who = requireSession(req, res);
  if (!who) return;
  const admin = isAdmin(who);

  try {
    /* What the server already read out of a donation, so a Word file can be
       looked at without downloading it. */
    if (req.method === "GET" && req.query?.text) {
      const [row] = await db(
        `offshore_report_library?id=eq.${req.query.text}&select=user_id,name,kind,text_content`,
      );
      if (!row) return res.status(404).json({ error: "no such document" });
      if (row.user_id !== who.sub && !admin)
        return res.status(403).json({ error: "that document is not yours" });
      res.setHeader("cache-control", "private, no-store");
      return res.status(200).json({
        name: row.name,
        kind: row.kind,
        text: (row.text_content || "").slice(0, 20000),
        read: Boolean(row.text_content),
      });
    }

    if (req.method === "GET" && req.query?.file) {
      const [row] = await db(
        `offshore_report_library?id=eq.${req.query.file}&select=user_id,name,kind,path`,
      );
      if (!row) return res.status(404).json({ error: "no such document" });
      if (row.user_id !== who.sub && !admin)
        return res.status(403).json({ error: "that document is not yours" });
      const file = await storage(`${BUCKET}/${encodeURI(row.path)}`);
      /* Looking at it and keeping it are different acts: a preview is shown in
         place, a download is handed to the file system. */
      const inline = req.query?.inline === "1";
      res.setHeader("content-type", row.kind || "application/octet-stream");
      res.setHeader(
        "content-disposition",
        `${inline ? "inline" : "attachment"}; filename="${row.name.replace(/"/g, "")}"`,
      );
      res.setHeader("cache-control", "private, no-store");
      return res.status(200).send(Buffer.from(await file.arrayBuffer()));
    }

    if (req.method === "GET") {
      /* The administrator is shown everything handed over; everyone else sees only their own.
         `?mine=1` narrows an administrator to their own shelf. */
      const mine = req.query?.mine === "1";
      const everything = admin && !mine;
      const scope = everything ? "" : `user_id=eq.${who.sub}&`;
      /* How many passages each donation was cut into: an unreadable scan or a blank form comes
         back at nought, and the shelf can say so. */
      const rows = await db(
        `offshore_report_library?${scope}select=id,user_id,user_email,name,kind,size,campaign,notes,created_at,shared,` +
          `offshore_report_library_chunks(count)&order=created_at.desc&limit=1000`,
      );
      return res.status(200).json({
        admin,
        /* What this answer actually covers, so the page never has to guess. */
        showing: everything ? "everyone" : "mine",
        documents: (rows || []).map(({ offshore_report_library_chunks: cut, ...r }) => ({
          ...r,
          own: r.user_id === who.sub,
          passages: Array.isArray(cut) ? Number(cut[0]?.count || 0) : 0,
        })),
      });
    }

    if (req.method === "POST") {
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
      if (!bytes.length) return res.status(400).json({ error: "the file came through empty" });
      if (bytes.length > LIMIT)
        return res.status(413).json({ error: "that file is over 4 MB — send a smaller one" });

      const name = safe(req.query?.name);
      const kind = String(req.query?.kind || "application/octet-stream").slice(0, 120);
      const path = `${who.sub}/${crypto.randomUUID()}-${name}`;
      await storage(`${BUCKET}/${encodeURI(path)}`, {
        method: "POST",
        body: bytes,
        contentType: kind,
      });

      const words = (await readWords(bytes, kind, name)).slice(0, TEXT_CAP);
      const saved = await db("offshore_report_library", {
        method: "POST",
        prefer: "return=representation",
        body: {
          user_id: who.sub,
          user_email: who.email || null,
          name,
          kind,
          size: bytes.length,
          path,
          campaign: String(req.query?.campaign || "").slice(0, 60) || null,
          notes: String(req.query?.notes || "").slice(0, 600) || null,
          text_content: words || null,
        },
      });
      const row = Array.isArray(saved) ? saved[0] : saved;
      const passagesIndexed = words && row?.id ? await index(who.sub, row.id, words) : 0;
      return res.status(200).json({ document: row, passages: passagesIndexed });
    }

    /**
     * Sharing. A donation is seen only by its donor. Made a house reference (by the administrator
     * only, one document at a time, since a record naming a real person should not be shared), it
     * also feeds everybody's writing without appearing on anybody else's shelf.
     */
    if (req.method === "PATCH") {
      if (!admin) return res.status(403).json({ error: "only the site's administrator can share a document" });
      const id = String(req.query?.id || "");
      if (!isId(id)) return res.status(400).json({ error: "which document?" });
      const shared = req.query?.shared === "1";
      const [row] = await db(`offshore_report_library?id=eq.${id}&select=id`);
      if (!row) return res.status(404).json({ error: "no such document" });
      await db(`offshore_report_library?id=eq.${id}`, { method: "PATCH", body: { shared }, prefer: "return=minimal" });
      return res.status(200).json({ id, shared });
    }

    if (req.method === "DELETE") {
      const id = req.query?.id;
      if (!id) return res.status(400).json({ error: "no id" });
      // Handing a document over is a donation: it is not the donor's to take
      // back. Only whoever runs the site can remove one.
      if (!admin)
        return res.status(403).json({
          error: "a document that has been handed over can only be removed by whoever runs the site",
        });
      const [row] = await db(`offshore_report_library?id=eq.${id}&select=id,user_id,path`);
      if (!row) return res.status(404).json({ error: "no such document" });
      await storage(`${BUCKET}/${encodeURI(row.path)}`, { method: "DELETE" }).catch(() => {});
      await db(`offshore_report_library?id=eq.${id}`, { method: "DELETE" });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "GET, POST or DELETE" });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
