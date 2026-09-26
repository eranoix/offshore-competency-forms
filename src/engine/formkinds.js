/** The forms, and what to call them on screen. Shared so the panel and the
    page that edits them cannot drift apart on either. */
export const FORM_KINDS = ["witness", "observation", "knowledge", "feedback", "trip", "sed"];
export const FORM_NAMES = {
  witness: "Witness testimony",
  observation: "Observation report",
  knowledge: "Knowledge questions",
  feedback: "Assessor feedback",
  trip: "Trip feedback",
  sed: "Days at sea",
};

/**
 * The kinds that are a workbook rather than a document. The editor, the served
 * bytes and the publish guard all ask here, and one list keeps their answers
 * from differing.
 */
export const SHEET_KINDS = ["sed"];
export const isSheet = (kind) => SHEET_KINDS.includes(String(kind || ""));

/* What the file is called, wherever a name for it has to be said: the file the
   Export button hands over, and the one the Import button will take. What it
   IS — the media type — is only ever said by the side that serves the bytes,
   and that side is api/_templates.js. */
export const extOf = (kind) => (isSheet(kind) ? "xlsx" : "docx");
