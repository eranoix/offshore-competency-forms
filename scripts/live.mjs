/**
 * Opens the published site signed in and fails on anything the browser console
 * reports, covering the pages the API-less smoke test never runs.
 *
 *   OFFSHORE_REPORT_EMAIL=... OFFSHORE_REPORT_PASSWORD=... npm run live
 *
 * No credentials live in the repository; without them it says so and stops.
 */
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import WebSocket from "ws";

const SITE = process.env.OFFSHORE_REPORT_URL || "https://forms.example.com";
const EMAIL = process.env.OFFSHORE_REPORT_EMAIL;
const PASSWORD = process.env.OFFSHORE_REPORT_PASSWORD;
const ROUTES = ["/", "/trip-feedback", "/caap", "/library", "/forms", "/rotation", "/account", "/roadmap"];
const DEBUG = 9436;

if (!EMAIL || !PASSWORD) {
  console.error("set OFFSHORE_REPORT_EMAIL and OFFSHORE_REPORT_PASSWORD to check the live site");
  process.exit(2);
}

const chrome = spawn(
  "google-chrome",
  ["--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${DEBUG}`,
   "--remote-allow-origins=*", "--window-size=1400,1000", "about:blank"],
  { stdio: "ignore" },
);
const stop = (code) => { chrome.kill(); process.exit(code); };
process.on("SIGINT", () => stop(1));
await wait(4000);

const res = await fetch(`http://127.0.0.1:${DEBUG}/json`);
const page = (await res.json()).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });

let id = 0;
const trouble = [];
const call = (method, params = {}) =>
  new Promise((done) => {
    const mine = (id += 1);
    const listen = (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id === mine) { ws.off("message", listen); done(msg.result || {}); }
    };
    ws.on("message", listen);
    ws.send(JSON.stringify({ id: mine, method, params }));
  });

ws.on("message", (raw) => {
  const msg = JSON.parse(raw);
  const p = msg.params || {};
  if (msg.method === "Runtime.exceptionThrown") {
    const d = p.exceptionDetails || {};
    trouble.push((d.exception?.description || d.text || "").split("\n")[0]);
  } else if (msg.method === "Log.entryAdded" && p.entry?.level === "error") {
    trouble.push(`${p.entry.text} ${p.entry.url || ""}`.trim().slice(0, 180));
  }
});

const ready = new Promise((go) => ws.on("open", go));
await ready;
await call("Runtime.enable");
await call("Log.enable");
await call("Page.enable");

const evaluate = (expression) =>
  call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
    .then((r) => r.result?.value);

await call("Page.navigate", { url: `${SITE}/login.html` });
await wait(5000);
await evaluate(
  `(()=>{const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;` +
  `s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};` +
  `set(document.getElementById('email'),${JSON.stringify(EMAIL)});` +
  `set(document.getElementById('password'),${JSON.stringify(PASSWORD)});` +
  `document.getElementById('f').requestSubmit()})()`,
);
await wait(9000);
if ((await evaluate("location.pathname")) === "/login.html") {
  console.error("FAIL could not sign in — check OFFSHORE_REPORT_EMAIL and OFFSHORE_REPORT_PASSWORD");
  stop(1);
}

let bad = 0;
for (const route of ROUTES) {
  trouble.length = 0;
  await call("Page.navigate", { url: `${SITE}${route}` });
  await wait(9000);
  const painted = (await evaluate("document.getElementById('root')?.children.length ?? -1")) ?? -1;
  const blank = painted < 1;
  /* Nothing may push the page sideways. A screen that scrolls left and right
     is how a panel that grew, or an editor that was given the wrong box,
     announces itself — and it is invisible in a screenshot of the top left. */
  const sideways = await evaluate(
    "document.documentElement.scrollWidth > innerWidth + 2",
  );
  if (sideways) {
    bad += 1;
    console.error(`FAIL ${route} — the page scrolls sideways`);
  }
  if (blank || trouble.length) {
    bad += 1;
    console.error(`FAIL ${route}${blank ? " — nothing rendered" : ""}`);
    [...new Set(trouble)].slice(0, 6).forEach((t) => console.error(`     ${t}`));
  } else {
    console.log(`ok   ${route}`);
  }
}

console.log(bad ? `\n${bad} page(s) broken on the live site` : `\nall ${ROUTES.length} pages clean, signed in`);
ws.close();
stop(bad ? 1 : 0);
