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
      } finally {
        globalThis.window = prevWin;
        globalThis.sessionStorage = prevSession;
        globalThis.localStorage = prevLocal;
      }
    }
    logUnitPass('M4 $0 BYOC Cloud Sync (PKCE S256, MicrosoftCloudDriver, AppleCloudDriver, Auto-Sync Scheduler & Cross-Provider CRDT) verified.');
}
