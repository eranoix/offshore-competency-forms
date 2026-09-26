/**
 * The rotation as a CalDAV account: two-way, unlike the one-way feed in `ics.js`.
 * "Rotation" is read-only (worked out from the pattern); "Events" holds his own dates, one file each.
 * An event from the phone is served back as the phone wrote it (`src`) until the plan's fields
 * differ from `sig`; then it is written afresh from them, keeping the phone's alerts.
 * Pure: `davAnswer` is given the request and the plan, and says what to answer and what the plan becomes.
 */
import { dayOf, isoOf, spanOf, CATEGORY, CATEGORIES, dropDate } from "./rotation.js";
import { veventsOf, esc, fold, ymd, alarm } from "./ics.js";

const DAV = "DAV:";
const CAL = "urn:ietf:params:xml:ns:caldav";
const CS = "http://calendarserver.org/ns/";
const APPLE = "http://apple.com/ns/ical/";
const PREFIX = { [DAV]: "d", [CAL]: "c", [CS]: "cs", [APPLE]: "a" };

/* A year for a birthday kept as day and month alone: a calendar event needs
   one. A leap year, so the 29th of February has somewhere to be. */
export const NO_YEAR = 2000;

/** A short, stable fingerprint of a text — an ETag, a ctag, a file name. */
export function hashOf(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

const xmlEsc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const canon = (v) => (Array.isArray(v) ? v.map(canon)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).filter((k) => v[k] !== undefined && v[k] !== null).sort().map((k) => [k, canon(v[k])]))
  : v);

/**
 * The XML a calendar app sends, as a tree of `{ ns, name, kids, text }`, with
 * every element's namespace worked out from its prefix. Just enough XML for
 * PROPFIND and REPORT bodies: no DTD, no entities beyond the five.
 */
export function readXml(text) {
  const root = { ns: "", name: "#root", kids: [], text: "" };
  const stack = [{ node: root, spaces: { xml: "http://www.w3.org/XML/1998/namespace" }, dflt: "" }];
  const src = String(text || "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!DOCTYPE[^>]*>/gi, "");
  const re = /<(\/?)([A-Za-z_][\w.-]*(?::[\w.-]+)?)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const unent = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) { top.node.text += unent(m[5]); continue; }
    const [, closing, qname, attrText, selfClose] = m;
    if (closing) { if (stack.length > 1) stack.pop(); continue; }
    const spaces = { ...top.spaces };
    let dflt = top.dflt;
    const attrs = {};
    for (const a of attrText.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const v = unent(a[2] ?? a[3] ?? "");
      if (a[1] === "xmlns") dflt = v;
      else if (a[1].startsWith("xmlns:")) spaces[a[1].slice(6)] = v;
      else attrs[a[1]] = v;
    }
    const [pre, local] = qname.includes(":") ? qname.split(":") : ["", qname];
    const node = { ns: pre ? spaces[pre] || "" : dflt, name: local, attrs, kids: [], text: "" };
    top.node.kids.push(node);
    if (!selfClose) stack.push({ node, spaces, dflt });
  }
  return root;
}
const kid = (node, ns, name) => node?.kids.find((k) => k.ns === ns && k.name === name) || null;
const kids = (node, ns, name) => (node?.kids || []).filter((k) => k.ns === ns && k.name === name);
const deep = (node, ns, name) => {
  const out = [];
  const walk = (n) => { for (const k of n?.kids || []) { if (k.ns === ns && k.name === name) out.push(k); walk(k); } };
  walk(node);
  return out;
};

/** An element's tag, in the prefix its namespace has in the answer, or with
 *  a namespace of its own when it is one this server has never heard of. */
const tagOf = (ns, name) => (PREFIX[ns] ? { open: `${PREFIX[ns]}:${name}`, decl: "" }
  : ns ? { open: `x:${name}`, decl: ` xmlns:x="${xmlEsc(ns)}"` } : { open: name, decl: ' xmlns=""' });
const el = (ns, name, inner = "") => {
  const t = tagOf(ns, name);
  return inner === "" ? `<${t.open}${t.decl}/>` : `<${t.open}${t.decl}>${inner}</${t.open}>`;
};
const multistatus = (responses) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:" xmlns:c="${CAL}" xmlns:cs="${CS}" xmlns:a="${APPLE}">${responses.join("")}</d:multistatus>`;

