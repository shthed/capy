const DEFAULT_BACKGROUND_INK = { outline: "#000", number: "#000" };

function resolveBackgroundInk(shared) {
  if (shared && typeof shared.getBackgroundInk === "function") {
    const ink = shared.getBackgroundInk();
    return ink ? ink : DEFAULT_BACKGROUND_INK;
  }
  if (shared && shared.backgroundInkRef && shared.backgroundInkRef.current) {
    return shared.backgroundInkRef.current;
  }
  if (shared && shared.backgroundInk) {
    return shared.backgroundInk;
  }
  return DEFAULT_BACKGROUND_INK;
}

function withRenderScale(ctx, scale, callback) {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = false;
  try {
    callback(scale);
  } finally {
    ctx.restore();
  }
}

function clearContext(ctx) {
  if (!ctx) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

function fillGeometries(ctx, geometries, options) {
  if (!ctx || !Array.isArray(geometries) || geometries.length === 0) return;
  const supportsPath2D = Boolean(options?.supportsPath2D);
  if (supportsPath2D) {
    for (const geometry of geometries) {
      if (!geometry?.path) continue;
      ctx.fill(geometry.path);
    }
    return;
  }
  for (const geometry of geometries) {
    const contours = geometry?.contours;
    if (!contours) continue;
    ctx.beginPath();
    for (const contour of contours) {
      if (!Array.isArray(contour) || contour.length === 0) continue;
      const first = contour[0];
      ctx.moveTo(first[0], first[1]);
      for (let i = 1; i < contour.length; i++) {
        const point = contour[i];
        ctx.lineTo(point[0], point[1]);
      }
      ctx.closePath();
    }
    ctx.fill();
  }
}

function strokeGeometries(ctx, geometries, options) {
  if (!ctx || !Array.isArray(geometries) || geometries.length === 0) return;
  const supportsPath2D = Boolean(options?.supportsPath2D);
  if (supportsPath2D) {
    for (const geometry of geometries) {
      if (!geometry?.path) continue;
      ctx.stroke(geometry.path);
    }
    return;
  }
  for (const geometry of geometries) {
    const contours = geometry?.contours;
    if (!contours) continue;
    ctx.beginPath();
    for (const contour of contours) {
      if (!Array.isArray(contour) || contour.length === 0) continue;
      const first = contour[0];
      ctx.moveTo(first[0], first[1]);
      for (let i = 1; i < contour.length; i++) {
        const point = contour[i];
        ctx.lineTo(point[0], point[1]);
      }
      ctx.closePath();
    }
    ctx.stroke();
  }
}

function strokeOutlinesDirect(ctx, cache, shared, geometries) {
  if (!ctx || !cache) return;
  const scale = cache.renderScale > 0 ? cache.renderScale : 1;
  const backgroundInk = resolveBackgroundInk(shared);
  withRenderScale(ctx, scale, () => {
    ctx.strokeStyle = backgroundInk.outline;
    ctx.lineWidth = cache.strokeWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    strokeGeometries(ctx, Array.isArray(geometries) ? geometries : cache.regions, {
      supportsPath2D: shared?.supportsPath2D,
    });
  });
}

function fillCanvasBackground(ctx, color, metrics = {}) {
  if (!ctx) return;
  const pixelWidth = Math.max(1, Math.round(metrics.pixelWidth ?? ctx.canvas?.width ?? 1));
  const pixelHeight = Math.max(1, Math.round(metrics.pixelHeight ?? ctx.canvas?.height ?? 1));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!color) {
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, pixelWidth, pixelHeight);
  }
  ctx.restore();
}

