const __REPO = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/\/$/, "");
/**
 * The pack panel, driven in a real browser against the real build.
 *
 *   npm run build && node scripts/pack.mjs
 *
 * It first checks the served bundle against the one on disk: a service worker
 * can serve a stale build, and every result after that would be about old code.
 */
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import WebSocket from "ws";
import { freePort } from "./port.mjs";

/* A fresh port each run: an old server left on a shared port holds an old
   file map, so the browser would run a build no longer on disk. */
const PORT = await freePort();
const DEBUG = await freePort();
const site = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
  { cwd: `${__REPO}`, stdio: "ignore", detached: true });
const PROFILE = `/tmp/pack-check-${process.pid}`;
const chrome = spawn("google-chrome",
  ["--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${DEBUG}`,
   "--remote-allow-origins=*", "--window-size=1500,1050", `--user-data-dir=${PROFILE}`,
   "--disable-features=AutofillServerCommunication,AutofillEnableAccountWalletStorage",
   "about:blank"], { stdio: "ignore" });
/* npx spawns vite as a child of its own: killing the group, not the shell. */
const stop = (c) => {
  try { process.kill(-site.pid); } catch { /* already gone */ }
  chrome.kill();
  process.exit(c);
};
process.on("uncaughtException", (e) => { console.error(e.message); stop(1); });
process.on("SIGINT", () => stop(1));
await wait(4500);

