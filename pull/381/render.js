const DEFAULT_OVERLAY_FILL = "rgba(248, 250, 252, 1)";
const DEFAULT_OUTLINE = "rgba(15, 23, 42, 0.65)";
const DEFAULT_NUMBER = "rgba(15, 23, 42, 0.95)";

export function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const rounded = Math.round(value * 1000) / 1000;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return rounded.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function buildPathData(geometry) {
  if (!geometry) {
    return "";
  }
  if (geometry.pathData && typeof geometry.pathData === "string") {
    return geometry.pathData;
  }
  const contours = Array.isArray(geometry.contours) ? geometry.contours : [];
  const segments = [];
  for (const contour of contours) {
    if (!Array.isArray(contour) || contour.length === 0) continue;
    const first = contour[0];
    segments.push(`M${formatNumber(first[0])} ${formatNumber(first[1])}`);
    for (let i = 1; i < contour.length; i++) {
      const point = contour[i];
      segments.push(`L${formatNumber(point[0])} ${formatNumber(point[1])}`);
    }
    segments.push("Z");
  }
  return segments.join(" ");
}

export function getFilledState(source) {
  if (source instanceof Set) {
    return { set: source, ref: source, size: source.size, hash: null };
  }
  if (Array.isArray(source)) {
    const set = new Set(source);
    let hash = null;
    if (source.length > 0 && source.length <= 128) {
      const sorted = source.slice().sort((a, b) => a - b);
      hash = sorted.join(",");
    }
    return { set, ref: source, size: set.size, hash };
  }
  return { set: new Set(), ref: null, size: 0, hash: null };
}

export function computeInkStyles(hex) {
  const rgb = hexToRgb(hex);
  const luminance = relativeLuminance(rgb);
  if (luminance < 0.45) {
    return {
      outline: "rgba(248, 250, 252, 0.75)",
      number: "rgba(248, 250, 252, 0.95)",
    };
  }
  return {
    outline: DEFAULT_OUTLINE,
    number: DEFAULT_NUMBER,
  };
}

