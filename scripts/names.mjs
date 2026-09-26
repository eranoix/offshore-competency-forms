/* Names a module uses but never declares, imports, or gets from the platform. */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import * as acorn from "acorn";
import { transformSync } from "esbuild";

const files = execSync("find src api scripts -type f \\( -name '*.js' -o -name '*.jsx' -o -name '*.mjs' \\)")
  .toString().trim().split("\n").sort();

const GLOBALS = new Set(["window","document","console","fetch","URL","URLSearchParams","Math","JSON","Object","Array","String","Number","Boolean","Date","Promise","Set","Map","WeakMap","RegExp","Error","TypeError","RangeError","localStorage","sessionStorage","caches","location","navigator","setTimeout","clearTimeout","Blob","CompressionStream","DecompressionStream","setInterval","clearInterval","requestAnimationFrame","cancelAnimationFrame","atob","btoa","crypto","Uint8Array","ArrayBuffer","Buffer","process","TextEncoder","TextDecoder","FormData","File","FileReader","Intl","Symbol","BigInt","Infinity","NaN","undefined","globalThis","structuredClone","AbortController","AbortSignal","Response","Request","Headers","WebSocket","Image","Event","CustomEvent","MutationObserver","ResizeObserver","IntersectionObserver","getComputedStyle","print","alert","confirm","history","HTMLElement","Node","queueMicrotask","performance","module","require","exports","__dirname","__filename","DOMParser","arguments","parseFloat","parseInt","isNaN","isFinite","encodeURIComponent",
  /* A service worker has no window: it is handed `self`, and through it the
     clients it controls and the caches it keeps. */
  "self","clients","skipWaiting","importScripts","ServiceWorkerGlobalScope",
  "decodeURIComponent","encodeURI","decodeURI","escape","unescape","prompt","Text","Range",
  /* injected by the build (see vite.config.js) */ "__OFFLINE__",
  /* the JSX transform writes calls to this itself */ "React"]);

function walk(node, visit, parent = null) {
  if (!node || typeof node.type !== "string") return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
    const child = node[key];
    if (Array.isArray(child)) child.forEach((c) => c && typeof c.type === "string" && walk(c, visit, node));
    else if (child && typeof child.type === "string") walk(child, visit, node);
  }
}

const names = (pattern, into) => walk(pattern, (n) => { if (n.type === "Identifier") into.add(n.name); });


/* Used before it exists.
   A `const` is not readable above the line that declares it, and the error
   only shows when the page renders — as a blank screen. This finds the shape:
   a name read in a block, outside any nested function, above its own
   declaration in that same block. Inside a nested function it is fine: that
   code runs later, when the name is there. */
function tooEarly(ast) {
  const found = [];
  const blocks = [];
  walk(ast, (n) => {
    if (n.type === "Program" || n.type === "BlockStatement") blocks.push(n);
  });
  for (const block of blocks) {
    const declaredAt = new Map();
    (block.body || []).forEach((stmt) => {
      if (stmt.type !== "VariableDeclaration" || stmt.kind === "var") return;
      stmt.declarations.forEach((d) => {
        const here = new Set();
        names(d.id, here);
        here.forEach((name) => { if (!declaredAt.has(name)) declaredAt.set(name, stmt.start); });
      });
    });
    if (!declaredAt.size) continue;
    (block.body || []).forEach((stmt) => {
      /* Only statements above the declaration can be too early. */
      walk(stmt, (n, parent) => {
        if (n.type !== "Identifier" || !parent) return;
        if (parent.type === "MemberExpression" && parent.property === n && !parent.computed) return;
        if (parent.type === "Property" && parent.key === n && !parent.computed) return;
        if (parent.type === "VariableDeclarator" && parent.id === n) return;
        const at = declaredAt.get(n.name);
        if (at === undefined || n.start >= at) return;
        /* A reference inside a nested function runs later: not too early. */
        let nested = false;
        walk(stmt, (m) => {
          if (!/Function(Declaration|Expression)|ArrowFunctionExpression/.test(m.type)) return;
          if (n.start > m.start && n.end < m.end) nested = true;
        });
        if (!nested) found.push(n.name);
      });
    });
  }
  return [...new Set(found)];
}

let bad = 0;
for (const file of files) {
  const raw = readFileSync(file, "utf8");
  let code;
  try {
    code = transformSync(raw, { loader: file.endsWith(".jsx") ? "jsx" : "js", format: "esm" }).code;
  } catch (e) {
    /* A file that cannot be read has not been checked. Skipping it quietly is
       how a broken file walks past its own guard. */
    bad += 1;
    console.log(`FAIL ${file} will not compile: ${e.message.split("\n")[0]}`);
    continue;
  }
  let ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true });
  } catch (e) {
    bad += 1;
    console.log(`FAIL ${file} will not parse: ${e.message}`);
    continue;
  }

  const declared = new Set();
  walk(ast, (n) => {
    if (n.type === "ImportDeclaration") n.specifiers.forEach((s) => declared.add(s.local.name));
    if (n.type === "VariableDeclarator") names(n.id, declared);
    if ((n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") && n.id) declared.add(n.id.name);
    if (n.type === "FunctionExpression" && n.id) declared.add(n.id.name);
    if (/Function(Declaration|Expression)|ArrowFunctionExpression/.test(n.type)) n.params.forEach((p) => names(p, declared));
    if (n.type === "CatchClause" && n.param) names(n.param, declared);
    if (n.type === "LabeledStatement") declared.add(n.label.name);
  });

  const used = new Set();
  walk(ast, (n, parent) => {
    if (n.type !== "Identifier" || !parent) return;
    if (parent.type === "MemberExpression" && parent.property === n && !parent.computed) return;
    if (parent.type === "Property" && parent.key === n && !parent.computed) return;
    if (/^Import(Specifier|DefaultSpecifier|NamespaceSpecifier)$/.test(parent.type)) return;
    if (parent.type === "ExportSpecifier") return;
    if (parent.type === "LabeledStatement" || parent.type === "BreakStatement" || parent.type === "ContinueStatement") return;
    /* `import.meta` is one token to the language, not a variable named meta. */
    if (parent.type === "MetaProperty") return;
    used.add(n.name);
  });

  const missing = [...used].filter((n) => !declared.has(n) && !GLOBALS.has(n));
  if (missing.length) { bad += 1; console.log(`FAIL ${file} uses without importing: ${missing.join(", ")}`); }
  const early = tooEarly(ast);
  if (early.length) { bad += 1; console.log(`FAIL ${file} reads before it is declared: ${early.join(", ")}`); }
}
console.log(bad ? `\n${bad} problem(s) found` : `all ${files.length} files: every name is declared, imported, and read after it exists`);
process.exit(bad ? 1 : 0);
