// Wellsure HR service worker (Phase 5 commit G, docs/UI_REFERENCE.md Part 4).
// It exists to make the portal installable and to open the app shell
// offline. It never caches data:
//   - page navigations: network first; offline → the cached app shell
//     (index.html), so the app opens and shows its own "can't reach the
//     server" states instead of the browser's error page;
//   - /assets/* (Vite's content-hashed JS/CSS): cache first — a hashed
//     file never changes, a new build has new names;
//   - everything else — the API, Socket.IO, file downloads, anything
//     cross-origin — is left alone (passed straight to the network).
// Registered from src/lib/pwa.ts in production builds only.

const SHELL_CACHE = "wellsure-shell-v1";
const ASSET_CACHE = "wellsure-assets-v1";
const SHELL = ["/index.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // the API and anything else cross-origin

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Keep the freshest shell for offline use.
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put("/index.html", copy));
          }
          return response;
        })
        .catch(() => caches.match("/index.html").then((cached) => cached || new Response("You're offline.", { status: 503, headers: { "Content-Type": "text/plain" } }))),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
  // Anything else same-origin (icons, manifest): default network behaviour.
});
