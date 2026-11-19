import { SavedSnapshot } from '../types';
import { isAllowedSampleAssetPath, isSafeSnapshotPreviewDataUrl } from '../services/CapyCodec';

export interface SnapshotThumbnailResolution {
  safeSampleThumb?: string;
  safePreviewThumb?: string;
  primaryThumb?: string;
  fallbackThumb?: string;
  thumbSrc?: string;
}

export function resolveSafeSampleAssetPath(
  snap?: Pick<SavedSnapshot, 'sampleAssetPath' | 'sourceRef'> | null,
  preferSourceRef = false
): string | undefined {
  if (!snap) return undefined;
  const sourceUri =
    snap.sourceRef &&
    (snap.sourceRef.kind === 'sample' || snap.sourceRef.kind === 'catalog') &&
    isAllowedSampleAssetPath(snap.sourceRef.uri)
      ? snap.sourceRef.uri.trim()
      : undefined;
  const directSample = isAllowedSampleAssetPath(snap.sampleAssetPath)
    ? snap.sampleAssetPath.trim()
    : undefined;
  return preferSourceRef ? sourceUri || directSample : directSample || sourceUri;
}

export function resolveSafeSnapshotPreviewUrl(
  snap?: Pick<SavedSnapshot, 'previewDataUrl'> | null
): string | undefined {
  if (!snap) return undefined;
  return isSafeSnapshotPreviewDataUrl(snap.previewDataUrl) ? snap.previewDataUrl.trim() : undefined;
}

export function resolveSafeSnapshotThumbnail(
  snap?: Pick<SavedSnapshot, 'sampleAssetPath' | 'sourceRef' | 'previewDataUrl'> | null,
  failedThumbSrcs?: Record<string, boolean>
): SnapshotThumbnailResolution {
  const safeSampleThumb = resolveSafeSampleAssetPath(snap);
  const safePreviewThumb = resolveSafeSnapshotPreviewUrl(snap);
  const primaryThumb = safeSampleThumb || safePreviewThumb;
  const fallbackThumb =
    primaryThumb &&
    failedThumbSrcs?.[primaryThumb] &&
    safePreviewThumb &&
    safePreviewThumb !== primaryThumb
      ? safePreviewThumb
      : undefined;
  const thumbSrc =
    primaryThumb && !failedThumbSrcs?.[primaryThumb]
      ? primaryThumb
      : fallbackThumb && !failedThumbSrcs?.[fallbackThumb]
        ? fallbackThumb
        : undefined;

  return {
    safeSampleThumb,
    safePreviewThumb,
    primaryThumb,
    fallbackThumb,
    thumbSrc,
  };
}
