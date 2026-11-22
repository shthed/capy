import {
  GeneratorConfig,
  PaletteColor,
  PuzzleData,
  SAMPLE_GALLERY,
  SampleArtwork,
  SavedSnapshot,
  UserSettings,
} from '../types';
import { StorageService } from './StorageService';
import type { ActiveSessionState } from './storage/ActiveSessionStorage';
import type { ImportSnapshotResult } from './storage/SnapshotArchiveCodec';
import { SafeLocalStore } from './storage/SafeLocalStore';
import { TUTORIAL_COMPLETED_KEY } from './storage/StorageKeys';
import { resolveScopedBackupKey } from './StorageNamespace';
import { NativeBridge } from './NativeBridge';
import {
  isAllowedSampleAssetPath,
  isSafeSnapshotPreviewDataUrl,
  mergeProgressDeltas,
} from './CapyCodec';
import {
  clearShareHashFromWindowUrl,
  parseShareLinkFromUrl,
  type ParsedShareLink,
} from './ShareLinkService';
import { ProviderRegistry } from './providers/ProviderRegistry';
import type { CoopParticipant } from './providers/types';
import { getVisiblePalette } from '../components/PaletteDock';
import { reportSwallowed } from './telemetry';

export interface SessionViewport {
  zoomScale: number;
  panOffsetX: number;
  panOffsetY: number;
}

export interface SessionUndoEntry {
  regionId: number;
  wasPreviouslyFilled: boolean;
  previousPaintedColorId?: number;
  paintedColorId?: number;
}

export interface SessionCoopPatch {
  puzzle: PuzzleData;
  activeSnapshotId: string;
  activeSave?: SavedSnapshot;
  activeTitle?: string;
  activeColorId: number;
  filledRegionIds: Set<number>;
  paintedRegionColors: Map<number, number>;
  isFreeColorMode: boolean;
}

export interface SessionRestoreSettings {
  paletteSort: UserSettings['paletteSort'];
  autoReplayOnLoad?: boolean;
  generatorConfig: GeneratorConfig;
}

export interface ResolvedSnapshotImage {
  src: string;
  objectUrl: string | null;
}

export type LoadArtworkFromImageFn = (
  img: HTMLImageElement,
  title: string,
  config?: GeneratorConfig,
  initialFilledRegionIds?: Set<number>,
  initialActiveColorId?: number,
  existingSnapshotId?: string,
  sampleAssetPath?: string | null,
  shouldAutoReplay?: boolean,
  sourceBlob?: Blob | null,
  initialPaintedColors?: Record<number, number>,
  initialViewportOverride?: SessionViewport,
  initialCustomPalette?: PaletteColor[],
  initialIsFreeColor?: boolean,
  parentSnapshotId?: string
) => Promise<void> | void;

export type SessionRestorePhaseResult =
  | 'share_prebaked'
  | 'share_dynamic'
  | 'active_cached'
  | 'active_regenerated'
  | 'starter_bundle'
  | 'dynamic_sample'
  | 'image_failed'
  | 'cancelled';

export interface SessionRestoreCallbacks {
  getSettings: () => SessionRestoreSettings;
  getTransitionSeq: () => number;
  nextCoopJoinSeq: () => number;
  getCoopJoinSeq: () => number;
  getActiveBlobUrl: () => string | null;
  setActiveBlobUrl: (url: string | null) => void;
  resolveSnapshotImageSrc: (snap: SavedSnapshot) => Promise<ResolvedSnapshotImage>;
  loadArtworkFromImage: LoadArtworkFromImageFn;
  clearPendingViewportSave: () => void;
  onApplyViewport: (view: SessionViewport) => void;
  onSetSnapshots: (
    nextOrUpdater: SavedSnapshot[] | ((prev: SavedSnapshot[]) => SavedSnapshot[])
  ) => void;
  onSetPaintedRegionColors: (painted: Map<number, number>) => void;
  onSetSettings: (updater: (prev: UserSettings) => UserSettings) => void;
  onUpdateSettings: (updater: (prev: UserSettings) => UserSettings) => void;
  onSetSourceImage: (img: HTMLImageElement) => void;
  onSetPuzzle: (puzzle: PuzzleData) => void;
  onSetActiveSnapshotId: (snapshotId: string) => void;
  onSetActiveColorId: (colorId: number) => void;
  onUpdateLiveCoop: (patch: SessionCoopPatch) => void;
  onSetFilledRegionIds: (filled: Set<number>) => void;
  onSyncUndoStack: (entries: SessionUndoEntry[]) => void;
  onSyncRedoStack: (entries: SessionUndoEntry[]) => void;
  onSetHintRegionId: (regionId: number | null) => void;
  onResetActivePuzzleSessionStats: (snapshotId: string, isComplete: boolean) => void;
  onSetIsLoading: (loading: boolean) => void;
  onStartReplay: (orderedIds: number[], isPostLoad: boolean) => void;
  onSetShowTutorial: (show: boolean) => void;
  onSetCoopRoomState: (roomCode: string | null, participants: CoopParticipant[]) => void;
}

