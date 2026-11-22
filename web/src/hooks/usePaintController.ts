import { Dispatch, MutableRefObject, SetStateAction, useCallback, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  PaletteColor,
  PalettePreset,
  PuzzleData,
  Region,
  SavedSnapshot,
  UserSettings,
} from '../types';
import { StorageService } from '../services/StorageService';
import { PlayerLifetimeStats, PlayerStatsService } from '../services/PlayerStatsService';
import { SoundService } from '../services/SoundService';
import { NativeBridge } from '../services/NativeBridge';
import { finishPaintStroke } from '../services/paintStrokeHelper';
import { generatePreviewDataUrl } from '../services/artworkExporter';
import { reportSwallowed } from '../services/telemetry';
import { TutorialTriedActions } from '../components/OnboardingTutorial';
import type { CoopLiveState, CoopViewport } from './useCoopSession';
import type { UndoHistoryEntry } from './useUndoRedo';

export interface ParsedPaletteFields {
  hex: string;
  isLight: boolean;
  argb: number;
  r: number;
  g: number;
  b: number;
}

export interface UsePaintControllerParams {
  puzzle: PuzzleData | null;
  isLoading: boolean;
  isReplaying: boolean;
  showSettings: boolean;
  showPaletteOptions: boolean;
  filledRegionCount: number;
  initialSnapshots: SavedSnapshot[];
  liveCoopRef: MutableRefObject<CoopLiveState>;
  viewportRef: MutableRefObject<CoopViewport>;
  regionByIdRef: MutableRefObject<Map<number, Region>>;
  visibleColorIdsRef: MutableRefObject<Set<number>>;
  visibleRegionIdsRef: MutableRefObject<Set<number>>;
  sourceImageRef: MutableRefObject<HTMLImageElement | null>;
  isReplayingRef: MutableRefObject<boolean>;
  isPostLoadReplayRef: MutableRefObject<boolean>;
  exitReplay: () => void;
  startReplay: (sequence: number[], isPostLoad?: boolean) => void;
  emitCoopPaint: (
    kind: 'FILL',
    regionIds: number[],
    paintedColors?: Record<number, number>
  ) => void;
  isCoopSessionActive: () => boolean;
  syncUndoStack: (
    updater: UndoHistoryEntry[] | ((prev: UndoHistoryEntry[]) => UndoHistoryEntry[])
  ) => void;
  syncRedoStack: (
    updater: UndoHistoryEntry[] | ((prev: UndoHistoryEntry[]) => UndoHistoryEntry[])
  ) => void;
  setPuzzle: Dispatch<SetStateAction<PuzzleData | null>>;
  setFilledRegionIds: Dispatch<SetStateAction<Set<number>>>;
  setPaintedRegionColors: Dispatch<SetStateAction<Map<number, number>>>;
  setActiveColorId: Dispatch<SetStateAction<number>>;
  setHintRegionId: Dispatch<SetStateAction<number | null>>;
  setSnapshots: Dispatch<SetStateAction<SavedSnapshot[]>>;
  setLifetimeStats: Dispatch<SetStateAction<PlayerLifetimeStats>>;
  markTutorialActionTried: (action: keyof TutorialTriedActions) => void;
}

const HEX_COLOR_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Pure helper strictly validating & normalizing a `#RRGGBB`, `RRGGBB`, `#RGB`, or `RGB` hex string
 * into RGB, ARGB, and luminance fields. Returns `null` for malformed inputs.
 */
