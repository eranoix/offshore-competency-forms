import { useEffect, useState } from "react";
import Icon from "./Icon";
import { packedAt, packedForms } from "../engine/forms";
import { readSetting, release, writeSetting } from "../engine/vault";
import { Mark } from "./Logo";

/**
 * The site's sidebar. It retracts to icons on its own — on a narrow screen, and
 * whenever you are not pointing at it — so the page you are working on keeps the
 * room. Hovering brings the labels back without a click.
 */
const STORAGE = "offshore-report:sidebar";

export const TOOLS = [
  { path: "/", icon: "home", label: "Home", blurb: "Everything here" },
  { path: "/trip-feedback", icon: "form", label: "Trip feedback", blurb: "Fill and print the trip feedback" },
  { path: "/caap", icon: "badge", label: "CAAP evidence", blurb: "The five programme forms" },
  { path: "/library", icon: "upload", label: "Library", blurb: "Hand over paperwork to learn from" },
  { path: "/forms", icon: "form", label: "The forms", blurb: "The company's documents, and their wording" },
  { path: "/rotation", icon: "calendar", label: "Rotation", blurb: "The turns ahead, and the days they count for" },
  { path: "/account", icon: "account", label: "Account", blurb: "Who you are and what is saved" },
  { path: "/roadmap", icon: "clock", label: "Roadmap", blurb: "What is coming, and what landed" },
];

export default function Sidebar({ path, go, version, isAdmin }) {
  const [pinned, setPinned] = useState(() => {
    try {
      return readSetting(STORAGE) === "open";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      writeSetting(STORAGE, pinned ? "open" : "closed");
    } catch {
    }
  }, [pinned]);

  async function signOut() {
    /* Signing out must never be refusable: the session is ended on the server
       when it can be, and this browser is emptied either way. */
    let reached = false;
    try {
      const res = await fetch("/api/logout", { method: "POST" });
      reached = res.ok;
    } catch {
      reached = false;
    }
    /* The paperwork leaves the machine with the person: nothing of theirs is
       left for whoever signs in next. */
    release();
    if (!reached) {
      /* The cookie is the server's and cannot be reached from here. Nothing of
         yours is left on this browser, but the session itself may still stand,
         and you are the one who needs to know that. */
      alert(
        "Your work has been cleared from this browser. The sign-out did not reach the server, so the session may still be open — sign out again when you have signal.",
      );
    }
    location.href = "/login";
  }

  return (
    <nav className={`sidebar${pinned ? " pinned" : ""}`} aria-label="Sections">
      <div className="sb-head">
        <Mark size={26} id="rail" />
        <span className="wordmark">
          form<b>flow</b>
        </span>
        <button
          className="sb-pin"
          onClick={() => setPinned((v) => !v)}
          aria-pressed={pinned}
          title={pinned ? "Let it retract" : "Keep it open"}
        >
          {pinned ? "«" : "»"}
        </button>
      </div>

      <ul className="sb-list">
        {(isAdmin ? TOOLS.concat({ path: "/admin", icon: "people", label: "Accounts" }) : TOOLS).map((t) => (
          <li key={t.path}>
            <a
              href={t.path}
              className={path === t.path ? "on" : ""}
              aria-current={path === t.path ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                e.currentTarget.blur(); // a mouse click must not leave the rail open
                go(t.path);
              }}
            >
              <Icon name={t.icon} className="glyph" />
              <span className="label">{t.label}</span>
            </a>
          </li>
        ))}
      </ul>

      <span className="sb-version">v{version}</span>
      {/* The copy that runs from a folder carries the forms as they were when
          it was built and has no way of asking for newer ones. Somebody
          offshore has no way of knowing that unless it says so. */}
      {__OFFLINE__ && packedAt() && (
        <span
          className="sb-packed"
          title={`This copy carries the forms as they were on ${packedAt()}. A form published since is not in it — take a fresh copy.${
            packedForms().length ? ` Carrying: ${packedForms().join(", ")}.` : ""
          }`}
        >
          forms of {packedAt()}
        </span>
      )}

      {!__OFFLINE__ && (
        <button className="sb-out" onClick={signOut}>
          <Icon name="power" className="glyph" />
          <span className="label">Sign out</span>
        </button>
      )}
    </nav>
  );
}
