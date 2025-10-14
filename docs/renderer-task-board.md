# Renderer Task Board

This task board breaks down the renderer refactor initiative into actionable items that can be tracked independently. Tasks are grouped by phase to reflect the recommended implementation sequence.

## Phase 1 – Scaffolding

- [ ] **Introduce renderer abstraction**
  - Create a renderer interface with `drawPuzzle`, `highlightRegions`, and `readRegionAtPoint` methods.
  - Wrap the existing Canvas 2D drawing code in a `Canvas2DRenderer` implementation.
  - Ensure feature flags or capability checks can swap between Canvas 2D and WebGL renderers without regressing current behavior.

- [ ] **Prepare view infrastructure for renderer switching**
  - Update the initialization flow so renderers are instantiated once and persisted across interactions.
  - Fall back to the Canvas renderer gracefully when WebGL context acquisition fails.
  - Document the runtime conditions that trigger a fallback for QA reference.

## Phase 2 – Geometry Pipeline

- [ ] **Extend render cache with GPU buffers**
  - Reuse `ensureRenderCache` data to produce triangulated meshes for each region.
  - Cache vertex/index buffers alongside existing `Path2D` instances for reuse across frames.
  - Add invalidation hooks so geometry is regenerated when the underlying outline data changes.

- [ ] **Add triangulation helper module**
  - Place the helper near the render cache utilities in `index.html`.
  - Accept cached `Path2D` inputs and return typed arrays suitable for WebGL uploads.
  - Cover degenerate or concave polygons to prevent GPU artifacts.

## Phase 3 – WebGL Rendering

- [ ] **Implement WebGL renderer skeleton**
  - Initialize WebGL context, shader programs for fills/outlines/highlights, and shared uniforms.
  - Allocate an offscreen framebuffer that stores region IDs for hit testing.
  - Wire draw calls to consume the cached vertex buffers produced in Phase 2.

- [ ] **Integrate hit-testing via framebuffer reads**
  - Provide `readRegionAtPoint` to sample the region-ID framebuffer.
  - Ensure readback performance stays interactive by throttling or batching reads as needed.
  - Update interaction handlers to rely on renderer-provided hit-testing instead of Canvas path checks.

## Phase 4 – View Transform & UI Polish

- [ ] **Replace CSS zoom with renderer-managed transforms**
  - Remove `transform: scale(var(--zoom))` from `#canvasTransform`.
  - Update `applyViewTransform` so it updates projection matrices and resizes canvases on zoom/pan/DPR changes.
  - Verify both renderers respond correctly to devicePixelRatio updates.

- [ ] **Overlay numbers rendering**
  - Start with a synchronized Canvas 2D overlay for number labels.
  - Keep overlay transforms in sync with the primary renderer matrices.
  - Investigate moving to WebGL SDF text once the overlay is stable.

## Phase 5 – Testing & Documentation

- [ ] **Expand automated coverage**
  - Extend Playwright tests to assert outline thickness and hit-testing accuracy at various zoom levels.
  - Capture new baseline screenshots or artifacts demonstrating the WebGL renderer output.
  - Record manual QA scenarios for fallback behavior in the README and relevant docs.

- [ ] **Documentation updates**
  - Summarize architecture changes in `README.md` and the contributor onboarding guides.
  - Note new helpers or devtools hooks introduced during the refactor.
  - Provide troubleshooting steps for WebGL context failures and GPU compatibility issues.

