import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function makeDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeFakeImage(src = './assets/capybara.webp') {
  return { src, width: 100, height: 100 };
}

function makeTestPuzzle(overrides = {}) {
  return {
    width: 40,
    height: 40,
    palette: [
      { id: 1, hex: '#EF4444', r: 239, g: 68, b: 68, isLight: false, argb: 0xffef4444 },
      { id: 2, hex: '#3B82F6', r: 59, g: 130, b: 246, isLight: false, argb: 0xff3b82f6 },
    ],
    regions: [
      { id: 101, colorId: 1, centroidX: 10, centroidY: 10, minX: 0, minY: 0, maxX: 20, maxY: 20, area: 100 },
      { id: 102, colorId: 2, centroidX: 30, centroidY: 10, minX: 20, minY: 0, maxX: 40, maxY: 20, area: 100 },
      { id: 103, colorId: 2, centroidX: 10, centroidY: 30, minX: 0, minY: 20, maxX: 20, maxY: 40, area: 100 },
    ],
    isFreeColor: false,
    ...overrides,
  };
}

function makeTestSnapshot(overrides = {}) {
  return {
    id: 'snap-1',
    title: 'Capy Forest',
    timestamp: 1000,
    lastOpened: 1000,
    filledCount: 1,
    totalRegions: 3,
    filledRegionIds: [101],
    sampleAssetPath: './assets/capybara.webp',
    zoomScale: 1.5,
    panOffsetX: 12,
    panOffsetY: -8,
    ...overrides,
  };
}

