import Icon from "./Icon";
import { CRITERIA, LABEL, PRESETS, campaignList } from "../engine/generator";
import { vessels } from "../engine/fleet";
import { inOrder } from "../engine/order";
import defaults from "../engine/defaults.json";

/* The jobs, in one order, worked out once rather than on every keystroke. */
const ROLES = inOrder(defaults.roles);

const SCORES = [1, 2, 3, 4, 5];

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ScoreRow({ id, label, score, onScore, onRoll, onAi, aiUp, busy }) {
  return (
    <div className="srow">
      <label id={`lb-${id}`}>{label}</label>
      <div className="meter" role="group" aria-labelledby={`lb-${id}`}>
        {SCORES.map((n) => (
          <button
            key={n}
            className={`cell${n < 3 ? " low" : ""}`}
            title={n < 3 ? "Below target — the dice never rolls this" : `Score ${n}`}
            aria-pressed={score === n}
            onClick={() => onScore(id, n)}
          >
            {n}
          </button>
        ))}
      </div>
      <button
        className="dice"
        onClick={() => onRoll(id)}
        title="Roll this score inside the preset"
        aria-label={`Roll ${LABEL[id]}`}
      >
        ⟳
      </button>
      {aiUp && (
        <button
          className={`dice ai${busy ? " busy" : ""}`}
          onClick={() => onAi(id)}
          disabled={busy}
          title="Write a new line"
          aria-label={`Rewrite ${LABEL[id]} with AI`}
        >
          {busy ? "·" : "✶"}
        </button>
      )}
    </div>
  );
}

