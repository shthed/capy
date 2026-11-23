# AI Workflow, Model Routing & Session Hygiene (`docs/ai/workflow-and-models.md`)

Private AI-assisted development guide for the Capy monorepo. Excluded wholesale from public `capyboop/paint` clean-room exports via [`rebrand-persona.mjs`](../../web/scripts/rebrand-persona.mjs).

**Related Guides**: [`AGENTS.md`](../../AGENTS.md) | [`CAPYBOOP.md`](../../CAPYBOOP.md) | [`pr-readiness.md`](./pr-readiness.md) | [`cross-repo-guardrail.md`](./cross-repo-guardrail.md) | [`DEV.md`](../../DEV.md) | [`PROJECT.md`](../../PROJECT.md) | [`ROADMAP.md`](../../ROADMAP.md)

---

## 1. Human + AI Co-Development Philosophy

Capy pairs real-time 60--120fps HTML5 Canvas interaction, off-thread computer vision, binary RLE/CRDT codecs, and a native Kotlin Android wrapper. Human developers and AI agents hold complementary responsibilities across these layers.

### Human Project Owner Focus
1. **Product Vision & Prioritization**: Curate high-level direction in [`ROADMAP.md`](../../ROADMAP.md) (governance in [`PROJECT.md`](../../PROJECT.md)) and prioritize concrete work in GitHub Issues.
2. **Subjective Aesthetic & Tactile Judgment**: Evaluate qualities automated headless assertions cannot judge alone—inertial pan glide feel, pinch-to-zoom responsiveness, palette contrast, procedural audio warmth, confetti pacing, and physical Android LRA haptic crispness.
3. **Upfront Ambiguity Resolution (`/grill-me` & `/plan`)**: Answer focused design trade-off questions and approve implementation plans before code generation begins.
4. **Session & Context Hygiene**: Keep each interactive chat scoped to one PR (or one cohesive Story/Sprint slice under `/goal` or `/teamwork`), prefix new chat prompts with `#NNN` for clean auto-titling, and pin/unpin threads to match open PR state.
5. **Final Governance & Release Holds**: Enforce or lift release holds, execute Human-Only Ops (Cloudflare/Play Console/credentials), and review logged implementation plans and audit issues.

### AI Contributor & Agent Focus
1. **Token-Efficient Precision**: Locate exact symbols via targeted search and line-sliced file reads rather than loading entire multi-thousand-line files, batch independent tool calls in parallel, and keep diffs minimal.
2. **Transparent Live Reasoning**: Continuously surface clear, high-level working status updates explaining *what* file or system is being inspected, *why* each step is being taken, and *what* was learned.
3. **Invariant-First Engineering**: Enforce zero per-frame heap allocations in `requestAnimationFrame` hot paths, strict Web Worker isolation in `puzzle.worker.ts`, relative `./assets/...` paths, and defensive `NativeBridge` fallbacks per [`DEV.md`](../../DEV.md).
4. **Thorough Local VM Verification**: Run `npm run test:sanity && npm run lint && npm run build && npm test` (plus `./gradlew app:testDebugUnitTest` when available) inside the local VM before pushing, keeping GitHub Actions fast and lightweight.
5. **Zero-Drift Documentation & Traceability**: Synchronize affected subsystem `.md` files and [`ROADMAP.md`](../../ROADMAP.md) in the same PR as the code change, drop a concise `.changelog/<slug>.md` fragment on feature/bugfix PRs targeting `beta`, and pin code references to immutable commit SHAs.

---

## 2. Choosing the Right AI Model, Capability Tier & Workflow

Selecting the right capability tier and slash workflow maximizes code quality on hard algorithmic problems while preserving rolling Antigravity quota and keeping interactive turns fast.

### A. Capability Tiers & Named Frontier Models
- **Deep-Verification Frontier (`Carbon` -- ~15% of PRs)**:
  - *Antigravity Selection / Subagent Tier*: **Gemini 4 Carbon** (`gemini-4-carbon`, default `medium` thinking; `high` only for hardest math/security specs) or **Claude Opus 5.5 (Thinking)** (`pro` subagent tier).
  - *Ideal Use Cases*: `/grill-me` + `/plan` architecture interviews, zero-allocation 2D affine and circular-clip rendering math in `PuzzleCanvas.tsx`, `puzzle.worker.ts` segmentation invariants, CRDT/concurrency race audits, and OAuth/WebCrypto security specs.
- **Efficient Frontier Daily Driver (`Argon` -- ~65--70% of PRs)**:
  - *Antigravity Selection / Subagent Tier*: **Gemini 4 Argon** (`gemini-4-argon`, `pro` / `inherit` subagent tier).
  - *Ideal Use Cases*: Default daily driver for multi-file feature stories, `/goal` and `/teamwork` sprint execution, Co-op/IndexedDB bugfixes, and Android Kotlin + `NativeBridge.ts` integration.
