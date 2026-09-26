/**
 * Checks every dashboard panel fits its screen: nothing hidden (scrollHeight equals clientHeight), nothing
 * painted past its bottom edge, nothing painted over anything else. The first alone passes a squeezed grid
 * or flex child, which draws over its neighbour instead of overflowing.
 *
 *   OFFSHORE_REPORT_URL=... OFFSHORE_REPORT_EMAIL=... OFFSHORE_REPORT_PASSWORD=... node scripts/fits.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import WebSocket from "ws";

const SITE = process.env.OFFSHORE_REPORT_URL || "https://forms.example.com";
const EMAIL = process.env.OFFSHORE_REPORT_EMAIL;
const PASSWORD = process.env.OFFSHORE_REPORT_PASSWORD;
const DEBUG = 9488;

/* Two real screens (13" laptop, 24" monitor) plus the windows that broke it (1273x671 is a laptop at 150%).
   The board must never stack to one column, so this also asserts it stays two by two on every screen. */
const SCREENS = [[1920, 1080], [1828, 900], [1600, 1100], [1440, 900], [1273, 671]];
const MODES = [[], ["Year"], ["UK salaried"], ["Year", "UK salaried"], ["tab:Agenda"], ["tab:5 years"], ["tab:Pay"], ["UK salaried", "tab:Pay"]];

if (!EMAIL || !PASSWORD) {
  console.error("set OFFSHORE_REPORT_EMAIL and OFFSHORE_REPORT_PASSWORD to check that the dashboard fits");
  process.exit(2);
}

const chrome = spawn("google-chrome",
  ["--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${DEBUG}`,
   "--remote-allow-origins=*", "--window-size=1600,1100", "about:blank"], { stdio: "ignore" });
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

/* A desktop, told so. Headless has no mouse, `hover: none` matches, and the
   layout that answers is the one built for a phone. */
await call("Emulation.setEmulatedMedia", {
  features: [{ name: "hover", value: "hover" }, { name: "pointer", value: "fine" },
    { name: "any-hover", value: "hover" }],
});

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

/** What every panel on screen is doing with the space it was given. */
const LOOK = `(()=>{
  const out = [];
  document.querySelectorAll('.rota-body').forEach((b) => {
    const name = (b.parentElement.querySelector('h2')?.innerText || '?').trim();
    const box = b.getBoundingClientRect();
    const past = [];
    const over = [];
    const kids = [...b.querySelectorAll('*')].filter((e) =>
      !(e.closest('details:not([open])') && e.tagName !== 'SUMMARY'));
    kids.forEach((e) => {
      const r = e.getBoundingClientRect();
      if (r.height > 2 && r.bottom > box.bottom + 1.5) {
        past.push(String(e.className || e.tagName).split(' ')[0] + ' +' + Math.round(r.bottom - box.bottom));
      }
    });
    const rows = [...b.children];
    for (let i = 1; i < rows.length; i += 1) {
      const a = rows[i - 1].getBoundingClientRect();
      const c = rows[i].getBoundingClientRect();
      if (a.bottom > c.top + 1.5 && a.left < c.right && c.left < a.right) {
        over.push(String(rows[i - 1].className).split(' ')[0] + ' over ' + String(rows[i].className).split(' ')[0]);
      }
    }
    /* A list inside the panel that is taller than its own box is drawn over
       what comes after it (the agenda over its page buttons), and the panel
       itself never knows. */
    b.querySelectorAll('.rota-agenda, .rota-years, .rota-grid').forEach((l) => {
      if (l.scrollHeight > l.clientHeight + 2) over.push(String(l.className).split(' ')[0] + ' taller than its box by ' + (l.scrollHeight - l.clientHeight));
    });
    out.push({ name, hidden: b.scrollHeight - b.clientHeight, past: past.slice(0, 2), over: over.slice(0, 2) });
  });
  return JSON.stringify(out);
})()`;

