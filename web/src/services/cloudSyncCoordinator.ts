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
