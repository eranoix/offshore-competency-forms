/** One saved document, with its full contents. */
import { db, isId, requireSession } from "./_supabase.js";

export default async function handler(req, res) {
  const who = requireSession(req, res);
  if (!who) return;
  const id = req.query?.id;
  if (!isId(id)) return res.status(400).json({ error: "that is not a document id" });
  try {
    const rows = await db(`offshore_report_documents?id=eq.${id}&user_id=eq.${who.sub}&select=*`);
    if (!rows?.length) return res.status(404).json({ error: "not found" });
    return res.status(200).json({ document: rows[0] });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
