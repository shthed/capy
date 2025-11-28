import { createCanvas2dRenderer, createSvgRenderer, createWebGLRenderer, SceneTileLoader } from "./render.js";

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

const BOOTSTRAP_VERSION = "2024-07-28";
const SENTINEL_READY = `ready:${BOOTSTRAP_VERSION}`;

function beginRendererBootstrap() {
  if (typeof window === "undefined") {
    return false;
  }
  if (window.__capyRendererBootstrapVersion === SENTINEL_READY) {
    return true;
  }
  window.__capyRendererBootstrapVersion = `pending:${BOOTSTRAP_VERSION}`;
  return false;
}

function completeRendererBootstrap(succeeded) {
  if (typeof window === "undefined") {
    return;
  }
  window.__capyRendererBootstrapVersion = succeeded ? SENTINEL_READY : undefined;
}

// The renderer controller stays defined here (instead of render.js) so we can
// re-export the underlying renderer factories without creating a circular
// dependency. We keep the exports at the bottom of the file to avoid
// accidentally exporting the controller twice—which manifests as the
// "Duplicate export of 'createRendererController'" syntax error when tools or
// caches concatenate multiple copies of this module. Keeping the declaration
// here and re-export block below gives us a single, predictable export site
// that matches how the inline modules import it from index.html.
function createRendererController(host, options = {}) {
  const { hooks = {} } = options || {};
  const registry = new Map([
    ["canvas", createCanvas2dRenderer],
    ["webgl", createWebGLRenderer],
    ["svg", createSvgRenderer],
  ]);
  const unavailable = new Set();
  let renderer = null;
  let activeType = null;

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

  const normalize = (value) => {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return registry.has(normalized) ? normalized : null;
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

  function registerRenderer(type, factory) {
    const normalized = normalize(type);
    if (!normalized || typeof factory !== "function") return false;
    registry.set(normalized, factory);
    unavailable.delete(normalized);
    return true;
  }

  function unregisterRenderer(type) {
    const normalized = normalize(type);
    if (!normalized || !registry.has(normalized)) return false;
    if (activeType === normalized) {
      renderer?.dispose?.();
      renderer = null;
      activeType = null;
    }
    registry.delete(normalized);
    unavailable.delete(normalized);
    return true;
  }

  function setRenderer(type) {
    const preferred = normalize(type) || normalize(activeType) || "canvas";
    const candidates = Array.from(new Set([preferred, "canvas", "webgl", "svg"]));
    for (const candidate of candidates) {
      const factory = registry.get(candidate);
      if (!factory || unavailable.has(candidate)) {
        continue;
      }
      try {
        const nextRenderer = factory(host, hooks);
        if (!nextRenderer) {
          unavailable.add(candidate);
          hooks.log?.("Renderer unavailable", { code: "renderer-unavailable", renderer: candidate });
          continue;
        }
        if (renderer && renderer !== nextRenderer) {
          renderer.dispose?.();
        }
        renderer = nextRenderer;
        activeType = candidate;
        notifyRendererChange(candidate);
        return renderer;
      } catch (error) {
        hooks.log?.("Renderer failed to initialise", { type: candidate, error: error?.message });
        unavailable.add(candidate);
      }
    }
    if (!renderer) {
      const fallbackType = normalize(type) || preferred || "canvas";
      renderer = createFallbackRenderer(fallbackType);
      activeType = fallbackType;
      hooks.log?.("Renderer fallback activated", { code: "renderer-fallback", renderer: fallbackType });
      notifyRendererChange(fallbackType);
    }
    return renderer;
  }

  function resize(metrics = {}) {
    renderer?.resize?.(metrics);
  }

  function renderFrame(args = {}) {
    return renderer?.renderFrame?.(args) ?? null;
  }

  function renderPreview(args = {}) {
    return renderer?.renderPreview?.(args) ?? null;
  }

  function flashRegions(args = {}) {
    renderer?.flashRegions?.(args);
  }

  function fillBackground(args = {}) {
    renderer?.fillBackground?.(args);
  }

  return {
    getRendererType: () => renderer?.getRendererType?.() || activeType,
    listRenderers: () => Array.from(registry.keys()),
    setRenderer,
    resize,
    renderFrame,
    renderPreview,
    flashRegions,
    fillBackground,
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

// Re-export the renderer primitives so index.html (and tests) can import a
// single module without reaching into render.js directly. Keeping this grouped
// export at the bottom prevents accidental shadowing of createRendererController
// and helps avoid the duplicate-export syntax errors seen when cached bundles
// include multiple copies of this file.
export {
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
};

export default getPrebootMetrics;
