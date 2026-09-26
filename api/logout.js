/** Signing out changes something, so it is asked for with a POST: a link or an
 *  image on another page must not be able to sign you out. */
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "use POST" });
  res.setHeader("set-cookie", "offshore_report_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  return res.status(200).json({ ok: true });
}