function createHarness(overrides = {}) {
  let transitionSeq = overrides.initialTransitionSeq ?? 1;
  let coopJoinSeq = 0;
  let activeBlobUrl = overrides.initialBlobUrl ?? null;
  let snapshotsState = overrides.initialSnapshotsState ?? [];
  let settingsState = {
    paletteSort: 'default',
    autoReplayOnLoad: true,
    generatorConfig: { numColors: 12, minRegionSize: 20 },
    replayLoop: true,
    isFreeColorMode: false,
    ...(overrides.settings || {}),
  };

  const calls = {
    clearPendingViewportSave: 0,
    applyViewport: [],
    setSnapshots: [],
    setPaintedRegionColors: [],
    setSettings: [],
    updateSettings: [],
    setSourceImage: [],
    setPuzzle: [],
    setActiveSnapshotId: [],
    setActiveColorId: [],
    updateLiveCoop: [],
    setFilledRegionIds: [],
    syncUndoStack: [],
    syncRedoStack: [],
    setHintRegionId: [],
    resetStats: [],
    setIsLoading: [],
    startReplay: [],
    setShowTutorial: [],
    setCoopRoomState: [],
    loadArtworkFromImage: [],
    setActiveBlobUrl: [],
    revokeObjectUrl: [],
    clearShareHash: [],
    saveActiveState: [],
    updateSnapshotProgress: [],
    importSnapshotData: [],
    joinRoom: [],
  };

  const callbacks = {
    getSettings: () => settingsState,
    getTransitionSeq: () => transitionSeq,
    nextCoopJoinSeq: () => ++coopJoinSeq,
    getCoopJoinSeq: () => coopJoinSeq,
    getActiveBlobUrl: () => activeBlobUrl,
    setActiveBlobUrl: (url) => {
      activeBlobUrl = url;
      calls.setActiveBlobUrl.push(url);
    },
    resolveSnapshotImageSrc: async (snap) => ({
      src: snap.sampleAssetPath || './assets/capybara.webp',
      objectUrl: null,
    }),
    loadArtworkFromImage: (...args) => {
      calls.loadArtworkFromImage.push(args);
    },
    clearPendingViewportSave: () => {
      calls.clearPendingViewportSave += 1;
    },
    onApplyViewport: (view) => {
      calls.applyViewport.push(view);
    },
    onSetSnapshots: (nextOrUpdater) => {
      snapshotsState =
        typeof nextOrUpdater === 'function' ? nextOrUpdater(snapshotsState) : nextOrUpdater;
      calls.setSnapshots.push(snapshotsState);
    },
    onSetPaintedRegionColors: (map) => {
      calls.setPaintedRegionColors.push(map);
    },
    onSetSettings: (updater) => {
      settingsState = updater(settingsState);
      calls.setSettings.push(settingsState);
    },
    onUpdateSettings: (updater) => {
      settingsState = updater(settingsState);
      calls.updateSettings.push(settingsState);
    },
    onSetSourceImage: (img) => {
      calls.setSourceImage.push(img);
    },
    onSetPuzzle: (puzzle) => {
      calls.setPuzzle.push(puzzle);
    },
    onSetActiveSnapshotId: (id) => {
      calls.setActiveSnapshotId.push(id);
    },
    onSetActiveColorId: (id) => {
      calls.setActiveColorId.push(id);
    },
    onUpdateLiveCoop: (patch) => {
      calls.updateLiveCoop.push(patch);
    },
    onSetFilledRegionIds: (set) => {
      calls.setFilledRegionIds.push(set);
    },
    onSyncUndoStack: (entries) => {
      calls.syncUndoStack.push(entries);
    },
    onSyncRedoStack: (entries) => {
      calls.syncRedoStack.push(entries);
    },
    onSetHintRegionId: (id) => {
      calls.setHintRegionId.push(id);
    },
    onResetActivePuzzleSessionStats: (id, isComplete) => {
      calls.resetStats.push({ id, isComplete });
    },
    onSetIsLoading: (loading) => {
      calls.setIsLoading.push(loading);
    },
    onStartReplay: (orderedIds, isPostLoad) => {
      calls.startReplay.push({ orderedIds, isPostLoad });
    },
    onSetShowTutorial: (show) => {
      calls.setShowTutorial.push(show);
    },
    onSetCoopRoomState: (roomCode, participants) => {
      calls.setCoopRoomState.push({ roomCode, participants });
    },
    ...(overrides.callbacks || {}),
  };

  let activeRoomCode = null;
  let roomParticipants = [];

  const deps = {
    parseShareLinkFromUrl: async () => ({
      hasToken: false,
      tokenError: false,
      matchedSample: null,
      delta: null,
      roomCode: null,
    }),
    clearShareHashFromWindowUrl: (roomCode) => {
      calls.clearShareHash.push(roomCode ?? null);
    },
    fetchBundle: async () => null,
    loadHtmlImage: async (src) => makeFakeImage(src),
    revokeObjectUrl: (url) => {
      calls.revokeObjectUrl.push(url);
    },
    storage: {
      loadActiveState: () => null,
      saveActiveState: (state) => {
        calls.saveActiveState.push(state);
      },
      loadSnapshots: () => [],
      hydrateSnapshotPreviews: async (snaps) => snaps,
      loadPuzzleData: async () => null,
      loadImageBlob: async () => null,
      importSnapshotData: async (buf, opts) => {
        calls.importSnapshotData.push({ buf, opts });
        return { importedCount: 0, skippedCount: 0 };
      },
      updateSnapshotProgress: (...args) => {
        calls.updateSnapshotProgress.push(args);
        return [makeTestSnapshot({ id: args[0], filledRegionIds: args[3], resetEpoch: args[12] })];
      },
      ...(overrides.storage || {}),
    },
    auth: {
      getCurrentIdentity: () => ({
        playerId: 'p-1',
        displayName: 'Capy',
        avatarColorHex: '#F97316',
      }),
    },
    realtimeRoom: {
      get activeRoomCode() {
        return activeRoomCode;
      },
      joinRoom: async (code, participant) => {
        calls.joinRoom.push({ code, participant });
        activeRoomCode = code;
        roomParticipants = [participant];
      },
      getParticipants: () => roomParticipants,
    },
    safeLocalStore: {
      getScopedItem: () => null,
      ...(overrides.safeLocalStore || {}),
    },
    nativeBridge: {
      loadBackup: () => null,
      ...(overrides.nativeBridge || {}),
    },
    sampleGallery: [
      { id: 'sample-forest', title: 'Capy Forest', assetPath: './assets/capybara.webp' },
    ],
    getWindowLocationHref: () => 'https://capypaint.com/',
    getWindowLocationSearch: () => '',
    ...(overrides.deps || {}),
  };

  return {
    callbacks,
    deps,
    calls,
    bumpTransitionSeq: () => {
      transitionSeq += 1;
      return transitionSeq;
    },
    getActiveBlobUrl: () => activeBlobUrl,
    getSnapshotsState: () => snapshotsState,
    getSettingsState: () => settingsState,
  };
}

