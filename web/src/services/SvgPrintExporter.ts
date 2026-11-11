import { PaletteColor, PuzzleData, Region } from '../types';
import { NativeBridge } from './NativeBridge';

export interface PrintableSvgOptions {
  title?: string;
  palette?: PaletteColor[];
}

export function escapeSvgXml(value: string): string {
  return String(value)
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
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Traces collinear horizontal and vertical inter-region boundary runs from `regionMap`
 * (or falls back to `borderMap`) into a single compact SVG `<path d="...">` string.
 */
function traceRegionBoundaryPath(puzzle: PuzzleData, offsetX: number, offsetY: number): string {
  const { width, height, regionMap, borderMap } = puzzle;
  if (width <= 0 || height <= 0) return '';

  const segments: string[] = [];
  const totalPixels = width * height;
  const hasValidRegionMap = regionMap && regionMap.length >= totalPixels;

  if (hasValidRegionMap) {
    // Horizontal inter-region transitions along scanline y (between row y - 1 and row y)
    for (let y = 1; y < height; y++) {
      const prevRow = (y - 1) * width;
      const currRow = y * width;
      let runStart = -1;
      for (let x = 0; x < width; x++) {
        const isEdge = regionMap[prevRow + x] !== regionMap[currRow + x];
        if (isEdge) {
          if (runStart < 0) runStart = x;
        } else if (runStart >= 0) {
          segments.push(
            `M${formatCoord(offsetX + runStart)} ${formatCoord(offsetY + y)}H${formatCoord(offsetX + x)}`
          );
          runStart = -1;
        }
      }
      if (runStart >= 0) {
        segments.push(
          `M${formatCoord(offsetX + runStart)} ${formatCoord(offsetY + y)}H${formatCoord(offsetX + width)}`
        );
      }
    }

    // Vertical inter-region transitions along column x (between col x - 1 and col x)
    for (let x = 1; x < width; x++) {
      let runStart = -1;
      for (let y = 0; y < height; y++) {
        const rowOffset = y * width;
        const isEdge = regionMap[rowOffset + x - 1] !== regionMap[rowOffset + x];
        if (isEdge) {
          if (runStart < 0) runStart = y;
        } else if (runStart >= 0) {
          segments.push(
            `M${formatCoord(offsetX + x)} ${formatCoord(offsetY + runStart)}V${formatCoord(offsetY + y)}`
          );
          runStart = -1;
        }
      }
      if (runStart >= 0) {
        segments.push(
          `M${formatCoord(offsetX + x)} ${formatCoord(offsetY + runStart)}V${formatCoord(offsetY + height)}`
        );
      }
    }
  } else if (borderMap && borderMap.length >= totalPixels) {
    // Fallback horizontal run tracing from borderMap
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let runStart = -1;
      for (let x = 0; x < width; x++) {
        if (borderMap[row + x] > 0) {
          if (runStart < 0) runStart = x;
        } else if (runStart >= 0) {
          segments.push(
            `M${formatCoord(offsetX + runStart)} ${formatCoord(offsetY + y + 0.5)}H${formatCoord(offsetX + x)}`
          );
          runStart = -1;
        }
      }
      if (runStart >= 0) {
        segments.push(
          `M${formatCoord(offsetX + runStart)} ${formatCoord(offsetY + y + 0.5)}H${formatCoord(offsetX + width)}`
        );
      }
    }
  }

  return segments.join('');
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
  return Math.max(1, Math.floor(region.colorId || 1));
}

function resolveRegionRadius(region: Region): number {
  const rawRadius =
    typeof region.maxRadius === 'number' && region.maxRadius > 0
      ? region.maxRadius
      : (region as unknown as { radius?: number }).radius;
  if (typeof rawRadius === 'number' && rawRadius > 0) {
    return rawRadius;
  }
  const safeArea = Math.max(1, region.area || 1);
  return Math.sqrt(safeArea / Math.PI);
}

/**
 * Generates a crisp, self-contained, print-ready monochrome `.svg` coloring sheet
 * with vector region outlines, centered color numbers, and a bottom swatch key legend.
 */
export function buildPrintableColoringSvg(
  puzzle: PuzzleData,
  options?: PrintableSvgOptions
): string {
  const width = Math.max(1, Math.round(puzzle.width || 1));
  const height = Math.max(1, Math.round(puzzle.height || 1));
  const rawTitle = (options?.title || 'Capy Coloring Sheet').trim() || 'Capy Coloring Sheet';
  const escapedTitle = escapeSvgXml(rawTitle);

  const effectivePalette =
    options?.palette && options.palette.length > 0 ? options.palette : puzzle.palette || [];

  const displayNumberByColorId = new Map<number, number>();
  effectivePalette.forEach((swatch, idx) => {
    displayNumberByColorId.set(swatch.id, idx + 1);
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

  const strokeWidth = formatCoord(clamp(maxDim / 750, 0.65, 1.6));
  const frameStrokeWidth = formatCoord(clamp(maxDim / 480, 1.1, 2.4));
  const boundaryPathData = traceRegionBoundaryPath(puzzle, artX, artY);

  const labelElements: string[] = [];
  const minFont = clamp(maxDim * 0.009, 4.5, 9);
  const maxFont = clamp(maxDim * 0.032, 12, 26);

  for (const region of puzzle.regions || []) {
    const radius = resolveRegionRadius(region);
    if (radius < 1.2 && (region.area || 0) < 4) continue;
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

  const legendElements: string[] = [];
  if (effectivePalette.length > 0) {
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
      const safeHex = escapeSvgXml((swatch.hex || '#94a3b8').toUpperCase());
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
  }

  const titleFontSize = formatCoord(clamp(headerHeight * 0.52, 14, 26));
  const subtitleFontSize = formatCoord(clamp(headerHeight * 0.3, 9, 13));
  const titleBaselineY = formatCoord(pad + Number(titleFontSize));

  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sheetWidth} ${sheetHeight}" width="${sheetWidth}" height="${sheetHeight}">`,
    `  <title>${escapedTitle}</title>`,
    `  <rect width="100%" height="100%" fill="#ffffff" />`,
    `  <g id="sheet-header" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif">`,
    `    <text x="${artX}" y="${titleBaselineY}" font-size="${titleFontSize}" font-weight="800" fill="#0f172a">${escapedTitle}</text>`,
    `    <text x="${artX + width}" y="${titleBaselineY}" text-anchor="end" font-size="${subtitleFontSize}" font-weight="600" fill="#475569">${(puzzle.regions || []).length} Regions • ${effectivePalette.length} Colors</text>`,
    `  </g>`,
    `  <g id="puzzle-artwork">`,
    `    <rect x="${artX}" y="${artY}" width="${width}" height="${height}" fill="#ffffff" />`,
  ];

  if (boundaryPathData.length > 0) {
    lines.push(
      `    <path id="region-outlines" d="${boundaryPathData}" fill="none" stroke="#1e293b" stroke-width="${strokeWidth}" stroke-linecap="square" stroke-linejoin="miter" />`
    );
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
  if (!puzzle || puzzle.width <= 0 || puzzle.height <= 0) {
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
