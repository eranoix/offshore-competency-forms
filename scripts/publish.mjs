/**
 * Rewords a form, publishes it, checks the panel still fills it (places are named
 * by paragraph, not by printed label), then restores the company's own in one step.
 *
 * Publishes through the store, not the site: publishing is admin-only and the test
 * account deliberately is not one (that refusal is checked in scripts/forms.mjs).
 *
 *   OFFSHORE_REPORT_EMAIL=... OFFSHORE_REPORT_PASSWORD=... node scripts/publish.mjs
 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { reword, wordsOf } from "../src/engine/wording.js";
import { ANCHORS } from "../src/forms/anchors.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FORMS = join(ROOT, "src", "forms");
const SITE = process.env.OFFSHORE_REPORT_SITE || "https://forms.example.com";
const BASE = (process.env.SUPABASE_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!SERVICE || !process.env.OFFSHORE_REPORT_EMAIL) {
  console.log("set OFFSHORE_REPORT_EMAIL, OFFSHORE_REPORT_PASSWORD and SUPABASE_SERVICE_ROLE_KEY to check publishing");
  process.exit(0);
}

const fails = [];
const say = (ok, label, got = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${got ? ` — ${got}` : ""}`);
  if (!ok) fails.push(label);
};
const rest = async (path, { method = "GET", body, prefer } = {}) => {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    method,
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json", ...(prefer ? { prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 140)}`);
  return text ? JSON.parse(text) : null;
};
const put = async (path, bytes) => {
  const res = await fetch(`${BASE}/storage/v1/object/offshore-report-templates/${encodeURI(path)}`, {
    method: "POST",
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "x-upsert": "true",
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    body: bytes,
  });
  if (!res.ok) throw new Error(`storage ${res.status}`);
};

/* The engine, with the templates read off disk. */
const bundle = "/tmp/publish-docx.mjs";
await build({
  entryPoints: [join(ROOT, "src/engine/docx.js")], bundle: true, format: "esm", outfile: bundle,
  platform: "node", logLevel: "error",
  define: { __OFFLINE__: "false" },
  plugins: [{ name: "forms", setup(b) {
    b.onResolve({ filter: /\.docx\?url$/ }, (a) => ({ path: join(FORMS, a.path.split("/").pop().replace("?url", "")), namespace: "form" }));
    b.onLoad({ filter: /.*/, namespace: "form" }, (a) => ({ contents: `export default ${JSON.stringify(`file://${a.path}`)};`, loader: "js" }));
  } }],
});
const plainFetch = globalThis.fetch;
let serve = null;
globalThis.fetch = async (url, opts) => {
  const at = String(url);
  if (!at.startsWith("file://")) return plainFetch(url, opts);
  const bytes = serve || (await readFile(at.replace("file://", "")));
  return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};

const KIND = "witness";
const original = new Uint8Array(readFileSync(join(FORMS, `${KIND}.docx`)));
const lines = wordsOf(original, ANCHORS[KIND]);
const label = lines.find((l) => l.slot === "signer");
const { bytes: edited, touched } = reword(original, { [label.id]: "SIGNED OFF BY:" });
say(touched === 1, "a label is reworded", `"${label.text}" becomes "SIGNED OFF BY:"`);

/* Published, the way the page publishes: new version, anchors and map carried
   with it, then pointed at. */
const was = (await rest(`offshore_report_templates_live?kind=eq.${KIND}&select=offshore_report_templates(version)`))[0].offshore_report_templates.version;
const top = (await rest(`offshore_report_templates?kind=eq.${KIND}&select=version&order=version.desc&limit=1`))[0].version;
const version = top + 1;
const sha256 = createHash("sha256").update(edited).digest("hex");
const path = `${KIND}/v${version}-${sha256.slice(0, 8)}.docx`;
await put(path, Buffer.from(edited));
const [row] = await rest("offshore_report_templates", { method: "POST", prefer: "return=representation",
  body: { kind: KIND, version, path, sha256, size: edited.length, anchors: ANCHORS[KIND],
    blanks: {}, note: "a bench run", created_email: "bench" } });
await rest("offshore_report_templates_live?on_conflict=kind", { method: "POST", prefer: "resolution=merge-duplicates",
  body: { kind: KIND, template_id: row.id, updated_at: new Date().toISOString(), updated_by: "bench" } });
say(true, "and published", `v${was} → v${version}`);

try {
  const res0 = await plainFetch(`${SITE}/api/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.OFFSHORE_REPORT_EMAIL, password: process.env.OFFSHORE_REPORT_PASSWORD }) });
  const cookie = (res0.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  const said = await plainFetch(`${SITE}/api/render?t=manifest`, { headers: { cookie } }).then((r) => r.json());
  say(said.forms?.[KIND]?.version === version, "the site is on the new version", `v${said.forms?.[KIND]?.version}`);
  const got = await plainFetch(`${SITE}/api/render?t=bytes&kind=${KIND}`, { headers: { cookie } });
  const served = Buffer.from(await got.arrayBuffer());
  say(served.equals(Buffer.from(edited)), "and hands out the reworded form", `${(served.length / 1024).toFixed(0)}KB`);

  /* And the point of all of it: filled in, the value still lands. */
  serve = served;
  const { fillForm } = await import(`${bundle}?published=${Date.now()}`);
  const filled = await fillForm(KIND, { ref: "WT01", candidate: "Zebediah Quicksilver",
    witness: "Ophelia Wrenfield", witnessPosition: "Sub Engineer", witnessRelationship: "Colleague",
    site: "Vessel Thunderbird" }, { text: "He stripped the sheave assembly and logged every finding." });
  const KEY = process.env.DOCX_KEY;
  if (!KEY) {
    console.error("set DOCX_KEY to the render service's key (DOCX_PORT to its port)");
    process.exit(2);
  }
  const drawn = await plainFetch(`http://127.0.0.1:${process.env.DOCX_PORT || 8791}/render`, { method: "POST",
    headers: { "content-type": "application/octet-stream", "x-docx-key": KEY }, body: filled });
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const file = await pdfjs.getDocument({ data: new Uint8Array(await drawn.arrayBuffer()) }).promise;
  let page = "";
  for (let n = 1; n <= file.numPages; n += 1)
    page += ` ${(await (await file.getPage(n)).getTextContent()).items.map((i) => i.str).join(" ")}`;
  say(page.includes("SIGNED OFF BY"), "the published wording is on the page", "SIGNED OFF BY");
  say(page.includes("Ophelia Wrenfield"), "and the name is still written on its line", "Ophelia Wrenfield");
  say(page.includes("Zebediah Quicksilver") && page.includes("Sub Engineer"), "and so is everything else");
} finally {
  /* Back to the company's own, which is the whole reason version 0 is kept. */
  const [zero] = await rest(`offshore_report_templates?kind=eq.${KIND}&version=eq.0&select=id`);
  await rest("offshore_report_templates_live?on_conflict=kind", { method: "POST", prefer: "resolution=merge-duplicates",
    body: { kind: KIND, template_id: zero.id, updated_at: new Date().toISOString(), updated_by: "bench" } });
  await rest(`offshore_report_templates?kind=eq.${KIND}&version=eq.${version}`, { method: "DELETE" });
  const back = (await rest(`offshore_report_templates_live?kind=eq.${KIND}&select=offshore_report_templates(version,sha256)`))[0].offshore_report_templates;
  const mine = createHash("sha256").update(original).digest("hex");
  say(back.version === 0 && back.sha256 === mine, "and it goes back to the company's own in one step",
    `v${back.version} · ${back.sha256.slice(0, 12)}`);
}

console.log(fails.length ? `\n${fails.length} FAILED` : "\na form can be reworded, published, and still filled in");
process.exit(fails.length ? 1 : 0);
