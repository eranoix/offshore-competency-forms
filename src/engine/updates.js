/**
 * Loads a new build as soon as it is ready, without offering: a waiting worker otherwise waits for every
 * window to close, which for an app kept open all day is close to never. Panels save as typed, so nothing is lost.
 */
import { registerSW } from "virtual:pwa-register";

/** Starts watching for a new build, and loads it the moment there is one. */
export function watchForUpdates() {
  try {
    registerSW({ immediate: true, onNeedRefresh: () => { loadItNow(); } });
  } catch {
    /* No service worker (a copy run from a folder, or a browser without it): nothing to watch. */
  }
}

/**
 * Puts the waiting build in place and reloads onto it. The worker is fetched fresh because a held one may
 * already have activated, and the message would go nowhere; the timer covers a takeover that never comes.
 */
export async function loadItNow() {
  const reload = () => window.location.reload();
  if (!("serviceWorker" in navigator)) return reload();
  let reg = null;
  try {
    reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return reload();
    /* Ask once more before acting on what was true a moment ago — bounded,
       because a slow network must not leave the page sitting there. */
    if (!reg.waiting && !reg.installing) {
      await Promise.race([reg.update().catch(() => {}), hold(4000)]);
    }
    /* One still installing is a moment away from waiting: wait for it rather
       than reloading into the build being replaced. */
    const coming = reg.installing;
    if (coming && !reg.waiting) {
      await Promise.race([
        new Promise((done) => coming.addEventListener("statechange", () => {
          if (coming.state !== "installing") done();
        })),
        hold(4000),
      ]);
    }
    const waiting = reg.waiting;
    /* Nothing waiting: the newest worker is already in charge and a message would reach nobody, so reload. */
    if (!waiting) return reload();
    navigator.serviceWorker.addEventListener("controllerchange", reload, { once: true });
    waiting.postMessage({ type: "SKIP_WAITING" });
  } catch {
    return reload();
  }
  /* If the takeover never comes, unregister and reload: a plain reload would get the old build from the
     old worker, while this one comes off the network and the new build registers its own worker. */
  setTimeout(async () => {
    try { await reg.unregister(); } catch { /* it is going anyway */ }
    reload();
  }, 3000);
  return undefined;
}

const hold = (ms) => new Promise((r) => setTimeout(r, ms));
