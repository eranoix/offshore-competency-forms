/**
 * Certificates (tickets) and how long each has left. Offered as a list so one
 * certificate is not tracked under several spellings, but free text is still
 * accepted. They live in their own document so the certificates page can inherit
 * the same rows and shape without a migration.
 */

/* Ordered, because every list on this site is. */
export const TICKETS = [
  "BOSIET",
  "CA-EBS",
  "ENG1 medical",
  "FOET",
  "HUET",
  "IMCA ROV Pilot Technician",
  "IMCA ROV Supervisor",
  "MIST",
  "Offshore medical",
  "Rigging and slinging",
  "Seafarer's medical",
  "Working at height",
  "Yellow fever",
];

export const BLANK_CERT = { id: "", what: "", body: "", issued: "", expires: "", note: "" };

/** Close enough to matter: a ticket inside three months of running out. */
const SOON = 90;

/**
 * Where a certificate stands today.
 *
 * Three words rather than a colour, because the printed sheet has no colour —
 * the bench prints it the way the dialog does, with backgrounds off.
 */
export function standing(cert, todayIso) {
  if (!cert?.expires) return "ok";
  const day = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;
  const left = day(cert.expires) - day(todayIso);
  if (left < 0) return "gone";
  return left <= SOON ? "soon" : "ok";
}
