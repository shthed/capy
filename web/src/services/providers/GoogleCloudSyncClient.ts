export const GOOGLE_CLIENT_ID_STORAGE_KEY = 'capy_google_oauth_client_id_v1';
export const GOOGLE_TOKEN_STORAGE_KEY = 'capy_google_oauth_token_v1';
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
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            prompt?: string;
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

export function getConfiguredGoogleClientId(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(GOOGLE_CLIENT_ID_STORAGE_KEY)?.trim();
      if (stored) return stored;
    }
  } catch {
    // Ignore storage read errors
  }
  const envClientId = (
    import.meta as unknown as { env?: Record<string, string | undefined> }
  ).env?.VITE_GOOGLE_CLIENT_ID?.trim();
  return envClientId || '';
}

export function setConfiguredGoogleClientId(clientId: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const trimmed = clientId.trim();
    if (trimmed) {
      localStorage.setItem(GOOGLE_CLIENT_ID_STORAGE_KEY, trimmed);
    } else {
      localStorage.removeItem(GOOGLE_CLIENT_ID_STORAGE_KEY);
    }
  } catch {
    // Ignore storage write errors
  }
}

export function loadCachedGoogleSession(): GoogleOAuthSession | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(GOOGLE_TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GoogleOAuthSession;
    if (
      parsed &&
      parsed.accessToken &&
      parsed.sub &&
      parsed.displayName &&
      typeof parsed.expiresAt === 'number' &&
      Date.now() < parsed.expiresAt - 30_000
    ) {
      return parsed;
    }
  } catch {
    // Ignore malformed session
  }
  return null;
}

export function saveCachedGoogleSession(session: GoogleOAuthSession): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(GOOGLE_TOKEN_STORAGE_KEY, JSON.stringify(session));
    }
  } catch {
    // Ignore
  }
}

export function clearCachedGoogleSession(): void {
  try {
    const existing = loadCachedGoogleSession();
    if (existing?.accessToken && typeof window !== 'undefined') {
      window.google?.accounts?.oauth2?.revoke?.(existing.accessToken, () => {});
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(GOOGLE_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore
  }
}

let gsiScriptPromise: Promise<void> | null = null;

function ensureGoogleIdentityScriptLoaded(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window is not available'));
  }
  if (window.google?.accounts?.oauth2 || window.__capyMockGoogleOAuthToken) {
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

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gsiScriptPromise = null;
      reject(new Error('Failed to load Google Identity Services script'));
    };
    document.head.appendChild(script);
  });

  return gsiScriptPromise;
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
  const sub = (data.sub || data.email || '').trim();
  const displayName = (data.name || data.given_name || data.email || 'Google Player').trim();
  if (!sub) {
    throw new Error('Google UserInfo response did not include a user subject ID');
  }
  return {
    sub,
    displayName,
    email: data.email?.trim(),
    picture: data.picture?.trim(),
  };
}

export async function signInWithGoogleOAuthPopup(
  clientId: string,
  prompt: 'consent' | 'select_account' | '' = 'select_account'
): Promise<GoogleOAuthSession> {
  const cleanClientId = clientId.trim();
  if (!cleanClientId) {
    const err = new Error('GOOGLE_CLIENT_ID_REQUIRED');
    err.name = 'GOOGLE_CLIENT_ID_REQUIRED';
    throw err;
  }

  await ensureGoogleIdentityScriptLoaded();

  // Support E2E Playwright mock token injection when testing without an external popup
  if (typeof window !== 'undefined' && window.__capyMockGoogleOAuthToken) {
    const accessToken = window.__capyMockGoogleOAuthToken;
    const profile = await fetchGoogleUserProfile(accessToken);
    const session: GoogleOAuthSession = {
      accessToken,
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

/**
 * Client for reading and writing files inside the user's hidden, application-private
 * Google Drive `appDataFolder` (`https://www.googleapis.com/auth/drive.appdata`).
 */
export class GoogleDriveAppDataClient {
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
    if (!res.ok) {
      throw new Error(`Google Drive appDataFolder list failed (${res.status})`);
    }
    const body = (await res.json()) as { files?: DriveAppDataFileMetadata[] };
    return body.files && body.files.length > 0 ? body.files[0] : null;
  }

  static async downloadJsonFile<T>(accessToken: string, fileId: string): Promise<T | null> {
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
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
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
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
    const boundary = `capy_drive_boundary_${Date.now().toString(36)}`;
    const metadata: Record<string, unknown> = {
      name: fileName,
      mimeType: 'application/json',
    };
    if (!existingFileId) {
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

    const endpoint = existingFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingFileId)}?uploadType=multipart&fields=id,name,modifiedTime`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime`;

    const res = await fetch(endpoint, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    });
    if (!res.ok) {
      throw new Error(`Google Drive appDataFolder upload failed (${res.status})`);
    }
    return (await res.json()) as DriveAppDataFileMetadata;
  }

  static async uploadBinaryFile(
    accessToken: string,
    fileName: string,
    bytes: Uint8Array,
    existingFileId?: string
  ): Promise<DriveAppDataFileMetadata> {
    const boundary = `capy_drive_bin_${Date.now().toString(36)}`;
    const metadata: Record<string, unknown> = {
      name: fileName,
      mimeType: 'application/octet-stream',
    };
    if (!existingFileId) {
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

    const endpoint = existingFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingFileId)}?uploadType=multipart&fields=id,name,modifiedTime`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime`;

    const res = await fetch(endpoint, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: bodyBlob,
    });
    if (!res.ok) {
      throw new Error(`Google Drive binary upload failed (${res.status})`);
    }
    return (await res.json()) as DriveAppDataFileMetadata;
  }
}
