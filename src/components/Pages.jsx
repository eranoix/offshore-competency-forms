/**
 * A document, painted rather than framed: an iframe hands the file to the
 * browser's PDF viewer, which this site's X-Frame-Options: deny refuses and which
 * often shows nothing on a phone. Painted, it behaves the same everywhere.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { readerReady } from "../engine/reader";

/* A point of the document is a seventy-second of an inch, a pixel of a screen
   a ninety-sixth: at "100%" the page is its printed size. */
const REAL = 96 / 72;
const STEPS = [50, 75, 100, 125, 150, 200, 250];

export default function Pages({ src, title, onFail, overlay = null, onLaid = null }) {
  const holder = useRef(null);
  const [pages, setPages] = useState([]);
  const [wide, setWide] = useState(0);
  const [zoom, setZoom] = useState("fit");
  const [state, setState] = useState("opening");

  /* How wide the room is, so "as wide as it goes" can mean something. */
  useLayoutEffect(() => {
    const box = holder.current;
    if (!box) return undefined;
    const watch = new ResizeObserver(([entry]) => setWide(Math.round(entry.contentRect.width)));
    watch.observe(box);
    setWide(Math.round(box.getBoundingClientRect().width));
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    if (!src) return undefined;
    let live = true;
    setState("opening");
    setPages([]);
    (async () => {
      try {
        const pdfjs = await readerReady();
        const file = await pdfjs.getDocument({ url: src }).promise;
        const got = [];
        for (let n = 1; n <= file.numPages; n += 1) {
          /* eslint-disable-next-line no-await-in-loop */
          const page = await file.getPage(n);
          const size = page.getViewport({ scale: 1 });
          got.push({ page, w: size.width, h: size.height });
        }
        if (!live) return;
        setPages(got);
        setState("shown");
        /* The document itself, for whoever needs more from it than a picture —
           the forms page asks it where every line of text landed. */
        onLaid?.(file, got);
      } catch (e) {
        if (!live) return;
        setState("failed");
        onFail?.(e);
      }
    })();
    return () => {
      live = false;
    };
  }, [src]);

  const first = pages[0];
  const scale = !first || !wide ? 1 : zoom === "fit" ? (wide - 28) / first.w : ((Number(zoom) || 100) / 100) * REAL;

  /* Paint every page at that size, at the screen's own sharpness. */
  useEffect(() => {
    if (!pages.length) return undefined;
    const jobs = [];
    pages.forEach((sheet, i) => {
      const canvas = document.getElementById(`page-${i}`);
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
  }, [pages, scale]);

  /* Read the size from what it actually is, not from the number this render
     happened to draw: two quick presses both worked from the same figure and
     the second was lost. */
  const held = useRef(zoom);
  held.current = zoom;
  const now = Math.max(1, Math.round((scale / REAL) * 100));
  const by = (way) => {
    const from = held.current === "fit" ? now : Number(held.current) || 100;
    const next = way < 0 ? [...STEPS].reverse().find((s) => s < from - 1) : STEPS.find((s) => s > from + 1);
    const size = String(next ?? (way < 0 ? 50 : 250));
    held.current = size;
    setZoom(size);
  };

  /* Each page is a box the size of the printed sheet with the canvas filling
     it, so anything drawn on top can be placed as a fraction of the page and
     stay where it belongs at any size. Without something to overlay the box is
     just a wrapper nobody notices. */
  return (
    <div className="pages" ref={holder}>
      <div className="pages-size" role="group" aria-label="How big to draw">
        <button onClick={() => by(-1)} aria-label="Smaller">−</button>
        <b>{now}%</b>
        <button onClick={() => by(1)} aria-label="Bigger">+</button>
        <button
          className={zoom === "fit" ? "on" : ""}
          onClick={() => {
            held.current = "fit";
            setZoom("fit");
          }}
        >
          Fit width
        </button>
      </div>
      <div className="pages-roll">
        {pages.map((sheet, i) => (
          <div
            /* eslint-disable-next-line react/no-array-index-key */
            key={i}
            className="leaf"
            style={{ width: `${Math.round(sheet.w * scale)}px`, height: `${Math.round(sheet.h * scale)}px` }}
          >
            <canvas
              id={`page-${i}`}
              aria-label={`${title || "Document"} — page ${i + 1} of ${pages.length}`}
            />
            {overlay?.({ page: i, w: sheet.w, h: sheet.h, scale })}
          </div>
        ))}
      </div>
      {state === "opening" && <p className="note">Opening the document…</p>}
      {state === "failed" && <p className="note">This one could not be drawn. The download below still works.</p>}
    </div>
  );
}
