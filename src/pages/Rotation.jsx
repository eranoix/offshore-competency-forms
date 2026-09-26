import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  absencesIn, BLANK_PLAN, cycleOf, dayOf, guessPattern, isoOf, landing, marksOf, monthLength,
  monthStart, monthTally, nextChange, patternOf, runsIn, saidOn, sheetsOf, STATE, STATES,
  statesAcross, tally, turnsOf, withDays, yearTally, eventsIn, barsOf, moveEvent, dropDate, restoreDate, pruneTrash, duplicateDate, TRASH_DAYS, parseEvent, changeOccurrence, withNote, CATEGORIES, CATEGORY, SHIFTS, shiftsAcross, bothHome, agendaOf, yearsOf, planOf, payOf, BLANK_PAY, holidaySuggestions, takeHolidays, holidaysPending, clearPlan, clearable, mergePlans, samePlan, repeatWords, hasRotation,
  withHitch, changeHitch, dropHitch, dismissTurn, withSuggestions, turnsFrom, offAfter,
} from "../engine/rotation";
import { COUNTRIES } from "../engine/holidays";
import { readIcs } from "../engine/ics.js";
import { available, listDocuments, loadDocument, savePlan } from "../engine/cloud";
import { readMine, writeMine } from "../engine/vault";
import { inOrder } from "../engine/order";

/**
 * The rotation, on one screen; the arithmetic is in `src/engine/rotation.js`.
 * Hotel nights are a state of their own because a tax year is decided on them.
 * With nothing saved it projects the usual 28 and 28 from today, never a blank form.
 */
const KEY = "rotation:plan";
const CERTS = "rotation:certs";
const LINE = 183;

/**
 * The Seafarers' Earnings Deduction module, via `import.meta.glob` rather than a
 * plain import so this page still builds without it (the quadrant then says so).
 * Fetched only for a reader on a UK salary who asks for it.
 */
const SEATAX = import.meta.glob("../engine/seatax.js");

const today = () => new Date().toISOString().slice(0, 10);
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* Monday first, and worked out in UTC like everything else that touches a day
   here — see the note at the top of engine/rotation.js. */
const weekday = (day) => (new Date(day * 864e5).getUTCDay() + 6) % 7;
const fmt = (iso, opts) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
const shortDate = (iso) => fmt(iso, { weekday: "short", day: "numeric", month: "short" });
const withYear = (iso) => fmt(iso, { day: "numeric", month: "long", year: "numeric" });
const share = (n, of) => (of > 0 ? Math.round((n / of) * 100) : 0);
const col = (key) => `var(--st-${key})`;
const tint = (key, n) => `color-mix(in srgb, var(--st-${key}) ${n}%, transparent)`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const GLYPH = { family: "●", holiday: "▲", certificate: "▮", linked: "◆" };
/* Where the first bar sits under a day's number, and how far apart they are.
   Read by the page to work out how many bars a day has room for; the same
   numbers are in the stylesheet as the bar's own top and height. */
const BAR_TOP = 19;
const BAR_STEP = 15;
/* How wide the grip at each end of a bar is, in pixels. */
const GRIP = 8;
/* Which events a drag may move: his own dates, and the stretches he told. */
const movable = (it) => it.sort === "state" || it.sort === "hitch" || it.sort === "suggested" || (it.sort === "family" && Boolean(it.id));
/* Where a dragged event would land: the whole of it shifted by the days the
   pointer has moved, or one end moved and the other held — and an end never
   dragged past the other one, which would turn the event inside out. */
function draggedTo({ item, part, at, over }) {
  const shift = dayOf(over) - dayOf(at);
  const a = dayOf(item.from);
  const b = dayOf(item.to);
  if (part === "start") return { from: isoOf(Math.min(a + shift, b)), to: item.to };
  if (part === "end") return { from: item.from, to: isoOf(Math.max(b + shift, a)) };
  if (part === "whole") return { from: isoOf(a + shift), to: isoOf(b + shift) };
  return { from: item.from, to: item.to };
}
const short = (iso) => fmt(iso, { day: "numeric", month: "short" });

/** A shared link carries the whole plan in the hash — nothing is uploaded. */
function readHash() {
  try {
    const found = location.hash.match(/^#r=(.+)$/);
    if (!found) return null;
    return JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(found[1])))));
  } catch {
    return null;
  }
}

