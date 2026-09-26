/**
 * The rotation as an .ics feed that Google, Apple and Outlook calendars subscribe to.
 * Reminders ride as alarms inside the events, so the phone rings them and no notification
 * server is needed. The countdown ("Home in 12 days") is one all-day event per day for the
 * next fortnight, so it is right on the day even if the feed was fetched last week.
 * Pure: no network, no clock of its own. The caller says what today is.
 */
import {
  eventsIn, isoOf, dayOf, runsIn, STATE, turnsAcross,
} from "./rotation.js";

export const ymd = (iso) => iso.replace(/-/g, "");
/* Text as RFC 5545 wants it: backslash, semicolon, comma and newline escaped. */
export const esc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/* Lines longer than 75 octets are folded, a space starting each continuation. */
export function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ""; size = 0; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** A reminder, `before` whole days ahead of the event, at 18:00 the evening before
 *  when it is one day — the hour a crew-change reminder is wanted. */
export const alarm = (days, what) => [
  "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(what)}`,
  days === 1 ? "TRIGGER:-PT6H" : `TRIGGER:-P${days}D`, "END:VALARM",
];

/**
 * @param plan        the saved rotation
 * @param options.today        ISO date the feed is built on
 * @param options.certificates the certificate rows
 * @param options.name         what to call the calendar
 * @param options.stamp        a fixed DTSTAMP, so the same plan gives the same file
 */
export function icsOf(plan, { today, certificates = [], name = "Rotation", stamp } = {}) {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//offshore-report//Rotation//EN", "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH", `X-WR-CALNAME:${esc(name)}`, "X-WR-TIMEZONE:UTC",
    /* How often to come back for it. Google decides for itself; Apple and
       Outlook honour this. */
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
  ];
  for (const v of veventsOf(plan, { today, certificates, stamp })) lines.push(...v.lines);
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/**
 * The feed's events one by one, each with its id, what it is (`sort`: run,
 * change, family, holiday, certificate, countdown) and its lines — what the
 * feed is made of, and what the two-way calendar serves as one file each.
 */
