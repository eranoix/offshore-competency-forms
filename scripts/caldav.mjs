/**
 * The calendar account, held to the requests an iPhone or Mac Calendar actually
 * sends, and to what each side sees after the other changes something.
 *
 *   node scripts/caldav.mjs
 */
import {
  BLANK_PLAN, changeOccurrence, duplicateDate, eventsIn, marksOf, mergePlans, moveEvent, repeatStarts, repeatWords,
} from "../src/engine/rotation.js";
import { collectionsOf, dateFromIcs, davAnswer, hashOf, icsOfDate, profileOf, readXml, sigOf } from "../src/engine/caldav.js";
import { esc, icsOf } from "../src/engine/ics.js";

const fails = [];
/* A plan with the commonest rotation set — a new plan has none. */
const SET = { ...BLANK_PLAN, pattern: { on: 28, off: 28, hotelOut: 0, hotelBack: 0, travel: 0 } };
const say = (ok, label, got = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${got ? ` — ${got}` : ""}`);
  if (!ok) fails.push(label);
};
const TODAY = "2026-09-25";

const gym = { id: "g", what: "Gym", on: "2026-09-01", every: "repeat", repeat: { freq: "week", days: [1, 4] } };
say(JSON.stringify(repeatStarts(gym, "2026-09-01", "2026-09-14")) === JSON.stringify(["2026-09-03", "2026-09-07", "2026-09-10", "2026-09-14"]),
  "a weekly repeat on Monday and Thursday falls on Mondays and Thursdays, from its first day", repeatWords(gym));
say(repeatStarts({ on: "2016-01-31", repeat: { freq: "month" } }, "2026-01-01", "2026-06-30").join() === "2026-01-31,2026-03-31,2026-05-31",
  "a monthly one on the 31st skips the months without one");
say(repeatStarts({ on: "2016-01-01", repeat: { freq: "day", n: 3 } }, "2026-01-01", "2026-01-10").join() === "2026-01-02,2026-01-05,2026-01-08",
  "every third day, ten years on, still lands on the right third day");
say(repeatStarts({ on: "2026-01-05", repeat: { freq: "week", count: 3 } }, "2026-01-01", "2026-12-31").length === 3,
  "a repeat of three times is three times");
say(repeatStarts({ on: "2026-01-05", repeat: { freq: "week", until: "2026-01-19" }, ex: ["2026-01-12"] }, "2026-01-01", "2026-12-31").join() === "2026-01-05,2026-01-19",
  "and one with an end and a day taken out stops at the end and skips the day");
say(repeatStarts({ on: "2026-01-05", until: "2026-01-07", repeat: { freq: "week" } }, "2026-01-13", "2026-01-13").join() === "2026-01-12",
  "an occurrence that started before the window and runs into it is in it");
const withGym = { ...SET, anchor: "2026-02-10", dates: [gym] };
say(eventsIn(withGym, "2026-09-01", "2026-09-30").filter((e) => e.id === "g").length === 8
  && marksOf(withGym, "2026-09-01", "2026-09-30").filter((m) => m.id === "g").length === 8,
  "the calendar and the marks both draw every occurrence of it, and only those");

const base = { ...SET, dates: [{ id: "a", what: "A", on: "2026-10-01", every: "once" }, { id: "b", what: "B", on: "2026-10-02", every: "once" }], feed: "f1" };
const mine = { ...base, dates: [...base.dates.filter((d) => d.id !== "b"), { id: "m", what: "Mine", on: "2026-10-03", every: "once" }], slips: { 3: { from: "2026-10-09" } } };
/* The account, as the database gives it back: keys in its own order. */
const theirs = { ...base, dates: [{ every: "once", on: "2026-10-01", what: "A", id: "a" }, base.dates[1], { id: "p", what: "Phone", on: "2026-10-04", every: "once" }], dav: "x1" };
const merged = mergePlans(base, mine, theirs);
say(merged.dates.map((d) => d.id).sort().join() === "a,m,p",
  "an event added on the phone and one added on the page are both kept, and one deleted on the page stays deleted", merged.dates.map((d) => d.id).join());
say(merged.slips[3]?.from === "2026-10-09" && merged.dav === "x1" && merged.feed === "f1",
  "the page's own changes stand, and the calendar codes are the account's");
say(!("dav" in mergePlans({ ...base, dav: "x1" }, { ...base, dav: "x1" }, base)),
  "and a calendar disconnected in the account is not switched back on by the page");
const phoneDeleted = mergePlans(base, base, { ...base, dates: [base.dates[0]], trash: [{ ...base.dates[1], deleted: TODAY }] });
say(phoneDeleted.dates.length === 1 && phoneDeleted.trash[0]?.id === "b",
  "an event deleted on the phone is not brought back by a page that still had it, and it is in the bin");
const both = mergePlans(base, { ...base, dates: [{ ...base.dates[0], what: "Page" }, base.dates[1]] },
  { ...base, dates: [{ ...base.dates[0], what: "Phone" }, { ...base.dates[1], what: "Phone B" }] });
say(both.dates.find((d) => d.id === "a").what === "Page" && both.dates.find((d) => d.id === "b").what === "Phone B",
  "changed on both sides, the page wins; changed on one, that change is taken");

const plan = {
  ...SET, anchor: "2026-09-01", who: "Sam", dav: "c0de",
  dates: [
    { id: "d1", what: "Mum's birthday", on: "10-02", every: "year", cat: "family" },
    { id: "d2", what: "Course; BOSIET", on: "2026-10-12", until: "2026-10-14", every: "once", cat: "course" },
  ],
};
const ctx = { plan, today: TODAY, email: "checks@forms.example.org", root: "/dav/", certificates: [{ what: "HUET", expires: "2026-12-01" }] };
const ask = (req, c = ctx) => davAnswer(req, c);

const opt = ask({ method: "OPTIONS", path: "" });
say(opt.status === 200 && /calendar-access/.test(opt.headers.DAV), "OPTIONS says it is a calendar server", opt.headers.DAV);

const PF_ROOT = `<?xml version="1.0"?><A:propfind xmlns:A="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><A:prop><A:current-user-principal/><C:calendar-home-set/><A:resourcetype/><B:nothing-here xmlns:B="urn:example"/></A:prop></A:propfind>`;
const root = ask({ method: "PROPFIND", path: "", depth: "1", body: PF_ROOT });
say(root.status === 207 && /<c:calendar-home-set><d:href>\/dav\/<\/d:href>/.test(root.body)
  && /\/dav\/rotation\//.test(root.body) && /\/dav\/events\//.test(root.body),
  "the account names its home and lists both calendars under it");
say(/<x:nothing-here xmlns:x="urn:example"\/>[\s\S]*404 Not Found/.test(root.body),
  "a property it does not have is answered not found, in its own namespace");

const PF_CAL = `<propfind xmlns="DAV:" xmlns:CS="http://calendarserver.org/ns/"><prop><CS:getctag/><displayname/><current-user-privilege-set/><resourcetype/></prop></propfind>`;
const rot = ask({ method: "PROPFIND", path: "rotation/", depth: "0", body: PF_CAL });
const evs = ask({ method: "PROPFIND", path: "events/", depth: "1", body: `<propfind xmlns="DAV:"><prop><getetag/></prop></propfind>` });
say(/Offshore Report · Rotation/.test(rot.body) && !/<d:write\/>/.test(rot.body) && /<cs:getctag>/.test(rot.body),
  "the rotation calendar is read-only, and says so");
say((evs.body.match(/<d:response>/g) || []).length === 3 && /\/dav\/events\/d1\.ics/.test(evs.body),
  "the events calendar lists each of his dates as its own file", `${(evs.body.match(/<d:response>/g) || []).length - 1} files`);

const all = collectionsOf(plan, ctx);
const bday = all.events.files.find((f) => f.id === "d1").text;
say(/DTSTART;VALUE=DATE:20001002/.test(bday) && /RRULE:FREQ=YEARLY/.test(bday) && /CATEGORIES:Family/.test(bday),
  "a birthday with no year goes to the phone as a yearly event from 2000");
say(/SUMMARY:Course\\; BOSIET/.test(all.events.files.find((f) => f.id === "d2").text)
  && /DTEND;VALUE=DATE:20261015/.test(all.events.files.find((f) => f.id === "d2").text),
  "a three-day course ends the day after its last, and its semicolon is escaped");
say(all.rotation.files.some((f) => /HUET expires/.test(f.text)) && all.rotation.files.some((f) => /Crew change/.test(f.text))
  && !all.rotation.files.some((f) => /Mum/.test(f.text)),
  "the rotation calendar has the crew changes and the certificates, and not his events");
say(!/METHOD:/.test(bday) && !all.rotation.files.some((f) => /METHOD:/.test(f.text)),
  "no file carries a METHOD, which a calendar server's files must not");
say(esc("a;b") === "a\\;b" && /SUMMARY:Course\\; BOSIET/.test(icsOf(plan, { today: TODAY })),
  "and the feed now escapes semicolons too");

const multi = ask({ method: "REPORT", path: "events/", depth: "1", body:
  `<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/><C:calendar-data/></D:prop><D:href>/dav/events/d1.ics</D:href><D:href>https://forms.example.com/dav/events/gone.ics</D:href></C:calendar-multiget>` });
say(multi.status === 207 && /BEGIN:VCALENDAR/.test(multi.body) && /gone\.ics<\/d:href><d:status>HTTP\/1.1 404/.test(multi.body),
  "multiget sends the events asked for, and says which are not there");
const query = ask({ method: "REPORT", path: "rotation/", body:
  `<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/></D:prop><C:filter><C:comp-filter name="VCALENDAR"/></C:filter></C:calendar-query>` });
say((query.body.match(/<d:response>/g) || []).length === all.rotation.files.length, "calendar-query lists the whole calendar");

const IPHONE = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Apple Inc.//iPhone OS 26.0//EN", "CALSCALE:GREGORIAN",
  "BEGIN:VTIMEZONE", "TZID:America/Sao_Paulo", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:-0300", "TZOFFSETTO:-0300", "END:STANDARD", "END:VTIMEZONE",
  "BEGIN:VEVENT", "UID:8F2E5B1C-1111-4A2B-9C3D-ABCDEF012345", "DTSTAMP:20260925T120000Z",
  "DTSTART;TZID=America/Sao_Paulo:20261020T140000", "DTEND;TZID=America/Sao_Paulo:20261020T153000",
  "SUMMARY:Dentist", "LOCATION:Rua Augusta\\, 100", "SEQUENCE:0",
  "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "TRIGGER:-PT30M", "UID:A1", "END:VALARM",
  "END:VEVENT", "END:VCALENDAR", "",
].join("\r\n");
const NAME = "8F2E5B1C-1111-4A2B-9C3D-ABCDEF012345";
const put = ask({ method: "PUT", path: `events/${NAME}.ics`, body: IPHONE, ifNoneMatch: "*" });
const made = put.plan?.dates.find((d) => d.id === NAME);
say(put.status === 201 && made?.what === "Dentist" && made.on === "2026-10-20" && made.time?.s === "14:00" && made.time?.e === "15:30"
  && made.time?.tz === "America/Sao_Paulo" && made.where === "Rua Augusta, 100",
  "an event made on the iPhone lands in the plan with its day, its time, its zone and where", JSON.stringify(made?.time));
