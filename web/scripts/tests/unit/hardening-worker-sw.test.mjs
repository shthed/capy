/**
 * Release Safety & Hardening — Cloudflare Worker Relay, WP4 DO Runtime & Service Worker Isolation.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '../../..');
const REPO_ROOT = path.resolve(WEB_ROOT, '..');

export async function runHardeningWorkerSwTests(vite) {
  // 4. Cloudflare Worker Co-op relay protocol & DO hardening
  {
    const protoMod = await vite.ssrLoadModule('../worker/coopRoomProtocol.ts');

    for (const okOrigin of [
      'https://capypaint.com',
      'https://www.capypaint.com',
      'https://beta.capypaint.com',
      'https://capyboop.github.io',
      /* capy-dev-only:start */
      'https://shthed.github.io',
      /* capy-dev-only:end */
      'https://appassets.androidplatform.net',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
    ]) {
      assert.equal(
        protoMod.isAllowedRelayOrigin(okOrigin),
        true,
        `Relay must accept valid origin ${okOrigin}`
      );
    }

    for (const badOrigin of [
      null,
      '',
      'http://capypaint.com',
      'https://evil.example',
      'https://capypaint.com.evil.example',
      'https://.capypaint.com',
      'https://capypaint.com.',
      'https://user@capypaint.com',
      'https://capypaint.com:8443',
      'https://capypaint.com\nX-Test: 1',
    ]) {
      assert.equal(
        protoMod.isAllowedRelayOrigin(badOrigin),
        false,
        `Relay must reject untrusted origin ${String(badOrigin)}`
      );
    }

    // Reject sender/room spoofing inside paintEvent and unfillEvent
    const spoofedPaintPlayer = protoMod.validateCoopFrame(
      JSON.stringify({
        type: 'PAINT_EVENT',
        roomCode: 'ROOM42',
        sender: { playerId: 'p1', displayName: 'Alice', avatarColorHex: '#f59e0b' },
        paintEvent: {
          eventId: 'ev_1',
          playerId: 'victim_p2',
          roomCode: 'ROOM42',
          regionIds: [1, 2],
        },
      }),
      'ROOM42'
    );
    assert.equal(spoofedPaintPlayer.ok, false);
    assert.equal(spoofedPaintPlayer.reason, 'invalid_event_payload');

    const spoofedPaintRoom = protoMod.validateCoopFrame(
      JSON.stringify({
        type: 'PAINT_EVENT',
        roomCode: 'ROOM42',
        sender: { playerId: 'p1', displayName: 'Alice', avatarColorHex: '#f59e0b' },
        paintEvent: {
          eventId: 'ev_2',
          playerId: 'p1',
          roomCode: 'OTHER9',
          regionIds: [1],
        },
      }),
      'ROOM42'
    );
    assert.equal(spoofedPaintRoom.ok, false);
    assert.equal(spoofedPaintRoom.reason, 'invalid_event_payload');

    const spoofedUnfillSender = protoMod.validateCoopFrame(
      JSON.stringify({
        type: 'UNFILL_EVENT',
        roomCode: 'ROOM42',
        sender: { playerId: 'p1', displayName: 'Alice', avatarColorHex: '#f59e0b' },
        unfillEvent: {
          eventId: 'uf_1',
          senderId: 'victim_p2',
          regionIds: [3],
        },
      }),
      'ROOM42'
    );
    assert.equal(spoofedUnfillSender.ok, false);
    assert.equal(spoofedUnfillSender.reason, 'invalid_event_payload');

    // Reject cross-type payload confusion and seedToken on HEARTBEAT
    const badHeartbeatSeed = protoMod.validateCoopFrame(
      JSON.stringify({
        type: 'HEARTBEAT',
        roomCode: 'ROOM42',
        sender: { playerId: 'p1', displayName: 'Alice' },
        seedToken: 'a'.repeat(32),
      }),
      'ROOM42'
    );
    assert.equal(badHeartbeatSeed.ok, false);

    const crossPayload = protoMod.validateCoopFrame(
      JSON.stringify({
        type: 'HELLO',
        roomCode: 'ROOM42',
        sender: { playerId: 'p1', displayName: 'Alice' },
        paintEvent: { eventId: 'ev_x', regionIds: [1] },
      }),
      'ROOM42'
    );
    assert.equal(crossPayload.ok, false);

    const controlCharSender = protoMod.validateCoopFrame(
      JSON.stringify({
        type: 'HELLO',
        roomCode: 'ROOM42',
        sender: { playerId: 'p1\nspoof', displayName: 'Alice' },
      }),
      'ROOM42'
    );
    assert.equal(controlCharSender.ok, false);

    // Valid PAINT_EVENT strips unknown extra keys cleanly
    const validPaint = protoMod.validateCoopFrame(
      JSON.stringify({
        type: 'PAINT_EVENT',
        roomCode: 'ROOM42',
        sender: { playerId: 'p1', displayName: 'Alice\u0007', avatarColorHex: '#f59e0b' },
        paintEvent: {
          eventId: 'ev_ok',
          playerId: 'p1',
          roomCode: 'ROOM42',
          regionIds: [5, 6],
          unexpectedField: 'drop_me',
        },
      }),
      'ROOM42'
    );
    assert.equal(validPaint.ok, true);
    assert.equal(validPaint.message.sender.displayName, 'Alice');
    assert.equal('unexpectedField' in validPaint.message.paintEvent, false);

    const workerIndexSrc = fs.readFileSync(path.join(REPO_ROOT, 'worker/index.ts'), 'utf8');
    assert.match(
      workerIndexSrc,
      /CoopRoomDurableObject[\s\S]*isAllowedRelayOrigin\(/,
      'worker/index.ts CoopRoomDurableObject.fetch must enforce isAllowedRelayOrigin defense-in-depth'
    );
    assert.match(
      workerIndexSrc,
      /message instanceof ArrayBuffer && message\.byteLength > MAX_COOP_FRAME_BYTES/,
      'worker/index.ts webSocketMessage must reject oversized ArrayBuffers before decoding'
    );
    assert.equal(
      /err\.stack/.test(workerIndexSrc),
      false,
      'worker/index.ts must never leak or log raw stack traces in HTTP responses'
    );
  }


  // 6a. WP4 Worker Runtime Integration, 4-8 Room Code Parity & DO SQLite TTL
  {
    const protoMod = await vite.ssrLoadModule('../worker/coopRoomProtocol.ts');
    const shareMod = await vite.ssrLoadModule('/src/services/ShareLinkService.ts');
    for (const [raw, expected] of [
      ['', null],
      ['A', null],
      ['AB', null],
      ['ABC', null],
      ['ABCD', 'ABCD'],
      [' ab-c_123! ', 'ABC123'],
      ['ABCD1234', 'ABCD1234'],
      ['ABCDEFGHI', null],
      ['TOOLONG12', null],
    ]) {
      assert.equal(protoMod.normalizeRoomCode(raw), expected);
      assert.equal(shareMod.normalizeCoopRoomCode(raw), expected);
    }
    assert.equal(protoMod.isAllowedRelayOrigin('http://localhost:5173', null, false), false);
    assert.equal(protoMod.isAllowedRelayOrigin('http://localhost:5173', null, true), true);

    const { createServer } = await import('vite');
    const cfVirtualPlugin = {
      name: 'capy-hardening-cf-virtual',
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
        this._onCloseHook = null;
      }
      accept() {}
      send(data) {
        if (this.closedCode !== null) throw new Error('closed');
        const txt = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
        if (this.peer) this.peer.received.push(txt);
      }
      close(code = 1000) {
        if (this.closedCode !== null) return;
        this.closedCode = code;
        if (this.peer && this.peer.closedCode === null) this.peer.closedCode = code;
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
    const makeDoEnv = (opts = {}) => {
      const rooms = new Map();
      const idFromNameCalls = [];
      const rateCounts = new Map();
      const quota = opts.rateLimitQuota ?? 35;
      const env = {
        ASSETS: { fetch: async () => new OriginalResponse('Not found', { status: 404 }) },
        API_RATE_LIMITER: {
          limit: async ({ key }) => {
            const next = (rateCounts.get(key) || 0) + 1;
            rateCounts.set(key, next);
            return { success: next <= quota };
          },
        },
        ...(opts.allowLocalhostOrigins !== undefined
          ? { ALLOW_LOCALHOST_ORIGINS: opts.allowLocalhostOrigins }
          : {}),
        COOP_ROOMS: {
          idFromName: (name) => {
            idFromNameCalls.push(name);
            return { name };
          },
          get: (id) => {
            let entry = rooms.get(id.name);
            if (!entry) {
              const db = new DatabaseSync(':memory:');
              dbs.push(db);
              const sockets = [];
              const state = {
                storage: {
                  sql: {
                    exec(sqlText, ...params) {
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
                  setAlarm: async () => {},
                  getAlarm: async () => null,
                  deleteAlarm: async () => {},
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
              entry = { state, instance: new opts.DoClass(state, env) };
              rooms.set(id.name, entry);
            }
            return { fetch: (req) => entry.instance.fetch(req) };
          },
        },
      };
      return { env, rooms, idFromNameCalls };
    };

    try {
      globalThis.Response = CfCompatResponse;
      globalThis.WebSocketPair = MockWsPair;
      globalThis.WebSocketRequestResponsePair = MockReqRespPair;

      const workerMod = await workerVite.ssrLoadModule('/../worker/index.ts');
      const prodCtx = makeDoEnv({ DoClass: workerMod.CoopRoomDurableObject, rateLimitQuota: 4 });

      const assertApiSecurityHeaders = (res, label) => {
        assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff', `${label}: nosniff`);
        assert.equal(res.headers.get('Cache-Control'), 'no-store', `${label}: no-store`);
        assert.equal(
          res.headers.get('Strict-Transport-Security'),
          'max-age=31536000; includeSubDomains',
          `${label}: HSTS`
        );
        assert.equal(
          res.headers.get('Referrer-Policy'),
          'strict-origin-when-cross-origin',
          `${label}: Referrer-Policy`
        );
        assert.equal(res.headers.get('X-Frame-Options'), 'DENY', `${label}: X-Frame-Options`);
      };

      // Health GET, HEAD, 405 & separate rate-limit bucket
      const healthRes = await workerMod.default.fetch(
        new Request('https://capypaint.com/api/health', {
          headers: { 'CF-Connecting-IP': '198.51.100.44' },
        }),
        prodCtx.env
      );
      assert.equal(healthRes.status, 200);
      assertApiSecurityHeaders(healthRes, 'GET /api/health');

      const healthHeadRes = await workerMod.default.fetch(
        new Request('https://capypaint.com/api/health', {
          method: 'HEAD',
          headers: { 'CF-Connecting-IP': '198.51.100.44' },
        }),
        prodCtx.env
      );
      assert.equal(healthHeadRes.status, 200);
      assert.equal(await healthHeadRes.text(), '');
      assertApiSecurityHeaders(healthHeadRes, 'HEAD /api/health');

      const healthPostRes = await workerMod.default.fetch(
        new Request('https://capypaint.com/api/health', { method: 'POST' }),
        prodCtx.env
      );
      assert.equal(healthPostRes.status, 405);
      assert.equal(healthPostRes.headers.get('Allow'), 'GET, HEAD');
      assertApiSecurityHeaders(healthPostRes, 'POST /api/health');

      // Exhaust /api/health quota on 198.51.100.44 and confirm 429 Retry-After: 60 without affecting /api/room
      for (let i = 0; i < 2; i++) {
        const extraHealth = await workerMod.default.fetch(
          new Request('https://capypaint.com/api/health', {
            headers: { 'CF-Connecting-IP': '198.51.100.44' },
          }),
          prodCtx.env
        );
        assert.equal(extraHealth.status, 200);
      }
      const healthRlRes = await workerMod.default.fetch(
        new Request('https://capypaint.com/api/health', {
          headers: { 'CF-Connecting-IP': '198.51.100.44' },
        }),
        prodCtx.env
      );
      assert.equal(healthRlRes.status, 429);
      assert.equal(healthRlRes.headers.get('Retry-After'), '60');
      assertApiSecurityHeaders(healthRlRes, '429 /api/health');

      // /api/room 405 Allow: GET, /api/unknown 404, 403, 426, 400 all avoid touching DO idFromName
      const roomPostRes = await workerMod.default.fetch(
        new Request('https://capypaint.com/api/room?room=ABC123', { method: 'POST' }),
        prodCtx.env
      );
      assert.equal(roomPostRes.status, 405);
      assert.equal(roomPostRes.headers.get('Allow'), 'GET');
      assertApiSecurityHeaders(roomPostRes, 'POST /api/room');

      const notFoundApiRes = await workerMod.default.fetch(
        new Request('https://capypaint.com/api/unknown'),
        prodCtx.env
      );
      assert.equal(notFoundApiRes.status, 404);
      assertApiSecurityHeaders(notFoundApiRes, '404 /api/unknown');

      // Localhost blocked unless ALLOW_LOCALHOST_ORIGINS === 'true'
      const localProdRes = await workerMod.default.fetch(
        new Request('https://capypaint.com/api/room?room=ABC123', {
          headers: { Origin: 'http://localhost:3000', Upgrade: 'websocket' },
        }),
        prodCtx.env
      );
      assert.equal(localProdRes.status, 403);
      assertApiSecurityHeaders(localProdRes, '403 /api/room');

      // Non-WebSocket 426 before touching DO idFromName
      const nonWsRes = await workerMod.default.fetch(
        new Request('https://capypaint.com/api/room?room=ABC123', {
          headers: { Origin: 'https://capypaint.com' },
        }),
        prodCtx.env
      );
      assert.equal(nonWsRes.status, 426);
      assertApiSecurityHeaders(nonWsRes, '426 /api/room');

      const badRoomRes = await workerMod.default.fetch(
        new Request('https://capypaint.com/api/room?room=X', {
          headers: { Origin: 'https://capypaint.com', Upgrade: 'websocket' },
        }),
        prodCtx.env
      );
      assert.equal(badRoomRes.status, 400);
      assertApiSecurityHeaders(badRoomRes, '400 /api/room');
      assert.equal(prodCtx.idFromNameCalls.length, 0);

      const roomAfterHealthRl = await workerMod.default.fetch(
        new Request('https://capypaint.com/api/room?room=HLTH99', {
          headers: {
            Origin: 'https://capypaint.com',
            Upgrade: 'websocket',
            'CF-Connecting-IP': '198.51.100.44',
          },
        }),
        prodCtx.env
      );
      assert.equal(roomAfterHealthRl.status, 101);

      // Rate-limit 429 before DO dispatch without throttling distinct benign IP
      for (let i = 0; i < 4; i++) {
        const okRes = await workerMod.default.fetch(
          new Request(`https://capypaint.com/api/room?room=RATE0${i}`, {
            headers: {
              Origin: 'https://capypaint.com',
              Upgrade: 'websocket',
              'CF-Connecting-IP': '203.0.113.9',
            },
          }),
          prodCtx.env
        );
        assert.equal(okRes.status, 101);
      }
      const blockedCallsBefore = prodCtx.idFromNameCalls.length;
      const rlRes = await workerMod.default.fetch(
        new Request('https://capypaint.com/api/room?room=RATE99', {
          headers: {
            Origin: 'https://capypaint.com',
            Upgrade: 'websocket',
            'CF-Connecting-IP': '203.0.113.9',
          },
        }),
        prodCtx.env
      );
      assert.equal(rlRes.status, 429);
      assert.equal(rlRes.headers.get('Retry-After'), '60');
      assertApiSecurityHeaders(rlRes, '429 /api/room');
      assert.equal(prodCtx.idFromNameCalls.length, blockedCallsBefore);

      // ALLOW_LOCALHOST_ORIGINS='true' allows localhost
      const devCtx = makeDoEnv({
        DoClass: workerMod.CoopRoomDurableObject,
        allowLocalhostOrigins: 'true',
      });
      const devLocalRes = await workerMod.default.fetch(
        new Request('https://capypaint.com/api/room?room=DEV123', {
          headers: { Origin: 'http://localhost:5173', Upgrade: 'websocket' },
        }),
        devCtx.env
      );
      assert.equal(devLocalRes.status, 101);

      // Pre-HELLO drop & host seed lock
      const codecMod = await vite.ssrLoadModule('/src/services/CapyCodec.ts');
      const hostSeed = await codecMod.encodeProgressDeltaToken({
        version: 2,
        sourceRef: { kind: 'sample', uri: 'assets/capybara.webp' },
        filledRegionIds: [1, 2],
        updatedAt: 1000,
      });
      const hijackSeed = await codecMod.encodeProgressDeltaToken({
        version: 2,
        sourceRef: { kind: 'sample', uri: 'assets/capybara.webp' },
        filledRegionIds: [99],
        updatedAt: 2000,
      });

      const hostUp = await workerMod.default.fetch(
        new Request('https://capypaint.com/api/room?room=LOCK99', {
          headers: { Origin: 'https://capypaint.com', Upgrade: 'websocket', 'CF-Connecting-IP': '198.51.100.1' },
        }),
        devCtx.env
      );
      const guestUp = await workerMod.default.fetch(
        new Request('https://capypaint.com/api/room?room=LOCK99', {
          headers: { Origin: 'https://capypaint.com', Upgrade: 'websocket', 'CF-Connecting-IP': '198.51.100.2' },
        }),
        devCtx.env
      );
      const unjoinedUp = await workerMod.default.fetch(
        new Request('https://capypaint.com/api/room?room=LOCK99', {
          headers: { Origin: 'https://capypaint.com', Upgrade: 'websocket', 'CF-Connecting-IP': '198.51.100.3' },
        }),
        devCtx.env
      );
      const roomDo = devCtx.rooms.get('LOCK99');
      const hostServerWs = hostUp.webSocket.peer;
      const guestServerWs = guestUp.webSocket.peer;
      const unjoinedServerWs = unjoinedUp.webSocket.peer;

      await roomDo.instance.webSocketMessage(
        hostServerWs,
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'LOCK99',
          sender: { playerId: 'host-a', displayName: 'Host', avatarColorHex: '#fbbf24' },
          seedToken: hostSeed,
          sentAt: 1000,
        })
      );
      const hostCountBefore = hostUp.webSocket.received.length;
      // Pre-HELLO PAINT_EVENT and WELCOME_STATE from unjoined sockets must be dropped without mutating attachment or emitting LEAVE on close
      await roomDo.instance.webSocketMessage(
        unjoinedServerWs,
        JSON.stringify({
          type: 'PAINT_EVENT',
          roomCode: 'LOCK99',
          sender: { playerId: 'unjoined-u', displayName: 'Ghost', avatarColorHex: '#38bdf8' },
          paintEvent: { eventId: 'ghost_ev', regionIds: [1] },
          sentAt: 1001,
        })
      );
      assert.equal(unjoinedServerWs.deserializeAttachment()?.participant, null);
      assert.equal(unjoinedServerWs.deserializeAttachment()?.boundPlayerId, null);
      await roomDo.instance.webSocketClose(unjoinedServerWs, 1000, 'bye', true);
      assert.equal(hostUp.webSocket.received.length, hostCountBefore);

      // Pre-HELLO WELCOME_STATE from guest must be dropped
      await roomDo.instance.webSocketMessage(
        guestServerWs,
        JSON.stringify({
          type: 'WELCOME_STATE',
          roomCode: 'LOCK99',
          sender: { playerId: 'guest-b', displayName: 'Guest', avatarColorHex: '#38bdf8' },
          seedToken: hijackSeed,
          sentAt: 1001,
        })
      );
      assert.equal(hostUp.webSocket.received.length, hostCountBefore);

      // Post-HELLO guest hijack attempt cannot overwrite host seed or relay WELCOME_STATE to host
      await roomDo.instance.webSocketMessage(
        guestServerWs,
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'LOCK99',
          sender: { playerId: 'guest-b', displayName: 'Guest', avatarColorHex: '#38bdf8' },
          seedToken: hijackSeed,
          sentAt: 1002,
        })
      );
      const hostCountAfterGuestHello = hostUp.webSocket.received.length;
      await roomDo.instance.webSocketMessage(
        guestServerWs,
        JSON.stringify({
          type: 'WELCOME_STATE',
          roomCode: 'LOCK99',
          sender: { playerId: 'guest-b', displayName: 'Guest', avatarColorHex: '#38bdf8' },
          seedToken: hijackSeed,
          sentAt: 1003,
        })
      );
      await roomDo.instance.webSocketMessage(
        guestServerWs,
        JSON.stringify({
          type: 'WELCOME_STATE',
          roomCode: 'LOCK99',
          sender: { playerId: 'guest-b', displayName: 'Guest', avatarColorHex: '#38bdf8' },
          sentAt: 1004,
        })
      );
      assert.equal(
        hostUp.webSocket.received.length,
        hostCountAfterGuestHello,
        'Post-HELLO non-host WELCOME_STATE (with or without seedToken) must never relay to host'
      );
      const storedRow = roomDo.state.storage.sql
        .exec("SELECT value FROM room_state WHERE key = 'seed_token'")
        .toArray();
      assert.equal(storedRow[0]?.value, hostSeed);

      // Host joins WITHOUT seedToken: host_player_id still locks to host-a and blocks guest seed hijack
      const noSeedHostUp = await workerMod.default.fetch(
        new Request('https://capypaint.com/api/room?room=NOSEED', {
          headers: { Origin: 'https://capypaint.com', Upgrade: 'websocket', 'CF-Connecting-IP': '198.51.100.11' },
        }),
        devCtx.env
      );
      const noSeedGuestUp = await workerMod.default.fetch(
        new Request('https://capypaint.com/api/room?room=NOSEED', {
          headers: { Origin: 'https://capypaint.com', Upgrade: 'websocket', 'CF-Connecting-IP': '198.51.100.12' },
        }),
        devCtx.env
      );
      const noSeedRoomDo = devCtx.rooms.get('NOSEED');
      await noSeedRoomDo.instance.webSocketMessage(
        noSeedHostUp.webSocket.peer,
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'NOSEED',
          sender: { playerId: 'host-first', displayName: 'Host', avatarColorHex: '#fbbf24' },
          sentAt: 2000,
        })
      );
      const lockedHostRow = noSeedRoomDo.state.storage.sql
        .exec("SELECT value FROM room_state WHERE key = 'host_player_id'")
        .toArray();
      assert.equal(lockedHostRow[0]?.value, 'host-first');

      await noSeedRoomDo.instance.webSocketMessage(
        noSeedGuestUp.webSocket.peer,
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'NOSEED',
          sender: { playerId: 'evil-guest', displayName: 'Evil', avatarColorHex: '#38bdf8' },
          seedToken: hijackSeed,
          sentAt: 2001,
        })
      );
      const relayedGuestHello = JSON.parse(noSeedHostUp.webSocket.received.at(-1));
      assert.equal(relayedGuestHello.type, 'HELLO');
      assert.equal(
        'seedToken' in relayedGuestHello,
        false,
        'Non-host HELLO must strip injected seedToken when host joined without seedToken'
      );
      await noSeedRoomDo.instance.webSocketMessage(
        noSeedGuestUp.webSocket.peer,
        JSON.stringify({
          type: 'WELCOME_STATE',
          roomCode: 'NOSEED',
          sender: { playerId: 'evil-guest', displayName: 'Evil', avatarColorHex: '#38bdf8' },
          seedToken: hijackSeed,
          sentAt: 2002,
        })
      );
      const noSeedRows = noSeedRoomDo.state.storage.sql
        .exec("SELECT value FROM room_state WHERE key = 'seed_token'")
        .toArray();
      assert.equal(noSeedRows.length, 0);
      assert.equal(
        protoMod.evaluateRoomSeedAction({
          messageType: 'HELLO',
          incomingSeedToken: hijackSeed,
          hasSocketJoined: true,
          existingSeedToken: null,
          lastSavedSeedToken: null,
          lastWriteAtMs: 0,
          nowMs: 5000,
          isSeedAuthority: false,
        }),
        'ignore'
      );
      assert.equal(
        protoMod.evaluateRoomSeedAction({
          messageType: 'WELCOME_STATE',
          incomingSeedToken: hijackSeed,
          hasSocketJoined: true,
          existingSeedToken: null,
          lastSavedSeedToken: null,
          lastWriteAtMs: 0,
          nowMs: 5000,
          isSeedAuthority: false,
        }),
        'ignore'
      );

      // >6144B closes 1009, >40 frames/5s closes 1008
      await roomDo.instance.webSocketMessage(hostServerWs, 'X'.repeat(6500));
      assert.equal(hostServerWs.closedCode, 1009);
      for (let i = 0; i < 45; i++) {
        if (guestServerWs.closedCode !== null) break;
        await roomDo.instance.webSocketMessage(
          guestServerWs,
          JSON.stringify({
            type: 'HEARTBEAT',
            roomCode: 'LOCK99',
            sender: { playerId: 'guest-b', displayName: 'Guest', avatarColorHex: '#38bdf8' },
            sentAt: Date.now(),
          })
        );
      }
      assert.equal(guestServerWs.closedCode, 1008);

      // withApiSecurityHeaders deduplication & case-insensitive override across DO 429 room-full, 500, and conflicting 502
      {
        const hdrCtx = makeDoEnv({
          DoClass: workerMod.CoopRoomDurableObject,
          rateLimitQuota: 100,
          allowLocalhostOrigins: 'true',
        });
        const openSockets = [];
        for (let i = 0; i < protoMod.MAX_ROOM_PARTICIPANTS; i++) {
          const up = await workerMod.default.fetch(
            new Request('https://capypaint.com/api/room?room=FULL24', {
              headers: { Origin: 'https://capypaint.com', Upgrade: 'websocket' },
            }),
            hdrCtx.env
          );
          assert.equal(up.status, 101);
          openSockets.push(up.webSocket);
        }
        const roomFullRes = await workerMod.default.fetch(
          new Request('https://capypaint.com/api/room?room=FULL24', {
            headers: { Origin: 'https://capypaint.com', Upgrade: 'websocket' },
          }),
          hdrCtx.env
        );
        assert.equal(roomFullRes.status, 429);
        assert.equal(roomFullRes.headers.get('Retry-After'), '60');
        assertApiSecurityHeaders(roomFullRes, 'DO 429 room-full');
        for (const ws of openSockets) ws.close(1000, 'cleanup');

        const errUpgrade = await workerMod.default.fetch(
          new Request('https://capypaint.com/api/room?room=ERR500', {
            headers: { Origin: 'https://capypaint.com', Upgrade: 'websocket' },
          }),
          hdrCtx.env
        );
        errUpgrade.webSocket.close(1000, 'cleanup');
        const errDo = hdrCtx.rooms.get('ERR500');
        errDo.state.getWebSockets = () => {
          throw new Error('forced DO failure');
        };
        const do500Res = await workerMod.default.fetch(
          new Request('https://capypaint.com/api/room?room=ERR500', {
            headers: { Origin: 'https://capypaint.com', Upgrade: 'websocket' },
          }),
          hdrCtx.env
        );
        assert.equal(do500Res.status, 500);
        assertApiSecurityHeaders(do500Res, 'DO 500');

        const confUpgrade = await workerMod.default.fetch(
          new Request('https://capypaint.com/api/room?room=CONF52', {
            headers: { Origin: 'https://capypaint.com', Upgrade: 'websocket' },
          }),
          hdrCtx.env
        );
        confUpgrade.webSocket.close(1000, 'cleanup');
        hdrCtx.rooms.get('CONF52').instance.fetch = async () =>
          new OriginalResponse('Bad Gateway', {
            status: 502,
            headers: {
              'Cache-Control': 'public, max-age=999',
              'X-Frame-Options': 'ALLOWALL',
              'x-content-type-options': 'evil',
            },
          });
        const do502Res = await workerMod.default.fetch(
          new Request('https://capypaint.com/api/room?room=CONF52', {
            headers: { Origin: 'https://capypaint.com', Upgrade: 'websocket' },
          }),
          hdrCtx.env
        );
        assert.equal(do502Res.status, 502);
        assertApiSecurityHeaders(do502Res, 'DO 502 conflicting headers');
      }

      // Warm unseeded DO hostPlayerId expires cleanly past ROOM_STATE_TTL_MS even while guest socket stays open
      {
        const origNow = Date.now;
        let fakeNow = 1_700_000_000_000;
        Date.now = () => fakeNow;
        try {
          const ttlCtx = makeDoEnv({
            DoClass: workerMod.CoopRoomDurableObject,
            rateLimitQuota: 100,
          });

          // Case 1: TTL expiry via alarm() with open guest socket on unseeded room TTL002
          const oldHostUp = await workerMod.default.fetch(
            new Request('https://capypaint.com/api/room?room=TTL002', {
              headers: { Origin: 'https://capypaint.com', Upgrade: 'websocket' },
            }),
            ttlCtx.env
          );
          const guestUpTtl = await workerMod.default.fetch(
            new Request('https://capypaint.com/api/room?room=TTL002', {
              headers: { Origin: 'https://capypaint.com', Upgrade: 'websocket' },
            }),
            ttlCtx.env
          );
          const ttlRoom = ttlCtx.rooms.get('TTL002');
          await ttlRoom.instance.webSocketMessage(
            oldHostUp.webSocket.peer,
            JSON.stringify({
              type: 'HELLO',
              roomCode: 'TTL002',
              sender: { playerId: 'ttl-host-old', displayName: 'OldHost', avatarColorHex: '#fbbf24' },
              sentAt: fakeNow,
            })
          );
          await ttlRoom.instance.webSocketMessage(
            guestUpTtl.webSocket.peer,
            JSON.stringify({
              type: 'HELLO',
              roomCode: 'TTL002',
              sender: { playerId: 'ttl-guest', displayName: 'Guest', avatarColorHex: '#38bdf8' },
              sentAt: fakeNow + 10,
            })
          );
          await ttlRoom.instance.webSocketClose(oldHostUp.webSocket.peer, 1000, 'bye', true);
          assert.equal(ttlRoom.state.getWebSockets().length, 1);

          fakeNow += protoMod.ROOM_STATE_TTL_MS + 5_000;
          await ttlRoom.instance.alarm();
          const remainingRows = ttlRoom.state.storage.sql
            .exec('SELECT key, value FROM room_state')
            .toArray();
          assert.equal(remainingRows.length, 0, 'alarm() must expire unseeded SQLite room_state even with guest open');

          const newHostUp = await workerMod.default.fetch(
            new Request('https://capypaint.com/api/room?room=TTL002', {
              headers: { Origin: 'https://capypaint.com', Upgrade: 'websocket' },
            }),
            ttlCtx.env
          );
          await ttlRoom.instance.webSocketMessage(
            newHostUp.webSocket.peer,
            JSON.stringify({
              type: 'HELLO',
              roomCode: 'TTL002',
              sender: { playerId: 'ttl-host-new', displayName: 'NewHost', avatarColorHex: '#fbbf24' },
              seedToken: hostSeed,
              sentAt: fakeNow,
            })
          );
          assert.equal(
            ttlRoom.state.storage.sql
              .exec("SELECT value FROM room_state WHERE key = 'host_player_id'")
              .toArray()[0]?.value,
            'ttl-host-new'
          );
          assert.equal(
            ttlRoom.state.storage.sql
              .exec("SELECT value FROM room_state WHERE key = 'seed_token'")
              .toArray()[0]?.value,
            hostSeed
          );
          newHostUp.webSocket.close(1000, 'cleanup');
          guestUpTtl.webSocket.close(1000, 'cleanup');

          // Case 2: Warm DO expires in-memory hostPlayerId directly on HELLO even before alarm() runs (TTL004)
          fakeNow = 1_700_000_000_000;
          const old4 = await workerMod.default.fetch(
            new Request('https://capypaint.com/api/room?room=TTL004', {
              headers: { Origin: 'https://capypaint.com', Upgrade: 'websocket' },
            }),
            ttlCtx.env
          );
          const guest4 = await workerMod.default.fetch(
            new Request('https://capypaint.com/api/room?room=TTL004', {
              headers: { Origin: 'https://capypaint.com', Upgrade: 'websocket' },
            }),
            ttlCtx.env
          );
          const ttl4Room = ttlCtx.rooms.get('TTL004');
          await ttl4Room.instance.webSocketMessage(
            old4.webSocket.peer,
            JSON.stringify({
              type: 'HELLO',
              roomCode: 'TTL004',
              sender: { playerId: 'ttl4-old', displayName: 'Old4', avatarColorHex: '#fbbf24' },
              sentAt: fakeNow,
            })
          );
          await ttl4Room.instance.webSocketMessage(
            guest4.webSocket.peer,
            JSON.stringify({
              type: 'HELLO',
              roomCode: 'TTL004',
              sender: { playerId: 'ttl4-guest', displayName: 'Guest4', avatarColorHex: '#38bdf8' },
              sentAt: fakeNow + 10,
            })
          );
          await ttl4Room.instance.webSocketClose(old4.webSocket.peer, 1000, 'bye', true);

          fakeNow += protoMod.ROOM_STATE_TTL_MS + 5_000;
          const new4 = await workerMod.default.fetch(
            new Request('https://capypaint.com/api/room?room=TTL004', {
              headers: { Origin: 'https://capypaint.com', Upgrade: 'websocket' },
            }),
            ttlCtx.env
          );
          await ttl4Room.instance.webSocketMessage(
            new4.webSocket.peer,
            JSON.stringify({
              type: 'HELLO',
              roomCode: 'TTL004',
              sender: { playerId: 'ttl4-new', displayName: 'New4', avatarColorHex: '#fbbf24' },
              seedToken: hostSeed,
              sentAt: fakeNow,
            })
          );
          assert.equal(
            ttl4Room.state.storage.sql
              .exec("SELECT value FROM room_state WHERE key = 'host_player_id'")
              .toArray()[0]?.value,
            'ttl4-new'
          );
          assert.equal(
            ttl4Room.state.storage.sql
              .exec("SELECT value FROM room_state WHERE key = 'seed_token'")
              .toArray()[0]?.value,
            hostSeed
          );
          new4.webSocket.close(1000, 'cleanup');
          guest4.webSocket.close(1000, 'cleanup');

          // Case 3: Warm debounced pendingCheckpoint expires in alarm(), webSocketClose(), and webSocketError() instead of resetting TTL
          const hostSeed2 = await codecMod.encodeProgressDeltaToken({
            version: 2,
            sourceRef: { kind: 'sample', uri: 'assets/capybara.webp' },
            filledRegionIds: [1, 2, 3],
            updatedAt: 1100,
          });
          const hostSeed3 = await codecMod.encodeProgressDeltaToken({
            version: 2,
            sourceRef: { kind: 'sample', uri: 'assets/capybara.webp' },
            filledRegionIds: [1, 2, 3, 4],
            updatedAt: 1200,
          });

          const setupPendingRoom = async (roomCode) => {
            fakeNow = 1_700_000_000_000;
            const hUp = await workerMod.default.fetch(
              new Request(`https://capypaint.com/api/room?room=${roomCode}`, {
                headers: { Origin: 'https://capypaint.com', Upgrade: 'websocket' },
              }),
              ttlCtx.env
            );
            const gUp = await workerMod.default.fetch(
              new Request(`https://capypaint.com/api/room?room=${roomCode}`, {
                headers: { Origin: 'https://capypaint.com', Upgrade: 'websocket' },
              }),
              ttlCtx.env
            );
            const room = ttlCtx.rooms.get(roomCode);
            await room.instance.webSocketMessage(
              hUp.webSocket.peer,
              JSON.stringify({
                type: 'HELLO',
                roomCode,
                sender: { playerId: `${roomCode}-host`, displayName: 'Host', avatarColorHex: '#fbbf24' },
                seedToken: hostSeed,
                sentAt: fakeNow,
              })
            );
            await room.instance.webSocketMessage(
              gUp.webSocket.peer,
              JSON.stringify({
                type: 'HELLO',
                roomCode,
                sender: { playerId: `${roomCode}-guest`, displayName: 'Guest', avatarColorHex: '#38bdf8' },
                sentAt: fakeNow + 10,
              })
            );
            fakeNow += 100;
            await room.instance.webSocketMessage(
              hUp.webSocket.peer,
              JSON.stringify({
                type: 'WELCOME_STATE',
                roomCode,
                sender: { playerId: `${roomCode}-host`, displayName: 'Host', avatarColorHex: '#fbbf24' },
                seedToken: hostSeed2,
                sentAt: fakeNow,
              })
            );
            assert.equal(
              room.state.storage.sql
                .exec("SELECT key FROM room_state WHERE key = 'pending_seed'")
                .toArray().length,
              1,
              `${roomCode} must hold debounced pending_seed before TTL`
            );
            return { hUp, gUp, room };
          };

          // 3a: alarm() past TTL clears room_state even with warm pendingCheckpoint (0 sockets & with guest open)
          {
            const { hUp, gUp, room } = await setupPendingRoom('PENALM');
            hUp.webSocket.close(1000, 'cleanup');
            gUp.webSocket.close(1000, 'cleanup');
            fakeNow += protoMod.ROOM_STATE_TTL_MS + 5_000;
            await room.instance.alarm();
            const rows = room.state.storage.sql
              .exec('SELECT key, value, updated_at FROM room_state')
              .toArray();
            assert.equal(
              rows.length,
              0,
              `alarm() must not flush expired warm pendingCheckpoint (got ${JSON.stringify(rows)})`
            );
            // Verify new host can take over cleanly after expired alarm
            const takeUp = await workerMod.default.fetch(
              new Request('https://capypaint.com/api/room?room=PENALM', {
                headers: { Origin: 'https://capypaint.com', Upgrade: 'websocket' },
              }),
              ttlCtx.env
            );
            await room.instance.webSocketMessage(
              takeUp.webSocket.peer,
              JSON.stringify({
                type: 'HELLO',
                roomCode: 'PENALM',
                sender: { playerId: 'penalm-new-host', displayName: 'New', avatarColorHex: '#fbbf24' },
                seedToken: hostSeed3,
                sentAt: fakeNow,
              })
            );
            assert.equal(
              room.state.storage.sql
                .exec("SELECT value FROM room_state WHERE key = 'host_player_id'")
                .toArray()[0]?.value,
              'penalm-new-host'
            );
            takeUp.webSocket.close(1000, 'cleanup');
          }

          // 3b: webSocketClose() past TTL expires stale state BEFORE flushing warm pendingCheckpoint
          {
            const { hUp, gUp, room } = await setupPendingRoom('PENCLS');
            fakeNow += protoMod.ROOM_STATE_TTL_MS + 5_000;
            await room.instance.webSocketClose(gUp.webSocket.peer, 1000, 'late close', true);
            const rows = room.state.storage.sql
              .exec('SELECT key, value, updated_at FROM room_state')
              .toArray();
            assert.equal(
              rows.length,
              0,
              `webSocketClose() must not resurrect expired warm pendingCheckpoint (got ${JSON.stringify(rows)})`
            );
            hUp.webSocket.close(1000, 'cleanup');
            gUp.webSocket.close(1000, 'cleanup');
          }

          // 3c: webSocketError() past TTL expires stale state BEFORE flushing warm pendingCheckpoint
          {
            const { hUp, gUp, room } = await setupPendingRoom('PENERR');
            fakeNow += protoMod.ROOM_STATE_TTL_MS + 5_000;
            await room.instance.webSocketError(gUp.webSocket.peer, new Error('late error'));
            const rows = room.state.storage.sql
              .exec('SELECT key, value, updated_at FROM room_state')
              .toArray();
            assert.equal(
              rows.length,
              0,
              `webSocketError() must not resurrect expired warm pendingCheckpoint (got ${JSON.stringify(rows)})`
            );
            hUp.webSocket.close(1000, 'cleanup');
            gUp.webSocket.close(1000, 'cleanup');
          }

          // 3d: Non-expired alarm() at +6s still flushes warm pendingCheckpoint to seed_token
          {
            const { hUp, gUp, room } = await setupPendingRoom('PENOKK');
            fakeNow += 6_000;
            await room.instance.alarm();
            const seedRow = room.state.storage.sql
              .exec("SELECT value FROM room_state WHERE key = 'seed_token'")
              .toArray()[0];
            assert.equal(seedRow?.value, hostSeed2, 'Non-expired debounce alarm() must still flush pendingCheckpoint');
            hUp.webSocket.close(1000, 'cleanup');
            gUp.webSocket.close(1000, 'cleanup');
          }
        } finally {
          Date.now = origNow;
        }
      }
    } finally {
      for (const db of dbs) {
        try {
          db.close();
        } catch {
          // ignore
        }
      }
      globalThis.Response = OriginalResponse;
      if (PrevWsPair === undefined) delete globalThis.WebSocketPair;
      else globalThis.WebSocketPair = PrevWsPair;
      if (PrevReqRespPair === undefined) delete globalThis.WebSocketRequestResponsePair;
      else globalThis.WebSocketRequestResponsePair = PrevReqRespPair;
      await workerVite.close();
    }
  }

  // 6b. Service Worker & headers/wrangler hardening checks
  {
    // Service Worker & headers/wrangler hardening checks
    const headersText = fs.readFileSync(path.join(WEB_ROOT, 'public/_headers'), 'utf8');
    assert.match(headersText, /Cross-Origin-Opener-Policy:\s*same-origin-allow-popups/i);
    assert.match(headersText, /X-Permitted-Cross-Domain-Policies:\s*none/i);
    assert.match(headersText, /form-action\s+'self'/i);

    const wranglerRaw = fs.readFileSync(path.join(REPO_ROOT, 'wrangler.jsonc'), 'utf8');
    const wranglerCfg = JSON.parse(wranglerRaw.replace(/^\s*\/\/.*$/gm, ''));
    assert.equal(
      Array.isArray(wranglerCfg.ratelimits) &&
        wranglerCfg.ratelimits.some((r) => r?.name === 'API_RATE_LIMITER'),
      true,
      'wrangler.jsonc must declare API_RATE_LIMITER binding'
    );

    const swSrc = fs.readFileSync(path.join(WEB_ROOT, 'public/sw.js'), 'utf8');
    assert.match(swSrc, /isCacheableAssetResponse/, 'sw.js must validate cacheable asset responses');
    assert.match(swSrc, /isWithinSwScope/, 'sw.js must enforce registration scope boundary');
    assert.match(swSrc, /\.endsWith\('\.capy'\)/, 'sw.js must handle .capy packs network-first');
    assert.equal(
      /\/\/ 4\. Hashed static assets[\s\S]*ignoreSearch:\s*true/.test(swSrc),
      false,
      'sw.js static asset lookup must not use ignoreSearch: true across query versions'
    );
    assert.equal(
      /lowerPath\.endsWith\('\.capy'\)[\s\S]*?ignoreSearch:\s*true/.test(swSrc),
      false,
      'sw.js .capy offline fallback must not use ignoreSearch: true across query versions'
    );

    // Simulate sw.js offline .capy fetch to prove query isolation (?v=2 does not match unversioned)
    {
      const vm = await import('node:vm');
      const listeners = new Map();
      const cachedMap = new Map([
        ['https://capypaint.com/assets/daily.capy', new Response('v1-bytes', { status: 200 })],
      ]);
      const swCtx = {
        location: { href: 'https://capypaint.com/sw.js', origin: 'https://capypaint.com' },
        registration: { scope: 'https://capypaint.com/' },
        Response,
        Headers,
        URL,
        console,
        caches: {
          open: async () => ({
            put: async () => {},
            match: async (req) => {
              const key = typeof req === 'string' ? req : req.url;
              return cachedMap.get(key) ?? undefined;
            },
          }),
          keys: async () => [],
          delete: async () => true,
        },
        fetch: async () => {
          throw new Error('offline');
        },
        addEventListener: (type, fn) => listeners.set(type, fn),
        skipWaiting: () => {},
        clients: { claim: () => {} },
      };
      swCtx.self = swCtx;
      vm.runInNewContext(swSrc, swCtx);
      const fetchHandler = listeners.get('fetch');
      assert.ok(fetchHandler);

      let v1Promise;
      fetchHandler({
        request: { url: 'https://capypaint.com/assets/daily.capy', method: 'GET', destination: '' },
        respondWith: (p) => {
          v1Promise = p;
        },
      });
      assert.equal(await (await v1Promise).text(), 'v1-bytes');

      let v2Promise;
      fetchHandler({
        request: { url: 'https://capypaint.com/assets/daily.capy?v=2', method: 'GET', destination: '' },
        respondWith: (p) => {
          v2Promise = p;
        },
      });
      await assert.rejects(() => v2Promise, /offline/);
    }

    // Simulate sw.js navigation non-poisoning: standalone .html docs must never overwrite ./index.html and offline fallback stays distinct
    {
      const vm = await import('node:vm');
      for (const scopeCase of [
        {
          origin: 'https://capypaint.com',
          scope: 'https://capypaint.com/',
          base: 'https://capypaint.com/',
        },
        {
          origin: 'https://shthed.github.io',
          scope: 'https://shthed.github.io/capy/beta/',
          base: 'https://shthed.github.io/capy/beta/',
        },
      ]) {
        const listeners = new Map();
        const cachedMap = new Map([
          [scopeCase.base, new Response('<html><div id="root">CapyRoot</div></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })],
          [`${scopeCase.base}index.html`, new Response('<html><div id="root">CapyIndex</div></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })],
          [`${scopeCase.base}privacy-policy.html`, new Response('<html><title>Privacy Policy</title></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })],
        ]);
        let isOnline = true;
        const swCtx = {
          location: { href: `${scopeCase.base}sw.js`, origin: scopeCase.origin },
          registration: { scope: scopeCase.scope },
          Response,
          Headers,
          URL,
          console,
          caches: {
            open: async () => ({
              put: async (req, resp) => {
                const key = typeof req === 'string' ? req : req.url;
                cachedMap.set(key, resp.clone());
              },
              match: async (req) => {
                const key = typeof req === 'string' ? req : req.url;
                const resp = cachedMap.get(key);
                return resp ? resp.clone() : undefined;
              },
            }),
            keys: async () => [],
            delete: async () => true,
          },
          fetch: async (req) => {
            if (!isOnline) throw new Error('offline');
            const reqUrl = typeof req === 'string' ? req : req.url;
            const makeBasicHtml = (html) => {
              const resp = new Response(html, {
                status: 200,
                headers: { 'Content-Type': 'text/html' },
              });
              Object.defineProperty(resp, 'type', { value: 'basic' });
              return resp;
            };
            if (reqUrl.includes('privacy-policy.html')) {
              return makeBasicHtml('<html><title>Privacy Policy — Live</title></html>');
            }
            if (reqUrl.includes('404.html')) {
              return makeBasicHtml('<html><title>404 — Not Found</title></html>');
            }
            return makeBasicHtml('<html><div id="root">CapyOnline</div></html>');
          },
          addEventListener: (type, fn) => listeners.set(type, fn),
          skipWaiting: () => {},
          clients: { claim: () => {} },
        };
        swCtx.self = swCtx;
        vm.runInNewContext(swSrc, swCtx);
        const fetchHandler = listeners.get('fetch');
        assert.ok(fetchHandler);

        const navFetch = async (navUrl) => {
          let p;
          fetchHandler({
            request: {
              url: navUrl,
              method: 'GET',
              mode: 'navigate',
              destination: 'document',
              headers: new Headers(),
            },
            respondWith: (respPromise) => {
              p = respPromise;
            },
          });
          return await p;
        };

        // 1. Online navigation to privacy-policy.html and 404.html must NOT overwrite canonical index.html
        const onlinePrivacy = await navFetch(`${scopeCase.base}privacy-policy.html?from=settings`);
        assert.equal((await onlinePrivacy.text()).includes('Privacy Policy — Live'), true);
        const onlinePrivacyClean = await navFetch(`${scopeCase.base}privacy-policy.html`);
        assert.equal((await onlinePrivacyClean.text()).includes('Privacy Policy — Live'), true);
        const online404 = await navFetch(`${scopeCase.base}404.html`);
        assert.equal((await online404.text()).includes('404'), true);

        const storedIndexText = await (await cachedMap.get(`${scopeCase.base}index.html`).clone()).text();
        assert.equal(
          storedIndexText.includes('id="root"'),
          true,
          `Online standalone .html navigation must not poison ${scopeCase.base}index.html`
        );

        // 2. Offline reload of / and /?coop=1 must serve Capy Paint app shell, not Privacy Policy
        isOnline = false;
        const offlineRoot = await (await navFetch(scopeCase.base)).text();
        assert.equal(offlineRoot.includes('id="root"'), true, `Offline ${scopeCase.base} must serve Capy app`);
        const offlineQuery = await (await navFetch(`${scopeCase.base}?coop=1`)).text();
        assert.equal(offlineQuery.includes('CapyIndex'), true, `Offline ${scopeCase.base}?coop=1 must serve index.html`);

        // 3. Offline navigation to privacy-policy.html (with or without query) must serve Privacy Policy, not index.html
        const offlinePrivacy = await (await navFetch(`${scopeCase.base}privacy-policy.html`)).text();
        assert.equal(offlinePrivacy.includes('Privacy Policy — Live'), true);
        const offlinePrivacyQuery = await (await navFetch(`${scopeCase.base}privacy-policy.html?ref=1`)).text();
        assert.equal(offlinePrivacyQuery.includes('Privacy Policy — Live'), true);

        // 4. Offline navigation to uncached standalone .html must return error Response rather than app index.html
        const offlineMissingHtml = await navFetch(`${scopeCase.base}uncached-standalone.html`);
        assert.equal(offlineMissingHtml.type, 'error');

        // 5. F4 regression: v1 precached ./ and ./index.html -> online v2 nav on ./ -> offline ./ must serve v2 (never stale v1)
        isOnline = true;
        cachedMap.set(
          scopeCase.base,
          new Response('<html><div id="root">CapyV1</div></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          })
        );
        cachedMap.set(
          `${scopeCase.base}index.html`,
          new Response('<html><div id="root">CapyV1</div></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          })
        );
        swCtx.fetch = async (req) => {
          if (!isOnline) throw new Error('offline');
          const reqUrl = typeof req === 'string' ? req : req.url;
          const makeBasic = (html) => {
            const resp = new Response(html, {
              status: 200,
              headers: { 'Content-Type': 'text/html' },
            });
            Object.defineProperty(resp, 'type', { value: 'basic' });
            return resp;
          };
          if (reqUrl.includes('privacy-policy.html')) {
            return makeBasic('<html><title>Privacy Policy — V2</title></html>');
          }
          return makeBasic('<html><div id="root">CapyV2</div></html>');
        };
        const onlineRootV2 = await (await navFetch(scopeCase.base)).text();
        assert.equal(onlineRootV2.includes('CapyV2'), true);
        // Standalone .html visit must not overwrite v2 app shell
        await navFetch(`${scopeCase.base}privacy-policy.html`);
        isOnline = false;
        const offlineRootV2 = await (await navFetch(scopeCase.base)).text();
        assert.equal(
          offlineRootV2.includes('CapyV2'),
          true,
          `Offline ${scopeCase.base} after online update must serve v2, not stale precached v1`
        );
        const offlineQueryV2 = await (await navFetch(`${scopeCase.base}?coop=1`)).text();
        assert.equal(
          offlineQueryV2.includes('CapyV2'),
          true,
          `Offline ${scopeCase.base}?coop=1 after online update must serve v2`
        );
        const offlineIndexV2 = await (await navFetch(`${scopeCase.base}index.html`)).text();
        assert.equal(
          offlineIndexV2.includes('CapyV2'),
          true,
          `Offline ${scopeCase.base}index.html after online update must serve v2`
        );
      }
    }
  }
}
