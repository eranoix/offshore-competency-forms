import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Sheet from "../components/Sheet";
import Rail from "../components/Rail";
import {
  KEYS,
  LABEL,
  PRESETS,
  V,
  average,
  buildContext,
  comment,
  formatDate,
  generateDocument,
  rewrite,
  rollScore,
  writeBlocks,
} from "../engine/generator";
import { T } from "../engine/generator";
import {
  freshComment,
  improve,
  isAvailable,
  mend,
  onAvailability,
  probe,
  soundsHuman,
  unsupported,
  writeBlock,
} from "../engine/ai";
import { tells, jobWords } from "../engine/review";
import { remember } from "../engine/memory";
import defaults from "../engine/defaults.json";
import { getProfile, loadDocument, putProfile, saveDocument, available as cloudOn } from "../engine/cloud";
import { readMine, writeMine } from "../engine/vault";
import "../styles/form.css";

const PROFILE_KEY = "trip-feedback:profile";
const DOC_KEY = "trip-feedback:doc";
const WORK_KEY = "trip-feedback:work"; // the scores and the wording, so a reload changes nothing

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

/* Under the account, never under the browser: see engine/vault.js. Nothing
   stored means the fallback, exactly as before — an empty object is not the
   same answer as "nothing here". */
function readLocal(key, fallback) {
  const held = readMine(key, null);
  return held && typeof held === "object" ? { ...fallback, ...held } : fallback;
}
const writeLocal = (key, value) => writeMine(key, value);

/** A shared link carries the whole document in the hash — nothing is uploaded. */
function readHash() {
  try {
    const m = location.hash.match(/^#d=(.+)$/);
    if (!m) return null;
    return JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1])))));
  } catch {
    return null;
  }
}
function toHash(payload) {
  return `#d=${encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(payload)))))}`;
}

const BLANK_DOC = {
  start: daysAgo(20),
  end: today(),
  crew: "",
  position: defaults.crew_default,
  vessel: "",
  supervisor: "",
  supervisorPosition: defaults.supervisor_default,
  campaign: "flexlay",
  workScope: V.campaigns.flexlay.scopes[0],
  notes: "",
  draft: false,
};

const shared = readHash();
/* Restores what was on the paper last time, so a reload does not reroll the
   scores or rewrite the text. */


