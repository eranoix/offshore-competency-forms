/** Change the password. The current one is checked against the account server
 *  first, so a stolen session alone cannot lock you out of your own site. */
import { requireSession } from "./_supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "use POST" });
  const who = requireSession(req, res);
  if (!who) return;

  const current = String(req.body?.current || "");
  const next = String(req.body?.next || "");
  if (next.length < 8) return res.status(400).json({ error: "use at least 8 characters" });

  const base = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const check = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email: who.email, password: current }),
  });
  if (!check.ok) return res.status(401).json({ error: "the current password is not right" });

  const update = await fetch(`${base}/auth/v1/admin/users/${who.sub}`, {
    method: "PUT",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ password: next }),
  });
  if (!update.ok) {
    const body = await update.text();
    return res.status(502).json({ error: `could not change it: ${body.slice(0, 120)}` });
  }
  return res.status(200).json({ ok: true });
}
