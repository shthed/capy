const { test, expect } = require('@playwright/test');

const APP_URL = 'http://127.0.0.1:8000/index.html';
const OPENAI_URL = 'https://api.openai.com/v1/images/generations';
const MOCK_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAIElEQVR4nGNQOhr3UNaDeJKBJNVKR+MYRm0YtWHI2AAAur5FkIu9+e0AAAAASUVORK5CYII=';

async function routeOpenAI(page, fulfillResponse) {
  await page.route(OPENAI_URL, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'authorization, content-type',
        },
      });
      return;
    }
    await fulfillResponse(route);
  });
}

test.describe('ChatGPT prompt flow', () => {
  test('imports mocked ChatGPT art when the API responds with image data', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    await routeOpenAI(page, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': '*',
        },
        body: JSON.stringify({
          created: Math.floor(Date.now() / 1000),
          data: [
            {
              b64_json: MOCK_IMAGE_BASE64,
            },
          ],
        }),
      });
    });

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="palette-swatch"]');

    await page.evaluate(({ prompt }) => {
      try {
        window.localStorage.setItem('capycolour.lastPrompt', prompt);
      } catch (error) {
        // Ignore storage failures (e.g., private browsing).
      }
      const promptField = document.querySelector('#promptInput');
      if (promptField) {
        promptField.value = prompt;
      }
    }, { prompt: 'Capybara surfing a rainbow river' });

    await page.evaluate(() => {
      window.capyGenerator.setChatGPTKey('sk-test-mock-key');
    });

    const success = await page.evaluate(() =>
      window.capyGenerator.generateFromPrompt('Capybara surfing a rainbow river', {
        interactive: true,
        fallbackToSample: true,
        persistPromptValue: true,
        reason: 'playwright-mock',
      })
    );
    expect(success).toBe(true);

    await expect
      .poll(() =>
        page.evaluate(() => {
          const state = window.capyGenerator.getState();
          return {
            sourceUrl: state.sourceUrl,
            sourceTitle: state.sourceTitle,
            paletteCount: state.puzzle?.palette?.length || 0,
            regionCount: state.puzzle?.regions?.length || 0,
          };
        })
      )
      .toMatchObject({
        sourceUrl: expect.stringMatching(/^data:image\/png;base64,/),
      });

    const state = await page.evaluate(() => {
      const { sourceUrl, sourceTitle, puzzle } = window.capyGenerator.getState();
      return {
        sourceUrl,
        sourceTitle,
        paletteCount: puzzle?.palette?.length || 0,
        regionCount: puzzle?.regions?.length || 0,
      };
    });

    expect(state.sourceTitle).toContain('Capybara surfing a rainbow river');
    expect(state.paletteCount).toBeGreaterThan(0);
    expect(state.regionCount).toBeGreaterThan(0);

    const telemetry = await page.evaluate(() => {
      const panel = document.getElementById('generationDetails');
      if (!panel) return null;
      const labels = Array.from(panel.querySelectorAll('dt')).map((node) => (node.textContent || '').trim());
      const values = Array.from(panel.querySelectorAll('dd')).map((node) => (node.textContent || '').trim());
      const data = {};
      for (let index = 0; index < labels.length; index += 1) {
        data[labels[index]] = values[index] || '';
      }
      return { empty: panel.dataset.empty || null, data };
    });

    expect(telemetry).not.toBeNull();
    expect(telemetry.empty).toBe('false');
    expect(telemetry.data).toMatchObject({
      Mode: expect.stringContaining('ChatGPT prompt'),
    });
    expect(telemetry.data.Prompt).toContain('Capybara surfing a rainbow river');
    expect(telemetry.data).toHaveProperty('Palette size');
    expect(telemetry.data).toHaveProperty('Region count');
    expect(telemetry.data).toHaveProperty('Progress');
    expect(telemetry.data.Progress).toMatch(/Complete/);
    expect(telemetry.data).toHaveProperty('Current step');
    expect(telemetry.data['Current step']).toMatch(/regions/i);

    const logMessages = await page.$$eval('#debugLog .log-entry .message', (nodes) =>
      nodes.map((el) => (el.textContent || '').trim())
    );
    expect(logMessages.some((message) => message.includes('Generating ChatGPT art for “Capybara surfing a rainbow river”'))).toBe(
      true
    );
    expect(logMessages.some((message) => message.includes('complete'))).toBe(true);
    expect(consoleErrors).toEqual([]);
  });

  test('falls back to the bundled sample when the API request fails', async ({ page }) => {
    await routeOpenAI(page, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': '*',
        },
        body: JSON.stringify({
          error: {
            message: 'Deliberate mock failure',
          },
        }),
      });
    });

    await page.context().addInitScript(() => {
      try {
        window.localStorage.setItem('capycolour.openaiKey', 'sk-test-mock-key');
        window.localStorage.setItem('capycolour.lastPrompt', 'Capybara exploring a neon city');
      } catch (error) {
        // Ignore storage issues in headless environments.
      }
    });

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="palette-swatch"]');

    await expect
      .poll(() =>
        page.evaluate(() => {
          const state = window.capyGenerator.getState();
          return state.sourceTitle || null;
        })
      )
      .toContain('Capycolour Springs');

    const state = await page.evaluate(() => {
      const { sourceTitle, sourceUrl, puzzle } = window.capyGenerator.getState();
      return {
        sourceTitle,
        sourceUrl,
        paletteCount: puzzle?.palette?.length || 0,
        regionCount: puzzle?.regions?.length || 0,
      };
    });

    expect(state.sourceTitle).toContain('Capycolour Springs');
    expect(state.sourceUrl).toContain('data:image/svg+xml;base64,');
    expect(state.paletteCount).toBeGreaterThan(0);
    expect(state.regionCount).toBeGreaterThan(0);

    const logMessages = await page.$$eval('#debugLog .log-entry .message', (nodes) =>
      nodes.map((el) => (el.textContent || '').trim())
    );
    expect(logMessages.some((message) => message.includes('ChatGPT image request failed'))).toBe(true);
    expect(logMessages.some((message) => message.includes('Loading sample puzzle'))).toBe(true);
  });
});
