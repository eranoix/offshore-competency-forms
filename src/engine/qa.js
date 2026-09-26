/**
 * The questions and answers of a knowledge form, as one Q1/A1 block to write in
 * and back again. Text typed before the first Q is kept as the first question
 * (somebody writing into an empty box starts typing, not labelling).
 */
export const asQA = (list = []) => {
  const said = (Array.isArray(list) ? list : []).map((qa) => ({ q: qa?.q || "", a: qa?.a || "" }));
  /* An empty pair at the end is the form's blank line, not something to write
     out: a box that opens saying "Q2: A2: Q3: A3:" is a box nobody types in. */
  while (said.length && !said[said.length - 1].q && !said[said.length - 1].a) said.pop();
  return said.map((qa, i) => `Q${i + 1}: ${qa.q}\nA${i + 1}: ${qa.a}`).join("\n\n").trim();
};

/**
 * @param least the form prints four pairs, so four come back however few were
 *   written — the blank ones are the blank lines.
 */
export function fromQA(text, least = 4) {
  const said = String(text || "");
  /* The labels are found wherever they are, not only at the start of a line:
     typed in one run — "Q1: how do you isolate it? A1: lock off" — the answer
     was swallowed into the question. */
  const label = /(^|[\s])([QA])\s*(\d*)\s*[:.)-]\s*/gi;
  const marks = [];
  let hit = label.exec(said);
  while (hit) {
    marks.push({ at: hit.index + hit[1].length, end: hit.index + hit[0].length, side: hit[2].toLowerCase() });
    hit = label.exec(said);
  }
  const out = [];
  if (!marks.length) {
    /* Nothing labelled: it is the first question, because somebody writing in
       an empty box starts typing rather than labelling. */
    if (said.trim()) out.push({ q: said.trim().replace(/\s+/g, " "), a: "" });
  } else {
    if (said.slice(0, marks[0].at).trim()) out.push({ q: said.slice(0, marks[0].at).trim(), a: "" });
    marks.forEach((m, n) => {
      const body = said.slice(m.end, n + 1 < marks.length ? marks[n + 1].at : undefined).trim().replace(/\s+/g, " ");
      if (m.side === "q") out.push({ q: body, a: "" });
      else if (out.length) out[out.length - 1].a = body;
      else out.push({ q: "", a: body });
    });
  }
  while (out.length < least) out.push({ q: "", a: "" });
  return out;
}
