import { SAMPLE_GALLERY, SampleArtwork, SavedSnapshot } from '../../types';
import {
  decodeProgressDeltaToken,
  encodeProgressDeltaToken,
  mergeProgressDeltas,
  ProgressDeltaV2,
} from '../CapyCodec';
import { NativeBridge } from '../NativeBridge';
import { resolveReleaseChannel } from '../../version';
import { resolveScopedStorageKey, resolveStorageNamespace } from '../StorageNamespace';
import { StorageService } from '../StorageService';
import {
  AppleCloudDriver,
  GoogleCloudDriver,
  MicrosoftCloudDriver,
  PlayGamesAndroidDriver,
  SteamCloudDriver,
} from './CloudProviderDrivers';
import {
  getConfiguredGoogleClientId,
  setConfiguredGoogleClientId,
} from './GoogleCloudSyncClient';
import {
  AiArtworkProvider,
  AiCreditLedger,
  AuthProvider,
  CatalogStorageProvider,
  CloudBackendKind,
  CloudLibraryManifestV2,
  CloudLibrarySyncSummary,
  CloudProviderDescriptor,
  CloudProviderDriver,
  CloudProviderId,
  CloudSaveEntryV2,
  CloudSaveEnvelope,
  CloudSaveProvider,
  CloudSyncResult,
  CommunityPuzzleIdea,
  CoopPaintEvent,
  CoopParticipant,
  CoopRoomWireMessage,
  CoopUnfillEvent,
  InfiniteZoomTileSpec,
  MonetizationProvider,
  PlayerIdentity,
  RealtimeRoomProvider,
} from './types';

const IDENTITY_STORAGE_KEY = 'capy_player_identity_v1';
const TAB_SESSION_SUFFIX_KEY = 'capy_tab_peer_suffix_v1';
const CLOUD_VAULT_STORAGE_KEY = 'capy_cloud_vault_v1';
const CLOUD_MANIFEST_STORAGE_KEY = 'capy_cloud_library_manifest_v2';
const COMMUNITY_IDEAS_STORAGE_KEY = 'capy_community_ideas_v1';
const AI_CREDITS_STORAGE_KEY = 'capy_ai_credits_v1';

export const COLLABORATOR_AVATAR_COLORS = [
  '#f59e0b',
  '#38bdf8',
  '#34d399',
  '#f472b6',
  '#a78bfa',
  '#fb7185',
  '#2dd4bf',
  '#facc15',
];

const ADJECTIVES = ['Sunny', 'Cozy', 'Gentle', 'River', 'Forest', 'Starry', 'Breezy', 'Mellow'];
const NOUNS = ['Capy', 'Painter', 'Sprout', 'Pebble', 'Brush', 'Acorn', 'Lotus', ' Otter'];

