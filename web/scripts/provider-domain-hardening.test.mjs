import assert from 'node:assert/strict';

function createMemoryStorage() {
  const map = new Map();
  return {
    _map: map,
    get length() {
      return map.size;
    },
    key(i) {
      return Array.from(map.keys())[i] ?? null;
    },
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
    clear() {
      map.clear();
    },
  };
}

function makeTestJwt(payload, partsCount = 3) {
  const hdr = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  if (partsCount === 2) return `${hdr}.${body}`;
  return `${hdr}.${body}.signature_part`;
}

export async function runProviderDomainHardeningTests(vite) {
  const prevWindow = globalThis.window;
  const prevLocalStorage = globalThis.localStorage;
  const prevSessionStorage = globalThis.sessionStorage;
  const prevFetch = globalThis.fetch;

  const ls = createMemoryStorage();
  const ss = createMemoryStorage();

  globalThis.localStorage = ls;
  globalThis.sessionStorage = ss;
  globalThis.window = {
    location: { protocol: 'https:', host: 'capypaint.com', hostname: 'capypaint.com', pathname: '/', search: '' },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  try {
    const [
      regMod,
      authMod,
      cloudMod,
      slotKeyMod,
      coopMod,
      driversMod,
      googleClientMod,
      storageMod,
      codecMod,
      telemetryMod,
      keysMod,
    ] = await Promise.all([
      vite.ssrLoadModule('/src/services/providers/ProviderRegistry.ts'),
      vite.ssrLoadModule('/src/services/auth/AuthManager.ts'),
      vite.ssrLoadModule('/src/services/cloud/CloudLibrarySyncOrchestrator.ts'),
      vite.ssrLoadModule('/src/services/cloud/slotKey.ts'),
      vite.ssrLoadModule('/src/services/coop/HybridCoopRoomClient.ts'),
      vite.ssrLoadModule('/src/services/providers/CloudProviderDrivers.ts'),
      vite.ssrLoadModule('/src/services/providers/GoogleCloudSyncClient.ts'),
      vite.ssrLoadModule('/src/services/StorageService.ts'),
      vite.ssrLoadModule('/src/services/CapyCodec.ts'),
      vite.ssrLoadModule('/src/services/telemetry.ts'),
      vite.ssrLoadModule('/src/services/storage/StorageKeys.ts'),
    ]);

    // -----------------------------------------------------------------------
    // 1. Facade parity check
    // -----------------------------------------------------------------------
    assert.ok(regMod.ProviderRegistry.auth, 'ProviderRegistry.auth must exist');
    assert.ok(regMod.ProviderRegistry.cloudSave, 'ProviderRegistry.cloudSave must exist');
    assert.ok(regMod.ProviderRegistry.realtimeRoom, 'ProviderRegistry.realtimeRoom must exist');
    assert.ok(regMod.ProviderRegistry.catalog, 'ProviderRegistry.catalog must exist');
    assert.ok(regMod.ProviderRegistry.aiArtwork, 'ProviderRegistry.aiArtwork must exist');
    assert.ok(regMod.ProviderRegistry.monetization, 'ProviderRegistry.monetization must exist');
    assert.equal(Array.isArray(regMod.COLLABORATOR_AVATAR_COLORS), true);
    assert.equal(typeof regMod.computeSlotKeyForSnapshot, 'function');
    assert.equal(regMod.HybridCoopRoomAdapter, coopMod.HybridCoopRoomClient);
    assert.equal(typeof regMod.resolveCoopRoomWsUrl, 'function');
    assert.equal(typeof regMod.computeCoopReconnectDelayMs, 'function');
    assert.equal(typeof regMod.resolveCoopBroadcastChannelName, 'function');

    // -----------------------------------------------------------------------
    // 2. One Tap JWT validation & tokenless session rejection
    // -----------------------------------------------------------------------
    {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const validJwt = makeTestJwt({
        sub: 'user_jwt_1',
        name: 'Valid User',
        email: 'valid@example.com',
        iss: 'https://accounts.google.com',
        aud: 'client-id-expected',
        exp: futureExp,
      });
      const decodedValid = googleClientMod.decodeGoogleIdTokenPayload(validJwt, 'client-id-expected');
      assert.equal(decodedValid?.sub, 'user_jwt_1');
      assert.equal(decodedValid?.displayName, 'Valid User');

      // 2-part JWT must be rejected
      const twoPartJwt = makeTestJwt(
        {
          sub: 'u2',
          iss: 'https://accounts.google.com',
          aud: 'client-id-expected',
          exp: futureExp,
        },
        2
      );
      assert.equal(googleClientMod.decodeGoogleIdTokenPayload(twoPartJwt, 'client-id-expected'), null);

      // Expired exp must be rejected
      const expiredJwt = makeTestJwt({
        sub: 'u3',
        iss: 'https://accounts.google.com',
        aud: 'client-id-expected',
        exp: Math.floor(Date.now() / 1000) - 60,
      });
      assert.equal(googleClientMod.decodeGoogleIdTokenPayload(expiredJwt, 'client-id-expected'), null);

      // Invalid iss must be rejected
      const wrongIssJwt = makeTestJwt({
        sub: 'u4',
        iss: 'https://evil.example',
        aud: 'client-id-expected',
        exp: futureExp,
      });
      assert.equal(googleClientMod.decodeGoogleIdTokenPayload(wrongIssJwt, 'client-id-expected'), null);

      // Mismatched aud must be rejected when expectedClientId is provided
      const wrongAudJwt = makeTestJwt({
        sub: 'u5',
        iss: 'https://accounts.google.com',
        aud: 'other-client-id',
        exp: futureExp,
      });
      assert.equal(googleClientMod.decodeGoogleIdTokenPayload(wrongAudJwt, 'client-id-expected'), null);

      // One Tap credential without OAuth2 accessToken must return null (no tokenless session)
      ls.clear();
      ss.clear();
      googleClientMod.clearCachedGoogleSession();
      googleClientMod.setExplicitlySignedOut(false);
      globalThis.window.google = {
        accounts: {
          id: {
            initialize: (cfg) => {
              globalThis.window.__oneTapCb = cfg.callback;
            },
            prompt: () => {
              globalThis.window.__oneTapCb({ credential: validJwt });
            },
          },
          oauth2: {
            initTokenClient: (cfg) => ({
              requestAccessToken: () => {
                cfg.callback({ access_token: '' });
              },
            }),
          },
        },
      };

      const oneTapResult = await googleClientMod.attemptSilentOrOneTapGoogleSignIn('client-id-expected');
      assert.equal(
        oneTapResult,
        null,
        'One Tap without OAuth2 accessToken must return null rather than a tokenless session'
      );

      googleClientMod.setConfiguredGoogleClientId('client-id-expected');
      const authInst = new authMod.MultiProviderAuthManager();
      const autoResult = await authInst.attemptAutoSignIn();
      assert.equal(autoResult, null, 'AuthManager.attemptAutoSignIn must not sign in on tokenless One Tap');
      assert.equal(authInst.getCurrentIdentity().isAuthenticated, false);
      delete globalThis.window.google;
      delete globalThis.window.__oneTapCb;
    }

    // -----------------------------------------------------------------------
    // 3. OAuth HTTP 401 session invalidation -> AuthManager immediate guest downgrade
    // -----------------------------------------------------------------------
    {
      ls.clear();
      ss.clear();
      googleClientMod.clearCachedGoogleSession();
      googleClientMod.setExplicitlySignedOut(false);
      googleClientMod.saveCachedGoogleSession({
        accessToken: 'stale-google-token',
        expiresAt: Date.now() + 3600_000,
        sub: 'sub_401',
        displayName: 'Capy 401',
        email: 'capy401@example.com',
      });

      const authInst = new authMod.MultiProviderAuthManager();
      assert.equal(authInst.getCurrentIdentity().isAuthenticated, true);
      assert.equal(authInst.getCurrentIdentity().provider, 'google');
      assert.equal(authInst.hasActiveCloudToken(), true);

      const observedStates = [];
      const unsub = authInst.subscribe((id) => observedStates.push({ ...id }));

      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: { code: 401 } }), { status: 401 });

      await assert.rejects(
        () => googleClientMod.GoogleDriveAppDataClient.findFileByName('stale-google-token', 'capy_cloud_manifest_v2.json'),
        /401/
      );

      assert.equal(authInst.getCurrentIdentity().isAuthenticated, false, '401 must immediately downgrade to guest');
      assert.equal(authInst.getCurrentIdentity().provider, 'guest');
      assert.equal(authInst.hasActiveCloudToken(), false);
      assert.equal(observedStates.length >= 1, true, 'Auth subscribers must be notified immediately on 401');
      assert.equal(observedStates[observedStates.length - 1].isAuthenticated, false);
      assert.equal(
        googleClientMod.isExplicitlySignedOut(),
        false,
        'HTTP 401 invalidation must NOT set explicit sign-out flag'
      );
      unsub();
    }

    // -----------------------------------------------------------------------
    // 4. Google Drive HTTP 404 cached file-ID invalidation + single retry
    // -----------------------------------------------------------------------
    {
      ls.clear();
      ss.clear();
      googleClientMod.clearCachedGoogleSession();
      googleClientMod.saveCachedGoogleSession({
        accessToken: 'valid-drive-token',
        expiresAt: Date.now() + 3600_000,
        sub: 'sub_404',
        displayName: 'Drive Tester',
      });

      const driver = new driversMod.GoogleCloudDriver();
      const fetchCalls = [];
      let patch404Sent = false;

      globalThis.fetch = async (url, init = {}) => {
        const method = (init.method || 'GET').toUpperCase();
        fetchCalls.push({ method, url: String(url) });

        // First manifest write: findFileByName -> returns stale_id_1
        if (method === 'GET' && String(url).includes('/drive/v3/files?spaces=appDataFolder')) {
          if (!patch404Sent) {
            return new Response(
              JSON.stringify({ files: [{ id: 'stale_id_1', name: 'capy_cloud_manifest_v2.json' }] }),
              { status: 200 }
            );
          }
          // After 404 invalidation: file no longer exists on Drive
          return new Response(JSON.stringify({ files: [] }), { status: 200 });
        }

        // PATCH to stale_id_1 -> return 404
        if (method === 'PATCH' && String(url).includes('/stale_id_1')) {
          patch404Sent = true;
          return new Response('Not Found', { status: 404 });
        }

        // Retry POST -> create new file fresh_id_2
        if (method === 'POST' && String(url).includes('/upload/drive/v3/files?uploadType=multipart')) {
          return new Response(
            JSON.stringify({ id: 'fresh_id_2', name: 'capy_cloud_manifest_v2.json' }),
            { status: 200 }
          );
        }

        // Subsequent PATCH to fresh_id_2 -> 200 OK
        if (method === 'PATCH' && String(url).includes('/fresh_id_2')) {
          return new Response(
            JSON.stringify({ id: 'fresh_id_2', name: 'capy_cloud_manifest_v2.json' }),
            { status: 200 }
          );
        }

        return new Response('Unexpected', { status: 500 });
      };

      const manifest = {
        version: 2,
        updatedAt: Date.now(),
        devicePlayerId: 'google_sub_404',
        entries: {},
      };
      const ok1 = await driver.writeManifest(manifest);
      assert.equal(ok1, true, 'writeManifest must recover from cached ID HTTP 404 via lookup + POST retry');

      const ok2 = await driver.writeManifest({ ...manifest, updatedAt: Date.now() + 1 });
      assert.equal(ok2, true, 'Subsequent writeManifest must use refreshed file ID');
      assert.equal(
        fetchCalls.some((c) => c.method === 'PATCH' && c.url.includes('/fresh_id_2')),
        true,
        'Second write must PATCH the new fresh_id_2 instead of stale_id_1'
      );
    }

    // -----------------------------------------------------------------------
    // 5. Deletion tombstones, signOut() cross-account isolation,
    //    manifest resetEpoch merge & full content fingerprint hasPendingLocalChanges
    // -----------------------------------------------------------------------
    {
      ls.clear();
      ss.clear();

      // Create mock in-memory cloud driver for deterministic multi-device & multi-account tests
      let remoteManifestStore = null;
      let onWriteManifestHook = null;

      function createMockDriver(id, playerId, displayName) {
        let active = true;
        return {
          id,
          getDescriptor: () => ({
            id,
            displayName: 'Mock Cloud',
            storageName: 'Mock Cloud Storage',
            isSupported: true,
            isConfigured: true,
          }),
          hasActiveSession: () => active,
          restoreSession: () => (active ? { playerId, displayName, provider: id, isAuthenticated: true } : null),
          attemptAutoSignIn: async () => null,
          signIn: async () => {
            active = true;
            return { playerId, displayName, provider: id, isAuthenticated: true };
          },
          signOut: async () => {
            active = false;
          },
          readManifest: async () => (remoteManifestStore ? structuredClone(remoteManifestStore) : null),
          writeManifest: async (m) => {
            if (onWriteManifestHook) await onWriteManifestHook(m);
            remoteManifestStore = structuredClone(m);
            return true;
          },
          readSlotEnvelope: async () => null,
          writeSlotEnvelope: async () => true,
          readBinaryBlob: async () => null,
          writeBinaryBlob: async () => null,
        };
      }

      const authInst = new authMod.MultiProviderAuthManager();
      const cloudInst = new cloudMod.CloudLibrarySyncOrchestrator(authInst);
      authInst.onSignOut((prev) => cloudInst.clearLocalCloudCache(prev));

      const mockDriverA = createMockDriver('google', 'google_user_A', 'User A');
      authInst.registerDriver(mockDriverA);
      await authInst.signInWithProvider('google');

      // 5a. Manifest resetEpoch merge in pullRemoteLibraryManifest()
      const localResetToken = await codecMod.encodeProgressDeltaToken({
        version: 2,
        filledRegionIds: [5],
        resetEpoch: 2,
        updatedAt: 1000,
      });
      const remoteStaleToken = await codecMod.encodeProgressDeltaToken({
        version: 2,
        filledRegionIds: [1, 2, 3, 4],
        resetEpoch: 0,
        updatedAt: 9999,
      });
      const localSameEpochToken = await codecMod.encodeProgressDeltaToken({
        version: 2,
        filledRegionIds: [1, 2],
        resetEpoch: 1,
        updatedAt: 1000,
      });
      const remoteSameEpochToken = await codecMod.encodeProgressDeltaToken({
        version: 2,
        filledRegionIds: [3, 4],
        resetEpoch: 1,
        updatedAt: 2000,
      });

      const localSeedManifest = {
        version: 2,
        updatedAt: 1000,
        devicePlayerId: 'google_user_A',
        entries: {
          save_reset_slot: {
            snapshotId: 'reset_slot',
            slotKey: 'save_reset_slot',
            title: 'Reset Test',
            createdAt: 500,
            lastOpened: 1000,
            filledCount: 1,
            totalCount: 10,
            resetEpoch: 2,
            deltaToken: localResetToken,
          },
          save_union_slot: {
            snapshotId: 'union_slot',
            slotKey: 'save_union_slot',
            title: 'Union Test',
            createdAt: 500,
            lastOpened: 1000,
            filledCount: 2,
            totalCount: 10,
            resetEpoch: 1,
            deltaToken: localSameEpochToken,
          },
        },
      };
      await cloudInst.pushRemoteLibraryManifest(localSeedManifest);

      remoteManifestStore = {
        version: 2,
        updatedAt: 9999,
        devicePlayerId: 'google_user_A',
        entries: {
          save_reset_slot: {
            snapshotId: 'reset_slot',
            slotKey: 'save_reset_slot',
            title: 'Reset Test',
            createdAt: 500,
            lastOpened: 9999,
            filledCount: 4,
            totalCount: 10,
            deltaToken: remoteStaleToken,
          },
          save_union_slot: {
            snapshotId: 'union_slot',
            slotKey: 'save_union_slot',
            title: 'Union Test',
            createdAt: 500,
            lastOpened: 2000,
            filledCount: 2,
            totalCount: 10,
            resetEpoch: 1,
            deltaToken: remoteSameEpochToken,
          },
        },
      };

      const pulled = await cloudInst.pullRemoteLibraryManifest();
      const mergedResetDelta = await codecMod.decodeProgressDeltaToken(
        pulled.manifest.entries.save_reset_slot.deltaToken
      );
      assert.deepEqual(
        mergedResetDelta.filledRegionIds,
        [5],
        'Higher resetEpoch (2) must dominate older epoch (0) despite newer remote lastOpened'
      );
      assert.equal(mergedResetDelta.resetEpoch, 2);

      const mergedUnionDelta = await codecMod.decodeProgressDeltaToken(
        pulled.manifest.entries.save_union_slot.deltaToken
      );
      assert.deepEqual(
        [...mergedUnionDelta.filledRegionIds].sort((a, b) => a - b),
        [1, 2, 3, 4],
        'Same-epoch manifest merge must union filled regions from local and remote'
      );

      // 5b. Deletion tombstones: local delete prevents remote resurrection, remote tombstone deletes local, recreate clears tombstone
      ls.clear();
      remoteManifestStore = null;
      const baseNow = Date.now();
      const snap1 = {
        id: 'snap_del_1',
        title: 'Deleted Save',
        timestamp: baseNow - 10_000,
        lastOpened: baseNow - 10_000,
        filledCount: 2,
        totalCount: 10,
        filledRegionIds: [1, 2],
      };
      storageMod.StorageService.saveSnapshots([snap1]);
      await cloudInst.syncFullLibrary([snap1]);
      assert.ok(remoteManifestStore.entries.save_snap_del_1, 'Initial sync should upload snap_del_1');

      // Delete locally -> records tombstone
      await storageMod.StorageService.deleteSnapshot('snap_del_1');
      const localTombstonesAfterDelete = slotKeyMod.readLocalSlotTombstones();
      assert.ok(
        localTombstonesAfterDelete.save_snap_del_1 > 0,
        'deleteSnapshot must record local slot tombstone'
      );

      // Simulate remote still having old entry (without tombstone yet)
      remoteManifestStore.entries.save_snap_del_1.lastOpened = baseNow - 10_000;
      delete remoteManifestStore.tombstones;

      const afterDeleteSync = await cloudInst.syncFullLibrary([]);
      assert.equal(
        storageMod.StorageService.loadSnapshots().some((s) => s.id === 'snap_del_1'),
        false,
        'Deleted save must NOT be resurrected from remote manifest'
      );
      assert.equal(
        Boolean(remoteManifestStore.entries.save_snap_del_1),
        false,
        'Deleted save must be removed from pushed remote manifest'
      );
      assert.ok(
        remoteManifestStore.tombstones?.save_snap_del_1 > 0,
        'Deletion tombstone must be pushed to remote manifest'
      );
      assert.equal(afterDeleteSync.totalSavesSynced, 0);

      // Remote tombstone older than TOMBSTONE_SKEW_TOLERANCE_MS deletes Device B's stale local snapshot
      const staleLocalSnap = {
        id: 'snap_remote_del',
        title: 'Remote Deleted',
        timestamp: baseNow - cloudMod.TOMBSTONE_SKEW_TOLERANCE_MS - 8_000,
        lastOpened: baseNow - cloudMod.TOMBSTONE_SKEW_TOLERANCE_MS - 8_000,
        filledCount: 1,
        totalCount: 5,
        filledRegionIds: [1],
      };
      storageMod.StorageService.saveSnapshots([staleLocalSnap]);
      remoteManifestStore = {
        version: 2,
        updatedAt: baseNow - 2_000,
        devicePlayerId: 'google_user_A',
        entries: {},
        tombstones: { save_snap_remote_del: baseNow - 3_000 },
      };
      await cloudInst.syncFullLibrary([staleLocalSnap]);
      assert.equal(
        storageMod.StorageService.loadSnapshots().some((s) => s.id === 'snap_remote_del'),
        false,
        'Remote tombstone outside clock-skew tolerance must delete stale local snapshot on sync'
      );

      // 5b-1D: Remote historical tombstone T_old must NOT be inflated to Date.now()
      const tOld = Date.now() - 60_000;
      const staleHistSnap = {
        id: 'snap_hist_tomb',
        title: 'Historical Tombstone Target',
        timestamp: tOld - cloudMod.TOMBSTONE_SKEW_TOLERANCE_MS - 10_000,
        lastOpened: tOld - cloudMod.TOMBSTONE_SKEW_TOLERANCE_MS - 10_000,
        filledCount: 1,
        totalCount: 5,
        filledRegionIds: [1],
      };
      const histSlotKey = slotKeyMod.computeSlotKeyForSnapshot(staleHistSnap);
      storageMod.StorageService.saveSnapshots([staleHistSnap]);
      remoteManifestStore = {
        version: 2,
        updatedAt: tOld,
        devicePlayerId: 'google_user_A',
        entries: {},
        tombstones: { [histSlotKey]: tOld },
      };
      await cloudInst.syncFullLibrary([staleHistSnap]);
      assert.equal(
        storageMod.StorageService.loadSnapshots().some((s) => s.id === 'snap_hist_tomb'),
        false,
        'Historical remote tombstone outside clock-skew tolerance must still delete stale local snapshot'
      );
      assert.equal(
        remoteManifestStore.tombstones?.[histSlotKey],
        tOld,
        'Pushed manifest tombstone must preserve exact historical T_old and never inflate to Date.now()'
      );

      // Re-creating a slot with lastOpened > deletedAt clears the tombstone
      const recreatedSnap = {
        id: 'snap_remote_del',
        title: 'Recreated Save',
        timestamp: baseNow + 2_000,
        lastOpened: baseNow + 2_000,
        filledCount: 1,
        totalCount: 5,
        filledRegionIds: [2],
      };
      storageMod.StorageService.saveSnapshots([recreatedSnap]);
      await cloudInst.syncFullLibrary([recreatedSnap]);
      assert.ok(
        remoteManifestStore.entries.save_snap_remote_del,
        'Re-created snapshot newer than tombstone must sync normally'
      );
      assert.equal(
        remoteManifestStore.tombstones?.save_snap_remote_del,
        undefined,
        'Re-created snapshot newer than tombstone must clear the tombstone'
      );

      // 5c. Full content fingerprint hasPendingLocalChanges (without bumping resetEpoch)
      const fpSnap = {
        id: 'snap_fp_1',
        title: 'Original Title',
        timestamp: 7000,
        lastOpened: 7000,
        filledCount: 1,
        totalCount: 10,
        filledRegionIds: [1],
      };
      storageMod.StorageService.saveSnapshots([fpSnap]);
      remoteManifestStore = null;
      onWriteManifestHook = async () => {
        // Mutate filledRegionIds mid-push WITHOUT bumping resetEpoch
        storageMod.StorageService.saveSnapshots([
          { ...fpSnap, filledRegionIds: [1, 2], filledCount: 2, title: 'Edited Mid-Push' },
        ]);
      };
      const fpSyncResult = await cloudInst.syncFullLibrary([fpSnap]);
      onWriteManifestHook = null;
      assert.equal(
        fpSyncResult.hasPendingLocalChanges,
        true,
        'Mid-push region/title edit without resetEpoch bump must trigger hasPendingLocalChanges: true'
      );

      // 5d. signOut() cross-account isolation
      await cloudInst.pushEnvelope({
        slotKey: 'save_user_a_only',
        title: 'User A Private',
        deltaToken: localResetToken,
        filledCount: 1,
        totalCount: 10,
        updatedAt: Date.now(),
        devicePlayerId: 'google_user_A',
      });
      assert.equal(
        Array.from(ls._map.keys()).some(
          (k) =>
            k.includes(keysMod.CLOUD_VAULT_STORAGE_KEY) ||
            k.includes(keysMod.CLOUD_MANIFEST_STORAGE_KEY)
        ),
        true,
        'User A sync must populate local cloud vault/manifest cache'
      );

      await authInst.signOut();
      const remainingCloudKeys = Array.from(ls._map.keys()).filter(
        (k) =>
          k.includes(keysMod.CLOUD_VAULT_STORAGE_KEY) ||
          k.includes(keysMod.CLOUD_MANIFEST_STORAGE_KEY) ||
          k.includes(keysMod.CLOUD_TOMBSTONES_STORAGE_KEY)
      );
      assert.deepEqual(
        remainingCloudKeys,
        [],
        'signOut() must clear all cloud vault, manifest, and tombstone caches'
      );

      // User B signs in with empty remote & empty local snapshots -> must NOT see User A's saves
      storageMod.StorageService.saveSnapshots([]);
      remoteManifestStore = null;
      const mockDriverB = createMockDriver('google', 'google_user_B', 'User B');
      authInst.registerDriver(mockDriverB);
      await authInst.signInWithProvider('google');
      const userBSync = await cloudInst.syncFullLibrary([]);
      assert.equal(userBSync.totalSavesSynced, 0, 'User B must not inherit User A cloud saves');
      assert.equal(
        Boolean(remoteManifestStore?.entries?.save_fp_1),
        false,
        'User A saves must never upload to User B remote manifest'
      );

      // 5e-2D: HTTP 401 session invalidation must clear User A unscoped tombstones so User B's matching sample slot is not deleted
      ls.clear();
      ss.clear();
      remoteManifestStore = null;
      const mockDriverA401 = createMockDriver('google', 'google_user_A_401', 'User A 401');
      authInst.registerDriver(mockDriverA401);
      await authInst.signInWithProvider('google');
      assert.equal(authInst.getCurrentIdentity().isAuthenticated, true);

      const sampleSnapA = {
        id: 'sample_capy_a',
        sampleAssetPath: './samples/capy_shared.png',
        title: 'Shared Sample A',
        timestamp: Date.now() - 5_000,
        lastOpened: Date.now() - 5_000,
        filledCount: 1,
        totalCount: 5,
        filledRegionIds: [1],
      };
      const sharedSampleSlotKey = slotKeyMod.computeSlotKeyForSnapshot(sampleSnapA);
      storageMod.StorageService.saveSnapshots([sampleSnapA]);
      await storageMod.StorageService.deleteSnapshot('sample_capy_a');
      assert.ok(
        slotKeyMod.readLocalSlotTombstones()[sharedSampleSlotKey] > 0,
        'User A deleteSnapshot must record local tombstone prior to 401'
      );

      const prevFetchFor401 = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: { code: 401 } }), { status: 401 });
      try {
        await assert.rejects(
          () => googleClientMod.fetchGoogleUserProfile('expired-user-a-token'),
          /401/
        );
      } finally {
        globalThis.fetch = prevFetchFor401;
      }

      assert.equal(
        authInst.getCurrentIdentity().isAuthenticated,
        false,
        'HTTP 401 via fetchGoogleUserProfile must downgrade User A to guest'
      );
      assert.equal(
        googleClientMod.isExplicitlySignedOut(),
        false,
        'HTTP 401 must NOT set EXPLICIT_SIGNOUT_STORAGE_KEY'
      );

      const sampleSnapB = {
        id: 'sample_capy_b',
        sampleAssetPath: './samples/capy_shared.png',
        title: 'Shared Sample B',
        timestamp: Date.now() - 20_000,
        lastOpened: Date.now() - 20_000,
        filledCount: 2,
        totalCount: 5,
        filledRegionIds: [1, 2],
      };
      assert.equal(
        slotKeyMod.computeSlotKeyForSnapshot(sampleSnapA),
        slotKeyMod.computeSlotKeyForSnapshot(sampleSnapB),
        'sampleSnapA and sampleSnapB must map to the exact same colliding sample slot key'
      );
      storageMod.StorageService.saveSnapshots([sampleSnapB]);
      remoteManifestStore = null;
      const mockDriverB401 = createMockDriver('google', 'google_user_B_401', 'User B 401');
      authInst.registerDriver(mockDriverB401);
      await authInst.signInWithProvider('google');
      await cloudInst.syncFullLibrary([sampleSnapB]);

      assert.equal(
        storageMod.StorageService.loadSnapshots().length,
        1,
        'User B sample snapshot must NOT be deleted by User A tombstone after HTTP 401 session invalidation'
      );
      assert.equal(
        storageMod.StorageService.loadSnapshots()[0].id,
        'sample_capy_b',
        'User B sample snapshot must remain intact after syncFullLibrary'
      );

      // 5e-2D-sync401: HTTP 401 on Drive readManifest INSIDE syncFullLibrary() must abort without re-writing User A tombstones/manifest to guest keys
      ls.clear();
      ss.clear();
      googleClientMod.clearCachedGoogleSession();
      googleClientMod.setExplicitlySignedOut(false);
      googleClientMod.saveCachedGoogleSession({
        accessToken: 'expired-drive-token-user-a',
        sub: 'user_a_sync401',
        displayName: 'User A Sync401',
        expiresAt: Date.now() + 3_600_000,
      });

      const authSync401 = new authMod.MultiProviderAuthManager();
      const cloudSync401 = new cloudMod.CloudLibrarySyncOrchestrator(authSync401);
      authSync401.onSignOut((prev) => cloudSync401.clearLocalCloudCache(prev));

      assert.equal(
        authSync401.getCurrentIdentity().isAuthenticated,
        true,
        'User A should be authenticated via cached Google Drive session'
      );
      assert.equal(authSync401.getCurrentIdentity().provider, 'google');

      const sampleSnapSyncA = {
        id: 'sample_capy_sync401_a',
        sampleAssetPath: './samples/capy_sync401.png',
        title: 'Sync401 Sample A',
        timestamp: Date.now() - 5_000,
        lastOpened: Date.now() - 5_000,
        filledCount: 1,
        totalCount: 5,
        filledRegionIds: [1],
      };
      const sync401SlotKey = slotKeyMod.computeSlotKeyForSnapshot(sampleSnapSyncA);
      storageMod.StorageService.saveSnapshots([sampleSnapSyncA]);
      await storageMod.StorageService.deleteSnapshot('sample_capy_sync401_a');
      cloudSync401.recordSlotDeletion(sync401SlotKey);

      const prevFetchForSync401 = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: { code: 401, message: 'Invalid Credentials' } }), {
          status: 401,
        });
      try {
        await cloudSync401.syncFullLibrary([]);
      } finally {
        globalThis.fetch = prevFetchForSync401;
      }

      assert.equal(
        authSync401.getCurrentIdentity().isAuthenticated,
        false,
        'Drive readManifest 401 inside syncFullLibrary() must downgrade User A to guest'
      );
      assert.equal(
        googleClientMod.isExplicitlySignedOut(),
        false,
        'Drive readManifest 401 must NOT set EXPLICIT_SIGNOUT_STORAGE_KEY'
      );
      const remainingAfterSync401 = Array.from(ls._map.keys()).filter(
        (k) =>
          k.includes(keysMod.CLOUD_VAULT_STORAGE_KEY) ||
          k.includes(keysMod.CLOUD_MANIFEST_STORAGE_KEY) ||
          k.includes(keysMod.CLOUD_TOMBSTONES_STORAGE_KEY)
      );
      assert.deepEqual(
        remainingAfterSync401,
        [],
        'Drive readManifest 401 inside syncFullLibrary() must leave zero vault/manifest/tombstone keys in localStorage'
      );

      const sampleSnapSyncB = {
        id: 'sample_capy_sync401_b',
        sampleAssetPath: './samples/capy_sync401.png',
        title: 'Sync401 Sample B',
        timestamp: Date.now() - 20_000,
        lastOpened: Date.now() - 20_000,
        filledCount: 2,
        totalCount: 5,
        filledRegionIds: [1, 2],
      };
      assert.equal(
        slotKeyMod.computeSlotKeyForSnapshot(sampleSnapSyncA),
        slotKeyMod.computeSlotKeyForSnapshot(sampleSnapSyncB),
        'sampleSnapSyncA and sampleSnapSyncB must map to the exact same colliding sample slot key'
      );
      storageMod.StorageService.saveSnapshots([sampleSnapSyncB]);
      remoteManifestStore = null;
      const mockDriverBSync401 = createMockDriver('google', 'google_user_B_sync401', 'User B Sync401');
      authSync401.registerDriver(mockDriverBSync401);
      await authSync401.signInWithProvider('google');
      await cloudSync401.syncFullLibrary([sampleSnapSyncB]);

      assert.equal(
        storageMod.StorageService.loadSnapshots().length,
        1,
        'User B sample snapshot must survive syncFullLibrary after User A mid-sync Drive 401'
      );
      assert.equal(
        storageMod.StorageService.loadSnapshots()[0].id,
        'sample_capy_sync401_b',
        'User B sample snapshot must remain intact after User A mid-sync Drive 401'
      );
    }

    // -----------------------------------------------------------------------
    // 6. Malformed Co-op PAINT_EVENT / UNFILL_EVENT, prototype-key dispatch,
    //    participant cap (24) & WS peer pruning
    // -----------------------------------------------------------------------
    {
      const room = new coopMod.HybridCoopRoomClient();
      const selfPeer = {
        playerId: 'self_player',
        displayName: 'Self Capy',
        avatarColorHex: '#38bdf8',
        lastActiveAt: Date.now(),
      };
      await room.joinRoom('CAPY24', selfPeer);

      const receivedPaints = [];
      const receivedUnfills = [];
      room.onPaintEvent((ev) => receivedPaints.push(ev));
      room.onUnfillEvent((ev) => receivedUnfills.push(ev));

      const sender = {
        playerId: 'peer_1',
        displayName: 'Peer One',
        avatarColorHex: '#f59e0b',
        lastActiveAt: Date.now(),
        injectedSenderField: 'evil',
      };

      // Valid PAINT_EVENT with unexpected extra/nested keys -> extra keys stripped
      room.handleWireMessage(
        {
          type: 'PAINT_EVENT',
          roomCode: 'CAPY24',
          sender,
          paintEvent: {
            eventId: 'ev_clean_1',
            roomCode: 'CAPY24',
            playerId: 'peer_1',
            action: 'FILL',
            regionIds: [1, 2],
            paintedColors: { 1: 0xff112233 },
            timestamp: 123456,
            evil: { nested: 1 },
            extraPayload: 'smuggled',
          },
          sentAt: Date.now(),
        },
        'ws'
      );
      assert.equal(receivedPaints.length, 1);
      assert.equal('evil' in receivedPaints[0], false, 'Unexpected nested fields must be stripped');
      assert.equal('extraPayload' in receivedPaints[0], false);
      assert.deepEqual(receivedPaints[0].regionIds, [1, 2]);
      assert.equal(receivedPaints[0].paintedColors[1], 0xff112233);
      const storedPeer = room.getParticipants().find((p) => p.playerId === 'peer_1');
      assert.equal('injectedSenderField' in storedPeer, false, 'Sender object must be strictly whitelisted');

      // Malformed PAINT_EVENTs must be dropped
      for (const badPaint of [
        { eventId: 'ev_bad_action', action: 'HACK', regionIds: [1] },
        { eventId: 'ev_bad_region', action: 'FILL', regionIds: [-5] },
        { eventId: 'ev_bad_color', action: 'FILL', regionIds: [1], paintedColors: { abc: 123 } },
        { eventId: 'ev_bad_hex', action: 'FILL', regionIds: [1], avatarColorHex: 'javascript:x' },
        { eventId: 'ev_bad_ts', action: 'FILL', regionIds: [1], timestamp: Number.NaN },
      ]) {
        room.handleWireMessage(
          { type: 'PAINT_EVENT', roomCode: 'CAPY24', sender, paintEvent: badPaint, sentAt: Date.now() },
          'ws'
        );
      }
      assert.equal(receivedPaints.length, 1, 'All malformed PAINT_EVENT frames must be rejected');

      // Valid UNFILL_EVENT strips unexpected extra fields
      room.handleWireMessage(
        {
          type: 'UNFILL_EVENT',
          roomCode: 'CAPY24',
          sender,
          unfillEvent: {
            eventId: 'unfill_1',
            roomCode: 'CAPY24',
            senderId: 'peer_1',
            playerId: 'peer_1',
            regionIds: [7],
            injectedUnfill: 'bad',
          },
          sentAt: Date.now(),
        },
        'ws'
      );
      assert.equal(receivedUnfills.length, 1);
      assert.equal('injectedUnfill' in receivedUnfills[0], false, 'Unexpected UNFILL_EVENT fields must be stripped');

      // Prototype-chain keys must be ignored safely
      for (const protoType of ['toString', 'constructor', '__proto__', 'valueOf']) {
        assert.doesNotThrow(() => {
          room.handleWireMessage(
            { type: protoType, roomCode: 'CAPY24', sender, sentAt: Date.now() },
            'ws'
          );
        });
      }

      // Participant cap (MAX_COOP_PARTICIPANTS = 24) with oldest-non-self eviction
      for (let i = 0; i < 30; i++) {
        room.handleWireMessage(
          {
            type: 'HEARTBEAT',
            roomCode: 'CAPY24',
            sender: {
              playerId: `ws_peer_${i}`,
              displayName: `Peer ${i}`,
              avatarColorHex: '#34d399',
              lastActiveAt: Date.now() - (30 - i) * 1000,
            },
            sentAt: Date.now(),
          },
          'ws'
        );
        const p = room.participants.get(`ws_peer_${i}`);
        if (p) p.lastActiveAt = Date.now() - (30 - i) * 1000;
      }
      assert.equal(
        room.participants.size,
        coopMod.MAX_COOP_PARTICIPANTS,
        'Participant map must cap at MAX_COOP_PARTICIPANTS (24)'
      );
      assert.equal(room.participants.has('self_player'), true, 'selfParticipant must never be evicted');

      // WS peer pruning: retain 25s-old peer, prune > WS_PEER_STALE_MS peer
      const retainedId = Array.from(room.participants.keys()).find((id) => id !== 'self_player');
      const staleId = Array.from(room.participants.keys()).find(
        (id) => id !== 'self_player' && id !== retainedId
      );
      room.participants.get(retainedId).lastActiveAt = Date.now() - 25_000;
      room.participants.get(staleId).lastActiveAt = Date.now() - coopMod.WS_PEER_STALE_MS - 5_000;
      room.pruneStaleParticipants();
      assert.equal(room.participants.has(retainedId), true, '25s-old WS peer must be retained for DO hibernation');
      assert.equal(room.participants.has(staleId), false, 'WS peer older than WS_PEER_STALE_MS must be pruned');

      room.leaveRoom();
    }

    // -----------------------------------------------------------------------
    // 7. Android Play Games isolation (attemptAutoSignIn & signInWithGoogle)
    //    + Play Games chunk-transfer helpers + reportSwallowed telemetry
    // -----------------------------------------------------------------------
    {
      ls.clear();
      ss.clear();
      googleClientMod.clearCachedGoogleSession();
      googleClientMod.setExplicitlySignedOut(false);
      googleClientMod.setConfiguredGoogleClientId('android-test-client-id');

      let gisCalled = false;
      globalThis.window.google = {
        accounts: {
          id: {
            initialize: () => {
              gisCalled = true;
            },
            prompt: () => {
              gisCalled = true;
            },
          },
          oauth2: {
            initTokenClient: () => {
              gisCalled = true;
              return { requestAccessToken: () => {} };
            },
          },
        },
      };
      globalThis.window.CapyAndroid = {
        isPlayGamesConfigured: () => false,
        signInPlayGames: () => null,
      };

      const androidAuth = new authMod.MultiProviderAuthManager();
      const autoRes = await androidAuth.attemptAutoSignIn();
      assert.equal(autoRes, null);
      assert.equal(gisCalled, false, 'Android attemptAutoSignIn must NEVER invoke GIS One Tap/OAuth');

      await assert.rejects(() => androidAuth.signInWithGoogle(), /PLAY_GAMES_UNCONFIGURED/);
      assert.equal(gisCalled, false, 'Android signInWithGoogle must NEVER fall back to GIS popup');

      delete globalThis.window.CapyAndroid;
      delete globalThis.window.google;

      // Play Games chunk helpers & timeout constant
      assert.equal(
        driversMod.PLAY_GAMES_CHUNK_PULL_TIMEOUT_MS,
        10_000,
        'PLAY_GAMES_CHUNK_PULL_TIMEOUT_MS must be raised to 10_000 ms'
      );
      assert.equal(driversMod.isSafePlayGamesBlobKey('pgblob_save_1'), true);
      assert.equal(driversMod.isSafePlayGamesBlobKey('pgblob_../escape'), false);
      assert.equal(driversMod.parsePlayGamesBlobRef('pgblob:pgblob_../bad:1:10'), null);

      const sampleBytes = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
      const chunks = driversMod.sliceBytesToBase64Chunks(sampleBytes, 3);
      assert.equal(chunks.length, 3);
      const reassembled = driversMod.assembleBase64Chunks(chunks, sampleBytes.byteLength, 'pgblob_unit');
      assert.deepEqual(Array.from(reassembled), Array.from(sampleBytes));

      // Telemetry verification for swallowed catches
      telemetryMod.clearSwallowedErrorLog();
      coopMod.resolveCoopRoomWsUrl('not a valid url :::');
      googleClientMod.decodeGoogleIdTokenPayload('a.%%%invalid%%%.c');
      driversMod.assembleBase64Chunks(['!!!not-base64!!!'], 4, 'pgblob_bad');
      const scopes = telemetryMod.getSwallowedErrorLog().map((entry) => entry.scope);
      assert.equal(scopes.includes('coop.resolveWsUrl'), true, 'coop.resolveWsUrl catch must call reportSwallowed');
      assert.equal(
        scopes.includes('GoogleCloudSyncClient.decodeGoogleIdTokenPayload'),
        true,
        'decodeGoogleIdTokenPayload catch must call reportSwallowed'
      );
      assert.equal(
        scopes.includes('PlayGamesAndroidDriver.decodeChunkBase64'),
        true,
        'assembleBase64Chunks catch must call reportSwallowed'
      );
    }
  } finally {
    globalThis.window = prevWindow;
    globalThis.localStorage = prevLocalStorage;
    globalThis.sessionStorage = prevSessionStorage;
    globalThis.fetch = prevFetch;
  }
}
