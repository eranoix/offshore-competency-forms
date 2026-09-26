import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon";
import Pages from "../components/Pages";
import { V } from "../engine/generator";
import { inOrder } from "../engine/order";

/**
 * The library: finished paperwork kept for the writing to learn from. A document is listed only to its
 * uploader and the administrator, and once handed over only the administrator can take it out.
 */
const LIMIT = 4 * 1024 * 1024;
const KINDS = ".pdf,.doc,.docx,.txt,.md,.csv,.rtf,.png,.jpg,.jpeg";

const size = (n) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

const when = (iso) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const isImage = (r) => /^image\//.test(r.kind || "") || /\.(png|jpe?g|gif|webp)$/i.test(r.name);
const isPdf = (r) => /pdf/.test(r.kind || "") || /\.pdf$/i.test(r.name);
const isWord = (r) => /\.docx$/i.test(r.name) || /wordprocessingml/.test(r.kind || "");
const isText = (r) =>
  /^text\/|markdown|csv|json/.test(r.kind || "") || /\.(txt|md|csv|json|rtf)$/i.test(r.name);
const ext = (name) =>
  (name.includes(".") ? name.split(".").pop() : "file").slice(0, 4).toUpperCase();

/** What a document is, in one word; the wall filters on these. */
const family = (r) => (isImage(r) ? "scan" : isPdf(r) ? "pdf" : isText(r) ? "text" : "word");
const FAMILIES = { scan: "Scans", pdf: "PDF", word: "Word", text: "Text" };

const SORTS = {
  recent: { label: "Newest", by: (a, b) => new Date(b.created_at) - new Date(a.created_at) },
  oldest: { label: "Oldest", by: (a, b) => new Date(a.created_at) - new Date(b.created_at) },
  name: { label: "Name", by: (a, b) => a.name.localeCompare(b.name) },
  big: { label: "Largest", by: (a, b) => (b.size || 0) - (a.size || 0) },
  /* The shelf sorted by what it is worth to the writing, so the files it
     leans on come first and the ones it cannot read at all come last, where
     they can be looked at and thrown out. */
  teaching: { label: "Teaches most", by: (a, b) => (b.passages || 0) - (a.passages || 0) },
  silent: { label: "Teaches nothing", by: (a, b) => (a.passages || 0) - (b.passages || 0) },
};

