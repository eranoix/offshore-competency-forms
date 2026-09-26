import { useEffect, useState } from "react";
import { available as cloudOn, forgetPhrases, getProfile, putProfile } from "../engine/cloud";
import { forget as forgetLocalPhrases, seenCount } from "../engine/memory";
import { writeMine } from "../engine/vault";

const PROFILE_KEY = "trip-feedback:profile"; // the same copy the tool keeps, under this account
const GROUPS = [
  ["crews", "Crew"],
  ["supervisors", "Supervisors"],
  ["vessels", "Vessels"],
];

/** Who you are, what the account is holding, and how to change the password. */
export default function Account() {
  const [me, setMe] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ current: "", next: "", repeat: "" });
  const [state, setState] = useState({ kind: "", text: "" });
  /* When something the account holds could not be changed. Saying nothing
     leaves the screen showing a change that did not happen. */
  const [trouble, setTrouble] = useState("");
  const [learned, setLearned] = useState({ vessels: [], supervisors: [], crews: [] });
  const [local, setLocal] = useState(seenCount);

  useEffect(() => {
    if (!cloudOn()) return;
    fetch("/api/me?counts=1")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not signed in"))))
      .then(setMe)
      .catch((e) => setError(e.message));
    getProfile()
      .then((p) =>
        setLearned({ vessels: p.vessels || [], supervisors: p.supervisors || [], crews: p.crews || [] }),
      )
      .catch(() => {});
  }, []);

  /* Forgetting has to reach both copies: the account, and this browser — which
     would otherwise offer the name again the next time the tool opens. */
  async function forgetName(group, name) {
    const before = learned;
    const next = { ...learned, [group]: learned[group].filter((v) => v !== name) };
    setLearned(next);
    setTrouble("");
    try {
      writeMine(PROFILE_KEY, next);
    } catch {
      /* a browser with no storage is fine; the account still knows */
    }
    try {
      await putProfile(next);
    } catch {
      /* The account still has the name, so the screen must show it again —
         otherwise it comes back by itself the next time the tool opens. */
      setLearned(before);
      try {
        writeMine(PROFILE_KEY, before);
      } catch {
        /* no storage */
      }
      setTrouble(`${name} could not be forgotten — the account did not answer. Try again.`);
    }
  }

  async function startPhrasesAgain() {
    if (!confirm("Forget every sentence already printed? They become available again.")) return;
    setTrouble("");
    try {
      /* The account first: clearing only this browser would look done and then
         fill up again from the account the next time the app opens. */
      await forgetPhrases();
    } catch {
      setTrouble("The sentences could not be forgotten — the account did not answer. Nothing was changed.");
      return;
    }
    forgetLocalPhrases();
    setLocal(0);
    setMe((m) => (m ? { ...m, phrases: 0 } : m));
  }

  const mismatch = form.repeat.length > 0 && form.next !== form.repeat;
  /* The browser records a sentence the moment it reaches paper and sends it up
     a second and a half later, so it can legitimately be ahead of the account. */
  const waiting = Math.max(0, local - (me?.phrases ?? local));
  const names = GROUPS.filter(([k]) => learned[k].length);

  async function changePassword(e) {
    e.preventDefault();
    if (form.next !== form.repeat) {
      setState({ kind: "bad", text: "The two new passwords are not the same." });
      return;
    }
    setState({ kind: "busy", text: "Changing…" });
    try {
      const res = await fetch("/api/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ current: form.current, next: form.next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "could not change it");
      setForm({ current: "", next: "", repeat: "" });
      setState({ kind: "ok", text: "Changed. It applies the next time you sign in." });
    } catch (err) {
      setState({ kind: "bad", text: err.message });
    }
  }

  return (
    <main className="home account">
      <header>
        <h1>Account</h1>
        <p>
          {me?.email || (error ? "Not signed in" : "…")}
          {me?.admin && <span className="badge">administrator</span>}
        </p>
      </header>

      <div className="acc-grid">
        <section className="panel">
          <h2>Held for you</h2>
          <ul className="stats">
            {/* Every row of the store, whatever it is: trip feedbacks, CAAP packs and
                rotation plans. */}
            <li>
              <b>{me?.documents ?? "—"}</b>
              <span>saved documents</span>
            </li>
            <li>
              <b>{me?.phrases ?? "—"}</b>
              <span>sentences spent</span>
            </li>
            <li>
              <b>{local}</b>
              <span>in this browser{waiting > 0 ? ` · ${waiting} not sent yet` : ""}</span>
            </li>
          </ul>

          {trouble && <p className="result bad">{trouble}</p>}

          <div className="names">
            {names.length === 0 ? (
              <p className="note">
                No names yet — one is remembered when you print a document with it.
              </p>
            ) : (
              names.map(([k, label]) => (
                <div key={k}>
                  <h3>{label}</h3>
                  <ul>
                    {learned[k].map((name) => (
                      <li key={name}>
                        {name}
                        <button
                          type="button"
                          onClick={() => forgetName(k, name)}
                          aria-label={`Forget ${name}`}
                          title="Forget this one"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>

          <button className="ghost" type="button" onClick={startPhrasesAgain}>
            Empty the phrase memory
          </button>
        </section>

        <section className="panel">
          <h2>Change password</h2>
          <form className="pw" onSubmit={changePassword}>
            <label className="field">
              <span>Current</span>
              <input
                type="password"
                autoComplete="current-password"
                value={form.current}
                onChange={(e) => setForm({ ...form, current: e.target.value })}
                required
              />
            </label>
            <div className="pair">
              <label className="field">
                <span>New — 8 characters or more</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={form.next}
                  onChange={(e) => setForm({ ...form, next: e.target.value })}
                  required
                />
              </label>
              <label className="field">
                <span>Repeat it</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={form.repeat}
                  onChange={(e) => setForm({ ...form, repeat: e.target.value })}
                  aria-invalid={mismatch}
                  required
                />
              </label>
            </div>
            <div className="pw-foot">
              <button
                className="btn"
                type="submit"
                disabled={state.kind === "busy" || mismatch || !form.next}
              >
                Change it
              </button>
              {mismatch ? (
                <p className="result bad">They are not the same yet.</p>
              ) : (
                state.text && <p className={`result ${state.kind}`}>{state.text}</p>
              )}
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