function hexToRgb(hex) {
  if (typeof hex !== "string") {
    return [248, 250, 252];
  }
  const normalized = hex.trim().replace(/^#/, "");
  if (normalized.length !== 6) {
    return [248, 250, 252];
  }
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) {
    return [248, 250, 252];
  }
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function relativeLuminance(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) {
    return 0;
  }
  const transform = (component) => {
    const channel = component / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgb.map(transform);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function ensureRegionBounds(region, width) {
  if (region && region.bounds) {
    return { ...region.bounds };
  }
  if (!region || !Array.isArray(region.pixels) || region.pixels.length === 0) {
    return { minX: 0, minY: 0, maxX: width, maxY: width };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const idx of region.pixels) {
    const x = idx % width;
    const y = (idx / width) | 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { minX: 0, minY: 0, maxX: width, maxY: width };
  }
  return {
    minX,
    minY,
    maxX: maxX + 1,
    maxY: maxY + 1,
  };
}

export function buildRegionContours(region, width, height) {
  const pixels = Array.isArray(region?.pixels) ? region.pixels : [];
  if (pixels.length === 0) {
    return [];
  }
  const membership = new Set(pixels);
  const edges = [];
  const outgoing = new Map();
  const vertexKey = (x, y) => `${x},${y}`;
  const pushEdge = (ax, ay, bx, by) => {
    const edge = { ax, ay, bx, by };
    const index = edges.length;
    edges.push(edge);
    const key = vertexKey(ax, ay);
    if (!outgoing.has(key)) {
      outgoing.set(key, []);
    }
    outgoing.get(key).push(index);
  };
  for (const idx of membership) {
    const x = idx % width;
    const y = (idx / width) | 0;
    const up = idx - width;
    const down = idx + width;
    const left = idx - 1;
    const right = idx + 1;
    if (y === 0 || !membership.has(up)) {
      pushEdge(x, y, x + 1, y);
    }
    if (x === width - 1 || !membership.has(right)) {
      pushEdge(x + 1, y, x + 1, y + 1);
    }
    if (y === height - 1 || !membership.has(down)) {
      pushEdge(x + 1, y + 1, x, y + 1);
    }
    if (x === 0 || !membership.has(left)) {
      pushEdge(x, y + 1, x, y);
    }
  }
  if (edges.length === 0) {
    return [];
  }
  const unused = new Set(edges.map((_, index) => index));
  const contours = [];
  const getVector = (edge) => ({ dx: edge.bx - edge.ax, dy: edge.by - edge.ay });
  const originKey = (edge) => `${edge.ax},${edge.ay}`;
  const limit = edges.length * 8;
  while (unused.size > 0) {
    const startIndex = unused.values().next().value;
    let currentIndex = startIndex;
    const startEdge = edges[startIndex];
    const startKey = originKey(startEdge);
    const contour = [];
    let guard = 0;
    while (true) {
      const edge = edges[currentIndex];
      if (contour.length === 0) {
        contour.push([edge.ax, edge.ay]);
      }
      contour.push([edge.bx, edge.by]);
      unused.delete(currentIndex);
      const nextKey = `${edge.bx},${edge.by}`;
      if (nextKey === startKey) {
        break;
      }
      const candidates = outgoing.get(nextKey) || [];
      let nextIndex = null;
      if (candidates.length === 1) {
        if (unused.has(candidates[0])) {
          nextIndex = candidates[0];
        }
      } else {
        const prevVector = getVector(edge);
        let bestAngle = Number.POSITIVE_INFINITY;
        for (const candidateIndex of candidates) {
          if (!unused.has(candidateIndex)) continue;
          const candidate = edges[candidateIndex];
          const vec = getVector(candidate);
          const cross = prevVector.dx * vec.dy - prevVector.dy * vec.dx;
          const dot = prevVector.dx * vec.dx + prevVector.dy * vec.dy;
          let angle = Math.atan2(cross, dot);
          if (angle <= 0) {
            angle += Math.PI * 2;
          }
          if (angle < bestAngle) {
            bestAngle = angle;
            nextIndex = candidateIndex;
          }
        }
      }
      if (nextIndex == null) {
        break;
      }
      currentIndex = nextIndex;
      guard += 1;
      if (guard > limit) {
        break;
      }
    }
    if (contour.length > 1) {
      const first = contour[0];
      const last = contour[contour.length - 1];
      if (first[0] === last[0] && first[1] === last[1]) {
        contour.pop();
      }
      contours.push(contour);
    }
    if (contours.length > edges.length) {
      break;
    }
  }
  return contours;
}

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

export class SceneGraph {
  constructor() {
    this.regionElements = new Map();
  }

  rebuild(cache, { documentRef, filledGroup, outlineGroup }) {
    if (!documentRef || !filledGroup || !outlineGroup) {
      return;
    }
    this.regionElements.clear();
    while (filledGroup.firstChild) {
      filledGroup.removeChild(filledGroup.firstChild);
    }
    while (outlineGroup.firstChild) {
      outlineGroup.removeChild(outlineGroup.firstChild);
    }
    const regions = cache?.regions || [];
    for (const geometry of regions) {
      if (!geometry) continue;
      const pathData = buildPathData(geometry);
      if (!pathData) continue;
      const fillPath = documentRef.createElementNS("http://www.w3.org/2000/svg", "path");
      fillPath.setAttribute("d", pathData);
      fillPath.setAttribute("fill", "none");
      fillPath.setAttribute("stroke", "none");
      filledGroup.appendChild(fillPath);

      const outlinePath = documentRef.createElementNS("http://www.w3.org/2000/svg", "path");
      outlinePath.setAttribute("d", pathData);
      outlinePath.setAttribute("fill", "none");
      outlineGroup.appendChild(outlinePath);

      this.regionElements.set(geometry.id, {
        geometry,
        pathData,
        fillPath,
        outlinePath,
      });
    }
  }

  updateFilledState(filledState, overlayColor = DEFAULT_OVERLAY_FILL) {
    const targetFill = typeof overlayColor === "string" && overlayColor ? overlayColor : DEFAULT_OVERLAY_FILL;
    this.regionElements.forEach((entry, id) => {
      if (!entry?.fillPath) {
        return;
      }
      if (filledState?.set?.has(id)) {
        entry.fillPath.setAttribute("fill", "none");
      } else {
        entry.fillPath.setAttribute("fill", targetFill);
      }
    });
  }

  updateOutlineStyle(color = DEFAULT_OUTLINE, strokeWidth = 1) {
    this.regionElements.forEach((entry) => {
      if (!entry?.outlinePath) return;
      entry.outlinePath.setAttribute("stroke", color);
      entry.outlinePath.setAttribute("stroke-width", String(strokeWidth || 1));
      entry.outlinePath.setAttribute("stroke-linejoin", "round");
      entry.outlinePath.setAttribute("stroke-linecap", "round");
    });
  }

  getElements() {
    return this.regionElements;
  }

  getById(id) {
    return this.regionElements.get(id) || null;
  }

  clear() {
    this.regionElements.clear();
  }
}

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

export const FRAME_LOG_INTERVAL_MS = 1000;

export function getTimestamp() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export function createFrameLogger(label) {
  const stats = {
    frames: 0,
    total: 0,
    max: 0,
    lastLogTs: getTimestamp(),
  };
  return function logFrameDuration(durationMs) {
    if (!Number.isFinite(durationMs)) {
      return;
    }
    stats.frames += 1;
    stats.total += durationMs;
    if (durationMs > stats.max) {
      stats.max = durationMs;
    }
    const now = getTimestamp();
    if (now - stats.lastLogTs < FRAME_LOG_INTERVAL_MS) {
      return;
    }
    if (stats.frames > 0) {
      const average = stats.total / stats.frames;
      const peak = stats.max;
      console.log(
        `[Renderer:${label}] ${stats.frames} frames in ${(now - stats.lastLogTs).toFixed(0)}ms – ` +
          `avg ${average.toFixed(2)}ms, max ${peak.toFixed(2)}ms`
      );
    }
    stats.frames = 0;
    stats.total = 0;
    stats.max = 0;
    stats.lastLogTs = now;
  };
}

export function createSvgRenderer(host, hooks = {}) {
  if (!host || typeof document === "undefined") {
    return null;
  }

  const NS = "http://www.w3.org/2000/svg";
  const container = host.parentElement || host;
  const originalPosition = container.style.position || "";
  const shouldResetPosition = originalPosition === "" || originalPosition === "static";
  if (shouldResetPosition) {
    container.style.position = "relative";
  }

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  svg.style.top = "0";
  svg.style.left = "0";
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.pointerEvents = "none";
  svg.style.userSelect = "none";
  svg.style.display = "block";

  const backgroundRect = document.createElementNS(NS, "rect");
  backgroundRect.setAttribute("fill", "#f8fafc");
  svg.appendChild(backgroundRect);

  const baseImage = document.createElementNS(NS, "image");
  baseImage.setAttribute("preserveAspectRatio", "none");
  baseImage.style.pointerEvents = "none";
  svg.appendChild(baseImage);

  const shapesGroup = document.createElementNS(NS, "g");
  shapesGroup.setAttribute("data-layer", "shapes");
  shapesGroup.style.pointerEvents = "none";
  svg.appendChild(shapesGroup);

  const annotationsGroup = document.createElementNS(NS, "g");
  annotationsGroup.setAttribute("data-layer", "annotations");
  annotationsGroup.style.pointerEvents = "none";
  svg.appendChild(annotationsGroup);

  container.insertAdjacentElement("beforeend", svg);

  let viewBox = { x: 0, y: 0, width: host.clientWidth || 1, height: host.clientHeight || 1 };
  let contentWidth = viewBox.width;
  let contentHeight = viewBox.height;

  function applyViewBox() {
    svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
    backgroundRect.setAttribute("x", String(viewBox.x));
    backgroundRect.setAttribute("y", String(viewBox.y));
    backgroundRect.setAttribute("width", String(viewBox.width));
    backgroundRect.setAttribute("height", String(viewBox.height));
    baseImage.setAttribute("x", String(viewBox.x));
    baseImage.setAttribute("y", String(viewBox.y));
    baseImage.setAttribute("width", String(contentWidth));
    baseImage.setAttribute("height", String(contentHeight));
  }

  function setSize(width, height) {
    const w = Math.max(1, Math.round(width || host.clientWidth || 1));
    const h = Math.max(1, Math.round(height || host.clientHeight || 1));
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    if (!contentWidth || !contentHeight) {
      contentWidth = w;
      contentHeight = h;
      viewBox = { x: 0, y: 0, width: w, height: h };
      applyViewBox();
    }
  }

  function setImageSource(src, width, height) {
    if (typeof src === "string" && src) {
      baseImage.setAttribute("href", src);
      baseImage.style.display = "";
    } else {
      baseImage.removeAttribute("href");
      baseImage.style.display = "none";
    }
    if (Number.isFinite(width) && Number.isFinite(height)) {
      contentWidth = width;
      contentHeight = height;
      const viewBoxNeedsUpdate =
        !Number.isFinite(viewBox.width) ||
        !Number.isFinite(viewBox.height) ||
        viewBox.width <= 0 ||
        viewBox.height <= 0 ||
        viewBox.width !== width ||
        viewBox.height !== height;
      if (viewBoxNeedsUpdate) {
        viewBox = { x: 0, y: 0, width, height };
      }
      applyViewBox();
    }
  }

  function setBackground(fill) {
    if (typeof fill === "string" && fill) {
      backgroundRect.setAttribute("fill", fill);
    }
  }

  function setViewBox(x, y, width, height) {
    if (Number.isFinite(x)) viewBox.x = x;
    if (Number.isFinite(y)) viewBox.y = y;
    if (Number.isFinite(width) && width > 0) viewBox.width = width;
    if (Number.isFinite(height) && height > 0) viewBox.height = height;
    applyViewBox();
  }

  function pan(dx = 0, dy = 0) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    setViewBox(viewBox.x + dx, viewBox.y + dy, viewBox.width, viewBox.height);
  }

  function zoom(factor = 1, originX = contentWidth / 2, originY = contentHeight / 2) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const nextWidth = viewBox.width / factor;
    const nextHeight = viewBox.height / factor;
    const offsetX = (originX - viewBox.x) * (1 - 1 / factor);
    const offsetY = (originY - viewBox.y) * (1 - 1 / factor);
    setViewBox(viewBox.x + offsetX, viewBox.y + offsetY, nextWidth, nextHeight);
  }

  function addShape(tag = "path", attributes = {}, layer = "shapes") {
    const element = document.createElementNS(NS, tag);
    Object.entries(attributes || {}).forEach(([key, value]) => {
      if (value != null) {
        element.setAttribute(key, String(value));
      }
    });
    const target = layer === "annotations" ? annotationsGroup : shapesGroup;
    target.appendChild(element);
    return element;
  }

  function removeShape(element) {
    if (element?.parentNode) {
      element.parentNode.removeChild(element);
    }
  }

  function clear() {
    while (shapesGroup.firstChild) {
      shapesGroup.removeChild(shapesGroup.firstChild);
    }
    while (annotationsGroup.firstChild) {
      annotationsGroup.removeChild(annotationsGroup.firstChild);
    }
  }

  function dispose() {
    svg.remove();
    if (shouldResetPosition) {
      container.style.position = originalPosition;
    }
  }

  applyViewBox();

  hooks?.onReady?.({ svg, baseImage, shapesGroup, annotationsGroup });

  return {
    svg,
    baseImage,
    shapesGroup,
    annotationsGroup,
    setImageSource,
    addShape,
    removeShape,
    clear,
    setViewBox,
    pan,
    zoom,
    setSize,
    setBackground,
    dispose,
  };
}

export const sceneFormat = {
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

export const vectorData = {
  formatNumber,
  buildPathData,
  getFilledState,
  computeInkStyles,
  ensureRegionBounds,
  buildRegionContours,
};

const rendererExports = {
  createSvgRenderer,
  SceneTileLoader,
  SceneGraph,
  sceneFormat,
  vectorData,
};

const globalTarget = typeof globalThis === "object" ? globalThis : null;

if (globalTarget) {
  if (typeof globalTarget.capyRenderer !== "object" || globalTarget.capyRenderer === null) {
    globalTarget.capyRenderer = {};
  }
  Object.assign(globalTarget.capyRenderer, rendererExports);
  globalTarget.capyRenderer.__legacyLoaderVersion = "2024-07-28";
}

export default rendererExports;
