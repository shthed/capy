import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  PaletteColor,
  PuzzleData,
  PuzzleSourceRef,
  Region,
  SavedSnapshot,
  UserSettings,
} from '../types';
import { StorageService } from '../services/StorageService';
import { NativeBridge } from '../services/NativeBridge';
import { reportSwallowed } from '../services/telemetry';
import {
  isAllowedSampleAssetPath,
  mergeProgressDeltas,
  ProgressDeltaV2,
} from '../services/CapyCodec';
import {
  AutoCloudSyncScheduler,
  CoalescedSyncController,
  createAutoCloudSyncScheduler,
  createCoalescedSyncController,
  isManifestCloudSnapshotSlot,
} from '../services/cloudSyncCoordinator';
import { handlePotentialWebOAuthPopupCallback } from '../services/providers/OAuthPkceHelper';
import { computeSlotKeyForSnapshot } from '../services/cloud/slotKey';
import { AuthProvider, CloudSaveProvider, PlayerIdentity } from '../services/providers/types';
import { useAuthProvider, useCloudSaveProvider } from '../context/ProviderContext';
import { CloudSyncLiveStatus } from '../components/CloudAccountCard';
import { CoopLiveState } from './useCoopSession';
import { UndoHistoryEntry } from './useUndoRedo';
import { buildUnifiedRegionIndex, getTotalRegionCount } from '../engine/UnifiedPuzzleLayers';
import { useLatest } from './useLatest';

export { isManifestCloudSnapshotSlot };

export interface CloudSyncUiSummary {
  addedFromCloud: number;
  syncedAt: number;
  uploadedCount?: number;
  downloadedCount?: number;
  backend?: string;
}

export interface CloudSyncViewport {
  zoomScale: number;
  panOffsetX: number;
  panOffsetY: number;
}

export interface CloudSyncLiveState {
  puzzle: PuzzleData | null;
  activeSnapshotId: string | null;
  activeSave: SavedSnapshot | undefined;
  activeTitle: string;
  filledRegionIds: Set<number>;
  paintedRegionColors: Map<number, number>;
  isFreeColorMode: boolean;
  activeColorId: number;
  hapticsEnabled: boolean;
}

export interface CloudSyncStorageAdapter {
  loadSnapshots: () => SavedSnapshot[];
  updateSnapshotProgress: (
    id: string,
    filledCount: number,
    totalCount: number,
    filledRegionIds: number[],
    zoomScale?: number,
    panOffsetX?: number,
    panOffsetY?: number,
    previewDataUrl?: string,
    paintedRegionColors?: Record<number, number>,
    customPalette?: PaletteColor[],
    isFreeColor?: boolean,
    fileSizeBytes?: number,
    resetEpoch?: number
  ) => SavedSnapshot[];
  saveActiveState: (state: {
    activeSnapshotId: string | null;
    activeColorId: number;
    filledRegionIds: number[];
    paintedRegionColors?: Record<number, number>;
    isFreeColorMode?: boolean;
    resetEpoch?: number;
    zoomScale: number;
    panOffsetX: number;
    panOffsetY: number;
  }) => void;
}

export interface ActiveSlotSyncPayload {
  slotKey: string;
  localDelta: ProgressDeltaV2;
  slotEpoch: number;
}

export interface ReconcileActiveSlotParams {
  liveFilled: Set<number>;
  livePainted: Map<number, number>;
  liveUiEpoch: number;
  isFreeColorMode: boolean;
  matchingSave: SavedSnapshot | undefined;
  slotMergedDelta: ProgressDeltaV2 | null;
  validRegionIds: ReadonlyMap<number, Region> | ReadonlySet<number>;
  now?: number;
}

export interface ReconcileActiveSlotResult {
  activeSlotMissing: boolean;
  shouldApply: boolean;
  combinedFilled: Set<number>;
  nextPainted: Map<number, number>;
  reconciledEpoch: number;
  epochAdvanced: boolean;
  gainedOnActive: number;
}

export interface ActiveSlotReconcileUpdate {
  snapshotId: string;
  combinedFilled: Set<number>;
  nextPainted: Map<number, number>;
  updatedSnapshots: SavedSnapshot[];
  syncedActiveSave: SavedSnapshot | undefined;
  epochAdvanced: boolean;
}

export interface ExecuteSingleSyncPassDeps {
  cloudSave: CloudSaveProvider;
  controller: CoalescedSyncController<CloudSyncUiSummary>;
  getLiveState: () => CloudSyncLiveState;
  getViewport: () => CloudSyncViewport;
  getValidRegionIds: () => ReadonlyMap<number, Region> | ReadonlySet<number>;
  isSnapshotTransitioning: () => boolean;
  getTransitionSeq?: () => number;
  storage?: CloudSyncStorageAdapter;
  haptic?: (type: 'success', enabled: boolean) => void;
  now?: () => number;
  applySnapshots: (snapshots: SavedSnapshot[]) => void;
  applyReconciledActiveSlot: (update: ActiveSlotReconcileUpdate) => void;
}

