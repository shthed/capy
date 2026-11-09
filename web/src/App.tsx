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

  // Sync modal state with native hardware back button handler
  useEffect(() => {
    NativeBridge.setBackModalOpen(showSettings, () => setShowSettings(false));
  }, [showSettings]);

  // Sync settings updates to storage
  const handleUpdateSettings = (newSettings: UserSettings) => {
    setSettings(newSettings);
    StorageService.saveSettings(newSettings);
  };

  // Generate thumbnail data URL
  const generatePreviewDataUrl = useCallback(
    (
      puzzleData: PuzzleData,
      sourceImg: HTMLImageElement,
      filledSet: Set<number>,
      customColors?: Map<number, number>
    ): string => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(240, puzzleData.width);
      canvas.height = Math.min(240, puzzleData.height);
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
        // Standard photo rendering
        ctx.drawImage(sourceImg, 0, 0, canvas.width, canvas.height);

        // Mask unfilled regions with translucent white if not completely filled
        if (filledSet.size < puzzleData.regions.length) {
          const maskCanvas = document.createElement('canvas');
          maskCanvas.width = puzzleData.width;
          maskCanvas.height = puzzleData.height;
          const mCtx = maskCanvas.getContext('2d');
          if (mCtx) {
            const imgData = mCtx.createImageData(puzzleData.width, puzzleData.height);
            const data = imgData.data;
            for (let i = 0; i < puzzleData.width * puzzleData.height; i++) {
              const rId = puzzleData.regionMap[i];
              if (!filledSet.has(rId)) {
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

      return canvas.toDataURL('image/jpeg', 0.85);
    },
    []
  );

  const autoResumeReplayRef = useRef<boolean>(false);

  // Start animated region-by-region replay
  const startReplay = useCallback((sequence: number[], autoResumeOnFinish: boolean = false) => {
    if (!sequence || sequence.length === 0) return;
    autoResumeReplayRef.current = autoResumeOnFinish;
    setResetViewTrigger((prev) => prev + 1);
    setHintRegionId(null);
    setReplaySequence(sequence);
    setReplayStep(0);
    setIsReplaying(true);
    setIsReplayPlaying(true);
  }, []);

  // Animated Replay Loop (60 FPS smooth accumulator scaled by replaySpeed)
  useEffect(() => {
    if (!isReplaying || !isReplayPlaying) return;
    if (replayStep >= replaySequence.length) {
      setIsReplayPlaying(false);
      if (autoResumeReplayRef.current) {
        autoResumeReplayRef.current = false;
        setTimeout(() => {
          setIsReplaying(false);
        }, 250);
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
              autoResumeReplayRef.current = false;
              setTimeout(() => {
                setIsReplaying(false);
              }, 250);
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
      shouldAutoReplay: boolean = false
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

      // Prepare canvas from image
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      // Pre-register snapshot at 0ms so it appears in Saves instantly!
      const snapId = existingSnapshotId || crypto.randomUUID();
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
      };

      setActiveSnapshotId(snapId);
      const updatedSnapshots = StorageService.addSnapshot(newSnapshot);
      setSnapshots(updatedSnapshots);

      // Run generator in background Web Worker thread to prevent freezing browser
      setTimeout(async () => {
        if (currentSeq !== generationSeqRef.current) return;
        try {
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
            }
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

          const isFree = Boolean(puzzleData.isFreeColor);
          handleUpdateSettings({ ...settings, isFreeColorMode: isFree });

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
    [settings, generatePreviewDataUrl, startReplay]
  );

  // Restore session on app launch
  useEffect(() => {
    let isMounted = true;
    const restoreSession = async () => {
      const activeState = StorageService.loadActiveState();
      const existingSnapshots = StorageService.loadSnapshots();

      if (activeState?.activeSnapshotId) {
        const snap = existingSnapshots.find((s) => s.id === activeState.activeSnapshotId);
        if (snap) {
          // Attempt to load from IndexedDB
          const cachedPuzzle = await StorageService.loadPuzzleData(snap.id);
          if (cachedPuzzle && isMounted) {
            // Restore cached puzzle
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              if (!isMounted) return;
              const orderedIds = snap.filledRegionIds || [];
              const filledSet = new Set(orderedIds);
              const availableColors = getVisiblePalette(
                cachedPuzzle.palette,
                cachedPuzzle.regions,
                filledSet,
                settings.paletteSort
              );
              const restoredColor =
                activeState.activeColorId && availableColors.some((c) => c.id === activeState.activeColorId)
                  ? activeState.activeColorId
                  : availableColors[0]?.id || cachedPuzzle.palette[0]?.id || 1;
              if (snap.customPalette && snap.customPalette.length > 0) {
                cachedPuzzle.palette = snap.customPalette;
              }
              let restoredPaintedMap = new Map<number, number>();
              if (snap.paintedRegionColors) {
                restoredPaintedMap = new Map(
                  Object.entries(snap.paintedRegionColors).map(([k, v]) => [Number(k), v])
                );
              } else if (activeState.paintedRegionColors) {
                restoredPaintedMap = new Map(
                  Object.entries(activeState.paintedRegionColors).map(([k, v]) => [Number(k), v])
                );
              }
              setPaintedRegionColors(restoredPaintedMap);
              const isFree = Boolean(
                activeState.isFreeColorMode !== undefined
                  ? activeState.isFreeColorMode
                  : snap.isFreeColor || cachedPuzzle.isFreeColor
              );
              setSettings((prev) => ({ ...prev, isFreeColorMode: isFree }));
              setSourceImage(img);
              setPuzzle(cachedPuzzle);
              setActiveSnapshotId(snap.id);
              setActiveColorId(restoredColor);
              setFilledRegionIds(filledSet);
              setUndoStack(
                orderedIds.map((rId) => ({
                  regionId: rId,
                  wasPreviouslyFilled: false,
                }))
              );
              setIsLoading(false);
              if (settings.autoReplayOnLoad !== false && orderedIds.length > 0) {
                startReplay(orderedIds, true);
              }
            };
            img.src = snap.sampleAssetPath || snap.previewDataUrl || 'assets/capybara.webp';
            return;
          }
        }
      }

      // Default: Load Capybara built-in sample
      const defaultSample = SAMPLE_GALLERY[0];
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (!isMounted) return;
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
      img.onerror = () => {
        if (isMounted) setIsLoading(false);
      };
      img.src = defaultSample.assetPath;
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
      img.onload = () => {
        loadArtworkFromImage(img, title, settings.generatorConfig);
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
    const nextMode = !settings.isFreeColorMode;
    handleUpdateSettings({ ...settings, isFreeColorMode: nextMode });
    NativeBridge.haptic('tick', settings.hapticsEnabled);
  }, [settings]);

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
      const updated = StorageService.updateSnapshotProgress(
        activeSnapshotId,
        nextFilled.size,
        puzzle.regions.length,
        Array.from(nextFilled),
        undefined,
        undefined,
        undefined,
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
        zoomScale: 1.0,
        panOffsetX: 0,
        panOffsetY: 0,
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
      const updated = StorageService.updateSnapshotProgress(
        activeSnapshotId,
        nextFilled.size,
        puzzle.regions.length,
        Array.from(nextFilled),
        undefined,
        undefined,
        undefined,
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
        zoomScale: 1.0,
        panOffsetX: 0,
        panOffsetY: 0,
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

      if (!isFreeColorMode && undoneRegionIds.length > 0) {
        const nextRegion = puzzle.regions.find((r) => r.id === undoneRegionIds[0]);
        if (nextRegion) {
          setActiveColorId(nextRegion.colorId);
        }
      }

      if (activeSnapshotId) {
        const paintedObj = Object.fromEntries(nextPainted);
        const updated = StorageService.updateSnapshotProgress(
          activeSnapshotId,
          nextFilled.size,
          puzzle.regions.length,
          keptRegionIds,
          undefined,
          undefined,
          undefined,
          undefined,
          paintedObj,
          puzzle.palette,
          puzzle.isFreeColor
        );
        setSnapshots(updated);
        StorageService.saveActiveState({
          activeSnapshotId,
          activeColorId,
          filledRegionIds: keptRegionIds,
          paintedRegionColors: paintedObj,
          isFreeColorMode,
          zoomScale: 1.0,
          panOffsetX: 0,
          panOffsetY: 0,
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
          const updated = StorageService.updateSnapshotProgress(
            activeSnapshotId,
            nextFilled.size,
            puzzle.regions.length,
            orderedList,
            undefined,
            undefined,
            undefined,
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
            zoomScale: 1.0,
            panOffsetX: 0,
            panOffsetY: 0,
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

      // Persistence
      if (activeSnapshotId) {
        const updated = StorageService.updateSnapshotProgress(
          activeSnapshotId,
          nextFilled.size,
          puzzle.regions.length,
          orderedList
        );
        setSnapshots(updated);
        StorageService.saveActiveState({
          activeSnapshotId,
          activeColorId: region.colorId,
          filledRegionIds: orderedList,
          zoomScale: 1.0,
          panOffsetX: 0,
          panOffsetY: 0,
        });
      }

      // Auto-advance check
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
            setActiveColorId(nextCol.id);
          }
        }
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
            const updated = StorageService.updateSnapshotProgress(
              activeSnapshotId,
              nextFilled.size,
              puzzle.regions.length,
              orderedList,
              undefined,
              undefined,
              undefined,
              undefined,
              paintedObj,
              puzzle.palette,
              puzzle.isFreeColor
            );
            setSnapshots(updated);
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

        if (activeSnapshotId) {
          const updated = StorageService.updateSnapshotProgress(
            activeSnapshotId,
            nextFilled.size,
            puzzle.regions.length,
            orderedList
          );
          setSnapshots(updated);
        }

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
              setActiveColorId(nextCol.id);
            }
          }
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
      const argb = (0xff << 24) | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
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
      const argb = (0xff << 24) | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
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
        const argb = (0xff << 24) | (r << 16) | (g << 8) | b;
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
        loadArtworkFromImage(img, title, settings.generatorConfig);
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
        if (snapshot.paintedRegionColors) {
          setPaintedRegionColors(
            new Map(Object.entries(snapshot.paintedRegionColors).map(([k, v]) => [Number(k), v]))
          );
        } else {
          setPaintedRegionColors(new Map());
        }
        const isFree = Boolean(snapshot.isFreeColor || cachedPuzzle.isFreeColor);
        handleUpdateSettings({ ...settings, isFreeColorMode: isFree });
        const availableColors = getVisiblePalette(
          cachedPuzzle.palette,
          cachedPuzzle.regions,
          filledSet,
          settings.paletteSort
        );
        const restoredColor = availableColors[0]?.id || cachedPuzzle.palette[0]?.id || 1;
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
        setIsLoading(false);

        if ((forceReplay || settings.autoReplayOnLoad !== false) && orderedIds.length > 0) {
          startReplay(orderedIds, !forceReplay);
        }
      };
      img.src = snapshot.sampleAssetPath || snapshot.previewDataUrl || 'assets/capybara.webp';
      return;
    }

    // Fallback: regenerate from image
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
        forceReplay || settings.autoReplayOnLoad !== false
      );
    };
    img.src = snapshot.sampleAssetPath || snapshot.previewDataUrl || 'assets/capybara.webp';
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

  // Export full-resolution colored artwork as PNG
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
    const link = document.createElement('a');
    link.download = `${titleStr.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, [puzzle, sourceImage, filledRegionIds, paintedRegionColors, activeTitle]);

  // Export single snapshot to .capy file
  const handleExportSnapshot = useCallback(
    async (id: string, title: string) => {
      try {
        const json = await StorageService.exportSnapshot(id);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const cleanTitle = title.replace(/[^a-zA-Z0-9_-]/g, '_');
        a.download = `${cleanTitle}.capy`;
        a.click();
        URL.revokeObjectURL(url);
        NativeBridge.haptic('tick', settings.hapticsEnabled);
      } catch (e) {
        console.error('Failed to export snapshot', e);
      }
    },
    [settings.hapticsEnabled]
  );

  // Export all saved puzzles to backup archive
  const handleExportAllSnapshots = useCallback(async () => {
    try {
      const json = await StorageService.exportAllSnapshots();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'capy_saves_backup.capy';
      a.click();
      URL.revokeObjectURL(url);
      NativeBridge.haptic('tick', settings.hapticsEnabled);
    } catch (e) {
      console.error('Failed to export all snapshots', e);
    }
  }, [settings.hapticsEnabled]);

  // Import saves from .capy or .json file
  const handleImportSnapshots = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const result = await StorageService.importSnapshotBundle(text);
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
        zoomInTrigger={zoomInTrigger}
        zoomOutTrigger={zoomOutTrigger}
        resetViewTrigger={resetViewTrigger}
        isGenerating={isLoading}
        generationProgress={loadingProgress}
        generationStepIndex={loadingPayload?.stepIndex || 1}
        onViewExtentChanged={(zoom, panX, panY) => {
          setIsCanvasTransformed(zoom > 1.05 || Math.abs(panX) > 6 || Math.abs(panY) > 6);
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
            handleUpdateSettings({ ...settings, isPaintMode: !settings.isPaintMode });
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
            handleUpdateSettings({ ...settings, replaySpeed: spd });
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
          setHintRegionId(null);
          if (activeSnapshotId && puzzle) {
            const updated = StorageService.updateSnapshotProgress(activeSnapshotId, 0, puzzle.regions.length, [], undefined, undefined, undefined, undefined, {});
            setSnapshots(updated);
          }
          setShowSettings(false);
        }}
        onRegenerate={(cfg) => {
          if (sourceImage) {
            loadArtworkFromImage(sourceImage, activeTitle, cfg);
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
