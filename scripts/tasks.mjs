const __REPO = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/\/$/, "");
/**
 * The task list, read out of the real paperwork. For each level it pulls the library passages
 * that describe work, asks for the jobs they record, then holds the list against the same
 * passages over four more passes. Only what survives every pass ships.
 *
 *   node scripts/tasks.mjs            # write src/engine/tasks.json
 *   node scripts/tasks.mjs --dry      # print what it would write
 *
 * A maintenance tool, not part of the build: the list is checked in.
 */
import { readFileSync, writeFileSync } from "node:fs";
import https from "node:https";

const DRY = process.argv.includes("--dry");
const ROOT = `${__REPO}`;
const OUT = `${ROOT}/src/engine/tasks.json`;
const REST = process.env.OFFSHORE_REPORT_REST || "http://127.0.0.1:8000/rest/v1";
const UPSTREAM = new URL(process.env.AI_UPSTREAM || "https://203.0.113.10:9443/v1/messages");
const MODEL = process.env.AI_MODEL || "claude-sonnet-4-6";
const PASSES = 5;

/* The keys come from the environment, never from a file in the repository:
   read here and handed straight to the request. */
const secret = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`set ${name} (see the README, "Scripts that call a live service")`);
    process.exit(2);
  }
  return value;
};
const SERVICE = secret("SUPABASE_SERVICE_ROLE_KEY");
const AI_KEY = secret("AI_KEY");

/* The levels the site offers, and the CAAP discipline each one is assessed
   against — the same pairing as engine/witness.js. */
const LEVELS = [
  { level: "ROV Pilot Technician", caap: "ROV Pilot Technician" },
  { level: "ROV Submersible Technician", caap: "ROV Sub-Engineer" },
  { level: "ROV Supervisor", caap: "ROV Supervisor" },
  { level: "ROV Superintendent", caap: "ROV Superintendent" },
];

/* The groups the panel and engine/bridge.js already know. Inventing new ones
   would break the line from a task to the parts of the scheme it evidences,
   so the sorting picks from this list and nothing else. */
const GROUPS = Object.keys(
  JSON.parse(readFileSync(`${ROOT}/src/engine/tasks.json`, "utf8")).groups,
);

async function rest(path, body) {
  const res = await fetch(`${REST}/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`rest ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

function once(system, user, { maxTokens = 1400, temperature = 0 } = {}) {
  const payload = JSON.stringify({
    model: MODEL,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: "user", content: user }],
  });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "POST",
        hostname: UPSTREAM.hostname,
        port: UPSTREAM.port || 443,
        path: UPSTREAM.pathname,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          "x-api-key": AI_KEY,
          "anthropic-version": "2023-06-01",
        },
        rejectUnauthorized: false,
        servername: UPSTREAM.hostname,
        timeout: 120_000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const body = JSON.parse(data);
            if (body.error) return reject(new Error(body.error.message || "upstream refused"));
            resolve((body.content || []).map((c) => c.text || "").join("").trim());
          } catch {
            reject(new Error(`unreadable answer: ${data.slice(0, 160)}`));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("upstream timed out")));
    req.on("error", reject);
    req.end(payload);
  });
}

/**
 * Ask the shared upstream. Back-to-back calls make a rate limit the expected answer, so it
 * waits the time the refusal names, a little more each go.
 */
async function ask(system, user, opts = {}) {
  let wait = 4000;
  for (let go = 0; go < 8; go += 1) {
    try {
      return await once(system, user, opts);
    } catch (e) {
      const held = /rate limit|tpm_exceeded|overloaded|429/i.test(e.message);
      if (!held || go === 7) throw e;
      const said = Number((e.message.match(/retry in (\d+)/) || [])[1]) * 1000;
      const nap = Math.max(said || 0, wait);
      process.stdout.write(`  held back — waiting ${Math.round(nap / 1000)}s\n`);
      await new Promise((r) => setTimeout(r, nap));
      wait = Math.min(wait * 2, 60_000);
    }
  }
  throw new Error("unreachable");
}