function renderFlashRegions(ctx, { cache, regions, fillStyle, renderScale, strokeWidth, supportsPath2D } = {}) {
  if (!ctx || !cache?.ready || !Array.isArray(regions) || regions.length === 0) return;
  const scale = renderScale > 0 ? renderScale : cache.renderScale > 0 ? cache.renderScale : 1;
  const outlineWidth = strokeWidth > 0 ? strokeWidth : cache.strokeWidth > 0 ? cache.strokeWidth : 1;
  withRenderScale(ctx, scale, () => {
    ctx.fillStyle = fillStyle;
    ctx.strokeStyle = fillStyle;
    ctx.lineWidth = outlineWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (supportsPath2D) {
      for (const region of regions) {
        const geometry = cache.regionsById.get(region.id);
        if (!geometry?.path) continue;
        ctx.fill(geometry.path);
        ctx.stroke(geometry.path);
      }
      return;
    }
    for (const region of regions) {
      const geometry = cache.regionsById.get(region.id);
      const contours = geometry?.contours;
      if (!contours) continue;
      ctx.beginPath();
      for (const contour of contours) {
        if (!Array.isArray(contour) || contour.length === 0) continue;
        const first = contour[0];
        ctx.moveTo(first[0], first[1]);
        for (let i = 1; i < contour.length; i++) {
          const point = contour[i];
          ctx.lineTo(point[0], point[1]);
        }
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
    }
  });
}

function rasterizeOutlineLayer(cache, shared) {
  const ctx = cache?.outlineLayerCtx;
  if (!cache || !ctx || !cache.outlineLayer) {
    if (cache) {
      cache.outlineLayerDirty = true;
    }
    return false;
  }
  clearContext(ctx);
  const backgroundInk = resolveBackgroundInk(shared);
  const scale = cache.renderScale > 0 ? cache.renderScale : 1;
  withRenderScale(ctx, scale, () => {
    ctx.strokeStyle = backgroundInk.outline;
    ctx.lineWidth = cache.strokeWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    strokeGeometries(ctx, cache.regions, {
      supportsPath2D: shared?.supportsPath2D,
    });
  });
  cache.outlineLayerDirty = false;
  return true;
}

function drawOutlines(ctx, cache, shared, options = {}) {
  if (!ctx || !cache?.ready) return;
  const filledRegions = options.filledRegions || new Set();
  const hideCompleted = filledRegions.size > 0;
  const geometries = hideCompleted
    ? cache.regions.filter((geometry) => !filledRegions.has(geometry.id))
    : cache.regions;
  if (geometries.length === 0) {
    return;
  }
  if (!hideCompleted && cache.outlineLayer && cache.outlineLayerCtx) {
    if (cache.outlineLayerDirty && !rasterizeOutlineLayer(cache, shared)) {
      strokeOutlinesDirect(ctx, cache, shared, geometries);
      return;
    }
    ctx.drawImage(cache.outlineLayer, 0, 0);
    return;
  }
  strokeOutlinesDirect(ctx, cache, shared, geometries);
}

function drawNumbers(ctx, options) {
  const {
    puzzle,
    filledRegions,
    settings,
    getPaletteEntry,
    getRegionLabelLayout,
    shared,
  } = options || {};
  if (!ctx || !puzzle) return;
  if (settings?.showRegionLabels === false) return;
  const canvasMetrics = shared?.canvasMetrics || {};
  const scale = canvasMetrics.renderScale > 0 ? canvasMetrics.renderScale : 1;
  const backgroundInk = resolveBackgroundInk(shared);
  withRenderScale(ctx, scale, () => {
    const fallbackNumberInk = backgroundInk.number;
    const fallbackOutlineInk = backgroundInk.outline;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = fallbackOutlineInk;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const region of puzzle.regions) {
      if (filledRegions?.has(region.id)) continue;
      const layout = getRegionLabelLayout ? getRegionLabelLayout(region) : null;
      if (!layout) continue;
      const paletteColor = getPaletteEntry ? getPaletteEntry(region.colorId) : null;
      const regionInk =
        paletteColor?.hex && typeof paletteColor.hex === "string"
          ? paletteColor.hex
          : fallbackNumberInk;
      ctx.fillStyle = regionInk;
      ctx.font = layout.font;
      if (layout.strokeWidth) {
        ctx.lineWidth = layout.strokeWidth;
        ctx.strokeText(layout.text, layout.x, layout.y);
      }
      ctx.fillText(layout.text, layout.x, layout.y);
    }
  });
}

