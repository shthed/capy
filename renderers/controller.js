export function createRendererController(canvas, options = {}) {
  const {
    initialRenderer = "canvas2d",
    hooks = {},
    renderers = {},
  } = options || {};

  const normalizedRenderers = {};
  if (renderers && typeof renderers === "object") {
    for (const [type, factory] of Object.entries(renderers)) {
      if (!type) continue;
      if (typeof factory === "function") {
        normalizedRenderers[type] = () => factory(canvas, hooks);
      } else if (factory && typeof factory === "object") {
        normalizedRenderers[type] = () => factory;
      }
    }
  }

  const rendererFactories = {
    canvas2d: () => createCanvas2dRenderer(canvas, hooks),
    ...normalizedRenderers,
  };

  let activeRenderer = null;
  let activeType = null;
  let lastMetrics = null;

  function setRenderer(type) {
    const nextType = type || initialRenderer;
    if (!nextType) {
      return null;
    }
    if (activeRenderer && activeType === nextType) {
      return activeRenderer;
    }
    if (activeRenderer && typeof activeRenderer.dispose === "function") {
      try {
        activeRenderer.dispose();
      } catch (error) {}
    }
    const factory = rendererFactories[nextType];
    if (typeof factory !== "function") {
      throw new Error(`Unknown renderer type: ${nextType}`);
    }
    const renderer = factory();
    if (!renderer || typeof renderer !== "object") {
      throw new Error(`Renderer factory for ${nextType} did not return an object`);
    }
    activeRenderer = renderer;
    activeType = nextType;
    if (lastMetrics && typeof activeRenderer.resize === "function") {
      activeRenderer.resize(lastMetrics);
    }
    return activeRenderer;
  }

  function ensureRenderer() {
    if (!activeRenderer) {
      return setRenderer(initialRenderer);
    }
    return activeRenderer;
  }

  function getRendererType() {
    return activeType;
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
    return null;
  }

  function fillBackground(args) {
    const renderer = ensureRenderer();
    if (renderer && typeof renderer.fillBackground === "function") {
      return renderer.fillBackground(args);
    }
    return null;
  }

  function dispose() {
    if (activeRenderer && typeof activeRenderer.dispose === "function") {
      activeRenderer.dispose();
    }
    activeRenderer = null;
    activeType = null;
  }

  function getContext() {
    const renderer = ensureRenderer();
    if (renderer && typeof renderer.getContext === "function") {
      return renderer.getContext();
    }
    return null;
  }

  setRenderer(initialRenderer);

  return {
    setRenderer,
    getRendererType,
    resize,
    renderFrame,
    renderPreview,
    flashRegions,
    fillBackground,
    dispose,
    getContext,
  };
}

function createCanvas2dRenderer(canvas, hooks = {}) {
  let context = null;

  function ensureContext() {
    if (!context && canvas && typeof canvas.getContext === "function") {
      try {
        context = canvas.getContext("2d");
      } catch (error) {
        context = null;
      }
      if (context) {
        context.imageSmoothingEnabled = false;
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
      if (typeof hooks.renderFrame === "function") {
        return hooks.renderFrame({ context: ctx, ...args });
      }
      return null;
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
      context = null;
    },
  };
}
