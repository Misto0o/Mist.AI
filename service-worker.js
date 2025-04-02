const CACHE_NAME = 'mistai-cache-v3';  // Increment this version when you deploy a new version of your app

// On install, cache the necessary files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/index.html',
        '/styles.css', // Include all assets you want cached
        '/themes.css', // Include all assets you want cached
        '/script.js',   // Include JS files
        '/mistaifaviocn/android-chrome-192x192.png', // Icons, etc.
        '/mistaifaviocn/android-chrome-512x512.png'
      ]);
    })
  );
});

// On fetch, serve from cache or fetch from network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});

// On activation, delete old caches that are no longer needed
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME]; // Keep only the current cache version

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // If cache name is not in the whitelist, delete it
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);  // Deleting old cache
          }
        })
      );
    })
  );
});
