/**
 * Rotation projection. Only the pattern, the anchor day and the turns that moved
 * are stored; the projection is always recomputed so it never goes stale.
 *
 * All arithmetic is on whole UTC day numbers: a local Date crosses DST and gives a
 * 27-day turn once a year, and `new Date("2026-03-14")` is UTC midnight while
 * `new Date("2026-03-14T00:00:00")` is local midnight, a day apart by hemisphere.
 */
import { holidaysIn } from "./holidays.js";

/** An ISO day as a whole number of days, parsed by slicing and never by Date. */
export const dayOf = (iso) =>
  Date.UTC(+String(iso).slice(0, 4), +String(iso).slice(5, 7) - 1, +String(iso).slice(8, 10)) / 864e5;

/** A whole UTC day number back to an ISO day. */
export const isoOf = (day) => new Date(day * 864e5).toISOString().slice(0, 10);

/** What a rotation starts as: the commonest one, from today. */
export const BLANK_PLAN = {
  v: 1,
  who: "",
  /* `hotelOut`, `hotelBack` and `travel` are nought until filled in, so a plan without them behaves as before. */
  /* No rotation until he sets one: a pre-filled 28/28 would count days that are not his.
     `patternOf` still offers 28/28 as the suggestion the fields start from. */
  pattern: null,
  anchor: new Date().toISOString().slice(0, 10),
  horizon: 8,
  slips: {},
  /* Days he has told the site about, ISO date to state, only where they differ from the
     projection: a fact beats the pattern, but only on its own day, so this stays sparse. */
  days: {},
  dates: [],
  holidays: { country: "BR", own: [] },
};

const whole = (n, fallback) => (Number.isFinite(+n) && +n > 0 ? Math.round(+n) : fallback);
const spare = (n) => (Number.isFinite(+n) && +n > 0 ? Math.round(+n) : 0);

/**
 * The five kinds of day, in the order a turn runs through them. Hotel nights are kept
 * apart from ship and home because a tax year turns on them. Each state has a word and
 * a mark as well as a colour, since the page prints with backgrounds off.
 */
export const STATES = [
  { key: "out", label: "Travelling out", short: "Out", mark: "✈️", away: true },
  { key: "hotel", label: "In a hotel", short: "Hotel", mark: "🏨", away: true },
  { key: "aboard", label: "Aboard", short: "Aboard", mark: "⚓", away: true },
  { key: "back", label: "Travelling home", short: "Back", mark: "🛬", away: true },
  { key: "home", label: "At home", short: "Home", mark: "🏠", away: false },
];
export const STATE = Object.fromEntries(STATES.map((s) => [s.key, s]));
/* A day nothing says anything about (before the rotation, or none set): counted nowhere,
   drawn blank, never home by default. It is in the map so a lookup finds a word for it. */
STATE.none = { key: "none", label: "Not planned", short: "", mark: "", away: false };

/** The rotation offered when none is set: the commonest one, as a suggestion
 *  the fields start from — never on the calendar until he says so. */
export const SUGGESTED = { on: 28, off: 28, hotelOut: 0, hotelBack: 0, travel: 0 };

/** Whether the plan has a rotation — a pattern he set and the day it starts. */
export const hasRotation = (plan) => Boolean(plan?.pattern && plan?.anchor);

/** The pattern with every optional count filled in, nought where it is absent. */
export function patternOf(plan = BLANK_PLAN) {
  const p = plan?.pattern || {};
  return {
    on: whole(p.on, 28),
    off: whole(p.off, 28),
    hotelOut: spare(p.hotelOut ?? plan?.hotelOut),
    hotelBack: spare(p.hotelBack ?? plan?.hotelBack),
    travel: spare(p.travel ?? plan?.travel),
  };
}

/**
 * Sailing day to sailing day, which is not the sum of the parts: the outbound hotel night
 * and flight come out of the time at home, while the return ones push it along (a 28/28
 * with a night and a flight each way is 58 days, not 60).
 */
export const cycleOf = (plan = BLANK_PLAN) => {
  const p = patternOf(plan);
  return p.on + p.hotelBack + p.travel + p.off;
};

/**
 * One turn laid out from its days aboard: the way out is carved out of the days at home
 * before it, the way back pushes them along.
 */
function turnAt({ hotelOut = 0, hotelBack = 0, travel = 0 }, from, to, homeDays) {
  const lodgedTo = to + hotelBack;
  const flownTo = lodgedTo + travel;
  const homeFrom = flownTo + 1;
  const homeTo = homeFrom + homeDays - 1;
  const legs = [
    { state: "out", first: from - hotelOut - travel, last: from - hotelOut - 1 },
    { state: "hotel", first: from - hotelOut, last: from - 1 },
    { state: "aboard", first: from, last: to },
    { state: "hotel", first: to + 1, last: lodgedTo },
    { state: "back", first: lodgedTo + 1, last: flownTo },
    { state: "home", first: homeFrom, last: homeTo },
  ]
    .filter((l) => l.last >= l.first)
    .map((l) => ({
      state: l.state, from: isoOf(l.first), to: isoOf(l.last), days: l.last - l.first + 1,
    }));
  return {
    aboard: { from: isoOf(from), to: isoOf(to), days: to - from + 1, marks: [] },
    home: { from: isoOf(homeFrom), to: isoOf(homeTo), days: homeTo - homeFrom + 1, marks: [] },
    legs,
  };
}

export function turnsOf(plan = BLANK_PLAN, { count } = {}) {
  if (!hasRotation(plan)) return [];
  const { on, off, hotelOut, hotelBack, travel } = patternOf(plan);
  const cycle = on + hotelBack + travel + off;
  const start = dayOf(plan?.anchor || BLANK_PLAN.anchor);
  const many = whole(count ?? plan?.horizon, 8);
  const slips = plan?.slips || {};

  const out = [];
  let next = start;
  for (let n = 1; n <= many; n += 1) {
    const slip = slips[String(n)] || {};
    const from = slip.from ? dayOf(slip.from) : next;
    const to = slip.to ? dayOf(slip.to) : from + on - 1;
    const turn = turnAt({ hotelOut, hotelBack, travel }, from, to, off);
    out.push({
      n,
      ...turn,
      /* Against the untouched pattern, not against the turn before it. */
      moved: from - (start + (n - 1) * cycle),
      slipped: Boolean(slip.from || slip.to),
    });
    next = dayOf(turn.home.to) + 1;
  }
  return out;
}

/** The same rotation with every slip ignored — what the contract says. */
export const cleanTurns = (plan, count) =>
  turnsOf({ ...plan, slips: {} }, { count });

/** The day-of-year part of a date written either way. */
const dayAndMonth = (on) => (String(on).length > 5 ? String(on).slice(5) : String(on));

/**
 * Everything worth seeing against the turns, between two days: family dates, holidays and
 * certificate expiries, kept apart because only some of them can be fixed from a vessel.
 */
