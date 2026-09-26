/**
 * Where the trip report's ink lands on the paper, which browser layout
 * measurements cannot show: prints the page as the browser does, renders it, and
 * reads the first and last rows of pixels that carry ink.
 *
 * It prints with `preferCSSPageSize`, as the print dialog does, so the page's own
 * @page rules decide paper and margins; passing size and zero margins by hand
 * gives a usable height the real dialog does not have.
 *
 *   OFFSHORE_REPORT_URL=... OFFSHORE_REPORT_EMAIL=... OFFSHORE_REPORT_PASSWORD=... node scripts/printed.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const SITE = process.env.OFFSHORE_REPORT_URL || "https://forms.example.com";
const EMAIL = process.env.OFFSHORE_REPORT_EMAIL;
const PASSWORD = process.env.OFFSHORE_REPORT_PASSWORD;
const DEBUG = 9493;
/* Which page to print. The trip report by default, because that is the one
   the margins were bought for; the rotation sheet borrows the same geometry
   and has to be held to the same measurement. */
const ROUTE = process.env.OFFSHORE_REPORT_ROUTE || "/trip-feedback";

/* How close to the edge ink may start: printers lose the first four or five
   millimetres of a sheet. Eight is what the paper allows; giving the second page
   more room costs a blank third page on every report. */
const CLEAR_OF_THE_EDGE = 8;


if (!EMAIL || !PASSWORD) {
  console.error("set OFFSHORE_REPORT_EMAIL and OFFSHORE_REPORT_PASSWORD to check the printed page");
  process.exit(2);
}

const chrome = spawn("google-chrome",
  ["--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${DEBUG}`,
   "--remote-allow-origins=*", "--window-size=1400,1000", "about:blank"], { stdio: "ignore" });
const stop = (code) => { chrome.kill(); process.exit(code); };
process.on("SIGINT", () => stop(1));
await wait(4000);

const tab = (await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(tab.webSocketDebuggerUrl, { perMessageDeflate: false });
let id = 0;
const call = (method, params = {}) => new Promise((done) => {
  const mine = (id += 1);
  const listen = (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id === mine) { ws.off("message", listen); done(msg.result || {}); }
  };
  ws.on("message", listen);
  ws.send(JSON.stringify({ id: mine, method, params }));
});
await new Promise((go) => ws.on("open", go));
await call("Page.enable");
await call("Runtime.enable");
const evaluate = (expression) =>
  call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
    .then((r) => r.result?.value);

const fails = [];
const say = (ok, label, got = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${got ? ` — ${got}` : ""}`);
  if (!ok) fails.push(label);
};

await call("Page.navigate", { url: `${SITE}/login.html` });
await wait(4500);
await evaluate(
  `(()=>{const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;`
  + `s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};`
  + `set(document.getElementById('email'),${JSON.stringify(EMAIL)});`
  + `set(document.getElementById('password'),${JSON.stringify(PASSWORD)});`
  + `document.querySelector('form').requestSubmit();})()`,
);
await wait(6500);
await call("Page.navigate", { url: `${SITE}${ROUTE}` });
await wait(9000);

const sheets = Number(await evaluate(`document.querySelectorAll('.sheet').length`));
say(sheets > 0, `${ROUTE} is on the screen to be printed`, `${sheets} sheet(s)`);
if (!sheets) stop(1);

/* Print as a dialog left alone does: the page's own paper and margins, and
   backgrounds off (with them on, the app's dark ground reads as ink from 0mm). */
const pdf = await call("Page.printToPDF", { preferCSSPageSize: true, printBackground: false });
const here = mkdtempSync(join(tmpdir(), "printed-"));
const file = join(here, "trip-feedback.pdf");
writeFileSync(file, Buffer.from(pdf.data, "base64"));
/* Where to go and look when a number below is a surprise. */
console.log(`      the printed file is at ${file}`);

execFileSync("pdftoppm", ["-gray", "-r", "100", file, join(here, "p")]);
const pages = execFileSync("ls", [here]).toString().split("\n").filter((n) => n.endsWith(".pgm")).sort();
say(pages.length === sheets, "one printed page for each sheet, and no blank one after",
  `${pages.length} page(s) for ${sheets} sheet(s)`);

/** The first and last rows of a grey page that carry any ink, in millimetres. */
function inkOf(path) {
  const raw = readFileSync(path);
  /* A P5 grey map: the magic, the width, the height, the depth, then bytes. */
  let at = 0, seen = [];
  while (seen.length < 4) {
    while (raw[at] === 0x20 || raw[at] === 0x0a || raw[at] === 0x09 || raw[at] === 0x0d) at += 1;
    if (raw[at] === 0x23) { while (raw[at] !== 0x0a) at += 1; continue; }
    let word = "";
    while (at < raw.length && raw[at] > 0x20) { word += String.fromCharCode(raw[at]); at += 1; }
    seen.push(word);
  }
  at += 1;
  const w = Number(seen[1]), h = Number(seen[2]);
  const rows = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 2) {
      if (raw[at + y * w + x] < 235) { rows.push(y); break; }
    }
  }
  const mm = (px) => Math.round((px / 100) * 25.4 * 10) / 10;
  return rows.length ? { top: mm(rows[0]), bottom: mm(h - rows[rows.length - 1]) } : null;
}

for (const name of pages) {
  const ink = inkOf(join(here, name));
  if (!ink) { say(false, `${name} has no ink on it at all`); continue; }
  /* The top is the assertion. The bottom is reported and not judged: a page
     will not carry more than about 272mm of a 265mm sheet before it spills a
     blank one, so there are only 7mm to spend and they go where the form was
     being cut. A balanced page is not on offer; an uncut one is. */
  say(ink.top >= CLEAR_OF_THE_EDGE,
    `${name}: nothing starts where a printer cannot print`,
    `${ink.top}mm above · ${ink.bottom}mm below`);
}

console.log(fails.length
  ? `\n${fails.length} FAILED:\n- ${fails.join("\n- ")}`
  : `\n${ROUTE} prints where it should`);
stop(fails.length ? 1 : 0);
