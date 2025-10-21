const GENERATION_STAGE_MESSAGES = {
  prepare: "Preparing image…",
  quantize: "Quantizing colours",
  smooth: "Smoothing regions",
  smoothSkip: "Skipping smoothing",
  segment: "Segmenting regions",
  finalize: "Finalizing metadata",
  complete: "Generation complete",
};

const DEFAULT_GENERATION_ALGORITHM = "local-kmeans";

const GENERATION_ALGORITHMS = {
  "local-kmeans": {
    id: "local-kmeans",
    label: "Local palette clustering (k-means)",
    mode: "local",
  },
  "local-posterize": {
    id: "local-posterize",
    label: "Local posterize & merge",
    mode: "local",
  },
};

export const GENERATION_ALGORITHM_CATALOG = Object.freeze(
  Object.values(GENERATION_ALGORITHMS).map(({ id, label, mode }) => ({ id, label, mode }))
);

export const DEFAULT_GENERATION_ALGORITHM_ID = DEFAULT_GENERATION_ALGORITHM;

let generationWorkerInstance = null;
let generationWorkerUrl = null;

const now =
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? () => performance.now()
    : () => Date.now();

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeAlgorithm(value) {
  if (typeof value === "string") {
    const key = value.trim();
    switch (key) {
      case "local-kmeans":
      case "local-posterize":
        return key;
      default:
        break;
    }
  }
  return DEFAULT_GENERATION_ALGORITHM;
}

function toHex(value) {
  return value.toString(16).padStart(2, "0");
}

function accumulate(histogram, color) {
  histogram.set(color, (histogram.get(color) || 0) + 1);
}

function neighborIndexes(x, y, width, height) {
  const neighbors = [];
  if (x > 0) neighbors.push(y * width + (x - 1));
  if (x < width - 1) neighbors.push(y * width + (x + 1));
  if (y > 0) neighbors.push((y - 1) * width + x);
  if (y < height - 1) neighbors.push((y + 1) * width + x);
  return neighbors;
}

function floodFill(width, height, indexMap) {
  const regionMap = new Int32Array(width * height);
  regionMap.fill(-1);
  const regions = [];
  let regionId = 0;
  const stack = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const startIdx = y * width + x;
      if (regionMap[startIdx] !== -1) continue;
      const colorId = indexMap[startIdx];
      stack.push(startIdx);
      regionMap[startIdx] = regionId;
      const pixels = [];
      while (stack.length) {
        const idx = stack.pop();
        pixels.push(idx);
        const px = idx % width;
        const py = (idx / width) | 0;
        const neighbors = neighborIndexes(px, py, width, height);
        for (const n of neighbors) {
          if (regionMap[n] !== -1) continue;
          if (indexMap[n] !== colorId) continue;
          regionMap[n] = regionId;
          stack.push(n);
        }
      }
      regions.push({
        id: regionId,
        colorId,
        pixels,
        pixelCount: pixels.length,
      });
      regionId += 1;
    }
  }
  return { regionMap, regions };
}

function segmentRegions(width, height, assignments, minRegion) {
  const indexMap = new Uint16Array(assignments);
  let attempt = 0;
  let threshold = Math.max(1, minRegion);
  while (true) {
    const { regionMap, regions } = floodFill(width, height, indexMap);
    const tiny = regions.filter((region) => region.pixelCount < threshold);
    if (tiny.length === 0 || threshold <= 1) {
      return { regionMap, regions };
    }
    let changed = false;
    for (const region of tiny) {
      const colorVotes = new Map();
      for (const idx of region.pixels) {
        const x = idx % width;
        const y = (idx / width) | 0;
        const neighbors = neighborIndexes(x, y, width, height);
        for (const n of neighbors) {
          const color = indexMap[n];
          if (color === region.colorId) continue;
          colorVotes.set(color, (colorVotes.get(color) || 0) + 1);
        }
      }
      if (colorVotes.size === 0) continue;
      let bestColor = region.colorId;
      let bestVotes = -1;
      for (const [color, votes] of colorVotes.entries()) {
        if (votes > bestVotes) {
          bestVotes = votes;
          bestColor = color;
        }
      }
      if (bestColor !== region.colorId) {
        changed = true;
        for (const idx of region.pixels) {
          indexMap[idx] = bestColor;
        }
      }
    }
    attempt += 1;
    if (!changed || attempt > 6) {
      threshold = Math.max(1, Math.floor(threshold / 2));
    }
  }
}

