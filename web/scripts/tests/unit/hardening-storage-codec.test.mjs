/**
 * Release Safety & Hardening — Storage Quarantine, CapyCodec Schemas, SnapshotPaths, SVG, Base64 & ErrorBoundary.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '../../..');
const REPO_ROOT = path.resolve(WEB_ROOT, '..');

export async function runHardeningStorageCodecTests(vite) {
  // 6c. StorageService corruption quarantine, freshness recovery, deleteSnapshot immediate backup & deserializePuzzle DoS
  {
    // StorageService corruption quarantine, freshness recovery, deleteSnapshot immediate backup & deserializePuzzle DoS
    {
      const prevWin = globalThis.window;
      const prevLs = globalThis.localStorage;
      const lsMap = new Map();
      const backupMap = new Map();
      const mockStorage = {
        getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
        setItem: (k, v) => lsMap.set(k, String(v)),
        removeItem: (k) => lsMap.delete(k),
      };
      globalThis.localStorage = mockStorage;
      globalThis.window = {
        location: { pathname: '/', origin: 'https://capypaint.com', hostname: 'capypaint.com', search: '' },
        localStorage: mockStorage,
        CapyAndroid: {
          saveBackup: (k, v) => backupMap.set(k, String(v)),
          loadBackup: (k) => (backupMap.has(k) ? backupMap.get(k) : null),
          isPlayGamesConfigured: () => false,
          getPlatformName: () => 'android',
        },
      };
      try {
        const storageMod = await vite.ssrLoadModule('/src/services/StorageService.ts');
        const mainSrc = fs.readFileSync(path.join(WEB_ROOT, 'src/main.tsx'), 'utf8');
        assert.equal(
          /^\s*\(window as any\)\.capyStorage\s*=/m.test(mainSrc),
          false,
          'web/src/main.tsx must not unconditionally expose window.capyStorage'
        );

        // Corrupt snapshots JSON -> quarantine local & recover backup without overwriting backup with []
        const backupSnaps = [
          {
            id: 'snap_b',
            title: 'Backup',
            previewDataUrl: '',
            filledCount: 5,
            totalCount: 10,
            timestamp: 2000,
            lastOpened: 5000,
          },
        ];
        backupMap.set('capy_snapshots_v8', JSON.stringify(backupSnaps));
        lsMap.set('capy_snapshots_v8', '{CORRUPT');
        const recovered = storageMod.StorageService.loadSnapshots();
        assert.equal(recovered.length, 1);
        assert.equal(recovered[0].id, 'snap_b');
        assert.equal(lsMap.has('capy_snapshots_v8__corrupt_quarantine'), true);
        assert.equal(JSON.parse(backupMap.get('capy_snapshots_v8')).length, 1);

        // Freshness comparison prefers newer lastOpened in backup over stale local
        lsMap.set(
          'capy_snapshots_v8',
          JSON.stringify([
            {
              id: 'snap_b',
              title: 'Stale Local',
              previewDataUrl: '',
              filledCount: 1,
              totalCount: 10,
              timestamp: 1000,
              lastOpened: 1000,
            },
          ])
        );
        const fresher = storageMod.StorageService.loadSnapshots();
        assert.equal(fresher[0].filledCount, 5);

        // deleteSnapshot flushes native backup immediately even when non-empty saves remain
        lsMap.set(
          'capy_snapshots_v8',
          JSON.stringify([
            ...backupSnaps,
            {
              id: 'snap_c',
              title: 'C',
              previewDataUrl: '',
              filledCount: 1,
              totalCount: 10,
              timestamp: 3000,
              lastOpened: 3000,
            },
          ])
        );
        backupMap.set('capy_snapshots_v8', lsMap.get('capy_snapshots_v8'));
        await storageMod.StorageService.deleteSnapshot('snap_c');
        assert.equal(JSON.parse(backupMap.get('capy_snapshots_v8')).length, 1);

        // Unrecognized settings/active-state objects ({"bad": 1}, {}) must quarantine & recover backup cleanly
        let backupOverwriteCount = 0;
        const origSaveBackup = globalThis.window.CapyAndroid.saveBackup;
        globalThis.window.CapyAndroid.saveBackup = (k, v) => {
          backupOverwriteCount++;
          return origSaveBackup(k, v);
        };
        try {
          backupMap.set(
            'capy_user_settings_v8',
            JSON.stringify({ difficulty: 'NORMAL', soundVolume: 0.25 })
          );
          lsMap.set('capy_user_settings_v8', '{"bad":1}');
          const recoveredSettings = storageMod.StorageService.loadSettings();
          assert.equal(recoveredSettings.difficulty, 'NORMAL');
          assert.equal(recoveredSettings.soundVolume, 0.25);
          assert.equal(
            lsMap.get('capy_user_settings_v8__corrupt_quarantine'),
            '{"bad":1}'
          );
          assert.equal(
            backupOverwriteCount,
            0,
            'loadSettings backup recovery must not overwrite NativeBridge backup'
          );

          backupMap.delete('capy_user_settings_v8');
          lsMap.set('capy_user_settings_v8', '{}');
          const defaultSettings = storageMod.StorageService.loadSettings();
          assert.equal(defaultSettings.difficulty, storageMod.DEFAULT_SETTINGS.difficulty);
          assert.equal(lsMap.get('capy_user_settings_v8__corrupt_quarantine'), '{}');
          assert.equal(backupOverwriteCount, 0);

          backupMap.set(
            'capy_active_session_v8',
            JSON.stringify({
              activeSnapshotId: null,
              activeColorId: 4,
              filledRegionIds: [12, 14],
              zoomScale: 1.5,
              panOffsetX: 10,
              panOffsetY: -5,
              updatedAt: 0,
            })
          );
          lsMap.set('capy_active_session_v8', '{"bad":1}');
          const recoveredActive = storageMod.StorageService.loadActiveState();
          assert.ok(recoveredActive);
          assert.equal(recoveredActive.activeColorId, 4);
          assert.deepEqual(recoveredActive.filledRegionIds, [12, 14]);
          assert.equal(lsMap.get('capy_active_session_v8__corrupt_quarantine'), '{"bad":1}');
          assert.equal(backupOverwriteCount, 0);

          backupMap.delete('capy_active_session_v8');
          lsMap.set('capy_active_session_v8', '{"bad":1}');
          assert.equal(storageMod.StorageService.loadActiveState(), null);
          assert.equal(lsMap.get('capy_active_session_v8__corrupt_quarantine'), '{"bad":1}');
        } finally {
          globalThis.window.CapyAndroid.saveBackup = origSaveBackup;
        }

        // MainActivity.kt onPageStarted must call bridge.setModalOpen(false) before updating isTrustedPageLoaded
        const mainActivitySrc = fs.readFileSync(
          path.join(REPO_ROOT, 'app/src/main/java/com/capyboop/paint/MainActivity.kt'),
          'utf8'
        );
        assert.match(
          mainActivitySrc,
          /override fun onPageStarted[\s\S]*?bridge\.setModalOpen\(false\)[\s\S]*?isTrustedPageLoaded\s*=\s*CapyAndroidBridge\.isTrustedPageUrl\(url\)/,
          'MainActivity.onPageStarted must reset bridge.setModalOpen(false) before updating isTrustedPageLoaded'
        );

        // deserializePuzzle rejects OOM region IDs, mismatched lengths & unaligned Int32Array
        assert.throws(
          () =>
            storageMod.deserializePuzzle({
              width: 1,
              height: 1,
              palette: [],
              regions: [{ id: 2_000_000_000, colorId: 1, pixelCount: 1, area: 1 }],
              regionMapB64: Buffer.from(new Int32Array([1]).buffer).toString('base64'),
              borderMapB64: Buffer.from(new Uint8Array([0])).toString('base64'),
            }),
          /region|bounds|exceeds/i
        );
        assert.throws(
          () =>
            storageMod.deserializePuzzle({
              width: 2,
              height: 2,
              palette: [],
              regions: [],
              regionMapB64: Buffer.from(new Uint8Array([1, 2, 3])).toString('base64'),
              borderMapB64: Buffer.from(new Uint8Array(4)).toString('base64'),
            }),
          /byte length|Int32Array/i
        );

        // Strict RLE validation in StorageService.deserializePuzzle & CapyCodec.decodeRegionMapRle
        const baseRlePuzzle = {
          width: 16,
          height: 16,
          palette: [{ id: 1, hex: '#ef4444', isLight: false, argb: 0xffef4444, r: 239, g: 68, b: 68 }],
          regions: [
            {
              id: 1,
              colorId: 1,
              centroidX: 8,
              centroidY: 8,
              area: 256,
              minX: 0,
              maxX: 15,
              minY: 0,
              maxY: 15,
              maxRadius: 8,
            },
          ],
        };
        for (const badRle of [
          'AQ==', // 1 byte truncated
          'AAAA', // 3 bytes truncated
          'AAAAAA==', // zero-length run
          'AQABAA==', // underfilled (1px of 256)
          '', // empty string
          Buffer.from([1, 0, 5, 1]).toString('base64'), // overflow (261px > 256)
          Buffer.from([1, 0, 0, 1, 1, 0, 1, 0]).toString('base64'), // trailing run beyond 256
          Buffer.from([1, 0, 0, 1, 0]).toString('base64'), // trailing odd byte
        ]) {
          assert.throws(
            () =>
              storageMod.deserializePuzzle({
                ...baseRlePuzzle,
                regionMapRleB64: badRle,
              }),
            /RLE|regionMap|byte length/i,
            `deserializePuzzle must reject invalid regionMapRleB64=${JSON.stringify(badRle)}`
          );
        }
        assert.throws(
          () => storageMod.deserializePuzzle({ ...baseRlePuzzle }),
          /Missing regionMap/i,
          'deserializePuzzle must throw when both regionMapRleB64 and regionMapB64 are missing'
        );
        assert.throws(
          () =>
            storageMod.deserializePuzzle({
              ...baseRlePuzzle,
              regionMapRleB64: Buffer.from([1, 0, 0, 1]).toString('base64'),
              borderMapB64: '',
            }),
          /borderMapB64/i,
          'deserializePuzzle must reject empty borderMapB64'
        );
        const validRlePuzzle = storageMod.deserializePuzzle({
          ...baseRlePuzzle,
          regionMapRleB64: Buffer.from([1, 0, 0, 1]).toString('base64'),
        });
        assert.equal(validRlePuzzle.regionMap.length, 256);
        assert.equal(validRlePuzzle.regionMap[0], 1);

        const codecModRle = await vite.ssrLoadModule('/src/services/CapyCodec.ts');
        for (const badStream of [
          new Uint8Array(0), // empty stream
          new Uint8Array([1, 0]), // zero-length run
          new Uint8Array([1, 1]), // underfilled (1px of 256)
          new Uint8Array([1, 0x80, 0x02, 1, 1]), // trailing run after 256px
          new Uint8Array([1, 0x80, 0x02, 0x05]), // trailing truncated varint after 256px
          new Uint8Array([1, 0x81, 0x02]), // runLen=257 > 256 overflow
        ]) {
          assert.throws(
            () => codecModRle.decodeRegionMapRle(badStream, 256),
            /RLE|varint|regionMap/i,
            `decodeRegionMapRle must reject malformed stream [${Array.from(badStream).join(',')}]`
          );
        }
        const okEncodedRle = codecModRle.encodeRegionMapRle(new Int32Array(256).fill(1));
        const okDecodedRle = codecModRle.decodeRegionMapRle(okEncodedRle, 256);
        assert.equal(okDecodedRle.length, 256);
        assert.equal(okDecodedRle[255], 1);
      } finally {
        globalThis.localStorage = prevLs;
        if (prevWin === undefined) delete globalThis.window;
        else globalThis.window = prevWin;
      }
    }
  }

  // 6e (Storage & Codec). Strict codec/storage schemas, __proto__, snapshotPaths, sw.js digest, SVG & ?room= gating
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
        // 3. CapyCodec decompressPuzzleRecord, decodeBinarySaveV2 & __proto__ sanitization
        assert.throws(
          () =>
            codecMod.decompressPuzzleRecord({
              __capyCompactV2: 2,
              width: 2,
              height: 2,
              palette: null,
              regionMeta: new Float32Array([1, 1, 1, 1, 1]),
              rleRegionMap: codecMod.encodeRegionMapRle(new Int32Array([1, 1, 1, 1])),
            }),
          /palette/i
        );
        assert.throws(
          () =>
            codecMod.decompressPuzzleRecord({
              __capyCompactV2: 2,
              width: 2,
              height: 2,
              palette: [{ id: 1, hex: '#ffffff', isLight: true, argb: 0xffffffff, r: 255, g: 255, b: 255 }],
              regionMeta: new Float32Array([1, 1, Number.NaN, 1, 1]),
              rleRegionMap: codecMod.encodeRegionMapRle(new Int32Array([1, 1, 1, 1])),
            }),
          /non-finite|metadata/i
        );

        // Craft CAPY\x02 binary payload with palette: null and __proto__ key
        const buildRawCapyV2 = (obj, extraChunks = []) => {
          const jsonBytes = new TextEncoder().encode(JSON.stringify(obj));
          let totalChunkLen = 0;
          for (const c of extraChunks) totalChunkLen += c.byteLength;
          const framed = new Uint8Array(4 + jsonBytes.byteLength + totalChunkLen);
          new DataView(framed.buffer).setUint32(0, jsonBytes.byteLength, true);
          framed.set(jsonBytes, 4);
          let off = 4 + jsonBytes.byteLength;
          for (const c of extraChunks) {
            framed.set(c, off);
            off += c.byteLength;
          }
          const out = new Uint8Array(6 + framed.byteLength);
          out.set([0x43, 0x41, 0x50, 0x59, 2, 0], 0);
          out.set(framed, 6);
          return out;
        };

        const badPaletteBin = buildRawCapyV2(
          {
            format: 'capy-single-save-v2',
            version: 2,
            exportDate: 1700000000000,
            snapshot: {
              id: 'bad_bin_1',
              title: 'Bad Bin',
              filledCount: 0,
              totalCount: 1,
              filledRegionIds: [],
            },
            compactPuzzle: {
              width: 2,
              height: 2,
              palette: null,
              regionMetaBytes: { __chunkIdx: 0, byteLength: 20 },
              rleRegionMap: { __chunkIdx: 1, byteLength: 2 },
            },
          },
          [
            new Uint8Array(new Float32Array([1, 1, 1, 1, 1]).buffer),
            codecMod.encodeRegionMapRle(new Int32Array([1, 1, 1, 1])),
          ]
        );
        const badImportBinRes = await storageMod.StorageService.importSnapshotData(badPaletteBin);
        assert.equal(badImportBinRes.importedCount, 0);
        assert.match(badImportBinRes.error || '', /palette/i);
        assert.equal(storageMod.StorageService.loadSnapshots().length, 0);

        const protoJson =
          '{"format":"capy-single-save-v2","version":2,"exportDate":1700000000000,' +
          '"snapshot":{"id":"p_1","title":"Proto","filledCount":0,"totalCount":1,"filledRegionIds":[],"__proto__":{"pollutedProp":99}},' +
          '"compactPuzzle":null}';
        const protoJsonBytes = new TextEncoder().encode(protoJson);
        const protoFramed = new Uint8Array(4 + protoJsonBytes.byteLength);
        new DataView(protoFramed.buffer).setUint32(0, protoJsonBytes.byteLength, true);
        protoFramed.set(protoJsonBytes, 4);
        const protoBin = new Uint8Array(6 + protoFramed.byteLength);
        protoBin.set([0x43, 0x41, 0x50, 0x59, 2, 0], 0);
        protoBin.set(protoFramed, 6);
        const decodedProto = await codecMod.decodeBinarySaveV2(protoBin);
        assert.equal('pollutedProp' in decodedProto.snapshot, false, '__proto__ key must be stripped');
        assert.equal(({}).pollutedProp, undefined, 'Object.prototype must not be polluted');

        // 4. ProgressDeltaV2 sourceRef validation + ShareLinkService & syncFullLibrary type safety
        const badDeltaB64 = await codecMod.encodeProgressDeltaToken({
          version: 2,
          sourceRef: { kind: 'sample', uri: 123 },
          filledRegionIds: [],
          updatedAt: 1700000000000,
        });
        await assert.rejects(
          () => codecMod.decodeProgressDeltaToken(badDeltaB64),
          /sourceRef uri/i
        );
        const jsUriDelta = await codecMod.encodeProgressDeltaToken({
          version: 2,
          sourceRef: { kind: 'url', uri: 'javascript:alert(1)' },
          filledRegionIds: [],
          updatedAt: 1700000000000,
        });
        await assert.rejects(
          () => codecMod.decodeProgressDeltaToken(jsUriDelta),
          /sourceRef URL/i
        );
        assert.equal(shareMod.resolveSampleFromSourceRef({ kind: 'sample', uri: 123 }), null);

        // F3: Reject unallowlisted sample/catalog/blob/url sourceRefs & sampleAssetPath in CapyCodec + StorageService imports
        for (const badSampleUri of [
          'https://evil.com/tracker.png',
          '/evil-beacon.png',
          'assets/../secret.webp',
          'assets/capybara.webp?evil=1',
          'assets/capybara.webp ',
        ]) {
          const badTok = await codecMod.encodeProgressDeltaToken({
            version: 2,
            sourceRef: { kind: 'sample', uri: badSampleUri },
            filledRegionIds: [],
            updatedAt: 1700000000000,
          });
          await assert.rejects(
            () => codecMod.decodeProgressDeltaToken(badTok),
            /sourceRef/i,
            `Unallowlisted sample sourceRef ${badSampleUri} must be rejected`
          );
          const badJsonImport = await storageMod.StorageService.importSnapshotData(
            JSON.stringify({
              format: 'capy-single-save',
              snapshot: {
                id: 'bad_sample_path_1',
                title: 'Bad Sample',
                filledCount: 0,
                totalCount: 1,
                filledRegionIds: [],
                sampleAssetPath: badSampleUri,
              },
            })
          );
          assert.equal(badJsonImport.importedCount, 0);
          assert.match(badJsonImport.error || '', /sampleAssetPath/i);
        }
        for (const badIdRef of [
          { kind: 'catalog', uri: '../escape' },
          { kind: 'catalog', uri: 'https://evil.com/x' },
          { kind: 'blob', uri: '../../etc/passwd' },
          { kind: 'blob', uri: 'a/b' },
          { kind: 'url', uri: 'https://user:pass@example.com/a.webp' },
        ]) {
          const badTok = await codecMod.encodeProgressDeltaToken({
            version: 2,
            sourceRef: badIdRef,
            filledRegionIds: [],
            updatedAt: 1700000000000,
          });
          await assert.rejects(() => codecMod.decodeProgressDeltaToken(badTok), /sourceRef/i);
        }
        assert.equal(codecMod.isAllowedSampleAssetPath('assets/capybara.webp'), true);
        assert.equal(codecMod.isAllowedSampleAssetPath('./assets/capy_forest.webp'), true);
        assert.equal(codecMod.isAllowedSampleAssetPath('/evil-beacon.png'), false);
        assert.equal(codecMod.isAllowedSampleAssetPath('https://evil.com/a.webp'), false);

        // Verify snapshot thumbnail resolution helpers reject unsafe URIs & resolve safe fallbacks
        const snapshotPathsMod = await vite.ssrLoadModule('/src/utils/snapshotPaths.ts');
        assert.equal(
          snapshotPathsMod.resolveSafeSampleAssetPath({ sampleAssetPath: './assets/capy_forest.webp' }),
          './assets/capy_forest.webp'
        );
        assert.equal(
          snapshotPathsMod.resolveSafeSampleAssetPath({
            sampleAssetPath: 'https://evil.example/beacon.png',
            sourceRef: { kind: 'sample', uri: './assets/capybara.webp' },
          }),
          './assets/capybara.webp'
        );
        assert.equal(
          snapshotPathsMod.resolveSafeSampleAssetPath(
            {
              sampleAssetPath: './assets/capy_forest.webp',
              sourceRef: { kind: 'catalog', uri: './assets/capybara.webp' },
            },
            true
          ),
          './assets/capybara.webp'
        );
        assert.equal(
          snapshotPathsMod.resolveSafeSampleAssetPath({
            sampleAssetPath: 'javascript:alert(1)',
            sourceRef: { kind: 'url', uri: './assets/capybara.webp' },
          }),
          undefined,
          'Unsafe sampleAssetPath and non-sample sourceRef kind must resolve to undefined'
        );
        assert.equal(
          snapshotPathsMod.resolveSafeSnapshotPreviewUrl({
            previewDataUrl: 'data:image/png;base64,AAAA',
          }),
          'data:image/png;base64,AAAA'
        );
        assert.equal(
          snapshotPathsMod.resolveSafeSnapshotPreviewUrl({
            previewDataUrl: 'data:image/svg+xml;base64,AAAA',
          }),
          undefined,
          'Unsafe SVG data URL preview must be rejected'
        );
        const primaryThumbRes = snapshotPathsMod.resolveSafeSnapshotThumbnail(
          {
            sampleAssetPath: './assets/capybara.webp',
            previewDataUrl: 'data:image/webp;base64,BBBB',
          },
          {}
        );
        assert.equal(primaryThumbRes.thumbSrc, './assets/capybara.webp');
        assert.equal(primaryThumbRes.fallbackThumb, undefined);

        const failedPrimaryThumbRes = snapshotPathsMod.resolveSafeSnapshotThumbnail(
          {
            sampleAssetPath: './assets/capybara.webp',
            previewDataUrl: 'data:image/webp;base64,BBBB',
          },
          { './assets/capybara.webp': true }
        );
        assert.equal(failedPrimaryThumbRes.fallbackThumb, 'data:image/webp;base64,BBBB');
        assert.equal(failedPrimaryThumbRes.thumbSrc, 'data:image/webp;base64,BBBB');

        const bothFailedThumbRes = snapshotPathsMod.resolveSafeSnapshotThumbnail(
          {
            sampleAssetPath: './assets/capybara.webp',
            previewDataUrl: 'data:image/webp;base64,BBBB',
          },
          { './assets/capybara.webp': true, 'data:image/webp;base64,BBBB': true }
        );
        assert.equal(bothFailedThumbRes.thumbSrc, undefined);

        // Verify sw.js preserves #573 SW_ASSETS_DIGEST & omits ignoreSearch: true
        const swSrc = fs.readFileSync(path.join(WEB_ROOT, 'public/sw.js'), 'utf8');
        assert.equal(swSrc.includes('SW_ASSETS_DIGEST'), true, 'sw.js must preserve SW_ASSETS_DIGEST');
        assert.equal(swSrc.includes('ignoreSearch'), false, 'sw.js must preserve query isolation (no ignoreSearch)');

        // 5. StorageService JSON importSnapshotData non-string snapshot.id/title & NaN puzzle rejection
        const badJsonSingle = await storageMod.StorageService.importSnapshotData(
          JSON.stringify({
            format: 'capy-single-save',
            snapshot: { id: 12345, title: { bad: true }, filledCount: 0, totalCount: 1, filledRegionIds: [] },
          })
        );
        assert.equal(badJsonSingle.importedCount, 0);
        assert.equal(storageMod.StorageService.loadSnapshots().length, 0);

        const badJsonArchive = await storageMod.StorageService.importSnapshotData(
          JSON.stringify({
            format: 'capy-archive-save',
            snapshots: [{ id: 'ok_1', title: 999 }],
          })
        );
        assert.equal(badJsonArchive.importedCount, 0);

        assert.throws(
          () =>
            storageMod.deserializePuzzle({
              width: 2,
              height: 2,
              palette: null,
              regions: [],
              regionMapRleB64: Buffer.from([1, 0, 4, 0]).toString('base64'),
            }),
          /palette/i
        );
        assert.throws(
          () =>
            storageMod.deserializePuzzle({
              width: 2,
              height: 2,
              palette: [{ id: 1, hex: '#ffffff', isLight: true, argb: 0xffffffff, r: 255, g: 255, b: 255 }],
              regions: [
                {
                  id: 1,
                  colorId: 1,
                  centroidX: 'bad',
                  centroidY: 1,
                  area: 4,
                  minX: 0,
                  maxX: 1,
                  minY: 0,
                  maxY: 1,
                  maxRadius: 1,
                },
              ],
              regionMapRleB64: Buffer.from([1, 0, 4, 0]).toString('base64'),
            }),
          /metadata/i
        );

        // 7b. SvgPrintExporter handles non-finite coordinates cleanly without emitting NaN/Infinity
        const svgOut = svgMod.buildPrintableColoringSvg({
          width: 16,
          height: 16,
          palette: [{ id: 1, hex: '#123456', isLight: false, argb: 0xff123456, r: 18, g: 52, b: 86 }],
          regionMap: new Int32Array(256).fill(1),
          borderMap: new Uint8Array(256),
          regions: [
            {
              id: 1,
              colorId: 1,
              centroidX: Number.NaN,
              centroidY: Number.POSITIVE_INFINITY,
              area: 256,
              minX: 0,
              maxX: 15,
              minY: 0,
              maxY: 15,
              maxRadius: 8,
              pixels: new Int32Array(0),
            },
          ],
        });
        assert.equal(/NaN|Infinity/.test(svgOut), false, 'SvgPrintExporter must never emit NaN or Infinity');

        // 7c. StorageNamespace ?room= requires canonical 4-8 alphanumeric code
        assert.equal(nsMod.isCloudCoopUiEnabled('?room=THIS_IS_INVALID_ROOM_99999', null), false);
        assert.equal(nsMod.isCloudCoopUiEnabled('?room=ab', null), false);
        assert.equal(nsMod.isCloudCoopUiEnabled('?room=ABC123', null), true);

        // 7d. SvgPrintExporter Wave-4 fixes: Infinity/non-numeric colorId, NaN/Infinity export dimensions, XML C0 stripping & nullish palette swatches
        const svgBadColorId = svgMod.buildPrintableColoringSvg(
          {
            width: 16,
            height: 16,
            palette: [{ id: 1, hex: '#123456', isLight: false, argb: 0xff123456, r: 18, g: 52, b: 86 }],
            regionMap: new Int32Array(256).fill(1),
            borderMap: new Uint8Array(256),
            regions: [
              {
                id: 1,
                colorId: Number.POSITIVE_INFINITY,
                centroidX: 8,
                centroidY: 8,
                area: 256,
                minX: 0,
                maxX: 15,
                minY: 0,
                maxY: 15,
                maxRadius: 8,
                pixels: new Int32Array(0),
              },
              {
                id: 2,
                colorId: '99</text><script>alert(1)</script>',
                centroidX: 4,
                centroidY: 4,
                area: 16,
                minX: 0,
                maxX: 3,
                minY: 0,
                maxY: 3,
                maxRadius: 2,
                pixels: new Int32Array(0),
              },
            ],
          },
          { title: 'Evil\u0007\u0000\u0008\u000B\u000C\u001F\uFFFE\uFFFFTitle&<>' }
        );
        assert.equal(/NaN|Infinity/.test(svgBadColorId), false, 'Unmapped non-finite/non-numeric colorId must never emit NaN or Infinity');
        assert.equal(svgBadColorId.includes('<script>'), false, 'Malformed string colorId must not inject markup');
        assert.equal(
          /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.test(svgBadColorId),
          false,
          'SvgPrintExporter must strip XML 1.0 illegal C0 control and non-character code points'
        );
        assert.equal(
          svgBadColorId.includes('EvilTitle&amp;&lt;&gt;'),
          true,
          'escapeSvgXml must strip illegal C0 chars while preserving XML entity escaping'
        );

        const svgNullPalette = svgMod.buildPrintableColoringSvg({
          width: 16,
          height: 16,
          palette: [null],
          regionMap: new Int32Array(256).fill(1),
          borderMap: new Uint8Array(256),
          regions: [],
        });
        assert.equal(svgNullPalette.includes('<svg'), true, 'Nullish palette entries must not crash buildPrintableColoringSvg');
        assert.equal(svgNullPalette.includes('data-swatch-number='), false);

        const svgMixedPalette = svgMod.buildPrintableColoringSvg({
          width: 16,
          height: 16,
          palette: [
            { id: 1, hex: '#123456', isLight: false, argb: 0xff123456, r: 18, g: 52, b: 86 },
            null,
            { id: 3, hex: '#654321', isLight: false, argb: 0xff654321, r: 101, g: 67, b: 33 },
          ],
          regionMap: new Int32Array(256).fill(1),
          borderMap: new Uint8Array(256),
          regions: [],
        });
        assert.equal(svgMixedPalette.includes('Color Key (2 Colors)'), true);

        let shareFileCalled = 0;
        const prevExportAnd = globalThis.window.CapyAndroid;
        globalThis.window.CapyAndroid = {
          shareFile: () => {
            shareFileCalled++;
          },
        };
        try {
          for (const [badW, badH] of [
            [Number.NaN, 16],
            [16, Number.POSITIVE_INFINITY],
            [0, 16],
            [16, -4],
          ]) {
            const exported = await svgMod.exportPrintableColoringSvg({
              width: badW,
              height: badH,
              palette: [],
              regionMap: new Int32Array(1),
              borderMap: new Uint8Array(1),
              regions: [],
            });
            assert.equal(exported, false, `exportPrintableColoringSvg must reject (${badW}, ${badH})`);
          }
          assert.equal(shareFileCalled, 0, 'Rejected SVG exports must not invoke NativeBridge share');
        } finally {
          globalThis.window.CapyAndroid = prevExportAnd;
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

  // 8. Stage 1 shared base64 utilities, non-PII reportSwallowed ring buffer & ErrorBoundary recovery
  {
    const base64Mod = await vite.ssrLoadModule('/src/utils/base64.ts');
    const codecMod8 = await vite.ssrLoadModule('/src/services/CapyCodec.ts');
    assert.equal(codecMod8.uint8ToBase64, base64Mod.uint8ToBase64, 'CapyCodec must re-export shared uint8ToBase64');
    assert.equal(codecMod8.base64ToUint8, base64Mod.base64ToUint8, 'CapyCodec must re-export shared base64ToUint8');
    assert.equal(base64Mod.uint8ToBase64(new Uint8Array(0)), '');
    assert.deepEqual(Array.from(base64Mod.base64ToUint8('')), []);

    const largeBytes = new Uint8Array(25_000);
    for (let i = 0; i < largeBytes.length; i++) {
      largeBytes[i] = (i * 31 + 7) & 0xff;
    }
    const largeEncoded = base64Mod.uint8ToBase64(largeBytes);
    const largeDecoded = base64Mod.base64ToUint8(largeEncoded);
    assert.equal(largeDecoded.byteLength, largeBytes.byteLength);
    assert.equal(largeDecoded[0], largeBytes[0]);
    assert.equal(largeDecoded[24_999], largeBytes[24_999]);
    assert.equal(Buffer.compare(Buffer.from(largeDecoded), Buffer.from(largeBytes)), 0);

    const telemetryMod = await vite.ssrLoadModule('/src/services/telemetry.ts');
    telemetryMod.clearSwallowedErrorLog();
    assert.equal(telemetryMod.getSwallowedErrorLog().length, 0);

    const origConsoleWarn = console.warn;
    const warnCalls = [];
    const prevWin8 = globalThis.window;
    const prevLs8 = globalThis.localStorage;
    try {
      console.warn = (...args) => warnCalls.push(args);
      const mockLs8 = new Map();
      globalThis.localStorage = {
        getItem: (k) => (mockLs8.has(k) ? mockLs8.get(k) : null),
        setItem: (k, v) => mockLs8.set(k, String(v)),
        removeItem: (k) => mockLs8.delete(k),
      };
      globalThis.window = {
        location: { search: '' },
        localStorage: globalThis.localStorage,
      };

      const debugEnvMod8 = await vite.ssrLoadModule('/src/utils/debugEnvironment.ts');
      assert.equal(
        debugEnvMod8.isDebugEnvironmentEnabled('?capy_debug=0', '1', false),
        false,
        'Non-dev ?capy_debug=0 override must suppress debug mode even when storage flag is set'
      );

      telemetryMod.reportSwallowed(
        'TestScope',
        new Error('Auth failed Bearer abc.def.ghi ya29.abc123.def456 #access_token=hash_tok&id_token=id_sec ?access_token=xyz&foo=1'),
        {
          count: 3,
          ok: true,
          nested: { bad: 1 },
          note: 'x'.repeat(200),
          authUrl: 'https://capypaint.com/#token=ctx_tok&Bearer ctx_bearer ya29.ctx.seg',
        }
      );
      const logAfterRedaction = telemetryMod.getSwallowedErrorLog();
      assert.equal(logAfterRedaction.length, 1);
      assert.equal(logAfterRedaction[0].scope, 'TestScope');
      assert.equal(logAfterRedaction[0].message.includes('abc.def.ghi'), false);
      assert.equal(logAfterRedaction[0].message.includes('ya29.abc123'), false);
      assert.equal(logAfterRedaction[0].message.includes('def456'), false);
      assert.equal(logAfterRedaction[0].message.includes('hash_tok'), false);
      assert.equal(logAfterRedaction[0].message.includes('id_sec'), false);
      assert.equal(logAfterRedaction[0].message.includes('xyz'), false);
      assert.equal(logAfterRedaction[0].message.includes('Bearer [redacted]'), true);
      assert.equal(logAfterRedaction[0].message.includes('[redacted-token]'), true);
      assert.equal(logAfterRedaction[0].context?.count, 3);
      assert.equal(logAfterRedaction[0].context?.ok, true);
      assert.equal('nested' in (logAfterRedaction[0].context || {}), false);
      assert.equal(String(logAfterRedaction[0].context?.note || '').length <= 160, true);
      const safeCtxUrl = String(logAfterRedaction[0].context?.authUrl || '');
      assert.equal(safeCtxUrl.includes('ctx_tok'), false);
      assert.equal(safeCtxUrl.includes('ctx_bearer'), false);
      assert.equal(safeCtxUrl.includes('ya29.ctx'), false);
      if (process.env.NODE_ENV === 'production') {
        assert.equal(warnCalls.length, 0, 'Production non-debug mode must suppress console.warn');
      }

      // Defensive cloning prevents caller mutations from altering ring buffer state
      logAfterRedaction[0].scope = 'mutated';
      if (logAfterRedaction[0].context) logAfterRedaction[0].context.count = 999;
      assert.equal(telemetryMod.getSwallowedErrorLog()[0].scope, 'TestScope');
      assert.equal(telemetryMod.getSwallowedErrorLog()[0].context?.count, 3);

      // Unserializable inputs, throwing getters, null-proto objects & Proxy traps must never rethrow, and debug query emits fresh console.warn
      warnCalls.length = 0;
      globalThis.window.location.search = '?capy_debug=1';
      telemetryMod.reportSwallowed('CircularScope', {
        toString() {
          throw new Error('cannot stringify');
        },
      });
      assert.equal(warnCalls.length, 1, 'Debug mode must emit console.warn for telemetry');

      const throwingErr = new Error('ignored');
      Object.defineProperty(throwingErr, 'message', {
        get() {
          throw new Error('getter failed');
        },
      });
      telemetryMod.reportSwallowed('GetterScope', throwingErr);
      telemetryMod.reportSwallowed('NullProtoScope', Object.create(null));
      telemetryMod.reportSwallowed('NullProtoMsgScope', { message: Object.create(null) });
      const throwingProxyCtx = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('proxy ownKeys failed');
          },
        }
      );
      telemetryMod.reportSwallowed('ProxyCtxScope', 'ok msg', throwingProxyCtx);
      const afterHostileCalls = telemetryMod.getSwallowedErrorLog();
      assert.equal(
        afterHostileCalls.slice(-4).map((r) => r.scope).join(','),
        'GetterScope,NullProtoScope,NullProtoMsgScope,ProxyCtxScope'
      );
      assert.equal(afterHostileCalls[afterHostileCalls.length - 1].message, 'ok msg');

      // Ring buffer eviction caps entries strictly at MAX_SWALLOWED_ERROR_RECORDS (50)
      telemetryMod.clearSwallowedErrorLog();
      for (let i = 0; i < telemetryMod.MAX_SWALLOWED_ERROR_RECORDS + 15; i++) {
        telemetryMod.reportSwallowed('Ring', `err-${i}`);
      }
      const bounded = telemetryMod.getSwallowedErrorLog();
      assert.equal(bounded.length, telemetryMod.MAX_SWALLOWED_ERROR_RECORDS);
      assert.equal(bounded[0].message, 'err-15');
      assert.equal(bounded[bounded.length - 1].message, `err-${telemetryMod.MAX_SWALLOWED_ERROR_RECORDS + 14}`);

      // ErrorBoundary state derivation, unserializable input safety, token redaction & binary -> JSON backup fallback
      const ebMod = await vite.ssrLoadModule('/src/components/ErrorBoundary.tsx');
      const storageMod8 = await vite.ssrLoadModule('/src/services/StorageService.ts');
      const nbMod8 = await vite.ssrLoadModule('/src/services/NativeBridge.ts');

      const derived = ebMod.ErrorBoundary.getDerivedStateFromError(new Error('Boom boundary'));
      assert.equal(derived.hasError, true);
      assert.equal(derived.error?.message, 'Boom boundary');
      assert.equal(derived.safeMessage, 'Boom boundary');

      const derivedNullProto = ebMod.ErrorBoundary.getDerivedStateFromError(Object.create(null));
      assert.equal(derivedNullProto.hasError, true);
      assert.equal(derivedNullProto.safeMessage, 'Unserializable error');

      const derivedSecret = ebMod.ErrorBoundary.getDerivedStateFromError(
        new Error('Crash Bearer secret_tok ya29.a.b #access_token=frag_sec')
      );
      assert.equal(derivedSecret.safeMessage.includes('secret_tok'), false);
      assert.equal(derivedSecret.safeMessage.includes('ya29.a'), false);
      assert.equal(derivedSecret.safeMessage.includes('frag_sec'), false);
      const ebRenderMal = new ebMod.ErrorBoundary({ children: null });
      ebRenderMal.state = {
        ...ebRenderMal.state,
        hasError: true,
        error: { message: 12345 },
        safeMessage: '',
      };
      assert.ok(ebRenderMal.render(), 'ErrorBoundary.render() must tolerate non-string error.message safely');

      telemetryMod.clearSwallowedErrorLog();
      const ebInstance = new ebMod.ErrorBoundary({ children: null });
      ebInstance.componentDidCatch(new Error('Render crash Bearer tok999'), {
        componentStack: '\n  at App\n  at Root',
      });
      const ebLog = telemetryMod.getSwallowedErrorLog();
      assert.equal(ebLog.length, 1);
      assert.equal(ebLog[0].scope, 'ErrorBoundary');
      assert.equal(ebLog[0].message.includes('tok999'), false);

      const origExportBinary = storageMod8.StorageService.exportAllSnapshotsBinary;
      const origExportJson = storageMod8.StorageService.exportAllSnapshots;
      const origExportFile = nbMod8.NativeBridge.exportOrShareFile;
      const exportedFiles = [];
      try {
        storageMod8.StorageService.exportAllSnapshotsBinary = async () => new Uint8Array([1, 2, 3, 4]);
        storageMod8.StorageService.exportAllSnapshots = async () => '{"version":2,"snapshots":[]}';
        nbMod8.NativeBridge.exportOrShareFile = async (opts) => {
          exportedFiles.push(opts);
        };

        assert.equal(await ebMod.exportEmergencySavesBackup(), 'binary');
        assert.equal(exportedFiles.length, 1);
        assert.equal(exportedFiles[0].fileName, 'capy_emergency_backup.capy');

        telemetryMod.clearSwallowedErrorLog();
        storageMod8.StorageService.exportAllSnapshotsBinary = async () => {
          throw new Error('binary packing failed');
        };
        assert.equal(await ebMod.exportEmergencySavesBackup(), 'json');
        assert.equal(exportedFiles.length, 2);
        assert.equal(exportedFiles[1].fileName, 'capy_emergency_backup.json');
        assert.equal(
          telemetryMod.getSwallowedErrorLog().some((r) => r.scope === 'ErrorBoundary.exportBackupBinary'),
          true
        );
      } finally {
        storageMod8.StorageService.exportAllSnapshotsBinary = origExportBinary;
        storageMod8.StorageService.exportAllSnapshots = origExportJson;
        nbMod8.NativeBridge.exportOrShareFile = origExportFile;
      }
    } finally {
      console.warn = origConsoleWarn;
      telemetryMod.clearSwallowedErrorLog();
      if (prevLs8 === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prevLs8;
      if (prevWin8 === undefined) delete globalThis.window;
      else globalThis.window = prevWin8;
    }
  }
}
