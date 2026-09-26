/**
 * The published forms, fetched once and kept in this browser, so a changed
 * form needs no release. Order: kept copy, then server, then the compiled-in
 * form, so there is always a form offline. Kept in the vault's account-free
 * settings, since blank forms must survive signing out.
 */
import { readSetting, writeSetting } from "./vault";
import { PACKED, PACKED_AT } from "../forms/published";
import { FORM_KINDS, isSheet } from "./formkinds";

const KEPT = "forms:held";
/* The one list, imported rather than repeated, less the workbooks: nothing
   fills a workbook offline, so carrying its bytes would only waste the
   browser's limited storage and push out forms that are filled. */
const KINDS = FORM_KINDS.filter((k) => !isSheet(k));

let held = null;
let asked = null;

const read = () => {
  if (held) return held;
  try {
    held = JSON.parse(readSetting(KEPT, "") || "{}");
  } catch {
    held = {};
  }
  return held;
};
const write = () => {
  try {
    writeSetting(KEPT, JSON.stringify(held));
  } catch {
    /* No room, or no storage at all: it still works for this session, and the
       form compiled into the page is still there underneath. */
  }
};

const toText = (bytes) => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
};
const fromText = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/**
 * When the copy that runs from a folder was built, and what it carries. It
 * cannot ask the server, so the page has to tell the user.
 */
export const packedAt = () => (__OFFLINE__ ? PACKED_AT : "");
export const packedForms = () => (__OFFLINE__ ? Object.keys(PACKED) : []);

/** What this browser is holding for a form, if anything. */
export function heldForm(kind) {
  /* The copy from a folder holds what was packed into it and nothing else:
     there is no store behind it, and the vault it would read is another
     machine's. */
  if (__OFFLINE__) {
    const packed = PACKED[kind];
    if (!packed?.bytes) return null;
    try {
      return { ...packed, bytes: fromText(packed.bytes) };
    } catch {
      return null;
    }
  }
  const one = read()[kind];
  if (!one?.bytes) return null;
  try {
    return { ...one, bytes: fromText(one.bytes) };
  } catch {
    return null;
  }
}

/** Everything the panel needs about a form beyond its bytes. */
export const heldAbout = (kind) => {
  const one = __OFFLINE__ ? PACKED[kind] : read()[kind];
  return one ? { version: one.version, anchors: one.anchors || {}, blanks: one.blanks || {}, wording: one.wording || {} } : null;
};

/**
 * Catch up with what is published: fetches only the forms held at an older
 * version. Called once on open; fails quietly offline.
 */
export async function catchUp() {
  /* The copy that runs from a folder has no server behind it at all, and the
     forms compiled into it are the forms. */
  if (__OFFLINE__) return false;
  if (asked) return asked;
  asked = (async () => {
    let said;
    try {
      const res = await fetch("/api/render?t=manifest", { cache: "no-store" });
      if (!res.ok) return false;
      said = (await res.json()).forms || {};
    } catch {
      return false;
    }
    read();
    let moved = false;
    for (const kind of KINDS) {
      const now = said[kind];
      if (!now?.sha256) continue;
      if (held[kind]?.sha256 === now.sha256) continue;
      try {
        const res = await fetch(`/api/render?t=bytes&kind=${kind}&v=${now.version}`, { cache: "no-store" });
        if (!res.ok) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        held[kind] = {
          version: now.version,
          sha256: now.sha256,
          anchors: now.anchors || {},
          blanks: now.blanks || {},
          wording: now.wording || {},
          bytes: toText(bytes),
        };
        moved = true;
      } catch {
        /* Leave what is held: half a form is worse than an old one. */
      }
    }
    if (moved) write();
    return moved;
  })();
  return asked;
}

/**
 * Ask again, now. `catchUp` runs once; after publishing, the publisher's own
 * browser must refetch to see the change without a reload.
 */
export async function catchUpAgain() {
  asked = null;
  return catchUp();
}

/** Forget everything held, so the next opening fetches it again. */
export function forgetForms() {
  held = {};
  asked = null;
  write();
}
