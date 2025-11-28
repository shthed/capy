import { createCanvas2dRenderer, createSvgRenderer, createWebGLRenderer, SceneTileLoader } from "./render.js";

(() => {
  if (globalThis.capyRuntime) {
    return;
  }

  const root = typeof document !== "undefined" ? document.documentElement : null;
  const SETTINGS_STORAGE_KEY = "capy.settings.v1";
  const DEFAULT_UI_SCALE = 0.75;
  const MIN_UI_SCALE = 0.2;
  const MAX_UI_SCALE = 3;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function parseStoredScale(raw) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      const payload =
        parsed && typeof parsed === "object"
          ? parsed.settings && typeof parsed.settings === "object"
            ? parsed.settings
            : parsed
          : null;
      let candidate = payload && payload.uiScale != null ? Number(payload.uiScale) : NaN;
      if (!Number.isFinite(candidate) && payload && typeof payload.uiScale === "string") {
        const trimmed = payload.uiScale.trim();
        if (trimmed.endsWith("%")) {
          candidate = Number(trimmed.slice(0, -1)) / 100;
        }
      }
      if (Number.isFinite(candidate) && candidate > 0) {
        if (candidate > MAX_UI_SCALE && candidate <= MAX_UI_SCALE * 100) {
          candidate /= 100;
        }
        return clamp(candidate, MIN_UI_SCALE, MAX_UI_SCALE);
      }
    } catch (_error) {
      /* localStorage may be unavailable; fall back to defaults. */
    }
    return null;
  }

  function readStoredSettings(storage) {
    if (!storage || typeof storage.getItem !== "function") {
      return null;
    }
    try {
      return storage.getItem(SETTINGS_STORAGE_KEY);
    } catch (_error) {
      return null;
    }
  }

  let prebootMetrics = {};

  function computePrebootMetrics() {
    if (!root || typeof window === "undefined") return {};

    const storedScale = parseStoredScale(readStoredSettings(window.localStorage));
    const userScale = storedScale == null ? DEFAULT_UI_SCALE : storedScale;
    root.style.setProperty("--ui-scale-user", String(userScale));
    const viewport = window.visualViewport;
    const width = Math.round((viewport && viewport.width) || window.innerWidth || root.clientWidth || 0);
    const height = Math.round(
      (viewport && viewport.height) || window.innerHeight || root.clientHeight || 0
    );
    const minSide = Math.max(1, Math.min(width, height));
    const autoScale = Math.min(1.1, Math.max(0.6, minSide / 880));
    root.style.setProperty("--ui-scale-auto", autoScale.toFixed(3));
    const combined = Math.min(1.8, Math.max(0.35, userScale * autoScale));
    root.style.setProperty("--ui-scale", combined.toFixed(4));
    const orientation = width >= height ? "landscape" : "portrait";
    const padding = orientation === "portrait" ? Math.min(28, Math.max(16, Math.round(minSide * 0.06))) : 32;
    root.style.setProperty("--app-width", `${width}px`);
    root.style.setProperty("--app-height", `${height}px`);
    root.style.setProperty("--viewport-padding", `${padding}px`);
    const compactCommands = width < 720 || height < 540;
    root.dataset.orientation = orientation;
    root.dataset.compactCommands = compactCommands ? "true" : "false";

    prebootMetrics = { orientation, compactCommands };
    return prebootMetrics;
  }

  function getPrebootMetrics() {
    return prebootMetrics;
  }

  function consumePrebootMetrics() {
    const metrics = prebootMetrics || {};
    prebootMetrics = {};
    if (typeof window !== "undefined") {
      try {
        delete window.__capyPrebootMetrics;
      } catch (_error) {
        window.__capyPrebootMetrics = undefined;
      }
    }
    return metrics;
  }

  function applyPrebootMetrics() {
    if (typeof window === "undefined" || !document.body) {
      return;
    }

    const metrics = consumePrebootMetrics();
    if (metrics.orientation) {
      document.body.dataset.orientation = metrics.orientation;
      document.documentElement.dataset.orientation = metrics.orientation;
    }
    if (typeof metrics.compactCommands === "boolean") {
      document.body.classList.toggle("compact-commands", metrics.compactCommands);
      document.documentElement.dataset.compactCommands = metrics.compactCommands ? "true" : "false";
    }
  }

  function beginRendererBootstrap() {
    if (typeof window === "undefined") return false;
    const alreadyBootstrapped = window.__capyRendererBootstrapped === true;
    window.__capyRendererBootstrapped = true;
    return alreadyBootstrapped;
  }

  function completeRendererBootstrap(_succeeded) {
    // The bootstrap flag is set immediately in beginRendererBootstrap; nothing
    // else needs to happen here when simplifying the runtime.
  }

  // Keep the renderer controller here so every consumer uses the exact same
  // export site. The implementation avoids layers of indirection—renderers are
  // registered up front, the preferred renderer is activated immediately, and
  // fallbacks are lightweight when no backend can initialise.
  function createRendererController(host, options = {}) {
  const { hooks = {}, rendererType } = options || {};
  const registry = {
    canvas: createCanvas2dRenderer,
    webgl: createWebGLRenderer,
    svg: createSvgRenderer,
  };
  let renderer = null;
  let activeType = null;

  const normalize = (value) => {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return normalized || null;
  };

  const notifyRendererChange = (type) => {
    if (typeof hooks.onRendererChange === "function") {
      hooks.onRendererChange(type);
      return;
    }

    hooks.log?.("Renderer change handler unbound", {
      code: "renderer-change-handler-unbound",
      renderer: type,
    });
  };

  const createFallbackRenderer = (type) => ({
    getRendererType: () => type,
    resize: () => {},
    renderFrame: () => null,
    renderPreview: () => null,
    flashRegions: () => {},
    fillBackground: () => {},
    dispose: () => {},
    getContext: () => null,
  });

  function activateRenderer(type) {
    const factory = type ? registry[type] : null;
    if (!factory) return false;
    try {
      const next = factory(host, hooks);
      if (!next) return false;
      renderer?.dispose?.();
      renderer = next;
      activeType = type;
      notifyRendererChange(type);
      return true;
    } catch (error) {
      hooks.log?.("Renderer failed", { code: "renderer-failed", renderer: type, error: error?.message });
      return false;
    }
  }

  function ensureRenderer(preferred) {
    const normalizedPreferred = normalize(preferred);
    const candidates = Array.from(
      new Set([normalizedPreferred, "canvas", "webgl", "svg"].filter((type) => type && registry[type]))
    );
    for (const candidate of candidates) {
      if (activateRenderer(candidate)) {
        return renderer;
      }
    }
    const fallbackType = normalizedPreferred || candidates[0] || "canvas";
    renderer = createFallbackRenderer(fallbackType);
    activeType = fallbackType;
    hooks.log?.("Renderer fallback", { code: "renderer-fallback", renderer: fallbackType });
    notifyRendererChange(fallbackType);
    return renderer;
  }

  function registerRenderer(type, factory) {
    const normalized = normalize(type);
    if (!normalized || typeof factory !== "function") return false;
    registry[normalized] = factory;
    return true;
  }

  function unregisterRenderer(type) {
    const normalized = normalize(type);
    if (!normalized || !registry[normalized]) return false;
    if (activeType === normalized) {
      renderer?.dispose?.();
      renderer = null;
      activeType = null;
    }
    delete registry[normalized];
    return true;
  }

  return {
    getRendererType: () => renderer?.getRendererType?.() || activeType,
    listRenderers: () => Object.keys(registry),
    setRenderer: (type) => ensureRenderer(type ?? rendererType),
    resize: (metrics = {}) => renderer?.resize?.(metrics),
    renderFrame: (args = {}) => renderer?.renderFrame?.(args) ?? null,
    renderPreview: (args = {}) => renderer?.renderPreview?.(args) ?? null,
    flashRegions: (args = {}) => renderer?.flashRegions?.(args),
    fillBackground: (args = {}) => renderer?.fillBackground?.(args),
    dispose: () => renderer?.dispose?.(),
    getContext: () => renderer?.getContext?.() || null,
    registerRenderer,
    unregisterRenderer,
    getRenderer: () => renderer,
  };
  }

  if (root) {
    const metrics = computePrebootMetrics();
    if (typeof window !== "undefined") {
      window.__capyPrebootMetrics = metrics;
    }
  }

  globalThis.capyRuntime = Object.freeze({
    applyPrebootMetrics,
    beginRendererBootstrap,
    completeRendererBootstrap,
    computePrebootMetrics,
    consumePrebootMetrics,
    createCanvas2dRenderer,
    createRendererController,
    createSvgRenderer,
    createWebGLRenderer,
    getPrebootMetrics,
    SceneTileLoader,
  });
})();
