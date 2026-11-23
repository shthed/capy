import { PaletteColor, PuzzleData, SavedSnapshot } from '../types';
import { StorageService } from './StorageService';
import { exportPrintableColoringSvg } from './SvgPrintExporter';
import { NativeBridge } from './NativeBridge';
import { mergeCustomPalette } from './sessionRestorePipeline';
import { reportSwallowed } from './telemetry';

export interface ExportColoredArtworkOptions {
  puzzle: PuzzleData;
  sourceImage: HTMLImageElement;
  filledRegionIds: Set<number>;
  paintedRegionColors: Map<number, number>;
  title: string;
  hapticsEnabled: boolean;
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
  ctx.drawImage(sourceImg, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Returns true iff puzzleData.regionMap contains both interior region pixels (rId > 0)
 * and transparent cutout exterior pixels (rId <= 0).
 */
export function hasCutoutExteriorMask(puzzleData: PuzzleData): boolean {
  const total = puzzleData.width * puzzleData.height;
  if (total <= 0 || !puzzleData.regionMap || puzzleData.regionMap.length < total) {
    return false;
  }
  let hasInterior = false;
  let hasExterior = false;
  for (let i = 0; i < total; i++) {
    if (puzzleData.regionMap[i] > 0) {
      hasInterior = true;
    } else {
      hasExterior = true;
    }
    if (hasInterior && hasExterior) return true;
  }
  return false;
}

function maskCutoutExteriorTransparent(
  ctx: CanvasRenderingContext2D,
  puzzleData: PuzzleData
): void {
  if (typeof ctx.getImageData !== 'function') return;
  const imgData = ctx.getImageData(0, 0, puzzleData.width, puzzleData.height);
  const data = imgData.data;
  const total = puzzleData.width * puzzleData.height;
  for (let i = 0; i < total; i++) {
    if (puzzleData.regionMap[i] <= 0) {
      const idx = i * 4;
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
      data[idx + 3] = 0;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

/**
 * Generate a <= 320px JPEG thumbnail data URL for snapshot cards.
 */
export function generatePreviewDataUrl(
  puzzleData: PuzzleData,
  sourceImg: HTMLImageElement,
  filledSet: Set<number>,
  customColors?: Map<number, number>
): string {
  if (typeof document === 'undefined') return '';
  const dims = computePreviewDimensions(puzzleData.width, puzzleData.height, 320);
  if (dims.width <= 0 || dims.height <= 0) return '';
  const canvas = document.createElement('canvas');
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const isCutout = hasCutoutExteriorMask(puzzleData);
  const isFreeOrCustom = Boolean(
    puzzleData.isFreeColor || (customColors && customColors.size > 0)
  );

  if (isCutout) {
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = puzzleData.width;
    fullCanvas.height = puzzleData.height;
    const fCtx = fullCanvas.getContext('2d');
    if (fCtx) {
      if (isFreeOrCustom) {
        renderFreeColorCanvas(fCtx, puzzleData, sourceImg, filledSet, customColors);
      } else {
        fCtx.drawImage(sourceImg, 0, 0, puzzleData.width, puzzleData.height);
      }
      maskCutoutExteriorTransparent(fCtx, puzzleData);
      ctx.drawImage(fullCanvas, 0, 0, canvas.width, canvas.height);
    }
  } else if (isFreeOrCustom) {
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = puzzleData.width;
    fullCanvas.height = puzzleData.height;
    const fCtx = fullCanvas.getContext('2d');
    if (fCtx) {
      renderFreeColorCanvas(fCtx, puzzleData, sourceImg, filledSet, customColors);
      ctx.drawImage(fullCanvas, 0, 0, canvas.width, canvas.height);
    }
  } else {
    ctx.drawImage(sourceImg, 0, 0, canvas.width, canvas.height);
  }

  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * Export full-resolution colored artwork as PNG (supports Web download and Android native Share Sheet).
 */
export function exportColoredArtworkPng(options: ExportColoredArtworkOptions): void {
  if (typeof document === 'undefined') return;
  const { puzzle, sourceImage, filledRegionIds, paintedRegionColors, title, hapticsEnabled } =
    options;
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
  if (!ctx) return;

  if (puzzle.isFreeColor || paintedRegionColors.size > 0) {
    renderFreeColorCanvas(ctx, puzzle, sourceImage, filledRegionIds, paintedRegionColors);
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
        const totalPixels = puzzle.width * puzzle.height;
        for (let i = 0; i < totalPixels; i++) {
          const rId = puzzle.regionMap[i];
          if (rId > 0 && !filledRegionIds.has(rId)) {
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

  if (hasCutoutExteriorMask(puzzle)) {
    maskCutoutExteriorTransparent(ctx, puzzle);
  }

  const titleStr = title || 'capy-artwork';
  const fileName = buildArtworkPngFileName(titleStr);
  canvas.toBlob((blob) => {
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
