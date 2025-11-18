"use strict";

import { buildPathData } from "./vector-data.js";

const DEFAULT_OVERLAY_FILL = "rgba(248, 250, 252, 1)";
const DEFAULT_OUTLINE = "rgba(15, 23, 42, 0.65)";

export class SceneGraph {
  constructor() {
    this.regionElements = new Map();
  }

  rebuild(cache, { documentRef, filledGroup, outlineGroup }) {
    if (!documentRef || !filledGroup || !outlineGroup) {
      return;
    }
    this.regionElements.clear();
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
      const fillPath = documentRef.createElementNS("http://www.w3.org/2000/svg", "path");
      fillPath.setAttribute("d", pathData);
      fillPath.setAttribute("fill", "none");
      fillPath.setAttribute("stroke", "none");
      filledGroup.appendChild(fillPath);

      const outlinePath = documentRef.createElementNS("http://www.w3.org/2000/svg", "path");
      outlinePath.setAttribute("d", pathData);
      outlinePath.setAttribute("fill", "none");
      outlineGroup.appendChild(outlinePath);

      this.regionElements.set(geometry.id, {
        geometry,
        pathData,
        fillPath,
        outlinePath,
      });
    }
  }

  updateFilledState(filledState, overlayColor = DEFAULT_OVERLAY_FILL) {
    const targetFill = typeof overlayColor === "string" && overlayColor ? overlayColor : DEFAULT_OVERLAY_FILL;
    this.regionElements.forEach((entry, id) => {
      if (!entry?.fillPath) {
        return;
      }
      if (filledState?.set?.has(id)) {
        entry.fillPath.setAttribute("fill", "none");
      } else {
        entry.fillPath.setAttribute("fill", targetFill);
      }
    });
  }

  updateOutlineStyle(color = DEFAULT_OUTLINE, strokeWidth = 1) {
    this.regionElements.forEach((entry) => {
      if (!entry?.outlinePath) return;
      entry.outlinePath.setAttribute("stroke", color);
      entry.outlinePath.setAttribute("stroke-width", String(strokeWidth || 1));
      entry.outlinePath.setAttribute("stroke-linejoin", "round");
      entry.outlinePath.setAttribute("stroke-linecap", "round");
    });
  }

  getElements() {
    return this.regionElements;
  }

  getById(id) {
    return this.regionElements.get(id) || null;
  }

  clear() {
    this.regionElements.clear();
  }
}

export default SceneGraph;
