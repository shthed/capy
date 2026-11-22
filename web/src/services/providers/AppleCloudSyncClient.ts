import { base64ToUint8, uint8ToBase64 } from '../CapyCodec';
import { SafeLocalStore } from '../storage/SafeLocalStore';
import {
  APPLE_CLIENT_ID_STORAGE_KEY,
  APPLE_CLOUDKIT_API_TOKEN_STORAGE_KEY,
  APPLE_CLOUDKIT_CONTAINER_STORAGE_KEY,
  APPLE_SESSION_STORAGE_KEY,
  resolveScopedStorageKey,
} from '../storage/StorageKeys';
import { isDebugEnvironmentEnabled } from '../../utils/debugEnvironment';

export {
  APPLE_CLIENT_ID_STORAGE_KEY,
  APPLE_CLOUDKIT_API_TOKEN_STORAGE_KEY,
  APPLE_CLOUDKIT_CONTAINER_STORAGE_KEY,
  APPLE_SESSION_STORAGE_KEY,
};
export const APPLE_CLOUDKIT_RECORD_TYPE = 'CapyCloudSaveRecord';

export interface AppleCloudSession {
  userId: string;
  displayName: string;
  email?: string;
  expiresAt: number;
  transport: 'cloudkit_js' | 'ios_native_bridge' | 'mock';
  identityToken?: string;
}

export interface AppleCloudConfig {
  clientId: string;
  cloudKitContainer: string;
  cloudKitApiToken: string;
}

interface AppleIdAuthResponse {
  authorization?: {
    id_token?: string;
    code?: string;
  };
  user?: {
    email?: string;
    name?: {
      firstName?: string;
      lastName?: string;
    };
  };
}

interface CloudKitRecordField {
  value: string | number;
}

interface CloudKitRecord {
  recordType: string;
  recordName: string;
  recordChangeTag?: string;
  fields: Record<string, CloudKitRecordField>;
}

interface CloudKitDatabase {
  fetchRecords: (
    recordNames: string[]
  ) => Promise<{ records?: CloudKitRecord[]; errors?: unknown[] }>;
  saveRecords: (
    records: CloudKitRecord[]
  ) => Promise<{ records?: CloudKitRecord[]; errors?: unknown[] }>;
}

interface CloudKitContainer {
  privateCloudDatabase: CloudKitDatabase;
  setUpAuth?: () => Promise<{ userRecordName?: string } | null>;
}

interface CloudKitGlobal {
  configure: (config: {
    containers: Array<{
      containerIdentifier: string;
      apiTokenAuth: { apiToken: string; persist?: boolean };
      environment?: 'production' | 'development';
    }>;
  }) => void;
  getDefaultContainer: () => CloudKitContainer;
}

declare global {
  interface Window {
    AppleID?: {
      auth?: {
        init: (config: {
          clientId: string;
          scope?: string;
          redirectURI: string;
          usePopup?: boolean;
        }) => void;
        signIn: () => Promise<AppleIdAuthResponse>;
      };
    };
    CloudKit?: CloudKitGlobal;
    __capyMockAppleCloudSession?:
      | string
      | { userId?: string; displayName?: string; email?: string };
    __capyReceiveAppleCloudResponse?: (requestId: string, payload: unknown) => void;
  }
}

export function getAllowedMockAppleCloudSession(): {
  userId: string;
  displayName: string;
  email?: string;
} | null {
  if (typeof window === 'undefined' || !isDebugEnvironmentEnabled()) {
    return null;
  }
  const raw = window.__capyMockAppleCloudSession;
  if (!raw) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return {
      userId: 'mock_apple_player_001',
      displayName: 'Capy iCloud Tester',
      email: 'capy.apple@example.com',
    };
  }
  if (typeof raw === 'object') {
    const userId = (raw.userId || 'mock_apple_player_001').trim();
    const displayName = (raw.displayName || 'Capy iCloud Tester').trim().slice(0, 32);
    if (!userId || !displayName) return null;
    return {
      userId,
      displayName,
      email: typeof raw.email === 'string' ? raw.email.trim() : undefined,
    };
  }
  return null;
}

export function hasNativeIosCapyBridge(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.webkit?.messageHandlers?.CapyIOS?.postMessage)
  );
}

