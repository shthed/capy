import type { BorderExtensionSides, NormalizedRect } from '../../types';
import { base64ToUint8, uint8ToBase64 } from '../../utils/base64';
import { reportSwallowed } from '../telemetry';

export const BORDER_EXTEND_RATIO = 0.35;
export const MAX_EXTENDED_ASPECT_RATIO = 2.5;
export const MAX_EXTENDED_DIMENSION_PX = 2048;
export const NESTED_LAYER_MAX_DIM_PX = 1024;
export const INFILL_CONTEXT_PAD_RATIO = 0.25;
export const MAX_AI_TEMPLATE_BYTES = 900 * 1024;
export const MAX_AI_TEMPLATE_DIMENSION_PX = 1536;

export interface ExtendSidesCheck {
  allowed: boolean;
  reason?: string;
  nextWidth: number;
  nextHeight: number;
  offsetX: number;
  offsetY: number;
  innerWidth: number;
  innerHeight: number;
  padTop: number;
  padBottom: number;
  padLeft: number;
  padRight: number;
  scaleFactor: number;
  aspectRatio: number;
  boundsInParent: NormalizedRect;
}

export interface MaskBbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TemplateMaskRect {
  offsetX: number;
  offsetY: number;
  maskWidth: number;
  maskHeight: number;
  templateWidth: number;
  templateHeight: number;
}

export interface InfillContextRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BuildInfillTemplateRgbaParams {
  sourceRgba: Uint8ClampedArray;
  sourceWidth: number;
  sourceHeight: number;
  bbox: MaskBbox;
  cropMask: Uint8Array;
  contextPadRatio?: number;
}

export interface BuildInfillTemplateRgbaResult {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  maskInTemplateRect: TemplateMaskRect;
  contextRect: InfillContextRect;
}

export interface BuildOutpaintTemplateRgbaParams {
  sourceRgba: Uint8ClampedArray;
  sourceWidth: number;
  sourceHeight: number;
  sides: BorderExtensionSides;
}

export interface BuildOutpaintTemplateRgbaResult {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  check: ExtendSidesCheck;
}

export interface CompositeInfillRgbaParams {
  originalCropRgba: Uint8ClampedArray;
  cropWidth: number;
  cropHeight: number;
  cropMask: Uint8Array;
  generatedRgba: Uint8ClampedArray;
  generatedWidth: number;
  generatedHeight: number;
  templateMeta: TemplateMaskRect;
  targetWidth?: number;
  targetHeight?: number;
  featherPx?: number;
  transparentOutsideMask?: boolean;
}

export interface CompositeInfillRgbaResult {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  mask: Uint8Array;
}

export interface CompositeOutpaintRgbaParams {
  originalInnerRgba: Uint8ClampedArray;
  innerWidth: number;
  innerHeight: number;
  check: ExtendSidesCheck;
  generatedRgba: Uint8ClampedArray;
  generatedWidth: number;
  generatedHeight: number;
  featherPx?: number;
}

export interface CompositeOutpaintRgbaResult {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  check: ExtendSidesCheck;
}

