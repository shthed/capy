import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
import {
  BLOOM_KIND_SWATCH_SHIMMER,
  COOP_RIPPLE_DURATION_MS,
  CoopRippleBuffer,
  FILL_BLOOM_DURATION_MS,
  FillBloomBuffer,
  MAX_COOP_RIPPLES,
  MAX_FILL_BLOOMS,
  SWATCH_SHIMMER_DURATION_MS,
} from '../engine/CoopRippleBuffer';
import {
  CANVAS_BG_MAP,
  CanvasBgColor,
  HintFillStyle,
  PaletteColor,
  PaletteSortOrder,
  PuzzleData,
  Region,
  RegionColorMode,
  RegionHighlightStyle,
} from '../types';

interface PuzzleCanvasProps {
  puzzle: PuzzleData | null;
  sourceImage: HTMLImageElement | null;
  activeColorId: number;
  filledRegionIds: Set<number>;
  hintRegionId: number | null;
  isPreviewMode: boolean;
  isPaintMode: boolean;
  isFreeColorMode?: boolean;
  paintedRegionColors?: Map<number, number>;
  canvasBgColor: CanvasBgColor;
  canvasBgArgb: number;
  sortOrder: PaletteSortOrder;
  regionColorMode: RegionColorMode;
  showRegionLabels: boolean;
  showPreviewLabels: boolean;
  showPreviewBorders: boolean;
  labelScale: number;
  minLabelSize?: number;
  maxLabelSize?: number;
  highlightMatching: boolean;
  highlightStyle: RegionHighlightStyle;
  hintColorArgb: number;
  hintFillStyle: HintFillStyle;
  animateHint: boolean;
  showNextRegionHint: boolean;
  hintIntensity: number;
  panMomentum?: boolean;
  reverseDoubleTapZoom?: boolean;
  zoomSensitivity?: number;
  snapZoomLevels?: boolean;
  showMagnifierLoupe?: boolean;
  reducedMotion?: boolean;
  displayNumberMap: Map<number, string>;
  zoomInTrigger?: number;
  zoomOutTrigger?: number;
  stepZoomTrigger?: number;
  resetViewTrigger?: number;
  restoreViewTrigger?: number;
  panStepRequest?: { seq: number; dx: number; dy: number };
  initialZoomScale?: number;
  initialPanOffsetX?: number;
  initialPanOffsetY?: number;
  isGenerating?: boolean;
  detailedProgress?: boolean;
  generationProgress?: number;
  generationStepIndex?: number;
  replayFollowRegionId?: number | null;
  replayFollowSequence?: number[] | null;
  replayFollowStep?: number;
  replaySpeed?: number;
  coopRippleBuffer?: CoopRippleBuffer;
  fillBloomBuffer?: FillBloomBuffer;
  onViewExtentChanged?: (
    zoom: number,
    panX: number,
    panY: number,
    containerWidth?: number,
    containerHeight?: number
  ) => void;
  onManualPanStart?: () => void;
  onRegionClicked: (regionId: number) => void;
  onBatchRegionsClicked: (regionIds: Set<number>) => void;
  onVisibleColorsChanged: (colorIds: Set<number>) => void;
  onVisibleRegionsChanged: (regionIds: Set<number>) => void;
  onTogglePreview: () => void;
}

export const ZOOM_DETENT_STOPS = [1, 2, 4, 8, 12] as const;
const ZOOM_SNAP_TOLERANCE = 0.04;

export const LOUPE_MAGNIFICATION = 2.5;
export const LOUPE_OFFSET_Y_PX = 72;
export const LOUPE_TOP_FLIP_THRESHOLD_PX = 96;
export const LOUPE_RADIUS_PX = 44;
export const LOUPE_HOLD_DELAY_MS = 220;

export interface LoupePosition {
  x: number;
  y: number;
  flippedBelow: boolean;
}

/**
 * Computes floating circular Precision Loupe center in container CSS pixels:
 * - Defaults `72px` above the active finger (`pointerY - 72`).
 * - Flips cleanly below (`pointerY + 72`) whenever `pointerY < 96` so top HUD bars and the
 *   viewport edge never clip the lens offscreen.
 * - Clamps inside `[radius + 8 .. containerDim - radius - 8]` with optional `out` struct for zero allocations.
 */
export function computeLoupePosition(
  pointerX: number,
  pointerY: number,
  containerWidth: number,
  containerHeight: number,
  radius: number = LOUPE_RADIUS_PX,
  out?: LoupePosition
): LoupePosition {
  const margin = 8;
  const minX = Math.min(containerWidth / 2, radius + margin);
  const maxX = Math.max(minX, containerWidth - radius - margin);
  const minY = Math.min(containerHeight / 2, radius + margin);
  const maxY = Math.max(minY, containerHeight - radius - margin);

  const flippedBelow = pointerY < LOUPE_TOP_FLIP_THRESHOLD_PX;
  const rawY = flippedBelow ? pointerY + LOUPE_OFFSET_Y_PX : pointerY - LOUPE_OFFSET_Y_PX;
  const cx = Math.max(minX, Math.min(maxX, pointerX));
  const cy = Math.max(minY, Math.min(maxY, rawY));

  if (out) {
    out.x = cx;
    out.y = cy;
    out.flippedBelow = flippedBelow;
    return out;
  }
  return { x: cx, y: cy, flippedBelow };
}

/**
 * Snaps relative zoom scale to the nearest magnetic stop (1x, 2x, 4x, 8x, 12x)
 * whenever snapEnabled is true and rawScale falls within +-4% of a stop.
 */
export function applyZoomSnapDetent(rawScale: number, snapEnabled: boolean): number {
  if (!snapEnabled) return rawScale;
  for (let i = 0; i < ZOOM_DETENT_STOPS.length; i++) {
    const stop = ZOOM_DETENT_STOPS[i];
    if (Math.abs(rawScale - stop) <= stop * ZOOM_SNAP_TOLERANCE) {
      return stop;
    }
  }
  return rawScale;
}

/**
 * Returns the next discrete relative zoom stop in [1, 2, 4, 8, 12],
 * wrapping back to 1x once at or past 12x.
 */
export function getNextZoomStop(currentScale: number): number {
  for (let i = 0; i < ZOOM_DETENT_STOPS.length; i++) {
    const stop = ZOOM_DETENT_STOPS[i];
    if (stop > currentScale * (1 + ZOOM_SNAP_TOLERANCE)) {
      return stop;
    }
  }
  return ZOOM_DETENT_STOPS[0];
}

/**
 * Strict viewport bounding for pan/zoom offsets.
 * Guarantees that the artwork cannot be panned away into empty void
 * while allowing full edge-to-edge navigation when zoomed in.
 */
export function clampCanvasOffset(
  rawOffset: { x: number; y: number },
  scale: number,
  puzzleWidth: number,
  puzzleHeight: number,
  containerWidth: number,
  containerHeight: number,
  out?: { x: number; y: number }
): { x: number; y: number } {
  if (containerWidth <= 0 || containerHeight <= 0 || puzzleWidth <= 0 || puzzleHeight <= 0) {
    if (out) {
      out.x = rawOffset.x;
      out.y = rawOffset.y;
      return out;
    }
    return rawOffset;
  }

  const baseScale = Math.min(containerWidth / puzzleWidth, containerHeight / puzzleHeight) * 0.92;
  const effScale = scale * baseScale;
  const artW = puzzleWidth * effScale;
  const artH = puzzleHeight * effScale;
  const baseOffsetX = (containerWidth - puzzleWidth * baseScale) / 2;
  const baseOffsetY = (containerHeight - puzzleHeight * baseScale) / 2;

  // Generous boundary margin: allows panning corners deep into view past the viewport center
  const isZoomed = scale > 1.05;
  const marginX = isZoomed ? containerWidth * 0.72 : containerWidth * 0.45;
  const marginY = isZoomed ? containerHeight * 0.72 : containerHeight * 0.45;

  const centeredOffsetX = (containerWidth - artW) / 2 - baseOffsetX;
  const centeredOffsetY = (containerHeight - artH) / 2 - baseOffsetY;

  let minOffsetX: number;
  let maxOffsetX: number;
  let minOffsetY: number;
  let maxOffsetY: number;

  if (artW <= containerWidth) {
    minOffsetX = centeredOffsetX - marginX;
    maxOffsetX = centeredOffsetX + marginX;
  } else {
    minOffsetX = containerWidth - marginX - baseOffsetX - artW;
    maxOffsetX = marginX - baseOffsetX;
  }

  if (artH <= containerHeight) {
    minOffsetY = centeredOffsetY - marginY;
    maxOffsetY = centeredOffsetY + marginY;
  } else {
    minOffsetY = containerHeight - marginY - baseOffsetY - artH;
    maxOffsetY = marginY - baseOffsetY;
  }

  const cx = Math.max(minOffsetX, Math.min(maxOffsetX, rawOffset.x));
  const cy = Math.max(minOffsetY, Math.min(maxOffsetY, rawOffset.y));
  if (out) {
    out.x = cx;
    out.y = cy;
    return out;
  }
  return { x: cx, y: cy };
}