function readConfigValue(storageKey: string, envKey: string): string {
  const stored = SafeLocalStore.getScopedItem(storageKey)?.trim();
  if (stored) return stored;
  const envVal = (
    import.meta as unknown as { env?: Record<string, string | undefined> }
  ).env?.[envKey]?.trim();
  return envVal || '';
}

export function getConfiguredAppleCloudConfig(): AppleCloudConfig {
  return {
    clientId: readConfigValue(APPLE_CLIENT_ID_STORAGE_KEY, 'VITE_APPLE_CLIENT_ID'),
    cloudKitContainer: readConfigValue(
      APPLE_CLOUDKIT_CONTAINER_STORAGE_KEY,
      'VITE_APPLE_CLOUDKIT_CONTAINER'
    ),
    cloudKitApiToken: readConfigValue(
      APPLE_CLOUDKIT_API_TOKEN_STORAGE_KEY,
      'VITE_APPLE_CLOUDKIT_API_TOKEN'
    ),
  };
}

export function isAppleCloudConfigured(): boolean {
  if (getAllowedMockAppleCloudSession()) return true;
  if (hasNativeIosCapyBridge()) return true;
  const cfg = getConfiguredAppleCloudConfig();
  return Boolean(cfg.clientId && cfg.cloudKitContainer && cfg.cloudKitApiToken);
}

export function isValidCloudKitRecordName(rawName: string): boolean {
  if (typeof rawName !== 'string') return false;
  const trimmed = rawName.trim();
  if (trimmed.length === 0 || trimmed.length > 180) return false;
  if (trimmed !== rawName) return false;
  if (trimmed === '.' || trimmed === '..') return false;
  if (/[/\\:]/.test(trimmed) || trimmed.includes('..')) return false;
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return false;
  return /^[A-Za-z0-9._-]+$/.test(trimmed);
}

let inMemoryAppleSession: AppleCloudSession | null = null;
const mockAppleRecordStore = new Map<string, string>();

export function clearMockAppleRecordStore(): void {
  mockAppleRecordStore.clear();
}

function validateParsedAppleSession(rawParsed: unknown): AppleCloudSession | null {
  const parsed = rawParsed as Partial<AppleCloudSession> | null;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof parsed.userId !== 'string' ||
    parsed.userId.trim().length === 0 ||
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
  const transport =
    parsed.transport === 'cloudkit_js' ||
    parsed.transport === 'ios_native_bridge' ||
    parsed.transport === 'mock'
      ? parsed.transport
      : 'cloudkit_js';
  const cleanName = parsed.displayName.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!cleanName) return null;
  return {
    userId: parsed.userId.trim(),
    displayName: cleanName.slice(0, 32),
    email: typeof parsed.email === 'string' ? parsed.email.trim() : undefined,
    expiresAt: parsed.expiresAt,
    transport,
    identityToken:
      typeof parsed.identityToken === 'string' ? parsed.identityToken.trim() : undefined,
  };
}

export function loadCachedAppleSession(): AppleCloudSession | null {
  const scopedKey = resolveScopedStorageKey(APPLE_SESSION_STORAGE_KEY);
  if (inMemoryAppleSession) {
    if (Date.now() < inMemoryAppleSession.expiresAt - 30_000) {
      return inMemoryAppleSession;
    }
    inMemoryAppleSession = null;
  }
  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(scopedKey);
      if (raw) {
        const parsed = validateParsedAppleSession(JSON.parse(raw));
        if (parsed) {
          inMemoryAppleSession = parsed;
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

export function saveCachedAppleSession(session: AppleCloudSession): void {
  const validated = validateParsedAppleSession(session);
  if (!validated) return;
  inMemoryAppleSession = validated;
  const scopedKey = resolveScopedStorageKey(APPLE_SESSION_STORAGE_KEY);
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(scopedKey, JSON.stringify(validated));
    }
  } catch {
    // Ignore sessionStorage restrictions
  }
}

export function clearCachedAppleSession(): void {
  inMemoryAppleSession = null;
  const scopedKey = resolveScopedStorageKey(APPLE_SESSION_STORAGE_KEY);
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(scopedKey);
    }
  } catch {
    // Ignore storage errors
  }
}

