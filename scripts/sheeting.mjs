/**
 * Proves the workbook guard refuses each way the days-at-sea tracker can break.
 * The document guard cannot judge an .xlsx: it finds no word/document.xml, and would otherwise pass it.
 *
 *   node scripts/sheeting.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { COLUMNS, COMPUTED, headingsOf, SHEET, sheetsOf, whyRefuse } from "../src/engine/sheeting.js";
import { FORM_KINDS, FORM_NAMES, isSheet, SHEET_KINDS, extOf } from "../src/engine/formkinds.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FORMS = join(ROOT, "src", "forms");
const fails = [];
const say = (ok, label, got = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${got ? ` — ${got}` : ""}`);
  if (!ok) fails.push(label);
};

const clean = new Uint8Array(readFileSync(join(FORMS, "sed.xlsx")));
const changed = (name, was, now) => {
  const zip = unzipSync(clean);
  const xml = strFromU8(zip[name]);
  if (!xml.includes(was)) throw new Error(`the bench cannot find ${was.slice(0, 40)} in ${name}`);
  zip[name] = strToU8(xml.replace(was, now));
  return zipSync(zip, { level: 6 });
};

say(whyRefuse(clean).length === 0, "the tracker as it is passes",
  `${Object.keys(unzipSync(clean)).length} parts`);
say(Object.keys(sheetsOf(unzipSync(clean))).includes(SHEET), `and the sheet is called “${SHEET}”`,
  Object.keys(sheetsOf(unzipSync(clean))).join(" · "));
say(headingsOf(clean).join("|") === COLUMNS.join("|"), "and carries the eleven headings in order",
  headingsOf(clean).slice(0, 3).join(" · ") + " …");

/* The spelling is the workbook's own. Correcting it here would mean the guard
   refused the very file it exists to protect. */
say(COLUMNS.includes("FORREIGN PORT OF CALL DATE"), "and FORREIGN is spelled the way the workbook spells it");

/* The template was made from a real personal ledger, so every run checks the bytes to prove it was emptied. */
{
  const zip = unzipSync(clean);
  const whole = Object.values(zip).map((p) => strFromU8(p)).join("\n");
  const PERSONAL = [
    "Reyes", "Mercer", "Glen Porter", "CrewRoster",
    "Port Averly", "hollin sound", "Carrow Bay", "Estermouth", "Brindle Point", "Saltmere",
    "Vessa Fjord", "Kelmar Roads", "Tarn Harbour", "Oldwick Quay", "Marrow Head",
    "Quillon", "Westerby", "Norrand", "Pellisk", "osterhaven", "Calder Reach",
    "Dunmere", "Lowmarsh", "Isle of Brannoch", "Ferran Sound", "Harrowgate Deep",
  ];
  const found = PERSONAL.filter((p) => whole.includes(p));
  say(found.length === 0, "and not one place he has been survives in it", found.join(", ") || "none");

  /* Every day he sailed on was a number in A or B. A cell holding anything of
     its own, anywhere but the heading row, is a day that did not get emptied. */
  const kept = [];
  for (const [name, part] of Object.entries(zip)) {
    if (!name.startsWith("xl/worksheets/")) continue;
    for (const m of strFromU8(part).matchAll(/<c\b([^>]*?)>([\s\S]*?)<\/c>/g)) {
      const ref = (m[1].match(/\br="([A-Z]+\d+)"/) || [])[1] || "";
      if (/1$/.test(ref) && !/\d\d1$/.test(ref)) continue;
      if (!/<f\b/.test(m[2]) && /<v>|<is\b/.test(m[2])) kept.push(`${name.split("/").pop()}!${ref}`);
    }
  }
  say(kept.length === 0, "and no row still carries a date or a port", kept.slice(0, 6).join(" ") || "none");

  const formulas = strFromU8(zip[sheetsOf(zip)[SHEET]]).match(/<f\b/g)?.length || 0;
  say(formulas > 3000, "and the formulas are all still in it", `${formulas} of them`);
}