const tab = (await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json()).find((x) => x.type === "page");
const ws = new WebSocket(tab.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.on("open", r));
let id = 0;
const waiting = new Map();
const errors = [];
ws.on("message", (m) => {
  const msg = JSON.parse(m);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  if (msg.method === "Runtime.exceptionThrown")
    errors.push(msg.params.exceptionDetails?.exception?.description || "exception");
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

await send("Page.navigate", { url: `http://localhost:${PORT}/caap` });
await wait(3500);

const click = (sel, n = 0) => evalIn((s, i) => {
  const el = document.querySelectorAll(s)[i];
  if (!el) return false;
  el.click();
  return true;
}, sel, n);
const clickText = (sel, text) => evalIn((s, t) => {
  const el = [...document.querySelectorAll(s)].find((x) => x.textContent.trim().startsWith(t));
  if (!el) return false;
  el.click();
  return true;
}, sel, text);
const text = (sel) => evalIn((s) => [...document.querySelectorAll(s)].map((e) => e.textContent.trim()), sel);
const count = (sel) => evalIn((s) => document.querySelectorAll(s).length, sel);

const served = await evalIn(() => ({
  script: [...document.querySelectorAll("script[src]")].map((x) => x.src.split("/").pop()).join(" "),
  sw: !!navigator.serviceWorker?.controller,
}));
console.log(`      [bundle] ${served.script}${served.sw ? " (from the service worker)" : ""}`);
const onDisk = (await import("node:fs")).readdirSync(`${__REPO}/dist/assets`).find((f) => /^index-.*\.js$/.test(f));
say(served.script === onDisk, "the browser is running the build on disk", `${served.script} vs ${onDisk}`);
const tabs = await text(".tab-bar button");
say(tabs.length === 4, "four folder tabs", tabs.join(" | "));
say(tabs[0].startsWith("The pack") && tabs[1].startsWith("Tasks") && tabs[3].startsWith("People"),
  "in the order The pack · Tasks · Areas · People");

await clickText(".tab-bar button", "The pack");
await wait(300);
await click('.copies li:first-child .step button:last-child');
await wait(200);
await click('.copies li:first-child .step button:last-child');
await wait(400);
const refs = (await text(".copies li em")).join(" ").split(/\s+/).filter(Boolean);
say(JSON.stringify(refs) === JSON.stringify(["WT01", "WT02", "WT03", "OT01", "QU01", "FB01"]),
  "six documents, referenced the way his paperwork does", refs.join(" "));
say((await text(".tab-bar button"))[0].includes("6"), "and the tab says how many");
/* The stepper does not wander: one column for the labels, one for the
   steppers, and the references take what is left. */
const steppers = await evalIn(() =>
  [...document.querySelectorAll(".copies .step")].map((s) => Math.round(s.getBoundingClientRect().left)),
);
say(new Set(steppers).size === 1, "the steppers stand in one column whatever each row says",
  steppers.join(" "));

await clickText(".tab-bar button", "Tasks");
await wait(400);
const lens = await text(".lens button");
say(lens.length === 7 && lens[0] === "All 6", "the lens offers all six and each one", lens.join(" "));
/* The task book ships grouped and shut, the same as the scheme's sections. */
const shutGroups = await count(".unit");
const rowsWhenShut = await count(".mark-row");
say(shutGroups > 1 && rowsWhenShut === 0, "the task groups arrive collapsed",
  `${shutGroups} groups, ${rowsWhenShut} rows showing`);
await click(".unit-open", 0);
await wait(300);
say((await count(".mark-row")) > 0, "and a group opens when pressed", `${await count(".mark-row")} rows`);
/* The name only: the row also carries what the task would close, which is not
   part of what it is called. */
const firstTask = await evalIn(() =>
  (document.querySelector(".mark-row .mark-name")?.childNodes[0]?.textContent || "").trim(),
);
const grid = await evalIn(() => document.querySelectorAll(".mark-row .marks button").length / document.querySelectorAll(".mark-row").length);
say(grid === 6, "every task shows all six documents", String(grid));
await evalIn(() => {
  const row = document.querySelector(".mark-row");
  [...row.querySelectorAll(".marks button")].find((b) => b.textContent.trim() === "WT02").click();
});
await wait(400);
const on = await evalIn(() => document.querySelector(".mark-row .marks button.on")?.textContent.trim() || "");
say(on === "WT02", "marking sticks", on);
const badge = await text(".tab-bar button");
say(badge[1].startsWith("Tasks") && badge[1].includes("1"), "the Tasks tab counts it", badge[1]);

/* One press puts a whole group on one document — and says which. */
const allLabel = await evalIn(() => document.querySelector(".unit-all").textContent.replace(/\s+/g, " ").trim());
say(/^All WT01$/.test(allLabel), "the bulk button names the document it writes to", allLabel);
await evalIn(() => [...document.querySelectorAll(".lens button")].find((b) => b.textContent.trim() === "WT03").click());
await wait(400);
/* The group stays as it was left; open it only if the lens shut it. */
if ((await count(".unit .mark-row")) === 0) {
  await click(".unit-open", 0);
  await wait(300);
}
const forLens = await evalIn(() => document.querySelector(".unit-all").textContent.replace(/\s+/g, " ").trim());
say(/^All WT03$/.test(forLens), "and follows the lens", forLens);
const inGroup = await count(".unit .mark-row");
await click(".unit-all", 0);
await wait(400);
const ticked = await evalIn(() => document.querySelectorAll(".unit .tick.on").length);
say(inGroup > 1 && ticked === inGroup, "one press marks the whole group", `${ticked} of ${inGroup}`);
const undo = await evalIn(() => document.querySelector(".unit-all").textContent.replace(/\s+/g, " ").trim());
say(/^None WT03$/.test(undo), "and then offers to take it off again", undo);
await click(".unit-all", 0);
await wait(400);
say((await evalIn(() => document.querySelectorAll(".unit .tick.on").length)) === 0, "which it does");
await evalIn(() => [...document.querySelectorAll(".lens button")].find((b) => b.textContent.trim() === "All 6").click());
await wait(400);

/* The few tasks that, together, would close what nothing covers yet. */
const lit = await evalIn(() => {
  const note = document.querySelector(".level-note.lit")?.innerText.replace(/\s+/g, " ") || "";
  /* The name and what it would close are read apart: a long name can overflow
     and take the count with it. */
  const rows = [...document.querySelectorAll(".mark-row.closes")].map(
    (r) => r.querySelector(".mark-name em.would")?.textContent.replace(/\s+/g, " ").trim() || "",
  );
  const heads = [...document.querySelectorAll(".chip.would")].map((c) => c.textContent.trim());
  return {
    note, rows, heads,
    helping: Number(note.match(/^(\d+) tasks/)?.[1] ?? 0),
    stars: document.querySelectorAll(".mark-row.finishes").length,
    all: document.querySelectorAll(".mark-row").length,
  };
});
say(lit.note.includes("would close"), "the panel says how many would close what is open", lit.note.slice(0, 96));
say(lit.rows.length > 0, "the tasks that would close something are lit", `${lit.rows.length} of ${lit.all} showing`);
say(lit.rows.every((r) => /would close \d/.test(r)), "and each says what it would answer",
  lit.rows[0] || "(none)");
/* Two answers: what would help, and the few that would finish it. The star
   set is spread over every group, so it is counted from the line that speaks
   for the whole list rather than from the one group that happens to be open. */
const finishing = Number(lit.note.match(/The (\d+) marked/)?.[1] ?? -1);
say(finishing > 0 && finishing < lit.helping, "and the few that would finish it are marked apart",
  `${finishing} of ${lit.helping} that help`);

const barSaid = await evalIn(() =>
  [...document.querySelectorAll(".doc-bar button")].map((b) => b.innerText.split("\n").join(" ")),
);
say(/1 task/.test(barSaid[1]) && /empty/.test(barSaid[0]), "only the marked document carries it",
  barSaid.slice(0, 3).join(" | "));

/* A task brings what it proves: the areas move without anyone opening them. */
const brought = await evalIn(() => {
  const tab = (n) => [...document.querySelectorAll(".tab-bar button")].find((b) => b.textContent.startsWith(n));
  return { areas: tab("Areas").textContent.trim() };
});
say(/Areas\d+\/\d+/.test(brought.areas.replace(/\s/g, "")) && !/^Areas0\//.test(brought.areas.replace(/\s/g, "")),
  "marking a task marks what it proves", brought.areas);

/* Taking off what a task brought must stay off — it is not held in a list,
   so removing it cannot be done by removing it. */
await clickText(".tab-bar button", "Areas");
await wait(500);
await evalIn(() => [...document.querySelectorAll(".lens button")].find((b) => b.textContent.trim() === "WT02").click());
await wait(400);
await evalIn(() => document.querySelectorAll(".unit-open")[0].click());
await wait(400);
const before = await evalIn(() => document.querySelectorAll(".unit .tick.on").length);
await evalIn(() => document.querySelector(".unit .tick.on")?.click());
await wait(400);
const after = await evalIn(() => document.querySelectorAll(".unit .tick.on").length);
say(after === before - 1, "one the task brought can be taken off", `${before} → ${after}`);
/* Now off the task and on again: what was taken off by hand does not return. */
await clickText(".tab-bar button", "Tasks");
await wait(500);
await evalIn(() => {
  const row = [...document.querySelectorAll(".mark-row")].find((r) => r.querySelector(".marks button.on"));
  row?.querySelector(".marks button.on")?.click();
});
await wait(400);
await evalIn(() => {
  const row = document.querySelector(".mark-row");
  [...row.querySelectorAll(".marks button")].find((b) => b.textContent.trim() === "WT02")?.click();
});
await wait(500);
await clickText(".tab-bar button", "Areas");
await wait(500);
if ((await count(".unit .mark-row")) === 0) {
  await evalIn(() => document.querySelectorAll(".unit-open")[0].click());
  await wait(400);
}
const back = await evalIn(() => document.querySelectorAll(".unit .tick.on").length);
say(back === after, "and stays off when the task comes and goes", `${after} → ${back}`);

await clickText(".tab-bar button", "Areas");
await wait(400);
/* The lens is a toggle: pressing the one already chosen puts it back to all. */
await evalIn(() => {
  const now = document.querySelector(".lens button.on")?.textContent.trim();
  if (now !== "WT02") [...document.querySelectorAll(".lens button")].find((b) => b.textContent.trim() === "WT02").click();
});
await wait(500);
const lensOn = await evalIn(() => document.querySelector(".lens button.on")?.textContent.trim());
say(lensOn === "WT02", "the lens carries over to the areas", lensOn);
const suggest = await text(".suggest b");
say(suggest.length === 1, "the tasks on it offer parts of the scheme", suggest[0] || "(none)");
await click(".suggest button");
await wait(400);
const opened = await count(".unit .mark-list");
say(opened >= 1, "the offer opens them", `${opened} open`);
/* The count as it stands right now, not as it stood several steps ago. */
const justBefore = (await text(".tab-bar button"))[2];
await evalIn(() => document.querySelector(".unit .mark-list .tick:not(.on)")?.click());
await wait(400);
const areaBadge = (await text(".tab-bar button"))[2];
const was = Number(justBefore.replace(/\s/g, "").match(/Areas(\d+)/)?.[1] || 0);
const now = Number(areaBadge.replace(/\s/g, "").match(/Areas(\d+)/)?.[1] || 0);
say(now === was + 1, "and one ticked by hand is one more on top of them", `${was} → ${now}`);

await clickText(".tab-bar button", "People");
await wait(400);
const signers = await count(".signer");
say(signers === 6, "one signer block per document", String(signers));
const heads = await text(".signer-head");
say(heads[1].includes(firstTask), "each says what it is about", heads[1].replace(/\s+/g, " "));
await evalIn(() => document.querySelectorAll('.signer input[list="caap-names"]')[1].focus());
await send("Input.insertText", { text: "Pat Ellis" });
await wait(300);
await evalIn(() => document.activeElement.blur());
await wait(500);
const named = await evalIn(() => document.querySelectorAll('.signer input[list="caap-names"]')[1].value);
say(named === "Pat Ellis", "a name typed on one document stays there", named);
const others = await evalIn(() =>
  [...document.querySelectorAll(".signer")].map((li) => [
    li.querySelector(".ref").textContent,
    li.querySelector('input[list="caap-names"]').value,
  ]),
);
say(others[0][1] === "" && others[2][1] === "", "and does not leak onto the others",
  others.map((x) => `${x[0]}=${x[1] || "—"}`).join(" "));
const peopleBadge = (await text(".tab-bar button"))[3];
say(peopleBadge.includes("1/6"), "the People tab counts who is named", peopleBadge);

await evalIn(() => {
  const b = [...document.querySelectorAll(".doc-bar button")].find((x) => x.textContent.startsWith("WT02"));
  if (b) b.click();
});
await wait(2500);
const stage = await evalIn(() => ({
  bar: [...document.querySelectorAll(".doc-bar button")].map((b) => b.textContent.trim()),
  on: document.querySelector(".doc-bar button.on")?.textContent.trim(),
  fields: [...document.querySelectorAll(".paper input, .paper textarea, .sheet input, .sheet textarea")].map((f) => f.value).filter(Boolean),
  words: (document.querySelector(".sheet-wrap")?.innerText || "").replace(/\s+/g, " ").slice(0, 220),
}));
say(/^WT02/.test(stage.on || ""), "the page moved to WT02", stage.on);
const shown = [...stage.fields, stage.words].join(" | ");
say(shown.includes("Pat Ellis"), "the form shows that document's witness");
/* The task is printed in the form's own header, which the layout service
   draws; offline the preview shows the blank with the fields over it. What
   can be proved here is that each document's own areas reach the stage. */
say(/\d+ criteri/.test(stage.bar[1]) && /empty/.test(stage.bar[0]) && /empty/.test(stage.bar[2]),
  "each document's own count reaches the page", stage.bar.slice(0, 3).join(" | "));
/* All five documents must fit in the bar. */
const barFits = await evalIn(() => {
  const bar = document.querySelector(".doc-bar");
  return { over: bar.scrollWidth - bar.clientWidth, n: bar.children.length };
});
say(barFits.over <= 0, `all ${barFits.n} documents fit the bar without scrolling`,
  barFits.over > 0 ? `${barFits.over}px over` : "");

await clickText(".tab-bar button", "The pack");
await wait(400);
await evalIn(() => {
  const put = (el, v) => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const fields = [...document.querySelectorAll(".rail-body input")];
  const by = (word) =>
    fields.find((f) => f.closest("label")?.querySelector("span")?.textContent.toLowerCase().includes(word));
  put(by("name"), "Zebediah Quicksilver");
  put(by("site"), "Vessel Thunderbird");
});
await wait(500);
await clickText(".tab-bar button", "People");
await wait(500);
const NAMES = ["Ophelia Wrenfield", "Marcus Thorncastle", "Delphine Ashgrove",
  "Cornelius Battersby", "Rosalind Fairweather", "Ignatius Pemberton"];
for (const [n, who] of NAMES.entries()) {
  await evalIn((i) => document.querySelectorAll('.signer input[list="caap-names"]')[i].focus(), n);
  await send("Input.insertText", { text: who });
  await wait(120);
  await evalIn(() => document.activeElement.blur());
  await wait(120);
}
await wait(600);
const panelSays = await evalIn(() =>
  [...document.querySelectorAll(".signer")].map((li) => [
    li.querySelector(".ref").textContent,
    li.querySelector('input[list="caap-names"]').value,
  ]),
);
say(panelSays.every(([, v], n) => Boolean(v)) && new Set(panelSays.map((x) => x[1])).size === 6,
  "six documents, six different signers in the panel",
  panelSays.map(([r, v]) => `${r}=${v.split(" ")[0]}`).join(" "));

/* And now the page itself, document by document: the overlay is filled from
   what the document carries, so it is the panel's answer or it is nothing. */
for (const [ref, who] of panelSays) {
  await evalIn((r) => {
    const b = [...document.querySelectorAll(".doc-bar button")].find((x) => x.textContent.startsWith(r));
    if (b) b.click();
  }, ref);
  await wait(2200);
  const onPage = await evalIn(() =>
    [...document.querySelectorAll(".paper .on-line")].map((f) => [f.getAttribute("aria-label"), f.value]),
  );
  const line = (n) => (onPage[n] || ["", ""])[1];
  say(line(0) === who, `${ref}: its own signer`, `${line(0) || "(blank)"} · wanted ${who}`);
  say(/Thunderbird/.test(line(1)) && line(1).includes("—"),
    `${ref}: the position and the site, joined the way the form joins them`, line(1) || "(blank)");
  say(line(2) === "Zebediah Quicksilver", `${ref}: the candidate`, line(2) || "(blank)");
  say(Boolean(line(3)), `${ref}: the relationship`, line(3) || "(blank)");
  say(onPage.length === 4, `${ref}: four printed lines, all of them filled`, String(onPage.length));
}

await evalIn(() => {
  const b = [...document.querySelectorAll(".doc-bar button")].find((x) => x.textContent.startsWith("QU01"));
  if (b) b.click();
});
await wait(2500);
await evalIn(() => document.querySelector(".paper .in-box")?.focus());
await send("Input.insertText", { text: "Q1: How do you isolate the HPU? A1: Lock off and prove dead." });
await wait(400);
await evalIn(() => document.activeElement.blur());
await wait(2500);
const kept = await evalIn(() => document.querySelector(".paper .in-box")?.value || "");
say(/How do you isolate the HPU/.test(kept) && /Lock off and prove dead/.test(kept),
  "what is typed on a knowledge page is still there after it is laid out again",
  kept.replace(/\s+/g, " ").slice(0, 90) || "(gone)");
say(/^Q1:/.test(kept.trim()), "and it reads back as the form's own questions and answers");
await evalIn(() => {
  const b = [...document.querySelectorAll(".doc-bar button")].find((x) => x.textContent.startsWith("WT02"));
  if (b) b.click();
});
await wait(2000);

const roomy = await evalIn(() => {
  const set = (el, v) => {
    const put = Object.getOwnPropertyDescriptor(
      (el.tagName === "INPUT" ? window.HTMLInputElement : window.HTMLTextAreaElement).prototype, "value").set;
    put.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const box = document.querySelector(".paper .in-box");
  const line = document.querySelector(".paper .on-line");
  if (!box || !line) return null;
  const was = Math.round(box.getBoundingClientRect().height);
  set(box, Array.from({ length: 40 }, (_, i) =>
    `Paragraph ${i + 1}. He stripped and inspected the sheave assembly and recorded it in the log.`).join("\n\n"));
  set(line, "Bartholomew Fotheringay-Wallingford the Third, Superintendent");
  return new Promise((done) => setTimeout(() => done({
    was,
    now: Math.round(box.getBoundingClientRect().height),
    boxOver: box.scrollHeight - box.clientHeight,
    lineOver: line.scrollWidth - line.clientWidth,
    shrank: Math.round(parseFloat(getComputedStyle(line).fontSize) * 10) / 10,
  }), 400));
});
say(roomy && roomy.now > roomy.was * 1.5, "a long statement makes its own room",
  roomy ? `${roomy.was}px → ${roomy.now}px` : "no field");
say(roomy && roomy.boxOver <= 1, "so the box has nothing to scroll", `${roomy?.boxOver}px hidden`);
say(roomy && roomy.lineOver <= 1, "and a long name closes up instead of scrolling the line",
  `${roomy?.lineOver}px hidden at ${roomy?.shrank}px`);

/* The footer: two rows of four. Counted by where the buttons land, not by
   the .act-row elements, since the buttons can wrap within a row. */
const foot = await evalIn(() => {
  const f = document.querySelector(".rail-foot");
  const buttons = [...f.querySelectorAll(".btn")];
  const lines = new Map();
  for (const b of buttons) {
    const top = Math.round(b.getBoundingClientRect().top);
    lines.set(top, (lines.get(top) || 0) + 1);
  }
  return {
    rows: [...lines.keys()].sort((a, b) => a - b).map((t) => lines.get(t)),
    over: f.scrollWidth - f.clientWidth,
    clipped: buttons.filter((b) => b.scrollWidth - b.clientWidth > 1).map((b) => b.innerText.trim()),
    labels: buttons.map((b) => b.innerText.trim()),
  };
});
say(foot.rows.length === 2, "the footer is two rows", foot.rows.join(" + ") + " buttons");
say(foot.rows.every((n) => n === 4), "of four buttons each", foot.rows.join(" + "));
say(foot.over <= 0 && foot.clipped.length === 0, "with nothing cut off",
  foot.clipped.join(" · ") || foot.labels.join(" · "));

const DOWN = `/tmp/pack-down-${process.pid}`;
(await import("node:fs")).mkdirSync(DOWN, { recursive: true });
await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DOWN });
await evalIn(() => [...document.querySelectorAll(".rail-foot .btn")].find((b) => /zip/.test(b.innerText)).click());
await wait(6000);
const fs = await import("node:fs");
const got = fs.readdirSync(DOWN).filter((f) => f.endsWith(".zip"));
say(got.length === 1, "all of them come down as one zip", got.join(" ") || "(nothing)");
if (got.length) {
  const { unzipSync } = await import("fflate");
  const inside = Object.keys(unzipSync(new Uint8Array(fs.readFileSync(`${DOWN}/${got[0]}`))));
  say(inside.length === 6, "with each document as its own file", `${inside.length}: ${inside.join(" · ")}`);
  say(inside.every((f) => f.endsWith(".docx")) && inside.some((f) => f.startsWith("WT02")),
    "named by the reference the panel uses");
}
fs.rmSync(DOWN, { recursive: true, force: true });

const real = errors.filter((e) => !/favicon|manifest|sw\.js|Failed to load resource/i.test(e));
say(real.length === 0, "no errors in the console", real.slice(0, 3).join(" · "));

/* The writing stays shut until the form could be signed: evidence signed by
   nobody is not evidence, and the writing is the expensive part to waste. */
console.log("\nand the writing waits for what a document cannot do without");
const shut = await evalIn(() => {
  const b = [...document.querySelectorAll(".rail-foot .btn")];
  const one = b.find((x) => /^(Write|Improve) them all$/.test(x.innerText.trim()));
  return { off: Boolean(one?.disabled), why: one?.title || "", said: document.querySelector(".watch-tag.bad")?.innerText.trim() || "" };
});
say(shut.off, "with documents still to be told what they are about, it will not write", shut.why.slice(0, 70));
say(/Still needed/.test(shut.why) && /about/.test(shut.why),
  "and it says what it is waiting for rather than sitting there dead", shut.why.slice(0, 70));
say(Boolean(shut.said), "which is written where it can be read, not only on hover", shut.said.slice(0, 70));

/* Told what they are all about, it opens. */
await clickText(".tab-bar button", "Tasks");
await wait(500);
/* The lens is still on one document from the check above, and through it a row
   shows one tick rather than the grid of six. */
await evalIn(() => {
  const all = [...document.querySelectorAll(".lens button")].find((b) => /^All /.test(b.textContent.trim()));
  if (all && !all.classList.contains("on")) all.click();
  return true;
});
await wait(400);
/* The groups arrive shut, and shut again on the way back to the tab. */
if (!(await count(".mark-row"))) { await click(".unit-open", 0); await wait(400); }
await evalIn(() => {
  const row = document.querySelector(".mark-row");
  if (!row) return false;
  row.querySelectorAll(".marks button").forEach((b) => { if (!b.classList.contains("on")) b.click(); });
  return true;
});
await wait(900);
const open = await evalIn(() => {
  const b = [...document.querySelectorAll(".rail-foot .btn")].find((x) => /^Write them all$/.test(x.innerText.trim()));
  return {
    off: Boolean(b?.disabled), why: b?.title || "",
  };
});
say(!open.off, "and once every document is told, it writes", open.why.slice(0, 60));

/* The button counts whole documents although progress is fractional. The
   writing is answered from here so the button can be caught mid-flight
   without an upstream. */
const CANNED = JSON.stringify({ content: [{ type: "text", text:
  "On the Thunderbird I worked with the candidate on the six-monthly maintenance of the launch and " +
  "recovery system. He stripped the sheave assembly, inspected it for wear, re-tensioned the tether " +
  "and recorded every finding in the maintenance log." }] });
const held = [];
ws.on("message", (m) => {
  const msg = JSON.parse(m);
  if (msg.method === "Fetch.requestPaused") held.push(msg.params);
});
await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/ai*" }] });
let answering = true;
/* Which stand-in may answer. A flag alone is not enough: switched off and on
   again within one of its 40 ms naps, the first stand-in wakes up still
   running, and from then on two of them share the queue, one answering with
   the fixed text. Each loop only carries on while the round is its own. */
let round = 1;
(async () => {
  while (answering && round === 1) {
    const one = held.shift();
    if (!one) { await wait(40); continue; }
    await send("Fetch.fulfillRequest", {
      requestId: one.requestId,
      responseCode: 200,
      responseHeaders: [{ name: "content-type", value: "application/json" }],
      body: Buffer.from(one.request.method === "POST" ? CANNED : "").toString("base64"),
    }).catch(() => {});
  }
})();
await evalIn(() => {
  const b = [...document.querySelectorAll(".rail-foot .btn")].find((x) => /^Write /.test(x.innerText));
  if (b) b.click();
});
const labels = new Set();
for (let n = 0; n < 60; n += 1) {
  const said = await evalIn(() => document.querySelector(".btn.run.going span")?.textContent?.trim() || "");
  if (said) labels.add(said);
  else if (labels.size) break;
  await wait(250);
}
answering = false;
await send("Fetch.disable").catch(() => {});
const fractions = [...labels].filter((l) => /\d+\.\d/.test(l));
say(labels.size > 0 && fractions.length === 0,
  "the writing counter counts documents, not the fraction that fills the bar",
  fractions[0] || [...labels].slice(0, 3).join(" · ") || "(the button never said it was writing)");

/* One document can be written on its own: rewriting the set to fix one copy
   would change every other copy's wording. */
console.log("\nand one document can be written on its own");
const onPage = await evalIn(() => {
  const b = [...document.querySelectorAll(".rail-foot .btn")].find((x) => /^(Rewrite|Write) [A-Z]{2}\d/.test(x.innerText));
  const tab = [...document.querySelectorAll(".doc-bar button")].find((x) => x.getAttribute("aria-current") === "page");
  return { label: b?.innerText.trim() || "", on: tab?.innerText.trim().split("\n")[0] || "" };
});
say(/^(Rewrite|Write) /.test(onPage.label), "the footer offers the document on the page by name", onPage.label);
say(!onPage.on || onPage.label.includes(onPage.on.split(/\s/)[0]),
  "and it names the one actually on screen", `${onPage.label} · showing ${onPage.on}`);

/* Every document is given something to say, so a change is visible. Each
   answer differs, so a copy that was written again is a copy whose text moved. */
answering = true;
round = 2;
held.length = 0;
await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/ai*" }] });
let take = 0;
(async () => {
  while (answering && round === 2) {
    const one = held.shift();
    if (!one) { await wait(40); continue; }
    await send("Fetch.fulfillRequest", {
      requestId: one.requestId,
      responseCode: 200,
      responseHeaders: [{ name: "content-type", value: "application/json" }],
      body: Buffer.from(one.request.method === "POST"
        ? JSON.stringify({ content: [{ type: "text", text: `Take ${(take += 1)}: ` +
            "he stripped the sheave assembly on the launch and recovery system, inspected it and logged what he found." }] })
        : "").toString("base64"),
    }).catch(() => {});
  }
})();
/* A press, then proof it started (its button found, text requested from the
   stand-in above) before waiting for the end: a press that has not started
   looks like one that finished. Each step fails out loud, by name. */
const pressAndFinish = async (label, pattern) => {
  const before = take;
  const found = await evalIn((src) => {
    const b = [...document.querySelectorAll(".rail-foot .btn")].find((x) => new RegExp(src).test(x.innerText));
    if (!b) return false;
    b.click();
    return true;
  }, pattern);
  say(found, `${label}: the button is there to press`);
  let asked = false;
  for (let n = 0; n < 60 && !asked; n += 1) { await wait(250); asked = take > before; }
  say(asked, `${label}: pressing it starts the writing`, asked ? `${take - before} answer(s)` : "no text was asked for in 15 s");
  for (let n = 0; n < 180; n += 1) {
    if (!(await evalIn(() => !!document.querySelector(".btn.run.going")))) break;
    await wait(500);
  }
};
await pressAndFinish("writing the set", "^Write ");
/* What each document says is read from the zip that gets sent, one .docx per
   copy, not from the box on screen, which may still show the previous layout.
   Entries that differ before and after are the documents written again. */
const bundleNow = async (into) => {
  fs.rmSync(into, { recursive: true, force: true });
  fs.mkdirSync(into, { recursive: true });
  await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: into });
  await evalIn(() => [...document.querySelectorAll(".rail-foot .btn")].find((b) => /zip/.test(b.innerText)).click());
  for (let n = 0; n < 40; n += 1) {
    await wait(500);
    const got = fs.readdirSync(into).filter((f) => f.endsWith(".zip"));
    if (got.length) {
      await wait(800);
      const { unzipSync } = await import("fflate");
      const box = unzipSync(new Uint8Array(fs.readFileSync(`${into}/${got[0]}`)));
      const { createHash } = await import("node:crypto");
      /* The bytes, not their count: one digit more in a sentence leaves the
         compressed length exactly where it was. */
      return Object.fromEntries(Object.entries(box).map(([name, bytes]) =>
        [name.split(" ")[0], createHash("sha1").update(Buffer.from(bytes)).digest("hex").slice(0, 10)]));
    }
  }
  return {};
};

