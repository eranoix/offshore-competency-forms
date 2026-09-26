/**
 * Checks the half-day test against a spreadsheet's own arithmetic: the ledger is
 * compared row by row with scripts/fixtures/days-at-sea-sample.xlsx, whose answers
 * LibreOffice recalculated from the sheet's formulas (see make-seatax-sample.mjs).
 *
 *   node scripts/seatax.mjs
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import { SEATAX, dayOf, isoOf, looksBritish, mustLeaveBy, runLedger, standing, stayOutFor } from "../src/engine/seatax.js";
import { COLUMNS, seataxWorkbook } from "../src/engine/workbook.js";

const fails = [];
const say = (ok, label, got = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${got ? ` — ${got}` : ""}`);
  if (!ok) fails.push(label);
};

const HIS = process.env.SEATAX_BOOK ||
  fileURLToPath(new URL("./fixtures/days-at-sea-sample.xlsx", import.meta.url));
const SHEET = "SEATAX DAYS";
const RENDER = process.env.SEATAX_RENDER || `http://127.0.0.1:${process.env.DOCX_PORT || 8791}/render`;

const unesc = (t) =>
  String(t)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, "&");

/** Every cell of one named sheet, by reference, with its formula and its value. */
function read(bytes, wanted) {
  const zip = unzipSync(bytes);
  const sstXml = zip["xl/sharedStrings.xml"] ? strFromU8(zip["xl/sharedStrings.xml"]) : "";
  const strings = [...sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unesc(t[1])).join(""));

  const book = strFromU8(zip["xl/workbook.xml"]);
  const rels = strFromU8(zip["xl/_rels/workbook.xml.rels"]);
  const tag = [...book.matchAll(/<sheet\b[^>]*?\/>/g)].find((m) => m[0].includes(`name="${wanted}"`));
  if (!tag) throw new Error(`no sheet called ${wanted}`);
  const rid = /r:id="([^"]+)"/.exec(tag[0])[1];
  const target = new RegExp(`Id="${rid}"[^>]*?Target="([^"]+)"`).exec(rels)[1];
  const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  const xml = strFromU8(zip[path]);

  const cells = new Map();
  const each = /<c\s([^>]*?)\/>|<c\s([^>]*?)>([\s\S]*?)<\/c>/g;
  for (const m of xml.matchAll(each)) {
    const attrs = m[1] ?? m[2];
    const body = m[3] ?? "";
    const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
    if (!ref) continue;
    const t = /t="([^"]+)"/.exec(attrs)?.[1] || "n";
    const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1];
    const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
    const v = raw == null ? null
      : t === "s" ? strings[+raw]
      : t === "str" || t === "inlineStr" ? unesc(raw)
      : Number(raw);
    cells.set(ref, { t, f: f == null ? null : unesc(f), v });
  }
  return { cells, strings, zip, xml, parts: Object.keys(zip).sort() };
}

/* 1899-12-30, because in 1985 a spreadsheet decided 1900 was a leap year and
   every spreadsheet since has had to agree with it. */
const EPOCH = dayOf("1899-12-30");
const fromSerial = (n) => (typeof n === "number" ? isoOf(Math.round(n) + EPOCH) : null);

if (!existsSync(HIS)) {
  console.log(`FAIL  the sample workbook is not at ${HIS}`);
  process.exit(1);
}

const his = read(readFileSync(HIS), SHEET);
const at = (ref) => his.cells.get(ref) ?? { v: null, f: null };

/* The grid is two rows to an absence: the one he left on and the one he came
   back on. Read down until the leaving dates run out. */
