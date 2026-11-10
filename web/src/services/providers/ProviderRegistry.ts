import { SAMPLE_GALLERY, SampleArtwork } from '../../types';
import {
  decodeProgressDeltaToken,
  encodeProgressDeltaToken,
  mergeProgressDeltas,
  ProgressDeltaV2,
} from '../CapyCodec';
import { NativeBridge } from '../NativeBridge';
import {
  AiArtworkProvider,
  AiCreditLedger,
  AuthProvider,
  CatalogStorageProvider,
  CloudSaveEnvelope,
  CloudSaveProvider,
  CloudSyncResult,
  CommunityPuzzleIdea,
  CoopPaintEvent,
  CoopParticipant,
  CoopRoomWireMessage,
  InfiniteZoomTileSpec,
  MonetizationProvider,
  PlayerIdentity,
  RealtimeRoomProvider,
} from './types';

const IDENTITY_STORAGE_KEY = 'capy_player_identity_v1';
const TAB_SESSION_SUFFIX_KEY = 'capy_tab_peer_suffix_v1';
const CLOUD_VAULT_STORAGE_KEY = 'capy_cloud_vault_v1';
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
    let suffix = sessionStorage.getItem(TAB_SESSION_SUFFIX_KEY);
    if (!suffix) {
      suffix = randomHexId(4);
      sessionStorage.setItem(TAB_SESSION_SUFFIX_KEY, suffix);
    }
    return suffix;
  } catch {
    return randomHexId(4);
  }
}

// ---------------------------------------------------------------------------
// 1. AuthProvider: Guest + Google Play Games Services v2 Bridge
// ---------------------------------------------------------------------------

class GuestAndPlayGamesAuthAdapter implements AuthProvider {
  private identity: PlayerIdentity;
  private listeners = new Set<(id: PlayerIdentity) => void>();

