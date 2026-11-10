# Capy Monorepo -- Master AAA Production Roadmap & Active Priorities

This document tracks active cross-project priorities, production readiness milestones, and unimplemented AAA features across the unified **Capy** monorepo (`web/` and `app/`).

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

## Priority Overview Matrix

| Priority Tier | Focus Domain | Core Production Goal | Target Subsystems |
| :--- | :--- | :--- | :--- |
| **P0 -- Critical Polish** | Sensory Audio, Tactile Juice & Precision Controls | Deliver immediate AAA game feel: procedural Web Audio ASMR feedback, zero-allocation fill animations, precision loupe magnifier, and custom zoom physics | `web/src/services/`, `web/src/components/PuzzleCanvas.tsx`, `web/src/components/SettingsModal.tsx` |
| **P1 -- Retention & Accessibility** | Achievements, Daily Content, Accessibility & Video Export | Drive long-term player retention and inclusivity: achievements + stats, daily challenge puzzles, colorblind pattern overlays, and `.webm`/`.mp4` replay timelapse export | `web/src/services/`, `web/src/components/`, `app/src/main/` |
| **P2 -- Engine & Infinite Zoom** | Focal-Point Infinite Zoom Pyramid & Vector Export | Allow arbitrary viewport-focused 2x sub-tile diving with parent breadcrumb navigation, seam-locked AI inpainting, and printable vector SVG/PDF sheets | `web/src/App.tsx`, `web/src/engine/`, `web/src/services/providers/` |
| **P3 -- Real-Time Multiplayer** | Internet Co-op Relay, WebRTC P2P & Undo/Ping Sync | Connect players across networks via hibernating WebSocket + WebRTC DataChannels, synchronize collaborator undos, and add interactive canvas ping beacons | `web/src/services/providers/`, `web/src/components/PuzzleCanvas.tsx` |
| **P4 -- Cloud, Storefront & AI** | Play Console Credentials, AdMob UMP & Live AI Catalog | Provision production Play Games / OAuth credentials, verified `assetlinks.json`, opt-in rewarded ads for AI credits, and live AI prompt-to-puzzle generation | `app/`, `web/public/.well-known/`, `web/src/services/providers/` |
| **P5 -- Multi-Platform Expansion** | Steam Desktop (`Tauri`), iOS (`WKWebView`) & Microsoft Store | Ship native desktop and iOS wrappers wired to Steamworks (`ISteamRemoteStorage`), Apple GameKit/CloudKit, and Microsoft OneDrive/Xbox Connected Storage | `desktop/`, `ios/`, `web/src/services/providers/CloudProviderDrivers.ts` |

---

## Priority P0: AAA Sensory Polish, Tactile Audio & Precision Controls

- [ ] **Procedural Web Audio & ASMR Sound Effects Engine (`web/src/services/SoundService.ts`)**:
  - Build a zero-asset, offline-first Web Audio API synthesizer generating soft brush/paper strokes on region tap, harmonic pentatonic marimba/woodblock pitch progression during continuous Paint Mode streaks, a warm chord arpeggio when all regions of a color swatch are completed, and a celebratory fanfare on 100% puzzle completion.
  - Add `soundEnabled: boolean` (default `true`) and `soundVolume: number` (`0.0` to `1.0`, default `0.7`) to `UserSettings` (`capy_user_settings_v8`) in [`web/src/types/index.ts`](./web/src/types/index.ts) and [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), and automatically suspend/resume `AudioContext` on page visibility changes and Android activity pause/resume.
- [ ] **Zero-Allocation Region Fill Micro-Animations & Swatch Completion Bursts (`PuzzleCanvas.tsx`)**:
  - Extend the demand-driven `requestAnimationFrame` overlay pass in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) using a pre-allocated typed ring buffer (mirroring [`CoopRippleBuffer.ts`](./web/src/engine/CoopRippleBuffer.ts)) to render a 180ms radial ink-spread / spring-bloom transition when a region is painted and a subtle shimmer wave across all regions of a newly completed palette color.
- [ ] **Floating Precision Loupe Magnifier & Crosshair Offset for Tiny Micro-Regions**:
  - Add an optional press-and-hold or Paint Mode floating magnifier lens (`showMagnifierLoupe: boolean` in `UserSettings`) offset 72px above the active touch point in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) so players on mobile screens can accurately target `< 50px` micro-regions without finger occlusion.
- [ ] **Custom Pinch-to-Zoom Sensitivity & Scale Anchor Snapping (`1x`, `2x`, `4x`, `8x`)**:
  - Add configurable `zoomSensitivity: number` (`0.5x` to `2.0x`, default `1.0x`) and `snapZoomLevels: boolean` (optional magnetic detents at `1x`, `2x`, `4x`, `8x`, and `12x`) in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) and [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx).

---

## Priority P1: Player Progression, Daily Challenges, Accessibility & Video Export

