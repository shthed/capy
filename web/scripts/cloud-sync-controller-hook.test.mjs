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
    {
      id: 101,
      colorId: 1,
      centroidX: 50,
      centroidY: 60,
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
      area: 10000,
    },
    {
      id: 102,
      colorId: 2,
      centroidX: 250,
      centroidY: 160,
      minX: 200,
      minY: 100,
      maxX: 300,
      maxY: 200,
      area: 10000,
    },
    {
      id: 103,
      colorId: 3,
      centroidX: 450,
      centroidY: 360,
      minX: 400,
      minY: 300,
      maxX: 500,
      maxY: 400,
      area: 10000,
    },
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

function makeSnapshot(overrides = {}) {
  return {
    id: 'snap-1',
    title: 'Capy Sample',
    timestamp: 1_700_000_000_000,
    lastOpened: 1_700_000_001_000,
    filledCount: 1,
    totalCount: 3,
    filledRegionIds: [101],
    paintedRegionColors: { 101: 1 },
    sampleAssetPath: './assets/capy_forest.webp',
    sourceRef: { kind: 'sample', uri: './assets/capy_forest.webp' },
    isFreeColor: false,
    resetEpoch: 0,
    ...overrides,
  };
}

function makeMemoryStorage(initialSnapshots = []) {
  let snapshots = initialSnapshots.map((s) => ({ ...s }));
  const updateCalls = [];
  const saveActiveCalls = [];

  return {
    get snapshots() {
      return snapshots;
    },
    setSnapshots(next) {
      snapshots = next.map((s) => ({ ...s }));
    },
    updateCalls,
    saveActiveCalls,
    loadSnapshots() {
      return snapshots.map((s) => ({ ...s }));
    },
    updateSnapshotProgress(
      id,
      filledCount,
      totalCount,
      filledRegionIds,
      zoomScale,
      panOffsetX,
      panOffsetY,
      _previewDataUrl,
      paintedRegionColors,
      _customPalette,
      isFreeColor,
      _fileSizeBytes,
      resetEpoch
    ) {
      updateCalls.push({
        id,
        filledCount,
        totalCount,
        filledRegionIds: [...filledRegionIds],
        paintedRegionColors: paintedRegionColors ? { ...paintedRegionColors } : undefined,
        isFreeColor,
        resetEpoch,
        zoomScale,
        panOffsetX,
        panOffsetY,
      });
      snapshots = snapshots.map((item) =>
        item.id === id
          ? {
              ...item,
              filledCount,
              totalCount,
              filledRegionIds: [...filledRegionIds],
              ...(paintedRegionColors !== undefined
                ? { paintedRegionColors: { ...paintedRegionColors } }
                : {}),
              ...(resetEpoch !== undefined ? { resetEpoch } : {}),
            }
          : item
      );
      return snapshots.map((s) => ({ ...s }));
    },
    saveActiveState(state) {
      saveActiveCalls.push(state);
    },
  };
}

