import { GenerationProgressPayload, GeneratorConfig, PaletteColor, PuzzleData } from '../types';
import {
  DEFAULT_ZOOM_IN_TARGET_REGIONS,
  MAX_SUBDIVIDE_TARGET_REGIONS,
  type MaskedSubdivisionResult,
  type SubdivideMaskedRegionParams,
} from '../engine/MaskedRegionSubdivider';

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

export interface WorkerSubdivisionPayload {
  width: number;
  height: number;
  localRegionMap: ArrayBuffer;
  packedPixelsBuffer?: ArrayBuffer;
  regions: WorkerPuzzlePayload['regions'];
  palette: PaletteColor[];
  addedSwatches: PaletteColor[];
}

export function unpackSubdivisionFromWorker(
  pd: WorkerSubdivisionPayload
): MaskedSubdivisionResult {
  const packedPixels = pd.packedPixelsBuffer ? new Int32Array(pd.packedPixelsBuffer) : null;
  const regions = pd.regions.map((r) => {
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
    localRegionMap: new Int32Array(pd.localRegionMap),
    regions,
    palette: pd.palette,
    addedSwatches: pd.addedSwatches,
  };
}

export class GenerationCancelledError extends Error {
  constructor(message = 'Generation cancelled by newer request') {
    super(message);
    this.name = 'GenerationCancelledError';
  }
}

export class PuzzleWorkerService {
  private static worker: Worker | null = null;
  private static activeReject: ((reason?: unknown) => void) | null = null;
  private static activeCancelCleanup: (() => void) | null = null;

  private static async generateOnMainThreadFallback(
    sourceCanvas: HTMLCanvasElement,
    config: GeneratorConfig,
    onProgress?: (progress: number, status: string, payload?: GenerationProgressPayload) => void,
    detailedProgress: boolean = false,
    isCancelled?: () => boolean
  ): Promise<PuzzleData> {
    const { AutoPuzzleGenerator } = await import('../engine/PuzzleGenerator');
    if (isCancelled?.()) {
      throw new GenerationCancelledError();
    }
    const generator = new AutoPuzzleGenerator();
    return generator.generate(sourceCanvas, config, onProgress, detailedProgress);
  }

  private static normalizeTargetSubRegions(targetSubRegions?: number): number | undefined {
    if (targetSubRegions === undefined) return undefined;
    const finite = Number.isFinite(targetSubRegions)
      ? targetSubRegions
      : DEFAULT_ZOOM_IN_TARGET_REGIONS;
    return Math.max(1, Math.min(MAX_SUBDIVIDE_TARGET_REGIONS, Math.floor(finite)));
  }

  private static async subdivideOnMainThreadFallback(
    params: SubdivideMaskedRegionParams,
    onProgress?: (progress: number, status: string) => void,
    isCancelled?: () => boolean
  ): Promise<MaskedSubdivisionResult> {
    const { subdivideMaskedRegion } = await import('../engine/MaskedRegionSubdivider');
    if (isCancelled?.()) {
      throw new GenerationCancelledError();
    }
    return subdivideMaskedRegion({
      ...params,
      targetSubRegions: this.normalizeTargetSubRegions(params.targetSubRegions),
      onProgress: onProgress ?? params.onProgress,
    });
  }

  private static getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../engine/puzzle.worker.ts', import.meta.url), {
        type: 'module',
      });
    }
    return this.worker;
  }

  /**
   * Cancels any active worker generation and cleans up resources.
   */
  static cancelActive(): void {
    const cleanup = this.activeCancelCleanup;
    this.activeCancelCleanup = null;
    if (cleanup) {
      cleanup();
    }
    if (this.activeReject) {
      const oldReject = this.activeReject;
      this.activeReject = null;
      oldReject(new GenerationCancelledError());
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
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

      let cancelled = false;
      let activeWorker: Worker | null = null;
      let onMsg: ((e: MessageEvent) => void) | null = null;
      let onErr: ((err: ErrorEvent) => void) | null = null;
      const cleanupListeners = () => {
        if (activeWorker && onMsg) activeWorker.removeEventListener('message', onMsg);
        if (activeWorker && onErr) activeWorker.removeEventListener('error', onErr);
      };
      const markCancelled = () => {
        cancelled = true;
        cleanupListeners();
      };

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
        activeWorker = worker;
        const requestId = `gen_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        this.activeReject = reject;
        this.activeCancelCleanup = markCancelled;

        const clearActiveHooks = () => {
          if (this.activeCancelCleanup === markCancelled) {
            this.activeCancelCleanup = null;
          }
          if (this.activeReject === reject) {
            this.activeReject = null;
          }
        };
        const runFallback = () => {
          this.activeReject = reject;
          this.activeCancelCleanup = markCancelled;
          const guardedProgress = onProgress
            ? (p: number, s: string, payload?: GenerationProgressPayload) => {
                if (!cancelled) onProgress(p, s, payload);
              }
            : undefined;
          this.generateOnMainThreadFallback(
            sourceCanvas,
            config,
            guardedProgress,
            detailedProgress,
            () => cancelled
          ).then(
            (result) => {
              clearActiveHooks();
              if (cancelled) return;
              resolve(result);
            },
            (fallbackErr) => {
              clearActiveHooks();
              if (cancelled) return;
              reject(fallbackErr);
            }
          );
        };

        const handleMessage = (e: MessageEvent) => {
          if (cancelled) return;
          const data = e.data;
          if (!data || data.id !== requestId) return;

          if (data.type === 'PROGRESS') {
            onProgress?.(data.progress, data.status, data.payload);
          } else if (data.type === 'SUCCESS') {
            cleanupListeners();
            clearActiveHooks();

            const puzzleData = unpackPuzzleFromWorker(data.puzzleData as WorkerPuzzlePayload);
            resolve(puzzleData);
          } else if (data.type === 'ERROR') {
            cleanupListeners();
            clearActiveHooks();
            reject(new Error(data.error || 'Worker generation failed'));
          }
        };

        const handleError = (err: ErrorEvent) => {
          if (cancelled) return;
          cleanupListeners();
          // Clean up worker
          worker.terminate();
          if (this.worker === worker) {
            this.worker = null;
          }
          // Fallback to lazy main-thread execution while retaining cancellation hooks
          console.warn('Worker error encountered, falling back to local thread:', err);
          runFallback();
        };

        onMsg = handleMessage;
        onErr = handleError;
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
        cleanupListeners();
        if (cancelled) {
          if (this.activeCancelCleanup === markCancelled) {
            this.activeCancelCleanup = null;
          }
          if (this.activeReject === reject) {
            this.activeReject = null;
          }
          return;
        }
        console.warn('Failed to dispatch worker task, falling back to local:', err);
        this.activeReject = reject;
        this.activeCancelCleanup = markCancelled;
        const guardedProgress = onProgress
          ? (p: number, s: string, payload?: GenerationProgressPayload) => {
              if (!cancelled) onProgress(p, s, payload);
            }
          : undefined;
        this.generateOnMainThreadFallback(
          sourceCanvas,
          config,
          guardedProgress,
          detailedProgress,
          () => cancelled
        ).then(
          (result) => {
            if (this.activeCancelCleanup === markCancelled) this.activeCancelCleanup = null;
            if (this.activeReject === reject) this.activeReject = null;
            if (cancelled) return;
            resolve(result);
          },
          (fallbackErr) => {
            if (this.activeCancelCleanup === markCancelled) this.activeCancelCleanup = null;
            if (this.activeReject === reject) this.activeReject = null;
            if (cancelled) return;
            reject(fallbackErr);
          }
        );
      }
    });
  }

  /**
   * Subdivides a masked region off-thread using the puzzle Web Worker, copying caller
   * TypedArrays prior to transfer so main-thread fallback remains intact on worker error.
   */
  static subdivideMaskedRegion(
    params: Omit<SubdivideMaskedRegionParams, 'onProgress'> & {
      onProgress?: (progress: number, status: string) => void;
    },
    onProgress?: (progress: number, status: string) => void
  ): Promise<MaskedSubdivisionResult> {
    const effectiveOnProgress = onProgress ?? params.onProgress;
    return new Promise((resolve, reject) => {
      if (typeof Worker === 'undefined') {
        this.subdivideOnMainThreadFallback(params, effectiveOnProgress).then(resolve, reject);
        return;
      }

      let cancelled = false;
      let activeWorker: Worker | null = null;
      let onMsg: ((e: MessageEvent) => void) | null = null;
      let onErr: ((err: ErrorEvent) => void) | null = null;
      const cleanupListeners = () => {
        if (activeWorker && onMsg) activeWorker.removeEventListener('message', onMsg);
        if (activeWorker && onErr) activeWorker.removeEventListener('error', onErr);
      };
      const markCancelled = () => {
        cancelled = true;
        cleanupListeners();
      };
      try {
        this.cancelActive();
        const worker = this.getWorker();
        activeWorker = worker;
        const requestId = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        this.activeReject = reject;
        this.activeCancelCleanup = markCancelled;

        const clearActiveHooks = () => {
          if (this.activeCancelCleanup === markCancelled) {
            this.activeCancelCleanup = null;
          }
          if (this.activeReject === reject) {
            this.activeReject = null;
          }
        };
        const runFallback = () => {
          this.activeReject = reject;
          this.activeCancelCleanup = markCancelled;
          const guardedProgress = effectiveOnProgress
            ? (p: number, s: string) => {
                if (!cancelled) effectiveOnProgress(p, s);
              }
            : undefined;
          this.subdivideOnMainThreadFallback(params, guardedProgress, () => cancelled).then(
            (result) => {
              clearActiveHooks();
              if (cancelled) return;
              resolve(result);
            },
            (fallbackErr) => {
              clearActiveHooks();
              if (cancelled) return;
              reject(fallbackErr);
            }
          );
        };

        const handleMessage = (e: MessageEvent) => {
          if (cancelled) return;
          const data = e.data;
          if (!data || data.id !== requestId) return;

          if (data.type === 'PROGRESS') {
            effectiveOnProgress?.(data.progress, data.status);
          } else if (data.type === 'SUBDIVIDE_SUCCESS') {
            cleanupListeners();
            clearActiveHooks();
            resolve(unpackSubdivisionFromWorker(data.result as WorkerSubdivisionPayload));
          } else if (data.type === 'ERROR') {
            cleanupListeners();
            clearActiveHooks();
            reject(new Error(data.error || 'Worker masked subdivision failed'));
          }
        };

        const handleError = (err: ErrorEvent) => {
          if (cancelled) return;
          cleanupListeners();
          worker.terminate();
          if (this.worker === worker) {
            this.worker = null;
          }
          console.warn('Worker error during masked subdivision, falling back to local thread:', err);
          runFallback();
        };

        onMsg = handleMessage;
        onErr = handleError;
        worker.addEventListener('message', handleMessage);
        worker.addEventListener('error', handleError);

        const rgbaCopy = params.rgbaData.slice();
        const maskCopy = params.cropMask.slice();

        worker.postMessage(
          {
            type: 'SUBDIVIDE_MASKED_REGION',
            id: requestId,
            cropWidth: params.cropWidth,
            cropHeight: params.cropHeight,
            rgbaBuffer: rgbaCopy.buffer,
            cropMaskBuffer: maskCopy.buffer,
            existingPalette: params.existingPalette,
            isFreeColor: params.isFreeColor,
            targetSubRegions: this.normalizeTargetSubRegions(params.targetSubRegions),
            minRegionArea: params.minRegionArea,
            maxNewSwatches: params.maxNewSwatches,
            reuseDeltaE: params.reuseDeltaE,
            generatorConfig: params.generatorConfig,
          },
          [rgbaCopy.buffer, maskCopy.buffer]
        );
      } catch (err) {
        cleanupListeners();
        if (cancelled) {
          if (this.activeCancelCleanup === markCancelled) {
            this.activeCancelCleanup = null;
          }
          if (this.activeReject === reject) {
            this.activeReject = null;
          }
          return;
        }
        console.warn('Failed to dispatch masked subdivision task, falling back to local:', err);
        this.activeReject = reject;
        this.activeCancelCleanup = markCancelled;
        const guardedProgress = effectiveOnProgress
          ? (p: number, s: string) => {
              if (!cancelled) effectiveOnProgress(p, s);
            }
          : undefined;
        this.subdivideOnMainThreadFallback(params, guardedProgress, () => cancelled).then(
          (result) => {
            if (this.activeCancelCleanup === markCancelled) this.activeCancelCleanup = null;
            if (this.activeReject === reject) this.activeReject = null;
            if (cancelled) return;
            resolve(result);
          },
          (fallbackErr) => {
            if (this.activeCancelCleanup === markCancelled) this.activeCancelCleanup = null;
            if (this.activeReject === reject) this.activeReject = null;
            if (cancelled) return;
            reject(fallbackErr);
          }
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
