# Capy Active Sprint Backlog -- Ready-for-Dev Tasks (`TODO.md`)

Focused **Sprint 2 Execution Queue** ([Milestone #3](https://github.com/shthed/capy/milestone/3) | `EPIC-3` Tracking Issue [#478](https://github.com/shthed/capy/issues/478)) for the **Capy** monorepo ([`web/`](./web/), [`app/`](./app/), and [`worker/`](./worker/)). Only unblocked, codebase-verified `BUG-*` and `TASK-*` `1-PR` slices approved for immediate development enter `TODO.md`, and all daily feature/bugfix PRs branch from and target **`beta`** (`--base beta`, deploying to `https://shthed.github.io/capy/beta/`) so live production players on `main` are never disrupted. Strategic Epics (`EPIC-4`--`EPIC-5`), external dependency gates, Platform Icebox (`ICE-*`), and shipped milestones (`EPIC-1`, `EPIC-2`) live in [`ROADMAP.md`](./ROADMAP.md) (full workflow in [`DEV.md`](./DEV.md#capy-lean-agile-backlog--todomd-entry-standard)).

**Related Guides**: [`README.md`](./README.md) | [`ROADMAP.md`](./ROADMAP.md) | [`DEV.md`](./DEV.md) | [`AGENTS.md`](./AGENTS.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`APP.md`](./APP.md) | [`CLOUD.md`](./CLOUD.md) | [`TESTING.md`](./TESTING.md) | [`CHANGELOG.md`](./CHANGELOG.md)

**Table of Contents**:
1. [Quick-Win Ready Queue (`<= 15 min` Agent / `3.8 Flash` or `Argon`)](#1-quick-win-ready-queue--15-min-agent--38-flash-or-argon)
2. [Sprint 2 Feature Tasks: `EPIC-3` Fat-Finger Touch Assist, Daily Retention, Accessibility & Replays](#2-sprint-2-feature-tasks-epic-3-fat-finger-touch-assist-daily-retention-accessibility--replays)

<details>
<summary>Sprint 2 Entry Gate, GitHub Agile Tracking, Hybrid Execution & Totals</summary>

- **Strict Ready-for-Dev Gate**:
  - A task enters `TODO.md` **only** when it has zero external backend/credential blockers, verified source file/symbol names against `beta`/`main`, and deterministic acceptance criteria testable via `npm test` or `./gradlew app:testDebugUnitTest`.
  - Future Epics (`EPIC-4` [#479](https://github.com/shthed/capy/issues/479)), externally blocked cloud/AI stories (`EPIC-5` [#480](https://github.com/shthed/capy/issues/480)), and `ICE-*` (no GitHub Issues until chartered) remain in [`ROADMAP.md`](./ROADMAP.md) until promoted at sprint replenishment.
- **GitHub Issue & Milestone Attribution (`1 Issue = 1 Epic`)**:
  - **`EPIC-3` Feature Slices (`US-3.1`--`US-3.5`)**: Attach [Sprint 2 Milestone `#3`](https://github.com/shthed/capy/milestone/3) + `epic:3` + work/platform labels (`feature`, `ui`, `web`, `android`) and write `**Agile Scope**: Tracked in #478 (...)` at the top of the PR (**never** write `Closes #478` or `Fixes #478` on partial `EPIC-3` PRs).
- **Definition of Done (Immediate Deletion & Epic Issue Sync)**:
  - Never leave `[x]` checkboxes in `TODO.md`. Delete finished `BUG-*` / `TASK-*` items (and their Section 1 pointers) in the same PR that ships them, check off `- [x] ... — #<pr>` on Parent Epic Tracking Issue [#478](https://github.com/shthed/capy/issues/478) via `gh issue edit 478`, and when a Story's final task ships, archive that Story into the collapsed **Shipped Epics & Stories** `<details>` section at the bottom of [`ROADMAP.md`](./ROADMAP.md) (closing `#478` only once `100%` of `EPIC-3` reaches Production `main`).
- **Sprint 2 Rollup (`7` Ready `1-PR` Slices across `5` `EPIC-3` Stories)**:
  - **`EPIC-3` Active Tasks (`US-3.1`--`US-3.5`)**: `~152k tokens` | `~71--102 min agent` (`~19.5--28.5 hrs human`).

</details>

---

## 1. Quick-Win Ready Queue (`<= 15 min` Agent / `3.8 Flash` or `Argon`)

Self-contained Sprint 2 `1-PR` slices (`1--4` files, zero external dependencies) ready for immediate single-pass execution:

1. **`TASK-3.1b`** ([`US-3.1`](#us-31-daily-featured-puzzle-streak--completion-medals)): Persist daily completion history (`capy_daily_streak_v1`), consecutive-day streak counter, and Relaxed vs. Zero-Hint medal badges.
2. **`TASK-3.2c`** ([`US-3.2`](#us-32-inclusive-accessibility----colorblind-geometric-region-patterns)): Add `colorblindPatternMode: boolean` rendering cached `CanvasPattern` geometric textures over active and hinted regions.
3. **`TASK-3.5b`** ([`US-3.5`](#us-35-fat-finger-mode-near-miss-tap-assist--finger-reach-radius)): Add `fatFingerAssist: boolean` and `touchReachRadiusPx: number` presets/slider in `SettingsModal.tsx` with Playwright E2E near-miss tap tests *(after `TASK-3.5a`)*.

---

## 2. Sprint 2 Feature Tasks: `EPIC-3` Fat-Finger Touch Assist, Daily Retention, Accessibility & Replays

**Sprint 2 Feature Goal**: Deliver `EPIC-3` ([`ROADMAP.md`](./ROADMAP.md#1-epic-3-fat-finger-touch-assist-daily-retention-accessibility--replays-active-in-sprint-2)) so near-miss mobile taps are forgiven automatically, daily play builds streaks, colorblind geometric patterns make every palette shade distinguishable, and replays export directly to shareable video—100% offline.

### US-3.1: Daily Featured Puzzle Streak & Completion Medals

- **Description**: Persist daily completion history (`capy_daily_streak_v1`), consecutive-day streak counter, and Relaxed vs. Zero-Hint completion medals on top of [`DailyPuzzleService.ts`](./web/src/services/DailyPuzzleService.ts).
- **Value**: Turns one-off daily puzzle launches into a rewarding consecutive-day coloring habit completely offline.
- **Tasks**:
  - **TASK-3.1b** `[quick-win]`: Persist daily completion history (`capy_daily_streak_v1`), consecutive-day streak counter, and Relaxed vs. Zero-Hint medal badges in `DailyPuzzleService.ts`, `SettingsModal.tsx`, and `App.tsx`.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-3` | `priority: high` | `domain: ui`
- **Complexity & Model**: `medium` / `moderate` | **Recommended Model**: `Gemini 4 Argon`
- **Effort Estimate**: `~20,000 tokens` | `~9--13 min agent` (`~2.5--3.5 hrs human`)
- **Target Files**: [`web/src/services/DailyPuzzleService.ts`](./web/src/services/DailyPuzzleService.ts), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/App.tsx`](./web/src/App.tsx), [`web/src/types/index.ts`](./web/src/types/index.ts), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Consecutive UTC-day completions increment streak accurately while preserving Relaxed vs. Zero-Hint medal badges offline, covered by unit and Playwright E2E assertions.

</details>

### US-3.2: Inclusive Accessibility -- Colorblind Geometric Region Patterns

- **Description**: Add geometric `CanvasPattern` hatch overlays (`colorblindPatternMode`) for active and hinted regions alongside existing `reducedMotion` and desktop keyboard gameplay shortcuts.
- **Value**: Ensures players with deuteranopia, protanopia, or tritanopia can distinguish similar palette shades comfortably without relying solely on hue contrast.
- **Tasks**:
  - **TASK-3.2c** `[quick-win]`: Add `colorblindPatternMode: boolean` rendering cached `CanvasPattern` geometric textures (dots, stripes, crosshatch, checkerboard) over active and hinted regions.

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

- **Description**: Add an "Export Timelapse Video" button in [`ReplayControls.tsx`](./web/src/components/ReplayControls.tsx) recording the puzzle's chronological fill animation via `HTMLCanvasElement.captureStream(60)` + `MediaRecorder` and sharing via `NativeBridge.exportOrShareFile`.
- **Value**: Turns Capy's YouTube-style replay scrubber into a one-tap shareable timelapse video with zero server encoding cost.
- **Tasks**:
  - **TASK-3.3a**: Build `web/src/services/ReplayVideoExporter.ts` (`MediaRecorder` `video/mp4` / `video/webm` fallback + progress bar + clean cancellation) rendering locked-frame timelapse playback.
  - **TASK-3.3b**: Wire an Export Video button in `ReplayControls.tsx` to `NativeBridge.exportOrShareFile` with feature-detection fallback.

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

- **Description**: Layer non-blocking milestone achievement unlock toasts, monotonic CRDT cloud stat sync, and optional Play Games hooks onto [`PlayerStatsService.ts`](./web/src/services/PlayerStatsService.ts) (`capy_player_stats_v1`).
- **Value**: Rewards long-term mastery across Easy, Hard, Free Colour, and Co-op modes and keeps lifetime totals synced monotonically across devices.
- **Tasks**:
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

- **Description**: Add an independent **Fat-Finger Tap Assist** toggle (`fatFingerAssist`) paired with a configurable **Touch Reach Radius** setting (`touchReachRadiusPx`, `8px`--`40px` screen CSS pixels with `Compact 12px` / `Standard 22px` / `Large 34px` presets) that snaps near-miss mobile taps onto intended tiny micro-regions.
- **Value**: Eliminates frustrating dead taps when a fingertip lands `2`--`8px` off a `< 50px` micro-region onto a border or filled neighbor.
- **Tasks**:
  - **TASK-3.5a**: Implement zero-allocation radial near-tap hit-testing (`resolveNearTapRegionId` in `PuzzleCanvas.tsx`) scaling `touchReachRadiusPx / totalScreenScale` dynamically across zoom levels.
  - **TASK-3.5b** `[quick-win]`: Add `fatFingerAssist: boolean` and `touchReachRadiusPx: number` (`Compact 12px` / `Standard 22px` / `Large 34px` presets + `8px`--`40px` slider) in `SettingsModal.tsx` with Playwright E2E near-miss micro-region tap tests.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Story` | `EPIC-3` | `priority: high` | `domain: canvas, gestures, ui`
- **Complexity & Model**: `medium` / `moderate` | **Recommended Model**: `Gemini 4 Argon` (`3.5a`), `Gemini 3.8 Flash` (`3.5b`)
- **Effort Estimate**: `~38,000 tokens` (`~22k` + `~16k`) | `~18--25 min agent` (`~5--7 hrs human`)
- **Target Files**: [`web/src/components/PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx), [`web/src/components/SettingsModal.tsx`](./web/src/components/SettingsModal.tsx), [`web/src/services/StorageService.ts`](./web/src/services/StorageService.ts), [`web/src/types/index.ts`](./web/src/types/index.ts), [`web/scripts/test.mjs`](./web/scripts/test.mjs), [`WEB.md`](./WEB.md)
- **Acceptance Criteria**:
  - Direct hits on playable unfilled regions remain `O(1)`; radial fallback scans integer offsets inside `Math.min(64, touchReachRadiusPx / totalScreenScale)` using scalar distance registers with zero heap allocations.

</details>
