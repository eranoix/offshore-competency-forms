/**
 * Hand-written worker: navigations go network-first (with a timeout) so the edge gate runs and a stale build
 * cannot get stuck, falling back to the cache with no signal. Everything else is precached, cache-first.
 */
import { cleanupOutdatedCaches, PrecacheController, PrecacheRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

const precache = new PrecacheController();
precache.addToCacheList(self.__WB_MANIFEST);
registerRoute(new PrecacheRoute(precache));
cleanupOutdatedCaches();

const stock = (event) => precache.install(event);
/* Whether any precache entry is missing: the worker can arrive while nobody is signed in, when the
   code it would store is behind the gate. */
async function short() {
  const cache = await caches.open(precache.strategy.cacheName);
  const have = new Set((await cache.keys()).map((r) => r.url));
  return [...precache.getURLsToCacheKeys().values()].some((key) => !have.has(key));
}

/* Installed even when precaching fails: this file is fetched signed out too, and refusing would leave a
   signed-out browser on the old worker. What is missing is fetched on the next signed-in load. */
self.addEventListener("install", (event) => event.waitUntil(stock(event).catch(() => {})));
self.addEventListener("activate", (event) => event.waitUntil(precache.activate(event)));

/* The precached page: the last resort, and the one that works with no signal. */
const held = precache.createHandlerBoundToURL("index.html");
const PAGES = "pages";
/* A short patience: a vessel's link can be alive and useless, and waiting on
   it is worse than answering from store. */
const PATIENCE = 4000;

registerRoute(
  new NavigationRoute(
    async ({ request, event }) => {
      try {
        const got = await Promise.race([
          /* The browser's own request, not a rebuilt one: a rebuilt request follows the gate's redirect,
             and the browser refuses a followed redirect as the answer to a navigation. */
          fetch(request),
          new Promise((none, slow) => setTimeout(() => slow(new Error("slow")), PATIENCE)),
        ]);
        /* Sent to sign in, or anything but a page: the browser has it as the
           server said it. */
        if (got.type === "opaqueredirect" || !got.ok) return got;
        event.waitUntil((async () => {
          await (await caches.open(PAGES)).put(request, got.clone());
          if (await short()) await stock(event).catch(() => {});
        })());
        return got;
      } catch {
        /* No signal, or the link timed out. The cupboard answers. */
        return (await caches.match(request, { cacheName: PAGES })) || held({ request, event });
      }
    },
    {
      /* The writing endpoint and the gate always reach the network: a cached
         answer from either would look like being offline. */
      denylist: [/^\/api\//, /^\/login/],
    },
  ),
);

/* The app asks for the new build to take over when it has one. */
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

/* Claim open pages on activation: otherwise no controller changes, the app never hears of the new
   worker, and the promised reload never happens. */
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