function compositeFilledRegionsDirect(ctx, cache, options) {
  const { filledRegions, getPaletteEntry, shared } = options || {};
  if (!ctx || !cache?.ready) return;
  const fillsByColor = new Map();
  const targets = filledRegions instanceof Set ? filledRegions : new Set();
  for (const regionId of targets) {
    const geometry = cache.regionsById.get(regionId);
    if (!geometry) continue;
    const colorEntry = getPaletteEntry ? getPaletteEntry(geometry.colorId) : null;
    if (!colorEntry?.hex) continue;
    if (!fillsByColor.has(colorEntry.hex)) {
      fillsByColor.set(colorEntry.hex, []);
    }
    fillsByColor.get(colorEntry.hex).push(geometry);
  }
  if (fillsByColor.size === 0) return;
  const scale = cache.renderScale > 0 ? cache.renderScale : 1;
  withRenderScale(ctx, scale, () => {
    for (const [hex, entries] of fillsByColor) {
      ctx.fillStyle = hex;
      fillGeometries(ctx, entries, { supportsPath2D: shared?.supportsPath2D });
    }
  });
}

function rebuildFilledLayer(cache, options) {
  const { filledRegions, getPaletteEntry, shared } = options || {};
  const ctx = cache?.filledLayerCtx;
  if (!cache || !ctx || !cache.filledLayer) {
    if (cache) {
      cache.filledLayerDirty = true;
    }
    return false;
  }
  clearContext(ctx);
  const scale = cache.renderScale > 0 ? cache.renderScale : 1;
  withRenderScale(ctx, scale, () => {
    ctx.globalCompositeOperation = "source-over";
    const fillsByColor = new Map();
    const targets = filledRegions instanceof Set ? filledRegions : new Set();
    for (const regionId of targets) {
      const geometry = cache.regionsById.get(regionId);
      if (!geometry) continue;
      const colorEntry = getPaletteEntry ? getPaletteEntry(geometry.colorId) : null;
      if (!colorEntry?.hex) continue;
      if (!fillsByColor.has(colorEntry.hex)) {
        fillsByColor.set(colorEntry.hex, []);
      }
      fillsByColor.get(colorEntry.hex).push(geometry);
    }
    for (const [hex, entries] of fillsByColor) {
      ctx.fillStyle = hex;
      fillGeometries(ctx, entries, { supportsPath2D: shared?.supportsPath2D });
    }
  });
  cache.filledLayerDirty = false;
  return true;
}

function paintRegionToFilledLayer(cache, regionId, options) {
  const { getPaletteEntry, shared } = options || {};
  if (!cache?.ready) return false;
  if (!cache.filledLayer || !cache.filledLayerCtx) {
    cache.filledLayerDirty = true;
    return false;
  }
  if (cache.filledLayerDirty) {
    return false;
  }
  const geometry = cache.regionsById.get(regionId);
  if (!geometry) return false;
  const colorEntry = getPaletteEntry ? getPaletteEntry(geometry.colorId) : null;
  if (!colorEntry?.hex) return false;
  const ctx = cache.filledLayerCtx;
  const scale = cache.renderScale > 0 ? cache.renderScale : 1;
  withRenderScale(ctx, scale, () => {
    ctx.fillStyle = colorEntry.hex;
    fillGeometries(ctx, [geometry], { supportsPath2D: shared?.supportsPath2D });
  });
  return true;
}

function createLayerCanvas(width, height, supportsOffscreenCanvas) {
  if (supportsOffscreenCanvas) {
    try {
      return new OffscreenCanvas(width, height);
    } catch (error) {
      // Ignore and fall back to DOM canvas
    }
  }
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.hidden = true;
  return canvas;
}

