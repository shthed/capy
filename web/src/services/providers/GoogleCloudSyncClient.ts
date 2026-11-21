import { SafeLocalStore } from '../storage/SafeLocalStore';
import {
  EXPLICIT_SIGNOUT_STORAGE_KEY,
  GOOGLE_CLIENT_ID_STORAGE_KEY,
  GOOGLE_TOKEN_STORAGE_KEY,
  resolveScopedStorageKey,
} from '../storage/StorageKeys';
import { reportSwallowed } from '../telemetry';
import {
  DEV_DEBUG_STORAGE_KEY,
  isDebugEnvironmentEnabled as isGoogleMockTokenEnvironmentAllowed,
} from '../../utils/debugEnvironment';

export {
  DEV_DEBUG_STORAGE_KEY,
  EXPLICIT_SIGNOUT_STORAGE_KEY,
  GOOGLE_CLIENT_ID_STORAGE_KEY,
  GOOGLE_TOKEN_STORAGE_KEY,
  isGoogleMockTokenEnvironmentAllowed,
};
export const GOOGLE_OAUTH_SCOPES =
  'openid profile email https://www.googleapis.com/auth/drive.appdata';

export interface GoogleOAuthSession {
  accessToken: string;
  expiresAt: number;
  sub: string;
  displayName: string;
  email?: string;
  picture?: string;
}

export interface DriveAppDataFileMetadata {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string; hint?: string }) => void;
}

interface GoogleCredentialResponse {
  credential?: string;
  select_by?: string;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: {
            client_id: string;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
            use_fedcm_for_prompt?: boolean;
            callback: (response: GoogleCredentialResponse) => void;
          }) => void;
          prompt: (
            momentListener?: (notification: {
              isNotDisplayed?: () => boolean;
              isSkippedMoment?: () => boolean;
              isDismissedMoment?: () => boolean;
            }) => void
          ) => void;
          disableAutoSelect?: () => void;
        };
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            prompt?: string;
            hint?: string;
            callback: (response: GoogleTokenResponse) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }) => GoogleTokenClient;
          revoke?: (token: string, done?: () => void) => void;
        };
      };
    };
    __capyMockGoogleOAuthToken?: string;
  }
}

function sanitizeHttpsUrl(raw?: string): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!/^https:\/\/[^\s]+$/i.test(trimmed)) return undefined;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function getAllowedMockGoogleOAuthToken(): string {
  if (typeof window === 'undefined' || !isGoogleMockTokenEnvironmentAllowed()) {
    return '';
  }
  return typeof window.__capyMockGoogleOAuthToken === 'string'
    ? window.__capyMockGoogleOAuthToken.trim()
    : '';
}

export function isExplicitlySignedOut(): boolean {
  return SafeLocalStore.getScopedItem(EXPLICIT_SIGNOUT_STORAGE_KEY) === '1';
}

export function setExplicitlySignedOut(signedOut: boolean): void {
  if (signedOut) {
    SafeLocalStore.setScopedItem(EXPLICIT_SIGNOUT_STORAGE_KEY, '1');
    try {
      if (typeof window !== 'undefined') {
        window.google?.accounts?.id?.disableAutoSelect?.();
      }
    } catch (err) {
      reportSwallowed('GoogleCloudSyncClient.disableAutoSelect', err);
    }
  } else {
    SafeLocalStore.removeScopedItem(EXPLICIT_SIGNOUT_STORAGE_KEY);
  }
}

export function getConfiguredGoogleClientId(): string {
  const stored = SafeLocalStore.getScopedItem(GOOGLE_CLIENT_ID_STORAGE_KEY)?.trim();
  if (stored) return stored;
  const envClientId = (
    import.meta as unknown as { env?: Record<string, string | undefined> }
  ).env?.VITE_GOOGLE_CLIENT_ID?.trim();
  return envClientId || '';
}

export function setConfiguredGoogleClientId(clientId: string): void {
  const trimmed = clientId.trim();
  if (trimmed) {
    SafeLocalStore.setScopedItem(GOOGLE_CLIENT_ID_STORAGE_KEY, trimmed);
  } else {
    SafeLocalStore.removeScopedItem(GOOGLE_CLIENT_ID_STORAGE_KEY);
  }
}

let inMemoryGoogleSession: GoogleOAuthSession | null = null;

