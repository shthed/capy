import { GeneratorConfig, PuzzleSourceRef, SampleArtwork, SavedSnapshot } from '../../types';
import { ProgressDeltaV2 } from '../CapyCodec';

export type CloudProviderId =
  | 'google'
  | 'play_games_v2'
  | 'steam'
  | 'microsoft'
  | 'apple';

export type AuthProviderKind = 'guest' | CloudProviderId | 'oidc';

export interface CloudProviderDescriptor {
  id: CloudProviderId;
  displayName: string;
  storageName: string;
  isSupported: boolean;
  isConfigured: boolean;
  comingSoon?: boolean;
}

/**
 * Modular, provider-agnostic Cloud Identity & Storage Driver contract.
 * Each platform (Google Drive appDataFolder, Android Play Games SnapshotsClient,
 * Steam RemoteStorage, Microsoft OneDrive approot / Xbox, Apple CloudKit / Game Center)
 * implements this interface so the CRDT sync engine remains 100% platform-independent.
 */
export interface CloudProviderDriver {
  readonly id: CloudProviderId;
  getDescriptor(): CloudProviderDescriptor;
  hasActiveSession(): boolean;
  restoreSession(): Partial<PlayerIdentity> | null;
  attemptAutoSignIn(): Promise<Partial<PlayerIdentity> | null>;
  signIn(options?: { clientId?: string }): Promise<Partial<PlayerIdentity>>;
  signOut(): Promise<void>;
  readManifest(): Promise<CloudLibraryManifestV2 | null>;
  writeManifest(manifest: CloudLibraryManifestV2): Promise<boolean>;
  readSlotEnvelope(slotKey: string): Promise<CloudSaveEnvelope | null>;
  writeSlotEnvelope(envelope: CloudSaveEnvelope): Promise<boolean>;
  readBinaryBlob(blobRef: string): Promise<Uint8Array | null>;
  writeBinaryBlob(slotKey: string, fileName: string, bytes: Uint8Array): Promise<string | null>;
}

export interface PlayerIdentity {
  playerId: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  avatarColorHex: string;
  provider: AuthProviderKind;
  isAuthenticated: boolean;
  lastSyncedAt?: number;
}

export interface AuthProvider {
  getCurrentIdentity(): PlayerIdentity;
  updateGuestProfile(displayName: string, avatarColorHex?: string): PlayerIdentity;
  getAvailableCloudProviders(): CloudProviderDescriptor[];
  getCloudDriver(providerId: CloudProviderId): CloudProviderDriver | undefined;
  getActiveCloudDriver(): CloudProviderDriver | null;
  getGoogleClientId(): string;
  setGoogleClientId(clientId: string): void;
  hasActiveCloudToken(): boolean;
  attemptAutoSignIn(): Promise<PlayerIdentity | null>;
  signInWithProvider(
    providerId: CloudProviderId,
    options?: { clientId?: string }
  ): Promise<PlayerIdentity>;
  signInWithGoogle(customClientId?: string): Promise<PlayerIdentity>;
  signInWithPlayGames(): Promise<PlayerIdentity>;
  signOut(): Promise<PlayerIdentity>;
  subscribe(listener: (identity: PlayerIdentity) => void): () => void;
}

export interface CloudSaveEnvelope {
  slotKey: string;
  title: string;
  deltaToken: string;
  filledCount: number;
  totalCount: number;
  updatedAt: number;
  devicePlayerId: string;
}

export interface CloudSaveEntryV2 {
  snapshotId: string;
  slotKey: string;
  title: string;
  createdAt: number;
  lastOpened: number;
  isPinned?: boolean;
  filledCount: number;
  totalCount: number;
  deltaToken: string;
  sourceRef?: PuzzleSourceRef;
  sampleAssetPath?: string | null;
  /** Provider-specific remote binary blob ID/URI (e.g. Google Drive appDataFolder fileId, Steam UGCHandle, OneDrive itemId, CloudKit assetId) */
  cloudBinaryRef?: string;
  /** Legacy alias for Google Drive fileId */
  driveBinaryFileId?: string;
  inlineBinaryB64?: string;
}

export interface CloudLibraryManifestV2 {
  version: 2;
  updatedAt: number;
  devicePlayerId: string;
  providerId?: CloudProviderId;
  entries: Record<string, CloudSaveEntryV2>;
}

export type CloudBackendKind =
  | 'google_drive_appdata'
  | 'play_games_snapshots'
  | 'steam_remote_storage'
  | 'microsoft_onedrive_approot'
  | 'apple_cloudkit'
  | 'local_cache';

export interface CloudSyncResult {
  slotKey: string;
  mergedDelta: ProgressDeltaV2;
  addedFromCloud: number;
  pushedToCloud: boolean;
  syncedAt: number;
  totalSavesSynced?: number;
  importedSavesFromCloud?: number;
  cloudBackend?: CloudBackendKind;
}

export interface CloudLibrarySyncSummary {
  syncedAt: number;
  totalSavesSynced: number;
  importedSavesFromCloud: number;
  mergedRegionsFromCloud: number;
  pushedToCloud: boolean;
  cloudBackend: CloudBackendKind;
}

