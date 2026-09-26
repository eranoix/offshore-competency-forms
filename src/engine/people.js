/**
 * The people who sign the paperwork. A name is remembered the first time it is
 * used and offered back with its position and relationship, so it is spelt the
 * same every time. The field stays free text: the list is a shortcut, never a cage.
 */
import { readMine, writeMine } from "./vault";
import { inOrder } from "./order";

const KEY = "caap:people";
/* Two spellings of one name are one person: case and spacing do not count. */
const same = (a, b) => key(a) === key(b);
const key = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

const read = () => {
  const got = readMine(KEY, []);
  return Array.isArray(got) ? got : [];
};

/** Everyone this account has named before, most used first. */
export function everyone() {
  return inOrder(read().filter((p) => p && p.name), (p) => p.name);
}

/** What is known about one name, or nothing. */
export const knownAs = (name) => (name ? read().find((p) => same(p.name, name)) || null : null);

/** Every position anybody has held, plus the ones shipped, in order. */
export function positions(extra = []) {
  const seen = new Map();
  for (const p of read()) {
    if (!p.position) continue;
    const k = key(p.position);
    seen.set(k, { text: p.position, used: (seen.get(k)?.used || 0) + (p.used || 1) });
  }
  const out = [...seen.values()].map((x) => x.text);
  for (const r of extra) if (!out.some((x) => same(x, r))) out.push(r);
  return inOrder(out);
}

/** Every vessel anybody has been on, in order. */
export function sites() {
  const seen = new Map();
  for (const p of read()) {
    if (!p.site) continue;
    const k = key(p.site);
    seen.set(k, { text: p.site, used: (seen.get(k)?.used || 0) + (p.used || 1) });
  }
  return inOrder([...seen.values()].map((x) => x.text));
}

/**
 * Keep a name, with whatever came with it.
 *
 * Called when a document's signer is settled rather than on every keystroke:
 * half a name typed and then corrected must not become a person in the list.
 */
export function remember({ name, position, bond, site } = {}) {
  const clean = String(name || "").trim();
  if (clean.length < 2) return;
  const all = read();
  const at = all.findIndex((p) => same(p.name, clean));
  const was = at >= 0 ? all[at] : { name: clean, used: 0 };
  const now = {
    ...was,
    /* The spelling last chosen wins: correcting a name corrects it here too. */
    name: clean,
    position: position || was.position || "",
    bond: bond || was.bond || "",
    site: site || was.site || "",
    used: (was.used || 0) + 1,
    at: Date.now(),
  };
  if (at >= 0) all[at] = now;
  else all.push(now);
  try {
    writeMine(KEY, all.slice(-200));
  } catch {
    /* no storage: the names simply are not remembered between sessions */
  }
}

/** Drop a name from the list — a typo that got kept. */
export function forget(name) {
  try {
    writeMine(KEY, read().filter((p) => !same(p.name, name)));
  } catch {
    /* nothing to do */
  }
}