function validateParsedGoogleSession(rawParsed: unknown): GoogleOAuthSession | null {
  const parsed = rawParsed as Partial<GoogleOAuthSession> | null;
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
    ...parsed,
    accessToken: parsed.accessToken.trim(),
    sub: parsed.sub.trim(),
    displayName: cleanName,
    picture: sanitizeHttpsUrl(parsed.picture),
    expiresAt: parsed.expiresAt,
  };
}

export function loadCachedGoogleSession(): GoogleOAuthSession | null {
  const scopedKey = resolveScopedStorageKey(GOOGLE_TOKEN_STORAGE_KEY);
  try {
    const legacyRaw = SafeLocalStore.getItem(scopedKey);
    if (legacyRaw) {
      SafeLocalStore.removeItem(scopedKey);
      const migrated = validateParsedGoogleSession(JSON.parse(legacyRaw));
      if (migrated) {
        inMemoryGoogleSession = migrated;
        if (typeof sessionStorage !== 'undefined') {
          try {
            sessionStorage.setItem(scopedKey, JSON.stringify(migrated));
          } catch (err) {
            reportSwallowed('GoogleCloudSyncClient.migrateSessionSet', err);
          }
        }
        return migrated;
      }
      inMemoryGoogleSession = null;
      if (typeof sessionStorage !== 'undefined') {
        try {
          sessionStorage.removeItem(scopedKey);
        } catch (err) {
          reportSwallowed('GoogleCloudSyncClient.migrateSessionRemove', err);
        }
      }
      return null;
    }
  } catch (err) {
    reportSwallowed('GoogleCloudSyncClient.migrateLegacyToken', err);
    SafeLocalStore.removeItem(scopedKey);
  }

  if (inMemoryGoogleSession) {
    if (Date.now() < inMemoryGoogleSession.expiresAt - 30_000) {
      return inMemoryGoogleSession;
    }
    inMemoryGoogleSession = null;
  }

  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(scopedKey);
      if (raw) {
        const parsed = validateParsedGoogleSession(JSON.parse(raw));
        if (parsed) {
          inMemoryGoogleSession = parsed;
          return parsed;
        }
        sessionStorage.removeItem(scopedKey);
      }
    }
  } catch (err) {
    reportSwallowed('GoogleCloudSyncClient.loadSessionStorage', err);
  }
  return null;
}

export function saveCachedGoogleSession(session: GoogleOAuthSession): void {
  const scopedKey = resolveScopedStorageKey(GOOGLE_TOKEN_STORAGE_KEY);
  const normalized = validateParsedGoogleSession(session) ?? session;
  inMemoryGoogleSession = normalized;
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(scopedKey, JSON.stringify(normalized));
    }
  } catch (err) {
    reportSwallowed('GoogleCloudSyncClient.saveSessionStorage', err);
  }
  SafeLocalStore.removeItem(scopedKey);
}

export function clearCachedGoogleSession(): void {
  const scopedKey = resolveScopedStorageKey(GOOGLE_TOKEN_STORAGE_KEY);
  try {
    const existing = loadCachedGoogleSession();
    inMemoryGoogleSession = null;
    if (existing?.accessToken && typeof window !== 'undefined') {
      window.google?.accounts?.oauth2?.revoke?.(existing.accessToken, () => {});
    }
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(scopedKey);
    }
    SafeLocalStore.removeItem(scopedKey);
  } catch (err) {
    reportSwallowed('GoogleCloudSyncClient.clearCachedGoogleSession', err);
    inMemoryGoogleSession = null;
  }
}

let gsiScriptPromise: Promise<void> | null = null;

function ensureGoogleIdentityScriptLoaded(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window is not available'));
  }
  if (window.google?.accounts?.oauth2 || getAllowedMockGoogleOAuthToken()) {
    return Promise.resolve();
  }
  if (gsiScriptPromise) return gsiScriptPromise;

  gsiScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]'
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => {
          gsiScriptPromise = null;
          reject(new Error('Failed to load Google Identity Services script'));
        },
        { once: true }
      );
      return;
    }

    if (!document.head) {
      gsiScriptPromise = null;
      reject(new Error('Document head is unavailable'));
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.referrerPolicy = 'strict-origin-when-cross-origin';
    script.onload = () => resolve();
    script.onerror = () => {
      gsiScriptPromise = null;
      reject(new Error('Failed to load Google Identity Services script'));
    };
    document.head.appendChild(script);
  });

  return gsiScriptPromise;
}

