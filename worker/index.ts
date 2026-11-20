import { DurableObject } from 'cloudflare:workers';
import {
  checkSocketRateLimit,
  evaluateRoomSeedAction,
  isAllowedRelayOrigin,
  MAX_COOP_FRAME_BYTES,
  MAX_ROOM_PARTICIPANTS,
  normalizeRoomCode,
  RelayParticipant,
  RESERVED_RELAY_PLAYER_ID,
  resolveBoundSocketSender,
  ROOM_STATE_TTL_MS,
  SEED_CHECKPOINT_DEBOUNCE_MS,
  validateCoopFrame,
} from './coopRoomProtocol';

import {
  buildFallbackIssueUrl,
  buildFeedbackCorsHeaders,
  buildGitHubIssuePayload,
  MAX_FEEDBACK_BODY_BYTES,
  resolveFeedbackRepo,
  validateFeedbackPayload,
} from './feedbackProtocol';

interface SocketAttachment {
  roomCode: string;
  boundPlayerId?: string | null;
  participant: RelayParticipant | null;
  joinedAt?: number;
}

interface RoomSeedRecord {
  seedToken: string;
  updatedAt: number;
}

const API_SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['X-Content-Type-Options', 'nosniff'],
  ['Cache-Control', 'no-store'],
  ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['X-Frame-Options', 'DENY'],
];

function mergeApiSecurityHeaders(extraHeaders?: Record<string, string>): Headers {
  const headers = new Headers(extraHeaders);
  for (const [name, value] of API_SECURITY_HEADERS) {
    headers.set(name, value);
  }
  return headers;
}

