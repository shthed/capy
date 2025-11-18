"use strict";

export const FRAME_LOG_INTERVAL_MS = 1000;

export function getTimestamp() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export function createFrameLogger(label) {
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

export default {
  FRAME_LOG_INTERVAL_MS,
  getTimestamp,
  createFrameLogger,
};

