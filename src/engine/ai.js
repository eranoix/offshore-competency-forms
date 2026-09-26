/**
 * Generated writing: on when the page can reach the proxy, silently off when it
 * cannot (the offshore case). No key is in the bundle: the page posts to its own
 * /api/ai, which adds the credential on the server and requires a session.
 */
const ENDPOINT = "/api/ai"; // same origin: the server holds the key

/** Unreachable endpoint, blocked certificate, no signal — all the same to us. */
// The offline build has no server to ask, so the writing never switches on.
let reachable = __OFFLINE__ ? false : typeof navigator === "undefined" || navigator.onLine !== false;
const listeners = new Set();

export const isAvailable = () => reachable;
export function onAvailability(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function setReachable(value) {
  if (reachable === value) return;
  reachable = value;
  listeners.forEach((fn) => fn(value));
  if (!value) scheduleRecheck();
}

/* Keep re-probing, slowly and only while unreachable, so one bad minute does
   not leave the page on the phrase bank until it is reloaded. */
let recheck = null;
let wait = 15_000;
function scheduleRecheck() {
  if (recheck || __OFFLINE__ || typeof window === "undefined") return;
  recheck = setTimeout(async () => {
    recheck = null;
    if (reachable) return;
    if (!(await probe())) {
      wait = Math.min(wait * 2, 120_000);
      scheduleRecheck();
    } else {
      wait = 15_000;
    }
  }, wait);
}

if (typeof window !== "undefined") {
  window.addEventListener("offline", () => setReachable(false));
  window.addEventListener("online", () => setReachable(!__OFFLINE__));
  /* A tab in the background has its timers throttled to about one a minute, so
     the slow re-check cannot be the only way back. Looking at the page is the
     other way: whenever it comes to the front, ask the endpoint again. */
  const lookAgain = () => {
    if (!reachable && !__OFFLINE__ && document.visibilityState === "visible") probe();
  };
  document.addEventListener("visibilitychange", lookAgain);
  window.addEventListener("focus", lookAgain);
}

/**
 * When the upstream tokens-per-minute limit is full, every call waits out the
 * time the first refusal reported, so the minute is waited once by everyone and
 * no request is sent into a minute already known to be full.
 */
let shutUntil = 0;
let telling = null;

/** Tells you how long the door is shut, whenever that changes. */
export function onBusy(fn) {
  telling = fn;
  return () => { telling = null; };
}

const doorIsShut = () => Math.max(0, shutUntil - Date.now());
const shutFor = (seconds) => {
  const until = Date.now() + seconds * 1000;
  if (until <= shutUntil) return;
  shutUntil = until;
  telling?.(seconds);
};
async function waitAtTheDoor() {
  for (let left = doorIsShut(); left > 0; left = doorIsShut()) {
    await new Promise((r) => setTimeout(r, Math.min(left, 1000)));
  }
}

export async function ask(system, user, { maxTokens = 400, temperature = 0.85, context = null, use } = {}) {
  // Asking is itself the best test: if we think we are offline, look again
  // before refusing, so a button press is never wasted on a stale verdict.
  if (!reachable && !(await probe())) throw new Error("offline");
  await waitAtTheDoor();
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        max_tokens: maxTokens,
        temperature,
        system,
        // What this is about, so the server can look the matching pages of your
        // own library out and show them to the writing. The documents never
        // come to the browser.
        context,
        use,
        messages: [{ role: "user", content: user }],
      }),
    });
  } catch {
    setReachable(false); // no signal, or the certificate was refused
    throw new Error("offline");
  }
  if (res.status === 429) {
    /* Wait exactly as long as the refusal says is left of the minute: guessed
       backoff spends every retry inside the same full minute. */
    const said = await res.text().catch(() => "");
    const found = said.match(/retry[^0-9]{0,20}(\d+(?:\.\d+)?)\s*s/i)
      || said.match(/"retry_after"\s*:\s*(\d+(?:\.\d+)?)/i);
    const header = Number(res.headers.get("retry-after"));
    const seconds = Number(found?.[1]) || (Number.isFinite(header) && header > 0 ? header : 0);
    const busy = new Error("busy");
    /* A minute and a quarter is the whole window and then some: anything
       longer than that is not a rate limit, and waiting on it would look like
       the panel had hung. */
    busy.retryIn = Math.min(75, Math.max(1, Math.ceil(seconds || 20)));
    /* And the door is shut for everyone, not only for this caller. */
    shutFor(busy.retryIn);
    throw busy;
  }
  if (!res.ok) {
    // A gateway error is the writing machine having a bad minute, not the end
    // of the session: ask the endpoint itself whether it is still there.
    if (res.status >= 500) probe();
    throw new Error(`endpoint returned ${res.status}`);
  }
  const data = await res.json();
  const text = Array.isArray(data?.content)
    ? data.content
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("")
    : "";
  if (!text.trim()) throw new Error("empty answer");
  setReachable(true);
  return text.trim();
}