const ledgerFromHis = [];
const sheetSays = [];
for (let leave = 2; ; leave += 2) {
  const a = at(`A${leave}`).v;
  const b = at(`B${leave + 1}`).v;
  if (typeof a !== "number") break;
  ledgerFromHis.push({
    left: fromSerial(a),
    back: typeof b === "number" ? fromSerial(b) : null,
    port: typeof at(`J${leave}`).v === "string" ? at(`J${leave}`).v : "",
  });
  sheetSays.push({
    row: leave + 1,
    daysOut: at(`C${leave + 1}`).v,
    daysIn: at(`D${leave}`).v,
    total: at(`E${leave + 1}`).v,
    half: at(`F${leave + 1}`).v,
    ukTotal: at(`G${leave}`).v ?? 0,
    flag: at(`H${leave + 1}`).v,
    failDate: fromSerial(at(`I${leave + 1}`).v),
    inHand: at(`K${leave + 1}`).v,
  });
}

/* Asked for by the parent below, to prove the answer does not depend on where
   the reader is sitting. Printed and nothing else. */
if (process.env.SEATAX_UNDER_TZ) {
  process.stdout.write(JSON.stringify(runLedger(ledgerFromHis)));
  process.exit(0);
}

const led = runLedger(ledgerFromHis);

say(ledgerFromHis.length === 100, "the book holds a hundred absences", `${ledgerFromHis.length}`);
say(led.claimStart === "2013-06-03", "and the claim starts the day of the first leaving", led.claimStart);
say(ledgerFromHis[0].port === "Bergen, Norway" && ledgerFromHis[0].back === "2013-06-20",
  "the first one sailed for Bergen and came back on the 20th of June 2013",
  `${ledgerFromHis[0].left} → ${ledgerFromHis[0].back}`);

/* Row for row, every column that carries a number, against what Calc worked
   out from the formulas. The first row has no days in: nothing came before it. */
const off = [];
led.rows.forEach((r, i) => {
  const s = sheetSays[i];
  const wrong = [];
  if (r.daysOut !== s.daysOut) wrong.push(`days out ${r.daysOut} v ${s.daysOut}`);
  if (i > 0 && r.daysIn !== s.daysIn) wrong.push(`days in ${r.daysIn} v ${s.daysIn}`);
  if (r.total !== s.total) wrong.push(`total ${r.total} v ${s.total}`);
  if (r.half !== s.half) wrong.push(`half ${r.half} v ${s.half}`);
  if (r.ukTotal !== s.ukTotal) wrong.push(`uk ${r.ukTotal} v ${s.ukTotal}`);
  if (r.failOn !== s.failDate) wrong.push(`fail date ${r.failOn} v ${s.failDate}`);
  if (s.flag && (r.failed ? "YES" : "NO") !== s.flag) wrong.push(`flag ${r.failed} v ${s.flag}`);
  if (r.marginHalfDays !== s.inHand) wrong.push(`in hand ${r.marginHalfDays} v ${s.inHand}`);
  if (wrong.length) off.push(`row ${s.row}: ${wrong.join(", ")}`);
});
say(off.length === 0, "every row of the book comes back out of the ledger unchanged",
  off.length ? off.slice(0, 5).join(" | ") : `${led.rows.length} rows, ${led.rows.length * 8} numbers`);
say(sheetSays.every((s) => typeof s.total === "number" && typeof s.inHand === "number"),
  "and every one of them is a number the spreadsheet worked out, not a blank");

const last = sheetSays[sheetSays.length - 1];
const lastLeave = 2 * sheetSays.length;
say(led.totalDays === last.total && led.totalDays === 4390,
  "after the last return, on the 10th of June 2025, the period is 4390 days", `${led.totalDays} v ${last.total}`);
say(led.half === last.half && led.half === 2195, "half of it is 2195", `${led.half}`);
say(led.marginHalfDays === last.inHand && led.marginHalfDays === 210, "there are 210 half-days in hand",
  `${led.marginHalfDays}`);
say(led.failOn === last.failDate && led.failOn === "2026-08-04",
  "and the claim breaks after the 4th of August 2026", led.failOn);
say(led.outDays === at("L1").v && led.outDays === 2405, "out of the country 2405 days, the sum beside the grid",
  `${led.outDays} v ${at("L1").v}`);
