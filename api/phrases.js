/** Every phrase that has reached paper, so the bank does not repeat itself,
 *  across devices and not only in one browser. */
import { db, requireSession } from "./_supabase.js";

export default async function handler(req, res) {
  const who = requireSession(req, res);
  if (!who) return;
  try {
    if (req.method === "GET") {
      const rows = await db(`offshore_report_phrases?user_id=eq.${who.sub}&select=phrase&order=used_at.asc&limit=5000`);
      return res.status(200).json({ phrases: (rows || []).map((r) => r.phrase) });
    }
    if (req.method === "POST") {
      const list = (Array.isArray(req.body?.phrases) ? req.body.phrases : [])
        .map((p) => String(p).slice(0, 400))
        .filter(Boolean)
        .slice(0, 60);
      if (!list.length) return res.status(200).json({ ok: true });
      await db("offshore_report_phrases?on_conflict=user_id,phrase", {
        method: "POST",
        body: list.map((phrase) => ({ user_id: who.sub, phrase })),
        prefer: "resolution=ignore-duplicates",
      });
      return res.status(200).json({ ok: true });
    }
    if (req.method === "DELETE") {
      await db(`offshore_report_phrases?user_id=eq.${who.sub}`, { method: "DELETE" });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "GET, POST or DELETE" });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
