// Capy Service Worker - Offline PWA Caching Engine
// Isolates caches by both semantic version and normalized deployment scope path.

const SW_BUILD_VERSION = '3.0.10';
const EFFECTIVE_VERSION = SW_BUILD_VERSION.startsWith('__CAPY_') ? 'dev' : SW_BUILD_VERSION;
const BUILD_ASSET_RELATIVE_URLS = ["./assets/ColorPickerPopover-C_bkz6s0.js","./assets/index-BEb1edyV.css","./assets/index-BUVPE5Ub.js","./assets/puzzle.worker-C0niZBe4.js","./assets/SettingsModal-HWAmDjI0.js","./assets/vendor-CAH2-Xdv.js","./assets/vendor-ui-DjR4Wcgs.js"];

function normalizeScopePath(rawPathname) {
  if (!rawPathname) return '/';
  const withLeading = rawPathname.startsWith('/') ? rawPathname : `/${rawPathname}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

const SCOPE_URL =
  (self.registration && self.registration.scope) || new URL('./', self.location.href).href;
const SCOPE_PATH = normalizeScopePath(new URL(SCOPE_URL).pathname);
const CACHE_NAME = `capy-cache-v${EFFECTIVE_VERSION}:${SCOPE_PATH}`;

function shouldEvictCacheKey(key) {
  if (key === CACHE_NAME) return false;
  if (key === 'capy-cache-v2') return true;
  if (!key.startsWith('capy-cache-v')) return false;
  const colonIdx = key.indexOf(':');
  if (colonIdx === -1) return false;
  return key.slice(colonIdx + 1) === SCOPE_PATH;
}

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

// Helper to resolve URLs relative to the service worker registration scope
function getAbsolutePrecacheUrls() {
  const combined = Array.from(new Set([...PRECACHE_RELATIVE_URLS, ...BUILD_ASSET_RELATIVE_URLS]));
  return combined.map((rel) => new URL(rel, SCOPE_URL).href);
}

// Installation: pre-cache application shell, sample assets, and build-stamped chunks
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const urlsToCache = getAbsolutePrecacheUrls();
      const indexUrlHref = new URL('./index.html', SCOPE_URL).href;

      await Promise.allSettled(
        urlsToCache.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'no-cache' });
            if (response.ok) {
              await cache.put(url, response.clone());

              // Unstamped dev fallback: discover script & style bundles from index.html
              if (
                BUILD_ASSET_RELATIVE_URLS.length === 0 &&
                (url.endsWith('/index.html') || url === indexUrlHref)
              ) {
                const htmlText = await response.text();
                const bundleMatches = [
                  ...htmlText.matchAll(/(?:src|href)=["']?((?:\.\/)?assets\/[^"'\s>]+)["']?/g),
                ];

                for (const match of bundleMatches) {
                  const relPath = match[1].startsWith('./') ? match[1] : './' + match[1];
                  const bundleUrl = new URL(relPath, SCOPE_URL).href;
                  try {
                    const bundleResp = await fetch(bundleUrl, { cache: 'no-cache' });
                    if (bundleResp.ok) {
                      await cache.put(bundleUrl, bundleResp.clone());

                      if (bundleUrl.endsWith('.js')) {
                        const jsText = await bundleResp.text();
                        const workerMatches = [
                          ...jsText.matchAll(/assets\/(puzzle\.worker-[^"'\s)]+\.js)/g),
                        ];
                        for (const wm of workerMatches) {
                          const workerUrl = new URL('./assets/' + wm[1], SCOPE_URL).href;
                          const workerResp = await fetch(workerUrl, { cache: 'no-cache' });
                          if (workerResp.ok) {
                            await cache.put(workerUrl, workerResp);
                          }
                        }
                      }
                    }
                  } catch (bundleErr) {
                    console.warn(
                      '[ServiceWorker] Failed to cache discovered bundle:',
                      bundleUrl,
                      bundleErr
                    );
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

// Activation: purge older cache generations for this scope only (preserving sibling channels)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheKeys = await caches.keys();
      await Promise.all(
        cacheKeys.map((key) => {
          if (shouldEvictCacheKey(key)) {
            return caches.delete(key);
          }
          return undefined;
        })
      );
      await self.clients.claim();
    })()
  );
});

// Fetch: Strategy depending on request type (strictly same-origin non-API, non-APK assets)
self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!url.protocol.startsWith('http')) return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return;
  if (url.pathname.toLowerCase().endsWith('.apk')) return;

  // 1. Navigation requests (HTML document): Network-first with scoped cache fallback
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
          const cache = await caches.open(CACHE_NAME);
          const cachedResponse =
            (await cache.match(request, { ignoreSearch: true })) ||
            (await cache.match(new URL('./index.html', SCOPE_URL).href, { ignoreSearch: true })) ||
            (await cache.match(new URL('./', SCOPE_URL).href, { ignoreSearch: true }));
          if (cachedResponse) {
            return cachedResponse;
          }
          throw networkError;
        }
      })()
    );
    return;
  }

  // 2. Same-origin static assets & workers (JS, CSS, images, workers): Cache-first with network fallback
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
        if (response && response.status === 200) {
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
