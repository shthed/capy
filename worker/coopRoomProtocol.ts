export const MAX_COOP_FRAME_BYTES = 6144;
export const MAX_SEED_TOKEN_CHARS = 4096;
export const MAX_ROOM_PARTICIPANTS = 24;
export const ROOM_STATE_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_EVENT_ID_CHARS = 96;
export const MAX_EVENT_REGION_IDS = 512;
export const MAX_REGION_ID_VALUE = 16_777_216;
export const RATE_LIMIT_MAX_FRAMES = 40;
export const RATE_LIMIT_WINDOW_MS = 5000;
export const SEED_CHECKPOINT_DEBOUNCE_MS = 5000;
export const UNJOINED_HANDSHAKE_TIMEOUT_MS = 10_000;
export const MAX_UNJOINED_SOCKETS_PER_IP = 4;
export const MAX_HOST_TOKEN_CHARS = 128;
export const RESERVED_RELAY_PLAYER_ID = '__capy_room_relay__';

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
  hostToken?: string;
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

export const VALID_MESSAGE_TYPES = new Set<RelayMessageType>([
  'HELLO',
  'WELCOME_STATE',
  'PAINT_EVENT',
  'UNFILL_EVENT',
  'HEARTBEAT',
  'LEAVE',
]);

const encoder = new TextEncoder();

const B64URL_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  for (let i = 0; i < chars.length; i++) {
    table[chars.charCodeAt(i)] = i;
  }
  return table;
})();

function decodeBase64UrlPrefix(input: string, maxBytes: number): Uint8Array | null {
  const len = input.length;
  if (len === 0 || len % 4 === 1) return null;
  for (let i = 0; i < len; i++) {
    const code = input.charCodeAt(i);
    if (code >= 128 || B64URL_LOOKUP[code] < 0) return null;
  }
  const totalBytes = Math.floor((len * 3) / 4);
  const outLen = Math.min(totalBytes, maxBytes);
  const out = new Uint8Array(outLen);
  let outIdx = 0;
  for (let i = 0; i < len && outIdx < outLen; i += 4) {
    const c0 = B64URL_LOOKUP[input.charCodeAt(i)];
    const c1 = B64URL_LOOKUP[input.charCodeAt(i + 1)];
    out[outIdx++] = (c0 << 2) | (c1 >> 4);
    if (outIdx < outLen && i + 2 < len) {
      const c2 = B64URL_LOOKUP[input.charCodeAt(i + 2)];
      out[outIdx++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
      if (outIdx < outLen && i + 3 < len) {
        const c3 = B64URL_LOOKUP[input.charCodeAt(i + 3)];
        out[outIdx++] = ((c2 & 0x03) << 6) | c3;
      }
    }
  }
  return out;
}

/**
 * Pure-TS Base64URL and ProgressDeltaV2 binary envelope header check (0x00 0x02 raw or 0x01 0x1f 0x8b gzip).
 */
export function isValidSeedToken(seedToken: unknown): seedToken is string {
  if (typeof seedToken !== 'string') return false;
  if (seedToken.length < 3 || seedToken.length > MAX_SEED_TOKEN_CHARS) return false;
  const header = decodeBase64UrlPrefix(seedToken, 4);
  if (!header || header.byteLength < 2) return false;
  if (header[0] === 0x00) {
    return header[1] === 0x02;
  }
  if (header[0] === 0x01) {
    return header.byteLength >= 3 && header[1] === 0x1f && header[2] === 0x8b;
  }
  return false;
}

export function normalizeRoomCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return cleaned.length >= 4 && cleaned.length <= 8 ? cleaned : null;
}

const ALLOWED_EXACT_RELAY_HOSTS = new Set<string>([
  'capypaint.com',
  'www.capypaint.com',
  'paint.capyboop.com',
  'capyboop.github.io',
  /* capy-dev-only:start */
  'shthed.github.io',
  /* capy-dev-only:end */
  'appassets.androidplatform.net',
]);

