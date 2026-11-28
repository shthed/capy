import { SAMPLE_GALLERY, SavedSnapshot } from '../../types';
import {
  decodeProgressDeltaToken,
  encodeProgressDeltaToken,
  isAllowedSampleAssetPath,
  mergeProgressDeltas,
  ProgressDeltaV2,
} from '../CapyCodec';
import { NativeBridge } from '../NativeBridge';
import { StorageService } from '../StorageService';
import { SafeLocalStore } from '../storage/SafeLocalStore';
import {
  CLOUD_MANIFEST_STORAGE_KEY,
  CLOUD_VAULT_STORAGE_KEY,
  resolveScopedStorageKey,
} from '../storage/StorageKeys';
import { reportSwallowed } from '../telemetry';
import { base64ToUint8, uint8ToBase64 } from '../../utils/base64';
import { MultiProviderAuthManager } from '../auth/AuthManager';
import {
  CloudBackendKind,
  CloudLibraryManifestV2,
  CloudLibrarySyncSummary,
  CloudProviderDriver,
  CloudProviderId,
  CloudSaveEntryV2,
  CloudSaveEnvelope,
  CloudSaveProvider,
  CloudSyncResult,
  PlayerIdentity,
} from '../providers/types';
import {
  clearLocalSlotTombstones,
  computeSlotKeyForSnapshot,
  mergeTombstoneMaps,
  readLocalSlotTombstones,
  recordLocalSlotTombstone,
  resolveAccountScopedKey,
  sanitizeTombstoneMap,
  writeLocalSlotTombstones,
} from './slotKey';

export function mapProviderToBackendKind(providerId?: CloudProviderId): CloudBackendKind {
  switch (providerId) {
    case 'google':
      return 'google_drive_appdata';
    case 'play_games_v2':
      return 'play_games_snapshots';
    case 'steam':
      return 'steam_remote_storage';
    case 'microsoft':
      return 'microsoft_onedrive_approot';
    case 'apple':
      return 'apple_cloudkit';
    default:
      return 'local_cache';
  }
}

export const TOMBSTONE_SKEW_TOLERANCE_MS = 10 * 60 * 1000;

export function isSlotTombstonedForTimestamp(
  slotKey: string,
  itemTimestamp: number,
  tombstones: Record<string, number>,
  toleranceMs: number = TOMBSTONE_SKEW_TOLERANCE_MS
): boolean {
  if (
    !tombstones ||
    typeof tombstones !== 'object' ||
    !Object.prototype.hasOwnProperty.call(tombstones, slotKey)
  ) {
    return false;
  }
  const deletedAt = tombstones[slotKey];
  if (
    typeof deletedAt !== 'number' ||
    !Number.isFinite(deletedAt) ||
    deletedAt <= 0 ||
    typeof itemTimestamp !== 'number' ||
    !Number.isFinite(itemTimestamp)
  ) {
    return false;
  }
  const safeTolerance =
    typeof toleranceMs === 'number' && Number.isFinite(toleranceMs) && toleranceMs >= 0
      ? toleranceMs
      : TOMBSTONE_SKEW_TOLERANCE_MS;
  return deletedAt - safeTolerance >= itemTimestamp;
}

export function computeSnapshotContentFingerprint(snap: SavedSnapshot): string {
  const sortedFilled = [...(snap.filledRegionIds || [])].sort((a, b) => a - b).join(',');
  const sortedColors = snap.paintedRegionColors
    ? Object.entries(snap.paintedRegionColors)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([k, v]) => `${k}:${v}`)
        .join(',')
    : '';
  return [
    snap.id,
    String(snap.resetEpoch ?? 0),
    snap.title || '',
    snap.isPinned ? '1' : '0',
    snap.isFreeColor ? '1' : '0',
    String(snap.totalCount || 0),
    sortedFilled,
    sortedColors,
  ].join('|');
}

