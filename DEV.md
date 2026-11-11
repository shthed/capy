# Development & Maintenance Guide -- Capy Monorepo (`web/`, `app/`)

This guide defines the end-to-end human and AI co-development workflow, shared architectural guardrails, model selection strategy, session hygiene, CI/CD architecture, and ongoing maintenance playbooks for **Capy** ([`https://github.com/shthed/capy`](https://github.com/shthed/capy), live at [`https://shthed.github.io/capy/`](https://shthed.github.io/capy/)).

**Related Guides**: [`README.md`](./README.md) | [`AGENTS.md`](./AGENTS.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`APP.md`](./APP.md) | [`CLOUD.md`](./CLOUD.md) | [`TESTING.md`](./TESTING.md) | [`TODO.md`](./TODO.md) | [`CHANGELOG.md`](./CHANGELOG.md)

**Table of Contents**:
1. [Documentation Map & Architecture](#1-documentation-map--architecture)
2. [Human + AI Co-Development Philosophy & Optimal Goals](#2-human--ai-co-development-philosophy--optimal-goals)
3. [Choosing the Right AI Model, Capability Tier & Workflow](#3-choosing-the-right-ai-model-capability-tier--workflow)
4. [Antigravity Session, Chat Naming & Pinning Hygiene](#4-antigravity-session-chat-naming--pinning-hygiene)
5. [Core Technical Guardrails (`web/` & `app/`)](#5-core-technical-guardrails-web--app)
6. [End-to-End Git, Pull Request & Live Preview Workflow](#6-end-to-end-git-pull-request--live-preview-workflow)
7. [CI/CD Pipeline & Automated Cleanup Architecture](#7-cicd-pipeline--automated-cleanup-architecture)
8. [Versioning, Dependency Maintenance & Asset Playbooks](#8-versioning-dependency-maintenance--asset-playbooks)
9. [Environment Self-Healing & Troubleshooting Recipes](#9-environment-self-healing--troubleshooting-recipes)

> [!IMPORTANT]
> **Division Between `DEV.md` and `AGENTS.md`**:
> - [`AGENTS.md`](./AGENTS.md) is the **compact, auto-loaded AI operational contract** (`< 7 KB`) injected into every agent turn. Keep `AGENTS.md` strictly AI-specific and free of long tutorials so it never exceeds system-prompt limits or burns unnecessary tokens.
> - [`DEV.md`](./DEV.md) (this file) is the **comprehensive Human + AI collaboration, coding guardrail, and maintenance manual**, consulted by human contributors and loaded on demand by AI agents when modifying code, planning workflows, choosing models, debugging CI, or updating dependencies.

---

## 1. Documentation Map & Architecture

```mermaid
flowchart TD
    subgraph AutoLoaded["Auto-Loaded Every Agent Turn (< 7 KB)"]
        AGENTS["AGENTS.md (Core Invariants, Token Discipline & PR Rubric)"]
    end

    subgraph ProcessAndRoadmap["Process, History & Roadmap"]
        DEV["DEV.md (Human + AI Workflow, Guardrails, CI/CD & Maintenance)"]
        TODO["TODO.md (Active Pending Roadmap & Effort Estimates)"]
        CHANGELOG["CHANGELOG.md (SemVer Rules & Release History)"]
    end

    subgraph SubsystemSpecs["Subsystem Technical Specifications (Load On Demand)"]
        WEB["WEB.md (React 19, 2D Canvas, Gestures & Settings)"]
        PUZZLE["PUZZLE.md (Web Worker, K-Means, Sobel & Watershed)"]
        APP["APP.md (Kotlin WebView Launcher, Haptics & Disk Backups)"]
        CLOUD["CLOUD.md (Play Games v2, Google Drive Sync & Co-op)"]
        TESTING["TESTING.md (Unified Vite SSR + Playwright E2E & JUnit4)"]
    end

    AGENTS --> DEV
    AGENTS --> TODO
    AGENTS --> CHANGELOG
    AGENTS --> WEB
    AGENTS --> PUZZLE
    AGENTS --> APP
    AGENTS --> CLOUD
    AGENTS --> TESTING
```

### Repository Documentation Index

- **[`README.md`](./README.md)** (*Players & Contributors*): Product showcase, controls cheat sheet, developer quick start, privacy policy link, and documentation index.
- **[`DEV.md`](./DEV.md)** (*Humans & AI Agents*): Co-development philosophy, model selection, `#NNN` session hygiene, shared technical guardrails, CI/CD, and maintenance playbooks.
- **[`AGENTS.md`](./AGENTS.md)** (*AI Agents — Auto-Loaded `< 7 KB`*): High-density AI guardrails, mobile-first formatting rule, token-efficiency discipline, task routing, and PR readiness contract.
- **[`WEB.md`](./WEB.md)** (*Humans & AI Agents*): React 19 UI hierarchy, `PuzzleCanvas.tsx` 3-tier offscreen caching, 6-mode touch gesture engine, Worker IPC, `NativeBridge`, storage keys, and `UserSettings` dictionary.
- **[`PUZZLE.md`](./PUZZLE.md)** (*Humans & AI Agents*): `puzzle.worker.ts` 5-strategy computer-vision pipeline, Red-Mean K-Means++ clustering, adaptive Otsu/Sobel contours, watershed absorption, and 6-stage telemetry.
- **[`APP.md`](./APP.md)** (*Humans & AI Agents*): Unified Android `:app` launcher (`MainActivity.kt`, `CapyAndroidBridge.kt`), `WebViewAssetLoader`, Pixel API 33+ LRA touch haptics, `SnapshotsClient` sync, and disk backups.
- **[`CLOUD.md`](./CLOUD.md)** (*Humans & AI Agents*): Modular `CloudProviderDriver` backends, Google OAuth 2.0 `appDataFolder` & Play Games Services v2 sign-in, CRDT `mergeProgressDeltas`, `#s=<token>` share links, and Co-op rooms.
- **[`TESTING.md`](./TESTING.md)** (*Humans & AI Agents*): Unified `web/scripts/test.mjs` runner (Vite SSR unit/codec checks + Playwright multi-touch E2E suite) and Android JUnit4 verification.
- **[`TODO.md`](./TODO.md)** (*Humans & AI Agents*): Active, uncompleted bugfixes and AAA roadmap items with token and wall-clock effort estimates (completed items are deleted immediately).
- **[`CHANGELOG.md`](./CHANGELOG.md)** (*Humans & AI Agents*): Chronological `MAJOR.MINOR.PATCH` release history synchronized with `web/package.json` and Android `versionCode`.
- **[`web/public/privacy-policy.html`](./web/public/privacy-policy.html)** (*Players & Storefronts*): Published Privacy Policy and Google Play Data Safety disclosures (`https://shthed.github.io/capy/privacy-policy.html`).

### Documentation Formatting Standards (Mobile-First & Zero-Clutter)

1. **Mobile-First Readability (No Wide Prose Tables)**: Contributors review documentation, pull requests, and Antigravity chats on mobile devices. Never author wide multi-column Markdown tables or put multi-sentence prose inside table cells (which overflow horizontally and stretch narrow columns into tall blocks of empty whitespace). Use structured bullet lists instead; reserve Markdown tables strictly for 2 short-value columns that fit narrow mobile screens without scrolling.
2. **Zero Emojis & Zero ASCII Box-Drawing Art**: Never use unicode emojis or box-drawing characters (`U+2500`--`U+257F`, `+---+`) in `.md` files. Use GFM alerts (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`), Mermaid diagrams, and structured bullet lists.
3. **Portable Relative Intra-Repo Links**: Always link repository files using relative paths (`./web/src/...`)—never machine-local `file:///...` URIs—and pin line-specific references in PR bodies and comments to immutable commit SHAs (`https://github.com/shthed/capy/blob/<sha>/<path>#L<start>-L<end>`).

---

## 2. Human + AI Co-Development Philosophy & Optimal Goals

Capy pairs real-time 60--120fps HTML5 Canvas interaction, off-thread computer vision, binary RLE/CRDT codecs, and a native Kotlin Android wrapper. Human developers and AI agents have complementary strengths across these layers.

### Optimal Goals for the Human Developer

1. **Product Vision & Prioritization**: Curate [`TODO.md`](./TODO.md) so roadmap priorities reflect player delight, accessibility, and retention rather than speculative over-engineering.
2. **Subjective Aesthetic & Tactile Judgment**: Evaluate qualities automated headless assertions cannot judge alone—inertial pan glide feel, pinch-to-zoom responsiveness, palette contrast, confetti pacing, and physical Android LRA haptic crispness on `/pull/<number>/` and `/pull/<number>/capy.apk`.
3. **Upfront Ambiguity Resolution (`/grill-me` & `/plan`)**: Answer focused design trade-off questions and approve `implementation_plan.md` artifacts *before* code generation begins. Five minutes spent aligning on a plan saves tens of thousands of tokens of rework.
4. **Session & Context Hygiene**: Keep each chat scoped to one PR (or one tightly related batch), prefix new chat prompts with `#NNN` for clean auto-titling, and pin/unpin threads to match open PR state.
5. **Final Merge Gatekeeping**: Verify the live preview link and the **5-Pillar PR Readiness & Perfection Confidence Score (`>= 95%`)** before approving any merge to `main`.

### Optimal Goals for the AI Agent

1. **Token-Efficient Precision**: Locate exact symbols via targeted search and line-sliced file reads rather than loading entire multi-thousand-line files, batch independent tool calls in parallel, and keep diffs minimal.
2. **Transparent Live Reasoning**: Continuously surface clear, high-level working status updates explaining *what* file or system is being inspected, *why* each step is being taken, and *what* was learned from the prior tool output.
3. **Invariant-First Engineering**: Enforce zero per-frame heap allocations in `requestAnimationFrame` hot paths, strict Web Worker isolation in `puzzle.worker.ts`, relative `./assets/...` paths, and defensive `NativeBridge` fallbacks without needing reminders.
4. **Self-Healing Deterministic Verification**: Author and run unit, codec, Playwright E2E (`npm test`), TypeScript (`npm run lint`), Vite (`npm run build`), and Android Gradle checks (`./gradlew app:testDebugUnitTest`, `./gradlew app:assembleDebug`), fixing regressions autonomously before opening or updating a PR.
5. **Zero-Drift Documentation & Traceability**: Synchronize subsystem `.md` files, [`CHANGELOG.md`](./CHANGELOG.md), and [`TODO.md`](./TODO.md) in the same PR as the code change, pinning every code reference to an immutable commit SHA (`blob/<sha>/<path>#L<start>-L<end>`).

### Capy Lean Agile Backlog & `TODO.md` Entry Standard

Capy uses a lightweight **Lean Agile** backlog in [`TODO.md`](./TODO.md) purpose-built for rapid Human + AI iteration rather than multi-week calendar sprints:

1. **3-Tier Hierarchy (`EPIC-*` -> `US-*` / `BUG-*` -> `1-PR TASK-*`, plus `ICE-*`)**:
   - **Epics (`EPIC-1`..`EPIC-N`)**: Outcome-driven product pillars ordered strictly by execution priority, each stating a clear **Epic Goal**.
   - **User Stories (`US-N.M`) & Bugs (`BUG-N`)**: Cohesive player-facing capabilities or verified defects.
   - **Tasks (`TASK-N.Ma`, `TASK-N.Mb`, ...)**: Independently mergeable `1-PR` slices. Tag `<= 15 min` (`1--3` file, zero-backend, `Flash`-ready) slices with `[quick-win]` and index them in Section 1 (`Quick-Win Ready Queue`).
   - **Platform Icebox (`ICE-*`)**: Unscheduled long-term platform shells kept collapsed at the bottom of `TODO.md` until actively chartered.
2. **Definition of Ready (Anti-Busywork Gate)**:
   - An item may enter [`TODO.md`](./TODO.md) **only** if it states concrete **Player Value** (better touch ergonomics, tactile polish, accessibility, daily retention, creative sharing) or **Reliability Value** (fixing a real crash, data-loss vector, UI defect, or silent test blindspot) alongside a **Why Now** priority justification.
   - Reject zero-impact housekeeping chores (e.g., pruning unreferenced catalog keys that add `0 B` to builds, committing dummy config placeholders before credentials exist, redundant P2P layers, or ad-SDK bloat).
3. **Definition of Done (Immediate Deletion)**:
   - Never leave `[x]` checkboxes in [`TODO.md`](./TODO.md). Delete completed `TASK-*` lines (and their Quick-Win Ready Queue pointers) in the same PR that ships them; once a Story or Bug's final task ships, delete the entire card immediately.
4. **Canonical Mobile-First Card & `<details>` Template**:
   - Keep **Description**, **Value**, **Why Now**, and **1-line `TASK-*` titles** visible on the card surface; wrap verbose **Tags, Priority, Model Tier, Token/Time Estimates, Target Files, and Acceptance Criteria** inside `<details><summary>...</summary></details>` (always keep a blank line after `</summary>` and before `</details>` so GitHub Flavored Markdown renders inner bullet lists):
   ````markdown
   ### US-X.Y: Concise Outcome-Focused Title

   - **Description**: Plain-English summary of what is built or fixed.
   - **Value**: Concrete benefit to player experience, accessibility, or reliability.
   - **Why Now**: Justification for why this item earns its current backlog priority.
   - **Tasks**:
     - **TASK-X.Ya** `[quick-win]`: Independently mergeable 1-PR slice summary.
     - **TASK-X.Yb**: Follow-up 1-PR slice summary.

   <details>
   <summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

   - **Type & Priority**: `Story` | `EPIC-X` | `priority: high` | `domain: canvas, ui`
   - **Complexity & Model**: `medium` / `moderate` | **Recommended Model**: `Flash` (`X.Ya`), `Pro` (`X.Yb`)
   - **Effort Estimate**: `~35,000 tokens` | `~16--22 min agent` (`~4--6 hrs human`)
   - **Target Files**: `./web/src/...`
   - **Acceptance Criteria**:
     - Concrete, testable invariants verified by `npm test` or `./gradlew app:testDebugUnitTest`.

   </details>
   ````

---

## 3. Choosing the Right AI Model, Capability Tier & Workflow

Selecting the right model tier and slash workflow maximizes code quality on hard algorithmic problems while avoiding slow latency and high token cost on routine edits.

### A. Capability Tiers & Named Frontier Models

- **Frontier High-Reasoning (`Pro`)**:
  - *Antigravity Subagent Tier*: `pro` (or `inherit` from a Pro session).
  - *Representative Models*: **Gemini 2.5 / 3 Pro**, **Claude Opus / Sonnet (Thinking)**, **OpenAI o3 / GPT-5 High-Reasoning**.
  - *Ideal Capy Use Cases*: Deep multi-file invariant tracking, 2D affine viewport & focal-point math (`PuzzleCanvas.tsx`), K-Means++ / Sobel / watershed segmentation (`puzzle.worker.ts`), binary RLE + LEB128 + CRDT sync (`CapyCodec.ts`), concurrency/mutex debugging, and `/grill-me` + `/plan` design specs.
  - *Token & Latency Profile*: Higher cost and thinking latency, but eliminates subtle math/state regressions that cheaper models loop on.
- **Balanced / Fast Frontier (`Flash`)**:
  - *Antigravity Subagent Tier*: `flash`.
  - *Representative Models*: **Gemini 2.5 / 3 Flash**, **Claude Sonnet (Standard) / Haiku**, **GPT-4o / Codex-Fast**.
  - *Ideal Capy Use Cases*: Executing an already-approved `implementation_plan.md`, building React 19 modals & Tailwind CSS 4 layouts (`SettingsModal.tsx`, `PaletteDock.tsx`), adding Playwright E2E test cases (`web/scripts/test.mjs`), parallel `research` subagent exploration, and `.md` / `CHANGELOG.md` synchronization.
  - *Token & Latency Profile*: Low latency and `~3--5x` lower token cost; ideal for well-specified implementation and research.
- **Ultra-Light (`Flash-Lite`)**:
  - *Antigravity Subagent Tier*: `flash_lite`.
  - *Representative Models*: **Gemini Flash-Lite**, **Claude Haiku-class**.
  - *Ideal Capy Use Cases*: Mechanical formatting, PR title/label compliance audits, log extraction, link checking, and simple copy tweaks.
  - *Token & Latency Profile*: Minimal cost and near-instant responses; never use for canvas math or concurrency logic.

#### Nuances Across Named Model Families on Capy Tasks
- **Gemini Pro**: Excels at cross-repository synthesis (holding `App.tsx`, `PuzzleCanvas.tsx`, `NativeBridge.ts`, and `CapyAndroidBridge.kt` invariants together), long-context multimodal screenshot inspection (`docs/gallery/`), and structured `/plan` architecture.
- **Claude Opus / Sonnet (Thinking)**: Excels at surgical multi-hunk refactoring (`replace_file_content`), nuanced CSS/UI polish, and strict adherence to formatting and documentation constraints.
- **OpenAI o-series / GPT-5 / Codex**: Excels at self-contained algorithmic kernels (bit-packed typed arrays, binary codecs, graph coloring heuristics, and deterministic unit test edge cases).
- **Gemini Flash**: Optimal workhorse for fast interactive UI iterations, `research` subagent codebase sweeps, and documentation updates once architectural ambiguity is resolved.

### B. Task-to-Model & Slash-Command Routing

- **Ambiguous New Feature or UX Redesign**: Use `Pro` with `/grill-me` + `/plan` to resolve UX/state edge cases one decision at a time before producing a reviewable `implementation_plan.md`.
- **Canvas Gestures, Worker Pipeline, or Binary Codec**: Use `Pro` with `/plan` to protect coordinate invariants, zero-allocation hot paths, and backward-compatible `.capy` v2 schemas.
- **Multi-Bug Audit or Autonomous Milestone Sprint**: Use `Pro` with `/goal` so the agent iterates autonomously through implementation, `npm test`, and CI verification until 100% green.
- **Large Multi-Subsystem Initiative (`web/` + `app/` + `CLOUD.md`)**: Use a `Pro` orchestrator + subagents with `/plan` or `/teamwork` to isolate research, implementation, and E2E verification contexts.
- **Scoped UI Tweak, New Setting Toggle, or Test Addition**: Use `Flash` (or `Pro` direct) with a direct prompt for a fast single-pass edit + `npm run lint && npm run build && npm test`.
- **Documentation Sync, Dependency Bump, or CI Tweak**: Use `Flash` with a direct prompt for straightforward verification with minimal reasoning overhead.
- **PR History Audit, Link Check, or Log Triage**: Use `Flash-Lite` or `Flash` with a direct prompt for near-zero token burn.

### C. Subagent Delegation Rules

When working inside Antigravity:
- **Default Model Inheritance**: Always pass `Model: 'inherit'` when invoking subagents via `invoke_subagent` unless the human explicitly requests a specific tier (`pro`, `flash`, `flash_lite`).
- **Workspace Mode**: Always use `Workspace: 'inherit'` (branched/worktree subagent workspaces are unsupported in the container sandbox).
- **When to Spawn a `research` Subagent**: Delegate broad read-only codebase surveys (e.g., auditing every caller of `StorageService` or scanning 10+ files) to `research` so raw search output stays out of the main implementation context window. Perform quick 1--3 file lookups directly in the main agent.

---

## 4. Antigravity Session, Chat Naming & Pinning Hygiene

### How Chat Titles & Bookmarks Work Under the Hood

1. **First-Prompt Auto-Titling**: Antigravity generates the left-sidebar conversation title **once** from your very first message in a new thread. Sidebar thread titles and pin states live in the host web application's database outside the Linux VM sandbox, so the agent inside the VM cannot rename or pin/unpin sidebar threads via shell commands.
2. **Shared Brain Storage (`/shared/user/.gemini/jetski/brain/`)**: Markdown artifacts (`implementation_plan.md`, `walkthrough.md`) and URL bookmark cards (`*.url.json`) live inside `/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/<conversation-id>/` and *can* be created, updated, and cleaned up directly by the agent.

### Mandatory Human + AI Session Conventions

1. **Start Every New PR Chat With `#NNN` (`First-Prompt Rule`)**:
   - Check the latest PR number on GitHub and start your opening prompt in a new chat with the upcoming PR number:
     ```text
     #467 Create DEV.md and optimize AGENTS.md for token efficiency
     ```
   - Because the auto-titler summarizes the opening prompt, your chat thread will automatically begin with `#467` without manual renaming.
2. **Pin While Open, Unpin When Merged (`Sidebar Pinning Policy`)**:
   - **Pin** any conversation whose pull request(s) are still **open** or actively under review so in-flight work stays anchored at the top of the sidebar.
   - **Unpin** the conversation as soon as its pull request is **merged** or **closed**.
3. **One PR (or Tightly Coupled Batch) Per Chat (`Context Freshness`)**:
   - Long multi-day chats accumulate tens of thousands of historical tokens re-sent on every turn. Starting a fresh `#NNN` chat for each new feature or bugfix batch keeps per-turn token burn low and reasoning sharp.
4. **Canonical `.url.json` Bookmark Cards**:
   - When the agent opens a PR, it bookmarks the PR using `PR_<number>.url.json` (`UserFacing: true`) with `"title": "#<number> <Canonical GitHub PR Title>"`.
   - Once a PR is merged and its `/pull/<number>/` preview is cleaned up, stale preview `.url.json` cards should not be left pointing to `404` URLs.

---

## 5. Core Technical Guardrails (`web/` & `app/`)

All human and AI contributors modifying Web (`web/`) or Android (`app/`) code must preserve these core architectural invariants:

### A. Web & Puzzle Engine Conventions (`web/`)

1. **Coordinates & Viewport Invariance ([`PuzzleCanvas.tsx`](./web/src/components/PuzzleCanvas.tsx))**:
   - Maintain explicit distinctions between Screen (DOM pointer), Container (CSS client bounds), Artwork (canvas pixel grid), and Segmentation (`regions[id]`) coordinates using `screenToCanvas` and `clampCanvasOffset`.
   - Preserve focal-point invariance under multi-touch pinch-to-zoom and Google Maps-style one-finger double-tap-and-drag zoom.
   - **Never** move, reset, or zoom the viewport automatically on puzzle completion or replay start/end (`startReplay`, `finishAutoResume`, `handleLoadSnapshot` on the already-active save). Move the camera only on explicit user gestures/buttons, switching to a different saved puzzle, or opt-in Follow Painting.
2. **Zero-Allocation Hot Paths**:
   - Never instantiate objects or arrays inside `requestAnimationFrame` loops, pan momentum gliding, canvas repaints, or high-frequency touch gesture handlers. Reuse typed arrays (`Uint8Array`, `Uint32Array`), pre-allocated bounding box structs, and scratch vectors to avoid GC micro-stutter.
3. **Direct Canvas Refs vs. React State**:
   - Mutate canvas/gesture refs directly and schedule repaints via `requestAnimationFrame` for 60--120fps dragging, gliding, and pinch zooming without triggering React virtual DOM reconciliation.
   - Reserve React state strictly for discrete UI transitions (active swatch selection, region completion counts, modal visibility, victory overlays).
4. **Web Worker Isolation & Cancellation ([`puzzle.worker.ts`](./web/src/engine/puzzle.worker.ts))**:
   - Execute all CPU-heavy image processing (K-Means clustering, Otsu/Sobel contour extraction, watershed region segmentation) exclusively inside `puzzle.worker.ts` using transferable `ArrayBuffer` payloads.
   - Support clean cancellation/termination whenever a new puzzle generation begins.
5. **Relative Asset Path Invariance**:
   - Never use root-relative `/assets/...` URLs in code or CSS. Always use `./assets/...` and keep `base: './'` in [`web/vite.config.ts`](./web/vite.config.ts) so assets resolve identically across GitHub Pages (`/`), PR previews (`/pull/<number>/`), and Android WebView (`https://appassets.androidplatform.net/assets/www/`).
6. **Defensive `NativeBridge` Fallbacks ([`NativeBridge.ts`](./web/src/services/NativeBridge.ts))**:
   - Feature-detect host capabilities on every call (`haptic`, `saveBackup`, `loadBackup`, `setBackModalOpen`, `onSharedImage`, `shareImage`) and fall back safely to Web APIs (`navigator.vibrate`, IndexedDB, Web Share API) without uncaught exceptions.
7. **Storage Durability & IndexedDB Quota Safety ([`StorageService.ts`](./web/src/services/StorageService.ts))**:
   - Never store raw binary image Blobs or large base64 strings in synchronous `localStorage` (5 MB cap, blocks main thread).
   - Store bitmaps and puzzle maps in IndexedDB (`capy_game_storage_v8`: `puzzles` and `images` stores) paired with `filesDir/capy_saves` backups on Android, persist typed `UserSettings` under `capy_user_settings_v8`, and keep `.capy` v2 schema migrations backward-compatible.
8. **Touch Gesture Transitions & Hardware Back Navigation**:
   - Maintain `touch-action: none` ([`web/src/index.css`](./web/src/index.css)) on the interactive canvas container and dynamically re-anchor pan coordinates when releasing one finger out of a pinch-to-zoom gesture so the canvas never jumps.
   - Register open modals via `NativeBridge.pushBackHandler(onClose)` / `setBackModalOpen` (`window.__capyCloseModal()` from `MainActivity.kt`) alongside desktop `Escape` listeners.

### B. Native Android Style & Safety (`app/`)

1. **Trailing Commas & Clarifying Parentheses**: Use trailing commas in multiline parameter/data-class lists and explicit parentheses around compound logical or range sub-expressions.
2. **Android KTX Extensions**: Prefer `androidx.core.graphics.createBitmap(...)`, `bitmap.scale(width, height)`, and `sharedPreferences.edit { ... }`.
3. **Array-Holding Data Classes**: Explicitly override `equals()` and `hashCode()` using `contentEquals()` and `contentHashCode()` on any Kotlin `data class` holding `IntArray` or `BooleanArray`.
4. **Zero-Allocation Loops**: Use primitive array buffers rather than boxed allocations inside native image downsampling or rendering paths.

---

## 6. End-to-End Git, Pull Request & Live Preview Workflow

### Step 1: Session Kick-Off & Linear Branch Creation

Always synchronize with `origin/main` before making edits so branches stay strictly linear without merge commits:

```bash
git fetch --all --prune
git checkout -b feature/<short-topic> origin/main
# Allowed prefixes: feature/, automation/, fix/, docs/, ci/, deps/, chore/
```

If `origin/main` advances while a PR is open, rebase cleanly:

```bash
git fetch origin main
git rebase origin/main
```

### Step 2: Local Development & Verification

Run the mandatory checks matching your changed files before pushing:

#### Web Application (`web/`)
```bash
cd web
npm ci                   # Clean dependency install (first run or lockfile change)
npm run dev              # Local Vite dev server on http://localhost:3000
npm run lint             # Strict TypeScript check (tsc --noEmit) -- MANDATORY for code PRs
npm run build            # Production bundle (tsc && vite build -> web/dist/) -- MANDATORY for code PRs
npm test                 # Unified engine, codec, version/changelog & Playwright E2E suite
npm run gallery:capture  # Refresh docs/gallery/*.png when UI/theme visuals change
npm run generate:samples # Rebuild web/public/assets/sample_saves.capy when built-in samples change
```

#### Native Android Wrapper (`app/`, from repository root)
```bash
./gradlew app:buildWeb          # Compiles web/ into web/dist/
./gradlew app:testDebugUnitTest # JUnit4 unit tests (CapyAndroidBridgeTest.kt)
./gradlew app:assembleDebug     # Syncs web/dist/ into assets/www/ and builds debug APK
# NEVER run ./gradlew app:installDebug unless explicitly requested by the user.
```

### Step 3: Pull Request Standards, Labels, Overview Paragraph & Live Previews

1. **Action-Oriented PR Titles**: Write clean, meaningful, high-level action-oriented titles focusing on the overall purpose of the PR (e.g., `Add DEV.md and overhaul repository documentation`, `Resolve all remaining audit bugfixes from TODO`). Never cram comma-separated laundry lists of unrelated subsystems into the title, and avoid `feat(scope):` prefixes or buzzwords.
2. **GitHub Labels**: Attach all relevant labels when creating or editing a PR:
   - `feature`: New gameplay features, modes, or capabilities.
   - `fix`: Bug fixes, gesture edge-case fixes, or rendering repairs.
   - `docs`: Architecture guides, README updates, privacy policy, roadmap, and process docs.
   - `ui`: Styling, themes, modal layouts, and gallery visuals.
   - `testing`: Playwright E2E assertions, unit checks, and test harnesses.
   - `ci`: GitHub Actions workflows and deployment scripts.
   - `deps`: `npm` or Gradle version catalog (`libs.versions.toml`) updates.
3. **Top-of-PR Live Preview Callout**: Whenever `deploy-branch.yml` deploys a PR preview, place the playable preview URL (`https://shthed.github.io/capy/pull/<number>/`) and Android preview APK (`https://shthed.github.io/capy/pull/<number>/capy.apk`) at the very top of the PR body.
4. **Plain-English Top Overview Paragraph & "Why" Rationale**: Immediately below the live preview callout (and above the PR Readiness Score), include a concise plain-English overview paragraph summarizing everything included in the PR and *why* it was needed. If a PR bundles multiple unrelated bugfixes or cleanup chores together, state that candidly rather than inventing an artificial unifying theme, and explain the *why* behind each major work item in the body.
5. **Commit-Pinned Line Links**: Whenever referencing code lines in PR bodies, PR comments, or chat summaries, **never** link to `blob/main/...` (which drifts over time) or `blob/<feature-branch>/...` (which `404`s after branch deletion). Always pin to the exact commit SHA or PR diff anchor:
   - `https://github.com/shthed/capy/blob/<commit-sha>/<path>#L<start>-L<end>`
   - `https://github.com/shthed/capy/pull/<number>/files#diff-<sha256(path)>R<start>-R<end>`

### Step 4: Pre-Merge Development Summary & 5-Pillar Readiness Score (`>= 95%`)

Before asking the human to merge a PR:
1. Post a mobile-friendly **Development Summary comment** on the PR (using structured bullet lists—never wide tables!) documenting user requirements, architectural decisions, commit-pinned implementation links, verification output, and visual checks (never include secrets, tokens, or raw chat transcripts).
2. Compute the **5-Pillar PR Readiness & Perfection Confidence Score (`0--100%`)**:
   - **Pillar 1 -- Functionality & Edge Cases (`20` pts)**: Touch/mouse gestures, persistence, modal back-stack, viewport clamping, and fallbacks verified.
   - **Pillar 2 -- Automated Tests (`20` pts)**: `npm test` (engine, codec, Playwright E2E) and Android JUnit4 tests pass deterministically.
   - **Pillar 3 -- Performance & Golden Invariants (`20` pts)**: Zero per-frame allocations, worker-only segmentation, relative `./assets/...` URLs, and safe `NativeBridge` fallbacks.
   - **Pillar 4 -- Docs & Changelog Sync (`20` pts)**: [`web/package.json`](./web/package.json) version bumped, [`CHANGELOG.md`](./CHANGELOG.md) updated with a flat single brief bullet per item ending in a clickable GitHub PR link, commit-pinned file/line links included in the PR description and summary comment, completed items removed from [`TODO.md`](./TODO.md), and subsystem `.md` files synchronized (zero emojis/ASCII art, mobile-safe lists).
   - **Pillar 5 -- CI & Preview Verification (`20` pts)**: Local lint/build and GitHub Actions pass on HEAD, with both the live preview URL and plain-English overview paragraph at the top of the PR description (or intentional `paths-ignore` skip verified for `.md`-only PRs).
3. Require **`>= 95%`** before requesting merge approval. Self-correct technical/test/doc gaps automatically; use `/grill-me` if design ambiguity remains. Report the score in **(1)** the top of the PR description as a concise bullet list right below the overview paragraph, **(2)** the PR Development Summary comment, and **(3)** the chat message requesting merge approval (explicitly noting the `-N` point reason whenever `< 100%`).
4. **Wait for Explicit Approval**: Never merge a PR or push directly to `main` without explicit user confirmation.

### Reopening & Continuing Work on a Closed Pull Request

- **Closed Without Merging (`state: CLOSED`)**: Can be reopened on the **same PR number**, even after `cleanup-closed-pr.yml` deleted its remote branch, because GitHub retains `refs/pull/<number>/head`:
  ```bash
  # 1. Fetch the exact closing commit into the PR's original head branch name
  git fetch origin pull/<number>/head:<original-branch-name>
  # 2. Push that exact SHA to origin so GitHub unlocks reopening
  git push origin <original-branch-name>
  # 3. Reopen the pull request (automatically triggers a fresh preview deploy)
  gh pr reopen <number>
  # 4. Checkout, rebase onto origin/main, and push follow-up commits
  git checkout <original-branch-name>
  git pull --rebase origin main
  git push --force-with-lease origin <original-branch-name>
  ```
- **Already Merged (`state: MERGED`)**: Immutable on GitHub. Always create a new branch from `origin/main` and open a new PR for follow-up work.

---

## 7. CI/CD Pipeline & Automated Cleanup Architecture

Capy runs three coordinated GitHub Actions workflows in [`.github/workflows/`](./.github/workflows):

### 1. Unified Build & Preview Deployment ([`deploy-branch.yml`](./.github/workflows/deploy-branch.yml))
- **Zero-Minute Documentation Fast-Path (`paths-ignore`)**: Commits that exclusively touch `**.md`, `docs/**`, `notes/**`, `.gitignore`, or `LICENSE` automatically skip CI builds and Pages deploys, consuming zero runner minutes.
- **Job 1 -- `build` (`Build & Test`, `contents: read`)**:
  - Runs concurrently across open PRs with `cancel-in-progress: true` per PR/ref.
  - Compiles `web/` (`npm ci && npm run build`), runs Android JUnit4 tests (`./gradlew app:testDebugUnitTest`), and assembles the debug APK (`./gradlew app:assembleDebug`).
- **Job 2 -- `deploy` (`Deploy to GitHub Pages`, `contents: write`, `pages: write`, `id-token: write`, `pull-requests: write`)**:
  - Serializes under the `deploy-pages` concurrency lock (`cancel-in-progress: false`).
  - Publishes `main` builds to `/` (`https://shthed.github.io/capy/`) and `/capy.apk`.
  - Publishes open PR builds to `/pull/<number>/` and `/pull/<number>/capy.apk`, then posts or updates the PR preview comment.
  - Squashes `gh-pages` into a single **orphan commit** on every push so binary `.apk` artifacts never bloat Git history.

### 2. Closed PR Preview & Branch Cleanup ([`cleanup-closed-pr.yml`](./.github/workflows/cleanup-closed-pr.yml))
- Triggered automatically on `pull_request: types: [closed]` (both merged and closed-unmerged PRs).
- Deletes the PR's head branch from `origin` and invokes `.github/scripts/cleanup-gh-pages-previews.mjs --target-pr <number> --ignore-recency` under the `deploy-pages` lock to remove `/pull/<number>/` from `gh-pages` and redeploy Pages cleanly.

### 3. Scheduled Stale Branch & Orphan Sweep ([`cleanup-branches.yml`](./.github/workflows/cleanup-branches.yml))
- Runs daily at `06:00 UTC` (`cron: '0 6 * * *'`) or manually via `workflow_dispatch`.
- Invokes `.github/scripts/cleanup-branches.mjs` to prune merged/stale branches (`>= 1` day old) matching `automation/`, `feature/`, `fix/`, `chore/`, `ci/`, `deps/`, `docs/`, or `codex/`, followed by `cleanup-gh-pages-previews.mjs` to remove any orphaned `/pull/` directories.

---

## 8. Versioning, Dependency Maintenance & Asset Playbooks

### A. Single-Source-of-Truth Versioning (`MAJOR.MINOR.PATCH`)

1. **Canonical Version**: [`web/package.json`](./web/package.json) `"version"` (`0 <= MINOR <= 99`, `0 <= PATCH <= 99`).
2. **Automatic Propagation**:
   - [`web/src/version.ts`](./web/src/version.ts) derives `APP_VERSION` and `APP_VERSION_CODE = (MAJOR * 10000) + (MINOR * 100) + PATCH` (rendered in `SettingsModal.tsx` `data-testid="app-version-badge"`).
   - [`app/build.gradle.kts`](./app/build.gradle.kts) parses `../web/package.json` at Gradle configuration time to set `versionName` and monotonic `versionCode` for Google Play Console uploads.
3. **When to Bump & How to Format `CHANGELOG.md`**:
   - **`MAJOR` (`X.0.0`)**: Breaking storage/codec epochs or major platform launches (`0.x` covers pre-monorepo Legacy Web1 milestones `#1`--`#430`; `1.0.0` begins at Unified Monorepo launch `#431`).
   - **`MINOR` (`2.Y.0`)**: Backward-compatible gameplay features, replay modes, UI controls, cloud/multiplayer drivers, or new `UserSettings` keys.
   - **`PATCH` (`2.5.Z`)**: Backward-compatible bug fixes, gesture edge-case corrections, performance optimizations, test consolidation, documentation/changelog audits, or dependency updates.
   - **Compact Mobile-First `CHANGELOG.md` Contract** (enforced automatically by `npm test` in [`web/scripts/test.mjs`](./web/scripts/test.mjs)):
     - **Zero Preamble**: Start [`CHANGELOG.md`](./CHANGELOG.md) directly on line 1 with the newest `###` version heading—no `#` title, introductory prose, or `---` dividers.
     - **Compact Headings**: Format release headings as `### MAJOR.MINOR - YYYY-MM-DD` (or `### MAJOR.MINOR.PATCH - YYYY-MM-DD` for standalone later-date patches and pre-monorepo `0.x.y` milestones). Never use `#` / `##`, square brackets, PR numbers, or `Android versionCode` in headings so every heading fits on one line on mobile.
     - **Same-Day Patch Rollup**: Combine consecutive `+0.0.1` (`PATCH`) releases on the same day under their `### MAJOR.MINOR - YYYY-MM-DD` heading while still incrementing `"version"` in [`web/package.json`](./web/package.json) on each PR for monotonic Android `versionCode` builds.
     - **Single Brief Bullet Ending in Bare `#<number>` PR Link**: Every item must be a single, flat, brief bullet ending with its merged PR link formatted as bare `#<number>` (no parentheses or `"PR"` prefix, zero `Added`/`Changed`/`Fixed` category sub-headings, zero nested sub-bullets, and zero inline file/line links).

### B. Updating Dependencies (`web/` & `app/`)

#### Web Packages (`web/package.json`)
```bash
cd web
npm outdated          # Inspect available SemVer and major updates
npm update            # Upgrade within SemVer ranges and refresh package-lock.json
npm run lint && npm run build && npm test
```

#### Android Version Catalog (`gradle/libs.versions.toml`)
1. Update library versions centrally in [`gradle/libs.versions.toml`](./gradle/libs.versions.toml).
2. Verify `compileSdk` compatibility in [`app/build.gradle.kts`](./app/build.gradle.kts) (currently `compileSdk = 35`). If a newer AndroidX artifact requires `compileSdk 36+`, either bump `compileSdk` alongside the dependency or pin to the latest stable release supporting API 35.
3. Run `./gradlew app:testDebugUnitTest && ./gradlew app:assembleDebug` to verify.

### C. Pre-Baked Samples & Visual Showcase Gallery
- **Built-in Sample Archive (`sample_saves.capy`)**: Whenever default generation parameters, `CapyCodec` binary framing, or `SAMPLE_GALLERY` entries change, run `npm run generate:samples` inside `web/` so first-time players get instant zero-worker startup.
- **README / Docs Showcase Screenshots (`docs/gallery/`)**: Whenever UI layout, theme colors, or modal styling changes significantly, run `npm run gallery:capture` inside `web/` to refresh deterministic high-DPI screenshots.

---

## 9. Environment Self-Healing & Troubleshooting Recipes

- **`tsc: not found` or missing `node_modules`**:
  - *Cause*: Fresh container or worktree without installed npm packages.
  - *Fix*: Run `npm ci` inside `web/` before running `lint`, `build`, or `test`.
- **`ERR_CONNECTION_REFUSED http://localhost:3000/` on standalone Playwright scripts**:
  - *Cause*: Standalone browser scripts expect a live server on port `3000` (whereas `npm test` auto-starts Vite SSR/preview).
  - *Fix*: Start `npm run preview` as a background daemon (`IsDaemon: true`), run the check, and stop the daemon when finished—or run `npm test` directly.
- **`Executable doesn't exist at .../chromium`**:
  - *Cause*: Playwright Chromium binary not yet cached in container.
  - *Fix*: Run `npx playwright install chromium` inside `web/`.
- **GitHub Actions checks do not trigger on a PR**:
  - *Cause*: PR exclusively modifies `.md`, `docs/**`, `.gitignore`, or `LICENSE` (`paths-ignore` in `deploy-branch.yml`).
  - *Fix*: Expected behavior (consumes zero runner minutes). Verify markdown links, zero emojis, zero ASCII art, and mobile-safe bullet formatting locally.
- **Local Gradle fails with `SSLException: trustAnchors parameter must be non-empty`**:
  - *Cause*: Container JDK lacks a populated `/etc/ssl/certs/java/cacerts` truststore.
  - *Fix*: **Never** disable TLS verification or tamper with host trust roots. Verify `npm run lint` and `npm run build` locally, push the branch, and rely on GitHub Actions `Build & Test` (provisioned with Temurin JDK 17) to run `./gradlew app:testDebugUnitTest` and `./gradlew app:assembleDebug`.
