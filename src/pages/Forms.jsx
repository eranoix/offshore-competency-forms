import { useCallback, useEffect, useMemo, useState } from "react";
import WordEditor from "../components/caap/WordEditor";
import { missingAnchors, whyKeep, wordsOf } from "../engine/wording";
import { whyRefuse } from "../engine/sheeting";
import { catchUpAgain } from "../engine/forms";
import { extOf, FORM_KINDS, FORM_NAMES, isSheet } from "../engine/formkinds";

/**
 * The forms themselves, open in the document server's own Word editor, so anything a form is can
 * be changed. The days-at-sea tracker is a workbook: it opens in the spreadsheet editor and gets
 * a workbook's guard, since it has no paragraphs.
 * Saving is two steps on purpose: the server's own saves land as a draft, and publishing runs the
 * guard first, because every value is found by its paragraph's name and one lost line fills in silence.
 */
export default function Forms({ isAdmin }) {
  const [kind, setKind] = useState("witness");
  const [forms, setForms] = useState(null);
  const [past, setPast] = useState([]);
  const [busy, setBusy] = useState("");
  const [said, setSaid] = useState("");
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState(null);

  const on = forms?.[kind];
  const anchors = useMemo(() => on?.anchors || {}, [on]);

  const look = useCallback(async () => {
    const got = await fetch("/api/render?t=manifest").then((r) => r.json()).catch(() => null);
    setForms(got?.forms || {});
    const list = await fetch(`/api/render?t=versions&kind=${kind}`).then((r) => r.json()).catch(() => null);
    setPast(list?.versions || []);
  }, [kind]);
  useEffect(() => { look(); }, [look]);
  useEffect(() => { setDraft(null); setSaid(""); setNote(""); }, [kind]);

  /** What was last left in the editor, read back so the guard runs on it. */
  const fetchDraft = useCallback(async () => {
    const res = await fetch(`/api/render?t=draft&kind=${kind}`).catch(() => null);
    if (!res?.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 5 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;
    setDraft(bytes);
    return bytes;
  }, [kind]);

  /* The editor saved. Nothing goes anywhere: the page only learns there is
     something it could put in front of the crew. */
  const wasSaved = useCallback(() => {
    fetchDraft().then((got) => {
      if (got) setSaid("Saved here. “Save for everyone” puts it in front of the crew.");
    });
  }, [fetchDraft]);
  const failed = useCallback((e) => setSaid(`The editor: ${e.message}`), []);

  /**
   * Keep what is on screen, now: the editor saves only when it decides to, so this asks the
   * document server to hand the file over at once.
   */
  const saveNow = async () => {
    setBusy("saving");
    try {
      const res = await fetch(`/api/render?t=now&kind=${kind}`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error || `it said ${res.status}`);
      const got = await fetchDraft();
      setSaid(got
        ? "Kept. “Save for everyone” is what puts it in front of the crew."
        : "Nothing has changed since the last time it was kept.");
    } catch (e) {
      setSaid(`It could not be kept: ${e.message}`);
    }
    setBusy("");
  };

  /** The form as it prints, straight from the engine that composes it. */
  const asPdf = async () => {
    setBusy("pdf");
    try {
      const bytes = draft || (await fetchDraft())
        || new Uint8Array(await fetch(`/api/render?t=bytes&kind=${kind}`).then((r) => r.arrayBuffer()));
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: bytes.slice().buffer,
      });
      if (!res.ok) throw new Error(`the engine said ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const at = document.createElement("a");
      at.href = url;
      at.download = `${FORM_NAMES[kind]}.pdf`;
      at.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setSaid("");
    } catch (e) {
      setSaid(`It could not be turned into a PDF: ${e.message}`);
    }
    setBusy("");
  };

  /**
   * A document that still has every line a value is written on; without one the form would go
   * out filling in silence. Answers the labels the engine needs to find the printed lines by.
   */
  const stillADocument = (bytes) => {
    const lost = missingAnchors(bytes, anchors);
    if (lost.length) {
      /* Which line, and what it was for. "signer is missing" means nothing to
         somebody who has just been editing a document; "the line who signs it
         is written on" is the same fact in words they were looking at. */
      const reasons = lost
        .map((slot) => whyKeep(bytes, anchors[slot], anchors).find((z) => z.hard)?.why)
        .filter(Boolean);
      throw new Error(`${reasons[0] || `the line ${lost.join(", ")} goes on`} — it is gone or empty, and the form would fill in silence`);
    }
    const words = wordsOf(bytes, anchors);
    for (const slot of ["signer", "position", "candidate", "bond"]) {
      const id = anchors[slot];
      if (!id) continue;
      const text = words.find((l) => l.id === id)?.text || "";
      if (!text.includes(":") && !/…/.test(text))
        throw new Error(`the line ${slot} goes on has to keep its colon — the value is written after it`);
    }
    return Object.entries(anchors)
      .filter(([slot]) => ["signer", "position", "candidate", "bond"].includes(slot))
      .map(([, id]) => (words.find((l) => l.id === id)?.text || "").replace(/\s*:.*$/, "").trim())
      .filter(Boolean);
  };

  /**
   * A workbook that would still count days after it is published. Its own guard, because the
   * document guard finds no paragraphs in an .xlsx and waves it through; it catches a formula typed over.
   */
  const stillAWorkbook = (bytes) => {
    const wrong = whyRefuse(bytes);
    if (wrong.length) throw new Error(wrong[0].why);
  };

  /**
   * In front of everybody.
   *
   * The guard first — whichever guard this kind of file has — and then, for a
   * document only, where the blanks land on the drawn page. A workbook has no
   * drawn page to land anything on, so it is not asked for one.
   */
  const publishThese = async (bytes, why) => {
    let blanks = {};
    if (isSheet(kind)) {
      stillAWorkbook(bytes);
    } else {
      const labels = stillADocument(bytes);
      const mapped = await fetch("/api/render?t=map", {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "x-labels": JSON.stringify(labels) },
        body: bytes.slice().buffer,
      });
      if (!mapped.ok) throw new Error((await mapped.json()).error || `the engine said ${mapped.status}`);
      blanks = await mapped.json();
    }
    const made = await fetch(`/api/render?t=publish&kind=${kind}`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-form": JSON.stringify({ anchors, blanks, wording: {}, note: note || why || "" }),
      },
      body: bytes.slice().buffer,
    });
    if (!made.ok) throw new Error((await made.json()).error || `it was refused (${made.status})`);
    const { version } = await made.json();
    const moved = await fetch(`/api/render?t=live&kind=${kind}&v=${version}`, { method: "PATCH" });
    if (!moved.ok) throw new Error((await moved.json()).error || "it could not be made the live one");
    setNote(""); setDraft(null);
    /* This browser holds the form it arrived with; ask again so whoever just changed a form
       sees it changed without a reload. */
    await catchUpAgain().catch(() => false);
    setSaid(`Saved. Everybody is on version ${version} of the ${FORM_NAMES[kind]} now.`);
    await look();
  };

  /** A form edited somewhere else entirely, brought in. */
  const bringIn = async (file) => {
    if (!file) return;
    setBusy("importing");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length < 5 || bytes[0] !== 0x50 || bytes[1] !== 0x4b)
        throw new Error(`that is not a ${isSheet(kind) ? "workbook" : "Word document"}`);
      await publishThese(bytes, `imported ${file.name}`);
    } catch (e) {
      setSaid(`Not imported: ${e.message}`);
    }
    setBusy("");
  };

  const saveForAll = async () => {
    setBusy("publishing");
    try {
      const bytes = draft || (await fetchDraft());
      if (!bytes) throw new Error("nothing has been changed in the editor yet");
      await publishThese(bytes, "edited on the site");
    } catch (e) {
      setSaid(`Not saved: ${e.message}`);
    }
    setBusy("");
  };

  const goBack = async (version) => {
    setBusy("publishing");
    const res = await fetch(`/api/render?t=live&kind=${kind}&v=${version}`, { method: "PATCH" });
    setSaid(res.ok
      ? `Everybody is on version ${version} of the ${FORM_NAMES[kind]} now.`
      : `It could not be moved: ${(await res.json()).error || res.status}`);
    setDraft(null);
    await look();
    setBusy("");
  };

  const bad = /not saved|not imported|could not|missing|gone|refused|editor:/i.test(said);

  return (
    <main className="home forms">
      {/* Each tab carries what it is as well as what it says: the label on it
          is one of the things the company can change from this very page. */}
      <div className="doc-bar" role="tablist">
        {FORM_KINDS.map((k) => (
          <button key={k} role="tab" data-kind={k} aria-selected={k === kind}
            className={k === kind ? "on" : ""} onClick={() => setKind(k)}>
            <b>{FORM_NAMES[k]}</b>
            <em>{forms?.[k] ? `v${forms[k].version}` : "…"}</em>
          </button>
        ))}
      </div>

      <div className="forms-tools" role="group" aria-label="What to do with this form">
        <button className="btn" onClick={saveNow} disabled={Boolean(busy)}
          title="Keep what is on screen, without waiting for the editor to decide">
          {busy === "saving" ? "Keeping…" : "Save"}
        </button>
        <label className={`btn${busy ? " off" : ""}`}>
          {busy === "importing" ? "Importing…" : "Import"}
          <input type="file" accept={`.${extOf(kind)}`} hidden
            onChange={(e) => { bringIn(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <a className="btn" href={`/api/render?t=bytes&kind=${kind}`}
          download={`${FORM_NAMES[kind]}.${extOf(kind)}`}>Export</a>
        <button className="btn" onClick={asPdf} disabled={Boolean(busy)}>
          {busy === "pdf" ? "Drawing…" : "Export to PDF"}
        </button>
        <span className="tools-gap" />
        {isAdmin ? (
          <>
            <input className="forms-note" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="what changed, in your words" />
            <button className="btn primary" onClick={saveForAll} disabled={Boolean(busy)}
              title={draft ? "" : "Change something in the editor first"}>
              {busy === "publishing" ? "Saving…" : "Save for everyone"}
            </button>
            <button className="btn" onClick={() => goBack(0)} disabled={Boolean(busy) || on?.version === 0}>
              Back to the company's
            </button>
          </>
        ) : (
          <span className="note">Only an admin puts a form in front of everybody.</span>
        )}
      </div>

      {said && <p className={`forms-said${bad ? " bad" : ""}`}>{said}</p>}

      <div className="forms-doc">
        <WordEditor key={`${kind}:${on?.version ?? 0}`} kind={kind} onSaved={wasSaved} onFail={failed} />
      </div>

      {past.length > 1 && (
        <details className="versions">
          <summary>
            <b>Versions</b>
            <span>{past.length} of them · the one in the air is marked</span>
          </summary>
          <ul>
            {past.map((v) => (
              <li key={v.id} className={v.version === on?.version ? "on" : ""}>
                <b>v{v.version}{v.version === on?.version ? " · live" : ""}</b>
                <span>{v.note || "no note"} — {v.created_email || "seed"}</span>
                {v.version === on?.version || !isAdmin ? null : (
                  <button onClick={() => goBack(v.version)}>make this the live one</button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}
