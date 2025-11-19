import {
  SceneGraph,
  buildPathData,
  computeInkStyles,
  getFilledState,
} from "./render.js";

function createSvgRenderer(canvas, hooks = {}, payload = {}) {
  if (!canvas || typeof document === "undefined") {
    return null;
  }

  const host = canvas.parentElement || canvas;
  if (!host) {
    return null;
  }

  const NS = "http://www.w3.org/2000/svg";
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
  backgroundRect.setAttribute("x", "0");
  backgroundRect.setAttribute("y", "0");
  svg.appendChild(backgroundRect);

  const baseImage = document.createElementNS(NS, "image");
  const filledGroup = document.createElementNS(NS, "g");
  const outlineGroup = document.createElementNS(NS, "g");
  const numbersImage = document.createElementNS(NS, "image");
  const overlayGroup = document.createElementNS(NS, "g");
  const previewImage = document.createElementNS(NS, "image");

  baseImage.setAttribute("preserveAspectRatio", "none");
  baseImage.style.display = "none";
  baseImage.style.pointerEvents = "none";
  filledGroup.setAttribute("fill-rule", "nonzero");
  outlineGroup.setAttribute("fill", "none");
  numbersImage.setAttribute("preserveAspectRatio", "none");
  numbersImage.style.display = "none";
  numbersImage.style.pointerEvents = "none";
  overlayGroup.style.pointerEvents = "none";
  previewImage.setAttribute("preserveAspectRatio", "none");
  previewImage.style.display = "none";
  previewImage.style.pointerEvents = "none";

  svg.appendChild(baseImage);
  svg.appendChild(filledGroup);
  svg.appendChild(outlineGroup);
  svg.appendChild(numbersImage);
  svg.appendChild(overlayGroup);
  svg.appendChild(previewImage);

  const originalHostPosition = host.style.position || "";
  let appliedHostPosition = false;
  if (typeof window !== "undefined" && window.getComputedStyle) {
    const computed = window.getComputedStyle(host);
    if (computed && computed.position === "static" && originalHostPosition === "") {
      host.style.position = "relative";
      appliedHostPosition = true;
    }
  }
  if (!appliedHostPosition && originalHostPosition === "") {
    host.style.position = "relative";
    appliedHostPosition = true;
  }

  canvas.insertAdjacentElement("afterend", svg);

  const originalCanvasOpacity = canvas.style.opacity || "";
  canvas.style.opacity = "0";

  let currentMetrics = payload?.metrics ? { ...payload.metrics } : null;
  let currentPixelWidth = canvas.width || 1;
  let currentPixelHeight = canvas.height || 1;
  let contentWidth = 1;
  let contentHeight = 1;
  let geometryVersion = null;
  let lastOutlineColor = null;
  let lastStrokeWidth = null;
  let baseImageHref = "";

  const sceneGraph = new SceneGraph();

  const numbersSurface = {
    canvas: null,
    context: null,
    width: 0,
    height: 0,
    cacheVersion: null,
    filledRef: null,
    filledHash: null,
    filledSize: 0,
    dataUrl: "",
    labelSettingsSignature: null,
  };

  function resize(metrics = {}) {
    currentMetrics = metrics ? { ...metrics } : null;
    const targetWidth = Math.max(1, Math.round(metrics.pixelWidth ?? canvas.width ?? 1));
    const targetHeight = Math.max(1, Math.round(metrics.pixelHeight ?? canvas.height ?? 1));
    if (canvas.width !== targetWidth) {
      canvas.width = targetWidth;
    }
    if (canvas.height !== targetHeight) {
      canvas.height = targetHeight;
    }
    currentPixelWidth = targetWidth;
    currentPixelHeight = targetHeight;
    svg.setAttribute("width", String(targetWidth));
    svg.setAttribute("height", String(targetHeight));
  }

  function renderFrame(args = {}) {
    resize(args.metrics || currentMetrics || {});

    const state = args.state || payload?.state || null;
    const cache = args.cache || null;
    const metrics = args.metrics || currentMetrics || {};
    const backgroundColor =
      typeof args.backgroundColor === "string" && args.backgroundColor
        ? args.backgroundColor
        : args.defaultBackgroundColor || "#f8fafc";

    backgroundRect.setAttribute("fill", backgroundColor);
    clearOverlay();

    if (args.previewVisible === true) {
      if (typeof hooks.renderPreview === "function") {
        try {
          hooks.renderPreview({ ...args, metrics });
        } catch (error) {
          console.warn("Preview hook failed", error);
        }
      }
      const previewCanvas = args.previewCanvas || null;
      let href = "";
      if (previewCanvas && typeof previewCanvas.toDataURL === "function") {
        try {
          href = previewCanvas.toDataURL("image/png");
        } catch (error) {
          href = "";
        }
      }
      if (href) {
        previewImage.setAttribute("href", href);
        previewImage.style.display = "";
      } else {
        previewImage.removeAttribute("href");
        previewImage.style.display = "none";
      }
      if (baseImageHref) {
        baseImage.removeAttribute("href");
        baseImageHref = "";
      }
      baseImage.style.display = "none";
      filledGroup.style.display = "none";
      outlineGroup.style.display = "none";
      numbersImage.style.display = "none";
      return null;
    }

    previewImage.removeAttribute("href");
    previewImage.style.display = "none";
    baseImage.style.display = "none";
    filledGroup.style.display = "";
    outlineGroup.style.display = "";

    const puzzleImage = state?.puzzle?.sourceImage || null;
    const readyImage = puzzleImage && puzzleImage.ready ? puzzleImage.image || null : null;
    const snapshot = puzzleImage?.snapshot || puzzleImage || null;
    const sourceHref =
      readyImage && typeof snapshot?.dataUrl === "string" && snapshot.dataUrl ? snapshot.dataUrl : "";
    if (readyImage && sourceHref) {
      if (baseImageHref !== sourceHref) {
        baseImage.setAttribute("href", sourceHref);
        baseImageHref = sourceHref;
      }
      baseImage.style.display = "";
    } else {
      if (baseImageHref) {
        baseImage.removeAttribute("href");
        baseImageHref = "";
      }
      baseImage.style.display = "none";
    }

    if (!cache || !cache.ready) {
      numbersSurface.labelSettingsSignature = null;
      numbersImage.removeAttribute("href");
      numbersImage.style.display = "none";
      return null;
    }

    if (cache.width > 0 && cache.height > 0 && (cache.width !== contentWidth || cache.height !== contentHeight)) {
      contentWidth = cache.width;
      contentHeight = cache.height;
      svg.setAttribute("viewBox", `0 0 ${contentWidth} ${contentHeight}`);
      backgroundRect.setAttribute("width", String(contentWidth));
      backgroundRect.setAttribute("height", String(contentHeight));
      baseImage.setAttribute("width", String(contentWidth));
      baseImage.setAttribute("height", String(contentHeight));
      numbersImage.setAttribute("width", String(contentWidth));
      numbersImage.setAttribute("height", String(contentHeight));
      previewImage.setAttribute("width", String(contentWidth));
      previewImage.setAttribute("height", String(contentHeight));
    }

    if (geometryVersion !== cache.version) {
      sceneGraph.rebuild(cache, {
        documentRef: document,
        filledGroup,
        outlineGroup,
      });
      geometryVersion = cache.version;
      lastStrokeWidth = null;
    }

    const filledState = getFilledState(state?.filled);
    const overlayFill =
      typeof backgroundColor === "string" && backgroundColor
        ? backgroundColor
        : "rgba(248, 250, 252, 1)";
    sceneGraph.updateFilledState(filledState, overlayFill);

    const strokeColor = computeInkStyles(backgroundColor).outline;
    const strokeWidth = cache?.strokeWidth > 0 ? cache.strokeWidth : 1;
    if (strokeColor !== lastOutlineColor || strokeWidth !== lastStrokeWidth) {
      sceneGraph.updateOutlineStyle(strokeColor, strokeWidth);
      lastOutlineColor = strokeColor;
      lastStrokeWidth = strokeWidth;
    }

    updateNumbersLayer({ state, cache, metrics }, filledState);

    return null;
  }

  function renderPreview(args = {}) {
    if (typeof hooks.renderPreview === "function") {
      return hooks.renderPreview(args);
    }
    return null;
  }

  function flashRegions(args = {}) {
    const regions = Array.isArray(args.regions) ? args.regions : [];
    if (regions.length === 0) {
      return null;
    }
    const cache = args.cache || null;
    const tint =
      typeof args.fillStyle === "string" && args.fillStyle ? args.fillStyle : "rgba(59, 130, 246, 0.45)";
    const strokeWidth = cache?.strokeWidth > 0 ? cache.strokeWidth : 1;
    for (const region of regions) {
      const geometry = cache?.regionsById?.get(region.id);
      const entry = geometry ? sceneGraph.getById(geometry.id) : null;
      const pathData = entry?.pathData || (geometry ? buildPathData(geometry) : "");
      if (!pathData) {
        continue;
      }
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", pathData);
      path.setAttribute("fill", tint);
      path.setAttribute("stroke", tint);
      path.setAttribute("stroke-width", String(strokeWidth));
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("stroke-linecap", "round");
      overlayGroup.appendChild(path);
    }
    return null;
  }

  function fillBackground(args = {}) {
    const color = typeof args.color === "string" && args.color ? args.color : null;
    backgroundRect.setAttribute("fill", color || "#f8fafc");
    return null;
  }

  function getContext() {
    return null;
  }

  function dispose() {
    overlayGroup.replaceChildren();
    sceneGraph.clear();
    numbersImage.removeAttribute("href");
    numbersImage.style.display = "none";
    previewImage.removeAttribute("href");
    previewImage.style.display = "none";
    baseImage.removeAttribute("href");
    baseImage.style.display = "none";
    baseImageHref = "";
    if (svg.parentNode) {
      svg.parentNode.removeChild(svg);
    }
    if (numbersSurface.canvas) {
      numbersSurface.canvas.width = 0;
      numbersSurface.canvas.height = 0;
      numbersSurface.context = null;
      numbersSurface.dataUrl = "";
    }
    if (appliedHostPosition) {
      host.style.position = originalHostPosition;
    }
    canvas.style.opacity = originalCanvasOpacity;
  }

  function clearOverlay() {
    while (overlayGroup.firstChild) {
      overlayGroup.removeChild(overlayGroup.firstChild);
    }
  }

  function ensureNumbersSurface(width, height) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (!numbersSurface.canvas) {
      numbersSurface.canvas = document.createElement("canvas");
      numbersSurface.context = null;
    }
    if (numbersSurface.canvas.width !== w || numbersSurface.canvas.height !== h) {
      numbersSurface.canvas.width = w;
      numbersSurface.canvas.height = h;
      numbersSurface.context = null;
    }
    if (!numbersSurface.context) {
      try {
        numbersSurface.context = numbersSurface.canvas.getContext("2d");
      } catch (error) {
        numbersSurface.context = null;
      }
      if (numbersSurface.context) {
        numbersSurface.context.imageSmoothingEnabled = false;
      }
    }
    numbersSurface.width = w;
    numbersSurface.height = h;
    return numbersSurface.context;
  }

  function clearCanvasContext(ctx) {
    if (!ctx) {
      return;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  function updateNumbersLayer(contextArgs, filledState) {
    const { state, cache, metrics } = contextArgs;
    const pixelWidth = Math.max(1, Math.round(metrics?.pixelWidth ?? currentPixelWidth));
    const pixelHeight = Math.max(1, Math.round(metrics?.pixelHeight ?? currentPixelHeight));
    const sizeChanged =
      numbersSurface.width !== pixelWidth || numbersSurface.height !== pixelHeight;
    const ctx = ensureNumbersSurface(pixelWidth, pixelHeight);
    if (!ctx) {
      numbersSurface.labelSettingsSignature = null;
      numbersImage.removeAttribute("href");
      numbersImage.style.display = "none";
      return;
    }
    let dirty = false;
    if (numbersSurface.cacheVersion !== cache.version) {
      numbersSurface.cacheVersion = cache.version;
      dirty = true;
    }
    if (numbersSurface.filledRef !== filledState.ref || numbersSurface.filledSize !== filledState.size) {
      numbersSurface.filledRef = filledState.ref;
      numbersSurface.filledSize = filledState.size;
      numbersSurface.filledHash = filledState.hash || null;
      dirty = true;
    } else if (filledState.hash && numbersSurface.filledHash !== filledState.hash) {
      numbersSurface.filledHash = filledState.hash;
      dirty = true;
    }
    const labelSignature = cache?.labelSettingsSignature ?? null;
    if (numbersSurface.labelSettingsSignature !== labelSignature) {
      numbersSurface.labelSettingsSignature = labelSignature;
      dirty = true;
    }
    if (sizeChanged) {
      dirty = true;
    }
    if (dirty) {
      clearCanvasContext(ctx);
      if (typeof hooks.drawNumbersLayer === "function") {
        try {
          hooks.drawNumbersLayer({ context: ctx, state, cache, metrics });
        } catch (error) {
          console.warn("Numbers layer hook failed", error);
        }
      }
      let href = "";
      try {
        href = ctx.canvas.toDataURL("image/png");
      } catch (error) {
        href = "";
      }
      numbersSurface.dataUrl = href;
    }
    if (numbersSurface.dataUrl) {
      numbersImage.setAttribute("href", numbersSurface.dataUrl);
      numbersImage.style.display = "";
    } else {
      numbersImage.removeAttribute("href");
      numbersImage.style.display = "none";
    }
  }

  return {
    resize,
    renderFrame,
    renderPreview,
    flashRegions,
    fillBackground,
    getContext,
    dispose,
  };
}

export { createSvgRenderer };

export default createSvgRenderer;