/* The sheet renamed in the editor (one double-click on the tab). */
{
  const broken = changed("xl/workbook.xml", `name="${SHEET}"`, 'name="Days"');
  const [first] = whyRefuse(broken);
  say(first?.code === "sheet", "a sheet renamed is refused", first?.code || "NOT REFUSED");
  say(Boolean(first && first.why.includes(SHEET)), "and the reason says which sheet", first?.why || "");
}

/* A heading typed over: the grid still adds up, but nothing reading it by name finds the column. */
{
  const broken = changed("xl/sharedStrings.xml", "<t>Days Out</t>", "<t>Days At Sea</t>");
  const said = whyRefuse(broken);
  const one = said.find((z) => z.code === "heading");
  say(Boolean(one), "a heading changed is refused", one?.code || "NOT REFUSED");
  say(one?.cell === "C1", "and the reason names the cell", one?.cell || "");
  say(Boolean(one && one.why.includes("Days Out") && one.why.includes("Days At Sea")),
    "and says both what it should say and what it says", one?.why || "");
  say(said.length === 1, "and nothing else is dragged in with it", `${said.length} refusals`);
}

/* A formula typed over with its value: the workbook prints and totals the same, but that row's fail
   date never moves again. */
{
  const broken = changed(
    "xl/worksheets/sheet1.xml",
    '<c r="I5" s="22"><f>IF(B5=0,"*",B5+(2*(F5-G4)))</f></c>',
    '<c r="I5" s="22"><v>41125</v></c>',
  );
  const said = whyRefuse(broken);
  const one = said.find((z) => z.code === "typed");
  say(Boolean(one), "a formula typed over is refused", one?.code || "NOT REFUSED");
  say(one?.cell === "I5", "and the reason names the cell", one?.cell || "");
  say(Boolean(one && one.why.includes("FAIL DATE")),
    "and says which column it was working out", one?.why || "");
  say(said.length === 1, "and nothing else is dragged in with it", `${said.length} refusals`);
}

/* Every computed column, not only the one the bench happens to break. */
{
  const missed = [];
  for (const col of COMPUTED) {
    const zip = unzipSync(clean);
    const name = sheetsOf(zip)[SHEET];
    const xml = strFromU8(zip[name]);
    /* The first cell of this column below the headings that works something
       out. Typed over, wherever it is. */
    const m = new RegExp(`<c r="(${col}\\d+)"([^>]*)><f\\b[^>]*>[\\s\\S]*?</f></c>`).exec(xml);
    if (!m) { missed.push(`${col} has no formula at all`); continue; }
    zip[name] = strToU8(xml.replace(m[0], `<c r="${m[1]}"${m[2]}><v>7</v></c>`));
    const one = whyRefuse(zipSync(zip, { level: 6 })).find((z) => z.code === "typed");
    if (one?.cell !== m[1]) missed.push(`${m[1]} went through`);
  }
  say(missed.length === 0, "and so is every other computed column", missed.join(" · ") || COMPUTED.join(""));
}

/* Not refused: J (port of call) is typed by hand and has no formula in the original, so demanding
   one would refuse every real workbook. */
{
  const zip = unzipSync(clean);
  const name = sheetsOf(zip)[SHEET];
  zip[name] = strToU8(strFromU8(zip[name]).replace(
    '<c r="J5" s="15"/>',
    '<c r="J5" s="15" t="inlineStr"><is><t>Port Averly</t></is></c>',
  ));
  say(whyRefuse(zipSync(zip, { level: 6 })).length === 0,
    "a port typed into the port column is not refused", "J is not a computed column");
  say(!COMPUTED.includes("J"), "and J is deliberately not in the computed list",
    `computed: ${COMPUTED.join("")}`);
}

