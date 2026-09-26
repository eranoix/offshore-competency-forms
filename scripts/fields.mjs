const __REPO = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/\/$/, "");
/**
 * Fills each form with unmistakable values and reads the .docx back: a value
 * that is not in the document did not arrive.
 *
 *   node scripts/fields.mjs
 */
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { boxesDrawn } from "../src/engine/boxes.js";

const ROOT = `${__REPO}`;
const bundle = "/tmp/fields-engine.mjs";
await build({
  entryPoints: [`${ROOT}/src/engine/docx.js`],
  bundle: true, format: "esm", outfile: bundle, platform: "node", logLevel: "error",
  define: { __OFFLINE__: "false" },
  plugins: [{ name: "forms", setup(b) {
    b.onResolve({ filter: /\.docx\?url$/ }, (a) => ({
      path: join(ROOT, "src/forms", a.path.split("/").pop().replace("?url", "")), namespace: "form",
    }));
    b.onLoad({ filter: /.*/, namespace: "form" }, (a) => ({
      contents: `export default ${JSON.stringify(`file://${a.path}`)};`, loader: "js",
    }));
  } }],
});
/* The generator is bundled rather than imported: it reaches for "./memory"
   without an extension, which Vite resolves and raw Node does not. The
   criteria must come from the same list the page uses. */
const genBundle = "/tmp/fields-generator.mjs";
await build({
  entryPoints: [`${ROOT}/src/engine/generator.js`],
  bundle: true, format: "esm", outfile: genBundle, platform: "node", logLevel: "error",
  define: { __OFFLINE__: "false" },
});
const { KEYS: TRIP_KEYS, LABEL: TRIP_LABEL } = await import(genBundle);

const plainFetch = globalThis.fetch;
/* A way to hand the engine a form that is not the one on disk, so a template
   somebody has edited can be filled in here without editing the repository. */
let meddle = null;
globalThis.fetch = async (url, opts) => {
  const address = String(url);
  if (!address.startsWith("file://")) return plainFetch(url, opts);
  const b = await readFile(address.replace("file://", ""));
  const bytes = meddle ? meddle(address, b) : b;
  return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};
const { askFor, fillForm } = await import(bundle);

/* Values are also read back off the page rendered by the real layout engine:
   a value can sit in the XML and still not be printed. */
const RENDER = process.env.DOCX_UPSTREAM || `http://127.0.0.1:${process.env.DOCX_PORT || 8791}/render`;
const RKEY = process.env.DOCX_KEY || "";
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
let pageCount = 0;
async function painted(bytes) {
  if (!RKEY) return null;
  const res = await plainFetch(RENDER, { method: "POST",
    headers: { "content-type": "application/octet-stream", "x-docx-key": RKEY }, body: bytes });
  if (!res.ok) return null;
  const file = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
  pageCount = file.numPages;
  let out = "";
  for (let n = 1; n <= file.numPages; n += 1) {
    const page = await file.getPage(n);
    const text = await page.getTextContent();
    out += ` ${text.items.map((i) => i.str).join(" ")}`;
  }
  return out.replace(/\s+/g, " ");
}

