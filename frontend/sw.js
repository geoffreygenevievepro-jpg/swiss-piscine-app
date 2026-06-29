// Service worker — coquille hors-ligne (app shell). La file de synchro des
// actions terrain (pointage, rapports) sera ajoutée au Sprint 2.
const CACHE = "sp-app-shell-v74";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./js/app.js",
  "./js/theme.js",
  "./js/banner.js",
  "./js/config.js",
  "./js/store.js",
  "./js/util.js",
  "./js/outbox.js",
  "./js/api.js",
  "./js/icons.js",
  "./js/sheet.js",
  "./js/vendor/qrcode.js",
  "./js/screens/twofa.js",
  "./js/screens/ccnt.js",
  "./js/screens/login.js",
  "./js/screens/accueil.js",
  "./js/screens/chrono.js",
  "./js/screens/terrain.js",
  "./js/screens/report.js",
  "./js/screens/pointer.js",
  "./js/screens/conges.js",
  "./js/screens/notesfrais.js",
  "./js/screens/documents.js",
  "./js/screens/contacts.js",
  "./js/screens/factures.js",
  "./js/screens/moi.js",
  "./js/screens/admin.js",
  "./js/screens/semaine.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // En dev (localhost), on ne touche jamais au cache : on sert toujours le fichier
  // frais pour éviter de débugger une version périmée.
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return;
  // Ne jamais mettre en cache les appels API (auth, données) : réseau direct.
  if (e.request.method !== "GET" || url.pathname.startsWith("/api") || url.port === "8000") {
    return;
  }
  // App shell : cache d'abord, réseau en repli.
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
