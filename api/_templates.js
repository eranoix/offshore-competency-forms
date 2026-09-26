/**
 * Versioned form templates, so a changed form can go live without a release.
 * An underscore module, not a handler, because the plan allows twelve
 * functions and all twelve are used; the routing sits in render.js.
 */
import { createHash } from "node:crypto";
import { db, isAdmin, storage } from "./_supabase.js";

const BUCKET = "offshore-report-templates";
export const KINDS = ["witness", "observation", "knowledge", "feedback", "trip", "sed"];
const ok = (kind) => KINDS.includes(String(kind || ""));

/**
 * Which kinds are workbooks, so the file name and content type are never
 * assumed. Repeated rather than imported from src/engine/formkinds.js because a
 * serverless function reaches nothing the browser builds; scripts/sheeting.mjs
 * keeps the two lists in sync.
 */
const SHEETS = ["sed"];
export const isSheet = (kind) => SHEETS.includes(String(kind || ""));
export const extOf = (kind) => (isSheet(kind) ? "xlsx" : "docx");
export const typeOf = (kind) =>
  isSheet(kind)
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * What every form is on right now: version, file type, anchors and blanks.
 * Not the bytes, which are fetched one at a time only when the browser is stale.
 */
export async function manifest() {
  const rows = await db(
    "offshore_report_templates_live?select=kind,updated_at,offshore_report_templates(id,version,sha256,size,anchors,blanks,wording,note,created_at,created_email)",
  );
  const out = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const t = row.offshore_report_templates;
    if (!t) continue;
    out[row.kind] = {
      version: t.version,
      sha256: t.sha256,
      size: t.size,
      anchors: t.anchors || {},
      blanks: t.blanks || {},
      wording: t.wording || {},
      note: t.note || "",
      by: t.created_email || "",
      at: t.created_at,
      live: row.updated_at,
    };
  }
  return out;
}

/** Every version of one form, newest first, for the page that shows them. */
export async function versions(kind) {
  if (!ok(kind)) return [];
  const rows = await db(
    `offshore_report_templates?kind=eq.${kind}&select=id,version,sha256,size,note,created_at,created_email&order=version.desc&limit=50`,
  );
  return Array.isArray(rows) ? rows : [];
}

/** The bytes of one form, as they are stored. */
export async function bytesOf(kind, version) {
  if (!ok(kind)) return null;
  const want = Number.isFinite(Number(version)) ? `&version=eq.${Number(version)}` : "";
  const rows = want
    ? await db(`offshore_report_templates?kind=eq.${kind}${want}&select=path,sha256`)
    : await db(`offshore_report_templates_live?kind=eq.${kind}&select=offshore_report_templates(path,sha256)`).then((r) =>
        (Array.isArray(r) ? r : []).map((x) => x.offshore_report_templates).filter(Boolean),
      );
  const row = rows?.[0];
  if (!row?.path) return null;
  const file = await storage(`${BUCKET}/${encodeURI(row.path)}`);
  return { bytes: Buffer.from(await file.arrayBuffer()), sha256: row.sha256 };
}

/**
 * Keeps the editor's copy as the form's single draft. The document server saves
 * on its own schedule, so a save never publishes; going live stays a separate,
 * guarded step.
 */
export async function holdDraft(kind, bytes) {
  if (!ok(kind)) return false;
  /* replace: a form keeps exactly one draft, and without it the store refuses
     every save after the first with a 409 that the editor never reports. */
  await storage(`${BUCKET}/drafts/${kind}.${extOf(kind)}`, {
    method: "POST",
    body: bytes,
    replace: true,
    contentType: typeOf(kind),
  });
  return true;
}

/** The draft of a form, or nothing if nobody has left one. */
export async function draftOf(kind) {
  if (!ok(kind)) return null;
  try {
    const file = await storage(`${BUCKET}/drafts/${kind}.${extOf(kind)}`);
    if (!file?.ok) return null;
    const bytes = Buffer.from(await file.arrayBuffer());
    return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b ? bytes : null;
  } catch {
    return null;
  }
}

export async function keep(who, kind, bytes, { anchors, blanks, wording, note } = {}) {
  if (!ok(kind)) throw new Error("no such form");
  if (!isAdmin(who)) throw new Error("only an admin publishes a form");
  const rows = await db(`offshore_report_templates?kind=eq.${kind}&select=version&order=version.desc&limit=1`);
  const version = (rows?.[0]?.version ?? -1) + 1;
  let path = null;
  let sha256 = null;
  if (bytes?.length) {
    sha256 = createHash("sha256").update(bytes).digest("hex");
    path = `${kind}/v${version}-${sha256.slice(0, 8)}.${extOf(kind)}`;
    await storage(`${BUCKET}/${encodeURI(path)}`, {
      method: "POST",
      body: bytes,
      contentType: typeOf(kind),
    });
  }
  const [row] = await db("offshore_report_templates", {
    method: "POST",
    prefer: "return=representation",
    body: {
      kind,
      version,
      path,
      sha256,
      size: bytes?.length || null,
      anchors: anchors || {},
      blanks: blanks || {},
      wording: wording || {},
      note: String(note || "").slice(0, 300),
      created_by: who.sub,
      created_email: who.email,
    },
  });
  return row;
}

/** Which version everybody looks at. Going back is the same call. */
export async function live(who, kind, version) {
  if (!ok(kind)) throw new Error("no such form");
  if (!isAdmin(who)) throw new Error("only an admin publishes a form");
  const rows = await db(`offshore_report_templates?kind=eq.${kind}&version=eq.${Number(version)}&select=id`);
  if (!rows?.length) throw new Error("no such version of that form");
  await db("offshore_report_templates_live?on_conflict=kind", {
    method: "POST",
    prefer: "resolution=merge-duplicates",
    body: { kind, template_id: rows[0].id, updated_at: new Date().toISOString(), updated_by: who.email },
  });
  return { kind, version: Number(version) };
}
