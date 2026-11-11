# AI Agent Operational Playbook — Capy Monorepo (`web/`, `app/`)

Capy is a multi-platform color-by-number suite (`https://github.com/shthed/capy`, live at `https://shthed.github.io/capy/`). This file is auto-loaded every AI turn—keep it strictly AI-specific and `< 7 KB` to prevent truncation and minimize token burn. Shared guardrails (`web/` & `app/`), Human + AI workflows, model selection, CI, and maintenance live in [`DEV.md`](./DEV.md)—read [`DEV.md` Section 5](./DEV.md#5-core-technical-guardrails-web--app) before editing code.

---

## 1. AI Golden Invariants (Non-Negotiable Agent Guardrails)

1. **Never merge without approval**: Never merge a PR or push to `main` without explicit user confirmation. Open the PR, verify checks, share the link, and wait.
2. **Build Android freely; never install unprompted**: Run `./gradlew app:testDebugUnitTest`, `./gradlew app:buildWeb`, and `./gradlew app:assembleDebug` freely; never run `./gradlew app:installDebug` unless explicitly requested.
3. **Always display detailed thoughts & visible status updates**: Continuously explain what file/system is inspected, why, and what was learned—both in thinking blocks and concise present-participle chat updates ("Inspecting...", "Verifying...", "Updating...").
4. **Enforce [`DEV.md` Section 5](./DEV.md#5-core-technical-guardrails-web--app) before coding**: Uphold all Web/Canvas/Worker/Bridge/Kotlin invariants in [`DEV.md`](./DEV.md).
5. **Verify builds before pushing code**: Always pass `npm run lint` and `npm run build` cleanly before opening or updating code PRs.
6. **Strict doc sync, zero emojis, no ASCII art & code-verified names**: Never put emojis or box-drawing art in `.md` files (use structured bullets, GFM alerts, or Mermaid). Verify exact symbol/setting/CLI names in source before documenting, delete finished items from [`TODO.md`](./TODO.md) immediately (never `[x]`), and sync [`DEV.md`](./DEV.md), [`WEB.md`](./WEB.md), [`PUZZLE.md`](./PUZZLE.md), [`APP.md`](./APP.md), [`CLOUD.md`](./CLOUD.md), [`TESTING.md`](./TESTING.md), [`TODO.md`](./TODO.md), [`CHANGELOG.md`](./CHANGELOG.md), and [`README.md`](./README.md).
7. **Report `>= 95%` PR Readiness Score before merge**: Score every PR across the 5-Pillar Rubric (`5 x 20 = 100%`). Auto-fix technical/test/doc gaps and resolve ambiguity (`/grill-me`) until `>= 95%`, then report it in (1) top of PR body (below live preview + plain-English overview paragraph), (2) PR Summary comment, and (3) chat merge request (stating exact `-N` delta if `< 100%`).
8. **Mobile-first formatting (never output wide tables)**: Never respond in chat, artifacts, PR comments, or `.md` files with wide multi-column tables or prose-heavy cells that overflow mobile screens into empty whitespace. Use compact structured bullet lists instead; reserve tables strictly for 2 short-value columns that fit narrow phone screens without scrolling.

---

## 2. Token Efficiency & Context Discipline

- **On-Demand Doc Loading**: Load [`DEV.md`](./DEV.md) plus only the subsystem `.md` matching Section 3—never all `.md` guides upfront.
- **Search Before Sliced Reads**: Run `grep` first, then `view_file` narrow `StartLine`/`EndLine` slices (`<= 150` lines) rather than whole large files.
- **Parallel Batching & Single Test Pass**: Batch independent reads/edits in parallel, then run `npm run lint && npm run build && npm test` once at the end.
- **Subagent Isolation**: Use `research` subagents (`Model: 'inherit'`, `Workspace: 'inherit'`) only for broad multi-file surveys; do 1–3 file lookups directly.
- **Zero-Rebuild Docs Fast-Path**: Pure `.md` PRs skip CI (`paths-ignore`) and do not bump `web/package.json`; validate links and formatting directly.

---

## 3. Task Routing & Core Commands

- **UI & Controls** (`web/src/components/*`, `index.css`): `npm run lint && npm run build && npm test` (+ `gallery:capture` if visual). Sync [`DEV.md`](./DEV.md), [`WEB.md`](./WEB.md), [`CHANGELOG.md`](./CHANGELOG.md), [`TODO.md`](./TODO.md).
- **Puzzle Worker** (`web/src/engine/*`, `puzzle.worker.ts`): `npm run lint && npm run build && npm test`. Sync [`DEV.md`](./DEV.md), [`PUZZLE.md`](./PUZZLE.md), [`CHANGELOG.md`](./CHANGELOG.md), [`TODO.md`](./TODO.md).
- **Cloud & Codec** (`web/src/services/*Cloud*`, `CapyCodec.ts`): `npm run lint && npm run build && npm test`. Sync [`DEV.md`](./DEV.md), [`CLOUD.md`](./CLOUD.md), [`CHANGELOG.md`](./CHANGELOG.md), [`TODO.md`](./TODO.md).
- **Android (`:app`)** (`app/src/main/*`, `NativeBridge.ts`): `npm run lint && npm run build` + `./gradlew app:testDebugUnitTest app:assembleDebug`. Sync [`DEV.md`](./DEV.md), [`APP.md`](./APP.md), [`CHANGELOG.md`](./CHANGELOG.md), [`TODO.md`](./TODO.md).
- **Tests & CI/CD** (`web/scripts/*`, `.github/workflows/*`): `npm run lint && npm run build && npm test`; verify workflow permissions. Sync [`TESTING.md`](./TESTING.md), [`DEV.md`](./DEV.md), [`CHANGELOG.md`](./CHANGELOG.md).
- **Docs & Roadmap** (`*.md`, `docs/*`): Verify relative links, zero emojis, zero ASCII art, mobile-safe lists. Sync [`DEV.md`](./DEV.md), [`TODO.md`](./TODO.md), [`README.md`](./README.md).
- **Web CLI (`cd web`)**: `npm ci` | `npm run lint` | `npm run build` | `npm test` | `npm run preview` | `npm run gallery:capture` | `npm run generate:samples`.
- **Android CLI (root)**: `./gradlew app:buildWeb` | `./gradlew app:testDebugUnitTest` | `./gradlew app:assembleDebug`.

---

## 4. AI Git, Bookmark & PR Readiness Protocol

- **Scope & Linear History**: `git fetch --all --prune` and branch/rebase linearly onto `origin/main` (`feature/*`, `automation/*`, `fix/*`, `docs/*`). Finish active work before switching tasks unless redirected; plan major changes first; keep diffs minimal; never commit secrets.
- **PR Titles, Overview & Bookmarks**: Write high-level action-oriented PR titles (no `feat():` or laundry lists) with labels (`feature`, `fix`, `docs`, `ui`, `testing`, `ci`, `deps`). Put `https://shthed.github.io/capy/pull/<number>/` at top of deployed PRs, then a plain-English overview paragraph explaining what and *why*. Create `PR_<num>.url.json` (`UserFacing: true`) titled `#<num> <PR Title>`.
- **Versioning, Changelog & Links**: Bump `"version"` in [`web/package.json`](./web/package.json) (`MAJOR*10000 + MINOR*100 + PATCH`) and add a flat single-bullet [`CHANGELOG.md`](./CHANGELOG.md) entry ending in a bare `#<num>` PR link under compact `### X.Y - YYYY-MM-DD` (zero preamble, category sub-headings, nested bullets, or file/line links; roll up same-day patches; see [`DEV.md`](./DEV.md#8-versioning-dependency-maintenance--asset-playbooks)). Document new settings; prune dead refs; pin PR/comment line links to SHAs.
- **5-Pillar Rubric (`20` pts each, `>= 95%`)**: (1) Functionality & Edge Cases, (2) Automated Tests, (3) Performance & Invariants, (4) Docs & Changelog Sync, (5) CI & Preview Verification. Post a commit-pinned Development Summary PR comment before merge.
