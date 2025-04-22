const CACHE_NAME = 'mistai-cache-v21';  // Increment this on every deploy

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/themes.css',
  '/script.js',
  '/mistaifaviocn/android-chrome-192x192.png',
  '/mistaifaviocn/android-chrome-512x512.png'
];

// Install event: cache core files
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing and caching app shell…');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting(); // Immediately activate new service worker
});

// Activate event: clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating and cleaning up old caches...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', name);
            return caches.delete(name);
          }
        })
      );
    })
  );
  self.clients.claim(); // Start controlling any open pages
});

// Fetch event: serve from cache first, then network
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          return networkResponse;
        })
        .catch((error) => {
          console.warn('[Service Worker] Fetch failed:', event.request.url, error);
          // Optional: you could return a fallback page or image here
        });
    })
  );
});