export function veventsOf(plan, { today, certificates = [], stamp } = {}) {
  const from = isoOf(dayOf(today) - 62);
  const to = isoOf(dayOf(today) + 400);
  const dtstamp = stamp || `${ymd(today)}T000000Z`;
  const rem = { change: 1, event: 1, ticket: 30, ...(plan?.reminders || {}) };
  const out = [];
  const event = ({ uid, start, end, summary, desc = "", cats = "", alarms = [], transp = "TRANSPARENT", sort = "", id = "" }) => {
    const lines = [];
    out.push({ uid: `${uid}@offshore-report`, sort, id, lines });
    lines.push(
      "BEGIN:VEVENT", `UID:${uid}@offshore-report`, `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${ymd(start)}`,
      /* All-day ends are exclusive: the day after the last one. */
      `DTEND;VALUE=DATE:${ymd(isoOf(dayOf(end) + 1))}`,
      `SUMMARY:${esc(summary)}`, `TRANSP:${transp}`,
      ...(desc ? [`DESCRIPTION:${esc(desc)}`] : []),
      ...(cats ? [`CATEGORIES:${esc(cats)}`] : []),
      ...alarms, "END:VEVENT",
    );
  };

  /* The stretches: aboard, home, travelling, hotel — each run once. */
  for (const r of runsIn(plan, from, to)) {
    const st = STATE[r.state];
    event({
      uid: `run-${r.state}-${r.from}`, start: r.from, end: r.to,
      summary: `${st.mark} ${st.label}`, cats: "Rotation", sort: "run",
      transp: r.state === "home" ? "TRANSPARENT" : "OPAQUE",
    });
  }

  /* Crew changes, with the evening-before reminder. */
  for (const t of turnsAcross(plan, from, to)) {
    const away = t.legs.find((l) => l.state !== "home");
    const home = t.legs.find((l) => l.state === "home");
    if (away && away.from >= today) {
      event({ uid: `out-${away.from}`, start: away.from, end: away.from, summary: "✈️ Crew change — leave home",
        cats: "Rotation", sort: "change", alarms: rem.change ? alarm(rem.change, "Crew change tomorrow: you leave home") : [] });
    }
    if (home && home.from >= today) {
      event({ uid: `home-${home.from}`, start: home.from, end: home.from, summary: "🏠 Crew change — back home",
        cats: "Rotation", sort: "change", alarms: rem.change ? alarm(rem.change, "Crew change tomorrow: you go home") : [] });
    }
  }

  /* His events, each occurrence in the window, with their own reminder. */
  for (const e of eventsIn(plan, from, to, { certificates })) {
    if (e.sort === "state") continue; /* already in the stretches */
    const isTicket = e.sort === "certificate";
    const days = isTicket ? rem.ticket : e.sort === "family" ? rem.event : 0;
    event({
      uid: `${e.sort}-${e.id || esc(e.what).slice(0, 40)}-${e.from}`, start: e.from, end: e.to,
      summary: `${e.sort === "holiday" ? "▲ " : isTicket ? "🎫 " : ""}${e.what}`,
      desc: e.desc || "", cats: e.cat || e.sort, sort: e.sort, id: e.id || "",
      alarms: days && e.from >= today ? alarm(days, isTicket ? `${e.what} in ${days} days` : e.what) : [],
    });
  }

  /* The countdown, one day at a time for the next fortnight. */
  const turns = turnsAcross(plan, today, isoOf(dayOf(today) + 120));
  for (let k = 0; k < 14; k += 1) {
    const d = isoOf(dayOf(today) + k);
    let next = null;
    for (const t of turns) {
      const away = t.legs.find((l) => l.state !== "home");
      const home = t.legs.find((l) => l.state === "home");
      const cands = [away && { on: away.from, home: false }, home && { on: home.from, home: true }]
        .filter((c) => c && c.on > d);
      for (const c of cands) if (!next || c.on < next.on) next = c;
    }
    if (!next) continue;
    const n = dayOf(next.on) - dayOf(d);
    event({ uid: `count-${d}`, start: d, end: d,
      summary: next.home ? `🏠 Home in ${n} ${n === 1 ? "day" : "days"}` : `✈️ Back out in ${n} ${n === 1 ? "day" : "days"}`,
      cats: "Countdown", sort: "countdown" });
  }
  return out;
}

const unesc = (s) => String(s || "").replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
/* A date from DTSTART/DTEND, whatever form it came in: 20261030,
   20261030T090000Z, or 20261030T090000 with a TZID. The day is the day as
   written — a calendar day, which is what this site counts in. */