export function parseHexToPaletteFields(hex: string): ParsedPaletteFields | null {
  if (typeof hex !== 'string') return null;
  const match = HEX_COLOR_RE.exec(hex.trim());
  if (!match) return null;
  const raw = match[1].toLowerCase();
  const normalized =
    raw.length === 3
      ? `${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`
      : raw;
  const num = parseInt(normalized, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const isLight = 0.299 * r + 0.587 * g + 0.114 * b > 160;
  const argb = ((0xff << 24) | (r << 16) | (g << 8) | b) >>> 0;
  return {
    hex: `#${normalized}`,
    isLight,
    argb,
    r,
    g,
    b,
  };
}

/**
 * Pure helper computing the next 1-based custom color ID for a palette.
 */
export function computeNextCustomColorId(palette: PaletteColor[]): number {
  let maxId = 0;
  for (let i = 0; i < palette.length; i++) {
    if (palette[i].id > maxId) maxId = palette[i].id;
  }
  return maxId + 1;
}

/**
 * Pure helper selecting the best unfilled hint target region, preferring currently visible regions.
 */
export function selectHintTargetRegion(
  regions: Region[],
  targetColorId: number,
  filledRegionIds: Set<number>,
  visibleRegionIds: Set<number>
): Region | null {
  let fallback: Region | null = null;
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    if (r.colorId !== targetColorId || filledRegionIds.has(r.id)) continue;
    if (visibleRegionIds.has(r.id)) return r;
    if (!fallback) fallback = r;
  }
  return fallback;
}

/**
 * Pure helper building the initial set of already-completed snapshot IDs for first-time completion tracking.
 */
export function buildCompletedSnapshotIdSet(snapshots: SavedSnapshot[]): Set<string> {
  return new Set(
    snapshots
      .filter((s) => s.totalCount > 0 && s.filledCount >= s.totalCount)
      .map((s) => s.id)
  );
}

function lookupRegion(
  curPuzzle: PuzzleData,
  renderPuzzle: PuzzleData | null,
  regionById: Map<number, Region>,
  regionId: number
): Region | undefined {
  return curPuzzle === renderPuzzle
    ? regionById.get(regionId)
    : curPuzzle.regions.find((r) => r.id === regionId);
}

