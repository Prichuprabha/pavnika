// Service worker for the saree lookup tool.
//
// Two jobs: browsers require a service worker before offering to
// "install" a site as an app, and caching the page's files means the
// tool still works on a weak shop-floor connection.
//
// Bump CACHE_NAME whenever scan.html, the product data, or the
// scanner library changes — otherwise phones keep serving the old
// cached copy, exactly the stale-cache problem seen with admin.js.
const CACHE_NAME = 'pavnika-scan-v1';

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

  // Network-first: always prefer fresh data (product prices and stock
  // change), falling back to the cache only when offline. A
  // cache-first strategy would risk showing stale prices, which
  // matters more here than a slightly slower load.
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