const after = { ...ctx, plan: put.plan };
const got = ask({ method: "GET", path: `events/${NAME}.ics` }, after);
say(got.body === IPHONE && got.headers.ETag === put.headers.ETag,
  "and the phone is given back exactly what it wrote, under the ETag it was told");
say(collectionsOf(put.plan, ctx).events.ctag !== all.events.ctag, "the calendar's ctag changed, so every other device fetches it");
say(eventsIn(put.plan, "2026-10-01", "2026-10-31").some((e) => e.id === NAME), "the site draws it");
say(ask({ method: "PUT", path: `events/${NAME}.ics`, body: IPHONE, ifNoneMatch: "*" }, after).status === 412,
  "made twice under one name, the second is refused");
say(ask({ method: "PUT", path: `rotation/x.ics`, body: IPHONE }, after).status === 403, "the rotation calendar cannot be written to");
say(ask({ method: "PUT", path: `events/${NAME}.ics`, body: IPHONE, ifMatch: '"stale"' }, after).status === 412,
  "a change made against an old copy is refused, not written over the new one");

/* Moved on the site: the phone is sent a new file, keeping what the site
   does not know about — its time, its zone, its alert. */
const moved = moveEvent(put.plan, { sort: "family", id: NAME, from: "2026-10-20", to: "2026-10-20" }, "2026-10-22", "2026-10-22");
const fresh = ask({ method: "GET", path: `events/${NAME}.ics` }, { ...ctx, plan: moved });
say(fresh.body !== IPHONE && /DTSTART;TZID=America\/Sao_Paulo:20261022T140000/.test(fresh.body)
  && /DTEND;TZID=America\/Sao_Paulo:20261022T153000/.test(fresh.body) && /UID:8F2E5B1C-1111-4A2B-9C3D-ABCDEF012345/.test(fresh.body)
  && /TRIGGER:-PT30M/.test(fresh.body) && /LOCATION:Rua Augusta\\, 100/.test(fresh.body),
  "moved on the site, the phone gets it two days on at the same hour, the same event, with its own alert");