export const PuzzleCanvas: React.FC<PuzzleCanvasProps> = ({
  puzzle,
  sourceImage,
  activeColorId,
  filledRegionIds,
  hintRegionId,
  isPreviewMode,
  isPaintMode,
  isFreeColorMode = false,
  paintedRegionColors,
  canvasBgColor,
  canvasBgArgb,
  regionColorMode,
  showRegionLabels,
  showPreviewLabels,
  showPreviewBorders,
  labelScale,
  minLabelSize = 6,
  maxLabelSize = 18,
  highlightMatching,
  highlightStyle,
  hintColorArgb,
  hintFillStyle,
  animateHint,
  showNextRegionHint,
  hintIntensity,
  panMomentum = true,
  reverseDoubleTapZoom = false,
  zoomSensitivity = 1.0,
  snapZoomLevels = false,
  showMagnifierLoupe = true,
  reducedMotion = false,
  displayNumberMap,
  zoomInTrigger = 0,
  zoomOutTrigger = 0,
  stepZoomTrigger = 0,
  resetViewTrigger = 0,
  restoreViewTrigger = 0,
  panStepRequest,
  initialZoomScale = 1.0,
  initialPanOffsetX = 0,
  initialPanOffsetY = 0,
  isGenerating = false,
  detailedProgress = false,
  generationProgress = 0,
  generationStepIndex = 1,
  replayFollowRegionId = null,
  replayFollowSequence = null,
  replayFollowStep = 0,
  replaySpeed = 1,
  coopRippleBuffer,
  fillBloomBuffer,
  onViewExtentChanged,
  onManualPanStart,
  onRegionClicked,
  onBatchRegionsClicked,
  onVisibleColorsChanged,
  onVisibleRegionsChanged,
  onTogglePreview,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Offscreen cached layer canvases (prevents 60 FPS full-pixel iteration)
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseImageDataRef = useRef<ImageData | null>(null);
  const paintedCacheRef = useRef<Set<number>>(new Set());
  const completedSwatchesCacheRef = useRef<Set<number>>(new Set());
  const internalFillBloomBufferRef = useRef<FillBloomBuffer>(new FillBloomBuffer());
  const activeFillBloomBuffer = fillBloomBuffer ?? internalFillBloomBufferRef.current;
  const sourcePixelsRef = useRef<Uint8ClampedArray | null>(null);
  const regionByIdRef = useRef<Map<number, Region>>(new Map());
  const paletteByIdRef = useRef<Map<number, PaletteColor>>(new Map());
  const lastBasePuzzleRef = useRef<PuzzleData | null>(null);
  const lastBaseModeRef = useRef<RegionColorMode | null>(null);
  const lastBaseImageRef = useRef<HTMLImageElement | null>(null);
  const lastBaseFreeColorRef = useRef<boolean>(false);
  const prevColorsRef = useRef<Map<number, number>>(new Map());

  const highlightCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasHighlightPixelsRef = useRef<boolean>(false);
  const borderCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastBorderPuzzleRef = useRef<PuzzleData | null>(null);

  // Transform state
  const [scale, setScale] = useState(initialZoomScale);
  const [offset, setOffset] = useState({ x: initialPanOffsetX, y: initialPanOffsetY });
  const scaleRef = useRef(initialZoomScale);
  const offsetRef = useRef({ x: initialPanOffsetX, y: initialPanOffsetY });
  scaleRef.current = scale;
  offsetRef.current = offset;

  const effectiveZoomSensitivity = Math.min(
    2.0,
    Math.max(0.5, Number.isFinite(zoomSensitivity) ? zoomSensitivity : 1.0)
  );
  const effectiveZoomSensitivityRef = useRef(effectiveZoomSensitivity);
  const snapZoomLevelsRef = useRef(snapZoomLevels);
  const showMagnifierLoupeRef = useRef(showMagnifierLoupe);
  const reducedMotionRef = useRef(reducedMotion);
  effectiveZoomSensitivityRef.current = effectiveZoomSensitivity;
  snapZoomLevelsRef.current = snapZoomLevels;
  showMagnifierLoupeRef.current = showMagnifierLoupe;
  reducedMotionRef.current = reducedMotion;

  // Pre-allocated scratch structs for zero-allocation Precision Loupe & gesture math
  const loupeStateRef = useRef<{ active: boolean; screenX: number; screenY: number }>({
    active: false,
    screenX: 0,
    screenY: 0,
  });
  const loupePosScratchRef = useRef<LoupePosition>({ x: 0, y: 0, flippedBelow: false });
  const loupeHoldTimerRef = useRef<number | null>(null);
  const isLoupeHoldTargetingRef = useRef<boolean>(false);
  const loupeDrawRafRef = useRef<number>(0);

  // Pre-allocated scratch vectors for zero-allocation hot zoom/pan gesture math
  const gestureRawOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const gestureClampedOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Interactive feedback
  const [tapDot, setTapDot] = useState<{ x: number; y: number; alpha: number } | null>(null);

  // Animation pulse (stored in ref to avoid 60 FPS React state reconciliation)
  const pulseAlphaRef = useRef(0.7);

  // Drag & Pinch interaction tracking
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastPointerPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const totalDragDistanceRef = useRef(0);
  const isRightClickRef = useRef(false);
  const touchStartDistRef = useRef<number | null>(null);
  const initialTouchCenterRef = useRef<{ x: number; y: number } | null>(null);
  const initialTouchScaleRef = useRef(1);
  const initialTouchOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const wasPinchingRef = useRef(false);
  const isPinchPanningRef = useRef(false);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const touchPointerCountRef = useRef(0);

  // One-finger double-tap-and-drag zoom tracking (Google Maps style)
  const lastTapUpTimeRef = useRef(0);
  const lastTapUpPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isDoubleTapCandidateRef = useRef(false);
  const isOneFingerZoomingRef = useRef(false);
  const isDoubleTapPanningRef = useRef(false);
  const doubleTapFocalRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragZoomStartYRef = useRef(0);
  const initialDragZoomScaleRef = useRef(1);
  const initialDragZoomOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isTouchingOutsideImageRef = useRef(false);

  // Smooth Pan Momentum tracking (Google Maps style inertial gliding)
  const pointerHistoryRef = useRef<Array<{ x: number; y: number; time: number }>>([]);
  const momentumAnimIdRef = useRef<number | null>(null);

  const stopMomentum = useCallback(() => {
    if (momentumAnimIdRef.current !== null) {
      cancelAnimationFrame(momentumAnimIdRef.current);
      momentumAnimIdRef.current = null;
    }
  }, []);

  const cancelLoupeHoldTimer = useCallback(() => {
    if (loupeHoldTimerRef.current !== null) {
      window.clearTimeout(loupeHoldTimerRef.current);
      loupeHoldTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopMomentum();
      cancelLoupeHoldTimer();
      if (loupeDrawRafRef.current !== 0) {
        cancelAnimationFrame(loupeDrawRafRef.current);
        loupeDrawRafRef.current = 0;
      }
    };
  }, [stopMomentum, cancelLoupeHoldTimer]);

  // Reset or restore zoom/offset when a brand-new puzzle geometry is loaded or viewport restoration triggers
  useEffect(() => {
    stopMomentum();
    let targetOffset = { x: initialPanOffsetX, y: initialPanOffsetY };
    const w = containerRef.current?.clientWidth || window.innerWidth;
    const h = containerRef.current?.clientHeight || window.innerHeight;
    if (containerRef.current && puzzle && w > 0 && h > 0) {
      targetOffset = clampCanvasOffset(
        targetOffset,
        initialZoomScale,
        puzzle.width,
        puzzle.height,
        w,
        h
      );
    }
    scaleRef.current = initialZoomScale;
    offsetRef.current = targetOffset;
    setScale(initialZoomScale);
    setOffset(targetOffset);
    onViewExtentChangedRef.current?.(initialZoomScale, targetOffset.x, targetOffset.y, w, h);
  }, [puzzle?.regionMap, initialZoomScale, initialPanOffsetX, initialPanOffsetY, restoreViewTrigger, stopMomentum]);

  // Handle FloatingActions & keyboard zoom in/out triggers synchronously on discrete events
  useIsomorphicLayoutEffect(() => {
    if (zoomInTrigger <= 0 || !containerRef.current || !puzzle) return;
    const currentScale = scaleRef.current;
    const currentOffset = offsetRef.current;
    const rawScale = Math.min(12.0, currentScale * Math.pow(1.25, effectiveZoomSensitivityRef.current));
    const newScale = applyZoomSnapDetent(rawScale, snapZoomLevelsRef.current);
    const actualZoom = newScale / currentScale;
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
    const baseOffsetX = (w - puzzle.width * baseScale) / 2;
    const baseOffsetY = (h - puzzle.height * baseScale) / 2;

    const focalX = w / 2 - (currentOffset.x + baseOffsetX);
    const focalY = h / 2 - (currentOffset.y + baseOffsetY);
    const targetOffset = {
      x: currentOffset.x - focalX * (actualZoom - 1),
      y: currentOffset.y - focalY * (actualZoom - 1),
    };
    const clamped = clampCanvasOffset(targetOffset, newScale, puzzle.width, puzzle.height, w, h);
    scaleRef.current = newScale;
    offsetRef.current = clamped;
    setScale(newScale);
    setOffset(clamped);
    onViewExtentChangedRef.current?.(newScale, clamped.x, clamped.y, w, h);
  }, [zoomInTrigger]);

  useIsomorphicLayoutEffect(() => {
    if (zoomOutTrigger <= 0 || !containerRef.current || !puzzle) return;
    const currentScale = scaleRef.current;
    const currentOffset = offsetRef.current;
    const rawScale = Math.max(0.5, currentScale * Math.pow(0.8, effectiveZoomSensitivityRef.current));
    const newScale = applyZoomSnapDetent(rawScale, snapZoomLevelsRef.current);
    const actualZoom = newScale / currentScale;
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
    const baseOffsetX = (w - puzzle.width * baseScale) / 2;
    const baseOffsetY = (h - puzzle.height * baseScale) / 2;

    const focalX = w / 2 - (currentOffset.x + baseOffsetX);
    const focalY = h / 2 - (currentOffset.y + baseOffsetY);
    const targetOffset = {
      x: currentOffset.x - focalX * (actualZoom - 1),
      y: currentOffset.y - focalY * (actualZoom - 1),
    };
    const clamped = clampCanvasOffset(targetOffset, newScale, puzzle.width, puzzle.height, w, h);
    scaleRef.current = newScale;
    offsetRef.current = clamped;
    setScale(newScale);
    setOffset(clamped);
    onViewExtentChangedRef.current?.(newScale, clamped.x, clamped.y, w, h);
  }, [zoomOutTrigger]);

  // Handle GameTopBar zoom badge tap stepping through [1x, 2x, 4x, 8x, 12x] anchored at viewport center
  useIsomorphicLayoutEffect(() => {
    if (stepZoomTrigger <= 0 || !containerRef.current || !puzzle) return;
    stopMomentum();
    const currentScale = scaleRef.current;
    const currentOffset = offsetRef.current;
    const newScale = getNextZoomStop(currentScale);
    const actualZoom = newScale / currentScale;
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
    const baseOffsetX = (w - puzzle.width * baseScale) / 2;
    const baseOffsetY = (h - puzzle.height * baseScale) / 2;

    const focalX = w / 2 - (currentOffset.x + baseOffsetX);
    const focalY = h / 2 - (currentOffset.y + baseOffsetY);
    const targetOffset = {
      x: currentOffset.x - focalX * (actualZoom - 1),
      y: currentOffset.y - focalY * (actualZoom - 1),
    };
    const clamped = clampCanvasOffset(targetOffset, newScale, puzzle.width, puzzle.height, w, h);
    scaleRef.current = newScale;
    offsetRef.current = clamped;
    setScale(newScale);
    setOffset(clamped);
    onViewExtentChangedRef.current?.(newScale, clamped.x, clamped.y, w, h);
  }, [stepZoomTrigger, stopMomentum]);

  useIsomorphicLayoutEffect(() => {
    if (resetViewTrigger <= 0) return;
    stopMomentum();
    const startScale = scaleRef.current;
    const startOffset = { ...offsetRef.current };
    const w = containerRef.current?.clientWidth || window.innerWidth;
    const h = containerRef.current?.clientHeight || window.innerHeight;
    if (
      reducedMotionRef.current ||
      (Math.abs(startScale - 1.0) < 0.01 && Math.hypot(startOffset.x, startOffset.y) < 1)
    ) {
      scaleRef.current = 1.0;
      offsetRef.current = { x: 0, y: 0 };
      setScale(1.0);
      setOffset({ x: 0, y: 0 });
      onViewExtentChangedRef.current?.(1.0, 0, 0, w, h);
      return;
    }

    let animId: number;
    const duration = 280;
    const startTime = performance.now();

    const stepZoomOut = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const ease = 1 - Math.pow(1 - t, 3); // Cubic ease-out
      const nextScale = startScale + (1.0 - startScale) * ease;
      const nextOffset = {
        x: startOffset.x * (1 - ease),
        y: startOffset.y * (1 - ease),
      };
      scaleRef.current = nextScale;
      offsetRef.current = nextOffset;
      setScale(nextScale);
      setOffset(nextOffset);
      onViewExtentChangedRef.current?.(nextScale, nextOffset.x, nextOffset.y, w, h);
      if (t < 1) {
        animId = requestAnimationFrame(stepZoomOut);
      }
    };

    animId = requestAnimationFrame(stepZoomOut);
    return () => cancelAnimationFrame(animId);
  }, [resetViewTrigger, stopMomentum]);

  // Handle crisp keyboard pan steps (Arrow keys / WASD) clamped via clampCanvasOffset
  useIsomorphicLayoutEffect(() => {
    if (!panStepRequest || panStepRequest.seq <= 0 || !containerRef.current || !puzzle) return;
    stopMomentum();
    onManualPanStartRef.current?.();
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    if (w <= 0 || h <= 0) return;
    const cur = offsetRef.current;
    const clamped = clampCanvasOffset(
      { x: cur.x + panStepRequest.dx, y: cur.y + panStepRequest.dy },
      scaleRef.current,
      puzzle.width,
      puzzle.height,
      w,
      h
    );
    offsetRef.current = clamped;
    setOffset(clamped);
    onViewExtentChangedRef.current?.(scaleRef.current, clamped.x, clamped.y, w, h);
  }, [panStepRequest, stopMomentum]);

  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  // Ensure offset is strictly clamped whenever scale, puzzle, or container size changes
  useEffect(() => {
    if (!containerRef.current || !puzzle) return;
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    if (w <= 0 || h <= 0) return;
    setOffset((prev) => {
      const clamped = clampCanvasOffset(prev, scaleRef.current, puzzle.width, puzzle.height, w, h);
      offsetRef.current = clamped;
      return clamped.x === prev.x && clamped.y === prev.y ? prev : clamped;
    });
  }, [scale, puzzle, containerSize]);

  // Smooth predictive camera controller for Replay Follow Mode:
  // - Safe-frame dead-zone: never moves the viewport while upcoming regions remain comfortably inside the screen
  // - Predictive lookahead: anticipates upcoming region completions (up to 10 steps ahead) to frame clusters in a single glide
  // - Critically-damped 2D spring-damper (SmoothDamp): C1-continuous velocity with smooth ease-in and ease-out (zero jerk)
  const onManualPanStartRef = useRef(onManualPanStart);
  onManualPanStartRef.current = onManualPanStart;
  const hasNotifiedManualPanRef = useRef(false);
  const replayFollowRegionIdRef = useRef<number | null>(replayFollowRegionId ?? null);
  replayFollowRegionIdRef.current = replayFollowRegionId ?? null;
  const replayFollowSequenceRef = useRef<number[] | null>(replayFollowSequence ?? null);
  replayFollowSequenceRef.current = replayFollowSequence ?? null;
  const replayFollowStepRef = useRef<number>(replayFollowStep ?? 0);
  replayFollowStepRef.current = replayFollowStep ?? 0;
  const replaySpeedRef = useRef<number>(replaySpeed || 1);
  replaySpeedRef.current = replaySpeed || 1;
  const followRawScratchRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const followClampedScratchRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const followAnchorOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const followVelRef = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });
  const isFollowingReplay = replayFollowRegionId !== null && replayFollowRegionId !== undefined;
  const isSmoothFollowingReplay = isFollowingReplay && !reducedMotion;

  // Reduced-motion Replay Follow: snap directly without multi-frame SmoothDamp glide or rAF loop
  useEffect(() => {
    if (!isFollowingReplay || !reducedMotion || !puzzle || !containerRef.current) return;
    if (replayFollowRegionId === null || replayFollowRegionId === undefined) return;
    const isUserInteracting =
      isDraggingRef.current ||
      activePointersRef.current.size > 0 ||
      isOneFingerZoomingRef.current ||
      isDoubleTapPanningRef.current;
    if (isUserInteracting) return;

    const curScale = scaleRef.current;
    const reg = regionByIdRef.current.get(replayFollowRegionId);
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    if (!reg || w <= 0 || h <= 0 || curScale <= 1.05) return;

    const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
    const baseOffsetX = (w - puzzle.width * baseScale) / 2;
    const baseOffsetY = (h - puzzle.height * baseScale) / 2;
    const effScale = curScale * baseScale;
    const safeLeft = w * 0.18;
    const safeRight = w * 0.82;
    const safeTop = Math.max(68, h * 0.18);
    const safeBottom = h - Math.max(92, h * 0.22);
    const curOff = offsetRef.current;
    const regScreenX = curOff.x + baseOffsetX + reg.centroidX * effScale;
    const regScreenY = curOff.y + baseOffsetY + reg.centroidY * effScale;
    if (
      regScreenX < safeLeft ||
      regScreenX > safeRight ||
      regScreenY < safeTop ||
      regScreenY > safeBottom
    ) {
      const safeCenterX = w * 0.5;
      const safeCenterY = (safeTop + safeBottom) * 0.5;
      const clamped = clampCanvasOffset(
        {
          x: safeCenterX - baseOffsetX - reg.centroidX * effScale,
          y: safeCenterY - baseOffsetY - reg.centroidY * effScale,
        },
        curScale,
        puzzle.width,
        puzzle.height,
        w,
        h
      );
      offsetRef.current = clamped;
      setOffset(clamped);
      onViewExtentChangedRef.current?.(curScale, clamped.x, clamped.y, w, h);
    }
  }, [isFollowingReplay, reducedMotion, puzzle, replayFollowRegionId]);

  useEffect(() => {
    if (!isSmoothFollowingReplay || !puzzle) return;
    let animId: number;
    let lastTime = performance.now();

    // Initialize anchor to current viewport offset and zero velocity so camera starts completely still
    followAnchorOffsetRef.current.x = offsetRef.current.x;
    followAnchorOffsetRef.current.y = offsetRef.current.y;
    followVelRef.current.vx = 0;
    followVelRef.current.vy = 0;

    const stepFollow = (now: number) => {
      const dt = Math.min(64, Math.max(0, now - lastTime));
      lastTime = now;

      const targetRegionId = replayFollowRegionIdRef.current;
      const isUserInteracting =
        isDraggingRef.current ||
        activePointersRef.current.size > 0 ||
        isOneFingerZoomingRef.current ||
        isDoubleTapPanningRef.current ||
        momentumAnimIdRef.current !== null;

      if (targetRegionId !== null && !isUserInteracting && containerRef.current) {
        const curScale = scaleRef.current;
        const reg = regionByIdRef.current.get(targetRegionId);
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        // Only pan when zoomed in (> 1.05x); never change scale or shift a fit-to-screen puzzle
        if (reg && w > 0 && h > 0 && curScale > 1.05) {
          const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
          const baseOffsetX = (w - puzzle.width * baseScale) / 2;
          const baseOffsetY = (h - puzzle.height * baseScale) / 2;
          const effScale = curScale * baseScale;

          // Inner Safe-Frame Dead-Zone: do not move camera while upcoming regions stay inside this frame
          const safeLeft = w * 0.18;
          const safeRight = w * 0.82;
          const safeTop = Math.max(68, h * 0.18);
          const safeBottom = h - Math.max(92, h * 0.22);
          const safeCenterX = w * 0.5;
          const safeCenterY = (safeTop + safeBottom) * 0.5;
          const safeHalfW = Math.max(60, (safeRight - safeLeft) * 0.45);
          const safeHalfH = Math.max(60, (safeBottom - safeTop) * 0.45);

          const anchor = followAnchorOffsetRef.current;
          const regAnchorX = anchor.x + baseOffsetX + reg.centroidX * effScale;
          const regAnchorY = anchor.y + baseOffsetY + reg.centroidY * effScale;
          const isCurrentOutsideSafeZone =
            regAnchorX < safeLeft ||
            regAnchorX > safeRight ||
            regAnchorY < safeTop ||
            regAnchorY > safeBottom;

          // Predictive lookahead: check if the next few upcoming regions (steps +1..+4) are about to exit the safe zone
          const seq = replayFollowSequenceRef.current;
          const curStep = replayFollowStepRef.current;
          let isLookaheadApproachingEdge = false;
          if (!isCurrentOutsideSafeZone && seq && curStep < seq.length) {
            const lookTriggerEnd = Math.min(seq.length, curStep + 5);
            for (let i = curStep + 1; i < lookTriggerEnd; i++) {
              const futureReg = regionByIdRef.current.get(seq[i]);
              if (!futureReg) continue;
              // Only anticipate if the future region is part of a nearby progression (fits in safe frame with current region)
              if (
                Math.abs(futureReg.centroidX - reg.centroidX) * effScale <= safeHalfW &&
                Math.abs(futureReg.centroidY - reg.centroidY) * effScale <= safeHalfH
              ) {
                const fx = anchor.x + baseOffsetX + futureReg.centroidX * effScale;
                const fy = anchor.y + baseOffsetY + futureReg.centroidY * effScale;
                if (fx < safeLeft || fx > safeRight || fy < safeTop || fy > safeBottom) {
                  isLookaheadApproachingEdge = true;
                  break;
                }
              } else {
                break;
              }
            }
          }

          // Only update the camera anchor when current or anticipated upcoming regions approach the screen edge
          if (isCurrentOutsideSafeZone || isLookaheadApproachingEdge) {
            let sumWX = reg.centroidX;
            let sumWY = reg.centroidY;
            let sumW = 1.0;

            // Predict future region completions (up to 10 steps ahead) that fit in the same safe frame as reg
            if (seq && curStep < seq.length) {
              const horizonEnd = Math.min(seq.length, curStep + 10);
              for (let i = curStep + 1; i < horizonEnd; i++) {
                const futureReg = regionByIdRef.current.get(seq[i]);
                if (!futureReg) continue;
                const dxPx = Math.abs(futureReg.centroidX - reg.centroidX) * effScale;
                const dyPx = Math.abs(futureReg.centroidY - reg.centroidY) * effScale;
                if (dxPx <= safeHalfW && dyPx <= safeHalfH) {
                  const weight = 1 / (1 + (i - curStep) * 0.22);
                  sumWX += futureReg.centroidX * weight;
                  sumWY += futureReg.centroidY * weight;
                  sumW += weight;
                } else {
                  break;
                }
              }
            }

            const predCentroidX = sumWX / sumW;
            const predCentroidY = sumWY / sumW;

            const rawScratch = followRawScratchRef.current;
            rawScratch.x = safeCenterX - baseOffsetX - predCentroidX * effScale;
            rawScratch.y = safeCenterY - baseOffsetY - predCentroidY * effScale;
            const clampedTarget = clampCanvasOffset(
              rawScratch,
              curScale,
              puzzle.width,
              puzzle.height,
              w,
              h,
              followClampedScratchRef.current
            );
            anchor.x = clampedTarget.x;
            anchor.y = clampedTarget.y;
          }

          // Critically-damped 2D spring-damper (SmoothDamp) toward anchor
          const curOff = offsetRef.current;
          const dx = curOff.x - anchor.x;
          const dy = curOff.y - anchor.y;
          const dist = Math.hypot(dx, dy);
          const vel = followVelRef.current;
          const speed = Math.hypot(vel.vx, vel.vy);

          if (dist > 0.35 || speed > 2.0) {
            const dtSec = Math.max(0.001, dt / 1000);
            const spd = replaySpeedRef.current;
            const smoothTime = Math.max(0.12, Math.min(0.32, 0.26 / Math.sqrt(Math.max(0.5, spd))));
            const omega = 2 / smoothTime;
            const xParam = omega * dtSec;
            const exp =
              1 / (1 + xParam + 0.48 * xParam * xParam + 0.235 * xParam * xParam * xParam);

            const tempX = (vel.vx + omega * dx) * dtSec;
            const tempY = (vel.vy + omega * dy) * dtSec;
            vel.vx = (vel.vx - omega * tempX) * exp;
            vel.vy = (vel.vy - omega * tempY) * exp;

            const nextOffset = {
              x: anchor.x + (dx + tempX) * exp,
              y: anchor.y + (dy + tempY) * exp,
            };
            offsetRef.current = nextOffset;
            setOffset(nextOffset);
            onViewExtentChangedRef.current?.(curScale, nextOffset.x, nextOffset.y, w, h);
          } else if (dist > 0) {
            vel.vx = 0;
            vel.vy = 0;
          }
        }
      }

      animId = requestAnimationFrame(stepFollow);
    };

    animId = requestAnimationFrame(stepFollow);
    return () => cancelAnimationFrame(animId);
  }, [isSmoothFollowingReplay, puzzle]);

  // Tap dot decay
  useEffect(() => {
    if (!tapDot) return;
    const interval = setInterval(() => {
      setTapDot((prev) => {
        if (!prev || prev.alpha <= 0.05) return null;
        return { ...prev, alpha: prev.alpha * 0.75 };
      });
    }, 30);
    return () => clearInterval(interval);
  }, [tapDot]);

  // Helper to paint a single region into baseImageData
  const writeRegionToImageData = useCallback(
    (
      data: Uint8ClampedArray,
      puzzleData: PuzzleData,
      region: Region,
      isFilled: boolean,
      isDetailMode: boolean,
      srcPixels: Uint8ClampedArray | null,
      paletteMap: Map<number, PaletteColor>,
      customColors?: Map<number, number>,
      isFreeColor?: boolean
    ) => {
      const { borderMap } = puzzleData;
      const targetColorId = customColors?.get(region.id) ?? region.colorId;
      const col = paletteMap.get(targetColorId);
      const r = col?.r ?? 71;
      const g = col?.g ?? 85;
      const b = col?.b ?? 105;
      const borderR = Math.floor(r * 0.72);
      const borderG = Math.floor(g * 0.72);
      const borderB = Math.floor(b * 0.72);

      const isColoring = Boolean(isFreeColor || puzzleData.isFreeColor);
      const pixels = region.pixels;
      for (let i = 0; i < pixels.length; i++) {
        const pIndex = pixels[i];
        const idx = pIndex * 4;
        const isBorder = borderMap[pIndex] === 1;

        if (isFilled) {
          if (isColoring) {
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255;
          } else if (isBorder) {
            data[idx] = borderR;
            data[idx + 1] = borderG;
            data[idx + 2] = borderB;
            data[idx + 3] = 255;
          } else if (isDetailMode && srcPixels) {
            data[idx] = srcPixels[idx];
            data[idx + 1] = srcPixels[idx + 1];
            data[idx + 2] = srcPixels[idx + 2];
            data[idx + 3] = 255;
          } else {
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255;
          }
        } else {
          if (isColoring) {
            data[idx] = 255;
            data[idx + 1] = 255;
            data[idx + 2] = 255;
            data[idx + 3] = 255;
          } else if (isBorder) {
            data[idx] = 51;
            data[idx + 1] = 65;
            data[idx + 2] = 85;
            data[idx + 3] = 255;
          } else {
            data[idx] = 255;
            data[idx + 1] = 255;
            data[idx + 2] = 255;
            data[idx + 3] = 255;
          }
        }
      }
    },
    []
  );

  // 1. Update Offscreen Base Canvas (Incremental Dirty-Rect on region fill!)
  useEffect(() => {
    if (!puzzle) {
      baseCanvasRef.current = null;
      baseImageDataRef.current = null;
      lastBasePuzzleRef.current = null;
      return;
    }

    const { width, height, regions, palette, regionMap, borderMap } = puzzle;
    const isDetailMode = regionColorMode === 'DETAIL';

    const needsFullRebuild =
      lastBasePuzzleRef.current !== puzzle ||
      lastBaseModeRef.current !== regionColorMode ||
      lastBaseImageRef.current !== sourceImage ||
      lastBaseFreeColorRef.current !== isFreeColorMode ||
      !baseCanvasRef.current ||
      !baseImageDataRef.current;

    if (needsFullRebuild) {
      // Cache lookup maps
      const regMap = new Map<number, Region>();
      for (const r of regions) regMap.set(r.id, r);
      regionByIdRef.current = regMap;

      const palMap = new Map<number, PaletteColor>();
      for (const p of palette) palMap.set(p.id, p);
      paletteByIdRef.current = palMap;

      // Extract source pixels once if available
      if (sourceImage && sourceImage.complete && (sourceImage.naturalWidth > 0 || sourceImage.width > 0)) {
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = width;
        tmpCanvas.height = height;
        const tmpCtx = tmpCanvas.getContext('2d');
        if (tmpCtx) {
          tmpCtx.drawImage(sourceImage, 0, 0, width, height);
          sourcePixelsRef.current = tmpCtx.getImageData(0, 0, width, height).data;
        }
      } else {
        sourcePixelsRef.current = null;
      }

      if (!baseCanvasRef.current) {
        baseCanvasRef.current = document.createElement('canvas');
      }
      baseCanvasRef.current.width = width;
      baseCanvasRef.current.height = height;
      const baseCtx = baseCanvasRef.current.getContext('2d')!;
      const imgData = baseCtx.createImageData(width, height);
      const data = imgData.data;
      const srcPixels = sourcePixelsRef.current;
      const total = width * height;

      const isColoring = Boolean(isFreeColorMode || puzzle.isFreeColor);
      // Initialize background & unfilled pixels
      for (let i = 0; i < total; i++) {
        const rId = regionMap[i];
        const isFilled = filledRegionIds.has(rId);
        const isBorder = borderMap[i] === 1;
        const idx = i * 4;

        if (isFilled) {
          const reg = regMap.get(rId);
          const targetColorId = reg ? (paintedRegionColors?.get(rId) ?? reg.colorId) : undefined;
          const col = targetColorId !== undefined ? palMap.get(targetColorId) : undefined;
          if (isColoring) {
            data[idx] = col ? col.r : 255;
            data[idx + 1] = col ? col.g : 255;
            data[idx + 2] = col ? col.b : 255;
            data[idx + 3] = 255;
          } else if (isBorder) {
            data[idx] = col ? Math.floor(col.r * 0.72) : 71;
            data[idx + 1] = col ? Math.floor(col.g * 0.72) : 85;
            data[idx + 2] = col ? Math.floor(col.b * 0.72) : 105;
            data[idx + 3] = 255;
          } else if (isDetailMode && srcPixels) {
            data[idx] = srcPixels[idx];
            data[idx + 1] = srcPixels[idx + 1];
            data[idx + 2] = srcPixels[idx + 2];
            data[idx + 3] = 255;
          } else {
            data[idx] = col ? col.r : 255;
            data[idx + 1] = col ? col.g : 255;
            data[idx + 2] = col ? col.b : 255;
            data[idx + 3] = 255;
          }
        } else {
          if (isColoring) {
            data[idx] = 255;
            data[idx + 1] = 255;
            data[idx + 2] = 255;
            data[idx + 3] = 255;
          } else if (isBorder) {
            data[idx] = 51;
            data[idx + 1] = 65;
            data[idx + 2] = 85;
            data[idx + 3] = 255;
          } else {
            data[idx] = 255;
            data[idx + 1] = 255;
            data[idx + 2] = 255;
            data[idx + 3] = 255;
          }
        }
      }

      baseCtx.putImageData(imgData, 0, 0);
      baseImageDataRef.current = imgData;
      paintedCacheRef.current = new Set(filledRegionIds);
      prevColorsRef.current = new Map(paintedRegionColors || []);
      const initCompletedSwatches = new Set<number>();
      if (!isColoring) {
        for (let pIdx = 0; pIdx < palette.length; pIdx++) {
          const cid = palette[pIdx].id;
          let hasAny = false;
          let hasUnfilled = false;
          for (let rIdx = 0; rIdx < regions.length; rIdx++) {
            const r = regions[rIdx];
            if (r.colorId === cid) {
              hasAny = true;
              if (!filledRegionIds.has(r.id)) {
                hasUnfilled = true;
                break;
              }
            }
          }
          if (hasAny && !hasUnfilled) {
            initCompletedSwatches.add(cid);
          }
        }
      }
      completedSwatchesCacheRef.current = initCompletedSwatches;
      activeFillBloomBuffer.clear();
      lastBasePuzzleRef.current = puzzle;
      lastBaseModeRef.current = regionColorMode;
      lastBaseImageRef.current = sourceImage;
      lastBaseFreeColorRef.current = isFreeColorMode;
      return;
    }

    // Incremental update: repaint regions whose filled status or painted color changed!
    const prevPainted = paintedCacheRef.current;
    const prevColors = prevColorsRef.current;
    const completedSwatches = completedSwatchesCacheRef.current;
    const baseCtx = baseCanvasRef.current!.getContext('2d')!;
    const imgData = baseImageDataRef.current!;
    const data = imgData.data;
    const regMap = regionByIdRef.current;
    const palMap = paletteByIdRef.current;
    const srcPixels = sourcePixelsRef.current;

    let minDirtyX = width;
    let minDirtyY = height;
    let maxDirtyX = -1;
    let maxDirtyY = -1;
    let newlyFilledCount = 0;
    const touchedSwatchIds = new Set<number>();

    // Check newly filled or repainted regions (in-place cache mutation, zero Set/Map cloning)
    for (const rId of filledRegionIds) {
      const curCol = paintedRegionColors?.get(rId);
      const prevCol = prevColors.get(rId);
      const wasAlreadyFilled = prevPainted.has(rId);
      const colorChanged = curCol !== prevCol;

      if (!wasAlreadyFilled || colorChanged) {
        const reg = regMap.get(rId);
        if (reg) {
          writeRegionToImageData(
            data,
            puzzle,
            reg,
            true,
            isDetailMode,
            srcPixels,
            palMap,
            paintedRegionColors,
            isFreeColorMode
          );
          if (reg.minX < minDirtyX) minDirtyX = reg.minX;
          if (reg.minY < minDirtyY) minDirtyY = reg.minY;
          if (reg.maxX > maxDirtyX) maxDirtyX = reg.maxX;
          if (reg.maxY > maxDirtyY) maxDirtyY = reg.maxY;

          if (!reducedMotionRef.current && !isPreviewMode && newlyFilledCount < 32) {
            const resolvedColId = curCol ?? reg.colorId;
            const colObj = palMap.get(resolvedColId);
            const bloomRadius = Math.max(
              6,
              Math.hypot(reg.maxX - reg.minX, reg.maxY - reg.minY) * 0.55
            );
            activeFillBloomBuffer.spawnFillBloom(
              reg.centroidX,
              reg.centroidY,
              bloomRadius,
              colObj?.hex || '#38bdf8'
            );
          }
          if (!wasAlreadyFilled) {
            newlyFilledCount++;
            touchedSwatchIds.add(reg.colorId);
          }
        }
        prevPainted.add(rId);
        if (curCol !== undefined) {
          prevColors.set(rId, curCol);
        } else {
          prevColors.delete(rId);
        }
      }
    }

    // Trigger 400ms celebratory centroid shimmer wave when any palette swatch reaches 0 remaining regions
    if (
      touchedSwatchIds.size > 0 &&
      !isFreeColorMode &&
      !puzzle.isFreeColor &&
      !reducedMotionRef.current &&
      !isPreviewMode
    ) {
      for (const swatchId of touchedSwatchIds) {
        if (completedSwatches.has(swatchId)) continue;
        let hasUnfilled = false;
        for (let i = 0; i < regions.length; i++) {
          const r = regions[i];
          if (r.colorId === swatchId && !filledRegionIds.has(r.id)) {
            hasUnfilled = true;
            break;
          }
        }
        if (!hasUnfilled) {
          completedSwatches.add(swatchId);
          const swatchHex = palMap.get(swatchId)?.hex || '#fbbf24';
          let spawned = 0;
          for (let i = 0; i < regions.length && spawned < MAX_FILL_BLOOMS; i++) {
            const r = regions[i];
            if (r.colorId === swatchId) {
              activeFillBloomBuffer.spawnSwatchShimmer(
                r.centroidX,
                r.centroidY,
                Math.max(10, r.maxRadius * 1.4),
                swatchHex
              );
              spawned++;
            }
          }
        }
      }
    }

    // Check any regions that were unfilled (e.g., Replay backward scrubbing, Undo, or Reset Progress)
    for (const rId of prevPainted) {
      if (!filledRegionIds.has(rId)) {
        const reg = regMap.get(rId);
        if (reg) {
          writeRegionToImageData(
            data,
            puzzle,
            reg,
            false,
            isDetailMode,
            srcPixels,
            palMap,
            paintedRegionColors,
            isFreeColorMode
          );
          if (reg.minX < minDirtyX) minDirtyX = reg.minX;
          if (reg.minY < minDirtyY) minDirtyY = reg.minY;
          if (reg.maxX > maxDirtyX) maxDirtyX = reg.maxX;
          if (reg.maxY > maxDirtyY) maxDirtyY = reg.maxY;
          completedSwatches.delete(reg.colorId);
        }
        prevPainted.delete(rId);
        prevColors.delete(rId);
      }
    }

    if (maxDirtyX >= minDirtyX && maxDirtyY >= minDirtyY) {
      baseCtx.putImageData(
        imgData,
        0,
        0,
        minDirtyX,
        minDirtyY,
        maxDirtyX - minDirtyX + 1,
        maxDirtyY - minDirtyY + 1
      );
    }

    lastBaseFreeColorRef.current = isFreeColorMode;
  }, [puzzle, sourceImage, regionColorMode, filledRegionIds, paintedRegionColors, isFreeColorMode, writeRegionToImageData]);

  // 2. Update Offscreen Highlight Layer (Only rebuilt when activeColorId/hintRegionId/style changes)
  useEffect(() => {
    if (
      !puzzle ||
      (highlightStyle !== 'FULL_REGION' && highlightStyle !== 'BOUNDARY_ONLY') ||
      (!highlightMatching && hintRegionId === null)
    ) {
      hasHighlightPixelsRef.current = false;
      return;
    }

    const { width, height, borderMap } = puzzle;
    if (!highlightCanvasRef.current) {
      highlightCanvasRef.current = document.createElement('canvas');
    }
    if (highlightCanvasRef.current.width !== width || highlightCanvasRef.current.height !== height) {
      highlightCanvasRef.current.width = width;
      highlightCanvasRef.current.height = height;
    }

    const hCtx = highlightCanvasRef.current.getContext('2d')!;
    const imgData = hCtx.createImageData(width, height);
    const data = imgData.data;

    const hr = (hintColorArgb >> 16) & 0xff;
    const hg = (hintColorArgb >> 8) & 0xff;
    const hb = hintColorArgb & 0xff;

    // Use active colour for active matching regions, hint colour for hinted region
    const activePal = puzzle.palette.find((c) => c.id === activeColorId);
    const ar = activePal ? activePal.r : hr;
    const ag = activePal ? activePal.g : hg;
    const ab = activePal ? activePal.b : hb;

    const isBoundaryOnly = highlightStyle === 'BOUNDARY_ONLY';
    let anyPixel = false;

    for (const reg of puzzle.regions) {
      if (filledRegionIds.has(reg.id)) continue;
      const isHinted = reg.id === hintRegionId;
      const isActive = reg.colorId === activeColorId;

      if (!isHinted && (!highlightMatching || !isActive)) continue;

      const fillR = isHinted ? hr : ar;
      const fillG = isHinted ? hg : ag;
      const fillB = isHinted ? hb : ab;

      const pixels = reg.pixels;
      for (let i = 0; i < pixels.length; i++) {
        const idx = pixels[i];
        if (isBoundaryOnly && borderMap[idx] !== 1) continue;

        const px = idx % width;
        const py = Math.floor(idx / width);

        let shouldFill = true;
        if (!isBoundaryOnly) {
          if (hintFillStyle === 'CHECKER') {
            shouldFill = ((px >> 2) + (py >> 2)) % 2 === 0;
          } else if (hintFillStyle === 'STRIPES') {
            shouldFill = ((px + py) >> 2) % 2 === 0;
          }
        }

        if (shouldFill) {
          const pIdx = idx * 4;
          data[pIdx] = fillR;
          data[pIdx + 1] = fillG;
          data[pIdx + 2] = fillB;
          data[pIdx + 3] = 255;
          anyPixel = true;
        }
      }
    }

    if (anyPixel) {
      hCtx.putImageData(imgData, 0, 0);
    }
    hasHighlightPixelsRef.current = anyPixel;
  }, [
    puzzle,
    activeColorId,
    hintRegionId,
    filledRegionIds,
    highlightMatching,
    highlightStyle,
    hintFillStyle,
    hintColorArgb,
  ]);

  // 3. Update Offscreen Preview Border Layer (built lazily once per puzzle)
  useEffect(() => {
    if (!puzzle || !showPreviewBorders) return;
    if (lastBorderPuzzleRef.current === puzzle && borderCanvasRef.current) return;

    const { width, height, borderMap } = puzzle;
    if (!borderCanvasRef.current) {
      borderCanvasRef.current = document.createElement('canvas');
    }
    borderCanvasRef.current.width = width;
    borderCanvasRef.current.height = height;
    const bCtx = borderCanvasRef.current.getContext('2d')!;
    const imgData = bCtx.createImageData(width, height);
    const data = imgData.data;
    const total = width * height;

    for (let i = 0; i < total; i++) {
      if (borderMap[i] === 1) {
        const idx = i * 4;
        data[idx] = 51;
        data[idx + 1] = 65;
        data[idx + 2] = 85;
        data[idx + 3] = 255;
      }
    }
    bCtx.putImageData(imgData, 0, 0);
    lastBorderPuzzleRef.current = puzzle;
  }, [puzzle, showPreviewBorders]);

  // Pan to center hinted region
  useEffect(() => {
    if (!puzzle || hintRegionId === null || !containerRef.current) return;
    const region = regionByIdRef.current.get(hintRegionId) || puzzle.regions.find((r) => r.id === hintRegionId);
    if (!region) return;

    const { clientWidth: w, clientHeight: h } = containerRef.current;
    if (w <= 0 || h <= 0) return;

    const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
    const baseOffsetX = (w - puzzle.width * baseScale) / 2;
    const baseOffsetY = (h - puzzle.height * baseScale) / 2;
    const effScale = scale * baseScale;

    if (effScale <= 0) return;

    const visLeft = (-offset.x - baseOffsetX) / effScale;
    const visTop = (-offset.y - baseOffsetY) / effScale;
    const visRight = visLeft + w / effScale;
    const visBottom = visTop + h / effScale;

    const isOnScreen =
      region.maxX >= visLeft &&
      region.minX <= visRight &&
      region.maxY >= visTop &&
      region.minY <= visBottom;

    // Only auto-pan if the canvas is zoomed in AND the region is outside the visible viewport
    const isZoomedIn = scaleRef.current > 1.05;
    if (showNextRegionHint && isZoomedIn && !isOnScreen) {
      const targetX = w / 2 - baseOffsetX - region.centroidX * effScale;
      const targetY = h / 2 - baseOffsetY - region.centroidY * effScale;
      const clamped = clampCanvasOffset({ x: targetX, y: targetY }, scaleRef.current, puzzle.width, puzzle.height, w, h);
      offsetRef.current = clamped;
      setOffset(clamped);
    }
  }, [hintRegionId, puzzle, showNextRegionHint]);

  // Notify view extent updates only when scale or offset actually changes
  const onViewExtentChangedRef = useRef(onViewExtentChanged);
  onViewExtentChangedRef.current = onViewExtentChanged;
  useEffect(() => {
    const w = containerRef.current?.clientWidth || window.innerWidth;
    const h = containerRef.current?.clientHeight || window.innerHeight;
    onViewExtentChangedRef.current?.(scale, offset.x, offset.y, w, h);
  }, [scale, offset]);

  // Coordinate conversion helper
  const screenToCanvasCoords = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container || !puzzle) return null;

      const rect = canvas.getBoundingClientRect();
      const screenX = clientX - rect.left;
      const screenY = clientY - rect.top;

      const w = container.clientWidth;
      const h = container.clientHeight;
      const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
      const baseOffsetX = (w - puzzle.width * baseScale) / 2;
      const baseOffsetY = (h - puzzle.height * baseScale) / 2;
      const effScale = scaleRef.current * baseScale;

      if (effScale <= 0) return null;

      const canvasX = (screenX - offsetRef.current.x - baseOffsetX) / effScale;
      const canvasY = (screenY - offsetRef.current.y - baseOffsetY) / effScale;

      return { x: canvasX, y: canvasY, screenX, screenY };
    },
    [puzzle]
  );

  // Bresenham line painting for smooth drag strokes
  const hitTestAndPaintLine = useCallback(
    (x1: number, y1: number, x2: number, y2: number) => {
      if (!puzzle) return;
      const { width, height, regionMap } = puzzle;

      const dx = x2 - x1;
      const dy = y2 - y1;
      const dist = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.floor(dist * 0.8));

      const intersected = new Set<number>();
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const lx = Math.floor(x1 + t * dx);
        const ly = Math.floor(y1 + t * dy);

        if (lx >= 0 && lx < width && ly >= 0 && ly < height) {
          const rId = regionMap[ly * width + lx];
          if (rId > 0) {
            intersected.add(rId);
          }
        }
      }

      if (intersected.size > 0) {
        onBatchRegionsClicked(intersected);
      }
    },
    [puzzle, onBatchRegionsClicked]
  );

  // Calculate visible regions/colors with debouncing
  useEffect(() => {
    if (!puzzle || !containerRef.current) return;
    const { clientWidth: w, clientHeight: h } = containerRef.current;
    if (w <= 0 || h <= 0) return;

    const timer = setTimeout(() => {
      const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
      const baseOffsetX = (w - puzzle.width * baseScale) / 2;
      const baseOffsetY = (h - puzzle.height * baseScale) / 2;
      const effScale = scale * baseScale;

      if (effScale <= 0) return;

      const visLeft = (-offset.x - baseOffsetX) / effScale;
      const visTop = (-offset.y - baseOffsetY) / effScale;
      const visRight = visLeft + w / effScale;
      const visBottom = visTop + h / effScale;

      const colorSet = new Set<number>();
      const regionSet = new Set<number>();

      for (const region of puzzle.regions) {
        if (filledRegionIds.has(region.id)) continue;
        if (
          region.maxX >= visLeft &&
          region.minX <= visRight &&
          region.maxY >= visTop &&
          region.minY <= visBottom
        ) {
          colorSet.add(region.colorId);
          regionSet.add(region.id);
        }
      }

      // Never hide or deprioritize active colour, even if no regions of it are on screen
      if (activeColorId) {
        colorSet.add(activeColorId);
      }

      onVisibleColorsChanged(colorSet);
      onVisibleRegionsChanged(regionSet);
    }, 80);

    return () => clearTimeout(timer);
  }, [scale, offset, containerSize, puzzle, activeColorId, filledRegionIds, onVisibleColorsChanged, onVisibleRegionsChanged]);

  // Main GPU-Accelerated Composite Rendering Routine (invocable directly from rAF without React state updates)
  const drawCompositeFrame = useCallback(
    (currentPulseAlpha: number) => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;

      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);

      // Canvas stage background
      const bgHex =
        canvasBgColor === 'CUSTOM' || !CANVAS_BG_MAP[canvasBgColor]
          ? `#${(canvasBgArgb & 0x00ffffff).toString(16).padStart(6, '0')}`
          : CANVAS_BG_MAP[canvasBgColor].hex;
      ctx.fillStyle = bgHex;
      ctx.fillRect(0, 0, w, h);

      if (!puzzle) {
        if (
          sourceImage &&
          sourceImage.complete &&
          (sourceImage.naturalWidth > 0 || sourceImage.width > 0)
        ) {
          const imgW = sourceImage.naturalWidth || sourceImage.width;
          const imgH = sourceImage.naturalHeight || sourceImage.height;
          const baseScale = Math.min(w / imgW, h / imgH) * 0.92;
          const baseOffsetX = (w - imgW * baseScale) / 2;
          const baseOffsetY = (h - imgH * baseScale) / 2;
          const artW = imgW * baseScale;
          const artH = imgH * baseScale;

          // Draw artwork drop shadow framing on stage
          ctx.save();
          ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
          ctx.shadowBlur = 24;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 6;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(baseOffsetX, baseOffsetY, artW, artH);
          ctx.restore();

          // Draw source image cleanly
          ctx.save();
          ctx.translate(baseOffsetX, baseOffsetY);
          ctx.drawImage(sourceImage, 0, 0, artW, artH);
          ctx.restore();
        }
        ctx.restore();
        return;
      }

      const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
      const baseOffsetX = (w - puzzle.width * baseScale) / 2;
      const baseOffsetY = (h - puzzle.height * baseScale) / 2;
      const effScale = scale * baseScale;

      // Draw artwork drop shadow framing on stage
      const artScreenX = offset.x + baseOffsetX;
      const artScreenY = offset.y + baseOffsetY;
      const artScreenW = puzzle.width * effScale;
      const artScreenH = puzzle.height * effScale;

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(artScreenX, artScreenY, artScreenW, artScreenH);
      ctx.restore();

      ctx.save();
      ctx.translate(offset.x + baseOffsetX, offset.y + baseOffsetY);
      ctx.scale(effScale, effScale);

      const isEffectivePreview = isPreviewMode;

      // 1. Draw Base Layer from cached offscreen canvas (0 CPU pixel loops!)
      if (isEffectivePreview) {
        if (sourceImage && sourceImage.complete) {
          ctx.drawImage(sourceImage, 0, 0, puzzle.width, puzzle.height);
        } else if (baseCanvasRef.current) {
          ctx.drawImage(baseCanvasRef.current, 0, 0);
        }

        if (showPreviewBorders && borderCanvasRef.current) {
          ctx.drawImage(borderCanvasRef.current, 0, 0);
        }
      } else {
        if (baseCanvasRef.current) {
          ctx.drawImage(baseCanvasRef.current, 0, 0);
        }

        // 2. Draw Highlight Overlay Layer with hardware-accelerated alpha pulse (steady high-contrast when reducedMotion is enabled)
        const effectiveAnimateHint = Boolean(animateHint && !reducedMotion);
        if (
          hasHighlightPixelsRef.current &&
          highlightCanvasRef.current &&
          (highlightStyle === 'FULL_REGION' || highlightStyle === 'BOUNDARY_ONLY')
        ) {
          ctx.save();
          ctx.globalAlpha = effectiveAnimateHint
            ? Math.min(1, Math.max(0.05, currentPulseAlpha * hintIntensity))
            : Math.min(
                1,
                Math.max(0.05, reducedMotion ? Math.max(0.88, hintIntensity) : hintIntensity * 0.78)
              );
          ctx.drawImage(highlightCanvasRef.current, 0, 0);
          ctx.restore();
        }

        // 3. For coloring book / free color mode: composite authentic ink artwork on top with multiply blend!
        const isColoring = Boolean(isFreeColorMode || puzzle.isFreeColor);
        if (
          isColoring &&
          sourceImage &&
          sourceImage.complete &&
          (sourceImage.naturalWidth > 0 || sourceImage.width > 0)
        ) {
          ctx.save();
          ctx.globalCompositeOperation = 'multiply';
          ctx.drawImage(sourceImage, 0, 0, puzzle.width, puzzle.height);
          ctx.restore();
        }
      }

      // 3. Draw Visible Number Labels & Centroid Glows
      const drawLabelsNow = isEffectivePreview
        ? showRegionLabels && showPreviewLabels
        : isFreeColorMode
        ? false
        : showRegionLabels;

      if (drawLabelsNow || highlightMatching || hintRegionId !== null) {
        const visLeft = (-offset.x - baseOffsetX) / effScale;
        const visTop = (-offset.y - baseOffsetY) / effScale;
        const visRight = visLeft + w / effScale;
        const visBottom = visTop + h / effScale;

        renderLabels(
          ctx,
          puzzle,
          filledRegionIds,
          activeColorId,
          hintRegionId,
          displayNumberMap,
          drawLabelsNow,
          highlightMatching,
          highlightStyle,
          hintColorArgb,
          hintIntensity,
          currentPulseAlpha,
          Boolean(animateHint && !reducedMotion),
          effScale,
          labelScale,
          minLabelSize,
          maxLabelSize,
          visLeft,
          visTop,
          visRight,
          visBottom,
          isEffectivePreview
        );
      }

      // 4. Tap feedback animation dot
      if (tapDot && tapDot.alpha > 0) {
        ctx.beginPath();
        ctx.arc(tapDot.x, tapDot.y, 7 / effScale, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(56, 189, 248, ${tapDot.alpha * 0.9})`;
        ctx.fill();
      }

      // 5a. Zero-allocation Region Fill Blooms (180ms) & Completed-Swatch Shimmers (400ms)
      if (!reducedMotion) {
        const bloomNowMs = performance.now();
        ctx.save();
        for (let i = 0; i < MAX_FILL_BLOOMS; i++) {
          const started = activeFillBloomBuffer.startTimeMs[i];
          if (started <= 0) continue;
          const kind = activeFillBloomBuffer.kind[i];
          const duration =
            kind === BLOOM_KIND_SWATCH_SHIMMER
              ? SWATCH_SHIMMER_DURATION_MS
              : FILL_BLOOM_DURATION_MS;
          const age = bloomNowMs - started;
          if (age < 0 || age >= duration) {
            activeFillBloomBuffer.startTimeMs[i] = 0;
            continue;
          }
          const progress = age / duration;
          const bx = activeFillBloomBuffer.x[i];
          const by = activeFillBloomBuffer.y[i];
          const baseRad = activeFillBloomBuffer.maxRadius[i];

          if (kind === BLOOM_KIND_SWATCH_SHIMMER) {
            const bell = Math.sin(progress * Math.PI);
            const shimmerRadius = baseRad * (0.45 + 0.85 * progress) + 4 / effScale;
            ctx.globalAlpha = bell * 0.42;
            ctx.fillStyle = activeFillBloomBuffer.colorHex[i];
            ctx.beginPath();
            ctx.arc(bx, by, shimmerRadius * 0.72, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalAlpha = bell * 0.88;
            ctx.lineWidth = 2.2 / effScale;
            ctx.strokeStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(bx, by, shimmerRadius, 0, Math.PI * 2);
            ctx.stroke();
          } else {
            const ease = 1 - (1 - progress) * (1 - progress) * (1 - progress);
            const bloomRadius = Math.max(3 / effScale, baseRad * (0.22 + 0.88 * ease));
            ctx.globalAlpha = (1 - progress) * 0.45;
            ctx.fillStyle = activeFillBloomBuffer.colorHex[i];
            ctx.beginPath();
            ctx.arc(bx, by, bloomRadius, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalAlpha = (1 - progress) * 0.85;
            ctx.lineWidth = 1.8 / effScale;
            ctx.strokeStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(bx, by, bloomRadius, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      // 5b. Zero-allocation Co-op Collaborator Paint Ripples (typed ring buffer, zero heap allocs)
      if (coopRippleBuffer) {
        const nowMs = performance.now();
        ctx.save();
        ctx.lineWidth = 2.5 / effScale;
        for (let i = 0; i < MAX_COOP_RIPPLES; i++) {
          const started = coopRippleBuffer.startTimeMs[i];
          if (started <= 0) continue;
          const age = nowMs - started;
          if (age < 0 || age >= COOP_RIPPLE_DURATION_MS) {
            coopRippleBuffer.startTimeMs[i] = 0;
            continue;
          }
          const progress = age / COOP_RIPPLE_DURATION_MS;
          const ease = 1 - (1 - progress) * (1 - progress);
          const radius = (8 + ease * 26) / effScale;
          ctx.globalAlpha = (1 - progress) * 0.92;
          ctx.strokeStyle = coopRippleBuffer.strokeHex[i];
          ctx.beginPath();
          ctx.arc(coopRippleBuffer.x[i], coopRippleBuffer.y[i], radius, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      ctx.restore(); // Transform restore

      // 6. Zero-allocation 2.5x Floating Precision Loupe Magnifier (reuses lazy offscreen compositeCanvasRef via circular clip)
      if (
        showMagnifierLoupe &&
        !isPreviewMode &&
        !isGenerating &&
        loupeStateRef.current.active
      ) {
        let compositeSource = compositeCanvasRef.current;
        if (!compositeSource) {
          compositeSource = document.createElement('canvas');
          compositeCanvasRef.current = compositeSource;
        }
        if (compositeSource.width !== canvas.width || compositeSource.height !== canvas.height) {
          compositeSource.width = canvas.width;
          compositeSource.height = canvas.height;
        }
        const compCtx = compositeSource.getContext('2d');
        if (compCtx) {
          compCtx.setTransform(1, 0, 0, 1, 0, 0);
          compCtx.clearRect(0, 0, compositeSource.width, compositeSource.height);
          compCtx.drawImage(canvas, 0, 0);
        }

        const ptrX = loupeStateRef.current.screenX;
        const ptrY = loupeStateRef.current.screenY;
        const loupePos = computeLoupePosition(
          ptrX,
          ptrY,
          w,
          h,
          LOUPE_RADIUS_PX,
          loupePosScratchRef.current
        );
        const lx = loupePos.x;
        const ly = loupePos.y;
        const srcHalfCss = LOUPE_RADIUS_PX / LOUPE_MAGNIFICATION;
        const srcLeftCss = Math.max(0, ptrX - srcHalfCss);
        const srcTopCss = Math.max(0, ptrY - srcHalfCss);
        const srcRightCss = Math.min(w, ptrX + srcHalfCss);
        const srcBottomCss = Math.min(h, ptrY + srcHalfCss);
        const srcWCss = srcRightCss - srcLeftCss;
        const srcHCss = srcBottomCss - srcTopCss;

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
        ctx.shadowBlur = 14;
        ctx.shadowOffsetY = 4;
        ctx.beginPath();
        ctx.arc(lx, ly, LOUPE_RADIUS_PX, 0, Math.PI * 2);
        ctx.fillStyle = bgHex;
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.arc(lx, ly, LOUPE_RADIUS_PX, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = bgHex;
        ctx.fillRect(
          lx - LOUPE_RADIUS_PX,
          ly - LOUPE_RADIUS_PX,
          LOUPE_RADIUS_PX * 2,
          LOUPE_RADIUS_PX * 2
        );
        if (srcWCss > 0.5 && srcHCss > 0.5) {
          const dstX = lx + (srcLeftCss - ptrX) * LOUPE_MAGNIFICATION;
          const dstY = ly + (srcTopCss - ptrY) * LOUPE_MAGNIFICATION;
          const dstW = srcWCss * LOUPE_MAGNIFICATION;
          const dstH = srcHCss * LOUPE_MAGNIFICATION;
          ctx.drawImage(
            compositeSource,
            srcLeftCss * dpr,
            srcTopCss * dpr,
            srcWCss * dpr,
            srcHCss * dpr,
            dstX,
            dstY,
            dstW,
            dstH
          );
        }

        // Precision center crosshair reticle inside the circular lens
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(lx - 11, ly);
        ctx.lineTo(lx - 3, ly);
        ctx.moveTo(lx + 3, ly);
        ctx.lineTo(lx + 11, ly);
        ctx.moveTo(lx, ly - 11);
        ctx.lineTo(lx, ly - 3);
        ctx.moveTo(lx, ly + 3);
        ctx.lineTo(lx, ly + 11);
        ctx.stroke();

        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(lx, ly, 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Crisp high-contrast outer bezel
        ctx.save();
        ctx.beginPath();
        ctx.arc(lx, ly, LOUPE_RADIUS_PX, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#f8fafc';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(lx, ly, LOUPE_RADIUS_PX - 1.5, 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.7)';
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore(); // DPR scale restore
    },
    [
      puzzle,
      sourceImage,
      scale,
      offset,
      activeColorId,
      filledRegionIds,
      paintedRegionColors,
      hintRegionId,
      isPreviewMode,
      isFreeColorMode,
      canvasBgColor,
      canvasBgArgb,
      regionColorMode,
      showRegionLabels,
      showPreviewLabels,
      showPreviewBorders,
      labelScale,
      minLabelSize,
      maxLabelSize,
      highlightMatching,
      highlightStyle,
      hintColorArgb,
      hintFillStyle,
      animateHint,
      showMagnifierLoupe,
      reducedMotion,
      hintIntensity,
      displayNumberMap,
      tapDot,
      isGenerating,
      detailedProgress,
      generationProgress,
      generationStepIndex,
      coopRippleBuffer,
      activeFillBloomBuffer,
      compositeCanvasRef,
    ]
  );

  // Observe container dimension changes (window resize, mobile orientation change, fullscreen toggle)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;

      setContainerSize((prev) =>
        prev.width === w && prev.height === h ? prev : { width: w, height: h }
      );

      if (puzzle) {
        const curOffset = offsetRef.current;
        const clamped = clampCanvasOffset(
          curOffset,
          scaleRef.current,
          puzzle.width,
          puzzle.height,
          w,
          h
        );
        if (clamped.x !== curOffset.x || clamped.y !== curOffset.y) {
          offsetRef.current = clamped;
          setOffset(clamped);
        }
        onViewExtentChangedRef.current?.(scaleRef.current, clamped.x, clamped.y, w, h);
      }
      drawCompositeFrame(pulseAlphaRef.current);
    };

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => handleResize())
        : null;
    observer?.observe(container);
    window.addEventListener('resize', handleResize);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [puzzle, drawCompositeFrame]);

  // Redraw immediately whenever visual props or viewport state change
  useEffect(() => {
    drawCompositeFrame(pulseAlphaRef.current);
  }, [drawCompositeFrame]);

  // Demand-driven Co-op Ripple decay rAF loop (sleeps completely when idle; zero React state updates)
  useEffect(() => {
    if (!coopRippleBuffer) return;
    let rippleRafId = 0;
    const stepRipples = (now: number) => {
      rippleRafId = 0;
      drawCompositeFrame(pulseAlphaRef.current);
      if (coopRippleBuffer.hasActiveRipples(now)) {
        rippleRafId = requestAnimationFrame(stepRipples);
      }
    };
    coopRippleBuffer.setWakeCallback(() => {
      if (rippleRafId === 0) {
        rippleRafId = requestAnimationFrame(stepRipples);
      }
    });
    return () => {
      coopRippleBuffer.setWakeCallback(null);
      if (rippleRafId !== 0) cancelAnimationFrame(rippleRafId);
    };
  }, [coopRippleBuffer, drawCompositeFrame]);

  // Demand-driven Fill Bloom & Swatch Shimmer rAF loop (0% idle CPU once 180ms/400ms expires; skips under reducedMotion)
  useEffect(() => {
    if (reducedMotion) {
      activeFillBloomBuffer.clear();
      drawCompositeFrame(pulseAlphaRef.current);
      return;
    }
    let bloomRafId = 0;
    const stepBlooms = (now: number) => {
      bloomRafId = 0;
      drawCompositeFrame(pulseAlphaRef.current);
      if (activeFillBloomBuffer.hasActiveAnimations(now)) {
        bloomRafId = requestAnimationFrame(stepBlooms);
      }
    };
    activeFillBloomBuffer.setWakeCallback(() => {
      if (bloomRafId === 0 && !reducedMotionRef.current) {
        bloomRafId = requestAnimationFrame(stepBlooms);
      }
    });
    if (activeFillBloomBuffer.hasActiveAnimations(performance.now())) {
      bloomRafId = requestAnimationFrame(stepBlooms);
    }
    return () => {
      activeFillBloomBuffer.setWakeCallback(null);
      if (bloomRafId !== 0) cancelAnimationFrame(bloomRafId);
    };
  }, [activeFillBloomBuffer, reducedMotion, drawCompositeFrame]);

  // Direct-to-canvas hint pulse rAF loop (zero React state updates; pauses completely when idle/completed or under reducedMotion)
  useEffect(() => {
    const hasActivePulseTarget =
      Boolean(puzzle) &&
      !isPreviewMode &&
      !isGenerating &&
      (hintRegionId !== null ||
        (!isFreeColorMode &&
          highlightMatching &&
          highlightStyle !== 'NUMBER_ONLY' &&
          filledRegionIds.size < (puzzle?.regions.length || 0)));

    if (!animateHint || reducedMotion || !hasActivePulseTarget) {
      const steadyAlpha = reducedMotion ? 0.95 : 0.7;
      pulseAlphaRef.current = steadyAlpha;
      drawCompositeFrame(steadyAlpha);
      return;
    }

    let animId = 0;
    const startTime = performance.now();

    const loop = (now: number) => {
      if (!document.hidden) {
        const elapsed = now - startTime;
        const t = (Math.sin(elapsed / 250) + 1) / 2;
        const nextAlpha = 0.35 + t * 0.6;
        pulseAlphaRef.current = nextAlpha;
        drawCompositeFrame(nextAlpha);
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [
    animateHint,
    reducedMotion,
    puzzle,
    isPreviewMode,
    isGenerating,
    hintRegionId,
    isFreeColorMode,
    highlightMatching,
    highlightStyle,
    filledRegionIds.size,
    drawCompositeFrame,
  ]);

  const scheduleLoupeRedraw = useCallback(() => {
    if (loupeDrawRafRef.current !== 0) return;
    loupeDrawRafRef.current = requestAnimationFrame(() => {
      loupeDrawRafRef.current = 0;
      drawCompositeFrame(pulseAlphaRef.current);
    });
  }, [drawCompositeFrame]);

  const setLoupeDataAttributes = useCallback((active: boolean, screenX: number, screenY: number) => {
    const el = canvasRef.current;
    if (!el) return;
    if (active) {
      el.setAttribute('data-loupe-active', 'true');
      el.setAttribute(
        'data-loupe-flipped',
        screenY < LOUPE_TOP_FLIP_THRESHOLD_PX ? 'true' : 'false'
      );
      el.setAttribute('data-loupe-pointer-x', String(Math.round(screenX)));
      el.setAttribute('data-loupe-pointer-y', String(Math.round(screenY)));
    } else {
      el.setAttribute('data-loupe-active', 'false');
      el.removeAttribute('data-loupe-flipped');
    }
  }, []);

  const activateLoupeAt = useCallback(
    (screenX: number, screenY: number) => {
      if (!showMagnifierLoupeRef.current) return;
      const wasActive = loupeStateRef.current.active;
      const prevFlipped = loupeStateRef.current.screenY < LOUPE_TOP_FLIP_THRESHOLD_PX;
      const nextFlipped = screenY < LOUPE_TOP_FLIP_THRESHOLD_PX;
      loupeStateRef.current.active = true;
      loupeStateRef.current.screenX = screenX;
      loupeStateRef.current.screenY = screenY;
      if (!wasActive || prevFlipped !== nextFlipped) {
        setLoupeDataAttributes(true, screenX, screenY);
      }
      scheduleLoupeRedraw();
    },
    [scheduleLoupeRedraw, setLoupeDataAttributes]
  );

  const deactivateLoupe = useCallback(
    (redraw: boolean) => {
      cancelLoupeHoldTimer();
      isLoupeHoldTargetingRef.current = false;
      if (loupeStateRef.current.active) {
        loupeStateRef.current.active = false;
        setLoupeDataAttributes(false, 0, 0);
        if (redraw) {
          scheduleLoupeRedraw();
        }
      }
    },
    [cancelLoupeHoldTimer, scheduleLoupeRedraw, setLoupeDataAttributes]
  );

  useEffect(() => {
    if (!showMagnifierLoupe || isPreviewMode || isGenerating) {
      deactivateLoupe(true);
    }
  }, [showMagnifierLoupe, isPreviewMode, isGenerating, deactivateLoupe]);

  // Pointer event handlers for touch/mouse
  const handlePointerDown = (e: React.PointerEvent) => {
    stopMomentum();
    cancelLoupeHoldTimer();
    isLoupeHoldTargetingRef.current = false;
    pointerHistoryRef.current = [{ x: e.clientX, y: e.clientY, time: performance.now() }];
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const isRightClick = e.button === 2 || (e.buttons & 2) !== 0;
    isRightClickRef.current = isRightClick;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignored if pointer capture is not supported
    }

    if (e.pointerType === 'touch') {
      touchPointerCountRef.current = activePointersRef.current.size;
      if (touchPointerCountRef.current > 1) {
        // Multi-touch: cancel single pointer drag, zoom, loupe, and do not paint
        deactivateLoupe(true);
        isDraggingRef.current = false;
        isPinchPanningRef.current = false;
        isDoubleTapCandidateRef.current = false;
        isOneFingerZoomingRef.current = false;
        return;
      }
    }

    isDraggingRef.current = true;
    isPinchPanningRef.current = false;
    hasNotifiedManualPanRef.current = false;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
    totalDragDistanceRef.current = 0;

    // Detect if pointer touched inside image bounds or on the canvas background
    const coords = screenToCanvasCoords(e.clientX, e.clientY);
    const isInsideImage = Boolean(
      coords &&
      puzzle &&
      coords.x >= 0 &&
      coords.x < puzzle.width &&
      coords.y >= 0 &&
      coords.y < puzzle.height
    );
    isTouchingOutsideImageRef.current = !isInsideImage;

    // Check if this pointer down is a candidate for one-finger double-tap (vertical zoom or horizontal pan)
    const now = Date.now();
    const timeSinceTapUp = now - lastTapUpTimeRef.current;
    const distFromLastTap = Math.hypot(
      e.clientX - lastTapUpPosRef.current.x,
      e.clientY - lastTapUpPosRef.current.y
    );

    if (timeSinceTapUp < 350 && distFromLastTap < 40 && !isRightClick) {
      deactivateLoupe(true);
      isDoubleTapCandidateRef.current = true;
      isOneFingerZoomingRef.current = false;
      isDoubleTapPanningRef.current = false;
      doubleTapFocalRef.current = { x: e.clientX, y: e.clientY };
      dragZoomStartYRef.current = e.clientY;
      initialDragZoomScaleRef.current = scaleRef.current;
      initialDragZoomOffsetRef.current = { ...offsetRef.current };
      // Defer immediate paint until drag direction / gesture resolves
      return;
    } else {
      isDoubleTapCandidateRef.current = false;
      isOneFingerZoomingRef.current = false;
      isDoubleTapPanningRef.current = false;
    }

    if (!coords || !puzzle) return;

    // Start continuous paint + Precision Loupe in Paint Mode, or schedule press-and-hold Loupe in normal mode
    if (!isRightClick && !isPreviewMode && isInsideImage) {
      if (isPaintMode) {
        if (showMagnifierLoupeRef.current) {
          activateLoupeAt(coords.screenX, coords.screenY);
        }
        hitTestAndPaintLine(coords.x, coords.y, coords.x, coords.y);
        setTapDot({ x: coords.x, y: coords.y, alpha: 1 });
      } else if (showMagnifierLoupeRef.current) {
        const startClientX = e.clientX;
        const startClientY = e.clientY;
        loupeHoldTimerRef.current = window.setTimeout(() => {
          loupeHoldTimerRef.current = null;
          if (
            !isDraggingRef.current ||
            wasPinchingRef.current ||
            touchPointerCountRef.current > 1 ||
            isDoubleTapCandidateRef.current ||
            totalDragDistanceRef.current >= 10 ||
            !showMagnifierLoupeRef.current
          ) {
            return;
          }
          const latestPos = lastPointerPosRef.current;
          const holdCoords = screenToCanvasCoords(
            latestPos.x || startClientX,
            latestPos.y || startClientY
          );
          if (!holdCoords) return;
          isLoupeHoldTargetingRef.current = true;
          activateLoupeAt(holdCoords.screenX, holdCoords.screenY);
        }, LOUPE_HOLD_DELAY_MS);
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const trackedPointer = activePointersRef.current.get(e.pointerId);
    if (trackedPointer) {
      trackedPointer.x = e.clientX;
      trackedPointer.y = e.clientY;
    }

    if (!isDraggingRef.current || touchStartDistRef.current !== null || touchPointerCountRef.current > 1) return;

    // One-finger double-tap drag:
    // Left/Right: horizontal pan (especially in paint mode)
    // Up/Down: zoom in/out
    if (isDoubleTapCandidateRef.current) {
      const dx = e.clientX - doubleTapFocalRef.current.x;
      const dy = e.clientY - dragZoomStartYRef.current;

      if (!isOneFingerZoomingRef.current && !isDoubleTapPanningRef.current) {
        if (Math.abs(dx) >= 8 || Math.abs(dy) >= 8) {
          if (isPaintMode && Math.abs(dx) >= Math.abs(dy)) {
            // Horizontal drag in paint mode enables one-finger panning!
            isDoubleTapPanningRef.current = true;
          } else if (Math.abs(dx) > Math.abs(dy) * 1.25) {
            // Predominantly horizontal drag triggers panning
            isDoubleTapPanningRef.current = true;
          } else {
            // Predominantly vertical drag triggers zoom
            isOneFingerZoomingRef.current = true;
          }
        }
      }

      if (isDoubleTapPanningRef.current && containerRef.current && puzzle) {
        if (!hasNotifiedManualPanRef.current) {
          hasNotifiedManualPanRef.current = true;
          onManualPanStartRef.current?.();
        }
        const moveDx = e.clientX - lastPointerPosRef.current.x;
        const moveDy = e.clientY - lastPointerPosRef.current.y;
        lastPointerPosRef.current.x = e.clientX;
        lastPointerPosRef.current.y = e.clientY;

        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        const rawTarget = gestureRawOffsetRef.current;
        rawTarget.x = offsetRef.current.x + moveDx;
        rawTarget.y = offsetRef.current.y + moveDy;
        const clamped = clampCanvasOffset(
          rawTarget,
          scaleRef.current,
          puzzle.width,
          puzzle.height,
          w,
          h,
          gestureClampedOffsetRef.current
        );
        if (clamped.x !== offsetRef.current.x || clamped.y !== offsetRef.current.y) {
          const nextOffset = { x: clamped.x, y: clamped.y };
          offsetRef.current = nextOffset;
          setOffset(nextOffset);
        }
        return;
      }

      if (isOneFingerZoomingRef.current && containerRef.current && canvasRef.current && puzzle) {
        // By default: Drag up (dy < 0) zooms out, drag down (dy > 0) zooms in.
        // If reverseDoubleTapZoom is true: inverted (drag up zooms in, drag down zooms out).
        const sensitivity = 220;
        const directionMultiplier = reverseDoubleTapZoom ? -1 : 1;
        const zoomFactor = Math.exp(
          ((directionMultiplier * dy) / sensitivity) * effectiveZoomSensitivity
        );
        const clampedRawScale = Math.min(
          12.0,
          Math.max(0.5, initialDragZoomScaleRef.current * zoomFactor)
        );
        const newScale = applyZoomSnapDetent(clampedRawScale, snapZoomLevels);
        const actualZoom = newScale / initialDragZoomScaleRef.current;

        const rect = canvasRef.current.getBoundingClientRect();
        const focalScreenX = doubleTapFocalRef.current.x - rect.left;
        const focalScreenY = doubleTapFocalRef.current.y - rect.top;

        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
        const baseOffsetX = (w - puzzle.width * baseScale) / 2;
        const baseOffsetY = (h - puzzle.height * baseScale) / 2;

        const focalX = focalScreenX - (initialDragZoomOffsetRef.current.x + baseOffsetX);
        const focalY = focalScreenY - (initialDragZoomOffsetRef.current.y + baseOffsetY);

        const rawTarget = gestureRawOffsetRef.current;
        rawTarget.x = initialDragZoomOffsetRef.current.x - focalX * (actualZoom - 1);
        rawTarget.y = initialDragZoomOffsetRef.current.y - focalY * (actualZoom - 1);

        const clamped = clampCanvasOffset(
          rawTarget,
          newScale,
          puzzle.width,
          puzzle.height,
          w,
          h,
          gestureClampedOffsetRef.current
        );
        if (
          newScale !== scaleRef.current ||
          clamped.x !== offsetRef.current.x ||
          clamped.y !== offsetRef.current.y
        ) {
          const nextOffset = { x: clamped.x, y: clamped.y };
          scaleRef.current = newScale;
          offsetRef.current = nextOffset;
          setScale(newScale);
          setOffset(nextOffset);
        }

        lastPointerPosRef.current.x = e.clientX;
        lastPointerPosRef.current.y = e.clientY;
        return;
      }

      // If evaluating candidate and movement is small (< 8px), hold without painting
      if (!isOneFingerZoomingRef.current && !isDoubleTapPanningRef.current && Math.abs(dy) < 8 && Math.abs(dx) < 8) {
        return;
      }
    }

    const now = performance.now();
    pointerHistoryRef.current.push({ x: e.clientX, y: e.clientY, time: now });
    pointerHistoryRef.current = pointerHistoryRef.current.filter((p) => now - p.time <= 100);

    const dx = e.clientX - lastPointerPosRef.current.x;
    const dy = e.clientY - lastPointerPosRef.current.y;
    totalDragDistanceRef.current += Math.hypot(dx, dy);

    if (!isLoupeHoldTargetingRef.current && loupeHoldTimerRef.current !== null && totalDragDistanceRef.current >= 10) {
      cancelLoupeHoldTimer();
    }

    const prevCoords = screenToCanvasCoords(lastPointerPosRef.current.x, lastPointerPosRef.current.y);
    const currCoords = screenToCanvasCoords(e.clientX, e.clientY);

    lastPointerPosRef.current.x = e.clientX;
    lastPointerPosRef.current.y = e.clientY;

    // Press-and-hold Precision Loupe aiming tracks crosshair smoothly without panning the stage
    if (isLoupeHoldTargetingRef.current && currCoords) {
      activateLoupeAt(currCoords.screenX, currCoords.screenY);
      return;
    }

    const isRightClick = isRightClickRef.current || (e.buttons & 2) !== 0;
    const isTouchingOutsideImage = isTouchingOutsideImageRef.current;

    // If touching outside the image region on the background canvas, drag always pans!
    if (!isPinchPanningRef.current && !isRightClick && !isTouchingOutsideImage && isPaintMode && !isPreviewMode && prevCoords && currCoords) {
      if (showMagnifierLoupeRef.current) {
        activateLoupeAt(currCoords.screenX, currCoords.screenY);
      }
      hitTestAndPaintLine(prevCoords.x, prevCoords.y, currCoords.x, currCoords.y);
      setTapDot({ x: currCoords.x, y: currCoords.y, alpha: 1 });
    } else {
      const container = containerRef.current;
      if (!container || !puzzle) return;
      if (!hasNotifiedManualPanRef.current && totalDragDistanceRef.current >= 6) {
        hasNotifiedManualPanRef.current = true;
        onManualPanStartRef.current?.();
      }
      const w = container.clientWidth;
      const h = container.clientHeight;
      const targetOffset = {
        x: offsetRef.current.x + dx,
        y: offsetRef.current.y + dy,
      };
      const clamped = clampCanvasOffset(
        targetOffset,
        scaleRef.current,
        puzzle.width,
        puzzle.height,
        w,
        h
      );
      offsetRef.current = clamped;
      setOffset(clamped);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignored
    }

    activePointersRef.current.delete(e.pointerId);

    if (e.pointerType === 'touch') {
      touchPointerCountRef.current = activePointersRef.current.size;
      if (touchPointerCountRef.current > 0) {
        // One or more fingers are still on the screen!
        if (wasPinchingRef.current) {
          isDraggingRef.current = true;
          isPinchPanningRef.current = true;
          touchStartDistRef.current = null;
          initialTouchCenterRef.current = null;
          const remainingPos = activePointersRef.current.values().next().value;
          if (remainingPos) {
            lastPointerPosRef.current = { x: remainingPos.x, y: remainingPos.y };
            dragStartRef.current = { x: remainingPos.x, y: remainingPos.y };
          }
          totalDragDistanceRef.current = 100;
        }
        return;
      }
    }

    const wasLoupeHoldTargeting = isLoupeHoldTargetingRef.current;
    deactivateLoupe(true);

    // If one-finger double-tap zoom or pan was active, finish cleanly without clicks
    if (isOneFingerZoomingRef.current || isDoubleTapPanningRef.current) {
      isOneFingerZoomingRef.current = false;
      isDoubleTapPanningRef.current = false;
      isDoubleTapCandidateRef.current = false;
      isDraggingRef.current = false;
      isRightClickRef.current = false;
      lastTapUpTimeRef.current = 0; // Consume double-tap gesture
      return;
    }

    isDoubleTapCandidateRef.current = false;
    isDoubleTapPanningRef.current = false;

    if (!isDraggingRef.current) {
      if (touchPointerCountRef.current === 0) {
        wasPinchingRef.current = false;
        isPinchPanningRef.current = false;
      }
      return;
    }

    const wasRightClick = isRightClickRef.current;
    const wasPinchPan = isPinchPanningRef.current;
    isDraggingRef.current = false;
    isRightClickRef.current = false;

    if (touchPointerCountRef.current === 0) {
      wasPinchingRef.current = false;
      isPinchPanningRef.current = false;
    }

    if (wasRightClick || touchStartDistRef.current !== null) {
      return;
    }

    // Precision Loupe hold-and-release fills the exact micro-region under the crosshair
    if (wasLoupeHoldTargeting && !isPreviewMode) {
      const coords = screenToCanvasCoords(e.clientX, e.clientY);
      if (coords && puzzle) {
        setTapDot({ x: coords.x, y: coords.y, alpha: 1 });
        const lx = Math.floor(coords.x);
        const ly = Math.floor(coords.y);
        if (lx >= 0 && lx < puzzle.width && ly >= 0 && ly < puzzle.height) {
          const rId = puzzle.regionMap[ly * puzzle.width + lx];
          if (rId > 0) {
            onRegionClicked(rId);
          }
        }
      }
      return;
    }

    // Trigger smooth pan momentum if dragged sufficiently
    if (totalDragDistanceRef.current >= 12) {
      if (panMomentum && !reducedMotionRef.current && (!isPaintMode || isPreviewMode || wasPinchPan)) {
        const history = pointerHistoryRef.current;
        if (history.length >= 2) {
          const oldest = history[0];
          const newest = history[history.length - 1];
          const dt = newest.time - oldest.time;
          const timeSinceLast = performance.now() - newest.time;

          if (dt > 12 && timeSinceLast < 80) {
            let vx = (newest.x - oldest.x) / dt;
            let vy = (newest.y - oldest.y) / dt;
            const initialSpeed = Math.hypot(vx, vy);

            if (initialSpeed > 0.18) {
              const maxSpeed = 3.5;
              if (initialSpeed > maxSpeed) {
                vx = (vx / initialSpeed) * maxSpeed;
                vy = (vy / initialSpeed) * maxSpeed;
              }

              let lastTime = performance.now();
              const stepMomentum = (nowTime: number) => {
                const frameDt = Math.min(32, nowTime - lastTime);
                lastTime = nowTime;

                const decay = Math.pow(0.92, frameDt / 16);
                vx *= decay;
                vy *= decay;

                const curOffset = offsetRef.current;
                const container = containerRef.current;
                if (!container || !puzzle) return;
                const w = container.clientWidth;
                const h = container.clientHeight;

                const targetOffset = {
                  x: curOffset.x + vx * frameDt,
                  y: curOffset.y + vy * frameDt,
                };
                const clamped = clampCanvasOffset(targetOffset, scaleRef.current, puzzle.width, puzzle.height, w, h);

                if (clamped.x === curOffset.x && Math.abs(vx) > 0.1) vx = 0;
                if (clamped.y === curOffset.y && Math.abs(vy) > 0.1) vy = 0;

                offsetRef.current = clamped;
                setOffset(clamped);

                if (Math.hypot(vx, vy) > 0.02) {
                  momentumAnimIdRef.current = requestAnimationFrame(stepMomentum);
                } else {
                  momentumAnimIdRef.current = null;
                }
              };

              momentumAnimIdRef.current = requestAnimationFrame(stepMomentum);
            }
          }
        }
      }
      return;
    }

    // Single tap / click detection (instant double-tap jump zoom removed per design)
    if (totalDragDistanceRef.current < 12) {
      // Record this tap release so a subsequent tap within 350ms can trigger double-tap drag zoom
      lastTapUpTimeRef.current = Date.now();
      lastTapUpPosRef.current = { x: e.clientX, y: e.clientY };

      if (isPreviewMode) {
        onTogglePreview();
      } else {
        const coords = screenToCanvasCoords(e.clientX, e.clientY);
        if (coords && puzzle) {
          setTapDot({ x: coords.x, y: coords.y, alpha: 1 });
          const lx = Math.floor(coords.x);
          const ly = Math.floor(coords.y);
          if (lx >= 0 && lx < puzzle.width && ly >= 0 && ly < puzzle.height) {
            const rId = puzzle.regionMap[ly * puzzle.width + lx];
            if (rId > 0) {
              if (isPaintMode) {
                hitTestAndPaintLine(coords.x, coords.y, coords.x, coords.y);
              } else {
                onRegionClicked(rId);
              }
            }
          }
        }
      }
    }
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignored
    }

    activePointersRef.current.delete(e.pointerId);
    deactivateLoupe(true);

    if (e.pointerType === 'touch') {
      touchPointerCountRef.current = activePointersRef.current.size;
      if (touchPointerCountRef.current > 0) {
        if (wasPinchingRef.current) {
          isDraggingRef.current = true;
          isPinchPanningRef.current = true;
          touchStartDistRef.current = null;
          initialTouchCenterRef.current = null;
          const remainingPos = activePointersRef.current.values().next().value;
          if (remainingPos) {
            lastPointerPosRef.current = { x: remainingPos.x, y: remainingPos.y };
            dragStartRef.current = { x: remainingPos.x, y: remainingPos.y };
          }
          totalDragDistanceRef.current = 100;
        }
        return;
      }
    }

    isDraggingRef.current = false;
    isRightClickRef.current = false;
    isPinchPanningRef.current = false;
    isDoubleTapCandidateRef.current = false;
    isOneFingerZoomingRef.current = false;
    if (touchPointerCountRef.current === 0) {
      wasPinchingRef.current = false;
    }
  };

  // Wheel zoom around cursor
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current || !puzzle || e.deltaY === 0) return;

    const baseWheelFactor = e.deltaY < 0 ? 1.2 : 0.82;
    const zoomFactor = Math.pow(baseWheelFactor, effectiveZoomSensitivity);
    const currentScale = scaleRef.current;
    const currentOffset = offsetRef.current;
    const clampedRawScale = Math.min(12.0, Math.max(0.5, currentScale * zoomFactor));
    const newScale = applyZoomSnapDetent(clampedRawScale, snapZoomLevels);
    const actualZoom = newScale / currentScale;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
    const baseOffsetX = (w - puzzle.width * baseScale) / 2;
    const baseOffsetY = (h - puzzle.height * baseScale) / 2;

    const focalX = mouseX - (currentOffset.x + baseOffsetX);
    const focalY = mouseY - (currentOffset.y + baseOffsetY);

    const rawTarget = gestureRawOffsetRef.current;
    rawTarget.x = currentOffset.x - focalX * (actualZoom - 1);
    rawTarget.y = currentOffset.y - focalY * (actualZoom - 1);
    const clamped = clampCanvasOffset(
      rawTarget,
      newScale,
      puzzle.width,
      puzzle.height,
      w,
      h,
      gestureClampedOffsetRef.current
    );
    if (
      newScale !== currentScale ||
      clamped.x !== currentOffset.x ||
      clamped.y !== currentOffset.y
    ) {
      const nextOffset = { x: clamped.x, y: clamped.y };
      scaleRef.current = newScale;
      offsetRef.current = nextOffset;
      setScale(newScale);
      setOffset(nextOffset);
    }
  };

  // Multi-touch 2-finger focal-point pinch-to-zoom & pan
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length >= 2) {
      stopMomentum();
      deactivateLoupe(true);
      isDraggingRef.current = false;
      wasPinchingRef.current = true;
      isPinchPanningRef.current = false;
      isDoubleTapCandidateRef.current = false;
      isOneFingerZoomingRef.current = false;
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      touchStartDistRef.current = Math.max(1, dist);
      initialTouchCenterRef.current = {
        x: (t0.clientX + t1.clientX) / 2,
        y: (t0.clientY + t1.clientY) / 2,
      };
      initialTouchScaleRef.current = scaleRef.current;
      initialTouchOffsetRef.current = { ...offsetRef.current };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length >= 2 && containerRef.current && canvasRef.current && puzzle) {
      const t0 = e.touches[0];
      const t1 = e.touches[1];

      if (touchStartDistRef.current === null || initialTouchCenterRef.current === null) {
        touchStartDistRef.current = Math.max(1, Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY));
        initialTouchCenterRef.current = {
          x: (t0.clientX + t1.clientX) / 2,
          y: (t0.clientY + t1.clientY) / 2,
        };
        initialTouchScaleRef.current = scaleRef.current;
        initialTouchOffsetRef.current = { ...offsetRef.current };
        isDraggingRef.current = false;
        wasPinchingRef.current = true;
        isPinchPanningRef.current = false;
        return;
      }

      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      const currentCenterX = (t0.clientX + t1.clientX) / 2;
      const currentCenterY = (t0.clientY + t1.clientY) / 2;

      const rawRatio = Math.max(0.01, dist / touchStartDistRef.current);
      const scaledRatio = Math.pow(rawRatio, effectiveZoomSensitivity);
      const clampedRawScale = Math.min(
        12.0,
        Math.max(0.5, initialTouchScaleRef.current * scaledRatio)
      );
      const newScale = applyZoomSnapDetent(clampedRawScale, snapZoomLevels);
      const zoomRatio = newScale / initialTouchScaleRef.current;

      const rect = canvasRef.current.getBoundingClientRect();
      const focalScreenX = initialTouchCenterRef.current.x - rect.left;
      const focalScreenY = initialTouchCenterRef.current.y - rect.top;

      const panDx = currentCenterX - initialTouchCenterRef.current.x;
      const panDy = currentCenterY - initialTouchCenterRef.current.y;

      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
      const baseOffsetX = (w - puzzle.width * baseScale) / 2;
      const baseOffsetY = (h - puzzle.height * baseScale) / 2;

      const focalX = focalScreenX - (initialTouchOffsetRef.current.x + baseOffsetX);
      const focalY = focalScreenY - (initialTouchOffsetRef.current.y + baseOffsetY);

      const rawTarget = gestureRawOffsetRef.current;
      rawTarget.x = initialTouchOffsetRef.current.x + panDx - focalX * (zoomRatio - 1);
      rawTarget.y = initialTouchOffsetRef.current.y + panDy - focalY * (zoomRatio - 1);

      const clamped = clampCanvasOffset(
        rawTarget,
        newScale,
        puzzle.width,
        puzzle.height,
        w,
        h,
        gestureClampedOffsetRef.current
      );
      if (
        newScale !== scaleRef.current ||
        clamped.x !== offsetRef.current.x ||
        clamped.y !== offsetRef.current.y
      ) {
        const nextOffset = { x: clamped.x, y: clamped.y };
        scaleRef.current = newScale;
        offsetRef.current = nextOffset;
        setScale(newScale);
        setOffset(nextOffset);
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    touchPointerCountRef.current = e.touches.length;
    if (e.touches.length === 1) {
      touchStartDistRef.current = null;
      initialTouchCenterRef.current = null;
      if (wasPinchingRef.current) {
        isDraggingRef.current = true;
        isPinchPanningRef.current = true;
        const remaining = e.touches[0];
        lastPointerPosRef.current = { x: remaining.clientX, y: remaining.clientY };
        dragStartRef.current = { x: remaining.clientX, y: remaining.clientY };
        totalDragDistanceRef.current = 100;
      }
    } else if (e.touches.length === 0) {
      deactivateLoupe(true);
      activePointersRef.current.clear();
      touchStartDistRef.current = null;
      initialTouchCenterRef.current = null;
      touchPointerCountRef.current = 0;
      isDraggingRef.current = false;
      isPinchPanningRef.current = false;
      wasPinchingRef.current = false;
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden select-none touch-none ${
        isPaintMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
      }`}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
};

