const FRAME_LOG_INTERVAL_MS = 1000;

function getTimestamp() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function createFrameLogger(label) {
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

const CONTEXT_ATTRIBUTES = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  premultipliedAlpha: true,
  powerPreference: "high-performance",
  desynchronized: true,
};

function requestContext(canvas) {
  if (!canvas || typeof canvas.getContext !== "function") {
    return null;
  }
  let gl = null;
  try {
    gl = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
  } catch (error) {
    gl = null;
  }
  if (!gl) {
    try {
      gl =
        canvas.getContext("webgl", CONTEXT_ATTRIBUTES) ||
        canvas.getContext("experimental-webgl", CONTEXT_ATTRIBUTES);
    } catch (error) {
      gl = null;
    }
  }
  return gl;
}

function compileShader(gl, source, type) {
  const shader = gl.createShader(type);
  if (!shader) {
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("WebGL shader compile failed", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function linkProgram(gl, vertexSource, fragmentSource) {
  const vertexShader = compileShader(gl, vertexSource, gl.VERTEX_SHADER);
  const fragmentShader = compileShader(gl, fragmentSource, gl.FRAGMENT_SHADER);
  if (!vertexShader || !fragmentShader) {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    return null;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  const linkStatus = gl.getProgramParameter(program, gl.LINK_STATUS);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!linkStatus) {
    console.warn("WebGL program link failed", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function createFullscreenQuad(gl) {
  const buffer = gl.createBuffer();
  if (!buffer) {
    return null;
  }
  const vertices = new Float32Array([
    -1, -1, 0, 0,
    1, -1, 1, 0,
    -1, 1, 0, 1,
    -1, 1, 0, 1,
    1, -1, 1, 0,
    1, 1, 1, 1,
  ]);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return buffer;
}

function createFallbackTexture(gl) {
  const texture = gl.createTexture();
  if (!texture) {
    return null;
  }
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 255])
  );
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

function createRenderTargetFactory(
  gl,
  trackedTextures,
  trackedFramebuffers,
  resizeQueue,
  getSize
) {
  return function createRenderTarget(options = {}) {
    if (!gl) {
      return null;
    }
    const framebuffer = gl.createFramebuffer();
    const texture = gl.createTexture();
    if (!framebuffer || !texture) {
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      if (texture) gl.deleteTexture(texture);
      return null;
    }
    const target = {
      framebuffer,
      texture,
      options,
      width: 0,
      height: 0,
      resize(width, height) {
        if (!gl) {
          return false;
        }
        const w = Math.max(1, Math.floor(width));
        const h = Math.max(1, Math.floor(height));
        if (w === this.width && h === this.height) {
          return true;
        }

        const previousWidth = this.width;
        const previousHeight = this.height;
        const {
          internalFormat,
          format,
          type,
          minFilter = gl.NEAREST,
          magFilter = gl.NEAREST,
          wrapS = gl.CLAMP_TO_EDGE,
          wrapT = gl.CLAMP_TO_EDGE,
        } = this.options || {};

        const resolvedInternalFormat =
          typeof internalFormat === "number" && Number.isFinite(internalFormat)
            ? internalFormat
            : gl.RGBA;
        const resolvedFormat =
          typeof format === "number" && Number.isFinite(format) ? format : gl.RGBA;
        const resolvedType =
          typeof type === "number" && Number.isFinite(type) ? type : gl.UNSIGNED_BYTE;

        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);

        try {
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            resolvedInternalFormat,
            w,
            h,
            0,
            resolvedFormat,
            resolvedType,
            null
          );
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
          gl.framebufferTexture2D(
            gl.FRAMEBUFFER,
            gl.COLOR_ATTACHMENT0,
            gl.TEXTURE_2D,
            this.texture,
            0
          );
          const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
          if (status !== gl.FRAMEBUFFER_COMPLETE) {
            const hexStatus = `0x${status.toString(16)}`;
            throw new Error(`Framebuffer incomplete (${hexStatus})`);
          }
          this.width = w;
          this.height = h;
          return true;
        } catch (error) {
          console.warn("Render target resize failed", error);
          this.width = previousWidth;
          this.height = previousHeight;
          return false;
        } finally {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.bindTexture(gl.TEXTURE_2D, null);
        }
      },
      dispose() {
        if (!gl) {
          return;
        }
        gl.deleteFramebuffer(this.framebuffer);
        gl.deleteTexture(this.texture);
        trackedFramebuffers.delete(this.framebuffer);
        trackedTextures.delete(this.texture);
        resizeQueue.delete(this);
      },
    };
    trackedFramebuffers.add(framebuffer);
    trackedTextures.add(texture);
    resizeQueue.add(target);
    const size = typeof getSize === "function" ? getSize() : null;
    if (size && Number.isFinite(size.width) && Number.isFinite(size.height)) {
      const resized = target.resize(size.width, size.height);
      if (!resized) {
        target.dispose();
        return null;
      }
    }
    return target;
  };
}

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_texCoord;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_texture;
void main() {
  gl_FragColor = texture2D(u_texture, v_texCoord);
}
`;

function createWebGLRenderer(canvas, hooks = {}, payload = {}) {
  const logger = typeof hooks?.log === "function" ? hooks.log : null;
  const logFrameDuration = createFrameLogger("webgl");

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

  emitLog("Requesting WebGL context", { type: "webgl" });

  const gl = requestContext(canvas);
  if (!gl) {
    emitLog("WebGL context unavailable", { type: "webgl", reason: "context-null" });
    return null;
  }

  try {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
  } catch (error) {
    console.warn("Failed to configure WebGL pixel storage", error);
  }

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.STENCIL_TEST);

  const program = linkProgram(gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
  if (!program) {
    emitLog("WebGL shader program creation failed", { type: "webgl", stage: "program" });
    return null;
  }

  const quadBuffer = createFullscreenQuad(gl);
  if (!quadBuffer) {
    emitLog("Failed to create WebGL quad buffer", { type: "webgl", stage: "buffer" });
    gl.deleteProgram(program);
    return null;
  }

  const fallbackTexture = createFallbackTexture(gl);
  if (!fallbackTexture) {
    emitLog("Failed to create WebGL fallback texture", { type: "webgl", stage: "texture" });
    gl.deleteBuffer(quadBuffer);
    gl.deleteProgram(program);
    return null;
  }

  const attributeLocations = {
    position: gl.getAttribLocation(program, "a_position"),
    texCoord: gl.getAttribLocation(program, "a_texCoord"),
  };

  const uniformLocations = {
    texture: gl.getUniformLocation(program, "u_texture"),
  };

  const trackedPrograms = new Set([program]);
  const trackedBuffers = new Set([quadBuffer]);
  const trackedTextures = new Set([fallbackTexture]);
  const trackedFramebuffers = new Set();
  const resizeTargets = new Set();

  const transparentPixel = new Uint8Array([0, 0, 0, 0]);

  const layerTextures = {
    base: createLayerTexture(gl.LINEAR),
    filled: createLayerTexture(),
    outline: createLayerTexture(),
    numbers: createLayerTexture(),
    overlay: createLayerTexture(),
  };

  if (
    !layerTextures.base ||
    !layerTextures.filled ||
    !layerTextures.outline ||
    !layerTextures.numbers ||
    !layerTextures.overlay
  ) {
    emitLog("Failed to allocate WebGL layer textures", { type: "webgl", stage: "layers" });
    Object.values(layerTextures).forEach((texture) => {
      if (texture && gl.isTexture(texture)) {
        gl.deleteTexture(texture);
        trackedTextures.delete(texture);
      }
    });
    trackedTextures.delete(fallbackTexture);
    gl.deleteTexture(fallbackTexture);
    gl.deleteBuffer(quadBuffer);
    gl.deleteProgram(program);
    return null;
  }

  const numbersSurface = { canvas: null, context: null };
  const overlaySurface = {
    canvas: null,
    context: null,
    dirty: true,
    hasContent: false,
  };

  const uploadState = {
    cacheVersion: null,
    pixelWidth: canvas?.width ? Math.max(1, Math.round(canvas.width)) : 1,
    pixelHeight: canvas?.height ? Math.max(1, Math.round(canvas.height)) : 1,
    filledDirty: true,
    outlineDirty: true,
    numbersDirty: true,
    numbersHasContent: false,
    overlayDirty: true,
    overlayHasContent: false,
    baseDirty: true,
    baseHasContent: false,
    baseImageRef: null,
    baseSnapshotKey: null,
    lastRenderScale: null,
    lastFilledCount: null,
  };

  let currentMetrics = payload && payload.metrics ? { ...payload.metrics } : null;
  let currentPixelWidth = canvas.width || 1;
  let currentPixelHeight = canvas.height || 1;

  emitLog("WebGL renderer ready", {
    type: "webgl",
    width: currentPixelWidth,
    height: currentPixelHeight,
  });

  if (currentMetrics) {
    if (Number.isFinite(currentMetrics.pixelWidth)) {
      currentPixelWidth = Math.max(1, Math.round(currentMetrics.pixelWidth));
      canvas.width = currentPixelWidth;
    }
    if (Number.isFinite(currentMetrics.pixelHeight)) {
      currentPixelHeight = Math.max(1, Math.round(currentMetrics.pixelHeight));
      canvas.height = currentPixelHeight;
    }
  }

  const createRenderTarget = createRenderTargetFactory(
    gl,
    trackedTextures,
    trackedFramebuffers,
    resizeTargets,
    () => ({ width: currentPixelWidth, height: currentPixelHeight })
  );

  function trackResource(type, resource) {
    if (!resource) {
      return resource;
    }
    switch (type) {
      case "program":
        trackedPrograms.add(resource);
        break;
      case "buffer":
        trackedBuffers.add(resource);
        break;
      case "texture":
        trackedTextures.add(resource);
        break;
      case "framebuffer":
        trackedFramebuffers.add(resource);
        break;
      default:
        break;
    }
    return resource;
  }

  function untrackResource(type, resource) {
    if (!resource) {
      return resource;
    }
    switch (type) {
      case "program":
        trackedPrograms.delete(resource);
        break;
      case "buffer":
        trackedBuffers.delete(resource);
        break;
      case "texture":
        trackedTextures.delete(resource);
        break;
      case "framebuffer":
        trackedFramebuffers.delete(resource);
        break;
      default:
        break;
    }
    return resource;
  }

  function createLayerTexture(filter = gl.NEAREST) {
    const texture = gl.createTexture();
    if (!texture) {
      return null;
    }
    trackResource("texture", texture);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    try {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        transparentPixel
      );
    } catch (error) {
      console.warn("Failed to initialize layer texture", error);
      gl.bindTexture(gl.TEXTURE_2D, null);
      untrackResource("texture", texture);
      gl.deleteTexture(texture);
      return null;
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }

  function createOffscreenCanvas(width, height) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (typeof OffscreenCanvas === "function") {
      try {
        return new OffscreenCanvas(w, h);
      } catch (error) {
        // Ignore and fall back to DOM canvas.
      }
    }
    if (typeof document !== "undefined" && typeof document.createElement === "function") {
      const surface = document.createElement("canvas");
      surface.width = w;
      surface.height = h;
      return surface;
    }
    return null;
  }

  function ensureNumbersSurface(width, height) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    let resized = false;
    if (!numbersSurface.canvas) {
      numbersSurface.canvas = createOffscreenCanvas(w, h);
      numbersSurface.context = null;
      resized = true;
    }
    if (numbersSurface.canvas) {
      if (numbersSurface.canvas.width !== w || numbersSurface.canvas.height !== h) {
        numbersSurface.canvas.width = w;
        numbersSurface.canvas.height = h;
        numbersSurface.context = null;
        resized = true;
      }
      if (!numbersSurface.context) {
        try {
          numbersSurface.context = numbersSurface.canvas.getContext("2d");
        } catch (error) {
          numbersSurface.context = null;
        }
        if (numbersSurface.context) {
          numbersSurface.context.imageSmoothingEnabled = false;
          resized = true;
        }
      }
    }
    if (!numbersSurface.canvas || !numbersSurface.context) {
      numbersSurface.canvas = null;
      numbersSurface.context = null;
      return { context: null, resized };
    }
    return { context: numbersSurface.context, resized };
  }

  function ensureOverlaySurface(width, height) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    let resized = false;
    if (!overlaySurface.canvas) {
      overlaySurface.canvas = createOffscreenCanvas(w, h);
      overlaySurface.context = null;
      resized = true;
    }
    if (overlaySurface.canvas) {
      if (overlaySurface.canvas.width !== w || overlaySurface.canvas.height !== h) {
        overlaySurface.canvas.width = w;
        overlaySurface.canvas.height = h;
        overlaySurface.context = null;
        resized = true;
      }
      if (!overlaySurface.context) {
        try {
          overlaySurface.context = overlaySurface.canvas.getContext("2d");
        } catch (error) {
          overlaySurface.context = null;
        }
        if (overlaySurface.context) {
          overlaySurface.context.imageSmoothingEnabled = false;
          resized = true;
        }
      }
    }
    if (!overlaySurface.canvas || !overlaySurface.context) {
      overlaySurface.canvas = null;
      overlaySurface.context = null;
      return { context: null, resized };
    }
    return { context: overlaySurface.context, resized };
  }

  function clearSurfaceContext(ctx) {
    if (!ctx) {
      return;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  function markAllLayersDirty() {
    uploadState.baseDirty = true;
    uploadState.filledDirty = true;
    uploadState.outlineDirty = true;
    uploadState.numbersDirty = true;
    uploadState.overlayDirty = true;
  }

  function uploadTextureFromSource(texture, source) {
    if (!texture || !source) {
      return false;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch (error) {
      console.warn("Failed to upload WebGL texture", error);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return false;
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    return true;
  }

  function uploadTransparentTexture(texture) {
    if (!texture) {
      return false;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    try {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        transparentPixel
      );
    } catch (error) {
      console.warn("Failed to clear WebGL texture", error);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return false;
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    return true;
  }

  function resetOverlaySurface(width, height) {
    const { context, resized } = ensureOverlaySurface(width, height);
    if (context) {
      clearSurfaceContext(context);
    }
    overlaySurface.hasContent = false;
    overlaySurface.dirty = true;
    uploadState.overlayDirty = true;
    uploadState.overlayHasContent = false;
    return context;
  }

  function parseColorToClear(color, fallback = [0, 0, 0, 1]) {
    if (typeof color !== "string") {
      return fallback;
    }
    const value = color.trim();
    if (!value) {
      return fallback;
    }
    if (value.startsWith("#")) {
      const hex = value.slice(1);
      const expand = hex.length === 3 || hex.length === 4;
      const normalized = expand
        ? hex
            .split("")
            .map((component) => component + component)
            .join("")
        : hex;
      const hasAlpha = normalized.length === 8;
      if (normalized.length !== 6 && !hasAlpha) {
        return fallback;
      }
      const r = parseInt(normalized.slice(0, 2), 16);
      const g = parseInt(normalized.slice(2, 4), 16);
      const b = parseInt(normalized.slice(4, 6), 16);
      const a = hasAlpha ? parseInt(normalized.slice(6, 8), 16) : 255;
      if ([r, g, b, a].some((component) => Number.isNaN(component))) {
        return fallback;
      }
      return [r / 255, g / 255, b / 255, a / 255];
    }
    const rgbaMatch = value.match(/rgba?\(([^)]+)\)/i);
    if (rgbaMatch) {
      const parts = rgbaMatch[1]
        .split(/\s*,\s*/)
        .map((component) => component.trim())
        .filter((component) => component.length > 0);
      if (parts.length < 3) {
        return fallback;
      }
      const r = clampColorComponent(parseFloat(parts[0]));
      const g = clampColorComponent(parseFloat(parts[1]));
      const b = clampColorComponent(parseFloat(parts[2]));
      const a = parts.length >= 4 ? clampAlphaComponent(parseFloat(parts[3])) : 1;
      if ([r, g, b, a].some((component) => Number.isNaN(component))) {
        return fallback;
      }
      return [r / 255, g / 255, b / 255, a];
    }
    return fallback;
  }

  function clampColorComponent(value) {
    if (!Number.isFinite(value)) {
      return Number.NaN;
    }
    if (value <= 1 && value >= 0) {
      return Math.round(value * 255);
    }
    return Math.round(Math.min(255, Math.max(0, value)));
  }

  function clampAlphaComponent(value) {
    if (!Number.isFinite(value)) {
      return Number.NaN;
    }
    if (value > 1) {
      return Math.min(1, Math.max(0, value / 255));
    }
    return Math.min(1, Math.max(0, value));
  }

  function getFilledCount(state) {
    if (!state) {
      return 0;
    }
    if (state.filled instanceof Set) {
      return state.filled.size;
    }
    if (Array.isArray(state.filled)) {
      return state.filled.length;
    }
    return 0;
  }

  function bindFullscreenQuad() {
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
    if (attributeLocations.position >= 0) {
      gl.enableVertexAttribArray(attributeLocations.position);
      gl.vertexAttribPointer(
        attributeLocations.position,
        2,
        gl.FLOAT,
        false,
        stride,
        0
      );
    }
    if (attributeLocations.texCoord >= 0) {
      gl.enableVertexAttribArray(attributeLocations.texCoord);
      gl.vertexAttribPointer(
        attributeLocations.texCoord,
        2,
        gl.FLOAT,
        false,
        stride,
        2 * Float32Array.BYTES_PER_ELEMENT
      );
    }
  }

  function drawQuad({ texture = fallbackTexture, target = gl.TEXTURE_2D } = {}) {
    if (!gl || !program) {
      return;
    }
    gl.useProgram(program);
    bindFullscreenQuad();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(target, texture);
    if (uniformLocations.texture !== null) {
      gl.uniform1i(uniformLocations.texture, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindTexture(target, null);
  }

  function applyResize(metrics = {}) {
    if (!gl || !canvas) {
      return;
    }
    currentMetrics = metrics ? { ...metrics } : null;
    const pixelWidth = Number.isFinite(metrics.pixelWidth)
      ? Math.max(1, Math.round(metrics.pixelWidth))
      : canvas.width;
    const pixelHeight = Number.isFinite(metrics.pixelHeight)
      ? Math.max(1, Math.round(metrics.pixelHeight))
      : canvas.height;
    if (pixelWidth > 0 && canvas.width !== pixelWidth) {
      canvas.width = pixelWidth;
    }
    if (pixelHeight > 0 && canvas.height !== pixelHeight) {
      canvas.height = pixelHeight;
    }
    if (pixelWidth !== currentPixelWidth || pixelHeight !== currentPixelHeight) {
      currentPixelWidth = pixelWidth;
      currentPixelHeight = pixelHeight;
      resizeTargets.forEach((target) => {
        try {
          target.resize(pixelWidth, pixelHeight);
        } catch (error) {
          console.warn("Render target resize hook failed", error);
        }
      });
    }
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    if (typeof hooks.onResize === "function") {
      hooks.onResize({
        gl,
        metrics,
        createRenderTarget,
      });
    }
  }

  function renderFrame(args = {}) {
    if (!gl) {
      return null;
    }

    const start = getTimestamp();

    try {
    let hookResult;
    if (typeof hooks.renderFrame === "function") {
      hookResult = hooks.renderFrame({
        gl,
        program,
        uniforms: uniformLocations,
        attributes: attributeLocations,
        buffers: { quad: quadBuffer },
        metrics: currentMetrics,
        drawQuad,
        createRenderTarget,
        trackResource,
        untrackResource,
        payload,
        ...args,
      });
    }
    if (hookResult !== undefined) {
      return hookResult;
    }

    const state = args?.state || payload?.state || null;
    const cache = args?.cache || null;
    const metrics = args?.metrics || currentMetrics || {};
    const previewVisible = args?.previewVisible === true;
    const backgroundColor =
      typeof args.backgroundColor === "string" && args.backgroundColor
        ? args.backgroundColor
        : args.defaultBackgroundColor;

    const pixelWidth = Math.max(
      1,
      Math.round(
        Number.isFinite(metrics.pixelWidth)
          ? metrics.pixelWidth
          : currentPixelWidth || canvas?.width || 1
      )
    );
    const pixelHeight = Math.max(
      1,
      Math.round(
        Number.isFinite(metrics.pixelHeight)
          ? metrics.pixelHeight
          : currentPixelHeight || canvas?.height || 1
      )
    );

    if (pixelWidth !== uploadState.pixelWidth || pixelHeight !== uploadState.pixelHeight) {
      uploadState.pixelWidth = pixelWidth;
      uploadState.pixelHeight = pixelHeight;
      markAllLayersDirty();
    }

    const cacheVersion = cache && Number.isFinite(cache.version) ? cache.version : null;
    if (uploadState.cacheVersion !== cacheVersion) {
      uploadState.cacheVersion = cacheVersion;
      uploadState.baseDirty = true;
      uploadState.baseHasContent = false;
      uploadState.baseImageRef = null;
      uploadState.baseSnapshotKey = null;
      uploadState.filledDirty = true;
      uploadState.outlineDirty = true;
      uploadState.numbersDirty = true;
      uploadState.overlayDirty = true;
      uploadState.numbersHasContent = false;
      uploadState.overlayHasContent = false;
    }

    const { context: numbersContext, resized: numbersResized } = ensureNumbersSurface(
      pixelWidth,
      pixelHeight
    );
    if (numbersResized) {
      uploadState.numbersDirty = true;
    }

    const puzzleImage = state?.puzzle?.sourceImage || null;
    const baseImage = puzzleImage && puzzleImage.ready ? puzzleImage.image || null : null;
    const snapshot = puzzleImage?.snapshot || puzzleImage || null;
    const baseSnapshotKey =
      typeof snapshot?.dataUrl === "string" && snapshot.dataUrl ? snapshot.dataUrl : null;
    if (uploadState.baseImageRef !== baseImage) {
      uploadState.baseImageRef = baseImage || null;
      uploadState.baseDirty = true;
    }
    if (uploadState.baseSnapshotKey !== baseSnapshotKey) {
      uploadState.baseSnapshotKey = baseSnapshotKey;
      uploadState.baseDirty = true;
    }

    resetOverlaySurface(pixelWidth, pixelHeight);

    const renderScale = cache && Number.isFinite(cache.renderScale) ? cache.renderScale : 1;
    if (
      uploadState.lastRenderScale == null ||
      Math.abs(uploadState.lastRenderScale - renderScale) > 0.0001
    ) {
      uploadState.numbersDirty = true;
      uploadState.lastRenderScale = renderScale;
    }

    const filledCount = getFilledCount(state);
    if (uploadState.lastFilledCount !== filledCount) {
      uploadState.numbersDirty = true;
      uploadState.lastFilledCount = filledCount;
    }

    if (cache && cache.filledLayerDirty) {
      uploadState.filledDirty = true;
      if (typeof hooks.rebuildFilledLayer === "function") {
        try {
          hooks.rebuildFilledLayer({ state, cache, metrics });
        } catch (error) {
          console.warn("Filled layer rebuild hook failed", error);
        }
      }
    }

    if (cache && cache.outlineLayerDirty) {
      uploadState.outlineDirty = true;
      if (typeof hooks.rasterizeOutlineLayer === "function") {
        try {
          hooks.rasterizeOutlineLayer({ state, cache, metrics });
        } catch (error) {
          console.warn("Outline layer rebuild hook failed", error);
        }
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);

    const clearColor = parseColorToClear(backgroundColor, [0, 0, 0, 1]);
    gl.disable(gl.BLEND);
    gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const previewCanvas = args?.previewCanvas || null;
    if (previewVisible) {
      if (previewCanvas) {
        if (!uploadTextureFromSource(layerTextures.filled, previewCanvas)) {
          uploadTransparentTexture(layerTextures.filled);
        }
        drawQuad({ texture: layerTextures.filled });
      }
      if (uploadState.overlayDirty) {
        if (overlaySurface.canvas) {
          uploadTextureFromSource(layerTextures.overlay, overlaySurface.canvas);
        } else {
          uploadTransparentTexture(layerTextures.overlay);
        }
        uploadState.overlayDirty = false;
        uploadState.overlayHasContent = false;
      }
      uploadState.numbersHasContent = false;
      uploadState.filledDirty = true;
      uploadState.outlineDirty = true;
      uploadState.numbersDirty = true;
      uploadState.overlayDirty = true;
      uploadState.overlayHasContent = false;
      uploadState.baseDirty = true;
      overlaySurface.hasContent = false;
      overlaySurface.dirty = true;
      return null;
    }

    if (uploadState.baseDirty) {
      let baseUploaded = false;
      const hadContent = uploadState.baseHasContent === true;
      if (baseImage) {
        baseUploaded = uploadTextureFromSource(layerTextures.base, baseImage);
        if (!baseUploaded) {
          console.warn("WebGL base image upload failed; retaining previous texture contents");
        }
      }
      if (baseUploaded) {
        uploadState.baseHasContent = true;
      } else if (!baseImage) {
        uploadTransparentTexture(layerTextures.base);
        uploadState.baseHasContent = false;
      } else if (!hadContent) {
        uploadTransparentTexture(layerTextures.base);
        uploadState.baseHasContent = false;
      }
      uploadState.baseDirty = false;
    }

    if (uploadState.baseHasContent) {
      drawQuad({ texture: layerTextures.base });
    }

    const hasCache = Boolean(cache && cache.ready);

    if (cache?.filledLayerNeedsUpload) {
      uploadState.filledDirty = true;
    }

    if (uploadState.filledDirty) {
      const filledSourceAvailable = Boolean(hasCache && cache?.filledLayer);
      let filledUploaded = false;

      if (filledSourceAvailable) {
        filledUploaded = uploadTextureFromSource(layerTextures.filled, cache.filledLayer);
        if (!filledUploaded) {
          emitLog("Filled layer upload failed", { stage: "filled-layer" });
          console.warn("WebGL filled layer upload failed; retaining previous texture contents");
        }
      } else {
        filledUploaded = uploadTransparentTexture(layerTextures.filled);
      }

      uploadState.filledDirty = false;

      if (cache) {
        if (filledUploaded || !filledSourceAvailable) {
          cache.filledLayerNeedsUpload = false;
        }
      }
    }
    if (hasCache && cache?.filledLayer) {
      drawQuad({ texture: layerTextures.filled });
    }

    if (uploadState.outlineDirty) {
      if (hasCache && cache?.outlineLayer) {
        if (!uploadTextureFromSource(layerTextures.outline, cache.outlineLayer)) {
          uploadTransparentTexture(layerTextures.outline);
        }
      } else {
        uploadTransparentTexture(layerTextures.outline);
      }
      uploadState.outlineDirty = false;
    }
    if (hasCache && cache?.outlineLayer) {
      drawQuad({ texture: layerTextures.outline });
    }

    const numbersVisible = Boolean(hasCache && numbersContext);
    if (!numbersVisible) {
      if (uploadState.numbersHasContent || uploadState.numbersDirty) {
        if (numbersContext && numbersSurface.canvas) {
          clearSurfaceContext(numbersContext);
          uploadTextureFromSource(layerTextures.numbers, numbersSurface.canvas);
        } else {
          uploadTransparentTexture(layerTextures.numbers);
        }
        uploadState.numbersHasContent = false;
        uploadState.numbersDirty = false;
      }
    } else {
      if (uploadState.numbersDirty) {
        clearSurfaceContext(numbersContext);
        let drewNumbers = false;
        if (typeof hooks.drawNumbersLayer === "function") {
          try {
            hooks.drawNumbersLayer({
              context: numbersContext,
              state,
              cache,
              metrics,
            });
            drewNumbers = true;
          } catch (error) {
            console.warn("Numbers layer hook failed", error);
            drewNumbers = false;
          }
        }
        if (drewNumbers && numbersSurface.canvas) {
          if (!uploadTextureFromSource(layerTextures.numbers, numbersSurface.canvas)) {
            uploadTransparentTexture(layerTextures.numbers);
            drewNumbers = false;
          }
        } else {
          uploadTransparentTexture(layerTextures.numbers);
          drewNumbers = false;
        }
        uploadState.numbersDirty = false;
        uploadState.numbersHasContent = drewNumbers;
      }
      if (uploadState.numbersHasContent) {
        drawQuad({ texture: layerTextures.numbers });
      }
    }

    if (uploadState.overlayDirty) {
      if (overlaySurface.canvas) {
        uploadTextureFromSource(layerTextures.overlay, overlaySurface.canvas);
      } else {
        uploadTransparentTexture(layerTextures.overlay);
      }
      uploadState.overlayDirty = false;
      uploadState.overlayHasContent = overlaySurface.hasContent === true;
    }

    if (overlaySurface.hasContent && uploadState.overlayHasContent) {
      drawQuad({ texture: layerTextures.overlay });
    }

    return null;
  } finally {
    logFrameDuration(getTimestamp() - start);
  }
  }

  function renderPreview(args = {}) {
    if (typeof hooks.renderPreview === "function") {
      return hooks.renderPreview({
        gl,
        metrics: currentMetrics,
        createRenderTarget,
        trackResource,
        untrackResource,
        ...args,
      });
    }
    return null;
  }

  function flashRegions(args = {}) {
    if (!gl || typeof hooks.flashRegions !== "function") {
      return null;
    }

    const metrics = args?.metrics || currentMetrics || {};
    const pixelWidth = Math.max(
      1,
      Math.round(
        Number.isFinite(metrics.pixelWidth)
          ? metrics.pixelWidth
          : uploadState.pixelWidth || currentPixelWidth || canvas?.width || 1
      )
    );
    const pixelHeight = Math.max(
      1,
      Math.round(
        Number.isFinite(metrics.pixelHeight)
          ? metrics.pixelHeight
          : uploadState.pixelHeight || currentPixelHeight || canvas?.height || 1
      )
    );

    const { context, resized } = ensureOverlaySurface(pixelWidth, pixelHeight);
    if (!context) {
      return null;
    }
    if (resized) {
      uploadState.overlayDirty = true;
    }

    try {
      hooks.flashRegions({
        gl,
        metrics: currentMetrics,
        createRenderTarget,
        trackResource,
        untrackResource,
        ...args,
        context,
      });
    } catch (error) {
      console.warn("Overlay flash hook failed", error);
      return null;
    }

    overlaySurface.hasContent = true;
    overlaySurface.dirty = true;
    uploadState.overlayHasContent = true;
    uploadState.overlayDirty = true;

    if (overlaySurface.canvas) {
      if (!uploadTextureFromSource(layerTextures.overlay, overlaySurface.canvas)) {
        uploadTransparentTexture(layerTextures.overlay);
        overlaySurface.hasContent = false;
        overlaySurface.dirty = false;
        uploadState.overlayHasContent = false;
        uploadState.overlayDirty = false;
        return null;
      }
      overlaySurface.dirty = false;
      uploadState.overlayDirty = false;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    drawQuad({ texture: layerTextures.overlay });
    return null;
  }

  function fillBackground(args = {}) {
    if (typeof hooks.fillBackground === "function") {
      return hooks.fillBackground({
        gl,
        metrics: currentMetrics,
        createRenderTarget,
        trackResource,
        untrackResource,
        ...args,
      });
    }
    return null;
  }

  function getContext() {
    const width = Math.max(
      1,
      Math.round(uploadState.pixelWidth || currentPixelWidth || canvas?.width || 1)
    );
    const height = Math.max(
      1,
      Math.round(uploadState.pixelHeight || currentPixelHeight || canvas?.height || 1)
    );
    const { context } = ensureNumbersSurface(width, height);
    return context || null;
  }

  function dispose() {
    if (!gl) {
      return;
    }
    resizeTargets.forEach((target) => {
      try {
        target.dispose();
      } catch (error) {
        console.warn("Render target disposal failed", error);
      }
    });
    resizeTargets.clear();
    trackedFramebuffers.forEach((framebuffer) => {
      if (gl.isFramebuffer(framebuffer)) {
        gl.deleteFramebuffer(framebuffer);
      }
    });
    trackedTextures.forEach((texture) => {
      if (gl.isTexture(texture)) {
        gl.deleteTexture(texture);
      }
    });
    trackedBuffers.forEach((buffer) => {
      if (gl.isBuffer(buffer)) {
        gl.deleteBuffer(buffer);
      }
    });
    trackedPrograms.forEach((prog) => {
      if (gl.isProgram(prog)) {
        gl.deleteProgram(prog);
      }
    });
    trackedFramebuffers.clear();
    trackedTextures.clear();
    trackedBuffers.clear();
    trackedPrograms.clear();
    numbersSurface.canvas = null;
    numbersSurface.context = null;
    overlaySurface.canvas = null;
    overlaySurface.context = null;
    overlaySurface.hasContent = false;
    overlaySurface.dirty = true;
    uploadState.numbersHasContent = false;
    uploadState.overlayHasContent = false;
    uploadState.baseHasContent = false;
    uploadState.baseImageRef = null;
    uploadState.baseSnapshotKey = null;
    uploadState.baseDirty = true;
    if (typeof hooks.dispose === "function") {
      hooks.dispose({ gl, trackResource, untrackResource });
    }
    emitLog("WebGL renderer disposed", { type: "webgl" });
  }

  return {
    resize: applyResize,
    renderFrame,
    renderPreview,
    flashRegions,
    fillBackground,
    getContext,
    dispose,
  };
}

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

  const regionElements = new Map();

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
      rebuildGeometry(cache);
      geometryVersion = cache.version;
      lastStrokeWidth = null;
    }

    const filledState = getFilledState(state?.filled);
    const overlayFill =
      typeof backgroundColor === "string" && backgroundColor
        ? backgroundColor
        : "rgba(248, 250, 252, 1)";
    updateFilledPaths(filledState, overlayFill);

    const strokeColor = computeInkStyles(backgroundColor).outline;
    const strokeWidth = cache?.strokeWidth > 0 ? cache.strokeWidth : 1;
    if (strokeColor !== lastOutlineColor || strokeWidth !== lastStrokeWidth) {
      updateOutlineStyle(strokeColor, strokeWidth);
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
      const entry = geometry ? regionElements.get(geometry.id) : null;
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
    regionElements.clear();
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

  function rebuildGeometry(cache) {
    regionElements.clear();
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
      const fillPath = document.createElementNS(NS, "path");
      fillPath.setAttribute("d", pathData);
      fillPath.setAttribute("fill", "none");
      fillPath.setAttribute("stroke", "none");
      filledGroup.appendChild(fillPath);

      const outlinePath = document.createElementNS(NS, "path");
      outlinePath.setAttribute("d", pathData);
      outlinePath.setAttribute("fill", "none");
      outlineGroup.appendChild(outlinePath);

      regionElements.set(geometry.id, {
        geometry,
        pathData,
        fillPath,
        outlinePath,
      });
    }
  }

  function buildPathData(geometry) {
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

  function formatNumber(value) {
    if (!Number.isFinite(value)) {
      return "0";
    }
    const rounded = Math.round(value * 1000) / 1000;
    if (Number.isInteger(rounded)) {
      return String(rounded);
    }
    return rounded.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  }

  function getFilledState(source) {
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

  function updateFilledPaths(filledState, overlayColor) {
    const overlayFill =
      typeof overlayColor === "string" && overlayColor ? overlayColor : "rgba(248, 250, 252, 1)";
    regionElements.forEach((entry, id) => {
      if (!entry?.fillPath) {
        return;
      }
      if (filledState.set.has(id)) {
        entry.fillPath.setAttribute("fill", "none");
      } else {
        entry.fillPath.setAttribute("fill", overlayFill);
      }
    });
  }

  function updateOutlineStyle(color, strokeWidth) {
    regionElements.forEach((entry) => {
      if (!entry?.outlinePath) return;
      entry.outlinePath.setAttribute("stroke", color || "rgba(15, 23, 42, 0.65)");
      entry.outlinePath.setAttribute("stroke-width", String(strokeWidth || 1));
      entry.outlinePath.setAttribute("stroke-linejoin", "round");
      entry.outlinePath.setAttribute("stroke-linecap", "round");
    });
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

  function computeInkStyles(hex) {
    const rgb = hexToRgb(hex);
    const luminance = relativeLuminance(rgb);
    if (luminance < 0.45) {
      return {
        outline: "rgba(248, 250, 252, 0.75)",
        number: "rgba(248, 250, 252, 0.95)",
      };
    }
    return {
      outline: "rgba(15, 23, 42, 0.65)",
      number: "rgba(15, 23, 42, 0.95)",
    };
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

const rendererExports = {
  createRendererController,
  createCanvas2dRenderer,
  createWebGLRenderer,
  createSvgRenderer,
};

if (typeof globalThis !== "undefined") {
  const target = globalThis;
  if (typeof target.capyRenderer !== "object" || target.capyRenderer === null) {
    target.capyRenderer = {};
  }
  Object.assign(target.capyRenderer, rendererExports);
  target.createRendererController = createRendererController;
  target.createCanvas2dRenderer = createCanvas2dRenderer;
  target.createWebGLRenderer = createWebGLRenderer;
  target.createSvgRenderer = createSvgRenderer;
}

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
  module.exports = rendererExports;
}
