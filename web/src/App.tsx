import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  GeneratorConfig,
  PaletteSortOrder,
  PuzzleData,
  SAMPLE_GALLERY,
  SampleArtwork,
  SavedSnapshot,
  UserSettings,
} from './types';
import { StorageService } from './services/StorageService';
import { GenerationCancelledError, PuzzleWorkerService } from './services/PuzzleWorkerService';
import { getDisplayNumberMap, getDockPalette, getVisiblePalette } from './components/PaletteDock';
import { PuzzleCanvas } from './components/PuzzleCanvas';
import { GameTopBar } from './components/GameTopBar';
import { PaletteDock } from './components/PaletteDock';
import { FloatingActions } from './components/FloatingActions';
import { SettingsModal } from './components/SettingsModal';
import { LoadingOverlay } from './components/LoadingOverlay';

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
  const [hintRegionId, setHintRegionId] = useState<number | null>(null);
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);

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

  // Hidden file input
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync settings updates to storage
  const handleUpdateSettings = (newSettings: UserSettings) => {
    setSettings(newSettings);
    StorageService.saveSettings(newSettings);
  };

  // Generate thumbnail data URL
  const generatePreviewDataUrl = useCallback(
    (puzzleData: PuzzleData, sourceImg: HTMLImageElement, filledSet: Set<number>): string => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(240, puzzleData.width);
      canvas.height = Math.min(240, puzzleData.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';

      // Draw scaled source image
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

          const targetColor = initialActiveColorId || puzzleData.palette[0]?.id || 1;
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
            previewUrl
          );
          setSnapshots(finalizedSnapshots);

          // Persist puzzle in IndexedDB
          await StorageService.savePuzzleData(snapId, puzzleData);

          // Persist active game session
          StorageService.saveActiveState({
            activeSnapshotId: snapId,
            activeColorId: targetColor,
            filledRegionIds: Array.from(initialFilledRegionIds),
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
              setSourceImage(img);
              setPuzzle(cachedPuzzle);
              setActiveSnapshotId(snap.id);
              setActiveColorId(activeState.activeColorId || cachedPuzzle.palette[0]?.id || 1);
              setFilledRegionIds(new Set(snap.filledRegionIds || []));
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

  // Display number mapping
  const displayNumberMap = useMemo(() => {
    if (!puzzle) return new Map<number, string>();
    return getDisplayNumberMap(puzzle.palette, puzzle.regions, settings.paletteSort);
  }, [puzzle, settings.paletteSort]);

  // Handle single region coloring
  const attemptFillRegion = useCallback(
    (regionId: number) => {
      if (!puzzle) return;
      const region = puzzle.regions.find((r) => r.id === regionId);
      if (!region || filledRegionIds.has(regionId)) return;

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
      if (isComplete) {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
        });
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
    [puzzle, filledRegionIds, settings, activeColorId, activeSnapshotId, visibleColorIds]
  );

  // Handle batch fill (for Paint Mode drag-to-color)
  const attemptBatchFillRegions = useCallback(
    (regionIds: Set<number>) => {
      if (!puzzle || regionIds.size === 0) return;

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
          confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
          });
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
    [puzzle, settings, activeColorId, filledRegionIds, activeSnapshotId, visibleColorIds]
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

      // Prefer on-screen regions if available
      const onScreen = unfilled.find((r) => visibleRegionIds.has(r.id));
      const target = onScreen || unfilled[0];
      setHintRegionId(target.id);
    },
    [puzzle, activeColorId, filledRegionIds, visibleRegionIds]
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
        setSourceImage(img);
        setPuzzle(cachedPuzzle);
        setActiveColorId(cachedPuzzle.palette[0]?.id || 1);
        setFilledRegionIds(new Set(snapshot.filledRegionIds || []));
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
        onPickImage={() => fileInputRef.current?.click()}
        onTogglePreview={() => setIsPreviewMode((prev) => !prev)}
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
        hintRegionId={hintRegionId}
        isPreviewMode={isPreviewMode}
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
          raiseDock={settings.raisePaletteDock}
          onTriggerHint={() => triggerHint()}
          onTogglePaintMode={() => handleUpdateSettings({ ...settings, isPaintMode: !settings.isPaintMode })}
          onZoomIn={() => {
            // Handled via wheel or pinch
          }}
          onZoomOut={() => {
            // Handled via wheel or pinch
          }}
        />
      )}

      {/* Palette Dock at bottom */}
      {puzzle && (
        <PaletteDock
          palette={puzzle.palette}
          regions={puzzle.regions}
          activeColorId={activeColorId}
          filledRegionIds={filledRegionIds}
          sortOrder={settings.paletteSort}
          prioritizeOnScreen={settings.prioritizeOnScreen}
          visibleColorIds={visibleColorIds}
          raiseDock={settings.raisePaletteDock}
          onColorSelected={(colId) => {
            setActiveColorId(colId);
            setHintRegionId(null);
          }}
          onColorHintRequested={(colId) => triggerHint(colId)}
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
        onClose={() => setShowSettings(false)}
        onUpdateSettings={handleUpdateSettings}
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
          setHintRegionId(null);
          if (activeSnapshotId && puzzle) {
            StorageService.updateSnapshotProgress(activeSnapshotId, 0, puzzle.regions.length, []);
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
    </div>
  );
};
