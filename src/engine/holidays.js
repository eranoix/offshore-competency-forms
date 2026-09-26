/**
 * Public holidays computed from rules rather than listed dates, so they never go
 * stale. Rule shapes:
 *
 *   { on: "01-01" }                    a fixed day
 *   { easter: -47 }                    so many days from Easter Sunday
 *   { month: 8, weekday: 1, nth: -1 }  the last Monday in August
 *
 * Days that are not statutory but on which nobody works carry `observed: true`.
 */

/** Easter Sunday, anonymous Gregorian. Whole numbers, no dates, no zone. */
export function easterDay(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day) / 864e5;
}

const iso = (day) => new Date(day * 864e5).toISOString().slice(0, 10);

/** The nth weekday of a month, or the last one when nth is -1. */
function nthWeekday(year, month, weekday, nth) {
  if (nth < 0) {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const end = Date.UTC(year, month - 1, last) / 864e5;
    const back = (new Date(end * 864e5).getUTCDay() - weekday + 7) % 7;
    return end - back;
  }
  const first = Date.UTC(year, month - 1, 1) / 864e5;
  const forward = (weekday - new Date(first * 864e5).getUTCDay() + 7) % 7;
  return first + forward + (nth - 1) * 7;
}

/* Ordered by name, because every list of options on this site is, and the
   bench fails a select that is not. */
export const COUNTRIES = [
  {
    code: "BR",
    name: "Brazil",
    /* Under their official Brazilian names: New Year's Day, Carnival (two
       days), Good Friday, Tiradentes Day, Labour Day, Corpus Christi,
       Independence Day, Our Lady of Aparecida, All Souls' Day, Republic Day,
       Black Consciousness Day and Christmas. */
    rules: [
      { on: "01-01", what: "Confraternização Universal" },
      { easter: -48, what: "Carnaval", observed: true },
      { easter: -47, what: "Carnaval", observed: true },
      { easter: -2, what: "Sexta-feira Santa" },
      { on: "04-21", what: "Tiradentes" },
      { on: "05-01", what: "Dia do Trabalho" },
      { easter: 60, what: "Corpus Christi", observed: true },
      { on: "09-07", what: "Independência" },
      { on: "10-12", what: "Nossa Senhora Aparecida" },
      { on: "11-02", what: "Finados" },
      { on: "11-15", what: "Proclamação da República" },
      { on: "11-20", what: "Consciência Negra" },
      { on: "12-25", what: "Natal" },
    ],
  },
  {
    code: "NL",
    name: "Netherlands",
    rules: [
      { on: "01-01", what: "Nieuwjaarsdag" },
      { easter: -2, what: "Goede Vrijdag", observed: true },
      { easter: 1, what: "Tweede Paasdag" },
      { on: "04-27", what: "Koningsdag" },
      { on: "05-05", what: "Bevrijdingsdag", observed: true },
      { easter: 39, what: "Hemelvaartsdag" },
      { easter: 50, what: "Tweede Pinksterdag" },
      { on: "12-25", what: "Eerste Kerstdag" },
      { on: "12-26", what: "Tweede Kerstdag" },
    ],
  },
  {
    code: "NO",
    name: "Norway",
    rules: [
      { on: "01-01", what: "Nyttårsdag" },
      { easter: -3, what: "Skjærtorsdag" },
      { easter: -2, what: "Langfredag" },
      { easter: 1, what: "Andre påskedag" },
      { on: "05-01", what: "Arbeidernes dag" },
      { on: "05-17", what: "Grunnlovsdagen" },
      { easter: 39, what: "Kristi himmelfartsdag" },
      { easter: 50, what: "Andre pinsedag" },
      { on: "12-25", what: "Første juledag" },
      { on: "12-26", what: "Andre juledag" },
    ],
  },
  {
    code: "GB",
    name: "United Kingdom",
    rules: [
      { on: "01-01", what: "New Year's Day" },
      { easter: -2, what: "Good Friday" },
      { easter: 1, what: "Easter Monday" },
      { month: 5, weekday: 1, nth: 1, what: "Early May bank holiday" },
      { month: 5, weekday: 1, nth: -1, what: "Spring bank holiday" },
      { month: 8, weekday: 1, nth: -1, what: "Summer bank holiday" },
      { on: "12-25", what: "Christmas Day" },
      { on: "12-26", what: "Boxing Day" },
    ],
  },
];

const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));

/** What a country keeps in one year. Pure: same answer every time. */
export function holidaysIn(code, year) {
  const country = byCode.get(code) || byCode.get("BR");
  const easter = easterDay(year);
  const out = country.rules.map((rule) => {
    const on = rule.on
      ? `${year}-${rule.on}`
      : iso(rule.easter !== undefined
        ? easter + rule.easter
        : nthWeekday(year, rule.month, rule.weekday, rule.nth));
    return rule.observed ? { on, what: rule.what, observed: true } : { on, what: rule.what };
  });
  return out.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
}
