import { NativeBridge } from '../NativeBridge';
import {
  clearCachedGoogleSession,
  getConfiguredGoogleClientId,
  GoogleDriveAppDataClient,
  loadCachedGoogleSession,
  setConfiguredGoogleClientId,
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

  getDescriptor(): CloudProviderDescriptor {
    const clientId = getConfiguredGoogleClientId();
    const hasMock =
      typeof window !== 'undefined' && Boolean(window.__capyMockGoogleOAuthToken);
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

  async signIn(options?: { clientId?: string }): Promise<Partial<PlayerIdentity>> {
    if (options?.clientId !== undefined) {
      setConfiguredGoogleClientId(options.clientId);
    }
    const clientId = options?.clientId?.trim() || getConfiguredGoogleClientId();
    const hasMock =
      typeof window !== 'undefined' && Boolean(window.__capyMockGoogleOAuthToken);
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
    return GoogleDriveAppDataClient.downloadJsonFile<CloudSaveEnvelope>(
      session.accessToken,
      fileMeta.id
    );
  }

  async writeSlotEnvelope(envelope: CloudSaveEnvelope): Promise<boolean> {
    const session = loadCachedGoogleSession();
    if (!session?.accessToken) return false;
    const fileName = `capy_slot_${envelope.slotKey.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    const existing = await GoogleDriveAppDataClient.findFileByName(
      session.accessToken,
      fileName
    );
    await GoogleDriveAppDataClient.uploadJsonFile(
      session.accessToken,
      fileName,
      envelope,
      existing?.id
    );
    return true;
  }

  async readBinaryBlob(blobRef: string): Promise<Uint8Array | null> {
    const session = loadCachedGoogleSession();
    if (!session?.accessToken || !blobRef) return null;
    return GoogleDriveAppDataClient.downloadBinaryFile(session.accessToken, blobRef);
  }

  async writeBinaryBlob(
    _slotKey: string,
    fileName: string,
    bytes: Uint8Array
  ): Promise<string | null> {
    const session = loadCachedGoogleSession();
    if (!session?.accessToken) return null;
    const existing = await GoogleDriveAppDataClient.findFileByName(
      session.accessToken,
      fileName
    );
    const uploaded = await GoogleDriveAppDataClient.uploadBinaryFile(
      session.accessToken,
      fileName,
      bytes,
      existing?.id
    );
    return uploaded.id;
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
      isConfigured: NativeBridge.isAndroid,
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

  async signIn(): Promise<Partial<PlayerIdentity>> {
    const res = NativeBridge.signInPlayGames();
    if (!res) {
      throw new Error('PLAY_GAMES_UNCONFIGURED');
    }
    this.activeProfile = res;
    return {
      playerId: res.playerId,
      displayName: res.displayName,
      provider: 'play_games_v2',
      isAuthenticated: true,
      lastSyncedAt: Date.now(),
    };
  }

  async signOut(): Promise<void> {
    this.activeProfile = null;
  }

  async readManifest(): Promise<CloudLibraryManifestV2 | null> {
    const raw = NativeBridge.loadCloudSnapshot(CLOUD_MANIFEST_SLOT_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CloudLibraryManifestV2;
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
      return JSON.parse(raw) as CloudSaveEnvelope;
    } catch {
      return null;
    }
  }

  async writeSlotEnvelope(envelope: CloudSaveEnvelope): Promise<boolean> {
    return NativeBridge.saveCloudSnapshot(envelope.slotKey, JSON.stringify(envelope));
  }

  async readBinaryBlob(): Promise<Uint8Array | null> {
    // Play Games Snapshots embeds compact binary saves via inlineBinaryB64 inside the manifest
    return null;
  }

  async writeBinaryBlob(): Promise<string | null> {
    return null;
  }
}

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