export function marksOf(plan = BLANK_PLAN, fromIso, toIso, { certificates = [] } = {}) {
  const first = dayOf(fromIso);
  const last = dayOf(toIso);
  const years = [];
  for (let y = +fromIso.slice(0, 4); y <= +toIso.slice(0, 4); y += 1) years.push(y);

  const out = [];
  const keep = (on, what, sort, note = "", id = "") => {
    const day = dayOf(on);
    if (day >= first && day <= last) out.push({ on, what, sort, note, ...(id ? { id } : {}) });
  };

  for (const d of plan?.dates || []) {
    if (!d?.on || !d?.what) continue;
    /* Days after the first one it runs, nought for a single day. Capped at a year: an end
       typed into the wrong century is a typo, not four hundred thousand marks. */
    const span = spanOf(d);
    const each = (start, note) => {
      for (let k = 0; k <= span; k += 1) {
        keep(isoOf(dayOf(start) + k), d.what, "family",
          span ? `${note ? `${note} · ` : ""}${k + 1}/${span + 1}` : note, d.id);
      }
    };
    if (d.every === "once" && String(d.on).length > 5) { each(d.on, ""); continue; }
    if (d.every === "repeat") { for (const s of repeatStarts(d, fromIso, toIso)) each(s, ""); continue; }
    const md = dayAndMonth(d.on);
    /* A birthday whose year is known can say how old, and one whose year is
       not is never made to invent one. */
    const born = String(d.on).length > 5 ? +String(d.on).slice(0, 4) : null;
    /* A yearly stretch that starts in December and ends in January belongs
       to the year it started in, so the year before the window is asked too. */
    for (const y of (span ? [years[0] - 1, ...years] : years).filter((yy) => comesIn(d, yy))) {
      /* An age is for a birthday, not for a fortnight that comes round. */
      each(`${y}-${md}`, born && !span ? `${y - born}` : "");
    }
  }

  /* Only the holidays he accepted: the country's are offered as suggestions and none
     shows until he says yes to it. */
  const country = plan?.holidays?.country || "BR";
  const taken = new Set(plan?.holidays?.take || []);
  for (const y of years) {
    for (const h of holidaysIn(country, y)) {
      if (taken.has(h.what)) keep(h.on, h.what, "holiday", h.observed ? "observed" : "");
    }
  }
  for (const h of plan?.holidays?.own || []) {
    if (h?.on && h?.what) keep(h.on, h.what, "holiday");
  }

  for (const c of certificates) {
    if (!c?.expires || !c?.what) continue;
    keep(c.expires, `${c.what} expires`, "certificate");
  }

  return out.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : a.what < b.what ? -1 : 1));
}

/**
 * Each mark put where it falls. A date on a stretch's first or last day is inside it,
 * once: every mark lands in exactly one place.
 */
export function landing(turns, marks) {
  const inside = (block, day) => day >= dayOf(block.from) && day <= dayOf(block.to);
  return turns.map((t) => {
    const aboard = [];
    const home = [];
    for (const m of marks) {
      const day = dayOf(m.on);
      if (inside(t.aboard, day)) aboard.push(m);
      else if (inside(t.home, day)) home.push(m);
    }
    return { ...t, aboard: { ...t.aboard, marks: aboard }, home: { ...t.home, marks: home } };
  });
}

/** The next time he goes out or comes back, and how far off it is. */
export function nextChange(turns, todayIso) {
  const today = dayOf(todayIso);
  for (const t of turns) {
    const out = dayOf(t.aboard.from);
    if (out >= today) return { kind: "fly out", on: t.aboard.from, inDays: out - today, turn: t.n };
    const back = dayOf(t.home.from);
    if (back >= today) return { kind: "fly home", on: t.home.from, inDays: back - today, turn: t.n };
  }
  return null;
}

/** The turns cut into printed sheets. */
export const sheetsOf = (turns, perSheet) => {
  const each = whole(perSheet, 8);
  const out = [];
  for (let i = 0; i < turns.length; i += each) out.push(turns.slice(i, i + each));
  return out;
};

const middle = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[half] : Math.round((sorted[half - 1] + sorted[half]) / 2);
};

/**
 * A pattern read off the saved trips. Medians, not averages, so one trip cut short does
 * not redefine the rotation; two trips is the minimum (one has no gap after it to measure).
 */
export function guessPattern(trips = []) {
  const clean = trips
    .filter((t) => t?.start && t?.end && dayOf(t.end) >= dayOf(t.start))
    .sort((a, b) => dayOf(a.start) - dayOf(b.start));
  if (clean.length < 2) return { ...SUGGESTED, anchor: BLANK_PLAN.anchor, from: clean.length };

  const on = middle(clean.map((t) => dayOf(t.end) - dayOf(t.start) + 1));
  const gaps = [];
  for (let i = 1; i < clean.length; i += 1) gaps.push(dayOf(clean[i].start) - dayOf(clean[i - 1].end) - 1);
  const off = middle(gaps) ?? 28;
  const last = clean[clean.length - 1];
  return { on, off, anchor: isoOf(dayOf(last.end) + off + 1), from: clean.length };
}

/** The first day of a month, and how many days it has, in UTC day numbers. */
export const monthStart = (y, m) => Date.UTC(y, m, 1) / 864e5;
export const monthLength = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/**
 * The projection reaching back far enough to cover past days: the anchor is stepped back
 * by whole cycles (never a guessed number of days) with the slips carried along, so turn
 * numbers keep their meaning (the anchor is turn 1, earlier ones nought and below).
 */
export function turnsAcross(plan = BLANK_PLAN, fromIso, toIso) {
  const hs = hitchesOf(plan);
  const rota = hasRotation(plan);
  if (!hs.length && !rota) return [];
  const p = rota ? patternOf(plan) : { on: 1, off: 0, hotelOut: 0, hotelBack: 0, travel: 0 };
  const to = dayOf(toIso);
  const out = [];

  /* His hitches, as they happened. Home after each one runs to the next one;
     after the last, it is in proportion to the days he was aboard. */
  hs.forEach((h, i) => {
    const a = dayOf(h.from);
    const b = dayOf(h.to);
    const next = hs[i + 1];
    const backEnd = b + p.hotelBack + p.travel;
    const home = next ? Math.max(0, dayOf(next.from) - 1 - backEnd) : offAfter(plan, h);
    out.push({ n: i + 1, ...turnAt(p, a, b, home), moved: 0, slipped: false, hitch: h.id, confirmed: true,
      off: home, ownOff: next ? false : Number.isFinite(h.off) });
  });

  /* And the rotation's suggestions after them — from the last hitch when there
     is one, so a hitch four days long pushes every turn behind it four days
     and more; from the rotation's first day when there is none. */
  if (rota && plan?.suggest !== false) {
    const cycle = cycleOf(plan);
    const last = out[out.length - 1];
    const start = last ? dayOf(last.home.to) + 1 : dayOf(plan.anchor);
    /* Capped: a thousand-year window is a bug upstream, not a reason to generate turns. */
    const many = Math.min(2000, Math.max(1, Math.ceil((to - start + 1) / cycle) + 1));
    const base = last
      ? turnsOf({ ...plan, anchor: isoOf(start), slips: {} }, { count: many })
      : turnsOf(plan, { count: many });
    const dismissed = new Set(plan?.dismissed || []);
    for (const t of base) {
      const no = dismissed.has(t.aboard.from);
      out.push({
        ...t, n: out.length + 1, suggested: true, dismissed: no,
        /* A suggestion turned down is days at home, not days nobody knows. */
        ...(no ? { legs: [{ state: "home", from: t.legs[0].from, to: t.home.to, days: dayOf(t.home.to) - dayOf(t.legs[0].from) + 1 }] } : {}),
      });
    }
  }
  const from = dayOf(fromIso);
  return out.filter((t) => dayOf(t.home.to) >= from - cycleOf(plan) && dayOf(t.legs[0].from) <= to);
}

/**
 * The hitches he confirmed — a suggestion accepted, a stretch aboard he set,
 * or one moved to where it really was — in order. Each is its days aboard, and
 * `off` when he set the days at home after it himself.
 */