export interface CloudSaveProvider {
  readonly providerName: string;
  pullEnvelope(slotKey: string): Promise<CloudSaveEnvelope | null>;
  pushEnvelope(envelope: CloudSaveEnvelope): Promise<boolean>;
  syncProgress(
    slotKey: string,
    title: string,
    localDelta: ProgressDeltaV2,
    totalCount: number
  ): Promise<CloudSyncResult>;
  syncFullLibrary(localSnapshots: SavedSnapshot[]): Promise<CloudLibrarySyncSummary>;
}

export interface CoopParticipant {
  playerId: string;
  displayName: string;
  avatarColorHex: string;
  lastActiveAt: number;
}

export type CoopMessageType =
  | 'HELLO'
  | 'WELCOME_STATE'
  | 'PAINT_EVENT'
  | 'UNFILL_EVENT'
  | 'HEARTBEAT'
  | 'LEAVE';

export interface CoopPaintEvent {
  eventId: string;
  roomCode: string;
  playerId: string;
  displayName: string;
  avatarColorHex: string;
  action: 'FILL' | 'UNFILL';
  regionIds: number[];
  /** Optional custom ARGB color map when painting in Free Color / Custom Palette mode */
  paintedColors?: Record<number, number>;
  timestamp: number;
}

export interface CoopUnfillEvent {
  eventId: string;
  roomCode: string;
  senderId: string;
  playerId: string;
  displayName: string;
  avatarColorHex: string;
  regionId?: number;
  regionIds: number[];
  timestamp: number;
}

export interface CoopRoomWireMessage {
  type: CoopMessageType;
  roomCode: string;
  sender: CoopParticipant;
  seedToken?: string;
  paintEvent?: CoopPaintEvent;
  unfillEvent?: CoopUnfillEvent;
  sentAt: number;
}

export type RealtimeRoomMessage = CoopRoomWireMessage;

export interface RealtimeRoomProvider {
  readonly activeRoomCode: string | null;
  joinRoom(
    roomCode: string,
    participant: CoopParticipant,
    initialSeedToken?: string
  ): Promise<void>;
  leaveRoom(): void;
  broadcastPaintEvent(event: CoopPaintEvent): void;
  broadcastUnfillEvent(event: CoopUnfillEvent): void;
  broadcastWelcomeState(seedToken: string): void;
  updateSeedToken(seedToken: string): void;
  getParticipants(): CoopParticipant[];
  onPaintEvent(handler: (event: CoopPaintEvent) => void): () => void;
  onUnfillEvent(handler: (event: CoopUnfillEvent) => void): () => void;
  onWelcomeState(handler: (seedToken: string, sender: CoopParticipant) => void): () => void;
  onParticipantsChanged(handler: (participants: CoopParticipant[]) => void): () => void;
}

export interface CommunityPuzzleIdea {
  id: string;
  title: string;
  prompt: string;
  category: string;
  tags: string[];
  authorName: string;
  authorId: string;
  votes: number;
  votedByMe: boolean;
  status: 'queued' | 'curated' | 'generated';
  createdAt: number;
}

export interface CatalogStorageProvider {
  getGalleryItems(): Promise<SampleArtwork[]>;
  getCommunityIdeas(): CommunityPuzzleIdea[];
  submitCommunityIdea(input: {
    title: string;
    prompt: string;
    category: string;
    tags?: string[];
    author: PlayerIdentity;
  }): { ok: true; idea: CommunityPuzzleIdea } | { ok: false; error: string };
  toggleVoteIdea(ideaId: string): CommunityPuzzleIdea[];
}

/**
 * Multi-resolution Infinite Zoom tile node & AI detail infill specification.
 * Enables seamless quadtree sub-puzzle zooming (`parentRegionId` -> 2x2 child tile)
 * while locking boundary colors to the parent palette.
 */
export interface InfiniteZoomTileSpec {
  tileId: string;
  parentSnapshotId: string;
  parentSourceRef?: PuzzleSourceRef;
  depth: number;
  quadrant: 0 | 1 | 2 | 3;
  cropNormalized: { x: number; y: number; width: number; height: number };
  lockedBoundaryPaletteHex: string[];
  promptHint: string;
  generatorConfig: GeneratorConfig;
}

export interface AiArtworkProvider {
  readonly isConfigured: boolean;
  estimateCreditCost(resolution: number, isInfiniteZoomInfill: boolean): number;
  buildSeamLockedInfillPrompt(spec: InfiniteZoomTileSpec): string;
}

export interface AiCreditLedger {
  availableCredits: number;
  lifetimeEarnedCredits: number;
  lifetimeSpentCredits: number;
  adFreePlatform: boolean;
  personalizedAdsConsent: boolean;
}

export interface MonetizationProvider {
  getLedger(): AiCreditLedger;
  setPersonalizedAdsConsent(consent: boolean): AiCreditLedger;
  watchRewardedAdForCredits(): Promise<{ granted: number; ledger: AiCreditLedger }>;
  spendCredits(amount: number): boolean;
}
