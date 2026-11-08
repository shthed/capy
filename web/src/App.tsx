import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  GeneratorConfig,
  PaletteColor,
  PalettePreset,
  PaletteSortOrder,
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
import { VictoryModal } from './components/VictoryModal';
import { ColorPickerPopover } from './components/ColorPickerPopover';

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
  const [hintRegionId, setHintRegionId] = useState<number | null>(null);
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);
  const [zoomInTrigger, setZoomInTrigger] = useState<number>(0);
  const [zoomOutTrigger, setZoomOutTrigger] = useState<number>(0);
  const [resetViewTrigger, setResetViewTrigger] = useState<number>(0);
  const [isCanvasTransformed, setIsCanvasTransformed] = useState<boolean>(false);
  const [showVictory, setShowVictory] = useState<boolean>(false);
  const victoryShownRef = useRef<Set<string>>(new Set());

  // Spatial Viewport
  const [visibleColorIds, setVisibleColorIds] = useState<Set<number>>(new Set());
  const [visibleRegionIds, setVisibleRegionIds] = useState<Set<number>>(new Set());

  // Loading
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadingProgress, setLoadingProgress] = useState<number>(0.05);
  const [loadingStatus, setLoadingStatus] = useState<string>('Loading Capy...');

  // Modal Sheet
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<number>(0);
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
      sampleAssetPath?: string | null
    ) => {
      const currentSeq = ++generationSeqRef.current;
      setIsLoading(true);
      setLoadingProgress(0.05);
      setLoadingStatus('Initializing artwork canvas...');

      // Clear old puzzle when generating a new artwork so title and canvas do not desync
      if (!existingSnapshotId || existingSnapshotId !== activeSnapshotId) {
        setPuzzle(null);
        setHintRegionId(null);
      }

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
          const puzzleData = await PuzzleWorkerService.generate(canvas, config, (prog, stat) => {
            if (currentSeq === generationSeqRef.current) {
              setLoadingProgress(prog);
              setLoadingStatus(stat);
            }
          });

          if (currentSeq !== generationSeqRef.current) return;

          setSourceImage(img);
          setPuzzle(puzzleData);
          setFilledRegionIds(initialFilledRegionIds);
          setPaintedRegionColors(new Map());

          if (puzzleData.isFreeColor) {
            handleUpdateSettings({ ...settings, isFreeColorMode: true });
          }

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

          // Update snapshot with final region counts
          const finalizedSnapshots = StorageService.updateSnapshotProgress(
            snapId,
            initialFilledRegionIds.size,
            puzzleData.regions.length,
            Array.from(initialFilledRegionIds),
            1.0,
            0,
            0,
            previewUrl,
            undefined,
            puzzleData.palette,
            puzzleData.isFreeColor
          );
          setSnapshots(finalizedSnapshots);

          // Persist puzzle in IndexedDB
          await StorageService.savePuzzleData(snapId, puzzleData);

          // Persist active game session
          StorageService.saveActiveState({
            activeSnapshotId: snapId,
            activeColorId: targetColor,
            filledRegionIds: Array.from(initialFilledRegionIds),
            paintedRegionColors: {},
            isFreeColorMode: Boolean(puzzleData.isFreeColor),
            zoomScale: 1.0,
            panOffsetX: 0,
            panOffsetY: 0,
          });

          setIsLoading(false);
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
    [settings.generatorConfig, generatePreviewDataUrl]
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
              const filledSet = new Set(snap.filledRegionIds || []);
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
              if (snap.paintedRegionColors) {
                setPaintedRegionColors(new Map(Object.entries(snap.paintedRegionColors).map(([k, v]) => [Number(k), v])));
              } else if (activeState.paintedRegionColors) {
                setPaintedRegionColors(new Map(Object.entries(activeState.paintedRegionColors).map(([k, v]) => [Number(k), v])));
              }
              if (activeState.isFreeColorMode !== undefined) {
                setSettings((prev) => ({ ...prev, isFreeColorMode: Boolean(activeState.isFreeColorMode) }));
              } else if (snap.isFreeColor || cachedPuzzle.isFreeColor) {
                setSettings((prev) => ({ ...prev, isFreeColorMode: true }));
              }
              setSourceImage(img);
              setPuzzle(cachedPuzzle);
              setActiveSnapshotId(snap.id);
              setActiveColorId(restoredColor);
              setFilledRegionIds(filledSet);
              setIsLoading(false);
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

  const handleToggleFreeColorMode = useCallback(() => {
    const nextMode = !settings.isFreeColorMode;
    handleUpdateSettings({ ...settings, isFreeColorMode: nextMode });
    NativeBridge.haptic('tick', settings.hapticsEnabled);
  }, [settings]);

  // Handle single region coloring
  const attemptFillRegion = useCallback(
    (regionId: number) => {
      if (!puzzle) return;
      const region = puzzle.regions.find((r) => r.id === regionId);
      if (!region) return;

      if (isFreeColorMode) {
        const currentPaintedColor = paintedRegionColors.get(regionId);
        if (currentPaintedColor === activeColorId) return;

        const nextPainted = new Map(paintedRegionColors);
        nextPainted.set(regionId, activeColorId);
        setPaintedRegionColors(nextPainted);

        const nextFilled = new Set(filledRegionIds);
        nextFilled.add(regionId);
        setFilledRegionIds(nextFilled);
        setHintRegionId(null);

        NativeBridge.haptic('tick', settings.hapticsEnabled);

        const isComplete = nextFilled.size >= puzzle.regions.length;
        if (isComplete) {
          NativeBridge.haptic('success', settings.hapticsEnabled);
          confetti({
            particleCount: 120,
            spread: 80,
            origin: { y: 0.6 },
          });
          if (activeSnapshotId && !victoryShownRef.current.has(activeSnapshotId)) {
            victoryShownRef.current.add(activeSnapshotId);
            setTimeout(() => setShowVictory(true), 350);
          }
        }

        if (activeSnapshotId) {
          const paintedObj = Object.fromEntries(nextPainted);
          StorageService.updateSnapshotProgress(
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
          StorageService.saveActiveState({
            activeSnapshotId,
            activeColorId,
            filledRegionIds: Array.from(nextFilled),
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

      const nextFilled = new Set(filledRegionIds);
      nextFilled.add(regionId);
      setFilledRegionIds(nextFilled);
      setHintRegionId(null);

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
        if (activeSnapshotId && !victoryShownRef.current.has(activeSnapshotId)) {
          victoryShownRef.current.add(activeSnapshotId);
          setTimeout(() => setShowVictory(true), 350);
        }
      }

      // Debounced persistence
      if (activeSnapshotId) {
        StorageService.updateSnapshotProgress(
          activeSnapshotId,
          nextFilled.size,
          puzzle.regions.length,
          Array.from(nextFilled)
        );
        StorageService.saveActiveState({
          activeSnapshotId,
          activeColorId: region.colorId,
          filledRegionIds: Array.from(nextFilled),
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
    [puzzle, filledRegionIds, paintedRegionColors, isFreeColorMode, settings, activeColorId, activeSnapshotId, visibleColorIds]
  );

  // Handle batch fill (for Paint Mode drag-to-color)
  const attemptBatchFillRegions = useCallback(
    (regionIds: Set<number>) => {
      if (!puzzle || regionIds.size === 0) return;

      if (isFreeColorMode) {
        let changed = false;
        const nextPainted = new Map(paintedRegionColors);
        const nextFilled = new Set(filledRegionIds);

        for (const rId of regionIds) {
          const region = puzzle.regions.find((r) => r.id === rId);
          if (!region) continue;
          if (nextPainted.get(rId) !== activeColorId) {
            nextPainted.set(rId, activeColorId);
            nextFilled.add(rId);
            changed = true;
          }
        }

        if (changed) {
          setPaintedRegionColors(nextPainted);
          setFilledRegionIds(nextFilled);
          setHintRegionId(null);
          NativeBridge.haptic('tick', settings.hapticsEnabled);

          const isComplete = nextFilled.size >= puzzle.regions.length;
          if (isComplete) {
            NativeBridge.haptic('success', settings.hapticsEnabled);
            confetti({
              particleCount: 120,
              spread: 80,
              origin: { y: 0.6 },
            });
            if (activeSnapshotId && !victoryShownRef.current.has(activeSnapshotId)) {
              victoryShownRef.current.add(activeSnapshotId);
              setTimeout(() => setShowVictory(true), 350);
            }
          }

          if (activeSnapshotId) {
            const paintedObj = Object.fromEntries(nextPainted);
            StorageService.updateSnapshotProgress(
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
          }
        }
        return;
      }

      const isEasy = settings.difficulty === 'EASY';
      const isPaintMode = settings.isPaintMode;
      let filledAny = false;
      const nextFilled = new Set(filledRegionIds);

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
          filledAny = true;
        }
      }

      if (filledAny) {
        setFilledRegionIds(nextFilled);
        setHintRegionId(null);

        const isComplete = nextFilled.size >= puzzle.regions.length;
        if (isComplete) {
          NativeBridge.haptic('success', settings.hapticsEnabled);
          confetti({
            particleCount: 120,
            spread: 80,
            origin: { y: 0.6 },
          });
          if (activeSnapshotId && !victoryShownRef.current.has(activeSnapshotId)) {
            victoryShownRef.current.add(activeSnapshotId);
            setTimeout(() => setShowVictory(true), 350);
          }
        } else {
          NativeBridge.haptic('tick', settings.hapticsEnabled);
        }

        if (activeSnapshotId) {
          StorageService.updateSnapshotProgress(
            activeSnapshotId,
            nextFilled.size,
            puzzle.regions.length,
            Array.from(nextFilled)
          );
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
    [puzzle, isFreeColorMode, paintedRegionColors, settings, activeColorId, filledRegionIds, activeSnapshotId, visibleColorIds]
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

  // Load a saved snapshot
  const handleLoadSnapshot = async (snapshot: SavedSnapshot) => {
    setIsLoading(true);
    setLoadingProgress(0.15);
    setLoadingStatus(`Loading ${snapshot.title}...`);

    setActiveSnapshotId(snapshot.id);

    // Try IndexedDB first
    const cachedPuzzle = await StorageService.loadPuzzleData(snapshot.id);
    if (cachedPuzzle) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const filledSet = new Set(snapshot.filledRegionIds || []);
        if (snapshot.customPalette && snapshot.customPalette.length > 0) {
          cachedPuzzle.palette = snapshot.customPalette;
        }
        if (snapshot.paintedRegionColors) {
          setPaintedRegionColors(new Map(Object.entries(snapshot.paintedRegionColors).map(([k, v]) => [Number(k), v])));
        } else {
          setPaintedRegionColors(new Map());
        }
        if (snapshot.isFreeColor || cachedPuzzle.isFreeColor) {
          handleUpdateSettings({ ...settings, isFreeColorMode: true });
        }
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
        setIsLoading(false);
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
        snapshot.sampleAssetPath
      );
    };
    img.src = snapshot.sampleAssetPath || snapshot.previewDataUrl || 'assets/capybara.webp';
  };

  // Active Save Title
  const activeSave = snapshots.find((s) => s.id === activeSnapshotId);
  const activeTitle = activeSave?.title || 'Capy';
  const totalCount = puzzle?.regions.length || 0;
  const filledCount = filledRegionIds.size;
  const progressPercentage = totalCount > 0 ? Math.round((filledCount * 100) / totalCount) : 0;
  const isCompleted = totalCount > 0 && filledCount >= totalCount;

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
        isFreeColorMode={isFreeColorMode}
        onPickImage={() => fileInputRef.current?.click()}
        onTogglePreview={() => setIsPreviewMode((prev) => !prev)}
        onToggleFullscreen={handleToggleFullscreen}
        onToggleFreeColorMode={handleToggleFreeColorMode}
        onOpenSettings={() => {
          setSettingsInitialTab(0);
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
        activeColorId={activeColorId}
        filledRegionIds={filledRegionIds}
        paintedRegionColors={paintedRegionColors}
        hintRegionId={hintRegionId}
        isPreviewMode={isPreviewMode}
        isFreeColorMode={isFreeColorMode}
        isPaintMode={settings.isPaintMode}
        canvasBgColor={settings.canvasBgColor}
        canvasBgArgb={settings.canvasBgArgb}
        sortOrder={settings.paletteSort}
        regionColorMode={settings.regionColorMode}
        showRegionLabels={settings.showRegionLabels}
        showPreviewLabels={settings.showPreviewLabels}
        showPreviewBorders={settings.showPreviewBorders}
        labelScale={settings.labelScale}
        highlightMatching={settings.highlightMatching}
        highlightStyle={settings.highlightStyle}
        hintColorArgb={settings.hintColorArgb}
        hintFillStyle={settings.hintFillStyle}
        animateHint={settings.animateHint}
        showNextRegionHint={settings.showNextRegionHint}
        hintIntensity={settings.hintIntensity}
        displayNumberMap={displayNumberMap}
        zoomInTrigger={zoomInTrigger}
        zoomOutTrigger={zoomOutTrigger}
        resetViewTrigger={resetViewTrigger}
        onViewExtentChanged={(zoom, panX, panY) => {
          setIsCanvasTransformed(zoom > 1.05 || Math.abs(panX) > 6 || Math.abs(panY) > 6);
        }}
        onRegionClicked={attemptFillRegion}
        onBatchRegionsClicked={attemptBatchFillRegions}
        onVisibleColorsChanged={setVisibleColorIds}
        onVisibleRegionsChanged={setVisibleRegionIds}
        onTogglePreview={() => setIsPreviewMode((prev) => !prev)}
      />

      {/* Floating Action Controls */}
      {puzzle && !isLoading && (
        <FloatingActions
          isPaintMode={settings.isPaintMode}
          showZoomButtons={settings.showZoomButtons}
          showResetViewButton={settings.showResetViewButton}
          raiseDock={settings.raisePaletteDock}
          isZoomedOrPanned={isCanvasTransformed}
          activeColor={puzzle.palette.find((c) => c.id === activeColorId) || null}
          activeColorDisplayNumber={displayNumberMap.get(activeColorId)}
          activeColorBadgeVal={
            isFreeColorMode
              ? (paintedRegionColors
                  ? Array.from(paintedRegionColors.values()).filter((c) => c === activeColorId).length
                  : 0)
              : puzzle.regions.filter((r) => r.colorId === activeColorId && !filledRegionIds.has(r.id)).length
          }
          isFreeColorMode={isFreeColorMode}
          onTriggerHint={() => triggerHint()}
          onTogglePaintMode={() => {
            NativeBridge.haptic('tick', settings.hapticsEnabled);
            handleUpdateSettings({ ...settings, isPaintMode: !settings.isPaintMode });
          }}
          onZoomIn={() => setZoomInTrigger((prev) => prev + 1)}
          onZoomOut={() => setZoomOutTrigger((prev) => prev + 1)}
          onResetView={() => setResetViewTrigger((prev) => prev + 1)}
          onOpenPaletteOptions={() => setShowPaletteOptions(true)}
        />
      )}

      {/* Palette Dock floating above canvas */}
      {puzzle && (
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

      {/* Loading Overlay */}
      <LoadingOverlay
        isLoading={isLoading}
        status={loadingStatus}
        progress={loadingProgress}
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
        onLoadSnapshot={handleLoadSnapshot}
        onRenameSnapshot={(id, newTitle) => {
          const updated = StorageService.renameSnapshot(id, newTitle);
          setSnapshots(updated);
        }}
        onDeleteSnapshot={async (id) => {
          const updated = await StorageService.deleteSnapshot(id);
          setSnapshots(updated);
          if (id === activeSnapshotId) {
            if (updated.length > 0) {
              handleLoadSnapshot(updated[0]);
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
          setFilledRegionIds(new Set());
          setPaintedRegionColors(new Map());
          setHintRegionId(null);
          if (activeSnapshotId && puzzle) {
            StorageService.updateSnapshotProgress(activeSnapshotId, 0, puzzle.regions.length, [], undefined, undefined, undefined, undefined, {});
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
      />

      {/* Victory Celebration Modal */}
      <VictoryModal
        isOpen={showVictory}
        title={activeTitle}
        regionCount={totalCount}
        previewDataUrl={
          puzzle && sourceImage
            ? generatePreviewDataUrl(puzzle, sourceImage, filledRegionIds, paintedRegionColors)
            : undefined
        }
        onClose={() => setShowVictory(false)}
        onExportImage={handleExportArtwork}
        onOpenCreate={() => {
          setShowVictory(false);
          setSettingsInitialTab(2);
          setShowSettings(true);
        }}
      />
    </div>
  );
};
