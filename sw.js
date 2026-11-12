const CACHE_NAME = "tax-packet-shell-v25";
const CACHE_PREFIX = "tax-packet-shell-";
const APP_SHELL = [
  "./formal.html",
  "./rules/graph.json",
  "./pricing.json",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon.svg",
];

function shellUrls() {
  return APP_SHELL.map((path) => new URL(path, self.registration.scope).href);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const shell = shellUrls();
  const appDocument = shell[0];

  if (request.mode === "navigate") {
    if (url.pathname !== new URL(appDocument).pathname) return;
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(appDocument, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(appDocument)) || Response.error())
    );
    return;
  }

  if (!shell.includes(url.href)) return;
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }))
  );
});
