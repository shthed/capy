/**
 * [Unit 06] CRDT resetEpoch dominance, >180 KB pgblob chunking & NativeBridge fast-fail guards.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export async function runCrdtNativeBridgeTests({ vite, projectRoot, logUnitStart, logUnitPass }) {
    const codec = await vite.ssrLoadModule('/src/services/CapyCodec.ts');
    const shareLinkMod = await vite.ssrLoadModule('/src/services/ShareLinkService.ts');
    const providerMod = await vite.ssrLoadModule('/src/services/providers/ProviderRegistry.ts');
    logUnitStart('Testing CRDT resetEpoch dominance, >180 KB pgblob chunking & NativeBridge fast-fail guards...');
    {
      const driversMod = await vite.ssrLoadModule('/src/services/providers/CloudProviderDrivers.ts');
      const nativeBridgeMod = await vite.ssrLoadModule('/src/services/NativeBridge.ts');

      // 1. F8 (F-01): ProgressDeltaV2 resetEpoch token round-trip & monotonic CRDT epoch dominance
      const resetToken = await codec.encodeProgressDeltaToken({
        version: 2,
        sourceRef: { kind: 'sample', uri: './assets/capybara.webp' },
        filledRegionIds: [4, 9],
        resetEpoch: 3,
        updatedAt: 1_750_000_000_000,
      });
      const decodedReset = await codec.decodeProgressDeltaToken(resetToken);
      assert.equal(decodedReset.resetEpoch, 3, 'ProgressDeltaV2 codec must round-trip resetEpoch');
      assert.deepEqual(decodedReset.filledRegionIds, [4, 9]);

      // Higher remote resetEpoch dominates stale pre-reset local regions (0 resurrection)
      const mergedRemoteReset = codec.mergeProgressDeltas(
        { version: 2, filledRegionIds: [1, 2, 3, 4, 5], resetEpoch: 0, updatedAt: 1000 },
        { version: 2, filledRegionIds: [], resetEpoch: 1, updatedAt: 2000 }
      );
      assert.equal(mergedRemoteReset.resetEpoch, 1);
      assert.deepEqual(
        mergedRemoteReset.filledRegionIds,
        [],
        'Higher remote resetEpoch must clear stale pre-reset regions with zero resurrection'
      );

      // Higher local resetEpoch dominates stale pre-reset cloud regions (0 resurrection)
      const mergedLocalReset = codec.mergeProgressDeltas(
        { version: 2, filledRegionIds: [11], resetEpoch: 2, updatedAt: 3000 },
        { version: 2, filledRegionIds: [1, 2, 3, 4, 5, 6], resetEpoch: 1, updatedAt: 2500 }
      );
      assert.equal(mergedLocalReset.resetEpoch, 2);
      assert.deepEqual(
        mergedLocalReset.filledRegionIds,
        [11],
        'Higher local resetEpoch must reject stale lower-epoch cloud regions'
      );

      // Equal resetEpoch preserves lossless set-union CRDT behavior
      const mergedSameEpoch = codec.mergeProgressDeltas(
        { version: 2, filledRegionIds: [2, 5], resetEpoch: 2, updatedAt: 3000 },
        { version: 2, filledRegionIds: [5, 8], resetEpoch: 2, updatedAt: 3100 }
      );
      assert.equal(mergedSameEpoch.resetEpoch, 2);
      assert.deepEqual(mergedSameEpoch.filledRegionIds, [2, 5, 8]);

      // ShareLinkService URL round-trips resetEpoch cleanly
      const builtResetShare = await shareLinkMod.buildShareProgressUrl({
        sourceRef: { kind: 'sample', uri: 'assets/capybara.webp' },
        filledRegionIds: [7],
        resetEpoch: 4,
      });
      const parsedResetShare = await shareLinkMod.parseShareLinkFromUrl(builtResetShare.url);
      assert.equal(parsedResetShare.delta?.resetEpoch, 4, 'ShareLinkService must preserve resetEpoch in #s= URLs');

      // CrdtCloudSaveAdapter.syncProgress dominates stale pre-reset slot envelopes
      const prevLsF8 = globalThis.localStorage;
      const lsMapF8 = new Map();
      globalThis.localStorage = {
        getItem: (k) => (lsMapF8.has(k) ? lsMapF8.get(k) : null),
        setItem: (k, v) => lsMapF8.set(k, String(v)),
        removeItem: (k) => lsMapF8.delete(k),
      };
      try {
        await providerMod.ProviderRegistry.cloudSave.syncProgress(
          'slot_reset_epoch_test',
          'Capybara',
          { version: 2, filledRegionIds: [1, 2, 3, 4], updatedAt: 1000 },
          20
        );
        const syncedAfterReset = await providerMod.ProviderRegistry.cloudSave.syncProgress(
          'slot_reset_epoch_test',
          'Capybara',
          { version: 2, filledRegionIds: [], resetEpoch: 1, updatedAt: 2000 },
          20
        );
        assert.equal(syncedAfterReset.mergedDelta.resetEpoch, 1);
        assert.deepEqual(
          syncedAfterReset.mergedDelta.filledRegionIds,
          [],
          'CrdtCloudSaveAdapter.syncProgress must honor higher resetEpoch without resurrecting old fills'
        );
      } finally {
        if (prevLsF8 === undefined) {
          delete globalThis.localStorage;
        } else {
          globalThis.localStorage = prevLsF8;
        }
      }

      // 2. F9 (F-02): PlayGamesAndroidDriver > 180 KB multi-chunk binary writeBinaryBlob & readBinaryBlob
      const prevWindow = globalThis.window;
      const chunkStore = new Map();
      globalThis.window = {
        CapyAndroid: {
          saveCloudBinaryChunk(blobKey, chunkIndex, totalChunks, base64Chunk) {
            if (chunkIndex < 0 || chunkIndex >= totalChunks) return false;
            chunkStore.set(`${blobKey}_part_${chunkIndex}`, base64Chunk);
            if (chunkIndex === totalChunks - 1) {
              for (let k = totalChunks; k < 32; k++) {
                chunkStore.delete(`${blobKey}_part_${k}`);
              }
            }
            return true;
          },
          loadCloudBinaryChunk(blobKey, chunkIndex) {
            return chunkStore.get(`${blobKey}_part_${chunkIndex}`) ?? null;
          },
          saveCloudSnapshot(slotKey, payloadJson) {
            chunkStore.set(slotKey, payloadJson);
            return true;
          },
          loadCloudSnapshot(slotKey) {
            return chunkStore.get(slotKey) ?? null;
          },
        },
        addEventListener() {},
        removeEventListener() {},
      };
      nativeBridgeMod.NativeBridge.attachWindowCallbacks();
      try {
        const pgDriver = new driversMod.PlayGamesAndroidDriver();
        const largeBinary = new Uint8Array(420_000);
        for (let i = 0; i < largeBinary.length; i++) {
          largeBinary[i] = (i * 29 + 13) & 0xff;
        }
        const blobRef = await pgDriver.writeBinaryBlob('save_hd_custom', 'save.capy', largeBinary);
        assert.equal(
          blobRef,
          'pgblob:pgblob_save_hd_custom:3:420000',
          '420 KB custom photo save must split across 3 x 180 KB Play Games chunks'
        );
        assert.equal(nativeBridgeMod.NativeBridge.loadCloudBinaryChunk('pgblob_save_hd_custom', 2) !== null, true);

        const restoredBinary = await pgDriver.readBinaryBlob(blobRef);
        assert.ok(restoredBinary, 'PlayGamesAndroidDriver.readBinaryBlob must reassemble 420 KB binary');
        assert.equal(restoredBinary.byteLength, 420_000);
        let diffBytes = 0;
        for (let i = 0; i < largeBinary.length; i++) {
          if (restoredBinary[i] !== largeBinary[i]) diffBytes++;
        }
        assert.equal(diffBytes, 0, 'Reassembled 420 KB Play Games binary must be bit-exact');

        // Overwrite with smaller 2-chunk (200 KB) payload and verify stale part_2 is pruned
        const smallerBinary = largeBinary.subarray(0, 200_000);
        const smallerRef = await pgDriver.writeBinaryBlob('save_hd_custom', 'save.capy', smallerBinary);
        assert.equal(smallerRef, 'pgblob:pgblob_save_hd_custom:2:200000');
        assert.equal(
          nativeBridgeMod.NativeBridge.loadCloudBinaryChunk('pgblob_save_hd_custom', 2),
          null,
          'Overwriting with fewer chunks must prune stale trailing chunk slots'
        );

        // Corrupt/mismatched/missing chunk resilience must return null cleanly without throwing
        assert.equal(
          await pgDriver.readBinaryBlob('pgblob:pgblob_save_hd_custom:2:999999'),
          null,
          'Mismatched expectedBytes in pgblob ref must return null cleanly'
        );
        chunkStore.set('pgblob_save_hd_custom_part_1', '%%%not_valid_base64%%%');
        assert.equal(
          await pgDriver.readBinaryBlob(smallerRef),
          null,
          'Corrupted Base64 chunk in PlayGamesAndroidDriver must return null cleanly'
        );
        chunkStore.delete('pgblob_save_hd_custom_part_1');
        assert.equal(
          await pgDriver.readBinaryBlob(smallerRef),
          null,
          'Missing chunk in PlayGamesAndroidDriver must return null cleanly'
        );

        // 3. Unconfigured / Unavailable Play Games fallback must fail fast (no 8s hang)
        const prevCapyAndroid = globalThis.window.CapyAndroid;
        try {
          globalThis.window.CapyAndroid = {
            isPlayGamesConfigured: () => false,
            signInPlayGames: () => null,
          };
          assert.equal(pgDriver.getDescriptor().isConfigured, false);
          const autoSignStart = Date.now();
          assert.equal(await pgDriver.attemptAutoSignIn(), null);
          assert.equal(Date.now() - autoSignStart < 500, true, 'Unconfigured Play Games auto-sign-in must return null immediately');
          let unconfErr = null;
          const signInStart = Date.now();
          try {
            await pgDriver.signIn();
          } catch (err) {
            unconfErr = err;
          }
          assert.equal(unconfErr?.message, 'PLAY_GAMES_UNCONFIGURED');
          assert.equal(Date.now() - signInStart < 500, true, 'Unconfigured Play Games signIn must fail fast');

          // Configured Play Games that fires native error callback must reject immediately
          globalThis.window.CapyAndroid = {
            isPlayGamesConfigured: () => true,
            signInPlayGames: () => {
              setTimeout(() => {
                globalThis.window.__capyReceivePlayGamesError?.('PLAY_GAMES_UNAVAILABLE');
              }, 10);
              return null;
            },
          };
          const failStart = Date.now();
          let unavailErr = null;
          try {
            await pgDriver.signIn();
          } catch (err) {
            unavailErr = err;
          }
          assert.equal(unavailErr?.message, 'PLAY_GAMES_UNAVAILABLE');
          assert.equal(Date.now() - failStart < 500, true, 'Play Games error callback must reject signIn immediately');

          // 4. Cold-start bridge callbacks arriving before listener mount must flush on subscribe
          globalThis.window.__capyReceiveSharedImage?.('Early Photo', 'data:image/png;base64,AA==');
          globalThis.window.__capyReceiveDeepLink?.('https://capypaint.com/#s=early_token');
          globalThis.window.__capyReceivePlayGamesProfile?.(
            JSON.stringify({ playerId: 'pg_early', displayName: 'Early Capy' })
          );
          globalThis.window.__capyReceivePlayGamesError?.('PLAY_GAMES_EARLY_ERR');
          globalThis.window.__capyReceiveCloudSnapshot?.('slot_early', '{"v":1}');

          const receivedShared = [];
          const receivedDeep = [];
          const receivedProfiles = [];
          const receivedErrors = [];
          const receivedSnaps = [];
          const offShared = nativeBridgeMod.NativeBridge.onSharedImage((t, d) =>
            receivedShared.push({ t, d })
          );
          const offDeep = nativeBridgeMod.NativeBridge.onDeepLink((u) => receivedDeep.push(u));
          const offProf = nativeBridgeMod.NativeBridge.onPlayGamesProfile((p) =>
            receivedProfiles.push(p)
          );
          const offErr = nativeBridgeMod.NativeBridge.onPlayGamesError((e) =>
            receivedErrors.push(e)
          );
          const offSnap = nativeBridgeMod.NativeBridge.onCloudSnapshot((k, v) =>
            receivedSnaps.push({ k, v })
          );
          try {
            assert.deepEqual(receivedShared, [
              { t: 'Early Photo', d: 'data:image/png;base64,AA==' },
            ]);
            assert.deepEqual(receivedDeep, ['https://capypaint.com/#s=early_token']);
            assert.deepEqual(receivedProfiles, [{ playerId: 'pg_early', displayName: 'Early Capy' }]);
            assert.deepEqual(receivedErrors, ['PLAY_GAMES_EARLY_ERR']);
            assert.deepEqual(receivedSnaps, [{ k: 'slot_early', v: '{"v":1}' }]);
          } finally {
            offShared();
            offDeep();
            offProf();
            offErr();
            offSnap();
          }

          // 5. Behavioral check: Android WebView routes signInWithGoogle strictly to play_games_v2 without GIS OAuth fallback
          // (SettingsModal DOM hiding of APK cards and release-channel-card under window.CapyAndroid is verified in [E2E 03] & [E2E 05])
          {
            let gisPopupCalls = 0;
            const prevGoogle = globalThis.window.google;
            const prevSignInAndroid = globalThis.window.CapyAndroid;
            const prevSignInLs = globalThis.localStorage;
            const authLsMap = new Map();
            globalThis.localStorage = {
              getItem: (k) => (authLsMap.has(k) ? authLsMap.get(k) : null),
              setItem: (k, v) => authLsMap.set(k, String(v)),
              removeItem: (k) => authLsMap.delete(k),
            };
            globalThis.window.google = {
              accounts: {
                oauth2: {
                  initTokenClient: () => {
                    gisPopupCalls++;
                    return { requestAccessToken: () => {} };
                  },
                },
              },
            };
            globalThis.window.CapyAndroid = {
              isPlayGamesConfigured: () => true,
              signInPlayGames: () => {
                setTimeout(() => {
                  globalThis.window.__capyReceivePlayGamesError?.('PLAY_GAMES_CANCELED');
                }, 5);
                return null;
              },
            };
            nativeBridgeMod.NativeBridge.attachWindowCallbacks();
            try {
              let routedErr = null;
              try {
                await providerMod.ProviderRegistry.auth.signInWithGoogle();
              } catch (err) {
                routedErr = err;
              }
              assert.equal(routedErr?.message, 'PLAY_GAMES_CANCELED');
              assert.equal(
                gisPopupCalls,
                0,
                'Android signInWithGoogle error must reject instead of falling back to GIS popup'
              );

              globalThis.window.CapyAndroid = {
                isPlayGamesConfigured: () => true,
                signInPlayGames: () =>
                  JSON.stringify({ playerId: 'pgs_android_routed', displayName: 'Play Games Capy' }),
              };
              const signedInProfile = await providerMod.ProviderRegistry.auth.signInWithGoogle();
              assert.equal(signedInProfile.provider, 'play_games_v2');
              assert.equal(signedInProfile.playerId, 'pgs_android_routed');
              assert.equal(
                gisPopupCalls,
                0,
                'Android signInWithGoogle success must use play_games_v2 without GIS popup'
              );
              await providerMod.ProviderRegistry.auth.signOut();
            } finally {
              if (prevSignInLs === undefined) delete globalThis.localStorage;
              else globalThis.localStorage = prevSignInLs;
              if (prevSignInAndroid === undefined) delete globalThis.window.CapyAndroid;
              else globalThis.window.CapyAndroid = prevSignInAndroid;
              if (prevGoogle === undefined) delete globalThis.window.google;
              else globalThis.window.google = prevGoogle;
            }
          }
          assert.equal(
            nativeBridgeMod.isValidAndroidDeepLink('https://paint.capyboop.com/#s=test'),
            true,
            'isValidAndroidDeepLink must allow paint.capyboop.com share links'
          );
          assert.equal(
            nativeBridgeMod.isValidAndroidDeepLink('https://capypaint.com/privacy-policy.html'),
            false,
            'isValidAndroidDeepLink must exclude static /privacy-policy.html legal page'
          );
          assert.equal(
            nativeBridgeMod.isValidAndroidDeepLink('https://paint.capyboop.com/privacy-policy.html'),
            false,
            'isValidAndroidDeepLink must exclude paint.capyboop.com /privacy-policy.html legal page'
          );
          assert.equal(
            typeof nativeBridgeMod.NativeBridge.showRewardedAd,
            'undefined',
            'NativeBridge.showRewardedAd must be removed for 100% ad-free Play Store parity'
          );
          const androidLedger = providerMod.ProviderRegistry.monetization.getLedger();
          assert.equal(
            androidLedger.adFreePlatform,
            true,
            'ConsentRewardedAdAdapter.getLedger().adFreePlatform must stay true even when NativeBridge.isAndroid is true'
          );
          const rewardedRes = await providerMod.ProviderRegistry.monetization.watchRewardedAdForCredits();
          assert.equal(rewardedRes.granted, 0, 'Store-clean build must grant 0 ad credits');
          assert.equal(rewardedRes.ledger.adFreePlatform, true);

          // Returning-user stale localStorage community ideas & consent checks must stay store-clean
          const prevIdeasLs = globalThis.localStorage;
          const ideasMap = new Map();
          globalThis.localStorage = {
            getItem: (k) => (ideasMap.has(k) ? ideasMap.get(k) : null),
            setItem: (k, v) => ideasMap.set(k, String(v)),
            removeItem: (k) => ideasMap.delete(k),
          };
          try {
            const seededIdeas = providerMod.ProviderRegistry.catalog.getCommunityIdeas();
            assert.equal(
              seededIdeas.length >= 2 && seededIdeas.every((idea) => idea.votes === 0 && !idea.votedByMe),
              true,
              'SEED_COMMUNITY_IDEAS must have votes: 0 with zero fabricated vote counts'
            );
            assert.equal(
              seededIdeas[0].createdAt >= seededIdeas[1].createdAt,
              true,
              'getCommunityIdeas must sort newest-first by createdAt'
            );
            ideasMap.set(
              'capy_community_ideas_v1',
              JSON.stringify([
                {
                  id: 'legacy_old',
                  title: 'Old Legacy Idea',
                  prompt: 'Old idea with stale votes from pre-3.0.31 cache',
                  category: 'Animals',
                  tags: ['Animals'],
                  authorName: 'River Capy',
                  authorId: 'legacy_1',
                  votes: 24,
                  votedByMe: true,
                  status: 'queued',
                  createdAt: 1700000000000,
                },
                {
                  id: 'legacy_new',
                  title: 'Newer Legacy Idea',
                  prompt: 'Newer idea with stale votes from pre-3.0.31 cache',
                  category: 'Nature',
                  tags: ['Nature'],
                  authorName: 'Forest Sprout',
                  authorId: 'legacy_2',
                  votes: 17,
                  votedByMe: false,
                  status: 'curated',
                  createdAt: 1720000000000,
                },
              ])
            );
            const normalizedLegacy = providerMod.ProviderRegistry.catalog.getCommunityIdeas();
            assert.equal(normalizedLegacy.length, 2);
            assert.equal(normalizedLegacy[0].id, 'legacy_new', 'Legacy ideas must sort newest-first');
            assert.equal(
              normalizedLegacy.every((idea) => idea.votes === 0 && idea.votedByMe === false),
              true,
              'Legacy returning-user community ideas must normalize votes=0 and votedByMe=false'
            );
            const afterToggle = providerMod.ProviderRegistry.catalog.toggleVoteIdea('legacy_new');
            assert.equal(
              afterToggle.every((idea) => idea.votes === 0 && idea.votedByMe === false),
              true,
              'toggleVoteIdea must not fabricate votes in store-clean build'
            );
            const consentLedger = providerMod.ProviderRegistry.monetization.setPersonalizedAdsConsent(true);
            assert.equal(consentLedger.adFreePlatform, true);
            assert.equal(consentLedger.personalizedAdsConsent, false);
          } finally {
            if (prevIdeasLs === undefined) {
              delete globalThis.localStorage;
            } else {
              globalThis.localStorage = prevIdeasLs;
            }
          }

          // Play Store listing & MainActivity Play Games deferral invariants (when repo docs/app exist)
          const playStoreListingPath = path.resolve(projectRoot, '../docs/play-store/PLAY_STORE_LISTING.md');
          if (fs.existsSync(playStoreListingPath)) {
            const listingDoc = fs.readFileSync(playStoreListingPath, 'utf8');
            const shortDescMatch = listingDoc.match(/\*\*Short Description \(`<= 80` chars\)\*\*:\s*`([^`]+)`/);
            assert.ok(shortDescMatch, 'PLAY_STORE_LISTING.md must include backticked Short Description');
            assert.equal(
              shortDescMatch[1].length <= 80,
              true,
              `PLAY_STORE_LISTING.md Short Description exceeds 80 chars (${shortDescMatch[1].length})`
            );
            assert.equal(
              /\*\*Category\*\*:\s*`Puzzle`/.test(listingDoc),
              true,
              'PLAY_STORE_LISTING.md Category must be Puzzle'
            );
            assert.equal(
              listingDoc.toLowerCase().includes('gallery packs'),
              false,
              'PLAY_STORE_LISTING.md must not advertise non-existent gallery packs'
            );
            assert.equal(
              listingDoc.includes('[https://capypaint.com/privacy-policy.html](https://capypaint.com/privacy-policy.html)') &&
                listingDoc.toLowerCase().includes('developer contact email'),
              true,
              'PLAY_STORE_LISTING.md must have clickable Privacy Policy links and Developer contact email ops note'
            );
            assert.equal(
              listingDoc.includes('foldable_1_1_inner.png') &&
                listingDoc.includes('foldable_4_3_inner.png') &&
                listingDoc.includes('foldable_10_16_outer.png'),
              true,
              'PLAY_STORE_LISTING.md must document all 3 Google Play foldable screenshots (1:1, 4:3, 10:16)'
            );
          }
          const mainActivityPath = path.resolve(
            projectRoot,
            '../app/src/main/java/com/capyboop/paint/MainActivity.kt'
          );
          if (fs.existsSync(mainActivityPath)) {
            const mainActivitySrc = fs.readFileSync(mainActivityPath, 'utf8');
            const initMatch = mainActivitySrc.match(/private fun initializePlayGamesIfConfigured\(\)\s*\{[\s\S]*?\n    \}/);
            assert.ok(initMatch, 'MainActivity.kt must define initializePlayGamesIfConfigured()');
            assert.equal(
              initMatch[0].includes('PlayGamesSdk.initialize(this)') &&
                !initMatch[0].includes('requestPlayGamesSignIn') &&
                !initMatch[0].includes('isAuthenticated') &&
                !initMatch[0].includes('pullSnapshotFromPlayGames'),
              true,
              'MainActivity.initializePlayGamesIfConfigured() must only initialize SDK without cold-start auto sign-in'
            );
            const onPageFinishedMatch = mainActivitySrc.match(/override fun onPageFinished\([^)]*\)\s*\{[\s\S]*?\n                \}/);
            assert.ok(onPageFinishedMatch, 'MainActivity.kt must define onPageFinished()');
            assert.equal(
              onPageFinishedMatch[0].includes('deliverCachedPlayGamesProfileIfNeeded'),
              false,
              'MainActivity.onPageFinished() must not push cached Play Games profile on cold launch'
            );
          }
        } finally {
          globalThis.window.CapyAndroid = prevCapyAndroid;
        }
      } finally {
        globalThis.window = prevWindow;
      }
    }
    logUnitPass('CRDT resetEpoch anti-resurrection, >180 KB Play Games pgblob chunking & NativeBridge guards verified.');
}