function finalizeGeneratedRegions(regions, width) {
  if (!Array.isArray(regions)) {
    return;
  }
  for (const region of regions) {
    const hasPixels = Array.isArray(region.pixels) && region.pixels.length > 0;
    const count =
      typeof region.pixelCount === "number" && Number.isFinite(region.pixelCount)
        ? region.pixelCount
        : hasPixels
        ? region.pixels.length
        : 0;
    if (hasPixels && count > 0) {
      let sumX = 0;
      let sumY = 0;
      for (const idx of region.pixels) {
        sumX += idx % width;
        sumY += (idx / width) | 0;
      }
      region.cx = sumX / count;
      region.cy = sumY / count;
    } else {
      region.cx = 0;
      region.cy = 0;
    }
    region.colorId += 1;
  }
}

function serializeAssignments(pixels, centroids) {
  const assignments = new Uint16Array(pixels.length / 4);
  for (let i = 0; i < assignments.length; i++) {
    const base = i * 4;
    let best = 0;
    let bestDist = Infinity;
    for (let c = 0; c < centroids.length; c++) {
      const centroid = centroids[c];
      const dr = pixels[base] - centroid[0];
      const dg = pixels[base + 1] - centroid[1];
      const db = pixels[base + 2] - centroid[2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    assignments[i] = best;
  }
  return assignments;
}

function kmeansQuantize(pixels, width, height, targetColors, iterations, sampleRate) {
  const totalPixels = width * height;
  const sampleCount = Math.max(targetColors * 4, Math.floor(totalPixels * clamp(sampleRate, 0.05, 1)));
  const sampleIndexes = new Uint32Array(Math.min(sampleCount, totalPixels));
  const step = Math.max(1, Math.floor(totalPixels / sampleIndexes.length));
  let pointer = 0;
  for (let idx = 0; idx < totalPixels && pointer < sampleIndexes.length; idx += step) {
    sampleIndexes[pointer++] = idx;
  }
  while (pointer < sampleIndexes.length) {
    sampleIndexes[pointer++] = Math.floor(Math.random() * totalPixels);
  }
  const centroids = [];
  for (let i = 0; i < targetColors; i++) {
    const sampleIdx = sampleIndexes[i % sampleIndexes.length];
    const base = sampleIdx * 4;
    centroids.push([
      pixels[base],
      pixels[base + 1],
      pixels[base + 2],
    ]);
  }
  const sums = new Array(targetColors).fill(null).map(() => [0, 0, 0, 0]);
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < targetColors; i++) {
      sums[i][0] = 0;
      sums[i][1] = 0;
      sums[i][2] = 0;
      sums[i][3] = 0;
    }
    for (let i = 0; i < sampleIndexes.length; i++) {
      const idx = sampleIndexes[i];
      const base = idx * 4;
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const centroid = centroids[c];
        const dr = pixels[base] - centroid[0];
        const dg = pixels[base + 1] - centroid[1];
        const db = pixels[base + 2] - centroid[2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      sums[best][0] += pixels[base];
      sums[best][1] += pixels[base + 1];
      sums[best][2] += pixels[base + 2];
      sums[best][3] += 1;
    }
    for (let c = 0; c < centroids.length; c++) {
      const bucket = sums[c];
      if (bucket[3] === 0) continue;
      centroids[c][0] = bucket[0] / bucket[3];
      centroids[c][1] = bucket[1] / bucket[3];
      centroids[c][2] = bucket[2] / bucket[3];
    }
  }
  const rounded = centroids.map((c) => c.map((value) => Math.round(value)));
  const assignments = serializeAssignments(pixels, rounded);
  return { centroids: rounded, assignments };
}

function posterizeQuantize(pixels, width, height, targetColors) {
  const totalPixels = Math.max(1, width * height);
  const quantizedKeys = new Uint32Array(totalPixels);
  const buckets = new Map();
  const normalizedTarget = Math.max(1, Math.floor(targetColors));
  const levels = Math.max(1, Math.round(Math.cbrt(normalizedTarget)));

  const quantizeChannel = (value) => {
    if (levels <= 1) {
      return clamp(value, 0, 255);
    }
    const steps = levels - 1;
    const scaled = Math.round((clamp(value, 0, 255) / 255) * steps);
    return clamp(Math.round((scaled / steps) * 255), 0, 255);
  };

  for (let i = 0; i < totalPixels; i++) {
    const base = i * 4;
    const r = quantizeChannel(pixels[base]);
    const g = quantizeChannel(pixels[base + 1]);
    const b = quantizeChannel(pixels[base + 2]);
    const key = (r << 16) | (g << 8) | b;
    quantizedKeys[i] = key;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { r: 0, g: 0, b: 0, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.r += pixels[base];
    bucket.g += pixels[base + 1];
    bucket.b += pixels[base + 2];
    bucket.count += 1;
  }

  const entries = Array.from(buckets.entries()).map(([key, bucket]) => ({
    key,
    count: bucket.count,
    color: [
      Math.round(bucket.r / bucket.count),
      Math.round(bucket.g / bucket.count),
      Math.round(bucket.b / bucket.count),
    ],
  }));

  entries.sort((a, b) => b.count - a.count);
  const paletteLimit = Math.max(1, Math.min(normalizedTarget, entries.length));
  const selected = entries.slice(0, paletteLimit);
  const centroids = selected.map((entry) => entry.color);

  if (centroids.length === 0) {
    centroids.push([0, 0, 0]);
  }

  const assignments = new Uint16Array(totalPixels);
  const keyToIndex = new Map();
  for (let idx = 0; idx < selected.length; idx++) {
    keyToIndex.set(selected[idx].key, idx);
  }

  for (let i = 0; i < totalPixels; i++) {
    const key = quantizedKeys[i];
    let paletteIndex = keyToIndex.get(key);
    if (paletteIndex == null) {
      const base = i * 4;
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const centroid = centroids[c];
        const dr = pixels[base] - centroid[0];
        const dg = pixels[base + 1] - centroid[1];
        const db = pixels[base + 2] - centroid[2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      paletteIndex = best;
      keyToIndex.set(key, paletteIndex);
    }
    assignments[i] = paletteIndex;
  }

  return { centroids, assignments };
}

function performQuantization(algorithm, pixels, width, height, options) {
  const resolved = normalizeAlgorithm(algorithm);
  switch (resolved) {
    case "local-posterize":
      return posterizeQuantize(pixels, width, height, options.targetColors);
    case "local-kmeans":
    default:
      return kmeansQuantize(
        pixels,
        width,
        height,
        options.targetColors,
        options.kmeansIters,
        options.sampleRate
      );
  }
}

function smoothAssignments(assignments, width, height, passes) {
  let current = new Uint16Array(assignments);
  for (let pass = 0; pass < passes; pass++) {
    const next = new Uint16Array(current);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const histogram = new Map();
        const baseColor = current[idx];
        histogram.set(baseColor, (histogram.get(baseColor) || 0) + 2);
        if (x > 0) accumulate(histogram, current[idx - 1]);
        if (x < width - 1) accumulate(histogram, current[idx + 1]);
        if (y > 0) accumulate(histogram, current[idx - width]);
        if (y < height - 1) accumulate(histogram, current[idx + width]);
        let bestColor = baseColor;
        let bestScore = -Infinity;
        for (const [color, score] of histogram.entries()) {
          if (score > bestScore) {
            bestScore = score;
            bestColor = color;
          }
        }
        next[idx] = bestColor;
      }
    }
    current = next;
  }
  return current;
}

function buildGenerationWorkerSource() {
  const stageMessages = JSON.stringify(GENERATION_STAGE_MESSAGES);
  return `const STAGE_MESSAGES = ${stageMessages};
const DEFAULT_GENERATION_ALGORITHM = "${DEFAULT_GENERATION_ALGORITHM}";
const now = () => (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now());
${clamp.toString()}
${accumulate.toString()}
${neighborIndexes.toString()}
${floodFill.toString()}
${segmentRegions.toString()}
${finalizeGeneratedRegions.toString()}
${serializeAssignments.toString()}
${kmeansQuantize.toString()}
${posterizeQuantize.toString()}
${normalizeAlgorithm.toString()}
${performQuantization.toString()}
${smoothAssignments.toString()}
function normalizeOptions(options) {
  const targetColors = Math.max(1, Number(options?.targetColors) || 16);
  const minRegion = Math.max(1, Number(options?.minRegion) || 1);
  const sampleRate = typeof options?.sampleRate === "number" ? options.sampleRate : 1;
  const kmeansIters = Math.max(1, Number(options?.kmeansIters) || 1);
  const smoothingPasses = Math.max(0, Number(options?.smoothingPasses) || 0);
  const algorithm = normalizeAlgorithm(options?.algorithm);
  return { targetColors, minRegion, sampleRate, kmeansIters, smoothingPasses, algorithm };
}
function postProgress(id, stage, progress, message) {
  self.postMessage({ type: "progress", id, stage, progress, message: message || STAGE_MESSAGES[stage] || "" });
}
self.onmessage = (event) => {
  const data = event?.data || {};
  const id = data.id;
  const width = data.width;
  const height = data.height;
  const options = normalizeOptions(data.options || {});
  const pixelsSource = data.pixels || data.pixelsBuffer;
  if (!Number.isFinite(width) || !Number.isFinite(height) || !pixelsSource) {
    self.postMessage({ type: "error", id, error: { message: "Invalid generation payload" } });
    return;
  }
  try {
    const pixels = pixelsSource instanceof Uint8ClampedArray
      ? pixelsSource
      : pixelsSource instanceof ArrayBuffer
      ? new Uint8ClampedArray(pixelsSource)
      : new Uint8ClampedArray(pixelsSource);
    const timings = {};
    const totalStart = now();
    postProgress(id, "quantize", 0.15, STAGE_MESSAGES.quantize);
    const quantStart = now();
    const { centroids, assignments } = performQuantization(
      options.algorithm,
      pixels,
      width,
      height,
      options
    );
    timings.quantize = now() - quantStart;
    let workingAssignments = assignments;
    if (options.smoothingPasses > 0) {
      postProgress(id, "smooth", 0.45, STAGE_MESSAGES.smooth);
      const smoothStart = now();
      workingAssignments = smoothAssignments(
        assignments,
        width,
        height,
        options.smoothingPasses
      );
      timings.smoothing = now() - smoothStart;
    } else {
      postProgress(id, "smoothSkip", 0.45, STAGE_MESSAGES.smoothSkip);
      timings.smoothing = 0;
    }
    postProgress(id, "segment", 0.75, STAGE_MESSAGES.segment);
    const segmentStart = now();
    const { regionMap, regions } = segmentRegions(
      width,
      height,
      workingAssignments,
      options.minRegion
    );
    timings.segment = now() - segmentStart;
    postProgress(id, "finalize", 0.9, STAGE_MESSAGES.finalize);
    finalizeGeneratedRegions(regions, width);
    timings.total = now() - totalStart;
    const regionMapBuffer = regionMap.buffer;
    self.postMessage(
      { type: "result", id, payload: { centroids, regions, regionMap: regionMapBuffer, timings } },
      [regionMapBuffer]
    );
  } catch (error) {
    self.postMessage({ type: "error", id, error: { message: error?.message || String(error) } });
  }
};
`;
}

function canUseGenerationWorker() {
  return (
    typeof Worker === "function" &&
    typeof Blob === "function" &&
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function"
  );
}

function ensureGenerationWorker() {
  if (generationWorkerInstance) {
    return generationWorkerInstance;
  }
  if (!canUseGenerationWorker()) {
    return null;
  }
  try {
    const source = buildGenerationWorkerSource();
    const blob = new Blob([source], { type: "application/javascript" });
    generationWorkerUrl = URL.createObjectURL(blob);
    generationWorkerInstance = new Worker(generationWorkerUrl, {
      name: "capy-generation-worker",
    });
  } catch (error) {
    console.error("Failed to initialise generation worker", error);
    disposeGenerationWorker();
    return null;
  }
  return generationWorkerInstance;
}

export function disposeGenerationWorker() {
  if (generationWorkerInstance) {
    try {
      generationWorkerInstance.terminate();
    } catch (error) {
      // ignore termination errors
    }
    generationWorkerInstance = null;
  }
  if (generationWorkerUrl) {
    URL.revokeObjectURL(generationWorkerUrl);
    generationWorkerUrl = null;
  }
}

function runGenerationWorker(message, { onProgress } = {}) {
  const worker = ensureGenerationWorker();
  if (!worker) {
    const error = new Error("Generation worker unavailable");
    error.code = "WORKER_UNAVAILABLE";
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    const jobId = message && typeof message.id === "number" ? message.id : null;
    if (!Number.isFinite(jobId)) {
      reject(new Error("Generation job missing identifier"));
      return;
    }
    const handleMessage = (event) => {
      const data = event?.data;
      if (!data || data.id !== jobId) {
        return;
      }
      if (data.type === "progress") {
        if (typeof onProgress === "function") {
          try {
            onProgress(data);
          } catch (error) {
            console.error("Progress handler failed", error);
          }
        }
        return;
      }
      cleanup();
      if (data.type === "result") {
        resolve(data.payload);
        return;
      }
      if (data.type === "error") {
        const error = new Error(data.error?.message || "Generation worker failed");
        error.code = data.error?.code || "WORKER_ERROR";
        reject(error);
        return;
      }
      reject(new Error("Unknown worker response"));
    };
    const handleError = (event) => {
      cleanup();
      disposeGenerationWorker();
      const error =
        event?.error instanceof Error
          ? event.error
          : new Error(event?.message || "Generation worker error");
      error.code = "WORKER_ERROR";
      reject(error);
    };
    const cleanup = () => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
    };
    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    try {
      worker.postMessage(message);
    } catch (error) {
      cleanup();
      disposeGenerationWorker();
      const wrapped = error instanceof Error ? error : new Error(String(error));
      wrapped.code = "WORKER_ERROR";
      reject(wrapped);
    }
  });
}