function clampByte(value: number): number {
  if (Number.isNaN(value) || value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function clamp01(value: number): number {
  if (Number.isNaN(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function buildInvalidExtendCheck(reason: string): ExtendSidesCheck {
  return {
    allowed: false,
    reason,
    nextWidth: 0,
    nextHeight: 0,
    offsetX: 0,
    offsetY: 0,
    innerWidth: 0,
    innerHeight: 0,
    padTop: 0,
    padBottom: 0,
    padLeft: 0,
    padRight: 0,
    scaleFactor: 1,
    aspectRatio: 0,
    boundsInParent: { x: 0, y: 0, width: 1, height: 1 },
  };
}

function scaleExtendedDimensions(
  rawNextW: number,
  rawNextH: number,
  rawAspect: number,
  rawPads: { top: number; bottom: number; left: number; right: number },
  flags: BorderExtensionSides
): {
  nextWidth: number;
  nextHeight: number;
  padTop: number;
  padBottom: number;
  padLeft: number;
  padRight: number;
  innerWidth: number;
  innerHeight: number;
  scaleFactor: number;
} {
  const maxRaw = Math.max(rawNextW, rawNextH);
  const scaleFactor =
    maxRaw > MAX_EXTENDED_DIMENSION_PX ? MAX_EXTENDED_DIMENSION_PX / maxRaw : 1;

  if (scaleFactor === 1) {
    return {
      nextWidth: rawNextW,
      nextHeight: rawNextH,
      padTop: rawPads.top,
      padBottom: rawPads.bottom,
      padLeft: rawPads.left,
      padRight: rawPads.right,
      innerWidth: rawNextW - rawPads.left - rawPads.right,
      innerHeight: rawNextH - rawPads.top - rawPads.bottom,
      scaleFactor: 1,
    };
  }

  let nextWidth = Math.max(
    1,
    Math.min(MAX_EXTENDED_DIMENSION_PX, Math.round(rawNextW * scaleFactor))
  );
  let nextHeight = Math.max(
    1,
    Math.min(MAX_EXTENDED_DIMENSION_PX, Math.round(rawNextH * scaleFactor))
  );

  if (rawAspect <= MAX_EXTENDED_ASPECT_RATIO + 1e-9) {
    if (nextWidth / nextHeight > MAX_EXTENDED_ASPECT_RATIO) {
      nextHeight = Math.min(MAX_EXTENDED_DIMENSION_PX, nextHeight + 1);
    } else if (nextHeight / nextWidth > MAX_EXTENDED_ASPECT_RATIO) {
      nextWidth = Math.min(MAX_EXTENDED_DIMENSION_PX, nextWidth + 1);
    }
  }

  let padLeft = flags.left ? Math.max(1, Math.round(rawPads.left * scaleFactor)) : 0;
  let padRight = flags.right ? Math.max(1, Math.round(rawPads.right * scaleFactor)) : 0;
  let padTop = flags.top ? Math.max(1, Math.round(rawPads.top * scaleFactor)) : 0;
  let padBottom = flags.bottom ? Math.max(1, Math.round(rawPads.bottom * scaleFactor)) : 0;

  if (padLeft + padRight >= nextWidth) {
    const budget = Math.max(0, nextWidth - 1);
    padLeft = flags.left ? Math.min(padLeft, Math.floor(budget / (flags.right ? 2 : 1))) : 0;
    padRight = flags.right ? Math.max(0, budget - padLeft) : 0;
  }
  if (padTop + padBottom >= nextHeight) {
    const budget = Math.max(0, nextHeight - 1);
    padTop = flags.top ? Math.min(padTop, Math.floor(budget / (flags.bottom ? 2 : 1))) : 0;
    padBottom = flags.bottom ? Math.max(0, budget - padTop) : 0;
  }

  return {
    nextWidth,
    nextHeight,
    padTop,
    padBottom,
    padLeft,
    padRight,
    innerWidth: Math.max(1, nextWidth - padLeft - padRight),
    innerHeight: Math.max(1, nextHeight - padTop - padBottom),
    scaleFactor,
  };
}

/**
 * Validates directional border extension (`0.35x` per active side, `2.5:1` max aspect guard,
 * `2048px` max output dimension) and computes exact integer offsets and normalized `boundsInParent`.
 */
export function canExtendSides(
  width: number,
  height: number,
  sides: BorderExtensionSides
): ExtendSidesCheck {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return buildInvalidExtendCheck('Invalid source dimensions.');
  }

  const srcW = Math.round(width);
  const srcH = Math.round(height);
  const flags: BorderExtensionSides = {
    top: Boolean(sides?.top),
    bottom: Boolean(sides?.bottom),
    left: Boolean(sides?.left),
    right: Boolean(sides?.right),
  };

  if (!flags.top && !flags.bottom && !flags.left && !flags.right) {
    return {
      allowed: false,
      reason: 'Select at least one border side to extend.',
      nextWidth: srcW,
      nextHeight: srcH,
      offsetX: 0,
      offsetY: 0,
      innerWidth: srcW,
      innerHeight: srcH,
      padTop: 0,
      padBottom: 0,
      padLeft: 0,
      padRight: 0,
      scaleFactor: 1,
      aspectRatio: Math.max(srcW, srcH) / Math.min(srcW, srcH),
      boundsInParent: { x: 0, y: 0, width: 1, height: 1 },
    };
  }

  const rawPads = {
    top: flags.top ? Math.max(1, Math.round(srcH * BORDER_EXTEND_RATIO)) : 0,
    bottom: flags.bottom ? Math.max(1, Math.round(srcH * BORDER_EXTEND_RATIO)) : 0,
    left: flags.left ? Math.max(1, Math.round(srcW * BORDER_EXTEND_RATIO)) : 0,
    right: flags.right ? Math.max(1, Math.round(srcW * BORDER_EXTEND_RATIO)) : 0,
  };
  const rawNextW = srcW + rawPads.left + rawPads.right;
  const rawNextH = srcH + rawPads.top + rawPads.bottom;
  if (!Number.isFinite(rawNextW) || !Number.isFinite(rawNextH)) {
    return buildInvalidExtendCheck('Source dimensions are too large to extend.');
  }
  const rawAspect = Math.max(rawNextW, rawNextH) / Math.min(rawNextW, rawNextH);

  const scaled = scaleExtendedDimensions(rawNextW, rawNextH, rawAspect, rawPads, flags);
  const aspectRatio =
    Math.max(scaled.nextWidth, scaled.nextHeight) / Math.min(scaled.nextWidth, scaled.nextHeight);
  const allowed =
    rawAspect <= MAX_EXTENDED_ASPECT_RATIO + 1e-9 &&
    aspectRatio <= MAX_EXTENDED_ASPECT_RATIO + 1e-9;

  const bx = scaled.padLeft / scaled.nextWidth;
  const by = scaled.padTop / scaled.nextHeight;
  const boundsInParent: NormalizedRect = {
    x: bx,
    y: by,
    width: Math.min(1 - bx, scaled.innerWidth / scaled.nextWidth),
    height: Math.min(1 - by, scaled.innerHeight / scaled.nextHeight),
  };

  return {
    allowed,
    ...(allowed
      ? {}
      : {
          reason: `Extending those sides exceeds the ${MAX_EXTENDED_ASPECT_RATIO}:1 aspect limit (${rawAspect.toFixed(2)}:1). Try including perpendicular sides.`,
        }),
    nextWidth: scaled.nextWidth,
    nextHeight: scaled.nextHeight,
    offsetX: scaled.padLeft,
    offsetY: scaled.padTop,
    innerWidth: scaled.innerWidth,
    innerHeight: scaled.innerHeight,
    padTop: scaled.padTop,
    padBottom: scaled.padBottom,
    padLeft: scaled.padLeft,
    padRight: scaled.padRight,
    scaleFactor: scaled.scaleFactor,
    aspectRatio,
    boundsInParent,
  };
}

// ---------------------------------------------------------------------------
// Bilinear Sampling & Mask Distance Helpers (Pure RGBA, Zero DOM Dependencies)
// ---------------------------------------------------------------------------

function sampleBilinearRgba(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  fx: number,
  fy: number,
  outRgba: Uint8ClampedArray,
  outIdx: number
): void {
  const cx = Math.max(0, Math.min(srcW - 1, fx));
  const cy = Math.max(0, Math.min(srcH - 1, fy));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(srcW - 1, x0 + 1);
  const y1 = Math.min(srcH - 1, y0 + 1);
  const tx = cx - x0;
  const ty = cy - y0;
  const invTx = 1 - tx;
  const invTy = 1 - ty;

  const w00 = invTx * invTy;
  const w10 = tx * invTy;
  const w01 = invTx * ty;
  const w11 = tx * ty;

  const i00 = (y0 * srcW + x0) * 4;
  const i10 = (y0 * srcW + x1) * 4;
  const i01 = (y1 * srcW + x0) * 4;
  const i11 = (y1 * srcW + x1) * 4;

  outRgba[outIdx] = clampByte(
    src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11
  );
  outRgba[outIdx + 1] = clampByte(
    src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11
  );
  outRgba[outIdx + 2] = clampByte(
    src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11
  );
  outRgba[outIdx + 3] = clampByte(
    src[i00 + 3] * w00 + src[i10 + 3] * w10 + src[i01 + 3] * w01 + src[i11 + 3] * w11
  );
}

function resampleRgbaSubRect(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  subX: number,
  subY: number,
  subW: number,
  subH: number,
  dstW: number,
  dstH: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = dstH > 1 ? subY + ((y + 0.5) / dstH) * subH - 0.5 : subY + subH * 0.5 - 0.5;
    for (let x = 0; x < dstW; x++) {
      const sx = dstW > 1 ? subX + ((x + 0.5) / dstW) * subW - 0.5 : subX + subW * 0.5 - 0.5;
      sampleBilinearRgba(src, srcW, srcH, sx, sy, out, (y * dstW + x) * 4);
    }
  }
  return out;
}

function resampleMaskNearest(
  mask: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8Array {
  if (srcW === dstW && srcH === dstH) {
    return new Uint8Array(mask);
  }
  const out = new Uint8Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor(((y + 0.5) / dstH) * srcH));
    const srcRow = sy * srcW;
    const dstRow = y * dstW;
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor(((x + 0.5) / dstW) * srcW));
      out[dstRow + x] = mask[srcRow + sx] ? 1 : 0;
    }
  }
  return out;
}

/**
 * Smoothly upscales a binary mask using pixel-center bilinear interpolation with a >= 0.25
 * threshold. At >= 0.25 every pixel inside a `mask === 1` source cell is guaranteed to remain 1
 * (zero transparent holes over removed parent regions) while concave staircase steps become
 * smooth organic diagonals instead of blocky nearest-neighbor rectangles.
 */
function resampleMaskSmooth(
  mask: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8Array {
  if (srcW === dstW && srcH === dstH) {
    return new Uint8Array(mask);
  }
  if (dstW <= srcW && dstH <= srcH) {
    return resampleMaskNearest(mask, srcW, srcH, dstW, dstH);
  }
  const out = new Uint8Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = ((y + 0.5) * srcH) / dstH - 0.5;
    const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(sy)));
    const y1 = Math.min(srcH - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, sy - y0));
    const wy0 = 1 - fy;
    const row0 = y0 * srcW;
    const row1 = y1 * srcW;
    const dstRow = y * dstW;
    for (let x = 0; x < dstW; x++) {
      const sx = ((x + 0.5) * srcW) / dstW - 0.5;
      const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(sx)));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));
      const wx0 = 1 - fx;
      const v00 = mask[row0 + x0] ? 1 : 0;
      const v10 = mask[row0 + x1] ? 1 : 0;
      const v01 = mask[row1 + x0] ? 1 : 0;
      const v11 = mask[row1 + x1] ? 1 : 0;
      const val =
        v00 * wx0 * wy0 + v10 * fx * wy0 + v01 * wx0 * fy + v11 * fx * fy;
      out[dstRow + x] = val >= 0.25 ? 1 : 0;
    }
  }
  return out;
}

/**
 * Two-pass chamfer distance transform computing inward distance (in pixels) from
 * `mask === 0` or canvas boundary into `mask === 1` pixels.
 */
