import { useEffect, useState } from "react";
import Icon from "../components/Icon";

/** Accounts. Only the administrator sees this page, and the API checks again. */
export default function Admin() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ email: "", password: "" });
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  const load = () =>
    fetch("/api/users")
      .then((r) => (r.ok ? r.json() : r.json().then((b) => Promise.reject(new Error(b.error)))))
      .then((d) => setUsers(d.users))
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  async function send(method, body, query = "") {
    setBusy(method + query);
    setNote("");
    try {
      const res = await fetch(`/api/users${query}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const answer = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(answer.error || `failed (${res.status})`);
      await load();
      return answer;
    } catch (e) {
      setNote(e.message);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function create(e) {
    e.preventDefault();
    const answer = await send("POST", form);
    if (answer?.user) {
      setNote(`${answer.user.email} can sign in now. Give them the password you just set.`);
      setForm({ email: "", password: "" });
    }
  }

  async function newPassword(user) {
    const password = prompt(`New password for ${user.email} — at least 8 characters`);
    if (!password) return;
    const answer = await send("PATCH", { id: user.id, password });
    if (answer) setNote(`Password set for ${user.email}. They can change it in their Account page.`);
  }

  return (
    <main className="home admin">
      <header>
        <h1>Accounts</h1>
        <p>
          There is no email server behind this site, so nobody gets a reset link. You set
          a password here and pass it on; they change it themselves afterwards.
        </p>
      </header>

      {error && <p className="result bad">{error}</p>}

      <section>
        <h2>Add someone</h2>
        <form className="pw wide" onSubmit={create}>
          <label className="field">
            <span>User — a plain name becomes name@forms.example.org</span>
            <input
              type="text"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="e.g. tamer"
              required
            />
          </label>
          <label className="field">
            <span>First password — at least 8 characters</span>
            <input
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </label>
          <button className="btn" type="submit" disabled={busy === "POST"}>
            Create the account
          </button>
        </form>
        {note && <p className="result ok">{note}</p>}
      </section>

      <section>
        <h2>Who can sign in</h2>
        <ul className="users">
          {users.map((u) => (
            <li key={u.id} className={u.disabled ? "off" : ""}>
              <Icon name="account" />
              <span className="who">
                <b>{u.email}</b>
                <span>
                  {u.admin ? "administrator · " : ""}
                  {u.last_sign_in_at
                    ? `last signed in ${new Date(u.last_sign_in_at).toLocaleDateString("en-GB")}`
                    : "never signed in"}
                  {u.disabled ? " · disabled" : ""}
                </span>
              </span>
              <button onClick={() => newPassword(u)}>New password</button>
              <button onClick={() => send("PATCH", { id: u.id, disabled: !u.disabled })}>
                {u.disabled ? "Enable" : "Disable"}
              </button>
              {!u.admin && (
                <button
                  className="danger"
                  onClick={() =>
                    confirm(`Delete ${u.email} and everything they saved?`) &&
                    send("DELETE", null, `?id=${u.id}`)
                  }
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
