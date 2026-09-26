/**
 * Shared helpers for talking to Supabase and for knowing who is asking.
 *
 * The browser never holds a Supabase key: every call goes through these
 * functions, which run on the server and scope each query to the signed-in
 * user taken from the session cookie.
 */
import crypto from "node:crypto";

export const URL_BASE = () => (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Reads and verifies our own session cookie. Returns {sub, email} or null. */
export function session(req) {
  const raw = (req.headers.cookie || "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("offshore_report_session="));
  if (!raw) return null;
  const token = raw.slice("offshore_report_session=".length);
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  /* Without a secret there is nothing to verify against, and an empty key
     would accept a cookie anyone could sign. No secret, no session. */
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  /* Compared as bytes, and only when the byte lengths match: timingSafeEqual
     throws on a length mismatch, and a cookie is whatever the caller sent. */
  const given = Buffer.from(mac, "utf8");
  const want = Buffer.from(expected, "utf8");
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

/** PostgREST call with the service role, always filtered by the user. */
export async function db(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${URL_BASE()}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE(),
      authorization: `Bearer ${SERVICE()}`,
      "content-type": "application/json",
      ...(prefer ? { prefer } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/** An id we are about to put in a query has to be an id — the shape Postgres
 *  actually gives one, not merely 36 characters of hex and dashes. */
export const isId = (v) =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * How many rows there are, without fetching them: PostgREST answers a HEAD
 * with the total in Content-Range.
 */
export async function countRows(path) {
  const res = await fetch(`${URL_BASE()}/rest/v1/${path}`, {
    method: "HEAD",
    headers: {
      apikey: SERVICE(),
      authorization: `Bearer ${SERVICE()}`,
      prefer: "count=exact",
      range: "0-0",
    },
  });
  if (!res.ok) throw new Error(`supabase ${res.status}`);
  const total = Number(String(res.headers.get("content-range") || "").split("/")[1]);
  /* No number means the count did not arrive, which is not the same as none:
     answering zero would put a confident, wrong figure on the account page. */
  return Number.isFinite(total) ? total : null;
}

export function requireSession(req, res) {
  const who = session(req);
  if (!who) {
    res.status(401).json({ error: "not signed in" });
    return null;
  }
  return who;
}

/* The account this site was set up under. It runs the site by definition, and
   it is the one address that cannot be taken off the list. */
const FOUNDER = "admin@northwind.example";

/**
 * Whoever runs the site. ADMIN_EMAILS adds to the list, never replaces it:
 * a blank or mistyped value must not leave the site with no administrator and
 * no way back in.
 */
export const admins = () => {
  const named = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([FOUNDER, ...named])];
};

export const isAdmin = (who) => admins().includes(String(who?.email || "").toLowerCase());

/** Storage on the server that runs this Supabase: bytes on its disk, row in its database. */
export async function storage(path, { method = "GET", body, contentType, replace = false } = {}) {
  const res = await fetch(`${URL_BASE()}/storage/v1/object/${path}`, {
    method,
    headers: {
      apikey: SERVICE(),
      authorization: `Bearer ${SERVICE()}`,
      ...(contentType ? { "content-type": contentType } : {}),
      /* Overwriting: the store refuses a second POST to the same name (409), right
         for numbered published versions, wrong for the one draft a form keeps. */
      ...(replace ? { "x-upsert": "true" } : {}),
    },
    ...(body ? { body } : {}),
  });
  if (!res.ok) throw new Error(`storage ${res.status}: ${(await res.text()).slice(0, 180)}`);
  return res;
}
