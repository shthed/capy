# Capy Monorepo -- Master TODO & Active Roadmap

This document tracks active cross-project tasks, prioritized platform milestones, and unimplemented production features across the unified **Capy** monorepo (`web/` and `app/`).

> [!NOTE]
> **Task Hygiene Rule**: Do not leave completed items in `TODO.md`. When a task, feature, or milestone is finished, remove it from this file immediately rather than checking it off. Completed history is preserved in Git commits and pull request descriptions. Keep `TODO.md` strictly focused on active, pending work. Never use emojis or ASCII box-drawing art in documentation files.

For subsystem references, see:
- **Web Architecture and UI Reference**: [`WEB.md`](./WEB.md)
- **Puzzle Generation Engine Reference**: [`PUZZLE.md`](./PUZZLE.md)
- **Unified Android Launcher Architecture and Native Bridge**: [`APP.md`](./APP.md)
- **Cloud Sync, Google Play Games & Multiplayer Architecture**: [`CLOUD.md`](./CLOUD.md)
- **Testing Architecture and Verification Guide**: [`TESTING.md`](./TESTING.md)
- **Contributor and Agent Playbook**: [`AGENTS.md`](./AGENTS.md)

---

## Milestone 1: Google Play Games Achievements, Leaderboards & Storefront Credentials

- [ ] **Google Play Games Achievements & Leaderboards (`AchievementsClient` & `LeaderboardsClient`)**:
  - Define Play Console achievement IDs in `app/src/main/res/values/games-ids.xml` (First Puzzle Completed, 1,000 Regions Colored, Co-op Collaborator, Speed Painter, Zero-Hint Master) and expose `NativeBridge.unlockAchievement(id)` / `NativeBridge.incrementAchievement(id, steps)` and `NativeBridge.submitLeaderboardScore(id, score)` hooks.
- [ ] **Google Play Console Production Credentials & Verified `assetlinks.json`**:
  - Provision the production 12-digit Play Games Project ID (`CAPY_PLAY_GAMES_APP_ID`) and Web OAuth Client ID (`VITE_GOOGLE_CLIENT_ID`), register Upload Key and Play App Signing SHA-1/SHA-256 certificate fingerprints in Google Play Console, and publish `web/public/.well-known/assetlinks.json` so `android:autoVerify="true"` App Links verify automatically on Android devices.
- [ ] **Steam, Microsoft & Apple Cloud Driver Bindings**:
  - Connect [`SteamCloudDriver`](./web/src/services/providers/CloudProviderDrivers.ts), [`MicrosoftCloudDriver`](./web/src/services/providers/CloudProviderDrivers.ts), and [`AppleCloudDriver`](./web/src/services/providers/CloudProviderDrivers.ts) to live Steamworks (`ISteamRemoteStorage`), Microsoft Entra ID / OneDrive `special/approot`, and Apple CloudKit / GameKit (`GKSavedGame`) credentials as those desktop/iOS wrappers ship.

---

## Milestone 2: Global Internet Co-op Relay, WebRTC P2P & Custom Photo Sharing

- [ ] **Hosted WebSocket Room Relay Server (`VITE_CAPY_ROOM_WS_URL`)**:
  - Implement and deploy a lightweight hibernating WebSocket room relay (for example, a Cloudflare Worker with Durable Objects in a `relay/` workspace package) backing [`HybridCoopRoomAdapter`](./web/src/services/providers/ProviderRegistry.ts) so 6-character Co-op room codes (`?room=ABC123`) connect players across separate devices and networks over the internet.
- [ ] **WebRTC DataChannel Peer-to-Peer Upgrade & Custom Photo Transfer in Co-op Rooms**:
  - Upgrade WebSocket room signaling to establish direct `RTCPeerConnection` / `RTCDataChannel` links between room participants so real-time `PAINT_EVENT` strokes and custom user-uploaded `.capy` v2 puzzle packs stream directly peer-to-peer between players without server storage overhead.
- [ ] **Ephemeral Encrypted Cloud Blob Relay for Custom Photo Share Links (`#s=<token>`)**:
  - Currently, `#s=<token>` URL hash links work out-of-the-box across devices for built-in Gallery artworks because both devices already possess the source artwork. Add an opt-in encrypted `.capy` v2 blob upload (content-addressed SHA-256 key with 30-day TTL in object storage) so players can also share `#s=` URL links for custom uploaded photos across devices.
