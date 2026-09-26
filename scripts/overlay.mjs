const __REPO = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/\/$/, "");
/**
 * The writing box, measured on the page actually drawn: lays out a short and a
 * long document through the real engine, reads the boxes from the drawn pages as
 * the panel does, and fails if the field would not follow the box.
 *
 *   node scripts/overlay.mjs
 *
 * Without the engine's key it says so and stops rather than passing on nothing.
 */
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { boxesDrawn, fitBoxes } from "../src/engine/boxes.js";
import { BLANKS } from "../src/forms/blanks.js";

const ROOT = `${__REPO}`;
const RENDER = process.env.DOCX_UPSTREAM || `http://127.0.0.1:${process.env.DOCX_PORT || 8791}/render`;
const KEY = process.env.DOCX_KEY || "";
if (!KEY) {
  console.error("no key for the layout engine — set DOCX_KEY");
  process.exit(2);
}

/* The browser's copy of the engine, in Node: the templates become paths and
   fetch reads them off the disk, which is what a URL is here. */
const bundle = "/tmp/overlay-docx.mjs";
await build({
  entryPoints: [`${ROOT}/src/engine/docx.js`],
  bundle: true, format: "esm", outfile: bundle, platform: "node", logLevel: "error",
  define: { __OFFLINE__: "false" },
  plugins: [{ name: "forms", setup(b) {
    b.onResolve({ filter: /\.docx\?url$/ }, (a) => ({
      path: join(ROOT, "src/forms", a.path.split("/").pop().replace("?url", "")), namespace: "form",
    }));
    b.onLoad({ filter: /.*/, namespace: "form" }, (a) => ({
      contents: `export default ${JSON.stringify(`file://${a.path}`)};`, loader: "js",
    }));
  } }],
});
const plain = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const address = String(url);
  if (!address.startsWith("file://")) return plain(url, opts);
  const b = await readFile(address.replace("file://", ""));
  return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
const { fillForm } = await import(bundle);
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const fails = [];
const say = (ok, label, got = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${got ? ` — ${got}` : ""}`);
  if (!ok) fails.push(label);
};

const DOC = {
  witness: "Pat Ellis", witnessPosition: "Supervisor", site: "MV Northstar",
  candidate: "Dario Castell", witnessRelationship: "Colleague",
  discipline: "ROV Pilot Technician", ref: "WT01", task: "LARS six-monthly maintenance", dated: "23/09/26",
};

async function drawn(text) {
  const bytes = await fillForm("witness", DOC, { text });
  const res = await fetch(RENDER, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", "x-docx-key": KEY },
    body: bytes,
  });
  if (!res.ok) throw new Error(`the engine said ${res.status}`);
  const file = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
  const out = [];
  for (let n = 1; n <= file.numPages; n += 1) {
    const page = await file.getPage(n);
    const size = page.getViewport({ scale: 1 });
    out.push(await boxesDrawn(pdfjs, page, size));
  }
  return out;
}

const map = BLANKS.witness.boxes;
const short = await drawn("He carried out the six-monthly maintenance on the launch and recovery system.");
const long = await drawn(
  Array.from({ length: 26 }, (_, i) =>
    `Paragraph ${i + 1}. He stripped and inspected the sheave assembly, checked the wire for birdcaging, ` +
    `re-tensioned the tether, and recorded the findings in the maintenance log for the shift.`,
  ).join("\n\n"),
);

say(short.flat().length > 0, "the drawn page gives up its boxes", `${short.flat().length} on ${short.length} page(s)`);

const a = fitBoxes(map, short)[0];
const b = fitBoxes(map, long)[0];
say(Boolean(a && b), "and the blank's box is matched to the drawn one");
/* The map holds the writing area and the drawing holds the border around it,
   so the two never agree to the pixel. What must not move between a short
   document and a long one is the left edge and the width. */
say(Math.abs(a.x - b.x) < 0.01 && Math.abs(a.w - b.w) < 0.01,
  "the left edge and the width do not move when the box grows",
  `x ${a.x.toFixed(3)}/${b.x.toFixed(3)} w ${a.w.toFixed(3)}/${b.w.toFixed(3)}`);
say(Math.abs(a.x - map[0].x) < 0.06, "and it still sits where the blank said",
  `drawn ${a.x.toFixed(3)} vs blank ${map[0].x.toFixed(3)}`);
say(b.h > a.h * 1.8, "and a long statement grows the field with the box",
  `${(a.h * 100).toFixed(1)}% of the page → ${(b.h * 100).toFixed(1)}%`);
say(b.h > map[0].h * 1.8, "which the blank's own measurement never did",
  `blank ${(map[0].h * 100).toFixed(1)}%`);

/* Nothing drawn is the offshore case: the blank's measurement has to stand. */
const none = fitBoxes(map, [])[0];
say(none.h === map[0].h && none.page === map[0].page, "with nothing drawn, the blank still stands");

console.log(fails.length ? `\n${fails.length} FAILED` : "\nthe field follows the box");
process.exit(fails.length ? 1 : 0);