export function isAllowedRelayOrigin(
  originHeader: string | null | undefined,
  extraOriginsCsv?: string | null,
  allowLocalhostOrigins: boolean = true
): boolean {
  if (!originHeader || originHeader.trim().length === 0) {
    return false;
  }
  const trimmed = originHeader.trim();
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.username !== '' || parsed.password !== '') {
      return false;
    }
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
      return allowLocalhostOrigins && (protocol === 'http:' || protocol === 'https:');
    }

    const isCapySubdomain =
      hostname.endsWith('.capypaint.com') &&
      hostname.length > '.capypaint.com'.length &&
      !hostname.startsWith('.') &&
      !hostname.endsWith('.');

    if (
      protocol === 'https:' &&
      parsed.port === '' &&
      (ALLOWED_EXACT_RELAY_HOSTS.has(hostname) || isCapySubdomain)
    ) {
      return true;
    }

    if (extraOriginsCsv && extraOriginsCsv.trim().length > 0) {
      const normalizedOrigin = parsed.origin.toLowerCase();
      const entries = extraOriginsCsv.split(',');
      for (const rawEntry of entries) {
        const entry = rawEntry.trim();
        if (!entry) continue;
        try {
          const candidate = new URL(entry.includes('://') ? entry : `https://${entry}`);
          if (candidate.origin.toLowerCase() === normalizedOrigin) {
            return true;
          }
        } catch {
          // Ignore malformed extra origin entry
        }
      }
    }

    return false;
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

function isValidRegionIdArray(val: unknown): val is number[] {
  if (!Array.isArray(val) || val.length < 1 || val.length > MAX_EVENT_REGION_IDS) {
    return false;
  }
  for (let i = 0; i < val.length; i++) {
    const id = val[i];
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id > MAX_REGION_ID_VALUE) {
      return false;
    }
  }
  return true;
}

function sanitizePaintEvent(
  raw: unknown,
  expectedRoomCode: string,
  senderPlayerId: string
): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const ev = raw as Record<string, unknown>;
  if (
    typeof ev.eventId !== 'string' ||
    ev.eventId.trim().length < 1 ||
    ev.eventId.length > MAX_EVENT_ID_CHARS
  ) {
    return null;
  }
  if (ev.roomCode !== undefined) {
    const evRoom = typeof ev.roomCode === 'string' ? normalizeRoomCode(ev.roomCode) : null;
    if (evRoom !== expectedRoomCode) return null;
  }
  if (ev.playerId !== undefined) {
    if (typeof ev.playerId !== 'string' || ev.playerId.trim() !== senderPlayerId) {
      return null;
    }
  }
  if (ev.displayName !== undefined && (typeof ev.displayName !== 'string' || ev.displayName.length > 64)) {
    return null;
  }
  if (
    ev.avatarColorHex !== undefined &&
    (typeof ev.avatarColorHex !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(ev.avatarColorHex))
  ) {
    return null;
  }
  if (ev.timestamp !== undefined && (typeof ev.timestamp !== 'number' || !Number.isFinite(ev.timestamp))) {
    return null;
  }
  if (ev.action !== undefined && ev.action !== 'FILL' && ev.action !== 'UNFILL') {
    return null;
  }
  if (!isValidRegionIdArray(ev.regionIds)) {
    return null;
  }

  let cleanPaintedColors: Record<string, number> | undefined;
  if (ev.paintedColors !== undefined) {
    if (!ev.paintedColors || typeof ev.paintedColors !== 'object' || Array.isArray(ev.paintedColors)) {
      return null;
    }
    const entries = Object.entries(ev.paintedColors as Record<string, unknown>);
    if (entries.length > MAX_EVENT_REGION_IDS) return null;
    cleanPaintedColors = {};
    for (const [key, colorVal] of entries) {
      if (!/^\d+$/.test(key)) return null;
      const rid = Number(key);
      if (!Number.isInteger(rid) || rid < 0 || rid > MAX_REGION_ID_VALUE) return null;
      if (
        typeof colorVal !== 'number' ||
        !Number.isInteger(colorVal) ||
        colorVal < 0 ||
        colorVal > 0xffffffff
      ) {
        return null;
      }
      cleanPaintedColors[key] = colorVal;
    }
  }

  return {
    eventId: ev.eventId.trim(),
    ...(ev.roomCode !== undefined ? { roomCode: expectedRoomCode } : {}),
    ...(ev.playerId !== undefined ? { playerId: senderPlayerId } : {}),
    ...(typeof ev.displayName === 'string' ? { displayName: ev.displayName } : {}),
    ...(typeof ev.avatarColorHex === 'string' ? { avatarColorHex: ev.avatarColorHex } : {}),
    ...(ev.action !== undefined ? { action: ev.action } : {}),
    regionIds: ev.regionIds,
    ...(cleanPaintedColors !== undefined ? { paintedColors: cleanPaintedColors } : {}),
    ...(typeof ev.timestamp === 'number' ? { timestamp: ev.timestamp } : {}),
  };
}