export interface SessionRestoreStorageDeps {
  loadActiveState: () => ActiveSessionState | null;
  saveActiveState: (state: ActiveSessionState) => void;
  loadSnapshots: () => SavedSnapshot[];
  hydrateSnapshotPreviews: (snaps: SavedSnapshot[]) => Promise<SavedSnapshot[]>;
  loadPuzzleData: (snapshotId: string) => Promise<PuzzleData | null>;
  loadImageBlob: (blobId: string) => Promise<Blob | null>;
  importSnapshotData: (
    data: ArrayBuffer,
    options?: { refreshTimestamps?: boolean }
  ) => Promise<ImportSnapshotResult>;
  updateSnapshotProgress: typeof StorageService.updateSnapshotProgress;
}

export interface SessionRestoreDeps {
  parseShareLinkFromUrl: (rawUrl: string) => Promise<ParsedShareLink>;
  clearShareHashFromWindowUrl: (roomCode?: string | null) => void;
  fetchBundle: (url: string) => Promise<{ ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> } | null>;
  loadHtmlImage: (src: string, fallbackSrc?: string) => Promise<HTMLImageElement | null>;
  revokeObjectUrl: (url: string) => void;
  storage: SessionRestoreStorageDeps;
  auth: {
    getCurrentIdentity: () => {
      playerId: string;
      displayName: string;
      avatarColorHex: string;
    };
  };
  realtimeRoom: {
    readonly activeRoomCode: string | null;
    joinRoom: (roomCode: string, participant: CoopParticipant) => Promise<unknown>;
    getParticipants: () => CoopParticipant[];
  };
  safeLocalStore: {
    getScopedItem: (key: string) => string | null;
  };
  nativeBridge: {
    loadBackup: (key: string) => string | null;
  };
  sampleGallery: readonly SampleArtwork[];
  getWindowLocationHref: () => string | null;
  getWindowLocationSearch: () => string;
}

interface PipelineContext {
  signal: AbortSignal;
  isCancelled: () => boolean;
  skipBootstrap: boolean;
  callbacks: SessionRestoreCallbacks;
  deps: SessionRestoreDeps;
}

export function mergeCustomPalette(
  generatedPalette: PaletteColor[],
  customPalette?: PaletteColor[]
): PaletteColor[] {
  if (!customPalette || customPalette.length === 0) {
    return generatedPalette;
  }
  const customById = new Map<number, PaletteColor>();
  for (let i = 0; i < customPalette.length; i++) {
    const col = customPalette[i];
    customById.set(col.id, col);
  }
  const seenIds = new Set<number>();
  const merged: PaletteColor[] = generatedPalette.map((col) => {
    seenIds.add(col.id);
    return customById.get(col.id) || col;
  });
  for (let i = 0; i < customPalette.length; i++) {
    const col = customPalette[i];
    if (!seenIds.has(col.id)) {
      merged.push(customById.get(col.id) ?? col);
      seenIds.add(col.id);
    }
  }
  return merged;
}

export function loadHtmlImage(src: string, fallbackSrc?: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => {
      if (fallbackSrc && fallbackSrc !== src) {
        const fb = new Image();
        fb.crossOrigin = 'anonymous';
        fb.onload = () => resolve(fb);
        fb.onerror = () => resolve(null);
        fb.src = fallbackSrc;
      } else {
        resolve(null);
      }
    };
    img.src = src;
  });
}

export function mergeSnapshotPreviews(
  prev: SavedSnapshot[],
  hydrated: SavedSnapshot[]
): SavedSnapshot[] {
  const previewById = new Map<string, string>();
  for (const snap of hydrated) {
    if (snap.previewDataUrl) previewById.set(snap.id, snap.previewDataUrl);
  }
  if (previewById.size === 0) return prev;
  let anyUpdated = false;
  const merged = prev.map((item) => {
    const preview = previewById.get(item.id);
    if (preview && item.previewDataUrl !== preview) {
      anyUpdated = true;
      return { ...item, previewDataUrl: preview };
    }
    return item;
  });
  return anyUpdated ? merged : prev;
}

export function shouldAutoStartTutorial(
  search: string,
  deps: Pick<SessionRestoreDeps, 'safeLocalStore' | 'nativeBridge'>,
  swallowTag: string
): boolean {
  const skipTutorial = new URLSearchParams(search).has('skipTutorial');
  let tutorialCompleted = false;
  try {
    tutorialCompleted =
      deps.safeLocalStore.getScopedItem(TUTORIAL_COMPLETED_KEY) === '1' ||
      deps.nativeBridge.loadBackup(resolveScopedBackupKey(TUTORIAL_COMPLETED_KEY)) === '1';
  } catch (err) {
    reportSwallowed(swallowTag, err);
  }
  return !skipTutorial && !tutorialCompleted;
}

