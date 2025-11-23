importScripts('./service-worker-cache.cjs');

const RUNTIME_CACHE_NAME = 'capy-offline-cache-v3';
const CACHE_LIMITS = {
  metadataKey: '__capy-cache-metadata__',
  maxEntries: 80,
  maxBytes: 25 * 1024 * 1024,
  maxUploadBytes: 6 * 1024 * 1024,
};
const OFFLINE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './runtime.js',
  './render.js',
  './puzzle-generation.js',
  './capy.json',
];

async function broadcastSwEvent(eventName, details = {}) {
  if (!eventName) return null;
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const payload = {
      type: 'capy-sw',
      event: eventName,
      details,
      timestamp: Date.now(),
    };
    clients.forEach((client) => client.postMessage(payload));
    return payload;
  } catch (_error) {
    return null;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(RUNTIME_CACHE_NAME)
      .then((cache) =>
        cache
          .addAll(OFFLINE_ASSETS)
          .then(() => CapyCacheLimits.rebuildMetadata(cache, CACHE_LIMITS.metadataKey))
      )
      .then(() => broadcastSwEvent('install-complete', { cacheName: RUNTIME_CACHE_NAME, assetsCached: OFFLINE_ASSETS.length }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        const staleKeys = keys.filter((key) => key !== RUNTIME_CACHE_NAME);
        return Promise.all(staleKeys.map((key) => caches.delete(key))).then(() => staleKeys);
      })
      .then((staleKeys) =>
        broadcastSwEvent('activate-complete', {
          cacheName: RUNTIME_CACHE_NAME,
          deletedCaches: staleKeys,
        })
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
        await CapyCacheLimits.touchEntry(cache, request, CACHE_LIMITS.metadataKey);
        return cached;
      }
      try {
        const response = await fetch(request.clone());
        if (response && response.ok) {
          const result = await CapyCacheLimits.putWithLimits(cache, request, response.clone(), CACHE_LIMITS);
          if (!result?.cached && result?.reason) {
            broadcastSwEvent('cache-skip', {
              cacheName: RUNTIME_CACHE_NAME,
              reason: result.reason,
              url: request.url,
            });
          }
        }
        return response;
      } catch (_error) {
        return cached;
      }
    })
  );
});
