import { GenerationProgressPayload, GeneratorConfig, PuzzleData } from '../types';

export interface WorkerPuzzlePayload {
  width: number;
  height: number;
  palette: PuzzleData['palette'];
  regionMap: ArrayBuffer;
  borderMap: ArrayBuffer;
  packedPixelsBuffer?: ArrayBuffer;
  regions: Array<{
    id: number;
    colorId: number;
    centroidX: number;
    centroidY: number;
    area: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    maxRadius: number;
    pixelsOffset?: number;
    pixelsLength?: number;
    pixelsBuffer?: ArrayBuffer;
  }>;
  isFreeColor?: boolean;
}

/**
 * Reconstructs PuzzleData from the worker's single contiguous packedPixelsBuffer
 * using zero-copy Int32Array.subarray views (with legacy per-region pixelsBuffer fallback).
 */
export function unpackPuzzleFromWorker(pd: WorkerPuzzlePayload): PuzzleData {
  const packedPixels = pd.packedPixelsBuffer ? new Int32Array(pd.packedPixelsBuffer) : null;
  const reconstitutedRegions = pd.regions.map((r) => {
    let pixels: Int32Array;
    if (packedPixels && typeof r.pixelsOffset === 'number' && typeof r.pixelsLength === 'number') {
      pixels = packedPixels.subarray(r.pixelsOffset, r.pixelsOffset + r.pixelsLength);
    } else if (r.pixelsBuffer) {
      pixels = new Int32Array(r.pixelsBuffer);
    } else {
      pixels = new Int32Array(0);
    }

    return {
      id: r.id,
      colorId: r.colorId,
      centroidX: r.centroidX,
      centroidY: r.centroidY,
      area: r.area,
      minX: r.minX,
      maxX: r.maxX,
      minY: r.minY,
      maxY: r.maxY,
      maxRadius: r.maxRadius,
      pixels,
    };
  });

  return {
    width: pd.width,
    height: pd.height,
    palette: pd.palette,
    regions: reconstitutedRegions,
    regionMap: new Int32Array(pd.regionMap),
    borderMap: new Uint8Array(pd.borderMap),
    isFreeColor: pd.isFreeColor,
  };
}

export class GenerationCancelledError extends Error {
  constructor(message = 'Generation cancelled by newer request') {
    super(message);
    this.name = 'GenerationCancelledError';
  }
}

export class PuzzleWorkerService {
  static idleTerminateMs = 15_000;

  private static worker: Worker | null = null;
  private static activeReject: ((reason?: unknown) => void) | null = null;
  private static idleTerminateTimer: ReturnType<typeof setTimeout> | null = null;
  private static visibilityCleanup: (() => void) | null = null;

  private static clearIdleTerminationTimer(): void {
    if (this.idleTerminateTimer !== null) {
      clearTimeout(this.idleTerminateTimer);
      this.idleTerminateTimer = null;
    }
  }

  private static detachVisibilityCleanup(): void {
    if (this.visibilityCleanup) {
      this.visibilityCleanup();
      this.visibilityCleanup = null;
    }
  }

  private static attachVisibilityCleanup(): void {
    if (this.visibilityCleanup) return;
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
      return;
    }
    const handleVisibilityChange = () => {
      if (document.hidden) {
        this.terminateIdleWorker();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    this.visibilityCleanup = () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }

  private static disposeWorker(): void {
    this.clearIdleTerminationTimer();
    this.detachVisibilityCleanup();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  /**
   * Terminates the cached Web Worker only when no generation is in flight.
   * Returns true if an idle worker was terminated.
   */
  static terminateIdleWorker(): boolean {
    if (this.activeReject || !this.worker) {
      return false;
    }
    this.disposeWorker();
    return true;
  }

  private static scheduleIdleTermination(): void {
    this.clearIdleTerminationTimer();
    if (this.activeReject || !this.worker) return;
    if (typeof document !== 'undefined' && document.hidden) {
      this.terminateIdleWorker();
      return;
    }
    const delayMs = Math.max(0, this.idleTerminateMs);
    this.idleTerminateTimer = setTimeout(() => {
      this.idleTerminateTimer = null;
      this.terminateIdleWorker();
    }, delayMs);
    if (
      typeof this.idleTerminateTimer === 'object' &&
      this.idleTerminateTimer !== null &&
      typeof (this.idleTerminateTimer as { unref?: () => void }).unref === 'function'
    ) {
      (this.idleTerminateTimer as { unref: () => void }).unref();
    }
  }

  private static async generateOnMainThreadFallback(
    sourceCanvas: HTMLCanvasElement,
    config: GeneratorConfig,
    onProgress?: (progress: number, status: string, payload?: GenerationProgressPayload) => void,
    detailedProgress: boolean = false
  ): Promise<PuzzleData> {
    const { AutoPuzzleGenerator } = await import('../engine/PuzzleGenerator');
    const generator = new AutoPuzzleGenerator();
    return generator.generate(sourceCanvas, config, onProgress, detailedProgress);
  }

  private static getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../engine/puzzle.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.attachVisibilityCleanup();
    }
    return this.worker;
  }