export function createDefaultSessionRestoreDeps(): SessionRestoreDeps {
  return {
    parseShareLinkFromUrl,
    clearShareHashFromWindowUrl,
    fetchBundle: (url: string) =>
      fetch(url).catch((err) => {
        reportSwallowed('SessionRestore.fetchBundle', err);
        return null;
      }),
    loadHtmlImage,
    revokeObjectUrl: (url: string) => {
      if (
        typeof url === 'string' &&
        url.startsWith('blob:') &&
        typeof URL !== 'undefined' &&
        typeof URL.revokeObjectURL === 'function'
      ) {
        URL.revokeObjectURL(url);
      }
    },
    storage: {
      loadActiveState: () => StorageService.loadActiveState(),
      saveActiveState: (state) => StorageService.saveActiveState(state),
      loadSnapshots: () => StorageService.loadSnapshots(),
      hydrateSnapshotPreviews: (snaps) => StorageService.hydrateSnapshotPreviews(snaps),
      loadPuzzleData: (id) => StorageService.loadPuzzleData(id),
      loadImageBlob: (blobId) => StorageService.loadImageBlob(blobId),
      importSnapshotData: (data, options) => StorageService.importSnapshotData(data, options),
      updateSnapshotProgress: (...args) => StorageService.updateSnapshotProgress(...args),
    },
    auth: ProviderRegistry.auth,
    realtimeRoom: ProviderRegistry.realtimeRoom,
    safeLocalStore: SafeLocalStore,
    nativeBridge: NativeBridge,
    sampleGallery: SAMPLE_GALLERY,
    getWindowLocationHref: () => (typeof window !== 'undefined' ? window.location.href : null),
    getWindowLocationSearch: () => (typeof window !== 'undefined' ? window.location.search : ''),
  };
}

function buildUndoEntries(orderedIds: number[]): SessionUndoEntry[] {
  return orderedIds.map((regionId) => ({
    regionId,
    wasPreviouslyFilled: false,
  }));
}

function revokeBlobUrlIfNeeded(
  url: string | null,
  revokeObjectUrl: (url: string) => void
): void {
  if (url && url.startsWith('blob:')) {
    revokeObjectUrl(url);
  }
}

function commitActiveBlobUrl(
  usedObjectUrl: string | null,
  callbacks: SessionRestoreCallbacks,
  revokeObjectUrl: (url: string) => void
): void {
  const prevBlobUrl = callbacks.getActiveBlobUrl();
  callbacks.setActiveBlobUrl(usedObjectUrl);
  if (prevBlobUrl && prevBlobUrl !== usedObjectUrl) {
    revokeObjectUrl(prevBlobUrl);
  }
}

async function joinSharedCoopRoom(
  roomCode: string,
  isCancelled: () => boolean,
  callbacks: SessionRestoreCallbacks,
  deps: SessionRestoreDeps
): Promise<void> {
  if (isCancelled()) return;
  const joinSeq = callbacks.nextCoopJoinSeq();
  try {
    const id = deps.auth.getCurrentIdentity();
    await deps.realtimeRoom.joinRoom(roomCode, {
      playerId: id.playerId,
      displayName: id.displayName,
      avatarColorHex: id.avatarColorHex,
      lastActiveAt: Date.now(),
    });
    if (!isCancelled() && joinSeq === callbacks.getCoopJoinSeq()) {
      callbacks.onSetCoopRoomState(
        deps.realtimeRoom.activeRoomCode,
        deps.realtimeRoom.getParticipants()
      );
    }
  } catch (err) {
    reportSwallowed('SessionRestore.joinRoom', err);
  }
}

async function ensurePrebakedShareSnapshots(
  skipBootstrap: boolean,
  isCancelled: () => boolean,
  deps: SessionRestoreDeps
): Promise<SavedSnapshot[]> {
  let snaps = deps.storage.loadSnapshots();
  if (snaps.length > 0 || skipBootstrap) return snaps;
  try {
    const bundleResp = await deps.fetchBundle('./assets/sample_saves.capy');
    if (isCancelled() || !bundleResp || !bundleResp.ok) return snaps;
    const buffer = await bundleResp.arrayBuffer();
    if (isCancelled()) return snaps;
    await deps.storage.importSnapshotData(buffer, { refreshTimestamps: true });
    if (isCancelled()) return snaps;
    snaps = deps.storage.loadSnapshots();
  } catch (err) {
    reportSwallowed('SessionRestore.shareBundleBootstrap', err);
  }
  return snaps;
}

