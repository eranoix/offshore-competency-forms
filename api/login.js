/**
 * Sign in against Supabase, where accounts live. This endpoint only checks the
 * password with Supabase and then issues our own signed cookie, so no token
 * ever sits in the page.
 */
import crypto from "node:crypto";

const HOURS = 12;

const sign = (payload, secret) => {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", secret).update(body).digest("base64url")}`;
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "use POST" });
  const { AUTH_SECRET, SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!AUTH_SECRET || !SUPABASE_URL || !SUPABASE_ANON_KEY)
    return res.status(500).json({ error: "the server is missing its credentials" });

  const typed = String(req.body?.email || "").trim().toLowerCase();
  const email = typed.includes("@") ? typed : `${typed}@forms.example.org`;
  const password = String(req.body?.password || "");
  if (!email || !password) return res.status(400).json({ error: "user and password, please" });

  let answer;
  try {
    const upstream = await fetch(
      `${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      },
    );
    answer = await upstream.json();
    if (!upstream.ok || !answer.access_token)
      return res.status(401).json({ error: "wrong user or password" });
  } catch (e) {
    return res.status(502).json({ error: `could not reach the account server: ${e.message}` });
  }

  // Different GoTrue versions answer with the user in different shapes; the
  // access token always carries it, so read it from there.
  const claims = (() => {
    try {
      const body = answer.access_token.split(".")[1];
      return JSON.parse(Buffer.from(body, "base64url").toString());
    } catch {
      return {};
    }
  })();
  const sub = answer.user?.id || claims.sub;
  const mail = answer.user?.email || claims.email || email;
  if (!sub) return res.status(502).json({ error: "the account server sent no user id" });

  const token = sign({ sub, email: mail, exp: Date.now() + HOURS * 3600_000 }, AUTH_SECRET);
  res.setHeader(
    "set-cookie",
    `offshore_report_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${HOURS * 3600}`,
  );
  return res.status(200).json({ ok: true, email: answer.user?.email });
}
