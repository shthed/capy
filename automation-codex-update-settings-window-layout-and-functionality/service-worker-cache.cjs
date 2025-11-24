const DEFAULT_CACHE_LIMITS = {
  metadataKey: '__capy-cache-metadata__',
  maxEntries: 60,
  maxBytes: 20 * 1024 * 1024,
  maxUploadBytes: 5 * 1024 * 1024,
};

const METADATA_TEMPLATE = {
  totalBytes: 0,
  entries: {},
};

function getRequestKey(request) {
  return typeof request === 'string' ? request : request.url;
}

function cloneMetadata(metadata = METADATA_TEMPLATE) {
  return {
    totalBytes: metadata.totalBytes ?? 0,
    entries: { ...(metadata.entries ?? {}) },
  };
}

function isUploadRequest(request) {
  const url = getRequestKey(request);
  return url.includes('/source-images/');
}

async function estimateResponseSize(response) {
  try {
    const buffer = await response.arrayBuffer();
    return buffer.byteLength;
  } catch (_error) {
    return Number.POSITIVE_INFINITY;
  }
}

async function loadMetadata(cache, metadataKey) {
  const stored = await cache.match(metadataKey);
  if (!stored) {
    return null;
  }
  try {
    return await stored.json();
  } catch (_error) {
    return null;
  }
}

async function persistMetadata(cache, metadata, metadataKey) {
  const snapshot = cloneMetadata(metadata);
  await cache.put(metadataKey, new Response(JSON.stringify(snapshot)));
  return snapshot;
}

async function rebuildMetadata(cache, metadataKey) {
  const metadata = cloneMetadata();
  const requests = await cache.keys();
  const now = Date.now();
  for (const request of requests) {
    if (getRequestKey(request) === metadataKey) {
      continue;
    }
    const response = await cache.match(request);
    if (!response) {
      continue;
    }
    const size = await estimateResponseSize(response.clone());
    metadata.totalBytes += size;
    metadata.entries[getRequestKey(request)] = {
      size,
      lastAccess: now,
    };
  }
  return persistMetadata(cache, metadata, metadataKey);
}

async function ensureMetadata(cache, metadataKey) {
  const metadata = await loadMetadata(cache, metadataKey);
  if (metadata) {
    return cloneMetadata(metadata);
  }
  return rebuildMetadata(cache, metadataKey);
}

function findLeastRecentlyUsed(metadata, protectedKey) {
  let oldestKey = null;
  let oldestTimestamp = Number.POSITIVE_INFINITY;
  for (const [key, entry] of Object.entries(metadata.entries)) {
    if (key === protectedKey) {
      continue;
    }
    if (entry.lastAccess < oldestTimestamp) {
      oldestTimestamp = entry.lastAccess;
      oldestKey = key;
    }
  }
  return oldestKey;
}

async function enforceLimits(cache, metadata, limits, protectedKey) {
  const { maxEntries, maxBytes, metadataKey } = limits;
  const mustTrimEntries = () => maxEntries && Object.keys(metadata.entries).length > maxEntries;
  const mustTrimBytes = () => maxBytes && metadata.totalBytes > maxBytes;

  while (mustTrimEntries() || mustTrimBytes()) {
    const lruKey = findLeastRecentlyUsed(metadata, protectedKey);
    if (!lruKey) {
      break;
    }
    const entry = metadata.entries[lruKey];
    await cache.delete(lruKey);
    delete metadata.entries[lruKey];
    metadata.totalBytes = Math.max(0, metadata.totalBytes - (entry?.size ?? 0));
  }

  return persistMetadata(cache, metadata, metadataKey);
}

async function touchEntry(cache, request, metadataKey) {
  const metadata = await ensureMetadata(cache, metadataKey);
  const key = getRequestKey(request);
  if (!metadata.entries[key]) {
    return metadata;
  }
  metadata.entries[key].lastAccess = Date.now();
  return persistMetadata(cache, metadata, metadataKey);
}

async function putWithLimits(cache, request, response, limits = DEFAULT_CACHE_LIMITS) {
  const cacheLimits = { ...DEFAULT_CACHE_LIMITS, ...limits };
  const { maxBytes, maxUploadBytes, metadataKey } = cacheLimits;
  const key = getRequestKey(request);
  const size = await estimateResponseSize(response.clone());

  if (!Number.isFinite(size) || size === 0) {
    return { cached: false, reason: 'unreadable' };
  }
  if (maxBytes && size > maxBytes) {
    return { cached: false, reason: 'response-too-large' };
  }
  if (maxUploadBytes && isUploadRequest(request) && size > maxUploadBytes) {
    return { cached: false, reason: 'upload-too-large' };
  }

  const metadata = await ensureMetadata(cache, metadataKey);
  const existing = metadata.entries[key];
  if (existing) {
    metadata.totalBytes = Math.max(0, metadata.totalBytes - existing.size);
  }

  metadata.entries[key] = {
    size,
    lastAccess: Date.now(),
  };
  metadata.totalBytes += size;

  await enforceLimits(cache, metadata, cacheLimits, key);
  await cache.put(request, response);
  await persistMetadata(cache, metadata, metadataKey);
  return { cached: true };
}

const api = {
  DEFAULT_CACHE_LIMITS,
  METADATA_TEMPLATE,
  cloneMetadata,
  enforceLimits,
  ensureMetadata,
  estimateResponseSize,
  findLeastRecentlyUsed,
  getRequestKey,
  isUploadRequest,
  loadMetadata,
  persistMetadata,
  putWithLimits,
  rebuildMetadata,
  touchEntry,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}

if (typeof self !== 'undefined') {
  self.CapyCacheLimits = api;
}
