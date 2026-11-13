# Capy Active Sprint Execution Queue (`TODO.md`)

Focused **Sprint 1 Queue** ([EPIC-2](https://github.com/shthed/capy/issues/477) | [Milestone #2](https://github.com/shthed/capy/milestone/2)). Holds **only** approved, unblocked `1-PR` slices for the active sprint (`--base beta`). Strategic Epics, unapproved features ([EPIC-3](https://github.com/shthed/capy/issues/478)), and shipped archives live in [`ROADMAP.md`](./ROADMAP.md); workflow & GitHub CLI rules live in [`PROJECT.md`](./PROJECT.md#2-lean-agile-lifecycle-and-backlog-governance).

**Related Guides**: [`README.md`](./README.md) | [`PROJECT.md`](./PROJECT.md) | [`ROADMAP.md`](./ROADMAP.md) | [`DEV.md`](./DEV.md) | [`AGENTS.md`](./AGENTS.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`APP.md`](./APP.md) | [`CLOUD.md`](./CLOUD.md) | [`TESTING.md`](./TESTING.md) | [`CHANGELOG.md`](./CHANGELOG.md)

---

## Sprint 1 Priority 0: `v3.0.1` Stabilization, Release Gates & Active PRs (`BUG-4`, `TASK-2.5`, [#489](https://github.com/shthed/capy/pull/489))

Shipped to `main` (`Production`): `BUG-1` & `BUG-3` ([#484](https://github.com/shthed/capy/pull/484), [#485](https://github.com/shthed/capy/pull/485)), `BUG-2` ([#485](https://github.com/shthed/capy/pull/485)), and `BUG-5` mobile `GameTopBar` overlap & `99%` progress cap ([#486](https://github.com/shthed/capy/pull/486), promoted to `main` in [#488](https://github.com/shthed/capy/pull/488)). Shipped to `beta` (`v3.0.2`, awaiting `main` promotion): prebaked sample `1x` viewport reset & 1-click bot PR approval workflow ([#490](https://github.com/shthed/capy/pull/490)) plus `TASK-2.5` backlog sync ([#487](https://github.com/shthed/capy/pull/487)). Delete each remaining item below once shipped to Production / Play Store.

### BUG-4: `capypaint.com` Live DNS & Cloudflare Worker Cutover

- **Status**: `Open -- Human Ops Gate (Awaiting Cloudflare Zone & DNS Cutover)`
- **Action**: Point `capypaint.com` registrar nameservers to Cloudflare, connect the repository to Cloudflare Workers Builds per [`CLOUD.md` Section 4](./CLOUD.md#4-step-by-step-developer-guide-deploying-capypaintcom-on-cloudflare-workers), and add the `www.capypaint.com -> https://capypaint.com` edge `301` Redirect Rule.
- **Value**: Replaces the Squarespace "under construction" placeholder on `capypaint.com` with the live `v3.0.1` production SPA, `/api/health`, and `CoopRoomDurableObject` WebSocket relay.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Bug` | [EPIC-2](https://github.com/shthed/capy/issues/477) ([Milestone #2](https://github.com/shthed/capy/milestone/2)) | `priority: critical` | `domain: cloud, ci`
- **Model & Estimate**: `ops` (Human Cloudflare & Registrar Cutover)
- **Target Files**: [`wrangler.jsonc`](./wrangler.jsonc), [`worker/index.ts`](./worker/index.ts), [`.github/workflows/deploy-cloudflare.yml`](./.github/workflows/deploy-cloudflare.yml), [`CLOUD.md`](./CLOUD.md)
- **Acceptance Criteria**:
  - `https://capypaint.com/` serves the live Capy Paint SPA and `https://www.capypaint.com/` `301`-redirects to `https://capypaint.com/`.
  - `https://capypaint.com/api/health` returns `{"ok":true,"service":"capy-paint",...}` and `wss://capypaint.com/api/room?room=<ROOM6>` upgrades to `CoopRoomDurableObject`.

</details>

### TASK-2.5: Android App Verification & Google Play Store Deployment (`v3.0.1`)

- **Status**: `Open -- Release Ops Gate (Awaiting Keystore Secrets, v3.0.1 Tag & Play Console Upload)`
- **Action**: Configure release signing secrets (`CAPY_KEYSTORE_BASE64`, `CAPY_KEYSTORE_PASSWORD`), verify `./gradlew app:testDebugUnitTest app:assembleRelease app:bundleRelease` (plus `MainActivity` `onPause`/`onResume` lifecycle & hardware back navigation), tag `v3.0.1` on `main` to trigger [`.github/workflows/release.yml`](./.github/workflows/release.yml), and publish `capy-v3.0.1.aab` to Google Play Console.
- **Value**: Ships the unified Android wrapper (`com.capypaint.capy`) to Google Play Store alongside the `v3.0.1` web release.

<details>
<summary>Engineering Metadata, Estimates, Files & Acceptance Criteria</summary>

- **Type & Priority**: `Task` | [EPIC-2](https://github.com/shthed/capy/issues/477) ([Milestone #2](https://github.com/shthed/capy/milestone/2)) | `priority: critical` | `domain: android, ci`
- **Model & Estimate**: `Gemini 4 Argon` + Owner Play Console / Keystore Setup | `~18,000 tokens` (`~10--15 min agent`)
- **Target Files**: [`app/build.gradle.kts`](./app/build.gradle.kts), [`app/src/main/java/com/capypaint/capy/MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt), [`.github/workflows/release.yml`](./.github/workflows/release.yml), [`APP.md`](./APP.md)
- **Acceptance Criteria**:
  - `release.yml` builds a Play-signed `capy-v3.0.1.aab` (`versionName = "3.0.1"`, `versionCode = 30001`) and `capy-v3.0.1.apk` cleanly.
  - `v3.0.1` Android build passes on-device smoke QA (launch, coloring, save/resume, back navigation) and is uploaded to Google Play Console.

</details>
