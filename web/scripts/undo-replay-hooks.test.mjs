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
    { id: 101, colorId: 1, centroidX: 50, centroidY: 50, minX: 0, minY: 0, maxX: 100, maxY: 100, area: 10000 },
    { id: 102, colorId: 2, centroidX: 950, centroidY: 50, minX: 900, minY: 0, maxX: 1000, maxY: 100, area: 10000 },
    { id: 103, colorId: 3, centroidX: 500, centroidY: 500, minX: 450, minY: 450, maxX: 550, maxY: 550, area: 10000 },
    { id: 104, colorId: 1, centroidX: 950, centroidY: 950, minX: 900, minY: 900, maxX: 1000, maxY: 1000, area: 10000 },
  ];
  return {
    width: 1000,
    height: 1000,
    palette,
    regions,
    isFreeColor: false,
    ...overrides,
  };
}

export async function runUndoReplayHooksTests(vite) {
  console.log('   -> Undo/Redo & Replay Controller hooks unit tests (Issue #585 Sub-Slice 3)...');

  const undoMod = await vite.ssrLoadModule('/src/hooks/useUndoRedo.ts');
  const replayMod = await vite.ssrLoadModule('/src/hooks/useReplayController.ts');

  const {
    computeIsUndoEnabled,
    resolveUndoRedoRegion,
    applyUndoTransition,
    applyRedoTransition,
    useUndoRedo,
  } = undoMod;

  const {
    clampReplayStep,
    sliceReplayFilledRegionIds,
    buildTimelineReplaySequence,
    computeReplayRegionsPerMs,
    advanceReplayCursor,
    checkRegionVisibleInViewport,
    checkViewportCaughtUpToRegion,
    useReplayController,
  } = replayMod;

  const puzzle = makeTestPuzzle();
  const regionById = new Map(puzzle.regions.map((r) => [r.id, r]));

  // 1. computeIsUndoEnabled invariants
  assert.equal(computeIsUndoEnabled({ enableUndo: false }, false, puzzle), false);
  assert.equal(computeIsUndoEnabled({ enableUndo: true }, false, puzzle), true);
  assert.equal(computeIsUndoEnabled({ enableUndo: false }, true, puzzle), true);
  assert.equal(
    computeIsUndoEnabled({ enableUndo: false }, false, { ...puzzle, isFreeColor: true }),
    true
  );
  assert.equal(computeIsUndoEnabled({ enableUndo: false }, false, null), false);

  // 2. resolveUndoRedoRegion O(1) map vs fallback
  assert.equal(resolveUndoRedoRegion(puzzle, 102, puzzle, regionById)?.colorId, 2);
  const otherPuzzle = makeTestPuzzle({ regions: [{ ...puzzle.regions[0], id: 999, colorId: 3 }] });
  assert.equal(resolveUndoRedoRegion(otherPuzzle, 999, puzzle, regionById)?.colorId, 3);

  // 3. applyUndoTransition / applyRedoTransition guard no-ops
  const baseUndoInput = {
    puzzle,
    currentPuzzle: puzzle,
    regionById,
    isReplaying: false,
    bypassReplayCheck: false,
    isFreeColorMode: false,
    activeColorId: 2,
    settings: { enableUndo: true },
    filledRegionIds: new Set([101]),
    paintedRegionColors: new Map(),
    undoStack: [{ regionId: 101, wasPreviouslyFilled: false }],
    redoStack: [],
  };

  assert.equal(applyUndoTransition({ ...baseUndoInput, undoStack: [] }), null);
  assert.equal(applyUndoTransition({ ...baseUndoInput, puzzle: null }), null);
  assert.equal(applyUndoTransition({ ...baseUndoInput, settings: { enableUndo: false } }), null);
  assert.equal(applyUndoTransition({ ...baseUndoInput, isReplaying: true }), null);
  assert.notEqual(
    applyUndoTransition({ ...baseUndoInput, isReplaying: true, bypassReplayCheck: true }),
    null
  );

  // 4. Standard-mode undo of newly filled region (unfill + activeColorId switch + CO-OP UNFILL)
  const stdUndo = applyUndoTransition(baseUndoInput);
  assert.ok(stdUndo);
  assert.deepEqual(stdUndo.nextUndoStack, []);
  assert.deepEqual(stdUndo.nextRedoStack, [{ regionId: 101, wasPreviouslyFilled: false }]);
  assert.equal(stdUndo.nextFilledRegionIds.has(101), false);
  assert.equal(baseUndoInput.filledRegionIds.has(101), true, 'input Set must not be mutated');
  assert.equal(stdUndo.shouldUpdateActiveColor, true);
  assert.equal(stdUndo.nextActiveColorId, 1);
  assert.deepEqual(stdUndo.coopEmission, { kind: 'UNFILL', regionIds: [101] });

  // 5. Standard-mode redo restores region, pushes back to undoStack, emits FILL without custom paintedColors
  const stdRedo = applyRedoTransition({
    ...baseUndoInput,
    activeColorId: 3,
    filledRegionIds: stdUndo.nextFilledRegionIds,
    paintedRegionColors: stdUndo.nextPaintedRegionColors,
    undoStack: stdUndo.nextUndoStack,
    redoStack: stdUndo.nextRedoStack,
  });
  assert.ok(stdRedo);
  assert.deepEqual(stdRedo.nextUndoStack, [{ regionId: 101, wasPreviouslyFilled: false }]);
  assert.deepEqual(stdRedo.nextRedoStack, []);
  assert.equal(stdRedo.nextFilledRegionIds.has(101), true);
  assert.equal(stdRedo.nextPaintedRegionColors.size, 0);
  assert.equal(stdRedo.shouldUpdateActiveColor, true);
  assert.equal(stdRedo.nextActiveColorId, 1);
  assert.deepEqual(stdRedo.coopEmission, { kind: 'FILL', regionIds: [101] });

  // Empty redo stack & replay guard
  assert.equal(applyRedoTransition({ ...baseUndoInput, redoStack: [] }), null);
  assert.equal(
    applyRedoTransition({
      ...baseUndoInput,
      isReplaying: true,
      redoStack: [{ regionId: 101, wasPreviouslyFilled: false }],
    }),
    null
  );

  // 6. Free-color mode undo of re-painted region with previousPaintedColorId
  const freeRepaintUndo = applyUndoTransition({
    ...baseUndoInput,
    isFreeColorMode: true,
    activeColorId: 3,
    settings: { enableUndo: false }, // auto-enabled in free-color mode
    filledRegionIds: new Set([102]),
    paintedRegionColors: new Map([[102, 3]]),
    undoStack: [
      {
        regionId: 102,
        wasPreviouslyFilled: true,
        previousPaintedColorId: 1,
        paintedColorId: 3,
      },
    ],
    redoStack: [],
  });
  assert.ok(freeRepaintUndo);
  assert.equal(freeRepaintUndo.nextFilledRegionIds.has(102), true);
  assert.equal(freeRepaintUndo.nextPaintedRegionColors.get(102), 1);
  assert.equal(freeRepaintUndo.shouldUpdateActiveColor, false);
  assert.equal(freeRepaintUndo.nextActiveColorId, 3);
  assert.deepEqual(freeRepaintUndo.coopEmission, {
    kind: 'FILL',
    regionIds: [102],
    paintedColors: { 102: 1 },
  });

  // 7. Free-color mode undo of re-painted region with NO previousPaintedColorId restores default region color
  const freeRevertToDefaultUndo = applyUndoTransition({
    ...baseUndoInput,
    isFreeColorMode: true,
    activeColorId: 3,
    filledRegionIds: new Set([102]),
    paintedRegionColors: new Map([[102, 3]]),
    undoStack: [
      {
        regionId: 102,
        wasPreviouslyFilled: true,
        paintedColorId: 3,
      },
    ],
    redoStack: [],
  });
  assert.ok(freeRevertToDefaultUndo);
  assert.equal(freeRevertToDefaultUndo.nextFilledRegionIds.has(102), true);
  assert.equal(freeRevertToDefaultUndo.nextPaintedRegionColors.has(102), false);
  assert.deepEqual(freeRevertToDefaultUndo.coopEmission, {
    kind: 'FILL',
    regionIds: [102],
    paintedColors: { 102: 2 },
  });

  // 8. Free-color mode redo with explicit paintedColorId vs fallback to activeColorId
  const freeRedoExplicit = applyRedoTransition({
    ...baseUndoInput,
    isFreeColorMode: true,
    activeColorId: 1,
    filledRegionIds: new Set([102]),
    paintedRegionColors: new Map([[102, 1]]),
    undoStack: [],
    redoStack: [{ regionId: 102, wasPreviouslyFilled: true, previousPaintedColorId: 1, paintedColorId: 3 }],
  });
  assert.ok(freeRedoExplicit);
  assert.equal(freeRedoExplicit.nextPaintedRegionColors.get(102), 3);
  assert.equal(freeRedoExplicit.shouldUpdateActiveColor, false);
  assert.equal(freeRedoExplicit.nextActiveColorId, 1);
  assert.deepEqual(freeRedoExplicit.coopEmission, {
    kind: 'FILL',
    regionIds: [102],
    paintedColors: { 102: 3 },
  });

  const freeRedoFallback = applyRedoTransition({
    ...baseUndoInput,
    isFreeColorMode: true,
    activeColorId: 3,
    filledRegionIds: new Set(),
    paintedRegionColors: new Map(),
    undoStack: [],
    redoStack: [{ regionId: 101, wasPreviouslyFilled: false }],
  });
  assert.ok(freeRedoFallback);
  assert.equal(freeRedoFallback.nextFilledRegionIds.has(101), true);
  assert.equal(freeRedoFallback.nextPaintedRegionColors.get(101), 3);
  assert.deepEqual(freeRedoFallback.coopEmission, {
    kind: 'FILL',
    regionIds: [101],
    paintedColors: { 101: 3 },
  });

  // 9. Replay pure helpers: clampReplayStep, sliceReplayFilledRegionIds, buildTimelineReplaySequence, computeReplayRegionsPerMs
  assert.equal(clampReplayStep(-5, 10), 0);
  assert.equal(clampReplayStep(3.8, 10), 3);
  assert.equal(clampReplayStep(25, 10), 10);
  assert.equal(clampReplayStep(Number.NaN, 10), 0);
  assert.equal(clampReplayStep(5, 0), 0);

  const filledSet = new Set([101, 102, 103]);
  assert.equal(
    sliceReplayFilledRegionIds(false, [101, 102], 1, filledSet),
    filledSet,
    'non-replaying mode must return original filledRegionIds reference'
  );
  assert.deepEqual(
    Array.from(sliceReplayFilledRegionIds(true, [101, 102, 103], 0, filledSet)),
    []
  );
  assert.deepEqual(
    Array.from(sliceReplayFilledRegionIds(true, [101, 102, 103], 2, filledSet)),
    [101, 102]
  );
  assert.deepEqual(
    Array.from(sliceReplayFilledRegionIds(true, [101, 102, 103], 99, filledSet)),
    [101, 102, 103]
  );

  assert.deepEqual(
    buildTimelineReplaySequence(new Set([103, 101]), [{ regionId: 102 }]),
    [103, 101]
  );
  assert.deepEqual(
    buildTimelineReplaySequence(new Set(), [{ regionId: 102 }, { regionId: 101 }, { regionId: 102 }]),
    [102, 101]
  );
  assert.deepEqual(buildTimelineReplaySequence(new Set(), []), []);

  assert.equal(computeReplayRegionsPerMs(10, 1), 12 / 1000);
  assert.equal(computeReplayRegionsPerMs(1000, 1), 65 / 1000);
  assert.equal(computeReplayRegionsPerMs(110, 2), (20 * 2) / 1000);
  assert.equal(computeReplayRegionsPerMs(110, 0), 20 / 1000);

  // 10. advanceReplayCursor: follow mode vs offscreen fast-forward mode
  const seq = [101, 102, 103, 104];
  assert.equal(advanceReplayCursor(0, seq, 3, true, () => true), 1);
  assert.equal(advanceReplayCursor(0, seq, 0, true, () => true), 0);
  assert.equal(advanceReplayCursor(3, seq, 5, true, () => true), 4);

  // Offscreen regions (102, 104) are skipped immediately in non-follow mode
  const visibleIds = new Set([101, 103]);
  assert.equal(
    advanceReplayCursor(0, seq, 1, false, (id) => visibleIds.has(id)),
    2,
    'advancing 1 onscreen step past 101 fast-forwards offscreen 102 to land on visible 103'
  );
  assert.equal(
    advanceReplayCursor(2, seq, 1, false, (id) => visibleIds.has(id)),
    4,
    'advancing 1 onscreen step past 103 fast-forwards offscreen 104 to end'
  );

  // 11. Viewport visibility & camera-follow catchup math (including scratch reuse)
  const fitViewport = { zoomScale: 1, panOffsetX: 0, panOffsetY: 0 };
  assert.equal(checkRegionVisibleInViewport(puzzle, puzzle.regions[0], fitViewport, 1000, 1000), true);
  assert.equal(checkRegionVisibleInViewport(null, puzzle.regions[0], fitViewport, 1000, 1000), true);

  // Zoomed 3x on top-left corner: region 101 (0..100, 0..100) is visible, region 104 (900..1000, 900..1000) is offscreen
  const zoomedTopLeft = { zoomScale: 3, panOffsetX: 0, panOffsetY: 0 };
  assert.equal(
    checkRegionVisibleInViewport(puzzle, puzzle.regions[0], zoomedTopLeft, 1000, 1000),
    true
  );
  assert.equal(
    checkRegionVisibleInViewport(puzzle, puzzle.regions[3], zoomedTopLeft, 1000, 1000),
    false
  );

  const rawScratch = { x: 0, y: 0 };
  const clampedScratch = { x: 0, y: 0 };
  assert.equal(
    checkViewportCaughtUpToRegion(
      puzzle,
      puzzle.regions[3],
      fitViewport,
      1000,
      1000,
      rawScratch,
      clampedScratch
    ),
    true
  );
  assert.equal(
    checkViewportCaughtUpToRegion(
      puzzle,
      puzzle.regions[3],
      zoomedTopLeft,
      1000,
      1000,
      rawScratch,
      clampedScratch
    ),
    false,
    'far bottom-right region should not be considered caught up when panned to top-left at 3x'
  );
  // Verify scratch objects were mutated in place (zero-allocation contract)
  assert.notEqual(rawScratch.x, 0);
  assert.notEqual(rawScratch.y, 0);

  // Centered on region 103 (500, 500) at 3x zoom -> caught up
  const baseScale = Math.min(1000 / 1000, 1000 / 1000) * 0.92;
  const baseOffset = (1000 - 1000 * baseScale) / 2;
  const effScale = 3 * baseScale;
  const centeredPan = 500 - (baseOffset + 500 * effScale);
  assert.equal(
    checkViewportCaughtUpToRegion(
      puzzle,
      puzzle.regions[2],
      { zoomScale: 3, panOffsetX: centeredPan, panOffsetY: centeredPan },
      1000,
      1000,
      rawScratch,
      clampedScratch
    ),
    true
  );

  // 12. SSR safety of both React hooks via renderToStaticMarkup
  let capturedUndoApi = null;
  let capturedReplayApi = null;
  function SsrHarness() {
    const liveCoopRef = React.useRef({
      puzzle,
      activeSnapshotId: null,
      filledRegionIds: new Set([101]),
      paintedRegionColors: new Map(),
      isFreeColorMode: false,
      activeColorId: 1,
      settings: { enableUndo: true, hapticsEnabled: false, replaySpeed: 1, replayLoop: false, replayFollow: false },
    });
    const viewportRef = React.useRef({ zoomScale: 1, panOffsetX: 0, panOffsetY: 0 });
    const containerSizeRef = React.useRef({ width: 1000, height: 1000 });
    const regionByIdRef = React.useRef(regionById);
    const flushRef = React.useRef(() => {});
    const showTutorialRef = React.useRef(false);
    const tutorialStepRef = React.useRef(0);
    const settingsRef = React.useRef(liveCoopRef.current.settings);

    const replay = useReplayController({
      puzzle,
      filledRegionIds: liveCoopRef.current.filledRegionIds,
      settings: liveCoopRef.current.settings,
      settingsRef,
      liveCoopRef,
      viewportRef,
      canvasContainerSizeRef: containerSizeRef,
      regionByIdRef,
      flushPendingViewportSaveRef: flushRef,
      showTutorialRef,
      tutorialStepRef,
      handleUpdateSettings: () => {},
      setHintRegionId: () => {},
      markTutorialActionTried: () => {},
      triggerFeatureOffer: () => {},
    });

    const focusEvents = [];
    const undoRedo = useUndoRedo({
      puzzle,
      settings: liveCoopRef.current.settings,
      isFreeColorMode: false,
      liveCoopRef,
      viewportRef,
      regionByIdRef,
      isReplayingRef: replay.isReplayingRef,
      emitCoopPaint: () => {},
      emitCoopUnfill: () => {},
      setFilledRegionIds: () => {},
      setPaintedRegionColors: () => {},
      setActiveColorId: () => {},
      setHintRegionId: () => {},
      setSnapshots: () => {},
      markTutorialActionTried: () => {},
      triggerFeatureOffer: () => {},
      onFocusRegion: (regionId, kind) => {
        focusEvents.push({ regionId, kind });
      },
    });

    capturedReplayApi = replay;
    capturedUndoApi = { ...undoRedo, focusEvents };
    return React.createElement('div', null, `${undoRedo.isUndoEnabled}:${replay.isReplaying}`);
  }

  const ssrHtml = renderToStaticMarkup(React.createElement(SsrHarness));
  assert.equal(ssrHtml, '<div>true:false</div>');
  assert.equal(typeof capturedUndoApi.syncUndoStack, 'function');
  assert.equal(typeof capturedUndoApi.syncRedoStack, 'function');
  assert.equal(typeof capturedUndoApi.handleUndo, 'function');
  assert.equal(typeof capturedUndoApi.handleRedo, 'function');
  // Empty-stack undo/redo no-ops must not fire onFocusRegion
  capturedUndoApi.handleUndo();
  capturedUndoApi.handleRedo();
  assert.deepEqual(
    capturedUndoApi.focusEvents,
    [],
    'Empty-stack undo/redo no-ops must not invoke onFocusRegion'
  );
  // Seed undo stack synchronously and verify undo -> redo fire onFocusRegion with exact (regionId, kind)
  capturedUndoApi.syncUndoStack([{ regionId: 1, wasPreviouslyFilled: false }]);
  capturedUndoApi.handleUndo();
  capturedUndoApi.handleRedo();
  assert.deepEqual(
    capturedUndoApi.focusEvents,
    [
      { regionId: 1, kind: 'undo' },
      { regionId: 1, kind: 'redo' },
    ],
    'useUndoRedo must invoke onFocusRegion(regionId, kind) on valid undo and redo transitions'
  );
  assert.equal(typeof capturedReplayApi.cancelAutoResume, 'function');
  assert.equal(typeof capturedReplayApi.resetReplayState, 'function');
  assert.equal(typeof capturedReplayApi.exitReplay, 'function');
  assert.equal(typeof capturedReplayApi.dismissPostLoadReplayIfAwaiting, 'function');
  assert.equal(typeof capturedReplayApi.startReplay, 'function');
  assert.equal(typeof capturedReplayApi.handleOpenTimelineReplay, 'function');
  assert.equal(capturedReplayApi.dismissPostLoadReplayIfAwaiting(), false);

  // 13. Static source guardrails: zero direct localStorage calls, zero viewport reset mutations, clean timer/rAF teardown
  const undoSrc = fs.readFileSync(path.join(projectRoot, 'src/hooks/useUndoRedo.ts'), 'utf8');
  const replaySrc = fs.readFileSync(
    path.join(projectRoot, 'src/hooks/useReplayController.ts'),
    'utf8'
  );
  const canvasSrc = fs.readFileSync(
    path.join(projectRoot, 'src/components/PuzzleCanvas.tsx'),
    'utf8'
  );
  assert.doesNotMatch(undoSrc, /\blocalStorage\./, 'useUndoRedo.ts must not access localStorage directly');
  assert.doesNotMatch(replaySrc, /\blocalStorage\./, 'useReplayController.ts must not access localStorage directly');
  assert.doesNotMatch(
    replaySrc,
    /\b(setInitialViewport|setResetViewTrigger|setRestoreViewTrigger)\b/,
    'useReplayController.ts must never move/reset/zoom viewport'
  );
  assert.match(replaySrc, /cancelAnimationFrame\(animId\)/, 'useReplayController.ts must cancel rAF on cleanup');
  assert.match(replaySrc, /clearTimeout\(autoResumeTimerRef\.current\)/, 'useReplayController.ts must clear autoResume timer');
  assert.match(replaySrc, /followRawScratchRef/, 'useReplayController.ts must reuse followRawScratchRef');
  assert.match(replaySrc, /followClampedScratchRef/, 'useReplayController.ts must reuse followClampedScratchRef');
  assert.match(
    canvasSrc,
    /cancelAnimationFrame\(focusAnimIdRef\.current\)/,
    'PuzzleCanvas.tsx must cancel focusAnimIdRef on cleanup/stop'
  );
  assert.match(
    canvasSrc,
    /focusRawScratchRef/,
    'PuzzleCanvas.tsx must reuse focusRawScratchRef in focus glide loop'
  );
  assert.match(
    canvasSrc,
    /focusClampedScratchRef/,
    'PuzzleCanvas.tsx must reuse focusClampedScratchRef in focus glide loop'
  );
  assert.doesNotMatch(
    canvasSrc,
    /\boffsetRef\.current\s*=/,
    'PuzzleCanvas.tsx must never replace offsetRef.current with aliased React state objects (mutate .x/.y in place)'
  );
  assert.match(
    canvasSrc,
    /prev !== o && prev\.x === o\.x && prev\.y === o\.y/,
    'PuzzleCanvas.tsx commitTransformState must guard against aliased offset state'
  );
  assert.match(
    canvasSrc,
    /if \(wasActive && commitIfActive\)[\s\S]*commitTransformState\(true\)/,
    'PuzzleCanvas.tsx stopFocusCamera must flush commitTransformState(true) when cancelling an active glide mid-flight'
  );

  console.log('   PASS: Undo/Redo & Replay Controller hooks unit tests (Issue #585 Sub-Slice 3)');
}