function serializeTombstonesKey(tombstones: Record<string, number>): string {
  return JSON.stringify(
    Object.entries(tombstones)
      .filter(([, ts]) => typeof ts === 'number' && Number.isFinite(ts) && ts > 0)
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

interface SnapshotSyncContext {
  initialLocalIds: Set<string>;
  initialLocalSlots: Set<string>;
  seenLocalSlots: Set<string>;
  minLastOpenedBySlot: Map<string, number>;
  skewTelemetryEmittedSlots: Set<string>;
  clearedTombstoneAt: Map<string, number>;
  getAuthoritativeSnapshots: () => SavedSnapshot[];
  buildSlotMap: (snaps: SavedSnapshot[]) => Map<string, SavedSnapshot>;
  findLocalSnap: (
    snaps: SavedSnapshot[],
    bySlot: Map<string, SavedSnapshot>,
    slotKey: string,
    snapshotId: string
  ) => SavedSnapshot | undefined;
  wasDeletedMidSync: (
    localSnap: SavedSnapshot | undefined,
    slotKey: string,
    snapshotId: string
  ) => boolean;
}

export class CloudLibrarySyncOrchestrator implements CloudSaveProvider {
  constructor(private readonly auth: MultiProviderAuthManager) {}

  get providerName(): string {
    const activeDriver = this.auth.getActiveCloudDriver();
    if (activeDriver) {
      return activeDriver.getDescriptor().storageName;
    }
    return NativeBridge.isAndroid ? 'Google Play Games Cloud' : 'Capy Cloud Vault';
  }

  private getAccountScope(identity: PlayerIdentity = this.auth.getCurrentIdentity()): string | null {
    if (!identity.isAuthenticated || identity.provider === 'guest') {
      return null;
    }
    const baseId = identity.playerId.split(':')[0].trim();
    if (!baseId) return null;
    return `${identity.provider}_${baseId}`;
  }

  private isScopeInvalidated(initialScope: string | null): boolean {
    return Boolean(initialScope && this.getAccountScope() !== initialScope);
  }

  private getVaultStorageKey(identity?: PlayerIdentity): string {
    return resolveAccountScopedKey(CLOUD_VAULT_STORAGE_KEY, this.getAccountScope(identity));
  }

  private getManifestStorageKey(identity?: PlayerIdentity): string {
    return resolveAccountScopedKey(CLOUD_MANIFEST_STORAGE_KEY, this.getAccountScope(identity));
  }

  clearLocalCloudCache(previousIdentity?: PlayerIdentity): void {
    const scopes = new Set<string | null>([null, this.getAccountScope()]);
    if (previousIdentity) {
      scopes.add(this.getAccountScope(previousIdentity));
    }
    for (const scope of scopes) {
      SafeLocalStore.removeItem(resolveAccountScopedKey(CLOUD_VAULT_STORAGE_KEY, scope));
      SafeLocalStore.removeItem(resolveAccountScopedKey(CLOUD_MANIFEST_STORAGE_KEY, scope));
      clearLocalSlotTombstones(scope);
    }
    SafeLocalStore.removeScopedItem(CLOUD_VAULT_STORAGE_KEY);
    SafeLocalStore.removeScopedItem(CLOUD_MANIFEST_STORAGE_KEY);
  }

  recordSlotDeletion(slotKey: string, deletedAt: number = Date.now()): void {
    const cleanSlot = slotKey.trim();
    if (!cleanSlot) return;
    const scope = this.getAccountScope();
    const manifest = this.readLocalManifest();
    const manifestEntry =
      manifest?.entries && Object.prototype.hasOwnProperty.call(manifest.entries, cleanSlot)
        ? manifest.entries[cleanSlot]
        : undefined;
    const knownEntryTs = manifestEntry ? this.resolveEntryTimestamp(manifestEntry) : 0;
    const safeDeletedAt =
      typeof deletedAt === 'number' && Number.isFinite(deletedAt) && deletedAt > 0
        ? deletedAt
        : Date.now();
    const effectiveDeletedAt = Math.max(safeDeletedAt, Math.ceil(knownEntryTs));
    recordLocalSlotTombstone(cleanSlot, effectiveDeletedAt, scope);

    const vault = this.readLocalVault();
    if (Object.prototype.hasOwnProperty.call(vault, cleanSlot)) {
      delete vault[cleanSlot];
      this.writeLocalVault(vault);
    }

    if (manifest) {
      let changed = false;
      if (Object.prototype.hasOwnProperty.call(manifest.entries, cleanSlot)) {
        delete manifest.entries[cleanSlot];
        changed = true;
      }
      const nextTombstones = mergeTombstoneMaps(manifest.tombstones, {
        [cleanSlot]: effectiveDeletedAt,
      });
      if (changed || nextTombstones[cleanSlot] !== manifest.tombstones?.[cleanSlot]) {
        this.writeLocalManifest({
          ...manifest,
          updatedAt: Math.max(manifest.updatedAt || 0, effectiveDeletedAt),
          tombstones: nextTombstones,
        });
      }
    }
  }

  private readLocalVault(): Record<string, CloudSaveEnvelope> {
    const scopeKey = this.getVaultStorageKey();
    const baseKey = resolveScopedStorageKey(CLOUD_VAULT_STORAGE_KEY);
    const identity = this.auth.getCurrentIdentity();
    const tryKeys = scopeKey === baseKey ? [baseKey] : [scopeKey, baseKey];
    for (const key of tryKeys) {
      try {
        const raw = SafeLocalStore.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as Record<string, CloudSaveEnvelope>;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
        if (key === baseKey && identity.isAuthenticated) {
          const filtered: Record<string, CloudSaveEnvelope> = {};
          const activeBaseId = identity.playerId.split(':')[0];
          for (const [k, env] of Object.entries(parsed)) {
            if (
              !env?.devicePlayerId ||
              env.devicePlayerId.split(':')[0] === activeBaseId
            ) {
              filtered[k] = env;
            }
          }
          return filtered;
        }
        return parsed;
      } catch (err) {
        reportSwallowed('CloudLibrarySyncOrchestrator.readLocalVault', err, { key });
      }
    }
    return {};
  }

  private writeLocalVault(vault: Record<string, CloudSaveEnvelope>): void {
    const key = this.getVaultStorageKey();
    try {
      SafeLocalStore.setItem(key, JSON.stringify(vault));
    } catch (err) {
      reportSwallowed('CloudLibrarySyncOrchestrator.writeLocalVault', err, { key });
    }
  }

  private readLocalManifest(): CloudLibraryManifestV2 | null {
    const scopeKey = this.getManifestStorageKey();
    const baseKey = resolveScopedStorageKey(CLOUD_MANIFEST_STORAGE_KEY);
    const identity = this.auth.getCurrentIdentity();
    const tryKeys = scopeKey === baseKey ? [baseKey] : [scopeKey, baseKey];
    for (const key of tryKeys) {
      try {
        const raw = SafeLocalStore.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as CloudLibraryManifestV2;
        if (!parsed || parsed.version !== 2 || !parsed.entries) continue;
        if (
          identity.isAuthenticated &&
          parsed.devicePlayerId &&
          parsed.devicePlayerId.split(':')[0] !== identity.playerId.split(':')[0]
        ) {
          continue;
        }
        return parsed;
      } catch (err) {
        reportSwallowed('CloudLibrarySyncOrchestrator.readLocalManifest', err, { key });
      }
    }
    return null;
  }

  private writeLocalManifest(manifest: CloudLibraryManifestV2): void {
    const key = this.getManifestStorageKey();
    try {
      SafeLocalStore.setItem(key, JSON.stringify(manifest));
    } catch (err) {
      reportSwallowed('CloudLibrarySyncOrchestrator.writeLocalManifest', err, { key });
    }
  }

  private readLocalTombstones(): Record<string, number> {
    return readLocalSlotTombstones(this.getAccountScope());
  }

  private writeLocalTombstones(tombstones: Record<string, number>): void {
    writeLocalSlotTombstones(tombstones, this.getAccountScope());
  }

  async pullEnvelope(slotKey: string): Promise<CloudSaveEnvelope | null> {
    const activeDriver = this.auth.getActiveCloudDriver();
    if (activeDriver) {
      try {
        const remoteEnv = await activeDriver.readSlotEnvelope(slotKey);
        if (remoteEnv && remoteEnv.deltaToken) {
          return remoteEnv;
        }
      } catch (err) {
        reportSwallowed('CloudLibrarySyncOrchestrator.pullEnvelopeDriver', err, {
          provider: activeDriver.id,
          slotKey,
        });
      }
    }

    const nativeRaw = NativeBridge.loadCloudSnapshot(slotKey);
    if (nativeRaw) {
      try {
        return JSON.parse(nativeRaw) as CloudSaveEnvelope;
      } catch (err) {
        reportSwallowed('CloudLibrarySyncOrchestrator.pullEnvelopeNativeParse', err, { slotKey });
      }
    }
    const vault = this.readLocalVault();
    return vault[slotKey] || null;
  }

  async pushEnvelope(envelope: CloudSaveEnvelope): Promise<boolean> {
    const serialized = JSON.stringify(envelope);
    const nativeSaved = NativeBridge.saveCloudSnapshot(envelope.slotKey, serialized);
    const vault = this.readLocalVault();
    vault[envelope.slotKey] = envelope;
    this.writeLocalVault(vault);

    const activeDriver = this.auth.getActiveCloudDriver();
    if (activeDriver) {
      try {
        return Boolean(await activeDriver.writeSlotEnvelope(envelope));
      } catch (err) {
        reportSwallowed('CloudLibrarySyncOrchestrator.pushEnvelopeDriver', err, {
          provider: activeDriver.id,
          slotKey: envelope.slotKey,
        });
        return false;
      }
    }

    return Boolean(nativeSaved);
  }

  private async decodeEntryDelta(entry: CloudSaveEntryV2): Promise<ProgressDeltaV2 | null> {
    try {
      const decoded = await decodeProgressDeltaToken(entry.deltaToken);
      const validEntryResetEpoch =
        typeof entry.resetEpoch === 'number' && Number.isFinite(entry.resetEpoch)
          ? entry.resetEpoch
          : undefined;
      if (decoded.resetEpoch !== undefined || validEntryResetEpoch === undefined) {
        return decoded;
      }
      return { ...decoded, resetEpoch: validEntryResetEpoch };
    } catch (err) {
      reportSwallowed('CloudLibrarySyncOrchestrator.decodeManifestEntryDelta', err, {
        slotKey: entry.slotKey,
      });
      return null;
    }
  }

  private pickWinningManifestEntry(
    existing: CloudSaveEntryV2,
    incoming: CloudSaveEntryV2,
    existingEpoch: number,
    incomingEpoch: number
  ): { winner: CloudSaveEntryV2; other: CloudSaveEntryV2 } {
    const incomingWins =
      incomingEpoch !== existingEpoch
        ? incomingEpoch > existingEpoch
        : incoming.lastOpened >= existing.lastOpened;
    return incomingWins
      ? { winner: incoming, other: existing }
      : { winner: existing, other: incoming };
  }

  private async mergeManifestEntries(
    existing: CloudSaveEntryV2,
    incoming: CloudSaveEntryV2
  ): Promise<CloudSaveEntryV2> {
    const existingDelta = await this.decodeEntryDelta(existing);
    const incomingDelta = await this.decodeEntryDelta(incoming);

    if (!existingDelta && !incomingDelta) {
      return this.pickWinningManifestEntry(
        existing,
        incoming,
        existing.resetEpoch ?? 0,
        incoming.resetEpoch ?? 0
      ).winner;
    }
    if (!existingDelta) return incoming;
    if (!incomingDelta) return existing;

    const mergedDelta = mergeProgressDeltas(existingDelta, incomingDelta);
    const mergedToken = await encodeProgressDeltaToken(mergedDelta);
    const { winner, other } = this.pickWinningManifestEntry(
      existing,
      incoming,
      existingDelta.resetEpoch ?? existing.resetEpoch ?? 0,
      incomingDelta.resetEpoch ?? incoming.resetEpoch ?? 0
    );

    const cloudBinaryRef =
      winner.cloudBinaryRef ||
      winner.driveBinaryFileId ||
      other.cloudBinaryRef ||
      other.driveBinaryFileId;
    const inlineBinaryB64 = winner.inlineBinaryB64 || other.inlineBinaryB64;
    const mergedEpoch = mergedDelta.resetEpoch ?? 0;

    return {
      ...winner,
      createdAt: Math.min(
        existing.createdAt || incoming.createdAt,
        incoming.createdAt || existing.createdAt
      ),
      lastOpened: Math.max(existing.lastOpened, incoming.lastOpened),
      filledCount: mergedDelta.filledRegionIds.length,
      totalCount: Math.max(existing.totalCount || 0, incoming.totalCount || 0),
      ...(mergedEpoch > 0 ? { resetEpoch: mergedEpoch } : { resetEpoch: undefined }),
      deltaToken: mergedToken,
      ...(cloudBinaryRef ? { cloudBinaryRef, driveBinaryFileId: cloudBinaryRef } : {}),
      ...(inlineBinaryB64 ? { inlineBinaryB64 } : {}),
    };
  }

  private async mergeIncomingManifestInto(
    incoming: CloudLibraryManifestV2,
    mergedEntries: Record<string, CloudSaveEntryV2>,
    mergedTombstones: Record<string, number>
  ): Promise<number> {
    const incomingTombstones = sanitizeTombstoneMap(incoming.tombstones);
    for (const [k, ts] of Object.entries(incomingTombstones)) {
      if (ts > (mergedTombstones[k] ?? 0)) {
        mergedTombstones[k] = ts;
      }
    }
    if (!incoming.entries || typeof incoming.entries !== 'object') {
      return incoming.updatedAt || 0;
    }
    for (const [k, entry] of Object.entries(incoming.entries)) {
      if (
        !entry ||
        typeof entry !== 'object' ||
        typeof entry.deltaToken !== 'string' ||
        typeof entry.lastOpened !== 'number' ||
        !Number.isFinite(entry.lastOpened)
      ) {
        continue;
      }
      const existing = mergedEntries[k];
      mergedEntries[k] = existing ? await this.mergeManifestEntries(existing, entry) : entry;
    }
    return incoming.updatedAt || 0;
  }

  async pullRemoteLibraryManifest(): Promise<{
    manifest: CloudLibraryManifestV2 | null;
    backend: CloudBackendKind;
    tombstones: Record<string, number>;
  }> {
    const initialScope = this.getAccountScope();
    const mergedEntries: Record<string, CloudSaveEntryV2> = {};
    const mergedTombstones: Record<string, number> = this.readLocalTombstones();
    let backend: CloudBackendKind = 'local_cache';
    let latestUpdatedAt = 0;

    const localManifest = this.readLocalManifest();
    if (localManifest) {
      const ts = await this.mergeIncomingManifestInto(
        localManifest,
        mergedEntries,
        mergedTombstones
      );
      latestUpdatedAt = Math.max(latestUpdatedAt, ts);
    }

    const playGamesDriver = this.auth.getCloudDriver('play_games_v2');
    if (playGamesDriver && NativeBridge.isAndroid) {
      try {
        const nativeManifest = await playGamesDriver.readManifest();
        if (this.isScopeInvalidated(initialScope)) {
          return { manifest: null, backend, tombstones: {} };
        }
        if (nativeManifest) {
          backend = 'play_games_snapshots';
          const ts = await this.mergeIncomingManifestInto(
            nativeManifest,
            mergedEntries,
            mergedTombstones
          );
          latestUpdatedAt = Math.max(latestUpdatedAt, ts);
        }
      } catch (err) {
        reportSwallowed('CloudLibrarySyncOrchestrator.pullPlayGamesManifest', err);
        if (this.isScopeInvalidated(initialScope)) {
          return { manifest: null, backend, tombstones: {} };
        }
      }
    }

    const activeDriver = this.auth.getActiveCloudDriver();
    if (activeDriver) {
      try {
        const remoteManifest = await activeDriver.readManifest();
        if (this.isScopeInvalidated(initialScope)) {
          return { manifest: null, backend, tombstones: {} };
        }
        backend = mapProviderToBackendKind(activeDriver.id);
        if (remoteManifest) {
          const ts = await this.mergeIncomingManifestInto(
            remoteManifest,
            mergedEntries,
            mergedTombstones
          );
          latestUpdatedAt = Math.max(latestUpdatedAt, ts);
        }
      } catch (err) {
        reportSwallowed('CloudLibrarySyncOrchestrator.pullRemoteManifest', err, {
          provider: activeDriver.id,
        });
        if (this.isScopeInvalidated(initialScope)) {
          return { manifest: null, backend, tombstones: {} };
        }
      }
    }

    const cleanTombstones = sanitizeTombstoneMap(mergedTombstones);
    if (Object.keys(mergedEntries).length === 0 && Object.keys(cleanTombstones).length === 0) {
      return { manifest: null, backend, tombstones: cleanTombstones };
    }

    return {
      manifest: {
        version: 2,
        updatedAt: latestUpdatedAt || Date.now(),
        devicePlayerId: this.auth.getCurrentIdentity().playerId,
        providerId: activeDriver?.id,
        entries: mergedEntries,
        ...(Object.keys(cleanTombstones).length > 0 ? { tombstones: cleanTombstones } : {}),
      },
      backend,
      tombstones: cleanTombstones,
    };
  }

  async pushRemoteLibraryManifest(
    manifest?: CloudLibraryManifestV2
  ): Promise<{
    pushed: boolean;
    backend: CloudBackendKind;
  }> {
    const initialScope = this.getAccountScope();
    const resolvedManifest: CloudLibraryManifestV2 = manifest ??
      this.readLocalManifest() ?? {
        version: 2,
        updatedAt: Date.now(),
        devicePlayerId: this.auth.getCurrentIdentity().playerId,
        entries: {},
      };
    this.writeLocalManifest(resolvedManifest);

    let nativeSaved = false;
    const playGamesDriver = this.auth.getCloudDriver('play_games_v2');
    if (playGamesDriver && NativeBridge.isAndroid) {
      nativeSaved = await playGamesDriver.writeManifest(resolvedManifest).catch((err) => {
        reportSwallowed('CloudLibrarySyncOrchestrator.pushPlayGamesManifest', err);
        return false;
      });
      if (this.isScopeInvalidated(initialScope)) {
        return { pushed: false, backend: 'local_cache' };
      }
    }

    const activeDriver = this.auth.getActiveCloudDriver();
    if (activeDriver) {
      try {
        const ok = await activeDriver.writeManifest(resolvedManifest);
        if (this.isScopeInvalidated(initialScope)) {
          return { pushed: false, backend: 'local_cache' };
        }
        return {
          pushed: Boolean(ok),
          backend: mapProviderToBackendKind(activeDriver.id),
        };
      } catch (err) {
        reportSwallowed('CloudLibrarySyncOrchestrator.pushRemoteManifest', err, {
          provider: activeDriver.id,
        });
        if (this.isScopeInvalidated(initialScope)) {
          return { pushed: false, backend: 'local_cache' };
        }
        return {
          pushed: false,
          backend: mapProviderToBackendKind(activeDriver.id),
        };
      }
    }

    return {
      pushed: Boolean(nativeSaved),
      backend: nativeSaved ? 'play_games_snapshots' : 'local_cache',
    };
  }

  private createSnapshotSyncContext(localSnapshots: SavedSnapshot[]): SnapshotSyncContext {
    const initialLocalIds = new Set(localSnapshots.map((s) => s.id));
    const initialLocalSlots = new Set(localSnapshots.map((s) => computeSlotKeyForSnapshot(s)));
    let sawStoragePopulated = StorageService.loadSnapshots().length > 0;
    const getAuthoritativeSnapshots = (): SavedSnapshot[] => {
      const fresh = StorageService.loadSnapshots();
      if (fresh.length > 0) {
        sawStoragePopulated = true;
        return fresh;
      }
      if (sawStoragePopulated || localSnapshots.length === 0) {
        return fresh;
      }
      return [...localSnapshots];
    };
    const buildSlotMap = (snaps: SavedSnapshot[]) => {
      const map = new Map<string, SavedSnapshot>();
      for (const snap of snaps) {
        map.set(computeSlotKeyForSnapshot(snap), snap);
      }
      return map;
    };
    const findLocalSnap = (
      snaps: SavedSnapshot[],
      bySlot: Map<string, SavedSnapshot>,
      slotKey: string,
      snapshotId: string
    ): SavedSnapshot | undefined =>
      bySlot.get(slotKey) || snaps.find((s) => s.id === snapshotId);
    const wasDeletedMidSync = (
      localSnap: SavedSnapshot | undefined,
      slotKey: string,
      snapshotId: string
    ): boolean =>
      !localSnap && (initialLocalIds.has(snapshotId) || initialLocalSlots.has(slotKey));

    return {
      initialLocalIds,
      initialLocalSlots,
      seenLocalSlots: new Set(initialLocalSlots),
      minLastOpenedBySlot: new Map<string, number>(),
      skewTelemetryEmittedSlots: new Set<string>(),
      clearedTombstoneAt: new Map<string, number>(),
      getAuthoritativeSnapshots,
      buildSlotMap,
      findLocalSnap,
      wasDeletedMidSync,
    };
  }

  private isSlotTombstonedForTimestamp(
    slotKey: string,
    itemTimestamp: number,
    tombstones: Record<string, number>,
    toleranceMs: number = TOMBSTONE_SKEW_TOLERANCE_MS
  ): boolean {
    return isSlotTombstonedForTimestamp(slotKey, itemTimestamp, tombstones, toleranceMs);
  }

  private tryClearTombstoneForLocalSnapshot(
    slotKey: string,
    snapTs: number,
    tombstones: Record<string, number>,
    ctx: SnapshotSyncContext
  ): boolean {
    if (!Object.prototype.hasOwnProperty.call(tombstones, slotKey)) {
      return true;
    }
    const deletedAt = tombstones[slotKey];
    if (typeof deletedAt !== 'number' || !Number.isFinite(deletedAt) || deletedAt <= 0) {
      return true;
    }
    if (
      !Number.isFinite(snapTs) ||
      snapTs <= 0 ||
      this.isSlotTombstonedForTimestamp(slotKey, snapTs, tombstones)
    ) {
      return false;
    }
    if (snapTs <= deletedAt) {
      const lamportFloorMs = (Math.floor(deletedAt / 1000) + 1) * 1000;
      ctx.minLastOpenedBySlot.set(
        slotKey,
        Math.max(ctx.minLastOpenedBySlot.get(slotKey) ?? 0, lamportFloorMs)
      );
      if (!ctx.skewTelemetryEmittedSlots.has(slotKey)) {
        ctx.skewTelemetryEmittedSlots.add(slotKey);
        reportSwallowed(
          'CloudLibrarySyncOrchestrator.tombstoneSkewToleranceKeptSnapshot',
          'Preserved local snapshot within tombstone clock-skew tolerance',
          {
            slotKey,
            snapTs,
            deletedAt,
            skewMs: deletedAt - snapTs,
            toleranceMs: TOMBSTONE_SKEW_TOLERANCE_MS,
          }
        );
      }
    }
    ctx.clearedTombstoneAt.set(
      slotKey,
      Math.max(ctx.clearedTombstoneAt.get(slotKey) ?? 0, deletedAt)
    );
    delete tombstones[slotKey];
    return true;
  }

  private clearSupersededTombstoneForEntry(
    slotKey: string,
    entryTs: number,
    tombstones: Record<string, number>,
    ctx: SnapshotSyncContext
  ): void {
    if (!Object.prototype.hasOwnProperty.call(tombstones, slotKey)) {
      return;
    }
    const deletedAt = tombstones[slotKey];
    if (
      typeof deletedAt !== 'number' ||
      !Number.isFinite(deletedAt) ||
      deletedAt <= 0 ||
      !Number.isFinite(entryTs) ||
      entryTs <= deletedAt
    ) {
      return;
    }
    ctx.clearedTombstoneAt.set(
      slotKey,
      Math.max(ctx.clearedTombstoneAt.get(slotKey) ?? 0, deletedAt)
    );
    delete tombstones[slotKey];
  }

  private async reconcileTombstonesWithLocalSnapshots(
    tombstones: Record<string, number>,
    ctx: SnapshotSyncContext
  ): Promise<void> {
    const currentSnapshots = ctx.getAuthoritativeSnapshots();
    for (const snap of currentSnapshots) {
      const slotKey = computeSlotKeyForSnapshot(snap);
      if (!Object.prototype.hasOwnProperty.call(tombstones, slotKey)) continue;
      const deletedAt = tombstones[slotKey];
      if (typeof deletedAt !== 'number' || !Number.isFinite(deletedAt) || deletedAt <= 0) continue;
      const snapTs = this.resolveSnapshotTimestamp(snap);
      if (!this.tryClearTombstoneForLocalSnapshot(slotKey, snapTs, tombstones, ctx)) {
        await StorageService.deleteSnapshot(snap.id, { skipTombstone: true });
        ctx.seenLocalSlots.delete(slotKey);
        tombstones[slotKey] = deletedAt;
      }
    }
  }

  private async tryImportRemoteBinaryBlob(
    slotKey: string,
    remoteEntry: CloudSaveEntryV2,
    activeDriver: CloudProviderDriver | null,
    ctx: SnapshotSyncContext
  ): Promise<{ localSnap?: SavedSnapshot; importedCount: number; aborted: boolean }> {
    const remoteBlobRef = remoteEntry.cloudBinaryRef || remoteEntry.driveBinaryFileId;
    if (!remoteBlobRef || !activeDriver) {
      return { importedCount: 0, aborted: false };
    }
    try {
      const bin = await activeDriver.readBinaryBlob(remoteBlobRef);
      let currentSnapshots = ctx.getAuthoritativeSnapshots();
      let localBySlot = ctx.buildSlotMap(currentSnapshots);
      let localSnap = ctx.findLocalSnap(currentSnapshots, localBySlot, slotKey, remoteEntry.snapshotId);
      if (ctx.wasDeletedMidSync(localSnap, slotKey, remoteEntry.snapshotId)) {
        return { importedCount: 0, aborted: true };
      }
      if (localSnap || !bin || bin.byteLength === 0) {
        return { localSnap, importedCount: 0, aborted: false };
      }
      const imported = await StorageService.importSnapshotData(bin);
      currentSnapshots = ctx.getAuthoritativeSnapshots();
      localBySlot = ctx.buildSlotMap(currentSnapshots);
      localSnap = ctx.findLocalSnap(currentSnapshots, localBySlot, slotKey, remoteEntry.snapshotId);
      return { localSnap, importedCount: Math.max(0, imported.importedCount), aborted: false };
    } catch (err) {
      reportSwallowed('CloudLibrarySyncOrchestrator.downloadRemoteBinary', err, {
        provider: activeDriver.id,
        slotKey,
      });
      return { importedCount: 0, aborted: false };
    }
  }

  private async tryImportInlineBinary(
    slotKey: string,
    remoteEntry: CloudSaveEntryV2,
    ctx: SnapshotSyncContext
  ): Promise<{ localSnap?: SavedSnapshot; importedCount: number }> {
    if (
      typeof remoteEntry.inlineBinaryB64 !== 'string' ||
      remoteEntry.inlineBinaryB64.length === 0 ||
      remoteEntry.inlineBinaryB64.length > 260_000
    ) {
      return { importedCount: 0 };
    }
    try {
      const bin = base64ToUint8(remoteEntry.inlineBinaryB64);
      const imported = await StorageService.importSnapshotData(bin);
      const currentSnapshots = ctx.getAuthoritativeSnapshots();
      const localBySlot = ctx.buildSlotMap(currentSnapshots);
      const localSnap = ctx.findLocalSnap(
        currentSnapshots,
        localBySlot,
        slotKey,
        remoteEntry.snapshotId
      );
      return { localSnap, importedCount: Math.max(0, imported.importedCount) };
    } catch (err) {
      reportSwallowed('CloudLibrarySyncOrchestrator.importInlineBinary', err, { slotKey });
      return { importedCount: 0 };
    }
  }

  private async tryBootstrapSampleSnapshot(
    slotKey: string,
    remoteEntry: CloudSaveEntryV2,
    ctx: SnapshotSyncContext
  ): Promise<{ localSnap?: SavedSnapshot; importedCount: number; aborted: boolean }> {
    const rawSampleUri =
      typeof remoteEntry.sampleAssetPath === 'string' &&
      remoteEntry.sampleAssetPath.trim().length > 0
        ? remoteEntry.sampleAssetPath
        : remoteEntry.sourceRef?.kind === 'sample' && typeof remoteEntry.sourceRef.uri === 'string'
          ? remoteEntry.sourceRef.uri
          : '';
    if (!rawSampleUri.trim() || typeof fetch === 'undefined') {
      return { importedCount: 0, aborted: false };
    }
    const targetUri = rawSampleUri.replace(/^\.\//, '');
    const matchedSample = SAMPLE_GALLERY.find((s) => s.assetPath.replace(/^\.\//, '') === targetUri);
    if (!matchedSample) {
      return { importedCount: 0, aborted: false };
    }

    try {
      const bundleResp = await fetch('./assets/sample_saves.capy').catch((err) => {
        reportSwallowed('CloudLibrarySyncOrchestrator.fetchSampleBundle', err, { slotKey });
        return null;
      });
      let currentSnapshots = ctx.getAuthoritativeSnapshots();
      let localBySlot = ctx.buildSlotMap(currentSnapshots);
      let localSnap = ctx.findLocalSnap(currentSnapshots, localBySlot, slotKey, remoteEntry.snapshotId);
      if (ctx.wasDeletedMidSync(localSnap, slotKey, remoteEntry.snapshotId)) {
        return { importedCount: 0, aborted: true };
      }
      if (localSnap || !bundleResp || !bundleResp.ok) {
        return { localSnap, importedCount: 0, aborted: false };
      }
      await StorageService.importSnapshotData(await bundleResp.arrayBuffer());
      currentSnapshots = ctx.getAuthoritativeSnapshots();
      localSnap = currentSnapshots.find((s) => {
        const sUri =
          typeof s.sampleAssetPath === 'string'
            ? s.sampleAssetPath
            : typeof s.sourceRef?.uri === 'string'
              ? s.sourceRef.uri
              : '';
        return sUri.replace(/^\.\//, '') === targetUri;
      });
      return { localSnap, importedCount: localSnap ? 1 : 0, aborted: false };
    } catch (err) {
      reportSwallowed('CloudLibrarySyncOrchestrator.bootstrapSampleSnapshot', err, { slotKey });
      return { importedCount: 0, aborted: false };
    }
  }

  private async ensureLocalSnapshotForRemoteEntry(
    slotKey: string,
    remoteEntry: CloudSaveEntryV2,
    activeDriver: CloudProviderDriver | null,
    ctx: SnapshotSyncContext
  ): Promise<{ localSnap?: SavedSnapshot; importedCount: number; aborted: boolean }> {
    let importedCount = 0;

    const blobAttempt = await this.tryImportRemoteBinaryBlob(slotKey, remoteEntry, activeDriver, ctx);
    importedCount += blobAttempt.importedCount;
    if (blobAttempt.aborted || blobAttempt.localSnap) {
      return { localSnap: blobAttempt.localSnap, importedCount, aborted: blobAttempt.aborted };
    }

    if (
      typeof remoteEntry.inlineBinaryB64 === 'string' &&
      remoteEntry.inlineBinaryB64.length > 0 &&
      remoteEntry.inlineBinaryB64.length <= 260_000
    ) {
      const inlineAttempt = await this.tryImportInlineBinary(slotKey, remoteEntry, ctx);
      importedCount += inlineAttempt.importedCount;
      return { localSnap: inlineAttempt.localSnap, importedCount, aborted: false };
    }

    const sampleAttempt = await this.tryBootstrapSampleSnapshot(slotKey, remoteEntry, ctx);
    importedCount += sampleAttempt.importedCount;
    return { localSnap: sampleAttempt.localSnap, importedCount, aborted: sampleAttempt.aborted };
  }

  private applyRemoteDeltaToLocalSnapshot(
    localSnap: SavedSnapshot,
    remoteDelta: ProgressDeltaV2,
    remoteTotalCount: number,
    remoteResetEpoch?: number
  ): number {
    const validEntryResetEpoch =
      typeof remoteResetEpoch === 'number' && Number.isFinite(remoteResetEpoch)
        ? remoteResetEpoch
        : undefined;
    const effectiveRemoteDelta: ProgressDeltaV2 =
      remoteDelta.resetEpoch !== undefined || validEntryResetEpoch === undefined
        ? remoteDelta
        : { ...remoteDelta, resetEpoch: validEntryResetEpoch };
    const localEpoch = localSnap.resetEpoch ?? 0;
    const localDelta: ProgressDeltaV2 = {
      version: 2,
      sourceRef: localSnap.sourceRef,
      filledRegionIds: localSnap.filledRegionIds || [],
      paintedRegionColors: localSnap.paintedRegionColors,
      isFreeColor: localSnap.isFreeColor,
      ...(localEpoch > 0 ? { resetEpoch: localEpoch } : {}),
      updatedAt:
        this.resolvePositiveFiniteTs(localSnap.lastOpened) ||
        this.resolvePositiveFiniteTs(localSnap.timestamp),
    };
    const beforeCount = localDelta.filledRegionIds.length;
    const mergedDelta = mergeProgressDeltas(localDelta, effectiveRemoteDelta);
    const mergedEpoch = mergedDelta.resetEpoch ?? 0;
    const epochAdvanced = mergedEpoch > localEpoch;
    const added = epochAdvanced
      ? mergedDelta.filledRegionIds.length
      : Math.max(0, mergedDelta.filledRegionIds.length - beforeCount);

    const hasSameEpochColors =
      Boolean(effectiveRemoteDelta.paintedRegionColors) &&
      Object.keys(effectiveRemoteDelta.paintedRegionColors || {}).length > 0 &&
      (effectiveRemoteDelta.resetEpoch ?? 0) === mergedEpoch;

    if (epochAdvanced || added > 0 || hasSameEpochColors) {
      StorageService.updateSnapshotProgress(
        localSnap.id,
        mergedDelta.filledRegionIds.length,
        Math.max(localSnap.totalCount || 0, remoteTotalCount || 0),
        mergedDelta.filledRegionIds,
        localSnap.zoomScale,
        localSnap.panOffsetX,
        localSnap.panOffsetY,
        undefined,
        mergedDelta.paintedRegionColors ?? (epochAdvanced ? {} : undefined),
        localSnap.customPalette,
        mergedDelta.isFreeColor ?? localSnap.isFreeColor,
        undefined,
        mergedEpoch > 0 ? mergedEpoch : undefined
      );
    }
    return added;
  }

  private async reconcileRemoteManifest(
    remoteManifest: CloudLibraryManifestV2 | null,
    tombstones: Record<string, number>,
    activeDriver: CloudProviderDriver | null,
    ctx: SnapshotSyncContext
  ): Promise<{ importedSavesFromCloud: number; mergedRegionsFromCloud: number }> {
    let importedSavesFromCloud = 0;
    let mergedRegionsFromCloud = 0;
    if (!remoteManifest?.entries) {
      return { importedSavesFromCloud, mergedRegionsFromCloud };
    }

    for (const [slotKey, remoteEntry] of Object.entries(remoteManifest.entries)) {
      const entryTs = this.resolveEntryTimestamp(remoteEntry);
      if (this.isSlotTombstonedForTimestamp(slotKey, entryTs, tombstones, 0)) {
        continue;
      }
      this.clearSupersededTombstoneForEntry(slotKey, entryTs, tombstones, ctx);

      let remoteDelta: ProgressDeltaV2;
      try {
        remoteDelta = await decodeProgressDeltaToken(remoteEntry.deltaToken);
      } catch (err) {
        reportSwallowed('CloudLibrarySyncOrchestrator.decodeRemoteEntryDelta', err, { slotKey });
        continue;
      }

      let currentSnapshots = ctx.getAuthoritativeSnapshots();
      let localBySlot = ctx.buildSlotMap(currentSnapshots);
      let localSnap = ctx.findLocalSnap(currentSnapshots, localBySlot, slotKey, remoteEntry.snapshotId);
      if (ctx.wasDeletedMidSync(localSnap, slotKey, remoteEntry.snapshotId)) {
        continue;
      }

      if (localSnap) {
        ctx.seenLocalSlots.add(slotKey);
      } else {
        const ensured = await this.ensureLocalSnapshotForRemoteEntry(
          slotKey,
          remoteEntry,
          activeDriver,
          ctx
        );
        importedSavesFromCloud += ensured.importedCount;
        if (ensured.importedCount > 0 || ensured.localSnap) {
          ctx.seenLocalSlots.add(slotKey);
        }
        if (ensured.aborted) continue;
        localSnap = ensured.localSnap;
      }

      currentSnapshots = ctx.getAuthoritativeSnapshots();
      localBySlot = ctx.buildSlotMap(currentSnapshots);
      localSnap = ctx.findLocalSnap(currentSnapshots, localBySlot, slotKey, remoteEntry.snapshotId);
      if (localSnap) {
        ctx.seenLocalSlots.add(slotKey);
        mergedRegionsFromCloud += this.applyRemoteDeltaToLocalSnapshot(
          localSnap,
          remoteDelta,
          remoteEntry.totalCount || 0,
          remoteEntry.resetEpoch
        );
      }
    }

    return { importedSavesFromCloud, mergedRegionsFromCloud };
  }

  private async mergeLegacyVaultEnvelopes(
    tombstones: Record<string, number>,
    ctx: SnapshotSyncContext
  ): Promise<number> {
    const legacyVault = this.readLocalVault();
    let vaultMutated = false;
    let mergedRegionsFromCloud = 0;

    let currentSnapshots = ctx.getAuthoritativeSnapshots();
    let localBySlot = ctx.buildSlotMap(currentSnapshots);

    for (const [slotKey, env] of Object.entries(legacyVault)) {
      if (this.isSlotTombstonedForTimestamp(slotKey, env.updatedAt || 0, tombstones, 0)) {
        delete legacyVault[slotKey];
        vaultMutated = true;
        continue;
      }
      const initialSnap = localBySlot.get(slotKey);
      if (!initialSnap || !env.deltaToken) continue;
      const targetSnapId = initialSnap.id;

      try {
        const rawRemoteDelta = await decodeProgressDeltaToken(env.deltaToken);
        currentSnapshots = ctx.getAuthoritativeSnapshots();
        localBySlot = ctx.buildSlotMap(currentSnapshots);
        const localSnap =
          localBySlot.get(slotKey) || currentSnapshots.find((s) => s.id === targetSnapId);
        if (!localSnap) continue;

        mergedRegionsFromCloud += this.applyRemoteDeltaToLocalSnapshot(
          localSnap,
          rawRemoteDelta,
          env.totalCount || 0,
          env.resetEpoch
        );
        currentSnapshots = ctx.getAuthoritativeSnapshots();
        localBySlot = ctx.buildSlotMap(currentSnapshots);
      } catch (err) {
        reportSwallowed('CloudLibrarySyncOrchestrator.mergeLegacyVaultEnvelope', err, { slotKey });
      }
    }

    if (vaultMutated) {
      this.writeLocalVault(legacyVault);
    }
    return mergedRegionsFromCloud;
  }

  private resolvePositiveFiniteTs(value: number | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  }

  private resolveSnapshotTimestamp(snap: SavedSnapshot): number {
    return Math.max(
      this.resolvePositiveFiniteTs(snap.lastOpened),
      this.resolvePositiveFiniteTs(snap.timestamp)
    );
  }

  private resolveEntryTimestamp(entry: CloudSaveEntryV2): number {
    return Math.max(
      this.resolvePositiveFiniteTs(entry.lastOpened),
      this.resolvePositiveFiniteTs(entry.createdAt)
    );
  }

  private resolveMonotonicEntryTimestamps(
    snap: SavedSnapshot,
    existingRemote?: CloudSaveEntryV2,
    minLastOpened?: number
  ): { createdAt: number; lastOpened: number; deltaUpdatedAt: number } {
    const now = Date.now();
    const safeTimestamp = this.resolvePositiveFiniteTs(snap.timestamp);
    const safeLastOpened = this.resolvePositiveFiniteTs(snap.lastOpened);
    const minTs = this.resolvePositiveFiniteTs(minLastOpened);
    const existingTs = existingRemote ? this.resolveEntryTimestamp(existingRemote) : 0;
    const lamportFloor = Math.max(minTs, existingTs);
    const deltaFloor = lamportFloor > 0 ? Math.ceil(lamportFloor / 1000) * 1000 : 0;
    return {
      createdAt: safeTimestamp || now,
      lastOpened: Math.max(safeLastOpened || now, lamportFloor),
      deltaUpdatedAt: Math.max(safeLastOpened || safeTimestamp || now, deltaFloor, lamportFloor),
    };
  }

  private async encodeManifestEntry(
    snap: SavedSnapshot,
    slotKey: string,
    snapEpoch: number,
    existingRemote?: CloudSaveEntryV2,
    cloudBinaryRef?: string,
    inlineBinaryB64?: string,
    minLastOpened?: number
  ): Promise<CloudSaveEntryV2> {
    const safeSourceRef =
      snap.sourceRef ||
      (isAllowedSampleAssetPath(snap.sampleAssetPath)
        ? { kind: 'sample' as const, uri: snap.sampleAssetPath }
        : undefined);
    const { createdAt, lastOpened, deltaUpdatedAt } = this.resolveMonotonicEntryTimestamps(
      snap,
      existingRemote,
      minLastOpened
    );
    const deltaToken = await encodeProgressDeltaToken({
      version: 2,
      sourceRef: safeSourceRef,
      filledRegionIds: snap.filledRegionIds || [],
      ...(snap.paintedRegionColors && Object.keys(snap.paintedRegionColors).length > 0
        ? { paintedRegionColors: snap.paintedRegionColors }
        : {}),
      ...(snap.isFreeColor ? { isFreeColor: true } : {}),
      ...(snapEpoch > 0 ? { resetEpoch: snapEpoch } : {}),
      updatedAt: deltaUpdatedAt,
    });
    const resolvedBinaryRef =
      cloudBinaryRef || existingRemote?.cloudBinaryRef || existingRemote?.driveBinaryFileId;
    const resolvedInlineB64 = inlineBinaryB64 || existingRemote?.inlineBinaryB64;
    return {
      snapshotId: snap.id,
      slotKey,
      title: snap.title,
      createdAt,
      lastOpened,
      isPinned: snap.isPinned,
      filledCount: (snap.filledRegionIds || []).length,
      totalCount: snap.totalCount || 0,
      ...(snapEpoch > 0 ? { resetEpoch: snapEpoch } : {}),
      deltaToken,
      sourceRef: safeSourceRef,
      sampleAssetPath: snap.sampleAssetPath,
      ...(resolvedBinaryRef
        ? { cloudBinaryRef: resolvedBinaryRef, driveBinaryFileId: resolvedBinaryRef }
        : {}),
      ...(resolvedInlineB64 ? { inlineBinaryB64: resolvedInlineB64 } : {}),
    };
  }

  private async ensureRemoteBinaryForSnapshot(
    snap: SavedSnapshot,
    slotKey: string,
    existingRemote: CloudSaveEntryV2 | undefined,
    activeDriver: CloudProviderDriver | null
  ): Promise<{ cloudBinaryRef?: string; inlineBinaryB64?: string }> {
    let cloudBinaryRef = existingRemote?.cloudBinaryRef || existingRemote?.driveBinaryFileId;
    let inlineBinaryB64 = existingRemote?.inlineBinaryB64;
    const isBuiltInSample = Boolean(
      snap.sampleAssetPath ||
        snap.sourceRef?.kind === 'sample' ||
        snap.sourceRef?.kind === 'catalog'
    );

    if (isBuiltInSample || (cloudBinaryRef && inlineBinaryB64)) {
      return { cloudBinaryRef, inlineBinaryB64 };
    }

    try {
      const binaryBytes = await StorageService.exportSnapshotBinary(snap.id);
      if (binaryBytes.byteLength <= 180_000) {
        inlineBinaryB64 = uint8ToBase64(binaryBytes);
      }
      if (activeDriver && !cloudBinaryRef) {
        const binFileName = `capy_save_${snap.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.capy`;
        const uploadedRef = await activeDriver.writeBinaryBlob(slotKey, binFileName, binaryBytes);
        if (uploadedRef) {
          cloudBinaryRef = uploadedRef;
        }
      }
    } catch (err) {
      reportSwallowed('CloudLibrarySyncOrchestrator.uploadSnapshotBinary', err, { slotKey });
    }
    return { cloudBinaryRef, inlineBinaryB64 };
  }

  private async buildUpdatedManifestEntries(
    remoteManifest: CloudLibraryManifestV2 | null,
    tombstones: Record<string, number>,
    activeDriver: CloudProviderDriver | null,
    ctx: SnapshotSyncContext
  ): Promise<{
    nextEntries: Record<string, CloudSaveEntryV2>;
    pushedFingerprints: Map<string, string>;
  }> {
    const nextEntries: Record<string, CloudSaveEntryV2> = {};
    for (const [slotKey, entry] of Object.entries(remoteManifest?.entries || {})) {
      const entryTs = this.resolveEntryTimestamp(entry);
      if (!this.isSlotTombstonedForTimestamp(slotKey, entryTs, tombstones, 0)) {
        this.clearSupersededTombstoneForEntry(slotKey, entryTs, tombstones, ctx);
        nextEntries[slotKey] = entry;
      }
    }

    const pushedFingerprints = new Map<string, string>();
    const currentSnapshots = ctx.getAuthoritativeSnapshots();

    for (const snap of currentSnapshots) {
      const slotKey = computeSlotKeyForSnapshot(snap);
      ctx.seenLocalSlots.add(slotKey);
      const snapTs = this.resolveSnapshotTimestamp(snap);
      if (!this.tryClearTombstoneForLocalSnapshot(slotKey, snapTs, tombstones, ctx)) {
        continue;
      }
      const existingRemote = nextEntries[slotKey];
      const snapEpoch = Math.max(snap.resetEpoch ?? 0, existingRemote?.resetEpoch ?? 0);
      const { cloudBinaryRef, inlineBinaryB64 } = await this.ensureRemoteBinaryForSnapshot(
        snap,
        slotKey,
        existingRemote,
        activeDriver
      );
      nextEntries[slotKey] = await this.encodeManifestEntry(
        snap,
        slotKey,
        snapEpoch,
        existingRemote,
        cloudBinaryRef,
        inlineBinaryB64,
        ctx.minLastOpenedBySlot.get(slotKey)
      );
      pushedFingerprints.set(slotKey, computeSnapshotContentFingerprint(snap));
    }

    await this.reconcileMidSyncMutations(
      remoteManifest,
      tombstones,
      nextEntries,
      pushedFingerprints,
      ctx
    );

    return { nextEntries, pushedFingerprints };
  }

  private mergeMidSyncLocalTombstones(
    remoteManifest: CloudLibraryManifestV2 | null,
    tombstones: Record<string, number>,
    nextEntries: Record<string, CloudSaveEntryV2>,
    pushedFingerprints: Map<string, string>,
    currentLatestSlots: Set<string>,
    ctx: SnapshotSyncContext
  ): void {
    const freshLocalTombstones = this.readLocalTombstones();
    const filteredLocalTombstones: Record<string, number> = {};
    for (const [slotKey, ts] of Object.entries(freshLocalTombstones)) {
      const deletedMidSync =
        ctx.seenLocalSlots.has(slotKey) && !currentLatestSlots.has(slotKey);
      const clearedAt = ctx.clearedTombstoneAt.get(slotKey) ?? 0;
      if (deletedMidSync) {
        const existingEntryTs = Math.max(
          nextEntries[slotKey] ? this.resolveEntryTimestamp(nextEntries[slotKey]) : 0,
          remoteManifest?.entries?.[slotKey]
            ? this.resolveEntryTimestamp(remoteManifest.entries[slotKey])
            : 0
        );
        const effectiveTombstoneTs =
          existingEntryTs > 0 ? Math.max(ts, Math.floor(existingEntryTs) + 1) : ts;
        filteredLocalTombstones[slotKey] = effectiveTombstoneTs;
        delete nextEntries[slotKey];
        pushedFingerprints.delete(slotKey);
      } else if (ts > clearedAt) {
        filteredLocalTombstones[slotKey] = ts;
      }
    }
    Object.assign(tombstones, mergeTombstoneMaps(tombstones, filteredLocalTombstones));
  }

  private async reconcileMidSyncMutations(
    remoteManifest: CloudLibraryManifestV2 | null,
    tombstones: Record<string, number>,
    nextEntries: Record<string, CloudSaveEntryV2>,
    pushedFingerprints: Map<string, string>,
    ctx: SnapshotSyncContext
  ): Promise<void> {
    const latestSnapshots = ctx.getAuthoritativeSnapshots();
    const latestSlotSet = new Set<string>();
    const currentLatestSlots = new Set<string>(
      latestSnapshots.map((snap) => computeSlotKeyForSnapshot(snap))
    );
    this.mergeMidSyncLocalTombstones(
      remoteManifest,
      tombstones,
      nextEntries,
      pushedFingerprints,
      currentLatestSlots,
      ctx
    );

    for (const latestSnap of latestSnapshots) {
      const slotKey = computeSlotKeyForSnapshot(latestSnap);
      const snapTs = this.resolveSnapshotTimestamp(latestSnap);
      if (!this.tryClearTombstoneForLocalSnapshot(slotKey, snapTs, tombstones, ctx)) {
        continue;
      }
      latestSlotSet.add(slotKey);
      const latestFp = computeSnapshotContentFingerprint(latestSnap);
      const requiredMinLastOpened = ctx.minLastOpenedBySlot.get(slotKey) ?? 0;
      const needsTimestampBump = requiredMinLastOpened > (nextEntries[slotKey]?.lastOpened ?? 0);
      if (pushedFingerprints.get(slotKey) !== latestFp || needsTimestampBump) {
        const latestEpoch = Math.max(
          latestSnap.resetEpoch ?? 0,
          remoteManifest?.entries?.[slotKey]?.resetEpoch ?? 0
        );
        nextEntries[slotKey] = await this.encodeManifestEntry(
          latestSnap,
          slotKey,
          latestEpoch,
          nextEntries[slotKey],
          undefined,
          undefined,
          requiredMinLastOpened || undefined
        );
        pushedFingerprints.set(slotKey, latestFp);
      }
    }

    for (const builtSlot of Array.from(pushedFingerprints.keys())) {
      if (!latestSlotSet.has(builtSlot)) {
        pushedFingerprints.delete(builtSlot);
        if (!remoteManifest?.entries?.[builtSlot] || tombstones[builtSlot] !== undefined) {
          delete nextEntries[builtSlot];
        }
      }
    }

    this.pruneTombstonedNextEntries(nextEntries, tombstones, pushedFingerprints, ctx);
  }

  private pruneTombstonedNextEntries(
    nextEntries: Record<string, CloudSaveEntryV2>,
    tombstones: Record<string, number>,
    pushedFingerprints: Map<string, string>,
    ctx: SnapshotSyncContext
  ): void {
    for (const slotKey of Object.keys(nextEntries)) {
      const entry = nextEntries[slotKey];
      const entryTs = this.resolveEntryTimestamp(entry);
      if (this.isSlotTombstonedForTimestamp(slotKey, entryTs, tombstones, 0)) {
        delete nextEntries[slotKey];
        pushedFingerprints.delete(slotKey);
      } else {
        this.clearSupersededTombstoneForEntry(slotKey, entryTs, tombstones, ctx);
      }
    }
  }

  private hasPendingLocalChangesAfterPush(
    pushedFingerprints: Map<string, string>,
    pushedTombstoneKey: string,
    afterPushSnapshots: SavedSnapshot[],
    afterPushTombstones: Record<string, number>
  ): boolean {
    if (afterPushSnapshots.length !== pushedFingerprints.size) {
      return true;
    }
    for (const snap of afterPushSnapshots) {
      const slotKey = computeSlotKeyForSnapshot(snap);
      if (pushedFingerprints.get(slotKey) !== computeSnapshotContentFingerprint(snap)) {
        return true;
      }
    }
    return serializeTombstonesKey(afterPushTombstones) !== pushedTombstoneKey;
  }

  private buildAbortedSyncSummary(
    importedSavesFromCloud = 0,
    mergedRegionsFromCloud = 0
  ): CloudLibrarySyncSummary {
    return {
      syncedAt: Date.now(),
      totalSavesSynced: 0,
      importedSavesFromCloud,
      mergedRegionsFromCloud,
      pushedToCloud: false,
      cloudBackend: 'local_cache',
      hasPendingLocalChanges: false,
    };
  }

  async syncFullLibrary(localSnapshots: SavedSnapshot[]): Promise<CloudLibrarySyncSummary> {
    const initialScope = this.getAccountScope();
    const ctx = this.createSnapshotSyncContext(localSnapshots);
    const { manifest: remoteManifest, tombstones } = await this.pullRemoteLibraryManifest();
    if (this.isScopeInvalidated(initialScope)) {
      return this.buildAbortedSyncSummary();
    }
    const activeDriver = this.auth.getActiveCloudDriver();

    await this.reconcileTombstonesWithLocalSnapshots(tombstones, ctx);

    const { importedSavesFromCloud, mergedRegionsFromCloud: manifestMergedRegions } =
      await this.reconcileRemoteManifest(remoteManifest, tombstones, activeDriver, ctx);
    const legacyMergedRegions = await this.mergeLegacyVaultEnvelopes(tombstones, ctx);
    const mergedRegionsFromCloud = manifestMergedRegions + legacyMergedRegions;
    if (this.isScopeInvalidated(initialScope)) {
      return this.buildAbortedSyncSummary(importedSavesFromCloud, mergedRegionsFromCloud);
    }

    const { nextEntries, pushedFingerprints } = await this.buildUpdatedManifestEntries(
      remoteManifest,
      tombstones,
      activeDriver,
      ctx
    );
    if (this.isScopeInvalidated(initialScope)) {
      return this.buildAbortedSyncSummary(importedSavesFromCloud, mergedRegionsFromCloud);
    }

    const cleanTombstones = sanitizeTombstoneMap(tombstones);
    this.writeLocalTombstones(cleanTombstones);
    const pushedTombstoneKey = serializeTombstonesKey(cleanTombstones);

    const syncedAt = Date.now();
    const updatedManifest: CloudLibraryManifestV2 = {
      version: 2,
      updatedAt: syncedAt,
      devicePlayerId: this.auth.getCurrentIdentity().playerId,
      providerId: activeDriver?.id,
      entries: nextEntries,
      ...(Object.keys(cleanTombstones).length > 0 ? { tombstones: cleanTombstones } : {}),
    };

    const { pushed, backend } = await this.pushRemoteLibraryManifest(updatedManifest);
    if (this.isScopeInvalidated(initialScope)) {
      return this.buildAbortedSyncSummary(importedSavesFromCloud, mergedRegionsFromCloud);
    }
    if (pushed) {
      this.auth.markSynced(syncedAt);
    }

    const afterPushSnapshots = ctx.getAuthoritativeSnapshots();
    const afterPushTombstones = sanitizeTombstoneMap(this.readLocalTombstones());
    const hasPendingLocalChanges = this.hasPendingLocalChangesAfterPush(
      pushedFingerprints,
      pushedTombstoneKey,
      afterPushSnapshots,
      afterPushTombstones
    );

    return {
      syncedAt,
      totalSavesSynced: Object.keys(nextEntries).length,
      importedSavesFromCloud,
      mergedRegionsFromCloud,
      pushedToCloud: pushed,
      cloudBackend: backend,
      hasPendingLocalChanges,
    };
  }

  async syncProgress(
    slotKey: string,
    title: string,
    localDelta: ProgressDeltaV2,
    totalCount: number
  ): Promise<CloudSyncResult> {
    const existing = await this.pullEnvelope(slotKey);
    let merged = localDelta;
    let addedFromCloud = 0;

    if (existing?.deltaToken) {
      try {
        const rawRemoteDelta = await decodeProgressDeltaToken(existing.deltaToken);
        const remoteDelta: ProgressDeltaV2 =
          rawRemoteDelta.resetEpoch !== undefined || existing.resetEpoch === undefined
            ? rawRemoteDelta
            : { ...rawRemoteDelta, resetEpoch: existing.resetEpoch };
        const beforeEpoch = merged.resetEpoch ?? 0;
        const beforeCount = merged.filledRegionIds.length;
        merged = mergeProgressDeltas(merged, remoteDelta);
        addedFromCloud =
          (merged.resetEpoch ?? 0) > beforeEpoch
            ? merged.filledRegionIds.length
            : Math.max(0, merged.filledRegionIds.length - beforeCount);
      } catch (err) {
        reportSwallowed('CloudLibrarySyncOrchestrator.decodeEnvelopeDelta', err, { slotKey });
        merged = localDelta;
      }
    }

    const { manifest: remoteManifest, backend } = await this.pullRemoteLibraryManifest();
    const manifestEntry = remoteManifest?.entries?.[slotKey];
    if (manifestEntry?.deltaToken) {
      try {
        const rawManifestDelta = await decodeProgressDeltaToken(manifestEntry.deltaToken);
        const manifestDelta: ProgressDeltaV2 =
          rawManifestDelta.resetEpoch !== undefined || manifestEntry.resetEpoch === undefined
            ? rawManifestDelta
            : { ...rawManifestDelta, resetEpoch: manifestEntry.resetEpoch };
        const beforeEpoch = merged.resetEpoch ?? 0;
        const beforeCount = merged.filledRegionIds.length;
        merged = mergeProgressDeltas(merged, manifestDelta);
        addedFromCloud +=
          (merged.resetEpoch ?? 0) > beforeEpoch
            ? merged.filledRegionIds.length
            : Math.max(0, merged.filledRegionIds.length - beforeCount);
      } catch (err) {
        reportSwallowed('CloudLibrarySyncOrchestrator.decodeManifestDelta', err, { slotKey });
      }
    }

    const mergedToken = await encodeProgressDeltaToken(merged);
    const syncedAt = Date.now();
    const envelope: CloudSaveEnvelope = {
      slotKey,
      title,
      deltaToken: mergedToken,
      filledCount: merged.filledRegionIds.length,
      totalCount,
      ...(merged.resetEpoch && merged.resetEpoch > 0 ? { resetEpoch: merged.resetEpoch } : {}),
      updatedAt: syncedAt,
      devicePlayerId: this.auth.getCurrentIdentity().playerId,
    };
    const pushedToCloud = await this.pushEnvelope(envelope);
    if (pushedToCloud) {
      this.auth.markSynced(syncedAt);
    }

    return {
      slotKey,
      mergedDelta: merged,
      addedFromCloud,
      pushedToCloud,
      syncedAt,
      cloudBackend: backend,
    };
  }
}

export { CloudLibrarySyncOrchestrator as CrdtCloudSaveAdapter };