export function hitchesOf(plan) {
  const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
  return (plan?.hitches || [])
    .filter((h) => h?.id && ok(h.from) && ok(h.to) && h.to >= h.from && dayOf(h.to) - dayOf(h.from) <= 365)
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/**
 * The days at home after a hitch. In proportion to the days aboard, the way
 * the rotation has them — 32 days on a 28/28 earns 32 off, 21 earns 21, and a
 * 28/14 gives half — unless he set them himself, more or fewer.
 */
export function offAfter(plan, h) {
  if (Number.isFinite(h?.off) && h.off >= 0) return Math.round(h.off);
  if (!hasRotation(plan)) return 0;
  const p = patternOf(plan);
  const days = dayOf(h.to) - dayOf(h.from) + 1;
  return Math.max(0, Math.round((days * p.off) / p.on));
}

/**
 * A stretch aboard set as a hitch — accepting a suggestion, moving one, or
 * saying he was aboard. Any hitch it overlaps is replaced by it: two hitches
 * cannot share a day. The days he had told the calendar one by one inside it
 * go, since the hitch now says them.
 */
export function withHitch(plan = BLANK_PLAN, fromIso, toIso, id = `h${fromIso}`) {
  let a = fromIso;
  let b = toIso || fromIso;
  if (b < a) [a, b] = [b, a];
  const kept = (plan.hitches || []).filter((h) => h.id !== id && (h.to < a || h.from > b));
  const was = (plan.hitches || []).find((h) => h.id === id);
  const days = { ...(plan.days || {}) };
  for (const iso of Object.keys(days)) if (iso >= a && iso <= b && days[iso] === "aboard") delete days[iso];
  return { ...plan, days, hitches: [...kept, { id, from: a, to: b, ...(Number.isFinite(was?.off) ? { off: was.off } : {}) }] };
}

/** A hitch changed: its days, or the days at home after it (`off`, or null
 *  to go back to the proportional ones). */
export function changeHitch(plan = BLANK_PLAN, id, patch) {
  return {
    ...plan,
    hitches: (plan.hitches || []).map((h) => {
      if (h.id !== id) return h;
      const next = { ...h, ...patch };
      if (patch.off === null) delete next.off;
      if (next.to < next.from) [next.from, next.to] = [next.to, next.from];
      return next;
    }),
  };
}

/** A hitch taken off. The rotation's suggestions take its place again. */
export const dropHitch = (plan = BLANK_PLAN, id) =>
  ({ ...plan, hitches: (plan.hitches || []).filter((h) => h.id !== id) });

/** One suggestion turned down, by its first day aboard. */
export const dismissTurn = (plan = BLANK_PLAN, fromIso) =>
  ({ ...plan, dismissed: [...new Set([...(plan.dismissed || []), fromIso])] });

/** Every suggestion taken off the calendar, or put back. His hitches stay. */
export const withSuggestions = (plan = BLANK_PLAN, on) =>
  ({ ...plan, suggest: Boolean(on), ...(on ? { dismissed: [] } : {}) });

/**
 * The turns to show from today: the one he is in or last came back from, and
 * the ones after it — his hitches and the suggestions — as many as the plan's
 * horizon asks for.
 */
export function turnsFrom(plan = BLANK_PLAN, todayIso, count) {
  const many = whole(count ?? plan?.horizon, 8);
  const first = hitchesOf(plan)[0]?.from || plan?.anchor;
  if (!first) return [];
  const cycle = cycleOf(plan);
  const all = turnsAcross(plan, first, isoOf(Math.max(dayOf(first), dayOf(todayIso)) + cycle * (many + 1)))
    .filter((t) => !t.dismissed);
  const at = Math.max(0, all.findIndex((t) => t.home.to >= todayIso));
  return all.slice(at, at + many);
}

/**
 * The state of each day of a window, one entry per day. An unclaimed day is `none`, not
 * home. Everything below counts off this one array, so nothing can disagree about a day.
 */
export function statesAcross(plan = BLANK_PLAN, fromIso, toIso) {
  const from = dayOf(fromIso);
  const to = dayOf(toIso);
  const days = Math.max(0, to - from + 1);
  const out = new Array(days).fill("none");
  if (!days) return out;
  for (const leg of turnsAcross(plan, fromIso, toIso).flatMap((t) => t.legs)) {
    const first = Math.max(from, dayOf(leg.from));
    const last = Math.min(to, dayOf(leg.to));
    for (let d = first; d <= last; d += 1) out[d - from] = leg.state;
  }
  /* Told days go last and win. They are applied here, not in the calendar, so the count,
     the runs, the absences and the tax claim all read the same array. */
  for (const [iso, state] of Object.entries(plan?.days || {})) {
    if (!STATE[state] || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) continue;
    const d = dayOf(iso);
    if (d >= from && d <= to) out[d - from] = state;
  }
  return out;
}

/**
 * Whether a yearly date comes round in a given year. It can have been taken
 * out of one year ("only this one" deleted), stopped from a year on ("this
 * and following"), or begun in a year (the second half of a series that was
 * split). A date with none of those comes round every year, as it always did.
 */
export function comesIn(d, y) {
  if ((d.skip || []).includes(y)) return false;
  if (d.first && y < d.first) return false;
  if (d.last && y > d.last) return false;
  return true;
}

/** How many days after its first a date runs — nought for a single day. */
export function spanOf(d) {
  if (!d?.until || String(d.on).length <= 5) return 0;
  const n = dayOf(d.until) - dayOf(d.on);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 365) : 0;
}

const weekdayOf = (day) => new Date(day * 864e5).getUTCDay();

/** A repeat's rule moved by some days: its last day with it, and the weekdays
 *  of a weekly one — every Monday moved a day on is every Tuesday. */
const shiftRepeat = (r, shift) => (!r ? r : {
  ...r,
  ...(r.until ? { until: isoOf(dayOf(r.until) + shift) } : {}),
  ...(r.freq === "week" && (r.days || []).length ? { days: r.days.map((w) => (((w + shift) % 7) + 7) % 7) } : {}),
});

/**
 * The days a repeating event starts on, between two dates. `d.repeat` is the rule: `freq`
 * (day, week, month or year), every `n`, weekdays `days` for a weekly one (Sunday nought),
 * and a stop by `until` or `count`; `d.ex` are single days taken out. An occurrence already
 * running into `fromIso` is included, and a month without the day (31 February) is skipped.
 */
export function repeatStarts(d, fromIso, toIso) {
  const r = d?.repeat;
  if (!r || !d.on || String(d.on).length <= 5) return [];
  const span = spanOf(d);
  const lo = dayOf(fromIso);
  const hi = dayOf(toIso);
  const step = Math.max(1, Math.round(+r.n || 1));
  const until = r.until ? dayOf(r.until) : Infinity;
  const count = r.count ? Math.round(+r.count) : Infinity;
  const ex = new Set(d.ex || []);
  const start = dayOf(d.on);
  const got = [];
  let n = 0;
  /* With no count to keep, the walk starts near the window rather than at the
     first occurrence: a daily event begun ten years ago is not ten years of
     steps to find this month. */
  const period = r.freq === "day" ? step : r.freq === "week" ? 7 * step : 0;
  let k = count === Infinity && period ? Math.max(0, Math.floor((lo - span - start) / period) - 1) : 0;
  for (let guard = 0; n < count && guard < 5000; guard += 1, k += 1) {
    let cands = [];
    if (r.freq === "day") cands = [start + k * step];
    else if (r.freq === "week") {
      const monday = start - ((weekdayOf(start) + 6) % 7) + k * 7 * step;
      const days = (r.days || []).length ? r.days : [weekdayOf(start)];
      cands = days.map((w) => monday + ((w + 6) % 7)).filter((c) => c >= start).sort((a, b) => a - b);
    } else if (r.freq === "month" || r.freq === "year") {
      const d0 = new Date(start * 864e5);
      const months = r.freq === "month" ? k * step : k * 12 * step;
      const at = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + months, d0.getUTCDate());
      if (new Date(at).getUTCDate() === d0.getUTCDate()) cands = [at / 864e5];
      else if (at / 864e5 > hi) break;
    } else break;
    let stop = false;
    for (const c of cands) {
      if (c > until || n >= count || c > hi) { stop = true; break; }
      n += 1;
      if (c + span >= lo && !ex.has(isoOf(c))) got.push(isoOf(c));
    }
    if (stop) break;
  }
  return got;
}

