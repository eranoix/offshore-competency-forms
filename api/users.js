/**
 * Accounts, for whoever runs the site. There is no email server, so recovery is
 * manual: the admin sets a new password and the person changes it from Account.
 */
import { requireSession, admins, isId } from "./_supabase.js";

const base = () => (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const adminHeaders = () => ({
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  "content-type": "application/json",
});

/* This Supabase holds accounts for other systems too. Only the ones created by
   this site are ours to list, change or delete — touching the others would take
   someone's login away from a different application. */
const APP = "offshore-report-app";
const isOurs = (user) => user?.app_metadata?.app === APP;

async function fetchUser(id) {
  const r = await fetch(`${base()}/auth/v1/admin/users/${id}`, { headers: adminHeaders() });
  return r.ok ? r.json() : null;
}

export default async function handler(req, res) {
  const who = requireSession(req, res);
  if (!who) return;
  if (!admins().includes(String(who.email || "").toLowerCase()))
    return res.status(403).json({ error: "only an administrator can manage accounts" });

  const asEmail = (typed) => {
    const t = String(typed || "").trim().toLowerCase();
    return t.includes("@") ? t : `${t}@forms.example.org`;
  };

  try {
    if (req.method === "GET") {
      const r = await fetch(`${base()}/auth/v1/admin/users?per_page=200`, { headers: adminHeaders() });
      const body = await r.json();
      const users = (body.users || []).filter(isOurs).map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        disabled: Boolean(u.banned_until && new Date(u.banned_until) > new Date()),
        admin: admins().includes(String(u.email || "").toLowerCase()),
      }));
      return res.status(200).json({ users });
    }

    if (req.method === "POST") {
      const email = asEmail(req.body?.email);
      const password = String(req.body?.password || "");
      if (password.length < 8) return res.status(400).json({ error: "use at least 8 characters" });
      const r = await fetch(`${base()}/auth/v1/admin/users`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { app: "offshore-report-app" } }),
      });
      const body = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: body.msg || body.message || "could not create" });
      return res.status(200).json({ user: { id: body.id, email: body.email } });
    }

    if (req.method === "PATCH") {
      const { id, password, disabled } = req.body || {};
      if (!isId(id)) return res.status(400).json({ error: "that is not an account id" });
      if (!isOurs(await fetchUser(id)))
        return res.status(403).json({ error: "that account belongs to another application" });
      const patch = {};
      if (password) {
        if (String(password).length < 8) return res.status(400).json({ error: "use at least 8 characters" });
        patch.password = String(password);
      }
      if (typeof disabled === "boolean") patch.ban_duration = disabled ? "876000h" : "none";
      const r = await fetch(`${base()}/auth/v1/admin/users/${id}`, {
        method: "PUT",
        headers: adminHeaders(),
        body: JSON.stringify(patch),
      });
      if (!r.ok) return res.status(r.status).json({ error: (await r.text()).slice(0, 160) });
      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      const id = req.query?.id;
      if (!isId(id)) return res.status(400).json({ error: "that is not an account id" });
      if (id === who.sub) return res.status(400).json({ error: "you cannot delete the account you are using" });
      if (!isOurs(await fetchUser(id)))
        return res.status(403).json({ error: "that account belongs to another application" });
      const r = await fetch(`${base()}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: adminHeaders() });
      if (!r.ok) return res.status(r.status).json({ error: (await r.text()).slice(0, 160) });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "GET, POST, PATCH or DELETE" });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