- **Fast Frontier Workhorse (`Flash` -- ~15--20% of PRs)**:
  - *Antigravity Selection / Subagent Tier*: **Gemini 3.8 Flash** (`gemini-3.8-flash`, `flash` subagent tier) or **Claude Sonnet / Haiku**.
  - *Ideal Use Cases*: Small quick-win issues, React 19 modal/settings controls, CI workflow wiring, parallel `research` subagent codebase sweeps, and `.md` / `ROADMAP.md` / `CHANGELOG.md` synchronization.
- **Ultra-Light (`Flash-Lite`)**:
  - *Antigravity Subagent Tier*: `flash_lite` (**Gemini 3.5 Flash-Lite**).
  - *Ideal Use Cases*: Mechanical log extraction, PR label/title audits, link checks, and copy tweaks; never use for canvas math or concurrency logic.

### B. Task-to-Model & Slash-Command Routing
- **Ambiguous New Feature, UX Redesign, or Architecture Plan**: Use **Gemini 4 Carbon** (or **Argon**) with `/grill-me` + `/plan`.
- **Canvas Gestures, Zero-Alloc Ring Buffers, or Security/Crypto**: Use **Gemini 4 Carbon** (`medium` thinking) with `/plan`.
- **Cohesive Feature or P0 Bug Batch (`2--4` Issues)**: Use **Gemini 4 Argon** with `/goal` (sequential self-healing loop) or `/teamwork` (parallel file-scoped workers + verifier) onto one `feature/*` PR branch.
- **Large Multi-Subsystem Campaign (`web/` + `app/` + `worker/`)**: Use **Gemini 4 Carbon** or **Argon** with `/teamwork` for milestone-gated proposer + adversarial verifier execution.
- **Single Ready GitHub Issue or Bugfix**: Use **Gemini 4 Argon** (or **Gemini 3.8 Flash** for small quick-win items) in a fresh `#NNN` chat.
- **Documentation Sync or Link Audit**: Use **Gemini 3.8 Flash** (or `Flash-Lite`) via `npm run test:sanity` and the `< 2s` docs-only CI fast-path.

### C. Subagent Delegation Rules
- **Default Model Inheritance**: Pass `Model: 'inherit'` when invoking subagents unless a specific tier (`pro`, `flash`, `flash_lite`) is explicitly requested.
- **Workspace Mode**: Use `Workspace: 'inherit'` (branched/worktree subagent workspaces are unsupported in the container sandbox; use explicit git worktrees under `/home/antigravity/.cache/capy-wt/` instead).
- **When to Spawn a `research` Subagent**: Delegate broad read-only codebase surveys (10+ files) to `research`; perform quick 1--3 file lookups directly.

---

## 3. Antigravity Session, Chat Naming & Worktree Hygiene

1. **First-Prompt `#NNN` Auto-Titling**: Start every new PR chat with the upcoming PR number (e.g., `#611 Fix ...`) so Antigravity's auto-titler anchors the sidebar thread cleanly.
2. **Pin While Open, Unpin When Merged**: Pin threads whose PRs are open or under review, and unpin once merged or closed.
3. **One PR (or Cohesive Story/Sprint Slice) Per Chat**: Avoid bundling unrelated sequential PRs into one long chat to keep rolling quotas efficient.
4. **Canonical `.url.json` Bookmark Cards**: Create `PR_<number>.url.json` (`UserFacing: true`) titled `#<number> <Canonical GitHub PR Title>` and clean up stale preview cards after merge.
5. **Worktree & `.agents/` Isolation**: Never edit inside a shared dirty primary checkout across concurrent sessions. Create isolated worktrees off fresh `origin/beta` (e.g., `/home/antigravity/.cache/capy-wt/wt-*`), namespace `.agents/teamwork/` per campaign, never run blind `git add -A` over `.agents/` metadata, and inspect `git status` plus `git show --stat HEAD` before every push.

---

## 4. Hybrid Automated Sprint Execution Modes

- **Mode 1 -- Atomic Single-Task PRs (`1-Task = 1-PR` -> `beta`, Default)**: Start a fresh `#NNN` chat for one ready `BUG-*` or `TASK-*` on `feature/*`, `fix/*`, or `docs/*` branched from updated `origin/beta`, verify locally, open a bot-authored Draft PR targeting `beta`, mark ready after checks pass, and pass strict `100%` AI review (`capy/review-gate`) with zero active Owner holds.
- **Mode 2 -- Cohesive Story / Sprint-Slice PRs (`/goal` or `/teamwork` -> `beta`)**: Execute a cohesive Story or P0 batch on one `automation/sprint-*` or `feature/*` branch off `origin/beta` with atomic per-task commits, non-overlapping file ownership across workers, and full local `npm run test:sanity && npm run lint && npm run build && npm test` verification before opening one PR targeting `beta`.
- **Retrospective Note (`.agents/` Hygiene)**: Never commit `.agents/teamwork/` scratch files into branches (learned from [#485](../../../../pull/485)); keep `.agents/*` gitignored locally while stripping `.agents/` rules from `.gitignore` during clean-room export.
