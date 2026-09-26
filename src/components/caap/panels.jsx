/**
 * The pack's sections as folder tabs. Tasks, areas and documents are one folder seen three ways, so the
 * same marking device serves two of the tabs.
 */
import { Fragment } from "react";
import Icon from "../Icon";

/** Which documents the lists are marking for: all of them, or one. */
export function Lens({ sheets, lens, setLens, noun }) {
  return (
    <div className="lens" role="group" aria-label={`Which document to mark ${noun} for`}>
      <button className={lens ? "" : "on"} onClick={() => setLens("")} aria-pressed={!lens}>
        All {sheets.length}
      </button>
      {sheets.map((s) => (
        <button
          key={s.slot}
          className={`${lens === s.slot ? "on" : ""}${s.gap ? " gap" : ""}`}
          aria-pressed={lens === s.slot}
          onClick={() => setLens(lens === s.slot ? "" : s.slot)}
          title={`${s.label} — ${s.subject || "no task yet"}`}
        >
          {s.ref}
        </button>
      ))}
    </div>
  );
}

/**
 * One line of a list and the documents it is on: every document as a button with the lens off, or a
 * ticklist for the chosen document that notes where else the line already sits.
 */
function MarkRow({ text, note, on, sheets, lens, wide, onMark, closes, wayOut, noun }) {
  return (
    <li className={`mark-row${on.length ? " set" : ""}${closes ? " closes" : ""}${wayOut ? " finishes" : ""}`}>
      <span className="mark-name">
        {text}
        {closes ? (
          <em className="would" title={
            wayOut
              ? `Would answer ${closes} nothing covers yet, and is one of the few that between them finish the framework`
              : `Would answer ${closes} ${noun} nothing covers yet`
          }>
            {wayOut ? "★ " : ""}would close {closes}
          </em>
        ) : (
          note && <em>{note}</em>
        )}
      </span>
      {lens ? (
        <>
          {on.length > (on.includes(lens) ? 1 : 0) && (
            <span className="mark-else">
              also {on.filter((s) => s !== lens).map((s) => sheets.find((x) => x.slot === s)?.ref).filter(Boolean).join(" ")}
            </span>
          )}
          <button
            className={`tick${on.includes(lens) ? " on" : ""}`}
            aria-pressed={on.includes(lens)}
            onClick={() => onMark(lens, text)}
            aria-label={`${on.includes(lens) ? "Take off" : "Put on"} ${sheets.find((x) => x.slot === lens)?.ref}`}
          >
            <Icon name="check" size={11} />
          </button>
        </>
      ) : wide ? (
        <span className="marks">
          {sheets.map((s, n) => (
            <Fragment key={s.slot}>
              {n > 0 && sheets[n - 1].kind !== s.kind && <i className="marks-sep" aria-hidden="true" />}
              <button
                className={on.includes(s.slot) ? "on" : ""}
                aria-pressed={on.includes(s.slot)}
                onClick={() => onMark(s.slot, text)}
                title={`${s.label} — ${s.subject || "no task yet"}`}
              >
                {s.ref}
              </button>
            </Fragment>
          ))}
        </span>
      ) : (
        <span className="mark-on">{on.map((s) => sheets.find((x) => x.slot === s)?.ref).filter(Boolean).join(" ") || "—"}</span>
      )}
    </li>
  );
}

/**
 * A group of either list, with its marked count and one bulk button. The button names its target document
 * ("All -> WT02") because with the lens off every row shows six documents.
 */
function Group({ name, items, open, onOpen, on, into, intoRef, onAll, closes, children }) {
  const mine = items.filter((t) => on(t.text).includes(into)).length;
  const here = items.filter((t) => on(t.text).length).length;
  const would = closes ? items.filter((t) => !on(t.text).length && closes.get(t.text)).length : 0;
  const full = mine === items.length && items.length > 0;
  return (
    <section className="unit">
      <div className="unit-head">
        <button className="unit-open" onClick={onOpen} aria-expanded={Boolean(open)}>
          <i className={`state${here ? "" : " gap"}`} aria-hidden="true" />
          <span className="unit-name">
            {name}
            {here > 0 && (
              <i className="unit-meter" aria-hidden="true">
                <i style={{ width: `${Math.round((here / items.length) * 100)}%` }} />
              </i>
            )}
          </span>
          {would > 0 && !open && (
            <b className="chip would" title={`${would} of these would answer something nothing covers yet`}>
              {would} would
            </b>
          )}
          <b className={`chip${here ? " on" : ""}`}>
            {here}/{items.length}
          </b>
          <em aria-hidden="true">{open ? "▾" : "▸"}</em>
        </button>
        <button
          className={`unit-all${full ? " on" : ""}`}
          onClick={() => onAll(items.map((t) => t.text), !full)}
          title={`${full ? "Take the whole group off" : "Put the whole group on"} ${intoRef}`}
        >
          {full ? "None" : "All"} <i className="ref">{intoRef}</i>
        </button>
      </div>
      {open && children}
    </section>
  );
}

