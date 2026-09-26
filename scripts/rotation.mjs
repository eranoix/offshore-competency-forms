/**
 * The rotation, held to arithmetic: each assertion is a way this breaks that
 * would not look broken (a DST turn of 27 days, a birthday counted twice).
 *
 *   node scripts/rotation.mjs
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  absencesIn, BLANK_PLAN, cleanTurns, cycleOf, dayOf, guessPattern, isoOf, landing, marksOf, monthTally,
  nextChange, runsIn, sheetsOf, STATE, STATES, statesAcross, turnsAcross, turnsOf, yearTally,
  hitchesOf, withHitch, changeHitch, dropHitch, dismissTurn, withSuggestions,
  agendaOf, payOf, ticketsAgainst, bothHome, shiftsAcross, yearsOf, barsOf, changeOccurrence, parseEvent, holidaySuggestions, takeHolidays, holidaysPending, clearPlan, clearable, dropDate, duplicateDate, eventsIn, moveEvent, pruneTrash, restoreDate, saidOn, spanOf, tally, withDay, withDays,
} from "../src/engine/rotation.js";
import { icsOf } from "../src/engine/ics.js";
import { COUNTRIES, easterDay, holidaysIn } from "../src/engine/holidays.js";

const fails = [];
/* A plan with the commonest rotation set — a new plan has none. */
const SET = { ...BLANK_PLAN, pattern: { on: 28, off: 28, hotelOut: 0, hotelBack: 0, travel: 0 } };
const say = (ok, label, got = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${got ? ` — ${got}` : ""}`);
  if (!ok) fails.push(label);
};

const plan = {
  ...SET,
  anchor: "2026-02-10",
  horizon: 10,
  dates: [
    { id: "d1", what: "Helena's birthday", on: "2014-03-14", every: "year" },
    { id: "d2", what: "Anniversary", on: "06-02", every: "year" },
  ],
};

/* Asked for by the parent below, to prove the answer does not depend on where
   the reader is sitting. Printed and nothing else. */
if (process.env.ROTATION_UNDER_TZ) {
  process.stdout.write(JSON.stringify(turnsOf(plan)));
  process.exit(0);
}

const turns = turnsOf(plan);
say(turns.length === 10, "ten turns asked for, ten turns given", `${turns.length}`);
say(turns[0].aboard.from === "2026-02-10", "the first one starts on the day it was told to", turns[0].aboard.from);
say(turns.every((t) => t.aboard.days === 28 && t.home.days === 28),
  "and every block is the 28 days the pattern says",
  `${turns.map((t) => t.aboard.days).join(",")}`);

let joined = true;
for (let i = 0; i < turns.length; i += 1) {
  if (dayOf(turns[i].home.from) !== dayOf(turns[i].aboard.to) + 1) joined = false;
  if (i && dayOf(turns[i].aboard.from) !== dayOf(turns[i - 1].home.to) + 1) joined = false;
}
say(joined, "no gap between going home and going back, and no day counted twice");

const me = fileURLToPath(import.meta.url);
const under = (tz) => execFileSync(process.execPath, [me], {
  env: { ...process.env, TZ: tz, ROTATION_UNDER_TZ: "1" },
}).toString();
const here = under("America/Sao_Paulo");
const there = under("Europe/London");
const far = under("Pacific/Auckland");
say(here === there && there === far,
  "the same rotation in São Paulo, London and Auckland", here === far ? "identical" : "they differ");

/* Brazil puts its clocks forward in the middle of October in the years it
   keeps summer time at all, and a turn spanning it is where a local Date would
   quietly give back 27 days. */
const october = turnsOf({ ...plan, anchor: "2026-10-01", horizon: 3 });
say(october.every((t) => t.aboard.days === 28 && t.home.days === 28),
  "and a turn across the October clock change is still 28 days",
  october.map((t) => t.aboard.days).join(","));

const newYear = turnsOf({ ...plan, anchor: "2026-12-20", horizon: 2 });
/* Christmas is on it because he took it: a holiday is never there by itself. */
const christmas = marksOf({ ...plan, anchor: "2026-12-20", holidays: { country: "BR", take: ["Natal"], asked: true } }, "2026-12-20", "2027-03-01");
const xmasDay = christmas.find((m) => m.on === "2026-12-25");
say(newYear[0].aboard.days === 28 && Boolean(xmasDay),
  "a turn across the new year keeps its length, and Christmas is in it",
  xmasDay ? `${xmasDay.on} ${xmasDay.what}` : "Christmas missing");

const late = turnsOf({ ...plan, slips: { 3: { from: "2026-07-03" } } });
const clean = cleanTurns(plan, 10);
const untouched = late.slice(0, 2).every((t, i) => t.aboard.from === clean[i].aboard.from);
const dragged = late.slice(2).every((t, i) => dayOf(t.aboard.from) - dayOf(clean[i + 2].aboard.from) === late[2].moved);
say(untouched, "a turn that slips leaves the ones before it alone");
say(dragged && late[2].moved !== 0,
  "and drags every one after it by the same number of days", `${late[2].moved} day(s)`);

const putBack = turnsOf({ ...plan, slips: {} });
say(JSON.stringify(putBack) === JSON.stringify(clean),
  "and taking the slip away puts the rotation back exactly where it was");

const window = { from: turns[0].aboard.from, to: turns[turns.length - 1].home.to };
const marks = marksOf(plan, window.from, window.to);
const birthdays = marks.filter((m) => m.what === "Helena's birthday");
const yearsInWindow = new Set(birthdays.map((m) => m.on.slice(0, 4)));
say(birthdays.length === yearsInWindow.size && birthdays.length > 0,
  "a yearly date falls once in each year it can, never twice",
  `${birthdays.length} in ${yearsInWindow.size} year(s)`);
say(birthdays.every((m) => m.note && +m.note > 0),
  "and one entered with its year says how old", birthdays[0]?.note || "no age");

/* The edge, which is where a crew change is. */
const edgePlan = {
  ...plan,
  dates: [
    { id: "e1", what: "First day aboard", on: turns[0].aboard.from, every: "once" },
    { id: "e2", what: "Last day aboard", on: turns[0].aboard.to, every: "once" },
    { id: "e3", what: "First day home", on: turns[0].home.from, every: "once" },
  ],
};
const edges = marksOf(edgePlan, window.from, window.to).filter((m) => m.sort === "family");
const placed = landing(turns, edges);
const inAboard = placed[0].aboard.marks.map((m) => m.what);
const inHome = placed[0].home.marks.map((m) => m.what);
say(inAboard.includes("First day aboard") && inAboard.includes("Last day aboard"),
  "a date on the first or the last day aboard is aboard", inAboard.join(" · ") || "neither");
say(inHome.includes("First day home"), "and the day he lands is at home", inHome.join(" · ") || "nothing");

const everything = landing(turns, marks);
const landed = everything.reduce((n, t) => n + t.aboard.marks.length + t.home.marks.length, 0);
say(landed === marks.length, "every date lands in exactly one place", `${marks.length} in, ${landed} out`);

const br2026 = holidaysIn("BR", 2026);
const carnival = br2026.filter((h) => h.what === "Carnaval").map((h) => h.on);
const goodFriday = br2026.find((h) => h.what === "Sexta-feira Santa");
say(carnival.includes("2026-02-17"), "Carnival 2026 falls on the 17th of February", carnival.join(" · "));
say(goodFriday?.on === "2026-04-03", "and Good Friday on the 3rd of April", goodFriday?.on || "missing");
say(br2026.some((h) => h.on === "2026-12-25") && br2026.some((h) => h.on === "2026-01-01"),
  "Christmas and New Year are in every year without a special case");

let mondays = true;
for (let y = 2026; y < 2036; y += 1) {
  const summer = holidaysIn("GB", y).find((h) => h.what === "Summer bank holiday");
  const at = new Date(`${summer.on}T00:00:00Z`);
  if (at.getUTCDay() !== 1 || at.getUTCMonth() !== 7) mondays = false;
}
say(mondays, "the last Monday in August is a Monday, and is in August, for ten years running");

const twice = JSON.stringify(holidaysIn("NO", 2029)) === JSON.stringify(holidaysIn("NO", 2029));
const strays = [2026, 2030, 2044].every((y) => holidaysIn("NL", y).every((h) => h.on.startsWith(String(y))));
say(twice, "asking twice gives the same answer");
say(strays, "and never a day outside the year that was asked for");
say(COUNTRIES.every((c, i) => i === 0 || COUNTRIES[i - 1].name.localeCompare(c.name) < 0),
  "the countries are in order, because every list on this site is",
  COUNTRIES.map((c) => c.name).join(" · "));
say(easterDay(2026) === Date.UTC(2026, 3, 5) / 864e5, "Easter 2026 is the 5th of April");

const aboardDay = turns[1].aboard.from;
const homeDay = turns[1].home.from;
const certs = [
  { id: "c1", what: "FOET", expires: aboardDay },
  { id: "c2", what: "ENG1 medical", expires: homeDay },
  { id: "c3", what: "MIST", expires: "2001-01-01" },
];
const withCerts = landing(turns, marksOf(plan, window.from, window.to, { certificates: certs }));
const atSea = withCerts[1].aboard.marks.some((m) => m.sort === "certificate" && m.what.startsWith("FOET"));
const ashore = withCerts[1].home.marks.some((m) => m.sort === "certificate" && m.what.startsWith("ENG1"));
say(atSea, "a certificate that runs out while he is aboard is on the turn he cannot renew it from");
say(ashore, "and one that runs out at home is on the turn he can");
const gone = marksOf(plan, "2000-01-01", window.to, { certificates: certs })
  .some((m) => m.what.startsWith("MIST"));
say(gone, "one that has already expired is not quietly dropped");

/* Three real 28/28 turns: 28 days aboard, then 28 at home before the next
   one starts. Written out rather than generated, so that a mistake in the
   arithmetic under test cannot also write the fixture. */
const three = [
  { start: "2025-01-05", end: "2025-02-01" },
  { start: "2025-03-02", end: "2025-03-29" },
  { start: "2025-04-27", end: "2025-05-24" },
];
const guessed = guessPattern(three);
say(guessed.on === 28 && guessed.off === 28, "three 28/28 trips read back as 28 on, 28 off",
  `${guessed.on}/${guessed.off}`);
const odd = guessPattern([...three, { start: "2025-06-21", end: "2025-06-23" }]);
say(odd.on === 28, "and one trip cut short does not redefine the rotation", `${odd.on}/${odd.off}`);
say(guessPattern([three[0]]).on === 28 && guessPattern([]).on === 28,
  "one trip and no trips both fall back to the usual, without throwing");

const full = {
  ...plan,
  horizon: 12,
  slips: { 3: { from: "2026-07-03" }, 5: { from: "2026-11-01", to: "2026-12-06" }, 8: { from: "2027-06-01" } },
  dates: Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, what: `A date number ${i}`, on: "2014-03-14", every: "year" })),
};
const kept = JSON.stringify(full).length;
say(kept < 4096, "a whole plan is a small thing to keep", `${kept} bytes`);

say(sheetsOf(turnsOf({ ...plan, horizon: 17 }), 8).length === 3, "seventeen turns need three sheets");
const soon = nextChange(turns, "2026-02-01");
say(soon?.kind === "fly out" && soon.inDays === 9, "the next crew change is counted from today",
  soon ? `${soon.kind} in ${soon.inDays} days` : "none");
say(isoOf(dayOf("2026-03-14")) === "2026-03-14", "a day survives the round trip to a number and back");

/* A night in a hotel either side and a day in the air each way. Two of those
   four are taken out of the time at home and two are added to the turn, which
   is the whole reason the cycle has to be worked out rather than added up. */
const five = {
  ...plan,
  anchor: "2026-01-28",
  horizon: 8,
  pattern: { on: 28, off: 28, hotelOut: 2, hotelBack: 1, travel: 1 },
};

const plain = turnsOf({ ...plan, pattern: { on: 28, off: 28 } });
const zeroed = turnsOf({ ...plan, pattern: { on: 28, off: 28, hotelOut: 0, hotelBack: 0, travel: 0 } });
say(JSON.stringify(plain) === JSON.stringify(zeroed),
  "a plan with no hotel and no flights is the plan there was before they existed");
say(plain.every((t) => t.legs.length === 2 && t.legs[0].state === "aboard" && t.legs[1].state === "home"),
  "and it runs through two states, the way it always did",
  plain[0].legs.map((l) => l.state).join(" → "));

const cycle = cycleOf(five);
say(cycle === 28 + 1 + 1 + 28, "the cycle is the days on, the hotel back, the flight home and the days off",
  `${cycle} days`);
say(cycle !== 28 + 28 + 2 + 1 + 2,
  "and is not the sum of the parts, which is what a reader adds up and is three days out",
  `${cycle}, not ${28 + 28 + 2 + 1 + 2}`);

const sails = turnsOf(five).map((t) => dayOf(t.aboard.from));
const gaps = sails.slice(1).map((d, i) => d - sails[i]);
say(gaps.every((g) => g === cycle), "sailing day to sailing day is that cycle, every single turn",
  gaps.join(","));

let tiled = true;
let borrowed = true;
const five8 = turnsOf(five);
for (const t of five8) {
  for (let i = 1; i < t.legs.length; i += 1) {
    if (dayOf(t.legs[i].from) !== dayOf(t.legs[i - 1].to) + 1) tiled = false;
  }
  /* A turn is longer than its cycle by exactly the part that was borrowed from
     the time at home before it — the hotel nights out and the flight to them.
     That difference is the whole reason the cycle is not the sum of the parts. */
  if (t.legs.map((l) => l.days).reduce((a, b) => a + b, 0) !== cycle + 2 + 1) tiled = false;
}
say(tiled, "a turn runs through its five states with no gap and no day counted twice",
  `${five8[0].legs.map((l) => l.days).reduce((a, b) => a + b, 0)} days of legs on a ${cycle}-day cycle`);
for (let i = 1; i < five8.length; i += 1) {
  const off = five8[i - 1].home;
  const away = five8[i].legs[0];
  if (!(dayOf(away.from) > dayOf(off.from) && dayOf(away.from) <= dayOf(off.to))) borrowed = false;
}
say(borrowed, "the way out is taken out of the days off before it, never added to the end of them",
  `${five8[1].legs[0].from} falls inside ${five8[0].home.from} → ${five8[0].home.to}`);
say(turnsOf(five)[1].legs.map((l) => l.state).join(" ") === "out hotel aboard hotel back home",
  "out, hotel, aboard, hotel, home in the air, home",
  turnsOf(five)[1].legs.map((l) => `${STATE[l.state].mark}${l.days}`).join(" "));
say(STATES.length === 5 && STATES.every((s) => s.mark && s.label && s.short),
  "five states, each with a word and a mark of its own — colour alone prints as nothing",
  STATES.map((s) => `${s.mark} ${s.label}`).join(" · "));

const year = yearTally(five, 2026);
say(year.days === 365 && year.out + year.hotel + year.aboard + year.back + year.home + year.none === year.days,
  "every day of the year is in exactly one of the five states, or not planned",
  `${year.out}+${year.hotel}+${year.aboard}+${year.back}+${year.home} + ${year.none} not planned = ${year.days}`);
say(year.none === dayOf("2026-01-28") - dayOf("2026-01-01") - 3,
  "and the days not planned are exactly the ones before the rotation's first leg — never counted at home", `${year.none}`);
say(year.abroad === year.aboard + year.hotel + year.travelling && year.inCountry === year.days - year.none - year.abroad,
  "out of the country is the ship, the hotel and the air; in the country is the rest",
  `${year.abroad} out, ${year.inCountry} in`);
const grounded = yearTally(five, 2026, { flights: false });
say(grounded.abroad === year.abroad - year.travelling && grounded.aboard === year.aboard,
  "not counting the flying days moves only the flying days",
  `${year.abroad} → ${grounded.abroad}`);
say(year.hotel > 0 && year.hotel === 18,
  "the hotel days are counted as neither aboard nor at home — the days a tax year turns on",
  `${year.hotel} nights`);

const months = Array.from({ length: 12 }, (_, m) => monthTally(five, 2026, m));
const summed = months.reduce((n, t) => ({
  out: n.out + t.out, hotel: n.hotel + t.hotel, aboard: n.aboard + t.aboard,
  back: n.back + t.back, home: n.home + t.home, days: n.days + t.days,
}), { out: 0, hotel: 0, aboard: 0, back: 0, home: 0, days: 0 });
say(["out", "hotel", "aboard", "back", "home", "days"].every((k) => summed[k] === year[k]),
  "the twelve months add up to the year, state by state",
  `${summed.days} days in the months, ${year.days} in the year`);
const leap = yearTally(five, 2028);
say(leap.days === 366, "and a leap year has the day it is owed", `${leap.days}`);

/* Reaching backwards. The dashboard is asked about last year as often as next,
   and a projection that only counts forwards from the anchor answers by
   guessing — which is the shift that has no symptom. */
const reached = turnsAcross(five, "2024-01-01", "2027-12-31");
const forward = turnsOf(five, { count: 8 });
say(forward.every((t) => reached.find((r) => r.n === t.n)?.aboard.from === t.aboard.from),
  "reaching back to 2024 does not move a single turn in front of the anchor");
const beforeAnchor = reached.filter((r) => r.n < 1);
say(beforeAnchor.length === 0 && statesAcross(five, "2025-06-01", "2025-06-30").every((st) => st === "none"),
  "and there is no turn before the first one: the months before the rotation starts are not planned, not guessed",
  `${beforeAnchor.length} turn(s) behind the anchor`);
const slipped = turnsAcross({ ...five, slips: { 3: { from: "2026-06-01" } } }, "2024-01-01", "2026-12-31");
say(slipped.find((t) => t.n === 3)?.aboard.from === "2026-06-01",
  "a slip stays on the turn it was put on, however far back the window reaches",
  slipped.find((t) => t.n === 3)?.aboard.from || "lost");

const septemberRuns = runsIn(five, "2026-09-01", "2026-09-30");
say(septemberRuns.reduce((n, r) => n + r.days, 0) === 30, "the runs of a month cover the month exactly",
  septemberRuns.map((r) => `${STATE[r.state].mark}${r.days}`).join(" "));
say(septemberRuns.every((r, i) => i === 0 || r.state !== septemberRuns[i - 1].state),
  "and no two of them in a row are the same state");
say(septemberRuns[0].whole === false,
  "a stretch that started before the month says so, rather than claiming to be short",
  `${septemberRuns[0].days} days of a longer one`);

const away = absencesIn(five, "2026-01-01", "2026-12-31");
say(away.every((a) => a.days === dayOf(a.to) - dayOf(a.from) + 1), "every absence is as long as it says");
say(away.reduce((n, a) => n + a.days, 0) === year.days - year.home - year.none,
  "the absences account for every day not spent at home",
  `${away.reduce((n, a) => n + a.days, 0)} of ${year.days - year.home}`);
say(away.every((a) => statesAcross(five, a.from, a.to).every((s) => s !== "home")),
  "and no day at home is hidden inside one");
const landingAndLeaving = away.every((a, i) => i === 0 || dayOf(a.from) > dayOf(away[i - 1].to) + 1);
say(landingAndLeaving, "two absences are never left touching, which would be one absence written twice");


/* A day he has told the site about beats the pattern on that day only, and
   moves the count with it, or the calendar and the year totals disagree. */
console.log("\nand a day he tells it about beats the pattern, on that day only");

const asPlanned = statesAcross(five, "2026-03-01", "2026-03-31");
const asTold = withDay(five, "2026-03-10", "hotel");
const toldStates = statesAcross(asTold, "2026-03-01", "2026-03-31");
say(toldStates[9] === "hotel", "the day he named is what he said it was", toldStates[9]);
say(toldStates.filter((st, i) => st !== asPlanned[i]).length === 1,
  "and not one other day moved with it",
  `${toldStates.filter((st, i) => st !== asPlanned[i]).length} day(s) different`);
say(saidOn(asTold, "2026-03-10") === "hotel" && saidOn(asTold, "2026-03-11") === null,
  "and the plan can say which days were told and which were worked out");

const countedPlain = tally(five, "2026-03-01", "2026-03-31");
const countedTold = tally(asTold, "2026-03-01", "2026-03-31");
say(countedTold.hotel === countedPlain.hotel + 1 && countedTold.days === countedPlain.days,
  "the count moves with the calendar, because both read the same array",
  `hotel ${countedPlain.hotel} → ${countedTold.hotel}`);
say(countedTold.out + countedTold.hotel + countedTold.aboard + countedTold.back + countedTold.home === countedTold.days,
  "and the five states still account for every day of the month", `${countedTold.days}`);

/* Agreeing with the pattern is not a fact worth keeping: kept, that day would
   stop following the pattern the day the pattern changes, silently. */
const agrees = withDay(five, "2026-03-10", asPlanned[9]);
say(Object.keys(agrees.days || {}).length === 0,
  "a day set to what the plan already says is not written down at all",
  JSON.stringify(agrees.days));

const asBefore = withDay(asTold, "2026-03-10", asPlanned[9]);
say(JSON.stringify(statesAcross(asBefore, "2026-03-01", "2026-03-31")) === JSON.stringify(asPlanned),
  "and putting a told day back reproduces the projection exactly");

const toldRuns = runsIn(asTold, "2026-03-01", "2026-03-31");
say(toldRuns.reduce((n, r) => n + r.days, 0) === toldStates.length,
  "the stretches still cover the month exactly once", `${toldRuns.reduce((n, r) => n + r.days, 0)} of ${toldStates.length}`);
say(toldRuns.every((r, i) => i === 0 || r.state !== toldRuns[i - 1].state),
  "and a told day that splits a stretch leaves three stretches, not two the same");

const nonsense = withDay(five, "2026-03-12", "tuesday");
say(!(nonsense.days || {})["2026-03-12"], "a state that is not one of the five is refused rather than stored");
say(statesAcross({ ...five, days: { "not-a-date": "aboard" } }, "2026-03-01", "2026-03-02")
  .join() === asPlanned.slice(0, 2).join(),
  "and neither is something that is not a date");


console.log("\nand a stretch has a start and an end, like an event");

const trip = { ...five, dates: [
  { id: "f", what: "Holiday", on: "2026-03-05", until: "2026-03-08", every: "once" },
  { id: "x", what: "Christmas away", on: "2025-12-30", until: "2026-01-02", every: "year" },
  { id: "b", what: "Birthday", on: "1990-06-02", every: "year" },
] };
const hol = marksOf(trip, "2026-03-01", "2026-03-31").filter((mk) => mk.id === "f");
say(hol.length === 4 && hol[0].on === "2026-03-05" && hol[3].on === "2026-03-08",
  "a four-day stretch is on each of its four days, and on no other", hol.map((mk) => mk.on.slice(5)).join(" "));
say(hol.every((mk, i) => mk.note === `${i + 1}/4`), "and each day says which of the four it is",
  hol.map((mk) => mk.note).join(" "));
const xmas = marksOf(trip, "2026-12-01", "2027-01-31").filter((mk) => mk.id === "x");
say(xmas.length === 4 && xmas[3].on === "2027-01-02",
  "a yearly stretch that crosses New Year is whole on both sides of it", xmas.map((mk) => mk.on).join(" "));
say(xmas.every((mk) => !/^\d+ ·/.test(mk.note)), "and is not given an age, which is for a birthday",
  xmas[0]?.note);
const bday = marksOf(trip, "2026-06-01", "2026-06-30").filter((mk) => mk.id === "b");
say(bday.length === 1 && bday[0].note === "36", "a birthday is still one day, with its age", bday[0]?.note);
say(spanOf({ on: "2026-01-01", until: "2099-01-01" }) === 365,
  "an end typed into the wrong century is held to a year, not a hundred thousand marks");
say(spanOf({ on: "2026-03-05", until: "2026-03-01" }) === 0, "and an end before the start is no stretch at all");

const week = withDays(five, "2026-03-16", "2026-03-10", "hotel");
const weekStates = statesAcross(week, "2026-03-10", "2026-03-16");
say(weekStates.every((st) => st === "hotel"), "a stretch set backwards is the same stretch", weekStates.join(","));
say(JSON.stringify(withDays(week, "2026-03-10", "2026-03-16", null).days) === "{}",
  "and putting the stretch back leaves nothing behind");


console.log("\nand an event is one bar across its days, not a mark on each");
const cal = { ...five, days: Object.fromEntries([15, 16, 17, 18, 19, 20, 21, 22, 23].map((d) => [`2026-09-${d}`, "hotel"])),
  dates: [{ id: "f", what: "Time off", on: "2026-09-08", until: "2026-09-13", every: "once" },
    { id: "b", what: "Birthday", on: "2026-09-20", every: "once" }] };
const ev = eventsIn(cal, "2026-08-31", "2026-10-04");
const hotelRun = ev.filter((e) => e.sort === "state" && e.state === "hotel");
say(hotelRun.length === 1 && hotelRun[0].from === "2026-09-15" && hotelRun[0].to === "2026-09-23",
  "nine told days in a row are one stretch, with its start and its end", hotelRun.map((e) => `${e.from}→${e.to}`).join(" "));
const pieces = barsOf(ev, "2026-08-31", 5);
const hotelBars = pieces.filter((p) => p.item === hotelRun[0]);
say(hotelBars.length === 2 && hotelBars[0].head && !hotelBars[0].tail && !hotelBars[1].head && hotelBars[1].tail,
  "a stretch across a week's end is two pieces: one that starts, one that ends",
  hotelBars.map((p) => `r${p.row} c${p.c0}-${p.c1}${p.head ? " start" : ""}${p.tail ? " end" : ""}`).join(" · "));
const timeOff = pieces.find((p) => p.item.id === "f");
say(timeOff && timeOff.c0 === 1 && timeOff.c1 === 6 && timeOff.head && timeOff.tail,
  "and a stretch inside one week is one piece, Tuesday to Sunday", timeOff && `c${timeOff.c0}-${timeOff.c1}`);
const clash = pieces.filter((p) => p.row === 2);
const overlap = clash.some((a, i) => clash.some((b, j) => i < j && a.lane === b.lane && a.c0 <= b.c1 && b.c0 <= a.c1));
say(!overlap, "no two bars in a week share a lane where they cover the same day",
  clash.map((p) => `${p.item.what}:L${p.lane}`).join(" "));
const bd = clash.find((p) => p.item.id === "b");
const ht = clash.find((p) => p.item === hotelRun[0]);
say(bd && ht && ht.lane < bd.lane, "and the longer one takes the upper lane, as in a calendar", `${ht?.lane} over ${bd?.lane}`);


console.log("\nand dragging a bar moves the event, or stretches one end of it");
const timeOffItem = eventsIn(cal, "2026-08-31", "2026-10-04").find((e) => e.id === "f");
const moved = moveEvent(cal, timeOffItem, "2026-09-10", "2026-09-15");
const nf = moved.dates.find((d) => d.id === "f");
say(nf.on === "2026-09-10" && nf.until === "2026-09-15" && nf.what === "Time off" && nf.every === "once",
  "the whole event moves two days and keeps what it is", `${nf.on} → ${nf.until}`);
const shrunk = moveEvent(cal, timeOffItem, "2026-09-08", "2026-09-08").dates.find((d) => d.id === "f");
say(shrunk.on === "2026-09-08" && !("until" in shrunk), "dragged down to one day it is a one-day event, not an end equal to its start");
const bdayY = { ...five, dates: [{ id: "y", what: "Birthday", on: "1990-06-02", every: "year" }] };
const yItem = eventsIn(bdayY, "2026-06-01", "2026-06-30").find((e) => e.id === "y");
const yMoved = moveEvent(bdayY, yItem, "2026-06-05", "2026-06-05").dates[0];
say(yMoved.on === "1990-06-05", "a yearly date moves its day and keeps the year it was born in", yMoved.on);
const hotelItem = eventsIn(cal, "2026-08-31", "2026-10-04").find((e) => e.sort === "state" && e.state === "hotel");
const hMoved = moveEvent(cal, hotelItem, "2026-09-17", "2026-09-25");
const hStates = statesAcross(hMoved, "2026-09-15", "2026-09-25");
say(hStates.slice(2).every((st) => st === "hotel"), "a told stretch lands on its new days in the same state", hStates.join(","));
say(!saidOn(hMoved, "2026-09-15") && !saidOn(hMoved, "2026-09-16"),
  "and the days it left go back to the rotation, with nothing left behind on them");
const hol2 = { sort: "holiday", what: "Independência", from: "2026-09-07", to: "2026-09-07" };
say(moveEvent(cal, hol2, "2026-09-09", "2026-09-09") === cal, "a holiday is not his to move and comes back untouched");


console.log("\nand a deleted event goes to the bin for thirty days, and comes back whole");
const binned = dropDate(cal, "f", "2026-09-25");
say(!binned.dates.some((d) => d.id === "f") && binned.trash[0].id === "f" && binned.trash[0].deleted === "2026-09-25",
  "deleting takes it off the calendar and puts it in the bin, dated");
say(!eventsIn(binned, "2026-08-31", "2026-10-04").some((e) => e.id === "f"), "and it is not drawn any more");
const back2 = restoreDate(binned, "f");
say(JSON.stringify(back2.dates.find((d) => d.id === "f")) === JSON.stringify(cal.dates.find((d) => d.id === "f"))
  && back2.trash.length === 0, "putting it back gives exactly what was deleted, and empties the bin");
say(pruneTrash(binned, "2026-10-20").trash.length === 1 && pruneTrash(binned, "2026-10-26").trash.length === 0,
  "the bin keeps it thirty days and not thirty-one");
say(dropDate(cal, "nope") === cal, "deleting something that is not there changes nothing");
const dup = duplicateDate(cal, "f", "f2").dates.find((d) => d.id === "f2");
say(dup && dup.on === "2026-09-14" && dup.until === "2026-09-19" && dup.what === "Time off",
  "a copy is its own event, the same length, starting the day after", dup && `${dup.on} → ${dup.until}`);


console.log("\nand a yearly event can be changed for one year, from one on, or for all");
const yr = { ...five, dates: [{ id: "c", what: "Christmas", on: "2020-12-25", every: "year" }] };
const occ = (plan, y) => eventsIn(plan, `${y}-12-01`, `${y}-12-31`).filter((e) => e.sort === "family");
const item27 = occ(yr, 2027)[0];
const one = changeOccurrence(yr, item27, "one", { kind: "delete" });
say(occ(one, 2027).length === 0 && occ(one, 2026).length === 1 && occ(one, 2028).length === 1,
  "deleting only this one takes 2027 out and leaves every other year");
const fol = changeOccurrence(yr, item27, "following", { kind: "delete" });
say(occ(fol, 2026).length === 1 && occ(fol, 2027).length === 0 && occ(fol, 2030).length === 0,
  "deleting this and following stops it after 2026");
const all = changeOccurrence(yr, item27, "all", { kind: "delete" }, "x", "2026-09-25");
say(occ(all, 2026).length === 0 && all.trash?.[0]?.id === "c", "deleting all of them puts the series in the bin");
const mv1 = changeOccurrence(yr, item27, "one", { kind: "move", from: "2027-12-24", to: "2027-12-24" }, "m1");
const o27 = occ(mv1, 2027);
say(o27.length === 1 && o27[0].from === "2027-12-24" && occ(mv1, 2028)[0].from === "2028-12-25",
  "moving only this one moves 2027 and leaves 2028 where it was", o27.map((e) => e.from).join(" "));
const mvF = changeOccurrence(yr, item27, "following", { kind: "move", from: "2027-12-24", to: "2027-12-24" }, "m2");
say(occ(mvF, 2026)[0].from === "2026-12-25" && occ(mvF, 2027)[0].from === "2027-12-24" && occ(mvF, 2029)[0].from === "2029-12-24",
  "moving this and following leaves 2026 and moves every year from 2027");
const ed1 = changeOccurrence(yr, item27, "one", { kind: "edit", patch: { what: "Christmas at sea" } }, "e1");
say(occ(ed1, 2027)[0].what === "Christmas at sea" && occ(ed1, 2026)[0].what === "Christmas",
  "renaming only this one renames 2027 alone");
say(parseEvent("Time off 8 to 13 sep", "2026-09-25").on === "2026-09-08", "a date said without a year is the one nearest today, before or after");
const pe = parseEvent("course offshore 28/9 for 5 days #course", "2026-09-25");
say(pe.what === "Course offshore" && pe.on === "2026-09-28" && pe.until === "2026-10-02" && pe.cat === "course",
  "a sentence gives the name, the start, the end and the category", JSON.stringify(pe));
say(parseEvent("trip 28/12 to 3/1", "2026-09-25").until === "2027-01-03", "an end that crosses New Year goes into the next year");
say(parseEvent("buy a present", "2026-09-25").on === null, "and a sentence with no date in it is given none, rather than a guess");


console.log("\nand the long view: shifts, a crewmate's rotation, the agenda, five years");
const sw = { ...SET, anchor: "2026-01-01", pattern: { on: 28, off: 28, shift: "swing" } };
const sh = shiftsAcross(sw, "2026-01-01", "2026-01-28");
say(sh.slice(0, 14).every((x) => x === "day") && sh.slice(14).every((x) => x === "night"),
  "a 28-day swing hitch works fourteen days and then fourteen nights", `${sh.filter((x) => x === "day").length} days · ${sh.filter((x) => x === "night").length} nights`);
say(shiftsAcross(sw, "2026-01-29", "2026-02-25").every((x) => x === null), "and a day at home is neither");
say(shiftsAcross({ ...sw, pattern: { on: 28, off: 28 } }, "2026-01-01", "2026-01-28").every((x) => x === null),
  "a rotation that does not say is never given shifts it did not ask for");
const partner = { who: "Ana", pattern: { on: 14, off: 14 }, anchor: "2026-01-08" };
const both = bothHome({ ...SET, anchor: "2026-01-01", pattern: { on: 28, off: 28 } }, partner, "2026-01-01");
say(both && both.from === "2026-01-29" && statesAcross({ ...SET, ...partner }, both.from, both.from)[0] === "home",
  "the first day you are both home is found, and it is a day you are both home", both && `${both.from}, ${both.days} days`);
const ag = agendaOf(cal, "2026-09-01", 60);
say(ag.every((it, i) => i === 0 || ag[i - 1].from <= it.from), "the agenda is in date order");
say(ag.some((it) => it.sort === "change" && it.what === "Back home"), "and it carries the crew changes, not only the events");
const yrs = yearsOf(five, 2026, 5);
say(yrs.length === 5 && yrs.every((r) => r.months.reduce((n, m) => n + m.days, 0) === r.total.days),
  "five years, each of whose twelve months add up to the year", yrs.map((r) => r.total.days).join(" "));


console.log("\nand what the days pay, and which ticket runs out aboard");
const payd = { ...SET, anchor: "2026-01-01", pattern: { on: 28, off: 28, travel: 1 },
  pay: { mode: "day", dayRate: 500, travelRate: 250, hotelRate: 0 } };
const jan = payOf(payd, "2026-01-01", "2026-01-31");
say(jan.total === jan.counted.aboard * 500 + (jan.counted.out + jan.counted.back) * 250,
  "a day rate pays the days aboard and the travel days at their own rate", `${jan.counted.aboard}×500 + ${jan.counted.out + jan.counted.back}×250 = ${jan.total}`);
const soldPlan = { ...payd, pay: { mode: "salary", monthly: 3100, soldRate: 300 }, days: { "2026-02-10": "aboard", "2026-02-11": "aboard" } };
const feb = payOf(soldPlan, "2026-02-01", "2026-02-28");
say(feb.sold === 2 && Math.round(feb.total) === 3100 + 600, "a salary is the month, and two days worked at home are two days sold on top", `${feb.sold} sold · ${Math.round(feb.total)}`);
say(Math.round(payOf(soldPlan, "2026-03-01", "2026-03-16").total) === Math.round(3100 * 16 / 31),
  "half a month of salary is paid pro rata by the days");
const tk = ticketsAgainst({ ...payd, anchor: "2025-11-06" }, [{ id: "a", what: "BOSIET", expires: "2026-01-20" }, { id: "b", what: "HUET", expires: "2026-02-10" }], "2026-01-05");
const bos = tk.find((t) => t.what === "BOSIET");
say(bos.aboardWhenItGoes && bos.renewBy &&  statesAcross({ ...payd, anchor: "2025-11-06" }, bos.renewBy, bos.renewBy)[0] === "home" && bos.renewBy < "2026-01-20",
  "a ticket that runs out aboard says so, and gives the last day at home to renew it", `${bos.expires} → renew by ${bos.renewBy}`);
say(tk[0].what === "BOSIET" && !tk.find((t) => t.what === "HUET").aboardWhenItGoes, "soonest first, and one that runs out at home is not flagged");


console.log("\nand the rotation goes out as a calendar feed the phone understands");
const feedPlan = { ...five, dates: [{ id: "f", what: "Time off, with family; and friends", on: "2026-10-30", until: "2026-11-02", every: "once" }] };
const ics = icsOf(feedPlan, { today: "2026-09-25", stamp: "20260925T000000Z", certificates: [{ id: "c", what: "BOSIET", expires: "2026-12-01" }] });
const icsLines = ics.split("\r\n");
say(icsLines[0] === "BEGIN:VCALENDAR" && ics.endsWith("END:VCALENDAR\r\n"), "it is one calendar, lines ended the way the standard says");
say(icsLines.every((l) => new TextEncoder().encode(l).length <= 75), "no line is longer than 75 bytes — long ones are folded");
const unfolded = ics.replace(/\r\n /g, "");
say(unfolded.includes("SUMMARY:Time off\\, with family\\; and friends") && unfolded.includes("DTSTART;VALUE=DATE:20261030") && unfolded.includes("DTEND;VALUE=DATE:20261103"),
  "an event keeps its commas and semicolons, and ends the day after its last, as all-day events do");
say((unfolded.match(/SUMMARY:🏠 Home in \d+ days?|SUMMARY:✈️ Back out in \d+ days?/g) || []).length === 14,
  "a countdown on each of the next fourteen days, so the widget is right whatever day it last fetched");
say(unfolded.includes("TRIGGER:-PT6H") && unfolded.includes("TRIGGER:-P30D"), "the crew change rings the evening before, the ticket a month before");
const uids = unfolded.match(/^UID:.*$/gm);
say(new Set(uids).size === uids.length, "every event has its own id, so the calendar updates them rather than piling up copies", `${uids.length} events`);
say(icsOf(feedPlan, { today: "2026-09-25", stamp: "20260925T000000Z" }) === icsOf(feedPlan, { today: "2026-09-25", stamp: "20260925T000000Z" }),
  "the same plan on the same day gives the same file to the byte");


console.log("\nand the calendar starts with nothing on it: holidays are offered, and only what he takes goes on");
const fresh = { ...SET, anchor: "2026-01-01" };
const ownOnly = (list) => list.filter((e) => e.sort !== "suggested" && e.sort !== "hitch");
say(marksOf(fresh, "2026-01-01", "2026-12-31").length === 0 && ownOnly(eventsIn(fresh, "2026-01-01", "2026-12-31")).length === 0,
  "a new plan has no events at all — not one holiday", `${marksOf(fresh, "2026-01-01", "2026-12-31").length} marks`);
say(holidaysPending(fresh), "and it has a suggestion waiting for an answer");
const offer = holidaySuggestions(fresh, 2026);
say(offer.length > 5 && offer.every((h) => !h.taken), "the country's holidays are offered, none of them taken", `${offer.length} offered`);
const took = takeHolidays(fresh, ["Natal", "Tiradentes"]);
const onIt = marksOf(took, "2026-01-01", "2027-12-31").filter((m) => m.sort === "holiday").map((m) => m.what);
say(onIt.filter((w) => w === "Natal").length === 2 && onIt.includes("Tiradentes") && !onIt.includes("Carnaval"),
  "only the two he took are on the calendar, every year, and no other", [...new Set(onIt)].join(", "));
say(!holidaysPending(took) && !holidaysPending(takeHolidays(fresh, [])),
  "and once he has answered — even with no — he is not asked again");


console.log("\nand the calendar can be cleared, of exactly what was chosen");
const loaded = { ...cal, notes: { "2026-09-02": "x" }, slips: { 3: { from: "2026-06-01" } }, holidays: { country: "BR", take: ["Natal"], asked: true },
  linked: [{ id: "g", url: "https://calendar.google.com/x" }], others: [{ who: "Ana" }] };
const cnt = clearable(loaded);
say(cnt.events === 2 && cnt.days === 9 && cnt.notes === 1 && cnt.slips === 1 && cnt.holidays === 1 && cnt.linked === 1 && cnt.others === 1,
  "it can say how many of each thing are on the calendar", JSON.stringify(cnt));
const cleared = clearPlan(loaded, { events: true, days: true, notes: true, slips: true, holidays: true, linked: true, others: true }, "2026-09-25");
say(Object.values(clearable(cleared)).every((n) => n === 0) && ownOnly(eventsIn(cleared, "2026-01-01", "2026-12-31")).length === 0,
  "cleared of everything, it has nothing on it at all");
say(cleared.trash.filter((d) => d.deleted === "2026-09-25").length === 2 && cleared.pattern === loaded.pattern && cleared.anchor === loaded.anchor,
  "the events go to the bin, and the rotation itself is left alone unless asked");
say(holidaysPending(cleared), "and clearing the holidays offers the suggestion again");
const only = clearPlan(loaded, { notes: true }, "2026-09-25");
say(only.dates.length === 2 && Object.keys(only.days).length === 9 && !Object.keys(only.notes).length,
  "clearing only the notes leaves every event and every day as it was");
const reset = clearPlan(loaded, { rotation: true }, "2026-09-25");
say(!reset.pattern && !Object.keys(reset.slips).length && !turnsOf(reset).length,
  "and resetting the rotation leaves no rotation at all — not a fresh 28/28 nobody chose");
const wiped = clearPlan(loaded, { rotation: true, days: true }, "2026-09-25");
const bare = yearTally(wiped, 2026);
say(bare.none === 365 && bare.aboard === 0 && bare.home === 0 && !runsIn(wiped, "2026-01-01", "2026-12-31").length,
  "cleared of the rotation and the days told, the year is empty: no day aboard, none at home, no stretch", `${bare.none} of 365 not planned`);
say(!turnsOf(BLANK_PLAN).length && statesAcross(BLANK_PLAN, "2026-09-01", "2026-09-30").every((st) => st === "none"),
  "a new plan starts the same way: nothing on the calendar until a rotation is set");

console.log("\nand the rotation is events: suggestions he accepts, and hitches that move the ones after them");
const rota = { ...SET, anchor: "2026-10-01", days: {}, dates: [] };
const sug = eventsIn(rota, "2026-10-01", "2027-01-31").filter((e) => e.sort === "suggested");
say(sug.map((e) => `${e.from}→${e.to}`).join(" ") === "2026-10-01→2026-10-28 2026-11-26→2026-12-23 2027-01-21→2027-02-17",
  "a rotation is offered as suggested stretches aboard, one event each — not a mark on every day", sug.map((e) => e.from).join(", "));
say(!eventsIn(rota, "2026-10-01", "2026-10-31").some((e) => e.sort === "state"), "and nothing is told about any single day");
/* He stayed four days longer than the suggestion. */
const longer = withHitch(rota, "2026-10-01", "2026-11-01", "h1");
const later = eventsIn(longer, "2026-10-01", "2027-01-31");
const hitch = later.find((e) => e.sort === "hitch");
const nextSug = later.find((e) => e.sort === "suggested");
say(hitch?.days === 32 && hitch.off === 32 && nextSug?.from === "2026-12-04",
  "32 days aboard on a 28/28 earns 32 at home, and the next suggestion moves to after them", `${hitch?.days} on, ${hitch?.off} off, next ${nextSug?.from}`);
const shorter = withHitch(rota, "2026-10-01", "2026-10-21", "h1");
say(eventsIn(shorter, "2026-10-01", "2026-12-31").find((e) => e.sort === "suggested")?.from === "2026-11-12",
  "and 21 aboard earns 21 at home — the next one comes sooner");
const half = withHitch({ ...rota, pattern: { on: 28, off: 14 } }, "2026-10-01", "2026-11-01", "h1");
say(eventsIn(half, "2026-10-01", "2026-12-31").find((e) => e.sort === "hitch")?.off === 16,
  "on a 28/14 the time at home is half the time aboard, whatever it was");
const moreHome = changeHitch(longer, "h1", { off: 40 });
say(eventsIn(moreHome, "2026-10-01", "2027-01-31").find((e) => e.sort === "suggested")?.from === "2026-12-12"
  && eventsIn(changeHitch(moreHome, "h1", { off: null }), "2026-10-01", "2027-01-31").find((e) => e.sort === "suggested")?.from === "2026-12-04",
  "the days at home can be set by hand, more or fewer, and put back to the proportional ones");
const stays = statesAcross(longer, "2026-10-01", "2026-12-04");
say(stays.slice(0, 32).every((x) => x === "aboard") && stays.slice(32, 64).every((x) => x === "home") && stays[64] === "aboard",
  "and the days count as the events say: 32 aboard, 32 at home, then aboard again");
const noSug = withSuggestions(longer, false);
say(!eventsIn(noSug, "2026-10-01", "2027-06-30").some((e) => e.sort === "suggested") && eventsIn(noSug, "2026-10-01", "2027-06-30").some((e) => e.sort === "hitch")
  && statesAcross(noSug, "2027-03-01", "2027-03-01")[0] === "none",
  "clearing the suggestions leaves his hitches and nothing guessed after them");
say(eventsIn(withSuggestions(noSug, true), "2026-10-01", "2027-01-31").some((e) => e.sort === "suggested"), "and they can be put back");
const dis = dismissTurn(rota, "2026-11-26");
say(!eventsIn(dis, "2026-11-01", "2026-12-31").some((e) => e.sort === "suggested") && statesAcross(dis, "2026-12-01", "2026-12-01")[0] === "home",
  "one suggestion turned down is gone, and its days are at home rather than unknown");
const pulled = moveEvent(rota, sug[1], "2026-11-28", "2026-12-27");
say(hitchesOf(pulled).length === 1 && hitchesOf(pulled)[0].from === "2026-11-28" && hitchesOf(pulled)[0].to === "2026-12-27",
  "dragging a suggestion accepts it where it was put");
say(!hitchesOf(dropHitch(longer, "h1")).length && eventsIn(dropHitch(longer, "h1"), "2026-10-01", "2026-10-31").some((e) => e.sort === "suggested"),
  "and a hitch taken off gives the rotation's suggestion back");
const two = withHitch(withHitch(rota, "2026-10-01", "2026-10-28", "a"), "2026-10-20", "2026-11-05", "b");
say(hitchesOf(two).length === 1 && hitchesOf(two)[0].id === "b", "two hitches never share a day: the new one replaces what it overlaps");
const bare2 = { ...BLANK_PLAN, hitches: [{ id: "x", from: "2026-10-01", to: "2026-10-10" }] };
say(statesAcross(bare2, "2026-10-01", "2026-10-11").join() === `${"aboard,".repeat(10)}none`,
  "with no rotation at all, a hitch is its days aboard and nothing is guessed after it");

console.log(fails.length
  ? `\n${fails.length} FAILED:\n- ${fails.join("\n- ")}`
  : "\nthe turns fall where they should, wherever the reader is sitting");
process.exit(fails.length ? 1 : 0);
