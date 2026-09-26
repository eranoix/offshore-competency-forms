/**
 * The words a form prints, and changing them.
 * Word splits a paragraph's text into runs anywhere, so a paragraph is read by joining its runs
 * and written into the first run with the rest emptied; that flattens formatting inside a line,
 * so a paragraph with mixed runs is marked. Every value is found by its paragraph's w14:paraId,
 * so `dropPara` will not remove a paragraph `whyKeep` gives a reason to keep.
 */
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

const PARA = /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
const RUN_TEXT = /<w:t[^>]*>([^<]*)<\/w:t>/g;
const escape = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const idOf = (para) => (para.match(/w14:paraId="([0-9A-Fa-f]+)"/) || [])[1] || "";
const textOf = (para) => [...para.matchAll(RUN_TEXT)].map((m) => m[1]).join("")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
/* How many different looks the runs of this paragraph wear. */
const looks = (para) =>
  new Set([...para.matchAll(/<w:rPr>[\s\S]*?<\/w:rPr>/g)].map((m) => m[0])).size;

/**
 * Every paragraph of a form that says anything, with what it says and what the
 * filling uses it for.
 *
 * `anchors` is the slot → paraId map the form carries, so a line that is where
 * a value goes can be shown as such: rename it freely, the value still lands.
 */
export function wordsOf(bytes, anchors = {}) {
  const zip = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const xml = strFromU8(zip["word/document.xml"]);
  const named = new Map();
  for (const [slot, id] of Object.entries(anchors)) {
    for (const one of Array.isArray(id) ? id : [id]) named.set(one, slot);
  }
  const out = [];
  for (const m of xml.matchAll(PARA)) {
    const text = textOf(m[0]).trim();
    if (!text) continue;
    const id = idOf(m[0]);
    if (!id) continue;
    out.push({
      id,
      text,
      /* What the filling writes here, if anything. */
      slot: named.get(id) || "",
      /* More than one look among its runs: editing flattens them. */
      mixed: looks(m[0]) > 1,
      /* A line of nothing but dots is a rule to write on, not wording. */
      rule: /^[….\s]+$/.test(text),
    });
  }
  return out;
}

/**
 * A form with some of its wording changed.
 *
 * `changes` is paraId → the new text. A paragraph nobody changed is left
 * exactly as it was, down to the byte.
 */
export function reword(bytes, changes = {}) {
  const zip = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  let xml = strFromU8(zip["word/document.xml"]);
  let touched = 0;
  for (const [id, said] of Object.entries(changes)) {
    const at = xml.indexOf(`w14:paraId="${id}"`);
    if (at < 0) continue;
    const open = xml.lastIndexOf("<w:p ", at);
    const close = xml.indexOf("</w:p>", at);
    if (open < 0 || close < 0) continue;
    const para = xml.slice(open, close + 6);
    if (textOf(para).trim() === String(said).trim()) continue;
    let first = true;
    const written = para.replace(/<w:t[^>]*>[^<]*<\/w:t>/g, () => {
      if (!first) return "<w:t></w:t>";
      first = false;
      return `<w:t xml:space="preserve">${escape(said)}</w:t>`;
    });
    /* A paragraph with no run at all has nowhere to put the words: leaving it
       alone is better than inventing a run whose look nobody chose. */
    if (written === para) continue;
    xml = xml.slice(0, open) + written + xml.slice(close + 6);
    touched += 1;
  }
  if (!touched) return { bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), touched };
  zip["word/document.xml"] = strToU8(xml);
  return { bytes: zipSync(zip, { level: 6 }), touched };
}

/* Reading and writing the same paragraph, found by its own name. Word puts
   the id on the opening tag, so the paragraph runs from the "<w:p " before it
   to the "</w:p>" after. */
function spanOf(xml, id) {
  const at = xml.indexOf(`w14:paraId="${id}"`);
  if (at < 0) return null;
  const open = xml.lastIndexOf("<w:p ", at);
  const close = xml.indexOf("</w:p>", at);
  if (open < 0 || close < 0) return null;
  return { open, close: close + 6, para: xml.slice(open, close + 6) };
}

/* Inside a shape. Word keeps a drawing twice (modern and fallback) and both copies carry the
   SAME paragraph name, while a write by name always lands on the first; so nothing here
   touches a paragraph inside one. */
const INSIDE = /<w:txbxContent[\s>]|<mc:AlternateContent[\s>]|<mc:Fallback[\s>]|<v:textbox[\s>]/;
const shaped = (xml, open) => {
  const before = xml.slice(0, open);
  const shut = Math.max(
    before.lastIndexOf("</w:txbxContent>"),
    before.lastIndexOf("</mc:AlternateContent>"),
  );
  return INSIDE.test(before.slice(shut + 1));
};

/** A w14:paraId no part of this document is using. */
export function freshId(zip) {
  const used = new Set();
  for (const [name, data] of Object.entries(zip)) {
    if (!name.endsWith(".xml")) continue;
    const xml = strFromU8(data);
    for (const m of xml.matchAll(/w14:paraId="([0-9A-Fa-f]{8})"/g)) used.add(m[1].toUpperCase());
  }
  /* Word will not open a document whose paragraph name is zero or has the top
     bit set; every id in the company's own forms starts 0 to 7. */
  for (let n = 0; n < 10_000; n += 1) {
    const id = Math.floor(Math.random() * 0x7fffffff + 1).toString(16).toUpperCase().padStart(8, "0");
    if (!used.has(id)) return id;
  }
  return "";
}