export function Pack({ doc, change, level, LEVELS, onLevel, scheme, setWanted, caapCount, crfCount,
  ORDER, FORMS, making, step, totalDocs, MAX_COPIES, sheets, goTasks, fleet = [] }) {
  return (
    <>
      <fieldset>
        <legend>Level being assessed</legend>
        {/* A ladder, not a list of names: Pilot Technician up to Superintendent.
            Marked so the bench knows it is ordered on purpose. */}
        <select className="level-pick" data-scale="" value={doc.level} onChange={(e) => onLevel(e.target.value)}>
          {LEVELS.map((l) => (
            <option key={l.level}>{l.level}</option>
          ))}
        </select>
        <div className="scheme" role="group" aria-label="What this evidence is for">
          <button className={scheme === "caap" ? "on" : ""} aria-pressed={scheme === "caap"} onClick={() => setWanted("caap")}>
            <b>CAAP</b>
            <em>{caapCount} criteria</em>
          </button>
          <button
            className={scheme === "crf" ? "on" : ""}
            aria-pressed={scheme === "crf"}
            disabled={!level.crf}
            onClick={() => setWanted("crf")}
            title={level.crf ? "Competence Record Form" : `${level.level} has no Record Form`}
          >
            <b>CRF</b>
            <em>{level.crf ? `${crfCount} competences` : "not at this level"}</em>
          </button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Candidate</legend>
        <div className="grid2">
          <label className="field">
            <span>Name</span>
            <input value={doc.candidate} onChange={(e) => change("candidate", e.target.value)} />
          </label>
          <label className="field">
            <span>Date of review</span>
            <input type="date" value={doc.reviewDate} onChange={(e) => change("reviewDate", e.target.value)} />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Where the work was</legend>
        <label className="field">
          <span>Site or vessel</span>
          {/* The fleet is offered to avoid many spellings of one ship, but still typed freely: a trip can
              be on a chartered ship, a rig or a yard. */}
          <input
            value={doc.site}
            onChange={(e) => change("site", e.target.value)}
            list="caap-vessels"
           
          />
          <datalist id="caap-vessels">
            {fleet.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </label>
        <p className="level-note">It prints on the position line of every document in the pack.</p>
      </fieldset>

      <fieldset>
        <legend>Outcome</legend>
        <div className="btn-row">
          <button className={`preset${doc.outcome === "met" ? " on" : ""}`} onClick={() => change("outcome", "met")}>
            Met the standard
          </button>
          <button className={`preset${doc.outcome === "not-yet" ? " on" : ""}`} onClick={() => change("outcome", "not-yet")}>
            Not yet met
          </button>
        </div>
      </fieldset>

      {/* The folder's shape sits with the trip: there is nothing to mark until the documents exist. */}
      <fieldset>
        <legend className="legend-row">
          <span>How many of each</span>
          <span className="avg">
            {sheets.length} {sheets.length === 1 ? "document" : "documents"}
          </span>
        </legend>
        <ul className="copies">
          {ORDER.map((k) => {
            const n = making(k);
            return (
              <li key={k}>
                <span>{FORMS[k].label}</span>
                <div className="step">
                  <button
                    disabled={n <= 0 || totalDocs() <= 1}
                    onClick={() => step(k, -1)}
                    aria-label={`One fewer ${FORMS[k].label}`}
                    title={n === 1 ? `Do not make a ${FORMS[k].label.toLowerCase()}` : ""}
                  >
                    −
                  </button>
                  <b>{n}</b>
                  <button disabled={n >= MAX_COPIES} onClick={() => step(k, 1)} aria-label={`One more ${FORMS[k].label}`}>
                    +
                  </button>
                </div>
                <em>
                  {n === 0
                    ? "not making it"
                    : sheets
                        .filter((x) => x.kind === k)
                        .map((x) => x.ref)
                        .join(" ")}
                </em>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <p className="tab-next">
        Set once — everything in the other three tabs hangs off it.
        <button onClick={goTasks}>Tasks →</button>
      </p>
    </>
  );
}

export function Tasks({ groups, orphans, on, sheets, lens, setLens, onMark, onAll, into, intoRef, closes, wayOut, opened, noun, openUnits, toggleUnit, openPicker, taskCount, goAreas }) {
  const wide = sheets.length <= 8;
  const marked = new Set();
  for (const g of groups) for (const t of g.items) if (on(t.text).length) marked.add(t.text);
  for (const t of orphans) if (on(t.text).length) marked.add(t.text);
  const here = lens ? sheets.find((s) => s.slot === lens) : null;
  const count = here
    ? [...groups.flatMap((g) => g.items), ...orphans].filter((t) => on(t.text).includes(lens)).length
    : marked.size;
  return (
    <>
      <Lens sheets={sheets} lens={lens} setLens={setLens} noun="tasks" />
      <fieldset>
        <legend className="legend-row">
          <span>{here ? `Marking for ${here.ref}` : "Every task, and where it goes"}</span>
          <span className="avg">
            {count} marked{!lens && marked.size ? ` · ${marked.size} of ${taskCount + orphans.length}` : ""}
          </span>
        </legend>
        {!wide && !lens && (
          <p className="level-note">
            {sheets.length} documents is more than a row will hold — choose one above and the list becomes its ticklist.
          </p>
        )}
        {opened > 0 && closes?.size > 0 && (
          <p className="level-note lit">
            {closes.size} {closes.size === 1 ? "task" : "tasks"} would answer something of the {opened} {noun}{" "}
            nothing covers yet — lit below, with what each would close. The {wayOut?.size || 0} marked ★ would
            finish it between them.
          </p>
        )}
        {/* Grouped and collapsed like the scheme's own sections, so fifty-odd tasks are not one wall. */}
        {[...groups, ...(orphans.length ? [{ unit: "Your own words", items: orphans }] : [])].map((g) => (
          <Group
            key={g.unit}
            name={g.unit}
            items={g.items}
            open={openUnits[g.unit]}
            onOpen={() => toggleUnit(g.unit)}
            on={on}
            into={into}
            intoRef={intoRef}
            onAll={(list, put) => onAll(list, put)}
            closes={closes}
          >
            <ul className="mark-list">
              {g.items.map((t) => (
                <MarkRow
                  key={t.text}
                  text={t.text}
                  on={on(t.text)}
                  sheets={sheets}
                  lens={lens}
                  wide={wide}
                  onMark={onMark}
                  closes={on(t.text).length ? 0 : closes?.get(t.text) || 0}
                  wayOut={wayOut?.has(t.text)}
                  noun={noun}
                />
              ))}
            </ul>
          </Group>
        ))}
        <button className="mine quiet" onClick={openPicker}>
          Search the whole list, or add your own
        </button>
      </fieldset>
      <p className="tab-next">
        A task marked here names the document and offers its part of the scheme.
        <button onClick={() => goAreas(lens)}>Areas →</button>
      </p>
    </>
  );
}

export function Areas({ groups, on, sheets, lens, setLens, onMark, onAll, into, intoRef, onRead, reading, aiUp, openUnits, toggleUnit, instrument, total, covered, suggestion, acceptSuggestion, openPicker, goPeople }) {
  const wide = sheets.length <= 8;
  const here = lens ? sheets.find((s) => s.slot === lens) : null;
  const mineOf = (items) => items.filter((c) => (lens ? on(c.text).includes(lens) : on(c.text).length)).length;
  return (
    <>
      <Lens sheets={sheets} lens={lens} setLens={setLens} noun={instrument.noun} />
      <fieldset>
        <legend className="legend-row">
          <span>{here ? `Marking for ${here.ref}` : `${instrument.noun === "competences" ? "Competences" : "Areas of the scheme"}`}</span>
          <span className="avg">{here ? `${mineOf(groups.flatMap((g) => g.items))} on ${here.ref}` : `${covered} of ${total}`}</span>
        </legend>
        {!lens && (
          <div className="cover-meter" aria-hidden="true">
            <i style={{ width: `${total ? Math.round((covered / total) * 100) : 0}%` }} />
          </div>
        )}
        {/* Reads the criteria against what the document says was done, for the lensed document or all;
            it only ever adds. */}
        <button
          className={`mine read${reading ? " going" : ""}`}
          onClick={onRead}
          disabled={!aiUp || Boolean(reading?.total && reading.done < reading.total)}
          style={reading?.total ? { "--run": `${Math.round((reading.done / reading.total) * 100)}%` } : undefined}
          title={`Read what ${here ? here.ref : "each document"} says was done and mark the ${instrument.noun} it proves`}
        >
          <span>
            {reading?.said ||
              (reading
                ? `Reading ${reading.done} of ${reading.total}…`
                : `✻ Read ${here ? `${here.ref}'s` : "every document's"} tasks and mark what they prove`)}
          </span>
        </button>
        {!aiUp && <p className="level-note">The reading needs a connection. Offshore, mark them by hand.</p>}
        {suggestion?.units?.length > 0 && (
          <div className="suggest">
            <p>
              <b>
                {suggestion.units.length} {suggestion.units.length === 1 ? "part" : "parts"} of the scheme behind the tasks on {here?.ref}
              </b>
              <em>{suggestion.units.join(" · ")}</em>
            </p>
            <button onClick={acceptSuggestion}>Open them</button>
          </div>
        )}
        {groups.map((g) => (
          <Group
            key={g.unit}
            name={g.unit}
            items={g.items}
            open={openUnits[g.unit]}
            onOpen={() => toggleUnit(g.unit)}
            on={on}
            into={into}
            intoRef={intoRef}
            onAll={(list, put) => onAll(list, put)}
          >
            <ul className="mark-list">
              {g.items.map((c) => (
                <MarkRow key={c.text} text={c.text} on={on(c.text)} sheets={sheets} lens={lens} wide={wide} onMark={onMark} />
              ))}
            </ul>
          </Group>
        ))}
        <button className="mine quiet" onClick={openPicker}>
          Search every {instrument.one}
        </button>
      </fieldset>
      <p className="tab-next">
        Last: who signs each one.
        <button onClick={() => goPeople("")}>People →</button>
      </p>
    </>
  );
}

export function People({ sheets, signerOf, setSigner, book, positions, Bond, candidate }) {
  return (
    <>
      <datalist id="caap-names">
        {book.map((p) => (
          <option key={p.name} value={p.name}>
            {[p.position, p.site].filter(Boolean).join(" · ")}
          </option>
        ))}
      </datalist>
      <datalist id="caap-positions">
        {positions.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>

      <fieldset>
        <legend className="legend-row">
          <span>One signer per document</span>
          <span className="avg">
            {sheets.filter((s) => s.signer).length} of {sheets.length} named
          </span>
        </legend>
        <p className="level-note">
          A witness testimony is signed by the colleague who saw the work, the rest by the assessor.
          Choose a name you have used before and its position comes with it, or type a new one — nothing
          is shared between documents unless you put it there.
        </p>
        <ul className="signers">
          {sheets.map((s) => {
            const who = signerOf(s.kind, s.i);
            const known = book.find((p) => p.name.toLowerCase() === (who.name || "").trim().toLowerCase());
            return (
              <li key={s.slot} className={`signer${who.name ? "" : " gap"}`}>
                <p className="signer-head">
                  <b className="ref">{s.ref}</b>
                  <span>{s.label}</span>
                  <em>{s.subject || "no task marked"}</em>
                </p>
                <label className="field">
                  <span>{s.kind === "witness" ? "Witness" : "Assessor"}</span>
                  <input
                    list="caap-names"
                    value={who.name}
                    placeholder={book.length ? `choose from ${book.length}, or type a name` : "type the name"}
                    onChange={(e) => setSigner(s.kind, s.i, "name", e.target.value)}
                    onBlur={(e) => setSigner(s.kind, s.i, "name", e.target.value, true)}
                  />
                </label>
                <div className="grid2">
                  <label className="field">
                    <span>Position</span>
                    <input
                      list="caap-positions"
                      value={who.position}
                      placeholder="choose or type"
                      onChange={(e) => setSigner(s.kind, s.i, "position", e.target.value)}
                      onBlur={(e) => setSigner(s.kind, s.i, "position", e.target.value, true)}
                    />
                  </label>
                  <label className="field">
                    <span>Relationship</span>
                    <Bond value={who.bond} onChange={(v) => setSigner(s.kind, s.i, "bond", v, true)} />
                  </label>
                </div>
                {known && known.used > 1 && (
                  <p className="signer-known">
                    On {known.used} documents before{known.site ? ` · ${known.site}` : ""}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>
    </>
  );
}