function applyPrebakedShareRestore(
  prebakedSnap: SavedSnapshot,
  cachedPuzzle: PuzzleData,
  sampleImg: HTMLImageElement,
  parsedLink: ParsedShareLink,
  callbacks: SessionRestoreCallbacks,
  deps: SessionRestoreDeps
): void {
  const delta = parsedLink.delta!;
  deps.clearShareHashFromWindowUrl(deps.realtimeRoom.activeRoomCode || parsedLink.roomCode);
  const validIds = new Set(cachedPuzzle.regions.map((r) => r.id));
  const mergedDelta = mergeProgressDeltas(
    {
      version: 2,
      filledRegionIds: prebakedSnap.filledRegionIds || [],
      paintedRegionColors: prebakedSnap.paintedRegionColors,
      isFreeColor: prebakedSnap.isFreeColor,
      ...(prebakedSnap.resetEpoch && prebakedSnap.resetEpoch > 0
        ? { resetEpoch: prebakedSnap.resetEpoch }
        : {}),
      updatedAt: prebakedSnap.lastOpened || prebakedSnap.timestamp || 0,
    },
    {
      version: 2,
      filledRegionIds: delta.filledRegionIds,
      paintedRegionColors: delta.paintedRegionColors,
      isFreeColor: delta.isFreeColor,
      ...(delta.resetEpoch && delta.resetEpoch > 0 ? { resetEpoch: delta.resetEpoch } : {}),
      updatedAt: delta.updatedAt || Date.now(),
    }
  );
  const orderedIds = mergedDelta.filledRegionIds.filter((id) => validIds.has(id));
  const filledSet = new Set(orderedIds);
  const paintedObj = mergedDelta.paintedRegionColors || {};
  const mergedEpoch = mergedDelta.resetEpoch ?? 0;
  const restoredPaintedMap = new Map(
    Object.entries(paintedObj)
      .map(([k, v]) => [Number(k), v] as [number, number])
      .filter(([k]) => validIds.has(k))
  );
  const isFree = Boolean(
    mergedDelta.isFreeColor ||
      prebakedSnap.isFreeColor ||
      cachedPuzzle.isFreeColor ||
      restoredPaintedMap.size > 0
  );
  const settings = callbacks.getSettings();
  const availableColors = getVisiblePalette(
    cachedPuzzle.palette,
    cachedPuzzle.regions,
    filledSet,
    settings.paletteSort
  );
  const initialColor = availableColors[0]?.id || cachedPuzzle.palette[0]?.id || 1;
  const paintedRecord = Object.fromEntries(restoredPaintedMap);
  const updatedList = deps.storage.updateSnapshotProgress(
    prebakedSnap.id,
    filledSet.size,
    cachedPuzzle.regions.length,
    orderedIds,
    1.0,
    0,
    0,
    undefined,
    paintedRecord,
    cachedPuzzle.palette,
    isFree,
    undefined,
    mergedEpoch > 0 ? mergedEpoch : undefined
  );
  callbacks.clearPendingViewportSave();
  callbacks.onApplyViewport({ zoomScale: 1.0, panOffsetX: 0, panOffsetY: 0 });
  const syncedSnap = updatedList.find((s) => s.id === prebakedSnap.id);
  callbacks.onSetSnapshots(updatedList);
  callbacks.onSetPaintedRegionColors(restoredPaintedMap);
  callbacks.onSetSettings((prev) => ({ ...prev, isFreeColorMode: isFree }));
  callbacks.onSetSourceImage(sampleImg);
  callbacks.onSetPuzzle(cachedPuzzle);
  callbacks.onSetActiveSnapshotId(prebakedSnap.id);
  callbacks.onSetActiveColorId(initialColor);
  callbacks.onUpdateLiveCoop({
    puzzle: cachedPuzzle,
    activeSnapshotId: prebakedSnap.id,
    ...(syncedSnap ? { activeSave: syncedSnap, activeTitle: syncedSnap.title || 'Capy' } : {}),
    activeColorId: initialColor,
    filledRegionIds: filledSet,
    paintedRegionColors: restoredPaintedMap,
    isFreeColorMode: isFree,
  });
  callbacks.onSetFilledRegionIds(filledSet);
  callbacks.onSyncUndoStack(buildUndoEntries(orderedIds));
  callbacks.onSyncRedoStack([]);
  callbacks.onSetHintRegionId(null);
  deps.storage.saveActiveState({
    activeSnapshotId: prebakedSnap.id,
    activeColorId: initialColor,
    filledRegionIds: orderedIds,
    paintedRegionColors: paintedRecord,
    isFreeColorMode: isFree,
    ...(mergedEpoch > 0 ? { resetEpoch: mergedEpoch } : {}),
    zoomScale: 1.0,
    panOffsetX: 0,
    panOffsetY: 0,
  });
  callbacks.onSetIsLoading(false);
}

/**
 * Phase 1: Parse incoming `#s=` share links and `?room=` co-op invites,
 * bootstrapping pre-baked starter saves on cold start and merging deltas via CRDT rules.
 */
