const __REPO = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/\/$/, "");
/**
 * Writes one testimony through the real upstream with the real house style and
 * prints it with its word count, because the voice can only be judged by reading.
 *
 *   node scripts/voice.mjs [how-many-areas]
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
function upstream(system, user, { maxTokens = 1200, temperature = 0.65 } = {}) {
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

const engine = "/tmp/voice-docx.mjs";
await build({ entryPoints: [`${__REPO}/src/engine/docx.js`], bundle: true, format: "esm",
  outfile: engine, platform: "node", logLevel: "error",
  define: { __OFFLINE__: "false" },
  plugins: [{ name: "f", setup(b) {
    b.onResolve({ filter: /\.docx\?url$/ }, () => ({ path: "x", namespace: "n" }));
    b.onLoad({ filter: /.*/, namespace: "n" }, () => ({ contents: "export default ''", loader: "js" }));
  } }] });
const { askFor } = await import(engine);

/* The house style, lifted out of the panel so what is read here is what ships. */
const panel = (await import("node:fs")).readFileSync(`${__REPO}/src/pages/Caap.jsx`, "utf8");
const HOUSE = panel.slice(panel.indexOf("const coverFor = (areas) => {"), panel.indexOf("\n  };", panel.indexOf("const coverFor")));
/* The whole of it, from the first backtick to the last: taking only the tail
   dropped the clause that forbids a list, and what came back was a list. */
const style = HOUSE.slice(HOUSE.indexOf("`") + 1, HOUSE.lastIndexOf("`"))
  .replace(/\$\{[\s\S]*?\n *\}/g, " — a clear sentence each")
  .replace(/\$\{[^}]*\}/g, "");

const AREAS = [
  "Find faults and make repairs to electronic/electrical equipment",
  "Find faults and make repairs to mechanical/hydraulic equipment",
  "Demonstrate the ability to effectively communicate with the operational team",
  "Carry out pre and post dive checks on the ROV and TMS",
  "Complete shift handover paperwork accurately",
  "Work safely in accordance with the permit to work system",
  "Maintain the ROV and TMS to the planned maintenance schedule",
  "Operate the launch and recovery system in adverse weather",
].slice(0, Number(process.argv[2] || 4));

const want = askFor("witness", AREAS.length);
const text = await upstream(
  `You write Northwind Offshore competence paperwork in the voice of the person signing it. ${style}`,
  `This is a witness testimony written by Nils Ekholm (ROV Supervisor) about Sam Rivera ` +
  `(ROV Sub-Engineer) on the MV Northstar. The trip covered mid-water target location, survey and ` +
  `tooling component fitting, hydraulic equipment function testing, Tool Tech backpack fault finding, ` +
  `and ROV and TMS launch and recovery.\n\n` +
  `Areas this document must cover (${AREAS.length}):\n${AREAS.map((a) => `- ${a}`).join("\n")}\n\n` +
  `Open with the work itself. Then take the areas, a short paragraph for each. Wrap the words that ` +
  `name an area in **double asterisks**. About ${Math.round(want / 6)} words. Shorter is never wrong; ` +
  `longer always reads as padding.`,
  { maxTokens: 1400 },
);

const fails = [];
const say = (ok, label, got = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${got ? ` — ${got}` : ""}`);
  if (!ok) fails.push(label);
};

const words = text.split(/\s+/).filter(Boolean).length;
const sentences = text.split(/(?<=[.!?])\s+/).filter((x) => x.trim().length > 3);
const longest = Math.max(...sentences.map((x) => x.split(/\s+/).length));
/* The words that carry nothing, and the habit of writing what the person did
   NOT do — both named in the house style, both read back here. */
const FILLER = /\b(appropriate|relevant|proper(ly)?|thorough(ly)?|effectively|consistently|methodically|as required|in a controlled manner)\b/gi;
const NEGATIVE = /\b(rather than|did not|does not|didn't|doesn't|without (being|escalating|having|needing|any need))\b/gi;
const JUDGING = /\b(to a standard|which reduces|this demonstrates|demonstrating that|it is clear that|exemplary|excellent)\b/gi;
/* What is wrapped in asterisks is the scheme's own wording, quoted so the
   reader can see which area a sentence answers — "the ability to effectively
   communicate" is the criterion's phrase, not the writer's padding. The
   writer's own words are what is read here. */
const own = text.replace(/\*\*[^*]+\*\*/g, " ");
const found = (re) => [...new Set((own.match(re) || []).map((w) => w.toLowerCase()))];

console.log(`\n${"—".repeat(78)}\n${text}\n${"—".repeat(78)}\n`);
say(text.length <= want * 1.2, "it comes back at the length it was asked for",
  `asked ${want}, came back ${text.length} · ${words} words`);
say(!found(FILLER).length, "with none of the words that carry nothing", found(FILLER).join(", "));
say(!found(NEGATIVE).length, "and nothing about what the person did not do", found(NEGATIVE).join(", "));
say(!found(JUDGING).length, "and no judging of the work", found(JUDGING).join(", "));
say(longest <= 34, "and no sentence running away with itself", `longest ${longest} words`);
say(!/^\s*[-*\u2022]/m.test(text) && !/^#{1,3} /m.test(text), "in paragraphs, not a list");

console.log(fails.length ? `\n${fails.length} FAILED` : "\nit reads like somebody wrote it between jobs");
process.exit(fails.length ? 1 : 0);