/** Quiet check at start-up: are we able to write today? */
export async function probe() {
  if (__OFFLINE__) return false;
  try {
    // A HEAD on the writing endpoint is enough to know whether we are online:
    // any answer at all means the server is there.
    const res = await fetch(ENDPOINT, { method: "HEAD", cache: "no-store" });
    // 404 means there is no endpoint here at all (a plain static copy), not
    // that the endpoint is having a bad day.
    const up = res.status !== 404 && res.status < 500;
    setReachable(up);
    return up;
  } catch {
    setReachable(false);
    return false;
  }
}

const SCORE_MEANING = {
  1: "Not Performed — the requirement was not met",
  2: "Requires Improvement — below the standard for the grade",
  3: "On Target — meets the standard for the grade",
  4: "Above Target — better than the grade requires",
  5: "Outstanding — exceptional for the grade",
};

/* The rules that hold whatever the document is. The identity line above them
   changes with the paperwork being written: a witness testimony is not a trip
   feedback, and a model told otherwise writes the wrong title at the top. */
const SHARED_STYLE = `House style:
- British English, plain and factual — the register a supervisor actually writes in.
- Answer with the body text only. Never open with a title, a heading, a form name,
  a date line or anything in block capitals: the box on the form already says what
  the document is, and a heading inside it has to be deleted by hand.
- Describe observable behaviour, never personality. No stacked praise, no HR filler.
- You may state as fact ONLY what the supervisor supplied under "What actually
  happened". Everything else must describe habitual behaviour — what he does, how he
  works — never a specific event of your own invention: no "identified a rigging
  conflict" unless it was given to you. An invented example reaches HR as if it had
  happened.
- When facts are supplied, lead with them. They are the reason this document is worth
  reading.
- Do not comment on where anyone is from or whether English is their first language.
- Third person, referring to the crew member by first name or simply "he". If no name
  was given, write "he" — never a placeholder such as [Name] or the crew member's role
  in square brackets.
- Write a name EXACTLY as it was supplied. "A. Moreau" stays "A. Moreau": never
  expand an initial into a first name, never guess a surname, never tidy a spelling.
  An invented name is a lie about a person on a document that goes into their file.
- No markdown, no surrounding quotes, no commentary.
- You are filling in a document, not answering a person. Never address whoever
  asked, never ask for more information, never explain what you cannot do:
  write the document with what you were given.`;

