/**
 * Manifest snapshot slot filter and coalesced trailing-pass runner for Cloud Sync.
 */

export function isManifestCloudSnapshotSlot(slotKey: string): boolean {
  return (
    typeof slotKey === 'string' &&
    slotKey.length > 0 &&
    !slotKey.startsWith('pgblob_') &&
    !/_part_\d+$/.test(slotKey)
  );
}

export interface CoalescedSyncController<T> {
  run: (executePass: () => Promise<T | null>) => Promise<T | null>;
  requestTrailingPass: () => void;
  isInFlight: () => boolean;
}

/**
 * Coalesces overlapping cloud sync triggers into a single active promise plus at most
 * one queued trailing pass whenever overlapping triggers or mid-sync dirty signals occur.
 */
export function createCoalescedSyncController<T>(): CoalescedSyncController<T> {
  let inFlightPromise: Promise<T | null> | null = null;
  let queued = false;
  let nextPassExecutor: (() => Promise<T | null>) | null = null;

  return {
    run(executePass: () => Promise<T | null>): Promise<T | null> {
      nextPassExecutor = executePass;
      if (inFlightPromise) {
        queued = true;
        return inFlightPromise;
      }

      const syncPromise = (async () => {
        await Promise.resolve();
        let latestSummary: T | null = null;
        try {
          do {
            queued = false;
            const currentPass = nextPassExecutor;
            if (!currentPass) break;
            latestSummary = await currentPass();
          } while (queued);
        } finally {
          inFlightPromise = null;
          queued = false;
          nextPassExecutor = null;
        }
        return latestSummary;
      })();

      inFlightPromise = syncPromise;
      return syncPromise;
    },

    requestTrailingPass(): void {
      if (inFlightPromise) {
        queued = true;
      }
    },

    isInFlight(): boolean {
      return inFlightPromise !== null;
    },
  };
}

export interface AutoCloudSyncSchedulerOptions {
  sync: () => Promise<unknown>;
  canSync: () => boolean;
  debounceMs?: number;
  staleVisibilityMs?: number;
  now?: () => number;
  setTimer?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
}

export interface AutoCloudSyncScheduler {
  notifyLocalMutation: () => void;
  notifyVisibilityVisible: () => void;
  notifyOnline: () => void;
  markSynced: (timestamp?: number) => void;
  dispose: () => void;
}

/**
 * Schedules automatic background cloud syncs without overlapping network storms or rAF allocations:
 * - Debounces local save/paint mutations (default 15s) before pushing to BYOC cloud storage.
 * - Pulls + merges when the tab/app becomes visible if stale (default > 30s since last sync).
 * - Immediately syncs when connectivity returns (`online` event).
 * Strictly no-ops whenever `canSync()` returns false (unauthenticated or offline).
 */
export function createAutoCloudSyncScheduler(
  options: AutoCloudSyncSchedulerOptions
): AutoCloudSyncScheduler {
  const debounceMs = options.debounceMs ?? 15_000;
  const staleVisibilityMs = options.staleVisibilityMs ?? 30_000;
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = options.clearTimer ?? ((id) => clearTimeout(id));

  let debounceHandle: ReturnType<typeof setTimeout> | null = null;
  let lastSyncedAt = 0;
  let disposed = false;

  const cancelDebounce = () => {
    if (debounceHandle !== null) {
      clearTimer(debounceHandle);
      debounceHandle = null;
    }
  };

  const triggerSync = () => {
    if (disposed || !options.canSync()) return;
    void Promise.resolve(options.sync())
      .then(() => {
        if (!disposed) {
          lastSyncedAt = now();
        }
      })
      .catch(() => {
        // Sync errors are surfaced through the UI status handler
      });
  };

  return {
    notifyLocalMutation(): void {
      if (disposed || !options.canSync()) return;
      cancelDebounce();
      debounceHandle = setTimer(() => {
        debounceHandle = null;
        triggerSync();
      }, debounceMs);
    },

    notifyVisibilityVisible(): void {
      if (disposed || !options.canSync()) return;
      if (lastSyncedAt === 0 || now() - lastSyncedAt >= staleVisibilityMs) {
        cancelDebounce();
        triggerSync();
      }
    },

    notifyOnline(): void {
      if (disposed || !options.canSync()) return;
      cancelDebounce();
      triggerSync();
    },

    markSynced(timestamp?: number): void {
      lastSyncedAt = timestamp ?? now();
    },

    dispose(): void {
      disposed = true;
      cancelDebounce();
    },
  };
}

