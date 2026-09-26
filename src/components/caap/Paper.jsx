/**
 * The official form on screen: the company's own .docx with this document's words, laid out
 * by an engine that reads Word (a JavaScript redraw is never quite the document) and painted
 * here so the zoom is a size this owns. The engine says where every printed line and bordered
 * box sits, and a field is laid over each one.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fillForm } from "../../engine/docx";
import witnessPage from "../../forms/witness.pdf?url";
import observationPage from "../../forms/observation.pdf?url";
import knowledgePage from "../../forms/knowledge.pdf?url";
import feedbackPage from "../../forms/feedback.pdf?url";
import { BLANKS } from "../../forms/blanks";
import { heldAbout } from "../../engine/forms";
import { boxesDrawn, fitBoxes } from "../../engine/boxes";
import { readerReady } from "../../engine/reader";
import { asQA } from "../../engine/qa";
import { readSetting, writeSetting } from "../../engine/vault";

/* The four blank forms laid out once and carried with the site: offshore there is no server to
   lay a document out, and that is exactly where somebody needs to see the form. */
const BLANK_PAGE = {
  witness: witnessPage,
  observation: observationPage,
  knowledge: knowledgePage,
  feedback: feedbackPage,
};

/* Documents already laid out, by what they say: a document that has not changed is not
   sent back to be drawn again when moving between forms. */
const drawnBefore = new Map();
const KEEP = 12;

function remember(store, mark, value) {
  if (store.has(mark)) return;
  store.set(mark, value);
  while (store.size > KEEP) {
    const [oldest, held] = store.entries().next().value;
    store.delete(oldest);
    if (typeof held === "string") URL.revokeObjectURL(held);
  }
}

/* One document at a time: laying one out is heavy on the far end, and started together they
   all take four times as long while the one being looked at waits behind the rest. */
let queue = Promise.resolve();

/**
 * A field that is never scrolled: the box takes the height its text needs, over the document
 * while in use, and goes back to the document's own box on leaving, once the layout is redone.
 */
