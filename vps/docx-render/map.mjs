/**
 * Where the blanks are on the page. The forms are printed ones with no digital
 * fields, and the company's document is left alone, so the blanks are found on
 * the page it draws. Positions are fractions of the page, never pixels, so they
 * hold at any size.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);

/* The line a form prints immediately before a box it expects writing in. */
const OPENS = [
  /please see reverse|please see below|see reverse for guidance/i,
  /responses is given below/i,
  /comments of candidate performance/i,
  /comments in relation to the/i,
];
/* And whatever closes one: the confirmation, the outcome, or the next box. */
const CLOSES = /I confirm the above|Assessment Outcome|comments in relation to the/i;

/* pdftotext answers in XML, so the form's own ampersands arrive escaped and
   "POSITION & SITE" never matches the label the form prints. */
const plain = (t) =>
  t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

const num = (v) => Number(v) || 0;

function parse(xml) {
  const pages = [];
  const blocks = xml.split("<page ").slice(1);
  for (const block of blocks) {
    const size = block.match(/width="([\d.]+)" height="([\d.]+)"/);
    if (!size) continue;
    const words = [...block.matchAll(
      /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g,
    )].map((m) => ({ x0: num(m[1]), y0: num(m[2]), x1: num(m[3]), y1: num(m[4]), text: plain(m[5]) }));
    const lines = [...block.matchAll(
      /<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/line>/g,
    )].map((m) => ({
      x0: num(m[1]), y0: num(m[2]), x1: num(m[3]), y1: num(m[4]),
      text: plain([...m[5].matchAll(/>([^<]*)<\/word>/g)].map((w) => w[1]).join(" ").trim()),
    }));
    pages.push({ w: num(size[1]), h: num(size[2]), words, lines });
  }
  return pages;
}

const dotted = (t) => t.length > 3 && /^[….]+$/.test(t);

/**
 * The blanks of one document: the named lines, and the box for the statement.
 * `labels` are the words the form prints before each blank, in order.
 */
export function blanksOf(pages, labels) {
  const fields = [];
  const want = labels.map((l) => ({ label: l, key: l.toUpperCase().replace(/\s+/g, " ") }));

  pages.forEach((page, at) => {
    for (const line of page.lines) {
      const flat = line.text.toUpperCase().replace(/\s+/g, " ");
      const hit = want.find((w) => !fields.some((f) => f.label === w.label) && flat.startsWith(`${w.key}:`));
      if (!hit) continue;
      /* Where the label stops is where the writing starts. */
      const parts = page.words.filter((w) => w.y0 >= line.y0 - 1 && w.y1 <= line.y1 + 1);
      const colon = parts.filter((w) => w.text.includes(":")).slice(-1)[0] || parts.slice(-1)[0];
      if (!colon) continue;
      /* The dotted line under it says how wide the blank is; failing that, the
         line runs to the right margin the form uses. */
      const under = page.words.find((w) => dotted(w.text) && w.y0 > line.y1 && w.y0 < line.y1 + 22);
      const right = under ? under.x1 : Math.max(...page.words.map((w) => w.x1));
      fields.push({
        label: hit.label,
        page: at,
        x: (colon.x1 + 6) / page.w,
        y: line.y0 / page.h,
        w: Math.max(0.12, (right - colon.x1 - 6) / page.w),
        h: (line.y1 - line.y0) / page.h,
      });
    }
  });

  /* Every box a form expects writing in — the feedback form has two, the
     assessor's and the candidate's — each running from the line that
     introduces it to whatever closes it: the confirmation, the outcome, the
     next box, or the foot of the page. */
  const boxes = [];
  pages.forEach((page, at) => {
    for (const opens of page.lines.filter((l) => OPENS.some((r) => r.test(l.text)))) {
      const after = page.lines.filter((l) => l.y0 > opens.y1 + 4);
      const closes = after.find((l) => CLOSES.test(l.text));
      const foot = after.find((l) => /Rev: ?1|Copyright|SIGNATURE/i.test(l.text));
      const bottom = Math.min(closes ? closes.y0 : Infinity, foot ? foot.y0 : Infinity, page.h * 0.93);
      const left = Math.min(...page.words.map((w) => w.x0));
      const right = Math.max(...page.words.map((w) => w.x1));
      const h = (bottom - opens.y1 - 16) / page.h;
      if (h < 0.04) continue;
      const y = (opens.y1 + 10) / page.h;
      /* A form can say twice that writing goes below — an instruction and then
         a note about the guidance overleaf — and each would open a box on top
         of the one before. The first one wins; the page has only one space. */
      const overlaps = boxes.some((b) => b.page === at && y < b.y + b.h && y + h > b.y);
      if (overlaps) continue;
      boxes.push({ page: at, x: left / page.w, y, w: (right - left) / page.w, h });
    }
  });

  return { fields, boxes };
}

/** The words of every page, with where each one sits. The bytes are written
 *  out and read back because the text reader works on a file, not a stream. */
export async function pagesOf(pdf) {
  const dir = await mkdtemp(join(tmpdir(), "map-"));
  try {
    const file = join(dir, "f.pdf");
    await writeFile(file, pdf);
    await run("pdftotext", ["-bbox-layout", file, join(dir, "map.xml")], { timeout: 30_000 });
    return parse(await readFile(join(dir, "map.xml"), "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** The pages as pictures, plus where the blanks are on them. */
export async function sheetOf(dir, pdf, labels) {
  await run("pdftotext", ["-bbox-layout", pdf, join(dir, "map.xml")], { timeout: 30_000 });
  const pages = parse(await readFile(join(dir, "map.xml"), "utf8"));
  await run("pdftoppm", ["-png", "-r", "110", pdf, join(dir, "pg")], { timeout: 60_000 });
  const files = (await readdir(dir)).filter((f) => f.startsWith("pg-") && f.endsWith(".png")).sort();
  const shots = await Promise.all(files.map((f) => readFile(join(dir, f))));
  return {
    pages: pages.map((p, i) => ({
      w: p.w,
      h: p.h,
      image: shots[i] ? `data:image/png;base64,${shots[i].toString("base64")}` : "",
    })),
    ...blanksOf(pages, labels),
  };
}