/* A birthday sent back from the phone unchanged keeps its lack of a year. */
const bdayBack = dateFromIcs(bday, "d1", plan.dates[0]).date;
say(bdayBack.on === "10-02" && bdayBack.every === "year" && bdayBack.cat === "family",
  "a birthday that went out as 2000 comes back as the day and month it was, in its category");

const WEEKLY = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Apple Inc.//Mac OS X 16//EN",
  "BEGIN:VEVENT", "UID:W1", "DTSTAMP:20260925T120000Z", "DTSTART;VALUE=DATE:20261005", "DTEND;VALUE=DATE:20261006",
  "RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE;VALUE=DATE:20261019", "SUMMARY:Call home", "END:VEVENT",
  "BEGIN:VEVENT", "UID:W1", "DTSTAMP:20260925T120000Z", "RECURRENCE-ID;VALUE=DATE:20261012",
  "DTSTART;VALUE=DATE:20261014", "DTEND;VALUE=DATE:20261015", "SUMMARY:Call home (Wed)", "END:VEVENT",
  "END:VCALENDAR", "",
].join("\r\n");
const wk = ask({ method: "PUT", path: "events/W1.ics", body: WEEKLY }, after);
const series = wk.plan.dates.find((d) => d.id === "W1");
const drawn = eventsIn(wk.plan, "2026-10-01", "2026-10-31").filter((e) => /Call home/.test(e.what)).map((e) => e.from).sort();
say(series?.every === "repeat" && series.repeat.freq === "week" && drawn.join() === "2026-10-05,2026-10-14,2026-10-26",
  "a weekly event with one day taken out and one moved is drawn on the site where the phone has it", drawn.join());
