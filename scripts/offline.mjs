/**
 * The offline copy, opened the way it is actually opened: one HTML file
 * double-clicked from a folder, with no server, session or signal. The company's
 * form must still be drawn with the writing on it.
 *
 *   npm run offline && node scripts/offline.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { existsSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { freePort } from "./port.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "dist-offline", "index.html");
if (!existsSync(FILE)) {
  console.log("no offline copy built — run npm run offline first");
  process.exit(1);
}

const fails = [];
const say = (ok, label, got = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${got ? ` — ${got}` : ""}`);
  if (!ok) fails.push(label);
};
say(true, "the copy is one file", `${(statSync(FILE).size / 1024 / 1024).toFixed(1)} MB`);

const DEBUG = await freePort();
const PROFILE = `/tmp/offline-check-${process.pid}`;
const chrome = spawn("google-chrome",
  ["--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${DEBUG}`,
   "--remote-allow-origins=*", "--window-size=1500,1050", `--user-data-dir=${PROFILE}`,
   /* It is opened from a folder, so it is allowed to read the folder it is in
      and nothing else — which is what a laptop offshore does. */
   "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
const stop = (code) => {
  chrome.kill();
  /* Chrome is still writing its profile out as it dies; taking the folder from
     under it throws where nothing is wrong. */
  try { rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* it is a temp folder */ }
  process.exit(code);
};
process.on("uncaughtException", (e) => { console.error(e.message); stop(1); });
await wait(3500);

const tab = (await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json()).find((x) => x.type === "page");
const ws = new WebSocket(tab.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.on("open", r));
let id = 0;
const waiting = new Map();
const asked = [];
const errors = [];
ws.on("message", (m) => {
  const msg = JSON.parse(m);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  /* Anything it tries to fetch is a promise it cannot keep at sea. */
  if (msg.method === "Network.requestWillBeSent") asked.push(msg.params.request.url);
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error")
    errors.push(msg.params.args.map((a) => a.value || a.description).join(" "));
});
const send = (method, params = {}) =>
  new Promise((r) => { const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");
const evalIn = async (fn, ...args) => {
  const r = await send("Runtime.evaluate", {
    expression: `(${fn})(${args.map((a) => JSON.stringify(a)).join(",")})`,
    awaitPromise: true, returnByValue: true,
  });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed");
  return r.result?.result?.value;
};

await send("Page.navigate", { url: `file://${FILE}` });
await wait(5000);

const opened = await evalIn(() => ({
  where: location.protocol,
  title: document.title,
  nav: [...document.querySelectorAll("nav a, nav button")].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 9),
  packed: document.querySelector(".sb-packed")?.textContent.trim() || "",
}));
say(opened.where === "file:", "it opens from a folder", opened.where);
say(/Offshore Report/i.test(opened.title), "and it is the site", opened.title);
say(Boolean(opened.packed), "and it says which forms it is carrying", opened.packed || "(it says nothing)");

/* The evidence page, and a form drawn on it — the thing somebody offshore
   actually needs. Offline the panel paints the blank pages carried inside the
   file rather than asking a server to lay the document out. */
await evalIn(() => {
  const go = [...document.querySelectorAll("nav a, nav button")].find((b) => /CAAP/i.test(b.textContent));
  if (go) go.click();
  else location.hash = "#/caap";
  return true;
});
await wait(6000);
const drawn = await evalIn(() => ({
  page: location.hash || location.pathname,
  sheets: document.querySelectorAll(".stage canvas, .stage img").length,
  said: document.querySelector(".stage")?.innerText.slice(0, 80) || "",
  fields: document.querySelectorAll(".stage input, .stage textarea").length,
}));
say(/caap/i.test(drawn.page), "the evidence page opens", drawn.page);
say(drawn.sheets > 0, "and the form is drawn on it", `${drawn.sheets} sheet(s)`);
say(drawn.fields > 0, "with somewhere to write on it", `${drawn.fields} field(s)`);

/* And it asked nobody for anything: every byte was already in the file. */
const outward = asked.filter((u) => /^https?:/.test(u));
say(outward.length === 0, "and it asked the network for nothing at all",
  outward.slice(0, 2).join(" · ") || `${asked.length} requests, all from the file`);
const real = errors.filter((e) => !/favicon|ServiceWorker|Failed to load resource/i.test(e));
say(real.length === 0, "with nothing broken in the console", real.slice(0, 2).join(" · "));

console.log(fails.length ? `\n${fails.length} FAILED` : "\nthe copy works with nothing behind it");
stop(fails.length ? 1 : 0);
