import { useEffect, useRef, useState } from "react";

/**
 * The document server's own Word editor, running against the real .docx. Where to fetch and save are minted
 * and signed on the server, because it would otherwise fetch and overwrite whatever a browser asks.
 */
export default function WordEditor({ kind, onSaved, onFail }) {
  const box = useRef(null);
  const editor = useRef(null);
  const [state, setState] = useState("opening");
  /* Where the document server is, and whether it answered the site just now.
     Both are needed to say anything true when the editor does not open. */
  const [server, setServer] = useState(null);

  useEffect(() => {
    let alive = true;
    setState("opening");

    (async () => {
      try {
        const told = await fetch(`/api/render?t=editor&kind=${kind}`).then((r) =>
          (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.error || r.status)))));
        if (!alive) return;
        setServer({ at: told.at, up: told.up !== false });

        await load(`${told.at}/web-apps/apps/api/documents/api.js`);
        if (!alive) return;
        if (!window.DocsAPI) throw new Error("the document server answered but its editor did not load");

        /* A fresh box each time: the editor writes an iframe into whatever it
           is given and does not tidy up after a form is swapped underneath
           it. */
        const at = document.createElement("div");
        at.id = `word-${kind}-${Date.now()}`;
        box.current.appendChild(at);

        editor.current = new window.DocsAPI.DocEditor(at.id, {
          ...told.config,
          token: told.token,
          width: "100%",
          height: "100%",
          events: {
            onAppReady: () => alive && setState("open"),
            onDocumentReady: () => alive && setState("open"),
            /* Saved is the document server telling the page what it has
               already told the site: the bytes are kept, and what happens to
               them is still a press away. */
            onDocumentStateChange: (e) => { if (!e?.data && alive) onSaved?.(); },
            onError: (e) => {
              if (!alive) return;
              setState("failed");
              onFail?.(new Error(e?.data?.errorDescription || "the editor stopped"));
            },
          },
        });
      } catch (e) {
        if (!alive) return;
        setState("failed");
        onFail?.(e);
      }
    })();

    return () => {
      alive = false;
      try { editor.current?.destroyEditor?.(); } catch { /* it is going anyway */ }
      editor.current = null;
    };
  }, [kind, onSaved, onFail]);

  /* The editor replaces the box's contents with its own iframe, so React must never render children into
     it (removeChild throws NotFoundError); anything else goes beside the box. */
  return (
    <div className={`word is-${state}`}>
      <div className="word-here" ref={box} />
      {state === "opening" ? <p className="note">Opening it in Word…</p> : null}
      {state === "failed" ? <Stopped server={server} /> : null}
    </div>
  );
}

/**
 * Why the editor did not open: the site asks whether the server answers from its side, so a browser-side
 * block (e.g. a network substituting certificates) is not reported as the server being unreachable.
 */
function Stopped({ server }) {
  const blocked = server?.up;
  return (
    <div className="word-out">
      <p><b>Word could not open on this device.</b></p>
      {blocked ? (
        <>
          <p>
            The document server is running — the site reached it a moment ago.
            This browser could not, which puts whatever is refusing it between
            this device and the server: a network that opens secure
            connections to look inside them, or a security program installed
            here.
          </p>
          <p>
            <a className="btn" href={`${server.at}/healthcheck`} target="_blank" rel="noreferrer">
              Ask the browser why
            </a>
          </p>
          <p className="note">
            That opens the document server in a tab of its own. Whatever the
            browser says there names what is refusing it — and on a page it
            refuses, <b>Advanced → Certificate</b> says who issued the one it
            was handed instead.
          </p>
        </>
      ) : (
        <p>
          The document server is not answering at all. That one is ours, not
          yours.
        </p>
      )}
      <p className="note">
        The rest of this page is unaffected: Import, Export, Export to PDF and
        putting a form in front of the crew all go through the site.
      </p>
    </div>
  );
}

/* One script, once, however many times a form is opened. */
const loading = new Map();
function load(src) {
  if (loading.has(src)) return loading.get(src);
  const job = new Promise((done, fail) => {
    const tag = document.createElement("script");
    tag.src = src;
    tag.async = true;
    tag.onload = () => done();
    tag.onerror = () => {
      loading.delete(src);
      fail(new Error("the document server could not be reached"));
    };
    document.head.appendChild(tag);
  });
  loading.set(src, job);
  return job;
}