export default function TripFeedback() {
  /* Read inside the page, never at import time: the account is known by then. */
  const saved = shared ? null : readLocal(WORK_KEY, null);
  const [profile, setProfile] = useState(() =>
    readLocal(PROFILE_KEY, { vessels: [], supervisors: [], crews: [] }),
  );
  const [doc, setDoc] = useState(() => shared?.doc || readLocal(DOC_KEY, BLANK_DOC));
  const [preset, setPreset] = useState(() => shared?.preset || saved?.preset || "good");
  const [locked, setLocked] = useState(() => saved?.locked || {});
  const [edited, setEdited] = useState(() => saved?.edited || {});
  const [generation, setGeneration] = useState(0);
  const [warning, setWarning] = useState("");
  const [printed, setPrinted] = useState(false);
  const [wordState, setWordState] = useState("");
  const [shareState, setShareState] = useState("");
  const [savedId, setSavedId] = useState(null);
  const [saveState, setSaveState] = useState("");
  const [aiUp, setAiUp] = useState(isAvailable);
  const [aiBusy, setAiBusy] = useState("");

  const first = useRef(
    shared?.criteria
      ? { criteria: shared.criteria, blocks: shared.blocks, ctx: buildContext(shared.doc) }
      : saved?.criteria && saved?.blocks
        ? { criteria: saved.criteria, blocks: saved.blocks, ctx: buildContext(doc) }
        : generateDocument(doc, { preset }),
  ).current;
  const [criteria, setCriteria] = useState(first.criteria);
  const [blocks, setBlocks] = useState(first.blocks);
  const ctxRef = useRef(first.ctx);
  /* Which supervision step could not run on the last write, if any. */
  const missedRef = useRef("");

  /* An A4 sheet is 210mm wide; a phone is not. Measure the room we have and
     scale the paper to it, so it is always whole and never sideways-scrolled. */
  const stageRef = useRef(null);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fit = () => {
      // Measure from the window, never from the stage: the stage grows with the
      // sheet, so measuring it would feed the scale back into itself.
      const left = stage.getBoundingClientRect().left;
      const room = document.documentElement.clientWidth - left - 26;
      const sheet = 794; // 210mm at 96dpi
      stage.style.setProperty("--sheet-scale", String(Math.min(1, Math.max(0.3, room / sheet))));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(document.documentElement);
    window.addEventListener("orientationchange", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", fit);
    };
  }, []);

  const page1Ref = useRef(null);
  const sigRef = useRef(null);
  const attempts = useRef(0);

  // The AI is on whenever the page can reach it, and quietly off when it cannot.
  useEffect(() => {
    probe().then(setAiUp);
    return onAvailability(setAiUp);
  }, []);

  useEffect(() => writeLocal(DOC_KEY, doc), [doc]);
  /* The sheet as it stands, kept between visits: scores, wording, what is
     locked and what was typed by hand. Nothing is rolled again on its own. */
  useEffect(
    () => writeLocal(WORK_KEY, { preset, criteria, blocks, locked, edited }),
    [preset, criteria, blocks, locked, edited],
  );
  useEffect(() => writeLocal(PROFILE_KEY, profile), [profile]);

  /* The account carries the lists between devices; the browser copy is what
     answers while it is still loading, or when there is no signal. Once the
     account has answered, it is the truth — a union would make forgetting a
     name impossible, since the browser would put it straight back. */
  useEffect(() => {
    if (!cloudOn()) return;
    getProfile()
      .then((remote) =>
        setProfile({
          vessels: remote.vessels || [],
          supervisors: remote.supervisors || [],
          crews: remote.crews || [],
        }),
      )
      .catch(() => {});
    const id = new URLSearchParams(location.search).get("doc");
    if (id)
      loadDocument(id)
        .then((row) => {
          if (!row?.data) return;
          const d = row.data;
          setDoc((current) => ({ ...current, ...d.doc }));
          setCriteria(d.criteria);
          setBlocks(d.blocks);
          setPreset(d.preset || "good");
          setSavedId(row.id);
          setGeneration((g) => g + 1);
        })
        .catch(() => {});
  }, []);

  /* The form has two pages. If the wording runs past the end of page one,
     shorten it and try again before complaining. */
  useLayoutEffect(() => {
    if (!page1Ref.current || !sigRef.current) return;
    const overflow =
      sigRef.current.getBoundingClientRect().bottom -
      page1Ref.current.getBoundingClientRect().bottom +
      30;
    if (overflow > 0) {
      if (attempts.current < 3) {
        attempts.current += 1;
        setBlocks(writeBlocks(ctxRef.current, criteria, attempts.current));
        setGeneration((g) => g + 1);
      } else {
        setWarning("The wording runs past the end of page one. Shorten the supervisor comments.");
      }
    } else {
      attempts.current = 0;
      setWarning("");
    }
  }, [generation, criteria, blocks]);

  const touch = () => {
    setPrinted(false);
    setShareState("");
  };

  function change(field, value) {
    setDoc((d) => {
      const next = { ...d, [field]: value };
      if (field === "campaign") next.workScope = V.campaigns[value].scopes[0];
      return next;
    });
    touch();
  }

  function apply(result) {
    ctxRef.current = result.ctx;
    // Bank used up for these scores: ask the AI rather than recycle an old line.
    if (result.exhausted?.length && aiUp) {
      result.exhausted.slice(0, 4).forEach((k) => setTimeout(() => aiComment(k), 0));
    }
    setCriteria(result.criteria);
    setBlocks(result.blocks);
    setGeneration((g) => g + 1);
    attempts.current = 0;
    touch();
  }

  const shuffle = (presetKey = preset) => {
    setLocked({});
    setEdited({});
    apply(generateDocument(doc, { locked: {}, preset: presetKey }));
  };

  function choosePreset(key) {
    setPreset(key);
    shuffle(key);
  }

  function setScore(key, score) {
    const ctx = ctxRef.current || buildContext(doc);
    setLocked((l) => ({ ...l, [key]: score }));
    setCriteria((c) => {
      if (edited[key]) return { ...c, [key]: { ...c[key], score } };
      const meta = {};
      const text = comment(key, score, ctx, new Set(), meta);
      return { ...c, [key]: { score, comment: text, from: meta.from } };
    });
    if (!edited[key]) setGeneration((g) => g + 1);
    touch();
  }

  function roll(key) {
    const ctx = ctxRef.current || buildContext(doc);
    const score = rollScore(preset);
    setLocked((l) => {
      const next = { ...l };
      delete next[key];
      return next;
    });
    setEdited((e) => ({ ...e, [key]: false }));
    setCriteria((c) => {
      const meta = {};
      const text = comment(key, score, ctx, new Set(), meta);
      return { ...c, [key]: { score, comment: text, from: meta.from } };
    });
    setGeneration((g) => g + 1);
    touch();
  }

  /** A new line for one criterion, written around everything already used. */
  async function aiComment(key) {
    if (!aiUp) return;
    setAiBusy(key);
    try {
      const score = criteria[key].score;
      const text = await freshComment({
        label: LABEL[key],
        score,
        ctx: ctxRef.current || buildContext(doc),
        avoid: (T.criteria[key]?.[String(score)] || []).concat(criteria[key].comment),
        notes: doc.notes,
      });
      setCriteria((c) => ({ ...c, [key]: { score, comment: text } }));
      setEdited((e) => ({ ...e, [key]: true })); // written on purpose: do not overwrite it
      setGeneration((g) => g + 1);
      setWarning("");
      touch();
    } catch (e) {
      if (e.message !== "offline") setWarning(`AI: ${e.message}`);
    } finally {
      setAiBusy("");
    }
  }

  /**
   * The same two readings the evidence forms get. A machine gives itself away
   * in the words it reaches for, which can be listed, and in the shape of what
   * it writes, which takes a reader; and nothing may be asserted that the
   * supervisor did not supply.
   */
  async function asWritten(text, kind) {
    let out = String(text || "").trim();
    if (!out) return out;
    const what =
      kind === "crew" ? "the crew member's own reply on a trip feedback" : "a supervisor's trip feedback";
    /* A check that cannot run has not passed: it is reported, never treated as
       cleared. */
    let unchecked = "";
    for (let round = 0; round < 2; round += 1) {
      const heard = tells(out);
      const judged =
        round === 0 && !heard.length
          ? await soundsHuman({ text: out, what }).catch(() => {
              unchecked = "the reading for how it sounds";
              return { human: true, faults: [] };
            })
          : { human: true, faults: [] };
      /* Only what the supervisor wrote counts as a record: a trip feedback is
         about the man, not the campaign's scope. */
      const made = doc.notes?.trim()
        ? await unsupported({
            text: out,
            passages: [{ doc: "what the supervisor wrote down", text: doc.notes }],
          }).catch(() => {
            unchecked = "the check against your notes";
            return [];
          })
        : [];
      const found = [
        ...heard,
        ...(judged.human ? [] : judged.faults),
        ...made.map((q) => `Nothing was supplied to support this — take it out: “${String(q).slice(0, 120)}”`),
        /* The form asks how he worked, not what he worked on. A named job is
           the drift this document is most prone to, so it is named back. */
        ...(jobWords(out).length
          ? [
              `This form is about the man, not the job. Take out the work itself — ${jobWords(out)
                .slice(0, 6)
                .join(", ")} — and write what he is like instead: how he goes about it, how he is with the crew, how he came on over the trip.`,
            ]
          : []),
      ];
      if (!found.length) break;
      out = String(
        await mend({
          text: out,
          faults: [
            ...found,
            "Say it the way a supervisor would on the day: short sentences, plain words, no praise, nothing repeated.",
          ],
          ctx: ctxRef.current || buildContext(doc),
          notes: doc.notes,
          maxTokens: 1200,
        }).catch(() => out),
      ).trim();
    }
    if (unchecked) missedRef.current = unchecked;
    return out;
  }

  /** Rewrites both prose blocks, keeping the facts and the scores. */
  async function aiImprove() {
    if (!aiUp) return;
    missedRef.current = "";
    setAiBusy("blocks");
    try {
      const ctx = ctxRef.current || buildContext(doc);
      const [supervisor, crew] = await Promise.all([
        improve({ text: blocks.supervisor, kind: "supervisor", ctx, notes: doc.notes }).then((t) =>
          asWritten(t, "supervisor"),
        ),
        improve({ text: blocks.crew, kind: "crew", ctx, notes: doc.notes }).then((t) => asWritten(t, "crew")),
      ]);
      setBlocks({ supervisor, crew });
      setGeneration((g) => g + 1);
      attempts.current = 0;
      setWarning(
        missedRef.current
          ? `Written, but ${missedRef.current} did not run — read it before you send it.`
          : "",
      );
      touch();
    } catch (e) {
      if (e.message !== "offline") setWarning(`AI: ${e.message}`);
    } finally {
      setAiBusy("");
    }
  }

  /** One block at a time: rewrite what is there, or write it again from the
   *  scores and whatever you typed under "What actually happened". */
  async function aiBlock(kind, mode = "improve") {
    if (!aiUp) return;
    missedRef.current = "";
    setAiBusy(kind);
    try {
      const ctx = ctxRef.current || buildContext(doc);
      const drafted =
        mode === "write"
          ? await writeBlock({ kind, ctx, criteria, notes: doc.notes })
          : await improve({ text: blocks[kind], kind, ctx, notes: doc.notes });
      const text = await asWritten(drafted, kind);
      setBlocks((b) => ({ ...b, [kind]: text }));
      setGeneration((g) => g + 1);
      attempts.current = 0;
      setWarning(
        missedRef.current
          ? `Written, but ${missedRef.current} did not run — read it before you send it.`
          : "",
      );
      touch();
    } catch (e) {
      if (e.message !== "offline") setWarning(`AI: ${e.message}`);
    } finally {
      setAiBusy("");
    }
  }

  function edit(target, value) {
    if (target.startsWith("comment:")) {
      const key = target.slice(8);
      setCriteria((c) => ({ ...c, [key]: { ...c[key], comment: value } }));
      setEdited((e) => ({ ...e, [key]: true }));
    } else if (target === "supervisor" || target === "crew") {
      setBlocks((b) => ({ ...b, [target]: value }));
    } else {
      setDoc((d) => ({ ...d, [target]: value }));
    }
    touch();
  }

  /* A phrase is spent when the document goes out — printed, saved, downloaded
     or shared — not while you are still trying presets. Playing with the form
     costs the bank nothing; issuing a document takes its phrases out of it for
     good, so no two of your documents can read the same. */
  function spendPhrases() {
    const fromCriteria = KEYS.map((k) => criteria[k]?.from).filter(Boolean);
    remember(...fromCriteria, ...(blocks.from || []));
  }

  function rememberNames() {
    setProfile((p) => ({
      vessels: doc.vessel && !p.vessels.includes(doc.vessel) ? [doc.vessel, ...p.vessels] : p.vessels,
      supervisors:
        doc.supervisor && !p.supervisors.includes(doc.supervisor)
          ? [doc.supervisor, ...p.supervisors]
          : p.supervisors,
      crews: doc.crew && !p.crews.includes(doc.crew) ? [doc.crew, ...p.crews] : p.crews,
    }));
  }

  function print() {
    rememberNames();
    spendPhrases();
    setPrinted(true);
    setTimeout(() => window.print(), 30);
  }

  const payload = () => ({ doc, preset, criteria, blocks });

  /**
   * The trip feedback as the company's .docx, filled by the same engine as the
   * CAAP forms. It differs from the on-screen sheet, and the page says so.
   */
  const asWord = async () => {
    rememberNames();
    spendPhrases();
    const { fillForm, formName } = await import("../engine/docx");
    const bytes = await fillForm("trip", doc, {
      criteria, text: blocks.supervisor, own: blocks.crew,
    });
    return { bytes, name: formName("trip", doc) };
  };

  /** Hands a file to the browser and takes the link away afterwards, never
      before — revoking it on the next line cancels the download half-written. */
  const handOver = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.style.display = "none";
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 30_000);
  };

  async function wordFile() {
    setWordState("Filling…");
    try {
      const { bytes, name } = await asWord();
      handOver(new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }), name);
      setWordState("");
    } catch (e) {
      setWordState("");
      setWarning(`The Word file could not be made: ${e.message}`);
    }
  }

  /** The Word file as it prints, drawn by the engine that composes it — not by
      this browser. It is what the other side will see. */
  async function wordPdf() {
    setWordState("Drawing…");
    try {
      const { bytes, name } = await asWord();
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: bytes,
      });
      if (!res.ok) throw new Error(`the engine said ${res.status}`);
      handOver(await res.blob(), name.replace(/\.docx$/, ".pdf"));
      setWordState("");
    } catch (e) {
      setWordState("");
      setWarning(`It could not be turned into a PDF: ${e.message}`);
    }
  }

  function download() {
    rememberNames();
    spendPhrases();
    const data = {
      draft: doc.draft,
      crew: doc.crew,
      position: doc.position,
      vessel: doc.vessel,
      supervisor: doc.supervisor,
      supervisor_position: doc.supervisorPosition,
      trip: `${formatDate(doc.start)} to ${formatDate(doc.end)}`,
      work_scope: doc.workScope,
      campaign: doc.campaign,
      preset,
      criteria,
      supervisor_comments: blocks.supervisor,
      crew_comments: blocks.crew,
    };
    /* The link has to be in the document to be clickable, and the blob has to
       outlive the click. */
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `trip-feedback-${(doc.crew || "crew").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${doc.end}.json`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    // Taking the link away, or the blob with it, while the browser is still
    // reading cancels the download half-written. Both go later.
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 30_000);
  }

  async function save() {
    if (!cloudOn()) return;
    setSaveState("Saving…");
    rememberNames();
    spendPhrases();
    try {
      const answer = await saveDocument({
        id: savedId,
        trip_end: doc.end,
        data: { doc, preset, criteria, blocks },
      });
      if (answer?.document?.id) setSavedId(answer.document.id);
      putProfile(profile).catch(() => {});
      setSaveState("Saved");
    } catch (e) {
      setSaveState(e.message === "not signed in" ? "Sign in again" : "Could not save");
    }
    setTimeout(() => setSaveState(""), 4000);
  }

  async function share() {
    spendPhrases();
    const url = location.origin + location.pathname + toHash(payload());
    history.replaceState(null, "", url);
    const title = `Trip feedback — ${doc.crew || "crew member"}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        setShareState("Shared");
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareState("Link copied");
    } catch {
      setShareState("Link is in the address bar");
    }
    setTimeout(() => setShareState(""), 4000);
  }

  const avg = average(criteria);

  return (
    <div className="workbench">
      <Rail
        doc={doc}
        profile={profile}
        criteria={criteria}
        preset={preset}
        average={avg}
        printed={printed}
        warning={warning}
        shareState={shareState}
        onChange={change}
        onPreset={choosePreset}
        onShuffle={() => shuffle()}
        onRewrite={() => apply(rewrite(doc, criteria, edited))}
        onScore={setScore}
        onRoll={roll}
        onPrint={print}
        onDownload={download}
        onWord={wordFile}
        onWordPdf={wordPdf}
        wordState={wordState}
        onSave={save}
        saveState={saveState}
        canSave={cloudOn()}
        onShare={share}
        onAiComment={aiComment}
        onAiImprove={aiImprove}
        onAiBlock={aiBlock}
        aiUp={aiUp}
        aiBusy={aiBusy}
      />
      <main className="stage" ref={stageRef}>
        <div className="sheet-wrap">
          <Sheet
            doc={doc}
            criteria={criteria}
            blocks={blocks}
            generation={generation}
            onEdit={edit}
            onAiBlock={aiUp ? aiBlock : null}
            aiBusy={aiBusy}
            page1Ref={page1Ref}
            sigRef={sigRef}
          />
        </div>
        <p className="tip">
          Click any comment on the sheet to rewrite it by hand. Signatures are left blank.
        </p>
        {/* The two outputs are not the same document, and finding that out from
            a crewing department is worse than reading it here. */}
        <p className="tip quiet">
          Print gives you this sheet. Word fills the company's own form, which is a
          later revision: twelve criteria instead of eleven — the twelfth,
          Leadership Qualities, goes out marked N/A — and the two comment boxes
          are headed Assessor and Assesse.
        </p>
      </main>
    </div>
  );
}

