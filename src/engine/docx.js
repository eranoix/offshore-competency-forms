/**
 * The official forms, filled in: a competence file needs the company's own
 * document, so the real .docx templates are filled rather than redrawn. Nothing
 * rewrites the layout; text goes after a label or into the bordered box.
 */
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { ANCHORS } from "../forms/anchors";
import { heldAbout, heldForm } from "./forms";

import witnessForm from "../forms/witness.docx?url";
import observationForm from "../forms/observation.docx?url";
import knowledgeForm from "../forms/knowledge.docx?url";
import feedbackForm from "../forms/feedback.docx?url";
import tripForm from "../forms/trip.docx?url";
/* The eleven criteria, in the order the grid prints them. Shared with the
   page that draws the sheet, so the two cannot drift apart on the order. */
import { KEYS } from "./generator";

/* Imported rather than fetched from a folder. On the site the build serves
   them alongside everything else; in the copy that travels offshore they are
   carried inside the single file, because a page opened from a folder has no
   origin and cannot fetch its own neighbours at all. */
const FILES = {
  trip: tripForm,
  witness: witnessForm,
  observation: observationForm,
  knowledge: knowledgeForm,
  feedback: feedbackForm,
};

const cache = new Map();

/** The template as it left the company, fetched once. */
async function template(kind) {
  if (cache.has(kind)) return cache.get(kind);
  /* A form the company has changed, if this browser has been told about one.
     It is held here rather than fetched now on purpose: a laptop at sea has to
     open the same form it had in port, and a fetch that fails must fall
     through to the one compiled in rather than to nothing. */
  const mine = heldForm(kind);
  if (mine?.bytes?.length) {
    cache.set(kind, mine.bytes);
    return mine.bytes;
  }
  /* Not every kind the site publishes is a form this engine fills; without this
     check an unknown kind fetched `undefined` and failed later on a non-zip. */
  if (!FILES[kind]) throw new Error(`no template for ${kind}`);
  const res = await fetch(FILES[kind]);
  if (!res.ok) throw new Error(`no template for ${kind}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  cache.set(kind, bytes);
  return bytes;
}

/** Where the values go on the form being used, published or compiled in. */
export const anchorsFor = (kind) => heldAbout(kind)?.anchors || ANCHORS[kind] || {};

const escape = (t) =>
  String(t ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * A run of text in the document's own body style. `look` is the run properties
 * of the target paragraph, so a value in a nine-point cell does not arrive at ten.
 */
const run = (text, { bold = false, look = "" } = {}) =>
  `<w:r><w:rPr>${boldly(look, bold)}</w:rPr><w:t xml:space="preserve">${escape(text)}</w:t></w:r>`;

/* Word reads run properties in a fixed order — the fonts before the weight,
   the weight before the size — so bold is spliced into the look rather than
   stuck on the front of it, and never twice. */
function boldly(look, bold) {
  if (!bold || /<w:b\s*\/>|<w:b\s+[^>]*\/>/.test(look)) return look;
  let at = 0;
  for (const m of look.matchAll(/<w:rStyle\b[^>]*\/>|<w:rFonts\b[^>]*\/>/g)) at = Math.max(at, m.index + m[0].length);
  return `${look.slice(0, at)}<w:b/>${look.slice(at)}`;
}

/** The paragraph Word calls this, if it is in here. */
function paraById(xml, id) {
  if (!id) return null;
  const at = xml.indexOf(`w14:paraId="${id}"`);
  if (at < 0) return null;
  const open = xml.lastIndexOf("<w:p ", at);
  if (open < 0) return null;
  const close = xml.indexOf("</w:p>", at);
  return close < 0 ? null : xml.slice(open, close + 6);
}

/**
 * The value written into one paragraph, found either by its printed label or
 * by its `w14:paraId` (the only way that survives an edit of the wording).
 */
function intoLine(xml, para, value) {
  {
    const dots = /…+/.exec(para);
    let filled;
    if (dots) {
      const keep = Math.max(6, dots[0].length - Math.ceil(String(value).length * 1.6));
      filled = para.replace(dots[0], `${escape(value)} ${"…".repeat(keep)}`);
    } else {
      /* Two spaces after the form's colon, not at the end of the line: the
         templates park tab stops to the right, far from the label. */
      const pieces = [...para.matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g)];
      let after = -1;
      let seen = "";
      for (const piece of pieces) {
        seen += (piece[0].match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
          .map((t) => t.replace(/<[^>]+>/g, ""))
          .join("");
        if (seen.includes(":")) {
          after = piece.index + piece[0].length;
          break;
        }
      }
      /* A form that writes its label without a colon of its own still gets an
         answer, at the end, which is where it used to go. */
      if (after < 0) after = para.lastIndexOf("</w:p>");
      /* Two spaces along — counting the one some of the forms print after the
         colon themselves, so every line comes out the same distance. */
      const gap = /\s$/.test(seen) ? " " : "  ";
      filled = `${para.slice(0, after)}${run(`${gap}${value}`)}${para.slice(after)}`;
    }
    return xml.replace(para, filled);
  }
}

/**
 * The value written into a table cell: the cell's text is replaced and the
 * value takes the look the paragraph already wears, since a grid cell has no
 * colon or leader for `intoLine` to find.
 */
export function intoCell(xml, id, value) {
  const said = String(value ?? "");
  if (!id || !said) return xml;
  const para = paraById(xml, id);
  if (!para) return xml;
  /* Spliced by position rather than replaced by text: a value carrying a
     dollar sign is read as a replacement pattern by `String.replace` and comes
     out as something nobody typed. */
  const at = xml.indexOf(para);
  return `${xml.slice(0, at)}${emptied(para)}${runs(said, lookOf(para))}</w:p>${xml.slice(at + para.length)}`;
}

/** The run properties the paragraph carries on its own mark. */
function lookOf(para) {
  const pPr = (para.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [""])[0];
  return (pPr.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [""])[0]
    .replace(/^<w:rPr>/, "")
    .replace(/<\/w:rPr>$/, "");
}

/* The paragraph with its runs removed and its closing tag off; its own
   properties stay. `<w:rPr>` is not matched: the word boundary after `w:r`
   refuses it. */
const emptied = (para) => para.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, "").replace(/<\/w:p>$/, "");

/**
 * The cell a paragraph is in, as the stretch of file between its tags.
 * Nested tables are not handled; they are not needed here.
 */
function cellAround(xml, at) {
  const open = xml.lastIndexOf("<w:tc>", at);
  const shut = xml.indexOf("</w:tc>", at);
  if (open < 0 || shut < 0) return null;
  /* Not this cell's paragraph if another cell closed between the two. */
  if (xml.slice(open, at).includes("</w:tc>")) return null;
  return `${open}:${shut}`;
}

function parasIn(xml, cell) {
  const [open, shut] = cell.split(":").map(Number);
  return (xml.slice(open, shut).match(/<w:p[ >\/]/g) || []).length;
}

/**
 * Prose into a cell that is a stack of paragraphs, one per line: spare ones
 * removed, extra lines added by repeating the last. A `<w:tc>` with no `<w:p>`
 * will not open in Word, so the last paragraph is emptied rather than removed.
 */
export function intoCells(xml, ids, text) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  const body = String(text || "").trim();
  if (!list.length || !body) return xml;
  const lines = body.split(/\n{2,}/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return xml;

  /* Every edit is measured against the document as it stands and applied from
     the end backwards, so taking one paragraph out cannot move the next. */
  const edits = [];
  const dropped = new Map();
  let model = null;
  list.forEach((id, i) => {
    const para = paraById(xml, id);
    if (!para) return;
    const at = xml.indexOf(para);
    model = { para, at };
    if (i < lines.length) {
      edits.push([at, at + para.length, `${emptied(para)}${runs(lines[i], lookOf(para))}</w:p>`]);
      return;
    }
    /* An unused line grows the row for nothing, so it goes, unless it is the
       cell's last paragraph (a `<w:tc>` needs a `<w:p>`); then it is emptied. */
    const edit = [at, at + para.length, ""];
    edits.push(edit);
    const cell = cellAround(xml, at);
    if (cell) dropped.set(cell, [...(dropped.get(cell) || []), { edit, para }]);
  });
  /* Whichever cells would be left with nothing keep the last of theirs. */
  for (const [cell, gone] of dropped) {
    if (gone.length < parasIn(xml, cell)) continue;
    const keep = gone[gone.length - 1];
    keep.edit[2] = `${emptied(keep.para)}</w:p>`;
  }

  /* More to say than the cell has paragraphs: it grows by repeating the last
     of its own, with the form's own look, rather than dropping the end of a
     sentence. */
  const spare = lines.slice(list.length);
  if (spare.length && model) {
    const tail = model.at + model.para.length;
    edits.push([tail, tail, spare
      .map((line) => `${emptied(model.para)}${runs(line, lookOf(model.para))}</w:p>`)
      .join("")]);
  }

  let out = xml;
  edits
    .sort((a, b) => b[0] - a[0])
    .forEach(([open, close, piece]) => {
      out = out.slice(0, open) + piece + out.slice(close);
    });
  return out;
}

/**
 * The mark in the score column: a lower-case x in the scored cell, as the
 * form's author made it. A score off the scale marks nothing.
 */
export const tickScore = (xml, anchors, row, score) =>
  score >= 1 && score <= 5 ? intoCell(xml, anchors[`score${row}_${score}`], "x") : xml;

/** The line the form prints, found by its label. */
function onLine(xml, label, value) {
  if (!value) return xml;
  const plain = label.replace(/&amp;/g, "&").toUpperCase();
  const paras = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)];
  for (const match of paras) {
    const words = (match[0].match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
      .map((t) => t.replace(/<[^>]+>/g, ""))
      .join("")
      .replace(/&amp;/g, "&")
      .toUpperCase();
    /* The label as the form prints it, with its colon: without that, WITNESS
       matches the title "Witness Testimony" and the name lands in the heading. */
    if (!new RegExp(`${plain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`).test(words)) continue;
    return intoLine(xml, match[0], value);
  }
  return xml;
}

/** The same line, found by the paragraph's own name instead. */
function onAnchor(xml, id, value) {
  if (!value) return xml;
  const para = paraById(xml, id);
  return para ? intoLine(xml, para, value) : xml;
}

/**
 * Writes paragraphs into the bordered box, one line per empty bordered
 * paragraph, touching nothing else so the file opens in Word as the blank does.
 */
function intoBox(xml, text, { from = 0, take = 0 } = {}) {
  const body = String(text || "").trim();
  if (!body) return xml;
  /* Every empty bordered paragraph with its position: matching on text alone
     would find the first of two identical paragraphs every time. */
  const boxes = [...xml.matchAll(/<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*?<w:pBdr>[\s\S]*?<\/w:pPr><\/w:p>/g)].map(
    (m) => ({ text: m[0], at: m.index }),
  );
  if (!boxes.length) return xml;
  const mine = take ? boxes.slice(from, from + take) : boxes.slice(from);
  if (!mine.length) return xml;

  /* One box line per paragraph, parted by spacing after rather than by an
     empty line, which cost a whole line of height each. */
  const lines = body.split(/\n{2,}/).map((para) => para.trim()).filter(Boolean);
  const APART = 120; /* six points, in twentieths of a point */
  const written = (box, line, last) =>
    box.text
      .replace("</w:pBdr>", `</w:pBdr>${last ? "" : `<w:spacing w:after="${APART}"/>`}`)
      .replace("</w:pPr></w:p>", `</w:pPr>${runs(line)}</w:p>`);

  /* One edit per line, plus one for whatever the box has no room for. They are
     applied from the end of the file backwards, so each position stays valid. */
  const edits = [];
  mine.forEach((box, i) => {
    if (i < lines.length && lines[i])
      edits.push([box.at, box.at + box.text.length, written(box, lines[i], i === lines.length - 1)]);
    /* Unreached box lines are removed so the box is as tall as its text and
       the signatures do not tip onto a second page. */
    else if (i >= lines.length) edits.push([box.at, box.at + box.text.length, ""]);
  });

  /* More to say than the box has lines: the box grows by repeating its own
     paragraph — the form's paragraph, with the form's border — rather than
     dropping the end of a statement. */
  const spare = lines.slice(mine.length);
  if (spare.length) {
    const model = mine[mine.length - 1];
    const tail = model.at + model.text.length;
    edits.push([
      tail,
      tail,
      spare.map((line, n) => written(model, line, n === spare.length - 1)).join(""),
    ]);
  }

  let out = xml;
  edits
    .sort((a, b) => b[0] - a[0])
    .forEach(([open, close, piece]) => {
      out = out.slice(0, open) + piece + out.slice(close);
    });
  return out;
}

/** **Marked** words come back as bold runs, as they do on screen. */
function runs(line, look = "") {
  return String(line)
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((bit) =>
      bit.startsWith("**") && bit.endsWith("**")
        ? run(bit.slice(2, -2), { bold: true, look })
        : run(bit, { look }),
    )
    .join("");
}

/** How many of the bordered lines come before a label the form prints. */
function slotsBefore(xml, label) {
  return boxesUpTo(xml, xml.indexOf(label));
}

/** The same count, to the paragraph Word calls this. */
function slotsBeforePara(xml, id) {
  return boxesUpTo(xml, xml.indexOf(`w14:paraId="${id}"`));
}

function boxesUpTo(xml, at) {
  if (at < 0) return 0;
  let n = 0;
  const box = /<w:p\b(?:(?!<\/w:p>)[\s\S])*?<w:pBdr>[\s\S]*?<\/w:pPr><\/w:p>/g;
  let found;
  while ((found = box.exec(xml))) {
    if (found.index > at) break;
    n += 1;
  }
  return n;
}

/** Puts text right after a label the form already prints. */
function afterLabel(xml, label, value) {
  if (!value) return xml;
  const at = xml.indexOf(`>${label}`);
  if (at < 0) return xml;
  const end = xml.indexOf("</w:p>", at);
  if (end < 0) return xml;
  return `${xml.slice(0, end)}${run(` ${value}`)}${xml.slice(end)}`;
}

/** The same, on the paragraph Word calls this rather than the one it says. */
function afterPara(xml, id, value) {
  if (!value || !id) return xml;
  const at = xml.indexOf(`w14:paraId="${id}"`);
  if (at < 0) return xml;
  const end = xml.indexOf("</w:p>", at);
  if (end < 0) return xml;
  return `${xml.slice(0, end)}${run(` ${value}`)}${xml.slice(end)}`;
}

/** Marks the outcome the form asks you to tick, the way it is done by hand. */
function tick(xml, met, anchors = {}) {
  const id = met ? anchors.met : anchors.notYet;
  const at = id
    ? xml.indexOf(`w14:paraId="${id}"`)
    : met
      ? xml.indexOf("can confirm he/she")
      : xml.indexOf("not yet met");
  if (at < 0) return xml;
  const para = xml.lastIndexOf("<w:p ", at);
  if (para < 0) return xml;
  const body = xml.indexOf(">", xml.indexOf("<w:pPr>", para));
  const close = xml.indexOf("</w:pPr>", para);
  if (body < 0 || close < 0) return xml;
  return `${xml.slice(0, close + 8)}${run("X ", { bold: true })}${xml.slice(close + 8)}`;
}

/* Fixed zip timestamps, so the same form with the same words comes out as
   the same bytes. */
const STAMP = new Date(Date.UTC(2013, 4, 30));
function pack(zip, xml) {
  zip["word/document.xml"] = strToU8(xml);
  const stamped = {};
  for (const [name, data] of Object.entries(zip)) stamped[name] = [data, { mtime: STAMP }];
  return zipSync(stamped, { level: 6 });
}

/**
 * Removes the guidance-notes page: from the paragraph holding its heading down
 * to the section properties, which stay (page size, margins, header/footer).
 * The templates are not edited; this applies to a copy on the way out.
 */
export function withoutGuidance(xml) {
  /* The paragraph that OPENS with the heading, case-blind and runs joined:
     three forms mention "(please see reverse for guidance notes)" near the top,
     and cutting from there would take the whole document. */
  let start = -1;
  for (const one of xml.matchAll(/<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const said = [...one[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("").trim();
    if (!/^GUIDANCE NOTES\b/i.test(said)) continue;
    start = one.index;
    break;
  }
  if (start < 0) return xml;
  /* The body's own section properties are the last ones in the document. */
  const end = xml.lastIndexOf("<w:sectPr");
  if (end <= start) return xml;
  return `${xml.slice(0, start)}${xml.slice(end)}`;
}

/**
 * Closes up the extra blank lines under the box, keeping one (the same gap the
 * form puts between signatures) so the signatures are not pushed onto a sheet
 * of their own. Spacing elsewhere is the company's layout and is left alone.
 */
export function tighten(xml) {
  /* Where the box ends: the last paragraph carrying its border. */
  const box = /<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*?<w:pBdr>(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g;
  const ends = [];
  let found = box.exec(xml);
  while (found) {
    ends.push(found.index + found[0].length);
    found = box.exec(xml);
  }
  if (!ends.length) return xml;
  /* Only the end of each run of bordered paragraphs. An empty paragraph is
     either written out with nothing in it or self-closed; match both. */
  const tail = /^\s*(?:<w:p\b[^>]*\/>|<w:p\b[^>]*>(?:(?!<w:t[ >])(?!<\/w:p>)[\s\S])*?<\/w:p>)/;
  const cuts = [];
  for (const [n, at] of ends.entries()) {
    if (n + 1 < ends.length && xml.slice(at, ends[n + 1]).trim().length < 20) continue;
    let from = at;
    let kept = 0;
    for (;;) {
      const next = xml.slice(from).match(tail);
      /* Never the paragraph that carries the border itself, and never one with
         a word in it. */
      if (!next || /<w:pBdr>/.test(next[0])) break;
      /* The first one is the gap; only what follows it is the extra. */
      if (kept) cuts.push([from, from + next[0].length]);
      kept += 1;
      from += next[0].length;
    }
  }
  let out = xml;
  for (const [open, close] of cuts.sort((a, b) => b[0] - a[0])) out = out.slice(0, open) + out.slice(close);
  return out;
}

/**
 * How much writing one sheet of each form holds, in characters: measured by
 * rendering each form through the printing engine, less a twelfth, because the
 * writing comes back a little over the ask and a sheet that tips is worse.
 */
export const SHEET = { witness: 1230, observation: 875, knowledge: 1230, feedback: 860 };

/**
 * How many sheets a document is allowed: one, plus one per eight areas past
 * eight, the line where areas start being answered by their group.
 */
const sheetsFor = (areas) => 1 + Math.floor(Math.max(0, areas - 8) / 8);
/* The ask for one area: between the lower quarter and the middle of the
   person's own witness testimonies, since longer reads as padded. */
const ALONE = 560;
/* An extra area earns a line (seventy characters), not a paragraph: a task can
   bring a whole framework of criteria onto one document. */
const PER_AREA = 70;
/* The most anybody writes: above this a statement reads like a report and
   pushes the signatures onto a second sheet. */
const MOST = 1150;
/**
 * What to ask for, in characters: bounded by what the areas earn, what the
 * sheets hold and the most anybody writes, and never a little over a sheet.
 */
export const askFor = (kind, areas) => {
  const sheet = SHEET[kind] || 1000;
  const wanted = Math.min(MOST, ALONE + PER_AREA * Math.max(0, areas - 1), sheet * sheetsFor(areas));
  if (wanted <= sheet) return wanted;
  const sheets = Math.floor(wanted / sheet);
  const over = wanted - sheets * sheet;
  /* Past a sheet, either fill the next one properly or stay off it — and
     staying off it means the sheet full, not a shade under, or a document
     carrying twenty areas would be given less room than one carrying eight. */
  return over < sheet * 0.55 ? sheets * sheet : wanted;
};

/**
 * Removes the question slots the form printed and nobody used, each with its
 * answer line; the used ones stay as printed.
 */
export function withoutUnasked(xml, used) {
  const para = /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  const all = [...xml.matchAll(para)];
  const said = (p) => [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("").trim();
  const spans = [];
  for (let i = 0; i < all.length; i += 1) {
    const numbered = said(all[i][0]).match(/^Q(\d+):?$/);
    if (!numbered || Number(numbered[1]) <= used) continue;
    /* From the question down to its answer line, blank lines between them
       included: they are the space left to write the answer in. */
    let end = i;
    for (let k = i + 1; k < all.length && k <= i + 6; k += 1) {
      const text = said(all[k][0]);
      if (/^A:?$/.test(text)) { end = k; break; }
      if (text) break;
    }
    spans.push([i, end]);
  }
  if (!spans.length) return xml;
  let out = xml;
  spans.reverse().forEach(([from, to]) => {
    const open = all[from].index;
    const close = all[to].index + all[to][0].length;
    out = out.slice(0, open) + out.slice(close);
  });
  return out;
}

/**
 * Removes the empty paragraphs at the end of the body (a lone page break goes
 * with them), which would otherwise print a trailing blank sheet.
 */
export function trimTail(xml) {
  const end = xml.lastIndexOf("<w:sectPr");
  if (end < 0) return xml;
  const para = /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  const body = xml.slice(0, end);
  const all = [...body.matchAll(para)];
  let cut = end;
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const one = all[i];
    if (/<w:t[ >]/.test(one[0])) break;
    /* Nothing between it and what follows may be text either, or the cut
       would swallow something that is not a paragraph at all. */
    if (xml.slice(one.index + one[0].length, cut).replace(/\s/g, "")) break;
    cut = one.index;
  }
  return cut >= end ? xml : `${xml.slice(0, cut)}${xml.slice(end)}`;
}

/** dd/mm/yy, the way the printed sheet writes a date. */
const shortDate = (iso) => {
  const [y, m, d] = String(iso || "").split("-");
  return y && m && d ? `${d}/${m}/${y.slice(2)}` : "";
};

/**
 * The trip feedback, filled: a grid of eleven criteria with five score cells
 * each, every value written into a table cell addressed by its paragraph.
 */
function fillTrip(xml, doc, content, anchors) {
  const said = (slot, value) => { xml = intoCell(xml, anchors[slot], value); };
  said("assesseeName", doc.crew || "");
  said("assesseeRole", doc.position || "");
  said("worksite", doc.vessel || "");
  said("assessorName", doc.supervisor || "");
  said("assessorRole", doc.supervisorPosition || "");
  said("tripDates", doc.start && doc.end ? `${shortDate(doc.start)} – ${shortDate(doc.end)}` : "");
  said("workscope", doc.workScope || "");

  KEYS.forEach((key, i) => {
    const row = i + 1;
    const mark = content.criteria?.[key];
    if (!mark) return;
    xml = tickScore(xml, anchors, row, mark.score);
    xml = intoCell(xml, anchors[`note${row}`], mark.comment || "");
  });
  if (anchors.note12) xml = intoCell(xml, anchors.note12, "N/A");

  if (content.text) xml = intoCells(xml, anchors.assessorSaid, content.text);
  if (content.own) xml = intoCells(xml, anchors.assesseeSaid, content.own);
  return trimTail(xml);
}

export async function fillForm(kind, doc, content = {}) {
  const zip = unzipSync(await template(kind));
  let xml = strFromU8(zip["word/document.xml"]);
  /* Where each value goes, named by the paragraph rather than by the label
     printed on it. Without a map the labels are read as they always were. */
  const anchors = anchorsFor(kind);
  /* The page of instructions is for whoever is filling the form in, not for
     the file it becomes. */
  xml = withoutGuidance(xml);

  /* A grid, not a page of prose. Nothing below this line applies to it. */
  if (kind === "trip") return pack(zip, fillTrip(xml, doc, content, anchors));

  /* The witness form's reference box is printed as WT00; left unfilled it goes
     out on a competence file saying nothing. */
  if (doc.ref) {
    const boxes = anchors.ref || [];
    if (boxes.length) {
      for (const id of boxes) {
        const para = paraById(xml, id);
        if (para) xml = xml.replace(para, para.replace(/>WT00</g, `>${escape(doc.ref)}<`));
      }
    } else xml = xml.split(">WT00<").join(`>${escape(doc.ref)}<`);
  }

  const who = kind === "witness" ? doc.witness : doc.assessor;
  const role = kind === "witness" ? doc.witnessPosition : doc.assessorPosition;
  const bond = kind === "witness" ? doc.witnessRelationship : doc.assessorRelationship;
  const site = [role, doc.site].filter(Boolean).join(" — ");

  /* Each form names its own lines; the words are the form's, not mine. */
  const named = {
    witness: ["WITNESS", "POSITION &amp; SITE", "NAME FOR WHOM TESTIMONY IS FOR", "RELATIONSHIP WITH CANDIDATE"],
    observation: ["ASSESSOR", "POSITION &amp; SITE", "NAME OF CANDIDATE OBSERVED", "RELATIONSHIP WITH CANDIDATE"],
    knowledge: ["ASSESSOR", "POSITION &amp; SITE", "CANDIDATE QUESTIONED", "RELATIONSHIP WITH CANDIDATE"],
    feedback: ["ASSESSOR", "POSITION &amp; SITE", "CANDIDATE", "RELATIONSHIP WITH CANDIDATE"],
  }[kind];
  /* The longest label first: "RELATIONSHIP WITH CANDIDATE" contains
     "CANDIDATE", and a shorter label would take its line. */
  const SLOTS = ["signer", "position", "candidate", "bond"];
  [...named.keys()]
    .sort((a, b) => named[b].length - named[a].length)
    .forEach((i) => {
      const value = [who, site, doc.candidate, bond][i];
      const id = anchors[SLOTS[i]];
      xml = id ? onAnchor(xml, id, value) : onLine(xml, named[i], value);
    });

  if (kind === "knowledge") {
    const asked = content.questions || [];
    asked.forEach((qa, i) => {
      const q = anchors[`q${i + 1}`];
      const a = anchors[`a${i + 1}`];
      if (q) xml = afterPara(xml, q, qa.q);
      else xml = afterLabel(xml, `Q${i + 1}:`, qa.q);
      if (!qa.a) return;
      if (a) { xml = afterPara(xml, a, qa.a); return; }
      const at = xml.indexOf(`Q${i + 1}:`);
      if (at < 0) return;
      const next = xml.indexOf(">A:", at);
      if (next < 0) return;
      const end = xml.indexOf("</w:p>", next);
      xml = `${xml.slice(0, end)}${run(` ${qa.a}`)}${xml.slice(end)}`;
    });
    /* An unused question slot still holds its height, which can split the
       signatures across two sheets. */
    xml = withoutUnasked(xml, asked.filter((qa) => String(qa?.q || "").trim()).length);
  } else if (kind === "feedback") {
    /* The two boxes differ in size (eleven lines and six), so the boundary is
       the label printed between them. The candidate's box is filled first:
       growing it cannot move the lines above it. */
    const split = anchors.split
      ? slotsBeforePara(xml, anchors.split)
      : slotsBefore(xml, "comments in relation to the CAAP scheme");
    xml = intoBox(xml, content.own, { from: split });
    xml = intoBox(xml, content.text, { from: 0, take: split });
    xml = tick(xml, doc.outcome === "met", anchors);
  } else {
    xml = intoBox(xml, content.text);
  }

  /* The blank line the form leaves under the box is room for a pen on a
     printed blank; on a finished document it is white paper that can tip the
     signatures onto a sheet of their own. */
  xml = tighten(xml);
  /* And the empty paper after the last signature, which is how a sheet with a
     header, a footer and no words gets printed. */
  xml = trimTail(xml);

  return pack(zip, xml);
}

export const CODES = {
  /* The trip form carries no document number of its own — the file has no
     footer at all — so this is the site's assertion and not the paper's.
     Putting one on the page is what the Word editor is for. */
  trip: "NW-CAP-001",
  witness: "NW-CAP-001",
  observation: "NW-CAP-001",
  knowledge: "NW-CAP-001",
  feedback: "NW-CAP-001",
};

/* The CAAP forms are about a candidate; the trip form is about the crew
   member who did the trip. Same question, different word on the paper. */
export const formName = (kind, doc) =>
  `${CODES[kind]} ${(kind === "trip" ? doc.crew : doc.candidate) || "candidate"}.docx`;