say(led.ukDays === at(`G${lastLeave}`).v && led.ukDays + led.outDays === led.totalDays,
  "and in it the rest, which is the whole period and nothing left over",
  `${led.ukDays} + ${led.outDays} = ${led.ukDays + led.outDays}`);
say(led.failed === false && led.rows.every((r) => r.failed === false),
  "the test never once fails on this book", led.rows.filter((r) => r.failed).length ? "it has" : "not in twelve years");
say(led.qualifies && led.shortBy === 0, "and the period is long enough to be a claim at all",
  `${led.totalDays} days against ${SEATAX.MIN_PERIOD}`);
say(mustLeaveBy(ledgerFromHis) === led.failOn, "the date in the diary is the last day one can still be here",
  mustLeaveBy(ledgerFromHis));

/* Standing on the day of any return has to give back that return's row, or the
   two halves of this module disagree about the same arithmetic. */
const disagree = led.rows.filter((r) => {
  const s = standing(ledgerFromHis, r.back);
  return s.total !== r.total || s.ukDays !== r.ukTotal || s.half !== r.half
    || s.marginHalfDays !== r.marginHalfDays || s.failOn !== r.failOn || s.failed !== r.failed;
});
say(disagree.length === 0, "and standing on the day of a return gives back that return's row",
  disagree.length ? `${disagree.length} disagree` : `${led.rows.length} rows both ways`);

const lastBack = led.rows[led.rows.length - 1].back;
say(led.daysHeCanStay === led.marginHalfDays * 2, "the days he may stay are twice the margin",
  `${led.marginHalfDays} half-days, ${led.daysHeCanStay} mornings`);
say(led.failOn === isoOf(dayOf(lastBack) + led.daysHeCanStay),
  "and the fail date is that many days after he landed",
  `${lastBack} + ${led.daysHeCanStay} = ${led.failOn}`);

const onTheDay = standing(ledgerFromHis, led.failOn);
const dayAfter = standing(ledgerFromHis, isoOf(dayOf(led.failOn) + 1));
say(onTheDay.failed === false && onTheDay.marginHalfDays === 0,
  "staying exactly that many days leaves him with nothing in hand and the claim intact",
  `${onTheDay.on}: ${onTheDay.ukDays} in the UK against a half of ${onTheDay.half}`);
say(dayAfter.failed === true,
  "and one more morning takes it", `${dayAfter.on}: ${dayAfter.ukDays} against ${dayAfter.half}`);
/* The trap itself: had the margin been read as days rather than half-days, he
   would have flown out 36 days too early and never known. */
const asIfDays = standing(ledgerFromHis, isoOf(dayOf(lastBack) + Math.floor(led.marginHalfDays)));
say(asIfDays.failed === false
  && asIfDays.marginHalfDays === led.marginHalfDays - Math.floor(led.marginHalfDays) * SEATAX.PER_DAY_OUT
  && asIfDays.marginHalfDays > 0,
  "reading the margin as days would have put him on a plane with half of it unspent",
  `${Math.floor(led.marginHalfDays)} days flown of ${led.daysHeCanStay} owed, ${asIfDays.marginHalfDays} half-days left on the table`);

const outFor = (days) => runLedger([
  ...ledgerFromHis,
  { left: lastBack, back: isoOf(dayOf(lastBack) + days), port: "Esbjerg, Denmark" },
]).marginHalfDays;

const halves = [1, 2, 3, 7, 28, 100].every((d) => outFor(d) === led.marginHalfDays + d * SEATAX.PER_DAY_OUT);
say(halves, "a day out of the country buys exactly half a day of margin, every time",
  `1 day → ${outFor(1)}, 28 days → ${outFor(28)}`);

const wants = [36.5, 100, 210, 210.5, 250, 365];
const inverse = wants.every((w) => {
  const days = stayOutFor(ledgerFromHis, w);
  return days === Math.max(0, (w - led.marginHalfDays) * SEATAX.DAYS_PER_HALF_DAY) && outFor(days) === Math.max(led.marginHalfDays, w);
});
say(inverse, "and asking for a margin back gives the days out that reach it exactly, and no more",
  wants.map((w) => `${w}→${stayOutFor(ledgerFromHis, w)}d`).join(" · "));
