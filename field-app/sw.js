const CACHE_APP   = 'feldapp-v6';
const CACHE_TILES = 'feldapp-tiles-v1';

const PRECACHE = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
];

self.addEventListener('install', e => {
  // Jede Ressource einzeln: ein vorübergehend nicht erreichbares CDN darf die
  // Installation der lokalen Offline-Shell nicht komplett scheitern lassen.
  e.waitUntil(caches.open(CACHE_APP).then(c =>
    Promise.all(PRECACHE.map(url => c.add(url).catch(err => {
      if (url === './index.html') throw err;
    })))
  ));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_APP && k !== CACHE_TILES).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  if (url.startsWith('chrome-extension')) return;

  // HTML: Network-First, bei Funkloch garantiert die vorinstallierte Shell.
  if (url.endsWith('/') || url.includes('index.html')) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE_APP).then(c => c.put('./index.html', res.clone()));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // OSM-Kacheln: Cache-First
  if (url.includes('.tile.openstreetmap.org')) {
    e.respondWith(
      caches.open(CACHE_TILES).then(async cache => {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        try {
          const res = await fetch(e.request);
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        } catch { return new Response('', { status: 503 }); }
      })
    );
    return;
  }

  // CDN-Bibliotheken: Cache-First
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok && (url.includes('unpkg.com') || url.includes('cdnjs') || url.includes('icon-'))) {
          caches.open(CACHE_APP).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => cached || new Response('', { status: 503 }));
    })
  );
});