const HOUSE_STYLE = `You write Worksite Trip Feedback for offshore ROV crews (Northwind Offshore form NW-CAP-001).

This form is about the man, not about the job. It records how he worked over the
trip: how he behaved, how he was with the people around him, the care he put into
his work, and how he came on between the first day and the last. It is read by the
people deciding what he is ready for next, so it is where his high points go on
record.
- Never write what was worked on. No tasks, no tooling, no systems, no dives, no
  operations, no scope of work: those belong on the competence paperwork, not here.
  Where a sentence would name a job, name the behaviour instead — not "he carried out
  the torque tool change-out", but "he finishes what he starts and leaves a clean job
  for the next shift".
- Development is the point of the form. Say what he was like when he arrived, what he
  picked up, and where he ended the rotation.
- Lead on what he is good at, in the plain words a supervisor would actually use about
  somebody he has just done six weeks with.
- The scores are: 1 Has Not Performed, 2 Requires Improvement, 3 On Target, 4 Above
  Target, 5 Outstanding. THREE IS A GOOD MARK. It says he does what the grade asks,
  properly, and it is written as a solid, dependable trip — never as a shortfall, and
  never hedged with "but", "although", "still needs" or "under supervision". Only 1
  and 2 are criticism; 4 and 5 are better than the grade requires.
${SHARED_STYLE}`;

/* Trip feedback is the call that leaves `house` alone. The competence paperwork
   passes `evidenceStyle(...)`, whose subject is the work; given that vocabulary,
   a trip feedback comes back as a list of jobs. */
const isFeedback = (house) => house === HOUSE_STYLE;

/** The competence paperwork: same rules, a different document on the desk. */
export const evidenceStyle = (what) =>
  `You write ${what} for offshore ROV crews. It is a record of what was done and seen at the work site — never a trip feedback, and never a summary of the programme.
${SHARED_STYLE}
- The campaign's scope, tooling and systems are the setting of the trip, not a list
  of this person's jobs. Write them as the scope — "the campaign covered flexible lay
  and hot stab intervention; he worked within that scope" — and never as things he
  personally did: "he supported first end initiation" is a claim about a man, and
  unless the supervisor wrote it down, nobody made it.
- One exception to the rule above about markdown, and one only: the words that
  name a task or an area of the scheme are wrapped in **double asterisks**, in
  the middle of the sentence that answers them. That is what lets a reader find
  the evidence for an area on the page. Nothing else is marked: no headings, no
  bullets, no italics. If a text comes back to you without those markers, put
  them in.`;

/** What the server searches the library with — the shape of this trip. */
function hint(ctx, extra = {}) {
  const f = ctx?.fixed || {};
  return {
    campaign: f.campaign || "",
    scope: f.scope_short || "",
    position: f.position || "",
    vessel: f.vessel || "",
    ...extra,
  };
}

