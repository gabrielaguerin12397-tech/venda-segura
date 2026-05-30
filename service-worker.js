const CACHE_NAME = "venda-segura-v26";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css?v=26",
  "/app.js?v=26",
  "/config.js?v=26",
  "/manifest.webmanifest?v=26",
  "/como-funciona",
  "/demonstracao",
  "/planos",
  "/seguranca",
  "/teste-gratis",
  "/cadastro",
  "/login",
  "/termos.html",
  "/privacidade.html",
  "/icons/favicon.svg?v=16",
  "/icons/favicon.png?v=16",
  "/icons/icon-192.png?v=16",
  "/icons/icon-512.png?v=16",
  "/icons/icon-192.svg?v=16",
  "/icons/icon-512.svg?v=16",
  "/icons/screenshot-wide.png",
  "/icons/screenshot-mobile.png",
  "/ads-images/anuncio-revendedora-celular.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.hostname.includes("supabase.co")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/index.html")));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request)),
    );
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
