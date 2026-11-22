/**
 * Shared OAuth 2.0 PKCE (`S256`) helper for client-direct BYOC cloud sync drivers.
 * Uses WebCrypto (`crypto.subtle`) with zero client secrets so cloud auth scales
 * to millions of players at $0 backend cost.
 */

export const ANDROID_OAUTH_REDIRECT_URI = 'capypaint://oauth/callback';

export interface OAuthAuthorizeParams {
  authorizeEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
  extraParams?: Record<string, string>;
}

export interface ParsedOAuthCallback {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

export interface PkceTokenExchangeParams {
  tokenEndpoint: string;
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  scope?: string;
  fetchImpl?: typeof fetch;
}

export interface PkceTokenResponse {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
  idToken?: string;
  scope?: string;
}

export interface AwaitOAuthCallbackOptions {
  authorizeUrl: string;
  expectedState: string;
  timeoutMs?: number;
  useAndroidExternalBrowser?: boolean;
  openAndroidExternalOAuth?: (authUrl: string) => boolean;
}

import { uint8ToBase64 } from '../../utils/base64';

const POPUP_CALLBACK_MESSAGE_TYPE = 'capy_oauth_pkce_callback_v1';

export function bytesToBase64Url(bytes: Uint8Array): string {
  return uint8ToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function generatePkceCodeVerifier(byteLength = 32): string {
  const clamped = Math.max(32, Math.min(96, Math.floor(byteLength)));
  const randomBytes = new Uint8Array(clamped);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(randomBytes);
  } else {
    throw new Error('PKCE_WEBCRYPTO_UNAVAILABLE');
  }
  return bytesToBase64Url(randomBytes);
}

export async function derivePkceCodeChallenge(codeVerifier: string): Promise<string> {
  if (!codeVerifier || codeVerifier.length < 43 || codeVerifier.length > 128) {
    throw new Error('PKCE_INVALID_CODE_VERIFIER');
  }
  if (typeof crypto === 'undefined' || !crypto.subtle || typeof crypto.subtle.digest !== 'function') {
    throw new Error('PKCE_WEBCRYPTO_UNAVAILABLE');
  }
  const encoded = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return bytesToBase64Url(new Uint8Array(digest));
}

export function generateOAuthState(byteLength = 24): string {
  const clamped = Math.max(16, Math.min(64, Math.floor(byteLength)));
  const randomBytes = new Uint8Array(clamped);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(randomBytes);
  } else {
    throw new Error('PKCE_WEBCRYPTO_UNAVAILABLE');
  }
  return bytesToBase64Url(randomBytes);
}

export function validateOAuthCallbackState(
  expectedState: string,
  receivedState?: string | null
): boolean {
  if (!expectedState || !receivedState) return false;
  if (expectedState.length !== receivedState.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedState.length; i += 1) {
    diff |= expectedState.charCodeAt(i) ^ receivedState.charCodeAt(i);
  }
  return diff === 0;
}

export function buildOAuthAuthorizeUrl(params: OAuthAuthorizeParams): string {
  const url = new URL(params.authorizeEndpoint);
  url.searchParams.set('client_id', params.clientId.trim());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', params.scope);
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (params.extraParams) {
    for (const [key, value] of Object.entries(params.extraParams)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}

export function parseOAuthCallbackUrl(rawUrl: string): ParsedOAuthCallback | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || /[\u0000-\u001F\u007F]/.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    const searchParams = parsed.searchParams;
    const hashRaw = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
    const hashParams = new URLSearchParams(hashRaw);

    const code = searchParams.get('code') || hashParams.get('code') || undefined;
    const state = searchParams.get('state') || hashParams.get('state') || undefined;
    const error = searchParams.get('error') || hashParams.get('error') || undefined;
    const errorDescription =
      searchParams.get('error_description') || hashParams.get('error_description') || undefined;

    if (!code && !error) return null;
    return { code, state, error, errorDescription };
  } catch {
    return null;
  }
}

export async function exchangePkceAuthorizationCode(
  params: PkceTokenExchangeParams
): Promise<PkceTokenResponse> {
  const fetcher = params.fetchImpl ?? fetch;
  const form = new URLSearchParams();
  form.set('client_id', params.clientId.trim());
  form.set('grant_type', 'authorization_code');
  form.set('code', params.code);
  form.set('code_verifier', params.codeVerifier);
  form.set('redirect_uri', params.redirectUri);
  if (params.scope) {
    form.set('scope', params.scope);
  }

  const res = await fetcher(params.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  const payload = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    id_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !payload.access_token) {
    const reason = payload.error_description || payload.error || `HTTP_${res.status}`;
    throw new Error(`OAUTH_TOKEN_EXCHANGE_FAILED: ${reason}`);
  }

  return {
    accessToken: payload.access_token,
    expiresIn:
      typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
        ? Math.max(60, payload.expires_in)
        : 3600,
    refreshToken: payload.refresh_token,
    idToken: payload.id_token,
    scope: payload.scope,
  };
}

/**
 * If the current window is a Web OAuth PKCE popup returning to our origin with `?code=&state=`,
 * forwards the callback URL to `window.opener` and closes the popup cleanly.
 */
