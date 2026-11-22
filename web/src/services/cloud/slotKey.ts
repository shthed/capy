import { SafeLocalStore } from '../storage/SafeLocalStore';
import { CLOUD_TOMBSTONES_STORAGE_KEY, resolveScopedStorageKey } from '../storage/StorageKeys';
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

export function recordLocalSlotTombstone(
  slotKey: string,
  deletedAt: number = Date.now(),
  accountScope?: string | null
): void {
  const cleanSlot = slotKey.trim();
  if (!cleanSlot) return;
  const ts = Number.isFinite(deletedAt) && deletedAt > 0 ? Math.floor(deletedAt) : Date.now();
  const existing = readLocalSlotTombstones(accountScope);
  existing[cleanSlot] = Math.max(existing[cleanSlot] ?? 0, ts);
  writeLocalSlotTombstones(existing, accountScope);
}

export function clearLocalSlotTombstones(accountScope?: string | null): void {
  if (accountScope) {
    SafeLocalStore.removeItem(resolveAccountScopedKey(CLOUD_TOMBSTONES_STORAGE_KEY, accountScope));
  }
  SafeLocalStore.removeScopedItem(CLOUD_TOMBSTONES_STORAGE_KEY);
}