/** How a repeat reads, in words: "every week on Mon and Thu", "every 2 days". */
export function repeatWords(d) {
  const r = d?.repeat;
  if (!r) return "";
  const unit = { day: "day", week: "week", month: "month", year: "year" }[r.freq] || "time";
  const n = Math.max(1, Math.round(+r.n || 1));
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const on = r.freq === "week" && (r.days || []).length ? ` on ${[...r.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((w) => DAY[w]).join(", ")}` : "";
  const stop = r.until ? `, until ${r.until}` : r.count ? `, ${r.count} times` : "";
  return `every ${n === 1 ? unit : `${n} ${unit}s`}${on}${stop}`;
}

/**
 * A stretch of days set, or put back — the way a calendar event is given a
 * start and an end. Each day is still decided on its own against the
 * pattern, so a stretch that runs across a crew change stores only the days
 * that actually differ, and putting it back leaves nothing behind.
 */
export function withDays(plan = BLANK_PLAN, fromIso, toIso, state) {
  let a = dayOf(fromIso);
  let b = dayOf(toIso || fromIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return plan;
  if (b < a) [a, b] = [b, a];
  b = Math.min(b, a + 365);
  let out = plan;
  for (let d = a; d <= b; d += 1) out = withDay(out, isoOf(d), state);
  return out;
}

/** What he said about one day, or nothing if he has never said. */
export const saidOn = (plan, iso) => {
  const state = (plan?.days || {})[iso];
  return STATE[state] ? state : null;
};

/**
 * One day set, or put back. Setting a day to what the plan already says removes the entry,
 * so stored days never stop following the pattern when it changes.
 */
export function withDay(plan = BLANK_PLAN, iso, state) {
  const days = { ...(plan?.days || {}) };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return plan;
  const projected = statesAcross({ ...plan, days: {} }, iso, iso)[0];
  /* A state that is not one of the five never goes in: `statesAcross` would ignore it,
     leaving a fact on the plan that nothing reads or shows. */
  if (state && !STATE[state]) return plan;
  if (!state || state === projected) delete days[iso];
  else days[iso] = state;
  return { ...plan, days };
}

/**
 * The days of a window, counted by state. `abroad` decides a tax year, and whether days in
 * the air count is an accountant's call, so `flights` is that switch.
 */
export function tally(plan = BLANK_PLAN, fromIso, toIso, { flights = true } = {}) {
  const each = statesAcross(plan, fromIso, toIso);
  const n = { out: 0, hotel: 0, aboard: 0, back: 0, home: 0, none: 0 };
  for (const key of each) n[key] += 1;
  const travelling = n.out + n.back;
  const abroad = n.aboard + n.hotel + (flights ? travelling : 0);
  /* The days nothing is known about are in neither column. */
  return { ...n, days: each.length, planned: each.length - n.none, travelling, abroad, inCountry: each.length - n.none - abroad };
}

/** One month, and one year, counted the same way. */
export const monthTally = (plan, y, m, how) =>
  tally(plan, isoOf(monthStart(y, m)), isoOf(monthStart(y, m) + monthLength(y, m) - 1), how);
export const yearTally = (plan, y, how) =>
  tally(plan, isoOf(Date.UTC(y, 0, 1) / 864e5), isoOf(Date.UTC(y, 11, 31) / 864e5), how);

/**
 * The window cut into stretches: one entry per unbroken run of a single state.
 *
 * A month opened on the 3rd starts in the middle of a trip, and the stretch is
 * reported as the part that falls in the month — `whole` says whether the run
 * carried on either side of it, so nothing claims a 9-day trip that was 28.
 */
export function runsIn(plan = BLANK_PLAN, fromIso, toIso) {
  const each = statesAcross(plan, fromIso, toIso);
  const from = dayOf(fromIso);
  const out = [];
  for (let i = 0; i < each.length; i += 1) {
    const last = out[out.length - 1];
    if (last && last.state === each[i]) { last.to = isoOf(from + i); last.days += 1; }
    else out.push({ state: each[i], from: isoOf(from + i), to: isoOf(from + i), days: 1 });
  }
  const before = statesAcross(plan, isoOf(from - 1), isoOf(from - 1))[0];
  const after = statesAcross(plan, isoOf(from + each.length), isoOf(from + each.length))[0];
  return out.map((r, i) => ({
    ...r,
    whole: !((i === 0 && before === r.state) || (i === out.length - 1 && after === r.state)),
  })).filter((r) => r.state !== "none");
}

/**
 * Every unbroken stretch out of the country, which is what a tax claim is made
 * of — not the states, the absence. Landing and flying out on the same day
 * never splits one absence into two, because the day in the air is inside it.
 */
export function absencesIn(plan = BLANK_PLAN, fromIso, toIso) {
  const each = statesAcross(plan, fromIso, toIso);
  const from = dayOf(fromIso);
  const out = [];
  for (let i = 0; i < each.length; i += 1) {
    if (each[i] === "home" || each[i] === "none") continue;
    const last = out[out.length - 1];
    if (last && dayOf(last.to) === from + i - 1) { last.to = isoOf(from + i); last.days += 1; }
    else out.push({ from: isoOf(from + i), to: isoOf(from + i), days: 1 });
  }
  return out;
}

/**
 * The things on a stretch of calendar, each as one item with a start and an end (drawn as
 * one bar): his dates, stretches of told days, holidays and certificate expiries. Each keeps
 * its true start and end even when the window cuts it.
 */
export function eventsIn(plan = BLANK_PLAN, fromIso, toIso, { certificates = [] } = {}) {
  const a = dayOf(fromIso);
  const b = dayOf(toIso);
  const out = [];
  const touches = (s, e) => dayOf(e) >= a && dayOf(s) <= b;

  for (const d of plan?.dates || []) {
    if (!d?.on || !d?.what) continue;
    const span = spanOf(d);
    const starts = [];
    if (d.every === "once" && String(d.on).length > 5) starts.push(d.on);
    else if (d.every === "repeat") starts.push(...repeatStarts(d, fromIso, toIso));
    else {
      const md = dayAndMonth(d.on);
      for (let y = +fromIso.slice(0, 4) - 1; y <= +toIso.slice(0, 4); y += 1) if (comesIn(d, y)) starts.push(`${y}-${md}`);
    }
    for (const s of starts) {
      const e = isoOf(dayOf(s) + span);
      if (touches(s, e)) {
        out.push({ key: `d:${d.id || d.what}:${s}`, id: d.id, sort: "family", what: d.what, from: s, to: e, every: d.every || "once", cat: d.cat || null, desc: d.desc || "",
          ...(d.time ? { time: d.time } : {}), ...(d.where ? { where: d.where } : {}), ...(d.every === "repeat" ? { rule: repeatWords(d) } : {}) });
      }
    }
  }

  /* Told days, run together: consecutive days told the same state are one
     stretch. A told day that agrees with the pattern is never stored, so
     every run here is a real departure from it. */
  const told = Object.entries(plan?.days || {})
    .filter(([iso, st]) => STATE[st] && /^\d{4}-\d{2}-\d{2}$/.test(iso))
    .sort(([x], [y]) => (x < y ? -1 : 1));
  let run = null;
  const close = () => {
    if (run && touches(run.from, run.to)) {
      out.push({ key: `s:${run.from}`, sort: "state", state: run.state, what: STATE[run.state].label, from: run.from, to: run.to });
    }
  };
  for (const [iso, st] of told) {
    if (run && run.state === st && dayOf(iso) === dayOf(run.to) + 1) run.to = iso;
    else { close(); run = { state: st, from: iso, to: iso }; }
  }
  close();

  /* The rotation, as events: his hitches solid, the suggestions dashed. It is
     drawn this way and not as a mark on every day, so a day has one thing on
     it for the rotation and not two. */
  for (const t of turnsAcross(plan, fromIso, toIso)) {
    if (t.dismissed || !touches(t.aboard.from, t.aboard.to)) continue;
    if (t.confirmed) {
      out.push({ key: `h:${t.hitch}`, id: t.hitch, sort: "hitch", what: "Aboard", from: t.aboard.from, to: t.aboard.to,
        days: t.aboard.days, off: t.off, ownOff: t.ownOff, homeTo: t.home.to });
    } else if (t.suggested) {
      out.push({ key: `s:${t.aboard.from}`, sort: "suggested", what: "Aboard", from: t.aboard.from, to: t.aboard.to,
        days: t.aboard.days, off: t.home.days, homeTo: t.home.to });
    }
  }

  for (const mk of marksOf({ ...plan, dates: [] }, fromIso, toIso, { certificates })) {
    out.push({ key: `${mk.sort}:${mk.on}:${mk.what}`, sort: mk.sort, what: mk.what, from: mk.on, to: mk.on, note: mk.note });
  }
  return out;
}

/**
 * Where each item's bar goes on a month drawn as weeks: one piece per week crossed, its
 * columns, and a lane so no two bars overlap. `head`/`tail` say whether the piece holds the
 * item's real first/last day. Longer items take the upper lanes.
 */
export function barsOf(items, firstIso, weeks) {
  const start = dayOf(firstIso);
  const pieces = [];
  for (let r = 0; r < weeks; r += 1) {
    const w0 = start + r * 7;
    const w1 = w0 + 6;
    const here = items
      .map((it) => ({ it, s: dayOf(it.from), e: dayOf(it.to) }))
      .filter(({ s, e }) => e >= w0 && s <= w1)
      .sort((x, y) => (y.e - y.s) - (x.e - x.s) || x.s - y.s);
    const taken = [];
    for (const { it, s, e } of here) {
      const c0 = Math.max(s, w0) - w0;
      const c1 = Math.min(e, w1) - w0;
      let lane = 0;
      while (taken.some((t) => t.lane === lane && t.c0 <= c1 && c0 <= t.c1)) lane += 1;
      taken.push({ lane, c0, c1 });
      pieces.push({ item: it, row: r, c0, c1, lane, head: s >= w0, tail: e <= w1 });
    }
  }
  return pieces;
}

/**
 * An event given a new start and end (what dragging its bar does). His own date keeps what
 * it is and takes the new days; a told stretch is lifted and put down in the same state;
 * holidays and certificates are not his to move and come back untouched.
 */
export function moveEvent(plan = BLANK_PLAN, item, fromIso, toIso) {
  if (!item || !fromIso) return plan;
  let a = fromIso;
  let b = toIso || fromIso;
  if (b < a) [a, b] = [b, a];
  if (item.sort === "state") {
    const lifted = withDays(plan, item.from, item.to, null);
    return withDays(lifted, a, b, item.state);
  }
  /* A hitch moved is where it really was; a suggestion moved is accepted
     where he put it — either way, the turns after it follow. */
  if (item.sort === "hitch") return changeHitch(plan, item.id, { from: a, to: b });
  if (item.sort === "suggested") return withHitch(plan, a, b);
  if (item.sort !== "family" || !item.id) return plan;
  return {
    ...plan,
    dates: (plan.dates || []).map((d) => {
      if (d.id !== item.id) return d;
      const span = dayOf(b) - dayOf(a);
      if (d.every === "once") {
        const { until, ...rest } = d;
        return span > 0 ? { ...rest, on: a, until: b } : { ...rest, on: a };
      }
      /* A repeat moves as a whole: the series starts as many days later as
         the occurrence was dragged, and so does the day it stops. */
      if (d.every === "repeat") {
        const shift = dayOf(a) - dayOf(item.from);
        const on = isoOf(dayOf(d.on) + shift);
        const { until, ...rest } = d;
        return { ...rest, on, repeat: shiftRepeat(d.repeat, shift), ...(span > 0 ? { until: isoOf(dayOf(on) + span) } : {}) };
      }
      /* Every year: the day of the year moves, the year it was first written
         with stays. A date kept as month and day alone has no year to keep. */
      const year = String(d.on).length > 5 ? String(d.on).slice(0, 4) : "";
      if (!year) return { ...d, on: a.slice(5) };
      const on = `${year}-${a.slice(5)}`;
      const { until, ...rest } = d;
      return span > 0 ? { ...rest, on, until: isoOf(dayOf(on) + span) } : { ...rest, on };
    }),
  };
}

/** How long a deleted date is kept before it is gone for good. */
export const TRASH_DAYS = 30;

/**
 * A date of his, deleted — into the bin, not out of existence. It keeps
 * everything it was and the day it was deleted, so it can be put back exactly
 * as it was for thirty days, the way a calendar's trash works. Deleting a date
 * that is not there changes nothing.
 */
export function dropDate(plan = BLANK_PLAN, id, todayIso = new Date().toISOString().slice(0, 10)) {
  const gone = (plan.dates || []).find((d) => d.id === id);
  if (!gone) return plan;
  return {
    ...plan,
    dates: (plan.dates || []).filter((d) => d.id !== id),
    trash: [{ ...gone, deleted: todayIso }, ...(plan.trash || []).filter((d) => d.id !== id)],
  };
}

/** A deleted date put back, as it was, without the note of when it went. */
export function restoreDate(plan = BLANK_PLAN, id) {
  const back = (plan.trash || []).find((d) => d.id === id);
  if (!back) return plan;
  const { deleted, ...date } = back;
  return {
    ...plan,
    dates: [...(plan.dates || []).filter((d) => d.id !== id), date],
    trash: (plan.trash || []).filter((d) => d.id !== id),
  };
}

/**
 * The bin with anything older than thirty days taken out. Run when a plan is
 * read, so the bin is never carried about for ever inside every save.
 */
export function pruneTrash(plan = BLANK_PLAN, todayIso = new Date().toISOString().slice(0, 10)) {
  const keep = (plan.trash || []).filter((d) => dayOf(todayIso) - dayOf(d.deleted || todayIso) <= TRASH_DAYS);
  return keep.length === (plan.trash || []).length ? plan : { ...plan, trash: keep };
}

/**
 * A date copied or split off as a new one, without the phone's calendar id and raw event:
 * two events on a phone with one id are one event, and the second would overwrite the first.
 */
const freshOf = ({ uid, src, sig, ...d }) => d;

/** A date copied, as a new one of its own, starting the day after it ends. */
export function duplicateDate(plan = BLANK_PLAN, id, newId) {
  const d = (plan.dates || []).find((x) => x.id === id);
  if (!d) return plan;
  const span = spanOf(d);
  const full = String(d.on).length > 5;
  const on = full ? isoOf(dayOf(d.on) + span + 1) : d.on;
  const copy = { ...freshOf(d), id: newId, on, ...(span ? { until: isoOf(dayOf(on) + span) } : {}) };
  return { ...plan, dates: [...(plan.dates || []), copy] };
}

const MONTH_WORDS = [
  ["jan", "january"], ["feb", "february"], ["mar", "march"],
  ["apr", "april"], ["may"], ["jun", "june"],
  ["jul", "july"], ["aug", "august"], ["sep", "sept", "september"],
  ["oct", "october"], ["nov", "november"], ["dec", "december"],
];
const monthOf = (w) => {
  const x = String(w || "").toLowerCase().replace(/\.$/, "");
  const i = MONTH_WORDS.findIndex((names) => names.includes(x));
  return i < 0 ? null : i + 1;
};

/** The categories an event can be filed under, each with its own colour.
 *  `words` are the tags that file an event there. */
/* In alphabetical order, as every list on the site is. */
export const CATEGORIES = [
  { key: "course", label: "Course", words: ["course", "training"], color: "#FBBF24" },
  { key: "family", label: "Family", words: ["family"], color: "#A78BFA" },
  { key: "health", label: "Health", words: ["health", "doctor"], color: "#34D399" },
  { key: "other", label: "Other", words: ["other"], color: "#94A3B8" },
  { key: "travel", label: "Travel", words: ["travel", "flight"], color: "#F472B6" },
  { key: "work", label: "Work", words: ["work", "job"], color: "#38BDF8" },
];
export const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

/**
 * An event typed as a sentence ("course 28/9 for 5 days", "dentist tomorrow") turned into
 * its name, start, end, recurrence and category. What it does not recognise stays in the
 * name rather than being guessed; with no date, the page uses the day that was clicked.
 */
export function parseEvent(text, todayIso = new Date().toISOString().slice(0, 10)) {
  let rest = ` ${String(text || "").trim()} `;
  const out = { what: "", on: null, until: null, every: "once", cat: null };
  const today = dayOf(todayIso);
  const ty = +todayIso.slice(0, 4);
  const take = (re) => { const m = rest.match(re); if (m) rest = rest.replace(m[0], " "); return m; };
  const nextOf = (mo, d, y) => {
    if (y) return `${y < 100 ? 2000 + y : y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    /* The year that puts it nearest today, either side: a planner is told what just
       happened as often as what is coming. */
    const md = `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return [ty - 1, ty, ty + 1].map((y) => `${y}-${md}`)
      .sort((a, b) => Math.abs(dayOf(a) - today) - Math.abs(dayOf(b) - today))[0];
  };
  const valid = (iso) => iso && Number.isFinite(dayOf(iso)) && isoOf(dayOf(iso)) === iso;

  /* #category */
  const tag = take(/\s#([\p{L}]+)/u);
  if (tag) out.cat = CATEGORIES.find((c) => c.words.includes(tag[1].toLowerCase()) || c.key === tag[1].toLowerCase())?.key || null;
  /* every year */
  if (take(/\s(every year|yearly|annually)(?=\s)/i)) out.every = "year";

  const MON = "([A-Za-z]{3,10}\\.?)";
  let m;
  /* 8 to 13 sep · 8-13 sep */
  if ((m = take(new RegExp(`\\s(\\d{1,2})\\s*(?:-|–|to)\\s*(\\d{1,2})\\s${MON}(?:\\s(\\d{4}))?(?=\\s)`, "i"))) && monthOf(m[3])) {
    out.on = nextOf(monthOf(m[3]), +m[1], m[4] && +m[4]);
    out.until = `${out.on.slice(0, 8)}${String(+m[2]).padStart(2, "0")}`;
  /* 8/9 to 13/9 · 28/9 - 2/10 */
  } else if ((m = take(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*(?:-|–|to)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/i))) {
    out.on = nextOf(+m[2], +m[1], m[3] && +m[3]);
    out.until = nextOf(+m[5], +m[4], m[6] ? +m[6] : +out.on.slice(0, 4));
    if (dayOf(out.until) < dayOf(out.on)) out.until = `${+out.until.slice(0, 4) + 1}${out.until.slice(4)}`;
  /* 8-13/9 */
  } else if ((m = take(/\s(\d{1,2})\s*[-–]\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/))) {
    out.on = nextOf(+m[3], +m[1], m[4] && +m[4]);
    out.until = `${out.on.slice(0, 8)}${String(+m[2]).padStart(2, "0")}`;
  /* 8/9 · 08/09/2026 · 2026-09-08 */
  } else if ((m = take(/\s(\d{4})-(\d{2})-(\d{2})(?=\s)/))) {
    out.on = `${m[1]}-${m[2]}-${m[3]}`;
  } else if ((m = take(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/))) {
    out.on = nextOf(+m[2], +m[1], m[3] && +m[3]);
  /* 8 sep · sep 8 */
  } else if ((m = take(new RegExp(`\\s(\\d{1,2})\\s${MON}(?:\\s(\\d{4}))?(?=\\s)`, "i"))) && monthOf(m[2])) {
    out.on = nextOf(monthOf(m[2]), +m[1], m[3] && +m[3]);
  } else if ((m = take(new RegExp(`\\s${MON}\\s(\\d{1,2})(?:,?\\s(\\d{4}))?(?=\\s)`, "i"))) && monthOf(m[1])) {
    out.on = nextOf(monthOf(m[1]), +m[2], m[3] && +m[3]);
  } else if (take(/\s(today)(?=\s)/i)) out.on = todayIso;
  else if (take(/\s(tomorrow)(?=\s)/i)) out.on = isoOf(today + 1);
  if (m && !out.on) rest = ` ${rest} ${m[0]} `; /* a "month" that was not one goes back into the name */

  /* for 5 days */
  const len = take(/\s(?:for)\s(\d{1,3})\s(days?)(?=\s)/i);
  if (len && out.on) out.until = isoOf(dayOf(out.on) + Math.max(1, +len[1]) - 1);

  if (out.on && !valid(out.on)) out.on = null;
  if (out.until && (!valid(out.until) || !out.on || out.until <= out.on)) out.until = null;
  out.what = rest.replace(/\s+/g, " ").trim().replace(/^[-–:,]\s*/, "").replace(/\s(on|at)$/i, "");
  out.what = out.what ? out.what[0].toUpperCase() + out.what.slice(1) : "";
  return out;
}

/**
 * A change to one occurrence of a recurring date, with a calendar's scopes: only this one,
 * this and following, or all. `change` is `{ kind: "delete" }`, `{ kind: "move", from, to }`
 * or `{ kind: "edit", patch }`. A date that does not recur is simply changed.
 */
export function changeOccurrence(plan = BLANK_PLAN, item, scope, change, newId = `d${Date.now().toString(36)}`, todayIso) {
  const d = (plan.dates || []).find((x) => x.id === item?.id);
  if (!d) return plan;
  const y = +item.from.slice(0, 4);
  const yearly = d.every === "year";
  const repeats = d.every === "repeat";
  const withMoved = (base) => {
    if (change.kind !== "move") return base;
    const span = dayOf(change.to) - dayOf(change.from);
    return { ...base, on: change.from, ...(span > 0 ? { until: change.to } : {}) };
  };
  const replaceDate = (fn) => ({ ...plan, dates: (plan.dates || []).map((x) => (x.id === d.id ? fn(x) : x)) });

  /* A repeat's occurrence is a day, not a year: only this one takes the day
     out of the rule; this and following stops the rule the day before and
     starts a new one there. */
  if (repeats && scope !== "all") {
    const { skip, first, last, until, uid, src, sig, ...base } = d;
    const span = spanOf(d);
    if (scope === "one") {
      const skipped = replaceDate((x) => ({ ...x, ex: [...new Set([...(x.ex || []), item.from])] }));
      if (change.kind === "delete") return skipped;
      const { repeat, ex, ...plain } = base;
      const single = withMoved({ ...plain, id: newId, every: "once", on: item.from, ...(span ? { until: item.to } : {}) });
      return { ...skipped, dates: [...skipped.dates, change.kind === "edit" ? { ...single, ...change.patch } : single] };
    }
    const cut = isoOf(dayOf(item.from) - 1);
    const stopped = d.on >= item.from;
    const next = stopped
      ? { ...plan, dates: (plan.dates || []).filter((x) => x.id !== d.id) }
      : replaceDate((x) => ({ ...x, repeat: { ...x.repeat, until: cut, count: undefined } }));
    if (change.kind === "delete") return stopped ? dropDate(plan, d.id, todayIso) : next;
    let tail = { ...base, id: newId, on: item.from, ...(span ? { until: item.to } : {}),
      repeat: { ...d.repeat, count: undefined }, ex: (d.ex || []).filter((e) => e >= item.from) };
    if (change.kind === "move") {
      const shift = dayOf(change.from) - dayOf(item.from);
      const s2 = dayOf(change.to) - dayOf(change.from);
      const { until: u2, ...noEnd } = tail;
      tail = { ...noEnd, on: change.from, repeat: shiftRepeat(tail.repeat, shift),
        ex: (tail.ex || []).map((e) => isoOf(dayOf(e) + shift)), ...(s2 > 0 ? { until: change.to } : {}) };
    } else tail = { ...tail, ...change.patch };
    return { ...next, dates: [...next.dates, tail] };
  }

  if (!yearly || scope === "all") {
    if (change.kind === "delete") return dropDate(plan, d.id, todayIso);
    if (change.kind === "move") return moveEvent(plan, item, change.from, change.to);
    return replaceDate((x) => ({ ...x, ...change.patch }));
  }

  if (scope === "one") {
    const skipped = replaceDate((x) => ({ ...x, skip: [...new Set([...(x.skip || []), y])] }));
    if (change.kind === "delete") return skipped;
    const { skip, first, last, until, ...base } = freshOf(d);
    const single = withMoved({ ...base, id: newId, every: "once", on: item.from, ...(item.to !== item.from ? { until: item.to } : {}) });
    return { ...skipped, dates: [...skipped.dates, change.kind === "edit" ? { ...single, ...change.patch } : single] };
  }

  /* this and following */
  const stopped = (d.first && d.first >= y) || false;
  let next = stopped
    ? { ...plan, dates: (plan.dates || []).filter((x) => x.id !== d.id) }
    : replaceDate((x) => ({ ...x, last: y - 1 }));
  if (change.kind === "delete") return stopped ? dropDate(plan, d.id, todayIso) : next;
  const { skip, last, ...base } = freshOf(d);
  let tail = { ...base, id: newId, first: y };
  if (change.kind === "move") {
    const span = dayOf(change.to) - dayOf(change.from);
    const year = String(d.on).length > 5 ? String(d.on).slice(0, 4) : "";
    const on = year ? `${year}-${change.from.slice(5)}` : change.from.slice(5);
    const { until, ...noEnd } = tail;
    tail = { ...noEnd, on, ...(span > 0 && year ? { until: isoOf(dayOf(on) + span) } : {}) };
  } else tail = { ...tail, ...change.patch };
  next = { ...next, dates: [...next.dates, tail] };
  return next;
}

/** A note written on a day, or taken off it when the text is empty. */
export function withNote(plan = BLANK_PLAN, iso, text) {
  const notes = { ...(plan.notes || {}) };
  const t = String(text || "").trim();
  if (t) notes[iso] = t; else delete notes[iso];
  return { ...plan, notes };
}

/** The ways the days aboard can be worked. */
export const SHIFTS = [
  { key: "none", label: "Not shown" },
  { key: "day", label: "Days" },
  { key: "night", label: "Nights" },
  { key: "swing", label: "Days, then nights (swing)" },
];

/**
 * Day or night for each day of a window — null for a day not aboard, or
 * when the rotation does not say. A swing hitch works the first half of its
 * days aboard on days and the second half on nights, the way a 28-day hitch
 * swings at fourteen; an odd hitch gives the extra day to the days.
 */
export function shiftsAcross(plan = BLANK_PLAN, fromIso, toIso) {
  const mode = plan?.pattern?.shift || "none";
  const from = dayOf(fromIso);
  const n = Math.max(0, dayOf(toIso) - from + 1);
  const out = new Array(n).fill(null);
  if (mode === "none" || !n) return out;
  const states = statesAcross(plan, fromIso, toIso);
  for (const t of turnsAcross(plan, fromIso, toIso)) {
    const a = dayOf(t.aboard.from);
    const len = t.aboard.days;
    for (let k = 0; k < len; k += 1) {
      const i = a + k - from;
      if (i < 0 || i >= n || states[i] !== "aboard") continue;
      out[i] = mode === "swing" ? (k < Math.ceil(len / 2) ? "day" : "night") : mode;
    }
  }
  return out;
}

/** Someone else's rotation read as a plan of its own. */
export const planOf = (other) => ({ ...BLANK_PLAN, ...other, dates: [], trash: [], notes: {} });

/**
 * The first day from `fromIso` on which both are at home, within two years —
 * the question a crewmate's or a partner's rotation is kept for. Null when
 * there is none in that time.
 */
export function bothHome(plan, other, fromIso, days = 730) {
  const toIso = isoOf(dayOf(fromIso) + days - 1);
  const mine = statesAcross(plan, fromIso, toIso);
  const theirs = statesAcross(planOf(other), fromIso, toIso);
  const i = mine.findIndex((st, k) => st === "home" && theirs[k] === "home");
  if (i < 0) return null;
  let j = i;
  while (j + 1 < mine.length && mine[j + 1] === "home" && theirs[j + 1] === "home") j += 1;
  return { from: isoOf(dayOf(fromIso) + i), to: isoOf(dayOf(fromIso) + j), days: j - i + 1 };
}

/**
 * What is coming, as a list — the agenda. His events, the stretches he told,
 * holidays and certificates, and the crew changes themselves: the day he
 * leaves home and the day he is back. In order, starting from today.
 */
export function agendaOf(plan = BLANK_PLAN, fromIso, days = 180, { certificates = [] } = {}) {
  const toIso = isoOf(dayOf(fromIso) + days - 1);
  const items = eventsIn(plan, fromIso, toIso, { certificates })
    .filter((e) => dayOf(e.to) >= dayOf(fromIso));
  for (const t of turnsAcross(plan, fromIso, toIso)) {
    const away = t.legs.find((l) => l.state !== "home");
    const home = t.legs.find((l) => l.state === "home");
    if (away && away.from >= fromIso && away.from <= toIso) {
      items.push({ key: `c:out:${away.from}`, sort: "change", what: "Leave home", from: away.from, to: away.from, state: away.state });
    }
    if (home && home.from >= fromIso && home.from <= toIso) {
      items.push({ key: `c:home:${home.from}`, sort: "change", what: "Back home", from: home.from, to: home.from, state: "home" });
    }
  }
  return items.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : (a.sort === "change" ? -1 : 1)));
}

