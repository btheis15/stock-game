// Offline-fallback-ONLY service worker.
//
// This app's caching architecture is deliberately always-fresh (no-store on
// every document + data route — see next.config.ts; iOS webclip snapshots
// burned us before). This worker must therefore NEVER cache or serve
// documents, data JSON, or bundles. Its single job: when a navigation
// fails because the device is offline, show the branded /offline.html
// instead of the browser error page. Everything else passes through
// untouched (no respondWith → normal network handling).

const CACHE = "offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL))
  );
});