await evalIn(() => [...document.querySelectorAll(".rail-foot .btn")].find((x) => /^Write /.test(x.innerText))?.click());
for (let n = 0; n < 120; n += 1) {
  await wait(500);
  if (!(await evalIn(() => !!document.querySelector(".btn.run.going")))) break;
}
const SET1 = `/tmp/pack-set1-${process.pid}`;
const wasThere = await bundleNow(SET1);
say(Object.keys(wasThere).length === 6, "the set is written first", Object.keys(wasThere).join(" ") || "(nothing came down)");

const ref = onPage.label.replace(/^(Rewrite|Write) /, "");
await evalIn((r) => {
  const b = [...document.querySelectorAll(".doc-bar button")].find((x) => x.innerText.trim().startsWith(r));
  if (b) b.click();
  return true;
}, ref);
await wait(1200);
await pressAndFinish(`rewriting ${ref}`, "^(Rewrite|Write) [A-Z]{2}\\d");
const SET2 = `/tmp/pack-set2-${process.pid}`;
const second = await bundleNow(SET2);
const moved = Object.keys(wasThere).filter((k) => second[k] !== wasThere[k]);
say(moved.includes(ref), "the one on the page is written again", moved.join(" ") || "(nothing moved at all)");
say(moved.length === 1, "and no other document is touched",
  moved.length === 1 ? `only ${moved[0]}` : `changed: ${moved.join(" ")}`);
