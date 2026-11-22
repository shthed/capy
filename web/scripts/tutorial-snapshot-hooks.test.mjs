import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');

function createRef(current) {
  return { current };
}

function createSamplePuzzle() {
  return {
    width: 4,
    height: 4,
    palette: [
      { id: 1, hex: '#ff0000', isLight: false, argb: 0xffff0000, r: 255, g: 0, b: 0 },
      { id: 2, hex: '#00ff00', isLight: true, argb: 0xff00ff00, r: 0, g: 255, b: 0 },
    ],
    regions: [
      { id: 10, colorId: 1, pixels: new Int32Array([0, 1]), centroidX: 1, centroidY: 1, maxRadius: 2 },
      { id: 11, colorId: 1, pixels: new Int32Array([2, 3]), centroidX: 3, centroidY: 1, maxRadius: 2 },
      { id: 12, colorId: 2, pixels: new Int32Array([4, 5]), centroidX: 1, centroidY: 3, maxRadius: 2 },
    ],
    regionMap: new Int32Array(16),
    borderMap: new Uint8Array(16),
    isFreeColor: false,
  };
}

export async function runTutorialSnapshotHooksTests(vite) {
  const exporter = await vite.ssrLoadModule('/src/services/artworkExporter.ts');
  const tutorialMod = await vite.ssrLoadModule('/src/hooks/useTutorialAndOffers.ts');
  const viewportMod = await vite.ssrLoadModule('/src/hooks/useViewportAndShortcuts.ts');
  const paintMod = await vite.ssrLoadModule('/src/hooks/usePaintController.ts');
  const snapshotMod = await vite.ssrLoadModule('/src/hooks/useSnapshotLibrary.ts');
  const typesMod = await vite.ssrLoadModule('/src/types/index.ts');
  const storageMod = await vite.ssrLoadModule('/src/services/StorageService.ts');
  const telemetryMod = await vite.ssrLoadModule('/src/services/telemetry.ts');
  const nativeBridgeMod = await vite.ssrLoadModule('/src/services/NativeBridge.ts');

  // 1. artworkExporter.ts pure helpers & hardening
  assert.equal(exporter.buildArtworkPngFileName('Cozy Capybara! #1'), 'cozy-capybara-1.png');
  assert.equal(exporter.buildArtworkPngFileName('   '), 'capy-artwork.png');
  assert.equal(exporter.buildArtworkPngFileName('!!!'), 'capy-artwork.png');
  assert.equal(exporter.buildArtworkPngFileName('---Hello---'), 'hello.png');
  assert.equal(exporter.buildSnapshotArchiveFileName('My Save (2x)'), 'My_Save__2x_.capy');
  assert.equal(exporter.buildSnapshotArchiveFileName(''), 'puzzle.capy');

  const scaledDims = exporter.computePreviewDimensions(1600, 800, 320);
  assert.equal(scaledDims.width, 320);
  assert.equal(scaledDims.height, 160);
  assert.equal(scaledDims.scale, 0.2);

  const smallDims = exporter.computePreviewDimensions(100, 50, 320);
  assert.equal(smallDims.width, 100);
  assert.equal(smallDims.height, 50);
  assert.equal(smallDims.scale, 1);

  assert.deepEqual(exporter.computePreviewDimensions(NaN, 100), { width: 0, height: 0, scale: 0 });
  assert.deepEqual(exporter.computePreviewDimensions(0, 100), { width: 0, height: 0, scale: 0 });
  assert.deepEqual(exporter.computePreviewDimensions(-50, 100), { width: 0, height: 0, scale: 0 });
  assert.deepEqual(exporter.computePreviewDimensions(Infinity, 100), {
    width: 0,
    height: 0,
    scale: 0,
  });

  const puzzle = createSamplePuzzle();
  // SSR safety when document is undefined
  assert.equal(exporter.generatePreviewDataUrl(puzzle, {}, new Set()), '');
  assert.doesNotThrow(() =>
    exporter.exportColoredArtworkPng({
      puzzle,
      sourceImage: {},
      filledRegionIds: new Set(),
      paintedRegionColors: new Map(),
      title: 'SSR Test',
      hapticsEnabled: false,
    })
  );

  // Share rejection inside canvas.toBlob must be caught and reported via reportSwallowed
  telemetryMod.clearSwallowedErrorLog();
  const prevDoc = globalThis.document;
  const origShare = nativeBridgeMod.NativeBridge.exportOrShareFile;
  try {
    nativeBridgeMod.NativeBridge.exportOrShareFile = async () => {
      throw new Error('simulated share failure');
    };
    globalThis.document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
          putImageData: () => {},
          drawImage: () => {},
          globalCompositeOperation: 'source-over',
        }),
        toBlob: (cb) => cb(new Blob(['png'])),
      }),
    };
    exporter.exportColoredArtworkPng({
      puzzle,
      sourceImage: {},
      filledRegionIds: new Set([10, 11, 12]),
      paintedRegionColors: new Map(),
      title: 'Share Error Test',
      hapticsEnabled: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(
      telemetryMod
        .getSwallowedErrorLog()
        .some((entry) => entry.scope === 'artworkExporter.exportColoredArtworkPng.share'),
      'exportColoredArtworkPng must report share rejections via reportSwallowed'
    );
  } finally {
    globalThis.document = prevDoc;
    nativeBridgeMod.NativeBridge.exportOrShareFile = origShare;
  }

  // Catch blocks in archive import/export report via reportSwallowed
  telemetryMod.clearSwallowedErrorLog();
  const failedImport = await exporter.importSnapshotsArchive(
    {
      arrayBuffer: async () => {
        throw new Error('simulated read failure');
      },
    },
    false
  );
  assert.equal(failedImport.ok, false);
  assert.ok(
    telemetryMod
      .getSwallowedErrorLog()
      .some((entry) => entry.scope === 'artworkExporter.importSnapshotsArchive'),
    'importSnapshotsArchive must report failures via reportSwallowed'
  );
  const rgba = new Uint8ClampedArray(16 * 4);
  exporter.writeFreeColorRegionPixels(rgba, puzzle, new Set([10, 12]), new Map([[10, 2]]));
  // Pixel 0 belongs to region 10 overridden to color 2 (0, 255, 0)
  assert.deepEqual(Array.from(rgba.slice(0, 4)), [0, 255, 0, 255]);
  // Pixel 2 belongs to unfilled region 11 -> remains opaque white
  assert.deepEqual(Array.from(rgba.slice(8, 12)), [255, 255, 255, 255]);
  // Pixel 4 belongs to region 12 default color 2 (0, 255, 0)
  assert.deepEqual(Array.from(rgba.slice(16, 20)), [0, 255, 0, 255]);

  // 2. useTutorialAndOffers.ts pure helpers + SSR smoke test
  assert.equal(tutorialMod.clampTutorialStepIndex(-5), 0);
  assert.equal(tutorialMod.clampTutorialStepIndex(999), 11);
  assert.equal(tutorialMod.clampTutorialStepIndex(NaN), 0);
  assert.equal(tutorialMod.clampTutorialStepIndex(Infinity), 0);
  assert.equal(tutorialMod.clampTutorialStepIndex(-Infinity), 0);
  assert.equal(tutorialMod.clampTutorialStepIndex(1.7), 1);

  const queue = ['paint_mode', 'free_color', 'saves_export'];
  const firstOffer = tutorialMod.dequeueNextUnseenOffer(queue, (id) => id === 'paint_mode');
  assert.equal(firstOffer?.id, 'free_color');
  assert.deepEqual(queue, ['saves_export']);
  const noneLeft = tutorialMod.dequeueNextUnseenOffer(queue, () => true);
  assert.equal(noneLeft, null);
  assert.deepEqual(queue, []);

  // Unknown offer IDs must be skipped instead of abandoning valid later offers
  const queueWithUnknown = ['nonexistent_offer_id', 'free_color', 'saves_export'];
  const skippedUnknownOffer = tutorialMod.dequeueNextUnseenOffer(queueWithUnknown, () => false);
  assert.equal(skippedUnknownOffer?.id, 'free_color');
  assert.deepEqual(queueWithUnknown, ['saves_export']);

  const baseSettings = storageMod.DEFAULT_SETTINGS;
  assert.deepEqual(
    tutorialMod.classifySettingsChangeForTutorial(
      { ...baseSettings, isFreeColorMode: false },
      { ...baseSettings, isFreeColorMode: true }
    ),
    { action: 'free_color', offer: 'free_color' }
  );
  assert.deepEqual(
    tutorialMod.classifySettingsChangeForTutorial(
      { ...baseSettings, isFreeColorMode: true },
      { ...baseSettings, isFreeColorMode: false }
    ),
    { action: 'free_color' }
  );
  assert.deepEqual(
    tutorialMod.classifySettingsChangeForTutorial(
      { ...baseSettings, hintIntensity: 0.5 },
      { ...baseSettings, hintIntensity: 0.9 }
    ),
    { action: 'hints' }
  );
  assert.deepEqual(
    tutorialMod.classifySettingsChangeForTutorial(
      { ...baseSettings, soundEnabled: true },
      { ...baseSettings, soundEnabled: false }
    ),
    { action: 'settings' }
  );

  const enabledLarge = tutorialMod.toggleTutorialLargeTextSettings({
    ...baseSettings,
    largeText: false,
    textScale: 1.0,
    uiScale: 1.0,
    fatFingerAssist: false,
  });
  assert.equal(enabledLarge.largeText, true);
  assert.equal(enabledLarge.textScale, 1.25);
  assert.equal(enabledLarge.uiScale, 1.25);
  assert.equal(enabledLarge.fatFingerAssist, true);

  const disabledLarge = tutorialMod.toggleTutorialLargeTextSettings(enabledLarge);
  assert.equal(disabledLarge.largeText, false);
  assert.equal(disabledLarge.textScale, 1.0);
  assert.equal(disabledLarge.uiScale, 1.0);

  const modalSpotlight = tutorialMod.deriveTutorialSpotlightState({
    isLoading: false,
    showTutorial: true,
    tutorialStep: 10, // settings modal step
    showSettings: true,
    showPaletteOptions: false,
    isPreviewMode: false,
    activeFeatureOffer: null,
    isFeatureOfferSuppressed: true,
  });
  assert.equal(modalSpotlight.isActive, true);
  assert.equal(modalSpotlight.isModalSpotlight, true);
  assert.equal(modalSpotlight.zIndexClass, 'z-[58]');
  assert.equal(modalSpotlight.variant, 'tutorial');

  const offerSpotlight = tutorialMod.deriveTutorialSpotlightState({
    isLoading: false,
    showTutorial: false,
    tutorialStep: 0,
    showSettings: false,
    showPaletteOptions: false,
    isPreviewMode: false,
    activeFeatureOffer: { id: 'paint_mode', title: 'Paint Mode', description: 'Drag to paint', tutorialStepIndex: 1 },
    isFeatureOfferSuppressed: false,
  });
  assert.equal(offerSpotlight.isActive, true);
  assert.equal(offerSpotlight.variant, 'offer');
  assert.equal(offerSpotlight.targetKey, 'paint_mode');
  assert.equal(offerSpotlight.zIndexClass, 'z-[38]');

  // SSR smoke test for useTutorialAndOffers
  let capturedTutorialApi = null;
  function TutorialHarness() {
    capturedTutorialApi = tutorialMod.useTutorialAndOffers({
      isLoading: false,
      puzzle: null,
      isPreviewMode: false,
      isPreviewModeRef: createRef(false),
      showSettings: false,
      showSettingsRef: createRef(false),
      showPaletteOptions: false,
      activeSettingsTab: 1,
      activeSettingsTabRef: createRef(1),
      settingsRef: createRef(baseSettings),
      exitTutorialReplayRef: createRef(() => {}),
      setIsPreviewMode: () => {},
      setShowSettings: () => {},
      setSettingsInitialTab: () => {},
      setSettingsTabRequestKey: () => {},
      setActiveSettingsTab: () => {},
      handleUpdateSettings: () => {},
    });
    return React.createElement('div', null, String(capturedTutorialApi.showTutorial));
  }
  const tutorialHtml = renderToStaticMarkup(React.createElement(TutorialHarness));
  assert.equal(tutorialHtml, '<div>false</div>');
  assert.equal(typeof capturedTutorialApi.completeTutorial, 'function');
  assert.equal(typeof capturedTutorialApi.triggerFeatureOffer, 'function');
  assert.equal(typeof capturedTutorialApi.handleSettingsTabOpened, 'function');

  // 3. useViewportAndShortcuts.ts pure helpers + SSR smoke test
  assert.equal(viewportMod.isEditableKeyboardTarget({ tagName: 'input' }), true);
  assert.equal(viewportMod.isEditableKeyboardTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(viewportMod.isEditableKeyboardTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(viewportMod.isEditableKeyboardTarget({ tagName: 'DIV', isContentEditable: false }), false);
  assert.equal(viewportMod.isEditableKeyboardTarget(null), false);

  assert.deepEqual(viewportMod.resolveViewportShortcutAction('+'), { kind: 'zoom_in' });
  assert.deepEqual(viewportMod.resolveViewportShortcutAction('-'), { kind: 'zoom_out' });
  assert.deepEqual(viewportMod.resolveViewportShortcutAction('0'), { kind: 'reset_view' });
  assert.deepEqual(viewportMod.resolveViewportShortcutAction('w'), { kind: 'pan', dx: 0, dy: 64 });
  assert.deepEqual(viewportMod.resolveViewportShortcutAction('ArrowRight'), { kind: 'pan', dx: -64, dy: 0 });
  assert.equal(viewportMod.resolveViewportShortcutAction('q'), null);

  const savedExt = { snapshotId: 's1', zoomScale: 2.0, panOffsetX: 10.5, panOffsetY: -4.25 };
  assert.equal(viewportMod.isSameViewportExtent(savedExt, 's1', 2.0, 10.5, -4.25), true);
  assert.equal(viewportMod.isSameViewportExtent(savedExt, 's2', 2.0, 10.5, -4.25), false);
  assert.equal(viewportMod.isSameViewportExtent(savedExt, 's1', 2.1, 10.5, -4.25), false);

  const prevSet = new Set([1, 2, 3]);
  const sameSet = new Set([3, 2, 1]);
  const diffSet = new Set([1, 2, 4]);
  assert.equal(viewportMod.mergeNumberSetIfChanged(prevSet, sameSet), prevSet);
  assert.equal(viewportMod.mergeNumberSetIfChanged(prevSet, diffSet), diffSet);

  let capturedViewportApi = null;
  function ViewportHarness() {
    capturedViewportApi = viewportMod.useViewportAndShortcuts({
      puzzle: null,
      isLoading: false,
      isLoadingRef: createRef(false),
      isReplaying: false,
      showSettings: false,
      showPaletteOptions: false,
      isUndoEnabled: true,
      viewportRef: createRef({ zoomScale: 1, panOffsetX: 0, panOffsetY: 0 }),
      canvasContainerSizeRef: createRef({ width: 800, height: 600 }),
      flushPendingViewportSaveRef: createRef(() => {}),
      snapshotTransitioningRef: createRef(false),
      liveCoopRef: createRef({
        puzzle: null,
        activeSnapshotId: null,
        activeSave: undefined,
        activeTitle: 'Capy',
        filledRegionIds: new Set(),
        paintedRegionColors: new Map(),
        isFreeColorMode: false,
        activeColorId: 1,
        settings: baseSettings,
      }),
      setSnapshots: () => {},
      setActiveColorId: () => {},
      setHintRegionId: () => {},
      handleUndo: () => {},
      handleRedo: () => {},
      dismissPostLoadReplayIfAwaiting: () => false,
      markTutorialActionTried: () => {},
    });
    return React.createElement('div', null, String(capturedViewportApi.isFullscreen));
  }
  const viewportHtml = renderToStaticMarkup(React.createElement(ViewportHarness));
  assert.equal(viewportHtml, '<div>false</div>');
  assert.equal(typeof capturedViewportApi.applyViewport, 'function');
  assert.equal(typeof capturedViewportApi.flushPendingViewportSave, 'function');

  // 4. usePaintController.ts pure helpers + SSR smoke test
  const parsedWhite = paintMod.parseHexToPaletteFields('ffffff');
  assert.equal(parsedWhite?.hex, '#ffffff');
  assert.equal(parsedWhite?.isLight, true);
  assert.equal(parsedWhite?.argb, 0xffffffff);
  const parsedDark = paintMod.parseHexToPaletteFields('#112233');
  assert.equal(parsedDark?.isLight, false);
  assert.equal(parsedDark?.r, 0x11);
  assert.equal(parsedDark?.g, 0x22);
  assert.equal(parsedDark?.b, 0x33);
  const parsedShort = paintMod.parseHexToPaletteFields('#123');
  assert.equal(parsedShort?.hex, '#112233');
  assert.equal(parsedShort?.r, 0x11);
  assert.equal(parsedShort?.g, 0x22);
  assert.equal(parsedShort?.b, 0x33);
  const parsedShortNoHash = paintMod.parseHexToPaletteFields('AbC');
  assert.equal(parsedShortNoHash?.hex, '#aabbcc');
  assert.equal(parsedShortNoHash?.isLight, true);
  assert.equal(paintMod.parseHexToPaletteFields(''), null);
  assert.equal(paintMod.parseHexToPaletteFields('not-a-hex'), null);
  assert.equal(paintMod.parseHexToPaletteFields('#ZZZ'), null);
  assert.equal(paintMod.parseHexToPaletteFields('##ff0000'), null);
  assert.equal(paintMod.parseHexToPaletteFields('#12345'), null);

  assert.equal(paintMod.computeNextCustomColorId([]), 1);
  assert.equal(paintMod.computeNextCustomColorId(puzzle.palette), 3);

  // Prefer visible region 11 over off-screen region 10 for color 1
  const hintVisible = paintMod.selectHintTargetRegion(
    puzzle.regions,
    1,
    new Set(),
    new Set([11])
  );
  assert.equal(hintVisible?.id, 11);
  // Fallback to off-screen region 10 when region 11 is filled
  const hintFallback = paintMod.selectHintTargetRegion(
    puzzle.regions,
    1,
    new Set([11]),
    new Set([11])
  );
  assert.equal(hintFallback?.id, 10);
  // Null when all matching regions are filled
  assert.equal(
    paintMod.selectHintTargetRegion(puzzle.regions, 1, new Set([10, 11]), new Set()),
    null
  );

  const completedIds = paintMod.buildCompletedSnapshotIdSet([
    { id: 'done', filledCount: 10, totalCount: 10 },
    { id: 'wip', filledCount: 5, totalCount: 10 },
    { id: 'empty', filledCount: 0, totalCount: 0 },
  ]);
  assert.deepEqual(Array.from(completedIds), ['done']);

  let capturedPaintApi = null;
  function PaintHarness() {
    capturedPaintApi = paintMod.usePaintController({
      puzzle: null,
      isLoading: false,
      isReplaying: false,
      showSettings: false,
      showPaletteOptions: false,
      filledRegionCount: 0,
      initialSnapshots: [],
      liveCoopRef: createRef({
        puzzle: null,
        activeSnapshotId: null,
        activeSave: undefined,
        activeTitle: 'Capy',
        filledRegionIds: new Set(),
        paintedRegionColors: new Map(),
        isFreeColorMode: false,
        activeColorId: 1,
        settings: baseSettings,
      }),
      viewportRef: createRef({ zoomScale: 1, panOffsetX: 0, panOffsetY: 0 }),
      regionByIdRef: createRef(new Map()),
      visibleColorIdsRef: createRef(new Set()),
      visibleRegionIdsRef: createRef(new Set()),
      sourceImageRef: createRef(null),
      isReplayingRef: createRef(false),
      isPostLoadReplayRef: createRef(false),
      exitReplay: () => {},
      startReplay: () => {},
      emitCoopPaint: () => {},
      isCoopSessionActive: () => false,
      syncUndoStack: () => {},
      syncRedoStack: () => {},
      setPuzzle: () => {},
      setFilledRegionIds: () => {},
      setPaintedRegionColors: () => {},
      setActiveColorId: () => {},
      setHintRegionId: () => {},
      setSnapshots: () => {},
      setLifetimeStats: () => {},
      markTutorialActionTried: () => {},
    });
    return React.createElement('div', null, 'paint-ok');
  }
  assert.equal(renderToStaticMarkup(React.createElement(PaintHarness)), '<div>paint-ok</div>');
  assert.equal(typeof capturedPaintApi.attemptFillRegion, 'function');
  assert.equal(typeof capturedPaintApi.triggerHint, 'function');

  // Guard regressions on live usePaintController handlers
  let paintSetPuzzleCalls = 0;
  let paintSetActiveColorCalls = 0;
  const loadedPaintCoopRef = createRef({
    puzzle,
    activeSnapshotId: 'snap-guard',
    activeSave: undefined,
    activeTitle: 'Capy',
    filledRegionIds: new Set([12]), // color 2 is already 100% filled
    paintedRegionColors: new Map(),
    isFreeColorMode: false,
    activeColorId: 1,
    settings: baseSettings,
  });
  let guardedPaintApi = null;
  function GuardedPaintHarness() {
    guardedPaintApi = paintMod.usePaintController({
      puzzle,
      isLoading: false,
      isReplaying: false,
      showSettings: false,
      showPaletteOptions: false,
      filledRegionCount: 1,
      initialSnapshots: [],
      liveCoopRef: loadedPaintCoopRef,
      viewportRef: createRef({ zoomScale: 1, panOffsetX: 0, panOffsetY: 0 }),
      regionByIdRef: createRef(new Map(puzzle.regions.map((r) => [r.id, r]))),
      visibleColorIdsRef: createRef(new Set([1, 2])),
      visibleRegionIdsRef: createRef(new Set([10, 11])),
      sourceImageRef: createRef(null),
      isReplayingRef: createRef(false),
      isPostLoadReplayRef: createRef(false),
      exitReplay: () => {},
      startReplay: () => {},
      emitCoopPaint: () => {},
      isCoopSessionActive: () => false,
      syncUndoStack: () => {},
      syncRedoStack: () => {},
      setPuzzle: () => {
        paintSetPuzzleCalls += 1;
      },
      setFilledRegionIds: () => {},
      setPaintedRegionColors: () => {},
      setActiveColorId: () => {
        paintSetActiveColorCalls += 1;
      },
      setHintRegionId: () => {},
      setSnapshots: () => {},
      setLifetimeStats: () => {},
      markTutorialActionTried: () => {},
    });
    return React.createElement('div', null, 'paint-guard-ok');
  }
  assert.equal(
    renderToStaticMarkup(React.createElement(GuardedPaintHarness)),
    '<div>paint-guard-ok</div>'
  );

  assert.doesNotThrow(() =>
    guardedPaintApi.handleApplyPresetPalette({ id: 'empty', name: 'Empty', colors: [] })
  );
  assert.doesNotThrow(() =>
    guardedPaintApi.handleApplyPresetPalette({
      id: 'invalid',
      name: 'Invalid',
      colors: ['not-a-hex', '#ZZZ'],
    })
  );
  guardedPaintApi.handleAddCustomColor('');
  guardedPaintApi.handleAddCustomColor('not-a-hex');
  guardedPaintApi.handleAddCustomColor('##ff0000');
  guardedPaintApi.handleUpdateColor(999, '#112233'); // non-existent colorId
  guardedPaintApi.handleUpdateColor(1, '#ff0000'); // unchanged hex
  guardedPaintApi.handleUpdateColor(1, '#ZZZ'); // invalid hex
  assert.equal(paintSetPuzzleCalls, 0);
  assert.equal(paintSetActiveColorCalls, 0);

  // triggerHint must not mutate activeColorId when target color has no unfilled regions
  guardedPaintApi.triggerHint(999);
  guardedPaintApi.triggerHint(2);
  assert.equal(loadedPaintCoopRef.current.activeColorId, 1);
  assert.equal(paintSetActiveColorCalls, 0);

  // 5. useSnapshotLibrary.ts pure helpers + SSR smoke test
  assert.equal(snapshotMod.isDefaultGeneratorConfig(typesMod.DEFAULT_GENERATOR_CONFIG), true);
  assert.equal(snapshotMod.isMaxGeneratorConfig(typesMod.MAX_GENERATOR_CONFIG), true);
  assert.equal(snapshotMod.isDefaultGeneratorConfig(typesMod.MAX_GENERATOR_CONFIG), false);

  assert.equal(
    snapshotMod.resolveBlobIdForSnapshot({
      id: 'snap-1',
      sourceRef: { kind: 'blob', uri: 'blob-uri-9' },
    }),
    'blob-uri-9'
  );
  assert.equal(snapshotMod.resolveBlobIdForSnapshot({ id: 'snap-2' }), 'snap-2');

  assert.equal(
    snapshotMod.shouldUsePrebakedSample({
      skipBootstrap: true,
      prebakedSnapshotId: 'daily-1',
    }),
    false
  );
  assert.equal(
    snapshotMod.shouldUsePrebakedSample({
      skipBootstrap: false,
      forceGeneratorConfig: typesMod.DEFAULT_GENERATOR_CONFIG,
    }),
    true
  );
  assert.equal(
    snapshotMod.shouldUsePrebakedSample({
      skipBootstrap: false,
      forceGeneratorConfig: { ...typesMod.DEFAULT_GENERATOR_CONFIG, maxRegions: 123 },
    }),
    false
  );

  // Monotonic resetEpoch dominance across all 4 sources (including malformed epochs)
  assert.equal(snapshotMod.computeNextResetEpoch(0, 0, 0, 0), 1);
  assert.equal(snapshotMod.computeNextResetEpoch(2, 5, 3, 4), 6);
  assert.equal(snapshotMod.computeNextResetEpoch(undefined, 1, undefined, 7), 8);
  assert.equal(snapshotMod.computeNextResetEpoch(NaN, 2, 1, 0), 3);
  assert.equal(snapshotMod.computeNextResetEpoch(-5, -2, -3, -1), 1);
  assert.equal(snapshotMod.computeNextResetEpoch(-10, -20, -30, -40), 1);
  assert.equal(snapshotMod.computeNextResetEpoch(Infinity, 2, 1, 0), 3);
  assert.equal(snapshotMod.computeNextResetEpoch(1.9, 2.8, undefined, -4), 3);

  // Safe blob: URL commit & revocation plan without premature revocation
  const usedPlan = snapshotMod.resolveBlobUrlCommitPlan(
    'blob:new-1',
    'blob:new-1',
    'blob:old-1'
  );
  assert.equal(usedPlan.nextActiveBlobUrl, 'blob:new-1');
  assert.deepEqual(usedPlan.urlsToRevoke, ['blob:old-1']);

  const unusedPlan = snapshotMod.resolveBlobUrlCommitPlan(
    'blob:unused-1',
    'data:image/jpeg;base64,abc',
    'blob:old-2'
  );
  assert.equal(unusedPlan.nextActiveBlobUrl, null);
  assert.deepEqual(unusedPlan.urlsToRevoke, ['blob:unused-1', 'blob:old-2']);

  const sameUrlPlan = snapshotMod.resolveBlobUrlCommitPlan(
    'blob:same',
    'blob:same',
    'blob:same'
  );
  assert.equal(sameUrlPlan.nextActiveBlobUrl, 'blob:same');
  assert.deepEqual(sameUrlPlan.urlsToRevoke, []);

  // Non-blob URLs must never be placed in urlsToRevoke or nextActiveBlobUrl
  const nonBlobPlan = snapshotMod.resolveBlobUrlCommitPlan(
    'data:image/png;base64,AAA',
    './assets/capybara.webp',
    'https://example.com/old.png'
  );
  assert.equal(nonBlobPlan.nextActiveBlobUrl, null);
  assert.deepEqual(nonBlobPlan.urlsToRevoke, []);

  assert.deepEqual(snapshotMod.computeDetailTileCrop(1000, 600), {
    cropX: 250,
    cropY: 150,
    cropW: 500,
    cropH: 300,
  });
  assert.deepEqual(snapshotMod.computeDetailTileCrop(64, 64), {
    cropX: 0,
    cropY: 0,
    cropW: 64,
    cropH: 64,
  });
  assert.deepEqual(snapshotMod.computeDetailTileCrop(200, 100), {
    cropX: 36,
    cropY: 0,
    cropW: 128,
    cropH: 100,
  });
  assert.deepEqual(snapshotMod.computeDetailTileCrop(0, -10), {
    cropX: 0,
    cropY: 0,
    cropW: 0,
    cropH: 0,
  });
  assert.equal(snapshotMod.buildDetailTileTitle('Capybara'), 'Capybara (2x Detail)');
  assert.equal(
    snapshotMod.buildDetailTileTitle('Capybara (2x Detail)'),
    'Capybara (2x Detail)'
  );

  const mergedSample = snapshotMod.resolvePrebakedSampleProgress({
    sample: {
      id: 's1',
      title: 'Capybara',
      assetPath: './assets/capybara.webp',
      category: 'Animals',
    },
    prebakedSnap: {
      id: 'snap-prebaked',
      title: 'Capybara',
      timestamp: 100,
      lastOpened: 100,
      filledCount: 1,
      totalCount: 3,
      filledRegionIds: [10],
      resetEpoch: 1,
    },
    cachedPuzzle: puzzle,
    deltaFilledIds: [11, 999], // 999 is invalid and must be filtered out
    deltaResetEpoch: 2, // higher epoch dominates local [10]
  });
  assert.deepEqual(mergedSample.orderedIds, [11]);
  assert.equal(mergedSample.mergedEpoch, 2);
  assert.equal(mergedSample.isFree, false);

  let capturedSnapshotApi = null;
  function SnapshotHarness() {
    capturedSnapshotApi = snapshotMod.useSnapshotLibrary({
      puzzle: null,
      sourceImage: null,
      snapshots: [],
      activeSnapshotId: null,
      activeSave: undefined,
      activeTitle: 'Capy',
      filledRegionIds: new Set(),
      paintedRegionColors: new Map(),
      isFreeColorMode: false,
      settings: baseSettings,
      liveCoopRef: createRef({
        puzzle: null,
        activeSnapshotId: null,
        activeSave: undefined,
        activeTitle: 'Capy',
        filledRegionIds: new Set(),
        paintedRegionColors: new Map(),
        isFreeColorMode: false,
        activeColorId: 1,
        settings: baseSettings,
      }),
      latestRenderCoopRef: createRef({
        puzzle: null,
        activeSnapshotId: null,
        activeSave: undefined,
        activeTitle: 'Capy',
        filledRegionIds: new Set(),
        paintedRegionColors: new Map(),
        isFreeColorMode: false,
        activeColorId: 1,
        settings: baseSettings,
      }),
      viewportRef: createRef({ zoomScale: 1, panOffsetX: 0, panOffsetY: 0 }),
      snapshotTransitioningRef: createRef(false),
      snapshotTransitionSeqRef: createRef(0),
      activeBlobUrlRef: createRef(null),
      loadSampleForCoopRef: createRef(null),
      applyViewport: () => {},
      clearPendingViewportSave: () => {},
      resetReplayState: () => {},
      startReplay: () => {},
      syncUndoStack: () => {},
      syncRedoStack: () => {},
      resetActivePuzzleSessionStats: () => {},
      emitCoopUnfill: () => {},
      handleUpdateSettings: () => {},
      setSettings: () => {},
      setSnapshots: () => {},
      setActiveSnapshotId: () => {},
      setPuzzle: () => {},
      setSourceImage: () => {},
      setFilledRegionIds: () => {},
      setPaintedRegionColors: () => {},
      setActiveColorId: () => {},
      setHintRegionId: () => {},
      setIsLoading: () => {},
      setLoadingProgress: () => {},
      setLoadingStatus: () => {},
      setLoadingPayload: () => {},
      setShowSettings: () => {},
      setLifetimeStats: () => {},
      markTutorialActionTried: () => {},
      triggerFeatureOffer: () => {},
    });
    return React.createElement('div', null, 'snapshot-ok');
  }
  assert.equal(renderToStaticMarkup(React.createElement(SnapshotHarness)), '<div>snapshot-ok</div>');
  assert.equal(typeof capturedSnapshotApi.handleLoadSnapshot, 'function');
  assert.equal(typeof capturedSnapshotApi.handleResetProgress, 'function');
  assert.equal(typeof capturedSnapshotApi.handleImportSnapshots, 'function');

  // 6. Static regression & guardrail checks across App.tsx and all M5-6 extracted modules
  const filesToAudit = [
    'src/App.tsx',
    'src/services/artworkExporter.ts',
    'src/hooks/useTutorialAndOffers.ts',
    'src/hooks/useViewportAndShortcuts.ts',
    'src/hooks/usePaintController.ts',
    'src/hooks/useSnapshotLibrary.ts',
  ];

  for (const relPath of filesToAudit) {
    const src = fs.readFileSync(path.join(webRoot, relPath), 'utf8');
    assert.equal(
      /\b(?:localStorage|sessionStorage)\b/.test(src),
      false,
      `${relPath} must not access localStorage/sessionStorage directly`
    );
    assert.equal(
      /\bProviderRegistry\b/.test(src),
      false,
      `${relPath} must not reference ProviderRegistry directly`
    );
    assert.equal(
      /\b(?:oxlint-disable|eslint-disable)\b/.test(src),
      false,
      `${relPath} must not contain oxlint-disable or eslint-disable comments`
    );
    assert.equal(
      /\bcatch\s*\{/.test(src),
      false,
      `${relPath} must not contain parameterless catch { blocks`
    );
  }

  const appSrc = fs.readFileSync(path.join(webRoot, 'src/App.tsx'), 'utf8');
  const appLineCount = appSrc.split('\n').length;
  assert.ok(
    appLineCount < 1500,
    `Expected web/src/App.tsx to be < 1,500 LOC after Stage 5 completion, got ${appLineCount}`
  );
  assert.ok(appSrc.includes('useTutorialAndOffers('), 'App.tsx must wire useTutorialAndOffers');
  assert.ok(
    appSrc.includes('useViewportAndShortcuts('),
    'App.tsx must wire useViewportAndShortcuts'
  );
  assert.ok(appSrc.includes('usePaintController('), 'App.tsx must wire usePaintController');
  assert.ok(appSrc.includes('useSnapshotLibrary('), 'App.tsx must wire useSnapshotLibrary');
}
