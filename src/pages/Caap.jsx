import { useEffect, useMemo, useRef, useState } from "react";
import Picker from "../components/caap/Picker";
import Paper, { drawForm, formSignature, LINES } from "../components/caap/Paper";
import { fromQA } from "../engine/qa";
import { askFor, fillForm, formName, SHEET } from "../engine/docx";
import { zipSync } from "fflate";
import Icon from "../components/Icon";
import {
  LEVELS,
  SCHEMES,
  crfCriteria,
  draft,
  levelNamed,
  questionFrom,
  shortRole,
  tasksFor,
  topicCount,
  topicsFor,
} from "../engine/witness";
import {
  evidenceStyle,
  improve,
  speakAsMe,
  isAvailable,
  mend,
  onAvailability,
  onBusy,
  passagesFor,
  probe,
  review,
  soundsHuman,
  unsupported,
  writeBlock,
} from "../engine/ai";
import { faults, tells } from "../engine/review";
import { readMine, writeMine } from "../engine/vault";
import { vessels } from "../engine/fleet";
import { inOrder } from "../engine/order";
import { everyone, knownAs, positions as knownPositions, remember, sites as beenOn } from "../engine/people";
import { unitsFromTasks } from "../engine/bridge";
import { areasForTasks } from "../engine/match";
import { Areas, Pack, People, Tasks } from "../components/caap/panels";
import { available as cloudOn, loadDocument, saveDocument } from "../engine/cloud";
import defaults from "../engine/defaults.json";
import "../styles/form.css";

/** The five pieces of evidence the programme asks for. */
const FORMS = {
  witness: { code: "NW-CAP-001", label: "Witness testimony", short: "Witness", who: "witness",
    blurb: "A colleague records a task they saw" },
  observation: { code: "NW-CAP-001", label: "Observation report", short: "Observation", who: "assessor",
    blurb: "The assessor was there and writes it" },
  knowledge: { code: "NW-CAP-001", label: "Knowledge questions", short: "Knowledge", who: "assessor",
    blurb: "What was asked, and what was answered" },
  feedback: { code: "NW-CAP-001", label: "Assessor feedback", short: "Feedback", who: "assessor",
    blurb: "The judgement on all the evidence" },
};

/* The jobs a worksite actually has. The assessor is often the superintendent,
   who does not appear on the trip form's list, so the scheme's own rung is
   added here. A document saved with anything else keeps what it says. */
const JOBS = [...defaults.roles, "ROV Superintendent"];

/**
 * How the person stood to the candidate. A list, because typed by hand the
 * same answer arrived spelled several ways; grouped by what the relation is.
 */
/* Each group's answers in one order. The groups keep theirs: alongside the
   candidate, over them, judging them, which is a ladder and not a list of names. */
const BONDS = Object.fromEntries(
  Object.entries(defaults.bonds || {}).map(([group, list]) => [group, inOrder(list)]),
);
/* A document saved with something else keeps what it says: the list is a
   shortcut, never a cage. */
const bonds = (current) => {
  const known = Object.values(BONDS).flat();
  return current && !known.includes(current)
    ? { "As it was saved": [current], ...BONDS }
    : BONDS;
};