function runGenerationSynchronously(jobId, payload, hooks = {}) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const { width, height, pixels, options } = payload;
  if (!pixels || !options) {
    return null;
  }
  const { reportStage } = hooks;
  const timings = {};
  const totalStart = now();
  if (typeof reportStage === "function") {
    reportStage(jobId, 0.15, GENERATION_STAGE_MESSAGES.quantize);
  }
  const quantStart = now();
  const normalizedOptions = {
    ...options,
    algorithm: normalizeAlgorithm(options.algorithm),
  };
  const { centroids, assignments } = performQuantization(
    normalizedOptions.algorithm,
    pixels,
    width,
    height,
    normalizedOptions
  );
  timings.quantize = now() - quantStart;
  let workingAssignments = assignments;
  if (normalizedOptions.smoothingPasses > 0) {
    if (typeof reportStage === "function") {
      reportStage(jobId, 0.45, GENERATION_STAGE_MESSAGES.smooth);
    }
    const smoothStart = now();
    workingAssignments = smoothAssignments(
      assignments,
      width,
      height,
      normalizedOptions.smoothingPasses
    );
    timings.smoothing = now() - smoothStart;
  } else {
    if (typeof reportStage === "function") {
      reportStage(jobId, 0.45, GENERATION_STAGE_MESSAGES.smoothSkip);
    }
    timings.smoothing = 0;
  }
  if (typeof reportStage === "function") {
    reportStage(jobId, 0.75, GENERATION_STAGE_MESSAGES.segment);
  }
  const segmentStart = now();
  const { regionMap, regions } = segmentRegions(
    width,
    height,
    workingAssignments,
    normalizedOptions.minRegion
  );
  timings.segment = now() - segmentStart;
  if (typeof reportStage === "function") {
    reportStage(jobId, 0.9, GENERATION_STAGE_MESSAGES.finalize);
  }
  finalizeGeneratedRegions(regions, width);
  timings.total = now() - totalStart;
  return { centroids, regions, regionMap, timings };
}

