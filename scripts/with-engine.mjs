/**
 * Runs a command with the drawing engine (`vps/docx-render/server.mjs`) up. When
 * DOCX_KEY is not set, one is started on 127.0.0.1:8791 (or DOCX_PORT) with a
 * throwaway key for as long as the command runs.
 *
 *   node scripts/with-engine.mjs "<command>"
 *
 * Needs `soffice` (LibreOffice) and `pdftotext` (poppler) on the PATH.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as wait } from "node:timers/promises";

const command = process.argv.slice(2).join(" ");
if (!command) {
  console.error('usage: node scripts/with-engine.mjs "<command>"');
  process.exit(2);
}

/* The checks default to this address, so the local engine takes it too.
   DOCX_PORT moves both: the engine listens there, and every check reads the
   same variable, so a machine that already uses 8791 can still run the suite. */
const PORT = Number(process.env.DOCX_PORT || 8791);
const env = { ...process.env, DOCX_PORT: String(PORT) };
let engine = null;

if (!env.DOCX_KEY) {
  const busy = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.ok).catch(() => false);
  if (busy) {
    console.error(`an engine already answers on ${PORT} — set DOCX_KEY to its key and run again`);
    process.exit(2);
  }
  env.DOCX_KEY = randomBytes(18).toString("hex");
  engine = spawn(process.execPath, [fileURLToPath(new URL("../vps/docx-render/server.mjs", import.meta.url))], {
    env: { ...env, DOCX_PORT: String(PORT) },
    stdio: ["ignore", "ignore", "inherit"],
  });
  let up = false;
  for (let i = 0; i < 100 && !up; i += 1) {
    await wait(200);
    up = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.ok).catch(() => false);
  }
  if (!up) {
    engine.kill();
    console.error("the local drawing engine did not come up (is LibreOffice installed?)");
    process.exit(2);
  }
  console.log(`drawing engine on 127.0.0.1:${PORT}, for this run only`);
}

const stop = () => engine?.kill();
process.on("SIGINT", () => { stop(); process.exit(130); });
process.on("SIGTERM", () => { stop(); process.exit(143); });

const child = spawn(command, { shell: true, stdio: "inherit", env });
const code = await new Promise((done) => child.on("exit", (c) => done(c ?? 1)));
stop();
process.exit(code);
