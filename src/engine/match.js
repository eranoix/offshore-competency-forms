/**
 * Which criteria of the scheme a document's tasks evidence. The answer is
 * criterion numbers, never reworded criteria, so it cannot fail to match what was
 * sent. A second pass strikes anything the tasks do not actually show: a criterion
 * marked without support goes into a competence file as proved.
 */
import { ask, verdictIn } from "./ai";

const JSON_ONLY = `Answer with JSON only: {"of":[1,4,9]} — the numbers and nothing else.`;

/** The numbers it answered with, as a set of the criteria they point at. */
function chosen(answer, criteria) {
  try {
    const body = verdictIn(answer, "of");
    const list = Array.isArray(body?.of) ? body.of : [];
    return [...new Set(list.map((n) => criteria[Number(n) - 1]).filter(Boolean))];
  } catch {
    return [];
  }
}

const listed = (criteria) =>
  criteria.map((c, n) => `${n + 1}. [${c.unit}] ${c.text}`).join("\n");

/**
 * Which criteria a document's tasks evidence.
 *
 * @param tasks     what was marked onto this document
 * @param criteria  every criterion of the scheme, in the panel's own order
 * @param about     the level, the candidate, what the document is
 * @param already   what the document already carries, so it is not re-argued
 */
export async function areasForTasks({ tasks, criteria, about, already = [], rounds = 3, onRound }) {
  if (!tasks.length || !criteria.length) return [];
  const have = new Set(already);
  const found = [];
  /* Asked again with its own first answer marked, it finds more that are just as
     good, so it is asked until a round adds nothing. */
  for (let round = 0; round < Math.max(1, rounds); round += 1) {
    /* eslint-disable-next-line no-await-in-loop */
    const got = await once({ tasks, criteria, about, have });
    if (!got.length) break;
    for (const c of got) {
      have.add(c.text);
      found.push(c);
    }
    onRound?.({ round: round + 1, added: got.length, all: found.length });
  }
  return found;
}

async function once({ tasks, criteria, about, have }) {
  /* What is already marked is settled: it is shown, so the same ground is not
     argued twice, but it is never handed back as a new answer. */
  const open = criteria.filter((c) => !have.has(c.text));
  if (!open.length) return [];

  const work = tasks.map((t) => `- ${t}`).join("\n");
  const first = chosen(
    await ask(
      `You read offshore ROV work against the Northwind Offshore CAAP framework and say which of its criteria a piece of work can evidence. ${JSON_ONLY} Choose a criterion only when doing the work described would actually show it — the task itself, or what a person must plainly do to carry it out safely and properly. Do not choose a criterion because it is near the subject, and do not choose one that belongs to a different part of the job.`,
      `${about}\n\nThe work recorded on this document:\n${work}\n\nThe criteria, numbered:\n${listed(open)}`,
      {
        maxTokens: 900,
        temperature: 0.1,
        /* The library is looked out for this work, so the judgement is made
           against paperwork of the same jobs rather than against the words
           alone. The documents never reach the browser. */
        context: { scope_short: tasks.slice(0, 4).join("; "), position: about },
        use: "facts",
      },
    ),
    /* Numbered against the criteria it was SHOWN (the open ones), not the whole
       framework; counted from the wrong list, every number points at nothing. */
    open,
  );
  if (!first.length) return [];

  /* The second reading is the one that matters: generous is the failure mode
     of the first, and a criterion marked on evidence that does not support it
     goes into a competence file claiming it was proved. */
  const kept = chosen(
    await ask(
      `You are checking a shortlist of CAAP criteria against the work it was chosen for. ${JSON_ONLY} Keep every number a verifier who has read the evidence would accept — anyone carrying out this work has to do these things, so they are shown by it. Strike the ones that are merely near the subject: work the person may also have done that day, parts of the job this task does not touch, and anything that needs a second assumption to stand up. Keep what is right; this is a check, not a second opinion.`,
      `The work recorded on this document:\n${work}\n\nThe shortlist, numbered:\n${listed(first)}`,
      { maxTokens: 700, temperature: 0 },
    ),
    first,
  );
  return kept.length ? kept : [];
}
