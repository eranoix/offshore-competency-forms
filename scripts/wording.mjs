/**
 * Reading a form's words, and changing one. Word splits a paragraph's text
 * across runs, so reading and writing work on the flattened paragraph.
 *
 *   node scripts/wording.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { addPara, dropPara, freshId, missingAnchors, reword, whyKeep, wordsOf } from "../src/engine/wording.js";
import { ANCHORS } from "../src/forms/anchors.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FORMS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "forms");
const fails = [];
const say = (ok, label, got = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${got ? ` — ${got}` : ""}`);
  if (!ok) fails.push(label);
};

for (const kind of ["witness", "observation", "knowledge", "feedback"]) {
  const bytes = new Uint8Array(readFileSync(join(FORMS, `${kind}.docx`)));
  const said = wordsOf(bytes, ANCHORS[kind]);
  say(said.length > 10, `${kind}: its words are readable`, `${said.length} lines`);

  /* Every anchored slot shows up as one, so the page can say "this is where
     the witness's name goes" instead of leaving it to be guessed. */
  const slots = Object.keys(ANCHORS[kind] || {});
  const shown = new Set(said.filter((x) => x.slot).map((x) => x.slot));
  say(slots.every((s) => shown.has(s)), `${kind}: and every place a value goes is marked as one`,
    [...shown].join(" ") || "none");

  /* Word splits a label across runs; the reading must not. */
  const label = said.find((x) => x.slot === "signer");
  say(Boolean(label && /:/.test(label.text)), `${kind}: a label split across runs still reads whole`,
    label?.text.slice(0, 40) || "(not found)");

  /* Changing one line changes that line and nothing else. */
  const target = said.find((x) => x.slot === "signer");
  const { bytes: after, touched } = reword(bytes, { [target.id]: "SIGNED OFF BY:" });
  say(touched === 1, `${kind}: one line changed is one line changed`, `${touched}`);
  const now = wordsOf(after, ANCHORS[kind]);
  say(now.find((x) => x.id === target.id)?.text === "SIGNED OFF BY:", `${kind}: and it reads back as written`,
    now.find((x) => x.id === target.id)?.text || "");
  const moved = now.filter((x) => x.id !== target.id && x.text !== said.find((y) => y.id === x.id)?.text);
  say(moved.length === 0, `${kind}: and no other line moved`, moved.map((x) => x.text.slice(0, 20)).join(" · "));
  /* The document is still a document: same parts, same count. */
  const was = Object.keys(unzipSync(bytes));
  const has = Object.keys(unzipSync(after));
  say(was.length === has.length && was.every((n) => has.includes(n)),
    `${kind}: and the file still carries every part it did`, `${has.length} parts`);
  /* And the same number of paragraphs: nothing here adds or removes one, which
     is what lets the anchors hold. */
  const count = (b) => (strFromU8(unzipSync(b)["word/document.xml"]).match(/<w:p[ >]/g) || []).length;
  say(count(bytes) === count(after), `${kind}: and the same paragraphs`, `${count(after)}`);
}

/* A form that came back from Word without a line a value goes on: the fill
 * finds places by paragraph id, so this must be caught before publishing.
 */
{
  const bytes = new Uint8Array(readFileSync(join(FORMS, "witness.docx")));
  say(missingAnchors(bytes, ANCHORS.witness).length === 0, "an untouched form is missing nothing");
  /* The paragraph the witness's name goes on, taken out the way Word would. */
  const zip = unzipSync(bytes);
  const xml = strFromU8(zip["word/document.xml"]);
  const id = ANCHORS.witness.signer;
  const at = xml.indexOf(`w14:paraId="${id}"`);
  const open = xml.lastIndexOf("<w:p ", at);
  const close = xml.indexOf("</w:p>", at) + 6;
  zip["word/document.xml"] = strToU8(xml.slice(0, open) + xml.slice(close));
  const cut = zipSync(zip, { level: 6 });
  const gone = missingAnchors(cut, ANCHORS.witness);
  say(gone.length === 1 && gone[0] === "signer", "and one with a line deleted says which line", gone.join(" ") || "nothing");
}

