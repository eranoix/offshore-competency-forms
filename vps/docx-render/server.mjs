/**
 * Renders a Word document to PDF with an engine that reads Word, since a JavaScript reader never quite
 * lays it out as Word does. Reached only through the nginx on 9443, and only with the shared key.
 */
import { createServer } from "node:http";
import { wordsOf } from "./read.mjs";
import { blanksOf, pagesOf } from "./map.mjs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";

const run = promisify(execFile);
const PORT = Number(process.env.DOCX_PORT || 8791);
const KEY = process.env.DOCX_KEY || "";
const LIMIT = 8 * 1024 * 1024;
const SECONDS = 45;

/* A .docx and an .xlsx are both zips, and every zip starts the same way. A file
   that does not is not a document, whatever it claims to be. */
const looksLikeDocx = (buf) =>
  buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5 || buf[2] === 7);

const same = (a, b) => {
  const x = Buffer.from(String(a || ""), "utf8");
  const y = Buffer.from(String(b || ""), "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/* Building the engine's profile from nothing is most of the time a conversion
   takes. One is made when the service starts and copied for each job: the
   conversions still cannot meet, and none of them pays to build it. */
const SEED = "/opt/docx-render/profile";

/* The forms need the fonts the company's Word has: substitutes break lines elsewhere and change the page
   count, so say so loudly at startup rather than draw a wrong document. */
const NEEDED = ["Verdana", "Arial", "Times New Roman"];

async function fontsPresent() {
  const missing = [];
  for (const face of NEEDED) {
    try {
      const { stdout } = await run("fc-match", ["-f", "%{family}", face], { timeout: 10_000 });
      if (!stdout.toLowerCase().includes(face.toLowerCase())) missing.push(`${face} -> ${stdout.trim()}`);
    } catch { missing.push(`${face} -> could not ask`); }
  }
  if (missing.length) {
    console.log(`WRONG FONTS, the pages will not match Word: ${missing.join(", ")}`);
    console.log("  fix: apt-get install ttf-mscorefonts-installer && fc-cache -f");
  } else {
    console.log(`fonts ready: ${NEEDED.join(", ")}`);
  }
  return missing;
}

async function warm() {
  const probe = await mkdtemp(join(tmpdir(), "warm-"));
  try {
    await mkdir(SEED, { recursive: true });
    await writeFile(join(probe, "blank.fodt"), "<?xml version='1.0'?><office:document xmlns:office='urn:oasis:names:tc:opendocument:xmlns:office:1.0' office:mimetype='application/vnd.oasis.opendocument.text'/>");
    await run("soffice", [`-env:UserInstallation=file://${SEED}`, "--headless", "--norestore",
      "--convert-to", "pdf", "--outdir", probe, join(probe, "blank.fodt")], { timeout: 90_000 });
    console.log("profile ready");
  } catch (e) {
    console.log("profile not built:", e.message.slice(0, 80));
  } finally {
    await rm(probe, { recursive: true, force: true }).catch(() => {});
  }
}

/* Documents already laid out, by exactly what is in them. The same form comes
   through again and again — every session opens on the same blank one — and
   laying it out a second time produces a file identical to the first. */
const laidOut = new Map();
const HELD = 60;

function keep(fingerprint, pdf) {
  laidOut.set(fingerprint, pdf);
  while (laidOut.size > HELD) laidOut.delete(laidOut.keys().next().value);
}

/**
 * Tells .docx from .xlsx by the zip's entry names: the engine needs the right extension and export filter,
 * and a misnamed workbook fails with no PDF and nothing to explain it.
 */
function kindOf(bytes) {
  const head = bytes.slice(0, Math.min(bytes.length, 4096)).toString("latin1");
  if (head.includes("xl/workbook.xml") || head.includes("xl/_rels")) {
    return { ext: "xlsx", filter: "pdf:calc_pdf_Export" };
  }
  return { ext: "docx", filter: "pdf:writer_pdf_Export" };
}

async function toPdf(bytes) {
  /* Its own directory each time: two conversions at once must not meet, and
     the engine must not carry anything from one to the next. */
  const dir = await mkdtemp(join(tmpdir(), "docx-"));
  const what = kindOf(bytes);
  try {
    const src = join(dir, `form.${what.ext}`);
    await writeFile(src, bytes);
    await cp(SEED, join(dir, "profile"), { recursive: true }).catch(() => {});
    await run(
      "soffice",
      [
        `-env:UserInstallation=file://${join(dir, "profile")}`,
        "--headless",
        "--norestore",
        "--nolockcheck",
        "--nodefault",
        "--convert-to",
        what.filter,
        "--outdir",
        dir,
        src,
      ],
      { timeout: SECONDS * 1000, maxBuffer: 1 << 24 },
    );
    return await readFile(join(dir, "form.pdf"));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

createServer(async (req, res) => {
  const done = (code, body, type = "application/json") => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
    res.end(typeof body === "string" ? body : body);
  };

  if (req.method === "GET" && req.url === "/healthz") return done(200, JSON.stringify({ ok: true }));
  if (req.method !== "POST") return done(405, JSON.stringify({ error: "use POST" }));
  if (!KEY || !same(req.headers["x-docx-key"], KEY)) return done(401, JSON.stringify({ error: "no" }));

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > LIMIT) return done(413, JSON.stringify({ error: "too big" }));
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (!bytes.length) return done(400, JSON.stringify({ error: "nothing was sent" }));

  /* A second reading for donations the site could not open itself (a scan, old Word, a spreadsheet).
     It answers words, never a document; an unreadable file is not an error. */
  if (req.url === "/read") {
    try {
      const words = await wordsOf(bytes, String(req.headers["x-name"] || "").slice(0, 200));
      return done(200, JSON.stringify({ text: words }));
    } catch (e) {
      return done(502, JSON.stringify({ error: `could not read it: ${String(e.message).slice(0, 120)}` }));
    }
  }

  if (!looksLikeDocx(bytes)) return done(400, JSON.stringify({ error: "not a document" }));

  /* Where the blanks are on the page the form draws, as fractions of the page (never pixels) so they hold at any size. */
  if (req.url === "/map") {
    try {
      let labels = [];
      try {
        labels = JSON.parse(String(req.headers["x-labels"] || "[]"));
      } catch {
        return done(400, JSON.stringify({ error: "the labels are not a list" }));
      }
      if (!Array.isArray(labels)) return done(400, JSON.stringify({ error: "the labels are not a list" }));
      const fingerprint = crypto.createHash("sha256").update(bytes).digest("hex");
      const held = laidOut.get(fingerprint);
      const pdf = held || (await toPdf(bytes));
      if (!held) keep(fingerprint, pdf);
      const pages = await pagesOf(pdf);
      return done(200, JSON.stringify({ pages: pages.map((p) => ({ w: p.w, h: p.h })), ...blanksOf(pages, labels) }));
    } catch (e) {
      return done(502, JSON.stringify({ error: `could not map it: ${String(e.message).slice(0, 120)}` }));
    }
  }

  try {
    const fingerprint = crypto.createHash("sha256").update(bytes).digest("hex");
    const held = laidOut.get(fingerprint);
    const pdf = held || (await toPdf(bytes));
    if (!held) keep(fingerprint, pdf);
    res.writeHead(200, {
      "content-type": "application/pdf",
      "content-length": pdf.length,
      "cache-control": "no-store",
      "x-drawn": held ? "held" : "fresh",
    });
    res.end(pdf);
  } catch (e) {
    done(502, JSON.stringify({ error: `could not lay it out: ${String(e.message).slice(0, 120)}` }));
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`docx-render on 127.0.0.1:${PORT}`);
  fontsPresent();
  warm();
});
