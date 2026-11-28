/**
 * [Unit 12] Android TV Leanback AndroidManifest.xml, CapyAndroidBridge.kt, MainActivity.kt & 320x180 tv_banner.png.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function parseXmlAttributes(attrStr) {
  const attrs = {};
  const attrRe = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = attrRe.exec(attrStr)) !== null) {
    attrs[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return attrs;
}

function parseXmlTree(xmlSource) {
  const cleaned = xmlSource.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const tagRe = /<(\/?)([a-zA-Z0-9_:-]+)([^>]*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(cleaned)) !== null) {
    const isClose = m[1] === '/';
    const tag = m[2];
    const attrStr = m[3];
    const isSelfClose = m[4] === '/';
    if (isClose) {
      if (stack.length <= 1 || stack[stack.length - 1].tag !== tag) {
        throw new SyntaxError(`Mismatched closing XML tag </${tag}>`);
      }
      stack.pop();
    } else {
      const node = { tag, attrs: parseXmlAttributes(attrStr), children: [] };
      stack[stack.length - 1].children.push(node);
      if (!isSelfClose) {
        stack.push(node);
      }
    }
  }
  if (stack.length !== 1) {
    throw new SyntaxError(`Unclosed XML tag <${stack[stack.length - 1].tag}>`);
  }
  return root.children[0];
}

export async function runAndroidManifestTests({ projectRoot, logUnitStart, logUnitPass }) {
    logUnitStart('Testing Android TV Leanback AndroidManifest.xml & 320x180 tv_banner.png...');
    const androidManifestPath = path.resolve(projectRoot, '../app/src/main/AndroidManifest.xml');
    const manifestRoot = parseXmlTree(fs.readFileSync(androidManifestPath, 'utf8'));
    assert.equal(manifestRoot?.tag, 'manifest', 'AndroidManifest.xml root element must be <manifest>');
    const features = {};
    for (const el of manifestRoot.children.filter((c) => c.tag === 'uses-feature')) {
      if (el.attrs['android:name']) {
        features[el.attrs['android:name']] = el.attrs['android:required'] ?? null;
      }
    }
    const appEl = manifestRoot.children.find((c) => c.tag === 'application');
    assert.ok(appEl, 'AndroidManifest.xml must contain <application>');
    const mainAct = appEl.children.find(
      (c) => c.tag === 'activity' && c.attrs['android:name'] === 'com.capyboop.paint.MainActivity'
    );
    assert.ok(mainAct, 'AndroidManifest.xml must declare com.capyboop.paint.MainActivity');
    const filters = mainAct.children
      .filter((c) => c.tag === 'intent-filter')
      .map((flt) => ({
        autoVerify: flt.attrs['android:autoVerify'] ?? null,
        actions: flt.children.filter((c) => c.tag === 'action').map((e) => e.attrs['android:name'] ?? null),
        categories: flt.children.filter((c) => c.tag === 'category').map((e) => e.attrs['android:name'] ?? null),
        data: flt.children
          .filter((c) => c.tag === 'data')
          .map((d) => ({
            scheme: d.attrs['android:scheme'] ?? null,
            host: d.attrs['android:host'] ?? null,
            mimeType: d.attrs['android:mimeType'] ?? null,
            pathPrefix: d.attrs['android:pathPrefix'] ?? null,
          })),
      }));
    const tvManifestInfo = {
      features,
      banner: appEl.attrs['android:banner'] ?? null,
      usesCleartextTraffic: appEl.attrs['android:usesCleartextTraffic'] ?? null,
      exported: mainAct.attrs['android:exported'] ?? null,
      launchMode: mainAct.attrs['android:launchMode'] ?? null,
      configChanges: mainAct.attrs['android:configChanges'] ?? null,
      filters,
    };
    assert.equal(tvManifestInfo.features['android.hardware.touchscreen'], 'false');
    assert.equal(tvManifestInfo.features['android.software.leanback'], 'false');
    assert.equal(tvManifestInfo.banner, '@drawable/tv_banner');
    assert.equal(tvManifestInfo.usesCleartextTraffic, 'false');
    assert.equal(tvManifestInfo.exported, 'true');
    assert.equal(tvManifestInfo.launchMode, 'singleTask');
    for (const cfgFlag of ['uiMode', 'navigation', 'keyboard', 'keyboardHidden', 'screenSize']) {
      assert.equal(
        String(tvManifestInfo.configChanges || '').split('|').includes(cfgFlag),
        true,
        `AndroidManifest configChanges must include ${cfgFlag}`
      );
    }
    const mainIntentFilter = tvManifestInfo.filters.find((f) =>
      f.actions.includes('android.intent.action.MAIN')
    );
    assert.ok(mainIntentFilter, 'MainActivity must declare MAIN intent-filter');
    assert.equal(mainIntentFilter.categories.includes('android.intent.category.LAUNCHER'), true);
    assert.equal(
      mainIntentFilter.categories.includes('android.intent.category.LEANBACK_LAUNCHER'),
      true
    );
    const sendIntentFilter = tvManifestInfo.filters.find((f) =>
      f.actions.includes('android.intent.action.SEND')
    );
    assert.ok(sendIntentFilter, 'MainActivity must preserve ACTION_SEND intent-filter');
    assert.equal(
      sendIntentFilter.data.some((d) => d.mimeType === 'image/*'),
      true
    );
    const viewIntentFilters = tvManifestInfo.filters.filter((f) =>
      f.actions.includes('android.intent.action.VIEW')
    );
    const autoVerifyFilter = viewIntentFilters.find(
      (f) => f.autoVerify === '${appLinksAutoVerify}'
    );
    assert.ok(autoVerifyFilter, 'MainActivity must preserve dedicated autoVerify App Links intent-filter');
    assert.equal(
      autoVerifyFilter.data.some((d) => d.scheme === 'https' && d.host === 'capypaint.com'),
      true
    );
    assert.equal(
      autoVerifyFilter.data.some((d) => d.scheme === 'https' && d.host === 'paint.capyboop.com'),
      true
    );
    assert.equal(
      autoVerifyFilter.data.some((d) => d.host === 'www.capypaint.com'),
      false,
      'autoVerify filter must exclude redirecting www.capypaint.com'
    );
    assert.equal(
      autoVerifyFilter.data.some((d) => String(d.host || '').endsWith('.github.io')),
      false,
      'autoVerify filter must exclude GitHub Pages host'
    );
    const fallbackViewData = viewIntentFilters
      .filter((f) => !f.autoVerify)
      .flatMap((f) => f.data);
    assert.equal(
      fallbackViewData.some((d) => d.scheme === 'https' && d.host === 'www.capypaint.com'),
      true
    );
    assert.equal(
      fallbackViewData.some(
        (d) => d.scheme === 'https' && String(d.host || '').endsWith('.github.io') && d.pathPrefix === '/capy'
      ),
      true
    );
    const androidStringsXml = fs.readFileSync(
      path.resolve(projectRoot, '../app/src/main/res/values/strings.xml'),
      'utf8'
    );
    assert.equal(
      androidStringsXml.includes('game_services_project_id'),
      false,
      'strings.xml must not statically declare game_services_project_id alongside Gradle resValue'
    );
    const androidBuildGradle = fs.readFileSync(
      path.resolve(projectRoot, '../app/build.gradle.kts'),
      'utf8'
    );
    assert.equal(
      androidBuildGradle.includes('resValue("string", "game_services_project_id"'),
      true,
      'app/build.gradle.kts must emit resValue for game_services_project_id'
    );
    assert.equal(
      /resValues\s*=\s*true/.test(androidBuildGradle),
      true,
      'app/build.gradle.kts must enable resValues = true for AGP 9+'
    );

    const capyBridgeKt = fs.readFileSync(
      path.resolve(projectRoot, '../app/src/main/java/com/capyboop/paint/CapyAndroidBridge.kt'),
      'utf8'
    );
    const rootHostsMatch = capyBridgeKt.match(/val\s+ROOT_DEEP_LINK_HOSTS\s*=\s*setOf\(([^)]+)\)/);
    assert.ok(rootHostsMatch, 'CapyAndroidBridge.kt must define ROOT_DEEP_LINK_HOSTS');
    assert.equal(
      rootHostsMatch[1].includes('"paint.capyboop.com"'),
      true,
      'CapyAndroidBridge.kt ROOT_DEEP_LINK_HOSTS must include "paint.capyboop.com"'
    );
    assert.equal(
      capyBridgeKt.includes('"/privacy-policy.html"'),
      true,
      'CapyAndroidBridge.kt isAllowedCapyDeepLink must exclude static /privacy-policy.html'
    );

    const mainActivityKt = fs.readFileSync(
      path.resolve(projectRoot, '../app/src/main/java/com/capyboop/paint/MainActivity.kt'),
      'utf8'
    );
    assert.equal(
      mainActivityKt.includes('openExternalBrowserUrl(') &&
        mainActivityKt.includes('queryIntentActivities(') &&
        mainActivityKt.includes('it != packageName') &&
        mainActivityKt.includes('setPackage(externalBrowserPkg)'),
      true,
      'MainActivity.kt must resolve an external browser package excluding packageName for OPEN_EXTERNAL URLs'
    );
    const rawManifestXml = fs.readFileSync(androidManifestPath, 'utf8');
    assert.equal(
      rawManifestXml.includes('<queries>') && rawManifestXml.includes('android.intent.category.BROWSABLE'),
      true,
      'AndroidManifest.xml must declare <queries> for HTTPS BROWSABLE external browser resolution'
    );

    const parseTvBannerPng = (buf) => {
      const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      if (!Buffer.isBuffer(buf) || buf.length < 26) return null;
      if (!buf.subarray(0, 8).equals(pngMagic)) return null;
      if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
      return {
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
        bitDepth: buf[24],
        colorType: buf[25],
      };
    };

    const tvBannerPath = path.resolve(projectRoot, '../app/src/main/res/drawable-xhdpi/tv_banner.png');
    assert.equal(fs.existsSync(tvBannerPath), true, 'drawable-xhdpi/tv_banner.png must exist');
    const tvBannerBuf = fs.readFileSync(tvBannerPath);
    assert.equal(tvBannerBuf.length > 100 && tvBannerBuf.length <= 1024 * 1024, true);
    const tvBannerHeader = parseTvBannerPng(tvBannerBuf);
    assert.ok(tvBannerHeader, 'tv_banner.png must have valid PNG magic and IHDR chunk');
    assert.equal(tvBannerHeader.width, 320);
    assert.equal(tvBannerHeader.height, 180);
    assert.equal(tvBannerHeader.bitDepth, 8);
    assert.equal(tvBannerHeader.colorType === 6 || tvBannerHeader.colorType === 2, true);

    assert.equal(parseTvBannerPng(Buffer.alloc(16)), null);
    const badBannerBuf = Buffer.from(tvBannerBuf);
    badBannerBuf.writeUInt32BE(512, 16);
    badBannerBuf.writeUInt32BE(512, 20);
    const badBannerHeader = parseTvBannerPng(badBannerBuf);
    assert.equal(badBannerHeader.width === 320 && badBannerHeader.height === 180, false);

    // Google Play adaptive quality standards (Android 17 targetSdk=37, foldable manifest continuity & 3 foldable screenshots)
    assert.equal(
      mainAct.attrs['android:screenOrientation'] ?? null,
      null,
      'MainActivity must not declare android:screenOrientation lock for foldables/large screens'
    );
    assert.notEqual(
      mainAct.attrs['android:resizeableActivity'] ?? null,
      'false',
      'MainActivity must remain resizeable for foldables and multi-window mode'
    );
    assert.equal(mainAct.attrs['android:minAspectRatio'] ?? null, null);
    assert.equal(mainAct.attrs['android:maxAspectRatio'] ?? null, null);
    for (const foldCfgFlag of ['density', 'smallestScreenSize', 'screenLayout', 'orientation']) {
      assert.equal(
        String(tvManifestInfo.configChanges || '').split('|').includes(foldCfgFlag),
        true,
        `AndroidManifest configChanges must include ${foldCfgFlag} for foldable state continuity`
      );
    }
    const compileSdkMatch = androidBuildGradle.match(/compileSdk\s*=\s*(\d+)/);
    const targetSdkMatch = androidBuildGradle.match(/targetSdk\s*=\s*(\d+)/);
    assert.ok(compileSdkMatch && Number(compileSdkMatch[1]) >= 37, 'app/build.gradle.kts compileSdk must be >= 37');
    assert.ok(targetSdkMatch && Number(targetSdkMatch[1]) >= 37, 'app/build.gradle.kts targetSdk must be >= 37');
    assert.equal(
      /isMinifyEnabled\s*=\s*true/.test(androidBuildGradle) &&
        /isShrinkResources\s*=\s*true/.test(androidBuildGradle),
      true,
      'app/build.gradle.kts release build must keep R8 minification and resource shrinking enabled'
    );

    const foldableShots = [
      { file: 'foldable_1_1_inner.png', ratioW: 1, ratioH: 1 },
      { file: 'foldable_4_3_inner.png', ratioW: 4, ratioH: 3 },
      { file: 'foldable_10_16_outer.png', ratioW: 10, ratioH: 16 },
    ];
    for (const { file, ratioW, ratioH } of foldableShots) {
      const shotPath = path.resolve(projectRoot, '../docs/play-store/screenshots', file);
      assert.equal(fs.existsSync(shotPath), true, `Missing required Play Store foldable screenshot: ${file}`);
      const shotBuf = fs.readFileSync(shotPath);
      const shotHeader = parseTvBannerPng(shotBuf);
      assert.ok(shotHeader, `${file} must have valid PNG magic and IHDR chunk`);
      assert.equal(
        shotHeader.width >= 1080 && shotHeader.height >= 1080,
        true,
        `${file} must be >= 1080px per side (got ${shotHeader.width}x${shotHeader.height})`
      );
      assert.equal(
        shotHeader.width * ratioH,
        shotHeader.height * ratioW,
        `${file} must have exact ${ratioW}:${ratioH} aspect ratio (got ${shotHeader.width}x${shotHeader.height})`
      );
    }

    logUnitPass('Android TV Leanback, Android 17 adaptive manifest & Play Store foldable screenshots verified.');
}
