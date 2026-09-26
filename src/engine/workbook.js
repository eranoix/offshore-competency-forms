/**
 * The ledger written out as a workbook that still calculates: his own column
 * names, and live formulas with this module's values cached beside them, so it
 * reads right in a non-calculating viewer and Excel recalculates on load
 * (`fullCalcOnLoad`). Entries get one fixed timestamp so the same ledger packs
 * to the same bytes. Dates are Excel serials: days since 1899-12-30.
 */
import { zipSync, strToU8 } from "fflate";
import { dayOf, runLedger } from "./seatax.js";

/* The day-zero Excel counts from: 1899-12-30, as a UTC day number. */
const EXCEL_EPOCH = dayOf("1899-12-30");
const serialOf = (iso) => dayOf(iso) - EXCEL_EPOCH;

/* His own headings, in his own order and his own spelling. */
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

const esc = (t) =>
  String(t ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/* The cell styles, by the index they take in cellXfs below. */
const S = { plain: 0, date: 1, whole: 2, tenth: 3, head: 4 };

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/**
 * One cell.
 *
 * `f` is the formula without its leading `=`, `v` the value to cache beside
 * it. A string result is typed `str`, which is what Excel writes for a formula
 * that came out as text; a number carries no type at all, which is the default.
 */
function cell(ref, { s = S.plain, f = null, v = null, shared = null } = {}) {
  const text = typeof v === "string";
  const type = shared != null ? ' t="s"' : (f && text ? ' t="str"' : "");
  const body = `${f ? `<f>${esc(f)}</f>` : ""}${
    shared != null ? `<v>${shared}</v>` : v == null ? "" : `<v>${text ? esc(v) : v}</v>`
  }`;
  if (!body) return `<c r="${ref}" s="${s}"/>`;
  return `<c r="${ref}" s="${s}"${type}>${body}</c>`;
}

/**
 * The workbook. `spare` is how many empty pairs of rows go under the last trip
 * with formulas in place, so a trip is added by typing two dates.
 */
export function seataxWorkbook(absences = [], { name = "SEATAX DAYS", spare = 120 } = {}) {
  const led = runLedger(absences);
  const rows = led.rows;

  /* Shared strings, in the order they are first wanted. */
  const strings = [];
  const seen = new Map();
  const shared = (text) => {
    const key = String(text ?? "");
    if (!seen.has(key)) {
      seen.set(key, strings.length);
      strings.push(key);
    }
    return seen.get(key);
  };

  const lastRow = 1 + (rows.length + spare) * 2;
  const xml = [];

  /* Row 1: the headings, and the sum of the days-out column off to the side,
     which is the one number his sheet keeps outside the grid. */
  xml.push(`<row r="1" ht="38.25" customHeight="1">`);
  COLUMNS.forEach((title, i) => {
    xml.push(cell(`${String.fromCharCode(65 + i)}1`, { s: S.head, shared: shared(title) }));
  });
  xml.push(cell("L1", { s: S.whole, f: `SUM(C3:C${lastRow})`, v: led.outDays }));
  xml.push("</row>");

  /* Each absence is two rows: the one he left on and the one he came back on.
     The formulas are his, cell for cell, so that a reader with both files open
     can put a finger on the same cell in each. */
  for (let i = 0; i < rows.length + spare; i += 1) {
    const r = rows[i] || null;
    const leave = 2 + i * 2;
    const back = leave + 1;
    const first = i === 0;

    const L = [`<row r="${leave}">`];
    L.push(cell(`A${leave}`, { s: S.date, v: r?.left ? serialOf(r.left) : null }));
    if (!first) {
      /* Days in: from the day he landed last time to the day he left this. */
      L.push(cell(`D${leave}`, {
        s: S.whole,
        f: `IF(A${leave}=0,"-",A${leave}-B${leave - 1})`,
        v: r?.daysIn ?? "-",
      }));
      L.push(cell(`E${leave}`, {
        s: S.whole,
        f: `IF(A${leave}=0,"-",E${leave - 1}+D${leave}+C${leave})`,
        v: r?.totalAtLeaving ?? "-",
      }));
      /* The running UK total, which is the number every test below is against. */
      L.push(cell(`G${leave}`, {
        s: S.whole,
        f: `IF(A${leave}=0,"-",D${leave}+G${leave - 2})`,
        v: r?.ukTotal ?? "-",
      }));
    }
    if (r?.port) L.push(cell(`J${leave}`, { s: S.plain, shared: shared(r.port) }));
    L.push("</row>");
    xml.push(L.join(""));

    const B = [`<row r="${back}">`];
    B.push(cell(`B${back}`, { s: S.date, v: r?.back ? serialOf(r.back) : null }));
    B.push(cell(`C${back}`, {
      s: S.whole,
      f: `IF(B${back}=0,"-",B${back}-A${leave})`,
      v: r?.daysOut ?? "-",
    }));
    B.push(cell(`E${back}`, {
      s: S.whole,
      f: `IF(B${back}=0,"-",E${leave}+D${back}+C${back})`,
      v: r?.total ?? "-",
    }));
    B.push(cell(`F${back}`, {
      s: S.tenth,
      f: `IF(B${back}=0,"-",E${back}*0.5)`,
      v: r?.half ?? "-",
    }));
    /* The test itself, and it is strictly greater than: a margin of exactly
       nought still passes. */
    B.push(cell(`H${back}`, {
      s: S.plain,
      f: `IF(B${back}=0,"-",IF(G${leave}>F${back},"YES","NO"))`,
      v: r && r.failed != null ? (r.failed ? "YES" : "NO") : "-",
    }));
    /* The date in the diary. The ×2 is here: the margin is in half-days and
       the days he may stay are twice it, which is why the formula doubles. */
    B.push(cell(`I${back}`, {
      s: S.date,
      f: `IF(B${back}=0,"*",B${back}+(2*(F${back}-G${leave})))`,
      v: r?.failOn ? serialOf(r.failOn) : "*",
    }));
    /* DAYS IN HAND, in half-days — shown to a decimal place, because his own
       sheet formats this column as a whole number and a margin of 36.5 has
       been reading as 37 in it for years. */
    B.push(cell(`K${back}`, {
      s: S.tenth,
      f: `IF(B${back}=0,"*",F${back}-G${leave})`,
      v: r?.marginHalfDays ?? "*",
    }));
    B.push("</row>");
    xml.push(B.join(""));
  }

  const sheet = `${HEAD}<worksheet xmlns="${NS}"><dimension ref="A1:L${lastRow}"/>`
    + `<sheetViews><sheetView tabSelected="1" workbookViewId="0">`
    + `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>`
    + `<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>`
    + `<sheetFormatPr defaultRowHeight="12.75"/>`
    + `<cols>`
    + `<col min="1" max="2" width="11.5" customWidth="1"/>`
    + `<col min="3" max="8" width="10" customWidth="1"/>`
    + `<col min="9" max="9" width="11.5" customWidth="1"/>`
    + `<col min="10" max="10" width="28" customWidth="1"/>`
    + `<col min="11" max="12" width="11.5" customWidth="1"/>`
    + `</cols>`
    + `<sheetData>${xml.join("")}</sheetData>`
    + `<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>`
    + `</worksheet>`;

  const sst = `${HEAD}<sst xmlns="${NS}" count="${strings.length}" uniqueCount="${strings.length}">`
    + strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")
    + `</sst>`;

  const workbook = `${HEAD}<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<fileVersion appName="xl"/><workbookPr/>`
    + `<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="14000"/></bookViews>`
    + `<sheets><sheet name="${esc(name)}" sheetId="1" r:id="rId1"/></sheets>`
    /* Recalculate the lot on the way in: the cached numbers are this module's
       and Excel gets the last word on them. */
    + `<calcPr calcId="0" fullCalcOnLoad="1"/></workbook>`;

  const styles = `${HEAD}<styleSheet xmlns="${NS}">`
    + `<numFmts count="2"><numFmt numFmtId="164" formatCode="d-mmm-yy"/><numFmt numFmtId="165" formatCode="#,##0.0"/></numFmts>`
    + `<fonts count="2">`
    + `<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>`
    + `<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>`
    + `</fonts>`
    + `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>`
    + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="5">`
    + `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
    + `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`
    + `<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`
    + `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`
    + `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">`
    + `<alignment horizontal="center" vertical="center" wrapText="1"/></xf>`
    + `</cellXfs>`
    + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`
    + `<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2"/></styleSheet>`;

  const types = `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
    + `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>`
    + `</Types>`;

  const rels = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
    + `</Relationships>`;

  const bookRels = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`
    + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`
    + `</Relationships>`;

  return pack({
    "[Content_Types].xml": types,
    "_rels/.rels": rels,
    "xl/workbook.xml": workbook,
    "xl/_rels/workbook.xml.rels": bookRels,
    "xl/worksheets/sheet1.xml": sheet,
    "xl/styles.xml": styles,
    "xl/sharedStrings.xml": sst,
  });
}

/* The day the claim started, used as every entry's timestamp so that the same
   ledger always packs to the same bytes. */
const STAMP = new Date(Date.UTC(2012, 3, 24));

function pack(parts) {
  const stamped = {};
  for (const [name, text] of Object.entries(parts)) stamped[name] = [strToU8(text), { mtime: STAMP }];
  return zipSync(stamped, { level: 6 });
}