const JSON_ONLY = `Answer with JSON only: {"tasks":["...","..."]}. Nothing else.`;
/**
 * What a task has to be.
 *
 * It is the subject of a document — it prints on the form's own header line and
 * it is what the panel shows when it says what a testimony is about. So it
 * names the job the way a maintenance log or a testimony header names it, not
 * the way somebody would describe their day.
 */
const SHAPE = `Each task NAMES a job in two to seven words, as a heading — "LARS six-monthly maintenance", "Hydraulic fault finding on the TMS", "Tether re-termination", "Toolsled change-out". Never a sentence, never the past tense, never "Piloted the…" or "Carried out the…". No competences, no qualities, no headings from the framework, no person's name, no vessel, no project, no date, no client.`;

const clean = (list) =>
  [
    ...new Map(
      (Array.isArray(list) ? list : [])
        .map((t) => String(t || "").replace(/\s+/g, " ").trim().replace(/\.$/, ""))
        .filter((t) => t.length > 5 && t.length < 70 && /[a-z]/.test(t))
        /* Two spellings of one job are one job. */
        .map((t) => [t.toLowerCase(), t]),
    ).values(),
  ].slice(0, 80);

const parse = (answer, key = "tasks") => {
  try {
    const body = JSON.parse(String(answer).replace(/^[^{]*/, "").replace(/[^}]*$/, ""));
    return key === "tasks" ? clean(body.tasks) : body;
  } catch {
    return key === "tasks" ? [] : {};
  }
};

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "was", "were", "has", "have"]);
const termsOf = (...bits) =>
  [
    ...new Set(
      bits
        .join(" ")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && w.length < 24 && !STOP.has(w)),
    ),
  ]
    .slice(0, 24)
    .join(" | ");

async function passages(uid, hunts) {
  const seen = new Map();
  for (const hunt of hunts) {
    const rows = await rest("rpc/offshore_report_library_context", { uid, terms: termsOf(hunt), n: 12 });
    for (const r of rows || []) {
      const text = String(r.passage || "").trim();
      if (text.length > 120 && !seen.has(text)) seen.set(text, { doc: r.doc, text: text.slice(0, 1200) });
    }
  }
  return [...seen.values()];
}

/** The records in batches the reading can actually hold, so every passage gets read rather
 *  than cut to one budget of characters. */
function batches(papers, budget = 14000) {
  const out = [];
  let now = [];
  let size = 0;
  for (const p of papers) {
    const piece = `--- ${p.doc}\n${p.text}`;
    if (size + piece.length > budget && now.length) {
      out.push(now.join("\n\n"));
      now = [];
      size = 0;
    }
    now.push(piece);
    size += piece.length;
  }
  if (now.length) out.push(now.join("\n\n"));
  return out;
}

