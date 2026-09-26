import { useEffect, useState } from "react";
import { TOOLS } from "../components/Sidebar";
import { available as cloudOn, deleteDocument, listEverything } from "../engine/cloud";
import Icon from "../components/Icon";
import Sheet from "../components/Sheet";
import { V, generateDocument } from "../engine/generator";
import "../styles/form.css";

const when = (iso) => {
  const days = Math.round((Date.now() - new Date(iso)) / 864e5);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

/* The hero is the thing the site makes: a real sheet, drawn by the same engine,
   lying on the bench at the edge of the page. */
const SAMPLE_DOC = {
  crew: "", position: "ROV Sub Tech", vessel: "", supervisor: "", supervisorPosition: "ROV Team Lead",
  start: "", end: "", campaign: "flexlay", workScope: V.campaigns.flexlay.scopes[0], draft: false,
};

export default function Home({ go }) {
  const tools = TOOLS.filter((t) => t.path !== "/");
  const [saved, setSaved] = useState([]);
  const [evidence, setEvidence] = useState([]);
  const [sample] = useState(() => generateDocument(SAMPLE_DOC, { preset: "good" }));

  useEffect(() => {
    if (!cloudOn()) return;
    /* One journey for both lists: they are shown on the same screen. */
    listEverything()
      .then((all) => {
        setSaved(all.filter((d) => (d.kind || "trip") === "trip"));
        setEvidence(all.filter((d) => d.kind === "caap"));
      })
      .catch(() => {});
  }, []);

  const [trouble, setTrouble] = useState("");

  async function removeOne(id, set) {
    let before = [];
    set((list) => {
      before = list;
      return list.filter((d) => d.id !== id);
    });
    setTrouble("");
    try {
      await deleteDocument(id);
    } catch {
      /* It is still on the account, so it must still be on the screen: taken
         off the list and left on the server, it reappears at the next reload
         and the delete looks like it worked. */
      set(before);
      setTrouble("That one could not be deleted — the account did not answer. Try again.");
    }
  }
  const remove = (id) => removeOne(id, setSaved);
  return (
    <main className="home">
      <div className="hero-sheet" aria-hidden="true">
        <Sheet
          doc={SAMPLE_DOC}
          criteria={sample.criteria}
          blocks={sample.blocks}
          generation={0}
          onEdit={() => {}}
          page1Ref={{ current: null }}
          sigRef={{ current: null }}
        />
      </div>
      <header>
        <h1>The paperwork, already half written.</h1>
        <p>Tools for people who work offshore. Nothing you write leaves this page.</p>
      </header>

      <div className="home-grid">
        <section className="panel">
          <h2>Open</h2>
          <ul className="tool-list">
          {tools.map((t) => (
            <li key={t.path}>
              <a
                href={t.path}
                onClick={(e) => {
                  e.preventDefault();
                  go(t.path);
                }}
              >
                <Icon name={t.icon} size={20} className="glyph" />
                <span>
                  <b>{t.label}</b>
                  <em>{t.blurb}</em>
                </span>
              </a>
            </li>
          ))}
          </ul>
        </section>

        {trouble && <p className="result bad">{trouble}</p>}

        <section className="panel">
          <h2>Your evidence</h2>
          {evidence.length === 0 ? (
            <p className="note">Nothing saved yet — a CAAP or CRF set you keep shows up here.</p>
          ) : (
            <ul className="saved-list">
              {evidence.slice(0, 8).map((d) => (
                <li key={d.id}>
                  <a
                    href={`/caap?doc=${d.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      history.pushState(null, "", `/caap?doc=${d.id}`);
                      location.reload();
                    }}
                  >
                    <b>{d.crew || "Untitled"}</b>
                    <span>{[d.vessel, (d.preset || "caap").toUpperCase()].filter(Boolean).join(" · ")}</span>
                  </a>
                  <span className="ago">{when(d.updated_at)}</span>
                  <button onClick={() => removeOne(d.id, setEvidence)} title="Delete" aria-label="Delete">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>Your trips</h2>
          {saved.length === 0 ? (
            <p className="note">Nothing saved yet — a trip you keep shows up here.</p>
          ) : (
          <ul className="saved-list">
            {saved.slice(0, 8).map((d) => (
              <li key={d.id}>
                <a
                  href={`/trip-feedback?doc=${d.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    history.pushState(null, "", `/trip-feedback?doc=${d.id}`);
                    location.reload();
                  }}
                >
                  <b>{d.crew || "Untitled"}</b>
                  <span>
                    {[d.vessel, d.trip_end, d.preset].filter(Boolean).join(" · ")}
                  </span>
                </a>
                <span className="ago">{when(d.updated_at)}</span>
                <button onClick={() => remove(d.id)} title="Delete" aria-label="Delete">
                  ✕
                </button>
              </li>
            ))}
          </ul>
          )}
        </section>
      </div>
    </main>
  );
}
