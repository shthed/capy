import { NativeBridge } from './NativeBridge';
import { resolveScopedBackupKey, resolveScopedStorageKey } from './StorageNamespace';

export const PLAYER_STATS_STORAGE_KEY = 'capy_player_stats_v1';

export interface PlayerLifetimeStats {
  totalRegionsColored: number;
  puzzlesCompleted: number;
  zeroHintPuzzles: number;
  fastestCompletionMs: number | null;
  freeColorCreations: number;
  coopRegionsPainted: number;
}

export const DEFAULT_PLAYER_STATS: PlayerLifetimeStats = {
  totalRegionsColored: 0,
  puzzlesCompleted: 0,
  zeroHintPuzzles: 0,
  fastestCompletionMs: null,
  freeColorCreations: 0,
  coopRegionsPainted: 0,
};

function clampNonNegInt(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.floor(num);
}

function sanitizeFastestMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.max(1, Math.round(num));
}

export function sanitizePlayerStats(raw: unknown): PlayerLifetimeStats {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_PLAYER_STATS };
  }
  const obj = raw as Record<string, unknown>;
  return {
    totalRegionsColored: clampNonNegInt(obj.totalRegionsColored),
    puzzlesCompleted: clampNonNegInt(obj.puzzlesCompleted),
    zeroHintPuzzles: clampNonNegInt(obj.zeroHintPuzzles),
    fastestCompletionMs: sanitizeFastestMs(obj.fastestCompletionMs),
    freeColorCreations: clampNonNegInt(obj.freeColorCreations),
    coopRegionsPainted: clampNonNegInt(obj.coopRegionsPainted),
  };
}

/**
 * Monotonic CRDT-ready merge of two lifetime stat snapshots:
 * - Counters merge via Math.max (never decrements across offline tabs/devices)
 * - fastestCompletionMs merges via Math.min of non-null positive durations
 */
export function mergeLifetimeStats(
  a: Partial<PlayerLifetimeStats> | null | undefined,
  b: Partial<PlayerLifetimeStats> | null | undefined
): PlayerLifetimeStats {
  const sa = sanitizePlayerStats(a);
  const sb = sanitizePlayerStats(b);

  let fastestCompletionMs: number | null = null;
  if (sa.fastestCompletionMs !== null && sb.fastestCompletionMs !== null) {
    fastestCompletionMs = Math.min(sa.fastestCompletionMs, sb.fastestCompletionMs);
  } else {
    fastestCompletionMs = sa.fastestCompletionMs ?? sb.fastestCompletionMs;
  }

  return {
    totalRegionsColored: Math.max(sa.totalRegionsColored, sb.totalRegionsColored),
    puzzlesCompleted: Math.max(sa.puzzlesCompleted, sb.puzzlesCompleted),
    zeroHintPuzzles: Math.max(sa.zeroHintPuzzles, sb.zeroHintPuzzles),
    fastestCompletionMs,
    freeColorCreations: Math.max(sa.freeColorCreations, sb.freeColorCreations),
    coopRegionsPainted: Math.max(sa.coopRegionsPainted, sb.coopRegionsPainted),
  };
}

export function formatFastestCompletion(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return '--';
  const totalSec = Math.max(1, Math.round(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

export class PlayerStatsService {
  private static memoryFallback: PlayerLifetimeStats = { ...DEFAULT_PLAYER_STATS };

  private static hasLocalStorage(): boolean {
    try {
      return typeof localStorage !== 'undefined' && localStorage !== null;
    } catch {
      return false;
    }
  }

  static loadStats(): PlayerLifetimeStats {
    try {
      if (this.hasLocalStorage()) {
        const raw =
          localStorage.getItem(resolveScopedStorageKey(PLAYER_STATS_STORAGE_KEY)) ||
          NativeBridge.loadBackup(resolveScopedBackupKey(PLAYER_STATS_STORAGE_KEY));
        if (!raw) {
          return { ...DEFAULT_PLAYER_STATS };
        }
        const sanitized = sanitizePlayerStats(JSON.parse(raw));
        this.memoryFallback = sanitized;
        return sanitized;
      }
    } catch {
      // Fall back to SSR / restricted-context memory store
    }
    return { ...this.memoryFallback };
  }

  static saveStats(stats: PlayerLifetimeStats): PlayerLifetimeStats {
    const sanitized = sanitizePlayerStats(stats);
    this.memoryFallback = sanitized;
    try {
      const serialized = JSON.stringify(sanitized);
      if (this.hasLocalStorage()) {
        localStorage.setItem(resolveScopedStorageKey(PLAYER_STATS_STORAGE_KEY), serialized);
      }
      NativeBridge.saveBackup(resolveScopedBackupKey(PLAYER_STATS_STORAGE_KEY), serialized);
    } catch {
      // Keep memoryFallback updated if storage quota or sandbox blocks writes
    }
    return { ...sanitized };
  }

  static resetStats(): PlayerLifetimeStats {
    this.memoryFallback = { ...DEFAULT_PLAYER_STATS };
    try {
      if (this.hasLocalStorage()) {
        localStorage.removeItem(resolveScopedStorageKey(PLAYER_STATS_STORAGE_KEY));
      }
    } catch {
      // Ignored
    }
    return { ...DEFAULT_PLAYER_STATS };
  }

  static recordRegionsColored(
    regionCount: number,
    isCoopConnected: boolean = false
  ): PlayerLifetimeStats {
    const delta = clampNonNegInt(regionCount);
    const current = this.loadStats();
    if (delta <= 0) return current;
    return this.saveStats({
      ...current,
      totalRegionsColored: current.totalRegionsColored + delta,
      coopRegionsPainted: isCoopConnected
        ? current.coopRegionsPainted + delta
        : current.coopRegionsPainted,
    });
  }

  static recordPuzzleCompleted(options: {
    hintsUsed: number;
    activeElapsedMs?: number | null;
  }): PlayerLifetimeStats {
    const current = this.loadStats();
    const hintsUsed = clampNonNegInt(options.hintsUsed);
    const candidateMs = sanitizeFastestMs(options.activeElapsedMs);
    const fastestCompletionMs =
      candidateMs !== null
        ? current.fastestCompletionMs !== null
          ? Math.min(current.fastestCompletionMs, candidateMs)
          : candidateMs
        : current.fastestCompletionMs;

    return this.saveStats({
      ...current,
      puzzlesCompleted: current.puzzlesCompleted + 1,
      zeroHintPuzzles: hintsUsed === 0 ? current.zeroHintPuzzles + 1 : current.zeroHintPuzzles,
      fastestCompletionMs,
    });
  }

  static recordFreeColorCreation(): PlayerLifetimeStats {
    const current = this.loadStats();
    return this.saveStats({
      ...current,
      freeColorCreations: current.freeColorCreations + 1,
    });
  }
}
