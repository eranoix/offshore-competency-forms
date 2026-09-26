/**
 * What this browser keeps, and whose it is. Every key belongs to an account,
 * nothing is read before we know who is asking, and signing in as somebody else
 * wipes what the browser was holding, so a shared laptop never shows the last
 * person's paperwork.
 */
const OWNER = "offshore-report:owner";

/* The keys the tool writes. Anything here is personal and is cleared when the
   account changes or the session ends. */
const MINE = ["trip-feedback:doc", "trip-feedback:work", "trip-feedback:profile", "caap:state", "offshore-report:phrases",
  "rotation:plan", "rotation:certs"];

let who = "";

/** Who the browser currently holds documents for. */
export const owner = () => who;

/** The key this account writes under. */
export const keyFor = (base) => (who ? `${base}@${who}` : "");

function wipe() {
  try {
    const drop = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      /* Both shapes: the old shared keys, and any account's own. */
      if (MINE.includes(key) || MINE.some((base) => key.startsWith(`${base}@`))) drop.push(key);
    }
    drop.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* no storage: nothing to clear */
  }
}

/**
 * Called once the site knows who is signed in. A different person — or the
 * first time, when the old shared keys may still be lying about — and the
 * browser is emptied before a single page reads from it.
 */
export function claim(id) {
  const next = String(id || "");
  let last = "";
  try {
    last = localStorage.getItem(OWNER) || "";
  } catch {
    last = "";
  }
  if (last !== next) {
    wipe();
    try {
      localStorage.setItem(OWNER, next);
    } catch {
      /* no storage */
    }
  }
  who = next;
  return who;
}

/**
 * Signing out takes the paperwork off the machine with it: the working copies,
 * anything held for the session, and any answer the browser cached on this
 * person's behalf.
 */
export function release() {
  wipe();
  try {
    localStorage.removeItem(OWNER);
  } catch {
    /* no storage */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* no storage */
  }
  /* The offline copy of the app may hold pages fetched while signed in. */
  try {
    if (typeof caches !== "undefined" && caches.keys) {
      caches.keys().then((names) =>
        names.forEach((name) =>
          caches.open(name).then((box) =>
            box.keys().then((reqs) =>
              reqs.forEach((req) => {
                if (/\/api\/|\/caap|\/trip-feedback|\/library|\/account/.test(req.url)) box.delete(req);
              }),
            ),
          ),
        ),
      );
    }
  } catch {
    /* no cache storage: nothing held */
  }
  who = "";
}

/* Machine settings, not personal work: they survive signing out on purpose. They
   still go through here so a key holding real work cannot be added on the wrong
   side by accident. */
const SETTINGS = ["offshore-report:sidebar", "caap:zoom"];

export function readSetting(key, fallback = "") {
  if (!SETTINGS.includes(key)) throw new Error(`${key} is not a setting — use readMine`);
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeSetting(key, value) {
  if (!SETTINGS.includes(key)) throw new Error(`${key} is not a setting — use writeMine`);
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* no storage: it still holds for this visit */
  }
}

export function readMine(base, fallback) {
  const key = keyFor(base);
  if (!key) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeMine(base, value) {
  const key = keyFor(base);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* no storage: it still works for this session */
  }
}
