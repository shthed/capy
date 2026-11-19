import { base64ToUint8, uint8ToBase64 } from '../CapyCodec';
import { NativeBridge } from '../NativeBridge';
import { isCloudCoopUiEnabled } from '../StorageNamespace';
import {
  attemptSilentOrOneTapGoogleSignIn,
  clearCachedGoogleSession,
  getAllowedMockGoogleOAuthToken,
  getConfiguredGoogleClientId,
  GoogleDriveAppDataClient,
  isExplicitlySignedOut,
  isValidGoogleDriveFileId,
  loadCachedGoogleSession,
  setConfiguredGoogleClientId,
  setExplicitlySignedOut,
  signInWithGoogleOAuthPopup,
} from './GoogleCloudSyncClient';
import {
  CloudLibraryManifestV2,
  CloudProviderDescriptor,
  CloudProviderDriver,
  CloudSaveEnvelope,
  PlayerIdentity,
} from './types';

export const CLOUD_MANIFEST_FILE_NAME = 'capy_cloud_manifest_v2.json';
export const CLOUD_MANIFEST_SLOT_KEY = 'capy_cloud_manifest_v2';

// ---------------------------------------------------------------------------
// 1. Google Cloud Driver (Google OAuth 2.0 + Google Drive appDataFolder REST API)
// ---------------------------------------------------------------------------

export class GoogleCloudDriver implements CloudProviderDriver {
  readonly id = 'google' as const;
  private cachedManifestFileId: string | undefined;
  private cachedSlotFileIds = new Map<string, string>();
  private cachedBlobFileIds = new Map<string, string>();
  private writeLocks = new Map<string, Promise<unknown>>();

  private enqueueWrite<T>(lockKey: string, task: () => Promise<T>): Promise<T> {
    const prev = this.writeLocks.get(lockKey) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(task);
    const tracked = next.catch(() => undefined).finally(() => {
      if (this.writeLocks.get(lockKey) === tracked) {
        this.writeLocks.delete(lockKey);
      }
    });
    this.writeLocks.set(lockKey, tracked);
    return next;
  }

  getDescriptor(): CloudProviderDescriptor {
    const clientId = getConfiguredGoogleClientId();
    const hasMock = Boolean(getAllowedMockGoogleOAuthToken());
    return {
      id: 'google',
      displayName: 'Google Account',
      storageName: 'Google Drive (appDataFolder)',
      isSupported: true,
      isConfigured: Boolean(clientId || hasMock),
    };
  }

  hasActiveSession(): boolean {
    return Boolean(loadCachedGoogleSession()?.accessToken);
  }

  restoreSession(): Partial<PlayerIdentity> | null {
    const session = loadCachedGoogleSession();
    if (!session) return null;
    return {
      playerId: `google_${session.sub}`,
      displayName: session.displayName,
      email: session.email,
      avatarUrl: session.picture,
      provider: 'google',
      isAuthenticated: true,
    };
  }

  async attemptAutoSignIn(): Promise<Partial<PlayerIdentity> | null> {
    if (isExplicitlySignedOut()) return null;
    const clientId = getConfiguredGoogleClientId();
    const session = await attemptSilentOrOneTapGoogleSignIn(clientId);
    if (!session) return null;
    return {
      playerId: `google_${session.sub}`,
      displayName: session.displayName.slice(0, 32),
      email: session.email,
      avatarUrl: session.picture,
      provider: 'google',
      isAuthenticated: true,
      lastSyncedAt: Date.now(),
    };
  }

  async signIn(options?: { clientId?: string }): Promise<Partial<PlayerIdentity>> {
    setExplicitlySignedOut(false);
    if (options?.clientId !== undefined) {
      setConfiguredGoogleClientId(options.clientId);
    }
    const clientId = options?.clientId?.trim() || getConfiguredGoogleClientId();
    const hasMock = Boolean(getAllowedMockGoogleOAuthToken());
    const session = await signInWithGoogleOAuthPopup(
      clientId || (hasMock ? 'capy_mock_client_id' : '')
    );
    return {
      playerId: `google_${session.sub}`,
      displayName: session.displayName.slice(0, 32),
      email: session.email,
      avatarUrl: session.picture,
      provider: 'google',
      isAuthenticated: true,
      lastSyncedAt: Date.now(),
    };
  }

