import type {
  BorderExtensionSides,
  InfiniteZoomBounds,
  InfiniteZoomMotifKind,
  InfiniteZoomSceneElement,
  InfiniteZoomScenePlan,
} from '../../types';
import type { SubdivisionBbox } from '../../engine/MaskedRegionSubdivider';
import { ColorQuantizer } from '../../engine/ColorQuantizer';

export const BORDER_EXTEND_RATIO = 0.35;
export const MAX_EXTENDED_ASPECT_RATIO = 2.5;
export const MAX_EXTENDED_DIMENSION_PX = 2048;
export const CHILD_TILE_MAX_DIM_PX = 1024;
export const INFILL_MAX_DELTA_E = 35;

export type InfillSynthesisMode = 'in-place' | 'child-tile';

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
  boundsInParent: InfiniteZoomBounds;
}

export interface SynthesizeInfillRgbaParams {
  cropRgba: Uint8ClampedArray;
  cropWidth: number;
  cropHeight: number;
  cropMask: Uint8Array;
  scenePlan: InfiniteZoomScenePlan;
  mode: InfillSynthesisMode;
  maxDeltaE?: number;
}

export interface SynthesizeInfillRgbaResult {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  mask: Uint8Array;
  mode: InfillSynthesisMode;
  scaleFactor: number;
}

export interface InfillCanvasOptions {
  mode: InfillSynthesisMode;
  maxDeltaE?: number;
}

export interface InfillSynthesisResult extends SynthesizeInfillRgbaResult {
  canvas: HTMLCanvasElement;
}

export interface SynthesizeExtendedBorderRgbaParams {
  sourceRgba: Uint8ClampedArray;
  sourceWidth: number;
  sourceHeight: number;
  sides: BorderExtensionSides;
  scenePlan: InfiniteZoomScenePlan;
}

export interface SynthesizeExtendedBorderRgbaResult {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  check: ExtendSidesCheck;
  boundsInParent: InfiniteZoomBounds;
}

export interface ExtendedBorderResult extends SynthesizeExtendedBorderRgbaResult {
  canvas: HTMLCanvasElement;
}

type MotifSdfFn = (u: number, v: number, count: number, phase: number) => number;

interface EdgeProfile {
  slices: number;
  edgeR: Float32Array;
  edgeG: Float32Array;
  edgeB: Float32Array;
  trendR: Float32Array;
  trendG: Float32Array;
  trendB: Float32Array;
  tangent: Float32Array;
}

const HEX_6_RE = /^#[0-9A-Fa-f]{6}$/;

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

