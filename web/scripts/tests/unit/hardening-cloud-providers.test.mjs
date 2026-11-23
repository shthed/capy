/**
 * Release Safety & Hardening — Cloud Sync Providers, Play Games Chunking, NativeBridge Listeners & Coordinator.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '../../..');
const REPO_ROOT = path.resolve(WEB_ROOT, '..');

export async function runHardeningCloudProvidersTests(vite) {
  // 5. GoogleCloudSyncClient, CloudProviderDrivers & ProviderRegistry hardening
  {
    const prevWin = globalThis.window;
    const prevLs = globalThis.localStorage;
    const prevFetch = globalThis.fetch;

    const store = new Map();
    const mockStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    globalThis.localStorage = mockStorage;
    globalThis.window = {
      location: { pathname: '/', origin: 'https://capypaint.com', hostname: 'capypaint.com', search: '' },
      localStorage: mockStorage,
      __capyMockGoogleOAuthToken: 'mock-secret-token',
    };

    try {
      const gClient = await vite.ssrLoadModule('/src/services/providers/GoogleCloudSyncClient.ts');
      const driversMod = await vite.ssrLoadModule('/src/services/providers/CloudProviderDrivers.ts');
      const regMod = await vite.ssrLoadModule('/src/services/providers/ProviderRegistry.ts');

      assert.equal(
        gClient.isGoogleMockTokenEnvironmentAllowed('', null, false),
        false,
        'Mock Google OAuth token must be disabled in production without debug opt-in'
      );
      assert.equal(
        gClient.isGoogleMockTokenEnvironmentAllowed('?capy_debug=1', null, false),
        true
      );
      assert.equal(gClient.isGoogleMockTokenEnvironmentAllowed('', '1', false), true);

      // Avatar URL sanitization in ID token decoding
      const mkJwt = (payload) => {
        const hdr = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
        const body = Buffer.from(
          JSON.stringify({
            iss: 'https://accounts.google.com',
            exp: Math.floor(Date.now() / 1000) + 3600,
            ...payload,
          })
        ).toString('base64url');
        return `${hdr}.${body}.sig`;
      };
      const badPicProfile = gClient.decodeGoogleIdTokenPayload(
        mkJwt({ sub: 'u1', name: 'Bad\nPic', picture: 'javascript:alert(1)' })
      );
      assert.equal(badPicProfile?.displayName, 'BadPic');
      assert.equal(badPicProfile?.picture, undefined, 'Non-HTTPS avatar picture URL must be stripped');

      const goodPicProfile = gClient.decodeGoogleIdTokenPayload(
        mkJwt({ sub: 'u2', name: 'Good', picture: 'https://lh3.googleusercontent.com/a/123' })
      );
      assert.equal(goodPicProfile?.picture, 'https://lh3.googleusercontent.com/a/123');

      // Expired Google OAuth token cleanup + 401 cache invalidation
      store.set(
        'capy_google_oauth_token_v1',
        JSON.stringify({
          accessToken: 'expired-tok',
          expiresAt: Date.now() - 10_000,
          sub: 's1',
          displayName: 'Old',
        })
      );
      assert.equal(gClient.loadCachedGoogleSession(), null);
      assert.equal(store.has('capy_google_oauth_token_v1'), false, 'Expired OAuth token must be cleared');

      store.set(
        'capy_google_oauth_token_v1',
        JSON.stringify({
          accessToken: 'revoked-tok',
          expiresAt: Date.now() + 600_000,
          sub: 's2',
          displayName: 'Active',
        })
      );
      globalThis.fetch = async () => new Response('Unauthorized', { status: 401 });
      await assert.rejects(
        () => gClient.GoogleDriveAppDataClient.downloadJsonFile('revoked-tok', 'file_123'),
        /\(401\)/
      );
      assert.equal(
        store.has('capy_google_oauth_token_v1'),
        false,
        'HTTP 401 from Drive API must clear cached Google OAuth session'
      );

      await assert.rejects(
        () => gClient.GoogleDriveAppDataClient.downloadJsonFile('tok', '../etc/passwd'),
        /Invalid Google Drive file ID/
      );

      // GoogleCloudDriver rejects traversal blobRef
      store.set(
        'capy_google_oauth_token_v1',
        JSON.stringify({
          accessToken: 'ok-tok',
          expiresAt: Date.now() + 600_000,
          sub: 's3',
          displayName: 'Ok',
        })
      );
      const gDriver = new driversMod.GoogleCloudDriver();
      assert.equal(await gDriver.readBinaryBlob('../secret'), null);

      // Co-op WS URL validation
      assert.equal(
        regMod.resolveCoopRoomWsUrl('javascript:alert(1)', { hostname: 'capypaint.com' }),
        null
      );
      assert.equal(
        regMod.resolveCoopRoomWsUrl('ws://evil.example/room', { hostname: 'capypaint.com' }),
        null
      );
      assert.equal(
        regMod.resolveCoopRoomWsUrl('ws://localhost:8787/api/room', { hostname: 'localhost' }),
        'ws://localhost:8787/api/room'
      );
      assert.equal(
        regMod.resolveCoopRoomWsUrl('wss://custom-relay.example/ws', { hostname: 'capypaint.com' }),
        'wss://custom-relay.example/ws'
      );

      // HybridCoopRoomAdapter drops spoofed PAINT_EVENT even over BroadcastChannel
      const adapter = new regMod.HybridCoopRoomAdapter();
      await adapter.joinRoom('ROOM99', {
        playerId: 'self_p1',
        displayName: 'Self',
        avatarColorHex: '#38bdf8',
        lastActiveAt: Date.now(),
      });
      const receivedPaints = [];
      adapter.onPaintEvent((ev) => receivedPaints.push(ev));
      // Spoofed playerId inside paintEvent
      adapter.handleWireMessage(
        {
          type: 'PAINT_EVENT',
          roomCode: 'ROOM99',
          sender: {
            playerId: 'peer_p2',
            displayName: 'Peer',
            avatarColorHex: '#f59e0b',
            lastActiveAt: Date.now(),
          },
          paintEvent: {
            eventId: 'bad_ev',
            roomCode: 'ROOM99',
            playerId: 'self_p1',
            displayName: 'Peer',
            avatarColorHex: '#f59e0b',
            action: 'FILL',
            regionIds: [1],
            timestamp: Date.now(),
          },
          sentAt: Date.now(),
        },
        'channel'
      );
      assert.equal(receivedPaints.length, 0, 'Spoofed paintEvent.playerId must be dropped');

      // Valid paintEvent passes through
      adapter.handleWireMessage(
        {
          type: 'PAINT_EVENT',
          roomCode: 'ROOM99',
          sender: {
            playerId: 'peer_p2',
            displayName: 'Peer',
            avatarColorHex: '#f59e0b',
            lastActiveAt: Date.now(),
          },
          paintEvent: {
            eventId: 'good_ev',
            roomCode: 'ROOM99',
            playerId: 'peer_p2',
            displayName: 'Peer',
            avatarColorHex: '#f59e0b',
            action: 'FILL',
            regionIds: [7],
            timestamp: Date.now(),
          },
          sentAt: Date.now(),
        },
        'channel'
      );
      assert.equal(receivedPaints.length, 1);

      // Non-string senderId / playerId over BroadcastChannel must be dropped safely without throwing
      adapter.handleWireMessage(
        {
          type: 'PAINT_EVENT',
          roomCode: 'ROOM99',
          sender: {
            playerId: 'peer_p2',
            displayName: 'Peer',
            avatarColorHex: '#f59e0b',
            lastActiveAt: Date.now(),
          },
          paintEvent: {
            eventId: 'bad_nonstring_pid',
            roomCode: 'ROOM99',
            playerId: 12345,
            regionIds: [7],
          },
          sentAt: Date.now(),
        },
        'channel'
      );
      const receivedUnfills = [];
      adapter.onUnfillEvent((ev) => receivedUnfills.push(ev));
      adapter.handleWireMessage(
        {
          type: 'UNFILL_EVENT',
          roomCode: 'ROOM99',
          sender: {
            playerId: 'peer_p2',
            displayName: 'Peer',
            avatarColorHex: '#f59e0b',
            lastActiveAt: Date.now(),
          },
          unfillEvent: {
            eventId: 'bad_nonstring_uid',
            roomCode: 'ROOM99',
            senderId: 999,
            regionIds: [7],
          },
          sentAt: Date.now(),
        },
        'channel'
      );
      assert.equal(receivedPaints.length, 1);
      assert.equal(receivedUnfills.length, 0);
      adapter.leaveRoom();

      // Terminal WS close (1008/1009/4000..4999) locks reconnect even across online/visibilitychange events
      const prevWs = globalThis.WebSocket;
      const prevDoc = globalThis.document;
      const winListeners = new Map();
      const docListeners = new Map();
      let wsCreatedCount = 0;
      let latestSocket = null;
      class MockTerminalWs {
        static OPEN = 1;
        static CLOSED = 3;
        constructor(url) {
          this.url = url;
          this.readyState = 1;
          wsCreatedCount++;
          latestSocket = this;
        }
        send() {}
        close(code = 1000) {
          this.readyState = 3;
          this.onclose?.({ code });
        }
      }
      globalThis.WebSocket = MockTerminalWs;
      globalThis.window.addEventListener = (type, fn) => {
        if (!winListeners.has(type)) winListeners.set(type, new Set());
        winListeners.get(type).add(fn);
      };
      globalThis.window.removeEventListener = (type, fn) => {
        winListeners.get(type)?.delete(fn);
      };
      globalThis.document = {
        visibilityState: 'visible',
        addEventListener: (type, fn) => {
          if (!docListeners.has(type)) docListeners.set(type, new Set());
          docListeners.get(type).add(fn);
        },
        removeEventListener: (type, fn) => {
          docListeners.get(type)?.delete(fn);
        },
      };
      try {
        const wsAdapter = new regMod.HybridCoopRoomAdapter();
        await wsAdapter.joinRoom('TERM99', {
          playerId: 'self_ws',
          displayName: 'SelfWS',
          avatarColorHex: '#38bdf8',
          lastActiveAt: Date.now(),
        });
        assert.equal(wsCreatedCount, 1);
        latestSocket.readyState = 3;
        latestSocket.onclose?.({ code: 1008 });
        for (const fn of winListeners.get('online') ?? []) fn();
        for (const fn of docListeners.get('visibilitychange') ?? []) fn();
        assert.equal(
          wsCreatedCount,
          1,
          'Terminal WS close (1008) must detach listeners and lock reconnect permanently'
        );
        assert.equal((winListeners.get('online')?.size ?? 0), 0);
        assert.equal((docListeners.get('visibilitychange')?.size ?? 0), 0);
        wsAdapter.leaveRoom();
      } finally {
        globalThis.WebSocket = prevWs;
        if (prevDoc === undefined) delete globalThis.document;
        else globalThis.document = prevDoc;
      }

      // PlayGamesAndroidDriver.readBinaryBlob fast-fails on synchronous error even with another active listener
      const nbMod2 = await vite.ssrLoadModule('/src/services/NativeBridge.ts');
      const prevCapyAnd = globalThis.window.CapyAndroid;
      globalThis.window.CapyAndroid = {
        loadCloudBinaryChunk: () => null,
        requestCloudSnapshotPull: (slot) => {
          globalThis.window.__capyReceiveCloudSnapshotError?.(slot, 'SYNC_PULL_ERR');
          return true;
        },
        isPlayGamesConfigured: () => true,
      };
      nbMod2.NativeBridge.attachWindowCallbacks();
      const decoyUnsub = nbMod2.NativeBridge.onCloudSnapshotError(() => {});
      try {
        const pgDriver2 = new driversMod.PlayGamesAndroidDriver();
        const t0 = Date.now();
        const blobRes = await pgDriver2.readBinaryBlob('pgblob:pgblob_sync_err:1:16');
        const elapsed = Date.now() - t0;
        assert.equal(blobRes, null);
        assert.equal(
          elapsed < 400,
          true,
          `readBinaryBlob must settle immediately on synchronous error (${elapsed}ms)`
        );

        // MultiProviderAuthManager retains its PlayGamesProfile listener after PlayGamesAndroidDriver.signIn() cleans up
        globalThis.window.CapyAndroid = {
          isPlayGamesConfigured: () => true,
          signInPlayGames: () => {
            setTimeout(() => {
              globalThis.window.__capyReceivePlayGamesProfile?.(
                JSON.stringify({ playerId: 'pgs_first', displayName: 'First Capy' })
              );
            }, 10);
            return null;
          },
        };
        const gClientMod = await vite.ssrLoadModule('/src/services/providers/GoogleCloudSyncClient.ts');
        const seenAuthIds = [];
        const unsubAuth = regMod.ProviderRegistry.auth.subscribe((id) =>
          seenAuthIds.push(id.playerId)
        );
        try {
          const signedIn = await regMod.ProviderRegistry.auth.signInWithPlayGames();
          assert.equal(signedIn.playerId, 'pgs_first');
          globalThis.window.__capyReceivePlayGamesProfile?.(
            JSON.stringify({ playerId: 'pgs_second', displayName: 'Second Capy' })
          );
          assert.equal(
            regMod.ProviderRegistry.auth.getCurrentIdentity().playerId,
            'pgs_second',
            'MultiProviderAuthManager Play Games listener must survive PlayGamesAndroidDriver.signIn cleanup'
          );
          assert.equal(seenAuthIds.includes('pgs_first'), true);
          assert.equal(seenAuthIds.at(-1), 'pgs_second');
        } finally {
          unsubAuth();
          await regMod.ProviderRegistry.auth.signOut();
          gClientMod.setExplicitlySignedOut(false);
        }
      } finally {
        decoyUnsub();
        globalThis.window.CapyAndroid = prevCapyAnd;
      }

      // PlayGamesAndroidDriver signIn/attemptAutoSignIn listener registration before signInPlayGames() & sync drain zero-leak checks
      {
        const gClientMod = await vite.ssrLoadModule('/src/services/providers/GoogleCloudSyncClient.ts');
        const nb = nbMod2.NativeBridge;
        const baseProfileCount = nb.playGamesProfileHandlers.size;
        assert.equal(nb.playGamesErrorHandlers.size, 0);
        assert.equal(nb.cloudSnapshotHandlers.size, 0);
        assert.equal(nb.cloudSnapshotErrorHandlers.size, 0);

        const syncDriver = new driversMod.PlayGamesAndroidDriver();

        // 1) Synchronous __capyReceivePlayGamesProfile inside signInPlayGames() with active MultiProviderAuthManager listener
        globalThis.window.CapyAndroid = {
          isPlayGamesConfigured: () => true,
          signInPlayGames: () => {
            globalThis.window.__capyReceivePlayGamesProfile?.(
              JSON.stringify({ playerId: 'pgs_sync_ret', displayName: 'SyncRet' })
            );
            return null;
          },
        };
        const tSignSync = Date.now();
        const signedSync = await syncDriver.signIn();
        assert.equal(signedSync.playerId, 'pgs_sync_ret');
        assert.equal(Date.now() - tSignSync < 200, true, 'signIn must resolve synchronous profile <200ms');
        assert.equal(nb.playGamesProfileHandlers.size, baseProfileCount);
        assert.equal(nb.playGamesErrorHandlers.size, 0);

        // Also test attemptAutoSignIn with ?coop=1 enabled
        globalThis.window.location.search = '?coop=1';
        try {
          const autoSyncDriver = new driversMod.PlayGamesAndroidDriver();
          const tAutoSync = Date.now();
          const autoRes = await autoSyncDriver.attemptAutoSignIn();
          assert.equal(autoRes?.playerId, 'pgs_sync_ret');
          assert.equal(Date.now() - tAutoSync < 200, true, 'attemptAutoSignIn must resolve sync profile <200ms');
          assert.equal(nb.playGamesProfileHandlers.size, baseProfileCount);
          assert.equal(nb.playGamesErrorHandlers.size, 0);
        } finally {
          globalThis.window.location.search = '';
        }

        // 2) Synchronous __capyReceivePlayGamesError inside signInPlayGames() with concurrent error listener
        const extErrUnsub = nb.onPlayGamesError(() => {});
        try {
          globalThis.window.CapyAndroid = {
            isPlayGamesConfigured: () => true,
            signInPlayGames: () => {
              globalThis.window.__capyReceivePlayGamesError?.('PLAY_GAMES_UNAVAILABLE');
              return null;
            },
          };
          const tErrSync = Date.now();
          await assert.rejects(() => syncDriver.signIn(), /PLAY_GAMES_UNAVAILABLE/);
          assert.equal(Date.now() - tErrSync < 200, true, 'signIn must fast-fail synchronous error <200ms');
          assert.equal(nb.playGamesProfileHandlers.size, baseProfileCount);
          assert.equal(nb.playGamesErrorHandlers.size, 1, 'Only external error listener may remain');

          globalThis.window.location.search = '?coop=1';
          try {
            const autoErrDriver = new driversMod.PlayGamesAndroidDriver();
            const tAutoErr = Date.now();
            const autoErrRes = await autoErrDriver.attemptAutoSignIn();
            assert.equal(autoErrRes, null);
            assert.equal(Date.now() - tAutoErr < 200, true, 'attemptAutoSignIn must fast-fail sync error <200ms');
            assert.equal(nb.playGamesProfileHandlers.size, baseProfileCount);
            assert.equal(nb.playGamesErrorHandlers.size, 1);
          } finally {
            globalThis.window.location.search = '';
          }
        } finally {
          extErrUnsub();
        }

        // 3) Pre-buffered pending* synchronous drains leave zero zombie listeners
        globalThis.window.CapyAndroid = {
          isPlayGamesConfigured: () => true,
          loadCloudBinaryChunk: () => null,
          requestCloudSnapshotPull: () => true,
          signInPlayGames: () => null,
        };
        globalThis.window.__capyReceiveCloudSnapshotError?.('pgblob_stale_part_0', 'STALE_ERR');
        const staleErrBlob = await syncDriver.readBinaryBlob('pgblob:pgblob_stale:1:3');
        assert.equal(staleErrBlob, null);
        assert.equal(nb.cloudSnapshotHandlers.size, 0, 'Pre-buffered error drain must not leak snapshot listener');
        assert.equal(nb.cloudSnapshotErrorHandlers.size, 0, 'Pre-buffered error drain must not leak error listener');

        const snapPayload = Buffer.from([1, 2, 3]).toString('base64');
        globalThis.window.__capyReceiveCloudSnapshot?.('pgblob_snap_part_0', snapPayload);
        const drainedBlob = await syncDriver.readBinaryBlob('pgblob:pgblob_snap:1:3');
        assert.deepEqual(drainedBlob, new Uint8Array([1, 2, 3]));
        assert.equal(nb.cloudSnapshotHandlers.size, 0, 'Pre-buffered snapshot drain must not leak snapshot listener');
        assert.equal(nb.cloudSnapshotErrorHandlers.size, 0, 'Pre-buffered snapshot drain must not leak error listener');

        globalThis.window.__capyReceivePlayGamesError?.('STALE_PG_ERR');
        await assert.rejects(() => syncDriver.signIn(), /STALE_PG_ERR/);
        assert.equal(nb.playGamesProfileHandlers.size, baseProfileCount);
        assert.equal(nb.playGamesErrorHandlers.size, 0, 'Pre-buffered Play Games error drain must not leak error listener');

        // Also test pre-buffered pendingPlayGamesProfiles drain with temporary isolated empty profile Set
        const savedProfileHandlers = [...nb.playGamesProfileHandlers];
        nb.playGamesProfileHandlers.clear();
        try {
          globalThis.window.__capyReceivePlayGamesProfile?.(
            JSON.stringify({ playerId: 'pgs_queued_sync', displayName: 'Queued' })
          );
          const queuedDriver = new driversMod.PlayGamesAndroidDriver();
          const queuedRes = await queuedDriver.signIn();
          assert.equal(queuedRes.playerId, 'pgs_queued_sync');
          assert.equal(nb.playGamesProfileHandlers.size, 0, 'Pre-buffered profile drain must not leak profile listener');
          assert.equal(nb.playGamesErrorHandlers.size, 0);

          globalThis.window.location.search = '?coop=1';
          try {
            globalThis.window.__capyReceivePlayGamesProfile?.(
              JSON.stringify({ playerId: 'pgs_queued_auto', displayName: 'QueuedAuto' })
            );
            const queuedAutoDriver = new driversMod.PlayGamesAndroidDriver();
            const queuedAutoRes = await queuedAutoDriver.attemptAutoSignIn();
            assert.equal(queuedAutoRes?.playerId, 'pgs_queued_auto');
            assert.equal(nb.playGamesProfileHandlers.size, 0);
            assert.equal(nb.playGamesErrorHandlers.size, 0);
          } finally {
            globalThis.window.location.search = '';
          }
        } finally {
          for (const fn of savedProfileHandlers) nb.playGamesProfileHandlers.add(fn);
        }

        // 4) NativeBridge.onCloudSnapshot & onCloudSnapshotError catch throwing listener during replay
        globalThis.window.__capyReceiveCloudSnapshot?.('throw_slot', 'AAAA');
        const offThrowSnap = nb.onCloudSnapshot(() => {
          throw new Error('listener boom');
        });
        offThrowSnap();
        globalThis.window.__capyReceiveCloudSnapshotError?.('throw_err_slot', 'ERR');
        const offThrowErr = nb.onCloudSnapshotError(() => {
          throw new Error('err listener boom');
        });
        offThrowErr();
        assert.equal(nb.cloudSnapshotHandlers.size, 0);
        assert.equal(nb.cloudSnapshotErrorHandlers.size, 0);

        gClientMod.setExplicitlySignedOut(false);
        globalThis.window.CapyAndroid = prevCapyAnd;
      }
    } finally {
      globalThis.fetch = prevFetch;
      if (prevLs === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLs;
      if (prevWin === undefined) delete globalThis.window;
      else globalThis.window = prevWin;
    }
  }


  // 6d. ProviderRegistry honest push failure + Google OAuth sessionStorage migration
  {
    // ProviderRegistry honest push failure + Google OAuth sessionStorage migration
    {
      const prevWin = globalThis.window;
      const prevLs = globalThis.localStorage;
      const prevSs = globalThis.sessionStorage;
      const lsMap = new Map();
      const ssMap = new Map();
      const mkStore = (m) => ({
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
      });
      globalThis.localStorage = mkStore(lsMap);
      globalThis.sessionStorage = mkStore(ssMap);
      globalThis.window = {
        location: { pathname: '/', origin: 'https://capypaint.com', hostname: 'capypaint.com', search: '' },
        localStorage: globalThis.localStorage,
        sessionStorage: globalThis.sessionStorage,
      };
      try {
        const gClient = await vite.ssrLoadModule('/src/services/providers/GoogleCloudSyncClient.ts');
        const regMod = await vite.ssrLoadModule('/src/services/providers/ProviderRegistry.ts');
        gClient.saveCachedGoogleSession({
          accessToken: 'tok-sess',
          expiresAt: Date.now() + 300_000,
          sub: 's-sess',
          displayName: 'SessionUser',
        });
        assert.equal(lsMap.has('capy_google_oauth_token_v1'), false, 'OAuth session must not persist in localStorage');
        assert.equal(ssMap.has('capy_google_oauth_token_v1'), true, 'OAuth session must persist in sessionStorage');

        // Failed cloud driver push returns pushed: false without throwing UnhandledPromiseRejection
        const prevPushFetch = globalThis.fetch;
        globalThis.fetch = async () => new Response('Unauthorized', { status: 401 });
        try {
          const failedPush = await regMod.ProviderRegistry.cloudSave.pushRemoteLibraryManifest();
          assert.equal(failedPush.pushed, false);
        } finally {
          globalThis.fetch = prevPushFetch;
        }

        // Honest false returns when no cloud driver is active
        gClient.clearCachedGoogleSession();
        const pushRes = await regMod.ProviderRegistry.cloudSave.pushRemoteLibraryManifest();
        assert.equal(pushRes.pushed, false);

        // joinRoom invalid 4..8 room code must not tear down existing activeRoomCode
        await regMod.ProviderRegistry.realtimeRoom.joinRoom('VALID9', {
          playerId: 'p-1',
          displayName: 'P1',
          avatarColorHex: '#fbbf24',
          lastActiveAt: Date.now(),
        });
        await assert.rejects(
          () =>
            regMod.ProviderRegistry.realtimeRoom.joinRoom('TOO_LONG_99', {
              playerId: 'p-1',
              displayName: 'P1',
              avatarColorHex: '#fbbf24',
              lastActiveAt: Date.now(),
            }),
          /Invalid room code/
        );
        assert.equal(regMod.ProviderRegistry.realtimeRoom.activeRoomCode, 'VALID9');
        regMod.ProviderRegistry.realtimeRoom.leaveRoom();
      } finally {
        if (prevSs === undefined) delete globalThis.sessionStorage;
        else globalThis.sessionStorage = prevSs;
        globalThis.localStorage = prevLs;
        if (prevWin === undefined) delete globalThis.window;
        else globalThis.window = prevWin;
      }
    }
  }

  // 6e (Cloud Providers). Drive dot-segments, multi-chunk & OOO Play Games blobs, NativeBridge listeners & cloudSyncCoordinator
    {
      const prevWin = globalThis.window;
      const prevLs = globalThis.localStorage;
      const prevSs = globalThis.sessionStorage;
      const prevFetch = globalThis.fetch;
      const lsMap = new Map();
      const ssMap = new Map();
      const mkStore = (m) => ({
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
      });
      globalThis.localStorage = mkStore(lsMap);
      globalThis.sessionStorage = mkStore(ssMap);
      globalThis.window = {
        location: { pathname: '/', origin: 'https://capypaint.com', hostname: 'capypaint.com', search: '' },
        localStorage: globalThis.localStorage,
        sessionStorage: globalThis.sessionStorage,
      };
      try {
        const gClient = await vite.ssrLoadModule('/src/services/providers/GoogleCloudSyncClient.ts');
        const driversMod = await vite.ssrLoadModule('/src/services/providers/CloudProviderDrivers.ts');
        const nbMod = await vite.ssrLoadModule('/src/services/NativeBridge.ts');
        const codecMod = await vite.ssrLoadModule('/src/services/CapyCodec.ts');
        const storageMod = await vite.ssrLoadModule('/src/services/StorageService.ts');
        const shareMod = await vite.ssrLoadModule('/src/services/ShareLinkService.ts');
        const svgMod = await vite.ssrLoadModule('/src/services/SvgPrintExporter.ts');
        const nsMod = await vite.ssrLoadModule('/src/services/StorageNamespace.ts');
        const regMod = await vite.ssrLoadModule('/src/services/providers/ProviderRegistry.ts');
        // 1. Dot-segment & traversal rejection in GoogleDriveAppDataClient & GoogleCloudDriver
        for (const badId of ['', '.', '..', 'a..b', 'file.ext', 'dir/file', 'file?x=1']) {
          assert.equal(gClient.isValidGoogleDriveFileId(badId), false);
          await assert.rejects(
            () => gClient.GoogleDriveAppDataClient.downloadJsonFile('tok', badId),
            /Invalid Google Drive file ID/
          );
          await assert.rejects(
            () => gClient.GoogleDriveAppDataClient.downloadBinaryFile('tok', badId),
            /Invalid Google Drive file ID/
          );
          await assert.rejects(
            () => gClient.GoogleDriveAppDataClient.uploadJsonFile('tok', 'manifest.json', {}, badId),
            /Invalid Google Drive file ID/
          );
        }
        gClient.saveCachedGoogleSession({
          accessToken: 'tok-dot',
          expiresAt: Date.now() + 600_000,
          sub: 's-dot',
          displayName: 'Dot',
        });
        const gDriver = new driversMod.GoogleCloudDriver();
        let driveFetchCount = 0;
        globalThis.fetch = async (url) => {
          driveFetchCount++;
          if (String(url).includes('spaces=appDataFolder')) {
            return new Response(JSON.stringify({ files: [{ id: '..', name: 'evil.json' }] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response('{}', { status: 200 });
        };
        for (const badBlobRef of ['.', '..', 'file.bin', '../x']) {
          assert.equal(await gDriver.readBinaryBlob(badBlobRef), null);
        }
        assert.equal(driveFetchCount, 0, 'GoogleCloudDriver must not fetch invalid/dot-segment blobRefs');
        await assert.rejects(
          () => gClient.GoogleDriveAppDataClient.findFileByName('tok-dot', 'evil.json'),
          /Invalid Google Drive file ID in response/
        );

        // 2. PlayGamesAndroidDriver pre-queued & out-of-order multi-chunk transfers + unrelated queue preservation
        const part0Bytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
        const part1Bytes = new Uint8Array([7, 8, 9, 10, 11, 12]);
        const part0B64 = codecMod.uint8ToBase64(part0Bytes);
        const part1B64 = codecMod.uint8ToBase64(part1Bytes);
        let oooPullCount = 0;
        globalThis.window.CapyAndroid = {
          isPlayGamesConfigured: () => true,
          loadCloudBinaryChunk: () => null,
          requestCloudSnapshotPull: (slot) => {
            if (slot.startsWith('pgblob_ooo_')) {
              oooPullCount++;
              if (slot === 'pgblob_ooo_part_0') {
                setTimeout(() => {
                  globalThis.window.__capyReceiveCloudSnapshot('pgblob_ooo_part_1', part1B64);
                  setTimeout(() => {
                    globalThis.window.__capyReceiveCloudSnapshot('pgblob_ooo_part_0', part0B64);
                  }, 5);
                }, 5);
              }
              return true;
            }
            return false;
          },
        };
        nbMod.NativeBridge.attachWindowCallbacks();

        // Pre-queue unrelated slot + both parts of pgblob_prequeue before readBinaryBlob subscribes
        globalThis.window.__capyReceiveCloudSnapshot('unrelated_slot_keep', '{"ok":1}');
        globalThis.window.__capyReceiveCloudSnapshot('pgblob_prequeue_part_0', part0B64);
        globalThis.window.__capyReceiveCloudSnapshot('pgblob_prequeue_part_1', part1B64);

        const pgDriver = new driversMod.PlayGamesAndroidDriver();
        const tPre0 = Date.now();
        const assembledPre = await pgDriver.readBinaryBlob('pgblob:pgblob_prequeue:2:12');
        assert.ok(assembledPre, 'Pre-queued multi-chunk readBinaryBlob must assemble cleanly');
        assert.deepEqual(Array.from(assembledPre), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        assert.equal(Date.now() - tPre0 < 250, true, 'Pre-queued multi-chunk transfer must not stall');

        // Unrelated queued slot must still be delivered to subsequent subscriber
        let unrelatedSeen = null;
        const unsubUnrelated = nbMod.NativeBridge.onCloudSnapshot((slot, payload) => {
          unrelatedSeen = { slot, payload };
        });
        unsubUnrelated();
        assert.deepEqual(unrelatedSeen, { slot: 'unrelated_slot_keep', payload: '{"ok":1}' });

        // Out-of-order async delivery (part_1 arrives before part_0)
        const assembledOoo = await pgDriver.readBinaryBlob('pgblob:pgblob_ooo:2:12');
        assert.ok(assembledOoo, 'Out-of-order multi-chunk readBinaryBlob must succeed');
        assert.deepEqual(Array.from(assembledOoo), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        assert.equal(oooPullCount, 2, 'Should issue exactly 1 pull per missing chunk');


        const validDeltaTok = await codecMod.encodeProgressDeltaToken({
          version: 2,
          filledRegionIds: [1],
          updatedAt: 1700000000000,
        });

        // syncFullLibrary must not throw TypeError on non-string sampleAssetPath/sourceRef.uri in remote manifest
        delete globalThis.window.CapyAndroid;
        gClient.saveCachedGoogleSession({
          accessToken: 'tok-sync-safe',
          expiresAt: Date.now() + 600_000,
          sub: 's-sync',
          displayName: 'SyncSafe',
        });
        let manifestReadHit = false;
        globalThis.fetch = async (url, init) => {
          const sUrl = String(url);
          if (sUrl.includes('spaces=appDataFolder')) {
            return new Response(
              JSON.stringify({ files: [{ id: 'manifest_file_1', name: 'capy_cloud_manifest_v2.json' }] }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }
            );
          }
          if (sUrl.includes('/upload/drive/v3/files')) {
            return new Response(JSON.stringify({ id: 'manifest_file_1', name: 'capy_cloud_manifest_v2.json' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (sUrl.includes('manifest_file_1') && (!init?.method || init.method === 'GET')) {
            manifestReadHit = true;
            return new Response(
              JSON.stringify({
                version: 2,
                updatedAt: 1700000000000,
                providerId: 'google',
                entries: {
                  bad_entry: {
                    snapshotId: 'missing_local_1',
                    title: 'Malformed Remote Entry',
                    updatedAt: 1700000000000,
                    deltaToken: validDeltaTok,
                    sampleAssetPath: 123,
                    sourceRef: { kind: 'sample', uri: 123 },
                  },
                },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          return new Response('{}', { status: 404 });
        };
        const syncSafeRes = await regMod.ProviderRegistry.cloudSave.syncFullLibrary([]);
        assert.equal(manifestReadHit, true, 'syncFullLibrary must read remote Google manifest');
        assert.equal(syncSafeRes.importedSavesFromCloud, 0);


        // 7e. NativeBridge preserves unmatched live snapshots/errors while filtered or declining listeners are active
        const freshNb = new nbMod.NativeBridgeService();
        let writeChunkInvocations = 0;
        const interleavePart0 = codecMod.uint8ToBase64(new Uint8Array([1, 2, 3, 4]));
        const interleavePart1 = codecMod.uint8ToBase64(new Uint8Array([5, 6, 7, 8]));
        globalThis.window.CapyAndroid = {
          isPlayGamesConfigured: () => true,
          loadCloudBinaryChunk: () => null,
          saveCloudBinaryChunk: () => {
            writeChunkInvocations++;
            return true;
          },
          requestCloudSnapshotPull: (slot) => {
            if (slot === 'pgblob_interleave_part_0') {
              setTimeout(() => {
                // Unrelated live snapshot arrives while readBinaryBlob holds slotFilter listener
                globalThis.window.__capyReceiveCloudSnapshot(
                  'capy_cloud_manifest_v2',
                  '{"version":2,"updatedAt":123,"providerId":"play_games_v2","entries":{}}'
                );
                globalThis.window.__capyReceiveCloudSnapshot('pgblob_interleave_part_0', interleavePart0);
                globalThis.window.__capyReceiveCloudSnapshot('pgblob_interleave_part_1', interleavePart1);
              }, 5);
              return true;
            }
            return slot === 'pgblob_interleave_part_1';
          },
        };
        nbMod.NativeBridge.attachWindowCallbacks();

        const interleaveDriver = new driversMod.PlayGamesAndroidDriver();
        const interleaveBytes = await interleaveDriver.readBinaryBlob('pgblob:pgblob_interleave:2:8');
        assert.deepEqual(Array.from(interleaveBytes || []), [1, 2, 3, 4, 5, 6, 7, 8]);

        let manifestPayload = null;
        nbMod.NativeBridge.onCloudSnapshot(
          (_slot, payload) => {
            manifestPayload = payload;
          },
          { slotKey: 'capy_cloud_manifest_v2', once: true }
        );
        assert.equal(
          manifestPayload,
          '{"version":2,"updatedAt":123,"providerId":"play_games_v2","entries":{}}',
          'Live snapshot for unrelated slot during active slotFilter listener must remain queued'
        );

        // Matched live delivery must NOT also enqueue into pendingCloudSnapshots
        let liveConsumedCount = 0;
        const unsubConsume = nbMod.NativeBridge.onCloudSnapshot(
          () => {
            liveConsumedCount++;
          },
          { slotKey: 'matched_live_slot' }
        );
        globalThis.window.__capyReceiveCloudSnapshot('matched_live_slot', '{"v":1}');
        unsubConsume();
        let duplicateSeen = false;
        const unsubDup = nbMod.NativeBridge.onCloudSnapshot(
          () => {
            duplicateSeen = true;
          },
          { slotKey: 'matched_live_slot', once: true }
        );
        unsubDup();
        assert.equal(liveConsumedCount, 1);
        assert.equal(duplicateSeen, false, 'Consumed live snapshot must not replay to later subscribers');

        // Filtered error channel must preserve unrelated live errors + declining listeners
        const unsubSlotAErr = nbMod.NativeBridge.onCloudSnapshotError(() => {}, { slotKey: 'slot_A' });
        globalThis.window.__capyReceiveCloudSnapshotError('slot_B', 'PLAY_GAMES_SNAPSHOT_READ_FAILED');
        unsubSlotAErr();
        let errDeliveredToB = null;
        nbMod.NativeBridge.onCloudSnapshotError(
          (slot, reason) => {
            errDeliveredToB = { slot, reason };
          },
          { slotKey: 'slot_B', once: true }
        );
        assert.deepEqual(errDeliveredToB, { slot: 'slot_B', reason: 'PLAY_GAMES_SNAPSHOT_READ_FAILED' });

        // Declining listener (returns false) preserves live snapshot in pending queue
        freshNb.attachWindowCallbacks();
        const unsubDecline = freshNb.onCloudSnapshot(() => false, { slotKey: 'decline_slot', once: true });
        globalThis.window.__capyReceiveCloudSnapshot('decline_slot', '{"declined":true}');
        assert.equal(freshNb.cloudSnapshotHandlers.size, 1, 'Declining once:true listener must stay subscribed');
        unsubDecline();
        assert.equal(freshNb.cloudSnapshotHandlers.size, 0);
        let acceptedAfterDecline = null;
        freshNb.onCloudSnapshot(
          (_s, p) => {
            acceptedAfterDecline = p;
          },
          { slotKey: 'decline_slot', once: true }
        );
        assert.equal(acceptedAfterDecline, '{"declined":true}');

        // 7f. NativeBridge once:true handlers that throw unsubscribe cleanly in both live and replay across all 4 channels
        const nb7f = new nbMod.NativeBridgeService();
        nb7f.attachWindowCallbacks();
        try {
          for (const [channel, fire] of [
            [
              'cloudSnapshot',
              (idx) => globalThis.window.__capyReceiveCloudSnapshot('throw_once_slot', `{"i":${idx}}`),
            ],
            [
              'cloudSnapshotError',
              (idx) => globalThis.window.__capyReceiveCloudSnapshotError('throw_once_err_slot', `ERR_${idx}`),
            ],
            [
              'playGamesProfile',
              (idx) =>
                globalThis.window.__capyReceivePlayGamesProfile(
                  JSON.stringify({ playerId: `pg_throw_${idx}`, displayName: 'Throw' })
                ),
            ],
            ['playGamesError', (idx) => globalThis.window.__capyReceivePlayGamesError(`PG_ERR_${idx}`)],
          ]) {
            // Live path: register once:true throwing handler, then fire twice
            let liveThrows = 0;
            if (channel === 'cloudSnapshot') {
              nb7f.onCloudSnapshot(
                () => {
                  liveThrows++;
                  throw new Error('live boom');
                },
                { slotKey: 'throw_once_slot', once: true }
              );
            } else if (channel === 'cloudSnapshotError') {
              nb7f.onCloudSnapshotError(
                () => {
                  liveThrows++;
                  throw new Error('live boom');
                },
                { slotKey: 'throw_once_err_slot', once: true }
              );
            } else if (channel === 'playGamesProfile') {
              nb7f.onPlayGamesProfile(
                () => {
                  liveThrows++;
                  throw new Error('live boom');
                },
                { once: true }
              );
            } else {
              nb7f.onPlayGamesError(
                () => {
                  liveThrows++;
                  throw new Error('live boom');
                },
                { once: true }
              );
            }
            fire(1);
            fire(2);
            assert.equal(liveThrows, 1, `Live throwing once:true listener must fire once on ${channel}`);

            // Drain queued fire(2) cleanly
            let drained2 = 0;
            if (channel === 'cloudSnapshot') {
              nb7f.onCloudSnapshot(() => { drained2++; }, { slotKey: 'throw_once_slot', once: true });
            } else if (channel === 'cloudSnapshotError') {
              nb7f.onCloudSnapshotError(() => { drained2++; }, {
                slotKey: 'throw_once_err_slot',
                once: true,
              });
            } else if (channel === 'playGamesProfile') {
              nb7f.onPlayGamesProfile(() => { drained2++; }, { once: true });
            } else {
              nb7f.onPlayGamesError(() => { drained2++; }, { once: true });
            }
            assert.equal(drained2, 1, `Queued fire(2) must replay and clear once:true drain on ${channel}`);

            // Replay path: queue item first, register once:true throwing handler, then fire second item live
            fire(3);
            let replayThrows = 0;
            if (channel === 'cloudSnapshot') {
              nb7f.onCloudSnapshot(
                () => {
                  replayThrows++;
                  throw new Error('replay boom');
                },
                { slotKey: 'throw_once_slot', once: true }
              );
            } else if (channel === 'cloudSnapshotError') {
              nb7f.onCloudSnapshotError(
                () => {
                  replayThrows++;
                  throw new Error('replay boom');
                },
                { slotKey: 'throw_once_err_slot', once: true }
              );
            } else if (channel === 'playGamesProfile') {
              nb7f.onPlayGamesProfile(
                () => {
                  replayThrows++;
                  throw new Error('replay boom');
                },
                { once: true }
              );
            } else {
              nb7f.onPlayGamesError(
                () => {
                  replayThrows++;
                  throw new Error('replay boom');
                },
                { once: true }
              );
            }
            fire(4);
            assert.equal(replayThrows, 1, `Replay throwing once:true listener must fire once on ${channel}`);

            // Drain queued fire(4) so subsequent tests see clean queues
            let drained4 = 0;
            if (channel === 'cloudSnapshot') {
              nb7f.onCloudSnapshot(() => { drained4++; }, { slotKey: 'throw_once_slot', once: true });
            } else if (channel === 'cloudSnapshotError') {
              nb7f.onCloudSnapshotError(() => { drained4++; }, {
                slotKey: 'throw_once_err_slot',
                once: true,
              });
            } else if (channel === 'playGamesProfile') {
              nb7f.onPlayGamesProfile(() => { drained4++; }, { once: true });
            } else {
              nb7f.onPlayGamesError(() => { drained4++; }, { once: true });
            }
            assert.equal(drained4, 1, `Queued fire(4) must replay and clear once:true drain on ${channel}`);
          }
          assert.equal(nb7f.cloudSnapshotHandlers.size, 0);
          assert.equal(nb7f.cloudSnapshotErrorHandlers.size, 0);
          assert.equal(nb7f.playGamesProfileHandlers.size, 0);
          assert.equal(nb7f.playGamesErrorHandlers.size, 0);
        } finally {
          nbMod.NativeBridge.attachWindowCallbacks();
        }

        // 7g. PlayGamesAndroidDriver.writeBinaryBlob rejects dot-segments symmetrically with readBinaryBlob
        const sampleWriteBytes = new Uint8Array([1, 2, 3, 4]);
        for (const badSlotKey of ['', ' ', '.', '..', '../secret', 'a..b', 'slot/../../x']) {
          assert.equal(
            await interleaveDriver.writeBinaryBlob(badSlotKey, 'save.capy', sampleWriteBytes),
            null,
            `writeBinaryBlob must reject dot-segment/invalid slotKey ${JSON.stringify(badSlotKey)}`
          );
        }
        assert.equal(writeChunkInvocations, 0, 'Rejected writeBinaryBlob calls must not write chunks');

        // 7h. NativeBridge prevents synchronous re-entrant double-fire on once:true listeners across all 4 channels (replay + live)
        const nb7h = new nbMod.NativeBridgeService();
        nb7h.attachWindowCallbacks();
        try {
          const channelDefs = [
            [
              'cloudSnapshot',
              (tag) => globalThis.window.__capyReceiveCloudSnapshot(`re_slot_${tag}`, `{"tag":"${tag}"}`),
              (bridge, fn, opts) =>
                bridge.onCloudSnapshot(fn, {
                  slotFilter: (s) => s.startsWith('re_slot_'),
                  ...opts,
                }),
              (bridge) => bridge.cloudSnapshotHandlers.size,
            ],
            [
              'cloudSnapshotError',
              (tag) => globalThis.window.__capyReceiveCloudSnapshotError(`re_err_${tag}`, `ERR_${tag}`),
              (bridge, fn, opts) =>
                bridge.onCloudSnapshotError(fn, {
                  slotFilter: (s) => s.startsWith('re_err_'),
                  ...opts,
                }),
              (bridge) => bridge.cloudSnapshotErrorHandlers.size,
            ],
            [
              'playGamesProfile',
              (tag) =>
                globalThis.window.__capyReceivePlayGamesProfile(
                  JSON.stringify({ playerId: `re_pg_${tag}`, displayName: `Player_${tag}` })
                ),
              (bridge, fn, opts) => bridge.onPlayGamesProfile(fn, opts),
              (bridge) => bridge.playGamesProfileHandlers.size,
            ],
            [
              'playGamesError',
              (tag) => globalThis.window.__capyReceivePlayGamesError(`RE_PG_ERR_${tag}`),
              (bridge, fn, opts) => bridge.onPlayGamesError(fn, opts),
              (bridge) => bridge.playGamesErrorHandlers.size,
            ],
          ];

          for (const [name, fire, subscribe, getSize] of channelDefs) {
            // Replay synchronous re-entrancy
            fire('R1');
            let replayCount = 0;
            subscribe(
              nb7h,
              () => {
                replayCount++;
                fire('R2');
              },
              { once: true }
            );
            assert.equal(replayCount, 1, `Replay re-entrant once:true listener must fire once on ${name}`);
            assert.equal(getSize(nb7h), 0, `Replay consumed once:true listener must not stay in set on ${name}`);

            let drainR2 = 0;
            subscribe(
              nb7h,
              () => {
                drainR2++;
              },
              { once: true }
            );
            assert.equal(drainR2, 1, `Re-entrant R2 queued during replay must deliver once to next listener on ${name}`);
            assert.equal(getSize(nb7h), 0);

            // Live synchronous re-entrancy
            let liveCount = 0;
            subscribe(
              nb7h,
              () => {
                liveCount++;
                fire('L2');
              },
              { once: true }
            );
            fire('L1');
            assert.equal(liveCount, 1, `Live re-entrant once:true listener must fire once on ${name}`);
            assert.equal(getSize(nb7h), 0, `Live consumed once:true listener must leave set before handler invokes on ${name}`);

            let drainL2 = 0;
            subscribe(
              nb7h,
              () => {
                drainL2++;
              },
              { once: true }
            );
            assert.equal(drainL2, 1, `Re-entrant L2 queued during live dispatch must deliver once to next listener on ${name}`);
            assert.equal(getSize(nb7h), 0);

            // Declining once:true (return false) during replay keeps listening until matching live acceptance
            fire('D1');
            let declineAttempt = 0;
            subscribe(
              nb7h,
              () => {
                declineAttempt++;
                return declineAttempt === 1 ? false : true;
              },
              { once: true }
            );
            assert.equal(declineAttempt, 1);
            assert.equal(getSize(nb7h), 1, `Declining replay once:true listener must remain subscribed on ${name}`);
            fire('D2');
            assert.equal(declineAttempt, 2, `Declining replay once:true listener must accept subsequent live event on ${name}`);
            assert.equal(getSize(nb7h), 0);

            // Drain retained D1
            let drainD1 = 0;
            subscribe(
              nb7h,
              () => {
                drainD1++;
              },
              { once: true }
            );
            assert.equal(drainD1, 1);
            assert.equal(getSize(nb7h), 0);
          }
        } finally {
          nbMod.NativeBridge.attachWindowCallbacks();
        }

        // 7i. cloudSyncCoordinator filters pgblob_* / *_part_N chunks out of onCloudSnapshot and coalesces concurrent sync passes
        const syncCoordMod = await vite.ssrLoadModule('/src/services/cloudSyncCoordinator.ts');
        assert.equal(syncCoordMod.isManifestCloudSnapshotSlot('capy_cloud_manifest_v2'), true);
        assert.equal(syncCoordMod.isManifestCloudSnapshotSlot('capy_save_1'), true);
        assert.equal(syncCoordMod.isManifestCloudSnapshotSlot('pgblob_storm_check_part_0'), false);
        assert.equal(syncCoordMod.isManifestCloudSnapshotSlot('custom_slot_part_2'), false);
        assert.equal(syncCoordMod.isManifestCloudSnapshotSlot(''), false);

        {
          const controller = syncCoordMod.createCoalescedSyncController();
          assert.equal(controller.isInFlight(), false);
          let releaseFirstPass = null;
          let runCount = 0;
          const p1 = controller.run(async () => {
            runCount++;
            if (runCount === 1) {
              await new Promise((resolve) => {
                releaseFirstPass = resolve;
              });
              return 'pass-1';
            }
            return 'pass-2';
          });
          await Promise.resolve();
          assert.equal(controller.isInFlight(), true);
          const p2 = controller.run(async () => {
            runCount++;
            return 'trailing-pass';
          });
          assert.equal(p2, p1, 'Overlapping run() calls must share the active coalesced promise');
          releaseFirstPass?.();
          const res1 = await p1;
          assert.equal(res1, 'trailing-pass', 'Coalesced controller must run exactly one trailing pass');
          assert.equal(runCount, 2);
          assert.equal(controller.isInFlight(), false);

          // Mid-pass requestTrailingPass() schedules a follow-up pass cleanly and error resets in-flight state
          let trailingRuns = 0;
          let releaseMidPass = null;
          const pMid = controller.run(async () => {
            trailingRuns++;
            if (trailingRuns === 1) {
              controller.requestTrailingPass();
              await new Promise((resolve) => {
                releaseMidPass = resolve;
              });
            }
            return `mid-${trailingRuns}`;
          });
          await Promise.resolve();
          releaseMidPass?.();
          assert.equal(await pMid, 'mid-2');
          assert.equal(trailingRuns, 2);
          assert.equal(controller.isInFlight(), false);

          await assert.rejects(
            () =>
              controller.run(async () => {
                throw new Error('simulated sync pass failure');
              }),
            /simulated sync pass failure/
          );
          assert.equal(controller.isInFlight(), false, 'Failed sync pass must clear inFlight state');
        }

        // Verify live NativeBridge + PlayGamesAndroidDriver multi-chunk isolation with isManifestCloudSnapshotSlot
        let nonBlobTriggers = 0;
        const part0 = codecMod.uint8ToBase64(new Uint8Array([10, 20, 30, 40]));
        const part1 = codecMod.uint8ToBase64(new Uint8Array([50, 60, 70, 80]));
        const part2 = codecMod.uint8ToBase64(new Uint8Array([90, 100, 110, 120]));
        const chunkMap = {
          pgblob_storm_check_part_0: part0,
          pgblob_storm_check_part_1: part1,
          pgblob_storm_check_part_2: part2,
        };
        const chunkPullCounts = { 0: 0, 1: 0, 2: 0 };
        globalThis.window.CapyAndroid = {
          isPlayGamesConfigured: () => true,
          loadCloudBinaryChunk: () => null,
          requestCloudSnapshotPull: (slot) => {
            const match = /^pgblob_storm_check_part_(\d+)$/.exec(slot);
            if (!match) return false;
            const idx = Number(match[1]);
            chunkPullCounts[idx]++;
            setTimeout(() => {
              globalThis.window.__capyReceiveCloudSnapshot(slot, chunkMap[slot]);
            }, 5 + idx * 5);
            return true;
          },
        };
        nbMod.NativeBridge.attachWindowCallbacks();
        const unsubManifestGuard = nbMod.NativeBridge.onCloudSnapshot(
          () => {
            nonBlobTriggers++;
          },
          { slotFilter: syncCoordMod.isManifestCloudSnapshotSlot }
        );
        try {
          const stormDriver = new driversMod.PlayGamesAndroidDriver();
          const assembled = await stormDriver.readBinaryBlob('pgblob:pgblob_storm_check:3:12');
          assert.deepEqual(Array.from(assembled || []), [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
          assert.deepEqual(chunkPullCounts, { 0: 1, 1: 1, 2: 1 }, 'Each pgblob chunk must be pulled exactly once');
          assert.equal(nonBlobTriggers, 0, 'Non-pgblob App listener must fire 0 times on pgblob_* chunk arrivals');

          globalThis.window.__capyReceiveCloudSnapshot('custom_snapshot_part_0', '{"chunk":0}');
          assert.equal(nonBlobTriggers, 0, 'Manifest listener must ignore *_part_N chunk slots');

          globalThis.window.__capyReceiveCloudSnapshot('capy_cloud_manifest_v2', '{"version":2,"entries":{}}');
          assert.equal(nonBlobTriggers, 1, 'Non-pgblob App listener must still fire on manifest snapshots');
        } finally {
          unsubManifestGuard();
        }

        // 7j. F2 regression: Late pgblob_* chunk or error from aborted attempt must never poison subsequent retries
        {
          let attemptNum = 0;
          const b0Attempt2 = codecMod.uint8ToBase64(new Uint8Array([1, 2, 3, 4]));
          const b1LateOld = codecMod.uint8ToBase64(new Uint8Array([5, 6, 7, 8]));
          const b1Attempt2 = codecMod.uint8ToBase64(new Uint8Array([9, 10, 11, 12]));
          globalThis.window.CapyAndroid = {
            isPlayGamesConfigured: () => true,
            loadCloudBinaryChunk: () => null,
            requestCloudSnapshotPull: (slot) => {
              if (slot === 'pgblob_f2_late_ok_part_0') {
                attemptNum++;
                const curAttempt = attemptNum;
                if (curAttempt === 1) {
                  setTimeout(() => {
                    globalThis.window.__capyReceiveCloudSnapshotError('pgblob_f2_late_ok_part_0', 'TRANSIENT_ERR');
                  }, 10);
                } else {
                  setTimeout(() => {
                    globalThis.window.__capyReceiveCloudSnapshot('pgblob_f2_late_ok_part_0', b0Attempt2);
                  }, 10);
                }
                return true;
              }
              if (slot === 'pgblob_f2_late_ok_part_1') {
                const curAttempt = attemptNum;
                if (curAttempt === 1) {
                  setTimeout(() => {
                    globalThis.window.__capyReceiveCloudSnapshot('pgblob_f2_late_ok_part_1', b1LateOld);
                  }, 30);
                } else {
                  setTimeout(() => {
                    globalThis.window.__capyReceiveCloudSnapshot('pgblob_f2_late_ok_part_1', b1Attempt2);
                  }, 15);
                }
                return true;
              }
              return false;
            },
          };
          nbMod.NativeBridge.attachWindowCallbacks();
          const f2Driver = new driversMod.PlayGamesAndroidDriver();
          const attempt1Res = await f2Driver.readBinaryBlob('pgblob:pgblob_f2_late_ok:2:8');
          assert.equal(attempt1Res, null, 'Aborted attempt 1 must return null');
          await new Promise((r) => setTimeout(r, 45));
          const attempt2Res = await f2Driver.readBinaryBlob('pgblob:pgblob_f2_late_ok:2:8');
          assert.deepEqual(
            Array.from(attempt2Res || []),
            [1, 2, 3, 4, 9, 10, 11, 12],
            'Attempt 2 must assemble fresh chunks and ignore late stale part_1 from aborted attempt 1'
          );

          // Late error from aborted attempt must also be discarded before retry
          let errAttemptNum = 0;
          const e0Attempt2 = codecMod.uint8ToBase64(new Uint8Array([10, 20, 30, 40]));
          const e1Attempt2 = codecMod.uint8ToBase64(new Uint8Array([50, 60, 70, 80]));
          globalThis.window.CapyAndroid = {
            isPlayGamesConfigured: () => true,
            loadCloudBinaryChunk: () => null,
            requestCloudSnapshotPull: (slot) => {
              if (slot === 'pgblob_f2_late_err_part_0') {
                errAttemptNum++;
                const curAttempt = errAttemptNum;
                if (curAttempt === 1) {
                  setTimeout(() => {
                    globalThis.window.__capyReceiveCloudSnapshotError('pgblob_f2_late_err_part_0', 'ERR_0');
                  }, 10);
                } else {
                  setTimeout(() => {
                    globalThis.window.__capyReceiveCloudSnapshot('pgblob_f2_late_err_part_0', e0Attempt2);
                  }, 10);
                }
                return true;
              }
              if (slot === 'pgblob_f2_late_err_part_1') {
                const curAttempt = errAttemptNum;
                if (curAttempt === 1) {
                  setTimeout(() => {
                    globalThis.window.__capyReceiveCloudSnapshotError('pgblob_f2_late_err_part_1', 'LATE_ERR_1');
                  }, 30);
                } else {
                  setTimeout(() => {
                    globalThis.window.__capyReceiveCloudSnapshot('pgblob_f2_late_err_part_1', e1Attempt2);
                  }, 15);
                }
                return true;
              }
              return false;
            },
          };
          nbMod.NativeBridge.attachWindowCallbacks();
          const errAttempt1 = await f2Driver.readBinaryBlob('pgblob:pgblob_f2_late_err:2:8');
          assert.equal(errAttempt1, null);
          await new Promise((r) => setTimeout(r, 45));
          const errAttempt2 = await f2Driver.readBinaryBlob('pgblob:pgblob_f2_late_err:2:8');
          assert.deepEqual(
            Array.from(errAttempt2 || []),
            [10, 20, 30, 40, 50, 60, 70, 80],
            'Attempt 2 must succeed cleanly without aborting on late part_1 error from attempt 1'
          );
        }

        // 7k. F1 regression: syncFullLibrary must not resurrect progress when Reset Progress or Delete runs mid-sync
        {
          delete globalThis.window.CapyAndroid;
          lsMap.clear();
          ssMap.clear();
          gClient.saveCachedGoogleSession({
            accessToken: 'tok-f1-race',
            expiresAt: Date.now() + 600_000,
            sub: 's-f1-race',
            displayName: 'F1Race',
          });

          const remoteOldToken = await codecMod.encodeProgressDeltaToken({
            version: 2,
            sourceRef: { kind: 'sample', uri: 'assets/capybara.webp' },
            filledRegionIds: [1, 2, 3],
            updatedAt: 1700000000000,
          });
          storageMod.StorageService.saveSnapshots([
            {
              id: 'sample-capybara',
              title: 'Capybara',
              timestamp: 1000,
              lastOpened: 2000,
              filledCount: 1,
              totalCount: 10,
              filledRegionIds: [1],
              resetEpoch: 0,
              sampleAssetPath: 'assets/capybara.webp',
              sourceRef: { kind: 'sample', uri: 'assets/capybara.webp' },
              zoomScale: 1,
              panOffsetX: 0,
              panOffsetY: 0,
            },
            {
              id: 'custom_del_race',
              title: 'Delete Race',
              timestamp: 1000,
              lastOpened: 1500,
              filledCount: 1,
              totalCount: 10,
              filledRegionIds: [4],
              resetEpoch: 0,
              zoomScale: 1,
              panOffsetX: 0,
              panOffsetY: 0,
            },
          ]);

          const delToken = await codecMod.encodeProgressDeltaToken({
            version: 2,
            filledRegionIds: [4],
            updatedAt: 1700000000000,
          });
          let releaseManifestRead = null;
          let releaseManifestPush = null;
          let holdManifestPush = false;
          const uploadedManifests = [];
          globalThis.fetch = async (url, init) => {
            const sUrl = String(url);
            if (sUrl.includes('spaces=appDataFolder')) {
              return new Response(
                JSON.stringify({ files: [{ id: 'f1_manifest_id', name: 'capy_cloud_manifest_v2.json' }] }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
              );
            }
            if (sUrl.includes('/upload/drive/v3/files')) {
              if (holdManifestPush) {
                await new Promise((resolve) => {
                  releaseManifestPush = resolve;
                });
              }
              const bodyStr = typeof init?.body === 'string' ? init.body : '';
              const jsonStart = bodyStr.indexOf('{"version"');
              const jsonEnd = bodyStr.lastIndexOf('}') + 1;
              if (jsonStart >= 0 && jsonEnd > jsonStart) {
                try {
                  uploadedManifests.push(JSON.parse(bodyStr.slice(jsonStart, jsonEnd)));
                } catch {
                  // Ignore non-manifest multipart uploads
                }
              }
              return new Response(JSON.stringify({ id: 'f1_manifest_id', name: 'capy_cloud_manifest_v2.json' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            if (sUrl.includes('f1_manifest_id') && (!init?.method || init.method === 'GET')) {
              if (releaseManifestRead !== false) {
                await new Promise((resolve) => {
                  releaseManifestRead = resolve;
                });
              }
              return new Response(
                JSON.stringify({
                  version: 2,
                  updatedAt: 1700000000000,
                  providerId: 'google',
                  entries: {
                    sample_assets_capybara_webp: {
                      snapshotId: 'sample-capybara',
                      slotKey: 'sample_assets_capybara_webp',
                      title: 'Capybara',
                      createdAt: 1000,
                      lastOpened: 2000,
                      filledCount: 3,
                      totalCount: 10,
                      resetEpoch: 0,
                      deltaToken: remoteOldToken,
                      sampleAssetPath: 'assets/capybara.webp',
                      sourceRef: { kind: 'sample', uri: 'assets/capybara.webp' },
                    },
                    save_custom_del_race: {
                      snapshotId: 'custom_del_race',
                      slotKey: 'save_custom_del_race',
                      title: 'Delete Race',
                      createdAt: 1000,
                      lastOpened: 1500,
                      filledCount: 1,
                      totalCount: 10,
                      resetEpoch: 0,
                      deltaToken: delToken,
                    },
                  },
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
              );
            }
            return new Response('{}', { status: 404 });
          };

          const syncPromise = regMod.ProviderRegistry.cloudSave.syncFullLibrary(
            storageMod.StorageService.loadSnapshots()
          );
          while (!releaseManifestRead) {
            await new Promise((r) => setTimeout(r, 5));
          }
          // Mid-Step-1: User resets sample-capybara to epoch=1 and deletes custom_del_race
          storageMod.StorageService.updateSnapshotProgress(
            'sample-capybara',
            0,
            10,
            [],
            1,
            0,
            0,
            undefined,
            {},
            undefined,
            false,
            undefined,
            1
          );
          await storageMod.StorageService.deleteSnapshot('custom_del_race');
          releaseManifestRead();
          const syncOut = await syncPromise;

          assert.equal(syncOut.mergedRegionsFromCloud, 0, 'Reset epoch 1 must reject stale epoch-0 remote regions');
          assert.equal(syncOut.hasPendingLocalChanges, false);
          const afterSnaps = storageMod.StorageService.loadSnapshots();
          assert.equal(afterSnaps.some((s) => s.id === 'custom_del_race'), false, 'Deleted snapshot must not be resurrected');
          const afterCapy = afterSnaps.find((s) => s.id === 'sample-capybara');
          assert.equal(afterCapy?.resetEpoch, 1);
          assert.deepEqual(afterCapy?.filledRegionIds, []);
          const lastManifest = uploadedManifests[uploadedManifests.length - 1];
          assert.equal(lastManifest?.entries?.sample_assets_capybara_webp?.resetEpoch, 1);
          assert.equal(lastManifest?.entries?.sample_assets_capybara_webp?.filledCount, 0);
          const decodedUploadedDelta = await codecMod.decodeProgressDeltaToken(
            lastManifest.entries.sample_assets_capybara_webp.deltaToken
          );
          assert.equal(decodedUploadedDelta.resetEpoch, 1);
          assert.deepEqual(decodedUploadedDelta.filledRegionIds, []);

          // Mid-Step-3 (during manifest upload) reset must report hasPendingLocalChanges: true
          releaseManifestRead = false;
          holdManifestPush = true;
          const sync2Promise = regMod.ProviderRegistry.cloudSave.syncFullLibrary(
            storageMod.StorageService.loadSnapshots()
          );
          while (!releaseManifestPush) {
            await new Promise((r) => setTimeout(r, 5));
          }
          storageMod.StorageService.updateSnapshotProgress(
            'sample-capybara',
            0,
            10,
            [],
            1,
            0,
            0,
            undefined,
            {},
            undefined,
            false,
            undefined,
            2
          );
          releaseManifestPush();
          const sync2Out = await sync2Promise;
          assert.equal(
            sync2Out.hasPendingLocalChanges,
            true,
            'Reset occurring during pushRemoteLibraryManifest must set hasPendingLocalChanges so App.tsx schedules trailing pass'
          );

          const cloudSyncHookSrc = fs.readFileSync(
            path.join(WEB_ROOT, 'src/hooks/useCloudSyncController.ts'),
            'utf8'
          );
          assert.match(
            cloudSyncHookSrc,
            /libSummary\.hasPendingLocalChanges[\s\S]*?latestSavedEpoch > pushedSlotEpoch[\s\S]*?controller\.requestTrailingPass\(\)/,
            'useCloudSyncController.ts must re-queue cloud sync via controller.requestTrailingPass() when resetEpoch advances mid-sync'
          );
        }

        // 7l. C8-2 regression: useCloudSyncController.ts must compute canonical slotKey via computeSlotKeyForSnapshot so ./assets/ vs assets/ prefixes never fork cloud slots
        {
          lsMap.clear();
          ssMap.clear();
          gClient.saveCachedGoogleSession({
            accessToken: 'tok-c82-slotkey',
            expiresAt: Date.now() + 600_000,
            sub: 's-c82',
            displayName: 'C82Tester',
          });
          assert.equal(
            regMod.computeSlotKeyForSnapshot({
              id: 'sample_capy_forest',
              sampleAssetPath: './assets/capy_forest.webp',
              sourceRef: { kind: 'sample', uri: './assets/capy_forest.webp' },
            }),
            'sample_assets_capy_forest_webp',
            'computeSlotKeyForSnapshot must strip leading ./ to produce canonical slotKey'
          );
          const cloudSyncHookSrc7l = fs.readFileSync(
            path.join(WEB_ROOT, 'src/hooks/useCloudSyncController.ts'),
            'utf8'
          );
          const appSrc7l = fs.readFileSync(path.join(WEB_ROOT, 'src/App.tsx'), 'utf8');
          assert.match(
            cloudSyncHookSrc7l,
            /import\s*\{[^}]*\bcomputeSlotKeyForSnapshot\b[^}]*\}\s*from\s*'\.\.\/services\/(?:cloud\/slotKey|providers\/ProviderRegistry)'/,
            'useCloudSyncController.ts must import computeSlotKeyForSnapshot'
          );
          assert.match(
            cloudSyncHookSrc7l,
            /const slotKey = computeSlotKeyForSnapshot\(/,
            'useCloudSyncController.ts must compute active slotKey via computeSlotKeyForSnapshot'
          );
          assert.equal(
            cloudSyncHookSrc7l.includes('sample_${startSampleUri.replace') ||
              appSrc7l.includes('sample_${startSampleUri.replace'),
            false,
            'Cloud sync controller and App.tsx must not diverge with inline sample_ slotKey string formatting'
          );

          const remoteResetToken = await codecMod.encodeProgressDeltaToken({
            version: 2,
            sourceRef: { kind: 'sample', uri: './assets/capy_forest.webp' },
            filledRegionIds: [],
            resetEpoch: 1,
            updatedAt: 1700000005000,
          });
          globalThis.fetch = async (url, init) => {
            const sUrl = String(url);
            if (sUrl.includes('spaces=appDataFolder')) {
              return new Response(
                JSON.stringify({ files: [{ id: 'c82_manifest_id', name: 'capy_cloud_manifest_v2.json' }] }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
              );
            }
            if (sUrl.includes('c82_manifest_id') && (!init?.method || init.method === 'GET')) {
              return new Response(
                JSON.stringify({
                  version: 2,
                  updatedAt: 1700000005000,
                  providerId: 'google',
                  entries: {
                    sample_assets_capy_forest_webp: {
                      snapshotId: 'sample_capy_forest',
                      slotKey: 'sample_assets_capy_forest_webp',
                      title: 'Capy Forest',
                      createdAt: 1000,
                      lastOpened: 2000,
                      filledCount: 0,
                      totalCount: 50,
                      resetEpoch: 1,
                      deltaToken: remoteResetToken,
                      sampleAssetPath: './assets/capy_forest.webp',
                      sourceRef: { kind: 'sample', uri: './assets/capy_forest.webp' },
                    },
                  },
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
              );
            }
            return new Response(JSON.stringify({ id: 'c82_manifest_id', name: 'capy_cloud_manifest_v2.json' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          };
          const canonicalSlotKey = regMod.computeSlotKeyForSnapshot({
            id: 'sample_capy_forest',
            sampleAssetPath: './assets/capy_forest.webp',
            sourceRef: { kind: 'sample', uri: './assets/capy_forest.webp' },
          });
          const syncRes = await regMod.ProviderRegistry.cloudSave.syncProgress(
            canonicalSlotKey,
            'Capy Forest',
            {
              version: 2,
              sourceRef: { kind: 'sample', uri: './assets/capy_forest.webp' },
              filledRegionIds: [1, 2, 3],
              updatedAt: 1700000004000,
            },
            50
          );
          assert.equal(syncRes.mergedDelta.resetEpoch, 1, 'Canonical slotKey syncProgress must adopt remote resetEpoch=1');
          assert.deepEqual(syncRes.mergedDelta.filledRegionIds, [], 'Canonical slotKey syncProgress must not resurrect stale epoch-0 progress');
        }

        // 7m. C8-3 regression: PlayGamesAndroidDriver.readBinaryBlob must require pgblob_ prefix and isManifestCloudSnapshotSlot filters chunk slots
        {
          let unexpectedPullAttempts = 0;
          globalThis.window.CapyAndroid = {
            isPlayGamesConfigured: () => true,
            loadCloudBinaryChunk: () => null,
            requestCloudSnapshotPull: () => {
              unexpectedPullAttempts++;
              return false;
            },
          };
          nbMod.NativeBridge.attachWindowCallbacks();
          const pgPrefixDriver = new driversMod.PlayGamesAndroidDriver();
          assert.equal(
            await pgPrefixDriver.readBinaryBlob('pgblob:capy_cloud_manifest_v2:1:16'),
            null,
            'readBinaryBlob must reject arbitrary non-pgblob_ keys before issuing chunk pulls'
          );
          assert.equal(
            await pgPrefixDriver.readBinaryBlob('pgblob:pgblob_:1:16'),
            null,
            'readBinaryBlob must reject bare pgblob_ prefix with empty suffix'
          );
          assert.equal(
            unexpectedPullAttempts,
            0,
            'Rejected non-pgblob_ refs must never invoke requestCloudSnapshotPull'
          );
          for (const chunkSlot of ['pgblob_x', 'pgblob_abc_part_0', 'manifest_part_1', 'slot_part_12']) {
            assert.equal(
              syncCoordMod.isManifestCloudSnapshotSlot(chunkSlot),
              false,
              `isManifestCloudSnapshotSlot must exclude chunk slot ${chunkSlot}`
            );
          }
          assert.equal(
            syncCoordMod.isManifestCloudSnapshotSlot('capy_cloud_manifest_v2'),
            true,
            'isManifestCloudSnapshotSlot must allow manifest slot'
          );
        }
      } finally {
        globalThis.fetch = prevFetch;
        if (prevSs === undefined) delete globalThis.sessionStorage;
        else globalThis.sessionStorage = prevSs;
        if (prevLs === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = prevLs;
        if (prevWin === undefined) delete globalThis.window;
        else globalThis.window = prevWin;
      }
    }
}
