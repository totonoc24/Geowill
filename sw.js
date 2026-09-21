const CACHE_NAME = 'geowill-v2.2.5';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './tutorial_herramientas.html',
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
  './js/collar-cordero-data.js',
  './js/vector-editor.js',
  './js/kml-exporter.js',
  './js/kml-importer.js',
  './js/navigation-stakeout.js',
  './js/map-engine.js',
  './js/app.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Caching app shell v2.2.4');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME && key !== 'geoplan-tiles-cache') {
            console.log('[ServiceWorker] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Network-First for core application files (HTML, JS, CSS) so updates appear immediately
  const isCoreAsset = event.request.mode === 'navigate' ||
                      requestUrl.pathname.endsWith('.html') ||
                      requestUrl.pathname.endsWith('.js') ||
                      requestUrl.pathname.endsWith('.css') ||
                      requestUrl.pathname.endsWith('.json');

  if (isCoreAsset) {
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        return caches.match(event.request);
      })
    );
    return;
  }

  // Cache-First for tiles, fonts and media
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (event.request.url.includes('tile') && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open('geoplan-tiles-cache').then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        return cachedResponse;
      });
    })
  );
});