export function decodeGoogleIdTokenPayload(jwt: string): {
  sub: string;
  displayName: string;
  email?: string;
  picture?: string;
} | null {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const jsonStr = decodeURIComponent(
      Array.from(atob(padded))
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const data = JSON.parse(jsonStr) as {
      sub?: string;
      name?: string;
      given_name?: string;
      email?: string;
      picture?: string;
    };
    const sub = (data.sub || data.email || '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
    if (!sub) return null;
    const rawName = (data.name || data.given_name || data.email || 'Google Player')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .trim();
    return {
      sub,
      displayName: rawName || 'Google Player',
      email: data.email?.replace(/[\u0000-\u001F\u007F]/g, '').trim(),
      picture: sanitizeHttpsUrl(data.picture),
    };
  } catch {
    return null;
  }
}

export async function fetchGoogleUserProfile(accessToken: string): Promise<{
  sub: string;
  displayName: string;
  email?: string;
  picture?: string;
}> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (res.status === 401) {
    clearCachedGoogleSession();
  }
  if (!res.ok) {
    throw new Error(`Google UserInfo request failed (${res.status})`);
  }
  const data = (await res.json()) as {
    sub?: string;
    name?: string;
    given_name?: string;
    email?: string;
    picture?: string;
  };
  const sub = (data.sub || data.email || '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
  const displayName =
    (data.name || data.given_name || data.email || 'Google Player')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .trim() || 'Google Player';
  if (!sub) {
    throw new Error('Google UserInfo response did not include a user subject ID');
  }
  return {
    sub,
    displayName,
    email: data.email?.replace(/[\u0000-\u001F\u007F]/g, '').trim(),
    picture: sanitizeHttpsUrl(data.picture),
  };
}

/**
 * Attempts automatic Google sign-in on startup without requiring a manual button click:
 * 1. Returns cached non-expired OAuth session if available.
 * 2. Supports E2E Playwright mock token when `window.__capyMockGoogleOAuthToken` is present.
 * 3. Uses Google One Tap / FedCM (`google.accounts.id.initialize({ auto_select: true })` + `prompt()`)
 *    and silent OAuth token refresh (`prompt: ''`) when `VITE_GOOGLE_CLIENT_ID` is configured.
 */
export async function attemptSilentOrOneTapGoogleSignIn(
  clientId: string
): Promise<GoogleOAuthSession | null> {
  if (isExplicitlySignedOut()) return null;

  const cached = loadCachedGoogleSession();
  if (cached) return cached;

  const mockToken = getAllowedMockGoogleOAuthToken();
  const cleanClientId = clientId.trim() || (mockToken ? 'capy_mock_client_id' : '');
  if (!cleanClientId) return null;

  try {
    await ensureGoogleIdentityScriptLoaded();
  } catch {
    return null;
  }

  if (mockToken) {
    try {
      const profile = await fetchGoogleUserProfile(mockToken);
      const session: GoogleOAuthSession = {
        accessToken: mockToken,
        expiresAt: Date.now() + 3600 * 1000,
        sub: profile.sub,
        displayName: profile.displayName,
        email: profile.email,
        picture: profile.picture,
      };
      saveCachedGoogleSession(session);
      return session;
    } catch {
      return null;
    }
  }

  const gId = window.google?.accounts?.id;
  if (!gId) return null;

  return new Promise<GoogleOAuthSession | null>((resolve) => {
    let settled = false;
    const finish = (val: GoogleOAuthSession | null) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    const timer = window.setTimeout(() => finish(null), 5000);

    gId.initialize({
      client_id: cleanClientId,
      auto_select: true,
      cancel_on_tap_outside: false,
      use_fedcm_for_prompt: true,
      callback: async (credResp) => {
        window.clearTimeout(timer);
        if (!credResp?.credential) {
          finish(null);
          return;
        }
        const decoded = decodeGoogleIdTokenPayload(credResp.credential);
        if (!decoded) {
          finish(null);
          return;
        }

        // Attempt silent OAuth2 access_token upgrade (prompt: '') so Drive appDataFolder can sync immediately if already granted
        const oauth2 = window.google?.accounts?.oauth2;
        if (oauth2) {
          try {
            const silentToken = await new Promise<string | null>((resToken) => {
              const tTimer = window.setTimeout(() => resToken(null), 2500);
              const tokenClient = oauth2.initTokenClient({
                client_id: cleanClientId,
                scope: GOOGLE_OAUTH_SCOPES,
                prompt: '',
                hint: decoded.email,
                callback: (tr) => {
                  window.clearTimeout(tTimer);
                  resToken(tr.access_token || null);
                },
                error_callback: () => {
                  window.clearTimeout(tTimer);
                  resToken(null);
                },
              });
              tokenClient.requestAccessToken({ prompt: '', hint: decoded.email });
            });

            if (silentToken) {
              const fullSession: GoogleOAuthSession = {
                accessToken: silentToken,
                expiresAt: Date.now() + 3500 * 1000,
                sub: decoded.sub,
                displayName: decoded.displayName,
                email: decoded.email,
                picture: decoded.picture,
              };
              saveCachedGoogleSession(fullSession);
              finish(fullSession);
              return;
            }
          } catch {
            // Fall through to One Tap identity session
          }
        }

        const oneTapSession: GoogleOAuthSession = {
          accessToken: '',
          expiresAt: Date.now() + 3500 * 1000,
          sub: decoded.sub,
          displayName: decoded.displayName,
          email: decoded.email,
          picture: decoded.picture,
        };
        finish(oneTapSession);
      },
    });

    gId.prompt((notification) => {
      if (
        notification?.isNotDisplayed?.() ||
        notification?.isSkippedMoment?.() ||
        notification?.isDismissedMoment?.()
      ) {
        window.clearTimeout(timer);
        finish(null);
      }
    });
  });
}

export async function signInWithGoogleOAuthPopup(
  clientId: string,
  prompt: 'consent' | 'select_account' | '' = 'select_account'
): Promise<GoogleOAuthSession> {
  setExplicitlySignedOut(false);
  const mockToken = getAllowedMockGoogleOAuthToken();
  const cleanClientId = clientId.trim() || (mockToken ? 'capy_mock_client_id' : '');
  if (!cleanClientId) {
    const err = new Error('GOOGLE_CLIENT_ID_REQUIRED');
    err.name = 'GOOGLE_CLIENT_ID_REQUIRED';
    throw err;
  }

  await ensureGoogleIdentityScriptLoaded();

  // Support E2E Playwright mock token injection strictly in dev/debug mode
  if (mockToken) {
    const profile = await fetchGoogleUserProfile(mockToken);
    const session: GoogleOAuthSession = {
      accessToken: mockToken,
      expiresAt: Date.now() + 3600 * 1000,
      sub: profile.sub,
      displayName: profile.displayName,
      email: profile.email,
      picture: profile.picture,
    };
    saveCachedGoogleSession(session);
    return session;
  }

  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error('Google Identity Services OAuth2 client is unavailable');
  }

  const tokenResp = await new Promise<GoogleTokenResponse>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: cleanClientId,
      scope: GOOGLE_OAUTH_SCOPES,
      prompt,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(
            new Error(resp.error_description || resp.error || 'Google OAuth sign-in was cancelled')
          );
          return;
        }
        resolve(resp);
      },
      error_callback: (err) => {
        reject(new Error(err?.message || err?.type || 'Google OAuth popup closed or blocked'));
      },
    });
    client.requestAccessToken({ prompt });
  });

  const accessToken = tokenResp.access_token!;
  const expiresInSec = Number(tokenResp.expires_in) || 3599;
  const profile = await fetchGoogleUserProfile(accessToken);

  const session: GoogleOAuthSession = {
    accessToken,
    expiresAt: Date.now() + expiresInSec * 1000,
    sub: profile.sub,
    displayName: profile.displayName,
    email: profile.email,
    picture: profile.picture,
  };
  saveCachedGoogleSession(session);
  return session;
}

