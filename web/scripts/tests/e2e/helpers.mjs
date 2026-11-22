/**
 * Shared E2E browser helpers, deterministic wait utilities, and spotlight/region probes.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export async function isServerListening(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

export async function waitForAnimationFrames(page, frames = 2) {
  await page.evaluate(
    (count) =>
      new Promise((resolve) => {
        let remaining = Math.max(1, count);
        const tick = () => {
          remaining -= 1;
          if (remaining <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    frames
  );
}

export async function waitForCondition(predicate, timeoutMs = 3000, intervalMs = 25) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return Boolean(await predicate());
}

export async function waitForPuzzleLoaded(page) {
  await page.waitForSelector('canvas', { timeout: 25000 });
  await page.waitForFunction(
    () =>
      !document.body.innerText.includes('Analyzing artwork') &&
      !document.body.innerText.toLowerCase().includes('generating puzzle'),
    { timeout: 25000 }
  );
  await page.waitForSelector(
    '[aria-label="Palette dock"], [data-testid="replay-btn"], [data-testid="replay-controls-window"]',
    { timeout: 25000 }
  );
  await page.waitForFunction(
    () => {
      const c = document.querySelector('canvas');
      return Boolean(c && c.width > 0 && c.height > 0);
    },
    { timeout: 25000 }
  );
  await waitForAnimationFrames(page, 2);
}

export async function tapCanvasGrid(page, startFrac = 0.32, count = 8, delayMs = 60) {
  const canvas = await page.$('canvas');
  const box = await canvas.boundingBox();
  const cols = 4;
  for (let i = 0; i < count; i++) {
    const x = box.x + box.width * (startFrac + (i % cols) * 0.09);
    const y = box.y + box.height * (startFrac + Math.floor(i / cols) * 0.09);
    await page.mouse.click(x, y);
    if (delayMs > 0) {
      // INTENTIONAL_TIMING_WINDOW: configurable inter-tap cadence to avoid collapsing sequential taps into a double-tap
      await page.waitForTimeout(delayMs);
    }
  }
  await waitForAnimationFrames(page, 2);
}

export async function getStableBoundingBox(locator, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  let prev = await locator.boundingBox();
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 60));
    const cur = await locator.boundingBox();
    if (
      prev &&
      cur &&
      Math.abs(cur.x - prev.x) < 0.5 &&
      Math.abs(cur.y - prev.y) < 0.5 &&
      Math.abs(cur.width - prev.width) < 0.5 &&
      Math.abs(cur.height - prev.height) < 0.5
    ) {
      return cur;
    }
    prev = cur;
  }
  return prev;
}

export function getSettingsBtn(page) {
  return page.locator('button[title="Settings and Menu"]');
}

const v3012ScreenshotDir = (process.env.CAPY_V3012_SCREENSHOT_DIR || '').trim();
export const captureV3012Screenshot = async (targetPage, filename) => {
      if (!v3012ScreenshotDir) return;
      fs.mkdirSync(v3012ScreenshotDir, { recursive: true });
      await targetPage.screenshot({ path: path.join(v3012ScreenshotDir, filename) });
    };

export const assertSpotlightAligned = async (targetPage, expectedVariant) => {
      await targetPage.waitForFunction(
        (variant) => {
          const overlay = document.querySelector('[data-testid="spotlight-overlay"]');
          if (!overlay || overlay.getAttribute('data-variant') !== variant) return false;
          const rings = Array.from(overlay.querySelectorAll('[data-testid="spotlight-ring"]'));
          const pointer = overlay.querySelector('[data-testid="spotlight-pointer"]');
          if (rings.length === 0 || !pointer) return false;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const ringRects = rings.map((r) => r.getBoundingClientRect());
          for (let i = 0; i < ringRects.length; i++) {
            for (let j = i + 1; j < ringRects.length; j++) {
              const a = ringRects[i];
              const b = ringRects[j];
              const hx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const vy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              if (hx > 0.5 && vy > 0.5) return false;
            }
          }
          const hasRunningTransition = (el) => {
            let node = el;
            while (node && node !== document.body && node !== document.documentElement) {
              if (typeof node.getAnimations === 'function') {
                const anims = node.getAnimations();
                for (const a of anims) {
                  if (
                    typeof CSSTransition !== 'undefined' &&
                    a instanceof CSSTransition &&
                    a.playState === 'running'
                  ) {
                    return true;
                  }
                }
              }
              node = node.parentElement;
            }
            return false;
          };
          let overlapsTarget = false;
          const allInView = rings.every((ring, idx) => {
            const rr = ringRects[idx];
            if (
              rr.width <= 0 ||
              rr.height <= 0 ||
              rr.left < 0 ||
              rr.top < 0 ||
              rr.right > vw + 1 ||
              rr.bottom > vh + 1
            ) {
              return false;
            }
            const sel = ring.getAttribute('data-target-selector') || '';
            const targets = sel ? Array.from(document.querySelectorAll(sel)) : [];
            for (const targetEl of targets) {
              if (hasRunningTransition(targetEl)) return false;
              const tr = targetEl.getBoundingClientRect();
              if (
                rr.left <= tr.right + 2 &&
                rr.right >= tr.left - 2 &&
                rr.top <= tr.bottom + 2 &&
                rr.bottom >= tr.top - 2
              ) {
                overlapsTarget = true;
              }
            }
            return true;
          });
          return allInView && overlapsTarget;
        },
        expectedVariant,
        { timeout: 4000 }
      );
      const metrics = await targetPage.evaluate(() => {
        const overlay = document.querySelector('[data-testid="spotlight-overlay"]');
        const pointer = overlay?.querySelector('[data-testid="spotlight-pointer"]');
        const path = pointer?.querySelector('path');
        const poly = pointer?.querySelector('polygon');
        const rings = Array.from(overlay?.querySelectorAll('[data-testid="spotlight-ring"]') || []);
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let overlapsTarget = false;
        const ringRects = rings.map((r) => r.getBoundingClientRect());
        let ringsSeparated = true;
        for (let i = 0; i < ringRects.length; i++) {
          for (let j = i + 1; j < ringRects.length; j++) {
            const a = ringRects[i];
            const b = ringRects[j];
            const hx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const vy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (hx > 0.5 && vy > 0.5) {
              ringsSeparated = false;
            }
          }
        }
        const ringsInView = rings.every((ring, idx) => {
          const rr = ringRects[idx];
          const inView =
            rr.width > 0 &&
            rr.height > 0 &&
            rr.left >= 0 &&
            rr.top >= 0 &&
            rr.right <= vw + 1 &&
            rr.bottom <= vh + 1;
          const sel = ring.getAttribute('data-target-selector') || '';
          const targets = sel ? Array.from(document.querySelectorAll(sel)) : [];
          for (const targetEl of targets) {
            const tr = targetEl.getBoundingClientRect();
            const hits =
              rr.left <= tr.right + 2 &&
              rr.right >= tr.left - 2 &&
              rr.top <= tr.bottom + 2 &&
              rr.bottom >= tr.top - 2;
            if (hits) overlapsTarget = true;
          }
          return inView;
        });
        const pointerBox = pointer ? pointer.getBoundingClientRect() : null;
        const pathBox = path ? path.getBoundingClientRect() : null;
        return {
          pointerEvents: overlay ? getComputedStyle(overlay).pointerEvents : '',
          ringCount: rings.length,
          ringsInView,
          ringsSeparated,
          overlapsTarget,
          hasPath: Boolean(path?.getAttribute('d')),
          hasArrow: Boolean(poly?.getAttribute('points')),
          pointerSpan: Math.max(pathBox?.width || 0, pathBox?.height || 0, pointerBox ? 0 : 0),
          ringAnim: rings[0] ? getComputedStyle(rings[0]).animationName : '',
          ringTransitionDur: rings[0] ? getComputedStyle(rings[0]).transitionDuration : '',
        };
      });
      assert.equal(metrics.pointerEvents, 'none', 'spotlight-overlay must be non-blocking');
      assert.equal(metrics.ringCount >= 1, true, 'Expected at least 1 spotlight-ring');
      assert.equal(metrics.ringsInView, true, `Spotlight rings must fit inside viewport: ${JSON.stringify(metrics)}`);
      assert.equal(metrics.ringsSeparated, true, `Adjacent spotlight rings must not overlap: ${JSON.stringify(metrics)}`);
      assert.equal(metrics.overlapsTarget, true, `Spotlight ring must overlap target element: ${JSON.stringify(metrics)}`);
      assert.equal(metrics.hasPath && metrics.hasArrow, true, 'Expected spotlight-pointer SVG path and arrowhead');
      return metrics;
    };

    // -------------------------------------------------------------------------
    // 2. Full 12-Step OnboardingTutorial Tour, Modal-Aware Settings/Hints & Spotlight Alignment

export const readTotalRemainingRegions = async (targetPage) => {
      return targetPage.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll('[aria-label="Palette dock"] button[data-testid^="palette-swatch-"]')
        );
        return buttons.reduce((sum, btn) => {
          const title = btn.getAttribute('title') || '';
          const m = title.match(/\((\d+)\s+remaining\)/);
          return sum + (m ? Number(m[1]) : 0);
        }, 0);
      });
    };