/** Several years, each counted month by month — the long view. */
export function yearsOf(plan = BLANK_PLAN, firstYear, n = 5, how) {
  return Array.from({ length: n }, (unused, k) => {
    const y = firstYear + k;
    return { y, months: Array.from({ length: 12 }, (u, m) => monthTally(plan, y, m, how)), total: yearTally(plan, y, how) };
  });
}

export const BLANK_PAY = { mode: "day", currency: "£", dayRate: 0, travelRate: 0, hotelRate: 0, monthly: 0, soldRate: 0 };

/**
 * What a stretch of days paid, or will pay: by the day aboard (travel and hotel days at
 * their own rates) or a monthly salary plus days sold. A sold day (buyback) is found, not
 * typed: a day the rotation had at home that he told the site he spent aboard.
 */
export function payOf(plan = BLANK_PLAN, fromIso, toIso, { flights = true } = {}) {
  const p = { ...BLANK_PAY, ...(plan?.pay || {}) };
  const states = statesAcross(plan, fromIso, toIso);
  const meant = statesAcross({ ...plan, days: {} }, fromIso, toIso);
  const n = { out: 0, hotel: 0, aboard: 0, back: 0, home: 0 };
  for (const st of states) n[st] += 1;
  const sold = states.filter((st, i) => st === "aboard" && meant[i] === "home").length;
  const travel = n.out + n.back;
  let total;
  const lines = [];
  if (p.mode === "salary") {
    const from = dayOf(fromIso);
    const to = dayOf(toIso);
    /* The salary pro rata by the days of each month the window covers. */
    let months = 0;
    for (let d = from; d <= to; d += 1) {
      const iso = isoOf(d);
      months += 1 / monthLength(+iso.slice(0, 4), +iso.slice(5, 7) - 1);
    }
    const base = +(p.monthly || 0) * months;
    lines.push({ what: "Salary", days: null, amount: base });
    lines.push({ what: "Days sold", days: sold, amount: sold * +(p.soldRate || 0) });
    total = base + sold * +(p.soldRate || 0);
  } else {
    lines.push({ what: "Aboard", days: n.aboard, amount: n.aboard * +(p.dayRate || 0) });
    lines.push({ what: "Travelling", days: travel, amount: travel * +(p.travelRate || 0) });
    lines.push({ what: "Hotel", days: n.hotel, amount: n.hotel * +(p.hotelRate || 0) });
    total = lines.reduce((s, l) => s + l.amount, 0);
  }
  return { mode: p.mode, currency: p.currency || "£", total, lines, sold, counted: n, set: p.mode === "salary" ? +p.monthly > 0 : +p.dayRate > 0 };
}

