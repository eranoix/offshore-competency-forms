const __REPO = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/\/$/, "");
/**
 * What a statement may never say: anything about itself (the other copies, what
 * other witnesses cover, what is dealt with elsewhere), such as "The areas covered
 * by other witnesses are not addressed here." Caught before the form is printed.
 *
 *   node scripts/register.mjs
 */
import { build } from "esbuild";

const bundle = "/tmp/register-review.mjs";
await build({
  entryPoints: [`${__REPO}/src/engine/review.js`],
  bundle: true, format: "esm", outfile: bundle, platform: "node", logLevel: "error",
});
const { faults } = await import(bundle);

const fails = [];
const say = (ok, label, got = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${got ? ` — ${got}` : ""}`);
  if (!ok) fails.push(label);
};

/* A real statement, long enough and marked, so nothing else is reported. */
const REAL =
  "Sam worked on the MV Northstar across mid-water target location, survey, and tooling component " +
  "fitting. He traced a fault in the **Tool Tech backpack** to a wiring issue and repaired it. He ran " +
  "**hydraulic function tests** on tooling equipment, identified a pressure anomaly, and corrected it at " +
  "the fitting. Before and after each dive he completed **ROV and TMS pre and post dive checks**, working " +
  "through each system and flagging anything that needed attention. He kept the deck team told throughout.";
const about = (text) =>
  faults(text, { areas: [], tasks: [], candidate: "Sam", min: 100 })
    .filter((f) => /paperwork/.test(f));

say(about(REAL).length === 0, "a statement about the work is left alone");

/* Every way it has been written, and the shapes next to them. */
const SAID = [
  "The areas covered by other witnesses are not addressed here.",
  "Other copies of this form deal with the remaining areas.",
  "This document does not cover the rest of the criteria.",
  "The remaining areas are covered elsewhere.",
  "Those criteria are addressed in another testimony.",
  "The remaining criteria fall outside the scope of this report.",
];
for (const line of SAID) {
  const found = about(`${REAL} ${line}`);
  say(found.length === 1, `caught: "${line.slice(0, 46)}…"`,
    found.length ? "" : "went through");
}

/* And what must not be mistaken for it: a statement may say the candidate
   worked with others, or that something was handed to another shift. */
const FINE = [
  "He worked alongside two other technicians on the sheave assembly.",
  "The fault was handed to the other shift with the log written up.",
  "Another pump was swapped out the same day.",
];
for (const line of FINE) {
  const found = about(`${REAL} ${line}`);
  say(found.length === 0, `left alone: "${line.slice(0, 46)}…"`, found[0]?.slice(0, 60) || "");
}

/* And the place the vehicle is flown from: a bare "control van" reads as
 * somebody who has not been on these vessels. What is wrapped in asterisks is the
 * scheme's phrase, quoted, and is not the writer's to change.
 */
const room = (text) =>
  faults(text, { areas: [], tasks: [], candidate: "Sam", min: 100 })
    .filter((f) => /control van/.test(f));

say(room(`${REAL} He kept the control van told throughout.`).length === 1,
  'caught: a bare "control van"');
say(room(`${REAL} He kept the control van/room told throughout.`).length === 0,
  'left alone: "control van/room"');
say(room(`${REAL} The control room was told as he went.`).length === 0,
  'left alone: "control room"');
say(room(`${REAL} He handled **Interface ancilliary equipment onto the ROV and into the Control Van** himself.`).length === 0,
  "left alone: the scheme's own wording, quoted");

console.log(fails.length ? `\n${fails.length} FAILED` : "\nthe statement never talks about the paperwork");
process.exit(fails.length ? 1 : 0);