function getLayerContext(layer) {
  if (!layer) return null;
  try {
    const ctx = layer.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
    }
    return ctx;
  } catch (error) {
    return null;
  }
}

function createRenderCache() {
  return {
    width: 0,
    height: 0,
    version: 0,
    strokeWidth: 1,
    renderScale: 1,
    pixelWidth: 0,
    pixelHeight: 0,
    ready: false,
    regions: [],
    regionsById: new Map(),
    filledLayer: null,
    filledLayerCtx: null,
    filledLayerDirty: true,
    outlineLayer: null,
    outlineLayerCtx: null,
    outlineLayerDirty: true,
  };
}

function rebuildRenderCache(cache, options) {
  const {
    puzzle,
    canvasMetrics,
    computeOutlineStrokeWidth,
    buildRegionGeometry,
    supportsOffscreenCanvas,
  } = options || {};
  if (!cache) return null;
  if (!puzzle) {
    cache.width = 0;
    cache.height = 0;
    cache.version = 0;
    cache.strokeWidth = 1;
    cache.regions = [];
    cache.regionsById = new Map();
    cache.filledLayer = null;
    cache.filledLayerCtx = null;
    cache.filledLayerDirty = true;
    cache.outlineLayer = null;
    cache.outlineLayerCtx = null;
    cache.outlineLayerDirty = true;
    cache.ready = false;
    return cache;
  }
  cache.width = puzzle.width;
  cache.height = puzzle.height;
  cache.version = puzzle.regions.length;
  cache.strokeWidth = computeOutlineStrokeWidth
    ? computeOutlineStrokeWidth(cache.width, cache.height, {
        displayScale: canvasMetrics?.displayScale,
        pixelRatio: canvasMetrics?.pixelRatio,
        deviceWidth: 1,
      })
    : cache.strokeWidth;
  cache.regions = [];
  cache.regionsById = new Map();
  for (const region of puzzle.regions) {
    const geometry = buildRegionGeometry ? buildRegionGeometry(region, cache.width, cache.height) : null;
    if (!geometry) continue;
    cache.regions.push(geometry);
    cache.regionsById.set(region.id, geometry);
  }
  const pixelWidth = Math.max(1, canvasMetrics?.pixelWidth || cache.width);
  const pixelHeight = Math.max(1, canvasMetrics?.pixelHeight || cache.height);
  cache.filledLayer = createLayerCanvas(pixelWidth, pixelHeight, supportsOffscreenCanvas);
  cache.filledLayerCtx = getLayerContext(cache.filledLayer);
  cache.filledLayerDirty = true;
  cache.outlineLayer = createLayerCanvas(pixelWidth, pixelHeight, supportsOffscreenCanvas);
  cache.outlineLayerCtx = getLayerContext(cache.outlineLayer);
  cache.outlineLayerDirty = true;
  cache.ready = true;
  syncCacheMetrics(cache, { canvasMetrics, computeOutlineStrokeWidth });
  return cache;
}

