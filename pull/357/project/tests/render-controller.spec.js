import test from 'node:test';
import assert from 'node:assert/strict';

await import('../../render.js');

test('exposes only the SVG renderer helpers globally', () => {
  assert.ok(globalThis.capyRenderer, 'expected the renderer globals to be defined');
  assert.equal(typeof globalThis.capyRenderer.createSvgRenderer, 'function');
  assert.equal(typeof globalThis.capyRenderer.SceneTileLoader, 'function');
  assert.equal(typeof globalThis.capyRenderer.SceneGraph, 'function');
  assert.equal(typeof globalThis.capyRenderer.sceneFormat, 'object');
  assert.equal(typeof globalThis.capyRenderer.vectorData, 'object');
  assert.equal(globalThis.capyRenderer.createRendererController, undefined);
  assert.equal(globalThis.capyRenderer.createCanvas2dRenderer, undefined);
  assert.equal(globalThis.capyRenderer.createWebGLRenderer, undefined);
});