fs.rmSync(SET1, { recursive: true, force: true });
fs.rmSync(SET2, { recursive: true, force: true });

answering = false;
await send("Fetch.disable").catch(() => {});

/* The vessel field offers the fleet but stays free text: a trip can be on a
 * chartered ship, a rig or a yard.
 */
console.log("\nand the vessel is offered rather than spelled");
await clickText(".tab-bar button", "The pack");
await wait(700);
/* Found by the list it offers, not by an example in the box: a check that
   looks for the example breaks on a change it should not notice. */
const fleet = await evalIn(() => {
  const field = document.querySelector('.rail input[list="caap-vessels"]');
  if (!field) return null;
  const list = document.getElementById("caap-vessels");
  return {
    typed: field.tagName === "INPUT" && field.type !== "select-one",
    labelled: field.closest("label")?.textContent.trim().split("\n")[0] || "",
    ships: list ? [...list.querySelectorAll("option")].map((o) => o.value) : [],
  };
});
say(Boolean(fleet?.ships?.length), "the site field offers the fleet",
  fleet ? `${fleet.ships.length} vessels · ${fleet.ships.slice(0, 3).join(", ")}…` : "(no field found)");
say(Boolean(fleet?.typed), "and it is still typed in freely",
  fleet?.labelled ? `on "${fleet.labelled}"` : "");
say(!(await evalIn(() => document.querySelector('.rail input[list="caap-vessels"]')?.placeholder || "")),
  "with no example left sitting in the box");
say(Boolean(fleet?.ships?.includes("MV Northstar") && fleet.ships.includes("MV Northstar")),
  "with the ships this person actually works on in it");

console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join("\n- ")}` : "\nall checks passed");
stop(fails.length ? 1 : 0);