/* A shared rotation is deflated JSON in URL-safe base64, so its QR code stays
   small enough to scan off a screen. Old #r= links are still read. */
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function squeeze(payload) {
  const stream = new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return `#z=${b64u(new Uint8Array(await new Response(stream).arrayBuffer()))}`;
}
async function readSqueezed() {
  const found = location.hash.match(/^#z=([A-Za-z0-9_-]+)$/);
  if (!found) return null;
  try {
    const stream = new Blob([unb64u(found[1])]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return JSON.parse(await new Response(stream).text());
  } catch {
    return null;
  }
}
/**
 * What a shared link carries: the rotation and its dates, nothing else (not pay,
 * notes, bin, other rotations or the feed code): links are forwarded and kept for years.
 */
const sharedOf = (plan) => {
  const { who, pattern, anchor, horizon, slips, days, dates, holidays, hitches, suggest, dismissed } = plan;
  return { v: 1, who, pattern, anchor, horizon, slips, days, holidays, hitches, suggest, dismissed,
    dates: (dates || []).map(({ desc, where, src, sig, uid, ...d }) => d) };
};
/* The two-way calendar is shown once its address is answering: it needs the
   proxy on our own server (vps/dav-proxy), and a button that leads to a
   calendar nobody can reach is worse than no button. */
const DAV_READY = false;

const toHash = (payload) =>
  `#r=${encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(payload)))))}`;

/**
 * The rotation's stretches away as `engine/seatax.js` absences. `back` is the day
 * after the stretch ends, so days out and days in tile the calendar exactly. A
 * stretch still running is handed over open (no return); one already under way on
 * the window's first day is dropped, so it cannot fake the period's start. The
 * port is not in a rotation, so it is left empty.
 */
function absencesFor(plan, fromIso, toIso) {
  const last = dayOf(toIso);
  return absencesIn(plan, fromIso, toIso)
    .filter((run) => dayOf(run.from) > dayOf(fromIso))
    .map((run) => ({
      left: run.from,
      back: dayOf(run.to) >= last ? null : isoOf(dayOf(run.to) + 1),
      port: "",
    }));
}

/**
 * Asks which occurrences of a yearly event a change means. It is the
 * confirmation: no "are you sure" follows, and Undo works as for anything else.
 */
function ScopeAsk({ verb, what, year, day, onPick, onCancel }) {
  useEffect(() => {
    const key = (e) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onCancel]);
  return (
    <div className="rota-help" role="dialog" aria-label={`${verb} a repeating event`} onClick={onCancel}>
      <div className="rota-scope" onClick={(e) => e.stopPropagation()}>
        <header><b>{verb} “{what}”</b></header>
        <p className="rota-note">{day ? "It repeats." : "It comes round every year."} Which of them?</p>
        <button type="button" className="rota-chip" autoFocus onClick={() => onPick("one")}>{day ? `Only ${day}` : `Only ${year}`}</button>
        <button type="button" className="rota-chip" onClick={() => onPick("following")}>{day ? `${day} and every one after` : `${year} and every year after`}</button>
        <button type="button" className="rota-chip" onClick={() => onPick("all")}>{day ? "All of them" : "Every year"}</button>
        <button type="button" className="rota-link" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function EventPop({ item, rect, onEdit, onDelete, onDuplicate, onClose, children }) {
  const box = useRef(null);
  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape") onClose();
      /* Delete or Backspace deletes the open event, as in Google Calendar. */
      else if ((e.key === "Delete" || e.key === "Backspace") && onDelete
        && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { e.preventDefault(); onDelete(); }
    };
    const away = (e) => { if (!box.current?.contains(e.target) && !e.target.closest?.(".rota-bar")) onClose(); };
    document.addEventListener("keydown", key);
    const t = setTimeout(() => document.addEventListener("mousedown", away), 0);
    box.current?.querySelector("button")?.focus();
    return () => { clearTimeout(t); document.removeEventListener("keydown", key); document.removeEventListener("mousedown", away); };
  }, [onClose, onDelete]);
  const WIDE = item.sort === "hitch" || item.sort === "suggested" ? 340 : 280;
  const left = Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - WIDE - 8)));
  /* On whichever side of the bar has more room: the rotation's events carry
     their own buttons and are taller than a plain one. */
  const below = window.innerHeight - rect.bottom >= rect.top;
  const many = item.from !== item.to;
  const days = dayOf(item.to) - dayOf(item.from) + 1;
  const long = (iso) => fmt(iso, { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  const kind = item.sort === "hitch" ? "⚓ Your hitch — the turns after it follow it"
    : item.sort === "suggested" ? "⚓ Suggested by your rotation — nothing is counted as yours until you accept it"
    : item.sort === "state" ? `${STATE[item.state].mark} Told stretch — the rotation did not say this`
    : item.sort === "holiday" ? "▲ Public holiday" : item.sort === "certificate" ? "▮ Certificate"
      : item.sort === "linked" ? `◆ From ${item.source} — change it there, and it changes here` : "● Your event";
  return (
    <div className={`rota-pop is-${item.sort}`} ref={box} role="dialog" aria-label={item.what}
      style={{ left, width: WIDE, maxHeight: Math.round((below ? window.innerHeight - rect.bottom : rect.top) - 14),
        ...(below ? { top: Math.round(rect.bottom + 6) } : { bottom: Math.round(window.innerHeight - rect.top + 6) }) }}>
      <div className="rota-pop-tools">
        {onEdit && <button type="button" onClick={onEdit} title="Edit">✏️<span>Edit</span></button>}
        {onDuplicate && <button type="button" onClick={onDuplicate} title="Duplicate">📋<span>Duplicate</span></button>}
        {onDelete && <button type="button" className="is-danger" onClick={onDelete} title="Delete (Del)">🗑<span>Delete</span></button>}
        <button type="button" className="rota-x" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <p className="rota-pop-what"><i style={item.sort === "linked" ? { background: item.color } : item.cat ? { background: `${CATEGORY[item.cat].color}` } : undefined} />{item.what}</p>
      <p className="rota-pop-when">
        {many ? <>{long(item.from)} –<br />{long(item.to)} · {days} days</> : long(item.from)}
      </p>
      {item.time?.s ? <p className="rota-pop-when">{item.time.s}{item.time.e ? `–${item.time.e}` : ""}{item.where ? ` · ${item.where}` : ""}</p>
        : item.where ? <p className="rota-pop-when">{item.where}</p> : null}
      <p className="rota-pop-kind">{kind}{item.every === "year" ? " · every year" : item.every === "repeat" ? ` · ${item.rule}` : ""}{item.note && !/\//.test(item.note) ? ` · ${item.note}` : ""}
        {item.cat ? <b style={{ color: CATEGORY[item.cat].color }}> · {CATEGORY[item.cat].label}</b> : null}</p>
      {item.desc ? <p className="rota-pop-desc">{item.desc}</p> : null}
      {children}
    </div>
  );
}

/**
 * What can be done to the rotation's own events. A suggestion is accepted,
 * turned down, or accepted on other dates; a hitch is made a day shorter or
 * longer, given more or fewer days at home than the proportional ones, or put
 * on other dates. Every change moves the suggestions after it.
 */
function TurnTools({ item, plan, onPlan, onClose }) {
  const [from, setFrom] = useState(item.from);
  const [to, setTo] = useState(item.to);
  const days = Math.max(1, dayOf(to) - dayOf(from) + 1);
  const hitch = item.sort === "hitch" ? (plan.hitches || []).find((h) => h.id === item.id) : null;
  const fair = hitch ? offAfter(plan, { ...hitch, off: undefined }) : 0;
  const shift = (n) => isoOf(dayOf(item.to) + n);
  const done = (next, text) => { onPlan(next, text); onClose(); };
  const moved = from !== item.from || to !== item.to;
  return (
    <div className="rota-turn">
      {item.sort === "suggested" ? (
        <div className="rota-turn-row">
          <button type="button" className="btn primary" onClick={() => done(withHitch(plan, item.from, item.to), `Accepted: aboard ${short(item.from)} – ${short(item.to)}.`)}>✓ Accept</button>
          <button type="button" className="btn" onClick={() => done(dismissTurn(plan, item.from), "Suggestion turned down — those days are at home.")}>✕ Dismiss</button>
        </div>
      ) : (
        <>
          <div className="rota-turn-row">
            <button type="button" className="btn" onClick={() => done(changeHitch(plan, item.id, { to: shift(-1) }), "A day shorter — the turns after it come a day sooner.")}
              disabled={item.from === item.to}>−1 day · home early</button>
            <button type="button" className="btn" onClick={() => done(changeHitch(plan, item.id, { to: shift(1) }), "A day longer — the turns after it move a day on.")}>+1 day · stayed on</button>
          </div>
          <div className="rota-turn-row is-home">
            <span>Home after: <b>{item.off} days</b>{item.ownOff ? " (set by you)" : ` (in proportion to ${item.days} aboard)`}</span>
            <button type="button" className="rota-plus" aria-label="One day fewer at home" disabled={!item.off}
              onClick={() => done(changeHitch(plan, item.id, { off: Math.max(0, item.off - 1) }), `${item.off - 1} days at home.`)}>−</button>
            <button type="button" className="rota-plus" aria-label="One day more at home"
              onClick={() => done(changeHitch(plan, item.id, { off: item.off + 1 }), `${item.off + 1} days at home.`)}>+</button>
            {item.ownOff && <button type="button" className="rota-link" onClick={() => done(changeHitch(plan, item.id, { off: null }), `Back to ${fair} days — in proportion.`)}>Proportional</button>}
          </div>
        </>
      )}
      <div className="rota-range">
        <label><span>Aboard from</span><input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <label><span>to</span><input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
      </div>
      {moved && (
        <div className="rota-turn-row">
          <button type="button" className="btn primary"
            onClick={() => done(item.sort === "hitch" ? changeHitch(plan, item.id, { from, to }) : withHitch(plan, from, to),
              `Aboard ${short(from)} – ${short(to)}, ${days} days — the turns after it follow.`)}>
            {item.sort === "hitch" ? "Save these dates" : "Accept with these dates"}</button>
        </div>
      )}
      {item.sort === "suggested" && (
        <button type="button" className="rota-link" onClick={() => done(withSuggestions(plan, false), "Suggestions cleared — only your own hitches are left.")}>Clear all suggestions</button>
      )}
    </div>
  );
}

function DayCard({ from, to, at, plan, marks, editId, today, onRange, onState, onSave, onDrop, onNote, onClose }) {
  const box = useRef(null);
  const [what, setWhat] = useState("");
  const [every, setEvery] = useState("once");
  const [cat, setCat] = useState("");
  const [desc, setDesc] = useState("");
  const [more, setMore] = useState(false);
  /* The saved date being changed, if one is — its own start, end and name,
     edited in place the way an event is opened in a calendar. */
  const [editing, setEditing] = useState(() => {
    const own = editId ? (plan.dates || []).find((d) => d.id === editId) : null;
    return own ? { id: own.id, what: own.what, on: String(own.on).length > 5 ? own.on : from,
      until: own.until || "", every: own.every || "once", cat: own.cat || "", desc: own.desc || "" } : null;
  });
  const first = from <= to ? from : to;
  const last = from <= to ? to : from;
  const many = dayOf(last) - dayOf(first) + 1;

  /* Where the card sits is taken off the day it belongs to, not worked out
     from a row and a column: the month has five rows or six, the quadrant is
     whatever height the screen gives it, and a card placed by arithmetic ends
     up beside the wrong day on the month that breaks the guess. */
  const [box2, setBox2] = useState(null);
  useEffect(() => {
    const day = document.querySelector(`.rota-day[data-iso="${first}"]`);
    if (!day) return undefined;
    const place = () => {
      const d = day.getBoundingClientRect();
      const WIDE = 300;
      const TALL = 430;
      const room = window.innerHeight - d.bottom;
      const below = room > TALL || d.top < TALL;
      setBox2({
        left: Math.round(Math.max(8, Math.min(d.left + d.width / 2 - WIDE / 2, window.innerWidth - WIDE - 8))),
        top: below ? Math.round(Math.min(d.bottom + 6, window.innerHeight - TALL - 8)) : null,
        bottom: below ? null : Math.round(Math.max(8, window.innerHeight - d.top + 6)),
        width: WIDE,
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [first, at]);

  /* What each day in the stretch is now, and what the rotation would have
     made it — so the card can say "all aboard" or "mixed", and putting the
     stretch back can name what it goes back to. */
  const now = statesAcross(plan, first, last);
  const planned = statesAcross({ ...plan, days: {} }, first, last);
  const same = now.every((st) => st === now[0]) ? now[0] : null;
  const told = now.filter((st, i) => saidOn(plan, isoOf(dayOf(first) + i))).length;

  useEffect(() => {
    const key = (e) => { if (e.key === "Escape") onClose(); };
    /* A press on the calendar is the calendar's to handle — it picks a new day
       or drags out a new stretch — so only a press elsewhere closes this. */
    const away = (e) => {
      if (!box.current?.contains(e.target) && !e.target.closest?.(".rota-grid")) onClose();
    };
    document.addEventListener("keydown", key);
    const t = setTimeout(() => document.addEventListener("mousedown", away), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", away);
    };
  }, [onClose]);

  /* What the line says, read as it is typed: "time off 8 to 13 sep #family"
     brings its own dates and category, and then those win over the days
     picked on the calendar. Without a date in it, it goes on the days
     picked. */
  const said = what.trim() ? parseEvent(what, today) : null;
  const add = (e) => {
    e.preventDefault();
    if (!said) return;
    const on = said.on || first;
    const until = said.on ? said.until : (many > 1 ? last : null);
    onSave(null, {
      what: said.what || what.trim(), on, ...(until ? { until } : {}),
      every: said.every === "year" ? "year" : every,
      ...((said.cat || cat) ? { cat: said.cat || cat } : {}),
      ...(desc.trim() ? { desc: desc.trim() } : {}),
    });
    setWhat(""); setDesc(""); setMore(false);
  };
  const long = (iso) => fmt(iso, { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="rota-card" ref={box} role="dialog"
      style={box2
        ? { left: box2.left, width: box2.width,
            ...(box2.top === null ? { bottom: box2.bottom } : { top: box2.top }) }
        : { visibility: "hidden" }}
      aria-label={many > 1 ? `${long(first)} to ${long(last)}` : long(first)}>
      <header>
        <b>{many > 1 ? `${long(first)} – ${long(last)}` : fmt(first, { weekday: "long", day: "numeric", month: "long" })}</b>
        <button type="button" className="rota-x" onClick={onClose} aria-label="Close">✕</button>
      </header>

      <div className="rota-card-body">
        {/* Start and end, the way an event has them. Dragging across the
            calendar fills these in too; typing is for a stretch that runs
            into next month. */}
        <div className="rota-range">
          <label><span>Starts</span>
            <input type="date" value={first} onChange={(e) => e.target.value && onRange(e.target.value, last < e.target.value ? e.target.value : last)} />
          </label>
          <label><span>Ends</span>
            <input type="date" value={last} min={first} onChange={(e) => e.target.value && onRange(first, e.target.value)} />
          </label>
        </div>
        <p className="rota-card-note">
          {many > 1 ? `${many} days. ` : ""}Tip: drag across the calendar to pick a stretch.
        </p>

        <p className="rota-card-lab">{many > 1 ? "These days" : "This day"}</p>
        <div className="rota-chips">
          {STATES.map((st) => (
            <button type="button" key={st.key}
              className={`rota-chip${same === st.key ? " on" : ""}`}
              style={same === st.key ? { borderColor: col(st.key), color: col(st.key) } : undefined}
              onClick={() => onState(st.key)}>
              <i aria-hidden="true">{st.mark}</i>{st.label}
            </button>
          ))}
        </div>
        {told ? (
          <p className="rota-card-note">
            {many > 1 ? `${told} of ${many} days told, not projected.` : `Told, not projected. The rotation would have this day ${STATE[planned[0]].label.toLowerCase()}.`}
            {" "}
            <button type="button" className="rota-link" onClick={() => onState(null)}>
              Follow the rotation again
            </button>
          </p>
        ) : (
          <p className="rota-card-note">
            From the rotation{same ? "" : " — the stretch is mixed"}. Change it and it stays changed, on {many > 1 ? "these days" : "this day"} only.
          </p>
        )}

        <p className="rota-card-lab">On {many > 1 ? "these days" : "this day"}</p>
        {marks.length > 0 ? (
          <ul className="rota-card-marks">
            {marks.map((mk) => {
              const own = mk.id ? (plan.dates || []).find((d) => d.id === mk.id) : null;
              if (own && editing?.id === own.id) {
                return (
                  <li key={`e-${own.id}`} className="is-editing">
                    <form className="rota-edit" onSubmit={(e) => {
                      e.preventDefault();
                      if (!editing.what.trim()) return;
                      const end = editing.until && editing.until > editing.on ? editing.until : "";
                      onSave(own.id, { ...own, what: editing.what.trim(), on: editing.on, until: end || undefined, every: editing.every,
                        cat: editing.cat || undefined, desc: (editing.desc || "").trim() || undefined });
                      setEditing(null);
                    }}>
                      <input type="text" value={editing.what} aria-label="What"
                        onChange={(e) => setEditing({ ...editing, what: e.target.value })} />
                      <div className="rota-range">
                        <label><span>Starts</span>
                          <input type="date" value={editing.on} onChange={(e) => e.target.value && setEditing({ ...editing, on: e.target.value })} />
                        </label>
                        <label><span>Ends</span>
                          <input type="date" value={editing.until || editing.on} min={editing.on}
                            onChange={(e) => setEditing({ ...editing, until: e.target.value })} />
                        </label>
                      </div>
                      <div className="rota-edit-row">
                        <select value={editing.cat || ""} onChange={(e) => setEditing({ ...editing, cat: e.target.value })} aria-label="Category">
                          <option value="">No category</option>
                          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>
                        <input type="text" value={editing.desc || ""} placeholder="Description"
                          onChange={(e) => setEditing({ ...editing, desc: e.target.value })} />
                      </div>
                      <div className="rota-edit-row">
                        <select data-scale value={editing.every} onChange={(e) => setEditing({ ...editing, every: e.target.value })}
                          aria-label="How often it comes round">
                          <option value="once">Once</option>
                          <option value="year">Every year</option>
                          {own.every === "repeat" && <option value="repeat">{repeatWords(own)}</option>}
                        </select>
                        <button type="button" className="rota-link" onClick={() => { onDrop(own.id); setEditing(null); }}>Delete</button>
                        <button type="button" className="rota-link" onClick={() => setEditing(null)}>Cancel</button>
                        <button type="submit" className="rota-add">Save</button>
                      </div>
                    </form>
                  </li>
                );
              }
              return (
                <li key={`${mk.on}-${mk.what}-${mk.id || mk.sort}`}>
                  <b aria-hidden="true">{GLYPH[mk.sort]}</b>
                  {own ? (
                    <button type="button" className="rota-mark-open" title="Change its start, end or name"
                      onClick={() => setEditing({ id: own.id, what: own.what, on: String(own.on).length > 5 ? own.on : first, until: own.until || "", every: own.every || "once", cat: own.cat || "", desc: own.desc || "" })}>
                      {mk.what}{mk.note && !own.until ? ` · ${mk.note}` : ""}
                      {own.until ? <em> · {long(own.on)} – {long(own.until)}</em> : null}
                    </button>
                  ) : (
                    <span>{mk.what}{mk.note ? ` · ${mk.note}` : ""}</span>
                  )}
                  {own && (
                    <button type="button" className="rota-x" onClick={() => onDrop(own.id)}
                      aria-label={`Remove ${mk.what}`}>✕</button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rota-card-note">Nothing on it yet.</p>
        )}

        {many === 1 && (
          <label className="rota-note-day">
            <span>Note on this day</span>
            <textarea rows={2} defaultValue={(plan.notes || {})[first] || ""} key={first}
              placeholder="Swapped with João · chopper at 06:00…"
              onBlur={(e) => onNote(first, e.target.value)} />
          </label>
        )}

        <form className="rota-card-add" onSubmit={add}>
          <input type="text" value={what}
            placeholder={many > 1 ? "Add an event — or type “Time off 8 to 13 sep”" : "Add an event — try “course 28/9 for 5 days”"}
            onChange={(e) => setWhat(e.target.value)} />
          {said && (said.on || said.cat || said.every === "year") && (
            <p className="rota-parse" aria-live="polite">
              → <b>{said.what || "…"}</b>
              {said.on ? ` · ${long(said.on)}${said.until ? ` – ${long(said.until)}` : ""}` : ""}
              {said.every === "year" ? " · every year" : ""}
              {said.cat ? <em style={{ color: CATEGORY[said.cat].color }}> · {CATEGORY[said.cat].label}</em> : null}
            </p>
          )}
          {more && (
            <div className="rota-more-opts">
              <select data-scale value={every} onChange={(e) => setEvery(e.target.value)} aria-label="How often it comes round">
                <option value="once">Once</option>
                <option value="year">Every year</option>
              </select>
              <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
                <option value="">No category</option>
                {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <input type="text" value={desc} placeholder="Description" onChange={(e) => setDesc(e.target.value)} />
            </div>
          )}
          <div className="rota-add-row">
            <button type="button" className="rota-link" onClick={() => setMore((v) => !v)}>
              {more ? "Fewer options" : "More options"}
            </button>
            <button type="submit" className="rota-add" disabled={!what.trim()}>Add</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Rotation() {
  const [plan, setPlan] = useState(BLANK_PLAN);
  /* The stretch whose card is open: a start and an end, the same day for a
     click and two different ones for a drag. `dragging` holds the card back
     until the button comes up, so it does not jump about under the pointer. */
  const [pick, setPick] = useState(null);
  /* An event opened by clicking its bar, and where the bar was on screen. */
  const [ev, setEv] = useState(null);
  const [help, setHelp] = useState(false);
  /* What the calendar quadrant shows: the grid, the agenda (a list of what is
     coming), or five years at a glance. The other three quadrants follow the
     month or the year as before. */
  const [view, setView] = useState("grid");
  /* The fourth quadrant: the year (or the claim), or what the days pay. Tabs,
     so the board stays two by two however much it carries. */
  const [q4, setQ4] = useState("year");
  const [feed, setFeed] = useState("");
  /* A QR code on screen: what it is for, and the address in it. */
  const [qr, setQr] = useState(null);
  /* Which sheet goes to the printer: the turns, or the whole year on one page. */
  const [paper, setPaper] = useState(() => (new URLSearchParams(location.search).get("paper") === "year" ? "year" : "turns"));
  /* Which header menu is open: print, share or google. */
  const [menu, setMenu] = useState("");
  /* Where the button that opened it is, so the menu opens under it. */
  const [menuAt, setMenuAt] = useState(0);
  const openMenu = (which) => (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenuAt(Math.max(8, window.innerWidth - r.right));
    setMenu((v) => (v === which ? "" : which));
  };
  const printAs = (which) => { setPaper(which); setTimeout(() => window.print(), 80); };
  useEffect(() => {
    if (!menu) return undefined;
    const away = (e) => { if (!e.target.closest?.(".rota-printmenu, .rota-head")) setMenu(""); };
    const key = (e) => { if (e.key === "Escape") setMenu(""); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); };
  }, [menu]);
  /* Calendars he keeps in Google (or Outlook, or iCloud), shown here. */
  const [importing, setImporting] = useState(false);
  /* The holiday suggestion, open: a list to say yes or no to. */
  const [pickHols, setPickHols] = useState(false);
  const [clearing, setClearing] = useState(false);
  const fileBox = useRef(null);
  const [linkedState, setLinkedState] = useState({});
  const [linkedTick, setLinkedTick] = useState(0);
  /* A change waiting on "only this one / following / all". */
  const [ask, setAsk] = useState(null);
  const [going, setGoing] = useState(false);
  const lo = pick ? (pick.from <= pick.to ? pick.from : pick.to) : "";
  const hi = pick ? (pick.from <= pick.to ? pick.to : pick.from) : "";
  const inPick = (iso) => Boolean(pick) && iso >= lo && iso <= hi;
  useEffect(() => {
    if (!pick?.dragging) return undefined;
    const up = () => setPick((p) => (p ? { ...p, dragging: false } : p));
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [pick?.dragging]);
  const [certs, setCerts] = useState([]);
  const [rows, setRows] = useState({ plan: "", certs: "", at: "" });
  /* The plan as the account last had it — what the page and the phone are
     each measured against when both have changed it. */
  const base = useRef(null);
  /* A plan opened from someone's link is theirs, and is never saved over the
     account behind anybody's back. */
  const fromLink = useRef(false);
  /* The two-way calendar's sign-in, fetched when asked for. */
  const [dav, setDav] = useState(null);
  const [said, setSaid] = useState(null);
  const [busy, setBusy] = useState("");

  const now = today();
  const [scope, setScope] = useState("month");
  const [basis, setBasis] = useState("day");
  const [flights, setFlights] = useState(true);
  const [at, setAt] = useState(() => ({ y: +now.slice(0, 4), m: +now.slice(5, 7) - 1 }));
  const [sea, setSea] = useState({ how: "asking", module: null });
  const planBox = useRef(null);
  const seg = useRef(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  /* The vault is read here and not at the top of the file: nothing may touch
     it before the account is known, or one person's rotation opens under
     another's name. */
  useEffect(() => {
    (async () => { try {
      const shared = readHash() || await readSqueezed();
      if (shared?.pattern) {
        fromLink.current = true;
        setPlan(pruneTrash({ ...BLANK_PLAN, ...shared }));
        setSaid({ kind: "ok", text: "Opened from a link. Nothing of yours has been touched — open the plan and save it to keep this one." });
        return;
      }
      const mine = readMine(KEY);
      if (mine) setPlan(pruneTrash({ ...BLANK_PLAN, ...JSON.parse(mine) }));
      const held = readMine(CERTS);
      if (held) setCerts(JSON.parse(held));
    } catch { /* a plan that will not parse is no plan */ } })();
  }, []);

  /* And then the account, which wins — the browser's copy is what keeps the
     page working on a ship with no signal, not the truth. A plan opened from a
     link is nobody's account, and is left alone. */
  useEffect(() => {
    if (!available() || readHash()) return;
    let alive = true;
    (async () => {
      try {
        const [plans, tickets] = await Promise.all([
          listDocuments("rotation").catch(() => []),
          listDocuments("certificates").catch(() => []),
        ]);
        if (!alive) return;
        if (plans[0]?.id) {
          const got = await loadDocument(plans[0].id);
          if (alive && got?.data && !fromLink.current) {
            base.current = { ...BLANK_PLAN, ...got.data };
            setPlan(base.current);
            setRows((r) => ({ ...r, plan: plans[0].id, at: got.updated_at }));
          }
        }
        if (tickets[0]?.id) {
          const got = await loadDocument(tickets[0].id);
          if (alive && got?.data?.certificates) { setCerts(got.data.certificates); setRows((r) => ({ ...r, certs: tickets[0].id })); }
        }
      } catch { /* not signed in, or no signal: the local copy stands */ }
    })();
    return () => { alive = false; };
  }, []);

  /* The tax module, once, and only when the switch is thrown. */
  useEffect(() => {
    if (basis !== "uk" || sea.how !== "asking") return undefined;
    const load = Object.values(SEATAX)[0];
    if (!load) { setSea({ how: "absent", module: null }); return undefined; }
    let alive = true;
    load()
      .then((module) => { if (alive) setSea({ how: "ready", module }); })
      .catch(() => { if (alive) setSea({ how: "absent", module: null }); });
    return () => { alive = false; };
  }, [basis, sea.how]);

  const change = useCallback((next) => {
    setPlan(next);
    try { writeMine(KEY, JSON.stringify(next)); } catch { /* nothing to be done */ }
  }, []);
  /* A change that can be taken back: it is made at once, and the toast that
     says what happened carries the plan as it was just before, for Undo. */
  const act = useCallback((next, text) => {
    setSaid({ kind: "ok", text, undo: plan, at: Date.now() });
    change(next);
  }, [plan, change]);
  /* A change to an event: straight through for a one-off, and by way of the
     scope question for one that comes round every year. */
  const occurrence = (item, change, text) => {
    const d = (plan.dates || []).find((x) => x.id === item.id);
    if (d?.every === "year" || d?.every === "repeat") { setAsk({ item, change, text }); return; }
    act(changeOccurrence(plan, item, "all", change, `d${Date.now().toString(36)}`, now), text);
  };
  const undo = () => {
    if (!said?.undo) return;
    change(said.undo);
    setSaid({ kind: "ok", text: "Undone.", at: Date.now() });
  };
  /* Toasts go away on their own, as a calendar's do; an error stays until it
     is read and dismissed. */
  useEffect(() => {
    if (!said || said.kind === "bad") return undefined;
    const t = setTimeout(() => setSaid((cur) => (cur === said ? null : cur)), said.undo ? 8000 : 5000);
    return () => clearTimeout(t);
  }, [said]);

  const { y, m } = at;
  const pattern = useMemo(() => patternOf(plan), [plan]);
  const cycle = useMemo(() => cycleOf(plan), [plan]);
  const setPattern = (patch) => change({ ...plan, pattern: { ...pattern, ...patch } });

  /* Every date worth seeing, a little either side of the year on screen, so
     that the lead and tail days of a January or a December carry theirs. */
  const marks = useMemo(
    () => marksOf(plan, `${y - 1}-11-01`, `${y + 1}-02-01`, { certificates: certs }),
    [plan, certs, y],
  );
  const byDay = useMemo(() => {
    const map = new Map();
    for (const mark of marks) map.set(mark.on, [...(map.get(mark.on) || []), mark]);
    return map;
  }, [marks]);

  const yearStates = useMemo(() => statesAcross(plan, `${y}-01-01`, `${y}-12-31`), [plan, y]);
  const months = useMemo(
    () => MONTHS.map((_, i) => monthTally(plan, y, i, { flights })),
    [plan, y, flights],
  );
  const year = useMemo(() => yearTally(plan, y, { flights }), [plan, y, flights]);
  const before = useMemo(() => yearTally(plan, y - 1, { flights }), [plan, y, flights]);
  const count = scope === "month" ? months[m] : year;
  /* Against last month (or last year): a number with its change beside it,
     the way a time-insights panel reads. */
  const lastCount = useMemo(() => (scope === "month"
    ? monthTally(plan, m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, { flights })
    : yearTally(plan, y - 1, { flights })), [plan, y, m, scope, flights]);
  const delta = (k) => {
    const d = count[k] - lastCount[k];
    if (!d) return null;
    return <i className={`rota-delta ${d > 0 ? "is-up" : "is-down"}`} title={`${d > 0 ? "+" : ""}${d} on ${scope === "month" ? "last month" : "last year"}`}>{d > 0 ? "▲" : "▼"}{Math.abs(d)}</i>;
  };
  const payWindow = scope === "month"
    ? [isoOf(monthStart(y, m)), isoOf(monthStart(y, m) + monthLength(y, m) - 1)]
    : [`${y}-01-01`, `${y}-12-31`];
  const payMonth = useMemo(() => payOf(plan, payWindow[0], payWindow[1], { flights }), [plan, payWindow[0], payWindow[1], flights]);
  const payYear = useMemo(() => payOf(plan, `${y}-01-01`, `${y}-12-31`, { flights }), [plan, y, flights]);
  const paySoFar = useMemo(() => (now.slice(0, 4) === String(y) ? payOf(plan, `${y}-01-01`, now, { flights }) : null), [plan, y, now, flights]);

  /* The year so far, which is the number that matters in the year he is in and
     is the whole year in any other. */
  const awaySoFar = useMemo(() => {
    const thisYear = +now.slice(0, 4);
    if (y > thisYear) return 0;
    return tally(plan, `${y}-01-01`, y < thisYear ? `${y}-12-31` : now, { flights }).abroad;
  }, [plan, y, flights, now]);

  /* The month's grid, whole weeks, with the days either side of it dimmed. */
  const grid = useMemo(() => {
    const first = monthStart(y, m);
    const lead = weekday(first);
    const length = monthLength(y, m);
    const from = first - lead;
    const tail = (7 - ((lead + length) % 7)) % 7;
    const each = statesAcross(plan, isoOf(from), isoOf(first + length - 1 + tail));
    return each.map((state, i) => {
      const day = from + i;
      const iso = isoOf(day);
      return {
        day, iso, state,
        number: new Date(day * 864e5).getUTCDate(),
        dim: day < first || day >= first + length,
        marks: byDay.get(iso) || [],
      };
    });
  }, [plan, y, m, byDay]);

  /* Every event on the month as one bar per week it crosses, the way a
     calendar draws them — laid out in the engine, where it is measured. */
  const weeks = grid.length / 7;
  /* Each linked calendar fetched through the site (only with his session),
     read, and kept here for the session — fetched again on every visit, so
     what he changes in Google is what he sees here. */
  useEffect(() => {
    let alive = true;
    for (const cal of plan.linked || []) {
      setLinkedState((st) => ({ ...st, [cal.id]: { ...(st[cal.id] || {}), busy: true } }));
      fetch(`/api/documents?t=cal&u=${encodeURIComponent(cal.url)}`, { credentials: "same-origin" })
        .then(async (r) => {
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
          const text = await r.text();
          const events = readIcs(text, { from: isoOf(dayOf(now) - 800), to: isoOf(dayOf(now) + 1200) });
          if (alive) setLinkedState((st) => ({ ...st, [cal.id]: { events, at: new Date().toISOString(), busy: false } }));
        })
        .catch((e) => alive && setLinkedState((st) => ({ ...st, [cal.id]: { ...(st[cal.id] || {}), error: String(e.message || e), busy: false } })));
    }
    return () => { alive = false; };
  }, [JSON.stringify((plan.linked || []).map((c) => c.url)), linkedTick]);
  /* The linked events that touch a window, as calendar items: read-only,
     in the colour of their calendar, and named by it. */
  const linkedIn = useCallback((fromIso, toIso) => {
    const a = dayOf(fromIso);
    const b = dayOf(toIso);
    const hidden = new Set(plan.hidden || []);
    const out = [];
    for (const cal of plan.linked || []) {
      if (hidden.has(`g:${cal.id}`)) continue;
      for (const e of linkedState[cal.id]?.events || []) {
        const span = e.until ? dayOf(e.until) - dayOf(e.on) : 0;
        const starts = e.every === "year"
          ? Array.from({ length: +toIso.slice(0, 4) - +fromIso.slice(0, 4) + 2 }, (u, k) => `${+fromIso.slice(0, 4) - 1 + k}${e.on.slice(4)}`)
          : [e.on];
        for (const st of starts) {
          if (dayOf(st) + span < a || dayOf(st) > b) continue;
          out.push({ key: `g:${cal.id}:${e.uid}:${st}`, sort: "linked", what: e.what, from: st, to: isoOf(dayOf(st) + span),
            desc: e.desc, color: cal.color, source: cal.name });
        }
      }
    }
    return out;
  }, [plan.linked, plan.hidden, linkedState]);

  /* An .ics file taken in once: its events become his own, filed under
     "Other", and a second import of the same file adds nothing twice. */
  const importFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const got = readIcs(await file.text());
      const have = new Set((plan.dates || []).map((d) => `${d.uid || ""}|${d.on}`));
      const fresh = got.filter((g) => !have.has(`${g.uid}|${g.on}`)).map((g, k) => ({
        id: `i${Date.now().toString(36)}${k}`, what: g.what, on: g.on, ...(g.until ? { until: g.until } : {}),
        every: g.every, cat: "other", ...(g.desc ? { desc: g.desc } : {}), uid: g.uid,
      }));
      if (!fresh.length) { setSaid({ kind: "ok", text: `Nothing new in ${file.name}.` }); return; }
      act({ ...plan, dates: [...(plan.dates || []), ...fresh] }, `${plural(fresh.length, "event", "events")} imported from ${file.name}.`);
    } catch {
      setSaid({ kind: "bad", text: `${file.name} could not be read as a calendar.` });
    }
  };

  /* A bar being dragged: which event, which part of it (the whole of it, or
     one end), the day it was picked up on and the day it is over now. The
     bars are laid out again from this on every move, so what is under the
     pointer is the event as it will be — nothing is saved until it is let go. */
  const [drag, setDrag] = useState(null);
  const bars = useMemo(() => {
    if (!grid.length) return [];
    const hidden = new Set(plan.hidden || []);
    let items = [...eventsIn(plan, grid[0].iso, grid[grid.length - 1].iso, { certificates: certs }), ...linkedIn(grid[0].iso, grid[grid.length - 1].iso)]
      .filter((it) => !hidden.has(it.sort === "family" ? (it.cat || "none") : it.sort));
    if (drag && drag.over !== drag.at) {
      const moved = draggedTo(drag);
      items = items.map((it) => (it.key === drag.item.key ? { ...it, ...moved, moving: true } : it));
    }
    return barsOf(items, grid[0].iso, weeks);
  }, [plan, certs, grid, weeks, drag, linkedIn]);
  /* The day under a point on screen, measured by position rather than by what
     is under the pointer: a point in the 4px gap between days is over no day. */
  const dayAt = (x, y) => {
    let best = null;
    let far = Infinity;
    for (const el of gridBox.current?.querySelectorAll(".rota-day") || []) {
      const r = el.getBoundingClientRect();
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const d = dx * dx + dy * dy;
      if (d < far) { far = d; best = el; }
    }
    return best?.dataset.iso || null;
  };
  useEffect(() => {
    if (!drag) return undefined;
    const move = (e) => {
      const iso = dayAt(e.clientX, e.clientY);
      if (iso && iso !== drag.over) setDrag((d) => (d ? { ...d, over: iso } : d));
    };
    const up = (e) => {
      setDrag(null);
      /* Where it was let go, read off the release itself: a quick hand lets go
         before the last move has been drawn, and the event then landed a day
         short of where the pointer was. */
      const last = dayAt(e.clientX, e.clientY);
      if (last) drag.over = last;
      if (drag.over === drag.at) {
        /* Not moved: it was a click, and a click opens the event. */
        setPick(null);
        setEv({ item: drag.item, rect: drag.rect });
        return;
      }
      const { from, to } = draggedTo(drag);
      setPick(null);
      const text = `${drag.item.what}: ${fmt(from, { day: "numeric", month: "short" })}${from !== to ? ` – ${fmt(to, { day: "numeric", month: "short" })}` : ""}.`;
      if (drag.item.sort === "family") occurrence(drag.item, { kind: "move", from, to }, text);
      else act(moveEvent(plan, drag.item, from, to), text);
    };
    const cancel = (e) => { if (e.key === "Escape") setDrag(null); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", cancel);
    };
  }, [drag, plan, act]);
  /* How many bars a day has room for, measured off the day itself: the
     quadrant is whatever height the screen gives it, and a bar drawn into a
     day with no room for it would cover the next week's date. What does not
     fit is counted on the day instead ("+2"), never hidden without a word. */
  const gridBox = useRef(null);
  const [lanes, setLanes] = useState(2);
  useEffect(() => {
    const el = gridBox.current;
    if (!el) return undefined;
    const look = () => {
      const day = el.querySelector(".rota-day");
      if (!day) return;
      const h = day.getBoundingClientRect().height;
      setLanes(Math.max(1, Math.floor((h - BAR_TOP - 2) / BAR_STEP)));
    };
    look();
    const watch = new ResizeObserver(look);
    watch.observe(el);
    return () => watch.disconnect();
  }, [scope]);
  const shownBars = bars.filter((b) => b.lane < lanes);
  const hiddenOn = useMemo(() => {
    const n = new Map();
    for (const b of bars) {
      if (b.lane < lanes) continue;
      for (let c = b.c0; c <= b.c1; c += 1) {
        const iso = grid[b.row * 7 + c]?.iso;
        if (iso) n.set(iso, (n.get(iso) || 0) + 1);
      }
    }
    return n;
  }, [bars, lanes, grid]);

  /* The agenda is paged by what fits, never scrolled and never cut: each
     page is as many rows as the quadrant has height for, measured. */
  const agendaBox = useRef(null);
  const [perPage, setPerPage] = useState(8);
  const [page, setPage] = useState(0);
  /* Start from a page too long to fit, then take rows off until the list is
     no taller than its box — measured after drawing, because the month
     headings make every page a different height and no estimate is right. */
  useEffect(() => {
    const el = agendaBox.current;
    if (!el) return undefined;
    const reset = () => setPerPage(24);
    const watch = new ResizeObserver(reset);
    watch.observe(el);
    return () => watch.disconnect();
  }, [view]);
  useLayoutEffect(() => {
    const list = agendaBox.current?.querySelector(".rota-agenda");
    if (list && perPage > 2 && list.scrollHeight > list.clientHeight + 1) setPerPage((n) => n - 1);
  });
  /* The stretches of a month, paged by what fits, measured the same way as
     the agenda: a month with six stretches has more than a quarter of the
     screen can hold, and a list cut at the panel's edge says nothing. */
  const runsBox = useRef(null);
  const [runsPer, setRunsPer] = useState(12);
  const [runsPage, setRunsPage] = useState(0);
  useEffect(() => {
    const el = runsBox.current;
    if (!el) return undefined;
    const watch = new ResizeObserver(() => { setRunsPer(12); });
    watch.observe(el);
    return () => watch.disconnect();
  }, [scope]);
  useEffect(() => { setRunsPage(0); setRunsPer(12); }, [y, m, plan]);
  useLayoutEffect(() => {
    const el = runsBox.current;
    if (el && scope === "month" && runsPer > 1 && el.scrollHeight > el.clientHeight + 1) setRunsPer((n) => n - 1);
  });
  const agenda = useMemo(() => (view === "agenda"
    ? [...agendaOf(plan, now, 180, { certificates: certs }), ...linkedIn(now, isoOf(dayOf(now) + 179)).filter((e) => e.to >= now)]
      .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
    : []), [view, plan, now, certs, linkedIn]);
  const years = useMemo(() => (view === "years" ? yearsOf(plan, y, 5, { flights }) : []), [view, plan, y, flights]);
  /* The first person in "other rotations", and the next stretch you are both home. */
  const together = useMemo(() => {
    const o = (plan.others || [])[0];
    if (!o) return null;
    const both = bothHome(plan, o, now);
    return both ? { who: o.who || "They", ...both } : null;
  }, [plan, now]);
  const shifts = useMemo(() => (grid.length ? shiftsAcross(plan, grid[0].iso, grid[grid.length - 1].iso) : []), [plan, grid]);
  const theirs = useMemo(() => {
    const o = (plan.others || [])[0];
    return o && grid.length ? statesAcross(planOf(o), grid[0].iso, grid[grid.length - 1].iso) : null;
  }, [plan, grid]);
  const runs = useMemo(
    () => runsIn(plan, isoOf(monthStart(y, m)), isoOf(monthStart(y, m) + monthLength(y, m) - 1)),
    [plan, y, m],
  );

  const turns = useMemo(() => {
    const drawn = turnsFrom(plan, now);
    const first = drawn[0]?.aboard.from;
    const last = drawn[drawn.length - 1]?.home.to;
    if (!first) return [];
    return landing(drawn, marksOf(plan, first, last, { certificates: certs }));
  }, [plan, certs, now]);
  const soon = useMemo(() => nextChange(turns, now), [turns, now]);
  /* The same number on the app's icon, where the phone allows it — an
     installed copy shows it without being opened. */
  useEffect(() => {
    try {
      if (soon && navigator.setAppBadge) navigator.setAppBadge(soon.inDays).catch(() => {});
    } catch { /* no badge on this device */ }
  }, [soon]);
  /* How many turns a printed page carries. Settled by running the printed
     bench — a sheet that grows past the page spills a blank one, and that is
     what fails. */
  const sheets = useMemo(() => sheetsOf(turns, 10), [turns]);
  const everyMark = useMemo(
    () => turns.flatMap((t) => [...t.aboard.marks, ...t.home.marks]),
    [turns],
  );

  const ledger = useMemo(() => {
    if (basis !== "uk" || sea.how !== "ready" || typeof sea.module?.runLedger !== "function") return null;
    /* Six years back is further than any claim period runs, and the ledger
       itself decides where the claim actually starts. Nothing beyond today is
       fed in: a margin is a fact about days already spent, and projecting it
       forward would flatter it into a number he could act on. */
    const from = isoOf(dayOf(now) - 6 * 366);
    try {
      const absences = absencesFor(plan, from, now);
      return {
        from,
        absences: absences.length,
        run: sea.module.runLedger(absences),
        /* The ledger's own figures stop at his last landing. Where he stands
           *today* is a different question and the module has an answer for it,
           so the panel asks that one. */
        stand: typeof sea.module.standing === "function" ? sea.module.standing(absences, now) : null,
        leave: typeof sea.module.mustLeaveBy === "function" ? sea.module.mustLeaveBy(absences) : null,
        /* In half-days, the same unit as the margin: what it costs to get a
           margin that has gone under back to nought. */
        recover: typeof sea.module.stayOutFor === "function" ? sea.module.stayOutFor(absences, 0) : null,
      };
    } catch (e) {
      return { broken: e.message || "the figures would not add up" };
    }
  }, [basis, sea, plan, now]);

  const step = useCallback((by) => setAt((was) => {
    if (scope === "year") return { ...was, y: was.y + by };
    const n = was.m + by;
    return { y: was.y + Math.floor(n / 12), m: ((n % 12) + 12) % 12 };
  }), [scope]);
  const backToToday = useCallback(
    () => setAt({ y: +now.slice(0, 4), m: +now.slice(5, 7) - 1 }),
    [now],
  );

  const getFeed = async (stop) => {
    setBusy("feed");
    try {
      const res = await fetch("/api/documents?t=feed", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: rows.plan, stop }),
      });
      const got = await res.json();
      if (!res.ok) throw new Error(got.error || res.status);
      setFeed(got.url);
      setSaid({ kind: "ok", text: stop ? "The old address is switched off. This is the new one." : "Your calendar address is ready." });
    } catch (e) {
      setSaid({ kind: "bad", text: `No calendar address: ${e.message}` });
    } finally {
      setBusy("");
    }
  };
  const keep = async ({ quiet = false } = {}) => {
    if (!quiet) setBusy("saving");
    try {
      /* Saved over the copy it was read from. If the account was written in
         the meantime — an event made on the phone — the two are put
         together and saved again, never one written over the other. */
      let mine = plan;
      let at = rows.at;
      let one = null;
      for (let tries = 0; tries < 3 && !one; tries += 1) {
        const got = await savePlan({
          id: rows.plan || undefined, kind: "rotation", preset: "rotation",
          crew: mine.who || "", vessel: "", data: mine, ...(rows.plan && at ? { base: at } : {}),
        });
        if (got.conflict) {
          mine = mergePlans(base.current, mine, { ...BLANK_PLAN, ...got.conflict.data });
          base.current = { ...BLANK_PLAN, ...got.conflict.data };
          at = got.conflict.updated_at;
        } else one = got.document;
      }
      if (!one) throw new Error("it kept changing elsewhere — try again");
      base.current = { ...BLANK_PLAN, ...one.data };
      /* The calendar codes are the account's; the page takes them from it. */
      const kept = { ...mine, feed: one.data?.feed, dav: one.data?.dav };
      if (!samePlan(kept, plan)) change(kept);
      /* Only the rotation. The certificates belong to their own page, and a
         save from here would write this page's copy of them over whatever was
         changed there since it was read. */
      setRows({ plan: one?.id || rows.plan, certs: rows.certs, at: one.updated_at });
      if (!quiet) setSaid({ kind: "ok", text: "Kept. It will be here on your phone too." });
    } catch (e) {
      setSaid({ kind: "bad", text: `Not kept: ${e.message}. What is on this device is still here.` });
    }
    if (!quiet) setBusy("");
  };

  /* What the phone changed, brought in: when the page comes back into view,
     and every minute while it is in view. Put together with whatever is not
     saved here yet, so nothing on either side is lost. */
  const pull = useCallback(async () => {
    if (!rows.plan || fromLink.current || document.hidden || !available()) return;
    try {
      const got = await loadDocument(rows.plan);
      if (!got?.data || got.updated_at === rows.at) return;
      const theirs = { ...BLANK_PLAN, ...got.data };
      const was = base.current;
      base.current = theirs;
      setRows((r) => ({ ...r, at: got.updated_at }));
      setPlan((p) => {
        const next = mergePlans(was, p, theirs);
        try { writeMine(KEY, JSON.stringify(next)); } catch { /* nothing to be done */ }
        return next;
      });
    } catch { /* no signal: the next look will do it */ }
  }, [rows.plan, rows.at]);
  useEffect(() => {
    const look = () => { if (!document.hidden) pull(); };
    window.addEventListener("focus", look);
    document.addEventListener("visibilitychange", look);
    const every = setInterval(look, 60_000);
    return () => {
      window.removeEventListener("focus", look);
      document.removeEventListener("visibilitychange", look);
      clearInterval(every);
    };
  }, [pull]);

  /* With the phone connected, a change here goes to it by itself, a moment
     after it is made — a calendar that has to be saved is not in sync. */
  const keepRef = useRef(keep);
  keepRef.current = keep;
  useEffect(() => {
    if (!plan.dav || !rows.plan || fromLink.current || !base.current || samePlan(plan, base.current)) return undefined;
    const soon = setTimeout(() => keepRef.current({ quiet: true }), 1500);
    return () => clearTimeout(soon);
  }, [plan, rows.plan]);

  const openPattern = () => {
    planBox.current?.showModal();
    setTimeout(() => document.getElementById("rota-pattern")?.scrollIntoView({ block: "start" }), 60);
  };

  const getDav = async (stop) => {
    setBusy("dav");
    try {
      const res = await fetch("/api/documents?t=dav", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: rows.plan, stop }),
      });
      const got = await res.json();
      if (!res.ok) throw new Error(got.error || res.status);
      setDav(stop ? null : got);
      await pull();
      setSaid({ kind: "ok", text: stop
        ? "Disconnected. Every iPhone, Mac or Android signed in to it has lost it."
        : plan.dav ? "The sign-in for Android or any CalDAV app is below." : "Connected. Install it on your iPhone or Mac below." });
    } catch (e) {
      setSaid({ kind: "bad", text: `Not connected: ${e.message}` });
    } finally {
      setBusy("");
    }
  };

  /**
   * The pattern worked out from the last four saved trips, fetched only when
   * pressed, not on every page load. Nothing is saved: the fields are filled.
   */
  const fromTrips = async () => {
    setBusy("reading");
    try {
      const list = (await listDocuments("trip")).slice(0, 4);
      const full = await Promise.all(list.map((d) => loadDocument(d.id).catch(() => null)));
      const trips = full
        .map((d) => ({ start: d?.data?.doc?.start || d?.data?.start, end: d?.data?.doc?.end || d?.data?.end }))
        .filter((t) => t.start && t.end);
      const guess = guessPattern(trips);
      if (guess.from < 2) {
        setSaid({ kind: "bad", text: "Two saved trips are the least it takes to see a pattern." });
      } else {
        change({ ...plan, pattern: { ...pattern, on: guess.on, off: guess.off }, anchor: guess.anchor });
        setSaid({
          kind: "ok",
          text: `From your last ${guess.from} trips — ${guess.on} on, ${guess.off} off, next out ${withYear(guess.anchor)}. Change anything.`,
        });
      }
    } catch (e) {
      setSaid({ kind: "bad", text: `Could not read them: ${e.message}` });
    }
    setBusy("");
  };

  const shareIt = async () => {
    const url = location.origin + location.pathname + await squeeze(sharedOf(plan));
    history.replaceState(null, "", url);
    try {
      if (navigator.share) {
        await navigator.share({ title: `Rotation — ${plan.who || "the turns ahead"}`, url });
        setSaid({ kind: "ok", text: "Shared. The whole plan travels inside the link — nothing was uploaded and no page was published." });
        return;
      }
      await navigator.clipboard.writeText(url);
      setSaid({ kind: "ok", text: "Link copied. The whole plan is inside it — nothing was uploaded." });
    } catch {
      setSaid({ kind: "ok", text: "The link is in the address bar, with the whole plan inside it." });
    }
  };

  const exportIt = () => {
    const head = ["Month", ...STATES.map((s) => s.label), "Out of the country", "In the country", "Days"];
    const line = (name, t) => [name, ...STATES.map((s) => t[s.key]), t.abroad, t.inCountry, t.days];
    const body = [head, ...MONTHS.map((name, i) => line(name, months[i])), line(String(y), year)];
    const csv = body.map((r) => r.join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = `rotation-${y}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 8000);
    setSaid({ kind: "ok", text: `rotation-${y}.csv saved — the twelve months and the year, counted the way the page counts them.` });
  };

  const addDate = () => change({
    ...plan,
    dates: [...(plan.dates || []), { id: `d${Date.now()}`, what: "", on: now, every: "year" }],
  });
  const editDate = (id, patch) => change({
    ...plan, dates: plan.dates.map((d) => (d.id === id ? { ...d, ...patch } : d)),
  });
  /* Deleting a date from the plan goes the same way as from the calendar:
     into the bin, with Undo. */
  const binDate = (id) => act(dropDate(plan, id, now), `Deleted “${(plan.dates || []).find((d) => d.id === id)?.what || "date"}”.`);


  const slip = (n, patch) => {
    const slips = { ...(plan.slips || {}) };
    const one = { ...(slips[String(n)] || {}), ...patch };
    if (!one.from && !one.to) delete slips[String(n)];
    else slips[String(n)] = one;
    change({ ...plan, slips });
  };
  const putBack = (n) => {
    const slips = { ...(plan.slips || {}) };
    delete slips[String(n)];
    change({ ...plan, slips });
  };

  /* The indicator under the segmented control follows the button that is on,
     measured rather than guessed: "Month" and "Year" are not the same width,
     and a bar that assumed they were slid to the wrong place. */
  useEffect(() => {
    const move = () => {
      const on = seg.current?.querySelector('[aria-pressed="true"]');
      if (on) setIndicator({ left: on.offsetLeft, width: on.offsetWidth });
    };
    move();
    window.addEventListener("resize", move);
    return () => window.removeEventListener("resize", move);
  }, [scope]);

  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || planBox.current?.open) return;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        /* Ctrl/⌘+Z takes back the last change, while its toast is still up. */
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && said?.undo) { e.preventDefault(); undo(); }
        return;
      }
      const key = e.key.toLowerCase();
      if (e.key === "ArrowLeft" || key === "p" || key === "k") step(-1);
      else if (e.key === "ArrowRight" || key === "n" || key === "j") step(1);
      else if (key === "m") setScope("month");
      else if (key === "y") setScope("year");
      else if (key === "a") setView((v) => (v === "agenda" ? "grid" : "agenda"));
      else if (key === "t") backToToday();
      /* The Google Calendar keys: C creates on today, G goes to a date, ?
         lists them all. */
      else if (key === "c") { e.preventDefault(); backToToday(); setScope("month"); setPick({ from: now, to: now, dragging: false }); }
      else if (key === "g") { e.preventDefault(); setGoing(true); }
      else if (e.key === "?") setHelp(true);
      else if (e.key === "Escape") { setHelp(false); setGoing(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, backToToday, said, now]);

  const period = scope === "month" ? `${MONTHS[m]} ${y}` : String(y);
  const openMonth = (i) => { setAt({ y, m: i }); setScope("month"); };

  const bar = (t, height) => (
    <div className="rota-stack" style={{ height: `${height}px` }}>
      {STATES.filter((s) => t[s.key] > 0).map((s) => (
        <i key={s.key} style={{ flex: t[s.key], background: col(s.key) }}
          title={`${plural(t[s.key], "day", "days")} ${s.label.toLowerCase()}`} />
      ))}
    </div>
  );

  return (
    <main className="rota">
      <header className="rota-head">
        <div className="rota-seg" ref={seg} role="group" aria-label="How much to show">
          <i className="rota-ind" style={{ left: `${indicator.left}px`, width: `${indicator.width}px` }} />
          <button type="button" aria-pressed={scope === "month"} onClick={() => setScope("month")}>
            <i aria-hidden="true">▦</i>Month
          </button>
          <button type="button" aria-pressed={scope === "year"} onClick={() => setScope("year")}>
            <i aria-hidden="true">▤</i>Year
          </button>
        </div>

        <div className="rota-seg is-plain" role="group" aria-label="How you are paid">
          <button type="button" aria-pressed={basis === "day"} onClick={() => setBasis("day")}
            title="Days out of the country, against the 183-day mark">
            <i aria-hidden="true">📅</i>Day rate
          </button>
          <button type="button" aria-pressed={basis === "uk"} onClick={() => setBasis("uk")}
            title="Seafarers' Earnings Deduction: the claim period, and the margin left in it">
            <i aria-hidden="true">🇬🇧</i>UK salaried
          </button>
        </div>

        <div className="rota-step">
          <button type="button" onClick={() => step(-1)} title="Back" aria-label="Back">‹</button>
          <button type="button" className="rota-now" onClick={backToToday}>Today</button>
          <button type="button" onClick={() => step(1)} title="Forward" aria-label="Forward">›</button>
        </div>

        {/* The number a rotation worker looks at first: how long until the next
            crew change. */}
        {soon && (
          <div className={`rota-count is-${soon.kind === "fly home" ? "home" : "out"}`}
            title={`${soon.kind === "fly home" ? "Home" : "Back out"} on ${fmt(soon.on, { weekday: "long", day: "numeric", month: "long" })}`}>
            <b>{soon.inDays === 0 ? "Today" : soon.inDays}</b>
            <span>{soon.inDays === 0 ? "" : soon.inDays === 1 ? "day" : "days"}<em>{soon.kind === "fly home" ? (soon.inDays === 0 ? "🏠 you go home" : "🏠 till home") : (soon.inDays === 0 ? "✈️ you fly out" : "✈️ till you go")}</em></span>
          </div>
        )}

        {/* The toolbar never goes to a second line: a wrapped header costs the
            board forty-odd pixels, which is a row of figures in every panel. */}
        <div className="rota-grow" />

        {/* Every button says what it does in words. Six, three of them menus,
            because more named buttons do not fit on one line of a laptop. */}
        <button className="rota-btn" type="button" onClick={() => setFlights((v) => !v)}
          aria-pressed={flights} title="Whether a day spent in the air counts as a day out of the country">
          <i aria-hidden="true">⚖️</i><b><span className="is-long">{flights ? "Flights count" : "Flights don't"}</span><span className="is-short">{flights ? "Flights ✓" : "Flights ✗"}</span></b>
        </button>
        <button className="rota-btn" type="button" onClick={() => planBox.current?.showModal()}
          title="The pattern, pay, certificates, reminders and the turns that moved">
          <i aria-hidden="true">✎</i><b>Plan</b>
        </button>
        <button className="rota-btn" type="button" onClick={openMenu("import")}
          aria-expanded={menu === "import"} title="Bring in your Google, Outlook or Apple calendar">
          <i aria-hidden="true">📥</i><b>Import</b><i className="rota-caret" aria-hidden="true">▾</i>
        </button>
        <button className="rota-btn" type="button" onClick={openMenu("print")}
          aria-expanded={menu === "print"} title="Print, save as PDF, or export a spreadsheet">
          <i aria-hidden="true">🖨</i><b>Print</b><i className="rota-caret" aria-hidden="true">▾</i>
        </button>
        <button className="rota-btn is-key" type="button" onClick={openMenu("share")}
          aria-expanded={menu === "share"} title="A link or a QR code of your rotation">
          <i aria-hidden="true">🔗</i><b>Share</b><i className="rota-caret" aria-hidden="true">▾</i>
        </button>
        <button className="rota-btn" type="button" onClick={() => setHelp(true)} title="Keyboard shortcuts (?)">
          <i aria-hidden="true">⌨</i><b><span className="is-long">Shortcuts</span><span className="is-short">Keys</span></b>
        </button>
      </header>

      {menu && (
        <div className={`rota-printmenu is-${menu}`} role="menu" style={{ right: menuAt }}>
          {menu === "print" && <>
            <button type="button" role="menuitem" onClick={() => { setMenu(""); printAs("year"); }}>
              <b>🗓 The year on one page</b><span>{y}, all twelve months — print it or save as PDF</span></button>
            <button type="button" role="menuitem" onClick={() => { setMenu(""); printAs("turns"); }}>
              <b>🧭 The turns</b><span>each hitch with its dates and what falls in it</span></button>
            <button type="button" role="menuitem" onClick={() => { setMenu(""); exportIt(); }}>
              <b>⤓ Spreadsheet</b><span>the twelve months and the year, to open in Excel</span></button>
          </>}
          {menu === "share" && <>
            <button type="button" role="menuitem" onClick={() => { setMenu(""); shareIt(); }}>
              <b>🔗 Copy a link</b><span>your rotation and its dates — nothing else goes with it</span></button>
            <button type="button" role="menuitem" onClick={async () => { setMenu(""); setQr({ what: "rotation", url: location.origin + location.pathname + await squeeze(sharedOf(plan)) }); }}>
              <b>▣ QR code</b><span>for a phone to scan and open it</span></button>
            <button type="button" role="menuitem" onClick={() => { setMenu(""); planBox.current?.showModal(); setTimeout(() => document.getElementById("rota-feed")?.scrollIntoView({ block: "start" }), 60); }}>
              <b>📤 Into Google, Outlook or Apple</b><span>your rotation in your phone's calendar, with reminders</span></button>
            {DAV_READY && <button type="button" role="menuitem" onClick={() => { setMenu(""); planBox.current?.showModal(); setTimeout(() => document.getElementById("rota-dav")?.scrollIntoView({ block: "start" }), 60); }}>
              <b>🔄 iPhone or Mac, both ways</b><span>events you change on either side show on the other</span></button>}
          </>}
          {menu === "import" && <>
            {[["google", "Google Calendar", "your Google events, kept in sync"],
              ["outlook", "Outlook", "Outlook.com or Microsoft 365, kept in sync"],
              ["apple", "Apple Calendar", "an iCloud calendar, kept in sync"]].map(([k, name, what]) => (
              <button type="button" role="menuitem" key={k} onClick={() => { setMenu(""); setImporting(k); }}>
                <b>{PROVIDERS[k].mark} {name}</b><span>{what}</span></button>
            ))}
            <button type="button" role="menuitem" onClick={() => { setMenu(""); fileBox.current?.click(); }}>
              <b>📄 A calendar file (.ics)</b><span>a one-off copy of a calendar you exported</span></button>
          </>}
        </div>
      )}
      <input ref={fileBox} type="file" accept=".ics,text/calendar" hidden onChange={importFile} />
      {clearing && <ClearAsk plan={plan} onClose={() => setClearing(false)}
        onClear={(what, n) => {
          setClearing(false);
          planBox.current?.close();
          act(clearPlan(plan, what, now), `Calendar cleared — ${plural(n, "thing", "things")} taken off.`);
        }} />}
      {pickHols && <HolidayPick plan={plan} y={y} onClose={() => setPickHols(false)}
        onAnswer={(names, text, country) => { act(takeHolidays(country ? { ...plan, holidays: { ...(plan.holidays || {}), country } } : plan, names), text); setPickHols(false); }} />}
      {importing && <CalendarLink provider={importing} plan={plan} status={linkedState} onClose={() => setImporting(false)}
        onAdd={(cal) => act({ ...plan, linked: [...(plan.linked || []), cal] }, `${cal.name} added — its events are on your calendar.`)}
        onRemove={(id) => act({ ...plan, linked: (plan.linked || []).filter((c) => c.id !== id) }, "That calendar is no longer shown.")}
        onRefresh={() => setLinkedTick((n) => n + 1)} />}
      {qr && <QrBox what={qr.what} url={qr.url} onClose={() => setQr(null)} />}
      {going && (
        <form className="rota-goto" onKeyDown={(e) => { if (e.key === "Escape") setGoing(false); }} onSubmit={(e) => {
          e.preventDefault();
          const v = e.currentTarget.elements.day.value;
          if (v) { setAt({ y: +v.slice(0, 4), m: +v.slice(5, 7) - 1 }); setScope("month"); setPick({ from: v, to: v, dragging: false }); }
          setGoing(false);
        }}>
          <label><span>Go to date</span><input name="day" type="date" autoFocus defaultValue={now} /></label>
          <button type="submit" className="rota-add">Go</button>
          <button type="button" className="rota-x" onClick={() => setGoing(false)} aria-label="Close">✕</button>
        </form>
      )}
      {help && (
        <div className="rota-help" role="dialog" aria-label="Keyboard shortcuts" onClick={() => setHelp(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <header><b>Keyboard shortcuts</b><button type="button" className="rota-x" onClick={() => setHelp(false)} aria-label="Close">✕</button></header>
            <dl>
              {[["T", "Today"], ["← / P / K", "Previous month or year"], ["→ / N / J", "Next month or year"],
                ["M", "Month"], ["Y", "Year"], ["A", "Agenda"], ["G", "Go to a date"], ["C", "Create on today"],
                ["Click an event", "Open it"], ["Drag an event", "Move it"], ["Drag its end", "Change the start or the end"],
                ["Drag across days", "Pick a stretch"], ["Delete", "Delete the open event"],
                ["Ctrl/⌘ + Z", "Undo"], ["Esc", "Close"], ["?", "This list"]].map(([k, v]) => (
                <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>
              ))}
            </dl>
          </div>
        </div>
      )}
      {/* Floating, not in the page: a message that pushes the board down takes
          a row of figures from every quadrant for as long as it is up. */}
      {said && (
        <p className={`rota-said is-${said.kind}`} role="status">
          <span>{said.text}</span>
          {said.undo && <button type="button" className="is-undo" onClick={undo}>Undo</button>}
          <button type="button" onClick={() => setSaid(null)} aria-label="Dismiss">✕</button>
        </p>
      )}

      <div className="rota-board">
        <section className="rota-q">
          <header>
            <span aria-hidden="true">{view === "agenda" ? "🗓" : view === "years" ? "🧭" : scope === "month" ? "📅" : "📆"}</span>
            <h2>{view === "agenda" ? "Coming up" : view === "years" ? `${y} – ${y + 4}` : scope === "month" ? `${MONTHS[m]} ${y}` : y}</h2>
            <div className="rota-tabs" role="tablist" aria-label="What the calendar shows">
              {[["grid", "Calendar"], ["agenda", "Agenda"], ["years", "5 years"]].map(([k, label]) => (
                <button type="button" role="tab" key={k} aria-selected={view === k} onClick={() => setView(k)}>{label}</button>
              ))}
            </div>
            {hasRotation(plan) && (plan.suggest === false
              ? <button type="button" className="rota-tag is-suggest" onClick={() => act(withSuggestions(plan, true), "Suggestions are back.")}
                  title="Show the rotation's suggested hitches again">Show suggestions</button>
              : <button type="button" className="rota-tag is-action" onClick={() => act(withSuggestions(plan, false), "Suggestions cleared — only your own hitches are left.")}
                  title="Take every suggested hitch off the calendar — your own stay">Clear suggestions</button>)}
            {holidaysPending(plan)
              ? <button type="button" className="rota-tag is-suggest" onClick={() => setPickHols(true)}
                  title="A suggestion — nothing is added until you choose">💡 Add holidays?</button>
              : together
              ? <span className="rota-tag is-both" title={`Next time you and ${together.who} are both home`}>👥 {together.who} · {fmt(together.from, { day: "numeric", month: "short" })}{together.days > 1 ? ` +${together.days - 1}` : ""}</span>
              : <span className="rota-tag">{plural(count.days, "day", "days")}</span>}
          </header>
          <div className="rota-body">
            {view === "agenda" ? (
              <div className="rota-agenda-wrap" ref={agendaBox}>
              <ul className="rota-agenda">
                {agenda.length ? agenda.slice(page * perPage, page * perPage + perPage).map((it, i, shown) => {
                  const newMonth = i === 0 || shown[i - 1].from.slice(0, 7) !== it.from.slice(0, 7);
                  const ink = it.sort === "change" ? col(it.state === "home" ? "home" : "out")
                    : it.sort === "state" ? col(it.state) : it.sort === "holiday" ? "var(--st-hotel)"
                      : it.sort === "certificate" ? "#FB7185" : it.sort === "linked" ? it.color
                        : it.cat ? CATEGORY[it.cat].color : "var(--accent-lit)";
                  return (
                    <li key={it.key} className={newMonth ? "is-new" : ""}>
                      {newMonth && <p className="rota-agenda-m">{fmt(it.from, { month: "long", year: "numeric" })}</p>}
                      <button type="button" onClick={(e) => {
                        if (it.sort === "change") { setAt({ y: +it.from.slice(0, 4), m: +it.from.slice(5, 7) - 1 }); setScope("month"); setView("grid"); return; }
                        const r = e.currentTarget.getBoundingClientRect();
                        setEv({ item: it, rect: { left: r.left + 40, top: r.top, bottom: r.bottom } });
                      }}>
                        <span className="rota-agenda-d"><b>{fmt(it.from, { day: "numeric" })}</b>{fmt(it.from, { weekday: "short" })}</span>
                        <i style={{ background: ink }} />
                        <span className="rota-agenda-w">
                          {it.sort === "change" ? (it.state === "home" ? "🏠 " : "✈️ ") : it.sort === "state" ? `${STATE[it.state].mark} ` : ""}{it.what}
                          {it.from !== it.to ? <em> · until {fmt(it.to, { day: "numeric", month: "short" })}</em> : null}
                        </span>
                        <span className="rota-agenda-n">{dayOf(it.from) - dayOf(now) <= 0 ? "today" : `in ${dayOf(it.from) - dayOf(now)} d`}</span>
                      </button>
                    </li>
                  );
                }) : <li className="rota-note">Nothing in the next six months.</li>}
              </ul>
              {agenda.length > perPage && (
                <nav className="rota-pager" aria-label="Agenda pages">
                  <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Earlier">‹</button>
                  <span>{page + 1} / {Math.ceil(agenda.length / perPage)} · {agenda.length} coming up</span>
                  <button type="button" disabled={(page + 1) * perPage >= agenda.length} onClick={() => setPage((p) => p + 1)} aria-label="Later">›</button>
                </nav>
              )}
              </div>
            ) : view === "years" ? (
              <div className="rota-years">
                {years.map((row) => (
                  <div className="rota-yr" key={row.y}>
                    <b>{row.y}</b>
                    <div className="rota-yr-months">
                      {row.months.map((mo, i) => (
                        <button type="button" key={i} title={`${MONTHS[i]} ${row.y} — ${mo.aboard} aboard, ${mo.home} home`}
                          onClick={() => { setAt({ y: row.y, m: i }); setScope("month"); setView("grid"); }}>
                          {bar(mo, 100)}
                          <span>{MONTHS[i][0]}</span>
                        </button>
                      ))}
                    </div>
                    <span className="rota-yr-n"><em style={{ color: col("aboard") }}>{row.total.aboard}</em> · <em style={{ color: col("home") }}>{row.total.home}</em> · {row.total.abroad} out</span>
                  </div>
                ))}
              </div>
            ) : scope === "month" ? (
              <>
                <div className="rota-dow">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
                <div className="rota-grid" ref={gridBox}>
                  {grid.map((cell, i) => (
                    <button type="button" key={cell.iso} data-iso={cell.iso}
                      /* Placed, not flowed: the bars below are placed on the
                         same grid, and a flowed day would step round them. */
                      style={{ gridRow: Math.floor(i / 7) + 1, gridColumn: (i % 7) + 1,
                        }}
                      className={`rota-day${cell.dim ? " is-dim" : ""}${cell.iso === now ? " is-now" : ""}${cell.state === "none" ? " is-none" : ""}`
                        + `${saidOn(plan, cell.iso) ? " is-said" : ""}${inPick(cell.iso) ? " is-picked" : ""}`}
                      /* Press and drag, the way a calendar picks a stretch; a
                         press on the one day already open closes it. */
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.preventDefault();
                        if (pick && !pick.dragging && lo === hi && lo === cell.iso) { setPick(null); return; }
                        if (e.shiftKey && pick) { setPick({ from: pick.from, to: cell.iso, dragging: false }); return; }
                        setPick({ from: cell.iso, to: cell.iso, dragging: true });
                      }}
                      onPointerEnter={() => {
                        if (pick?.dragging) setPick((p) => ({ ...p, to: cell.iso }));
                      }}
                      /* The keyboard has no drag: Enter opens the one day. */
                      onClick={(e) => {
                        if (e.detail === 0) setPick(inPick(cell.iso) && lo === hi ? null : { from: cell.iso, to: cell.iso, dragging: false });
                      }}
                      aria-expanded={inPick(cell.iso)}
                      title={`${fmt(cell.iso, { weekday: "long", day: "numeric", month: "long" })} — ${STATE[cell.state].label}`}>
                      <span className="rota-d">{cell.number}</span>
                      <span className="rota-e" aria-hidden="true">{shifts[i] === "night" ? "🌙" : shifts[i] === "day" ? "☀️" : ""}</span>
                      {theirs && (
                        <span className="rota-them" style={{ background: col(theirs[i]) }}
                          title={`${(plan.others || [])[0]?.who || "They"}: ${STATE[theirs[i]].label}`} />
                      )}
                      {(plan.notes || {})[cell.iso] ? (
                        <span className="rota-noted" title={(plan.notes || {})[cell.iso]} aria-label="Has a note">✎</span>
                      ) : null}
                      {hiddenOn.get(cell.iso) ? (
                        <span className="rota-more">+{hiddenOn.get(cell.iso)}</span>
                      ) : null}
                    </button>
                  ))}
                  {/* The events, one bar each, linked across the days they
                      cover. Rounded where the event really starts or ends,
                      squared where it carries on into the next week, and the
                      name written on the first piece of every week so a bar
                      that wraps still says what it is. */}
                  {shownBars.map((b) => {
                    const it = b.item;
                    const ink = it.sort === "hitch" || it.sort === "suggested" ? col("aboard")
                      : it.sort === "state" ? col(it.state)
                      : it.sort === "holiday" ? "var(--st-hotel)"
                        : it.sort === "certificate" ? "#FB7185"
                          : it.sort === "linked" ? it.color
                            : it.cat ? CATEGORY[it.cat].color : "var(--accent-lit)";
                    const many = it.from !== it.to;
                    const when = many ? `${short(it.from)} – ${short(it.to)}` : "";
                    return (
                      <button type="button" key={`${it.key}:${b.row}`}
                        className={`rota-bar is-${it.sort}${b.head ? " is-head" : ""}${b.tail ? " is-tail" : ""}`
                          + `${movable(it) ? " is-movable" : ""}${it.moving ? " is-moving" : ""}`}
                        style={{ gridRow: b.row + 1, gridColumn: `${b.c0 + 1} / ${b.c1 + 2}`,
                          "--ink": ink, "--lane": b.lane }}
                        title={`${it.what}${many ? ` · ${fmt(it.from, { day: "numeric", month: "long" })} to ${fmt(it.to, { day: "numeric", month: "long" })}` : ""}`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          if (e.button !== 0) return;
                          e.preventDefault();
                          const at = dayAt(e.clientX, e.clientY) || it.from;
                          /* The last few pixels of a real start or end take
                             hold of that end alone; anywhere else takes the
                             whole event. Holidays and certificates are not his
                             to move, and only open. */
                          const r = e.currentTarget.getBoundingClientRect();
                          const part = !movable(it) ? "none"
                            : b.head && e.clientX - r.left < GRIP ? "start"
                              : b.tail && r.right - e.clientX < GRIP ? "end" : "whole";
                          setEv(null);
                          setDrag({ item: it, part, at, over: at, rect: { left: r.left, top: r.top, bottom: r.bottom } });
                        }}
                        /* The keyboard has no drag: Enter opens the event. */
                        onClick={(e) => {
                          if (e.detail !== 0) return;
                          const r = e.currentTarget.getBoundingClientRect();
                          setEv({ item: it, rect: { left: r.left, top: r.top, bottom: r.bottom } });
                        }}>
                        {!b.head && <i aria-hidden="true">◂</i>}
                        {it.sort === "state" && <i aria-hidden="true">{STATE[it.state].mark}</i>}
                        {(it.sort === "hitch" || it.sort === "suggested") && <i aria-hidden="true">⚓</i>}
                        <span>{it.what}{it.sort === "suggested" ? " · suggested" : it.sort === "hitch" ? ` · ${it.days}d` : ""}</span>
                        {many && b.head ? <em>{when}</em> : null}
                        {!b.tail && <i className="is-on" aria-hidden="true">▸</i>}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="rota-year-grid">
                {MONTHS.map((name, i) => {
                  const first = monthStart(y, i);
                  const lead = weekday(first);
                  const length = monthLength(y, i);
                  const offset = first - monthStart(y, 0);
                  return (
                    <div className="rota-ym" key={name}>
                      <button type="button" onClick={() => openMonth(i)}>{name}</button>
                      <div className="rota-ym-grid">
                        {DOW.map((d) => <i key={d}>{d[0]}</i>)}
                        {Array.from({ length: lead }, (unused, k) => <span key={`b${k}`} className="is-blank" />)}
                        {Array.from({ length }, (unused, k) => {
                          const state = yearStates[offset + k] || "home";
                          const iso = isoOf(first + k);
                          return (
                            <span key={iso} className={iso === now ? "is-now" : ""}
                              style={{ background: tint(state, iso === now ? 100 : 34) }}
                              title={`${fmt(iso, { day: "numeric", month: "long" })} — ${STATE[state].label}`}>
                              {k + 1}
                            </span>
                          );
                        })}
                      </div>
                      {bar(months[i], 8)}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="rota-legend">
              {/* The rotation is drawn as events, not as a colour on each day:
                  the key says which bar is which. */}
              <span><b style={{ background: col("aboard") }} />⚓ Your hitch</span>
              <span><b className="is-dashed" style={{ borderColor: col("aboard") }} />⚓ Suggested</span>
              {/* The categories in use, each a switch: pressed off, its events
                  leave the calendar until it is pressed on again. Only the ones
                  he actually uses are offered — six empty switches are noise. */}
              {(() => {
                const used = [...new Set((plan.dates || []).map((d) => d.cat || "none")), ...(plan.linked || []).map((c) => `g:${c.id}`)];
                if (used.length < 2 && used[0] === "none") return null;
                const hidden = new Set(plan.hidden || []);
                const toggle = (k) => change({ ...plan, hidden: hidden.has(k) ? [...hidden].filter((x) => x !== k) : [...hidden, k] });
                return used.map((k) => (
                  <button type="button" key={k} className={`rota-cat${hidden.has(k) ? " is-off" : ""}`}
                    aria-pressed={!hidden.has(k)} onClick={() => toggle(k)}
                    title={hidden.has(k) ? "Show these events" : "Hide these events"}>
                    <b style={{ background: k === "none" ? "var(--accent-lit)" : k.startsWith("g:") ? (plan.linked || []).find((c) => `g:${c.id}` === k)?.color : CATEGORY[k].color }} />
                    {k === "none" ? "Events" : k.startsWith("g:") ? (plan.linked || []).find((c) => `g:${c.id}` === k)?.name : CATEGORY[k].label}
                  </button>
                ));
              })()}
            </div>
          </div>
        </section>

        <section className="rota-q">
          <header>
            <span aria-hidden="true">🧮</span>
            <h2>{scope === "month" ? `${MONTHS[m]} counted` : `${y} counted`}</h2>
            <span className="rota-tag">{count.none ? `${count.none} not planned` : `${count.abroad} away`}</span>
          </header>
          <div className="rota-body is-wide">
            {bar(count, 26)}
            <div className="rota-rows">
              {STATES.map((s) => (
                <div className="rota-row" key={s.key}>
                  <span aria-hidden="true">{s.mark}</span>
                  <span className="rota-lbl">{s.label}</span>
                  <span className="rota-v" style={{ color: col(s.key) }}>{count[s.key]}</span>
                  <span className="rota-pc">{share(count[s.key], count.days)}%{delta(s.key)}</span>
                </div>
              ))}
              <div className="rota-row is-sum">
                <span aria-hidden="true">🌍</span>
                <span className="rota-lbl">Out of the country</span>
                <span className="rota-v">{count.abroad}</span>
                <span className="rota-pc">{share(count.abroad, count.days)}%{delta("abroad")}</span>
              </div>
              <div className="rota-row">
                <span aria-hidden="true">🏡</span>
                <span className="rota-lbl">In the country</span>
                <span className="rota-v is-quiet">{count.inCountry}</span>
                <span className="rota-pc">{share(count.inCountry, count.days)}%</span>
              </div>
            </div>
            <div className="rota-kpi is-ruled">
              {[["⚓", "Aboard", "aboard"], ["🏠", "At home", "home"],
                ["🏨", "Hotel", "hotel"], ["✈️", "Flying", "travelling"]].map(([mark, name, key]) => {
                  const most = Math.max(...months.map((t) => t[key]), 1);
                  const shade = key === "travelling" ? col("out") : col(key);
                  return (
                    <div key={key}>
                      <div className="rota-k"><span aria-hidden="true">{mark}</span> {name}</div>
                      <div className="rota-big" style={{ color: shade }}>{count[key]}</div>
                      <div className="rota-s">
                        {scope === "month" ? `${year[key]} in ${y}` : `${(count[key] / 12).toFixed(1)} a month`}
                      </div>
                      <div className="rota-mini">
                        {months.map((t, i) => (
                          <i key={MONTHS[i]} title={`${MONTHS[i]}: ${t[key]}`}
                            style={{
                              height: `${Math.max(2, (t[key] / most) * 22)}px`,
                              background: scope === "month" && i === m ? shade : "rgba(255,255,255,.16)",
                            }} />
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </section>

        <section className="rota-q">
          <header>
            <span aria-hidden="true">{q4 === "pay" ? "💷" : basis === "uk" ? "🇬🇧" : "🌍"}</span>
            <h2>{q4 === "pay" ? `Pay · ${scope === "month" ? MONTHS[m] : y}` : basis === "uk" ? "The claim" : "The year"}</h2>
            <div className="rota-tabs" role="tablist" aria-label="What this panel shows">
              {[["year", basis === "uk" ? "Claim" : "Year"], ["pay", "Pay"]].map(([k, label]) => (
                <button type="button" role="tab" key={k} aria-selected={q4 === k} onClick={() => setQ4(k)}>
                  {label}
                </button>
              ))}
            </div>
          </header>
          {/* Wide and short, both ways round: the figures across the top, and
              then the two blocks that would not fit under each other placed
              beside each other instead. The quadrant has width to spare and
              never has height to spare. */}
          <div className="rota-body is-wide">
            {q4 === "pay" ? (
              <Pay month={payMonth} year={payYear} soFar={paySoFar} label={scope === "month" ? MONTHS[m] : String(y)}
                y={y} onSet={() => planBox.current?.showModal()} />
            ) : basis === "day"
              ? <DayRate year={year} before={before} soFar={awaySoFar} y={y} bar={bar} flights={flights} />
              : <Salaried sea={sea} ledger={ledger} />}
          </div>
        </section>

        <section className="rota-q">
          <header>
            <span aria-hidden="true">{scope === "month" ? "🧭" : "📊"}</span>
            <h2>{scope === "month" ? "The runs" : "Month by month"}</h2>
            <span className="rota-tag">
              {scope === "month" ? plural(runs.length, "stretch", "stretches") : y}
            </span>
          </header>
          <div className="rota-body" ref={runsBox}>
            {scope === "month" && runs.length > runsPer && (
              <nav className="rota-pager is-top" aria-label="Stretches">
                <button type="button" disabled={runsPage === 0} onClick={() => setRunsPage((p) => p - 1)} aria-label="Earlier">‹</button>
                <span>{runsPage * runsPer + 1}–{Math.min(runs.length, (runsPage + 1) * runsPer)} of {runs.length}</span>
                <button type="button" disabled={(runsPage + 1) * runsPer >= runs.length} onClick={() => setRunsPage((p) => p + 1)} aria-label="Later">›</button>
              </nav>
            )}
            {scope === "month" && !runs.length && (
              /* Nothing to run: no rotation, or a month before it starts. The
                 calendar is left blank rather than filled with a guess. */
              <div className="rota-empty">
                {!hasRotation(plan) ? (
                  <>
                    <p><b>No rotation set.</b> The calendar stays blank until you set yours — then it fills in from the day it starts.</p>
                    <button type="button" className="btn primary" onClick={openPattern}>Set my rotation</button>
                  </>
                ) : (
                  <p>Your rotation starts on <b>{shortDate(plan.anchor)}</b>. Nothing before that is counted.</p>
                )}
              </div>
            )}
            {scope === "month" ? runs.slice(runsPage * runsPer, runsPage * runsPer + runsPer).map((run) => {
              const inside = marks.filter((mark) => mark.on >= run.from && mark.on <= run.to);
              return (
                <div className="rota-run" key={`${run.state}${run.from}`}>
                  <i className="rota-run-bar" style={{ background: col(run.state) }} />
                  <span aria-hidden="true">{STATE[run.state].mark}</span>
                  <div>
                    <b style={{ color: col(run.state) }}>{STATE[run.state].label}</b>
                    <p className="rota-note">
                      {shortDate(run.from)} → {shortDate(run.to)} ·{" "}
                      {share(run.days, year[run.state])}% of the year&rsquo;s{" "}
                      {STATE[run.state].short.toLowerCase()} days
                      {run.whole ? "" : " · part of a longer stretch"}
                    </p>
                    {inside.length > 0 && (
                      <p className="rota-note is-lit">
                        {/* A stretch that falls inside a run is named once, with its
                            span, not once for each of its days. */}
                        {inside.filter((mark, i, all) => !mark.id || all.findIndex((x) => x.id === mark.id) === i)
                          .slice(0, 4).map((mark) => (
                          <span key={`${mark.on}${mark.what}`}>
                            {GLYPH[mark.sort]} {mark.what}
                            {mark.note && mark.sort === "family" && !/\//.test(mark.note) ? ` (${mark.note})` : ""}
                          </span>
                        ))}
                        {inside.length > 4 ? <span>and {inside.length - 4} more</span> : null}
                      </p>
                    )}
                  </div>
                  <span className="rota-run-days">{run.days}<em>d</em></span>
                </div>
              );
            }) : (
              <>
                {/* Six months and six months, beside each other. Twelve rows
                    under one header is taller than the quadrant ever is, and
                    the quadrant has width it was not using. */}
                <div className="rota-halves">
                  {[[0, 6], [6, 12]].map(([first, last]) => (
                    <table className="rota-table" key={first}>
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th><span aria-hidden="true">⚓</span> Aboard</th>
                          <th><span aria-hidden="true">🏨</span> Hotel</th>
                          <th><span aria-hidden="true">✈️</span> Flying</th>
                          <th><span aria-hidden="true">🏠</span> Home</th>
                          <th><span aria-hidden="true">🌍</span> Out</th>
                        </tr>
                      </thead>
                      <tbody>
                        {MONTHS.slice(first, last).map((name, k) => {
                          const i = first + k;
                          return (
                            <tr key={name} className={i === m ? "is-hit" : ""}>
                              <td>
                                <button type="button" className="rota-link" onClick={() => openMonth(i)}>{name}</button>
                              </td>
                              <td style={{ color: col("aboard") }}>{months[i].aboard || "—"}</td>
                              <td style={{ color: col("hotel") }}>{months[i].hotel || "—"}</td>
                              <td style={{ color: col("out") }}>{months[i].travelling || "—"}</td>
                              <td style={{ color: col("home") }}>{months[i].home || "—"}</td>
                              <td><b>{months[i].abroad}</b></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ))}
                </div>
                <table className="rota-table rota-sum">
                  <tbody>
                    <tr className="is-total">
                      <td>{y}</td>
                      <td>{year.aboard}</td><td>{year.hotel}</td><td>{year.travelling}</td>
                      <td>{year.home}</td><td>{year.abroad}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="rota-note">Any month opens it.</p>
              </>
            )}
          </div>
        </section>
      </div>

      {/* Outside the quadrant on purpose: a quadrant clips what it holds, so
          a card drawn inside one comes out cut in half. It is placed against
          the window instead. */}
      {ask && (
        <ScopeAsk verb={ask.change.kind === "delete" ? "Delete" : ask.change.kind === "move" ? "Move" : "Change"}
          what={ask.item.what} year={+ask.item.from.slice(0, 4)} day={ask.item.every === "repeat" ? short(ask.item.from) : ""}
          onCancel={() => setAsk(null)}
          onPick={(scope) => {
            act(changeOccurrence(plan, ask.item, scope, ask.change, `d${Date.now().toString(36)}`, now), ask.text);
            setAsk(null);
          }} />
      )}
      {ev && (() => {
        const it = ev.item;
        const own = it.sort === "family" && it.id;
        const told = it.sort === "state";
        const close = () => setEv(null);
        if (it.sort === "hitch" || it.sort === "suggested") {
          return (
            <EventPop item={it} rect={ev.rect} onClose={close}
              onDelete={it.sort === "hitch" ? () => { close(); act(dropHitch(plan, it.id), "Hitch taken off — the rotation's suggestion is back."); } : null}>
              <TurnTools key={it.key} item={it} plan={plan} onPlan={act} onClose={close} />
            </EventPop>
          );
        }
        return (
          <EventPop item={it} rect={ev.rect} onClose={close}
            onEdit={own || told ? () => { close(); setPick({ from: it.from, to: it.to, dragging: false, editId: own ? it.id : undefined }); } : null}
            onDuplicate={own ? () => { close(); act(duplicateDate(plan, it.id, `d${Date.now().toString(36)}`), `Copied “${it.what}”.`); } : null}
            onDelete={own ? () => { close(); occurrence(it, { kind: "delete" }, `Deleted “${it.what}”.`); }
              : told ? () => { close(); act(withDays(plan, it.from, it.to, null), `${it.what}: back to the rotation.`); } : null} />
        );
      })()}

      {pick && !pick.dragging && grid.some((c) => c.iso === lo) && (
        <DayCard
          from={lo}
          to={hi}
          at={grid.findIndex((c) => c.iso === lo)}
          plan={plan}
          marks={(() => {
            /* A stretch shows each thing on it once, not once a day. */
            const seen = new Set();
            return [...marksOf(plan, lo, hi, { certificates: certs }),
              ...linkedIn(lo, hi).map((e) => ({ on: e.from, what: `${e.what} · ${e.source}`, sort: "linked", note: "" }))].filter((mk) => {
              const k = mk.id || `${mk.sort}:${mk.what}`;
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            });
          })()}
          onRange={(from, to) => setPick({ from, to, dragging: false })}
          onState={(state) => (state === "aboard"
            ? act(withHitch(withDays(plan, lo, hi, null), lo, hi, `h${Date.now().toString(36)}`), `Aboard ${short(lo)} – ${short(hi)} — the turns after it follow.`)
            : change(withDays(plan, lo, hi, state)))}
          onSave={(id, date) => change({
            ...plan,
            dates: id
              ? (plan.dates || []).map((d) => (d.id === id ? { ...date, id } : d))
              : [...(plan.dates || []), { id: `d${Date.now().toString(36)}`, ...date }],
          })}
          editId={pick.editId}
          today={now}
          onNote={(iso, text) => { if (((plan.notes || {})[iso] || "") !== text.trim()) change(withNote(plan, iso, text)); }}
          onDrop={(id) => act(dropDate(plan, id, now), `Deleted “${(plan.dates || []).find((d) => d.id === id)?.what || "event"}”.`)}
          onClose={() => setPick(null)}
        />
      )}

      <dialog className="rota-plan" ref={planBox}>
        <header>
          <b>The plan</b>
          <span>
            {soon
              ? `${soon.kind === "fly out" ? "Next out" : "Next home"} ${shortDate(soon.on)}, ${soon.inDays === 0 ? "today" : `in ${plural(soon.inDays, "day", "days")}`}`
              : "Nothing ahead on this horizon"}
          </span>
          <button type="button" onClick={() => planBox.current?.close()} aria-label="Close">×</button>
        </header>
        <div className="rota-plan-body">
          <section className="panel" id="rota-pattern">
            <h2>The pattern</h2>
            {!hasRotation(plan) ? (
              <div className="rota-suggest">
                <p className="rota-note"><b>No rotation set</b> — the calendar is blank. The fields below hold the commonest one, 28 on and 28 off from today, as a suggestion: change them and it is yours, or take it as it is.</p>
                <button type="button" className="btn primary"
                  onClick={() => act({ ...plan, pattern: { ...pattern } }, "Rotation set — the calendar fills in from its first day aboard.")}>
                  Use this rotation</button>
              </div>
            ) : (
              <p className="rota-note">Set: {pattern.on} on / {pattern.off} off from {shortDate(plan.anchor)}. Nothing before that day is counted.{" "}
                <button type="button" className="rota-link"
                  onClick={() => act({ ...plan, pattern: null, slips: {} }, "Rotation removed — the calendar keeps only what you told it.")}>Remove the rotation</button></p>
            )}
            <div className="grid2">
              <label className="field">
                <span>Days aboard</span>
                <input type="number" min="1" max="365" value={pattern.on}
                  onChange={(e) => setPattern({ on: +e.target.value || 1 })} />
              </label>
              <label className="field">
                <span>Days at home</span>
                <input type="number" min="1" max="365" value={pattern.off}
                  onChange={(e) => setPattern({ off: +e.target.value || 1 })} />
              </label>
              <label className="field">
                <span>🏨 Hotel nights before</span>
                <input type="number" min="0" max="30" value={pattern.hotelOut}
                  onChange={(e) => setPattern({ hotelOut: Math.max(0, +e.target.value || 0) })} />
              </label>
              <label className="field">
                <span>🏨 Hotel nights after</span>
                <input type="number" min="0" max="30" value={pattern.hotelBack}
                  onChange={(e) => setPattern({ hotelBack: Math.max(0, +e.target.value || 0) })} />
              </label>
              <label className="field">
                <span>✈️ Days in the air, each way</span>
                <input type="number" min="0" max="10" value={pattern.travel}
                  onChange={(e) => setPattern({ travel: Math.max(0, +e.target.value || 0) })} />
              </label>
              <label className="field">
                <span>First day aboard</span>
                <input type="date" value={plan.anchor}
                  onChange={(e) => change({ ...plan, anchor: e.target.value || plan.anchor, pattern: { ...pattern } })} />
              </label>
              <label className="field">
                <span>Turns on the sheet</span>
                <input type="number" min="1" max="40" value={plan.horizon}
                  onChange={(e) => change({ ...plan, horizon: +e.target.value || 1 })} />
              </label>
              <label className="field">
                <span>Name on the sheet</span>
                <input value={plan.who} placeholder="Yours"
                  onChange={(e) => change({ ...plan, who: e.target.value })} />
              </label>
            </div>
            <p className="note">
              Sailing day to sailing day is <b>{plural(cycle, "day", "days")}</b> — not{" "}
              {pattern.on + pattern.off + pattern.hotelOut + pattern.hotelBack + pattern.travel * 2}.
              The hotel nights before the ship and the flight out to it come out of your days off;
              they are not added on the end of them.
            </p>
            <div className="btn-row">
              <button className="btn" type="button" onClick={fromTrips} disabled={Boolean(busy) || !available()}>
                {busy === "reading" ? "Reading…" : "Work it out from my last trips"}
              </button>
            </div>
            {(() => {
              const pay = { ...BLANK_PAY, ...(plan.pay || {}) };
              const put = (patch) => change({ ...plan, pay: { ...pay, ...patch } });
              const num = (k, label) => (
                <label className="field"><span>{label}</span>
                  <input type="number" min="0" step="1" value={pay[k] || ""} placeholder="0"
                    onChange={(e) => put({ [k]: +e.target.value || 0 })} /></label>
              );
              return (
                <div className="rota-pay-set">
                  <div className="grid2">
                    <label className="field"><span>Paid</span>
                      <select data-scale value={pay.mode} onChange={(e) => put({ mode: e.target.value })}>
                        <option value="day">By the day</option>
                        <option value="salary">Salary by the month</option>
                      </select></label>
                    <label className="field"><span>Currency</span>
                      <select value={pay.currency} onChange={(e) => put({ currency: e.target.value })}>
                        {inOrder(["$", "£", "R$", "€", "kr "], (c) => c.trim()).map((c) => <option key={c} value={c}>{c.trim()}</option>)}
                      </select></label>
                    {pay.mode === "salary"
                      ? <>{num("monthly", "Salary a month")}{num("soldRate", "A sold day pays")}</>
                      : <>{num("dayRate", "Day rate aboard")}{num("travelRate", "A travel day pays")}{num("hotelRate", "A hotel night pays")}</>}
                  </div>
                </div>
              );
            })()}
            <label className="field">
              <span>Shifts aboard</span>
              <select data-scale value={plan.pattern?.shift || "none"} onChange={(e) => setPattern({ shift: e.target.value })}>
                {SHIFTS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
            </label>
          </section>

          {/* Someone else's rotation beside yours — a partner's, a crewmate's —
              for the one question it is kept for: when are we both home. Pasted
              from their shared link, or typed in. The first one is drawn under
              each day of the calendar as a thin line in their colour. */}
          <section className="panel">
            <h2>Other rotations</h2>
            {(plan.others || []).map((o, k) => {
              const both = bothHome(plan, o, now);
              const put = (patch) => change({ ...plan, others: plan.others.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
              return (
                <div className="rota-other" key={o.id || k}>
                  <div className="grid2">
                    <label className="field"><span>Whose</span>
                      <input value={o.who || ""} placeholder="Ana" onChange={(e) => put({ who: e.target.value })} /></label>
                    <label className="field"><span>First day away</span>
                      <input type="date" value={o.anchor || ""} onChange={(e) => e.target.value && put({ anchor: e.target.value })} /></label>
                    <label className="field"><span>Days away</span>
                      <input type="number" min="1" max="365" value={o.pattern?.on || 14}
                        onChange={(e) => put({ pattern: { ...o.pattern, on: +e.target.value || 1 } })} /></label>
                    <label className="field"><span>Days home</span>
                      <input type="number" min="1" max="365" value={o.pattern?.off || 14}
                        onChange={(e) => put({ pattern: { ...o.pattern, off: +e.target.value || 1 } })} /></label>
                  </div>
                  <p className="rota-note">
                    {both ? `Next both home: ${fmt(both.from, { day: "numeric", month: "long" })} – ${fmt(both.to, { day: "numeric", month: "long" })} (${plural(both.days, "day", "days")}).` : "Not both home in the next two years."}
                    {" "}
                    <button type="button" className="rota-link"
                      onClick={() => act({ ...plan, others: plan.others.filter((x, j) => j !== k) }, `Removed ${o.who || "that rotation"}.`)}>Remove</button>
                  </p>
                </div>
              );
            })}
            <div className="btn-row">
              <button className="btn" type="button"
                onClick={() => change({ ...plan, others: [...(plan.others || []), { id: `o${Date.now().toString(36)}`, who: "", pattern: { on: 14, off: 14 }, anchor: now }] })}>
                Add someone's rotation
              </button>
              <input className="rota-paste" placeholder="…or paste the link they shared"
                onChange={(e) => {
                  const text = String(e.target.value);
                  const m = text.match(/#r=([^\s]+)/);
                  const z = text.match(/#z=([A-Za-z0-9_-]+)/);
                  if (!m && !z) return;
                  const input = e.target;
                  (async () => { try {
                    const got = m ? JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1])))))
                      : JSON.parse(await new Response(new Blob([unb64u(z[1])]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text());
                    if (!got?.pattern || !got?.anchor) return;
                    act({ ...plan, others: [...(plan.others || []), { id: `o${Date.now().toString(36)}`, who: got.who || "Shared", pattern: got.pattern, anchor: got.anchor, slips: got.slips || {} }] },
                      `Added ${got.who || "their"} rotation.`);
                    input.value = "";
                  } catch { /* not a rotation link */ } })();
                }} />
            </div>
          </section>

          <section className="panel">
            <h2>Dates that matter</h2>
            <ul className="rot-list">
              {(plan.dates || []).map((d) => (
                <li key={d.id}>
                  <input value={d.what} placeholder="Whose, and what"
                    onChange={(e) => editDate(d.id, { what: e.target.value })} />
                  <input type="date" value={d.on.length > 5 ? d.on : `2000-${d.on}`}
                    onChange={(e) => editDate(d.id, { on: e.target.value })} />
                  <label className="rot-every">
                    <input type="checkbox" checked={d.every === "year"}
                      onChange={(e) => editDate(d.id, { every: e.target.checked ? "year" : "once" })} />
                    every year
                  </label>
                  <button type="button" onClick={() => binDate(d.id)}
                    aria-label={`Forget ${d.what || "this date"}`}>×</button>
                </li>
              ))}
            </ul>
            <div className="btn-row">
              <button className="btn" type="button" onClick={addDate}>Add a date</button>
            </div>
          </section>

          <section className="panel">
            <h2>Holidays</h2>
            <label className="field">
              <span>Where home is</span>
              <select value={plan.holidays?.country || "BR"}
                onChange={(e) => change({ ...plan, holidays: { ...plan.holidays, country: e.target.value } })}>
                {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </label>
            <p className="rota-note">
              {(plan.holidays?.take || []).length
                ? `${plural(plan.holidays.take.length, "holiday", "holidays")} on your calendar.`
                : "No holidays on your calendar."}
              {" "}<button type="button" className="rota-link" onClick={() => setPickHols(true)}>Choose holidays</button>
            </p>
            <p className="note">
              The national days, and the ones nobody works anyway — Carnival and Corpus Christi are
              shown as kept, not as law. Add your own below if a yard shutdown matters.
            </p>
            <ul className="rot-list">
              {(plan.holidays?.own || []).map((h) => (
                <li key={h.id}>
                  <input value={h.what} placeholder="What it is"
                    onChange={(e) => change({
                      ...plan,
                      holidays: { ...plan.holidays, own: plan.holidays.own.map((x) => (x.id === h.id ? { ...x, what: e.target.value } : x)) },
                    })} />
                  <input type="date" value={h.on}
                    onChange={(e) => change({
                      ...plan,
                      holidays: { ...plan.holidays, own: plan.holidays.own.map((x) => (x.id === h.id ? { ...x, on: e.target.value } : x)) },
                    })} />
                  <button type="button" onClick={() => change({
                    ...plan, holidays: { ...plan.holidays, own: plan.holidays.own.filter((x) => x.id !== h.id) },
                  })} aria-label="Forget this day">×</button>
                </li>
              ))}
            </ul>
            <div className="btn-row">
              <button className="btn" type="button" onClick={() => change({
                ...plan,
                holidays: {
                  ...plan.holidays,
                  own: [...(plan.holidays?.own || []), { id: `h${Date.now()}`, what: "", on: now }],
                },
              })}>Add a day</button>
            </div>
          </section>

          {/* Certificates have a page of their own. This page reads them — their
              expiry is marked on the calendar and rings in the calendar feed —
              and does not edit or save them. */}
          <section className="panel rota-slips">
            <h2>The turns, and the ones that moved</h2>
            <p className="note">
              Move a turn the day it moves and everything behind it follows — you do not get the
              days back, and the pattern carries on from wherever you actually got off.
            </p>
            <ol>
              {turns.map((t) => (
                <li key={t.n} className={t.slipped ? "is-moved" : ""}>
                  <b>Turn {t.n}</b>
                  <span>{shortDate(t.aboard.from)} → {shortDate(t.aboard.to)}</span>
                  {t.moved ? (
                    <em>{t.moved > 0
                      ? `${plural(t.moved, "day", "days")} late`
                      : `${plural(-t.moved, "day", "days")} early`}</em>
                  ) : null}
                  <label className="field">
                    <span>Out</span>
                    <input type="date" value={t.aboard.from} onChange={(e) => slip(t.n, { from: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>Back</span>
                    <input type="date" value={t.aboard.to} onChange={(e) => slip(t.n, { to: e.target.value })} />
                  </label>
                  {t.slipped && (
                    <button className="btn" type="button" onClick={() => putBack(t.n)}>Put it back</button>
                  )}
                </li>
              ))}
            </ol>
          </section>

          {/* The two-way calendar: the iPhone's and the Mac's own Calendar
              signed in to the plan, so an event made, moved or deleted on
              either side is made, moved or deleted on the other. One profile
              to install and nothing to type; Android signs in with the same
              three things by hand. */}
          {DAV_READY && <section className="panel" id="rota-dav">
            <h2>iPhone and Mac — both ways</h2>
            {!rows.plan ? (
              <p className="rota-note">Save the plan to your account first — the phone signs in to the saved copy.
                {" "}<button type="button" className="rota-link" onClick={() => keep()} disabled={!available()}>Save now</button></p>
            ) : !plan.dav ? (
              <>
                <p className="rota-note">Your events and your rotation in the Calendar app on your iPhone or Mac. Add, move or delete an event there or here, and the other one follows.</p>
                <div className="btn-row"><button type="button" className="btn primary" onClick={() => getDav(false)} disabled={busy === "dav"}>
                  {busy === "dav" ? "Connecting…" : "Connect iPhone or Mac"}</button></div>
              </>
            ) : (
              <>
                <p className="rota-note"><b className="rota-on">● Connected.</b> Two calendars appear in Calendar: <b>Offshore Report · Rotation</b>, worked out from your pattern — change it here — and <b>Offshore Report · Events</b>, which you can change on either side. Changes here go to your phone by themselves.</p>
                <div className="btn-row">
                  <a className="btn primary" href={`/api/documents?t=profile&id=${encodeURIComponent(rows.plan)}`} download="offshore-report-calendar.mobileconfig">Install on this iPhone or Mac</a>
                  <button type="button" className="btn" onClick={() => (dav ? setDav(null) : getDav(false))} disabled={busy === "dav"}>
                    {dav ? "Hide the sign-in" : "Android or by hand"}</button>
                </div>
                <details className="rota-steps">
                  <summary>How to install it</summary>
                  <p><b>iPhone:</b> open this page in Safari on the iPhone and tap <i>Install</i>. Then open <i>Settings</i> — <i>Profile Downloaded</i> is at the top — tap it and <i>Install</i>.</p>
                  <p><b>Mac:</b> click <i>Install</i> here, then open <i>System Settings → General → Device Management</i> (or search for <i>Profiles</i>), double-click <i>Offshore Report calendar</i> and <i>Install</i>.</p>
                  <p>Settings calls the profile <i>unverified</i>: it is made for you by Offshore Report, and all it does is add this calendar. Removing it removes the calendar.</p>
                </details>
                {dav && (
                  <div className="rota-dav-keys">
                    <p className="rota-note">In DAVx⁵ on Android, or in any calendar app that takes a CalDAV account:</p>
                    {[["Server", dav.server], ["User", dav.user], ["Password", dav.password]].map(([label, value]) => (
                      <div className="rota-feed-row" key={label}>
                        <span className="rota-dav-label">{label}</span>
                        <input readOnly value={value} onFocus={(e) => e.target.select()} aria-label={label} />
                        <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(value).then(() => setSaid({ kind: "ok", text: `${label} copied.` }))}>Copy</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="btn-row">
                  <button type="button" className="rota-link" onClick={() => getDav(true)} disabled={busy === "dav"}>Disconnect every device</button>
                </div>
                <p className="rota-note">The password is only for this calendar and opens nothing else. Disconnect signs every device out of it at once; connecting again makes a new one.</p>
              </>
            )}
          </section>}

          {/* The rotation in the calendar he already uses, on the phone and the
              desktop: a subscription that Google, Apple or Outlook fetch again
              on their own. The reminders ride inside it as alarms, and the
              countdown as an all-day event on each day — which is how it
              reaches the calendar widget on his home screen. */}
          <section className="panel" id="rota-feed">
            <h2>Your rotation in Google, Apple or Outlook</h2>
            {!rows.plan ? (
              <p className="rota-note">Save the plan to your account first — the calendar reads the saved copy, so it keeps up with every change you save.
                {" "}<button type="button" className="rota-link" onClick={() => keep()} disabled={!available()}>Save now</button></p>
            ) : feed ? (
              <>
                <div className="rota-feed-row">
                  <input readOnly value={feed} onFocus={(e) => e.target.select()} aria-label="Calendar address" />
                  <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(feed).then(() => setSaid({ kind: "ok", text: "Calendar address copied." }))}>Copy</button>
                </div>
                <div className="btn-row">
                  <a className="btn primary" target="_blank" rel="noreferrer"
                    href={`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feed.replace(/^https:/, "webcal:"))}`}>Add to Google Calendar</a>
                  <a className="btn" href={feed.replace(/^https:/, "webcal:")}>Apple Calendar / Outlook</a>
                  <button type="button" className="btn" onClick={() => setQr({ what: "feed", url: feed })}>QR code</button>
                  <button type="button" className="rota-link" onClick={() => getFeed(true)}>Stop sharing this address</button>
                </div>
                <p className="rota-note">Anyone with this address can see the rotation, so share it only with who you mean to. Stop sharing makes a new one and the old one goes blank.</p>
              </>
            ) : (
              <div className="btn-row"><button type="button" className="btn primary" onClick={() => getFeed(false)} disabled={busy === "feed"}>
                {busy === "feed" ? "Making it…" : "Get my calendar address"}</button></div>
            )}
            <div className="grid2 rota-rem">
              {[["change", "Crew change", [[0, "No reminder"], [1, "The evening before"], [2, "Two days before"]]],
                ["event", "Your events", [[0, "No reminder"], [1, "The evening before"], [3, "Three days before"], [7, "A week before"]]],
                ["ticket", "Certificates", [[0, "No reminder"], [30, "A month before"], [60, "Two months before"], [90, "Three months before"]]]].map(([k, label, opts]) => (
                <label className="field" key={k}><span>{label}</span>
                  <select data-scale value={(plan.reminders || {})[k] ?? { change: 1, event: 1, ticket: 30 }[k]}
                    onChange={(e) => change({ ...plan, reminders: { ...(plan.reminders || {}), [k]: +e.target.value } })}>
                    {opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select></label>
              ))}
            </div>
            <p className="rota-note">The reminders ring on your phone through its own calendar — save the plan after changing them.</p>
          </section>

          <section className="panel rota-danger">
            <h2>Clear the calendar</h2>
            <p className="rota-note">Take off what you have put on it — events, days you changed, notes, holidays, imported calendars — all at once, or only some of it. It can be undone, and the events go to the bin for thirty days.</p>
            <div className="btn-row">
              <button type="button" className="btn is-danger" onClick={() => setClearing(true)}>Clear my calendar…</button>
            </div>
          </section>

          {/* The bin: what was deleted in the last thirty days, each with the
              way back. Empty, it says so rather than disappearing, so there is
              one place to look. */}
          <section className="panel" id="rota-bin">
            <h2>Deleted — kept {TRASH_DAYS} days</h2>
            {(plan.trash || []).length ? (
              <ul className="rota-bin">
                {plan.trash.map((d) => (
                  <li key={d.id}>
                    <span><b>{d.what}</b> · {fmt(String(d.on).length > 5 ? d.on : `2000-${d.on}`, { day: "numeric", month: "short", ...(String(d.on).length > 5 ? { year: "numeric" } : {}) })}
                      {d.until ? ` – ${fmt(d.until, { day: "numeric", month: "short" })}` : ""}
                      <em> · deleted {fmt(d.deleted, { day: "numeric", month: "short" })}</em></span>
                    <button className="btn" type="button"
                      onClick={() => act(restoreDate(plan, d.id), `“${d.what}” is back.`)}>Restore</button>
                  </li>
                ))}
              </ul>
            ) : <p className="rota-note">Nothing deleted in the last {TRASH_DAYS} days.</p>}
          </section>
        </div>
        <footer>
          <button className="btn primary" type="button" onClick={() => keep()} disabled={Boolean(busy) || !available()}>
            {busy === "saving" ? "Keeping…" : "Save"}
          </button>
          <button className="btn" type="button" onClick={() => planBox.current?.close()}>Done</button>
        </footer>
      </dialog>

      {/* The printed sheet: nothing of this is on the screen, and nothing of
          the screen is on the paper. */}
      <div className="for-paper" aria-hidden="true">
        {paper === "year" ? <YearSheet plan={plan} y={y} now={now} who={plan.who} yearCount={year} pattern={pattern} certs={certs} /> : <>
        <div className="sheet">
          <div className="rot-head">
            <b>Rotation {y}{plan.who ? ` — ${plan.who}` : ""}</b>
            <span>{pattern.on} on / {pattern.off} off · {cycle}-day cycle</span>
            <span>printed {withYear(now)}</span>
          </div>
          <table className="rot-paper rot-figures">
            <tbody>
              {STATES.map((s) => (
                <tr key={s.key}>
                  <th>{s.mark}</th>
                  <td>{s.label}</td>
                  <td className="rot-n">{year[s.key]}</td>
                  <td className="rot-n">{share(year[s.key], year.days)}%</td>
                </tr>
              ))}
              <tr className="rot-sum">
                <th>🌍</th><td>Out of the country</td>
                <td className="rot-n">{year.abroad}</td>
                <td className="rot-n">{share(year.abroad, year.days)}%</td>
              </tr>
              <tr>
                <th>🏡</th><td>In the country</td>
                <td className="rot-n">{year.inCountry}</td>
                <td className="rot-n">{share(year.inCountry, year.days)}%</td>
              </tr>
            </tbody>
          </table>
          <p className="rot-rule">
            Days in the air {flights ? "are counted" : "are not counted"} as days out of the country.
            The {LINE}-day mark is a marker and not advice — where the line really falls is a
            question for an accountant.
          </p>
          <table className="rot-paper rot-months">
            <tbody>
              <tr>
                <th>Month</th><th className="rot-n">Aboard</th><th className="rot-n">Hotel</th>
                <th className="rot-n">Flying</th><th className="rot-n">Home</th><th className="rot-n">Out</th>
              </tr>
              {MONTHS.map((name, i) => (
                <tr key={name}>
                  <th>{name}</th>
                  <td className="rot-n">{months[i].aboard}</td>
                  <td className="rot-n">{months[i].hotel}</td>
                  <td className="rot-n">{months[i].travelling}</td>
                  <td className="rot-n">{months[i].home}</td>
                  <td className="rot-n">{months[i].abroad}</td>
                </tr>
              ))}
              <tr className="rot-sum">
                <th>{y}</th>
                <td className="rot-n">{year.aboard}</td>
                <td className="rot-n">{year.hotel}</td>
                <td className="rot-n">{year.travelling}</td>
                <td className="rot-n">{year.home}</td>
                <td className="rot-n">{year.abroad}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {sheets.map((some, i) => (
          <div className="sheet" key={`s${i}`}>
            <div className="rot-head">
              <b>The turns{plan.who ? ` — ${plan.who}` : ""}</b>
              <span>{pattern.on} on / {pattern.off} off</span>
              <span>printed {withYear(now)}</span>
            </div>
            <table className="rot-paper">
              <tbody>
                {some.map((t) => (
                  <tr key={t.n}>
                    <th>{t.n}</th>
                    <td className="rot-p-when">
                      <div><b>aboard</b> {shortDate(t.aboard.from)} — {shortDate(t.aboard.to)} · {t.aboard.days} d</div>
                      <div><b>home</b> {shortDate(t.home.from)} — {shortDate(t.home.to)} · {t.home.days} d</div>
                    </td>
                    <td className="rot-p-marks">
                      {t.moved ? <div><i>{t.moved > 0 ? `${t.moved} days late` : `${-t.moved} days early`}</i></div> : null}
                      {[...t.aboard.marks.map((mark) => [mark, "aboard"]), ...t.home.marks.map((mark) => [mark, "at home"])]
                        .sort((a, b) => (a[0].on < b[0].on ? -1 : 1))
                        .map(([mark, where]) => (
                          <div key={`${mark.on}${mark.what}`}>
                            {shortDate(mark.on)} · {mark.what} — {where}
                          </div>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {/* The dates get a sheet of their own rather than a footer on the last
            one. A footer grows with however many dates there are, and a sheet
            that grows past the page takes a blank one with it — so the thing
            that varies is kept where it cannot push anything off. */}
        <div className="sheet">
          <div className="rot-head">
            <b>Dates on this plan</b>
            <span>{pattern.on} on / {pattern.off} off</span>
            <span>printed {withYear(now)}</span>
          </div>
          <div className="rot-foot">
            {everyMark.length
              ? [...new Map(everyMark.map((mark) => [`${mark.on}${mark.what}`, mark])).values()]
                .map((mark) => (
                  <div key={`${mark.on}${mark.what}`}>
                    {withYear(mark.on)} · {mark.what}
                    {mark.note && mark.sort === "family" ? ` (${mark.note})` : ""}
                  </div>
                ))
              : <div>Nothing entered yet.</div>}
            <p>Planned, not promised — turns move.</p>
          </div>
        </div>
              </>}
      </div>
    </main>
  );
}

/**
 * The day-rate quadrant: how much of the year was spent out of the country,
 * against the mark, and against last year.
 */
function DayRate({ year, before, soFar, y, bar, flights }) {
  const over = year.abroad >= LINE;
  const delta = (key) => year[key] - before[key];
  const sign = (n) => (n === 0 ? "—" : `${n > 0 ? "+" : ""}${n}`);
  return (
    <>
      <div className="rota-kpi">
        <div>
          <div className="rota-k"><span aria-hidden="true">🌍</span> Out of the country</div>
          <div className="rota-big" style={{ color: over ? "var(--ok)" : "var(--warn)" }}>{year.abroad}</div>
          <div className="rota-s">{soFar} so far this year</div>
        </div>
        <div>
          <div className="rota-k"><span aria-hidden="true">⚓</span> Days aboard</div>
          <div className="rota-big" style={{ color: col("aboard") }}>{year.aboard}</div>
          <div className="rota-s">{(year.aboard / 12).toFixed(1)} a month</div>
        </div>
        <div>
          <div className="rota-k"><span aria-hidden="true">🏠</span> Days at home</div>
          <div className="rota-big" style={{ color: col("home") }}>{year.home}</div>
          <div className="rota-s">{(year.home / 12).toFixed(1)} a month</div>
        </div>
        <div>
          <div className="rota-k"><span aria-hidden="true">🏨</span> Nights in a hotel</div>
          <div className="rota-big" style={{ color: col("hotel") }}>{year.hotel}</div>
          <div className="rota-s">{share(year.hotel, year.abroad)}% of the time away</div>
        </div>
      </div>

      <div className="rota-gauge-wrap">
        {bar(year, 20)}
        <div className="rota-gauge-top">
          <span>Out of the country, {y}</span>
          <span>{year.abroad} / {year.days}</span>
        </div>
        <div className="rota-gauge">
          <i style={{ width: `${share(year.abroad, year.days)}%`, background: over ? "var(--ok)" : "var(--warn)" }} />
          <u style={{ left: `${(LINE / year.days) * 100}%` }} title={`${LINE} days`} />
        </div>
        <p className="rota-note">
          The {LINE}-day mark ·{" "}
          <b style={{ color: over ? "var(--ok)" : "var(--warn)" }}>
            {over ? `${year.abroad - LINE} over` : `${LINE - year.abroad} short`}
          </b>. Days in the air {flights ? "count" : "do not count"} towards it. A marker, not
          advice — where the line really falls is a question for an accountant.
        </p>
      </div>

      <table className="rota-table">
        <thead>
          <tr><th>Against last year</th><th>{y}</th><th>{y - 1}</th><th>Δ</th></tr>
        </thead>
        <tbody>
          {STATES.map((s) => (
            <tr key={s.key}>
              <td><span aria-hidden="true">{s.mark}</span> {s.label}</td>
              <td style={{ color: col(s.key) }}>{year[s.key]}</td>
              <td className="is-quiet">{before[s.key]}</td>
              <td style={{ color: delta(s.key) > 0 ? "var(--warn)" : delta(s.key) < 0 ? "var(--ok)" : "var(--ink-3)" }}>
                {sign(delta(s.key))}
              </td>
            </tr>
          ))}
          <tr className="is-total">
            <td><span aria-hidden="true">🌍</span> Out of the country</td>
            <td>{year.abroad}</td>
            <td>{before.abroad}</td>
            <td>{sign(year.abroad - before.abroad)}</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

/**
 * The UK salaried quadrant: the Seafarers' Earnings Deduction claim. Every number
 * is `engine/seatax.js`'s; `standing` carries the ledger forward to today. The
 * margin is in half-days and the days he may stay are twice it; both are labelled.
 */
function Salaried({ sea, ledger }) {
  if (sea.how === "asking") return <p className="rota-note">Working the claim out…</p>;
  if (sea.how === "absent") {
    return (
      <div className="rota-plain">
        <b>The claim is not worked out on this build.</b>
        <p className="rota-note">
          The Seafarers&rsquo; Earnings Deduction arithmetic lives in a module of its own, and this
          copy of the site does not carry it yet. Nothing else on the page is affected — switch back
          to <b>Day rate</b> for the days out of the country.
        </p>
      </div>
    );
  }
  if (ledger?.broken) {
    return (
      <div className="rota-plain">
        <b>The claim could not be worked out.</b>
        <p className="rota-note">{ledger.broken}</p>
      </div>
    );
  }
  const run = ledger?.run;
  const stand = ledger?.stand;
  if (!run || !run.claimStart) {
    return (
      <div className="rota-plain">
        <b>No claim period to count yet.</b>
        <p className="rota-note">
          A period starts the first time you leave the country. Set your pattern and your first day
          aboard in <b>Plan</b>, and this fills in.
        </p>
      </div>
    );
  }

  /* Today's figures where there are any, and the ledger's last landing where
     there are not — never a mixture presented as one. */
  const live = stand && !stand.before ? stand : run;
  const half = Number.isFinite(live.marginHalfDays) ? live.marginHalfDays : null;
  const stay = Number.isFinite(live.daysHeCanStay) ? live.daysHeCanStay : (half === null ? null : half * 2);
  const elapsed = Number.isFinite(live.total) ? live.total : run.totalDays;
  const broken = run.failed || live.failed;
  const leaveBy = live.failOn || ledger.leave || null;
  const inUk = stand ? stand.inUk : !run.away;
  const tight = half !== null && half <= 0;

  return (
    <>
      <div className="rota-kpi">
        <div>
          <div className="rota-k"><span aria-hidden="true">🇬🇧</span> Claim started</div>
          <div className="rota-big is-date">{withYear(run.claimStart)}</div>
          <div className="rota-s">{plural(elapsed, "day", "days")} ago</div>
        </div>
        <div>
          <div className="rota-k"><span aria-hidden="true">🏠</span> Days in the UK</div>
          <div className="rota-big" style={{ color: col("home") }}>{live.ukDays}</div>
          {/* Off the same elapsed total as the line above it. The ledger's own
              `outDays` stops at his last landing and would not add up with a
              figure carried forward to today. */}
          <div className="rota-s">{elapsed - live.ukDays} days out of it</div>
        </div>
        <div>
          <div className="rota-k"><span aria-hidden="true">⚖️</span> The half-day line</div>
          <div className="rota-big">{live.half}</div>
          <div className="rota-s">half of the {elapsed} days elapsed</div>
        </div>
        <div>
          <div className="rota-k"><span aria-hidden="true">{broken ? "⛔" : "✅"}</span> Standing</div>
          <div className="rota-big" style={{ color: broken ? "#FF9A9A" : "var(--ok)" }}>
            {broken ? "Broken" : run.qualifies ? "Good" : "Short"}
          </div>
          <div className="rota-s">
            {broken
              ? "the UK side won — the period is gone"
              : run.qualifies
                ? "a year long, and the test still passes"
                : `${plural(run.shortBy, "day", "days")} short of a year`}
          </div>
        </div>
      </div>

      {/* The two numbers that must never be read as one another. */}
      {/* Two halves of one panel: the margin and what it means on the
          left, the state of the claim on the right. Stacked, they are
          taller than any quadrant ever is. */}
      <div className="rota-half">
        <div className={`rota-margin${tight ? " is-tight" : ""}`}>
          <div>
            <span className="rota-k">Margin left</span>
            <b>{half === null ? "—" : half}</b>
            <em>half-days</em>
          </div>
          <span className="rota-margin-is" aria-hidden="true">=</span>
          <div>
            <span className="rota-k">Days you may stay</span>
            <b>{stay === null ? "—" : stay}</b>
            <em>calendar days</em>
          </div>
        </div>
        <p className="rota-note">
          The margin is counted in <b>half-days</b>. The number of <b>calendar days</b> you may
          actually spend in the UK is twice it —{" "}
          {half === null ? "no margin worked out yet" : plural(half, "half-day", "half-days")}
          {stay === null ? "" : ` is ${plural(stay, "calendar day", "calendar days")}`} at home.
        </p>
        {/* The sentence above is the one that has to be read; the mechanism
            under it is read once and then known. It folds so that the panel
            fits on a short screen without the figures giving up any room —
            and it opens by itself on paper, where there is no folding. */}
        {/* Beside the margin it is about, not under the list of dates: this is
            the sentence that says which way the number is moving, and the
            left column is the one with room for it. */}
        <p className="rota-note">
          {inUk
            ? "While you are at home the margin falls by half a day every day."
            : "While you are away the margin grows, so there is no date to put in a diary yet."}
        </p>
        <details className="rota-why">
          <summary>How the gap moves</summary>
          <p className="rota-note">
            A day in the UK adds one to the UK side and one to the elapsed side, so the gap closes
            at half a day per day; a day away buys it back at the same rate. Reading the half-days
            as calendar days is how a claim built over years is lost, which is why both are here.
          </p>
        </details>

      </div>
      <div className="rota-half">
        <div className="rota-rows">
          <div className="rota-row is-sum">
            <span aria-hidden="true">🛫</span>
            <span className="rota-lbl">
              {inUk ? "You must be out of the UK by" : "You are out of the country"}
            </span>
            <span className="rota-v is-date">{inUk && leaveBy ? withYear(leaveBy) : "—"}</span>
            <span className="rota-pc" />
          </div>
          <div className="rota-row">
            <span aria-hidden="true">🌍</span>
            <span className="rota-lbl">Days out to bring the margin back to nought</span>
            <span className="rota-v">{Number.isFinite(ledger.recover) ? ledger.recover : "—"}</span>
            <span className="rota-pc" />
          </div>
          <div className="rota-row">
            <span aria-hidden="true">🛏️</span>
            <span className="rota-lbl">Longest single spell at home</span>
            <span className="rota-v is-quiet">{run.longestUkSpell}</span>
            <span className="rota-pc">{run.spellOver183 ? "over 183" : ""}</span>
          </div>
          <div className="rota-row">
            <span aria-hidden="true">🧾</span>
            <span className="rota-lbl">Absences counted</span>
            <span className="rota-v is-quiet">{ledger.absences}</span>
            <span className="rota-pc" />
          </div>
        </div>
        {/* Where the number comes from and what it does not know. Folded for
            the same reason as the other one: the figures never give up room
            to prose, and prose read once does not need to sit there. */}
        <details className="rota-why">
          <summary>Where this comes from</summary>
          <p className="rota-note">
            Worked out from your rotation as it stands, back to {withYear(ledger.from)} and never
            past today — a margin is a fact about days already spent. The ports are not in a
            rotation, and an absence only counts if the voyage was to a foreign one: check them
            against your own record. A marker, not advice.
          </p>
        </details>
      </div>
    </>
  );
}

/** An amount in the currency he set, whole units, grouped. */
const money = (n, cur) => `${cur}${Math.round(n || 0).toLocaleString("en-GB")}`;

/**
 * What the days pay — this period, the year so far and the year as planned.
 * Worked out from the same days the calendar shows, so a turn that slips or
 * a day sold moves the money with it. Until a rate is set it says how to set
 * one, rather than showing noughts that look like an answer.
 */
function Pay({ month, year, soFar, label, y, onSet }) {
  if (!month.set) {
    return (
      <div className="rota-plain">
        <b>No rate set yet.</b>
        <p className="rota-note">Put in a day rate — or a salary and what a sold day pays — and this panel works out every month and the year from the rotation.</p>
        <button type="button" className="btn" onClick={onSet}>Set my pay</button>
      </div>
    );
  }
  const cur = month.currency;
  return (
    <>
      <div className="rota-kpi">
        <div><div className="rota-k">💷 {label}</div><div className="rota-big">{money(month.total, cur)}</div><div className="rota-s">{month.mode === "salary" ? "salary and days sold" : "by the day"}</div></div>
        {soFar && <div><div className="rota-k">📈 {y} so far</div><div className="rota-big">{money(soFar.total, cur)}</div><div className="rota-s">to today</div></div>}
        <div><div className="rota-k">🗓 {y} as planned</div><div className="rota-big">{money(year.total, cur)}</div><div className="rota-s">if nothing moves</div></div>
        <div><div className="rota-k">🔁 Days sold</div><div className="rota-big">{year.sold}</div><div className="rota-s">in {y}</div></div>
      </div>
      <div className="rota-half">
        <table className="rota-table">
          <thead><tr><th>{label}</th><th>Days</th><th>Pays</th></tr></thead>
          <tbody>
            {month.lines.map((l) => (
              <tr key={l.what}><td>{l.what}</td><td>{l.days ?? "—"}</td><td>{money(l.amount, cur)}</td></tr>
            ))}
            <tr className="is-total"><td>Total</td><td /><td>{money(month.total, cur)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="rota-half">
        <p className="rota-note">
          A sold day is a day the rotation had at home that you marked aboard — the calendar finds them, nothing to type.
          {" "}Travel and hotel days pay at their own rates. Planned, not promised.
        </p>
        <button type="button" className="rota-link" onClick={onSet}>Change the rates</button>
      </div>
    </>
  );
}


/**
 * A QR code for a phone to scan — the rotation, to open it or add it beside
 * one's own, or the calendar address, to subscribe. Drawn here from the
 * address, as a picture that needs no server; the library that draws it is
 * only fetched when one is asked for.
 */
function QrBox({ what, url, onClose }) {
  const [svg, setSvg] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    import("qrcode-generator").then(({ default: qrcode }) => {
      try {
        const q = qrcode(0, "L");
        q.addData(url, "Byte");
        q.make();
        if (alive) setSvg(q.createSvgTag({ cellSize: 4, margin: 3, scalable: true }));
      } catch {
        if (alive) setErr("This one is too long for a QR code — use the link instead.");
      }
    }).catch(() => alive && setErr("The QR code could not be drawn here."));
    const key = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => { alive = false; document.removeEventListener("keydown", key); };
  }, [url, onClose]);
  return (
    <div className="rota-help" role="dialog" aria-label="QR code" onClick={onClose}>
      <div className="rota-qr" onClick={(e) => e.stopPropagation()}>
        <header><b>{what === "feed" ? "Scan to subscribe" : "Scan to open this rotation"}</b>
          <button type="button" className="rota-x" onClick={onClose} aria-label="Close">✕</button></header>
        {svg ? <div className="rota-qr-img" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="rota-note">{err || "Drawing…"}</p>}
        <p className="rota-note">
          {what === "feed"
            ? "Point the phone's camera at it: the calendar asks to subscribe, and the rotation stays up to date on its own."
            : "Point a phone's camera at it and the rotation opens there. In their Plan they can add it beside their own, under Other rotations."}
        </p>
        <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(url)}>Copy the link</button>
      </div>
    </div>
  );
}

/**
 * The year on one sheet of A4, the way a wall planner is: twelve months, each
 * day with a letter for where he is. Letters and not colours, because the
 * page prints the way a print dialog prints — backgrounds off — and a planner
 * that only reads in colour comes out of a printer blank.
 */
function YearSheet({ plan, y, now, who, yearCount, pattern, certs }) {
  const LETTER = { aboard: "A", hotel: "H", out: "T", back: "T", home: "" };
  const states = statesAcross(plan, `${y}-01-01`, `${y}-12-31`);
  const marks = new Set(marksOf(plan, `${y}-01-01`, `${y}-12-31`, { certificates: certs }).map((mk) => mk.on));
  const start = monthStart(y, 0);
  return (
    <div className="sheet rot-yearsheet">
      <div className="rot-head">
        <b>{y}{who ? ` — ${who}` : ""}</b>
        <span>{pattern.on} on / {pattern.off} off</span>
        <span>{yearCount.aboard} aboard · {yearCount.home} home · {yearCount.abroad} out of the country</span>
        <span>printed {fmt(now, { day: "numeric", month: "short", year: "numeric" })}</span>
      </div>
      <div className="rot-ygrid">
        {MONTHS.map((name, mi) => {
          const first = monthStart(y, mi);
          const lead = weekday(first);
          const len = monthLength(y, mi);
          return (
            <div className="rot-ym" key={name}>
              <b>{name}</b>
              <div className="rot-ydays">
                {DOW.map((d) => <i key={d}>{d[0]}</i>)}
                {Array.from({ length: lead }, (u, k) => <span key={`b${k}`} />)}
                {Array.from({ length: len }, (u, k) => {
                  const idx = first - start + k;
                  const st = states[idx];
                  const iso = isoOf(first + k);
                  return (
                    <span key={k} className={`is-${st}`}>
                      <small>{k + 1}{marks.has(iso) ? "•" : ""}</small>
                      <em>{LETTER[st]}</em>
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="rot-key"><b>A</b> aboard · <b>T</b> travelling · <b>H</b> hotel · blank at home · • something on the day · planned, not promised</p>
    </div>
  );
}

/* Where each calendar service keeps the address a calendar can be read from,
   in the words its own settings use, and the only address it can be. */
const PROVIDERS = {
  google: {
    mark: "🟦", name: "Google", color: "#4285F4",
    host: /^(https|webcal):\/\/calendar\.google\.com\//i,
    example: "https://calendar.google.com/calendar/ical/…/basic.ics",
    steps: [
      <>Open <a href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noreferrer">Google Calendar → Settings</a> on a computer.</>,
      <>On the left, under <b>Settings for my calendars</b>, click the calendar.</>,
      <>Scroll to <b>Integrate calendar</b> and copy <b>Secret address in iCal format</b>.</>,
    ],
  },
  outlook: {
    mark: "🟧", name: "Outlook", color: "#0F6CBD",
    host: /^(https|webcal):\/\/outlook\.(office365|live)\.com\//i,
    example: "https://outlook.office365.com/owa/calendar/…/calendar.ics",
    steps: [
      <>Open <a href="https://outlook.live.com/calendar/0/options/calendar/SharedCalendars" target="_blank" rel="noreferrer">Outlook → Settings → Calendar → Shared calendars</a>.</>,
      <>Under <b>Publish a calendar</b>, pick the calendar and <b>Can view all details</b>, then <b>Publish</b>.</>,
      <>Copy the <b>ICS</b> link.</>,
    ],
  },
  apple: {
    mark: "⬜", name: "Apple", color: "#FF3B30",
    host: /^(https|webcal):\/\/p\d+-cal(dav|endars?)\.icloud\.com\//i,
    example: "webcal://p01-caldav.icloud.com/published/2/…",
    steps: [
      <>On an iPhone, open <b>Calendar</b> and tap <b>Calendars</b> at the bottom.</>,
      <>Tap <b>ⓘ</b> beside the calendar and turn on <b>Public Calendar</b>.</>,
      <>Tap <b>Share Link…</b> and copy it (it starts webcal://).</>,
    ],
  },
};

/**
 * A calendar he keeps elsewhere (Google, Outlook or Apple), read-only by its
 * address and fetched again on every visit. The address stays in his own plan:
 * not in a shared link, a QR code or the feed he gives out.
 */
function CalendarLink({ provider, plan, status, onAdd, onRemove, onRefresh, onClose }) {
  const P = PROVIDERS[provider] || PROVIDERS.google;
  const [url, setUrl] = useState("");
  const [name, setName] = useState(P.name);
  const COLORS = [P.color, "#0B8043", "#E67C73", "#F6BF26", "#8E24AA", "#039BE5"];
  const [color, setColor] = useState(COLORS[0]);
  const ok = P.host.test(url.trim());
  useEffect(() => {
    const key = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="rota-help" role="dialog" aria-label={`Import from ${P.name}`} onClick={onClose}>
      <div className="rota-glink" onClick={(e) => e.stopPropagation()}>
        <header><b>{P.mark} Import from {P.name}</b>
          <button type="button" className="rota-x" onClick={onClose} aria-label="Close">✕</button></header>

        {(plan.linked || []).length > 0 && (
          <ul className="rota-glist">
            {plan.linked.map((c) => {
              const st = status[c.id] || {};
              return (
                <li key={c.id}>
                  <i style={{ background: c.color }} />
                  <span><b>{c.name}</b>
                    <em>{st.busy ? "fetching…" : st.error ? `⚠ ${st.error}` : st.events ? `${st.events.length} events · synced ${fmt(st.at.slice(0, 10), { day: "numeric", month: "short" })} ${st.at.slice(11, 16)}` : "not fetched yet"}</em></span>
                  <button type="button" className="rota-link" onClick={onRefresh}>Refresh</button>
                  <button type="button" className="rota-link" onClick={() => onRemove(c.id)}>Remove</button>
                </li>
              );
            })}
          </ul>
        )}

        <ol className="rota-steps">
          {P.steps.map((st, i) => <li key={i}>{st}</li>)}
          <li>Paste it below. It stays in your account only.</li>
        </ol>
        <form className="rota-gform" onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          onAdd({ id: `g${Date.now().toString(36)}`, name: name.trim() || P.name, url: url.trim(), color, provider });
          setUrl("");
        }}>
          <input type="url" value={url} placeholder={P.example} autoFocus
            onChange={(e) => setUrl(e.target.value)} aria-label={`${P.name} calendar address`} />
          {url && !ok && <p className="rota-note is-bad">That is not a calendar address from {P.name} — it should look like {P.example}</p>}
          <div className="rota-gform-row">
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" placeholder="Name" />
            <div className="rota-swatches" role="radiogroup" aria-label="Colour">
              {COLORS.map((c) => (
                <button type="button" key={c} role="radio" aria-checked={color === c} style={{ background: c }}
                  onClick={() => setColor(c)} aria-label={c} />
              ))}
            </div>
            <button type="submit" className="rota-add" disabled={!ok}>Add</button>
          </div>
        </form>
        <p className="rota-note">Its events show on this calendar in their own colour and update on every visit. To change one, change it in {P.name}.</p>
      </div>
    </div>
  );
}

/**
 * The holidays, offered — never assumed. The calendar starts with nothing on
 * it; this lists the holidays of the country he calls home, each one ticked
 * or not by him, and only what he adds goes on. "No thanks" is an answer too,
 * and the suggestion is not offered again.
 */
function HolidayPick({ plan, y, onAnswer, onClose }) {
  const [country, setCountry] = useState(plan.holidays?.country || "BR");
  const list = holidaySuggestions({ ...plan, holidays: { ...(plan.holidays || {}), country } }, y);
  const [picked, setPicked] = useState(() => new Set((plan.holidays?.take || [])));
  const toggle = (w) => setPicked((p) => { const n = new Set(p); if (n.has(w)) n.delete(w); else n.add(w); return n; });
  const names = list.map((h) => h.what).filter((w) => picked.has(w));
  useEffect(() => {
    const key = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="rota-help" role="dialog" aria-label="Holidays" onClick={onClose}>
      <div className="rota-glink" onClick={(e) => e.stopPropagation()}>
        <header><b>💡 Holidays — a suggestion</b>
          <button type="button" className="rota-x" onClick={onClose} aria-label="Close">✕</button></header>
        <p className="rota-note">Nothing is on your calendar until you choose it. Tick the ones you want; they come round every year.</p>
        <label className="field"><span>Where home is</span>
          <select value={country} onChange={(e) => { setCountry(e.target.value); setPicked(new Set()); }}>
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select></label>
        <ul className="rota-hols">
          {list.map((h) => (
            <li key={h.what}>
              <label>
                <input type="checkbox" checked={picked.has(h.what)} onChange={() => toggle(h.what)} />
                <span>{h.what}</span>
                <em>{fmt(h.on, { weekday: "short", day: "numeric", month: "short" })}{h.observed ? " · not a national holiday" : ""}</em>
              </label>
            </li>
          ))}
        </ul>
        <div className="rota-add-row">
          <button type="button" className="rota-link" onClick={() => setPicked(picked.size === list.length ? new Set() : new Set(list.map((h) => h.what)))}>
            {picked.size === list.length ? "Untick all" : "Tick all"}</button>
          <span style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn" onClick={() => onAnswer([], "No holidays added.", country)}>No thanks</button>
            <button type="button" className="rota-add" disabled={!names.length}
              onClick={() => onAnswer(names, `${plural(names.length, "holiday", "holidays")} added.`, country)}>Add {names.length || ""}</button>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Clearing the calendar: a question that says exactly what will go and how
 * many of each, because it takes off many things at once — the one kind of
 * delete that gets a confirmation here rather than only an Undo afterwards.
 * Each kind can be left on. The rotation itself is kept unless it is ticked
 * too.
 */
function ClearAsk({ plan, onClear, onClose }) {
  const has = clearable(plan);
  const KINDS = [
    ["events", "Events", has.events], ["days", "Days you changed by hand", has.days], ["notes", "Notes on days", has.notes],
    ["slips", "Turns that slipped", has.slips], ["holidays", "Holidays you added", has.holidays],
    ["linked", "Imported calendars (Google, Outlook, Apple)", has.linked], ["others", "Other people's rotations", has.others],
    ["hitches", "Hitches you confirmed", has.hitches],
  ];
  const [what, setWhat] = useState(() => Object.fromEntries(KINDS.map(([k, , n]) => [k, n > 0])));
  const [rotation, setRotation] = useState(false);
  const n = KINDS.reduce((sum, [k, , c]) => sum + (what[k] ? c : 0), 0) + (rotation ? 1 : 0);
  useEffect(() => {
    const key = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="rota-help" role="dialog" aria-label="Clear the calendar" onClick={onClose}>
      <div className="rota-glink" onClick={(e) => e.stopPropagation()}>
        <header><b>🧹 Clear my calendar</b>
          <button type="button" className="rota-x" onClick={onClose} aria-label="Close">✕</button></header>
        <p className="rota-note">Untick anything you want to keep.</p>
        <ul className="rota-hols rota-clear">
          {KINDS.map(([k, label, c]) => (
            <li key={k}>
              <label className={c ? "" : "is-empty"}>
                <input type="checkbox" checked={Boolean(what[k])} disabled={!c}
                  onChange={() => setWhat((w) => ({ ...w, [k]: !w[k] }))} />
                <span>{label}</span><em>{c ? `${c} on the calendar` : "none"}</em>
              </label>
            </li>
          ))}
          <li className="is-wide">
            <label>
              <input type="checkbox" checked={rotation} onChange={() => setRotation((v) => !v)} />
              <span>Also remove the rotation itself</span>
              <em>no pattern at all: the calendar is blank until you set one again</em>
            </label>
          </li>
        </ul>
        <div className="rota-add-row">
          <span className="rota-note">You can undo this straight after, and deleted events stay in the bin for 30 days.</span>
          <span style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn is-danger" disabled={!n}
              onClick={() => onClear({ ...what, rotation }, n)}>{n ? `Clear ${plural(n, "thing", "things")}` : "Nothing to clear"}</button>
          </span>
        </div>
      </div>
    </div>
  );
}