function syncCacheMetrics(cache, options) {
  const { canvasMetrics, computeOutlineStrokeWidth } = options || {};
  if (!cache) return false;
  const fallbackWidth = Math.max(1, cache.width || 1);
  const fallbackHeight = Math.max(1, cache.height || 1);
  const pixelWidth = Math.max(1, canvasMetrics?.pixelWidth || fallbackWidth);
  const pixelHeight = Math.max(1, canvasMetrics?.pixelHeight || fallbackHeight);
  const renderScale = canvasMetrics?.renderScale > 0 ? canvasMetrics.renderScale : 1;
  const changed =
    cache.pixelWidth !== pixelWidth ||
    cache.pixelHeight !== pixelHeight ||
    Math.abs((cache.renderScale || 0) - renderScale) > 0.0001;
  cache.pixelWidth = pixelWidth;
  cache.pixelHeight = pixelHeight;
  cache.renderScale = renderScale;
  if (computeOutlineStrokeWidth) {
    cache.strokeWidth = computeOutlineStrokeWidth(cache.width, cache.height, {
      displayScale: canvasMetrics?.displayScale,
      pixelRatio: canvasMetrics?.pixelRatio,
      deviceWidth: 1,
    });
  }
  if (cache.filledLayer) {
    let resized = false;
    if (cache.filledLayer.width !== pixelWidth) {
      cache.filledLayer.width = pixelWidth;
      resized = true;
    }
    if (cache.filledLayer.height !== pixelHeight) {
      cache.filledLayer.height = pixelHeight;
      resized = true;
    }
    if (resized || !cache.filledLayerCtx) {
      cache.filledLayerCtx = getLayerContext(cache.filledLayer);
    }
  }
  if (cache.outlineLayer) {
    let resized = false;
    if (cache.outlineLayer.width !== pixelWidth) {
      cache.outlineLayer.width = pixelWidth;
      resized = true;
    }
    if (cache.outlineLayer.height !== pixelHeight) {
      cache.outlineLayer.height = pixelHeight;
      resized = true;
    }
    if (resized || !cache.outlineLayerCtx) {
      cache.outlineLayerCtx = getLayerContext(cache.outlineLayer);
    }
  }
  if (changed) {
    cache.filledLayerDirty = true;
    cache.outlineLayerDirty = true;
  }
  return changed;
}

function generatePreviewImageData(puzzle) {
  if (!puzzle) return null;
  const { width, height, regions, palette } = puzzle;
  let imageData = null;
  if (typeof ImageData === "function") {
    imageData = new ImageData(width, height);
  }
  if (!imageData) {
    return null;
  }
  const data = imageData.data;
  for (const region of regions) {
    const color = palette[region.colorId - 1];
    if (!color) continue;
    const rgba = color.rgba;
    if (!Array.isArray(rgba) || rgba.length < 3) continue;
    for (const idx of region.pixels) {
      const base = idx * 4;
      data[base] = rgba[0];
      data[base + 1] = rgba[1];
      data[base + 2] = rgba[2];
      data[base + 3] = 255;
    }
  }
  return imageData;
}

function createMeasurementContext(shared) {
  const supportsOffscreenCanvas = shared?.supportsOffscreenCanvas ?? typeof OffscreenCanvas === "function";
  let canvas = null;
  if (supportsOffscreenCanvas) {
    try {
      canvas = new OffscreenCanvas(1, 1);
    } catch (error) {
      canvas = null;
    }
  }
  if (!canvas && typeof document !== "undefined") {
    canvas = document.createElement("canvas");
  }
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
  }
  return ctx;
}

