import { createSvgRenderer, SceneTileLoader } from "./render.js";

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

let prebootMetrics = {};

function computePrebootMetrics() {
  if (!root || typeof window === "undefined") return {};

  const storedScale = parseStoredScale(window.localStorage?.getItem(SETTINGS_STORAGE_KEY));
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

export function getPrebootMetrics() {
  return prebootMetrics;
}

export function consumePrebootMetrics() {
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

export function applyPrebootMetrics() {
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

export function beginRendererBootstrap() {
  if (typeof window === "undefined") {
    return false;
  }
  if (window.__capyRendererBootstrapVersion === SENTINEL_READY) {
    return true;
  }
  window.__capyRendererBootstrapVersion = `pending:${BOOTSTRAP_VERSION}`;
  return false;
}

export function completeRendererBootstrap(succeeded) {
  if (typeof window === "undefined") {
    return;
  }
  window.__capyRendererBootstrapVersion = succeeded ? SENTINEL_READY : undefined;
}

if (root) {
  const metrics = computePrebootMetrics();
  if (typeof window !== "undefined") {
    window.__capyPrebootMetrics = metrics;
  }
}

export { createSvgRenderer, SceneTileLoader };

export default getPrebootMetrics;
