import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';

const runtimeUrl = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../../runtime.js'));

async function importRuntime() {
  delete globalThis.capyRuntime;
  await import(`${runtimeUrl.href}?t=${Date.now()}-${Math.random()}`);
  return globalThis.capyRuntime;
}

test('createRendererController binds renderer change hooks immediately', async () => {
  const { createRendererController } = await importRuntime();

  const calls = [];
  const controller = createRendererController(null, {
    hooks: {
      onRendererChange: (type) => calls.push(type),
    },
  });

  controller.setRenderer('svg');

  assert.deepEqual(calls, ['svg']);
});

test('createRendererController surfaces renderer wiring errors', async () => {
  const { createRendererController } = await importRuntime();

  const logEntries = [];
  const controller = createRendererController(null, {
    hooks: {
      log: (message, context) => {
        logEntries.push({ message, context });
      },
    },
  });

  controller.setRenderer('canvas');

  assert.ok(logEntries.length >= 1);
  const notification = logEntries.find((entry) => entry.context?.code === 'renderer-change-handler-unbound');
  assert.ok(notification, 'expected an unbound handler log entry');
  assert.match(notification.message, /Renderer change/);
  assert.equal(notification.context?.renderer, 'canvas');
});