- [ ] **In-App Achievement System, Player Statistics & Native Play Games / Steam Bridges**:
  - Create `AchievementService.ts` tracking lifetime player telemetry (`totalRegionsColored`, `puzzlesCompleted`, `zeroHintPuzzles`, `fastestCompletionMs`, `freeColorCreations`, `coopRegionsPainted`, `currentDailyStreak`) persisted in `localStorage` and merged via CRDT in [`CloudProviderDrivers.ts`](./web/src/services/providers/CloudProviderDrivers.ts).
  - Render non-blocking achievement unlock toast banners and a dedicated **Profile & Achievements** drawer in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx).
  - Define Play Console achievement and leaderboard IDs in `app/src/main/res/values/games-ids.xml` and expose `NativeBridge.unlockAchievement(id)`, `NativeBridge.incrementAchievement(id, steps)`, and `NativeBridge.submitLeaderboardScore(id, score)` in [`CapyAndroidBridge.kt`](./app/src/main/java/com/capypaint/capy/CapyAndroidBridge.kt) and [`NativeBridge.ts`](./web/src/services/NativeBridge.ts).
- [ ] **Daily Featured Puzzle Rotation, Streak Calendar & Medal Tiers**:
  - Add a deterministic "Puzzle of the Day" card at the top of the **Create** tab in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx) with a visual streak counter, optional relaxed vs. zero-hint challenge badges, and automatic completion recording.
- [ ] **AAA Accessibility Suite (Colorblind Pattern Overlays, High-Contrast HUD & Reduced Motion)**:
  - Add a `colorblindPatternMode: boolean` setting that overlays distinct geometric textures (dots, diagonal stripes, crosshatch, checkerboard) onto active and hinted regions in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) so region guidance never relies solely on color perception.
  - Add `reducedMotion: boolean` (automatically respecting `prefers-reduced-motion: reduce`) to bypass confetti, camera zoom transitions, and pulsing hint animations, and add full keyboard arrow/WASD pan + `+`/`-` zoom + `1`-`9` swatch selection shortcuts.
- [ ] **Replay Animation Video (`.webm` / `.mp4`) & Animated GIF Export**:
  - Allow players to export their chronological puzzle completion replay directly from [`ReplayControls.tsx`](./web/src/components/ReplayControls.tsx) as a shareable high-resolution timelapse video (`HTMLCanvasElement.captureStream(60)` + `MediaRecorder` / WebCodecs) or animated image sequence via `NativeBridge.exportOrShareFile`.

---

## Priority P2: Interactive Infinite Zoom Pyramid & Vector Print Exports

- [ ] **Focal-Point Quadtree Sub-Tile Navigation & Parent Breadcrumb Stack**:
  - Extend `handleZoomIntoDetailTile` in [`App.tsx`](./web/src/App.tsx) so players can zoom into the exact `(focusX, focusY)` viewport center they are currently inspecting on [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) rather than a fixed center crop.
  - Persist `parentSnapshotId` and `subTileBounds` on `SavedSnapshot` and render a one-tap "Return to Parent Puzzle" breadcrumb pill in [`GameTopBar.tsx`](./web/src/components/GameTopBar.tsx) that seamlessly restores the parent puzzle viewport.
- [ ] **AI Seam-Locked Detail Inpainting for Infinite Zoom Sub-Tiles**:
  - Wire [`DefaultAiArtworkAdapter.buildSeamLockedInfillPrompt`](./web/src/services/providers/ProviderRegistry.ts) to an image-to-image / outpainting model that synthesizes high-frequency micro-details (foliage, textures, tiny critters) inside zoomed sub-tiles while clamping outer border pixels to `lockedBoundaryPaletteHex` for invisible parent seams.
- [ ] **Printable Vector SVG / PDF Coloring Sheet Exporter**:
  - Add a "Export Printable Line Art (SVG / PDF)" action in [`SettingsModal.tsx`](./web/src/components/SettingsModal.tsx) that traces `borderMap` and `region.centroidX`/`centroidY` labels into a crisp, resolution-independent SVG coloring page for physical printing.

---

## Priority P3: Real-Time Co-op Multiplayer & Cross-Device Sharing Infrastructure

- [ ] **Co-op Collaborator Undo Sync (`UNFILL_EVENT`) & Interactive "Ping Region" Beacon**:
  - Broadcast `UNFILL_EVENT` and Free Colour re-paint messages over [`HybridCoopRoomAdapter`](./web/src/services/providers/ProviderRegistry.ts) when a collaborator undoes a region fill so all peer canvases stay strictly consistent during undo/redo.
  - Add a tap-and-hold "Ping Region" beacon on [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx) rendered via [`CoopRippleBuffer.ts`](./web/src/engine/CoopRippleBuffer.ts) so collaborators can highlight a tricky micro-region or call attention to a specific area on large puzzles.