/* An empty row is a workbook waiting to be filled in, not a broken one. */
say(whyRefuse(changed("xl/worksheets/sheet1.xml", '<c r="C5" s="11"><f>IF(B5=0,"-",B5-A4)</f></c>',
  '<c r="C5" s="11"/>')).length === 0,
  "and a formula simply cleared out leaves a blank cell, not a refusal");

/* Not a workbook at all — dropped into Import by mistake. */
say(whyRefuse(new Uint8Array([1, 2, 3, 4, 5]))[0]?.code === "shape",
  "and something that is not a workbook is said to be not a workbook",
  whyRefuse(new Uint8Array([1, 2, 3, 4, 5]))[0]?.why || "");

/* Why two guards: handed a workbook, the document guard has no anchors to miss and reports it fine,
   even with its formulas torn out. */
{
  const { missingAnchors } = await import("../src/engine/wording.js");
  const torn = changed(
    "xl/worksheets/sheet1.xml",
    '<c r="I5" s="22"><f>IF(B5=0,"*",B5+(2*(F5-G4)))</f></c>',
    '<c r="I5" s="22"><v>41125</v></c>',
  );
  let waved = false;
  try { waved = missingAnchors(torn, {}).length === 0; } catch { waved = false; }
  say(waved, "the document guard waves a broken workbook straight through",
    waved ? "nothing missing, it says" : "it refused or threw");
  say(whyRefuse(torn).length > 0, "and this one does not", whyRefuse(torn)[0]?.cell || "");
}

/* The kind lists are repeated in src/engine/formkinds.js and api/_templates.js (a serverless function
   reaches nothing the browser builds); this stops them drifting. */
{
  const api = readFileSync(join(ROOT, "api", "_templates.js"), "utf8");
  const kinds = JSON.parse((api.match(/export const KINDS = (\[[^\]]*\]);/) || [])[1]
    .replace(/'/g, '"'));
  say(kinds.join("|") === FORM_KINDS.join("|"), "the server knows the same forms the page does",
    kinds.join(" · "));
  const sheets = JSON.parse((api.match(/const SHEETS = (\[[^\]]*\]);/) || [])[1].replace(/'/g, '"'));
  say(sheets.join("|") === SHEET_KINDS.join("|"), "and the same ones are workbooks on both sides",
    sheets.join(" · "));
  const seed = readFileSync(join(ROOT, "scripts", "seed-templates.mjs"), "utf8");
  const seeded = JSON.parse((seed.match(/const KINDS = (\[[^\]]*\]);/) || [])[1].replace(/'/g, '"'));
  say(seeded.join("|") === FORM_KINDS.join("|"), "and version 0 is lodged for every one of them",
    seeded.join(" · "));
  say(FORM_KINDS.every((k) => FORM_NAMES[k]), "and every one of them has a name on the tab",
    FORM_NAMES.sed || "");
  say(isSheet("sed") && extOf("sed") === "xlsx" && !isSheet("witness") && extOf("witness") === "docx",
    "and the tracker is the workbook, the forms are documents");
}

/* The page runs the right guard on the right kind, and asks for a map of the
   printed page only where there is one. A workbook has no drawn page: the
   blanks are where a value lands on a sheet of paper. */
{
  const page = readFileSync(join(ROOT, "src", "pages", "Forms.jsx"), "utf8");
  say(/whyRefuse/.test(page) && /isSheet\(kind\)/.test(page),
    "the page asks the workbook guard for a workbook");
  const body = page.slice(page.indexOf("const publishThese"), page.indexOf("/** A form edited somewhere else"));
  const mapped = body.indexOf("t=map");
  const branch = body.indexOf("if (isSheet(kind))");
  say(branch >= 0 && mapped > branch, "and the map is inside the branch a workbook does not take",
    mapped > branch ? "t=map is only reached by a document" : "t=map runs for everything");
}

console.log(fails.length ? `\n${fails.length} FAILED` : "\nthe tracker cannot be published broken");
process.exit(fails.length ? 1 : 0);