  async signOut(): Promise<void> {
    this.cachedManifestFileId = undefined;
    this.cachedSlotFileIds.clear();
    this.cachedBlobFileIds.clear();
    this.writeLocks.clear();
    setExplicitlySignedOut(true);
    clearCachedGoogleSession();
  }

  async readManifest(): Promise<CloudLibraryManifestV2 | null> {
    const session = loadCachedGoogleSession();
    if (!session?.accessToken) return null;
    const fileMeta = await GoogleDriveAppDataClient.findFileByName(
      session.accessToken,
      CLOUD_MANIFEST_FILE_NAME
    );
    if (!fileMeta?.id) return null;
    this.cachedManifestFileId = fileMeta.id;
    return GoogleDriveAppDataClient.downloadJsonFile<CloudLibraryManifestV2>(
      session.accessToken,
      fileMeta.id
    );
  }

  async writeManifest(manifest: CloudLibraryManifestV2): Promise<boolean> {
    return this.enqueueWrite(`manifest:${CLOUD_MANIFEST_FILE_NAME}`, async () => {
      const session = loadCachedGoogleSession();
      if (!session?.accessToken) return false;
      if (!this.cachedManifestFileId) {
        const existing = await GoogleDriveAppDataClient.findFileByName(
          session.accessToken,
          CLOUD_MANIFEST_FILE_NAME
        );
        this.cachedManifestFileId = existing?.id;
      }
      const uploaded = await GoogleDriveAppDataClient.uploadJsonFile(
        session.accessToken,
        CLOUD_MANIFEST_FILE_NAME,
        { ...manifest, providerId: 'google' },
        this.cachedManifestFileId
      );
      this.cachedManifestFileId = uploaded.id;
      return true;
    });
  }

  async readSlotEnvelope(slotKey: string): Promise<CloudSaveEnvelope | null> {
    const session = loadCachedGoogleSession();
    if (!session?.accessToken) return null;
    const fileName = `capy_slot_${slotKey.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    const fileMeta = await GoogleDriveAppDataClient.findFileByName(
      session.accessToken,
      fileName
    );
    if (!fileMeta?.id) return null;
    this.cachedSlotFileIds.set(fileName, fileMeta.id);
    return GoogleDriveAppDataClient.downloadJsonFile<CloudSaveEnvelope>(
      session.accessToken,
      fileMeta.id
    );
  }

  async writeSlotEnvelope(envelope: CloudSaveEnvelope): Promise<boolean> {
    const fileName = `capy_slot_${envelope.slotKey.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    return this.enqueueWrite(`slot:${fileName}`, async () => {
      const session = loadCachedGoogleSession();
      if (!session?.accessToken) return false;
      let existingFileId = this.cachedSlotFileIds.get(fileName);
      if (!existingFileId) {
        const existing = await GoogleDriveAppDataClient.findFileByName(
          session.accessToken,
          fileName
        );
        existingFileId = existing?.id;
        if (existingFileId) {
          this.cachedSlotFileIds.set(fileName, existingFileId);
        }
      }
      const uploaded = await GoogleDriveAppDataClient.uploadJsonFile(
        session.accessToken,
        fileName,
        envelope,
        existingFileId
      );
      if (uploaded?.id) {
        this.cachedSlotFileIds.set(fileName, uploaded.id);
      }
      return true;
    });
  }

  async readBinaryBlob(blobRef: string): Promise<Uint8Array | null> {
    const session = loadCachedGoogleSession();
    const cleanRef = typeof blobRef === 'string' ? blobRef.trim() : '';
    if (!session?.accessToken || !isValidGoogleDriveFileId(cleanRef)) {
      return null;
    }
    return GoogleDriveAppDataClient.downloadBinaryFile(session.accessToken, cleanRef);
  }

  async writeBinaryBlob(
    _slotKey: string,
    fileName: string,
    bytes: Uint8Array
  ): Promise<string | null> {
    return this.enqueueWrite(`blob:${fileName}`, async () => {
      const session = loadCachedGoogleSession();
      if (!session?.accessToken) return null;
      let existingFileId = this.cachedBlobFileIds.get(fileName);
      if (!existingFileId) {
        const existing = await GoogleDriveAppDataClient.findFileByName(
          session.accessToken,
          fileName
        );
        existingFileId = existing?.id;
        if (existingFileId) {
          this.cachedBlobFileIds.set(fileName, existingFileId);
        }
      }
      const uploaded = await GoogleDriveAppDataClient.uploadBinaryFile(
        session.accessToken,
        fileName,
        bytes,
        existingFileId
      );
      if (uploaded?.id) {
        this.cachedBlobFileIds.set(fileName, uploaded.id);
      }
      return uploaded.id;
    });
  }
}

// ---------------------------------------------------------------------------
// 2. Android Google Play Games Services v2 Driver (GamesSignIn + SnapshotsClient)
// ---------------------------------------------------------------------------

export class PlayGamesAndroidDriver implements CloudProviderDriver {
  readonly id = 'play_games_v2' as const;
  private activeProfile: { playerId: string; displayName: string } | null = null;

