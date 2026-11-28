import { NestedPuzzleLayer, PaletteColor, PuzzleData, Region, SavedSnapshot } from '../types';
import {
  getSortedNestedLayersAsc,
  isPuzzleOrganicCutout,
  isValidNormalizedRect,
} from '../engine/UnifiedPuzzleLayers';
import { StorageService } from './StorageService';
import { exportPrintableColoringSvg } from './SvgPrintExporter';
import { NativeBridge } from './NativeBridge';
import { mergeCustomPalette } from './sessionRestorePipeline';
import { reportSwallowed } from './telemetry';

export type LayerCanvasImageSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

export type LayerImageLookup =
  | ReadonlyMap<string, LayerCanvasImageSource>
  | Readonly<Record<string, LayerCanvasImageSource | null | undefined>>;

export interface ExportColoredArtworkOptions {
  puzzle: PuzzleData;
  sourceImage: HTMLImageElement;
  filledRegionIds: Set<number>;
  paintedRegionColors: Map<number, number>;
  title: string;
  hapticsEnabled: boolean;
  layerImages?: LayerImageLookup;
}

export interface ExportSnapshotSvgOptions {
  id: string;
  title: string;
  activeSnapshotId: string | null;
  activePuzzle: PuzzleData | null;
  activeTitle: string;
  snapshots: SavedSnapshot[];
  hapticsEnabled: boolean;
}

export interface ImportSnapshotsResult {
  ok: boolean;
  importedCount: number;
  importedIds?: string[];
  message: string;
  snapshots?: SavedSnapshot[];
}

/**
 * Pure filename sanitizers for PNG and `.capy` exports.
 */
export function buildArtworkPngFileName(title: string): string {
  const sanitized = (title || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${sanitized || 'capy-artwork'}.png`;
}

export function buildSnapshotArchiveFileName(title: string): string {
  const cleanTitle = (title || 'puzzle').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${cleanTitle}.capy`;
}

/**
 * Pure scale/dimension calculator for thumbnail preview generation.
 */
export function computePreviewDimensions(
  width: number,
  height: number,
  maxDim: number = 320
): { width: number; height: number; scale: number } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return { width: 0, height: 0, scale: 0 };
  }
  const safeMaxDim = Number.isFinite(maxDim) && maxDim > 0 ? maxDim : 320;
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  const scale = Math.min(1, safeMaxDim / Math.max(safeW, safeH));
  return {
    width: Math.max(1, Math.round(safeW * scale)),
    height: Math.max(1, Math.round(safeH * scale)),
    scale,
  };
}

/**
 * Pure pixel buffer filler for free-colour / custom-painted regions.
 * Fills painted region pixels into an RGBA Uint8ClampedArray initialized to opaque white.
 */
