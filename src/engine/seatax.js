/**
 * The half-day test for the Seafarers' Earnings Deduction: the claim period breaks,
 * for good, the first time UK days exceed half the elapsed days. Columns mirror his
 * sheet: C out, D in, E total, F half, G ukTotal, H failed, I fail date, K in hand.
 *
 * `marginHalfDays` (F - G) is in half-days; `daysHeCanStay` is twice it, in days.
 * Reading one as the other is the mistake this module exists to prevent.
 *
 * All arithmetic is on whole UTC day numbers, never a Date parsed from a string:
 * a one-day shift decides the claim. The day he leaves counts as away and the day
 * he lands as home, so no day is counted twice. dayOf/isoOf duplicate the
 * rotation's helpers to avoid importing its holiday table; the bench asserts they match.
 */

const A_DAY = 864e5;

/** An ISO day as a whole number of days, parsed by slicing and never by Date. */
export const dayOf = (iso) =>
  Date.UTC(+String(iso).slice(0, 4), +String(iso).slice(5, 7) - 1, +String(iso).slice(8, 10)) / A_DAY;

/** A whole day number back to an ISO day. */
export const isoOf = (day) => new Date(day * A_DAY).toISOString().slice(0, 10);

/**
 * The constants, named for their units. A day away buys half a day of margin, so a
 * half-day of margin is worth two days (PER_DAY_OUT and DAYS_PER_HALF_DAY).
 */
export const SEATAX = {
  /* HMRC will not look at a claim period shorter than a year; the sheet never
     checked it, so this module reports it. */
  MIN_PERIOD: 365,
  /* The test itself: UK days must not exceed half the elapsed days. */
  HALF: 0.5,
  /* What one day outside the UK adds to the margin, in half-days. */
  PER_DAY_OUT: 0.5,
  /* And what one day inside it takes away. */
  PER_DAY_IN: -0.5,
  /* Half-days to mornings. This is the ×2 that gets read wrong. */
  DAYS_PER_HALF_DAY: 2,
  /* The other statutory test, which the spreadsheet has never done: a single
     unbroken spell at home longer than this ends the period on its own. */
  MAX_UK_SPELL: 183,
};

/*
 * Ports that read as home. His sheet has British ports in that column, which may
 * be right (it is often the port he sailed from), so this flags and never rejects.
 */
const BRITISH = [
  "uk", "u k", "gb", "great britain", "britain", "england", "scotland", "wales",
  "northern ireland", "fraserburgh", "cromarty", "scrabster", "rosyth",
  "lerwick", "scapa", "sullom voe", "montrose", "dundee", "leith", "grangemouth",
  "great yarmouth", "lowestoft", "teesside", "middlesbrough", "hull", "immingham",
  "grimsby", "blyth", "tyne", "newcastle", "sunderland", "liverpool", "birkenhead",
  "holyhead", "milford haven", "swansea", "cardiff", "bristol", "avonmouth",
  "southampton", "portsmouth", "plymouth", "falmouth", "poole", "dover", "harwich",
  "felixstowe", "london", "tilbury", "belfast", "londonderry", "stornoway",
  "glasgow", "greenock", "edinburgh", "stromness", "wick", "thurso", "shetland", "orkney",
];

/* Down to letters and single spaces, so that a comma or a capital cannot hide
   a match and so that "uk" cannot be found in the middle of Luanda. */
const words = (text) => ` ${String(text ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim()} `;

/** Does this port read as a British one? Evidence to check, never a verdict. */
export const looksBritish = (port) => {
  const said = words(port);
  return BRITISH.some((hint) => said.includes(` ${hint} `));
};

const round2 = (n) => Math.round(n * 2) / 2;

/**
 * The whole ledger, row by row and then totalled. Read in the order given, never
 * sorted or dropped: what looks wrong is reported in `problems`, not corrected.
 */
