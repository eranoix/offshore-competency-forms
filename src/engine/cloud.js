/**
 * The account's side of things: saved documents, the lists the app learns, and
 * the phrases already used. All of it goes through our own /api, which holds
 * the Supabase credentials on the server.
 *
 * Every call degrades quietly: offline, or in the single-file build, the app
 * carries on with what the browser has.
 */
const OFF = typeof __OFFLINE__ !== "undefined" && __OFFLINE__;

/**
 * Off to sign in, and back here afterwards. The server has said the session is
 * over; carrying on would leave a page that looks signed in and saves nothing.
 */
export function toSignIn() {
  if (typeof location === "undefined" || location.pathname.startsWith("/login")) return;
  location.replace(`/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
}

async function call(path, { method = "GET", body } = {}) {
  if (OFF) throw new Error("offline build");
  const res = await fetch(`/api/${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { toSignIn(); throw new Error("not signed in"); }
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.status === 204 ? null : res.json();
}

export const available = () => !OFF;

export const getProfile = () => call("profile");
export const putProfile = (profile) => call("profile", { method: "PUT", body: profile });
export const forgetPhrases = () => call("phrases", { method: "DELETE" });

export const getPhrases = () => call("phrases").then((r) => r.phrases || []);
export const addPhrases = (phrases) => call("phrases", { method: "POST", body: { phrases } });

export const listDocuments = (kind = "trip") =>
  call(`documents?kind=${encodeURIComponent(kind)}`).then((r) => r.documents || []);
/* Both drawers in one journey, for the page that shows both. */
export const listEverything = () => call("documents?kind=every").then((r) => r.documents || []);
export const loadDocument = (id) => call(`document?id=${encodeURIComponent(id)}`).then((r) => r.document);
export const saveDocument = (payload) => call("documents", { method: "POST", body: payload });
/**
 * The rotation saved over the copy it was read from. `base` is when that copy
 * was written; if the account has been written since — by the phone — the
 * answer is `{ conflict }` with the plan as it is now, to be put together
 * with this one and saved again.
 */
export async function savePlan(payload) {
  if (OFF) throw new Error("offline build");
  const res = await fetch("/api/documents", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  if (res.status === 401) { toSignIn(); throw new Error("not signed in"); }
  if (res.status === 409) return { conflict: (await res.json()).document };
  if (!res.ok) throw new Error(`documents returned ${res.status}`);
  return res.json();
}
export const deleteDocument = (id) =>
  call(`documents?id=${encodeURIComponent(id)}`, { method: "DELETE" });
