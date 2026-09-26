const __REPO = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/\/$/, "");
/**
 * What each task proves, read one task at a time at build time, so the panel can
 * say offline which tasks would close the areas still open. Each task gets a whole
 * call and must give a reason for every criterion it picks (a guess cannot write
 * one); a second reading strikes reasons that do not stand up. Writes as it goes.
 *
 *   node scripts/proves.mjs           # rewrite `proves` in tasks.json
 *   node scripts/proves.mjs --dry     # say what it would write
 *   node scripts/proves.mjs --from 40 # carry on from task 40
 */
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import https from "node:https";

const DRY = process.argv.includes("--dry");
const FROM = Number((process.argv.find((a) => a.startsWith("--from")) || "").split(/[= ]/)[1] || 0);
/* Reads only the tasks that came back with nothing. */
const FILL = process.argv.includes("--fill");
const BOOK = `${__REPO}/src/engine/tasks.json`;
const KEY = process.env.AI_KEY;
if (!KEY) {
  console.error("set AI_KEY to the model upstream's key (AI_UPSTREAM moves the address)");
  process.exit(2);
}
const UPSTREAM = new URL(process.env.AI_UPSTREAM || "https://203.0.113.10:9443/v1/messages");
const MODEL = process.env.AI_MODEL || "claude-sonnet-4-6";
/* Three at a time: the limit upstream is tokens a minute, and one at a time
   spends most of the hour waiting for the network rather than for an answer. */
const AT_ONCE = 3;