function randomHexId(len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function getTabPeerSuffix(): string {
  if (typeof sessionStorage === 'undefined') return 't0';
  try {
    const scopedKey = resolveScopedStorageKey(TAB_SESSION_SUFFIX_KEY);
    let suffix = sessionStorage.getItem(scopedKey);
    if (!suffix) {
      suffix = randomHexId(4);
      sessionStorage.setItem(scopedKey, suffix);
    }
    return suffix;
  } catch {
    return randomHexId(4);
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    binary += String.fromCharCode(
      ...Array.from(bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength)))
    );
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

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

function mapProviderToBackendKind(providerId?: CloudProviderId): CloudBackendKind {
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

// ---------------------------------------------------------------------------
// 1. AuthProvider: Modular Multi-Provider Cloud Identity Manager
// ---------------------------------------------------------------------------

class MultiProviderAuthManager implements AuthProvider {
  private readonly drivers = new Map<CloudProviderId, CloudProviderDriver>();
  private readonly playGamesDriver: PlayGamesAndroidDriver;
  private identity: PlayerIdentity;
  private listeners = new Set<(id: PlayerIdentity) => void>();

  constructor() {
    const googleDriver = new GoogleCloudDriver();
    this.playGamesDriver = new PlayGamesAndroidDriver();
    this.registerDriver(googleDriver);
    this.registerDriver(this.playGamesDriver);
    this.registerDriver(new SteamCloudDriver());
    this.registerDriver(new MicrosoftCloudDriver());
    this.registerDriver(new AppleCloudDriver());

    this.identity = this.loadOrCreateIdentity();

    NativeBridge.onPlayGamesProfile((profile) => {
      this.playGamesDriver.setResolvedProfile(profile.playerId, profile.displayName);
      this.applyPlayGamesProfile(profile.playerId, profile.displayName);
    });
  }

  registerDriver(driver: CloudProviderDriver): void {
    this.drivers.set(driver.id, driver);
  }

  getAvailableCloudProviders(): CloudProviderDescriptor[] {
    return Array.from(this.drivers.values()).map((d) => d.getDescriptor());
  }

  getCloudDriver(providerId: CloudProviderId): CloudProviderDriver | undefined {
    return this.drivers.get(providerId);
  }

  getActiveCloudDriver(): CloudProviderDriver | null {
    if (this.identity.isAuthenticated && this.identity.provider !== 'guest') {
      const explicit = this.drivers.get(this.identity.provider as CloudProviderId);
      if (explicit && explicit.hasActiveSession()) {
        return explicit;
      }
    }
    for (const driver of this.drivers.values()) {
      if (driver.hasActiveSession()) return driver;
    }
    return null;
  }

  private applyPlayGamesProfile(playerId: string, displayName: string): PlayerIdentity {
    const cleanId = playerId.trim();
    const cleanName = displayName.trim().slice(0, 32);
    if (!cleanId || !cleanName) return this.identity;
    this.identity = {
      ...this.identity,
      playerId: cleanId,
      displayName: cleanName,
      provider: 'play_games_v2',
      isAuthenticated: true,
      lastSyncedAt: Date.now(),
    };
    this.persistBaseIdentity(this.identity);
    this.emit();
    return this.identity;
  }

  private loadOrCreateIdentity(): PlayerIdentity {
    const tabSuffix = getTabPeerSuffix();
    let restoredDriverSession: Partial<PlayerIdentity> | null = null;
    for (const driver of this.drivers.values()) {
      const restored = driver.restoreSession();
      if (restored && restored.playerId && restored.displayName) {
        restoredDriverSession = restored;
        break;
      }
    }

    try {
      const raw = localStorage.getItem(resolveScopedStorageKey(IDENTITY_STORAGE_KEY));
      if (raw) {
        const parsed = JSON.parse(raw) as PlayerIdentity;
        if (parsed && parsed.playerId && parsed.displayName) {
          if (restoredDriverSession) {
            return {
              ...parsed,
              ...restoredDriverSession,
              isAuthenticated: true,
            } as PlayerIdentity;
          }
          const hasValidNativePlayGames =
            NativeBridge.isAndroid &&
            parsed.provider === 'play_games_v2' &&
            !parsed.playerId.startsWith('pgs_capy_');
          if (!hasValidNativePlayGames && parsed.isAuthenticated) {
            const baseGuestId = parsed.playerId
              .replace(/^(pgs_|google_|steam_|ms_|apple_)/, '')
              .split(':')[0];
            const downgraded: PlayerIdentity = {
              ...parsed,
              playerId: `${baseGuestId}:${tabSuffix}`,
              email: undefined,
              avatarUrl: undefined,
              provider: 'guest',
              isAuthenticated: false,
            };
            this.persistBaseIdentity(downgraded);
            return downgraded;
          }
          return {
            ...parsed,
            playerId:
              parsed.provider === 'guest'
                ? `${parsed.playerId.split(':')[0]}:${tabSuffix}`
                : parsed.playerId,
          };
        }
      }
    } catch {
      // Ignore storage errors
    }

    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)].trim();
    const color =
      COLLABORATOR_AVATAR_COLORS[Math.floor(Math.random() * COLLABORATOR_AVATAR_COLORS.length)];
    const baseId = `capy_${randomHexId(8)}`;

    if (restoredDriverSession && restoredDriverSession.playerId && restoredDriverSession.displayName) {
      const restoredIdentity: PlayerIdentity = {
        playerId: restoredDriverSession.playerId,
        displayName: restoredDriverSession.displayName,
        email: restoredDriverSession.email,
        avatarUrl: restoredDriverSession.avatarUrl,
        avatarColorHex: color,
        provider: (restoredDriverSession.provider as CloudProviderId) || 'google',
        isAuthenticated: true,
      };
      this.persistBaseIdentity(restoredIdentity);
      return restoredIdentity;
    }

    const fresh: PlayerIdentity = {
      playerId: `${baseId}:${tabSuffix}`,
      displayName: `${adj} ${noun}`,
      avatarColorHex: color,
      provider: 'guest',
      isAuthenticated: false,
    };
    this.persistBaseIdentity(fresh);
    return fresh;
  }

  private persistBaseIdentity(id: PlayerIdentity): void {
    try {
      const stored: PlayerIdentity = {
        ...id,
        playerId: id.provider === 'guest' ? id.playerId.split(':')[0] : id.playerId,
      };
      localStorage.setItem(resolveScopedStorageKey(IDENTITY_STORAGE_KEY), JSON.stringify(stored));
    } catch {
      // Ignore
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.identity);
    }
  }

  getCurrentIdentity(): PlayerIdentity {
    return this.identity;
  }

  getGoogleClientId(): string {
    return getConfiguredGoogleClientId();
  }

  setGoogleClientId(clientId: string): void {
    setConfiguredGoogleClientId(clientId);
  }

  hasActiveCloudToken(): boolean {
    return Boolean(this.getActiveCloudDriver());
  }

  updateGuestProfile(displayName: string, avatarColorHex?: string): PlayerIdentity {
    const trimmed = displayName.trim().slice(0, 24) || this.identity.displayName;
    this.identity = {
      ...this.identity,
      displayName: trimmed,
      avatarColorHex: avatarColorHex || this.identity.avatarColorHex,
    };
    this.persistBaseIdentity(this.identity);
    this.emit();
    return this.identity;
  }

  async attemptAutoSignIn(): Promise<PlayerIdentity | null> {
    if (this.identity.isAuthenticated && this.hasActiveCloudToken()) {
      return this.identity;
    }

    const orderedProviderIds: CloudProviderId[] = NativeBridge.isAndroid
      ? ['play_games_v2', 'google']
      : ['google', 'steam', 'microsoft', 'apple'];

    for (const providerId of orderedProviderIds) {
      const driver = this.drivers.get(providerId);
      if (!driver) continue;
      try {
        const partial = await driver.attemptAutoSignIn();
        if (partial && partial.playerId && partial.displayName) {
          this.identity = {
            ...this.identity,
            ...partial,
            playerId: partial.playerId,
            displayName: partial.displayName.slice(0, 32),
            provider: (partial.provider as CloudProviderId) || providerId,
            isAuthenticated: true,
            lastSyncedAt: Date.now(),
          };
          this.persistBaseIdentity(this.identity);
          this.emit();
          return this.identity;
        }
      } catch {
        // Ignore auto-sign-in errors and continue
      }
    }
    return null;
  }

  async signInWithProvider(
    providerId: CloudProviderId,
    options?: { clientId?: string }
  ): Promise<PlayerIdentity> {
    const driver = this.drivers.get(providerId);
    if (!driver) {
      throw new Error(`Unsupported cloud provider: ${providerId}`);
    }
    const partial = await driver.signIn(options);
    this.identity = {
      ...this.identity,
      ...partial,
      playerId: partial.playerId || this.identity.playerId,
      displayName: (partial.displayName || this.identity.displayName).slice(0, 32),
      provider: (partial.provider as CloudProviderId) || providerId,
      isAuthenticated: true,
      lastSyncedAt: Date.now(),
    };
    this.persistBaseIdentity(this.identity);
    this.emit();
    return this.identity;
  }

  async signInWithGoogle(customClientId?: string): Promise<PlayerIdentity> {
    if (customClientId !== undefined) {
      setConfiguredGoogleClientId(customClientId);
    }
    const clientId = customClientId?.trim() || getConfiguredGoogleClientId();
    const hasMockToken =
      typeof window !== 'undefined' && Boolean(window.__capyMockGoogleOAuthToken);

    if (NativeBridge.isAndroid && !clientId && !hasMockToken) {
      try {
        return await this.signInWithProvider('play_games_v2');
      } catch {
        // Fall through to Google OAuth
      }
    }
    return this.signInWithProvider('google', { clientId });
  }

  async signInWithPlayGames(): Promise<PlayerIdentity> {
    if (NativeBridge.isAndroid) {
      try {
        return await this.signInWithProvider('play_games_v2');
      } catch {
        // Fall through to Google OAuth
      }
    }
    return this.signInWithGoogle();
  }

  async signOut(): Promise<PlayerIdentity> {
    for (const driver of this.drivers.values()) {
      await driver.signOut().catch(() => {});
    }
    const tabSuffix = getTabPeerSuffix();
    const baseId = this.identity.playerId
      .replace(/^(pgs_|google_|steam_|ms_|apple_)/, '')
      .split(':')[0];
    this.identity = {
      ...this.identity,
      playerId: `${baseId}:${tabSuffix}`,
      email: undefined,
      avatarUrl: undefined,
      provider: 'guest',
      isAuthenticated: false,
    };
    this.persistBaseIdentity(this.identity);
    this.emit();
    return this.identity;
  }

  markSynced(syncedAt: number): void {
    this.identity = {
      ...this.identity,
      lastSyncedAt: syncedAt,
    };
    this.persistBaseIdentity(this.identity);
    this.emit();
  }

  subscribe(listener: (identity: PlayerIdentity) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

// ---------------------------------------------------------------------------
// 2. CloudSaveProvider: Provider-Agnostic CRDT Cloud Sync Orchestrator
// ---------------------------------------------------------------------------

class CrdtCloudSaveAdapter implements CloudSaveProvider {
  constructor(private readonly auth: MultiProviderAuthManager) {}

  get providerName(): string {
    const activeDriver = this.auth.getActiveCloudDriver();
    if (activeDriver) {
      return activeDriver.getDescriptor().storageName;
    }
    return NativeBridge.isAndroid ? 'Google Play Games Cloud' : 'Capy Cloud Vault';
  }

  private readLocalVault(): Record<string, CloudSaveEnvelope> {
    try {
      const raw = localStorage.getItem(resolveScopedStorageKey(CLOUD_VAULT_STORAGE_KEY));
      if (raw) return JSON.parse(raw) as Record<string, CloudSaveEnvelope>;
    } catch {
      // Ignore
    }
    return {};
  }

  private writeLocalVault(vault: Record<string, CloudSaveEnvelope>): void {
    try {
      localStorage.setItem(
        resolveScopedStorageKey(CLOUD_VAULT_STORAGE_KEY),
        JSON.stringify(vault)
      );
    } catch {
      // Ignore
    }
  }

  private readLocalManifest(): CloudLibraryManifestV2 | null {
    try {
      const raw = localStorage.getItem(resolveScopedStorageKey(CLOUD_MANIFEST_STORAGE_KEY));
      if (raw) {
        const parsed = JSON.parse(raw) as CloudLibraryManifestV2;
        if (parsed && parsed.version === 2 && parsed.entries) return parsed;
      }
    } catch {
      // Ignore
    }
    return null;
  }

  private writeLocalManifest(manifest: CloudLibraryManifestV2): void {
    try {
      localStorage.setItem(
        resolveScopedStorageKey(CLOUD_MANIFEST_STORAGE_KEY),
        JSON.stringify(manifest)
      );
    } catch {
      // Ignore
    }
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
        console.warn(`Cloud driver (${activeDriver.id}) slot pull failed:`, err);
      }
    }

    const nativeRaw = NativeBridge.loadCloudSnapshot(slotKey);
    if (nativeRaw) {
      try {
        return JSON.parse(nativeRaw) as CloudSaveEnvelope;
      } catch {
        // Fall through
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
        const ok = await activeDriver.writeSlotEnvelope(envelope);
        if (ok) return true;
      } catch (err) {
        console.warn(`Cloud driver (${activeDriver.id}) slot push failed:`, err);
      }
    }

    return nativeSaved || true;
  }

  private async pullRemoteLibraryManifest(): Promise<{
    manifest: CloudLibraryManifestV2 | null;
    backend: CloudBackendKind;
  }> {
    let mergedEntries: Record<string, CloudSaveEntryV2> = {};
    let backend: CloudBackendKind = 'local_cache';
    let latestUpdatedAt = 0;

    const localManifest = this.readLocalManifest();
    if (localManifest?.entries) {
      mergedEntries = { ...localManifest.entries };
      latestUpdatedAt = Math.max(latestUpdatedAt, localManifest.updatedAt || 0);
    }

    // Check Play Games Android driver if running on Android
    const playGamesDriver = this.auth.getCloudDriver('play_games_v2');
    if (playGamesDriver && NativeBridge.isAndroid) {
      try {
        const nativeManifest = await playGamesDriver.readManifest();
        if (nativeManifest?.entries) {
          backend = 'play_games_snapshots';
          latestUpdatedAt = Math.max(latestUpdatedAt, nativeManifest.updatedAt || 0);
          for (const [k, entry] of Object.entries(nativeManifest.entries)) {
            const existing = mergedEntries[k];
            if (!existing || entry.lastOpened >= existing.lastOpened) {
              mergedEntries[k] = entry;
            }
          }
        }
      } catch {
        // Ignore
      }
    }

    // Check active cloud provider driver (Google, Steam, Microsoft, Apple)
    const activeDriver = this.auth.getActiveCloudDriver();
    if (activeDriver) {
      try {
        const remoteManifest = await activeDriver.readManifest();
        backend = mapProviderToBackendKind(activeDriver.id);
        if (remoteManifest?.entries) {
          latestUpdatedAt = Math.max(latestUpdatedAt, remoteManifest.updatedAt || 0);
          for (const [k, entry] of Object.entries(remoteManifest.entries)) {
            const existing = mergedEntries[k];
            if (!existing || entry.lastOpened >= existing.lastOpened) {
              mergedEntries[k] = entry;
            }
          }
        }
      } catch (err) {
        console.warn(`Failed to pull manifest from cloud driver (${activeDriver.id}):`, err);
      }
    }

    if (Object.keys(mergedEntries).length === 0) {
      return { manifest: null, backend };
    }

    return {
      manifest: {
        version: 2,
        updatedAt: latestUpdatedAt || Date.now(),
        devicePlayerId: this.auth.getCurrentIdentity().playerId,
        providerId: activeDriver?.id,
        entries: mergedEntries,
      },
      backend,
    };
  }

  private async pushRemoteLibraryManifest(
    manifest: CloudLibraryManifestV2
  ): Promise<{
    pushed: boolean;
    backend: CloudBackendKind;
  }> {
    this.writeLocalManifest(manifest);

    let nativeSaved = false;
    const playGamesDriver = this.auth.getCloudDriver('play_games_v2');
    if (playGamesDriver && NativeBridge.isAndroid) {
      nativeSaved = await playGamesDriver.writeManifest(manifest).catch(() => false);
    }

    const activeDriver = this.auth.getActiveCloudDriver();
    if (activeDriver) {
      try {
        const ok = await activeDriver.writeManifest(manifest);
        if (ok) {
          return {
            pushed: true,
            backend: mapProviderToBackendKind(activeDriver.id),
          };
        }
      } catch (err) {
        console.warn(`Failed to push manifest to cloud driver (${activeDriver.id}):`, err);
      }
    }

    return {
      pushed: nativeSaved || true,
      backend: nativeSaved ? 'play_games_snapshots' : 'local_cache',
    };
  }

  async syncFullLibrary(localSnapshots: SavedSnapshot[]): Promise<CloudLibrarySyncSummary> {
    const { manifest: remoteManifest } = await this.pullRemoteLibraryManifest();
    const activeDriver = this.auth.getActiveCloudDriver();
    let importedSavesFromCloud = 0;
    let mergedRegionsFromCloud = 0;

    let currentSnapshots = [...localSnapshots];
    const localBySlot = new Map<string, SavedSnapshot>();
    for (const snap of currentSnapshots) {
      localBySlot.set(computeSlotKeyForSnapshot(snap), snap);
    }

    // 1. Merge remote manifest entries into local StorageService
    if (remoteManifest?.entries) {
      for (const [slotKey, remoteEntry] of Object.entries(remoteManifest.entries)) {
        let remoteDelta: ProgressDeltaV2;
        try {
          remoteDelta = await decodeProgressDeltaToken(remoteEntry.deltaToken);
        } catch {
          continue;
        }

        let localSnap =
          localBySlot.get(slotKey) ||
          currentSnapshots.find((s) => s.id === remoteEntry.snapshotId);

        const remoteBlobRef = remoteEntry.cloudBinaryRef || remoteEntry.driveBinaryFileId;

        if (!localSnap && remoteBlobRef && activeDriver) {
          try {
            const bin = await activeDriver.readBinaryBlob(remoteBlobRef);
            if (bin && bin.byteLength > 0) {
              const imported = await StorageService.importSnapshotData(bin);
              if (imported.importedCount > 0) {
                importedSavesFromCloud += imported.importedCount;
                currentSnapshots = StorageService.loadSnapshots();
                localSnap = currentSnapshots.find((s) => s.id === remoteEntry.snapshotId);
              }
            }
          } catch (err) {
            console.warn(`Failed to download binary save from ${activeDriver.id}:`, err);
          }
        }

        if (!localSnap && remoteEntry.inlineBinaryB64) {
          try {
            const bin = base64ToUint8(remoteEntry.inlineBinaryB64);
            const imported = await StorageService.importSnapshotData(bin);
            if (imported.importedCount > 0) {
              importedSavesFromCloud += imported.importedCount;
              currentSnapshots = StorageService.loadSnapshots();
              localSnap = currentSnapshots.find((s) => s.id === remoteEntry.snapshotId);
            }
          } catch (err) {
            console.warn('Failed to import inline binary puzzle from cloud manifest:', err);
          }
        } else if (
          !localSnap &&
          (remoteEntry.sampleAssetPath || remoteEntry.sourceRef?.kind === 'sample')
        ) {
          const targetUri = (
            remoteEntry.sampleAssetPath ||
            remoteEntry.sourceRef?.uri ||
            ''
          ).replace(/^\.\//, '');
          const matchedSample = SAMPLE_GALLERY.find(
            (s) => s.assetPath.replace(/^\.\//, '') === targetUri
          );
          if (matchedSample && typeof fetch !== 'undefined') {
            try {
              const bundleResp = await fetch('./assets/sample_saves.capy').catch(() => null);
              if (bundleResp && bundleResp.ok) {
                await StorageService.importSnapshotData(await bundleResp.arrayBuffer());
                currentSnapshots = StorageService.loadSnapshots();
                localSnap = currentSnapshots.find(
                  (s) =>
                    (s.sampleAssetPath || s.sourceRef?.uri || '').replace(/^\.\//, '') ===
                    targetUri
                );
                if (localSnap) {
                  importedSavesFromCloud += 1;
                }
              }
            } catch {
              // Ignore sample bundle bootstrap error
            }
          }
        }

        if (localSnap) {
          const effectiveRemoteDelta: ProgressDeltaV2 =
            remoteDelta.resetEpoch !== undefined || remoteEntry.resetEpoch === undefined
              ? remoteDelta
              : { ...remoteDelta, resetEpoch: remoteEntry.resetEpoch };
          const localEpoch = localSnap.resetEpoch ?? 0;
          const localDelta: ProgressDeltaV2 = {
            version: 2,
            sourceRef: localSnap.sourceRef,
            filledRegionIds: localSnap.filledRegionIds || [],
            paintedRegionColors: localSnap.paintedRegionColors,
            isFreeColor: localSnap.isFreeColor,
            ...(localEpoch > 0 ? { resetEpoch: localEpoch } : {}),
            updatedAt: localSnap.lastOpened || localSnap.timestamp || 0,
          };
          const beforeCount = localDelta.filledRegionIds.length;
          const mergedDelta = mergeProgressDeltas(localDelta, effectiveRemoteDelta);
          const mergedEpoch = mergedDelta.resetEpoch ?? 0;
          const epochAdvanced = mergedEpoch > localEpoch;
          const added = epochAdvanced
            ? mergedDelta.filledRegionIds.length
            : Math.max(0, mergedDelta.filledRegionIds.length - beforeCount);
          mergedRegionsFromCloud += added;

          if (
            epochAdvanced ||
            added > 0 ||
            (effectiveRemoteDelta.paintedRegionColors &&
              Object.keys(effectiveRemoteDelta.paintedRegionColors).length > 0 &&
              (effectiveRemoteDelta.resetEpoch ?? 0) === mergedEpoch)
          ) {
            currentSnapshots = StorageService.updateSnapshotProgress(
              localSnap.id,
              mergedDelta.filledRegionIds.length,
              Math.max(localSnap.totalCount || 0, remoteEntry.totalCount || 0),
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
            localBySlot.set(slotKey, currentSnapshots.find((s) => s.id === localSnap!.id)!);
          }
        }
      }
    }

    // 2. Also merge any legacy single-slot vault envelopes into matching local snapshots
    const legacyVault = this.readLocalVault();
    for (const [slotKey, env] of Object.entries(legacyVault)) {
      const localSnap = localBySlot.get(slotKey);
      if (!localSnap || !env.deltaToken) continue;
      try {
        const rawRemoteDelta = await decodeProgressDeltaToken(env.deltaToken);
        const remoteDelta: ProgressDeltaV2 =
          rawRemoteDelta.resetEpoch !== undefined || env.resetEpoch === undefined
            ? rawRemoteDelta
            : { ...rawRemoteDelta, resetEpoch: env.resetEpoch };
        const localEpoch = localSnap.resetEpoch ?? 0;
        const localDelta: ProgressDeltaV2 = {
          version: 2,
          sourceRef: localSnap.sourceRef,
          filledRegionIds: localSnap.filledRegionIds || [],
          paintedRegionColors: localSnap.paintedRegionColors,
          isFreeColor: localSnap.isFreeColor,
          ...(localEpoch > 0 ? { resetEpoch: localEpoch } : {}),
          updatedAt: localSnap.lastOpened || localSnap.timestamp || 0,
        };
        const beforeCount = localDelta.filledRegionIds.length;
        const mergedDelta = mergeProgressDeltas(localDelta, remoteDelta);
        const mergedEpoch = mergedDelta.resetEpoch ?? 0;
        const epochAdvanced = mergedEpoch > localEpoch;
        const added = epochAdvanced
          ? mergedDelta.filledRegionIds.length
          : Math.max(0, mergedDelta.filledRegionIds.length - beforeCount);
        if (epochAdvanced || added > 0) {
          mergedRegionsFromCloud += added;
          currentSnapshots = StorageService.updateSnapshotProgress(
            localSnap.id,
            mergedDelta.filledRegionIds.length,
            Math.max(localSnap.totalCount || 0, env.totalCount || 0),
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
          localBySlot.set(slotKey, currentSnapshots.find((s) => s.id === localSnap.id)!);
        }
      } catch {
        // Ignore malformed legacy envelope
      }
    }

    // 3. Build updated CloudLibraryManifestV2 from all local snapshots & upload any new custom .capy v2 binaries
    currentSnapshots = StorageService.loadSnapshots();
    const nextEntries: Record<string, CloudSaveEntryV2> = {
      ...(remoteManifest?.entries || {}),
    };

    for (const snap of currentSnapshots) {
      const slotKey = computeSlotKeyForSnapshot(snap);
      const existingRemote = nextEntries[slotKey];
      const snapEpoch = Math.max(snap.resetEpoch ?? 0, existingRemote?.resetEpoch ?? 0);
      const deltaToken = await encodeProgressDeltaToken({
        version: 2,
        sourceRef:
          snap.sourceRef ||
          (snap.sampleAssetPath ? { kind: 'sample', uri: snap.sampleAssetPath } : undefined),
        filledRegionIds: snap.filledRegionIds || [],
        ...(snap.paintedRegionColors && Object.keys(snap.paintedRegionColors).length > 0
          ? { paintedRegionColors: snap.paintedRegionColors }
          : {}),
        ...(snap.isFreeColor ? { isFreeColor: true } : {}),
        ...(snapEpoch > 0 ? { resetEpoch: snapEpoch } : {}),
        updatedAt: snap.lastOpened || snap.timestamp || Date.now(),
      });

      let cloudBinaryRef = existingRemote?.cloudBinaryRef || existingRemote?.driveBinaryFileId;
      let inlineBinaryB64 = existingRemote?.inlineBinaryB64;
      const isBuiltInSample = Boolean(
        snap.sampleAssetPath ||
          snap.sourceRef?.kind === 'sample' ||
          snap.sourceRef?.kind === 'catalog'
      );

      if (!isBuiltInSample && (!cloudBinaryRef || !inlineBinaryB64)) {
        try {
          const binaryBytes = await StorageService.exportSnapshotBinary(snap.id);
          if (binaryBytes.byteLength <= 180_000) {
            inlineBinaryB64 = uint8ToBase64(binaryBytes);
          }
          if (activeDriver && !cloudBinaryRef) {
            const binFileName = `capy_save_${snap.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.capy`;
            const uploadedRef = await activeDriver.writeBinaryBlob(
              slotKey,
              binFileName,
              binaryBytes
            );
            if (uploadedRef) {
              cloudBinaryRef = uploadedRef;
            }
          }
        } catch {
          // Puzzle binary may still be generating
        }
      }

      nextEntries[slotKey] = {
        snapshotId: snap.id,
        slotKey,
        title: snap.title,
        createdAt: snap.timestamp || Date.now(),
        lastOpened: snap.lastOpened || Date.now(),
        isPinned: snap.isPinned,
        filledCount: (snap.filledRegionIds || []).length,
        totalCount: snap.totalCount || 0,
        ...(snapEpoch > 0 ? { resetEpoch: snapEpoch } : {}),
        deltaToken,
        sourceRef: snap.sourceRef,
        sampleAssetPath: snap.sampleAssetPath,
        ...(cloudBinaryRef
          ? { cloudBinaryRef, driveBinaryFileId: cloudBinaryRef }
          : {}),
        ...(inlineBinaryB64 ? { inlineBinaryB64 } : {}),
      };
    }

    const syncedAt = Date.now();
    const updatedManifest: CloudLibraryManifestV2 = {
      version: 2,
      updatedAt: syncedAt,
      devicePlayerId: this.auth.getCurrentIdentity().playerId,
      providerId: activeDriver?.id,
      entries: nextEntries,
    };

    const { pushed, backend } = await this.pushRemoteLibraryManifest(updatedManifest);
    this.auth.markSynced(syncedAt);

    return {
      syncedAt,
      totalSavesSynced: Object.keys(nextEntries).length,
      importedSavesFromCloud,
      mergedRegionsFromCloud,
      pushedToCloud: pushed,
      cloudBackend: backend,
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
      } catch {
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
      } catch {
        // Ignore
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
    this.auth.markSynced(syncedAt);

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

// ---------------------------------------------------------------------------
// 3. RealtimeRoomProvider: Simultaneous Co-op via BroadcastChannel + Optional WS
// ---------------------------------------------------------------------------

export interface LocationLike {
  protocol?: string;
  host?: string;
  hostname?: string;
}

export function resolveCoopRoomWsUrl(
  explicitEnvUrl?: string,
  locationLike?: LocationLike | null
): string | null {
  if (explicitEnvUrl && explicitEnvUrl.trim().length > 0) {
    return explicitEnvUrl.trim();
  }
  if (!locationLike?.hostname) return null;

  const hostname = locationLike.hostname.toLowerCase();
  if (hostname === 'appassets.androidplatform.net') {
    return 'wss://capypaint.com/api/room';
  }

  if (
    hostname === 'capypaint.com' ||
    hostname === 'www.capypaint.com' ||
    hostname.endsWith('.capypaint.com')
  ) {
    const wsProto = locationLike.protocol === 'http:' ? 'ws:' : 'wss:';
    const targetHost =
      hostname === 'www.capypaint.com' ? 'capypaint.com' : locationLike.host || hostname;
    return `${wsProto}//${targetHost}/api/room`;
  }

  return null;
}

export function computeCoopReconnectDelayMs(
  attempt: number,
  randomVal: number = Math.random()
): number {
  const expMs = Math.min(15_000, 1000 * Math.pow(2, Math.max(0, attempt)));
  const clampedRandom = Math.min(1, Math.max(0, randomVal));
  const jittered = Math.round(expMs * (0.8 + clampedRandom * 0.4));
  return Math.max(1000, Math.min(15_000, jittered));
}

export function resolveCoopBroadcastChannelName(roomCode: string): string {
  const channelInfo = resolveReleaseChannel();
  const ns = resolveStorageNamespace();
  if (!ns.isSandboxed) {
    return `capy_coop_room_stable_${roomCode}`;
  }
  const scope =
    channelInfo.channel === 'alpha'
      ? `alpha_${channelInfo.prNumber ?? 'preview'}`
      : channelInfo.channel;
  return `capy_coop_room_${scope}_${roomCode}`;
}

export class HybridCoopRoomAdapter implements RealtimeRoomProvider {
  private roomCode: string | null = null;
  private selfParticipant: CoopParticipant | null = null;
  private seedToken: string | undefined;
  private channel: BroadcastChannel | null = null;
  private ws: WebSocket | null = null;
  private wsEndpoint: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private wsPingTimer: ReturnType<typeof setInterval> | null = null;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsReconnectAttempt = 0;
  private isLeavingRoom = false;
  private detachLifecycleListeners: (() => void) | null = null;
  private participants = new Map<string, CoopParticipant>();
  private participantTransports = new Map<string, 'channel' | 'ws'>();
  private seenEventIds = new Set<string>();

  private paintHandlers = new Set<(event: CoopPaintEvent) => void>();
  private unfillHandlers = new Set<(event: CoopUnfillEvent) => void>();
  private welcomeHandlers = new Set<(seedToken: string, sender: CoopParticipant) => void>();
  private participantHandlers = new Set<(participants: CoopParticipant[]) => void>();

  get activeRoomCode(): string | null {
    return this.roomCode;
  }

  async joinRoom(
    rawRoomCode: string,
    participant: CoopParticipant,
    initialSeedToken?: string
  ): Promise<void> {
    this.leaveRoom();

    const normalized = rawRoomCode
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8);
    if (!normalized) throw new Error('Invalid room code');

    this.isLeavingRoom = false;
    this.roomCode = normalized;
    this.selfParticipant = { ...participant, lastActiveAt: Date.now() };
    this.seedToken = initialSeedToken;
    this.participants.clear();
    this.participantTransports.clear();
    this.participants.set(this.selfParticipant.playerId, this.selfParticipant);
    this.emitParticipants();

    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(resolveCoopBroadcastChannelName(normalized));
      this.channel.onmessage = (ev: MessageEvent<CoopRoomWireMessage>) => {
        if (ev.data) this.handleWireMessage(ev.data, 'channel');
      };
    }

    // Announce immediate presence on local BroadcastChannel
    this.sendLocalChannelMessage({
      type: 'HELLO',
      roomCode: normalized,
      sender: this.selfParticipant,
      seedToken: this.seedToken,
      sentAt: Date.now(),
    });

    const explicitWsEndpoint = (import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_CAPY_ROOM_WS_URL;
    this.wsEndpoint = resolveCoopRoomWsUrl(
      explicitWsEndpoint,
      typeof window !== 'undefined' ? window.location : null
    );
    if (this.wsEndpoint && typeof WebSocket !== 'undefined') {
      this.wsReconnectAttempt = 0;
      this.attachLifecycleListeners();
      this.wsPingTimer = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          try {
            this.ws.send('PING');
          } catch {
            // Ignore send failure; onclose drives reconnect
          }
        }
      }, 30_000);
      this.openWebSocket();
    }

    this.heartbeatTimer = setInterval(() => {
      if (!this.roomCode || !this.selfParticipant) return;
      this.selfParticipant.lastActiveAt = Date.now();
      this.participants.set(this.selfParticipant.playerId, this.selfParticipant);
      this.pruneStaleParticipants();
      // Keep 5s HEARTBEAT strictly on local BroadcastChannel so Cloudflare DO can hibernate
      this.sendLocalChannelMessage({
        type: 'HEARTBEAT',
        roomCode: this.roomCode,
        sender: this.selfParticipant,
        sentAt: Date.now(),
      });
    }, 5000);
  }

  private attachLifecycleListeners(): void {
    this.detachLifecycleListeners?.();
    const cleanups: Array<() => void> = [];
    const recoverIfDisconnected = () => {
      if (this.isLeavingRoom || !this.roomCode || !this.wsEndpoint) return;
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        if (this.wsReconnectTimer) {
          clearTimeout(this.wsReconnectTimer);
          this.wsReconnectTimer = null;
        }
        this.wsReconnectAttempt = 0;
        this.openWebSocket();
      }
    };

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', recoverIfDisconnected);
      cleanups.push(() => window.removeEventListener('online', recoverIfDisconnected));
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      const onVisibility = () => {
        if (document.visibilityState === 'visible') {
          recoverIfDisconnected();
        }
      };
      document.addEventListener('visibilitychange', onVisibility);
      cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));
    }
    this.detachLifecycleListeners = () => {
      for (const fn of cleanups) fn();
    };
  }

  private openWebSocket(): void {
    if (this.isLeavingRoom || !this.roomCode || !this.wsEndpoint || typeof WebSocket === 'undefined') {
      return;
    }
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }

    try {
      const sep = this.wsEndpoint.includes('?') ? '&' : '?';
      const socket = new WebSocket(
        `${this.wsEndpoint}${sep}room=${encodeURIComponent(this.roomCode)}`
      );
      this.ws = socket;

      socket.onopen = () => {
        if (this.ws !== socket || this.isLeavingRoom || !this.roomCode || !this.selfParticipant) {
          try {
            socket.close();
          } catch {
            // Ignore
          }
          return;
        }
        this.wsReconnectAttempt = 0;
        this.sendWebSocketMessage({
          type: 'HELLO',
          roomCode: this.roomCode,
          sender: this.selfParticipant,
          seedToken: this.seedToken,
          sentAt: Date.now(),
        });
      };

      socket.onmessage = (ev) => {
        const raw = typeof ev.data === 'string' ? ev.data : String(ev.data ?? '');
        if (raw === 'PONG' || raw === 'PING') return;
        try {
          const parsed = JSON.parse(raw) as CoopRoomWireMessage;
          this.handleWireMessage(parsed, 'ws');
        } catch {
          // Ignore malformed frame
        }
      };

      socket.onclose = () => {
        if (this.ws === socket) {
          this.ws = null;
        }
        this.clearWsParticipants();
        if (!this.isLeavingRoom && this.roomCode && this.wsEndpoint) {
          this.scheduleWsReconnect();
        }
      };

      socket.onerror = () => {
        // Allow onclose to drive cleanup and backoff
      };
    } catch {
      this.ws = null;
      this.scheduleWsReconnect();
    }
  }

  private scheduleWsReconnect(): void {
    if (this.wsReconnectTimer || this.isLeavingRoom || !this.roomCode || !this.wsEndpoint) {
      return;
    }
    const delayMs = computeCoopReconnectDelayMs(this.wsReconnectAttempt++);
    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      if (!this.isLeavingRoom && this.roomCode && this.wsEndpoint) {
        this.openWebSocket();
      }
    }, delayMs);
  }

  private clearWsParticipants(): void {
    let changed = false;
    for (const [pid, transport] of this.participantTransports.entries()) {
      if (this.selfParticipant && pid === this.selfParticipant.playerId) continue;
      if (transport === 'ws') {
        this.participantTransports.delete(pid);
        if (this.participants.delete(pid)) {
          changed = true;
        }
      }
    }
    if (changed) this.emitParticipants();
  }

  leaveRoom(): void {
    this.isLeavingRoom = true;
    if (this.roomCode && this.selfParticipant) {
      this.sendWireMessage({
        type: 'LEAVE',
        roomCode: this.roomCode,
        sender: this.selfParticipant,
        sentAt: Date.now(),
      });
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.wsPingTimer) {
      clearInterval(this.wsPingTimer);
      this.wsPingTimer = null;
    }
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    this.detachLifecycleListeners?.();
    this.detachLifecycleListeners = null;

    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    if (this.ws) {
      const activeWs = this.ws;
      this.ws = null;
      activeWs.onopen = null;
      activeWs.onmessage = null;
      activeWs.onclose = null;
      activeWs.onerror = null;
      try {
        activeWs.close();
      } catch {
        // Ignore
      }
    }
    this.wsEndpoint = null;
    this.wsReconnectAttempt = 0;
    this.roomCode = null;
    this.selfParticipant = null;
    this.seedToken = undefined;
    this.participants.clear();
    this.participantTransports.clear();
    this.seenEventIds.clear();
    this.isLeavingRoom = false;
    this.emitParticipants();
  }

  private sendLocalChannelMessage(msg: CoopRoomWireMessage): void {
    try {
      this.channel?.postMessage(msg);
    } catch {
      // Ignore closed channel
    }
  }

  private sendWebSocketMessage(msg: CoopRoomWireMessage): void {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
      }
    } catch {
      // Ignore WS errors
    }
  }

  private sendWireMessage(msg: CoopRoomWireMessage): void {
    this.sendLocalChannelMessage(msg);
    this.sendWebSocketMessage(msg);
  }

  private handleWireMessage(msg: CoopRoomWireMessage, source: 'channel' | 'ws' = 'channel'): void {
    if (!this.roomCode || msg.roomCode !== this.roomCode || !msg.sender) return;
    if (this.selfParticipant && msg.sender.playerId === this.selfParticipant.playerId) return;

    if (msg.type === 'WELCOME_STATE' && msg.sender.playerId === '__capy_room_relay__') {
      if (msg.seedToken) {
        const relaySender: CoopParticipant = { ...msg.sender, lastActiveAt: Date.now() };
        for (const h of this.welcomeHandlers) h(msg.seedToken, relaySender);
      }
      return;
    }

    if (msg.type === 'LEAVE') {
      this.participants.delete(msg.sender.playerId);
      this.participantTransports.delete(msg.sender.playerId);
      this.emitParticipants();
      return;
    }

    const updatedSender: CoopParticipant = {
      ...msg.sender,
      lastActiveAt: Date.now(),
    };
    const pid = updatedSender.playerId;
    if (source === 'channel') {
      this.participantTransports.set(pid, 'channel');
    } else if (this.participantTransports.get(pid) !== 'channel') {
      this.participantTransports.set(pid, 'ws');
    }

    const isNewPeer = !this.participants.has(pid);
    this.participants.set(pid, updatedSender);
    if (isNewPeer) {
      this.emitParticipants();
    }

    if (msg.type === 'HELLO') {
      if (msg.seedToken) {
        for (const h of this.welcomeHandlers) h(msg.seedToken, updatedSender);
      }
      // Reply with our current welcome state on the transport that delivered HELLO
      if (this.selfParticipant) {
        const welcomeMsg: CoopRoomWireMessage = {
          type: 'WELCOME_STATE',
          roomCode: this.roomCode,
          sender: this.selfParticipant,
          seedToken: this.seedToken,
          sentAt: Date.now(),
        };
        if (source === 'ws') {
          this.sendWebSocketMessage(welcomeMsg);
        } else {
          this.sendLocalChannelMessage(welcomeMsg);
        }
      }
      return;
    }

    if (msg.type === 'WELCOME_STATE') {
      if (msg.seedToken) {
        for (const h of this.welcomeHandlers) h(msg.seedToken, updatedSender);
      }
      return;
    }

    if (msg.type === 'PAINT_EVENT' && msg.paintEvent) {
      if (this.seenEventIds.has(msg.paintEvent.eventId)) return;
      this.rememberEventId(msg.paintEvent.eventId);
      for (const h of this.paintHandlers) h(msg.paintEvent);
      return;
    }

    if (msg.type === 'UNFILL_EVENT' && msg.unfillEvent) {
      const ev = msg.unfillEvent;
      const senderId = ev.senderId || ev.playerId || msg.sender.playerId;
      if (!senderId || (this.selfParticipant && senderId === this.selfParticipant.playerId)) {
        return;
      }
      const normalizedRegionIds = Array.isArray(ev.regionIds)
        ? ev.regionIds.filter((id) => Number.isInteger(id) && id > 0)
        : typeof ev.regionId === 'number' && Number.isInteger(ev.regionId) && ev.regionId > 0
          ? [ev.regionId]
          : [];
      if (normalizedRegionIds.length === 0) return;
      if (ev.eventId) {
        if (this.seenEventIds.has(ev.eventId)) return;
        this.rememberEventId(ev.eventId);
      }
      const normalizedEvent: CoopUnfillEvent = {
        ...ev,
        senderId,
        playerId: ev.playerId || senderId,
        regionId: ev.regionId ?? normalizedRegionIds[0],
        regionIds: normalizedRegionIds,
        timestamp: typeof ev.timestamp === 'number' ? ev.timestamp : Date.now(),
      };
      for (const h of this.unfillHandlers) h(normalizedEvent);
    }
  }

  private rememberEventId(eventId: string): void {
    this.seenEventIds.add(eventId);
    if (this.seenEventIds.size > 512) {
      const oldest = this.seenEventIds.values().next().value;
      if (oldest) this.seenEventIds.delete(oldest);
    }
  }

  private pruneStaleParticipants(): void {
    const cutoff = Date.now() - 18000;
    let changed = false;
    for (const [pid, peer] of this.participants.entries()) {
      if (this.selfParticipant && pid === this.selfParticipant.playerId) continue;
      if (this.participantTransports.get(pid) === 'ws') continue;
      if (peer.lastActiveAt < cutoff) {
        this.participants.delete(pid);
        this.participantTransports.delete(pid);
        changed = true;
      }
    }
    if (changed) this.emitParticipants();
  }

  private emitParticipants(): void {
    const list = Array.from(this.participants.values());
    for (const h of this.participantHandlers) h(list);
  }

  broadcastPaintEvent(event: CoopPaintEvent): void {
    if (!this.roomCode || !this.selfParticipant) return;
    this.rememberEventId(event.eventId);
    this.sendWireMessage({
      type: 'PAINT_EVENT',
      roomCode: this.roomCode,
      sender: this.selfParticipant,
      paintEvent: event,
      sentAt: Date.now(),
    });
  }

  broadcastUnfillEvent(event: CoopUnfillEvent): void {
    if (!this.roomCode || !this.selfParticipant) return;
    const normalizedIds = Array.isArray(event.regionIds)
      ? event.regionIds.filter((id) => Number.isInteger(id) && id > 0)
      : typeof event.regionId === 'number' && event.regionId > 0
        ? [event.regionId]
        : [];
    if (normalizedIds.length === 0) return;
    if (event.eventId) {
      this.rememberEventId(event.eventId);
    }
    const wireEvent: CoopUnfillEvent = {
      ...event,
      roomCode: this.roomCode,
      senderId: event.senderId || this.selfParticipant.playerId,
      playerId: event.playerId || this.selfParticipant.playerId,
      regionId: event.regionId ?? normalizedIds[0],
      regionIds: normalizedIds,
    };
    this.sendWireMessage({
      type: 'UNFILL_EVENT',
      roomCode: this.roomCode,
      sender: this.selfParticipant,
      unfillEvent: wireEvent,
      sentAt: Date.now(),
    });
  }

  broadcastWelcomeState(seedToken: string): void {
    this.seedToken = seedToken;
    if (!this.roomCode || !this.selfParticipant) return;
    this.sendWireMessage({
      type: 'WELCOME_STATE',
      roomCode: this.roomCode,
      sender: this.selfParticipant,
      seedToken,
      sentAt: Date.now(),
    });
  }

  updateSeedToken(seedToken: string): void {
    this.seedToken = seedToken;
  }

  getParticipants(): CoopParticipant[] {
    return Array.from(this.participants.values());
  }

  onPaintEvent(handler: (event: CoopPaintEvent) => void): () => void {
    this.paintHandlers.add(handler);
    return () => {
      this.paintHandlers.delete(handler);
    };
  }

  onUnfillEvent(handler: (event: CoopUnfillEvent) => void): () => void {
    this.unfillHandlers.add(handler);
    return () => {
      this.unfillHandlers.delete(handler);
    };
  }

  onWelcomeState(handler: (seedToken: string, sender: CoopParticipant) => void): () => void {
    this.welcomeHandlers.add(handler);
    return () => {
      this.welcomeHandlers.delete(handler);
    };
  }

  onParticipantsChanged(handler: (participants: CoopParticipant[]) => void): () => void {
    this.participantHandlers.add(handler);
    return () => {
      this.participantHandlers.delete(handler);
    };
  }
}