/**
 * The tickets, soonest to run out first, each with the days it has left and —
 * the thing a calendar can say that a list cannot — whether it runs out while
 * he is aboard, when it cannot be renewed, and so the last day at home before
 * then to get it done.
 */
export function ticketsAgainst(plan = BLANK_PLAN, certificates = [], todayIso) {
  const today = dayOf(todayIso);
  return certificates
    .filter((c) => c?.expires && c?.what)
    .map((c) => {
      const left = dayOf(c.expires) - today;
      const st = statesAcross(plan, c.expires, c.expires)[0];
      let renewBy = null;
      if (st !== "home") {
        /* Walk back to the last day at home before it goes. */
        const back = statesAcross(plan, isoOf(dayOf(c.expires) - 120), c.expires);
        for (let i = back.length - 1; i >= 0; i -= 1) if (back[i] === "home") { renewBy = isoOf(dayOf(c.expires) - (back.length - 1 - i)); break; }
      }
      return { ...c, left, aboardWhenItGoes: st !== "home", renewBy, standing: left < 0 ? "gone" : left <= 90 ? "soon" : "ok" };
    })
    .sort((a, b) => a.left - b.left);
}

/**
 * The holidays offered as a suggestion for a year: every one of the country's,
 * each saying whether he has already taken it. Nothing here goes on the
 * calendar — that is his choice, made with `takeHolidays`.
 */
