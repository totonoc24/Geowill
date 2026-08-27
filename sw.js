const CACHE_NAME = 'geoplan-v1.0.0';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/leaflet.css',
  './css/styles.css',
  './js/libs/leaflet.js',
  './js/libs/pdf.min.js',
  './js/libs/pdf.worker.min.js',
  './js/storage-db.js',
  './js/georef-engine.js',
  './js/pdf-loader.js',
  './js/gps-tracker.js',
  './js/vector-editor.js',
  './js/kml-exporter.js',
  './js/map-engine.js',
  './js/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Caching app shell');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Offline-first strategy for local assets, network-first for external tiles
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        // Cache tile responses dynamically if needed
        if (event.request.url.includes('tile') && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open('geoplan-tiles-cache').then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Return fallback if offline
        return cachedResponse;
      });
    })
  );
});
