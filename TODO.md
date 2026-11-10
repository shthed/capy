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

## Milestone 1: Modular Cloud Architecture, Google Play Store Release, Play Games v2 & Steam Parity

- [ ] **Hexagonal Provider Ports & Zero-Lock-In Adapters (`web/src/services/providers/`)**:
  - Define clean TypeScript interfaces (`AuthProvider`, `CloudSaveProvider`, `RealtimeRoomProvider`, `CatalogStorageProvider`, `AiArtworkProvider`, `MonetizationProvider`) so storage, auth, multiplayer, and AI services swap cleanly across Cloudflare, Google Cloud/Firebase, Microsoft Azure, Valve Steamworks, or static CDN/P2P providers.
  - Keep anonymous local-first offline gameplay as the default baseline (`LocalAnonymousAuthAdapter` + `IndexedDbSaveAdapter`) so sign-in is always optional.
- [ ] **Google Play Store `.aab` Release Pipeline & Signing (`app/`)**:
  - Enable R8 minification and resource shrinking (`isMinifyEnabled = true`, `isShrinkResources = true`) in [`app/build.gradle.kts`](./app/build.gradle.kts).
  - Add `:app:bundleRelease` (`.aab` Android App Bundle) configuration with environment-injected keystore signing, Play Store privacy policy URL, Data Safety declarations, and IARC age rating metadata.
- [ ] **Google Play Games Services v2 Integration (`app/` & `NativeBridge.ts`)**:
  - Integrate `com.google.android.gms:play-services-games-v2` in `app/` and expose `signInPlayGames()`, `getPlayerProfile()`, `unlockAchievement(id)`, `submitLeaderboardScore(boardId, score)`, `saveCloudSnapshot(slotName, bytes, desc, playedMs)`, and `loadCloudSnapshot(slotName)` on `CapyAndroidBridge.kt`.
  - Implement CRDT union-merge conflict resolution (`CapyCodec.mergeProgressDeltas`) using Google Play Games `SnapshotsClient` (up to 3 MB free cloud save storage per player) so zero progress is ever lost across offline/online devices.
- [ ] **Cross-Device Web Login & Steam Desktop Packaging (`desktop/`)**:
  - Add optional OIDC sign-in (Google Identity Services / OAuth PKCE) for cross-device Web <-> Android cloud sync of compact `ProgressDeltaV2` tokens (`< 2 KB` per save).
  - Scaffold a lightweight Tauri v2 desktop wrapper (`desktop/`) hosting `web/dist/` with `steamworks-rs` adapters for Steam Cloud (`ISteamRemoteStorage`), Steam Achievements, and Steam Rich Presence.
- [ ] **Dynamic System Theme Sync & iOS WKWebView Wrapper**:
  - Bridge Android `Configuration.uiMode` changes from `MainActivity.kt` into `NativeBridge.ts` for optional automatic light/dark canvas background switching.
  - Package `web/dist/` inside a lightweight Swift `WKWebView` iOS wrapper connected to `window.webkit.messageHandlers.CapyIOS`.

---

## Milestone 2: Shareable Game Links & Real-Time Simultaneous Co-op Multiplayer

- [ ] **Shareable Puzzle & Progress Deep Links (`?puzzle=` / `?room=` & Android App Links)**:
  - Support opening `#p=<catalogId>&d=<ProgressDeltaToken>` and `?room=<roomCode>` URLs directly in `App.tsx`, plus Android verified App Links (`assetlinks.json` + `intent-filter` with `android:autoVerify="true"`).
  - Allow one-tap link sharing of any built-in, catalog, or custom puzzle (uploading encrypted/content-addressed `.capy` v2 blobs only when sharing custom user photos).
- [ ] **Simultaneous Co-op Multiplayer (`CoopSessionService.ts` + CRDT Room Sync)**:
  - Build real-time co-op rooms using pluggable `RealtimeRoomProvider` adapters (WebRTC DataChannel P2P mesh for 2-8 players with hibernating WebSocket Edge Room fallback for larger rooms or strict NATs).
  - Synchronize region fills (`FILL` / `UNFILL` / `PAINT_FREE`) via Yjs / monotonic Lamport CRDTs so simultaneous taps never conflict or overwrite teammates' strokes.
  - Render ephemeral teammate presence badges, live viewport cursors, and color attribution bursts on `PuzzleCanvas` offscreen overlay without React state churn.

