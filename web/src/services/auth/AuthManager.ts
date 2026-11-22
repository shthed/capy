import { NativeBridge } from '../NativeBridge';
import { SafeLocalStore } from '../storage/SafeLocalStore';
import {
  IDENTITY_STORAGE_KEY,
  resolveScopedStorageKey,
  TAB_SESSION_SUFFIX_KEY,
} from '../storage/StorageKeys';
import { reportSwallowed } from '../telemetry';
import {
  AppleCloudDriver,
  GoogleCloudDriver,
  MicrosoftCloudDriver,
  PlayGamesAndroidDriver,
  SteamCloudDriver,
} from '../providers/CloudProviderDrivers';
import {
  getAllowedMockGoogleOAuthToken,
  getConfiguredGoogleClientId,
  isExplicitlySignedOut,
  onGoogleSessionInvalidated,
  setConfiguredGoogleClientId,
} from '../providers/GoogleCloudSyncClient';
import {
  AuthProvider,
  CloudProviderDescriptor,
  CloudProviderDriver,
  CloudProviderId,
  PlayerIdentity,
} from '../providers/types';

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

export function randomHexId(len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function getTabPeerSuffix(): string {
  if (typeof sessionStorage === 'undefined') return 't0';
  try {
    const scopedKey = resolveScopedStorageKey(TAB_SESSION_SUFFIX_KEY);
    let suffix = sessionStorage.getItem(scopedKey);
    if (!suffix) {
      suffix = randomHexId(4);
      sessionStorage.setItem(scopedKey, suffix);
    }
    return suffix;
  } catch (err) {
    reportSwallowed('AuthManager.getTabPeerSuffix', err);
    return randomHexId(4);
  }
}

export class MultiProviderAuthManager implements AuthProvider {
  private readonly drivers = new Map<CloudProviderId, CloudProviderDriver>();
  private readonly googleDriver: GoogleCloudDriver;
  private readonly playGamesDriver: PlayGamesAndroidDriver;
  private identity: PlayerIdentity;
  private listeners = new Set<(id: PlayerIdentity) => void>();
  private signOutListeners = new Set<(previousIdentity: PlayerIdentity) => void>();
  private playGamesListenerAttached = false;

  constructor() {
    this.googleDriver = new GoogleCloudDriver();
    this.playGamesDriver = new PlayGamesAndroidDriver();
    this.registerDriver(this.googleDriver);
    this.registerDriver(this.playGamesDriver);
    this.registerDriver(new SteamCloudDriver());
    this.registerDriver(new MicrosoftCloudDriver());
    this.registerDriver(new AppleCloudDriver());

    this.identity = this.loadOrCreateIdentity();
    this.ensurePlayGamesProfileListener();

    onGoogleSessionInvalidated(() => {
      this.handleProviderSessionInvalidated('google');
    });
  }

  private ensurePlayGamesProfileListener(): void {
    if (this.playGamesListenerAttached || typeof window === 'undefined') return;
    this.playGamesListenerAttached = true;
    NativeBridge.onPlayGamesProfile((profile) => {
      if (isExplicitlySignedOut()) return;
      this.playGamesDriver.setResolvedProfile(profile.playerId, profile.displayName);
      this.applyPlayGamesProfile(profile.playerId, profile.displayName);
    });
  }

  private notifySignOutListeners(previousIdentity: PlayerIdentity): void {
    for (const listener of this.signOutListeners) {
      try {
        listener(previousIdentity);
      } catch (err) {
        reportSwallowed('AuthManager.signOutListener', err);
      }
    }
  }

  private handleAccountSwitchIfNeeded(nextPlayerId: string): void {
    if (
      this.identity.isAuthenticated &&
      this.identity.playerId &&
      nextPlayerId &&
      this.identity.playerId !== nextPlayerId
    ) {
      this.notifySignOutListeners({ ...this.identity });
    }
  }

  private handleProviderSessionInvalidated(providerId: CloudProviderId): void {
    if (providerId === 'google') {
      this.googleDriver.clearFileIdCaches();
    }
    if (!this.identity.isAuthenticated || this.identity.provider !== providerId) {
      return;
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
    this.handleAccountSwitchIfNeeded(cleanId);
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
      const raw = SafeLocalStore.getScopedItem(IDENTITY_STORAGE_KEY);
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
    } catch (err) {
      reportSwallowed('AuthManager.loadIdentity', err);
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
      SafeLocalStore.setScopedItem(IDENTITY_STORAGE_KEY, JSON.stringify(stored));
    } catch (err) {
      reportSwallowed('AuthManager.persistBaseIdentity', err);
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
    const sanitized = displayName.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 24);
    const trimmed = sanitized || this.identity.displayName;
    const safeColor =
      avatarColorHex && /^#[0-9a-fA-F]{3,8}$/.test(avatarColorHex.trim())
        ? avatarColorHex.trim()
        : this.identity.avatarColorHex;
    this.identity = {
      ...this.identity,
      displayName: trimmed,
      avatarColorHex: safeColor,
    };
    this.persistBaseIdentity(this.identity);
    this.emit();
    return this.identity;
  }

  async attemptAutoSignIn(): Promise<PlayerIdentity | null> {
    this.ensurePlayGamesProfileListener();
    if (this.identity.isAuthenticated && this.hasActiveCloudToken()) {
      return this.identity;
    }

    const hasMockGoogleToken = Boolean(getAllowedMockGoogleOAuthToken());
    const orderedProviderIds: CloudProviderId[] = NativeBridge.isAndroid
      ? hasMockGoogleToken
        ? ['play_games_v2', 'google', 'microsoft']
        : ['play_games_v2', 'microsoft']
      : ['google', 'microsoft', 'apple', 'steam'];

    for (const providerId of orderedProviderIds) {
      const driver = this.drivers.get(providerId);
      if (!driver) continue;
      try {
        const partial = await driver.attemptAutoSignIn();
        if (partial && partial.playerId && partial.displayName) {
          this.handleAccountSwitchIfNeeded(partial.playerId);
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
      } catch (err) {
        reportSwallowed('AuthManager.attemptAutoSignIn', err, { provider: driver.id });
      }
    }
    return null;
  }

  async signInWithProvider(
    providerId: CloudProviderId,
    options?: { clientId?: string }
  ): Promise<PlayerIdentity> {
    this.ensurePlayGamesProfileListener();
    const driver = this.drivers.get(providerId);
    if (!driver) {
      throw new Error(`Unsupported cloud provider: ${providerId}`);
    }
    const partial = await driver.signIn(options);
    const nextPlayerId = partial.playerId || this.identity.playerId;
    this.handleAccountSwitchIfNeeded(nextPlayerId);
    this.identity = {
      ...this.identity,
      ...partial,
      playerId: nextPlayerId,
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
    const hasMockToken = Boolean(getAllowedMockGoogleOAuthToken());

    if (NativeBridge.isAndroid && !hasMockToken) {
      return this.signInWithProvider('play_games_v2');
    }
    return this.signInWithProvider('google', { clientId });
  }

  async signInWithPlayGames(): Promise<PlayerIdentity> {
    this.ensurePlayGamesProfileListener();
    if (NativeBridge.isAndroid) {
      return this.signInWithProvider('play_games_v2');
    }
    return this.signInWithGoogle();
  }

  onSignOut(listener: (previousIdentity: PlayerIdentity) => void): () => void {
    this.signOutListeners.add(listener);
    return () => {
      this.signOutListeners.delete(listener);
    };
  }

  async signOut(): Promise<PlayerIdentity> {
    const previousIdentity: PlayerIdentity = { ...this.identity };
    this.notifySignOutListeners(previousIdentity);

    for (const driver of this.drivers.values()) {
      await driver.signOut().catch((err) => {
        reportSwallowed('AuthManager.driverSignOut', err, { provider: driver.id });
      });
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
    this.ensurePlayGamesProfileListener();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export { MultiProviderAuthManager as AuthManager };
