# Capy Paint Roadmap (`ROADMAP.md`)

High-level product direction for **Capy Paint** ([`web/`](./web/), [`app/`](./app/), and [`worker/`](./worker/)). Active tasks, bug reports, and feature plans live in [GitHub Issues](https://github.com/capyboop/paint/issues); shipped history lives in [`CHANGELOG.md`](./CHANGELOG.md).

**Related Guides**: [`README.md`](./README.md) | [`CONTRIBUTING.md`](./CONTRIBUTING.md) | [`SUPPORT.md`](./SUPPORT.md) | [`SECURITY.md`](./SECURITY.md) | [`PROJECT.md`](./PROJECT.md) | [`DEV.md`](./DEV.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`APP.md`](./APP.md) | [`CLOUD.md`](./CLOUD.md) | [`TESTING.md`](./TESTING.md) | [`CHANGELOG.md`](./CHANGELOG.md)

---

## Now (Active Focus)

- **Google Play Store Launch (`com.capyboop.paint`)**: Publish the Phone & Tablet release bundle and finalize store listing assets.
- **Bidirectional Local AI Infinite Zoom**: Zoom into any painted section to reveal new contiguous detail or extend outward past canvas borders with optional on-device prompts (offline-first).
- **Puzzle Generation Quality**: Improve segmentation clarity, micro-region merging, and line-art edge fidelity for custom photos and built-in packs.

## Next (Planned Enhancements)

- **Tutorial & Onboarding Polish**: Refine first-run guidance, contextual tips, and Settings clarity based on player feedback.
- **Account Login & Cloud Sync Polish**: Expand cross-device sync reliability and onboarding across Google Drive, Microsoft OneDrive, Apple CloudKit, and Google Play Games.
- **In-Game Feedback & Community Packs**: Streamline in-app bug reports, puzzle idea submissions, and curated community artwork drops.
- **Daily Retention & Accessibility**: Daily featured puzzle streak medals, colorblind pattern/high-contrast overlays, and optional melodic Web Audio & fill-bloom polish.

## Later (Exploratory & Platform Icebox)

- **Shareable Time-Lapse Video Exports**: Client-side WebM/MP4 coloring replay exports directly from the canvas.
- **Android TV & Living-Room Co-op**: D-pad/controller focus navigation (`Leanback`) and local party coloring mode.
- **Additional Storefronts**: Native desktop (macOS/Windows/Linux) and iOS wrappers once Web + Android core workflows stabilize.
- **Optional Tier 2 In-Browser WebGPU/WASM AI**: Opt-in local model worker for richer generative zoom without server costs.
