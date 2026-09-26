import { lazy, Suspense, useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import { hydrate } from "./engine/memory";
import Home from "./pages/Home";
import TripFeedback from "./pages/TripFeedback";
import Account from "./pages/Account";
import Admin from "./pages/Admin";
/* Loaded when opened: it is the largest page and no other page uses it, and
   bundled it put /caap over the script budget. */
const Rotation = lazy(() => import("./pages/Rotation"));
import Roadmap from "./pages/Roadmap";
import Forms from "./pages/Forms";
import Library from "./pages/Library";
import Caap from "./pages/Caap";
/* The version only. Importing the whole file ships the dependency list
   and the build scripts to every browser that opens the page. */
import { version } from "../package.json";
import "./styles/app.css";
import "./styles/shell.css";
import { claim } from "./engine/vault";
import { watchForUpdates } from "./engine/updates";
import { catchUp } from "./engine/forms";

/**
 * Paths are real paths (vercel.json rewrites them here) so links can be shared,
 * except in the offline copy opened from a folder: a page with no origin cannot be
 * given a path (navigation throws a SecurityError), so there the route lives in
 * the hash.
 */
const fromFolder = () => location.protocol === "file:";
const routeNow = () =>
  (fromFolder() ? location.hash.replace(/^#/, "") : location.pathname).replace(/\/+$/, "") || "/";

function useRoute() {
  const [path, setPath] = useState(routeNow);
  useEffect(() => {
    const onMove = () => setPath(routeNow());
    window.addEventListener("popstate", onMove);
    window.addEventListener("hashchange", onMove);
    return () => {
      window.removeEventListener("popstate", onMove);
      window.removeEventListener("hashchange", onMove);
    };
  }, []);
  const go = (to) => {
    if (to === path) return;
    if (fromFolder()) location.hash = to;
    else history.pushState(null, "", to);
    setPath(to);
  };
  return [path, go];
}

export default function App() {
  const [path, go] = useRoute();
  const [me, setMe] = useState(null);
  /* Nothing is read out of this browser before we know whose it is: the pages
     below keep their working copy locally, and on a shared machine that copy
     belongs to whoever signed in last. */
  const [known, setKnown] = useState(false);
  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        setMe(body);
        claim(body?.id || body?.sub || body?.email || "");
        setKnown(true);
      })
      .catch(() => {
        claim("");
        setKnown(true);
      });
  }, []);
  /* The phrase bank belongs to the trip form, so it is fetched only there; on
     every page it cost three quarters of a second of load. */
  useEffect(() => {
    if (known && path === "/trip-feedback") hydrate();
  }, [known, path]);

  /* A new build is put in place the moment it is ready, with no button: a worker
     that waits for every window to close never updates an app kept open all day. */
  useEffect(() => { watchForUpdates(); }, []);
  /* Catch up with published forms only once there is somebody to ask on behalf
     of; asked earlier, it is a failed request in every console on every load. */
  useEffect(() => {
    if (me) catchUp().catch(() => {});
  }, [me]);
  const page = !known ? (
    <main className="home">
      <p className="note">Opening your work…</p>
    </main>
  ) : path === "/trip-feedback" ? (
      <TripFeedback />
    ) : path === "/account" ? (
      <Account />
    ) : path === "/caap" || path === "/witness" ? (
      <Caap />
    ) : path === "/library" ? (
      <Library />
    ) : path === "/rotation" ? (
      <Suspense fallback={<main className="rota" aria-busy="true" />}><Rotation /></Suspense>
    ) : path === "/roadmap" ? (
      <Roadmap />
    ) : path === "/forms" ? (
      <Forms isAdmin={Boolean(me?.admin)} />
    ) : path === "/admin" && me?.admin ? (
      <Admin />
    ) : (
      <Home go={go} />
    );
  useEffect(() => {
    const names = {
      "/trip-feedback": "Trip feedback",
      "/account": "Account",
      "/caap": "CAAP evidence",
      "/library": "Library",
      "/rotation": "Rotation",
      "/roadmap": "Roadmap",
      "/forms": "The forms",
      "/admin": "Accounts",
    };
    document.title = names[path] ? `${names[path]} · Offshore Report` : "Offshore Report";
  }, [path]);

  return (
    <div className="site">
      <Sidebar path={path} go={go} version={version} isAdmin={me?.admin} />
      <div className="view">{page}</div>
    </div>
  );
}
