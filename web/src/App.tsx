import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  GenerationProgressPayload,
  GeneratorConfig,
  PaletteColor,
  PalettePreset,
  PuzzleData,
  SAMPLE_GALLERY,
  SampleArtwork,
  SavedSnapshot,
  UserSettings,
} from './types';
import { StorageService } from './services/StorageService';
import { NativeBridge } from './services/NativeBridge';
import { GenerationCancelledError, PuzzleWorkerService } from './services/PuzzleWorkerService';
import { getDisplayNumberMap, getDockPalette, getVisiblePalette } from './components/PaletteDock';
import { PuzzleCanvas } from './components/PuzzleCanvas';
import { GameTopBar } from './components/GameTopBar';
import { PaletteDock } from './components/PaletteDock';
import { FloatingActions } from './components/FloatingActions';
import { SettingsModal } from './components/SettingsModal';
import { LoadingOverlay } from './components/LoadingOverlay';
import { ReplayControls } from './components/ReplayControls';
import { ColorPickerPopover } from './components/ColorPickerPopover';

interface UndoHistoryEntry {
  regionId: number;
  wasPreviouslyFilled: boolean;
  previousPaintedColorId?: number;
  paintedColorId?: number;
}

export const App: React.FC = () => {
  // Persistence & Settings
  const [settings, setSettings] = useState<UserSettings>(() => StorageService.loadSettings());
  const [snapshots, setSnapshots] = useState<SavedSnapshot[]>(() => StorageService.loadSnapshots());
  const [activeSnapshotId, setActiveSnapshotId] = useState<string | null>(null);

  // Active Game State
  const [puzzle, setPuzzle] = useState<PuzzleData | null>(null);
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [activeColorId, setActiveColorId] = useState<number>(1);
  const [filledRegionIds, setFilledRegionIds] = useState<Set<number>>(new Set());
  const [paintedRegionColors, setPaintedRegionColors] = useState<Map<number, number>>(new Map());
  const [undoStack, setUndoStack] = useState<UndoHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoHistoryEntry[]>([]);
  const [hintRegionId, setHintRegionId] = useState<number | null>(null);
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);
  const [zoomInTrigger, setZoomInTrigger] = useState<number>(0);
  const [zoomOutTrigger, setZoomOutTrigger] = useState<number>(0);
  const [resetViewTrigger, setResetViewTrigger] = useState<number>(0);
  const [isCanvasTransformed, setIsCanvasTransformed] = useState<boolean>(false);
  const [initialViewport, setInitialViewport] = useState<{
    zoomScale: number;
    panOffsetX: number;
    panOffsetY: number;
  }>({ zoomScale: 1, panOffsetX: 0, panOffsetY: 0 });
  const viewportRef = useRef<{ zoomScale: number; panOffsetX: number; panOffsetY: number }>({
    zoomScale: 1,
    panOffsetX: 0,
    panOffsetY: 0,
  });
  const preReplayViewportRef = useRef<{
    zoomScale: number;
    panOffsetX: number;
    panOffsetY: number;
  } | null>(null);
  const viewportSaveTimerRef = useRef<number | null>(null);
  const activeBlobUrlRef = useRef<string | null>(null);

  // Replay State
  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [isReplayPlaying, setIsReplayPlaying] = useState<boolean>(false);
  const [replayStep, setReplayStep] = useState<number>(0);
  const [replaySequence, setReplaySequence] = useState<number[]>([]);

  // Spatial Viewport
  const [visibleColorIds, setVisibleColorIds] = useState<Set<number>>(new Set());
  const [visibleRegionIds, setVisibleRegionIds] = useState<Set<number>>(new Set());

  // Loading & Generation Pipeline Details
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadingProgress, setLoadingProgress] = useState<number>(0.02);
  const [loadingStatus, setLoadingStatus] = useState<string>('Loading Capy...');
  const [loadingPayload, setLoadingPayload] = useState<GenerationProgressPayload | null>(null);

  // Modal Sheet
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<number | undefined>(undefined);
  const [showPaletteOptions, setShowPaletteOptions] = useState<boolean>(false);

  // Fullscreen State
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false;
    return Boolean(
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement
    );
  });

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = Boolean(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement
      );
      setIsFullscreen(active);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (viewportSaveTimerRef.current !== null) {
        window.clearTimeout(viewportSaveTimerRef.current);
      }
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
      }
    };
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    try {
      if (
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement
      ) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        }
      } else {
        const el = document.documentElement;
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if ((el as any).webkitRequestFullscreen) {
          await (el as any).webkitRequestFullscreen();
        }
      }
    } catch (err) {
      console.warn('Fullscreen request failed or was blocked:', err);
    }
  }, []);

  // Hidden file input
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync modal state with native LIFO hardware back button stack
  useEffect(() => {
    if (!showSettings) return;
    return NativeBridge.pushBackHandler(() => setShowSettings(false));
  }, [showSettings]);

  // Sync settings updates to storage without stale closure overwrites
  const handleUpdateSettings = useCallback(
    (updater: UserSettings | ((prev: UserSettings) => UserSettings)) => {
      setSettings((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        StorageService.saveSettings(next);
        return next;
      });
    },
    []
  );

  // Resolve full-resolution source image URL for built-in samples or IndexedDB image blobs
  const resolveSnapshotImageSrc = useCallback(async (snap: SavedSnapshot): Promise<string> => {
    if (snap.sourceRef?.kind === 'sample' && snap.sourceRef.uri) {
      return snap.sourceRef.uri;
    }
    if (snap.sampleAssetPath) {
      return snap.sampleAssetPath;
    }

    const blobId = snap.sourceRef?.kind === 'blob' ? snap.sourceRef.uri : snap.id;
    const storedBlob = await StorageService.loadImageBlob(blobId);
    if (storedBlob) {
      const nextUrl = URL.createObjectURL(storedBlob);
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
      }
      activeBlobUrlRef.current = nextUrl;
      return nextUrl;
    }

    return snap.previewDataUrl || 'assets/capybara.webp';
  }, []);

  // Generate thumbnail data URL
  const generatePreviewDataUrl = useCallback(
    (
      puzzleData: PuzzleData,
      sourceImg: HTMLImageElement,
      filledSet: Set<number>,
      customColors?: Map<number, number>
    ): string => {
      const maxDim = 320;
      const scale = Math.min(1, maxDim / Math.max(puzzleData.width, puzzleData.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(puzzleData.width * scale));
      canvas.height = Math.max(1, Math.round(puzzleData.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';

      const paletteMap = new Map<number, PaletteColor>(
        puzzleData.palette.map((c) => [c.id, c])
      );

      if (puzzleData.isFreeColor || (customColors && customColors.size > 0)) {
        // Free colour / coloring page rendering: render filled regions and blend line art
        const fullCanvas = document.createElement('canvas');
        fullCanvas.width = puzzleData.width;
        fullCanvas.height = puzzleData.height;
        const fCtx = fullCanvas.getContext('2d');
        if (fCtx) {
          const imgData = fCtx.createImageData(puzzleData.width, puzzleData.height);
          const data = imgData.data;
          data.fill(255);

          for (const region of puzzleData.regions) {
            if (filledSet.has(region.id)) {
              const colId = customColors?.get(region.id) ?? region.colorId;
              const col = paletteMap.get(colId);
              const r = col?.r ?? 71;
              const g = col?.g ?? 85;
              const b = col?.b ?? 105;
              for (let i = 0; i < region.pixels.length; i++) {
                const idx = region.pixels[i] * 4;
                data[idx] = r;
                data[idx + 1] = g;
                data[idx + 2] = b;
                data[idx + 3] = 255;
              }
            }
          }
          fCtx.putImageData(imgData, 0, 0);
          fCtx.globalCompositeOperation = 'multiply';
          fCtx.drawImage(sourceImg, 0, 0);
          fCtx.globalCompositeOperation = 'source-over';

          ctx.drawImage(fullCanvas, 0, 0, canvas.width, canvas.height);
        }
      } else {
        // Standard photo rendering: clean, sharp aspect-ratio scaled image without white veil
        ctx.drawImage(sourceImg, 0, 0, canvas.width, canvas.height);
      }

      return canvas.toDataURL('image/jpeg', 0.85);
    },
    []
  );

  const autoResumeReplayRef = useRef<boolean>(false);

  // Start animated region-by-region replay
  const startReplay = useCallback((sequence: number[], autoResumeOnFinish: boolean = false) => {
    if (!sequence || sequence.length === 0) return;
    autoResumeReplayRef.current = autoResumeOnFinish;
    if (autoResumeOnFinish) {
      preReplayViewportRef.current = { ...viewportRef.current };
    } else {
      preReplayViewportRef.current = null;
    }
    setResetViewTrigger((prev) => prev + 1);
    setHintRegionId(null);
    setReplaySequence(sequence);
    setReplayStep(0);
    setIsReplaying(true);
    setIsReplayPlaying(true);
  }, []);

  // Animated Replay Loop (60 FPS smooth accumulator scaled by replaySpeed)
  useEffect(() => {
    const finishAutoResume = () => {
      autoResumeReplayRef.current = false;
      setTimeout(() => {
        setIsReplaying(false);
        if (preReplayViewportRef.current) {
          const savedView = preReplayViewportRef.current;
          preReplayViewportRef.current = null;
          viewportRef.current = savedView;
          setInitialViewport({ ...savedView });
        }
      }, 250);
    };

    if (!isReplaying || !isReplayPlaying) return;
    if (replayStep >= replaySequence.length) {
      setIsReplayPlaying(false);
      if (autoResumeReplayRef.current) {
        finishAutoResume();
      }
      return;
    }

    let animId: number;
    let lastTime = performance.now();
    let accRegions = 0;

    // Base speed: complete puzzle replay in ~5.5s at 1x, clamped between 12 and 65 regions/sec
    const baseRate = Math.max(12, Math.min(65, replaySequence.length / 5.5));
    const speedMultiplier = settings.replaySpeed || 1;
    const regionsPerMs = (baseRate * speedMultiplier) / 1000;

    const tick = (now: number) => {
      const dt = Math.min(64, Math.max(0, now - lastTime));
      lastTime = now;
      accRegions += dt * regionsPerMs;

      if (accRegions >= 1) {
        const stepDelta = Math.floor(accRegions);
        accRegions -= stepDelta;
        setReplayStep((prev) => {
          const next = Math.min(replaySequence.length, prev + stepDelta);
          if (next >= replaySequence.length) {
            setIsReplayPlaying(false);
            if (autoResumeReplayRef.current) {
              finishAutoResume();
            }
          }
          return next;
        });
      }

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [isReplaying, isReplayPlaying, replayStep, replaySequence.length, settings.replaySpeed]);

  // Generation sequence tracking to ignore cancelled/superseded requests
  const generationSeqRef = useRef<number>(0);

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
      sourceBlob?: Blob | null
    ) => {
      const currentSeq = ++generationSeqRef.current;
      setIsReplaying(false);
      setIsReplayPlaying(false);
      setIsLoading(true);
      setLoadingProgress(0.02);
      setLoadingStatus('Analyzing artwork style and line composition...');
      setLoadingPayload(null);

      // Immediately display source image on canvas and clear previous puzzle regions
      // so the live generation scan/segmentation visualization renders over the new image
      setSourceImage(img);
      setPuzzle(null);
      setHintRegionId(null);
      setRedoStack([]);
      viewportRef.current = { zoomScale: 1, panOffsetX: 0, panOffsetY: 0 };
      setInitialViewport({ zoomScale: 1, panOffsetX: 0, panOffsetY: 0 });

      // Prepare canvas from image
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      // Pre-register snapshot at 0ms so it appears in Saves instantly!
      const snapId = existingSnapshotId || crypto.randomUUID();
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
        zoomScale: 1.0,
        panOffsetX: 0,
        panOffsetY: 0,
        sampleAssetPath,
        sourceRef,
      };

      setActiveSnapshotId(snapId);
      const updatedSnapshots = StorageService.addSnapshot(newSnapshot);
      setSnapshots(updatedSnapshots);

      // Persist full-resolution custom image blob to IndexedDB so reloads never degrade to thumbnails
      if (!sampleAssetPath) {
        const persistBlobPromise = sourceBlob
          ? Promise.resolve(sourceBlob)
          : new Promise<Blob | null>((resolve) =>
              canvas.toBlob((b) => resolve(b), 'image/webp', 0.92)
            );
        persistBlobPromise
          .then((blob) => {
            if (blob) {
              return StorageService.saveImageBlob(snapId, blob);
            }
          })
          .catch((err) => console.warn('Failed to persist source image blob:', err));
      }

      // Run generator in background Web Worker thread to prevent freezing browser
      setTimeout(async () => {
        if (currentSeq !== generationSeqRef.current) return;
        try {
          const isDetailed = Boolean(settings.detailedLoadingProgress);
          const puzzleData = await PuzzleWorkerService.generate(
            canvas,
            config,
            (prog, stat, payload) => {
              if (currentSeq === generationSeqRef.current) {
                setLoadingProgress((prev) => Math.max(prev, prog));
                setLoadingStatus(stat);
                if (payload) {
                  setLoadingPayload(payload);
                }
              }
            },
            isDetailed
          );

          if (currentSeq !== generationSeqRef.current) return;

          const initialOrder = Array.from(initialFilledRegionIds);
          setSourceImage(img);
          setPuzzle(puzzleData);
          setFilledRegionIds(new Set(initialOrder));
          setPaintedRegionColors(new Map());
          setUndoStack(
            initialOrder.map((rId) => ({
              regionId: rId,
              wasPreviouslyFilled: false,
            }))
          );
          setRedoStack([]);

          const isFree = Boolean(puzzleData.isFreeColor);
          handleUpdateSettings((prev) => ({ ...prev, isFreeColorMode: isFree }));

          // Defensively find the first available color that actually has uncompleted regions
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

          const previewUrl = generatePreviewDataUrl(puzzleData, img, initialFilledRegionIds);
          const estSaveBytes = StorageService.estimatePuzzleSaveBytes(puzzleData, previewUrl);

          // Update snapshot with final region counts and storage size
          const finalizedSnapshots = StorageService.updateSnapshotProgress(
            snapId,
            initialFilledRegionIds.size,
            puzzleData.regions.length,
            initialOrder,
            1.0,
            0,
            0,
            previewUrl,
            undefined,
            puzzleData.palette,
            puzzleData.isFreeColor,
            estSaveBytes
          );
          setSnapshots(finalizedSnapshots);

          // Persist puzzle in IndexedDB
          await StorageService.savePuzzleData(snapId, puzzleData);

          // Persist active game session
          StorageService.saveActiveState({
            activeSnapshotId: snapId,
            activeColorId: targetColor,
            filledRegionIds: initialOrder,
            paintedRegionColors: {},
            isFreeColorMode: Boolean(puzzleData.isFreeColor),
            zoomScale: 1.0,
            panOffsetX: 0,
            panOffsetY: 0,
          });

          setIsLoading(false);

          if (shouldAutoReplay && initialOrder.length > 0) {
            startReplay(initialOrder, true);
          }
        } catch (err) {
          // If cancelled by a newer request or superseded, quietly ignore
          if (
            err instanceof GenerationCancelledError ||
            (err as Error)?.name === 'GenerationCancelledError' ||
            (err as Error)?.message?.includes('cancelled') ||
            currentSeq !== generationSeqRef.current
          ) {
            return;
          }
          console.error('Failed to generate puzzle:', err);
          setLoadingStatus('Failed to generate puzzle.');
          setIsLoading(false);
        }
      }, 50);
    },
    [settings, generatePreviewDataUrl, startReplay, handleUpdateSettings]
  );

  // Restore session on app launch (or bootstrap pre-generated sample saves on first open)
  useEffect(() => {
    let isMounted = true;

    const loadHtmlImage = (src: string, fallbackSrc?: string): Promise<HTMLImageElement | null> =>
      new Promise((resolve) => {
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

    const restoreSession = async () => {
      const activeState = StorageService.loadActiveState();
      const existingSnapshots = StorageService.loadSnapshots();

      const candidateSnap =
        (activeState?.activeSnapshotId
          ? existingSnapshots.find((s) => s.id === activeState.activeSnapshotId)
          : undefined) || existingSnapshots[0];

      if (candidateSnap) {
        const cachedPuzzle = await StorageService.loadPuzzleData(candidateSnap.id);
        if (cachedPuzzle && isMounted) {
          const resolvedSrc = await resolveSnapshotImageSrc(candidateSnap);
          if (!isMounted) return;
          const img = await loadHtmlImage(
            resolvedSrc,
            candidateSnap.previewDataUrl || './assets/capybara.webp'
          );
          if (!isMounted || !img) {
            if (isMounted) setIsLoading(false);
            return;
          }

          const isMatchingActive = activeState?.activeSnapshotId === candidateSnap.id;
          const orderedIds =
            (isMatchingActive ? activeState?.filledRegionIds : undefined) ??
            candidateSnap.filledRegionIds ??
            [];
          const filledSet = new Set(orderedIds);
          if (candidateSnap.customPalette && candidateSnap.customPalette.length > 0) {
            cachedPuzzle.palette = candidateSnap.customPalette;
          }
          const availableColors = getVisiblePalette(
            cachedPuzzle.palette,
            cachedPuzzle.regions,
            filledSet,
            settings.paletteSort
          );
          const restoredColor =
            isMatchingActive &&
            activeState?.activeColorId &&
            availableColors.some((c) => c.id === activeState.activeColorId)
              ? activeState.activeColorId
              : availableColors[0]?.id || cachedPuzzle.palette[0]?.id || 1;

          let restoredPaintedMap = new Map<number, number>();
          if (candidateSnap.paintedRegionColors) {
            restoredPaintedMap = new Map(
              Object.entries(candidateSnap.paintedRegionColors).map(([k, v]) => [Number(k), v])
            );
          } else if (isMatchingActive && activeState?.paintedRegionColors) {
            restoredPaintedMap = new Map(
              Object.entries(activeState.paintedRegionColors).map(([k, v]) => [Number(k), v])
            );
          }

          const isFree = Boolean(
            isMatchingActive && activeState?.isFreeColorMode !== undefined
              ? activeState.isFreeColorMode
              : candidateSnap.isFreeColor || cachedPuzzle.isFreeColor
          );

          const restoredView = {
            zoomScale:
              (isMatchingActive ? activeState?.zoomScale : undefined) ??
              candidateSnap.zoomScale ??
              1.0,
            panOffsetX:
              (isMatchingActive ? activeState?.panOffsetX : undefined) ??
              candidateSnap.panOffsetX ??
              0,
            panOffsetY:
              (isMatchingActive ? activeState?.panOffsetY : undefined) ??
              candidateSnap.panOffsetY ??
              0,
          };
          viewportRef.current = restoredView;
          setInitialViewport(restoredView);

          setPaintedRegionColors(restoredPaintedMap);
          setSettings((prev) => ({ ...prev, isFreeColorMode: isFree }));
          setSourceImage(img);
          setPuzzle(cachedPuzzle);
          setActiveSnapshotId(candidateSnap.id);
          setActiveColorId(restoredColor);
          setFilledRegionIds(filledSet);
          setUndoStack(
            orderedIds.map((rId) => ({
              regionId: rId,
              wasPreviouslyFilled: false,
            }))
          );
          setRedoStack([]);
          setIsLoading(false);
          if (settings.autoReplayOnLoad !== false && orderedIds.length > 0) {
            startReplay(orderedIds, true);
          }
          return;
        }
      }

      const defaultSample = SAMPLE_GALLERY[0];
      const skipBootstrap =
        typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).has('skipSampleBootstrap');

      // First-time open: load pre-generated sample saves export for instant zero-wait gameplay
      if (existingSnapshots.length === 0 && !skipBootstrap) {
        try {
          const [bundleResp, sampleImg] = await Promise.all([
            fetch('./assets/sample_saves.capy').catch(() => null),
            loadHtmlImage(defaultSample.assetPath),
          ]);

          if (bundleResp && bundleResp.ok && sampleImg && isMounted) {
            const bundleBuffer = await bundleResp.arrayBuffer();
            const imported = await StorageService.importSnapshotData(bundleBuffer, {
              refreshTimestamps: true,
            });

            if (
              imported.importedCount > 0 &&
              imported.firstSnapshot &&
              imported.firstPuzzle &&
              isMounted
            ) {
              const firstSnap = imported.firstSnapshot;
              const firstPuzzle = imported.firstPuzzle;
              const firstImg =
                firstSnap.sampleAssetPath && firstSnap.sampleAssetPath !== defaultSample.assetPath
                  ? (await loadHtmlImage(firstSnap.sampleAssetPath, defaultSample.assetPath)) || sampleImg
                  : sampleImg;

              if (!isMounted) return;

              const refreshedList = StorageService.loadSnapshots();
              const orderedIds = firstSnap.filledRegionIds || [];
              const filledSet = new Set(orderedIds);
              if (firstSnap.customPalette && firstSnap.customPalette.length > 0) {
                firstPuzzle.palette = firstSnap.customPalette;
              }
              const availableColors = getVisiblePalette(
                firstPuzzle.palette,
                firstPuzzle.regions,
                filledSet,
                settings.paletteSort
              );
              const initialColor = availableColors[0]?.id || firstPuzzle.palette[0]?.id || 1;
              const isFree = Boolean(firstSnap.isFreeColor || firstPuzzle.isFreeColor);

              setSnapshots(refreshedList);
              setPaintedRegionColors(new Map());
              setSettings((prev) => ({ ...prev, isFreeColorMode: isFree }));
              setSourceImage(firstImg);
              setPuzzle(firstPuzzle);
              setActiveSnapshotId(firstSnap.id);
              setActiveColorId(initialColor);
              setFilledRegionIds(filledSet);
              setUndoStack([]);
              setRedoStack([]);
              setHintRegionId(null);

              StorageService.saveActiveState({
                activeSnapshotId: firstSnap.id,
                activeColorId: initialColor,
                filledRegionIds: orderedIds,
                paintedRegionColors: {},
                isFreeColorMode: isFree,
                zoomScale: 1.0,
                panOffsetX: 0,
                panOffsetY: 0,
              });

              setIsLoading(false);
              return;
            }
          }
        } catch (err) {
          console.warn('Sample save bundle bootstrap unavailable, falling back to live generator:', err);
        }
      }

      // Fallback: dynamically generate Capybara built-in sample
      const img = await loadHtmlImage(defaultSample.assetPath);
      if (!isMounted) return;
      if (!img) {
        setIsLoading(false);
        return;
      }
      loadArtworkFromImage(
        img,
        defaultSample.title,
        settings.generatorConfig,
        new Set(),
        undefined,
        undefined,
        defaultSample.assetPath
      );
    };

    restoreSession();
    return () => {
      isMounted = false;
    };
  }, []);

  // Listen for images shared directly from Android/iOS OS share sheet
  useEffect(() => {
    return NativeBridge.onSharedImage((title, dataUrl) => {
      const img = new Image();
      img.onload = async () => {
        let sharedBlob: Blob | null = null;
        try {
          sharedBlob = await (await fetch(dataUrl)).blob();
        } catch {
          sharedBlob = null;
        }
        loadArtworkFromImage(
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

  // Display number mapping
  const displayNumberMap = useMemo(() => {
    if (!puzzle) return new Map<number, string>();
    return getDisplayNumberMap(puzzle.palette, puzzle.regions, settings.paletteSort);
  }, [puzzle, settings.paletteSort]);

  // Free colour mode indicator
  const isFreeColorMode = Boolean(settings.isFreeColorMode);

  // Undo & Redo capability: disabled by default for standard puzzles, enabled automatically for free colour puzzles or when explicitly enabled in settings
  const isUndoEnabled = Boolean(settings.enableUndo || isFreeColorMode || puzzle?.isFreeColor);

  const handleToggleFreeColorMode = useCallback(() => {
    handleUpdateSettings((prev) => ({ ...prev, isFreeColorMode: !prev.isFreeColorMode }));
    NativeBridge.haptic('tick', settings.hapticsEnabled);
  }, [handleUpdateSettings, settings.hapticsEnabled]);

  // Undo last region completion
  const handleUndo = useCallback(() => {
    if (!puzzle || isReplaying || undoStack.length === 0 || !isUndoEnabled) return;

    const lastAction = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, lastAction]);

    const nextFilled = new Set(filledRegionIds);
    const nextPainted = new Map(paintedRegionColors);

    if (lastAction.wasPreviouslyFilled) {
      if (lastAction.previousPaintedColorId !== undefined) {
        nextPainted.set(lastAction.regionId, lastAction.previousPaintedColorId);
      } else {
        nextPainted.delete(lastAction.regionId);
      }
    } else {
      nextFilled.delete(lastAction.regionId);
      nextPainted.delete(lastAction.regionId);
    }

    setFilledRegionIds(nextFilled);
    setPaintedRegionColors(nextPainted);
    setHintRegionId(null);
    NativeBridge.haptic('tick', settings.hapticsEnabled);

    const undoneRegion = puzzle.regions.find((r) => r.id === lastAction.regionId);
    if (undoneRegion && !isFreeColorMode) {
      setActiveColorId(undoneRegion.colorId);
    }

    if (activeSnapshotId) {
      const paintedObj = Object.fromEntries(nextPainted);
      const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
      const updated = StorageService.updateSnapshotProgress(
        activeSnapshotId,
        nextFilled.size,
        puzzle.regions.length,
        Array.from(nextFilled),
        zoomScale,
        panOffsetX,
        panOffsetY,
        undefined,
        paintedObj,
        puzzle.palette,
        puzzle.isFreeColor
      );
      setSnapshots(updated);
      StorageService.saveActiveState({
        activeSnapshotId,
        activeColorId: undoneRegion && !isFreeColorMode ? undoneRegion.colorId : activeColorId,
        filledRegionIds: Array.from(nextFilled),
        paintedRegionColors: paintedObj,
        isFreeColorMode,
        zoomScale,
        panOffsetX,
        panOffsetY,
      });
    }
  }, [
    puzzle,
    isReplaying,
    undoStack,
    filledRegionIds,
    paintedRegionColors,
    settings.hapticsEnabled,
    isFreeColorMode,
    isUndoEnabled,
    activeSnapshotId,
    activeColorId,
  ]);

  // Redo last undone region action
  const handleRedo = useCallback(() => {
    if (!puzzle || isReplaying || redoStack.length === 0 || !isUndoEnabled) return;

    const lastRedo = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, lastRedo]);

    const nextFilled = new Set(filledRegionIds);
    const nextPainted = new Map(paintedRegionColors);

    nextFilled.add(lastRedo.regionId);
    if (lastRedo.paintedColorId !== undefined) {
      nextPainted.set(lastRedo.regionId, lastRedo.paintedColorId);
    } else {
      const region = puzzle.regions.find((r) => r.id === lastRedo.regionId);
      if (region && isFreeColorMode) {
        nextPainted.set(lastRedo.regionId, activeColorId);
      }
    }

    setFilledRegionIds(nextFilled);
    setPaintedRegionColors(nextPainted);
    setHintRegionId(null);
    NativeBridge.haptic('tick', settings.hapticsEnabled);

    const redoneRegion = puzzle.regions.find((r) => r.id === lastRedo.regionId);
    if (redoneRegion && !isFreeColorMode) {
      setActiveColorId(redoneRegion.colorId);
    }

    if (activeSnapshotId) {
      const paintedObj = Object.fromEntries(nextPainted);
      const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
      const updated = StorageService.updateSnapshotProgress(
        activeSnapshotId,
        nextFilled.size,
        puzzle.regions.length,
        Array.from(nextFilled),
        zoomScale,
        panOffsetX,
        panOffsetY,
        undefined,
        paintedObj,
        puzzle.palette,
        puzzle.isFreeColor
      );
      setSnapshots(updated);
      StorageService.saveActiveState({
        activeSnapshotId,
        activeColorId: redoneRegion && !isFreeColorMode ? redoneRegion.colorId : activeColorId,
        filledRegionIds: Array.from(nextFilled),
        paintedRegionColors: paintedObj,
        isFreeColorMode,
        zoomScale,
        panOffsetX,
        panOffsetY,
      });
    }
  }, [
    puzzle,
    isReplaying,
    redoStack,
    filledRegionIds,
    paintedRegionColors,
    settings.hapticsEnabled,
    isFreeColorMode,
    isUndoEnabled,
    activeSnapshotId,
    activeColorId,
  ]);

  // Open replay timeline scrubber from long-press Undo or floating controls
  const handleOpenTimelineReplay = useCallback(() => {
    if (!puzzle || (filledRegionIds.size === 0 && undoStack.length === 0)) return;

    // Build unique ordered list of filled regions matching gameplay chronology
    const orderedList =
      undoStack.length > 0
        ? Array.from(
            new Set(
              undoStack
                .map((u) => u.regionId)
                .filter((id) => filledRegionIds.has(id))
            )
          )
        : Array.from(filledRegionIds);

    if (orderedList.length === 0) return;

    NativeBridge.haptic('tick', settings.hapticsEnabled);
    setResetViewTrigger((prev) => prev + 1);
    setHintRegionId(null);
    setReplaySequence(orderedList);
    setReplayStep(orderedList.length);
    setIsReplaying(true);
    setIsReplayPlaying(false);
  }, [puzzle, filledRegionIds, undoStack, settings.hapticsEnabled]);

  // Resume active gameplay from scrubbed replay step
  const handleResumeFromReplayStep = useCallback(
    (step: number) => {
      if (!puzzle) return;
      const clampedStep = Math.max(0, Math.min(step, replaySequence.length));
      const keptRegionIds = replaySequence.slice(0, clampedStep);
      const undoneRegionIds = replaySequence.slice(clampedStep);

      const nextFilled = new Set(keptRegionIds);
      const nextPainted = new Map(paintedRegionColors);

      for (const rId of undoneRegionIds) {
        nextPainted.delete(rId);
      }

      const newUndoStack: UndoHistoryEntry[] = keptRegionIds.map((rId) => {
        const existing = undoStack.find((u) => u.regionId === rId);
        return existing || { regionId: rId, wasPreviouslyFilled: false };
      });

      const newRedoStack: UndoHistoryEntry[] = undoneRegionIds
        .map((rId) => {
          const existing = undoStack.find((u) => u.regionId === rId);
          return existing || { regionId: rId, wasPreviouslyFilled: false };
        })
        .reverse();

      setFilledRegionIds(nextFilled);
      setPaintedRegionColors(nextPainted);
      setUndoStack(newUndoStack);
      setRedoStack(newRedoStack);
      setIsReplaying(false);
      setIsReplayPlaying(false);
      setHintRegionId(null);
      NativeBridge.haptic('success', settings.hapticsEnabled);

      let resolvedActiveColorId = activeColorId;
      if (!isFreeColorMode && undoneRegionIds.length > 0) {
        const nextRegion = puzzle.regions.find((r) => r.id === undoneRegionIds[0]);
        if (nextRegion) {
          resolvedActiveColorId = nextRegion.colorId;
          setActiveColorId(nextRegion.colorId);
        }
      }

      if (activeSnapshotId) {
        const paintedObj = Object.fromEntries(nextPainted);
        const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
        const updated = StorageService.updateSnapshotProgress(
          activeSnapshotId,
          nextFilled.size,
          puzzle.regions.length,
          keptRegionIds,
          zoomScale,
          panOffsetX,
          panOffsetY,
          undefined,
          paintedObj,
          puzzle.palette,
          puzzle.isFreeColor
        );
        setSnapshots(updated);
        StorageService.saveActiveState({
          activeSnapshotId,
          activeColorId: resolvedActiveColorId,
          filledRegionIds: keptRegionIds,
          paintedRegionColors: paintedObj,
          isFreeColorMode,
          zoomScale,
          panOffsetX,
          panOffsetY,
        });
      }
    },
    [
      puzzle,
      replaySequence,
      paintedRegionColors,
      undoStack,
      settings.hapticsEnabled,
      isFreeColorMode,
      activeSnapshotId,
      activeColorId,
    ]
  );

  // Keyboard shortcut Ctrl+Z / Cmd+Z for Undo, Ctrl+Y / Cmd+Y / Ctrl+Shift+Z for Redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showSettings || isReplaying || isLoading || !isUndoEnabled) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      } else if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSettings, isReplaying, isLoading, handleUndo, handleRedo, isUndoEnabled]);

  // Handle single region coloring
  const attemptFillRegion = useCallback(
    (regionId: number) => {
      if (!puzzle || isReplaying) return;
      const region = puzzle.regions.find((r) => r.id === regionId);
      if (!region) return;

      if (isFreeColorMode) {
        const currentPaintedColor = paintedRegionColors.get(regionId);
        if (currentPaintedColor === activeColorId) return;

        const wasFilled = filledRegionIds.has(regionId);
        setUndoStack((prev) => [
          ...prev,
          {
            regionId,
            wasPreviouslyFilled: wasFilled,
            previousPaintedColorId: currentPaintedColor,
            paintedColorId: activeColorId,
          },
        ]);
        setRedoStack([]);

        const nextPainted = new Map(paintedRegionColors);
        nextPainted.set(regionId, activeColorId);
        setPaintedRegionColors(nextPainted);

        const nextFilled = new Set(filledRegionIds);
        if (wasFilled) {
          nextFilled.delete(regionId);
        }
        nextFilled.add(regionId);
        setFilledRegionIds(nextFilled);
        setHintRegionId(null);

        const orderedList = Array.from(nextFilled);
        const isComplete = nextFilled.size >= puzzle.regions.length;
        if (isComplete) {
          NativeBridge.haptic('success', settings.hapticsEnabled);
          confetti({
            particleCount: 120,
            spread: 80,
            origin: { y: 0.6 },
          });
          startReplay(orderedList);
        } else {
          NativeBridge.haptic('tick', settings.hapticsEnabled);
        }

        if (activeSnapshotId) {
          const paintedObj = Object.fromEntries(nextPainted);
          const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
          const updated = StorageService.updateSnapshotProgress(
            activeSnapshotId,
            nextFilled.size,
            puzzle.regions.length,
            orderedList,
            zoomScale,
            panOffsetX,
            panOffsetY,
            undefined,
            paintedObj,
            puzzle.palette,
            puzzle.isFreeColor
          );
          setSnapshots(updated);
          StorageService.saveActiveState({
            activeSnapshotId,
            activeColorId,
            filledRegionIds: orderedList,
            paintedRegionColors: paintedObj,
            isFreeColorMode: true,
            zoomScale,
            panOffsetX,
            panOffsetY,
          });
        }
        return;
      }

      if (filledRegionIds.has(regionId)) return;

      const isEasy = settings.difficulty === 'EASY';
      const canFill = isEasy || region.colorId === activeColorId;

      if (!canFill) return;

      if (isEasy && activeColorId !== region.colorId) {
        setActiveColorId(region.colorId);
      }

      setUndoStack((prev) => [
        ...prev,
        {
          regionId,
          wasPreviouslyFilled: false,
          paintedColorId: region.colorId,
        },
      ]);
      setRedoStack([]);

      const nextFilled = new Set(filledRegionIds);
      nextFilled.add(regionId);
      setFilledRegionIds(nextFilled);
      setHintRegionId(null);

      const orderedList = Array.from(nextFilled);

      // Check completion
      const isComplete = nextFilled.size >= puzzle.regions.length;
      const remainingForColor = puzzle.regions.filter(
        (r) => r.colorId === region.colorId && !nextFilled.has(r.id)
      );

      if (isComplete || remainingForColor.length === 0) {
        NativeBridge.haptic('success', settings.hapticsEnabled);
      } else {
        NativeBridge.haptic('tick', settings.hapticsEnabled);
      }

      if (isComplete) {
        confetti({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.6 },
        });
        startReplay(orderedList);
      }

      // Auto-advance check
      let nextActiveColId = isEasy ? region.colorId : activeColorId;
      if (settings.autoAdvance && !isComplete) {
        const remainingForCurrent = puzzle.regions.filter(
          (r) => r.colorId === nextActiveColId && !nextFilled.has(r.id)
        );
        if (remainingForCurrent.length === 0) {
          const basePalette = getVisiblePalette(
            puzzle.palette,
            puzzle.regions,
            nextFilled,
            settings.paletteSort
          );
          const dockPalette = getDockPalette(
            basePalette,
            settings.prioritizeOnScreen,
            visibleColorIds
          );
          const nextCol = dockPalette[0] || basePalette[0];
          if (nextCol) {
            nextActiveColId = nextCol.id;
            setActiveColorId(nextCol.id);
          }
        }
      }

      // Persistence
      if (activeSnapshotId) {
        const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
        const updated = StorageService.updateSnapshotProgress(
          activeSnapshotId,
          nextFilled.size,
          puzzle.regions.length,
          orderedList,
          zoomScale,
          panOffsetX,
          panOffsetY
        );
        setSnapshots(updated);
        StorageService.saveActiveState({
          activeSnapshotId,
          activeColorId: nextActiveColId,
          filledRegionIds: orderedList,
          zoomScale,
          panOffsetX,
          panOffsetY,
        });
      }
    },
    [
      puzzle,
      isReplaying,
      filledRegionIds,
      paintedRegionColors,
      isFreeColorMode,
      settings,
      activeColorId,
      activeSnapshotId,
      visibleColorIds,
      startReplay,
    ]
  );

  // Handle batch fill (for Paint Mode drag-to-color)
  const attemptBatchFillRegions = useCallback(
    (regionIds: Set<number>) => {
      if (!puzzle || isReplaying || regionIds.size === 0) return;

      if (isFreeColorMode) {
        let changed = false;
        const nextPainted = new Map(paintedRegionColors);
        const nextFilled = new Set(filledRegionIds);
        const newUndoEntries: UndoHistoryEntry[] = [];

        for (const rId of regionIds) {
          const region = puzzle.regions.find((r) => r.id === rId);
          if (!region) continue;
          const prevCol = nextPainted.get(rId);
          if (prevCol !== activeColorId) {
            const wasFilled = nextFilled.has(rId);
            newUndoEntries.push({
              regionId: rId,
              wasPreviouslyFilled: wasFilled,
              previousPaintedColorId: prevCol,
              paintedColorId: activeColorId,
            });
            nextPainted.set(rId, activeColorId);
            if (wasFilled) {
              nextFilled.delete(rId);
            }
            nextFilled.add(rId);
            changed = true;
          }
        }

        if (changed) {
          setUndoStack((prev) => [...prev, ...newUndoEntries]);
          setRedoStack([]);
          setPaintedRegionColors(nextPainted);
          setFilledRegionIds(nextFilled);
          setHintRegionId(null);

          const orderedList = Array.from(nextFilled);
          const isComplete = nextFilled.size >= puzzle.regions.length;
          if (isComplete) {
            NativeBridge.haptic('success', settings.hapticsEnabled);
            confetti({
              particleCount: 120,
              spread: 80,
              origin: { y: 0.6 },
            });
            startReplay(orderedList);
          } else {
            NativeBridge.haptic('tick', settings.hapticsEnabled);
          }

          if (activeSnapshotId) {
            const paintedObj = Object.fromEntries(nextPainted);
            const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
            const updated = StorageService.updateSnapshotProgress(
              activeSnapshotId,
              nextFilled.size,
              puzzle.regions.length,
              orderedList,
              zoomScale,
              panOffsetX,
              panOffsetY,
              undefined,
              paintedObj,
              puzzle.palette,
              puzzle.isFreeColor
            );
            setSnapshots(updated);
            StorageService.saveActiveState({
              activeSnapshotId,
              activeColorId,
              filledRegionIds: orderedList,
              paintedRegionColors: paintedObj,
              isFreeColorMode: true,
              zoomScale,
              panOffsetX,
              panOffsetY,
            });
          }
        }
        return;
      }

      const isEasy = settings.difficulty === 'EASY';
      const isPaintMode = settings.isPaintMode;
      let filledAny = false;
      const nextFilled = new Set(filledRegionIds);
      const newUndoEntries: UndoHistoryEntry[] = [];

      for (const rId of regionIds) {
        if (nextFilled.has(rId)) continue;
        const region = puzzle.regions.find((r) => r.id === rId);
        if (!region) continue;

        const canFill = isEasy || region.colorId === activeColorId;
        if (canFill) {
          if (isEasy && !isPaintMode && activeColorId !== region.colorId) {
            setActiveColorId(region.colorId);
          }
          nextFilled.add(rId);
          newUndoEntries.push({
            regionId: rId,
            wasPreviouslyFilled: false,
            paintedColorId: region.colorId,
          });
          filledAny = true;
        }
      }

      if (filledAny) {
        setUndoStack((prev) => [...prev, ...newUndoEntries]);
        setRedoStack([]);
        setFilledRegionIds(nextFilled);
        setHintRegionId(null);

        const orderedList = Array.from(nextFilled);
        const isComplete = nextFilled.size >= puzzle.regions.length;
        if (isComplete) {
          NativeBridge.haptic('success', settings.hapticsEnabled);
          confetti({
            particleCount: 120,
            spread: 80,
            origin: { y: 0.6 },
          });
          startReplay(orderedList);
        } else {
          NativeBridge.haptic('tick', settings.hapticsEnabled);
        }

        let nextActiveColId = activeColorId;
        if (settings.autoAdvance && !isComplete) {
          const remainingForCurrent = puzzle.regions.filter(
            (r) => r.colorId === activeColorId && !nextFilled.has(r.id)
          );
          if (remainingForCurrent.length === 0) {
            const basePalette = getVisiblePalette(
              puzzle.palette,
              puzzle.regions,
              nextFilled,
              settings.paletteSort
            );
            const dockPalette = getDockPalette(
              basePalette,
              settings.prioritizeOnScreen,
              visibleColorIds
            );
            const nextCol = dockPalette[0] || basePalette[0];
            if (nextCol) {
              nextActiveColId = nextCol.id;
              setActiveColorId(nextCol.id);
            }
          }
        }

        if (activeSnapshotId) {
          const { zoomScale, panOffsetX, panOffsetY } = viewportRef.current;
          const updated = StorageService.updateSnapshotProgress(
            activeSnapshotId,
            nextFilled.size,
            puzzle.regions.length,
            orderedList,
            zoomScale,
            panOffsetX,
            panOffsetY
          );
          setSnapshots(updated);
          StorageService.saveActiveState({
            activeSnapshotId,
            activeColorId: nextActiveColId,
            filledRegionIds: orderedList,
            zoomScale,
            panOffsetX,
            panOffsetY,
          });
        }
      }
    },
    [
      puzzle,
      isReplaying,
      isFreeColorMode,
      paintedRegionColors,
      settings,
      activeColorId,
      filledRegionIds,
      activeSnapshotId,
      visibleColorIds,
      startReplay,
    ]
  );

  // Custom Palette & Color Handlers for Free Colour Mode
  const handleAddCustomColor = useCallback(
    (hex: string) => {
      if (!puzzle) return;
      const clean = hex.replace('#', '');
      const num = parseInt(clean, 16);
      const rgb: [number, number, number] = [
        (num >> 16) & 255,
        (num >> 8) & 255,
        num & 255,
      ];
      const nextId = Math.max(...puzzle.palette.map((c) => c.id), 0) + 1;
      const isLight = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) > 160;
      const argb = ((0xff << 24) | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]) >>> 0;
      const newColor: PaletteColor = {
        id: nextId,
        hex: hex.startsWith('#') ? hex : `#${hex}`,
        isLight,
        argb,
        r: rgb[0],
        g: rgb[1],
        b: rgb[2],
      };
      const updatedPalette = [...puzzle.palette, newColor];
      const updatedPuzzle = { ...puzzle, palette: updatedPalette };
      setPuzzle(updatedPuzzle);
      setActiveColorId(nextId);
      NativeBridge.haptic('tick', settings.hapticsEnabled);

      if (activeSnapshotId) {
        StorageService.savePuzzleData(activeSnapshotId, updatedPuzzle);
        StorageService.updateSnapshotProgress(
          activeSnapshotId,
          filledRegionIds.size,
          puzzle.regions.length,
          Array.from(filledRegionIds),
          undefined,
          undefined,
          undefined,
          undefined,
          Object.fromEntries(paintedRegionColors),
          updatedPalette,
          puzzle.isFreeColor
        );
      }
    },
    [puzzle, settings.hapticsEnabled, activeSnapshotId, filledRegionIds, paintedRegionColors]
  );

  const handleUpdateColor = useCallback(
    (colorId: number, hex: string) => {
      if (!puzzle) return;
      const clean = hex.replace('#', '');
      const num = parseInt(clean, 16);
      const rgb: [number, number, number] = [
        (num >> 16) & 255,
        (num >> 8) & 255,
        num & 255,
      ];
      const isLight = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) > 160;
      const argb = ((0xff << 24) | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]) >>> 0;
      const updatedPalette = puzzle.palette.map((c) =>
        c.id === colorId
          ? {
              ...c,
              hex: hex.startsWith('#') ? hex : `#${hex}`,
              isLight,
              argb,
              r: rgb[0],
              g: rgb[1],
              b: rgb[2],
            }
          : c
      );
      const updatedPuzzle = { ...puzzle, palette: updatedPalette };
      setPuzzle(updatedPuzzle);
      NativeBridge.haptic('tick', settings.hapticsEnabled);

      if (activeSnapshotId) {
        StorageService.savePuzzleData(activeSnapshotId, updatedPuzzle);
        StorageService.updateSnapshotProgress(
          activeSnapshotId,
          filledRegionIds.size,
          puzzle.regions.length,
          Array.from(filledRegionIds),
          undefined,
          undefined,
          undefined,
          undefined,
          Object.fromEntries(paintedRegionColors),
          updatedPalette,
          puzzle.isFreeColor
        );
      }
    },
    [puzzle, settings.hapticsEnabled, activeSnapshotId, filledRegionIds, paintedRegionColors]
  );

  const handleApplyPresetPalette = useCallback(
    (preset: PalettePreset) => {
      if (!puzzle) return;
      const updatedPalette = puzzle.palette.map((c, i) => {
        const hex = preset.colors[i % preset.colors.length];
        const clean = hex.replace('#', '');
        const num = parseInt(clean, 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        const isLight = (0.299 * r + 0.587 * g + 0.114 * b) > 160;
        const argb = ((0xff << 24) | (r << 16) | (g << 8) | b) >>> 0;
        return {
          ...c,
          hex,
          isLight,
          argb,
          r,
          g,
          b,
        };
      });
      const updatedPuzzle = { ...puzzle, palette: updatedPalette };
      setPuzzle(updatedPuzzle);
      NativeBridge.haptic('success', settings.hapticsEnabled);

      if (activeSnapshotId) {
        StorageService.savePuzzleData(activeSnapshotId, updatedPuzzle);
        StorageService.updateSnapshotProgress(
          activeSnapshotId,
          filledRegionIds.size,
          puzzle.regions.length,
          Array.from(filledRegionIds),
          undefined,
          undefined,
          undefined,
          undefined,
          Object.fromEntries(paintedRegionColors),
          updatedPalette,
          puzzle.isFreeColor
        );
      }
    },
    [puzzle, settings.hapticsEnabled, activeSnapshotId, filledRegionIds, paintedRegionColors]
  );

  // Trigger hint (highlight and center uncompleted region)
  const triggerHint = useCallback(
    (colorId?: number) => {
      if (!puzzle) return;
      const targetColor = colorId ?? activeColorId;
      if (colorId !== undefined && activeColorId !== colorId) {
        setActiveColorId(colorId);
      }

      const unfilled = puzzle.regions.filter(
        (r) => r.colorId === targetColor && !filledRegionIds.has(r.id)
      );
      if (unfilled.length === 0) return;

      NativeBridge.haptic('warning', settings.hapticsEnabled);

      // Prefer on-screen regions if available
      const onScreen = unfilled.find((r) => visibleRegionIds.has(r.id));
      const target = onScreen || unfilled[0];
      setHintRegionId(target.id);
    },
    [puzzle, activeColorId, filledRegionIds, visibleRegionIds, settings.hapticsEnabled]
  );

  // File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const title = file.name.replace(/\.[^/.]+$/, '');
        loadArtworkFromImage(
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
  };

  // Load a saved snapshot (and optionally auto-replay its region completion sequence)
  const handleLoadSnapshot = async (snapshot: SavedSnapshot, forceReplay: boolean = false) => {
    if (snapshot.id === activeSnapshotId && puzzle) {
      const currentOrdered = Array.from(filledRegionIds);
      if ((forceReplay || settings.autoReplayOnLoad !== false) && currentOrdered.length > 0) {
        startReplay(currentOrdered, !forceReplay);
      }
      return;
    }

    setIsReplaying(false);
    setIsReplayPlaying(false);
    setIsLoading(true);
    setLoadingProgress(0.15);
    setLoadingStatus(`Loading ${snapshot.title}...`);
    setLoadingPayload(null);

    setActiveSnapshotId(snapshot.id);

    const resolvedSrc = await resolveSnapshotImageSrc(snapshot);

    // Try IndexedDB first
    const cachedPuzzle = await StorageService.loadPuzzleData(snapshot.id);
    if (cachedPuzzle) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const orderedIds = snapshot.filledRegionIds || [];
        const filledSet = new Set(orderedIds);
        if (snapshot.customPalette && snapshot.customPalette.length > 0) {
          cachedPuzzle.palette = snapshot.customPalette;
        }
        let paintedObj: Record<number, number> = {};
        if (snapshot.paintedRegionColors) {
          paintedObj = snapshot.paintedRegionColors;
          setPaintedRegionColors(
            new Map(Object.entries(snapshot.paintedRegionColors).map(([k, v]) => [Number(k), v]))
          );
        } else {
          setPaintedRegionColors(new Map());
        }
        const isFree = Boolean(snapshot.isFreeColor || cachedPuzzle.isFreeColor);
        handleUpdateSettings((prev) => ({ ...prev, isFreeColorMode: isFree }));
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
        viewportRef.current = restoredView;
        setInitialViewport(restoredView);
        setSourceImage(img);
        setPuzzle(cachedPuzzle);
        setActiveColorId(restoredColor);
        setFilledRegionIds(filledSet);
        setUndoStack(
          orderedIds.map((rId) => ({
            regionId: rId,
            wasPreviouslyFilled: false,
          }))
        );
        setRedoStack([]);
        StorageService.saveActiveState({
          activeSnapshotId: snapshot.id,
          activeColorId: restoredColor,
          filledRegionIds: orderedIds,
          paintedRegionColors: paintedObj,
          isFreeColorMode: isFree,
          zoomScale: restoredView.zoomScale,
          panOffsetX: restoredView.panOffsetX,
          panOffsetY: restoredView.panOffsetY,
        });
        setIsLoading(false);

        if ((forceReplay || settings.autoReplayOnLoad !== false) && orderedIds.length > 0) {
          startReplay(orderedIds, !forceReplay);
        }
      };
      img.onerror = () => {
        if (snapshot.previewDataUrl && img.src !== snapshot.previewDataUrl) {
          img.src = snapshot.previewDataUrl;
        } else {
          setIsLoading(false);
        }
      };
      img.src = resolvedSrc;
      return;
    }

    // Fallback: regenerate from image
    const storedBlob = snapshot.sampleAssetPath
      ? null
      : await StorageService.loadImageBlob(
          snapshot.sourceRef?.kind === 'blob' ? snapshot.sourceRef.uri : snapshot.id
        );
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      loadArtworkFromImage(
        img,
        snapshot.title,
        settings.generatorConfig,
        new Set(snapshot.filledRegionIds || []),
        undefined,
        snapshot.id,
        snapshot.sampleAssetPath,
        forceReplay || settings.autoReplayOnLoad !== false,
        storedBlob
      );
    };
    img.onerror = () => {
      setIsLoading(false);
    };
    img.src = resolvedSrc;
  };

  // Active Save Title & Progress
  const activeSave = snapshots.find((s) => s.id === activeSnapshotId);
  const activeTitle = activeSave?.title || 'Capy';
  const totalCount = puzzle?.regions.length || 0;
  const filledCount = filledRegionIds.size;
  const progressPercentage = totalCount > 0 ? Math.round((filledCount * 100) / totalCount) : 0;
  const isCompleted = totalCount > 0 && filledCount >= totalCount;

  // Displayed regions on canvas (animated slice during Replay mode, or full filled set)
  const displayedFilledRegionIds = useMemo(() => {
    if (!isReplaying) return filledRegionIds;
    return new Set(replaySequence.slice(0, replayStep));
  }, [isReplaying, replaySequence, replayStep, filledRegionIds]);

  // Export full-resolution colored artwork as PNG (supports Web download and Android native Share Sheet)
  const handleExportArtwork = useCallback(() => {
    if (!puzzle || !sourceImage) return;
    const canvas = document.createElement('canvas');
    canvas.width = puzzle.width;
    canvas.height = puzzle.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const paletteMap = new Map<number, PaletteColor>(
      puzzle.palette.map((c) => [c.id, c])
    );

    if (puzzle.isFreeColor || paintedRegionColors.size > 0) {
      const imgData = ctx.createImageData(puzzle.width, puzzle.height);
      const data = imgData.data;
      data.fill(255);

      for (const region of puzzle.regions) {
        if (filledRegionIds.has(region.id)) {
          const colId = paintedRegionColors.get(region.id) ?? region.colorId;
          const col = paletteMap.get(colId);
          const r = col?.r ?? 71;
          const g = col?.g ?? 85;
          const b = col?.b ?? 105;
          for (let i = 0; i < region.pixels.length; i++) {
            const idx = region.pixels[i] * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255;
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(sourceImage, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);

      if (filledRegionIds.size < puzzle.regions.length) {
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = puzzle.width;
        maskCanvas.height = puzzle.height;
        const mCtx = maskCanvas.getContext('2d');
        if (mCtx) {
          const imgData = mCtx.createImageData(puzzle.width, puzzle.height);
          const data = imgData.data;
          for (let i = 0; i < puzzle.width * puzzle.height; i++) {
            const rId = puzzle.regionMap[i];
            if (!filledRegionIds.has(rId)) {
              const idx = i * 4;
              data[idx] = 248;
              data[idx + 1] = 250;
              data[idx + 2] = 252;
              data[idx + 3] = 230;
            }
          }
          mCtx.putImageData(imgData, 0, 0);
          ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
        }
      }
    }

    const titleStr = activeTitle || 'capy-artwork';
    const fileName = `${titleStr.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
    canvas.toBlob((blob) => {
      if (!blob) return;
      void NativeBridge.exportOrShareFile({
        title: titleStr,
        fileName,
        mimeType: 'image/png',
        data: blob,
      });
      NativeBridge.haptic('tick', settings.hapticsEnabled);
    }, 'image/png');
  }, [puzzle, sourceImage, filledRegionIds, paintedRegionColors, activeTitle, settings.hapticsEnabled]);

  // Export single snapshot to compact .capy v2 binary file
  const handleExportSnapshot = useCallback(
    async (id: string, title: string) => {
      try {
        const bytes = await StorageService.exportSnapshotBinary(id);
        const cleanTitle = (title || 'puzzle').replace(/[^a-zA-Z0-9_-]/g, '_');
        await NativeBridge.exportOrShareFile({
          title: title || 'Capy Save',
          fileName: `${cleanTitle}.capy`,
          mimeType: 'application/octet-stream',
          data: bytes,
        });
        NativeBridge.haptic('tick', settings.hapticsEnabled);
      } catch (e) {
        console.error('Failed to export snapshot', e);
      }
    },
    [settings.hapticsEnabled]
  );

  // Export all saved puzzles to compact .capy v2 backup archive
  const handleExportAllSnapshots = useCallback(async () => {
    try {
      const bytes = await StorageService.exportAllSnapshotsBinary();
      await NativeBridge.exportOrShareFile({
        title: 'Capy Saves Backup',
        fileName: 'capy_saves_backup.capy',
        mimeType: 'application/octet-stream',
        data: bytes,
      });
      NativeBridge.haptic('tick', settings.hapticsEnabled);
    } catch (e) {
      console.error('Failed to export all snapshots', e);
    }
  }, [settings.hapticsEnabled]);

  // Import saves from .capy (v2 binary or v1 JSON) or .json file
  const handleImportSnapshots = useCallback(
    async (file: File) => {
      try {
        const buffer = await file.arrayBuffer();
        const result = await StorageService.importSnapshotData(buffer);
        if (result.importedCount > 0) {
          const refreshed = StorageService.loadSnapshots();
          setSnapshots(refreshed);
          NativeBridge.haptic('success', settings.hapticsEnabled);
        } else if (result.error) {
          alert(`Failed to import saves: ${result.error}`);
        }
      } catch (e) {
        console.error('Failed to import file', e);
      }
    },
    [settings.hapticsEnabled]
  );

  return (
    <div className="relative w-full h-full overflow-hidden bg-black select-none">
      {/* Hidden File Picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* Floating Top Bar */}
      <GameTopBar
        activeTitle={activeTitle}
        progressPercentage={progressPercentage}
        isPreviewMode={isPreviewMode}
        isCompleted={isCompleted}
        isFullscreen={isFullscreen}
        onPickImage={() => fileInputRef.current?.click()}
        onTogglePreview={() => setIsPreviewMode((prev) => !prev)}
        onToggleFullscreen={handleToggleFullscreen}
        onOpenSettings={() => {
          setSettingsInitialTab(undefined);
          setShowSettings(true);
        }}
        onOpenSaves={() => {
          setSettingsInitialTab(3);
          setShowSettings(true);
        }}
      />

      {/* Full Screen Interactive Canvas */}
      <PuzzleCanvas
        puzzle={puzzle}
        sourceImage={sourceImage}
        activeColorId={isCompleted || isReplaying ? 0 : activeColorId}
        filledRegionIds={displayedFilledRegionIds}
        paintedRegionColors={paintedRegionColors}
        hintRegionId={isCompleted || isReplaying ? null : hintRegionId}
        isPreviewMode={isPreviewMode}
        isFreeColorMode={isFreeColorMode}
        isPaintMode={isReplaying ? false : settings.isPaintMode}
        canvasBgColor={settings.canvasBgColor}
        canvasBgArgb={settings.canvasBgArgb}
        sortOrder={settings.paletteSort}
        regionColorMode={settings.regionColorMode}
        showRegionLabels={isReplaying ? false : settings.showRegionLabels}
        showPreviewLabels={settings.showPreviewLabels}
        showPreviewBorders={settings.showPreviewBorders}
        labelScale={settings.labelScale}
        minLabelSize={settings.minLabelSize}
        maxLabelSize={settings.maxLabelSize}
        highlightMatching={isReplaying ? false : settings.highlightMatching}
        highlightStyle={settings.highlightStyle}
        hintColorArgb={settings.hintColorArgb}
        hintFillStyle={settings.hintFillStyle}
        animateHint={settings.animateHint}
        showNextRegionHint={isReplaying ? false : settings.showNextRegionHint}
        hintIntensity={settings.hintIntensity}
        panMomentum={settings.panMomentum}
        reverseDoubleTapZoom={settings.reverseDoubleTapZoom}
        displayNumberMap={displayNumberMap}
        initialZoomScale={initialViewport.zoomScale}
        initialPanOffsetX={initialViewport.panOffsetX}
        initialPanOffsetY={initialViewport.panOffsetY}
        zoomInTrigger={zoomInTrigger}
        zoomOutTrigger={zoomOutTrigger}
        resetViewTrigger={resetViewTrigger}
        isGenerating={isLoading}
        detailedProgress={Boolean(settings.detailedLoadingProgress)}
        generationProgress={loadingProgress}
        generationStepIndex={loadingPayload?.stepIndex || 1}
        onViewExtentChanged={(zoom, panX, panY) => {
          setIsCanvasTransformed(zoom > 1.05 || Math.abs(panX) > 6 || Math.abs(panY) > 6);
          if (!isReplaying && !isLoading && puzzle && activeSnapshotId) {
            viewportRef.current = { zoomScale: zoom, panOffsetX: panX, panOffsetY: panY };
            if (viewportSaveTimerRef.current !== null) {
              window.clearTimeout(viewportSaveTimerRef.current);
            }
            viewportSaveTimerRef.current = window.setTimeout(() => {
              viewportSaveTimerRef.current = null;
              const orderedList = Array.from(filledRegionIds);
              const paintedObj = Object.fromEntries(paintedRegionColors);
              const updated = StorageService.updateSnapshotProgress(
                activeSnapshotId,
                filledRegionIds.size,
                puzzle.regions.length,
                orderedList,
                zoom,
                panX,
                panY
              );
              setSnapshots(updated);
              StorageService.saveActiveState({
                activeSnapshotId,
                activeColorId,
                filledRegionIds: orderedList,
                paintedRegionColors: paintedObj,
                isFreeColorMode,
                zoomScale: zoom,
                panOffsetX: panX,
                panOffsetY: panY,
              });
            }, 350);
          }
        }}
        onRegionClicked={attemptFillRegion}
        onBatchRegionsClicked={attemptBatchFillRegions}
        onVisibleColorsChanged={setVisibleColorIds}
        onVisibleRegionsChanged={setVisibleRegionIds}
        onTogglePreview={() => setIsPreviewMode((prev) => !prev)}
      />

      {/* Floating Action Controls (Undo, Redo, Replay, Zoom, Paint Mode) */}
      {puzzle && !isLoading && (
        <FloatingActions
          isPaintMode={settings.isPaintMode}
          showZoomButtons={settings.showZoomButtons}
          showResetViewButton={settings.showResetViewButton}
          raiseDock={settings.raisePaletteDock}
          isZoomedOrPanned={isCanvasTransformed}
          canUndo={isUndoEnabled && (undoStack.length > 0 || filledRegionIds.size > 0)}
          canRedo={isUndoEnabled && redoStack.length > 0}
          showUndo={isUndoEnabled}
          isCompleted={isCompleted}
          isReplaying={isReplaying}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onLongPressUndo={handleOpenTimelineReplay}
          onStartReplay={() => startReplay(Array.from(filledRegionIds))}
          onTogglePaintMode={() => {
            NativeBridge.haptic('tick', settings.hapticsEnabled);
            handleUpdateSettings((prev) => ({ ...prev, isPaintMode: !prev.isPaintMode }));
          }}
          onZoomIn={() => setZoomInTrigger((prev) => prev + 1)}
          onZoomOut={() => setZoomOutTrigger((prev) => prev + 1)}
          onResetView={() => setResetViewTrigger((prev) => prev + 1)}
        />
      )}

      {/* Animated Replay HUD Controls */}
      {puzzle && !isLoading && (
        <ReplayControls
          isOpen={isReplaying}
          isPlaying={isReplayPlaying}
          currentStep={replayStep}
          totalSteps={replaySequence.length}
          replaySpeed={settings.replaySpeed || 1}
          raiseDock={settings.raisePaletteDock}
          onTogglePlay={() => {
            autoResumeReplayRef.current = false;
            setIsReplayPlaying((prev) => !prev);
          }}
          onRestart={() => {
            autoResumeReplayRef.current = false;
            setResetViewTrigger((prev) => prev + 1);
            setReplayStep(0);
            setIsReplayPlaying(true);
          }}
          onSkipToEnd={() => {
            autoResumeReplayRef.current = false;
            setReplayStep(replaySequence.length);
            setIsReplayPlaying(false);
          }}
          onSeek={(step) => {
            autoResumeReplayRef.current = false;
            setReplayStep(step);
            setIsReplayPlaying(false);
          }}
          onChangeSpeed={(spd) => {
            handleUpdateSettings((prev) => ({ ...prev, replaySpeed: spd }));
          }}
          onExitReplay={() => {
            autoResumeReplayRef.current = false;
            setIsReplaying(false);
            setIsReplayPlaying(false);
          }}
          onExportImage={handleExportArtwork}
          onOpenCreate={() => {
            setIsReplaying(false);
            setIsReplayPlaying(false);
            setSettingsInitialTab(2);
            setShowSettings(true);
          }}
          onResumeFromStep={handleResumeFromReplayStep}
        />
      )}

      {/* Palette Dock floating above canvas */}
      {puzzle && !isLoading && !isCompleted && !isReplaying && (
        <PaletteDock
          palette={puzzle.palette}
          regions={puzzle.regions}
          activeColorId={activeColorId}
          filledRegionIds={filledRegionIds}
          paintedRegionColors={paintedRegionColors}
          sortOrder={settings.paletteSort}
          prioritizeOnScreen={settings.prioritizeOnScreen}
          visibleColorIds={visibleColorIds}
          raiseDock={settings.raisePaletteDock}
          isFreeColorMode={isFreeColorMode}
          showCustomColorButton={Boolean(
            isFreeColorMode || puzzle.isFreeColor || settings.enableCustomColorForAllPuzzles
          )}
          onColorSelected={(colId) => {
            NativeBridge.haptic('tick', settings.hapticsEnabled);
            setActiveColorId(colId);
            setHintRegionId(null);
          }}
          onColorHintRequested={(colId) => triggerHint(colId)}
          onOpenPaletteOptions={() => setShowPaletteOptions(true)}
          onAddCustomColor={handleAddCustomColor}
          onUpdateColor={handleUpdateColor}
          onApplyPresetPalette={handleApplyPresetPalette}
        />
      )}

      {/* Custom Color Picker & Palette Options Popover */}
      {puzzle && (
        <ColorPickerPopover
          isOpen={showPaletteOptions}
          activeColor={puzzle.palette.find((c) => c.id === activeColorId) || null}
          onClose={() => setShowPaletteOptions(false)}
          onAddCustomColor={handleAddCustomColor}
          onUpdateColor={handleUpdateColor}
          onApplyPresetPalette={handleApplyPresetPalette}
        />
      )}

      {/* Loading & Generation Pipeline Details Overlay */}
      <LoadingOverlay
        isLoading={isLoading}
        status={loadingStatus}
        progress={loadingProgress}
        payload={loadingPayload}
        detailedProgress={Boolean(settings.detailedLoadingProgress)}
        onToggleDetailedProgress={(enabled) => {
          handleUpdateSettings((prev) => ({
            ...prev,
            detailedLoadingProgress: enabled,
          }));
          PuzzleWorkerService.setDetailedProgress(enabled);
        }}
      />

      {/* Settings Modal Sheet */}
      <SettingsModal
        isOpen={showSettings}
        initialTab={settingsInitialTab}
        settings={settings}
        snapshots={snapshots}
        activeSnapshotId={activeSnapshotId}
        sourceImage={sourceImage}
        isFullscreen={isFullscreen}
        onClose={() => setShowSettings(false)}
        onUpdateSettings={handleUpdateSettings}
        onToggleFullscreen={handleToggleFullscreen}
        onLoadSnapshot={(snap) => handleLoadSnapshot(snap, false)}
        onReplaySnapshot={(snap) => handleLoadSnapshot(snap, true)}
        onRenameSnapshot={(id, newTitle) => {
          const updated = StorageService.renameSnapshot(id, newTitle);
          setSnapshots(updated);
        }}
        onTogglePinSnapshot={(id) => {
          const updated = StorageService.togglePinSnapshot(id);
          setSnapshots(updated);
        }}
        onDeleteSnapshot={async (id) => {
          const updated = await StorageService.deleteSnapshot(id);
          setSnapshots(updated);
          if (id === activeSnapshotId) {
            if (updated.length > 0) {
              handleLoadSnapshot(updated[0], false);
            } else {
              const defaultSample = SAMPLE_GALLERY[0];
              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.onload = () => {
                loadArtworkFromImage(img, defaultSample.title, settings.generatorConfig, new Set(), undefined, undefined, defaultSample.assetPath);
              };
              img.src = defaultSample.assetPath;
            }
          }
        }}
        onClearAllSnapshots={async () => {
          await StorageService.clearAllSnapshots();
          setSnapshots([]);
          const defaultSample = SAMPLE_GALLERY[0];
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            loadArtworkFromImage(img, defaultSample.title, settings.generatorConfig, new Set(), undefined, undefined, defaultSample.assetPath);
          };
          img.src = defaultSample.assetPath;
        }}
        onResetProgress={() => {
          setIsReplaying(false);
          setIsReplayPlaying(false);
          setFilledRegionIds(new Set());
          setPaintedRegionColors(new Map());
          setUndoStack([]);
          setRedoStack([]);
          setHintRegionId(null);
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
              {}
            );
            setSnapshots(updated);
            StorageService.saveActiveState({
              activeSnapshotId,
              activeColorId: puzzle.palette[0]?.id || 1,
              filledRegionIds: [],
              paintedRegionColors: {},
              isFreeColorMode,
              zoomScale,
              panOffsetX,
              panOffsetY,
            });
          }
          setShowSettings(false);
        }}
        onRegenerate={async (cfg) => {
          if (sourceImage) {
            const samplePath = activeSave?.sourceRef?.kind === 'sample'
              ? activeSave.sourceRef.uri
              : activeSave?.sampleAssetPath;
            const existingBlob =
              !samplePath && activeSave
                ? await StorageService.loadImageBlob(
                    activeSave.sourceRef?.kind === 'blob' ? activeSave.sourceRef.uri : activeSave.id
                  )
                : null;
            loadArtworkFromImage(
              sourceImage,
              activeTitle,
              cfg,
              new Set(),
              undefined,
              undefined,
              samplePath,
              false,
              existingBlob
            );
          }
        }}
        onSelectSample={(sample: SampleArtwork) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            loadArtworkFromImage(img, sample.title, settings.generatorConfig, new Set(), undefined, undefined, sample.assetPath);
          };
          img.src = sample.assetPath;
        }}
        onUploadImage={() => fileInputRef.current?.click()}
        onExportSnapshot={handleExportSnapshot}
        onExportAllSnapshots={handleExportAllSnapshots}
        onImportSnapshots={handleImportSnapshots}
      />
    </div>
  );
};