/**
 * Why a paragraph has to stay.
 *
 * Every entry here exists because of something in src/engine/docx.js that
 * finds where to write by looking for exactly this. An empty list means the
 * paragraph is wording and nothing else.
 */
export function whyKeep(bytes, id, anchors = {}) {
  const zip = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const xml = strFromU8(zip["word/document.xml"]);
  const found = spanOf(xml, id);
  if (!found) return [{ code: "gone", why: "that line is not in the document", hard: true }];
  const { para, open } = found;
  const text = textOf(para).trim();
  const out = [];

  for (const [slot, on] of Object.entries(anchors)) {
    const ids = Array.isArray(on) ? on : [on];
    if (ids.includes(id)) out.push({ slot, code: "anchor", hard: true,
      why: `this is the line ${WHAT[slot] || slot} is written on` });
  }
  if (/<w:pBdr>/.test(para)) out.push({ code: "box", hard: true,
    why: "this is the box the statement is written into, and it has to stay empty" });
  if (/WT00/.test(para)) out.push({ code: "ref", hard: true,
    why: "the document's reference is written over WT00" });
  if (shaped(xml, open)) out.push({ code: "inside", hard: true,
    why: "this line is inside a drawing, and a drawing keeps two copies of it — only one of them would change" });
  if (/^Q\d+:?$/.test(text) || /^A:?$/.test(text)) out.push({ code: "qa", hard: true,
    why: "unused questions are dropped by finding exactly this line" });
  if (/<w:sectPr\b/.test(para)) out.push({ code: "sect", hard: true,
    why: "this is where the section ends, not a line of the form" });

  /* The heading itself, in either spelling — the CAAP forms shout it, the trip
     form writes `Guidance Notes;` — and never a sentence that merely points at
     it: three of the four forms say "(please see reverse for guidance notes)"
     in their own body, and that line is wording like any other. */
  if (/^GUIDANCE NOTES\b/i.test(text)) out.push({ code: "guidance", hard: false,
    why: "the guidance pages are dropped from a filled form by finding this heading" });
  if (/^[….\s]+$/.test(text)) out.push({ code: "rule", hard: false,
    why: "this is a line to write on by hand, not wording" });
  return out;
}

const WHAT = {
  signer: "who signs it", position: "their position and ship", candidate: "the candidate",
  bond: "how they know the candidate", split: "where the second box starts",
  met: "met the standard", notYet: "not yet met", ref: "the document's reference",
};

/**
 * A line added next to one that is already there.
 *
 * It takes the neighbour's look so it belongs on the page — but never its
 * border and never its section end. A cloned border would be counted as one
 * more box to write a statement into, which on the feedback form moves the
 * candidate's own words into the assessor's box.
 */
export function addPara(bytes, near, text = " ", { where = "after" } = {}) {
  const zip = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  let xml = strFromU8(zip["word/document.xml"]);
  const found = spanOf(xml, near);
  if (!found) return { bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), id: "" };
  if (shaped(xml, found.open)) return { bytes, id: "" };

  const id = freshId(zip);
  if (!id) return { bytes, id: "" };

  const pPr = (found.para.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [""])[0]
    .replace(/<w:pBdr>[\s\S]*?<\/w:pBdr>/g, "")
    .replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g, "");
  /* An empty paragraph is invisible to the reader and so would vanish from the
     editor the moment the page reloaded. A new line starts as one space. */
  const said = String(text ?? "") || " ";
  const made = `<w:p w14:paraId="${id}" w14:textId="77777777">${pPr}`
    + `<w:r><w:t xml:space="preserve">${escape(said)}</w:t></w:r></w:p>`;

  /* Never past the end of the body: what comes after the section end is either
     invisible or cut off by the trimming. */
  const end = xml.lastIndexOf("<w:sectPr");
  let at = where === "before" ? found.open : found.close;
  if (end > 0 && at > end) at = end;

  xml = xml.slice(0, at) + made + xml.slice(at);
  zip["word/document.xml"] = strToU8(xml);
  return { bytes: zipSync(zip, { level: 6 }), id };
}

/** A line taken out, if nothing in the filling depends on it. */
export function dropPara(bytes, id, anchors = {}) {
  const held = whyKeep(bytes, id, anchors);
  if (held.some((h) => h.hard)) return { bytes, removed: 0, held };
  const zip = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const xml = strFromU8(zip["word/document.xml"]);
  const found = spanOf(xml, id);
  if (!found) return { bytes, removed: 0, held };
  zip["word/document.xml"] = strToU8(xml.slice(0, found.open) + xml.slice(found.close));
  return { bytes: zipSync(zip, { level: 6 }), removed: 1, held };
}

/**
 * Which slots have no paragraph to land on. Asked of the document rather than of `wordsOf`,
 * which skips empty paragraphs: on a grid form every place a value goes is an empty cell.
 */
export function missingAnchors(bytes, anchors = {}) {
  const zip = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const xml = strFromU8(zip["word/document.xml"]);
  const here = new Set([...xml.matchAll(/w14:paraId="([0-9A-Fa-f]+)"/g)].map((m) => m[1]));
  const gone = new Set();
  for (const [slot, id] of Object.entries(anchors)) {
    for (const one of Array.isArray(id) ? id : [id]) if (!here.has(one)) gone.add(slot);
  }
  return [...gone];
}