export function isValidGoogleDriveFileId(fileId: unknown): fileId is string {
  if (typeof fileId !== 'string') return false;
  const trimmed = fileId.trim();
  if (!trimmed || trimmed.length > 256) return false;
  if (trimmed === '.' || trimmed === '..' || trimmed.includes('..')) return false;
  return /^[a-zA-Z0-9_-]{1,256}$/.test(trimmed);
}

/**
 * Client for reading and writing files inside the user's hidden, application-private
 * Google Drive `appDataFolder` (`https://www.googleapis.com/auth/drive.appdata`).
 */
export class GoogleDriveAppDataClient {
  private static assertValidFileId(fileId: unknown): string {
    if (!isValidGoogleDriveFileId(fileId)) {
      throw new Error('Invalid Google Drive file ID');
    }
    return fileId.trim();
  }

  private static handleAuthFailure(res: Response): void {
    if (res.status === 401) {
      clearCachedGoogleSession();
    }
  }

  static async findFileByName(
    accessToken: string,
    fileName: string
  ): Promise<DriveAppDataFileMetadata | null> {
    const safeName = fileName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = `name = '${safeName}' and trashed = false`;
    const url =
      `https://www.googleapis.com/drive/v3/files` +
      `?spaces=appDataFolder` +
      `&q=${encodeURIComponent(q)}` +
      `&fields=${encodeURIComponent('files(id,name,modifiedTime,size)')}` +
      `&orderBy=modifiedTime desc` +
      `&pageSize=5`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    this.handleAuthFailure(res);
    if (!res.ok) {
      throw new Error(`Google Drive appDataFolder list failed (${res.status})`);
    }
    const body = (await res.json()) as { files?: DriveAppDataFileMetadata[] };
    const first = body.files && body.files.length > 0 ? body.files[0] : null;
    if (first && !isValidGoogleDriveFileId(first.id)) {
      throw new Error('Invalid Google Drive file ID in response');
    }
    return first;
  }