export async function createPuzzleData(image, options = {}, hooks = {}) {
  if (!image || typeof image.width !== "number" || typeof image.height !== "number") {
    throw new Error("Invalid image supplied for puzzle generation");
  }
  const {
    beginJob,
    reportStage,
    isLatestJob,
    logDebug,
  } = hooks;
  const debug = typeof logDebug === "function" ? logDebug : (...args) => console.debug(...args);
  const jobIdRaw = typeof beginJob === "function" ? beginJob() : Date.now();
  const jobId = Number.isFinite(jobIdRaw) ? jobIdRaw : Date.now();
  if (typeof reportStage === "function") {
    reportStage(jobId, 0, GENERATION_STAGE_MESSAGES.prepare);
  }

  const {
    targetColors = 16,
    minRegion = 1,
    maxSize = Math.max(image.width, image.height),
    sampleRate = 1,
    kmeansIters = 1,
    smoothingPasses = 0,
    algorithm = DEFAULT_GENERATION_ALGORITHM,
  } = options;

  const scale = Math.min(maxSize / image.width, maxSize / image.height, 1);
  const width = Math.max(8, Math.round(image.width * scale));
  const height = Math.max(8, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable");
  }
  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const normalizedAlgorithm = normalizeAlgorithm(algorithm);
  const provider = GENERATION_ALGORITHMS[normalizedAlgorithm];
  const payloadOptions = {
    targetColors,
    minRegion,
    sampleRate,
    kmeansIters,
    smoothingPasses,
    algorithm: normalizedAlgorithm,
  };
  if (provider) {
    debug(`Using ${provider.label} generator (${provider.mode})`);
  } else {
    debug(`Using ${normalizedAlgorithm} generator`);
  }
  const workerMessage = {
    id: jobId,
    width,
    height,
    pixels,
    options: payloadOptions,
  };

  let result = null;
  if (canUseGenerationWorker()) {
    try {
      result = await runGenerationWorker(workerMessage, {
        onProgress: (event) => {
          if (!event || event.id !== jobId) {
            return;
          }
          const label =
            typeof event.message === "string" && event.message
              ? event.message
              : GENERATION_STAGE_MESSAGES[event.stage] || null;
          if (typeof reportStage === "function") {
            reportStage(jobId, event.progress, label);
          }
        },
      });
    } catch (error) {
      if (!error || error.code !== "WORKER_UNAVAILABLE") {
        console.warn(
          "Generation worker unavailable, falling back to main-thread processing.",
          error
        );
      }
      debug("Generation worker fallback to main thread");
      disposeGenerationWorker();
    }
  }
  if (!result) {
    result = runGenerationSynchronously(jobId, {
      width,
      height,
      pixels,
      options: payloadOptions,
    }, hooks);
  }
  if (!result) {
    throw new Error("Generation pipeline returned no data");
  }
  const isLatest = typeof isLatestJob === "function" ? isLatestJob(jobId) : true;
  if (!isLatest) {
    debug("Discarded superseded generation result");
    return null;
  }
  if (typeof reportStage === "function") {
    reportStage(jobId, 1, GENERATION_STAGE_MESSAGES.complete);
  }
  const { centroids, regions, regionMap, timings } = result;
  const resolvedRegionMap =
    regionMap instanceof Int32Array ? regionMap : new Int32Array(regionMap);
  const palette = centroids.map((c, idx) => {
    const hex = `#${toHex(c[0])}${toHex(c[1])}${toHex(c[2])}`;
    return {
      id: idx + 1,
      hex,
      rgba: c,
      name: hex.toUpperCase(),
    };
  });
  const formatDuration = (value) =>
    Number.isFinite(value) ? `${Math.round(value)} ms` : "n/a";
  debug(`Quantized ${targetColors} colours in ${formatDuration(timings?.quantize)}`);
  if (smoothingPasses > 0) {
    debug(
      `Smoothed assignments (${smoothingPasses} passes) in ${formatDuration(timings?.smoothing)}`
    );
  }
  debug(
    `Segmented ${regions.length} regions (≥${minRegion}px²) in ${formatDuration(timings?.segment)}`
  );
  debug(`Generation pipeline finished in ${formatDuration(timings?.total)}`);
  return {
    width,
    height,
    palette,
    regions,
    regionMap: resolvedRegionMap,
  };
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("unload", () => {
    try {
      disposeGenerationWorker();
    } catch (error) {
      // ignore
    }
  });
}