function once(system, user, { maxTokens = 2200, temperature = 0 } = {}) {
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

const shelf = "/tmp/proves-witness.mjs";
await build({ entryPoints: [`${__REPO}/src/engine/witness.js`], bundle: true, format: "esm",
  outfile: shelf, platform: "node", logLevel: "error" });
const { LEVELS, topicsFor } = await import(shelf);

/* Every criterion of every framework, once, and which frameworks want it. */
const shelves = new Map();
for (const level of LEVELS) {
  for (const scheme of ["caap", "crf"]) {
    for (const c of topicsFor(level, scheme).flatMap((g) => g.items)) {
      const had = shelves.get(c.text) || { text: c.text, unit: c.unit, levels: new Set() };
      had.levels.add(level.caap);
      shelves.set(c.text, had);
    }
  }
}

const book = JSON.parse(readFileSync(BOOK, "utf8"));
const all = Object.entries(book.groups).flatMap(([unit, list]) => list.map((t) => ({ ...t, unit })));
const proves = new Map(all.map((t) => [t.text, []]));

const parse = (answer, key) => {
  try {
    const body = JSON.parse(String(answer).replace(/^[^{]*/, "").replace(/[^}]*$/, ""));
    return Array.isArray(body[key]) ? body[key] : [];
  } catch {
    return [];
  }
};

/** What one task demonstrates, with the reason it does. */
async function readOne(task) {
  /* Only the frameworks this task's own levels are assessed against. */
  const mine = [...shelves.values()].filter((c) => task.levels.some((l) => c.levels.has(l)));
  if (!mine.length) return [];
  const listed = mine.map((c, n) => `${n + 1}. [${c.unit}] ${c.text}`).join("\n");

  const first = parse(
    await ask(
      `You know offshore ROV work and the Northwind Offshore competence frameworks. You are given ONE job an ROV crew does and every criterion this person is assessed against. Say which criteria carrying out that job demonstrates.\n\nAnswer with JSON only: {"of":[{"n":12,"why":"one short clause saying what in the job shows it"}]} — nothing else.\n\nThink about what the job actually involves from start to finish: what has to be planned, checked, isolated, handled, watched, recorded and handed over to do it properly, and what knowledge a person must have to do it at all. A criterion counts when doing the job shows it — the work itself, or what anyone must plainly do to carry it out safely and correctly. It does not count because it is near the subject, because the person probably did it the same day, or because it would be nice to claim.\n\nThe "why" is the test: if you cannot say in a clause what in THIS job shows it, do not include it.`,
      `The job:\n${task.text}\n(a ${task.unit.toLowerCase()} job, done by: ${task.levels.join(", ")})\n\nThe criteria, numbered:\n${listed}`,
      { maxTokens: 2200, temperature: 0.1 },
    ),
    "of",
  );
  const picked = first
    .map((p) => ({ c: mine[Number(p?.n) - 1], why: String(p?.why || "").trim() }))
    .filter((p) => p.c);
  if (!picked.length) return [];

  /* The check reads the reasons, not the numbers: a claim with a weak reason
     is the one that would not survive a verifier. */
  const kept = parse(
    await ask(
      `You are a verifier reading what somebody claims a piece of offshore work demonstrates. For each claim you are given the criterion and the reason given. Answer with JSON only: {"keep":[1,4,5]} — the numbers of the claims that stand, and nothing else.\n\nA claim stands when the reason names something in THAT job which shows THAT criterion. Strike it when the reason is vague, when it describes work the person may also have done but this job does not require, when it needs a second assumption, or when it restates the criterion instead of pointing at the job. Keep the ones that are right — you are checking, not re-deciding.`,
      `The job:\n${task.text}\n\nThe claims:\n${picked.map((p, n) => `${n + 1}. ${p.c.text}\n   because: ${p.why || "(no reason given)"}`).join("\n\n")}`,
      { maxTokens: 900, temperature: 0 },
    ),
    "keep",
  );
  const stand = new Set(kept.map((n) => Number(n)));
  return picked.filter((_, n) => stand.has(n + 1)).map((p) => p.c.text);
}

/**
 * A second look at a job that proved nothing. Those jobs are named after a make,
 * which the framework never mentions, so the name is read for the kind of
 * equipment it refers to; the work is what is being judged.
 */
async function readAgain(task) {
  const mine = [...shelves.values()].filter((c) => task.levels.some((l) => c.levels.has(l)));
  if (!mine.length) return [];
  const listed = mine.map((c, n) => `${n + 1}. [${c.unit}] ${c.text}`).join("\n");
  const got = parse(
    await ask(
      `You know offshore ROV work. You are given one job and every criterion the person is assessed against, and the first reading of it found nothing — which is almost always because the job is named after a make or a model rather than after the work.\n\nWork out what kind of equipment or operation the name refers to, then say which criteria doing that work demonstrates. Answer with JSON only: {"of":[{"n":12,"why":"one short clause"}]}. If after that it genuinely demonstrates nothing, answer {"of":[]} — but say so only when the job really is outside everything on the list.`,
      `The job:\n${task.text}\n(a ${task.unit.toLowerCase()} job, done by: ${task.levels.join(", ")})\n\nThe criteria, numbered:\n${listed}`,
      { maxTokens: 2200, temperature: 0.1 },
    ),
    "of",
  );
  return got.map((p) => mine[Number(p?.n) - 1]).filter(Boolean).map((c) => c.text);
}

const save = () => {
  for (const [unit, list] of Object.entries(book.groups))
    book.groups[unit] = list.map((t) => ({ ...t, proves: proves.get(t.text) || [] }));
  writeFileSync(BOOK, `${JSON.stringify(book, null, 2)}\n`);
};

/* Coming back to fill the empties, what is already known is kept. */
if (FILL) for (const t of all) proves.set(t.text, t.proves || []);

const queue = FILL ? all.filter((t) => !(t.proves || []).length) : all.slice(FROM);
let done = 0;
let at = 0;
const workers = Array.from({ length: AT_ONCE }, async () => {
  for (;;) {
    const n = at;
    at += 1;
    if (n >= queue.length) return;
    const task = queue[n];
    let got = await (FILL ? readAgain(task) : readOne(task)).catch((e) => {
      process.stdout.write(`  ${task.text} — ${e.message}\n`);
      return [];
    });
    /* Nothing at all is almost always the name of a make getting in the way. */
    if (!got.length && !FILL) got = await readAgain(task).catch(() => []);
    proves.set(task.text, got);
    done += 1;
    process.stdout.write(`${String(done).padStart(3)}/${queue.length}  ${String(got.length).padStart(2)}  ${task.text}\n`);
    if (!DRY && done % 12 === 0) save();
  }
});
await Promise.all(workers);

const total = all.reduce((n, t) => n + (proves.get(t.text)?.length || 0), 0);
const bare = all.filter((t) => !proves.get(t.text)?.length);
process.stdout.write(`\n${total} links · ${(total / all.length).toFixed(1)} a task · ${bare.length} prove nothing\n`);
for (const t of bare.slice(0, 10)) process.stdout.write(`   nothing: ${t.text}\n`);
if (!DRY) {
  save();
  process.stdout.write(`written to ${BOOK}\n`);
}