async function harvest(level, uid) {
  const papers = await passages(uid, [
    `${level.caap} witness testimony task carried out work routines observed`,
    `${level.caap} maintenance fault finding repair carried out during the shift`,
    `${level.caap} piloting dive operations tooling intervention survey`,
    `${level.caap} launch recovery deck termination umbilical tether`,
    `${level.caap} supervision briefing toolbox talk planning risk assessment team`,
  ]);
  if (!papers.length) throw new Error(`nothing in the library for ${level.caap}`);
  const lots = batches(papers);
  process.stdout.write(`\n${level.level}\n  ${papers.length} passages in ${lots.length} batches\n`);

  /* Read everything: each batch gives up the jobs it records, and the union is
     what this level does. Grounding happens here — nothing enters the list
     that did not come out of a passage. */
  let tasks = [];
  for (const [n, lot] of lots.entries()) {
    const got = parse(
      await ask(
        `You read completed offshore ROV paperwork and list the jobs it records being done by a ${level.caap}. ${JSON_ONLY} ${SHAPE}`,
        `The records:\n${lot}`,
        { maxTokens: 1600, temperature: 0.2 },
      ),
    );
    for (const t of got) if (!tasks.some((x) => x.toLowerCase() === t.toLowerCase())) tasks.push(t);
    process.stdout.write(`  batch ${n + 1}/${lots.length} — ${tasks.length} tasks so far\n`);
  }

  /* Then the tidying, which is about the list rather than the records: the
     same job said four ways is one job, and a phrase that names nothing in
     particular is not a job at all. */
  for (let pass = 2; pass <= PASSES; pass += 1) {
    const corrected = parse(
      await ask(
        `You are tidying a list of ROV tasks. ${JSON_ONLY} Return the corrected list: merge entries that are the same job worded differently, keeping the clearest wording; split an entry that is really two jobs; drop anything vague that names no particular piece of work ("Co-piloting duties", "Ancillary equipment operation"); drop anything that is a competence, a quality or a framework heading; drop any person, vessel, project, client or date. ${SHAPE} Keep what is already right — do not reword for the sake of it.`,
        `The list:\n${tasks.map((t) => `- ${t}`).join("\n")}`,
        { maxTokens: 1800, temperature: 0 },
      ),
    );
    if (corrected.length) tasks = corrected;
    process.stdout.write(`  tidy ${pass - 1}/${PASSES - 1} — ${tasks.length} tasks\n`);
  }

  /* The task words never travel: it answers with a group per line number, so
     nothing can come back reworded and fail to match what it was given. */
  const sorted = parse(
    await ask(
      `You put each numbered ROV task into one of the groups given. Answer with JSON only: {"of":{"1":"Group name","2":"Group name"}} — one entry per number, nothing else. Use ONLY these group names: ${GROUPS.map((g) => `"${g}"`).join(", ")}.`,
      tasks.map((t, n) => `${n + 1}. ${t}`).join("\n"),
      { maxTokens: 2000, temperature: 0 },
    ),
    "of",
  ).of || {};

  const groups = {};
  const placed = new Set();
  tasks.forEach((t, n) => {
    const unit = GROUPS.find((g) => g.toLowerCase() === String(sorted[n + 1] || "").toLowerCase().trim());
    if (!unit) return;
    (groups[unit] = groups[unit] || []).push(t);
    placed.add(t);
  });
  /* A task the sorting dropped is still a task the records showed. */
  const rest2 = tasks.filter((t) => !placed.has(t));
  if (rest2.length) {
    const home = GROUPS.find((g) => groups[g]) || GROUPS[0];
    groups[home] = [...(groups[home] || []), ...rest2];
    process.stdout.write(`  ${rest2.length} not sorted — put under ${home}\n`);
  }
  return { order: GROUPS.filter((g) => groups[g]?.length), groups, tasks };
}

/* Nothing personal may ship. The prompts forbid it; this is the check that the
   prompts were obeyed, and it refuses to write rather than warn. */
const PERSONAL = [
  /\b(19|20)\d\d\b/,
  /\bseven\s+\w+\b/i,
  /\bmaersk\b|\bnormand\b|\bsanto\b|\bsapura\b/i,
  /\b(mr|mrs|ms)\.?\s+[A-Z]/,
];
function refuse(list) {
  const bad = [];
  for (const t of list) for (const rx of PERSONAL) if (rx.test(String(t.text ?? t))) bad.push(String(t.text ?? t));
  return bad;
}

const [{ user_id: uid }] = await rest("offshore_report_library?select=user_id&limit=1");
const out = { roles: {}, groups: {} };
const seenGroups = new Map();
/**
 * Which rungs of the ladder a job belongs to: the level whose own paperwork records it being done.
 * Kept as the harvest goes, because after the merging the wording has moved on.
 */
