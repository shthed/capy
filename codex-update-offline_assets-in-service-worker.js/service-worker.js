const RUNTIME_CACHE_NAME = 'capy-offline-cache-v2';
const OFFLINE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './runtime.js',
  './render.js',
  './render-canvas2d.js',
  './render-webgl.js',
  './render-svg.js',
  './puzzle-generation.js',
  './capy.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(RUNTIME_CACHE_NAME)
      .then((cache) => cache.addAll(OFFLINE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== RUNTIME_CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin && !url.href.startsWith('https://capy.local/')) {
    return;
  }
  event.respondWith(
    caches.open(RUNTIME_CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) {
        return cached;
      }
      try {
        const response = await fetch(request.clone());
        if (response && response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      } catch (_error) {
        return cached;
      }
    })
  );
});
