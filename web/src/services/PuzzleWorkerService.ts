import { GenerationProgressPayload, GeneratorConfig, PuzzleData } from '../types';
import { AutoPuzzleGenerator } from '../engine/PuzzleGenerator';

export class GenerationCancelledError extends Error {
  constructor(message = 'Generation cancelled by newer request') {
    super(message);
    this.name = 'GenerationCancelledError';
  }
}

export class PuzzleWorkerService {
  private static worker: Worker | null = null;
  private static activeReject: ((reason?: unknown) => void) | null = null;

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
    onProgress?: (progress: number, status: string, payload?: GenerationProgressPayload) => void
  ): Promise<PuzzleData> {
    return new Promise((resolve, reject) => {
      // If Web Worker is not supported, fallback to main-thread execution
      if (typeof Worker === 'undefined') {
        try {
          const generator = new AutoPuzzleGenerator();
          const result = generator.generate(sourceCanvas, config, onProgress);
          resolve(result);
        } catch (err) {
          reject(err);
        }
        return;
      }

      try {
        const width = sourceCanvas.width;
        const height = sourceCanvas.height;
        const ctx = sourceCanvas.getContext('2d')!;
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

            const pd = data.puzzleData;
            const reconstitutedRegions = pd.regions.map((r: {
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
              pixelsBuffer: ArrayBuffer;
            }) => ({
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
              pixels: new Int32Array(r.pixelsBuffer),
            }));

            const puzzleData: PuzzleData = {
              width: pd.width,
              height: pd.height,
              palette: pd.palette,
              regions: reconstitutedRegions,
              regionMap: new Int32Array(pd.regionMap),
              borderMap: new Uint8Array(pd.borderMap),
              isFreeColor: pd.isFreeColor,
            };

            resolve(puzzleData);
          } else if (data.type === 'ERROR') {
            worker.removeEventListener('message', handleMessage);
            worker.removeEventListener('error', handleError);
            this.activeReject = null;
            reject(new Error(data.error || 'Worker generation failed'));
          }
        };

        const handleError = (err: ErrorEvent) => {
          worker.removeEventListener('message', handleMessage);
          worker.removeEventListener('error', handleError);
          this.activeReject = null;
          // Clean up worker
          worker.terminate();
          this.worker = null;
          // Fallback to synchronous execution
          console.warn('Worker error encountered, falling back to local thread:', err);
          try {
            const generator = new AutoPuzzleGenerator();
            const fallbackResult = generator.generate(sourceCanvas, config, onProgress);
            resolve(fallbackResult);
          } catch (syncErr) {
            reject(syncErr);
          }
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
          },
          [rgbaBuffer]
        );
      } catch (err) {
        console.warn('Failed to dispatch worker task, falling back to local:', err);
        try {
          const generator = new AutoPuzzleGenerator();
          const fallbackResult = generator.generate(sourceCanvas, config, onProgress);
          resolve(fallbackResult);
        } catch (syncErr) {
          reject(syncErr);
        }
      }
    });
  }
}
