import { normalizeCoopRoomCode } from '../ShareLinkService';
import { resolveReleaseChannel } from '../../version';
import { resolveStorageNamespace } from '../StorageNamespace';
import { reportSwallowed } from '../telemetry';
import {
  CoopMessageType,
  CoopPaintEvent,
  CoopParticipant,
  CoopRoomWireMessage,
  CoopUnfillEvent,
  RealtimeRoomProvider,
} from '../providers/types';

export const MAX_COOP_PARTICIPANTS = 24;
export const CHANNEL_PEER_STALE_MS = 18_000;
export const WS_PEER_STALE_MS = 10 * 60 * 1000;
export const MAX_REGION_ID = 1_000_000;
export const MAX_EVENT_REGION_IDS = 512;
export const MAX_EVENT_ID_CHARS = 96;
export const MAX_SEED_TOKEN_CHARS = 4096;

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
    try {
      const parsed = new URL(explicitEnvUrl.trim());
      const proto = parsed.protocol.toLowerCase();
      const host = parsed.hostname.toLowerCase();
      if (proto === 'wss:') {
        return parsed.toString();
      }
      if (proto === 'ws:' && (host === 'localhost' || host === '127.0.0.1' || host === '[::1]')) {
        return parsed.toString();
      }
      return null;
    } catch (err) {
      reportSwallowed('coop.resolveWsUrl', err);
      return null;
    }
  }
  if (!locationLike?.hostname) return null;

  const hostname = locationLike.hostname.toLowerCase();
  if (hostname === 'appassets.androidplatform.net') {
    return 'wss://capypaint.com/api/room';
  }

  if (
    hostname === 'capypaint.com' ||
    hostname === 'www.capypaint.com' ||
    hostname === 'paint.capyboop.com' ||
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

function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value);
}

function sanitizeDisplayName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 40);
  return cleaned || fallback;
}

function sanitizeParticipant(raw: unknown, playerId: string, now: number): CoopParticipant {
  const obj = raw && typeof raw === 'object' ? (raw as Partial<CoopParticipant>) : {};
  return {
    playerId,
    displayName: sanitizeDisplayName(obj.displayName, 'Capy Painter'),
    avatarColorHex: isValidHexColor(obj.avatarColorHex) ? obj.avatarColorHex : '#fbbf24',
    lastActiveAt: now,
  };
}

function sanitizePaintedColors(raw: unknown): Record<number, number> | null | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const colorEntries = Object.entries(raw as Record<string, unknown>);
  if (colorEntries.length > MAX_EVENT_REGION_IDS) return null;
  const result: Record<number, number> = {};
  for (const [k, v] of colorEntries) {
    if (!/^\d+$/.test(k)) return null;
    const regionNum = Number(k);
    if (
      !Number.isInteger(regionNum) ||
      regionNum < 0 ||
      regionNum > MAX_REGION_ID ||
      typeof v !== 'number' ||
      !Number.isInteger(v) ||
      v < 0 ||
      v > 0xffffffff
    ) {
      return null;
    }
    result[regionNum] = v;
  }
  return result;
}

function isValidPaintRegionIds(raw: unknown): raw is number[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_EVENT_REGION_IDS) {
    return false;
  }
  return !raw.some(
    (id) => typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id > MAX_REGION_ID
  );
}

function sanitizeIncomingPaintEvent(
  raw: unknown,
  roomCode: string,
  sender: CoopParticipant
): CoopPaintEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const ev = raw as Record<string, unknown>;

  if (
    typeof ev.eventId !== 'string' ||
    ev.eventId.trim().length === 0 ||
    ev.eventId.length > MAX_EVENT_ID_CHARS ||
    /[\u0000-\u001F\u007F]/.test(ev.eventId)
  ) {
    return null;
  }
  if (ev.roomCode !== undefined && ev.roomCode !== roomCode) return null;
  if (
    ev.playerId !== undefined &&
    (typeof ev.playerId !== 'string' || ev.playerId.trim() !== sender.playerId)
  ) {
    return null;
  }
  if (ev.action !== 'FILL' && ev.action !== 'UNFILL') return null;
  if (!isValidPaintRegionIds(ev.regionIds)) return null;

  if (ev.displayName !== undefined && (typeof ev.displayName !== 'string' || ev.displayName.length > 64)) {
    return null;
  }
  if (ev.avatarColorHex !== undefined && !isValidHexColor(ev.avatarColorHex)) return null;
  if (ev.timestamp !== undefined && (typeof ev.timestamp !== 'number' || !Number.isFinite(ev.timestamp))) {
    return null;
  }

  const sanitizedPaintedColors = sanitizePaintedColors(ev.paintedColors);
  if (sanitizedPaintedColors === null) return null;

  const cleanEvent: CoopPaintEvent = {
    eventId: ev.eventId.trim(),
    roomCode,
    playerId: sender.playerId,
    displayName: sanitizeDisplayName(ev.displayName, sender.displayName),
    avatarColorHex: isValidHexColor(ev.avatarColorHex) ? ev.avatarColorHex : sender.avatarColorHex,
    action: ev.action,
    regionIds: [...ev.regionIds],
    timestamp: typeof ev.timestamp === 'number' ? ev.timestamp : Date.now(),
  };
  if (sanitizedPaintedColors !== undefined) {
    cleanEvent.paintedColors = sanitizedPaintedColors;
  }
  return cleanEvent;
}

