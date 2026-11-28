import { SafeLocalStore } from '../storage/SafeLocalStore';
import {
  CLOUD_MANIFEST_STORAGE_KEY,
  CLOUD_TOMBSTONES_STORAGE_KEY,
  IDENTITY_STORAGE_KEY,
  resolveScopedStorageKey,
} from '../storage/StorageKeys';
import { reportSwallowed } from '../telemetry';

export const CLOUD_TOMBSTONE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const CLOUD_TOMBSTONE_MAX_ENTRIES = 500;

export function computeSlotKeyForSnapshot(snap: {
  id: string;
  sampleAssetPath?: string | null;
  sourceRef?: { kind: string; uri: string };
}): string {
  const sampleUri =
    snap.sampleAssetPath ||
    (snap.sourceRef?.kind === 'sample' || snap.sourceRef?.kind === 'catalog'
      ? snap.sourceRef.uri
      : undefined);
  if (sampleUri) {
    return `sample_${sampleUri.replace(/^\.\//, '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  }
  return `save_${snap.id}`;
}

export function sanitizeTombstoneMap(
  raw: unknown,
  now: number = Date.now()
): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const minTs = now - CLOUD_TOMBSTONE_MAX_AGE_MS;
  const entries: Array<[string, number]> = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const cleanKey = key.trim();
    if (
      !cleanKey ||
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value <= 0 ||
      value < minTs
    ) {
      continue;
    }
    entries.push([cleanKey, Math.floor(value)]);
  }
  entries.sort((a, b) => b[1] - a[1]);
  const out: Record<string, number> = {};
  for (const [k, v] of entries.slice(0, CLOUD_TOMBSTONE_MAX_ENTRIES)) {
    out[k] = v;
  }
  return out;
}

export function mergeTombstoneMaps(
  ...maps: Array<Record<string, number> | undefined | null>
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const map of maps) {
    if (!map || typeof map !== 'object') continue;
    for (const [k, v] of Object.entries(map)) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
      const existing = merged[k] ?? 0;
      if (v > existing) {
        merged[k] = Math.floor(v);
      }
    }
  }
  return sanitizeTombstoneMap(merged);
}

export function resolveAccountScopedKey(baseKey: string, accountScope?: string | null): string {
  const scopedBase = resolveScopedStorageKey(baseKey);
  if (!accountScope) return scopedBase;
  const cleanScope = accountScope.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  if (!cleanScope) return scopedBase;
  return `${scopedBase}__acct_${cleanScope}`;
}

export function readLocalSlotTombstones(accountScope?: string | null): Record<string, number> {
  const result: Record<string, number> = {};
  const keys = accountScope
    ? [
        resolveAccountScopedKey(CLOUD_TOMBSTONES_STORAGE_KEY, accountScope),
        resolveScopedStorageKey(CLOUD_TOMBSTONES_STORAGE_KEY),
      ]
    : [resolveScopedStorageKey(CLOUD_TOMBSTONES_STORAGE_KEY)];
  for (const key of keys) {
    try {
      const raw = SafeLocalStore.getItem(key);
      if (!raw) continue;
      const parsed = sanitizeTombstoneMap(JSON.parse(raw));
      for (const [slotKey, ts] of Object.entries(parsed)) {
        if (ts > (result[slotKey] ?? 0)) {
          result[slotKey] = ts;
        }
      }
    } catch (err) {
      reportSwallowed('slotKey.readLocalSlotTombstones', err, { key });
    }
  }
  return result;
}

export function writeLocalSlotTombstones(
  tombstones: Record<string, number>,
  accountScope?: string | null
): void {
  const pruned = sanitizeTombstoneMap(tombstones);
  const key = resolveAccountScopedKey(CLOUD_TOMBSTONES_STORAGE_KEY, accountScope);
  const baseKey = resolveScopedStorageKey(CLOUD_TOMBSTONES_STORAGE_KEY);
  try {
    if (Object.keys(pruned).length === 0) {
      SafeLocalStore.removeItem(key);
    } else {
      SafeLocalStore.setItem(key, JSON.stringify(pruned));
    }
    if (accountScope && key !== baseKey) {
      SafeLocalStore.removeItem(baseKey);
    }
  } catch (err) {
    reportSwallowed('slotKey.writeLocalSlotTombstones', err, { key });
  }
}

const KNOWN_AUTH_PROVIDER_IDS = [
  'play_games_v2',
  'microsoft',
  'google',
  'steam',
  'apple',
  'oidc',
] as const;

const AUTH_PLAYER_ID_PREFIX_RE =
  /^(?:google_|ms_|microsoft_|pgs_|play_games_v2_|apple_|steam_|oidc_)/i;

interface PersistedIdentityInfo {
  isAuthenticated: boolean;
  provider: string;
  basePlayerId: string;
  scope: string | null;
}

interface ParsedManifestV2 {
  version: 2;
  devicePlayerId?: unknown;
  providerId?: unknown;
  entries: Record<string, { lastOpened?: unknown; createdAt?: unknown }>;
}

function readPersistedIdentity(): PersistedIdentityInfo | null {
  try {
    const raw = SafeLocalStore.getScopedItem(IDENTITY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      isAuthenticated?: unknown;
      provider?: unknown;
      playerId?: unknown;
    };
    if (!parsed || typeof parsed.playerId !== 'string') {
      return null;
    }
    const basePlayerId = parsed.playerId.split(':')[0].trim();
    if (!basePlayerId) return null;
    const provider = typeof parsed.provider === 'string' ? parsed.provider.trim() : '';
    const isAuthenticated =
      parsed.isAuthenticated === true && Boolean(provider) && provider !== 'guest';
    return {
      isAuthenticated,
      provider: provider || 'guest',
      basePlayerId,
      scope: isAuthenticated ? `${provider}_${basePlayerId}` : null,
    };
  } catch (err) {
    reportSwallowed('slotKey.readPersistedIdentity', err);
    return null;
  }
}

function resolveEffectiveAccountScope(
  accountScope: string | null | undefined,
  persistedIdentity: PersistedIdentityInfo | null
): string | null {
  if (accountScope === null) {
    return null;
  }
  if (typeof accountScope === 'string') {
    const trimmed = accountScope.trim();
    return trimmed || null;
  }
  return persistedIdentity?.scope ?? null;
}

function parseAccountScope(
  accountScope: string
): { providerId: string; basePlayerId: string } | null {
  const trimmed = accountScope.trim();
  if (!trimmed) return null;
  for (const providerId of KNOWN_AUTH_PROVIDER_IDS) {
    const prefix = `${providerId}_`;
    if (trimmed.startsWith(prefix)) {
      const basePlayerId = trimmed.slice(prefix.length).split(':')[0].trim();
      return basePlayerId ? { providerId, basePlayerId } : null;
    }
  }
  const firstUnderscore = trimmed.indexOf('_');
  if (firstUnderscore > 0 && firstUnderscore < trimmed.length - 1) {
    const providerId = trimmed.slice(0, firstUnderscore).trim();
    const basePlayerId = trimmed.slice(firstUnderscore + 1).split(':')[0].trim();
    if (providerId && basePlayerId) {
      return { providerId, basePlayerId };
    }
  }
  return null;
}

function readPositiveFiniteTs(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function parseCachedManifestV2(raw: string): ParsedManifestV2 | null {
  const parsed = JSON.parse(raw) as {
    version?: unknown;
    devicePlayerId?: unknown;
    providerId?: unknown;
    entries?: unknown;
  };
  if (
    !parsed ||
    parsed.version !== 2 ||
    !parsed.entries ||
    typeof parsed.entries !== 'object' ||
    Array.isArray(parsed.entries)
  ) {
    return null;
  }
  return parsed as ParsedManifestV2;
}

function extractEntryFloorFromManifest(manifest: ParsedManifestV2, slotKey: string): number {
  if (!Object.prototype.hasOwnProperty.call(manifest.entries, slotKey)) {
    return 0;
  }
  const entry = manifest.entries[slotKey];
  if (!entry || typeof entry !== 'object') return 0;
  const maxTs = Math.max(
    readPositiveFiniteTs(entry.lastOpened),
    readPositiveFiniteTs(entry.createdAt)
  );
  return maxTs > 0 ? Math.ceil(maxTs) : 0;
}

function baseManifestMatchesAccount(
  manifest: ParsedManifestV2,
  expectedProviderId: string,
  expectedBasePlayerId: string
): boolean {
  const manifestBasePlayerId =
    typeof manifest.devicePlayerId === 'string'
      ? manifest.devicePlayerId.split(':')[0].trim()
      : '';
  if (!manifestBasePlayerId || manifestBasePlayerId !== expectedBasePlayerId) {
    return false;
  }
  if (manifest.providerId !== undefined) {
    if (typeof manifest.providerId !== 'string') {
      return false;
    }
    const manifestProviderId = manifest.providerId.trim();
    if (manifestProviderId && manifestProviderId !== expectedProviderId) {
      return false;
    }
  }
  return true;
}

function baseManifestMatchesGuest(
  manifest: ParsedManifestV2,
  persistedIdentity: PersistedIdentityInfo | null
): boolean {
  if (manifest.providerId !== undefined) {
    if (typeof manifest.providerId !== 'string') {
      return false;
    }
    const manifestProviderId = manifest.providerId.trim();
    if (manifestProviderId && manifestProviderId !== 'guest') {
      return false;
    }
  }
  const manifestBasePlayerId =
    typeof manifest.devicePlayerId === 'string'
      ? manifest.devicePlayerId.split(':')[0].trim()
      : '';
  if (AUTH_PLAYER_ID_PREFIX_RE.test(manifestBasePlayerId)) {
    return false;
  }
  const guestBasePlayerId =
    persistedIdentity && !persistedIdentity.isAuthenticated
      ? persistedIdentity.basePlayerId
      : null;
  if (guestBasePlayerId) {
    return Boolean(manifestBasePlayerId) && manifestBasePlayerId === guestBasePlayerId;
  }
  if (
    persistedIdentity?.isAuthenticated &&
    manifestBasePlayerId &&
    manifestBasePlayerId === persistedIdentity.basePlayerId
  ) {
    return false;
  }
  return true;
}

function readCachedManifestSlotFloor(
  slotKey: string,
  effectiveScope: string | null,
  persistedIdentity: PersistedIdentityInfo | null
): number {
  const baseKey = resolveScopedStorageKey(CLOUD_MANIFEST_STORAGE_KEY);

  if (effectiveScope) {
    const scopedKey = resolveAccountScopedKey(CLOUD_MANIFEST_STORAGE_KEY, effectiveScope);
    if (scopedKey !== baseKey) {
      try {
        const rawScoped = SafeLocalStore.getItem(scopedKey);
        if (rawScoped) {
          const parsedScoped = parseCachedManifestV2(rawScoped);
          if (parsedScoped) {
            return extractEntryFloorFromManifest(parsedScoped, slotKey);
          }
        }
      } catch (err) {
        reportSwallowed('slotKey.readCachedManifestSlotFloor', err, { key: scopedKey });
      }
    }

    const expected = parseAccountScope(effectiveScope);
    if (!expected) return 0;

    try {
      const rawBase = SafeLocalStore.getItem(baseKey);
      if (!rawBase) return 0;
      const parsedBase = parseCachedManifestV2(rawBase);
      if (
        !parsedBase ||
        !baseManifestMatchesAccount(parsedBase, expected.providerId, expected.basePlayerId)
      ) {
        return 0;
      }
      return extractEntryFloorFromManifest(parsedBase, slotKey);
    } catch (err) {
      reportSwallowed('slotKey.readCachedManifestSlotFloor', err, { key: baseKey });
      return 0;
    }
  }

  try {
    const rawBase = SafeLocalStore.getItem(baseKey);
    if (!rawBase) return 0;
    const parsedBase = parseCachedManifestV2(rawBase);
    if (!parsedBase || !baseManifestMatchesGuest(parsedBase, persistedIdentity)) {
      return 0;
    }
    return extractEntryFloorFromManifest(parsedBase, slotKey);
  } catch (err) {
    reportSwallowed('slotKey.readCachedManifestSlotFloor', err, { key: baseKey });
    return 0;
  }
}

export function recordLocalSlotTombstone(
  slotKey: string,
  deletedAt: number = Date.now(),
  accountScope?: string | null
): void {
  const cleanSlot = slotKey.trim();
  if (!cleanSlot) return;
  const persistedIdentity = readPersistedIdentity();
  const effectiveScope = resolveEffectiveAccountScope(accountScope, persistedIdentity);
  const ts = Number.isFinite(deletedAt) && deletedAt > 0 ? Math.floor(deletedAt) : Date.now();
  const manifestFloor = readCachedManifestSlotFloor(cleanSlot, effectiveScope, persistedIdentity);
  const effectiveTs = Math.max(ts, manifestFloor);
  const existing = readLocalSlotTombstones(effectiveScope);
  existing[cleanSlot] = Math.max(existing[cleanSlot] ?? 0, effectiveTs);
  writeLocalSlotTombstones(existing, effectiveScope);
}

export function clearLocalSlotTombstones(accountScope?: string | null): void {
  if (accountScope) {
    SafeLocalStore.removeItem(resolveAccountScopedKey(CLOUD_TOMBSTONES_STORAGE_KEY, accountScope));
  }
  SafeLocalStore.removeScopedItem(CLOUD_TOMBSTONES_STORAGE_KEY);
}
