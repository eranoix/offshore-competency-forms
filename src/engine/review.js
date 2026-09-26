/**
 * Mechanical checks on a document of evidence: every area answered, in the form's register, with no
 * heading, no addressing anyone and no name nobody supplied.
 */

/* Words too common in a competence framework to prove anything. */
const STOP = new Set([
  "the", "and", "of", "to", "a", "in", "with", "for", "on", "that", "is", "are", "as", "by", "or",
  "at", "from", "all", "any", "their", "this", "it", "be", "an", "his", "her", "they", "them",
  "demonstrate", "demonstrates", "demonstrated", "ability", "able", "knowledge", "understanding",
  "understand", "ensure", "ensures", "ensuring", "carry", "carried", "out", "work", "working",
  "relevant", "appropriate", "necessary", "required", "requirements", "within", "during", "when",
  "where", "which", "while", "have", "has", "had", "will", "would", "can", "could", "should",
]);

const words = (t) =>
  [...new Set(String(t).toLowerCase().match(/[a-z][a-z0-9'-]{3,}/g) || [])].filter((w) => !STOP.has(w));

/** Is this topic actually answered? Paraphrase is fine; silence is not. */
function answered(text, topic) {
  const keys = words(topic);
  if (!keys.length) return true;
  const low = text.toLowerCase();
  const found = keys.filter((w) => low.includes(w)).length;
  return found / keys.length >= 0.45;
}

const ADDRESSED = /\b(please (supply|provide|confirm|tell)|i cannot|i can't|i am unable|as an ai|let me know|if you (can )?provide|no scores were provided|i have not (scored|described))\b/i;
/**
 * A statement is one person's account of work they saw: it never mentions other copies, other witnesses,
 * what is covered elsewhere, or what the document is or is not for.
 */
const ABOUT_ITSELF =
  /\b(other (witness(es)?|assessors?|copies|documents?|forms?|testimon(y|ies)|reports?)|another (testimony|witness|copy|document|form|report)|this (document|form|testimony|statement|report) (does not|doesn't|will not|won't|is not|isn't)|(are|is) (not )?(addressed|covered|dealt with) (here|elsewhere|in (this|another))|covered (elsewhere|by (another|other))|outside the scope of this|remaining (areas|criteria))\b/i;
const FENCED = /```|^\s*[-*•]\s+/m;

/**
 * What is wrong with this document, in words that can be handed straight back
 * to the writing. An empty list means it passed.
 */
export function faults(text, { areas = [], tasks = [], candidate = "", min = 400, voice = "" } = {}) {
  const body = String(text || "").trim();
  const out = [];
  if (!body) return ["The document is empty."];
  if (body.length < min) out.push(`It is too short: ${body.length} characters for ${areas.length} areas. Answer each one properly.`);

  const first = body.split("\n")[0].trim();
  if (/^#{1,6}\s/.test(first) || (first.length < 70 && first === first.toUpperCase() && /[A-Z]{4}/.test(first)))
    out.push(`Remove the heading at the top ("${first.slice(0, 48)}"). The box is the statement itself.`);

  if (ADDRESSED.test(body))
    out.push("It speaks to whoever asked, or says what it cannot do. Write the document with what was supplied instead.");

  /* Most of these ships have a control room, not a van, so a bare "control van" is flagged. Text in
     asterisks is the scheme's own quoted phrase and is not checked. */
  if (/\bcontrol van\b(?!\s*\/)/i.test(body.replace(/\*\*[^*]+\*\*/g, " ")))
    out.push('Write "control van/room", not "control van": most of these ships have a control room.');

  const aboutItself = body.match(ABOUT_ITSELF);
  if (aboutItself)
    out.push(
      `Take out the sentence about the paperwork ("…${aboutItself[0]}…"). This is one person's account of work they saw: it never mentions other copies, other witnesses, what is covered elsewhere, or what this document does not do.`,
    );

  if (FENCED.test(body)) out.push("Remove the bullet points and code fences: this is prose on a form.");

  if ((body.match(/\*\*/g) || []).length % 2) out.push("A bold marker (**) was opened and not closed.");

  if (candidate.trim() && !body.toLowerCase().includes(candidate.trim().toLowerCase().split(/\s+/)[0].toLowerCase()))
    out.push(`The candidate (${candidate}) is never named. Name them as supplied, exactly.`);

  /* A candidate writing about himself in the third person is not the
     candidate's statement: the form asks for his own words. */
  if (voice === "first") {
    const mine = (body.match(/\b(I|my|me|myself)\b/g) || []).length;
    const his = (body.match(/\b(he|his|him|himself|she|her)\b/gi) || []).length;
    if (his > mine)
      out.push("Rewrite it in the first person, as the candidate speaking: I did, I checked, I asked. Never about himself in the third person.");
  }

  const missedTasks = tasks.filter((t) => !answered(body, t));
  if (missedTasks.length)
    out.push(`These tasks are not in the text — write a sentence for each: ${missedTasks.join("; ")}`);

  const missedAreas = areas.map((a) => (typeof a === "string" ? a : a.text)).filter((a) => !answered(body, a));
  if (missedAreas.length)
    out.push(
      `These areas are not answered — each needs at least one sentence, with the words that name it in **bold**: ${missedAreas.join("; ")}`,
    );

  const bolded = (body.match(/\*\*(.+?)\*\*/gs) || []).length;
  if (!bolded && (areas.length || tasks.length))
    out.push("Nothing is marked: wrap the words that name each task and area in **double asterisks**.");

  return out;
}


/* Stock phrases and shapes that give a generated text away. */
const STOCK = [
  "demonstrates a commitment to", "demonstrated a commitment to", "in a timely manner",
  "it is worth noting", "it should be noted", "furthermore", "moreover", "additionally,",
  "showcasing", "showcased", "robust understanding", "seamless", "seamlessly", "leveraged",
  "leveraging", "a testament to", "plays a key role", "plays a crucial role", "key takeaway",
  "delve into", "underscores", "exemplifies", "commendable", "notably,", "overall,",
  "in conclusion", "to summarise", "to summarize", "consistently demonstrates",
  "a wide range of", "effective communication skills", "strong work ethic",
];

const sentences = (t) => String(t).split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 1);

/* A trip feedback is about how the man worked, not what was worked on: these words can only name a job.
   Words the form legitimately uses ("tool", "rigging", "isolation", "survey", "tooling", "pilots") stay off it. */
const JOB_WORDS = [
  "manipulator", "torque tool", "umbilical", "tether", "TMS", "LARS", "servo valve",
  "solenoid", "fibre optic", "fiber optic", "megger", "OTDR", "sandbag", "hot stab",
  "PLET", "suction pile", "dive plan", "dive log", "splice", "splicing", "thruster",
  "compensator", "subsea light", "beacon", "as-laid", "workscope", "work scope",
  "toolsled", "backpack", "A-frame", "snubber",
];

/** The words in a text that can only be naming a job, not a man. */
export function jobWords(text) {
  const body = String(text || "");
  const found = JOB_WORDS.filter((w) =>
    new RegExp(`(^|[^a-z])${w.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}(s|es)?([^a-z]|$)`, "i").test(body),
  );
  return [...new Set(found)];
}

/** What still reads as machine-written, in words that can be handed back. */
export function tells(text) {
  const body = String(text || "");
  const low = body.toLowerCase();
  const out = [];

  const stock = STOCK.filter((p) => low.includes(p));
  if (stock.length)
    out.push(`Stock phrases nobody writes on a form — replace them with plain words: ${stock.join("; ")}`);

  const long = sentences(body).filter((s) => s.trim().split(/\s+/).length > 34);
  if (long.length)
    out.push(
      `${long.length} sentence${long.length === 1 ? "" : "s"} run too long. Break them: “${long[0].trim().slice(0, 90)}…”`,
    );

  /* Three sentences in a row opening the same way is the rhythm of a machine. */
  const openings = sentences(body).map((s) => s.trim().split(/\s+/).slice(0, 2).join(" ").toLowerCase());
  for (let i = 2; i < openings.length; i += 1)
    if (openings[i] && openings[i] === openings[i - 1] && openings[i] === openings[i - 2]) {
      out.push(`Three sentences in a row start with “${openings[i]}”. Vary how they begin.`);
      break;
    }

  const paras = body.split(/\n{2,}/).filter((p) => p.trim());
  const fat = paras.filter((p) => sentences(p).length > 7);
  if (fat.length) out.push(`${fat.length} paragraph${fat.length === 1 ? "" : "s"} run past seven sentences. Split them.`);

  return out;
}
