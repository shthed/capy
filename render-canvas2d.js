import { createFrameLogger, getTimestamp } from "./render.js";

function createCanvas2dRenderer(canvas, hooks = {}) {
  let context = null;

  const logger = typeof hooks?.log === "function" ? hooks.log : null;
  const logFrameDuration = createFrameLogger("canvas2d");

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

  function ensureContext() {
    if (!context && canvas && typeof canvas.getContext === "function") {
      try {
        context = canvas.getContext("2d");
      } catch (error) {
        context = null;
      }
      if (context) {
        context.imageSmoothingEnabled = false;
        emitLog("Canvas2D context acquired", { type: "canvas2d" });
      }
    }
    return context;
  }

  function applyResize(metrics = {}) {
    const ctx = ensureContext();
    if (!canvas || !ctx) {
      return;
    }
    const width = Number.isFinite(metrics.pixelWidth) ? Math.max(1, Math.round(metrics.pixelWidth)) : ctx.canvas.width;
    const height = Number.isFinite(metrics.pixelHeight) ? Math.max(1, Math.round(metrics.pixelHeight)) : ctx.canvas.height;
    if (width > 0 && canvas.width !== width) {
      canvas.width = width;
    }
    if (height > 0 && canvas.height !== height) {
      canvas.height = height;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (typeof hooks.onResize === "function") {
      hooks.onResize({ context: ctx, metrics });
    }
  }

  return {
    resize: applyResize,
    renderFrame(args) {
      const ctx = ensureContext();
      if (!ctx) return null;
      const start = getTimestamp();
      try {
        if (typeof hooks.renderFrame === "function") {
          return hooks.renderFrame({ context: ctx, ...args });
        }
        return null;
      } finally {
        logFrameDuration(getTimestamp() - start);
      }
    },
    renderPreview(args) {
      if (typeof hooks.renderPreview === "function") {
        return hooks.renderPreview(args);
      }
      return null;
    },
    flashRegions(args) {
      const ctx = ensureContext();
      if (!ctx) return null;
      if (typeof hooks.flashRegions === "function") {
        return hooks.flashRegions({ context: ctx, ...args });
      }
      return null;
    },
    fillBackground(args) {
      const ctx = ensureContext();
      if (!ctx) return null;
      if (typeof hooks.fillBackground === "function") {
        return hooks.fillBackground({ context: ctx, ...args });
      }
      return null;
    },
    getContext() {
      return ensureContext();
    },
    dispose() {
      if (typeof hooks.dispose === "function") {
        hooks.dispose();
      }
      emitLog("Canvas2D renderer disposed", { type: "canvas2d" });
      context = null;
    },
  };
}

export { createCanvas2dRenderer };

export default createCanvas2dRenderer;

