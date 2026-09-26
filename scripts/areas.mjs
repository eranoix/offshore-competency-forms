const __REPO = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/\/$/, "");
/**
 * Runs the Areas tab's two passes against the real framework and engine and
 * prints what it chose, for someone who knows the job to read. A reading, not a
 * test, but it checks it does not choose nothing, everything, or one twice.
 *
 *   node scripts/areas.mjs                 # a witness testimony about the LARS
 *   node scripts/areas.mjs "task; task"    # your own
 */
import { build } from "esbuild";
import https from "node:https";


const KEY = process.env.AI_KEY;
if (!KEY) {
  console.error("set AI_KEY to the model upstream's key (AI_UPSTREAM moves the address)");
  process.exit(2);
}
const UPSTREAM = new URL(process.env.AI_UPSTREAM || "https://203.0.113.10:9443/v1/messages");
const MODEL = process.env.AI_MODEL || "claude-sonnet-4-6";

/* The page asks through /api/ai, which adds the key and the library. Here the
   same prompts go straight up, so what is being read is the real wording. */
function upstream(system, user, { maxTokens = 900, temperature = 0 } = {}) {
  const payload = JSON.stringify({ model: MODEL, max_tokens: maxTokens, temperature, system,
    messages: [{ role: "user", content: user }] });
  return new Promise((resolve, reject) => {
    const req = https.request({
      method: "POST", hostname: UPSTREAM.hostname, port: UPSTREAM.port || 443, path: UPSTREAM.pathname,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload),
        "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      rejectUnauthorized: false, servername: UPSTREAM.hostname, timeout: 120_000,
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const body = JSON.parse(data);
          if (body.error) return reject(new Error(body.error.message || "refused"));
          resolve((body.content || []).map((c) => c.text || "").join("").trim());
        } catch { reject(new Error(data.slice(0, 140))); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end(payload);
  });
}

/* The real module, with the browser's asking replaced by the line above. */
const bundle = "/tmp/areas-match.mjs";
await build({
  entryPoints: [`${__REPO}/src/engine/match.js`],
  bundle: true, format: "esm", outfile: bundle, platform: "node", logLevel: "error",
  plugins: [{ name: "ai", setup(b) {
    b.onResolve({ filter: /\.\/ai$/ }, () => ({ path: "ai", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export const ask = (s, u, o) => globalThis.__ask(s, u, o);", loader: "js",
    }));
  } }],
});
globalThis.__ask = async (system, user, opts) => {
  const out = await upstream(system, user, opts);
  if (process.env.LOUD) console.log("\n--- answered:", String(out).slice(0, 300), "\n");
  return out;
};
const { areasForTasks } = await import(bundle);

/* The framework the panel uses, through the same door: Node will not import
   the JSON the browser's bundler hands over for free. */
const shelf = "/tmp/areas-witness.mjs";
await build({
  entryPoints: [`${__REPO}/src/engine/witness.js`],
  bundle: true, format: "esm", outfile: shelf, platform: "node", logLevel: "error",
});
const { groupedCriteria } = await import(shelf);

const ROLE = "ROV Pilot Technician";
const criteria = groupedCriteria(ROLE).flatMap((g) => g.items);
const tasks = (process.argv[2] || "LARS six-monthly maintenance; Sheave assembly strip and inspect; Wire inspection and re-termination")
  .split(/\s*;\s*/).filter(Boolean);

console.log(`${criteria.length} criteria · ${tasks.length} tasks`);
for (const t of tasks) console.log(`  - ${t}`);

const got = await areasForTasks({
  tasks, criteria,
  about: `Dario Castell is being assessed at ${ROLE} against the CAAP framework. This document is a witness testimony.`,
  already: [],
  onRound: ({ round, added, all }) => console.log(`  round ${round}: +${added} (${all})`),
});

const fails = [];
const say = (ok, label, extra = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) fails.push(label);
};
console.log(`\nit marked ${got.length}:`);
const byUnit = {};
for (const c of got) (byUnit[c.unit] = byUnit[c.unit] || []).push(c.text);
for (const [unit, list] of Object.entries(byUnit)) {
  console.log(`\n  ${unit}`);
  for (const t of list) console.log(`    · ${t}`);
}
console.log("");
say(got.length > 0, "it chose something");
say(got.length < criteria.length * 0.5, "and not half the framework", `${got.length} of ${criteria.length}`);
say(new Set(got.map((c) => c.text)).size === got.length, "with nothing chosen twice");
say(got.every((c) => criteria.some((x) => x.text === c.text)), "and every one is a real criterion");

/* Asked again with those already marked, it must not hand the same ones back. */
const again = await areasForTasks({
  tasks, criteria, rounds: 1,
  about: `Dario Castell is being assessed at ${ROLE} against the CAAP framework. This document is a witness testimony.`,
  already: got.map((c) => c.text),
});
say(!again.some((c) => got.some((x) => x.text === c.text)),
  "asked again, it does not hand back what is already marked", `${again.length} new`);
say(again.length <= got.length, "and it has already found most of what there is",
  `${again.length} left after ${got.length}`);

console.log(fails.length ? `\n${fails.length} FAILED` : "\nthe reading holds");
process.exit(fails.length ? 1 : 0);
