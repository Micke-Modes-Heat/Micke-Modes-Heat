// Service Worker der Feldapp.
//
// Zwei Auslieferungen nutzen diese Datei:
//   • field-app/ direkt (Entwicklung): so wie sie hier steht.
//   • dist/feldapp-sw.js (Netlify / GitHub Pages): build-feldapp.mjs ersetzt
//     VERSION und SHELL. Die Einzeldatei feldapp.html bringt Leaflet und JSZip
//     schon mit, die Shell besteht dort nur aus eigenen Dateien.
//
// Der Service Worker wird mit scope './feldapp' registriert und fasst die
// Hauptapp (index.html) im selben Ordner deshalb nicht an.

const VERSION = '221e07de0896';
const SHELL = [
  "./feldapp.html",
  "./feldapp.webmanifest",
  "./feldapp-icon-192.png",
  "./feldapp-icon-512.png"
];

const CACHE_APP   = 'feldapp-app-' + VERSION;
const CACHE_TILES = 'feldapp-tiles-v1';          // wird auch von cacheTiles() befüllt
const START = new URL(SHELL[0], self.location).href;

self.addEventListener('install', e => {
  // Jede Datei einzeln: eine vorübergehend fehlende Nebendatei darf die
  // Installation nicht scheitern lassen — die App-Seite selbst schon.
  e.waitUntil(caches.open(CACHE_APP).then(c =>
    Promise.all(SHELL.map(url => c.add(new Request(url, { cache: 'reload' })).catch(err => {
      if (url === SHELL[0]) throw err;
    })))
  ));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith('feldapp-') && k !== CACHE_APP && k !== CACHE_TILES)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;

  // App-Seite: Netz zuerst (neue Versionen kommen sofort an), im Funkloch
  // die zuletzt geladene Fassung aus dem Cache.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_APP).then(c => c.put(START, copy));
        }
        return res;
      }).catch(async () => (await caches.match(START)) || (await caches.match(req)) || Response.error())
    );
    return;
  }

  // Kartenkacheln: Cache zuerst, sonst Netz (und merken)
  if (url.includes('.tile.openstreetmap.org/')) {
    e.respondWith(
      caches.open(CACHE_TILES).then(async cache => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          return new Response('', { status: 504, statusText: 'offline' });
        }
      })
    );
    return;
  }

  // Übrige Dateien der Shell (Manifest, Icons, Logo, CDN in der Entwicklung)
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).catch(() => new Response('', { status: 504, statusText: 'offline' })))
  );
});