  static async downloadJsonFile<T>(accessToken: string, fileId: string): Promise<T | null> {
    const safeFileId = this.assertValidFileId(fileId);
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(safeFileId)}?alt=media`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    this.handleAuthFailure(res);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Google Drive appDataFolder download failed (${res.status})`);
    }
    return (await res.json()) as T;
  }

  static async downloadBinaryFile(
    accessToken: string,
    fileId: string
  ): Promise<Uint8Array | null> {
    const safeFileId = this.assertValidFileId(fileId);
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(safeFileId)}?alt=media`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    this.handleAuthFailure(res);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Google Drive binary download failed (${res.status})`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  static async uploadJsonFile(
    accessToken: string,
    fileName: string,
    payload: unknown,
    existingFileId?: string
  ): Promise<DriveAppDataFileMetadata> {
    const safeExistingId =
      existingFileId !== undefined ? this.assertValidFileId(existingFileId) : undefined;
    const boundary = `capy_drive_boundary_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const metadata: Record<string, unknown> = {
      name: fileName,
      mimeType: 'application/json',
    };
    if (!safeExistingId) {
      metadata.parents = ['appDataFolder'];
    }

    const multipartBody =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(payload)}\r\n` +
      `--${boundary}--`;

    const endpoint = safeExistingId
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(safeExistingId)}?uploadType=multipart&fields=id,name,modifiedTime`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime`;

    const res = await fetch(endpoint, {
      method: safeExistingId ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    });
    this.handleAuthFailure(res);
    if (!res.ok) {
      throw new Error(`Google Drive appDataFolder upload failed (${res.status})`);
    }
    const uploaded = (await res.json()) as DriveAppDataFileMetadata;
    if (!uploaded || !isValidGoogleDriveFileId(uploaded.id)) {
      throw new Error('Invalid Google Drive file ID in response');
    }
    return uploaded;
  }

  static async uploadBinaryFile(
    accessToken: string,
    fileName: string,
    bytes: Uint8Array,
    existingFileId?: string
  ): Promise<DriveAppDataFileMetadata> {
    const safeExistingId =
      existingFileId !== undefined ? this.assertValidFileId(existingFileId) : undefined;
    const boundary = `capy_drive_bin_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const metadata: Record<string, unknown> = {
      name: fileName,
      mimeType: 'application/octet-stream',
    };
    if (!safeExistingId) {
      metadata.parents = ['appDataFolder'];
    }

    const preamble =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`;
    const epilogue = `\r\n--${boundary}--`;

    const bodyBlob = new Blob([preamble, new Uint8Array(bytes), epilogue], {
      type: `multipart/related; boundary=${boundary}`,
    });

    const endpoint = safeExistingId
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(safeExistingId)}?uploadType=multipart&fields=id,name,modifiedTime`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime`;

    const res = await fetch(endpoint, {
      method: safeExistingId ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: bodyBlob,
    });
    this.handleAuthFailure(res);
    if (!res.ok) {
      throw new Error(`Google Drive binary upload failed (${res.status})`);
    }
    const uploaded = (await res.json()) as DriveAppDataFileMetadata;
    if (!uploaded || !isValidGoogleDriveFileId(uploaded.id)) {
      throw new Error('Invalid Google Drive file ID in response');
    }
    return uploaded;
  }
}