// ---------------------------------------------------------------------------
// 4. CatalogStorageProvider: Gallery Search + Community Puzzle Idea Queue
// ---------------------------------------------------------------------------

const BLOCKED_PROMPT_PATTERNS = [
  /\b(nsfw|nude|nudity|explicit|gore|blood|violence|weapon|hate|slur)\b/i,
];

const SEED_COMMUNITY_IDEAS: CommunityPuzzleIdea[] = [
  {
    id: 'idea_onsen_yuzu',
    title: 'Hot Spring Capybaras in Winter Snow',
    prompt: 'Cozy capybaras relaxing in a steaming cedar hot spring with floating yuzu citrus and falling snow, clean cel-shaded illustration',
    category: 'Animals',
    tags: ['Animals', 'Cozy', 'Nature'],
    authorName: 'River Capy',
    authorId: 'seed_1',
    votes: 24,
    votedByMe: false,
    status: 'curated',
    createdAt: 1730000000000,
  },
  {
    id: 'idea_clockwork_terrarium',
    title: 'Botanical Glass Terrarium',
    prompt: 'Detailed stained-glass style botanical terrarium filled with glowing ferns, succulents, and tiny snails, crisp ink line art',
    category: 'Coloring',
    tags: ['Coloring', 'Line Art', 'Nature'],
    authorName: 'Forest Sprout',
    authorId: 'seed_2',
    votes: 17,
    votedByMe: false,
    status: 'queued',
    createdAt: 1730100000000,
  },
];

