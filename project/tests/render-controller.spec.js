import test from 'node:test';
import assert from 'node:assert/strict';

await import('../../capy.js');

test('exposes renderer helpers globally', () => {
  assert.ok(globalThis.capyRenderer, 'expected the renderer globals to be defined');
  assert.equal(typeof globalThis.capyRenderer.createSvgRenderer, 'function');
  assert.equal(typeof globalThis.capyRenderer.computeInkStyles, 'function');
  assert.equal(typeof globalThis.capyRenderer.buildPathData, 'function');
});
