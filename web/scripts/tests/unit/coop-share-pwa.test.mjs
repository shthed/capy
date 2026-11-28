/**
 * [Unit 05] ShareLinkService, HybridCoopRoomAdapter, Cloudflare Worker relay & PwaService.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function runCoopSharePwaTests({ vite, projectRoot, logUnitStart, logUnitPass }) {
    const versionMod = await vite.ssrLoadModule('/src/version.ts');
    logUnitStart('Testing ShareLinkService, HybridCoopRoomAdapter, Cloudflare Worker relay & PwaService...');
    const shareLinkMod = await vite.ssrLoadModule('/src/services/ShareLinkService.ts');
    const providerMod = await vite.ssrLoadModule('/src/services/providers/ProviderRegistry.ts');
    const relayProtoMod = await vite.ssrLoadModule(
      path.resolve(projectRoot, '../worker/coopRoomProtocol.ts')
    );

    assert.equal(shareLinkMod.CANONICAL_PRODUCTION_URL, 'https://capypaint.com/');
    const builtShare = await shareLinkMod.buildShareProgressUrl({
      sourceRef: { kind: 'sample', uri: 'assets/capybara.webp' },
      filledRegionIds: [1, 2, 3],
      roomCode: 'abc123',
    });
    assert.equal(
      builtShare.url.startsWith('https://capypaint.com/?room=ABC123#s='),
      true,
      `SSR canonical share URL must target https://capypaint.com/, got ${builtShare.url}`
    );
    for (const hostBase of [
      'https://capypaint.com/',
      'https://shthed.github.io/capy/',
    ]) {
      const parsedLink = await shareLinkMod.parseShareLinkFromUrl(
        `${hostBase}?room=abc123#s=${builtShare.token}`
      );
      assert.equal(parsedLink.roomCode, 'ABC123');
      assert.deepEqual(parsedLink.delta?.filledRegionIds, [1, 2, 3]);
      assert.equal(parsedLink.matchedSample?.id, 'capybara_sample');
    }

    // Corrupt/invalid #s= token must preserve ?room= code and surface tokenError without throwing
    const corruptTokenLink = await shareLinkMod.parseShareLinkFromUrl(
      'https://capypaint.com/?room=xy9876#s=not_a_valid_token_!!!'
    );
    assert.equal(corruptTokenLink.roomCode, 'XY9876');
    assert.equal(corruptTokenLink.delta, null);
    assert.equal(corruptTokenLink.matchedSample, null);
    assert.equal(corruptTokenLink.hasToken, true);
    assert.equal(typeof corruptTokenLink.tokenError, 'string');

    // BroadcastChannel Co-op room namespacing across /capy/, /capy/beta/, and /capy/alpha/<num>/ on shared origin
    const prevChanWindow = globalThis.window;
    try {
      globalThis.window = {
        location: { pathname: '/capy/', origin: 'https://shthed.github.io', search: '' },
      };
      const stableChan = providerMod.resolveCoopBroadcastChannelName('ABC123');
      globalThis.window = {
        location: { pathname: '/capy/beta/', origin: 'https://shthed.github.io', search: '' },
      };
      const betaChan = providerMod.resolveCoopBroadcastChannelName('ABC123');
      globalThis.window = {
        location: { pathname: '/capy/alpha/495/', origin: 'https://shthed.github.io', search: '' },
      };
      const alphaChan = providerMod.resolveCoopBroadcastChannelName('ABC123');
      assert.equal(stableChan, 'capy_coop_room_stable_ABC123');
      assert.equal(betaChan, 'capy_coop_room_beta_ABC123');
      assert.equal(alphaChan, 'capy_coop_room_alpha_495_ABC123');
      assert.notEqual(stableChan, betaChan);
      assert.notEqual(betaChan, alphaChan);
    } finally {
      globalThis.window = prevChanWindow;
    }

    assert.equal(
      providerMod.resolveCoopRoomWsUrl(undefined, {
        protocol: 'https:',
        host: 'capypaint.com',
        hostname: 'capypaint.com',
      }),
      'wss://capypaint.com/api/room'
    );
    assert.equal(
      providerMod.resolveCoopRoomWsUrl(undefined, {
        protocol: 'https:',
        host: 'www.capypaint.com',
        hostname: 'www.capypaint.com',
      }),
      'wss://capypaint.com/api/room'
    );
    assert.equal(
      providerMod.resolveCoopRoomWsUrl(undefined, {
        protocol: 'https:',
        host: 'paint.capyboop.com',
        hostname: 'paint.capyboop.com',
      }),
      'wss://paint.capyboop.com/api/room'
    );
    assert.equal(
      providerMod.resolveCoopRoomWsUrl(undefined, {
        protocol: 'https:',
        host: 'capy-paint.example.workers.dev',
        hostname: 'capy-paint.example.workers.dev',
      }),
      null,
      'Third-party .workers.dev origins must NOT auto-connect without explicit VITE_CAPY_ROOM_WS_URL'
    );
    assert.equal(
      providerMod.resolveCoopRoomWsUrl(undefined, {
        protocol: 'https:',
        host: 'preview.capypaint.com',
        hostname: 'preview.capypaint.com',
      }),
      'wss://preview.capypaint.com/api/room'
    );
    assert.equal(
      providerMod.resolveCoopRoomWsUrl(undefined, {
        protocol: 'https:',
        host: 'appassets.androidplatform.net',
        hostname: 'appassets.androidplatform.net',
      }),
      'wss://capypaint.com/api/room'
    );
    assert.equal(
      providerMod.resolveCoopRoomWsUrl(undefined, {
        protocol: 'http:',
        host: 'localhost:3000',
        hostname: 'localhost',
      }),
      null,
      'Localhost without VITE_CAPY_ROOM_WS_URL must stay null so BroadcastChannel runs without spurious WS errors'
    );
    assert.equal(
      providerMod.resolveCoopRoomWsUrl('wss://custom-relay.example/ws', {
        protocol: 'https:',
        host: 'capypaint.com',
        hostname: 'capypaint.com',
      }),
      'wss://custom-relay.example/ws'
    );

    for (let attempt = 0; attempt <= 10; attempt++) {
      const minBackoff = providerMod.computeCoopReconnectDelayMs(attempt, 0);
      const maxBackoff = providerMod.computeCoopReconnectDelayMs(attempt, 1);
      assert.equal(minBackoff >= 1000 && minBackoff <= 15_000, true);
      assert.equal(maxBackoff >= 1000 && maxBackoff <= 15_000, true);
      assert.equal(maxBackoff >= minBackoff, true);
    }

    // Transport-aware peer pruning & PONG handling on HybridCoopRoomAdapter
    {
      const prevWS = globalThis.WebSocket;
      const prevWin = globalThis.window;
      const sentWsFrames = [];
      let latestMockSocket = null;
      class MockRoomSocket {
        static OPEN = 1;
        static CLOSED = 3;
        constructor(url) {
          this.url = url;
          this.readyState = 1;
          latestMockSocket = this;
        }
        send(payload) {
          sentWsFrames.push(payload);
        }
        close() {
          this.readyState = 3;
        }
      }
      globalThis.WebSocket = MockRoomSocket;
      globalThis.window = {
        location: { protocol: 'https:', host: 'capypaint.com', hostname: 'capypaint.com' },
        addEventListener() {},
        removeEventListener() {},
      };
      const adapter = new providerMod.HybridCoopRoomAdapter();
      try {
        await adapter.joinRoom(
          'rmtest',
          {
            playerId: 'self-1',
            displayName: 'Self Capy',
            avatarColorHex: '#38bdf8',
            lastActiveAt: Date.now(),
          },
          builtShare.token
        );
        assert.ok(latestMockSocket, 'HybridCoopRoomAdapter must open WebSocket on capypaint.com');
        latestMockSocket.onopen?.();
        assert.equal(sentWsFrames.length, 1, 'onopen must send initial HELLO over WebSocket');
        assert.equal(JSON.parse(sentWsFrames[0]).type, 'HELLO');

        // Raw PONG frame from C++ edge auto-response must be ignored cleanly without JSON parse error
        latestMockSocket.onmessage?.({ data: 'PONG' });

        // Remote WS peer joins and ages past 18s without 5s HEARTBEAT frames
        latestMockSocket.onmessage?.({
          data: JSON.stringify({
            type: 'WELCOME_STATE',
            roomCode: 'RMTEST',
            sender: {
              playerId: 'ws-peer-2',
              displayName: 'Remote Peer',
              avatarColorHex: '#f59e0b',
              lastActiveAt: Date.now() - 25_000,
            },
            seedToken: builtShare.token,
            sentAt: Date.now(),
          }),
        });
        adapter.participants.get('ws-peer-2').lastActiveAt = Date.now() - 25_000;
        adapter.pruneStaleParticipants();
        assert.equal(
          adapter.participants.has('ws-peer-2'),
          true,
          'Remote WebSocket peers must NOT be dropped at 18s when 5s HEARTBEAT is local-only'
        );

        // Local BroadcastChannel peer DOES prune after 18s inactivity
        adapter.handleWireMessage(
          {
            type: 'HEARTBEAT',
            roomCode: 'RMTEST',
            sender: {
              playerId: 'bc-peer-3',
              displayName: 'Local Tab',
              avatarColorHex: '#10b981',
              lastActiveAt: Date.now(),
            },
            sentAt: Date.now(),
          },
          'channel'
        );
        adapter.participants.get('bc-peer-3').lastActiveAt = Date.now() - 25_000;
        adapter.pruneStaleParticipants();
        assert.equal(
          adapter.participants.has('bc-peer-3'),
          false,
          'Stale BroadcastChannel peers must still prune cleanly past 18s'
        );

        // Socket close clears WS peers and schedules reconnect
        latestMockSocket.onclose?.();
        assert.equal(adapter.participants.has('ws-peer-2'), false);
        assert.equal(Boolean(adapter.wsReconnectTimer), true);
      } finally {
        adapter.leaveRoom();
        globalThis.WebSocket = prevWS;
        globalThis.window = prevWin;
      }
    }

    // Visibility-aware local BroadcastChannel heartbeat pause/resume on HybridCoopRoomAdapter
    {
      const prevWS = globalThis.WebSocket;
      const prevWin = globalThis.window;
      const prevDoc = globalThis.document;
      const prevBC = globalThis.BroadcastChannel;
      const localMessages = [];
      const docListeners = new Map();

      class MockRoomSocket {
        static OPEN = 1;
        static CLOSED = 3;
        constructor() {
          this.readyState = 1;
        }
        send() {}
        close() {
          this.readyState = 3;
        }
      }
      class MockBroadcastChannel {
        constructor(name) {
          this.name = name;
        }
        postMessage(msg) {
          localMessages.push(msg);
        }
        close() {}
      }
      const mockDoc = {
        hidden: false,
        visibilityState: 'visible',
        addEventListener(type, fn) {
          const set = docListeners.get(type) || new Set();
          set.add(fn);
          docListeners.set(type, set);
        },
        removeEventListener(type, fn) {
          docListeners.get(type)?.delete(fn);
        },
        dispatch(type) {
          for (const fn of [...(docListeners.get(type) || [])]) {
            fn();
          }
        },
      };

      globalThis.WebSocket = MockRoomSocket;
      globalThis.BroadcastChannel = MockBroadcastChannel;
      globalThis.document = mockDoc;
      globalThis.window = {
        location: { protocol: 'https:', host: 'capypaint.com', hostname: 'capypaint.com' },
        addEventListener() {},
        removeEventListener() {},
      };

      const adapter = new providerMod.HybridCoopRoomAdapter();
      try {
        await adapter.joinRoom(
          'rmvis1',
          {
            playerId: 'self-vis',
            displayName: 'Vis Capy',
            avatarColorHex: '#38bdf8',
            lastActiveAt: Date.now(),
          },
          builtShare.token
        );
        assert.equal(Boolean(adapter.heartbeatTimer), true, 'Local heartbeat timer starts while visible');
        assert.equal(Boolean(adapter.wsPingTimer), true, 'WebSocket ping timer starts on join');

        mockDoc.hidden = true;
        mockDoc.visibilityState = 'hidden';
        mockDoc.dispatch('visibilitychange');
        assert.equal(
          adapter.heartbeatTimer,
          null,
          '5s local BroadcastChannel heartbeat must pause while document is hidden'
        );
        assert.equal(
          Boolean(adapter.wsPingTimer),
          true,
          '30s WebSocket PING keepalive must remain active while hidden'
        );

        const countBeforeVisible = localMessages.filter((m) => m?.type === 'HEARTBEAT').length;
        mockDoc.hidden = false;
        mockDoc.visibilityState = 'visible';
        mockDoc.dispatch('visibilitychange');
        assert.equal(
          Boolean(adapter.heartbeatTimer),
          true,
          '5s local BroadcastChannel heartbeat must resume when document becomes visible'
        );
        const countAfterVisible = localMessages.filter((m) => m?.type === 'HEARTBEAT').length;
        assert.equal(
          countAfterVisible,
          countBeforeVisible + 1,
          'Returning to visible must immediately emit a local HEARTBEAT frame'
        );
      } finally {
        adapter.leaveRoom();
        globalThis.WebSocket = prevWS;
        globalThis.window = prevWin;
        globalThis.document = prevDoc;
        globalThis.BroadcastChannel = prevBC;
      }
    }

    assert.equal(relayProtoMod.normalizeRoomCode(' ab-c_123! '), 'ABC123');
    assert.equal(relayProtoMod.normalizeRoomCode('!!!'), null);
    assert.equal(relayProtoMod.isAllowedRelayOrigin(null), false);
    assert.equal(relayProtoMod.isAllowedRelayOrigin(''), false);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('   '), false);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('https://capypaint.com'), true);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('https://www.capypaint.com'), true);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('https://paint.capyboop.com'), true);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('https://capyboop.github.io'), true);
    /* capy-dev-only:start */
    assert.equal(relayProtoMod.isAllowedRelayOrigin('https://shthed.github.io'), true);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('http://shthed.github.io'), false);
    /* capy-dev-only:end */
    assert.equal(relayProtoMod.isAllowedRelayOrigin('https://appassets.androidplatform.net'), true);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('http://localhost:5173'), true);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('https://evil.workers.dev'), false);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('http://capypaint.com'), false);
    assert.equal(relayProtoMod.isAllowedRelayOrigin('https://evil.example.com'), false);
    assert.equal(
      relayProtoMod.isAllowedRelayOrigin(
        'https://preview.example.com',
        'https://other.example.com, https://preview.example.com'
      ),
      true
    );

    assert.equal(relayProtoMod.MAX_COOP_FRAME_BYTES, 6144);
    assert.equal(relayProtoMod.MAX_SEED_TOKEN_CHARS, 4096);
    assert.equal(relayProtoMod.isValidSeedToken(builtShare.token), true);
    assert.equal(relayProtoMod.isValidSeedToken('not!valid!base64'), false);
    assert.equal(
      relayProtoMod.isValidSeedToken(Buffer.from([0x99, 0x02, 0x00]).toString('base64url')),
      false
    );

    const maxLenValidSeed = 'AAI' + 'A'.repeat(4093);
    assert.equal(maxLenValidSeed.length, 4096);
    const maxSeedHello = relayProtoMod.validateCoopFrame(
      JSON.stringify({
        type: 'HELLO',
        roomCode: 'ABC123',
        sender: { playerId: 'p1', displayName: 'Capy', avatarColorHex: '#38bdf8', lastActiveAt: 1 },
        seedToken: maxLenValidSeed,
        sentAt: 100,
      }),
      'ABC123'
    );
    assert.equal(maxSeedHello.ok, true, '4096-char valid seedToken frame must fit under 6144 bytes');
    assert.equal(
      relayProtoMod.validateCoopFrame(
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'ABC123',
          sender: { playerId: 'p1', displayName: 'Capy', avatarColorHex: '#38bdf8', lastActiveAt: 1 },
          seedToken: maxLenValidSeed + 'A',
          sentAt: 100,
        }),
        'ABC123'
      ).reason,
      'seed_token_too_large'
    );

    const validRelayFrame = relayProtoMod.validateCoopFrame(
      JSON.stringify({
        type: 'PAINT_EVENT',
        roomCode: 'abc123',
        sender: {
          playerId: 'p1',
          displayName: 'Sunny Capy',
          avatarColorHex: '#38bdf8',
          lastActiveAt: 1000,
        },
        paintEvent: { eventId: 'ev1', regionIds: [4, 5], action: 'FILL' },
        sentAt: 1234,
      }),
      'ABC123'
    );
    assert.equal(validRelayFrame.ok, true);
    assert.equal(validRelayFrame.message?.roomCode, 'ABC123');
    assert.equal(
      relayProtoMod.validateCoopFrame('x'.repeat(6145), 'ABC123').reason,
      'frame_size_exceeded',
      'Worker Co-op relay must enforce <= 6144 byte frame cap'
    );
    for (const badPaintEvent of [
      { eventId: '', regionIds: [1], action: 'FILL' },
      { eventId: 'x'.repeat(97), regionIds: [1], action: 'FILL' },
      { eventId: 'ev-empty', regionIds: [], action: 'FILL' },
      { eventId: 'ev-neg', regionIds: [-1], action: 'FILL' },
      { eventId: 'ev-many', regionIds: Array.from({ length: 513 }, (_, i) => i), action: 'FILL' },
    ]) {
      assert.equal(
        relayProtoMod.validateCoopFrame(
          JSON.stringify({
            type: 'PAINT_EVENT',
            roomCode: 'ABC123',
            sender: { playerId: 'p1', displayName: 'Capy', avatarColorHex: '#fff', lastActiveAt: 1 },
            paintEvent: badPaintEvent,
            sentAt: 1,
          }),
          'ABC123'
        ).reason,
        'invalid_event_payload'
      );
    }
    assert.equal(
      relayProtoMod.validateCoopFrame(
        JSON.stringify({
          type: 'UNFILL_EVENT',
          roomCode: 'ABC123',
          sender: { playerId: 'p1', displayName: 'Capy', avatarColorHex: '#fff', lastActiveAt: 1 },
          unfillEvent: { eventId: 'uf1', regionIds: [-2] },
          sentAt: 1,
        }),
        'ABC123'
      ).reason,
      'invalid_event_payload'
    );
    assert.equal(
      relayProtoMod.validateCoopFrame(
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'OTHER1',
          sender: { playerId: 'p1', displayName: 'Capy', avatarColorHex: '#fff', lastActiveAt: 1 },
          sentAt: 1,
        }),
        'ABC123'
      ).reason,
      'room_mismatch'
    );
    assert.equal(relayProtoMod.RESERVED_RELAY_PLAYER_ID, '__capy_room_relay__');
    assert.equal(
      relayProtoMod.validateCoopFrame(
        JSON.stringify({
          type: 'HELLO',
          roomCode: 'ABC123',
          sender: { playerId: ' __capy_room_relay__ ', displayName: 'Fake', avatarColorHex: '#fff', lastActiveAt: 1 },
          sentAt: 1,
        }),
        'ABC123'
      ).reason,
      'reserved_sender_id'
    );
    assert.deepEqual(
      relayProtoMod.resolveBoundSocketSender(null, {
        playerId: 'p1',
        displayName: 'Capy',
        avatarColorHex: '#fff',
        lastActiveAt: 1,
      }),
      { ok: true, boundPlayerId: 'p1' }
    );
    assert.deepEqual(
      relayProtoMod.resolveBoundSocketSender('p1', {
        playerId: 'p2',
        displayName: 'Spoofer',
        avatarColorHex: '#fff',
        lastActiveAt: 1,
      }),
      { ok: false, reason: 'sender_mismatch' }
    );
    const workerIndexSrc = fs.readFileSync(path.resolve(projectRoot, '../worker/index.ts'), 'utf8');
    assert.equal(
      workerIndexSrc.includes('resolveBoundSocketSender') &&
        workerIndexSrc.includes('RESERVED_RELAY_PLAYER_ID') &&
        workerIndexSrc.includes("'pending_seed'"),
      true,
      'worker/index.ts must bind socket sender IDs, block reserved relay IDs, and checkpoint pending_seed in SQLite'
    );

    // Rate limiting (40 frames / 5000ms) & write-once initial HELLO seedToken policy
    let rlTimestamps = [];
    for (let i = 0; i < 40; i++) {
      const rl = relayProtoMod.checkSocketRateLimit(rlTimestamps, 1000 + i * 10);
      assert.equal(rl.allowed, true);
      rlTimestamps = rl.timestamps;
    }
    assert.equal(relayProtoMod.checkSocketRateLimit(rlTimestamps, 1500).allowed, false);
    assert.equal(relayProtoMod.checkSocketRateLimit(rlTimestamps, 6001).allowed, true);

    assert.equal(
      relayProtoMod.evaluateRoomSeedAction({
        messageType: 'HELLO',
        incomingSeedToken: builtShare.token,
        hasSocketJoined: true,
        existingSeedToken: null,
        lastSavedSeedToken: null,
        lastWriteAtMs: 0,
        nowMs: 1000,
      }),
      'write_now'
    );
    assert.equal(
      relayProtoMod.evaluateRoomSeedAction({
        messageType: 'HELLO',
        incomingSeedToken: maxLenValidSeed,
        hasSocketJoined: true,
        existingSeedToken: builtShare.token,
        lastSavedSeedToken: builtShare.token,
        lastWriteAtMs: 1000,
        nowMs: 9000,
      }),
      'ignore',
      'Late HELLO must never overwrite an existing room seed_token (F-03)'
    );
    assert.equal(
      relayProtoMod.evaluateRoomSeedAction({
        messageType: 'WELCOME_STATE',
        incomingSeedToken: maxLenValidSeed,
        hasSocketJoined: true,
        existingSeedToken: builtShare.token,
        lastSavedSeedToken: builtShare.token,
        lastWriteAtMs: 1000,
        nowMs: 3000,
      }),
      'debounce'
    );
    assert.equal(
      relayProtoMod.evaluateRoomSeedAction({
        messageType: 'WELCOME_STATE',
        incomingSeedToken: maxLenValidSeed,
        hasSocketJoined: true,
        existingSeedToken: builtShare.token,
        lastSavedSeedToken: builtShare.token,
        lastWriteAtMs: 1000,
        nowMs: 6500,
      }),
      'write_now'
    );

    const wranglerRaw = fs.readFileSync(path.resolve(projectRoot, '../wrangler.jsonc'), 'utf8');
    const wranglerJson = JSON.parse(wranglerRaw.replace(/^\s*\/\/.*$/gm, ''));
    assert.equal(wranglerJson.name, 'capy-paint');
    assert.equal(wranglerJson.workers_dev, false);
    assert.equal(wranglerJson.preview_urls, false);
    assert.equal(wranglerJson.assets?.directory, './web/dist');
    assert.equal(wranglerJson.assets?.not_found_handling, 'single-page-application');
    assert.deepEqual(wranglerJson.assets?.run_worker_first, ['/api/*']);
    assert.deepEqual(wranglerJson.migrations?.[0]?.new_sqlite_classes, ['CoopRoomDurableObject']);
    assert.equal(
      wranglerJson.routes?.some((r) => r.pattern === 'capypaint.com' && r.custom_domain === true),
      true
    );

    // PwaService scoped cache naming, vite.config fingerprint parser & stamped dist/sw.js check
    const pwaMod = await vite.ssrLoadModule('/src/services/PwaService.ts');
    const viteConfigMod = await vite.ssrLoadModule('/vite.config.ts');
    assert.equal(
      pwaMod.resolvePwaCacheName('https://shthed.github.io/capy/beta/', '2.6.0'),
      'capy-cache-v2.6.0:/capy/beta/'
    );
    assert.equal(
      pwaMod.resolvePwaCacheName('https://capypaint.com/', '2.6.0'),
      'capy-cache-v2.6.0:/'
    );

    // PwaService applyUpdate reload race hardening (5s waiting-clear fallback, 250ms post-5s poll, 10s hard cap)
    {
      assert.equal(pwaMod.PWA_UPDATE_FALLBACK_MS, 5000);
      assert.equal(pwaMod.PWA_UPDATE_HARD_CAP_MS, 10000);
      assert.equal(pwaMod.PWA_UPDATE_WAIT_POLL_MS, 250);
      assert.equal(typeof pwaMod.applyServiceWorkerUpdate, 'function');
      assert.equal(typeof pwaMod.PwaServiceClass, 'function');

      const createVirtualClock = () => {
        let now = 0;
        let nextId = 1;
        const timers = new Map();
        return {
          get now() {
            return now;
          },
          setTimeoutFn(fn, ms) {
            const id = nextId++;
            timers.set(id, { id, fireAt: now + Math.max(0, ms), intervalMs: null, fn });
            return id;
          },
          clearTimeoutFn(id) {
            timers.delete(id);
          },
          setIntervalFn(fn, ms) {
            const id = nextId++;
            const step = Math.max(1, ms);
            timers.set(id, { id, fireAt: now + step, intervalMs: step, fn });
            return id;
          },
          clearIntervalFn(id) {
            timers.delete(id);
          },
          advanceBy(ms) {
            const target = now + ms;
            while (true) {
              let earliest = null;
              for (const entry of timers.values()) {
                if (entry.fireAt <= target) {
                  if (!earliest || entry.fireAt < earliest.fireAt || (entry.fireAt === earliest.fireAt && entry.id < earliest.id)) {
                    earliest = entry;
                  }
                }
              }
              if (!earliest) break;
              now = earliest.fireAt;
              if (earliest.intervalMs !== null) {
                earliest.fireAt = now + earliest.intervalMs;
              } else {
                timers.delete(earliest.id);
              }
              earliest.fn();
            }
            now = target;
          },
          activeTimerCount() {
            return timers.size;
          },
        };
      };

      const createMockEventTarget = ({ controller = { state: 'activated' } } = {}) => {
        const listeners = new Map();
        const target = {
          controller,
          addCalls: 0,
          removeCalls: 0,
          addEventListener(type, fn, options) {
            target.addCalls += 1;
            let bucket = listeners.get(type);
            if (!bucket) {
              bucket = new Map();
              listeners.set(type, bucket);
            }
            if (!bucket.has(fn)) {
              bucket.set(fn, Boolean(options && typeof options === 'object' && options.once));
            }
          },
          removeEventListener(type, fn) {
            target.removeCalls += 1;
            const bucket = listeners.get(type);
            if (bucket) {
              bucket.delete(fn);
            }
          },
          dispatch(type) {
            const bucket = listeners.get(type);
            if (!bucket) return;
            for (const [fn, once] of Array.from(bucket.entries())) {
              if (once) bucket.delete(fn);
              fn();
            }
          },
          listenerCount(type) {
            return listeners.get(type)?.size ?? 0;
          },
        };
        return target;
      };

      const createMockWaitingWorker = (postMessageImpl) => {
        const events = createMockEventTarget();
        const messages = [];
        return {
          ...events,
          messages,
          postMessage(msg) {
            messages.push(msg);
            if (postMessageImpl) postMessageImpl(msg);
          },
        };
      };

      // 1. controllerchange before 5s: reloads once immediately and cleans up all timers & listeners
      {
        const clock = createVirtualClock();
        const container = createMockEventTarget();
        const waitingWorker = createMockWaitingWorker();
        const registration = { waiting: waitingWorker };
        let reloads = 0;

        const handle = pwaMod.applyServiceWorkerUpdate({
          registration,
          serviceWorkerContainer: container,
          reload: () => {
            reloads += 1;
          },
          setTimeoutFn: clock.setTimeoutFn,
          clearTimeoutFn: clock.clearTimeoutFn,
          setIntervalFn: clock.setIntervalFn,
          clearIntervalFn: clock.clearIntervalFn,
        });

        assert.equal(handle.started, true);
        assert.deepEqual(waitingWorker.messages, [{ type: 'SKIP_WAITING' }]);
        assert.equal(clock.activeTimerCount(), 2);
        assert.equal(container.listenerCount('controllerchange'), 1);
        assert.equal(waitingWorker.listenerCount('statechange'), 1);

        clock.advanceBy(400);
        assert.equal(reloads, 0);
        container.dispatch('controllerchange');
        assert.equal(reloads, 1);
        assert.equal(clock.activeTimerCount(), 0);
        assert.equal(container.listenerCount('controllerchange'), 0);
        assert.equal(waitingWorker.listenerCount('statechange'), 0);

        clock.advanceBy(15000);
        assert.equal(reloads, 1);
      }

      // 2. registration.waiting already cleared by 5s (no controllerchange): waits full 5s, reloads once, cleans 10s cap
      {
        const clock = createVirtualClock();
        const container = createMockEventTarget();
        const waitingWorker = createMockWaitingWorker();
        const registration = { waiting: waitingWorker };
        let reloads = 0;

        pwaMod.applyServiceWorkerUpdate({
          registration,
          serviceWorkerContainer: container,
          reload: () => {
            reloads += 1;
          },
          setTimeoutFn: clock.setTimeoutFn,
          clearTimeoutFn: clock.clearTimeoutFn,
          setIntervalFn: clock.setIntervalFn,
          clearIntervalFn: clock.clearIntervalFn,
        });

        clock.advanceBy(1500);
        assert.equal(reloads, 0, 'Must not reload prematurely at legacy 1500ms timeout');

        clock.advanceBy(500);
        registration.waiting = null;
        waitingWorker.dispatch('statechange');
        assert.equal(reloads, 0, 'statechange before 5s fallback must wait for controllerchange or 5s check');

        clock.advanceBy(2999);
        assert.equal(clock.now, 4999);
        assert.equal(reloads, 0);

        clock.advanceBy(1);
        assert.equal(clock.now, 5000);
        assert.equal(reloads, 1);
        assert.equal(clock.activeTimerCount(), 0);
        assert.equal(container.listenerCount('controllerchange'), 0);
        assert.equal(waitingWorker.listenerCount('statechange'), 0);

        clock.advanceBy(10000);
        assert.equal(reloads, 1);
      }

      // 3a. registration.waiting still present at 5s, clears at 6500ms via statechange
      {
        const clock = createVirtualClock();
        const container = createMockEventTarget();
        const waitingWorker = createMockWaitingWorker();
        const registration = { waiting: waitingWorker };
        let reloads = 0;

        pwaMod.applyServiceWorkerUpdate({
          registration,
          serviceWorkerContainer: container,
          reload: () => {
            reloads += 1;
          },
          setTimeoutFn: clock.setTimeoutFn,
          clearTimeoutFn: clock.clearTimeoutFn,
          setIntervalFn: clock.setIntervalFn,
          clearIntervalFn: clock.clearIntervalFn,
        });

        clock.advanceBy(5000);
        assert.equal(reloads, 0, 'Must not reload at 5s while registration.waiting is still present');
        assert.equal(clock.activeTimerCount(), 2, '10s hard-cap timer and 250ms poll interval should be active');

        clock.advanceBy(1499);
        assert.equal(reloads, 0);

        clock.advanceBy(1);
        assert.equal(clock.now, 6500);
        registration.waiting = null;
        waitingWorker.dispatch('statechange');
        assert.equal(reloads, 1);
        assert.equal(clock.activeTimerCount(), 0);
        assert.equal(container.listenerCount('controllerchange'), 0);
        assert.equal(waitingWorker.listenerCount('statechange'), 0);

        clock.advanceBy(10000);
        assert.equal(reloads, 1);
      }

      // 3b. registration.waiting still present at 5s, clears at 6400ms without statechange -> reloads on 250ms poll
      {
        const clock = createVirtualClock();
        const container = createMockEventTarget();
        const waitingWorker = createMockWaitingWorker();
        const registration = { waiting: waitingWorker };
        let reloads = 0;

        pwaMod.applyServiceWorkerUpdate({
          registration,
          serviceWorkerContainer: container,
          reload: () => {
            reloads += 1;
          },
          setTimeoutFn: clock.setTimeoutFn,
          clearTimeoutFn: clock.clearTimeoutFn,
          setIntervalFn: clock.setIntervalFn,
          clearIntervalFn: clock.clearIntervalFn,
        });

        clock.advanceBy(5000);
        assert.equal(reloads, 0);

        clock.advanceBy(1400);
        assert.equal(clock.now, 6400);
        registration.waiting = null;
        assert.equal(reloads, 0);

        clock.advanceBy(100);
        assert.equal(clock.now, 6500);
        assert.equal(reloads, 1, 'Post-5s 250ms poll must reload promptly when waiting clears without statechange');
        assert.equal(clock.activeTimerCount(), 0);
        assert.equal(container.listenerCount('controllerchange'), 0);
        assert.equal(waitingWorker.listenerCount('statechange'), 0);

        clock.advanceBy(10000);
        assert.equal(reloads, 1);
      }

      // 4. registration.waiting never clears: waits until 10s hard cap, reloads once, cleans up everything
      {
        const clock = createVirtualClock();
        const container = createMockEventTarget();
        const waitingWorker = createMockWaitingWorker();
        const registration = { waiting: waitingWorker };
        let reloads = 0;

        pwaMod.applyServiceWorkerUpdate({
          registration,
          serviceWorkerContainer: container,
          reload: () => {
            reloads += 1;
          },
          setTimeoutFn: clock.setTimeoutFn,
          clearTimeoutFn: clock.clearTimeoutFn,
          setIntervalFn: clock.setIntervalFn,
          clearIntervalFn: clock.clearIntervalFn,
        });

        clock.advanceBy(5000);
        assert.equal(reloads, 0);
        clock.advanceBy(4999);
        assert.equal(clock.now, 9999);
        assert.equal(reloads, 0);

        clock.advanceBy(1);
        assert.equal(clock.now, 10000);
        assert.equal(reloads, 1);
        assert.equal(clock.activeTimerCount(), 0);
        assert.equal(container.listenerCount('controllerchange'), 0);
        assert.equal(waitingWorker.listenerCount('statechange'), 0);

        clock.advanceBy(10000);
        assert.equal(reloads, 1);
      }

      // 4a. waiting clears before 5s while controller === null: does not reload at 5s or on post-5s statechange; reloads once via 250ms poll once controller becomes non-null
      {
        const clock = createVirtualClock();
        const container = createMockEventTarget({ controller: null });
        const waitingWorker = createMockWaitingWorker();
        const registration = { waiting: waitingWorker };
        let reloads = 0;

        pwaMod.applyServiceWorkerUpdate({
          registration,
          serviceWorkerContainer: container,
          reload: () => {
            reloads += 1;
          },
          setTimeoutFn: clock.setTimeoutFn,
          clearTimeoutFn: clock.clearTimeoutFn,
          setIntervalFn: clock.setIntervalFn,
          clearIntervalFn: clock.clearIntervalFn,
        });

        clock.advanceBy(2000);
        registration.waiting = null;
        waitingWorker.dispatch('statechange');
        assert.equal(reloads, 0);

        clock.advanceBy(3000);
        assert.equal(clock.now, 5000);
        assert.equal(reloads, 0, 'Must not reload at 5s while controller is still null even if registration.waiting cleared');
        assert.equal(clock.activeTimerCount(), 2, '10s hard-cap timer and 250ms poll interval must remain active');

        clock.advanceBy(500);
        assert.equal(clock.now, 5500);
        waitingWorker.dispatch('statechange');
        assert.equal(reloads, 0, 'Post-5s statechange must not reload while controller is still null');

        clock.advanceBy(900);
        assert.equal(clock.now, 6400);
        container.controller = { state: 'activated' };
        assert.equal(reloads, 0);

        clock.advanceBy(100);
        assert.equal(clock.now, 6500);
        assert.equal(reloads, 1, 'Post-5s 250ms poll must reload promptly once controller becomes non-null');
        assert.equal(clock.activeTimerCount(), 0);
        assert.equal(container.listenerCount('controllerchange'), 0);
        assert.equal(waitingWorker.listenerCount('statechange'), 0);

        clock.advanceBy(10000);
        assert.equal(reloads, 1, 'Must not trigger a second reload at the 10s hard cap');
      }

      // 4b. waiting clears at 5s while controller === null, then controllerchange fires after 5s: reloads promptly once and cleans up poll & hard-cap timers
      {
        const clock = createVirtualClock();
        const container = createMockEventTarget({ controller: null });
        const waitingWorker = createMockWaitingWorker();
        const registration = { waiting: waitingWorker };
        let reloads = 0;

        pwaMod.applyServiceWorkerUpdate({
          registration,
          serviceWorkerContainer: container,
          reload: () => {
            reloads += 1;
          },
          setTimeoutFn: clock.setTimeoutFn,
          clearTimeoutFn: clock.clearTimeoutFn,
          setIntervalFn: clock.setIntervalFn,
          clearIntervalFn: clock.clearIntervalFn,
        });

        clock.advanceBy(4999);
        registration.waiting = null;
        clock.advanceBy(1);
        assert.equal(clock.now, 5000);
        assert.equal(reloads, 0, 'Must not reload at 5s when waiting cleared with controller === null');
        assert.equal(clock.activeTimerCount(), 2, 'waitPollTimer and hardCapTimer must stay active');

        clock.advanceBy(1200);
        assert.equal(clock.now, 6200);
        assert.equal(reloads, 0);

        container.controller = { state: 'activated' };
        container.dispatch('controllerchange');
        assert.equal(reloads, 1, 'Post-5s controllerchange must reload immediately');
        assert.equal(clock.activeTimerCount(), 0, 'waitPollTimer and hardCapTimer must be cleaned up');
        assert.equal(container.listenerCount('controllerchange'), 0);
        assert.equal(waitingWorker.listenerCount('statechange'), 0);

        clock.advanceBy(10000);
        assert.equal(reloads, 1);
      }

      // 4c. waiting clears while controller remains null through 10s: 10s hard cap reloads once and cleans up all timers and listeners
      {
        const clock = createVirtualClock();
        const container = createMockEventTarget({ controller: null });
        const waitingWorker = createMockWaitingWorker();
        const registration = { waiting: waitingWorker };
        let reloads = 0;

        pwaMod.applyServiceWorkerUpdate({
          registration,
          serviceWorkerContainer: container,
          reload: () => {
            reloads += 1;
          },
          setTimeoutFn: clock.setTimeoutFn,
          clearTimeoutFn: clock.clearTimeoutFn,
          setIntervalFn: clock.setIntervalFn,
          clearIntervalFn: clock.clearIntervalFn,
        });

        clock.advanceBy(2000);
        registration.waiting = null;
        waitingWorker.dispatch('statechange');
        assert.equal(reloads, 0);

        clock.advanceBy(3000);
        assert.equal(clock.now, 5000);
        assert.equal(reloads, 0);
        assert.equal(clock.activeTimerCount(), 2);

        clock.advanceBy(2000);
        waitingWorker.dispatch('statechange');
        assert.equal(reloads, 0);

        clock.advanceBy(2999);
        assert.equal(clock.now, 9999);
        assert.equal(reloads, 0);
        assert.equal(clock.activeTimerCount(), 2);

        clock.advanceBy(1);
        assert.equal(clock.now, 10000);
        assert.equal(reloads, 1, '10s hard cap must reload once when controller stays null');
        assert.equal(clock.activeTimerCount(), 0, 'All timers including waitPollTimer must be cleaned up');
        assert.equal(container.listenerCount('controllerchange'), 0);
        assert.equal(waitingWorker.listenerCount('statechange'), 0);

        clock.advanceBy(10000);
        assert.equal(reloads, 1);
      }

      // 5 & 6. PwaServiceClass idempotency, null waiting no-op, postMessage throw recovery, and explicit cancel
      {
        // Helper no-op when waiting is null + explicit cancel idempotency
        const clock = createVirtualClock();
        const container = createMockEventTarget();
        let reloads = 0;
        let abortCount = 0;

        const noopHandle = pwaMod.applyServiceWorkerUpdate({
          registration: { waiting: null },
          serviceWorkerContainer: container,
          reload: () => {
            reloads += 1;
          },
          setTimeoutFn: clock.setTimeoutFn,
          clearTimeoutFn: clock.clearTimeoutFn,
          setIntervalFn: clock.setIntervalFn,
          clearIntervalFn: clock.clearIntervalFn,
          onAbort: () => {
            abortCount += 1;
          },
        });
        assert.equal(noopHandle.started, false);
        assert.equal(clock.activeTimerCount(), 0);
        assert.equal(container.addCalls, 0);
        assert.equal(reloads, 0);

        const cancelWorker = createMockWaitingWorker();
        const cancelHandle = pwaMod.applyServiceWorkerUpdate({
          registration: { waiting: cancelWorker },
          serviceWorkerContainer: container,
          reload: () => {
            reloads += 1;
          },
          setTimeoutFn: clock.setTimeoutFn,
          clearTimeoutFn: clock.clearTimeoutFn,
          setIntervalFn: clock.setIntervalFn,
          clearIntervalFn: clock.clearIntervalFn,
          onAbort: () => {
            abortCount += 1;
          },
        });
        assert.equal(cancelHandle.started, true);
        cancelHandle.cancel();
        cancelHandle.cancel();
        assert.equal(abortCount, 1);
        assert.equal(clock.activeTimerCount(), 0);
        assert.equal(container.listenerCount('controllerchange'), 0);
        assert.equal(cancelWorker.listenerCount('statechange'), 0);
        clock.advanceBy(15000);
        assert.equal(reloads, 0);

        // PwaServiceClass end-to-end idempotency + null waiting no-op + postMessage failure recovery
        const origWindowDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');
        const origNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
        const origWarn = console.warn;
        const warnCalls = [];

        try {
          // Construct while window is absent so constructor skips browser DOM init()
          if (origWindowDesc) {
            Object.defineProperty(globalThis, 'window', { value: undefined, configurable: true, writable: true });
          }
          const service = new pwaMod.PwaServiceClass();
          const swContainer = createMockEventTarget();
          let instanceReloads = 0;

          Object.defineProperty(globalThis, 'window', {
            value: {
              location: {
                reload: () => {
                  instanceReloads += 1;
                },
              },
            },
            configurable: true,
            writable: true,
          });
          Object.defineProperty(globalThis, 'navigator', {
            value: { serviceWorker: swContainer },
            configurable: true,
            writable: true,
          });
          console.warn = (...args) => {
            warnCalls.push(args);
          };

          // No-op when registration.waiting is null
          service.registration = { waiting: null };
          service.applyUpdate();
          assert.equal(swContainer.addCalls, 0);
          assert.equal(instanceReloads, 0);

          // Recovery when postMessage throws: cleans up listeners/timers and resets applyingUpdate so retry succeeds
          let shouldThrow = true;
          const flakyWorker = createMockWaitingWorker(() => {
            if (shouldThrow) {
              throw new Error('waiting worker terminated');
            }
          });
          service.registration = { waiting: flakyWorker };
          service.applyUpdate();
          assert.equal(warnCalls.length, 1);
          assert.equal(swContainer.listenerCount('controllerchange'), 0);
          assert.equal(flakyWorker.listenerCount('statechange'), 0);
          assert.equal(instanceReloads, 0);

          // Retry now succeeds; duplicate calls remain idempotent before AND after controllerchange reload
          shouldThrow = false;
          const addCallsBeforeRetry = swContainer.addCalls;
          service.applyUpdate();
          service.applyUpdate();
          assert.equal(flakyWorker.messages.length, 2, 'Only one new SKIP_WAITING post after recovery');
          assert.equal(swContainer.addCalls, addCallsBeforeRetry + 1, 'Duplicate applyUpdate must register one listener');
          assert.equal(swContainer.listenerCount('controllerchange'), 1);

          swContainer.dispatch('controllerchange');
          assert.equal(instanceReloads, 1);
          assert.equal(swContainer.listenerCount('controllerchange'), 0);
          assert.equal(flakyWorker.listenerCount('statechange'), 0);

          // Rapid click after reload was already triggered still does not re-post or double-reload
          service.applyUpdate();
          assert.equal(flakyWorker.messages.length, 2);
          assert.equal(instanceReloads, 1);
        } finally {
          console.warn = origWarn;
          if (origWindowDesc) {
            Object.defineProperty(globalThis, 'window', origWindowDesc);
          } else {
            delete globalThis.window;
          }
          if (origNavigatorDesc) {
            Object.defineProperty(globalThis, 'navigator', origNavigatorDesc);
          } else {
            delete globalThis.navigator;
          }
        }
      }
    }

    assert.deepEqual(viteConfigMod.parseAndroidSha256Fingerprints(''), []);
    assert.deepEqual(
      viteConfigMod.parseAndroidSha256Fingerprints('00:'.repeat(31) + '00'),
      []
    );
    assert.deepEqual(viteConfigMod.parseAndroidSha256Fingerprints('ab'.repeat(32)), [
      Array(32).fill('AB').join(':'),
    ]);
    assert.equal(
      typeof viteConfigMod.computeDistAssetsDigest,
      'function',
      'vite.config.ts must export computeDistAssetsDigest'
    );
    const publicAssetsDigestA = viteConfigMod.computeDistAssetsDigest(path.join(projectRoot, 'public/assets'));
    const publicAssetsDigestB = viteConfigMod.computeDistAssetsDigest(path.join(projectRoot, 'public/assets'));
    assert.match(publicAssetsDigestA, /^[0-9a-f]{16}$/, 'computeDistAssetsDigest must emit 16-char SHA-256 hex digest');
    assert.equal(publicAssetsDigestA, publicAssetsDigestB, 'computeDistAssetsDigest must be deterministic');
    assert.equal(
      viteConfigMod.computeDistAssetsDigest(path.join(projectRoot, 'nonexistent-assets-dir-check')),
      'empty'
    );

    const srcSwText = fs.readFileSync(path.join(projectRoot, 'public/sw.js'), 'utf8');
    assert.equal(
      srcSwText.includes('SW_ASSETS_DIGEST') &&
        srcSwText.includes(".endsWith('.capy')") &&
        srcSwText.includes("cache: 'no-cache'"),
      true,
      'public/sw.js must define SW_ASSETS_DIGEST and Network-First cache:no-cache routing for .capy archives'
    );

    const distSwPath = path.join(projectRoot, 'dist/sw.js');
    if (fs.existsSync(distSwPath)) {
      const distSwText = fs.readFileSync(distSwPath, 'utf8');
      assert.equal(
        distSwText.includes(`const SW_BUILD_VERSION = '${versionMod.APP_VERSION}';`),
        true,
        'Built dist/sw.js must stamp SW_BUILD_VERSION with package.json version'
      );
      assert.equal(
        distSwText.includes('__CAPY_SW_VERSION__'),
        false,
        'Built dist/sw.js must not retain unstamped __CAPY_SW_VERSION__ placeholder'
      );
      assert.equal(
        distSwText.includes('__CAPY_SW_ASSETS_DIGEST__'),
        false,
        'Built dist/sw.js must not retain unstamped __CAPY_SW_ASSETS_DIGEST__ placeholder'
      );
      assert.match(
        distSwText,
        /const SW_ASSETS_DIGEST = '[0-9a-f]{16}';/,
        'Built dist/sw.js must stamp SW_ASSETS_DIGEST with a 16-char SHA-256 hex digest'
      );
      assert.equal(
        distSwText.includes(".endsWith('.apk')"),
        true,
        'Service Worker must bypass .apk binary downloads'
      );
      assert.equal(
        distSwText.includes(".endsWith('.capy')") && distSwText.includes("cache: 'no-cache'"),
        true,
        'Built dist/sw.js must use Network-First cache:no-cache routing for .capy archives'
      );
    }
    // Anonymous In-Game Feedback protocol (worker/feedbackProtocol.ts) & client service (FeedbackService.ts)
    {
      const feedbackProtoMod = await vite.ssrLoadModule(
        path.resolve(projectRoot, '../worker/feedbackProtocol.ts')
      );
      const feedbackSvcMod = await vite.ssrLoadModule('/src/services/FeedbackService.ts');

      // Valid payload + @mention neutralization + triple-backtick sanitization + label mapping
      const validResult = feedbackProtoMod.validateFeedbackPayload(
        JSON.stringify({
          category: 'puzzle_idea',
          title: '  Capybara\u0007 in Space @admin  ',
          details: 'Please add a cozy astronaut capybara!\n```js\nalert(1)\n```\ncc @everyone',
          website: '',
          context: {
            appVersion: 'v3.0.45',
            channel: 'beta',
            platform: 'Web',
            viewport: '390x844',
          },
        })
      );
      assert.equal(validResult.ok, true, 'Valid feedback payload must pass validation');
      assert.equal(validResult.payload.category, 'puzzle_idea');
      assert.equal(validResult.payload.title.includes('@admin'), false, 'Title must not contain raw @admin mention');
      assert.equal(
        validResult.payload.title.includes('@\u200Badmin'),
        true,
        'Title must neutralize @mentions with zero-width space'
      );
      assert.equal(validResult.payload.details.includes('```'), false, 'Details must sanitize triple backticks');
      assert.equal(
        validResult.payload.details.includes('@everyone'),
        false,
        'Details must not contain raw @everyone mention'
      );
      assert.equal(
        validResult.payload.details.includes('@\u200Beveryone'),
        true,
        'Details must neutralize @mentions with zero-width space'
      );

      // Adversarial @mention bypasses + email preservation
      for (const adversarialMention of [
        '**@shthed**',
        '>@shthed',
        '"@shthed"',
        '[@shthed]',
        ',@shthed',
        ':@shthed',
        '/@shthed',
        '`@shthed',
      ]) {
        const sanitized = feedbackProtoMod.sanitizeFeedbackText(adversarialMention, true);
        assert.equal(
          sanitized.includes('@shthed'),
          false,
          `Adversarial mention ${adversarialMention} must be neutralized (got ${sanitized})`
        );
        assert.equal(
          sanitized.includes('@\u200Bshthed'),
          true,
          `Adversarial mention ${adversarialMention} must insert zero-width space (got ${sanitized})`
        );
      }
      assert.equal(
        feedbackProtoMod.sanitizeFeedbackText('Contact a@b.com or foo.bar@example.com for help', true),
        'Contact a@b.com or foo.bar@example.com for help',
        'Email addresses must be preserved untouched'
      );

      // resolveFeedbackRepo path traversal protection
      for (const badRepo of ['../..', '../evil', 'evil/..', './.', 'foo/.', './bar', '-bad/repo', 'a/b/c']) {
        assert.equal(
          feedbackProtoMod.resolveFeedbackRepo(badRepo),
          'capyboop/paint',
          `Invalid/traversal repo "${badRepo}" must fall back to capyboop/paint`
        );
      }
      assert.equal(feedbackProtoMod.resolveFeedbackRepo('capyboop/paint'), 'capyboop/paint');
      assert.equal(feedbackProtoMod.resolveFeedbackRepo('shthed/capy'), 'shthed/capy');

      const issuePayload = feedbackProtoMod.buildGitHubIssuePayload(validResult.payload);
      assert.equal(issuePayload.title.startsWith('[Puzzle Idea]: '), true);
      assert.deepEqual(issuePayload.labels, ['enhancement']);
      assert.equal(issuePayload.body.includes('Anonymous in-game feedback'), true);
      assert.equal(issuePayload.body.includes('v3.0.45'), true);

      // Category label mapping for bug, feature, general
      for (const [cat, expectedPrefix, expectedLabels] of [
        ['bug', '[Bug]: ', ['bug']],
        ['feature', '[Feature]: ', ['enhancement']],
        ['general', '[Feedback]: ', ['question']],
      ]) {
        const res = feedbackProtoMod.validateFeedbackPayload(
          JSON.stringify({
            category: cat,
            title: 'Sample headline',
            details: 'Detailed description of more than ten characters.',
          })
        );
        assert.equal(res.ok, true, `Category ${cat} must validate`);
        const built = feedbackProtoMod.buildGitHubIssuePayload(res.payload);
        assert.equal(built.title.startsWith(expectedPrefix), true);
        assert.deepEqual(built.labels, expectedLabels);
      }

      // Honeypot detection
      const honey = feedbackProtoMod.validateFeedbackPayload(
        JSON.stringify({
          category: 'bug',
          title: 'Bot title',
          details: 'Bot spam message content here.',
          website: 'https://spam.example',
        })
      );
      assert.equal(honey.ok, false);
      assert.equal(honey.honeypot, true, 'Non-empty website field must trigger honeypot');

      // Invalid payloads: malformed JSON, invalid category, short title, short details, > 8192 bytes
      assert.equal(feedbackProtoMod.validateFeedbackPayload('{bad-json').ok, false);
      assert.equal(
        feedbackProtoMod.validateFeedbackPayload(
          JSON.stringify({ category: 'unknown', title: 'Valid title', details: 'Long enough details.' })
        ).ok,
        false
      );
      assert.equal(
        feedbackProtoMod.validateFeedbackPayload(
          JSON.stringify({ category: 'bug', title: 'Hi', details: 'Long enough details.' })
        ).ok,
        false
      );
      assert.equal(
        feedbackProtoMod.validateFeedbackPayload(
          JSON.stringify({ category: 'bug', title: 'Valid title', details: 'short' })
        ).ok,
        false
      );
      const oversized = feedbackProtoMod.validateFeedbackPayload(
        JSON.stringify({
          category: 'bug',
          title: 'Oversized payload test',
          details: 'A'.repeat(9000),
        })
      );
      assert.equal(oversized.ok, false);
      assert.equal(oversized.status, 413, 'Payload > 8192 bytes must return status 413');

      // Streaming readBodyTextWithLimit: exact cap, early cancel, split UTF-8, null body, subarray, edge limits
      {
        const makeChunkedStream = (chunks) => {
          let index = 0;
          let pulls = 0;
          let cancelled = false;
          let cancelReason = null;
          const stream = new ReadableStream(
            {
              pull(controller) {
                pulls++;
                if (index < chunks.length) {
                  controller.enqueue(chunks[index++]);
                } else {
                  controller.close();
                }
              },
              cancel(reason) {
                cancelled = true;
                cancelReason = reason;
              },
            },
            { highWaterMark: 0 }
          );
          return {
            stream,
            getPulls: () => pulls,
            wasCancelled: () => cancelled,
            getCancelReason: () => cancelReason,
          };
        };

        // 1. Exact 8192-byte chunked stream without Content-Length succeeds
        const exactChunks = [
          new Uint8Array(2048).fill(0x61), // 'a'
          new Uint8Array(0), // empty chunk skipped cleanly
          new Uint8Array(4096).fill(0x62), // 'b'
          new Uint8Array(2048).fill(0x63), // 'c'
        ];
        const exactStream = makeChunkedStream(exactChunks);
        const exactReq = new Request('https://capypaint.com/api/feedback', {
          method: 'POST',
          body: exactStream.stream,
          duplex: 'half',
        });
        assert.equal(exactReq.headers.get('Content-Length'), null);
        const exactRes = await feedbackProtoMod.readBodyTextWithLimit(exactReq);
        assert.equal(exactRes.ok, true, 'Exact 8192-byte chunked stream must succeed');
        assert.equal(exactRes.text.length, feedbackProtoMod.MAX_FEEDBACK_BODY_BYTES);
        assert.equal(exactRes.text, `${'a'.repeat(2048)}${'b'.repeat(4096)}${'c'.repeat(2048)}`);
        assert.equal(exactStream.wasCancelled(), false);

        // 2. 8193-byte multi-chunk stream without Content-Length returns 413, cancels, and stops pulling early
        const overChunks = [
          new Uint8Array(2048).fill(0x78),
          new Uint8Array(2048).fill(0x78),
          new Uint8Array(2048).fill(0x78),
          new Uint8Array(2048).fill(0x78),
          new Uint8Array([0x79]), // byte 8193 triggers abort
          new Uint8Array(2048).fill(0x7a), // trailing chunk 1 (must not be pulled)
          new Uint8Array(2048).fill(0x7a), // trailing chunk 2 (must not be pulled)
          new Uint8Array(2048).fill(0x7a), // trailing chunk 3 (must not be pulled)
        ];
        const overStream = makeChunkedStream(overChunks);
        const overReq = new Request('https://capypaint.com/api/feedback', {
          method: 'POST',
          body: overStream.stream,
          duplex: 'half',
        });
        assert.equal(overReq.headers.get('Content-Length'), null);
        const overRes = await feedbackProtoMod.readBodyTextWithLimit(overReq);
        assert.equal(overRes.ok, false, '8193-byte chunked stream must fail');
        assert.equal(overRes.status, 413);
        assert.equal(overStream.wasCancelled(), true, 'Oversized stream must trigger cancel()');
        assert.equal(
          overStream.getPulls() <= 5,
          true,
          `Oversized stream must stop pulling early (got ${overStream.getPulls()} pulls out of ${overChunks.length})`
        );

        // 3. Multi-byte UTF-8 characters split across chunks decode losslessly and count wire bytes (not UTF-16 .length)
        const splitUtf8Stream = makeChunkedStream([
          new Uint8Array([0x48, 0x69, 0x20, 0xf0, 0x9f]), // "Hi " + first 2 bytes of U+1F600
          new Uint8Array([0x98, 0x80, 0x20, 0xe6]), // last 2 bytes of U+1F600 + " " + first byte of U+6F22
          new Uint8Array([0xbc, 0xa2, 0x21]), // last 2 bytes of U+6F22 + "!"
        ]);
        const splitUtf8Res = await feedbackProtoMod.readBodyTextWithLimit(
          { body: splitUtf8Stream.stream },
          12
        );
        assert.equal(splitUtf8Res.ok, true, 'Split UTF-8 stream within 12-byte limit must succeed');
        assert.equal(splitUtf8Res.text, 'Hi \u{1F600} \u6F22!');
        assert.equal(
          splitUtf8Res.text.includes('\uFFFD'),
          false,
          'Split UTF-8 stream must not emit replacement characters'
        );

        // Payload whose UTF-16 .length (3) <= limit (8), but UTF-8 wire byte length (9) > limit (8) -> 413
        const cjkThreeChars = '\u6F22\u6F22\u6F22';
        assert.equal(cjkThreeChars.length, 3);
        const cjkWireBytes = new TextEncoder().encode(cjkThreeChars);
        assert.equal(cjkWireBytes.byteLength, 9);
        const cjkOverStream = makeChunkedStream([
          cjkWireBytes.subarray(0, 4),
          cjkWireBytes.subarray(4, 9),
          new Uint8Array([0x21]),
        ]);
        const cjkOverRes = await feedbackProtoMod.readBodyTextWithLimit(
          { body: cjkOverStream.stream },
          8
        );
        assert.equal(cjkOverRes.ok, false, 'UTF-8 wire bytes > limit must fail even when UTF-16 .length <= limit');
        assert.equal(cjkOverRes.status, 413);
        assert.equal(cjkOverStream.wasCancelled(), true);

        // 4. body: null returns { ok: true, text: '' }
        const nullBodyRes = await feedbackProtoMod.readBodyTextWithLimit({ body: null });
        assert.deepEqual(nullBodyRes, { ok: true, text: '' });

        // 5. Subarray Uint8Array over a larger ArrayBuffer counts value.byteLength, not value.buffer.byteLength
        const backingBuffer = new ArrayBuffer(65536);
        const backingView = new Uint8Array(backingBuffer);
        backingView.set(new TextEncoder().encode('hello'), 1024);
        const sliceView = backingView.subarray(1024, 1029);
        assert.equal(sliceView.byteLength, 5);
        assert.equal(sliceView.buffer.byteLength, 65536);
        const subarrayStream = makeChunkedStream([sliceView]);
        const subarrayRes = await feedbackProtoMod.readBodyTextWithLimit(
          { body: subarrayStream.stream },
          8
        );
        assert.deepEqual(subarrayRes, { ok: true, text: 'hello' });

        // 6. Edge limits: maxBytes = 0 accepts empty stream and rejects 1 byte; non-finite falls back to MAX_FEEDBACK_BODY_BYTES
        const emptyZeroRes = await feedbackProtoMod.readBodyTextWithLimit(
          { body: makeChunkedStream([new Uint8Array(0)]).stream },
          0
        );
        assert.deepEqual(emptyZeroRes, { ok: true, text: '' });

        const oneByteZeroStream = makeChunkedStream([new Uint8Array([0x41])]);
        const oneByteZeroRes = await feedbackProtoMod.readBodyTextWithLimit(
          { body: oneByteZeroStream.stream },
          0
        );
        assert.equal(oneByteZeroRes.ok, false);
        assert.equal(oneByteZeroRes.status, 413);
        assert.equal(oneByteZeroStream.wasCancelled(), true);

        const nanLimitOk = await feedbackProtoMod.readBodyTextWithLimit(
          { body: makeChunkedStream([new Uint8Array(feedbackProtoMod.MAX_FEEDBACK_BODY_BYTES).fill(0x61)]).stream },
          Number.NaN
        );
        assert.equal(nanLimitOk.ok, true, 'NaN maxBytes must fall back to MAX_FEEDBACK_BODY_BYTES');
        assert.equal(nanLimitOk.text.length, feedbackProtoMod.MAX_FEEDBACK_BODY_BYTES);

        const infLimitOver = await feedbackProtoMod.readBodyTextWithLimit(
          { body: makeChunkedStream([new Uint8Array(feedbackProtoMod.MAX_FEEDBACK_BODY_BYTES + 1).fill(0x61)]).stream },
          Number.POSITIVE_INFINITY
        );
        assert.equal(infLimitOver.ok, false, 'Infinity maxBytes must fall back to MAX_FEEDBACK_BODY_BYTES');
        assert.equal(infLimitOver.status, 413);
      }

      // CORS allow/deny including paint.capyboop.com and path-suffixed origin rejection
      const capyCors = feedbackProtoMod.buildFeedbackCorsHeaders('https://capypaint.com', undefined, false);
      assert.equal(capyCors['Access-Control-Allow-Origin'], 'https://capypaint.com');
      const paintBoopCors = feedbackProtoMod.buildFeedbackCorsHeaders(
        'https://paint.capyboop.com',
        undefined,
        false
      );
      assert.equal(paintBoopCors['Access-Control-Allow-Origin'], 'https://paint.capyboop.com');
      const androidCors = feedbackProtoMod.buildFeedbackCorsHeaders(
        'https://appassets.androidplatform.net',
        undefined,
        false
      );
      assert.equal(androidCors['Access-Control-Allow-Origin'], 'https://appassets.androidplatform.net');
      const evilCors = feedbackProtoMod.buildFeedbackCorsHeaders('https://evil.example', undefined, false);
      assert.equal(evilCors['Access-Control-Allow-Origin'], undefined, 'Disallowed origin must not receive ACAO');
      const pathSuffixedCors = feedbackProtoMod.buildFeedbackCorsHeaders(
        'https://capypaint.com/evil',
        undefined,
        false
      );
      assert.equal(
        pathSuffixedCors['Access-Control-Allow-Origin'],
        undefined,
        'Path-suffixed origin must not receive ACAO'
      );

      // Worker buildFallbackIssueUrl hard <= 4000 char encoded URL cap for CJK & emoji
      const workerCjkFallback = feedbackProtoMod.buildFallbackIssueUrl({
        category: 'bug',
        title: '漢'.repeat(120),
        details: '漢'.repeat(1200),
        context: { appVersion: 'v3.0.45', channel: 'beta', platform: 'Web' },
      });
      assert.equal(
        workerCjkFallback.length <= 4000,
        true,
        `Worker CJK fallback URL must be <= 4000 chars (got ${workerCjkFallback.length})`
      );
      assert.equal(workerCjkFallback.startsWith('https://github.com/capyboop/paint/issues/new?'), true);

      const workerEmojiFallback = feedbackProtoMod.buildFallbackIssueUrl({
        category: 'feature',
        title: '😀'.repeat(60),
        details: '😀'.repeat(600),
        context: { appVersion: 'v3.0.45', channel: 'beta', platform: 'Web' },
      });
      assert.equal(
        workerEmojiFallback.length <= 4000,
        true,
        `Worker emoji fallback URL must be <= 4000 chars (got ${workerEmojiFallback.length})`
      );
      assert.equal(workerEmojiFallback.startsWith('https://github.com/capyboop/paint/issues/new?'), true);

      // FeedbackService URL resolution & fallback URL
      assert.equal(
        feedbackSvcMod.resolveFeedbackApiUrl(undefined, { hostname: 'capypaint.com' }),
        '/api/feedback'
      );
      assert.equal(
        feedbackSvcMod.resolveFeedbackApiUrl(undefined, { hostname: 'paint.capyboop.com' }),
        '/api/feedback'
      );
      assert.equal(
        feedbackSvcMod.resolveFeedbackApiUrl(undefined, { hostname: 'beta.capypaint.com' }),
        '/api/feedback'
      );
      assert.equal(
        feedbackSvcMod.resolveFeedbackApiUrl(undefined, { hostname: 'www.capypaint.com' }),
        'https://capypaint.com/api/feedback'
      );
      assert.equal(
        feedbackSvcMod.resolveFeedbackApiUrl(undefined, { hostname: 'localhost' }),
        '/api/feedback'
      );
      assert.equal(
        feedbackSvcMod.resolveFeedbackApiUrl(undefined, { hostname: 'appassets.androidplatform.net' }),
        'https://capypaint.com/api/feedback'
      );
      assert.equal(
        feedbackSvcMod.resolveFeedbackApiUrl(undefined, { hostname: 'capyboop.github.io' }),
        'https://capypaint.com/api/feedback'
      );
      assert.equal(
        feedbackSvcMod.resolveFeedbackApiUrl('https://custom.example/api/feedback', { hostname: 'localhost' }),
        'https://custom.example/api/feedback'
      );

      const fallbackUrl = feedbackSvcMod.buildGitHubIssueFallbackUrl(
        { category: 'bug', title: 'Zoom stutter', details: 'Pinch zoom stutters on tablet.' },
        { appVersion: 'v3.0.45', channel: 'beta', platform: 'Web' }
      );
      assert.equal(fallbackUrl.startsWith('https://github.com/capyboop/paint/issues/new?'), true);
      assert.equal(fallbackUrl.includes('template=bug_report.yml'), true);
      assert.equal(fallbackUrl.includes('Zoom+stutter'), true);

      // Client buildGitHubIssueFallbackUrl hard <= 4000 char encoded URL cap for CJK & emoji
      const clientCjkFallback = feedbackSvcMod.buildGitHubIssueFallbackUrl(
        { category: 'bug', title: '漢'.repeat(120), details: '漢'.repeat(1200) },
        { appVersion: 'v3.0.45', channel: 'beta', platform: 'Web' }
      );
      assert.equal(
        clientCjkFallback.length <= 4000,
        true,
        `Client CJK fallback URL must be <= 4000 chars (got ${clientCjkFallback.length})`
      );
      const clientEmojiFallback = feedbackSvcMod.buildGitHubIssueFallbackUrl(
        { category: 'feature', title: '😀'.repeat(60), details: '😀'.repeat(600) },
        { appVersion: 'v3.0.45', channel: 'beta', platform: 'Web' }
      );
      assert.equal(
        clientEmojiFallback.length <= 4000,
        true,
        `Client emoji fallback URL must be <= 4000 chars (got ${clientEmojiFallback.length})`
      );

      // Prototype-key category lookup falls back safely to 'general' ([Feedback])
      for (const protoCat of ['toString', 'constructor', '__proto__']) {
        const protoFallback = feedbackSvcMod.buildGitHubIssueFallbackUrl({
          category: protoCat,
          title: 'Proto test',
          details: 'Prototype lookup should safely fall back to general.',
        });
        const parsedProto = new URL(protoFallback);
        assert.equal(
          parsedProto.searchParams.get('title'),
          '[Feedback]: Proto test',
          `Prototype category "${protoCat}" must fall back to general [Feedback] prefix`
        );
      }
    }

    logUnitPass('ShareLinkService, HybridCoopRoomAdapter, Cloudflare Worker relay & PwaService verified.');
}