export function writeFreeColorRegionPixels(
  data: Uint8ClampedArray,
  puzzleData: PuzzleData,
  filledSet: Set<number>,
  customColors?: Map<number, number>
): void {
  data.fill(255);
  const paletteMap = new Map<number, PaletteColor>(
    puzzleData.palette.map((c) => [c.id, c])
  );

  for (const region of puzzleData.regions) {
    if (!filledSet.has(region.id)) continue;
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

function renderFreeColorCanvas(
  ctx: CanvasRenderingContext2D,
  puzzleData: PuzzleData,
  sourceImg: HTMLImageElement,
  filledSet: Set<number>,
  customColors?: Map<number, number>
): void {
  const imgData = ctx.createImageData(puzzleData.width, puzzleData.height);
  writeFreeColorRegionPixels(imgData.data, puzzleData, filledSet, customColors);
  ctx.putImageData(imgData, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(sourceImg, 0, 0, puzzleData.width, puzzleData.height);
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Returns true iff the unified puzzle has genuine transparent organic cutout exterior
 * pixels (accounting for root and nested layer union coverage).
 */
export function hasCutoutExteriorMask(puzzleData: PuzzleData): boolean {
  return isPuzzleOrganicCutout(puzzleData);
}

function maskRegionMapExteriorTransparent(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  regionMap: Int32Array
): void {
  if (typeof ctx.getImageData !== 'function') return;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const total = width * height;
  for (let i = 0; i < total; i++) {
    if (regionMap[i] <= 0) {
      const idx = i * 4;
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
      data[idx + 3] = 0;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

function maskCutoutExteriorTransparent(
  ctx: CanvasRenderingContext2D,
  puzzleData: PuzzleData
): void {
  maskRegionMapExteriorTransparent(ctx, puzzleData.width, puzzleData.height, puzzleData.regionMap);
}

function releaseTempCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

function hasUnfilledLayerRegions(
  regions: readonly Region[],
  filledSet: ReadonlySet<number>
): boolean {
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    if (region && !filledSet.has(region.id)) return true;
  }
  return false;
}

function isReadyLayerImageSource(img: unknown): img is LayerCanvasImageSource {
  if (!img || typeof img !== 'object') return false;
  if ('complete' in img) {
    const htmlImg = img as HTMLImageElement;
    const w = typeof htmlImg.naturalWidth === 'number' ? htmlImg.naturalWidth : htmlImg.width;
    const h = typeof htmlImg.naturalHeight === 'number' ? htmlImg.naturalHeight : htmlImg.height;
    return Boolean(htmlImg.complete && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0);
  }
  const sized = img as { width?: number; height?: number };
  return (
    typeof sized.width === 'number' &&
    typeof sized.height === 'number' &&
    Number.isFinite(sized.width) &&
    Number.isFinite(sized.height) &&
    sized.width > 0 &&
    sized.height > 0
  );
}

function lookupReadyLayerImageByKey(
  layerImages: LayerImageLookup,
  key: string
): LayerCanvasImageSource | null {
  let candidate: LayerCanvasImageSource | null | undefined;
  if (typeof (layerImages as ReadonlyMap<string, LayerCanvasImageSource>).get === 'function') {
    candidate = (layerImages as ReadonlyMap<string, LayerCanvasImageSource>).get(key);
  } else {
    const rec = layerImages as Readonly<Record<string, LayerCanvasImageSource | null | undefined>>;
    if (Object.prototype.hasOwnProperty.call(rec, key)) {
      candidate = rec[key];
    }
  }
  return isReadyLayerImageSource(candidate) ? candidate : null;
}

function resolveLayerImage(
  layer: NestedPuzzleLayer,
  layerImages?: LayerImageLookup
): LayerCanvasImageSource | null {
  if (!layerImages) return null;
  return (
    lookupReadyLayerImageByKey(layerImages, layer.imageBlobKey) ??
    lookupReadyLayerImageByKey(layerImages, layer.layerId)
  );
}

function getValidSortedNestedLayers(puzzleData: PuzzleData): NestedPuzzleLayer[] {
  const sorted = getSortedNestedLayersAsc(puzzleData);
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
      Array.isArray(layer.regions) &&
      layer.regionMap &&
      layer.regionMap.length >= layer.width * layer.height &&
      isValidNormalizedRect(layer.worldBounds)
    ) {
      valid.push(layer);
    }
  }
  return valid;
}

function resolveRegionRgb(
  rId: number,
  layerRegionById: ReadonlyMap<number, Region>,
  paletteMap: ReadonlyMap<number, PaletteColor>,
  customColors?: ReadonlyMap<number, number>
): [number, number, number] {
  const reg = layerRegionById.get(rId);
  const colId = customColors?.get(rId) ?? reg?.colorId;
  const col = colId !== undefined ? paletteMap.get(colId) : undefined;
  return [col?.r ?? 71, col?.g ?? 85, col?.b ?? 105];
}

function overlayIncompleteVeil(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  regionMap: Int32Array,
  filledSet: ReadonlySet<number>
): void {
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  try {
    const mCtx = maskCanvas.getContext('2d');
    if (!mCtx) return;
    const imgData = mCtx.createImageData(width, height);
    const data = imgData.data;
    const totalPixels = width * height;
    for (let i = 0; i < totalPixels; i++) {
      const rId = regionMap[i];
      if (rId > 0 && !filledSet.has(rId)) {
        const idx = i * 4;
        data[idx] = 248;
        data[idx + 1] = 250;
        data[idx + 2] = 252;
        data[idx + 3] = 230;
      }
    }
    mCtx.putImageData(imgData, 0, 0);
    ctx.drawImage(maskCanvas, 0, 0, width, height);
  } finally {
    releaseTempCanvas(maskCanvas);
  }
}

function renderNestedLayerFreeColor(
  lCtx: CanvasRenderingContext2D,
  layer: NestedPuzzleLayer,
  paletteMap: ReadonlyMap<number, PaletteColor>,
  layerRegionById: ReadonlyMap<number, Region>,
  filledSet: ReadonlySet<number>,
  customColors: ReadonlyMap<number, number> | undefined,
  layerImg: LayerCanvasImageSource | null
): void {
  const { width: lw, height: lh, regionMap } = layer;
  const imgData = lCtx.createImageData(lw, lh);
  const data = imgData.data;
  const total = lw * lh;
  for (let i = 0; i < total; i++) {
    const rId = regionMap[i];
    if (rId <= 0) continue;
    const idx = i * 4;
    if (filledSet.has(rId)) {
      const [r, g, b] = resolveRegionRgb(rId, layerRegionById, paletteMap, customColors);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    } else {
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = 255;
    }
  }
  lCtx.putImageData(imgData, 0, 0);
  if (layerImg) {
    lCtx.globalCompositeOperation = 'multiply';
    lCtx.drawImage(layerImg, 0, 0, lw, lh);
    lCtx.globalCompositeOperation = 'source-over';
    maskRegionMapExteriorTransparent(lCtx, lw, lh, regionMap);
  }
}

function renderNestedLayerStandardFallback(
  lCtx: CanvasRenderingContext2D,
  layer: NestedPuzzleLayer,
  paletteMap: ReadonlyMap<number, PaletteColor>,
  layerRegionById: ReadonlyMap<number, Region>,
  filledSet: ReadonlySet<number>,
  customColors: ReadonlyMap<number, number> | undefined,
  applyIncompleteVeil: boolean
): void {
  const { width: lw, height: lh, regionMap } = layer;
  const imgData = lCtx.createImageData(lw, lh);
  const data = imgData.data;
  const total = lw * lh;
  const veilAlpha = 230 / 255;
  const invVeilAlpha = 1 - veilAlpha;

  for (let i = 0; i < total; i++) {
    const rId = regionMap[i];
    if (rId <= 0) continue;
    const idx = i * 4;
    const [r, g, b] = resolveRegionRgb(rId, layerRegionById, paletteMap, customColors);
    if (!applyIncompleteVeil || filledSet.has(rId)) {
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    } else {
      data[idx] = Math.round(248 * veilAlpha + r * invVeilAlpha);
      data[idx + 1] = Math.round(250 * veilAlpha + g * invVeilAlpha);
      data[idx + 2] = Math.round(252 * veilAlpha + b * invVeilAlpha);
      data[idx + 3] = 255;
    }
  }
  lCtx.putImageData(imgData, 0, 0);
}

function compositeNestedLayers(
  targetCtx: CanvasRenderingContext2D,
  puzzleData: PuzzleData,
  validLayers: readonly NestedPuzzleLayer[],
  filledSet: ReadonlySet<number>,
  customColors: ReadonlyMap<number, number> | undefined,
  layerImages: LayerImageLookup | undefined,
  isFreeOrCustom: boolean,
  applyIncompleteVeil: boolean
): void {
  if (validLayers.length === 0) return;
  const paletteMap = new Map<number, PaletteColor>(puzzleData.palette.map((c) => [c.id, c]));

  for (let i = 0; i < validLayers.length; i++) {
    const layer = validLayers[i];
    const b = layer.worldBounds;
    const dx = b.x * puzzleData.width;
    const dy = b.y * puzzleData.height;
    const dw = b.width * puzzleData.width;
    const dh = b.height * puzzleData.height;
    if (dw <= 0 || dh <= 0) continue;

    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = layer.width;
    layerCanvas.height = layer.height;
    try {
      const lCtx = layerCanvas.getContext('2d');
      if (!lCtx) continue;
      const layerRegionById = new Map<number, Region>();
      for (let rIdx = 0; rIdx < layer.regions.length; rIdx++) {
        const reg = layer.regions[rIdx];
        if (reg) {
          layerRegionById.set(reg.id, reg);
        }
      }
      const layerImg = resolveLayerImage(layer, layerImages);

      if (isFreeOrCustom) {
        renderNestedLayerFreeColor(
          lCtx,
          layer,
          paletteMap,
          layerRegionById,
          filledSet,
          customColors,
          layerImg
        );
      } else if (layerImg) {
        lCtx.drawImage(layerImg, 0, 0, layer.width, layer.height);
        if (applyIncompleteVeil && hasUnfilledLayerRegions(layer.regions, filledSet)) {
          overlayIncompleteVeil(lCtx, layer.width, layer.height, layer.regionMap, filledSet);
        }
        maskRegionMapExteriorTransparent(lCtx, layer.width, layer.height, layer.regionMap);
      } else {
        renderNestedLayerStandardFallback(
          lCtx,
          layer,
          paletteMap,
          layerRegionById,
          filledSet,
          customColors,
          applyIncompleteVeil
        );
      }

      targetCtx.drawImage(layerCanvas, dx, dy, dw, dh);
    } finally {
      releaseTempCanvas(layerCanvas);
    }
  }
}

/**
 * Generate a <= 320px JPEG thumbnail data URL for snapshot cards.
 */
export function generatePreviewDataUrl(
  puzzleData: PuzzleData,
  sourceImg: HTMLImageElement,
  filledSet: Set<number>,
  customColors?: Map<number, number>,
  layerImages?: LayerImageLookup
): string {
  if (typeof document === 'undefined') return '';
  const dims = computePreviewDimensions(puzzleData.width, puzzleData.height, 320);
  if (dims.width <= 0 || dims.height <= 0) return '';
  const canvas = document.createElement('canvas');
  canvas.width = dims.width;
  canvas.height = dims.height;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    const isCutout = hasCutoutExteriorMask(puzzleData);
    const isFreeOrCustom = Boolean(
      puzzleData.isFreeColor || (customColors && customColors.size > 0)
    );
    const validNestedLayers = getValidSortedNestedLayers(puzzleData);
    const needsFullCanvas = isCutout || isFreeOrCustom || validNestedLayers.length > 0;

    if (needsFullCanvas) {
      if (isCutout) {
        ctx.fillStyle = '#18181b';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      const fullCanvas = document.createElement('canvas');
      fullCanvas.width = puzzleData.width;
      fullCanvas.height = puzzleData.height;
      try {
        const fCtx = fullCanvas.getContext('2d');
        if (fCtx) {
          if (isFreeOrCustom) {
            renderFreeColorCanvas(fCtx, puzzleData, sourceImg, filledSet, customColors);
          } else {
            fCtx.drawImage(sourceImg, 0, 0, puzzleData.width, puzzleData.height);
          }
          if (isCutout) {
            maskCutoutExteriorTransparent(fCtx, puzzleData);
          }
          if (validNestedLayers.length > 0) {
            compositeNestedLayers(
              fCtx,
              puzzleData,
              validNestedLayers,
              filledSet,
              customColors,
              layerImages,
              isFreeOrCustom,
              false
            );
          }
          ctx.drawImage(fullCanvas, 0, 0, canvas.width, canvas.height);
        }
      } finally {
        releaseTempCanvas(fullCanvas);
      }
    } else {
      ctx.drawImage(sourceImg, 0, 0, canvas.width, canvas.height);
    }

    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    releaseTempCanvas(canvas);
  }
}

/**
 * Export full-resolution colored artwork as PNG (supports Web download and Android native Share Sheet).
 */
export function exportColoredArtworkPng(options: ExportColoredArtworkOptions): void {
  if (typeof document === 'undefined') return;
  const {
    puzzle,
    sourceImage,
    filledRegionIds,
    paintedRegionColors,
    title,
    hapticsEnabled,
    layerImages,
  } = options;
  if (
    !Number.isFinite(puzzle.width) ||
    !Number.isFinite(puzzle.height) ||
    puzzle.width <= 0 ||
    puzzle.height <= 0
  ) {
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = puzzle.width;
  canvas.height = puzzle.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    releaseTempCanvas(canvas);
    return;
  }

  let handedToBlob = false;
  try {
    const isFreeOrCustom = Boolean(puzzle.isFreeColor || paintedRegionColors.size > 0);
    const isCutout = hasCutoutExteriorMask(puzzle);
    const validNestedLayers = getValidSortedNestedLayers(puzzle);

    if (isFreeOrCustom) {
      renderFreeColorCanvas(ctx, puzzle, sourceImage, filledRegionIds, paintedRegionColors);
    } else {
      ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
      if (hasUnfilledLayerRegions(puzzle.regions, filledRegionIds)) {
        overlayIncompleteVeil(ctx, puzzle.width, puzzle.height, puzzle.regionMap, filledRegionIds);
      }
    }

    if (isCutout) {
      maskCutoutExteriorTransparent(ctx, puzzle);
    }

    if (validNestedLayers.length > 0) {
      compositeNestedLayers(
        ctx,
        puzzle,
        validNestedLayers,
        filledRegionIds,
        paintedRegionColors,
        layerImages,
        isFreeOrCustom,
        true
      );
    }

    const titleStr = title || 'capy-artwork';
    const fileName = buildArtworkPngFileName(titleStr);
    canvas.toBlob((blob) => {
      releaseTempCanvas(canvas);
      if (!blob) return;
      void NativeBridge.exportOrShareFile({
        title: titleStr,
        fileName,
        mimeType: 'image/png',
        data: blob,
      }).catch((err) => {
        reportSwallowed('artworkExporter.exportColoredArtworkPng.share', err);
      });
      NativeBridge.haptic('tick', hapticsEnabled);
    }, 'image/png');
    handedToBlob = true;
  } finally {
    if (!handedToBlob) {
      releaseTempCanvas(canvas);
    }
  }
}

/**
 * Export the active puzzle as a printable monochrome vector SVG coloring sheet.
 */
export async function exportActivePrintableSvg(
  puzzle: PuzzleData | null,
  title: string,
  hapticsEnabled: boolean
): Promise<boolean> {
  if (!puzzle) return false;
  const ok = await exportPrintableColoringSvg(puzzle, {
    title: title || 'Capy Coloring Sheet',
    palette: puzzle.palette,
  });
  if (ok) {
    NativeBridge.haptic('tick', hapticsEnabled);
  }
  return ok;
}

/**
 * Export any saved snapshot's puzzle as a printable monochrome vector SVG coloring sheet.
 */
export async function exportSnapshotPrintableSvg(
  options: ExportSnapshotSvgOptions
): Promise<boolean> {
  const { id, title, activeSnapshotId, activePuzzle, activeTitle, snapshots, hapticsEnabled } =
    options;
  if (id === activeSnapshotId && activePuzzle) {
    const ok = await exportPrintableColoringSvg(activePuzzle, {
      title: title || activeTitle || 'Capy Coloring Sheet',
      palette: activePuzzle.palette,
    });
    if (ok) {
      NativeBridge.haptic('tick', hapticsEnabled);
    }
    return ok;
  }

  try {
    const cachedPuzzle = await StorageService.loadPuzzleData(id);
    if (!cachedPuzzle) return false;
    const snap = snapshots.find((s) => s.id === id);
    const palette =
      snap?.customPalette && snap.customPalette.length > 0
        ? mergeCustomPalette(cachedPuzzle.palette, snap.customPalette)
        : cachedPuzzle.palette;
    const ok = await exportPrintableColoringSvg(cachedPuzzle, {
      title: title || snap?.title || 'Capy Coloring Sheet',
      palette,
    });
    if (ok) {
      NativeBridge.haptic('tick', hapticsEnabled);
    }
    return ok;
  } catch (e) {
    reportSwallowed('artworkExporter.exportSnapshotPrintableSvg', e);
    console.error('Failed to export snapshot printable SVG', e);
    return false;
  }
}

/**
 * Export a single snapshot to a compact `.capy` v2 binary file.
 */
export async function exportSingleSnapshotArchive(
  id: string,
  title: string,
  hapticsEnabled: boolean
): Promise<boolean> {
  try {
    const bytes = await StorageService.exportSnapshotBinary(id);
    await NativeBridge.exportOrShareFile({
      title: title || 'Capy Save',
      fileName: buildSnapshotArchiveFileName(title),
      mimeType: 'application/octet-stream',
      data: bytes,
    });
    NativeBridge.haptic('tick', hapticsEnabled);
    return true;
  } catch (e) {
    reportSwallowed('artworkExporter.exportSingleSnapshotArchive', e);
    console.error('Failed to export snapshot', e);
    return false;
  }
}

/**
 * Export all saved puzzles to a compact `.capy` v2 backup archive.
 */
export async function exportAllSnapshotsArchive(hapticsEnabled: boolean): Promise<boolean> {
  try {
    const bytes = await StorageService.exportAllSnapshotsBinary();
    await NativeBridge.exportOrShareFile({
      title: 'Capy Saves Backup',
      fileName: 'capy_saves_backup.capy',
      mimeType: 'application/octet-stream',
      data: bytes,
    });
    NativeBridge.haptic('tick', hapticsEnabled);
    return true;
  } catch (e) {
    reportSwallowed('artworkExporter.exportAllSnapshotsArchive', e);
    console.error('Failed to export all snapshots', e);
    return false;
  }
}

/**
 * Import saves from a `.capy` (v2 binary or v1 JSON) or `.json` file.
 */
export async function importSnapshotsArchive(
  file: Pick<File, 'arrayBuffer'>,
  hapticsEnabled: boolean
): Promise<ImportSnapshotsResult> {
  try {
    const buffer = await file.arrayBuffer();
    const result = await StorageService.importSnapshotData(buffer);
    if (result.importedCount > 0) {
      const refreshed = await StorageService.hydrateSnapshotPreviews(
        StorageService.loadSnapshots()
      );
      NativeBridge.haptic('success', hapticsEnabled);
      return {
        ok: true,
        importedCount: result.importedCount,
        importedIds:
          result.importedIds ?? (result.firstSnapshot ? [result.firstSnapshot.id] : []),
        message: `Imported ${result.importedCount} ${result.importedCount === 1 ? 'save' : 'saves'} cleanly.`,
        snapshots: refreshed,
      };
    }
    const errorMsg = result.error || 'No valid saves found in file.';
    NativeBridge.haptic('error', hapticsEnabled);
    return {
      ok: false,
      importedCount: 0,
      message: `Failed to import saves: ${errorMsg}`,
    };
  } catch (e) {
    reportSwallowed('artworkExporter.importSnapshotsArchive', e);
    console.error('Failed to import file', e);
    NativeBridge.haptic('error', hapticsEnabled);
    return {
      ok: false,
      importedCount: 0,
      message: `Failed to import saves: ${e instanceof Error ? e.message : 'Invalid file'}`,
    };
  }
}
