# Capy Vector Color-by-Number — Puzzle Generation Engine

This document provides a comprehensive technical reference for Capy's adaptive multi-strategy vector quantization and segmentation engine.

---

## 1. Architectural Overview

Traditional paint-by-numbers algorithms rely on naive color quantization (such as uniform octree or basic K-Means) followed by simple 4-connected flood fills. When applied to real-world artwork with drawn ink outlines or photographic textures, naive approaches suffer from severe visual defects:

* **Line Art Fragmentation**: Anti-aliased black outlines get fractured into random color clusters or smudged into adjacent regions.
* **Border Bleed**: Region boundaries zig-zag haphazardly across black lines instead of following the drawn strokes.
* **Jagged Pixel Staircases & Sliver Regions**: High-frequency gradient noise produces hundreds of 1-pixel slivers and spiderweb tendrils.
* **Centroid Occlusion**: Numbers are placed at bounding box centers rather than the deepest interior point of concave regions.

Capy solves these challenges using a **strategy-pattern pipeline** with dedicated computer-vision extractors:

```
Source Canvas (HTML5 / Android Bitmap)
   │
   ├──▶ LineArtExtractor (Luminance & Sobel Gradient Analysis)
   │      └── Produces Binary Ink Line Mask M_line(x, y)
   │
   ├──▶ Strategy Dispatcher (Auto / Line Art / Painterly / Posterized / Mosaic)
   │      │
   │      ├── [1] Pre-Filtering (Kuwahara / Median / Cel-Smoothing)
   │      ├── [2] Perceptual Red-Mean K-Means++ Color Quantization
   │      └── [3] Line-Aware Region Segmentation (Zero-Gap Guarantee)
   │
   ├──▶ Line Art Handling (Absorb to Centerline vs. Unified Black Region)
   │
   └──▶ Interior Centroid Placement (Pole of Inaccessibility BFS)
          └── Emits PuzzleData (Palette, Regions, RegionMap, BorderMap)
```

---

## 2. Available Generation Algorithms

Capy provides 5 distinct segmentation algorithms tailored for different visual styles:

### 1. `AUTO` — Adaptive Multi-Strategy Classifier
* **Best for**: General use, automated pipelines, mixed artwork galleries.
* **How it works**:
  1. Samples a downscaled proxy of the source artwork.
  2. Analyzes continuous ink line presence via `LineArtExtractor`.
  3. Evaluates global vs. local variance ratio ($\text{Var}_{\text{local}} / \text{Var}_{\text{global}}$) and color cluster diversity.
  4. Automatically delegates to `LINE_ART` for drawings/cartoons, `PAINTERLY` for photos, or `POSTERIZED` for flat vector graphics.

---

### 2. `LINE_ART` — Contour & Ink Line Art Tracer
* **Best for**: Drawings, manga, cartoons, coloring book pages, comic art, and vector illustrations with black outlines.
* **Key Innovation**:
  * Extracts the crisp line mask $M_{\text{line}}$ directly from raw unblurred pixels before any spatial filtering.
  * Treats drawn outlines as rigid barrier walls during interior cel clustering, preventing colors from bleeding across lines.
  * Symmetrically expands regions into black borders using a multi-source watershed distance transform so that region borders align with the exact centerline of the artwork's ink lines.

---

### 3. `PAINTERLY` — Edge-Preserving Kuwahara Cel-Shading
* **Best for**: Photographs, realistic oil/acrylic paintings, landscapes, and portraits.
* **Key Innovation**:
  * Evaluates variance across 4 overlapping quadrants in a $5\times 5$ window ($R=2$).
  * Assigns the mean color of the quadrant with the minimum variance:
    $$Q^* = \arg\min_{i \in \{1,2,3,4\}} \sigma_i^2$$
  * Flattens micro-textures (fur, grass, skin pores) into smooth, painterly cel patches while keeping silhouette edges razor-sharp.
  * Employs two-stage circular majority smoothing to eliminate 1-pixel pinch necks.

---

### 4. `POSTERIZED` — High-Precision Geometric Posterization
* **Best for**: Logos, typography, graphic art, pop art, and high-contrast illustrations.
* **Key Innovation**:
  * Uses 3x3 median filtering to remove raster noise without rounding angular corners.
  * Runs K-Means++ with strict centroid convergence and zero spatial majority blur, preserving geometric shapes and flat color transitions.

---

### 5. `MOSAIC_CEL` — Cellular Superpixel Tessellation
* **Best for**: Stained-glass artwork, geometric mosaics, and relaxing casual puzzles.
* **Key Innovation**:
  * Seeds a grid of spatial anchors across the canvas with hexagonal jitter.
  * Computes a combined spatial-color distance metric (similar to SLIC superpixels):
    $$D(p, S_i) = \|x_p - x_{S_i}\|^2 + \|y_p - y_{S_i}\|^2 + \Delta E_{\text{color}}(p, S_i)$$
  * Generates uniform, convex, stained-glass tiles that are satisfying and easy to tap.

---

## 3. Black Border & Outline Handling Modes

When generating puzzles from artwork with black outlines, users can choose between two modes:

### Mode A: `ABSORB_LINES` (Boundaries Follow Artwork Lines)
* **Objective**: The region boundaries must accurately follow the lines from the artwork, with zero gaps.
* **Implementation**:
  1. Non-line pixels are clustered and segmented strictly within the boundaries of the black strokes.
  2. A multi-source Breadth-First Search (watershed distance transform) is initialized at all boundary pixels touching the line mask.
  3. Colored regions expand outwards into the black line pixels simultaneously.
  4. Where two opposing color regions meet inside the stroke, expansion halts.
  5. **Result**: The final vector boundary runs right down the medial axis (centerline) of the artwork's line. Both regions fit together with 100% spatial coverage.