- [ ] **Hosted Hibernating WebSocket Room Relay Server (`VITE_CAPY_ROOM_WS_URL`)**:
  - Implement and deploy a lightweight hibernating WebSocket room relay (Cloudflare Worker + Durable Objects in a `relay/` workspace package) backing [`HybridCoopRoomAdapter`](./web/src/services/providers/ProviderRegistry.ts) so 6-character Co-op room codes (`?room=ABC123`) connect players across separate devices and networks over the internet.
- [ ] **WebRTC DataChannel Peer-to-Peer Upgrade & Custom Photo Transfer in Co-op Rooms**:
  - Upgrade WebSocket room signaling to negotiate direct `RTCPeerConnection` / `RTCDataChannel` links between room participants so real-time `PAINT_EVENT` strokes and custom user-uploaded `.capy` v2 puzzle packs stream directly peer-to-peer without server storage overhead.
- [ ] **Ephemeral Encrypted Cloud Blob Relay for Custom Photo Share Links (`#s=<token>`)**:
  - Add an opt-in encrypted `.capy` v2 blob upload (content-addressed SHA-256 key with 30-day TTL in object storage) so players can share `#s=<token>` URL links for custom uploaded photos across devices just as seamlessly as built-in Gallery artworks.

---

## Priority P4: Production Storefront Credentials, Cloud Providers & Live AI Catalog

- [ ] **Google Play Console Production Credentials & Verified `assetlinks.json`**:
  - Provision the production 12-digit Play Games Project ID (`CAPY_PLAY_GAMES_APP_ID`) and Web OAuth Client ID (`VITE_GOOGLE_CLIENT_ID`), register Upload Key and Play App Signing SHA-1/SHA-256 certificate fingerprints in Google Play Console, and publish `web/public/.well-known/assetlinks.json` so `android:autoVerify="true"` App Links verify automatically on Android devices.
- [ ] **Native Google UMP Consent + AdMob Rewarded Video SDK Integration (`app/`)**:
  - Bundle `com.google.android.ump:user-messaging-platform` and `com.google.android.gms:play-services-ads` in [`app/build.gradle.kts`](./app/build.gradle.kts), wire GDPR/CCPA consent forms in [`MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt), and implement `CapyAndroidBridge.showRewardedAd()` with Server-Side Verification (SSV) callbacks to fund optional AI puzzle generation credits while keeping core coloring 100% ad-free.
- [ ] **Live In-App AI Artwork Generation Endpoint (`VITE_CAPY_AI_API_URL`)**:
  - Connect [`DefaultAiArtworkAdapter`](./web/src/services/providers/ProviderRegistry.ts) to a live serverless image generation endpoint (Imagen 3 / Gemini / Flux) and add a "Generate Custom AI Puzzle from Prompt" workflow in the Create tab that spends verified `AiCreditLedger` credits and feeds the generated illustration directly into `puzzle.worker.ts`.
- [ ] **Shared Multi-User Backend & Automated `.capy` v2 Gallery Publisher for Community Ideas**:
  - Connect `StaticAndCommunityCatalogAdapter` (`capy_community_ideas_v1`) to a rate-limited, moderated backend API so player-submitted ideas and upvotes sync globally, paired with a scheduled GitHub Actions workflow that pre-bakes top-voted ideas into `.capy` v2 packs (`catalog/v1/index.json`).

---

## Priority P5: Multi-Platform Desktop (Steam / Tauri), iOS & Microsoft Store Packaging

- [ ] **Steam Desktop Wrapper (`desktop/`) & `SteamCloudDriver` Bindings**:
  - Scaffold a Tauri v2 desktop wrapper (`desktop/`) hosting `web/dist/` with `steamworks-rs` adapters wired to [`SteamCloudDriver`](./web/src/services/providers/CloudProviderDrivers.ts) (`ISteamRemoteStorage` Cloud Saves, Steam Achievements, Steam Overlay, and Rich Presence).
- [ ] **iOS & iPadOS Native Wrapper (`ios/`) & `AppleCloudDriver` Bindings**:
  - Scaffold a Swift `WKWebView` iOS/iPadOS wrapper connected to `window.webkit.messageHandlers.CapyIOS` and [`AppleCloudDriver`](./web/src/services/providers/CloudProviderDrivers.ts), supporting Apple Pencil hover/pressure, CoreHaptics, Sign in with Apple / GameKit (`GKLocalPlayer`), and CloudKit `privateCloudDatabase` save sync.
- [ ] **Microsoft Store / Xbox Wrapper & `MicrosoftCloudDriver` Bindings**:
  - Connect [`MicrosoftCloudDriver`](./web/src/services/providers/CloudProviderDrivers.ts) to live Microsoft Entra ID / MSA OAuth 2.0 PKCE credentials for OneDrive `special/approot` and Xbox Connected Storage synchronization.