const rungs = new Map();
const note = (t, level) => {
  const k = t.toLowerCase();
  rungs.set(k, new Set([...(rungs.get(k) || []), level]));
};
for (const level of LEVELS) {
  const got = await harvest(level, uid);
  const bad = refuse(got.tasks);
  if (bad.length) {
    console.error(`\nFAIL ${level.level}: something personal survived —\n  ${bad.join("\n  ")}`);
    process.exit(1);
  }
  out.roles[level.caap] = got.order;
  for (const g of got.order) {
    const had = seenGroups.get(g) || [];
    const merged = [...had];
    for (const t of got.groups[g]) {
      note(t, level.caap);
      if (!merged.some((x) => x.toLowerCase() === t.toLowerCase())) merged.push(t);
    }
    seenGroups.set(g, merged);
  }
}
/* Four levels read separately produce the same job four ways — "Shift handover
   documentation", "…and briefing", "…and relief crew briefing", "Shift handover
   notes completion". Each level's own passes cannot see that; this one can. */
const levelsOf = (list) => [...new Set(list.flatMap((t) => [...(rungs.get(t.toLowerCase()) || [])]))];
for (const [g, list] of seenGroups) {
  if (list.length < 3) {
    out.groups[g] = list.map((text) => ({ text, levels: levelsOf([text]) }));
    continue;
  }
  /* It answers with the line numbers it merged, so a job that four levels
     worded four ways keeps all four of their names — the merged wording
     cannot be matched back to what it replaced, but the numbers can. */
  const merged = parse(
    await ask(
      `You are merging a numbered list of ROV tasks that four separate readings produced, so the same job appears more than once worded differently. Answer with JSON only: {"tasks":[{"text":"the clearest single wording","was":[1,4]}]}. Every number appears in exactly one entry. Change no wording except to pick the clearest of the ones given. ${SHAPE}`,
      `The list:\n${list.map((t, n) => `${n + 1}. ${t}`).join("\n")}`,
      { maxTokens: 2000, temperature: 0 },
    ),
    "raw",
  ).tasks;
  if (!Array.isArray(merged) || !merged.length) {
    out.groups[g] = list.map((text) => ({ text, levels: levelsOf([text]) }));
    continue;
  }
  out.groups[g] = merged
    .map((m) => {
      const text = String(m.text || "").replace(/\s+/g, " ").trim();
      const was = (Array.isArray(m.was) ? m.was : []).map((n) => list[Number(n) - 1]).filter(Boolean);
      return { text, levels: levelsOf(was.length ? was : [text]) };
    })
    .filter((m) => m.text.length > 5 && m.levels.length);
  if (out.groups[g].length < list.length)
    process.stdout.write(`  ${g}: ${list.length} → ${out.groups[g].length}\n`);
}
/* A job belongs in one group. Two levels can file it differently; the first
   group to claim it keeps it, and it keeps every level that does it. */
const claimed = new Map();
for (const g of Object.keys(out.groups)) {
  out.groups[g] = out.groups[g].filter((t) => {
    const k = t.text.toLowerCase();
    if (claimed.has(k)) {
      const first = claimed.get(k);
      first.levels = [...new Set([...first.levels, ...t.levels])];
      return false;
    }
    claimed.set(k, t);
    return true;
  });
  if (!out.groups[g].length) delete out.groups[g];
}
/* A group a level has no job in is not that level's group. */
for (const role of Object.keys(out.roles))
  out.roles[role] = out.roles[role].filter((g) => out.groups[g]?.some((t) => t.levels.includes(role)));

const total = Object.values(out.groups).reduce((n, l) => n + l.length, 0);
process.stdout.write(`\n${total} tasks in ${Object.keys(out.groups).length} groups\n`);
for (const level of LEVELS) {
  const n = Object.values(out.groups).flat().filter((t) => t.levels.includes(level.caap)).length;
  process.stdout.write(`  ${level.caap}: ${n}\n`);
}
const SHORT = { "ROV Pilot Technician": "PT", "ROV Sub-Engineer": "SE", "ROV Supervisor": "SV", "ROV Superintendent": "SI" };
if (DRY) {
  for (const [g, list] of Object.entries(out.groups)) {
    process.stdout.write(`\n## ${g}\n`);
    for (const t of list)
      process.stdout.write(`  [${t.levels.map((l) => SHORT[l] || l).join(" ")}]  ${t.text}\n`);
  }
} else {
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write(`written to ${OUT}\n`);
}