class StaticAndCommunityCatalogAdapter implements CatalogStorageProvider {
  async getGalleryItems(): Promise<SampleArtwork[]> {
    return SAMPLE_GALLERY;
  }

  getCommunityIdeas(): CommunityPuzzleIdea[] {
    try {
      const raw = localStorage.getItem(resolveScopedStorageKey(COMMUNITY_IDEAS_STORAGE_KEY));
      if (raw) {
        const parsed = JSON.parse(raw) as CommunityPuzzleIdea[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.sort((a, b) => b.votes - a.votes || b.createdAt - a.createdAt);
        }
      }
    } catch {
      // Ignore
    }
    return [...SEED_COMMUNITY_IDEAS];
  }

  private saveIdeas(ideas: CommunityPuzzleIdea[]): void {
    try {
      localStorage.setItem(
        resolveScopedStorageKey(COMMUNITY_IDEAS_STORAGE_KEY),
        JSON.stringify(ideas)
      );
    } catch {
      // Ignore
    }
  }

  submitCommunityIdea(input: {
    title: string;
    prompt: string;
    category: string;
    tags?: string[];
    author: PlayerIdentity;
  }): { ok: true; idea: CommunityPuzzleIdea } | { ok: false; error: string } {
    const cleanTitle = input.title.trim().slice(0, 60);
    const cleanPrompt = input.prompt.trim().slice(0, 280);
    if (cleanTitle.length < 3) {
      return { ok: false, error: 'Please enter a puzzle title (at least 3 characters).' };
    }
    if (cleanPrompt.length < 10) {
      return { ok: false, error: 'Please describe your puzzle idea (at least 10 characters).' };
    }

    const combinedText = `${cleanTitle} ${cleanPrompt}`;
    for (const pattern of BLOCKED_PROMPT_PATTERNS) {
      if (pattern.test(combinedText)) {
        return {
          ok: false,
          error: 'Please keep community puzzle ideas family-friendly and suitable for all ages.',
        };
      }
    }

    const existing = this.getCommunityIdeas();
    const newIdea: CommunityPuzzleIdea = {
      id: `idea_${Date.now()}_${randomHexId(4)}`,
      title: cleanTitle,
      prompt: cleanPrompt,
      category: input.category || 'Community',
      tags: input.tags && input.tags.length > 0 ? input.tags : [input.category || 'Community'],
      authorName: input.author.displayName,
      authorId: input.author.playerId,
      votes: 1,
      votedByMe: true,
      status: 'queued',
      createdAt: Date.now(),
    };

    const updated = [newIdea, ...existing];
    this.saveIdeas(updated);
    return { ok: true, idea: newIdea };
  }