/** A grouped list of answers, with whatever this one already says kept. */
function Bond({ value, onChange, id, empty = "Not saying" }) {
  return (
    <select id={id} value={value || ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">{empty}</option>
      {Object.entries(bonds(value)).map(([group, list]) => (
        <optgroup key={group} label={group}>
          {list.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

const KEY = "caap:state";
/* Under the account, never under the browser: see engine/vault.js. */
const load = () => readMine(KEY, {}) || {};

const BLANK = {
  level: "ROV Pilot Technician", reviewDate: "",
  witness: "", witnessPosition: "ROV Supervisor",
  assessor: "", assessorPosition: "ROV Superintendent",
  site: "", candidate: "", discipline: "ROV Pilot Technician",
  witnessRelationship: "Colleague", assessorRelationship: "Supervisor",
  task: "", outcome: "met", draft: false,
};

/** Every document of this level, in the order an assessment is assembled. */
const ORDER = ["witness", "observation", "knowledge", "feedback"];
const ONE_EACH = { witness: 1, observation: 1, knowledge: 1, feedback: 1 };
const MAX_COPIES = 6;

/** The selection cut into n parts that differ by at most one, in order. */
function share(list, n) {
  if (n <= 0) return [];
  if (n === 1) return [list];
  const base = Math.floor(list.length / n);
  const extra = list.length % n;
  const out = [];
  let at = 0;
  for (let i = 0; i < n; i += 1) {
    const take = base + (i < extra ? 1 : 0);
    out.push(list.slice(at, at + take));
    at += take;
  }
  return out;
}

/** Which document is on the stage: the kind, and which copy of it. */
const slot = (kind, i) => `${kind}#${i}`;

/** How many of a kind are wanted. Zero means the document is not being made. */
const countOf = (copies, kind) => (Number.isInteger(copies[kind]) ? copies[kind] : 1);

export default function Caap() {
  const saved = load();
  const [form, setForm] = useState(() => (FORMS[saved.form] ? saved.form : "witness"));
  /* One piece of evidence often cannot carry every criterion, so a document
     can be issued more than once. Each KIND of document still covers the whole
     selection: the copies of that kind divide it between them. */
  const [copies, setCopies] = useState(() => ({ ...ONE_EACH, ...(saved.copies || {}) }));
  const [copy, setCopy] = useState(0);
  const howMany = (kind) => countOf(copies, kind);
  const totalDocs = () => ORDER.reduce((n, k) => n + countOf(copies, k), 0);
  const [doc, setDoc] = useState(() => {
    const d = { ...BLANK, ...(saved.doc || {}) };
    /* Older saves had one relationship for both people. It belongs to the
       assessor; the witness starts from it too rather than from nothing. */
    if (saved.doc?.relationship) {
      d.assessorRelationship = saved.doc.assessorRelationship || saved.doc.relationship;
      d.witnessRelationship = saved.doc.witnessRelationship || saved.doc.relationship;
      delete d.relationship;
    }
    return d;
  });
  const [wanted, setWanted] = useState(() => (saved.scheme === "crf" ? "crf" : "caap"));
  /* The two instruments cover different lists, so what you tick for one is not
     an answer for the other. Each keeps its own, and switching back finds it
     where you left it. */
  const [picks, setPicks] = useState(() =>
    Array.isArray(saved.covered)
      ? { caap: saved.covered, crf: [] }
      : { caap: saved.covered?.caap || [], crf: saved.covered?.crf || [] },
  );
  /* Four documents, four statements: sharing one put the witness testimony's
     words inside the feedback form as well. */
  const [texts, setTexts] = useState(() =>
    saved.texts || (typeof saved.text === "string" && saved.text ? { [saved.form || "witness"]: saved.text } : {}),
  );
  const [owns, setOwns] = useState(() =>
    saved.owns || (saved.candidateText ? { "feedback#0": saved.candidateText } : {}),
  );
  const [picking, setPicking] = useState("");
  /* How the archive is coming along, so its button can say so. */
  const [bundling, setBundling] = useState(null);
  /* Reading the tasks against the framework, and how far it has got. */
  const [reading, setReading] = useState(null);
  const BLANK_QS = () => Array.from({ length: 4 }, () => ({ q: "", a: "" }));
  const [asks, setAsks] = useState(() =>
    Array.isArray(saved.questions)
      ? { "knowledge#0": saved.questions }
      : saved.asks || {},
  );
  /**
   * What changes from one copy to the next: each copy can say who signed it
   * and what was done (a real pack has testimonies from different colleagues
   * about different tasks). Whatever it does not say, it inherits from the pack.
   */
  const [each, setEach] = useState(() => saved.each || {});
  /**
   * What each document carries, marked explicitly by slot: one set of areas and
   * one set of tasks; everything else in the panel is read off it. A pack saved
   * under the old shape is seeded from its even cut below, once, so nothing moves.
   */
  const [marks, setMarks] = useState(() => saved.marks || {});
  /* Which of the five sections of the pack is open, and which document the
     lists are marking for. Empty means all of them. */
  const [tab, setTab] = useState(0);
  const [lens, setLens] = useState("");
  const [openUnits, setOpenUnits] = useState({});
  const [openTasks, setOpenTasks] = useState({});
  const [generation, setGeneration] = useState(0);
  const [aiUp, setAiUp] = useState(isAvailable);
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState({ done: 0, total: 0 });
  /* What the supervisor made of each document, for the line in the panel. */
  const [watch, setWatch] = useState({});
  /* The whole set — every document, every copy, what is chosen — kept under one
     record, so an assessment can be put down and picked up on another machine. */
  const [savedId, setSavedId] = useState(() => saved.savedId || null);
  const [saveState, setSaveState] = useState("");
  /* What a full page of this form holds, measured by the sheet itself. */
  const [unit, setUnit] = useState("");
  const [asked, setAsked] = useState("");
  const [find, setFind] = useState("");
  const stageRef = useRef(null);

  useEffect(() => {
    probe().then(setAiUp);
    return onAvailability(setAiUp);
  }, []);
  useEffect(() => {
    try {
      writeMine(KEY, { form, doc, covered: picks, scheme: wanted, texts, owns, asks, copies, savedId, marks, each });
    } catch {
      /* no storage: it still works for this session */
    }
  }, [form, doc, picks, wanted, texts, owns, asks, copies, savedId, marks, each]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fit = () => {
      const left = stage.getBoundingClientRect().left;
      const room = document.documentElement.clientWidth - left - 26;
      stage.style.setProperty("--sheet-scale", String(Math.min(1, Math.max(0.3, room / 794))));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, []);

  const level = levelNamed(doc.level);
  /* A level without a Record Form cannot be written against one: the switch
     says so and the panel stays on the framework. */
  const scheme = wanted === "crf" && level.crf ? "crf" : "caap";
  const instrument = SCHEMES[scheme];
  const caapCount = useMemo(() => topicCount(level, "caap"), [level]);
  const crfCount = level.crf ? crfCriteria(level.crf).length : 0;
  const groups = useMemo(() => topicsFor(level, scheme), [level, scheme]);
  const allCriteria = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  /* The tasks of this discipline, read out of real paperwork by
     scripts/tasks.mjs and shipped: everybody gets the same list, and nobody has
     to press anything to get it. The field stays free text — the list is a
     shortcut, never a cage. */
  const taskGroups = useMemo(() => tasksFor(level.caap), [level.caap]);
  /* The whole book, for the search: a job this level's paperwork does not
     happen to record is still a job somebody might have done, and the picker
     says whose it is rather than hiding it. */
  const everyTask = useMemo(() => tasksFor(level.caap, true), [level.caap]);
  /* What each task proves, worked out once by scripts/proves.mjs and carried
     with the site. The whole book, not this level's share of it: a task typed
     by hand or brought in from a saved pack still knows what it shows. */
  const provesOf = useMemo(() => {
    const out = new Map();
    for (const g of everyTask) for (const t of g.items) out.set(t.text, t.proves || []);
    return out;
  }, [everyTask]);
  const taskCount = taskGroups.reduce((n, g) => n + g.items.length, 0);
  /* How many of a kind are being made. Not capped by the areas chosen: every
     document is marked by hand, so a copy may sit empty until you fill it. */
  const making = (kind) => howMany(kind);
  /* Read from the count as it stands, not from the render: two quick presses
     both worked from the same figure and the second was lost. */
  const step = (kind, by) =>
    setCopies((c) => ({ ...c, [kind]: Math.max(0, Math.min(MAX_COPIES, countOf(c, kind) + by)) }));

  /** Every document being made, in the order a pack is assembled. */
  const slots = useMemo(
    () => ORDER.flatMap((k) => Array.from({ length: countOf(copies, k) }, (_, i) => ({ kind: k, i, slot: slot(k, i) }))),
    [copies],
  );
  const tasksOf = (kind, i) => marks[slot(kind, i)]?.tasks || [];
  /**
   * What one document carries: what its tasks prove, plus what was added by
   * hand, less what was taken off by hand. The hand always wins: a criterion
   * taken off stays off, and one added stays on when its task is removed.
   */
  const areaTextsOf = (kind, i) => {
    const mark = marks[slot(kind, i)] || {};
    const out = new Set();
    for (const t of mark.tasks || []) for (const c of provesOf.get(t) || []) out.add(c);
    for (const c of mark.areas || []) out.add(c);
    for (const c of mark.off || []) out.delete(c);
    return [...out];
  };
  /** Which of them a task brought, rather than a hand. */
  const broughtBy = (kind, i, text) => {
    const mark = marks[slot(kind, i)] || {};
    if ((mark.off || []).includes(text)) return false;
    return (mark.tasks || []).some((t) => (provesOf.get(t) || []).includes(text));
  };
  /**
   * What the pack covers: everything marked onto any document. A criterion is
   * covered when some document carries it, and not before.
   */
  const covered = useMemo(() => {
    const want = new Set();
    /* What their tasks prove counts as much as what was ticked: the ticked list
       alone said nothing was covered while every document was full of work. */
    for (const s of slots) for (const t of areaTextsOf(s.kind, s.i)) want.add(t);
    return want.size ? allCriteria.filter((c) => want.has(c.text)) : [];
  }, [marks, slots, allCriteria, provesOf]);
  /** Every task on any document, in the order they were first marked. */
  const allTasks = useMemo(() => {
    const out = [];
    for (const s of slots) for (const t of marks[s.slot]?.tasks || []) if (!out.includes(t)) out.push(t);
    return out;
  }, [marks, slots]);
  /** Which documents carry one line, by slot. */
  const tasksOn = (text) => slots.filter((s) => (marks[s.slot]?.tasks || []).includes(text)).map((s) => s.slot);
  const areasOn = (text) => slots.filter((s) => areaTextsOf(s.kind, s.i).includes(text)).map((s) => s.slot);
  /**
   * Put a line on a document, or take it off. Read inside the write, never
   * from the render, or two quick presses lose the second.
   */
  const markTask = (key, text) =>
    setMarks((m) => {
      const had = m[key]?.tasks || [];
      const next = had.includes(text) ? had.filter((x) => x !== text) : [...had, text];
      return { ...m, [key]: { ...(m[key] || {}), tasks: next } };
    });

  /**
   * A criterion put on or taken off one document by hand. What a task brought
   * is worked out, not stored, so turning it off is remembered as taken off,
   * which outlasts the task coming and going.
   */
  const markArea = (key, text) =>
    setMarks((m) => {
      const had = m[key] || {};
      const fromTask = (had.tasks || []).some((t) => (provesOf.get(t) || []).includes(text));
      const byHand = (had.areas || []).includes(text);
      const off = (had.off || []).includes(text);
      const on = (fromTask || byHand) && !off;
      if (on) {
        return {
          ...m,
          [key]: {
            ...had,
            areas: (had.areas || []).filter((x) => x !== text),
            off: fromTask ? [...(had.off || []), text] : had.off || [],
          },
        };
      }
      return {
        ...m,
        [key]: {
          ...had,
          off: (had.off || []).filter((x) => x !== text),
          areas: fromTask || byHand ? had.areas || [] : [...(had.areas || []), text],
        },
      };
    });

  /** A whole group at once, on one document, in one write. */
  const markMany = (what, key, list, on) =>
    setMarks((m) => {
      const had = m[key] || {};
      const hit = new Set(list);
      if (what === "tasks") {
        const was = had.tasks || [];
        return {
          ...m,
          [key]: { ...had, tasks: on ? [...was, ...list.filter((t) => !was.includes(t))] : was.filter((t) => !hit.has(t)) },
        };
      }
      const brought = new Set((had.tasks || []).flatMap((t) => provesOf.get(t) || []));
      if (on) {
        const was = had.areas || [];
        return {
          ...m,
          [key]: {
            ...had,
            off: (had.off || []).filter((x) => !hit.has(x)),
            areas: [...was, ...list.filter((t) => !was.includes(t) && !brought.has(t))],
          },
        };
      }
      return {
        ...m,
        [key]: {
          ...had,
          areas: (had.areas || []).filter((t) => !hit.has(t)),
          /* Only what a task would otherwise keep bringing back. */
          off: [...(had.off || []), ...list.filter((t) => brought.has(t) && !(had.off || []).includes(t))],
        },
      };
    });

  /**
   * Seeds the marks once from a pack written under the old shape (areas cut
   * evenly between copies, one task line every copy inherited), so it opens
   * with every document carrying what it was already carrying.
   */
  useEffect(() => {
    if (Object.keys(marks).length) return;
    const chosen = picks[scheme] || [];
    const packTasks = doc.task ? doc.task.split(/\s*;\s*/).filter(Boolean) : [];
    if (!chosen.length && !packTasks.length) return;
    const seed = {};
    for (const k of ORDER) {
      const n = countOf(copies, k);
      const cut = share(chosen, n);
      for (let i = 0; i < n; i += 1) {
        const own = each[slot(k, i)] || {};
        seed[slot(k, i)] = {
          areas: (cut[i] || []).map((c) => c.text),
          tasks: own.task ? own.task.split(/\s*;\s*/).filter(Boolean) : packTasks,
        };
      }
    }
    setMarks(seed);
  }, [generation, scheme]);

  /* Asking for fewer copies — or for none at all — must not leave the stage on
     a document that is no longer being made. Counted the same way the rest of
     the panel counts, so the stage can never sit on a copy that is not there. */
  const live = making(form) > 0 ? form : ORDER.find((k) => making(k) > 0) || form;
  const at = Math.max(0, Math.min(copy, making(live) - 1));
  const here = slot(live, at);

  const text = texts[here] ?? texts[live] ?? "";
  const setText = (next) =>
    setTexts((t) => ({ ...t, [here]: typeof next === "function" ? next(t[here] ?? t[live] ?? "") : next }));

  const questions = asks[here] || asks[live] || BLANK_QS();
  const setQuestions = (next) =>
    setAsks((m) => ({ ...m, [here]: typeof next === "function" ? next(m[here] || m[live] || BLANK_QS()) : next }));

  /* The other documents, drawn quietly while you read this one: laying a form
     out is a round trip, and doing it on click meant seconds of waiting per tab. */
  useEffect(() => {
    let alive = true;
    /* A while after the page settles, and only once it has: the effect's
       dependencies change as the panel is used, and starting a fresh round of
       drawings on each change put four of them in the air at once. */
    const timer = setTimeout(async () => {
      for (const k of ORDER) {
        if (!alive) break;
        if (k === live) continue;
        const part = { text: texts[slot(k, 0)] || "", own: owns[slot(k, 0)] || "", questions: asks[slot(k, 0)] || BLANK_QS() };
        await drawForm(k, docOf(k, 0), part, formSignature(k, docOf(k, 0), part)).catch(() => {});
      }
    }, 1800);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [doc, texts, owns, asks, live, generation]);

  /* What this one carries, as the framework's own objects. The marks keep the
     words, matched against the scheme in play, so the two instruments never
     show each other's answers. */
  const areaObjsOf = (kind, i) => {
    const want = new Set(areaTextsOf(kind, i));
    return want.size ? allCriteria.filter((c) => want.has(c.text)) : [];
  };
  const mine = useMemo(() => areaObjsOf(live, at), [marks, live, at, allCriteria]);
  const shown = useMemo(() => {
    const needle = find.trim().toLowerCase();
    return groups
      .filter((g) => !unit || g.unit === unit)
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (c) =>
            (!asked || c.levels.includes(asked)) &&
            (!needle || c.text.toLowerCase().includes(needle)),
        ),
      }))
      .filter((g) => g.items.length);
  }, [groups, unit, asked, find]);
  const total = shown.reduce((n, g) => n + g.items.length, 0);
  const change = (k, v) => setDoc((d) => ({ ...d, [k]: v }));
  const ctx = {
    fixed: {
      campaign: `${instrument.label} evidence`,
      scope_short: allTasks.join("; "),
      position: doc.discipline,
      vessel: doc.site,
    },
  };
  const areas = mine.map((c) => c.text).join("; ") || "not stated";

  /** This copy's own answers, falling back to the pack's. */
  const only = (kind, i) => each[slot(kind, i)] || {};
  /* The reference this candidate's own paperwork already uses: WT for a
     witness testimony, OT for an observation of task, QU for questioning.
     Feedback has no short form in it, so it takes the obvious one. */
  const REFS = { witness: "WT", observation: "OT", knowledge: "QU", feedback: "FB" };
  /* The date as the form prints it, and only if there is one. */
  const asPrinted = (iso) => {
    const parts = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return parts ? `${parts[3]}/${parts[2]}/${parts[1].slice(2)}` : "";
  };
  const setOnly = (kind, i, field, value) =>
    setEach((all) => ({ ...all, [slot(kind, i)]: { ...(all[slot(kind, i)] || {}), [field]: value } }));
  /** What the form calls this one: WT01, OT01, QU01, FB01. */
  const refOf = (kind, i) => `${REFS[kind] || "WT"}${String(i + 1).padStart(2, "0")}`;

  /**
   * Who signs one document. Every document owns its signer (a real folder has
   * testimonies from different people); the pack's answer is only the starting
   * point a new document inherits.
   */
  const SIGN = (kind) =>
    kind === "witness"
      ? { name: "witness", position: "witnessPosition", bond: "witnessRelationship" }
      : { name: "assessor", position: "assessorPosition", bond: "assessorRelationship" };
  const signerOf = (kind, i) => {
    const own = only(kind, i);
    const k = SIGN(kind);
    /* Once a document has said something — even that the box is empty — it is
       its own answer, not the pack's. */
    return {
      name: own[k.name] ?? doc[k.name] ?? "",
      position: own[k.position] ?? doc[k.position] ?? "",
      bond: own[k.bond] ?? doc[k.bond] ?? "",
    };
  };
  /**
   * @param settle the field has been left, not merely typed in; only then is
   *   the name kept for next time, or half-typed names become people in the list.
   */
  const setSigner = (kind, i, field, value, settle = false) => {
    const k = SIGN(kind);
    const own = only(kind, i);
    const next = { [k[field]]: value };
    /* A name you have used before brings its position and its relationship
       with it — the whole point of remembering them. What this document
       already says is never overwritten. */
    if (field === "name") {
      const known = knownAs(value);
      if (known?.position && own[k.position] === undefined) next[k.position] = known.position;
      if (known?.bond && own[k.bond] === undefined) next[k.bond] = known.bond;
    }
    setEach((all) => ({ ...all, [slot(kind, i)]: { ...(all[slot(kind, i)] || {}), ...next } }));
    /* The position and the relationship become the default the next document
       starts from. The NAME never does: naming the witness of WT02 must not sign
       WT01 and WT03 as well. */
    if (field !== "name" && value && !doc[k[field]]) change(k[field], value);
    if (settle) {
      const was = signerOf(kind, i);
      remember({
        name: field === "name" ? value : was.name,
        position: field === "position" ? value : next[k.position] || was.position,
        bond: field === "bond" ? value : next[k.bond] || was.bond,
        site: doc.site,
      });
    }
  };

  /** The pack as this one document sees it: its own signer, its own tasks. */
  const docOf = (kind, i) => {
    const who = signerOf(kind, i);
    const k = SIGN(kind);
    return {
      ...doc,
      [k.name]: who.name,
      [k.position]: who.position,
      [k.bond]: who.bond,
      /* What this one is about is what was marked onto it: the subject is not a
         field of its own, because two answers for one fact is one too many. */
      task: tasksOf(kind, i).join("; "),
      ref: refOf(kind, i),
      dated: asPrinted(doc.reviewDate),
    };
  };

  /* Which document the two search pickers write onto: the one the lists are
     marking for or, with the lens off, the one on the page. Every tick belongs
     to a document. */
  const into = lens && slots.some((x) => x.slot === lens) ? lens : here;
  const intoWhere = slots.find((x) => x.slot === into) || { kind: live, i: at };
  const intoRef = refOf(intoWhere.kind, intoWhere.i);

  /* Names used before, offered back with the position and the relationship
     they came with. Read once a render: it is a list, not a subscription. */
  const book = useMemo(() => everyone(), [each, generation, tab]);
  const roleList = useMemo(() => knownPositions(JOBS), [each, generation, tab]);
  /* The fleet, with whatever ships this person has actually been on first. */
  const theFleet = useMemo(() => vessels(beenOn()), [each, generation, tab]);

  /** Every document being made, with everything the panel says about it. */
  const sheets = useMemo(
    () =>
      slots.map(({ kind, i, slot: key }) => {
        const told = tasksOf(kind, i);
        const who = signerOf(kind, i);
        return {
          kind,
          i,
          slot: key,
          ref: refOf(kind, i),
          label: FORMS[kind].label,
          code: FORMS[kind].code,
          /* The subject is not a field: it is what was marked onto it. */
          subject: told.join("; "),
          tasks: told.length,
          areas: areaTextsOf(kind, i).length,
          signer: who.name,
          position: who.position,
          bond: who.bond,
          gap: !told.length || !who.name,
          live: kind === live && i === at,
        };
      }),
    [slots, marks, each, doc, live, at],
  );
  /**
   * What the scheme is still waiting for, and which tasks would answer it.
   * Marked quietly: it suggests what to record next, it is not a fault.
   */
  const stillOpen = useMemo(() => {
    const had = new Set(covered.map((c) => c.text));
    return new Set(allCriteria.filter((c) => !had.has(c.text)).map((c) => c.text));
  }, [allCriteria, covered]);
  /**
   * Every task that would close something still open, with what it would
   * close, not only the shortest set: a task answering two competences is worth
   * knowing about either way. The shortest set is marked as the way out.
   */
  const wouldClose = useMemo(() => {
    const out = new Map();
    if (!stillOpen.size) return out;
    for (const g of taskGroups) {
      for (const t of g.items) {
        if (tasksOn(t.text).length) continue;
        let n = 0;
        for (const p of t.proves || []) if (stillOpen.has(p)) n += 1;
        if (n) out.set(t.text, n);
      }
    }
    return out;
  }, [taskGroups, stillOpen, marks, slots]);
  /** The few that, taken together, would finish it: each time the one that
   *  answers the most of what is still left. */
  const theWayOut = useMemo(() => {
    const out = new Set();
    const left = new Set(stillOpen);
    if (!left.size) return out;
    const pool = taskGroups.flatMap((g) => g.items).filter((t) => wouldClose.has(t.text));
    while (left.size) {
      let best = null;
      let most = 0;
      for (const t of pool) {
        if (out.has(t.text)) continue;
        let n = 0;
        for (const p of t.proves) if (left.has(p)) n += 1;
        if (n > most) {
          most = n;
          best = t;
        }
      }
      if (!best) break;
      out.add(best.text);
      for (const p of best.proves) left.delete(p);
    }
    return out;
  }, [taskGroups, stillOpen, wouldClose]);

  /* The tasks marked on a document that the book does not have — typed by
     hand, or read out of the library under a heading that has since changed.
     They belong in the list or they cannot be unmarked. */
  const orphanTasks = useMemo(() => {
    const known = new Set(taskGroups.flatMap((g) => g.items.map((t) => t.text)));
    return allTasks.filter((t) => !known.has(t)).map((text) => ({ text, unit: "" }));
  }, [taskGroups, allTasks]);

  /**
   * What the tasks on one document say about the scheme: the units it could
   * speak to are offered and opened for you to tick. Nothing is marked on your
   * behalf: the offer is the work saved, not the judgement.
   */
  const suggestion = useMemo(() => {
    const at2 = slots.find((x) => x.slot === lens);
    if (!at2) return null;
    const book = new Map();
    for (const g of taskGroups) for (const t of g.items) book.set(t.text, t);
    const objs = tasksOf(at2.kind, at2.i).map((t) => book.get(t) || { text: t, unit: "" });
    const have = new Set(areaTextsOf(at2.kind, at2.i));
    const units = unitsFromTasks(objs, groups.map((g) => g.unit)).filter((u) =>
      (groups.find((g) => g.unit === u)?.items || []).some((c) => !have.has(c.text)),
    );
    return { units };
  }, [lens, marks, taskGroups, groups, slots]);

  /**
   * Written on the page itself. The fields sit over the printed blanks, so a
   * line typed there reaches the same place as the panel. The position line
   * holds two answers joined the way the form joins them, so it is split that way.
   */
  const onLine = (label, value) => {
    const which = (LINES[live] || []).indexOf(label);
    /* Every document owns its signer, so the line under the pointer is this
       document's line, whichever copy it is. */
    if (which === 0) {
      setSigner(live, at, "name", value, true);
    } else if (which === 1) {
      const cut = value.split(/\s+—\s+/);
      const role = cut.length > 1 ? cut[0].trim() : "";
      const where = (cut.length > 1 ? cut.slice(1).join(" — ") : value).trim();
      if (role) setSigner(live, at, "position", role, true);
      /* The vessel is the trip's, not this document's: it prints on all six. */
      change("site", where);
    } else if (which === 2) {
      change("candidate", value);
    } else if (which === 3) {
      setSigner(live, at, "bond", value, true);
    }
  };
  /* The bordered box: the statement, and on the feedback form the candidate's
     own words underneath it. */
  const onBox = (which, value) => {
    /* The knowledge form has no prose box: what looks like one is the questions
       and answers, read from their own field. Written into the prose box, every
       word was lost the next time the page was laid out. */
    if (live === "knowledge") setQuestions(fromQA(value));
    else if (which === 0) setText(value);
    else setOwns((o) => ({ ...o, [here]: value }));
  };

  /** Everything one sheet needs. */
  const sheetOf = (k, i) => ({
    text: texts[slot(k, i)] || "",
    own: owns[slot(k, i)] || "",
    questions: asks[slot(k, i)] || BLANK_QS(),
  });

  /* The file itself: the company's form with this document's words in it. */
  function save(bytes, name, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  /** What the file of one document is called: its reference, then the form. */
  const fileOf = (kind, i) => `${refOf(kind, i)} ${formName(kind, doc)}`;

  /** This one document, as the company's Word file. */
  async function handOver() {
    const bytes = await fillForm(live, docOf(live, at), sheetOf(live, at)).catch(() => null);
    if (bytes) save(bytes, fileOf(live, at), DOCX);
  }

  /**
   * All of them in one archive, each still its own document: separate
   * downloads half a second apart are blocked by browsers after the second.
   */
  async function handOverAll() {
    if (bundling) return;
    const jobs = ORDER.flatMap((k) => Array.from({ length: making(k) }, (_, i) => [k, i]));
    setBundling({ done: 0, total: jobs.length });
    const files = {};
    for (const [k, i] of jobs) {
      const bytes = await fillForm(k, docOf(k, i), sheetOf(k, i)).catch(() => null);
      if (bytes) files[fileOf(k, i)] = new Uint8Array(bytes);
      setBundling((b) => (b ? { ...b, done: b.done + 1 } : b));
    }
    if (Object.keys(files).length)
      /* A docx is already a zip: stored rather than squeezed again, which is
         instant and honest about the size. */
      save(
        zipSync(files, { level: 0 }),
        `${doc.candidate ? `${doc.candidate} — ` : ""}${instrument.label} evidence.zip`,
        "application/zip",
      );
    setBundling(null);
  }

  async function keep() {
    if (!cloudOn()) return;
    setSaveState("Saving…");
    try {
      const answer = await saveDocument({
        id: savedId,
        kind: "caap",
        preset: wanted,
        data: {
          crew: doc.candidate,
          vessel: doc.site,
          doc,
          scheme: wanted,
          copies,
          picks,
          texts,
          owns,
          asks,
          each,
          marks,
        },
      });
      if (answer?.document?.id) setSavedId(answer.document.id);
      setSaveState("Saved");
    } catch (e) {
      setSaveState(e.message === "not signed in" ? "Sign in again" : "Could not save");
    }
    setTimeout(() => setSaveState(""), 4000);
  }

  /* Opened from the home page: /caap?doc=<id> brings the whole set back. */
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("doc");
    if (!id || !cloudOn()) return;
    loadDocument(id)
      .then((row) => {
        const d = row?.data;
        if (!d) return;
        setDoc({ ...BLANK, ...(d.doc || {}) });
        setWanted(d.scheme === "crf" ? "crf" : "caap");
        setCopies({ ...ONE_EACH, ...(d.copies || {}) });
        setPicks({ caap: d.picks?.caap || [], crf: d.picks?.crf || [] });
        setTexts(d.texts || {});
        setOwns(d.owns || {});
        setAsks(d.asks || {});
        setEach(d.each || {});
        /* An older record has no marking: the effect above seeds it from the
           even cut it was saved with, so it opens exactly as it was left. */
        setMarks(d.marks || {});
        setLens("");
        setSavedId(id);
        setGeneration((g) => g + 1);
      })
      .catch(() => {});
  }, []);

  function startOff() {
    const told = tasksOf(live, at).join("; ");
    if (form === "knowledge") {
      const picked = mine.slice(0, 4);
      setQuestions((qs) => qs.map((qa, i) => (picked[i] ? { q: questionFrom(picked[i].text), a: qa.a } : qa)));
    } else if (form === "feedback") {
      setText(
        `${doc.candidate || "The candidate"} has presented evidence against the ${doc.discipline} ${instrument.full} covering ${mine.length || "several"} ${mine.length === 1 ? instrument.one : instrument.noun}.`.trim(),
      );
      setOwns((o) => ({ ...o, [here]: 
        `I have worked on ${told || "the tasks described"} and I am satisfied this record reflects what I did. ${
          mine.length ? "I will keep gathering evidence for the areas still open." : ""
        }`.trim() }));
    } else {
      setText(draft(docOf(live, at), mine));
    }
    setGeneration((g) => g + 1);
  }

  /* Everything one document of one copy needs to know about itself. */
  function jobOf(kind, i) {
    /* What this document was marked with — not an even slice of the pack. */
    const part = areaObjsOf(kind, i);
    const tasks = tasksOf(kind, i);
    /* Whoever signed this copy — not whoever signed the first one. */
    const who = signerOf(kind, i);
    const person = who.name;
    const role = who.position;
    const bond = who.bond;
    const listed = part.map((c) => `- ${c.text}`).join("\n") || "- not stated";
    return {
      key: slot(kind, i),
      part,
      tasks,
      told: tasks.join("; "),
      /* Whoever signs this copy, carried with the job: the checks downstream
         need to know which name, rank and relationship came off the form. */
      signer: { name: person, position: role, bond },
      bond,
      listed,
      /* Room to answer what it carries: a document with fifteen areas needs far
         more than a trip comment, and may run onto a second page. */
      budget: Math.min(8000, 2000 + (part.length + tasks.length) * 340),
      /* The library is searched for this form and these areas — his own
         testimonies of the same kind are the best guide there is. */
      search: {
        form: `${FORMS[kind].label} ${FORMS[kind].code} CAAP`,
        discipline: level.caap,
        areas: part.slice(0, 5).map((c) => c.text).join(" "),
        task: tasks.slice(0, 2).join(" "),
      },
      /* What the other copies of this same document carry, so three witness
         testimonies do not tell the same story three times. */
      others: Array.from({ length: making(kind) }, (_, n) => n)
        .filter((n) => n !== i)
        .map((n) => {
          const theirs = areaObjsOf(kind, n);
          const about = tasksOf(kind, n).join("; ");
          return `${refOf(kind, n)}${about ? ` (${about})` : ""}: ${
            theirs.map((c) => c.text.split(" ").slice(0, 7).join(" ")).join("; ") || "nothing marked"
          }`;
        })
        .join("\n"),
      /* The areas as the framework groups them, so the paragraphs follow the
         scheme instead of running one into the next. */
      byUnit: Object.entries(
        part.reduce((m, c) => {
          (m[c.unit || "Areas"] = m[c.unit || "Areas"] || []).push(c.text);
          return m;
        }, {}),
      )
        .map(([unit, list]) => `${unit}:\n${list.map((t) => `  - ${t}`).join("\n")}`)
        .join("\n"),
      house: evidenceStyle(
        `the Northwind Offshore ${instrument.full} ${FORMS[kind].label.toLowerCase()} (${FORMS[kind].code})`,
      ),
      brief: {
        witness: `a Northwind Offshore ${instrument.label} witness testimony written by ${person || "the witness"} (${role}) about ${doc.candidate || "the candidate"} (${doc.discipline}). First person, what was seen. It is a record, not a reference.`,
        observation: `a Northwind Offshore ${instrument.label} assessor observation report. ${person || "The assessor"} (${role}) was physically present and writes what was observed of ${doc.candidate || "the candidate"} (${doc.discipline}). First person, factual.`,
        knowledge: `the assessor's record of essential knowledge questions put to ${doc.candidate || "the candidate"} (${doc.discipline}), against the ${instrument.full}. Write the answers as the candidate gave them: plain, in their own words, technically correct for the criteria.`,
        feedback: `the assessor's feedback on all the evidence ${doc.candidate || "the candidate"} (${doc.discipline}) has presented. Say what the evidence shows, where it is thin, and what would close the gap. The candidate reads this.`,
      }[kind],
    };
  }

  /* A statement has a shape: what the work was, then what it showed, then the
     writer's judgement. Without it the writing produced one long block that
     answered the list in the order it was given. */
  const SHAPE = `Open with the work itself — what was done, where, and the writer's part in it. Then take the areas a group at a time, in the order they are grouped below, a short paragraph for each group. Close with one line of the writer's own judgement, or with nothing: a statement that stops when the work is described reads better than one that winds up.`;

  const pageOf = (kind) => SHEET[kind] || 1000;

  /**
   * How to cover what the document carries: a sentence each for a handful of
   * areas, by group past that, so a testimony does not read as a checklist.
   */
  const coverFor = (areas) => {
    const many = areas > 8;
    return `Everything listed must be answered in the text${
      many
        ? " — by group, one sentence covering the several that belong together, not one sentence each"
        : " — a clear sentence each"
    }, in paragraphs, never a list and never a heading. Work each one in as something the person does; do not paste the wording in as a label, and do not say the same thing twice. Wrap the words that name a task or an area in **double asterisks**. Ground it in what was supplied; where the notes are thin, say what the person does habitually rather than inventing an event, and never write that you cannot speak to it.

Write the way a supervisor writes on the day and not a word more. A person writing this has a job to get back to.

Most sentences under twenty words. Plain verbs. Say a thing once and stop when it is said.

Never write what the person did NOT do. No "rather than", no "did not", and no "without" followed by a thing that did not happen — not "without being prompted", not "without being asked twice", not "without escalating to a parts swap". Write what they did; the reader draws their own conclusion.

Cut the words that carry nothing: appropriate, relevant, correct, proper, thorough, effectively, consistently, methodically, as required, in a controlled manner. If one of them matters, name the thing instead.

No judging the work — not "to a standard I was satisfied with", not "which reduces the risk", not "this demonstrates". No praise. No sentence whose only job is to sum up what was already written.

The place the vehicle is flown from is the **control van/room**, written exactly that way. Most Northwind Offshore ships have a control room rather than a van, and the scheme's own wording says van — so the paperwork says both, and a bare "control van" reads as somebody who has not been on these vessels.`;
  };

  /* The upstream is shared and sometimes busy. One refusal must not leave a
     box empty on a form that says it is complete. */
  async function attempt(work, tries = 5, onStep = null) {
    let last;
    for (let i = 0; i < tries; i += 1) {
      try {
        const out = await work();
        if (String(out || "").trim()) return out;
      } catch (e) {
        last = e;
      }
      if (i < tries - 1) {
        /* A busy refusal needs no wait here: the request already holds until
           upstream has room. Anything else (a dropped connection, a bad gateway)
           still waits a moment longer each time. */
        if (last?.retryIn) {
          if (onStep) onStep(`the writing service is busy — waiting ${last.retryIn}s`);
        } else {
          await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
        }
      }
    }
    /* Nothing came back. Saying so is the point: a caller that swallows this
       leaves a box blank on a document that claims to be complete. */
    throw last || new Error("the writing did not answer");
  }

  /**
   * The supervisor: what the machine can check, it checks for nothing; what it
   * cannot, a second reader does. Faults are handed back by name and the
   * document is repaired — twice at most, then reported as it stands.
   */
  async function supervise(body, job, kind, part = "", voice = "", houseOf = "", library = true, onStep = () => {}) {
    const topics = job.part.map((c) => c.text);
    const mark = part ? `${job.key}:${part}` : job.key;
    let text = body;
    let rounds = 0;
    let left = [];
    /* A grounding check that could not run has not passed: the panel says so
       rather than reporting the document as clean. */
    let unchecked = false;
    for (let pass = 0; pass < 2; pass += 1) {
      onStep(pass === 0 ? "checking it" : "repairing it");
      const machine = faults(text, {
        areas: part === "own" ? [] : topics,
        tasks: part === "own" ? [] : job.tasks,
        /* The candidate writes in the first person: he does not name himself. */
        candidate: part ? "" : doc.candidate,
        voice: part === "own" ? "first" : "",
        /* The candidate's box is a few honest paragraphs, not a second
           assessment: asked for a length that grew with the framework, the
           repair pass padded it into the assessor's voice. */
        min: part === "own" ? Math.max(350, Math.round(pageOf(kind) * 0.45)) : askFor(kind, job.part.length),
      });
      let found = machine;
      if (library) {
        /* Nothing may be asserted that the records do not show. The writing is
           read back against the very passages it was given. */
        const papers = await passagesFor(job.search, 10).catch(() => []);
        const made = papers.length
          ? await unsupported({
              text,
              passages: papers,
              /* What this copy was marked with is what its signer attests. */
              did: part === "own" ? [] : job.tasks,
              /* The claim is about the candidate, whoever signs it. */
              who: doc.candidate,
              /* And what the panel typed onto the form is given, not invented:
                 the records have no reason to confirm a rank or a vessel that
                 this person filled in themselves. */
              given: {
                candidate: doc.candidate,
                "candidate's discipline": doc.discipline,
                vessel: doc.site,
                "who signs it": job.signer?.name,
                "their position": job.signer?.position,
                "their relationship to the candidate": job.signer?.bond,
                date: doc.dated,
              },
            }).catch(() => {
              unchecked = true;
              return [];
            })
          : [];
        if (made.length)
          found = [
            ...found,
            ...made.map(
              (q) => `Nothing in the records supports this — take it out or say only what they show: “${String(q).slice(0, 140)}”`,
            ),
          ];
      }
      if (!found.length && !machine.length) {
        /* Only when it passes the cheap checks is a reader's time worth it. */
        const seen = await review({
          text,
          topics: part === "own" ? [] : topics,
          tasks: part === "own" ? [] : job.tasks,
          what: voice || job.brief,
        }).catch(
          () => ({ missing: [], problems: [] }),
        );
        found = [
          ...seen.missing.map((m) => `This is not answered — write a sentence for it, with its words in **bold**: ${m}`),
          ...seen.problems,
        ];
      }
      left = found;
      if (!found.length) break;
      rounds += 1;
      /* The voice is not a matter of persuasion: a text about him becomes his
         own words by rewriting the person, and nothing else. */
      const wrongVoice = found.findIndex((f) => f.startsWith("Rewrite it in the first person"));
      if (wrongVoice >= 0) {
        text = String(
          await speakAsMe({ text, who: doc.candidate || "the candidate", maxTokens: job.budget }).catch(
            () => text,
          ),
        ).trim();
        found.splice(wrongVoice, 1);
        if (!found.length) {
          left = faults(text, {
            areas: [],
            tasks: [],
            candidate: "",
            voice: "first",
            min: 350,
          });
          if (!left.length) break;
        }
      }
      /* A whole-document rewrite can drop one thing while fixing another. On
         the last pass, when only coverage is missing, write the missing part
         and add it rather than touching what already passed. */
      if (pass === 1 && found.every((f) => f.startsWith("This is not answered"))) {
        const gaps = found.map((f) => f.split(": ").slice(1).join(": ")).filter(Boolean);
        const tail = await writeBlock({
          kind: "evidence",
          house: houseOf || job.house,
          ctx,
          criteria: {},
          maxTokens: Math.min(2000, 500 + gaps.length * 300),
          notes: `This is ${voice || job.brief}\nThe statement already written ends: ${text.slice(-400)}\nThese areas are still unanswered:\n${gaps.map((g) => `- ${g}`).join("\n")}`,
          instruction:
            "Write ONLY the paragraphs that answer those areas, continuing the statement in the same voice — no heading, no preamble, no repetition of what is already written. Wrap the words that name each area in **double asterisks**.",
        }).catch(() => "");
        if (String(tail).trim()) {
          text = `${text}\n\n${String(tail).trim()}`;
          left = faults(text, {
            areas: part === "own" ? [] : topics,
            tasks: part === "own" ? [] : job.tasks,
            candidate: part ? "" : doc.candidate,
            voice: part === "own" ? "first" : "",
            min: part === "own" ? Math.max(350, Math.round(pageOf(kind) * 0.45)) : askFor(kind, job.part.length),
          });
          break;
        }
      }
      text = String(
        await mend({
          text,
          faults: found,
          house: houseOf || job.house,
          library,
          ctx,
          notes: `${voice ? `What this text is: ${voice}\n` : ""}Tasks: ${job.told || "not stated"}\nMust cover:\n${job.listed}`,
          maxTokens: job.budget,
        }),
      ).trim();
    }
    /* Two readings for the voice, because a machine gives itself away in two
       different ways: the words it reaches for, which can be listed, and the
       shape of what it writes, which takes a reader. */
    for (let round = 0; round < 2; round += 1) {
      onStep("reading it aloud");
      const heard = tells(text);
      const judged = round === 0 && !heard.length ? await soundsHuman({ text, what: voice || job.brief }).catch(() => ({ human: true, faults: [] })) : { human: true, faults: [] };
      const human = [...heard, ...(judged.human ? [] : judged.faults)];
      if (!human.length) break;
      rounds += 1;
      text = String(
        await mend({
          text,
          faults: [
            ...human,
            "Say it the way a supervisor would on the day: short sentences, plain words, no praise, nothing repeated. Keep every fact and every **marked** phrase.",
          ],
          house: houseOf || job.house,
          library,
          ctx,
          notes: `${voice ? `What this text is: ${voice}\n` : ""}Tasks: ${job.told || "not stated"}`,
          maxTokens: job.budget,
        }),
      ).trim();
    }

    /* One sheet, wherever one will do. A statement that spills is tightened
     * back onto the sheet it nearly fit, never grown to fill the paper. The
     * limit is what survives tightening: one that would lose half keeps its
     * second sheet. */
    onStep("fitting it to the page");
    const cap = pageOf(kind);
    if (cap > 300) {
      const len = text.length;
      const pages = Math.max(1, Math.ceil(len / cap));
      const target = Math.round((pages - 1) * cap * 0.97);
      const keeps = pages > 1 ? target / len : 1;
      if (keeps >= 0.6 && keeps <= 0.97) {
        const tighter = `It runs a little onto a page it barely uses. Tighten it to about ${Math.round(target / 6)} words, keeping every area answered and every **marked** phrase.`;
        const fitted = await mend({
          text,
          faults: [tighter],
          house: houseOf || job.house,
          library,
          ctx,
          notes: `${voice ? `What this text is: ${voice}\n` : ""}Tasks: ${job.told || "not stated"}\nMust cover:\n${job.listed}`,
          maxTokens: job.budget,
        }).catch(() => text);
        if (String(fitted || "").trim().length > len * 0.6) text = String(fitted).trim();
      }
    }
    setWatch((w) => ({
      ...w,
      [mark]: {
        rounds,
        left: unchecked
          ? [...left, "the check against your documents did not run — read this one before you send it"]
          : left,
        areas: topics.length,
      },
    }));
    return text;
  }

  /**
   * Reads what each document with tasks on it is about and marks what it
   * proves. It only ever adds, never unmarks, so a press cannot cost work done
   * by hand.
   */
  async function readAreas() {
    if (!aiUp || reading) return;
    const jobs = (lens ? slots.filter((x) => x.slot === lens) : slots).filter(
      (x) => tasksOf(x.kind, x.i).length,
    );
    if (!jobs.length) {
      setReading({ done: 0, total: 0, said: "Nothing to read — mark some tasks first." });
      setTimeout(() => setReading(null), 5000);
      return;
    }
    setReading({ done: 0, total: jobs.length, said: "" });
    let added = 0;
    for (const at2 of jobs) {
      const ref = refOf(at2.kind, at2.i);
      setReading((r) => (r ? { ...r, said: `Reading ${ref}…` } : r));
      /* eslint-disable-next-line no-await-in-loop */
      const got = await areasForTasks({
        tasks: tasksOf(at2.kind, at2.i),
        criteria: allCriteria,
        about: `${doc.candidate || "The candidate"} is being assessed at ${doc.level} against the ${instrument.full}. This document is a ${FORMS[at2.kind].label.toLowerCase()}.`,
        already: areaTextsOf(at2.kind, at2.i),
        onRound: ({ round, all }) =>
          setReading((r) => (r ? { ...r, said: `Reading ${ref} — ${all} so far, pass ${round}` } : r)),
      }).catch(() => []);
      if (got.length) {
        markMany("areas", at2.slot, got.map((c) => c.text), true);
        added += got.length;
        /* Open what it touched, so a press shows its work rather than a
           number changing somewhere out of sight. */
        setOpenUnits((o) => {
          const next = { ...o };
          for (const c of got) next[c.unit] = true;
          return next;
        });
      }
      setReading((r) => (r ? { ...r, done: r.done + 1 } : r));
    }
    setReading({
      done: jobs.length,
      total: jobs.length,
      said: added
        ? `${added} ${added === 1 ? instrument.one : instrument.noun} marked across ${jobs.length} ${jobs.length === 1 ? "document" : "documents"} — check them.`
        : "Nothing it would defend to a verifier.",
    });
    setTimeout(() => setReading(null), 12000);
  }

  /**
   * Writes one copy of one document, whole. `onStep` is told how far through
   * it is, from nothing to one: a document takes most of a minute, and a bar
   * that moves only per document looks stuck.
   */
  async function writeOne(kind, i, mode, onStep = () => {}) {
    const job = jobOf(kind, i);
    const { key, part, tasks, told, bond, listed, budget, house, brief, search, others, byUnit } = job;

    if (kind === "knowledge") {
      /* An empty form is not a starting point: the questions come from the
         areas this copy carries, and where there are none the writing proposes
         four for the task. Anything you typed yourself is kept. */
      let asking = asks[key] || BLANK_QS();
      if (!asking.some((qa) => qa.q.trim())) {
        const fromAreas = part.slice(0, 4).map((c) => questionFrom(c.text));
        if (fromAreas.length) {
          asking = asking.map((qa, n) => (fromAreas[n] ? { ...qa, q: fromAreas[n] } : qa));
        } else {
          /* One call per question, each from its own angle: asked for four at
             once the writing answers in prose. */
          const angles = [
            "the procedure itself — the steps, and the order they go in",
            "the hazards and the controls that keep the job safe",
            "the equipment or system involved, and how it is proved fit",
            "what they would do if it went wrong on the job",
          ];
          const proposed = (
            await Promise.all(
              angles.map(async (angle) =>
                String(
                  await writeBlock({
                    kind: "evidence",
                    house,
                    ctx,
                    criteria: {},
                    notes: `An assessor is putting essential knowledge questions to ${doc.candidate || "the candidate"} (${doc.discipline}).\nTasks: ${told || "not stated"}\nThis question is about ${angle}.`,
                    instruction:
                      "Write ONE question and nothing else: no preamble, no answer, no numbering. It must end with a question mark and be specific to the task described.",
                  }),
                )
                  .split("\n")
                  .map((l) => l.replace(/^\s*(?:\d+[).]|[-–•])\s*/, "").trim())
                  .find((l) => l.endsWith("?")) || "",
              ),
            )
          ).filter(Boolean);
          asking = asking.map((qa, n) => (proposed[n] ? { ...qa, q: proposed[n] } : qa));
        }
        setAsks((m) => ({ ...m, [key]: asking }));
      }
      onStep(0.3, "answering the questions");
      const answered = await Promise.all(
        asking.map(async (qa) =>
          qa.q.trim()
            ? {
                q: qa.q,
                a: String(
                  await attempt(() =>
                    writeBlock({
                      kind: "evidence",
                      house,
                      ctx,
                      criteria: {},
                      maxTokens: 900,
                      temperature: 0.6,
                      search,
                      useFacts: true,
                      notes: `You are recording the answer a candidate gave to an assessor's question. ${brief}\nQuestion asked: ${qa.q}\nAreas in play:\n${listed}`,
                      instruction:
                        "Write ONLY the answer, as the candidate said it: first person, one full paragraph, technical and specific. No greeting, no thanks, no reference to feedback.",
                    }),
                    5,
                    (what) => onStep(0.2, what),
                  ),
                ).trim(),
              }
            : qa,
        ),
      );
      setAsks((m) => ({ ...m, [key]: answered }));
      onStep(1, "");
      return;
    }

    onStep(0.05, mode === "improve" ? "reading what is there" : "writing it");
    const had = texts[key] || "";
    const body = await attempt(() =>
      mode === "improve" && had.trim()
        ? improve({
            text: had,
            kind: "evidence",
            house,
            ctx,
            maxTokens: budget,
            temperature: 0.6,
            search,
            useFacts: true,
            notes: `Tasks: ${told || "not stated"}\nMust cover (${part.length}):\n${listed}`,
            instruction: `Keep every fact. This is ${brief} ${coverFor(part.length)}`,
          })
        : writeBlock({
            kind: "evidence",
            house,
            ctx,
            criteria: {},
            maxTokens: budget,
            temperature: 0.65,
            search,
            useFacts: true,
            notes: [
              `This is ${brief}`,
              `Writer's relationship to the candidate: ${bond || "not stated"}`,
              `Tasks (${tasks.length || 1}): ${told || "not stated"}`,
              `${instrument.noun === "competences" ? "Competences" : "Areas of the scheme"} this document must cover (${part.length}), grouped as the scheme groups them:`,
              byUnit || listed,
              /* The note has to read as a boundary for the writer, never as something the
                 reader could be told: stated plainly, the writing put it on the form. */
              others
                ? `Between you and me, and never on the page: these areas belong to other copies of this form and are being written there. Leave them out silently. Never mention another copy, another witness, or anything being covered elsewhere — the person signing this saw what they saw and writes only that.\n${others}`
                : "",
            ]
              .filter(Boolean)
              .join("\n"),
            instruction: `${SHAPE} ${coverFor(part.length)} About ${Math.round(askFor(kind, part.length) / 6)} words — the length of the ones in this person's own file. Shorter is never wrong; longer always reads as padding.`,
          }),
      5,
      (what) => onStep(0.35, what),
    );
    const checked = await supervise(String(body).trim(), job, kind, "", "", "", true, (what) =>
      onStep({ "checking it": 0.55, "repairing it": 0.7, "reading it aloud": 0.82, "fitting it to the page": 0.92 }[what] || 0.5, what),
    );
    setTexts((t) => ({ ...t, [key]: checked }));

    /* The feedback form has two boxes, and the candidate's own comments are
       part of the record: an empty half is an unfinished form. */
    if (kind === "feedback") {
      /* The candidate's box is his own remarks: given the assessor's text it came
         back in the assessor's voice. It gets its own brief, and the supervisor
         checks the voice rather than the coverage. */
      const own = `${doc.candidate || "the candidate"} writing their own comments on the programme, in the first person, for the candidate's box on the feedback form`;
      /* Told it writes the assessor's form, the model wrote the assessor's
         words in the candidate's box. This half has its own identity. */
      const ownHouse = evidenceStyle(
        `the candidate's own comments box on the Northwind Offshore ${instrument.full} assessor feedback form (${FORMS.feedback.code}) — written by the candidate about their own work`,
      );
      const reply = await attempt(() =>
        writeBlock({
          kind: "crew",
          house: ownHouse,
          library: false,
          ctx,
          criteria: {},
          maxTokens: Math.min(1400, 600 + part.length * 60),
          notes: `You are ${doc.candidate || "the candidate"}, ${doc.discipline}. Write your own comments for the feedback form.\nWhat you did this trip: ${told || "the work described"}\nWhat the evidence covers (${part.length}):\n${listed}`,
          instruction: `Write in the first person — I did, I ran, I checked. About ${Math.round((pageOf(kind) * 0.5) / 6)} words, in paragraphs: the work you did, what you believe it evidences, and what you still want to get evidence for. Never write about yourself in the third person, never thank or praise the assessor, no heading, no list.`,
        }),
        5,
        (what) => onStep(0.9, what),
      );
      onStep(0.95, "the candidate's own words");
      const ownChecked = await supervise(String(reply || "").trim(), job, kind, "own", own, ownHouse, false);
      setOwns((o) => ({ ...o, [key]: ownChecked }));
    }
  }

  /**
   * What a document cannot be written without. The button stays shut until the
   * form could be signed, and says what it is waiting for: evidence signed by
   * nobody is not evidence, and the writing is the expensive part to waste.
   */
  const wanting = (only = null) => {
    const out = [];
    if (!String(doc.candidate || "").trim()) out.push("the candidate's name");
    if (!String(doc.site || "").trim()) out.push("the site or vessel");
    const mine = only ? sheets.filter((x) => x.kind === only[0] && x.i === only[1]) : sheets;
    const nameless = mine.filter((x) => !String(x.signer || "").trim());
    if (nameless.length)
      out.push(
        nameless.length === mine.length && mine.length > 1
          ? "who signs them"
          : `who signs ${nameless.map((x) => x.ref).join(", ")}`,
      );
    const untold = mine.filter((x) => !x.tasks);
    if (untold.length)
      out.push(
        untold.length === mine.length && mine.length > 1
          ? "what they are about — mark a task on each"
          : `what ${untold.map((x) => x.ref).join(", ")} ${untold.length === 1 ? "is" : "are"} about`,
      );
    return out;
  };
  const shortAll = wanting();
  const shortOne = wanting([live, at]);
  const saying = (list) => `Still needed: ${list.join(" · ")}`;

  /* Whether a copy already says anything: a blank one is written, one that
     says something is written again. */
  const written = (kind, i) => {
    const k = slot(kind, i);
    if (kind === "knowledge") return (asks[k] || []).some((qa) => qa.a?.trim());
    return Boolean((texts[k] || "").trim());
  };

  /* Which document the count is on: the one after everything finished, and
     never past the last. */
  const whichOf = (p) => Math.min(p.total, Math.floor(p.done) + 1);

  /** Both buttons work on the whole set: Write it fills every document asked
   *  for, Improve rewrites every one. `only` narrows it to the copy on the page
   *  through the same machinery, so it gets the same progress, retry and check. */
  async function write(mode, only = null) {
    if (!aiUp) return;
    /* One document discovering the minute upstream is full is every document
       discovering it. Say so once, where the count is. */
    const doorAgain = onBusy((seconds) =>
      setDone((d) => (d.total ? { ...d, said: `the writing service is busy — waiting ${seconds}s` } : d)),
    );
    const jobs = only
      ? [only]
      : ORDER.flatMap((k) => Array.from({ length: making(k) }, (_, i) => [k, i]));
    setBusy(only ? "one" : mode);
    setDone({ done: 0, total: jobs.length, said: "" });
    let finished = 0;
    /* How far through each document is, so the bar moves while one is being
       written rather than only when it lands. */
    const part = new Map();
    /* The bar wants the fraction — it is how it fills while one document is
       still being written. The words want whole documents: printed raw, the
       same number read "Writing 1.6500000000000001 of 5". */
    const tell = (said) =>
      setDone({
        done: finished + [...part.values()].reduce((n, x) => n + x, 0),
        total: jobs.length,
        said,
      });
    /* A document whose writing never came back is not passed over: the set is
       tried again for whatever is still blank, and anything still blank after
       that is named on the panel. */
    async function sweep(list, hands = 3) {
      const queue = [...list];
      const failed = [];
      /* Three at a time on the first pass: the whole set at once trips the
         rate limit, one at a time keeps you waiting. */
      const workers = Array.from({ length: Math.min(hands, queue.length) }, async () => {
        while (queue.length) {
          const [k, i] = queue.shift();
          const mark = slot(k, i);
          try {
            await writeOne(k, i, mode, (how, said) => {
              part.set(mark, Math.min(0.97, how));
              tell(said ? `${refOf(k, i)} — ${said}` : "");
            });
          } catch {
            failed.push([k, i]);
          }
          part.delete(mark);
          finished += 1;
          tell("");
          setGeneration((g) => g + 1);
        }
      });
      await Promise.all(workers);
      return failed;
    }

    let missed = await sweep(jobs);
    if (missed.length) {
      /* One at a time: the usual reason for a refusal is the upstream being
         busy, and three more at once is the one thing that cannot help. */
      finished -= missed.length;
      setDone({ done: finished, total: jobs.length });
      missed = await sweep(missed, 1);
    }
    setWatch((w) => {
      const next = { ...w };
      jobs.forEach(([k, i]) => {
        const mark = jobOf(k, i).key;
        if (missed.some(([mk, mi]) => mk === k && mi === i))
          next[mark] = { rounds: 0, areas: 0, left: [`${FORMS[k].label} came back empty — the writing did not answer. Try again.`] };
        else if (next[mark]?.left?.[0]?.includes("came back empty")) delete next[mark];
      });
      return next;
    });
    doorAgain();
    setBusy("");
  }





  /* The five sections, each carrying the one number you want from it when you
     are standing somewhere else. Brass where something is still missing. */
  const named = sheets.filter((x) => x.signer).length;
  const TABS = [
    { name: "The pack", badge: String(sheets.length), gap: false },
    { name: "Tasks", badge: String(allTasks.length), gap: sheets.some((x) => !x.tasks) },
    { name: "Areas", badge: `${covered.length}/${allCriteria.length}`, gap: sheets.some((x) => !x.areas) },
    { name: "People", badge: `${named}/${sheets.length}`, gap: named < sheets.length },
  ];

  return (
    <div className="workbench caap">
      <aside className="rail">
        <div className="brand">
          <h1>{instrument.label} evidence</h1>
          <p>Northwind Offshore · {FORMS[form].code} · {doc.level}</p>
        </div>

        <div className="tab-bar" role="tablist" aria-label="The pack">
          {TABS.map((t, n) => (
            <button
              key={t.name}
              role="tab"
              id={`caap-tab-${n}`}
              aria-controls="caap-panel"
              aria-selected={tab === n}
              className={tab === n ? "on" : ""}
              onClick={() => setTab(n)}
            >
              {t.name}
              {t.badge && <b className={t.gap ? "gap" : ""}>{t.badge}</b>}
            </button>
          ))}
        </div>

        <div className="rail-body" id="caap-panel" role="tabpanel" aria-labelledby={`caap-tab-${tab}`}>
          {tab === 0 && (
            <Pack
              doc={doc}
              change={change}
              fleet={theFleet}
              level={level}
              LEVELS={LEVELS}
              onLevel={(next) => {
                /* A different level is a different framework and a different
                   task book: what was marked answers a list that is no longer
                   on the table. */
                setDoc((d) => ({ ...d, level: next, discipline: levelNamed(next).caap }));
                setUnit("");
                setAsked("");
                setPicks({ caap: [], crf: [] });
                setMarks({});
                setLens("");
                setOpenUnits({});
                setOpenTasks({});
              }}
              scheme={scheme}
              setWanted={setWanted}
              caapCount={caapCount}
              crfCount={crfCount}
              ORDER={ORDER}
              FORMS={FORMS}
              making={making}
              step={step}
              totalDocs={totalDocs}
              MAX_COPIES={MAX_COPIES}
              sheets={sheets}
              goTasks={() => {
                setLens("");
                setTab(1);
              }}
            />
          )}

          {tab === 1 && (
            <Tasks
              groups={taskGroups}
              orphans={orphanTasks}
              on={tasksOn}
              sheets={sheets}
              lens={lens}
              setLens={setLens}
              onMark={markTask}
              closes={wouldClose}
              wayOut={theWayOut}
              opened={stillOpen.size}
              noun={instrument.noun}
              onAll={(list, put) => markMany("tasks", into, list, put)}
              into={into}
              intoRef={intoRef}
              openUnits={openTasks}
              toggleUnit={(u) => setOpenTasks((o) => ({ ...o, [u]: !o[u] }))}
              openPicker={() => setPicking("task")}
              taskCount={taskCount}
              goAreas={(key) => {
                setLens(key);
                setTab(2);
              }}
            />
          )}

          {tab === 2 && (
            <Areas
              groups={groups}
              on={areasOn}
              sheets={sheets}
              lens={lens}
              setLens={setLens}
              onMark={markArea}
              onAll={(list, put) => markMany("areas", into, list, put)}
              into={into}
              intoRef={intoRef}
              onRead={readAreas}
              reading={reading}
              aiUp={aiUp}
              openUnits={openUnits}
              toggleUnit={(u) => setOpenUnits((o) => ({ ...o, [u]: !o[u] }))}
              instrument={instrument}
              total={allCriteria.length}
              covered={covered.length}
              suggestion={suggestion}
              acceptSuggestion={() =>
                setOpenUnits((o) => {
                  const next = { ...o };
                  for (const u of suggestion?.units || []) next[u] = true;
                  return next;
                })
              }
              openPicker={() => setPicking("criteria")}
              goPeople={(key) => {
                setLens(key);
                setTab(3);
              }}
            />
          )}

          {tab === 3 && (
            <People
              sheets={sheets}
              signerOf={signerOf}
              setSigner={setSigner}
              book={book}
              positions={roleList}
              Bond={Bond}
              candidate={doc.candidate}
            />
          )}
        </div>

        <div className="rail-foot">
          {/* The long job's button carries its own progress fill: one that says
              "Writing 0/4..." and then sits still looks like it did nothing. */}
          {/* Four across. With one document there is nothing to rewrite on its
              own, so the row is three and says so rather than leaving a hole. */}
          <div className={`act-row${sheets.length > 1 ? "" : " three"}`}>
            <button className="btn" onClick={startOff} title="Lay out the facts you have given, without the writing">
              Start it off
            </button>
            <button
              className={`btn run${busy === "write" ? " going" : ""}`}
              onClick={() => write("write")}
              disabled={!aiUp || busy || shortAll.length > 0}
              title={shortAll.length ? saying(shortAll) : "Fill every document you asked for, each with the areas it carries"}
              style={busy === "write" && done.total ? { "--run": `${Math.round((done.done / done.total) * 100)}%` } : undefined}
            >
              <span>
                {busy === "write"
                  ? done.total > 1
                    ? `Writing ${whichOf(done)} of ${done.total}…`
                    : "Writing…"
                  : `Write ${sheets.length > 1 ? "them all" : "it"}`}
              </span>
            </button>
            <button
              className={`btn run${busy === "improve" ? " going" : ""}`}
              onClick={() => write("improve")}
              disabled={!aiUp || busy || shortAll.length > 0}
              title={shortAll.length ? saying(shortAll) : "Rewrite every document, keeping every fact"}
              style={busy === "improve" && done.total ? { "--run": `${Math.round((done.done / done.total) * 100)}%` } : undefined}
            >
              <span>
                {busy === "improve"
                  ? done.total > 1
                    ? `Improving ${whichOf(done)} of ${done.total}…`
                    : "Improving…"
                  : `Improve ${sheets.length > 1 ? "them all" : "it"}`}
              </span>
            </button>
            {/* And the one on the page, on its own. Rewriting the set to fix a
                single copy costs every other copy its wording — and the wait,
                and the minute upstream. */}
            {sheets.length > 1 && (
              <button
                className={`btn run${busy === "one" ? " going" : ""}`}
                onClick={() => write(written(live, at) ? "improve" : "write", [live, at])}
                disabled={!aiUp || busy || shortOne.length > 0}
                title={
                  shortOne.length
                    ? saying(shortOne)
                    : `Write ${refOf(live, at)} again, on its own, leaving the others as they are`
                }
                style={busy === "one" && done.total ? { "--run": `${Math.round((done.done / done.total) * 100)}%` } : undefined}
              >
                <span>
                  {busy === "one"
                    ? `${written(live, at) ? "Rewriting" : "Writing"} ${refOf(live, at)}…`
                    : `${written(live, at) ? "Rewrite" : "Write"} ${refOf(live, at)}`}
                </span>
              </button>
            )}
          </div>
          <div className="act-row out">
            {cloudOn() && (
              <button className="btn" onClick={keep} title="Keep this whole set — every document and copy">
                <Icon name="save" size={12} />
                {saveState || (savedId ? "Save" : "Save the set")}
              </button>
            )}
            <button className="btn primary" onClick={() => window.print()} title="Print the document on the page">
              <Icon name="print" size={12} />
              Print
            </button>
            <button className="btn" onClick={handOver} title="This document, as the official Word file">
              <Icon name="download" size={12} />
              Word
            </button>
            <button
              className={`btn run${bundling ? " going" : ""}`}
              onClick={handOverAll}
              disabled={Boolean(bundling)}
              title={`All ${sheets.length} documents, each its own Word file, in one zip`}
              style={bundling?.total ? { "--run": `${Math.round((bundling.done / bundling.total) * 100)}%` } : undefined}
            >
              <span>
                <Icon name="download" size={12} />
                {bundling ? `${bundling.done}/${bundling.total}` : `All ${sheets.length} · zip`}
              </span>
            </button>
          </div>
          {aiUp && !busy && shortAll.length > 0 && (
            <button className="watch-tag bad as-link" onClick={() => setTab(shortAll.some((x) => x.includes("about")) ? 1 : 3)}>
              {saying(shortAll)}
            </button>
          )}
          {!aiUp && <span className="offline-tag">no answer from the writing — using the phrase bank</span>}
          {aiUp && !busy && Object.keys(watch).length > 0 && (
            <span className={`watch-tag${Object.values(watch).some((w) => w.left) ? " bad" : ""}`}>
              {(() => {
                const all = Object.values(watch);
                const mended = all.filter((w) => w.rounds).length;
                const open = all.filter((w) => w.left.length);
                return open.length
                  ? `checked ${all.length} · ${open.length} still short: ${open[0].left[0].slice(0, 90)}`
                  : `checked ${all.length} · every area answered${mended ? ` · ${mended} repaired` : ""}`;
              })()}
            </span>
          )}
        </div>
      </aside>

      <Picker
        open={picking === "criteria"}
        title={`What ${intoRef} covers`}
        subtitle={scheme === "crf" ? `${level.crf} · Competence Record Form` : level.caap}
        groups={groups}
        chosen={areaObjsOf(intoWhere.kind, intoWhere.i)}
        onToggle={(c) => markArea(into, c.text)}
        onBulk={(items, on) => markMany("areas", into, items.map((c) => c.text), on)}
        levelsLabel={shortRole}
        noun={instrument.noun}
        ownLevel={level.caap}
        onClose={() => setPicking("")}
      />

      <Picker
        open={picking === "task"}
        title={`What ${intoRef} is about`}
        subtitle={`${level.caap} · the tasks this document records`}
        noun="tasks"
        groups={everyTask}
        chosen={tasksOf(intoWhere.kind, intoWhere.i).map((text) => ({ text }))}
        onToggle={(c) => markTask(into, c.text)}
        onBulk={(items, on) => markMany("tasks", into, items.map((c) => c.text), on)}
        levelsLabel={shortRole}
        ownLevel={level.caap}
        onClose={() => setPicking("")}
      />

      <div className="stage" ref={stageRef}>
        <nav className="doc-bar" aria-label="Documents">
          {ORDER.flatMap((key) => {
            const f = FORMS[key];
            const n = making(key);
            return Array.from({ length: n }, (_, i) => (
              <button
                key={slot(key, i)}
                className={`${key === live && i === at ? "on" : ""}${watch[slot(key, i)]?.left?.length ? " flag" : ""}`}
                onClick={() => {
                  setForm(key);
                  setCopy(i);
                }}
                aria-current={key === live && i === at ? "page" : undefined}
                title={[
                  `${f.label} ${f.code}${n > 1 ? ` — ${i + 1} of ${n}` : ""}`,
                  f.blurb,
                  tasksOf(key, i).join("; "),
                  ...(watch[slot(key, i)]?.left || []).map((x) => `· ${x}`),
                ]
                  .filter(Boolean)
                  .join("\n")}
              >
                {/* The four-character reference leads; the form code, the same on every copy
                    of a kind, goes to the tooltip. */}
                <b>
                  <i className="ref">{refOf(key, i)}</i>
                  {f.short}
                </b>
                <em>
                  {(() => {
                    const areas = areaTextsOf(key, i).length;
                    const told = tasksOf(key, i).length;
                    return (
                      [told ? `${told} ${told === 1 ? "task" : "tasks"}` : "", areas ? `${areas} ${areas === 1 ? instrument.one : instrument.noun}` : ""]
                        .filter(Boolean)
                        .join(" · ") || "empty"
                    );
                  })()}
                </em>
              </button>
            ));
          })}
        </nav>
        <div className="sheet-wrap">
          <Paper
            kind={live}
            doc={docOf(live, at)}
            generation={generation}
            content={{ text, own: owns[here] || "", questions }}
            onLine={onLine}
            onBox={onBox}
          />
        </div>
      </div>
    </div>
  );
}