export function handlePotentialWebOAuthPopupCallback(): boolean {
  if (typeof window === 'undefined' || !window.opener || window.opener === window) {
    return false;
  }
  const parsed = parseOAuthCallbackUrl(window.location.href);
  if (!parsed || !parsed.state) return false;
  try {
    window.opener.postMessage(
      {
        type: POPUP_CALLBACK_MESSAGE_TYPE,
        url: window.location.href,
      },
      window.location.origin
    );
    window.close();
    return true;
  } catch {
    return false;
  }
}

export function getWebOAuthRedirectUri(): string {
  if (typeof window === 'undefined' || !window.location) {
    return 'https://capypaint.com/';
  }
  const { origin, pathname } = window.location;
  // Preserve sub-path for GitHub Pages previews (/capy/, /capy/beta/, /capy/alpha/NNN/)
  const cleanPath = pathname.endsWith('/') ? pathname : `${pathname.replace(/\/[^/]*$/, '/')}`;
  return `${origin}${cleanPath}`;
}

export function isSafeOAuthAuthorizeUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || /[\s\u0000-\u001F\u007F]/.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return (
      parsed.protocol.toLowerCase() === 'https:' &&
      parsed.hostname.length > 0 &&
      parsed.username === '' &&
      parsed.password === '' &&
      (parsed.port === '' || parsed.port === '443')
    );
  } catch {
    return false;
  }
}

/**
 * Launches either the Android external-browser PKCE flow (returning via `capypaint://oauth/callback`
 * -> `window.__capyReceiveOAuthCallback`) or a Web OAuth popup window, validating CSRF `state`
 * and handling user cancellation or timeout cleanly.
 */
export function awaitOAuthCallback(
  options: AwaitOAuthCallbackOptions
): Promise<{ code: string; state: string }> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('OAUTH_WINDOW_UNAVAILABLE'));
  }
  if (!isSafeOAuthAuthorizeUrl(options.authorizeUrl)) {
    return Promise.reject(new Error('OAUTH_UNSAFE_AUTHORIZE_URL'));
  }

  const timeoutMs = options.timeoutMs ?? 120_000;

  return new Promise<{ code: string; state: string }>((resolve, reject) => {
    let settled = false;
    let popup: Window | null = null;
    let popupPollTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const prevNativeCallback = window.__capyReceiveOAuthCallback;

    const cleanup = () => {
      if (popupPollTimer !== null) {
        clearInterval(popupPollTimer);
        popupPollTimer = null;
      }
      if (timeoutTimer !== null) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      window.removeEventListener('message', onMessage);
      if (window.__capyReceiveOAuthCallback === onNativeCallback) {
        window.__capyReceiveOAuthCallback = prevNativeCallback;
      }
      try {
        if (popup && !popup.closed) {
          popup.close();
        }
      } catch {
        // Ignore cross-origin popup close errors
      }
      popup = null;
    };

    const finishSuccess = (code: string, state: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ code, state });
    };

    const finishError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const processCallbackUrl = (rawUrl: string) => {
      const parsed = parseOAuthCallbackUrl(rawUrl);
      if (!parsed) return;
      if (!validateOAuthCallbackState(options.expectedState, parsed.state)) {
        finishError(new Error('OAUTH_STATE_MISMATCH'));
        return;
      }
      if (parsed.error) {
        finishError(
          new Error(parsed.errorDescription || parsed.error || 'OAUTH_AUTHORIZATION_DENIED')
        );
        return;
      }
      if (parsed.code && parsed.state) {
        finishSuccess(parsed.code, parsed.state);
      }
    };

    const onNativeCallback = (callbackUrl: string) => {
      processCallbackUrl(callbackUrl);
      if (prevNativeCallback) {
        try {
          prevNativeCallback(callbackUrl);
        } catch {
          // Ignore previous handler errors
        }
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (popup && event.source !== popup) return;
      const data = event.data as { type?: string; url?: string } | null;
      if (!data || data.type !== POPUP_CALLBACK_MESSAGE_TYPE || typeof data.url !== 'string') {
        return;
      }
      processCallbackUrl(data.url);
    };

    window.__capyReceiveOAuthCallback = onNativeCallback;
    window.addEventListener('message', onMessage);

    timeoutTimer = setTimeout(() => {
      finishError(new Error('OAUTH_SIGNIN_TIMEOUT'));
    }, timeoutMs);

    if (options.useAndroidExternalBrowser) {
      const launched = options.openAndroidExternalOAuth
        ? options.openAndroidExternalOAuth(options.authorizeUrl)
        : false;
      if (!launched) {
        finishError(new Error('ANDROID_EXTERNAL_OAUTH_LAUNCH_FAILED'));
      }
      return;
    }

    const width = 500;
    const height = 640;
    const left = Math.max(0, Math.round((window.screenX || 0) + ((window.outerWidth || 800) - width) / 2));
    const top = Math.max(0, Math.round((window.screenY || 0) + ((window.outerHeight || 700) - height) / 2));
    popup = window.open(
      options.authorizeUrl,
      'capy_oauth_pkce_popup',
      `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,status=no`
    );

    if (!popup) {
      finishError(new Error('OAUTH_POPUP_BLOCKED'));
      return;
    }

    popupPollTimer = setInterval(() => {
      if (!popup) return;
      if (popup.closed) {
        finishError(new Error('OAUTH_SIGNIN_CANCELLED'));
        return;
      }
      try {
        const href = popup.location.href;
        if (href && href.startsWith(window.location.origin)) {
          processCallbackUrl(href);
        }
      } catch {
        // Still on external OAuth provider origin
      }
    }, 250);
  });
}