say(stayOutFor(ledgerFromHis, 10) === 0 && stayOutFor(ledgerFromHis, led.marginHalfDays) === 0,
  "a margin already in hand costs nothing");

const me = fileURLToPath(import.meta.url);
const under = (tz) => execFileSync(process.execPath, [me], {
  env: { ...process.env, TZ: tz, SEATAX_UNDER_TZ: "1" }, maxBuffer: 64 * 1024 * 1024,
}).toString();
const here = under("America/Sao_Paulo");
const there = under("Europe/London");
const far = under("Pacific/Auckland");
say(here === there && there === far, "the same ledger in São Paulo, London and Auckland",
  here === far ? `identical, ${here.length} bytes` : "they differ");
say(JSON.parse(here).failOn === last.failDate, "and the fail date is that date in all three", JSON.parse(far).failOn);

const young = runLedger([
  { left: "2025-01-10", back: "2025-02-01", port: "Bergen, Norway" },
  { left: "2025-03-01", back: "2025-04-01", port: "Bergen, Norway" },
]);
say(young.qualifies === false && young.shortBy === SEATAX.MIN_PERIOD - young.totalDays,
  "a period under a year is reported as not yet a claim, not quietly passed",
  `${young.totalDays} days, ${young.shortBy} short of ${SEATAX.MIN_PERIOD}`);
say(young.failed === false && young.rows.length === 2 && young.rows[1].total === 81,
  "and it is still counted, because it will be a claim one day", `${young.rows[1].total} days`);

const british = led.portWarnings.filter((w) => w.why === "reads as a British port");
const blank = led.portWarnings.filter((w) => w.why === "no port written down");
say(british.some((w) => w.port === "lerwick, uk"), "the absence that opened at lerwick, uk is flagged",
  british.map((w) => w.port).join(" · "));
say(british.length === 6, "along with the five other British-looking ports in the book",
  `${british.length}: ${[...new Set(british.map((w) => w.port))].join(" · ")}`);
const flagged = british[0].n - 1;
say(led.rows[flagged].total === sheetSays[flagged].total && led.rows[flagged].failOn === sheetSays[flagged].failDate,
  "and it is flagged and not rejected — the row is counted exactly as the sheet counts it",
  `${led.rows[flagged].total} days, fails ${led.rows[flagged].failOn}`);
say(blank.length === 11, "the absences with no port at all are named too", `${blank.length} of them`);
say(looksBritish("Stavanger, norway") === false && looksBritish("Port-Gentil, Gabon") === false
  && looksBritish("Fraserburgh") === true,
  "and a foreign port is not flagged for the letters in its name");

const book = seataxWorkbook(ledgerFromHis);
say(book[0] === 0x50 && book[1] === 0x4b, "the bytes start PK, which is what a zip starts with",
  `${String.fromCharCode(book[0], book[1])}, ${book.length} bytes`);

const mine = read(book, SHEET);
const WANTED = [
  "[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml",
  "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml",
];
say(JSON.stringify(mine.parts) === JSON.stringify(WANTED), "and it unzips to the seven parts Excel insists on",
  mine.parts.join(" · "));
say(strFromU8(mine.zip["xl/workbook.xml"]).includes(`name="${SHEET}"`), "the sheet is called SEATAX DAYS");

const header = COLUMNS.map((_, i) => mine.cells.get(`${String.fromCharCode(65 + i)}1`)?.v);
say(JSON.stringify(header) === JSON.stringify(COLUMNS), "the eleven headings are the book's, in its order and its spelling",
  header.join(" · "));
say(header[9] === "FORREIGN PORT OF CALL DATE", "FORREIGN with two Rs, as the original book spells it", header[9]);