function computeInwardMaskDistance(mask: Uint8Array, width: number, height: number): Float32Array {
  const total = width * height;
  const inf = width + height + 16;
  const dist = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    dist[i] = mask[i] ? inf : 0;
  }

  const diag = Math.SQRT2;
  // Forward pass
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const idx = row + x;
      let d = dist[idx];
      if (d === 0) continue;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        d = Math.min(d, 1);
      }
      if (x > 0) d = Math.min(d, dist[idx - 1] + 1);
      if (y > 0) d = Math.min(d, dist[idx - width] + 1);
      if (x > 0 && y > 0) d = Math.min(d, dist[idx - width - 1] + diag);
      if (x < width - 1 && y > 0) d = Math.min(d, dist[idx - width + 1] + diag);
      dist[idx] = d;
    }
  }
  // Backward pass
  for (let y = height - 1; y >= 0; y--) {
    const row = y * width;
    for (let x = width - 1; x >= 0; x--) {
      const idx = row + x;
      let d = dist[idx];
      if (d === 0) continue;
      if (x < width - 1) d = Math.min(d, dist[idx + 1] + 1);
      if (y < height - 1) d = Math.min(d, dist[idx + width] + 1);
      if (x < width - 1 && y < height - 1) d = Math.min(d, dist[idx + width + 1] + diag);
      if (x > 0 && y < height - 1) d = Math.min(d, dist[idx + width - 1] + diag);
      dist[idx] = d;
    }
  }
  return dist;
}

// ---------------------------------------------------------------------------
// Pure RGBA Template Builders
// ---------------------------------------------------------------------------

/**
 * Extracts a context-padded (`+25%` clamped to source bounds) RGBA template around `bbox`,
 * preserving surrounding context pixels intact while marking `cropMask` (`M_select`) pixels
 * with a high-contrast `#FF00FF` magenta guide tint and crisp 1px magenta outline.
 */