function clampRange(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return value < min ? min : value > max ? max : value;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function parseHexRgb(hex: string | undefined): [number, number, number] | null {
  if (typeof hex !== 'string') return null;
  const trimmed = hex.trim();
  if (!HEX_6_RE.test(trimmed)) return null;
  const num = parseInt(trimmed.slice(1), 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function clampRgbToMaxDeltaE(
  baseR: number,
  baseG: number,
  baseB: number,
  targetR: number,
  targetG: number,
  targetB: number,
  maxDeltaE: number = INFILL_MAX_DELTA_E
): [number, number, number] {
  const bR = clampByte(baseR);
  const bG = clampByte(baseG);
  const bB = clampByte(baseB);
  const tR = clampByte(targetR);
  const tG = clampByte(targetG);
  const tB = clampByte(targetB);

  const safeMax =
    Number.isFinite(maxDeltaE) && maxDeltaE >= 0
      ? maxDeltaE
      : INFILL_MAX_DELTA_E;
  if (safeMax === 0) return [bR, bG, bB];

  const maxDistSq = safeMax * safeMax;
  const distSq = ColorQuantizer.perceptualDistanceSq(bR, bG, bB, tR, tG, tB);
  if (distSq <= maxDistSq) {
    return [tR, tG, tB];
  }

  const initialT = safeMax / Math.sqrt(distSq);
  const cR = clampByte(bR + (tR - bR) * initialT);
  const cG = clampByte(bG + (tG - bG) * initialT);
  const cB = clampByte(bB + (tB - bB) * initialT);
  if (ColorQuantizer.perceptualDistanceSq(bR, bG, bB, cR, cG, cB) <= maxDistSq) {
    return [cR, cG, cB];
  }

  let lo = 0;
  let hi = initialT;
  let bestR = bR;
  let bestG = bG;
  let bestB = bB;
  for (let iter = 0; iter < 8; iter++) {
    const mid = (lo + hi) * 0.5;
    const mR = clampByte(bR + (tR - bR) * mid);
    const mG = clampByte(bG + (tG - bG) * mid);
    const mB = clampByte(bB + (tB - bB) * mid);
    if (
      ColorQuantizer.perceptualDistanceSq(bR, bG, bB, mR, mG, mB) <= maxDistSq
    ) {
      bestR = mR;
      bestG = mG;
      bestB = mB;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return [bestR, bestG, bestB];
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

  let padLeft = flags.left
    ? Math.max(1, Math.round(rawPads.left * scaleFactor))
    : 0;
  let padRight = flags.right
    ? Math.max(1, Math.round(rawPads.right * scaleFactor))
    : 0;
  let padTop = flags.top
    ? Math.max(1, Math.round(rawPads.top * scaleFactor))
    : 0;
  let padBottom = flags.bottom
    ? Math.max(1, Math.round(rawPads.bottom * scaleFactor))
    : 0;

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

export function canExtendSides(
  width: number,
  height: number,
  sides: BorderExtensionSides
): ExtendSidesCheck {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1
  ) {
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
  const rawAspect = Math.max(rawNextW, rawNextH) / Math.min(rawNextW, rawNextH);

  const scaled = scaleExtendedDimensions(
    rawNextW,
    rawNextH,
    rawAspect,
    rawPads,
    flags
  );
  const aspectRatio =
    Math.max(scaled.nextWidth, scaled.nextHeight) /
    Math.min(scaled.nextWidth, scaled.nextHeight);
  const allowed =
    rawAspect <= MAX_EXTENDED_ASPECT_RATIO + 1e-9 &&
    aspectRatio <= MAX_EXTENDED_ASPECT_RATIO + 1e-9;

  const bx = scaled.padLeft / scaled.nextWidth;
  const by = scaled.padTop / scaled.nextHeight;
  const boundsInParent: InfiniteZoomBounds = {
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

function upscaleBinaryMaskBilinear(
  srcMask: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8Array {
  const dstMask = new Uint8Array(dstW * dstH);
  let count = 0;

  for (let y = 0; y < dstH; y++) {
    const sy = ((y + 0.5) * srcH) / dstH - 0.5;
    const y0 = clampRange(Math.floor(sy), 0, srcH - 1);
    const y1 = Math.min(srcH - 1, y0 + 1);
    const fy = clamp01(sy - y0);
    const row0 = y0 * srcW;
    const row1 = y1 * srcW;
    const dstRow = y * dstW;

    for (let x = 0; x < dstW; x++) {
      const sx = ((x + 0.5) * srcW) / dstW - 0.5;
      const x0 = clampRange(Math.floor(sx), 0, srcW - 1);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const fx = clamp01(sx - x0);

      const m00 = srcMask[row0 + x0] === 1 ? 1 : 0;
      const m10 = srcMask[row0 + x1] === 1 ? 1 : 0;
      const m01 = srcMask[row1 + x0] === 1 ? 1 : 0;
      const m11 = srcMask[row1 + x1] === 1 ? 1 : 0;
      const cov =
        (m00 * (1 - fx) + m10 * fx) * (1 - fy) +
        (m01 * (1 - fx) + m11 * fx) * fy;

      if (cov >= 0.5) {
        dstMask[dstRow + x] = 1;
        count += 1;
      }
    }
  }

  if (count === 0) {
    for (let y = 0; y < dstH; y++) {
      const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
      for (let x = 0; x < dstW; x++) {
        const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
        if (srcMask[sy * srcW + sx] === 1) {
          dstMask[y * dstW + x] = 1;
        }
      }
    }
  }

  return dstMask;
}

function upscaleRgbaMaskAwareBilinear(
  srcRgba: Uint8ClampedArray,
  srcMask: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  dstMask: Uint8Array
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = ((y + 0.5) * srcH) / dstH - 0.5;
    const y0 = clampRange(Math.floor(sy), 0, srcH - 1);
    const y1 = Math.min(srcH - 1, y0 + 1);
    const fy = clamp01(sy - y0);
    const row0 = y0 * srcW;
    const row1 = y1 * srcW;
    const dstRow = y * dstW;

    for (let x = 0; x < dstW; x++) {
      const dstIdx = dstRow + x;
      if (dstMask[dstIdx] !== 1) continue;

      const sx = ((x + 0.5) * srcW) / dstW - 0.5;
      const x0 = clampRange(Math.floor(sx), 0, srcW - 1);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const fx = clamp01(sx - x0);

      const i00 = row0 + x0;
      const i10 = row0 + x1;
      const i01 = row1 + x0;
      const i11 = row1 + x1;

      const w00 = srcMask[i00] === 1 ? (1 - fx) * (1 - fy) : 0;
      const w10 = srcMask[i10] === 1 ? fx * (1 - fy) : 0;
      const w01 = srcMask[i01] === 1 ? (1 - fx) * fy : 0;
      const w11 = srcMask[i11] === 1 ? fx * fy : 0;
      const wSum = w00 + w10 + w01 + w11;

      const o4 = dstIdx * 4;
      if (wSum > 0) {
        const inv = 1 / wSum;
        out[o4] = clampByte(
          (srcRgba[i00 * 4] * w00 +
            srcRgba[i10 * 4] * w10 +
            srcRgba[i01 * 4] * w01 +
            srcRgba[i11 * 4] * w11) *
            inv
        );
        out[o4 + 1] = clampByte(
          (srcRgba[i00 * 4 + 1] * w00 +
            srcRgba[i10 * 4 + 1] * w10 +
            srcRgba[i01 * 4 + 1] * w01 +
            srcRgba[i11 * 4 + 1] * w11) *
            inv
        );
        out[o4 + 2] = clampByte(
          (srcRgba[i00 * 4 + 2] * w00 +
            srcRgba[i10 * 4 + 2] * w10 +
            srcRgba[i01 * 4 + 2] * w01 +
            srcRgba[i11 * 4 + 2] * w11) *
            inv
        );
      } else {
        const nx = clampRange(Math.round(sx), 0, srcW - 1);
        const ny = clampRange(Math.round(sy), 0, srcH - 1);
        const s4 = (ny * srcW + nx) * 4;
        out[o4] = srcRgba[s4];
        out[o4 + 1] = srcRgba[s4 + 1];
        out[o4 + 2] = srcRgba[s4 + 2];
      }
      out[o4 + 3] = 255;
    }
  }
  return out;
}

function downsampleRgbaBilinear(
  srcRgba: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstRgba: Uint8ClampedArray,
  dstStrideW: number,
  offsetX: number,
  offsetY: number,
  dstW: number,
  dstH: number
): void {
  for (let y = 0; y < dstH; y++) {
    const sy = ((y + 0.5) * srcH) / dstH - 0.5;
    const y0 = clampRange(Math.floor(sy), 0, srcH - 1);
    const y1 = Math.min(srcH - 1, y0 + 1);
    const fy = clamp01(sy - y0);
    const r0 = y0 * srcW;
    const r1 = y1 * srcW;
    const outRow = (offsetY + y) * dstStrideW + offsetX;

    for (let x = 0; x < dstW; x++) {
      const sx = ((x + 0.5) * srcW) / dstW - 0.5;
      const x0 = clampRange(Math.floor(sx), 0, srcW - 1);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const fx = clamp01(sx - x0);

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const p00 = (r0 + x0) * 4;
      const p10 = (r0 + x1) * 4;
      const p01 = (r1 + x0) * 4;
      const p11 = (r1 + x1) * 4;
      const o4 = (outRow + x) * 4;

      dstRgba[o4] = clampByte(
        srcRgba[p00] * w00 +
          srcRgba[p10] * w10 +
          srcRgba[p01] * w01 +
          srcRgba[p11] * w11
      );
      dstRgba[o4 + 1] = clampByte(
        srcRgba[p00 + 1] * w00 +
          srcRgba[p10 + 1] * w10 +
          srcRgba[p01 + 1] * w01 +
          srcRgba[p11 + 1] * w11
      );
      dstRgba[o4 + 2] = clampByte(
        srcRgba[p00 + 2] * w00 +
          srcRgba[p10 + 2] * w10 +
          srcRgba[p01 + 2] * w01 +
          srcRgba[p11 + 2] * w11
      );
      dstRgba[o4 + 3] = clampByte(
        srcRgba[p00 + 3] * w00 +
          srcRgba[p10 + 3] * w10 +
          srcRgba[p01 + 3] * w01 +
          srcRgba[p11 + 3] * w11
      );
    }
  }
}

function sampleMaskedLum(
  lum: Float32Array,
  mask: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  fallbackLum: number
): number {
  if (x < 0 || x >= w || y < 0 || y >= h) return fallbackLum;
  const idx = y * w + x;
  return mask[idx] === 1 ? lum[idx] : fallbackLum;
}

function dilateEdgeProtection(
  raw: Float32Array,
  mask: Uint8Array,
  w: number,
  h: number
): Float32Array {
  const dilated = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const idx = row + x;
      if (mask[idx] !== 1) continue;
      let maxNeighbor = 0;
      if (x > 0 && mask[idx - 1] === 1) maxNeighbor = Math.max(maxNeighbor, raw[idx - 1]);
      if (x + 1 < w && mask[idx + 1] === 1) maxNeighbor = Math.max(maxNeighbor, raw[idx + 1]);
      if (y > 0 && mask[idx - w] === 1) maxNeighbor = Math.max(maxNeighbor, raw[idx - w]);
      if (y + 1 < h && mask[idx + w] === 1) maxNeighbor = Math.max(maxNeighbor, raw[idx + w]);
      dilated[idx] = Math.max(raw[idx], 0.75 * maxNeighbor);
    }
  }
  return dilated;
}

function computeSobelEdgeProtection(
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  w: number,
  h: number
): Float32Array {
  const total = w * h;
  const lum = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    if (mask[i] === 1) {
      const p = i * 4;
      lum[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    }
  }

  const raw = new Float32Array(total);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const idx = row + x;
      if (mask[idx] !== 1) continue;
      const c = lum[idx];
      const tl = sampleMaskedLum(lum, mask, w, h, x - 1, y - 1, c);
      const tc = sampleMaskedLum(lum, mask, w, h, x, y - 1, c);
      const tr = sampleMaskedLum(lum, mask, w, h, x + 1, y - 1, c);
      const ml = sampleMaskedLum(lum, mask, w, h, x - 1, y, c);
      const mr = sampleMaskedLum(lum, mask, w, h, x + 1, y, c);
      const bl = sampleMaskedLum(lum, mask, w, h, x - 1, y + 1, c);
      const bc = sampleMaskedLum(lum, mask, w, h, x, y + 1, c);
      const br = sampleMaskedLum(lum, mask, w, h, x + 1, y + 1, c);

      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      const sobelMag = Math.hypot(gx, gy);
      const ridgeContrast =
        Math.max(
          Math.abs(c - ml),
          Math.abs(c - mr),
          Math.abs(c - tc),
          Math.abs(c - bc),
          Math.abs(c - tl),
          Math.abs(c - tr),
          Math.abs(c - bl),
          Math.abs(c - br)
        ) * 2;
      raw[idx] = smoothstep(48, 160, Math.max(sobelMag, ridgeContrast));
    }
  }

  return dilateEdgeProtection(raw, mask, w, h);
}

// --- 14 Motif SDF Evaluators (sd <= 0 is inside shape) ---

function sdfPetals(u: number, v: number, count: number): number {
  const n = Math.round(clampRange(count || 5, 3, 8));
  let best = Math.hypot(u, v) - 0.24;
  for (let i = 0; i < n; i++) {
    const a = (i * Math.PI * 2) / n;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const pu = u * ca + v * sa - 0.48;
    const pv = -u * sa + v * ca;
    const d = Math.hypot(pu / 0.42, pv / 0.21) * 0.21 - 0.21;
    if (d < best) best = d;
  }
  return best;
}

function sdfLeaves(u: number, v: number, count: number): number {
  const n = Math.round(clampRange(count || 2, 1, 4));
  let best = 2;
  for (let i = 0; i < n; i++) {
    const spread = n === 1 ? 0 : ((i / (n - 1)) - 0.5) * 1.1;
    const ca = Math.cos(spread);
    const sa = Math.sin(spread);
    const lu = u * ca + v * sa;
    const lv = -u * sa + v * ca;
    const halfWidth = 0.46 * Math.max(0, 1 - lu * lu);
    const d = Math.abs(lu) > 1 ? Math.hypot(Math.abs(lu) - 1, lv) : Math.abs(lv) - halfWidth;
    if (d < best) best = d;
  }
  return best;
}

function sdfPebbles(u: number, v: number, count: number, phase: number): number {
  const n = Math.round(clampRange(count || 4, 2, 6));
  let best = 2;
  for (let i = 0; i < n; i++) {
    const ang = phase + i * 2.39996;
    const dist = i === 0 ? 0.08 : 0.38;
    const du = (u - Math.cos(ang) * dist) / 0.34;
    const dv = (v - Math.sin(ang) * dist) / 0.25;
    const d = (Math.pow(Math.abs(du), 2.4) + Math.pow(Math.abs(dv), 2.4) - 1) * 0.22;
    if (d < best) best = d;
  }
  return best;
}

function sdfRipples(u: number, v: number, count: number): number {
  const n = Math.round(clampRange(count || 3, 2, 4));
  const r = Math.hypot(u, v * 1.35);
  let best = 2;
  for (let i = 0; i < n; i++) {
    const ringR = 0.24 + (i * 0.64) / Math.max(1, n - 1);
    const d = Math.abs(r - ringR) - 0.065;
    if (d < best) best = d;
  }
  return best;
}

function sdfStars(u: number, v: number): number {
  const r = Math.hypot(u, v);
  const theta = Math.atan2(v, u);
  const spoke = 0.5 + 0.5 * Math.cos(5 * theta);
  return r - (0.44 + 0.54 * Math.pow(spoke, 1.6));
}

function sdfClouds(u: number, v: number): number {
  const c1 = Math.hypot(u + 0.42, v - 0.06) - 0.34;
  const c2 = Math.hypot(u - 0.42, v - 0.08) - 0.32;
  const c3 = Math.hypot(u - 0.04, v + 0.16) - 0.44;
  const c4 = Math.hypot(u + 0.18, v + 0.08) - 0.36;
  const puffs = Math.min(Math.min(c1, c2), Math.min(c3, c4));
  return Math.max(puffs, v - 0.28);
}

function sdfHills(u: number, v: number, count: number, phase: number): number {
  const n = Math.round(clampRange(count || 2, 1, 3));
  let best = 2;
  for (let i = 0; i < n; i++) {
    const shift = (i - (n - 1) * 0.5) * 0.48;
    const ridgeY = 0.18 - 0.52 * Math.cos(clampRange((u - shift) * 1.6, -Math.PI, Math.PI));
    const baseClip = Math.max(v - 0.58, Math.abs(u) - 0.96);
    const d = Math.max(ridgeY - v - 0.12 + 0.04 * Math.sin(phase + i), baseClip);
    if (d < best) best = d;
  }
  return best;
}

function sdfTrees(u: number, v: number): number {
  const trunk = Math.max(Math.abs(u) - 0.12, Math.abs(v - 0.56) - 0.24);
  const t1 = Math.max(Math.abs(u) - (0.14 + (v + 0.85) * 0.65), Math.abs(v + 0.55) - 0.28);
  const t2 = Math.max(Math.abs(u) - (0.18 + (v + 0.5) * 0.72), Math.abs(v + 0.2) - 0.3);
  const t3 = Math.max(Math.abs(u) - (0.24 + (v + 0.15) * 0.76), Math.abs(v - 0.14) - 0.28);
  return Math.min(trunk, Math.min(t1, Math.min(t2, t3)));
}

function sdfMushrooms(u: number, v: number): number {
  const capEllipse = Math.hypot(u / 0.76, (v + 0.16) / 0.56) * 0.56 - 0.56;
  const cap = Math.max(capEllipse, v + 0.06);
  const stemHalfW = 0.22 - 0.04 * clampRange(v, -0.1, 0.7);
  const stem = Math.max(Math.abs(u) - stemHalfW, Math.abs(v - 0.36) - 0.38);
  return Math.min(cap, stem);
}

function sdfWaves(u: number, v: number, count: number, phase: number): number {
  const n = Math.round(clampRange(count || 3, 2, 3));
  let best = 2;
  for (let i = 0; i < n; i++) {
    const yOff = (i - (n - 1) * 0.5) * 0.42;
    const waveY = yOff + 0.16 * Math.sin(u * 4.2 + phase + i * 1.1);
    const d = Math.max(Math.abs(v - waveY) - 0.08, Math.abs(u) - 0.94);
    if (d < best) best = d;
  }
  return best;
}

function sdfSparkles(u: number, v: number): number {
  return Math.pow(Math.abs(u), 0.62) + Math.pow(Math.abs(v), 0.62) - 1;
}

function sdfVines(u: number, v: number, count: number, phase: number): number {
  const stemX = 0.24 * Math.sin(v * 3.4 + phase);
  let best = Math.max(Math.abs(u - stemX) - 0.075, Math.abs(v) - 0.92);
  const buds = Math.round(clampRange(count || 3, 2, 5));
  for (let i = 0; i < buds; i++) {
    const bv = -0.65 + (i * 1.3) / Math.max(1, buds - 1);
    const side = i % 2 === 0 ? 1 : -1;
    const bx = 0.24 * Math.sin(bv * 3.4 + phase) + side * 0.24;
    const d = Math.hypot((u - bx) / 0.22, (v - bv) / 0.13) * 0.13 - 0.13;
    if (d < best) best = d;
  }
  return best;
}

function sdfGeometric(u: number, v: number): number {
  const au = Math.abs(u);
  const av = Math.abs(v);
  return Math.max(au, 0.5 * au + 0.8660254 * av) - 0.88;
}

function sdfOrganicBlobs(u: number, v: number, _count: number, phase: number): number {
  const r = Math.hypot(u, v);
  const theta = Math.atan2(v, u);
  const radius =
    0.78 + 0.15 * Math.sin(2 * theta + phase) + 0.1 * Math.cos(3 * theta - phase);
  return r - radius;
}

const MOTIF_EVALUATORS: Record<InfiniteZoomMotifKind, MotifSdfFn> = {
  petals: sdfPetals,
  leaves: sdfLeaves,
  pebbles: sdfPebbles,
  ripples: sdfRipples,
  stars: sdfStars,
  clouds: sdfClouds,
  hills: sdfHills,
  trees: sdfTrees,
  mushrooms: sdfMushrooms,
  waves: sdfWaves,
  sparkles: sdfSparkles,
  vines: sdfVines,
  geometric: sdfGeometric,
  'organic-blobs': sdfOrganicBlobs,
};

interface RasterizeMotifOptions {
  outRgba: Uint8ClampedArray;
  baseRgba: Uint8ClampedArray | null;
  mask: Uint8Array;
  protection: Float32Array | null;
  width: number;
  height: number;
  element: InfiniteZoomSceneElement;
  centerX: number;
  centerY: number;
  phase: number;
  maxDeltaE: number | null;
}

function blendMotifPixel(
  opts: RasterizeMotifOptions,
  idx: number,
  cov: number,
  rgb: [number, number, number]
): void {
  const p = idx * 4;
  const inv = 1 - cov;
  const wantR = opts.outRgba[p] * inv + rgb[0] * cov;
  const wantG = opts.outRgba[p + 1] * inv + rgb[1] * cov;
  const wantB = opts.outRgba[p + 2] * inv + rgb[2] * cov;

  if (opts.baseRgba && opts.maxDeltaE !== null) {
    const [r, g, b] = clampRgbToMaxDeltaE(
      opts.baseRgba[p],
      opts.baseRgba[p + 1],
      opts.baseRgba[p + 2],
      wantR,
      wantG,
      wantB,
      opts.maxDeltaE
    );
    opts.outRgba[p] = r;
    opts.outRgba[p + 1] = g;
    opts.outRgba[p + 2] = b;
  } else {
    opts.outRgba[p] = clampByte(wantR);
    opts.outRgba[p + 1] = clampByte(wantG);
    opts.outRgba[p + 2] = clampByte(wantB);
  }
  opts.outRgba[p + 3] = 255;
}

function rasterizeMotifElement(opts: RasterizeMotifOptions): void {
  const fillRgb = parseHexRgb(opts.element.fillHex) ?? [96, 165, 250];
  const strokeRgb = parseHexRgb(opts.element.strokeHex);
  const evaluator =
    MOTIF_EVALUATORS[opts.element.kind] ?? MOTIF_EVALUATORS['organic-blobs'];
  const minDim = Math.min(opts.width, opts.height);
  const scale = clampRange(opts.element.scale || 0.24, 0.04, 0.65);
  const radiusPx = Math.max(4, minDim * scale * 0.5);
  const invRadius = 1 / radiusPx;

  const rad = -((opts.element.rotationDeg || 0) * Math.PI) / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);
  const count = opts.element.count ?? 4;
  const strokeHalfPx = Math.max(1, radiusPx * 0.06);
  const padPx = Math.ceil(radiusPx * 1.25 + strokeHalfPx + 2);

  const x0 = Math.max(0, Math.floor(opts.centerX - padPx));
  const x1 = Math.min(opts.width - 1, Math.ceil(opts.centerX + padPx));
  const y0 = Math.max(0, Math.floor(opts.centerY - padPx));
  const y1 = Math.min(opts.height - 1, Math.ceil(opts.centerY + padPx));

  for (let y = y0; y <= y1; y++) {
    const dy = (y - opts.centerY) * invRadius;
    const row = y * opts.width;
    for (let x = x0; x <= x1; x++) {
      const idx = row + x;
      if (opts.mask[idx] !== 1) continue;

      const dx = (x - opts.centerX) * invRadius;
      const u = dx * cosR - dy * sinR;
      const v = dx * sinR + dy * cosR;
      const sdPx = evaluator(u, v, count, opts.phase) * radiusPx;

      const prot = opts.protection ? 1 - opts.protection[idx] : 1;
      if (prot <= 0.001) continue;

      const fillCov = clamp01(0.5 - sdPx) * prot;
      if (fillCov > 0.005) {
        blendMotifPixel(opts, idx, fillCov, fillRgb);
      }
      if (strokeRgb) {
        const strokeCov = clamp01(strokeHalfPx - Math.abs(sdPx)) * prot;
        if (strokeCov > 0.005) {
          blendMotifPixel(opts, idx, strokeCov, strokeRgb);
        }
      }
    }
  }
}

export function synthesizeInfillRgba(
  params: SynthesizeInfillRgbaParams
): SynthesizeInfillRgbaResult {
  const { cropRgba, cropWidth, cropHeight, cropMask, scenePlan, mode } = params;
  if (
    !Number.isInteger(cropWidth) ||
    !Number.isInteger(cropHeight) ||
    cropWidth < 1 ||
    cropHeight < 1
  ) {
    throw new Error('Invalid crop dimensions for infill synthesis.');
  }
  const pixelCount = cropWidth * cropHeight;
  if (cropRgba.length < pixelCount * 4 || cropMask.length < pixelCount) {
    throw new Error('Crop RGBA or mask buffer is smaller than crop dimensions.');
  }

  const maxDeltaE =
    Number.isFinite(params.maxDeltaE) && (params.maxDeltaE as number) >= 0
      ? (params.maxDeltaE as number)
      : INFILL_MAX_DELTA_E;

  let outWidth = cropWidth;
  let outHeight = cropHeight;
  let scaleFactor = 1;
  let workMask: Uint8Array;
  let baseRgba: Uint8ClampedArray;

  if (mode === 'child-tile') {
    const maxCropDim = Math.max(cropWidth, cropHeight);
    scaleFactor = Math.min(4, CHILD_TILE_MAX_DIM_PX / maxCropDim);
    outWidth = Math.max(
      1,
      Math.min(CHILD_TILE_MAX_DIM_PX, Math.round(cropWidth * scaleFactor))
    );
    outHeight = Math.max(
      1,
      Math.min(CHILD_TILE_MAX_DIM_PX, Math.round(cropHeight * scaleFactor))
    );
    workMask = upscaleBinaryMaskBilinear(
      cropMask,
      cropWidth,
      cropHeight,
      outWidth,
      outHeight
    );
    baseRgba = upscaleRgbaMaskAwareBilinear(
      cropRgba,
      cropMask,
      cropWidth,
      cropHeight,
      outWidth,
      outHeight,
      workMask
    );
  } else {
    workMask = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      workMask[i] = cropMask[i] === 1 ? 1 : 0;
    }
    baseRgba = new Uint8ClampedArray(cropRgba.subarray(0, pixelCount * 4));
  }

  const protection = computeSobelEdgeProtection(
    baseRgba,
    workMask,
    outWidth,
    outHeight
  );
  const outRgba = new Uint8ClampedArray(baseRgba);
  const elements = Array.isArray(scenePlan?.elements) ? scenePlan.elements : [];

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    rasterizeMotifElement({
      outRgba,
      baseRgba,
      mask: workMask,
      protection,
      width: outWidth,
      height: outHeight,
      element: el,
      centerX: clamp01(el.x) * outWidth,
      centerY: clamp01(el.y) * outHeight,
      phase: i * 1.17,
      maxDeltaE,
    });
  }

  return {
    rgba: outRgba,
    width: outWidth,
    height: outHeight,
    mask: workMask,
    mode,
    scaleFactor,
  };
}

// --- Directional Border Extrapolation Helpers ---

function sampleHorizontalEdgeProfile(
  rgba: Uint8ClampedArray,
  strideW: number,
  offsetX: number,
  offsetY: number,
  innerW: number,
  innerH: number,
  isTop: boolean
): EdgeProfile {
  const slices = Math.max(16, Math.min(32, Math.round(innerW / 32)));
  const edgeR = new Float32Array(slices);
  const edgeG = new Float32Array(slices);
  const edgeB = new Float32Array(slices);
  const trendR = new Float32Array(slices);
  const trendG = new Float32Array(slices);
  const trendB = new Float32Array(slices);
  const edgeLum = new Float32Array(slices);
  const innerLum = new Float32Array(slices);
  const edgeDepth = Math.min(3, innerH);
  const innerStart = Math.min(3, Math.max(0, innerH - 1));
  const innerEnd = Math.min(8, innerH);

  for (let s = 0; s < slices; s++) {
    const x0 = offsetX + Math.floor((s * innerW) / slices);
    const x1 = Math.max(x0 + 1, offsetX + Math.floor(((s + 1) * innerW) / slices));
    let er = 0;
    let eg = 0;
    let eb = 0;
    let ec = 0;
    let ir = 0;
    let ig = 0;
    let ib = 0;
    let ic = 0;

    for (let d = 0; d < edgeDepth; d++) {
      const y = isTop ? offsetY + d : offsetY + innerH - 1 - d;
      const row = y * strideW;
      for (let x = x0; x < x1; x++) {
        const p = (row + x) * 4;
        er += rgba[p];
        eg += rgba[p + 1];
        eb += rgba[p + 2];
        ec += 1;
      }
    }
    for (let d = innerStart; d < innerEnd; d++) {
      const y = isTop ? offsetY + d : offsetY + innerH - 1 - d;
      const row = y * strideW;
      for (let x = x0; x < x1; x++) {
        const p = (row + x) * 4;
        ir += rgba[p];
        ig += rgba[p + 1];
        ib += rgba[p + 2];
        ic += 1;
      }
    }

    const invE = ec > 0 ? 1 / ec : 1;
    const invI = ic > 0 ? 1 / ic : invE;
    edgeR[s] = er * invE;
    edgeG[s] = eg * invE;
    edgeB[s] = eb * invE;
    const inR = ic > 0 ? ir * invI : edgeR[s];
    const inG = ic > 0 ? ig * invI : edgeG[s];
    const inB = ic > 0 ? ib * invI : edgeB[s];
    trendR[s] = clampRange(edgeR[s] - inR, -18, 18);
    trendG[s] = clampRange(edgeG[s] - inG, -18, 18);
    trendB[s] = clampRange(edgeB[s] - inB, -18, 18);
    edgeLum[s] = 0.299 * edgeR[s] + 0.587 * edgeG[s] + 0.114 * edgeB[s];
    innerLum[s] = 0.299 * inR + 0.587 * inG + 0.114 * inB;
  }

  return {
    slices,
    edgeR,
    edgeG,
    edgeB,
    trendR,
    trendG,
    trendB,
    tangent: estimateProfileTangents(edgeLum, innerLum, slices),
  };
}

function sampleVerticalEdgeProfile(
  rgba: Uint8ClampedArray,
  strideW: number,
  offsetX: number,
  offsetY: number,
  innerW: number,
  innerH: number,
  isLeft: boolean
): EdgeProfile {
  const slices = Math.max(16, Math.min(32, Math.round(innerH / 32)));
  const edgeR = new Float32Array(slices);
  const edgeG = new Float32Array(slices);
  const edgeB = new Float32Array(slices);
  const trendR = new Float32Array(slices);
  const trendG = new Float32Array(slices);
  const trendB = new Float32Array(slices);
  const edgeLum = new Float32Array(slices);
  const innerLum = new Float32Array(slices);
  const edgeDepth = Math.min(3, innerW);
  const innerStart = Math.min(3, Math.max(0, innerW - 1));
  const innerEnd = Math.min(8, innerW);

  for (let s = 0; s < slices; s++) {
    const y0 = offsetY + Math.floor((s * innerH) / slices);
    const y1 = Math.max(y0 + 1, offsetY + Math.floor(((s + 1) * innerH) / slices));
    let er = 0;
    let eg = 0;
    let eb = 0;
    let ec = 0;
    let ir = 0;
    let ig = 0;
    let ib = 0;
    let ic = 0;

    for (let y = y0; y < y1; y++) {
      const row = y * strideW;
      for (let d = 0; d < edgeDepth; d++) {
        const x = isLeft ? offsetX + d : offsetX + innerW - 1 - d;
        const p = (row + x) * 4;
        er += rgba[p];
        eg += rgba[p + 1];
        eb += rgba[p + 2];
        ec += 1;
      }
      for (let d = innerStart; d < innerEnd; d++) {
        const x = isLeft ? offsetX + d : offsetX + innerW - 1 - d;
        const p = (row + x) * 4;
        ir += rgba[p];
        ig += rgba[p + 1];
        ib += rgba[p + 2];
        ic += 1;
      }
    }

    const invE = ec > 0 ? 1 / ec : 1;
    const invI = ic > 0 ? 1 / ic : invE;
    edgeR[s] = er * invE;
    edgeG[s] = eg * invE;
    edgeB[s] = eb * invE;
    const inR = ic > 0 ? ir * invI : edgeR[s];
    const inG = ic > 0 ? ig * invI : edgeG[s];
    const inB = ic > 0 ? ib * invI : edgeB[s];
    trendR[s] = clampRange(edgeR[s] - inR, -18, 18);
    trendG[s] = clampRange(edgeG[s] - inG, -18, 18);
    trendB[s] = clampRange(edgeB[s] - inB, -18, 18);
    edgeLum[s] = 0.299 * edgeR[s] + 0.587 * edgeG[s] + 0.114 * edgeB[s];
    innerLum[s] = 0.299 * inR + 0.587 * inG + 0.114 * inB;
  }

  return {
    slices,
    edgeR,
    edgeG,
    edgeB,
    trendR,
    trendG,
    trendB,
    tangent: estimateProfileTangents(edgeLum, innerLum, slices),
  };
}

function estimateProfileTangents(
  edgeLum: Float32Array,
  innerLum: Float32Array,
  slices: number
): Float32Array {
  const tangent = new Float32Array(slices);
  for (let s = 0; s < slices; s++) {
    const leftIdx = Math.max(0, s - 1);
    const rightIdx = Math.min(slices - 1, s + 1);
    const dLeft = Math.abs(edgeLum[s] - innerLum[leftIdx]);
    const dMid = Math.abs(edgeLum[s] - innerLum[s]);
    const dRight = Math.abs(edgeLum[s] - innerLum[rightIdx]);
    if (dLeft + 4 < dMid && dLeft <= dRight) {
      tangent[s] = 0.32;
    } else if (dRight + 4 < dMid && dRight < dLeft) {
      tangent[s] = -0.32;
    } else {
      tangent[s] = 0;
    }
  }
  return tangent;
}

function evaluateProfileAt(
  profile: EdgeProfile,
  u: number,
  outDistPx: number,
  bandPx: number,
  spanPx: number,
  accents: Array<[number, number, number]>
): [number, number, number] {
  const pos0 = clamp01(u) * (profile.slices - 1);
  const idx0 = Math.floor(pos0);
  const idx1 = Math.min(profile.slices - 1, idx0 + 1);
  const frac0 = pos0 - idx0;
  const tan =
    profile.tangent[idx0] * (1 - frac0) + profile.tangent[idx1] * frac0;

  const wave = 0.03 * spanPx * Math.sin(u * Math.PI * 4 + outDistPx * 0.025);
  const uShifted = clamp01(u + (tan * outDistPx + wave) / Math.max(1, spanPx));
  const pos = uShifted * (profile.slices - 1);
  const s0 = Math.floor(pos);
  const s1 = Math.min(profile.slices - 1, s0 + 1);
  const f = pos - s0;

  const tDist = clamp01(outDistPx / Math.max(1, bandPx));
  let r =
    profile.edgeR[s0] * (1 - f) +
    profile.edgeR[s1] * f +
    (profile.trendR[s0] * (1 - f) + profile.trendR[s1] * f) * tDist * 0.55;
  let g =
    profile.edgeG[s0] * (1 - f) +
    profile.edgeG[s1] * f +
    (profile.trendG[s0] * (1 - f) + profile.trendG[s1] * f) * tDist * 0.55;
  let b =
    profile.edgeB[s0] * (1 - f) +
    profile.edgeB[s1] * f +
    (profile.trendB[s0] * (1 - f) + profile.trendB[s1] * f) * tDist * 0.55;

  if (accents.length > 0 && tDist > 0.12) {
    let best = accents[0];
    let bestSq = Number.POSITIVE_INFINITY;
    for (const acc of accents) {
      const sq = ColorQuantizer.perceptualDistanceSq(
        clampByte(r),
        clampByte(g),
        clampByte(b),
        acc[0],
        acc[1],
        acc[2]
      );
      if (sq < bestSq) {
        bestSq = sq;
        best = acc;
      }
    }
    const mix = smoothstep(0.12, 1, tDist) * 0.22;
    r = r * (1 - mix) + best[0] * mix;
    g = g * (1 - mix) + best[1] * mix;
    b = b * (1 - mix) + best[2] * mix;
  }

  return [clampByte(r), clampByte(g), clampByte(b)];
}

function fillExtrapolatedBorder(
  outRgba: Uint8ClampedArray,
  outerMask: Uint8Array,
  check: ExtendSidesCheck,
  accents: Array<[number, number, number]>
): void {
  const { nextWidth, nextHeight, offsetX, offsetY, innerWidth, innerHeight } =
    check;
  const topProfile = sampleHorizontalEdgeProfile(
    outRgba,
    nextWidth,
    offsetX,
    offsetY,
    innerWidth,
    innerHeight,
    true
  );
  const bottomProfile = sampleHorizontalEdgeProfile(
    outRgba,
    nextWidth,
    offsetX,
    offsetY,
    innerWidth,
    innerHeight,
    false
  );
  const leftProfile = sampleVerticalEdgeProfile(
    outRgba,
    nextWidth,
    offsetX,
    offsetY,
    innerWidth,
    innerHeight,
    true
  );
  const rightProfile = sampleVerticalEdgeProfile(
    outRgba,
    nextWidth,
    offsetX,
    offsetY,
    innerWidth,
    innerHeight,
    false
  );

  const maxInnerX = offsetX + innerWidth - 1;
  const maxInnerY = offsetY + innerHeight - 1;

  for (let y = 0; y < nextHeight; y++) {
    const row = y * nextWidth;
    const cy = clampRange(y, offsetY, maxInnerY);
    const dy = y - cy;
    const vNorm = (cy - offsetY) / Math.max(1, innerHeight - 1);

    for (let x = 0; x < nextWidth; x++) {
      const idx = row + x;
      if (outerMask[idx] !== 1) continue;

      const cx = clampRange(x, offsetX, maxInnerX);
      const dx = x - cx;
      const uNorm = (cx - offsetX) / Math.max(1, innerWidth - 1);
      const o4 = idx * 4;

      if (dx === 0) {
        const prof = dy < 0 ? topProfile : bottomProfile;
        const band = dy < 0 ? check.padTop : check.padBottom;
        const [r, g, b] = evaluateProfileAt(
          prof,
          uNorm,
          Math.abs(dy),
          band,
          innerWidth,
          accents
        );
        outRgba[o4] = r;
        outRgba[o4 + 1] = g;
        outRgba[o4 + 2] = b;
        outRgba[o4 + 3] = 255;
      } else if (dy === 0) {
        const prof = dx < 0 ? leftProfile : rightProfile;
        const band = dx < 0 ? check.padLeft : check.padRight;
        const [r, g, b] = evaluateProfileAt(
          prof,
          vNorm,
          Math.abs(dx),
          band,
          innerHeight,
          accents
        );
        outRgba[o4] = r;
        outRgba[o4 + 1] = g;
        outRgba[o4 + 2] = b;
        outRgba[o4 + 3] = 255;
      } else {
        const hProf = dy < 0 ? topProfile : bottomProfile;
        const hBand = dy < 0 ? check.padTop : check.padBottom;
        const vProf = dx < 0 ? leftProfile : rightProfile;
        const vBand = dx < 0 ? check.padLeft : check.padRight;
        const [hr, hg, hb] = evaluateProfileAt(
          hProf,
          uNorm,
          Math.abs(dy),
          hBand,
          innerWidth,
          accents
        );
        const [vr, vg, vb] = evaluateProfileAt(
          vProf,
          vNorm,
          Math.abs(dx),
          vBand,
          innerHeight,
          accents
        );
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        const inv = 1 / (adx + ady);
        const wV = adx * inv;
        const wH = ady * inv;
        outRgba[o4] = clampByte(vr * wV + hr * wH);
        outRgba[o4 + 1] = clampByte(vg * wV + hg * wH);
        outRgba[o4 + 2] = clampByte(vb * wV + hb * wH);
        outRgba[o4 + 3] = 255;
      }
    }
  }
}

function projectElementToOuterBand(
  el: InfiniteZoomSceneElement,
  index: number,
  check: ExtendSidesCheck
): { centerX: number; centerY: number } {
  const rawX = clamp01(el.x) * check.nextWidth;
  const rawY = clamp01(el.y) * check.nextHeight;
  const inInnerX =
    rawX >= check.offsetX && rawX < check.offsetX + check.innerWidth;
  const inInnerY =
    rawY >= check.offsetY && rawY < check.offsetY + check.innerHeight;
  if (!inInnerX || !inInnerY) {
    return { centerX: rawX, centerY: rawY };
  }

  const activeBands: Array<'top' | 'bottom' | 'left' | 'right'> = [];
  if (check.padTop > 0) activeBands.push('top');
  if (check.padBottom > 0) activeBands.push('bottom');
  if (check.padLeft > 0) activeBands.push('left');
  if (check.padRight > 0) activeBands.push('right');
  const side = activeBands[index % Math.max(1, activeBands.length)] ?? 'top';
  const depthFrac = 0.3 + ((index * 0.19) % 0.5);

  if (side === 'top') {
    return {
      centerX: clamp01(el.x) * check.nextWidth,
      centerY: check.padTop * (1 - depthFrac),
    };
  }
  if (side === 'bottom') {
    return {
      centerX: clamp01(el.x) * check.nextWidth,
      centerY: check.offsetY + check.innerHeight + check.padBottom * depthFrac,
    };
  }
  if (side === 'left') {
    return {
      centerX: check.padLeft * (1 - depthFrac),
      centerY: clamp01(el.y) * check.nextHeight,
    };
  }
  return {
    centerX: check.offsetX + check.innerWidth + check.padRight * depthFrac,
    centerY: clamp01(el.y) * check.nextHeight,
  };
}

function applyOuterSeamFeather(
  outRgba: Uint8ClampedArray,
  outerMask: Uint8Array,
  check: ExtendSidesCheck
): void {
  const { nextWidth, nextHeight, offsetX, offsetY, innerWidth, innerHeight } =
    check;
  const maxInnerX = offsetX + innerWidth - 1;
  const maxInnerY = offsetY + innerHeight - 1;

  for (let y = 0; y < nextHeight; y++) {
    const row = y * nextWidth;
    const cy = clampRange(y, offsetY, maxInnerY);
    const dy = y - cy;
    const padY = dy < 0 ? check.padTop : dy > 0 ? check.padBottom : 0;

    for (let x = 0; x < nextWidth; x++) {
      const idx = row + x;
      if (outerMask[idx] !== 1) continue;

      const cx = clampRange(x, offsetX, maxInnerX);
      const dx = x - cx;
      const padX = dx < 0 ? check.padLeft : dx > 0 ? check.padRight : 0;
      const localBandPx = Math.max(padX, padY);
      const featherPx = Math.max(2, Math.round(localBandPx * 0.08));
      const distPx = Math.hypot(dx, dy);
      if (distPx > featherPx) continue;

      const t = clamp01(distPx / featherPx);
      const w = t * t * (3 - 2 * t);
      const inv = 1 - w;
      const seam4 = (cy * nextWidth + cx) * 4;
      const o4 = idx * 4;

      outRgba[o4] = clampByte(outRgba[seam4] * inv + outRgba[o4] * w);
      outRgba[o4 + 1] = clampByte(outRgba[seam4 + 1] * inv + outRgba[o4 + 1] * w);
      outRgba[o4 + 2] = clampByte(outRgba[seam4 + 2] * inv + outRgba[o4 + 2] * w);
      outRgba[o4 + 3] = 255;
    }
  }
}

export function synthesizeExtendedBorderRgba(
  params: SynthesizeExtendedBorderRgbaParams
): SynthesizeExtendedBorderRgbaResult {
  const { sourceRgba, sourceWidth, sourceHeight, sides, scenePlan } = params;
  if (
    !Number.isInteger(sourceWidth) ||
    !Number.isInteger(sourceHeight) ||
    sourceWidth < 1 ||
    sourceHeight < 1
  ) {
    throw new Error('Invalid source dimensions for border extension.');
  }
  const check = canExtendSides(sourceWidth, sourceHeight, sides);
  if (!check.allowed) {
    throw new Error(
      check.reason || 'Border extension not allowed for selected sides.'
    );
  }
  if (sourceRgba.length < sourceWidth * sourceHeight * 4) {
    throw new Error('Source RGBA buffer is smaller than source dimensions.');
  }

  const { nextWidth, nextHeight, offsetX, offsetY, innerWidth, innerHeight } =
    check;
  const outRgba = new Uint8ClampedArray(nextWidth * nextHeight * 4);

  if (
    check.scaleFactor === 1 &&
    innerWidth === sourceWidth &&
    innerHeight === sourceHeight
  ) {
    const rowBytes = sourceWidth * 4;
    for (let y = 0; y < sourceHeight; y++) {
      const srcStart = y * rowBytes;
      const dstStart = ((offsetY + y) * nextWidth + offsetX) * 4;
      outRgba.set(sourceRgba.subarray(srcStart, srcStart + rowBytes), dstStart);
    }
  } else {
    downsampleRgbaBilinear(
      sourceRgba,
      sourceWidth,
      sourceHeight,
      outRgba,
      nextWidth,
      offsetX,
      offsetY,
      innerWidth,
      innerHeight
    );
  }

  const outerMask = new Uint8Array(nextWidth * nextHeight);
  outerMask.fill(1);
  for (let y = 0; y < innerHeight; y++) {
    const start = (offsetY + y) * nextWidth + offsetX;
    outerMask.fill(0, start, start + innerWidth);
  }

  const accents: Array<[number, number, number]> = [];
  for (const hex of scenePlan?.paletteAccentsHex ?? []) {
    const rgb = parseHexRgb(hex);
    if (rgb) accents.push(rgb);
  }

  fillExtrapolatedBorder(outRgba, outerMask, check, accents);

  const elements = Array.isArray(scenePlan?.elements) ? scenePlan.elements : [];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const { centerX, centerY } = projectElementToOuterBand(el, i, check);
    rasterizeMotifElement({
      outRgba,
      baseRgba: null,
      mask: outerMask,
      protection: null,
      width: nextWidth,
      height: nextHeight,
      element: el,
      centerX,
      centerY,
      phase: i * 1.31,
      maxDeltaE: null,
    });
  }

  applyOuterSeamFeather(outRgba, outerMask, check);

  return {
    rgba: outRgba,
    width: nextWidth,
    height: nextHeight,
    check,
    boundsInParent: check.boundsInParent,
  };
}