// --- Canvas Label & Centroid Glow Renderer ---

function renderLabels(
  ctx: CanvasRenderingContext2D,
  puzzle: PuzzleData,
  filledRegionIds: Set<number>,
  activeColorId: number,
  hintRegionId: number | null,
  displayNumberMap: Map<number, string>,
  drawLabelsNow: boolean,
  highlightMatching: boolean,
  highlightStyle: RegionHighlightStyle,
  hintColorArgb: number,
  hintIntensity: number,
  pulseAlpha: number,
  animateHint: boolean,
  effScale: number,
  labelScale: number,
  minLabelSize: number,
  maxLabelSize: number,
  visLeft: number,
  visTop: number,
  visRight: number,
  visBottom: number,
  isEffectivePreview: boolean
) {
  const drawGlowCircle = highlightStyle === 'CENTROID_GLOW';

  const hr = (hintColorArgb >> 16) & 0xff;
  const hg = (hintColorArgb >> 8) & 0xff;
  const hb = hintColorArgb & 0xff;

  const activePal = puzzle.palette.find((c) => c.id === activeColorId);
  const ar = activePal ? activePal.r : 251;
  const ag = activePal ? activePal.g : 191;
  const ab = activePal ? activePal.b : 36;

  // Pre-calculate effective min/max bounds in artwork coordinates
  const effMinArtwork = (minLabelSize * labelScale) / effScale;
  const effMaxArtwork = (maxLabelSize * labelScale) / effScale;

  // Pre-calculate text colors (zero per-frame allocations)
  const normalTextColor = isEffectivePreview ? '#0f172a' : '#334155';
  const activeTextColor = '#d97706';
  const hintAlpha = animateHint ? Math.min(1, Math.max(0.4, pulseAlpha * 1.1)) : 1.0;
  const hintTextColor = `rgba(${hr}, ${hg}, ${hb}, ${hintAlpha})`;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(1, 2 / effScale);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineJoin = 'round';

  for (const region of puzzle.regions) {
    if (filledRegionIds.has(region.id)) continue;

    const isActive = region.colorId === activeColorId;
    const isHinted = region.id === hintRegionId;

    // Viewport frustum culling
    if (!isActive && !isHinted) {
      if (
        region.centroidX < visLeft ||
        region.centroidX > visRight ||
        region.centroidY < visTop ||
        region.centroidY > visBottom
      ) {
        continue;
      }
    }

    const regW = region.maxX - region.minX + 1;
    const regH = region.maxY - region.minY + 1;
    const minDim = Math.min(regW, regH);

    // Glowing matching circle (only in CENTROID_GLOW mode)
    if (!isEffectivePreview && isActive && highlightMatching && drawGlowCircle) {
      const alpha = animateHint ? pulseAlpha * hintIntensity * 0.8 : hintIntensity * 0.7;
      ctx.beginPath();
      const radius = Math.max(4 / effScale, minDim * 0.18);
      ctx.arc(region.centroidX, region.centroidY, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${ar}, ${ag}, ${ab}, ${alpha})`;
      ctx.fill();
    }

    // Glowing hinted region circle (only in CENTROID_GLOW mode)
    if (!isEffectivePreview && isHinted && drawGlowCircle) {
      const alpha = animateHint ? pulseAlpha * hintIntensity * 0.95 : hintIntensity * 0.9;
      ctx.beginPath();
      const radius = Math.max(8 / effScale, minDim * 0.45);
      ctx.arc(region.centroidX, region.centroidY, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${hr}, ${hg}, ${hb}, ${alpha})`;
      ctx.fill();
    }

    if (!drawLabelsNow) continue;

    const labelText = displayNumberMap.get(region.colorId) || region.colorId.toString();
    const charCount = labelText.length;
    const cornerFactor =
      charCount === 1
        ? 0.4841
        : charCount === 2
        ? 0.7099
        : charCount === 3
        ? 0.9767
        : Math.sqrt(0.09 * charCount * charCount + 0.1444);

    const safetyMargin = 0.9;
    const maxFittingArtworkSize =
      region.maxRadius > 0
        ? (region.maxRadius * safetyMargin) / cornerFactor
        : (minDim * 0.4 * safetyMargin) / cornerFactor;

    // If region cannot fit minimum legible label size at current zoom level, skip normal regions
    if (!isActive && !isHinted && maxFittingArtworkSize < effMinArtwork) {
      continue;
    }

    // Determine target font size in artwork coordinates guaranteeing fit within the region
    let targetTextSize: number;
    if (isActive || isHinted) {
      const fitSize = Math.min(effMaxArtwork, maxFittingArtworkSize);
      targetTextSize = Math.max(Math.min(effMinArtwork, 2 / effScale), fitSize);
    } else {
      targetTextSize = Math.min(effMaxArtwork, maxFittingArtworkSize);
    }

    // Label font
    ctx.font = isHinted
      ? `700 ${targetTextSize}px "Inter", -apple-system, sans-serif`
      : `600 ${targetTextSize}px "Inter", -apple-system, sans-serif`;

    // Redo label hint effect: changes text colour, does NOT draw a circle around it
    const isMatch = isActive && highlightMatching;
    ctx.fillStyle = isHinted
      ? hintTextColor
      : isMatch
      ? activeTextColor
      : normalTextColor;

    // Stroke outline scaled proportionally for tiny fonts so glyphs remain crisp on high-DPI screens
    ctx.lineWidth = Math.max(0.5, Math.min(1.5 / effScale, targetTextSize * 0.22));
    ctx.strokeText(labelText, region.centroidX, region.centroidY);
    ctx.fillText(labelText, region.centroidX, region.centroidY);
  }
}