export function buildInfillTemplateRgba(
  params: BuildInfillTemplateRgbaParams
): BuildInfillTemplateRgbaResult {
  const { sourceRgba, sourceWidth, sourceHeight, bbox, cropMask } = params;
  const contextPadRatio =
    typeof params.contextPadRatio === 'number' &&
    Number.isFinite(params.contextPadRatio) &&
    params.contextPadRatio >= 0
      ? params.contextPadRatio
      : INFILL_CONTEXT_PAD_RATIO;

  if (
    !Number.isInteger(sourceWidth) ||
    !Number.isInteger(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    sourceRgba.length < sourceWidth * sourceHeight * 4
  ) {
    throw new Error('Invalid source RGBA buffer for infill template');
  }
  const minX = Math.max(0, Math.min(sourceWidth - 1, Math.floor(bbox.minX)));
  const minY = Math.max(0, Math.min(sourceHeight - 1, Math.floor(bbox.minY)));
  const maxX = Math.max(minX, Math.min(sourceWidth - 1, Math.floor(bbox.maxX)));
  const maxY = Math.max(minY, Math.min(sourceHeight - 1, Math.floor(bbox.maxY)));
  const maskWidth = maxX - minX + 1;
  const maskHeight = maxY - minY + 1;
  if (cropMask.length !== maskWidth * maskHeight) {
    throw new Error('cropMask length does not match bbox dimensions');
  }

  const padX = contextPadRatio > 0 ? Math.max(1, Math.round(maskWidth * contextPadRatio)) : 0;
  const padY = contextPadRatio > 0 ? Math.max(1, Math.round(maskHeight * contextPadRatio)) : 0;
  const ctxMinX = Math.max(0, minX - padX);
  const ctxMinY = Math.max(0, minY - padY);
  const ctxMaxX = Math.min(sourceWidth - 1, maxX + padX);
  const ctxMaxY = Math.min(sourceHeight - 1, maxY + padY);
  const templateWidth = ctxMaxX - ctxMinX + 1;
  const templateHeight = ctxMaxY - ctxMinY + 1;
  const offsetX = minX - ctxMinX;
  const offsetY = minY - ctxMinY;

  const rgba = new Uint8ClampedArray(templateWidth * templateHeight * 4);

  // Copy full context-padded rectangle bit-for-bit first
  for (let ty = 0; ty < templateHeight; ty++) {
    const sy = ctxMinY + ty;
    const srcRowStart = (sy * sourceWidth + ctxMinX) * 4;
    const dstRowStart = ty * templateWidth * 4;
    rgba.set(sourceRgba.subarray(srcRowStart, srcRowStart + templateWidth * 4), dstRowStart);
  }

  // Tint M_select pixels with high-contrast #FF00FF guide + crisp outline on mask boundary
  for (let my = 0; my < maskHeight; my++) {
    const ty = offsetY + my;
    for (let mx = 0; mx < maskWidth; mx++) {
      const mIdx = my * maskWidth + mx;
      if (!cropMask[mIdx]) continue;
      const isEdge =
        mx === 0 ||
        my === 0 ||
        mx === maskWidth - 1 ||
        my === maskHeight - 1 ||
        !cropMask[mIdx - 1] ||
        !cropMask[mIdx + 1] ||
        !cropMask[mIdx - maskWidth] ||
        !cropMask[mIdx + maskWidth];

      const tx = offsetX + mx;
      const outIdx = (ty * templateWidth + tx) * 4;
      if (isEdge) {
        rgba[outIdx] = 255;
        rgba[outIdx + 1] = 0;
        rgba[outIdx + 2] = 255;
        rgba[outIdx + 3] = 255;
      } else {
        // Blend 50% magenta #FF00FF with 50% original color so AI sees both the target zone and underlying palette/lighting
        rgba[outIdx] = clampByte(rgba[outIdx] * 0.5 + 255 * 0.5);
        rgba[outIdx + 1] = clampByte(rgba[outIdx + 1] * 0.5);
        rgba[outIdx + 2] = clampByte(rgba[outIdx + 2] * 0.5 + 255 * 0.5);
        rgba[outIdx + 3] = 255;
      }
    }
  }

  return {
    rgba,
    width: templateWidth,
    height: templateHeight,
    maskInTemplateRect: {
      offsetX,
      offsetY,
      maskWidth,
      maskHeight,
      templateWidth,
      templateHeight,
    },
    contextRect: {
      x: ctxMinX,
      y: ctxMinY,
      width: templateWidth,
      height: templateHeight,
    },
  };
}

/**
 * Builds an outpaint template RGBA canvas with the original inner artwork placed untouched
 * at `(check.offsetX, check.offsetY, check.innerWidth, check.innerHeight)` and extended outer
 * margins filled with a crisp `#FF00FF` / light-magenta checkerboard outpaint guide.
 */
export function buildOutpaintTemplateRgba(
  params: BuildOutpaintTemplateRgbaParams
): BuildOutpaintTemplateRgbaResult {
  const { sourceRgba, sourceWidth, sourceHeight, sides } = params;
  if (
    !Number.isInteger(sourceWidth) ||
    !Number.isInteger(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    sourceRgba.length < sourceWidth * sourceHeight * 4
  ) {
    throw new Error('Invalid source RGBA buffer for outpaint template');
  }
  const check = canExtendSides(sourceWidth, sourceHeight, sides);
  if (!check.allowed) {
    throw new Error(check.reason || 'Border extension is not allowed for the requested sides.');
  }

  const outW = check.nextWidth;
  const outH = check.nextHeight;
  const rgba = new Uint8ClampedArray(outW * outH * 4);

  // Fill outer zone with crisp high-contrast #FF00FF + light magenta checkerboard
  for (let y = 0; y < outH; y++) {
    const cy = y >> 3;
    const row = y * outW;
    for (let x = 0; x < outW; x++) {
      const idx = (row + x) * 4;
      const isAlt = ((x >> 3) + cy) & 1;
      rgba[idx] = 255;
      rgba[idx + 1] = isAlt ? 72 : 0;
      rgba[idx + 2] = 255;
      rgba[idx + 3] = 255;
    }
  }

  // Copy original inner artwork pixel-exact when unscaled, or cleanly resampled if 2048px cap scaled down
  const innerSource =
    check.innerWidth === sourceWidth && check.innerHeight === sourceHeight
      ? sourceRgba
      : resampleRgbaSubRect(
          sourceRgba,
          sourceWidth,
          sourceHeight,
          0,
          0,
          sourceWidth,
          sourceHeight,
          check.innerWidth,
          check.innerHeight
        );

  for (let y = 0; y < check.innerHeight; y++) {
    const srcStart = y * check.innerWidth * 4;
    const dstStart = ((check.offsetY + y) * outW + check.offsetX) * 4;
    rgba.set(innerSource.subarray(srcStart, srcStart + check.innerWidth * 4), dstStart);
  }

  return {
    rgba,
    width: outW,
    height: outH,
    check,
  };
}

// ---------------------------------------------------------------------------
// Pixel-Locked Seam Compositors (Guaranteed 0% Pixel Shift Outside Active Zone)
// ---------------------------------------------------------------------------

function isPositiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeInt(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function isValidInfillTemplateMeta(meta: TemplateMaskRect | undefined): boolean {
  if (!meta) return false;
  const { templateWidth, templateHeight, maskWidth, maskHeight, offsetX, offsetY } = meta;
  if (
    !isPositiveInt(templateWidth) ||
    !isPositiveInt(templateHeight) ||
    !isPositiveInt(maskWidth) ||
    !isPositiveInt(maskHeight) ||
    !isNonNegativeInt(offsetX) ||
    !isNonNegativeInt(offsetY)
  ) {
    return false;
  }
  return offsetX + maskWidth <= templateWidth && offsetY + maskHeight <= templateHeight;
}

function isValidExtendSidesCheck(check: ExtendSidesCheck | undefined): boolean {
  if (!check?.allowed) return false;
  if (!isPositiveInt(check.nextWidth) || !isPositiveInt(check.nextHeight)) return false;
  if (!isPositiveInt(check.innerWidth) || !isPositiveInt(check.innerHeight)) return false;
  if (!isNonNegativeInt(check.offsetX) || !isNonNegativeInt(check.offsetY)) return false;
  return (
    check.offsetX + check.innerWidth <= check.nextWidth &&
    check.offsetY + check.innerHeight <= check.nextHeight
  );
}

function assertCompositeInfillParams(params: CompositeInfillRgbaParams): void {
  const {
    originalCropRgba,
    cropWidth,
    cropHeight,
    cropMask,
    generatedRgba,
    generatedWidth,
    generatedHeight,
    templateMeta,
    targetWidth,
    targetHeight,
  } = params;
  if (
    !isPositiveInt(cropWidth) ||
    !isPositiveInt(cropHeight) ||
    originalCropRgba.length < cropWidth * cropHeight * 4 ||
    cropMask.length !== cropWidth * cropHeight
  ) {
    throw new Error('Invalid original crop buffer or mask for infill compositing');
  }
  if (targetWidth !== undefined && !isPositiveInt(targetWidth)) {
    throw new Error('Invalid targetWidth for infill compositing');
  }
  if (targetHeight !== undefined && !isPositiveInt(targetHeight)) {
    throw new Error('Invalid targetHeight for infill compositing');
  }
  if (
    !isPositiveInt(generatedWidth) ||
    !isPositiveInt(generatedHeight) ||
    generatedRgba.length < generatedWidth * generatedHeight * 4
  ) {
    throw new Error('Invalid generated RGBA buffer for infill compositing');
  }
  if (!isValidInfillTemplateMeta(templateMeta)) {
    throw new Error('Invalid templateMeta dimensions or bounds for infill compositing');
  }
}

/**
 * Composites Nano Banana generated infill strictly inside `M_select` (`cropMask === 1`).
 *
 * STRICT PIXEL LOCK:
 * - Every pixel where `mask === 0` is copied 100% bit-for-bit untouched from `originalCropRgba`
 *   (or set to RGBA `[0, 0, 0, 0]` when `transparentOutsideMask === true`).
 * - Every pixel where `mask === 1` takes the generated artwork mapped from `templateMeta`,
 *   with an optional inward-only feather (`0..featherPx`) that never touches any pixel outside `M_select`.
 */
export function compositeInfillRgba(params: CompositeInfillRgbaParams): CompositeInfillRgbaResult {
  assertCompositeInfillParams(params);
  const {
    originalCropRgba,
    cropWidth,
    cropHeight,
    cropMask,
    generatedRgba,
    generatedWidth,
    generatedHeight,
    templateMeta,
    transparentOutsideMask = false,
  } = params;

  const targetWidth =
    typeof params.targetWidth === 'number' && Number.isInteger(params.targetWidth) && params.targetWidth > 0
      ? params.targetWidth
      : cropWidth;
  const targetHeight =
    typeof params.targetHeight === 'number' && Number.isInteger(params.targetHeight) && params.targetHeight > 0
      ? params.targetHeight
      : cropHeight;
  const featherPx =
    typeof params.featherPx === 'number' && Number.isFinite(params.featherPx) && params.featherPx >= 0
      ? params.featherPx
      : transparentOutsideMask
        ? 0
        : 2;

  const mask = transparentOutsideMask
    ? resampleMaskSmooth(cropMask, cropWidth, cropHeight, targetWidth, targetHeight)
    : resampleMaskNearest(cropMask, cropWidth, cropHeight, targetWidth, targetHeight);
  const subX = (templateMeta.offsetX / templateMeta.templateWidth) * generatedWidth;
  const subY = (templateMeta.offsetY / templateMeta.templateHeight) * generatedHeight;
  const subW = (templateMeta.maskWidth / templateMeta.templateWidth) * generatedWidth;
  const subH = (templateMeta.maskHeight / templateMeta.templateHeight) * generatedHeight;

  const sampledGenerated = resampleRgbaSubRect(
    generatedRgba,
    generatedWidth,
    generatedHeight,
    subX,
    subY,
    subW,
    subH,
    targetWidth,
    targetHeight
  );

  const originalAtTarget =
    targetWidth === cropWidth && targetHeight === cropHeight
      ? originalCropRgba
      : resampleRgbaSubRect(
          originalCropRgba,
          cropWidth,
          cropHeight,
          0,
          0,
          cropWidth,
          cropHeight,
          targetWidth,
          targetHeight
        );

  const inwardDist =
    featherPx > 0 && !transparentOutsideMask
      ? computeInwardMaskDistance(mask, targetWidth, targetHeight)
      : null;

  const total = targetWidth * targetHeight;
  const out = new Uint8ClampedArray(total * 4);

  for (let i = 0; i < total; i++) {
    const p = i * 4;
    if (!mask[i]) {
      if (!transparentOutsideMask) {
        // Strict pixel lock: exact copy from original
        out[p] = originalAtTarget[p];
        out[p + 1] = originalAtTarget[p + 1];
        out[p + 2] = originalAtTarget[p + 2];
        out[p + 3] = originalAtTarget[p + 3];
      }
      continue;
    }

    const genR = sampledGenerated[p];
    const genG = sampledGenerated[p + 1];
    const genB = sampledGenerated[p + 2];

    if (inwardDist && inwardDist[i] <= featherPx) {
      const alpha = smoothstep(0, featherPx + 1, inwardDist[i]);
      const inv = 1 - alpha;
      out[p] = clampByte(originalAtTarget[p] * inv + genR * alpha);
      out[p + 1] = clampByte(originalAtTarget[p + 1] * inv + genG * alpha);
      out[p + 2] = clampByte(originalAtTarget[p + 2] * inv + genB * alpha);
      out[p + 3] = 255;
    } else {
      out[p] = genR;
      out[p + 1] = genG;
      out[p + 2] = genB;
      out[p + 3] = 255;
    }
  }

  return {
    rgba: out,
    width: targetWidth,
    height: targetHeight,
    mask,
  };
}

function assertCompositeOutpaintParams(params: CompositeOutpaintRgbaParams): void {
  const {
    originalInnerRgba,
    innerWidth,
    innerHeight,
    check,
    generatedRgba,
    generatedWidth,
    generatedHeight,
  } = params;
  if (!isValidExtendSidesCheck(check)) {
    throw new Error(check?.reason || 'Invalid ExtendSidesCheck for outpaint compositing');
  }
  if (
    !isPositiveInt(innerWidth) ||
    !isPositiveInt(innerHeight) ||
    originalInnerRgba.length < innerWidth * innerHeight * 4
  ) {
    throw new Error('Invalid original inner RGBA buffer for outpaint compositing');
  }
  if (
    !isPositiveInt(generatedWidth) ||
    !isPositiveInt(generatedHeight) ||
    generatedRgba.length < generatedWidth * generatedHeight * 4
  ) {
    throw new Error('Invalid generated RGBA buffer for outpaint compositing');
  }
}

function applyOutpaintOuterFeather(
  out: Uint8ClampedArray,
  lockedInner: Uint8ClampedArray,
  check: ExtendSidesCheck,
  featherPx: number
): void {
  if (featherPx <= 0) return;
  const outW = check.nextWidth;
  const outH = check.nextHeight;
  const minInnerX = check.offsetX;
  const minInnerY = check.offsetY;
  const maxInnerX = check.offsetX + check.innerWidth - 1;
  const maxInnerY = check.offsetY + check.innerHeight - 1;
  const pad = Math.ceil(featherPx);
  const bandMinY = Math.max(0, minInnerY - pad);
  const bandMaxY = Math.min(outH - 1, maxInnerY + pad);
  const bandMinX = Math.max(0, minInnerX - pad);
  const bandMaxX = Math.min(outW - 1, maxInnerX + pad);

  for (let y = bandMinY; y <= bandMaxY; y++) {
    const clampedY = y < minInnerY ? minInnerY : y > maxInnerY ? maxInnerY : y;
    const dy = y - clampedY;
    for (let x = bandMinX; x <= bandMaxX; x++) {
      if (x >= minInnerX && x <= maxInnerX && y >= minInnerY && y <= maxInnerY) {
        continue; // Never modify inner pixels
      }
      const clampedX = x < minInnerX ? minInnerX : x > maxInnerX ? maxInnerX : x;
      const dist = Math.hypot(x - clampedX, dy);
      if (dist > featherPx) continue;

      const alpha = smoothstep(0, featherPx + 1, dist);
      const inv = 1 - alpha;
      const innerIdx = ((clampedY - minInnerY) * check.innerWidth + (clampedX - minInnerX)) * 4;
      const outIdx = (y * outW + x) * 4;
      out[outIdx] = clampByte(lockedInner[innerIdx] * inv + out[outIdx] * alpha);
      out[outIdx + 1] = clampByte(lockedInner[innerIdx + 1] * inv + out[outIdx + 1] * alpha);
      out[outIdx + 2] = clampByte(lockedInner[innerIdx + 2] * inv + out[outIdx + 2] * alpha);
      out[outIdx + 3] = 255;
    }
  }
}

interface AlignmentSamplePoint {
  u: number;
  v: number;
  r: number;
  g: number;
  b: number;
  wgt: number;
}

export interface AlignedInnerRect {
  x: number;
  y: number;
  width: number;
  height: number;
  applied: boolean;
}

const OUTPAINT_ALIGN_MAX_DIM = 160;
const OUTPAINT_ALIGN_CLIP_L1 = 120;
const OUTPAINT_ALIGN_MIN_REL_IMPROVEMENT = 0.1;
const OUTPAINT_ALIGN_MIN_ABS_IMPROVEMENT = 4;

function buildAlignmentSamplePoints(
  innerSmall: Uint8ClampedArray,
  inW: number,
  inH: number
): AlignmentSamplePoint[] {
  const pts: AlignmentSamplePoint[] = [];
  const step = Math.max(1, Math.floor(Math.min(inW, inH) / 48));
  const edgeBandX = Math.max(4, Math.round(inW * 0.12));
  const edgeBandY = Math.max(4, Math.round(inH * 0.12));
  for (let y = 0; y < inH; y += step) {
    const nearY = y < edgeBandY || y >= inH - edgeBandY;
    for (let x = 0; x < inW; x += step) {
      const nearX = x < edgeBandX || x >= inW - edgeBandX;
      const nearEdge = nearX || nearY;
      if (!nearEdge && (x % (step * 2) !== 0 || y % (step * 2) !== 0)) continue;
      const idx = (y * inW + x) * 4;
      if (innerSmall[idx + 3] < 200) continue;
      pts.push({
        u: (x + 0.5) / inW,
        v: (y + 0.5) / inH,
        r: innerSmall[idx],
        g: innerSmall[idx + 1],
        b: innerSmall[idx + 2],
        wgt: nearEdge ? 2 : 1,
      });
    }
  }
  return pts;
}

function evaluateAlignmentError(
  pts: readonly AlignmentSamplePoint[],
  genSmall: Uint8ClampedArray,
  sw: number,
  sh: number,
  fx: number,
  fy: number,
  fw: number,
  fh: number
): number {
  let tot = 0;
  let wsum = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const gx = Math.round((fx + p.u * fw) * sw - 0.5);
    const gy = Math.round((fy + p.v * fh) * sh - 0.5);
    if (gx < 0 || gx >= sw || gy < 0 || gy >= sh) {
      tot += (OUTPAINT_ALIGN_CLIP_L1 + 30) * p.wgt;
    } else {
      const idx = (gy * sw + gx) * 4;
      const d =
        Math.abs(p.r - genSmall[idx]) +
        Math.abs(p.g - genSmall[idx + 1]) +
        Math.abs(p.b - genSmall[idx + 2]);
      tot += (d > OUTPAINT_ALIGN_CLIP_L1 ? OUTPAINT_ALIGN_CLIP_L1 : d) * p.wgt;
    }
    wsum += p.wgt;
  }
  return wsum > 0 ? tot / wsum : Infinity;
}

function isValidAlignedRectCandidate(
  fx: number,
  fy: number,
  fw: number,
  fh: number,
  expX: number,
  expY: number,
  expW: number,
  expH: number
): boolean {
  if (fw < expW * 0.85 || fw > expW * 1.15 || fh < expH * 0.85 || fh > expH * 1.15) {
    return false;
  }
  const minMargin = 0.01;
  if (expX > 0 && fx < minMargin) return false;
  if (expX === 0 && Math.abs(fx) > 0.03) return false;
  if (expX + expW < 1 && fx + fw > 1 - minMargin) return false;
  if (expX + expW >= 1 && Math.abs(fx + fw - 1) > 0.03) return false;
  if (expY > 0 && fy < minMargin) return false;
  if (expY === 0 && Math.abs(fy) > 0.03) return false;
  if (expY + expH < 1 && fy + fh > 1 - minMargin) return false;
  if (expY + expH >= 1 && Math.abs(fy + fh - 1) > 0.03) return false;
  return fx >= 0 && fy >= 0 && fx + fw <= 1 && fy + fh <= 1;
}

/**
 * Estimates the normalized [0..1] inner rectangle where the AI model placed `lockedInner` inside
 * `generatedRgba`, compensating for the ±2--8% scale/offset drift common in diffusion outpainting.
 * Returns exact identity (`applied: false`) whenever the generated image is already aligned,
 * too small, or synthetic/uniform.
 */
export function estimateOutpaintAlignedInnerRect(
  lockedInner: Uint8ClampedArray,
  innerW: number,
  innerH: number,
  generatedRgba: Uint8ClampedArray,
  genW: number,
  genH: number,
  check: ExtendSidesCheck
): AlignedInnerRect {
  const outW = check.nextWidth;
  const outH = check.nextHeight;
  const expX = check.offsetX / outW;
  const expY = check.offsetY / outH;
  const expW = check.innerWidth / outW;
  const expH = check.innerHeight / outH;
  const identity: AlignedInnerRect = { x: expX, y: expY, width: expW, height: expH, applied: false };

  if (outW < 48 || outH < 48 || innerW < 24 || innerH < 24 || genW < 48 || genH < 48) {
    return identity;
  }
  const scale = Math.min(1, OUTPAINT_ALIGN_MAX_DIM / Math.max(outW, outH));
  const sw = Math.max(16, Math.round(outW * scale));
  const sh = Math.max(16, Math.round(outH * scale));
  const inW = Math.max(12, Math.round(innerW * scale));
  const inH = Math.max(12, Math.round(innerH * scale));

  const genSmall = resampleRgbaSubRect(generatedRgba, genW, genH, 0, 0, genW, genH, sw, sh);
  const innerSmall = resampleRgbaSubRect(lockedInner, innerW, innerH, 0, 0, innerW, innerH, inW, inH);
  const pts = buildAlignmentSamplePoints(innerSmall, inW, inH);
  if (pts.length < 32) return identity;

  const baseErr = evaluateAlignmentError(pts, genSmall, sw, sh, expX, expY, expW, expH);
  let bestErr = baseErr;
  let bestX = expX;
  let bestY = expY;
  let bestW = expW;
  let bestH = expH;

  for (let dsx = -8; dsx <= 8; dsx += 2) {
    const fw = expW * (1 + dsx * 0.01);
    for (let dsy = -8; dsy <= 8; dsy += 2) {
      const fh = expH * (1 + dsy * 0.01);
      for (let dtx = -6; dtx <= 6; dtx += 2) {
        const fx = expX + dtx * 0.005;
        for (let dty = -6; dty <= 6; dty += 2) {
          const fy = expY + dty * 0.005;
          if (!isValidAlignedRectCandidate(fx, fy, fw, fh, expX, expY, expW, expH)) continue;
          const err = evaluateAlignmentError(pts, genSmall, sw, sh, fx, fy, fw, fh);
          if (err < bestErr) {
            bestErr = err;
            bestX = fx;
            bestY = fy;
            bestW = fw;
            bestH = fh;
          }
        }
      }
    }
  }

  const steps = [0.004, 0.002, 0.001];
  const dirs = [
    [1, 0, 0, 0],
    [-1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, -1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, -1, 0],
    [0, 0, 0, 1],
    [0, 0, 0, -1],
  ];
  for (let si = 0; si < steps.length; si++) {
    const step = steps[si];
    let improved = true;
    let iter = 0;
    while (improved && iter < 16) {
      improved = false;
      iter++;
      for (let di = 0; di < dirs.length; di++) {
        const d = dirs[di];
        const fx = bestX + d[0] * step;
        const fy = bestY + d[1] * step;
        const fw = bestW + d[2] * step;
        const fh = bestH + d[3] * step;
        if (!isValidAlignedRectCandidate(fx, fy, fw, fh, expX, expY, expW, expH)) continue;
        const err = evaluateAlignmentError(pts, genSmall, sw, sh, fx, fy, fw, fh);
        if (err < bestErr - 0.02) {
          bestErr = err;
          bestX = fx;
          bestY = fy;
          bestW = fw;
          bestH = fh;
          improved = true;
        }
      }
    }
  }

  const improvedEnough =
    baseErr - bestErr >= OUTPAINT_ALIGN_MIN_ABS_IMPROVEMENT &&
    bestErr <= baseErr * (1 - OUTPAINT_ALIGN_MIN_REL_IMPROVEMENT);
  if (!improvedEnough) return identity;
  return { x: bestX, y: bestY, width: bestW, height: bestH, applied: true };
}

function mapNineSliceAxis(u: number, e0: number, e1: number, f0: number, f1: number): number {
  if (e0 > 0 && u < e0) {
    return (u / e0) * f0;
  }
  if (e1 < 1 && u > e1) {
    return f1 + ((u - e1) / (1 - e1)) * (1 - f1);
  }
  const span = e1 - e0;
  return span > 0 ? f0 + ((u - e0) / span) * (f1 - f0) : u;
}

function resampleRgbaNineSlice(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  e0x: number,
  e1x: number,
  e0y: number,
  e1y: number,
  f0x: number,
  f1x: number,
  f0y: number,
  f1y: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  const srcXMap = new Float32Array(dstW);
  for (let x = 0; x < dstW; x++) {
    const u = (x + 0.5) / dstW;
    srcXMap[x] = mapNineSliceAxis(u, e0x, e1x, f0x, f1x) * srcW - 0.5;
  }
  for (let y = 0; y < dstH; y++) {
    const v = (y + 0.5) / dstH;
    const sy = mapNineSliceAxis(v, e0y, e1y, f0y, f1y) * srcH - 0.5;
    const rowBase = y * dstW;
    for (let x = 0; x < dstW; x++) {
      sampleBilinearRgba(src, srcW, srcH, srcXMap[x], sy, out, (rowBase + x) * 4);
    }
  }
  return out;
}

/**
 * Composites Nano Banana outpainted outer borders strictly outside `(check.offsetX, check.offsetY, check.innerWidth, check.innerHeight)`.
 *
 * STRICT PIXEL LOCK:
 * - Every pixel strictly inside the inner rectangle is copied 100% bit-for-bit untouched from `originalInnerRgba`
 *   (when unscaled; cleanly resampled if `2048px` cap scaled down inner).
 * - Automatically detects and corrects small AI scale/offset drift via continuous 9-slice alignment so
 *   outer border objects snap cleanly onto all 4 edges of the locked inner artwork.
 * - Only outer pixels within `1..featherPx` of the inner boundary are smoothly feathered against the nearest
 *   inner boundary pixel — ZERO inner pixels are ever modified!
 */
export function compositeOutpaintRgba(
  params: CompositeOutpaintRgbaParams
): CompositeOutpaintRgbaResult {
  assertCompositeOutpaintParams(params);
  const {
    originalInnerRgba,
    innerWidth,
    innerHeight,
    check,
    generatedRgba,
    generatedWidth,
    generatedHeight,
  } = params;
  const featherPx =
    typeof params.featherPx === 'number' && Number.isFinite(params.featherPx) && params.featherPx >= 0
      ? params.featherPx
      : 5;

  const outW = check.nextWidth;
  const outH = check.nextHeight;
  const lockedInner =
    check.innerWidth === innerWidth && check.innerHeight === innerHeight
      ? originalInnerRgba
      : resampleRgbaSubRect(
          originalInnerRgba,
          innerWidth,
          innerHeight,
          0,
          0,
          innerWidth,
          innerHeight,
          check.innerWidth,
          check.innerHeight
        );

  const aligned = estimateOutpaintAlignedInnerRect(
    lockedInner,
    check.innerWidth,
    check.innerHeight,
    generatedRgba,
    generatedWidth,
    generatedHeight,
    check
  );

  const out = aligned.applied
    ? resampleRgbaNineSlice(
        generatedRgba,
        generatedWidth,
        generatedHeight,
        outW,
        outH,
        check.offsetX / outW,
        (check.offsetX + check.innerWidth) / outW,
        check.offsetY / outH,
        (check.offsetY + check.innerHeight) / outH,
        aligned.x,
        aligned.x + aligned.width,
        aligned.y,
        aligned.y + aligned.height
      )
    : resampleRgbaSubRect(
        generatedRgba,
        generatedWidth,
        generatedHeight,
        0,
        0,
        generatedWidth,
        generatedHeight,
        outW,
        outH
      );

  applyOutpaintOuterFeather(out, lockedInner, check, featherPx);

  // Strict pixel lock: copy inner artwork 100% untouched
  for (let y = 0; y < check.innerHeight; y++) {
    const srcStart = y * check.innerWidth * 4;
    const dstStart = ((check.offsetY + y) * outW + check.offsetX) * 4;
    out.set(lockedInner.subarray(srcStart, srcStart + check.innerWidth * 4), dstStart);
  }

  return {
    rgba: out,
    width: outW,
    height: outH,
    check,
  };
}

// ---------------------------------------------------------------------------
// DOM Canvas Convenience Wrappers
// ---------------------------------------------------------------------------

function createCanvasFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('Canvas helpers require a DOM document');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D canvas context');
  }
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(rgba);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function readRgbaFromSource(
  source: HTMLCanvasElement | HTMLImageElement | ImageBitmap
): { rgba: Uint8ClampedArray; width: number; height: number } {
  const width =
    'naturalWidth' in source && source.naturalWidth > 0 ? source.naturalWidth : source.width;
  const height =
    'naturalHeight' in source && source.naturalHeight > 0 ? source.naturalHeight : source.height;
  if (width <= 0 || height <= 0) {
    throw new Error('Invalid image/canvas dimensions');
  }
  if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
    const ctx = source.getContext('2d');
    if (ctx) {
      return { rgba: ctx.getImageData(0, 0, width, height).data, width, height };
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D canvas context');
  }
  ctx.drawImage(source, 0, 0, width, height);
  return { rgba: ctx.getImageData(0, 0, width, height).data, width, height };
}

export function buildInfillTemplateCanvas(
  sourceCanvas: HTMLCanvasElement,
  bbox: MaskBbox,
  cropMask: Uint8Array,
  contextPadRatio: number = INFILL_CONTEXT_PAD_RATIO
): BuildInfillTemplateRgbaResult & { canvas: HTMLCanvasElement } {
  const { rgba: sourceRgba, width: sourceWidth, height: sourceHeight } =
    readRgbaFromSource(sourceCanvas);
  const res = buildInfillTemplateRgba({
    sourceRgba,
    sourceWidth,
    sourceHeight,
    bbox,
    cropMask,
    contextPadRatio,
  });
  return {
    ...res,
    canvas: createCanvasFromRgba(res.rgba, res.width, res.height),
  };
}

export function buildOutpaintTemplateCanvas(
  sourceCanvas: HTMLCanvasElement,
  sides: BorderExtensionSides
): BuildOutpaintTemplateRgbaResult & { canvas: HTMLCanvasElement } {
  const { rgba: sourceRgba, width: sourceWidth, height: sourceHeight } =
    readRgbaFromSource(sourceCanvas);
  const res = buildOutpaintTemplateRgba({
    sourceRgba,
    sourceWidth,
    sourceHeight,
    sides,
  });
  return {
    ...res,
    canvas: createCanvasFromRgba(res.rgba, res.width, res.height),
  };
}

export function compositeInfillCanvas(params: {
  originalCropCanvas: HTMLCanvasElement;
  cropMask: Uint8Array;
  generatedSource: HTMLCanvasElement | HTMLImageElement | ImageBitmap;
  templateMeta: TemplateMaskRect;
  targetWidth?: number;
  targetHeight?: number;
  featherPx?: number;
  transparentOutsideMask?: boolean;
}): CompositeInfillRgbaResult & { canvas: HTMLCanvasElement } {
  const orig = readRgbaFromSource(params.originalCropCanvas);
  const gen = readRgbaFromSource(params.generatedSource);
  const res = compositeInfillRgba({
    originalCropRgba: orig.rgba,
    cropWidth: orig.width,
    cropHeight: orig.height,
    cropMask: params.cropMask,
    generatedRgba: gen.rgba,
    generatedWidth: gen.width,
    generatedHeight: gen.height,
    templateMeta: params.templateMeta,
    targetWidth: params.targetWidth,
    targetHeight: params.targetHeight,
    featherPx: params.featherPx,
    transparentOutsideMask: params.transparentOutsideMask,
  });
  return {
    ...res,
    canvas: createCanvasFromRgba(res.rgba, res.width, res.height),
  };
}

export function compositeOutpaintCanvas(params: {
  originalInnerCanvas: HTMLCanvasElement;
  check: ExtendSidesCheck;
  generatedSource: HTMLCanvasElement | HTMLImageElement | ImageBitmap;
  featherPx?: number;
}): CompositeOutpaintRgbaResult & { canvas: HTMLCanvasElement } {
  const orig = readRgbaFromSource(params.originalInnerCanvas);
  const gen = readRgbaFromSource(params.generatedSource);
  const res = compositeOutpaintRgba({
    originalInnerRgba: orig.rgba,
    innerWidth: orig.width,
    innerHeight: orig.height,
    check: params.check,
    generatedRgba: gen.rgba,
    generatedWidth: gen.width,
    generatedHeight: gen.height,
    featherPx: params.featherPx,
  });
  return {
    ...res,
    canvas: createCanvasFromRgba(res.rgba, res.width, res.height),
  };
}

export async function canvasToPngBlobAndDataUrl(
  canvas: HTMLCanvasElement
): Promise<{ blob: Blob; dataUrl: string }> {
  const dataUrl = canvas.toDataURL('image/png');
  const blob = await new Promise<Blob>((resolve, reject) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob((result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error('Failed to encode canvas to PNG blob'));
        }
      }, 'image/png');
      return;
    }
    fetch(dataUrl)
      .then((res) => res.blob())
      .then(resolve, reject);
  });
  return { blob, dataUrl };
}

