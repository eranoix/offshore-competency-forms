const __REPO = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/\/$/, "");
/**
 * Reading a verdict out of an answer that was asked for JSON only, including a
 * reader that writes a first answer, changes its mind, and writes a second.
 *
 *   node scripts/verdict.mjs
 */
import { build } from "esbuild";

const bundle = "/tmp/verdict-engine.mjs";
await build({
  entryPoints: [`${__REPO}/src/engine/ai.js`],
  bundle: true, format: "esm", outfile: bundle, platform: "node", logLevel: "error",
  define: { __OFFLINE__: "true" },
});
const { verdictIn } = await import(bundle);

const fails = [];
const say = (ok, label, got = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${got ? ` — ${got}` : ""}`);
  if (!ok) fails.push(label);
};

/* A real reply's shape, shortened. */
const RECONSIDERED = `\`\`\`json
{"invented": ["I worked alongside him for the whole trip", "He carried out the pre and post dive checks"]}
\`\`\`

Wait, I need to reconsider. The instructions say the jobs listed are taken as done — I should
not list statements merely because the records do not name him doing them.

\`\`\`json
{"invented": []}
\`\`\``;
const settled = verdictIn(RECONSIDERED, "invented");
say(Array.isArray(settled?.invented) && settled.invented.length === 0,
  "a reader that changes its mind is read on what it settled on",
  JSON.stringify(settled));

say(verdictIn(`{"invented":["the Hydra-9 skid"]}`, "invented")?.invented?.[0] === "the Hydra-9 skid",
  "a plain answer still reads");

say(verdictIn(`Here you go:\n{"human":false,"faults":["it pads"]}\nThat is all.`, "human")?.human === false,
  "prose around it does not matter");

say(verdictIn(`{"invented":["it said {not a brace} out loud"]}`, "invented")?.invented?.[0]
  === "it said {not a brace} out loud", "a brace inside a quote is not the end of the object");

say(verdictIn(`{"note":{"a":1}}\n{"of":[2,5]}`, "of")?.of?.join(",") === "2,5",
  "the object carrying the key it was asked for is the one taken");

say(verdictIn("nothing here at all", "invented") === null,
  "and an answer with no verdict in it reads as none, not as a pass");

say(verdictIn(`{"invented": [broken`, "invented") === null,
  "a half-written object is not a pass either");

console.log(fails.length ? `\n${fails.length} FAILED` : "\nevery verdict is read off the answer it was settled on");
process.exit(fails.length ? 1 : 0);
