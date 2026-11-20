import { resolveScopedStorageKey } from '../StorageNamespace';
import { NativeBridge } from '../NativeBridge';
import { isDebugEnvironmentEnabled } from '../../utils/debugEnvironment';
import {
  ANDROID_OAUTH_REDIRECT_URI,
  awaitOAuthCallback,
  buildOAuthAuthorizeUrl,
  derivePkceCodeChallenge,
  exchangePkceAuthorizationCode,
  generateOAuthState,
  generatePkceCodeVerifier,
  getWebOAuthRedirectUri,
} from './OAuthPkceHelper';

export const MICROSOFT_CLIENT_ID_STORAGE_KEY = 'capy_microsoft_oauth_client_id_v1';
export const MICROSOFT_TOKEN_STORAGE_KEY = 'capy_microsoft_oauth_token_v1';
export const MICROSOFT_OAUTH_SCOPES =
  'openid profile email User.Read Files.ReadWrite.AppFolder';
export const MICROSOFT_AUTHORIZE_ENDPOINT =
  'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';
export const MICROSOFT_TOKEN_ENDPOINT =
  'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
export const MICROSOFT_GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export interface MicrosoftOAuthSession {
  accessToken: string;
  expiresAt: number;
  sub: string;
  displayName: string;
  email?: string;
}

declare global {
  interface Window {
    __capyMockMicrosoftOAuthToken?: string;
  }
}

export function getAllowedMockMicrosoftOAuthToken(): string {
  if (typeof window === 'undefined' || !isDebugEnvironmentEnabled()) {
    return '';
  }
  return typeof window.__capyMockMicrosoftOAuthToken === 'string'
    ? window.__capyMockMicrosoftOAuthToken.trim()
    : '';
}

export function getConfiguredMicrosoftClientId(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage
        .getItem(resolveScopedStorageKey(MICROSOFT_CLIENT_ID_STORAGE_KEY))
        ?.trim();
      if (stored) return stored;
    }
  } catch {
    // Ignore storage read errors
  }
  const envClientId = (
    import.meta as unknown as { env?: Record<string, string | undefined> }
  ).env?.VITE_MICROSOFT_CLIENT_ID?.trim();
  return envClientId || '';
}

export function setConfiguredMicrosoftClientId(clientId: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const key = resolveScopedStorageKey(MICROSOFT_CLIENT_ID_STORAGE_KEY);
    const trimmed = clientId.trim();
    if (trimmed) {
      localStorage.setItem(key, trimmed);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage write errors
  }
}

/**
 * Validates OneDrive AppFolder filenames to strictly reject path traversal,
 * directory separators, Graph colon syntax injection, and control characters.
 */
export function isValidOneDriveFileName(rawName: string): boolean {
  if (typeof rawName !== 'string') return false;
  const trimmed = rawName.trim();
  if (trimmed.length === 0 || trimmed.length > 180) return false;
  if (trimmed !== rawName) return false;
  if (trimmed === '.' || trimmed === '..') return false;
  if (/[/\\:]/.test(trimmed)) return false;
  if (trimmed.includes('..')) return false;
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return false;
  return /^[A-Za-z0-9._-]+$/.test(trimmed);
}

let inMemoryMicrosoftSession: MicrosoftOAuthSession | null = null;

function validateParsedMicrosoftSession(rawParsed: unknown): MicrosoftOAuthSession | null {
  const parsed = rawParsed as Partial<MicrosoftOAuthSession> | null;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof parsed.accessToken !== 'string' ||
    parsed.accessToken.trim().length === 0 ||
    typeof parsed.sub !== 'string' ||
    parsed.sub.trim().length === 0 ||
    typeof parsed.displayName !== 'string' ||
    parsed.displayName.trim().length === 0 ||
    typeof parsed.expiresAt !== 'number' ||
    !Number.isFinite(parsed.expiresAt)
  ) {
    return null;
  }
  if (Date.now() >= parsed.expiresAt - 30_000) {
    return null;
  }
  const cleanName = parsed.displayName.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!cleanName) return null;
  return {
    accessToken: parsed.accessToken.trim(),
    sub: parsed.sub.trim(),
    displayName: cleanName.slice(0, 32),
    email: typeof parsed.email === 'string' ? parsed.email.trim() : undefined,
    expiresAt: parsed.expiresAt,
  };
}