function requestNativeIosCloudAction<T>(
  action: string,
  payload: Record<string, unknown>,
  timeoutMs = 15_000
): Promise<T> {
  if (!hasNativeIosCapyBridge()) {
    return Promise.reject(new Error('IOS_NATIVE_BRIDGE_UNAVAILABLE'));
  }
  return new Promise<T>((resolve, reject) => {
    const requestId = `ios_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const prevReceiver = window.__capyReceiveAppleCloudResponse;
    let settled = false;

    const cleanup = () => {
      if (timer !== null) clearTimeout(timer);
      if (window.__capyReceiveAppleCloudResponse === receiver) {
        window.__capyReceiveAppleCloudResponse = prevReceiver;
      }
    };

    const receiver = (respId: string, respPayload: unknown) => {
      if (respId !== requestId) {
        prevReceiver?.(respId, respPayload);
        return;
      }
      if (settled) return;
      settled = true;
      cleanup();
      resolve(respPayload as T);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`IOS_CLOUD_TIMEOUT_${action}`));
    }, timeoutMs);

    window.__capyReceiveAppleCloudResponse = receiver;
    try {
      window.webkit?.messageHandlers?.CapyIOS?.postMessage({
        type: 'capyAppleCloud',
        action,
        requestId,
        ...payload,
      });
    } catch (err) {
      settled = true;
      cleanup();
      reject(err instanceof Error ? err : new Error('IOS_CLOUD_POST_FAILED'));
    }
  });
}

function decodeJwtPayloadSub(jwt?: string): string | null {
  if (!jwt || typeof jwt !== 'string') return null;
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const decoded = new TextDecoder().decode(base64ToUint8(padded));
    const parsed = JSON.parse(decoded) as { sub?: string };
    return typeof parsed.sub === 'string' && parsed.sub.trim() ? parsed.sub.trim() : null;
  } catch {
    return null;
  }
}

let cloudKitConfiguredContainer: string | null = null;

function getConfiguredCloudKitDatabase(cfg: AppleCloudConfig): CloudKitDatabase {
  if (typeof window === 'undefined' || !window.CloudKit) {
    throw new Error('APPLE_CLOUDKIT_JS_UNAVAILABLE');
  }
  if (cloudKitConfiguredContainer !== cfg.cloudKitContainer) {
    window.CloudKit.configure({
      containers: [
        {
          containerIdentifier: cfg.cloudKitContainer,
          apiTokenAuth: {
            apiToken: cfg.cloudKitApiToken,
            persist: true,
          },
          environment: 'production',
        },
      ],
    });
    cloudKitConfiguredContainer = cfg.cloudKitContainer;
  }
  return window.CloudKit.getDefaultContainer().privateCloudDatabase;
}

export async function signInWithAppleCloud(): Promise<AppleCloudSession> {
  const mock = getAllowedMockAppleCloudSession();
  if (mock) {
    const session: AppleCloudSession = {
      userId: mock.userId,
      displayName: mock.displayName,
      email: mock.email,
      expiresAt: Date.now() + 3600 * 1000,
      transport: 'mock',
    };
    saveCachedAppleSession(session);
    return session;
  }

  if (hasNativeIosCapyBridge()) {
    const nativeRes = await requestNativeIosCloudAction<{
      userId?: string;
      displayName?: string;
      email?: string;
    }>('signIn', {});
    const userId = (nativeRes?.userId || '').trim();
    if (!userId) {
      throw new Error('APPLE_IOS_SIGNIN_FAILED');
    }
    const session: AppleCloudSession = {
      userId,
      displayName: (nativeRes.displayName || 'Apple Player').trim().slice(0, 32),
      email: nativeRes.email?.trim() || undefined,
      expiresAt: Date.now() + 24 * 3600 * 1000,
      transport: 'ios_native_bridge',
    };
    saveCachedAppleSession(session);
    return session;
  }

  const cfg = getConfiguredAppleCloudConfig();
  if (!cfg.clientId || !cfg.cloudKitContainer || !cfg.cloudKitApiToken) {
    throw new Error('APPLE_CLOUD_CONFIG_REQUIRED');
  }
  if (typeof window === 'undefined' || !window.AppleID?.auth) {
    throw new Error('APPLE_SIGNIN_JS_UNAVAILABLE');
  }

  const redirectURI =
    window.location?.origin && window.location?.pathname
      ? `${window.location.origin}${window.location.pathname}`
      : 'https://capypaint.com/';

  window.AppleID.auth.init({
    clientId: cfg.clientId,
    scope: 'name email',
    redirectURI,
    usePopup: true,
  });

  const authRes = await window.AppleID.auth.signIn();
  const idToken = authRes.authorization?.id_token;
  const sub = decodeJwtPayloadSub(idToken);
  if (!sub) {
    throw new Error('APPLE_SIGNIN_MISSING_SUBJECT');
  }

  const firstName = authRes.user?.name?.firstName?.trim() || '';
  const lastName = authRes.user?.name?.lastName?.trim() || '';
  const combinedName = `${firstName} ${lastName}`.trim();
  const email = authRes.user?.email?.trim() || undefined;
  const displayName = (combinedName || email?.split('@')[0] || 'Apple Player').slice(0, 32);

  // Initialize CloudKit JS container for the signed-in player's privateCloudDatabase
  getConfiguredCloudKitDatabase(cfg);

  const session: AppleCloudSession = {
    userId: sub,
    displayName,
    email,
    expiresAt: Date.now() + 3600 * 1000,
    transport: 'cloudkit_js',
    identityToken: idToken,
  };
  saveCachedAppleSession(session);
  return session;
}

/**
 * Client-direct Apple CloudKit `privateCloudDatabase` / iOS `CapyIOS` bridge adapter ($0 server cost).
 */
export class AppleCloudKitClient {
  constructor(private readonly session: AppleCloudSession) {}

  async readStringRecord(recordName: string): Promise<string | null> {
    if (!isValidCloudKitRecordName(recordName)) return null;

    if (this.session.transport === 'mock') {
      return mockAppleRecordStore.get(recordName) ?? null;
    }

    if (this.session.transport === 'ios_native_bridge') {
      const res = await requestNativeIosCloudAction<{ value?: string | null }>('readRecord', {
        recordName,
      });
      return typeof res?.value === 'string' && res.value.length > 0 ? res.value : null;
    }

    const db = getConfiguredCloudKitDatabase(getConfiguredAppleCloudConfig());
    const result = await db.fetchRecords([recordName]);
    const rec = result.records?.[0];
    const val = rec?.fields?.payload?.value;
    return typeof val === 'string' && val.length > 0 ? val : null;
  }

  async writeStringRecord(recordName: string, payload: string): Promise<boolean> {
    if (!isValidCloudKitRecordName(recordName)) return false;

    if (this.session.transport === 'mock') {
      mockAppleRecordStore.set(recordName, payload);
      return true;
    }

    if (this.session.transport === 'ios_native_bridge') {
      const res = await requestNativeIosCloudAction<{ ok?: boolean }>('writeRecord', {
        recordName,
        payload,
      });
      return Boolean(res?.ok);
    }

    const db = getConfiguredCloudKitDatabase(getConfiguredAppleCloudConfig());
    let recordChangeTag: string | undefined;
    try {
      const existing = await db.fetchRecords([recordName]);
      recordChangeTag = existing.records?.[0]?.recordChangeTag;
    } catch {
      // Treat as new record
    }
    const saveRes = await db.saveRecords([
      {
        recordType: APPLE_CLOUDKIT_RECORD_TYPE,
        recordName,
        ...(recordChangeTag ? { recordChangeTag } : {}),
        fields: {
          payload: { value: payload },
          updatedAt: { value: Date.now() },
        },
      },
    ]);
    return Boolean(saveRes.records && saveRes.records.length > 0);
  }

  async readJsonRecord<T>(recordName: string): Promise<T | null> {
    const raw = await this.readStringRecord(recordName);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async writeJsonRecord(recordName: string, payload: unknown): Promise<boolean> {
    return this.writeStringRecord(recordName, JSON.stringify(payload));
  }

  async readBinaryRecord(recordName: string): Promise<Uint8Array | null> {
    const raw = await this.readStringRecord(recordName);
    if (!raw) return null;
    try {
      return base64ToUint8(raw);
    } catch {
      return null;
    }
  }

  async writeBinaryRecord(recordName: string, bytes: Uint8Array): Promise<string | null> {
    const ok = await this.writeStringRecord(recordName, uint8ToBase64(bytes));
    return ok ? recordName : null;
  }
}