function contextLines(ctx, notes, { setting = true } = {}) {
  const f = ctx?.fixed || {};
  const given = String(notes || "").trim();
  return [
    given ? `What actually happened (supplied by the supervisor — use it):\n${given}\n` : "",
    setting ? `Campaign: ${f.campaign || "ROV operations"}` : "",
    setting ? `Work scope: ${f.scope_short || "the workscope"}` : "",
    `Position: ${f.position || "ROV Sub Tech"}`,
    `Vessel: ${f.vessel || "the vessel"}`,
    /* The trip's own setting. Labelled for what it is: read as a list of this
       person's achievements, it put jobs in his file that nobody said he did. */
    setting && (ctx?.pools?.task?.length || ctx?.pools?.tool?.length || ctx?.pools?.system?.length)
      ? "What the campaign covered (the scope of the trip — NOT a record of what this person did):"
      : "",
    setting && ctx?.pools?.task?.length ? `  work on the vessel: ${ctx.pools.task.slice(0, 6).join("; ")}` : "",
    setting && ctx?.pools?.tool?.length ? `  tooling aboard: ${ctx.pools.tool.slice(0, 5).join("; ")}` : "",
    setting && ctx?.pools?.system?.length ? `  systems aboard: ${ctx.pools.system.slice(0, 5).join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const strip = (t) => t.replace(/^["'\s]+|["'\s]+$/g, "");

/** One criterion comment, different from everything already used. */
export async function freshComment({ label, score, ctx, avoid = [], limit = 170, notes = "" }) {
  const text = await ask(
    HOUSE_STYLE,
    `Write ONE comment for the criterion "${label}", scored ${score} (${SCORE_MEANING[score]}).

It says what this man is like in that respect — how he behaves, how he works, how he
is with the people around him — and never what he worked on.

${contextLines(ctx, notes, { setting: false })}

Hard limit: ${limit} characters, one or two sentences.
These wordings have been used before — say it differently:
${avoid.slice(0, 12).map((a) => `- ${a}`).join("\n") || "- (nothing yet)"}`,
    { maxTokens: 220, context: hint(ctx, { criterion: label, notes }) },
  );
  return strip(text).split("\n")[0].slice(0, limit + 30);
}

/** Rewrites a block you already have, keeping every fact and the score it implies. */
export async function improve({ text, kind, ctx, instruction = "", notes = "", house = HOUSE_STYLE, maxTokens = 900 }) {
  const what =
    kind === "crew"
      ? "the crew member's own reply to the feedback, written in the first person"
      : kind === "evidence"
        ? "the statement on the form — three or four short paragraphs, no heading"
        : kind === "supervisor"
          ? "the supervisor's comments on the man — three or four short paragraphs, third person"
          : "a single criterion comment";
  const answer = await ask(
    house,
    `Rewrite ${what}. Keep the standard it describes and every fact already in it, work in anything supplied below that is missing, and change the wording so it reads fresh and natural.${
      instruction ? `\nExtra instruction: ${instruction}` : ""
    }

${contextLines(ctx, notes, { setting: !isFeedback(house) })}

Current text:
${text}`,
    { maxTokens, context: hint(ctx, { kind, notes, instruction }) },
  );
  return strip(answer);
}

/** Writes one block from scratch, around the scores and whatever was supplied. */
export async function writeBlock({
  kind,
  ctx,
  criteria,
  notes = "",
  instruction = "",
  house = HOUSE_STYLE,
  maxTokens = 900,
  temperature,
  /* What the library should be searched with. Left to the notes, the search
     filled up on the campaign and the vessel and never reached the words that
     matter — the form and the areas being evidenced. */
  search = null,
  useFacts = false,
  /* The library is a style guide, and the paperwork in it is written by
     assessors. A block written in the candidate's own voice must not be shown
     assessors' wording to follow. */
  library = true,
}) {
  const scored = Object.entries(criteria || {})
    .map(([key, v]) => `${key}: ${v.score}`)
    .join(", ");
  const what =
    kind === "crew"
      ? "the crew member's own reply to this feedback, first person, two short paragraphs"
      : kind === "evidence"
        ? "the statement the form asks for, three or four short paragraphs, starting with the work itself"
        : "the supervisor's comments on the man: three or four short paragraphs, third person — how he was to have on the shift, what stands out about the way he works, how he came on over the rotation, then the sign-off";
  /* Only a trip feedback carries scores. Sent an empty score line, the model
     stopped writing and asked for them — on the paper. */
  const scoring = scored
    ? `\n\nScores given: ${scored}\n1 Has Not Performed · 2 Requires Improvement · 3 On Target · 4 Above Target · 5 Outstanding.\nThe tone must match them. A 3 reads as solid and dependable, not as a shortfall; only a 1 or a 2 is written as a concern.`
    : "";
  const answer = await ask(
    house,
    `Write ${what}.

${contextLines(ctx, notes, { setting: !isFeedback(house) })}${scoring}${instruction ? `\nExtra instruction: ${instruction}` : ""}`,
    {
      maxTokens,
      ...(typeof temperature === "number" ? { temperature } : {}),
      context: library ? search || hint(ctx, { kind, notes, instruction }) : null,
      use: useFacts ? "facts" : undefined,
    },
  );
  return strip(answer);
}

/* The supervisor's two calls: one reads the document and answers with a
   verdict, the other repairs it against a list of faults. Both run cold: a
   reviewer that improvises is no reviewer. */

/** A second reader: which topics are still unanswered, and what else is wrong. */
export async function review({ text, topics = [], tasks = [], what = "a document of evidence" }) {
  const listed = [...tasks.map((t) => `TASK: ${t}`), ...topics.map((t) => `AREA: ${t}`)];
  if (!listed.length) return { missing: [], problems: [] };
  const verdict = await ask(
    `You check documents of competence evidence before they are signed. You answer with JSON only: {"missing":["..."],"problems":["..."]}. "missing" lists, verbatim, each TASK or AREA below that the document does not actually answer — paraphrase counts as answered, a passing mention of the words does not. "problems" lists anything else wrong in one short sentence each: a heading, bullet points, addressing the reader, refusing to write, an invented name, a name changed from the one supplied, or the wrong voice for the document. Words wrapped in **double asterisks** are deliberate — they mark the topic each sentence answers — so never report them as a problem. Empty lists mean it passed.`,
    `What this document is: ${what}

The document had to cover:
${listed.join("\n")}

The document as written:
${text}`,
    { maxTokens: 900, temperature: 0, context: { kind: "review" } },
  );
  try {
    const parsed = verdictIn(verdict, "missing") || verdictIn(verdict, "problems");
    if (!parsed) throw new Error("no verdict");
    return {
      missing: Array.isArray(parsed.missing) ? parsed.missing.slice(0, 40) : [],
      problems: Array.isArray(parsed.problems) ? parsed.problems.slice(0, 20) : [],
    };
  } catch {
    return { missing: [], problems: [] };
  }
}

/** Repairs a document against the faults found, keeping everything already right. */
export async function mend({ text, faults = [], house = HOUSE_STYLE, ctx, notes = "", maxTokens = 2000, library = true }) {
  if (!faults.length) return text;
  const fixed = await ask(
    house,
    `Repair the document below. Keep every fact; change what these faults require — where a fault is about the voice or the person speaking, rewrite every sentence that breaks it — and return the whole document, nothing else.

Faults to fix:
${faults.map((f) => `- ${f}`).join("\n")}

${contextLines(ctx, notes, { setting: !isFeedback(house) })}

The document:
${text}`,
    { maxTokens, temperature: 0.4, context: library ? hint(ctx, { kind: "mend" }) : null },
  );
  return strip(fixed);
}

/** Turns a text about someone into that person's own words. A narrow rewrite:
 *  no context, no library, nothing to drift towards. */
export async function speakAsMe({ text, who = "the candidate", maxTokens = 1400 }) {
  const out = await ask(
    `You rewrite a text so that its speaker is ${who}, writing about their own work. Replace every third-person reference to ${who} with I, me or my, and adjust the verbs. Keep every fact, every paragraph and every **bold** marker exactly as they are. Change nothing else. Answer with the rewritten text only.`,
    text,
    { maxTokens, temperature: 0.2, context: null },
  );
  return strip(out);
}

/* Writing that cannot be traced back to a document is invention. These calls
   fetch the passages a piece of writing should rest on, then judge it against them. */

/** The passages of this person's library that bear on a search. */
export async function passagesFor(search, n = 10) {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ want: "passages", context: search, n }),
    });
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body.passages) ? body.passages : [];
  } catch {
    return [];
  }
}

/**
 * The verdict out of an answer that was asked for JSON only. A reply can hold
 * several objects with prose between them, so each balanced object is tried, last
 * first (the one the reader settled on); `wants` names a key the verdict must carry.
 */
export function verdictIn(answer, wants) {
  const said = String(answer ?? "");
  const found = [];
  for (let i = 0; i < said.length; i += 1) {
    if (said[i] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < said.length; j += 1) {
      const c = said[j];
      if (escaped) { escaped = false; continue; }
      if (c === "\\" && inString) { escaped = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) { found.push(said.slice(i, j + 1)); i = j; break; }
      }
    }
  }
  for (let k = found.length - 1; k >= 0; k -= 1) {
    try {
      const parsed = JSON.parse(found[k]);
      if (parsed && typeof parsed === "object" && (!wants || wants in parsed)) return parsed;
    } catch { /* not this one */ }
  }
  return null;
}

/**
 * Which statements in a text have no support in the records. The jobs marked on
 * the document are what the signer attests and are taken as settled; the records
 * ground everything around them, including any job claimed that nobody marked.
 */
export async function unsupported({ text, passages = [], did = [], who = "", given = {} }) {
  if (!passages.length || !String(text || "").trim()) return [];
  const attested = did.filter(Boolean);
  /* What the panel put on the form (name, rank, vessel, assessor, date) is not
     the writing's to invent and not the records' to confirm. */
  const typed = Object.entries(given)
    .filter(([, v]) => String(v || "").trim())
    .map(([k, v]) => `- ${k}: ${String(v).trim()}`);
  const verdict = await ask(
    `You check a piece of competence evidence against the records it must come from. Answer with JSON only: {"invented":["..."]} — one object, nothing after it.

List, quoting the phrase, every PARTICULAR the text states as fact that the records below do not show. A particular is something a person could go and look up: a proper name (a vessel, a site, a client, a system), a model or part number, a figure, a depth, a pressure, a date, a named one-off event. Every phrase you list must contain one of those. Wording may differ from the records; the substance may not.

Ordinary description is not a particular and is never listed: how a job was carried out, what someone checked or confirmed, the order they worked in, what they are like to work with, or any word that names a common piece of kit without naming which one. The manner of the work is part of what the signer attests; only the looked-up facts are yours. General statements of habitual practice the records do show are supported, and a record describing the SCOPE of a trip supports statements about that trip.

Two things are never yours to check, because they are what the document is signed to attest and no record could hold them: that the writer was there and saw what they describe, and that ${who || "the candidate"} carried out the work listed below. Take both as given. Never quote a phrase back merely because the records do not name that person doing it, or do not place the writer on board.

A job claimed that is NOT on the list below is a particular like any other: if the records do not show it, list it. An empty list means every particular it states is in the records.${
      typed.length
        ? `\n\nThese came off the form itself — they are what this document is FOR, not something the writing made up, and they are never yours to list however the records read:\n${typed.join("\n")}`
        : ""
    }${
      attested.length ? `\n\nWhat ${who || "the candidate"} did, which you take as given:\n${attested.map((t) => `- ${t}`).join("\n")}` : ""
    }`,
    `The records:
${passages.map((p) => `--- ${p.doc}\n${p.text}`).join("\n\n").slice(0, 14000)}

The text to check:
${text}`,
    { maxTokens: 900, temperature: 0, context: null },
  );
  try {
    const parsed = verdictIn(verdict, "invented");
    if (!parsed) throw new Error("no verdict");
    return Array.isArray(parsed.invented) ? parsed.invented.slice(0, 20) : [];
  } catch {
    /* An answer that cannot be read is not a clean bill of health. Saying so
       lets the caller tell you the check did not run. */
    throw new Error("the grounding check could not be read");
  }
}

/** A reader whose only question is whether a person wrote this. */
export async function soundsHuman({ text, what = "a piece of competence evidence" }) {
  const verdict = await ask(
    `You read paperwork and say whether a working person wrote it or a machine did. Answer with JSON only: {"human":true|false,"faults":["..."]}. Mark it machine-written if it pads, repeats itself, praises instead of recording, uses words nobody says out loud, runs every sentence to the same length, or explains what it is about to say. Each fault is one short sentence naming what to change. A plain, factual, slightly uneven record written by a supervisor is human — do not ask for polish.`,
    `What this is: ${what}\n\nThe text:\n${text}`,
    { maxTokens: 700, temperature: 0, context: null },
  );
  try {
    const parsed = verdictIn(verdict, "human");
    if (!parsed) throw new Error("no verdict");
    return { human: parsed.human !== false, faults: Array.isArray(parsed.faults) ? parsed.faults.slice(0, 8) : [] };
  } catch {
    return { human: true, faults: [] };
  }
}