export function loadCachedMicrosoftSession(): MicrosoftOAuthSession | null {
  const scopedKey = resolveScopedStorageKey(MICROSOFT_TOKEN_STORAGE_KEY);
  if (inMemoryMicrosoftSession) {
    if (Date.now() < inMemoryMicrosoftSession.expiresAt - 30_000) {
      return inMemoryMicrosoftSession;
    }
    inMemoryMicrosoftSession = null;
  }
  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(scopedKey);
      if (raw) {
        const parsed = validateParsedMicrosoftSession(JSON.parse(raw));
        if (parsed) {
          inMemoryMicrosoftSession = parsed;
          return parsed;
        }
        sessionStorage.removeItem(scopedKey);
      }
    }
  } catch {
    // Ignore malformed sessionStorage payload
  }
  return null;
}

export function saveCachedMicrosoftSession(session: MicrosoftOAuthSession): void {
  const validated = validateParsedMicrosoftSession(session);
  if (!validated) return;
  inMemoryMicrosoftSession = validated;
  const scopedKey = resolveScopedStorageKey(MICROSOFT_TOKEN_STORAGE_KEY);
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(scopedKey, JSON.stringify(validated));
    }
  } catch {
    // Ignore sessionStorage restrictions
  }
}

export function clearCachedMicrosoftSession(): void {
  inMemoryMicrosoftSession = null;
  const scopedKey = resolveScopedStorageKey(MICROSOFT_TOKEN_STORAGE_KEY);
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(scopedKey);
    }
  } catch {
    // Ignore storage errors
  }
}

export async function fetchMicrosoftUserProfile(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ sub: string; displayName: string; email?: string }> {
  const mockToken = getAllowedMockMicrosoftOAuthToken();
  if (mockToken && accessToken === mockToken) {
    return {
      sub: 'mock_ms_player_001',
      displayName: 'Capy OneDrive Tester',
      email: 'capy.ms@example.com',
    };
  }

  const res = await fetchImpl(`${MICROSOFT_GRAPH_BASE}/me?$select=id,displayName,mail,userPrincipalName`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    throw new Error(`MICROSOFT_PROFILE_FETCH_FAILED: HTTP_${res.status}`);
  }
  const data = (await res.json()) as {
    id?: string;
    displayName?: string;
    mail?: string | null;
    userPrincipalName?: string | null;
  };
  const sub = (data.id || '').trim();
  if (!sub) {
    throw new Error('MICROSOFT_PROFILE_MISSING_ID');
  }
  const email = (data.mail || data.userPrincipalName || '').trim() || undefined;
  const displayName = (data.displayName || email?.split('@')[0] || 'Microsoft Player')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 32);
  return {
    sub,
    displayName: displayName || 'Microsoft Player',
    email,
  };
}

