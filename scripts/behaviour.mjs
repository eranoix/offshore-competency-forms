const __REPO = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/\/$/, "");
/**
 * Checks on real documents that the trip feedback bank writes about the man, not the job, and that a
 * score of 3 (On Target, a good mark) does not read as a shortfall.
 *
 *   node scripts/behaviour.mjs          the bank and what it writes
 *   node scripts/behaviour.mjs --live   the same, written through the real upstream
 */
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import https from "node:https";

const fails = [];
const say = (ok, label, got = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${got ? ` — ${got}` : ""}`);
  if (!ok) fails.push(label);
};

const out = "/tmp/behaviour-engine.mjs";
await build({
  entryPoints: [`${__REPO}/scripts/_behaviour-entry.js`],
  bundle: true, format: "esm", outfile: out, platform: "node", logLevel: "error",
  define: { __OFFLINE__: "false" },
});
const { generateDocument, writeBlocks, buildContext, fill, jobWords, T, KEYS, PRESETS } = await import(out);

/* A slot that names a piece of work fills with the campaign's own vocabulary,
   which is the whole of what this form is not about. */
const NAMES_WORK = ["task", "tool", "system", "fault", "fix", "inspection", "scope_short"];
const slotsIn = (t) => [...String(t).matchAll(/\{([a-z_0-9]+)\}/g)].map((m) => m[1].replace(/[0-9]+$/, ""));
const every = (node, path = "", hit = []) => {
  if (typeof node === "string") hit.push([path, node]);
  else if (Array.isArray(node)) node.forEach((x, i) => every(x, `${path}[${i}]`, hit));
  else if (node && typeof node === "object")
    for (const [k, v] of Object.entries(node)) if (k !== "_usage") every(v, `${path}.${k}`, hit);
  return hit;
};
const bank = every(T);
const naming = bank.filter(([, t]) => slotsIn(t).some((s) => NAMES_WORK.includes(s)));
say(!naming.length, `no phrase in the bank names a job`, naming.length ? naming[0][0] : `${bank.length} phrases`);

/* On Target is a good mark. Written with the vocabulary of a shortfall it
   reads as one, and the man it is written about reads it that way too. */
const DEFICIT = ["under supervision", "continues to develop", "still need", "needs to", "encouraged to",
  "requires improvement", "lacks", "although", "however", "fell short", "must improve"];
const hedged = [];
for (const [key, scores] of Object.entries(T.criteria))
  for (const phrase of scores["3"] || [])
    for (const word of DEFICIT) if (phrase.toLowerCase().includes(word)) hedged.push(`${key}: ${word}`);
say(!hedged.length, `a 3 is written as a solid trip, not as a shortfall`, hedged.join("; ") || "11 criteria");

/* And the reverse, so this does not pass by the bank going bland: what is
   actually wrong still has to be sayable at 1 and 2. */
const critical = Object.values(T.criteria)
  .flatMap((s) => [...(s["1"] || []), ...(s["2"] || [])])
  .filter((p) => DEFICIT.some((w) => p.toLowerCase().includes(w)));
say(critical.length > 20, `and a 1 or a 2 still says what is wrong`, `${critical.length} phrases`);

const DOC = {
  crew: "A. Moreau", vessel: "MV Gulf Sentinel", position: "ROV Sub Tech",
  supervisor: "J. Whitlock", campaign: "flexlay", workScope: "ROV support to flexible lay and tie-in",
  notes: "",
};
const LIMIT = 175;
let written = 0;
const named = [];
const unfilled = [];
const over = [];
for (const preset of Object.keys(PRESETS))
  for (let i = 0; i < 25; i += 1) {
    const { criteria, blocks } = generateDocument(DOC, { preset });
    const texts = [...Object.values(criteria).map((c) => c.comment), blocks.supervisor, blocks.crew];
    for (const text of texts) {
      written += 1;
      const job = jobWords(text);
      if (job.length) named.push(`${preset}: ${job.join(", ")} — “${text.slice(0, 70)}”`);
      if (/\{[a-z_0-9]+\}/.test(text)) unfilled.push(`${preset}: ${text.slice(0, 70)}`);
    }
    for (const [key, c] of Object.entries(criteria))
      if (c.comment.length > LIMIT) over.push(`${key} ${c.comment.length}`);
  }
say(!named.length, `100 documents name no job, no tooling and no system`, named[0] || `${written} pieces of text`);
say(!unfilled.length, `and leave no slot unfilled`, unfilled[0] || "");
say(!over.length, `every comment fits the cell`, over[0] || `under ${LIMIT} characters`);

/* A sheet of straight threes must come out in the voice of a solid trip, not the one kept for reports with twos. */
const ctx = buildContext(DOC);
const flat = Object.fromEntries(KEYS.map((k) => [k, { score: 3, comment: "" }]));
const solid = Array.from({ length: 40 }, () => writeBlocks(buildContext(DOC), flat).supervisor);
const lowVoice = [...T.supervisor.opening_low, ...T.supervisor.middle_low,
  ...T.supervisor.closing_low, ...T.supervisor.closing_mid, ...T.supervisor.development_low]
  .map((p) => fill(p, ctx).split(/[.!?]/)[0].trim())
  .filter((p) => p.length > 30);
const slipped = solid.filter((text) => lowVoice.some((p) => text.includes(p)));
say(!slipped.length, `a sheet of straight threes is written as a solid trip`,
  slipped.length ? `${slipped.length}/40 — “${slipped[0].slice(0, 80)}”` : "40 of 40");

/* A name given as an initial is not the end of a sentence. */
const initial = fill("{first} wants to do the job well.", buildContext({ ...DOC, crew: "A. Moreau" }));
const spelled = fill("{first} wants to do the job well.", buildContext({ ...DOC, crew: "Sam Rivera" }));
const after = fill("{first} did what was asked. it held all trip.", buildContext(DOC));
say(initial === "A. wants to do the job well." && spelled === "Sam wants to do the job well."
  && after.includes(". It held"), `an initial does not capitalise the word after it`, initial);

if (process.argv.includes("--live")) {
  const KEY = process.env.AI_KEY;
  if (!KEY) {
    console.error("--live needs a model: set AI_KEY to the model upstream's key (AI_UPSTREAM moves the address)");
    process.exit(2);
  }
  const UP = new URL(process.env.AI_UPSTREAM || "https://203.0.113.10:9443/v1/messages");
  const ask = (system, user) => new Promise((resolve, reject) => {
    const payload = JSON.stringify({ model: process.env.AI_MODEL || "claude-sonnet-4-6",
      max_tokens: 900, temperature: 0.7, system, messages: [{ role: "user", content: user }] });
    const req = https.request({ method: "POST", hostname: UP.hostname, port: UP.port || 443,
      path: UP.pathname, rejectUnauthorized: false, servername: UP.hostname, timeout: 120_000,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload),
        "x-api-key": KEY, "anthropic-version": "2023-06-01" } }, (res) => {
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

  /* The house style as it ships, not a copy of it: a copy is what drifts. */
  const src = readFileSync(`${__REPO}/src/engine/ai.js`, "utf8");
  const piece = (from) => {
    const at = src.indexOf(from);
    const open = src.indexOf("`", at);
    return src.slice(open + 1, src.indexOf("`;", open)).replace(/\$\{SHARED_STYLE\}/, "");
  };
  const style = piece("const HOUSE_STYLE = ") + "\n" + piece("const SHARED_STYLE = ");

  const text = await ask(style,
    `Write the supervisor's comments on the man: three or four short paragraphs, third person — how he was to have on the shift, what stands out about the way he works, how he came on over the rotation, then the sign-off.

Position: ROV Sub Tech
Vessel: MV Gulf Sentinel

Scores given: safety: 4, quality: 4, knowledge: 3, technical: 3, english: 3, initiative: 4, decision: 3, motivation: 5, teamwork: 4, attendance: 3, communication: 3
1 Has Not Performed · 2 Requires Improvement · 3 On Target · 4 Above Target · 5 Outstanding.
The tone must match them. A 3 reads as solid and dependable, not as a shortfall; only a 1 or a 2 is written as a concern.`);
  console.log(`\n${text}\n\n  ${text.split(/\s+/).length} words`);
  const job = jobWords(text);
  say(!job.length, `written through the real upstream, it names no job`, job.join(", ") || "clean");
}

console.log(fails.length ? `\n${fails.length} failed` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
