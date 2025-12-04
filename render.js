const DEFAULT_OVERLAY_FILL = "rgba(248, 250, 252, 1)";
const DEFAULT_OUTLINE = "rgba(15, 23, 42, 0.65)";
const DEFAULT_NUMBER = "rgba(15, 23, 42, 0.95)";

export function formatNumber(value) {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function buildPathData(geometry) {
  if (!geometry) return "";
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

export function computeInkStyles(hex) {
  const rgb = hexToRgb(hex);
  const luminance = relativeLuminance(rgb);
  if (luminance < 0.45) {
    return { outline: "rgba(248, 250, 252, 0.75)", number: "rgba(248, 250, 252, 0.95)" };
  }
  return { outline: DEFAULT_OUTLINE, number: DEFAULT_NUMBER };
}

function hexToRgb(hex) {
  if (typeof hex !== "string") return [248, 250, 252];
  const normalized = hex.trim().replace(/^#/, "");
  if (normalized.length !== 6) return [248, 250, 252];
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return [248, 250, 252];
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function relativeLuminance(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return 0;
  const transform = (component) => {
    const channel = component / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgb.map(transform);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function createVectorScenePayload({ width, height, regions }) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("Scene payload requires numeric width and height");
  }
  const serializedRegions = [];
  for (const region of regions || []) {
    if (!region) continue;
    const pathData = buildPathData(region);
    serializedRegions.push({
      id: region.id,
      colorId: region.colorId,
      pathData,
    });
  }
  return {
    json: { format: "capy.scene+simple", version: 1, width, height, regions: serializedRegions },
    binary: new ArrayBuffer(0),
  };
}

export function createVectorSceneLoader(vectorScene) {
  const metadata = vectorScene?.metadata || vectorScene?.json || vectorScene;
  if (!metadata || metadata.format !== "capy.scene+simple" || metadata.version !== 1) {
    return null;
  }
  const width = Number(metadata.width);
  const height = Number(metadata.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  const maxZoom = Number.isFinite(metadata.maxZoom) && metadata.maxZoom >= 0 ? metadata.maxZoom : 0;
  const regions = [];
  const regionsById = new Map();
  const supportsPath2D = typeof Path2D === "function";

  const regionEntries = Array.isArray(metadata.regions) ? metadata.regions : [];
  for (let index = 0; index < regionEntries.length; index += 1) {
    const region = regionEntries[index];
    if (!region) continue;
    const id = Number.isFinite(region.id) ? region.id : index;
    const colorId = Number.isFinite(region.colorId) ? region.colorId : null;
    const pathData = typeof region.pathData === "string" ? region.pathData.trim() : "";
    if (!pathData) continue;
    const geometry = { id, colorId, pathData };
    if (supportsPath2D) {
      try {
        geometry.path = new Path2D(pathData);
      } catch (_error) {
        // Ignore malformed paths and fall back to pathData only.
      }
    }
    regions.push(geometry);
    regionsById.set(id, geometry);
  }

  const listeners = new Set();
  const subscribe = (listener) => {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const notify = () => {
    listeners.forEach((listener) => {
      try {
        listener({ visible: true });
      } catch (_error) {
        // Swallow listener errors.
      }
    });
  };

  return {
    type: "vector-scene-simple",
    width,
    height,
    maxZoom,
    getVisibleRegions: () => regions,
    getRegion: (id) => regionsById.get(id) || null,
    onUpdate: subscribe,
    notify,
  };
}

export function createSvgRenderer(host, hooks = {}) {
  if (!host || typeof document === "undefined") return null;
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
  svg.appendChild(backgroundRect);

  const shapesGroup = document.createElementNS(NS, "g");
  svg.appendChild(shapesGroup);

  const labelsGroup = document.createElementNS(NS, "g");
  svg.appendChild(labelsGroup);

  const overlayGroup = document.createElementNS(NS, "g");
  svg.appendChild(overlayGroup);

  container.insertAdjacentElement("beforeend", svg);

  function clearOverlay() {
    while (overlayGroup.firstChild) {
      overlayGroup.removeChild(overlayGroup.firstChild);
    }
  }

  function clear() {
    while (shapesGroup.firstChild) {
      shapesGroup.removeChild(shapesGroup.firstChild);
    }
    while (labelsGroup.firstChild) {
      labelsGroup.removeChild(labelsGroup.firstChild);
    }
    clearOverlay();
  }

  function renderFrame({ state, cache, backgroundColor, defaultBackgroundColor }) {
    clear();
    const fill = backgroundColor || defaultBackgroundColor || "#f8fafc";
    const width = cache?.width || state?.puzzle?.width || 0;
    const height = cache?.height || state?.puzzle?.height || 0;
    if (width > 0 && height > 0) {
      svg.setAttribute("viewBox", `0 0 ${formatNumber(width)} ${formatNumber(height)}`);
    }
    backgroundRect.setAttribute("fill", fill);
    const regions = cache?.regions?.length ? cache.regions : state?.puzzle?.regions || [];
    const palette = state?.puzzle?.palette || [];
    const paletteById = new Map(palette.map((entry) => [entry.id, entry]));
    while (labelsGroup.firstChild) {
      labelsGroup.removeChild(labelsGroup.firstChild);
    }
    for (const geometry of regions) {
      const pathData = buildPathData(geometry);
      if (!pathData) continue;
      const paletteEntry = paletteById.get(geometry.colorId);
      const fillHex = paletteEntry?.hex || paletteEntry?.color || "#cbd5e1";
      const ink = computeInkStyles(fillHex);
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", pathData);
      const isFilled = state?.filled?.has(geometry.id);
      path.setAttribute("fill", isFilled ? fillHex : DEFAULT_OVERLAY_FILL);
      path.setAttribute("stroke", ink.outline);
      path.setAttribute("stroke-width", "0.75");
      shapesGroup.appendChild(path);

      const label = hooks?.getRegionLabelProps?.({
        region: geometry,
        paletteEntry,
        pathData,
        state,
        cache,
      });
      if (label?.text && Number.isFinite(label.x) && Number.isFinite(label.y)) {
        const text = document.createElementNS(NS, "text");
        text.textContent = label.text;
        text.setAttribute("x", formatNumber(label.x));
        text.setAttribute("y", formatNumber(label.y));
        text.setAttribute("fill", label.fill || ink.number);
        text.setAttribute("stroke", label.stroke || ink.outline);
        if (label.strokeWidth != null) {
          text.setAttribute("stroke-width", formatNumber(label.strokeWidth));
        }
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "middle");
        if (label.fontFamily) {
          text.setAttribute("font-family", label.fontFamily);
        }
        if (label.fontSize != null) {
          text.setAttribute("font-size", formatNumber(label.fontSize));
        }
        labelsGroup.appendChild(text);
      }
    }
    hooks?.onRendered?.({ svg, shapesGroup });
  }

  function renderPreview(args = {}) {
    if (typeof hooks?.renderPreview === "function") {
      return hooks.renderPreview(args);
    }
    return null;
  }

  function flashRegions({ cache, regions, fillStyle }) {
    clearOverlay();
    if (!Array.isArray(regions) || regions.length === 0) return;
    const fill = typeof fillStyle === "string" && fillStyle ? fillStyle : DEFAULT_OVERLAY_FILL;
    const strokeWidth = cache?.strokeWidth > 0 ? cache.strokeWidth : 1;
    for (const region of regions) {
      const pathData = buildPathData(region);
      if (!pathData) continue;
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", pathData);
      path.setAttribute("fill", fill);
      path.setAttribute("stroke", fill);
      path.setAttribute("stroke-width", String(strokeWidth));
      overlayGroup.appendChild(path);
    }
  }

  function dispose() {
    svg.remove();
    if (shouldResetPosition) {
      container.style.position = originalPosition;
    }
  }

  return {
    type: "svg",
    getRendererType: () => "svg",
    svg,
    renderFrame,
    renderPreview,
    flashRegions,
    clear,
    dispose,
  };
}

const rendererExports = {
  createSvgRenderer,
  computeInkStyles,
  buildPathData,
  formatNumber,
  createVectorScenePayload,
  createVectorSceneLoader,
};

const globalTarget = typeof globalThis === "object" ? globalThis : null;
if (globalTarget) {
  if (typeof globalTarget.capyRenderer !== "object" || globalTarget.capyRenderer === null) {
    globalTarget.capyRenderer = {};
  }
  Object.assign(globalTarget.capyRenderer, rendererExports);
}

export default rendererExports;
