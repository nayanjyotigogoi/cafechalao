/* CafeChalao service worker: keeps the app shell available offline so POS, captain and KDS reopen without internet.
   API calls are never cached here; offline writes go to the outbox in shared/offline. */
const SHELL = "cc-shell-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/staff", "/pos", "/captain", "/kds"]).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  // Network first for pages, falling back to the cached shell; cache first for static assets.
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copy = r.clone();
          caches.open(SHELL).then((c) => c.put(e.request, copy));
          return r;
        })
        .catch(() => caches.match(e.request).then((r) => r || caches.match("/staff"))),
    );
  } else if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/")) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put(e.request, copy));
      return res;
    })));
  }
});
