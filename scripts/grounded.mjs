const __REPO = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/\/$/, "");
/**
 * The grounding check, against the real records. Two things must hold at once:
 * a marked job written up plainly is not flagged, and a fact nobody's records
 * show still is.
 *
 *   node scripts/grounded.mjs
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import https from "node:https";

const KEY = process.env.AI_KEY;
if (!KEY) {
  console.error("set AI_KEY to the model upstream's key (AI_UPSTREAM moves the address)");
  process.exit(2);
}
const UPSTREAM = new URL(process.env.AI_UPSTREAM || "https://203.0.113.10:9443/v1/messages");
const MODEL = process.env.AI_MODEL || "claude-sonnet-4-6";

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

/* The real module, asked through the very door the page uses: ask() posts to
   /api/ai, and here that door is answered by the upstream itself. */
const bundle = "/tmp/grounded-ai.mjs";
await build({
  entryPoints: [`${__REPO}/src/engine/ai.js`],
  bundle: true, format: "esm", outfile: bundle, platform: "node", logLevel: "error",
  define: { __OFFLINE__: "false" },
});
/* Node has a navigator of its own, and onLine is already true on it. */
globalThis.fetch = async (url, opts = {}) => {
  if (String(url) !== "/api/ai") throw new Error(`unexpected call to ${url}`);
  if ((opts.method || "GET") !== "POST") return { ok: true, status: 204 };
  const sent = JSON.parse(opts.body);
  const text = await upstream(sent.system, sent.messages[0].content,
    { maxTokens: sent.max_tokens, temperature: sent.temperature });
  if (process.env.LOUD) console.log("\n--- answered:\n" + String(text).slice(0, 1200) + "\n");
  return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text }] }) };
};
const { unsupported } = await import(bundle);

/* This person's own library, out of the store itself — the same function the
   server calls, so what the check reads is what the page would have given it. */
const TERMS = "witness | testimony | lars | launch | recovery | maintenance | rov | tms | dive | checks";
const OWNER = process.env.OFFSHORE_REPORT_UID || "00000000-0000-4000-8000-000000000001";
const rows = execFileSync("docker", ["exec", "supabase-db", "psql", "-U", "postgres", "-tAF", "\u0001", "-c",
  `select doc, passage from offshore_report_library_context('${OWNER}'::uuid, '${TERMS}', 10);`],
  { encoding: "utf8" });
const records = rows.split("\n").map((line) => {
  const [doc, ...rest] = line.split("\u0001");
  return doc && rest.length ? { doc, passage: rest.join("\u0001") } : null;
}).filter(Boolean);
if (!records.length) {
  console.log("no records came back — the library store is not reachable from here");
  process.exit(0);
}
const passages = records.map((r) => ({ doc: r.doc, text: String(r.passage || "").trim() }));
console.log(`      ${passages.length} passages from the library`);

const fails = [];
const say = (ok, label, got = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${got ? ` — ${got}` : ""}`);
  if (!ok) fails.push(label);
};

const WHO = "Sam Rivera";
/* What the panel put on the form. None of it is the writing's invention, and
   none of it is the records' to confirm. */
const GIVEN = {
  candidate: WHO,
  "candidate's discipline": "ROV Sub-Engineer",
  vessel: "MV Northstar",
  "who signs it": "Cornelius Battersby",
  "their position": "ROV Superintendent",
  "their relationship to the candidate": "Supervisor",
  date: "24/09/26",
};
const DID = ["ROV and TMS pre and post dive checks", "LARS launch and recovery operations"];
const PLAIN = `${WHO} worked on the MV Northstar as ROV Sub-Engineer. I worked alongside him for the whole trip. He carried out the pre and post dive ` +
  `checks on the ROV and TMS before every launch, working through the card and signing off each item, and ` +
  `I saw him do it without being prompted. He also took his turn on launch and recovery, running the ` +
  `LARS through the launch, the dive and the recovery, and handling the tether on the way back in.`;
/* One fact nobody's records show, in a sentence that reads like all the rest. */
const LIE = `${PLAIN} On the last day he cut and fusion-spliced the fibre core on the Hydra-9 skid at ` +
  `4,150 metres off Newfoundland, and we logged a bend loss of 0.03 dB.`;

const marked = await unsupported({ text: PLAIN, passages, did: DID, who: WHO, given: GIVEN });
say(marked.length === 0, "what the form supplies and the jobs it attests are not asked to prove themselves",
  marked.length ? `${marked.length} flagged: “${String(marked[0]).slice(0, 90)}”` : "nothing flagged");

const lied = await unsupported({ text: LIE, passages, did: DID, who: WHO, given: GIVEN });
const caught = lied.some((q) => /hydra|4,?150|newfoundland|0\.03|bend loss|splice/i.test(String(q)));
say(caught, "and a fact the records do not show is still caught",
  lied.length ? `“${String(lied.find((q) => /hydra|4,?150|newfoundland/i.test(String(q))) || lied[0]).slice(0, 90)}”`
    : "nothing flagged");

/* A real observation report off the bench, in the panel's length and voice,
   describing only the work marked on it: it must come back clean. */
const REAL = `${WHO} worked on the MV Northstar as ROV Sub-Engineer. The campaign covered mid-water ` +
  `target location, DP beacon pick-up and deployment, survey and tooling component fitting, hydraulic ` +
  `equipment function testing, Tool Tech backpack fault finding, ROV and TMS launch and recovery, and ` +
  `shift handover paperwork. He worked within that scope.

On safety awareness and HSEQ compliance, he wears the correct PPE and follows site rules without being ` +
  `prompted, applying them consistently across the shift whether the task is routine or not. He does not ` +
  `need to be reminded of his obligations and sets a reliable standard for those working alongside him.

Before any task begins, he checks that all control measures identified by the TRA are in place and does ` +
  `not allow work to proceed until he is satisfied the barriers are correct. Where a control measure is ` +
  `missing or has not been properly established, he raises it before the job starts rather than after. ` +
  `This is consistent habit, not something he does selectively.

He participates in toolbox talks in accordance with Northwind Offshore requirements, attends them prepared, and ` +
  `contributes what he has seen on the job. His input is practical and reflects a clear understanding of ` +
  `the task at hand.

He communicates effectively with the operational team throughout the shift. Information is passed ` +
  `clearly at handover, issues are flagged promptly, and the team is kept informed of progress. This ` +
  `reduces the risk of misunderstanding during critical phases of the operation.`;
const real = await unsupported({
  text: REAL, passages, who: WHO, given: GIVEN,
  /* The tasks he marked on this copy — which are the ones the opening names,
     because the opening is written from them. */
  did: ["Mid-water target location", "DP beacon pick-up and deployment",
    "Survey and tooling component fitting", "Hydraulic equipment function testing",
    "Tool Tech backpack fault finding", "ROV and TMS launch and recovery",
    "Shift handover paperwork", "Toolbox talk leadership", "TRA creation and review"],
});
say(real.length === 0, "a whole observation report, as the panel writes it, comes back clean",
  real.length ? `${real.length} flagged: ${real.slice(0, 2).map((q) => `“${String(q).slice(0, 70)}”`).join(" · ")}`
    : "nothing flagged");

console.log(fails.length ? `\n${fails.length} FAILED` : "\nthe check grounds the world and lets the document say what it is for");
process.exit(fails.length ? 1 : 0);
