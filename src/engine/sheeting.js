/**
 * The guard for workbook forms. The document guard checks paragraph anchors,
 * which a workbook does not have, so it passes everything. The quiet failure
 * here is a formula typed over with a number, which freezes that row for every
 * later copy, so a computed cell with a value and no formula is refused by name.
 */
import { unzipSync, strFromU8 } from "fflate";

/** The sheet the tracker runs on. Everything below is asked of that one. */
export const SHEET = "SEATAX DAYS";

/**
 * The eleven headings, in the order they sit across the top — A to K.
 *
 * FORREIGN is spelled the way the workbook spells it. It is the company's own
 * file and its own word; correcting it here would mean the guard refused the
 * very template it is guarding.
 */
export const COLUMNS = [
  "Day Left UK",
  "Day Return UK",
  "Days Out",
  "Days In",
  "Total Days",
  "Half Days",
  "Running Days In UK",
  "YES / NO",
  "FAIL DATE",
  "FORREIGN PORT OF CALL DATE",
  "DAYS IN HAND",
];

/**
 * The columns that work themselves out.
 *
 * C to K, less J: the port of call is typed in by hand like the two dates
 * beside it, and demanding a formula there would refuse every workbook there
 * has ever been. Measured on the company's own file: C, D, E, F, G, H, I and K
 * carry a formula in every row that carries anything at all, and J carries
 * sixty-six pieces of text and not one formula.
 */
export const COMPUTED = ["C", "D", "E", "F", "G", "H", "I", "K"];

const LETTERS = "ABCDEFGHIJK".split("");
const un = (s) =>
  String(s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const CELL = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
const at = (attrs, name) => (attrs.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1] || "";

const nameOf = (attrs) => {
  const ref = at(attrs, "r");
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  return m ? { ref, col: m[1], row: Number(m[2]) } : { ref, col: "", row: 0 };
};

/* Whatever the workbook keeps its text in. A string can live in the shared
   table, inline in the cell, or as the answer a formula last gave. */
function said(inner, strings) {
  const kind = inner.type;
  if (kind === "s") {
    const v = (inner.body.match(/<v>([^<]*)<\/v>/) || [])[1];
    return strings[Number(v)] ?? "";
  }
  if (kind === "inlineStr") {
    return [...inner.body.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => un(m[1])).join("");
  }
  return un((inner.body.match(/<v>([^<]*)<\/v>/) || [])[1] || "");
}

/** The shared string table, in order, or nothing if there is not one. */
function stringsOf(zip) {
  const part = zip["xl/sharedStrings.xml"];
  if (!part) return [];
  const xml = strFromU8(part);
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => un(t[1])).join(""),
  );
}

/**
 * Which part of the file holds which sheet.
 *
 * The name a person sees is in the workbook; the file it is kept in is behind
 * a relationship id. Nothing may assume sheet1.xml — a sheet added, removed or
 * reordered in the editor renumbers them, and a guard reading the wrong part
 * is a guard reading somebody else's grid.
 */
export function sheetsOf(zip) {
  const book = zip["xl/workbook.xml"];
  const rels = zip["xl/_rels/workbook.xml.rels"];
  if (!book || !rels) return {};
  const where = {};
  for (const m of strFromU8(rels).matchAll(/<Relationship\b([^>]*)\/>/g)) {
    where[at(m[1], "Id")] = at(m[1], "Target").replace(/^\/?xl\//, "").replace(/^\//, "");
  }
  const out = {};
  for (const m of strFromU8(book).matchAll(/<sheet\b([^>]*?)\/>/g)) {
    const id = at(m[1], "r:id") || at(m[1], "id");
    const part = where[id];
    if (part) out[un(at(m[1], "name"))] = `xl/${part}`;
  }
  return out;
}

/** Every cell of a sheet that holds anything, by name. */
function cellsOf(xml, strings) {
  const out = new Map();
  for (const m of xml.matchAll(CELL)) {
    const attrs = m[1];
    const body = m[2] || "";
    const { ref, col, row } = nameOf(attrs);
    if (!col) continue;
    out.set(ref, {
      ref,
      col,
      row,
      /* A formula, whether it carries its own text or shares a neighbour's. */
      formula: /<f\b/.test(body),
      /* Something in it that is not a formula's answer. */
      holds: /<v>|<is\b/.test(body),
      text: said({ type: at(attrs, "t"), body }, strings),
    });
  }
  return out;
}

/** The eleven headings as this workbook actually has them, A to K. */
export function headingsOf(bytes) {
  const zip = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const part = sheetsOf(zip)[SHEET];
  if (!part || !zip[part]) return [];
  const cells = cellsOf(strFromU8(zip[part]), stringsOf(zip));
  return LETTERS.map((c) => cells.get(`${c}1`)?.text.trim() || "");
}

/**
 * Why this workbook cannot go in front of everybody, as readable sentences
 * (same shape as `whyKeep` in wording.js). An empty list means nothing is wrong.
 */
export function whyRefuse(bytes) {
  let zip;
  try {
    zip = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  } catch {
    return [{ code: "shape", cell: "", why: "that file is not a workbook at all" }];
  }
  const part = sheetsOf(zip)[SHEET];
  if (!part || !zip[part]) {
    return [{
      code: "sheet",
      cell: "",
      why: `the sheet called “${SHEET}” is not in this workbook any more, and every day counted is on it`,
    }];
  }

  const strings = stringsOf(zip);
  const cells = cellsOf(strFromU8(zip[part]), strings);
  const out = [];

  /* The headings, in their order. The eleven are what anybody reading the
     tracker reads across the top, and they are how a column is known. */
  LETTERS.forEach((col, i) => {
    const want = COLUMNS[i];
    const got = cells.get(`${col}1`)?.text.trim() || "";
    if (got === want) return;
    out.push({
      code: "heading",
      cell: `${col}1`,
      why: got
        ? `${col}1, the heading over the ${col} column, should say “${want}” and says “${got}” — the columns are known by their names`
        : `${col}1 is empty, and it is the heading “${want}” — the columns are known by their names`,
    });
  });

  /* The quiet one. A computed cell that holds something of its own has had its
     formula typed over, and from that row on it never works anything out
     again. */
  for (const cell of cells.values()) {
    if (cell.row < 2) continue;
    if (!COMPUTED.includes(cell.col)) continue;
    if (cell.formula || !cell.holds) continue;
    const heading = COLUMNS[LETTERS.indexOf(cell.col)] || cell.col;
    out.push({
      code: "typed",
      cell: cell.ref,
      why: `${cell.ref} has “${String(cell.text).slice(0, 24)}” typed into it, and ${cell.ref} is where “${heading}” works itself out`
        + " — typed over, it is that answer for ever, and nothing would say so",
    });
  }

  return out;
}
