# Capy Active Sprint Execution Queue (`TODO.md`)

Focused **Sprint 1 Queue** ([`EPIC-2: v3.0.1 Critical Bugfixes`](https://github.com/shthed/capy/issues/477) | [Milestone #2](https://github.com/shthed/capy/milestone/2)). Holds **only** approved, unblocked `1-PR` slices for the active sprint (`--base beta`). Strategic Epics, unapproved features (`EPIC-3`), and shipped archives live in [`ROADMAP.md`](./ROADMAP.md); workflow & GitHub CLI rules live in [`DEV.md`](./DEV.md#capy-lean-agile-backlog--todomd-entry-standard).

**Related Guides**: [`README.md`](./README.md) | [`ROADMAP.md`](./ROADMAP.md) | [`DEV.md`](./DEV.md) | [`AGENTS.md`](./AGENTS.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`APP.md`](./APP.md) | [`CLOUD.md`](./CLOUD.md) | [`TESTING.md`](./TESTING.md) | [`CHANGELOG.md`](./CHANGELOG.md)

---

## Sprint 1 Priority 0: `v3.0.1` Critical Bugfixes & Release (`BUG-4`, `TASK-2.5`)

Remaining Sprint 1 items (`BUG-1`--`BUG-3` shipped to `main` in `#485`; `GameTopBar` overlap & `99%` progress cap shipped to `beta` in `#486`). Delete each item here once it reaches Production / Play Store.

### BUG-4: `capypaint.com` Live DNS & Cloudflare Worker Cutover

- **Status**: `Open -- Awaiting Human Cloudflare Zone & DNS Cutover`
- **Action**: Point `capypaint.com` registrar nameservers to Cloudflare, connect `shthed/capy` (or `capyboop/capy`) to Cloudflare Workers Builds per [`CLOUD.md` Section 4](./CLOUD.md#4-step-by-step-developer-guide-deploying-capypaintcom-on-cloudflare-workers), and add the `www.capypaint.com -> https://capypaint.com` edge `301` Redirect Rule.
- **Value**: Replaces the Squarespace "under construction" placeholder on `capypaint.com` with the live `v3.0.1` production SPA, `/api/health`, and `CoopRoomDurableObject` WebSocket relay.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Bug` | `v3.0.1` ([Milestone #2](https://github.com/shthed/capy/milestone/2)) | `priority: critical` | `domain: cloud, ci`
- **Model & Estimate**: `ops` (Human Cloudflare & Registrar Cutover)
- **Target Files**: [`wrangler.jsonc`](./wrangler.jsonc), [`worker/index.ts`](./worker/index.ts), [`.github/workflows/deploy-cloudflare.yml`](./.github/workflows/deploy-cloudflare.yml), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - `https://capypaint.com/` serves the live Capy Paint SPA and `https://www.capypaint.com/` `301`-redirects to `https://capypaint.com/`.
  - `https://capypaint.com/api/health` returns `{"ok":true,"service":"capy-paint",...}` and `wss://capypaint.com/api/room?room=<ROOM6>` upgrades to `CoopRoomDurableObject`.

</details>

### TASK-2.5: Android App Verification & Google Play Store Deployment (`v3.0.1`)

- **Status**: `Open -- Part of v3.0.1 Scope`
- **Action**: Configure release signing secrets (`CAPY_KEYSTORE_BASE64`, `CAPY_KEYSTORE_PASSWORD`), verify `./gradlew app:testDebugUnitTest app:assembleRelease app:bundleRelease` (plus `MainActivity` `onPause`/`onResume` lifecycle & hardware back navigation), tag `v3.0.1` on `main` to trigger [`.github/workflows/release.yml`](./.github/workflows/release.yml), and publish `capy-v3.0.1.aab` to Google Play Console.
- **Value**: Ships the unified Android wrapper (`com.capypaint.capy`) to Google Play Store alongside the `v3.0.1` web release.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Task` | `EPIC-2 (v3.0.1)` ([Milestone #2](https://github.com/shthed/capy/milestone/2)) | `priority: critical` | `domain: android, ci`
- **Model & Estimate**: `Gemini 4 Argon` + Owner Play Console / Keystore Setup | `~18,000 tokens` (`~10--15 min agent`)
- **Target Files**: [`app/build.gradle.kts`](./app/build.gradle.kts), [`app/src/main/java/com/capypaint/capy/MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt), [`.github/workflows/release.yml`](./.github/workflows/release.yml), [`APP.md`](./APP.md)
- **Acceptance Criteria**:
  - `release.yml` builds a Play-signed `capy-v3.0.1.aab` (`versionName = "3.0.1"`, `versionCode = 30001`) and `capy-v3.0.1.apk` cleanly.
  - `v3.0.1` Android build passes on-device smoke QA (launch, coloring, save/resume, back navigation) and is uploaded to Google Play Console.

</details>