function sanitizeUnfillEvent(
  raw: unknown,
  expectedRoomCode: string,
  senderPlayerId: string
): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const ev = raw as Record<string, unknown>;
  if (
    typeof ev.eventId !== 'string' ||
    ev.eventId.trim().length < 1 ||
    ev.eventId.length > MAX_EVENT_ID_CHARS
  ) {
    return null;
  }
  if (ev.roomCode !== undefined) {
    const evRoom = typeof ev.roomCode === 'string' ? normalizeRoomCode(ev.roomCode) : null;
    if (evRoom !== expectedRoomCode) return null;
  }
  if (ev.senderId !== undefined) {
    if (typeof ev.senderId !== 'string' || ev.senderId.trim() !== senderPlayerId) {
      return null;
    }
  }
  if (ev.playerId !== undefined) {
    if (typeof ev.playerId !== 'string' || ev.playerId.trim() !== senderPlayerId) {
      return null;
    }
  }
  if (ev.displayName !== undefined && (typeof ev.displayName !== 'string' || ev.displayName.length > 64)) {
    return null;
  }
  if (
    ev.avatarColorHex !== undefined &&
    (typeof ev.avatarColorHex !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(ev.avatarColorHex))
  ) {
    return null;
  }
  if (ev.timestamp !== undefined && (typeof ev.timestamp !== 'number' || !Number.isFinite(ev.timestamp))) {
    return null;
  }
  if (!isValidRegionIdArray(ev.regionIds)) {
    return null;
  }
  if (ev.regionId !== undefined) {
    if (
      typeof ev.regionId !== 'number' ||
      !Number.isInteger(ev.regionId) ||
      ev.regionId < 0 ||
      ev.regionId > MAX_REGION_ID_VALUE
    ) {
      return null;
    }
  }

  return {
    eventId: ev.eventId.trim(),
    ...(ev.roomCode !== undefined ? { roomCode: expectedRoomCode } : {}),
    ...(ev.senderId !== undefined ? { senderId: senderPlayerId } : {}),
    ...(ev.playerId !== undefined ? { playerId: senderPlayerId } : {}),
    ...(typeof ev.displayName === 'string' ? { displayName: ev.displayName } : {}),
    ...(typeof ev.avatarColorHex === 'string' ? { avatarColorHex: ev.avatarColorHex } : {}),
    ...(ev.regionId !== undefined ? { regionId: ev.regionId } : {}),
    regionIds: ev.regionIds,
    ...(typeof ev.timestamp === 'number' ? { timestamp: ev.timestamp } : {}),
  };
}

export interface FrameValidationContext {
  record: Record<string, unknown>;
  expectedRoomCode: string;
  senderPlayerId: string;
}

export interface FramePayloadValidationSuccess {
  ok: true;
  seedToken?: string;
  hostToken?: string;
  paintEvent?: Record<string, unknown>;
  unfillEvent?: Record<string, unknown>;
}

export type FramePayloadValidationResult =
  | FramePayloadValidationSuccess
  | { ok: false; reason: string };

export type FrameValidator = (ctx: FrameValidationContext) => FramePayloadValidationResult;

function validateOptionalSeedToken(
  raw: unknown
): { ok: true; seedToken?: string } | { ok: false; reason: string } {
  if (raw === undefined) {
    return { ok: true };
  }
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'invalid_seed_token' };
  }
  if (raw.length > MAX_SEED_TOKEN_CHARS) {
    return { ok: false, reason: 'seed_token_too_large' };
  }
  if (!isValidSeedToken(raw)) {
    return { ok: false, reason: 'invalid_seed_token' };
  }
  return { ok: true, seedToken: raw };
}

function validateOptionalHostToken(
  raw: unknown
): { ok: true; hostToken?: string } | { ok: false; reason: string } {
  if (raw === undefined) {
    return { ok: true };
  }
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'invalid_host_token' };
  }
  const trimmed = raw.trim();
  if (
    trimmed.length === 0 ||
    raw.length > MAX_HOST_TOKEN_CHARS ||
    /[\u0000-\u001F\u007F]/.test(trimmed)
  ) {
    return { ok: false, reason: 'invalid_host_token' };
  }
  return { ok: true, hostToken: trimmed };
}

