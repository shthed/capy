import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function makeTestPuzzle(overrides = {}) {
  const palette = [
    { id: 1, hex: '#EF4444', r: 239, g: 68, b: 68, isLight: false, argb: 0xffef4444 },
    { id: 2, hex: '#3B82F6', r: 59, g: 130, b: 246, isLight: false, argb: 0xff3b82f6 },
    { id: 3, hex: '#22C55E', r: 34, g: 197, b: 94, isLight: false, argb: 0xff22c55e },
  ];
  const regions = [
    { id: 101, colorId: 1, centroidX: 10, centroidY: 10, minX: 0, minY: 0, maxX: 20, maxY: 20, area: 100 },
    { id: 102, colorId: 1, centroidX: 30, centroidY: 10, minX: 20, minY: 0, maxX: 40, maxY: 20, area: 100 },
    { id: 103, colorId: 2, centroidX: 10, centroidY: 30, minX: 0, minY: 20, maxX: 20, maxY: 40, area: 100 },
    { id: 104, colorId: 3, centroidX: 30, centroidY: 30, minX: 20, minY: 20, maxX: 40, maxY: 40, area: 100 },
  ];
  return {
    width: 40,
    height: 40,
    palette,
    regions,
    isFreeColor: false,
    ...overrides,
  };
}

function makeRecorderEffects() {
  const calls = {
    firstTimeCompletion: [],
    haptics: [],
    replays: [],
    autoAdvanced: [],
    updateSnapshotProgress: [],
    setSnapshots: [],
    saveActiveState: [],
  };
  const effects = {
    onRecordFirstTimeCompletion: (wasIncomplete, isNowComplete, snapshotId) => {
      calls.firstTimeCompletion.push({ wasIncomplete, isNowComplete, snapshotId });
    },
    onHaptic: (type, enabled) => {
      calls.haptics.push({ type, enabled });
    },
    onStartReplay: (orderedRegionIds) => {
      calls.replays.push(orderedRegionIds);
    },
    onActiveColorAutoAdvanced: (nextColorId) => {
      calls.autoAdvanced.push(nextColorId);
    },
    onUpdateSnapshotProgress: (...args) => {
      calls.updateSnapshotProgress.push(args);
      return [{ id: args[0], filledCount: args[1] }];
    },
    onSetSnapshots: (snaps) => {
      calls.setSnapshots.push(snaps);
    },
    onSaveActiveState: (state) => {
      calls.saveActiveState.push(state);
    },
  };
  return { calls, effects };
}

