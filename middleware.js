/**
 * The gate. Runs on Vercel's edge before anything is served, so the pages and
 * their assets are not reachable without a session — unlike a static host,
 * where a login screen is only a picture of a lock.
 */
import { next } from "@vercel/edge";

export const config = {
  matcher: ["/((?!login.html|favicon.ico|favicon.svg|icon-.*\\.png|manifest.webmanifest).*)"],
};

/* `/sw.js` holds no data and must be reachable signed out: a browser only
   replaces its worker by fetching this file, so a gated one kept serving the old
   app to a signed-out user instead of letting the gate send them to sign in. */
const OPEN = new Set(["/api/login", "/api/logout", "/login", "/sw.js"]);

/* Requests the document server makes on its own behalf (fetch a form, hand back
   a saved one). It has no session, so it carries a ticket signed with the same
   secret, naming one form and one job, valid for half an hour. */
const BY_TICKET = new Set(["doc", "saved"]);

const b64urlToBytes = (s) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

/** What a ticket says, or null if it does not say it truthfully. Same shape
 *  and same secret as the cookie; verified with the crypto the edge has. */
async function ticketSays(ticket, secret) {
  if (!ticket || !ticket.includes(".")) return null;
  const [body, mac] = String(ticket).split(".");
  if (!body || !mac) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "HMAC", key, b64urlToBytes(mac), new TextEncoder().encode(body),
    );
    if (!ok) return null;
    const said = JSON.parse(new TextDecoder().decode(b64urlToBytes(body)));
    return typeof said.exp === "number" && said.exp > Date.now() ? said : null;
  } catch {
    return null;
  }
}

/** Cookie shape: <payload-b64url>.<hmac-b64url> */
async function valid(cookie, secret) {
  if (!cookie || !cookie.includes(".")) return false;
  const [payload, sig] = cookie.split(".");
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlToBytes(sig),
      new TextEncoder().encode(payload),
    );
    if (!ok) return false;
    const data = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
    return typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}

export default async function middleware(request) {
  const { pathname, searchParams } = new URL(request.url);
  if (OPEN.has(pathname)) return next();

  const secret = process.env.AUTH_SECRET;
  if (!secret) return new Response("AUTH_SECRET is not set", { status: 500 });

  if (pathname === "/api/render" && BY_TICKET.has(searchParams.get("t") || "")) {
    const said = await ticketSays(searchParams.get("tk"), secret);
    /* The ticket has to be for the job being asked for, or one to fetch a form
       is also one to replace it. */
    if (said && said.job === searchParams.get("t")) return next();
    return new Response(JSON.stringify({ error: "no ticket" }), {
      status: 401, headers: { "content-type": "application/json" },
    });
  }

  /* A calendar app fetching the rotation feed. It has no session; its key is
     checked in the function, against the plan it names, and that is the only
     thing this path can reach without one. */
  if (pathname === "/api/documents" && searchParams.get("t") === "ics" && searchParams.get("k")) return next();

  /* The calendar account. Calendar apps reach it through the small proxy on
     our own server (see api/dav.js for why) and sign in with the calendar
     password, never the session; the function checks that password against
     the plan it names, so the edge only has to let them reach it. */
  if (pathname === "/api/dav" || pathname === "/.well-known/caldav") return next();

  const cookie = (request.headers.get("cookie") || "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("offshore_report_session="))
    ?.slice("offshore_report_session=".length);
  if (await valid(cookie, secret)) return next();

  if (pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "not signed in" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const url = new URL("/login", request.url);
  url.searchParams.set("next", pathname);
  return Response.redirect(url, 302);
}