  toggleVoteIdea(ideaId: string): CommunityPuzzleIdea[] {
    const ideas = this.getCommunityIdeas().map((idea) => {
      if (idea.id !== ideaId) return idea;
      const nextVoted = !idea.votedByMe;
      return {
        ...idea,
        votedByMe: nextVoted,
        votes: Math.max(0, idea.votes + (nextVoted ? 1 : -1)),
      };
    });
    const sorted = ideas.sort((a, b) => b.votes - a.votes || b.createdAt - a.createdAt);
    this.saveIdeas(sorted);
    return sorted;
  }
}

// ---------------------------------------------------------------------------
// 5. AiArtworkProvider & MonetizationProvider (Seam-Locked Infinite Zoom + Opt-In Credits)
// ---------------------------------------------------------------------------

class DefaultAiArtworkAdapter implements AiArtworkProvider {
  readonly isConfigured = Boolean(
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_CAPY_AI_API_URL
  );

  estimateCreditCost(resolution: number, isInfiniteZoomInfill: boolean): number {
    if (isInfiniteZoomInfill) return 1;
    return resolution > 1280 ? 2 : 1;
  }

  buildSeamLockedInfillPrompt(spec: InfiniteZoomTileSpec): string {
    const paletteList = spec.lockedBoundaryPaletteHex.slice(0, 8).join(', ');
    return [
      `Seamless zoom-in detail sub-tile (depth ${spec.depth}, quadrant ${spec.quadrant + 1})`,
      spec.promptHint.trim() || 'clean color-by-number cel illustration with clear bounded regions',
      paletteList ? `locking outer border colors to [${paletteList}] for invisible parent tile seams` : '',
    ]
      .filter(Boolean)
      .join(', ');
  }
}

