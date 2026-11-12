export const MAX_COOP_FRAME_BYTES = 4096;
export const MAX_SEED_TOKEN_CHARS = 3072;
export const MAX_ROOM_PARTICIPANTS = 24;
export const ROOM_STATE_TTL_MS = 24 * 60 * 60 * 1000;

export type RelayMessageType =
  | 'HELLO'
  | 'WELCOME_STATE'
  | 'PAINT_EVENT'
  | 'UNFILL_EVENT'
  | 'HEARTBEAT'
  | 'LEAVE';

export interface RelayParticipant {
  playerId: string;
  displayName: string;
  avatarColorHex: string;
  lastActiveAt: number;
}

export interface RelayWireMessage {
  type: RelayMessageType;
  roomCode: string;
  sender: RelayParticipant;
  seedToken?: string;
  paintEvent?: Record<string, unknown>;
  unfillEvent?: Record<string, unknown>;
  sentAt: number;
}

export interface ValidatedCoopFrameResult {
  ok: boolean;
  reason?: string;
  message?: RelayWireMessage;
  serialized?: string;
}

const VALID_MESSAGE_TYPES = new Set<RelayMessageType>([
  'HELLO',
  'WELCOME_STATE',
  'PAINT_EVENT',
  'UNFILL_EVENT',
  'HEARTBEAT',
  'LEAVE',
]);

const encoder = new TextEncoder();

export function normalizeRoomCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  return cleaned.length > 0 ? cleaned : null;
}

export function isAllowedRelayOrigin(originHeader: string | null | undefined): boolean {
  // Native WebSocket clients without an Origin header or explicit allowed web/WebView origins
  if (!originHeader) return true;
  try {
    const parsed = new URL(originHeader);
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return protocol === 'http:' || protocol === 'https:';
    }

    if (protocol !== 'https:') return false;

    return (
      hostname === 'capypaint.com' ||
      hostname === 'www.capypaint.com' ||
      hostname.endsWith('.capypaint.com') ||
      hostname.endsWith('.workers.dev') ||
      hostname === 'appassets.androidplatform.net' ||
      hostname === 'capyboop.github.io' ||
      hostname === 'shthed.github.io'
    );
  } catch {
    return false;
  }
}

export function getUtf8ByteLength(input: string | ArrayBuffer | Uint8Array): number {
  if (typeof input === 'string') {
    return encoder.encode(input).byteLength;
  }
  return input.byteLength;
}

export function validateCoopFrame(
  rawFrame: string | ArrayBuffer | Uint8Array,
  expectedRoomCode: string
): ValidatedCoopFrameResult {
  const byteLength = getUtf8ByteLength(rawFrame);
  if (byteLength === 0 || byteLength > MAX_COOP_FRAME_BYTES) {
    return { ok: false, reason: 'frame_size_exceeded' };
  }

  const text =
    typeof rawFrame === 'string'
      ? rawFrame
      : new TextDecoder().decode(rawFrame instanceof Uint8Array ? rawFrame : new Uint8Array(rawFrame));

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'invalid_envelope' };
  }

  const record = parsed as Record<string, unknown>;
  const type = record.type as RelayMessageType;
  if (!VALID_MESSAGE_TYPES.has(type)) {
    return { ok: false, reason: 'unsupported_type' };
  }

  const normalizedRoom = normalizeRoomCode(
    typeof record.roomCode === 'string' ? record.roomCode : null
  );
  if (!normalizedRoom || normalizedRoom !== expectedRoomCode) {
    return { ok: false, reason: 'room_mismatch' };
  }

  const sender = record.sender as Record<string, unknown> | undefined;
  if (
    !sender ||
    typeof sender !== 'object' ||
    typeof sender.playerId !== 'string' ||
    sender.playerId.trim().length === 0 ||
    sender.playerId.length > 64 ||
    typeof sender.displayName !== 'string' ||
    sender.displayName.length > 64
  ) {
    return { ok: false, reason: 'invalid_sender' };
  }

  if (
    record.seedToken !== undefined &&
    (typeof record.seedToken !== 'string' || record.seedToken.length > MAX_SEED_TOKEN_CHARS)
  ) {
    return { ok: false, reason: 'seed_token_too_large' };
  }

  const sanitizedSender: RelayParticipant = {
    playerId: sender.playerId.trim(),
    displayName: sender.displayName.trim().slice(0, 40) || 'Capy Painter',
    avatarColorHex:
      typeof sender.avatarColorHex === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(sender.avatarColorHex)
        ? sender.avatarColorHex
        : '#fbbf24',
    lastActiveAt: Date.now(),
  };

  const normalizedMessage: RelayWireMessage = {
    type,
    roomCode: expectedRoomCode,
    sender: sanitizedSender,
    ...(typeof record.seedToken === 'string' && record.seedToken.length > 0
      ? { seedToken: record.seedToken }
      : {}),
    ...(record.paintEvent && typeof record.paintEvent === 'object'
      ? { paintEvent: record.paintEvent as Record<string, unknown> }
      : {}),
    ...(record.unfillEvent && typeof record.unfillEvent === 'object'
      ? { unfillEvent: record.unfillEvent as Record<string, unknown> }
      : {}),
    sentAt: typeof record.sentAt === 'number' && Number.isFinite(record.sentAt) ? record.sentAt : Date.now(),
  };

  return {
    ok: true,
    message: normalizedMessage,
    serialized: JSON.stringify(normalizedMessage),
  };
}