export async function runCloudSyncControllerHookTests(vite) {
  const mod = await vite.ssrLoadModule('/src/hooks/useCloudSyncController.ts');
  const coordMod = await vite.ssrLoadModule('/src/services/cloudSyncCoordinator.ts');
  const providerCtxMod = await vite.ssrLoadModule('/src/context/ProviderContext.tsx');

  const {
    isNavigatorOffline,
    resolvePostSyncStatus,
    resolveSyncErrorState,
    buildAutoSyncProgressKey,
    normalizeResetEpoch,
    resolveSnapshotSampleUri,
    resolveSlotSourceRef,
    findMatchingSnapshotForActiveSlot,
    buildActiveSlotSyncPayload,
    reconcileActiveSlotProgress,
    executeSingleSyncPass,
    evaluateAuthAutoSyncTransition,
    runStartupAutoSignInAndSync,
    useCloudSyncController,
    isManifestCloudSnapshotSlot,
  } = mod;

  // 1. Pure utility helpers
  assert.equal(buildAutoSyncProgressKey(null, 5, 2), '');
  assert.equal(buildAutoSyncProgressKey('snap-1', 5, 2), 'snap-1:5:2');

  assert.equal(
    resolveSnapshotSampleUri({ sampleAssetPath: './assets/samples/a.png' }),
    './assets/samples/a.png'
  );
  assert.equal(
    resolveSnapshotSampleUri({ sourceRef: { kind: 'catalog', uri: 'cat://item-1' } }),
    'cat://item-1'
  );
  assert.equal(resolveSnapshotSampleUri({ sourceRef: { kind: 'custom', uri: 'local://x' } }), undefined);

  assert.deepEqual(
    resolveSlotSourceRef({ kind: 'catalog', uri: 'cat://item-1' }, undefined),
    { kind: 'catalog', uri: 'cat://item-1' }
  );
  assert.deepEqual(
    resolveSlotSourceRef(undefined, './assets/capy_forest.webp'),
    { kind: 'sample', uri: './assets/capy_forest.webp' }
  );
  assert.equal(resolveSlotSourceRef(undefined, 'javascript:alert(1)'), undefined);

  assert.equal(isManifestCloudSnapshotSlot('capy_library_manifest_v2'), true);
  assert.equal(isManifestCloudSnapshotSlot('pgblob_123'), false);
  assert.equal(isManifestCloudSnapshotSlot('slot_part_0'), false);

  const matchByNormalizedSample = findMatchingSnapshotForActiveSlot(
    [makeSnapshot({ id: 'snap-remote', sampleAssetPath: 'assets/capy_forest.webp' })],
    'snap-local',
    './assets/capy_forest.webp'
  );
  assert.equal(matchByNormalizedSample?.id, 'snap-remote');

  // 1b. Regression: findMatchingSnapshotForActiveSlot ID precedence & malformed manifest resilience
  {
    const orderedSnapshots = [
      makeSnapshot({ id: 'old-copy', sampleAssetPath: './assets/capy_forest.webp' }),
      makeSnapshot({ id: 'exact-id', sampleAssetPath: './assets/capy_forest.webp' }),
    ];
    const exactMatch = findMatchingSnapshotForActiveSlot(
      orderedSnapshots,
      'exact-id',
      './assets/capy_forest.webp'
    );
    assert.equal(
      exactMatch?.id,
      'exact-id',
      'Exact snapshot ID must take precedence over an earlier same-sample entry'
    );

    const malformedManifest = [
      null,
      undefined,
      { id: 'bad-types', sampleAssetPath: 123, sourceRef: { kind: 'sample', uri: 456 } },
      makeSnapshot({ id: 'dot-slash-only', sampleAssetPath: './', sourceRef: { kind: 'sample', uri: './' } }),
      makeSnapshot({ id: 'valid-sample', sampleAssetPath: 'assets/capy_river.webp' }),
    ];
    assert.equal(
      findMatchingSnapshotForActiveSlot(malformedManifest, 'missing-id', './assets/capy_river.webp')?.id,
      'valid-sample',
      'Malformed manifest entries must be skipped safely without throwing'
    );
    assert.equal(
      findMatchingSnapshotForActiveSlot(malformedManifest, 'missing-id', './'),
      undefined,
      'Bare "./" sample URI must normalize to null and never false-match'
    );
    assert.equal(
      findMatchingSnapshotForActiveSlot(malformedManifest, 'missing-id', ''),
      undefined,
      'Empty sample URI must normalize to null and never false-match'
    );

    assert.equal(resolveSnapshotSampleUri(null), undefined);
    assert.equal(resolveSnapshotSampleUri(undefined), undefined);
    assert.equal(resolveSnapshotSampleUri({ sampleAssetPath: 42 }), undefined);
    assert.equal(resolveSnapshotSampleUri({ sourceRef: { kind: 'sample', uri: 99 } }), undefined);
    assert.equal(resolveSnapshotSampleUri({ sampleAssetPath: './' }), undefined);
    assert.equal(resolveSnapshotSampleUri({ sourceRef: { kind: 'catalog', uri: './' } }), undefined);

    // Whitespace-only sample/catalog URIs must be rejected and never false-match
    for (const wsUri of ['   ', './   ', '\t\n', ' ./ \t ']) {
      assert.equal(
        resolveSnapshotSampleUri({ sampleAssetPath: wsUri }),
        undefined,
        `Whitespace-only sampleAssetPath (${JSON.stringify(wsUri)}) must return undefined`
      );
      assert.equal(
        resolveSnapshotSampleUri({ sourceRef: { kind: 'sample', uri: wsUri } }),
        undefined,
        `Whitespace-only sourceRef sample uri (${JSON.stringify(wsUri)}) must return undefined`
      );
      assert.equal(
        resolveSnapshotSampleUri({ sourceRef: { kind: 'catalog', uri: wsUri } }),
        undefined,
        `Whitespace-only sourceRef catalog uri (${JSON.stringify(wsUri)}) must return undefined`
      );
      assert.equal(
        findMatchingSnapshotForActiveSlot(
          [
            makeSnapshot({
              id: 'ws-snap',
              sampleAssetPath: wsUri,
              sourceRef: { kind: 'sample', uri: wsUri },
            }),
          ],
          'missing-id',
          wsUri
        ),
        undefined,
        `Whitespace-only URI (${JSON.stringify(wsUri)}) must never false-match in findMatchingSnapshotForActiveSlot`
      );
    }
  }

  // 1c. Regression: normalizeResetEpoch edge cases
  assert.equal(normalizeResetEpoch(-1), 0);
  assert.equal(normalizeResetEpoch(Number.NaN), 0);
  assert.equal(normalizeResetEpoch(Number.POSITIVE_INFINITY), 0);
  assert.equal(normalizeResetEpoch(Number.NEGATIVE_INFINITY), 0);
  assert.equal(normalizeResetEpoch(2.9), 2);
  assert.equal(normalizeResetEpoch(undefined), 0);
  assert.equal(normalizeResetEpoch('3'), 0);

  // 2. reconcileActiveSlotProgress — resetEpoch dominance for BOTH filledRegionIds AND paintedRegionColors
  const validRegions = new Set([101, 102, 103]);

  // 2a. Equal resetEpoch -> unions filledRegionIds and merges paintedRegionColors, ignores invalid IDs
  {
    const res = reconcileActiveSlotProgress({
      liveFilled: new Set([101]),
      livePainted: new Map([[101, 1]]),
      liveUiEpoch: 2,
      isFreeColorMode: true,
      matchingSave: makeSnapshot({
        filledRegionIds: [101, 102],
        paintedRegionColors: { 101: 1, 102: 2 },
        resetEpoch: 2,
      }),
      slotMergedDelta: {
        version: 2,
        filledRegionIds: [103, 999],
        paintedRegionColors: { 103: 3, 999: 1 },
        resetEpoch: 2,
        updatedAt: 2_000,
      },
      validRegionIds: validRegions,
      now: 3_000,
    });
    assert.equal(res.activeSlotMissing, false);
    assert.equal(res.shouldApply, true);
    assert.equal(res.epochAdvanced, false);
    assert.equal(res.reconciledEpoch, 2);
    assert.deepEqual(Array.from(res.combinedFilled).sort(), [101, 102, 103]);
    assert.deepEqual(Object.fromEntries(res.nextPainted), { 101: 1, 102: 2, 103: 3 });
  }

  // 2b. Local resetEpoch ahead of remote -> local filledRegionIds & paintedRegionColors dominate
  {
    const res = reconcileActiveSlotProgress({
      liveFilled: new Set([101]),
      livePainted: new Map([[101, 2]]),
      liveUiEpoch: 4,
      isFreeColorMode: true,
      matchingSave: makeSnapshot({
        filledRegionIds: [101, 102, 103],
        paintedRegionColors: { 101: 1, 102: 2, 103: 3 },
        resetEpoch: 2,
      }),
      slotMergedDelta: {
        version: 2,
        filledRegionIds: [102, 103],
        paintedRegionColors: { 102: 2, 103: 3 },
        resetEpoch: 3,
        updatedAt: 9_999_999,
      },
      validRegionIds: validRegions,
      now: 5_000,
    });
    assert.equal(res.activeSlotMissing, false);
    assert.equal(res.epochAdvanced, false);
    assert.equal(res.reconciledEpoch, 4);
    assert.deepEqual(Array.from(res.combinedFilled), [101]);
    assert.deepEqual(Object.fromEntries(res.nextPainted), { 101: 2 });
    assert.equal(res.shouldApply, false);
  }

  // 2c. Remote resetEpoch ahead of local -> remote filledRegionIds & paintedRegionColors dominate (clears pre-reset local fills & paints)
  {
    const res = reconcileActiveSlotProgress({
      liveFilled: new Set([101, 102]),
      livePainted: new Map([
        [101, 1],
        [102, 2],
      ]),
      liveUiEpoch: 1,
      isFreeColorMode: true,
      matchingSave: makeSnapshot({
        filledRegionIds: [103],
        paintedRegionColors: { 103: 3 },
        resetEpoch: 3,
      }),
      slotMergedDelta: {
        version: 2,
        filledRegionIds: [103],
        paintedRegionColors: { 103: 3 },
        resetEpoch: 3,
        updatedAt: 5_000,
      },
      validRegionIds: validRegions,
      now: 6_000,
    });
    assert.equal(res.activeSlotMissing, false);
    assert.equal(res.shouldApply, true);
    assert.equal(res.epochAdvanced, true);
    assert.equal(res.reconciledEpoch, 3);
    assert.deepEqual(Array.from(res.combinedFilled), [103]);
    assert.deepEqual(Object.fromEntries(res.nextPainted), { 103: 3 });
  }

  // 2d. Missing / deleted active slot (e.g., deleted by remote tombstone) -> refuses to resurrect
  {
    const res = reconcileActiveSlotProgress({
      liveFilled: new Set([101]),
      livePainted: new Map([[101, 1]]),
      liveUiEpoch: 1,
      isFreeColorMode: false,
      matchingSave: undefined,
      slotMergedDelta: null,
      validRegionIds: validRegions,
    });
    assert.equal(res.activeSlotMissing, true);
    assert.equal(res.shouldApply, false);
  }

  // 2e. Regression: negative, NaN, and non-integer resetEpoch normalization in reconcileActiveSlotProgress
  {
    // Negative liveUiEpoch (-1) against epoch 0 must NOT spuriously advance epoch or drop mid-flight strokes
    const negRes = reconcileActiveSlotProgress({
      liveFilled: new Set([101]),
      livePainted: new Map([[101, 1]]),
      liveUiEpoch: -1,
      isFreeColorMode: true,
      matchingSave: makeSnapshot({
        filledRegionIds: [],
        paintedRegionColors: {},
        resetEpoch: 0,
      }),
      slotMergedDelta: null,
      validRegionIds: validRegions,
      now: 5_000,
    });
    assert.equal(negRes.epochAdvanced, false);
    assert.equal(negRes.reconciledEpoch, 0);
    assert.deepEqual(Array.from(negRes.combinedFilled), [101]);
    assert.deepEqual(Object.fromEntries(negRes.nextPainted), { 101: 1 });

    // NaN liveUiEpoch with missing matchingSave must return finite 0
    const nanMissingRes = reconcileActiveSlotProgress({
      liveFilled: new Set([101]),
      livePainted: new Map([[101, 1]]),
      liveUiEpoch: Number.NaN,
      isFreeColorMode: false,
      matchingSave: undefined,
      slotMergedDelta: null,
      validRegionIds: validRegions,
    });
    assert.equal(Number.isFinite(nanMissingRes.reconciledEpoch), true);
    assert.equal(nanMissingRes.reconciledEpoch, 0);
    assert.equal(nanMissingRes.epochAdvanced, false);

    // NaN liveUiEpoch against remote epoch 2 must detect epochAdvanced = true
    const nanRemoteRes = reconcileActiveSlotProgress({
      liveFilled: new Set([101]),
      livePainted: new Map([[101, 1]]),
      liveUiEpoch: Number.NaN,
      isFreeColorMode: true,
      matchingSave: makeSnapshot({
        filledRegionIds: [102],
        paintedRegionColors: { 102: 2 },
        resetEpoch: 2,
      }),
      slotMergedDelta: null,
      validRegionIds: validRegions,
      now: 6_000,
    });
    assert.equal(nanRemoteRes.epochAdvanced, true);
    assert.equal(nanRemoteRes.reconciledEpoch, 2);
    assert.deepEqual(Array.from(nanRemoteRes.combinedFilled), [102]);
    assert.deepEqual(Object.fromEntries(nanRemoteRes.nextPainted), { 102: 2 });
  }

  // 3. executeSingleSyncPass full happy path + coalesced controller trailing pass
  {
    const puzzle = makeTestPuzzle();
    const initialSnap = makeSnapshot({
      id: 'snap-1',
      filledRegionIds: [101],
      paintedRegionColors: { 101: 1 },
      resetEpoch: 1,
    });
    const storage = makeMemoryStorage([initialSnap]);
    const controller = coordMod.createCoalescedSyncController();
    let syncFullCalls = 0;
    let syncProgressCalls = 0;
    const appliedSnapshotsLog = [];
    const appliedReconciledLog = [];
    const hapticLog = [];

    let liveState = {
      puzzle,
      activeSnapshotId: 'snap-1',
      activeSave: initialSnap,
      activeTitle: 'Capy Sample',
      filledRegionIds: new Set([101]),
      paintedRegionColors: new Map([[101, 1]]),
      isFreeColorMode: true,
      activeColorId: 1,
      hapticsEnabled: true,
    };

    const cloudSave = {
      providerName: 'mock-cloud',
      async pullEnvelope() {
        return null;
      },
      async pushEnvelope() {
        return true;
      },
      async syncFullLibrary() {
        syncFullCalls += 1;
        // First pass reports pending local changes -> should queue a coalesced trailing pass
        return {
          syncedAt: 1000 + syncFullCalls,
          totalSavesSynced: 1,
          importedSavesFromCloud: 0,
          mergedRegionsFromCloud: 1,
          pushedToCloud: true,
          cloudBackend: 'google_drive_appdata',
          hasPendingLocalChanges: syncFullCalls === 1,
        };
      },
      async syncProgress(slotKey, _title, localDelta) {
        syncProgressCalls += 1;
        return {
          slotKey,
          mergedDelta: {
            version: 2,
            filledRegionIds: [...localDelta.filledRegionIds, 102],
            paintedRegionColors: { ...(localDelta.paintedRegionColors || {}), 102: 2 },
            resetEpoch: 1,
            updatedAt: 2000,
          },
          addedFromCloud: 1,
          pushedToCloud: true,
          syncedAt: 2000,
        };
      },
    };

    const summary = await controller.run(() =>
      executeSingleSyncPass({
        cloudSave,
        controller,
        getLiveState: () => liveState,
        getViewport: () => ({ zoomScale: 1.5, panOffsetX: 10, panOffsetY: 20 }),
        getValidRegionIds: () => new Set([101, 102, 103]),
        isSnapshotTransitioning: () => false,
        getTransitionSeq: () => 1,
        storage,
        haptic: (type, enabled) => hapticLog.push({ type, enabled }),
        now: () => 2500,
        applySnapshots: (snaps) => appliedSnapshotsLog.push(snaps),
        applyReconciledActiveSlot: (upd) => {
          appliedReconciledLog.push(upd);
          liveState = {
            ...liveState,
            filledRegionIds: upd.combinedFilled,
            paintedRegionColors: upd.nextPainted,
            activeSave: upd.syncedActiveSave ?? liveState.activeSave,
          };
        },
      })
    );

    assert.equal(syncFullCalls, 2, 'Trailing pass must execute when hasPendingLocalChanges is true');
    assert.equal(syncProgressCalls, 2);
    assert.equal(summary?.backend, 'google_drive_appdata');
    assert.equal(summary?.addedFromCloud, 1);
    assert.equal(appliedReconciledLog.length, 1);
    assert.deepEqual(Array.from(liveState.filledRegionIds).sort(), [101, 102]);
    assert.deepEqual(Object.fromEntries(liveState.paintedRegionColors), { 101: 1, 102: 2 });
    assert.equal(storage.saveActiveCalls.length, 1);
    assert.equal(hapticLog.length, 2);
  }

  // 4. executeSingleSyncPass — deletion tombstone removes active snapshot mid-sync
  {
    const puzzle = makeTestPuzzle();
    const snap = makeSnapshot({ id: 'snap-del', filledRegionIds: [101] });
    const storage = makeMemoryStorage([snap]);
    const controller = coordMod.createCoalescedSyncController();
    let syncProgressCalled = false;
    let appliedReconcile = false;

    const cloudSave = {
      providerName: 'mock-cloud',
      async pullEnvelope() {
        return null;
      },
      async pushEnvelope() {
        return true;
      },
      async syncFullLibrary() {
        // Remote deletion tombstone removes snap-del from local storage
        storage.setSnapshots([]);
        return {
          syncedAt: 5000,
          totalSavesSynced: 0,
          importedSavesFromCloud: 0,
          mergedRegionsFromCloud: 0,
          pushedToCloud: true,
          cloudBackend: 'google_drive_appdata',
        };
      },
      async syncProgress() {
        syncProgressCalled = true;
        throw new Error('syncProgress must not run for a deleted active snapshot');
      },
    };

    await executeSingleSyncPass({
      cloudSave,
      controller,
      getLiveState: () => ({
        puzzle,
        activeSnapshotId: 'snap-del',
        activeSave: snap,
        activeTitle: 'Deleted',
        filledRegionIds: new Set([101]),
        paintedRegionColors: new Map([[101, 1]]),
        isFreeColorMode: false,
        activeColorId: 1,
        hapticsEnabled: false,
      }),
      getViewport: () => ({ zoomScale: 1, panOffsetX: 0, panOffsetY: 0 }),
      getValidRegionIds: () => new Set([101, 102, 103]),
      isSnapshotTransitioning: () => false,
      getTransitionSeq: () => 1,
      storage,
      haptic: () => {},
      applySnapshots: () => {},
      applyReconciledActiveSlot: () => {
        appliedReconcile = true;
      },
    });

    assert.equal(syncProgressCalled, false, 'Deleted active snapshot must skip syncProgress');
    assert.equal(appliedReconcile, false, 'Deleted active snapshot must not mutate active canvas state');
    assert.equal(storage.saveActiveCalls.length, 0, 'Deleted active snapshot must not call saveActiveState');
  }

  // 5. Stale mid-sync active-snapshot switch protection (both ID switch and transitionSeq bump)
  {
    const puzzleA = makeTestPuzzle();
    const puzzleB = makeTestPuzzle();
    const snapA = makeSnapshot({ id: 'snap-a', filledRegionIds: [101] });
    const storage = makeMemoryStorage([snapA]);
    const controller = coordMod.createCoalescedSyncController();
    let transitionSeq = 1;
    let activeState = {
      puzzle: puzzleA,
      activeSnapshotId: 'snap-a',
      activeSave: snapA,
      activeTitle: 'A',
      filledRegionIds: new Set([101]),
      paintedRegionColors: new Map([[101, 1]]),
      isFreeColorMode: false,
      activeColorId: 1,
      hapticsEnabled: false,
    };
    let appliedReconcile = false;

    const cloudSave = {
      providerName: 'mock-cloud',
      async pullEnvelope() {
        return null;
      },
      async pushEnvelope() {
        return true;
      },
      async syncFullLibrary() {
        // User switches snapshot mid-flight!
        transitionSeq = 2;
        activeState = {
          ...activeState,
          puzzle: puzzleB,
          activeSnapshotId: 'snap-b',
        };
        return {
          syncedAt: 7000,
          totalSavesSynced: 1,
          importedSavesFromCloud: 0,
          mergedRegionsFromCloud: 2,
          pushedToCloud: true,
          cloudBackend: 'google_drive_appdata',
        };
      },
      async syncProgress(slotKey) {
        return {
          slotKey,
          mergedDelta: {
            version: 2,
            filledRegionIds: [101, 102, 103],
            resetEpoch: 5,
            updatedAt: 7000,
          },
          addedFromCloud: 2,
          pushedToCloud: true,
          syncedAt: 7000,
        };
      },
    };

    await executeSingleSyncPass({
      cloudSave,
      controller,
      getLiveState: () => activeState,
      getViewport: () => ({ zoomScale: 1, panOffsetX: 0, panOffsetY: 0 }),
      getValidRegionIds: () => new Set([101, 102, 103]),
      isSnapshotTransitioning: () => false,
      getTransitionSeq: () => transitionSeq,
      storage,
      haptic: () => {},
      applySnapshots: () => {},
      applyReconciledActiveSlot: () => {
        appliedReconcile = true;
      },
    });

    assert.equal(
      appliedReconcile,
      false,
      'Stale async sync pass must never overwrite active React state after snapshot switch'
    );
    assert.equal(storage.saveActiveCalls.length, 0);
  }

  // 6. buildActiveSlotSyncPayload prefers storage when storage resetEpoch > UI resetEpoch
  {
    const preSyncSnap = makeSnapshot({
      id: 'snap-ep',
      filledRegionIds: [103],
      paintedRegionColors: { 103: 3 },
      resetEpoch: 5,
    });
    const payload = buildActiveSlotSyncPayload({
      startSnapshotId: 'snap-ep',
      startSampleUri: './assets/capy_forest.webp',
      startSourceRef: { kind: 'sample', uri: './assets/capy_forest.webp' },
      preSyncSnap,
      preSyncState: {
        puzzle: makeTestPuzzle(),
        activeSnapshotId: 'snap-ep',
        activeSave: makeSnapshot({ id: 'snap-ep', resetEpoch: 2 }),
        activeTitle: 'Capy',
        filledRegionIds: new Set([101, 102]),
        paintedRegionColors: new Map([[101, 1]]),
        isFreeColorMode: false,
        activeColorId: 1,
        hapticsEnabled: false,
      },
      preSyncActiveMatches: true,
      now: 9000,
    });
    assert.equal(payload.slotEpoch, 5);
    assert.deepEqual(payload.localDelta.filledRegionIds, [103]);
    assert.deepEqual(payload.localDelta.paintedRegionColors, { 103: 3 });
  }

  // 6b. Regression: buildActiveSlotSyncPayload normalizes NaN & non-integer resetEpoch inputs
  {
    const nanSnapPayload = buildActiveSlotSyncPayload({
      startSnapshotId: 'snap-nan',
      startSampleUri: './assets/capy_forest.webp',
      startSourceRef: { kind: 'sample', uri: './assets/capy_forest.webp' },
      preSyncSnap: makeSnapshot({
        id: 'snap-nan',
        filledRegionIds: [101],
        paintedRegionColors: { 101: 1 },
        resetEpoch: Number.NaN,
      }),
      preSyncState: {
        puzzle: makeTestPuzzle(),
        activeSnapshotId: 'snap-nan',
        activeSave: makeSnapshot({ id: 'snap-nan', resetEpoch: 2 }),
        activeTitle: 'Capy',
        filledRegionIds: new Set([102]),
        paintedRegionColors: new Map([[102, 2]]),
        isFreeColorMode: true,
        activeColorId: 2,
        hapticsEnabled: false,
      },
      preSyncActiveMatches: true,
      now: 9100,
    });
    assert.equal(nanSnapPayload.slotEpoch, 2);
    assert.equal(nanSnapPayload.localDelta.resetEpoch, 2);
    assert.deepEqual(nanSnapPayload.localDelta.filledRegionIds, [102]);

    const floatUiPayload = buildActiveSlotSyncPayload({
      startSnapshotId: 'snap-float',
      startSampleUri: './assets/capy_forest.webp',
      startSourceRef: { kind: 'sample', uri: './assets/capy_forest.webp' },
      preSyncSnap: makeSnapshot({
        id: 'snap-float',
        filledRegionIds: [101],
        resetEpoch: 1,
      }),
      preSyncState: {
        puzzle: makeTestPuzzle(),
        activeSnapshotId: 'snap-float',
        activeSave: makeSnapshot({ id: 'snap-float', resetEpoch: 2.9 }),
        activeTitle: 'Capy',
        filledRegionIds: new Set([103]),
        paintedRegionColors: new Map([[103, 3]]),
        isFreeColorMode: true,
        activeColorId: 3,
        hapticsEnabled: false,
      },
      preSyncActiveMatches: true,
      now: 9200,
    });
    assert.equal(floatUiPayload.slotEpoch, 2);
    assert.equal(floatUiPayload.localDelta.resetEpoch, 2);
  }

  // 6c. Regression: local empty reset at higher resetEpoch flushes {} paintedRegionColors before syncFullLibrary
  {
    const puzzle = makeTestPuzzle({ isFreeColor: true });
    const staleStorageSnap = makeSnapshot({
      id: 'snap-reset-flush',
      filledRegionIds: [101, 102],
      paintedRegionColors: { 101: 1, 102: 2 },
      isFreeColor: true,
      resetEpoch: 1,
    });
    const storage = makeMemoryStorage([staleStorageSnap]);
    const controller = coordMod.createCoalescedSyncController();
    let syncedSnapshotsSeenByCloud = [];

    const cloudSave = {
      providerName: 'mock-cloud',
      async pullEnvelope() {
        return null;
      },
      async pushEnvelope() {
        return true;
      },
      async syncFullLibrary(snaps) {
        syncedSnapshotsSeenByCloud = snaps.map((s) => ({
          id: s.id,
          resetEpoch: s.resetEpoch,
          filledRegionIds: [...(s.filledRegionIds || [])],
          paintedRegionColors: s.paintedRegionColors ? { ...s.paintedRegionColors } : undefined,
        }));
        return {
          syncedAt: 9500,
          totalSavesSynced: 1,
          importedSavesFromCloud: 0,
          mergedRegionsFromCloud: 0,
          pushedToCloud: true,
          cloudBackend: 'google_drive_appdata',
        };
      },
      async syncProgress(slotKey, _title, localDelta) {
        return {
          slotKey,
          mergedDelta: localDelta,
          addedFromCloud: 0,
          pushedToCloud: true,
          syncedAt: 9500,
        };
      },
    };

    await executeSingleSyncPass({
      cloudSave,
      controller,
      getLiveState: () => ({
        puzzle,
        activeSnapshotId: 'snap-reset-flush',
        activeSave: makeSnapshot({
          id: 'snap-reset-flush',
          filledRegionIds: [],
          paintedRegionColors: {},
          isFreeColor: true,
          resetEpoch: 2,
        }),
        activeTitle: 'Reset Flush Test',
        filledRegionIds: new Set(),
        paintedRegionColors: new Map(),
        isFreeColorMode: true,
        activeColorId: 1,
        hapticsEnabled: false,
      }),
      getViewport: () => ({ zoomScale: 1, panOffsetX: 0, panOffsetY: 0 }),
      getValidRegionIds: () => new Set([101, 102, 103]),
      isSnapshotTransitioning: () => false,
      getTransitionSeq: () => 1,
      storage,
      haptic: () => {},
      now: () => 9500,
      applySnapshots: () => {},
      applyReconciledActiveSlot: () => {},
    });

    assert.equal(storage.updateCalls.length >= 1, true);
    assert.deepEqual(
      storage.updateCalls[0].paintedRegionColors,
      {},
      'flushActiveStateBeforeSync must pass {} (not undefined) so stale paintedRegionColors are cleared in storage'
    );
    assert.equal(syncedSnapshotsSeenByCloud.length, 1);
    assert.equal(syncedSnapshotsSeenByCloud[0].resetEpoch, 2);
    assert.deepEqual(syncedSnapshotsSeenByCloud[0].filledRegionIds, []);
    assert.deepEqual(
      syncedSnapshotsSeenByCloud[0].paintedRegionColors,
      {},
      'syncFullLibrary must receive cleared paintedRegionColors after local empty reset'
    );
  }

  // 7. Auth state transitions, signOut() cross-account isolation, and startup auto-sign-in
  {
    const tSignInA = evaluateAuthAutoSyncTransition(
      { isAuthenticated: true, playerId: 'user-a' },
      true,
      null
    );
    assert.deepEqual(tSignInA, {
      nextLastAutoSyncedPlayerId: 'user-a',
      shouldTriggerSync: true,
      signedOut: false,
    });

    // Duplicate notification for same player does not re-trigger
    const tDupA = evaluateAuthAutoSyncTransition(
      { isAuthenticated: true, playerId: 'user-a' },
      true,
      'user-a'
    );
    assert.equal(tDupA.shouldTriggerSync, false);
    assert.equal(tDupA.signedOut, false);

    // signOut() clears tracking for cross-account isolation
    const tSignOut = evaluateAuthAutoSyncTransition(
      { isAuthenticated: false, playerId: 'guest-1' },
      false,
      'user-a'
    );
    assert.deepEqual(tSignOut, {
      nextLastAutoSyncedPlayerId: null,
      shouldTriggerSync: false,
      signedOut: true,
    });

    // User B signing in after signOut triggers fresh sync
    const tSignInB = evaluateAuthAutoSyncTransition(
      { isAuthenticated: true, playerId: 'user-b' },
      true,
      tSignOut.nextLastAutoSyncedPlayerId
    );
    assert.equal(tSignInB.shouldTriggerSync, true);
    assert.equal(tSignInB.nextLastAutoSyncedPlayerId, 'user-b');

    // Startup auto-sign-in runs attemptAutoSignIn once and triggers sync once
    let autoSignInCalls = 0;
    let triggerSyncCalls = 0;
    const hasAttemptedRef = { current: false };
    const lastPlayerRef = { current: null };
    const mockAuth = {
      async attemptAutoSignIn() {
        autoSignInCalls += 1;
        return {
          playerId: 'user-startup',
          displayName: 'Startup',
          avatarColorHex: '#000',
          provider: 'google',
          isAuthenticated: true,
        };
      },
      getCurrentIdentity: () => ({
        playerId: 'user-startup',
        displayName: 'Startup',
        avatarColorHex: '#000',
        provider: 'google',
        isAuthenticated: true,
      }),
      hasActiveCloudToken: () => true,
    };

    const syncedFirst = await runStartupAutoSignInAndSync({
      auth: mockAuth,
      hasAttemptedStartupSignInRef: hasAttemptedRef,
      lastAutoSyncedPlayerIdRef: lastPlayerRef,
      isCancelled: () => false,
      triggerSync: async () => {
        triggerSyncCalls += 1;
      },
    });
    assert.equal(syncedFirst, true);
    assert.equal(autoSignInCalls, 1);
    assert.equal(triggerSyncCalls, 1);

    // Second invocation does not re-attempt startup sign-in or re-sync same player
    const syncedSecond = await runStartupAutoSignInAndSync({
      auth: mockAuth,
      hasAttemptedStartupSignInRef: hasAttemptedRef,
      lastAutoSyncedPlayerIdRef: lastPlayerRef,
      isCancelled: () => false,
      triggerSync: async () => {
        triggerSyncCalls += 1;
      },
    });
    assert.equal(syncedSecond, false);
    assert.equal(autoSignInCalls, 1);
    assert.equal(triggerSyncCalls, 1);
  }

  // 8. Offline / error / unauthenticated status transitions & SSR smoke render via ProviderContextProvider
  assert.equal(typeof isNavigatorOffline(), 'boolean');
  assert.equal(resolvePostSyncStatus(true, false), 'synced');
  assert.equal(resolvePostSyncStatus(false, false), 'idle');
  assert.equal(resolvePostSyncStatus(false, true), 'offline');
  assert.deepEqual(resolveSyncErrorState(new Error('Drive 503'), false), {
    status: 'error',
    errorMessage: 'Drive 503',
  });
  assert.deepEqual(resolveSyncErrorState('network down', true), {
    status: 'offline',
    errorMessage: 'Unable to reach cloud storage.',
  });
  {
    // Unauthenticated auto-sync scheduler strictly no-ops
    let schedulerSyncCalls = 0;
    const scheduler = coordMod.createAutoCloudSyncScheduler({
      sync: async () => {
        schedulerSyncCalls += 1;
      },
      canSync: () => false,
      debounceMs: 10,
      staleVisibilityMs: 10,
    });
    scheduler.notifyOnline();
    scheduler.notifyVisibilityVisible();
    scheduler.notifyLocalMutation();
    scheduler.dispose();
    assert.equal(schedulerSyncCalls, 0, 'Unauthenticated scheduler must not trigger background sync');
  }
  {
    let captured = null;
    const puzzle = makeTestPuzzle();
    const mockProviders = {
      auth: {
        getCurrentIdentity: () => ({
          playerId: 'guest-ssr',
          displayName: 'Guest',
          avatarColorHex: '#888',
          provider: 'guest',
          isAuthenticated: false,
        }),
        hasActiveCloudToken: () => false,
        attemptAutoSignIn: async () => null,
        subscribe: () => () => {},
      },
      cloudSave: {
        providerName: 'ssr-mock',
        pullEnvelope: async () => null,
        pushEnvelope: async () => false,
        syncProgress: async () => {
          throw new Error('offline');
        },
        syncFullLibrary: async () => {
          throw new Error('offline');
        },
      },
      realtimeRoom: {},
      catalog: {},
      monetization: {},
    };

    function SmokeComponent() {
      captured = useCloudSyncController({
        showCloudCoopUi: true,
        isLoading: false,
        puzzle,
        activeSnapshotId: 'snap-ssr',
        filledRegionCount: 0,
        paintedRegionCount: 0,
        liveCoopRef: {
          current: {
            puzzle,
            activeSnapshotId: 'snap-ssr',
            activeSave: undefined,
            activeTitle: 'SSR',
            filledRegionIds: new Set(),
            paintedRegionColors: new Map(),
            isFreeColorMode: false,
            activeColorId: 1,
            settings: { hapticsEnabled: false },
          },
        },
        viewportRef: { current: { zoomScale: 1, panOffsetX: 0, panOffsetY: 0 } },
        regionByIdRef: { current: new Map() },
        snapshotTransitioningRef: { current: false },
        snapshotTransitionSeqRef: { current: 0 },
        settingsRef: { current: { hapticsEnabled: false } },
        setSnapshots: () => {},
        setFilledRegionIds: () => {},
        setPaintedRegionColors: () => {},
        setHintRegionId: () => {},
        syncUndoStack: () => {},
        syncRedoStack: () => {},
      });
      return React.createElement('div', null, `${captured.cloudSyncStatus}`);
    }

    const html = renderToStaticMarkup(
      React.createElement(
        providerCtxMod.ProviderContextProvider,
        { value: mockProviders },
        React.createElement(SmokeComponent)
      )
    );
    assert.equal(html, '<div>idle</div>');
    assert.equal(captured?.cloudSyncStatus, 'idle');
    assert.equal(captured?.lastCloudSyncError, null);
    assert.equal(typeof captured?.handleSyncCloudProgress, 'function');
  }

  // 9. Static guardrails on useCloudSyncController.ts and App.tsx
  const hookSrc = fs.readFileSync(
    path.join(projectRoot, 'src/hooks/useCloudSyncController.ts'),
    'utf8'
  );
  const appSrc = fs.readFileSync(path.join(projectRoot, 'src/App.tsx'), 'utf8');

  assert.equal(
    /\blocalStorage\b/.test(hookSrc),
    false,
    'useCloudSyncController.ts must have 0 direct localStorage references'
  );
  assert.equal(
    /\bProviderRegistry\b/.test(hookSrc),
    false,
    'useCloudSyncController.ts must use ProviderContext hooks instead of ProviderRegistry globals'
  );
  assert.equal(
    /\bProviderRegistry\b/.test(appSrc),
    false,
    'App.tsx must have 0 direct ProviderRegistry references after Stage 5 cloud sync extraction'
  );
  assert.equal(
    hookSrc.includes('useCloudSaveProvider') && hookSrc.includes('useAuthProvider'),
    true,
    'useCloudSyncController.ts must wire useCloudSaveProvider and useAuthProvider'
  );
  assert.equal(
    hookSrc.includes('reportSwallowed'),
    true,
    'useCloudSyncController.ts must instrument catches with reportSwallowed'
  );
  assert.equal(
    hookSrc.includes('useLatest'),
    true,
    'useCloudSyncController.ts must use useLatest'
  );
  assert.equal(
    appSrc.includes('useCloudSyncController('),
    true,
    'App.tsx must invoke useCloudSyncController'
  );
}
