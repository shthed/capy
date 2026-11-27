/**
 * Unit tests for OpenRouter (1-click OAuth PKCE + Unified Images API),
 * Direct OpenAI (ChatGPT GPT Image Edits API), Direct xAI (Grok Imagine Edits API),
 * Multi-App Free Guided Handoff (Gemini / ChatGPT / Grok), strictly device-local
 * multi-provider BYOK key isolation, and UI/codec parity.
 */
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const VALID_1X1_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2dIAAAAASUVORK5CYII=';
const VALID_1X1_PNG_DATA_URL = `data:image/png;base64,${VALID_1X1_PNG_BASE64}`;
const VALID_1X1_PNG_BYTES = Uint8Array.from(Buffer.from(VALID_1X1_PNG_BASE64, 'base64'));
const SVG_PAYLOAD_BASE64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64');

function makeJsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function createMemoryStorage() {
  const map = new Map();
  return {
    map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    key(index) {
      return Array.from(map.keys())[index] ?? null;
    },
    get length() {
      return map.size;
    },
  };
}

export async function runMultiProviderAiUnitTests(vite) {
  const [
    openRouterAuthMod,
    multiMod,
    nanoMod,
    keysMod,
    settingsMod,
    controlsMod,
    modalMod,
    codecMod,
    serializerMod,
    bridgeMod,
  ] = await Promise.all([
    vite.ssrLoadModule('/src/services/ai/openRouterAuth.ts'),
    vite.ssrLoadModule('/src/services/ai/MultiProviderAiService.ts'),
    vite.ssrLoadModule('/src/services/ai/NanoBananaService.ts'),
    vite.ssrLoadModule('/src/services/storage/StorageKeys.ts'),
    vite.ssrLoadModule('/src/services/storage/SettingsStorage.ts'),
    vite.ssrLoadModule('/src/components/InfiniteZoomControls.tsx'),
    vite.ssrLoadModule('/src/components/GuidedGeminiHandoffModal.tsx'),
    vite.ssrLoadModule('/src/services/CapyCodec.ts'),
    vite.ssrLoadModule('/src/services/storage/PuzzleSerializer.ts'),
    vite.ssrLoadModule('/src/services/NativeBridge.ts'),
  ]);

  // 1. OpenRouter OAuth PKCE URL building, validation, code exchange, and end-to-end connect
  {
    assert.equal(openRouterAuthMod.isAllowedOpenRouterCallbackUrl('https://capypaint.com/'), true);
    assert.equal(openRouterAuthMod.isAllowedOpenRouterCallbackUrl('http://localhost:5173/'), true);
    assert.equal(openRouterAuthMod.isAllowedOpenRouterCallbackUrl('capypaint://oauth/callback'), true);
    assert.equal(openRouterAuthMod.isAllowedOpenRouterCallbackUrl('http://evil.example.com/'), false);
    assert.equal(openRouterAuthMod.isAllowedOpenRouterCallbackUrl('javascript:alert(1)'), false);

    const authUrl = openRouterAuthMod.buildOpenRouterOAuthUrl({
      callbackUrl: 'https://capypaint.com/',
      codeChallenge: 'challenge_abc_123',
      state: 'csrf_state_xyz',
      limitUsd: 10,
    });
    const parsed = new URL(authUrl);
    assert.equal(parsed.origin, 'https://openrouter.ai');
    assert.equal(parsed.pathname, '/auth');
    assert.equal(parsed.searchParams.get('callback_url'), 'https://capypaint.com/');
    assert.equal(parsed.searchParams.get('code_challenge'), 'challenge_abc_123');
    assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(parsed.searchParams.get('state'), 'csrf_state_xyz');
    assert.equal(parsed.searchParams.get('limit'), '10.00');

    let capturedExchange = null;
    const exchangeRes = await openRouterAuthMod.exchangeOpenRouterAuthCode({
      code: 'or_auth_code_777',
      codeVerifier: 'verifier_secret_value_012345678901234567890123',
      fetchImpl: async (url, init) => {
        capturedExchange = { url, init, body: JSON.parse(init.body) };
        return makeJsonResponse(200, { key: '  sk-or-v1-minted-key  ' });
      },
    });
    assert.equal(exchangeRes.key, 'sk-or-v1-minted-key');
    assert.equal(capturedExchange.url, 'https://openrouter.ai/api/v1/auth/keys');
    assert.equal(capturedExchange.body.code, 'or_auth_code_777');
    assert.equal(capturedExchange.body.code_challenge_method, 'S256');
    assert.equal(capturedExchange.init.headers['HTTP-Referer'], 'https://capypaint.com');
    assert.equal(capturedExchange.init.headers['X-Title'], 'Capy Paint');

    let savedKey = '';
    let seenAuthUrl = '';
    let seenAndroidFlag = false;
    const connectRes = await openRouterAuthMod.connectOpenRouterWithPkce({
      isAndroid: true,
      awaitCallback: async (opts) => {
        seenAuthUrl = opts.authorizeUrl;
        seenAndroidFlag = Boolean(opts.useAndroidExternalBrowser);
        return { code: 'android_pkce_code', state: opts.expectedState };
      },
      fetchImpl: async () => makeJsonResponse(200, { key: 'sk-or-v1-android-key' }),
      saveApiKey: (k) => {
        savedKey = k;
        return true;
      },
    });
    assert.deepEqual(connectRes, { connected: true });
    assert.equal(seenAndroidFlag, true);
    assert.equal(new URL(seenAuthUrl).searchParams.get('callback_url'), 'capypaint://oauth/callback');
    assert.equal(savedKey, 'sk-or-v1-android-key');
  }

  // 2. OpenRouter Unified Images API provider contract + error handling + SVG rejection
  {
    let capturedReq = null;
    const provider = new multiMod.OpenRouterImageProvider({
      getApiKey: () => 'sk-or-v1-test',
      fetchImpl: async (url, init) => {
        capturedReq = { url, init, body: JSON.parse(init.body) };
        return makeJsonResponse(200, { data: [{ b64_json: VALID_1X1_PNG_BASE64 }] });
      },
    });
    const res = await provider.generate({
      prompt: 'Seamless wildflowers',
      templateDataUrl: VALID_1X1_PNG_DATA_URL,
      width: 1024,
      height: 768,
      model: 'openai/gpt-image-2.6-sunburst',
      resolution: '2K',
    });
    assert.equal(res.providerUsed, 'OPENROUTER');
    assert.equal(res.modelUsed, 'openai/gpt-image-2.6-sunburst');
    assert.equal(res.mimeType, 'image/png');
    assert.equal(capturedReq.url, 'https://openrouter.ai/api/v1/images');
    assert.equal(capturedReq.init.headers.Authorization, 'Bearer sk-or-v1-test');
    assert.equal(capturedReq.init.headers['HTTP-Referer'], 'https://capypaint.com');
    assert.equal(capturedReq.body.model, 'openai/gpt-image-2.6-sunburst');
    assert.equal(capturedReq.body.response_format, 'b64_json');
    assert.equal(capturedReq.body.resolution, '2K');
    assert.equal(capturedReq.body.aspect_ratio, '4:3');
    assert.equal(capturedReq.body.input_references[0].type, 'image_url');
    assert.equal(capturedReq.body.input_references[0].image_url.url, VALID_1X1_PNG_DATA_URL);

    // 402 credits exhausted -> BALANCE_EXHAUSTED with canFallbackToGuided=true
    const emptyCreditsProvider = new multiMod.OpenRouterImageProvider({
      getApiKey: () => 'sk-or-v1-empty',
      fetchImpl: async () => makeJsonResponse(402, { error: { message: 'openrouter_credits exhausted' } }),
    });
    await assert.rejects(
      () =>
        emptyCreditsProvider.generate({
          prompt: 'test',
          templateDataUrl: VALID_1X1_PNG_DATA_URL,
          width: 512,
          height: 512,
        }),
      (err) => err.code === 'BALANCE_EXHAUSTED' && err.canFallbackToGuided === true
    );

    // SVG masquerading as b64_json must be rejected
    const svgProvider = new multiMod.OpenRouterImageProvider({
      getApiKey: () => 'sk-or-v1-svg',
      fetchImpl: async () => makeJsonResponse(200, { data: [{ b64_json: SVG_PAYLOAD_BASE64 }] }),
    });
    await assert.rejects(
      () =>
        svgProvider.generate({
          prompt: 'test',
          templateDataUrl: VALID_1X1_PNG_DATA_URL,
          width: 512,
          height: 512,
        }),
      (err) => err.code === 'INVALID_IMAGE'
    );
  }

  // 3. Direct OpenAI (ChatGPT GPT Image Edits) provider contract + size/quality mapping + error classification
  {
    assert.equal(multiMod.resolveNearestOpenAiEditSize(1024, 1024), '1024x1024');
    assert.equal(multiMod.resolveNearestOpenAiEditSize(1536, 1024), '1536x1024');
    assert.equal(multiMod.resolveNearestOpenAiEditSize(768, 1280), '1024x1536');
    assert.equal(multiMod.resolveOpenAiEditQuality('512'), 'medium');
    assert.equal(multiMod.resolveOpenAiEditQuality('1K'), 'auto');
    assert.equal(multiMod.resolveOpenAiEditQuality('2K'), 'high');

    let capturedReq = null;
    const openAiProvider = new multiMod.DirectOpenAiImageProvider({
      getApiKey: () => 'sk-proj-test-key',
      fetchImpl: async (url, init) => {
        capturedReq = { url, init, body: JSON.parse(init.body) };
        return makeJsonResponse(200, { data: [{ b64_json: VALID_1X1_PNG_BASE64 }] });
      },
    });
    const res = await openAiProvider.generate({
      prompt: 'Seamless mossy pebbles',
      templateDataUrl: VALID_1X1_PNG_DATA_URL,
      width: 1500,
      height: 1000,
      model: 'gpt-image-2.6-sunburst',
      resolution: '2K',
    });
    assert.equal(res.providerUsed, 'OPENAI_BYOK');
    assert.equal(res.modelUsed, 'gpt-image-2.6-sunburst');
    assert.equal(res.mimeType, 'image/png');
    assert.equal(capturedReq.url, 'https://api.openai.com/v1/images/edits');
    assert.equal(capturedReq.init.headers.Authorization, 'Bearer sk-proj-test-key');
    assert.equal(capturedReq.body.model, 'gpt-image-2.6-sunburst');
    assert.equal(capturedReq.body.size, '1536x1024');
    assert.equal(capturedReq.body.quality, 'high');
    assert.deepEqual(capturedReq.body.images, [{ image_url: VALID_1X1_PNG_DATA_URL }]);

    const safetyProvider = new multiMod.DirectOpenAiImageProvider({
      getApiKey: () => 'sk-proj-test-key',
      fetchImpl: async () =>
        makeJsonResponse(400, { error: { code: 'moderation_blocked', message: 'safety policy' } }),
    });
    await assert.rejects(
      () =>
        safetyProvider.generate({
          prompt: 'blocked',
          templateDataUrl: VALID_1X1_PNG_DATA_URL,
          width: 512,
          height: 512,
        }),
      (err) => err.code === 'SAFETY_BLOCKED' && err.canFallbackToGuided === false
    );
  }

  // 4. Direct xAI (Grok Imagine Edits) provider contract + aspect ratio mapping + error classification
  {
    assert.equal(multiMod.resolveNearestXaiAspectRatio(1600, 900), '16:9');
    assert.equal(multiMod.resolveNearestXaiAspectRatio(1000, 1000), '1:1');
    assert.equal(multiMod.resolveNearestXaiAspectRatio(900, 1600), '9:16');

    let capturedReq = null;
    const xaiProvider = new multiMod.DirectXaiGrokImageProvider({
      getApiKey: () => 'xai-test-key',
      fetchImpl: async (url, init) => {
        capturedReq = { url, init, body: JSON.parse(init.body) };
        return makeJsonResponse(200, { data: [{ b64_json: VALID_1X1_PNG_BASE64 }] });
      },
    });
    const res = await xaiProvider.generate({
      prompt: 'Starry hills extension',
      templateDataUrl: VALID_1X1_PNG_DATA_URL,
      width: 1600,
      height: 900,
      model: 'grok-imagine-image-2.0',
    });
    assert.equal(res.providerUsed, 'XAI_BYOK');
    assert.equal(res.modelUsed, 'grok-imagine-image-2.0');
    assert.equal(res.mimeType, 'image/png');
    assert.equal(capturedReq.url, 'https://api.x.ai/v1/images/edits');
    assert.equal(capturedReq.init.headers.Authorization, 'Bearer xai-test-key');
    assert.equal(capturedReq.body.model, 'grok-imagine-image-2.0');
    assert.equal(capturedReq.body.response_format, 'b64_json');
    assert.equal(capturedReq.body.aspect_ratio, '16:9');
    assert.deepEqual(capturedReq.body.image, {
      url: VALID_1X1_PNG_DATA_URL,
      type: 'image_url',
    });

    const authErrProvider = new multiMod.DirectXaiGrokImageProvider({
      getApiKey: () => 'xai-bad',
      fetchImpl: async () => makeJsonResponse(401, { error: 'invalid_api_key' }),
    });
    await assert.rejects(
      () =>
        authErrProvider.generate({
          prompt: 'test',
          templateDataUrl: VALID_1X1_PNG_DATA_URL,
          width: 512,
          height: 512,
        }),
      (err) => err.code === 'INVALID_API_KEY' && err.canFallbackToGuided === true
    );
  }

  // 5. Strictly device-local BYOK storage isolation across all 4 providers (never in UserSettings or BackupEngine)
  {
    assert.equal(keysMod.OPENROUTER_BYOK_KEY_STORAGE_KEY, 'capy_openrouter_byok_key_v1');
    assert.equal(keysMod.OPENAI_BYOK_KEY_STORAGE_KEY, 'capy_openai_byok_key_v1');
    assert.equal(keysMod.XAI_BYOK_KEY_STORAGE_KEY, 'capy_xai_byok_key_v1');
    assert.equal(keysMod.STORAGE_KEYS.OPENROUTER_BYOK_KEY, 'capy_openrouter_byok_key_v1');
    assert.equal(keysMod.STORAGE_KEYS.OPENAI_BYOK_KEY, 'capy_openai_byok_key_v1');
    assert.equal(keysMod.STORAGE_KEYS.XAI_BYOK_KEY, 'capy_xai_byok_key_v1');

    const prevLocalStorage = globalThis.localStorage;
    const prevWindow = globalThis.window;
    const mem = createMemoryStorage();
    globalThis.localStorage = mem;
    globalThis.window = { localStorage: mem };
    try {
      settingsMod.saveOpenRouterByokApiKey('sk-or-secret-1');
      settingsMod.saveOpenAiByokApiKey('sk-openai-secret-2');
      settingsMod.saveXaiByokApiKey('xai-secret-3');

      assert.equal(settingsMod.loadOpenRouterByokApiKey(), 'sk-or-secret-1');
      assert.equal(settingsMod.loadOpenAiByokApiKey(), 'sk-openai-secret-2');
      assert.equal(settingsMod.loadXaiByokApiKey(), 'xai-secret-3');
      assert.equal(settingsMod.hasOpenRouterByokApiKey(), true);
      assert.equal(settingsMod.hasOpenAiByokApiKey(), true);
      assert.equal(settingsMod.hasXaiByokApiKey(), true);

      // Persist settings with new provider/models & assert ZERO secret keys leak into UserSettings JSON
      const loaded = settingsMod.loadSettings();
      settingsMod.saveSettings({
        ...loaded,
        infiniteZoomProvider: 'OPENROUTER',
        openRouterModel: 'x-ai/grok-imagine-image-2.0',
        openAiImageModel: 'gpt-image-2.6-flare',
        xaiImageModel: 'grok-imagine-image',
        guidedAiApp: 'CHATGPT',
      });
      const reloaded = settingsMod.loadSettings();
      assert.equal(reloaded.infiniteZoomProvider, 'OPENROUTER');
      assert.equal(reloaded.openRouterModel, 'x-ai/grok-imagine-image-2.0');
      assert.equal(reloaded.openAiImageModel, 'gpt-image-2.6-flare');
      assert.equal(reloaded.xaiImageModel, 'grok-imagine-image');
      assert.equal(reloaded.guidedAiApp, 'CHATGPT');

      const serializedSettings = mem.getItem(keysMod.SETTINGS_KEY) || '';
      assert.equal(serializedSettings.includes('sk-or-secret-1'), false);
      assert.equal(serializedSettings.includes('sk-openai-secret-2'), false);
      assert.equal(serializedSettings.includes('xai-secret-3'), false);

      settingsMod.clearOpenRouterByokApiKey();
      settingsMod.clearOpenAiByokApiKey();
      settingsMod.clearXaiByokApiKey();
      assert.equal(settingsMod.hasOpenRouterByokApiKey(), false);
      assert.equal(settingsMod.hasOpenAiByokApiKey(), false);
      assert.equal(settingsMod.hasXaiByokApiKey(), false);
    } finally {
      globalThis.localStorage = prevLocalStorage;
      globalThis.window = prevWindow;
    }
  }

  // 6. NativeBridge.openExternalOAuth allows openrouter.ai and rejects http/evil hosts
  {
    const prevWindow = globalThis.window;
    let forwardedUrl = null;
    globalThis.window = {
      CapyAndroid: {
        openExternalOAuth(url) {
          forwardedUrl = url;
          return true;
        },
      },
    };
    try {
      const ok = bridgeMod.NativeBridge.openExternalOAuth(
        'https://openrouter.ai/auth?callback_url=capypaint%3A%2F%2Foauth%2Fcallback&code_challenge=abc&code_challenge_method=S256&state=xyz'
      );
      assert.equal(ok, true);
      assert.ok(forwardedUrl && forwardedUrl.startsWith('https://openrouter.ai/auth?'));
      assert.equal(bridgeMod.NativeBridge.openExternalOAuth('http://openrouter.ai/auth'), false);
      assert.equal(bridgeMod.NativeBridge.openExternalOAuth('https://openrouter.ai.evil.com/auth'), false);
    } finally {
      globalThis.window = prevWindow;
    }
  }

  // 7. Multi-App Free Guided Handoff (Gemini / ChatGPT / Grok) + SSR markup verification
  {
    const blob = new Blob([VALID_1X1_PNG_BYTES], { type: 'image/png' });
    const handoffChatGpt = nanoMod.prepareGuidedGeminiHandoff({
      templatePngBlob: blob,
      templateDataUrl: VALID_1X1_PNG_DATA_URL,
      prompt: 'Seamless botanical veins',
      direction: 'child-in',
      targetApp: 'CHATGPT',
    });
    assert.equal(handoffChatGpt.targetApp, 'CHATGPT');
    assert.equal(handoffChatGpt.appUrl, 'https://chatgpt.com/');
    assert.equal(handoffChatGpt.geminiUrl, 'https://gemini.google.com/');

    const modalHtml = renderToStaticMarkup(
      React.createElement(modalMod.GuidedGeminiHandoffModal, {
        isOpen: true,
        handoff: handoffChatGpt,
        guidedAiApp: 'GROK',
        onImageReceived: () => {},
        onCancel: () => {},
      })
    );
    assert.equal(modalHtml.includes('data-testid="guided-app-chip-gemini"'), true);
    assert.equal(modalHtml.includes('data-testid="guided-app-chip-chatgpt"'), true);
    assert.equal(modalHtml.includes('data-testid="guided-app-chip-grok"'), true);
    assert.equal(modalHtml.includes('Copy Prompt &amp; Open Grok'), true);

    const openRouterCardHtml = renderToStaticMarkup(
      React.createElement(controlsMod.InfiniteZoomCreateCard, {
        sourceImage: null,
        infiniteZoomProvider: 'OPENROUTER',
        nanoBananaModel: 'gemini-nano-banana-2.1',
        nanoBananaResolution: '1K',
        openRouterModel: 'openai/gpt-image-2.6-sunburst',
        onChangeProvider: () => {},
        onChangeModel: () => {},
        onChangeResolution: () => {},
        onClose: () => {},
      })
    );
    assert.equal(openRouterCardHtml.includes('data-testid="iz-openrouter-oauth-btn"'), true);
    assert.equal(openRouterCardHtml.includes('data-testid="iz-byok-key-input"'), true);
    assert.equal(openRouterCardHtml.includes('openai/gpt-image-2.6-sunburst'), true);
    assert.equal(openRouterCardHtml.includes('x-ai/grok-imagine-image-2.0'), true);
  }

  // 8. CapyCodec v2 & PuzzleSerializer round-trip with OPENROUTER, OPENAI_BYOK, XAI_BYOK nested layers
  {
    const sampleRegion = {
      id: 2,
      colorId: 1,
      centroidX: 1,
      centroidY: 1,
      area: 4,
      minX: 0,
      maxX: 1,
      minY: 0,
      maxY: 1,
      maxRadius: 1,
      pixels: new Int32Array([0, 1, 2, 3]),
    };
    const puzzle = {
      width: 2,
      height: 2,
      palette: [{ id: 1, hex: '#ff0000', isLight: false, argb: 0xffff0000, r: 255, g: 0, b: 0 }],
      regions: [{ ...sampleRegion, id: 1 }],
      regionMap: new Int32Array([1, 1, 1, 1]),
      borderMap: new Uint8Array([1, 1, 1, 1]),
      maxZoomDepth: 1,
      nestedLayers: [
        {
          layerId: 'layer_or_1',
          depth: 1,
          worldBounds: { x: 0, y: 0, width: 0.5, height: 0.5 },
          width: 2,
          height: 2,
          regions: [sampleRegion],
          regionMap: new Int32Array([2, 2, 2, 2]),
          borderMap: new Uint8Array([1, 1, 1, 1]),
          imageBlobKey: 'layer_snap1_layer_or_1',
          providerUsed: 'OPENROUTER',
          modelUsed: 'openai/gpt-image-2.6-sunburst',
        },
        {
          layerId: 'layer_xai_2',
          depth: 1,
          worldBounds: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
          width: 2,
          height: 2,
          regions: [{ ...sampleRegion, id: 3 }],
          regionMap: new Int32Array([3, 3, 3, 3]),
          borderMap: new Uint8Array([1, 1, 1, 1]),
          imageBlobKey: 'layer_snap1_layer_xai_2',
          providerUsed: 'XAI_BYOK',
          modelUsed: 'grok-imagine-image-2.0',
        },
      ],
    };

    const serialized = serializerMod.serializePuzzle(puzzle);
    const deserialized = serializerMod.deserializePuzzle(serialized);
    assert.equal(deserialized.nestedLayers?.[0]?.providerUsed, 'OPENROUTER');
    assert.equal(deserialized.nestedLayers?.[0]?.modelUsed, 'openai/gpt-image-2.6-sunburst');
    assert.equal(deserialized.nestedLayers?.[1]?.providerUsed, 'XAI_BYOK');
    assert.equal(deserialized.nestedLayers?.[1]?.modelUsed, 'grok-imagine-image-2.0');

    const compact = codecMod.compressPuzzleRecord(puzzle);
    const restored = codecMod.decompressPuzzleRecord(compact);
    assert.equal(restored.nestedLayers?.[0]?.providerUsed, 'OPENROUTER');
    assert.equal(restored.nestedLayers?.[0]?.modelUsed, 'openai/gpt-image-2.6-sunburst');
    assert.equal(restored.nestedLayers?.[1]?.providerUsed, 'XAI_BYOK');
    assert.equal(restored.nestedLayers?.[1]?.modelUsed, 'grok-imagine-image-2.0');
  }
}
