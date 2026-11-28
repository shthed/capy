/**
 * [Unit 16] M4 $0 BYOC Cloud Sync (PKCE S256, Microsoft OneDrive, Apple CloudKit, Auto-Sync Scheduler & Cross-Provider CRDT).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export async function runByocCloudSyncTests({ vite, projectRoot, logUnitStart, logUnitPass }) {
    logUnitStart('M4 $0 BYOC Cloud Sync (PKCE S256, Microsoft OneDrive, Apple CloudKit, Auto-Sync Scheduler & Cross-Provider CRDT)');
    {
      const pkceMod = await vite.ssrLoadModule('/src/services/providers/OAuthPkceHelper.ts');
      const msClientMod = await vite.ssrLoadModule('/src/services/providers/MicrosoftCloudSyncClient.ts');
      const appleClientMod = await vite.ssrLoadModule('/src/services/providers/AppleCloudSyncClient.ts');
      const driversMod = await vite.ssrLoadModule('/src/services/providers/CloudProviderDrivers.ts');
      const coordMod = await vite.ssrLoadModule('/src/services/cloudSyncCoordinator.ts');
      const codecMod = await vite.ssrLoadModule('/src/services/CapyCodec.ts');

      // 1. PKCE S256 verifier/challenge (RFC 7636 known vector) + state CSRF validation
      const rfcVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const rfcChallenge = await pkceMod.derivePkceCodeChallenge(rfcVerifier);
      assert.equal(
        rfcChallenge,
        'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        'PKCE S256 challenge must match RFC 7636 Appendix B test vector'
      );
      const genVerifier = pkceMod.generatePkceCodeVerifier(32);
      assert.equal(genVerifier.length >= 43 && genVerifier.length <= 128, true, 'PKCE verifier length must be 43..128');
      const genState = pkceMod.generateOAuthState(24);
      assert.equal(pkceMod.validateOAuthCallbackState(genState, genState), true);
      assert.equal(pkceMod.validateOAuthCallbackState(genState, `${genState}_tampered`), false);
      const authUrl = pkceMod.buildOAuthAuthorizeUrl({
        authorizeEndpoint: msClientMod.MICROSOFT_AUTHORIZE_ENDPOINT,
        clientId: 'ms-client-id-123',
        redirectUri: pkceMod.ANDROID_OAUTH_REDIRECT_URI,
        scope: msClientMod.MICROSOFT_OAUTH_SCOPES,
        state: genState,
        codeChallenge: rfcChallenge,
      });
      const parsedAuth = new URL(authUrl);
      assert.equal(parsedAuth.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(parsedAuth.searchParams.get('code_challenge'), rfcChallenge);
      assert.equal(parsedAuth.searchParams.get('redirect_uri'), 'capypaint://oauth/callback');
      const parsedCb = pkceMod.parseOAuthCallbackUrl(
        `capypaint://oauth/callback?code=auth_999&state=${encodeURIComponent(genState)}`
      );
      assert.equal(parsedCb?.code, 'auth_999');
      assert.equal(parsedCb?.state, genState);

      // 2. MicrosoftCloudDriver CRUD, per-filename write mutex, and path traversal rejection
      const prevWin = globalThis.window;
      const prevSession = globalThis.sessionStorage;
      const prevLocal = globalThis.localStorage;
      const memSession = new Map();
      const memLocal = new Map();
      globalThis.sessionStorage = {
        getItem: (k) => memSession.get(k) ?? null,
        setItem: (k, v) => memSession.set(k, String(v)),
        removeItem: (k) => memSession.delete(k),
        clear: () => memSession.clear(),
      };
      globalThis.localStorage = {
        getItem: (k) => memLocal.get(k) ?? null,
        setItem: (k, v) => memLocal.set(k, String(v)),
        removeItem: (k) => memLocal.delete(k),
        clear: () => memLocal.clear(),
      };
      globalThis.window = {
        location: { hostname: 'localhost', search: '?debug=1', origin: 'http://localhost:3000', pathname: '/' },
        __capyMockMicrosoftOAuthToken: 'mock_ms_token_unit_123',
        __capyMockAppleCloudSession: {
          userId: 'apple_unit_001',
          displayName: 'Apple Unit Tester',
          email: 'apple.unit@example.com',
        },
      };

      try {
        const oneDriveFiles = new Map();
        const writeOrder = [];
        const mockGraphFetch = async (url, init = {}) => {
          const urlStr = String(url);
          const match = /\/special\/approot:\/([^:/]+):\/content$/.exec(urlStr);
          if (!match) {
            return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
          }
          const fileName = decodeURIComponent(match[1]);
          if (init.method === 'PUT') {
            writeOrder.push(`start:${fileName}:${oneDriveFiles.size}`);
            await new Promise((r) => setTimeout(r, 10));
            const rawBody = init.body;
            if (typeof rawBody === 'string') {
              oneDriveFiles.set(fileName, rawBody);
            } else {
              oneDriveFiles.set(fileName, new Uint8Array(rawBody));
            }
            writeOrder.push(`end:${fileName}`);
            return { ok: true, status: 200, json: async () => ({ id: fileName }) };
          }
          if (!oneDriveFiles.has(fileName)) {
            return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
          }
          const stored = oneDriveFiles.get(fileName);
          if (typeof stored === 'string') {
            return { ok: true, status: 200, json: async () => JSON.parse(stored) };
          }
          return { ok: true, status: 200, arrayBuffer: async () => stored.buffer.slice(stored.byteOffset, stored.byteOffset + stored.byteLength) };
        };

        const msDriver = new driversMod.MicrosoftCloudDriver({ fetchImpl: mockGraphFetch });
        assert.equal(msDriver.getDescriptor().isSupported, true);
        assert.equal(msDriver.getDescriptor().isConfigured, true);
        const msProfile = await msDriver.signIn();
        assert.equal(msProfile.provider, 'microsoft');
        assert.equal(msProfile.email, 'capy.ms@example.com');
        assert.equal(msDriver.hasActiveSession(), true);

        // Traversal filenames strictly rejected
        assert.equal(msClientMod.isValidOneDriveFileName('../secret.json'), false);
        assert.equal(msClientMod.isValidOneDriveFileName('dir/file.json'), false);
        assert.equal(msClientMod.isValidOneDriveFileName('foo:bar.json'), false);
        assert.equal(await msDriver.readBinaryBlob('../secret.capy'), null);
        assert.equal(await msDriver.writeBinaryBlob('slot1', '../evil.capy', new Uint8Array([1, 2])), null);

        // Per-filename write mutex serializes overlapping manifest writes
        const manifest1 = { version: 2, updatedAt: 1000, devicePlayerId: 'dev_a', providerId: 'microsoft', entries: {} };
        const manifest2 = { version: 2, updatedAt: 2000, devicePlayerId: 'dev_b', providerId: 'microsoft', entries: {} };
        const [w1, w2] = await Promise.all([
          msDriver.writeManifest(manifest1),
          msDriver.writeManifest(manifest2),
        ]);
        assert.equal(w1, true);
        assert.equal(w2, true);
        assert.equal(writeOrder[0].startsWith('start:capy_cloud_manifest_v2.json'), true);
        assert.equal(writeOrder[1], 'end:capy_cloud_manifest_v2.json');
        assert.equal(writeOrder[2].startsWith('start:capy_cloud_manifest_v2.json'), true);
        const readBackManifest = await msDriver.readManifest();
        assert.equal(readBackManifest?.updatedAt, 2000);

        // Slot envelope + binary blob CRUD
        const slotEnv = {
          slotKey: 'sample_capybara',
          title: 'Capybara',
          deltaToken: 'tok_ms',
          filledCount: 3,
          totalCount: 10,
          updatedAt: 2500,
          devicePlayerId: 'dev_b',
        };
        assert.equal(await msDriver.writeSlotEnvelope(slotEnv), true);
        const readSlot = await msDriver.readSlotEnvelope('sample_capybara');
        assert.equal(readSlot?.deltaToken, 'tok_ms');
        const blobBytes = new Uint8Array([67, 65, 80, 89, 2, 1, 9, 8]);
        const blobRef = await msDriver.writeBinaryBlob('slot1', 'capy_save_slot1.capy', blobBytes);
        assert.equal(blobRef, 'capy_save_slot1.capy');
        const readBlob = await msDriver.readBinaryBlob('capy_save_slot1.capy');
        assert.deepEqual(Array.from(readBlob || []), Array.from(blobBytes));
        await msDriver.signOut();
        assert.equal(msDriver.hasActiveSession(), false);

        // 3. AppleCloudDriver CRUD, mock session & traversal rejection
        appleClientMod.clearMockAppleRecordStore();
        const appleDriver = new driversMod.AppleCloudDriver();
        assert.equal(appleDriver.getDescriptor().isSupported, true);
        assert.equal(appleDriver.getDescriptor().isConfigured, true);
        const appleProfile = await appleDriver.signIn();
        assert.equal(appleProfile.provider, 'apple');
        assert.equal(appleProfile.email, 'apple.unit@example.com');
        assert.equal(appleDriver.hasActiveSession(), true);
        assert.equal(appleClientMod.isValidCloudKitRecordName('../evil.json'), false);
        assert.equal(await appleDriver.writeBinaryBlob('s1', '../evil.capy', blobBytes), null);
        assert.equal(await appleDriver.writeManifest(manifest2), true);
        const appleManifest = await appleDriver.readManifest();
        assert.equal(appleManifest?.updatedAt, 2000);
        const appleBlobRef = await appleDriver.writeBinaryBlob('s1', 'capy_save_apple.capy', blobBytes);
        assert.equal(appleBlobRef, 'capy_save_apple.capy');
        const readAppleBlob = await appleDriver.readBinaryBlob('capy_save_apple.capy');
        assert.deepEqual(Array.from(readAppleBlob || []), Array.from(blobBytes));
        await appleDriver.signOut();
        assert.equal(appleDriver.hasActiveSession(), false);

        // 4. createAutoCloudSyncScheduler debounce, visibilitychange, online & unauthenticated no-op
        let fakeNow = 100_000;
        let nextTimerId = 1;
        const timers = new Map();
        let canSyncFlag = false;
        let syncCalls = 0;
        const scheduler = coordMod.createAutoCloudSyncScheduler({
          sync: async () => {
            syncCalls += 1;
          },
          canSync: () => canSyncFlag,
          debounceMs: 15_000,
          staleVisibilityMs: 30_000,
          now: () => fakeNow,
          setTimer: (cb, ms) => {
            const id = nextTimerId++;
            timers.set(id, { cb, fireAt: fakeNow + ms });
            return id;
          },
          clearTimer: (id) => {
            timers.delete(id);
          },
        });
        // Strictly no-op when unauthenticated / offline
        scheduler.notifyLocalMutation();
        scheduler.notifyVisibilityVisible();
        scheduler.notifyOnline();
        assert.equal(timers.size, 0, 'Unauthenticated scheduler must not arm timers');
        assert.equal(syncCalls, 0, 'Unauthenticated scheduler must not trigger sync');

        // Authenticated: 3 rapid mutations coalesce into a single 15s debounced sync
        canSyncFlag = true;
        scheduler.notifyLocalMutation();
        scheduler.notifyLocalMutation();
        scheduler.notifyLocalMutation();
        assert.equal(timers.size, 1, 'Rapid local mutations must coalesce into 1 debounce timer');
        const firstEntry = [...timers.values()][0];
        fakeNow = firstEntry.fireAt;
        timers.clear();
        firstEntry.cb();
        await Promise.resolve();
        assert.equal(syncCalls, 1, 'Debounced mutation must trigger exactly 1 sync');

        // Visibility visible before 30s stale window -> no-op; after 30s -> triggers sync
        fakeNow += 10_000;
        scheduler.notifyVisibilityVisible();
        await Promise.resolve();
        assert.equal(syncCalls, 1, 'Visibility change within 30s stale threshold must not re-sync');
        fakeNow += 25_000;
        scheduler.notifyVisibilityVisible();
        await Promise.resolve();
        assert.equal(syncCalls, 2, 'Visibility change after 30s stale threshold must trigger sync');

        // Online reconnect triggers immediate sync & cancels pending debounce
        scheduler.notifyLocalMutation();
        assert.equal(timers.size, 1);
        scheduler.notifyOnline();
        await Promise.resolve();
        assert.equal(timers.size, 0, 'Online reconnect must cancel pending debounce timer');
        assert.equal(syncCalls, 3, 'Online reconnect must trigger immediate sync');

        scheduler.dispose();
        scheduler.notifyLocalMutation();
        assert.equal(timers.size, 0, 'Disposed scheduler must never schedule new timers');

        // 5. Cross-provider CRDT merge parity (Google Drive <-> Microsoft OneDrive <-> Apple iCloud)
        const googleDelta = {
          filledRegionIds: [1, 2, 5],
          paintedRegionColors: { 5: 0xffff0000 },
          updatedAt: 1000,
          resetEpoch: 1,
        };
        const msDelta = {
          filledRegionIds: [2, 3, 6],
          paintedRegionColors: { 5: 0xff00ff00, 6: 0xff0000ff },
          updatedAt: 2000,
          resetEpoch: 1,
        };
        const mergedAB = codecMod.mergeProgressDeltas(googleDelta, msDelta);
        const mergedBA = codecMod.mergeProgressDeltas(msDelta, googleDelta);
        assert.deepEqual([...mergedAB.filledRegionIds].sort((a, b) => a - b), [1, 2, 3, 5, 6]);
        assert.deepEqual([...mergedBA.filledRegionIds].sort((a, b) => a - b), [1, 2, 3, 5, 6]);
        assert.equal(mergedAB.paintedRegionColors[5], 0xff00ff00, 'Newer updatedAt must win LWW custom color');
        assert.equal(mergedBA.paintedRegionColors[5], 0xff00ff00, 'CRDT merge must be commutative across providers');

        // 6. Tombstone clock-skew tolerance (within, equal, outside tolerance + syncFullLibrary & telemetry)
        const syncMod = await vite.ssrLoadModule('/src/services/cloud/CloudLibrarySyncOrchestrator.ts');
        const authMod = await vite.ssrLoadModule('/src/services/auth/AuthManager.ts');
        const storageMod = await vite.ssrLoadModule('/src/services/StorageService.ts');
        const telemetryMod = await vite.ssrLoadModule('/src/services/telemetry.ts');
        const slotKeyMod = await vite.ssrLoadModule('/src/services/cloud/slotKey.ts');
        const keysMod = await vite.ssrLoadModule('/src/services/storage/StorageKeys.ts');
        const safeStoreMod = await vite.ssrLoadModule('/src/services/storage/SafeLocalStore.ts');

        try {
          assert.equal(
            syncMod.TOMBSTONE_SKEW_TOLERANCE_MS,
            10 * 60 * 1000,
            'TOMBSTONE_SKEW_TOLERANCE_MS must equal 10 minutes (600,000 ms)'
          );
          const tol = syncMod.TOMBSTONE_SKEW_TOLERANCE_MS;
          const baseDeletedAt = Date.now();
          const probeTombstones = { sample_assets_capybara_webp: baseDeletedAt };

          // Pure helper: strictly within tolerance -> NOT tombstoned
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', baseDeletedAt - tol + 1, probeTombstones),
            false,
            'Timestamp strictly within 10-minute skew tolerance must not be tombstoned'
          );
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', baseDeletedAt - 60_000, probeTombstones),
            false,
            'Timestamp 1 minute before tombstone must not be tombstoned'
          );
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', baseDeletedAt, probeTombstones),
            false,
            'Timestamp equal to tombstone must be preserved within skew tolerance'
          );
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', baseDeletedAt + 1, probeTombstones),
            false,
            'Timestamp 1 ms newer than tombstone must not be tombstoned'
          );
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', baseDeletedAt + 5_000, probeTombstones),
            false,
            'Timestamp strictly newer than tombstone must not be tombstoned'
          );
          // Pure helper: exactly equal to tolerance boundary -> tombstoned
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', baseDeletedAt - tol, probeTombstones),
            true,
            'Timestamp at exact tolerance boundary (deletedAt - tolerance) must be tombstoned'
          );
          // Pure helper: strictly outside tolerance -> tombstoned
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', baseDeletedAt - tol - 1, probeTombstones),
            true,
            'Timestamp 1 ms older than tolerance boundary must be tombstoned'
          );
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', baseDeletedAt - tol - 300_000, probeTombstones),
            true,
            'Timestamp 15 minutes older than tombstone must be tombstoned'
          );
          // Pure helper: itemTimestamp edge cases (0, negative, non-finite)
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', 0, probeTombstones),
            true,
            'Zero itemTimestamp must be tombstoned by valid epoch deletedAt'
          );
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', -1, probeTombstones),
            true,
            'Negative itemTimestamp must be tombstoned by valid epoch deletedAt'
          );
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', Number.NaN, probeTombstones),
            false
          );
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', Number.POSITIVE_INFINITY, probeTombstones),
            false
          );
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', Number.NEGATIVE_INFINITY, probeTombstones),
            false
          );
          // Pure helper: invalid deletedAt (0, negative, NaN, Infinity, -Infinity) -> NOT tombstoned (even with toleranceMs = 0)
          for (const badDeletedAt of [0, -100, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
            const badMap = { slot_bad: badDeletedAt };
            assert.equal(
              syncMod.isSlotTombstonedForTimestamp('slot_bad', 0, badMap),
              false,
              `Invalid deletedAt=${String(badDeletedAt)} must never tombstone (default tolerance)`
            );
            assert.equal(
              syncMod.isSlotTombstonedForTimestamp('slot_bad', 0, badMap, 0),
              false,
              `Invalid deletedAt=${String(badDeletedAt)} must never tombstone (zero tolerance)`
            );
          }
          // Pure helper: custom toleranceMs (0, positive, negative/NaN/Infinity fallback)
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', baseDeletedAt, probeTombstones, 0),
            true,
            'Zero tolerance must tombstone itemTimestamp === deletedAt'
          );
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', baseDeletedAt - 1, probeTombstones, 0),
            true,
            'Zero tolerance must tombstone itemTimestamp < deletedAt'
          );
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', baseDeletedAt + 1, probeTombstones, 0),
            false,
            'Zero tolerance must not tombstone itemTimestamp > deletedAt'
          );
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', baseDeletedAt - 29_999, probeTombstones, 30_000),
            false,
            'Custom positive tolerance must preserve timestamps within custom window'
          );
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', baseDeletedAt - 30_000, probeTombstones, 30_000),
            true,
            'Custom positive tolerance must tombstone timestamps at exact custom boundary'
          );
          for (const badTol of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
            assert.equal(
              syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', baseDeletedAt - tol + 1, probeTombstones, badTol),
              false,
              `Invalid toleranceMs=${String(badTol)} must fall back to TOMBSTONE_SKEW_TOLERANCE_MS (within)`
            );
            assert.equal(
              syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', baseDeletedAt - tol, probeTombstones, badTol),
              true,
              `Invalid toleranceMs=${String(badTol)} must fall back to TOMBSTONE_SKEW_TOLERANCE_MS (boundary)`
            );
          }
          // Pure helper: missing slot, nullish map, prototype keys -> NOT tombstoned
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('unknown_slot', baseDeletedAt - tol - 10_000, probeTombstones),
            false
          );
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', 0, null),
            false
          );
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('sample_assets_capybara_webp', 0, undefined),
            false
          );
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('__proto__', 0, probeTombstones, 0),
            false
          );
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('toString', 0, probeTombstones, 0),
            false
          );
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('constructor', 0, probeTombstones, 0),
            false
          );
          const nullProtoTombstones = Object.assign(Object.create(null), { save_null_proto: baseDeletedAt });
          assert.equal(
            syncMod.isSlotTombstonedForTimestamp('save_null_proto', baseDeletedAt - tol, nullProtoTombstones),
            true,
            'Null-prototype tombstone map must still be evaluated via Object.prototype.hasOwnProperty'
          );

          const ACCOUNT_SCOPE = 'microsoft_local_user_1';
          const makeMockSnapshot = ({
            snapId,
            timestamp,
            lastOpened,
            filledRegionIds = [1, 2],
          }) => ({
            id: snapId,
            title: `Skew ${snapId}`,
            timestamp,
            lastOpened,
            difficulty: 'EASY',
            filledCount: filledRegionIds.length,
            totalCount: 10,
            filledRegionIds,
            zoomScale: 1,
            panOffsetX: 0,
            panOffsetY: 0,
            resetEpoch: 0,
            previewDataUrl: '',
          });

          const createMockOrchestratorHarness = ({
            initialRemoteManifest = null,
            onReadManifest,
            onReadBinaryBlob,
            onWriteBinaryBlob,
            jsonRoundTrip = false,
          } = {}) => {
            let remoteManifest = initialRemoteManifest;
            let pushedManifest = null;
            const identity = {
              playerId: 'local_user_1',
              displayName: 'Local User',
              email: 'local.user@example.com',
              avatarColorHex: '#3b82f6',
              provider: 'microsoft',
              isAuthenticated: true,
            };
            const mockDriver = {
              id: 'microsoft',
              getDescriptor: () => ({
                id: 'microsoft',
                displayName: 'Microsoft OneDrive',
                storageName: 'Microsoft OneDrive (Mock)',
                isSupported: true,
                isConfigured: true,
              }),
              hasActiveSession: () => true,
              restoreSession: () => identity,
              attemptAutoSignIn: async () => identity,
              getCachedIdentity: () => identity,
              signIn: async () => identity,
              signOut: async () => {},
              readManifest: async () => {
                if (onReadManifest) {
                  await onReadManifest();
                }
                if (!remoteManifest) return null;
                return jsonRoundTrip
                  ? JSON.parse(JSON.stringify(remoteManifest))
                  : remoteManifest;
              },
              writeManifest: async (m) => {
                const persisted = jsonRoundTrip ? JSON.parse(JSON.stringify(m)) : m;
                pushedManifest = persisted;
                remoteManifest = persisted;
                return true;
              },
              readSlotEnvelope: async () => null,
              writeSlotEnvelope: async () => true,
              readBinaryBlob: async (ref) =>
                onReadBinaryBlob ? await onReadBinaryBlob(ref) : null,
              writeBinaryBlob: async (slotKey, fileName, bytes) =>
                onWriteBinaryBlob ? await onWriteBinaryBlob(slotKey, fileName, bytes) : null,
            };

            const authMgr = new authMod.MultiProviderAuthManager();
            authMgr.registerDriver(mockDriver);
            return {
              authMgr,
              getRemoteManifest: () => remoteManifest,
              setRemoteManifest: (m) => {
                remoteManifest = m;
              },
              getPushedManifest: () => pushedManifest,
              init: async () => {
                await authMgr.signInWithProvider('microsoft');
                return new syncMod.CloudLibrarySyncOrchestrator(authMgr);
              },
            };
          };

          const getSkewTelemetryEvents = () =>
            telemetryMod
              .getSwallowedErrorLog()
              .filter((r) => r.scope === 'CloudLibrarySyncOrchestrator.tombstoneSkewToleranceKeptSnapshot');

          // End-to-end syncFullLibrary reconciliation helper
          const runTombstoneSyncScenario = async ({
            snapId,
            snapTs,
            timestamp = snapTs,
            lastOpened = snapTs,
            deletedAt,
            seedLocalTombstone = false,
          }) => {
            memLocal.clear();
            memSession.clear();
            telemetryMod.clearSwallowedErrorLog();

            const slotKey = `save_${snapId}`;
            const snap = makeMockSnapshot({ snapId, timestamp, lastOpened });
            storageMod.StorageService.saveSnapshots([snap]);

            if (seedLocalTombstone) {
              slotKeyMod.recordLocalSlotTombstone(slotKey, deletedAt);
              slotKeyMod.recordLocalSlotTombstone(slotKey, deletedAt, ACCOUNT_SCOPE);
            }

            const harness = createMockOrchestratorHarness({
              initialRemoteManifest: {
                version: 2,
                updatedAt: deletedAt,
                devicePlayerId: 'remote_device',
                providerId: 'microsoft',
                entries: {},
                tombstones: { [slotKey]: deletedAt },
              },
            });
            const orchestrator = await harness.init();
            await orchestrator.syncFullLibrary(storageMod.StorageService.loadSnapshots());

            const surviving = storageMod.StorageService.loadSnapshots();
            const telemetryEvents = getSkewTelemetryEvents();
            const persistedTombstones = slotKeyMod.readLocalSlotTombstones(ACCOUNT_SCOPE);
            const unscopedTombstones = slotKeyMod.readLocalSlotTombstones();
            return {
              surviving,
              pushedManifest: harness.getPushedManifest(),
              telemetryEvents,
              persistedTombstones,
              unscopedTombstones,
              slotKey,
            };
          };

          const refDeletedAt = Math.floor(Date.now() - 120_000);
          // (a1) Within tolerance (5 min skew): snapshot kept, tombstone cleared, exact non-PII telemetry emitted
          const withinRes = await runTombstoneSyncScenario({
            snapId: 'skew_within',
            snapTs: refDeletedAt - 5 * 60 * 1000,
            deletedAt: refDeletedAt,
          });
          assert.equal(
            withinRes.surviving.some((s) => s.id === 'skew_within'),
            true,
            'Snapshot within 10-minute skew tolerance must be preserved'
          );
          assert.equal(
            withinRes.pushedManifest?.tombstones?.[withinRes.slotKey],
            undefined,
            'Cleared tombstone must not remain in pushed cloud manifest'
          );
          assert.equal(
            withinRes.persistedTombstones[withinRes.slotKey],
            undefined,
            'Cleared tombstone must not remain in local tombstone store'
          );
          assert.equal(
            withinRes.telemetryEvents.length,
            1,
            'Tolerance preservation must emit exactly 1 telemetry record'
          );
          assert.deepEqual(
            withinRes.telemetryEvents[0].context,
            {
              slotKey: withinRes.slotKey,
              snapTs: refDeletedAt - 5 * 60 * 1000,
              deletedAt: refDeletedAt,
              skewMs: 5 * 60 * 1000,
              toleranceMs: tol,
            },
            'Telemetry context must contain exact non-PII skew fields and zero PII fields'
          );

          // (a2) snapTs === deletedAt (skewMs === 0): preserved, tombstone cleared, telemetry emitted
          const eqZeroSkewRes = await runTombstoneSyncScenario({
            snapId: 'skew_zero',
            snapTs: refDeletedAt,
            deletedAt: refDeletedAt,
          });
          assert.equal(eqZeroSkewRes.surviving.some((s) => s.id === 'skew_zero'), true);
          assert.equal(eqZeroSkewRes.pushedManifest?.tombstones?.[eqZeroSkewRes.slotKey], undefined);
          assert.equal(eqZeroSkewRes.telemetryEvents.length, 1);
          assert.equal(eqZeroSkewRes.telemetryEvents[0].context?.skewMs, 0);

          // (a3) snapTs === deletedAt - tol + 1 (skewMs === tol - 1): preserved, tombstone cleared, telemetry emitted
          const innerEdgeRes = await runTombstoneSyncScenario({
            snapId: 'skew_inner_edge',
            snapTs: refDeletedAt - tol + 1,
            deletedAt: refDeletedAt,
          });
          assert.equal(innerEdgeRes.surviving.some((s) => s.id === 'skew_inner_edge'), true);
          assert.equal(innerEdgeRes.pushedManifest?.tombstones?.[innerEdgeRes.slotKey], undefined);
          assert.equal(innerEdgeRes.telemetryEvents.length, 1);
          assert.equal(innerEdgeRes.telemetryEvents[0].context?.skewMs, tol - 1);

          // (b) Strictly newer than tombstone (+1 ms and +1 min): snapshot kept, tombstone cleared, 0 skew telemetry
          const newerOneMsRes = await runTombstoneSyncScenario({
            snapId: 'skew_newer_1ms',
            snapTs: refDeletedAt + 1,
            deletedAt: refDeletedAt,
          });
          assert.equal(newerOneMsRes.surviving.some((s) => s.id === 'skew_newer_1ms'), true);
          assert.equal(newerOneMsRes.pushedManifest?.tombstones?.[newerOneMsRes.slotKey], undefined);
          assert.equal(
            newerOneMsRes.telemetryEvents.length,
            0,
            'Snapshot 1 ms newer than tombstone must not emit skew-tolerance telemetry'
          );

          const newerRes = await runTombstoneSyncScenario({
            snapId: 'skew_newer',
            snapTs: refDeletedAt + 60_000,
            deletedAt: refDeletedAt,
          });
          assert.equal(
            newerRes.surviving.some((s) => s.id === 'skew_newer'),
            true,
            'Snapshot newer than tombstone must be preserved'
          );
          assert.equal(newerRes.pushedManifest?.tombstones?.[newerRes.slotKey], undefined);
          assert.equal(
            newerRes.telemetryEvents.length,
            0,
            'Strictly newer snapshot must not emit skew-tolerance telemetry'
          );

          // (c) Equal to tolerance boundary (10 min exact) and outside tolerance (15 min old):
          // snapshot deleted, exact historical deletedAt preserved (not inflated), 0 skew telemetry
          const equalRes = await runTombstoneSyncScenario({
            snapId: 'skew_equal',
            snapTs: refDeletedAt - tol,
            deletedAt: refDeletedAt,
          });
          assert.equal(
            equalRes.surviving.some((s) => s.id === 'skew_equal'),
            false,
            'Snapshot at exact 10-minute boundary must be deleted by tombstone'
          );
          assert.equal(
            equalRes.pushedManifest?.tombstones?.[equalRes.slotKey],
            refDeletedAt,
            'Tombstone at exact boundary must preserve exact historical deletedAt without inflation'
          );
          assert.equal(equalRes.telemetryEvents.length, 0);

          const outsideRes = await runTombstoneSyncScenario({
            snapId: 'skew_outside',
            snapTs: refDeletedAt - 15 * 60 * 1000,
            deletedAt: refDeletedAt,
          });
          assert.equal(
            outsideRes.surviving.some((s) => s.id === 'skew_outside'),
            false,
            'Snapshot older than 10-minute tolerance must be deleted by tombstone'
          );
          assert.equal(
            outsideRes.pushedManifest?.tombstones?.[outsideRes.slotKey],
            refDeletedAt,
            'Tombstone outside tolerance must preserve exact historical deletedAt without inflation'
          );
          assert.equal(outsideRes.telemetryEvents.length, 0);

          // (d) Math.max(lastOpened, timestamp) precedence
          const lastOpenedWinsRes = await runTombstoneSyncScenario({
            snapId: 'skew_last_opened_wins',
            timestamp: refDeletedAt - 20 * 60 * 1000,
            lastOpened: refDeletedAt - 60_000,
            deletedAt: refDeletedAt,
          });
          assert.equal(
            lastOpenedWinsRes.surviving.some((s) => s.id === 'skew_last_opened_wins'),
            true,
            'Recent lastOpened must preserve snapshot even when creation timestamp is outside tolerance'
          );
          assert.equal(lastOpenedWinsRes.telemetryEvents.length, 1);
          assert.equal(lastOpenedWinsRes.telemetryEvents[0].context?.snapTs, refDeletedAt - 60_000);

          const timestampWinsRes = await runTombstoneSyncScenario({
            snapId: 'skew_timestamp_wins',
            timestamp: refDeletedAt - 60_000,
            lastOpened: 0,
            deletedAt: refDeletedAt,
          });
          assert.equal(
            timestampWinsRes.surviving.some((s) => s.id === 'skew_timestamp_wins'),
            true,
            'Recent timestamp must preserve snapshot when lastOpened is 0'
          );
          assert.equal(timestampWinsRes.telemetryEvents.length, 1);
          assert.equal(timestampWinsRes.telemetryEvents[0].context?.snapTs, refDeletedAt - 60_000);

          // (e) Same-device delete within 10 minutes: must NOT resurrect from remote manifest
          {
            memLocal.clear();
            memSession.clear();
            telemetryMod.clearSwallowedErrorLog();

            const now = Date.now();
            const snap = makeMockSnapshot({
              snapId: 'same_device_del',
              timestamp: now - 10_000,
              lastOpened: now - 10_000,
            });
            const slotKey = 'save_same_device_del';
            storageMod.StorageService.saveSnapshots([snap]);

            const harness = createMockOrchestratorHarness();
            const orchestrator = await harness.init();
            await orchestrator.syncFullLibrary([snap]);
            assert.ok(
              harness.getPushedManifest()?.entries?.[slotKey],
              'Initial sync must push snapshot to remote manifest'
            );

            await storageMod.StorageService.deleteSnapshot(snap.id);
            // Simulate stale remote manifest that still holds the 10-second-old entry without tombstone
            const staleRemote = structuredClone(harness.getRemoteManifest());
            staleRemote.entries[slotKey].lastOpened = now - 10_000;
            delete staleRemote.tombstones;
            harness.setRemoteManifest(staleRemote);

            await orchestrator.syncFullLibrary([]);
            assert.equal(
              storageMod.StorageService.loadSnapshots().some((s) => s.id === snap.id),
              false,
              'Same-device delete within 10 minutes must NOT resurrect from remote manifest'
            );
            assert.equal(
              harness.getPushedManifest()?.entries?.[slotKey],
              undefined,
              'Same-device deleted entry must be omitted from pushed manifest'
            );
            assert.ok(
              (harness.getPushedManifest()?.tombstones?.[slotKey] ?? 0) > 0,
              'Same-device delete tombstone must be pushed to remote manifest'
            );
            assert.equal(
              getSkewTelemetryEvents().length,
              0,
              'Same-device delete must not emit skew-tolerance telemetry'
            );
          }

          // (f) Mid-sync delete within 10 minutes: deleted while readManifest() is in-flight
          {
            memLocal.clear();
            memSession.clear();
            telemetryMod.clearSwallowedErrorLog();

            const now = Date.now();
            const snap = makeMockSnapshot({
              snapId: 'mid_sync_del',
              timestamp: now - 5_000,
              lastOpened: now - 5_000,
            });
            const slotKey = 'save_mid_sync_del';
            storageMod.StorageService.saveSnapshots([snap]);

            const deltaToken = await codecMod.encodeProgressDeltaToken({
              filledRegionIds: [1, 2],
              paintedRegionColors: {},
              updatedAt: now - 5_000,
              resetEpoch: 0,
            });
            let deletedDuringPull = false;
            const harness = createMockOrchestratorHarness({
              initialRemoteManifest: {
                version: 2,
                updatedAt: now - 5_000,
                devicePlayerId: 'local_user_1',
                providerId: 'microsoft',
                entries: {
                  [slotKey]: {
                    snapshotId: snap.id,
                    slotKey,
                    title: snap.title,
                    createdAt: now - 5_000,
                    lastOpened: now - 5_000,
                    filledCount: 2,
                    totalCount: 10,
                    resetEpoch: 0,
                    deltaToken,
                  },
                },
              },
              onReadManifest: async () => {
                if (!deletedDuringPull) {
                  deletedDuringPull = true;
                  await storageMod.StorageService.deleteSnapshot(snap.id);
                }
              },
            });
            const orchestrator = await harness.init();
            await orchestrator.syncFullLibrary([snap]);

            assert.equal(deletedDuringPull, true, 'Test must trigger deletion while readManifest is in-flight');
            assert.equal(
              storageMod.StorageService.loadSnapshots().some((s) => s.id === snap.id),
              false,
              'Mid-sync deleted snapshot within 10 minutes must NOT resurrect locally'
            );
            assert.equal(
              harness.getPushedManifest()?.entries?.[slotKey],
              undefined,
              'Mid-sync deleted snapshot within 10 minutes must be pruned from pushed nextEntries'
            );
            assert.ok(
              (harness.getPushedManifest()?.tombstones?.[slotKey] ?? 0) > 0,
              'Mid-sync delete tombstone must be pushed to remote manifest'
            );
            assert.equal(getSkewTelemetryEvents().length, 0);
          }

          // (g) Legacy vault pruning on same-device delete within 10 minutes
          {
            memLocal.clear();
            memSession.clear();
            telemetryMod.clearSwallowedErrorLog();

            const now = Date.now();
            const slotKey = 'save_legacy_vault_del';
            const legacyToken = await codecMod.encodeProgressDeltaToken({
              filledRegionIds: [1, 2, 3],
              paintedRegionColors: {},
              updatedAt: now - 10_000,
              resetEpoch: 0,
            });
            const vaultKey = slotKeyMod.resolveAccountScopedKey(keysMod.CLOUD_VAULT_STORAGE_KEY, ACCOUNT_SCOPE);
            safeStoreMod.SafeLocalStore.setItem(
              vaultKey,
              JSON.stringify({
                [slotKey]: {
                  slotKey,
                  title: 'Legacy Vault Save',
                  deltaToken: legacyToken,
                  filledCount: 3,
                  totalCount: 10,
                  resetEpoch: 0,
                  updatedAt: now - 10_000,
                  devicePlayerId: 'local_user_1',
                },
              })
            );
            slotKeyMod.recordLocalSlotTombstone(slotKey, now, ACCOUNT_SCOPE);

            const harness = createMockOrchestratorHarness();
            const orchestrator = await harness.init();
            await orchestrator.syncFullLibrary([]);

            const remainingVault = JSON.parse(safeStoreMod.SafeLocalStore.getItem(vaultKey) || '{}');
            assert.equal(
              remainingVault[slotKey],
              undefined,
              'Legacy vault envelope within 10 minutes of local delete must be pruned strictly'
            );
            assert.equal(
              harness.getPushedManifest()?.tombstones?.[slotKey],
              Math.floor(now),
              'Tombstone must remain in pushed manifest after legacy vault pruning'
            );
            assert.equal(getSkewTelemetryEvents().length, 0);
          }

          // (h) Re-merged local tombstone during reconcileMidSyncMutations must NOT contradict tolerance-preserved snapshot
          {
            const remergeRes = await runTombstoneSyncScenario({
              snapId: 'skew_remerged_local_tomb',
              snapTs: refDeletedAt - 5 * 60 * 1000,
              deletedAt: refDeletedAt,
              seedLocalTombstone: true,
            });
            assert.equal(
              remergeRes.surviving.some((s) => s.id === 'skew_remerged_local_tomb'),
              true,
              'Tolerance-preserved local snapshot must survive re-merged local tombstones in reconcileMidSyncMutations'
            );
            assert.ok(
              remergeRes.pushedManifest?.entries?.[remergeRes.slotKey],
              'Tolerance-preserved snapshot must remain in pushed manifest entries'
            );
            assert.equal(
              remergeRes.pushedManifest?.tombstones?.[remergeRes.slotKey],
              undefined,
              'Pre-existing local tombstone must be cleared from pushed manifest'
            );
            assert.equal(
              remergeRes.persistedTombstones[remergeRes.slotKey],
              undefined,
              'Pre-existing scoped local tombstone must be cleared from capy_cloud_tombstones_v1'
            );
            assert.equal(
              remergeRes.unscopedTombstones[remergeRes.slotKey],
              undefined,
              'Pre-existing unscoped local tombstone must be cleared from capy_cloud_tombstones_v1'
            );
            assert.equal(remergeRes.telemetryEvents.length, 1);
          }

          // (i) Two-device clock-skew convergence: Lamport deletedAt + 1 bump prevents ping-pong and cloud erasure
          {
            let sharedCloudManifest = null;
            const deviceAStorage = { local: new Map(), session: new Map() };
            const deviceBStorage = { local: new Map(), session: new Map() };

            const withDeviceStorage = async (deviceStore, fn) => {
              memLocal.clear();
              memSession.clear();
              for (const [k, v] of deviceStore.local.entries()) memLocal.set(k, v);
              for (const [k, v] of deviceStore.session.entries()) memSession.set(k, v);
              try {
                return await fn();
              } finally {
                deviceStore.local = new Map(memLocal.entries());
                deviceStore.session = new Map(memSession.entries());
              }
            };

            const createSharedCloudOrchestrator = async () => {
              const identity = {
                playerId: 'local_user_1',
                displayName: 'Local User',
                email: 'local.user@example.com',
                avatarColorHex: '#3b82f6',
                provider: 'microsoft',
                isAuthenticated: true,
              };
              const sharedDriver = {
                id: 'microsoft',
                getDescriptor: () => ({
                  id: 'microsoft',
                  displayName: 'Microsoft OneDrive',
                  storageName: 'Microsoft OneDrive (Shared Mock)',
                  isSupported: true,
                  isConfigured: true,
                }),
                hasActiveSession: () => true,
                restoreSession: () => identity,
                attemptAutoSignIn: async () => identity,
                getCachedIdentity: () => identity,
                signIn: async () => identity,
                signOut: async () => {},
                readManifest: async () => (sharedCloudManifest ? structuredClone(sharedCloudManifest) : null),
                writeManifest: async (m) => {
                  sharedCloudManifest = structuredClone(m);
                  return true;
                },
                readSlotEnvelope: async () => null,
                writeSlotEnvelope: async () => true,
                readBinaryBlob: async () => null,
                writeBinaryBlob: async () => null,
              };
              const authMgr = new authMod.MultiProviderAuthManager();
              authMgr.registerDriver(sharedDriver);
              await authMgr.signInWithProvider('microsoft');
              return new syncMod.CloudLibrarySyncOrchestrator(authMgr);
            };

            const snapId = 'two_device_conv';
            const slotKey = `save_${snapId}`;

            // Step 1: Device B deletes P at deletedAt = T and syncs -> cloud holds tombstone T, Device B persists local tombstone T
            const deletedAtT = await withDeviceStorage(deviceBStorage, async () => {
              telemetryMod.clearSwallowedErrorLog();
              const initialTs = Math.floor(Date.now() - 20_000);
              const snapB = makeMockSnapshot({ snapId, timestamp: initialTs, lastOpened: initialTs });
              storageMod.StorageService.saveSnapshots([snapB]);
              const orchB = await createSharedCloudOrchestrator();
              await orchB.syncFullLibrary([snapB]);
              await storageMod.StorageService.deleteSnapshot(snapId);
              await orchB.syncFullLibrary([]);

              const tCloud = sharedCloudManifest?.tombstones?.[slotKey];
              assert.ok(tCloud > 0, 'Step 1: Device B sync must push deletion tombstone T to cloud');
              assert.equal(sharedCloudManifest?.entries?.[slotKey], undefined, 'Step 1: Cloud must have no entry for deleted slot');
              assert.equal(
                slotKeyMod.readLocalSlotTombstones(ACCOUNT_SCOPE)[slotKey],
                tCloud,
                'Step 1: Device B must persist local tombstone T'
              );
              return tCloud;
            });

            // Step 2: Device A holds snapA at T - 5 min (< 10 min) and syncs -> survives, telemetry once, cloud bumped >= T + 1
            const snapATs = deletedAtT - 5 * 60 * 1000;
            const snapA = makeMockSnapshot({ snapId, timestamp: snapATs, lastOpened: snapATs });
            await withDeviceStorage(deviceAStorage, async () => {
              telemetryMod.clearSwallowedErrorLog();
              storageMod.StorageService.saveSnapshots([snapA]);
              const orchA = await createSharedCloudOrchestrator();
              await orchA.syncFullLibrary(storageMod.StorageService.loadSnapshots());

              assert.equal(
                storageMod.StorageService.loadSnapshots().some((s) => s.id === snapId),
                true,
                'Step 2: Device A snapshot within 10-min tolerance must survive locally'
              );
              assert.equal(
                getSkewTelemetryEvents().length,
                1,
                'Step 2: Device A skew preservation must emit telemetry exactly once'
              );
              const cloudEntry = sharedCloudManifest?.entries?.[slotKey];
              assert.ok(cloudEntry, 'Step 2: Device A must re-upload preserved entry to cloud');
              assert.ok(
                cloudEntry.lastOpened >= deletedAtT + 1,
                `Step 2: Re-uploaded entry lastOpened (${cloudEntry.lastOpened}) must be >= deletedAt + 1 (${deletedAtT + 1})`
              );
              const decodedDelta = await codecMod.decodeProgressDeltaToken(cloudEntry.deltaToken);
              assert.ok(
                decodedDelta.updatedAt >= deletedAtT + 1,
                `Step 2: Re-uploaded delta updatedAt (${decodedDelta.updatedAt}) must be >= deletedAt + 1 (${deletedAtT + 1})`
              );
              assert.equal(
                sharedCloudManifest?.tombstones?.[slotKey],
                undefined,
                'Step 2: Cloud tombstone must be cleared after Device A re-upload'
              );
            });

            // Step 3: Device A runs a SECOND sync BEFORE Device B syncs -> lastOpened must NOT regress, 0 new skew telemetry
            await withDeviceStorage(deviceAStorage, async () => {
              telemetryMod.clearSwallowedErrorLog();
              const orchA2 = await createSharedCloudOrchestrator();
              await orchA2.syncFullLibrary(storageMod.StorageService.loadSnapshots());

              const cloudEntryAfterSecondA = sharedCloudManifest?.entries?.[slotKey];
              assert.ok(cloudEntryAfterSecondA, 'Step 3: Cloud entry must remain present after second Device A sync');
              assert.ok(
                cloudEntryAfterSecondA.lastOpened >= deletedAtT + 1,
                `Step 3: Second Device A sync must NOT regress lastOpened (${cloudEntryAfterSecondA.lastOpened}) below deletedAt + 1 (${deletedAtT + 1})`
              );
              const decodedDelta2 = await codecMod.decodeProgressDeltaToken(cloudEntryAfterSecondA.deltaToken);
              assert.ok(
                decodedDelta2.updatedAt >= deletedAtT + 1,
                `Step 3: Second Device A sync must NOT regress delta updatedAt (${decodedDelta2.updatedAt}) below deletedAt + 1 (${deletedAtT + 1})`
              );
              assert.equal(
                sharedCloudManifest?.tombstones?.[slotKey],
                undefined,
                'Step 3: Cloud must still have no tombstone'
              );
              assert.equal(
                getSkewTelemetryEvents().length,
                0,
                'Step 3: Second Device A sync must emit 0 additional skew telemetry events'
              );
            });

            // Step 4: Device B syncs -> accepts P in cloud, clears superseded local tombstone, does NOT erase P or re-push tombstone
            await withDeviceStorage(deviceBStorage, async () => {
              telemetryMod.clearSwallowedErrorLog();
              const orchB2 = await createSharedCloudOrchestrator();
              await orchB2.syncFullLibrary([]);

              const cloudEntryAfterB = sharedCloudManifest?.entries?.[slotKey];
              assert.ok(
                cloudEntryAfterB,
                'Step 4: Device B sync must NOT erase Device A re-uploaded entry from cloud'
              );
              assert.ok(
                cloudEntryAfterB.lastOpened >= deletedAtT + 1,
                'Step 4: Cloud entry must retain lastOpened >= deletedAt + 1 after Device B sync'
              );
              assert.equal(
                sharedCloudManifest?.tombstones?.[slotKey],
                undefined,
                'Step 4: Device B must NOT re-push superseded tombstone to cloud'
              );
              assert.equal(
                slotKeyMod.readLocalSlotTombstones(ACCOUNT_SCOPE)[slotKey],
                undefined,
                'Step 4: Device B must clear superseded scoped local tombstone'
              );
              assert.equal(
                slotKeyMod.readLocalSlotTombstones()[slotKey],
                undefined,
                'Step 4: Device B must clear superseded unscoped local tombstone'
              );
              assert.equal(
                getSkewTelemetryEvents().length,
                0,
                'Step 4: Device B convergence sync must emit 0 skew telemetry events'
              );
            });

            // Step 5: Device A syncs again -> steady-state convergence, 0 skew telemetry, P in cloud, 0 tombstones
            await withDeviceStorage(deviceAStorage, async () => {
              telemetryMod.clearSwallowedErrorLog();
              const orchA3 = await createSharedCloudOrchestrator();
              await orchA3.syncFullLibrary(storageMod.StorageService.loadSnapshots());

              assert.equal(
                storageMod.StorageService.loadSnapshots().some((s) => s.id === snapId),
                true,
                'Step 5: Device A snapshot must remain intact in steady state'
              );
              assert.ok(
                sharedCloudManifest?.entries?.[slotKey]?.lastOpened >= deletedAtT + 1,
                'Step 5: Cloud entry must remain converged with lastOpened >= deletedAt + 1'
              );
              assert.equal(
                sharedCloudManifest?.tombstones?.[slotKey],
                undefined,
                'Step 5: Cloud must hold 0 tombstones in steady state'
              );
              assert.equal(
                getSkewTelemetryEvents().length,
                0,
                'Step 5: Steady-state Device A sync must emit 0 additional skew telemetry events'
              );
            });
          }

          // (j) snapTs === 0 must be deleted even against a small synthetic tombstone (0 < deletedAt < TOMBSTONE_SKEW_TOLERANCE_MS)
          {
            const origDateNow = Date.now;
            Date.now = () => 100_000;
            try {
              const tinyDeletedAt = 50_000; // 0 < tinyDeletedAt < 600_000 (TOMBSTONE_SKEW_TOLERANCE_MS)
              const zeroTsRes = await runTombstoneSyncScenario({
                snapId: 'skew_zero_ts_tiny_tomb',
                timestamp: 0,
                lastOpened: 0,
                deletedAt: tinyDeletedAt,
              });
              assert.equal(
                zeroTsRes.surviving.some((s) => s.id === 'skew_zero_ts_tiny_tomb'),
                false,
                'Snapshot with snapTs === 0 must be deleted even against a small synthetic tombstone < TOMBSTONE_SKEW_TOLERANCE_MS'
              );
              assert.equal(
                zeroTsRes.pushedManifest?.entries?.[zeroTsRes.slotKey],
                undefined,
                'Deleted snapTs === 0 snapshot must not be uploaded to cloud manifest'
              );
              assert.equal(
                zeroTsRes.pushedManifest?.tombstones?.[zeroTsRes.slotKey],
                tinyDeletedAt,
                'Small synthetic tombstone must be preserved when deleting snapTs === 0 snapshot'
              );
              assert.equal(
                zeroTsRes.telemetryEvents.length,
                0,
                'Deleting snapTs === 0 snapshot must emit 0 skew telemetry events'
              );
            } finally {
              Date.now = origDateNow;
            }
          }

          // (k) Same-device rapid delete after skew-preserved save (online, offline localManifest-only, recordSlotDeletion, mid-sync delete)
          {
            const origDateNow = Date.now;
            try {
              const runRapidDeleteVariant = async (variant) => {
                memLocal.clear();
                memSession.clear();
                telemetryMod.clearSwallowedErrorLog();

                const T_A = 1_795_858_000_000;
                const T_B = T_A + 5 * 60 * 1000; // Device B clock +5m fast
                const expectedLamportFloor = (Math.floor(T_B / 1000) + 1) * 1000;
                const snapId = `rapid_del_${variant}`;
                const slotKey = `save_${snapId}`;

                Date.now = () => T_A;
                const snapA = makeMockSnapshot({ snapId, timestamp: T_A, lastOpened: T_A });
                storageMod.StorageService.saveSnapshots([snapA]);

                let midSyncTriggered = false;
                const harness = createMockOrchestratorHarness({
                  initialRemoteManifest: {
                    version: 2,
                    updatedAt: T_B,
                    devicePlayerId: 'remote_device',
                    providerId: 'microsoft',
                    entries: {},
                    tombstones: { [slotKey]: T_B },
                  },
                  jsonRoundTrip: true,
                  onReadManifest: async () => {
                    if (variant === 'mid_sync' && midSyncTriggered) {
                      midSyncTriggered = false;
                      Date.now = () => T_A + 2_000;
                      await storageMod.StorageService.deleteSnapshot(snapId);
                    }
                  },
                });
                const orchestrator = await harness.init();

                // Sync 1: Device A skew-preserves P and pushes Lamport-bumped entry with real inlineBinaryB64
                await orchestrator.syncFullLibrary(storageMod.StorageService.loadSnapshots());
                const pushedAfterSync1 = harness.getPushedManifest();
                assert.equal(
                  pushedAfterSync1?.entries?.[slotKey]?.lastOpened,
                  expectedLamportFloor,
                  `Variant ${variant}: Sync 1 must Lamport-bump cloud entry to ${expectedLamportFloor}`
                );
                assert.ok(
                  typeof pushedAfterSync1?.entries?.[slotKey]?.inlineBinaryB64 === 'string' &&
                    pushedAfterSync1.entries[slotKey].inlineBinaryB64.length > 0,
                  `Variant ${variant}: Sync 1 must embed real inlineBinaryB64 so resurrection would be observable`
                );

                // Sync 2: Rapid delete while Device A clock (T_A + 2s) is still behind expectedLamportFloor
                Date.now = () => T_A + 2_000;
                if (variant === 'online') {
                  await storageMod.StorageService.deleteSnapshot(snapId);
                } else if (variant === 'offline') {
                  await storageMod.StorageService.deleteSnapshot(snapId);
                  harness.setRemoteManifest(null);
                } else if (variant === 'record_slot_deletion') {
                  await storageMod.StorageService.deleteSnapshot(snapId);
                  orchestrator.recordSlotDeletion(slotKey, T_A + 2_000);
                } else if (variant === 'mid_sync') {
                  midSyncTriggered = true;
                }

                Date.now = () => T_A + 3_000;
                const sync2Summary = await orchestrator.syncFullLibrary(
                  storageMod.StorageService.loadSnapshots()
                );

                assert.equal(
                  sync2Summary.importedSavesFromCloud,
                  0,
                  `Variant ${variant}: Rapid delete must NOT re-import deleted snapshot from cloud/localManifest`
                );
                assert.equal(
                  storageMod.StorageService.loadSnapshots().some((s) => s.id === snapId),
                  false,
                  `Variant ${variant}: Rapidly deleted snapshot must NOT resurrect locally`
                );
                assert.equal(
                  harness.getPushedManifest()?.entries?.[slotKey],
                  undefined,
                  `Variant ${variant}: Rapidly deleted snapshot must be omitted from cloud manifest`
                );
                assert.ok(
                  (harness.getPushedManifest()?.tombstones?.[slotKey] ?? 0) >= expectedLamportFloor,
                  `Variant ${variant}: Cloud tombstone must stay >= Lamport floor (${expectedLamportFloor})`
                );
                assert.ok(
                  (slotKeyMod.readLocalSlotTombstones(ACCOUNT_SCOPE)[slotKey] ?? 0) >=
                    expectedLamportFloor,
                  `Variant ${variant}: Local tombstone must stay >= Lamport floor (${expectedLamportFloor})`
                );

                // Sync 3 check to verify steady-state zero resurrection
                Date.now = () => T_A + 4_000;
                const sync3Summary = await orchestrator.syncFullLibrary(
                  storageMod.StorageService.loadSnapshots()
                );
                assert.equal(
                  sync3Summary.importedSavesFromCloud,
                  0,
                  `Variant ${variant}: Sync 3 must not resurrect deleted snapshot`
                );
                assert.equal(
                  storageMod.StorageService.loadSnapshots().some((s) => s.id === snapId),
                  false,
                  `Variant ${variant}: Sync 3 must keep local library free of deleted snapshot`
                );
              };

              await runRapidDeleteVariant('online');
              await runRapidDeleteVariant('offline');
              await runRapidDeleteVariant('record_slot_deletion');
              await runRapidDeleteVariant('mid_sync');
            } finally {
              Date.now = origDateNow;
            }
          }

          // (l) Non-finite Infinity and negative -1 snapshot timestamps must never bypass tombstones or corrupt cloud JSON
          {
            // (l1) Infinity snapshot against valid remote tombstone must be deleted and preserve tombstone
            memLocal.clear();
            memSession.clear();
            telemetryMod.clearSwallowedErrorLog();
            const infSnapId = 'inf_tomb_snap';
            const infSlotKey = `save_${infSnapId}`;
            const infSnap = makeMockSnapshot({
              snapId: infSnapId,
              timestamp: Infinity,
              lastOpened: Infinity,
            });
            const infHarness = createMockOrchestratorHarness({
              initialRemoteManifest: {
                version: 2,
                updatedAt: refDeletedAt,
                devicePlayerId: 'remote_device',
                providerId: 'microsoft',
                entries: {},
                tombstones: { [infSlotKey]: refDeletedAt },
              },
              jsonRoundTrip: true,
            });
            const infOrchestrator = await infHarness.init();
            await infOrchestrator.syncFullLibrary([infSnap]);

            assert.equal(
              infHarness.getPushedManifest()?.entries?.[infSlotKey],
              undefined,
              'Infinity-timestamp snapshot must not bypass remote tombstone or be uploaded to cloud'
            );
            assert.equal(
              infHarness.getPushedManifest()?.tombstones?.[infSlotKey],
              refDeletedAt,
              'Valid remote tombstone must remain intact against Infinity-timestamp snapshot'
            );
            assert.equal(
              getSkewTelemetryEvents().length,
              0,
              'Infinity-timestamp snapshot must emit 0 skew telemetry events'
            );

            // (l2) In-memory Infinity and -1 snapshots without tombstones must serialize valid positive finite timestamps
            memLocal.clear();
            memSession.clear();
            telemetryMod.clearSwallowedErrorLog();
            const negSnap = makeMockSnapshot({
              snapId: 'neg_ts_snap',
              timestamp: -1,
              lastOpened: -1,
            });
            const noTombInfSnap = makeMockSnapshot({
              snapId: 'inf_notomb_snap',
              timestamp: Infinity,
              lastOpened: Infinity,
            });
            const sanitizeHarness = createMockOrchestratorHarness({ jsonRoundTrip: true });
            const sanitizeOrch = await sanitizeHarness.init();
            await sanitizeOrch.syncFullLibrary([negSnap, noTombInfSnap]);
            const sanitizedManifest = sanitizeHarness.getPushedManifest();

            for (const key of ['save_neg_ts_snap', 'save_inf_notomb_snap']) {
              const entry = sanitizedManifest?.entries?.[key];
              assert.ok(entry, `Sanitized entry ${key} must be pushed`);
              assert.ok(
                typeof entry.createdAt === 'number' &&
                  Number.isFinite(entry.createdAt) &&
                  entry.createdAt > 0,
                `Sanitized ${key}.createdAt (${entry.createdAt}) must be finite and > 0`
              );
              assert.ok(
                typeof entry.lastOpened === 'number' &&
                  Number.isFinite(entry.lastOpened) &&
                  entry.lastOpened > 0,
                `Sanitized ${key}.lastOpened (${entry.lastOpened}) must be finite and > 0`
              );
              const decoded = await codecMod.decodeProgressDeltaToken(entry.deltaToken);
              assert.ok(
                decoded.updatedAt > 0,
                `Sanitized ${key} deltaToken.updatedAt (${decoded.updatedAt}) must be > 0`
              );
            }
          }

          // Helper to produce real inlineBinaryB64 for remote import mid-sync deletion tests (m) & (n)
          const buildInlineBinaryForSnapshot = async (snap) => {
            storageMod.StorageService.saveSnapshots([snap]);
            const bytes = await storageMod.StorageService.exportSnapshotBinary(snap.id);
            return Buffer.from(bytes).toString('base64');
          };

          // (m) Case B imported-then-deleted mid-sync with T_del <= T_old (fast-clock & same-ms, writeBinaryBlob & readBinaryBlob)
          {
            const origDateNow = Date.now;
            try {
              const runCaseBMidSyncDelete = async ({ mode, sameMs }) => {
                memLocal.clear();
                memSession.clear();
                telemetryMod.clearSwallowedErrorLog();

                const T_NOW = 1_795_860_000_000;
                Date.now = () => T_NOW;

                const pId = `caseb_p_${mode}_${sameMs ? 'samems' : 'fast'}`;
                const qId = `caseb_q_${mode}_${sameMs ? 'samems' : 'fast'}`;
                const pSlot = `save_${pId}`;
                const qSlot = `save_${qId}`;

                const T_old = sameMs ? T_NOW : T_NOW + 5 * 60 * 1000;
                const T_remote = (Math.floor(T_old / 1000) + 1) * 1000;

                const pTemplate = makeMockSnapshot({ snapId: pId, timestamp: T_NOW - 10_000, lastOpened: T_NOW - 10_000 });
                const pInlineB64 = await buildInlineBinaryForSnapshot(pTemplate);
                const pDelta = await codecMod.encodeProgressDeltaToken({
                  filledRegionIds: [1, 2],
                  paintedRegionColors: {},
                  updatedAt: T_remote,
                  resetEpoch: 0,
                });
                const qDelta = await codecMod.encodeProgressDeltaToken({
                  filledRegionIds: [3],
                  paintedRegionColors: {},
                  updatedAt: T_NOW - 5_000,
                  resetEpoch: 0,
                });

                // Reset Device B local state: NO local P, pre-existing local tombstone T_old, plus local Q (for writeBinaryBlob mode)
                memLocal.clear();
                memSession.clear();
                const qSnap = makeMockSnapshot({ snapId: qId, timestamp: T_NOW - 5_000, lastOpened: T_NOW - 5_000 });
                if (mode === 'writeBinaryBlob') {
                  storageMod.StorageService.saveSnapshots([qSnap]);
                }
                slotKeyMod.recordLocalSlotTombstone(pSlot, T_old, ACCOUNT_SCOPE);

                const remoteEntries = {
                  [pSlot]: {
                    snapshotId: pId,
                    slotKey: pSlot,
                    title: pTemplate.title,
                    createdAt: T_NOW - 10_000,
                    lastOpened: T_remote,
                    filledCount: 2,
                    totalCount: 10,
                    resetEpoch: 0,
                    deltaToken: pDelta,
                    inlineBinaryB64: pInlineB64,
                  },
                };
                if (mode === 'readBinaryBlob') {
                  remoteEntries[qSlot] = {
                    snapshotId: qId,
                    slotKey: qSlot,
                    title: qSnap.title,
                    createdAt: T_NOW - 5_000,
                    lastOpened: T_NOW - 5_000,
                    filledCount: 1,
                    totalCount: 10,
                    resetEpoch: 0,
                    deltaToken: qDelta,
                    cloudBinaryRef: 'blob_q_ref',
                  };
                }

                let deletedP = false;
                const harness = createMockOrchestratorHarness({
                  initialRemoteManifest: {
                    version: 2,
                    updatedAt: T_remote,
                    devicePlayerId: 'remote_device',
                    providerId: 'microsoft',
                    entries: remoteEntries,
                  },
                  jsonRoundTrip: true,
                  onReadBinaryBlob: async (ref) => {
                    if (mode === 'readBinaryBlob' && ref === 'blob_q_ref' && !deletedP) {
                      assert.equal(
                        storageMod.StorageService.loadSnapshots().some((s) => s.id === pId),
                        true,
                        'P must already be imported locally before mid-sync deletion during readBinaryBlob'
                      );
                      deletedP = true;
                      await storageMod.StorageService.deleteSnapshot(pId);
                    }
                    return null;
                  },
                  onWriteBinaryBlob: async (slotKey) => {
                    if (mode === 'writeBinaryBlob' && slotKey === qSlot && !deletedP) {
                      assert.equal(
                        storageMod.StorageService.loadSnapshots().some((s) => s.id === pId),
                        true,
                        'P must already be imported locally before mid-sync deletion during writeBinaryBlob'
                      );
                      deletedP = true;
                      await storageMod.StorageService.deleteSnapshot(pId);
                    }
                    return `uploaded_${slotKey}`;
                  },
                });
                const orchestrator = await harness.init();
                await orchestrator.syncFullLibrary(storageMod.StorageService.loadSnapshots());

                assert.equal(deletedP, true, `Case B (${mode}, sameMs=${sameMs}): mid-sync deletion hook must fire`);
                assert.equal(
                  storageMod.StorageService.loadSnapshots().some((s) => s.id === pId),
                  false,
                  `Case B (${mode}, sameMs=${sameMs}): P must stay deleted locally after Sync 1`
                );
                assert.equal(
                  harness.getPushedManifest()?.entries?.[pSlot],
                  undefined,
                  `Case B (${mode}, sameMs=${sameMs}): P must be pruned from pushed manifest entries`
                );
                assert.ok(
                  (harness.getPushedManifest()?.tombstones?.[pSlot] ?? 0) >= T_remote + 1,
                  `Case B (${mode}, sameMs=${sameMs}): pushed tombstone must be >= T_remote + 1 (${T_remote + 1})`
                );

                // Sync 2: verify zero resurrection
                Date.now = () => T_NOW + 1_000;
                const sync2 = await orchestrator.syncFullLibrary(storageMod.StorageService.loadSnapshots());
                assert.equal(
                  sync2.importedSavesFromCloud,
                  0,
                  `Case B (${mode}, sameMs=${sameMs}): Sync 2 must NOT resurrect P`
                );
                assert.equal(
                  storageMod.StorageService.loadSnapshots().some((s) => s.id === pId),
                  false,
                  `Case B (${mode}, sameMs=${sameMs}): P must remain deleted after Sync 2`
                );
              };

              await runCaseBMidSyncDelete({ mode: 'writeBinaryBlob', sameMs: false });
              await runCaseBMidSyncDelete({ mode: 'writeBinaryBlob', sameMs: true });
              await runCaseBMidSyncDelete({ mode: 'readBinaryBlob', sameMs: false });
            } finally {
              Date.now = origDateNow;
            }
          }

          // (n) Mid-sync deletion during reconcileRemoteManifest (readBinaryBlob) when T_del < T_remote (Case A 2A-3 & Case B 2B-3)
          {
            const origDateNow = Date.now;
            try {
              const runReadBlobDeleteWithFutureRemote = async (isCaseB) => {
                memLocal.clear();
                memSession.clear();
                telemetryMod.clearSwallowedErrorLog();

                const T_NOW = 1_795_861_000_000;
                Date.now = () => T_NOW;

                const pId = isCaseB ? 'mid_read_2b3_p' : 'mid_read_2a3_p';
                const qId = isCaseB ? 'mid_read_2b3_q' : 'mid_read_2a3_q';
                const pSlot = `save_${pId}`;
                const qSlot = `save_${qId}`;

                const T_old = T_NOW - 2 * 60 * 1000;
                const T_remote = T_NOW + 5 * 60 * 1000; // fast-clock peer ahead of T_del = T_NOW

                const pSnap = makeMockSnapshot({ snapId: pId, timestamp: T_NOW - 10_000, lastOpened: T_NOW - 10_000 });
                const pInlineB64 = await buildInlineBinaryForSnapshot(pSnap);
                const pDelta = await codecMod.encodeProgressDeltaToken({
                  filledRegionIds: [1, 2],
                  paintedRegionColors: {},
                  updatedAt: T_remote,
                  resetEpoch: 0,
                });
                const qDelta = await codecMod.encodeProgressDeltaToken({
                  filledRegionIds: [3],
                  paintedRegionColors: {},
                  updatedAt: T_NOW - 5_000,
                  resetEpoch: 0,
                });

                memLocal.clear();
                memSession.clear();
                if (isCaseB) {
                  slotKeyMod.recordLocalSlotTombstone(pSlot, T_old, ACCOUNT_SCOPE);
                } else {
                  storageMod.StorageService.saveSnapshots([pSnap]);
                }

                let deletedP = false;
                const harness = createMockOrchestratorHarness({
                  initialRemoteManifest: {
                    version: 2,
                    updatedAt: T_remote,
                    devicePlayerId: 'remote_device',
                    providerId: 'microsoft',
                    entries: {
                      [pSlot]: {
                        snapshotId: pId,
                        slotKey: pSlot,
                        title: pSnap.title,
                        createdAt: T_NOW - 10_000,
                        lastOpened: T_remote,
                        filledCount: 2,
                        totalCount: 10,
                        resetEpoch: 0,
                        deltaToken: pDelta,
                        inlineBinaryB64: pInlineB64,
                      },
                      [qSlot]: {
                        snapshotId: qId,
                        slotKey: qSlot,
                        title: `Skew ${qId}`,
                        createdAt: T_NOW - 5_000,
                        lastOpened: T_NOW - 5_000,
                        filledCount: 1,
                        totalCount: 10,
                        resetEpoch: 0,
                        deltaToken: qDelta,
                        cloudBinaryRef: 'blob_q_future_ref',
                      },
                    },
                  },
                  jsonRoundTrip: true,
                  onReadBinaryBlob: async (ref) => {
                    if (ref === 'blob_q_future_ref' && !deletedP) {
                      assert.equal(
                        storageMod.StorageService.loadSnapshots().some((s) => s.id === pId),
                        true,
                        `${isCaseB ? '2B-3' : '2A-3'}: P must be present locally before mid-sync deletion`
                      );
                      deletedP = true;
                      await storageMod.StorageService.deleteSnapshot(pId);
                    }
                    return null;
                  },
                });
                const orchestrator = await harness.init();
                await orchestrator.syncFullLibrary(storageMod.StorageService.loadSnapshots());

                assert.equal(deletedP, true, `${isCaseB ? '2B-3' : '2A-3'}: readBinaryBlob deletion hook must fire`);
                assert.equal(
                  storageMod.StorageService.loadSnapshots().some((s) => s.id === pId),
                  false,
                  `${isCaseB ? '2B-3' : '2A-3'}: P must remain deleted locally`
                );
                assert.equal(
                  harness.getPushedManifest()?.entries?.[pSlot],
                  undefined,
                  `${isCaseB ? '2B-3' : '2A-3'}: P must be pruned from pushed nextEntries even when T_del < T_remote`
                );
                assert.ok(
                  (harness.getPushedManifest()?.tombstones?.[pSlot] ?? 0) >= T_remote + 1,
                  `${isCaseB ? '2B-3' : '2A-3'}: mid-sync tombstone must be Lamport-bumped to >= T_remote + 1 (${T_remote + 1})`
                );

                // Sync 2: verify zero resurrection
                Date.now = () => T_NOW + 1_000;
                const sync2 = await orchestrator.syncFullLibrary(storageMod.StorageService.loadSnapshots());
                assert.equal(sync2.importedSavesFromCloud, 0);
                assert.equal(
                  storageMod.StorageService.loadSnapshots().some((s) => s.id === pId),
                  false,
                  `${isCaseB ? '2B-3' : '2A-3'}: P must not resurrect on Sync 2`
                );
              };

              await runReadBlobDeleteWithFutureRemote(false); // 2A-3
              await runReadBlobDeleteWithFutureRemote(true); // 2B-3
            } finally {
              Date.now = origDateNow;
            }
          }

          // (o) Cross-account manifest floor isolation (CA3a-CA3e & PROBE_A1-A4), fractional deleteSnapshot & inverted createdAt > lastOpened (3S-4a)
          {
            const origDateNow = Date.now;
            try {
              const T = 1_795_860_000_000;
              Date.now = () => T;
              const baseManifestKey = keysMod.resolveScopedStorageKey(keysMod.CLOUD_MANIFEST_STORAGE_KEY);
              const writeIdentity = (id) =>
                safeStoreMod.SafeLocalStore.setScopedItem(keysMod.IDENTITY_STORAGE_KEY, JSON.stringify(id));

              // PROBE_A3: explicit accountScope = null (guest) must NEVER read persisted authenticated user's scoped manifest
              memLocal.clear();
              memSession.clear();
              writeIdentity({
                playerId: 'google_userA',
                displayName: 'User A',
                avatarColorHex: '#3b82f6',
                provider: 'google',
                isAuthenticated: true,
              });
              const userAScopedManifestKey = slotKeyMod.resolveAccountScopedKey(
                keysMod.CLOUD_MANIFEST_STORAGE_KEY,
                'google_google_userA'
              );
              safeStoreMod.SafeLocalStore.setItem(
                userAScopedManifestKey,
                JSON.stringify({
                  version: 2,
                  updatedAt: T + 300_000,
                  devicePlayerId: 'google_userA',
                  providerId: 'google',
                  entries: { save_p: { lastOpened: T + 300_000, createdAt: T + 300_000 } },
                })
              );
              slotKeyMod.recordLocalSlotTombstone('save_p', T, null);
              assert.equal(
                slotKeyMod.readLocalSlotTombstones(null).save_p,
                T,
                'PROBE_A3: explicit accountScope=null must not read authenticated user scoped manifest floor'
              );

              // CA3a / PROBE_A2: explicit User B scope with guest or absent IDENTITY_STORAGE_KEY must reject User A baseKey manifest
              for (const identityMode of ['absent', 'guest']) {
                memLocal.clear();
                memSession.clear();
                if (identityMode === 'guest') {
                  writeIdentity({
                    playerId: 'capy_guest_tmp',
                    displayName: 'Guest',
                    avatarColorHex: '#3b82f6',
                    provider: 'guest',
                    isAuthenticated: false,
                  });
                }
                safeStoreMod.SafeLocalStore.setItem(
                  baseManifestKey,
                  JSON.stringify({
                    version: 2,
                    updatedAt: T + 500_000,
                    devicePlayerId: 'google_userA',
                    providerId: 'google',
                    entries: { save_p: { lastOpened: T + 500_000, createdAt: T + 500_000 } },
                  })
                );
                slotKeyMod.recordLocalSlotTombstone('save_p', T, 'google_google_userB');
                assert.equal(
                  slotKeyMod.readLocalSlotTombstones('google_google_userB').save_p,
                  T,
                  `CA3a (${identityMode}): explicit User B scope must reject User A baseKey manifest`
                );
              }

              // CA3b / PROBE_A1: explicit User B scope with stale User A persisted identity must reject User A baseKey manifest
              memLocal.clear();
              memSession.clear();
              writeIdentity({
                playerId: 'google_userA',
                displayName: 'User A',
                avatarColorHex: '#3b82f6',
                provider: 'google',
                isAuthenticated: true,
              });
              safeStoreMod.SafeLocalStore.setItem(
                baseManifestKey,
                JSON.stringify({
                  version: 2,
                  updatedAt: T + 500_000,
                  devicePlayerId: 'google_userA',
                  providerId: 'google',
                  entries: { save_p: { lastOpened: T + 500_000, createdAt: T + 500_000 } },
                })
              );
              slotKeyMod.recordLocalSlotTombstone('save_p', T, 'google_google_userB');
              assert.equal(
                slotKeyMod.readLocalSlotTombstones('google_google_userB').save_p,
                T,
                'CA3b / PROBE_A1: explicit User B scope must ignore stale User A persisted identity when checking baseKey'
              );

              // CA3c: cross-provider same basePlayerId (Google uid_42 in baseKey vs Microsoft uid_42 caller)
              for (const withOwnScopedManifest of [true, false]) {
                memLocal.clear();
                memSession.clear();
                writeIdentity({
                  playerId: 'uid_42',
                  displayName: 'MS User B',
                  avatarColorHex: '#3b82f6',
                  provider: 'microsoft',
                  isAuthenticated: true,
                });
                safeStoreMod.SafeLocalStore.setItem(
                  baseManifestKey,
                  JSON.stringify({
                    version: 2,
                    updatedAt: T + 500_000,
                    devicePlayerId: 'uid_42',
                    providerId: 'google',
                    entries: { save_p: { lastOpened: T + 500_000, createdAt: T + 500_000 } },
                  })
                );
                if (withOwnScopedManifest) {
                  safeStoreMod.SafeLocalStore.setItem(
                    slotKeyMod.resolveAccountScopedKey(keysMod.CLOUD_MANIFEST_STORAGE_KEY, 'microsoft_uid_42'),
                    JSON.stringify({
                      version: 2,
                      updatedAt: T - 1_000,
                      devicePlayerId: 'uid_42',
                      providerId: 'microsoft',
                      entries: {},
                    })
                  );
                }
                slotKeyMod.recordLocalSlotTombstone('save_p', T);
                assert.equal(
                  slotKeyMod.readLocalSlotTombstones('microsoft_uid_42').save_p,
                  T,
                  `CA3c (scoped=${withOwnScopedManifest}): Google baseKey manifest must not leak into Microsoft uid_42`
                );
              }

              // CA3d / PROBE_A4: guest must reject signed-in User A baseKey manifest (prefixed, provider-tagged, or mismatched playerId)
              for (const baseManifestPayload of [
                { version: 2, updatedAt: T + 500_000, devicePlayerId: 'google_userA', providerId: 'google', entries: { save_p: { lastOpened: T + 500_000 } } },
                { version: 2, updatedAt: T + 500_000, devicePlayerId: 'google_userA', entries: { save_p: { lastOpened: T + 500_000 } } },
                { version: 2, updatedAt: T + 500_000, devicePlayerId: 'userA', entries: { save_p: { lastOpened: T + 500_000 } } },
              ]) {
                memLocal.clear();
                memSession.clear();
                writeIdentity({
                  playerId: 'capy_guestB',
                  displayName: 'Guest B',
                  avatarColorHex: '#3b82f6',
                  provider: 'guest',
                  isAuthenticated: false,
                });
                safeStoreMod.SafeLocalStore.setItem(baseManifestKey, JSON.stringify(baseManifestPayload));
                storageMod.StorageService.saveSnapshots([makeMockSnapshot({ snapId: 'p', timestamp: T - 1_000, lastOpened: T - 1_000 })]);
                await storageMod.StorageService.deleteSnapshot('p');
                assert.equal(
                  slotKeyMod.readLocalSlotTombstones(null).save_p,
                  T,
                  `CA3d / PROBE_A4: guest deleteSnapshot must reject foreign baseKey manifest (${JSON.stringify(baseManifestPayload.devicePlayerId)})`
                );
              }

              // CA3e: own scoped manifest stops before baseKey, and missing devicePlayerId on baseKey is rejected
              for (const withScoped of [true, false]) {
                memLocal.clear();
                memSession.clear();
                writeIdentity({
                  playerId: 'google_userB',
                  displayName: 'User B',
                  avatarColorHex: '#3b82f6',
                  provider: 'google',
                  isAuthenticated: true,
                });
                if (withScoped) {
                  safeStoreMod.SafeLocalStore.setItem(
                    slotKeyMod.resolveAccountScopedKey(keysMod.CLOUD_MANIFEST_STORAGE_KEY, 'google_google_userB'),
                    JSON.stringify({
                      version: 2,
                      updatedAt: T - 5_000,
                      devicePlayerId: 'google_userB',
                      providerId: 'google',
                      entries: { save_p: { lastOpened: T - 5_000, createdAt: T - 5_000 } },
                    })
                  );
                }
                safeStoreMod.SafeLocalStore.setItem(
                  baseManifestKey,
                  JSON.stringify({
                    version: 2,
                    updatedAt: T + 500_000,
                    entries: { save_p: { lastOpened: T + 500_000, createdAt: T + 500_000 } },
                  })
                );
                slotKeyMod.recordLocalSlotTombstone('save_p', T);
                assert.equal(
                  slotKeyMod.readLocalSlotTombstones('google_google_userB').save_p,
                  T,
                  `CA3e (withScoped=${withScoped}): stale baseKey missing devicePlayerId must never leak into User B`
                );
              }

              // Multi-underscore provider (play_games_v2) legacy baseKey match + legitimate guest baseKey match
              memLocal.clear();
              memSession.clear();
              safeStoreMod.SafeLocalStore.setItem(
                baseManifestKey,
                JSON.stringify({
                  version: 2,
                  updatedAt: T + 120_000,
                  devicePlayerId: 'pgs_999',
                  providerId: 'play_games_v2',
                  entries: { save_pgs: { lastOpened: T + 120_000 } },
                })
              );
              slotKeyMod.recordLocalSlotTombstone('save_pgs', T, 'play_games_v2_pgs_999');
              assert.equal(
                slotKeyMod.readLocalSlotTombstones('play_games_v2_pgs_999').save_pgs,
                T + 120_000,
                'play_games_v2 scope must parse providerId with underscores and clamp against matching legacy baseKey manifest'
              );

              memLocal.clear();
              memSession.clear();
              writeIdentity({
                playerId: 'capy_guest_valid',
                displayName: 'Valid Guest',
                avatarColorHex: '#3b82f6',
                provider: 'guest',
                isAuthenticated: false,
              });
              safeStoreMod.SafeLocalStore.setItem(
                baseManifestKey,
                JSON.stringify({
                  version: 2,
                  updatedAt: T + 120_000,
                  devicePlayerId: 'capy_guest_valid:tab1',
                  entries: { save_g: { lastOpened: T + 120_000 } },
                })
              );
              slotKeyMod.recordLocalSlotTombstone('save_g', T);
              assert.equal(
                slotKeyMod.readLocalSlotTombstones(null).save_g,
                T + 120_000,
                'Legitimate guest with matching devicePlayerId must still clamp against guest baseKey manifest'
              );

              // PROBE_C2: fractional target.lastOpened in StorageService.deleteSnapshot must ceiling-align
              memLocal.clear();
              memSession.clear();
              const fracTs = T + 500.7;
              storageMod.StorageService.saveSnapshots([
                makeMockSnapshot({ snapId: 'frac_snap', timestamp: T, lastOpened: fracTs }),
              ]);
              await storageMod.StorageService.deleteSnapshot('frac_snap');
              const fracTombstones = slotKeyMod.readLocalSlotTombstones(null);
              assert.equal(
                fracTombstones.save_frac_snap,
                Math.ceil(fracTs),
                'deleteSnapshot must ceiling-align fractional target timestamps'
              );
              assert.equal(
                syncMod.isSlotTombstonedForTimestamp('save_frac_snap', fracTs, fracTombstones, 0),
                true,
                'Ceiling-aligned tombstone must strictly beat original fractional timestamp'
              );

              // 3S-4a / PROBE_D2: mid-sync delete must beat inverted remote createdAt > lastOpened
              memLocal.clear();
              memSession.clear();
              const invId = 'inv_created_gt_opened';
              const invSlot = `save_${invId}`;
              const invRemoteCreatedAt = T + 6 * 60 * 1000;
              const invRemoteLastOpened = T + 60 * 1000;
              const invSnap = makeMockSnapshot({ snapId: invId, timestamp: T - 5_000, lastOpened: T - 5_000 });
              const invDelta = await codecMod.encodeProgressDeltaToken({
                filledRegionIds: [1, 2],
                paintedRegionColors: {},
                updatedAt: invRemoteLastOpened,
                resetEpoch: 0,
              });
              storageMod.StorageService.saveSnapshots([invSnap]);
              let deletedInv = false;
              const invHarness = createMockOrchestratorHarness({
                initialRemoteManifest: {
                  version: 2,
                  updatedAt: invRemoteCreatedAt,
                  devicePlayerId: 'remote_device',
                  providerId: 'microsoft',
                  entries: {
                    [invSlot]: {
                      snapshotId: invId,
                      slotKey: invSlot,
                      title: invSnap.title,
                      createdAt: invRemoteCreatedAt,
                      lastOpened: invRemoteLastOpened,
                      filledCount: 2,
                      totalCount: 10,
                      resetEpoch: 0,
                      deltaToken: invDelta,
                    },
                  },
                },
                jsonRoundTrip: true,
                onWriteBinaryBlob: async (slotKey) => {
                  if (slotKey === invSlot && !deletedInv) {
                    deletedInv = true;
                    await storageMod.StorageService.deleteSnapshot(invId);
                  }
                  return 'blob_inv_ref';
                },
              });
              const invOrch = await invHarness.init();
              await invOrch.syncFullLibrary(storageMod.StorageService.loadSnapshots());
              assert.equal(deletedInv, true, '3S-4a: mid-sync delete hook must fire');
              assert.equal(
                invHarness.getPushedManifest()?.entries?.[invSlot],
                undefined,
                '3S-4a: deleted slot must be pruned from pushed entries'
              );
              assert.ok(
                (invHarness.getPushedManifest()?.tombstones?.[invSlot] ?? 0) >= invRemoteCreatedAt + 1,
                `3S-4a: mid-sync tombstone must beat inverted remote createdAt (${invRemoteCreatedAt + 1})`
              );
            } finally {
              Date.now = origDateNow;
            }
          }

          // (p) Signed-in StorageService.deleteSnapshot scopes tombstone to active account (no cross-account wipe after reload)
          {
            const origDateNow = Date.now;
            try {
              memLocal.clear();
              memSession.clear();
              telemetryMod.clearSwallowedErrorLog();

              const T = 1_795_858_000_000;
              const T_SKEW = T + 5 * 60 * 1000;
              const expectedLamportFloor = (Math.floor(T_SKEW / 1000) + 1) * 1000;
              Date.now = () => T;

              const sampleSnapA = {
                ...makeMockSnapshot({ snapId: 'sample_cat_a', timestamp: T, lastOpened: T }),
                sampleAssetPath: './samples/cat.json',
                sourceRef: { kind: 'sample', uri: './samples/cat.json' },
              };
              const sampleSlotKey = slotKeyMod.computeSlotKeyForSnapshot(sampleSnapA);
              assert.equal(sampleSlotKey, 'sample_samples_cat_json');

              let remoteManifestUserA = {
                version: 2,
                updatedAt: T_SKEW,
                devicePlayerId: 'google_userA_other',
                providerId: 'google',
                entries: {},
                tombstones: { [sampleSlotKey]: T_SKEW },
              };
              const createSimpleGoogleDriver = (playerId, displayName, getRemote, setRemote) => {
                let active = false;
                return {
                  id: 'google',
                  getDescriptor: () => ({
                    id: 'google',
                    displayName: 'Google Drive',
                    storageName: 'Google Drive',
                    isSupported: true,
                    isConfigured: true,
                  }),
                  hasActiveSession: () => active,
                  restoreSession: () => (active ? { playerId, displayName, provider: 'google', isAuthenticated: true } : null),
                  attemptAutoSignIn: async () => null,
                  signIn: async () => {
                    active = true;
                    return { playerId, displayName, provider: 'google', isAuthenticated: true };
                  },
                  signOut: async () => {
                    active = false;
                  },
                  readManifest: async () => (getRemote() ? JSON.parse(JSON.stringify(getRemote())) : null),
                  writeManifest: async (m) => {
                    setRemote(JSON.parse(JSON.stringify(m)));
                    return true;
                  },
                  readSlotEnvelope: async () => null,
                  writeSlotEnvelope: async () => true,
                  readBinaryBlob: async () => null,
                  writeBinaryBlob: async () => null,
                };
              };

              // User A signs in, skew-preserves sample_samples_cat_json, and deletes via StorageService.deleteSnapshot
              const authA = new authMod.MultiProviderAuthManager();
              const orchA = new syncMod.CloudLibrarySyncOrchestrator(authA);
              authA.onSignOut((prev) => orchA.clearLocalCloudCache(prev));
              authA.registerDriver(
                createSimpleGoogleDriver(
                  'google_userA',
                  'User A',
                  () => remoteManifestUserA,
                  (m) => {
                    remoteManifestUserA = m;
                  }
                )
              );
              await authA.signInWithProvider('google');
              storageMod.StorageService.saveSnapshots([sampleSnapA]);
              await orchA.syncFullLibrary(storageMod.StorageService.loadSnapshots());
              assert.equal(
                remoteManifestUserA.entries[sampleSlotKey]?.lastOpened,
                expectedLamportFloor,
                'User A Sync 1 must skew-preserve sample_samples_cat_json at Lamport floor'
              );

              Date.now = () => T + 2_000;
              await storageMod.StorageService.deleteSnapshot('sample_cat_a');

              const baseTombKey = keysMod.resolveScopedStorageKey(keysMod.CLOUD_TOMBSTONES_STORAGE_KEY);
              const scopedTombKeyA = slotKeyMod.resolveAccountScopedKey(
                keysMod.CLOUD_TOMBSTONES_STORAGE_KEY,
                'google_google_userA'
              );
              assert.equal(
                safeStoreMod.SafeLocalStore.getItem(baseTombKey),
                null,
                'Signed-in User A deleteSnapshot must leave unscoped capy_cloud_tombstones_v1 as null'
              );
              const parsedScopedA = JSON.parse(safeStoreMod.SafeLocalStore.getItem(scopedTombKeyA) || '{}');
              assert.equal(
                parsedScopedA[sampleSlotKey],
                expectedLamportFloor,
                'Signed-in User A deleteSnapshot must store clamped tombstone under User A account scope'
              );

              // Simulate reload after OAuth session expiry -> AuthManager downgrades User A to guest without onSignOut
              memSession.clear();
              const googleClientMod = await vite.ssrLoadModule('/src/services/providers/GoogleCloudSyncClient.ts');
              googleClientMod.clearCachedGoogleSession();
              const authB = new authMod.MultiProviderAuthManager();
              const orchB = new syncMod.CloudLibrarySyncOrchestrator(authB);
              let signOutFiredForB = false;
              authB.onSignOut((prev) => {
                signOutFiredForB = true;
                orchB.clearLocalCloudCache(prev);
              });
              assert.equal(authB.getCurrentIdentity().isAuthenticated, false, 'Reload with expired session must downgrade to guest');
              assert.equal(authB.getCurrentIdentity().provider, 'guest');

              // User B signs in with their own cloud save for sample_samples_cat_json and syncs
              const userBSampleDelta = await codecMod.encodeProgressDeltaToken({
                filledRegionIds: [1, 2, 3],
                paintedRegionColors: {},
                updatedAt: T + 15_000,
                resetEpoch: 0,
              });
              let remoteManifestUserB = {
                version: 2,
                updatedAt: T + 15_000,
                devicePlayerId: 'google_userB',
                providerId: 'google',
                entries: {
                  [sampleSlotKey]: {
                    snapshotId: 'sample_cat_b',
                    slotKey: sampleSlotKey,
                    title: 'User B Cat',
                    createdAt: T + 15_000,
                    lastOpened: T + 15_000,
                    filledCount: 3,
                    totalCount: 10,
                    resetEpoch: 0,
                    deltaToken: userBSampleDelta,
                    sampleAssetPath: './samples/cat.json',
                    sourceRef: { kind: 'sample', uri: './samples/cat.json' },
                  },
                },
              };
              authB.registerDriver(
                createSimpleGoogleDriver(
                  'google_userB',
                  'User B',
                  () => remoteManifestUserB,
                  (m) => {
                    remoteManifestUserB = m;
                  }
                )
              );
              await authB.signInWithProvider('google');
              assert.equal(signOutFiredForB, false, 'Guest-to-User-B sign-in does not fire onSignOut');

              Date.now = () => T + 20_000;
              await orchB.syncFullLibrary([]);
              assert.ok(
                remoteManifestUserB.entries?.[sampleSlotKey],
                'User B sample_samples_cat_json cloud save must remain intact after User A signed-in delete + reload'
              );
              assert.equal(
                remoteManifestUserB.tombstones?.[sampleSlotKey],
                undefined,
                'User A scoped tombstone must NEVER propagate into User B cloud manifest'
              );
            } finally {
              Date.now = origDateNow;
            }
          }

          // (q) Real AuthManager restored driver session persists IDENTITY_STORAGE_KEY (DEEP_PROBE_1_REAL_AUTH_RESTORE)
          {
            const origDateNow = Date.now;
            try {
              memLocal.clear();
              memSession.clear();
              telemetryMod.clearSwallowedErrorLog();

              const T = 1_795_858_000_000;
              const T_SKEW = T + 5 * 60 * 1000;
              const expectedLamportFloor = (Math.floor(T_SKEW / 1000) + 1) * 1000;
              Date.now = () => T;

              const googleClientMod = await vite.ssrLoadModule('/src/services/providers/GoogleCloudSyncClient.ts');
              googleClientMod.clearCachedGoogleSession();
              googleClientMod.setExplicitlySignedOut(false);

              // Seed guest in IDENTITY_STORAGE_KEY + valid cached Google OAuth session in sessionStorage
              safeStoreMod.SafeLocalStore.setScopedItem(
                keysMod.IDENTITY_STORAGE_KEY,
                JSON.stringify({
                  playerId: 'capy_prior_guest',
                  displayName: 'Prior Guest',
                  avatarColorHex: '#3b82f6',
                  provider: 'guest',
                  isAuthenticated: false,
                })
              );
              googleClientMod.saveCachedGoogleSession({
                accessToken: 'valid-restored-google-token',
                expiresAt: T + 3_600_000,
                sub: 'sub123',
                displayName: 'Restored Google User',
                email: 'restored@example.com',
              });

              const authMgr = new authMod.MultiProviderAuthManager();
              assert.equal(authMgr.getCurrentIdentity().isAuthenticated, true);
              assert.equal(authMgr.getCurrentIdentity().provider, 'google');
              assert.equal(authMgr.getCurrentIdentity().playerId, 'google_sub123');

              const persistedAfterRestore = JSON.parse(
                safeStoreMod.SafeLocalStore.getScopedItem(keysMod.IDENTITY_STORAGE_KEY) || '{}'
              );
              assert.equal(
                persistedAfterRestore.isAuthenticated,
                true,
                'AuthManager must persist restored authenticated identity into IDENTITY_STORAGE_KEY'
              );
              assert.equal(persistedAfterRestore.provider, 'google');
              assert.equal(persistedAfterRestore.playerId, 'google_sub123');

              // Sync 1 skew-preserves cat_1, caches scoped localManifest, and fails remote writeManifest (so markSynced is NOT called)
              const catSnap = makeMockSnapshot({ snapId: 'cat_1', timestamp: T, lastOpened: T });
              const catSlot = slotKeyMod.computeSlotKeyForSnapshot(catSnap);
              const catInlineB64 = await buildInlineBinaryForSnapshot(catSnap);
              const catDelta = await codecMod.encodeProgressDeltaToken({
                filledRegionIds: [1, 2],
                paintedRegionColors: {},
                updatedAt: expectedLamportFloor,
                resetEpoch: 0,
              });
              let failNextPush = true;
              let remoteManifest = {
                version: 2,
                updatedAt: T_SKEW,
                devicePlayerId: 'google_sub123_other',
                providerId: 'google',
                entries: {},
                tombstones: { [catSlot]: T_SKEW },
              };
              const mockRestoredGoogleDriver = {
                id: 'google',
                getDescriptor: () => ({
                  id: 'google',
                  displayName: 'Google Drive',
                  storageName: 'Google Drive',
                  isSupported: true,
                  isConfigured: true,
                }),
                hasActiveSession: () => true,
                restoreSession: () => ({
                  playerId: 'google_sub123',
                  displayName: 'Restored Google User',
                  provider: 'google',
                  isAuthenticated: true,
                }),
                attemptAutoSignIn: async () => null,
                signIn: async () => ({
                  playerId: 'google_sub123',
                  displayName: 'Restored Google User',
                  provider: 'google',
                  isAuthenticated: true,
                }),
                signOut: async () => {},
                readManifest: async () => (remoteManifest ? JSON.parse(JSON.stringify(remoteManifest)) : null),
                writeManifest: async (m) => {
                  if (failNextPush) {
                    failNextPush = false;
                    return false;
                  }
                  remoteManifest = JSON.parse(JSON.stringify(m));
                  return true;
                },
                readSlotEnvelope: async () => null,
                writeSlotEnvelope: async () => true,
                readBinaryBlob: async () => null,
                writeBinaryBlob: async () => null,
              };
              authMgr.registerDriver(mockRestoredGoogleDriver);

              storageMod.StorageService.saveSnapshots([catSnap]);
              const orch = new syncMod.CloudLibrarySyncOrchestrator(authMgr);
              const sync1 = await orch.syncFullLibrary(storageMod.StorageService.loadSnapshots());
              assert.equal(sync1.pushedToCloud, false, 'Sync 1 push intentionally fails so markSynced does not run');

              // Rapid delete via StorageService.deleteSnapshot while clock is still behind Lamport floor
              Date.now = () => T + 2_000;
              await storageMod.StorageService.deleteSnapshot('cat_1');
              const tombAfterDel = slotKeyMod.readLocalSlotTombstones('google_google_sub123')[catSlot] ?? 0;
              assert.ok(
                tombAfterDel >= expectedLamportFloor,
                `Restored session deleteSnapshot must clamp tombstone (${tombAfterDel}) >= Lamport floor (${expectedLamportFloor})`
              );

              // Simulate remote having the Lamport-bumped entry with real inlineBinaryB64; Sync 2 must NOT resurrect cat_1
              remoteManifest = {
                version: 2,
                updatedAt: expectedLamportFloor,
                devicePlayerId: 'google_sub123',
                providerId: 'google',
                entries: {
                  [catSlot]: {
                    snapshotId: 'cat_1',
                    slotKey: catSlot,
                    title: catSnap.title,
                    createdAt: T,
                    lastOpened: expectedLamportFloor,
                    filledCount: 2,
                    totalCount: 10,
                    resetEpoch: 0,
                    deltaToken: catDelta,
                    inlineBinaryB64: catInlineB64,
                  },
                },
              };
              Date.now = () => T + 3_000;
              const sync2 = await orch.syncFullLibrary(storageMod.StorageService.loadSnapshots());
              assert.equal(sync2.importedSavesFromCloud, 0, 'Sync 2 must NOT resurrect cat_1 after restored-session delete');
              assert.equal(
                storageMod.StorageService.loadSnapshots().some((s) => s.id === 'cat_1'),
                false,
                'cat_1 must remain deleted locally after Sync 2'
              );
              assert.equal(
                remoteManifest.entries?.[catSlot],
                undefined,
                'cat_1 must be pruned from cloud manifest on Sync 2'
              );
            } finally {
              Date.now = origDateNow;
            }
          }
        } finally {
          telemetryMod.clearSwallowedErrorLog();
        }
      } finally {
        globalThis.window = prevWin;
        globalThis.sessionStorage = prevSession;
        globalThis.localStorage = prevLocal;
      }
    }
    logUnitPass('M4 $0 BYOC Cloud Sync (PKCE S256, MicrosoftCloudDriver, AppleCloudDriver, Auto-Sync Scheduler, Cross-Provider CRDT & Tombstone Clock-Skew Tolerance) verified.');
}
