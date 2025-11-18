import { createCanvas2dRenderer } from "./backends/canvas2d.js";

function createRendererController(canvas, options = {}) {
  const { initialRenderer = "canvas2d", hooks = {}, renderers = {} } = options || {};

  const logger = typeof hooks?.log === "function" ? hooks.log : null;

  function emitLog(message, details) {
    if (!logger) {
      return;
    }
    try {
      logger(message, details);
    } catch (error) {
      console.debug("Renderer log failed", error);
    }
  }

  const factories = new Map();
  let activeRenderer = null;
  let activeType = null;
  let lastMetrics = null;
  let controllerApi = null;

  function selectInitialType() {
    if (initialRenderer && factories.has(initialRenderer)) {
      return initialRenderer;
    }
    if (factories.has("canvas2d")) {
      return "canvas2d";
    }
    const first = factories.keys().next();
    return first.done ? null : first.value;
  }

  function normalizeRendererFactory(type, factory) {
    const payload = () => ({
      canvas,
      hooks,
      type,
      metrics: lastMetrics ? { ...lastMetrics } : null,
      controller: controllerApi,
    });
    if (typeof factory === "function") {
      return () => factory(canvas, hooks, payload());
    }
    if (factory && typeof factory === "object") {
      if (typeof factory.create === "function") {
        return () => factory.create(canvas, hooks, payload());
      }
      if (typeof factory.factory === "function") {
        return () => factory.factory(canvas, hooks, payload());
      }
      return () => factory;
    }
    return null;
  }

  function registerRenderer(type, factory) {
    const normalizedType = typeof type === "string" ? type.trim() : "";
    if (!normalizedType) {
      return false;
    }
    const normalizedFactory = normalizeRendererFactory(normalizedType, factory);
    if (!normalizedFactory) {
      return false;
    }
    emitLog("Registering renderer", { type: normalizedType });
    factories.set(normalizedType, normalizedFactory);
    if (activeType === normalizedType) {
      setRenderer(normalizedType, { force: true, quiet: true });
    } else if (!activeRenderer && selectInitialType() === normalizedType) {
      ensureRenderer();
    } else if (initialRenderer === normalizedType && activeType !== normalizedType) {
      setRenderer(normalizedType, { quiet: true });
    }
    return true;
  }

  function unregisterRenderer(type) {
    const normalizedType = typeof type === "string" ? type.trim() : "";
    if (!normalizedType || !factories.has(normalizedType)) {
      return false;
    }
    const wasActive = activeType === normalizedType;
    emitLog("Unregistering renderer", { type: normalizedType, wasActive });
    factories.delete(normalizedType);
    if (wasActive) {
      dispose();
      ensureRenderer();
    }
    return true;
  }

  function ensureRenderer() {
    if (activeRenderer) {
      return activeRenderer;
    }
    const fallbackType = selectInitialType();
    if (!fallbackType) {
      return null;
    }
    emitLog("Ensuring renderer", { type: fallbackType });
    return setRenderer(fallbackType, { quiet: true });
  }

  function setRenderer(type, options = {}) {
    const { force = false, quiet = false } = options || {};
    const targetType = type || selectInitialType();
    if (!targetType) {
      if (quiet) {
        return null;
      }
      throw new Error("Renderer type not available");
    }
    if (!force && activeRenderer && activeType === targetType) {
      return activeRenderer;
    }
    emitLog("Activating renderer", { type: targetType, force });
    const factory = factories.get(targetType);
    if (typeof factory !== "function") {
      emitLog("Renderer activation failed", { type: targetType, reason: "missing-factory" });
      if (quiet) {
        return null;
      }
      throw new Error(`Unknown renderer type: ${targetType}`);
    }
    let renderer;
    try {
      renderer = factory();
    } catch (error) {
      emitLog("Renderer activation failed", {
        type: targetType,
        reason: error && error.message ? error.message : "exception",
      });
      if (!quiet) {
        throw error;
      }
      return null;
    }
    if (!renderer || typeof renderer !== "object") {
      emitLog("Renderer factory returned invalid value", { type: targetType });
      if (!quiet) {
        throw new Error(`Renderer factory for ${targetType} did not return an object`);
      }
      return null;
    }
    const previousRenderer = activeRenderer;
    const previousType = activeType;
    if (
      previousRenderer &&
      previousRenderer !== renderer &&
      typeof previousRenderer.dispose === "function"
    ) {
      try {
        previousRenderer.dispose();
      } catch (error) {
        console.warn("Renderer disposal failed", error);
      }
    }
    activeRenderer = renderer;
    activeType = targetType;
    emitLog("Renderer activated", { type: activeType, previousType });
    if (lastMetrics && typeof activeRenderer.resize === "function") {
      activeRenderer.resize({ ...lastMetrics });
    }
    if (typeof hooks.onRendererChange === "function") {
      try {
        hooks.onRendererChange({ type: activeType, previousType });
      } catch (error) {
        console.warn("Renderer change hook failed", error);
      }
    }
    return activeRenderer;
  }

  function getRendererType() {
    return activeType;
  }

  function listRenderers() {
    return Array.from(factories.keys());
  }

  function resize(metrics) {
    lastMetrics = metrics ? { ...metrics } : null;
    const renderer = ensureRenderer();
    if (renderer && typeof renderer.resize === "function") {
      renderer.resize(metrics);
    }
  }

  function renderFrame(args) {
    const renderer = ensureRenderer();
    if (renderer && typeof renderer.renderFrame === "function") {
      return renderer.renderFrame(args);
    }
    return null;
  }

  function renderPreview(args) {
    const renderer = ensureRenderer();
    if (renderer && typeof renderer.renderPreview === "function") {
      return renderer.renderPreview(args);
    }
    return hooks.renderPreview ? hooks.renderPreview(args) : null;
  }

  function flashRegions(args) {
    const renderer = ensureRenderer();
    if (renderer && typeof renderer.flashRegions === "function") {
      return renderer.flashRegions(args);
    }
    if (typeof hooks.flashRegions === "function") {
      return hooks.flashRegions(args);
    }
    return null;
  }

  function fillBackground(args) {
    const renderer = ensureRenderer();
    if (renderer && typeof renderer.fillBackground === "function") {
      return renderer.fillBackground(args);
    }
    if (typeof hooks.fillBackground === "function") {
      return hooks.fillBackground(args);
    }
    return null;
  }

  function getContext() {
    const renderer = ensureRenderer();
    if (renderer && typeof renderer.getContext === "function") {
      return renderer.getContext();
    }
    return null;
  }

  function dispose({ resetMetrics = false } = {}) {
    if (activeRenderer && typeof activeRenderer.dispose === "function") {
      try {
        activeRenderer.dispose();
      } catch (error) {
        console.warn("Renderer disposal failed", error);
      }
    }
    emitLog("Renderer disposed", { type: activeType });
    if (typeof hooks.onRendererChange === "function" && activeType) {
      try {
        hooks.onRendererChange({ type: null, previousType: activeType });
      } catch (error) {
        console.warn("Renderer change hook failed", error);
      }
    }
    activeRenderer = null;
    activeType = null;
    if (resetMetrics) {
      lastMetrics = null;
    }
  }

  const api = {
    setRenderer,
    getRendererType,
    listRenderers,
    registerRenderer,
    unregisterRenderer,
    resize,
    renderFrame,
    renderPreview,
    flashRegions,
    fillBackground,
    dispose,
    getContext,
  };

  controllerApi = api;

  registerRenderer("canvas2d", (currentCanvas, currentHooks) =>
    createCanvas2dRenderer(currentCanvas, currentHooks)
  );

  if (renderers && typeof renderers === "object") {
    for (const [type, factory] of Object.entries(renderers)) {
      registerRenderer(type, factory);
    }
  }

  ensureRenderer();

  return api;
}

export { createRendererController };

export default createRendererController;