export function runLedger(absences = []) {
  const list = Array.isArray(absences) ? absences : [];
  const problems = [];
  const portWarnings = [];
  const rows = [];

  let prevBack = null;     /* the day he last came home, as a day number */
  let total = 0;           /* E, the elapsed period so far */
  let ukTotal = 0;         /* G, the running sum of days in */
  let outDays = 0;         /* the sum of column C, which is L1 on his sheet */
  let longestUkSpell = 0;
  let broken = false;      /* a gap in the record, after which nothing is knowable */

  for (let i = 0; i < list.length; i += 1) {
    const it = list[i] || {};
    const n = i + 1;
    const left = it.left ? dayOf(it.left) : null;
    const back = it.back ? dayOf(it.back) : null;
    const port = it.port == null ? "" : String(it.port);

    if (left == null) {
      problems.push(`absence ${n} has no day of leaving`);
      broken = true;
    }
    if (left != null && back != null && back < left) {
      problems.push(`absence ${n} comes home on ${it.back}, before it left on ${it.left}`);
    }
    if (left != null && prevBack != null && left < prevBack) {
      problems.push(`absence ${n} leaves on ${it.left}, before the ${isoOf(prevBack)} it last came home`);
    }
    if (back == null && i < list.length - 1) {
      problems.push(`absence ${n} has no day of return, and nothing after it can be counted`);
    }
    if (!port.trim()) portWarnings.push({ n, left: it.left ?? null, port: "", why: "no port written down" });
    else if (looksBritish(port)) portWarnings.push({ n, left: it.left ?? null, port, why: "reads as a British port" });

    /* Days in, on the leaving row. Unknown once the record has a hole in it. */
    const daysIn = broken || left == null ? null : (prevBack == null ? 0 : left - prevBack);
    if (daysIn != null) {
      ukTotal += daysIn;
      total += daysIn;
      longestUkSpell = Math.max(longestUkSpell, daysIn);
    }
    /* G and E as they stood on the morning he left — the numbers every test on
       this absence is made against. */
    const ukAtLeaving = daysIn == null ? null : ukTotal;
    const totalAtLeaving = daysIn == null ? null : total;

    const open = back == null;
    const daysOut = open || daysIn == null ? null : back - left;
    if (daysOut != null) {
      outDays += daysOut;
      total += daysOut;
    }

    const rowTotal = open || daysIn == null ? null : total;
    const half = rowTotal == null ? null : rowTotal * SEATAX.HALF;
    const marginHalfDays = half == null ? null : round2(half - ukAtLeaving);
    const daysHeCanStay = marginHalfDays == null ? null : marginHalfDays * SEATAX.DAYS_PER_HALF_DAY;
    const failed = half == null ? null : ukAtLeaving > half;
    const failOn = daysHeCanStay == null ? null : isoOf(back + daysHeCanStay);

    if (back == null) { prevBack = null; broken = true; } else { prevBack = back; }

    rows.push({
      n,
      left: it.left ?? null,
      back: it.back ?? null,
      port,
      portLooksBritish: looksBritish(port),
      portMissing: !port.trim(),
      daysIn,
      daysOut,
      totalAtLeaving,
      total: rowTotal,
      half,
      ukTotal: ukAtLeaving,
      /* In half-days, as his DAYS IN HAND column is from row 5 down. */
      marginHalfDays,
      /* And in mornings, which is what he actually wants to know. */
      daysHeCanStay,
      failOn,
      failed,
      open,
    });
  }

  const closed = rows.filter((r) => !r.open && r.total != null);
  const last = closed[closed.length - 1] || null;
  const away = rows.length > 0 && rows[rows.length - 1].open;
  const claimStart = rows[0]?.left ?? null;
  const lastDay = away ? rows[rows.length - 1].left : (last?.back ?? null);
  const totalDays = away ? (rows[rows.length - 1].totalAtLeaving ?? 0) : (last?.total ?? 0);
  const ukDays = away ? (rows[rows.length - 1].ukTotal ?? 0) : (last?.ukTotal ?? 0);
  const half = totalDays * SEATAX.HALF;
  const marginHalfDays = round2(half - ukDays);

  return {
    rows,
    claimStart,
    /* The last day the ledger knows about: the day he came home, or the day he
       left if he is still out there. */
    lastDay,
    away,
    totalDays,
    ukDays,
    outDays,
    half,
    marginHalfDays,
    daysHeCanStay: marginHalfDays * SEATAX.DAYS_PER_HALF_DAY,
    /* No fail date while he is out of the country: every day away moves it
       further off, so there is nothing to put in a diary. */
    failOn: away || last == null ? null : last.failOn,
    /* Broken once, broken for good — the period cannot be repaired by a later
       row, so this is any row and not the last one. */
    failed: rows.some((r) => r.failed === true),
    qualifies: totalDays >= SEATAX.MIN_PERIOD,
    shortBy: Math.max(0, SEATAX.MIN_PERIOD - totalDays),
    longestUkSpell,
    /* The other statutory test, reported and never folded into `failed`,
       because the sheet has never done it and a number that appears from
       nowhere is worse than one that is missing. */
    spellOver183: longestUkSpell > SEATAX.MAX_UK_SPELL,
    portWarnings,
    problems,
  };
}