export async function runAppHooksQuickwinTests(vite) {
  const useLatestMod = await vite.ssrLoadModule('/src/hooks/useLatest.ts');
  const paintStrokeMod = await vite.ssrLoadModule('/src/services/paintStrokeHelper.ts');

  const { useLatest, useIsomorphicLayoutEffect } = useLatestMod;
  const { finishPaintStroke } = paintStrokeMod;

  // 1. useLatest SSR & isomorphic layout effect contract
  assert.equal(typeof useLatest, 'function', 'useLatest must be exported as a function');
  assert.equal(
    useIsomorphicLayoutEffect,
    React.useEffect,
    'useIsomorphicLayoutEffect must resolve to React.useEffect in Node/SSR environment'
  );

  const capturedRefs = [];
  function ProbeComponent({ value }) {
    const latestRef = useLatest(value);
    capturedRefs.push(latestRef);
    return React.createElement('span', null, String(latestRef.current));
  }

  const html1 = renderToStaticMarkup(React.createElement(ProbeComponent, { value: 'alpha' }));
  const html2 = renderToStaticMarkup(React.createElement(ProbeComponent, { value: 'beta' }));
  assert.equal(html1, '<span>alpha</span>');
  assert.equal(html2, '<span>beta</span>');
  assert.equal(capturedRefs[0].current, 'alpha');
  assert.equal(capturedRefs[1].current, 'beta');

  // Verify useLatest updates .current inside useIsomorphicLayoutEffect (not render body)
  const useLatestSrc = fs.readFileSync(path.join(projectRoot, 'src/hooks/useLatest.ts'), 'utf8');
  assert.match(
    useLatestSrc,
    /useIsomorphicLayoutEffect\(\(\)\s*=>\s*\{\s*ref\.current\s*=\s*value;\s*\},\s*\[value\]\)/,
    'useLatest must sync ref.current inside useIsomorphicLayoutEffect'
  );

  // 2. finishPaintStroke: standard mode partial stroke (color still has unfilled regions)
  {
    const puzzle = makeTestPuzzle();
    const { calls, effects } = makeRecorderEffects();
    const viewport = { zoomScale: 2.25, panOffsetX: -48, panOffsetY: 32 };
    const result = finishPaintStroke(
      {
        puzzle,
        nextFilled: new Set([101]),
        paintedRegionColors: new Map(),
        activeColorId: 1,
        isFreeColorMode: false,
        wasPuzzleIncomplete: true,
        snapshotId: 'snap-1',
        settings: {
          hapticsEnabled: true,
          reducedMotion: false,
          autoAdvance: true,
          paletteSort: 'ORIGINAL',
          prioritizeOnScreen: false,
        },
        viewport,
        visibleColorIds: new Set([1, 2, 3]),
        filledRegionColorId: 1,
      },
      effects
    );

    assert.equal(result.isComplete, false);
    assert.equal(result.didAutoAdvance, false);
    assert.equal(result.nextActiveColorId, 1);
    assert.equal(result.hapticType, 'tick');
    assert.deepEqual(calls.haptics, [{ type: 'tick', enabled: true }]);
    assert.equal(calls.firstTimeCompletion.length, 0);
    assert.equal(calls.replays.length, 0);
    assert.equal(calls.autoAdvanced.length, 0);
    assert.equal(calls.updateSnapshotProgress.length, 1);
    assert.equal(calls.updateSnapshotProgress[0][8], undefined, 'Standard mode should not pass customPalette');
    assert.equal(calls.updateSnapshotProgress[0][9], undefined, 'Standard mode should not pass isFreeColor');
    assert.equal(calls.setSnapshots.length, 1);
    assert.deepEqual(calls.saveActiveState[0], {
      activeSnapshotId: 'snap-1',
      activeColorId: 1,
      filledRegionIds: [101],
      paintedRegionColors: undefined,
      isFreeColorMode: false,
      zoomScale: 2.25,
      panOffsetX: -48,
      panOffsetY: 32,
    });
  }

  // 3. finishPaintStroke: standard mode color completion + auto-advance to next incomplete color (and wrap-around)
  {
    const puzzle = makeTestPuzzle();
    const { calls, effects } = makeRecorderEffects();
    const result = finishPaintStroke(
      {
        puzzle,
        nextFilled: new Set([101, 102]),
        paintedRegionColors: new Map(),
        activeColorId: 1,
        isFreeColorMode: false,
        wasPuzzleIncomplete: true,
        snapshotId: 'snap-2',
        settings: {
          hapticsEnabled: true,
          reducedMotion: false,
          autoAdvance: true,
          paletteSort: 'ORIGINAL',
          prioritizeOnScreen: true,
        },
        viewport: { zoomScale: 1.5, panOffsetX: 10, panOffsetY: -5 },
        visibleColorIds: new Set([2, 3]),
        filledRegionColorId: 1,
      },
      effects
    );

    assert.equal(result.isComplete, false);
    assert.equal(
      result.hapticType,
      'success',
      'Completing last region of a color in single-tap standard mode must trigger success haptic'
    );
    assert.equal(result.didAutoAdvance, true);
    assert.equal(result.nextActiveColorId, 2, 'Should advance to next incomplete color 2 in palette order');
    assert.deepEqual(calls.autoAdvanced, [2]);
    assert.equal(calls.saveActiveState[0].activeColorId, 2);

    // Wrap-around: completing last palette color (3) while color 2 still has an unfilled region wraps to 2
    const wrapRec = makeRecorderEffects();
    const wrapRes = finishPaintStroke(
      {
        puzzle,
        nextFilled: new Set([101, 102, 104]),
        paintedRegionColors: new Map(),
        activeColorId: 3,
        isFreeColorMode: false,
        wasPuzzleIncomplete: true,
        snapshotId: 'snap-wrap',
        settings: {
          hapticsEnabled: true,
          reducedMotion: false,
          autoAdvance: true,
          paletteSort: 'ORIGINAL',
          prioritizeOnScreen: false,
        },
        viewport: { zoomScale: 1, panOffsetX: 0, panOffsetY: 0 },
        visibleColorIds: new Set([2]),
      },
      wrapRec.effects
    );
    assert.equal(wrapRes.didAutoAdvance, true);
    assert.equal(wrapRes.nextActiveColorId, 2, 'Should wrap around to remaining incomplete color 2');
    assert.equal(wrapRes.hapticType, 'tick', 'Batch stroke without filledRegionColorId keeps tick haptic when incomplete');
  }

  // 4. finishPaintStroke: standard mode with autoAdvance disabled keeps activeColorId
  {
    const puzzle = makeTestPuzzle();
    const { calls, effects } = makeRecorderEffects();
    const result = finishPaintStroke(
      {
        puzzle,
        nextFilled: new Set([101, 102]),
        paintedRegionColors: new Map(),
        activeColorId: 1,
        isFreeColorMode: false,
        wasPuzzleIncomplete: true,
        snapshotId: 'snap-3',
        settings: {
          hapticsEnabled: false,
          reducedMotion: false,
          autoAdvance: false,
          paletteSort: 'ORIGINAL',
          prioritizeOnScreen: false,
        },
        viewport: { zoomScale: 1, panOffsetX: 0, panOffsetY: 0 },
        visibleColorIds: new Set([2, 3]),
        filledRegionColorId: 1,
      },
      effects
    );

    assert.equal(result.didAutoAdvance, false);
    assert.equal(result.nextActiveColorId, 1);
    assert.equal(calls.autoAdvanced.length, 0);
    assert.deepEqual(calls.haptics, [{ type: 'success', enabled: false }]);
  }

  // 5. finishPaintStroke: free-color mode never auto-advances and persists painted colors + palette
  {
    const puzzle = makeTestPuzzle({ isFreeColor: true });
    const { calls, effects } = makeRecorderEffects();
    const painted = new Map([
      [101, 2],
      [102, 2],
    ]);
    const result = finishPaintStroke(
      {
        puzzle,
        nextFilled: new Set([101, 102]),
        paintedRegionColors: painted,
        activeColorId: 2,
        isFreeColorMode: true,
        wasPuzzleIncomplete: true,
        snapshotId: 'snap-free',
        settings: {
          hapticsEnabled: true,
          reducedMotion: false,
          autoAdvance: true,
          paletteSort: 'ORIGINAL',
          prioritizeOnScreen: false,
        },
        viewport: { zoomScale: 1.8, panOffsetX: 12, panOffsetY: 24 },
        visibleColorIds: new Set([1, 2, 3]),
      },
      effects
    );

    assert.equal(result.isComplete, false);
    assert.equal(result.didAutoAdvance, false);
    assert.equal(result.nextActiveColorId, 2);
    assert.equal(result.hapticType, 'tick');
    assert.equal(calls.autoAdvanced.length, 0);
    assert.deepEqual(calls.updateSnapshotProgress[0][7], { 101: 2, 102: 2 });
    assert.equal(calls.updateSnapshotProgress[0][8], puzzle.palette);
    assert.equal(calls.updateSnapshotProgress[0][9], true);
    assert.equal(calls.saveActiveState[0].isFreeColorMode, true);
    assert.deepEqual(calls.saveActiveState[0].paintedRegionColors, { 101: 2, 102: 2 });
  }

  // 6. finishPaintStroke: puzzle completion triggers stats, success haptic, replay, and zero viewport movement
  {
    const puzzle = makeTestPuzzle();
    const viewport = { zoomScale: 3.1, panOffsetX: -120, panOffsetY: 85 };

    // 6a: completion with active snapshot records stats, haptic, replay, and preserves viewport
    const rec1 = makeRecorderEffects();
    const res1 = finishPaintStroke(
      {
        puzzle,
        nextFilled: new Set([101, 102, 103, 104]),
        paintedRegionColors: new Map(),
        activeColorId: 3,
        isFreeColorMode: false,
        wasPuzzleIncomplete: true,
        snapshotId: 'snap-done',
        settings: {
          hapticsEnabled: true,
          autoAdvance: true,
          paletteSort: 'ORIGINAL',
          prioritizeOnScreen: false,
        },
        viewport,
        visibleColorIds: new Set(),
        filledRegionColorId: 3,
      },
      rec1.effects
    );

    assert.equal(res1.isComplete, true);
    assert.equal(res1.didAutoAdvance, false);
    assert.equal(res1.hapticType, 'success');
    assert.deepEqual(rec1.calls.firstTimeCompletion, [
      { wasIncomplete: true, isNowComplete: true, snapshotId: 'snap-done' },
    ]);
    assert.deepEqual(rec1.calls.haptics, [{ type: 'success', enabled: true }]);
    assert.deepEqual(rec1.calls.replays, [[101, 102, 103, 104]]);
    // Viewport must remain untouched on completion (DEV.md §2)
    assert.deepEqual(viewport, { zoomScale: 3.1, panOffsetX: -120, panOffsetY: 85 });
    assert.equal(rec1.calls.saveActiveState[0].zoomScale, 3.1);
    assert.equal(rec1.calls.saveActiveState[0].panOffsetX, -120);
    assert.equal(rec1.calls.saveActiveState[0].panOffsetY, 85);

    // 6b: completion with snapshotId = null skips persistence while still triggering replay
    const rec2 = makeRecorderEffects();
    finishPaintStroke(
      {
        puzzle,
        nextFilled: new Set([101, 102, 103, 104]),
        paintedRegionColors: new Map(),
        activeColorId: 3,
        isFreeColorMode: false,
        wasPuzzleIncomplete: false,
        snapshotId: null,
        settings: {
          hapticsEnabled: true,
          autoAdvance: true,
          paletteSort: 'ORIGINAL',
          prioritizeOnScreen: false,
        },
        viewport,
        visibleColorIds: new Set(),
      },
      rec2.effects
    );

    assert.equal(rec2.calls.replays.length, 1);
    assert.equal(rec2.calls.updateSnapshotProgress.length, 0);
    assert.equal(rec2.calls.saveActiveState.length, 0);
  }

  // 6c. finishPaintStroke: empty-region puzzle (puzzle.regions = []) and unmatched filledRegionColorId must NOT trigger false completion or 'success' haptic
  {
    const emptyPuzzle = makeTestPuzzle({ regions: [] });
    const baseSettings = {
      hapticsEnabled: true,
      autoAdvance: true,
      paletteSort: 'ORIGINAL',
      prioritizeOnScreen: false,
    };
    const viewport = { zoomScale: 1, panOffsetX: 0, panOffsetY: 0 };

    for (const filledRegionColorId of [undefined, 1]) {
      const rec = makeRecorderEffects();
      const res = finishPaintStroke(
        {
          puzzle: emptyPuzzle,
          nextFilled: new Set(),
          paintedRegionColors: new Map(),
          activeColorId: 1,
          isFreeColorMode: false,
          wasPuzzleIncomplete: true,
          snapshotId: 'snap-empty',
          settings: baseSettings,
          viewport,
          visibleColorIds: new Set([1, 2, 3]),
          ...(filledRegionColorId !== undefined ? { filledRegionColorId } : {}),
        },
        rec.effects
      );

      assert.equal(res.isComplete, false, 'Empty puzzle must not report isComplete=true');
      assert.equal(res.hapticType, 'tick', 'Empty puzzle must keep tick haptic');
      assert.equal(res.didAutoAdvance, false, 'Empty puzzle must not auto-advance');
      assert.equal(res.nextActiveColorId, 1);
      assert.deepEqual(rec.calls.haptics, [{ type: 'tick', enabled: true }]);
      assert.equal(rec.calls.firstTimeCompletion.length, 0);
      assert.equal(rec.calls.replays.length, 0);
      assert.equal(rec.calls.autoAdvanced.length, 0);
    }

    // Non-empty puzzle with a filledRegionColorId that matches 0 regions must not fire 'success' haptic
    const nonEmptyPuzzle = makeTestPuzzle();
    const unmatchedRec = makeRecorderEffects();
    const unmatchedRes = finishPaintStroke(
      {
        puzzle: nonEmptyPuzzle,
        nextFilled: new Set([101]),
        paintedRegionColors: new Map(),
        activeColorId: 1,
        isFreeColorMode: false,
        wasPuzzleIncomplete: true,
        snapshotId: 'snap-unmatched-color',
        settings: baseSettings,
        viewport,
        visibleColorIds: new Set([1, 2, 3]),
        filledRegionColorId: 999,
      },
      unmatchedRec.effects
    );
    assert.equal(unmatchedRes.isComplete, false);
    assert.equal(
      unmatchedRes.hapticType,
      'tick',
      'filledRegionColorId with 0 matching regions must not trigger success haptic'
    );
    assert.deepEqual(unmatchedRec.calls.haptics, [{ type: 'tick', enabled: true }]);
    assert.equal(unmatchedRec.calls.firstTimeCompletion.length, 0);
    assert.equal(unmatchedRec.calls.replays.length, 0);
  }

  // 7. Static source contracts for M5-1 (#585-1)
  const appSrc = fs.readFileSync(path.join(projectRoot, 'src/App.tsx'), 'utf8');
  const topBarSrc = fs.readFileSync(path.join(projectRoot, 'src/components/GameTopBar.tsx'), 'utf8');
  const colorPickerSrc = fs.readFileSync(
    path.join(projectRoot, 'src/components/ColorPickerPopover.tsx'),
    'utf8'
  );

  assert.equal(
    /\bcurrentZoomScale\b/.test(appSrc),
    false,
    'App.tsx must not declare or update unused currentZoomScale state'
  );
  assert.equal(
    /\bstepZoomTrigger\b/.test(appSrc),
    false,
    'App.tsx must not declare or pass unused stepZoomTrigger state'
  );
  assert.equal(
    /\bzoomScale\b|\bonStepZoom\b/.test(topBarSrc),
    false,
    'GameTopBar.tsx must not declare unused zoomScale or onStepZoom props'
  );
  assert.equal(
    /pushBackHandler\(\(\)\s*=>\s*setShowPaletteOptions\(false\)\)/.test(appSrc),
    false,
    'App.tsx must not duplicate ColorPickerPopover NativeBridge.pushBackHandler registration'
  );
  assert.equal(
    /NativeBridge\.pushBackHandler\(onClose\)/.test(colorPickerSrc),
    true,
    'ColorPickerPopover.tsx must remain the single owner of its back-handler registration'
  );
  assert.equal(
    /^  [a-zA-Z0-9_]+Ref\.current\s*=/m.test(appSrc),
    false,
    'App.tsx must not contain top-level render-time *Ref.current = mirror assignments'
  );
  assert.equal(
    /coopRippleBuffer=\{coopRippleBufferRef\.current\}/.test(appSrc),
    false,
    'App.tsx must not read coopRippleBufferRef.current during render'
  );
}