export function holidaySuggestions(plan = BLANK_PLAN, y) {
  const country = plan?.holidays?.country || "BR";
  const taken = new Set(plan?.holidays?.take || []);
  return holidaysIn(country, y).map((h) => ({ ...h, taken: taken.has(h.what) }));
}

/** The holidays he said yes to, by name — so they come round every year —
 *  and a note that he was asked, so the suggestion is not offered again. */
export function takeHolidays(plan = BLANK_PLAN, names) {
  return { ...plan, holidays: { ...(plan.holidays || {}), take: [...new Set(names)], asked: true } };
}

/** Whether there is a suggestion still waiting for an answer. */
export const holidaysPending = (plan) => !plan?.holidays?.asked;

/** What a plan carries that can be cleared, and how many of each. */
export function clearable(plan = BLANK_PLAN) {
  return {
    events: (plan.dates || []).length,
    days: Object.keys(plan.days || {}).length,
    notes: Object.keys(plan.notes || {}).length,
    slips: Object.keys(plan.slips || {}).length,
    holidays: (plan.holidays?.take || []).length,
    linked: (plan.linked || []).length,
    others: (plan.others || []).length,
    hitches: (plan.hitches || []).length,
  };
}

/**
 * The calendar cleared of what was chosen. Events go to the bin, restorable for thirty
 * days; everything else is emptied, and clearing the holidays offers the suggestion again.
 */