function createCanvas2DRenderer(canvas, shared = {}) {
  const ctx = canvas ? canvas.getContext("2d") : null;
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
  }
  const measurementCtx = createMeasurementContext(shared) || ctx;

  function resize(options = {}) {
    if (!canvas || !ctx) return;
    const pixelWidth = Math.max(1, Math.round(options.pixelWidth || canvas.width || 1));
    const pixelHeight = Math.max(1, Math.round(options.pixelHeight || canvas.height || 1));
    if (canvas.width !== pixelWidth) {
      canvas.width = pixelWidth;
    }
    if (canvas.height !== pixelHeight) {
      canvas.height = pixelHeight;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  function renderPreview(options = {}) {
    const { puzzle, previewCanvas, previewCtx } = options;
    if (!puzzle) return null;
    const imageData = generatePreviewImageData(puzzle);
    if (!imageData) {
      return null;
    }
    if (previewCanvas) {
      previewCanvas.width = puzzle.width;
      previewCanvas.height = puzzle.height;
    }
    if (previewCtx && typeof previewCtx.putImageData === "function") {
      previewCtx.putImageData(imageData, 0, 0);
    }
    return imageData;
  }

  function renderFrame(options = {}) {
    if (!ctx || !canvas) return;
    const {
      puzzle,
      filledRegions,
      settings,
      backgroundColor,
      previewVisible,
      previewCanvas,
      previewImageData,
      cache,
      getPaletteEntry,
      getRegionLabelLayout,
    } = options;
    const backgroundInk = resolveBackgroundInk(shared);
    const pixelWidth = canvas.width;
    const pixelHeight = canvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    const fillColor = backgroundColor || backgroundInk?.canvas || backgroundInk?.number;
    if (fillColor) {
      ctx.fillStyle = fillColor;
      ctx.fillRect(0, 0, pixelWidth, pixelHeight);
    }
    if (previewVisible && puzzle) {
      let drewPreview = false;
      if (previewCanvas && previewCanvas.width && previewCanvas.height) {
        const sourceWidth = previewCanvas.width;
        const sourceHeight = previewCanvas.height;
        const targetWidth = shared.canvasMetrics?.pixelWidth || pixelWidth;
        const targetHeight = shared.canvasMetrics?.pixelHeight || pixelHeight;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(previewCanvas, 0, 0, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);
        drewPreview = true;
      } else if (previewImageData && typeof ctx.putImageData === "function") {
        ctx.putImageData(previewImageData, 0, 0);
        drewPreview = true;
      }
      ctx.restore();
      if (drewPreview) {
        return;
      }
    }
    if (cache?.ready && puzzle) {
      let drewFromLayer = false;
      if (cache.filledLayer && cache.filledLayerCtx) {
        drewFromLayer = cache.filledLayerDirty
          ? rebuildFilledLayer(cache, {
              filledRegions,
              getPaletteEntry,
              shared,
            })
          : true;
        if (drewFromLayer) {
          ctx.drawImage(cache.filledLayer, 0, 0);
        }
      }
      if (!drewFromLayer) {
        compositeFilledRegionsDirect(ctx, cache, {
          filledRegions,
          getPaletteEntry,
          shared,
        });
      }
    }
    ctx.restore();
    if (!puzzle) {
      return;
    }
    drawOutlines(ctx, cache, shared, { filledRegions });
    drawNumbers(ctx, {
      puzzle,
      filledRegions,
      settings,
      getPaletteEntry,
      getRegionLabelLayout,
      shared,
    });
  }

  function measureText(font, text) {
    if (!measurementCtx) {
      return null;
    }
    measurementCtx.save();
    measurementCtx.setTransform(1, 0, 0, 1, 0, 0);
    measurementCtx.font = font;
    const metrics = measurementCtx.measureText(text);
    measurementCtx.restore();
    return metrics;
  }

  function dispose() {
    // No explicit resources to release yet.
  }

  return {
    resize,
    renderFrame,
    renderPreview,
    flashRegions(options = {}) {
      if (!ctx) return;
      renderFlashRegions(ctx, {
        cache: options.cache,
        regions: options.regions,
        fillStyle: options.fillStyle,
        renderScale:
          options.renderScale ?? options.metrics?.renderScale ?? shared?.canvasMetrics?.renderScale,
        strokeWidth: options.strokeWidth,
        supportsPath2D: shared?.supportsPath2D,
      });
    },
    fillBackground(color, options = {}) {
      if (!ctx) return;
      fillCanvasBackground(ctx, color, {
        pixelWidth: options.pixelWidth ?? options.metrics?.pixelWidth ?? canvas?.width,
        pixelHeight: options.pixelHeight ?? options.metrics?.pixelHeight ?? canvas?.height,
      });
    },
    dispose,
    measureText,
  };
}

export {
  createCanvas2DRenderer,
  createRenderCache,
  rebuildRenderCache,
  syncCacheMetrics,
  rebuildFilledLayer,
  rasterizeOutlineLayer,
  paintRegionToFilledLayer,
  fillCanvasBackground,
  renderFlashRegions,
};

export default createCanvas2DRenderer;