export async function runSessionRestorePipelineTests(vite) {
  const mod = await vite.ssrLoadModule('/src/services/sessionRestorePipeline.ts');
  const hookMod = await vite.ssrLoadModule('/src/hooks/useSessionRestore.ts');

  // 1. Pure helpers: mergeCustomPalette, mergeSnapshotPreviews, shouldAutoStartTutorial
  {
    const base = [
      { id: 1, hex: '#111111', r: 17, g: 17, b: 17, isLight: false, argb: 0xff111111 },
      { id: 2, hex: '#222222', r: 34, g: 34, b: 34, isLight: false, argb: 0xff222222 },
    ];
    assert.equal(mod.mergeCustomPalette(base, undefined), base);
    const merged = mod.mergeCustomPalette(base, [
      { id: 2, hex: '#EEEEEE', r: 238, g: 238, b: 238, isLight: true, argb: 0xffeeeeee },
      { id: 3, hex: '#333333', r: 51, g: 51, b: 51, isLight: false, argb: 0xff333333 },
    ]);
    assert.deepEqual(
      merged.map((c) => [c.id, c.hex]),
      [
        [1, '#111111'],
        [2, '#EEEEEE'],
        [3, '#333333'],
      ],
      'mergeCustomPalette must override matching IDs and append custom colors'
    );

    // Duplicate IDs (both generated and extra IDs) must use last-wins consistently
    const dupMerged = mod.mergeCustomPalette(base, [
      { id: 1, hex: '#010101', r: 1, g: 1, b: 1, isLight: false, argb: 0xff010101 },
      { id: 1, hex: '#020202', r: 2, g: 2, b: 2, isLight: false, argb: 0xff020202 },
      { id: 99, hex: '#0B0B0B', r: 11, g: 11, b: 11, isLight: false, argb: 0xff0b0b0b },
      { id: 99, hex: '#161616', r: 22, g: 22, b: 22, isLight: false, argb: 0xff161616 },
    ]);
    assert.deepEqual(
      dupMerged.map((c) => [c.id, c.hex]),
      [
        [1, '#020202'],
        [2, '#222222'],
        [99, '#161616'],
      ],
      'mergeCustomPalette must apply last-wins consistently for duplicate generated and extra IDs'
    );

    // Default revokeObjectUrl must ignore non-blob: strings and forward blob: URLs
    {
      const revoked = [];
      const origRevoke = URL.revokeObjectURL;
      URL.revokeObjectURL = (u) => {
        revoked.push(u);
      };
      try {
        const defaultDeps = mod.createDefaultSessionRestoreDeps();
        defaultDeps.revokeObjectUrl('./assets/capybara.webp');
        defaultDeps.revokeObjectUrl('https://capypaint.com/img.png');
        defaultDeps.revokeObjectUrl('');
        defaultDeps.revokeObjectUrl('blob:https://capypaint.com/valid-id');
      } finally {
        URL.revokeObjectURL = origRevoke;
      }
      assert.deepEqual(
        revoked,
        ['blob:https://capypaint.com/valid-id'],
        'default revokeObjectUrl must guard on blob: prefix'
      );
    }

    const prevSnaps = [makeTestSnapshot({ id: 'a' }), makeTestSnapshot({ id: 'b' })];
    const unchanged = mod.mergeSnapshotPreviews(prevSnaps, [makeTestSnapshot({ id: 'a' })]);
    assert.equal(unchanged, prevSnaps, 'mergeSnapshotPreviews preserves ref when no previews exist');
    const updated = mod.mergeSnapshotPreviews(prevSnaps, [
      makeTestSnapshot({ id: 'b', previewDataUrl: 'data:image/webp;base64,AAAA' }),
    ]);
    assert.equal(updated[1].previewDataUrl, 'data:image/webp;base64,AAAA');
    assert.equal(updated[0], prevSnaps[0]);

    assert.equal(
      mod.shouldAutoStartTutorial(
        '',
        {
          safeLocalStore: { getScopedItem: () => null },
          nativeBridge: { loadBackup: () => null },
        },
        'test.tutorial'
      ),
      true
    );
    assert.equal(
      mod.shouldAutoStartTutorial(
        '?skipTutorial=1',
        {
          safeLocalStore: { getScopedItem: () => null },
          nativeBridge: { loadBackup: () => null },
        },
        'test.tutorial'
      ),
      false
    );
    assert.equal(
      mod.shouldAutoStartTutorial(
        '',
        {
          safeLocalStore: { getScopedItem: () => '1' },
          nativeBridge: { loadBackup: () => null },
        },
        'test.tutorial'
      ),
      false
    );
    assert.equal(
      mod.shouldAutoStartTutorial(
        '',
        {
          safeLocalStore: {
            getScopedItem: () => {
              throw new Error('storage boom');
            },
          },
          nativeBridge: { loadBackup: () => null },
        },
        'test.tutorial'
      ),
      true,
      'shouldAutoStartTutorial swallows storage errors safely'
    );
  }

  // 2. Phase 1: Share link + cold-start sample_saves.capy bootstrap + resetEpoch dominance + room join
  {
    const prebakedSnap = makeTestSnapshot({
      id: 'snap-prebaked',
      sampleAssetPath: './assets/capybara.webp',
      filledRegionIds: [101],
      resetEpoch: 1,
      lastOpened: 1000,
    });
    const cachedPuzzle = makeTestPuzzle();
    let importedOnce = false;

    const h = createHarness({
      deps: {
        parseShareLinkFromUrl: async () => ({
          hasToken: true,
          tokenError: false,
          roomCode: 'CAPY42',
          matchedSample: { id: 'sample-forest', title: 'Capy Forest', assetPath: './assets/capybara.webp' },
          delta: {
            version: 2,
            filledRegionIds: [102, 999],
            paintedRegionColors: { 102: 2, 999: 1 },
            isFreeColor: true,
            resetEpoch: 2,
            updatedAt: 5000,
          },
        }),
        fetchBundle: async () => ({
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(16),
        }),
      },
      storage: {
        loadSnapshots: () => (importedOnce ? [prebakedSnap] : []),
        importSnapshotData: async (buf, opts) => {
          importedOnce = true;
          return { importedCount: 1, skippedCount: 0, firstSnapshot: prebakedSnap, firstPuzzle: cachedPuzzle };
        },
        loadPuzzleData: async (id) => (id === 'snap-prebaked' ? cachedPuzzle : null),
      },
    });

    const controller = new AbortController();
    const res = await mod.runSessionRestorePipeline({
      signal: controller.signal,
      callbacks: h.callbacks,
      deps: h.deps,
    });

    assert.equal(res, 'share_prebaked');
    assert.equal(h.calls.joinRoom.length, 1);
    assert.equal(h.calls.joinRoom[0].code, 'CAPY42');
    assert.equal(h.calls.setCoopRoomState.length, 1);
    assert.equal(h.calls.setCoopRoomState[0].roomCode, 'CAPY42');
    assert.deepEqual(h.calls.clearShareHash, ['CAPY42']);
    assert.equal(h.calls.setActiveSnapshotId[0], 'snap-prebaked');
    // Higher remote resetEpoch (2 > 1) dominates: stale local 101 must NOT resurrect; invalid 999 filtered out
    assert.deepEqual([...h.calls.setFilledRegionIds[0]], [102]);
    assert.equal(h.calls.saveActiveState[0].resetEpoch, 2);
    assert.equal(h.calls.updateSnapshotProgress[0][12], 2);
    assert.equal(h.calls.setIsLoading.at(-1), false);
  }

  // 3. Phase 1 fallback to dynamic loadArtworkFromImage when no prebaked snapshot exists
  {
    const h = createHarness({
      deps: {
        getWindowLocationSearch: () => '?skipSampleBootstrap=1',
        parseShareLinkFromUrl: async () => ({
          hasToken: true,
          tokenError: false,
          roomCode: null,
          matchedSample: { id: 'sample-forest', title: 'Capy Forest', assetPath: './assets/capybara.webp' },
          delta: {
            version: 2,
            filledRegionIds: [101],
            paintedRegionColors: { 101: 1 },
            updatedAt: 2000,
          },
        }),
      },
    });
    const res = await mod.runSessionRestorePipeline({
      signal: new AbortController().signal,
      callbacks: h.callbacks,
      deps: h.deps,
    });
    assert.equal(res, 'share_dynamic');
    assert.equal(h.calls.loadArtworkFromImage.length, 1);
    assert.deepEqual([...h.calls.loadArtworkFromImage[0][3]], [101]);
  }

  // 4. Phase 2: Active snapshot cached restore, preview hydration, blob URL swap, resetEpoch dominance
  {
    const snap = makeTestSnapshot({
      id: 'snap-active',
      filledRegionIds: [102],
      resetEpoch: 3,
      customPalette: [
        { id: 1, hex: '#123456', r: 18, g: 52, b: 86, isLight: false, argb: 0xff123456 },
      ],
    });
    const puzzle = makeTestPuzzle();
    const hydrateDeferred = makeDeferred();

    const h = createHarness({
      initialBlobUrl: 'blob:prev-url',
      initialSnapshotsState: [snap],
      callbacks: {
        resolveSnapshotImageSrc: async () => ({
          src: 'blob:next-url',
          objectUrl: 'blob:next-url',
        }),
      },
      storage: {
        loadActiveState: () => ({
          activeSnapshotId: 'snap-active',
          activeColorId: 2,
          filledRegionIds: [101, 102],
          resetEpoch: 1,
          zoomScale: 2.25,
          panOffsetX: 30,
          panOffsetY: -15,
        }),
        loadSnapshots: () => [snap],
        hydrateSnapshotPreviews: () => hydrateDeferred.promise,
        loadPuzzleData: async () => puzzle,
      },
    });

    const res = await mod.runSessionRestorePipeline({
      signal: new AbortController().signal,
      callbacks: h.callbacks,
      deps: h.deps,
    });

    assert.equal(res, 'active_cached');
    assert.equal(h.getActiveBlobUrl(), 'blob:next-url');
    assert.deepEqual(h.calls.revokeObjectUrl, ['blob:prev-url']);
    // Snapshot resetEpoch (3) > activeState resetEpoch (1) => must use snap.filledRegionIds [102]
    assert.deepEqual([...h.calls.setFilledRegionIds[0]], [102]);
    assert.deepEqual(h.calls.applyViewport[0], { zoomScale: 2.25, panOffsetX: 30, panOffsetY: -15 });
    assert.equal(puzzle.palette[0].hex, '#123456', 'customPalette must be merged onto cachedPuzzle');
    assert.equal(h.getSettingsState().replayLoop, false, 'replayLoop cleared on active restore');
    assert.equal(h.calls.startReplay.length, 1);
    assert.deepEqual(h.calls.startReplay[0], { orderedIds: [102], isPostLoad: true });

    // Background preview hydration completes cleanly
    hydrateDeferred.resolve([{ ...snap, previewDataUrl: 'data:image/webp;base64,HYDRATED' }]);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(h.getSnapshotsState()[0].previewDataUrl, 'data:image/webp;base64,HYDRATED');
  }

  // 5. Phase 2: Cache-eviction fallback to loadArtworkFromImage with storedBlob
  {
    const fakeBlob = new Uint8Array([1, 2, 3]);
    const snap = makeTestSnapshot({
      id: 'snap-evicted',
      sampleAssetPath: undefined,
      sourceRef: { kind: 'blob', uri: 'blob-key-77' },
      filledRegionIds: [101],
      paintedRegionColors: { 101: 2 },
      isFreeColor: true,
    });
    let requestedBlobId = null;

    const h = createHarness({
      callbacks: {
        resolveSnapshotImageSrc: async () => ({
          src: 'blob:evicted-broken',
          objectUrl: 'blob:evicted-broken',
        }),
      },
      deps: {
        // Simulate fallback image src differing from objectUrl -> objectUrl must be revoked immediately
        loadHtmlImage: async () => makeFakeImage('./assets/capybara.webp'),
      },
      storage: {
        loadSnapshots: () => [snap],
        loadPuzzleData: async () => null,
        loadImageBlob: async (blobId) => {
          requestedBlobId = blobId;
          return fakeBlob;
        },
      },
    });

    const res = await mod.runSessionRestorePipeline({
      signal: new AbortController().signal,
      callbacks: h.callbacks,
      deps: h.deps,
    });

    assert.equal(res, 'active_regenerated');
    assert.equal(requestedBlobId, 'blob-key-77');
    assert.deepEqual(h.calls.revokeObjectUrl, ['blob:evicted-broken']);
    assert.equal(h.getActiveBlobUrl(), null);
    assert.equal(h.calls.loadArtworkFromImage.length, 1);
    assert.equal(h.calls.loadArtworkFromImage[0][5], 'snap-evicted');
    assert.equal(h.calls.loadArtworkFromImage[0][8], fakeBlob);
    assert.equal(h.calls.loadArtworkFromImage[0][12], true);
  }

  // 6. Phase 3: Cold-start starter bundle bootstrap + tutorial auto-start check
  {
    const firstSnap = makeTestSnapshot({ id: 'starter-1', filledRegionIds: [] });
    const firstPuzzle = makeTestPuzzle();
    const h = createHarness({
      deps: {
        fetchBundle: async () => ({
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(8),
        }),
      },
      storage: {
        loadSnapshots: () => [],
        importSnapshotData: async () => ({
          importedCount: 1,
          skippedCount: 0,
          firstSnapshot: firstSnap,
          firstPuzzle,
        }),
        hydrateSnapshotPreviews: async () => [firstSnap],
      },
    });

    const res = await mod.runSessionRestorePipeline({
      signal: new AbortController().signal,
      callbacks: h.callbacks,
      deps: h.deps,
    });

    assert.equal(res, 'starter_bundle');
    assert.equal(h.calls.setActiveSnapshotId[0], 'starter-1');
    assert.equal(h.calls.saveActiveState[0].activeSnapshotId, 'starter-1');
    assert.deepEqual(h.calls.setShowTutorial, [true]);
  }

  // 7. Phase 4: Dynamic SAMPLE_GALLERY[0] fallback when skipSampleBootstrap=1 (and tutorial suppressed when completed)
  {
    const h = createHarness({
      deps: {
        getWindowLocationSearch: () => '?skipSampleBootstrap=1',
      },
      safeLocalStore: {
        getScopedItem: () => '1',
      },
    });

    const res = await mod.runSessionRestorePipeline({
      signal: new AbortController().signal,
      callbacks: h.callbacks,
      deps: h.deps,
    });

    assert.equal(res, 'dynamic_sample');
    assert.equal(h.calls.loadArtworkFromImage.length, 1);
    assert.equal(h.calls.loadArtworkFromImage[0][1], 'Capy Forest');
    assert.deepEqual(h.calls.setShowTutorial, [], 'completed tutorial must not re-open');
  }

  // 8. Mid-flight AbortController cancellation: zero state mutations + immediate blob URL revocation
  {
    const snap = makeTestSnapshot({ id: 'snap-abort' });
    const imgDeferred = makeDeferred();
    const hydrateDeferred = makeDeferred();
    const controller = new AbortController();

    const h = createHarness({
      callbacks: {
        resolveSnapshotImageSrc: async () => ({
          src: 'blob:leak-check-1',
          objectUrl: 'blob:leak-check-1',
        }),
      },
      deps: {
        loadHtmlImage: () => imgDeferred.promise,
      },
      storage: {
        loadSnapshots: () => [snap],
        hydrateSnapshotPreviews: () => hydrateDeferred.promise,
        loadPuzzleData: async () => makeTestPuzzle(),
      },
    });

    const runPromise = mod.runSessionRestorePipeline({
      signal: controller.signal,
      callbacks: h.callbacks,
      deps: h.deps,
    });

    // Wait a microtask so resolveSnapshotImageSrc completes and loadHtmlImage is in-flight
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    imgDeferred.resolve(makeFakeImage('blob:leak-check-1'));
    const res = await runPromise;

    assert.equal(res, 'cancelled');
    assert.deepEqual(h.calls.revokeObjectUrl, ['blob:leak-check-1']);
    assert.equal(h.getActiveBlobUrl(), null);
    assert.equal(h.calls.setPuzzle.length, 0);
    assert.equal(h.calls.setSourceImage.length, 0);
    assert.equal(h.calls.setFilledRegionIds.length, 0);
    assert.equal(h.calls.setIsLoading.length, 0);
    assert.equal(h.calls.startReplay.length, 0);
    assert.equal(h.calls.saveActiveState.length, 0);

    // Late preview hydration after abort must not mutate state
    hydrateDeferred.resolve([{ ...snap, previewDataUrl: 'data:image/webp;base64,LATE' }]);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(h.calls.setSnapshots.length, 0);
  }

  // 9. Mid-flight AbortController cancellation during cache-eviction loadImageBlob:
  //    revokes usedObjectUrl immediately, does NOT prematurely revoke prevBlobUrl, and does NOT mutate setActiveBlobUrl
  {
    const snap = makeTestSnapshot({ id: 'snap-evict-abort', sampleAssetPath: undefined });
    const blobDeferred = makeDeferred();
    const controller = new AbortController();

    const h = createHarness({
      initialBlobUrl: 'blob:existing-active',
      callbacks: {
        resolveSnapshotImageSrc: async () => ({
          src: 'blob:evict-leak-check',
          objectUrl: 'blob:evict-leak-check',
        }),
      },
      deps: {
        loadHtmlImage: async (src) => makeFakeImage(src),
      },
      storage: {
        loadSnapshots: () => [snap],
        loadPuzzleData: async () => null,
        loadImageBlob: () => blobDeferred.promise,
      },
    });

    const runPromise = mod.runSessionRestorePipeline({
      signal: controller.signal,
      callbacks: h.callbacks,
      deps: h.deps,
    });

    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    blobDeferred.resolve(new Uint8Array([9]));
    const res = await runPromise;

    assert.equal(res, 'cancelled');
    assert.deepEqual(h.calls.revokeObjectUrl, ['blob:evict-leak-check']);
    assert.equal(h.getActiveBlobUrl(), 'blob:existing-active');
    assert.deepEqual(h.calls.setActiveBlobUrl, []);
    assert.equal(h.calls.loadArtworkFromImage.length, 0);
  }

  // 9b. Mid-flight transitionSeq bump during cache-eviction loadImageBlob (without signal.abort):
  //     revokes usedObjectUrl immediately, preserves prevBlobUrl, zero setActiveBlobUrl mutations
  {
    const snap = makeTestSnapshot({ id: 'snap-evict-seq-race', sampleAssetPath: undefined });
    const blobDeferred = makeDeferred();

    const h = createHarness({
      initialBlobUrl: 'blob:prev-active',
      callbacks: {
        resolveSnapshotImageSrc: async () => ({
          src: 'blob:stale-evicted',
          objectUrl: 'blob:stale-evicted',
        }),
      },
      deps: {
        loadHtmlImage: async (src) => makeFakeImage(src),
      },
      storage: {
        loadSnapshots: () => [snap],
        loadPuzzleData: async () => null,
        loadImageBlob: () => blobDeferred.promise,
      },
    });

    const runPromise = mod.runSessionRestorePipeline({
      signal: new AbortController().signal,
      callbacks: h.callbacks,
      deps: h.deps,
    });

    await new Promise((r) => setTimeout(r, 0));
    h.bumpTransitionSeq();
    blobDeferred.resolve(new Uint8Array([7]));
    const res = await runPromise;

    assert.equal(res, 'cancelled');
    assert.deepEqual(h.calls.revokeObjectUrl, ['blob:stale-evicted']);
    assert.equal(h.getActiveBlobUrl(), 'blob:prev-active');
    assert.deepEqual(h.calls.setActiveBlobUrl, []);
    assert.equal(h.calls.loadArtworkFromImage.length, 0);
  }

  // 9c. Cache-eviction loadImageBlob rejection revokes usedObjectUrl without mutating activeBlobUrl
  {
    const snap = makeTestSnapshot({ id: 'snap-evict-throw', sampleAssetPath: undefined });
    const h = createHarness({
      initialBlobUrl: 'blob:prev-active-err',
      callbacks: {
        resolveSnapshotImageSrc: async () => ({
          src: 'blob:evict-throw-url',
          objectUrl: 'blob:evict-throw-url',
        }),
      },
      deps: {
        loadHtmlImage: async (src) => makeFakeImage(src),
      },
      storage: {
        loadSnapshots: () => [snap],
        loadPuzzleData: async () => null,
        loadImageBlob: async () => {
          throw new Error('idb read failed');
        },
      },
    });

    await assert.rejects(
      () =>
        mod.runSessionRestorePipeline({
          signal: new AbortController().signal,
          callbacks: h.callbacks,
          deps: h.deps,
        }),
      /idb read failed/
    );
    assert.deepEqual(h.calls.revokeObjectUrl, ['blob:evict-throw-url']);
    assert.equal(h.getActiveBlobUrl(), 'blob:prev-active-err');
    assert.deepEqual(h.calls.setActiveBlobUrl, []);
  }

  // 9d. Share-link ?room= join skipped when transitionSeq bumps during parseShareLinkFromUrl
  {
    const parseDeferred = makeDeferred();
    let nextCoopJoinCalled = 0;
    const h = createHarness({
      callbacks: {
        nextCoopJoinSeq: () => {
          nextCoopJoinCalled += 1;
          return nextCoopJoinCalled;
        },
      },
      deps: {
        parseShareLinkFromUrl: () => parseDeferred.promise,
      },
    });

    const runPromise = mod.runSessionRestorePipeline({
      signal: new AbortController().signal,
      callbacks: h.callbacks,
      deps: h.deps,
    });

    await new Promise((r) => setTimeout(r, 0));
    h.bumpTransitionSeq();
    parseDeferred.resolve({
      hasToken: false,
      tokenError: false,
      roomCode: 'STALE99',
      matchedSample: null,
      delta: null,
    });
    const res = await runPromise;

    assert.equal(res, 'cancelled');
    assert.equal(nextCoopJoinCalled, 0, 'nextCoopJoinSeq must not run after transitionSeq bump');
    assert.equal(h.calls.joinRoom.length, 0, 'realtimeRoom.joinRoom must not run after transitionSeq bump');
    assert.equal(h.calls.setCoopRoomState.length, 0, 'onSetCoopRoomState must not run after transitionSeq bump');
  }

  // 9e. Phase 2 snapEpochNewer with undefined paintedRegionColors must NOT resurrect stale activeState.paintedRegionColors
  {
    const snap = makeTestSnapshot({
      id: 'snap-reset-epoch',
      filledRegionIds: [],
      paintedRegionColors: undefined,
      resetEpoch: 2,
      isFreeColor: true,
    });
    const h = createHarness({
      storage: {
        loadActiveState: () => ({
          activeSnapshotId: 'snap-reset-epoch',
          activeColorId: 1,
          filledRegionIds: [101, 102],
          paintedRegionColors: { 101: 1, 102: 2 },
          isFreeColorMode: true,
          resetEpoch: 1,
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        }),
        loadSnapshots: () => [snap],
        loadPuzzleData: async () => makeTestPuzzle({ isFreeColor: true }),
      },
    });

    const res = await mod.runSessionRestorePipeline({
      signal: new AbortController().signal,
      callbacks: h.callbacks,
      deps: h.deps,
    });

    assert.equal(res, 'active_cached');
    assert.deepEqual([...h.calls.setFilledRegionIds[0]], []);
    assert.equal(
      h.calls.setPaintedRegionColors[0].size,
      0,
      'stale pre-reset activeState.paintedRegionColors must not resurrect when snapEpochNewer is true'
    );
  }

  // 9f. Phase 2 activeEpochNewer: newer activeState.paintedRegionColors wins over stale candidateSnap.paintedRegionColors
  {
    const snap = makeTestSnapshot({
      id: 'snap-older-epoch-defined',
      filledRegionIds: [101],
      paintedRegionColors: { 101: 1 },
      resetEpoch: 1,
      isFreeColor: true,
    });
    const h = createHarness({
      storage: {
        loadActiveState: () => ({
          activeSnapshotId: 'snap-older-epoch-defined',
          activeColorId: 2,
          filledRegionIds: [102],
          paintedRegionColors: { 102: 2 },
          isFreeColorMode: true,
          resetEpoch: 2,
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        }),
        loadSnapshots: () => [snap],
        loadPuzzleData: async () => makeTestPuzzle({ isFreeColor: true }),
      },
    });

    const res = await mod.runSessionRestorePipeline({
      signal: new AbortController().signal,
      callbacks: h.callbacks,
      deps: h.deps,
    });

    assert.equal(res, 'active_cached');
    assert.deepEqual([...h.calls.setFilledRegionIds[0]], [102]);
    assert.deepEqual(
      [...h.calls.setPaintedRegionColors[0].entries()],
      [[102, 2]],
      'newer activeState.paintedRegionColors must override stale lower-epoch candidateSnap.paintedRegionColors'
    );
  }

  // 9g. Phase 2 activeEpochNewer with undefined activeState.paintedRegionColors must NOT resurrect stale candidateSnap.paintedRegionColors
  {
    const snap = makeTestSnapshot({
      id: 'snap-older-epoch-undef',
      filledRegionIds: [101],
      paintedRegionColors: { 101: 1 },
      resetEpoch: 1,
      isFreeColor: true,
    });
    const h = createHarness({
      storage: {
        loadActiveState: () => ({
          activeSnapshotId: 'snap-older-epoch-undef',
          activeColorId: 1,
          filledRegionIds: [],
          paintedRegionColors: undefined,
          isFreeColorMode: true,
          resetEpoch: 2,
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        }),
        loadSnapshots: () => [snap],
        loadPuzzleData: async () => makeTestPuzzle({ isFreeColor: true }),
      },
    });

    const res = await mod.runSessionRestorePipeline({
      signal: new AbortController().signal,
      callbacks: h.callbacks,
      deps: h.deps,
    });

    assert.equal(res, 'active_cached');
    assert.deepEqual([...h.calls.setFilledRegionIds[0]], []);
    assert.equal(
      h.calls.setPaintedRegionColors[0].size,
      0,
      'stale lower-epoch candidateSnap.paintedRegionColors must not resurrect when activeEpochNewer is true and activeState.paintedRegionColors is undefined'
    );
  }

  // 10. snapshotTransitionSeqRef bump mid-flight cancels restore and revokes created blob URL
  {
    const snap = makeTestSnapshot({ id: 'snap-seq-race' });
    const resolveDeferred = makeDeferred();

    const h = createHarness({
      callbacks: {
        resolveSnapshotImageSrc: () => resolveDeferred.promise,
      },
      storage: {
        loadSnapshots: () => [snap],
        loadPuzzleData: async () => makeTestPuzzle(),
      },
    });

    const runPromise = mod.runSessionRestorePipeline({
      signal: new AbortController().signal,
      callbacks: h.callbacks,
      deps: h.deps,
    });

    await new Promise((r) => setTimeout(r, 0));
    h.bumpTransitionSeq();
    resolveDeferred.resolve({ src: 'blob:raced-url', objectUrl: 'blob:raced-url' });
    const res = await runPromise;

    assert.equal(res, 'cancelled');
    assert.deepEqual(h.calls.revokeObjectUrl, ['blob:raced-url']);
    assert.equal(h.calls.setPuzzle.length, 0);
    assert.equal(h.calls.setIsLoading.length, 0);
  }

  // 11. useSessionRestore hook SSR safety & source invariants
  {
    assert.equal(typeof hookMod.useSessionRestore, 'function');
    const h = createHarness();
    function TestHarnessComponent() {
      hookMod.useSessionRestore({ callbacks: h.callbacks, deps: h.deps });
      return React.createElement('div', null, 'ok');
    }
    const html = renderToStaticMarkup(React.createElement(TestHarnessComponent));
    assert.equal(html, '<div>ok</div>');

    const pipelineSrc = fs.readFileSync(
      path.resolve(projectRoot, 'src/services/sessionRestorePipeline.ts'),
      'utf8'
    );
    assert.equal(
      /\blocalStorage\b/.test(pipelineSrc),
      false,
      'sessionRestorePipeline.ts must not access localStorage directly'
    );
    const appSrc = fs.readFileSync(path.resolve(projectRoot, 'src/App.tsx'), 'utf8');
    assert.ok(
      appSrc.includes('useSessionRestore({'),
      'App.tsx must delegate session restore to useSessionRestore'
    );
  }
}
