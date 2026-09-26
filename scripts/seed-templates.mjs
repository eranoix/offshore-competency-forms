/**
 * Lodges the company's own forms on the server as version 0: the baseline every
 * later version is measured against, and what "back to the original" restores.
 * The days-at-sea workbook's version 0 is the tracker with every day emptied out.
 * Written once: a run that finds version 0 already there leaves it as it is.
 *
 *   node scripts/seed-templates.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ANCHORS } from "../src/forms/anchors.js";
import { BLANKS } from "../src/forms/blanks.js";

const FORMS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "forms");
const KINDS = ["witness", "observation", "knowledge", "feedback", "trip", "sed"];
const BUCKET = "offshore-report-templates";

/* The days-at-sea tracker is a workbook and must be lodged under its own name and
   type: a store told an .xlsx is a Word document hands it back as one, and the
   editor then reports the file as corrupt. */
const SHEETS = ["sed"];
const extOf = (kind) => (SHEETS.includes(kind) ? "xlsx" : "docx");
const typeOf = (kind) =>
  SHEETS.includes(kind)
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/* The service key of the Supabase the site uses, from the environment, so it
   is never copied anywhere it could be left behind. */
const BASE = (process.env.SUPABASE_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!SERVICE) {
  console.log("no service key — set SUPABASE_SERVICE_ROLE_KEY");
  process.exit(0);
}

const rest = async (path, { method = "GET", body, prefer } = {}) => {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      "content-type": "application/json",
      ...(prefer ? { prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
};
const store = async (path, bytes, type) => {
  const res = await fetch(`${BASE}/storage/v1/object/${BUCKET}/${encodeURI(path)}`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      "content-type": type,
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(`storage ${res.status} ${(await res.text()).slice(0, 160)}`);
};

for (const kind of KINDS) {
  const already = await rest(`offshore_report_templates?kind=eq.${kind}&version=eq.0&select=id,sha256`);
  const bytes = readFileSync(join(FORMS, `${kind}.${extOf(kind)}`));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (already.length) {
    const same = already[0].sha256 === sha256;
    console.log(`${kind.padEnd(12)} version 0 is already there${same ? "" : "  — and the repository's form has MOVED since"}`);
    continue;
  }
  const path = `${kind}/v0-${sha256.slice(0, 8)}.${extOf(kind)}`;
  await store(path, bytes, typeOf(kind));
  const [row] = await rest("offshore_report_templates", {
    method: "POST",
    prefer: "return=representation",
    body: {
      kind,
      version: 0,
      path,
      sha256,
      size: bytes.length,
      anchors: ANCHORS[kind] || {},
      blanks: BLANKS[kind] || {},
      note: SHEETS.includes(kind)
        ? "The tracker, blank: the headings, the sheet and every formula, and not one day counted."
        : "The form as it left the company.",
      created_email: "seed",
    },
  });
  await rest("offshore_report_templates_live?on_conflict=kind", {
    method: "POST",
    prefer: "resolution=merge-duplicates",
    body: { kind, template_id: row.id, updated_by: "seed" },
  });
  console.log(`${kind.padEnd(12)} version 0 seeded · ${(bytes.length / 1024).toFixed(0)}KB · ${sha256.slice(0, 12)}`);
}
console.log("\nlive now:");
for (const row of await rest("offshore_report_templates_live?select=kind,offshore_report_templates(version,sha256)")) {
  console.log(`  ${row.kind.padEnd(12)} v${row.offshore_report_templates.version} · ${row.offshore_report_templates.sha256.slice(0, 12)}`);
}
