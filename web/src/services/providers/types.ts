import { GeneratorConfig, PuzzleSourceRef, SampleArtwork } from '../../types';
import { ProgressDeltaV2 } from '../CapyCodec';

export type AuthProviderKind = 'guest' | 'play_games_v2' | 'oidc';

export interface PlayerIdentity {
  playerId: string;
  displayName: string;
  avatarColorHex: string;
  provider: AuthProviderKind;
  isAuthenticated: boolean;
  lastSyncedAt?: number;
}

export interface AuthProvider {
  getCurrentIdentity(): PlayerIdentity;
  updateGuestProfile(displayName: string, avatarColorHex?: string): PlayerIdentity;
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

export interface CloudSyncResult {
  slotKey: string;
  mergedDelta: ProgressDeltaV2;
  addedFromCloud: number;
  pushedToCloud: boolean;
  syncedAt: number;
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

export interface CoopRoomWireMessage {
  type: CoopMessageType;
  roomCode: string;
  sender: CoopParticipant;
  seedToken?: string;
  paintEvent?: CoopPaintEvent;
  sentAt: number;
}

export interface RealtimeRoomProvider {
  readonly activeRoomCode: string | null;
  joinRoom(
    roomCode: string,
    participant: CoopParticipant,
    initialSeedToken?: string
  ): Promise<void>;
  leaveRoom(): void;
  broadcastPaintEvent(event: CoopPaintEvent): void;
  broadcastWelcomeState(seedToken: string): void;
  updateSeedToken(seedToken: string): void;
  getParticipants(): CoopParticipant[];
  onPaintEvent(handler: (event: CoopPaintEvent) => void): () => void;
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
