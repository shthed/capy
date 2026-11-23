import { NestedPuzzleLayer, PaletteColor, PuzzleData, Region } from '../types';
import {
  WORLD_BOUNDS_EPSILON,
  getSortedNestedLayersAsc,
  isValidNormalizedRect,
} from '../engine/UnifiedPuzzleLayers';
import { NativeBridge } from './NativeBridge';

export interface PrintableSvgOptions {
  title?: string;
  palette?: PaletteColor[];
}

function stripIllegalXmlChars(input: string): string {
  let result = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (
      code <= 0x08 ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      code === 0xfffe ||
      code === 0xffff
    ) {
      continue;
    }
    result += input[i];
  }
  return result;
}

export function escapeSvgXml(value: string): string {
  return stripIllegalXmlChars(String(value))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function sanitizeColoringSheetFileName(title?: string): string {
  const base = (title || 'capy-puzzle')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'capy-puzzle'}-coloring-sheet.svg`;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function formatCoord(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '');
}

interface InteriorSeamEdges {
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
}

function appendHorizontalInteriorRuns(
  segments: string[],
  regionMap: Int32Array,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  scaleX: number,
  scaleY: number
): void {
  for (let y = 1; y < height; y++) {
    const prevRow = (y - 1) * width;
    const currRow = y * width;
    const wy = formatCoord(offsetY + y * scaleY);
    let runStart = -1;
    for (let x = 0; x < width; x++) {
      const a = regionMap[prevRow + x] > 0 ? regionMap[prevRow + x] : 0;
      const b = regionMap[currRow + x] > 0 ? regionMap[currRow + x] : 0;
      if (a !== b) {
        if (runStart < 0) runStart = x;
      } else if (runStart >= 0) {
        segments.push(
          `M${formatCoord(offsetX + runStart * scaleX)} ${wy}H${formatCoord(offsetX + x * scaleX)}`
        );
        runStart = -1;
      }
    }
    if (runStart >= 0) {
      segments.push(
        `M${formatCoord(offsetX + runStart * scaleX)} ${wy}H${formatCoord(offsetX + width * scaleX)}`
      );
    }
  }
}

function appendVerticalInteriorRuns(
  segments: string[],
  regionMap: Int32Array,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  scaleX: number,
  scaleY: number
): void {
  for (let x = 1; x < width; x++) {
    const wx = formatCoord(offsetX + x * scaleX);
    let runStart = -1;
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      const a = regionMap[rowOffset + x - 1] > 0 ? regionMap[rowOffset + x - 1] : 0;
      const b = regionMap[rowOffset + x] > 0 ? regionMap[rowOffset + x] : 0;
      if (a !== b) {
        if (runStart < 0) runStart = y;
      } else if (runStart >= 0) {
        segments.push(
          `M${wx} ${formatCoord(offsetY + runStart * scaleY)}V${formatCoord(offsetY + y * scaleY)}`
        );
        runStart = -1;
      }
    }
    if (runStart >= 0) {
      segments.push(
        `M${wx} ${formatCoord(offsetY + runStart * scaleY)}V${formatCoord(offsetY + height * scaleY)}`
      );
    }
  }
}

function appendActiveRowSeam(
  segments: string[],
  regionMap: Int32Array,
  rowOffset: number,
  width: number,
  offsetX: number,
  scaleX: number,
  worldY: string
): void {
  let runStart = -1;
  for (let x = 0; x < width; x++) {
    if (regionMap[rowOffset + x] > 0) {
      if (runStart < 0) runStart = x;
    } else if (runStart >= 0) {
      segments.push(
        `M${formatCoord(offsetX + runStart * scaleX)} ${worldY}H${formatCoord(offsetX + x * scaleX)}`
      );
      runStart = -1;
    }
  }
  if (runStart >= 0) {
    segments.push(
      `M${formatCoord(offsetX + runStart * scaleX)} ${worldY}H${formatCoord(offsetX + width * scaleX)}`
    );
  }
}

function appendActiveColSeam(
  segments: string[],
  regionMap: Int32Array,
  colX: number,
  width: number,
  height: number,
  offsetY: number,
  scaleY: number,
  worldX: string
): void {
  let runStart = -1;
  for (let y = 0; y < height; y++) {
    if (regionMap[y * width + colX] > 0) {
      if (runStart < 0) runStart = y;
    } else if (runStart >= 0) {
      segments.push(
        `M${worldX} ${formatCoord(offsetY + runStart * scaleY)}V${formatCoord(offsetY + y * scaleY)}`
      );
      runStart = -1;
    }
  }
  if (runStart >= 0) {
    segments.push(
      `M${worldX} ${formatCoord(offsetY + runStart * scaleY)}V${formatCoord(offsetY + height * scaleY)}`
    );
  }
}

function appendBorderMapFallbackRuns(
  segments: string[],
  borderMap: Uint8Array,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  scaleX: number,
  scaleY: number
): void {
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const wy = formatCoord(offsetY + (y + 0.5) * scaleY);
    let runStart = -1;
    for (let x = 0; x < width; x++) {
      if (borderMap[row + x] > 0) {
        if (runStart < 0) runStart = x;
      } else if (runStart >= 0) {
        segments.push(
          `M${formatCoord(offsetX + runStart * scaleX)} ${wy}H${formatCoord(offsetX + x * scaleX)}`
        );
        runStart = -1;
      }
    }
    if (runStart >= 0) {
      segments.push(
        `M${formatCoord(offsetX + runStart * scaleX)} ${wy}H${formatCoord(offsetX + width * scaleX)}`
      );
    }
  }
}

/**
 * Traces collinear horizontal and vertical inter-region boundary runs from `regionMap`
 * (or falls back to `borderMap`) directly in sheet world coordinates.
 */
function traceGridBoundaryPath(
  width: number,
  height: number,
  regionMap: Int32Array | undefined,
  borderMap: Uint8Array | undefined,
  offsetX: number,
  offsetY: number,
  scaleX: number,
  scaleY: number,
  interiorEdges?: InteriorSeamEdges
): string {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(scaleX) ||
    !Number.isFinite(scaleY) ||
    scaleX <= 0 ||
    scaleY <= 0
  ) {
    return '';
  }

  const segments: string[] = [];
  const totalPixels = width * height;
  const hasValidRegionMap = Boolean(regionMap && regionMap.length >= totalPixels);

  if (hasValidRegionMap && regionMap) {
    appendHorizontalInteriorRuns(segments, regionMap, width, height, offsetX, offsetY, scaleX, scaleY);
    appendVerticalInteriorRuns(segments, regionMap, width, height, offsetX, offsetY, scaleX, scaleY);
    if (interiorEdges) {
      if (interiorEdges.top) {
        appendActiveRowSeam(segments, regionMap, 0, width, offsetX, scaleX, formatCoord(offsetY));
      }
      if (interiorEdges.bottom) {
        appendActiveRowSeam(
          segments,
          regionMap,
          (height - 1) * width,
          width,
          offsetX,
          scaleX,
          formatCoord(offsetY + height * scaleY)
        );
      }
      if (interiorEdges.left) {
        appendActiveColSeam(
          segments,
          regionMap,
          0,
          width,
          height,
          offsetY,
          scaleY,
          formatCoord(offsetX)
        );
      }
      if (interiorEdges.right) {
        appendActiveColSeam(
          segments,
          regionMap,
          width - 1,
          width,
          height,
          offsetY,
          scaleY,
          formatCoord(offsetX + width * scaleX)
        );
      }
    }
  } else if (borderMap && borderMap.length >= totalPixels) {
    appendBorderMapFallbackRuns(segments, borderMap, width, height, offsetX, offsetY, scaleX, scaleY);
  }

  return segments.join('');
}

function getValidSvgNestedLayers(puzzle: PuzzleData): NestedPuzzleLayer[] {
  const sorted = getSortedNestedLayersAsc(puzzle);
  const valid: NestedPuzzleLayer[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const layer = sorted[i];
    if (
      layer &&
      Number.isInteger(layer.width) &&
      Number.isInteger(layer.height) &&
      layer.width > 0 &&
      layer.height > 0 &&
      Number.isFinite(layer.depth) &&
      layer.depth >= 1 &&
      isValidNormalizedRect(layer.worldBounds)
    ) {
      valid.push(layer);
    }
  }
  return valid;
}

function resolveRegionDisplayNumber(
  region: Region,
  displayNumberByColorId: Map<number, number>
): number {
  const mapped = displayNumberByColorId.get(region.colorId);
  if (mapped !== undefined) return mapped;
  const maybeIndexed = (region as unknown as { colorIndex?: number }).colorIndex;
  if (typeof maybeIndexed === 'number' && Number.isFinite(maybeIndexed)) {
    return Math.max(1, Math.floor(maybeIndexed) + 1);
  }
  if (typeof region.colorId === 'number' && Number.isFinite(region.colorId)) {
    return Math.max(1, Math.floor(region.colorId));
  }
  return 1;
}

function resolveRegionRadius(region: Region): number {
  if (
    typeof region.maxRadius === 'number' &&
    Number.isFinite(region.maxRadius) &&
    region.maxRadius > 0
  ) {
    return region.maxRadius;
  }
  const fallbackRadius = (region as unknown as { radius?: number }).radius;
  if (
    typeof fallbackRadius === 'number' &&
    Number.isFinite(fallbackRadius) &&
    fallbackRadius > 0
  ) {
    return fallbackRadius;
  }
  if (typeof region.area === 'number' && Number.isFinite(region.area) && region.area > 0) {
    return Math.sqrt(region.area / Math.PI);
  }
  return 0;
}

function countRenderedRegions(
  rootRegions: readonly Region[] | null | undefined,
  validNestedLayers: readonly NestedPuzzleLayer[]
): number {
  let total = 0;
  if (Array.isArray(rootRegions)) {
    for (let i = 0; i < rootRegions.length; i++) {
      if (rootRegions[i]) total++;
    }
  }
  for (let i = 0; i < validNestedLayers.length; i++) {
    const layerRegions = validNestedLayers[i].regions;
    if (!Array.isArray(layerRegions)) continue;
    for (let j = 0; j < layerRegions.length; j++) {
      if (layerRegions[j]) total++;
    }
  }
  return total;
}

function appendRootLabelElements(
  labelElements: string[],
  regions: readonly Region[],
  displayNumberByColorId: Map<number, number>,
  artX: number,
  artY: number,
  minFont: number,
  maxFont: number
): void {
  for (const region of regions) {
    if (!region || !Number.isFinite(region.centroidX) || !Number.isFinite(region.centroidY)) continue;
    const radius = resolveRegionRadius(region);
    const safeArea =
      typeof region.area === 'number' && Number.isFinite(region.area) ? region.area : 0;
    if (radius <= 0 || (radius < 1.2 && safeArea < 4)) continue;
    const dispNum = resolveRegionDisplayNumber(region, displayNumberByColorId);
    const numStr = String(dispNum);
    const digitScale = numStr.length >= 3 ? 0.62 : numStr.length === 2 ? 0.76 : 0.92;
    const fontSize = clamp(radius * digitScale, minFont, maxFont);
    const cx = formatCoord(artX + region.centroidX);
    const cy = formatCoord(artY + region.centroidY);
    labelElements.push(
      `    <text x="${cx}" y="${cy}" font-size="${formatCoord(fontSize)}">${numStr}</text>`
    );
  }
}

function appendNestedLayerLabels(
  labelElements: string[],
  layer: NestedPuzzleLayer,
  displayNumberByColorId: Map<number, number>,
  wx: number,
  wy: number,
  scaleX: number,
  scaleY: number,
  layerScale: number,
  nestedMinFont: number,
  maxFont: number
): void {
  const layerRegions = Array.isArray(layer.regions) ? layer.regions : [];
  for (const region of layerRegions) {
    if (
      !region ||
      !Number.isFinite(region.centroidX) ||
      !Number.isFinite(region.centroidY) ||
      region.centroidX < 0 ||
      region.centroidX > layer.width ||
      region.centroidY < 0 ||
      region.centroidY > layer.height
    ) {
      continue;
    }
    const worldRadius = resolveRegionRadius(region) * layerScale;
    if (!Number.isFinite(worldRadius) || worldRadius <= 0) continue;
    const dispNum = resolveRegionDisplayNumber(region, displayNumberByColorId);
    const numStr = String(dispNum);
    const digitScale = numStr.length >= 3 ? 0.62 : numStr.length === 2 ? 0.76 : 0.92;
    const rawFont = worldRadius * digitScale;
    if (rawFont < nestedMinFont) continue;
    const fontSize = clamp(rawFont, nestedMinFont, maxFont);
    const cx = formatCoord(wx + region.centroidX * scaleX);
    const cy = formatCoord(wy + region.centroidY * scaleY);
    labelElements.push(
      `    <text x="${cx}" y="${cy}" font-size="${formatCoord(fontSize)}">${numStr}</text>`
    );
  }
}

function buildNestedSvgLayerElements(
  validNestedLayers: readonly NestedPuzzleLayer[],
  displayNumberByColorId: Map<number, number>,
  artX: number,
  artY: number,
  width: number,
  height: number,
  baseStrokeWidthNum: number,
  nestedMinFont: number,
  maxFont: number,
  labelElements: string[]
): string[] {
  const nestedOutlineElements: string[] = [];
  for (let i = 0; i < validNestedLayers.length; i++) {
    const layer = validNestedLayers[i];
    const b = layer.worldBounds;
    const wx = artX + b.x * width;
    const wy = artY + b.y * height;
    const scaleX = (b.width * width) / layer.width;
    const scaleY = (b.height * height) / layer.height;
    const layerScale = Math.min(scaleX, scaleY);

    const layerPathData = traceGridBoundaryPath(
      layer.width,
      layer.height,
      layer.regionMap,
      layer.borderMap,
      wx,
      wy,
      scaleX,
      scaleY,
      {
        top: b.y > WORLD_BOUNDS_EPSILON,
        bottom: b.y + b.height < 1 - WORLD_BOUNDS_EPSILON,
        left: b.x > WORLD_BOUNDS_EPSILON,
        right: b.x + b.width < 1 - WORLD_BOUNDS_EPSILON,
      }
    );

    if (layerPathData.length > 0) {
      const adaptiveStroke = formatCoord(
        clamp(
          baseStrokeWidthNum * Math.max(0.35, Math.min(1, Math.sqrt(layerScale))),
          0.25,
          baseStrokeWidthNum
        )
      );
      const safeLayerId = escapeSvgXml(layer.layerId || `layer-${i + 1}`);
      const safeDepth = Math.max(1, Math.floor(layer.depth));
      nestedOutlineElements.push(
        `    <g data-layer-id="${safeLayerId}" data-depth="${safeDepth}">`,
        `      <path d="${layerPathData}" fill="none" stroke="#1e293b" stroke-width="${adaptiveStroke}" stroke-linecap="square" stroke-linejoin="miter" />`,
        `    </g>`
      );
    }

    appendNestedLayerLabels(
      labelElements,
      layer,
      displayNumberByColorId,
      wx,
      wy,
      scaleX,
      scaleY,
      layerScale,
      nestedMinFont,
      maxFont
    );
  }
  return nestedOutlineElements;
}

function buildColorKeyLegendElements(
  effectivePalette: readonly PaletteColor[],
  width: number,
  artX: number,
  legendTop: number,
  legendCols: number,
  swatchRowHeight: number,
  legendHeaderHeight: number
): string[] {
  if (effectivePalette.length === 0) return [];
  const legendElements: string[] = [];
  const colWidth = width / legendCols;
  const chipSize = formatCoord(clamp(swatchRowHeight * 0.62, 11, 20));
  const legendFontSize = formatCoord(clamp(swatchRowHeight * 0.44, 9, 14));
  const sectionFontSize = formatCoord(clamp(legendHeaderHeight * 0.52, 10, 15));

  legendElements.push(
    `  <g id="color-key-legend" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif">`,
    `    <text x="${artX}" y="${formatCoord(legendTop + Number(sectionFontSize))}" font-size="${sectionFontSize}" font-weight="700" fill="#1e293b">Color Key (${effectivePalette.length} Colors)</text>`
  );

  effectivePalette.forEach((swatch, idx) => {
    const col = idx % legendCols;
    const row = Math.floor(idx / legendCols);
    const itemX = artX + col * colWidth;
    const itemY = legendTop + legendHeaderHeight + row * swatchRowHeight;
    const rawHex =
      typeof swatch?.hex === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(swatch.hex.trim())
        ? swatch.hex.trim().toUpperCase()
        : '#94A3B8';
    const safeHex = escapeSvgXml(rawHex);
    const numLabel = idx + 1;
    const textX = formatCoord(itemX + Number(chipSize) + 6);
    const textY = formatCoord(itemY + Number(chipSize) * 0.76);

    legendElements.push(
      `    <g data-swatch-number="${numLabel}">`,
      `      <rect x="${formatCoord(itemX)}" y="${formatCoord(itemY)}" width="${chipSize}" height="${chipSize}" rx="3" fill="${safeHex}" stroke="#1e293b" stroke-width="0.9" />`,
      `      <text x="${textX}" y="${textY}" font-size="${legendFontSize}" fill="#1e293b"><tspan font-weight="700">#${numLabel}</tspan> ${safeHex}</text>`,
      `    </g>`
    );
  });

  legendElements.push(`  </g>`);
  return legendElements;
}