  getDescriptor(): CloudProviderDescriptor {
    return {
      id: 'play_games_v2',
      displayName: 'Google Play Games',
      storageName: 'Google Play Games Saved Games (SnapshotsClient)',
      isSupported: NativeBridge.isAndroid,
      isConfigured: NativeBridge.isAndroid && NativeBridge.isPlayGamesConfigured(),
    };
  }

  setResolvedProfile(playerId: string, displayName: string): void {
    this.activeProfile = { playerId, displayName };
  }

  hasActiveSession(): boolean {
    return NativeBridge.isAndroid && Boolean(this.activeProfile);
  }

  restoreSession(): Partial<PlayerIdentity> | null {
    if (!NativeBridge.isAndroid || !this.activeProfile) return null;
    return {
      playerId: this.activeProfile.playerId,
      displayName: this.activeProfile.displayName,
      provider: 'play_games_v2',
      isAuthenticated: true,
    };
  }

  async attemptAutoSignIn(): Promise<Partial<PlayerIdentity> | null> {
    if (!NativeBridge.isAndroid || isExplicitlySignedOut()) return null;
    if (this.activeProfile) {
      return {
        playerId: this.activeProfile.playerId,
        displayName: this.activeProfile.displayName,
        provider: 'play_games_v2',
        isAuthenticated: true,
        lastSyncedAt: Date.now(),
      };
    }
    if (!isCloudCoopUiEnabled() || !NativeBridge.isPlayGamesConfigured()) {
      return this.restoreSession();
    }
    return new Promise<Partial<PlayerIdentity> | null>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let unsubProfile: () => void = () => {};
      let unsubError: () => void = () => {};
      const cleanup = () => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        unsubProfile();
        unsubError();
      };
      const finishProfile = (profile: { playerId: string; displayName: string }) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.activeProfile = profile;
        resolve({
          playerId: profile.playerId,
          displayName: profile.displayName,
          provider: 'play_games_v2',
          isAuthenticated: true,
          lastSyncedAt: Date.now(),
        });
      };
      const finishNull = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(null);
      };

      unsubProfile = NativeBridge.onPlayGamesProfile(
        (profile) => {
          if (settled) return false;
          finishProfile(profile);
          return true;
        },
        { once: true }
      );
      if (settled) {
        unsubProfile();
        cleanup();
        return;
      }
      unsubError = NativeBridge.onPlayGamesError(
        () => {
          if (settled) return false;
          finishNull();
          return true;
        },
        { once: true }
      );
      if (settled) {
        unsubError();
        cleanup();
        return;
      }

      let immediate: { playerId: string; displayName: string } | null = null;
      try {
        immediate = NativeBridge.signInPlayGames();
      } catch {
        immediate = null;
      }
      if (settled) {
        cleanup();
        return;
      }
      if (immediate) {
        finishProfile(immediate);
        return;
      }

      timer = setTimeout(() => {
        finishNull();
      }, 4500);
    });
  }

  async signIn(): Promise<Partial<PlayerIdentity>> {
    setExplicitlySignedOut(false);
    if (!NativeBridge.isAndroid) {
      throw new Error('PLAY_GAMES_UNCONFIGURED');
    }
    // Wait up to 8 seconds for the native Play Games interactive signIn() callback or immediate error
    const outcome = await new Promise<
      | { ok: true; profile: { playerId: string; displayName: string } }
      | { ok: false; error: string }
    >((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let unsubProfile: () => void = () => {};
      let unsubError: () => void = () => {};
      const cleanup = () => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        unsubProfile();
        unsubError();
      };
      const finish = (
        result:
          | { ok: true; profile: { playerId: string; displayName: string } }
          | { ok: false; error: string }
      ) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      unsubProfile = NativeBridge.onPlayGamesProfile(
        (profile) => {
          if (settled) return false;
          finish({ ok: true, profile });
          return true;
        },
        { once: true }
      );
      if (settled) {
        unsubProfile();
        cleanup();
        return;
      }
      unsubError = NativeBridge.onPlayGamesError(
        (reason) => {
          if (settled) return false;
          finish({ ok: false, error: reason || 'PLAY_GAMES_UNAVAILABLE' });
          return true;
        },
        { once: true }
      );
      if (settled) {
        unsubError();
        cleanup();
        return;
      }

      let immediate: { playerId: string; displayName: string } | null = null;
      try {
        immediate = NativeBridge.signInPlayGames();
      } catch {
        immediate = null;
      }
      if (settled) {
        cleanup();
        return;
      }
      if (immediate) {
        finish({ ok: true, profile: immediate });
        return;
      }
      if (!NativeBridge.isPlayGamesConfigured()) {
        finish({ ok: false, error: 'PLAY_GAMES_UNCONFIGURED' });
        return;
      }

      timer = setTimeout(() => {
        finish({ ok: false, error: 'PLAY_GAMES_UNCONFIGURED' });
      }, 8000);
    });
    if (!outcome.ok) {
      throw new Error(outcome.error);
    }
    this.activeProfile = outcome.profile;
    return {
      playerId: outcome.profile.playerId,
      displayName: outcome.profile.displayName,
      provider: 'play_games_v2',
      isAuthenticated: true,
      lastSyncedAt: Date.now(),
    };
  }

  async signOut(): Promise<void> {
    this.activeProfile = null;
    setExplicitlySignedOut(true);
  }

  async readManifest(): Promise<CloudLibraryManifestV2 | null> {
    const raw = NativeBridge.loadCloudSnapshot(CLOUD_MANIFEST_SLOT_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as CloudLibraryManifestV2;
      if (
        parsed &&
        typeof parsed === 'object' &&
        parsed.version === 2 &&
        parsed.entries &&
        typeof parsed.entries === 'object' &&
        !Array.isArray(parsed.entries)
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  async writeManifest(manifest: CloudLibraryManifestV2): Promise<boolean> {
    return NativeBridge.saveCloudSnapshot(
      CLOUD_MANIFEST_SLOT_KEY,
      JSON.stringify({ ...manifest, providerId: 'play_games_v2' })
    );
  }

  async readSlotEnvelope(slotKey: string): Promise<CloudSaveEnvelope | null> {
    const raw = NativeBridge.loadCloudSnapshot(slotKey);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as CloudSaveEnvelope;
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof parsed.slotKey === 'string' &&
        typeof parsed.deltaToken === 'string'
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  async writeSlotEnvelope(envelope: CloudSaveEnvelope): Promise<boolean> {
    return NativeBridge.saveCloudSnapshot(envelope.slotKey, JSON.stringify(envelope));
  }

  async readBinaryBlob(blobRef: string): Promise<Uint8Array | null> {
    if (!blobRef || typeof blobRef !== 'string') return null;
    const match = /^pgblob:([a-zA-Z0-9._-]+):(\d+):(\d+)$/.exec(blobRef.trim());
    if (!match) return null;

    const safeBlobKey = match[1];
    if (
      !safeBlobKey.startsWith('pgblob_') ||
      safeBlobKey.length <= 'pgblob_'.length ||
      safeBlobKey === '.' ||
      safeBlobKey === '..' ||
      safeBlobKey.includes('..')
    ) {
      return null;
    }
    const totalChunks = Number(match[2]);
    const expectedBytes = Number(match[3]);
    if (
      !Number.isInteger(totalChunks) ||
      totalChunks < 1 ||
      totalChunks > MAX_PLAY_GAMES_BINARY_CHUNKS ||
      !Number.isInteger(expectedBytes) ||
      expectedBytes < 1 ||
      expectedBytes > MAX_PLAY_GAMES_BINARY_BYTES
    ) {
      return null;
    }

    const chunkPayloads = new Array<string | null>(totalChunks).fill(null);
    const missingIndices: number[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const localChunk = NativeBridge.loadCloudBinaryChunk(safeBlobKey, i);
      if (localChunk) {
        chunkPayloads[i] = localChunk;
      } else {
        missingIndices.push(i);
      }
    }

    if (missingIndices.length > 0) {
      const slotToIdx = new Map<string, number>();
      const remainingMissing = new Set<number>(missingIndices);
      for (const idx of missingIndices) {
        slotToIdx.set(`${safeBlobKey}_part_${idx}`, idx);
      }

      NativeBridge.clearAbortedCloudPulls(slotToIdx.keys());
      const pendingPullSlots = new Set<string>();

      const pulledOk = await new Promise<boolean>((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let unsubSnap: () => void = () => {};
        let unsubErr: () => void = () => {};
        const cleanup = () => {
          if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }
          unsubSnap();
          unsubErr();
        };
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (pendingPullSlots.size > 0) {
            NativeBridge.discardAbortedCloudPulls(pendingPullSlots);
            pendingPullSlots.clear();
          }
          resolve(ok);
        };

        unsubSnap = NativeBridge.onCloudSnapshot(
          (slot, payload) => {
            if (settled) return false;
            const idx = slotToIdx.get(slot);
            if (idx === undefined) return false;
            pendingPullSlots.delete(slot);
            if (!payload) {
              finish(false);
              return true;
            }
            chunkPayloads[idx] = payload;
            remainingMissing.delete(idx);
            if (remainingMissing.size === 0) {
              finish(true);
            }
            return true;
          },
          { slotFilter: (slot) => slotToIdx.has(slot) }
        );
        if (settled) {
          unsubSnap();
          cleanup();
          return;
        }

        unsubErr = NativeBridge.onCloudSnapshotError(
          (slot) => {
            if (settled) return false;
            if (!slotToIdx.has(slot)) return false;
            pendingPullSlots.delete(slot);
            finish(false);
            return true;
          },
          { slotFilter: (slot) => slotToIdx.has(slot), once: true }
        );
        if (settled) {
          unsubErr();
          cleanup();
          return;
        }

        for (const idx of [...remainingMissing]) {
          if (settled) break;
          if (!remainingMissing.has(idx)) continue;
          const partSlot = `${safeBlobKey}_part_${idx}`;
          pendingPullSlots.add(partSlot);
          let pullStarted = false;
          try {
            pullStarted = NativeBridge.requestCloudSnapshotPull(partSlot);
          } catch {
            pullStarted = false;
          }
          if (settled) break;
          if (!pullStarted) {
            pendingPullSlots.delete(partSlot);
            const diskFallback = NativeBridge.loadCloudBinaryChunk(safeBlobKey, idx);
            if (diskFallback) {
              chunkPayloads[idx] = diskFallback;
              remainingMissing.delete(idx);
            } else {
              finish(false);
              break;
            }
          }
        }

        if (settled) {
          cleanup();
          return;
        }
        if (remainingMissing.size === 0) {
          finish(true);
          return;
        }

        timer = setTimeout(() => {
          for (const idx of [...remainingMissing]) {
            const diskFallback = NativeBridge.loadCloudBinaryChunk(safeBlobKey, idx);
            if (diskFallback) {
              chunkPayloads[idx] = diskFallback;
              remainingMissing.delete(idx);
            }
          }
          finish(remainingMissing.size === 0);
        }, 1500);
      });

      if (!pulledOk) {
        return null;
      }
    }

    const assembled = new Uint8Array(expectedBytes);
    let writeOffset = 0;

    for (let i = 0; i < totalChunks; i++) {
      const chunkB64 = chunkPayloads[i];
      if (!chunkB64) return null;

      let partBytes: Uint8Array;
      try {
        partBytes = base64ToUint8(chunkB64);
      } catch {
        return null;
      }
      if (partBytes.byteLength === 0 || writeOffset + partBytes.byteLength > expectedBytes) {
        return null;
      }
      assembled.set(partBytes, writeOffset);
      writeOffset += partBytes.byteLength;
    }

    return writeOffset === expectedBytes ? assembled : null;
  }

  async writeBinaryBlob(
    slotKey: string,
    _fileName: string,
    bytes: Uint8Array
  ): Promise<string | null> {
    if (
      typeof slotKey !== 'string' ||
      !bytes ||
      bytes.byteLength === 0 ||
      bytes.byteLength > MAX_PLAY_GAMES_BINARY_BYTES
    ) {
      return null;
    }
    const trimmedSlot = slotKey.trim();
    if (!trimmedSlot || trimmedSlot === '.' || trimmedSlot === '..' || trimmedSlot.includes('..')) {
      return null;
    }
    const cleanSlot = trimmedSlot.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || 'custom_save';
    const safeBlobKey = `pgblob_${cleanSlot}`;
    if (
      cleanSlot === '.' ||
      cleanSlot === '..' ||
      cleanSlot.includes('..') ||
      safeBlobKey === '.' ||
      safeBlobKey === '..' ||
      safeBlobKey.includes('..')
    ) {
      return null;
    }
    const totalChunks = Math.ceil(bytes.byteLength / PLAY_GAMES_BINARY_CHUNK_BYTES);
    if (totalChunks < 1 || totalChunks > MAX_PLAY_GAMES_BINARY_CHUNKS) {
      return null;
    }

    for (let i = 0; i < totalChunks; i++) {
      const start = i * PLAY_GAMES_BINARY_CHUNK_BYTES;
      const end = Math.min(bytes.byteLength, start + PLAY_GAMES_BINARY_CHUNK_BYTES);
      const chunkB64 = uint8ToBase64(bytes.subarray(start, end));
      const saved = NativeBridge.saveCloudBinaryChunk(safeBlobKey, i, totalChunks, chunkB64);
      if (!saved) {
        return null;
      }
    }

    return `pgblob:${safeBlobKey}:${totalChunks}:${bytes.byteLength}`;
  }
}

export const PLAY_GAMES_BINARY_CHUNK_BYTES = 180_000;
export const MAX_PLAY_GAMES_BINARY_BYTES = 3 * 1024 * 1024;
export const MAX_PLAY_GAMES_BINARY_CHUNKS = 32;

// ---------------------------------------------------------------------------
// 3. Extensible Future Platform Drivers (Steam, Microsoft/Xbox, Apple/iCloud)
// ---------------------------------------------------------------------------

/**
 * Steamworks Cloud Driver (`ISteamUser` + `ISteamRemoteStorage`) for future Tauri Desktop builds.
 */
export class SteamCloudDriver implements CloudProviderDriver {
  readonly id = 'steam' as const;

  getDescriptor(): CloudProviderDescriptor {
    const hasSteamBridge =
      typeof window !== 'undefined' &&
      Boolean((window as unknown as { __capySteamBridge?: unknown }).__capySteamBridge);
    return {
      id: 'steam',
      displayName: 'Steam Cloud',
      storageName: 'Steamworks ISteamRemoteStorage',
      isSupported: hasSteamBridge,
      isConfigured: hasSteamBridge,
      comingSoon: !hasSteamBridge,
    };
  }

  hasActiveSession(): boolean {
    return false;
  }

  restoreSession(): Partial<PlayerIdentity> | null {
    return null;
  }

  async attemptAutoSignIn(): Promise<Partial<PlayerIdentity> | null> {
    return null;
  }

  async signIn(): Promise<Partial<PlayerIdentity>> {
    throw new Error('Steam Cloud sign-in requires the Capy Desktop (Steamworks) runtime.');
  }

  async signOut(): Promise<void> {}
  async readManifest(): Promise<CloudLibraryManifestV2 | null> {
    return null;
  }
  async writeManifest(): Promise<boolean> {
    return false;
  }
  async readSlotEnvelope(): Promise<CloudSaveEnvelope | null> {
    return null;
  }
  async writeSlotEnvelope(): Promise<boolean> {
    return false;
  }
  async readBinaryBlob(): Promise<Uint8Array | null> {
    return null;
  }
  async writeBinaryBlob(): Promise<string | null> {
    return null;
  }
}

/**
 * Microsoft / Xbox Cloud Driver (MSAL OAuth 2.0 + OneDrive Special `approot` / Xbox Connected Storage).
 */
export class MicrosoftCloudDriver implements CloudProviderDriver {
  readonly id = 'microsoft' as const;

  getDescriptor(): CloudProviderDescriptor {
    return {
      id: 'microsoft',
      displayName: 'Microsoft / Xbox',
      storageName: 'OneDrive AppFolder & Xbox Cloud',
      isSupported: false,
      isConfigured: false,
      comingSoon: true,
    };
  }

  hasActiveSession(): boolean {
    return false;
  }

  restoreSession(): Partial<PlayerIdentity> | null {
    return null;
  }

  async attemptAutoSignIn(): Promise<Partial<PlayerIdentity> | null> {
    return null;
  }

  async signIn(): Promise<Partial<PlayerIdentity>> {
    throw new Error('Microsoft / Xbox Cloud sync is coming in a future update.');
  }

  async signOut(): Promise<void> {}
  async readManifest(): Promise<CloudLibraryManifestV2 | null> {
    return null;
  }
  async writeManifest(): Promise<boolean> {
    return false;
  }
  async readSlotEnvelope(): Promise<CloudSaveEnvelope | null> {
    return null;
  }
  async writeSlotEnvelope(): Promise<boolean> {
    return false;
  }
  async readBinaryBlob(): Promise<Uint8Array | null> {
    return null;
  }
  async writeBinaryBlob(): Promise<string | null> {
    return null;
  }
}

/**
 * Apple / Game Center Cloud Driver (Sign in with Apple + CloudKit / iCloud Key-Value Store).
 */
export class AppleCloudDriver implements CloudProviderDriver {
  readonly id = 'apple' as const;

  getDescriptor(): CloudProviderDescriptor {
    const isIosShell = NativeBridge.platform === 'ios';
    return {
      id: 'apple',
      displayName: 'Apple / iCloud',
      storageName: 'iCloud & Game Center CloudKit',
      isSupported: isIosShell,
      isConfigured: false,
      comingSoon: true,
    };
  }

  hasActiveSession(): boolean {
    return false;
  }

  restoreSession(): Partial<PlayerIdentity> | null {
    return null;
  }

  async attemptAutoSignIn(): Promise<Partial<PlayerIdentity> | null> {
    return null;
  }

  async signIn(): Promise<Partial<PlayerIdentity>> {
    throw new Error('Apple / iCloud sync is coming in a future update.');
  }

  async signOut(): Promise<void> {}
  async readManifest(): Promise<CloudLibraryManifestV2 | null> {
    return null;
  }
  async writeManifest(): Promise<boolean> {
    return false;
  }
  async readSlotEnvelope(): Promise<CloudSaveEnvelope | null> {
    return null;
  }
  async writeSlotEnvelope(): Promise<boolean> {
    return false;
  }
  async readBinaryBlob(): Promise<Uint8Array | null> {
    return null;
  }
  async writeBinaryBlob(): Promise<string | null> {
    return null;
  }
}
