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

          const createMockOrchestratorHarness = ({ initialRemoteManifest = null, onReadManifest } = {}) => {
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
                return remoteManifest;
              },
              writeManifest: async (m) => {
                pushedManifest = m;
                remoteManifest = m;
                return true;
              },
              readSlotEnvelope: async () => null,
              writeSlotEnvelope: async () => true,
              readBinaryBlob: async () => null,
              writeBinaryBlob: async () => null,
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