/* An anchor on a deliberately EMPTY paragraph (every blank of a grid form)
 * must not be reported missing; `wordsOf` skips empty paragraphs, so the guard
 * cannot rely on it.
 */
{
  const bytes = new Uint8Array(readFileSync(join(FORMS, "witness.docx")));
  const zip = unzipSync(bytes);
  const xml = strFromU8(zip["word/document.xml"]);
  const hollow = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
    .filter((m) => !/<w:t[ >]/.test(m[0]))
    .map((m) => (m[0].match(/w14:paraId="([0-9A-Fa-f]+)"/) || [])[1])
    .filter(Boolean);
  say(hollow.length > 0, "a form has paragraphs with nothing written in them", `${hollow.length} of them`);
  const named = { blank: hollow[0] };
  say(wordsOf(bytes, named).every((l) => l.id !== hollow[0]),
    "and the reading of its words passes them over, as it always has");
  say(missingAnchors(bytes, named).length === 0,
    "but a value that goes on an empty line is NOT called missing", missingAnchors(bytes, named).join(" "));
  /* And it is still missing when it is actually gone. */
  const at = xml.indexOf(`w14:paraId="${hollow[0]}"`);
  const open = xml.lastIndexOf("<w:p ", at);
  const close = xml.indexOf("</w:p>", at) + 6;
  zip["word/document.xml"] = strToU8(xml.slice(0, open) + xml.slice(close));
  say(missingAnchors(zipSync(zip, { level: 6 }), named).join(" ") === "blank",
    "and it IS missing once the line is taken out");
}

/* The guidance heading, and the sentence that merely points at it.
 *
 * The filled document is cut from the heading down, read case-insensitively.
 * Three CAAP forms also say "(please see reverse for guidance notes)" near the
 * top; reading that as the heading would cut the whole form away.
 */
for (const kind of ["observation", "knowledge"]) {
  const bytes = new Uint8Array(readFileSync(join(FORMS, `${kind}.docx`)));
  const said = wordsOf(bytes, ANCHORS[kind]);
  const points = said.find((l) => /guidance notes/i.test(l.text) && !/^GUIDANCE NOTES\b/i.test(l.text));
  const heads = said.find((l) => /^GUIDANCE NOTES\b/i.test(l.text));
  say(Boolean(points && heads), `${kind}: the form both points at the guidance page and heads it`);
  say(!whyKeep(bytes, points.id, ANCHORS[kind]).some((h) => h.code === "guidance"),
    `${kind}: the sentence that points at it is not taken for the heading`, points.text.slice(0, 44));
  say(whyKeep(bytes, heads.id, ANCHORS[kind]).some((h) => h.code === "guidance"),
    `${kind}: and the heading is`, heads.text.slice(0, 44));
}

/* A paragraph nobody named is left alone, and an unknown one is not invented. */
const bytes = new Uint8Array(readFileSync(join(FORMS, "witness.docx")));
const { touched } = reword(bytes, { DEADBEEF: "nowhere" });
say(touched === 0, "a paragraph the form does not have changes nothing", String(touched));

/* Adding and removing lines: removing a line a value goes on must be
   refused, or the form goes out with it blank. */
console.log("\nand a line can be added and taken out");