const computed = ["C", "E", "F", "H", "I", "K"].map((c) => mine.cells.get(`${c}201`));
say(computed.every((c) => c && c.f), "the computed cells carry formulas and not just answers",
  computed.map((c) => c.f?.slice(0, 18)).join(" | "));
say(mine.cells.get("I201").f === 'IF(B201=0,"*",B201+(2*(F201-G200)))',
  "and the fail date is the ×2 written out, so adding a row in Excel moves it by itself",
  mine.cells.get("I201").f);
say(mine.cells.get("F201").f === 'IF(B201=0,"-",E201*0.5)' && mine.cells.get("C201").f === 'IF(B201=0,"-",B201-A200)',
  "with the half and the days out in the shapes the book itself uses");

/* A value with no formula beside it is a number that will not move when
   somebody edits the sheet — which is the whole failure this file exists to avoid. */
const stuck = [...mine.cells.entries()].filter(([ref, c]) => {
  const col = ref.replace(/\d+/g, "");
  const row = +ref.replace(/\D+/g, "");
  return row > 1 && "CDEFGHIK".includes(col) && c.v != null && !c.f;
});
say(stuck.length === 0, "no computed cell in the grid is a dead number", stuck.slice(0, 4).map(([r]) => r).join(" "));

say(["C201", "E201", "F201", "K201", "I201", "H201"].every((r) => mine.cells.get(r).v === at(r).v)
  && fromSerial(mine.cells.get("I201").v) === led.failOn,
  "the answers cached beside the formulas are the ones the spreadsheet works out",
  `${mine.cells.get("E201").v} / ${mine.cells.get("F201").v} / ${mine.cells.get("K201").v} / ${fromSerial(mine.cells.get("I201").v)}`);
say(mine.cells.get("L1").v === at("L1").v && mine.cells.get("L1").f?.startsWith("SUM(C3:C"),
  "and the days-out total is the sum kept beside the grid", mine.cells.get("L1").f);

say(strFromU8(mine.zip["xl/workbook.xml"]).includes('fullCalcOnLoad="1"'),
  "Excel is told to work the lot out again on the way in, so the cached answers get the last word");

const spare = ["D202", "E202", "G202", "C203", "F203", "I203", "K203"].map((r) => mine.cells.get(r));
say(spare.every((c) => c && c.f && (c.v === "-" || c.v === "*")),
  "the next trip has its formulas waiting for it — two dates typed in and the fail date moves",
  `${spare[5].f} → ${spare[5].v}`);

/* The engine's key from the environment (scripts/with-engine.mjs sets it for
   a local engine). */
const key = process.env.DOCX_KEY || "";
let pdf = null;
let status = 0;
try {
  const res = await fetch(RENDER, {
    method: "POST",
    headers: {
      "x-docx-key": key,
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    body: book,
  });
  status = res.status;
  if (res.ok) pdf = Buffer.from(await res.arrayBuffer());
} catch (err) {
  status = `did not answer: ${err.message}`;
}
say(status === 200, "the render service takes a workbook we wrote ourselves", `HTTP ${status}`);
const pages = pdf ? (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length : 0;
say(Boolean(pdf) && pdf.subarray(0, 5).toString() === "%PDF-" && pages >= 1,
  "and gives back a PDF with pages in it", pdf ? `${pages} page(s), ${pdf.length} bytes` : "nothing came back");

const sum = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);
const twice = seataxWorkbook(ledgerFromHis);
say(sum(book) === sum(twice), "the same ledger packed twice is the same file to the byte", sum(book));
say(sum(seataxWorkbook(ledgerFromHis.slice(0, 99))) !== sum(book),
  "and one trip fewer is a different one, so it is not the same file by accident");

console.log(fails.length
  ? `\n${fails.length} FAILED:\n- ${fails.join("\n- ")}`
  : "\nthe sample book comes back out of this exactly as the spreadsheet works it out, and it still calculates");
process.exit(fails.length ? 1 : 0);