export function usePaintController(params: UsePaintControllerParams) {
  const {
    puzzle,
    isLoading,
    isReplaying,
    showSettings,
    showPaletteOptions,
    filledRegionCount,
    initialSnapshots,
    liveCoopRef,
    viewportRef,
    regionByIdRef,
    visibleColorIdsRef,
    visibleRegionIdsRef,
    sourceImageRef,
    isReplayingRef,
    isPostLoadReplayRef,
    exitReplay,
    startReplay,
    emitCoopPaint,
    isCoopSessionActive,
    syncUndoStack,
    syncRedoStack,
    setPuzzle,
    setFilledRegionIds,
    setPaintedRegionColors,
    setActiveColorId,
    setHintRegionId,
    setSnapshots,
    setLifetimeStats,
    markTutorialActionTried,
  } = params;

  const hintsUsedInSessionRef = useRef<number>(0);
  const activeElapsedMsRef = useRef<number>(0);
  const activeSessionResumedPerfRef = useRef<number | null>(null);
  const completedSnapshotIdsRef = useRef<Set<string>>(
    buildCompletedSnapshotIdSet(initialSnapshots)
  );

  const resetActivePuzzleSessionStats = useCallback(
    (snapshotId: string | null | undefined, alreadyCompleted: boolean) => {
      hintsUsedInSessionRef.current = 0;
      activeElapsedMsRef.current = 0;
      activeSessionResumedPerfRef.current = alreadyCompleted ? null : performance.now();
      if (snapshotId) {
        if (alreadyCompleted) {
          completedSnapshotIdsRef.current.add(snapshotId);
        } else {
          completedSnapshotIdsRef.current.delete(snapshotId);
        }
      }
    },
    []
  );

  const getCurrentActiveElapsedMs = useCallback((): number => {
    const runningDelta =
      activeSessionResumedPerfRef.current !== null
        ? Math.max(0, performance.now() - activeSessionResumedPerfRef.current)
        : 0;
    return Math.max(1, Math.round(activeElapsedMsRef.current + runningDelta));
  }, []);

  // Pause active coloring timer when modals open, replay runs, puzzle loads, or tab is hidden
  useEffect(() => {
    const syncTimer = () => {
      const isActivelyColoring =
        Boolean(puzzle) &&
        !isLoading &&
        !isReplaying &&
        !showSettings &&
        !showPaletteOptions &&
        filledRegionCount < (puzzle?.regions.length || 0) &&
        (typeof document === 'undefined' || !document.hidden);

      if (isActivelyColoring) {
        if (activeSessionResumedPerfRef.current === null) {
          activeSessionResumedPerfRef.current = performance.now();
        }
      } else if (activeSessionResumedPerfRef.current !== null) {
        activeElapsedMsRef.current += Math.max(
          0,
          performance.now() - activeSessionResumedPerfRef.current
        );
        activeSessionResumedPerfRef.current = null;
      }
    };

    syncTimer();
    document.addEventListener('visibilitychange', syncTimer);
    return () => {
      document.removeEventListener('visibilitychange', syncTimer);
    };
  }, [puzzle, isLoading, isReplaying, showSettings, showPaletteOptions, filledRegionCount]);

  const recordFirstTimePuzzleCompletionIfNeeded = useCallback(
    (wasIncomplete: boolean, isNowComplete: boolean, snapshotIdOverride?: string | null) => {
      if (!wasIncomplete || !isNowComplete) return;
      const targetSnapshotId = snapshotIdOverride ?? liveCoopRef.current.activeSnapshotId;
      if (targetSnapshotId && completedSnapshotIdsRef.current.has(targetSnapshotId)) {
        return;
      }
      if (targetSnapshotId) {
        completedSnapshotIdsRef.current.add(targetSnapshotId);
      }
      const elapsedMs = getCurrentActiveElapsedMs();
      activeSessionResumedPerfRef.current = null;
      setLifetimeStats(
        PlayerStatsService.recordPuzzleCompleted({
          hintsUsed: hintsUsedInSessionRef.current,
          activeElapsedMs: elapsedMs,
        })
      );
    },
    [getCurrentActiveElapsedMs, liveCoopRef, setLifetimeStats]
  );

  const completePaintStroke = useCallback(
    (
      curPuzzle: PuzzleData,
      nextFilled: Set<number>,
      paintedRegionColorsMap: Map<number, number>,
      activeColorIdToPersist: number,
      isFreeColor: boolean,
      wasPuzzleIncomplete: boolean,
      snapshotId: string | null,
      curSettings: UserSettings,
      filledRegionColorId?: number
    ) => {
      finishPaintStroke(
        {
          puzzle: curPuzzle,
          nextFilled,
          paintedRegionColors: paintedRegionColorsMap,
          activeColorId: activeColorIdToPersist,
          isFreeColorMode: isFreeColor,
          wasPuzzleIncomplete,
          snapshotId,
          settings: curSettings,
          viewport: viewportRef.current,
          visibleColorIds: visibleColorIdsRef.current,
          filledRegionColorId,
        },
        {
          onRecordFirstTimeCompletion: recordFirstTimePuzzleCompletionIfNeeded,
          onHaptic: (type, enabled) => NativeBridge.haptic(type, enabled),
          onConfetti: () => {
            confetti({
              particleCount: 120,
              spread: 80,
              origin: { y: 0.6 },
            });
          },
          onStartReplay: startReplay,
          onActiveColorAutoAdvanced: (nextColorId) => {
            liveCoopRef.current = { ...liveCoopRef.current, activeColorId: nextColorId };
            setActiveColorId(nextColorId);
          },
          onUpdateSnapshotProgress: (
            id,
            filledCountArg,
            totalCountArg,
            orderedIds,
            zoomScale,
            panOffsetX,
            panOffsetY,
            paintedObj,
            customPalette,
            isFreeColorPuzzle
          ) =>
            StorageService.updateSnapshotProgress(
              id,
              filledCountArg,
              totalCountArg,
              orderedIds,
              zoomScale,
              panOffsetX,
              panOffsetY,
              undefined,
              paintedObj,
              customPalette,
              isFreeColorPuzzle
            ),
          onSetSnapshots: setSnapshots,
          onSaveActiveState: (state) => StorageService.saveActiveState(state),
        }
      );
    },
    [
      liveCoopRef,
      recordFirstTimePuzzleCompletionIfNeeded,
      setActiveColorId,
      setSnapshots,
      startReplay,
      viewportRef,
      visibleColorIdsRef,
    ]
  );

  const canInteractDuringReplay = useCallback(
    (curPuzzle: PuzzleData, curFilledCount: number): boolean => {
      if (!isReplayingRef.current) return true;
      if (isPostLoadReplayRef.current && curFilledCount < curPuzzle.regions.length) {
        exitReplay();
        return true;
      }
      return false;
    },
    [exitReplay, isPostLoadReplayRef, isReplayingRef]
  );

  const fillFreeColorSingleRegion = useCallback(
    (cur: CoopLiveState, curPuzzle: PuzzleData, region: Region, wasPuzzleIncomplete: boolean) => {
      const wasFilled = cur.filledRegionIds.has(region.id);
      const currentPaintedColor = cur.paintedRegionColors.get(region.id);
      const effectivePrevColor =
        currentPaintedColor !== undefined
          ? currentPaintedColor
          : wasFilled
            ? region.colorId
            : undefined;
      if (effectivePrevColor === cur.activeColorId) return;

      syncUndoStack((prev) => [
        ...prev,
        {
          regionId: region.id,
          wasPreviouslyFilled: wasFilled,
          previousPaintedColorId: effectivePrevColor,
          paintedColorId: cur.activeColorId,
        },
      ]);
      syncRedoStack([]);

      const nextPainted = new Map(cur.paintedRegionColors);
      nextPainted.set(region.id, cur.activeColorId);
      const nextFilled = new Set(cur.filledRegionIds);
      nextFilled.add(region.id);
      liveCoopRef.current = {
        ...cur,
        filledRegionIds: nextFilled,
        paintedRegionColors: nextPainted,
      };
      setPaintedRegionColors(nextPainted);
      setFilledRegionIds(nextFilled);
      setHintRegionId(null);
      markTutorialActionTried('paint');
      emitCoopPaint('FILL', [region.id], { [region.id]: cur.activeColorId });
      setLifetimeStats(PlayerStatsService.recordRegionsColored(1, isCoopSessionActive()));
      SoundService.playRegionTap(cur.activeColorId);
      completePaintStroke(
        curPuzzle,
        nextFilled,
        nextPainted,
        cur.activeColorId,
        true,
        wasPuzzleIncomplete,
        cur.activeSnapshotId,
        cur.settings
      );
    },
    [
      completePaintStroke,
      emitCoopPaint,
      isCoopSessionActive,
      liveCoopRef,
      markTutorialActionTried,
      setFilledRegionIds,
      setHintRegionId,
      setLifetimeStats,
      setPaintedRegionColors,
      syncRedoStack,
      syncUndoStack,
    ]
  );

  const attemptFillRegion = useCallback(
    (regionId: number) => {
      const cur = liveCoopRef.current;
      const curPuzzle = cur.puzzle;
      if (!curPuzzle) return;
      if (!canInteractDuringReplay(curPuzzle, cur.filledRegionIds.size)) return;

      const region = lookupRegion(curPuzzle, puzzle, regionByIdRef.current, regionId);
      if (!region) return;
      const wasPuzzleIncomplete = cur.filledRegionIds.size < curPuzzle.regions.length;

      if (cur.isFreeColorMode) {
        fillFreeColorSingleRegion(cur, curPuzzle, region, wasPuzzleIncomplete);
        return;
      }
      if (cur.filledRegionIds.has(regionId)) return;

      const isEasy = cur.settings.difficulty === 'EASY';
      if (!isEasy && region.colorId !== cur.activeColorId) return;

      const nextActiveColId = isEasy ? region.colorId : cur.activeColorId;
      if (isEasy && cur.activeColorId !== region.colorId) {
        setActiveColorId(region.colorId);
      }

      syncUndoStack((prev) => [
        ...prev,
        {
          regionId,
          wasPreviouslyFilled: false,
          paintedColorId: region.colorId,
        },
      ]);
      syncRedoStack([]);

      const nextFilled = new Set(cur.filledRegionIds);
      nextFilled.add(regionId);
      liveCoopRef.current = {
        ...cur,
        filledRegionIds: nextFilled,
        activeColorId: nextActiveColId,
      };
      setFilledRegionIds(nextFilled);
      setHintRegionId(null);
      markTutorialActionTried('paint');
      emitCoopPaint('FILL', [regionId]);
      setLifetimeStats(PlayerStatsService.recordRegionsColored(1, isCoopSessionActive()));
      SoundService.playRegionTap(region.colorId);
      completePaintStroke(
        curPuzzle,
        nextFilled,
        cur.paintedRegionColors,
        nextActiveColId,
        cur.isFreeColorMode,
        wasPuzzleIncomplete,
        cur.activeSnapshotId,
        cur.settings,
        region.colorId
      );
    },
    [
      canInteractDuringReplay,
      completePaintStroke,
      emitCoopPaint,
      fillFreeColorSingleRegion,
      isCoopSessionActive,
      liveCoopRef,
      markTutorialActionTried,
      puzzle,
      regionByIdRef,
      setActiveColorId,
      setFilledRegionIds,
      setHintRegionId,
      setLifetimeStats,
      syncRedoStack,
      syncUndoStack,
    ]
  );

  const batchFillFreeColorRegions = useCallback(
    (
      cur: CoopLiveState,
      curPuzzle: PuzzleData,
      regionIds: Set<number>,
      wasPuzzleIncomplete: boolean
    ) => {
      const nextPainted = new Map(cur.paintedRegionColors);
      const nextFilled = new Set(cur.filledRegionIds);
      const newUndoEntries: UndoHistoryEntry[] = [];
      const changedColors: Record<number, number> = {};

      for (const rId of regionIds) {
        const region = lookupRegion(curPuzzle, puzzle, regionByIdRef.current, rId);
        if (!region) continue;
        const wasFilled = nextFilled.has(rId);
        const prevCol = nextPainted.get(rId);
        const effectivePrevCol =
          prevCol !== undefined ? prevCol : wasFilled ? region.colorId : undefined;
        if (effectivePrevCol === cur.activeColorId) continue;

        newUndoEntries.push({
          regionId: rId,
          wasPreviouslyFilled: wasFilled,
          previousPaintedColorId: effectivePrevCol,
          paintedColorId: cur.activeColorId,
        });
        nextPainted.set(rId, cur.activeColorId);
        changedColors[rId] = cur.activeColorId;
        nextFilled.add(rId);
      }

      if (newUndoEntries.length === 0) return;

      syncUndoStack((prev) => [...prev, ...newUndoEntries]);
      syncRedoStack([]);
      liveCoopRef.current = {
        ...cur,
        filledRegionIds: nextFilled,
        paintedRegionColors: nextPainted,
      };
      setPaintedRegionColors(nextPainted);
      setFilledRegionIds(nextFilled);
      setHintRegionId(null);
      markTutorialActionTried('paint');
      emitCoopPaint(
        'FILL',
        newUndoEntries.map((u) => u.regionId),
        changedColors
      );
      setLifetimeStats(
        PlayerStatsService.recordRegionsColored(newUndoEntries.length, isCoopSessionActive())
      );
      SoundService.playRegionTap(cur.activeColorId);
      completePaintStroke(
        curPuzzle,
        nextFilled,
        nextPainted,
        cur.activeColorId,
        true,
        wasPuzzleIncomplete,
        cur.activeSnapshotId,
        cur.settings
      );
    },
    [
      completePaintStroke,
      emitCoopPaint,
      isCoopSessionActive,
      liveCoopRef,
      markTutorialActionTried,
      puzzle,
      regionByIdRef,
      setFilledRegionIds,
      setHintRegionId,
      setLifetimeStats,
      setPaintedRegionColors,
      syncRedoStack,
      syncUndoStack,
    ]
  );

  const attemptBatchFillRegions = useCallback(
    (regionIds: Set<number>) => {
      const cur = liveCoopRef.current;
      const curPuzzle = cur.puzzle;
      if (!curPuzzle || regionIds.size === 0) return;
      if (!canInteractDuringReplay(curPuzzle, cur.filledRegionIds.size)) return;

      const wasPuzzleIncomplete = cur.filledRegionIds.size < curPuzzle.regions.length;
      if (cur.isFreeColorMode) {
        batchFillFreeColorRegions(cur, curPuzzle, regionIds, wasPuzzleIncomplete);
        return;
      }

      const isEasy = cur.settings.difficulty === 'EASY';
      const isPaintMode = cur.settings.isPaintMode;
      const nextFilled = new Set(cur.filledRegionIds);
      const newUndoEntries: UndoHistoryEntry[] = [];
      let nextActiveColorId = cur.activeColorId;

      for (const rId of regionIds) {
        if (nextFilled.has(rId)) continue;
        const region = lookupRegion(curPuzzle, puzzle, regionByIdRef.current, rId);
        if (!region) continue;
        if (!isEasy && region.colorId !== cur.activeColorId) continue;

        if (isEasy && !isPaintMode && nextActiveColorId !== region.colorId) {
          nextActiveColorId = region.colorId;
          setActiveColorId(region.colorId);
        }
        nextFilled.add(rId);
        newUndoEntries.push({
          regionId: rId,
          wasPreviouslyFilled: false,
          paintedColorId: region.colorId,
        });
      }

      if (newUndoEntries.length === 0) return;

      syncUndoStack((prev) => [...prev, ...newUndoEntries]);
      syncRedoStack([]);
      liveCoopRef.current = {
        ...cur,
        filledRegionIds: nextFilled,
        activeColorId: nextActiveColorId,
      };
      setFilledRegionIds(nextFilled);
      setHintRegionId(null);
      markTutorialActionTried('paint');
      emitCoopPaint(
        'FILL',
        newUndoEntries.map((u) => u.regionId)
      );
      setLifetimeStats(
        PlayerStatsService.recordRegionsColored(newUndoEntries.length, isCoopSessionActive())
      );
      SoundService.playRegionTap(
        newUndoEntries[newUndoEntries.length - 1]?.paintedColorId ?? nextActiveColorId
      );
      completePaintStroke(
        curPuzzle,
        nextFilled,
        cur.paintedRegionColors,
        nextActiveColorId,
        cur.isFreeColorMode,
        wasPuzzleIncomplete,
        cur.activeSnapshotId,
        cur.settings
      );
    },
    [
      batchFillFreeColorRegions,
      canInteractDuringReplay,
      completePaintStroke,
      emitCoopPaint,
      isCoopSessionActive,
      liveCoopRef,
      markTutorialActionTried,
      puzzle,
      regionByIdRef,
      setActiveColorId,
      setFilledRegionIds,
      setHintRegionId,
      setLifetimeStats,
      syncRedoStack,
      syncUndoStack,
    ]
  );

  const persistPaletteMutation = useCallback(
    (
      cur: CoopLiveState,
      updatedPuzzle: PuzzleData,
      updatedPalette: PaletteColor[],
      regeneratePreview: boolean
    ) => {
      const curSnapshotId = cur.activeSnapshotId;
      if (!curSnapshotId) return;
      void StorageService.savePuzzleData(curSnapshotId, updatedPuzzle).catch((err) => {
        reportSwallowed('App.savePuzzleData', err, { id: curSnapshotId });
      });
      const curSourceImage = sourceImageRef.current;
      const previewUrl =
        regeneratePreview && curSourceImage
          ? generatePreviewDataUrl(
              updatedPuzzle,
              curSourceImage,
              cur.filledRegionIds,
              cur.paintedRegionColors
            )
          : undefined;
      const updated = StorageService.updateSnapshotProgress(
        curSnapshotId,
        cur.filledRegionIds.size,
        updatedPuzzle.regions.length,
        Array.from(cur.filledRegionIds),
        undefined,
        undefined,
        undefined,
        previewUrl,
        Object.fromEntries(cur.paintedRegionColors),
        updatedPalette,
        updatedPuzzle.isFreeColor
      );
      setSnapshots(updated);
    },
    [setSnapshots, sourceImageRef]
  );

  const handleAddCustomColor = useCallback(
    (hex: string) => {
      const cur = liveCoopRef.current;
      const curPuzzle = cur.puzzle;
      if (!curPuzzle) return;

      const parsed = parseHexToPaletteFields(hex);
      if (!parsed) return;

      const nextId = computeNextCustomColorId(curPuzzle.palette);
      const newColor: PaletteColor = { id: nextId, ...parsed };
      const updatedPalette = [...curPuzzle.palette, newColor];
      const updatedPuzzle = { ...curPuzzle, palette: updatedPalette };
      liveCoopRef.current = {
        ...cur,
        puzzle: updatedPuzzle,
        activeColorId: nextId,
      };
      setPuzzle(updatedPuzzle);
      setActiveColorId(nextId);
      NativeBridge.haptic('tick', cur.settings.hapticsEnabled);
      persistPaletteMutation(cur, updatedPuzzle, updatedPalette, false);
    },
    [liveCoopRef, persistPaletteMutation, setActiveColorId, setPuzzle]
  );

  const handleUpdateColor = useCallback(
    (colorId: number, hex: string) => {
      const cur = liveCoopRef.current;
      const curPuzzle = cur.puzzle;
      if (!curPuzzle) return;

      const existing = curPuzzle.palette.find((c) => c.id === colorId);
      if (!existing) return;

      const parsed = parseHexToPaletteFields(hex);
      if (!parsed) return;
      if (existing.hex.toLowerCase() === parsed.hex && existing.argb === parsed.argb) {
        return;
      }

      const updatedPalette = curPuzzle.palette.map((c) =>
        c.id === colorId ? { ...c, ...parsed } : c
      );
      const updatedPuzzle = { ...curPuzzle, palette: updatedPalette };
      liveCoopRef.current = { ...cur, puzzle: updatedPuzzle };
      setPuzzle(updatedPuzzle);
      NativeBridge.haptic('tick', cur.settings.hapticsEnabled);
      persistPaletteMutation(cur, updatedPuzzle, updatedPalette, true);
    },
    [liveCoopRef, persistPaletteMutation, setPuzzle]
  );

  const handleApplyPresetPalette = useCallback(
    (preset: PalettePreset) => {
      const cur = liveCoopRef.current;
      const curPuzzle = cur.puzzle;
      if (!curPuzzle || !preset || !Array.isArray(preset.colors) || preset.colors.length === 0) {
        return;
      }

      const parsedColors: ParsedPaletteFields[] = [];
      for (let i = 0; i < preset.colors.length; i++) {
        const parsed = parseHexToPaletteFields(preset.colors[i]);
        if (parsed) {
          parsedColors.push(parsed);
        }
      }
      if (parsedColors.length === 0) return;

      const updatedPalette = curPuzzle.palette.map((c, i) => ({
        ...c,
        ...parsedColors[i % parsedColors.length],
      }));
      const updatedPuzzle = { ...curPuzzle, palette: updatedPalette };
      liveCoopRef.current = { ...cur, puzzle: updatedPuzzle };
      setPuzzle(updatedPuzzle);
      NativeBridge.haptic('success', cur.settings.hapticsEnabled);
      persistPaletteMutation(cur, updatedPuzzle, updatedPalette, true);
    },
    [liveCoopRef, persistPaletteMutation, setPuzzle]
  );

  const triggerHint = useCallback(
    (colorId?: number) => {
      const cur = liveCoopRef.current;
      const curPuzzle = cur.puzzle;
      if (!curPuzzle) return;

      const targetColor = colorId ?? cur.activeColorId;
      const target = selectHintTargetRegion(
        curPuzzle.regions,
        targetColor,
        cur.filledRegionIds,
        visibleRegionIdsRef.current
      );
      if (!target) return;

      if (colorId !== undefined && cur.activeColorId !== colorId) {
        liveCoopRef.current = { ...cur, activeColorId: colorId };
        setActiveColorId(colorId);
      }

      NativeBridge.haptic('warning', cur.settings.hapticsEnabled);
      hintsUsedInSessionRef.current += 1;
      setHintRegionId(target.id);
      markTutorialActionTried('hint');
    },
    [liveCoopRef, markTutorialActionTried, setActiveColorId, setHintRegionId, visibleRegionIdsRef]
  );

  const handleSyncActiveColor = useCallback(
    (colId: number) => {
      liveCoopRef.current = { ...liveCoopRef.current, activeColorId: colId };
      setActiveColorId(colId);
    },
    [liveCoopRef, setActiveColorId]
  );

  return {
    resetActivePuzzleSessionStats,
    attemptFillRegion,
    attemptBatchFillRegions,
    handleAddCustomColor,
    handleUpdateColor,
    handleApplyPresetPalette,
    triggerHint,
    handleSyncActiveColor,
  };
}