- [ ] **Co-op Multiplayer UX Enhancements (Collaborator Undo Sync & Canvas Ping Markers)**:
  - Broadcast `UNFILL_EVENT` messages when a collaborator undoes a region fill or changes a Free Colour override so peer canvases stay strictly consistent during undo/redo.
  - Add a tap-and-hold "Ping Region" beacon so collaborators can highlight a tricky region or request help on large puzzles.

---

## Milestone 3: Live AI Puzzle Generation, Shared Community Idea Backend & CDN Catalog

- [ ] **Live In-App AI Artwork Generation Endpoint (`VITE_CAPY_AI_API_URL`)**:
  - Connect [`DefaultAiArtworkAdapter`](./web/src/services/providers/ProviderRegistry.ts) to a live serverless image generation endpoint (Imagen 3 / Gemini / Flux) and add a "Generate Custom AI Puzzle from Prompt" workflow in the Create tab that spends verified `AiCreditLedger` credits and feeds the generated illustration directly into `puzzle.worker.ts`.
- [ ] **Shared Multi-User Backend for Community Puzzle Ideas & Voting**:
  - Currently, `StaticAndCommunityCatalogAdapter` persists community puzzle ideas (`capy_community_ideas_v1`) locally in `localStorage`. Connect it to a shared backend table/API with rate-limiting and server-side moderation so ideas submitted and upvoted by one player are visible to all players globally.
- [ ] **Automated Scheduled Community Idea -> `.capy` v2 Gallery Publisher**:
  - Build a scheduled GitHub Actions workflow / backend worker that selects top-voted `CommunityPuzzleIdea` entries, generates 2048x2048 cel-shaded illustrations, pre-bakes them into compact `.capy` v2 binary packs (`web/scripts/generate-sample-saves.mjs`), and publishes a paginated remote catalog manifest (`catalog/v1/index.json`).

---

## Milestone 4: Interactive Focal-Point Infinite Zoom Pyramid & AI Seam-Locked Inpainting

- [ ] **Focal-Point Quadtree Sub-Tile Navigation & Parent Breadcrumb Stack**:
  - Extend the current 2x center-crop detail generator (`handleZoomIntoDetailTile` in [`App.tsx`](./web/src/App.tsx)) so players can zoom into whichever specific `(focusX, focusY)` quadrant they are currently viewing on the canvas, and provide a one-tap "Zoom Out to Parent Puzzle" breadcrumb button in `GameTopBar.tsx` that restores the parent tile state.
- [ ] **AI Seam-Locked Detail Inpainting for Infinite Zoom Sub-Tiles**:
  - Wire [`DefaultAiArtworkAdapter.buildSeamLockedInfillPrompt`](./web/src/services/providers/ProviderRegistry.ts) to an image-to-image / outpainting model that synthesizes brand-new high-frequency micro-details (foliage, textures, tiny critters) inside zoomed sub-tiles while clamping outer border pixels to `lockedBoundaryPaletteHex` for invisible parent seams.

---

## Milestone 5: Native Google AdMob + UMP Consent SDK & Verified AI Credits

- [ ] **Google UMP Consent + AdMob Rewarded Video SDK Integration (`app/`)**:
  - Bundle `com.google.android.ump:user-messaging-platform` and `com.google.android.gms:play-services-ads` in `app/build.gradle.kts`, wire GDPR/CCPA consent forms in `MainActivity.kt`, and implement `CapyAndroidBridge.showRewardedAd()` with `RewardedAd.load` / `show` and Server-Side Verification (SSV) callbacks to fund live AI puzzle generation credits while keeping core coloring 100% ad-free.

---

## Milestone 6: Replay Video Export, Advanced Canvas Gestures & Desktop / iOS Packaging

- [ ] **Replay Animation Video (`.webm` / `.mp4`) & Animated GIF Export**:
  - Allow players to export their chronological puzzle completion replay directly as a shareable video (`HTMLCanvasElement.captureStream` + `MediaRecorder` / WebCodecs) or animated GIF via `NativeBridge.exportOrShareFile`.
- [ ] **Custom Pinch-to-Zoom Sensitivity and Anchor Snapping**:
  - Add a configurable pinch-to-zoom sensitivity multiplier and optional magnetic snapping to clean scale factors (`1x`, `2x`, `4x`, `8x`) in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) and [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx).
- [ ] **Steam Desktop Wrapper (`desktop/`) & iOS `WKWebView` Wrapper (`ios/`)**:
  - Scaffold a Tauri v2 desktop wrapper (`desktop/`) hosting `web/dist/` with `steamworks-rs` adapters for Steam Cloud (`ISteamRemoteStorage`) and Steam Achievements, and a Swift `WKWebView` iOS wrapper connected to `window.webkit.messageHandlers.CapyIOS`.
