// 🔥 Update this every deploy
const VERSION = 'v10';
const CACHE_NAME = `mistai-cache-${VERSION}`;
const ASSETS_TO_CACHE = [
  '/',
  `/index.html?v=${VERSION}`,
  `/styles.css?v=${VERSION}`,
  `/themes.css?v=${VERSION}`,
  `/script.js?v=${VERSION}`,
  '/mistaifaviocn/favicon.ico',
  '/mistaifaviocn/favicon-32x32.png',
  '/mistaifaviocn/android-chrome-192x192.png'
];

// =====================
// INSTALL
// =====================
self.addEventListener('install', (event) => {
  console.log(`[SW] Installing ${VERSION}...`);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

// =====================
// ACTIVATE - NUKE ALL OLD CACHES
// =====================
self.addEventListener('activate', (event) => {
  console.log(`[SW] Activating ${VERSION} - nuking old caches...`);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => {
        console.log(`[SW] Deleting cache: ${key}`);
        return caches.delete(key);
      }))
    ).then(() => caches.open(CACHE_NAME))
      .then(() => self.clients.claim())
  );
});

// =====================
// FETCH - network first, cache fallback
// =====================
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(
    fetch(event.request)
      .then(async networkRes => {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, networkRes.clone());
        return networkRes;
      })
      .catch(() => caches.match(event.request))
  );
});

// =====================
// NOTIFICATION CLICK
// =====================
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientsArr => {
      for (const client of clientsArr) {
        if (client.url === urlToOpen && 'focus' in client) return client.focus();
      }
      return clients.openWindow(urlToOpen);
    })
  );
});

// =====================
// MESSAGE - handle notification requests from page
// =====================
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SHOW_NOTIFICATION') {
    self.registration.showNotification(event.data.title, {
      body: event.data.body,
      icon: '/mistaifaviocn/android-chrome-192x192.png'
    });
  }
});