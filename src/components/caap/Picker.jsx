import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Picking from a long taxonomy gets a surface of its own (139 criteria in a panel
 * beside a form is a list you scroll past): search, the groups with their counts,
 * and what you have chosen kept in sight.
 */
export default function Picker({
  open,
  title,
  subtitle,
  groups,          // [{ unit, items: [{ text, levels }] }]
  chosen,          // [{ text }]
  onToggle,
  onBulk,          // (items, on) => void — the whole visible slice at once
  levelsLabel,     // (level) => short label
  noun = "criteria",
  single = false,  // pick one and the dialog closes
  ownLevel,
  onClose,
}) {
  const ref = useRef(null);
  const search = useRef(null);
  const [find, setFind] = useState("");
  const [unit, setUnit] = useState("");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      setTimeout(() => search.current?.focus(), 30);
    }
    if (!open && el.open) el.close();
  }, [open]);

  const shown = useMemo(() => {
    const needle = find.trim().toLowerCase();
    return groups
      .filter((g) => !unit || g.unit === unit)
      .map((g) => ({ ...g, items: g.items.filter((c) => !needle || c.text.toLowerCase().includes(needle)) }))
      .filter((g) => g.items.length);
  }, [groups, unit, find]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const count = shown.reduce((n, g) => n + g.items.length, 0);
  const picked = (text) => chosen.some((c) => c.text === text);

  /* The bar takes whatever the group and the search have left on screen, never
     the whole framework behind your back. */
  const visible = useMemo(() => shown.flatMap((g) => g.items), [shown]);
  const choose = (c) => {
    onToggle(c);
    if (single) onClose();
  };
  const allPicked = count > 0 && visible.every((c) => picked(c.text));

  return (
    <dialog className={single ? "picker single-pick" : "picker"} ref={ref} onClose={onClose} onCancel={onClose}>
      <header>
        <div>
          <h2>{title}</h2>
          <p>
            {subtitle} · {count === total ? `${total} ${noun}` : `${count} of ${total}`}
            {single ? "" : ` · ${chosen.length} chosen`}
          </p>
        </div>
        <input
          ref={search}
          type="search"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="Search — hot stab, toolbox talk, umbilical…"
        />
        <button className="shut" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <div className={groups.length > 1 ? "body" : "body single"}>
        {groups.length > 1 && (
        <nav>
          <button className={unit ? "" : "on"} onClick={() => setUnit("")}>
            <span>Every group</span>
            <em>{total}</em>
          </button>
          {groups.map((g) => (
            <button key={g.unit} className={unit === g.unit ? "on" : ""} onClick={() => setUnit(g.unit)}>
              <span>{g.unit}</span>
              <em>{g.items.length}</em>
            </button>
          ))}
        </nav>
        )}

        <div className="list">
          {!single && (
          <div className="bulk">
            <button
              className="all"
              disabled={!count}
              onClick={() => onBulk(visible, !allPicked)}
            >
              {count === 1
                ? allPicked
                  ? "Untick this one"
                  : "Tick this one"
                : allPicked
                  ? `Untick these ${count}`
                  : unit || find.trim()
                    ? `Tick these ${count}`
                    : `Tick all ${count}`}
            </button>
            {chosen.length > 0 && (
              <button className="clear" onClick={() => onBulk(chosen, false)}>
                Clear {chosen.length} chosen
              </button>
            )}
          </div>
          )}

        <ul>
          {shown.map((g) => (
            <li key={g.unit} className="group">
              {!unit && <h3>{g.unit}</h3>}
              <ul>
                {g.items.map((c) => (
                  <li key={c.text}>
                    <label>
                      <input
                        type={single ? "radio" : "checkbox"}
                        name={single ? "one" : undefined}
                        checked={picked(c.text)}
                        onChange={() => choose(c)}
                      />
                      <span>{c.text}</span>
                      {c.levels?.length > 1 && (
                        <em>
                          {c.levels.map((l) => (
                            <i key={l} className={l === ownLevel ? "own" : ""} title={l}>
                              {levelsLabel(l)}
                            </i>
                          ))}
                        </em>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {!count && <li className="empty">Nothing matches “{find}”. Try a shorter word.</li>}
        </ul>
        </div>
      </div>

      <footer>
        {!single && (
        <ul className="chips">
          {chosen.map((c) => (
            <li key={c.text}>
              <span title={c.text}>{c.text}</span>
              <button onClick={() => onToggle(c)} aria-label={`Remove ${c.text}`}>
                ×
              </button>
            </li>
          ))}
          {!chosen.length && <li className="none">Nothing chosen yet</li>}
        </ul>
        )}
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      </footer>
    </dialog>
  );
}
