/**
 * Zero-allocation ring buffer for rendering live collaborator paint ripples on `PuzzleCanvas`
 * at 60-120fps without triggering React state reconciliation or per-frame heap allocations.
 */
export const MAX_COOP_RIPPLES = 16;
export const COOP_RIPPLE_DURATION_MS = 650;

export class CoopRippleBuffer {
  /** Artwork-space centroid X per slot */
  readonly x = new Float32Array(MAX_COOP_RIPPLES);
  /** Artwork-space centroid Y per slot */
  readonly y = new Float32Array(MAX_COOP_RIPPLES);
  /** `performance.now()` timestamp when the ripple was spawned (`0` = inactive) */
  readonly startTimeMs = new Float64Array(MAX_COOP_RIPPLES);
  /** Pre-formatted CSS hex stroke colors (`#rrggbb`) per slot */
  readonly strokeHex: string[] = new Array<string>(MAX_COOP_RIPPLES).fill('#38bdf8');

  private writeCursor = 0;
  private onWakeCanvas: (() => void) | null = null;

  setWakeCallback(cb: (() => void) | null): void {
    this.onWakeCanvas = cb;
  }

  spawn(artworkX: number, artworkY: number, colorHex: string): void {
    const idx = this.writeCursor;
    this.writeCursor = (this.writeCursor + 1) % MAX_COOP_RIPPLES;
    this.x[idx] = artworkX;
    this.y[idx] = artworkY;
    this.startTimeMs[idx] = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.strokeHex[idx] = colorHex || '#38bdf8';
    this.onWakeCanvas?.();
  }

  hasActiveRipples(nowMs: number): boolean {
    for (let i = 0; i < MAX_COOP_RIPPLES; i++) {
      const start = this.startTimeMs[i];
      if (start > 0 && nowMs - start < COOP_RIPPLE_DURATION_MS) {
        return true;
      }
    }
    return false;
  }

  clear(): void {
    this.startTimeMs.fill(0);
  }
}

/**
 * Zero-allocation typed-array ring buffer for 180ms radial region fill blooms (`TASK-2.4a`)
 * and 400ms completed-swatch centroid shimmer waves (`TASK-2.4b`).
 * Sleeps at 0% idle CPU once all active animation windows expire.
 */
export const MAX_FILL_BLOOMS = 64;
export const FILL_BLOOM_DURATION_MS = 180;
export const SWATCH_SHIMMER_DURATION_MS = 400;
export const BLOOM_KIND_FILL = 0;
export const BLOOM_KIND_SWATCH_SHIMMER = 1;

export class FillBloomBuffer {
  /** Artwork-space centroid X per slot */
  readonly x = new Float32Array(MAX_FILL_BLOOMS);
  /** Artwork-space centroid Y per slot */
  readonly y = new Float32Array(MAX_FILL_BLOOMS);
  /** Artwork-space bounding radius per slot */
  readonly maxRadius = new Float32Array(MAX_FILL_BLOOMS);
  /** `performance.now()` timestamp when spawned (`0` = inactive) */
  readonly startTimeMs = new Float64Array(MAX_FILL_BLOOMS);
  /** `BLOOM_KIND_FILL` (`0`) or `BLOOM_KIND_SWATCH_SHIMMER` (`1`) */
  readonly kind = new Int32Array(MAX_FILL_BLOOMS);
  /** Pre-formatted CSS `#rrggbb` color strings per slot (zero per-frame string formatting) */
  readonly colorHex: string[] = new Array<string>(MAX_FILL_BLOOMS).fill('#38bdf8');

  private writeCursor = 0;
  private onWakeCanvas: (() => void) | null = null;

  setWakeCallback(cb: (() => void) | null): void {
    this.onWakeCanvas = cb;
  }

  private pushSlot(
    artworkX: number,
    artworkY: number,
    radius: number,
    slotKind: number,
    hex: string,
    nowMsOverride?: number
  ): void {
    const idx = this.writeCursor;
    this.writeCursor = (this.writeCursor + 1) % MAX_FILL_BLOOMS;
    this.x[idx] = artworkX;
    this.y[idx] = artworkY;
    this.maxRadius[idx] = Math.max(4, radius);
    const now =
      typeof nowMsOverride === 'number'
        ? nowMsOverride
        : typeof performance !== 'undefined'
          ? performance.now()
          : Date.now();
    this.startTimeMs[idx] = now > 0 ? now : 1;
    this.kind[idx] = slotKind;
    this.colorHex[idx] = hex || '#38bdf8';
  }

  spawnFillBloom(
    artworkX: number,
    artworkY: number,
    radius: number,
    colorHex: string,
    nowMsOverride?: number
  ): void {
    this.pushSlot(artworkX, artworkY, radius, BLOOM_KIND_FILL, colorHex, nowMsOverride);
    this.onWakeCanvas?.();
  }

  spawnSwatchShimmer(
    artworkX: number,
    artworkY: number,
    radius: number,
    colorHex: string,
    nowMsOverride?: number
  ): void {
    this.pushSlot(artworkX, artworkY, radius, BLOOM_KIND_SWATCH_SHIMMER, colorHex, nowMsOverride);
    this.onWakeCanvas?.();
  }

  hasActiveAnimations(nowMs: number): boolean {
    let anyActive = false;
    for (let i = 0; i < MAX_FILL_BLOOMS; i++) {
      const start = this.startTimeMs[i];
      if (start <= 0) continue;
      const duration =
        this.kind[i] === BLOOM_KIND_SWATCH_SHIMMER
          ? SWATCH_SHIMMER_DURATION_MS
          : FILL_BLOOM_DURATION_MS;
      const age = nowMs - start;
      if (age >= 0 && age < duration) {
        anyActive = true;
      } else {
        this.startTimeMs[i] = 0;
      }
    }
    return anyActive;
  }

  clear(): void {
    this.startTimeMs.fill(0);
  }
}