export async function restoreShareLinkPhase(
  context: PipelineContext
): Promise<SessionRestorePhaseResult | null> {
  const { isCancelled, skipBootstrap, callbacks, deps } = context;
  const href = deps.getWindowLocationHref();
  if (!href) return null;

  const parsedLink = await deps.parseShareLinkFromUrl(href);
  if (isCancelled()) return 'cancelled';

  if (parsedLink.roomCode) {
    await joinSharedCoopRoom(parsedLink.roomCode, isCancelled, callbacks, deps);
  }
  if (isCancelled()) return 'cancelled';

  if (parsedLink.tokenError || (parsedLink.hasToken && !parsedLink.matchedSample)) {
    deps.clearShareHashFromWindowUrl(deps.realtimeRoom.activeRoomCode || parsedLink.roomCode);
  }
  if (!parsedLink.matchedSample || !parsedLink.delta) return null;

  const sharedSample = parsedLink.matchedSample;
  const cleanSamplePath = sharedSample.assetPath.replace(/^\.\//, '');
  const snaps = await ensurePrebakedShareSnapshots(skipBootstrap, isCancelled, deps);
  if (isCancelled()) return 'cancelled';

  const prebakedSnap = snaps.find(
    (s) => s.sampleAssetPath?.replace(/^\.\//, '') === cleanSamplePath
  );
  if (prebakedSnap) {
    const [cachedPuzzle, sampleImg] = await Promise.all([
      deps.storage.loadPuzzleData(prebakedSnap.id),
      deps.loadHtmlImage(sharedSample.assetPath),
    ]);
    if (isCancelled()) return 'cancelled';
    if (cachedPuzzle && sampleImg) {
      applyPrebakedShareRestore(prebakedSnap, cachedPuzzle, sampleImg, parsedLink, callbacks, deps);
      return 'share_prebaked';
    }
  }

  const img = await deps.loadHtmlImage(sharedSample.assetPath);
  if (isCancelled()) return 'cancelled';
  if (!img) {
    callbacks.onSetIsLoading(false);
    return 'image_failed';
  }
  deps.clearShareHashFromWindowUrl(deps.realtimeRoom.activeRoomCode || parsedLink.roomCode);
  callbacks.loadArtworkFromImage(
    img,
    sharedSample.title,
    callbacks.getSettings().generatorConfig,
    new Set(parsedLink.delta.filledRegionIds),
    undefined,
    undefined,
    sharedSample.assetPath,
    false,
    null,
    parsedLink.delta.paintedRegionColors
  );
  return 'share_dynamic';
}

interface RestoredActiveProgress {
  isMatchingActive: boolean;
  orderedIds: number[];
  filledSet: Set<number>;
  restoredView: SessionViewport;
  restoredPaintedMap: Map<number, number>;
  isFree: boolean;
  fallbackPainted: Record<number, number> | undefined;
}

function resolveRestoredViewport(
  candidateSnap: SavedSnapshot,
  matchingActive: ActiveSessionState | null
): SessionViewport {
  return {
    zoomScale: matchingActive?.zoomScale ?? candidateSnap.zoomScale ?? 1.0,
    panOffsetX: matchingActive?.panOffsetX ?? candidateSnap.panOffsetX ?? 0,
    panOffsetY: matchingActive?.panOffsetY ?? candidateSnap.panOffsetY ?? 0,
  };
}

function resolveRawPaintedColors(
  candidateSnap: SavedSnapshot,
  matchingActive: ActiveSessionState | null,
  snapEpochNewer: boolean,
  activeEpochNewer: boolean
): Record<number, number> | undefined {
  if (activeEpochNewer) return matchingActive?.paintedRegionColors;
  if (snapEpochNewer) return candidateSnap.paintedRegionColors;
  return candidateSnap.paintedRegionColors ?? matchingActive?.paintedRegionColors;
}

function buildRestoredActiveProgress(
  candidateSnap: SavedSnapshot,
  activeState: ActiveSessionState | null,
  cachedPuzzleIsFreeColor?: boolean
): RestoredActiveProgress {
  const isMatchingActive = activeState?.activeSnapshotId === candidateSnap.id;
  const matchingActive = isMatchingActive ? activeState : null;
  const snapEpoch = candidateSnap.resetEpoch ?? 0;
  const activeEpoch = matchingActive?.resetEpoch ?? 0;
  const snapEpochNewer = snapEpoch > activeEpoch;
  const activeEpochNewer = Boolean(matchingActive) && activeEpoch > snapEpoch;
  const activeFilled = !snapEpochNewer ? matchingActive?.filledRegionIds : undefined;
  const orderedIds = activeFilled ?? candidateSnap.filledRegionIds ?? [];
  const filledSet = new Set(orderedIds);
  const restoredView = resolveRestoredViewport(candidateSnap, matchingActive);
  const rawPainted = resolveRawPaintedColors(
    candidateSnap,
    matchingActive,
    snapEpochNewer,
    activeEpochNewer
  );
  const restoredPaintedMap = rawPainted
    ? new Map(Object.entries(rawPainted).map(([k, v]) => [Number(k), v]))
    : new Map<number, number>();
  const isFree = Boolean(
    candidateSnap.isFreeColor || cachedPuzzleIsFreeColor || matchingActive?.isFreeColorMode
  );
  return {
    isMatchingActive,
    orderedIds,
    filledSet,
    restoredView,
    restoredPaintedMap,
    isFree,
    fallbackPainted: rawPainted,
  };
}

function hydratePreviewsInBackground(
  existingSnapshots: SavedSnapshot[],
  signal: AbortSignal,
  callbacks: SessionRestoreCallbacks,
  deps: SessionRestoreDeps
): void {
  if (existingSnapshots.length === 0) return;
  void deps.storage
    .hydrateSnapshotPreviews(existingSnapshots)
    .then((hydrated) => {
      if (signal.aborted) return;
      callbacks.onSetSnapshots((prev) => mergeSnapshotPreviews(prev, hydrated));
    })
    .catch((err) => {
      reportSwallowed('SessionRestore.hydratePreviews', err);
    });
}

function applyCachedSnapshotRestore(
  candidateSnap: SavedSnapshot,
  cachedPuzzle: PuzzleData,
  img: HTMLImageElement,
  activeState: ActiveSessionState | null,
  callbacks: SessionRestoreCallbacks
): void {
  const progress = buildRestoredActiveProgress(candidateSnap, activeState, cachedPuzzle.isFreeColor);
  if (candidateSnap.customPalette && candidateSnap.customPalette.length > 0) {
    cachedPuzzle.palette = mergeCustomPalette(cachedPuzzle.palette, candidateSnap.customPalette);
  }
  const settings = callbacks.getSettings();
  const availableColors = getVisiblePalette(
    cachedPuzzle.palette,
    cachedPuzzle.regions,
    progress.filledSet,
    settings.paletteSort
  );
  const restoredColor =
    progress.isMatchingActive &&
    activeState?.activeColorId &&
    availableColors.some((c) => c.id === activeState.activeColorId)
      ? activeState.activeColorId
      : availableColors[0]?.id || cachedPuzzle.palette[0]?.id || 1;

  callbacks.clearPendingViewportSave();
  callbacks.onApplyViewport(progress.restoredView);
  callbacks.onSetPaintedRegionColors(progress.restoredPaintedMap);
  callbacks.onUpdateSettings((prev) => ({
    ...prev,
    isFreeColorMode: progress.isFree,
    ...(prev.replayLoop ? { replayLoop: false } : {}),
  }));
  callbacks.onSetSourceImage(img);
  callbacks.onSetPuzzle(cachedPuzzle);
  callbacks.onSetActiveSnapshotId(candidateSnap.id);
  callbacks.onSetActiveColorId(restoredColor);
  callbacks.onUpdateLiveCoop({
    puzzle: cachedPuzzle,
    activeSnapshotId: candidateSnap.id,
    activeSave: candidateSnap,
    activeTitle: candidateSnap.title || 'Capy',
    activeColorId: restoredColor,
    filledRegionIds: progress.filledSet,
    paintedRegionColors: progress.restoredPaintedMap,
    isFreeColorMode: progress.isFree,
  });
  callbacks.onSetFilledRegionIds(progress.filledSet);
  callbacks.onSyncUndoStack(buildUndoEntries(progress.orderedIds));
  callbacks.onSyncRedoStack([]);
  callbacks.onResetActivePuzzleSessionStats(
    candidateSnap.id,
    cachedPuzzle.regions.length > 0 && progress.filledSet.size >= cachedPuzzle.regions.length
  );
  callbacks.onSetIsLoading(false);
  if (settings.autoReplayOnLoad !== false && progress.orderedIds.length > 0) {
    callbacks.onStartReplay(progress.orderedIds, true);
  }
}

type LoadedSnapshotImageOutcome =
  | { status: 'ok'; img: HTMLImageElement; usedObjectUrl: string | null }
  | { status: 'cancelled' }
  | { status: 'image_failed' };

async function loadSnapshotImageWithBlobGuard(
  candidateSnap: SavedSnapshot,
  context: PipelineContext
): Promise<LoadedSnapshotImageOutcome> {
  const { isCancelled, callbacks, deps } = context;
  const resolved = await callbacks.resolveSnapshotImageSrc(candidateSnap);
  if (isCancelled()) {
    if (resolved.objectUrl) deps.revokeObjectUrl(resolved.objectUrl);
    return { status: 'cancelled' };
  }

  const fallbackSrc = isSafeSnapshotPreviewDataUrl(candidateSnap.previewDataUrl)
    ? candidateSnap.previewDataUrl.trim()
    : './assets/capybara.webp';
  const img = await deps.loadHtmlImage(resolved.src, fallbackSrc);
  if (isCancelled() || !img) {
    if (resolved.objectUrl) deps.revokeObjectUrl(resolved.objectUrl);
    if (!isCancelled()) {
      callbacks.onSetIsLoading(false);
      return { status: 'image_failed' };
    }
    return { status: 'cancelled' };
  }

  const usedObjectUrl =
    resolved.objectUrl && img.src === resolved.objectUrl ? resolved.objectUrl : null;
  if (resolved.objectUrl && !usedObjectUrl) {
    revokeBlobUrlIfNeeded(resolved.objectUrl, deps.revokeObjectUrl);
  }
  return { status: 'ok', img, usedObjectUrl };
}

async function regenerateEvictedSnapshot(
  candidateSnap: SavedSnapshot,
  img: HTMLImageElement,
  usedObjectUrl: string | null,
  activeState: ActiveSessionState | null,
  context: PipelineContext
): Promise<SessionRestorePhaseResult> {
  const { isCancelled, callbacks, deps } = context;
  const safeCandidateSamplePath = isAllowedSampleAssetPath(candidateSnap.sampleAssetPath)
    ? candidateSnap.sampleAssetPath
    : undefined;
  const blobKey =
    candidateSnap.sourceRef?.kind === 'blob' ? candidateSnap.sourceRef.uri : candidateSnap.id;
  let storedBlob: Blob | null = null;
  if (!safeCandidateSamplePath) {
    try {
      storedBlob = await deps.storage.loadImageBlob(blobKey);
    } catch (err) {
      revokeBlobUrlIfNeeded(usedObjectUrl, deps.revokeObjectUrl);
      throw err;
    }
  }
  if (isCancelled()) {
    revokeBlobUrlIfNeeded(usedObjectUrl, deps.revokeObjectUrl);
    return 'cancelled';
  }

  commitActiveBlobUrl(usedObjectUrl, callbacks, deps.revokeObjectUrl);
  const progress = buildRestoredActiveProgress(candidateSnap, activeState);
  const settings = callbacks.getSettings();
  callbacks.loadArtworkFromImage(
    img,
    candidateSnap.title,
    settings.generatorConfig,
    progress.filledSet,
    progress.isMatchingActive ? activeState?.activeColorId : undefined,
    candidateSnap.id,
    safeCandidateSamplePath,
    settings.autoReplayOnLoad !== false,
    storedBlob,
    progress.fallbackPainted,
    progress.restoredView,
    candidateSnap.customPalette,
    progress.isFree
  );
  return 'active_regenerated';
}

/**
 * Phase 2: Restore an existing active snapshot from IndexedDB cache or regenerate
 * on cache eviction while strictly managing blob URL lifecycle and `resetEpoch` dominance.
 */
export async function restoreActiveSnapshotPhase(
  context: PipelineContext,
  activeState: ActiveSessionState | null,
  existingSnapshots: SavedSnapshot[]
): Promise<SessionRestorePhaseResult | null> {
  const { signal, isCancelled, callbacks, deps } = context;
  hydratePreviewsInBackground(existingSnapshots, signal, callbacks, deps);

  const candidateSnap =
    (activeState?.activeSnapshotId
      ? existingSnapshots.find((s) => s.id === activeState.activeSnapshotId)
      : undefined) || existingSnapshots[0];
  if (!candidateSnap) return null;

  const cachedPuzzle = await deps.storage.loadPuzzleData(candidateSnap.id);
  if (isCancelled()) return 'cancelled';

  const loaded = await loadSnapshotImageWithBlobGuard(candidateSnap, context);
  if (loaded.status !== 'ok') return loaded.status;

  if (cachedPuzzle) {
    commitActiveBlobUrl(loaded.usedObjectUrl, callbacks, deps.revokeObjectUrl);
    applyCachedSnapshotRestore(candidateSnap, cachedPuzzle, loaded.img, activeState, callbacks);
    return 'active_cached';
  }

  return regenerateEvictedSnapshot(
    candidateSnap,
    loaded.img,
    loaded.usedObjectUrl,
    activeState,
    context
  );
}

function applyStarterBundleRestore(
  firstSnap: SavedSnapshot,
  firstPuzzle: PuzzleData,
  firstImg: HTMLImageElement,
  refreshedList: SavedSnapshot[],
  callbacks: SessionRestoreCallbacks,
  deps: SessionRestoreDeps
): void {
  const orderedIds = firstSnap.filledRegionIds || [];
  const filledSet = new Set(orderedIds);
  if (firstSnap.customPalette && firstSnap.customPalette.length > 0) {
    firstPuzzle.palette = firstSnap.customPalette;
  }
  const availableColors = getVisiblePalette(
    firstPuzzle.palette,
    firstPuzzle.regions,
    filledSet,
    callbacks.getSettings().paletteSort
  );
  const initialColor = availableColors[0]?.id || firstPuzzle.palette[0]?.id || 1;
  const isFree = Boolean(firstSnap.isFreeColor || firstPuzzle.isFreeColor);

  callbacks.clearPendingViewportSave();
  callbacks.onApplyViewport({ zoomScale: 1.0, panOffsetX: 0, panOffsetY: 0 });
  callbacks.onSetSnapshots(refreshedList);
  callbacks.onSetPaintedRegionColors(new Map());
  callbacks.onSetSettings((prev) => ({ ...prev, isFreeColorMode: isFree }));
  callbacks.onSetSourceImage(firstImg);
  callbacks.onSetPuzzle(firstPuzzle);
  callbacks.onSetActiveSnapshotId(firstSnap.id);
  callbacks.onSetActiveColorId(initialColor);
  callbacks.onUpdateLiveCoop({
    puzzle: firstPuzzle,
    activeSnapshotId: firstSnap.id,
    activeSave: refreshedList.find((s) => s.id === firstSnap.id),
    activeTitle: firstSnap.title || 'Capy',
    activeColorId: initialColor,
    filledRegionIds: filledSet,
    paintedRegionColors: new Map(),
    isFreeColorMode: isFree,
  });
  callbacks.onSetFilledRegionIds(filledSet);
  callbacks.onSyncUndoStack(buildUndoEntries(orderedIds));
  callbacks.onSyncRedoStack([]);
  callbacks.onSetHintRegionId(null);
  callbacks.onResetActivePuzzleSessionStats(
    firstSnap.id,
    firstPuzzle.regions.length > 0 && filledSet.size >= firstPuzzle.regions.length
  );
  deps.storage.saveActiveState({
    activeSnapshotId: firstSnap.id,
    activeColorId: initialColor,
    filledRegionIds: orderedIds,
    paintedRegionColors: {},
    isFreeColorMode: isFree,
    zoomScale: 1.0,
    panOffsetX: 0,
    panOffsetY: 0,
  });
  callbacks.onSetIsLoading(false);
  if (
    shouldAutoStartTutorial(
      deps.getWindowLocationSearch(),
      deps,
      'App.restoreSession.tutorialCheck'
    )
  ) {
    callbacks.onSetShowTutorial(true);
  }
}

/**
 * Phase 3: Cold-start first-time bootstrap from `./assets/sample_saves.capy`
 * for zero-wait gameplay, followed by first-time onboarding tutorial check.
 */
export async function bootstrapStarterBundlePhase(
  context: PipelineContext,
  existingSnapshots: SavedSnapshot[],
  defaultSample: SampleArtwork
): Promise<SessionRestorePhaseResult | null> {
  const { isCancelled, skipBootstrap, callbacks, deps } = context;
  if (existingSnapshots.length > 0 || skipBootstrap) return null;

  try {
    const [bundleResp, sampleImg] = await Promise.all([
      deps.fetchBundle('./assets/sample_saves.capy'),
      deps.loadHtmlImage(defaultSample.assetPath),
    ]);
    if (isCancelled()) return 'cancelled';
    if (!bundleResp || !bundleResp.ok || !sampleImg) return null;

    const bundleBuffer = await bundleResp.arrayBuffer();
    if (isCancelled()) return 'cancelled';
    const imported = await deps.storage.importSnapshotData(bundleBuffer, {
      refreshTimestamps: true,
    });
    if (isCancelled()) return 'cancelled';
    if (imported.importedCount <= 0 || !imported.firstSnapshot || !imported.firstPuzzle) {
      return null;
    }

    const firstSnap = imported.firstSnapshot;
    const firstImg =
      isAllowedSampleAssetPath(firstSnap.sampleAssetPath) &&
      firstSnap.sampleAssetPath !== defaultSample.assetPath
        ? (await deps.loadHtmlImage(firstSnap.sampleAssetPath, defaultSample.assetPath)) || sampleImg
        : sampleImg;
    if (isCancelled()) return 'cancelled';

    const refreshedList = await deps.storage.hydrateSnapshotPreviews(deps.storage.loadSnapshots());
    if (isCancelled()) return 'cancelled';

    applyStarterBundleRestore(firstSnap, imported.firstPuzzle, firstImg, refreshedList, callbacks, deps);
    return 'starter_bundle';
  } catch (err) {
    reportSwallowed('SessionRestore.starterBundleBootstrap', err);
    return null;
  }
}

/**
 * Phase 4: Dynamic puzzle generation fallback for `SAMPLE_GALLERY[0]` when no
 * saved snapshot or pre-baked starter bundle is available.
 */
export async function fallbackDynamicSamplePhase(
  context: PipelineContext,
  defaultSample: SampleArtwork
): Promise<SessionRestorePhaseResult> {
  const { isCancelled, callbacks, deps } = context;
  if (isCancelled()) return 'cancelled';

  const img = await deps.loadHtmlImage(defaultSample.assetPath);
  if (isCancelled()) return 'cancelled';
  if (!img) {
    callbacks.onSetIsLoading(false);
    return 'image_failed';
  }

  callbacks.loadArtworkFromImage(
    img,
    defaultSample.title,
    callbacks.getSettings().generatorConfig,
    new Set(),
    undefined,
    undefined,
    defaultSample.assetPath
  );
  if (
    shouldAutoStartTutorial(
      deps.getWindowLocationSearch(),
      deps,
      'App.restoreSession.tutorialFallbackCheck'
    )
  ) {
    callbacks.onSetShowTutorial(true);
  }
  return 'dynamic_sample';
}

export interface RunSessionRestoreOptions {
  signal: AbortSignal;
  callbacks: SessionRestoreCallbacks;
  deps?: Partial<SessionRestoreDeps>;
}

/**
 * Runs the 4-phase app-launch session restore pipeline under `AbortSignal` +
 * `snapshotTransitionSeqRef` cancellation guards.
 */
export async function runSessionRestorePipeline(
  options: RunSessionRestoreOptions
): Promise<SessionRestorePhaseResult> {
  const { signal, callbacks } = options;
  const deps: SessionRestoreDeps = {
    ...createDefaultSessionRestoreDeps(),
    ...options.deps,
  };
  const restoreSeq = callbacks.getTransitionSeq();
  const isCancelled = (): boolean => signal.aborted || restoreSeq !== callbacks.getTransitionSeq();
  const skipBootstrap = new URLSearchParams(deps.getWindowLocationSearch()).has(
    'skipSampleBootstrap'
  );
  const context: PipelineContext = { signal, isCancelled, skipBootstrap, callbacks, deps };

  const phase1 = await restoreShareLinkPhase(context);
  if (phase1) return phase1;
  if (isCancelled()) return 'cancelled';

  const activeState = deps.storage.loadActiveState();
  const existingSnapshots = deps.storage.loadSnapshots();
  const phase2 = await restoreActiveSnapshotPhase(context, activeState, existingSnapshots);
  if (phase2) return phase2;

  const defaultSample = deps.sampleGallery[0];
  const phase3 = await bootstrapStarterBundlePhase(context, existingSnapshots, defaultSample);
  if (phase3) return phase3;

  return fallbackDynamicSamplePhase(context, defaultSample);
}