say(!collectionsOf(wk.plan, ctx).events.files.some((f) => /~/.test(f.name)) && collectionsOf(wk.plan, ctx).events.files.some((f) => f.name === "W1.ics"),
  "and the moved one stays inside the series' file, not a second event on the phone");
const renamed = { ...wk.plan, dates: wk.plan.dates.map((d) => (d.id === "W1" ? { ...d, what: "Call Mum" } : d)) };
const rew = collectionsOf(renamed, ctx).events.files.find((f) => f.name === "W1.ics").text;
say(/RRULE:FREQ=WEEKLY;BYDAY=MO/.test(rew) && /EXDATE;VALUE=DATE:20261019/.test(rew) && !/EXDATE;VALUE=DATE:20261012/.test(rew)
  && /RECURRENCE-ID;VALUE=DATE:20261012/.test(rew) && /SUMMARY:Call Mum/.test(rew),
  "renamed on the site, the series is rewritten with its rule, its day off and its moved one");
const one = changeOccurrence(wk.plan, { id: "W1", from: "2026-10-26", to: "2026-10-26" }, "one", { kind: "delete" });
const following = changeOccurrence(wk.plan, { id: "W1", from: "2026-10-26", to: "2026-10-26" }, "following", { kind: "move", from: "2026-10-27", to: "2026-10-27" }, "W2");
say(eventsIn(one, "2026-10-01", "2026-11-10").filter((e) => e.id === "W1").map((e) => e.from).join() === "2026-10-05,2026-11-02,2026-11-09",
  "deleting only one occurrence of a weekly event takes that day out and nothing else");