function parseUnfillRegionIds(ev: Record<string, unknown>): number[] {
  if (Array.isArray(ev.regionIds)) {
    return ev.regionIds.filter(
      (id): id is number =>
        typeof id === 'number' && Number.isInteger(id) && id > 0 && id <= MAX_REGION_ID
    );
  }
  if (
    typeof ev.regionId === 'number' &&
    Number.isInteger(ev.regionId) &&
    ev.regionId > 0 &&
    ev.regionId <= MAX_REGION_ID
  ) {
    return [ev.regionId];
  }
  return [];
}

function resolveUnfillSenderId(ev: Record<string, unknown>, pid: string): string | null {
  if (ev.senderId !== undefined && (typeof ev.senderId !== 'string' || ev.senderId.trim() !== pid)) {
    return null;
  }
  if (ev.playerId !== undefined && (typeof ev.playerId !== 'string' || ev.playerId.trim() !== pid)) {
    return null;
  }
  return pid;
}

function sanitizeIncomingUnfillEvent(
  raw: unknown,
  roomCode: string,
  sender: CoopParticipant,
  selfPlayerId?: string
): CoopUnfillEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const ev = raw as Record<string, unknown>;
  if (ev.roomCode !== undefined && ev.roomCode !== roomCode) return null;

  const senderId = resolveUnfillSenderId(ev, sender.playerId);
  if (!senderId || senderId === '__capy_room_relay__' || (selfPlayerId && senderId === selfPlayerId)) {
    return null;
  }

  const normalizedRegionIds = parseUnfillRegionIds(ev);
  if (normalizedRegionIds.length === 0 || normalizedRegionIds.length > MAX_EVENT_REGION_IDS) {
    return null;
  }

  let eventId = '';
  if (ev.eventId !== undefined) {
    if (
      typeof ev.eventId !== 'string' ||
      ev.eventId.length > MAX_EVENT_ID_CHARS ||
      /[\u0000-\u001F\u007F]/.test(ev.eventId)
    ) {
      return null;
    }
    eventId = ev.eventId.trim();
  }

  const regionId =
    typeof ev.regionId === 'number' &&
    Number.isInteger(ev.regionId) &&
    ev.regionId > 0 &&
    ev.regionId <= MAX_REGION_ID
      ? ev.regionId
      : normalizedRegionIds[0];

  return {
    eventId,
    roomCode,
    senderId,
    playerId: senderId,
    displayName: sanitizeDisplayName(ev.displayName, sender.displayName),
    avatarColorHex: isValidHexColor(ev.avatarColorHex) ? ev.avatarColorHex : sender.avatarColorHex,
    regionId,
    regionIds: [...normalizedRegionIds],
    timestamp:
      typeof ev.timestamp === 'number' && Number.isFinite(ev.timestamp) ? ev.timestamp : Date.now(),
  };
}

type WireMessageHandler = (
  msg: CoopRoomWireMessage,
  sender: CoopParticipant,
  source: 'channel' | 'ws'
) => void;

export class HybridCoopRoomClient implements RealtimeRoomProvider {
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
  private wsTerminallyClosed = false;
  private detachLifecycleListeners: (() => void) | null = null;
  private participants = new Map<string, CoopParticipant>();
  private participantTransports = new Map<string, 'channel' | 'ws'>();
  private seenEventIds = new Set<string>();

  private paintHandlers = new Set<(event: CoopPaintEvent) => void>();
  private unfillHandlers = new Set<(event: CoopUnfillEvent) => void>();
  private welcomeHandlers = new Set<(seedToken: string, sender: CoopParticipant) => void>();
  private participantHandlers = new Set<(participants: CoopParticipant[]) => void>();

  private readonly wireHandlers: Record<CoopMessageType, WireMessageHandler> = {
    HELLO: (msg, sender, source) => this.handleHelloMessage(msg, sender, source),
    WELCOME_STATE: (msg, sender) => this.handleWelcomeStateMessage(msg, sender),
    PAINT_EVENT: (msg, sender) => this.handlePaintEventMessage(msg, sender),
    UNFILL_EVENT: (msg, sender) => this.handleUnfillEventMessage(msg, sender),
    HEARTBEAT: () => {
      // Participant timestamp is already refreshed before dispatch.
    },
    LEAVE: () => {
      // Handled before participant upsert.
    },
  };

