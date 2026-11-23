import { GeneratorConfig, PuzzleData } from '../types';
import { AutoPuzzleGenerator } from './PuzzleGenerator';

export interface SerializedWorkerRegion {
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
  pixelsOffset: number;
  pixelsLength: number;
}

export interface SerializedWorkerPuzzleData {
  width: number;
  height: number;
  palette: PuzzleData['palette'];
  regionMap: ArrayBuffer;
  borderMap: ArrayBuffer;
  packedPixelsBuffer: ArrayBuffer;
  regions: SerializedWorkerRegion[];
  isFreeColor?: boolean;
}

/**
 * Packs all region pixel arrays into a single contiguous Int32Array buffer so worker IPC
 * transfers 3 ArrayBuffers total (regionMap, borderMap, packedPixelsBuffer) instead of
 * hundreds or thousands of individual per-region transferables.
 */
export function packPuzzleForTransfer(puzzleData: PuzzleData): {
  payload: SerializedWorkerPuzzleData;
  transferList: Transferable[];
} {
  let totalRegionPixels = 0;
  for (let i = 0; i < puzzleData.regions.length; i++) {
    totalRegionPixels += puzzleData.regions[i].pixels.length;
  }

  const packedPixels = new Int32Array(totalRegionPixels);
  let offset = 0;
  const serializedRegions: SerializedWorkerRegion[] = puzzleData.regions.map((r) => {
    const len = r.pixels.length;
    packedPixels.set(r.pixels, offset);
    const regionOffset = offset;
    offset += len;
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
      pixelsOffset: regionOffset,
      pixelsLength: len,
    };
  });

  const regionMapBuffer: ArrayBuffer =
    puzzleData.regionMap.buffer instanceof ArrayBuffer &&
    puzzleData.regionMap.byteOffset === 0 &&
    puzzleData.regionMap.byteLength === puzzleData.regionMap.buffer.byteLength
      ? puzzleData.regionMap.buffer
      : puzzleData.regionMap.slice().buffer;

  const borderMapBuffer: ArrayBuffer =
    puzzleData.borderMap.buffer instanceof ArrayBuffer &&
    puzzleData.borderMap.byteOffset === 0 &&
    puzzleData.borderMap.byteLength === puzzleData.borderMap.buffer.byteLength
      ? puzzleData.borderMap.buffer
      : puzzleData.borderMap.slice().buffer;

  const packedPixelsBuffer: ArrayBuffer = packedPixels.buffer;

  const transferList: Transferable[] = [
    regionMapBuffer,
    borderMapBuffer,
    packedPixelsBuffer,
  ];

  return {
    payload: {
      width: puzzleData.width,
      height: puzzleData.height,
      palette: puzzleData.palette,
      regionMap: regionMapBuffer,
      borderMap: borderMapBuffer,
      packedPixelsBuffer,
      regions: serializedRegions,
      isFreeColor: puzzleData.isFreeColor,
    },
    transferList,
  };
}

let currentDetailedProgress = false;

if (typeof self !== 'undefined') {
  self.onmessage = (e: MessageEvent) => {
    const { type, id, width, height, rgbaBuffer, config, detailedProgress } = e.data;

    if (type === 'SET_DETAILED_PROGRESS') {
      currentDetailedProgress = Boolean(e.data.detailed);
      return;
    }

    if (type === 'GENERATE') {
      try {
        currentDetailedProgress = Boolean(detailedProgress);
        const rgbaData = new Uint8ClampedArray(rgbaBuffer);
        const generator = new AutoPuzzleGenerator();

        let lastProgressTime = 0;
        let lastProgressValue = 0;

        const puzzleData = generator.generateFromRgba(
          rgbaData,
          width,
          height,
          config as GeneratorConfig,
          (progress, status, payload) => {
            const now = performance.now();
            if (!currentDetailedProgress) {
              const timeDiff = now - lastProgressTime;
              const progDiff = progress - lastProgressValue;
              // In fast simple mode: throttle progress messages to avoid IPC serialization overhead
              // and eliminate main-thread re-render thrashing
              if (timeDiff < 150 && progDiff < 0.1 && progress < 0.99) {
                return;
              }
            }
            lastProgressTime = now;
            lastProgressValue = progress;

            self.postMessage({
              type: 'PROGRESS',
              id,
              progress,
              status: currentDetailedProgress ? status : 'Generating puzzle...',
              payload: currentDetailedProgress ? payload : undefined,
            });
          },
          currentDetailedProgress
        );

        const { payload, transferList } = packPuzzleForTransfer(puzzleData);

        const workerPostMessage = postMessage as unknown as (
          message: unknown,
          transfer: Transferable[]
        ) => void;

        workerPostMessage(
          {
            type: 'SUCCESS',
            id,
            puzzleData: payload,
          },
          transferList
        );
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        self.postMessage({
          type: 'ERROR',
          id,
          error: errorMsg,
        });
      }
    }
  };
}
