// Capy Service Worker - Offline PWA Caching Engine
// Respects relative subpath hosting across GitHub Pages root, PR previews, and local dev.

const CACHE_NAME = 'capy-cache-v1';

const PRECACHE_RELATIVE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/sample_saves.capy',
  './assets/capybara.webp',
  './assets/capy_forest.webp',
  './assets/mushrooms.webp',
  './assets/snail_guitar.webp',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png',
];

// Helper to resolve URLs relative to the service worker script location
function getAbsolutePrecacheUrls() {
  return PRECACHE_RELATIVE_URLS.map((rel) => new URL(rel, self.location).href);
}

// Installation: pre-cache application shell, sample assets, and discovered production bundles
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const urlsToCache = getAbsolutePrecacheUrls();

      await Promise.allSettled(
        urlsToCache.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'no-cache' });
            if (response.ok) {
              await cache.put(url, response.clone());

              // If this is index.html, discover and precache hashed Vite script & style bundles
              if (url.endsWith('/index.html') || url === new URL('./index.html', self.location).href) {
                const htmlText = await response.text();
                const bundleMatches = [...htmlText.matchAll(/(?:src|href)=["']?((?:\.\/)?assets\/[^"'\s>]+)["']?/g)];

                for (const match of bundleMatches) {
                  const relPath = match[1].startsWith('./') ? match[1] : './' + match[1];
                  const bundleUrl = new URL(relPath, self.location).href;
                  try {
                    const bundleResp = await fetch(bundleUrl, { cache: 'no-cache' });
                    if (bundleResp.ok) {
                      await cache.put(bundleUrl, bundleResp.clone());

                      // If this is the main JS bundle, discover and precache Web Worker script
                      if (bundleUrl.endsWith('.js')) {
                        const jsText = await bundleResp.text();
                        const workerMatches = [...jsText.matchAll(/assets\/(puzzle\.worker-[^"'\s)]+\.js)/g)];
                        for (const wm of workerMatches) {
                          const workerUrl = new URL('./assets/' + wm[1], self.location).href;
                          const workerResp = await fetch(workerUrl, { cache: 'no-cache' });
                          if (workerResp.ok) {
                            await cache.put(workerUrl, workerResp);
                          }
                        }
                      }
                    }
                  } catch (bundleErr) {
                    console.warn('[ServiceWorker] Failed to cache discovered bundle:', bundleUrl, bundleErr);
                  }
                }
              }
            }
          } catch (err) {
            console.warn('[ServiceWorker] Failed to pre-cache:', url, err);
          }
        })
      );

      await self.skipWaiting();
    })()
  );
});

// Activation: purge older cache generations and claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheKeys = await caches.keys();
      await Promise.all(
        cacheKeys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
      await self.clients.claim();
    })()
  );
});

// Fetch: Strategy depending on request type
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only handle GET requests with http/https schemes
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!url.protocol.startsWith('http')) return;

  // 1. Navigation requests (HTML document): Network-first with cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.status === 200) {
            try {
              const cache = await caches.open(CACHE_NAME);
              await cache.put(request, networkResponse.clone());
            } catch (cacheErr) {
              console.warn('[ServiceWorker] Failed to cache navigation response:', cacheErr);
            }
          }
          return networkResponse;
        } catch (networkError) {
          // Offline navigation fallback: try matching the requested URL, or fallback to index.html
          const cachedResponse =
            (await caches.match(request, { ignoreSearch: true })) ||
            (await caches.match(new URL('./index.html', self.location).href, { ignoreSearch: true })) ||
            (await caches.match(new URL('./', self.location).href, { ignoreSearch: true }));
          if (cachedResponse) {
            return cachedResponse;
          }
          throw networkError;
        }
      })()
    );
    return;
  }

  // 2. Static assets & workers (JS, CSS, images, workers): Cache-first with network fallback & dynamic cache population
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached =
        (await cache.match(request, { ignoreSearch: true })) ||
        (await cache.match(request.url, { ignoreSearch: true }));
      if (cached) {
        return cached;
      }

      try {
        const response = await fetch(request);
        // Cache valid responses within our origin or opaque no-cors responses
        if (response && (response.status === 200 || response.type === 'opaque')) {
          try {
            await cache.put(request, response.clone());
          } catch (cacheErr) {
            console.warn('[ServiceWorker] Failed to cache asset response:', request.url, cacheErr);
          }
        }
        return response;
      } catch (err) {
        const fallback = await cache.match(request.url, { ignoreSearch: true });
        if (fallback) return fallback;
        throw err;
      }
    })()
  );
});

// Handle skip waiting messages from client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
