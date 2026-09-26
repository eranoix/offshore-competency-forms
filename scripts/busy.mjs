const __REPO = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/\/$/, "");
/**
 * The upstream's tokens-per-minute limit is shared by every call the browser
 * sends, so a full minute must be discovered once, not by each concurrent call
 * separately spending its retries inside it.
 *
 *   node scripts/busy.mjs
 */
import { build } from "esbuild";

const bundle = "/tmp/busy-engine.mjs";
await build({
  entryPoints: [`${__REPO}/src/engine/ai.js`],
  bundle: true, format: "esm", outfile: bundle, platform: "node", logLevel: "error",
  define: { __OFFLINE__: "false" },
});

const fails = [];
const say = (ok, label, got = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${got ? ` — ${got}` : ""}`);
  if (!ok) fails.push(label);
};

/* The upstream: full for the first two seconds, then answering. */
const sent = [];
let full = true;
setTimeout(() => { full = false; }, 2000);
globalThis.fetch = async (url, opts = {}) => {
  if ((opts.method || "GET") !== "POST") return { ok: true, status: 204 };
  sent.push(Date.now());
  if (full) {
    return {
      ok: false, status: 429,
      headers: { get: () => null },
      text: async () => JSON.stringify({ error: { message: "rate limit reached, please retry in 2s" } }),
    };
  }
  return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "written" }] }) };
};

const { ask, onBusy } = await import(bundle);
let told = 0;
onBusy(() => { told += 1; });

const began = Date.now();
/* Six calls at once, as the panel makes them: three documents in hand, each
   checking and repairing what it wrote. */
const out = await Promise.allSettled(Array.from({ length: 6 }, () =>
  ask("system", "user").catch((e) => { throw e; })));
const refused = out.filter((r) => r.status === "rejected").length;
const first = sent.filter((t) => t - began < 500).length;

say(refused === 6, "the first round is refused, because the minute really is full", `${refused} of 6`);
say(told >= 1, "and the app is told once how long is left", `${told} time(s)`);

/* Now they all go round again, as attempt() does. Nothing may be sent into
   the minute that is known to be full. */
sent.length = 0;
const again = await Promise.allSettled(Array.from({ length: 6 }, () => ask("system", "user")));
const answered = again.filter((r) => r.status === "fulfilled").length;
say(answered === 6, "the second round all answers, because it waited at the door", `${answered} of 6`);
say(sent.length === 6, "and no call was spent on a minute already known to be full",
  `${sent.length} request(s) for 6 calls`);
say(sent.every((t) => t - began >= 1900), "every one of them held until the minute had room",
  `earliest at ${Math.min(...sent.map((t) => t - began))}ms`);
say(first === 6, "while the very first round did go out together", `${first} of 6 at once`);

console.log(fails.length ? `\n${fails.length} FAILED` : "\none full minute, discovered once and waited out once");
process.exit(fails.length ? 1 : 0);
