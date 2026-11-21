import { reportSwallowed } from '../telemetry';
import { resolveScopedStorageKey } from './StorageKeys';

export interface QuotaWarning {
  reason: 'quota';
  key: string;
  message: string;
}

const quotaListeners = new Set<(warning: QuotaWarning) => void>();
let persistentStorageRequested = false;

export function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const rec = err as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof rec.name === 'string' ? rec.name : '';
  const code = typeof rec.code === 'number' ? rec.code : 0;
  const msg = typeof rec.message === 'string' ? rec.message : '';
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014 ||
    /quota/i.test(msg)
  );
}

export function onQuotaWarning(listener: (warning: QuotaWarning) => void): () => void {
  quotaListeners.add(listener);
  return () => {
    quotaListeners.delete(listener);
  };
}

export function notifyQuotaWarning(key: string): void {
  const warning: QuotaWarning = {
    reason: 'quota',
    key,
    message:
      'Browser storage is full. Export older saves or free space to keep your progress safe.',
  };
  for (const listener of quotaListeners) {
    try {
      listener(warning);
    } catch (err) {
      reportSwallowed('SafeLocalStore.quotaListener', err, { key });
    }
  }
  try {
    if (
      typeof window !== 'undefined' &&
      typeof window.dispatchEvent === 'function' &&
      typeof CustomEvent === 'function'
    ) {
      window.dispatchEvent(new CustomEvent('capy:storage-quota', { detail: warning }));
    }
  } catch (err) {
    reportSwallowed('SafeLocalStore.quotaEvent', err, { key });
  }
}

export function requestPersistentStorageOnce(): void {
  if (persistentStorageRequested) return;
  persistentStorageRequested = true;
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.persist === 'function'
    ) {
      void navigator.storage.persist().catch((err) => {
        reportSwallowed('SafeLocalStore.persist', err);
      });
    }
  } catch (err) {
    reportSwallowed('SafeLocalStore.persistSync', err);
  }
}

export interface SafeLocalWriteOptions {
  notifyQuota?: boolean;
  rethrow?: boolean;
}

export const SafeLocalStore = {
  hasLocalStorage(): boolean {
    try {
      return typeof localStorage !== 'undefined' && localStorage !== null;
    } catch (err) {
      reportSwallowed('SafeLocalStore.hasLocalStorage', err);
      return false;
    }
  },

  getItem(storageKey: string): string | null {
    try {
      if (typeof localStorage === 'undefined' || localStorage === null) return null;
      return localStorage.getItem(storageKey);
    } catch (err) {
      reportSwallowed('SafeLocalStore.getItem', err, { key: storageKey });
      return null;
    }
  },

  setItem(storageKey: string, value: string, options?: SafeLocalWriteOptions): boolean {
    try {
      if (typeof localStorage === 'undefined' || localStorage === null) return false;
      localStorage.setItem(storageKey, value);
      return true;
    } catch (err) {
      if (options?.notifyQuota && isQuotaError(err)) {
        notifyQuotaWarning(storageKey);
      }
      reportSwallowed('SafeLocalStore.setItem', err, { key: storageKey });
      if (options?.rethrow) {
        throw err;
      }
      return false;
    }
  },

  removeItem(storageKey: string, options?: { rethrow?: boolean }): boolean {
    try {
      if (typeof localStorage === 'undefined' || localStorage === null) return false;
      localStorage.removeItem(storageKey);
      return true;
    } catch (err) {
      reportSwallowed('SafeLocalStore.removeItem', err, { key: storageKey });
      if (options?.rethrow) {
        throw err;
      }
      return false;
    }
  },

  getScopedItem(baseKey: string): string | null {
    return this.getItem(resolveScopedStorageKey(baseKey));
  },

  setScopedItem(baseKey: string, value: string, options?: SafeLocalWriteOptions): boolean {
    return this.setItem(resolveScopedStorageKey(baseKey), value, options);
  },

  removeScopedItem(baseKey: string, options?: { rethrow?: boolean }): boolean {
    return this.removeItem(resolveScopedStorageKey(baseKey), options);
  },
};
