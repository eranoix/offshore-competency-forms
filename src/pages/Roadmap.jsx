import { useState } from "react";
import releases from "../meta/releases.json";
import roadmap from "../meta/roadmap.json";
/* The version only. Importing the whole file ships the dependency list
   and the build scripts to every browser that opens the page. */
import { version } from "../../package.json";

const STAGES = [
  { key: "next", label: "Next", note: "being built now" },
  { key: "later", label: "Later", note: "planned, not started" },
  { key: "considering", label: "Considering", note: "not decided" },
];

const longDate = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
};

/** Where the site says what it has done and what it intends to do. */
export default function Roadmap() {
  const [tab, setTab] = useState("coming");

  return (
    <main className="home roadmap">
      <header>
        <h1>What is coming, and what already landed.</h1>
        <p>
          The list is kept in the repository next to the code, so it cannot drift from what
          the site actually does. You are on version {version}.
        </p>
      </header>

      <nav className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "coming"}
          className={tab === "coming" ? "on" : ""}
          onClick={() => setTab("coming")}
        >
          Coming
        </button>
        <button
          role="tab"
          aria-selected={tab === "changed"}
          className={tab === "changed" ? "on" : ""}
          onClick={() => setTab("changed")}
        >
          Released
        </button>
      </nav>

      {tab === "coming" &&
        STAGES.map(({ key, label, note }) => {
          const items = roadmap.filter((r) => r.state === key);
          if (!items.length) return null;
          return (
            <section key={key} className="phase">
              <div className="phase-head">
                <h2>{label}</h2>
                <span>{note}</span>
              </div>
              <ul className="plans">
                {items.map((i) => (
                  <li key={i.title}>
                    <b>{i.title}</b>
                    <span>{i.detail}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

      {tab === "changed" && (
        <ol className="timeline">
          {releases.map((r, i) => (
            <li key={r.version} className={i === 0 ? "current" : ""}>
              <div className="stamp">
                <b>{r.version}</b>
                <time dateTime={r.date}>{longDate(r.date)}</time>
                {i === 0 && <em>current</em>}
              </div>
              <h2>{r.title}</h2>
              <ul>
                {r.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