export async function signInWithMicrosoftOAuthPkce(
  customClientId?: string,
  options?: { fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<MicrosoftOAuthSession> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const mockToken = getAllowedMockMicrosoftOAuthToken();
  if (mockToken) {
    const profile = await fetchMicrosoftUserProfile(mockToken, fetchImpl);
    const session: MicrosoftOAuthSession = {
      accessToken: mockToken,
      expiresAt: Date.now() + 3600 * 1000,
      sub: profile.sub,
      displayName: profile.displayName,
      email: profile.email,
    };
    saveCachedMicrosoftSession(session);
    return session;
  }

  const clientId = (customClientId ?? getConfiguredMicrosoftClientId()).trim();
  if (!clientId) {
    throw new Error('MICROSOFT_CLIENT_ID_REQUIRED');
  }

  const useAndroidExternalBrowser = NativeBridge.isAndroid;
  const redirectUri = useAndroidExternalBrowser
    ? ANDROID_OAUTH_REDIRECT_URI
    : getWebOAuthRedirectUri();

  const codeVerifier = generatePkceCodeVerifier(32);
  const codeChallenge = await derivePkceCodeChallenge(codeVerifier);
  const state = generateOAuthState(24);
  const authorizeUrl = buildOAuthAuthorizeUrl({
    authorizeEndpoint: MICROSOFT_AUTHORIZE_ENDPOINT,
    clientId,
    redirectUri,
    scope: MICROSOFT_OAUTH_SCOPES,
    state,
    codeChallenge,
    extraParams: {
      response_mode: 'query',
      prompt: 'select_account',
    },
  });

  const callback = await awaitOAuthCallback({
    authorizeUrl,
    expectedState: state,
    timeoutMs: options?.timeoutMs ?? 120_000,
    useAndroidExternalBrowser,
    openAndroidExternalOAuth: (url) => NativeBridge.openExternalOAuth(url),
  });

  const token = await exchangePkceAuthorizationCode({
    tokenEndpoint: MICROSOFT_TOKEN_ENDPOINT,
    clientId,
    code: callback.code,
    codeVerifier,
    redirectUri,
    scope: MICROSOFT_OAUTH_SCOPES,
    fetchImpl,
  });

  const profile = await fetchMicrosoftUserProfile(token.accessToken, fetchImpl);
  const session: MicrosoftOAuthSession = {
    accessToken: token.accessToken,
    expiresAt: Date.now() + token.expiresIn * 1000,
    sub: profile.sub,
    displayName: profile.displayName,
    email: profile.email,
  };
  saveCachedMicrosoftSession(session);
  return session;
}

/**
 * Client-direct Microsoft Graph OneDrive `special/approot` REST client ($0 backend cost).
 * Reads and writes JSON manifests, slot envelopes, and binary `.capy` blobs directly
 * into the signed-in player's own OneDrive AppFolder.
 */
export class OneDriveAppFolderClient {
  private readonly customFetch?: typeof fetch;

  constructor(
    private readonly accessToken: string,
    fetchImpl?: typeof fetch
  ) {
    this.customFetch = fetchImpl;
  }

  private invokeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const fn = this.customFetch;
    return fn ? fn(input, init) : globalThis.fetch(input, init);
  }

  private buildContentUrl(fileName: string): string {
    if (!isValidOneDriveFileName(fileName)) {
      throw new Error(`INVALID_ONEDRIVE_FILENAME: ${fileName}`);
    }
    return `${MICROSOFT_GRAPH_BASE}/me/drive/special/approot:/${encodeURIComponent(fileName)}:/content`;
  }

  async downloadJsonFile<T>(fileName: string): Promise<T | null> {
    if (!isValidOneDriveFileName(fileName)) {
      return null;
    }
    const res = await this.invokeFetch(this.buildContentUrl(fileName), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`ONEDRIVE_DOWNLOAD_JSON_FAILED: HTTP_${res.status}`);
    }
    try {
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  async uploadJsonFile(fileName: string, payload: unknown): Promise<boolean> {
    if (!isValidOneDriveFileName(fileName)) {
      return false;
    }
    const res = await this.invokeFetch(this.buildContentUrl(fileName), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return res.ok;
  }

  async downloadBinaryFile(fileName: string): Promise<Uint8Array | null> {
    if (!isValidOneDriveFileName(fileName)) {
      return null;
    }
    const res = await this.invokeFetch(this.buildContentUrl(fileName), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`ONEDRIVE_DOWNLOAD_BINARY_FAILED: HTTP_${res.status}`);
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }

  async uploadBinaryFile(fileName: string, bytes: Uint8Array): Promise<string | null> {
    if (!isValidOneDriveFileName(fileName)) {
      return null;
    }
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const res = await this.invokeFetch(this.buildContentUrl(fileName), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/octet-stream',
      },
      body: copy.buffer,
    });
    if (!res.ok) return null;
    return fileName;
  }
}
