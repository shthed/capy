/**
 * Release Safety & Hardening — CSP, Debug/Ad-Free Gating & NativeBridge Guards.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '../../..');
const REPO_ROOT = path.resolve(WEB_ROOT, '..');

function extractInlineScriptHashes(htmlContent) {
  const hashes = [];
  const scriptRe = /<script\b(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRe.exec(htmlContent)) !== null) {
    const attrs = match[1] || '';
    if (/\btype\s*=\s*(?:["']application\/ld\+json["']|application\/ld\+json(?:\s|$))/i.test(attrs)) {
      continue;
    }
    const body = match[2];
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

export async function runHardeningCspSecurityTests(vite) {
  // 1. Strict CSP verification on web/public/_headers, standalone HTML meta CSPs, Vite build meta CSP, and XSS guards
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
      scriptSrc.includes('https://accounts.google.com/gsi/client'),
      true,
      'CSP script-src must narrow GIS script allowance to https://accounts.google.com/gsi/client'
    );
    assert.equal(
      scriptSrc.includes('https://accounts.google.com'),
      false,
      'CSP script-src must NOT allow the broad https://accounts.google.com origin'
    );
    assert.deepEqual(
      directives.get('script-src-attr'),
      ["'none'"],
      "CSP script-src-attr must be 'none' to block inline event handlers"
    );
    assert.equal(
      directives.has('upgrade-insecure-requests'),
      true,
      'HTTP _headers CSP must include upgrade-insecure-requests'
    );

    const indexHtml = fs.readFileSync(path.join(WEB_ROOT, 'index.html'), 'utf8');
    const notFoundHtml = fs.readFileSync(path.join(WEB_ROOT, 'public/404.html'), 'utf8');
    const privacyHtml = fs.readFileSync(path.join(WEB_ROOT, 'public/privacy-policy.html'), 'utf8');
    const prIndexHtml = fs.readFileSync(
      path.join(REPO_ROOT, '.github/scripts/pr-index.html'),
      'utf8'
    );

    const indexHashes = extractInlineScriptHashes(indexHtml);
    const notFoundHashes = extractInlineScriptHashes(notFoundHtml);
    const prIndexHashes = extractInlineScriptHashes(prIndexHtml);
    assert.equal(indexHashes.length > 0, true, 'Expected inline boot script in web/index.html');
    assert.equal(notFoundHashes.length > 0, true, 'Expected inline script in web/public/404.html');
    assert.equal(
      extractInlineScriptHashes(privacyHtml).length,
      0,
      'web/public/privacy-policy.html must contain zero inline scripts'
    );
    assert.equal(prIndexHashes.length > 0, true, 'Expected inline script in .github/scripts/pr-index.html');
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
      'https://capypaint.com',
      'https://paint.capyboop.com',
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
      /\/privacy-policy\r?\n\s+!\s*Content-Security-Policy\r?\n\s+Content-Security-Policy:[^\n]*script-src 'none'/m,
      'web/public/_headers must lock down /privacy-policy with script-src none'
    );
    assert.match(
      headersText,
      /\/privacy-policy\.html\r?\n\s+!\s*Content-Security-Policy\r?\n\s+Content-Security-Policy:[^\n]*script-src 'none'/m,
      'web/public/_headers must lock down /privacy-policy.html with script-src none'
    );

    const extractMetaCsp = (html) => {
      const m = /<meta\b[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*content=(["'])([\s\S]*?)\1/i.exec(
        html
      );
      return m ? m[2] : null;
    };

    const notFoundMetaCsp = extractMetaCsp(notFoundHtml);
    assert.ok(notFoundMetaCsp, 'web/public/404.html must define a meta Content-Security-Policy');
    for (const h of notFoundHashes) {
      assert.equal(
        notFoundMetaCsp.includes(h),
        true,
        `404.html meta CSP missing SHA-256 hash ${h}`
      );
    }

    const privacyMetaCsp = extractMetaCsp(privacyHtml);
    assert.ok(privacyMetaCsp, 'web/public/privacy-policy.html must define a meta Content-Security-Policy');
    assert.equal(
      privacyMetaCsp.includes("script-src 'none'"),
      true,
      "privacy-policy.html meta CSP must set script-src 'none'"
    );

    const prIndexMetaCsp = extractMetaCsp(prIndexHtml);
    assert.ok(prIndexMetaCsp, '.github/scripts/pr-index.html must define a meta Content-Security-Policy');
    for (const h of prIndexHashes) {
      assert.equal(
        prIndexMetaCsp.includes(h),
        true,
        `pr-index.html meta CSP missing SHA-256 hash ${h}`
      );
    }
    assert.equal(
      prIndexHtml.includes('/^\\/capy\\/alpha\\/\\d+\\/$/'),
      true,
      'pr-index.html must strictly validate PR preview href paths against /^\\/capy\\/alpha\\/\\d+\\/$/'
    );

    // Verify Vite build-time meta CSP generator matches web/index.html hashes and excludes meta-invalid directives
    const viteConfigMod = await vite.ssrLoadModule('/vite.config.ts');
    const builtMetaCsp = viteConfigMod.buildMetaCspPolicy(indexHtml);
    const builtDirectives = parseCspDirectives(builtMetaCsp);
    assert.equal(builtDirectives.has('frame-ancestors'), false, 'meta CSP must omit frame-ancestors');
    assert.equal(
      builtDirectives.has('upgrade-insecure-requests'),
      false,
      'meta CSP must omit upgrade-insecure-requests so local http://localhost preview/E2E works'
    );
    assert.deepEqual(builtDirectives.get('script-src-attr'), ["'none'"]);
    for (const h of indexHashes) {
      assert.equal(
        (builtDirectives.get('script-src') || []).includes(h),
        true,
        `buildMetaCspPolicy missing web/index.html inline script hash ${h}`
      );
    }

    // Verify Worker API_SECURITY_HEADERS includes strict CSP and www redirect sets HSTS + nosniff
    const workerSrc = fs.readFileSync(path.join(REPO_ROOT, 'worker/index.ts'), 'utf8');
    assert.equal(
      workerSrc.includes(`['Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'"]`),
      true,
      'worker/index.ts API_SECURITY_HEADERS must enforce Content-Security-Policy default-src none'
    );

    // Verify FeedbackService GitHub URL pinning, Google avatar host pinning, and OAuth authorize URL guard
    const feedbackMod = await vite.ssrLoadModule('/src/services/FeedbackService.ts');
    assert.equal(
      feedbackMod.sanitizeGitHubIssueUrl('https://github.com/capyboop/paint/issues/42'),
      'https://github.com/capyboop/paint/issues/42'
    );
    assert.equal(
      feedbackMod.sanitizeGitHubIssueUrl('https://github.com/capyboop/paint/issues/new?title=test'),
      'https://github.com/capyboop/paint/issues/new?title=test'
    );
    assert.equal(feedbackMod.sanitizeGitHubIssueUrl('https://evil.example/capyboop/paint/issues/1'), undefined);
    assert.equal(feedbackMod.sanitizeGitHubIssueUrl('https://github.com/login'), undefined);
    assert.equal(feedbackMod.sanitizeGitHubIssueUrl('javascript:alert(1)'), undefined);
    assert.equal(feedbackMod.sanitizeGitHubIssueUrl('https://user:pass@github.com/capyboop/paint/issues/1'), undefined);

    const gClientCspMod = await vite.ssrLoadModule('/src/services/providers/GoogleCloudSyncClient.ts');
    assert.equal(
      gClientCspMod.sanitizeGoogleAvatarUrl('https://lh3.googleusercontent.com/a/avatar123'),
      'https://lh3.googleusercontent.com/a/avatar123'
    );
    assert.equal(gClientCspMod.sanitizeGoogleAvatarUrl('https://evil.example/pixel.png'), undefined);
    assert.equal(gClientCspMod.sanitizeGoogleAvatarUrl('https://googleusercontent.com.evil.example/a'), undefined);
    assert.equal(gClientCspMod.sanitizeGoogleAvatarUrl('https://lh3.googleusercontent.com:8443/a'), undefined);
    assert.equal(gClientCspMod.sanitizeGoogleAvatarUrl('javascript:alert(1)'), undefined);

    const pkceCspMod = await vite.ssrLoadModule('/src/services/providers/OAuthPkceHelper.ts');
    assert.equal(
      pkceCspMod.isSafeOAuthAuthorizeUrl('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize'),
      true
    );
    assert.equal(pkceCspMod.isSafeOAuthAuthorizeUrl('javascript:alert(1)'), false);
    assert.equal(pkceCspMod.isSafeOAuthAuthorizeUrl('http://login.microsoftonline.com/authorize'), false);
    assert.equal(pkceCspMod.isSafeOAuthAuthorizeUrl('https://user:pass@login.microsoftonline.com/authorize'), false);

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
    assert.match(
      headersText,
      /(?:^|\n)\/robots\.txt\r?\n\s+Content-Type:\s*text\/plain;\s*charset=utf-8/m,
      'web/public/_headers must serve /robots.txt as text/plain; charset=utf-8'
    );
    assert.match(
      headersText,
      /(?:^|\n)\/sitemap\.xml\r?\n\s+Content-Type:\s*application\/xml;\s*charset=utf-8/m,
      'web/public/_headers must serve /sitemap.xml as application/xml; charset=utf-8'
    );

    // Verify SEO crawlability, canonical tags, Open Graph/Twitter cards, JSON-LD structured data, and preview noindex guards
    const robotsTxt = fs.readFileSync(path.join(WEB_ROOT, 'public/robots.txt'), 'utf8');
    assert.match(robotsTxt, /^User-agent:\s*\*/m, 'robots.txt must declare User-agent: *');
    assert.match(robotsTxt, /^Allow:\s*\/$/m, 'robots.txt must allow root crawling');
    assert.match(robotsTxt, /^Disallow:\s*\/api\/$/m, 'robots.txt must disallow /api/');
    assert.match(
      robotsTxt,
      /^Sitemap:\s*https:\/\/capypaint\.com\/sitemap\.xml$/m,
      'robots.txt must reference canonical sitemap.xml URL'
    );

    const sitemapXml = fs.readFileSync(path.join(WEB_ROOT, 'public/sitemap.xml'), 'utf8');
    assert.equal(
      sitemapXml.includes('<loc>https://capypaint.com/</loc>'),
      true,
      'sitemap.xml must include canonical https://capypaint.com/'
    );
    assert.equal(
      sitemapXml.includes('<loc>https://capypaint.com/privacy-policy</loc>'),
      true,
      'sitemap.xml must include canonical extensionless https://capypaint.com/privacy-policy'
    );
    assert.equal(
      /github\.io|\/alpha\/|\/beta\//i.test(sitemapXml),
      false,
      'sitemap.xml must not list preview or GitHub Pages URLs'
    );

    assert.equal(
      fs.existsSync(path.join(WEB_ROOT, 'public/assets/og-image.jpg')),
      true,
      'web/public/assets/og-image.jpg must exist for Open Graph / Twitter previews'
    );
    assert.match(
      indexHtml,
      /<link\s+rel="canonical"\s+href="https:\/\/capypaint\.com\/"\s*\/>/i,
      'web/index.html must define canonical URL https://capypaint.com/'
    );
    assert.match(
      indexHtml,
      /<meta\s+name="robots"\s+content="index,\s*follow,\s*max-image-preview:large"\s*\/>/i,
      'web/index.html must enable max-image-preview:large indexing'
    );
    assert.match(
      indexHtml,
      /<meta\s+property="og:image"\s+content="https:\/\/capypaint\.com\/assets\/og-image\.jpg"\s*\/>/i,
      'web/index.html must define og:image pointing to https://capypaint.com/assets/og-image.jpg'
    );
    assert.match(
      indexHtml,
      /<meta\s+name="twitter:card"\s+content="summary_large_image"\s*\/>/i,
      'web/index.html must define twitter:card summary_large_image'
    );
    assert.match(indexHtml, /<noscript>[\s\S]*<h1\b/i, 'web/index.html must include semantic <noscript> heading');

    const ldJsonMatch = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/i.exec(indexHtml);
    assert.ok(ldJsonMatch, 'web/index.html must embed JSON-LD structured data');
    const ldJson = JSON.parse(ldJsonMatch[1]);
    assert.equal(ldJson['@context'], 'https://schema.org', 'JSON-LD must use https://schema.org context');
    assert.equal(Array.isArray(ldJson['@graph']), true, 'JSON-LD must define @graph');
    const graphTypes = ldJson['@graph'].flatMap((node) =>
      Array.isArray(node['@type']) ? node['@type'] : [node['@type']]
    );
    for (const requiredType of ['Organization', 'WebSite', 'VideoGame', 'WebApplication']) {
      assert.equal(
        graphTypes.includes(requiredType),
        true,
        `JSON-LD @graph must include ${requiredType}`
      );
    }

    assert.match(
      privacyHtml,
      /<link\s+rel="canonical"\s+href="https:\/\/capypaint\.com\/privacy-policy"\s*\/>/i,
      'privacy-policy.html must declare extensionless canonical URL https://capypaint.com/privacy-policy'
    );
    assert.match(
      notFoundHtml,
      /<meta\s+name="robots"\s+content="noindex,\s*follow"\s*\/>/i,
      '404.html must set robots noindex, follow'
    );
    assert.match(
      prIndexHtml,
      /<meta\s+name="robots"\s+content="noindex,\s*nofollow"\s*\/>/i,
      'pr-index.html must set robots noindex, nofollow'
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
      assert.equal(nbMod.isValidAndroidDeepLink('https://paint.capyboop.com/#s=abc123'), true);
      assert.equal(nbMod.isValidAndroidDeepLink('https://paint.capyboop.com/?room=ABCD12'), true);
      assert.equal(nbMod.isValidAndroidDeepLink('https://www.capypaint.com/?room=ABCD12'), true);
      /* capy-dev-only:start */
      assert.equal(nbMod.isValidAndroidDeepLink('https://shthed.github.io/capy/#s=abc'), true);
      /* capy-dev-only:end */
      assert.equal(nbMod.isValidAndroidDeepLink('https://capyboop.github.io/capy/beta/#s=abc'), true);
      assert.equal(nbMod.isValidAndroidDeepLink('https://capyboop.github.io/paint/#s=abc'), true);

      for (const badLink of [
        '',
        'http://capypaint.com/#s=abc',
        'http://paint.capyboop.com/#s=abc',
        'javascript:alert(1)',
        'file:///etc/passwd',
        'https://evil.example/capy/#s=abc',
        'https://capypaint.com.evil.example/#s=abc',
        'https://paint.capyboop.com.evil.example/#s=abc',
        'https://evil@paint.capyboop.com/#s=abc',
        /* capy-dev-only:start */
        'https://shthed.github.io/other-repo/#s=abc',
        'https://shthed.github.io/paint/#s=abc',
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

}
