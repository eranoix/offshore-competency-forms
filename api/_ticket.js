/**
 * Short-lived signed tickets for the document server, which has no session: each names one form and one
 * job for a few minutes, so a leaked one is worth one blank form until it expires.
 * Underscore-prefixed so it is a module, not another serverless function (the plan allows twelve).
 */
import crypto from "node:crypto";

/* Long enough for a slow machine to fetch a document and hand one back, short
   enough that a ticket found in a log is already dead. */
const GOOD_FOR = 30 * 60 * 1000;

const sign = (body, secret) => crypto.createHmac("sha256", secret).update(body).digest("base64url");

/**
 * A ticket for one form and one job.
 * `job` is "doc" to fetch it or "saved" to hand one back.
 */
export function ticketFor(kind, job, who = "") {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return "";
  const body = Buffer.from(JSON.stringify({
    kind, job, by: who, exp: Date.now() + GOOD_FOR,
  })).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** What a ticket says, or null if it does not say it truthfully. */
export function ticketSays(ticket, secret = process.env.AUTH_SECRET) {
  if (!secret || !ticket || !ticket.includes(".")) return null;
  const [body, mac] = String(ticket).split(".");
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body, secret), "utf8");
  const given = Buffer.from(mac, "utf8");
  /* Compared as bytes, and only when the lengths match: the comparison throws
     on a mismatch, and a ticket is whatever the caller sent. */
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  try {
    const said = JSON.parse(Buffer.from(body, "base64url").toString());
    return said.exp > Date.now() ? said : null;
  } catch {
    return null;
  }
}

/**
 * Signs what the document server is told to open: unsigned, it opens and saves whatever anybody asks,
 * and its address is in the page.
 */
export function signedForEditor(config) {
  const secret = process.env.ONLYOFFICE_JWT;
  if (!secret) return null;
  const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(config)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${mac}`;
}

/** What the document server signed when it called back, or null. */
export function editorSays(token, secret = process.env.ONLYOFFICE_JWT) {
  if (!secret || !token) return null;
  const [head, body, mac] = String(token).split(".");
  if (!head || !body || !mac) return null;
  const want = Buffer.from(
    crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url"), "utf8",
  );
  const given = Buffer.from(mac, "utf8");
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
}

/**
 * A calendar feed key (person, plan, the plan's feed code). It never expires; "Stop sharing" writes a new
 * code into the plan, after which every old address answers with nothing.
 */
export function feedFor(user, doc, code) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return "";
  const body = Buffer.from(JSON.stringify({ u: user, d: doc, n: code, job: "ics" })).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** What a feed key says, or null. Checked here; whether the code is still the
 *  plan's current one is checked against the plan itself. */
export function feedSays(key, secret = process.env.AUTH_SECRET) {
  if (!secret || !key || !String(key).includes(".")) return null;
  const [body, mac] = String(key).split(".");
  const want = Buffer.from(sign(body, secret), "utf8");
  const given = Buffer.from(mac || "", "utf8");
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  try {
    const said = JSON.parse(Buffer.from(body, "base64url").toString());
    return said.job === "ics" && said.u && said.d && said.n ? said : null;
  } catch {
    return null;
  }
}

/**
 * A two-way calendar password naming one person's plan and its `dav` code; "Disconnect" writes a new
 * code, and every old key is refused.
 */
export function davFor(user, doc, code) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return "";
  const body = Buffer.from(JSON.stringify({ u: user, d: doc, n: code, job: "dav" })).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** What a calendar password says, or null. */
export function davSays(key, secret = process.env.AUTH_SECRET) {
  if (!secret || !key || !String(key).includes(".")) return null;
  const [body, mac] = String(key).split(".");
  const want = Buffer.from(sign(body, secret), "utf8");
  const given = Buffer.from(mac || "", "utf8");
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  try {
    const said = JSON.parse(Buffer.from(body, "base64url").toString());
    return said.job === "dav" && said.u && said.d && said.n ? said : null;
  } catch {
    return null;
  }
}
