import { PaletteColor, PuzzleData, UserSettings } from '../types';
import { getDockPalette, getVisiblePalette } from '../components/PaletteDock';
import { getAllPuzzleRegions, getTotalRegionCount } from '../engine/UnifiedPuzzleLayers';

export interface PaintStrokeViewport {
  zoomScale: number;
  panOffsetX: number;
  panOffsetY: number;
}

export interface FinishPaintStrokeParams {
  puzzle: PuzzleData;
  nextFilled: Set<number>;
  paintedRegionColors: Map<number, number>;
  activeColorId: number;
  isFreeColorMode: boolean;
  wasPuzzleIncomplete: boolean;
  snapshotId: string | null;
  settings: Pick<
    UserSettings,
    'hapticsEnabled' | 'reducedMotion' | 'autoAdvance' | 'paletteSort' | 'prioritizeOnScreen'
  >;
  viewport: PaintStrokeViewport;
  visibleColorIds: Set<number>;
  /**
   * Optional color ID of the single filled region in standard mode.
   * When provided and no unfilled regions remain for this color, triggers a
   * 'success' haptic even before full puzzle completion.
   */
  filledRegionColorId?: number;
}

export interface FinishPaintStrokeEffects<TSnapshot = unknown> {
  onRecordFirstTimeCompletion: (
    wasIncomplete: boolean,
    isNowComplete: boolean,
    snapshotId: string | null
  ) => void;
  onHaptic: (type: 'tick' | 'success', enabled: boolean) => void;
  onConfetti: () => void;
  onStartReplay: (orderedRegionIds: number[]) => void;
  onActiveColorAutoAdvanced: (nextColorId: number) => void;
  onUpdateSnapshotProgress: (
    snapshotId: string,
    filledCount: number,
    totalCount: number,
    filledRegionIds: number[],
    zoomScale: number,
    panOffsetX: number,
    panOffsetY: number,
    customPaintedColors: Record<number, number> | undefined,
    customPalette: PaletteColor[] | undefined,
    isFreeColor: boolean | undefined
  ) => TSnapshot[];
  onSetSnapshots: (snapshots: TSnapshot[]) => void;
  onSaveActiveState: (state: {
    activeSnapshotId: string;
    activeColorId: number;
    filledRegionIds: number[];
    paintedRegionColors: Record<number, number> | undefined;
    isFreeColorMode: boolean;
    zoomScale: number;
    panOffsetX: number;
    panOffsetY: number;
  }) => void;
}

export interface FinishPaintStrokeResult {
  orderedFilledRegionIds: number[];
  isComplete: boolean;
  nextActiveColorId: number;
  didAutoAdvance: boolean;
  hapticType: 'tick' | 'success';
}

function isColorCompletedInPuzzle(
  regions: PuzzleData['regions'],
  nextFilled: Set<number>,
  colorId: number
): boolean {
  let matchingColorRegions = 0;
  for (let i = 0; i < regions.length; i += 1) {
    const region = regions[i];
    if (region.colorId === colorId) {
      matchingColorRegions += 1;
      if (!nextFilled.has(region.id)) {
        return false;
      }
    }
  }
  return matchingColorRegions > 0;
}

/**
 * Shared post-stroke completion, haptic, confetti, replay, auto-advance, and
 * snapshot/session persistence routine used by both single-region and batch
 * paint strokes across Free Colour and Standard modes.
 *
 * Preserves the viewport untouched on completion (zero viewport movement).
 */
export function finishPaintStroke<TSnapshot = unknown>(
  params: FinishPaintStrokeParams,
  effects: FinishPaintStrokeEffects<TSnapshot>
): FinishPaintStrokeResult {
  const {
    puzzle,
    nextFilled,
    paintedRegionColors,
    activeColorId,
    isFreeColorMode,
    wasPuzzleIncomplete,
    snapshotId,
    settings,
    viewport,
    visibleColorIds,
    filledRegionColorId,
  } = params;

  const allRegions = getAllPuzzleRegions(puzzle);
  const totalRegionCount = getTotalRegionCount(puzzle);
  const orderedFilledRegionIds = Array.from(nextFilled);
  const isComplete = totalRegionCount > 0 && nextFilled.size >= totalRegionCount;

  const isFilledColorComplete =
    totalRegionCount > 0 &&
    !isFreeColorMode &&
    !isComplete &&
    filledRegionColorId !== undefined &&
    isColorCompletedInPuzzle(allRegions, nextFilled, filledRegionColorId);

  const hapticType: 'tick' | 'success' =
    isComplete || isFilledColorComplete ? 'success' : 'tick';

  if (isComplete) {
    effects.onRecordFirstTimeCompletion(wasPuzzleIncomplete, true, snapshotId);
    effects.onHaptic('success', settings.hapticsEnabled);
    if (!settings.reducedMotion) {
      effects.onConfetti();
    }
    effects.onStartReplay(orderedFilledRegionIds);
  } else {
    effects.onHaptic(hapticType, settings.hapticsEnabled);
  }

  let nextActiveColorId = activeColorId;
  let didAutoAdvance = false;

  if (totalRegionCount > 0 && !isFreeColorMode && settings.autoAdvance && !isComplete) {
    const hasRemainingForCurrent = allRegions.some(
      (r) => r.colorId === nextActiveColorId && !nextFilled.has(r.id)
    );
    if (!hasRemainingForCurrent) {
      const basePalette = getVisiblePalette(
        puzzle.palette,
        allRegions,
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
        nextActiveColorId = nextCol.id;
        didAutoAdvance = true;
        effects.onActiveColorAutoAdvanced(nextCol.id);
      }
    }
  }

  if (snapshotId) {
    const { zoomScale, panOffsetX, panOffsetY } = viewport;
    const paintedObj = isFreeColorMode
      ? Object.fromEntries(paintedRegionColors)
      : paintedRegionColors.size > 0
        ? Object.fromEntries(paintedRegionColors)
        : undefined;
    const updated = effects.onUpdateSnapshotProgress(
      snapshotId,
      nextFilled.size,
      totalRegionCount,
      orderedFilledRegionIds,
      zoomScale,
      panOffsetX,
      panOffsetY,
      paintedObj,
      isFreeColorMode ? puzzle.palette : undefined,
      isFreeColorMode ? puzzle.isFreeColor : undefined
    );
    effects.onSetSnapshots(updated);
    effects.onSaveActiveState({
      activeSnapshotId: snapshotId,
      activeColorId: nextActiveColorId,
      filledRegionIds: orderedFilledRegionIds,
      paintedRegionColors: paintedObj,
      isFreeColorMode,
      zoomScale,
      panOffsetX,
      panOffsetY,
    });
  }

  return {
    orderedFilledRegionIds,
    isComplete,
    nextActiveColorId,
    didAutoAdvance,
    hapticType,
  };
}
