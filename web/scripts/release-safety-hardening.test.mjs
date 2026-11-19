#!/usr/bin/env node
/**
 * Release Safety & Hardening verification suite (M1).
 * Can run standalone (`node scripts/release-safety-hardening.test.mjs`) or be imported by `test.mjs`.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(WEB_ROOT, '..');

function extractInlineScriptHashes(htmlContent) {
  const hashes = [];
  const scriptRe = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRe.exec(htmlContent)) !== null) {
    const body = match[1];
    if (!body || body.trim().length === 0) continue;
    const digest = crypto.createHash('sha256').update(body, 'utf8').digest('base64');
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes;
}

function parseHeadersCsp(headersContent) {
  const lines = headersContent.replace(/\r\n/g, '\n').split('\n');
  let inRootBlock = false;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (inRootBlock) break;
      continue;
    }
    if (!rawLine.startsWith(' ') && !rawLine.startsWith('\t')) {
      inRootBlock = trimmed === '/*';
      continue;
    }
    if (inRootBlock && trimmed.toLowerCase().startsWith('content-security-policy:')) {
      return trimmed.slice('content-security-policy:'.length).trim();
    }
  }
  return null;
}

function parseCspDirectives(cspHeader) {
  const directives = new Map();
  for (const part of cspHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/);
    directives.set(tokens[0].toLowerCase(), tokens.slice(1));
  }
  return directives;
}

export async function runReleaseSafetyHardeningTests(vite) {
  // 1. Strict CSP verification on web/public/_headers against real inline scripts
  {
    const headersPath = path.join(WEB_ROOT, 'public/_headers');
    const headersText = fs.readFileSync(headersPath, 'utf8');
    const csp = parseHeadersCsp(headersText);
    assert.ok(csp, 'web/public/_headers /* block must define Content-Security-Policy');
    const directives = parseCspDirectives(csp);

    const scriptSrc = directives.get('script-src') || [];
    assert.equal(scriptSrc.includes("'self'"), true, "CSP script-src must include 'self'");
    assert.equal(
      scriptSrc.includes("'unsafe-inline'"),
      false,
      "CSP script-src must NOT contain 'unsafe-inline'"
    );
    assert.equal(
      scriptSrc.includes("'unsafe-eval'"),
      false,
      "CSP script-src must NOT contain 'unsafe-eval'"
    );
    assert.equal(
      scriptSrc.includes('https://accounts.google.com'),
      true,
      'CSP script-src must allow https://accounts.google.com for GIS'
    );

    const indexHashes = extractInlineScriptHashes(
      fs.readFileSync(path.join(WEB_ROOT, 'index.html'), 'utf8')
    );
    const notFoundHashes = extractInlineScriptHashes(
      fs.readFileSync(path.join(WEB_ROOT, 'public/404.html'), 'utf8')
    );
    assert.equal(indexHashes.length > 0, true, 'Expected inline boot script in web/index.html');
    assert.equal(notFoundHashes.length > 0, true, 'Expected inline script in web/public/404.html');
    for (const h of [...indexHashes, ...notFoundHashes]) {
      assert.equal(
        scriptSrc.includes(h),
        true,
        `CSP script-src missing SHA-256 hash ${h} for inline HTML script`
      );
    }

    assert.deepEqual(directives.get('object-src'), ["'none'"], "CSP object-src must be 'none'");
    assert.deepEqual(directives.get('base-uri'), ["'self'"], "CSP base-uri must be 'self'");
    assert.deepEqual(
      directives.get('frame-ancestors'),
      ["'self'"],
      "CSP frame-ancestors must be 'self'"
    );
    assert.equal(
      (directives.get('frame-src') || []).includes('https://accounts.google.com'),
      true,
      'CSP frame-src must allow https://accounts.google.com'
    );
    assert.equal(
      (directives.get('worker-src') || []).includes('blob:'),
      true,
      'CSP worker-src must allow blob:'
    );
    const connectSrc = directives.get('connect-src') || [];
    for (const required of [
      "'self'",
      'data:',
      'blob:',
      'https://www.googleapis.com',
      'https://accounts.google.com',
      'wss://capypaint.com',
      'wss://*.capypaint.com',
    ]) {
      assert.equal(connectSrc.includes(required), true, `CSP connect-src missing ${required}`);
    }
    const imgSrc = directives.get('img-src') || [];
    for (const required of ["'self'", 'data:', 'blob:', 'https://*.googleusercontent.com']) {
      assert.equal(imgSrc.includes(required), true, `CSP img-src missing ${required}`);
    }

    assert.match(
      headersText,
      /Strict-Transport-Security:\s*max-age=31536000;\s*includeSubDomains/i,
      'web/public/_headers must enforce Strict-Transport-Security'
    );
    assert.match(
      headersText,
      /(?:^|\n)\/\r?\n\s+Cache-Control:\s*no-cache/m,
      'web/public/_headers must set explicit / Cache-Control: no-cache'
    );
  }

  // 2. Debug gating parity, ad-free components & isCloudCoopUiEnabled gating
  {
    const debugEnvMod = await vite.ssrLoadModule('/src/utils/debugEnvironment.ts');
    const storageMod = await vite.ssrLoadModule('/src/services/StorageService.ts');
    const gClientMod = await vite.ssrLoadModule('/src/services/providers/GoogleCloudSyncClient.ts');
    const nsMod = await vite.ssrLoadModule('/src/services/StorageNamespace.ts');
    const nbMod2 = await vite.ssrLoadModule('/src/services/NativeBridge.ts');
    const regMod2 = await vite.ssrLoadModule('/src/services/providers/ProviderRegistry.ts');

    assert.equal(
      storageMod.isDebugStorageExposed,
      debugEnvMod.isDebugEnvironmentEnabled,
      'StorageService.isDebugStorageExposed must re-export shared isDebugEnvironmentEnabled'
    );
    assert.equal(
      gClientMod.isGoogleMockTokenEnvironmentAllowed,
      debugEnvMod.isDebugEnvironmentEnabled,
      'GoogleCloudSyncClient.isGoogleMockTokenEnvironmentAllowed must re-export shared isDebugEnvironmentEnabled'
    );
    assert.equal(
      storageMod.isDebugStorageExposed('', null, false),
      false,
      'Production default must NOT expose window.capyStorage'
    );
    assert.equal(
      storageMod.isDebugStorageExposed('?capy_debug=1', null, false),
      true,
      '?capy_debug=1 must enable debug storage exposure'
    );
    assert.equal(
      storageMod.isDebugStorageExposed('?capy_debug=true', null, false),
      true,
      '?capy_debug=true must enable debug storage exposure'
    );
    assert.equal(
      storageMod.isDebugStorageExposed('', '1', false),
      true,
      'capy_dev_debug=1 must enable debug storage exposure'
    );
    assert.equal(
      storageMod.isDebugStorageExposed('?capy_debug=0', '1', false),
      false,
      '?capy_debug=0 must override stored capy_dev_debug=1'
    );
    assert.equal(
      storageMod.isDebugStorageExposed('', null, true),
      true,
      'Vite dev mode must allow debug storage exposure'
    );

    const componentFiles = [];
    const walkComponents = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkComponents(full);
        } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
          componentFiles.push(full);
        }
      }
    };
    walkComponents(path.join(WEB_ROOT, 'src/components'));
    assert.equal(componentFiles.length > 0, true, 'Expected component files in src/components');
    for (const filePath of componentFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      assert.equal(
        /\b(?:AI Credits|Optional Ad|watchAd|ad_watch)\b/i.test(content),
        false,
        `${path.relative(WEB_ROOT, filePath)} must remain free of Play Store ad/credit monetization hooks`
      );
    }

    assert.equal(
      typeof nbMod2.NativeBridge.showRewardedAd,
      'undefined',
      'NativeBridge.showRewardedAd must remain absent for ad-free parity'
    );
    assert.equal(
      regMod2.ProviderRegistry.monetization.getLedger().adFreePlatform,
      true,
      'ProviderRegistry monetization ledger must enforce adFreePlatform === true'
    );

    assert.equal(nsMod.isCloudCoopUiEnabled('', null), false, 'Cloud Co-op UI must default off');
    assert.equal(nsMod.isCloudCoopUiEnabled('?coop=0', '1'), false, '?coop=0 must override stored flag');
    assert.equal(nsMod.isCloudCoopUiEnabled('?coop=1', null), true, '?coop=1 must enable Cloud Co-op UI');
    assert.equal(nsMod.isCloudCoopUiEnabled('?room=ABCD23', null), true, '?room= must enable Cloud Co-op UI');
    assert.equal(
      nsMod.isCloudCoopUiEnabled('?coop=0&room=ABCD23', null),
      false,
      'Explicit ?coop=0 must suppress Cloud Co-op UI even when room= is present'
    );
    assert.equal(nsMod.isCloudCoopUiEnabled('', '1'), true, 'capy_dev_cloud_coop_ui=1 must enable Cloud Co-op UI');
  }

  // 3. NativeBridge SSR safety, deep-link validation & shared image / share link guards
  {
    const prevWin = globalThis.window;
    try {
      delete globalThis.window;
      const nbMod = await vite.ssrLoadModule('/src/services/NativeBridge.ts');

      assert.equal(nbMod.isValidAndroidDeepLink('https://capypaint.com/#s=abc123'), true);
      assert.equal(nbMod.isValidAndroidDeepLink('https://www.capypaint.com/?room=ABCD12'), true);
      /* capy-dev-only:start */
      assert.equal(nbMod.isValidAndroidDeepLink('https://shthed.github.io/capy/#s=abc'), true);
      /* capy-dev-only:end */
      assert.equal(nbMod.isValidAndroidDeepLink('https://capyboop.github.io/capy/beta/#s=abc'), true);

      for (const badLink of [
        '',
        'http://capypaint.com/#s=abc',
        'javascript:alert(1)',
        'file:///etc/passwd',
        'https://evil.example/capy/#s=abc',
        'https://capypaint.com.evil.example/#s=abc',
        /* capy-dev-only:start */
        'https://shthed.github.io/other-repo/#s=abc',
        /* capy-dev-only:end */
        'https://capyboop.github.io/other-repo/#s=abc',
        'https://evil@capypaint.com/#s=abc',
        'https://capypaint.com:8443/#s=abc',
        'https://capypaint.com/\n#s=abc',
      ]) {
        assert.equal(
          nbMod.isValidAndroidDeepLink(badLink),
          false,
          `isValidAndroidDeepLink must reject ${JSON.stringify(badLink)}`
        );
      }

      assert.equal(nbMod.isAllowedSharedImageDataUrl('data:image/png;base64,AA=='), true);
      assert.equal(nbMod.isAllowedSharedImageDataUrl('data:image/jpeg;base64,/9j/4AAQ'), true);
      assert.equal(nbMod.isAllowedSharedImageDataUrl('data:image/webp;base64,UklGRg=='), true);
      assert.equal(nbMod.isAllowedSharedImageDataUrl('data:image/avif;base64,AAAA'), true);
      assert.equal(nbMod.isAllowedSharedImageDataUrl('data:image/svg+xml,<svg/>'), false);
      assert.equal(
        nbMod.isAllowedSharedImageDataUrl('data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz4='),
        false
      );
      assert.equal(nbMod.isAllowedSharedImageDataUrl('data:image/png;charset=utf-8,raw'), false);
      assert.equal(nbMod.isAllowedSharedImageDataUrl('javascript:alert(1)'), false);
      assert.equal(nbMod.isAllowedSharedImageDataUrl('https://evil.example/img.png'), false);

      assert.equal(nbMod.NativeBridge.saveBackup('k', 'v'), false);
      assert.equal(nbMod.NativeBridge.loadBackup('k'), null);

      const mockWin = {};
      globalThis.window = mockWin;
      // Verify NativeBridge drops invalid deep links when __capyReceiveDeepLink is invoked directly
      const svc = new nbMod.NativeBridgeService();
      const receivedLinks = [];
      svc.onDeepLink((url) => receivedLinks.push(url));
      mockWin.__capyReceiveDeepLink('javascript:alert(1)');
      mockWin.__capyReceiveDeepLink('https://evil.example/capy/');
      mockWin.__capyReceiveDeepLink('https://capypaint.com/#s=good123');
      assert.deepEqual(receivedLinks, ['https://capypaint.com/#s=good123']);

      // Multi-subscriber Play Games profile & error listeners coexist without clobbering
      const pgProfileLog1 = [];
      const pgProfileLog2 = [];
      const offPg1 = svc.onPlayGamesProfile((p) => pgProfileLog1.push(p.playerId));
      const offPg2 = svc.onPlayGamesProfile((p) => pgProfileLog2.push(p.playerId));
      mockWin.__capyReceivePlayGamesProfile(
        JSON.stringify({ playerId: 'pgs_first', displayName: 'First Capy' })
      );
      offPg2();
      mockWin.__capyReceivePlayGamesProfile(
        JSON.stringify({ playerId: 'pgs_second', displayName: 'Second Capy' })
      );
      assert.deepEqual(pgProfileLog1, ['pgs_first', 'pgs_second']);
      assert.deepEqual(pgProfileLog2, ['pgs_first']);
      offPg1();

      const pgErrLog1 = [];
      const pgErrLog2 = [];
      const offErr1 = svc.onPlayGamesError((r) => pgErrLog1.push(r));
      const offErr2 = svc.onPlayGamesError((r) => pgErrLog2.push(r));
      mockWin.__capyReceivePlayGamesError('ERR_ONE');
      offErr2();
      mockWin.__capyReceivePlayGamesError('ERR_TWO');
      assert.deepEqual(pgErrLog1, ['ERR_ONE', 'ERR_TWO']);
      assert.deepEqual(pgErrLog2, ['ERR_ONE']);
      offErr1();

      let fetchCalled = false;
      const prevFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        fetchCalled = true;
        throw new Error('Should not fetch unsafe shareImage URL');
      };
      try {
        await svc.shareImage('Bad', 'https://evil.example/ssrf.png');
        assert.equal(fetchCalled, false, 'shareImage must reject non-data:/blob: URLs before fetch');
      } finally {
        globalThis.fetch = prevFetch;
      }
    } finally {
      if (prevWin === undefined) delete globalThis.window;
      else globalThis.window = prevWin;
    }
  }

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
        const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
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

  // 6. WP4 Worker Runtime Integration, 4-8 Room Code Parity, SW Isolation, StorageService P0s & ProviderRegistry Sync
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
          path.join(REPO_ROOT, 'app/src/main/java/com/capypaint/capy/MainActivity.kt'),
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

    // Round 3 Hardening: Drive dot-segments, multi-chunk & OOO Play Games blobs, strict codec/storage schemas, __proto__, SVG & ?room= gating
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

          const appSrc = fs.readFileSync(path.join(WEB_ROOT, 'src/App.tsx'), 'utf8');
          assert.match(
            appSrc,
            /libSummary\.hasPendingLocalChanges[\s\S]*?latestSavedEpoch > pushedSlotEpoch[\s\S]*?controller\.requestTrailingPass\(\)/,
            'App.tsx must re-queue cloud sync via controller.requestTrailingPass() when resetEpoch advances mid-sync'
          );
        }

        // 7l. C8-2 regression: App.tsx must compute canonical slotKey via computeSlotKeyForSnapshot so ./assets/ vs assets/ prefixes never fork cloud slots
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
          const appSrc7l = fs.readFileSync(path.join(WEB_ROOT, 'src/App.tsx'), 'utf8');
          assert.match(
            appSrc7l,
            /import\s*\{[^}]*\bcomputeSlotKeyForSnapshot\b[^}]*\}\s*from\s*'\.\/services\/providers\/ProviderRegistry'/,
            'App.tsx must import computeSlotKeyForSnapshot from ProviderRegistry'
          );
          assert.match(
            appSrc7l,
            /const slotKey = computeSlotKeyForSnapshot\(/,
            'App.tsx executeSingleSyncPass must compute active slotKey via computeSlotKeyForSnapshot'
          );
          assert.equal(
            appSrc7l.includes('sample_${startSampleUri.replace'),
            false,
            'App.tsx must not diverge with inline sample_ slotKey string formatting'
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: WEB_ROOT,
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom',
    logLevel: 'silent',
  });
  try {
    await runReleaseSafetyHardeningTests(vite);
    console.log('[release-safety-hardening] OK: all M1 security & hardening tests passed.');
  } finally {
    await vite.close();
  }
}