for (const kind of ["witness", "observation", "knowledge", "feedback"]) {
  const was = new Uint8Array(readFileSync(join(FORMS, `${kind}.docx`)));
  const said = wordsOf(was, ANCHORS[kind]);
  const boxes = (xml) => (xml.match(/<w:pBdr>/g) || []).length;
  const bodyOf = (b) => strFromU8(unzipSync(b)["word/document.xml"]);

  /* Somewhere safe to add: a line that carries nothing. */
  const plain = said.find((l) => !l.slot && !l.rule && !whyKeep(was, l.id, ANCHORS[kind]).length);
  const grown = addPara(was, plain.id, "A LINE THAT WAS NOT THERE");
  const after = wordsOf(grown.bytes, ANCHORS[kind]);
  say(Boolean(grown.id) && after.length === said.length + 1,
    `${kind}: a line added is one line more`, `${after.length}, was ${said.length}`);
  say(after.find((l) => l.id === grown.id)?.text === "A LINE THAT WAS NOT THERE",
    `${kind}: and it says what it was given`);
  say(missingAnchors(grown.bytes, ANCHORS[kind]).length === 0,
    `${kind}: and no line a value goes on was lost`);
  /* A cloned border would be counted as one more box to write a statement
     into, which on the feedback form moves the candidate's own words into the
     assessor's box. */
  say(boxes(bodyOf(grown.bytes)) === boxes(bodyOf(was)),
    `${kind}: and the boxes the statement goes in are untouched`,
    `${boxes(bodyOf(grown.bytes))}`);
  const others = said.filter((l) => l.id !== plain.id);
  const now = new Map(after.map((l) => [l.id, l.text]));
  say(others.every((l) => now.get(l.id) === l.text), `${kind}: and no other line moved`);

  /* Every line a value goes on refuses to be taken out, and says why. */
  const slots = Object.values(ANCHORS[kind]).flat();
  const kept = slots.map((id) => dropPara(was, id, ANCHORS[kind]));
  say(kept.every((k) => k.removed === 0 && k.held.some((h) => h.hard)),
    `${kind}: no line a value goes on can be taken out`, `${slots.length} of them`);
  say(kept.every((k) => k.held.every((h) => h.why && h.why.length > 10)),
    `${kind}: and each refusal says which line and why`,
    kept[0].held[0].why.slice(0, 44));

  /* So do the boxes the statement is written into. */
  const body = bodyOf(was);
  const bordered = [...body.matchAll(/<w:p\b[^>]*w14:paraId="([0-9A-Fa-f]{8})"[^>]*>(?:(?!<\/w:p>)[\s\S])*?<w:pBdr>/g)].map((m) => m[1]);
  say(bordered.length > 0 && bordered.every((id) => dropPara(was, id, ANCHORS[kind]).removed === 0),
    `${kind}: nor can the box the statement is written into`, `${bordered.length} of them`);

  /* And a line that carries nothing comes out cleanly. */
  const cut = dropPara(was, plain.id, ANCHORS[kind]);
  say(cut.removed === 1 && wordsOf(cut.bytes, ANCHORS[kind]).length === said.length - 1,
    `${kind}: a line that carries nothing comes out`, plain.text.slice(0, 34));
  say(missingAnchors(cut.bytes, ANCHORS[kind]).length === 0,
    `${kind}: with every line a value goes on still there`);
}

/* The reference box of the witness form is a drawing, and a drawing keeps two
   copies of the same paragraph under the same name. Writing by name always
   lands on the first, so the two would quietly disagree. Nothing here touches
   it. */
{
  const was = new Uint8Array(readFileSync(join(FORMS, "witness.docx")));
  const held = whyKeep(was, "49B8709B", ANCHORS.witness);
  say(held.some((h) => h.code === "inside" && h.hard), "a line inside a drawing is refused",
    held.map((h) => h.code).join(", "));
  say(addPara(was, "49B8709B", "x").id === "", "and nothing can be added beside it");
}

/* A name nobody is using, every time. */
{
  const zip = unzipSync(new Uint8Array(readFileSync(join(FORMS, "feedback.docx"))));
  const used = new Set();
  for (const [name, data] of Object.entries(zip)) {
    if (!name.endsWith(".xml")) continue;
    for (const m of strFromU8(data).matchAll(/w14:paraId="([0-9A-Fa-f]{8})"/g)) used.add(m[1].toUpperCase());
  }
  const made = new Set();
  let clash = 0;
  for (let n = 0; n < 2000; n += 1) {
    const id = freshId(zip);
    if (used.has(id) || made.has(id)) clash += 1;
    made.add(id);
  }
  say(clash === 0, "a new line's name is one no part of the file is using", `${made.size} drawn, ${used.size} taken`);
}

/* The drawing's cache signature must include the form version, not only the
   values, or a newly published form keeps showing the old picture. */
{
  const src = readFileSync(join(ROOT, "src", "components", "caap", "Paper.jsx"), "utf8");
  const from = src.indexOf("export const formSignature");
  const sig = src.slice(from, src.indexOf("]);", from));
  say(/heldAbout\(kind\)\?\.version/.test(sig),
    "the drawing is kept under which form it is, not only what it says",
    sig.includes("version") ? "the version is in the signature" : "ONLY the values");

  const forms = readFileSync(join(ROOT, "src", "engine", "forms.js"), "utf8");
  say(/export async function catchUpAgain/.test(forms),
    "and a browser can be told to ask again without being reloaded");
  const page = readFileSync(join(ROOT, "src", "pages", "Forms.jsx"), "utf8");
  say(/catchUpAgain\(\)/.test(page),
    "which is what publishing does, so whoever changed it sees it changed");
}

console.log(fails.length ? `\n${fails.length} FAILED` : "\nthe words can be read and changed without the file moving under them");
process.exit(fails.length ? 1 : 0);
