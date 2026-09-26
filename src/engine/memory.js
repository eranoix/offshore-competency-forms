/**
 * Phrase memory: every phrase that reaches paper is recorded and skipped next
 * time, so the finite bank does not repeat itself across documents. Only when a
 * score's bank runs dry does it recycle the oldest, or ask the AI for a fresh one.
 */
import { addPhrases, available, getPhrases } from "./cloud";

import { owner, readMine, writeMine } from "./vault";

const KEY = "offshore-report:phrases";
const CAP = 4000; // plenty for years of trips, still small in storage

/* Phrases already spent belong to the person who spent them. */
function load() {
  const list = readMine(KEY, []);
  return Array.isArray(list) ? list : [];
}
function save(list) {
  writeMine(KEY, list.slice(-CAP));
}

/* Empty until the account is known. This module is imported long before the
   site has asked who is signed in, and a phrase belongs to a person: read at
   import time there is no key to read under, and the answer is always none. */
let used = [];
let adopted = false;

/** What this account has spent, read from the browser the first time anyone
 *  asks after the account is known. Without this, a phrase recorded in the
 *  moment between opening the app and hydrate() would save over the record it
 *  had not read yet. */
function mine() {
  if (!adopted && owner()) {
    used = load();
    adopted = true;
  }
  return used;
}

const asSet = () => new Set(mine());

/* The account is the long memory: a phrase printed on the laptop is skipped on
   the phone too. The browser copy stays as the offline fallback. */
let pending = [];
let timer = null;

export async function hydrate() {
  /* Now the account is known, so this browser's own record can be read. It
     comes first: offline, it is the whole memory, and merging the server's
     copy into an empty list would throw away every phrase spent offline. */
  mine();
  if (!available()) return;
  try {
    const remote = await getPhrases();
    const merged = [...new Set(remote.concat(used))];
    if (merged.length !== used.length) {
      used = merged;
      save(used);
    }
  } catch {
    /* not signed in, or no signal: the local copy is enough */
  }
}

function flush() {
  const batch = pending;
  pending = [];
  timer = null;
  if (!batch.length || !available()) return;
  addPhrases(batch).catch(() => {});
}

export function remember(...texts) {
  const fresh = texts.filter((t) => t && !mine().includes(t));
  if (!fresh.length) return;
  used = used.concat(fresh);
  save(used);
  pending = pending.concat(fresh);
  clearTimeout(timer);
  timer = setTimeout(flush, 1500);
}

/** Oldest first, so recycling starts with what was used longest ago. */
export function pickFresh(pool, sessionUsed = new Set()) {
  const memory = asSet();
  const never = pool.filter((t) => !sessionUsed.has(t) && !memory.has(t));
  if (never.length) return { pool: never, exhausted: false };
  const notThisDocument = pool.filter((t) => !sessionUsed.has(t));
  if (notThisDocument.length) {
    const byAge = notThisDocument.sort((a, b) => used.indexOf(a) - used.indexOf(b));
    return { pool: byAge, exhausted: true };
  }
  return { pool, exhausted: true };
}

export const seenCount = () => mine().length;

export function forget() {
  mine();
  used = [];
  adopted = true;
  save(used);
}
