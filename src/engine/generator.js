/**
 * Trip feedback engine: picks the scores, builds the campaign context and writes the
 * comments from the lexicon. Pure — no DOM, no state of its own.
 */
import vocab from "./vocab.json";
import templates from "./templates.json";
import { pickFresh } from "./memory";

export const V = vocab;
export const T = templates;

export const CRITERIA = [
  ["safety", "Safety Behaviour and Awareness"],
  ["quality", "Quality of Work"],
  ["knowledge", "Knowledge of Role"],
  ["technical", "Technical and Practical Ability"],
  ["english", "English Language Proficiency", "(Verbal and Written)"],
  ["initiative", "Initiative"],
  ["decision", "Decision Making"],
  ["motivation", "Motivation"],
  ["teamwork", "Teamwork Skills"],
  ["attendance", "Attendance and Punctuality"],
  ["communication", "Communication"],
];
export const KEYS = CRITERIA.map((c) => c[0]);
export const LABEL = Object.fromEntries(
  CRITERIA.map(([k, a, b]) => [k, b ? `${a} ${b}` : a]),
);

/** These three are rarely a crew member's standout — last in line for a 5. */
const LESS_LIKELY = ["english", "communication", "decision"];
const COMMENT_LIMIT = 175; // fits two lines of the comments cell

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => {
  const c = a.slice();
  for (let i = c.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c;
};

/** "Flexlay campaign - ROV support to X, Y" -> "the flexlay scope, X, Y" */
export function shortScope(scope) {
  let s = (scope || "").trim().replace(/\.$/, "");
  s = s.split(/\s+-\s+|\s+–\s+/).slice(-1)[0];
  s = s.replace(/^ROV support to /i, "");
  return s ? s[0].toLowerCase() + s.slice(1) : "the workscope";
}

/** Everything in one document comes from the same world: the chosen campaign. */
export function buildContext(doc) {
  const camp = V.campaigns[doc.campaign] || V.campaigns.flexlay;
  const pools = {
    task: shuffle(camp.tasks),
    tool: shuffle(camp.tooling.concat(shuffle(V.tooling).slice(0, 6))),
    system: shuffle(camp.systems.concat(shuffle(V.rov_systems).slice(0, 6))),
    fault: shuffle(V.faults),
    fix: shuffle(V.fix_actions),
    hse: shuffle(V.hse),
    hse_rules: shuffle(V.hse_rules),
    people: shuffle(V.people),
    inspection: shuffle(V.inspection || ["the inspection scope"]),
  };
  const used = new Set();

  /* Which of the campaign's jobs the supervisor actually wrote down.
     A comment that names a service is a claim that this person was on it, so
     it may only name one the notes mention. Everything else is described by
     what he does, not by a job nobody recorded him doing. */
  const said = String(doc.notes || "").toLowerCase();
  const mentions = (entry) => {
    const keys = String(entry)
      .toLowerCase()
      .match(/[a-z][a-z0-9-]{3,}/g) || [];
    const solid = keys.filter((w) => !["the", "and", "with", "during", "from", "into", "unit", "units"].includes(w));
    if (!solid.length) return false;
    return solid.filter((w) => said.includes(w)).length / solid.length >= 0.6;
  };
  const grounded = said.trim()
    ? { task: pools.task.filter(mentions), tool: pools.tool.filter(mentions), system: pools.system.filter(mentions) }
    : { task: [], tool: [], system: [] };

  const firstName = (t) => (t || "").trim().split(/\s+/)[0] || t || "";
  // With an empty field the sentence still has to read: "on board the {vessel}"
  // must become "on board the vessel", never "the the vessel".
  const fixed = {
    crew: doc.crew || "the crew member",
    first: firstName(doc.crew) || "he",
    vessel: doc.vessel || "vessel",
    position: doc.position,
    sup: doc.supervisor || "the supervisor",
    sup_first: firstName(doc.supervisor) || "the supervisor",
    campaign: camp.name.toLowerCase(),
    scope_short: shortScope(doc.workScope),
    region: pick(V.regions),
    condition: pick(V.conditions),
  };
  return {
    pools,
    grounded,
    fixed,
    take(slot) {
      const p = grounded[slot]?.length ? grounded[slot] : pools[slot];
      if (!p) return "";
      const free = p.filter((x) => !used.has(x));
      const chosen = pick(free.length ? free : p);
      used.add(chosen);
      return chosen;
    },
  };
}

/**
 * A slot can land at the start of a sentence, so capitalise sentence starts.
 * A single capital standing alone before the stop is an initial ("A. Moreau"), not a sentence
 * end; "the ROV." still ends one.
 */
const capitalise = (t) =>
  t.replace(/(^|\n\n|(?<!(?:^|[^A-Za-z])[A-Z])[.!?]\s+)([a-z])/g,
    (m, before, letter) => before + letter.toUpperCase());

export function fill(template, ctx) {
  const text = template.replace(/\{([a-z_0-9]+)\}/g, (m, name) => {
    if (name in ctx.fixed) return ctx.fixed[name];
    const base = name.replace(/[0-9]+$/, "");
    return base in ctx.pools ? ctx.take(base) : m;
  });
  return capitalise(text);
}

/**
 * Score presets — the band the whole document sits in.
 *
 * A preset is a mix: how much of the sheet sits on each score. The eleven
 * criteria are handed out to match it as closely as eleven rows allow, so the
 * same preset always produces the same shape, never a flat sheet.
 *
 *   Bad        70% at 3, 30% at 2          (8 and 3 of eleven)
 *   Medium     90% at 3, 10% at 4          (10 and 1)
 *   Good       60% at 3, 40% at 4          (7 and 4)
 *   Very good  60% at 3, 30% at 4, 10% 5   (7, 3 and 1)
 */
export const PRESETS = {
  bad: { label: "Bad", mix: [[3, 0.7], [2, 0.3]] },
  medium: { label: "Medium", mix: [[3, 0.9], [4, 0.1]] },
  good: { label: "Good", mix: [[3, 0.6], [4, 0.4]] },
  very_good: { label: "Very good", mix: [[3, 0.6], [4, 0.3], [5, 0.1]] },
};

/** The score the preset leans on — the biggest share of the sheet. */
const mainScore = (preset) => preset.mix.reduce((a, b) => (b[1] > a[1] ? b : a))[0];

/**
 * Turn the shares into whole rows. Eleven criteria never divide evenly into a
 * percentage, so the leftovers go to the scores that were closest to another
 * whole row — the standard way to round a share into seats.
 */
export function countsFor(mix, rows) {
  const want = mix.map(([score, share]) => {
    const exact = share * rows;
    return { score, n: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let left = rows - want.reduce((sum, w) => sum + w.n, 0);
  for (const w of [...want].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break;
    w.n += 1;
    left -= 1;
  }
  return want.map(({ score, n }) => ({ score, n }));
}

/**
 * English, Communication and Decision Making are rarely anyone's standout, so
 * they queue last for a score above the preset's own, and first for one below.
 *
 * Scores already fixed by hand count towards the mix: the sheet as a whole is
 * what has to match the preset, not the rows that happen to be left over.
 */
export function scorePlan(keys, held = {}, presetKey = "good") {
  const preset = PRESETS[presetKey] || PRESETS.good;
  const main = mainScore(preset);
  const counts = countsFor(preset.mix, KEYS.length);
  const slot = (score) => counts.find((c) => c.score === score);

  for (const value of Object.values(held)) {
    const taken = slot(value);
    if (taken && taken.n > 0) taken.n -= 1;
  }

  // A hand-set score outside the mix leaves the books short or long; the
  // preset's own score absorbs the difference.
  let off = counts.reduce((sum, c) => sum + c.n, 0) - keys.length;
  const home = slot(main) || counts[0];
  while (off > 0) {
    const from = counts.find((c) => c.n > 0 && c !== home) || home;
    from.n -= 1;
    off -= 1;
  }
  if (off < 0) home.n -= off;

  const front = shuffle(keys.filter((k) => !LESS_LIKELY.includes(k)));
  const back = shuffle(keys.filter((k) => LESS_LIKELY.includes(k)));
  const plan = {};
  const left = new Set(keys);

  // Furthest from the preset's own score first: those are the rows that carry
  // the shape, and they should not be left with whatever is still unassigned.
  for (const { score, n } of [...counts].sort(
    (a, b) => Math.abs(b.score - main) - Math.abs(a.score - main),
  )) {
    const queue = (score > main ? front.concat(back) : back.concat(front)).filter((k) =>
      left.has(k),
    );
    for (const key of queue.slice(0, Math.max(0, n))) {
      plan[key] = score;
      left.delete(key);
    }
  }
  for (const key of left) plan[key] = main;
  return plan;
}

export const average = (criteria) =>
  KEYS.reduce((sum, k) => sum + criteria[k].score, 0) / KEYS.length;

/* The slots that name a piece of work. Filling one is a claim that this person
   was on that job, so a comment may only use them when the supervisor's notes
   name it. */
const NAMES_WORK = ["task", "tool", "system", "fault", "fix", "inspection"];

/** Can this phrase be used without putting an unrecorded job in his file? */
function grounded(template, ctx) {
  const slots = [...String(template).matchAll(/\{([a-z_0-9]+)\}/g)].map((m) => m[1].replace(/[0-9]+$/, ""));
  return slots.every((slot) => !NAMES_WORK.includes(slot) || ctx.grounded?.[slot]?.length);
}

export function comment(key, score, ctx, used = new Set(), meta = {}) {
  // `meta.from` comes back with the phrase this was built from, so the document
  // can say later — when it is actually issued — what it has spent.
  const bank = T.criteria[key];
  const pool =
    bank[String(score)] || bank["4"] || ["Meets the standard expected for the grade."];
  const { pool: candidates, exhausted } = pickFresh(pool, used);
  meta.exhausted = exhausted;
  /* Prefer the phrases that name no job. Three quarters of the bank names
     none, so this costs almost no variety and keeps every comment true. */
  const safe = candidates.filter((t) => grounded(t, ctx));
  const choose = safe.length ? safe : candidates;
  let shortest = null;
  for (const template of shuffle(choose)) {
    const text = fill(template, ctx);
    if (text.length <= COMMENT_LIMIT) {
      used.add(template);
      meta.from = template;
      return text;
    }
    if (!shortest || text.length < shortest[1].length) shortest = [template, text];
  }
  used.add(shortest[0]);
  meta.from = shortest[0];
  return shortest[1];
}

/** Draws from a prose bank, preferring what no document of yours has used. The
 *  drawn set is what the block is made of, and is handed back with it. */
function draw(pool, used = new Set()) {
  const { pool: candidates } = pickFresh(pool, used);
  const chosen = pick(candidates);
  used.add(chosen);
  return chosen;
}

/**
 * The two prose blocks. `trim` > 0 shortens them to fit page one.
 * The tone follows the scores: a document full of 2s cannot close with praise,
 * so low scores swap the highlights for the concerns and change the sign-off.
 */
export function writeBlocks(ctx, criteria, trim = 0) {
  const s = T.supervisor;
  const avg = average(criteria);
  /* Three is On Target: a sheet that averages three is a solid trip and is written as one.
     The scale's own meaning is the threshold. */
  const ON_TARGET = 3;
  const solid = avg >= ON_TARGET;
  // A praising opening on top of a critical body reads as two different people:
  // below the band the opening turns factual.
  const drawn = new Set();
  const blocks = [fill(draw(solid ? s.opening : s.opening_low, drawn), ctx)];
  const howMany = Math.max(1, 2 - trim);

  const best = shuffle(KEYS.filter((k) => criteria[k].score >= 4 && s.highlight[k]))
    .sort((a, b) => criteria[b].score - criteria[a].score);
  const worst = shuffle(KEYS.filter((k) => criteria[k].score <= 2 && s.concern[k]))
    .sort((a, b) => criteria[a].score - criteria[b].score);
  const praise = (ks) => ks.slice(0, howMany).map((k) => fill(draw(s.highlight[k], drawn), ctx));
  const concerns = (ks) => ks.slice(0, howMany).map((k) => fill(draw(s.concern[k], drawn), ctx));
  /* What comes next for him: more responsibility above the band, the basics below it. Two banks,
     so a report saying he needs close supervision never says he is ready for more. */
  const next = () => fill(draw(solid ? s.development : s.development_low, drawn), ctx);

  let body;
  let closing;
  if (solid) {
    body = praise(best);
    /* On target overall does not mean nothing was said. A criterion actually
       scored 1 or 2 is a concern the supervisor put there on purpose, and it
       goes in beside the high points instead of being written out by them. */
    if (worst.length) body = body.slice(0, Math.max(1, howMany - 1)).concat(concerns(worst.slice(0, 1)));
    if (!body.length) body = [fill(draw(s.middle, drawn), ctx)];
    closing = draw(s.closing, drawn);
  } else if (avg >= 2.5) {
    // Halfway: one strength and one point to develop, side by side.
    body = praise(best.slice(0, 1)).concat(concerns(worst.slice(0, 1)));
    if (!body.length) body = [next()];
    closing = draw(s.closing_mid, drawn);
  } else {
    body = concerns(worst);
    if (!body.length) body = [next()];
    closing = draw(s.closing_low, drawn);
  }
  blocks.push(body.join(" "));

  if (trim < 2) {
    const source = solid ? s.middle : s.middle_low;
    let middle = fill(draw(source, drawn), ctx);
    if (trim === 0 && (!solid || Math.random() < 0.55))
      middle += " " + next();
    blocks.push(middle);
  }
  blocks.push(fill(closing, ctx));

  let crew = fill(draw(avg < 3 ? T.crew_low : T.crew, drawn), ctx);
  if (trim >= 2) crew = crew.split("\n\n")[0];
  return { supervisor: blocks.join("\n\n"), crew, from: [...drawn] };
}

/** A whole document: scores, comments and both prose blocks. */
export function generateDocument(doc, { locked = {}, keepScores = null, preset = "good" } = {}) {
  const ctx = buildContext(doc);
  const held = keepScores
    ? Object.fromEntries(KEYS.map((k) => [k, keepScores[k].score]))
    : { ...locked };
  const free = KEYS.filter((k) => !(k in held));
  const plan = scorePlan(free, held, preset);
  const used = new Set();
  const exhausted = [];
  const criteria = Object.fromEntries(
    KEYS.map((k) => {
      const score = k in held ? held[k] : plan[k];
      const meta = {};
      const text = comment(k, score, ctx, used, meta);
      if (meta.exhausted) exhausted.push(k);
      return [k, { score, comment: text, from: meta.from }];
    }),
  );
  return { criteria, blocks: writeBlocks(ctx, criteria), ctx, exhausted };
}

/** One score, rolled with the preset's own odds. */
export function rollScore(presetKey = "good") {
  const p = PRESETS[presetKey] || PRESETS.good;
  let roll = Math.random();
  for (const [score, share] of p.mix) {
    roll -= share;
    if (roll <= 0) return score;
  }
  return p.mix[0][0];
}

/** Rewrites the wording only, keeping the scores and anything edited by hand. */
export function rewrite(doc, criteria, edited = {}) {
  const ctx = buildContext(doc);
  const used = new Set();
  const exhausted = [];
  const next = Object.fromEntries(
    KEYS.map((k) => {
      if (edited[k]) return [k, criteria[k]];
      const meta = {};
      const text = comment(k, criteria[k].score, ctx, used, meta);
      if (meta.exhausted) exhausted.push(k);
      return [k, { score: criteria[k].score, comment: text, from: meta.from }];
    }),
  );
  return { criteria: next, blocks: writeBlocks(ctx, next), ctx, exhausted };
}

export const campaignList = () =>
  Object.entries(V.campaigns).map(([key, c]) => ({ key, name: c.name, scopes: c.scopes }));

export const formatDate = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
};
