import { GeneratorConfig } from '../types';
import { AutoPuzzleGenerator } from './PuzzleGenerator';

let currentDetailedProgress = true;

self.onmessage = (e: MessageEvent) => {
  const { type, id, width, height, rgbaBuffer, config, detailedProgress } = e.data;

  if (type === 'SET_DETAILED_PROGRESS') {
    currentDetailedProgress = e.data.detailed !== false;
    return;
  }

  if (type === 'GENERATE') {
    try {
      currentDetailedProgress = detailedProgress !== false;
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

      // Serialize region pixels buffers for zero-copy Transferable transfer
      const serializedRegions = puzzleData.regions.map((r) => ({
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
        pixelsBuffer: r.pixels.buffer,
      }));

      const transferList: Transferable[] = [
        puzzleData.regionMap.buffer,
        puzzleData.borderMap.buffer,
        ...serializedRegions.map((r) => r.pixelsBuffer),
      ];

      const workerPostMessage = postMessage as unknown as (message: unknown, transfer: Transferable[]) => void;

      workerPostMessage(
        {
          type: 'SUCCESS',
          id,
          puzzleData: {
            width: puzzleData.width,
            height: puzzleData.height,
            palette: puzzleData.palette,
            regionMap: puzzleData.regionMap.buffer,
            borderMap: puzzleData.borderMap.buffer,
            regions: serializedRegions,
            isFreeColor: puzzleData.isFreeColor,
          },
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
