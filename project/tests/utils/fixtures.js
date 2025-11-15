export const TEST_COLOR_IDS = {
  warmClay: 1,
  coolLagoon: 2,
  sunlitBloom: 3,
};

export const TEST_REGION_IDS = {
  warmClay: [0, 1],
  coolLagoon: [2, 3],
  sunlitBloom: [4, 5],
};

function buildBasePuzzle() {
  const width = 4;
  const height = 3;
  return {
    format: 'capy-puzzle@2',
    title: 'Automation fixture',
    width,
    height,
    activeColor: TEST_COLOR_IDS.warmClay,
    palette: [
      {
        id: TEST_COLOR_IDS.warmClay,
        hex: '#c26f5c',
        rgba: [194, 111, 92],
        name: 'Warm clay',
      },
      {
        id: TEST_COLOR_IDS.coolLagoon,
        hex: '#3aa7a3',
        rgba: [58, 167, 163],
        name: 'Cool lagoon',
      },
      {
        id: TEST_COLOR_IDS.sunlitBloom,
        hex: '#f7c948',
        rgba: [247, 201, 72],
        name: 'Sunlit bloom',
      },
    ],
    regions: [
      {
        id: TEST_REGION_IDS.warmClay[0],
        colorId: TEST_COLOR_IDS.warmClay,
        pixels: [0, 1],
        cx: 0.5,
        cy: 0,
      },
      {
        id: TEST_REGION_IDS.warmClay[1],
        colorId: TEST_COLOR_IDS.warmClay,
        pixels: [4, 5],
        cx: 0.5,
        cy: 1,
      },
      {
        id: TEST_REGION_IDS.coolLagoon[0],
        colorId: TEST_COLOR_IDS.coolLagoon,
        pixels: [2, 3],
        cx: 2.5,
        cy: 0,
      },
      {
        id: TEST_REGION_IDS.coolLagoon[1],
        colorId: TEST_COLOR_IDS.coolLagoon,
        pixels: [6, 7],
        cx: 2.5,
        cy: 1,
      },
      {
        id: TEST_REGION_IDS.sunlitBloom[0],
        colorId: TEST_COLOR_IDS.sunlitBloom,
        pixels: [8, 9],
        cx: 0.5,
        cy: 2,
      },
      {
        id: TEST_REGION_IDS.sunlitBloom[1],
        colorId: TEST_COLOR_IDS.sunlitBloom,
        pixels: [10, 11],
        cx: 2.5,
        cy: 2,
      },
    ],
    regionMap: [
      TEST_REGION_IDS.warmClay[0],
      TEST_REGION_IDS.warmClay[0],
      TEST_REGION_IDS.coolLagoon[0],
      TEST_REGION_IDS.coolLagoon[0],
      TEST_REGION_IDS.warmClay[1],
      TEST_REGION_IDS.warmClay[1],
      TEST_REGION_IDS.coolLagoon[1],
      TEST_REGION_IDS.coolLagoon[1],
      TEST_REGION_IDS.sunlitBloom[0],
      TEST_REGION_IDS.sunlitBloom[0],
      TEST_REGION_IDS.sunlitBloom[1],
      TEST_REGION_IDS.sunlitBloom[1],
    ],
    backgroundColor: '#f8fafc',
    stageBackgroundColor: '#020617',
    filled: [],
    settings: {
      renderer: 'canvas2d',
    },
  };
}

export function createTestPuzzle(overrides = {}) {
  const base = buildBasePuzzle();
  return {
    ...base,
    ...overrides,
    palette: overrides.palette ? overrides.palette : base.palette.map((entry) => ({ ...entry })),
    regions: overrides.regions
      ? overrides.regions
      : base.regions.map((entry) => ({ ...entry, pixels: [...entry.pixels] })),
    regionMap: overrides.regionMap ? [...overrides.regionMap] : [...base.regionMap],
    filled: overrides.filled ? [...overrides.filled] : [],
  };
}

export async function clearStorage(page) {
  await page.evaluate(() => {
    try {
      window.localStorage?.clear?.();
    } catch (error) {
      console.warn('Failed to clear localStorage', error);
    }
    try {
      window.sessionStorage?.clear?.();
    } catch (error) {
      console.warn('Failed to clear sessionStorage', error);
    }
  });
}

export async function loadTestPuzzle(page, overrides = {}) {
  const puzzle = createTestPuzzle(overrides);
  const loaded = await page.evaluate(async (payload) => {
    if (!window.capyGenerator?.loadPuzzleFixture) {
      return false;
    }
    return window.capyGenerator.loadPuzzleFixture(payload);
  }, puzzle);
  if (!loaded) {
    throw new Error('Failed to load test puzzle fixture');
  }
  await page.waitForFunction(() => {
    const state = window.capyGenerator?.getState?.();
    return Boolean(state?.puzzle?.regions?.length);
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="palette-swatch"]').length >= 3
  );
  return puzzle;
}

export async function setActiveColor(page, colorId) {
  await page.evaluate((target) => {
    window.capyGenerator?.setActiveColor?.(target, { flash: false, redraw: true });
  }, colorId);
  await page.waitForFunction(
    (target) => window.capyGenerator?.getState?.()?.activeColor === target,
    colorId
  );
}

export async function fillRegion(page, regionId) {
  const result = await page.evaluate((target) => {
    return window.capyGenerator?.fillRegion?.(target, {
      ensureColor: true,
      flash: false,
      redraw: true,
    });
  }, regionId);
  if (result !== 'filled' && result !== 'already-filled') {
    throw new Error(`Unexpected fill result: ${result}`);
  }
  await page.waitForFunction(
    (target) => Boolean(window.capyGenerator?.getState?.()?.filled?.has(target)),
    regionId
  );
  return result;
}

export async function getFilledCount(page) {
  return page.evaluate(() => {
    const state = window.capyGenerator?.getState?.();
    return state?.filled?.size ?? 0;
  });
}

export async function getActiveRenderer(page) {
  return page.evaluate(() => window.capyGenerator?.getRendererType?.() || null);
}

export async function getPerformanceMetrics(page) {
  return page.evaluate(() => {
    const snapshot = window.capyGenerator?.getPerformanceMetrics?.();
    if (!snapshot) {
      return null;
    }
    return snapshot;
  });
}

export async function resetPerformanceMetrics(page) {
  await page.waitForFunction(() => Boolean(window.capyGenerator?.resetPerformanceMetrics));
  return page.evaluate(() => {
    try {
      return window.capyGenerator?.resetPerformanceMetrics?.() ?? null;
    } catch (error) {
      console.warn('Failed to reset performance metrics', error);
      return null;
    }
  });
}
