"use strict";

import { buildRegionContours, ensureRegionBounds, formatNumber } from "./vector-data.js";

export const SCENE_FORMAT_VERSION = 1;
export const SCENE_COMMAND_MOVE = 0;
export const SCENE_COMMAND_CURVE = 1;
export const SCENE_COMMAND_CLOSE = 2;
export const SCENE_COMMAND_STRIDE = 9;

export function contoursToBezierCommands(contours) {
  const commands = [];
  for (const contour of contours || []) {
    if (!Array.isArray(contour) || contour.length < 2) {
      continue;
    }
    const first = contour[0];
    commands.push(
      SCENE_COMMAND_MOVE,
      first[0],
      first[1],
      first[0],
      first[1],
      first[0],
      first[1],
      first[0],
      first[1]
    );
    for (let i = 1; i < contour.length; i++) {
      const prev = contour[i - 1];
      const point = contour[i];
      commands.push(
        SCENE_COMMAND_CURVE,
        prev[0],
        prev[1],
        prev[0],
        prev[1],
        point[0],
        point[1],
        point[0],
        point[1]
      );
    }
    commands.push(
      SCENE_COMMAND_CLOSE,
      first[0],
      first[1],
      first[0],
      first[1],
      first[0],
      first[1],
      first[0],
      first[1]
    );
  }
  return commands;
}

export function commandsToSvgPath(data) {
  if (!data || data.length === 0) {
    return "";
  }
  const floats = ArrayBuffer.isView(data) ? data : Array.from(data);
  const segments = [];
  for (let i = 0; i < floats.length; i += SCENE_COMMAND_STRIDE) {
    const cmd = floats[i];
    const ax = floats[i + 1];
    const ay = floats[i + 2];
    const bx = floats[i + 3];
    const by = floats[i + 4];
    const cx = floats[i + 5];
    const cy = floats[i + 6];
    const dx = floats[i + 7];
    const dy = floats[i + 8];
    if (cmd === SCENE_COMMAND_MOVE) {
      segments.push(`M${formatNumber(ax)} ${formatNumber(ay)}`);
    } else if (cmd === SCENE_COMMAND_CURVE) {
      segments.push(
        `C${formatNumber(bx)} ${formatNumber(by)} ${formatNumber(cx)} ${formatNumber(cy)} ${formatNumber(dx)} ${formatNumber(dy)}`
      );
    } else if (cmd === SCENE_COMMAND_CLOSE) {
      segments.push("Z");
    }
  }
  return segments.join(" ");
}

function buildBoundsByZoom(bounds, zoomLevels) {
  const volumes = [];
  for (let z = 0; z <= zoomLevels; z++) {
    const scale = Math.pow(0.5, z);
    volumes.push({
      zoom: z,
      minX: bounds.minX * scale,
      minY: bounds.minY * scale,
      maxX: bounds.maxX * scale,
      maxY: bounds.maxY * scale,
    });
  }
  return volumes;
}

function buildTileIndex(regions, width, height, zoomLevels) {
  const tilesByZoom = {};
  const tileMap = new Map();
  const regionToTiles = new Map();
  for (let z = 0; z <= zoomLevels; z++) {
    tilesByZoom[z] = [];
  }
  for (const region of regions) {
    if (!region || !region.bounds) continue;
    const bounds = region.bounds;
    for (let z = 0; z <= zoomLevels; z++) {
      const gridSize = 1 << z;
      const minTileX = clampIndex(Math.floor((bounds.minX / width) * gridSize), gridSize);
      const maxTileX = clampIndex(Math.floor((bounds.maxX / width) * gridSize), gridSize);
      const minTileY = clampIndex(Math.floor((bounds.minY / height) * gridSize), gridSize);
      const maxTileY = clampIndex(Math.floor((bounds.maxY / height) * gridSize), gridSize);
      for (let ty = minTileY; ty <= maxTileY; ty++) {
        for (let tx = minTileX; tx <= maxTileX; tx++) {
          const key = `${z}:${tx}:${ty}`;
          let node = tileMap.get(key);
          if (!node) {
            node = {
              id: key,
              zoom: z,
              x: tx,
              y: ty,
              bounds: tileBounds(width, height, gridSize, tx, ty),
              regionIds: [],
            };
            tileMap.set(key, node);
            tilesByZoom[z].push(node);
          }
          node.regionIds.push(region.id);
          if (!regionToTiles.has(region.id)) {
            regionToTiles.set(region.id, []);
          }
          regionToTiles.get(region.id).push(key);
        }
      }
    }
  }
  for (const nodes of Object.values(tilesByZoom)) {
    nodes.sort((a, b) => a.id.localeCompare(b.id));
  }
  return { tilesByZoom, regionToTiles };
}

function clampIndex(value, gridSize) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(gridSize - 1, value));
}

function tileBounds(width, height, gridSize, tileX, tileY) {
  const tileWidth = width / gridSize;
  const tileHeight = height / gridSize;
  return {
    minX: tileX * tileWidth,
    minY: tileY * tileHeight,
    maxX: (tileX + 1) * tileWidth,
    maxY: (tileY + 1) * tileHeight,
  };
}

export function createVectorScenePayload({ width, height, regions, options = {} }) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("Scene payload requires numeric width and height");
  }
  const zoomLevels = Math.max(0, Math.min(Number(options.maxZoomLevels) || 6, 12));
  const floats = [];
  const metadataRegions = [];
  for (const region of regions || []) {
    if (!region) continue;
    const bounds = ensureRegionBounds(region, width);
    const contours = buildRegionContours(region, width, height);
    const commandFloats = contoursToBezierCommands(contours);
    const offset = floats.length;
    floats.push(...commandFloats);
    metadataRegions.push({
      id: region.id,
      colorId: region.colorId,
      bounds,
      boundsByZoom: buildBoundsByZoom(bounds, zoomLevels),
      pathOffset: offset,
      pathLength: commandFloats.length,
    });
  }
  const { tilesByZoom, regionToTiles } = buildTileIndex(metadataRegions, width, height, zoomLevels);
  for (const region of metadataRegions) {
    region.tileRefs = regionToTiles.get(region.id) || [];
  }
  const json = {
    format: "capy.scene+tiles",
    version: SCENE_FORMAT_VERSION,
    width,
    height,
    regionCount: metadataRegions.length,
    zoomLevels,
    regions: metadataRegions,
    tiles: tilesByZoom,
  };
  const binary = new Float32Array(floats).buffer;
  return { json, binary };
}

export function deserializeVectorScene(payload) {
  if (!payload) {
    return null;
  }
  const metadata = payload.json || payload.metadata || null;
  const binary = payload.binary || payload.buffer || null;
  if (!metadata || !binary) {
    return null;
  }
  return {
    metadata,
    floatView: new Float32Array(binary),
  };
}

export default {
  SCENE_FORMAT_VERSION,
  SCENE_COMMAND_MOVE,
  SCENE_COMMAND_CURVE,
  SCENE_COMMAND_CLOSE,
  SCENE_COMMAND_STRIDE,
  createVectorScenePayload,
  deserializeVectorScene,
  contoursToBezierCommands,
  commandsToSvgPath,
};
