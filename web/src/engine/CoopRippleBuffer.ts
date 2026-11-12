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
