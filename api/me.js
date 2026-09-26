/**
 * Who is signed in and, when asked, how many of their documents are on the
 * server. Counting is slow and only the account page shows it, so it runs
 * only on request.
 */
import { countRows, isAdmin, requireSession } from "./_supabase.js";

export default async function handler(req, res) {
  const who = requireSession(req, res);
  if (!who) return;

  const me = {
    /* Who this browser is holding work for: the local copies are kept under
       this, so one person's paperwork never opens under another's name. */
    id: who.sub,
    email: who.email,
    admin: isAdmin(who),
  };

  if (req.query?.counts !== "1") return res.status(200).json(me);

  try {
    const count = (table) => countRows(`${table}?user_id=eq.${who.sub}&select=user_id`);
    const [documents, phrases] = await Promise.all([count("offshore_report_documents"), count("offshore_report_phrases")]);
    return res.status(200).json({ ...me, documents, phrases });
  } catch (e) {
    /* The counts are optional: without them the page shows a dash, and
       everything that needs to know who you are still works. */
    return res.status(200).json({ ...me, documents: null, phrases: null, trouble: e.message });
  }
}