export default function Library() {
  const [rows, setRows] = useState([]);
  const [admin, setAdmin] = useState(false);
  const [everyone, setEveryone] = useState(false);
  const [campaign, setCampaign] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState("");
  const [state, setState] = useState({ kind: "", text: "" });
  const [over, setOver] = useState(false);
  const [find, setFind] = useState("");
  const [kind, setKind] = useState("");
  const [sort, setSort] = useState("recent");
  const [chosen, setChosen] = useState([]);
  const [viewing, setViewing] = useState(null);
  const picker = useRef(null);

  /* The server decides what this account is shown (everything for the admin, otherwise its own) and says which. */
  async function load(onlyMine = false) {
    try {
      const res = await fetch(`/api/library${onlyMine ? "?mine=1" : ""}`);
      if (!res.ok) throw new Error("could not read the library");
      const body = await res.json();
      setRows(body.documents || []);
      setAdmin(Boolean(body.admin));
      setEveryone(body.showing === "everyone");
    } catch (e) {
      setState({ kind: "bad", text: e.message });
    }
  }

  useEffect(() => {
    load();
  }, []);

  const shown = useMemo(() => {
    const needle = find.trim().toLowerCase();
    return rows
      .filter((r) => !kind || family(r) === kind)
      .filter(
        (r) =>
          !needle ||
          r.name.toLowerCase().includes(needle) ||
          (r.notes || "").toLowerCase().includes(needle) ||
          (r.campaign || "").toLowerCase().includes(needle),
      )
      .sort(SORTS[sort].by);
  }, [rows, find, kind, sort]);

  const counts = useMemo(() => {
    const n = {};
    for (const r of rows) n[family(r)] = (n[family(r)] || 0) + 1;
    return n;
  }, [rows]);

  const marked = (id) => chosen.includes(id);
  const mark = (id) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  async function send(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    setState({ kind: "", text: "" });
    for (const file of list) {
      if (file.size > LIMIT) {
        setState({ kind: "bad", text: `${file.name} is over 4 MB. Send a smaller copy.` });
        continue;
      }
      setBusy(file.name);
      try {
        const query = new URLSearchParams({
          name: file.name,
          kind: file.type || "application/octet-stream",
          campaign,
          notes,
        });
        const res = await fetch(`/api/library?${query}`, {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: file,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "the upload did not finish");
        setState({
          kind: "ok",
          text: body.passages
            ? `${file.name} is in the library — ${body.passages} passages the writing can read.`
            : `${file.name} is in the library. If it is a scan, the server reads it within a few minutes.`,
        });
      } catch (e) {
        setState({ kind: "bad", text: e.message });
      }
    }
    setBusy("");
    setNotes("");
    load();
  }

  /**
   * Shares a document with everybody's writing (without showing it on their shelves), or takes it back.
   * Per document, because a record naming a real person should not be shared.
   */
  async function share(row, on) {
    const res = await fetch(`/api/library?id=${row.id}&shared=${on ? "1" : "0"}`, { method: "PATCH" });
    if (!res.ok) {
      const said = await res.json().catch(() => ({}));
      setState({ kind: "bad", text: said.error || "could not change that" });
      return;
    }
    setRows((all) => all.map((x) => (x.id === row.id ? { ...x, shared: on } : x)));
  }

  async function remove(list) {
    const names = list.length === 1 ? list[0].name : `${list.length} documents`;
    if (!confirm(`Remove ${names} from the library?`)) return;
    const gone = [];
    for (const row of list) {
      const res = await fetch(`/api/library?id=${row.id}`, { method: "DELETE" });
      if (res.ok) gone.push(row.id);
    }
    setRows((r) => r.filter((x) => !gone.includes(x.id)));
    setChosen((c) => c.filter((id) => !gone.includes(id)));
    if (viewing && gone.includes(viewing.id)) setViewing(null);
  }

  /* One at a time, with a breath between: browsers drop downloads fired in the
     same tick. */
  async function download(list) {
    for (const row of list) {
      const a = document.createElement("a");
      a.href = `/api/library?file=${row.id}`;
      a.download = row.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  const step = (n) => {
    const i = shown.findIndex((r) => r.id === viewing?.id);
    if (i < 0) return;
    const next = shown[(i + n + shown.length) % shown.length];
    if (next) setViewing(next);
  };

  return (
    <main className="home library">
      <header>
        <h1>The library.</h1>
        <p>
          Paperwork you have already finished teaches the writing more than any rule does.
          Only you and whoever runs the site can see what you hand over.
        </p>
      </header>

      <section className="give">
        <div
          className={`drop${over ? " over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            send(e.dataTransfer.files);
          }}
        >
          <Icon name="upload" size={18} className="glyph" />
          <b>Drop files here</b>
          <span>PDF, Word, text or a photo of the sheet — up to 4 MB each.</span>
          <button className="btn" type="button" onClick={() => picker.current?.click()}>
            Choose files
          </button>
          <input
            ref={picker}
            type="file"
            accept={KINDS}
            multiple
            hidden
            onChange={(e) => {
              send(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        <div className="about">
          <label className="field">
            <span>Kind of trip</span>
            <select value={campaign} onChange={(e) => setCampaign(e.target.value)}>
              <option value="">Not saying</option>
              {inOrder(Object.keys(V.campaigns), (k) => V.campaigns[k].name || k).map((k) => (
                <option key={k} value={k}>
                  {V.campaigns[k].name || k}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>What it is, in your words — optional</span>
            <input
              type="text"
              value={notes}
              placeholder="Signed trip feedback, MV Atlantic Crest, October trip"
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>

        {busy && <p className="result busy">Sending {busy}…</p>}
        {state.text && <p className={`result ${state.kind}`}>{state.text}</p>}
      </section>

      <section className="shelf">
        <div className="bar">
          <input
            type="search"
            value={find}
            placeholder="Search by name, note or trip"
            onChange={(e) => setFind(e.target.value)}
          />
          <div className="kinds" role="group" aria-label="Kind of document">
            <button className={kind ? "" : "on"} onClick={() => setKind("")}>
              All <em>{rows.length}</em>
            </button>
            {Object.entries(FAMILIES).map(([k, label]) =>
              counts[k] ? (
                <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
                  {label} <em>{counts[k]}</em>
                </button>
              ) : null,
            )}
          </div>
          {/* How to order the shelf. The menu itself runs most useful first, which
              is an order of its own. */}
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Order" data-scale="">
            {Object.entries(SORTS).map(([k, s]) => (
              <option key={k} value={k}>
                {s.label}
              </option>
            ))}
          </select>
          {admin && (
            <button
              className="ghost"
              type="button"
              onClick={() => {
                setChosen([]);
                load(everyone);
              }}
              title={everyone ? "Show only what you handed over" : "Show everything that has been handed over"}
            >
              {everyone ? "Only mine" : "Everyone's"}
            </button>
          )}
        </div>

        {chosen.length > 0 && (
          <div className="picked-bar">
            <b>{chosen.length} selected</b>
            <button className="ghost" onClick={() => download(rows.filter((r) => marked(r.id)))}>
              Download
            </button>
            {admin && (
              <button className="ghost bad" onClick={() => remove(rows.filter((r) => marked(r.id)))}>
                Remove
              </button>
            )}
            <button className="ghost" onClick={() => setChosen([])}>
              Clear
            </button>
          </div>
        )}

        {shown.length === 0 ? (
          <p className="note">
            {rows.length
              ? "Nothing matches that. Try a shorter word."
              : "Nothing yet. The first document you add is the first thing the writing learns from."}
          </p>
        ) : (
          <ul className="wall">
            {shown.map((r) => (
              <li key={r.id} className={marked(r.id) ? "tile on" : "tile"}>
                <button className="shot" onClick={() => setViewing(r)} title={`Open ${r.name}`}>
                  {isImage(r) ? (
                    <img src={`/api/library?file=${r.id}&inline=1`} alt="" loading="lazy" />
                  ) : (
                    <span className={`glyph ${family(r)}`}>{ext(r.name)}</span>
                  )}
                </button>
                <label className="tick" title="Select">
                  <input type="checkbox" checked={marked(r.id)} onChange={() => mark(r.id)} />
                </label>
                {admin && (
                  <button
                    type="button"
                    className={`house-switch${r.shared ? " on" : ""}`}
                    onClick={() => share(r, !r.shared)}
                    aria-pressed={r.shared}
                    title={
                      r.shared
                        ? "Everybody's writing can read this. Click to keep it to yourself."
                        : "Only your writing reads this. Click to let everybody's read it."
                    }
                  >
                    {r.shared ? "the house's" : "mine"}
                  </button>
                )}
                <div className="cap">
                  <b title={r.name}>{r.name}</b>
                  <span>
                    {[size(r.size || 0), when(r.created_at), everyone && !r.own ? r.user_email : null]
                      .filter(Boolean)
                      .join(" · ")}
                    {/* What the writing can read in it: a file at nought is doing nothing and must say so. */}
                    <i className={`teaches${r.passages ? "" : " none"}`}>
                      {r.passages
                        ? `${r.passages} ${r.passages === 1 ? "passage" : "passages"}`
                        : "nothing to read"}
                    </i>
                    {r.shared && !admin && <i className="teaches house">the house&apos;s</i>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {viewing && (
        <Viewer
          row={viewing}
          admin={admin}
          onClose={() => setViewing(null)}
          onStep={step}
          onDownload={() => download([viewing])}
          onRemove={() => remove([viewing])}
        />
      )}
    </main>
  );
}

/** A document viewed in place: the scan, the PDF, or the server-extracted words when the browser cannot show it. */
function Viewer({ row, admin, onClose, onStep, onDownload, onRemove }) {
  const ref = useRef(null);
  const [words, setWords] = useState(null);
  const [paper, setPaper] = useState("");
  const [asWord, setAsWord] = useState("");
  /* Why it could not be drawn, in words, instead of a screen that just waits. */
  const [whyNot, setWhyNot] = useState("");

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  /* A .docx is laid out by an engine that reads Word rather than redrawn in the browser; binary .doc has
     no such reader and falls back to the text the server pulled out. */
  useEffect(() => {
    if (!isWord(row)) {
      setAsWord("");
      return undefined;
    }
    let live = true;
    let address = "";
    /* Moving to the next document cancels the one being drawn; that is not a
       document that failed. */
    const stop = new AbortController();
    setAsWord("reading");
    setWhyNot("");
    /* Never leave the screen waiting: give up after a timeout and say so. */
    const gaveUp = setTimeout(() => {
      if (!live) return;
      setWhyNot("It is taking longer than it should. The download below still works.");
      setAsWord("failed");
    }, 45000);
    (async () => {
      try {
        const file = await fetch(`/api/library?file=${row.id}&inline=1`, { signal: stop.signal }).then((res) => {
          if (!res.ok) throw new Error(res.status === 403 ? "not yours" : `server ${res.status}`);
          return res.arrayBuffer();
        });
        const drawn = await fetch("/api/render", {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: file,
          signal: stop.signal,
        });
        if (!drawn.ok) throw new Error("could not be drawn");
        const pdf = await drawn.blob();
        clearTimeout(gaveUp);
        if (!live) return;
        address = URL.createObjectURL(pdf);
        setPaper(address);
        setAsWord("shown");
      } catch (e) {
        clearTimeout(gaveUp);
        if (!live || e?.name === "AbortError") return;
        setWhyNot(
          e.message === "not yours"
            ? "That document belongs to someone else."
            : "This one could not be drawn on screen. The download below still works.",
        );
        setAsWord("failed");
      }
    })();
    return () => {
      live = false;
      clearTimeout(gaveUp);
      stop.abort();
      if (address) URL.revokeObjectURL(address);
    };
  }, [row]);

  useEffect(() => {
    if (isImage(row) || isPdf(row)) return;
    setWords(null);
    let live = true;
    fetch(`/api/library?text=${row.id}`)
      .then((r) => (r.ok ? r.json() : { text: "", read: false }))
      .then((b) => live && setWords(b))
      .catch(() => live && setWords({ text: "", read: false }));
    return () => {
      live = false;
    };
  }, [row]);

  useEffect(() => {
    const keys = (e) => {
      if (e.key === "ArrowRight") onStep(1);
      if (e.key === "ArrowLeft") onStep(-1);
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [onStep]);

  return (
    <dialog className="viewer" ref={ref} onClose={onClose} onCancel={onClose}>
      <header>
        <div>
          <h2>{row.name}</h2>
          <p>{[size(row.size || 0), when(row.created_at), row.notes].filter(Boolean).join(" · ")}</p>
        </div>
        <button className="ghost" onClick={() => onStep(-1)} aria-label="Previous">
          ‹
        </button>
        <button className="ghost" onClick={() => onStep(1)} aria-label="Next">
          ›
        </button>
        <button className="ghost" onClick={onDownload}>
          Download
        </button>
        {admin && (
          <button className="ghost bad" onClick={onRemove}>
            Remove
          </button>
        )}
        <button className="shut" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <div className={`look${isPdf(row) || asWord === "shown" ? " paper" : ""}`}>
        {/* Say plainly why the document is not on screen, instead of falling silently through to the text. */}
        {whyNot && (
          <p className="note bad">
            {whyNot}
            {whyNot.startsWith("The site has been updated") && (
              <button className="ghost" type="button" onClick={() => location.reload()}>
                Reload
              </button>
            )}
          </p>
        )}
        {isWord(row) && asWord !== "failed" ? (
          paper ? (
            <Pages src={paper} title={row.name} />
          ) : (
            <p className="note">Opening the document…</p>
          )
        ) : isImage(row) ? (
          <img src={`/api/library?file=${row.id}&inline=1`} alt={row.name} />
        ) : isPdf(row) ? (
          <Pages src={`/api/library?file=${row.id}&inline=1`} title={row.name} />
        ) : words === null ? (
          <p className="note">Reading it…</p>
        ) : words.read ? (
          <pre>{words.text}</pre>
        ) : (
          <p className="note">
            The server has not read this one yet. Scans are read within a few minutes — until
            then, download it to see it.
          </p>
        )}
      </div>
    </dialog>
  );
}
