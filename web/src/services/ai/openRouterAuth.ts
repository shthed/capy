import { NativeBridge } from '../NativeBridge';
import {
  ANDROID_OAUTH_REDIRECT_URI,
  awaitOAuthCallback,
  derivePkceCodeChallenge,
  generateOAuthState,
  generatePkceCodeVerifier,
  getWebOAuthRedirectUri,
} from '../providers/OAuthPkceHelper';
import { saveOpenRouterByokApiKey } from '../storage/SettingsStorage';

export const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth';
export const OPENROUTER_AUTH_KEYS_ENDPOINT = 'https://openrouter.ai/api/v1/auth/keys';
export const OPENROUTER_KEYS_CONSOLE_URL = 'https://openrouter.ai/keys';
export const CAPY_OPENROUTER_REFERER = 'https://capypaint.com';
export const CAPY_OPENROUTER_TITLE = 'Capy Paint';

export interface BuildOpenRouterOAuthUrlParams {
  callbackUrl: string;
  codeChallenge: string;
  state: string;
  limitUsd?: number;
}

export interface ExchangeOpenRouterAuthCodeParams {
  code: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface ConnectOpenRouterWithPkceOptions {
  isAndroid?: boolean;
  callbackUrl?: string;
  limitUsd?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  awaitCallback?: typeof awaitOAuthCallback;
  openAndroidExternalOAuth?: (authUrl: string) => boolean;
  saveApiKey?: (key: string) => boolean;
}

function hasControlOrWhitespace(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function isAllowedOpenRouterCallbackUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || hasControlOrWhitespace(trimmed)) return false;
  if (trimmed === ANDROID_OAUTH_REDIRECT_URI) return true;
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    const host = parsed.hostname.toLowerCase();
    if (parsed.username !== '' || parsed.password !== '') return false;
    if (protocol === 'https:') {
      return host.length > 0;
    }
    if (protocol === 'http:') {
      return host === 'localhost' || host === '127.0.0.1';
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Builds an OpenRouter OAuth PKCE (`S256`) authorization URL.
 * OpenRouter requires zero client registration or client secret; `state` is returned
 * unchanged as a query parameter on `callback_url` for CSRF verification.
 */
export function buildOpenRouterOAuthUrl(params: BuildOpenRouterOAuthUrlParams): string {
  const callbackUrl = params.callbackUrl.trim();
  if (!isAllowedOpenRouterCallbackUrl(callbackUrl)) {
    throw new Error('OPENROUTER_INVALID_CALLBACK_URL');
  }
  const codeChallenge = params.codeChallenge.trim();
  const state = params.state.trim();
  if (!codeChallenge || !state) {
    throw new Error('OPENROUTER_INVALID_PKCE_PARAMS');
  }
  const url = new URL(OPENROUTER_AUTH_URL);
  url.searchParams.set('callback_url', callbackUrl);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  if (
    typeof params.limitUsd === 'number' &&
    Number.isFinite(params.limitUsd) &&
    params.limitUsd > 0 &&
    params.limitUsd < 1_000_000
  ) {
    url.searchParams.set('limit', params.limitUsd.toFixed(2));
  }
  return url.toString();
}

/**
 * Exchanges an OpenRouter OAuth PKCE authorization code for a user-controlled API key
 * via `POST https://openrouter.ai/api/v1/auth/keys`.
 */
export async function exchangeOpenRouterAuthCode(
  params: ExchangeOpenRouterAuthCodeParams
): Promise<{ key: string }> {
  const code = params.code.trim();
  const codeVerifier = params.codeVerifier.trim();
  if (!code || !codeVerifier) {
    throw new Error('OPENROUTER_MISSING_CODE_OR_VERIFIER');
  }
  const fetcher = params.fetchImpl ?? fetch;
  const response = await fetcher(OPENROUTER_AUTH_KEYS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'HTTP-Referer': CAPY_OPENROUTER_REFERER,
      'X-Title': CAPY_OPENROUTER_TITLE,
    },
    body: JSON.stringify({
      code,
      code_verifier: codeVerifier,
      code_challenge_method: 'S256',
    }),
    signal: params.signal,
  });

  const payload = (await response.json().catch(() => ({}))) as {
    key?: unknown;
    error?: string | { message?: string };
    message?: string;
  };

  if (!response.ok) {
    const errMessage =
      typeof payload.error === 'string'
        ? payload.error
        : typeof payload.error === 'object' && payload.error && typeof payload.error.message === 'string'
          ? payload.error.message
          : typeof payload.message === 'string'
            ? payload.message
            : `HTTP_${response.status}`;
    throw new Error(`OPENROUTER_KEY_EXCHANGE_FAILED: ${errMessage}`);
  }

  const key = typeof payload.key === 'string' ? payload.key.trim() : '';
  if (!key) {
    throw new Error('OPENROUTER_KEY_EXCHANGE_EMPTY');
  }
  return { key };
}

/**
 * Runs 1-click OpenRouter OAuth PKCE (`S256`) on Web (popup) or Android (external browser
 * returning to `capypaint://oauth/callback`) and saves the minted user key strictly on this device.
 */
export async function connectOpenRouterWithPkce(
  options: ConnectOpenRouterWithPkceOptions = {}
): Promise<{ connected: true }> {
  const isAndroid = options.isAndroid ?? NativeBridge.isAndroidNative();
  const callbackUrl =
    options.callbackUrl ?? (isAndroid ? ANDROID_OAUTH_REDIRECT_URI : getWebOAuthRedirectUri());

  const codeVerifier = generatePkceCodeVerifier(32);
  const codeChallenge = await derivePkceCodeChallenge(codeVerifier);
  const state = generateOAuthState(24);
  const authorizeUrl = buildOpenRouterOAuthUrl({
    callbackUrl,
    codeChallenge,
    state,
    limitUsd: options.limitUsd,
  });

  const awaitCallbackFn = options.awaitCallback ?? awaitOAuthCallback;
  const { code } = await awaitCallbackFn({
    authorizeUrl,
    expectedState: state,
    timeoutMs: options.timeoutMs ?? 120_000,
    useAndroidExternalBrowser: isAndroid,
    openAndroidExternalOAuth:
      options.openAndroidExternalOAuth ?? ((url) => NativeBridge.openExternalOAuth(url)),
  });

  const { key } = await exchangeOpenRouterAuthCode({
    code,
    codeVerifier,
    fetchImpl: options.fetchImpl,
  });

  const saveFn = options.saveApiKey ?? saveOpenRouterByokApiKey;
  saveFn(key);
  return { connected: true };
}
