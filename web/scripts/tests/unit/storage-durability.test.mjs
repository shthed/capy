/**
 * [Unit 15] .changelog fragments, compile-changelog.mjs, StorageNamespace, UserSettings,
 * FeatureOffersService, TargetSpotlightOverlay & StorageService durability Groups A-N.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';

export async function runStorageDurabilityTests({ vite, projectRoot, logUnitStart }) {
    logUnitStart('Testing .changelog fragments, compile-changelog.mjs, StorageNamespace, FeatureOffersService & StorageService...');
    const sanityMod = await import('../../sanity.mjs');
    const compileMod = await import('../../compile-changelog.mjs');

    const validFrag = sanityMod.parseChangelogFragment(
      '---\nbump: minor\nepic: EPIC-3\ntask: TASK-2.5\n---\nAdd crisp new brush stroke effect\n',
      '.changelog/brush.md'
    );
    assert.equal(validFrag.bump, 'minor');
    assert.equal(validFrag.task, 'TASK-2.5');
    assert.throws(() => sanityMod.parseChangelogFragment('---\nbump: invalid\n---\nBad bump\n'));
    assert.throws(() => sanityMod.parseChangelogFragment('---\nbump: patch\n---\nLine 1\nLine 2\n'));
    const maxLenSummary = 'x'.repeat(sanityMod.MAX_CHANGELOG_FRAGMENT_LENGTH);
    assert.equal(
      sanityMod.parseChangelogFragment(`---\nbump: patch\n---\n${maxLenSummary}\n`, '.changelog/max-ok.md').summary
        .length,
      sanityMod.MAX_CHANGELOG_FRAGMENT_LENGTH
    );
    assert.throws(
      () =>
        sanityMod.parseChangelogFragment(
          `---\nbump: patch\n---\n${maxLenSummary}y\n`,
          '.changelog/too-long.md'
        ),
      /summary is too long/i
    );

    assert.equal(compileMod.computeNextSemVer('3.0.7', 'patch').version, '3.0.8');
    assert.equal(compileMod.computeNextSemVer('3.0.7', 'minor').version, '3.1.0');
    assert.equal(compileMod.computeNextSemVer('3.0.7', 'major').version, '4.0.0');

    const tmpCompileRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-changelog-compile-'));
    try {
      fs.mkdirSync(path.join(tmpCompileRepo, 'web/src'), { recursive: true });
      fs.mkdirSync(path.join(tmpCompileRepo, 'app'), { recursive: true });
      fs.mkdirSync(path.join(tmpCompileRepo, '.changelog'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpCompileRepo, 'web/package.json'),
        JSON.stringify({ name: 'capy-paint', version: '3.0.7' }, null, 2),
        'utf8'
      );
      fs.writeFileSync(
        path.join(tmpCompileRepo, 'web/package-lock.json'),
        JSON.stringify(
          {
            name: 'capy-paint',
            version: '3.0.7',
            lockfileVersion: 3,
            packages: { '': { name: 'capy-paint', version: '3.0.7' } },
          },
          null,
          2
        ),
        'utf8'
      );
      fs.writeFileSync(
        path.join(tmpCompileRepo, 'web/src/version.ts'),
        `export const APP_VERSION = '3.0.7';\n`,
        'utf8'
      );
      fs.writeFileSync(
        path.join(tmpCompileRepo, 'app/build.gradle.kts'),
        `versionCode = 30007\nversionName = "3.0.7"\n`,
        'utf8'
      );
      fs.writeFileSync(
        path.join(tmpCompileRepo, 'CHANGELOG.md'),
        `### 3.0.7 - 2026-11-12 (Beta)\n\n- [#495](../../pull/495) Beta item\n\n### 3.0.1 - 2026-11-10 (Production)\n\n- [#488](../../pull/488) Prod item\n`,
        'utf8'
      );
      fs.writeFileSync(path.join(tmpCompileRepo, '.changelog/README.md'), '# Fragments\n', 'utf8');
      fs.writeFileSync(
        path.join(tmpCompileRepo, '.changelog/01-fix.md'),
        '---\nbump: patch\npr: 496\ntask: TASK-2.5\n---\nFix edge zoom jitter\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(tmpCompileRepo, '.changelog/02-feat.md'),
        '---\nbump: minor\nepic: EPIC-3\n---\nAdd loupe magnifier\n',
        'utf8'
      );

      assert.equal(sanityMod.validateChangelogFragments(tmpCompileRepo), 2);
      const betaCompileRes = compileMod.compileChangelog({
        repoRoot: tmpCompileRepo,
        dateStr: '2026-11-13',
        prMap: { '02-feat': 497 },
      });
      assert.equal(betaCompileRes.version, '3.1.0');
      assert.equal(betaCompileRes.compiledCount, 2);
      assert.equal(betaCompileRes.appendedSameDay, false);
      assert.equal(JSON.parse(fs.readFileSync(path.join(tmpCompileRepo, 'web/package.json'), 'utf8')).version, '3.1.0');
      const lockAfterBump = JSON.parse(
        fs.readFileSync(path.join(tmpCompileRepo, 'web/package-lock.json'), 'utf8')
      );
      assert.equal(lockAfterBump.version, '3.1.0');
      assert.equal(lockAfterBump.packages[''].version, '3.1.0');
      assert.equal(fs.readFileSync(path.join(tmpCompileRepo, 'web/src/version.ts'), 'utf8').includes("'3.1.0'"), true);
      assert.equal(fs.readFileSync(path.join(tmpCompileRepo, 'app/build.gradle.kts'), 'utf8').includes('versionCode = 30100'), true);
      assert.equal(fs.readFileSync(path.join(tmpCompileRepo, 'app/build.gradle.kts'), 'utf8').includes('versionName = "3.1.0"'), true);
      assert.equal(fs.existsSync(path.join(tmpCompileRepo, '.changelog/01-fix.md')), false);
      assert.equal(fs.existsSync(path.join(tmpCompileRepo, '.changelog/README.md')), true);
      const compiledCl = fs.readFileSync(path.join(tmpCompileRepo, 'CHANGELOG.md'), 'utf8');
      assert.equal(compiledCl.startsWith('### 3.1.0 - 2026-11-13 (Beta)\n'), true);
      assert.match(compiledCl, /\n- \[#496\]\(\.\.\/\.\.\/pull\/496\) Fix edge zoom jitter\n/);
      assert.match(compiledCl, /\n- \[#497\]\(\.\.\/\.\.\/pull\/497\) Add loupe magnifier\n/);
      assert.equal(compiledCl.includes('### 3.0.7 - 2026-11-12\n'), true);
      assert.equal(compiledCl.includes('### 3.0.1 - 2026-11-10 (Production)\n'), true);

      // Same-day Beta re-compile appends into existing heading without double-bumping version
      fs.writeFileSync(
        path.join(tmpCompileRepo, '.changelog/03-same-day.md'),
        '---\nbump: patch\npr: 499\n---\nPolish palette swatch contrast\n',
        'utf8'
      );
      const sameDayRes = compileMod.compileChangelog({
        repoRoot: tmpCompileRepo,
        dateStr: '2026-11-13',
      });
      assert.equal(sameDayRes.version, '3.1.0');
      assert.equal(sameDayRes.compiledCount, 1);
      assert.equal(sameDayRes.appendedSameDay, true);
      assert.equal(JSON.parse(fs.readFileSync(path.join(tmpCompileRepo, 'web/package.json'), 'utf8')).version, '3.1.0');
      const sameDayCl = fs.readFileSync(path.join(tmpCompileRepo, 'CHANGELOG.md'), 'utf8');
      assert.equal(sameDayCl.startsWith('### 3.1.0 - 2026-11-13 (Beta)\n'), true);
      assert.equal((sameDayCl.match(/^### 3\.1\.0 - 2026-11-13 \(Beta\)$/gm) || []).length, 1);
      assert.match(
        sameDayCl,
        /\n- \[#499\]\(\.\.\/\.\.\/pull\/499\) Polish palette swatch contrast\n- \[#496\]\(\.\.\/\.\.\/pull\/496\)/
      );

      // Same-day Beta compile with minor bump cuts a new version instead of appending into existing (Beta)
      fs.writeFileSync(
        path.join(tmpCompileRepo, '.changelog/04-same-day-minor.md'),
        '---\nbump: minor\npr: 500\n---\nAdd custom brush presets\n',
        'utf8'
      );
      const sameDayMinorRes = compileMod.compileChangelog({
        repoRoot: tmpCompileRepo,
        dateStr: '2026-11-13',
      });
      assert.equal(sameDayMinorRes.version, '3.2.0');
      assert.equal(sameDayMinorRes.compiledCount, 1);
      assert.equal(sameDayMinorRes.appendedSameDay, false);
      assert.equal(JSON.parse(fs.readFileSync(path.join(tmpCompileRepo, 'web/package.json'), 'utf8')).version, '3.2.0');
      const sameDayMinorCl = fs.readFileSync(path.join(tmpCompileRepo, 'CHANGELOG.md'), 'utf8');
      assert.equal(sameDayMinorCl.startsWith('### 3.2.0 - 2026-11-13 (Beta)\n'), true);
      assert.equal(sameDayMinorCl.includes('### 3.1.0 - 2026-11-13\n'), true);

      // Promote to Production, Beta
      const promoRes = compileMod.compileChangelog({ repoRoot: tmpCompileRepo, promote: true });
      assert.equal(promoRes.promoted, true);
      const promotedCl = fs.readFileSync(path.join(tmpCompileRepo, 'CHANGELOG.md'), 'utf8');
      assert.equal(promotedCl.startsWith('### 3.2.0 - 2026-11-13 (Production, Beta)\n'), true);
      assert.equal(promotedCl.includes('### 3.0.1 - 2026-11-10\n'), true);

      // Same-day compile after --promote must cut a new (Beta) version and leave (Production) untouched
      fs.writeFileSync(
        path.join(tmpCompileRepo, '.changelog/05-post-promote.md'),
        '---\nbump: patch\npr: 501\n---\nFix post-release tooltip alignment\n',
        'utf8'
      );
      const postPromoteRes = compileMod.compileChangelog({
        repoRoot: tmpCompileRepo,
        dateStr: '2026-11-13',
      });
      assert.equal(postPromoteRes.version, '3.2.1');
      assert.equal(postPromoteRes.compiledCount, 1);
      assert.equal(postPromoteRes.appendedSameDay, false);
      assert.equal(JSON.parse(fs.readFileSync(path.join(tmpCompileRepo, 'web/package.json'), 'utf8')).version, '3.2.1');
      const postPromoteCl = fs.readFileSync(path.join(tmpCompileRepo, 'CHANGELOG.md'), 'utf8');
      assert.equal(postPromoteCl.startsWith('### 3.2.1 - 2026-11-13 (Beta)\n'), true);
      assert.equal(postPromoteCl.includes('### 3.2.0 - 2026-11-13 (Production)\n'), true);

      // Malformed web/package-lock.json must fail cleanly before mutating web/package.json
      fs.writeFileSync(path.join(tmpCompileRepo, 'web/package-lock.json'), '{ broken json', 'utf8');
      fs.writeFileSync(
        path.join(tmpCompileRepo, '.changelog/06-bad-lock.md'),
        '---\nbump: patch\npr: 502\n---\nGuard lockfile write order\n',
        'utf8'
      );
      assert.throws(
        () => compileMod.compileChangelog({ repoRoot: tmpCompileRepo, dateStr: '2026-11-14' }),
        SyntaxError
      );
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(tmpCompileRepo, 'web/package.json'), 'utf8')).version,
        '3.2.1',
        'web/package.json must remain unmodified when web/package-lock.json fails to parse'
      );
      fs.rmSync(path.join(tmpCompileRepo, '.changelog/06-bad-lock.md'), { force: true });
      fs.writeFileSync(
        path.join(tmpCompileRepo, 'web/package-lock.json'),
        `${JSON.stringify({ name: 'capy-web', version: '3.2.1', lockfileVersion: 3, packages: { '': { version: '3.2.1' } } }, null, 2)}\n`,
        'utf8'
      );

      // Refuse promoting an (Alpha) top heading
      fs.writeFileSync(
        path.join(tmpCompileRepo, 'CHANGELOG.md'),
        `### 3.2.1 - 2026-11-13 (Alpha)\n\n- [#498](../../pull/498) Alpha preview\n\n### 3.2.0 - 2026-11-13 (Production)\n\n- [#488](../../pull/488) Prod\n`,
        'utf8'
      );
      assert.throws(() => compileMod.compileChangelog({ repoRoot: tmpCompileRepo, promote: true }));
    } finally {
      fs.rmSync(tmpCompileRepo, { recursive: true, force: true });
    }

    // Verify StorageNamespace isolation + StorageService UserSettings enum round-trips
    const nsMod = await vite.ssrLoadModule('/src/services/StorageNamespace.ts');
    const storageMod = await vite.ssrLoadModule('/src/services/StorageService.ts');
    assert.deepEqual(nsMod.resolveStorageNamespace('/capy/', 'https://capypaint.com', ''), {
      channel: 'stable',
      isSandboxed: false,
      sandboxSuffix: '',
      dbName: 'capy_game_storage_v8',
    });
    assert.deepEqual(nsMod.resolveStorageNamespace('/capy/beta/', 'https://example.github.io', ''), {
      channel: 'beta',
      isSandboxed: true,
      sandboxSuffix: '__sandbox_beta',
      dbName: 'capy_game_storage_v8_beta',
    });
    assert.deepEqual(nsMod.resolveStorageNamespace('/capy/alpha/495/', 'https://example.github.io', ''), {
      channel: 'alpha',
      isSandboxed: true,
      sandboxSuffix: '__sandbox_alpha',
      dbName: 'capy_game_storage_v8_alpha',
    });
    assert.equal(
      nsMod.resolveScopedStorageKey('capy_snapshots_v8', '/capy/beta/', 'https://example.github.io', '?capy_sandbox=0'),
      'capy_snapshots_v8'
    );
    assert.equal(
      nsMod.resolveScopedBackupKey('capy_user_settings_v8', '/capy/alpha/495/', 'https://example.github.io', ''),
      'capy_user_settings_v8__sandbox_alpha'
    );
    assert.equal(
      nsMod.resolveScopedDbName('/capy/', 'https://capypaint.com', '?capy_sandbox=1'),
      'capy_game_storage_v8_stable'
    );

    const prevLs = globalThis.localStorage;
    const prevSsrWin = globalThis.window;
    const mockStorage = new Map();
    const mockBackups = new Map();
    const resetDurabilityState = () => {
      delete globalThis.window.webkit;
      globalThis.localStorage = {
        getItem: (k) => (mockStorage.has(k) ? mockStorage.get(k) : null),
        setItem: (k, v) => mockStorage.set(k, String(v)),
        removeItem: (k) => mockStorage.delete(k),
      };
      globalThis.window.CapyAndroid = {
        saveBackup: (k, v) => {
          mockBackups.set(k, String(v));
          return true;
        },
        loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
      };
      for (const loc of [
        { pathname: '/', origin: 'http://127.0.0.1:3000', search: '' },
        { pathname: '/capy/beta/', origin: 'https://example.github.io', search: '' },
      ]) {
        globalThis.window.location = loc;
        storageMod.StorageService.clearActiveState();
        storageMod.StorageService.saveSnapshots([], { allowEmptyBackup: true, immediateBackup: true });
        storageMod.StorageService.saveSettings(storageMod.DEFAULT_SETTINGS);
      }
      globalThis.window.location = { pathname: '/', origin: 'http://127.0.0.1:3000', search: '' };
      storageMod.StorageService.flushPendingBackups();
      mockStorage.clear();
      mockBackups.clear();
    };
    globalThis.localStorage = {
      getItem: (k) => (mockStorage.has(k) ? mockStorage.get(k) : null),
      setItem: (k, v) => mockStorage.set(k, String(v)),
      removeItem: (k) => mockStorage.delete(k),
    };
    globalThis.window = { location: { pathname: '/', origin: 'http://127.0.0.1:3000', search: '' } };
    try {
      assert.equal(storageMod.DEFAULT_SETTINGS.regionColorMode, 'DETAIL');
      assert.equal(storageMod.DEFAULT_SETTINGS.paletteSort, 'HUE');
      assert.equal(storageMod.DEFAULT_SETTINGS.fatFingerAssist, true);
      assert.equal(storageMod.DEFAULT_SETTINGS.touchReachRadiusPx, 22);
      assert.equal(storageMod.DEFAULT_SETTINGS.hintColorArgb, 0xfff59e0b);
      assert.equal(storageMod.DEFAULT_SETTINGS.autoReplayOnLoad, false);
      assert.equal(storageMod.DEFAULT_SETTINGS.raisePaletteDock, true);
      assert.equal(storageMod.DEFAULT_SETTINGS.textScale, 1.0);
      assert.equal(storageMod.DEFAULT_SETTINGS.uiScale, 1.0);
      assert.equal('showSavePreviews' in storageMod.DEFAULT_SETTINGS, false);
      storageMod.StorageService.saveSettings({
        ...storageMod.DEFAULT_SETTINGS,
        difficulty: 'NORMAL',
        paletteSort: 'HUE',
        highlightStyle: 'CENTROID_GLOW',
        fatFingerAssist: false,
        touchReachRadiusPx: 34,
        textScale: 1.35,
        uiScale: 1.2,
      });
      const loadedNormalHue = storageMod.StorageService.loadSettings();
      assert.equal(loadedNormalHue.difficulty, 'NORMAL');
      assert.equal(loadedNormalHue.paletteSort, 'HUE');
      assert.equal(loadedNormalHue.highlightStyle, 'CENTROID_GLOW');
      assert.equal(loadedNormalHue.fatFingerAssist, false);
      assert.equal(loadedNormalHue.touchReachRadiusPx, 34);
      assert.equal(loadedNormalHue.textScale, 1.35);
      assert.equal(loadedNormalHue.uiScale, 1.2);
      assert.equal(loadedNormalHue.largeText, true);

      // Verify legacy { largeText: true } without textScale/uiScale migrates to 1.25 / 1.25
      mockStorage.set(
        'capy_user_settings_v8',
        JSON.stringify({ largeText: true })
      );
      const migratedLargeText = storageMod.StorageService.loadSettings();
      assert.equal(migratedLargeText.textScale, 1.25);
      assert.equal(migratedLargeText.uiScale, 1.25);
      assert.equal(migratedLargeText.largeText, true);

      // Verify textScale [0.85, 1.5] and uiScale [0.85, 1.4] clamping and largeText sync
      mockStorage.set(
        'capy_user_settings_v8',
        JSON.stringify({ textScale: 0.4, uiScale: 2.5 })
      );
      const clampedScales = storageMod.StorageService.loadSettings();
      assert.equal(clampedScales.textScale, 0.85);
      assert.equal(clampedScales.uiScale, 1.4);
      assert.equal(clampedScales.largeText, true);

      mockStorage.set(
        'capy_user_settings_v8',
        JSON.stringify({ textScale: 0.9, uiScale: 0.95, largeText: true })
      );
      const scaledDown = storageMod.StorageService.loadSettings();
      assert.equal(scaledDown.textScale, 0.9);
      assert.equal(scaledDown.uiScale, 0.95);
      assert.equal(scaledDown.largeText, false);

      // Verify legacy showSavePreviews key in stored JSON is safely ignored on load
      mockStorage.set(
        'capy_user_settings_v8',
        JSON.stringify({ showSavePreviews: true, autoReplayOnLoad: true })
      );
      const legacyLoaded = storageMod.StorageService.loadSettings();
      assert.equal('showSavePreviews' in legacyLoaded, false);
      assert.equal(legacyLoaded.autoReplayOnLoad, true);

      // Verify [8, 40] clamping and absent fatFingerAssist fallback to DEFAULT_SETTINGS.fatFingerAssist (true) across both NORMAL & EASY
      mockStorage.set(
        'capy_user_settings_v8',
        JSON.stringify({ difficulty: 'NORMAL', touchReachRadiusPx: 99 })
      );
      const clampedHighNormal = storageMod.StorageService.loadSettings();
      assert.equal(clampedHighNormal.touchReachRadiusPx, 40);
      assert.equal(clampedHighNormal.fatFingerAssist, true);

      // Verify explicit fatFingerAssist: false opt-out is preserved across reloads in NORMAL mode
      mockStorage.set(
        'capy_user_settings_v8',
        JSON.stringify({ difficulty: 'NORMAL', fatFingerAssist: false })
      );
      const explicitOptOutNormal = storageMod.StorageService.loadSettings();
      assert.equal(explicitOptOutNormal.difficulty, 'NORMAL');
      assert.equal(explicitOptOutNormal.fatFingerAssist, false);

      mockStorage.set(
        'capy_user_settings_v8',
        JSON.stringify({ difficulty: 'EASY', touchReachRadiusPx: 2 })
      );
      const clampedLowEasy = storageMod.StorageService.loadSettings();
      assert.equal(clampedLowEasy.touchReachRadiusPx, 8);
      assert.equal(clampedLowEasy.fatFingerAssist, true);

      storageMod.StorageService.saveSettings({
        ...storageMod.DEFAULT_SETTINGS,
        paletteSort: 'LIGHTNESS',
      });
      assert.equal(storageMod.StorageService.loadSettings().paletteSort, 'LIGHTNESS');

      // Verify FeatureOffersService persistence, NativeBridge backup fallback, channel sandboxing, and OnboardingTutorial step mapping
      const offersMod = await vite.ssrLoadModule('/src/services/FeatureOffersService.ts');
      const tutorialMod = await vite.ssrLoadModule('/src/components/OnboardingTutorial.tsx');
      assert.equal(offersMod.FEATURE_OFFER_IDS.length, 9);
      assert.equal(tutorialMod.TUTORIAL_STEPS.length, 12);
      assert.equal(tutorialMod.TUTORIAL_STEPS[7]?.key, 'free_color');
      assert.equal(tutorialMod.TUTORIAL_STEPS[7]?.modalTab, 1);
      assert.equal(tutorialMod.TUTORIAL_STEPS[8]?.key, 'create_gallery');
      assert.equal(tutorialMod.TUTORIAL_STEPS[8]?.modalTab, 3);
      assert.equal(tutorialMod.TUTORIAL_STEPS[9]?.key, 'saves_export');
      assert.equal(tutorialMod.TUTORIAL_STEPS[9]?.modalTab, 4);
      assert.equal(tutorialMod.TUTORIAL_STEPS[10]?.key, 'settings');
      assert.equal(tutorialMod.TUTORIAL_STEPS[10]?.modalTab, 1);
      assert.equal(tutorialMod.TUTORIAL_STEPS[11]?.key, 'hints');
      assert.equal(tutorialMod.TUTORIAL_STEPS[11]?.modalTab, 2);
      assert.equal(offersMod.FEATURE_OFFERS.settings_hints_tip?.tutorialStepIndex, 10);
      for (const id of offersMod.FEATURE_OFFER_IDS) {
        const offer = offersMod.FEATURE_OFFERS[id];
        assert.equal(
          offer.tutorialStepIndex >= 0 && offer.tutorialStepIndex < tutorialMod.TUTORIAL_STEPS.length,
          true,
          `Offer ${id} tutorialStepIndex (${offer.tutorialStepIndex}) must be in [0..${tutorialMod.TUTORIAL_STEPS.length - 1}]`
        );
      }

      globalThis.window.CapyAndroid = {
        saveBackup: (k, v) => {
          mockBackups.set(k, String(v));
          return true;
        },
        loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
      };
      offersMod.FeatureOffersService.resetSeenOffers();
      assert.equal(offersMod.FeatureOffersService.loadSeenOffers().size, 0);
      assert.equal(offersMod.FeatureOffersService.hasSeenOffer('paint_mode'), false);
      offersMod.FeatureOffersService.markOfferSeen('paint_mode');
      offersMod.FeatureOffersService.markOfferSeen('saves_export');
      assert.equal(offersMod.FeatureOffersService.hasSeenOffer('paint_mode'), true);
      assert.equal(offersMod.FeatureOffersService.hasSeenOffer('saves_export'), true);
      assert.equal(mockBackups.has('capy_feature_offers_v1'), true);

      // Rehydrate localStorage from NativeBridge backup when localStorage key is cleared
      mockStorage.delete('capy_feature_offers_v1');
      assert.equal(offersMod.FeatureOffersService.hasSeenOffer('paint_mode'), true);
      assert.equal(mockStorage.has('capy_feature_offers_v1'), true);

      // Ignore unknown/legacy/malformed entries in localStorage
      mockStorage.set('capy_feature_offers_v1', JSON.stringify(['unknown_offer', 42, 'cloud_coop', 'saves_export']));
      const filteredOffers = offersMod.FeatureOffersService.loadSeenOffers();
      assert.equal(filteredOffers.size, 1);
      assert.equal(filteredOffers.has('saves_export'), true);

      // Verify Play Store Cloud/Co-op UI gating (hidden by default; opt-in via ?coop=1, ?room=, or capy_dev_cloud_coop_ui)
      const nsMod = await vite.ssrLoadModule('/src/services/StorageNamespace.ts');
      assert.equal(nsMod.isCloudCoopUiEnabled('', null), false);
      assert.equal(nsMod.isCloudCoopUiEnabled('?coop=1', null), true);
      assert.equal(nsMod.isCloudCoopUiEnabled('?room=ABC123', null), true);
      assert.equal(nsMod.isCloudCoopUiEnabled('', '1'), true);
      assert.equal(nsMod.isCloudCoopUiEnabled('?coop=0', '1'), false);

      // Verify /capy/beta/ sandbox key isolation
      globalThis.window.location = { pathname: '/capy/beta/', origin: 'https://shthed.github.io', search: '' };
      assert.equal(offersMod.FeatureOffersService.hasSeenOffer('paint_mode'), false);
      offersMod.FeatureOffersService.markOfferSeen('free_color');
      assert.equal(mockStorage.has('capy_feature_offers_v1__sandbox_beta'), true);
      assert.equal(mockBackups.has('capy_feature_offers_v1__sandbox_beta'), true);
      offersMod.FeatureOffersService.resetSeenOffers();
      assert.equal(offersMod.FeatureOffersService.hasSeenOffer('free_color'), false);

      // Verify TargetSpotlightOverlay specs and geometry helpers
      const spotlightMod = await vite.ssrLoadModule('/src/components/TargetSpotlightOverlay.tsx');
      for (const step of tutorialMod.TUTORIAL_STEPS) {
        const specs = spotlightMod.TUTORIAL_STEP_TARGETS[step.key];
        assert.equal(
          Array.isArray(specs) && specs.length > 0 && Boolean(specs[0]?.selector),
          true,
          `TUTORIAL_STEP_TARGETS must define target(s) for ${step.key}`
        );
      }
      assert.equal(
        spotlightMod.TUTORIAL_STEP_TARGETS.replay[0]?.selector,
        '[data-testid="replay-controls-window"]',
        'replay spotlight target must prioritize replay-controls-window when active'
      );
      for (const offerId of offersMod.FEATURE_OFFER_IDS) {
        const specs = spotlightMod.FEATURE_OFFER_TARGETS[offerId];
        assert.equal(
          Array.isArray(specs) && specs.length > 0 && Boolean(specs[0]?.selector),
          true,
          `FEATURE_OFFER_TARGETS must define target(s) for ${offerId}`
        );
      }
      const clampedRect = spotlightMod.clampRectToBounds(
        { left: -25, top: 760, width: 140, height: 80 },
        { width: 360, height: 780 },
        4
      );
      assert.equal(clampedRect.left >= 4, true);
      assert.equal(clampedRect.top + clampedRect.height <= 776, true);

      const overlappedRings = spotlightMod.preventRingOverlap(
        [
          { left: 239, top: 6, width: 30, height: 30 },
          { left: 265, top: 6, width: 30, height: 30 },
        ],
        2
      );
      assert.equal(
        overlappedRings[0].left + overlappedRings[0].width <= overlappedRings[1].left - 1.5,
        true,
        `Adjacent rings must separate cleanly without colliding: ${JSON.stringify(overlappedRings)}`
      );

      const topConn = spotlightMod.computeSpotlightConnector(
        { left: 400, top: 76, width: 448, height: 140 },
        { left: 1100, top: 10, width: 36, height: 36 }
      );
      assert.ok(topConn, 'Expected valid connector for topbar target');
      assert.equal(topConn.d.startsWith('M '), true);
      assert.equal(topConn.arrowPoints.split(' ').length, 3);
      assert.equal(topConn.endY < topConn.startY, true, 'Connector to topbar must point upward');

      const bottomConn = spotlightMod.computeSpotlightConnector(
        { left: 400, top: 76, width: 448, height: 140 },
        { left: 590, top: 720, width: 58, height: 52 }
      );
      assert.ok(bottomConn, 'Expected valid connector for bottom dock target');
      assert.equal(bottomConn.endY > bottomConn.startY, true, 'Connector to dock must point downward');

      const sideConn = spotlightMod.computeSpotlightConnector(
        { left: 400, top: 76, width: 448, height: 140 },
        { left: 1200, top: 120, width: 44, height: 44 }
      );
      assert.ok(sideConn, 'Expected valid connector for side target');
      assert.equal(sideConn.endX > sideConn.startX, true, 'Connector to right side must point right');

      // Verify StorageService inline preview stripping, legacy migration, debounced backups, QuotaExceededError notifications, and PuzzleWorkerService code-split
      globalThis.window.location = { pathname: '/', origin: 'http://127.0.0.1:3000', search: '' };
      const previewFixture = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';
      storageMod.StorageService.saveSnapshots([
        {
          id: 'snap-strip-1',
          title: 'Preview Strip Test',
          timestamp: 1000,
          lastOpened: 2000,
          filledCount: 2,
          totalCount: 10,
          filledRegionIds: [1, 2],
          config: storageMod.DEFAULT_SETTINGS.generatorConfig,
          previewDataUrl: previewFixture,
        },
      ]);
      const rawStrippedSnaps = JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]');
      assert.equal(rawStrippedSnaps.length, 1);
      assert.equal(
        'previewDataUrl' in rawStrippedSnaps[0],
        false,
        'saveSnapshots must strip inline previewDataUrl from localStorage'
      );
      const cachedLoaded = storageMod.StorageService.loadSnapshots();
      assert.equal(cachedLoaded[0]?.previewDataUrl, previewFixture, 'loadSnapshots must keep cached previewDataUrl in memory');

      // Legacy snapshot entry with inline previewDataUrl migrates out of localStorage on loadSnapshots()
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([
          {
            id: 'snap-legacy-migrate',
            title: 'Legacy Inline Preview',
            timestamp: 1500,
            lastOpened: 2500,
            filledCount: 1,
            totalCount: 5,
            filledRegionIds: [3],
            config: storageMod.DEFAULT_SETTINGS.generatorConfig,
            previewDataUrl: previewFixture,
          },
        ])
      );
      const migratedLoaded = storageMod.StorageService.loadSnapshots();
      assert.equal(migratedLoaded[0]?.previewDataUrl, previewFixture);
      const postMigrateRaw = JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]');
      assert.equal(
        'previewDataUrl' in postMigrateRaw[0],
        false,
        'loadSnapshots must migrate legacy inline previewDataUrl out of localStorage'
      );

      // Debounced backup writes coalesce and flush synchronously via flushPendingBackups()
      mockBackups.delete('capy_user_settings_v8');
      storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, zoomSensitivity: 1.5 });
      storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, zoomSensitivity: 1.75 });
      assert.equal(mockBackups.has('capy_user_settings_v8'), false, 'Backup writes must debounce before timer/flush');
      storageMod.StorageService.flushPendingBackups();
      assert.equal(
        JSON.parse(mockBackups.get('capy_user_settings_v8') || '{}').zoomSensitivity,
        1.75,
        'flushPendingBackups must coalesce and flush the latest backup payload'
      );

      // QuotaExceededError triggers registered listeners cleanly
      const quotaEvents = [];
      const unsubQuota = storageMod.StorageService.onQuotaWarning((w) => quotaEvents.push(w));
      const origLsSet = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_user_settings_v8') {
          const err = new Error('Storage quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return origLsSet(k, v);
      };
      try {
        storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, largeText: true });
      } finally {
        globalThis.localStorage.setItem = origLsSet;
        unsubQuota();
      }
      assert.equal(quotaEvents.length >= 1, true, 'QuotaExceededError must notify quota warning listeners');
      assert.equal(quotaEvents[0]?.reason, 'quota');

      // StorageService P0 save durability: backup recency/validity/richness comparison, empty-wipe protection, and explicit deletes/clears
      const withMockedNow = (nowMs, fn) => {
        const realNow = Date.now;
        Date.now = () => nowMs;
        try {
          return fn();
        } finally {
          Date.now = realNow;
        }
      };
      const makeSnap = (id, overrides = {}) => ({
        id,
        title: id,
        timestamp: 1000,
        lastOpened: 1000,
        filledCount: 1,
        totalCount: 10,
        filledRegionIds: [1],
        zoomScale: 1,
        panOffsetX: 0,
        panOffsetY: 0,
        ...overrides,
      });

      // Group A: Native backup wins over missing, empty, older, or un-timestamped localStorage and self-heals
      resetDurabilityState();
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-bak-1', { lastOpened: 3000, filledCount: 3, filledRegionIds: [1, 2, 3] })])
      );
      let recoveredSnaps = storageMod.StorageService.loadSnapshots();
      assert.equal(recoveredSnaps.length, 1);
      assert.equal(recoveredSnaps[0]?.id, 'snap-bak-1');
      assert.equal(recoveredSnaps[0]?.filledCount, 3);
      assert.equal(JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]')[0]?.id, 'snap-bak-1');

      resetDurabilityState();
      mockStorage.set('capy_snapshots_v8', '[]');
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-bak-empty-ls', { lastOpened: 3000, filledCount: 4, filledRegionIds: [1, 2, 3, 4] })])
      );
      recoveredSnaps = storageMod.StorageService.loadSnapshots();
      assert.equal(recoveredSnaps.length, 1);
      assert.equal(recoveredSnaps[0]?.id, 'snap-bak-empty-ls');
      assert.equal(recoveredSnaps[0]?.filledCount, 4);
      assert.equal(JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]')[0]?.id, 'snap-bak-empty-ls');

      resetDurabilityState();
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-recency', { timestamp: 1000, lastOpened: 1000, filledCount: 1, filledRegionIds: [1] })])
      );
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-recency', { timestamp: 1000, lastOpened: 5000, filledCount: 5, filledRegionIds: [1, 2, 3, 4, 5] })])
      );
      recoveredSnaps = storageMod.StorageService.loadSnapshots();
      assert.equal(recoveredSnaps[0]?.filledCount, 5);
      assert.deepEqual(recoveredSnaps[0]?.filledRegionIds, [1, 2, 3, 4, 5]);
      assert.equal(JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]')[0]?.filledCount, 5);

      resetDurabilityState();
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-ts-max', { timestamp: 2000, lastOpened: 0, filledCount: 2 })])
      );
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-ts-max', { timestamp: 1000, lastOpened: 6000, filledCount: 6 })])
      );
      recoveredSnaps = storageMod.StorageService.loadSnapshots();
      assert.equal(recoveredSnaps[0]?.lastOpened, 6000);
      assert.equal(recoveredSnaps[0]?.filledCount, 6);

      resetDurabilityState();
      withMockedNow(1000, () =>
        storageMod.StorageService.saveSettings({
          ...storageMod.DEFAULT_SETTINGS,
          zoomSensitivity: 1.15,
          paletteSort: 'HUE',
        })
      );
      const olderSettingsJson = mockStorage.get('capy_user_settings_v8');
      assert.ok(olderSettingsJson);
      resetDurabilityState();
      withMockedNow(5000, () =>
        storageMod.StorageService.saveSettings({
          ...storageMod.DEFAULT_SETTINGS,
          zoomSensitivity: 1.85,
          paletteSort: 'LIGHTNESS',
          largeText: true,
        })
      );
      const newerSettingsJson = mockStorage.get('capy_user_settings_v8');
      assert.ok(newerSettingsJson);

      resetDurabilityState();
      mockStorage.set('capy_user_settings_v8', '{}');
      mockBackups.set('capy_user_settings_v8', newerSettingsJson);
      let loadedSet = storageMod.StorageService.loadSettings();
      assert.equal(loadedSet.zoomSensitivity, 1.85);
      assert.equal(loadedSet.paletteSort, 'LIGHTNESS');
      assert.equal(loadedSet.largeText, true);
      assert.equal('savedAt' in loadedSet, false, 'loadSettings must strip internal savedAt metadata');
      assert.equal(JSON.parse(mockStorage.get('capy_user_settings_v8') || '{}').zoomSensitivity, 1.85);

      resetDurabilityState();
      mockStorage.set('capy_user_settings_v8', olderSettingsJson);
      mockBackups.set('capy_user_settings_v8', newerSettingsJson);
      loadedSet = storageMod.StorageService.loadSettings();
      assert.equal(loadedSet.zoomSensitivity, 1.85);
      assert.equal(loadedSet.paletteSort, 'LIGHTNESS');
      assert.equal(loadedSet.largeText, true);
      assert.equal(JSON.parse(mockStorage.get('capy_user_settings_v8') || '{}').paletteSort, 'LIGHTNESS');

      resetDurabilityState();
      withMockedNow(1000, () =>
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'snap-a',
          activeColorId: 1,
          filledRegionIds: [1],
          resetEpoch: 1,
          zoomScale: 1.0,
          panOffsetX: 0,
          panOffsetY: 0,
        })
      );
      const olderActiveJson = mockStorage.get('capy_active_session_v8');
      assert.ok(olderActiveJson);
      resetDurabilityState();
      withMockedNow(5000, () =>
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'snap-a',
          activeColorId: 4,
          filledRegionIds: [1, 2, 3, 4],
          resetEpoch: 1,
          zoomScale: 2.2,
          panOffsetX: 15,
          panOffsetY: -10,
        })
      );
      const newerActiveJson = mockStorage.get('capy_active_session_v8');
      assert.ok(newerActiveJson);

      resetDurabilityState();
      mockStorage.set('capy_active_session_v8', '{}');
      mockBackups.set('capy_active_session_v8', newerActiveJson);
      let loadedAct = storageMod.StorageService.loadActiveState();
      assert.equal(loadedAct?.activeSnapshotId, 'snap-a');
      assert.equal(loadedAct?.activeColorId, 4);
      assert.deepEqual(loadedAct?.filledRegionIds, [1, 2, 3, 4]);
      assert.equal(loadedAct?.zoomScale, 2.2);
      assert.equal('savedAt' in (loadedAct || {}), false, 'loadActiveState must strip internal savedAt metadata');
      assert.equal(JSON.parse(mockStorage.get('capy_active_session_v8') || '{}').activeColorId, 4);

      resetDurabilityState();
      mockStorage.set('capy_active_session_v8', olderActiveJson);
      mockBackups.set('capy_active_session_v8', newerActiveJson);
      loadedAct = storageMod.StorageService.loadActiveState();
      assert.equal(loadedAct?.activeColorId, 4);
      assert.deepEqual(loadedAct?.filledRegionIds, [1, 2, 3, 4]);
      assert.equal(loadedAct?.zoomScale, 2.2);

      resetDurabilityState();
      mockStorage.set(
        'capy_active_session_v8',
        JSON.stringify({
          activeSnapshotId: 'snap-legacy',
          activeColorId: 1,
          filledRegionIds: [],
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        })
      );
      mockBackups.set(
        'capy_active_session_v8',
        JSON.stringify({
          activeSnapshotId: 'snap-legacy',
          activeColorId: 3,
          filledRegionIds: [7, 8, 9],
          zoomScale: 1.5,
          panOffsetX: 0,
          panOffsetY: 0,
        })
      );
      loadedAct = storageMod.StorageService.loadActiveState();
      assert.deepEqual(loadedAct?.filledRegionIds, [7, 8, 9]);
      assert.equal(loadedAct?.activeColorId, 3);

      // Same-timestamp resetEpoch precedence prevents pre-reset backup from resurrecting cleared regions
      resetDurabilityState();
      mockStorage.set(
        'capy_active_session_v8',
        JSON.stringify({
          activeSnapshotId: 'snap-epoch',
          activeColorId: 1,
          filledRegionIds: [],
          resetEpoch: 2,
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        })
      );
      mockBackups.set(
        'capy_active_session_v8',
        JSON.stringify({
          activeSnapshotId: 'snap-epoch',
          activeColorId: 2,
          filledRegionIds: [1, 2, 3, 4],
          resetEpoch: 1,
          zoomScale: 1.5,
          panOffsetX: 0,
          panOffsetY: 0,
        })
      );
      loadedAct = storageMod.StorageService.loadActiveState();
      assert.equal(loadedAct?.resetEpoch, 2);
      assert.deepEqual(loadedAct?.filledRegionIds, []);

      // Group B: Newer/richer localStorage wins over older native backup (zero reverse data loss)
      resetDurabilityState();
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-r', { lastOpened: 5000, filledCount: 6, filledRegionIds: [1, 2, 3, 4, 5, 6] })])
      );
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-r', { lastOpened: 1000, filledCount: 2, filledRegionIds: [1, 2] })])
      );
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.filledCount, 6);

      resetDurabilityState();
      mockStorage.set('capy_snapshots_v8', JSON.stringify([makeSnap('snap-keep', { lastOpened: 5000 })]));
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-keep', { lastOpened: 2000 }), makeSnap('snap-deleted', { lastOpened: 2000 })])
      );
      const nonResurrected = storageMod.StorageService.loadSnapshots();
      assert.deepEqual(nonResurrected.map((s) => s.id), ['snap-keep']);

      resetDurabilityState();
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-rich', { lastOpened: 3000, filledCount: 4, filledRegionIds: [1, 2, 3, 4] })])
      );
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-rich', { lastOpened: 3000, filledCount: 1, filledRegionIds: [1] })])
      );
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.filledCount, 4);

      resetDurabilityState();
      mockStorage.set('capy_user_settings_v8', newerSettingsJson);
      mockBackups.set('capy_user_settings_v8', olderSettingsJson);
      loadedSet = storageMod.StorageService.loadSettings();
      assert.equal(loadedSet.zoomSensitivity, 1.85);
      assert.equal(loadedSet.paletteSort, 'LIGHTNESS');
      assert.equal(loadedSet.largeText, true);

      resetDurabilityState();
      mockStorage.set('capy_active_session_v8', newerActiveJson);
      mockBackups.set('capy_active_session_v8', olderActiveJson);
      loadedAct = storageMod.StorageService.loadActiveState();
      assert.deepEqual(loadedAct?.filledRegionIds, [1, 2, 3, 4]);
      assert.equal(loadedAct?.zoomScale, 2.2);

      resetDurabilityState();
      withMockedNow(6000, () =>
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'snap-b',
          activeColorId: 1,
          filledRegionIds: [],
          resetEpoch: 1,
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        })
      );
      const switchedPuzzleJson = mockStorage.get('capy_active_session_v8');
      assert.ok(switchedPuzzleJson);
      resetDurabilityState();
      mockStorage.set('capy_active_session_v8', switchedPuzzleJson);
      mockBackups.set('capy_active_session_v8', olderActiveJson);
      loadedAct = storageMod.StorageService.loadActiveState();
      assert.equal(loadedAct?.activeSnapshotId, 'snap-b');
      assert.deepEqual(loadedAct?.filledRegionIds, []);

      // Group C: Accidental saveSnapshots([]) does NOT wipe non-empty native or pending backups
      resetDurabilityState();
      const guardedSnap = makeSnap('snap-guard-1', { lastOpened: 4000, filledCount: 3, filledRegionIds: [1, 2, 3] });
      storageMod.StorageService.saveSnapshots([guardedSnap]);
      storageMod.StorageService.flushPendingBackups();
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]').length, 1);
      storageMod.StorageService.saveSnapshots([]);
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]')[0]?.id, 'snap-guard-1');
      storageMod.StorageService.flushPendingBackups();
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]')[0]?.id, 'snap-guard-1');
      assert.equal(mockStorage.get('capy_snapshots_v8'), '[]');
      recoveredSnaps = storageMod.StorageService.loadSnapshots();
      assert.equal(recoveredSnaps.length, 1);
      assert.equal(recoveredSnaps[0]?.id, 'snap-guard-1');
      assert.equal(recoveredSnaps[0]?.filledCount, 3);

      resetDurabilityState();
      mockBackups.set('capy_snapshots_v8', JSON.stringify([guardedSnap]));
      storageMod.StorageService.saveSnapshots([], { allowEmptyBackup: false });
      storageMod.StorageService.flushPendingBackups();
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]')[0]?.id, 'snap-guard-1');

      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([guardedSnap]);
      storageMod.StorageService.saveSnapshots([]);
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.id, 'snap-guard-1');
      storageMod.StorageService.flushPendingBackups();
      assert.notEqual(mockBackups.get('capy_snapshots_v8'), '[]');
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]')[0]?.id, 'snap-guard-1');

      // Group D: Explicit deleteSnapshot (final item) & clearAllSnapshots clear native backup cleanly
      resetDurabilityState();
      const snapOne = makeSnap('snap-del-1', { lastOpened: 2000, filledCount: 2, filledRegionIds: [1, 2] });
      const snapTwo = makeSnap('snap-del-2', { lastOpened: 3000, filledCount: 3, filledRegionIds: [4, 5, 6] });
      storageMod.StorageService.saveSnapshots([snapOne, snapTwo]);
      storageMod.StorageService.saveActiveState({
        activeSnapshotId: 'snap-del-2',
        activeColorId: 2,
        filledRegionIds: [4, 5, 6],
        zoomScale: 1.5,
        panOffsetX: 0,
        panOffsetY: 0,
      });
      storageMod.StorageService.flushPendingBackups();

      const afterFirstDelete = await storageMod.StorageService.deleteSnapshot('snap-del-1');
      assert.deepEqual(afterFirstDelete.map((s) => s.id), ['snap-del-2']);
      assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => s.id), ['snap-del-2']);
      storageMod.StorageService.flushPendingBackups();
      assert.deepEqual(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]').map((s) => s.id), ['snap-del-2']);

      const afterFinalDelete = await storageMod.StorageService.deleteSnapshot('snap-del-2');
      assert.equal(afterFinalDelete.length, 0);
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]').length, 0);
      storageMod.StorageService.flushPendingBackups();
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]').length, 0);
      assert.equal(storageMod.StorageService.loadSnapshots().length, 0);
      assert.equal(storageMod.StorageService.loadActiveState(), null);

      // Partial delete of a newer snapshot must flush backup immediately (<400ms crash safety) so it never resurrects
      resetDurabilityState();
      const olderRemainingSnap = makeSnap('snap-partial-old', {
        lastOpened: 1000,
        timestamp: 1000,
        filledCount: 1,
        filledRegionIds: [1],
      });
      const newerDeletedSnap = makeSnap('snap-partial-new', {
        lastOpened: 2000,
        timestamp: 2000,
        filledCount: 4,
        filledRegionIds: [1, 2, 3, 4],
      });
      storageMod.StorageService.saveSnapshots([olderRemainingSnap, newerDeletedSnap]);
      storageMod.StorageService.flushPendingBackups();
      assert.deepEqual(
        JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]').map((s) => s.id),
        ['snap-partial-old', 'snap-partial-new']
      );
      const afterPartialNewDelete = await storageMod.StorageService.deleteSnapshot('snap-partial-new');
      assert.deepEqual(afterPartialNewDelete.map((s) => s.id), ['snap-partial-old']);
      assert.deepEqual(
        JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]').map((s) => s.id),
        ['snap-partial-old']
      );
      assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => s.id), ['snap-partial-old']);
      storageMod.StorageService.flushPendingBackups();
      assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => s.id), ['snap-partial-old']);

      // Deleting a missing ID when empty must not wipe an out-of-band non-empty backup
      resetDurabilityState();
      mockBackups.set('capy_snapshots_v8', JSON.stringify([snapOne]));
      mockStorage.set('capy_snapshots_v8', '[]');
      const afterMissingDelete = await storageMod.StorageService.deleteSnapshot('nonexistent-id');
      assert.equal(afterMissingDelete[0]?.id, 'snap-del-1');
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]')[0]?.id, 'snap-del-1');

      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([snapOne, snapTwo]);
      storageMod.StorageService.saveActiveState({
        activeSnapshotId: 'snap-del-1',
        activeColorId: 1,
        filledRegionIds: [1, 2],
        zoomScale: 1,
        panOffsetX: 0,
        panOffsetY: 0,
      });
      storageMod.StorageService.flushPendingBackups();
      await storageMod.StorageService.clearAllSnapshots();
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]').length, 0);
      storageMod.StorageService.flushPendingBackups();
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]').length, 0);
      assert.equal(storageMod.StorageService.loadSnapshots().length, 0);
      assert.equal(storageMod.StorageService.loadActiveState(), null);
      assert.equal(mockStorage.get('capy_snapshots_v8'), '[]');
      assert.equal(mockStorage.has('capy_active_session_v8'), false);

      // Group E: Corrupt payloads, pending quota-fail comparison, sandbox isolation, and SSR/missing-bridge safety
      resetDurabilityState();
      mockStorage.set('capy_snapshots_v8', '{corrupt-json');
      mockBackups.set('capy_snapshots_v8', JSON.stringify([guardedSnap]));
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.id, 'snap-guard-1');
      mockStorage.set('capy_snapshots_v8', '{}');
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.id, 'snap-guard-1');

      mockStorage.set('capy_user_settings_v8', '{corrupt-json');
      mockBackups.set('capy_user_settings_v8', newerSettingsJson);
      assert.equal(storageMod.StorageService.loadSettings().zoomSensitivity, 1.85);
      mockStorage.set('capy_user_settings_v8', '[]');
      assert.equal(storageMod.StorageService.loadSettings().zoomSensitivity, 1.85);

      mockStorage.set('capy_active_session_v8', '{corrupt-json');
      mockBackups.set('capy_active_session_v8', newerActiveJson);
      assert.equal(storageMod.StorageService.loadActiveState()?.activeSnapshotId, 'snap-a');
      mockStorage.set('capy_active_session_v8', '[]');
      assert.equal(storageMod.StorageService.loadActiveState()?.activeSnapshotId, 'snap-a');

      resetDurabilityState();
      mockStorage.set('capy_snapshots_v8', JSON.stringify([guardedSnap]));
      mockBackups.set('capy_snapshots_v8', '{corrupt-backup');
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.id, 'snap-guard-1');
      mockStorage.set('capy_user_settings_v8', newerSettingsJson);
      mockBackups.set('capy_user_settings_v8', '{corrupt-backup');
      assert.equal(storageMod.StorageService.loadSettings().zoomSensitivity, 1.85);
      mockStorage.set('capy_active_session_v8', newerActiveJson);
      mockBackups.set('capy_active_session_v8', '{corrupt-backup');
      assert.equal(storageMod.StorageService.loadActiveState()?.activeSnapshotId, 'snap-a');

      resetDurabilityState();
      mockStorage.set('capy_snapshots_v8', '{corrupt');
      mockBackups.set('capy_snapshots_v8', '{corrupt');
      assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
      mockStorage.set('capy_user_settings_v8', '{corrupt');
      mockBackups.set('capy_user_settings_v8', '{corrupt');
      assert.equal(storageMod.StorageService.loadSettings().difficulty, storageMod.DEFAULT_SETTINGS.difficulty);
      mockStorage.set('capy_active_session_v8', '{corrupt');
      mockBackups.set('capy_active_session_v8', '{corrupt');
      assert.equal(storageMod.StorageService.loadActiveState(), null);

      // E3: Pending un-flushed writes (including QuotaExceededError) vs stale and newer localStorage + same-ms tiebreak
      resetDurabilityState();
      withMockedNow(1000, () => {
        storageMod.StorageService.saveSnapshots([makeSnap('snap-pending', { lastOpened: 1000, filledCount: 1 })]);
        storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, zoomSensitivity: 1.1 });
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'snap-pending',
          activeColorId: 1,
          filledRegionIds: [1],
          resetEpoch: 1,
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        });
      });
      storageMod.StorageService.flushPendingBackups();

      const savedLsSet = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8' || k === 'capy_user_settings_v8' || k === 'capy_active_session_v8') {
          const err = new Error('Storage quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedLsSet(k, v);
      };
      try {
        withMockedNow(7000, () => {
          storageMod.StorageService.saveSnapshots([
            makeSnap('snap-pending', { lastOpened: 7000, filledCount: 7, filledRegionIds: [1, 2, 3, 4, 5, 6, 7] }),
          ]);
          storageMod.StorageService.saveSettings({
            ...storageMod.DEFAULT_SETTINGS,
            zoomSensitivity: 1.9,
            paletteSort: 'REMAINING',
          });
          storageMod.StorageService.saveActiveState({
            activeSnapshotId: 'snap-pending',
            activeColorId: 7,
            filledRegionIds: [1, 2, 3, 4, 5, 6, 7],
            resetEpoch: 1,
            zoomScale: 2.5,
            panOffsetX: 10,
            panOffsetY: 20,
          });
        });
      } finally {
        globalThis.localStorage.setItem = savedLsSet;
      }
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.filledCount, 7);
      assert.equal(storageMod.StorageService.loadSettings().zoomSensitivity, 1.9);
      assert.equal(storageMod.StorageService.loadActiveState()?.activeColorId, 7);

      // Direct newer write (t=9000) in localStorage beats older pendingBackupWrites (t=7000)
      withMockedNow(8000, () => {
        storageMod.StorageService.saveSnapshots([makeSnap('snap-pending', { lastOpened: 7000, filledCount: 7 })]);
        storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, zoomSensitivity: 1.6 });
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'snap-pending',
          activeColorId: 6,
          filledRegionIds: [1, 2],
          resetEpoch: 1,
          zoomScale: 1.6,
          panOffsetX: 0,
          panOffsetY: 0,
        });
      });
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-pending', { lastOpened: 9000, filledCount: 9, filledRegionIds: [1, 2, 3] })])
      );
      mockStorage.set(
        'capy_user_settings_v8',
        JSON.stringify({ ...storageMod.DEFAULT_SETTINGS, undoDefaultMigrated: true, savedAt: 9000, zoomSensitivity: 1.4 })
      );
      mockStorage.set(
        'capy_active_session_v8',
        JSON.stringify({
          activeSnapshotId: 'snap-pending',
          activeColorId: 9,
          filledRegionIds: [1, 2, 3],
          resetEpoch: 1,
          zoomScale: 3.0,
          panOffsetX: 0,
          panOffsetY: 0,
          savedAt: 9000,
        })
      );
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.filledCount, 9);
      assert.equal(storageMod.StorageService.loadSettings().zoomSensitivity, 1.4);
      assert.equal(storageMod.StorageService.loadActiveState()?.activeColorId, 9);

      // Same-ms QuotaExceededError tiebreak favors pending backup over stale localStorage
      resetDurabilityState();
      withMockedNow(5000, () => {
        storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, difficulty: 'EASY' });
      });
      const origLsSetTie = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_user_settings_v8') {
          const err = new Error('Storage quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return origLsSetTie(k, v);
      };
      try {
        withMockedNow(5000, () => {
          storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, difficulty: 'NORMAL' });
        });
      } finally {
        globalThis.localStorage.setItem = origLsSetTie;
      }
      assert.equal(storageMod.StorageService.loadSettings().difficulty, 'NORMAL');

      // E4: Sandbox isolation + missing CapyAndroid + SSR localStorage === undefined safety
      resetDurabilityState();
      mockBackups.set('capy_snapshots_v8', JSON.stringify([makeSnap('snap-root', { lastOpened: 2000 })]));
      globalThis.window.location = { pathname: '/capy/beta/', origin: 'https://example.github.io', search: '' };
      mockBackups.set('capy_snapshots_v8__sandbox_beta', JSON.stringify([makeSnap('snap-beta', { lastOpened: 3000 })]));
      mockStorage.set('capy_snapshots_v8__sandbox_beta', '[]');
      storageMod.StorageService.saveSnapshots([]);
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.id, 'snap-beta');
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]')[0]?.id, 'snap-root');

      resetDurabilityState();
      delete globalThis.window.CapyAndroid;
      assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
      assert.equal(storageMod.StorageService.loadSettings().difficulty, storageMod.DEFAULT_SETTINGS.difficulty);
      assert.equal(storageMod.StorageService.loadActiveState(), null);
      storageMod.StorageService.saveSnapshots([]);
      assert.deepEqual(await storageMod.StorageService.deleteSnapshot('missing'), []);
      await storageMod.StorageService.clearAllSnapshots();

      const savedLsObj = globalThis.localStorage;
      globalThis.localStorage = undefined;
      try {
        assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
        assert.equal(storageMod.StorageService.loadSettings().difficulty, storageMod.DEFAULT_SETTINGS.difficulty);
        assert.equal(storageMod.StorageService.loadActiveState(), null);
        storageMod.StorageService.saveSnapshots([]);
        storageMod.StorageService.saveSettings(storageMod.DEFAULT_SETTINGS);
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: null,
          activeColorId: 1,
          filledRegionIds: [],
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        });
        storageMod.StorageService.clearActiveState();
        assert.deepEqual(await storageMod.StorageService.deleteSnapshot('missing'), []);
        await storageMod.StorageService.clearAllSnapshots();
      } finally {
        globalThis.localStorage = savedLsObj;
      }
      // Group F: NativeBridge.saveBackup() === false resilience (Bug 1) & Desktop Web !NativeBridge.isNative cleanup (CEO 15:17:24Z)
      resetDurabilityState();
      const natS1 = makeSnap('nat-1', { lastOpened: 1000, filledCount: 1 });
      const natS2 = makeSnap('nat-2', { lastOpened: 2000, filledCount: 2 });
      storageMod.StorageService.saveSnapshots([natS1, natS2]);
      storageMod.StorageService.saveActiveState({
        activeSnapshotId: 'nat-2',
        activeColorId: 2,
        filledRegionIds: [1, 2],
        zoomScale: 1,
        panOffsetX: 0,
        panOffsetY: 0,
      });
      storageMod.StorageService.flushPendingBackups();

      let nativeWriteOk = false;
      globalThis.window.CapyAndroid = {
        saveBackup: (k, v) => {
          if (!nativeWriteOk) return false;
          mockBackups.set(k, String(v));
          return true;
        },
        loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
      };
      const afterNativeFailPartial = await storageMod.StorageService.deleteSnapshot('nat-2');
      assert.deepEqual(afterNativeFailPartial.map((s) => s.id), ['nat-1']);
      assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => s.id), ['nat-1']);
      assert.equal(storageMod.StorageService.loadActiveState(), null, 'Failed native backup clearActiveState must not resurrect active state');
      mockStorage.clear();
      assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => s.id), ['nat-1'], 'Stale native backup must not override pending partial delete');
      assert.equal(storageMod.StorageService.loadActiveState(), null);
      storageMod.StorageService.flushPendingBackups();
      assert.deepEqual(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]').map((s) => s.id), ['nat-1', 'nat-2']);
      nativeWriteOk = true;
      storageMod.StorageService.flushPendingBackups();
      assert.deepEqual(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]').map((s) => s.id), ['nat-1']);
      assert.equal(mockBackups.get('capy_active_session_v8'), '');

      // Final delete & accidental empty guard during native saveBackup() === false
      nativeWriteOk = false;
      await storageMod.StorageService.deleteSnapshot('nat-1');
      assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
      mockStorage.clear();
      assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
      nativeWriteOk = true;
      storageMod.StorageService.flushPendingBackups();
      assert.equal(mockBackups.get('capy_snapshots_v8'), '[]');

      // Accidental saveSnapshots([]) stays blocked while explicit clearAllSnapshots & clearActiveState (even with removeItem throwing) recover cleanly
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([natS1]);
      storageMod.StorageService.saveActiveState({
        activeSnapshotId: 'nat-1',
        activeColorId: 3,
        filledRegionIds: [1],
        zoomScale: 1,
        panOffsetX: 0,
        panOffsetY: 0,
      });
      storageMod.StorageService.flushPendingBackups();
      storageMod.StorageService.saveSnapshots([]);
      storageMod.StorageService.flushPendingBackups();
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]')[0]?.id, 'nat-1');

      nativeWriteOk = false;
      globalThis.window.CapyAndroid = {
        saveBackup: (k, v) => {
          if (!nativeWriteOk) return false;
          mockBackups.set(k, String(v));
          return true;
        },
        loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
      };
      const origRemoveItem = globalThis.localStorage.removeItem;
      globalThis.localStorage.removeItem = () => {
        throw new Error('Blocked removeItem');
      };
      try {
        storageMod.StorageService.clearActiveState();
        assert.equal(storageMod.StorageService.loadActiveState(), null, 'clearActiveState must return null even if removeItem and saveBackup both fail');
      } finally {
        globalThis.localStorage.removeItem = origRemoveItem;
      }
      await storageMod.StorageService.clearAllSnapshots();
      assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
      assert.equal(storageMod.StorageService.loadActiveState(), null);
      nativeWriteOk = true;
      storageMod.StorageService.flushPendingBackups();
      assert.equal(mockBackups.get('capy_snapshots_v8'), '[]');
      assert.equal(mockBackups.get('capy_active_session_v8'), '');

      // Debounced write failure on native retains latest write and suppresses stale native backup until recovery flush
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([makeSnap('nat-deb', { lastOpened: 1000, filledCount: 1 })]);
      storageMod.StorageService.flushPendingBackups();
      nativeWriteOk = false;
      globalThis.window.CapyAndroid = {
        saveBackup: (k, v) => {
          if (!nativeWriteOk) return false;
          mockBackups.set(k, String(v));
          return true;
        },
        loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
      };
      storageMod.StorageService.saveSnapshots([makeSnap('nat-deb', { lastOpened: 2000, filledCount: 5 })]);
      storageMod.StorageService.flushPendingBackups();
      mockStorage.clear();
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.filledCount, 5);
      nativeWriteOk = true;
      storageMod.StorageService.flushPendingBackups();
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]')[0]?.filledCount, 5);

      // Desktop Web (!NativeBridge.isNative): pendingBackupWrites holds QuotaExceededError writes before flush, then clears cleanly on flush
      resetDurabilityState();
      delete globalThis.window.CapyAndroid;
      withMockedNow(5000, () => {
        storageMod.StorageService.saveSnapshots([makeSnap('web-q', { lastOpened: 5000, filledCount: 6, filledRegionIds: [1, 2, 3, 4, 5, 6] })]);
        storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, difficulty: 'EASY' });
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'web-q',
          activeColorId: 1,
          filledRegionIds: [1, 2, 3],
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        });
      });
      storageMod.StorageService.flushPendingBackups();
      const origWebQuotaSet = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8' || k === 'capy_user_settings_v8' || k === 'capy_active_session_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return origWebQuotaSet(k, v);
      };
      try {
        withMockedNow(5000, () => {
          storageMod.StorageService.saveSnapshots([makeSnap('web-q', { lastOpened: 5000, filledCount: 4, filledRegionIds: [1, 2, 3, 4] })]);
          storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, difficulty: 'NORMAL' });
          storageMod.StorageService.saveActiveState({
            activeSnapshotId: 'web-q',
            activeColorId: 9,
            filledRegionIds: [1],
            zoomScale: 1,
            panOffsetX: 0,
            panOffsetY: 0,
          });
        });
      } finally {
        globalThis.localStorage.setItem = origWebQuotaSet;
      }
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.filledCount, 4);
      assert.equal(storageMod.StorageService.loadSettings().difficulty, 'NORMAL');
      assert.equal(storageMod.StorageService.loadActiveState()?.activeColorId, 9);
      storageMod.StorageService.flushPendingBackups();
      let desktopSpyCalls = 0;
      globalThis.window.CapyAndroid = {
        saveBackup: () => {
          desktopSpyCalls += 1;
          return true;
        },
        loadBackup: () => null,
      };
      storageMod.StorageService.flushPendingBackups();
      assert.equal(desktopSpyCalls, 0, 'Desktop Web flush must clear pendingBackupWrites cleanly without leaving stuck entries');

      // Desktop Web clearAllSnapshots & final deleteSnapshot under QuotaExceededError (both with working and throwing removeItem)
      for (const failRemove of [false, true]) {
        resetDurabilityState();
        delete globalThis.window.CapyAndroid;
        storageMod.StorageService.saveSnapshots([makeSnap('web-del', { lastOpened: 3000 })]);
        storageMod.StorageService.flushPendingBackups();
        const savedSetWeb = globalThis.localStorage.setItem;
        const savedRemWeb = globalThis.localStorage.removeItem;
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedSetWeb(k, v);
        };
        if (failRemove) {
          globalThis.localStorage.removeItem = () => {
            throw new Error('Blocked removeItem');
          };
        }
        try {
          await storageMod.StorageService.clearAllSnapshots();
          assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
        } finally {
          globalThis.localStorage.setItem = savedSetWeb;
          globalThis.localStorage.removeItem = savedRemWeb;
        }
        resetDurabilityState();
        delete globalThis.window.CapyAndroid;
        storageMod.StorageService.saveSnapshots([makeSnap('web-del-final', { lastOpened: 3000 })]);
        storageMod.StorageService.flushPendingBackups();
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedSetWeb(k, v);
        };
        if (failRemove) {
          globalThis.localStorage.removeItem = () => {
            throw new Error('Blocked removeItem');
          };
        }
        try {
          await storageMod.StorageService.deleteSnapshot('web-del-final');
          assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
        } finally {
          globalThis.localStorage.setItem = savedSetWeb;
          globalThis.localStorage.removeItem = savedRemWeb;
        }
      }

      // Group G: Same-ms QuotaExceededError shrinking writes & deleteSnapshot/clearAllSnapshots under QuotaExceededError (Bug 2)
      resetDurabilityState();
      withMockedNow(5000, () => {
        storageMod.StorageService.saveSnapshots([
          makeSnap('q-s1', { lastOpened: 5000, filledCount: 5, filledRegionIds: [1, 2, 3, 4, 5] }),
          makeSnap('q-s2', { lastOpened: 5000, filledCount: 2, filledRegionIds: [1, 2] }),
        ]);
        mockStorage.set(
          'capy_user_settings_v8',
          JSON.stringify({ ...storageMod.DEFAULT_SETTINGS, undoDefaultMigrated: true, savedAt: 5000, difficulty: 'EASY', legacyExtraKey: 'old' })
        );
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'q-s1',
          activeColorId: 5,
          filledRegionIds: Array.from({ length: 20 }, (_, i) => i + 1),
          resetEpoch: 2,
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        });
      });
      storageMod.StorageService.flushPendingBackups();

      const savedShrinkSet = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8' || k === 'capy_user_settings_v8' || k === 'capy_active_session_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedShrinkSet(k, v);
      };
      try {
        withMockedNow(5000, () => {
          storageMod.StorageService.saveSnapshots([
            makeSnap('q-s1', { lastOpened: 5000, filledCount: 4, filledRegionIds: [1, 2, 3, 4] }),
          ]);
          storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, difficulty: 'NORMAL' });
          // Undo shrinking active state ([20 items] -> [1])
          storageMod.StorageService.saveActiveState({
            activeSnapshotId: 'q-s1',
            activeColorId: 1,
            filledRegionIds: [1],
            resetEpoch: 2,
            zoomScale: 1,
            panOffsetX: 0,
            panOffsetY: 0,
          });
        });
        assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => [s.id, s.filledCount]), [['q-s1', 4]]);
        assert.equal(storageMod.StorageService.loadSettings().difficulty, 'NORMAL');
        assert.deepEqual(storageMod.StorageService.loadActiveState()?.filledRegionIds, [1]);

        // Switch active puzzle (1 fill -> 0 fills on another snapshot ID at same-ms)
        withMockedNow(5000, () => {
          storageMod.StorageService.saveActiveState({
            activeSnapshotId: 'q-s2',
            activeColorId: 1,
            filledRegionIds: [],
            resetEpoch: 1,
            zoomScale: 1,
            panOffsetX: 0,
            panOffsetY: 0,
          });
        });
        assert.equal(storageMod.StorageService.loadActiveState()?.activeSnapshotId, 'q-s2');
        assert.deepEqual(storageMod.StorageService.loadActiveState()?.filledRegionIds, []);
      } finally {
        globalThis.localStorage.setItem = savedShrinkSet;
      }

      // Partial & final deleteSnapshot and clearAllSnapshots under QuotaExceededError (both with removeItem succeeding and throwing)
      for (const failRemove of [false, true]) {
        resetDurabilityState();
        const olderKeep = makeSnap('keep-1', { lastOpened: 1000, timestamp: 1000, filledCount: 1 });
        const newerDel = makeSnap('del-2', { lastOpened: 5000, timestamp: 5000, filledCount: 5 });
        storageMod.StorageService.saveSnapshots([olderKeep, newerDel]);
        storageMod.StorageService.flushPendingBackups();

        const origDelSet = globalThis.localStorage.setItem;
        const origDelRem = globalThis.localStorage.removeItem;
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return origDelSet(k, v);
        };
        if (failRemove) {
          globalThis.localStorage.removeItem = () => {
            throw new Error('Blocked removeItem');
          };
        }
        try {
          await storageMod.StorageService.deleteSnapshot('del-2');
          assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => s.id), ['keep-1']);
          await storageMod.StorageService.deleteSnapshot('keep-1');
          assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
        } finally {
          globalThis.localStorage.setItem = origDelSet;
          globalThis.localStorage.removeItem = origDelRem;
        }

        resetDurabilityState();
        storageMod.StorageService.saveSnapshots([olderKeep, newerDel]);
        storageMod.StorageService.flushPendingBackups();
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return origDelSet(k, v);
        };
        if (failRemove) {
          globalThis.localStorage.removeItem = () => {
            throw new Error('Blocked removeItem');
          };
        }
        try {
          await storageMod.StorageService.clearAllSnapshots();
          assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
        } finally {
          globalThis.localStorage.setItem = origDelSet;
          globalThis.localStorage.removeItem = origDelRem;
        }
      }

      // Accidental saveSnapshots([]) under QuotaExceededError does NOT poison quotaFailedLocalKeys
      resetDurabilityState();
      mockBackups.set('capy_snapshots_v8', JSON.stringify([makeSnap('snap-old', { lastOpened: 1000, filledCount: 1 })]));
      mockStorage.set('capy_snapshots_v8', JSON.stringify([makeSnap('snap-new', { lastOpened: 1000, filledCount: 4 })]));
      const origSkipSet = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return origSkipSet(k, v);
      };
      try {
        storageMod.StorageService.saveSnapshots([]);
      } finally {
        globalThis.localStorage.setItem = origSkipSet;
      }
      assert.equal(storageMod.StorageService.loadSnapshots()[0]?.id, 'snap-new');

      // Group H: Per-snapshot-id resetEpoch dominance in SNAPSHOTS_KEY (Bug 3)
      resetDurabilityState();
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('p1', { lastOpened: 2000, resetEpoch: 2, filledCount: 0, filledRegionIds: [] })])
      );
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([
          makeSnap('p1', { lastOpened: 2000, resetEpoch: 1, filledCount: 50, filledRegionIds: [1, 2, 3] }),
          makeSnap('p2', { lastOpened: 1000, resetEpoch: 0, filledCount: 10, filledRegionIds: [1] }),
        ])
      );
      assert.deepEqual(
        storageMod.StorageService.loadSnapshots().map((s) => [s.id, s.resetEpoch, s.filledCount]),
        [['p1', 2, 0]]
      );

      // Symmetrical 1v2 where backup has higher resetEpoch on shared p1
      resetDurabilityState();
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([
          makeSnap('p1', { lastOpened: 2000, resetEpoch: 1, filledCount: 50, filledRegionIds: [1, 2, 3] }),
          makeSnap('p2', { lastOpened: 1000, resetEpoch: 0, filledCount: 10, filledRegionIds: [1] }),
        ])
      );
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('p1', { lastOpened: 2000, resetEpoch: 2, filledCount: 0, filledRegionIds: [] })])
      );
      assert.deepEqual(
        storageMod.StorageService.loadSnapshots().map((s) => [s.id, s.resetEpoch, s.filledCount]),
        [['p1', 2, 0]]
      );

      // Equal total sum (2+1 === 1+2) where shared p1 has strictly higher resetEpoch in local
      resetDurabilityState();
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([
          makeSnap('p1', { lastOpened: 2000, resetEpoch: 2, filledCount: 0, filledRegionIds: [] }),
          makeSnap('p2', { lastOpened: 1000, resetEpoch: 1, filledCount: 1, filledRegionIds: [1] }),
        ])
      );
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([
          makeSnap('p1', { lastOpened: 2000, resetEpoch: 1, filledCount: 50, filledRegionIds: [1, 2, 3] }),
          makeSnap('p3', { lastOpened: 1000, resetEpoch: 2, filledCount: 20, filledRegionIds: [1, 2] }),
        ])
      );
      assert.deepEqual(
        storageMod.StorageService.loadSnapshots().map((s) => s.id),
        ['p1', 'p2']
      );

      // Group I: filledRegionIds finite-number filtering in inspectCandidate('snapshots') (Bug 4)
      resetDurabilityState();
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-finite', { lastOpened: 2000, filledCount: 0, filledRegionIds: [null, 'bad', Number.NaN, 1] })])
      );
      mockBackups.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('snap-finite', { lastOpened: 2000, filledCount: 0, filledRegionIds: [1, 2] })])
      );
      assert.deepEqual(storageMod.StorageService.loadSnapshots()[0]?.filledRegionIds, [1, 2]);

      // Group J: Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k) in inspectCandidate('settings') (Bug 5)
      resetDurabilityState();
      mockStorage.set(
        'capy_user_settings_v8',
        JSON.stringify({ toString: 'bad', constructor: 'bad', valueOf: 'bad' })
      );
      mockBackups.set(
        'capy_user_settings_v8',
        JSON.stringify({ difficulty: 'NORMAL', paletteSort: 'HUE' })
      );
      assert.equal(storageMod.StorageService.loadSettings().difficulty, 'NORMAL');

      // Group K: deleteSnapshot missing-ID read-only no-op (Bug 6) & negative timestamp/lastOpened clamp
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([makeSnap('existing-1', { lastOpened: 2000 })]);
      storageMod.StorageService.flushPendingBackups();
      let setItemCallsOnMissing = 0;
      let saveBackupCallsOnMissing = 0;
      const origCountSet = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        setItemCallsOnMissing += 1;
        return origCountSet(k, v);
      };
      globalThis.window.CapyAndroid = {
        saveBackup: (k, v) => {
          saveBackupCallsOnMissing += 1;
          mockBackups.set(k, String(v));
          return true;
        },
        loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
      };
      try {
        const missingRes = await storageMod.StorageService.deleteSnapshot('nonexistent-id');
        assert.deepEqual(missingRes.map((s) => s.id), ['existing-1']);
        storageMod.StorageService.flushPendingBackups();
        assert.equal(setItemCallsOnMissing, 0, 'Missing-ID deleteSnapshot must not write localStorage');
        assert.equal(saveBackupCallsOnMissing, 0, 'Missing-ID deleteSnapshot must not schedule or call saveBackup');
      } finally {
        globalThis.localStorage.setItem = origCountSet;
      }

      resetDurabilityState();
      mockStorage.set(
        'capy_snapshots_v8',
        JSON.stringify([makeSnap('neg-ts', { timestamp: -500, lastOpened: -10 })])
      );
      const clampedSnap = storageMod.StorageService.loadSnapshots()[0];
      assert.equal(clampedSnap?.timestamp, 0);
      assert.equal(clampedSnap?.lastOpened, 0);

      // Group L: CapyIOS capability detection, Desktop Web partial delete under QuotaExceededError + 460ms drain/heal,
      // SNAPSHOTS_KEY quotaFailedDeleteKeys preservation, preferBackupOnTie without b.maxTs >= a.maxTs, & forced-empty recovery heal
      // L1: CapyIOS (webkit.messageHandlers.CapyIOS, no CapyAndroid.loadBackup)
      resetDurabilityState();
      const iosPosted = [];
      delete globalThis.window.CapyAndroid;
      globalThis.window.webkit = {
        messageHandlers: {
          CapyIOS: {
            postMessage: (msg) => iosPosted.push(msg),
          },
        },
      };
      const iosOne = makeSnap('ios-1', { timestamp: 1000, lastOpened: 1000, filledCount: 1 });
      const iosTwo = makeSnap('ios-2', { timestamp: 5000, lastOpened: 5000, filledCount: 5 });
      storageMod.StorageService.saveSnapshots([iosOne, iosTwo]);
      storageMod.StorageService.saveActiveState({
        activeSnapshotId: 'ios-2',
        activeColorId: 2,
        filledRegionIds: [1, 2],
        zoomScale: 1,
        panOffsetX: 0,
        panOffsetY: 0,
      });
      storageMod.StorageService.flushPendingBackups();

      const origIosSet = globalThis.localStorage.setItem;
      const origIosRem = globalThis.localStorage.removeItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return origIosSet(k, v);
      };
      try {
        const afterIosPartial = await storageMod.StorageService.deleteSnapshot('ios-2');
        assert.deepEqual(afterIosPartial.map((s) => s.id), ['ios-1']);
        assert.deepEqual(
          storageMod.StorageService.loadSnapshots().map((s) => s.id),
          ['ios-1'],
          'CapyIOS partial delete under QuotaExceededError must preserve ios-1 without wiping or resurrecting ios-2'
        );
      } finally {
        globalThis.localStorage.setItem = origIosSet;
      }
      assert.deepEqual(
        storageMod.StorageService.loadSnapshots().map((s) => s.id),
        ['ios-1']
      );
      assert.deepEqual(
        JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]').map((s) => s.id),
        ['ios-1'],
        'CapyIOS loadSnapshots after quota relief must heal localStorage cleanly'
      );

      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return origIosSet(k, v);
      };
      globalThis.localStorage.removeItem = () => {
        throw new Error('Blocked removeItem');
      };
      try {
        await storageMod.StorageService.clearAllSnapshots();
        assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
        assert.equal(storageMod.StorageService.loadActiveState(), null);
      } finally {
        globalThis.localStorage.setItem = origIosSet;
        globalThis.localStorage.removeItem = origIosRem;
      }
      assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
      assert.equal(storageMod.StorageService.loadActiveState(), null);
      assert.equal(mockStorage.get('capy_snapshots_v8'), '[]');
      assert.equal(mockStorage.has('capy_active_session_v8'), false);
      assert.equal(iosPosted.length > 0, true);

      // L2: Desktop Web partial delete under QuotaExceededError (0ms safety + 460ms timer heal/drain + normal 0ms clear)
      resetDurabilityState();
      delete globalThis.window.CapyAndroid;
      storageMod.StorageService.saveSnapshots([
        makeSnap('web-norm-1', { timestamp: 1000, lastOpened: 1000 }),
        makeSnap('web-norm-2', { timestamp: 2000, lastOpened: 2000 }),
      ]);
      storageMod.StorageService.flushPendingBackups();
      await storageMod.StorageService.deleteSnapshot('web-norm-2');
      let webNormSpy = 0;
      globalThis.window.CapyAndroid = {
        saveBackup: () => {
          webNormSpy += 1;
          return true;
        },
        loadBackup: () => null,
      };
      storageMod.StorageService.flushPendingBackups();
      assert.equal(webNormSpy, 0, 'Normal Desktop Web partial delete must drain pendingBackupWrites immediately');

      for (const failRemove of [false, true]) {
        resetDurabilityState();
        delete globalThis.window.CapyAndroid;
        const keepOld = makeSnap('web-keep-1', { timestamp: 1000, lastOpened: 1000, filledCount: 1 });
        const delNew = makeSnap('web-del-2', { timestamp: 5000, lastOpened: 5000, filledCount: 5 });
        storageMod.StorageService.saveSnapshots([keepOld, delNew]);
        storageMod.StorageService.flushPendingBackups();

        const savedWebSet = globalThis.localStorage.setItem;
        const savedWebRem = globalThis.localStorage.removeItem;
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedWebSet(k, v);
        };
        if (failRemove) {
          globalThis.localStorage.removeItem = () => {
            throw new Error('Blocked removeItem');
          };
        }
        try {
          const partialRes = await storageMod.StorageService.deleteSnapshot('web-del-2');
          assert.deepEqual(partialRes.map((s) => s.id), ['web-keep-1']);
          assert.deepEqual(
            storageMod.StorageService.loadSnapshots().map((s) => s.id),
            ['web-keep-1'],
            `Desktop Web partial delete (failRemove=${failRemove}) must not resurrect web-del-2 at 0ms`
          );
        } finally {
          globalThis.localStorage.setItem = savedWebSet;
          globalThis.localStorage.removeItem = savedWebRem;
        }
        // Wait past 400ms debounce timer WITHOUT calling loadSnapshots first to verify auto-heal & drain
        await new Promise((resolve) => setTimeout(resolve, 460));
        let webTimerSpy = 0;
        globalThis.window.CapyAndroid = {
          saveBackup: () => {
            webTimerSpy += 1;
            return true;
          },
          loadBackup: () => null,
        };
        storageMod.StorageService.flushPendingBackups();
        assert.equal(webTimerSpy, 0, 'Desktop Web 400ms timer must drain pendingBackupWrites cleanly');
        assert.deepEqual(
          JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]').map((s) => s.id),
          ['web-keep-1'],
          'Desktop Web 400ms timer must heal localStorage after transient quota relief'
        );
        assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => s.id), ['web-keep-1']);
      }

      // L3: quotaFailedDeleteKeys preservation across post-delete edits + preferBackupOnTie when b.maxTs < a.maxTs
      resetDurabilityState();
      const postDelKeep = makeSnap('pd-keep', {
        timestamp: 1000,
        lastOpened: 1000,
        title: 'Old Title',
        isPinned: false,
        zoomScale: 1,
      });
      const postDelDrop = makeSnap('pd-drop', { timestamp: 5000, lastOpened: 5000, filledCount: 8 });
      storageMod.StorageService.saveSnapshots([postDelKeep, postDelDrop]);
      storageMod.StorageService.flushPendingBackups();

      const savedPdSet = globalThis.localStorage.setItem;
      const savedPdRem = globalThis.localStorage.removeItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8' || k === 'capy_active_session_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedPdSet(k, v);
      };
      globalThis.localStorage.removeItem = () => {
        throw new Error('Blocked removeItem');
      };
      try {
        await storageMod.StorageService.deleteSnapshot('pd-drop');
        storageMod.StorageService.renameSnapshot('pd-keep', 'Renamed Title');
        storageMod.StorageService.togglePinSnapshot('pd-keep');
        storageMod.StorageService.updateSnapshotViewport('pd-keep', 2.5, 12, -8);
        await storageMod.StorageService.importSnapshotData(
          JSON.stringify([
            makeSnap('pd-imp', { timestamp: 2000, lastOpened: 2000, filledCount: 2 }),
          ]),
          { refreshTimestamps: false }
        );

        const preFlushPostDel = storageMod.StorageService.loadSnapshots();
        assert.deepEqual(preFlushPostDel.map((s) => s.id), ['pd-imp', 'pd-keep']);
        const preKeep = preFlushPostDel.find((s) => s.id === 'pd-keep');
        assert.equal(preKeep?.title, 'Renamed Title');
        assert.equal(preKeep?.isPinned, true);
        assert.equal(preKeep?.zoomScale, 2.5);

        storageMod.StorageService.flushPendingBackups();
        const postFlushPostDel = storageMod.StorageService.loadSnapshots();
        assert.deepEqual(postFlushPostDel.map((s) => s.id), ['pd-imp', 'pd-keep']);
        assert.equal(postFlushPostDel.find((s) => s.id === 'pd-keep')?.title, 'Renamed Title');

        // Verify ACTIVE_STATE_KEY clears quotaFailedDeleteKeys on subsequent saveActiveState under QuotaExceededError
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'pd-old-act',
          activeColorId: 1,
          filledRegionIds: [1],
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        });
        storageMod.StorageService.clearActiveState();
        withMockedNow(1000, () => {
          storageMod.StorageService.saveActiveState({
            activeSnapshotId: 'pd-new-act',
            activeColorId: 3,
            filledRegionIds: [1, 2],
            zoomScale: 1.5,
            panOffsetX: 0,
            panOffsetY: 0,
          });
        });
        assert.equal(storageMod.StorageService.loadActiveState()?.activeSnapshotId, 'pd-new-act');
        storageMod.StorageService.flushPendingBackups();
        assert.equal(storageMod.StorageService.loadActiveState()?.activeSnapshotId, 'pd-new-act');
      } finally {
        globalThis.localStorage.setItem = savedPdSet;
        globalThis.localStorage.removeItem = savedPdRem;
      }
      assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => s.id), ['pd-imp', 'pd-keep']);

      // Desktop Web partial delete + rename under QuotaExceededError
      resetDurabilityState();
      delete globalThis.window.CapyAndroid;
      storageMod.StorageService.saveSnapshots([
        makeSnap('web-pd-keep', { timestamp: 1000, lastOpened: 1000, title: 'Before' }),
        makeSnap('web-pd-drop', { timestamp: 5000, lastOpened: 5000 }),
      ]);
      storageMod.StorageService.flushPendingBackups();
      const savedWebPdSet = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedWebPdSet(k, v);
      };
      try {
        await storageMod.StorageService.deleteSnapshot('web-pd-drop');
        storageMod.StorageService.renameSnapshot('web-pd-keep', 'Web Renamed');
        const webPostDel = storageMod.StorageService.loadSnapshots();
        assert.deepEqual(webPostDel.map((s) => s.id), ['web-pd-keep']);
        assert.equal(webPostDel[0]?.title, 'Web Renamed');
      } finally {
        globalThis.localStorage.setItem = savedWebPdSet;
      }

      // L4: Desktop Web forced-empty clearAllSnapshots recovery heals localStorage cleanly upon quota relief
      resetDurabilityState();
      delete globalThis.window.CapyAndroid;
      storageMod.StorageService.saveSnapshots([makeSnap('ghost-1', { timestamp: 5000, lastOpened: 5000 })]);
      storageMod.StorageService.saveActiveState({
        activeSnapshotId: 'ghost-1',
        activeColorId: 4,
        filledRegionIds: [1, 2, 3],
        zoomScale: 1,
        panOffsetX: 0,
        panOffsetY: 0,
      });
      storageMod.StorageService.flushPendingBackups();

      const savedGhostSet = globalThis.localStorage.setItem;
      const savedGhostRem = globalThis.localStorage.removeItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedGhostSet(k, v);
      };
      globalThis.localStorage.removeItem = () => {
        throw new Error('Blocked removeItem');
      };
      try {
        await storageMod.StorageService.clearAllSnapshots();
        assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
        assert.equal(storageMod.StorageService.loadActiveState(), null);
      } finally {
        globalThis.localStorage.setItem = savedGhostSet;
        globalThis.localStorage.removeItem = savedGhostRem;
      }
      assert.deepEqual(storageMod.StorageService.loadSnapshots(), []);
      assert.equal(storageMod.StorageService.loadActiveState(), null);
      assert.equal(mockStorage.get('capy_snapshots_v8'), '[]');
      assert.equal(mockStorage.has('capy_active_session_v8'), false);

      // Group M: Cross-platform pendingLocalHealWrites queue separation, 3-phase flushPendingBackups, and atomic metaUpdatedAt durability
      // M1: Persistent QuotaExceededError past 460ms across Desktop Web, CapyIOS & CapyAndroid preserves partial delete + rename & avoids iOS spam
      for (const platform of ['web', 'ios', 'android']) {
        for (const failRemove of [false, true]) {
          resetDurabilityState();
          const iosMessages = [];
          if (platform !== 'android') {
            delete globalThis.window.CapyAndroid;
          }
          if (platform === 'ios') {
            globalThis.window.webkit = {
              messageHandlers: { CapyIOS: { postMessage: (msg) => iosMessages.push(msg) } },
            };
          }
          storageMod.StorageService.saveSnapshots([
            makeSnap('m1-keep', { timestamp: 1000, lastOpened: 1000, title: 'Original Keep' }),
            makeSnap('m1-drop', { timestamp: 5000, lastOpened: 5000, filledCount: 9 }),
          ]);
          storageMod.StorageService.flushPendingBackups();
          const baseIosCount = iosMessages.length;

          const savedM1Set = globalThis.localStorage.setItem;
          const savedM1Rem = globalThis.localStorage.removeItem;
          globalThis.localStorage.setItem = (k, v) => {
            if (k === 'capy_snapshots_v8') {
              const err = new Error('Quota exceeded');
              err.name = 'QuotaExceededError';
              throw err;
            }
            return savedM1Set(k, v);
          };
          if (failRemove) {
            globalThis.localStorage.removeItem = () => {
              throw new Error('Blocked removeItem');
            };
          }
          try {
            await storageMod.StorageService.deleteSnapshot('m1-drop');
            storageMod.StorageService.renameSnapshot('m1-keep', 'Renamed M1');
            await new Promise((resolve) => setTimeout(resolve, 460));
            const at460 = storageMod.StorageService.loadSnapshots();
            assert.deepEqual(
              at460.map((s) => s.id),
              ['m1-keep'],
              `${platform} (failRemove=${failRemove}) must retain partial delete past 460ms persistent quota`
            );
            assert.equal(at460[0]?.title, 'Renamed M1');
            if (platform === 'ios') {
              assert.equal(iosMessages.length, baseIosCount + 2, 'CapyIOS must not spam postMessage during failed heal retries');
            }
          } finally {
            globalThis.localStorage.setItem = savedM1Set;
            globalThis.localStorage.removeItem = savedM1Rem;
          }
          storageMod.StorageService.flushPendingBackups();
          const healedM1 = JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]');
          assert.deepEqual(healedM1.map((s) => s.id), ['m1-keep']);
          assert.equal(healedM1[0]?.title, 'Renamed M1');
        }
      }

      // M2 & M3: clearAllSnapshots -> addSnapshot & clearActiveState -> saveActiveState past 460ms persistent quota + Phase 3 clear without load*() calls
      for (const platform of ['web', 'ios', 'android']) {
        // Persistent quota past 460ms on clearAllSnapshots + addSnapshot and clearActiveState -> saveActiveState
        resetDurabilityState();
        if (platform !== 'android') delete globalThis.window.CapyAndroid;
        if (platform === 'ios') {
          globalThis.window.webkit = { messageHandlers: { CapyIOS: { postMessage: () => {} } } };
        }
        storageMod.StorageService.saveSnapshots([makeSnap('m2-ghost', { timestamp: 5000, lastOpened: 5000 })]);
        withMockedNow(5000, () => {
          storageMod.StorageService.saveActiveState({
            activeSnapshotId: 'm2-ghost',
            activeColorId: 5,
            filledRegionIds: [1, 2, 3],
            zoomScale: 2,
            panOffsetX: 10,
            panOffsetY: 10,
          });
        });
        storageMod.StorageService.flushPendingBackups();

        const savedM2Set = globalThis.localStorage.setItem;
        const savedM2Rem = globalThis.localStorage.removeItem;
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8' || k === 'capy_active_session_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedM2Set(k, v);
        };
        globalThis.localStorage.removeItem = () => {
          throw new Error('Blocked removeItem');
        };
        try {
          await storageMod.StorageService.clearAllSnapshots();
          storageMod.StorageService.addSnapshot(makeSnap('m2-fresh', { timestamp: 1000, lastOpened: 1000 }));
          await new Promise((resolve) => setTimeout(resolve, 460));
          assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => s.id), ['m2-fresh']);
          assert.equal(storageMod.StorageService.loadActiveState(), null);

          withMockedNow(1000, () => {
            storageMod.StorageService.saveActiveState({
              activeSnapshotId: 'm2-fresh',
              activeColorId: 2,
              filledRegionIds: [1],
              zoomScale: 1,
              panOffsetX: 0,
              panOffsetY: 0,
            });
          });
          await new Promise((resolve) => setTimeout(resolve, 460));
          assert.equal(storageMod.StorageService.loadActiveState()?.activeSnapshotId, 'm2-fresh');
        } finally {
          globalThis.localStorage.setItem = savedM2Set;
          globalThis.localStorage.removeItem = savedM2Rem;
        }
        storageMod.StorageService.flushPendingBackups();
        assert.deepEqual(JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]').map((s) => s.id), ['m2-fresh']);

        // Quota relief before 460ms timer WITHOUT calling loadSnapshots()/loadActiveState() clears activeState via Phase 3
        resetDurabilityState();
        if (platform !== 'android') delete globalThis.window.CapyAndroid;
        if (platform === 'ios') {
          globalThis.window.webkit = { messageHandlers: { CapyIOS: { postMessage: () => {} } } };
        }
        storageMod.StorageService.saveSnapshots([makeSnap('m3-ghost', { timestamp: 5000, lastOpened: 5000 })]);
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'm3-ghost',
          activeColorId: 3,
          filledRegionIds: [1, 2],
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        });
        storageMod.StorageService.flushPendingBackups();

        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8' || k === 'capy_active_session_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedM2Set(k, v);
        };
        globalThis.localStorage.removeItem = () => {
          throw new Error('Blocked removeItem');
        };
        try {
          await storageMod.StorageService.clearAllSnapshots();
        } finally {
          globalThis.localStorage.setItem = savedM2Set;
          globalThis.localStorage.removeItem = savedM2Rem;
        }
        await new Promise((resolve) => setTimeout(resolve, 460));
        assert.equal(mockStorage.get('capy_snapshots_v8'), '[]', `${platform} Phase 2/3 must heal snapshots to []`);
        assert.equal(mockStorage.has('capy_active_session_v8'), false, `${platform} Phase 3 must remove stale active state`);
      }

      // M4: Android shrinking saveSnapshots under quota -> relief -> 460ms (no load calls) heals localStorage for cold reload
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([
        makeSnap('m4-a', { timestamp: 5000, lastOpened: 5000, filledCount: 5 }),
        makeSnap('m4-b', { timestamp: 1000, lastOpened: 1000, filledCount: 1 }),
      ]);
      storageMod.StorageService.flushPendingBackups();
      const savedM4Set = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedM4Set(k, v);
      };
      try {
        storageMod.StorageService.saveSnapshots([makeSnap('m4-b', { timestamp: 1000, lastOpened: 1000, filledCount: 1 })]);
      } finally {
        globalThis.localStorage.setItem = savedM4Set;
      }
      await new Promise((resolve) => setTimeout(resolve, 460));
      assert.deepEqual(
        JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]').map((s) => s.id),
        ['m4-b'],
        'Android Phase 2 must heal shrunk snapshot list in localStorage after transient quota relief'
      );

      // M5: Atomic metaUpdatedAt cold-reload durability (same-ms & clock-skew rename/pin/viewport/partial-delete & export/import hygiene)
      resetDurabilityState();
      withMockedNow(5000, () => {
        storageMod.StorageService.saveSnapshots([
          makeSnap('m5-keep', { timestamp: 1000, lastOpened: 5000, title: 'Orig M5', isPinned: false, zoomScale: 1 }),
          makeSnap('m5-drop', { timestamp: 9000, lastOpened: 9000, filledCount: 8 }),
        ]);
        storageMod.StorageService.flushPendingBackups();
      });
      const savedM5Set = globalThis.localStorage.setItem;
      const savedM5Rem = globalThis.localStorage.removeItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedM5Set(k, v);
      };
      globalThis.localStorage.removeItem = () => {
        throw new Error('Blocked removeItem');
      };
      try {
        await storageMod.StorageService.deleteSnapshot('m5-drop');
        withMockedNow(3000, () => {
          storageMod.StorageService.renameSnapshot('m5-keep', 'Skew Renamed M5');
          storageMod.StorageService.togglePinSnapshot('m5-keep');
        });
        withMockedNow(5000, () => {
          storageMod.StorageService.updateSnapshotViewport('m5-keep', 2.75, 14, -9);
        });
        storageMod.StorageService.flushPendingBackups();
      } finally {
        globalThis.localStorage.setItem = savedM5Set;
        globalThis.localStorage.removeItem = savedM5Rem;
      }
      // Fresh SSR module instance simulates cold reload while localStorage still holds stale Orig M5 + m5-drop!
      assert.equal(JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]').length, 2);
      const coldVite = await createServer({
        root: projectRoot,
        server: { middlewareMode: true, hmr: false, ws: false },
        optimizeDeps: { noDiscovery: true },
        appType: 'custom',
        logLevel: 'error',
      });
      try {
        const coldStorageMod = await coldVite.ssrLoadModule('/src/services/StorageService.ts');
        const coldSnaps = coldStorageMod.StorageService.loadSnapshots();
        assert.deepEqual(coldSnaps.map((s) => s.id), ['m5-keep']);
        assert.equal(coldSnaps[0]?.title, 'Skew Renamed M5');
        assert.equal(coldSnaps[0]?.isPinned, true);
        assert.equal(coldSnaps[0]?.zoomScale, 2.75);
        assert.equal(coldSnaps[0]?.panOffsetX, 14);
        assert.equal(coldSnaps[0]?.panOffsetY, -9);
        assert.equal(coldSnaps[0]?.timestamp, 1000);
        assert.equal(coldSnaps[0]?.lastOpened, 5000);
        assert.equal('metaUpdatedAt' in coldSnaps[0], false, 'loadSnapshots must strip internal metaUpdatedAt');
        const exported = await coldStorageMod.StorageService.exportSnapshot('m5-keep');
        assert.equal(exported.includes('metaUpdatedAt'), false, 'exportSnapshot must never leak internal metaUpdatedAt');
      } finally {
        await coldVite.close();
      }

      // M6: Forged metaUpdatedAt stripped on import, missing-ID rename/pin/viewport no-op, & accidental saveSnapshots([]) preserves pendingLocalHealWrites
      resetDurabilityState();
      const forgedImportRes = await storageMod.StorageService.importSnapshotBundle(
        JSON.stringify([{ ...makeSnap('forged-1', { lastOpened: 1000 }), metaUpdatedAt: 9999999999999 }]),
        { refreshTimestamps: false }
      );
      assert.equal(forgedImportRes.importedCount, 1);
      assert.equal('metaUpdatedAt' in (forgedImportRes.firstSnapshot || {}), false);
      assert.equal('metaUpdatedAt' in JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]')[0], false);

      let missingMetaWrites = 0;
      const savedMissingMetaSet = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        missingMetaWrites += 1;
        return savedMissingMetaSet(k, v);
      };
      try {
        storageMod.StorageService.renameSnapshot('nonexistent-id', 'Noop');
        storageMod.StorageService.togglePinSnapshot('nonexistent-id');
        storageMod.StorageService.updateSnapshotViewport('nonexistent-id', 2, 0, 0);
        assert.equal(missingMetaWrites, 0, 'Missing-ID metadata updates must be zero-write no-ops');
      } finally {
        globalThis.localStorage.setItem = savedMissingMetaSet;
      }

      delete globalThis.window.CapyAndroid;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedMissingMetaSet(k, v);
      };
      try {
        storageMod.StorageService.saveSnapshots([makeSnap('guard-heal', { lastOpened: 2000, filledCount: 4 })]);
      } finally {
        globalThis.localStorage.setItem = savedMissingMetaSet;
      }
      storageMod.StorageService.saveSnapshots([]);
      assert.equal(mockStorage.get('capy_snapshots_v8'), '[]');
      assert.deepEqual(storageMod.StorageService.loadSnapshots().map((s) => s.id), ['guard-heal']);
      assert.equal(JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]')[0]?.id, 'guard-heal');

      // Group N: Commit 6 edge-bug regression suite (unconditional monotonic metaUpdatedAt, storage-backed savedAt, bounded flush retries, sanitized bootstrap fallback)
      const withMockedNowAsync = async (nowMs, fn) => {
        const realNow = Date.now;
        Date.now = () => nowMs;
        try {
          return await fn();
        } finally {
          Date.now = realNow;
        }
      };
      const coldGroupVite = await createServer({
        root: projectRoot,
        server: { middlewareMode: true, hmr: false, ws: false },
        optimizeDeps: { noDiscovery: true },
        appType: 'custom',
        logLevel: 'error',
      });
      let coldReloadSeq = 0;
      const withColdStorage = async (fn) => {
        coldReloadSeq += 1;
        coldGroupVite.moduleGraph.invalidateAll();
        const mod = await coldGroupVite.ssrLoadModule(`/src/services/StorageService.ts?cold=${coldReloadSeq}`);
        return await fn(mod);
      };
      try {

      // N1 & N2: Unconditional monotonic metaUpdatedAt in updateSnapshotProgress (same-ms undo, sibling future lastOpened, backward clock skew, reverse saveBackup failure, & zero forward overhead)
      for (const platform of ['web', 'ios', 'android']) {
        resetDurabilityState();
        if (platform !== 'android') delete globalThis.window.CapyAndroid;
        if (platform === 'ios') {
          globalThis.window.webkit = { messageHandlers: { CapyIOS: { postMessage: () => {} } } };
        }
        withMockedNow(5000, () => {
          storageMod.StorageService.addSnapshot(
            makeSnap('n1-a', { timestamp: 5000, lastOpened: 5000, filledCount: 5, filledRegionIds: [1, 2, 3, 4, 5] })
          );
          storageMod.StorageService.addSnapshot(
            makeSnap('n1-sib', { timestamp: 9000, lastOpened: 9000, filledCount: 1, filledRegionIds: [1] })
          );
        });
        storageMod.StorageService.flushPendingBackups();

        // Normal forward clock (now > prevListMaxTs) must add zero metaUpdatedAt overhead
        withMockedNow(12000, () => {
          storageMod.StorageService.updateSnapshotProgress('n1-a', 6, 10, [1, 2, 3, 4, 5, 6]);
        });
        assert.equal(
          JSON.stringify(JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]')).includes('metaUpdatedAt'),
          false,
          `${platform} normal forward updateSnapshotProgress must add zero metaUpdatedAt overhead`
        );
        storageMod.StorageService.flushPendingBackups();

        const savedN1Set = globalThis.localStorage.setItem;
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedN1Set(k, v);
        };
        try {
          // Same-ms undo relative to n1-sib (9000) and n1-a (12000): clock at 5000 (<= prevListMaxTs 12000)
          withMockedNow(5000, () => {
            storageMod.StorageService.updateSnapshotProgress('n1-a', 2, 10, [1, 2]);
          });
        } finally {
          globalThis.localStorage.setItem = savedN1Set;
        }
        storageMod.StorageService.flushPendingBackups();
        await withColdStorage(async (coldMod) => {
          const cold = coldMod.StorageService.loadSnapshots();
          const a = cold.find((s) => s.id === 'n1-a');
          assert.equal(a?.filledCount, 2, `${platform} cold reload must preserve undone filledCount over higher sibling lastOpened`);
          assert.deepEqual(a?.filledRegionIds, [1, 2]);
          assert.equal('metaUpdatedAt' in (a || {}), false);
        });
      }

      // Same-ms undo with zero prior metaUpdatedAt + exact same-ms sibling tie (s1=5000, s2=9000, now=5000) and reverse saveBackup=false on Android
      resetDurabilityState();
      withMockedNow(5000, () => {
        storageMod.StorageService.saveSnapshots([
          makeSnap('n1-exact', { timestamp: 5000, lastOpened: 5000, filledCount: 5, filledRegionIds: [1, 2, 3, 4, 5] }),
          makeSnap('n1-future', { timestamp: 9000, lastOpened: 9000, filledCount: 1, filledRegionIds: [1] }),
        ]);
      });
      storageMod.StorageService.flushPendingBackups();
      const savedExactSet = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedExactSet(k, v);
      };
      try {
        withMockedNow(5000, () => {
          storageMod.StorageService.updateSnapshotProgress('n1-exact', 4, 10, [1, 2, 3, 4]);
        });
      } finally {
        globalThis.localStorage.setItem = savedExactSet;
      }
      storageMod.StorageService.flushPendingBackups();
      await withColdStorage(async (coldMod) => {
        const snap = coldMod.StorageService.loadSnapshots().find((s) => s.id === 'n1-exact');
        assert.equal(snap?.filledCount, 4);
        assert.equal('metaUpdatedAt' in (snap || {}), false);
      });

      // N2b: Android backward clock skew 10000 -> 3000 (both quota-on-local and saveBackup() === false reverse path)
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([
        makeSnap('n2-skew', { timestamp: 1000, lastOpened: 10000, filledCount: 1, filledRegionIds: [1] }),
      ]);
      storageMod.StorageService.flushPendingBackups();
      globalThis.window.CapyAndroid = {
        saveBackup: () => false,
        loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
      };
      withMockedNow(3000, () => {
        storageMod.StorageService.updateSnapshotProgress('n2-skew', 8, 10, [1, 2, 3, 4, 5, 6, 7, 8]);
      });
      // Cold reload BEFORE any flush recovery: localStorage (filledCount=8, lastOpened=3000) must beat stale backup (10000)
      await withColdStorage(async (coldMod) => {
        const snap = coldMod.StorageService.loadSnapshots().find((s) => s.id === 'n2-skew');
        assert.equal(snap?.filledCount, 8);
        assert.equal(snap?.lastOpened, 3000);
        assert.equal('metaUpdatedAt' in (snap || {}), false);
      });

      // N3 & N4: addSnapshot overwrite + syncImportedMetaTimestamps (both refreshTimestamps:true clock skew and refreshTimestamps:false older restore + single-save)
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([
        makeSnap('n3-add', { timestamp: 1000, lastOpened: 10000, title: 'Orig Add', filledCount: 9 }),
      ]);
      storageMod.StorageService.flushPendingBackups();
      const savedN3Set = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedN3Set(k, v);
      };
      try {
        withMockedNow(4000, () => {
          storageMod.StorageService.addSnapshot(
            makeSnap('n3-add', { timestamp: 1000, lastOpened: 4000, title: 'Readded Skew', filledCount: 2 })
          );
        });
      } finally {
        globalThis.localStorage.setItem = savedN3Set;
      }
      storageMod.StorageService.flushPendingBackups();
      await withColdStorage(async (coldMod) => {
        const snap = coldMod.StorageService.loadSnapshots().find((s) => s.id === 'n3-add');
        assert.equal(snap?.title, 'Readded Skew');
        assert.equal(snap?.filledCount, 2);
        assert.equal('metaUpdatedAt' in (snap || {}), false);
      });

      // N4a: importSnapshotBundle ({ refreshTimestamps: true }) under clock skew 10000 -> 3000
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([
        makeSnap('n4-imp', { timestamp: 1000, lastOpened: 10000, title: 'Pre-Import', filledCount: 7 }),
      ]);
      storageMod.StorageService.flushPendingBackups();
      const savedN4Set = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedN4Set(k, v);
      };
      try {
        const n4aRes = await withMockedNowAsync(3000, () =>
          storageMod.StorageService.importSnapshotBundle(
            JSON.stringify({
              version: 2,
              format: 'capy-archive-save',
              snapshots: [makeSnap('n4-imp', { timestamp: 1000, lastOpened: 1000, title: 'Fresh Skew Import', filledCount: 1 })],
              puzzles: {},
            }),
            { refreshTimestamps: true }
          )
        );
        assert.equal(n4aRes.importedCount, 1);
      } finally {
        globalThis.localStorage.setItem = savedN4Set;
      }
      storageMod.StorageService.flushPendingBackups();
      await withColdStorage(async (coldMod) => {
        const snap = coldMod.StorageService.loadSnapshots().find((s) => s.id === 'n4-imp');
        assert.equal(snap?.title, 'Fresh Skew Import');
        assert.equal(snap?.filledCount, 1);
      });

      // N4b: importSnapshotData ({ refreshTimestamps: false }) restoring older save (2000 over 5000) via array & capy-single-save & binary v2 archive
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([
        makeSnap('n4-old', { timestamp: 5000, lastOpened: 5000, title: 'Newer Corrupt', filledCount: 8 }),
      ]);
      storageMod.StorageService.flushPendingBackups();
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedN4Set(k, v);
      };
      try {
        const n4OldRes = await withMockedNowAsync(2000, () =>
          storageMod.StorageService.importSnapshotData(
            JSON.stringify([makeSnap('n4-old', { timestamp: 2000, lastOpened: 2000, title: 'Restored Older', filledCount: 3 })]),
            { refreshTimestamps: false }
          )
        );
        assert.equal(n4OldRes.importedCount, 1);
      } finally {
        globalThis.localStorage.setItem = savedN4Set;
      }
      storageMod.StorageService.flushPendingBackups();
      await withColdStorage(async (coldMod) => {
        const snap = coldMod.StorageService.loadSnapshots().find((s) => s.id === 'n4-old');
        assert.equal(snap?.title, 'Restored Older');
        assert.equal(snap?.filledCount, 3);
      });

      // Binary v2 archive overwrite with refreshTimestamps:false under clock skew/older timestamp
      const codecMod = await vite.ssrLoadModule('/src/services/CapyCodec.ts');
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([
        makeSnap('n4-bin', { timestamp: 8000, lastOpened: 8000, title: 'Pre-Bin', filledCount: 9 }),
      ]);
      storageMod.StorageService.flushPendingBackups();
      const binArchiveBytes = await codecMod.encodeArchiveSaveBinaryV2(
        [makeSnap('n4-bin', { timestamp: 2000, lastOpened: 2000, title: 'Restored Bin Archive', filledCount: 2 })],
        {},
        {},
        { exportDate: 2000 }
      );
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedN4Set(k, v);
      };
      try {
        const binRes = await withMockedNowAsync(2000, () =>
          storageMod.StorageService.importSnapshotData(binArchiveBytes, { refreshTimestamps: false })
        );
        assert.equal(binRes.importedCount, 1);
      } finally {
        globalThis.localStorage.setItem = savedN4Set;
      }
      storageMod.StorageService.flushPendingBackups();
      await withColdStorage(async (coldMod) => {
        const snap = coldMod.StorageService.loadSnapshots().find((s) => s.id === 'n4-bin');
        assert.equal(snap?.title, 'Restored Bin Archive');
        assert.equal(snap?.filledCount, 2);
      });

      // Single-save JSON & binary older restore (via addSnapshot inside importSnapshotBundle / importSnapshotData)
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([
        makeSnap('n4-single', { timestamp: 8000, lastOpened: 8000, title: 'Pre-Single', filledCount: 9 }),
      ]);
      storageMod.StorageService.flushPendingBackups();
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedN4Set(k, v);
      };
      try {
        const singleRes = await withMockedNowAsync(2000, () =>
          storageMod.StorageService.importSnapshotBundle(
            JSON.stringify({
              version: 2,
              format: 'capy-single-save',
              snapshot: makeSnap('n4-single', { timestamp: 2000, lastOpened: 2000, title: 'Restored Single', filledCount: 1 }),
              puzzle: null,
            }),
            { refreshTimestamps: false }
          )
        );
        assert.equal(singleRes.importedCount, 1);
      } finally {
        globalThis.localStorage.setItem = savedN4Set;
      }
      storageMod.StorageService.flushPendingBackups();
      await withColdStorage(async (coldMod) => {
        const snap = coldMod.StorageService.loadSnapshots().find((s) => s.id === 'n4-single');
        assert.equal(snap?.title, 'Restored Single');
        assert.equal(snap?.filledCount, 1);
      });

      // N5: Storage-backed monotonic savedAt in saveSettings and saveActiveState (backward clock skew + same-ms shrink + reverse saveBackup failure)
      resetDurabilityState();
      withMockedNow(10000, () => {
        storageMod.StorageService.saveSettings({
          ...storageMod.DEFAULT_SETTINGS,
          difficulty: 'EASY',
          zoomSensitivity: 1.1,
        });
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'n5-snap',
          activeColorId: 5,
          filledRegionIds: [1, 2, 3, 4, 5],
          resetEpoch: 1,
          zoomScale: 1.5,
          panOffsetX: 10,
          panOffsetY: 10,
        });
      });
      storageMod.StorageService.flushPendingBackups();
      const savedN5Set = globalThis.localStorage.setItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_user_settings_v8' || k === 'capy_active_session_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedN5Set(k, v);
      };
      try {
        withMockedNow(3000, () => {
          storageMod.StorageService.saveSettings({
            ...storageMod.DEFAULT_SETTINGS,
            difficulty: 'NORMAL',
            zoomSensitivity: 1.9,
          });
          storageMod.StorageService.saveActiveState({
            activeSnapshotId: 'n5-snap',
            activeColorId: 2,
            filledRegionIds: [1],
            resetEpoch: 1,
            zoomScale: 1.0,
            panOffsetX: 0,
            panOffsetY: 0,
          });
        });
      } finally {
        globalThis.localStorage.setItem = savedN5Set;
      }
      storageMod.StorageService.flushPendingBackups();
      await withColdStorage(async (coldMod) => {
        const s = coldMod.StorageService.loadSettings();
        const a = coldMod.StorageService.loadActiveState();
        assert.equal(s.difficulty, 'NORMAL');
        assert.equal(s.zoomSensitivity, 1.9);
        assert.equal('savedAt' in s, false);
        assert.equal(a?.activeColorId, 2);
        assert.deepEqual(a?.filledRegionIds, [1]);
        assert.equal('savedAt' in (a || {}), false);
      });

      // Same-ms shrink (10000 -> 10000) and reverse Android saveBackup=false path for settings & activeState
      resetDurabilityState();
      withMockedNow(10000, () => {
        storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, difficulty: 'EASY' });
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'n5-same',
          activeColorId: 4,
          filledRegionIds: [1, 2, 3, 4],
          resetEpoch: 1,
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        });
      });
      storageMod.StorageService.flushPendingBackups();
      globalThis.window.CapyAndroid = {
        saveBackup: () => false,
        loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
      };
      withMockedNow(10000, () => {
        storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, difficulty: 'NORMAL' });
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'n5-same',
          activeColorId: 1,
          filledRegionIds: [1],
          resetEpoch: 1,
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        });
      });
      await withColdStorage(async (coldMod) => {
        assert.equal(coldMod.StorageService.loadSettings().difficulty, 'NORMAL');
        assert.deepEqual(coldMod.StorageService.loadActiveState()?.filledRegionIds, [1]);
      });

      // N6: Bounded backoff retry scheduling in flushPendingBackups (B1b, P5, N8b, E1-E6, 0 Desktop Web normal timers)
      // N6a (B1b): clearAllSnapshots under 550ms quota > 400ms first tick heals by 1100ms across web, ios, android with zero CapyIOS spam
      for (const platform of ['web', 'ios', 'android']) {
        resetDurabilityState();
        const iosN6a = [];
        if (platform !== 'android') delete globalThis.window.CapyAndroid;
        if (platform === 'ios') {
          globalThis.window.webkit = { messageHandlers: { CapyIOS: { postMessage: (m) => iosN6a.push(m) } } };
        }
        storageMod.StorageService.saveSnapshots([makeSnap('n6a-ghost', { timestamp: 5000, lastOpened: 5000 })]);
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'n6a-ghost',
          activeColorId: 1,
          filledRegionIds: [1, 2],
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        });
        storageMod.StorageService.flushPendingBackups();
        const baseIosN6a = iosN6a.length;

        const savedN6aSet = globalThis.localStorage.setItem;
        const savedN6aRem = globalThis.localStorage.removeItem;
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8' || k === 'capy_active_session_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedN6aSet(k, v);
        };
        globalThis.localStorage.removeItem = () => {
          throw new Error('Blocked removeItem');
        };
        try {
          await storageMod.StorageService.clearAllSnapshots();
          await new Promise((resolve) => setTimeout(resolve, 550));
        } finally {
          globalThis.localStorage.setItem = savedN6aSet;
          globalThis.localStorage.removeItem = savedN6aRem;
        }
        // Wait 550ms post-relief (total 1100ms > 400ms+400ms=800ms) WITHOUT calling load*/flushPendingBackups
        await new Promise((resolve) => setTimeout(resolve, 550));
        assert.equal(mockStorage.get('capy_snapshots_v8'), '[]', `${platform} B1b must auto-heal snapshots after transient quota`);
        assert.equal(mockStorage.has('capy_active_session_v8'), false, `${platform} B1b must auto-clear active state after transient quota`);
        if (platform === 'ios') {
          assert.equal(iosN6a.length, baseIosN6a + 2, 'CapyIOS B1b retry must emit zero duplicate postMessage spam');
        }
        await withColdStorage(async (coldMod) => {
          assert.deepEqual(coldMod.StorageService.loadSnapshots(), []);
          assert.equal(coldMod.StorageService.loadActiveState(), null);
        });
      }

      // N6b (P5): Manual flushPendingBackups() while quota still active reschedules 400ms retry and heals after relief
      for (const platform of ['web', 'ios', 'android']) {
        resetDurabilityState();
        if (platform !== 'android') delete globalThis.window.CapyAndroid;
        if (platform === 'ios') {
          globalThis.window.webkit = { messageHandlers: { CapyIOS: { postMessage: () => {} } } };
        }
        storageMod.StorageService.saveSnapshots([
          makeSnap('n6b-keep', { timestamp: 1000, lastOpened: 1000, title: 'Orig P5' }),
          makeSnap('n6b-drop', { timestamp: 5000, lastOpened: 5000, filledCount: 7 }),
        ]);
        storageMod.StorageService.flushPendingBackups();

        const savedN6bSet = globalThis.localStorage.setItem;
        const savedN6bRem = globalThis.localStorage.removeItem;
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedN6bSet(k, v);
        };
        globalThis.localStorage.removeItem = () => {
          throw new Error('Blocked removeItem');
        };
        try {
          await storageMod.StorageService.deleteSnapshot('n6b-drop');
          storageMod.StorageService.renameSnapshot('n6b-keep', 'Renamed P5');
          storageMod.StorageService.flushPendingBackups();
        } finally {
          globalThis.localStorage.setItem = savedN6bSet;
          globalThis.localStorage.removeItem = savedN6bRem;
        }
        await new Promise((resolve) => setTimeout(resolve, 480));
        await withColdStorage(async (coldMod) => {
          const snaps = coldMod.StorageService.loadSnapshots();
          assert.deepEqual(snaps.map((s) => s.id), ['n6b-keep'], `${platform} P5 must heal partial delete via scheduled retry`);
          assert.equal(snaps[0]?.title, 'Renamed P5');
        });
      }

      // N6c (E5): Android saveBackup() === false transient failure lasting 550ms heals automatically by 1100ms
      resetDurabilityState();
      let n6cBackupOk = true;
      globalThis.window.CapyAndroid = {
        saveBackup: (k, v) => {
          if (!n6cBackupOk) return false;
          mockBackups.set(k, String(v));
          return true;
        },
        loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
      };
      storageMod.StorageService.saveSnapshots([makeSnap('n6c-1', { lastOpened: 1000, filledCount: 1 })]);
      storageMod.StorageService.flushPendingBackups();
      n6cBackupOk = false;
      storageMod.StorageService.saveSnapshots([makeSnap('n6c-1', { lastOpened: 5000, filledCount: 6 })]);
      await new Promise((resolve) => setTimeout(resolve, 550));
      assert.equal(JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]')[0]?.filledCount, 1);
      n6cBackupOk = true;
      await new Promise((resolve) => setTimeout(resolve, 550));
      assert.equal(
        JSON.parse(mockBackups.get('capy_snapshots_v8') || '[]')[0]?.filledCount,
        6,
        'Android transient saveBackup failure must self-heal via retry timer'
      );

      // N6d: Normal Desktop Web 0 timers + bounded [400, 400, 800, 1600, 3200] retry schedule + !isRetry reset + 0 post-heal timer leaks
      resetDurabilityState();
      delete globalThis.window.CapyAndroid;
      const origSetTimeout = globalThis.setTimeout;
      const origClearTimeout = globalThis.clearTimeout;
      const fakeTimers = [];
      let nextTimerId = 1;
      const installFakeTimers = () => {
        fakeTimers.length = 0;
        globalThis.setTimeout = (fn, delay) => {
          const handle = {
            id: nextTimerId++,
            fn,
            delay,
            cleared: false,
            unrefCalled: false,
            unref() {
              this.unrefCalled = true;
              return this;
            },
          };
          fakeTimers.push(handle);
          return handle;
        };
        globalThis.clearTimeout = (handle) => {
          if (handle && typeof handle === 'object') {
            handle.cleared = true;
          }
        };
      };
      try {
        installFakeTimers();
        // Normal Desktop Web writes must arm ZERO timers
        storageMod.StorageService.saveSnapshots([makeSnap('n6d-norm', { lastOpened: 2000 })]);
        storageMod.StorageService.saveSettings(storageMod.DEFAULT_SETTINGS);
        storageMod.StorageService.saveActiveState({
          activeSnapshotId: 'n6d-norm',
          activeColorId: 1,
          filledRegionIds: [1],
          zoomScale: 1,
          panOffsetX: 0,
          panOffsetY: 0,
        });
        await storageMod.StorageService.deleteSnapshot('n6d-norm');
        assert.equal(fakeTimers.length, 0, 'Normal non-fault Desktop Web writes must schedule ZERO timers');

        // Bounded backoff retries under persistent quota
        const savedN6dSet = globalThis.localStorage.setItem;
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedN6dSet(k, v);
        };
        try {
          storageMod.StorageService.saveSnapshots([makeSnap('n6d-q1', { lastOpened: 3000 })]);
          assert.deepEqual(fakeTimers.map((t) => t.delay), [400]);
          assert.equal(fakeTimers[0]?.unrefCalled, true, 'Backup flush timer must call unref()');
          for (let step = 0; step < 6; step++) {
            const active = fakeTimers.filter((t) => !t.cleared).pop();
            if (!active) break;
            active.cleared = true;
            active.fn();
          }
          assert.deepEqual(
            fakeTimers.map((t) => t.delay),
            [400, 400, 800, 1600, 3200, 3200],
            'Retry backoff must execute bounded [400, 400, 800, 1600, 3200] schedule and halt after 5 retries'
          );
          assert.equal(fakeTimers.filter((t) => !t.cleared).length, 0);

          // New user mutation (!isRetry) cancels active slow retry timer and resets delay to 400ms
          fakeTimers.length = 0;
          storageMod.StorageService.saveSnapshots([makeSnap('n6d-q2', { lastOpened: 4000 })]);
          fakeTimers[0].cleared = true;
          fakeTimers[0].fn();
          fakeTimers[1].cleared = true;
          fakeTimers[1].fn();
          assert.equal(fakeTimers[2]?.delay, 800);
          assert.equal(fakeTimers[2]?.cleared, false);
          storageMod.StorageService.saveSnapshots([makeSnap('n6d-q3', { lastOpened: 5000 })]);
          assert.equal(fakeTimers[2]?.cleared, true, 'New mutation must clear pending slow retry timer');
          assert.equal(fakeTimers[3]?.delay, 400, 'New mutation must reset debounce delay to 400ms');
        } finally {
          globalThis.localStorage.setItem = savedN6dSet;
        }
        const preHealTimerCount = fakeTimers.length;
        const pendingHealHandle = fakeTimers.filter((t) => !t.cleared).pop();
        assert.ok(pendingHealHandle);
        pendingHealHandle.cleared = true;
        pendingHealHandle.fn();
        assert.equal(fakeTimers.length, preHealTimerCount, 'Post-heal flush must schedule ZERO timers');
        assert.equal(fakeTimers.filter((t) => !t.cleared).length, 0);
        assert.equal(JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]')[0]?.id, 'n6d-q3');

        // CapyIOS 5-retry sequence under persistent quota must emit zero duplicate postMessage spam
        resetDurabilityState();
        delete globalThis.window.CapyAndroid;
        const iosN6d = [];
        globalThis.window.webkit = {
          messageHandlers: { CapyIOS: { postMessage: (m) => iosN6d.push(m) } },
        };
        fakeTimers.length = 0;
        const savedN6dIosSet = globalThis.localStorage.setItem;
        globalThis.localStorage.setItem = (k, v) => {
          if (k === 'capy_snapshots_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedN6dIosSet(k, v);
        };
        try {
          storageMod.StorageService.saveSnapshots([makeSnap('n6d-ios', { lastOpened: 6000 })]);
          assert.equal(iosN6d.length, 0);
          for (let step = 0; step < 6; step++) {
            const active = fakeTimers.filter((t) => !t.cleared).pop();
            if (!active) break;
            active.cleared = true;
            active.fn();
          }
          assert.equal(iosN6d.length, 1, 'CapyIOS retry ticks must emit zero duplicate postMessage calls');
          assert.deepEqual(fakeTimers.map((t) => t.delay), [400, 400, 800, 1600, 3200, 3200]);
        } finally {
          globalThis.localStorage.setItem = savedN6dIosSet;
        }
        storageMod.StorageService.flushPendingBackups();
        assert.equal(iosN6d.length, 1, 'Post-heal CapyIOS flush must not re-post already backed-up payload');
      } finally {
        globalThis.setTimeout = origSetTimeout;
        globalThis.clearTimeout = origClearTimeout;
      }

      // N7 (BUG4 / B4e): isBootstrapBatch firstSnapshot fallback must strip forged metaUpdatedAt across all archive/array paths
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([makeSnap('n7-existing', { lastOpened: 5000 })]);
      const forgedSample = {
        ...makeSnap('n7-existing', { lastOpened: 2000 }),
        isAutoSample: true,
        metaUpdatedAt: 9999999999999,
      };
      const bootArrayRes = await storageMod.StorageService.importSnapshotBundle(
        JSON.stringify([forgedSample]),
        { refreshTimestamps: true }
      );
      assert.equal(bootArrayRes.importedCount, 1);
      assert.equal('metaUpdatedAt' in (bootArrayRes.firstSnapshot || {}), false, 'Bootstrap array firstSnapshot must strip metaUpdatedAt');

      const bootArchiveRes = await storageMod.StorageService.importSnapshotBundle(
        JSON.stringify({ version: 2, format: 'capy-archive-save', snapshots: [forgedSample], puzzles: {} }),
        { refreshTimestamps: true }
      );
      assert.equal(bootArchiveRes.importedCount, 1);
      assert.equal('metaUpdatedAt' in (bootArchiveRes.firstSnapshot || {}), false, 'Bootstrap archive firstSnapshot must strip metaUpdatedAt');

      const bootBinBytes = await codecMod.encodeArchiveSaveBinaryV2([forgedSample], {}, {});
      const bootBinRes = await storageMod.StorageService.importSnapshotData(bootBinBytes, { refreshTimestamps: true });
      assert.equal(bootBinRes.importedCount, 1);
      assert.equal('metaUpdatedAt' in (bootBinRes.firstSnapshot || {}), false, 'Bootstrap binary archive firstSnapshot must strip metaUpdatedAt');

      // N8 (C6-NEW-1): clearActiveState with saveBackup() === false must not ignore stale native backup timestamp on subsequent saveActiveState / saveSettings under clock skew
      for (const withEpoch of [false, true]) {
        resetDurabilityState();
        withMockedNow(10000, () => {
          storageMod.StorageService.saveActiveState({
            activeSnapshotId: 'old-ghost',
            activeColorId: 3,
            filledRegionIds: [1, 2, 3],
            ...(withEpoch ? { resetEpoch: 3 } : {}),
            zoomScale: 1,
            panOffsetX: 0,
            panOffsetY: 0,
          });
        });
        storageMod.StorageService.flushPendingBackups();
        globalThis.window.CapyAndroid = {
          saveBackup: () => false,
          loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
        };
        storageMod.StorageService.clearActiveState();
        assert.equal(mockStorage.has('capy_active_session_v8'), false);
        withMockedNow(3000, () => {
          storageMod.StorageService.saveActiveState({
            activeSnapshotId: 'new-puzzle',
            activeColorId: 7,
            filledRegionIds: [4],
            ...(withEpoch ? { resetEpoch: 1 } : {}),
            zoomScale: 1.5,
            panOffsetX: 5,
            panOffsetY: -5,
          });
        });
        await withColdStorage(async (coldMod) => {
          const act = coldMod.StorageService.loadActiveState();
          assert.equal(
            act?.activeSnapshotId,
            'new-puzzle',
            `C6-NEW-1 (withEpoch=${withEpoch}) cold reload must keep new-puzzle over stale native backup old-ghost`
          );
          assert.equal(act?.activeColorId, 7);
          assert.deepEqual(act?.filledRegionIds, [4]);
          if (withEpoch) {
            assert.equal(act?.resetEpoch, 1);
          }
          assert.equal('savedAt' in (act || {}), false);
        });
      }

      // C6-NEW-1 settings parity: failed saveBackup sets staleNativeBackupKeys, then local loss + backward-skew saveSettings must still outrank stale native backup
      resetDurabilityState();
      withMockedNow(10000, () => {
        storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, difficulty: 'EASY' });
      });
      storageMod.StorageService.flushPendingBackups();
      globalThis.window.CapyAndroid = {
        saveBackup: () => false,
        loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
      };
      withMockedNow(10000, () => {
        storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, difficulty: 'EASY', largeText: true });
      });
      storageMod.StorageService.flushPendingBackups();
      mockStorage.delete('capy_user_settings_v8');
      withMockedNow(3000, () => {
        storageMod.StorageService.saveSettings({ ...storageMod.DEFAULT_SETTINGS, difficulty: 'NORMAL', largeText: false });
      });
      await withColdStorage(async (coldMod) => {
        const s = coldMod.StorageService.loadSettings();
        assert.equal(s.difficulty, 'NORMAL');
        assert.equal(s.largeText, false);
        assert.equal('savedAt' in s, false);
      });

      // N9 (C6-NEW-2a..2d): Post-empty-list stale store floor across clearAllSnapshots / deleteSnapshot 1->0 + addSnapshot & older importSnapshotData/Bundle
      // Clean empty addSnapshot must still emit ZERO metaUpdatedAt overhead
      resetDurabilityState();
      await storageMod.StorageService.clearAllSnapshots();
      withMockedNow(3000, () => {
        storageMod.StorageService.addSnapshot(makeSnap('clean-empty-add', { timestamp: 3000, lastOpened: 3000 }));
      });
      assert.equal(
        JSON.stringify(JSON.parse(mockStorage.get('capy_snapshots_v8') || '[]')).includes('metaUpdatedAt'),
        false,
        'addSnapshot onto cleanly empty storage must add zero metaUpdatedAt overhead'
      );

      // N9a (C6-NEW-2a): clearAllSnapshots & deleteSnapshot 1->0 with saveBackup('[]') === false + skewed addSnapshot -> cold reload <400ms
      for (const emptyMode of ['clearAll', 'deleteLast']) {
        resetDurabilityState();
        const oldId = emptyMode === 'clearAll' ? 'old-snap' : 'last-one';
        const newId = emptyMode === 'clearAll' ? 'new-snap' : 'fresh-after-del';
        storageMod.StorageService.saveSnapshots([makeSnap(oldId, { timestamp: 1000, lastOpened: 10000 })]);
        storageMod.StorageService.flushPendingBackups();
        globalThis.window.CapyAndroid = {
          saveBackup: () => false,
          loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
        };
        if (emptyMode === 'clearAll') {
          await storageMod.StorageService.clearAllSnapshots();
        } else {
          await storageMod.StorageService.deleteSnapshot(oldId);
        }
        withMockedNow(3000, () => {
          storageMod.StorageService.addSnapshot(makeSnap(newId, { timestamp: 3000, lastOpened: 3000, title: `Fresh ${emptyMode}` }));
        });
        await withColdStorage(async (coldMod) => {
          const snaps = coldMod.StorageService.loadSnapshots();
          assert.deepEqual(
            snaps.map((s) => s.id),
            [newId],
            `C6-NEW-2a (${emptyMode}) must keep newly added snapshot over stale native backup`
          );
          assert.equal('metaUpdatedAt' in (snaps[0] || {}), false);
        });
      }

      // N9b (C6-NEW-2b): clearAllSnapshots + QuotaExceededError + blocked removeItem + skewed addSnapshot -> unhealed localStorage cold reload
      resetDurabilityState();
      storageMod.StorageService.saveSnapshots([makeSnap('old-q-snap', { timestamp: 1000, lastOpened: 10000 })]);
      storageMod.StorageService.flushPendingBackups();
      const savedN9bSet = globalThis.localStorage.setItem;
      const savedN9bRem = globalThis.localStorage.removeItem;
      globalThis.localStorage.setItem = (k, v) => {
        if (k === 'capy_snapshots_v8' || k === 'capy_active_session_v8') {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return savedN9bSet(k, v);
      };
      globalThis.localStorage.removeItem = () => {
        throw new Error('Blocked removeItem');
      };
      try {
        await storageMod.StorageService.clearAllSnapshots();
        withMockedNow(3000, () => {
          storageMod.StorageService.addSnapshot(makeSnap('new-q-snap', { timestamp: 3000, lastOpened: 3000, title: 'New Q Snap' }));
        });
        storageMod.StorageService.flushPendingBackups();
      } finally {
        globalThis.localStorage.setItem = savedN9bSet;
        globalThis.localStorage.removeItem = savedN9bRem;
      }
      await withColdStorage(async (coldMod) => {
        const snaps = coldMod.StorageService.loadSnapshots();
        assert.deepEqual(
          snaps.map((s) => s.id),
          ['new-q-snap'],
          'C6-NEW-2b must keep new-q-snap over unhealed localStorage old-q-snap'
        );
        assert.equal('metaUpdatedAt' in (snaps[0] || {}), false);
      });

      // N9c (C6-NEW-2c & C6-NEW-2d): importSnapshotData/Bundle({ refreshTimestamps: false }) restoring older save after clearAllSnapshots (JSON archive, array, & binary v2 archive, with normal forward clock and skewed clock)
      for (const restoreCase of [
        { mode: '2c-quota-unhealed', format: 'json-archive', nowMs: 20000 },
        { mode: '2c-quota-unhealed', format: 'json-array', nowMs: 20000 },
        { mode: '2c-quota-unhealed', format: 'bin-archive', nowMs: 20000 },
        { mode: '2d-saveBackup-false', format: 'json-archive', nowMs: 20000 },
        { mode: '2d-saveBackup-false', format: 'bin-archive', nowMs: 2000 },
      ]) {
        resetDurabilityState();
        storageMod.StorageService.saveSnapshots([makeSnap('old-imp', { timestamp: 1000, lastOpened: 10000 })]);
        storageMod.StorageService.flushPendingBackups();
        const restoredSnap = makeSnap('restored-imp', {
          timestamp: 2000,
          lastOpened: 2000,
          title: 'Restored Older Backup',
          filledCount: 4,
        });
        const payload =
          restoreCase.format === 'bin-archive'
            ? await codecMod.encodeArchiveSaveBinaryV2([restoredSnap], {}, {}, { exportDate: 2000 })
            : restoreCase.format === 'json-array'
              ? JSON.stringify([restoredSnap])
              : JSON.stringify({
                  version: 2,
                  format: 'capy-archive-save',
                  snapshots: [restoredSnap],
                  puzzles: {},
                });
        if (restoreCase.mode === '2c-quota-unhealed') {
          const savedImpSet = globalThis.localStorage.setItem;
          const savedImpRem = globalThis.localStorage.removeItem;
          globalThis.localStorage.setItem = (k, v) => {
            if (k === 'capy_snapshots_v8' || k === 'capy_active_session_v8') {
              const err = new Error('Quota exceeded');
              err.name = 'QuotaExceededError';
              throw err;
            }
            return savedImpSet(k, v);
          };
          globalThis.localStorage.removeItem = () => {
            throw new Error('Blocked removeItem');
          };
          try {
            await storageMod.StorageService.clearAllSnapshots();
            const impRes = await withMockedNowAsync(restoreCase.nowMs, () =>
              storageMod.StorageService.importSnapshotData(payload, { refreshTimestamps: false })
            );
            assert.equal(impRes.importedCount, 1);
            storageMod.StorageService.flushPendingBackups();
          } finally {
            globalThis.localStorage.setItem = savedImpSet;
            globalThis.localStorage.removeItem = savedImpRem;
          }
        } else {
          globalThis.window.CapyAndroid = {
            saveBackup: () => false,
            loadBackup: (k) => (mockBackups.has(k) ? mockBackups.get(k) : null),
          };
          await storageMod.StorageService.clearAllSnapshots();
          const impRes = await withMockedNowAsync(restoreCase.nowMs, () =>
            storageMod.StorageService.importSnapshotData(payload, { refreshTimestamps: false })
          );
          assert.equal(impRes.importedCount, 1);
        }
        await withColdStorage(async (coldMod) => {
          const snaps = coldMod.StorageService.loadSnapshots();
          assert.deepEqual(
            snaps.map((s) => s.id),
            ['restored-imp'],
            `C6-NEW-${restoreCase.mode} (${restoreCase.format}) must keep restored-imp over stale old-imp`
          );
          assert.equal(snaps[0]?.lastOpened, 2000);
          assert.equal('metaUpdatedAt' in (snaps[0] || {}), false);
        });
      }

      // N10 (C6-NEW-3): updateSnapshotProgress missing-ID must be a zero-write, zero-warning, zero-timer no-op on both empty and populated lists
      for (const seedNonEmpty of [false, true]) {
        resetDurabilityState();
        if (seedNonEmpty) {
          storageMod.StorageService.saveSnapshots([
            makeSnap('present-1', { lastOpened: 5000, filledCount: 2, filledRegionIds: [1, 2] }),
          ]);
          storageMod.StorageService.flushPendingBackups();
        }
        let n10Writes = 0;
        const n10QuotaWarnings = [];
        const n10Timers = [];
        const savedN10Set = globalThis.localStorage.setItem;
        const origN10SetTimeout = globalThis.setTimeout;
        const origN10ClearTimeout = globalThis.clearTimeout;
        const unsubN10Quota = storageMod.StorageService.onQuotaWarning((w) => n10QuotaWarnings.push(w));
        globalThis.localStorage.setItem = (k, v) => {
          n10Writes += 1;
          if (k === 'capy_snapshots_v8') {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return savedN10Set(k, v);
        };
        globalThis.setTimeout = (fn, delay) => {
          const handle = { id: n10Timers.length + 1, fn, delay, cleared: false, unref() { return this; } };
          n10Timers.push(handle);
          return handle;
        };
        globalThis.clearTimeout = (handle) => {
          if (handle && typeof handle === 'object') handle.cleared = true;
        };
        try {
          const res = storageMod.StorageService.updateSnapshotProgress('missing-id', 9, 10, [1, 2, 3]);
          assert.equal(n10Writes, 0, `updateSnapshotProgress missing-id (seed=${seedNonEmpty}) must emit 0 setItem writes`);
          assert.equal(n10QuotaWarnings.length, 0, 'updateSnapshotProgress missing-id must emit 0 quota warnings');
          assert.equal(n10Timers.length, 0, 'updateSnapshotProgress missing-id must schedule 0 backup timers');
          if (seedNonEmpty) {
            assert.deepEqual(res.map((s) => s.id), ['present-1']);
            assert.equal(res[0]?.filledCount, 2);
          } else {
            assert.deepEqual(res, []);
          }
        } finally {
          unsubN10Quota();
          globalThis.localStorage.setItem = savedN10Set;
          globalThis.setTimeout = origN10SetTimeout;
          globalThis.clearTimeout = origN10ClearTimeout;
        }
      }
      } finally {
        await coldGroupVite.close();
      }

      resetDurabilityState();

      const workerSvcSrc = fs.readFileSync(
        path.resolve(projectRoot, 'src/services/PuzzleWorkerService.ts'),
        'utf8'
      );
      assert.equal(
        /^\s*import\s+[^;]*PuzzleGenerator/m.test(workerSvcSrc),
        false,
        'PuzzleWorkerService.ts must dynamically import PuzzleGenerator on fallback instead of static bundle import'
      );
    } finally {
      resetDurabilityState();
      globalThis.localStorage = prevLs;
      globalThis.window = prevSsrWin;
    }
}
