/**
 * The CalDAV calendar account (iPhone/Mac Calendar, DAVx5), answered by the pure
 * `davAnswer`. Clients sign in with the calendar password, never the site session,
 * checked against the plan it names and only while that plan still carries that code.
 *
 * Apps reach this through a proxy on our own server (https://DAV_HOST/dav/...,
 * forwarded as /api/dav?p=...) because the platform edge answers 405 to a PROPFIND
 * sent through a rewrite or dynamic route, then challenges that IP site-wide with a
 * browser-only page. The proxy holds no secrets.
 */
import { db, isId } from "./_supabase.js";
import { davSays } from "./_ticket.js";
import { davAnswer } from "../src/engine/caldav.js";
import { pruneTrash } from "../src/engine/rotation.js";

/** Where calendar apps are sent: the proxy on our own server. */
export const DAV_HOST = process.env.DAV_HOST || "docs7p.northwind.example";

/* The request's body as text. The platform reads bodies of the types it
   knows and hands the rest over as bytes; an XML or calendar body with no
   type at all is read from the stream. */
async function bodyOf(req) {
  try {
    const b = req.body;
    if (Buffer.isBuffer(b)) return b.toString("utf8");
    if (typeof b === "string") return b;
    if (b && typeof b === "object") return JSON.stringify(b);
  } catch { /* a body it could not parse is read below */ }
  if (req.readableEnded) return "";
  return new Promise((done) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => done(""));
  });
}

const refuse = (res) => {
  res.setHeader("WWW-Authenticate", 'Basic realm="Offshore Report calendar", charset="UTF-8"');
  return res.status(401).send("Sign in with the calendar password from Offshore Report.");
};

export default async function handler(req, res) {
  res.setHeader("cache-control", "private, no-store");
  const path = String(req.query?.p || "");
  /* Where a calendar app looks first when it is given only the site's name. */
  if (path === ".well-known") {
    res.setHeader("Location", `https://${DAV_HOST}/dav/`);
    return res.status(301).send("");
  }

  const m = String(req.headers.authorization || "").match(/^Basic\s+(.+)$/i);
  if (!m) return refuse(res);
  const said = (() => {
    const pair = Buffer.from(m[1], "base64").toString("utf8");
    const at = pair.indexOf(":");
    return at < 0 ? null : { user: pair.slice(0, at), ...(davSays(pair.slice(at + 1)) || {}) };
  })();
  if (!said?.u || !isId(said.d)) return refuse(res);

  try {
    const body = await bodyOf(req);
    const [tick] = await db(`offshore_report_documents?user_id=eq.${said.u}&kind=eq.certificates&select=data&order=updated_at.desc&limit=1`) || [];
    const today = new Date().toISOString().slice(0, 10);
    /* Read, answer, and write back only if nobody wrote in between — a phone
       and a Mac sending at once, or the site saving. Whoever loses reads the
       plan again and is answered from that. */
    for (let tries = 0; tries < 4; tries += 1) {
      const [row] = await db(`offshore_report_documents?id=eq.${said.d}&user_id=eq.${said.u}&kind=eq.rotation&select=data,updated_at`) || [];
      if (!row?.data || row.data.dav !== said.n) return refuse(res);
      const out = davAnswer({
        method: req.method, path, depth: req.headers.depth, body,
        ifMatch: req.headers["if-match"], ifNoneMatch: req.headers["if-none-match"],
      }, { plan: row.data, today, certificates: tick?.data?.certificates || [], email: said.user, root: "/dav/" });
      if (out.plan) {
        const saved = await db(
          `offshore_report_documents?id=eq.${said.d}&user_id=eq.${said.u}&updated_at=eq.${encodeURIComponent(row.updated_at)}`,
          { method: "PATCH", body: { data: pruneTrash(out.plan, today), updated_at: new Date().toISOString() }, prefer: "return=representation" },
        );
        if (!saved?.length) continue;
      }
      for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
      return res.status(out.status).send(out.body || "");
    }
    return res.status(503).send("Busy — try again.");
  } catch {
    return res.status(502).send("The calendar could not be read just now.");
  }
}
