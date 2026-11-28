import { GeneratorConfig, PaletteColor, PuzzleData } from '../types';
import {
  MaskedSubdivisionResult,
  subdivideMaskedRegion,
} from './MaskedRegionSubdivider';
import { AutoPuzzleGenerator } from './PuzzleGenerator';
import { MAX_PUZZLE_PIXELS } from './UnifiedPuzzleLayers';

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

export interface SerializedMaskedSubdivisionResult {
  width: number;
  height: number;
  localRegionMap: ArrayBuffer;
  packedPixelsBuffer: ArrayBuffer;
  regions: SerializedWorkerRegion[];
  palette: PaletteColor[];
  addedSwatches: PaletteColor[];
}

export function packSubdivisionForTransfer(result: MaskedSubdivisionResult): {
  payload: SerializedMaskedSubdivisionResult;
  transferList: Transferable[];
} {
  let totalRegionPixels = 0;
  for (let i = 0; i < result.regions.length; i++) {
    totalRegionPixels += result.regions[i].pixels.length;
  }

  const packedPixels = new Int32Array(totalRegionPixels);
  let offset = 0;
  const serializedRegions: SerializedWorkerRegion[] = result.regions.map((r) => {
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

  const localRegionMapBuffer: ArrayBuffer =
    result.localRegionMap.buffer instanceof ArrayBuffer &&
    result.localRegionMap.byteOffset === 0 &&
    result.localRegionMap.byteLength === result.localRegionMap.buffer.byteLength
      ? result.localRegionMap.buffer
      : result.localRegionMap.slice().buffer;

  const packedPixelsBuffer: ArrayBuffer = packedPixels.buffer;
  const transferList: Transferable[] = [localRegionMapBuffer, packedPixelsBuffer];

  return {
    payload: {
      width: result.width,
      height: result.height,
      localRegionMap: localRegionMapBuffer,
      packedPixelsBuffer,
      regions: serializedRegions,
      palette: result.palette,
      addedSwatches: result.addedSwatches,
    },
    transferList,
  };
}

let currentDetailedProgress = false;

function handleGenerateMessage(data: {
  id: string;
  width: number;
  height: number;
  rgbaBuffer: ArrayBuffer;
  config: GeneratorConfig;
  detailedProgress?: boolean;
}): void {
  const { id, width, height, rgbaBuffer, config, detailedProgress } = data;
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
      config,
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

export function validateSubdividePayload(data: {
  cropWidth: number;
  cropHeight: number;
  rgbaBuffer: ArrayBuffer;
  cropMaskBuffer: ArrayBuffer;
  existingPalette: PaletteColor[];
  generatorConfig?: Partial<GeneratorConfig>;
}): string | null {
  if (
    !Number.isInteger(data.cropWidth) ||
    !Number.isInteger(data.cropHeight) ||
    data.cropWidth <= 0 ||
    data.cropHeight <= 0
  ) {
    return `Invalid subdivision dimensions: ${String(data.cropWidth)}x${String(data.cropHeight)}`;
  }
  const totalPixels = data.cropWidth * data.cropHeight;
  if (totalPixels > MAX_PUZZLE_PIXELS) {
    return `Subdivision dimensions ${data.cropWidth}x${data.cropHeight} exceed MAX_PUZZLE_PIXELS`;
  }
  if (!(data.rgbaBuffer instanceof ArrayBuffer)) {
    return 'Invalid rgbaBuffer: expected ArrayBuffer';
  }
  if (data.rgbaBuffer.byteLength < totalPixels * 4) {
    return `Truncated rgbaBuffer: expected at least ${totalPixels * 4} bytes, got ${data.rgbaBuffer.byteLength}`;
  }
  if (!(data.cropMaskBuffer instanceof ArrayBuffer)) {
    return 'Invalid cropMaskBuffer: expected ArrayBuffer';
  }
  if (data.cropMaskBuffer.byteLength < totalPixels) {
    return `Truncated cropMaskBuffer: expected at least ${totalPixels} bytes, got ${data.cropMaskBuffer.byteLength}`;
  }
  if (!Array.isArray(data.existingPalette)) {
    return 'Invalid existingPalette: expected Array';
  }
  if (
    data.generatorConfig !== undefined &&
    (typeof data.generatorConfig !== 'object' ||
      data.generatorConfig === null ||
      Array.isArray(data.generatorConfig))
  ) {
    return 'Invalid generatorConfig: expected plain object';
  }
  return null;
}

function handleSubdivideMessage(data: {
  id: string;
  cropWidth: number;
  cropHeight: number;
  rgbaBuffer: ArrayBuffer;
  cropMaskBuffer: ArrayBuffer;
  existingPalette: PaletteColor[];
  isFreeColor?: boolean;
  targetSubRegions?: number;
  minRegionArea?: number;
  maxNewSwatches?: number;
  reuseDeltaE?: number;
  generatorConfig?: Partial<GeneratorConfig>;
}): void {
  const { id } = data;
  try {
    const validationError = validateSubdividePayload(data);
    if (validationError) {
      self.postMessage({
        type: 'ERROR',
        id,
        error: validationError,
      });
      return;
    }
    const rgbaData = new Uint8ClampedArray(data.rgbaBuffer);
    const cropMask = new Uint8Array(data.cropMaskBuffer);
    const result = subdivideMaskedRegion({
      rgbaData,
      cropWidth: data.cropWidth,
      cropHeight: data.cropHeight,
      cropMask,
      existingPalette: data.existingPalette,
      isFreeColor: data.isFreeColor,
      targetSubRegions: data.targetSubRegions,
      minRegionArea: data.minRegionArea,
      maxNewSwatches: data.maxNewSwatches,
      reuseDeltaE: data.reuseDeltaE,
      generatorConfig: data.generatorConfig,
      onProgress: (progress, status) => {
        self.postMessage({
          type: 'PROGRESS',
          id,
          progress,
          status,
        });
      },
    });

    const { payload, transferList } = packSubdivisionForTransfer(result);
    const workerPostMessage = postMessage as unknown as (
      message: unknown,
      transfer: Transferable[]
    ) => void;

    workerPostMessage(
      {
        type: 'SUBDIVIDE_SUCCESS',
        id,
        result: payload,
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

if (typeof self !== 'undefined') {
  self.onmessage = (e: MessageEvent) => {
    const data = e.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'SET_DETAILED_PROGRESS') {
      currentDetailedProgress = Boolean(data.detailed);
      return;
    }

    if (data.type === 'GENERATE') {
      handleGenerateMessage(data);
      return;
    }

    if (data.type === 'SUBDIVIDE_MASKED_REGION') {
      handleSubdivideMessage(data);
    }
  };
}