export const MIN_AI_INFILL_TEMPLATE_DIMENSION_PX = 512;

export interface CompactTemplateEncodeOptions {
  maxBytes?: number;
  maxDim?: number;
  minDim?: number;
}

export interface CompactTemplateEncodeResult {
  blob: Blob;
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
}

const COMPACT_TEMPLATE_JPEG_QUALITIES = [0.86, 0.78, 0.7, 0.6, 0.5] as const;
const COMPACT_TEMPLATE_SCALE_STEPS = [1, 0.85, 0.7, 0.55, 0.4] as const;
const MIN_COMPACT_TEMPLATE_LONGEST_EDGE = 256;

interface EncodedCanvasCandidate {
  blob: Blob;
  mimeType: string;
  dataUrl?: string;
}

export function computeCompactTemplateDimensions(
  width: number,
  height: number,
  maxDim: number,
  minDim: number = 0
): { width: number; height: number } {
  const safeW = Math.max(1, Math.round(width));
  const safeH = Math.max(1, Math.round(height));
  const longest = Math.max(safeW, safeH);
  const clampedMin = minDim > 0 ? Math.min(maxDim, minDim) : 0;
  if (clampedMin > 0 && longest < clampedMin) {
    const scale = clampedMin / longest;
    return {
      width: Math.max(1, Math.round(safeW * scale)),
      height: Math.max(1, Math.round(safeH * scale)),
    };
  }
  if (longest <= maxDim) {
    return { width: safeW, height: safeH };
  }
  const scale = maxDim / longest;
  return {
    width: Math.max(1, Math.round(safeW * scale)),
    height: Math.max(1, Math.round(safeH * scale)),
  };
}

function releaseScratchCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

function createResizedTemplateCanvas(
  source: HTMLCanvasElement,
  width: number,
  height: number
): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const ctx = scratch.getContext('2d');
  if (!ctx) {
    releaseScratchCanvas(scratch);
    return null;
  }
  try {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) {
      ctx.imageSmoothingQuality = 'high';
    }
    ctx.drawImage(source, 0, 0, width, height);
    return scratch;
  } catch (err) {
    releaseScratchCanvas(scratch);
    throw err;
  }
}

function normalizeStrictRasterCompactMime(rawMime: string | undefined): string | null {
  const cleaned = (rawMime || '').split(';')[0].trim().toLowerCase();
  if (cleaned === 'image/jpg' || cleaned === 'image/jpeg') return 'image/jpeg';
  if (cleaned === 'image/png' || cleaned === 'image/webp') return cleaned;
  return null;
}

function decodeDataUrlToCandidate(
  rawDataUrl: string,
  _fallbackMime: string
): EncodedCanvasCandidate | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(rawDataUrl.trim());
  if (!match) return null;
  const mimeType = normalizeStrictRasterCompactMime(match[1]);
  if (!mimeType) return null;
  const compactBase64 = match[2].replace(/\s+/g, '');
  const bytes = base64ToUint8(compactBase64);
  if (bytes.byteLength === 0) return null;
  return {
    blob: new Blob([new Uint8Array(bytes)], { type: mimeType }),
    mimeType,
    dataUrl: `data:${mimeType};base64,${compactBase64}`,
  };
}