class ConsentRewardedAdAdapter implements MonetizationProvider {
  getLedger(): AiCreditLedger {
    const isDesktopOrWebAdFree = !NativeBridge.isAndroid;
    try {
      const raw = localStorage.getItem(resolveScopedStorageKey(AI_CREDITS_STORAGE_KEY));
      if (raw) {
        const parsed = JSON.parse(raw) as AiCreditLedger;
        return {
          ...parsed,
          adFreePlatform: isDesktopOrWebAdFree,
        };
      }
    } catch {
      // Ignore
    }
    return {
      availableCredits: 3, // Starter free AI generation credits
      lifetimeEarnedCredits: 3,
      lifetimeSpentCredits: 0,
      adFreePlatform: isDesktopOrWebAdFree,
      personalizedAdsConsent: false,
    };
  }

  private saveLedger(ledger: AiCreditLedger): void {
    try {
      localStorage.setItem(
        resolveScopedStorageKey(AI_CREDITS_STORAGE_KEY),
        JSON.stringify(ledger)
      );
    } catch {
      // Ignore
    }
  }

  setPersonalizedAdsConsent(consent: boolean): AiCreditLedger {
    const next = { ...this.getLedger(), personalizedAdsConsent: consent };
    this.saveLedger(next);
    return next;
  }