  get activeRoomCode(): string | null {
    return this.roomCode;
  }

  async joinRoom(
    rawRoomCode: string,
    participant: CoopParticipant,
    initialSeedToken?: string
  ): Promise<void> {
    const normalized = normalizeCoopRoomCode(rawRoomCode);
    if (!normalized) throw new Error('Invalid room code');

    this.leaveRoom();

    this.isLeavingRoom = false;
    this.wsTerminallyClosed = false;
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
        try {
          if (ev.data) this.handleWireMessage(ev.data, 'channel');
        } catch (err) {
          reportSwallowed('coop.channelOnMessage', err);
        }
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
          } catch (err) {
            reportSwallowed('coop.wsPing', err);
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
      if (this.isLeavingRoom || this.wsTerminallyClosed || !this.roomCode || !this.wsEndpoint) {
        return;
      }
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
    if (
      this.isLeavingRoom ||
      this.wsTerminallyClosed ||
      !this.roomCode ||
      !this.wsEndpoint ||
      typeof WebSocket === 'undefined'
    ) {
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
        if (
          this.ws !== socket ||
          this.isLeavingRoom ||
          this.wsTerminallyClosed ||
          !this.roomCode ||
          !this.selfParticipant
        ) {
          try {
            socket.close();
          } catch (err) {
            reportSwallowed('coop.staleSocketClose', err);
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
        } catch (err) {
          reportSwallowed('coop.wsOnMessage', err);
        }
      };

      socket.onclose = (ev) => {
        if (this.ws === socket) {
          this.ws = null;
        }
        this.clearWsParticipants();
        const code = typeof ev?.code === 'number' ? ev.code : 0;
        const isTerminalPolicyClose =
          code === 1008 || code === 1009 || (code >= 4000 && code <= 4999);
        if (isTerminalPolicyClose) {
          this.wsTerminallyClosed = true;
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
          return;
        }
        if (!this.isLeavingRoom && this.roomCode && this.wsEndpoint) {
          this.scheduleWsReconnect();
        }
      };

      socket.onerror = () => {
        // Allow onclose to drive cleanup and backoff
      };
    } catch (err) {
      reportSwallowed('coop.openWebSocket', err);
      this.ws = null;
      this.scheduleWsReconnect();
    }
  }

