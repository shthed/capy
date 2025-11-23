import assert from 'node:assert';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const cacheLimits = require('../../service-worker-cache.cjs');

class MemoryCache {
  constructor() {
    this.store = new Map();
  }

  keyFor(request) {
    return cacheLimits.getRequestKey(request);
  }

  async match(request) {
    const entry = this.store.get(this.keyFor(request));
    return entry ? entry.clone() : undefined;
  }

  async put(request, response) {
    this.store.set(this.keyFor(request), response.clone());
  }

  async delete(request) {
    return this.store.delete(this.keyFor(request));
  }

  async keys() {
    return [...this.store.keys()].map((key) => new Request(key));
  }
}

test('evicts least-recently-used entries when the cache exceeds its limits', async () => {
  const cache = new MemoryCache();
  const limits = { metadataKey: '__meta-one__', maxEntries: 2, maxBytes: 1024 };
  const originalNow = Date.now;
  let ticks = 0;
  Date.now = () => ++ticks;

  try {
    await cacheLimits.putWithLimits(cache, new Request('https://capy.local/a'), new Response('a'), limits);
    await cacheLimits.putWithLimits(cache, new Request('https://capy.local/b'), new Response('b'), limits);
    await cacheLimits.touchEntry(cache, new Request('https://capy.local/a'), limits.metadataKey);
    await cacheLimits.putWithLimits(cache, new Request('https://capy.local/c'), new Response('c'), limits);

    const metadata = await cacheLimits.ensureMetadata(cache, limits.metadataKey);
    const cachedKeys = Object.keys(metadata.entries).sort();
    assert.deepStrictEqual(cachedKeys, ['https://capy.local/a', 'https://capy.local/c']);
  } finally {
    Date.now = originalNow;
  }
});

test('skips oversized uploads and trims byte usage to stay within budget', async () => {
  const cache = new MemoryCache();
  const limits = { metadataKey: '__meta-two__', maxEntries: 5, maxBytes: 50, maxUploadBytes: 20 };
  const originalNow = Date.now;
  let ticks = 0;
  Date.now = () => ++ticks;

  try {
    const uploadAttempt = await cacheLimits.putWithLimits(
      cache,
      new Request('https://capy.local/source-images/uploaded'),
      new Response('x'.repeat(25)),
      limits
    );
    assert.strictEqual(uploadAttempt.cached, false);

    await cacheLimits.putWithLimits(cache, new Request('https://capy.local/first'), new Response('x'.repeat(30)), limits);
    await cacheLimits.putWithLimits(cache, new Request('https://capy.local/second'), new Response('x'.repeat(25)), limits);

    const metadata = await cacheLimits.ensureMetadata(cache, limits.metadataKey);
    assert.deepStrictEqual(Object.keys(metadata.entries).sort(), ['https://capy.local/second']);
    assert.ok(metadata.totalBytes <= limits.maxBytes);
  } finally {
    Date.now = originalNow;
  }
});