for (const [w, h] of SCREENS) {
  await call("Emulation.setDeviceMetricsOverride",
    { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  for (const mode of MODES) {
    await call("Page.navigate", { url: `${SITE}/rotation` });
    await wait(7500);
    for (const label of mode) {
      /* "tab:" is one of the calendar quadrant's own views; anything else is
         a button in the header. */
      const [where, name] = label.startsWith("tab:") ? [".rota-tabs button", label.slice(4)] : [".rota-head button", label];
      await evaluate(
        `[...document.querySelectorAll(${JSON.stringify(where)})]`
        + `.find(b=>b.innerText.includes(${JSON.stringify(name)}))?.click()`,
      );
      await wait(1600);
    }
    const where = `${w}×${h}${mode.length ? ` · ${mode.join(" · ").replace(/tab:/g, "")}` : ""}`;
    const panels = JSON.parse(await evaluate(LOOK) || "[]");
    if (!panels.length) { say(false, `${where}: the dashboard is on screen`, "no panels"); continue; }

    /* Three pixels of slack, and no more: a panel's scrollHeight is a whole
       number while its contents are not, so a panel that fits exactly reports
       one or two pixels of nothing. Twenty is a row of figures. */
    const shape = JSON.parse(await evaluate(`JSON.stringify((()=>{
      const q=[...document.querySelectorAll('.rota-q')].map(e=>e.getBoundingClientRect());
      return { cols: new Set(q.map(r=>Math.round(r.left))).size, rows: new Set(q.map(r=>Math.round(r.top))).size,
        page: document.querySelector('.rota').scrollHeight - document.querySelector('.rota').clientHeight };
    })())`) || "{}");
    say(shape.cols === 2 && shape.rows === 2 && shape.page <= 2,
      `${where}: four quadrants, two by two, and the page does not scroll`,
      `${shape.cols}×${shape.rows}, page +${shape.page}px`);
    /* The header is one line, and no button in it has broken its own words
       over two: a header that wraps takes a row of figures from every panel,
       and a button that wraps is a button nobody can read. */
    const head = JSON.parse(await evaluate(`JSON.stringify((()=>{
      const h=document.querySelector('.rota-head');
      const tall=[...h.querySelectorAll('button, .rota-count')].filter(b=>b.getBoundingClientRect().height>44).map(b=>(b.innerText||b.title||'').trim().slice(0,20));
      return {h:Math.round(h.getBoundingClientRect().height), tall};
    })())`) || "{}");
    say(head.h <= 70 && !head.tall.length, `${where}: the header is one line, with every button on one line`,
      `${head.h}px${head.tall.length ? ` · wrapped: ${head.tall.join(", ")}` : ""}`);
    /* Back, Today and Forward are whole and pressable: a rule for another button once shrank them to 28 px
       while every other check passed. */
    const steps = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('.rota-head .rota-step button')].map((b)=>{
      const r=b.getBoundingClientRect(); const g=b.parentElement.getBoundingClientRect();
      const hit=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
      return {w:Math.round(r.width), inside: r.right<=g.right+1 && r.left>=g.left-1, mine: b===hit||b.contains(hit)};
    }))`) || "[]");
    say(steps.length === 3 && steps.every((b) => b.w >= 20 && b.inside && b.mine),
      `${where}: back, today and forward are all there to press`, steps.map((b) => `${b.w}px${b.inside ? "" : " clipped"}${b.mine ? "" : " covered"}`).join(" · "));
    const bars = panels.filter((p) => p.hidden > 3);
    say(bars.length === 0, `${where}: no panel keeps anything behind a scroll`,
      bars.map((p) => `${p.name} +${p.hidden}`).join(" · ") || `${panels.length} panels`);
    const spilt = panels.filter((p) => p.past.length);
    say(spilt.length === 0, `${where}: and nothing is drawn past a panel's edge`,
      spilt.map((p) => `${p.name}: ${p.past.join(", ")}`).join(" · ") || "clean");
    const piled = panels.filter((p) => p.over.length);
    say(piled.length === 0, `${where}: and nothing is drawn over anything else`,
      piled.map((p) => `${p.name}: ${p.over.join(", ")}`).join(" · ") || "clean");
  }
}

/* And forward turns the month, and back turns it back. */
const monthNow = () => evaluate(`document.querySelector('.rota-q h2')?.innerText`);
const was = await monthNow();
await evaluate(`document.querySelector('.rota-head .rota-step button:last-child').click()`);
await wait(500);
const next = await monthNow();
await evaluate(`document.querySelector('.rota-head .rota-step button:first-child').click()`);
await wait(500);
say(next && next !== was && (await monthNow()) === was, "forward goes to the next month, and back returns", `${was} → ${next}`);

/* The page itself never scrolls sideways, whatever the panels are doing. */
const wide = Number(await evaluate(
  `document.documentElement.scrollWidth - document.documentElement.clientWidth`));
say(wide <= 0, "and the page does not run off the side", `${wide}px`);

console.log(fails.length
  ? `\n${fails.length} FAILED:\n- ${fails.join("\n- ")}`
  : "\nthe dashboard fits the screen, on every screen it was asked about");
ws.close();
stop(fails.length ? 1 : 0);
