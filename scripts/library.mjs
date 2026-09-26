const __REPO = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/\/$/, "");
/**
 * The library viewer on the real build: serves dist with a PDF and a Word file
 * behind a stub API, opens each, and counts the ink on the canvas. Pages are
 * painted rather than framed because the site answers X-Frame-Options: deny.
 *
 *   npm run build && node scripts/library.mjs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import WebSocket from "ws";
import { freePort } from "./port.mjs";

const ROOT = `${__REPO}`;
const KEY = process.env.DOCX_KEY || "";
const FILES = {
  pdf: { name: "Witness testimony.pdf", kind: "application/pdf", path: `${ROOT}/src/forms/witness.pdf` },
  docx: { name: "Witness testimony.docx", kind: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", path: `${ROOT}/src/forms/witness.docx` },
};
const TYPES = { ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript", ".css":"text/css",
  ".json":"application/json", ".woff2":"font/woff2", ".png":"image/png", ".pdf":"application/pdf",
  ".docx":"application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".webmanifest":"application/manifest+json" };

const PORT = await freePort();
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/api/me") return res.end(JSON.stringify({ user: { email: "checks@forms.example.org", admin: true } }));
  /* The site asks which forms are published as soon as it knows who is asking.
     A stub that answers /api/me and not this one makes the page throw a failed
     request into everybody's console — which is exactly what the check below
     is watching for. */
  if (p === "/api/render" && url.searchParams.get("t") === "manifest") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ forms: {} }));
  }
  if (p === "/api/render") {
    const chunks = []; for await (const c of req) chunks.push(c);
    const up = await fetch(`http://127.0.0.1:${process.env.DOCX_PORT || 8791}/render`, { method: "POST",
      headers: { "content-type": "application/octet-stream", "x-docx-key": KEY }, body: Buffer.concat(chunks) });
    res.writeHead(up.status, { "content-type": "application/pdf" });
    return res.end(Buffer.from(await up.arrayBuffer()));
  }
  if (p === "/api/library") {
    const id = url.searchParams.get("file");
    if (id && FILES[id]) {
      const b = await readFile(FILES[id].path);
      res.writeHead(200, { "content-type": FILES[id].kind,
        "content-disposition": `${url.searchParams.get("inline") === "1" ? "inline" : "attachment"}; filename="${FILES[id].name}"` });
      return res.end(b);
    }
    if (url.searchParams.get("text")) return res.end(JSON.stringify({ text: "", read: false }));
    return res.end(JSON.stringify({ documents: Object.entries(FILES).map(([id, f]) => ({
      id, name: f.name, kind: f.kind, size: 40000, created_at: new Date().toISOString(),
      user_email: "checks@forms.example.org", shared: false, passages: 0 })) }));
  }
  const file = p === "/" || !extname(p) ? "/index.html" : p;
  try {
    const b = await readFile(join(ROOT, "dist", file));
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(b);
  } catch { res.writeHead(404); res.end("no"); }
}).listen(PORT, "127.0.0.1");

const DEBUG = await freePort();
const chrome = spawn("google-chrome", ["--headless=new","--disable-gpu","--no-sandbox",
  `--remote-debugging-port=${DEBUG}`,"--remote-allow-origins=*","--window-size=1500,1000",
  `--user-data-dir=/tmp/libstub-${process.pid}`,"about:blank"], { stdio: "ignore" });
await wait(4500);
const t=(await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json()).find(x=>x.type==="page");
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});
await new Promise(r=>ws.on("open",r));
let id=0; const w=new Map(); const errs=[];
ws.on("message",m=>{const x=JSON.parse(m); if(x.id&&w.has(x.id)){w.get(x.id)(x);w.delete(x.id);}
 if(x.method==="Runtime.exceptionThrown") errs.push((x.params.exceptionDetails?.exception?.description||"exception").split("\n")[0]);
 if(x.method==="Runtime.consoleAPICalled"&&x.params.type==="error") errs.push(x.params.args.map(a=>a.value||a.description).join(" ").slice(0,200));
 if(x.method==="Log.entryAdded") errs.push(`[${x.params.entry.source}] ${x.params.entry.text.slice(0,200)}`);});
const send=(m,p={})=>new Promise(r=>{const n=++id;w.set(n,r);ws.send(JSON.stringify({id:n,method:m,params:p}));});
const ev=async(e)=>(await send("Runtime.evaluate",{expression:e,awaitPromise:true,returnByValue:true})).result?.result?.value;
await send("Runtime.enable"); await send("Page.enable"); await send("Log.enable");
await send("Page.navigate",{url:`http://localhost:${PORT}/library`}); await wait(5000);

const fails = [];
const say = (ok, label, got = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${got ? ` — ${got}` : ""}`);
  if (!ok) fails.push(label);
};

const open = async (which) => {
  await ev(`(()=>{const tile=[...document.querySelectorAll('.wall .tile')].find(e=>/\\.${which}\\b/i.test(e.innerText));
   tile?.querySelector('.shot')?.click();})()`);
  await wait(9000);
  const seen = await ev(`(()=>{const d=document.querySelector('dialog.viewer'); if(!d) return JSON.stringify({dialog:false});
   const look=d.querySelector('.look');
   const leaves=[...look.querySelectorAll('.leaf canvas')];
   const painted=leaves.map(c=>{const x=c.getContext('2d');
     if(!c.width||!c.height) return 0;
     const px=x.getImageData(0,0,c.width,Math.min(c.height,400)).data;
     let ink=0; for(let i=0;i<px.length;i+=4) if(px[i]<200||px[i+1]<200||px[i+2]<200) ink++;
     return Math.round((ink/(px.length/4))*1000)/10;});
   return JSON.stringify({iframe:!!look.querySelector('iframe'), pages:leaves.length,
    size:leaves[0]?{w:Math.round(leaves[0].getBoundingClientRect().width),h:Math.round(leaves[0].getBoundingClientRect().height)}:null,
    inkPct:painted, text:look.innerText.replace(/\\s+/g,' ').slice(0,100)});})()`);
  const got = JSON.parse(seen);
  say(!got.iframe, `${which}: not handed to a frame`);
  say(got.pages > 0, `${which}: the page is painted`, `${got.pages} page(s)`);
  say((got.inkPct?.[0] ?? 0) > 1, `${which}: and it is the document, not a white sheet`,
    `${got.inkPct?.[0] ?? 0}% ink`);
  say((got.size?.w ?? 0) > 300 && (got.size?.h ?? 0) > 300, `${which}: at a size worth reading`,
    got.size ? `${got.size.w}×${got.size.h}` : "none");
  await ev(`document.querySelector('dialog.viewer .shut')?.click()`); await wait(800);
};
const tiles = Number(await ev(`document.querySelectorAll('.wall .tile').length`));
say(tiles === 2, "both documents are listed", String(tiles));
console.log("//tiles:", await ev(`JSON.stringify([...document.querySelectorAll('.wall .tile')].map(e=>e.innerText.replace(/\\s+/g,' ').slice(0,60)))`));
console.log("body:", await ev(`document.body.innerText.replace(/\\s+/g,' ').slice(0,220)`));
await open("pdf");
await open("docx");
const real = errs.filter((e) => !/favicon|manifest|sw\.js|404/i.test(e));
say(real.length === 0, "nothing in the console", real.slice(0, 3).join(" · "));
console.log(fails.length ? `\n${fails.length} FAILED` : "\nthe library shows its documents");
server.close(); chrome.kill(); process.exit(fails.length ? 1 : 0);