  private scheduleWsReconnect(): void {
    if (
      this.wsReconnectTimer ||
      this.isLeavingRoom ||
      this.wsTerminallyClosed ||
      !this.roomCode ||
      !this.wsEndpoint
    ) {
      return;
    }
    const delayMs = computeCoopReconnectDelayMs(this.wsReconnectAttempt++);
    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      if (!this.isLeavingRoom && !this.wsTerminallyClosed && this.roomCode && this.wsEndpoint) {
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
      } catch (err) {
        reportSwallowed('coop.leaveCloseWs', err);
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
    this.wsTerminallyClosed = false;
    this.emitParticipants();
  }

  private sendLocalChannelMessage(msg: CoopRoomWireMessage): void {
    try {
      this.channel?.postMessage(msg);
    } catch (err) {
      reportSwallowed('coop.sendChannel', err);
    }
  }

  private sendWebSocketMessage(msg: CoopRoomWireMessage): void {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
      }
    } catch (err) {
      reportSwallowed('coop.sendWs', err);
    }
  }

  private sendWireMessage(msg: CoopRoomWireMessage): void {
    this.sendLocalChannelMessage(msg);
    this.sendWebSocketMessage(msg);
  }

  private upsertParticipant(peer: CoopParticipant, source: 'channel' | 'ws'): void {
    const pid = peer.playerId;
    if (source === 'channel') {
      this.participantTransports.set(pid, 'channel');
    } else if (this.participantTransports.get(pid) !== 'channel') {
      this.participantTransports.set(pid, 'ws');
    }

    const isNewPeer = !this.participants.has(pid);
    if (isNewPeer && this.participants.size >= MAX_COOP_PARTICIPANTS) {
      let oldestId: string | null = null;
      let oldestTs = Infinity;
      for (const [candidateId, candidate] of this.participants.entries()) {
        if (this.selfParticipant && candidateId === this.selfParticipant.playerId) continue;
        if (candidate.lastActiveAt < oldestTs) {
          oldestTs = candidate.lastActiveAt;
          oldestId = candidateId;
        }
      }
      if (oldestId !== null) {
        this.participants.delete(oldestId);
        this.participantTransports.delete(oldestId);
      }
    }

    this.participants.set(pid, peer);
    if (isNewPeer) {
      this.emitParticipants();
    }
  }

  private handleHelloMessage(
    msg: CoopRoomWireMessage,
    sender: CoopParticipant,
    source: 'channel' | 'ws'
  ): void {
    if (
      typeof msg.seedToken === 'string' &&
      msg.seedToken.length > 0 &&
      msg.seedToken.length <= MAX_SEED_TOKEN_CHARS
    ) {
      for (const h of this.welcomeHandlers) h(msg.seedToken, sender);
    }
    if (this.selfParticipant && this.roomCode) {
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
  }

  private handleWelcomeStateMessage(msg: CoopRoomWireMessage, sender: CoopParticipant): void {
    if (
      typeof msg.seedToken === 'string' &&
      msg.seedToken.length > 0 &&
      msg.seedToken.length <= MAX_SEED_TOKEN_CHARS
    ) {
      for (const h of this.welcomeHandlers) h(msg.seedToken, sender);
    }
  }

  private handlePaintEventMessage(msg: CoopRoomWireMessage, sender: CoopParticipant): void {
    if (!this.roomCode) return;
    const sanitized = sanitizeIncomingPaintEvent(msg.paintEvent, this.roomCode, sender);
    if (!sanitized) return;
    if (this.seenEventIds.has(sanitized.eventId)) return;
    this.rememberEventId(sanitized.eventId);
    for (const h of this.paintHandlers) h(sanitized);
  }

  private handleUnfillEventMessage(msg: CoopRoomWireMessage, sender: CoopParticipant): void {
    if (!this.roomCode) return;
    const sanitized = sanitizeIncomingUnfillEvent(
      msg.unfillEvent,
      this.roomCode,
      sender,
      this.selfParticipant?.playerId
    );
    if (!sanitized) return;
    if (sanitized.eventId) {
      if (this.seenEventIds.has(sanitized.eventId)) return;
      this.rememberEventId(sanitized.eventId);
    }
    for (const h of this.unfillHandlers) h(sanitized);
  }

  private handleWireMessage(msg: CoopRoomWireMessage, source: 'channel' | 'ws' = 'channel'): void {
    if (
      !this.roomCode ||
      !msg ||
      typeof msg !== 'object' ||
      msg.roomCode !== this.roomCode ||
      !msg.sender ||
      typeof msg.sender !== 'object'
    ) {
      return;
    }
    const rawSenderId =
      typeof msg.sender.playerId === 'string' ? msg.sender.playerId.trim() : '';
    if (
      !rawSenderId ||
      rawSenderId.length > 64 ||
      /[\u0000-\u001F\u007F]/.test(rawSenderId)
    ) {
      return;
    }
    if (this.selfParticipant && rawSenderId === this.selfParticipant.playerId) return;

    const now = Date.now();
    if (rawSenderId === '__capy_room_relay__') {
      if (
        msg.type === 'WELCOME_STATE' &&
        typeof msg.seedToken === 'string' &&
        msg.seedToken.length > 0 &&
        msg.seedToken.length <= MAX_SEED_TOKEN_CHARS
      ) {
        const relaySender = sanitizeParticipant(msg.sender, rawSenderId, now);
        for (const h of this.welcomeHandlers) h(msg.seedToken, relaySender);
      }
      return;
    }

    if (
      typeof msg.type !== 'string' ||
      !Object.prototype.hasOwnProperty.call(this.wireHandlers, msg.type)
    ) {
      return;
    }

    if (msg.type === 'LEAVE') {
      const removed = this.participants.delete(rawSenderId);
      this.participantTransports.delete(rawSenderId);
      if (removed) this.emitParticipants();
      return;
    }

    const updatedSender = sanitizeParticipant(msg.sender, rawSenderId, now);
    this.upsertParticipant(updatedSender, source);

    const handler = this.wireHandlers[msg.type];
    handler(msg, updatedSender, source);
  }

  private rememberEventId(eventId: string): void {
    this.seenEventIds.add(eventId);
    if (this.seenEventIds.size > 512) {
      const oldest = this.seenEventIds.values().next().value;
      if (oldest) this.seenEventIds.delete(oldest);
    }
  }

  private pruneStaleParticipants(): void {
    const now = Date.now();
    const channelCutoff = now - CHANNEL_PEER_STALE_MS;
    const wsCutoff = now - WS_PEER_STALE_MS;
    let changed = false;
    for (const [pid, peer] of this.participants.entries()) {
      if (this.selfParticipant && pid === this.selfParticipant.playerId) continue;
      const transport = this.participantTransports.get(pid);
      const cutoff = transport === 'ws' ? wsCutoff : channelCutoff;
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

export { HybridCoopRoomClient as HybridCoopRoomAdapter };
