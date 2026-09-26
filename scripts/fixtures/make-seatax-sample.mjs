/**
 * Builds the days-at-sea book that scripts/seatax.mjs holds the ledger to: a
 * made-up ledger written by the engine as a workbook, then recalculated by
 * LibreOffice with every cached answer dropped, so its numbers are Calc's and
 * not the engine's.
 *
 *   node scripts/fixtures/make-seatax-sample.mjs
 *
 * Needs `soffice`. The output is committed; run this only to change the book.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { dayOf, isoOf, runLedger } from "../../src/engine/seatax.js";
import { seataxWorkbook } from "../../src/engine/workbook.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SAMPLE = join(HERE, "days-at-sea-sample.xlsx");

const PORTS = [
  "Bergen, Norway", "Esbjerg, Denmark", "Den Helder, Netherlands", "Stavanger, norway",
  "Port-Gentil, Gabon", "Walvis Bay, Namibia", "Takoradi, Ghana", "Las Palmas, Spain",
  "Valletta, Malta", "Mindelo, Cape Verde", "Cuxhaven, Germany",
];
/* Six that read as British — the test flags them without refusing them. */
const BRITISH = { 5: "lerwick, uk", 23: "Great Yarmouth", 41: "Montrose", 59: "Lerwick, Shetland",
  77: "Blyth, UK", 90: "great yarmouth" };

export function sampleLedger() {
  const out = [];
  let day = dayOf("2013-06-03");
  for (let i = 0; i < 100; i += 1) {
    const away = 17 + ((i * 7) % 15);
    const home = 12 + ((i * 11) % 17);
    const left = day;
    const back = left + away;
    const port = BRITISH[i] ?? (i % 9 === 4 ? "" : PORTS[(i * 3) % PORTS.length]);
    out.push({ left: isoOf(left), back: isoOf(back), port });
    day = back + home;
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ledger = sampleLedger();
  const led = runLedger(ledger);
  if (led.failed || led.problems?.length) throw new Error("the sample ledger should be a clean, passing one");

  const zip = unzipSync(seataxWorkbook(ledger));
  for (const name of Object.keys(zip).filter((n) => n.startsWith("xl/worksheets/"))) {
    /* No cached answer survives: whatever comes back was computed by Calc. */
    zip[name] = strToU8(strFromU8(zip[name]).replace(/(<f>[^<]*<\/f>)<v>[^<]*<\/v>/g, "$1"));
  }
  const dir = mkdtempSync(join(tmpdir(), "seatax-sample-"));
  try {
    mkdirSync(join(dir, "profile", "user"), { recursive: true });
    writeFileSync(join(dir, "profile", "user", "registrymodifications.xcu"),
      `<?xml version="1.0" encoding="UTF-8"?>\n<oor:items xmlns:oor="http://openoffice.org/2001/registry" ` +
      `xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
      `<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse">` +
      `<value>0</value></prop></item>\n</oor:items>\n`);
    writeFileSync(join(dir, "book.xlsx"), zipSync(zip, { level: 6 }));
    execFileSync("soffice", [`-env:UserInstallation=file://${join(dir, "profile")}`, "--headless", "--norestore",
      "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "book.xlsx")],
    { stdio: "ignore", timeout: 120_000 });
    writeFileSync(SAMPLE, readFileSync(join(dir, "out", "book.xlsx")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`-> ${SAMPLE}  (${ledger.length} absences, ${ledger[0].left} to ${ledger.at(-1).back})`);
}