const fails = [];
const say = (ok, label, got = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${got ? ` — ${got}` : ""}`);
  if (!ok) fails.push(label);
};

const DOC = {
  level: "ROV Pilot Technician",
  discipline: "ROV Pilot Technician",
  candidate: "Zebediah Quicksilver",
  site: "Vessel Thunderbird",
  reviewDate: "2026-02-27",
  dated: "27/02/26",
  outcome: "met",
  task: "Marmalade winch overhaul",
  witness: "Ophelia Wrenfield",
  witnessPosition: "Sub Engineer",
  witnessRelationship: "Colleague",
  assessor: "Cornelius Battersby",
  assessorPosition: "ROV Superintendent",
  assessorRelationship: "Supervisor",
  /* The trip form asks the same questions under its own words. Values that
     could not be anything else, so a value found in the file was put there. */
  crew: "Bartholomew Quillfeather",
  position: "ROV Pilot Technician",
  vessel: "Vessel Nightjar",
  supervisor: "Persimmon Halloway",
  supervisorPosition: "ROV Supervisor",
  start: "2026-03-04",
  end: "2026-03-31",
  workScope: "Marzipan flexlay campaign",
};

/* One score per criterion and all of them different where they can be, so a
   grid read one column left, or one row down, cannot pass. Each comment names
   its own row for the same reason. */
const SCORES = [1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1];
const TRIP_CRITERIA = Object.fromEntries(TRIP_KEYS.map((k, i) => [k, {
  score: SCORES[i],
  comment: `Row ${i + 1} of the grid, which is ${TRIP_LABEL[k]}.`,
}]));
const STATEMENT = "Peppercorn evidence: the candidate stripped the winch and proved it fit for service.";
const OWN = "Tangerine remarks: I did the work described and I am satisfied with the record.";
const QUESTIONS = [
  { q: "Saffron question about the isolation procedure?", a: "Juniper answer describing the isolation." },
  { q: "Cardamom question about the hazards?", a: "Coriander answer describing the controls." },
];

const WANT = {
  witness: {
    was: 2,
    ref: "WT03",
    must: [
      ["the witness's name", DOC.witness],
      ["the witness's position", DOC.witnessPosition],
      ["the site", DOC.site],
      ["the candidate", DOC.candidate],
      ["the relationship", DOC.witnessRelationship],
      ["the statement", "Peppercorn evidence"],
      ["its own reference", "WT03"],
    ],
  },
  observation: {
    was: 3,
    ref: "OT02",
    must: [
      ["the assessor's name", DOC.assessor],
      ["the assessor's position", DOC.assessorPosition],
      ["the site", DOC.site],
      ["the candidate", DOC.candidate],
      ["the relationship", DOC.assessorRelationship],
      ["the statement", "Peppercorn evidence"],
    ],
  },
  knowledge: {
    was: 3,
    ref: "QU01",
    must: [
      ["the assessor's name", DOC.assessor],
      ["the assessor's position", DOC.assessorPosition],
      ["the site", DOC.site],
      ["the candidate", DOC.candidate],
      ["the relationship", DOC.assessorRelationship],
      ["the first question", "Saffron question"],
      ["the first answer", "Juniper answer"],
      ["the second question", "Cardamom question"],
      ["the second answer", "Coriander answer"],
    ],
  },
  trip: {
    /* Three, not two: on this form the guidance shares the last page with the
       signatures, so removing it saves no page; the test is that a filled trip
       form does not grow to a third page. */
    was: 3,
    ref: "",
    must: [
      ["the crew member", DOC.crew],
      ["their job title", DOC.position],
      ["the vessel", DOC.vessel],
      ["the supervisor", DOC.supervisor],
      ["the supervisor's title", DOC.supervisorPosition],
      ["the work scope", DOC.workScope],
      ["the supervisor's words", "Peppercorn evidence"],
      ["the crew member's own words", "Tangerine remarks"],
    ],
  },
  feedback: {
    was: 4,
    ref: "FB01",
    must: [
      ["the assessor's name", DOC.assessor],
      ["the assessor's position", DOC.assessorPosition],
      ["the site", DOC.site],
      ["the candidate", DOC.candidate],
      ["the relationship", DOC.assessorRelationship],
      ["the assessor's words", "Peppercorn evidence"],
      ["the candidate's own words", "Tangerine remarks"],
    ],
  },
};

/* The whole file as one run of words: the engine splits a sentence across runs
   whenever Word feels like it, so the tags come out before anything is looked
   for. */
const wordsIn = (bytes) => {
  const zip = unzipSync(new Uint8Array(bytes));
  return Object.keys(zip)
    .filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n))
    .map((n) => strFromU8(zip[n]))
    .join(" ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&#39;/g, "'")
    .replace(/\s+/g, " ");
};

/* Read a paragraph at a time, runs joined, as the engine reads a heading: the
   flat text would also match "(please see reverse for guidance notes)" in the body. */
const headingsIn = (bytes) => {
  const zip = unzipSync(new Uint8Array(bytes));
  const xml = strFromU8(zip["word/document.xml"]);
  return [...xml.matchAll(/<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
    .map((m) => [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join("").trim());
};

/**
 * The grid, read as a grid: a flat text search finds an "x" whichever column
 * it is in, so this walks the rows and cells and asserts the shape.
 */
function gridOf(bytes) {
  const zip = unzipSync(new Uint8Array(bytes));
  const xml = strFromU8(zip["word/document.xml"]);
  const flat = (bit) => [...bit.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("").trim();
  const rowsOf = (tbl) => [...tbl.matchAll(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g)].map((m) => m[0]);
  const cellsOf = (tr) => [...tr.matchAll(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g)].map((m) => flat(m[0]));

  const tables = [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map((m) => m[0]);
  /* Found by its first row, never by position: a table added above it would
     silently move the answer. */
  const grid = tables.find((t) => {
    const head = cellsOf(rowsOf(t)[0] || "");
    return head[0] === "Criteria" && head[6] === "Comments";
  });
  if (!grid) { say(false, "trip: the criteria grid could not be found in the file"); return; }

  const rows = rowsOf(grid).slice(1).map(cellsOf);
  say(rows.length === 12, "trip: the grid has all twelve rows", `${rows.length}`);

  let right = 0, only = 0, notes = 0;
  TRIP_KEYS.forEach((key, i) => {
    const row = rows[i] || [];
    const marked = [1, 2, 3, 4, 5].filter((c) => (row[c] || "").trim());
    if (marked.length === 1) only += 1;
    if (marked[0] === SCORES[i]) right += 1;
    if ((row[6] || "").includes(`Row ${i + 1} of the grid`)) notes += 1;
  });
  say(only === TRIP_KEYS.length, "trip: exactly one mark on every row", `${only} of ${TRIP_KEYS.length}`);
  say(right === TRIP_KEYS.length, "trip: and it is in the column the score asked for",
    right === TRIP_KEYS.length ? SCORES.join("") : `${right} of ${TRIP_KEYS.length} — ` +
      TRIP_KEYS.map((k, i) => `${i + 1}:${[1,2,3,4,5].filter((c) => (rows[i]?.[c] || "").trim()).join("|") || "-"}`).join(" "));
  say(notes === TRIP_KEYS.length, "trip: and each comment is on its own row, not the one above",
    `${notes} of ${TRIP_KEYS.length}`);

  const last = rows[11] || [];
  say(![1, 2, 3, 4, 5].some((c) => (last[c] || "").trim()) && (last[6] || "").includes("N/A"),
    "trip: the row nothing is written about says so rather than sitting blank",
    `${last[0] || "?"} — ${last[6] || "(empty)"}`);
}

for (const [kind, want] of Object.entries(WANT)) {
  console.log(`\n${kind}`);
  const bytes = await fillForm(
    kind,
    { ...DOC, ref: want.ref },
    { text: STATEMENT, own: OWN, questions: QUESTIONS, criteria: TRIP_CRITERIA },
  ).catch((e) => {
    say(false, `${kind}: the form could not be filled`, e.message);
    return null;
  });
  if (!bytes) continue;
  const words = wordsIn(bytes);
  const shown = await painted(bytes);
  for (const [what, value] of want.must) {
    say(words.includes(value), `${kind} carries ${what}`, words.includes(value) ? "" : `“${value}” is not in the file`);
    if (shown !== null) {
      /* The engine breaks a line wherever it likes, so the words are looked
         for without the spaces between them. */
      const flat = (t) => t.replace(/\s+/g, "").toLowerCase();
      say(flat(shown).includes(flat(value)), `${kind} prints ${what} on the page`,
        flat(shown).includes(flat(value)) ? "" : `“${value}” is in the file but not on the page`);
    }
  }
  /* The guidance heading in either spelling: the CAAP forms write GUIDANCE
     NOTES FOR, the trip form writes `Guidance Notes;`. */
  const preached = headingsIn(bytes).filter((line) => /^GUIDANCE NOTES\b/i.test(line));
  say(preached.length === 0, `${kind}: the guidance notes are off the back`,
    preached.join(" · ").slice(0, 60));
  say(/SIGNATURE/i.test(words), `${kind}: and the signatures that follow them are still there`);
  if (kind === "trip") gridOf(bytes);
  if (shown === null) say(false, `${kind}: the page could not be laid out — nothing was read off it`);
  /* Compared with the blank form's length, not an exact page count: what
     matters is that the guidance page is gone and nothing else went with it. */
  else say(pageCount < want.was, `${kind}: ${pageCount} page${pageCount === 1 ? "" : "s"} instead of ${want.was}`,
    pageCount >= want.was ? "no page was saved" : "");
}

/* A statement that fits on the page must not tip onto a second one carrying
   nothing but a signature line. */
if (RKEY) {
  console.log("\nand what fits stays on one page");
  const long = (n) =>
    Array.from({ length: n }, (_, i) =>
      `On the MV Northstar I worked alongside the candidate on the six-monthly maintenance of the launch and ` +
      `recovery system, paragraph ${i + 1}. He stripped and inspected the sheave assembly, checked the wire ` +
      `for birdcaging, re-tensioned the tether and recorded every finding in the maintenance log.`,
    ).join("\n\n");
  for (const [kind, paras, want] of [["witness", 5, 1], ["observation", 2, 1], ["feedback", 4, 3]]) {
    const bytes = await fillForm(kind, { ...DOC, ref: WANT[kind].ref },
      { text: long(paras), own: OWN, questions: QUESTIONS });
    await painted(bytes);
    say(pageCount === want, `${kind}: ${paras} paragraphs still come to ${want} page${want === 1 ? "" : "s"}`,
      pageCount === want ? "" : `${pageCount} pages`);
  }
}

/* A renamed label still gets its value: the place is named by the paragraph's
 * w14:paraId, which Word writes itself and which survives editing its text.
 * This renames every label on a form and fills it in anyway.
 */
if (RKEY) {
  console.log("\nand a renamed label does not lose the value");
  const RENAMED = [
    ["WITNESS", "SIGNED OFF BY"],
    ["POSITION &amp; SITE", "RANK AND SHIP"],
    ["NAME FOR WHOM TESTIMONY IS FOR", "WHO THIS IS ABOUT"],
    ["RELATIONSHIP WITH CANDIDATE", "HOW THEY KNOW HIM"],
  ];
  meddle = (address, bytes) => {
    if (!address.endsWith("witness.docx")) return bytes;
    const zip = unzipSync(new Uint8Array(bytes));
    let xml = strFromU8(zip["word/document.xml"]);
    /* Word splits a label across runs, so the paragraph is found by its
       flattened text (as the engine does) and the new wording goes into the
       first run with the rest emptied. */
    const paras = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)];
    for (const [was, now] of RENAMED) {
      const plain = was.replace(/&amp;/g, "&").toUpperCase();
      const found = paras.find((m) =>
        [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join("")
          .replace(/&amp;/g, "&").toUpperCase().includes(`${plain}:`));
      if (!found) continue;
      let first = true;
      xml = xml.replace(found[0], found[0].replace(/<w:t[^>]*>[^<]*<\/w:t>/g, () => {
        if (!first) return "<w:t></w:t>";
        first = false;
        return `<w:t xml:space="preserve">${now}: </w:t>`;
      }));
    }
    zip["word/document.xml"] = strToU8(xml);
    return Buffer.from(zipSync(zip, { level: 6 }));
  };
  /* The engine keeps the template it first fetched, so a fresh copy of it is
     loaded to fetch the edited one. */
  const fresh = await import(`${bundle}?edited=${Date.now()}`);
  const bytes = await fresh.fillForm("witness", { ...DOC, ref: "WT01" }, { text: STATEMENT });
  meddle = null;
  const page = await painted(bytes);
  for (const [was, now] of RENAMED) {
    say(page.includes(now), `the form says "${now}" where it said "${was.replace("&amp;", "&")}"`);
  }
  for (const [what, value] of [["the witness", DOC.witness], ["the candidate", DOC.candidate],
    ["the position", DOC.witnessPosition], ["the relationship", DOC.witnessRelationship]]) {
    say(page.includes(value), `and ${what} is still printed on it`, value);
  }
}

/* The outcome is ticked against the right sentence, for both "met" and "not
 * yet met": the "not yet met" words are split across runs in the form, so both
 * are filled and the mark is read off the rendered page against its sentence.
 */
if (RKEY) {
  console.log("\nand the outcome is ticked against the right sentence");
  for (const [outcome, wanted] of [["met", "has met"], ["not-yet", "has not yet"]]) {
    const bytes = await fillForm("feedback", { ...DOC, ref: "FB01", outcome },
      { text: STATEMENT, own: OWN, questions: QUESTIONS });
    const res = await plainFetch(RENDER, { method: "POST",
      headers: { "content-type": "application/octet-stream", "x-docx-key": RKEY }, body: bytes });
    const file = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
    const marked = [];
    for (let n = 1; n <= file.numPages; n += 1) {
      const page = await file.getPage(n);
      const lines = new Map();
      for (const item of (await page.getTextContent()).items) {
        if (!item.str.trim()) continue;
        const at = Math.round(item.transform[5]);
        lines.set(at, (lines.get(at) || "") + item.str);
      }
      /* The sentence wraps, and the mark sits at the start of it: the words
         that say WHICH sentence it is fall on the line below. So the reading
         runs on past the mark rather than stopping at the end of its line. */
      const down = [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, line]) => line);
      down.forEach((line, i) => {
        if (!/^X/.test(line.trim())) return;
        marked.push(down.slice(i, i + 3).join(" ").replace(/\s+/g, " ").trim());
      });
    }
    say(marked.length === 1, `${outcome}: one sentence is ticked, and only one`,
      marked.length ? `${marked.length} ticked` : "NOTHING is ticked");
    say(marked.length === 1 && marked[0].includes(wanted), `${outcome}: and it is the right one`,
      marked[0] ? `…${marked[0].slice(60, 124)}…` : "");
  }
}

/* Filled by the panel, a value sits on its label's own line, so the dotted
 * lines for handwriting under it must go; signature lines keep theirs.
 */
if (RKEY) {
  console.log("\nand the form is plain where it is already filled in");
  for (const kind of ["witness", "observation", "knowledge", "feedback"]) {
    const bytes = await fillForm(kind, { ...DOC, ref: WANT[kind].ref },
      { text: STATEMENT, own: OWN, questions: QUESTIONS });
    const res = await plainFetch(RENDER, { method: "POST",
      headers: { "content-type": "application/octet-stream", "x-docx-key": RKEY }, body: bytes });
    const file = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
    /* A line of the page is everything printed at the same height. */
    const lines = new Map();
    for (let n = 1; n <= file.numPages; n += 1) {
      const page = await file.getPage(n);
      for (const item of (await page.getTextContent()).items) {
        if (!item.str.trim()) continue;
        const at = `${n}:${Math.round(item.transform[5])}`;
        lines.set(at, (lines.get(at) || "") + item.str);
      }
    }
    /* Above the title: only the company band and the form's own reference box. */
    const HEAD = 780; /* the band sits at 757, the title block below 710 */
    const aloft = [...lines.entries()]
      .filter(([at]) => Number(at.split(":")[0]) === 1 && Number(at.split(":")[1]) > HEAD)
      .map(([, line]) => line.trim())
      .filter((line) => line && !/Business Management System|northwind\.example/i.test(line))
      /* The reference box is the form's own, printed on the blank. */
      .filter((line) => !new RegExp(`^${WANT[kind].ref}$`).test(line));
    say(aloft.length === 0, `${kind}: nothing of its own printed above the band`,
      aloft.length ? aloft.join(" · ").slice(0, 60) : "clear");

    const bare = [...lines.values()].filter((line) => /^[….\s]+$/.test(line));
    say(bare.length === 0, `${kind}: no rule ruled under a line already written`,
      bare.length ? `${bare.length} line(s) of nothing but dots` : "none");
    const seen = [...lines.entries()].map(([at, line]) => ({ at, line: line.trim() }));
    const note = seen.findIndex((x) => /^\(Block Capitals/i.test(x.line));
    const title = note > 0 ? seen[note - 1] : null;
    const apart = title && note > 0
      ? Math.round(Number(title.at.split(":")[1]) - Number(seen[note].at.split(":")[1]))
      : 0;
    say(note > 0 && apart > 0 && apart < 32, `${kind}: the note sits straight under the title`,
      `${apart}pt below "${(title?.line || "").slice(0, 34)}"`);
    /* And no blank line anywhere above it either: the heading runs from the
       programme's name to the note with nothing empty in between. */
    const heading = seen
      .filter((x) => x.line && Number(x.at.split(":")[0]) === 1)
      .sort((a, b) => Number(b.at.split(":")[1]) - Number(a.at.split(":")[1]));
    const upto = heading.findIndex((x) => /^\(Block Capitals/i.test(x.line));
    const steps = heading
      .slice(Math.max(0, upto - 3), upto + 1)
      .map((x, i, all) => (i ? Number(all[i - 1].at.split(":")[1]) - Number(x.at.split(":")[1]) : 0))
      .slice(1);
    say(steps.length > 0 && steps.every((n) => n > 0 && n <= 26), `${kind}: and nothing empty above it`,
      steps.map((n) => `${n}pt`).join(" · "));
  }
}

/* One sheet per document wherever one will do: a length a little past a
 * sheet only adds a second sheet, so the ask never lands there.
 */
if (RKEY) {
  console.log("\nand one sheet is preferred while one will do");
  const filling = (n) => {
    let out = "";
    let k = 0;
    while (out.length < n) {
      k += 1;
      out += `On the Thunderbird I worked with the candidate on the six-monthly maintenance of the launch ` +
        `and recovery system, item ${k}. He stripped the sheave assembly, inspected it and logged every finding.\n\n`;
    }
    return out.slice(0, n);
  };
  for (const kind of ["witness", "observation"]) {
    let worst = { pages: 0 };
    for (const areas of [1, 2, 4, 8, 12, 25, 47]) {
      const bytes = await fillForm(kind, { ...DOC, ref: WANT[kind].ref },
        { text: filling(askFor(kind, areas)), own: OWN, questions: QUESTIONS });
      await painted(bytes);
      if (pageCount > worst.pages) worst = { pages: pageCount, areas };
    }
    say(worst.pages === 1, `${kind}: one sheet whatever it carries`,
      worst.pages === 1 ? "one sheet throughout" : `${worst.pages} at ${worst.areas} areas`);
  }
}

/* No document may end on a sheet that says nothing: the last rendered page
 * must carry the form's own words, not just the header band and footer.
 */
if (RKEY) {
  console.log("\nand no document ends on an empty sheet");
  /* The header band, the footer and the document code are printed on every
     sheet whether it says anything or not, so they do not count as words. */
  const CHROME = /NW-CAP-\d+|Rev:\s*\d+|Date:\s*\d+\.?\w+\.?\d+|Page \d+ of \d+|Copyright [A-Za-z ]+|seabed-?to-?surface|Business Management System|www\.northwind\.example/gi;
  const filler = (n) => {
    let out = "";
    let k = 0;
    while (out.length < n) {
      k += 1;
      out += `On the Thunderbird I worked with the candidate on the six-monthly maintenance of the launch ` +
        `and recovery system, item ${k}. He stripped the sheave assembly, inspected it and logged every finding.\n\n`;
    }
    return out.slice(0, n);
  };
  for (const kind of ["witness", "observation", "knowledge", "feedback"]) {
    let worst = { own: 1e9 };
    for (const areas of [1, 2, 4, 8, 11, 25, 47]) {
      const bytes = await fillForm(kind, { ...DOC, ref: WANT[kind].ref },
        { text: filler(askFor(kind, areas)), own: OWN, questions: QUESTIONS });
      const res = await plainFetch(RENDER, { method: "POST",
        headers: { "content-type": "application/octet-stream", "x-docx-key": RKEY }, body: bytes });
      const file = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
      const last = await file.getPage(file.numPages);
      const own = (await last.getTextContent()).items.map((i) => i.str).join(" ")
        .replace(CHROME, "").replace(/[^A-Za-z]/g, "").length;
      if (own < worst.own) worst = { own, areas, pages: file.numPages };
    }
    say(worst.own >= 60, `${kind}: its last sheet always carries its own words`,
      `${worst.own} letters on page ${worst.pages} with ${worst.areas} areas`);
  }
}

/* The box must not be shut up against the signatures either: the gap under it
   is the same gap the form puts between one signature and the next. */
if (RKEY) {
  console.log("\nand the box stands off the signatures");
  const bytes = await fillForm("witness", { ...DOC, ref: "WT01" },
    { text: "He carried out the six-monthly maintenance on the launch and recovery system." });
  const res = await plainFetch(RENDER, { method: "POST",
    headers: { "content-type": "application/octet-stream", "x-docx-key": RKEY }, body: bytes });
  const file = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
  const page = await file.getPage(1);
  const size = page.getViewport({ scale: 1 });
  const items = (await page.getTextContent()).items
    .filter((i) => i.str.trim())
    .map((i) => ({ y: Math.round(size.height - i.transform[5]), s: i.str.trim() }));
  const at = (w) => items.find((i) => i.s.includes(w))?.y;
  const dates = items.filter((i) => i.s.startsWith("DATE")).map((i) => i.y);
  const [drawn] = await boxesDrawn(pdfjs, page, size);
  const under = at("AUTHOR") - Math.round((drawn.y + drawn.h) * size.height);
  const between = at("CANDIDATE SIG") - dates[0];
  say(under > 8, "there is a gap under the box", `${under}pt`);
  say(Math.abs(under - between) <= 4, "and it is the gap the form puts between the signatures",
    `${under}pt under the box, ${between}pt between them`);
}

console.log(fails.length ? `\n${fails.length} FAILED` : "\nevery form carries every field");
process.exit(fails.length ? 1 : 0);
