"use strict";

import { commandsToSvgPath } from "./adapters/scene-format.js";

function toArrayBuffer(source) {
  if (!source) {
    throw new Error("SceneTileLoader binary payload is empty");
  }
  if (source instanceof ArrayBuffer) {
    return source;
  }
  if (ArrayBuffer.isView(source)) {
    const { buffer, byteOffset, byteLength } = source;
    if (byteOffset === 0 && byteLength === buffer.byteLength) {
      return buffer;
    }
    return buffer.slice(byteOffset, byteOffset + byteLength);
  }
  throw new Error("SceneTileLoader binary payload must be an ArrayBuffer or typed array view");
}

function clampZoom(value, maxZoom) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(maxZoom, Math.round(value)));
}

function intersects(a, b) {
  if (!a || !b) {
    return true;
  }
  return !(a.maxX <= b.minX || a.minX >= b.maxX || a.maxY <= b.minY || a.minY >= b.maxY);
}

export class SceneTileLoader {
  constructor(sceneMetadata, binaryBuffer, options = {}) {
    if (!sceneMetadata || !binaryBuffer) {
      throw new Error("SceneTileLoader requires metadata and binary buffers");
    }
    this.scene = sceneMetadata;
    this.buffer = toArrayBuffer(binaryBuffer);
    this.floatView = new Float32Array(this.buffer);
    this.regionIndex = new Map();
    for (const region of sceneMetadata.regions || []) {
      this.regionIndex.set(region.id, region);
    }
    this.maxZoom = Number.isFinite(sceneMetadata.zoomLevels) ? sceneMetadata.zoomLevels : 0;
    this.tileCache = new Map();
    this.regionCache = new Map();
    this.visibleTiles = new Set();
    this.fetcher = typeof options.fetcher === "function" ? options.fetcher : null;
    this.updateListeners = new Set();
    if (typeof options.onUpdate === "function") {
      this.onUpdate(options.onUpdate);
    }
  }

  queryTiles(zoom) {
    const tiles = this.scene.tiles || {};
    const nodes = tiles[zoom] || tiles[String(zoom)];
    return Array.isArray(nodes) ? nodes : [];
  }

  ensureVisible({ zoom = 0, bounds = null } = {}) {
    const targetZoom = clampZoom(zoom, this.maxZoom);
    const nodes = this.queryTiles(targetZoom);
    const candidates = bounds ? nodes.filter((node) => intersects(bounds, node.bounds)) : nodes;
    const loaded = [];
    const visibleNow = new Set();
    for (const node of candidates) {
      const record = this.loadNode(node);
      if (record) {
        loaded.push(record);
        visibleNow.add(record.id);
      }
    }
    this.visibleTiles = visibleNow;
    return loaded;
  }

  loadNode(node) {
    if (!node) {
      return null;
    }
    const key = node.id || `${node.zoom}:${node.x}:${node.y}`;
    if (this.tileCache.has(key)) {
      return this.tileCache.get(key);
    }
    if (this.fetcher) {
      try {
        const result = this.fetcher(node);
        if (result && typeof result.then === "function") {
          result
            .then((payload) => {
              if (payload) {
                this.ingestTilePayload(payload);
              }
            })
            .catch((error) => {
              console.warn("SceneTileLoader fetcher promise failed", error);
            });
        }
      } catch (error) {
        console.warn("SceneTileLoader fetcher failed", error);
      }
    }
    const regionIds = Array.isArray(node.regionIds) ? node.regionIds : [];
    const regions = regionIds.map((id) => this.decodeRegion(id)).filter(Boolean);
    const record = { ...node, id: key, regions };
    this.tileCache.set(key, record);
    return record;
  }

  decodeRegion(id) {
    if (this.regionCache.has(id)) {
      return this.regionCache.get(id);
    }
    const meta = this.regionIndex.get(id);
    if (!meta) {
      return null;
    }
    const start = Math.max(0, Number(meta.pathOffset) || 0);
    const length = Math.max(0, Number(meta.pathLength) || 0);
    if (length === 0) {
      return null;
    }
    const end = Math.min(this.floatView.length, start + length);
    const slice = this.floatView.subarray(start, end);
    const pathData = commandsToSvgPath(slice);
    const geometry = {
      id: meta.id,
      colorId: meta.colorId,
      bounds: meta.bounds,
      pathData,
    };
    this.regionCache.set(id, geometry);
    return geometry;
  }

  getRegion(id) {
    return this.decodeRegion(id);
  }

  getVisibleRegions({ zoom = 0, bounds = null } = {}) {
    const nodes = this.ensureVisible({ zoom, bounds });
    const regions = [];
    for (const node of nodes) {
      if (node?.regions) {
        regions.push(...node.regions);
      }
    }
    return regions;
  }

  ingestTilePayload(payload) {
    if (!payload || !payload.id) {
      return;
    }
    const key = payload.id;
    const normalized = {
      id: key,
      zoom: payload.zoom,
      x: payload.x,
      y: payload.y,
      bounds: payload.bounds,
      regionIds: Array.isArray(payload.regionIds) ? payload.regionIds : [],
    };
    if (!this.scene.tiles) {
      this.scene.tiles = {};
    }
    if (!Array.isArray(this.scene.tiles[normalized.zoom])) {
      this.scene.tiles[normalized.zoom] = [];
    }
    const nodes = this.scene.tiles[normalized.zoom];
    if (!nodes.find((node) => node.id === key)) {
      nodes.push(normalized);
    }
    this.tileCache.delete(key);
    const wasVisible = this.visibleTiles.has(key);
    this.notifyUpdate({ type: "tile", id: key, visible: wasVisible });
  }

  clear() {
    this.tileCache.clear();
    this.regionCache.clear();
    this.visibleTiles.clear();
  }

  onUpdate(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    this.updateListeners.add(listener);
    return () => {
      this.updateListeners.delete(listener);
    };
  }

  notifyUpdate(detail) {
    if (!this.updateListeners || this.updateListeners.size === 0) {
      return;
    }
    for (const listener of Array.from(this.updateListeners)) {
      try {
        listener(detail);
      } catch (error) {
        console.warn("SceneTileLoader listener failed", error);
      }
    }
  }
}

export default SceneTileLoader;
