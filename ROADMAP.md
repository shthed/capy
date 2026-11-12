# Capy Product Roadmap -- Strategic Epics, Stories & Milestones (`ROADMAP.md`)

Strategic, outcome-driven product roadmap for the **Capy** monorepo ([`web/`](./web/) and [`app/`](./app/)). Capy coordinates planning and execution across a **3-Artefact Agile Triad**: (1) **`ROADMAP.md`** owns Epics (`EPIC-*`), User Stories (`US-*`), external dependency gates, Platform Icebox (`ICE-*`), and shipped archives; (2) **GitHub Parent Epic Tracking Issues (`#476`--`#480`) & Sprint Milestones (`#1`--`#4`)** surface live progress bars and PR cross-links (`1 Issue = 1 Epic`); and (3) [`TODO.md`](./TODO.md) holds **only** unblocked, codebase-verified `BUG-*` and `TASK-*` slices pulled into the **active sprint** (full governance and CLI playbooks in [`DEV.md`](./DEV.md#capy-lean-agile-backlog--todomd-entry-standard)).

**Related Guides**: [`README.md`](./README.md) | [`DEV.md`](./DEV.md) | [`AGENTS.md`](./AGENTS.md) | [`TODO.md`](./TODO.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`APP.md`](./APP.md) | [`CLOUD.md`](./CLOUD.md) | [`TESTING.md`](./TESTING.md) | [`CHANGELOG.md`](./CHANGELOG.md)

**Table of Contents**:
1. [`EPIC-2`: `v3.0.1` Critical Bugfixes (`Active in Sprint 1`)](#1-epic-2-v301-critical-bugfixes-active-in-sprint-1)
2. [`EPIC-3`: Touch Assist, Sensory Polish, Retention, Accessibility & Replays (`Awaiting Owner Review & Approval`)](#2-epic-3-touch-assist-sensory-polish-retention-accessibility--replays-awaiting-owner-review--approval)
3. [`EPIC-4`: Serverless Infinite Zoom, Printable Art & Local Co-op Polish (`Ready After EPIC-3`)](#3-epic-4-serverless-infinite-zoom-printable-art--local-co-op-polish-ready-after-epic-3)
4. [`EPIC-5`: Production Cloud Auth, Cross-Network Co-op & Optional AI Creation (`Blocked on External Infra`)](#4-epic-5-production-cloud-auth-cross-network-co-op--optional-ai-creation-blocked-on-external-infra)
5. [Unscheduled Platform Icebox (`ICE-1`--`ICE-3`)](#5-unscheduled-platform-icebox-ice-1--ice-3)
6. [Shipped Epics & Stories (`EPIC-1` & Completed Stories)](#6-shipped-epics--stories-epic-1--completed-stories)

<details>
<summary>Roadmap Governance, GitHub Epic Tracking, Readiness States & Sprint Lifecycle</summary>

- **3-Artefact Agile Triad (`ROADMAP.md` <-> GitHub Epic Issues & Milestones <-> `TODO.md`)**:
  - **`ROADMAP.md` (*Strategic Horizon & Archive*)**: Single source of truth for outcome-driven Epics, User Stories, engineering estimates, external **Unblock Prerequisites**, Platform Icebox (`ICE-*`), and collapsed shipped milestones.
  - **GitHub Parent Epic Tracking Issues (`1 Issue = 1 Epic`, `#476`--`#480`) & Sprint Milestones (`#1`--`#4`)**:
    - Every chartered Epic has **one** Parent GitHub Tracking Issue carrying `epic` + `epic:<N>` + platform labels (`web`, `android`) and a `- [x]` / `- [ ]` Story & Task checklist that renders live GitHub progress bars and `Tracked in #<issue>` badges on linked PRs:
      - `EPIC-1`: [#476](https://github.com/shthed/capy/issues/476) (`CLOSED` | [Sprint 0 (`#1`)](https://github.com/shthed/capy/milestone/1) -- Unified Monorepo & Foundation)
      - `EPIC-2`: [#477](https://github.com/shthed/capy/issues/477) (`OPEN` | [Sprint 1 (`#2`)](https://github.com/shthed/capy/milestone/2) -- `v3.0.1` Critical Bugfixes Only)
      - `EPIC-3`: [#478](https://github.com/shthed/capy/issues/478) (`OPEN` | [Sprint 2 (`#3`)](https://github.com/shthed/capy/milestone/3) -- Touch Assist, Sensory Polish, Daily Streaks, A11y & Video Replays -- *Awaiting Owner Review & Approval*)
      - `EPIC-4`: [#479](https://github.com/shthed/capy/issues/479) (`OPEN` | [Sprint 3 (`#4`)](https://github.com/shthed/capy/milestone/4) -- Focal Sub-Tiles, Print Framing & Co-op Ping)
      - `EPIC-5`: [#480](https://github.com/shthed/capy/issues/480) (`OPEN` | *No Milestone -- Blocked on External Credentials / Infra*)
    - **Strict Anti-Sprawl Rule**: Individual `TASK-*` slices, Sprint Priority 0 `BUG-*` items (tracked in [`TODO.md`](./TODO.md) + the active GitHub Sprint Milestone), and unscheduled `ICE-1`--`ICE-3` wrappers do **not** open separate GitHub Issues. Charter a new `EPIC-N` issue **only** when promoting an `ICE-*` item or new product theme into active roadmap scheduling.
  - **`TODO.md` (*Focused 1-Sprint Execution Queue*)**: Holds **only** the current sprint's approved, unblocked, codebase-verified `BUG-*` and `TASK-*` `1-PR` slices. Unapproved feature stories stay in `ROADMAP.md` (`Awaiting Owner Review & Approval`) until explicitly approved.
- **Story Readiness States**:
  - **`Active in Sprint N` ([`TODO.md`](./TODO.md))**: Approved and pulled into `TODO.md` under the active GitHub Sprint Milestone with verified symbol targets and deterministic test gates.
  - **`Awaiting Owner Review & Approval`**: Unblocked client-side stories queued for Project Owner feature/design sign-off before entering `TODO.md` or implementation.
  - **`Ready After EPIC-3`**: Zero external backend/credential blockers; queued behind `EPIC-3` approval and execution.
  - **`Blocked -- External Credentials / Infra`**: Client hexagonal interfaces exist, but live execution awaits external OAuth client IDs, Play Console setup, serverless relays, or paid AI API keys. Never pull blocked stories into `TODO.md` or assign them to an active Sprint Milestone until their **Unblock Prerequisite** is satisfied.
- **5-Stage Automated Sprint & Epic Lifecycle (`Alpha -> Beta -> Production`)**:
  1. **Sprint Pull / Replenishment**: When [`TODO.md`](./TODO.md) drains (`<= 2` tasks left), open a lightweight `docs/*` sprint-planning PR promoting approved Stories from `ROADMAP.md` into `TODO.md` and ensuring the target GitHub Sprint Milestone is open.
  2. **Daily Sprint PRs (`feature/* -> beta`)**: Branch off `origin/beta` (`#NNN` single-task chats or `/goal` / `/teamwork` multi-task Story runs), open PRs with `--base beta`, attach `epic:<N>` + work/platform labels + the active Sprint Milestone, and put `**Agile Scope**: Tracked in #<epic-issue> (...)` at the top (**never** write `Closes #<epic-issue>` or `Fixes #<epic-issue>` on partial Epic PRs).
  3. **Task Merge & Epic Checklist Sync**: Delete finished `BUG-*` / `TASK-*` items from [`TODO.md`](./TODO.md) in the shipping PR, and check off `- [x] ... — #<pr>` on the Parent Epic Tracking Issue (`gh issue edit <epic-issue>`) as slices land on `beta`.
  4. **Beta Play-Testing & Production Promotion (`beta -> main`)**: Soak merged Sprint slices on `https://shthed.github.io/capy/beta/`, then open a human-approved `beta -> main` Release Promotion PR (gated by CI `Playwright E2E Release Gate`), tag `vX.Y.Z` to trigger [`release.yml`](./.github/workflows/release.yml) (`.apk` + Play Store `.aab`), and sync `origin/beta` to `origin/main`.
  5. **Story/Epic Archive & Closure**: Move completed Stories/Epics into the collapsed **Shipped Epics & Stories** `<details>` archive in [Section 6](#6-shipped-epics--stories-epic-1--completed-stories) with `#<PR>` links, close the Parent Epic Tracking Issue (`gh issue close <epic-issue>`) once `100%` of its Stories reach Production, and close the completed Sprint Milestone.
- **Remaining Roadmap Rollup (`16` User Stories & `3` Staged P0 Bugfixes across `4` Epics)**:
  - `EPIC-2` ([#477](https://github.com/shthed/capy/issues/477), *`v3.0.1` Critical Bugfixes Only -- Active in Sprint 1*): `~42k tokens` | `~21--31 min agent` (`~5--8 hrs human` -- `BUG-1`..`BUG-3` staged on `beta` in `#484` / `#485`).
  - `EPIC-3` ([#478](https://github.com/shthed/capy/issues/478), *8 Stories -- Awaiting Owner Review & Approval*): `~256k tokens` | `~119--171 min agent` (`~32--46 hrs human`).
  - `EPIC-4` ([#479](https://github.com/shthed/capy/issues/479), *3 Stories -- Ready After `EPIC-3`*): `~68k tokens` | `~32--46 min agent` (`~9--13.5 hrs human`).
  - `EPIC-5` ([#480](https://github.com/shthed/capy/issues/480), *5 Stories -- Blocked on External Infra*): `~245k tokens` | `~113--165 min agent` (`~34--50 hrs human`).
  - **Total Strategic Horizon**: `~611k tokens` | `~4.8--6.9 hrs agent` (`~80--117.5 hrs human`).

</details>

---

## 1. `EPIC-2`: `v3.0.1` Critical Bugfixes (`Active in Sprint 1`)

**Epic Goal**: Stabilize `v3.0.0` / `v3.0.1` strictly with critical reliability, lifecycle, and CI bugfixes—zero unapproved new features. *(GitHub Tracking Issue: [#477](https://github.com/shthed/capy/issues/477) | Milestone: [Sprint 1](https://github.com/shthed/capy/milestone/2) | Active queue in [`TODO.md`](./TODO.md)).*

- **Current `v3.0.1` Critical Bugfix Scope**:
  - **`BUG-1` (Co-op `WELCOME_STATE` Persistence & Replay Rewind `UNFILL` Sync)**: Fix staged on `beta` (`#484` / `#485`), pending human QA and Production merge.
  - **`BUG-2` (CI Cloud Variable Injection & `< 2s` `npm run test:sanity` Gate)**: Fix staged on `beta` (`#485`), pending Production merge.
  - **`BUG-3` (Android WebView `onPause()` / `onResume()` Lifecycle Guard)**: Fix staged on `beta` (`#484` / `#485`), pending human QA and Production merge.
- **Previously Shipped / Deferred Scope**:
  - `US-2.2` zoom controls & `TASK-2.3a` woodblock tap synth shipped in [#472](https://github.com/shthed/capy/pull/472) (archived in [Section 6](#6-shipped-epics--stories-epic-1--completed-stories)).
  - All remaining sensory and touch-precision feature stories (`US-2.1`, `US-2.3b`, `US-2.4`) have been moved to [`EPIC-3`](#2-epic-3-touch-assist-sensory-polish-retention-accessibility--replays-awaiting-owner-review--approval) for Owner review and approval.

---

## 2. `EPIC-3`: Touch Assist, Sensory Polish, Retention, Accessibility & Replays (`Awaiting Owner Review & Approval`)

**Epic Goal**: Forgive near-miss mobile taps, deliver owner-approved tactile/audio/loupe polish, build daily return habits, ensure colorblind accessibility, and enable shareable video replays—`100%` client-side with zero backend. *(GitHub Tracking Issue: [#478](https://github.com/shthed/capy/issues/478) | Milestone: [Sprint 2](https://github.com/shthed/capy/milestone/3) | All unshipped feature stories below await explicit Owner review and approval before entering [`TODO.md`](./TODO.md)).*

### US-3.1: Daily Featured Puzzle Streak & Completion Medals

- **Readiness**: `Awaiting Owner Review & Approval` *(base UTC `DailyPuzzleService.ts` & **Create** hero card `TASK-3.1a` shipped in [#474](https://github.com/shthed/capy/pull/474))*
- **Description**: Persist daily completion history (`capy_daily_streak_v1`), consecutive-day streak counter, and Relaxed vs. Zero-Hint completion medals on top of `DailyPuzzleService.ts`.
- **Value**: Turns one-off daily puzzle launches into a rewarding consecutive-day coloring habit completely offline.
- **Why Now**: `DailyPuzzleService.ts` (`#474`) already rotates featured artworks deterministically by UTC date; adding streak persistence completes the retention loop once approved.
- **Planned Sprint Slices**:
  - **TASK-3.1b**: Persist daily completion history (`capy_daily_streak_v1`), consecutive-day streak counter, and Relaxed vs. Zero-Hint medal badges.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-3` | `priority: high` | `domain: ui`
- **Complexity & Model**: `medium` / `moderate` | **Recommended Model**: `Gemini 4 Argon`
- **Effort Estimate**: `~20,000 tokens` | `~9--13 min agent` (`~2.5--3.5 hrs human`)
- **Target Files**: [`web/src/services/DailyPuzzleService.ts`](./web/src/services/DailyPuzzleService.ts), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/App.tsx`](./web/src/App.tsx), [`web/src/types/index.ts`](./web/src/types/index.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Consecutive UTC-day completions increment streak accurately while preserving Relaxed vs. Zero-Hint medal badges offline, covered by Playwright E2E assertions.

</details>

### US-3.2: Inclusive Accessibility -- Colorblind Geometric Region Patterns

- **Readiness**: `Awaiting Owner Review & Approval` *(base `reducedMotion` `TASK-3.2a` & desktop keyboard shortcuts `TASK-3.2b` shipped in [#474](https://github.com/shthed/capy/pull/474))*
- **Description**: Add geometric `CanvasPattern` hatch overlays (`colorblindPatternMode`) for active and hinted regions alongside existing `reducedMotion` and desktop keyboard gameplay shortcuts.
- **Value**: Ensures players with deuteranopia, protanopia, or tritanopia can distinguish similar palette shades comfortably without relying solely on hue contrast.
- **Why Now**: `reducedMotion` and desktop keyboard shortcuts (`1`--`9`, `+`/`-`, `0`, Arrow/WASD) are live (`#474`); adding cached `CanvasPattern` textures finishes full visual accessibility once approved.
- **Planned Sprint Slices**:
  - **TASK-3.2c**: Add `colorblindPatternMode: boolean` rendering cached `CanvasPattern` geometric textures (dots, stripes, crosshatch, checkerboard) over active and hinted regions.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-3` | `priority: high` | `domain: a11y, canvas, ui`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Gemini 4 Argon`
- **Effort Estimate**: `~17,000 tokens` | `~8--12 min agent` (`~2--3 hrs human`)
- **Target Files**: [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/types/index.ts`](./web/src/types/index.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - `CanvasPattern` tiles are generated once at setup/theme change—zero per-frame pattern creation inside `requestAnimationFrame`.

</details>

### US-3.3: Shareable Timelapse Replay Video (`.mp4` / `.webm`) Export

- **Readiness**: `Awaiting Owner Review & Approval`
- **Description**: Add an "Export Timelapse Video" button in `ReplayControls.tsx` recording the puzzle's chronological fill animation via `HTMLCanvasElement.captureStream(60)` + `MediaRecorder` and sharing via `NativeBridge.exportOrShareFile`.
- **Value**: Turns Capy's YouTube-style replay scrubber into a one-tap shareable timelapse video for friends and social feeds, driving organic word-of-mouth discovery.
- **Why Now**: Chronological `replaySequence` playback and `NativeBridge.exportOrShareFile` binary sharing already exist; adding `MediaRecorder` export unlocks sharing with zero server encoding cost once approved.
- **Planned Sprint Slices**:
  - **TASK-3.3a**: Build `web/src/services/ReplayVideoExporter.ts` (`MediaRecorder` `video/mp4` / `video/webm` fallback + progress bar + clean cancellation) rendering locked-frame timelapse playback.
  - **TASK-3.3b**: Wire an Export Video button in `ReplayControls.tsx` and completion banner to `NativeBridge.exportOrShareFile` with feature-detection fallback.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-3` | `priority: high` | `domain: export, canvas`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Gemini 4 Argon`
- **Effort Estimate**: `~45,000 tokens` | `~22--30 min agent` (`~6--9 hrs human`)
- **Target Files**: `web/src/services/ReplayVideoExporter.ts`, [`web/src/components/ReplayControls.tsx`](./web/src/components/ReplayControls.tsx), [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/services/NativeBridge.ts`](./web/src/services/NativeBridge.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Prefers `video/mp4;codecs=avc1` where supported with automatic `video/webm;codecs=vp9` fallback, releasing all `MediaStreamTrack` handles on finish or cancel.

</details>

### US-3.4: Milestone Achievement Toasts & CRDT Lifetime Stats Sync

- **Readiness**: `Awaiting Owner Review & Approval` *(local `PlayerStatsService.ts` & Settings **Lifetime Stats** card `TASK-3.4a` shipped in [#474](https://github.com/shthed/capy/pull/474))*
- **Description**: Layer non-blocking milestone achievement unlock toasts, monotonic CRDT cloud stat sync, and optional Play Games hooks onto `PlayerStatsService.ts` (`capy_player_stats_v1`).
- **Value**: Rewards long-term mastery across Easy, Hard, Free Colour, and Co-op modes and keeps lifetime totals synced monotonically across devices.
- **Why Now**: Local `PlayerStatsService.ts` (`mergeLifetimeStats`) and the Settings **Lifetime Stats** card are live (`#474`); wiring milestone unlock toasts and cloud/Play Games bridges completes cross-device progression once approved.
- **Planned Sprint Slices**:
  - **TASK-3.4b**: Add milestone achievement unlock toasts, monotonic CRDT stat merging in `ProviderRegistry.ts` / `CloudProviderDrivers.ts`, and defensive no-op `NativeBridge.unlockAchievement` hooks.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-3` | `priority: high` | `domain: ui, cloud, android`
- **Complexity & Model**: `high` / `moderate` | **Recommended Model**: `Gemini 4 Argon`
- **Effort Estimate**: `~32,000 tokens` | `~14--20 min agent` (`~4--6 hrs human`)
- **Target Files**: [`web/src/services/PlayerStatsService.ts`](./web/src/services/PlayerStatsService.ts), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/services/providers/ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts), [`web/src/services/providers/CloudProviderDrivers.ts`](./web/src/services/providers/CloudProviderDrivers.ts), [`web/src/services/NativeBridge.ts`](./web/src/services/NativeBridge.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Stat counters merge monotonically (`Math.max` / set-count union) across devices so syncing an older offline tab never decrements lifetime totals.

</details>

### US-3.5: Fat-Finger Mode (Near-Miss Tap Assist) & Finger Reach Radius

- **Readiness**: `Awaiting Owner Review & Approval`
- **Description**: Add an independent **Fat-Finger Tap Assist** toggle (`fatFingerAssist`, enabled by default in `EASY` difficulty and optional in `NORMAL` / Precise difficulty) paired with a configurable **Finger Size / Touch Reach Radius** setting (`touchReachRadiusPx`, `8px`--`40px` screen CSS pixels with `Compact 12px` / `Standard 22px` / `Large 34px` presets) that snaps near-miss mobile taps onto intended tiny micro-regions without requiring pixel-perfect landing.
- **Value**: Eliminates frustrating dead taps when a fingertip lands `2`--`8px` off a `< 50px` micro-region onto a `borderMap` pixel (`rId <= 0`), an already-filled neighbor, or an adjacent wrong-color region—complementing the planned Precision Loupe (`US-2.1`) for quick one-handed single-tap play.
- **Why Now**: Currently `PuzzleCanvas.tsx` (`puzzle.regionMap[ly * puzzle.width + lx]` single-tap hit-test) checks only the exact `1x1` pixel under the pointer; adding screen-space radial tolerance makes Easy and mobile play dramatically more forgiving once approved.
- **Planned Sprint Slices**:
  - **TASK-3.5a**: Implement zero-allocation radial near-tap hit-testing (`resolveNearTapRegionId` in `PuzzleCanvas.tsx`) scaling `touchReachRadiusPx / totalScreenScale` dynamically across zoom levels, prioritizing the nearest unfilled `activeColorId` region first and falling back in `EASY` mode to the nearest unfilled region of any color when exact `(lx, ly)` hits a filled neighbor or border.
  - **TASK-3.5b** `[quick-win]`: Add `fatFingerAssist: boolean` and `touchReachRadiusPx: number` (`Compact 12px` / `Standard 22px` / `Large 34px` presets + `8px`--`40px` slider) under `Difficulty (Tap Forgiveness)` in `SettingsModal.tsx` with Playwright E2E near-miss micro-region tap tests.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-3` | `priority: high` | `domain: canvas, gestures, ui`
- **Complexity & Model**: `medium` / `moderate` | **Recommended Model**: `Gemini 4 Argon` (`3.5a`), `Gemini 3.8 Flash` (`3.5b`)
- **Effort Estimate**: `~38,000 tokens` (`~22k` + `~16k`) | `~18--25 min agent` (`~5--7 hrs human`)
- **Target Files**: [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/services/StorageService.ts`](./web/src/services/StorageService.ts), [`web/src/types/index.ts`](./web/src/types/index.ts), [`web/scripts/test.mjs`](./web/scripts/test.mjs), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Direct hits on playable unfilled regions remain `O(1)`; radial fallback scans integer offsets inside `Math.min(64, touchReachRadiusPx / totalScreenScale)` using scalar distance registers with zero heap allocations.
  - In `NORMAL` difficulty with `fatFingerAssist: true`, near-miss taps snap strictly to unfilled `activeColorId` regions; in `EASY` difficulty, near-miss taps on filled/border pixels prefer `activeColorId` first and otherwise snap to the closest unfilled micro-region of any color.

</details>

### US-2.1: Floating Precision Loupe Magnifier for Micro-Regions *(Moved from `EPIC-2`)*

- **Readiness**: `Awaiting Owner Review & Approval`
- **Description**: Render an optional floating circular `2.5x` magnifier cutout with center crosshair (`showMagnifierLoupe`) offset `72px` above the active finger during press-and-hold or Paint Mode drags on [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), flipping cleanly below near top HUD edges.
- **Value**: Eliminates mobile thumb occlusion on tiny `< 50px` micro-regions without forcing repeated manual zooming to `12x` and back out.
- **Why Pushed to `EPIC-3`**: Held out of `v3.0.1` (bugfixes only) so the Project Owner can review visual cutout styling, crosshair ergonomics, horizontal edge clamping, and hold-vs-pan gesture thresholds prior to implementation.
- **Planned Sprint Slices**:
  - **TASK-2.1a**: Render a zero-allocation `2.5x` magnified `compositeCanvasRef` cutout + crosshair lens in `PuzzleCanvas.tsx`.
  - **TASK-2.1b** `[quick-win]`: Add `showMagnifierLoupe: boolean` setting toggle in `SettingsModal.tsx` Controls and Playwright E2E touch-hold verification.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-3` | `priority: medium` | `domain: canvas, gestures, ui`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Gemini 4 Carbon` (`/plan`) + `Gemini 4 Argon` (`2.1b`)
- **Effort Estimate**: `~40,000 tokens` | `~18--26 min agent` (`~5--7 hrs human`)
- **Target Files**: [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/services/StorageService.ts`](./web/src/services/StorageService.ts), [`web/src/types/index.ts`](./web/src/types/index.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Reuses existing offscreen `compositeCanvasRef` via `ctx.drawImage` circular clip with zero per-frame `OffscreenCanvas` or heap allocations inside `requestAnimationFrame`, scaling cleanly for `devicePixelRatio`.
  - Repositions below the finger within `96px` of the top viewport edge, clamps horizontally (`>= loupeRadius + 12px` from left/right edges), and activates via hold threshold or Paint Mode drag without conflicting with pan or double-tap-drag zoom.

</details>

### US-2.3: Zero-Asset Procedural ASMR Web Audio Engine -- Melodic Layer *(Moved from `EPIC-2`)*

- **Readiness**: `Awaiting Owner Review & Approval` *(base woodblock tap synth `TASK-2.3a` shipped in [#472](https://github.com/shthed/capy/pull/472))*
- **Description**: Extend [`SoundService.ts`](./web/src/services/SoundService.ts) with rising pentatonic Paint Mode streak notes, warm swatch-completion chord arpeggios, and `100%` puzzle-completion chimes.
- **Value**: Adds zero-KB offline harmonic reward to continuous painting and color completions while pairing cleanly with LRA haptics.
- **Why Pushed to `EPIC-3`**: Held out of `v3.0.1` (bugfixes only) for Project Owner review of musical scale, instrument tone, voice-polyphony limits, and completion chime pacing.
- **Planned Sprint Slices**:
  - **TASK-2.3b** `[quick-win]`: Layer harmonic pentatonic streak progression during Paint Mode drags, warm swatch-clear arpeggios, and `100%` puzzle completion chimes into `SoundService.ts` and `App.tsx`.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-3` | `priority: medium` | `domain: audio, ui`
- **Complexity & Model**: `medium` / `moderate` | **Recommended Model**: `Gemini 4 Argon`
- **Effort Estimate**: `~22,000 tokens` | `~10--15 min agent` (`~2.5--3.5 hrs human`)
- **Target Files**: [`web/src/services/SoundService.ts`](./web/src/services/SoundService.ts), [`web/src/App.tsx`](./web/src/App.tsx), [`web/scripts/test.mjs`](./web/scripts/test.mjs), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Zero bundled audio assets (`0 KB`), streak resets cleanly after gesture idle (`> 450ms`), does not advance on `UNFILL` / Undo, caps simultaneous oscillators (max 3--4 voices) during fast drags, and respects `soundEnabled`, `soundVolume`, and `document.hidden` auto-suspend.

</details>

### US-2.4: Zero-Allocation Region Fill Bloom & Swatch Shimmer *(Moved from `EPIC-2`)*

- **Readiness**: `Awaiting Owner Review & Approval`
- **Description**: Animate region fills with a `180ms` radial ink-bloom and highlight newly completed palette swatches with a `400ms` shimmer wave across matching regions in [`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx).
- **Value**: Gives clear, tactile visual feedback on fills and color completions using a zero-allocation typed-array ring buffer.
- **Why Pushed to `EPIC-3`**: Held out of `v3.0.1` (bugfixes only) so the Project Owner can review visual subtlety, `reducedMotion` behavior, and battery impact before implementation.
- **Planned Sprint Slices**:
  - **TASK-2.4a**: Create a pre-allocated typed-array fill-animation ring buffer (mirroring `CoopRippleBuffer.ts`) driving a `180ms` radial clip bloom in `PuzzleCanvas.tsx`.
  - **TASK-2.4b**: Trigger a `400ms` celebratory highlight pulse across completed-swatch centroids when a palette color reaches `0` remaining regions.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-3` | `priority: medium` | `domain: canvas`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Gemini 4 Carbon` (`2.4a`), `Gemini 4 Argon` (`2.4b`)
- **Effort Estimate**: `~42,000 tokens` | `~20--28 min agent` (`~5--7 hrs human`)
- **Target Files**: [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/engine/CoopRippleBuffer.ts`](./web/src/engine/CoopRippleBuffer.ts), [`web/scripts/test.mjs`](./web/scripts/test.mjs), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Zero heap allocations (`Float32Array` / `Int32Array` fixed ring buffer) during `requestAnimationFrame`, overwriting the oldest slot cleanly on overflow, bypassing bloom/shimmer when `reducedMotion` is enabled, and returning to `0%` CPU idle once the `180ms` / `400ms` window expires.

</details>

---

## 3. `EPIC-4`: Serverless Infinite Zoom, Printable Art & Local Co-op Polish (`Ready After EPIC-3`)

**Epic Goal**: Complete Capy's signature offline creative workflows—focal-point sub-tile exploration, physical paper coloring sheets, and expressive local Co-op—before introducing external backend infrastructure. *(GitHub Tracking Issue: [#479](https://github.com/shthed/capy/issues/479) | Milestone: [Sprint 3](https://github.com/shthed/capy/milestone/4)).*

### US-4.1: Focal-Point Quadtree Sub-Tiles & Parent Breadcrumbs

- **Readiness**: `Ready for Sprint 3` (Zero external blockers; `InfiniteZoomTileSpec` already defined in `web/src/services/providers/types.ts`; `parentSnapshotId` & top-bar breadcrumb `TASK-4.1a` shipped in [#475](https://github.com/shthed/capy/pull/475))
- **Description**: Upgrade `handleZoomIntoDetailTile` (`App.tsx`) from a fixed `2x` center crop to generate detail sub-tiles centered on the player's active `(focusX, focusY)` viewport focus on top of the live "Back to Parent Puzzle" breadcrumb pill in `GameTopBar.tsx`.
- **Value**: Makes Infinite Zoom genuinely exploratory—players can dive into any interesting corner of an artwork and jump right back to the parent canvas without hunting through the Saves list.
- **Why Now**: `parentSnapshotId` and `topbar-parent-puzzle-btn` (`#475`) already preserve and restore parent viewports; adding focal-point `(focusX, focusY)` cropping completes multi-depth Infinite Zoom navigation.
- **Planned Sprint Slices**:
  - **TASK-4.1b**: Upgrade `handleZoomIntoDetailTile` to crop around the active `(focusX, focusY)` viewport center with persisted `subTileBounds` for multi-depth navigation.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-4` | `priority: medium-high` | `domain: canvas, engine, ui`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Gemini 4 Argon` (`4.1b`)
- **Effort Estimate**: `~26,000 tokens` | `~12--18 min agent` (`~3.5--5 hrs human`)
- **Target Files**: [`web/src/App.tsx`](./web/src/App.tsx), [`web/src/components/GameTopBar.tsx`](./web/src/components/GameTopBar.tsx), [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/types/index.ts`](./web/src/types/index.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Cropping around arbitrary `(focusX, focusY)` clamps cleanly inside source image bounds across repeated `2x` sub-tile depths while preserving parent breadcrumb restoration.

</details>

### US-4.2: Printable Vector SVG / PDF Coloring Sheet Layout Options

- **Readiness**: `Ready for Sprint 3` (Zero external blockers; monochrome vector `.svg` exporter [`SvgPrintExporter.ts`](./web/src/services/SvgPrintExporter.ts) `TASK-4.2a` shipped in [#475](https://github.com/shthed/capy/pull/475))
- **Description**: Add print sheet framing and styling controls in `SettingsModal.tsx` on top of `SvgPrintExporter.ts` so players can tailor exported `.svg` / browser-printed PDF coloring sheets for A4 vs. Letter paper, stroke weight, and optional numberless freehand coloring.
- **Value**: Bridges digital and physical play—parents, teachers, and artists can customize page margins, stroke thickness, and number visibility before printing on home printers.
- **Why Now**: `SvgPrintExporter.ts` (`#475`) already exports crisp collinear-merged vector `.svg` sheets; adding print framing options completes physical paper support with zero server infrastructure.
- **Planned Sprint Slices**:
  - **TASK-4.2b**: Add print sheet layout options in `SettingsModal.tsx` (A4 vs. Letter aspect framing, line thickness, optional number hiding for freehand coloring, and browser Print/PDF trigger).

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-4` | `priority: medium-high` | `domain: export, engine`
- **Complexity & Model**: `medium` / `moderate` | **Recommended Model**: `Gemini 4 Argon`
- **Effort Estimate**: `~22,000 tokens` | `~12--16 min agent` (`~3.5--5.5 hrs human`)
- **Target Files**: [`web/src/services/SvgPrintExporter.ts`](./web/src/services/SvgPrintExporter.ts), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/services/NativeBridge.ts`](./web/src/services/NativeBridge.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - A4 and US Letter aspect framing, configurable stroke widths, and optional number hiding render cleanly in Chrome/Firefox/Safari print preview without dark UI backgrounds.

</details>

### US-4.3: Co-op Collaborator Region Ping Beacon

- **Readiness**: `Ready for Sprint 3` *(Single-step Co-op `UNFILL_EVENT` / `UNFILL` sync & 2-peer `BroadcastChannel` E2E shipped in [#475](https://github.com/shthed/capy/pull/475); replay-rewind `UNFILL` + `WELCOME_STATE` session persistence is promoted to Sprint 1 `BUG-1` in [`TODO.md`](./TODO.md)).*
- **Description**: Add a tap-and-hold or toolbar `'PING'` beacon message over `CoopRoomWireMessage` (`HybridCoopRoomAdapter`) rendered as an expanding dual-ring beacon via `CoopRippleBuffer.ts` on `PuzzleCanvas.tsx`.
- **Value**: Lets Co-op partners point out tiny hard-to-find micro-regions visually on shared puzzles without verbal coordinates.
- **Why Now**: Works immediately over same-device `BroadcastChannel` Co-op today with zero server changes and carries forward automatically when the WebSocket relay (`US-5.2`) goes live.
- **Planned Sprint Slices**:
  - **TASK-4.3b**: Add `'PING'` wire message to `CoopMessageType` (`web/src/services/providers/types.ts`), relay via `HybridCoopRoomAdapter`, and render expanding dual-ring beacons in `CoopRippleBuffer.ts` and `PuzzleCanvas.tsx`.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-4` | `priority: medium-high` | `domain: multiplayer, canvas`
- **Complexity & Model**: `medium` / `moderate` | **Recommended Model**: `Gemini 4 Argon`
- **Effort Estimate**: `~20,000 tokens` | `~8--12 min agent` (`~2--3 hrs human`)
- **Target Files**: [`web/src/services/providers/types.ts`](./web/src/services/providers/types.ts), [`web/src/services/providers/ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts), [`web/src/engine/CoopRippleBuffer.ts`](./web/src/engine/CoopRippleBuffer.ts), [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - Zero per-frame heap allocations in `CoopRippleBuffer.ts`, verified by a 2-peer Playwright `BroadcastChannel` ping E2E test.

</details>

---

## 4. `EPIC-5`: Production Cloud Auth, Cross-Network Co-op & Optional AI Creation (`Blocked on External Infra`)

**Epic Goal**: Connect Capy's hexagonal cloud, room-sync, and AI provider interfaces (`ProviderRegistry.ts`) to live production credentials and lightweight serverless endpoints when ready for public store and cross-network scale. *(GitHub Tracking Issue: [#480](https://github.com/shthed/capy/issues/480) | Do not pull `EPIC-5` stories into `TODO.md` until their stated **Unblock Prerequisite** is satisfied).*

### US-5.1: Production Google OAuth, Play Games IDs & Verified App Links

- **Readiness**: `Blocked -- External Console Credentials & Root Domain Hosting`
- **Unblock Prerequisite**: Human provisioning of Google Cloud Web OAuth Client ID (`VITE_GOOGLE_CLIENT_ID`), 12-digit Play Games Project ID (`CAPY_PLAY_GAMES_APP_ID`), release keystore SHA-256 fingerprint, and write access to root `https://shthed.github.io/.well-known/assetlinks.json` (Android `autoVerify="true"` queries domain root rather than `/capy/.well-known/`).
- **Description**: Configure live Google Cloud OAuth and Play Games repository variables and publish verified Digital Asset Links for `com.capypaint.capy`.
- **Value**: Unlocks live one-tap Google Drive cross-device save sync on web, native Play Games `SnapshotsClient` sync on Android, and seamless Android App Link opening for `#s=<token>` links.
- **Why Now**: Client drivers (`GoogleCloudDriver`, `PlayGamesAndroidDriver`, `privacy-policy.html`) are already complete; CI variable wiring is queued in `EPIC-2` (`BUG-2`, staged on `beta` in PR `#485`).

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-5` | `priority: medium` | `domain: android, cloud`
- **Complexity & Model**: `low` / `easy` | **Recommended Model**: `Gemini 3.8 Flash` + Human Console Setup
- **Effort Estimate**: `~20,000 tokens` | `~10--15 min agent` (`~2--4 hrs human`)
- **Target Files**: [`app/build.gradle.kts`](./app/build.gradle.kts), [`app/src/main/AndroidManifest.xml`](./app/src/main/AndroidManifest.xml), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - `https://shthed.github.io/.well-known/assetlinks.json` (or custom domain) validates against `pm get-app-links com.capypaint.capy` and Google OAuth sign-in succeeds without sandbox overrides.

</details>

### US-5.2: Hosted Hibernating WebSocket Co-op Room Relay (`VITE_CAPY_ROOM_WS_URL`)

- **Readiness**: `Blocked -- External Cloudflare Workers / Durable Objects Account`
- **Unblock Prerequisite**: Cloudflare Workers + Durable Objects deployment target and live `VITE_CAPY_ROOM_WS_URL` domain.
- **Description**: Deploy a lightweight stateless/hibernating WebSocket room relay (`relay/` Cloudflare Worker + Durable Objects) backing `HybridCoopRoomAdapter` for 6-character `?room=ABC123` codes.
- **Value**: Lets friends and family color the same puzzle together in real time across separate phones, tablets, and laptops over the internet—not just tabs on the same browser.
- **Why Now**: `HybridCoopRoomAdapter` already implements the full WebSocket room protocol (`HELLO`, `WELCOME_STATE`, `PAINT_EVENT`, `HEARTBEAT`, `LEAVE`).

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-5` | `priority: medium` | `domain: multiplayer, cloud`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Gemini 4 Carbon` (`/plan`) + `Gemini 4 Argon`
- **Effort Estimate**: `~50,000 tokens` | `~25--35 min agent` (`~8--12 hrs human`)
- **Target Files**: `relay/`, [`web/src/services/providers/ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - Hibernates between strokes (`0` billable CPU ms while idle via C++ `PING`/`PONG`), enforces `<= 6 KB` frame caps, strict `Origin` validation, `40 frames / 5s` rate limiting, and write-once initial `seed_token` persistence, and automatically falls back to `BroadcastChannel` when offline or on `localhost`/`github.io`.

</details>

### US-5.3: Ephemeral Encrypted Blob Relay for Custom Photo Share Links

- **Readiness**: `Blocked -- External Ephemeral Blob Storage Endpoint`
- **Unblock Prerequisite**: Provisioned object/KV storage endpoint supporting `<= 200 KB` blobs with `30`-day automatic TTL expiration.
- **Description**: Add opt-in client-side AES-GCM encrypted `.capy` v2 blob upload (decryption key kept exclusively inside the URL `#` fragment) so `#s=<token>` share links work across devices for custom uploaded photos.
- **Value**: Removes the current limitation where `#s=<token>` links work across devices only for built-in Gallery artworks while keeping user photos zero-knowledge encrypted.
- **Why Now**: Custom photo puzzles (`45--95 KB` `.capy` v2) exceed `< 2 KB` URL hash limits; an encrypted ephemeral relay completes universal link sharing privately.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-5` | `priority: medium` | `domain: cloud, security`
- **Complexity & Model**: `medium` / `hard` | **Recommended Model**: `Gemini 4 Carbon`
- **Effort Estimate**: `~40,000 tokens` | `~18--26 min agent` (`~6--8 hrs human`)
- **Target Files**: [`web/src/services/ShareLinkService.ts`](./web/src/services/ShareLinkService.ts), [`web/public/privacy-policy.html`](./web/public/privacy-policy.html), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - Decryption key stays strictly inside `#s=...` (never transmitted in HTTP requests), and built-in Gallery `#s=` links continue using zero network calls.

</details>

### US-5.4: Live Prompt-to-Puzzle & Seam-Locked Sub-Tile AI Artwork Endpoint

- **Readiness**: `Blocked -- External Paid Image-Generation API & Rate-Limit Budget`
- **Unblock Prerequisite**: Provisioned serverless image-generation proxy (`VITE_CAPY_AI_API_URL`), API billing cap, and moderation policy sign-off.
- **Description**: Connect `DefaultAiArtworkAdapter` (`VITE_CAPY_AI_API_URL`) to a serverless image-generation endpoint supporting both "Create Puzzle from Text Prompt" and seam-locked detail inpainting (`buildSeamLockedInfillPrompt`) for Infinite Zoom sub-tiles.
- **Value**: Gives players an endless supply of custom coloring-book illustrations from imagination and synthesizes crisp new micro-details when zooming deep into sub-tiles.
- **Why Now**: Sequenced behind zero-cost client features because live image synthesis incurs per-request API cost (`AiCreditLedger`).

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-5` | `priority: medium-low` | `domain: ai, engine, ui`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Gemini 4 Carbon` (`/plan`) + `Gemini 4 Argon`
- **Effort Estimate**: `~90,000 tokens` (`~42k` + `~48k`) | `~40--60 min agent` (`~12--18 hrs human`)
- **Target Files**: [`web/src/services/providers/ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/App.tsx`](./web/src/App.tsx), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - Enforces family-friendly prompt moderation prior to API dispatch and degrades cleanly when offline or unconfigured.

</details>

### US-5.5: Moderated Global Community Ideas & Automated `.capy` Pack Publisher

- **Readiness**: `Blocked -- Depends on Shared Moderation API & US-5.4 AI Pipeline`
- **Unblock Prerequisite**: Shared community voting/moderation endpoint and live `US-5.4` artwork synthesis credentials.
- **Description**: Back `StaticAndCommunityCatalogAdapter` (`capy_community_ideas_v1`) with a moderated shared API so player puzzle ideas and upvotes sync globally, paired with a scheduled workflow that pre-bakes top-voted ideas into `.capy` v2 gallery packs.
- **Value**: Turns the local-only Community Puzzle Ideas box into a living, player-curated artwork catalog where popular requests automatically become playable zero-wait puzzles.
- **Why Now**: Sequenced last in `EPIC-5` because automated pack publishing builds directly on `US-5.4`.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-5` | `priority: medium-low` | `domain: cloud, engine`
- **Complexity & Model**: `high` / `hard` | **Recommended Model**: `Gemini 4 Argon`
- **Effort Estimate**: `~45,000 tokens` | `~20--30 min agent` (`~6--8 hrs human`)
- **Target Files**: [`web/src/services/providers/ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts), `.github/workflows/`, [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - Client continues working 100% offline with bundled + cached catalog entries if the community API is unreachable.

</details>

---

## 5. Unscheduled Platform Icebox (`ICE-1`--`ICE-3`)

Parked native desktop/mobile store wrappers awaiting completion of `EPIC-2`--`EPIC-4` Web/Android stabilization before active chartering *(intentionally excluded from open GitHub Issues until promoted to `EPIC-6+` so the Issue tracker stays strictly scoped to chartered Epics)*:

<details>
<summary>Expand Unscheduled Multi-Platform Shell Epics (Steam, iOS/iPadOS, Microsoft/Xbox)</summary>

- **`ICE-1`: Steam Desktop Wrapper (`desktop/` Tauri v2) & `SteamCloudDriver` Bindings**:
  - *Value*: Packages `web/dist/` for Windows/macOS/Linux Steam Deck & desktop players with `ISteamRemoteStorage` Cloud Saves, Steam Achievements, and Steam Overlay (`SteamCloudDriver` in [`CloudProviderDrivers.ts`](./web/src/services/providers/CloudProviderDrivers.ts) is already modularly stubbed).
  - *Activation Trigger*: Promote to an active Epic after `EPIC-2`--`EPIC-4` desktop keyboard, audio, and achievement contracts stabilize (`~60k tokens`, `Gemini 4 Argon`).
- **`ICE-2`: iOS & iPadOS Native Wrapper (`ios/` Swift `WKWebView`) & `AppleCloudDriver` Bindings**:
  - *Value*: Delivers App Store distribution with Apple Pencil hover/tilt ergonomics, CoreHaptics, GameKit (`GKLocalPlayer`), and CloudKit save sync (`window.webkit.messageHandlers.CapyIOS` + `AppleCloudDriver`).
  - *Activation Trigger*: Promote when Apple Developer Storefront distribution and macOS Xcode signing are scheduled (`~65k tokens`, `Gemini 4 Argon`).
- **`ICE-3`: Microsoft Store / Xbox Wrapper & `MicrosoftCloudDriver` Bindings**:
  - *Value*: Connects `MicrosoftCloudDriver` to live Entra ID / MSA OAuth 2.0 PKCE credentials for OneDrive `special/approot` and Xbox Connected Storage sync.
  - *Activation Trigger*: Promote alongside desktop/console storefront packaging (`~45k tokens`, `Gemini 4 Argon`).

</details>

---

## 6. Shipped Epics & Stories (`EPIC-1` & Completed Stories)

Completed Epics and User Stories archived upon merge to `main` (full granular PR history lives in [`CHANGELOG.md`](./CHANGELOG.md)):

<details>
<summary>Expand Shipped Epics & Stories (EPIC-1 #476 & Shipped Slices -- PRs #431--#484)</summary>

- **Sprint 1 Reliability, Replay Polish & Cloud Hardening (`BUG-1`, `BUG-3`, `F-01`, `F-02`)**:
  - **Co-op `WELCOME_STATE` Reload Persistence, Replay Scrubber `Resume Here` & `Reset Progress` `'UNFILL_EVENT'` Sync, Compact Mobile `ReplayControls` Pill Fit & Save-Load `replayLoop` Auto-Disable/Auto-Resume, Monotonic CRDT `resetEpoch`, `> 180 KB` Chunked Play Games Binary Sync, and Android `MainActivity` `onPause` / `onResume` WebView Lifecycle Guard** -- [#484](https://github.com/shthed/capy/pull/484)
- **Shipped Slices from `EPIC-5` (*Production Cloud Auth, Cross-Network Co-op & Optional AI Creation* -- [#480](https://github.com/shthed/capy/issues/480))**:
  - **`capypaint.com` Cloudflare Workers Static Assets, Hibernating `CoopRoomDurableObject` Relay (`US-5.2`) & Root `assetlinks.json` App Links (`US-5.1`)** -- [#482](https://github.com/shthed/capy/pull/482)
- **Shipped Slices from `EPIC-4` (*Serverless Infinite Zoom, Printable Art & Local Co-op Polish* -- [#479](https://github.com/shthed/capy/issues/479))**:
  - **Infinite Zoom Parent Breadcrumbs (`TASK-4.1a`), Printable Vector `.svg` Coloring Sheets (`TASK-4.2a`) & Co-op `UNFILL_EVENT` Undo Sync (`TASK-4.3a`)** -- [#475](https://github.com/shthed/capy/pull/475)
- **Shipped Slices from `EPIC-3` (*Touch Assist, Sensory Polish, Retention, Accessibility & Replays* -- [#478](https://github.com/shthed/capy/issues/478))**:
  - **Daily Featured Puzzle (`TASK-3.1a`), Reduced Motion (`TASK-3.2a`), Desktop Keyboard Shortcuts (`TASK-3.2b`) & Lifetime Player Stats (`TASK-3.4a`)** -- [#474](https://github.com/shthed/capy/pull/474)
- **Shipped Stories from `EPIC-2` (*`v3.0.1` Critical Bugfixes -- Pre-Re-Scope Touch & Audio Base* -- [#477](https://github.com/shthed/capy/issues/477))**:
  - **`US-2.2`: Custom Zoom Sensitivity, Top-Bar Scale Pill & Magnetic Scale Detents** (plus `TASK-2.3a` Web Audio woodblock tap synth) -- [#472](https://github.com/shthed/capy/pull/472)
- **`EPIC-1`: Unified Web + Android Monorepo, Gesture Engine, `.capy` v2 Codec, Replay Scrubber & Cloud/Co-op Foundation (`Shipped v1.0--v2.5` | Tracking Issue [#476](https://github.com/shthed/capy/issues/476) | [Sprint 0](https://github.com/shthed/capy/milestone/1))**:
  - **`US-1.1`: Unified Single-Codebase Monorepo (`web/`, `app/`) & Automated Pages Preview CI** -- [#431](https://github.com/shthed/capy/pull/431), [#432](https://github.com/shthed/capy/pull/432), [#434](https://github.com/shthed/capy/pull/434), [#436](https://github.com/shthed/capy/pull/436), [#438](https://github.com/shthed/capy/pull/438), [#440](https://github.com/shthed/capy/pull/440), [#452](https://github.com/shthed/capy/pull/452)
  - **`US-1.2`: 6-Mode Touch Gesture Engine, Free Colour Mode & Live Segmentation Telemetry** -- [#433](https://github.com/shthed/capy/pull/433), [#439](https://github.com/shthed/capy/pull/439), [#442](https://github.com/shthed/capy/pull/442), [#444](https://github.com/shthed/capy/pull/444), [#454](https://github.com/shthed/capy/pull/454), [#455](https://github.com/shthed/capy/pull/455), [#456](https://github.com/shthed/capy/pull/456), [#457](https://github.com/shthed/capy/pull/457)
  - **`US-1.3`: Chronological Undo/Redo & YouTube-Style Interactive Replay Scrubber** -- [#446](https://github.com/shthed/capy/pull/446), [#447](https://github.com/shthed/capy/pull/447), [#448](https://github.com/shthed/capy/pull/448), [#463](https://github.com/shthed/capy/pull/463), [#464](https://github.com/shthed/capy/pull/464)
  - **`US-1.4`: Saves Gallery Modernization, `.capy` v2 Binary Archive & Instant Pre-Baked Startup** -- [#449](https://github.com/shthed/capy/pull/449), [#458](https://github.com/shthed/capy/pull/458), [#459](https://github.com/shthed/capy/pull/459), [#462](https://github.com/shthed/capy/pull/462)
  - **`US-1.5`: Modular `CloudProviderDriver` Sync (`GoogleCloudDriver`, `PlayGamesAndroidDriver`), `#s=<token>` Links & Simultaneous Co-op** -- [#460](https://github.com/shthed/capy/pull/460), [#461](https://github.com/shthed/capy/pull/461)
  - **`US-1.6`: Core Reliability Audit Fixes, Pixel API 33+ Haptics, 3-Tier `Alpha -> Beta -> Production` Pipeline & Lean Agile Foundation** -- [#465](https://github.com/shthed/capy/pull/465), [#466](https://github.com/shthed/capy/pull/466), [#467](https://github.com/shthed/capy/pull/467), [#468](https://github.com/shthed/capy/pull/468), [#469](https://github.com/shthed/capy/pull/469), [#470](https://github.com/shthed/capy/pull/470), [#471](https://github.com/shthed/capy/pull/471), [#473](https://github.com/shthed/capy/pull/473), [#481](https://github.com/shthed/capy/pull/481), [#483](https://github.com/shthed/capy/pull/483)

</details>
