import { GeneratorConfig } from '../types';
import { PuzzleGeneratorFactory } from './PuzzleGenerator';

self.onmessage = (e: MessageEvent) => {
  const { type, id, width, height, rgbaBuffer, config } = e.data;

  if (type === 'GENERATE') {
    try {
      const rgbaData = new Uint8ClampedArray(rgbaBuffer);
      const generator = PuzzleGeneratorFactory.createByAlgorithm(config?.algorithm || 'AUTO');

      const puzzleData = generator.generateFromRgba(
        rgbaData,
        width,
        height,
        config as GeneratorConfig,
        (progress, status) => {
          self.postMessage({
            type: 'PROGRESS',
            id,
            progress,
            status,
          });
        }
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