function InBox({ least, value, ...rest }) {
  const mine = useRef(null);
  useLayoutEffect(() => {
    const el = mine.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(least, el.scrollHeight)}px`;
  }, [value, least, rest.style?.width, rest.style?.fontSize]);
  return <textarea ref={mine} value={value} rows={1} {...rest} />;
}

/**
 * A printed line cannot grow, so a longer value closes up its letters rather than scrolling
 * sideways; below a floor it stops squeezing and lets the line run (unreadable is worse than untidy).
 */
function OnLine({ size, value, ...rest }) {
  const mine = useRef(null);
  useLayoutEffect(() => {
    const el = mine.current;
    if (!el) return;
    el.style.fontSize = `${size}px`;
    el.style.letterSpacing = "";
    if (el.scrollWidth <= el.clientWidth + 1) return;
    const fits = Math.max(size * 0.62, (size * el.clientWidth) / el.scrollWidth);
    el.style.fontSize = `${Math.max(6, fits)}px`;
  }, [value, size, rest.style?.width]);
  return <input ref={mine} value={value} {...rest} />;
}

/** The lines each form prints before a blank, in the form's own words. */
export const LINES = {
  witness: ["WITNESS", "POSITION & SITE", "NAME FOR WHOM TESTIMONY IS FOR", "RELATIONSHIP WITH CANDIDATE"],
  observation: ["ASSESSOR", "POSITION & SITE", "NAME OF CANDIDATE OBSERVED", "RELATIONSHIP WITH CANDIDATE"],
  knowledge: ["ASSESSOR", "POSITION & SITE", "CANDIDATE QUESTIONED", "RELATIONSHIP WITH CANDIDATE"],
  feedback: ["ASSESSOR", "POSITION & SITE", "CANDIDATE", "RELATIONSHIP WITH CANDIDATE"],
};

/** Lays a document out and keeps it. Shared, so a form drawn for one tab is
 *  still there when you come back to it. */
export async function drawForm(kind, doc, content, mark, signal) {
  const held = drawnBefore.get(mark);
  if (held) return held;
  const mine = queue.then(() => draw(kind, doc, content, mark, signal));
  queue = mine.catch(() => {});
  return mine;
}

async function draw(kind, doc, content, mark, signal) {
  /* It may have been drawn while this was waiting its turn. */
  const already = drawnBefore.get(mark);
  if (already) return already;
  if (signal?.aborted) throw Object.assign(new Error("cancelled"), { name: "AbortError" });
  const bytes = await fillForm(kind, doc, content);
  const res = await fetch("/api/render", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: bytes,
    signal,
  });
  if (!res.ok) throw new Error(String(res.status));
  const address = URL.createObjectURL(await res.blob());
  remember(drawnBefore, mark, address);
  return address;
}

/**
 * Where the blanks sit on the form being used: a published form's own map, else the map the build
 * measured off the blank template (made by scripts/blank-pages.mjs; regenerate it whenever a form changes).
 */
export const mapForm = (kind) => {
  const mine = heldAbout(kind)?.blanks;
  return mine?.fields?.length ? mine : BLANKS[kind] || { fields: [], boxes: [] };
};

/* What the drawn document depends on, by value: `doc` and `content` are rebuilt on every
   render, so comparing them by identity would redraw a form when nothing on it moved. */
export const formSignature = (kind, doc, content) =>
  JSON.stringify([
    kind,
    /* WHICH form these values are written into, not just what they say: without it a form
       published while the panel is open keeps drawing the old picture from the cache. */
    heldAbout(kind)?.version ?? 0,
    doc.candidate, doc.witness, doc.assessor, doc.site, doc.outcome, doc.discipline,
    doc.witnessPosition, doc.assessorPosition, doc.witnessRelationship, doc.assessorRelationship,
    doc.ref, doc.task, doc.dated,
    content?.text, content?.own, content?.questions,
  ]);

/* A point of the document is a seventy-second of an inch, a pixel of a screen
   a ninety-sixth: at "100%" the page is its printed size. */
const REAL = 96 / 72;
const STEPS = [50, 75, 100, 125, 150, 200, 250];

export default function Paper({ kind, doc, content, generation, onLine, onBox }) {
  const [state, setState] = useState("opening");
  /* "fit" means as wide as the panel; a number is that percentage of the real
     page. Kept between visits, because the size someone reads at is theirs. */
  const [zoom, setZoom] = useState(() => readSetting("caap:zoom", "fit"));
  const [pages, setPages] = useState([]);
  const [wide, setWide] = useState(0);
  const holder = useRef(null);
  const drawn = useRef([]);
  const last = useRef("");
  const mark = formSignature(kind, doc, content);

  /* How wide the panel is, so "as wide as the panel" can mean something. */
  useLayoutEffect(() => {
    const box = holder.current;
    if (!box) return undefined;
    const watch = new ResizeObserver(([entry]) => setWide(Math.round(entry.contentRect.width)));
    watch.observe(box);
    setWide(Math.round(box.getBoundingClientRect().width));
    return () => watch.disconnect();
  }, []);

  /* The blanks of this form: the printed lines from the blank template, and
     the bordered boxes as they came out on the page that was drawn. */
  const blanks = mapForm(kind);
  const boxes = useMemo(
    () => fitBoxes(blanks.boxes || [], pages.map((p) => p.boxes || [])),
    [blanks, pages],
  );

  useEffect(() => {
    if (last.current === mark && drawn.current.length) return undefined;
    let live = true;
    const stop = new AbortController();
    const go = async () => {
      /* The pages already up stay until the new ones are ready, so laying the
         document out again never blanks the panel. */
      setState(drawn.current.length ? "redrawing" : "opening");
      const open = async (address) => {
        const pdfjs = await readerReady();
        const file = await pdfjs.getDocument({ url: address }).promise;
        const got = [];
        for (let n = 1; n <= file.numPages; n += 1) {
          /* eslint-disable-next-line no-await-in-loop */
          const page = await file.getPage(n);
          const size = page.getViewport({ scale: 1 });
          /* eslint-disable-next-line no-await-in-loop */
          const boxes = await boxesDrawn(pdfjs, page, size);
          got.push({ page, w: size.width, h: size.height, boxes });
        }
        return got;
      };
      try {
        const address = await drawForm(kind, doc, content, mark, stop.signal);
        const got = await open(address);
        if (!live) return;
        drawn.current = got;
        setPages(got);
        last.current = mark;
        setState("shown");
      } catch (e) {
        if (!live || e?.name === "AbortError") return;
        /* Nothing laid it out (offshore, or the engine is away): the blank form is still the
           form, and the writing can be put on it and read back until there is a server again. */
        try {
          const got = await open(BLANK_PAGE[kind]);
          if (!live) return;
          drawn.current = got;
          setPages(got);
          last.current = "";
          setState("plain");
        } catch {
          if (live) setState("failed");
        }
      }
    };
    const timer = setTimeout(go, drawn.current.length ? 350 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
      stop.abort();
    };
  }, [mark, generation]);

  const first = pages[0];
  const scale = !first || !wide ? 1 : zoom === "fit" ? wide / first.w : ((Number(zoom) || 100) / 100) * REAL;

  /* Paint every page at that size, at the screen's own sharpness. */
  useEffect(() => {
    if (!pages.length) return undefined;
    const jobs = [];
    pages.forEach((sheet, i) => {
      const canvas = document.getElementById(`sheet-${kind}-${i}`);
      if (!canvas) return;
      const sharp = Math.min(2, window.devicePixelRatio || 1);
      const view = sheet.page.getViewport({ scale: scale * sharp });
      canvas.width = Math.round(view.width);
      canvas.height = Math.round(view.height);
      const job = sheet.page.render({ canvasContext: canvas.getContext("2d"), viewport: view });
      jobs.push(job);
      job.promise.catch(() => {});
    });
    return () => jobs.forEach((job) => job.cancel?.());
  }, [pages, scale, kind]);

  /* Read from what the size actually is, never from the number this render drew: quick
     repeated presses would otherwise all work from the same figure and be lost. */
  const held = useRef(zoom);
  held.current = zoom;
  const at = (next) => {
    const size = next === "fit" ? "fit" : String(Math.min(250, Math.max(50, Math.round(next))));
    held.current = size;
    setZoom(size);
    writeSetting("caap:zoom", size);
  };
  const now = Math.max(1, Math.round((scale / REAL) * 100));
  const by = (way) => {
    const from = held.current === "fit" ? now : Number(held.current) || 100;
    const next =
      way < 0 ? [...STEPS].reverse().find((s) => s < from - 1) : STEPS.find((s) => s > from + 1);
    at(next ?? (way < 0 ? 50 : 250));
  };

  /* What the person typing is looking at, before the page has caught up. */
  const [typed, setTyped] = useState({});
  useEffect(() => setTyped({}), [kind]);
  const saying = useCallback((key, printed) => (typed[key] === undefined ? printed : typed[key]), [typed]);

  const lineValue = (label) => {
    const which = LINES[kind] || [];
    const role = kind === "witness" ? doc.witnessPosition : doc.assessorPosition;
    return (
      [
        kind === "witness" ? doc.witness : doc.assessor,
        [role, doc.site].filter(Boolean).join(" — "),
        doc.candidate,
        kind === "witness" ? doc.witnessRelationship : doc.assessorRelationship,
      ][which.indexOf(label)] || ""
    );
  };
  /**
   * What is in a box of this form. The knowledge form has no prose box: its box is the
   * assessor's questions and the candidate's answers, so it is shown and read back as those.
   */
  const boxValue = (i) => {
    if (kind === "knowledge") return asQA(content?.questions);
    return i === 0 ? content?.text || "" : content?.own || "";
  };

  const put = (key, value, send) => {
    setTyped((all) => ({ ...all, [key]: value }));
    send(value);
  };
  /* Once the page has been laid out again it holds the words itself, so what
     was being shown over the paper is let go. */
  const settle = (key) =>
    setTyped((all) => {
      const rest = { ...all };
      delete rest[key];
      return rest;
    });

  return (
    <div className={`paper${state === "plain" ? " plain" : ""}`} ref={holder}>
      <div className="zoom" role="group" aria-label="How big the form is drawn">
        <button type="button" onClick={() => by(-1)} aria-label="Smaller" disabled={now <= 50}>
          −
        </button>
        <button type="button" onClick={() => at(100)} title="The page at its printed size">
          {now}%
        </button>
        <button type="button" onClick={() => by(1)} aria-label="Bigger" disabled={now >= 250}>
          +
        </button>
        <button
          type="button"
          className={`fit${zoom === "fit" ? " on" : ""}`}
          onClick={() => at("fit")}
          title="As wide as the panel"
        >
          Fit width
        </button>
      </div>

      <div className="sheets">
        {pages.map((sheet, i) => (
          <div
            className="leaf"
            key={`${kind}-${i}`}
            style={{ width: `${Math.round(sheet.w * scale)}px`, height: `${Math.round(sheet.h * scale)}px` }}
          >
            <canvas id={`sheet-${kind}-${i}`} />
            {blanks.fields
              .filter((f) => f.page === i)
              .map((f) => (
                <OnLine
                  key={f.label}
                  className={`on-line${saying(f.label, lineValue(f.label)) ? "" : " blank"}`}
                  value={saying(f.label, lineValue(f.label))}
                  aria-label={f.label}
                  title={f.label}
                  spellCheck={false}
                  size={Math.max(7, Math.round(f.h * sheet.h * scale * 0.86))}
                  style={{
                    left: `${f.x * sheet.w * scale}px`,
                    top: `${f.y * sheet.h * scale}px`,
                    width: `${f.w * sheet.w * scale}px`,
                    height: `${Math.max(14, f.h * sheet.h * scale * 1.6)}px`,
                  }}
                  onChange={(e) => put(f.label, e.target.value, (v) => onLine?.(f.label, v))}
                  onBlur={() => settle(f.label)}
                />
              ))}
            {boxes.map((b, which) =>
              b.page !== i ? null : (
                <InBox
                  key={`box-${which}`}
                  className={`in-box${saying(`box${which}`, boxValue(which)) ? "" : " blank"}`}
                  value={saying(`box${which}`, boxValue(which))}
                  aria-label={which === 0 ? "The statement" : "The candidate's own words"}
                  least={Math.round(b.h * sheet.h * scale)}
                  style={{
                    left: `${b.x * sheet.w * scale}px`,
                    top: `${b.y * sheet.h * scale}px`,
                    width: `${b.w * sheet.w * scale}px`,
                    fontSize: `${Math.max(8, Math.round(10 * scale))}px`,
                  }}
                  onChange={(e) => put(`box${which}`, e.target.value, (v) => onBox?.(which, v))}
                  onBlur={() => settle(`box${which}`)}
                />
              ),
            )}
          </div>
        ))}
      </div>

      {state === "opening" && <p className="tip drawing">Drawing the form…</p>}
      {state === "redrawing" && <p className="tip drawing quiet">Laying it out again…</p>}
      {state === "plain" && (
        <p className="tip quiet">
          The blank form, with your writing on it — nothing here can lay it out until there is a
          connection again. The Word file you download is the real one.
        </p>
      )}
      {state === "failed" && <p className="tip">The form could not be drawn. The download still works.</p>}
    </div>
  );
}
