import test from 'node:test';
import assert from 'node:assert/strict';

await import('../../render.js');

test('exposes renderer helpers globally', () => {
  assert.ok(globalThis.capyRenderer, 'expected the renderer globals to be defined');
  assert.equal(typeof globalThis.capyRenderer.createCanvas2dRenderer, 'function');
  assert.equal(typeof globalThis.capyRenderer.createWebGLRenderer, 'function');
  assert.equal(typeof globalThis.capyRenderer.createSvgRenderer, 'function');
  assert.equal(typeof globalThis.capyRenderer.SceneTileLoader, 'function');
  assert.equal(typeof globalThis.capyRenderer.SceneGraph, 'function');
  assert.equal(typeof globalThis.capyRenderer.sceneFormat, 'object');
  assert.equal(typeof globalThis.capyRenderer.vectorData, 'object');
});