// --- Browser Canvas Wrappers (Guarded for Node SSR) ---

function getSourceDimensions(
  source: HTMLCanvasElement | HTMLImageElement
): { width: number; height: number } {
  if ('naturalWidth' in source && source.naturalWidth > 0) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

function extractRgbaFromSource(
  source: HTMLCanvasElement | HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number
): Uint8ClampedArray {
  if (typeof document === 'undefined') {
    throw new Error('Canvas synthesis requires a browser DOM environment.');
  }
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = sw;
  tmpCanvas.height = sh;
  try {
    const ctx =
      tmpCanvas.getContext('2d', { willReadFrequently: true }) ||
      tmpCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to acquire 2D canvas context for synthesis.');
    }
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
    return new Uint8ClampedArray(ctx.getImageData(0, 0, sw, sh).data);
  } finally {
    tmpCanvas.width = 0;
    tmpCanvas.height = 0;
  }
}

function rgbaToHtmlCanvas(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('Canvas synthesis requires a browser DOM environment.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx =
    canvas.getContext('2d', { willReadFrequently: true }) ||
    canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D canvas context for output.');
  }
  const imgData = ctx.createImageData(width, height);
  imgData.data.set(rgba);
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

export function synthesizeInfillCanvas(
  sourceCanvas: HTMLCanvasElement | HTMLImageElement,
  bbox: SubdivisionBbox,
  cropMask: Uint8Array,
  scenePlan: InfiniteZoomScenePlan,
  options: InfillCanvasOptions
): InfillSynthesisResult {
  if (typeof document === 'undefined') {
    throw new Error(
      'synthesizeInfillCanvas requires a browser DOM environment; use synthesizeInfillRgba in headless runtimes.'
    );
  }
  if (
    !bbox ||
    !Number.isFinite(bbox.minX) ||
    !Number.isFinite(bbox.minY) ||
    !Number.isFinite(bbox.width) ||
    !Number.isFinite(bbox.height)
  ) {
    throw new Error('Invalid bounding box for infill canvas synthesis.');
  }
  const cropMinX = Math.floor(bbox.minX);
  const cropMinY = Math.floor(bbox.minY);
  const cropWidth = Math.floor(bbox.width);
  const cropHeight = Math.floor(bbox.height);
  if (
    !Number.isInteger(cropWidth) ||
    !Number.isInteger(cropHeight) ||
    cropWidth < 1 ||
    cropHeight < 1
  ) {
    throw new Error('Invalid crop dimensions for infill canvas synthesis.');
  }
  const cropRgba = extractRgbaFromSource(
    sourceCanvas,
    cropMinX,
    cropMinY,
    cropWidth,
    cropHeight
  );
  const result = synthesizeInfillRgba({
    cropRgba,
    cropWidth,
    cropHeight,
    cropMask,
    scenePlan,
    mode: options.mode,
    maxDeltaE: options.maxDeltaE,
  });
  const canvas = rgbaToHtmlCanvas(result.rgba, result.width, result.height);
  return { ...result, canvas };
}

export function synthesizeExtendedBorderCanvas(
  sourceCanvas: HTMLCanvasElement | HTMLImageElement,
  sides: BorderExtensionSides,
  scenePlan: InfiniteZoomScenePlan
): ExtendedBorderResult {
  if (typeof document === 'undefined') {
    throw new Error(
      'synthesizeExtendedBorderCanvas requires a browser DOM environment; use synthesizeExtendedBorderRgba in headless runtimes.'
    );
  }
  const { width, height } = getSourceDimensions(sourceCanvas);
  const check = canExtendSides(width, height, sides);
  if (!check.allowed) {
    throw new Error(
      check.reason || 'Border extension not allowed for selected sides.'
    );
  }
  const sourceRgba = extractRgbaFromSource(sourceCanvas, 0, 0, width, height);
  const result = synthesizeExtendedBorderRgba({
    sourceRgba,
    sourceWidth: width,
    sourceHeight: height,
    sides,
    scenePlan,
  });
  const canvas = rgbaToHtmlCanvas(result.rgba, result.width, result.height);
  return { ...result, canvas };
}
