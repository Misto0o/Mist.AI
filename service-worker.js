self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('mistai-cache').then((cache) => {
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

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = ['mistai-cache']; // Update cache name when you deploy a new version

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});