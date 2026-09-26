/**
 * Re-indexes the library: re-cuts every donation from its bytes on the storage
 * disk with the upload's own code (imported, so the two cannot drift) and
 * replaces that document's passages. Runs on the server holding the files; each
 * document is done on its own, so one unreadable file leaves the rest untouched.
 *
 *   LIBRARY_DIR=<storage volume>/<bucket> node scripts/reindex.mjs [--dry] [--fast]
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readWords, passages } from "../api/library.js";

const run = promisify(execFile);
/* Where the storage service keeps the library bucket's files on disk. Not
   needed with --fast, which re-cuts the words already stored. */
const DISK = process.env.LIBRARY_DIR || "";
const SEP = "|~|";
const dryRun = process.argv.includes("--dry");
/* Reading a file again means drawing every page of a scan and reading it
   back — minutes of work for a result already stored. When only the cutting
   into passages has changed, the words kept last time are the same words. */
const fromStored = process.argv.includes("--fast");
if (!DISK && !fromStored) {
  console.error("set LIBRARY_DIR to the library bucket's directory on the storage disk, or pass --fast");
  process.exit(2);
}

const sql = async (q) => {
  const { stdout } = await run(
    "docker",
    ["exec", "-i", "supabase-db", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-F", SEP, "-c", q],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout.trim() ? stdout.trim().split("\n").map((l) => l.split(SEP)) : [];
};
const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

const rows = await sql(
  fromStored
    /* The stored words run to many lines, and psql answers a row per line.
       Sent as base64 on one line they arrive whole. */
    ? "select id, user_id, path, kind, name, replace(encode(convert_to(coalesce(text_content, ''), 'UTF8'), 'base64'), E'\\n', '') from public.offshore_report_library order by name;"
    : "select id, user_id, path, kind, name from public.offshore_report_library order by name;",
);
console.log(`${rows.length} documents · ${dryRun ? "dry run" : "for real"}\n`);

let done = 0;
let withoutText = 0;
let before = 0;
let after = 0;

for (const [id, userId, path, kind, name, kept] of rows) {
  let text;
  if (fromStored) {
    text = kept ? Buffer.from(kept, "base64").toString("utf8") : "";
  } else {
    let bytes;
    try {
      const dir = join(DISK, path);
      const files = await readdir(dir);
      bytes = await readFile(join(dir, files[0]));
    } catch {
      console.log(`  no file on disk: ${name}`);
      continue;
    }
    text = await readWords(bytes, kind, name);
  }
  const pieces = text ? passages(text) : [];
  const [[old] = ["0"]] = await sql(
    `select count(*) from public.offshore_report_library_chunks where doc_id = ${quote(id)};`,
  );
  before += Number(old);
  after += pieces.length;
  if (!pieces.length) withoutText++;
  if (dryRun) {
    done++;
    continue;
  }

  const rowsSql = pieces
    .map((t, ord) => `(${quote(userId)}, ${quote(id)}, ${ord}, ${quote(t)})`)
    .join(",");
  await sql(`begin;
    delete from public.offshore_report_library_chunks where doc_id = ${quote(id)};
    ${rowsSql ? `insert into public.offshore_report_library_chunks (user_id, doc_id, ord, text) values ${rowsSql};` : ""}
    update public.offshore_report_library set text_content = ${text ? quote(text.slice(0, 200000)) : "null"} where id = ${quote(id)};
  commit;`);
  done++;
}

console.log(`\n${done} documents · passages ${before} -> ${after} · ${withoutText} with nothing to teach`);