export default function Rail({
  doc,
  profile,
  criteria,
  preset,
  average,
  printed,
  warning,
  shareState,
  onChange,
  onPreset,
  onShuffle,
  onRewrite,
  onScore,
  onRoll,
  onPrint,
  onDownload,
  onWord,
  onWordPdf,
  wordState,
  onSave,
  saveState,
  canSave,
  onShare,
  onAiComment,
  onAiImprove,
  onAiBlock,
  aiUp,
  aiBusy,
}) {
  const days =
    doc.start && doc.end
      ? Math.round((new Date(doc.end) - new Date(doc.start)) / 864e5) + 1
      : 0;
  const backwards = new Date(doc.end) < new Date(doc.start);
  /* The ones this person has been on are folded in rather than put first: a
     list that reorders itself has to be read whole every time. */
  const theFleet = vessels(profile.vessels);

  return (
    <aside className="rail">
      <div className="brand">
        <h1>Worksite Trip Feedback</h1>
        <p>Northwind Offshore · NW-CAP Rev 1</p>
      </div>

      <div className="rail-body">
        <fieldset>
          <legend>Trip</legend>
          <div className="grid2">
            <Field label="Start">
              <input
                type="date"
                value={doc.start}
                onChange={(e) => onChange("start", e.target.value)}
              />
            </Field>
            <Field label="End">
              <input type="date" value={doc.end} onChange={(e) => onChange("end", e.target.value)} />
            </Field>
          </div>
          <span className={`dur${backwards ? " bad" : ""}`}>
            {backwards ? "The end date is before the start" : `${days} day${days === 1 ? "" : "s"} on board`}
          </span>
        </fieldset>

        <fieldset>
          <legend>People</legend>
          <div className="grid2">
            <Field label="Crew member">
              <input
                type="text"
                list="l-crew"
                placeholder="Name"
                value={doc.crew}
                onChange={(e) => onChange("crew", e.target.value)}
              />
            </Field>
            <Field label="Position">
              <select value={doc.position} onChange={(e) => onChange("position", e.target.value)}>
                {ROLES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid2">
            <Field label="Written by">
              <input
                type="text"
                list="l-sup"
                placeholder="Supervisor"
                value={doc.supervisor}
                onChange={(e) => onChange("supervisor", e.target.value)}
              />
            </Field>
            <Field label="Position">
              <select
                value={doc.supervisorPosition}
                onChange={(e) => onChange("supervisorPosition", e.target.value)}
              >
                {ROLES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>
          <datalist id="l-crew">
            {inOrder(profile.crews).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <datalist id="l-sup">
            {inOrder(profile.supervisors).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </fieldset>

        <fieldset>
          <legend>Work</legend>
          <div className="grid2">
            <Field label="Vessel">
              <input
                type="text"
                list="l-vessel"
                placeholder="Vessel name"
                value={doc.vessel}
                onChange={(e) => onChange("vessel", e.target.value)}
              />
            </Field>
            <Field label="Campaign">
              <select value={doc.campaign} onChange={(e) => onChange("campaign", e.target.value)}>
                {inOrder(campaignList(), (c) => c.name).map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {/* The fleet, the same list the evidence panel offers, plus whatever else this
              person has been on. Still typed in freely: a trip can be on a
              chartered vessel, a rig or a yard. */}
          <datalist id="l-vessel">
            {theFleet.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <div className="field scope">
            <span>Work scope</span>
            <textarea
              rows={2}
              aria-label="Work scope"
              value={doc.workScope}
              onChange={(e) => onChange("workScope", e.target.value)}
            />
          </div>
        </fieldset>

        <fieldset>
          <legend>What actually happened</legend>
          <textarea
            rows={2}
            className="facts"
            placeholder="A fault he fixed, a job he took over, a night he stayed on. Plain notes are enough."
            value={doc.notes || ""}
            onChange={(e) => onChange("notes", e.target.value)}
          />
          {aiUp && (
            <div className="btn-row">
              <button className="btn" onClick={() => onAiBlock("supervisor", "write")} disabled={aiBusy === "supervisor"}>
                {aiBusy === "supervisor" ? "Writing…" : "Write the supervisor block"}
              </button>
              <button className="btn" onClick={() => onAiBlock("crew", "write")} disabled={aiBusy === "crew"}>
                {aiBusy === "crew" ? "Writing…" : "Write the crew reply"}
              </button>
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend className="legend-row">
            <span>Scores</span>
            <span className="avg">avg {average.toFixed(1)} · {PRESETS[preset].label.toLowerCase()}</span>
          </legend>
          <div className="presets" role="group" aria-label="Score preset">
            {Object.entries(PRESETS).map(([key, p]) => (
              <button
                key={key}
                className={`preset${preset === key ? " on" : ""}`}
                aria-pressed={preset === key}
                onClick={() => onPreset(key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="btn-row">
            <button className="btn" onClick={onShuffle}>
              Roll scores
            </button>
            <button className="btn" onClick={onRewrite}>
              Rewrite wording
            </button>
          </div>
          <div className={`scores${aiUp ? " with-ai" : ""}`}>
            {CRITERIA.map(([key, label]) => (
              <ScoreRow
                key={key}
                id={key}
                label={label}
                score={criteria[key].score}
                onScore={onScore}
                onRoll={onRoll}
                onAi={onAiComment}
                aiUp={aiUp}
                busy={aiBusy === key}
              />
            ))}
          </div>
          {aiUp && (
            <button className="btn" onClick={onAiImprove} disabled={aiBusy === "blocks"}>
              {aiBusy === "blocks" ? "Rewriting…" : "Improve the wording"}
            </button>
          )}
        </fieldset>
      </div>

      <div className="rail-foot">
        {printed && (
          <div className="status">
            <span className="dot ok" />
            <span>Printed — signatures left blank</span>
          </div>
        )}
        <button className="btn primary" onClick={onPrint}>
          <Icon name="print" size={13} />
          Print / save PDF
        </button>
        {/* These two fill the company's own .docx; the button above prints what is
            on screen. */}
        <div className="actions docs">
          <button onClick={onWord} title="Fill the company's Word form and download it">
            <Icon name="form" size={12} />
            <span>{wordState || "Word"}</span>
          </button>
          <button onClick={onWordPdf} title="The Word form drawn as a PDF by the engine">
            <Icon name="print" size={12} />
            <span>Word as PDF</span>
          </button>
        </div>
        <div className="actions">
          <button onClick={onDownload} title="Download the data file">
            <Icon name="download" size={12} />
            <span>Download</span>
          </button>
          <button onClick={onShare} title="Copy a link carrying this document">
            <Icon name="share" size={12} />
            <span>{shareState || "Share"}</span>
          </button>
          {canSave && (
            <button onClick={onSave} title="Keep it in your account">
              <Icon name="save" size={12} />
              <span>{saveState || "Save"}</span>
            </button>
          )}
          <button
            onClick={() => onChange("draft", !doc.draft)}
            className={doc.draft ? "on" : ""}
            title="Stamp the sheet as a draft"
          >
            <Icon name="draft" size={12} />
            <span>Draft</span>
          </button>
        </div>
        {warning && <div className="warn">{warning}</div>}
        {!aiUp && (
          <span
            className="offline-tag"
            title="The writing endpoint did not answer. The page keeps checking on its own; until it does, the phrase bank writes."
          >
            no answer from the writing — using the phrase bank
          </span>
        )}
      </div>
    </aside>
  );
}
