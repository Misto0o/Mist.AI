const CACHE_NAME = 'mistai-cache-v8';  // Increment on deploy

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/themes.css',
  '/script.js',
  '/mistaifaviocn/favicon.ico',
  '/mistaifaviocn/favicon-32x32.png',
  '/mistaifaviocn/android-chrome-192x192.png'
];

// Install: cache core files
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing and caching app shell…');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();  // Activate immediately
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating and cleaning up old caches...');
  event.waitUntil(
    caches.keys().then(cacheNames => Promise.all(
      cacheNames.map(name => {
        if (name !== CACHE_NAME) {
          console.log('[Service Worker] Deleting old cache:', name);
          return caches.delete(name);
        }
      })
    ))
  );
  self.clients.claim(); // Take control of all clients immediately
});

// Fetch: cache-first with network update
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        // Update cache in the background
        event.waitUntil(
          fetch(event.request).then(networkResponse => {
            return caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, networkResponse.clone());
            });
          }).catch(() => {
            // Ignore fetch errors here
          })
        );
        // Return cached response immediately
        return cachedResponse;
      }

      // No cached response — fetch from network and cache it
      return fetch(event.request)
        .then(networkResponse => {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        })
        .catch(() => {
          // Offline fallback for navigation requests (e.g. when user reloads page offline)
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
    })
  );
});