export function clearPlan(plan = BLANK_PLAN, what = {}, todayIso = new Date().toISOString().slice(0, 10)) {
  let out = { ...plan };
  if (what.events && (plan.dates || []).length) {
    out = { ...out, dates: [], trash: [...plan.dates.map((d) => ({ ...d, deleted: todayIso })), ...(plan.trash || [])] };
  }
  if (what.days) out = { ...out, days: {} };
  if (what.notes) out = { ...out, notes: {} };
  if (what.slips) out = { ...out, slips: {} };
  if (what.holidays) out = { ...out, holidays: { ...(plan.holidays || {}), take: [], asked: false } };
  if (what.linked) out = { ...out, linked: [] };
  if (what.others) out = { ...out, others: [] };
  if (what.hitches) out = { ...out, hitches: [] };
  /* No rotation at all, not a fresh one: the calendar is blank until he
     sets one. */
  if (what.rotation) {
    out = { ...out, pattern: null, anchor: todayIso, horizon: BLANK_PLAN.horizon, slips: {}, dismissed: [], suggest: true };
  }
  return out;
}

/* Two values the same, whatever order their keys are in: the database gives
   an object back with its keys sorted its own way, and that is not a change. */
const canon = (v) => (Array.isArray(v) ? v.map(canon)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => [k, canon(v[k])]))
  : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/**
 * Three-way merge of the page's plan (`mine`) and the account's (`theirs`) against `base`,
 * the plan as the page last read or saved it. Events merge one by one like a calendar sync
 * (changed on both sides takes this page's); the bins are joined; everything else is the
 * page's, except the calendar codes, which only the account writes.
 */
export function mergePlans(base, mine, theirs) {
  if (!theirs) return mine;
  if (!mine) return theirs;
  const byId = (list) => new Map((list || []).filter((d) => d?.id).map((d) => [d.id, d]));
  const B = byId(base?.dates);
  const M = byId(mine.dates);
  const T = byId(theirs.dates);
  const dates = [];
  for (const id of new Set([...M.keys(), ...T.keys()])) {
    const b = B.get(id);
    const m = M.get(id);
    const t = T.get(id);
    if (m && t) dates.push(b && same(m, b) ? t : m);
    else if (m) { if (!(b && same(m, b))) dates.push(m); }
    else if (!(b && same(t, b))) dates.push(t);
  }
  const kept = new Set(dates.map((d) => d.id));
  const trash = [...byId([...(theirs.trash || []), ...(mine.trash || [])]).values()]
    .filter((d) => !kept.has(d.id))
    .sort((x, y) => (x.deleted < y.deleted ? 1 : x.deleted > y.deleted ? -1 : 0));
  const out = { ...mine, dates, trash };
  /* A code the account no longer has was switched off there, and stays off. */
  for (const k of ["feed", "dav"]) {
    if (theirs[k] !== undefined) out[k] = theirs[k];
    else delete out[k];
  }
  return out;
}

/** Whether two plans say the same thing, whatever order their keys are in. */
export const samePlan = (a, b) => same(a, b);