/** One `<response>` for one address: the properties it has, and the ones asked
 *  for that it has not, each in its own propstat as the protocol wants. */
function responseFor(href, wanted, values) {
  const found = [];
  const missing = [];
  for (const [ns, name] of wanted) {
    const v = values(ns, name);
    if (v === null || v === undefined) missing.push(el(ns, name));
    else found.push(el(ns, name, v));
  }
  return `<d:response><d:href>${xmlEsc(href)}</d:href>${
    found.length ? `<d:propstat><d:prop>${found.join("")}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>` : ""}${
    missing.length ? `<d:propstat><d:prop>${missing.join("")}</d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>` : ""}</d:response>`;
}
const gone = (href) => `<d:response><d:href>${xmlEsc(href)}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`;

const unesc = (s) => String(s || "").replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
const dateOf = (v) => {
  const m = String(v || "").match(/(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const clockOf = (v) => {
  const m = String(v || "").match(/T(\d{2})(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "";
};
const WEEKDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const DAYNAME = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const FREQ = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" };
const RFREQ = { day: "DAILY", week: "WEEKLY", month: "MONTHLY", year: "YEARLY" };

/** What of a date the calendar file is made from — so a change to any of it,
 *  on the site, is a change the phone has to be sent. */
const FIELDS = ["what", "on", "until", "every", "repeat", "ex", "skip", "first", "last", "desc", "where", "time", "cat"];
export function sigOf(d, parts = []) {
  const pick = (x) => Object.fromEntries(FIELDS.map((k) => [k, x?.[k]]));
  const each = [...parts].sort((a, b) => (a.rid < b.rid ? -1 : a.rid > b.rid ? 1 : 0)).map((p) => ({ ...pick(p), rid: p.rid }));
  return hashOf(JSON.stringify(canon({ d: pick(d), parts: each })));
}

/** The events of one calendar file, unfolded, each as its property lines,
 *  with any alerts kept whole. */
function veventsIn(text) {
  const lines = String(text || "").replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const out = [];
  let ev = null;
  let alarmLines = null;
  let depth = 0;
  for (const raw of lines) {
    if (raw === "BEGIN:VEVENT") { ev = { props: [], alarms: [] }; continue; }
    if (raw === "END:VEVENT") { if (ev) out.push(ev); ev = null; continue; }
    if (!ev) continue;
    if (raw === "BEGIN:VALARM") { alarmLines = [raw]; depth = 1; continue; }
    if (alarmLines) {
      alarmLines.push(raw);
      if (/^BEGIN:/.test(raw)) depth += 1;
      if (/^END:/.test(raw)) depth -= 1;
      if (raw === "END:VALARM" && depth === 0) { ev.alarms.push(alarmLines); alarmLines = null; }
      continue;
    }
    if (/^(BEGIN|END):/.test(raw)) continue;
    const i = raw.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    if (i < 0) continue;
    const head = raw.slice(0, i);
    const [name, ...params] = head.split(";");
    ev.props.push({ name: name.toUpperCase(), params: Object.fromEntries(params.map((p) => {
      const j = p.indexOf("=");
      return [p.slice(0, j).toUpperCase(), p.slice(j + 1).replace(/^"|"$/g, "")];
    })), value: raw.slice(i + 1) });
  }
  return out;
}
const prop = (ev, name) => ev.props.find((p) => p.name === name) || null;

/** When an event starts or ends: its day, and its clock and zone when it has one. */
function whenOf(p) {
  if (!p) return null;
  const allDay = p.params.VALUE === "DATE" || !/T/.test(p.value);
  return {
    on: dateOf(p.value), allDay,
    clock: allDay ? "" : clockOf(p.value),
    tz: allDay ? "" : /Z$/.test(p.value) ? "Z" : p.params.TZID || "",
  };
}

/**
 * A calendar file PUT by the phone, read into a date of the plan and the
 * occurrences it moved on their own. `id` is the file's name; `prev` is the
 * date already kept under it, whose category the phone never knew.
 */
export function dateFromIcs(text, id, prev = null) {
  if (!/BEGIN:VCALENDAR/.test(text)) return { error: "not a calendar" };
  const evs = veventsIn(text);
  if (!evs.length) return { error: "not an event" };
  const master = evs.find((e) => !prop(e, "RECURRENCE-ID")) || evs[0];
  const start = whenOf(prop(master, "DTSTART"));
  if (!start?.on) return { error: "no start" };

  const fieldsOf = (ev, s) => {
    const endP = prop(ev, "DTEND");
    const dur = prop(ev, "DURATION")?.value || "";
    let last = s.on;
    const end = whenOf(endP);
    if (end?.on) last = end.allDay && dayOf(end.on) > dayOf(s.on) ? isoOf(dayOf(end.on) - 1) : end.on;
    else if (/P(\d+)D/.test(dur) && s.allDay) last = isoOf(dayOf(s.on) + Math.max(0, +dur.match(/P(\d+)D/)[1] - 1));
    const span = Math.min(365, Math.max(0, dayOf(last) - dayOf(s.on)));
    const out = { what: unesc(prop(ev, "SUMMARY")?.value || "").trim() || "(no title)", on: s.on };
    if (span) out.until = isoOf(dayOf(s.on) + span);
    const desc = unesc(prop(ev, "DESCRIPTION")?.value || "").trim();
    if (desc) out.desc = desc.slice(0, 2000);
    const where = unesc(prop(ev, "LOCATION")?.value || "").trim();
    if (where) out.where = where.slice(0, 300);
    if (!s.allDay) out.time = { s: s.clock, ...(end?.clock ? { e: end.clock } : {}), ...(s.tz ? { tz: s.tz } : {}) };
    return out;
  };

  const date = { id, ...fieldsOf(master, start), every: "once" };
  const uid = prop(master, "UID")?.value;
  if (uid) date.uid = uid.slice(0, 300);
  const cats = unesc(prop(master, "CATEGORIES")?.value || "").split(",").map((c) => c.trim().toLowerCase());
  const cat = CATEGORIES.find((c) => cats.includes(c.key) || cats.includes(c.label.toLowerCase()))?.key || prev?.cat;
  if (cat) date.cat = cat;

  const ex = master.props.filter((p) => p.name === "EXDATE").flatMap((p) => p.value.split(",").map(dateOf)).filter(Boolean);
  const rule = prop(master, "RRULE")
    ? Object.fromEntries(prop(master, "RRULE").value.split(";").map((p) => p.split("=")).map(([k, v]) => [k.toUpperCase(), v]))
    : null;
  if (rule && FREQ[rule.FREQ]) {
    const n = Math.max(1, +(rule.INTERVAL || 1));
    const plainYear = rule.FREQ === "YEARLY" && n === 1 && !rule.COUNT && !rule.BYDAY && !rule.BYSETPOS
      && (!rule.BYMONTH || +rule.BYMONTH === +start.on.slice(5, 7))
      && (!rule.BYMONTHDAY || +rule.BYMONTHDAY === +start.on.slice(8, 10));
    if (plainYear) {
      date.every = "year";
      /* A birthday with no year on the site went to the phone in the year 2000,
         and comes back as the day and month it was. */
      if (prev && String(prev.on).length <= 5 && +start.on.slice(0, 4) === NO_YEAR) {
        date.on = start.on.slice(5);
        delete date.until;
      }
      if (rule.UNTIL) date.last = +dateOf(rule.UNTIL).slice(0, 4);
      const years = [...new Set(ex.map((e) => +e.slice(0, 4)))];
      if (years.length) date.skip = years;
    } else {
      date.every = "repeat";
      date.repeat = { freq: FREQ[rule.FREQ], ...(n > 1 ? { n } : {}) };
      if (rule.BYDAY && rule.FREQ === "WEEKLY") {
        date.repeat.days = rule.BYDAY.split(",").map((d) => WEEKDAY[d.slice(-2)]).filter((d) => d !== undefined);
      }
      if (rule.UNTIL) date.repeat.until = dateOf(rule.UNTIL);
      if (rule.COUNT) date.repeat.count = Math.max(1, +rule.COUNT);
      /* A rule the calendar here does not draw — "the second Monday of the
         month" — is kept as the phone wrote it and drawn as near as it can
         be; the phone still has it exactly. */
      if (rule.BYSETPOS || (rule.BYDAY && rule.FREQ !== "WEEKLY") || rule.BYMONTHDAY || rule.BYMONTH) date.repeat.rough = true;
      if (ex.length) date.ex = [...new Set(ex)].sort();
    }
  }

  /* An occurrence moved or renamed on its own on the phone: the series leaves that day out and
     the occurrence becomes a date of its own tied to the series, so the site draws it where it
     went and the phone keeps it as part of the one event. */
  const parts = [];
  for (const ev of evs) {
    const rid = prop(ev, "RECURRENCE-ID");
    if (!rid || ev === master) continue;
    const was = dateOf(rid.value);
    if (!was) continue;
    if (date.every === "year") date.skip = [...new Set([...(date.skip || []), +was.slice(0, 4)])];
    else if (date.every === "repeat") date.ex = [...new Set([...(date.ex || []), was])].sort();
    if ((prop(ev, "STATUS")?.value || "").toUpperCase() === "CANCELLED") continue;
    const s = whenOf(prop(ev, "DTSTART"));
    if (!s?.on) continue;
    parts.push({ id: `${id}~${was}`, ...fieldsOf(ev, s), every: "once", of: id, rid: was, ...(date.cat ? { cat: date.cat } : {}) });
  }

  if (text.length <= 16000) {
    date.src = String(text).replace(/\r?\n/g, "\r\n");
    date.sig = sigOf(date, parts);
  }
  return { date, parts };
}

/** A day and a clock, in the form DTSTART takes. */
const stampOf = (iso, clock) => `${ymd(iso)}T${clock.replace(":", "")}00`;
const whenLine = (name, iso, time, clock) => {
  if (!time) return `${name};VALUE=DATE:${ymd(iso)}`;
  if (time.tz === "Z") return `${name}:${stampOf(iso, clock)}Z`;
  if (time.tz) return `${name};TZID=${time.tz}:${stampOf(iso, clock)}`;
  return `${name}:${stampOf(iso, clock)}`;
};

/**
 * One of his dates written as a calendar file — with the occurrences it moved
 * on their own inside it, as the protocol keeps them. The phone's alerts are
 * kept when the phone had given it some; a date made on the site gets the
 * reminder the plan asks for.
 */
export function icsOfDate(d, parts = [], { reminder = 1, stamp = "20260101T000000Z" } = {}) {
  const fromPhone = d.src ? veventsIn(d.src).find((e) => !prop(e, "RECURRENCE-ID")) : null;
  const uid = d.src && d.uid ? d.uid : `${d.id}@offshore-report`;
  const full = String(d.on).length > 5;
  const startYear = d.every === "year"
    ? Math.max(full ? +d.on.slice(0, 4) : NO_YEAR, d.first || 0)
    : +d.on.slice(0, 4);
  const md = full ? d.on.slice(5) : d.on;
  const start = d.every === "year" ? `${startYear}-${md}` : d.on;
  const span = d.every === "year" && !full ? 0 : spanOf(d);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//offshore-report//Rotation//EN", "CALSCALE:GREGORIAN"];

  const body = (x, from, extra = []) => {
    const t = x.time;
    const last = isoOf(dayOf(from) + (x === d ? span : spanOf(x)));
    const out = ["BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp}`, ...extra, whenLine("DTSTART", from, t, t?.s || "00:00")];
    if (!t) out.push(`DTEND;VALUE=DATE:${ymd(isoOf(dayOf(last) + 1))}`);
    else if (t.e || last !== from) out.push(whenLine("DTEND", last, t, t.e || t.s));
    out.push(`SUMMARY:${esc(x.what)}`);
    if (x.desc) out.push(`DESCRIPTION:${esc(x.desc)}`);
    if (x.where) out.push(`LOCATION:${esc(x.where)}`);
    if (x.cat && CATEGORY[x.cat]) out.push(`CATEGORIES:${esc(CATEGORY[x.cat].label)}`);
    out.push(`TRANSP:${t ? "OPAQUE" : "TRANSPARENT"}`);
    return out;
  };

  const overridden = new Set(parts.map((p) => p.rid));
  const main = body(d, start);
  if (d.every === "year") {
    main.push(`RRULE:FREQ=YEARLY${d.last ? `;UNTIL=${d.last}${md.replace("-", "")}${d.time ? "T235959Z" : ""}` : ""}`);
    for (const y of (d.skip || []).filter((yy) => !overridden.has(`${yy}-${md}`))) main.push(`${whenLine("EXDATE", `${y}-${md}`, d.time, d.time?.s || "00:00")}`);
  } else if (d.every === "repeat" && d.repeat && RFREQ[d.repeat.freq]) {
    const r = d.repeat;
    const bits = [`FREQ=${RFREQ[r.freq]}`];
    if (r.n > 1) bits.push(`INTERVAL=${r.n}`);
    if (r.freq === "week" && (r.days || []).length) bits.push(`BYDAY=${r.days.map((w) => DAYNAME[w]).join(",")}`);
    if (r.until) bits.push(`UNTIL=${ymd(r.until)}${d.time ? "T235959Z" : ""}`);
    else if (r.count) bits.push(`COUNT=${r.count}`);
    main.push(`RRULE:${bits.join(";")}`);
    for (const e of (d.ex || []).filter((x) => !overridden.has(x))) main.push(whenLine("EXDATE", e, d.time, d.time?.s || "00:00"));
  }
  const alarms = fromPhone ? fromPhone.alarms : reminder && !d.time ? [alarm(reminder, d.what)] : [];
  for (const a of alarms) main.push(...a);
  main.push("END:VEVENT");
  lines.push(...main);
  for (const p of parts) {
    const o = body(p, p.on, [whenLine("RECURRENCE-ID", p.rid, d.time, d.time?.s || "00:00")]);
    o.push("END:VEVENT");
    lines.push(...o);
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** A file name the phone may use for an event: its own UUID, or ours. */
export const goodName = (n) => /^[A-Za-z0-9][A-Za-z0-9._@+-]{0,120}$/.test(n) && !n.includes("~");

/**
 * The two calendars' files, each with its name, ETag and text, and the ctag
 * that changes whenever any file in the calendar does.
 */
export function collectionsOf(plan, { today, certificates = [], stamp = "20260101T000000Z" } = {}) {
  const rem = { change: 1, event: 1, ticket: 30, ...(plan?.reminders || {}) };
  const rotation = veventsOf(plan, { today, certificates, stamp })
    .filter((v) => v.sort !== "family")
    .map((v) => {
      const text = `${["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//offshore-report//Rotation//EN", "CALSCALE:GREGORIAN", ...v.lines, "END:VCALENDAR"].map(fold).join("\r\n")}\r\n`;
      return { name: `${hashOf(v.uid)}.ics`, text, etag: `"${hashOf(text)}"` };
    });
  const dates = (plan?.dates || []).filter((d) => d?.id && d.on && d.what);
  const partsOf = new Map();
  for (const d of dates) if (d.of) partsOf.set(d.of, [...(partsOf.get(d.of) || []), d]);
  const ids = new Set(dates.map((d) => d.id));
  const events = [];
  for (const d of dates) {
    /* An occurrence of a series is inside the series' file, unless the series
       is gone — then it is an event of its own. */
    if (d.of && ids.has(d.of)) continue;
    const parts = partsOf.get(d.id) || [];
    const text = d.src && d.sig === sigOf(d, parts) ? d.src : icsOfDate(d, parts, { reminder: rem.event, stamp });
    events.push({ name: `${goodName(d.id) ? d.id : hashOf(d.id)}.ics`, id: d.id, text, etag: `"${hashOf(text)}"` });
  }
  const ctag = (list) => hashOf(list.map((f) => f.name + f.etag).join("|"));
  return {
    rotation: { files: rotation, ctag: ctag(rotation) },
    events: { files: events, ctag: ctag(events) },
  };
}

const CALENDARS = {
  rotation: { name: "Offshore Report · Rotation", color: "#38BDF8FF", order: 1, writable: false,
    about: "Your turns, crew changes and countdown, worked out from your pattern on Offshore Report. Change the pattern on the site." },
  events: { name: "Offshore Report · Events", color: "#A78BFAFF", order: 2, writable: true,
    about: "Your events on Offshore Report. Add, move or delete them here or on the site — both stay the same." },
};

/**
 * What to answer a calendar app.
 *
 * @param req  { method, path, depth, body, ifMatch, ifNoneMatch } — `path` is
 *             what follows /dav/, "" for the account itself
 * @param ctx  { plan, today, certificates, email, root, stamp }
 * @returns    { status, headers, body, plan } — `plan` only when it changed
 */
export function davAnswer(req, ctx) {
  const root = ctx.root || "/dav/";
  const method = String(req.method || "GET").toUpperCase();
  const path = String(req.path || "").replace(/^\/+/, "");
  const [calName, fileName, ...more] = path.split("/");
  const cal = calName ? CALENDARS[calName] : null;
  const xml = { "content-type": "application/xml; charset=utf-8" };
  const answer = (status, body = "", headers = {}) => ({ status, body, headers });
  const error = (status, cond, ns = DAV) => answer(status,
    `<?xml version="1.0" encoding="utf-8"?>\n<d:error xmlns:d="DAV:" xmlns:c="${CAL}">${el(ns, cond)}</d:error>`, xml);

  if (calName && !cal) return answer(404, "No such calendar.");
  if (more.length || (fileName !== undefined && fileName !== "" && !fileName.endsWith(".ics"))) return answer(404, "Not here.");

  if (method === "OPTIONS") {
    return answer(200, "", {
      DAV: "1, 2, 3, calendar-access",
      Allow: "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT",
    });
  }

  const all = collectionsOf(ctx.plan, ctx);
  const col = cal ? all[calName] : null;
  const file = col && fileName ? col.files.find((f) => f.name === fileName) : null;
  const href = (c, f = "") => `${root}${c ? `${c}/` : ""}${f}`;

  const privileges = (writable) => `<d:privilege><d:read/></d:privilege>${writable
    ? "<d:privilege><d:write/></d:privilege><d:privilege><d:write-content/></d:privilege><d:privilege><d:bind/></d:privilege><d:privilege><d:unbind/></d:privilege>"
    : ""}<d:privilege><d:read-current-user-privilege-set/></d:privilege>`;
  const accountProp = (ns, name) => {
    const k = `${ns}|${name}`;
    return {
      [`${DAV}|resourcetype`]: "<d:collection/><d:principal/>",
      [`${DAV}|displayname`]: xmlEsc(ctx.email || "Offshore Report"),
      [`${DAV}|current-user-principal`]: `<d:href>${root}</d:href>`,
      [`${DAV}|principal-URL`]: `<d:href>${root}</d:href>`,
      [`${DAV}|principal-collection-set`]: `<d:href>${root}</d:href>`,
      [`${DAV}|owner`]: `<d:href>${root}</d:href>`,
      [`${CAL}|calendar-home-set`]: `<d:href>${root}</d:href>`,
      [`${CAL}|calendar-user-address-set`]: ctx.email ? `<d:href>mailto:${xmlEsc(ctx.email)}</d:href>` : null,
      [`${DAV}|current-user-privilege-set`]: privileges(false),
      [`${DAV}|supported-report-set`]: "<d:supported-report><d:report><d:expand-property/></d:report></d:supported-report>",
      [`${DAV}|getetag`]: `"${hashOf(all.rotation.ctag + all.events.ctag)}"`,
    }[k] ?? null;
  };
  const calendarProp = (c) => (ns, name) => {
    const meta = CALENDARS[c];
    const k = `${ns}|${name}`;
    return {
      [`${DAV}|resourcetype`]: "<d:collection/><c:calendar/>",
      [`${DAV}|displayname`]: xmlEsc(meta.name),
      [`${DAV}|owner`]: `<d:href>${root}</d:href>`,
      [`${DAV}|current-user-principal`]: `<d:href>${root}</d:href>`,
      [`${DAV}|current-user-privilege-set`]: privileges(meta.writable),
      [`${DAV}|supported-report-set`]: "<d:supported-report><d:report><c:calendar-multiget/></d:report></d:supported-report><d:supported-report><d:report><c:calendar-query/></d:report></d:supported-report>",
      [`${DAV}|getetag`]: `"${all[c].ctag}"`,
      [`${CS}|getctag`]: xmlEsc(all[c].ctag),
      [`${CAL}|calendar-description`]: xmlEsc(meta.about),
      [`${CAL}|supported-calendar-component-set`]: '<c:comp name="VEVENT"/>',
      [`${CAL}|supported-calendar-data`]: '<c:calendar-data content-type="text/calendar" version="2.0"/>',
      [`${CAL}|max-resource-size`]: "16000",
      [`${APPLE}|calendar-color`]: meta.color,
      [`${APPLE}|calendar-order`]: String(meta.order),
    }[k] ?? null;
  };
  const fileProp = (f, withData) => (ns, name) => {
    const k = `${ns}|${name}`;
    if (k === `${CAL}|calendar-data`) return withData ? xmlEsc(f.text) : null;
    return {
      [`${DAV}|getetag`]: xmlEsc(f.etag),
      [`${DAV}|getcontenttype`]: "text/calendar; charset=utf-8; component=vevent",
      [`${DAV}|getcontentlength`]: String(new TextEncoder().encode(f.text).length),
      [`${DAV}|resourcetype`]: "",
    }[k] ?? null;
  };
  const ALL = {
    account: [[DAV, "resourcetype"], [DAV, "displayname"], [DAV, "current-user-principal"], [CAL, "calendar-home-set"]],
    calendar: [[DAV, "resourcetype"], [DAV, "displayname"], [CS, "getctag"], [DAV, "getetag"], [CAL, "supported-calendar-component-set"], [APPLE, "calendar-color"]],
    file: [[DAV, "getetag"], [DAV, "getcontenttype"], [DAV, "resourcetype"]],
  };
  /* The properties a body asks for, or the usual ones when it asks for all or
     says nothing. */
  const askedIn = (tree, kind) => {
    const p = deep(tree, DAV, "prop")[0];
    if (!p) return ALL[kind];
    return p.kids.map((k) => [k.ns, k.name]);
  };

  if (method === "PROPFIND") {
    const tree = readXml(req.body);
    const depth = String(req.depth ?? "1") === "0" ? 0 : 1;
    const out = [];
    if (!cal) {
      out.push(responseFor(root, askedIn(tree, "account"), accountProp));
      if (depth) for (const c of Object.keys(CALENDARS)) out.push(responseFor(href(c), askedIn(tree, "calendar"), calendarProp(c)));
    } else if (!fileName) {
      out.push(responseFor(href(calName), askedIn(tree, "calendar"), calendarProp(calName)));
      if (depth) for (const f of col.files) out.push(responseFor(href(calName, f.name), askedIn(tree, "file"), fileProp(f, true)));
    } else {
      if (!file) return answer(404, "No such event.");
      out.push(responseFor(href(calName, file.name), askedIn(tree, "file"), fileProp(file, true)));
    }
    return answer(207, multistatus(out), xml);
  }

  if (method === "PROPPATCH") {
    /* Colour and order are asked to be kept; they are the site's, and the
       answer says yes so the app does not keep asking. */
    const tree = readXml(req.body);
    const names = deep(tree, DAV, "prop").flatMap((p) => p.kids.map((k) => [k.ns, k.name]));
    return answer(207, multistatus([responseFor(req.path ? `${root}${path}` : root, names, () => "")]), xml);
  }

  if (method === "REPORT") {
    if (!col) return error(403, "supported-report");
    const tree = readXml(req.body);
    const top = tree.kids[0];
    const wanted = askedIn(tree, "file");
    const withData = wanted.some(([ns, n]) => ns === CAL && n === "calendar-data");
    if (top?.ns === CAL && top.name === "calendar-multiget") {
      const out = kids(top, DAV, "href").map((h) => {
        let p = h.text.trim();
        try { p = decodeURIComponent(new URL(p, "https://x").pathname); } catch { /* as sent */ }
        const name = p.split("/").filter(Boolean).pop() || "";
        const f = col.files.find((x) => x.name === name);
        return f ? responseFor(href(calName, f.name), wanted, fileProp(f, withData)) : gone(h.text.trim());
      });
      return answer(207, multistatus(out), xml);
    }
    if (top?.ns === CAL && top.name === "calendar-query") {
      /* Every event, whatever the range asked for: more than was asked is
         allowed, and a phone asks for a range and then keeps what it gets. */
      return answer(207, multistatus(col.files.map((f) => responseFor(href(calName, f.name), wanted, fileProp(f, withData)))), xml);
    }
    return error(403, "supported-report");
  }

  if (method === "GET" || method === "HEAD") {
    if (!cal) return answer(200, method === "HEAD" ? "" : "Offshore Report calendar account.", { "content-type": "text/plain; charset=utf-8" });
    if (!fileName) {
      const text = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//offshore-report//Rotation//EN\r\n${col.files.map((f) => f.text.replace(/^[\s\S]*?(?=BEGIN:VEVENT)/, "").replace(/END:VCALENDAR\r\n$/, "")).join("")}END:VCALENDAR\r\n`;
      return answer(200, method === "HEAD" ? "" : text, { "content-type": "text/calendar; charset=utf-8", ETag: `"${col.ctag}"` });
    }
    if (!file) return answer(404, "No such event.");
    return answer(200, method === "HEAD" ? "" : file.text, { "content-type": "text/calendar; charset=utf-8", ETag: file.etag });
  }

  const matches = (tag, f) => !tag || tag === "*" ? Boolean(f) : tag.split(",").map((t) => t.trim().replace(/^W\//, "")).includes(f?.etag);

  if (method === "PUT") {
    if (!cal || !fileName) return answer(405, "Put an event inside a calendar.");
    if (!cal.writable) return error(403, "need-privileges");
    if (req.ifNoneMatch === "*" && file) return answer(412, "That event is already there.");
    if (req.ifMatch && !matches(req.ifMatch, file)) return answer(412, "That event was changed since.");
    const id = fileName.replace(/\.ics$/, "");
    if (!goodName(id)) return answer(400, "That is not a name an event can have.");
    const text = String(req.body || "");
    if (text.length > 16000) return error(413, "max-resource-size", CAL);
    const plan = ctx.plan || {};
    const was = file ? (plan.dates || []).find((d) => d.id === file.id) : null;
    const got = dateFromIcs(text, was?.id || id, was);
    if (got.error) return error(400, "valid-calendar-data", CAL);
    const keep = (plan.dates || []).filter((d) => d.id !== got.date.id && d.of !== got.date.id);
    const next = { ...plan, dates: [...keep, got.date, ...got.parts] };
    const served = collectionsOf(next, ctx).events.files.find((f) => f.id === got.date.id);
    return { status: file ? 204 : 201, body: "", headers: served ? { ETag: served.etag } : {}, plan: next };
  }

  if (method === "DELETE") {
    if (!cal || !fileName) return error(403, "need-privileges");
    if (!cal.writable) return error(403, "need-privileges");
    if (!file) return answer(404, "No such event.");
    if (req.ifMatch && !matches(req.ifMatch, file)) return answer(412, "That event was changed since.");
    const plan = ctx.plan || {};
    /* Into the bin, as a delete on the site does — thirty days to get it back
       — and its moved occurrences with it. */
    const binned = dropDate(plan, file.id, ctx.today);
    const next = { ...binned, dates: (binned.dates || []).filter((d) => d.of !== file.id) };
    return { status: 204, body: "", headers: {}, plan: next };
  }

  if (method === "MKCALENDAR" || method === "MKCOL" || method === "MOVE" || method === "COPY") {
    return error(403, "need-privileges");
  }
  return answer(405, "Not a thing a calendar can do here.");
}

/**
 * An Apple configuration profile that adds the account to Calendar: opened on
 * an iPhone it lands in Settings, opened on a Mac in System Settings, and
 * installing it is the whole of the set-up. The password in it is the
 * calendar key, which is why it is only ever given to the signed-in owner.
 */
export function profileOf({ host, email, key, doc }) {
  const uuid = (seed) => {
    const h = hashOf(seed) + hashOf(`${seed}.`);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`.toUpperCase();
  };
  const s = (v) => `<string>${xmlEsc(v)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>CalDAVAccountDescription</key>${s("Offshore Report")}
      <key>CalDAVHostName</key>${s(host)}
      <key>CalDAVPort</key><integer>443</integer>
      <key>CalDAVPrincipalURL</key>${s(`https://${host}/dav/`)}
      <key>CalDAVUseSSL</key><true/>
      <key>CalDAVUsername</key>${s(email || "Offshore Report")}
      <key>CalDAVPassword</key>${s(key)}
      <key>PayloadDescription</key>${s("Your rotation and your events from Offshore Report, in Calendar.")}
      <key>PayloadDisplayName</key>${s("Offshore Report calendar")}
      <key>PayloadIdentifier</key>${s(`app.offshorereport.caldav.${doc}`)}
      <key>PayloadType</key>${s("com.apple.caldav.account")}
      <key>PayloadUUID</key>${s(uuid(`caldav.${doc}`))}
      <key>PayloadVersion</key><integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key>${s("Adds your Offshore Report rotation and events to Calendar. Changes on either side show on the other.")}
  <key>PayloadDisplayName</key>${s("Offshore Report calendar")}
  <key>PayloadIdentifier</key>${s(`app.offshorereport.profile.${doc}`)}
  <key>PayloadOrganization</key>${s("Offshore Report")}
  <key>PayloadRemovalDisallowed</key><false/>
  <key>PayloadType</key>${s("Configuration")}
  <key>PayloadUUID</key>${s(uuid(`profile.${doc}`))}
  <key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>
`;
}
