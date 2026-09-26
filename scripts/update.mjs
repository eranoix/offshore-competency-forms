const __REPO = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/\/$/, "");
/**
 * A new build must take over an open page on its own, with nothing pressed: two
 * builds are served from the same address one after the other, and the page must
 * end up running code from the second.
 *
 *   node scripts/update.mjs
 */
import { spawn, execSync } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { createServer } from "node:http";
import { readFileSync, existsSync, rmSync, cpSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import WebSocket from "ws";
import { freePort } from "./port.mjs";

const ROOT = `${__REPO}`;
const A = "/tmp/sw-build-a";
const B = "/tmp/sw-build-b";

/* The version is what the sidebar prints, so changing it changes the bundle
   and gives the check something to read on the page. */
const pkg = join(ROOT, "package.json");
const original = readFileSync(pkg, "utf8");
const was = JSON.parse(original).version;
const then = `${was}-older`;
let restored = false;
const restore = () => { if (!restored) { restored = true; execSync(`cp /tmp/sw-pkg.json ${pkg}`); } };
execSync(`cp ${pkg} /tmp/sw-pkg.json`);
process.on("exit", restore);
process.on("SIGINT", () => { restore(); process.exit(1); });

for (const [dir, version] of [[A, then], [B, was]]) {
  execSync(`cp /tmp/sw-pkg.json ${pkg}`);
  execSync(`node -e 'const f="${pkg}",j=JSON.parse(require("fs").readFileSync(f,"utf8"));j.version=${JSON.stringify(version)};require("fs").writeFileSync(f,JSON.stringify(j,null,2)+"\\n")'`);
  execSync("npx vite build", { cwd: ROOT, stdio: "ignore" });
  rmSync(dir, { recursive: true, force: true });
  cpSync(join(ROOT, "dist"), dir, { recursive: true });
}
restore();
execSync("npx vite build", { cwd: ROOT, stdio: "ignore" });

/* One address, two builds. Which one it serves is a variable, because that is
   exactly what a deploy does to a browser that already has the site open. */
let serving = A;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".pdf": "application/pdf" };
const PORT = await freePort();
let answering = true;
const site = createServer((req, res) => {
  if (!answering) { res.destroy(); return; }
  const asked = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  let file = join(serving, asked);
  if (!existsSync(file) || asked === "/") file = join(serving, "index.html");
  /* The worker must never be handed a cached copy of itself. */
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", TYPES[extname(file)] || "application/octet-stream");
  res.end(readFileSync(file));
});
await new Promise((r) => site.listen(PORT, "127.0.0.1", r));

const DEBUG = await freePort();
const PROFILE = `/tmp/sw-check-${process.pid}`;
const chrome = spawn("google-chrome",
  ["--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${DEBUG}`,
   "--remote-allow-origins=*", `--user-data-dir=${PROFILE}`, "about:blank"], { stdio: "ignore" });
const stop = (code) => {
  chrome.kill();
  site.close();
  /* Chrome may still be releasing its profile; a directory that will not delete
     must not turn a passed run into a thrown error. */
  try { rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp */ }
  restore();
  process.exit(code);
};
process.on("uncaughtException", (e) => { console.error(e.message); stop(1); });
await wait(3500);

const tab = (await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json()).find((x) => x.type === "page");
const ws = new WebSocket(tab.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.on("open", r));
let id = 0;
const waiting = new Map();
ws.on("message", (m) => {
  const msg = JSON.parse(m);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
});
const send = (method, params = {}) =>
  new Promise((r) => { const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
await send("Runtime.enable");
await send("Page.enable");
const evalIn = async (fn, ...args) => {
  const r = await send("Runtime.evaluate", {
    expression: `(${fn})(${args.map((a) => JSON.stringify(a)).join(",")})`,
    awaitPromise: true, returnByValue: true,
  });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed");
  return r.result?.result?.value;
};

const fails = [];
const say = (ok, label, got = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${got ? ` — ${got}` : ""}`);
  if (!ok) fails.push(label);
};

const running = () => evalIn(() => ({
  bundle: [...document.querySelectorAll("script[src]")].map((s) => s.src.split("/").pop()).join(" "),
  controlled: !!navigator.serviceWorker?.controller,
  /* Asserted, not assumed: a leftover update offer nobody answers is the state
     this check exists to prevent. */
  offered: !!document.querySelector(".fresh"),
}));

/** Wait for the page to come back on something other than `was`. */
const cameBack = async (was) => {
  for (let n = 0; n < 60; n += 1) {
    await wait(500);
    const now = await running().catch(() => null);
    if (now && now.bundle && now.bundle !== was) return now;
  }
  return running().catch(() => ({ bundle: "(the page never came back)", offered: false }));
};

await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
await wait(2500);
await evalIn(() => navigator.serviceWorker.ready.then(() => true));
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
await wait(2500);
const old = await running();
say(old.controlled, "the worker is serving the page", old.bundle);

/* The deploy. Nothing is pressed after this line. */
serving = B;
await evalIn(() => navigator.serviceWorker.getRegistration().then((r) => r && r.update()).then(() => true));
const after = await cameBack(old.bundle);
say(after.bundle !== old.bundle, "and a newer one puts itself in place, with nothing pressed",
  `${old.bundle} → ${after.bundle}`);
say(!after.offered, "and nothing was ever offered to be dismissed");

/* The worker must not keep serving its own stored build: replacing a worker
 * means fetching its script from behind the gate, so a signed-out browser could
 * sit on a months-old build. Here the page is simply visited after a new build. */
console.log("\nand when the worker is still holding the old build");

execSync(`cp /tmp/sw-pkg.json ${pkg}`);
execSync(`node -e 'const f="${pkg}",j=JSON.parse(require("fs").readFileSync(f,"utf8"));j.version="${was}-third";require("fs").writeFileSync(f,JSON.stringify(j,null,2)+"\\n")'`);
execSync("npx vite build", { cwd: ROOT, stdio: "ignore" });
rmSync(A, { recursive: true, force: true });
cpSync(join(ROOT, "dist"), A, { recursive: true });
execSync(`cp /tmp/sw-pkg.json ${pkg}`);
execSync("npx vite build", { cwd: ROOT, stdio: "ignore" });

await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
await wait(2500);
await evalIn(() => navigator.serviceWorker.ready.then(() => true));
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
await wait(2500);
const before = await running();
say(before.controlled, "a page its worker is in charge of", before.bundle);

serving = A;
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
const ended = await cameBack(before.bundle);
say(ended.bundle !== before.bundle,
  "visiting it gives the build that is up, not the one the worker holds",
  `${before.bundle} → ${ended.bundle}`);
say(!ended.offered, "and there was nothing to press");

/* And the half that must not be lost to it: a vessel with no signal. */
console.log("\nand with nothing answering at all");

answering = false;
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
await wait(9000);
const dark = await evalIn(() => ({
  painted: document.getElementById("root")?.children.length ?? -1,
  bundle: [...document.querySelectorAll("script[src]")].map((s) => s.src.split("/").pop()).join(" "),
})).catch(() => ({ painted: -1, bundle: "(nothing came back)" }));
say(dark.painted > 0, "the page still opens, out of the store", `${dark.painted} thing(s) drawn`);
answering = true;

console.log(fails.length ? `\n${fails.length} FAILED` : "\na new build arrives, and no signal still opens the page");
stop(fails.length ? 1 : 0);
