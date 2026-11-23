import React, {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import {
  DEFAULT_GENERATOR_CONFIG,
  GenerationProgressPayload,
  GeneratorConfig,
  InfiniteZoomNodeMeta,
  MAX_GENERATOR_CONFIG,
  matchesGeneratorConfig,
  PaletteColor,
  PuzzleData,
  SAMPLE_GALLERY,
  SampleArtwork,
  SavedSnapshot,
  UserSettings,
} from '../types';
import { DEFAULT_SETTINGS, StorageService } from '../services/StorageService';
import { compressImageForStorage } from '../services/storage/ImageCompression';
import { reportSwallowed } from '../services/telemetry';
import { NativeBridge } from '../services/NativeBridge';
import { PlayerLifetimeStats, PlayerStatsService } from '../services/PlayerStatsService';
import { GenerationCancelledError, PuzzleWorkerService } from '../services/PuzzleWorkerService';
import {
  isAllowedSampleAssetPath,
  isSafeSnapshotPreviewDataUrl,
  mergeProgressDeltas,
} from '../services/CapyCodec';
import {
  exportActivePrintableSvg,
  exportAllSnapshotsArchive,
  exportColoredArtworkPng,
  exportSingleSnapshotArchive,
  exportSnapshotPrintableSvg,
  generatePreviewDataUrl,
  importSnapshotsArchive,
} from '../services/artworkExporter';
import { loadHtmlImage, mergeCustomPalette } from '../services/sessionRestorePipeline';
import {
  resolveSafeSampleAssetPath,
  resolveSafeSnapshotPreviewUrl,
} from '../utils/snapshotPaths';
import { FeatureOfferId } from '../services/FeatureOffersService';
import { getVisiblePalette } from '../components/PaletteDock';
import { TutorialTriedActions } from '../components/OnboardingTutorial';
import type { CoopLiveState, CoopLoadSampleFn, CoopViewport } from './useCoopSession';
import type { UndoHistoryEntry } from './useUndoRedo';
import { useIsomorphicLayoutEffect, useLatest } from './useLatest';

export interface BlobUrlCommitPlan {
  nextActiveBlobUrl: string | null;
  urlsToRevoke: string[];
}

export interface InfiniteZoomLoadOptions {
  zoomTree?: InfiniteZoomNodeMeta;
  linkParentId?: string;
  linkChildId?: string;
  peerZoomTreePatch?: Partial<InfiniteZoomNodeMeta>;
  preserveLosslessAlpha?: boolean;
  onRegistered?: (snapId: string) => void;
  onFinished?: () => void;
}

function applyInfiniteZoomTreeLinks(
  snapshots: SavedSnapshot[],
  snapId: string,
  opts?: InfiniteZoomLoadOptions
): SavedSnapshot[] {
  if (opts?.linkParentId) {
    return StorageService.linkZoomTreeSnapshots(
      opts.linkParentId,
      snapId,
      opts.peerZoomTreePatch,
      opts.zoomTree
    );
  }
  if (opts?.linkChildId) {
    return StorageService.linkZoomTreeSnapshots(
      snapId,
      opts.linkChildId,
      opts.zoomTree,
      opts.peerZoomTreePatch
    );
  }
  return snapshots;
}

function persistSnapshotSourceBlob(params: {
  snapId: string;
  sourceBlob: Blob | null | undefined;
  img: HTMLImageElement;
  width: number;
  height: number;
  preserveLosslessAlpha: boolean;
  expectedTransitionSeq: number;
  snapshotTransitionSeqRef: MutableRefObject<number>;
}): void {
  const {
    snapId,
    sourceBlob,
    img,
    width,
    height,
    preserveLosslessAlpha,
    expectedTransitionSeq,
    snapshotTransitionSeqRef,
  } = params;
  const persistBlobPromise =
    preserveLosslessAlpha && sourceBlob
      ? Promise.resolve(sourceBlob)
      : compressImageForStorage({ blob: sourceBlob, image: img, width, height });
  void persistBlobPromise
    .then((blob) => {
      if (
        !blob ||
        expectedTransitionSeq !== snapshotTransitionSeqRef.current ||
        !StorageService.loadSnapshots().some((s) => s.id === snapId)
      ) {
        return;
      }
      return StorageService.saveImageBlob(snapId, blob);
    })
    .catch((err) => console.warn('Failed to persist source image blob:', err));
}

export interface UseSnapshotLibraryParams {
  puzzle: PuzzleData | null;
  sourceImage: HTMLImageElement | null;
  snapshots: SavedSnapshot[];
  activeSnapshotId: string | null;
  activeSave: SavedSnapshot | undefined;
  activeTitle: string;
  filledRegionIds: Set<number>;
  paintedRegionColors: Map<number, number>;
  isFreeColorMode: boolean;
  settings: UserSettings;
  liveCoopRef: MutableRefObject<CoopLiveState>;
  latestRenderCoopRef: MutableRefObject<CoopLiveState>;
  viewportRef: MutableRefObject<CoopViewport>;
  snapshotTransitioningRef: MutableRefObject<boolean>;
  snapshotTransitionSeqRef: MutableRefObject<number>;
  activeBlobUrlRef: MutableRefObject<string | null>;
  loadSampleForCoopRef: MutableRefObject<CoopLoadSampleFn | null>;
  applyViewport: (view: CoopViewport) => void;
  clearPendingViewportSave: () => void;
  resetReplayState: () => void;
  startReplay: (sequence: number[], isPostLoad?: boolean) => void;
  syncUndoStack: (
    updater: UndoHistoryEntry[] | ((prev: UndoHistoryEntry[]) => UndoHistoryEntry[])
  ) => void;
  syncRedoStack: (
    updater: UndoHistoryEntry[] | ((prev: UndoHistoryEntry[]) => UndoHistoryEntry[])
  ) => void;
  resetActivePuzzleSessionStats: (
    snapshotId: string | null | undefined,
    alreadyCompleted: boolean
  ) => void;
  emitCoopUnfill: (regionIds: number[]) => void;
  handleUpdateSettings: (updater: UserSettings | ((prev: UserSettings) => UserSettings)) => void;
  setSettings: Dispatch<SetStateAction<UserSettings>>;
  setSnapshots: Dispatch<SetStateAction<SavedSnapshot[]>>;
  setActiveSnapshotId: Dispatch<SetStateAction<string | null>>;
  setPuzzle: Dispatch<SetStateAction<PuzzleData | null>>;
  setSourceImage: Dispatch<SetStateAction<HTMLImageElement | null>>;
  setFilledRegionIds: Dispatch<SetStateAction<Set<number>>>;
  setPaintedRegionColors: Dispatch<SetStateAction<Map<number, number>>>;
  setActiveColorId: Dispatch<SetStateAction<number>>;
  setHintRegionId: Dispatch<SetStateAction<number | null>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setLoadingProgress: Dispatch<SetStateAction<number>>;
  setLoadingStatus: Dispatch<SetStateAction<string>>;
  setLoadingPayload: Dispatch<SetStateAction<GenerationProgressPayload | null>>;
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  setLifetimeStats: Dispatch<SetStateAction<PlayerLifetimeStats>>;
  markTutorialActionTried: (action: keyof TutorialTriedActions) => void;
  triggerFeatureOffer: (id: FeatureOfferId) => void;
  onBeforeSnapshotResetOrSwitch?: () => void;
}

/**
 * Pure helper checking whether a generator config matches the default preset.
 */
export function isDefaultGeneratorConfig(cfg: GeneratorConfig): boolean {
  return matchesGeneratorConfig(cfg, DEFAULT_GENERATOR_CONFIG);
}

/**
 * Pure helper checking whether a generator config matches the max-detail preset.
 */
export function isMaxGeneratorConfig(cfg: GeneratorConfig): boolean {
  return matchesGeneratorConfig(cfg, MAX_GENERATOR_CONFIG);
}

/**
 * Pure helper resolving the IndexedDB blob lookup key for a snapshot.
 */
export function resolveBlobIdForSnapshot(snap: Pick<SavedSnapshot, 'id' | 'sourceRef'>): string {
  return snap.sourceRef?.kind === 'blob' &&
    typeof snap.sourceRef.uri === 'string' &&
    snap.sourceRef.uri.trim().length > 0
    ? snap.sourceRef.uri
    : snap.id;
}

/**
 * Pure helper determining whether a sample load should attempt prebaked `.capy` import first.
 */
export function shouldUsePrebakedSample(options: {
  skipBootstrap: boolean;
  prebakedSnapshotId?: string;
  forceGeneratorConfig?: GeneratorConfig;
}): boolean {
  if (options.skipBootstrap) return false;
  if (options.prebakedSnapshotId) return true;
  if (!options.forceGeneratorConfig) return true;
  return (
    isDefaultGeneratorConfig(options.forceGeneratorConfig) ||
    isMaxGeneratorConfig(options.forceGeneratorConfig)
  );
}

function normalizeResetEpoch(value?: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function isBlobUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.startsWith('blob:');
}

/**
 * Pure helper computing the strictly monotonic `resetEpoch` for progress reset anti-resurrection.
 */
export function computeNextResetEpoch(
  activeSaveEpoch?: number,
  liveSaveEpoch?: number,
  freshSnapEpoch?: number,
  activeStateEpoch?: number
): number {
  return (
    Math.max(
      0,
      normalizeResetEpoch(activeSaveEpoch),
      normalizeResetEpoch(liveSaveEpoch),
      normalizeResetEpoch(freshSnapEpoch),
      normalizeResetEpoch(activeStateEpoch)
    ) + 1
  );
}

/**
 * Pure helper computing safe `blob:`-only URL commit & revocation plan without premature revocation.
 */
export function resolveBlobUrlCommitPlan(
  resolvedObjectUrl: string | null,
  loadedImgSrc: string,
  prevActiveBlobUrl: string | null
): BlobUrlCommitPlan {
  const usedUrl =
    isBlobUrl(resolvedObjectUrl) && loadedImgSrc === resolvedObjectUrl ? resolvedObjectUrl : null;
  const urlsToRevoke: string[] = [];
  if (isBlobUrl(resolvedObjectUrl) && !usedUrl) {
    urlsToRevoke.push(resolvedObjectUrl);
  }
  if (isBlobUrl(prevActiveBlobUrl) && prevActiveBlobUrl !== usedUrl) {
    urlsToRevoke.push(prevActiveBlobUrl);
  }
  return { nextActiveBlobUrl: usedUrl, urlsToRevoke };
}

/**
 * Pure helper computing the 2x center detail crop rectangle.
 */
export function computeDetailTileCrop(
  srcW: number,
  srcH: number
): { cropX: number; cropY: number; cropW: number; cropH: number } {
  const safeW = Number.isFinite(srcW) && srcW > 0 ? Math.floor(srcW) : 0;
  const safeH = Number.isFinite(srcH) && srcH > 0 ? Math.floor(srcH) : 0;
  const cropW = Math.min(safeW, Math.max(128, Math.round(safeW * 0.5)));
  const cropH = Math.min(safeH, Math.max(128, Math.round(safeH * 0.5)));
  const cropX = Math.max(0, Math.min(safeW - cropW, Math.round((safeW - cropW) / 2)));
  const cropY = Math.max(0, Math.min(safeH - cropH, Math.round((safeH - cropH) / 2)));
  return { cropX, cropY, cropW, cropH };
}

/**
 * Pure helper formatting the `(2x Detail)` sub-tile title without stacking suffixes.
 */
export function buildDetailTileTitle(activeTitle: string): string {
  return activeTitle.includes('(2x Detail)') ? activeTitle : `${activeTitle} (2x Detail)`;
}

function revokeBlobUrlSafely(url: string | null): void {
  if (isBlobUrl(url)) {
    URL.revokeObjectURL(url);
  }
}

function findPrebakedSnapshot(
  snaps: SavedSnapshot[],
  cleanSamplePath: string,
  prebakedSnapshotId?: string
): SavedSnapshot | undefined {
  return prebakedSnapshotId
    ? snaps.find((s) => s.id === prebakedSnapshotId)
    : snaps.find(
        (s) => s.isAutoSample && s.sampleAssetPath?.replace(/^\.\//, '') === cleanSamplePath
      );
}

function isGenerationCancellationError(err: unknown): boolean {
  return (
    err instanceof GenerationCancelledError ||
    (err as Error)?.name === 'GenerationCancelledError' ||
    Boolean((err as Error)?.message?.includes('cancelled'))
  );
}

/**
 * Pure helper merging optional incoming progress deltas onto a prebaked sample snapshot.
 */
export function resolvePrebakedSampleProgress(opts: {
  sample: SampleArtwork;
  prebakedSnap: SavedSnapshot;
  cachedPuzzle: PuzzleData;
  deltaFilledIds?: number[];
  deltaPaintedColors?: Record<number, number>;
  deltaIsFreeColor?: boolean;
  deltaResetEpoch?: number;
}): {
  orderedIds: number[];
  filledSet: Set<number>;
  restoredPaintedMap: Map<number, number>;
  mergedEpoch: number;
  isFree: boolean;
} {
  const {
    sample,
    prebakedSnap,
    cachedPuzzle,
    deltaFilledIds,
    deltaPaintedColors,
    deltaIsFreeColor,
    deltaResetEpoch,
  } = opts;
  const validIds = new Set(cachedPuzzle.regions.map((r) => r.id));
  const mergedSampleDelta =
    deltaFilledIds !== undefined
      ? mergeProgressDeltas(
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
            filledRegionIds: deltaFilledIds,
            paintedRegionColors: deltaPaintedColors,
            isFreeColor: deltaIsFreeColor,
            ...(deltaResetEpoch && deltaResetEpoch > 0 ? { resetEpoch: deltaResetEpoch } : {}),
            updatedAt: Date.now(),
          }
        )
      : null;

  const rawOrdered = mergedSampleDelta
    ? mergedSampleDelta.filledRegionIds
    : prebakedSnap.filledRegionIds || [];
  const orderedIds = rawOrdered.filter((id) => validIds.has(id));
  const filledSet = new Set(orderedIds);
  const rawPainted = mergedSampleDelta
    ? mergedSampleDelta.paintedRegionColors || {}
    : prebakedSnap.paintedRegionColors || {};
  const mergedEpoch = mergedSampleDelta
    ? mergedSampleDelta.resetEpoch ?? 0
    : prebakedSnap.resetEpoch ?? 0;
  const restoredPaintedMap = new Map(
    Object.entries(rawPainted)
      .map(([k, v]) => [Number(k), v] as [number, number])
      .filter(([k]) => validIds.has(k))
  );
  const isFree = Boolean(
    deltaIsFreeColor ||
      sample.isFreeColor ||
      prebakedSnap.isFreeColor ||
      cachedPuzzle.isFreeColor ||
      restoredPaintedMap.size > 0
  );
  return { orderedIds, filledSet, restoredPaintedMap, mergedEpoch, isFree };
}

export function useSnapshotLibrary(params: UseSnapshotLibraryParams) {
  const {
    puzzle,
    sourceImage,
    snapshots,
    activeSnapshotId,
    activeSave,
    activeTitle,
    filledRegionIds,
    paintedRegionColors,
    isFreeColorMode,
    settings,
    liveCoopRef,
    latestRenderCoopRef,
    viewportRef,
    snapshotTransitioningRef,
    snapshotTransitionSeqRef,
    activeBlobUrlRef,
    loadSampleForCoopRef,
    applyViewport,
    clearPendingViewportSave,
    resetReplayState,
    startReplay,
    syncUndoStack,
    syncRedoStack,
    resetActivePuzzleSessionStats,
    emitCoopUnfill,
    handleUpdateSettings,
    setSettings,
    setSnapshots,
    setActiveSnapshotId,
    setPuzzle,
    setSourceImage,
    setFilledRegionIds,
    setPaintedRegionColors,
    setActiveColorId,
    setHintRegionId,
    setIsLoading,
    setLoadingProgress,
    setLoadingStatus,
    setLoadingPayload,
    setShowSettings,
    setLifetimeStats,
    markTutorialActionTried,
    triggerFeatureOffer,
    onBeforeSnapshotResetOrSwitch,
  } = params;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const generationSeqRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (activeBlobUrlRef.current) {
        revokeBlobUrlSafely(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
      }
    };
  }, [activeBlobUrlRef]);

  const resolveSnapshotImageSrc = useCallback(
    async (snap: SavedSnapshot): Promise<{ src: string; objectUrl: string | null }> => {
      const safeSampleSrc = resolveSafeSampleAssetPath(snap, true);
      if (safeSampleSrc) {
        return { src: safeSampleSrc, objectUrl: null };
      }
      const storedBlob = await StorageService.loadImageBlob(resolveBlobIdForSnapshot(snap));
      if (storedBlob) {
        const nextUrl = URL.createObjectURL(storedBlob);
        return { src: nextUrl, objectUrl: nextUrl };
      }
      const safePreview = resolveSafeSnapshotPreviewUrl(snap) ?? './assets/capybara.webp';
      return { src: safePreview, objectUrl: null };
    },
    []
  );

  const clearActiveLocalPuzzleState = useCallback(() => {
    setActiveSnapshotId(null);
    setPuzzle(null);
    setFilledRegionIds(new Set());
    setPaintedRegionColors(new Map());
    syncUndoStack([]);
    syncRedoStack([]);
    setHintRegionId(null);
  }, [
    setActiveSnapshotId,
    setFilledRegionIds,
    setHintRegionId,
    setPaintedRegionColors,
    setPuzzle,
    syncRedoStack,
    syncUndoStack,
  ]);

  const abortFailedTransition = useCallback(() => {
    setPuzzle(null);
    setActiveSnapshotId(null);
    clearPendingViewportSave();
    snapshotTransitioningRef.current = false;
    liveCoopRef.current = {
      ...latestRenderCoopRef.current,
      activeSnapshotId: null,
      puzzle: null,
    };
    setIsLoading(false);
  }, [
    clearPendingViewportSave,
    latestRenderCoopRef,
    liveCoopRef,
    setActiveSnapshotId,
    setIsLoading,
    setPuzzle,
    snapshotTransitioningRef,
  ]);

  const finalizeGeneratedPuzzle = useCallback(
    async (opts: {
      puzzleData: PuzzleData;
      img: HTMLImageElement;
      snapId: string;
      config: GeneratorConfig;
      initialFilledRegionIds: Set<number>;
      initialActiveColorId?: number;
      existingSnapshotId?: string;
      shouldAutoReplay: boolean;
      initialPaintedColors?: Record<number, number>;
      targetView: CoopViewport;
      initialCustomPalette?: PaletteColor[];
      initialIsFreeColor?: boolean;
      currentSeq: number;
      transitionSeq: number;
      infiniteZoomOptions?: InfiniteZoomLoadOptions;
    }) => {
      const {
        puzzleData,
        img,
        snapId,
        config,
        initialFilledRegionIds,
        initialActiveColorId,
        existingSnapshotId,
        shouldAutoReplay,
        initialPaintedColors,
        targetView,
        initialCustomPalette,
        initialIsFreeColor,
        currentSeq,
        transitionSeq,
        infiniteZoomOptions,
      } = opts;

      if (initialCustomPalette && initialCustomPalette.length > 0) {
        puzzleData.palette = mergeCustomPalette(puzzleData.palette, initialCustomPalette);
      }

      const initialOrder = Array.from(initialFilledRegionIds);
      const nextFilledSet = new Set(initialOrder);
      const restoredPaintedMap = initialPaintedColors
        ? new Map(Object.entries(initialPaintedColors).map(([k, v]) => [Number(k), v]))
        : new Map<number, number>();
      liveCoopRef.current = {
        ...liveCoopRef.current,
        puzzle: puzzleData,
        filledRegionIds: nextFilledSet,
        paintedRegionColors: restoredPaintedMap,
      };
      setSourceImage(img);
      setPuzzle(puzzleData);
      setFilledRegionIds(nextFilledSet);
      setPaintedRegionColors(restoredPaintedMap);
      syncUndoStack(initialOrder.map((rId) => ({ regionId: rId, wasPreviouslyFilled: false })));
      syncRedoStack([]);

      const isFree = Boolean(
        initialIsFreeColor ||
          config.isFreeColor ||
          puzzleData.isFreeColor ||
          (initialPaintedColors && Object.keys(initialPaintedColors).length > 0)
      );
      handleUpdateSettings((prev) => ({
        ...prev,
        isFreeColorMode: isFree,
        ...((existingSnapshotId || shouldAutoReplay) && prev.replayLoop
          ? { replayLoop: false }
          : {}),
      }));
      resetActivePuzzleSessionStats(
        snapId,
        initialFilledRegionIds.size >= puzzleData.regions.length
      );
      if (!existingSnapshotId && initialFilledRegionIds.size === 0 && isFree) {
        setLifetimeStats(PlayerStatsService.recordFreeColorCreation());
      }

      const availableColors = getVisiblePalette(
        puzzleData.palette,
        puzzleData.regions,
        initialFilledRegionIds,
        settings.paletteSort
      );
      const targetColor =
        initialActiveColorId && availableColors.some((c) => c.id === initialActiveColorId)
          ? initialActiveColorId
          : availableColors[0]?.id || puzzleData.palette[0]?.id || 1;
      setActiveColorId(targetColor);
      setHintRegionId(null);

      const previewUrl = generatePreviewDataUrl(
        puzzleData,
        img,
        initialFilledRegionIds,
        restoredPaintedMap
      );
      const estSaveBytes = StorageService.estimatePuzzleSaveBytes(puzzleData, previewUrl);
      const baseSnapshots = StorageService.updateSnapshotProgress(
        snapId,
        initialFilledRegionIds.size,
        puzzleData.regions.length,
        initialOrder,
        targetView.zoomScale,
        targetView.panOffsetX,
        targetView.panOffsetY,
        previewUrl,
        initialPaintedColors,
        puzzleData.palette,
        isFree,
        estSaveBytes
      );
      const finalizedSnapshots = applyInfiniteZoomTreeLinks(
        baseSnapshots,
        snapId,
        infiniteZoomOptions
      );
      const syncedLoadedSave = finalizedSnapshots.find((s) => s.id === snapId);
      liveCoopRef.current = {
        ...liveCoopRef.current,
        activeSnapshotId: snapId,
        activeColorId: targetColor,
        isFreeColorMode: isFree,
        activeSave: syncedLoadedSave,
        activeTitle: syncedLoadedSave?.title || 'Capy',
      };
      setSnapshots(finalizedSnapshots);

      await StorageService.savePuzzleData(snapId, puzzleData).catch((err) => {
        reportSwallowed('App.savePuzzleData', err, { id: snapId });
      });

      if (
        currentSeq !== generationSeqRef.current ||
        transitionSeq !== snapshotTransitionSeqRef.current
      ) {
        return;
      }

      StorageService.saveActiveState({
        activeSnapshotId: snapId,
        activeColorId: targetColor,
        filledRegionIds: initialOrder,
        paintedRegionColors: initialPaintedColors || {},
        isFreeColorMode: isFree,
        zoomScale: targetView.zoomScale,
        panOffsetX: targetView.panOffsetX,
        panOffsetY: targetView.panOffsetY,
      });

      clearPendingViewportSave();
      snapshotTransitioningRef.current = false;
      setIsLoading(false);

      if (shouldAutoReplay && initialOrder.length > 0) {
        startReplay(initialOrder, true);
      }
    },
    [
      clearPendingViewportSave,
      handleUpdateSettings,
      liveCoopRef,
      resetActivePuzzleSessionStats,
      setActiveColorId,
      setFilledRegionIds,
      setHintRegionId,
      setIsLoading,
      setLifetimeStats,
      setPaintedRegionColors,
      setPuzzle,
      setSnapshots,
      setSourceImage,
      settings.paletteSort,
      snapshotTransitionSeqRef,
      snapshotTransitioningRef,
      startReplay,
      syncRedoStack,
      syncUndoStack,
    ]
  );

  // Core Puzzle Generation & Loading Pipeline
  const loadArtworkFromImage = useCallback(
    async (
      img: HTMLImageElement,
      title: string,
      config: GeneratorConfig = settings.generatorConfig,
      initialFilledRegionIds: Set<number> = new Set(),
      initialActiveColorId?: number,
      existingSnapshotId?: string,
      sampleAssetPath?: string | null,
      shouldAutoReplay: boolean = false,
      sourceBlob?: Blob | null,
      initialPaintedColors?: Record<number, number>,
      initialViewportOverride?: CoopViewport,
      initialCustomPalette?: PaletteColor[],
      initialIsFreeColor?: boolean,
      parentSnapshotId?: string,
      infiniteZoomOptions?: InfiniteZoomLoadOptions
    ) => {
      onBeforeSnapshotResetOrSwitch?.();
      const currentSeq = ++generationSeqRef.current;
      const transitionSeq = ++snapshotTransitionSeqRef.current;
      clearPendingViewportSave();
      snapshotTransitioningRef.current = true;
      liveCoopRef.current = { ...liveCoopRef.current, activeSnapshotId: null, puzzle: null };
      resetReplayState();
      setIsLoading(true);
      setLoadingProgress(0.02);
      setLoadingStatus('Analyzing artwork style and line composition...');
      setLoadingPayload(null);

      setSourceImage(img);
      setPuzzle(null);
      setHintRegionId(null);
      syncRedoStack([]);
      const targetView = initialViewportOverride || {
        zoomScale: 1.0,
        panOffsetX: 0,
        panOffsetY: 0,
      };
      applyViewport(targetView);

      let finishedCalled = false;
      const notifyFinished = () => {
        if (finishedCalled) return;
        finishedCalled = true;
        infiniteZoomOptions?.onFinished?.();
      };

      let canvas: HTMLCanvasElement;
      let snapId: string;
      try {
        canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx =
          canvas.getContext('2d', { willReadFrequently: true }) || canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);

        snapId = existingSnapshotId || crypto.randomUUID();
        const sourceRef = sampleAssetPath
          ? ({ kind: 'sample', uri: sampleAssetPath } as const)
          : ({ kind: 'blob', uri: snapId } as const);

        const newSnapshot: SavedSnapshot = {
          id: snapId,
          title: title || 'Artwork',
          timestamp: Date.now(),
          lastOpened: Date.now(),
          filledCount: initialFilledRegionIds.size,
          totalCount: 100,
          filledRegionIds: Array.from(initialFilledRegionIds),
          ...(initialPaintedColors ? { paintedRegionColors: initialPaintedColors } : {}),
          ...(initialCustomPalette && initialCustomPalette.length > 0
            ? { customPalette: initialCustomPalette }
            : {}),
          ...(initialIsFreeColor !== undefined ? { isFreeColor: initialIsFreeColor } : {}),
          ...(parentSnapshotId ? { parentSnapshotId } : {}),
          ...(infiniteZoomOptions?.zoomTree ? { zoomTree: infiniteZoomOptions.zoomTree } : {}),
          zoomScale: targetView.zoomScale,
          panOffsetX: targetView.panOffsetX,
          panOffsetY: targetView.panOffsetY,
          sampleAssetPath,
          sourceRef,
        };

        setActiveSnapshotId(snapId);
        setSnapshots(StorageService.addSnapshot(newSnapshot));
        infiniteZoomOptions?.onRegistered?.(snapId);

        if (!sampleAssetPath) {
          persistSnapshotSourceBlob({
            snapId,
            sourceBlob,
            img,
            width: canvas.width,
            height: canvas.height,
            preserveLosslessAlpha: Boolean(infiniteZoomOptions?.preserveLosslessAlpha),
            expectedTransitionSeq: snapshotTransitionSeqRef.current,
            snapshotTransitionSeqRef,
          });
        }
      } catch (err) {
        console.error('Failed to prepare puzzle generation:', err);
        if (transitionSeq === snapshotTransitionSeqRef.current) {
          setLoadingStatus('Failed to generate puzzle.');
          abortFailedTransition();
        }
        notifyFinished();
        return;
      }

      setTimeout(async () => {
        try {
          if (
            currentSeq !== generationSeqRef.current ||
            transitionSeq !== snapshotTransitionSeqRef.current
          ) {
            return;
          }
          const isDetailed = Boolean(settings.detailedLoadingProgress);
          const puzzleData = await PuzzleWorkerService.generate(
            canvas,
            config,
            (prog, stat, payload) => {
              if (
                currentSeq === generationSeqRef.current &&
                transitionSeq === snapshotTransitionSeqRef.current
              ) {
                setLoadingProgress((prev) => Math.max(prev, prog));
                setLoadingStatus(stat);
                if (payload) setLoadingPayload(payload);
              }
            },
            isDetailed
          );

          if (
            currentSeq !== generationSeqRef.current ||
            transitionSeq !== snapshotTransitionSeqRef.current
          ) {
            return;
          }

          await finalizeGeneratedPuzzle({
            puzzleData,
            img,
            snapId,
            config,
            initialFilledRegionIds,
            initialActiveColorId,
            existingSnapshotId,
            shouldAutoReplay,
            initialPaintedColors,
            targetView,
            initialCustomPalette,
            initialIsFreeColor,
            currentSeq,
            transitionSeq,
            infiniteZoomOptions,
          });
        } catch (err) {
          if (
            isGenerationCancellationError(err) ||
            currentSeq !== generationSeqRef.current ||
            transitionSeq !== snapshotTransitionSeqRef.current
          ) {
            if (transitionSeq === snapshotTransitionSeqRef.current) {
              clearPendingViewportSave();
              snapshotTransitioningRef.current = false;
              setIsLoading(false);
            }
            return;
          }
          console.error('Failed to generate puzzle:', err);
          if (transitionSeq === snapshotTransitionSeqRef.current) {
            clearPendingViewportSave();
            snapshotTransitioningRef.current = false;
            setLoadingStatus('Failed to generate puzzle.');
            setIsLoading(false);
          }
        } finally {
          if (transitionSeq === snapshotTransitionSeqRef.current && snapshotTransitioningRef.current) {
            clearPendingViewportSave();
            snapshotTransitioningRef.current = false;
          }
          notifyFinished();
        }
      }, 50);
    },
    [
      abortFailedTransition,
      applyViewport,
      clearPendingViewportSave,
      finalizeGeneratedPuzzle,
      liveCoopRef,
      onBeforeSnapshotResetOrSwitch,
      resetReplayState,
      setActiveSnapshotId,
      setHintRegionId,
      setIsLoading,
      setLoadingPayload,
      setLoadingProgress,
      setLoadingStatus,
      setPuzzle,
      setSnapshots,
      setSourceImage,
      settings.detailedLoadingProgress,
      settings.generatorConfig,
      snapshotTransitionSeqRef,
      snapshotTransitioningRef,
      syncRedoStack,
    ]
  );

  // Listen for images shared directly from Android/iOS OS share sheet
  useEffect(() => {
    return NativeBridge.onSharedImage((title, dataUrl) => {
      const img = new Image();
      img.onload = async () => {
        let sharedBlob: Blob | null = null;
        try {
          sharedBlob = await (await fetch(dataUrl)).blob();
        } catch (err) {
          reportSwallowed('App.sharedImageBlobFetch', err);
          sharedBlob = null;
        }
        void loadArtworkFromImage(
          img,
          title,
          settings.generatorConfig,
          new Set(),
          undefined,
          undefined,
          undefined,
          false,
          sharedBlob
        );
      };
      img.src = dataUrl;
    });
  }, [loadArtworkFromImage, settings.generatorConfig]);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onerror = () => {
        console.warn('Failed to read selected image file');
      };
      reader.onload = (event) => {
        const img = new Image();
        img.onerror = () => {
          console.warn('Failed to decode selected image file');
        };
        img.onload = () => {
          const title = file.name.replace(/\.[^/.]+$/, '');
          markTutorialActionTried('create_gallery');
          triggerFeatureOffer('photo_upload');
          void loadArtworkFromImage(
            img,
            title,
            settings.generatorConfig,
            new Set(),
            undefined,
            undefined,
            undefined,
            false,
            file
          );
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    },
    [loadArtworkFromImage, markTutorialActionTried, settings.generatorConfig, triggerFeatureOffer]
  );

  const handlePickImage = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const applyCachedSnapshotToState = useCallback(
    (
      snapshot: SavedSnapshot,
      cachedPuzzle: PuzzleData,
      img: HTMLImageElement,
      forceReplay: boolean
    ) => {
      const orderedIds = snapshot.filledRegionIds || [];
      const filledSet = new Set(orderedIds);
      if (snapshot.customPalette && snapshot.customPalette.length > 0) {
        cachedPuzzle.palette = mergeCustomPalette(cachedPuzzle.palette, snapshot.customPalette);
      }
      const nextPaintedMap = snapshot.paintedRegionColors
        ? new Map(Object.entries(snapshot.paintedRegionColors).map(([k, v]) => [Number(k), v]))
        : new Map<number, number>();
      const paintedObj = snapshot.paintedRegionColors || {};
      setPaintedRegionColors(nextPaintedMap);
      const isFree = Boolean(snapshot.isFreeColor || cachedPuzzle.isFreeColor);
      handleUpdateSettings((prev) => ({
        ...prev,
        isFreeColorMode: isFree,
        ...(prev.replayLoop ? { replayLoop: false } : {}),
      }));
      const availableColors = getVisiblePalette(
        cachedPuzzle.palette,
        cachedPuzzle.regions,
        filledSet,
        settings.paletteSort
      );
      const restoredColor = availableColors[0]?.id || cachedPuzzle.palette[0]?.id || 1;
      const restoredView = {
        zoomScale: snapshot.zoomScale ?? 1.0,
        panOffsetX: snapshot.panOffsetX ?? 0,
        panOffsetY: snapshot.panOffsetY ?? 0,
      };
      applyViewport(restoredView);
      liveCoopRef.current = {
        ...liveCoopRef.current,
        puzzle: cachedPuzzle,
        activeSnapshotId: snapshot.id,
        activeSave: snapshot,
        activeTitle: snapshot.title || 'Capy',
        activeColorId: restoredColor,
        filledRegionIds: filledSet,
        paintedRegionColors: nextPaintedMap,
        isFreeColorMode: isFree,
      };
      setSourceImage(img);
      setPuzzle(cachedPuzzle);
      setActiveColorId(restoredColor);
      setFilledRegionIds(filledSet);
      syncUndoStack(orderedIds.map((rId) => ({ regionId: rId, wasPreviouslyFilled: false })));
      syncRedoStack([]);
      resetActivePuzzleSessionStats(
        snapshot.id,
        cachedPuzzle.regions.length > 0 && filledSet.size >= cachedPuzzle.regions.length
      );
      StorageService.saveActiveState({
        activeSnapshotId: snapshot.id,
        activeColorId: restoredColor,
        filledRegionIds: orderedIds,
        paintedRegionColors: paintedObj,
        isFreeColorMode: isFree,
        ...(snapshot.resetEpoch && snapshot.resetEpoch > 0
          ? { resetEpoch: snapshot.resetEpoch }
          : {}),
        zoomScale: restoredView.zoomScale,
        panOffsetX: restoredView.panOffsetX,
        panOffsetY: restoredView.panOffsetY,
      });
      clearPendingViewportSave();
      snapshotTransitioningRef.current = false;
      setIsLoading(false);

      if ((forceReplay || settings.autoReplayOnLoad !== false) && orderedIds.length > 0) {
        startReplay(orderedIds, true);
      }
    },
    [
      applyViewport,
      clearPendingViewportSave,
      handleUpdateSettings,
      liveCoopRef,
      resetActivePuzzleSessionStats,
      setActiveColorId,
      setFilledRegionIds,
      setIsLoading,
      setPaintedRegionColors,
      setPuzzle,
      setSourceImage,
      settings.autoReplayOnLoad,
      settings.paletteSort,
      snapshotTransitioningRef,
      startReplay,
      syncRedoStack,
      syncUndoStack,
    ]
  );

  // Load a saved snapshot (and optionally auto-replay its region completion sequence)
  const handleLoadSnapshot = useCallback(
    async (snapshot: SavedSnapshot, forceReplay: boolean = false) => {
      handleUpdateSettings((prev) => (prev.replayLoop ? { ...prev, replayLoop: false } : prev));
      if (snapshot.id === activeSnapshotId && puzzle && !snapshotTransitioningRef.current) {
        const currentOrdered =
          filledRegionIds.size > 0
            ? Array.from(filledRegionIds)
            : snapshot.filledRegionIds || [];
        if ((forceReplay || settings.autoReplayOnLoad !== false) && currentOrdered.length > 0) {
          startReplay(currentOrdered, true);
        }
        return;
      }

      clearPendingViewportSave();
      onBeforeSnapshotResetOrSwitch?.();
      if (activeSnapshotId && puzzle && !snapshotTransitioningRef.current) {
        const updated = StorageService.updateSnapshotViewport(
          activeSnapshotId,
          viewportRef.current.zoomScale,
          viewportRef.current.panOffsetX,
          viewportRef.current.panOffsetY
        );
        setSnapshots(updated);
      }

      const loadSeq = ++snapshotTransitionSeqRef.current;
      snapshotTransitioningRef.current = true;
      liveCoopRef.current = { ...liveCoopRef.current, activeSnapshotId: null, puzzle: null };

      resetReplayState();
      setIsLoading(true);
      setLoadingProgress(0.15);
      setLoadingStatus(`Loading ${snapshot.title}...`);
      setLoadingPayload(null);
      setActiveSnapshotId(snapshot.id);
      setPuzzle(null);

      let resolvedObjectUrl: string | null = null;
      let handedOffToImg = false;

      const releaseResolvedObjectUrl = () => {
        if (resolvedObjectUrl) {
          revokeBlobUrlSafely(resolvedObjectUrl);
          resolvedObjectUrl = null;
        }
      };

      const commitLoadedImageBlobUrl = (loadedImgSrc: string) => {
        const plan = resolveBlobUrlCommitPlan(
          resolvedObjectUrl,
          loadedImgSrc,
          activeBlobUrlRef.current
        );
        resolvedObjectUrl = null;
        activeBlobUrlRef.current = plan.nextActiveBlobUrl;
        for (const url of plan.urlsToRevoke) {
          revokeBlobUrlSafely(url);
        }
      };

      const attachImageErrorFallback = (img: HTMLImageElement) => {
        img.onerror = () => {
          if (loadSeq !== snapshotTransitionSeqRef.current) {
            releaseResolvedObjectUrl();
            return;
          }
          if (resolvedObjectUrl && img.src === resolvedObjectUrl) {
            releaseResolvedObjectUrl();
          }
          if (
            isSafeSnapshotPreviewDataUrl(snapshot.previewDataUrl) &&
            img.src !== snapshot.previewDataUrl.trim()
          ) {
            img.src = snapshot.previewDataUrl.trim();
          } else {
            abortFailedTransition();
          }
        };
      };

      try {
        const resolved = await resolveSnapshotImageSrc(snapshot);
        resolvedObjectUrl = resolved.objectUrl;
        if (loadSeq !== snapshotTransitionSeqRef.current) {
          releaseResolvedObjectUrl();
          return;
        }

        const cachedPuzzle = await StorageService.loadPuzzleData(snapshot.id);
        if (loadSeq !== snapshotTransitionSeqRef.current) {
          releaseResolvedObjectUrl();
          return;
        }

        if (cachedPuzzle) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            if (loadSeq !== snapshotTransitionSeqRef.current) {
              releaseResolvedObjectUrl();
              return;
            }
            try {
              commitLoadedImageBlobUrl(img.src);
              applyCachedSnapshotToState(snapshot, cachedPuzzle, img, forceReplay);
            } catch (err) {
              console.error('Failed to apply loaded snapshot:', err);
              if (loadSeq === snapshotTransitionSeqRef.current) {
                abortFailedTransition();
              }
            }
          };
          attachImageErrorFallback(img);
          handedOffToImg = true;
          img.src = resolved.src;
          return;
        }

        const safeSnapshotSamplePath = isAllowedSampleAssetPath(snapshot.sampleAssetPath)
          ? snapshot.sampleAssetPath
          : undefined;
        const storedBlob = safeSnapshotSamplePath
          ? null
          : await StorageService.loadImageBlob(resolveBlobIdForSnapshot(snapshot));
        if (loadSeq !== snapshotTransitionSeqRef.current) {
          releaseResolvedObjectUrl();
          return;
        }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (loadSeq !== snapshotTransitionSeqRef.current) {
            releaseResolvedObjectUrl();
            return;
          }
          commitLoadedImageBlobUrl(img.src);
          void loadArtworkFromImage(
            img,
            snapshot.title,
            settings.generatorConfig,
            new Set(snapshot.filledRegionIds || []),
            undefined,
            snapshot.id,
            safeSnapshotSamplePath,
            forceReplay || settings.autoReplayOnLoad !== false,
            storedBlob,
            snapshot.paintedRegionColors,
            {
              zoomScale: snapshot.zoomScale ?? 1.0,
              panOffsetX: snapshot.panOffsetX ?? 0,
              panOffsetY: snapshot.panOffsetY ?? 0,
            },
            snapshot.customPalette,
            snapshot.isFreeColor,
            snapshot.parentSnapshotId,
            snapshot.zoomTree ? { zoomTree: snapshot.zoomTree } : undefined
          );
        };
        attachImageErrorFallback(img);
        handedOffToImg = true;
        img.src = resolved.src;
      } catch (err) {
        console.error('Failed to load snapshot:', err);
        releaseResolvedObjectUrl();
        if (loadSeq === snapshotTransitionSeqRef.current) {
          setPuzzle(null);
          setActiveSnapshotId(null);
          setIsLoading(false);
          liveCoopRef.current = {
            ...latestRenderCoopRef.current,
            activeSnapshotId: null,
            puzzle: null,
          };
        }
      } finally {
        if (!handedOffToImg && loadSeq === snapshotTransitionSeqRef.current) {
          releaseResolvedObjectUrl();
          clearPendingViewportSave();
          snapshotTransitioningRef.current = false;
        }
      }
    },
    [
      abortFailedTransition,
      activeBlobUrlRef,
      activeSnapshotId,
      applyCachedSnapshotToState,
      clearPendingViewportSave,
      filledRegionIds,
      handleUpdateSettings,
      latestRenderCoopRef,
      liveCoopRef,
      onBeforeSnapshotResetOrSwitch,
      loadArtworkFromImage,
      puzzle,
      resetReplayState,
      resolveSnapshotImageSrc,
      setActiveSnapshotId,
      setIsLoading,
      setLoadingPayload,
      setLoadingProgress,
      setLoadingStatus,
      setPuzzle,
      setSnapshots,
      settings.autoReplayOnLoad,
      settings.generatorConfig,
      snapshotTransitionSeqRef,
      snapshotTransitioningRef,
      startReplay,
      viewportRef,
    ]
  );

  const handleLoadSnapshotRef = useLatest(handleLoadSnapshot);

  const applyPrebakedSampleToState = useCallback(
    (opts: {
      sample: SampleArtwork;
      prebakedSnap: SavedSnapshot;
      cachedPuzzle: PuzzleData;
      img: HTMLImageElement;
      deltaFilledIds?: number[];
      deltaPaintedColors?: Record<number, number>;
      deltaIsFreeColor?: boolean;
      deltaResetEpoch?: number;
    }) => {
      const {
        sample,
        prebakedSnap,
        cachedPuzzle,
        img,
        deltaFilledIds,
        deltaPaintedColors,
        deltaIsFreeColor,
        deltaResetEpoch,
      } = opts;
      const { orderedIds, filledSet, restoredPaintedMap, mergedEpoch, isFree } =
        resolvePrebakedSampleProgress({
          sample,
          prebakedSnap,
          cachedPuzzle,
          deltaFilledIds,
          deltaPaintedColors,
          deltaIsFreeColor,
          deltaResetEpoch,
        });
      if (prebakedSnap.customPalette && prebakedSnap.customPalette.length > 0) {
        cachedPuzzle.palette = prebakedSnap.customPalette;
      }
      const availableColors = getVisiblePalette(
        cachedPuzzle.palette,
        cachedPuzzle.regions,
        filledSet,
        liveCoopRef.current.settings.paletteSort
      );
      const initialColor = availableColors[0]?.id || cachedPuzzle.palette[0]?.id || 1;
      const previewUrl =
        deltaFilledIds !== undefined
          ? generatePreviewDataUrl(cachedPuzzle, img, filledSet, restoredPaintedMap)
          : prebakedSnap.previewDataUrl;
      const updatedList = StorageService.updateSnapshotProgress(
        prebakedSnap.id,
        filledSet.size,
        cachedPuzzle.regions.length,
        orderedIds,
        1.0,
        0,
        0,
        previewUrl,
        Object.fromEntries(restoredPaintedMap),
        cachedPuzzle.palette,
        isFree,
        undefined,
        mergedEpoch > 0 ? mergedEpoch : undefined
      );
      clearPendingViewportSave();
      ++generationSeqRef.current;
      applyViewport({ zoomScale: 1.0, panOffsetX: 0, panOffsetY: 0 });
      resetReplayState();
      setShowSettings(false);
      const syncedSnap = updatedList.find((s) => s.id === prebakedSnap.id);
      liveCoopRef.current = {
        ...liveCoopRef.current,
        puzzle: cachedPuzzle,
        activeSnapshotId: prebakedSnap.id,
        activeSave: syncedSnap,
        activeTitle: syncedSnap?.title || 'Capy',
        activeColorId: initialColor,
        filledRegionIds: filledSet,
        paintedRegionColors: restoredPaintedMap,
        isFreeColorMode: isFree,
      };
      setSnapshots(updatedList);
      setPaintedRegionColors(restoredPaintedMap);
      handleUpdateSettings((prev) => ({ ...prev, isFreeColorMode: isFree }));
      setSourceImage(img);
      setPuzzle(cachedPuzzle);
      setActiveSnapshotId(prebakedSnap.id);
      setActiveColorId(initialColor);
      setFilledRegionIds(filledSet);
      syncUndoStack(orderedIds.map((rId) => ({ regionId: rId, wasPreviouslyFilled: false })));
      syncRedoStack([]);
      setHintRegionId(null);
      resetActivePuzzleSessionStats(
        prebakedSnap.id,
        cachedPuzzle.regions.length > 0 && filledSet.size >= cachedPuzzle.regions.length
      );
      if (isFree && deltaFilledIds === undefined) {
        setLifetimeStats(PlayerStatsService.recordFreeColorCreation());
      }
      StorageService.saveActiveState({
        activeSnapshotId: prebakedSnap.id,
        activeColorId: initialColor,
        filledRegionIds: orderedIds,
        paintedRegionColors: Object.fromEntries(restoredPaintedMap),
        isFreeColorMode: isFree,
        ...(mergedEpoch > 0 ? { resetEpoch: mergedEpoch } : {}),
        zoomScale: 1.0,
        panOffsetX: 0,
        panOffsetY: 0,
      });
      clearPendingViewportSave();
      snapshotTransitioningRef.current = false;
      setIsLoading(false);
    },
    [
      applyViewport,
      clearPendingViewportSave,
      handleUpdateSettings,
      liveCoopRef,
      resetActivePuzzleSessionStats,
      resetReplayState,
      setActiveColorId,
      setActiveSnapshotId,
      setFilledRegionIds,
      setHintRegionId,
      setIsLoading,
      setLifetimeStats,
      setPaintedRegionColors,
      setPuzzle,
      setShowSettings,
      setSnapshots,
      setSourceImage,
      snapshotTransitioningRef,
      syncRedoStack,
      syncUndoStack,
    ]
  );

  const loadSampleFromPrebakedOrGenerate = useCallback(
    async (
      sample: SampleArtwork,
      deltaFilledIds?: number[],
      deltaPaintedColors?: Record<number, number>,
      deltaIsFreeColor?: boolean,
      forceGeneratorConfig?: GeneratorConfig,
      deltaResetEpoch?: number,
      prebakedSnapshotId?: string
    ) => {
      const sampleSeq = ++snapshotTransitionSeqRef.current;
      clearPendingViewportSave();
      onBeforeSnapshotResetOrSwitch?.();
      snapshotTransitioningRef.current = true;
      liveCoopRef.current = { ...liveCoopRef.current, activeSnapshotId: null, puzzle: null };

      const skipBootstrap =
        typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('skipSampleBootstrap') === '1';
      const cleanSamplePath = sample.assetPath.replace(/^\.\//, '');
      const usePrebaked = shouldUsePrebakedSample({
        skipBootstrap,
        prebakedSnapshotId,
        forceGeneratorConfig,
      });

      let handedOffToAsync = false;
      try {
        if (usePrebaked) {
          let snaps = StorageService.loadSnapshots();
          let prebakedSnap = findPrebakedSnapshot(snaps, cleanSamplePath, prebakedSnapshotId);
          if (!prebakedSnap) {
            try {
              const archiveUrl = prebakedSnapshotId
                ? './assets/daily_saves.capy'
                : './assets/sample_saves.capy';
              const bundleResp = await fetch(archiveUrl).catch(() => null);
              if (sampleSeq !== snapshotTransitionSeqRef.current) return;
              if (bundleResp && bundleResp.ok) {
                await StorageService.importSnapshotData(await bundleResp.arrayBuffer(), {
                  refreshTimestamps: true,
                  ...(prebakedSnapshotId ? { filterSnapshotId: prebakedSnapshotId } : {}),
                });
                if (sampleSeq !== snapshotTransitionSeqRef.current) return;
                snaps = StorageService.loadSnapshots();
                prebakedSnap = findPrebakedSnapshot(snaps, cleanSamplePath, prebakedSnapshotId);
              }
            } catch (err) {
              reportSwallowed('App.loadPrebakedSampleArchive', err, {
                sample: cleanSamplePath,
                prebakedSnapshotId,
              });
            }
          }

          if (prebakedSnap) {
            const cachedPuzzle = await StorageService.loadPuzzleData(prebakedSnap.id);
            if (sampleSeq !== snapshotTransitionSeqRef.current) return;
            if (cachedPuzzle) {
              const img = await loadHtmlImage(sample.assetPath);
              if (sampleSeq !== snapshotTransitionSeqRef.current) return;
              if (img) {
                applyPrebakedSampleToState({
                  sample,
                  prebakedSnap,
                  cachedPuzzle,
                  img,
                  deltaFilledIds,
                  deltaPaintedColors,
                  deltaIsFreeColor,
                  deltaResetEpoch,
                });
                handedOffToAsync = true;
                return;
              }
            }
          }
        }

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (sampleSeq !== snapshotTransitionSeqRef.current) return;
          void loadArtworkFromImage(
            img,
            sample.title,
            {
              ...(forceGeneratorConfig || DEFAULT_SETTINGS.generatorConfig),
              isFreeColor: Boolean(
                forceGeneratorConfig?.isFreeColor || deltaIsFreeColor || sample.isFreeColor
              ),
            },
            new Set(deltaFilledIds || []),
            undefined,
            undefined,
            sample.assetPath,
            false,
            null,
            deltaPaintedColors
          );
        };
        img.onerror = () => {
          if (sampleSeq !== snapshotTransitionSeqRef.current) return;
          clearPendingViewportSave();
          snapshotTransitioningRef.current = false;
          liveCoopRef.current = latestRenderCoopRef.current;
          setIsLoading(false);
        };
        handedOffToAsync = true;
        img.src = sample.assetPath;
      } catch (err) {
        console.error('Failed to load sample puzzle:', err);
        if (sampleSeq === snapshotTransitionSeqRef.current) {
          setIsLoading(false);
        }
      } finally {
        if (!handedOffToAsync && sampleSeq === snapshotTransitionSeqRef.current) {
          clearPendingViewportSave();
          snapshotTransitioningRef.current = false;
          liveCoopRef.current = latestRenderCoopRef.current;
          setIsLoading(false);
        }
      }
    },
    [
      applyPrebakedSampleToState,
      clearPendingViewportSave,
      latestRenderCoopRef,
      liveCoopRef,
      loadArtworkFromImage,
      onBeforeSnapshotResetOrSwitch,
      setIsLoading,
      snapshotTransitionSeqRef,
      snapshotTransitioningRef,
    ]
  );

  useIsomorphicLayoutEffect(() => {
    loadSampleForCoopRef.current = loadSampleFromPrebakedOrGenerate;
  }, [loadSampleForCoopRef, loadSampleFromPrebakedOrGenerate]);

  const persistParentSnapshotBeforeDetailTile = useCallback(
    (parentId: string, currentView: CoopViewport) => {
      const existingList = StorageService.loadSnapshots();
      const existingParent = existingList.find((s) => s.id === parentId);
      const paintedObj = Object.fromEntries(paintedRegionColors);
      const orderedIds = Array.from(filledRegionIds);

      const effectiveIsFreeColor = Boolean(isFreeColorMode || puzzle?.isFreeColor);

      if (existingParent && puzzle) {
        setSnapshots(
          StorageService.updateSnapshotProgress(
            parentId,
            filledRegionIds.size,
            puzzle.regions.length,
            orderedIds,
            currentView.zoomScale,
            currentView.panOffsetX,
            currentView.panOffsetY,
            undefined,
            paintedObj,
            puzzle.palette,
            effectiveIsFreeColor
          )
        );
        void StorageService.savePuzzleData(parentId, puzzle).catch((err) => {
          reportSwallowed('App.savePuzzleData', err, { id: parentId });
        });
        return;
      }
      if (existingParent) {
        setSnapshots(
          StorageService.updateSnapshotViewport(
            parentId,
            currentView.zoomScale,
            currentView.panOffsetX,
            currentView.panOffsetY
          )
        );
        return;
      }
      const now = Date.now();
      const parentSnapshot: SavedSnapshot = {
        id: parentId,
        title: activeTitle || 'Artwork',
        timestamp: now,
        lastOpened: now,
        filledCount: filledRegionIds.size,
        totalCount: puzzle?.regions.length || 100,
        filledRegionIds: orderedIds,
        ...(paintedRegionColors.size > 0 ? { paintedRegionColors: paintedObj } : {}),
        ...(puzzle?.palette ? { customPalette: puzzle.palette } : {}),
        ...(effectiveIsFreeColor
          ? { isFreeColor: true }
          : puzzle?.isFreeColor !== undefined
            ? { isFreeColor: puzzle.isFreeColor }
            : {}),
        zoomScale: currentView.zoomScale,
        panOffsetX: currentView.panOffsetX,
        panOffsetY: currentView.panOffsetY,
        sampleAssetPath: activeSave?.sampleAssetPath ?? null,
        sourceRef: activeSave?.sourceRef ?? { kind: 'blob', uri: parentId },
      };
      setSnapshots(StorageService.addSnapshot(parentSnapshot));
      if (puzzle) {
        void StorageService.savePuzzleData(parentId, puzzle).catch((err) => {
          reportSwallowed('App.savePuzzleData', err, { id: parentId });
        });
      }
    },
    [
      activeSave,
      activeTitle,
      filledRegionIds,
      isFreeColorMode,
      paintedRegionColors,
      puzzle,
      setSnapshots,
    ]
  );

  // Multi-resolution Infinite Zoom: extract 2x high-detail center sub-tile
  const handleZoomIntoDetailTile = useCallback(() => {
    if (!sourceImage) return;
    const srcW = sourceImage.naturalWidth || sourceImage.width;
    const srcH = sourceImage.naturalHeight || sourceImage.height;
    if (srcW <= 0 || srcH <= 0) return;

    clearPendingViewportSave();
    const detailSeq = ++snapshotTransitionSeqRef.current;
    snapshotTransitioningRef.current = true;
    const parentId = activeSnapshotId || crypto.randomUUID();
    const currentView = { ...viewportRef.current };
    liveCoopRef.current = { ...liveCoopRef.current, activeSnapshotId: null, puzzle: null };

    const unlockDetailTransition = () => {
      if (detailSeq === snapshotTransitionSeqRef.current) {
        clearPendingViewportSave();
        snapshotTransitioningRef.current = false;
        liveCoopRef.current = latestRenderCoopRef.current;
      }
    };

    try {
      persistParentSnapshotBeforeDetailTile(parentId, currentView);
      const { cropX, cropY, cropW, cropH } = computeDetailTileCrop(srcW, srcH);

      const tileCanvas = document.createElement('canvas');
      tileCanvas.width = srcW;
      tileCanvas.height = srcH;
      const tCtx = tileCanvas.getContext('2d');
      if (!tCtx) {
        unlockDetailTransition();
        return;
      }
      tCtx.imageSmoothingEnabled = true;
      tCtx.imageSmoothingQuality = 'high';
      tCtx.drawImage(sourceImage, cropX, cropY, cropW, cropH, 0, 0, srcW, srcH);

      tileCanvas.toBlob(
        (blob) => {
          if (detailSeq !== snapshotTransitionSeqRef.current) return;
          if (!blob) {
            unlockDetailTransition();
            return;
          }
          const url = URL.createObjectURL(blob);
          const detailImg = new Image();
          detailImg.onload = () => {
            URL.revokeObjectURL(url);
            if (detailSeq !== snapshotTransitionSeqRef.current) return;
            markTutorialActionTried('create_gallery');
            triggerFeatureOffer('infinite_zoom');
            void loadArtworkFromImage(
              detailImg,
              buildDetailTileTitle(activeTitle),
              {
                ...settings.generatorConfig,
                maxRegions: Math.min(
                  900,
                  Math.round((settings.generatorConfig.maxRegions || 350) * 1.25)
                ),
              },
              new Set(),
              undefined,
              undefined,
              null,
              false,
              blob,
              undefined,
              undefined,
              undefined,
              undefined,
              parentId,
              {
                linkParentId: parentId,
                zoomTree: {
                  depth: (activeSave?.zoomTree?.depth ?? 0) + 1,
                  direction: 'child-in',
                  boundsInParent: {
                    x: cropX / srcW,
                    y: cropY / srcH,
                    width: cropW / srcW,
                    height: cropH / srcH,
                  },
                },
              }
            );
          };
          detailImg.onerror = () => {
            URL.revokeObjectURL(url);
            unlockDetailTransition();
          };
          detailImg.src = url;
        },
        'image/webp',
        0.94
      );
    } catch (err) {
      console.error('Failed to extract 2x detail tile:', err);
      unlockDetailTransition();
    }
  }, [
    activeSave?.zoomTree?.depth,
    activeSnapshotId,
    activeTitle,
    clearPendingViewportSave,
    latestRenderCoopRef,
    liveCoopRef,
    loadArtworkFromImage,
    markTutorialActionTried,
    persistParentSnapshotBeforeDetailTile,
    settings.generatorConfig,
    snapshotTransitionSeqRef,
    snapshotTransitioningRef,
    sourceImage,
    triggerFeatureOffer,
    viewportRef,
  ]);

  // Shared starter-sample loader used by delete/clear/storage-clear/restore
  const loadStarterSampleForTransition = useCallback(
    async (
      transitionSeq: number,
      generatorConfig: GeneratorConfig,
      restoreCoopOnMiss: boolean
    ): Promise<boolean> => {
      const defaultSample = SAMPLE_GALLERY[0];
      const img = await loadHtmlImage(defaultSample.assetPath);
      if (transitionSeq !== snapshotTransitionSeqRef.current) return false;
      if (img) {
        void loadArtworkFromImage(
          img,
          defaultSample.title,
          generatorConfig,
          new Set(),
          undefined,
          undefined,
          defaultSample.assetPath
        );
        return true;
      }
      clearPendingViewportSave();
      snapshotTransitioningRef.current = false;
      if (restoreCoopOnMiss) {
        liveCoopRef.current = latestRenderCoopRef.current;
      } else {
        setIsLoading(false);
      }
      return false;
    },
    [
      clearPendingViewportSave,
      latestRenderCoopRef,
      liveCoopRef,
      loadArtworkFromImage,
      setIsLoading,
      snapshotTransitionSeqRef,
      snapshotTransitioningRef,
    ]
  );

  // SettingsModal create.* handlers
  const handleRegenerate = useCallback(
    async (cfg: GeneratorConfig) => {
      if (!sourceImage) return;
      clearPendingViewportSave();
      const regenSeq = ++snapshotTransitionSeqRef.current;
      snapshotTransitioningRef.current = true;
      const prevSnap = activeSave;
      const prevTitle = activeTitle;
      liveCoopRef.current = { ...liveCoopRef.current, activeSnapshotId: null, puzzle: null };
      let handedOff = false;
      try {
        const samplePath =
          prevSnap?.sourceRef?.kind === 'sample' &&
          isAllowedSampleAssetPath(prevSnap.sourceRef.uri)
            ? prevSnap.sourceRef.uri
            : isAllowedSampleAssetPath(prevSnap?.sampleAssetPath)
              ? prevSnap?.sampleAssetPath
              : undefined;
        const existingBlob =
          !samplePath && prevSnap
            ? await StorageService.loadImageBlob(resolveBlobIdForSnapshot(prevSnap))
            : null;
        if (regenSeq !== snapshotTransitionSeqRef.current) return;
        handedOff = true;
        void loadArtworkFromImage(
          sourceImage,
          prevTitle,
          cfg,
          new Set(),
          undefined,
          undefined,
          samplePath,
          false,
          existingBlob
        );
      } catch (err) {
        console.error('Failed to regenerate puzzle:', err);
      } finally {
        if (!handedOff && regenSeq === snapshotTransitionSeqRef.current) {
          clearPendingViewportSave();
          snapshotTransitioningRef.current = false;
          liveCoopRef.current = latestRenderCoopRef.current;
        }
      }
    },
    [
      activeSave,
      activeTitle,
      clearPendingViewportSave,
      latestRenderCoopRef,
      liveCoopRef,
      loadArtworkFromImage,
      snapshotTransitionSeqRef,
      snapshotTransitioningRef,
      sourceImage,
    ]
  );

  const handleSelectSample = useCallback(
    (sample: SampleArtwork, cfg?: GeneratorConfig, prebakedSnapshotId?: string) => {
      markTutorialActionTried('create_gallery');
      void loadSampleFromPrebakedOrGenerate(
        sample,
        undefined,
        undefined,
        sample.isFreeColor,
        cfg || settings.generatorConfig,
        undefined,
        prebakedSnapshotId
      );
    },
    [loadSampleFromPrebakedOrGenerate, markTutorialActionTried, settings.generatorConfig]
  );

  // SettingsModal saves.* handlers
  const handleRenameSnapshot = useCallback(
    (id: string, newTitle: string) => {
      setSnapshots(StorageService.renameSnapshot(id, newTitle));
    },
    [setSnapshots]
  );

  const handleTogglePinSnapshot = useCallback(
    (id: string) => {
      setSnapshots(StorageService.togglePinSnapshot(id));
    },
    [setSnapshots]
  );

  const handleDeleteSnapshot = useCallback(
    async (id: string) => {
      clearPendingViewportSave();
      const currentActiveId = liveCoopRef.current.activeSnapshotId ?? activeSnapshotId;
      const deletingActiveOrLast = id === currentActiveId || snapshots.length <= 1;
      const startSeq = snapshotTransitionSeqRef.current;
      let ownedSeq = deletingActiveOrLast ? ++snapshotTransitionSeqRef.current : 0;
      if (deletingActiveOrLast) {
        onBeforeSnapshotResetOrSwitch?.();
        snapshotTransitioningRef.current = true;
        liveCoopRef.current = {
          ...liveCoopRef.current,
          activeSnapshotId: null,
          puzzle: null,
          filledRegionIds: new Set(),
          paintedRegionColors: new Map(),
        };
      }
      let handedOff = false;
      let clearedActiveLocalState = false;
      try {
        const updated = await StorageService.deleteSnapshot(id);
        if (deletingActiveOrLast && ownedSeq !== snapshotTransitionSeqRef.current) return;
        if (!deletingActiveOrLast && startSeq !== snapshotTransitionSeqRef.current) {
          setSnapshots(updated);
          return;
        }
        setSnapshots(updated);
        if (id === currentActiveId || updated.length === 0) {
          if (updated.length > 0) {
            handedOff = true;
            setActiveSnapshotId(null);
            setPuzzle(null);
            setFilledRegionIds(new Set());
            setPaintedRegionColors(new Map());
            clearedActiveLocalState = true;
            void handleLoadSnapshot(updated[0], false);
          } else {
            StorageService.clearActiveState();
            if (!ownedSeq) {
              ownedSeq = ++snapshotTransitionSeqRef.current;
            }
            snapshotTransitioningRef.current = true;
            liveCoopRef.current = {
              ...liveCoopRef.current,
              activeSnapshotId: null,
              puzzle: null,
              filledRegionIds: new Set(),
              paintedRegionColors: new Map(),
            };
            clearActiveLocalPuzzleState();
            clearedActiveLocalState = true;
            handedOff = await loadStarterSampleForTransition(
              ownedSeq,
              settings.generatorConfig,
              false
            );
          }
        } else if (deletingActiveOrLast && ownedSeq === snapshotTransitionSeqRef.current) {
          snapshotTransitioningRef.current = false;
          liveCoopRef.current = latestRenderCoopRef.current;
        }
      } catch (err) {
        console.error('Failed to delete snapshot:', err);
        if (ownedSeq > 0 && ownedSeq === snapshotTransitionSeqRef.current) {
          setIsLoading(false);
        }
      } finally {
        if (
          !handedOff &&
          ownedSeq > 0 &&
          ownedSeq === snapshotTransitionSeqRef.current &&
          snapshotTransitioningRef.current
        ) {
          clearPendingViewportSave();
          snapshotTransitioningRef.current = false;
          if (!clearedActiveLocalState) {
            liveCoopRef.current = latestRenderCoopRef.current;
          }
        }
      }
    },
    [
      activeSnapshotId,
      clearActiveLocalPuzzleState,
      clearPendingViewportSave,
      handleLoadSnapshot,
      latestRenderCoopRef,
      liveCoopRef,
      loadStarterSampleForTransition,
      onBeforeSnapshotResetOrSwitch,
      setActiveSnapshotId,
      setFilledRegionIds,
      setIsLoading,
      setPaintedRegionColors,
      setPuzzle,
      setSnapshots,
      settings.generatorConfig,
      snapshotTransitionSeqRef,
      snapshotTransitioningRef,
      snapshots.length,
    ]
  );

  const handleClearAllSnapshots = useCallback(async () => {
    clearPendingViewportSave();
    onBeforeSnapshotResetOrSwitch?.();
    const clearSeq = ++snapshotTransitionSeqRef.current;
    snapshotTransitioningRef.current = true;
    liveCoopRef.current = {
      ...liveCoopRef.current,
      activeSnapshotId: null,
      puzzle: null,
      filledRegionIds: new Set(),
      paintedRegionColors: new Map(),
    };
    let handedOff = false;
    let clearedLocalState = false;
    try {
      await StorageService.clearAllSnapshots();
      if (clearSeq !== snapshotTransitionSeqRef.current) return;
      StorageService.clearActiveState();
      setSnapshots([]);
      clearActiveLocalPuzzleState();
      clearedLocalState = true;
      handedOff = await loadStarterSampleForTransition(clearSeq, settings.generatorConfig, false);
    } catch (err) {
      console.error('Failed to clear all snapshots:', err);
      if (clearSeq === snapshotTransitionSeqRef.current) {
        setIsLoading(false);
      }
    } finally {
      if (!handedOff && clearSeq === snapshotTransitionSeqRef.current) {
        clearPendingViewportSave();
        snapshotTransitioningRef.current = false;
        if (!clearedLocalState) {
          liveCoopRef.current = latestRenderCoopRef.current;
        }
      }
    }
  }, [
    clearActiveLocalPuzzleState,
    clearPendingViewportSave,
    latestRenderCoopRef,
    liveCoopRef,
    loadStarterSampleForTransition,
    onBeforeSnapshotResetOrSwitch,
    setIsLoading,
    setSnapshots,
    settings.generatorConfig,
    snapshotTransitionSeqRef,
    snapshotTransitioningRef,
  ]);

  const handleAfterStorageClear = useCallback(
    async ({
      clearedActiveChannel,
      clearedSettings,
    }: {
      clearedActiveChannel: boolean;
      clearedSettings?: boolean;
    }) => {
      if (!clearedActiveChannel) return;
      clearPendingViewportSave();
      onBeforeSnapshotResetOrSwitch?.();
      const clearSeq = ++snapshotTransitionSeqRef.current;
      snapshotTransitioningRef.current = true;
      const effectiveSettings = clearedSettings ? StorageService.loadSettings() : settings;
      if (clearedSettings) {
        setSettings(effectiveSettings);
      }
      liveCoopRef.current = {
        ...liveCoopRef.current,
        activeSnapshotId: null,
        puzzle: null,
        filledRegionIds: new Set(),
        paintedRegionColors: new Map(),
      };
      let handedOff = false;
      let clearedLocalState = false;
      try {
        setSnapshots([]);
        clearActiveLocalPuzzleState();
        clearedLocalState = true;
        handedOff = await loadStarterSampleForTransition(
          clearSeq,
          effectiveSettings.generatorConfig,
          false
        );
      } catch (err) {
        console.error('Failed to reset state after storage clear:', err);
        if (clearSeq === snapshotTransitionSeqRef.current) {
          setIsLoading(false);
        }
      } finally {
        if (!handedOff && clearSeq === snapshotTransitionSeqRef.current) {
          clearPendingViewportSave();
          snapshotTransitioningRef.current = false;
          if (!clearedLocalState) {
            liveCoopRef.current = latestRenderCoopRef.current;
          }
        }
      }
    },
    [
      clearActiveLocalPuzzleState,
      clearPendingViewportSave,
      latestRenderCoopRef,
      liveCoopRef,
      loadStarterSampleForTransition,
      onBeforeSnapshotResetOrSwitch,
      setIsLoading,
      setSettings,
      setSnapshots,
      settings,
      snapshotTransitionSeqRef,
      snapshotTransitioningRef,
    ]
  );

  const handleRestoreStarterSample = useCallback(async () => {
    clearPendingViewportSave();
    onBeforeSnapshotResetOrSwitch?.();
    const restoreSeq = ++snapshotTransitionSeqRef.current;
    snapshotTransitioningRef.current = true;
    liveCoopRef.current = { ...liveCoopRef.current, activeSnapshotId: null, puzzle: null };
    let handedOff = false;
    try {
      handedOff = await loadStarterSampleForTransition(restoreSeq, settings.generatorConfig, true);
    } catch (err) {
      console.error('Failed to restore starter sample:', err);
    } finally {
      if (!handedOff && restoreSeq === snapshotTransitionSeqRef.current) {
        clearPendingViewportSave();
        snapshotTransitioningRef.current = false;
        liveCoopRef.current = latestRenderCoopRef.current;
      }
    }
  }, [
    clearPendingViewportSave,
    latestRenderCoopRef,
    liveCoopRef,
    loadStarterSampleForTransition,
    onBeforeSnapshotResetOrSwitch,
    settings.generatorConfig,
    snapshotTransitionSeqRef,
    snapshotTransitioningRef,
  ]);

  const handleResetProgress = useCallback(() => {
    clearPendingViewportSave();
    onBeforeSnapshotResetOrSwitch?.();
    const previouslyFilled = Array.from(filledRegionIds);
    if (previouslyFilled.length > 0) {
      emitCoopUnfill(previouslyFilled);
    }
    const freshSnap = activeSnapshotId
      ? StorageService.loadSnapshots().find((s) => s.id === activeSnapshotId)
      : undefined;
    const storedActiveState = StorageService.loadActiveState();
    const activeStateEpoch =
      storedActiveState?.activeSnapshotId === activeSnapshotId
        ? storedActiveState.resetEpoch ?? 0
        : 0;
    const nextResetEpoch = computeNextResetEpoch(
      activeSave?.resetEpoch,
      liveCoopRef.current.activeSave?.resetEpoch,
      freshSnap?.resetEpoch,
      activeStateEpoch
    );
    resetReplayState();
    setFilledRegionIds(new Set());
    setPaintedRegionColors(new Map());
    syncUndoStack([]);
    syncRedoStack([]);
    setHintRegionId(null);
    resetActivePuzzleSessionStats(activeSnapshotId, false);
    let updatedActiveSave = liveCoopRef.current.activeSave ?? activeSave ?? freshSnap;
    if (activeSnapshotId && puzzle) {
      const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
      const updated = StorageService.updateSnapshotProgress(
        activeSnapshotId,
        0,
        puzzle.regions.length,
        [],
        zoomScale,
        panOffsetX,
        panOffsetY,
        undefined,
        {},
        puzzle.palette,
        puzzle.isFreeColor,
        undefined,
        nextResetEpoch
      );
      setSnapshots(updated);
      updatedActiveSave =
        updated.find((s) => s.id === activeSnapshotId) ??
        (updatedActiveSave
          ? {
              ...updatedActiveSave,
              filledCount: 0,
              filledRegionIds: [],
              paintedRegionColors: {},
              resetEpoch: nextResetEpoch,
            }
          : undefined);
      StorageService.saveActiveState({
        activeSnapshotId,
        activeColorId: puzzle.palette[0]?.id || 1,
        filledRegionIds: [],
        paintedRegionColors: {},
        isFreeColorMode,
        resetEpoch: nextResetEpoch,
        zoomScale,
        panOffsetX,
        panOffsetY,
      });
    } else if (updatedActiveSave) {
      updatedActiveSave = {
        ...updatedActiveSave,
        filledCount: 0,
        filledRegionIds: [],
        paintedRegionColors: {},
        resetEpoch: nextResetEpoch,
      };
    }
    liveCoopRef.current = {
      ...liveCoopRef.current,
      ...(updatedActiveSave ? { activeSave: updatedActiveSave } : {}),
      filledRegionIds: new Set(),
      paintedRegionColors: new Map(),
    };
    setShowSettings(false);
  }, [
    activeSave,
    activeSnapshotId,
    clearPendingViewportSave,
    emitCoopUnfill,
    filledRegionIds,
    onBeforeSnapshotResetOrSwitch,
    isFreeColorMode,
    liveCoopRef,
    puzzle,
    resetActivePuzzleSessionStats,
    resetReplayState,
    setFilledRegionIds,
    setHintRegionId,
    setPaintedRegionColors,
    setShowSettings,
    setSnapshots,
    syncRedoStack,
    syncUndoStack,
    viewportRef,
  ]);

  // Export & Import wrappers delegating to artworkExporter.ts
  const handleExportArtwork = useCallback(() => {
    if (!puzzle || !sourceImage) return;
    exportColoredArtworkPng({
      puzzle,
      sourceImage,
      filledRegionIds,
      paintedRegionColors,
      title: activeTitle,
      hapticsEnabled: settings.hapticsEnabled,
    });
  }, [
    puzzle,
    sourceImage,
    filledRegionIds,
    paintedRegionColors,
    activeTitle,
    settings.hapticsEnabled,
  ]);

  const handleExportPrintableSvg = useCallback(async (): Promise<boolean> => {
    const ok = await exportActivePrintableSvg(puzzle, activeTitle, settings.hapticsEnabled);
    if (ok) {
      markTutorialActionTried('saves_export');
    }
    return ok;
  }, [puzzle, activeTitle, settings.hapticsEnabled, markTutorialActionTried]);

  const handleExportSnapshotSvg = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      const ok = await exportSnapshotPrintableSvg({
        id,
        title,
        activeSnapshotId,
        activePuzzle: puzzle,
        activeTitle,
        snapshots,
        hapticsEnabled: settings.hapticsEnabled,
      });
      if (ok) {
        markTutorialActionTried('saves_export');
      }
      return ok;
    },
    [
      activeSnapshotId,
      puzzle,
      activeTitle,
      snapshots,
      settings.hapticsEnabled,
      markTutorialActionTried,
    ]
  );

  const handleExportSnapshot = useCallback(
    async (id: string, title: string) => {
      const ok = await exportSingleSnapshotArchive(id, title, settings.hapticsEnabled);
      if (ok) {
        markTutorialActionTried('saves_export');
      }
    },
    [settings.hapticsEnabled, markTutorialActionTried]
  );

  const handleExportAllSnapshots = useCallback(async () => {
    const ok = await exportAllSnapshotsArchive(settings.hapticsEnabled);
    if (ok) {
      markTutorialActionTried('saves_export');
    }
  }, [settings.hapticsEnabled, markTutorialActionTried]);

  const handleImportSnapshots = useCallback(
    async (
      file: File
    ): Promise<{ ok: boolean; importedCount: number; message: string }> => {
      const result = await importSnapshotsArchive(file, settings.hapticsEnabled);
      if (result.ok && result.snapshots) {
        setSnapshots(result.snapshots);
        markTutorialActionTried('saves_export');
      }
      return {
        ok: result.ok,
        importedCount: result.importedCount,
        message: result.message,
      };
    },
    [markTutorialActionTried, setSnapshots, settings.hapticsEnabled]
  );

  return {
    fileInputRef,
    resolveSnapshotImageSrc,
    loadArtworkFromImage,
    handleLoadSnapshot,
    handleLoadSnapshotRef,
    loadSampleFromPrebakedOrGenerate,
    persistParentSnapshotBeforeDetailTile,
    handleZoomIntoDetailTile,
    handleFileUpload,
    handlePickImage,
    handleRegenerate,
    handleSelectSample,
    handleRenameSnapshot,
    handleTogglePinSnapshot,
    handleDeleteSnapshot,
    handleClearAllSnapshots,
    handleAfterStorageClear,
    handleRestoreStarterSample,
    handleResetProgress,
    handleExportArtwork,
    handleExportPrintableSvg,
    handleExportSnapshotSvg,
    handleExportSnapshot,
    handleExportAllSnapshots,
    handleImportSnapshots,
  };
}
