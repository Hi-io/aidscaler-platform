const CACHE = "nexo-shell-v10";
const ASSETS = [
  "/",
  "/styles.css",
  "/fonts.css",
  "/app.mjs",
  "/offline.mjs",
  "/icons.mjs",
  "/map.mjs",
  "/extras.mjs",
  "/operational.mjs",
  "/finance.mjs",
  "/workforce.mjs",
  "/uploads.mjs",
  "/publications.mjs",
  "/casework.mjs",
  "/organization.mjs",
  "/response.mjs",
  "/mark.svg",
];
self.addEventListener("install", (e) =>
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (e) =>
  e.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((k) => k.startsWith("nexo-shell-") && k !== CACHE)
              .map((k) => caches.delete(k)),
          ),
        ),
    ]),
  ),
);
self.addEventListener("fetch", (e) => {
  if (
    e.request.method !== "GET" ||
    new URL(e.request.url).origin !== self.location.origin ||
    new URL(e.request.url).pathname.startsWith("/api/")
  )
    return;
  e.respondWith(
    fetch(e.request)
      .then(async (r) => {
        if (r.ok && ASSETS.includes(new URL(e.request.url).pathname))
          await (await caches.open(CACHE)).put(e.request, r.clone());
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r ?? caches.match("/"))),
  );
});