  /**
   * Cancels any active worker generation and cleans up resources.
   */
  static cancelActive(): void {
    if (this.activeReject) {
      const oldReject = this.activeReject;
      this.activeReject = null;
      oldReject(new GenerationCancelledError());
    }
    this.disposeWorker();
  }

  /**
   * Generates puzzle data in a background Web Worker thread to keep the UI
   * and browser 100% responsive without frame drops or freezes.
   */
  static generate(
    sourceCanvas: HTMLCanvasElement,
    config: GeneratorConfig,
    onProgress?: (progress: number, status: string, payload?: GenerationProgressPayload) => void,
    detailedProgress: boolean = false
  ): Promise<PuzzleData> {
    return new Promise((resolve, reject) => {
      // If Web Worker is not supported, fallback to lazy main-thread execution
      if (typeof Worker === 'undefined') {
        this.generateOnMainThreadFallback(sourceCanvas, config, onProgress, detailedProgress).then(
          resolve,
          reject
        );
        return;
      }

      try {
        const width = sourceCanvas.width;
        const height = sourceCanvas.height;
        const ctx =
          sourceCanvas.getContext('2d', { willReadFrequently: true }) ||
          sourceCanvas.getContext('2d')!;
        const imgData = ctx.getImageData(0, 0, width, height);
        const rgbaBuffer = imgData.data.buffer;

        // Cancel previous pending task if any and terminate busy worker to free CPU immediately
        this.cancelActive();

        const worker = this.getWorker();
        const requestId = `gen_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        this.activeReject = reject;

        const handleMessage = (e: MessageEvent) => {
          const data = e.data;
          if (!data || data.id !== requestId) return;

          if (data.type === 'PROGRESS') {
            onProgress?.(data.progress, data.status, data.payload);
          } else if (data.type === 'SUCCESS') {
            worker.removeEventListener('message', handleMessage);
            worker.removeEventListener('error', handleError);
            this.activeReject = null;
            this.scheduleIdleTermination();

            const puzzleData = unpackPuzzleFromWorker(data.puzzleData as WorkerPuzzlePayload);
            resolve(puzzleData);
          } else if (data.type === 'ERROR') {
            worker.removeEventListener('message', handleMessage);
            worker.removeEventListener('error', handleError);
            this.activeReject = null;
            this.scheduleIdleTermination();
            reject(new Error(data.error || 'Worker generation failed'));
          }
        };

        const handleError = (err: ErrorEvent) => {
          worker.removeEventListener('message', handleMessage);
          worker.removeEventListener('error', handleError);
          this.activeReject = null;
          // Clean up worker
          this.disposeWorker();
          // Fallback to lazy main-thread execution
          console.warn('Worker error encountered, falling back to local thread:', err);
          this.generateOnMainThreadFallback(sourceCanvas, config, onProgress, detailedProgress).then(
            resolve,
            reject
          );
        };

        worker.addEventListener('message', handleMessage);
        worker.addEventListener('error', handleError);

        // Send task to worker with zero-copy buffer transfer
        worker.postMessage(
          {
            type: 'GENERATE',
            id: requestId,
            width,
            height,
            rgbaBuffer,
            config,
            detailedProgress,
          },
          [rgbaBuffer]
        );
      } catch (err) {
        console.warn('Failed to dispatch worker task, falling back to local:', err);
        this.generateOnMainThreadFallback(sourceCanvas, config, onProgress, detailedProgress).then(
          resolve,
          reject
        );
      }
    });
  }

  /**
   * Dynamically toggles detailed progress reporting on the active worker.
   */
  static setDetailedProgress(detailed: boolean): void {
    if (this.worker) {
      this.worker.postMessage({
        type: 'SET_DETAILED_PROGRESS',
        detailed,
      });
    }
  }
}
