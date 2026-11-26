# Capy Paint Roadmap (`ROADMAP.md`)

High-level product direction for **Capy Paint** ([`web/`](./web/), [`app/`](./app/), and [`worker/`](./worker/)). Active tasks, bug reports, and feature plans live in [GitHub Issues](https://github.com/capyboop/paint/issues); shipped history lives in [`CHANGELOG.md`](./CHANGELOG.md).

**Related Guides**: [`README.md`](./README.md) | [`CHANGELOG.md`](./CHANGELOG.md) | [`PROJECT.md`](./PROJECT.md) | [`DEV.md`](./DEV.md) | [`SUPPORT.md`](./SUPPORT.md)

---

## Now (Active Focus)

- **Google Play Store Launch (`com.capyboop.paint`)**: Publish the Phone & Tablet release bundle and finalize store listing assets.
- **Unified Single-Canvas Infinite Zoom**: Expand the existing local **Infinite Zoom 2x Detail Tile** into seamless single-canvas zooming and outward border extension with optional generative artwork.
- **Puzzle Generation Quality**: Improve segmentation clarity, micro-region merging, and line-art edge fidelity for custom photos and built-in packs.

## Next (Planned Enhancements)

- **Tutorial & Onboarding Polish**: Refine first-run guidance, contextual tips, and Settings clarity based on player feedback.
- **Account Login & Cloud Sync Rollout**: Polish and enable opt-in cross-device sync across Google Drive, Microsoft OneDrive, Apple CloudKit, and Google Play Games.
- **Community Packs & Feedback Enhancements**: Expand the existing anonymous **Send Feedback** flow and local **Puzzle Idea Notebook** with curated community artwork drops.
- **Daily Retention & Accessibility**: Daily featured puzzle streak medals, colorblind pattern/high-contrast overlays, and optional melodic Web Audio & fill-bloom polish.

## Later (Exploratory & Platform Icebox)

- **Shareable Time-Lapse Video Exports**: Client-side WebM/MP4 coloring replay exports directly from the canvas.
- **Android TV & Living-Room Co-op**: Expand the existing Android TV Leanback manifest/banner with full D-pad/controller reticle navigation and local party coloring mode.
- **Additional Storefronts**: Native desktop (macOS/Windows/Linux) and iOS wrappers once Web + Android core workflows stabilize.
- **Optional Tier 2 In-Browser WebGPU/WASM AI**: Opt-in local model worker for richer generative zoom without server costs.
