/**
 * Shared opt-in debug environment gate across StorageService, GoogleCloudSyncClient, telemetry, and error boundaries.
 */

export const DEV_DEBUG_STORAGE_KEY = 'capy_dev_debug';

export function isDebugEnvironmentEnabled(
  search?: string,
  storageValue?: string | null,
  isDevOverride?: boolean
): boolean {
  const isDev =
    isDevOverride !== undefined
      ? isDevOverride
      : Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  if (isDev) return true;

  const effectiveSearch =
    search !== undefined
      ? search
      : typeof window !== 'undefined'
        ? (window.location?.search ?? '')
        : '';
  if (effectiveSearch) {
    const params = new URLSearchParams(
      effectiveSearch.startsWith('?') ? effectiveSearch : `?${effectiveSearch}`
    );
    const rawDebug = (params.get('capy_debug') || '').trim().toLowerCase();
    if (rawDebug === '0' || rawDebug === 'false') {
      return false;
    }
    if (rawDebug === '1' || rawDebug === 'true') {
      return true;
    }
  }

  let stored = storageValue;
  if (stored === undefined && typeof window !== 'undefined') {
    try {
      stored = window.localStorage?.getItem(DEV_DEBUG_STORAGE_KEY) ?? null;
    } catch {
      stored = null;
    }
  }
  return stored === '1' || stored === 'true';
}
