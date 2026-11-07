import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CANVAS_BG_MAP,
  CanvasBgColor,
  HintFillStyle,
  PaletteColor,
  PaletteSortOrder,
  PuzzleData,
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

export const PuzzleCanvas: React.FC<PuzzleCanvasProps> = ({
  puzzle,
  sourceImage,
  activeColorId,
  filledRegionIds,
  hintRegionId,
  isPreviewMode,
  isPaintMode,
  canvasBgColor,
  sortOrder,
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

  // Transform state
  const [scale, setScale] = useState(initialZoomScale);
  const [offset, setOffset] = useState({ x: initialPanOffsetX, y: initialPanOffsetY });

  // Interactive feedback
  const [tapDot, setTapDot] = useState<{ x: number; y: number; alpha: number } | null>(null);

  // Animation pulse
  const [pulseAlpha, setPulseAlpha] = useState(0.6);

  // Drag interaction tracking
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastPointerPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const totalDragDistanceRef = useRef(0);
  const isRightClickRef = useRef(false);
  const touchStartDistRef = useRef<number | null>(null);
  const initialTouchScaleRef = useRef(1);

  // Pulse animation frame
  useEffect(() => {
    let animId: number;
    let startTime = performance.now();

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

  // Pan to center hinted region
  useEffect(() => {
    if (!puzzle || hintRegionId === null || !containerRef.current) return;
    const region = puzzle.regions.find((r) => r.id === hintRegionId);
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

    if (showNextRegionHint || !isOnScreen) {
      const targetX = w / 2 - baseOffsetX - region.centroidX * effScale;
      const targetY = h / 2 - baseOffsetY - region.centroidY * effScale;
      setOffset({ x: targetX, y: targetY });
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

  // Main rendering loop onto HTML5 Canvas
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

    ctx.save();
    ctx.translate(offset.x + baseOffsetX, offset.y + baseOffsetY);
    ctx.scale(effScale, effScale);

    const isEffectivePreview = isPreviewMode;

    // 1. Draw Layer: Completed Artwork / Preview Artwork
    if (isEffectivePreview) {
      if (sourceImage && sourceImage.complete) {
        ctx.drawImage(sourceImage, 0, 0, puzzle.width, puzzle.height);
      } else {
        // Fallback: draw solid palette color fills
        renderSolidColors(ctx, puzzle, new Set(puzzle.regions.map((r) => r.id)));
      }

      if (showPreviewBorders) {
        renderBorders(ctx, puzzle);
      }
    } else {
      // Vector puzzle mode
      if (regionColorMode === 'DETAIL' && sourceImage && sourceImage.complete) {
        // Layer 1: original image underneath
        ctx.drawImage(sourceImage, 0, 0, puzzle.width, puzzle.height);
      } else {
        // Layer 1: solid color fills for painted regions
        renderSolidColors(ctx, puzzle, filledRegionIds);
      }

      // Layer 2: Unfilled regions mask (off-white) + Hairline Borders
      renderUnfilledMaskAndBorders(ctx, puzzle, filledRegionIds, regionColorMode === 'DETAIL');

      // Layer 3: Hint & Active Color matching highlights
      renderHighlights(
        ctx,
        puzzle,
        activeColorId,
        hintRegionId,
        filledRegionIds,
        highlightMatching,
        highlightStyle,
        hintFillStyle,
        hintColorArgb,
        pulseAlpha,
        hintIntensity,
        animateHint
      );
    }

    // Layer 4: Number labels
    const drawLabelsNow = isEffectivePreview
      ? showRegionLabels && showPreviewLabels
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

    // Layer 5: Tap feedback animation dot
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
    // Detect right click: button 2 or secondary mouse button
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
    if (!isDraggingRef.current) return;

    const dx = e.clientX - lastPointerPosRef.current.x;
    const dy = e.clientY - lastPointerPosRef.current.y;
    totalDragDistanceRef.current += Math.hypot(dx, dy);

    const prevCoords = screenToCanvasCoords(lastPointerPosRef.current.x, lastPointerPosRef.current.y);
    const currCoords = screenToCanvasCoords(e.clientX, e.clientY);

    lastPointerPosRef.current = { x: e.clientX, y: e.clientY };

    const isRightClick = isRightClickRef.current || (e.buttons & 2) !== 0;

    // Paint only on left-click in paint mode; right-click pans canvas
    if (!isRightClick && isPaintMode && !isPreviewMode && prevCoords && currCoords) {
      hitTestAndPaintLine(prevCoords.x, prevCoords.y, currCoords.x, currCoords.y);
      setTapDot({ x: currCoords.x, y: currCoords.y, alpha: 1 });
    } else {
      // Pan canvas
      setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const wasRightClick = isRightClickRef.current;
    isDraggingRef.current = false;
    isRightClickRef.current = false;

    // Do not trigger single-tap painting or preview if right-click was used
    if (wasRightClick) return;

    // Single tap detection
    if (totalDragDistanceRef.current < 12) {
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

    setOffset({
      x: offset.x - focalX * (actualZoom - 1),
      y: offset.y - focalY * (actualZoom - 1),
    });
    setScale(newScale);
  };

  // Multi-touch pinch to zoom
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartDistRef.current = dist;
      initialTouchScaleRef.current = scale;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartDistRef.current !== null) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = dist / touchStartDistRef.current;
      const newScale = Math.min(12.0, Math.max(0.5, initialTouchScaleRef.current * ratio));
      setScale(newScale);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      touchStartDistRef.current = null;
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

// --- Canvas Sub-rendering Functions ---

function renderSolidColors(
  ctx: CanvasRenderingContext2D,
  puzzle: PuzzleData,
  paintedSet: Set<number>
) {
  const { width, height, regions, palette } = puzzle;
  const paletteMap = new Map<number, PaletteColor>(palette.map((p) => [p.id, p]));

  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  for (const region of regions) {
    if (!paintedSet.has(region.id)) continue;
    const color = paletteMap.get(region.colorId);
    if (!color) continue;

    const r = color.r;
    const g = color.g;
    const b = color.b;

    for (let i = 0; i < region.pixels.length; i++) {
      const idx = region.pixels[i] * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  // Draw offscreen
  const offCanvas = document.createElement('canvas');
  offCanvas.width = width;
  offCanvas.height = height;
  const offCtx = offCanvas.getContext('2d')!;
  offCtx.putImageData(imgData, 0, 0);
  ctx.drawImage(offCanvas, 0, 0);
}

function renderUnfilledMaskAndBorders(
  ctx: CanvasRenderingContext2D,
  puzzle: PuzzleData,
  filledRegionIds: Set<number>,
  isDetailMode: boolean
) {
  const { width, height, regionMap, borderMap, regions, palette } = puzzle;
  const paletteMap = new Map<number, PaletteColor>(palette.map((p) => [p.id, p]));
  const regionMapLookup = new Map<number, number>();
  for (const r of regions) {
    regionMapLookup.set(r.id, r.colorId);
  }

  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;
  const total = width * height;

  for (let i = 0; i < total; i++) {
    const rId = regionMap[i];
    const isFilled = filledRegionIds.has(rId);
    const isBorder = borderMap[i] === 1;
    const idx = i * 4;

    if (isFilled) {
      if (isBorder) {
        // Subtle outline on painted regions to keep the line-art styling neat
        const colorId = regionMapLookup.get(rId);
        const col = colorId ? paletteMap.get(colorId) : undefined;
        if (col) {
          data[idx] = Math.floor(col.r * 0.72);
          data[idx + 1] = Math.floor(col.g * 0.72);
          data[idx + 2] = Math.floor(col.b * 0.72);
          data[idx + 3] = 255;
        } else {
          data[idx] = 71;
          data[idx + 1] = 85;
          data[idx + 2] = 105;
          data[idx + 3] = 255;
        }
      }
      // If interior of painted region, leave alpha = 0 so Layer 1 (renderSolidColors) shines through!
    } else {
      // Unfilled region: pure crisp canvas paper with dark line art ink boundaries
      if (isBorder) {
        // Crisp dark line-art ink outline (#334155 Slate-700)
        data[idx] = 51;
        data[idx + 1] = 65;
        data[idx + 2] = 85;
        data[idx + 3] = 255;
      } else {
        // Pure crisp white canvas coloring sheet
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = 255;
      }
    }
  }

  const offCanvas = document.createElement('canvas');
  offCanvas.width = width;
  offCanvas.height = height;
  const offCtx = offCanvas.getContext('2d')!;
  offCtx.putImageData(imgData, 0, 0);
  ctx.drawImage(offCanvas, 0, 0);
}

function renderBorders(ctx: CanvasRenderingContext2D, puzzle: PuzzleData) {
  const { width, height, borderMap } = puzzle;
  const imgData = ctx.createImageData(width, height);
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

  const offCanvas = document.createElement('canvas');
  offCanvas.width = width;
  offCanvas.height = height;
  const offCtx = offCanvas.getContext('2d')!;
  offCtx.putImageData(imgData, 0, 0);
  ctx.drawImage(offCanvas, 0, 0);
}

function renderHighlights(
  ctx: CanvasRenderingContext2D,
  puzzle: PuzzleData,
  activeColorId: number,
  hintRegionId: number | null,
  filledRegionIds: Set<number>,
  highlightMatching: boolean,
  highlightStyle: RegionHighlightStyle,
  hintFillStyle: HintFillStyle,
  hintColorArgb: number,
  pulseAlpha: number,
  hintIntensity: number,
  animateHint: boolean
) {
  if (highlightStyle !== 'FULL_REGION') return;

  const { width, height } = puzzle;
  const hr = (hintColorArgb >> 16) & 0xff;
  const hg = (hintColorArgb >> 8) & 0xff;
  const hb = hintColorArgb & 0xff;

  const effAlpha = animateHint
    ? Math.floor(pulseAlpha * hintIntensity * 255)
    : Math.floor(hintIntensity * 200);

  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  for (const reg of puzzle.regions) {
    if (filledRegionIds.has(reg.id)) continue;
    const isHinted = reg.id === hintRegionId;
    const isActive = reg.colorId === activeColorId;

    if (!isHinted && (!highlightMatching || !isActive)) continue;

    for (let i = 0; i < reg.pixels.length; i++) {
      const idx = reg.pixels[i];
      const px = idx % width;
      const py = Math.floor(idx / width);

      let shouldFill = true;
      if (hintFillStyle === 'CHECKER') {
        shouldFill = (Math.floor(px / 4) + Math.floor(py / 4)) % 2 === 0;
      } else if (hintFillStyle === 'STRIPES') {
        shouldFill = Math.floor((px + py) / 4) % 2 === 0;
      }

      if (shouldFill) {
        const pIdx = idx * 4;
        data[pIdx] = hr;
        data[pIdx + 1] = hg;
        data[pIdx + 2] = hb;
        data[pIdx + 3] = effAlpha;
      }
    }
  }

  const offCanvas = document.createElement('canvas');
  offCanvas.width = width;
  offCanvas.height = height;
  const offCtx = offCanvas.getContext('2d')!;
  offCtx.putImageData(imgData, 0, 0);
  ctx.drawImage(offCanvas, 0, 0);
}

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

    // Viewport culling
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

    // Glowing matching circle
    if (isActive && highlightMatching && drawGlowCircle) {
      const alpha = animateHint ? pulseAlpha * hintIntensity * 0.8 : hintIntensity * 0.7;
      ctx.beginPath();
      const radius = Math.max(4 / effScale, minDim * 0.18);
      ctx.arc(region.centroidX, region.centroidY, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(251, 191, 36, ${alpha})`;
      ctx.fill();
    }

    // Glowing hinted region circle
    if (isHinted && (drawGlowCircle || isNumberOnly)) {
      const alpha = animateHint ? pulseAlpha * hintIntensity * 0.95 : hintIntensity * 0.9;
      ctx.beginPath();
      const radius = Math.max(8 / effScale, minDim * 0.45);
      ctx.arc(region.centroidX, region.centroidY, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(245, 158, 11, ${alpha})`;
      ctx.fill();
    }

    if (!drawLabelsNow) continue;

    // Tiny regions skip when zoomed way out
    if (minDim * effScale < 6 && !isActive && !isHinted) {
      continue;
    }

    const baseFontSize = isActive || isHinted ? 18 : 15;
    const defaultTextSize = (baseFontSize * labelScale) / effScale;
    const regionMaxTextSize =
      region.maxRadius > 0 ? (region.maxRadius * 1.35 * labelScale) : defaultTextSize;

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
        ctx.fillStyle = 'rgba(254, 243, 199, 0.92)'; // Light amber
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.82)'; // Clean white pill
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