async function encodeCanvasCandidate(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number
): Promise<EncodedCanvasCandidate | null> {
  if (typeof canvas.toBlob === 'function') {
    try {
      const rawBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((result) => resolve(result), mimeType, quality);
      });
      if (rawBlob && rawBlob.size > 0) {
        const declaredType = typeof rawBlob.type === 'string' ? rawBlob.type.trim() : '';
        const resolvedMime =
          declaredType.length > 0
            ? normalizeStrictRasterCompactMime(declaredType)
            : normalizeStrictRasterCompactMime(mimeType);
        if (resolvedMime) {
          const blob =
            rawBlob.type === resolvedMime ? rawBlob : new Blob([rawBlob], { type: resolvedMime });
          return { blob, mimeType: resolvedMime };
        }
      }
    } catch (err) {
      reportSwallowed('SeamCompositor.compactTemplateToBlob', err, { mimeType, quality });
    }
  }
  if (typeof canvas.toDataURL === 'function') {
    try {
      const rawDataUrl = canvas.toDataURL(mimeType, quality);
      return decodeDataUrlToCandidate(rawDataUrl, mimeType);
    } catch (err) {
      reportSwallowed('SeamCompositor.compactTemplateToDataUrl', err, { mimeType, quality });
    }
  }
  return null;
}

