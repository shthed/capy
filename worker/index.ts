import { DurableObject } from 'cloudflare:workers';
import {
  isAllowedRelayOrigin,
  MAX_COOP_FRAME_BYTES,
  MAX_ROOM_PARTICIPANTS,
  normalizeRoomCode,
  RelayParticipant,
  ROOM_STATE_TTL_MS,
  validateCoopFrame,
} from './coopRoomProtocol';

interface SocketAttachment {
  roomCode: string;
  participant: RelayParticipant | null;
}

/**
 * Hibernating SQLite-backed Durable Object coordinating a single 6-character Co-op room.
 * Uses Cloudflare's WebSocket Hibernation API so idle sockets consume 0 CPU ms between strokes.
 */
export class CoopRoomDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return Response.json({ error: 'Expected WebSocket Upgrade' }, { status: 426 });
    }

    const url = new URL(request.url);
    const roomCode = normalizeRoomCode(url.searchParams.get('room'));
    if (!roomCode) {
      return Response.json({ error: 'Invalid room code' }, { status: 400 });
    }

    const activeSockets = this.ctx.getWebSockets();
    if (activeSockets.length >= MAX_ROOM_PARTICIPANTS) {
      return Response.json({ error: 'Co-op room is full' }, { status: 429 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const initialAttachment: SocketAttachment = {
      roomCode,
      participant: null,
    };
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(initialAttachment);

    await this.ctx.storage.setAlarm(Date.now() + ROOM_STATE_TTL_MS);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = (ws.deserializeAttachment() as SocketAttachment | null) ?? null;
    if (!attachment?.roomCode) {
      ws.close(1008, 'Missing room attachment');
      return;
    }

    const validation = validateCoopFrame(message, attachment.roomCode);
    if (!validation.ok || !validation.message || !validation.serialized) {
      if (validation.reason === 'frame_size_exceeded') {
        ws.close(1009, `Frame exceeds ${MAX_COOP_FRAME_BYTES} byte limit`);
      }
      return;
    }

    const parsed = validation.message;
    attachment.participant = parsed.sender;
    ws.serializeAttachment(attachment);

    if (parsed.seedToken && (parsed.type === 'HELLO' || parsed.type === 'WELCOME_STATE')) {
      this.saveRoomSeedToken(attachment.roomCode, parsed.seedToken);
    }

    const sockets = this.ctx.getWebSockets();
    let deliveredCount = 0;
    for (const peer of sockets) {
      if (peer === ws) continue;
      try {
        peer.send(validation.serialized);
        deliveredCount++;
      } catch {
        // Closed or broken peer socket is cleaned up in webSocketClose/webSocketError
      }
    }

    // If a player joins or reconnects when no active peer replied yet, hydrate from SQLite seedToken
    if (parsed.type === 'HELLO' && deliveredCount === 0) {
      const storedSeed = this.loadRoomSeedToken();
      if (storedSeed && storedSeed !== parsed.seedToken) {
        try {
          ws.send(
            JSON.stringify({
              type: 'WELCOME_STATE',
              roomCode: attachment.roomCode,
              sender: {
                playerId: '__capy_room_relay__',
                displayName: 'Room Relay',
                avatarColorHex: '#38bdf8',
                lastActiveAt: Date.now(),
              },
              seedToken: storedSeed,
              sentAt: Date.now(),
            })
          );
        } catch {
          // Ignore send failure on closing socket
        }
      }
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean
  ): Promise<void> {
    this.broadcastDeparture(ws);
    try {
      ws.close(code, reason.slice(0, 100));
    } catch {
      // Already closed
    }
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    this.broadcastDeparture(ws);
    try {
      ws.close(1011, 'WebSocket error');
    } catch {
      // Already closed
    }
  }

  async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length === 0) {
      this.ctx.storage.sql.exec('DELETE FROM room_state');
    } else {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_STATE_TTL_MS);
    }
  }

  private broadcastDeparture(closedWs: WebSocket): void {
    const attachment = (closedWs.deserializeAttachment() as SocketAttachment | null) ?? null;
    if (!attachment?.roomCode || !attachment.participant) return;

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

  private saveRoomSeedToken(roomCode: string, seedToken: string): void {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO room_state (key, value, updated_at)
       VALUES ('seed_token', ?, ?), ('room_code', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      seedToken,
      now,
      roomCode,
      now
    );
  }

  private loadRoomSeedToken(): string | null {
    const rows = this.ctx.storage.sql
      .exec<{ value: string }>(`SELECT value FROM room_state WHERE key = 'seed_token' LIMIT 1`)
      .toArray();
    return rows.length > 0 ? rows[0].value : null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Redirect www.capypaint.com -> capypaint.com so localStorage/IndexedDB origin stays canonical
    if (url.hostname.toLowerCase() === 'www.capypaint.com') {
      url.hostname = 'capypaint.com';
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === '/api/health') {
      return Response.json(
        {
          ok: true,
          service: 'capy-paint',
          domain: 'capypaint.com',
          coopRelay: 'durable-objects-sqlite',
        },
        {
          headers: {
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    if (url.pathname === '/api/room') {
      const origin = request.headers.get('Origin');
      if (!isAllowedRelayOrigin(origin)) {
        console.error(
          JSON.stringify({
            event: 'coop_origin_rejected',
            origin,
          })
        );
        return Response.json({ error: 'Forbidden origin' }, { status: 403 });
      }

      const roomCode = normalizeRoomCode(url.searchParams.get('room'));
      if (!roomCode) {
        return Response.json({ error: 'Missing or invalid ?room= parameter' }, { status: 400 });
      }

      const roomId = env.COOP_ROOMS.idFromName(roomCode);
      const roomStub = env.COOP_ROOMS.get(roomId);
      return roomStub.fetch(request);
    }

    if (url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
