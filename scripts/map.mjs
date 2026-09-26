/**
 * Asks the engine's `POST /map` where a form's blanks are and holds the answer to
 * the build-time map in `src/forms/blanks.js`. An edited form has no build to run,
 * so if the two disagree its fields would land where the printed form has none.
 *
 *   node scripts/map.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BLANKS } from "../src/forms/blanks.js";

const FORMS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "forms");
const RENDER = process.env.DOCX_UPSTREAM || `http://127.0.0.1:${process.env.DOCX_PORT || 8791}`;
const KEY = process.env.DOCX_KEY || "";
if (!KEY) {
  console.log("no key for the drawing engine (DOCX_KEY) — skipping");
  process.exit(0);
}

/* The labels each form prints, which is how the service finds the lines. */
const LINES = {
  witness: ["WITNESS", "POSITION & SITE", "NAME FOR WHOM TESTIMONY IS FOR", "RELATIONSHIP WITH CANDIDATE"],
  observation: ["ASSESSOR", "POSITION & SITE", "NAME OF CANDIDATE OBSERVED", "RELATIONSHIP WITH CANDIDATE"],
  knowledge: ["ASSESSOR", "POSITION & SITE", "CANDIDATE QUESTIONED", "RELATIONSHIP WITH CANDIDATE"],
  feedback: ["ASSESSOR", "POSITION & SITE", "CANDIDATE", "RELATIONSHIP WITH CANDIDATE"],
};

const fails = [];
const say = (ok, label, got = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${got ? ` — ${got}` : ""}`);
  if (!ok) fails.push(label);
};

/* A page is 842pt tall, so a thousandth of it is a third of a point: closer
   than anything anybody could see, and loose enough for the arithmetic. */
const CLOSE = 0.002;
const near = (a, b) => Math.abs(a - b) <= CLOSE;

for (const kind of ["witness", "observation", "knowledge", "feedback"]) {
  const bytes = readFileSync(join(FORMS, `${kind}.docx`));
  const res = await fetch(`${RENDER}/map`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-docx-key": KEY,
      "x-labels": JSON.stringify(LINES[kind]),
    },
    body: bytes,
  });
  if (!res.ok) {
    say(false, `${kind}: the engine maps the form`, `${res.status} ${(await res.text()).slice(0, 80)}`);
    continue;
  }
  const said = await res.json();
  const mine = BLANKS[kind];
  say(Array.isArray(said.fields) && said.fields.length === mine.fields.length,
    `${kind}: the engine finds the same lines the build did`,
    `${said.fields?.length} against ${mine.fields.length}`);
  say(Array.isArray(said.boxes) && said.boxes.length === mine.boxes.length,
    `${kind}: and the same boxes`, `${said.boxes?.length} against ${mine.boxes.length}`);

  const apart = [];
  for (const want of mine.fields) {
    const got = (said.fields || []).find((f) => f.label === want.label);
    if (!got) { apart.push(`${want.label}: not found`); continue; }
    for (const side of ["x", "y", "w", "h"]) {
      if (!near(got[side], want[side]))
        apart.push(`${want.label}.${side} ${got[side].toFixed(4)} vs ${want[side].toFixed(4)}`);
    }
  }
  say(apart.length === 0, `${kind}: and puts them in the same place`,
    apart.slice(0, 2).join(" · ") || "every line within a third of a point");
}

console.log(fails.length ? `\n${fails.length} FAILED` : "\nthe engine and the build agree on where the blanks are");
process.exit(fails.length ? 1 : 0);