export interface UseCloudSyncControllerOptions {
  showCloudCoopUi: boolean;
  isLoading: boolean;
  puzzle: PuzzleData | null;
  activeSnapshotId: string | null;
  filledRegionCount: number;
  paintedRegionCount: number;
  liveCoopRef: MutableRefObject<CoopLiveState>;
  viewportRef: MutableRefObject<CloudSyncViewport>;
  regionByIdRef: MutableRefObject<Map<number, Region>>;
  snapshotTransitioningRef: MutableRefObject<boolean>;
  snapshotTransitionSeqRef: MutableRefObject<number>;
  settingsRef: MutableRefObject<UserSettings>;
  setSnapshots: Dispatch<SetStateAction<SavedSnapshot[]>>;
  setFilledRegionIds: Dispatch<SetStateAction<Set<number>>>;
  setPaintedRegionColors: Dispatch<SetStateAction<Map<number, number>>>;
  setHintRegionId: Dispatch<SetStateAction<number | null>>;
  syncUndoStack: (next: UndoHistoryEntry[]) => void;
  syncRedoStack: (next: UndoHistoryEntry[]) => void;
}

export interface UseCloudSyncControllerResult {
  cloudSyncStatus: CloudSyncLiveStatus;
  lastCloudSyncError: string | null;
  handleSyncCloudProgress: () => Promise<CloudSyncUiSummary | null>;
}

/**
 * SSR-safe helper returning true only when the browser explicitly reports offline.
 */
export function isNavigatorOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Resolves the next live cloud sync UI status after a sync pass completes.
 */
export function resolvePostSyncStatus(
  hasResult: boolean,
  isOffline: boolean
): CloudSyncLiveStatus {
  if (hasResult) return 'synced';
  return isOffline ? 'offline' : 'idle';
}

/**
 * Resolves the next live cloud sync UI status and user-facing error message when a sync throws.
 */
export function resolveSyncErrorState(
  err: unknown,
  isOffline: boolean
): { status: CloudSyncLiveStatus; errorMessage: string } {
  const errorMessage = err instanceof Error ? err.message : 'Unable to reach cloud storage.';
  return {
    status: isOffline ? 'offline' : 'error',
    errorMessage,
  };
}

/**
 * Builds a lightweight dirty-detection key for debounced auto-sync notifications.
 */
export function buildAutoSyncProgressKey(
  activeSnapshotId: string | null,
  filledRegionCount: number,
  paintedRegionCount: number
): string {
  if (!activeSnapshotId) return '';
  return `${activeSnapshotId}:${filledRegionCount}:${paintedRegionCount}`;
}

/**
 * Normalizes a raw `resetEpoch` value to a non-negative integer (matching `CapyCodec.normalizeResetEpoch`).
 */