async function tryEncodeCanvasAtQualities(
  canvas: HTMLCanvasElement,
  maxBytes: number
): Promise<{ winner: EncodedCanvasCandidate | null; best: EncodedCanvasCandidate | null }> {
  let best: EncodedCanvasCandidate | null = null;
  for (const quality of COMPACT_TEMPLATE_JPEG_QUALITIES) {
    const candidate = await encodeCanvasCandidate(canvas, 'image/jpeg', quality);
    if (!candidate) continue;
    if (!best || candidate.blob.size < best.blob.size) {
      best = candidate;
    }
    if (candidate.blob.size <= maxBytes) {
      return { winner: candidate, best: candidate };
    }
    // If browser/mock ignored image/jpeg and emitted PNG, lower JPEG quality won't shrink it.
    if (candidate.mimeType !== 'image/jpeg') {
      break;
    }
  }
  if (!best) {
    const pngFallback = await encodeCanvasCandidate(canvas, 'image/png');
    if (pngFallback) {
      best = pngFallback;
      if (pngFallback.blob.size <= maxBytes) {
        return { winner: pngFallback, best: pngFallback };
      }
    }
  }
  return { winner: null, best };
}

async function finalizeCompactTemplateResult(
  candidate: EncodedCanvasCandidate,
  width: number,
  height: number
): Promise<CompactTemplateEncodeResult> {
  if (candidate.dataUrl) {
    return {
      blob: candidate.blob,
      dataUrl: candidate.dataUrl,
      mimeType: candidate.mimeType,
      width,
      height,
    };
  }
  const bytes = new Uint8Array(await candidate.blob.arrayBuffer());
  const dataUrl = `data:${candidate.mimeType};base64,${uint8ToBase64(bytes)}`;
  return {
    blob: candidate.blob,
    dataUrl,
    mimeType: candidate.mimeType,
    width,
    height,
  };
}

function resolvePositiveIntOption(
  value: number | undefined,
  fallback: number,
  minValue: number
): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= minValue) {
    return Math.floor(value);
  }
  return fallback;
}

async function encodeCompactTemplateStep(
  sourceCanvas: HTMLCanvasElement,
  srcW: number,
  srcH: number,
  targetDims: { width: number; height: number },
  maxBytes: number,
  hasBest: boolean
): Promise<{
  skippedResizeFailure: boolean;
  winner: EncodedCanvasCandidate | null;
  best: EncodedCanvasCandidate | null;
  width: number;
  height: number;
}> {
  const needsResize = targetDims.width !== srcW || targetDims.height !== srcH;
  const scratch = needsResize
    ? createResizedTemplateCanvas(sourceCanvas, targetDims.width, targetDims.height)
    : null;
  if (needsResize && !scratch && hasBest) {
    return {
      skippedResizeFailure: true,
      winner: null,
      best: null,
      width: srcW,
      height: srcH,
    };
  }
  const workCanvas = scratch ?? sourceCanvas;
  const width = scratch ? targetDims.width : srcW;
  const height = scratch ? targetDims.height : srcH;
  try {
    const { winner, best } = await tryEncodeCanvasAtQualities(workCanvas, maxBytes);
    return { skippedResizeFailure: false, winner, best, width, height };
  } finally {
    releaseScratchCanvas(scratch);
  }
}

export async function canvasToCompactTemplateBlobAndDataUrl(
  canvas: HTMLCanvasElement,
  options?: CompactTemplateEncodeOptions
): Promise<CompactTemplateEncodeResult> {
  const srcW = Math.floor(canvas?.width ?? 0);
  const srcH = Math.floor(canvas?.height ?? 0);
  if (!Number.isFinite(srcW) || !Number.isFinite(srcH) || srcW <= 0 || srcH <= 0) {
    throw new Error('Cannot encode empty canvas to compact template');
  }
  const maxBytes = resolvePositiveIntOption(options?.maxBytes, MAX_AI_TEMPLATE_BYTES, 1);
  const maxDim = resolvePositiveIntOption(options?.maxDim, MAX_AI_TEMPLATE_DIMENSION_PX, 1);
  const minDim = resolvePositiveIntOption(options?.minDim, 0, 1);

  const baseDims = computeCompactTemplateDimensions(srcW, srcH, maxDim, minDim);
  const baseLongest = Math.max(baseDims.width, baseDims.height);
  const minLongest = Math.min(MIN_COMPACT_TEMPLATE_LONGEST_EDGE, baseLongest);

  const stepDimsList: number[] = [];
  for (const scale of COMPACT_TEMPLATE_SCALE_STEPS) {
    stepDimsList.push(
      scale === 1 ? baseLongest : Math.max(minLongest, Math.round(baseLongest * scale))
    );
  }
  if (stepDimsList[stepDimsList.length - 1] > minLongest) {
    stepDimsList.push(minLongest);
  }

  let prevW = 0;
  let prevH = 0;
  let best: { candidate: EncodedCanvasCandidate; width: number; height: number } | null = null;

  for (const stepMaxDim of stepDimsList) {
    const dims = computeCompactTemplateDimensions(baseDims.width, baseDims.height, stepMaxDim);
    if (dims.width === prevW && dims.height === prevH) continue;
    prevW = dims.width;
    prevH = dims.height;

    const step = await encodeCompactTemplateStep(canvas, srcW, srcH, dims, maxBytes, best !== null);
    if (step.skippedResizeFailure) {
      break;
    }
    if (step.best && (!best || step.best.blob.size < best.candidate.blob.size)) {
      best = { candidate: step.best, width: step.width, height: step.height };
    }
    if (step.winner) {
      return await finalizeCompactTemplateResult(step.winner, step.width, step.height);
    }
  }

  if (!best) {
    throw new Error('Failed to encode canvas to compact template blob');
  }
  return await finalizeCompactTemplateResult(best.candidate, best.width, best.height);
}
