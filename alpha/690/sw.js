// Capy Service Worker - Offline PWA Caching Engine
// Isolates caches by both semantic version and normalized deployment scope path.

const SW_BUILD_VERSION = '3.1.6';
const SW_ASSETS_DIGEST = 'f89c04b54106ef9e';
const EFFECTIVE_VERSION = SW_BUILD_VERSION.startsWith('__CAPY_') ? 'dev' : SW_BUILD_VERSION;
const BUILD_ASSET_RELATIVE_URLS = ["./assets/ColorPickerPopover-CMQsHiAp.js","./assets/PuzzleGenerator-BNreh7l0.js","./assets/SettingsModal-CklNeI8q.js","./assets/base64-RaP0JZyq.js","./assets/index-C28Lm6Pw.js","./assets/index-D7MpndRi.css","./assets/puzzle.worker-B4-4rkzV.js","./assets/rolldown-runtime-WkwZ5CU-.js","./assets/vendor-DctBZRDK.js","./assets/vendor-ui-Bs1mt7mI.js"];

function normalizeScopePath(rawPathname) {
  if (!rawPathname) return '/';
  const withLeading = rawPathname.startsWith('/') ? rawPathname : `/${rawPathname}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

const SCOPE_URL =
  (self.registration && self.registration.scope) || new URL('./', self.location.href).href;
const SCOPE_PATH = normalizeScopePath(new URL(SCOPE_URL).pathname);
const CACHE_NAME = `capy-cache-v${EFFECTIVE_VERSION}:${SCOPE_PATH}`;

function isAlphaPreviewScopePath(scopePath) {
  return /\/(?:alpha|PR|pull)\/[^/]+\//i.test(scopePath);
}

function shouldEvictCacheKey(key) {
  if (key === CACHE_NAME) return false;
  if (key === 'capy-cache-v2') return true;
  if (!key.startsWith('capy-cache-v')) return false;
  const colonIdx = key.indexOf(':');
  if (colonIdx === -1) return false;
  const keyScope = normalizeScopePath(key.slice(colonIdx + 1));
  if (keyScope === SCOPE_PATH) return true;
  return isAlphaPreviewScopePath(keyScope);
}

const PRECACHE_RELATIVE_URLS = [
  './',
  './index.html',
  './favicon.ico',
  './privacy-policy.html',
  './manifest.webmanifest',
  './assets/sample_saves.capy',
  './assets/capybara.webp',
  './assets/capy_forest.webp',
  './assets/mushrooms.webp',
  './assets/snail_guitar.webp',
  './assets/icon-192.png',
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

// Activation: purge older cache generations for this scope and stale alpha/PR/pull preview caches (preserving sibling Production/Beta channels)
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

function isHtmlContentType(response) {
  const ct = (response.headers.get('content-type') || '').toLowerCase();
  return ct.includes('text/html');
}

function isCacheableAssetResponse(request, response) {
  if (!response || !response.ok) return false;
  if (response.redirected) return false;
  if (response.type && response.type !== 'basic') return false;
  if (request.mode !== 'navigate' && isHtmlContentType(response)) {
    const pathname = new URL(request.url).pathname.toLowerCase();
    if (!pathname.endsWith('.html') && !pathname.endsWith('/')) {
      return false;
    }
  }
  return true;
}

const SCOPE_NO_SLASH = SCOPE_PATH.length > 1 && SCOPE_PATH.endsWith('/')
  ? SCOPE_PATH.slice(0, -1)
  : SCOPE_PATH;

function isWithinSwScope(pathname) {
  return pathname === SCOPE_NO_SLASH || pathname.startsWith(SCOPE_PATH);
}

// Fetch: Strategy depending on request type (strictly same-origin scoped non-API, non-APK assets)
self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  if (request.headers && request.headers.has('range')) return;
  const url = new URL(request.url);
  if (!url.protocol.startsWith('http')) return;
  if (url.origin !== self.location.origin) return;
  if (!isWithinSwScope(url.pathname)) return;
  if (url.pathname.includes('/api/')) return;
  if (url.pathname.includes('/.well-known/')) return;
  if (url.pathname.toLowerCase().endsWith('.apk')) return;

  // 1. Navigation requests (HTML document): Network-first with standalone static HTML isolation
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const canonicalIndexUrl = new URL('./index.html', SCOPE_URL).href;
        const scopeRootUrl = new URL('./', SCOPE_URL).href;
        const canonicalIndexPath = new URL(canonicalIndexUrl).pathname;
        const navLowerPath = url.pathname.toLowerCase();
        const isStandaloneHtmlDoc =
          navLowerPath.endsWith('.html') && url.pathname !== canonicalIndexPath;
        try {
          const networkResponse = await fetch(request);
          if (
            networkResponse &&
            networkResponse.ok &&
            !networkResponse.redirected &&
            (!networkResponse.type || networkResponse.type === 'basic') &&
            isHtmlContentType(networkResponse)
          ) {
            try {
              const cache = await caches.open(CACHE_NAME);
              if (isStandaloneHtmlDoc) {
                await cache.put(request, networkResponse.clone());
              } else {
                await Promise.all([
                  cache.put(canonicalIndexUrl, networkResponse.clone()),
                  cache.put(scopeRootUrl, networkResponse.clone()),
                ]);
              }
            } catch (cacheErr) {
              console.warn('[ServiceWorker] Failed to cache navigation response:', cacheErr);
            }
          }
          return networkResponse;
        } catch {
          const cache = await caches.open(CACHE_NAME);
          if (isStandaloneHtmlDoc) {
            const exactStandalone =
              (await cache.match(request)) ||
              (await cache.match(request.url)) ||
              (await cache.match(`${url.origin}${url.pathname}`));
            return exactStandalone || Response.error();
          }
          const cachedResponse =
            (await cache.match(canonicalIndexUrl)) ||
            (await cache.match(scopeRootUrl)) ||
            (await cache.match(request)) ||
            (await cache.match(request.url)) ||
            (await cache.match('./'));
          if (cachedResponse) {
            return cachedResponse;
          }
          return Response.error();
        }
      })()
    );
    return;
  }

  const lowerPath = url.pathname.toLowerCase();

  // 2. Mutable .capy pack files: Network-first (respecting exact query string) with offline cache fallback
  if (lowerPath.endsWith('.capy')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const response = await fetch(request, { cache: 'no-cache' });
          if (isCacheableAssetResponse(request, response)) {
            try {
              await cache.put(request, response.clone());
            } catch (cacheErr) {
              console.warn('[ServiceWorker] Failed to cache .capy response:', request.url, cacheErr);
            }
            return response;
          }
          if (!response || !response.ok) {
            const cachedFallback =
              (await cache.match(request)) ||
              (await cache.match(request.url));
            if (cachedFallback && !isHtmlContentType(cachedFallback)) {
              return cachedFallback;
            }
          }
          return response;
        } catch (err) {
          const cached =
            (await cache.match(request)) ||
            (await cache.match(request.url));
          if (cached && !isHtmlContentType(cached)) {
            return cached;
          }
          throw err;
        }
      })()
    );
    return;
  }

  // 3. Mutable JSON, manifests & static HTML docs: Stale-While-Revalidate with exact query key
  if (
    lowerPath.endsWith('.webmanifest') ||
    lowerPath.endsWith('.json') ||
    lowerPath.endsWith('.html')
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = (await cache.match(request)) || (await cache.match(request.url));
        const networkPromise = fetch(request, { cache: 'no-cache' }).then(async (response) => {
          if (isCacheableAssetResponse(request, response)) {
            try {
              await cache.put(request, response.clone());
            } catch (cacheErr) {
              console.warn('[ServiceWorker] Failed to revalidate asset:', request.url, cacheErr);
            }
          }
          return response;
        });

        if (cached && (lowerPath.endsWith('.html') || !isHtmlContentType(cached))) {
          event.waitUntil(networkPromise.catch(() => undefined));
          return cached;
        }
        return await networkPromise;
      })()
    );
    return;
  }

  // 4. Hashed static assets & images (JS, CSS, images, workers): Cache-first with query isolation & HTML-fallback rejection
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached =
        (await cache.match(request)) ||
        (await cache.match(request.url));
      if (cached && !isHtmlContentType(cached)) {
        return cached;
      }

      try {
        const response = await fetch(request);
        if (isCacheableAssetResponse(request, response)) {
          try {
            await cache.put(request, response.clone());
          } catch (cacheErr) {
            console.warn('[ServiceWorker] Failed to cache asset response:', request.url, cacheErr);
          }
        }
        return response;
      } catch (err) {
        const fallback =
          (await cache.match(request)) ||
          (await cache.match(request.url));
        if (fallback && !isHtmlContentType(fallback)) return fallback;
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
