import { ReleaseChannel, resolveReleaseChannel } from '../version';

export interface StorageNamespaceInfo {
  channel: ReleaseChannel;
  isSandboxed: boolean;
  sandboxSuffix: string;
  dbName: string;
}

/**
 * Resolves channel-scoped storage isolation so Alpha PR previews (`/capy/alpha/<num>/`)
 * and Beta channel previews (`/capy/beta/`) never mutate or corrupt Production saves,
 * settings, stats, OAuth tokens, or IndexedDB puzzle blobs on shared `github.io` origins.
 *
 * Pass `?capy_sandbox=0` to opt out (share Production storage) or `?capy_sandbox=1` to force isolation.
 */
export function resolveStorageNamespace(
  pathname?: string,
  origin?: string,
  search?: string
): StorageNamespaceInfo {
  const effectiveSearch =
    search !== undefined
      ? search
      : typeof window !== 'undefined'
        ? (window.location?.search ?? '')
        : '';
  const channelInfo = resolveReleaseChannel(pathname, origin, effectiveSearch);

  let sandboxOverride: boolean | null = null;
  if (effectiveSearch) {
    const params = new URLSearchParams(
      effectiveSearch.startsWith('?') ? effectiveSearch : `?${effectiveSearch}`
    );
    const rawSandbox = (params.get('capy_sandbox') || '').trim().toLowerCase();
    if (rawSandbox === '0' || rawSandbox === 'false') {
      sandboxOverride = false;
    } else if (rawSandbox === '1' || rawSandbox === 'true') {
      sandboxOverride = true;
    }
  }

  const isSandboxed =
    sandboxOverride !== null
      ? sandboxOverride
      : channelInfo.channel === 'alpha' || channelInfo.channel === 'beta';

  const sandboxSuffix = isSandboxed ? `__sandbox_${channelInfo.channel}` : '';
  const dbName = isSandboxed
    ? `capy_game_storage_v8_${channelInfo.channel}`
    : 'capy_game_storage_v8';

  return {
    channel: channelInfo.channel,
    isSandboxed,
    sandboxSuffix,
    dbName,
  };
}

export function resolveScopedStorageKey(
  baseKey: string,
  pathname?: string,
  origin?: string,
  search?: string
): string {
  const ns = resolveStorageNamespace(pathname, origin, search);
  return ns.isSandboxed ? `${baseKey}${ns.sandboxSuffix}` : baseKey;
}

export function resolveScopedBackupKey(
  baseKey: string,
  pathname?: string,
  origin?: string,
  search?: string
): string {
  return resolveScopedStorageKey(baseKey, pathname, origin, search);
}

export function resolveScopedDbName(
  pathname?: string,
  origin?: string,
  search?: string
): string {
  return resolveStorageNamespace(pathname, origin, search).dbName;
}
