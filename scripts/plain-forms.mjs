/**
 * Takes the dotted write-on lines and the gap under the title off the blank
 * forms. Signature lines keep their dots (still signed by hand) and are told apart
 * because they always carry a word. The templates themselves are edited because
 * the map of the blanks is generated from them.
 *
 *     node scripts/plain-forms.mjs && node scripts/blank-pages.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

const FORMS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "forms");
const PARA = /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
const said = (p) => [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");

/** A paragraph that is nothing but the dots: a line to write on, under a line
 *  that is already written. */
const onlyDots = (p) => {
  const text = said(p);
  return Boolean(text.trim()) && /^[….\s]+$/.test(text);
};

/**
 * Takes the witness form's own header lines (number, subject, date) off, so it
 * looks like the other three forms. The band is anchored in the date's paragraph,
 * so the date's runs go and the paragraph stays.
 */
function plainHeader(zip) {
  const name = Object.keys(zip).find((n) => /^word\/header\d*\.xml$/.test(n) &&
    strFromU8(zip[n]).includes("itness Testimony"));
  if (!name) return 0;
  let top = strFromU8(zip[name]);
  const paras = [...top.matchAll(PARA)];
  const gone = [];
  for (const m of paras) {
    const text = said(m[0]).trim();
    if (/^Witness Testimony \d+$/.test(text) || text === "Description") gone.push(m);
  }
  /* From the end backwards, so every position stays valid. */
  gone.reverse().forEach((m) => { top = top.slice(0, m.index) + top.slice(m.index + m[0].length); });
  /* And the date, run by run, out of the paragraph the band is anchored in. */
  const dated = top.replace(/<w:r\b(?:(?!<\/w:r>)[\s\S])*?<w:t[^>]*>[0-9/]{1,4}<\/w:t>[\s\S]*?<\/w:r>/g, "");
  const cut = gone.length + (dated === top ? 0 : 1);
  zip[name] = strToU8(dated);
  return cut;
}

for (const kind of ["witness", "observation", "knowledge", "feedback"]) {
  const file = join(FORMS, `${kind}.docx`);
  const zip = unzipSync(new Uint8Array(readFileSync(file)));
  const header = plainHeader(zip);
  let xml = strFromU8(zip["word/document.xml"]);
  const paras = [...xml.matchAll(PARA)];

  /* Every empty line in the heading — above the title, between the title's own
     lines, and under it. The heading ends at the note in brackets, which is the
     last thing before the form starts asking for anything.
     A paragraph that carries a drawing is never empty however little it says:
     the company band is anchored inside one, and taking it would take the band. */
  const note = paras.findIndex((m) => /^\(Block Capitals/i.test(said(m[0]).trim()));
  const cut = new Set();
  paras.forEach((m, i) => {
    if (onlyDots(m[0])) cut.add(i);
    if (note >= 0 && i < note && !said(m[0]).trim() && !/<w:drawing|<mc:AlternateContent|<w:pict/.test(m[0]))
      cut.add(i);
  });
  if (!cut.size && !header) { console.log(`${kind.padEnd(12)} nothing to take off`); continue; }

  /* From the end backwards, so every position stays valid. */
  [...cut].sort((a, b) => b - a).forEach((i) => {
    xml = xml.slice(0, paras[i].index) + xml.slice(paras[i].index + paras[i][0].length);
  });
  zip["word/document.xml"] = strToU8(xml);
  writeFileSync(file, Buffer.from(zipSync(zip, { level: 6 })));
  const dots = [...cut].filter((i) => onlyDots(paras[i][0])).length;
  console.log(`${kind.padEnd(12)} ${dots} dotted line(s), ${cut.size - dots} blank line(s) under the title` +
    (header ? `, ${header} line(s) out of the header` : ""));
}
console.log("\nnow: node scripts/blank-pages.mjs");