### Mode B: `UNIFIED_BLACK_REGION` (Continuous Black Outline Region)
* **Objective**: The black outlines themselves form a single unified, playable line-art region.
* **Implementation**:
  1. Continuous line strokes ($L \le 55$ or high local edge contrast) are grouped into a single unified region.
  2. The palette allocates a dedicated pure ink swatch (`#111827` or `#000000`).
  3. Players can color the entire black outline network as a single satisfying action, mirroring traditional inking.

---

## 4. Mathematical Foundations

### 4.1 Perceptual Color Distance (Red-Mean Metric)
Standard Euclidean distance in RGB space fails to match human vision. Capy uses the Red-Mean perceptual approximation ($\Delta E$):

$$\bar{r} = \frac{R_1 + R_2}{2}$$
$$\Delta R = R_1 - R_2, \quad \Delta G = G_1 - G_2, \quad \Delta B = B_1 - B_2$$
$$\Delta E^2 = \left(2 + \frac{\bar{r}}{256}\right)\Delta R^2 + 4\Delta G^2 + \left(2 + \frac{255 - \bar{r}}{256}\right)\Delta B^2$$

This closely approximates CIE Lab $\Delta E_{76}$ while executing in pure integer/float arithmetic with zero heap allocations in inner loops.

### 4.2 Isoperimetric Compactness Ratio & Sliver Prevention
To prevent narrow, serpentine filaments that wrap around other regions:

$$\text{Compactness} = \frac{P^2}{A}$$

Where $P$ is the 4-connected boundary perimeter and $A$ is pixel area.
* A circle scores $\approx 12.6$.
* A square scores $16$.
* A smooth convex patch scores $15 \dots 35$.
* Spindly tentacles score $> 65$. Regions scoring $> 65$ or with $P / A \ge 2.0$ are flagged and merged into the most harmonious neighboring region.

### 4.3 Interior Centroid Placement (Pole of Inaccessibility)
Number labels are never placed at bounding box centers (which often fall outside crescent or concave shapes).
1. A distance transform queue is seeded at all region perimeter pixels.
2. BFS measures the shortest distance $d(p)$ from every interior pixel to the region boundary.
3. The pixel with $\max d(p)$ is selected as the centroid:
   $$\text{Centroid} = \arg\max_{p \in R} d(p)$$
4. The maximum distance $d_{\max}$ is saved as `region.maxRadius`, dynamically scaling font size and badge radius to fit cleanly inside the region without touching borders.

---

### 4.4 Hue-Preserving Region Color Recalibration
When small regions (such as red mushrooms, bright berries, or flowers) sit inside large contrasting backgrounds (such as deep green grass or dark brown forest floors):
1. **Hue Protection in Region Merging**: The merge pass enforces a strict perceptual delta boundary ($\Delta E \le 48$). High-contrast regions are never dissolved into their surroundings.
2. **True Source Pixel Recalibration**: Each region's final palette color is not assumed from arbitrary cluster IDs. Instead, the true average RGB of the source artwork pixels inside that region is computed:
   $$R_{\text{avg}} = \frac{1}{|R|}\sum_{p \in R} R_p, \quad G_{\text{avg}} = \frac{1}{|R|}\sum_{p \in R} G_p, \quad B_{\text{avg}} = \frac{1}{|R|}\sum_{p \in R} B_p$$
   The region is then mapped to the closest palette color in perceptual space. A red mushroom region containing red source pixels will always be assigned to the red palette color, preventing it from ever appearing green.

---

## 5. Web Worker Background Thread Execution

Puzzle generation involves computationally intensive computer-vision operations (Kuwahara filtering, K-Means++ clustering, BFS flood fills, and distance transform watershed expansions).

To guarantee **zero UI frame drops, smooth animations, and no browser freezes**:
* Puzzle generation executes entirely inside a dedicated **Web Worker thread** (`puzzle.worker.ts`).
* Pixel arrays and region buffers are transferred between the main thread and the worker using **zero-copy `Transferable` `ArrayBuffer` objects**.
* Progress updates are streamed continuously back to the UI thread (`onProgress(pct, status)`).
* If Web Workers are unavailable or restricted by browser security policies, the engine automatically falls back to synchronous main-thread execution.

---

## 6. Configuration Reference

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `algorithm` | `GeneratorAlgorithm` | `'AUTO'` | `'AUTO'`, `'LINE_ART'`, `'PAINTERLY'`, `'POSTERIZED'`, `'MOSAIC_CEL'` |
| `lineHandling` | `LineHandlingMode` | `'ABSORB_LINES'` | `'ABSORB_LINES'` (centerline alignment) or `'UNIFIED_BLACK_REGION'` |
| `paletteDetail` | `PaletteDetail` | `'AUTO'` | `'AUTO'`, `'LOW'`, `'MEDIUM'`, `'HIGH'`, `'CUSTOM'` |
| `colorCount` | `number` | `16` | Target palette size ($4 \dots 64$) |
| `minRegionArea` | `number` | `48` | Strictly enforced minimum pixel area per region ($15 \dots 300\text{ px}^2$) |
| `maxRegions` | `number` | `200` | Strict upper bound on total puzzle pieces ($40 \dots 2000$) |
| `resolution` | `number` | `1024` | Canvas dimension, snaps to standards or artwork percentages ($25\% \dots 100\%$) |
| `smoothingPasses` | `number` | `2` | Morphological smoothing iterations |