---

## Milestone 3: Opt-In Rewarded Ads & AI Generation Credit Economy

- [ ] **Consent-First Rewarded Ad Adapter (`MonetizationProvider`)**:
  - Integrate Google UMP SDK (GDPR/CCPA consent) + Google Mobile Ads SDK (`RewardedAd`) on Android, strictly opt-in when players choose to earn AI puzzle/zoom credits (zero forced interstitials or banners; 100% ad-free on Steam).
  - Implement cryptographic Server-Side Verification (SSV) callback validation to mint tamper-proof AI generation credits (`AiCreditLedger`).

---

## Milestone 4: Community Puzzle Idea Submissions, Searchable Gallery & Automated AI Artwork Pipeline

- [ ] **Gallery Search, Tag Chips & External Cloud Catalog**:
  - Add real-time search and tag chip filtering (`Animals`, `Nature`, `Coloring`, `Line Art`, `Detailed`, `Community`, etc.) in the Create / Gallery tab, consuming `SampleArtwork.tags` and paginated static CDN catalog manifests (`catalog/v1/index.json`).
  - Support zero-copy URL / `FileSystemFileHandle` / Android SAF persistent URI puzzle references via `PuzzleSourceRef` (`kind: 'catalog' | 'url'`).
- [ ] **Community Idea Submission & Voting Feed**:
  - Add a "Submit Puzzle Idea" flow with client + server prompt safety moderation, category tags, style preference (`LINE_ART`, `PAINTERLY`, `COLORING_BOOK`), and community upvoting with per-account rate limits.
- [ ] **Automated AI Artwork & Pre-Baked `.capy` Pack Pipeline (`AiArtworkProvider`)**:
  - Implement a scheduled/queue-driven worker using the pluggable `AiArtworkProvider` (defaulting to Google Gemini / Imagen API) to turn top-voted community prompts into high-contrast, region-friendly 2048x2048 WebP illustrations.
  - Pre-segment generated artwork headlessly into compact `.capy` v2 packs and publish immutably to the shared global CDN catalog so millions of players download static packs with zero per-player AI cost.

---

## Milestone 5: Multi-Resolution Quadtree Infinite Zoom with AI Detail Infill

- [ ] **Quadtree Spatial Tile Pyramid (`TilePyramidEngine`)**:
  - Extend `PuzzleData` into a sparse quadtree tile hierarchy `(level z, tileX, tileY)` where zooming past `4.0x` into a completed or active region subdivides or loads higher-detail child puzzles `(z + 1)` seamlessly aligned along parent region boundaries.
  - Apply LRU memory eviction for offscreen deep-zoom tiles while keeping ancestor overview bitmaps resident for 60 FPS zoom-out transitions.
- [ ] **Boundary-Locked AI Detail Infill & Global Tile Dedup**:
  - Generate seamless sub-tile artwork infill via `AiArtworkProvider.generateTileInfill` conditioned on the parent tile's upscaled crop and feathered boundary mask, segmenting the infill inside `puzzle.worker.ts` while clamping outer border pixels to parent region boundaries.
  - Content-address tiles by `(rootArtworkHash, z, x, y, stylePreset)` on the shared CDN so once any player explores a zoom tile, subsequent players stream it instantaneously for free.

---

## Milestone 6: Replay Animation Export & Advanced Canvas Gestures

- [ ] **Replay Animation Video and GIF Export**:
  - Allow players to export their chronological puzzle completion replay directly as a lightweight WebM/MP4 video (`MediaRecorder` / WebCodecs) or animated GIF to save or share via `NativeBridge.exportOrShareFile`.
- [ ] **Custom Pinch-to-Zoom Sensitivity and Anchor Snapping**:
  - Add configurable pinch sensitivity multiplier and optional magnetic snapping to clean scale factors (`1x`, `2x`, `4x`, `8x`).