/**
 * Generates a crisp, self-contained, print-ready monochrome `.svg` coloring sheet
 * with vector region outlines, centered color numbers, and a bottom swatch key legend.
 */
export function buildPrintableColoringSvg(
  puzzle: PuzzleData,
  options?: PrintableSvgOptions
): string {
  const rawW = Number.isFinite(puzzle.width) ? puzzle.width : 1;
  const rawH = Number.isFinite(puzzle.height) ? puzzle.height : 1;
  const width = Math.max(1, Math.round(rawW));
  const height = Math.max(1, Math.round(rawH));
  const rawTitle = (options?.title || 'Capy Coloring Sheet').trim() || 'Capy Coloring Sheet';
  const escapedTitle = escapeSvgXml(rawTitle);

  const rawPalette =
    options?.palette && options.palette.length > 0 ? options.palette : puzzle.palette || [];
  const effectivePalette = Array.isArray(rawPalette)
    ? rawPalette.filter(
        (swatch): swatch is PaletteColor => Boolean(swatch && typeof swatch === 'object')
      )
    : [];

  const displayNumberByColorId = new Map<number, number>();
  effectivePalette.forEach((swatch, idx) => {
    if (typeof swatch.id === 'number' && Number.isFinite(swatch.id)) {
      displayNumberByColorId.set(swatch.id, idx + 1);
    }
  });

  const maxDim = Math.max(width, height, 320);
  const pad = Math.max(20, Math.round(maxDim * 0.04));
  const headerHeight = Math.max(32, Math.round(maxDim * 0.055));
  const artX = pad;
  const artY = pad + headerHeight;

  const legendCols = clamp(Math.floor(width / 135) || 3, 2, 6);
  const legendRows = Math.max(1, Math.ceil(Math.max(1, effectivePalette.length) / legendCols));
  const swatchRowHeight = Math.max(22, Math.round(maxDim * 0.036));
  const legendHeaderHeight = Math.max(22, Math.round(maxDim * 0.032));
  const legendGapTop = Math.max(16, Math.round(pad * 0.75));
  const legendTop = artY + height + legendGapTop;
  const legendHeight =
    effectivePalette.length > 0 ? legendHeaderHeight + legendRows * swatchRowHeight : 0;

  const sheetWidth = width + pad * 2;
  const sheetHeight = artY + height + (legendHeight > 0 ? legendGapTop + legendHeight : 0) + pad;

  const baseStrokeWidthNum = clamp(maxDim / 750, 0.65, 1.6);
  const strokeWidth = formatCoord(baseStrokeWidthNum);
  const frameStrokeWidth = formatCoord(clamp(maxDim / 480, 1.1, 2.4));
  const boundaryPathData = traceGridBoundaryPath(
    puzzle.width,
    puzzle.height,
    puzzle.regionMap,
    puzzle.borderMap,
    artX,
    artY,
    1,
    1
  );

  const labelElements: string[] = [];
  const minFont = clamp(maxDim * 0.009, 4.5, 9);
  const nestedMinFont = clamp(maxDim * 0.0045, 2.5, 5);
  const maxFont = clamp(maxDim * 0.032, 12, 26);

  appendRootLabelElements(
    labelElements,
    Array.isArray(puzzle.regions) ? puzzle.regions : [],
    displayNumberByColorId,
    artX,
    artY,
    minFont,
    maxFont
  );

  const validNestedLayers = getValidSvgNestedLayers(puzzle);
  const nestedOutlineElements = buildNestedSvgLayerElements(
    validNestedLayers,
    displayNumberByColorId,
    artX,
    artY,
    width,
    height,
    baseStrokeWidthNum,
    nestedMinFont,
    maxFont,
    labelElements
  );

  const legendElements = buildColorKeyLegendElements(
    effectivePalette,
    width,
    artX,
    legendTop,
    legendCols,
    swatchRowHeight,
    legendHeaderHeight
  );

  const titleFontSize = formatCoord(clamp(headerHeight * 0.52, 14, 26));
  const subtitleFontSize = formatCoord(clamp(headerHeight * 0.3, 9, 13));
  const titleBaselineY = formatCoord(pad + Number(titleFontSize));
  const totalRegionCount = countRenderedRegions(puzzle.regions, validNestedLayers);

  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sheetWidth} ${sheetHeight}" width="${sheetWidth}" height="${sheetHeight}">`,
    `  <title>${escapedTitle}</title>`,
    `  <rect width="100%" height="100%" fill="#ffffff" />`,
    `  <g id="sheet-header" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif">`,
    `    <text x="${artX}" y="${titleBaselineY}" font-size="${titleFontSize}" font-weight="800" fill="#0f172a">${escapedTitle}</text>`,
    `    <text x="${artX + width}" y="${titleBaselineY}" text-anchor="end" font-size="${subtitleFontSize}" font-weight="600" fill="#475569">${totalRegionCount} Regions • ${effectivePalette.length} Colors</text>`,
    `  </g>`,
    `  <g id="puzzle-artwork">`,
    `    <rect x="${artX}" y="${artY}" width="${width}" height="${height}" fill="#ffffff" />`,
  ];

  if (boundaryPathData.length > 0) {
    lines.push(
      `    <path id="region-outlines" d="${boundaryPathData}" fill="none" stroke="#1e293b" stroke-width="${strokeWidth}" stroke-linecap="square" stroke-linejoin="miter" />`
    );
  }

  if (nestedOutlineElements.length > 0) {
    lines.push(...nestedOutlineElements);
  }

  lines.push(
    `    <rect x="${artX}" y="${artY}" width="${width}" height="${height}" fill="none" stroke="#1e293b" stroke-width="${frameStrokeWidth}" />`,
    `  </g>`,
    `  <g id="region-numbers" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-weight="700" fill="#334155" text-anchor="middle" dominant-baseline="central">`,
    ...labelElements,
    `  </g>`,
    ...legendElements,
    `</svg>`
  );

  return lines.join('\n');
}

/**
 * Builds and exports/shares a printable `.svg` coloring sheet via `NativeBridge.exportOrShareFile`.
 */
export async function exportPrintableColoringSvg(
  puzzle: PuzzleData,
  options?: PrintableSvgOptions
): Promise<boolean> {
  if (
    !puzzle ||
    !Number.isFinite(puzzle.width) ||
    !Number.isFinite(puzzle.height) ||
    puzzle.width <= 0 ||
    puzzle.height <= 0
  ) {
    return false;
  }
  try {
    const svgContent = buildPrintableColoringSvg(puzzle, options);
    const cleanTitle = (options?.title || 'Capy Coloring Sheet').trim() || 'Capy Coloring Sheet';
    const fileName = sanitizeColoringSheetFileName(cleanTitle);
    await NativeBridge.exportOrShareFile({
      title: `${cleanTitle} (Coloring Sheet)`,
      fileName,
      mimeType: 'image/svg+xml',
      data: svgContent,
    });
    return true;
  } catch (err) {
    console.error('Failed to export printable SVG coloring sheet:', err);
    return false;
  }
}
