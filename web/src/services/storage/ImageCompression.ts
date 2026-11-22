import { reportSwallowed } from '../telemetry';

export const MAX_STORED_IMAGE_DIMENSION = 2048;
export const IMAGE_COMPRESSION_SKIP_BYTES = 350 * 1024;
export const IMAGE_COMPRESSION_QUALITY = 0.85;

export interface TargetImageDimensions {
  width: number;
  height: number;
  resized: boolean;
}

export interface CompressImageOptions {
  maxBytes?: number;
  maxDim?: number;
  quality?: number;
  encode?: (params: {
    mimeType: 'image/webp' | 'image/jpeg';
    quality: number;
    width: number;
    height: number;
    fillWhite: boolean;
  }) => Promise<Blob | null>;
}

export interface CompressImageInput {
  blob?: Blob | null;
  image: CanvasImageSource;
  width: number;
  height: number;
}

export function computeTargetImageDimensions(
  width: number,
  height: number,
  maxDim: number = MAX_STORED_IMAGE_DIMENSION
): TargetImageDimensions {
  const safeW = Math.max(1, Math.round(Number.isFinite(width) ? width : 1));
  const safeH = Math.max(1, Math.round(Number.isFinite(height) ? height : 1));
  const safeMax = Math.max(1, Math.round(Number.isFinite(maxDim) ? maxDim : MAX_STORED_IMAGE_DIMENSION));
  const longest = Math.max(safeW, safeH);
  if (longest <= safeMax) {
    return { width: safeW, height: safeH, resized: false };
  }
  const scale = safeMax / longest;
  return {
    width: Math.max(1, Math.round(safeW * scale)),
    height: Math.max(1, Math.round(safeH * scale)),
    resized: true,
  };
}

export function shouldCompressImageBlob(
  sizeBytes: number,
  width: number,
  height: number,
  options?: { maxBytes?: number; maxDim?: number }
): boolean {
  const maxBytes = options?.maxBytes ?? IMAGE_COMPRESSION_SKIP_BYTES;
  const maxDim = options?.maxDim ?? MAX_STORED_IMAGE_DIMENSION;
  if (width > maxDim || height > maxDim) {
    return true;
  }
  return sizeBytes > maxBytes;
}

export function selectBestCompressedBlob(
  original: Blob | null,
  candidates: Array<Blob | null>
): Blob | null {
  let bestCandidate: Blob | null = null;
  for (const candidate of candidates) {
    if (!candidate || candidate.size <= 0) continue;
    if (!bestCandidate || candidate.size < bestCandidate.size) {
      bestCandidate = candidate;
    }
  }
  if (!original) {
    return bestCandidate;
  }
  if (bestCandidate && bestCandidate.size < original.size) {
    return bestCandidate;
  }
  return original;
}

async function encodeImageOnCanvas(
  image: CanvasImageSource,
  width: number,
  height: number,
  mimeType: 'image/webp' | 'image/jpeg',
  quality: number,
  fillWhite: boolean
): Promise<Blob | null> {
  try {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      if (fillWhite) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(image, 0, 0, width, height);
      return await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((result) => resolve(result), mimeType, quality);
      });
    }
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      if (fillWhite) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(image, 0, 0, width, height);
      return await canvas.convertToBlob({ type: mimeType, quality });
    }
    return null;
  } catch (err) {
    reportSwallowed('ImageCompression.encodeImageOnCanvas', err, { mimeType, width, height });
    return null;
  }
}

export async function compressImageForStorage(
  input: CompressImageInput,
  options?: CompressImageOptions
): Promise<Blob | null> {
  const original = input.blob ?? null;
  const maxBytes = options?.maxBytes ?? IMAGE_COMPRESSION_SKIP_BYTES;
  const maxDim = options?.maxDim ?? MAX_STORED_IMAGE_DIMENSION;
  const quality = options?.quality ?? IMAGE_COMPRESSION_QUALITY;

  if (!Number.isFinite(input.width) || !Number.isFinite(input.height) || input.width <= 0 || input.height <= 0) {
    return original;
  }

  if (original && !shouldCompressImageBlob(original.size, input.width, input.height, { maxBytes, maxDim })) {
    return original;
  }

  const target = computeTargetImageDimensions(input.width, input.height, maxDim);
  const runEncode = (mimeType: 'image/webp' | 'image/jpeg', fillWhite: boolean) =>
    options?.encode
      ? options.encode({ mimeType, quality, width: target.width, height: target.height, fillWhite })
      : encodeImageOnCanvas(input.image, target.width, target.height, mimeType, quality, fillWhite);

  const webpCandidate = await runEncode('image/webp', false);
  const validWebp =
    webpCandidate && webpCandidate.size > 0 && webpCandidate.type === 'image/webp'
      ? webpCandidate
      : null;

  if (validWebp) {
    return selectBestCompressedBlob(original, [validWebp]);
  }

  // Safari and older WebViews silently return image/png when image/webp is unsupported;
  // fall back to JPEG with a white matte for transparent PNGs.
  const jpegCandidate = await runEncode('image/jpeg', true);
  const validJpeg =
    jpegCandidate && jpegCandidate.size > 0 && jpegCandidate.type === 'image/jpeg'
      ? jpegCandidate
      : jpegCandidate && jpegCandidate.size > 0
        ? jpegCandidate
        : null;

  return selectBestCompressedBlob(original, [validJpeg]);
}