function withApiSecurityHeaders(res: Response): Response {
  if (res.status === 101) return res;
  const headers = new Headers(res.headers);
  for (const [name, value] of API_SECURITY_HEADERS) {
    headers.set(name, value);
  }
  return new Response(res.body ?? null, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

function apiJsonResponse(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>
): Response {
  return Response.json(body, {
    status,
    headers: mergeApiSecurityHeaders(extraHeaders),
  });
}

async function checkApiRateLimit(
  request: Request,
  env: Env,
  bucket: string,
  limiterOverride?: RateLimitBinding,
  extraHeaders?: Record<string, string>
): Promise<Response | null> {
  const limiter = limiterOverride ?? env.API_RATE_LIMITER;
  if (!limiter) return null;
  const clientIp =
    (
      request.headers.get('CF-Connecting-IP') ||
      request.headers.get('X-Forwarded-For')?.split(',')[0] ||
      ''
    ).trim() || 'unknown';
  const rl = await limiter.limit({ key: `${bucket}:${clientIp}` });
  if (!rl.success) {
    return apiJsonResponse({ ok: false, error: 'Too many requests' }, 429, {
      ...extraHeaders,
      'Retry-After': '60',
    });
  }
  return null;
}

/**
 * Hibernating SQLite-backed Durable Object coordinating a single 6-character Co-op room.
 * Uses Cloudflare's WebSocket Hibernation API + C++ PING/PONG auto-response so idle sockets
 * consume 0 CPU ms between strokes.
 */
export class CoopRoomDurableObject extends DurableObject<Env> {
  private lastSeedWriteAt = 0;
  private lastSavedSeedToken: string | null = null;
  private hostPlayerId: string | null = null;
  private hostPlayerIdUpdatedAt = 0;
  private pendingCheckpoint: {
    roomCode: string;
    seedToken: string;
    hostPlayerId?: string;
    updatedAt: number;
  } | null = null;
  private readonly rateLimitWindows = new WeakMap<WebSocket, number[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('PING', 'PONG'));
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      const now = Date.now();
      const hostRecord = this.loadHostPlayerIdFromSql(now);
      this.hostPlayerId = hostRecord?.hostPlayerId ?? null;
      this.hostPlayerIdUpdatedAt = hostRecord?.updatedAt ?? 0;
      this.restorePendingCheckpointFromSql(now);
    });
  }

  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== 'GET') {
        return apiJsonResponse({ error: 'Method not allowed' }, 405, {
          Allow: 'GET',
        });
      }

      const origin = request.headers.get('Origin');
      if (
        !isAllowedRelayOrigin(
          origin,
          this.env.ALLOWED_EXTRA_ORIGINS,
          this.env.ALLOW_LOCALHOST_ORIGINS === 'true'
        )
      ) {
        return apiJsonResponse({ error: 'Forbidden origin' }, 403);
      }

      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return apiJsonResponse({ error: 'Expected WebSocket Upgrade' }, 426);
      }

      const url = new URL(request.url);
      const roomCode = normalizeRoomCode(url.searchParams.get('room'));
      if (!roomCode) {
        return apiJsonResponse({ error: 'Invalid room code' }, 400);
      }

      const activeSockets = this.ctx.getWebSockets();
      if (activeSockets.length >= MAX_ROOM_PARTICIPANTS) {
        return apiJsonResponse({ error: 'Co-op room is full' }, 429, {
          'Retry-After': '60',
        });
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      const now = Date.now();
      const initialAttachment: SocketAttachment = {
        roomCode,
        boundPlayerId: null,
        participant: null,
      };
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment(initialAttachment);

      if (!this.getPendingCheckpoint(now)) {
        await this.ctx.storage.setAlarm(now + ROOM_STATE_TTL_MS);
      }

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    } catch (err) {
      console.error(
        JSON.stringify({
          event: 'coop_do_fetch_error',
          message: err instanceof Error ? err.message : 'unknown',
        })
      );
      return apiJsonResponse({ error: 'Internal relay error' }, 500);
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      if (message === 'PING') {
        try {
          ws.send('PONG');
        } catch {
          // Ignore closed socket
        }
        return;
      }

      if (message instanceof ArrayBuffer && message.byteLength > MAX_COOP_FRAME_BYTES) {
        ws.close(1009, `Frame exceeds ${MAX_COOP_FRAME_BYTES} byte limit`);
        return;
      }

      const attachment = (ws.deserializeAttachment() as SocketAttachment | null) ?? null;
      if (!attachment?.roomCode) {
        ws.close(1008, 'Missing room attachment');
        return;
      }

      const now = Date.now();
      const rate = checkSocketRateLimit(this.rateLimitWindows.get(ws), now);
      this.rateLimitWindows.set(ws, rate.timestamps);
      if (!rate.allowed) {
        ws.close(1008, 'Rate limit exceeded');
        return;
      }

      const validation = validateCoopFrame(message, attachment.roomCode);
      if (!validation.ok || !validation.message || !validation.serialized) {
        if (validation.reason === 'frame_size_exceeded') {
          ws.close(1009, `Frame exceeds ${MAX_COOP_FRAME_BYTES} byte limit`);
        } else if (validation.reason === 'reserved_sender_id') {
          ws.close(1008, 'Reserved sender ID');
        }
        return;
      }

      const parsed = validation.message;
      const senderCheck = resolveBoundSocketSender(
        attachment.boundPlayerId ?? attachment.participant?.playerId ?? null,
        parsed.sender
      );
      if (!senderCheck.ok) {
        ws.close(1008, 'Sender identity mismatch');
        return;
      }

      const prevAttachment = attachment;
      const wasJoined = Boolean(prevAttachment.joinedAt);
      if (!wasJoined && parsed.type !== 'HELLO') {
        return;
      }

      const nextJoinedAt =
        parsed.type === 'HELLO' && !prevAttachment.joinedAt ? now : prevAttachment.joinedAt;
      const participantChanged =
        prevAttachment.boundPlayerId !== senderCheck.boundPlayerId ||
        prevAttachment.joinedAt !== nextJoinedAt ||
        prevAttachment.participant?.playerId !== parsed.sender.playerId ||
        prevAttachment.participant?.displayName !== parsed.sender.displayName ||
        prevAttachment.participant?.avatarColorHex !== parsed.sender.avatarColorHex;

      attachment.boundPlayerId = senderCheck.boundPlayerId;
      attachment.participant = parsed.sender;
      attachment.joinedAt = nextJoinedAt;
      if (participantChanged) {
        ws.serializeAttachment(attachment);
      }

      this.expireStaleRoomState(now);
      const currentRecord = this.loadRoomSeedRecord(now);
      if (this.lastSeedWriteAt === 0 && currentRecord) {
        this.lastSeedWriteAt = currentRecord.updatedAt;
        this.lastSavedSeedToken = currentRecord.seedToken;
      }
      const pending = this.getPendingCheckpoint(now);
      const effectiveSeed =
        pending?.seedToken ?? currentRecord?.seedToken ?? this.lastSavedSeedToken;
      const sqlHost = this.hostPlayerId ? null : this.loadHostPlayerIdFromSql(now);
      if (!this.hostPlayerId && sqlHost) {
        this.hostPlayerId = sqlHost.hostPlayerId;
        this.hostPlayerIdUpdatedAt = sqlHost.updatedAt;
      } else if (!this.hostPlayerId && pending?.hostPlayerId) {
        this.hostPlayerId = pending.hostPlayerId;
        this.hostPlayerIdUpdatedAt = pending.updatedAt;
      }
      let effectiveHostId = this.hostPlayerId;

      if (parsed.type === 'HELLO' && !effectiveHostId) {
        this.lockHostPlayerId(attachment.roomCode, senderCheck.boundPlayerId, now);
        effectiveHostId = this.hostPlayerId;
      }

      const isSeedAuthority = Boolean(
        effectiveHostId && senderCheck.boundPlayerId === effectiveHostId
      );

      let outboundSerialized = validation.serialized;

      if (parsed.type === 'WELCOME_STATE' && !isSeedAuthority) {
        return;
      }

      if (parsed.seedToken && (parsed.type === 'HELLO' || parsed.type === 'WELCOME_STATE')) {
        if (
          parsed.type === 'HELLO' &&
          ((effectiveSeed !== null && parsed.seedToken !== effectiveSeed) ||
            (!isSeedAuthority && parsed.seedToken !== effectiveSeed))
        ) {
          const sanitizedHello = { ...parsed };
          delete sanitizedHello.seedToken;
          outboundSerialized = JSON.stringify(sanitizedHello);
        }

        const seedAction = evaluateRoomSeedAction({
          messageType: parsed.type,
          incomingSeedToken: parsed.seedToken,
          hasSocketJoined: Boolean(attachment.joinedAt),
          existingSeedToken: effectiveSeed,
          lastSavedSeedToken: effectiveSeed,
          lastWriteAtMs: this.lastSeedWriteAt,
          nowMs: now,
          isSeedAuthority,
        });

        if (seedAction === 'write_now') {
          this.saveRoomSeedToken(
            attachment.roomCode,
            parsed.seedToken,
            now,
            effectiveHostId ?? undefined
          );
        } else if (seedAction === 'debounce') {
          this.savePendingCheckpoint(
            attachment.roomCode,
            parsed.seedToken,
            now,
            effectiveHostId ?? undefined
          );
          const nextAlarmAt = Math.max(
            now + 250,
            this.lastSeedWriteAt + SEED_CHECKPOINT_DEBOUNCE_MS
          );
          await this.ctx.storage.setAlarm(nextAlarmAt);
        }
      }

      const sockets = this.ctx.getWebSockets();
      for (const peer of sockets) {
        if (peer === ws) continue;
        try {
          peer.send(outboundSerialized);
        } catch {
          // Closed or broken peer socket is cleaned up in webSocketClose/webSocketError
        }
      }

      // Hydrate joining/reconnecting socket from authoritative SQLite seedToken whenever it lacks or differs
      if (parsed.type === 'HELLO') {
        const storedSeed =
          this.getPendingCheckpoint(now)?.seedToken ??
          this.loadRoomSeedRecord(now)?.seedToken ??
          null;
        if (storedSeed && storedSeed !== parsed.seedToken) {
          try {
            ws.send(
              JSON.stringify({
                type: 'WELCOME_STATE',
                roomCode: attachment.roomCode,
                sender: {
                  playerId: RESERVED_RELAY_PLAYER_ID,
                  displayName: 'Room Relay',
                  avatarColorHex: '#38bdf8',
                  lastActiveAt: now,
                },
                seedToken: storedSeed,
                sentAt: now,
              })
            );
          } catch {
            // Ignore send failure on closing socket
          }
        }
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          event: 'coop_ws_message_error',
          message: err instanceof Error ? err.message : 'unknown',
        })
      );
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean
  ): Promise<void> {
    try {
      this.rateLimitWindows.delete(ws);
      const now = Date.now();
      this.expireStaleRoomState(now);
      this.flushPendingCheckpoint(now);
      this.broadcastDeparture(ws);
      if (
        this.ctx.getWebSockets().length <= 1 &&
        (this.loadRoomSeedRecord(now) || this.hostPlayerId || this.loadHostPlayerIdFromSql(now))
      ) {
        await this.ctx.storage.setAlarm(now + ROOM_STATE_TTL_MS);
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          event: 'coop_ws_close_error',
          message: err instanceof Error ? err.message : 'unknown',
        })
      );
    }
    try {
      ws.close(code, reason.slice(0, 100));
    } catch {
      // Already closed
    }
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    try {
      this.rateLimitWindows.delete(ws);
      const now = Date.now();
      this.expireStaleRoomState(now);
      this.flushPendingCheckpoint(now);
      this.broadcastDeparture(ws);
      if (
        this.ctx.getWebSockets().length <= 1 &&
        (this.loadRoomSeedRecord(now) || this.hostPlayerId || this.loadHostPlayerIdFromSql(now))
      ) {
        await this.ctx.storage.setAlarm(now + ROOM_STATE_TTL_MS);
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          event: 'coop_ws_error_cleanup',
          message: err instanceof Error ? err.message : 'unknown',
        })
      );
    }
    try {
      ws.close(1011, 'WebSocket error');
    } catch {
      // Already closed
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    this.expireStaleRoomState(now);
    this.flushPendingCheckpoint(now);
    const record = this.loadRoomSeedRecord(now);
    if (this.ctx.getWebSockets().length === 0) {
      if (record) {
        const expiresAt = record.updatedAt + ROOM_STATE_TTL_MS;
        if (now >= expiresAt) {
          this.clearRoomState();
        } else {
          await this.ctx.storage.setAlarm(expiresAt);
        }
      } else {
        this.clearRoomState();
      }
      return;
    }

    if (this.isHostPlayerIdExpired(now)) {
      this.clearRoomState();
    } else {
      const hostRecord = this.loadHostPlayerIdFromSql(now);
      if (hostRecord && now >= hostRecord.updatedAt + ROOM_STATE_TTL_MS) {
        this.clearRoomState();
      } else {
        this.ctx.storage.sql.exec(
          'DELETE FROM room_state WHERE updated_at <= ?',
          now - ROOM_STATE_TTL_MS
        );
      }
    }
    await this.ctx.storage.setAlarm(now + ROOM_STATE_TTL_MS);
  }

  private clearRoomState(): void {
    this.ctx.storage.sql.exec('DELETE FROM room_state');
    this.pendingCheckpoint = null;
    this.hostPlayerId = null;
    this.hostPlayerIdUpdatedAt = 0;
    this.lastSavedSeedToken = null;
    this.lastSeedWriteAt = 0;
  }

  private isHostPlayerIdExpired(now: number): boolean {
    return (
      this.hostPlayerId !== null &&
      (this.hostPlayerIdUpdatedAt <= 0 || now - this.hostPlayerIdUpdatedAt >= ROOM_STATE_TTL_MS)
    );
  }

  private expireStaleRoomState(now: number): boolean {
    if (this.isHostPlayerIdExpired(now)) {
      this.clearRoomState();
      return true;
    }
    const hostRows = this.ctx.storage.sql
      .exec<{ updated_at: number }>(
        `SELECT updated_at FROM room_state WHERE key = 'host_player_id' LIMIT 1`
      )
      .toArray();
    if (hostRows.length > 0 && now - hostRows[0].updated_at >= ROOM_STATE_TTL_MS) {
      this.clearRoomState();
      return true;
    }
    const seedRows = this.ctx.storage.sql
      .exec<{ updated_at: number }>(
        `SELECT updated_at FROM room_state WHERE key = 'seed_token' LIMIT 1`
      )
      .toArray();
    if (seedRows.length > 0 && now - seedRows[0].updated_at >= ROOM_STATE_TTL_MS) {
      this.clearRoomState();
      return true;
    }
    if (
      this.pendingCheckpoint &&
      now - this.pendingCheckpoint.updatedAt >= ROOM_STATE_TTL_MS
    ) {
      this.clearRoomState();
      return true;
    }
    const pendingRows = this.ctx.storage.sql
      .exec<{ updated_at: number }>(
        `SELECT updated_at FROM room_state WHERE key = 'pending_seed' LIMIT 1`
      )
      .toArray();
    if (pendingRows.length > 0 && now - pendingRows[0].updated_at >= ROOM_STATE_TTL_MS) {
      this.clearRoomState();
      return true;
    }
    return false;
  }

  private loadHostPlayerIdFromSql(
    now: number = Date.now()
  ): { hostPlayerId: string; updatedAt: number } | null {
    const rows = this.ctx.storage.sql
      .exec<{ value: string; updated_at: number }>(
        `SELECT value, updated_at FROM room_state WHERE key = 'host_player_id' LIMIT 1`
      )
      .toArray();
    if (rows.length === 0) return null;
    const row = rows[0];
    if (now - row.updated_at >= ROOM_STATE_TTL_MS) {
      this.clearRoomState();
      return null;
    }
    const raw = row.value?.trim();
    return raw ? { hostPlayerId: raw, updatedAt: row.updated_at } : null;
  }

  private lockHostPlayerId(
    roomCode: string,
    hostPlayerId: string,
    now: number = Date.now()
  ): void {
    if (this.isHostPlayerIdExpired(now)) {
      this.clearRoomState();
    }
    if (this.hostPlayerId) return;
    const existing = this.loadHostPlayerIdFromSql(now);
    if (existing) {
      this.hostPlayerId = existing.hostPlayerId;
      this.hostPlayerIdUpdatedAt = existing.updatedAt;
      return;
    }
    this.hostPlayerId = hostPlayerId;
    this.hostPlayerIdUpdatedAt = now;
    this.ctx.storage.sql.exec(
      `INSERT INTO room_state (key, value, updated_at)
       VALUES ('host_player_id', ?, ?)
       ON CONFLICT(key) DO NOTHING`,
      hostPlayerId,
      now
    );
    this.ctx.storage.sql.exec(
      `INSERT INTO room_state (key, value, updated_at)
       VALUES ('room_code', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      roomCode,
      now
    );
  }

  private getPendingCheckpoint(
    now: number
  ): { roomCode: string; seedToken: string; hostPlayerId?: string; updatedAt: number } | null {
    if (this.pendingCheckpoint) {
      if (now - this.pendingCheckpoint.updatedAt >= ROOM_STATE_TTL_MS) {
        this.pendingCheckpoint = null;
        this.ctx.storage.sql.exec(`DELETE FROM room_state WHERE key = 'pending_seed'`);
        return null;
      }
      return this.pendingCheckpoint;
    }
    this.restorePendingCheckpointFromSql(now);
    return this.pendingCheckpoint;
  }

  private savePendingCheckpoint(
    roomCode: string,
    seedToken: string,
    now: number,
    hostPlayerId?: string
  ): void {
    this.pendingCheckpoint = { roomCode, seedToken, hostPlayerId, updatedAt: now };
    this.ctx.storage.sql.exec(
      `INSERT INTO room_state (key, value, updated_at)
       VALUES ('pending_seed', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      JSON.stringify({ roomCode, seedToken, ...(hostPlayerId ? { hostPlayerId } : {}) }),
      now
    );
  }

  private restorePendingCheckpointFromSql(now: number): void {
    const rows = this.ctx.storage.sql
      .exec<{ value: string; updated_at: number }>(
        `SELECT value, updated_at FROM room_state WHERE key = 'pending_seed' LIMIT 1`
      )
      .toArray();
    if (rows.length === 0) return;
    const row = rows[0];
    if (now - row.updated_at >= ROOM_STATE_TTL_MS) {
      this.ctx.storage.sql.exec(`DELETE FROM room_state WHERE key = 'pending_seed'`);
      this.pendingCheckpoint = null;
      return;
    }
    try {
      const parsed = JSON.parse(row.value) as {
        roomCode?: string;
        seedToken?: string;
        hostPlayerId?: string;
      };
      if (typeof parsed.roomCode === 'string' && typeof parsed.seedToken === 'string') {
        this.pendingCheckpoint = {
          roomCode: parsed.roomCode,
          seedToken: parsed.seedToken,
          ...(typeof parsed.hostPlayerId === 'string' ? { hostPlayerId: parsed.hostPlayerId } : {}),
          updatedAt: row.updated_at,
        };
      }
    } catch {
      this.ctx.storage.sql.exec(`DELETE FROM room_state WHERE key = 'pending_seed'`);
    }
  }

  private flushPendingCheckpoint(now: number): void {
    if (this.expireStaleRoomState(now)) return;
    const pending = this.getPendingCheckpoint(now);
    if (!pending) return;
    if (now - pending.updatedAt >= ROOM_STATE_TTL_MS) {
      this.clearRoomState();
      return;
    }
    this.saveRoomSeedToken(pending.roomCode, pending.seedToken, now, pending.hostPlayerId);
  }

  private broadcastDeparture(closedWs: WebSocket): void {
    const attachment = (closedWs.deserializeAttachment() as SocketAttachment | null) ?? null;
    if (!attachment?.roomCode || !attachment.joinedAt || !attachment.participant) return;

    const leavePayload = JSON.stringify({
      type: 'LEAVE',
      roomCode: attachment.roomCode,
      sender: attachment.participant,
      sentAt: Date.now(),
    });

    for (const peer of this.ctx.getWebSockets()) {
      if (peer === closedWs) continue;
      try {
        peer.send(leavePayload);
      } catch {
        // Ignore peer send errors
      }
    }
  }

  private saveRoomSeedToken(
    roomCode: string,
    seedToken: string,
    now: number = Date.now(),
    hostPlayerId?: string
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO room_state (key, value, updated_at)
       VALUES ('seed_token', ?, ?), ('room_code', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      seedToken,
      now,
      roomCode,
      now
    );
    if (hostPlayerId) {
      if (!this.hostPlayerId) {
        this.hostPlayerId = hostPlayerId;
      }
      this.hostPlayerIdUpdatedAt = now;
      this.ctx.storage.sql.exec(
        `INSERT INTO room_state (key, value, updated_at)
         VALUES ('host_player_id', ?, ?)
         ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at`,
        this.hostPlayerId,
        now
      );
    }
    this.ctx.storage.sql.exec(`DELETE FROM room_state WHERE key = 'pending_seed'`);
    this.lastSeedWriteAt = now;
    this.lastSavedSeedToken = seedToken;
    this.pendingCheckpoint = null;
  }

  private loadRoomSeedRecord(now: number = Date.now()): RoomSeedRecord | null {
    const rows = this.ctx.storage.sql
      .exec<{ value: string; updated_at: number }>(
        `SELECT value, updated_at FROM room_state WHERE key = 'seed_token' LIMIT 1`
      )
      .toArray();
    if (rows.length === 0) return null;
    const row = rows[0];
    if (now - row.updated_at >= ROOM_STATE_TTL_MS) {
      this.clearRoomState();
      return null;
    }
    return {
      seedToken: row.value,
      updatedAt: row.updated_at,
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);

      // Redirect www.capypaint.com -> capypaint.com so localStorage/IndexedDB origin stays canonical
      if (url.hostname.toLowerCase() === 'www.capypaint.com') {
        url.hostname = 'capypaint.com';
        return Response.redirect(url.toString(), 301);
      }

      if (url.pathname === '/api/health') {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return apiJsonResponse({ error: 'Method not allowed' }, 405, {
            Allow: 'GET, HEAD',
          });
        }

        const rateLimited = await checkApiRateLimit(request, env, 'health');
        if (rateLimited) return rateLimited;

        if (request.method === 'HEAD') {
          return withApiSecurityHeaders(
            new Response(null, {
              status: 200,
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
              },
            })
          );
        }

        return apiJsonResponse(
          {
            ok: true,
            service: 'capy-paint',
            domain: 'capypaint.com',
            coopRelay: 'durable-objects-sqlite',
          },
          200
        );
      }

      if (url.pathname === '/api/room') {
        if (request.method !== 'GET') {
          return apiJsonResponse({ error: 'Method not allowed' }, 405, {
            Allow: 'GET',
          });
        }

        const origin = request.headers.get('Origin');
        if (
          !isAllowedRelayOrigin(
            origin,
            env.ALLOWED_EXTRA_ORIGINS,
            env.ALLOW_LOCALHOST_ORIGINS === 'true'
          )
        ) {
          console.error(
            JSON.stringify({
              event: 'coop_origin_rejected',
              origin,
            })
          );
          return apiJsonResponse({ error: 'Forbidden origin' }, 403);
        }

        const upgradeHeader = request.headers.get('Upgrade');
        if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
          return apiJsonResponse({ error: 'Expected WebSocket Upgrade' }, 426);
        }

        const roomCode = normalizeRoomCode(url.searchParams.get('room'));
        if (!roomCode) {
          return apiJsonResponse({ error: 'Missing or invalid ?room= parameter' }, 400);
        }

        const rateLimited = await checkApiRateLimit(request, env, 'room');
        if (rateLimited) return rateLimited;

        const roomId = env.COOP_ROOMS.idFromName(roomCode);
        const roomStub = env.COOP_ROOMS.get(roomId);
        const roomRes = await roomStub.fetch(request);
        return roomRes.status === 101 ? roomRes : withApiSecurityHeaders(roomRes);
      }

      if (url.pathname === '/api/feedback') {
        const origin = request.headers.get('Origin');
        const allowLocalhost = env.ALLOW_LOCALHOST_ORIGINS === 'true';
        const originAllowed = isAllowedRelayOrigin(
          origin,
          env.ALLOWED_EXTRA_ORIGINS,
          allowLocalhost
        );
        const corsHeaders = buildFeedbackCorsHeaders(
          origin,
          env.ALLOWED_EXTRA_ORIGINS,
          allowLocalhost
        );

        if (!originAllowed) {
          console.error(
            JSON.stringify({
              event: 'feedback_origin_rejected',
              origin,
            })
          );
          return apiJsonResponse({ ok: false, error: 'Forbidden origin' }, 403, corsHeaders);
        }

        if (request.method === 'OPTIONS') {
          return withApiSecurityHeaders(
            new Response(null, {
              status: 204,
              headers: corsHeaders,
            })
          );
        }

        if (request.method !== 'POST') {
          return apiJsonResponse({ ok: false, error: 'Method not allowed' }, 405, {
            ...corsHeaders,
            Allow: 'POST, OPTIONS',
          });
        }

        const rateLimited = await checkApiRateLimit(
          request,
          env,
          'feedback',
          env.FEEDBACK_RATE_LIMITER ?? env.API_RATE_LIMITER,
          corsHeaders
        );
        if (rateLimited) return rateLimited;

        const contentType = request.headers.get('Content-Type') || '';
        if (!contentType.toLowerCase().includes('application/json')) {
          return apiJsonResponse(
            { ok: false, error: 'Expected application/json content type.' },
            415,
            corsHeaders
          );
        }

        const rawContentLength = request.headers.get('Content-Length');
        if (rawContentLength !== null) {
          const parsedLength = Number(rawContentLength);
          if (Number.isFinite(parsedLength) && parsedLength > MAX_FEEDBACK_BODY_BYTES) {
            return apiJsonResponse(
              {
                ok: false,
                error: `Feedback payload exceeds the ${MAX_FEEDBACK_BODY_BYTES}-byte limit.`,
              },
              413,
              corsHeaders
            );
          }
        }

        const rawBody = await request.text();
        const validation = validateFeedbackPayload(rawBody);
        if (!validation.ok) {
          if (validation.honeypot) {
            return apiJsonResponse({ ok: true, accepted: true }, 202, corsHeaders);
          }
          return apiJsonResponse(
            { ok: false, error: validation.error },
            validation.status ?? 400,
            corsHeaders
          );
        }

        const repo = resolveFeedbackRepo(env.CAPYBOOP_FEEDBACK_REPO);
        const fallbackUrl = buildFallbackIssueUrl(validation.payload, repo);
        const token = env.CAPYBOOP_FEEDBACK_TOKEN?.trim();
        if (!token) {
          return apiJsonResponse(
            {
              ok: false,
              code: 'feedback_unconfigured',
              error:
                'In-app feedback relay is not configured yet. You can submit directly on GitHub.',
              fallbackUrl,
            },
            503,
            corsHeaders
          );
        }

        const issuePayload = buildGitHubIssuePayload(validation.payload);
        try {
          const ghRes = await fetch(`https://api.github.com/repos/${repo}/issues`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'Capy-Paint-Feedback-Relay',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(issuePayload),
          });

          if (!ghRes.ok) {
            console.error(
              JSON.stringify({
                event: 'feedback_github_error',
                status: ghRes.status,
              })
            );
            return apiJsonResponse(
              {
                ok: false,
                code: 'upstream_error',
                error:
                  'Could not reach GitHub right now. Please try again or use the GitHub link.',
                fallbackUrl,
              },
              502,
              corsHeaders
            );
          }

          const created = await ghRes.json<{ number?: number; html_url?: string }>();
          const issueNumber = typeof created?.number === 'number' ? created.number : undefined;
          const issueUrl =
            typeof created?.html_url === 'string' && created.html_url.startsWith('https://')
              ? created.html_url
              : `https://github.com/${repo}/issues`;

          return apiJsonResponse(
            {
              ok: true,
              issueNumber,
              issueUrl,
            },
            201,
            corsHeaders
          );
        } catch (ghErr) {
          console.error(
            JSON.stringify({
              event: 'feedback_github_error',
              status: 'network_exception',
              message: ghErr instanceof Error ? ghErr.name : 'unknown',
            })
          );
          return apiJsonResponse(
            {
              ok: false,
              code: 'upstream_error',
              error:
                'Could not reach GitHub right now. Please try again or use the GitHub link.',
              fallbackUrl,
            },
            502,
            corsHeaders
          );
        }
      }

      if (url.pathname.startsWith('/api/')) {
        const rateLimited = await checkApiRateLimit(request, env, 'api');
        if (rateLimited) return rateLimited;
        return apiJsonResponse({ error: 'Not found' }, 404);
      }

      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(
        JSON.stringify({
          event: 'worker_fetch_error',
          message: err instanceof Error ? err.message : 'unknown',
        })
      );
      return apiJsonResponse({ error: 'Internal relay error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