export function normalizeResetEpoch(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

function normalizeComparableSampleUri(uri: unknown): string | null {
  if (typeof uri !== 'string') return null;
  const stripped = uri.trim().replace(/^\.\//, '').trim();
  return stripped.length > 0 ? stripped : null;
}

/**
 * Resolves the canonical sample/catalog URI associated with a saved snapshot, if any.
 */
export function resolveSnapshotSampleUri(
  activeSave?: Pick<SavedSnapshot, 'sampleAssetPath' | 'sourceRef'> | null
): string | undefined {
  if (!activeSave || typeof activeSave !== 'object') {
    return undefined;
  }
  if (
    typeof activeSave.sampleAssetPath === 'string' &&
    normalizeComparableSampleUri(activeSave.sampleAssetPath) !== null
  ) {
    return activeSave.sampleAssetPath.trim();
  }
  const kind = activeSave.sourceRef?.kind;
  const sourceUri = activeSave.sourceRef?.uri;
  if (
    (kind === 'sample' || kind === 'catalog') &&
    typeof sourceUri === 'string' &&
    normalizeComparableSampleUri(sourceUri) !== null
  ) {
    return sourceUri.trim();
  }
  return undefined;
}

/**
 * Builds a validated `PuzzleSourceRef` for cloud slot progress envelopes.
 */
export function resolveSlotSourceRef(
  effectiveSourceRef: PuzzleSourceRef | undefined,
  effectiveSampleUri: string | undefined
): PuzzleSourceRef | undefined {
  if (effectiveSourceRef?.kind === 'catalog') {
    return { kind: 'catalog', uri: effectiveSourceRef.uri };
  }
  if (isAllowedSampleAssetPath(effectiveSampleUri)) {
    return { kind: 'sample', uri: effectiveSampleUri };
  }
  return undefined;
}

/**
 * Locates the matching snapshot in the post-sync snapshot list, prioritizing exact ID match
 * before falling back to normalized sample/catalog URI.
 */
export function findMatchingSnapshotForActiveSlot(
  refreshedSnapshots: SavedSnapshot[],
  startSnapshotId: string,
  startSampleUri?: string
): SavedSnapshot | undefined {
  if (!Array.isArray(refreshedSnapshots)) return undefined;
  const exactMatch = refreshedSnapshots.find(
    (s) => Boolean(s) && typeof s === 'object' && s.id === startSnapshotId
  );
  if (exactMatch) return exactMatch;

  const normalizedActiveSample = normalizeComparableSampleUri(startSampleUri);
  if (normalizedActiveSample === null) return undefined;

  return refreshedSnapshots.find((s) => {
    if (!s || typeof s !== 'object') return false;
    return (
      normalizeComparableSampleUri(s.sourceRef?.uri) === normalizedActiveSample ||
      normalizeComparableSampleUri(s.sampleAssetPath) === normalizedActiveSample
    );
  });
}

/**
 * Constructs the active-slot `ProgressDeltaV2` envelope to push to `cloudSave.syncProgress`.
 * Prefers live UI state only when the same snapshot is still active and its `resetEpoch` is >= storage.
 */
export function buildActiveSlotSyncPayload(params: {
  startSnapshotId: string;
  startSampleUri: string | undefined;
  startSourceRef: PuzzleSourceRef | undefined;
  preSyncSnap: SavedSnapshot;
  preSyncState: CloudSyncLiveState;
  preSyncActiveMatches: boolean;
  now?: number;
}): ActiveSlotSyncPayload {
  const {
    startSnapshotId,
    startSampleUri,
    startSourceRef,
    preSyncSnap,
    preSyncState,
    preSyncActiveMatches,
    now = Date.now(),
  } = params;

  const effectiveSampleUri = preSyncSnap.sampleAssetPath ?? startSampleUri;
  const effectiveSourceRef = preSyncSnap.sourceRef ?? startSourceRef;
  const slotKey = computeSlotKeyForSnapshot({
    id: startSnapshotId,
    sampleAssetPath: effectiveSampleUri,
    sourceRef: effectiveSourceRef,
  });

  const uiEpoch = preSyncActiveMatches
    ? normalizeResetEpoch(preSyncState.activeSave?.resetEpoch)
    : 0;
  const snapEpoch = normalizeResetEpoch(preSyncSnap.resetEpoch);
  const useUiStateForSlot = preSyncActiveMatches && uiEpoch >= snapEpoch;

  const preSyncFilled = useUiStateForSlot
    ? preSyncState.filledRegionIds
    : new Set(preSyncSnap.filledRegionIds || []);
  const preSyncPainted = useUiStateForSlot
    ? Object.fromEntries(preSyncState.paintedRegionColors)
    : preSyncSnap.paintedRegionColors;
  const preSyncFreeColor = useUiStateForSlot
    ? preSyncState.isFreeColorMode
    : Boolean(preSyncSnap.isFreeColor ?? preSyncState.isFreeColorMode);
  const slotEpoch = useUiStateForSlot ? uiEpoch : snapEpoch;
  const slotSourceRef = resolveSlotSourceRef(effectiveSourceRef, effectiveSampleUri);

  const localDelta: ProgressDeltaV2 = {
    version: 2,
    ...(slotSourceRef ? { sourceRef: slotSourceRef } : {}),
    filledRegionIds: Array.from(preSyncFilled),
    ...(preSyncPainted && Object.keys(preSyncPainted).length > 0
      ? { paintedRegionColors: preSyncPainted }
      : {}),
    ...(preSyncFreeColor ? { isFreeColor: true } : {}),
    ...(slotEpoch > 0 ? { resetEpoch: slotEpoch } : {}),
    updatedAt: now,
  };

  return { slotKey, localDelta, slotEpoch };
}

function buildLiveProgressDelta(
  liveFilled: Set<number>,
  livePaintedObj: Record<number, number> | undefined,
  isFreeColorMode: boolean,
  liveUiEpoch: number,
  now: number
): ProgressDeltaV2 {
  const normalizedEpoch = normalizeResetEpoch(liveUiEpoch);
  return {
    version: 2,
    filledRegionIds: Array.from(liveFilled),
    ...(livePaintedObj ? { paintedRegionColors: livePaintedObj } : {}),
    ...(isFreeColorMode ? { isFreeColor: true } : {}),
    ...(normalizedEpoch > 0 ? { resetEpoch: normalizedEpoch } : {}),
    updatedAt: now,
  };
}

function filterDeltaToValidRegions(
  delta: ProgressDeltaV2,
  validRegionIds: ReadonlyMap<number, Region> | ReadonlySet<number>
): { combinedFilled: Set<number>; nextPainted: Map<number, number> } {
  const combinedFilled = new Set<number>();
  for (const rId of delta.filledRegionIds) {
    if (validRegionIds.has(rId)) combinedFilled.add(rId);
  }
  const nextPainted = new Map<number, number>();
  if (delta.paintedRegionColors) {
    for (const [k, v] of Object.entries(delta.paintedRegionColors)) {
      const rId = Number(k);
      if (validRegionIds.has(rId)) nextPainted.set(rId, v);
    }
  }
  return { combinedFilled, nextPainted };
}

function hasProgressDiverged(
  combinedFilled: Set<number>,
  liveFilled: Set<number>,
  nextPainted: Map<number, number>,
  livePainted: Map<number, number>
): boolean {
  if (combinedFilled.size !== liveFilled.size) return true;
  for (const id of combinedFilled) {
    if (!liveFilled.has(id)) return true;
  }
  if (nextPainted.size !== livePainted.size) return true;
  for (const [k, v] of nextPainted.entries()) {
    if (livePainted.get(k) !== v) return true;
  }
  return false;
}

/**
 * Pure reconciliation of live canvas state with post-sync storage and active-slot cloud deltas.
 * Preserves `resetEpoch` dominance for BOTH `filledRegionIds` and `paintedRegionColors` via
 * `mergeProgressDeltas`, and refuses to resurrect deleted/missing active slots.
 */
export function reconcileActiveSlotProgress(
  params: ReconcileActiveSlotParams
): ReconcileActiveSlotResult {
  const {
    liveFilled,
    livePainted,
    liveUiEpoch,
    isFreeColorMode,
    matchingSave,
    slotMergedDelta,
    validRegionIds,
    now = Date.now(),
  } = params;

  const normalizedLiveUiEpoch = normalizeResetEpoch(liveUiEpoch);

  if (!matchingSave) {
    return {
      activeSlotMissing: true,
      shouldApply: false,
      combinedFilled: liveFilled,
      nextPainted: livePainted,
      reconciledEpoch: normalizedLiveUiEpoch,
      epochAdvanced: false,
      gainedOnActive: 0,
    };
  }

  const livePaintedObj = livePainted.size > 0 ? Object.fromEntries(livePainted) : undefined;
  let reconciledDelta = buildLiveProgressDelta(
    liveFilled,
    livePaintedObj,
    isFreeColorMode,
    normalizedLiveUiEpoch,
    now
  );

  const matchingSaveEpoch = normalizeResetEpoch(matchingSave.resetEpoch);
  reconciledDelta = mergeProgressDeltas(reconciledDelta, {
    version: 2,
    filledRegionIds: matchingSave.filledRegionIds || [],
    paintedRegionColors: matchingSave.paintedRegionColors,
    isFreeColor: matchingSave.isFreeColor,
    ...(matchingSaveEpoch > 0 ? { resetEpoch: matchingSaveEpoch } : {}),
    updatedAt: matchingSave.lastOpened || matchingSave.timestamp || 0,
  });

  if (slotMergedDelta) {
    reconciledDelta = mergeProgressDeltas(reconciledDelta, slotMergedDelta);
  }

  // Ensure mid-flight local strokes at live epoch survive any stale cloud timestamp,
  // while letting a higher remote resetEpoch dominate both filledRegionIds and paintedRegionColors.
  const postCloudEpoch = normalizeResetEpoch(reconciledDelta.resetEpoch);
  if (postCloudEpoch <= normalizedLiveUiEpoch) {
    reconciledDelta = mergeProgressDeltas(
      reconciledDelta,
      buildLiveProgressDelta(liveFilled, livePaintedObj, isFreeColorMode, normalizedLiveUiEpoch, now)
    );
  }

  const { combinedFilled, nextPainted } = filterDeltaToValidRegions(
    reconciledDelta,
    validRegionIds
  );
  const reconciledEpoch = normalizeResetEpoch(reconciledDelta.resetEpoch);
  const epochAdvanced = reconciledEpoch > normalizedLiveUiEpoch;
  const gainedOnActive = Math.max(0, combinedFilled.size - liveFilled.size);
  const diverged = hasProgressDiverged(combinedFilled, liveFilled, nextPainted, livePainted);

  return {
    activeSlotMissing: false,
    shouldApply: epochAdvanced || gainedOnActive > 0 || diverged,
    combinedFilled,
    nextPainted,
    reconciledEpoch,
    epochAdvanced,
    gainedOnActive,
  };
}

function flushActiveStateBeforeSync(
  startState: CloudSyncLiveState,
  viewport: CloudSyncViewport,
  storage: CloudSyncStorageAdapter
): void {
  const { puzzle, activeSnapshotId, activeSave, filledRegionIds, paintedRegionColors } = startState;
  if (!puzzle || !activeSnapshotId) return;

  const storageSnapAtStart = storage.loadSnapshots().find((s) => s.id === activeSnapshotId);
  if (!storageSnapAtStart) return;

  const uiStartEpoch = normalizeResetEpoch(activeSave?.resetEpoch);
  const storageStartEpoch = normalizeResetEpoch(storageSnapAtStart.resetEpoch);
  if (uiStartEpoch < storageStartEpoch) return;

  const localResetEpoch = Math.max(uiStartEpoch, storageStartEpoch);
  const paintedObj = Object.fromEntries(paintedRegionColors);

  storage.updateSnapshotProgress(
    activeSnapshotId,
    filledRegionIds.size,
    getTotalRegionCount(puzzle),
    Array.from(filledRegionIds),
    viewport.zoomScale,
    viewport.panOffsetX,
    viewport.panOffsetY,
    undefined,
    paintedObj,
    puzzle.palette,
    puzzle.isFreeColor,
    undefined,
    localResetEpoch > 0 ? localResetEpoch : undefined
  );
}

async function syncActiveSlotEnvelope(params: {
  deps: ExecuteSingleSyncPassDeps;
  storage: CloudSyncStorageAdapter;
  startState: CloudSyncLiveState;
  startTransitionSeq: number;
  startSampleUri: string | undefined;
  now: () => number;
}): Promise<{
  slotAdded: number;
  slotMergedDelta: ProgressDeltaV2 | null;
  pushedSlotEpoch: number | null;
}> {
  const { deps, storage, startState, startTransitionSeq, startSampleUri, now } = params;
  const { puzzle: startPuzzle, activeSnapshotId: startSnapshotId, activeTitle: startTitle } =
    startState;
  if (!startPuzzle || !startSnapshotId) {
    return { slotAdded: 0, slotMergedDelta: null, pushedSlotEpoch: null };
  }

  const preSyncState = deps.getLiveState();
  const preSyncTransitionSeq = deps.getTransitionSeq?.() ?? 0;
  const preSyncActiveMatches =
    preSyncTransitionSeq === startTransitionSeq &&
    preSyncState.activeSnapshotId === startSnapshotId &&
    preSyncState.puzzle === startPuzzle;
  const preSyncSnap = storage.loadSnapshots().find((s) => s.id === startSnapshotId);
  if (!preSyncSnap) {
    return { slotAdded: 0, slotMergedDelta: null, pushedSlotEpoch: null };
  }

  const payload = buildActiveSlotSyncPayload({
    startSnapshotId,
    startSampleUri,
    startSourceRef: startState.activeSave?.sourceRef,
    preSyncSnap,
    preSyncState,
    preSyncActiveMatches,
    now: now(),
  });
  const res = await deps.cloudSave.syncProgress(
    payload.slotKey,
    startTitle,
    payload.localDelta,
    getTotalRegionCount(startPuzzle)
  );
  return {
    slotAdded: res.addedFromCloud,
    slotMergedDelta: res.mergedDelta,
    pushedSlotEpoch: payload.slotEpoch,
  };
}

function applyActiveSlotReconciliationIfStillActive(params: {
  deps: ExecuteSingleSyncPassDeps;
  storage: CloudSyncStorageAdapter;
  startState: CloudSyncLiveState;
  startTransitionSeq: number;
  startSampleUri: string | undefined;
  refreshedSnapshots: SavedSnapshot[];
  slotMergedDelta: ProgressDeltaV2 | null;
  liveAfterSync: CloudSyncLiveState;
  now: () => number;
}): void {
  const {
    deps,
    storage,
    startState,
    startTransitionSeq,
    startSampleUri,
    refreshedSnapshots,
    slotMergedDelta,
    liveAfterSync,
    now,
  } = params;
  const { puzzle: startPuzzle, activeSnapshotId: startSnapshotId } = startState;
  if (!startPuzzle || !startSnapshotId) return;

  const transitionSeqAfter = deps.getTransitionSeq?.() ?? 0;
  const stillSameActiveSlot =
    !deps.isSnapshotTransitioning() &&
    transitionSeqAfter === startTransitionSeq &&
    liveAfterSync.activeSnapshotId === startSnapshotId &&
    liveAfterSync.puzzle === startPuzzle;
  if (!stillSameActiveSlot) return;

  const matchingSave = findMatchingSnapshotForActiveSlot(
    refreshedSnapshots,
    startSnapshotId,
    startSampleUri
  );
  const reconciled = reconcileActiveSlotProgress({
    liveFilled: liveAfterSync.filledRegionIds,
    livePainted: liveAfterSync.paintedRegionColors,
    liveUiEpoch: normalizeResetEpoch(liveAfterSync.activeSave?.resetEpoch),
    isFreeColorMode: liveAfterSync.isFreeColorMode,
    matchingSave,
    slotMergedDelta,
    validRegionIds: deps.getValidRegionIds(),
    now: now(),
  });
  if (reconciled.activeSlotMissing || !reconciled.shouldApply) return;

  const orderedList = Array.from(reconciled.combinedFilled);
  const mergedPaintedObj = Object.fromEntries(reconciled.nextPainted);
  const { zoomScale, panOffsetX, panOffsetY } = deps.getViewport();
  const updatedSnapshots = storage.updateSnapshotProgress(
    startSnapshotId,
    reconciled.combinedFilled.size,
    getTotalRegionCount(startPuzzle),
    orderedList,
    zoomScale,
    panOffsetX,
    panOffsetY,
    undefined,
    mergedPaintedObj,
    startPuzzle.palette,
    startPuzzle.isFreeColor,
    undefined,
    reconciled.reconciledEpoch > 0 ? reconciled.reconciledEpoch : undefined
  );
  const syncedActiveSave = updatedSnapshots.find((s) => s.id === startSnapshotId);
  deps.applyReconciledActiveSlot({
    snapshotId: startSnapshotId,
    combinedFilled: reconciled.combinedFilled,
    nextPainted: reconciled.nextPainted,
    updatedSnapshots,
    syncedActiveSave,
    epochAdvanced: reconciled.epochAdvanced,
  });
  storage.saveActiveState({
    activeSnapshotId: startSnapshotId,
    activeColorId: liveAfterSync.activeColorId,
    filledRegionIds: orderedList,
    paintedRegionColors: mergedPaintedObj,
    isFreeColorMode: liveAfterSync.isFreeColorMode,
    ...(reconciled.reconciledEpoch > 0 ? { resetEpoch: reconciled.reconciledEpoch } : {}),
    zoomScale,
    panOffsetX,
    panOffsetY,
  });
}

/**
 * Executes a single full-library + active-slot cloud sync pass with mid-sync snapshot-switch
 * protection, `resetEpoch` dominance for both filled and painted regions, and trailing-pass
 * queueing when local changes arrive mid-flight.
 */
export async function executeSingleSyncPass(
  deps: ExecuteSingleSyncPassDeps
): Promise<CloudSyncUiSummary> {
  const storage = deps.storage ?? StorageService;
  const haptic = deps.haptic ?? NativeBridge.haptic;
  const now = deps.now ?? (() => Date.now());

  const startState = deps.getLiveState();
  const startTransitionSeq = deps.getTransitionSeq?.() ?? 0;
  const startSnapshotId = startState.activeSnapshotId;
  const startSampleUri = resolveSnapshotSampleUri(startState.activeSave);

  // 1. Flush active canvas state into local StorageService before full-library cloud sync
  flushActiveStateBeforeSync(startState, deps.getViewport(), storage);

  // 2. Sync the entire Save Library with the active CloudProviderDriver
  const currentSnapshots = storage.loadSnapshots();
  const libSummary = await deps.cloudSave.syncFullLibrary(currentSnapshots);

  // 3. Also sync the active slot envelope if the snapshot still exists locally
  const { slotAdded, slotMergedDelta, pushedSlotEpoch } = await syncActiveSlotEnvelope({
    deps,
    storage,
    startState,
    startTransitionSeq,
    startSampleUri,
    now,
  });

  const refreshedSnapshots = storage.loadSnapshots();
  deps.applySnapshots(refreshedSnapshots);

  // 4. Reconcile active canvas only if still on the exact same snapshot & not transitioning
  const liveAfterSync = deps.getLiveState();
  applyActiveSlotReconciliationIfStillActive({
    deps,
    storage,
    startState,
    startTransitionSeq,
    startSampleUri,
    refreshedSnapshots,
    slotMergedDelta,
    liveAfterSync,
    now,
  });

  // 5. Queue a coalesced trailing pass if local mutations or epoch advances occurred mid-sync
  const latestSavedEpoch = startSnapshotId
    ? normalizeResetEpoch(storage.loadSnapshots().find((s) => s.id === startSnapshotId)?.resetEpoch)
    : 0;
  if (
    libSummary.hasPendingLocalChanges ||
    (pushedSlotEpoch !== null && latestSavedEpoch > pushedSlotEpoch)
  ) {
    deps.controller.requestTrailingPass();
  }

  const totalAdded = Math.max(libSummary.mergedRegionsFromCloud, slotAdded);
  haptic('success', liveAfterSync.hapticsEnabled);
  return {
    addedFromCloud: totalAdded,
    syncedAt: libSummary.syncedAt,
    uploadedCount: libSummary.totalSavesSynced,
    downloadedCount: libSummary.importedSavesFromCloud,
    backend: libSummary.cloudBackend,
  };
}

/**
 * Evaluates whether an auth identity change should trigger an automatic sync,
 * returning the updated `lastAutoSyncedPlayerId` and whether a sync should run.
 * Resets cross-account tracking on sign-out (`!identity.isAuthenticated`).
 */
export function evaluateAuthAutoSyncTransition(
  identity: Pick<PlayerIdentity, 'isAuthenticated' | 'playerId'>,
  hasActiveCloudToken: boolean,
  lastAutoSyncedPlayerId: string | null
): {
  nextLastAutoSyncedPlayerId: string | null;
  shouldTriggerSync: boolean;
  signedOut: boolean;
} {
  if (!identity.isAuthenticated) {
    return {
      nextLastAutoSyncedPlayerId: null,
      shouldTriggerSync: false,
      signedOut: true,
    };
  }
  if (hasActiveCloudToken && lastAutoSyncedPlayerId !== identity.playerId) {
    return {
      nextLastAutoSyncedPlayerId: identity.playerId,
      shouldTriggerSync: true,
      signedOut: false,
    };
  }
  return {
    nextLastAutoSyncedPlayerId: lastAutoSyncedPlayerId,
    shouldTriggerSync: false,
    signedOut: false,
  };
}

/**
 * Runs startup auto-sign-in once and triggers an initial cloud sync when authenticated.
 */
export async function runStartupAutoSignInAndSync(params: {
  auth: Pick<AuthProvider, 'attemptAutoSignIn' | 'getCurrentIdentity' | 'hasActiveCloudToken'>;
  hasAttemptedStartupSignInRef: MutableRefObject<boolean>;
  lastAutoSyncedPlayerIdRef: MutableRefObject<string | null>;
  isCancelled: () => boolean;
  triggerSync: () => Promise<unknown>;
}): Promise<boolean> {
  const {
    auth,
    hasAttemptedStartupSignInRef,
    lastAutoSyncedPlayerIdRef,
    isCancelled,
    triggerSync,
  } = params;

  if (!hasAttemptedStartupSignInRef.current) {
    hasAttemptedStartupSignInRef.current = true;
    await auth.attemptAutoSignIn();
  }
  if (isCancelled()) return false;

  const currentId = auth.getCurrentIdentity();
  const transition = evaluateAuthAutoSyncTransition(
    currentId,
    auth.hasActiveCloudToken(),
    lastAutoSyncedPlayerIdRef.current
  );
  lastAutoSyncedPlayerIdRef.current = transition.nextLastAutoSyncedPlayerId;

  if (transition.shouldTriggerSync) {
    await triggerSync();
    return true;
  }
  return false;
}

/**
 * Manages BYOC cloud library & active-slot synchronization, coalesced sync passes,
 * online/offline/visibility background auto-sync scheduling, Android Play Games
 * snapshot notifications, and startup auto-sign-in / auth state transitions.
 */
export function useCloudSyncController(
  options: UseCloudSyncControllerOptions
): UseCloudSyncControllerResult {
  const cloudSave = useCloudSaveProvider();
  const auth = useAuthProvider();
  const optionsRef = useLatest(options);

  const cloudSyncControllerRef = useRef<CoalescedSyncController<CloudSyncUiSummary> | null>(null);
  const autoCloudSyncSchedulerRef = useRef<AutoCloudSyncScheduler | null>(null);
  const lastAutoSyncProgressKeyRef = useRef<string>('');
  const hasAttemptedStartupSignInRef = useRef(false);
  const lastAutoSyncedPlayerIdRef = useRef<string | null>(null);

  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncLiveStatus>(() =>
    isNavigatorOffline() ? 'offline' : 'idle'
  );
  const [lastCloudSyncError, setLastCloudSyncError] = useState<string | null>(null);

  const handleSyncCloudProgress = useCallback(async (): Promise<CloudSyncUiSummary | null> => {
    const controller =
      cloudSyncControllerRef.current ??
      (cloudSyncControllerRef.current = createCoalescedSyncController<CloudSyncUiSummary>());

    const runPass = (): Promise<CloudSyncUiSummary> => {
      const opts = optionsRef.current;
      return executeSingleSyncPass({
        cloudSave,
        controller,
        getLiveState: () => {
          const live = opts.liveCoopRef.current;
          return {
            puzzle: live.puzzle,
            activeSnapshotId: live.activeSnapshotId,
            activeSave: live.activeSave,
            activeTitle: live.activeTitle,
            filledRegionIds: live.filledRegionIds,
            paintedRegionColors: live.paintedRegionColors,
            isFreeColorMode: live.isFreeColorMode,
            activeColorId: live.activeColorId,
            hapticsEnabled: opts.settingsRef.current.hapticsEnabled,
          };
        },
        getViewport: () => opts.viewportRef.current,
        getValidRegionIds: () => {
          const livePuzzle = opts.liveCoopRef.current.puzzle;
          if (livePuzzle?.nestedLayers && livePuzzle.nestedLayers.length > 0) {
            return buildUnifiedRegionIndex(livePuzzle).byId;
          }
          return opts.regionByIdRef.current;
        },
        isSnapshotTransitioning: () => opts.snapshotTransitioningRef.current,
        getTransitionSeq: () => opts.snapshotTransitionSeqRef.current,
        applySnapshots: (refreshed) => {
          opts.setSnapshots(refreshed);
        },
        applyReconciledActiveSlot: ({
          combinedFilled,
          nextPainted,
          updatedSnapshots,
          syncedActiveSave,
          epochAdvanced,
        }) => {
          opts.liveCoopRef.current = {
            ...opts.liveCoopRef.current,
            filledRegionIds: combinedFilled,
            paintedRegionColors: nextPainted,
            ...(syncedActiveSave ? { activeSave: syncedActiveSave } : {}),
          };
          opts.setFilledRegionIds(combinedFilled);
          opts.setPaintedRegionColors(nextPainted);
          opts.setSnapshots(updatedSnapshots);
          if (epochAdvanced) {
            opts.syncUndoStack([]);
            opts.syncRedoStack([]);
            opts.setHintRegionId(null);
          }
        },
      });
    };

    setCloudSyncStatus('syncing');
    setLastCloudSyncError(null);
    try {
      const result = await controller.run(runPass);
      if (result) {
        autoCloudSyncSchedulerRef.current?.markSynced(result.syncedAt);
      }
      setCloudSyncStatus(resolvePostSyncStatus(Boolean(result), isNavigatorOffline()));
      return result;
    } catch (err) {
      const { status, errorMessage } = resolveSyncErrorState(err, isNavigatorOffline());
      setLastCloudSyncError(errorMessage);
      setCloudSyncStatus(status);
      throw err;
    }
  }, [cloudSave, optionsRef]);

  // Forward Web OAuth PKCE popup callbacks immediately if this window is an OAuth redirect popup
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      handlePotentialWebOAuthPopupCallback();
    } catch (err) {
      reportSwallowed('cloud-sync.oauth-popup-callback', err);
    }
  }, []);

  // Automatically sync when Android Play Games SnapshotsClient delivers a non-blob remote cloud snapshot
  const { showCloudCoopUi, isLoading, puzzle, activeSnapshotId, filledRegionCount, paintedRegionCount } =
    options;

  useEffect(() => {
    if (!showCloudCoopUi) return;
    return NativeBridge.onCloudSnapshot(
      () => {
        void handleSyncCloudProgress().catch((err) => {
          reportSwallowed('cloud-sync.native-snapshot-callback', err);
        });
      },
      { slotFilter: isManifestCloudSnapshotSlot }
    );
  }, [showCloudCoopUi, handleSyncCloudProgress]);

  // Automatic background cross-device BYOC cloud sync:
  // - Debounced push (15s) after local paint/save mutations
  // - Pull + merge on tab visibilitychange -> visible when stale (> 30s)
  // - Reconnect sync on window `online` event
  useEffect(() => {
    if (!showCloudCoopUi || typeof window === 'undefined' || typeof document === 'undefined') {
      autoCloudSyncSchedulerRef.current?.dispose();
      autoCloudSyncSchedulerRef.current = null;
      return;
    }

    let isOnline = !isNavigatorOffline();
    const scheduler = createAutoCloudSyncScheduler({
      sync: () =>
        handleSyncCloudProgress().catch((err) => {
          reportSwallowed('cloud-sync.auto-scheduler', err);
        }),
      canSync: () => {
        if (!isOnline) return false;
        const id = auth.getCurrentIdentity();
        return id.isAuthenticated && auth.hasActiveCloudToken();
      },
      debounceMs: 15_000,
      staleVisibilityMs: 30_000,
    });
    autoCloudSyncSchedulerRef.current = scheduler;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduler.notifyVisibilityVisible();
      }
    };
    const handleOnline = () => {
      isOnline = true;
      setCloudSyncStatus((prev) => (prev === 'offline' ? 'idle' : prev));
      scheduler.notifyOnline();
    };
    const handleOffline = () => {
      isOnline = false;
      setCloudSyncStatus('offline');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      scheduler.dispose();
      if (autoCloudSyncSchedulerRef.current === scheduler) {
        autoCloudSyncSchedulerRef.current = null;
      }
    };
  }, [showCloudCoopUi, auth, handleSyncCloudProgress]);

  // Notify debounced auto-sync scheduler whenever local puzzle progress mutates
  useEffect(() => {
    if (!showCloudCoopUi || isLoading || !activeSnapshotId) return;
    const progressKey = buildAutoSyncProgressKey(
      activeSnapshotId,
      filledRegionCount,
      paintedRegionCount
    );
    if (!lastAutoSyncProgressKeyRef.current) {
      lastAutoSyncProgressKeyRef.current = progressKey;
      return;
    }
    if (lastAutoSyncProgressKeyRef.current !== progressKey) {
      lastAutoSyncProgressKeyRef.current = progressKey;
      autoCloudSyncSchedulerRef.current?.notifyLocalMutation();
    }
  }, [showCloudCoopUi, isLoading, activeSnapshotId, filledRegionCount, paintedRegionCount]);

  // Automatically attempt Google / Play Games / Microsoft / Apple sign-in on startup and sync saves once puzzle is ready
  useEffect(() => {
    if (!showCloudCoopUi || isLoading || !puzzle || !activeSnapshotId) return;
    let cancelled = false;

    void runStartupAutoSignInAndSync({
      auth,
      hasAttemptedStartupSignInRef,
      lastAutoSyncedPlayerIdRef,
      isCancelled: () => cancelled,
      triggerSync: () => handleSyncCloudProgress(),
    }).catch((err) => {
      reportSwallowed('cloud-sync.startup-auto-signin', err);
    });

    const unsubAuth = auth.subscribe((id) => {
      const transition = evaluateAuthAutoSyncTransition(
        id,
        auth.hasActiveCloudToken(),
        lastAutoSyncedPlayerIdRef.current
      );
      lastAutoSyncedPlayerIdRef.current = transition.nextLastAutoSyncedPlayerId;

      if (transition.signedOut) {
        // Cross-account isolation: clear previous account's dirty progress key and sync UI state
        lastAutoSyncProgressKeyRef.current = '';
        setLastCloudSyncError(null);
        setCloudSyncStatus(isNavigatorOffline() ? 'offline' : 'idle');
        return;
      }

      if (!cancelled && transition.shouldTriggerSync) {
        void handleSyncCloudProgress().catch((err) => {
          reportSwallowed('cloud-sync.auth-subscribe', err);
        });
      }
    });

    return () => {
      cancelled = true;
      unsubAuth();
    };
  }, [showCloudCoopUi, isLoading, puzzle, activeSnapshotId, auth, handleSyncCloudProgress]);

  return {
    cloudSyncStatus,
    lastCloudSyncError,
    handleSyncCloudProgress,
  };
}
