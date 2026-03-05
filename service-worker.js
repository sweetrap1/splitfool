const CACHE_NAME = 'splitfool-cache-v8';
const urlsToCache = []; // Disabled for development

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll([]);
            })
    );
});

self.addEventListener('fetch', event => {
    // Development mode: Bypass cache entirely to avoid stale ES modules
    event.respondWith(fetch(event.request));
});

self.addEventListener('activate', event => {
    event.waitUntil(clients.claim());
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});
