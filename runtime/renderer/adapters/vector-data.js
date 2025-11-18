"use strict";

const DEFAULT_OVERLAY_FILL = "rgba(248, 250, 252, 1)";
const DEFAULT_OUTLINE = "rgba(15, 23, 42, 0.65)";
const DEFAULT_NUMBER = "rgba(15, 23, 42, 0.95)";

export function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const rounded = Math.round(value * 1000) / 1000;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return rounded.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function buildPathData(geometry) {
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

export function getFilledState(source) {
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

export function computeInkStyles(hex) {
  const rgb = hexToRgb(hex);
  const luminance = relativeLuminance(rgb);
  if (luminance < 0.45) {
    return {
      outline: "rgba(248, 250, 252, 0.75)",
      number: "rgba(248, 250, 252, 0.95)",
    };
  }
  return {
    outline: DEFAULT_OUTLINE,
    number: DEFAULT_NUMBER,
  };
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

export function ensureRegionBounds(region, width) {
  if (region && region.bounds) {
    return { ...region.bounds };
  }
  if (!region || !Array.isArray(region.pixels) || region.pixels.length === 0) {
    return { minX: 0, minY: 0, maxX: width, maxY: width };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const idx of region.pixels) {
    const x = idx % width;
    const y = (idx / width) | 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { minX: 0, minY: 0, maxX: width, maxY: width };
  }
  return {
    minX,
    minY,
    maxX: maxX + 1,
    maxY: maxY + 1,
  };
}

export function buildRegionContours(region, width, height) {
  const pixels = Array.isArray(region?.pixels) ? region.pixels : [];
  if (pixels.length === 0) {
    return [];
  }
  const membership = new Set(pixels);
  const edges = [];
  const outgoing = new Map();
  const vertexKey = (x, y) => `${x},${y}`;
  const pushEdge = (ax, ay, bx, by) => {
    const edge = { ax, ay, bx, by };
    const index = edges.length;
    edges.push(edge);
    const key = vertexKey(ax, ay);
    if (!outgoing.has(key)) {
      outgoing.set(key, []);
    }
    outgoing.get(key).push(index);
  };
  for (const idx of membership) {
    const x = idx % width;
    const y = (idx / width) | 0;
    const up = idx - width;
    const down = idx + width;
    const left = idx - 1;
    const right = idx + 1;
    if (y === 0 || !membership.has(up)) {
      pushEdge(x, y, x + 1, y);
    }
    if (x === width - 1 || !membership.has(right)) {
      pushEdge(x + 1, y, x + 1, y + 1);
    }
    if (y === height - 1 || !membership.has(down)) {
      pushEdge(x + 1, y + 1, x, y + 1);
    }
    if (x === 0 || !membership.has(left)) {
      pushEdge(x, y + 1, x, y);
    }
  }
  if (edges.length === 0) {
    return [];
  }
  const unused = new Set(edges.map((_, index) => index));
  const contours = [];
  const getVector = (edge) => ({ dx: edge.bx - edge.ax, dy: edge.by - edge.ay });
  const originKey = (edge) => `${edge.ax},${edge.ay}`;
  const limit = edges.length * 8;
  while (unused.size > 0) {
    const startIndex = unused.values().next().value;
    let currentIndex = startIndex;
    const startEdge = edges[startIndex];
    const startKey = originKey(startEdge);
    const contour = [];
    let guard = 0;
    while (true) {
      const edge = edges[currentIndex];
      if (contour.length === 0) {
        contour.push([edge.ax, edge.ay]);
      }
      contour.push([edge.bx, edge.by]);
      unused.delete(currentIndex);
      const nextKey = `${edge.bx},${edge.by}`;
      if (nextKey === startKey) {
        break;
      }
      const candidates = outgoing.get(nextKey) || [];
      let nextIndex = null;
      if (candidates.length === 1) {
        if (unused.has(candidates[0])) {
          nextIndex = candidates[0];
        }
      } else {
        const prevVector = getVector(edge);
        let bestAngle = Number.POSITIVE_INFINITY;
        for (const candidateIndex of candidates) {
          if (!unused.has(candidateIndex)) continue;
          const candidate = edges[candidateIndex];
          const vec = getVector(candidate);
          const cross = prevVector.dx * vec.dy - prevVector.dy * vec.dx;
          const dot = prevVector.dx * vec.dx + prevVector.dy * vec.dy;
          let angle = Math.atan2(cross, dot);
          if (angle <= 0) {
            angle += Math.PI * 2;
          }
          if (angle < bestAngle) {
            bestAngle = angle;
            nextIndex = candidateIndex;
          }
        }
      }
      if (nextIndex == null) {
        break;
      }
      currentIndex = nextIndex;
      guard += 1;
      if (guard > limit) {
        break;
      }
    }
    if (contour.length > 1) {
      const first = contour[0];
      const last = contour[contour.length - 1];
      if (first[0] === last[0] && first[1] === last[1]) {
        contour.pop();
      }
      contours.push(contour);
    }
    if (contours.length > edges.length) {
      break;
    }
  }
  return contours;
}

export default {
  formatNumber,
  buildPathData,
  getFilledState,
  computeInkStyles,
  ensureRegionBounds,
  buildRegionContours,
};