function validateSeedCapableFrame(ctx: FrameValidationContext): FramePayloadValidationResult {
  const { record } = ctx;
  if (record.paintEvent !== undefined || record.unfillEvent !== undefined) {
    return { ok: false, reason: 'invalid_event_payload' };
  }
  const seedCheck = validateOptionalSeedToken(record.seedToken);
  if (!seedCheck.ok) {
    return seedCheck;
  }
  const hostTokenCheck = validateOptionalHostToken(record.hostToken);
  if (!hostTokenCheck.ok) {
    return hostTokenCheck;
  }
  return {
    ok: true,
    ...(seedCheck.seedToken ? { seedToken: seedCheck.seedToken } : {}),
    ...(hostTokenCheck.hostToken ? { hostToken: hostTokenCheck.hostToken } : {}),
  };
}

function validateControlOnlyFrame(ctx: FrameValidationContext): FramePayloadValidationResult {
  const { record } = ctx;
  if (record.seedToken !== undefined) {
    return { ok: false, reason: 'invalid_seed_token' };
  }
  if (record.hostToken !== undefined) {
    return { ok: false, reason: 'invalid_host_token' };
  }
  if (record.paintEvent !== undefined || record.unfillEvent !== undefined) {
    return { ok: false, reason: 'invalid_event_payload' };
  }
  return { ok: true };
}

export const COOP_FRAME_VALIDATORS: Readonly<Record<RelayMessageType, FrameValidator>> =
  Object.freeze({
    HELLO: validateSeedCapableFrame,
    WELCOME_STATE: validateSeedCapableFrame,
    PAINT_EVENT: ({ record, expectedRoomCode, senderPlayerId }) => {
      if (record.seedToken !== undefined) {
        return { ok: false, reason: 'invalid_seed_token' };
      }
      if (record.hostToken !== undefined) {
        return { ok: false, reason: 'invalid_host_token' };
      }
      if (record.unfillEvent !== undefined) {
        return { ok: false, reason: 'invalid_event_payload' };
      }
      const clean = sanitizePaintEvent(record.paintEvent, expectedRoomCode, senderPlayerId);
      if (!clean) {
        return { ok: false, reason: 'invalid_event_payload' };
      }
      return { ok: true, paintEvent: clean };
    },
    UNFILL_EVENT: ({ record, expectedRoomCode, senderPlayerId }) => {
      if (record.seedToken !== undefined) {
        return { ok: false, reason: 'invalid_seed_token' };
      }
      if (record.hostToken !== undefined) {
        return { ok: false, reason: 'invalid_host_token' };
      }
      if (record.paintEvent !== undefined) {
        return { ok: false, reason: 'invalid_event_payload' };
      }
      const clean = sanitizeUnfillEvent(record.unfillEvent, expectedRoomCode, senderPlayerId);
      if (!clean) {
        return { ok: false, reason: 'invalid_event_payload' };
      }
      return { ok: true, unfillEvent: clean };
    },
    HEARTBEAT: validateControlOnlyFrame,
    LEAVE: validateControlOnlyFrame,
  });

