import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  highlightMatching: boolean;
  highlightStyle: RegionHighlightStyle;
  hintColorArgb: number;
  hintFillStyle: HintFillStyle;
  animateHint: boolean;
  showNextRegionHint: boolean;
  hintIntensity: number;
  displayNumberMap: Map<number, string>;
  zoomInTrigger?: number;
  zoomOutTrigger?: number;
  resetViewTrigger?: number;
  initialZoomScale?: number;
  initialPanOffsetX?: number;
  initialPanOffsetY?: number;
  onViewExtentChanged?: (zoom: number, panX: number, panY: number) => void;
  onRegionClicked: (regionId: number) => void;
  onBatchRegionsClicked: (regionIds: Set<number>) => void;
  onVisibleColorsChanged: (colorIds: Set<number>) => void;
  onVisibleRegionsChanged: (regionIds: Set<number>) => void;
  onTogglePreview: () => void;
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
  containerHeight: number
): { x: number; y: number } {
  if (containerWidth <= 0 || containerHeight <= 0 || puzzleWidth <= 0 || puzzleHeight <= 0) {
    return rawOffset;
  }

  const baseScale = Math.min(containerWidth / puzzleWidth, containerHeight / puzzleHeight) * 0.92;
  const effScale = scale * baseScale;
  const artW = puzzleWidth * effScale;
  const artH = puzzleHeight * effScale;
  const baseOffsetX = (containerWidth - puzzleWidth * baseScale) / 2;
  const baseOffsetY = (containerHeight - puzzleHeight * baseScale) / 2;

  // Safe boundary margin: allows small rubber-band edge feel without losing the artwork
  const marginX = Math.min(50, containerWidth * 0.12);
  const marginY = Math.min(50, containerHeight * 0.12);

  let minOffsetX: number;
  let maxOffsetX: number;
  let minOffsetY: number;
  let maxOffsetY: number;

  if (artW <= containerWidth) {
    minOffsetX = -marginX;
    maxOffsetX = marginX;
  } else {
    minOffsetX = containerWidth - marginX - baseOffsetX - artW;
    maxOffsetX = marginX - baseOffsetX;
  }

  if (artH <= containerHeight) {
    minOffsetY = -marginY;
    maxOffsetY = marginY;
  } else {
    minOffsetY = containerHeight - marginY - baseOffsetY - artH;
    maxOffsetY = marginY - baseOffsetY;
  }

  return {
    x: Math.max(minOffsetX, Math.min(maxOffsetX, rawOffset.x)),
    y: Math.max(minOffsetY, Math.min(maxOffsetY, rawOffset.y)),
  };
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
  regionColorMode,
  showRegionLabels,
  showPreviewLabels,
  showPreviewBorders,
  labelScale,
  highlightMatching,
  highlightStyle,
  hintColorArgb,
  hintFillStyle,
  animateHint,
  showNextRegionHint,
  hintIntensity,
  displayNumberMap,
  zoomInTrigger = 0,
  zoomOutTrigger = 0,
  resetViewTrigger = 0,
  initialZoomScale = 1.0,
  initialPanOffsetX = 0,
  initialPanOffsetY = 0,
  onViewExtentChanged,
  onRegionClicked,
  onBatchRegionsClicked,
  onVisibleColorsChanged,
  onVisibleRegionsChanged,
  onTogglePreview,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Offscreen cached layer canvases (prevents 60 FPS full-pixel iteration)
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseImageDataRef = useRef<ImageData | null>(null);
  const paintedCacheRef = useRef<Set<number>>(new Set());
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

  // Interactive feedback
  const [tapDot, setTapDot] = useState<{ x: number; y: number; alpha: number } | null>(null);

  // Animation pulse
  const [pulseAlpha, setPulseAlpha] = useState(0.6);

  // Drag & Pinch interaction tracking
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastPointerPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const totalDragDistanceRef = useRef(0);
  const isRightClickRef = useRef(false);
  const touchStartDistRef = useRef<number | null>(null);
  const touchLastCenterRef = useRef<{ x: number; y: number } | null>(null);
  const initialTouchScaleRef = useRef(1);
  const lastTapTimeRef = useRef(0);

  // Reset zoom/offset when a brand-new puzzle object is loaded
  useEffect(() => {
    setScale(initialZoomScale);
    setOffset({ x: initialPanOffsetX, y: initialPanOffsetY });
  }, [puzzle]);

  // Handle FloatingActions zoom in/out button triggers
  useEffect(() => {
    if (zoomInTrigger <= 0 || !containerRef.current || !puzzle) return;
    const newScale = Math.min(12.0, scale * 1.25);
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    setScale(newScale);
    setOffset((prev) => clampCanvasOffset(prev, newScale, puzzle.width, puzzle.height, w, h));
  }, [zoomInTrigger]);

  useEffect(() => {
    if (zoomOutTrigger <= 0 || !containerRef.current || !puzzle) return;
    const newScale = Math.max(0.5, scale * 0.8);
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    setScale(newScale);
    setOffset((prev) => clampCanvasOffset(prev, newScale, puzzle.width, puzzle.height, w, h));
  }, [zoomOutTrigger]);

  useEffect(() => {
    if (resetViewTrigger <= 0) return;
    setScale(1.0);
    setOffset({ x: 0, y: 0 });
  }, [resetViewTrigger]);

  // Ensure offset is strictly clamped whenever scale or container size changes
  useEffect(() => {
    if (!containerRef.current || !puzzle) return;
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    setOffset((prev) => clampCanvasOffset(prev, scale, puzzle.width, puzzle.height, w, h));
  }, [scale, puzzle]);

  // Pulse animation frame (only runs when animateHint is active)
  useEffect(() => {
    let animId: number;
    const startTime = performance.now();

    const loop = (now: number) => {
      const elapsed = now - startTime;
      const t = (Math.sin(elapsed / 250) + 1) / 2; // 0 to 1
      setPulseAlpha(0.35 + t * 0.6);
      animId = requestAnimationFrame(loop);
    };

    if (animateHint) {
      animId = requestAnimationFrame(loop);
    } else {
      setPulseAlpha(0.7);
    }

    return () => cancelAnimationFrame(animId);
  }, [animateHint]);

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
      lastBasePuzzleRef.current = puzzle;
      lastBaseModeRef.current = regionColorMode;
      lastBaseImageRef.current = sourceImage;
      lastBaseFreeColorRef.current = isFreeColorMode;
      return;
    }

    // Incremental update: repaint regions whose filled status or painted color changed!
    const prevPainted = paintedCacheRef.current;
    const prevColors = prevColorsRef.current;
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

    // Check newly filled or repainted regions
    for (const rId of filledRegionIds) {
      const curCol = paintedRegionColors?.get(rId);
      const prevCol = prevColors.get(rId);
      const colorChanged = curCol !== undefined && curCol !== prevCol;

      if (!prevPainted.has(rId) || colorChanged) {
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
        }
      }
    }

    // Check any regions that were unfilled (e.g., Reset Progress)
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
        }
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

    paintedCacheRef.current = new Set(filledRegionIds);
    prevColorsRef.current = new Map(paintedRegionColors || []);
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
    const isBoundaryOnly = highlightStyle === 'BOUNDARY_ONLY';
    let anyPixel = false;

    for (const reg of puzzle.regions) {
      if (filledRegionIds.has(reg.id)) continue;
      const isHinted = reg.id === hintRegionId;
      const isActive = reg.colorId === activeColorId;

      if (!isHinted && (!highlightMatching || !isActive)) continue;

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
          data[pIdx] = hr;
          data[pIdx + 1] = hg;
          data[pIdx + 2] = hb;
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
    const isZoomedIn = scale > 1.05;
    if (showNextRegionHint && isZoomedIn && !isOnScreen) {
      const targetX = w / 2 - baseOffsetX - region.centroidX * effScale;
      const targetY = h / 2 - baseOffsetY - region.centroidY * effScale;
      setOffset(
        clampCanvasOffset({ x: targetX, y: targetY }, scale, puzzle.width, puzzle.height, w, h)
      );
    }
  }, [hintRegionId, puzzle, showNextRegionHint]);

  // Notify view extent updates
  useEffect(() => {
    onViewExtentChanged?.(scale, offset.x, offset.y);
  }, [scale, offset, onViewExtentChanged]);

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
      const effScale = scale * baseScale;

      if (effScale <= 0) return null;

      const canvasX = (screenX - offset.x - baseOffsetX) / effScale;
      const canvasY = (screenY - offset.y - baseOffsetY) / effScale;

      return { x: canvasX, y: canvasY, screenX, screenY };
    },
    [puzzle, scale, offset]
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

      onVisibleColorsChanged(colorSet);
      onVisibleRegionsChanged(regionSet);
    }, 80);

    return () => clearTimeout(timer);
  }, [scale, offset, puzzle, filledRegionIds, onVisibleColorsChanged, onVisibleRegionsChanged]);

  // Main GPU-Accelerated Composite Rendering Loop
  useEffect(() => {
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
    ctx.fillStyle = CANVAS_BG_MAP[canvasBgColor]?.hex || '#000000';
    ctx.fillRect(0, 0, w, h);

    if (!puzzle) {
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

      // 2. Draw Highlight Overlay Layer with hardware-accelerated alpha pulse
      if (
        hasHighlightPixelsRef.current &&
        highlightCanvasRef.current &&
        (highlightStyle === 'FULL_REGION' || highlightStyle === 'BOUNDARY_ONLY')
      ) {
        ctx.save();
        ctx.globalAlpha = animateHint
          ? Math.min(1, Math.max(0.05, pulseAlpha * hintIntensity))
          : Math.min(1, Math.max(0.05, hintIntensity * 0.78));
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
        hintIntensity,
        pulseAlpha,
        animateHint,
        effScale,
        labelScale,
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

    ctx.restore(); // Transform restore
    ctx.restore(); // DPR scale restore
  }, [
    puzzle,
    sourceImage,
    scale,
    offset,
    activeColorId,
    filledRegionIds,
    hintRegionId,
    isPreviewMode,
    isFreeColorMode,
    canvasBgColor,
    regionColorMode,
    showRegionLabels,
    showPreviewLabels,
    showPreviewBorders,
    labelScale,
    highlightMatching,
    highlightStyle,
    hintColorArgb,
    hintFillStyle,
    animateHint,
    hintIntensity,
    displayNumberMap,
    pulseAlpha,
    tapDot,
  ]);

  // Pointer event handlers for touch/mouse
  const handlePointerDown = (e: React.PointerEvent) => {
    const isRightClick = e.button === 2 || (e.buttons & 2) !== 0;
    isRightClickRef.current = isRightClick;

    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
    totalDragDistanceRef.current = 0;

    const coords = screenToCanvasCoords(e.clientX, e.clientY);
    if (!coords || !puzzle) return;

    if (!isRightClick && isPaintMode && !isPreviewMode) {
      hitTestAndPaintLine(coords.x, coords.y, coords.x, coords.y);
      setTapDot({ x: coords.x, y: coords.y, alpha: 1 });
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current || touchStartDistRef.current !== null) return;

    const dx = e.clientX - lastPointerPosRef.current.x;
    const dy = e.clientY - lastPointerPosRef.current.y;
    totalDragDistanceRef.current += Math.hypot(dx, dy);

    const prevCoords = screenToCanvasCoords(lastPointerPosRef.current.x, lastPointerPosRef.current.y);
    const currCoords = screenToCanvasCoords(e.clientX, e.clientY);

    lastPointerPosRef.current = { x: e.clientX, y: e.clientY };

    const isRightClick = isRightClickRef.current || (e.buttons & 2) !== 0;

    if (!isRightClick && isPaintMode && !isPreviewMode && prevCoords && currCoords) {
      hitTestAndPaintLine(prevCoords.x, prevCoords.y, currCoords.x, currCoords.y);
      setTapDot({ x: currCoords.x, y: currCoords.y, alpha: 1 });
    } else {
      setOffset((prev) => {
        const container = containerRef.current;
        if (!container || !puzzle) return { x: prev.x + dx, y: prev.y + dy };
        const w = container.clientWidth;
        const h = container.clientHeight;
        return clampCanvasOffset(
          { x: prev.x + dx, y: prev.y + dy },
          scale,
          puzzle.width,
          puzzle.height,
          w,
          h
        );
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const wasRightClick = isRightClickRef.current;
    isDraggingRef.current = false;
    isRightClickRef.current = false;

    if (wasRightClick || touchStartDistRef.current !== null) return;

    // Single tap detection with 3x3 neighborhood micro-region fallback
    if (totalDragDistanceRef.current < 12) {
      const now = Date.now();
      const timeSinceLastTap = now - lastTapTimeRef.current;
      lastTapTimeRef.current = now;

      // Double-tap resets camera zoom and center
      if (timeSinceLastTap < 300 && (scale > 1.05 || Math.abs(offset.x) > 5 || Math.abs(offset.y) > 5)) {
        setScale(1.0);
        setOffset({ x: 0, y: 0 });
        return;
      }
      if (isPreviewMode) {
        onTogglePreview();
      } else if (!isPaintMode) {
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
      }
    }
  };

  // Wheel zoom around cursor
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current || !puzzle) return;

    const zoomFactor = e.deltaY < 0 ? 1.2 : 0.82;
    const newScale = Math.min(12.0, Math.max(0.5, scale * zoomFactor));
    const actualZoom = newScale / scale;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
    const baseOffsetX = (w - puzzle.width * baseScale) / 2;
    const baseOffsetY = (h - puzzle.height * baseScale) / 2;

    const focalX = mouseX - (offset.x + baseOffsetX);
    const focalY = mouseY - (offset.y + baseOffsetY);

    const targetOffset = {
      x: offset.x - focalX * (actualZoom - 1),
      y: offset.y - focalY * (actualZoom - 1),
    };
    setOffset(clampCanvasOffset(targetOffset, newScale, puzzle.width, puzzle.height, w, h));
    setScale(newScale);
  };

  // Multi-touch 2-finger focal-point pinch-to-zoom & pan
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      isDraggingRef.current = false;
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      touchStartDistRef.current = Math.max(1, dist);
      touchLastCenterRef.current = {
        x: (t0.clientX + t1.clientX) / 2,
        y: (t0.clientY + t1.clientY) / 2,
      };
      initialTouchScaleRef.current = scale;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (
      e.touches.length === 2 &&
      touchStartDistRef.current !== null &&
      touchLastCenterRef.current !== null &&
      containerRef.current &&
      canvasRef.current &&
      puzzle
    ) {
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      const centerX = (t0.clientX + t1.clientX) / 2;
      const centerY = (t0.clientY + t1.clientY) / 2;

      const ratio = dist / touchStartDistRef.current;
      const newScale = Math.min(12.0, Math.max(0.5, initialTouchScaleRef.current * ratio));
      const actualZoom = newScale / scale;

      const rect = canvasRef.current.getBoundingClientRect();
      const focalScreenX = centerX - rect.left;
      const focalScreenY = centerY - rect.top;

      const panDx = centerX - touchLastCenterRef.current.x;
      const panDy = centerY - touchLastCenterRef.current.y;
      touchLastCenterRef.current = { x: centerX, y: centerY };

      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      const baseScale = Math.min(w / puzzle.width, h / puzzle.height) * 0.92;
      const baseOffsetX = (w - puzzle.width * baseScale) / 2;
      const baseOffsetY = (h - puzzle.height * baseScale) / 2;

      const focalX = focalScreenX - (offset.x + baseOffsetX);
      const focalY = focalScreenY - (offset.y + baseOffsetY);

      setOffset((prev) => {
        const targetOffset = {
          x: prev.x + panDx - focalX * (actualZoom - 1),
          y: prev.y + panDy - focalY * (actualZoom - 1),
        };
        return clampCanvasOffset(targetOffset, newScale, puzzle.width, puzzle.height, w, h);
      });
      setScale(newScale);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      touchStartDistRef.current = null;
      touchLastCenterRef.current = null;
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
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
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
  hintIntensity: number,
  pulseAlpha: number,
  animateHint: boolean,
  effScale: number,
  labelScale: number,
  visLeft: number,
  visTop: number,
  visRight: number,
  visBottom: number,
  isEffectivePreview: boolean
) {
  const drawGlowCircle = highlightStyle === 'CENTROID_GLOW';
  const isNumberOnly = highlightStyle === 'NUMBER_ONLY';

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

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

    // Glowing matching circle (only in puzzle mode)
    if (!isEffectivePreview && isActive && highlightMatching && drawGlowCircle) {
      const alpha = animateHint ? pulseAlpha * hintIntensity * 0.8 : hintIntensity * 0.7;
      ctx.beginPath();
      const radius = Math.max(4 / effScale, minDim * 0.18);
      ctx.arc(region.centroidX, region.centroidY, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(251, 191, 36, ${alpha})`;
      ctx.fill();
    }

    // Glowing hinted region circle (only in puzzle mode)
    if (!isEffectivePreview && isHinted && (drawGlowCircle || isNumberOnly)) {
      const alpha = animateHint ? pulseAlpha * hintIntensity * 0.95 : hintIntensity * 0.9;
      ctx.beginPath();
      const radius = Math.max(8 / effScale, minDim * 0.45);
      ctx.arc(region.centroidX, region.centroidY, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(245, 158, 11, ${alpha})`;
      ctx.fill();
    }

    if (!drawLabelsNow) continue;

    // Tiny regions skip when unzoomed (unless active or hinted)
    if (
      !isActive &&
      !isHinted &&
      (minDim * effScale < 14 || (region.maxRadius > 0 && region.maxRadius * effScale < 7))
    ) {
      continue;
    }

    const baseFontSize = isActive || isHinted ? 18 : 15;
    const defaultTextSize = (baseFontSize * labelScale) / effScale;
    const regionMaxTextSize =
      region.maxRadius > 0 ? region.maxRadius * 1.35 * labelScale : defaultTextSize;

    const targetTextSize = Math.max(
      (6 * labelScale) / effScale,
      Math.min(defaultTextSize, regionMaxTextSize, (24 * labelScale) / effScale)
    );

    // Badge circle background
    if (!isEffectivePreview) {
      const bgRadius = targetTextSize * 0.62;
      ctx.beginPath();
      ctx.arc(region.centroidX, region.centroidY, bgRadius, 0, Math.PI * 2);

      if (isNumberOnly && (isActive || isHinted)) {
        const pulseCol = isHinted
          ? `rgba(245, 158, 11, ${pulseAlpha * 0.9})`
          : `rgba(251, 191, 36, ${pulseAlpha * 0.85})`;
        ctx.fillStyle = pulseCol;
      } else if (isActive || isHinted) {
        ctx.fillStyle = 'rgba(254, 243, 199, 0.92)';
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
      }
      ctx.fill();
    }

    // Label number text
    ctx.font = `600 ${targetTextSize}px "Inter", -apple-system, sans-serif`;
    ctx.fillStyle = isHinted
      ? '#b45309'
      : isActive
      ? '#d97706'
      : isEffectivePreview
      ? '#0f172a'
      : '#334155';

    const labelText = displayNumberMap.get(region.colorId) || region.colorId.toString();
    ctx.fillText(labelText, region.centroidX, region.centroidY);
  }
}
