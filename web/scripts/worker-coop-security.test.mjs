import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(WEB_ROOT, '..');

export async function runWorkerCoopSecurityTests(vite) {
  const protoMod = await vite.ssrLoadModule('../worker/coopRoomProtocol.ts');
  const codecMod = await vite.ssrLoadModule('/src/services/CapyCodec.ts');

  const seedA = await codecMod.encodeProgressDeltaToken({
    version: 2,
    sourceRef: { kind: 'sample', uri: 'assets/capybara.webp' },
    filledRegionIds: [1, 2],
    updatedAt: 1000,
  });
  const seedB = await codecMod.encodeProgressDeltaToken({
    version: 2,
    sourceRef: { kind: 'sample', uri: 'assets/capybara.webp' },
    filledRegionIds: [1, 2, 3],
    updatedAt: 2000,
  });
  const seedC = await codecMod.encodeProgressDeltaToken({
    version: 2,
    sourceRef: { kind: 'sample', uri: 'assets/capybara.webp' },
    filledRegionIds: [4, 5],
    updatedAt: 3000,
  });

  // 1. Declarative per-frame validator table (COOP_FRAME_VALIDATORS)
  {
    assert.equal(
      Object.isFrozen(protoMod.COOP_FRAME_VALIDATORS),
      true,
      'COOP_FRAME_VALIDATORS must be frozen'
    );
    assert.equal(
      Object.getPrototypeOf(protoMod.COOP_FRAME_VALIDATORS),
      null,
      'COOP_FRAME_VALIDATORS must be null-prototype for safe direct lookups'
    );
    for (const msgType of protoMod.VALID_MESSAGE_TYPES) {
      assert.equal(
        typeof protoMod.COOP_FRAME_VALIDATORS[msgType],
        'function',
        `COOP_FRAME_VALIDATORS must define a validator for ${msgType}`
      );
    }

    const baseSender = { playerId: 'p1', displayName: 'Alice', avatarColorHex: '#fbbf24' };

    // Valid frames for every message type
    assert.equal(
      protoMod.validateCoopFrame(
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'SEC123',
          sender: baseSender,
          seedToken: seedA,
          hostToken: 'tok-valid-123',
        }),
        'SEC123'
      ).ok,
      true
    );
    assert.equal(
      protoMod.validateCoopFrame(
        JSON.stringify({
          type: 'WELCOME_STATE',
          roomCode: 'SEC123',
          sender: baseSender,
          seedToken: seedA,
          hostToken: 'tok-valid-123',
        }),
        'SEC123'
      ).ok,
      true
    );
    assert.equal(
      protoMod.validateCoopFrame(
        JSON.stringify({
          type: 'PAINT_EVENT',
          roomCode: 'SEC123',
          sender: baseSender,
          paintEvent: { eventId: 'ev1', playerId: 'p1', roomCode: 'SEC123', regionIds: [1, 2] },
        }),
        'SEC123'
      ).ok,
      true
    );
    assert.equal(
      protoMod.validateCoopFrame(
        JSON.stringify({
          type: 'UNFILL_EVENT',
          roomCode: 'SEC123',
          sender: baseSender,
          unfillEvent: { eventId: 'uf1', senderId: 'p1', roomCode: 'SEC123', regionIds: [2] },
        }),
        'SEC123'
      ).ok,
      true
    );
    assert.equal(
      protoMod.validateCoopFrame(
        JSON.stringify({ type: 'HEARTBEAT', roomCode: 'SEC123', sender: baseSender }),
        'SEC123'
      ).ok,
      true
    );
    assert.equal(
      protoMod.validateCoopFrame(
        JSON.stringify({ type: 'LEAVE', roomCode: 'SEC123', sender: baseSender }),
        'SEC123'
      ).ok,
      true
    );

    // Malformed frames across every type in the validator table
    const malformedCases = [
      {
        label: 'HELLO with paintEvent',
        frame: { type: 'HELLO', roomCode: 'SEC123', sender: baseSender, paintEvent: { eventId: 'x', regionIds: [1] } },
        reason: 'invalid_event_payload',
      },
      {
        label: 'HELLO with control-char hostToken',
        frame: { type: 'HELLO', roomCode: 'SEC123', sender: baseSender, hostToken: 'bad\ntoken' },
        reason: 'invalid_host_token',
      },
      {
        label: 'WELCOME_STATE with oversized hostToken',
        frame: {
          type: 'WELCOME_STATE',
          roomCode: 'SEC123',
          sender: baseSender,
          hostToken: 'a'.repeat(protoMod.MAX_HOST_TOKEN_CHARS + 1),
        },
        reason: 'invalid_host_token',
      },
      {
        label: 'PAINT_EVENT with seedToken',
        frame: {
          type: 'PAINT_EVENT',
          roomCode: 'SEC123',
          sender: baseSender,
          seedToken: seedA,
          paintEvent: { eventId: 'e1', regionIds: [1] },
        },
        reason: 'invalid_seed_token',
      },
      {
        label: 'PAINT_EVENT with hostToken',
        frame: {
          type: 'PAINT_EVENT',
          roomCode: 'SEC123',
          sender: baseSender,
          hostToken: 'tok-1',
          paintEvent: { eventId: 'e1', regionIds: [1] },
        },
        reason: 'invalid_host_token',
      },
      {
        label: 'UNFILL_EVENT missing unfillEvent',
        frame: { type: 'UNFILL_EVENT', roomCode: 'SEC123', sender: baseSender },
        reason: 'invalid_event_payload',
      },
      {
        label: 'UNFILL_EVENT with paintEvent',
        frame: {
          type: 'UNFILL_EVENT',
          roomCode: 'SEC123',
          sender: baseSender,
          paintEvent: { eventId: 'e1', regionIds: [1] },
          unfillEvent: { eventId: 'u1', regionIds: [1] },
        },
        reason: 'invalid_event_payload',
      },
      {
        label: 'HEARTBEAT with hostToken',
        frame: { type: 'HEARTBEAT', roomCode: 'SEC123', sender: baseSender, hostToken: 'tok-1' },
        reason: 'invalid_host_token',
      },
      {
        label: 'LEAVE with seedToken',
        frame: { type: 'LEAVE', roomCode: 'SEC123', sender: baseSender, seedToken: seedA },
        reason: 'invalid_seed_token',
      },
      {
        label: 'LEAVE with unfillEvent',
        frame: {
          type: 'LEAVE',
          roomCode: 'SEC123',
          sender: baseSender,
          unfillEvent: { eventId: 'u1', regionIds: [1] },
        },
        reason: 'invalid_event_payload',
      },
    ];
    for (const tc of malformedCases) {
      const res = protoMod.validateCoopFrame(JSON.stringify(tc.frame), 'SEC123');
      assert.equal(res.ok, false, `${tc.label} must be rejected`);
      assert.equal(res.reason, tc.reason, `${tc.label} expected reason ${tc.reason}`);
    }
  }

  // Runtime Durable Object & Worker tests
  const { createServer } = await import('vite');
  const cfVirtualPlugin = {
    name: 'capy-worker-sec-cf-virtual',
    resolveId(id) {
      if (id === 'cloudflare:workers') return '\0cloudflare:workers';
    },
    load(id) {
      if (id === '\0cloudflare:workers') {
        return 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }\n';
      }
    },
  };
  const workerVite = await createServer({
    root: WEB_ROOT,
    plugins: [cfVirtualPlugin],
    server: { middlewareMode: true, hmr: false, ws: false, fs: { allow: [REPO_ROOT] } },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom',
    logLevel: 'silent',
  });

  const OriginalResponse = globalThis.Response;
  const PrevWsPair = globalThis.WebSocketPair;
  const PrevReqRespPair = globalThis.WebSocketRequestResponsePair;
  const OrigDateNow = Date.now;

  class CfCompatResponse {
    constructor(body = null, init = {}) {
      if (init && init.status === 101) {
        this.status = 101;
        this.ok = false;
        this.webSocket = init.webSocket || null;
        this.headers = new Headers(init.headers || {});
        this._body = body;
      } else {
        return new OriginalResponse(body, init);
      }
    }
    static json(data, init = {}) {
      return OriginalResponse.json(data, init);
    }
  }

  class MockWs {
    constructor() {
      this.peer = null;
      this.attachment = null;
      this.received = [];
      this.closedCode = null;
      this.closedReason = null;
      this._onCloseHook = null;
    }
    accept() {}
    send(data) {
      if (this.closedCode !== null) throw new Error('closed');
      const txt = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
      if (this.peer) this.peer.received.push(txt);
    }
    close(code = 1000, reason = '') {
      if (this.closedCode !== null) return;
      this.closedCode = code;
      this.closedReason = reason;
      if (this.peer && this.peer.closedCode === null) {
        this.peer.closedCode = code;
        this.peer.closedReason = reason;
      }
      this._onCloseHook?.();
    }
    serializeAttachment(v) {
      this.attachment = structuredClone(v);
    }
    deserializeAttachment() {
      return this.attachment ? structuredClone(this.attachment) : null;
    }
  }

  class MockWsPair {
    constructor() {
      const a = new MockWs();
      const b = new MockWs();
      a.peer = b;
      b.peer = a;
      this[0] = a;
      this[1] = b;
    }
  }

  class MockReqRespPair {
    constructor(req, res) {
      this.request = req;
      this.response = res;
    }
  }

  const dbs = [];
  const makeInstrumentedEnv = (DoClass) => {
    const rooms = new Map();
    const env = {
      ASSETS: { fetch: async () => new OriginalResponse('Not found', { status: 404 }) },
      COOP_ROOMS: {
        idFromName: (name) => ({ name }),
        get: (id) => {
          let entry = rooms.get(id.name);
          if (!entry) {
            const db = new DatabaseSync(':memory:');
            dbs.push(db);
            const sockets = [];
            const sqlExecCalls = [];
            const alarmHistory = [];
            let currentAlarm = null;
            const state = {
              storage: {
                sql: {
                  exec(sqlText, ...params) {
                    sqlExecCalls.push(sqlText.trim());
                    const trimmed = sqlText.trim().replace(/;$/, '');
                    const upper = trimmed.toUpperCase();
                    if (upper.startsWith('CREATE ') || upper.startsWith('DROP ')) {
                      db.exec(sqlText);
                      return { toArray: () => [] };
                    }
                    const stmt = db.prepare(trimmed);
                    if (upper.startsWith('SELECT ')) return { toArray: () => stmt.all(...params) };
                    stmt.run(...params);
                    return { toArray: () => [] };
                  },
                },
                setAlarm: async (ts) => {
                  currentAlarm = ts;
                  alarmHistory.push(ts);
                },
                getAlarm: async () => currentAlarm,
                deleteAlarm: async () => {
                  currentAlarm = null;
                },
              },
              setWebSocketAutoResponse: () => {},
              blockConcurrencyWhile: async (fn) => fn(),
              acceptWebSocket: (ws) => {
                ws.accept();
                sockets.push(ws);
                ws._onCloseHook = () => {
                  const idx = sockets.indexOf(ws);
                  if (idx >= 0) sockets.splice(idx, 1);
                };
              },
              getWebSockets: () => sockets.filter((s) => s.closedCode === null),
            };
            entry = {
              state,
              sqlExecCalls,
              alarmHistory,
              getAlarm: () => currentAlarm,
              instance: new DoClass(state, env),
            };
            rooms.set(id.name, entry);
          }
          return { fetch: (req) => entry.instance.fetch(req) };
        },
      },
    };
    return { env, rooms };
  };

  let fakeNow = 1_800_000_000_000;
  try {
    globalThis.Response = CfCompatResponse;
    globalThis.WebSocketPair = MockWsPair;
    globalThis.WebSocketRequestResponsePair = MockReqRespPair;
    Date.now = () => fakeNow;

    const workerMod = await workerVite.ssrLoadModule('/../worker/index.ts');
    const ctx = makeInstrumentedEnv(workerMod.CoopRoomDurableObject);

    const upgrade = (room, ip) =>
      workerMod.default.fetch(
        new Request(`https://capypaint.com/api/room?room=${room}`, {
          headers: {
            Origin: 'https://capypaint.com',
            Upgrade: 'websocket',
            ...(ip ? { 'CF-Connecting-IP': ip } : {}),
          },
        }),
        ctx.env
      );

    // 2. /api/health returns dynamic url.hostname across multiple hosts
    for (const host of ['capypaint.com', 'paint.capyboop.com', 'beta.capypaint.com']) {
      const res = await workerMod.default.fetch(
        new Request(`https://${host}/api/health`),
        ctx.env
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.domain, host, `/api/health must return url.hostname (${host})`);
    }

    // 3. Deferred DO SQLite initialization & deferred 24h TTL alarm until valid HELLO
    {
      const unjoined1 = await upgrade('DEFSQL', '198.51.100.1');
      assert.equal(unjoined1.status, 101);
      const room = ctx.rooms.get('DEFSQL');
      assert.equal(
        room.sqlExecCalls.length,
        0,
        'constructor() and fetch() must not run any SQLite DDL or queries before valid HELLO'
      );
      assert.equal(
        room.alarmHistory.some((ts) => ts >= fakeNow + protoMod.ROOM_STATE_TTL_MS - 1000),
        false,
        'fetch() must not schedule 24h ROOM_STATE_TTL_MS alarm before valid HELLO'
      );

      // Pre-HELLO PAINT_EVENT, PING, and unjoined close must still perform zero SQLite calls
      await room.instance.webSocketMessage(
        unjoined1.webSocket.peer,
        JSON.stringify({
          type: 'PAINT_EVENT',
          roomCode: 'DEFSQL',
          sender: { playerId: 'ghost-1', displayName: 'Ghost', avatarColorHex: '#38bdf8' },
          paintEvent: { eventId: 'g1', regionIds: [1] },
        })
      );
      await room.instance.webSocketMessage(unjoined1.webSocket.peer, 'PING');
      assert.equal(unjoined1.webSocket.received.at(-1), 'PONG');
      assert.equal(room.sqlExecCalls.length, 0, 'Pre-HELLO frames must not touch SQLite');

      // Alarm firing for unjoined timeout must evict socket with zero SQLite calls
      fakeNow += protoMod.UNJOINED_HANDSHAKE_TIMEOUT_MS + 100;
      await room.instance.alarm();
      assert.equal(unjoined1.webSocket.peer.closedCode, 1008);
      assert.equal(room.sqlExecCalls.length, 0, 'Unjoined-only alarm must not touch SQLite');

      // Valid HELLO initializes SQLite and schedules 24h TTL alarm
      const joined1 = await upgrade('DEFSQL', '198.51.100.2');
      await room.instance.webSocketMessage(
        joined1.webSocket.peer,
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'DEFSQL',
          sender: { playerId: 'real-host', displayName: 'Host', avatarColorHex: '#fbbf24' },
          seedToken: seedA,
        })
      );
      assert.equal(room.sqlExecCalls.length > 0, true, 'Valid HELLO must initialize SQLite');
      assert.equal(
        room.getAlarm() >= fakeNow + protoMod.ROOM_STATE_TTL_MS - 1000,
        true,
        'Valid HELLO must schedule 24h ROOM_STATE_TTL_MS alarm'
      );
      joined1.webSocket.close(1000, 'cleanup');
    }

    // 4. Unjoined broadcast isolation (unjoined ghost never receives HELLO, PAINT_EVENT, UNFILL_EVENT, LEAVE)
    {
      const hostUp = await upgrade('ISO001', '198.51.100.10');
      const guestUp = await upgrade('ISO001', '198.51.100.11');
      const ghostUp = await upgrade('ISO001', '198.51.100.12');
      const room = ctx.rooms.get('ISO001');

      await room.instance.webSocketMessage(
        hostUp.webSocket.peer,
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'ISO001',
          sender: { playerId: 'iso-host', displayName: 'Host', avatarColorHex: '#fbbf24' },
          seedToken: seedA,
        })
      );
      await room.instance.webSocketMessage(
        guestUp.webSocket.peer,
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'ISO001',
          sender: { playerId: 'iso-guest', displayName: 'Guest', avatarColorHex: '#38bdf8' },
        })
      );
      await room.instance.webSocketMessage(
        hostUp.webSocket.peer,
        JSON.stringify({
          type: 'PAINT_EVENT',
          roomCode: 'ISO001',
          sender: { playerId: 'iso-host', displayName: 'Host', avatarColorHex: '#fbbf24' },
          paintEvent: { eventId: 'iso-p1', playerId: 'iso-host', roomCode: 'ISO001', regionIds: [1, 2] },
        })
      );
      await room.instance.webSocketMessage(
        hostUp.webSocket.peer,
        JSON.stringify({
          type: 'UNFILL_EVENT',
          roomCode: 'ISO001',
          sender: { playerId: 'iso-host', displayName: 'Host', avatarColorHex: '#fbbf24' },
          unfillEvent: { eventId: 'iso-u1', senderId: 'iso-host', roomCode: 'ISO001', regionIds: [2] },
        })
      );
      await room.instance.webSocketClose(guestUp.webSocket.peer, 1000, 'bye', true);

      assert.equal(
        ghostUp.webSocket.received.length,
        0,
        `Unjoined ghost socket must receive 0 broadcasts (got ${JSON.stringify(ghostUp.webSocket.received)})`
      );
      assert.equal(
        guestUp.webSocket.received.some((m) => JSON.parse(m).type === 'PAINT_EVENT'),
        true,
        'Joined guest must receive PAINT_EVENT'
      );
      assert.equal(
        hostUp.webSocket.received.some((m) => JSON.parse(m).type === 'LEAVE'),
        true,
        'Joined host must receive guest LEAVE'
      );
      hostUp.webSocket.close(1000, 'cleanup');
      ghostUp.webSocket.close(1000, 'cleanup');
    }

    // 5. Duplicate boundPlayerId rejection, server-issued host token & spoof prevention
    {
      const hostUp = await upgrade('AUTH01', '198.51.100.20');
      const guestUp = await upgrade('AUTH01', '198.51.100.21');
      const spoofUp = await upgrade('AUTH01', '198.51.100.22');
      const room = ctx.rooms.get('AUTH01');

      await room.instance.webSocketMessage(
        hostUp.webSocket.peer,
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'AUTH01',
          sender: { playerId: 'auth-host', displayName: 'Host', avatarColorHex: '#fbbf24' },
          seedToken: seedA,
        })
      );

      // Host receives server-issued HOST_GRANTED token
      const hostGrantedMsg = hostUp.webSocket.received
        .map((m) => JSON.parse(m))
        .find((m) => m.type === 'HOST_GRANTED');
      assert.ok(hostGrantedMsg, 'Host must receive HOST_GRANTED with server-issued hostToken');
      assert.equal(hostGrantedMsg.sender.playerId, protoMod.RESERVED_RELAY_PLAYER_ID);
      assert.equal(hostGrantedMsg.hostPlayerId, 'auth-host');
      assert.equal(typeof hostGrantedMsg.hostToken, 'string');
      assert.equal(hostGrantedMsg.hostToken.length >= 16, true);
      const issuedHostToken = hostGrantedMsg.hostToken;

      // Guest joins
      await room.instance.webSocketMessage(
        guestUp.webSocket.peer,
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'AUTH01',
          sender: { playerId: 'auth-guest', displayName: 'Guest', avatarColorHex: '#38bdf8' },
        })
      );
      assert.equal(
        guestUp.webSocket.received.some((m) => JSON.parse(m).type === 'HOST_GRANTED'),
        false,
        'Guest must never receive HOST_GRANTED'
      );

      // Second socket spoofing host's boundPlayerId must be closed with 1008
      const hostReceivedBeforeSpoof = hostUp.webSocket.received.length;
      await room.instance.webSocketMessage(
        spoofUp.webSocket.peer,
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'AUTH01',
          sender: { playerId: 'auth-host', displayName: 'Spoofer', avatarColorHex: '#ef4444' },
          seedToken: seedC,
        })
      );
      assert.equal(
        spoofUp.webSocket.peer.closedCode,
        1008,
        'Duplicate boundPlayerId must be closed with 1008'
      );
      assert.equal(hostUp.webSocket.received.length, hostReceivedBeforeSpoof);
      assert.equal(
        room.state.storage.sql
          .exec("SELECT value FROM room_state WHERE key = 'seed_token'")
          .toArray()[0]?.value,
        seedA
      );

      // Host sending WELCOME_STATE with WRONG explicit hostToken must be rejected
      fakeNow += protoMod.SEED_CHECKPOINT_DEBOUNCE_MS + 100;
      const guestReceivedBeforeWrongTok = guestUp.webSocket.received.length;
      await room.instance.webSocketMessage(
        hostUp.webSocket.peer,
        JSON.stringify({
          type: 'WELCOME_STATE',
          roomCode: 'AUTH01',
          sender: { playerId: 'auth-host', displayName: 'Host', avatarColorHex: '#fbbf24' },
          seedToken: seedC,
          hostToken: 'wrong-forged-token',
        })
      );
      assert.equal(
        guestUp.webSocket.received.length,
        guestReceivedBeforeWrongTok,
        'WELCOME_STATE with forged hostToken must be rejected'
      );
      assert.equal(
        room.state.storage.sql
          .exec("SELECT value FROM room_state WHERE key = 'seed_token'")
          .toArray()[0]?.value,
        seedA
      );

      // Host sending WELCOME_STATE with VALID explicit hostToken succeeds and strips hostToken before broadcast
      await room.instance.webSocketMessage(
        hostUp.webSocket.peer,
        JSON.stringify({
          type: 'WELCOME_STATE',
          roomCode: 'AUTH01',
          sender: { playerId: 'auth-host', displayName: 'Host', avatarColorHex: '#fbbf24' },
          seedToken: seedB,
          hostToken: issuedHostToken,
        })
      );
      assert.equal(
        room.state.storage.sql
          .exec("SELECT value FROM room_state WHERE key = 'seed_token'")
          .toArray()[0]?.value,
        seedB
      );
      const relayedWelcome = JSON.parse(guestUp.webSocket.received.at(-1));
      assert.equal(relayedWelcome.type, 'WELCOME_STATE');
      assert.equal(
        'hostToken' in relayedWelcome,
        false,
        'Outbound relayed WELCOME_STATE must strip hostToken so peers never see it'
      );

      hostUp.webSocket.close(1000, 'cleanup');
      guestUp.webSocket.close(1000, 'cleanup');
    }

    // 6. Host handoff on host leave (webSocketClose & webSocketError) + clear on empty room
    {
      const hostUp = await upgrade('HND001', '198.51.100.30');
      const peerAUp = await upgrade('HND001', '198.51.100.31');
      const peerBUp = await upgrade('HND001', '198.51.100.32');
      const room = ctx.rooms.get('HND001');

      await room.instance.webSocketMessage(
        hostUp.webSocket.peer,
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'HND001',
          sender: { playerId: 'hnd-host', displayName: 'Host', avatarColorHex: '#fbbf24' },
          seedToken: seedA,
        })
      );
      const origToken = hostUp.webSocket.received
        .map((m) => JSON.parse(m))
        .find((m) => m.type === 'HOST_GRANTED').hostToken;

      fakeNow += 100;
      await room.instance.webSocketMessage(
        peerAUp.webSocket.peer,
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'HND001',
          sender: { playerId: 'hnd-peer-a', displayName: 'PeerA', avatarColorHex: '#38bdf8' },
        })
      );
      fakeNow += 100;
      await room.instance.webSocketMessage(
        peerBUp.webSocket.peer,
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'HND001',
          sender: { playerId: 'hnd-peer-b', displayName: 'PeerB', avatarColorHex: '#a78bfa' },
        })
      );

      // Host leaves via webSocketClose -> earliest joined peer (PeerA) promoted with fresh token
      fakeNow += 100;
      await room.instance.webSocketClose(hostUp.webSocket.peer, 1000, 'bye', true);
      assert.equal(
        room.state.storage.sql
          .exec("SELECT value FROM room_state WHERE key = 'host_player_id'")
          .toArray()[0]?.value,
        'hnd-peer-a'
      );
      const peerAGranted = peerAUp.webSocket.received
        .map((m) => JSON.parse(m))
        .find((m) => m.type === 'HOST_GRANTED');
      assert.ok(peerAGranted, 'Earliest remaining peer must receive HOST_GRANTED on host leave');
      assert.equal(peerAGranted.hostPlayerId, 'hnd-peer-a');
      assert.notEqual(
        peerAGranted.hostToken,
        origToken,
        'Promoted host must receive a fresh hostToken'
      );
      assert.equal(
        peerBUp.webSocket.received.some((m) => JSON.parse(m).type === 'HOST_GRANTED'),
        false,
        'Non-promoted PeerB must not receive HOST_GRANTED'
      );

      // Promoted PeerA can update room seed; PeerB still cannot
      fakeNow += protoMod.SEED_CHECKPOINT_DEBOUNCE_MS + 100;
      await room.instance.webSocketMessage(
        peerBUp.webSocket.peer,
        JSON.stringify({
          type: 'WELCOME_STATE',
          roomCode: 'HND001',
          sender: { playerId: 'hnd-peer-b', displayName: 'PeerB', avatarColorHex: '#a78bfa' },
          seedToken: seedC,
        })
      );
      assert.equal(
        room.state.storage.sql
          .exec("SELECT value FROM room_state WHERE key = 'seed_token'")
          .toArray()[0]?.value,
        seedA
      );
      await room.instance.webSocketMessage(
        peerAUp.webSocket.peer,
        JSON.stringify({
          type: 'WELCOME_STATE',
          roomCode: 'HND001',
          sender: { playerId: 'hnd-peer-a', displayName: 'PeerA', avatarColorHex: '#38bdf8' },
          seedToken: seedB,
        })
      );
      assert.equal(
        room.state.storage.sql
          .exec("SELECT value FROM room_state WHERE key = 'seed_token'")
          .toArray()[0]?.value,
        seedB
      );

      // PeerA disconnects via webSocketError -> PeerB promoted with fresh token
      fakeNow += 100;
      await room.instance.webSocketError(peerAUp.webSocket.peer, new Error('dropped'));
      assert.equal(
        room.state.storage.sql
          .exec("SELECT value FROM room_state WHERE key = 'host_player_id'")
          .toArray()[0]?.value,
        'hnd-peer-b'
      );
      const peerBGranted = peerBUp.webSocket.received
        .map((m) => JSON.parse(m))
        .find((m) => m.type === 'HOST_GRANTED');
      assert.ok(peerBGranted, 'PeerB must be promoted on host webSocketError');
      assert.notEqual(peerBGranted.hostToken, peerAGranted.hostToken);

      // PeerB leaves -> room empties -> host authority cleared (not locked for 24h)
      fakeNow += 100;
      await room.instance.webSocketClose(peerBUp.webSocket.peer, 1000, 'bye', true);
      assert.equal(
        room.state.storage.sql
          .exec("SELECT key FROM room_state WHERE key IN ('host_player_id', 'host_token')")
          .toArray().length,
        0,
        'Host authority must clear when room empties'
      );

      // New PeerC joining immediately becomes host
      const peerCUp = await upgrade('HND001', '198.51.100.33');
      await room.instance.webSocketMessage(
        peerCUp.webSocket.peer,
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'HND001',
          sender: { playerId: 'hnd-peer-c', displayName: 'PeerC', avatarColorHex: '#22c55e' },
        })
      );
      assert.equal(
        room.state.storage.sql
          .exec("SELECT value FROM room_state WHERE key = 'host_player_id'")
          .toArray()[0]?.value,
        'hnd-peer-c'
      );
      peerCUp.webSocket.close(1000, 'cleanup');
    }

    // 7. Per-IP unjoined socket cap & unjoined handshake timeout eviction
    {
      const squatterIp = '203.0.113.77';
      const squatters = [];
      for (let i = 0; i < protoMod.MAX_UNJOINED_SOCKETS_PER_IP; i++) {
        const res = await upgrade('SQT001', squatterIp);
        assert.equal(res.status, 101);
        squatters.push(res.webSocket);
      }
      const blocked = await upgrade('SQT001', squatterIp);
      assert.equal(blocked.status, 429, 'Exceeding per-IP unjoined cap must return 429');
      assert.equal(blocked.headers.get('Retry-After'), '10');

      // Distinct IP is unaffected
      const legit = await upgrade('SQT001', '203.0.113.88');
      assert.equal(legit.status, 101);
      const room = ctx.rooms.get('SQT001');
      await room.instance.webSocketMessage(
        legit.webSocket.peer,
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'SQT001',
          sender: { playerId: 'legit-p', displayName: 'Legit', avatarColorHex: '#fbbf24' },
        })
      );

      // Advance past UNJOINED_HANDSHAKE_TIMEOUT_MS: PING cannot keep squatter alive
      fakeNow += protoMod.UNJOINED_HANDSHAKE_TIMEOUT_MS + 100;
      await room.instance.webSocketMessage(squatters[0].peer, 'PING');
      assert.equal(
        squatters[0].peer.closedCode,
        1008,
        'Expired unjoined socket sending PING must be closed with 1008'
      );

      // New upgrade from squatterIp synchronously evicts remaining expired unjoined squatters and succeeds
      const freshAfterTimeout = await upgrade('SQT001', squatterIp);
      assert.equal(freshAfterTimeout.status, 101);
      for (let i = 1; i < squatters.length; i++) {
        assert.equal(
          squatters[i].peer.closedCode,
          1008,
          `Expired unjoined squatter ${i} must be evicted with 1008`
        );
      }
      assert.equal(legit.webSocket.peer.closedCode, null, 'Joined peer must stay open');

      legit.webSocket.close(1000, 'cleanup');
      freshAfterTimeout.webSocket.close(1000, 'cleanup');
    }

    // 8. Hibernated 24h ROOM_STATE_TTL_MS alarm preserved across unjoined timeout & early disconnect
    {
      // (a) Unjoined socket connects to hibernated room and times out -> 24h alarm restored with zero SQLite calls, then expires at +24h
      const hostUp = await upgrade('HIB001', '198.51.100.41');
      assert.equal(hostUp.status, 101);
      const room = ctx.rooms.get('HIB001');
      await room.instance.webSocketMessage(
        hostUp.webSocket.peer,
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'HIB001',
          sender: { playerId: 'hib-host-1', displayName: 'HibHost', avatarColorHex: '#fbbf24' },
          seedToken: seedA,
        })
      );
      fakeNow += 1_000;
      await room.instance.webSocketClose(hostUp.webSocket.peer, 1000, 'host_left', true);
      const expectedTtlAlarm = fakeNow + protoMod.ROOM_STATE_TTL_MS;
      assert.equal(
        room.getAlarm(),
        expectedTtlAlarm,
        'Empty seeded room must schedule 24h ROOM_STATE_TTL_MS cleanup alarm'
      );

      // Simulate DO hibernation (fresh instance with sqlInitialized === false)
      room.instance = new workerMod.CoopRoomDurableObject(room.state, ctx.env);
      fakeNow += 60 * 60 * 1000; // +1 hour
      const sqlCountBeforeUnjoined = room.sqlExecCalls.length;

      // Unjoined socket connects, displacing the single DO alarm to now + 10s
      const unjoinedUp = await upgrade('HIB001', '198.51.100.42');
      assert.equal(unjoinedUp.status, 101);
      assert.equal(
        room.getAlarm(),
        fakeNow + protoMod.UNJOINED_HANDSHAKE_TIMEOUT_MS,
        'Unjoined connect must schedule earlier handshake timeout alarm'
      );
      assert.equal(
        room.sqlExecCalls.length,
        sqlCountBeforeUnjoined,
        'Unjoined connect on hibernated room must perform zero SQLite calls'
      );

      // Alarm fires at +10.1s -> evicts unjoined socket AND restores 24h TTL alarm with zero SQLite calls
      fakeNow += protoMod.UNJOINED_HANDSHAKE_TIMEOUT_MS + 100;
      await room.instance.alarm();
      assert.equal(
        unjoinedUp.webSocket.peer.closedCode,
        1008,
        'Timed-out unjoined socket on hibernated room must be evicted with 1008'
      );
      assert.equal(
        room.sqlExecCalls.length,
        sqlCountBeforeUnjoined,
        'Unjoined eviction alarm on hibernated room must restore 24h alarm with zero SQLite calls'
      );
      assert.equal(
        room.getAlarm(),
        expectedTtlAlarm,
        '24h ROOM_STATE_TTL_MS alarm must be restored after unjoined socket timeout'
      );

      // When +24h passes, alarm() wakes up and cleans up expired room_state
      fakeNow = expectedTtlAlarm + 1_000;
      await room.instance.alarm();
      assert.equal(
        room.state.storage.sql.exec('SELECT key FROM room_state').toArray().length,
        0,
        'Restored 24h alarm must clean up expired room_state rows'
      );

      // (b) Unjoined socket connects to hibernated room and disconnects early before timeout -> 24h alarm restored
      const host2Up = await upgrade('HIB002', '198.51.100.43');
      assert.equal(host2Up.status, 101);
      const room2 = ctx.rooms.get('HIB002');
      await room2.instance.webSocketMessage(
        host2Up.webSocket.peer,
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'HIB002',
          sender: { playerId: 'hib-host-2', displayName: 'HibHost2', avatarColorHex: '#38bdf8' },
          seedToken: seedB,
        })
      );
      fakeNow += 1_000;
      await room2.instance.webSocketClose(host2Up.webSocket.peer, 1000, 'host_left', true);
      const expectedTtlAlarm2 = fakeNow + protoMod.ROOM_STATE_TTL_MS;
      assert.equal(room2.getAlarm(), expectedTtlAlarm2);

      // Simulate DO hibernation
      room2.instance = new workerMod.CoopRoomDurableObject(room2.state, ctx.env);
      fakeNow += 30 * 60 * 1000; // +30 min
      const sqlCountBeforeEarly = room2.sqlExecCalls.length;

      const earlyUnjoined = await upgrade('HIB002', '198.51.100.44');
      assert.equal(earlyUnjoined.status, 101);
      assert.equal(room2.getAlarm(), fakeNow + protoMod.UNJOINED_HANDSHAKE_TIMEOUT_MS);

      // Unjoined socket closes early (+2s, before 10s handshake timeout)
      fakeNow += 2_000;
      await room2.instance.webSocketClose(earlyUnjoined.webSocket.peer, 1000, 'early_bye', true);
      assert.equal(
        room2.sqlExecCalls.length,
        sqlCountBeforeEarly,
        'Early unjoined disconnect on hibernated room must perform zero SQLite calls'
      );
      assert.equal(
        room2.getAlarm(),
        expectedTtlAlarm2,
        '24h ROOM_STATE_TTL_MS alarm must be restored when unjoined socket disconnects early'
      );

      // (c) Unjoined socket connects within final 10s window [T_24h - 10s, T_24h] on hibernated room
      const host3Up = await upgrade('HIB003', '198.51.100.45');
      assert.equal(host3Up.status, 101);
      const room3 = ctx.rooms.get('HIB003');
      await room3.instance.webSocketMessage(
        host3Up.webSocket.peer,
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'HIB003',
          sender: { playerId: 'hib-host-3', displayName: 'HibHost3', avatarColorHex: '#34d399' },
          seedToken: seedA,
        })
      );
      fakeNow += 1_000;
      await room3.instance.webSocketClose(host3Up.webSocket.peer, 1000, 'host_left', true);
      const expectedTtlAlarm3 = fakeNow + protoMod.ROOM_STATE_TTL_MS;
      assert.equal(room3.getAlarm(), expectedTtlAlarm3);

      // Simulate DO hibernation
      room3.instance = new workerMod.CoopRoomDurableObject(room3.state, ctx.env);
      fakeNow = expectedTtlAlarm3 - 5_000;
      const sqlCountBeforeBoundary = room3.sqlExecCalls.length;

      // Unjoined socket U1 connects 5s before T_24h (existingAlarm <= handshakeDeadline)
      const boundaryUnjoined = await upgrade('HIB003', '198.51.100.46');
      assert.equal(boundaryUnjoined.status, 101);
      assert.equal(
        room3.sqlExecCalls.length,
        sqlCountBeforeBoundary,
        'Boundary unjoined connect on hibernated room must perform zero SQLite calls'
      );
      assert.equal(
        room3.getAlarm(),
        expectedTtlAlarm3,
        'Boundary unjoined connect must keep earlier T_24h alarm'
      );

      // Alarm fires at T_24h -> cleans up expired room_state immediately AND keeps U1 scheduled for T_24h + 5_000
      fakeNow = expectedTtlAlarm3;
      await room3.state.storage.deleteAlarm();
      await room3.instance.alarm();
      assert.equal(
        room3.state.storage.sql.exec('SELECT key FROM room_state').toArray().length,
        0,
        'Alarm at T_24h must clean up expired room_state even when an unjoined socket is still open'
      );
      assert.equal(
        boundaryUnjoined.webSocket.peer.closedCode,
        null,
        'Unjoined socket U1 must not be evicted before its 10s handshake deadline'
      );
      assert.equal(
        room3.getAlarm(),
        expectedTtlAlarm3 + 5_000,
        'Alarm after T_24h cleanup must remain scheduled for U1 handshake deadline (T_24h + 5_000)'
      );

      // Alarm fires at T_24h + 5_000 -> evicts U1 with 1008 and leaves no further alarm scheduled
      fakeNow = expectedTtlAlarm3 + 5_000;
      await room3.state.storage.deleteAlarm();
      await room3.instance.alarm();
      assert.equal(
        boundaryUnjoined.webSocket.peer.closedCode,
        1008,
        'Unjoined socket U1 must be evicted with 1008 at T_24h + 5_000'
      );
      assert.equal(
        room3.getAlarm(),
        null,
        'Final alarm after U1 eviction and room_state cleanup must be null'
      );
    }
  } finally {
    Date.now = OrigDateNow;
    globalThis.Response = OriginalResponse;
    if (PrevWsPair === undefined) delete globalThis.WebSocketPair;
    else globalThis.WebSocketPair = PrevWsPair;
    if (PrevReqRespPair === undefined) delete globalThis.WebSocketRequestResponsePair;
    else globalThis.WebSocketRequestResponsePair = PrevReqRespPair;
    for (const db of dbs) {
      try {
        db.close();
      } catch {
        // Ignore close errors
      }
    }
    await workerVite.close();
  }
}
