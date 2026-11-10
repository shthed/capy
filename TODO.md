# Capy Monorepo -- Master TODO & Active Roadmap

This document tracks active cross-project tasks, prioritized platform milestones, and upcoming engineering features across the unified **Capy** monorepo (`web/` and `app/`).

> [!NOTE]
> **Task Hygiene Rule**: Do not leave completed items in `TODO.md`. When a task, feature, or milestone is finished, remove it from this file rather than checking it off. Completed history is preserved in Git commits and pull request descriptions. Keep `TODO.md` strictly focused on active, pending work. Never use emojis or ASCII box-drawing art in documentation files.

For target-specific deep dives, see also:
- **Web Architecture and UI Reference**: [`WEB.md`](./WEB.md)
- **Puzzle Generation Engine Reference**: [`PUZZLE.md`](./PUZZLE.md)
- **Unified Android Launcher Architecture and Native Bridge**: [`APP.md`](./APP.md)
- **Testing Architecture and Verification Guide**: [`TESTING.md`](./TESTING.md)
- **Contributor and Agent Playbook**: [`AGENTS.md`](./AGENTS.md)

---

## Milestone 1: Replay Animation Export & Advanced Canvas Gestures

- [ ] **Replay Animation Video and GIF Export**:
  - Allow players to export their chronological puzzle completion replay directly as a lightweight WebM/MP4 video (`MediaRecorder` / WebCodecs) or animated GIF to save or share via `NativeBridge.exportOrShareFile`.
- [ ] **Custom Pinch-to-Zoom Sensitivity and Anchor Snapping**:
  - Add a configurable pinch-to-zoom sensitivity multiplier and optional magnetic snapping to clean scale factors (`1x`, `2x`, `4x`, `8x`) in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) and [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx).

---

## Milestone 2: Deep Quadtree Spatial Pyramid & Boundary-Locked AI Infill

- [ ] **Continuous Quadtree Tile Pyramid (`TilePyramidEngine`) & AI Boundary-Locked Infill**:
  - Extend the 2x detail sub-tile generator into a continuous sparse quadtree hierarchy `(z, tileX, tileY)` with LRU offscreen tile eviction and server-cached AI detail infill (`AiArtworkProvider.generateTileInfill`) clamped seamlessly to parent region boundaries.

---

## Milestone 3: Global Internet Co-op Relay & Encrypted Photo Share Uploads

- [ ] **Edge WebSocket / WebRTC Global Co-op Relay (`VITE_CAPY_ROOM_WS_URL`)**:
  - Deploy a lightweight hibernating WebSocket room relay (Cloudflare Durable Objects or Firebase Realtime room endpoint) backing `HybridCoopRoomAdapter` so 6-character Co-op room codes connect players across separate devices and networks worldwide, with optional WebRTC DataChannel P2P mesh upgrade.
- [ ] **Content-Addressed Encrypted `.capy` v2 Uploads for Custom Photo Sharing**:
  - Allow optional one-tap link sharing of user-uploaded custom photo puzzles by uploading an encrypted, content-addressed `.capy` v2 binary pack to object storage when the user explicitly opts in.

---

## Milestone 4: Scheduled AI Artwork Pipeline & Global CDN Catalog Expansion

- [ ] **Automated AI Artwork & Pre-Baked `.capy` v2 CDN Pipeline**:
  - Build a scheduled backend queue worker consuming top-voted `CommunityPuzzleIdea` entries via `AiArtworkProvider` (Google Imagen / Gemini image generation), pre-segmenting 2048x2048 WebP illustrations headlessly into compact `.capy` v2 packs, and publishing paginated `catalog/v1/index.json` manifests to a shared global CDN.

---

## Milestone 5: Storefront Credentials, Cross-Device OIDC Vault, AdMob SSV & Desktop/iOS Packaging

- [ ] **Google Play Console Production Credentials & `assetlinks.json` Deployment**:
  - Provision the Google Play Console Game Project ID, attach `com.google.android.gms:play-services-games-v2` credentials in `app/`, and wire live `PlayGames.getSnapshotsClient` + `AchievementsClient` + `LeaderboardsClient` behind the existing `CapyAndroidBridge` hooks.
  - Publish `/.well-known/assetlinks.json` with the Play App Signing SHA-256 certificate fingerprint on GitHub Pages so `android:autoVerify="true"` App Links verify automatically on Android devices.
- [ ] **Cross-Device Web OIDC Login & Hosted Cloud Vault Backend**:
  - Connect a remote cloud storage adapter (`CloudSaveProvider`) with optional OAuth PKCE / Google Identity Services sign-in so `< 2 KB` `ProgressDeltaV2` envelopes sync across Web and Android devices over the internet.
- [ ] **Google UMP Consent + Mobile Ads SDK & SSV Credit Minting**:
  - Wire Google User Messaging Platform (GDPR/CCPA consent) and `RewardedAd` inside `CapyAndroidBridge.showRewardedAd()` with cryptographic Server-Side Verification (SSV) callbacks minting cloud-verified `AiCreditLedger` balances.
- [ ] **Steam Desktop Wrapper (`desktop/`) & iOS `WKWebView` Wrapper**:
  - Scaffold a Tauri v2 desktop wrapper (`desktop/`) hosting `web/dist/` with `steamworks-rs` adapters for Steam Cloud (`ISteamRemoteStorage`), Steam Achievements, and Steam Rich Presence.
  - Package `web/dist/` inside a Swift `WKWebView` iOS wrapper connected to `window.webkit.messageHandlers.CapyIOS`, and bridge Android `Configuration.uiMode` system theme changes into `NativeBridge.ts`.