/* The UK days run from the day he lands to the day before he leaves again, so
   a day falls in the UK if a return is on or before it and the next departure
   is after it. */
function ukDaysBy(rows, onDay) {
  let uk = 0;
  let inUk = false;
  let spellFrom = null;
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const left = r.left ? dayOf(r.left) : null;
    const back = r.back ? dayOf(r.back) : null;
    if (i > 0) {
      const prev = rows[i - 1].back ? dayOf(rows[i - 1].back) : null;
      if (prev != null && left != null) uk += Math.max(0, Math.min(onDay, left) - prev);
    }
    if (back != null && onDay >= back && (i === rows.length - 1 || onDay < dayOf(rows[i + 1].left))) {
      inUk = true;
      spellFrom = back;
      uk += onDay - back;
    }
  }
  return { uk, inUk, spellFrom };
}

/**
 * Where the claim stands on one day (today, or a day he might stay until). On a
 * return day it equals the ledger's row for that return; between returns it
 * carries the arithmetic forward a day at a time.
 */
export function standing(absences = [], onIso) {
  const led = runLedger(absences);
  const on = onIso ? dayOf(onIso) : null;
  if (on == null || led.claimStart == null) {
    return {
      on: onIso ?? null, before: true, total: 0, ukDays: 0, half: 0,
      marginHalfDays: 0, daysHeCanStay: 0, inUk: false, failOn: null, failed: false,
      qualifies: false, shortBy: SEATAX.MIN_PERIOD,
    };
  }
  const start = dayOf(led.claimStart);
  if (on < start) {
    return {
      on: onIso, before: true, total: 0, ukDays: 0, half: 0,
      marginHalfDays: 0, daysHeCanStay: 0, inUk: false, failOn: null, failed: false,
      qualifies: false, shortBy: SEATAX.MIN_PERIOD,
    };
  }

  const { uk, inUk, spellFrom } = ukDaysBy(led.rows, on);
  const total = on - start;
  const half = total * SEATAX.HALF;
  const marginHalfDays = round2(half - uk);
  const daysHeCanStay = marginHalfDays * SEATAX.DAYS_PER_HALF_DAY;
  return {
    on: onIso,
    before: false,
    total,
    ukDays: uk,
    half,
    marginHalfDays,
    daysHeCanStay,
    inUk,
    /* The last day he may still be here. Standing on it, the margin is exactly
       nought and the test still passes, because the test is strictly greater
       than; it is the morning after that takes the claim. */
    failOn: inUk ? isoOf(on + daysHeCanStay) : null,
    ukSpell: inUk && spellFrom != null ? on - spellFrom : 0,
    failed: uk > half,
    qualifies: total >= SEATAX.MIN_PERIOD,
    shortBy: Math.max(0, SEATAX.MIN_PERIOD - total),
  };
}

/**
 * The date in the diary: the last day he can still be in the UK.
 *
 * Null while he is away, because there is no such day — the margin grows for
 * as long as he stays out.
 */
export function mustLeaveBy(absences = []) {
  return runLedger(absences).failOn;
}

/**
 * How many days out he has to do to get a margin back up to `wantMargin`.
 *
 * `wantMargin` is in half-days, the same unit as `marginHalfDays`, because a
 * margin is what it asks for. A day away adds nothing to the UK total and one
 * to the elapsed total, so it buys half a day: the answer is always twice the
 * shortfall, and nought when he already has it.
 */
export function stayOutFor(absences = [], wantMargin = 0) {
  const have = runLedger(absences).marginHalfDays;
  const want = Number(wantMargin) || 0;
  if (have >= want) return 0;
  return Math.ceil((want - have) / SEATAX.PER_DAY_OUT);
}