  constructor() {
    this.identity = this.loadOrCreateIdentity();
    NativeBridge.onPlayGamesProfile((profile) => {
      this.applyPlayGamesProfile(profile.playerId, profile.displayName);
    });
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
    try {
      const raw = localStorage.getItem(IDENTITY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PlayerIdentity;
        if (parsed && parsed.playerId && parsed.displayName) {
          return {
            ...parsed,
            // Append tab peer suffix when in guest mode so multi-tab local co-op distinguishes peers
            playerId: parsed.provider === 'guest' ? `${parsed.playerId.split(':')[0]}:${tabSuffix}` : parsed.playerId,
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
      localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(stored));
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

  async signInWithPlayGames(): Promise<PlayerIdentity> {
    const nativeResult = NativeBridge.signInPlayGames();
    if (nativeResult) {
      this.identity = {
        playerId: nativeResult.playerId,
        displayName: nativeResult.displayName,
        avatarColorHex: this.identity.avatarColorHex,
        provider: 'play_games_v2',
        isAuthenticated: true,
        lastSyncedAt: Date.now(),
      };
    } else {
      // Graceful local Play Games profile link when testing in web browser / debug shell without Play Store signature
      const baseId = this.identity.playerId.split(':')[0];
      this.identity = {
        ...this.identity,
        playerId: `pgs_${baseId}`,
        provider: 'play_games_v2',
        isAuthenticated: true,
        lastSyncedAt: Date.now(),
      };
    }
    this.persistBaseIdentity(this.identity);
    this.emit();
    return this.identity;
  }

  async signOut(): Promise<PlayerIdentity> {
    const tabSuffix = getTabPeerSuffix();
    const baseId = this.identity.playerId.replace(/^pgs_/, '').split(':')[0];
    this.identity = {
      ...this.identity,
      playerId: `${baseId}:${tabSuffix}`,
      provider: 'guest',
      isAuthenticated: false,
    };
    this.persistBaseIdentity(this.identity);
    this.emit();
    return this.identity;
  }

  subscribe(listener: (identity: PlayerIdentity) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

// ---------------------------------------------------------------------------
// 2. CloudSaveProvider: Conflict-Free CRDT Set-Union + LWW Cloud Sync
// ---------------------------------------------------------------------------

class CrdtCloudSaveAdapter implements CloudSaveProvider {
  readonly providerName = NativeBridge.isAndroid ? 'Google Play Games Cloud' : 'Capy Cloud Vault';

  constructor(private readonly auth: AuthProvider) {}

  private readLocalVault(): Record<string, CloudSaveEnvelope> {
    try {
      const raw = localStorage.getItem(CLOUD_VAULT_STORAGE_KEY);
      if (raw) return JSON.parse(raw) as Record<string, CloudSaveEnvelope>;
    } catch {
      // Ignore
    }
    return {};
  }

  private writeLocalVault(vault: Record<string, CloudSaveEnvelope>): void {
    try {
      localStorage.setItem(CLOUD_VAULT_STORAGE_KEY, JSON.stringify(vault));
    } catch {
      // Ignore
    }
  }

  async pullEnvelope(slotKey: string): Promise<CloudSaveEnvelope | null> {
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
    return nativeSaved || true;
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
        const remoteDelta = await decodeProgressDeltaToken(existing.deltaToken);
        const beforeCount = localDelta.filledRegionIds.length;
        merged = mergeProgressDeltas(localDelta, remoteDelta);
        addedFromCloud = Math.max(0, merged.filledRegionIds.length - beforeCount);
      } catch {
        merged = localDelta;
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
      updatedAt: syncedAt,
      devicePlayerId: this.auth.getCurrentIdentity().playerId,
    };
    const pushedToCloud = await this.pushEnvelope(envelope);

    return {
      slotKey,
      mergedDelta: merged,
      addedFromCloud,
      pushedToCloud,
      syncedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// 3. RealtimeRoomProvider: Simultaneous Co-op via BroadcastChannel + Optional WS
// ---------------------------------------------------------------------------

class HybridCoopRoomAdapter implements RealtimeRoomProvider {
  private roomCode: string | null = null;
  private selfParticipant: CoopParticipant | null = null;
  private seedToken: string | undefined;
  private channel: BroadcastChannel | null = null;
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private participants = new Map<string, CoopParticipant>();
  private seenEventIds = new Set<string>();

  private paintHandlers = new Set<(event: CoopPaintEvent) => void>();
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

    this.roomCode = normalized;
    this.selfParticipant = { ...participant, lastActiveAt: Date.now() };
    this.seedToken = initialSeedToken;
    this.participants.clear();
    this.participants.set(this.selfParticipant.playerId, this.selfParticipant);
    this.emitParticipants();

    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`capy_coop_room_${normalized}`);
      this.channel.onmessage = (ev: MessageEvent<CoopRoomWireMessage>) => {
        if (ev.data) this.handleWireMessage(ev.data);
      };
    }

    const wsEndpoint = (import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_CAPY_ROOM_WS_URL;
    if (wsEndpoint && typeof WebSocket !== 'undefined') {
      try {
        const sep = wsEndpoint.includes('?') ? '&' : '?';
        this.ws = new WebSocket(`${wsEndpoint}${sep}room=${encodeURIComponent(normalized)}`);
        this.ws.onmessage = (ev) => {
          try {
            const parsed = JSON.parse(String(ev.data)) as CoopRoomWireMessage;
            this.handleWireMessage(parsed);
          } catch {
            // Ignore malformed frame
          }
        };
        this.ws.onopen = () => {
          this.sendWireMessage({
            type: 'HELLO',
            roomCode: normalized,
            sender: this.selfParticipant!,
            seedToken: this.seedToken,
            sentAt: Date.now(),
          });
        };
      } catch {
        this.ws = null;
      }
    }

    // Announce presence immediately
    this.sendWireMessage({
      type: 'HELLO',
      roomCode: normalized,
      sender: this.selfParticipant,
      seedToken: this.seedToken,
      sentAt: Date.now(),
    });

    this.heartbeatTimer = setInterval(() => {
      if (!this.roomCode || !this.selfParticipant) return;
      this.selfParticipant.lastActiveAt = Date.now();
      this.participants.set(this.selfParticipant.playerId, this.selfParticipant);
      this.pruneStaleParticipants();
      this.sendWireMessage({
        type: 'HEARTBEAT',
        roomCode: this.roomCode,
        sender: this.selfParticipant,
        sentAt: Date.now(),
      });
    }, 5000);
  }

  leaveRoom(): void {
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
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore
      }
      this.ws = null;
    }
    this.roomCode = null;
    this.selfParticipant = null;
    this.seedToken = undefined;
    this.participants.clear();
    this.seenEventIds.clear();
    this.emitParticipants();
  }

  private sendWireMessage(msg: CoopRoomWireMessage): void {
    try {
      this.channel?.postMessage(msg);
    } catch {
      // Ignore closed channel
    }
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
      }
    } catch {
      // Ignore WS errors
    }
  }

  private handleWireMessage(msg: CoopRoomWireMessage): void {
    if (!this.roomCode || msg.roomCode !== this.roomCode || !msg.sender) return;
    if (this.selfParticipant && msg.sender.playerId === this.selfParticipant.playerId) return;

    if (msg.type === 'LEAVE') {
      this.participants.delete(msg.sender.playerId);
      this.emitParticipants();
      return;
    }

    const updatedSender: CoopParticipant = {
      ...msg.sender,
      lastActiveAt: Date.now(),
    };
    const isNewPeer = !this.participants.has(updatedSender.playerId);
    this.participants.set(updatedSender.playerId, updatedSender);
    if (isNewPeer) {
      this.emitParticipants();
    }

    if (msg.type === 'HELLO') {
      if (msg.seedToken) {
        for (const h of this.welcomeHandlers) h(msg.seedToken, updatedSender);
      }
      // Reply with our current welcome state so newly joined peers converge immediately!
      if (this.selfParticipant) {
        this.sendWireMessage({
          type: 'WELCOME_STATE',
          roomCode: this.roomCode,
          sender: this.selfParticipant,
          seedToken: this.seedToken,
          sentAt: Date.now(),
        });
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
      if (peer.lastActiveAt < cutoff) {
        this.participants.delete(pid);
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
      const raw = localStorage.getItem(COMMUNITY_IDEAS_STORAGE_KEY);
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
      localStorage.setItem(COMMUNITY_IDEAS_STORAGE_KEY, JSON.stringify(ideas));
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
      const raw = localStorage.getItem(AI_CREDITS_STORAGE_KEY);
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
      localStorage.setItem(AI_CREDITS_STORAGE_KEY, JSON.stringify(ledger));
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

const auth = new GuestAndPlayGamesAuthAdapter();
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