const dateOf = (v) => {
  const m = String(v || "").match(/(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const timeOf = (v) => {
  const m = String(v || "").match(/T(\d{2})(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "";
};
const WEEKDAY = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0 };

/**
 * The events of an .ics file — a Google Calendar export, or the "secret
 * address in iCal format" of any calendar — as start and end days.
 *
 * All-day events keep their span (their end is exclusive in the file, and
 * inclusive here). Timed events are put on their day, with the time in their
 * description. A yearly repeat stays a yearly event; any other repeat —
 * daily, weekly, monthly — is written out as its occurrences between `from`
 * and `to`, because the calendar here draws days and not rules. A cancelled
 * event, and a single occurrence taken out of a series, are left out.
 */
export function readIcs(text, { from = "1900-01-01", to = "2999-12-31" } = {}) {
  const lines = String(text || "").replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const out = [];
  let ev = null;
  const lo = dayOf(from);
  const hi = dayOf(to);
  for (const raw of lines) {
    if (raw === "BEGIN:VEVENT") { ev = { ex: [] }; continue; }
    if (raw === "END:VEVENT") {
      if (ev && ev.start && ev.status !== "CANCELLED") out.push(...occurrences(ev, lo, hi));
      ev = null; continue;
    }
    if (!ev) continue;
    const i = raw.indexOf(":");
    if (i < 0) continue;
    const head = raw.slice(0, i);
    const val = raw.slice(i + 1);
    const name = head.split(";")[0].toUpperCase();
    if (name === "UID") ev.uid = val;
    else if (name === "SUMMARY") ev.what = unesc(val).trim();
    else if (name === "DESCRIPTION") ev.desc = unesc(val).trim();
    else if (name === "LOCATION") ev.where = unesc(val).trim();
    else if (name === "STATUS") ev.status = val.trim().toUpperCase();
    else if (name === "DTSTART") { ev.start = dateOf(val); ev.time = /VALUE=DATE(;|:|$)/.test(head) ? "" : timeOf(val); }
    else if (name === "DTEND") { ev.end = dateOf(val); ev.endAllDay = /VALUE=DATE(;|:|$)/.test(head) || !/T/.test(val); }
    else if (name === "RRULE") ev.rule = Object.fromEntries(val.split(";").map((p) => p.split("=")));
    else if (name === "EXDATE") ev.ex.push(...val.split(",").map(dateOf).filter(Boolean));
    else if (name === "RECURRENCE-ID") ev.moved = dateOf(val);
  }
  return out;

  function occurrences(e, lo2, hi2) {
    /* The last day it covers: an all-day end is exclusive, a timed one is the
       day it ends on. */
    let last = e.start;
    if (e.end) last = e.endAllDay && dayOf(e.end) > dayOf(e.start) ? isoOf(dayOf(e.end) - 1) : e.end;
    const span = Math.max(0, dayOf(last) - dayOf(e.start));
    const base = {
      uid: e.uid || "", what: e.what || "(no title)",
      desc: [e.time ? `${e.time}` : "", e.where || "", e.desc || ""].filter(Boolean).join(" · ").slice(0, 400),
    };
    const one = (s) => ({ ...base, on: s, until: span ? isoOf(dayOf(s) + span) : null, every: "once" });
    const r = e.rule;
    if (!r) return dayOf(last) >= lo2 && dayOf(e.start) <= hi2 ? [one(e.start)] : [];
    if (r.FREQ === "YEARLY" && !r.COUNT && !r.UNTIL && !r.BYMONTH) {
      return [{ ...base, on: e.start, until: span ? isoOf(dayOf(e.start) + span) : null, every: "year", ex: e.ex }];
    }
    const step = Math.max(1, +(r.INTERVAL || 1));
    const until = r.UNTIL ? dayOf(dateOf(r.UNTIL)) : Infinity;
    const count = r.COUNT ? +r.COUNT : Infinity;
    const days = r.BYDAY ? r.BYDAY.split(",").map((d) => WEEKDAY[d.slice(-2)]).filter((d) => d !== undefined) : null;
    const got = [];
    let n = 0;
    const start = dayOf(e.start);
    for (let k = 0; n < count && k < 3000; k += 1) {
      let cands = [];
      if (r.FREQ === "DAILY") cands = [start + k * step];
      else if (r.FREQ === "WEEKLY") {
        const week = start + k * 7 * step - ((new Date(start * 864e5).getUTCDay() + 6) % 7);
        cands = (days || [new Date(start * 864e5).getUTCDay()]).map((w) => week + ((w + 6) % 7)).filter((d) => d >= start).sort((a, b) => a - b);
      } else if (r.FREQ === "MONTHLY" || r.FREQ === "YEARLY") {
        const d0 = new Date(start * 864e5);
        const months = r.FREQ === "MONTHLY" ? k * step : k * 12 * step;
        const dt = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + months, d0.getUTCDate());
        /* 31 January has no 31 February: a month without the day is skipped, as calendars do. */
        if (new Date(dt).getUTCDate() === d0.getUTCDate()) cands = [dt / 864e5];
      } else break;
      for (const c of cands) {
        if (c > until || n >= count) { k = 1e9; break; }
        n += 1;
        const iso = isoOf(c);
        if (c + span >= lo2 && c <= hi2 && !e.ex.includes(iso)) got.push(one(iso));
      }
      if ((cands[0] ?? 0) > hi2) break;
    }
    return got;
  }
}
