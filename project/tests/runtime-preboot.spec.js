import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';

const runtimeUrl = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../../runtime.js'));

function createStyle() {
  return {
    properties: {},
    setProperty(name, value) {
      this.properties[name] = value;
    },
  };
}

function createMockDom({ width = 1200, height = 800, localStorage } = {}) {
  const style = createStyle();
  const documentElement = {
    style,
    dataset: {},
    clientWidth: width,
    clientHeight: height,
  };
  const body = {
    dataset: {},
    classList: { toggle() {} },
  };
  const document = { documentElement, body };
  const window = {
    innerWidth: width,
    innerHeight: height,
    visualViewport: { width, height },
    localStorage,
  };
  return { document, window };
}

async function withRuntimeEnvironment(options, assertions) {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const { document, window } = createMockDom(options);
  global.document = document;
  global.window = window;

  try {
    const module = await import(`${runtimeUrl.href}?t=${Date.now()}-${Math.random()}`);
    return await assertions({ module, document, window });
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
}

test('computePrebootMetrics tolerates throwing localStorage access', async () => {
  await withRuntimeEnvironment(
    {
      localStorage: {
        getItem() {
          throw new Error('denied');
        },
      },
    },
    async ({ module, document }) => {
      const metrics = module.computePrebootMetrics();

      assert.equal(metrics.orientation, 'landscape');
      assert.equal(document.documentElement.dataset.orientation, 'landscape');
      assert.equal(document.documentElement.style.properties['--ui-scale-user'], '0.75');
      assert.ok(Number.isFinite(Number(document.documentElement.style.properties['--ui-scale'] ?? NaN)));
    }
  );
});

test('computePrebootMetrics falls back to defaults when settings payload is invalid', async () => {
  await withRuntimeEnvironment(
    {
      width: 640,
      height: 900,
      localStorage: {
        getItem() {
          return 'not-json';
        },
      },
    },
    async ({ module, document }) => {
      const metrics = module.computePrebootMetrics();

      assert.equal(metrics.orientation, 'portrait');
      assert.equal(document.documentElement.dataset.orientation, 'portrait');
      assert.equal(document.documentElement.style.properties['--ui-scale-user'], '0.75');
      assert.match(document.documentElement.style.properties['--ui-scale-auto'], /^0\.\d{3}$/);
    }
  );
});
