/**
 * A new build arriving on its own on the real site (edge gate, HTTPS, worker
 * script served only with a session), which a local folder cannot reproduce.
 * It publishes nothing: when it says so, deploy and move the alias in another shell.
 *
 *   OFFSHORE_REPORT_EMAIL=... OFFSHORE_REPORT_PASSWORD=... node scripts/live-update.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { rmSync } from "node:fs";
import WebSocket from "ws";
import { freePort } from "./port.mjs";

const SITE = process.env.OFFSHORE_REPORT_SITE || "https://forms.example.com";
const EMAIL = process.env.OFFSHORE_REPORT_EMAIL;
const PASSWORD = process.env.OFFSHORE_REPORT_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.log("set OFFSHORE_REPORT_EMAIL and OFFSHORE_REPORT_PASSWORD to check the live site");
  process.exit(0);
}

const DEBUG = await freePort();
const PROFILE = `/tmp/live-update-${process.pid}`;
const chrome = spawn("google-chrome",
  ["--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${DEBUG}`,
   "--remote-allow-origins=*", `--user-data-dir=${PROFILE}`, "about:blank"], { stdio: "ignore" });
const stop = (code) => { chrome.kill(); rmSync(PROFILE, { recursive: true, force: true }); process.exit(code); };
process.on("uncaughtException", (e) => { console.error(e.message); stop(1); });
await wait(3500);

const tab = (await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json()).find((x) => x.type === "page");
const ws = new WebSocket(tab.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.on("open", r));
let id = 0;
const waiting = new Map();
const errors = [];
ws.on("message", (m) => {
  const msg = JSON.parse(m);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error")
    errors.push(msg.params.args.map((a) => a.value || a.description).join(" "));
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

await send("Page.navigate", { url: `${SITE}/login` });
await wait(2500);
await evalIn(async (email, password) => {
  await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }) });
  return true;
}, EMAIL, PASSWORD);
await send("Page.navigate", { url: `${SITE}/caap` });
await wait(4000);

const state = () => evalIn(() => ({
  bundle: [...document.querySelectorAll("script[src]")].map((s) => s.src.split("/").pop()).join(" "),
  controlled: !!navigator.serviceWorker?.controller,
  /* A leftover offer bar on the live site would mean a build that never arrived. */
  offered: !!document.querySelector(".fresh"),
}));
await evalIn(() => navigator.serviceWorker.ready.then(() => true));
await send("Page.navigate", { url: `${SITE}/caap` });
await wait(4000);
const old = await state();
say(old.controlled, "the worker is serving the live site", old.bundle);
/* The worker's own script is behind the gate: if the edge ever hands it a
   redirect instead, no update can arrive at all. */
const script = await evalIn(async () => {
  const res = await fetch("/sw.js", { cache: "no-store" });
  return { status: res.status, redirected: res.redirected, type: res.headers.get("content-type") };
});
say(script.status === 200 && !script.redirected, "and its own script comes through the gate",
  `${script.status}${script.redirected ? " after a redirect" : ""} · ${script.type}`);

console.log(`\n  waiting for a newer build at ${SITE} — deploy and move the alias now`);
let after = null;
for (let n = 0; n < 240; n += 1) {
  await wait(5000);
  await evalIn(() => navigator.serviceWorker.getRegistration().then((r) => r && r.update()).then(() => true))
    .catch(() => {});
  const now = await state().catch(() => null);
  if (now?.bundle && now.bundle !== old.bundle) { after = now; break; }
}
say(!!after, "the newer build puts itself in place, with nothing pressed",
  `${old.bundle} → ${after?.bundle || "(it never arrived)"}`);
if (!after) { console.log(`\n${fails.length} FAILED`); stop(1); }
say(!after.offered, "and nothing was ever offered to be dismissed");
const real = errors.filter((e) => !/favicon|manifest|Failed to load resource/i.test(e));
say(real.length === 0, "with nothing broken in the console", real.slice(0, 2).join(" · "));

console.log(fails.length ? `\n${fails.length} FAILED` : "\na new build reaches the live site on its own");
stop(fails.length ? 1 : 0);
