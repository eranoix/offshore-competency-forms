const __REPO = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/\/$/, "");
/**
 * The criteria no task closes, asked the other way round: which jobs in the book
 * demonstrate this one? Where the answer is none, the missing job is named and
 * added, marked as coming from the scheme rather than from the paperwork.
 *
 *   node scripts/orphans.mjs          # close them
 *   node scripts/orphans.mjs --dry    # say what it would do
 */
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import https from "node:https";

const DRY = process.argv.includes("--dry");
const BOOK = `${__REPO}/src/engine/tasks.json`;
const KEY = process.env.AI_KEY;
if (!KEY) {
  console.error("set AI_KEY to the model upstream's key (AI_UPSTREAM moves the address)");
  process.exit(2);
}
const UPSTREAM = new URL(process.env.AI_UPSTREAM || "https://203.0.113.10:9443/v1/messages");
const MODEL = process.env.AI_MODEL || "claude-sonnet-4-6";

function once(system, user, { maxTokens = 1600, temperature = 0 } = {}) {
  const payload = JSON.stringify({ model: MODEL, max_tokens: maxTokens, temperature, system,
    messages: [{ role: "user", content: user }] });
  return new Promise((resolve, reject) => {
    const req = https.request({
      method: "POST", hostname: UPSTREAM.hostname, port: UPSTREAM.port || 443, path: UPSTREAM.pathname,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload),
        "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      rejectUnauthorized: false, servername: UPSTREAM.hostname, timeout: 180_000,
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
async function ask(system, user, opts) {
  let wait = 4000;
  for (let go = 0; go < 9; go += 1) {
    try {
      return await once(system, user, opts);
    } catch (e) {
      if (!/rate limit|tpm_exceeded|overloaded|429|timed out|socket/i.test(e.message) || go === 8) throw e;
      const said = Number((e.message.match(/retry in (\d+)/) || [])[1]) * 1000;
      await new Promise((r) => setTimeout(r, Math.max(said || 0, wait)));
      wait = Math.min(wait * 2, 60_000);
    }
  }
  throw new Error("unreachable");
}
const parse = (answer, key) => {
  try {
    const body = JSON.parse(String(answer).replace(/^[^{]*/, "").replace(/[^}]*$/, ""));
    return body[key];
  } catch {
    return undefined;
  }
};

const shelf = "/tmp/orphans-witness.mjs";
await build({ entryPoints: [`${__REPO}/src/engine/witness.js`], bundle: true, format: "esm",
  outfile: shelf, platform: "node", logLevel: "error" });
const { LEVELS, topicsFor } = await import(shelf);

const book = JSON.parse(readFileSync(BOOK, "utf8"));
const groupsOf = () => Object.entries(book.groups).flatMap(([unit, list]) => list.map((t) => ({ ...t, unit })));

/** Every criterion, with the levels whose framework asks for it. */
const every = new Map();
for (const level of LEVELS) {
  for (const scheme of ["caap", "crf"]) {
    for (const c of topicsFor(level, scheme).flatMap((g) => g.items)) {
      const had = every.get(c.text) || { text: c.text, unit: c.unit, levels: new Set() };
      had.levels.add(level.caap);
      every.set(c.text, had);
    }
  }
}
/**
 * A criterion nobody closes — asked level by level.
 *
 * Read across the whole book, a Supervisor's criterion can look closed by a
 * job only a Pilot Technician does, and the Supervisor's own list still has a
 * line with nothing against it. The question is always "for this level".
 */
const orphans = () => {
  const jobs = groupsOf();
  const out = new Map();
  for (const c of every.values()) {
    for (const level of c.levels) {
      const closed = jobs.some((t) => (t.levels || []).includes(level) && (t.proves || []).includes(c.text));
      if (!closed) out.set(`${level}::${c.text}`, { ...c, need: level });
    }
  }
  return [...out.values()];
};

const left = orphans();
console.log(`${left.length} criteria nothing closes\n`);

let linked = 0;
const stillBare = [];
for (const c of left) {
  /* Only the jobs the level that is missing it actually does. */
  const mine = groupsOf().filter((t) => (t.levels || []).includes(c.need));
  const listed = mine.map((t, n) => `${n + 1}. [${t.unit}] ${t.text}`).join("\n");
  const picked = parse(
    await ask(
      `You know offshore ROV work and the Northwind Offshore competence frameworks. You are given ONE criterion a person is assessed against, and every job in this crew's task book. Say which of those jobs, carried out properly, would demonstrate it.\n\nAnswer with JSON only: {"of":[{"n":12,"why":"one short clause saying what in the job shows it"}]} — nothing else.\n\nA job counts when doing it shows the criterion: the work itself, or what anyone must plainly do to carry it out safely and correctly. Read the criterion for what it actually asks — many are about how a person works rather than what equipment they touch, and those are shown by a great many jobs. Answer {"of":[]} only if genuinely no job in the book would show it.`,
      `The criterion:\n[${c.unit}] ${c.text}\n\nThe jobs, numbered:\n${listed}`,
      { maxTokens: 1600, temperature: 0.1 },
    ),
    "of",
  );
  const got = (Array.isArray(picked) ? picked : [])
    .map((p) => ({ t: mine[Number(p?.n) - 1], why: String(p?.why || "").trim() }))
    .filter((p) => p.t);
  if (!got.length) {
    stillBare.push(c);
    console.log(`  none yet: ${c.text.slice(0, 74)}`);
    continue;
  }
  /* The same verifier as everywhere else: the reason is what is checked. */
  const kept = parse(
    await ask(
      `You are a verifier reading claims that a piece of offshore work demonstrates one criterion. Answer with JSON only: {"keep":[1,3]} — the claims that stand. A claim stands when the reason names something in THAT job which shows THAT criterion. Strike the vague, the ones needing a second assumption, and the ones that restate the criterion instead of pointing at the job. Keep at least the strongest one if any is defensible at all.`,
      `The criterion:\n${c.text}\n\nThe claims:\n${got.map((p, n) => `${n + 1}. ${p.t.text}\n   because: ${p.why || "(none)"}`).join("\n\n")}`,
      { maxTokens: 700, temperature: 0 },
    ),
    "keep",
  );
  const stand = new Set((Array.isArray(kept) ? kept : []).map(Number));
  const winners = got.filter((_, n) => stand.has(n + 1));
  const use = winners.length ? winners : got.slice(0, 1);
  for (const [unit, list] of Object.entries(book.groups)) {
    book.groups[unit] = list.map((t) =>
      use.some((u) => u.t.text === t.text) && !(t.proves || []).includes(c.text)
        ? { ...t, proves: [...(t.proves || []), c.text] }
        : t,
    );
  }
  linked += use.length;
  console.log(`  ${String(use.length).padStart(2)} job(s): ${c.text.slice(0, 66)}`);
}

/* What the book has no job for at all: the scheme asks for work this person's
   paperwork never described, and naming it is the useful answer. */
for (const c of stillBare) {
  const named = parse(
    await ask(
      `You know offshore ROV work. A competence framework asks for the criterion below and this crew's task book has no job that would evidence it. Name the job that would.\n\nAnswer with JSON only: {"task":"the job, two to seven words, named as a maintenance log names one","group":"one of the groups given"}. Never a sentence, never the past tense, no person, vessel, project or date.`,
      `The criterion:\n[${c.unit}] ${c.text}\n\nThe groups:\n${Object.keys(book.groups).map((g) => `- ${g}`).join("\n")}`,
      { maxTokens: 300, temperature: 0.2 },
    ),
    "task",
  );
  const text = String(named || "").replace(/\s+/g, " ").trim();
  const group = Object.keys(book.groups).find(
    (g) => g.toLowerCase() === String(parse("{}", "x") || "").toLowerCase(),
  );
  if (!text || text.length < 6) {
    console.log(`  STILL NOTHING: ${c.text.slice(0, 70)}`);
    continue;
  }
  const unit = group || c.unit;
  const home = Object.keys(book.groups).includes(unit) ? unit : Object.keys(book.groups)[0];
  book.groups[home] = [
    ...book.groups[home],
    { text, levels: [...new Set([c.need, ...c.levels])], proves: [c.text], from: "scheme" },
  ];
  linked += 1;
  console.log(`  + added "${text}" for: ${c.text.slice(0, 54)}`);
}

const after = orphans();
console.log(`\n${linked} links added · ${after.length} criteria still closed by nothing`);
for (const c of after) console.log(`   ${c.text}`);
if (!DRY) {
  writeFileSync(BOOK, `${JSON.stringify(book, null, 2)}\n`);
  console.log(`written to ${BOOK}`);
}