export function generateHostToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const maxLen = Math.max(aBytes.byteLength, bBytes.byteLength);
  let diff = aBytes.byteLength ^ bBytes.byteLength;
  for (let i = 0; i < maxLen; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

export function validateCoopFrame(
  rawFrame: string | ArrayBuffer | Uint8Array,
  expectedRoomCode: string
): ValidatedCoopFrameResult {
  if (typeof rawFrame === 'string' && rawFrame.length > MAX_COOP_FRAME_BYTES) {
    return { ok: false, reason: 'frame_size_exceeded' };
  }
  const byteLength = getUtf8ByteLength(rawFrame);
  if (byteLength === 0 || byteLength > MAX_COOP_FRAME_BYTES) {
    return { ok: false, reason: 'frame_size_exceeded' };
  }

  const text =
    typeof rawFrame === 'string'
      ? rawFrame
      : new TextDecoder().decode(
          rawFrame instanceof Uint8Array ? rawFrame : new Uint8Array(rawFrame)
        );

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
  const trimmedPlayerId =
    sender && typeof sender === 'object' && typeof sender.playerId === 'string'
      ? sender.playerId.trim()
      : '';
  if (
    !sender ||
    typeof sender !== 'object' ||
    typeof sender.playerId !== 'string' ||
    trimmedPlayerId.length === 0 ||
    sender.playerId.length > 64 ||
    /[\u0000-\u001F\u007F]/.test(trimmedPlayerId) ||
    typeof sender.displayName !== 'string' ||
    sender.displayName.length > 64
  ) {
    return { ok: false, reason: 'invalid_sender' };
  }
  if (trimmedPlayerId === RESERVED_RELAY_PLAYER_ID) {
    return { ok: false, reason: 'reserved_sender_id' };
  }

  const frameValidator = COOP_FRAME_VALIDATORS[type];
  const payloadValidation = frameValidator({
    record,
    expectedRoomCode,
    senderPlayerId: trimmedPlayerId,
  });
  if (!payloadValidation.ok) {
    return { ok: false, reason: payloadValidation.reason };
  }

  const cleanDisplayName =
    sender.displayName.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 40) ||
    'Capy Painter';

  const sanitizedSender: RelayParticipant = {
    playerId: trimmedPlayerId,
    displayName: cleanDisplayName,
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
    ...(payloadValidation.seedToken ? { seedToken: payloadValidation.seedToken } : {}),
    ...(payloadValidation.hostToken ? { hostToken: payloadValidation.hostToken } : {}),
    ...(payloadValidation.paintEvent ? { paintEvent: payloadValidation.paintEvent } : {}),
    ...(payloadValidation.unfillEvent ? { unfillEvent: payloadValidation.unfillEvent } : {}),
    sentAt:
      typeof record.sentAt === 'number' && Number.isFinite(record.sentAt)
        ? record.sentAt
        : Date.now(),
  };

  return {
    ok: true,
    message: normalizedMessage,
    serialized: JSON.stringify(normalizedMessage),
  };
}

export function resolveBoundSocketSender(
  boundPlayerId: string | null | undefined,
  incomingSender: RelayParticipant
): { ok: true; boundPlayerId: string } | { ok: false; reason: 'sender_mismatch' } {
  const incomingId = incomingSender.playerId.trim();
  if (!boundPlayerId) {
    return { ok: true, boundPlayerId: incomingId };
  }
  if (boundPlayerId !== incomingId) {
    return { ok: false, reason: 'sender_mismatch' };
  }
  return { ok: true, boundPlayerId };
}

export function checkSocketRateLimit(
  timestamps: readonly number[] | undefined,
  nowMs: number,
  maxFrames: number = RATE_LIMIT_MAX_FRAMES,
  windowMs: number = RATE_LIMIT_WINDOW_MS
): { allowed: boolean; timestamps: number[] } {
  const cutoff = nowMs - windowMs;
  const active: number[] = [];
  if (Array.isArray(timestamps)) {
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      if (typeof ts === 'number' && Number.isFinite(ts) && ts > cutoff) {
        active.push(ts);
      }
    }
  }
  if (active.length >= maxFrames) {
    return { allowed: false, timestamps: active };
  }
  active.push(nowMs);
  return { allowed: true, timestamps: active };
}

export function evaluateRoomSeedAction(params: {
  messageType: RelayMessageType;
  incomingSeedToken?: string;
  hasSocketJoined: boolean;
  existingSeedToken: string | null;
  lastSavedSeedToken: string | null;
  lastWriteAtMs: number;
  nowMs: number;
  debounceMs?: number;
  isSeedAuthority?: boolean;
}): 'ignore' | 'write_now' | 'debounce' {
  const {
    messageType,
    incomingSeedToken,
    hasSocketJoined,
    existingSeedToken,
    lastSavedSeedToken,
    lastWriteAtMs,
    nowMs,
    debounceMs = SEED_CHECKPOINT_DEBOUNCE_MS,
    isSeedAuthority = true,
  } = params;

  if (!incomingSeedToken) {
    return 'ignore';
  }

  if (messageType === 'HELLO') {
    if (!isSeedAuthority) {
      return 'ignore';
    }
    return existingSeedToken === null ? 'write_now' : 'ignore';
  }

  if (messageType === 'WELCOME_STATE') {
    if (!hasSocketJoined || !isSeedAuthority || incomingSeedToken === lastSavedSeedToken) {
      return 'ignore';
    }
    return nowMs - lastWriteAtMs >= debounceMs ? 'write_now' : 'debounce';
  }

  return 'ignore';
}
