import test from 'node:test';
import assert from 'node:assert/strict';

await import('../../render.js');

const { createRendererController } = globalThis.capyRenderer;

function createStubCanvas() {
  const canvas = {
    width: 0,
    height: 0,
  };
  const context = {
    canvas,
    setTransform: () => {},
    imageSmoothingEnabled: false,
  };
  canvas.getContext = (type) => (type === '2d' ? context : null);
  return canvas;
}

function createRendererFactory(name, overrides = {}) {
  const events = [];
  const renderer = {
    name,
    dispose: () => {
      events.push('dispose');
    },
    ...overrides,
  };
  const factory = () => renderer;
  factory.events = events;
  return factory;
}

test('falls back to the canvas2d renderer when the preferred type is unavailable', () => {
  const canvas = createStubCanvas();
  const canvasFactory = createRendererFactory('canvas2d');
  const changes = [];

  const controller = createRendererController(canvas, {
    initialRenderer: 'webgl',
    hooks: {
      onRendererChange: (event) => {
        changes.push(event);
      },
    },
    renderers: {
      canvas2d: canvasFactory,
    },
  });

  assert.equal(controller.getRendererType(), 'canvas2d');
  const fallbackEvent = changes.find(
    (event) => event.type === 'canvas2d' && event.previousType === null
  );
  assert.ok(fallbackEvent, 'expected a fallback activation for canvas2d');
});

test('activates a fallback renderer when the current type is unregistered', () => {
  const canvas = createStubCanvas();
  const canvasFactory = createRendererFactory('canvas2d');
  const customFactory = createRendererFactory('custom');
  const changes = [];

  const controller = createRendererController(canvas, {
    initialRenderer: 'custom',
    hooks: {
      onRendererChange: (event) => {
        changes.push(event);
      },
    },
    renderers: {
      canvas2d: canvasFactory,
      custom: customFactory,
    },
  });

  assert.equal(controller.getRendererType(), 'custom');

  const unregistered = controller.unregisterRenderer('custom');
  assert.equal(unregistered, true);
  assert.equal(controller.getRendererType(), 'canvas2d');
  assert.deepEqual(customFactory.events, ['dispose']);
  assert.ok(
    changes.some((event) => event.type === null && event.previousType === 'custom'),
    'expected a change event signalling disposal of the custom renderer'
  );
  assert.ok(
    changes.some((event) => event.type === 'canvas2d' && event.previousType === null),
    'expected a fallback activation for canvas2d after unregistering custom'
  );
});

test('falls back to hook implementations when the renderer omits helpers', () => {
  const canvas = createStubCanvas();
  const canvasFactory = createRendererFactory('canvas2d');
  const previewCalls = [];
  const flashCalls = [];

  const controller = createRendererController(canvas, {
    initialRenderer: 'custom',
    hooks: {
      renderPreview: (args) => {
        previewCalls.push(args);
        return 'hook-preview';
      },
      flashRegions: (args) => {
        flashCalls.push(args);
        return 'hook-flash';
      },
    },
    renderers: {
      canvas2d: canvasFactory,
      custom: createRendererFactory('custom', {
        renderFrame: () => 'frame-called',
      }),
    },
  });

  assert.equal(controller.getRendererType(), 'custom');

  const previewResult = controller.renderPreview({ source: 'test' });
  assert.equal(previewResult, 'hook-preview');
  assert.deepEqual(previewCalls, [{ source: 'test' }]);

  const flashResult = controller.flashRegions({ target: 42 });
  assert.equal(flashResult, 'hook-flash');
  assert.deepStrictEqual(flashCalls, [{ target: 42 }]);
});
