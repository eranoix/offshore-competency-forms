/**
 * Asks the live site for the served forms as a signed-in user would and checks
 * they match the repository's: same bytes, same fingerprint.
 *
 *   OFFSHORE_REPORT_EMAIL=... OFFSHORE_REPORT_PASSWORD=... node scripts/forms.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const FORMS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "forms");
const SITE = process.env.OFFSHORE_REPORT_SITE || "https://forms.example.com";
const EMAIL = process.env.OFFSHORE_REPORT_EMAIL;
const PASSWORD = process.env.OFFSHORE_REPORT_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.log("set OFFSHORE_REPORT_EMAIL and OFFSHORE_REPORT_PASSWORD to check the served forms");
  process.exit(0);
}

const fails = [];
const say = (ok, label, got = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${got ? ` — ${got}` : ""}`);
  if (!ok) fails.push(label);
};

const res0 = await fetch(`${SITE}/api/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const cookie = (res0.headers.getSetCookie?.() || [])
  .map((c) => c.split(";")[0])
  .join("; ");
say(res0.ok && cookie.includes("offshore_report_session"), "signed in", res0.status === 200 ? "" : String(res0.status));
if (!cookie) { console.log("\n1 FAILED"); process.exit(1); }
const mine = (path, opts = {}) =>
  fetch(`${SITE}${path}`, { ...opts, headers: { cookie, ...(opts.headers || {}) } });

const said = await mine("/api/render?t=manifest").then((r) => r.json()).catch(() => ({}));
const forms = said.forms || {};
const KINDS = ["witness", "observation", "knowledge", "feedback"];
say(KINDS.every((k) => forms[k]?.sha256), "the site says which form it is on, for all four",
  KINDS.map((k) => `${k.slice(0, 3)} v${forms[k]?.version}`).join(" "));

for (const kind of KINDS) {
  const here = readFileSync(join(FORMS, `${kind}.docx`));
  const sha = createHash("sha256").update(here).digest("hex");
  say(forms[kind]?.sha256 === sha, `${kind}: what it serves is the form in the repository`,
    forms[kind]?.sha256 === sha ? sha.slice(0, 12) : `${forms[kind]?.sha256?.slice(0, 12)} against ${sha.slice(0, 12)}`);
  say(Object.keys(forms[kind]?.anchors || {}).length > 0, `${kind}: and it knows where the values go`,
    Object.keys(forms[kind]?.anchors || {}).join(" "));
  say((forms[kind]?.blanks?.fields || []).length === 4, `${kind}: and where the blanks are`,
    `${(forms[kind]?.blanks?.fields || []).length} lines`);
}

/* The bytes themselves, one form, byte for byte. */
const got = await mine(`/api/render?t=bytes&kind=witness&v=${forms.witness?.version}`);
const bytes = Buffer.from(await got.arrayBuffer());
const want = readFileSync(join(FORMS, "witness.docx"));
say(got.ok && bytes.equals(want), "and hands over the document itself, byte for byte",
  `${(bytes.length / 1024).toFixed(0)}KB`);

/* Publishing is an admin's to do, and the refusal must be the server's rather
   than the page's: a button that is merely hidden is not a lock. */
const tried = await mine("/api/render?t=publish&kind=witness", {
  method: "POST",
  headers: { "content-type": "application/octet-stream", "x-form": "{}" },
  body: want,
});
say(tried.status === 403, "and a form is not published by somebody who is not an admin",
  `${tried.status} ${(await tried.text()).slice(0, 60)}`);

const moved = await mine("/api/render?t=live&kind=witness&v=0", { method: "PATCH" });
say(moved.status === 403, "nor is the live one moved by them", String(moved.status));

console.log(fails.length ? `\n${fails.length} FAILED` : "\nthe site serves the forms, and only an admin changes them");
process.exit(fails.length ? 1 : 0);