  async watchRewardedAdForCredits(): Promise<{ granted: number; ledger: AiCreditLedger }> {
    const current = this.getLedger();
    // Never show forced ads; only trigger native rewarded ad when explicitly requested on Android
    const shown = NativeBridge.showRewardedAd();
    const granted = shown ? 2 : 0;
    const next: AiCreditLedger = {
      ...current,
      availableCredits: current.availableCredits + granted,
      lifetimeEarnedCredits: current.lifetimeEarnedCredits + granted,
    };
    this.saveLedger(next);
    return { granted, ledger: next };
  }

  spendCredits(amount: number): boolean {
    const current = this.getLedger();
    if (amount <= 0) return true;
    if (current.availableCredits < amount) return false;
    this.saveLedger({
      ...current,
      availableCredits: current.availableCredits - amount,
      lifetimeSpentCredits: current.lifetimeSpentCredits + amount,
    });
    return true;
  }
}

// ---------------------------------------------------------------------------
// Singleton Provider Registry
// ---------------------------------------------------------------------------

const auth = new MultiProviderAuthManager();
const cloudSave = new CrdtCloudSaveAdapter(auth);
const realtimeRoom = new HybridCoopRoomAdapter();
const catalog = new StaticAndCommunityCatalogAdapter();
const aiArtwork = new DefaultAiArtworkAdapter();
const monetization = new ConsentRewardedAdAdapter();

export const ProviderRegistry = {
  auth,
  cloudSave,
  realtimeRoom,
  catalog,
  aiArtwork,
  monetization,
};
