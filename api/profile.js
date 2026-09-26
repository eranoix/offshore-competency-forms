/** The lists the app learns — vessels, supervisors, names — kept per account
 *  so a phone and a laptop show the same suggestions. */
import { db, requireSession } from "./_supabase.js";

const clean = (list) =>
  [...new Set((Array.isArray(list) ? list : []).map((s) => String(s).trim()).filter(Boolean))].slice(0, 60);

export default async function handler(req, res) {
  const who = requireSession(req, res);
  if (!who) return;
  try {
    if (req.method === "GET") {
      const rows = await db(`offshore_report_profile?user_id=eq.${who.sub}&select=*`);
      return res.status(200).json(rows?.[0] || { vessels: [], supervisors: [], crews: [] });
    }
    if (req.method === "PUT") {
      const row = {
        user_id: who.sub,
        vessels: clean(req.body?.vessels),
        supervisors: clean(req.body?.supervisors),
        crews: clean(req.body?.crews),
        updated_at: new Date().toISOString(),
      };
      await db("offshore_report_profile?on_conflict=user_id", {
        method: "POST", body: row, prefer: "resolution=merge-duplicates",
      });
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "GET or PUT" });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
