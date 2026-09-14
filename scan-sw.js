// Service worker for the saree lookup tool.
//
// Two jobs: browsers require a service worker before offering to
// "install" a site as an app, and caching the page's files means the
// tool still works on a weak shop-floor connection.
//
// Bump CACHE_NAME whenever scan.html, the product data, or the
// scanner library changes — otherwise phones keep serving the old
// cached copy, exactly the stale-cache problem seen with admin.js.
const CACHE_NAME = 'pavnika-scan-v4';

const ASSETS = [
  '/scan.html',
  '/zxing.min.js',
  '/products-data.js',
  '/assets/maroonlogo.png',
  '/assets/scan-icon-192.png',
  '/assets/scan-icon-512.png',
  '/scan-manifest.json'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  // Remove caches from older versions so a bumped CACHE_NAME actually
  // takes effect rather than piling up stale copies.
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        if (name !== CACHE_NAME) return caches.delete(name);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  // Saree photos get their own strategy: cache-first, refreshed in the
  // background. A photo essentially never changes once uploaded, so
  // there's no freshness reason to make every scan wait on the network
  // for it — and the old network-first rule never even cached these in
  // the first place, since they're hosted on a different origin (Google
  // Cloud Storage) and a cross-origin response comes back as
  // 'opaque'/'cors', not 'basic', so it silently failed the old
  // `response.type === 'basic'` check every single time. That's what
  // turned "beep" into "beep, then a pause" on every scan — including
  // scanning the exact same saree twice in a row.
  if (event.request.destination === 'image') {
    event.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(event.request).then(function (cached) {
          var network = fetch(event.request).then(function (response) {
            // Opaque cross-origin responses always report status 0 (the
            // browser hides the real status for privacy), so they'd
            // never pass a `status === 200` check — caching them
            // anyway is safe and is the whole point of this branch.
            if (response && (response.status === 200 || response.type === 'opaque')) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(function () { return cached; });
          return cached || network;
        });
      })
    );
    return;
  }

  // Network-first for everything else (the page, the scanner library,
  // product data): prices and stock status change, so freshness matters
  // more here than for a photo — falls back to the cache only when offline.
  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, copy);
          });
        }
        return response;
      })
      .catch(function () {
        return caches.match(event.request).then(function (cached) {
          return cached || caches.match('/scan.html');
        });
      })
  );
});