say(eventsIn(following, "2026-10-01", "2026-11-10").filter((e) => /Call/.test(e.what)).map((e) => e.from).sort().join() === "2026-10-05,2026-10-14,2026-10-27,2026-11-03,2026-11-10",
  "moving this and the following ones a day on stops the old rule and starts a new one, on Tuesdays", eventsIn(following, "2026-10-01", "2026-11-10").filter((e) => /Call/.test(e.what)).map((e) => e.from).sort().join());
say(!following.dates.find((d) => d.id === "W2").uid && !duplicateDate(put.plan, NAME, "copy").dates.find((d) => d.id === "copy").uid,
  "a series split off or a copy is a new event, never a second one with the phone's id");

const del = ask({ method: "DELETE", path: "events/W1.ics" }, { ...ctx, plan: wk.plan });
say(del.status === 204 && !del.plan.dates.some((d) => d.id === "W1" || d.of === "W1") && del.plan.trash.some((d) => d.id === "W1"),
  "deleted on the phone, it goes to the bin with its moved occurrence, as a delete on the site does");
say(ask({ method: "DELETE", path: "events/W1.ics", ifMatch: '"nope"' }, { ...ctx, plan: wk.plan }).status === 412
  && ask({ method: "DELETE", path: "rotation/" }, ctx).status === 403,
  "a delete against a stale copy, or of a calendar, is refused");

const tree = readXml(`<a:x xmlns:a="DAV:" xmlns="urn:y"><b>t &amp; u</b><a:c/></a:x>`);
say(tree.kids[0].ns === "DAV:" && tree.kids[0].kids[0].ns === "urn:y" && tree.kids[0].kids[0].text === "t & u",
  "the XML reader works out prefixes, default namespaces and entities");
say(sigOf({ what: "x", on: "2026-01-01" }) === sigOf({ on: "2026-01-01", what: "x", until: undefined }), "a date's signature ignores key order and empty keys");
say(hashOf("a") !== hashOf("b") && hashOf("abc") === hashOf("abc"), "fingerprints differ for different text and agree for the same");
const prof = profileOf({ host: "forms.example.com", email: "a@b.c", key: "k.e<y", doc: "0000" });
const plist = readXml(prof);
say(plist.kids[0]?.name === "plist" && /com\.apple\.caldav\.account/.test(prof) && /k\.e&lt;y/.test(prof) && /https:\/\/forms\.example\.com\/dav\//.test(prof),
  "the profile is a plist that sets up a CalDAV account, with the password escaped");
say(icsOfDate({ id: "t", what: "Night", on: "2026-10-01", until: "2026-10-02", every: "once", time: { s: "22:00", e: "02:00", tz: "Europe/London" } })
  .includes("DTEND;TZID=Europe/London:20261002T020000"),
  "a timed event that runs past midnight ends on the next day");

console.log(fails.length
  ? `\n${fails.length} FAILED:\n- ${fails.join("\n- ")}`
  : "\nthe calendar account says to a phone what the site says to him");
process.exit(fails.length ? 1 : 0);
