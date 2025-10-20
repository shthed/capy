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

export function createWebGLRenderer(canvas, hooks = {}, payload = {}) {
  const gl = requestContext(canvas);
  if (!gl) {
    return null;
  }

  const program = linkProgram(gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
  if (!program) {
    return null;
  }

  const quadBuffer = createFullscreenQuad(gl);
  if (!quadBuffer) {
    gl.deleteProgram(program);
    return null;
  }

  const fallbackTexture = createFallbackTexture(gl);
  if (!fallbackTexture) {
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

  let currentMetrics = payload && payload.metrics ? { ...payload.metrics } : null;
  let currentPixelWidth = canvas.width || 1;
  let currentPixelHeight = canvas.height || 1;

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
    if (typeof hooks.renderFrame === "function") {
      const result = hooks.renderFrame({
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
      if (result !== undefined) {
        return result;
      }
    }
    drawQuad(args);
    return null;
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
    if (typeof hooks.flashRegions === "function") {
      return hooks.flashRegions({
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
    return gl;
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
    if (typeof hooks.dispose === "function") {
      hooks.dispose({ gl, trackResource, untrackResource });
    }
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
