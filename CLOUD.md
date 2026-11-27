# Modular Cloud Sync, Google Account / Play Games v2 & Multiplayer Sharing (`CLOUD.md`)

This document explains how modular multi-platform cloud login (`Google`, `Google Play Games v2`, `Steam`, `Microsoft`, `Apple`), conflict-free cross-device Save Library sync, shareable progress links, simultaneous Co-op multiplayer rooms, and Cloudflare Workers edge hosting (`capypaint.com`) work across the **Capy** monorepo (`web/`, `app/`, and `worker/`).

**Related Guides**: [`README.md`](./README.md) | [`CONTRIBUTING.md`](./CONTRIBUTING.md) | [`SUPPORT.md`](./SUPPORT.md) | [`SECURITY.md`](./SECURITY.md) | [`ROADMAP.md`](./ROADMAP.md) | [`DEV.md`](./DEV.md) | [`AGENTS.md`](./AGENTS.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`APP.md`](./APP.md) | [`TESTING.md`](./TESTING.md) | [`CHANGELOG.md`](./CHANGELOG.md)

**Table of Contents**:
1. [Plain-English Overview: How Everything Works](#1-plain-english-overview-how-everything-works)
2. [End-to-End Architecture Diagrams](#2-end-to-end-architecture-diagrams)
3. [Step-by-Step Developer Guide: Provisioning Google Cloud OAuth 2.0 & Play Games v2](#3-step-by-step-developer-guide-provisioning-google-cloud-oauth-20--play-games-v2)
4. [Step-by-Step Developer Guide: Deploying capypaint.com & capyboop.com on Cloudflare Workers](#4-step-by-step-developer-guide-deploying-capypaintcom-and-capyboopcom-on-cloudflare-workers)

---

## 1. Plain-English Overview: How Everything Works

### A. Modular Cloud Provider Architecture (`CloudProviderDriver`)
Capy separates **CRDT save merging** (`CrdtCloudSaveAdapter` in [`ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts)) from **platform-specific authentication and cloud storage** via the modular [`CloudProviderDriver`](./web/src/services/providers/types.ts) interface implemented in [`CloudProviderDrivers.ts`](./web/src/services/providers/CloudProviderDrivers.ts):

- **`'google'` (`GoogleCloudDriver`) -- Active on Web, PWA, Desktop, iOS & Android**:
  - *Auth*: Google Identity Services OAuth 2.0 (`https://accounts.google.com/gsi/client` via [`GoogleCloudSyncClient.ts`](./web/src/services/providers/GoogleCloudSyncClient.ts), scopes `openid profile email` + app-isolated `https://www.googleapis.com/auth/drive.appdata`).
  - *Storage*: Google Drive `appDataFolder` REST API v3 (`capy_cloud_manifest_v2.json` + per-puzzle `.capy` v2 binary archives).
- **`'play_games_v2'` (`PlayGamesAndroidDriver`) -- Active on Android (`:app`)**:
  - *Auth*: Native Google Play Games Services v2 SDK (`GamesSignInClient` + `PlayersClient` in [`MainActivity.kt`](./app/src/main/java/com/capyboop/paint/MainActivity.kt)).
  - *Storage*: `PlayGames.getSnapshotsClient(activity)` Saved Games API (`RESOLUTION_POLICY_MANUAL` + `CapyAndroidBridge.decideSnapshotPushAction` CRDT read-before-write conflict protection for JSON slots and `RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED` for immutable `pgblob_*` chunks) paired with local `filesDir/capy_cloud/` caching, `inlineBinaryB64` custom-save embedding, and slot-filtered [`NativeBridge.ts`](./web/src/services/NativeBridge.ts) (`onCloudSnapshot` / `onCloudSnapshotError`) multi-chunk queues.
- **`'microsoft'` (`MicrosoftCloudDriver`) -- Active BYOC Driver (auto-enabled when `VITE_MICROSOFT_CLIENT_ID` is configured)**:
  - *Auth & Storage*: Microsoft Entra ID / MSA OAuth 2.0 PKCE (`Files.ReadWrite.AppFolder` via [`MicrosoftCloudSyncClient.ts`](./web/src/services/providers/MicrosoftCloudSyncClient.ts)) + OneDrive `special/approot` (`AppFolder`).
- **`'apple'` (`AppleCloudDriver`) -- Active BYOC Driver (auto-enabled when `VITE_APPLE_*` env vars are configured)**:
  - *Auth & Storage*: Sign in with Apple JS + CloudKit `privateCloudDatabase` (or native iOS `CapyIOS` bridge via [`AppleCloudSyncClient.ts`](./web/src/services/providers/AppleCloudSyncClient.ts)).
- **`'steam'` (`SteamCloudDriver`) -- Modular Driver Ready (awaiting desktop wrapper)**:
  - *Auth & Storage*: Steamworks Auth Session Ticket (`window.__capySteamBridge`) + `ISteamRemoteStorage` (`fileWriteAsync` / `fileReadAsync`).

### B. How Automatic Google Account & Play Games Login Works
1. **Instant Local Profile (Zero Friction)**:
   - Every player starts immediately with a local profile (for example, `Sunny Capy` with a chosen avatar color) stored in `localStorage` under `capy_player_identity_v1`. No account is required to play, save, or share links.
2. **Opt-In Google Account Login & Silent Sync on Web / Desktop (`attemptAutoSignIn`)**:
   - On startup (`App.tsx`), `ProviderRegistry.auth.attemptAutoSignIn()` and `NativeBridge.onCloudSnapshot(...)` only run when Cloud/Co-op UI is opted in (`showCloudCoopUi` via `isCloudCoopUiEnabled()` or `?room=`).
   - When enabled, `attemptAutoSignIn()` checks for a valid cached Google OAuth session (`capy_google_oauth_token_v1` in `sessionStorage`, migrating and clearing any legacy `localStorage` token) or invokes Google Identity Services One Tap (`auto_select: true`, `use_fedcm_for_prompt: true`) and silent OAuth token refresh (`prompt: ''`) unless the player explicitly clicked **Sign Out** (`capy_cloud_explicit_signout_v1`).
   - The Web OAuth 2.0 Client ID is baked into the build via `VITE_GOOGLE_CLIENT_ID` (developers testing local sandboxes can optionally override `capy_google_oauth_client_id_v1` via `setGoogleClientId`).
   - On login, [`GoogleCloudDriver`](./web/src/services/providers/CloudProviderDrivers.ts) fetches `/oauth2/v3/userinfo` and runs `ProviderRegistry.cloudSave.syncFullLibrary(snapshots)` against Google Drive `appDataFolder`, validating all file IDs via `isValidGoogleDriveFileId` (`assertValidFileId`) to block traversal characters.
3. **Demand-Driven Google Play Games Services v2 Login & Saved Games (`SnapshotsClient`) on Android**:
   - On Android (`app/`), [`AndroidManifest.xml`](./app/src/main/AndroidManifest.xml) sets `SUPPRESS_GAME_PROFILE_CREATION="true"` and [`MainActivity.kt`](./app/src/main/java/com/capyboop/paint/MainActivity.kt) only calls `PlayGamesSdk.initialize(this)` in `onCreate()` when `CAPY_PLAY_GAMES_APP_ID` is configured—never prompting sign-in or pulling snapshots automatically on cold launch.
   - Explicit `CapyAndroid.signInPlayGames()` calls (when `showCloudCoopUi` is enabled) run `requestPlayGamesSignIn()`; if unconfigured or offline, native sign-in immediately emits `window.__capyReceivePlayGamesError(...)` so `PlayGamesAndroidDriver` fails fast.
   - Once authenticated, `MainActivity.kt` caches `{ displayName, playerId }` in `capy_play_games_prefs`, pushes the profile to `window.__capyReceivePlayGamesProfile(...)`, and reconciles `capy_cloud_manifest_v2` via `SnapshotsClient` (`RESOLUTION_POLICY_MANUAL`, `decideSnapshotPushAction`).

### C. Four Complementary Ways Data Is Shared Between Players

1. **Shareable Progress Link (`#s=<token>`)**:
   - *Transport*: Compresses painted region IDs, Free Color overrides, `isFreeColor`, `updatedAt`, and `sourceRef` directly into the URL fragment (`https://capypaint.com/#s=...` via `CANONICAL_PRODUCTION_URL` in [`ShareLinkService.ts`](./web/src/services/ShareLinkService.ts)).
   - *Size & Infrastructure*: `~100--400 bytes` (`< 2 KB` budget); **zero server required**; works across separate devices immediately for built-in Gallery artworks.
2. **Local / Same-Browser Co-op Room (`?room=<ROOM6>`)**:
   - *Transport*: Uses native `BroadcastChannel` (`capy_coop_room_<channel>_<ROOM6>` via `resolveCoopBroadcastChannelName` so `/capy/`, `/capy/beta/`, and `/capy/alpha/<num>/` never collide on shared origins) to stream real-time `HELLO`, `WELCOME_STATE`, `PAINT_EVENT`, `UNFILL_EVENT`, `HEARTBEAT`, and `LEAVE` frames (`~120 bytes` per tap/undo) between tabs/windows on the same device with **zero server required**.
3. **Internet Cross-Device Co-op Room (`?room=<ROOM6>`)**:
   - *Client*: Uses [`HybridCoopRoomClient.ts`](./web/src/services/coop/HybridCoopRoomClient.ts) (aliased as `HybridCoopRoomAdapter` and re-exported by [`ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts)) over WebSocket (`resolveCoopRoomWsUrl`).
   - *Hardening*: Uses a `hasOwnProperty`-guarded wire dispatch map, strict field whitelisting on `PAINT_EVENT`/`UNFILL_EVENT`/`CoopParticipant` (zero object spread), a `24`-peer cap with oldest-non-self eviction, and `10`-minute WS peer pruning (`WS_PEER_STALE_MS`, alongside `18s` BroadcastChannel pruning).
   - *Relay*: Streams `HELLO`, `WELCOME_STATE`, `PAINT_EVENT`, `UNFILL_EVENT`, and `LEAVE` frames (`~120 bytes` per tap/undo, `<= 6 KB` enforced by [`worker/coopRoomProtocol.ts`](./worker/coopRoomProtocol.ts)) through [`CoopRoomDurableObject`](./worker/index.ts), auto-connecting to `wss://capypaint.com/api/room` on `capypaint.com`, `*.capypaint.com`, and Android `appassets.androidplatform.net` (or `VITE_CAPY_ROOM_WS_URL`), hibernating at `0` idle CPU ms via `WebSocketRequestResponsePair('PING', 'PONG')` and falling back to `BroadcastChannel` on `localhost` or `github.io`.
4. **Portable `.capy` v2 Binary File Export**:
   - *Transport*: Exports a self-contained `CAPY\x02<flags>` binary archive (`0x01` `FLAG_GZIP` single save, `0x03` `FLAG_GZIP | FLAG_ARCHIVE` multi-save library bundle, `0x00` uncompressed) containing the source image, quantized RLE segmentation map, custom palette, and undo/replay chronology via OS Share Sheet or file download.
   - *Size & Infrastructure*: `~15--45 KB` for built-in/line-art saves and `~45--95 KB` for custom photographic saves; **zero server required**; works offline across all devices.

### D. How Full-Library Cloud Sync Merges Progress Without Losing Work (CRDT)
Traditional cloud saves overwrite File A with File B if you play on two devices offline. Capy instead syncs a unified `CloudLibraryManifestV2` (`capy_cloud_manifest_v2.json`, mirrored locally in `capy_cloud_library_manifest_v2` via [`CloudLibrarySyncOrchestrator.ts`](./web/src/services/cloud/CloudLibrarySyncOrchestrator.ts)) and merges each puzzle's progress as a **Conflict-Free Replicated Data Type (CRDT)** (`mergeProgressDeltas` in [`CapyCodec.ts`](./web/src/services/CapyCodec.ts)):
- **Full Save Library Sync (`syncFullLibrary`)**:
  - Built-in sample saves store compact `ProgressDeltaV2` tokens (`< 2 KB`) directly inside `capy_cloud_manifest_v2.json`.
  - Custom uploaded photo saves export `.capy` v2 binaries (`StorageService.exportSnapshotBinary(id)`):
    - Multi-file blob drivers (`GoogleCloudDriver`, `MicrosoftCloudDriver`, `AppleCloudDriver`) upload `capy_save_<snapshotId>.capy` and store its `cloudBinaryRef` in the manifest.
    - `PlayGamesAndroidDriver` (`SnapshotsClient`) embeds small saves (`<= 180 KB`) inline via `inlineBinaryB64` and splits larger saves (`> 180 KB`, up to `3 MB` across `32` chunks of `180 KB`) into atomic `pgblob_<slot>_part_<i>` slots (`pgblob:<blobKey>:<totalChunks>:<totalBytes>`, `PLAY_GAMES_CHUNK_PULL_TIMEOUT_MS = 10_000`), using slot-filtered `NativeBridge` listeners, symmetric `..` dot-segment rejection, exact byte-length validation on restore, and trailing-chunk cleanup on overwrite.
  - Puzzles started on Device A are imported automatically into `StorageService` on Device B during `syncFullLibrary`.
  - **Per-Slot Deletion Tombstones & Cross-Account Isolation**: `SnapshotStorage.deleteSnapshot(id)` records a per-slot deletion timestamp (`capy_cloud_tombstones_v1`, synced in `CloudLibraryManifestV2.tombstones`) via [`slotKey.ts`](./web/src/services/cloud/slotKey.ts) so deleted saves never resurrect while newer recreates (`lastOpened > deletedAt`) clear the tombstone. `AuthManager.signOut()` ([`AuthManager.ts`](./web/src/services/auth/AuthManager.ts)) clears local cloud caches (`capy_cloud_vault_v1`, `capy_cloud_library_manifest_v2`, `capy_cloud_tombstones_v1`) across account switches.
- **Epoch-Scoped Grow-Only Set Union (`filledRegionIds` + `resetEpoch`)**:
  - Within the same `resetEpoch`, painting regions `[1, 2, 3]` on your phone and `[3, 4, 5]` on your laptop merges cleanly into `[1, 2, 3, 4, 5]`—neither device's work is ever lost. Both `pullRemoteLibraryManifest()` and `syncFullLibrary()` merge via `mergeProgressDeltas()`, and `hasPendingLocalChanges` compares full snapshot + tombstone content fingerprints pre-push vs. post-push.
  - Clicking **Reset Progress** increments monotonic `resetEpoch` (`ProgressDeltaV2` flag bit `8`, `SavedSnapshot.resetEpoch`, `CloudSaveEnvelope.resetEpoch`, and `CloudSaveEntryV2.resetEpoch`). Whenever two deltas carry different `resetEpoch` values, `mergeProgressDeltas` deterministically selects the higher epoch so stale pre-reset cloud saves or Co-op peers never resurrect cleared regions.
- **Custom Free-Color Overrides (`paintedRegionColors`) use Last-Writer-Wins (LWW)**:
  - Concurrent custom-color edits on the same region within the active `resetEpoch` resolve deterministically in favor of the newer `updatedAt` timestamp.
- **Per-File Write Serialization, `404` Recovery & `401` Session Invalidation**:
  - `GoogleCloudDriver`, `MicrosoftCloudDriver`, and `AppleCloudDriver` share `KeyedWriteQueue` to serialize concurrent writes per filename.
  - `GoogleCloudDriver` caches file IDs (`cachedManifestFileId`, `cachedSlotFileIds`, `cachedBlobFileIds`) and invalidates + retries once on Google Drive HTTP `404`.
  - On HTTP `401`, [`GoogleCloudSyncClient.ts`](./web/src/services/providers/GoogleCloudSyncClient.ts) fires `onGoogleSessionInvalidated` so `AuthManager` downgrades stale Google sessions to guest immediately. One Tap ID tokens require a 3-part JWT with valid `iss`, non-expired `exp`, matching `aud`, and a non-empty OAuth2 `accessToken`.

---

## 2. End-to-End Architecture Diagrams

### A. Modular Cloud Provider Driver & Cross-Device Save Library Sync

```mermaid
sequenceDiagram
    participant User as Player (Device 1 or 2)
    participant UI as App.tsx / SettingsModal.tsx
    participant Auth as MultiProviderAuthManager
    participant Sync as CrdtCloudSaveAdapter
    participant Driver as CloudProviderDriver (Google / Play Games / Steam / MS / Apple)
    participant Cloud as Remote Cloud Storage (Google Drive appDataFolder / SnapshotsClient)

    UI->>Auth: attemptAutoSignIn() on startup (or click "Google Login")
    Auth->>Driver: GoogleCloudDriver.attemptAutoSignIn() / signIn()
    Driver->>Cloud: Google One Tap + OAuth 2.0 (openid profile email drive.appdata)
    Cloud-->>Driver: access_token + /oauth2/v3/userinfo (sub, name, email, picture)
    Driver-->>Auth: PlayerIdentity(isAuthenticated = true, displayName, email, avatarUrl)
    UI->>Sync: syncFullLibrary(StorageService.loadSnapshots())
    Sync->>Driver: readManifest() ("capy_cloud_manifest_v2.json")
    Driver->>Cloud: GET /drive/v3/files?spaces=appDataFolder
    Cloud-->>Driver: Remote CloudLibraryManifestV2
    Sync->>Sync: Import missing saves & CRDT Set-Union merge (mergeProgressDeltas)
    Sync->>Driver: writeBinaryBlob() / inlineBinaryB64 for custom photo .capy saves
    Sync->>Driver: writeManifest(mergedManifest)
    Driver->>Cloud: POST/PATCH /upload/drive/v3/files (spaces=appDataFolder)
    Sync-->>UI: CloudLibrarySyncSummary (mergedRegions, importedSaves, totalSavesSynced)
```

### B. Player-to-Player Progress Sharing & Simultaneous Co-op Flow

```mermaid
flowchart TD
    subgraph PlayerA["Player A (Host / Sender)"]
        A_Canvas["PuzzleCanvas.tsx (Paints Region)"]
        A_Codec["CapyCodec.ts (encodeProgressDeltaToken)"]
        A_Share["ShareLinkService.ts (#s=<token>)"]
        A_Room["HybridCoopRoomAdapter (Room Code)"]
    end

    subgraph Transport["Data Sharing Channels"]
        T_URL["URL Hash Link (#s=<token>)\nCopied or shared via SMS / Chat / App Link"]
        T_BC["BroadcastChannel\n(Same-Browser Multi-Tab Co-op)"]
        T_WS["WebSocket Relay (wss://capypaint.com/api/room)\n(Hibernating CoopRoomDurableObject)"]
    end

    subgraph PlayerB["Player B (Recipient / Collaborator)"]
        B_Parse["ShareLinkService.parseShareLinkFromUrl()"]
        B_Merge["CapyCodec.mergeProgressDeltas (CRDT Union)"]
        B_Ripples["CoopRippleBuffer.ts (Zero-Alloc Avatar Ripples)"]
        B_Canvas["PuzzleCanvas.tsx (Live Repaint)"]
    end

    A_Canvas --> A_Codec
    A_Codec --> A_Share
    A_Share --> T_URL
    T_URL --> B_Parse
    B_Parse --> B_Merge

    A_Canvas --> A_Room
    A_Room --> T_BC
    A_Room --> T_WS
    T_BC --> B_Merge
    T_WS --> B_Merge
    T_BC --> B_Ripples
    T_WS --> B_Ripples
    B_Merge --> B_Canvas
    B_Ripples --> B_Canvas
```

---

## 3. Step-by-Step Developer Guide: Provisioning Google Cloud OAuth 2.0 & Play Games v2

### Part A: Web / Cross-Device Google Login & Google Drive `appDataFolder` Sync (`VITE_GOOGLE_CLIENT_ID`)
1. **Create or select a project in Google Cloud Console**:
   - Open `https://console.cloud.google.com/` and create or select your project (for example, `Capy Paint`).
2. **Enable the Google Drive API**:
   - Navigate to **APIs & Services -> Library**, search for **Google Drive API**, and click **Enable**.
3. **Configure the Google Auth Platform / OAuth Consent Screen**:
   - Navigate to **APIs & Services -> OAuth consent screen** (or **Google Auth Platform -> Branding / Audience / Data Access**).
   - Set **User Type** to **External** and set the Privacy Policy URL to `https://capypaint.com/privacy-policy.html`.
   - Under **Data Access / Scopes**, add:
     - `openid`
     - `.../auth/userinfo.profile`
     - `.../auth/userinfo.email`
     - `https://www.googleapis.com/auth/drive.appdata` (*View and manage its own configuration data in your Google Drive* -- non-sensitive app-isolated scope).
   - Add test accounts under **Audience -> Test users** while in Testing mode, or click **Publish App** for public Google sign-in.
4. **Create the Web OAuth 2.0 Client ID**:
   - Navigate to **APIs & Services -> Credentials -> + Create Credentials -> OAuth client ID** (`Web application`).
   - Add **Authorized JavaScript origins**: `https://capypaint.com`, `https://www.capypaint.com`, `https://paint.capyboop.com`, `https://shthed.github.io`, `http://localhost:3000`, and `http://localhost:4173`.
   - For Android cross-device Google Drive PKCE sync (`capypaint://oauth/callback`), register an Android/PKCE redirect URI matching `capypaint://oauth/callback`.
   - Copy the generated Client ID (`1234567890-xxxxxxxx.apps.googleusercontent.com`).
5. **Save `VITE_GOOGLE_CLIENT_ID` in GitHub Repository Variables**:
   - Open `https://github.com/shthed/capy/settings/variables/actions` (**Settings -> Secrets and variables -> Actions -> Variables**) and create `VITE_GOOGLE_CLIENT_ID` (or set it in `web/.env.local` for local dev).

### Part B: Android Google Play Games Services v2 (`CAPY_PLAY_GAMES_APP_ID`)
1. **Enable Play Games Services & Saved Games in Google Play Console**:
   - Open `https://play.google.com/console/`, select `com.capyboop.paint`, and open **Grow users -> Play Games Services -> Setup and management -> Configuration**.
   - Link your Google Cloud Project from Part A, turn **Saved Games** (`SnapshotsClient`) **ON**, and copy your **12-digit Play Games Project ID (App ID)**.
2. **Register Android Signing Certificate SHA-1 Fingerprints**:
   - Under **Credentials -> Add credential** (`Android`, `com.capyboop.paint`), register the SHA-1 fingerprint for both your debug/upload keystore and your Play App Signing certificate.
3. **Save `CAPY_PLAY_GAMES_APP_ID` in GitHub Repository Variables**:
   - Add `CAPY_PLAY_GAMES_APP_ID` (`<your-12-digit-play-games-app-id>`) in `https://github.com/shthed/capy/settings/variables/actions`. [`deploy-branch.yml`](./.github/workflows/deploy-branch.yml), [`release.yml`](./.github/workflows/release.yml), and [`deploy-cloudflare.yml`](./.github/workflows/deploy-cloudflare.yml) automatically inject `${{ vars.VITE_GOOGLE_CLIENT_ID }}`, `${{ vars.VITE_MICROSOFT_CLIENT_ID }}`, `${{ vars.VITE_APPLE_CLIENT_ID }}`, `${{ vars.VITE_APPLE_CLOUDKIT_CONTAINER }}`, `${{ vars.VITE_APPLE_CLOUDKIT_API_TOKEN }}`, `${{ vars.CAPY_PLAY_GAMES_APP_ID }}`, and `${{ vars.CAPY_ANDROID_SHA256_CERT_FINGERPRINTS }}` into Web and Android builds (auto-hiding unconfigured provider login buttons cleanly in `CloudAccountCard.tsx`).
4. **Android App Links (`CAPY_ANDROID_SHA256_CERT_FINGERPRINTS`) on `capypaint.com` & `paint.capyboop.com`**:
   - Cloudflare Workers Static Assets serves `dist/.well-known/assetlinks.json` at both [capypaint.com/.well-known/assetlinks.json](https://capypaint.com/.well-known/assetlinks.json) and [paint.capyboop.com/.well-known/assetlinks.json](https://paint.capyboop.com/.well-known/assetlinks.json) (`web/public/.well-known/assetlinks.json` defaults to `"sha256_cert_fingerprints": []`). Add `CAPY_ANDROID_SHA256_CERT_FINGERPRINTS` (your Google Play App Signing SHA-256 certificate fingerprint) in GitHub Repository Variables so [`web/vite.config.ts`](./web/vite.config.ts) stamps `assetlinks.json` and [`app/build.gradle.kts`](./app/build.gradle.kts) (`CapyAndroidBridge.isAppLinksCertConfigured`) enables `android:autoVerify="true"` automatically on the dedicated direct-200 App Links filter (`capypaint.com` + `paint.capyboop.com`, isolated from redirecting `www.capypaint.com` and GitHub Pages fallback hosts).

### Part C: Microsoft OneDrive `AppFolder` BYOC Sync (`VITE_MICROSOFT_CLIENT_ID`, `$0` Backend Cost)
1. **Create an App Registration in Microsoft Entra ID (Azure Portal, Free)**:
   - Open `https://portal.azure.com/` -> **Microsoft Entra ID -> App registrations -> New registration**.
   - Set **Supported account types** to **Personal Microsoft accounts only** (or **Accounts in any organizational directory and personal Microsoft accounts**).
2. **Configure SPA Redirect URIs (Zero Client Secret / PKCE `S256`)**:
   - Under **Authentication -> Add a platform -> Single-page application (SPA)**, add:
     - `https://capypaint.com/`
     - `https://paint.capyboop.com/`
     - `https://shthed.github.io/capy/`
     - `http://localhost:3000/`
   - Under **Mobile and desktop applications**, add `capypaint://oauth/callback` for Android external-browser PKCE sync.
3. **Grant Delegated Microsoft Graph Permissions**:
   - Under **API permissions -> Microsoft Graph -> Delegated permissions**, add `openid`, `profile`, `email`, `User.Read`, and `Files.ReadWrite.AppFolder`.
4. **Save `VITE_MICROSOFT_CLIENT_ID` in GitHub Repository Variables**:
   - Copy the **Application (client) ID** and save it as `VITE_MICROSOFT_CLIENT_ID` in `https://github.com/shthed/capy/settings/variables/actions`.

### Part D: Apple Sign-In + CloudKit `privateCloudDatabase` BYOC Sync (`VITE_APPLE_*`, `$0` Backend Cost)
1. **Register a Services ID in Apple Developer Console**:
   - Open `https://developer.apple.com/account/resources/identifiers/list/serviceId` and create a **Services ID** with **Sign in with Apple** enabled.
   - Add Domains: `capypaint.com` and `paint.capyboop.com`; add Return URLs: `https://capypaint.com/` and `https://paint.capyboop.com/`.
2. **Configure CloudKit Container & JS API Token**:
   - Open `https://icloud.developer.apple.com/dashboard/`, create a container (for example, `iCloud.com.capyboop.paint`), define record type `CapyCloudSaveRecord` (`payload` String, `updatedAt` Int64) in the **Private Database**, and generate a **CloudKit JS API Token**.
3. **Save `VITE_APPLE_*` in GitHub Repository Variables**:
   - Add `VITE_APPLE_CLIENT_ID`, `VITE_APPLE_CLOUDKIT_CONTAINER`, and `VITE_APPLE_CLOUDKIT_API_TOKEN` in `https://github.com/shthed/capy/settings/variables/actions`.

### Part E: Automatic Background Cross-Device Sync (`createAutoCloudSyncScheduler`)
- Capy Paint remains **100% serverless Bring-Your-Own-Cloud (BYOC)** with **zero** central Cloudflare Durable Object / D1 / KV save database so it scales to millions of players at `$0` backend cost.
- [`createAutoCloudSyncScheduler`](./web/src/services/cloudSyncCoordinator.ts) wired in [`App.tsx`](./web/src/App.tsx) automatically pushes local paint/save mutations after a `15s` debounce, pulls + merges on `visibilitychange -> visible` when stale (`> 30s`), and syncs immediately on `window` `online` reconnect—all funneled through `createCoalescedSyncController` and strictly no-op when unauthenticated or offline.
- Accountless fallback (`< 2 KB` `#s=` progress links and `.capy` v2 binary export/import) remains always available without signing in.

---

## 4. Step-by-Step Developer Guide: Deploying capypaint.com and capyboop.com on Cloudflare Workers

### Architecture Overview ([`wrangler.jsonc`](./wrangler.jsonc), [`package.json`](./package.json) & [`worker/index.ts`](./worker/index.ts))
- **Edge Static Assets, Rate Limiting & API Security Headers**:
  - `wrangler.jsonc` (`workers_dev: false`, `preview_urls: false`) attaches custom domains `capypaint.com`, `www.capypaint.com`, and `paint.capyboop.com` and serves `./web/dist` (`not_found_handling: "single-page-application"`, `run_worker_first: ["/api/*"]`).
  - [`web/public/_headers`](./web/public/_headers) applies immutable caching (`Cache-Control: public, max-age=31536000, immutable`) on hashed `/assets/*` bundles with `! Cache-Control` revalidation overrides on unhashed sample, preview, and icon assets, plus explicit `Content-Type` and `max-age=3600` headers for [`web/public/robots.txt`](./web/public/robots.txt) and [`web/public/sitemap.xml`](./web/public/sitemap.xml).
  - Search indexing metadata in [`web/index.html`](./web/index.html) and [`web/public/privacy-policy.html`](./web/public/privacy-policy.html) declares canonical `https://capypaint.com/` URLs, plain-English descriptions, Open Graph / Twitter preview cards (`assets/og-image.jpg`), `schema.org` JSON-LD (`Organization`, `WebSite`, `VideoGame`/`WebApplication`), and `<noscript>` fallback copy, while [`web/public/404.html`](./web/public/404.html) and PR preview index pages carry `noindex` directives.
  - Rate limits bind `API_RATE_LIMITER` (`60` requests / `60s` per client IP via `checkApiRateLimit`, returning `429` with `Retry-After: 60`) and `FEEDBACK_RATE_LIMITER` (`5` requests / `60s` for `/api/feedback`).
  - Non-`101` `/api/*` responses are wrapped via `withApiSecurityHeaders` / `mergeApiSecurityHeaders` (`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, HSTS).
  - Worker `observability` is enabled in `wrangler.jsonc` with `0.1` log head-sampling and `0.05` trace head-sampling.
- **SPA Fallback vs. [`web/public/_redirects`](./web/public/_redirects)**:
  - [`web/public/_redirects`](./web/public/_redirects) handles only the `/capy.apk` `302` release redirect.
  - [`wrangler.jsonc`](./wrangler.jsonc) `not_found_handling: "single-page-application"` handles SPA fallback (`/* /index.html 200` is intentionally omitted from `_redirects` to avoid Cloudflare Static Assets infinite-loop warnings).
- **SQLite-Backed WebSocket Hibernation (`CoopRoomDurableObject`)**:
  - *Pre-DO Gate*: `/api/room?room=<ROOM6>` validates `GET`, `Upgrade: websocket`, canonical `4-8`-char `room` codes (zero truncation), and `Origin` allowlists (`capypaint.com`, `*.capypaint.com`, `paint.capyboop.com`, `capyboop.github.io`, <!-- capy-dev-only:start -->`shthed.github.io`, <!-- capy-dev-only:end -->`appassets.androidplatform.net`, optional `ALLOWED_EXTRA_ORIGINS`, plus `localhost`/`127.0.0.1`/`[::1]` only when `ALLOW_LOCALHOST_ORIGINS === 'true'`).
  - *Hibernation & SQLite Storage*: Upgrades to a per-room Durable Object using `new_sqlite_classes` (supported on both **Free and Paid** plans). Sockets hibernate at `0` idle CPU ms via C++ `WebSocketRequestResponsePair('PING', 'PONG')`, defer SQLite schema/writes and the `24h` `ROOM_STATE_TTL_MS` alarm until a valid `HELLO`, persist debounced `WELCOME_STATE` `'pending_seed'` checkpoints (`5s`), and purge expired rows on both `alarm()` and hibernation wake.
  - *Handshake & Abuse Hardening*: Enforces a `10s` unjoined handshake timeout (`UNJOINED_HANDSHAKE_TIMEOUT_MS`), a per-IP unjoined socket cap (`MAX_UNJOINED_SOCKETS_PER_IP = 4`), exclusion of unjoined peers (`!peerAttachment?.joinedAt`) from broadcasts, declarative `COOP_FRAME_VALIDATORS` checks in [`worker/coopRoomProtocol.ts`](./worker/coopRoomProtocol.ts), `<= 6 KB` UTF-8 frames, `<= 4096`-char Base64URL+header `seedToken` validation, and `40 frames / 5s` sliding-window rate limits.
  - *Host Authority & Disconnects*: Rejects spoofed `RESERVED_RELAY_PLAYER_ID` senders and duplicate active `boundPlayerId` sockets (`resolveBoundSocketSender`), issues a private server-generated `hostToken` (`HOST_GRANTED`, never relayed) for `isSeedAuthority` seed-locking (`evaluateRoomSeedAction`), transfers host authority to the earliest joined peer on host disconnect (or clears the lock when empty), and broadcasts `LEAVE` to joined peers.
- **Anonymous In-Game Feedback Relay (`POST` / `OPTIONS /api/feedback`, [`worker/feedbackProtocol.ts`](./worker/feedbackProtocol.ts))**:
  - Enforces `isAllowedRelayOrigin` CORS allowlisting, `FEEDBACK_RATE_LIMITER` (`5` requests / `60s`), `application/json` content type (`415`), `<= 8192`-byte UTF-8 body cap (`413`), hidden `website` honeypot (`202` silent accept), control-char / triple-backtick / `@mention` neutralization, and category-to-label mapping (`bug` -> `['bug']`, `feature` / `puzzle_idea` -> `['enhancement']`, `general` -> `['question']`).
  - Creates anonymous issues in `capyboop/paint` (overrideable via `CAPYBOOP_FEEDBACK_REPO`) using Worker secret `CAPYBOOP_FEEDBACK_TOKEN` (fine-grained GitHub PAT with **Issues: Read and write** and **Metadata: Read-only**; provision via `npx wrangler secret put CAPYBOOP_FEEDBACK_TOKEN`).
  - Returns structured `503` (`feedback_unconfigured`) or `502` (`upstream_error`) JSON with a prefilled `fallbackUrl` (`https://github.com/capyboop/paint/issues/new?...`) when unconfigured or unreachable so players never lose typed feedback.
- **Canonical Domain Redirect, `/capy.apk` Download & Health Check**:
  - [`web/index.html`](./web/index.html) runs a synchronous pre-React redirect from [www.capypaint.com](https://www.capypaint.com/) to [capypaint.com](https://capypaint.com/) preserving path, query, and `#s=` hash fragments; [`worker/index.ts`](./worker/index.ts) `301`-redirects `/api/*` requests on `www.capypaint.com`; [`web/public/_redirects`](./web/public/_redirects) `302`-redirects `/capy.apk` to `releases/latest/download/capy.apk`.
  - Edge `Always Use HTTPS` and `www.capypaint.com -> capypaint.com` (`301`, preserve query string) Single Redirect rules are synced automatically by [`deploy-cloudflare.yml`](./.github/workflows/deploy-cloudflare.yml) (or configurable once in **Cloudflare Dashboard -> Rules -> Redirect Rules**).
  - `GET` and `HEAD /api/health` ([capypaint.com/api/health](https://capypaint.com/api/health) and [paint.capyboop.com/api/health](https://paint.capyboop.com/api/health)) return service health status (`{"ok":true,"service":"capy-paint","domain":"<request-hostname>",...}`) echoing `url.hostname`.

### Do I Really Need `CLOUDFLARE_API_TOKEN`?
- **No — for Option 1 (Cloudflare Workers Builds Git Integration)**: Cloudflare connects to GitHub via its official OAuth GitHub App and builds/deploys automatically on push with **zero** GitHub repository secrets.
- **Yes — only for Option 2 (GitHub Actions [`.github/workflows/deploy-cloudflare.yml`](./.github/workflows/deploy-cloudflare.yml)) or non-interactive CLI deploys**: Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in repository Actions Secrets.
- **Never Enable Both Auto-Deploy Paths Simultaneously**: Pick **either** Option 1 (Workers Builds) **or** Option 2 (GitHub Actions) so pushes to `main` never trigger duplicate racing deployments.

### Connecting to Cloudflare Workers ([capypaint.com](https://capypaint.com/) & [paint.capyboop.com](https://paint.capyboop.com/))
Choose either native Cloudflare Git builds (Option 1, zero GitHub secrets) or GitHub Actions deployment (Option 2):

- **Option 1 -- Cloudflare Workers Builds Git Integration (Recommended, Zero Token)**:
  1. Add [capypaint.com](https://capypaint.com/) (and [capyboop.com](https://capyboop.com/) for `paint.capyboop.com`) as zones in [Cloudflare Dashboard](https://dash.cloudflare.com/) and remove any conflicting pre-existing `A`/`AAAA`/`CNAME` records on the Worker hostnames so `custom_domain: true` can attach cleanly.
  2. Open **Compute (Workers) -> Workers & Pages -> Create application -> Import a repository**, select [shthed/capy](https://github.com/shthed/capy) (branch `main`), and keep Project Name `capy-paint`.
  3. Root [`package.json`](./package.json) provides `"build": "npm --prefix web ci && npm --prefix web run build"` and `"deploy": "wrangler deploy"` (`wrangler@^4.160.1`), so `npm run build` + `npx wrangler deploy` works out of the box from `/`.
  4. Click **Save and Deploy** to provision custom domains with managed SSL and run the `v1` SQLite Durable Object migration.
- **Option 2 -- GitHub Actions Workflow ([`.github/workflows/deploy-cloudflare.yml`](./.github/workflows/deploy-cloudflare.yml))**:
  1. In [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens), create a least-privilege token with:
     - **Account Permissions**: `Workers Scripts: Edit` and `Account Settings: Read`.
     - **Zone Permissions** (scoped strictly to your target zones): `Zone: Read`, `Workers Routes: Edit`, `DNS: Edit`, plus `SSL and Certificates: Edit` and `Dynamic Redirects: Edit` for initial certificate attachment and edge HTTPS/`301` redirect sync.
  2. Copy `CLOUDFLARE_ACCOUNT_ID` from [Cloudflare Dashboard](https://dash.cloudflare.com/) or `npx wrangler whoami`.
  3. Save `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in [shthed/capy Actions Secrets](https://github.com/shthed/capy/settings/secrets/actions) (and optional BYOC/App Links variables under **Variables**).
  4. Every non-docs push to `main` (or manual `workflow_dispatch`) runs `npm run test:sanity`, `npm run lint`, `npm run build`, and `npm run test:unit`, deploys via `cloudflare/wrangler-action@v4`, syncs HTTPS/`301` edge rules, and verifies [capypaint.com/api/health](https://capypaint.com/api/health) and [paint.capyboop.com/api/health](https://paint.capyboop.com/api/health). Repositories without Cloudflare secrets skip cleanly in `< 2s`.
  5. *Initial DNS Cutover Note*: If a first-time custom-domain attach fails with Cloudflare error `100117` ("Hostname already has externally managed DNS records"), run `gh workflow run deploy-cloudflare.yml -R shthed/capy --ref main -f replace_dns=true` once to clear conflicting non-Worker `A`/`AAAA`/`CNAME` records (never touching `MX`/`TXT` records) before `wrangler deploy`. Normal push deploys never modify DNS.

### Companion Studio Domain ([capyboop.com](https://capyboop.com/)) -- Future
- **Target Architecture**: [capypaint.com](https://capypaint.com/) and [paint.capyboop.com](https://paint.capyboop.com/) host **Capy Paint** (`capy-paint` Worker + `CoopRoomDurableObject`), while apex [capyboop.com](https://capyboop.com/) is reserved for **CapyGame** ([shthed/capygame](https://github.com/shthed/capygame) / [CapyGame GitHub Pages](https://shthed.github.io/capygame/)) using Cloudflare Workers Static Assets + `public/_headers` (`COOP`/`COEP` headers for `SharedArrayBuffer`) when activated.
<!-- capy-dev-only:start -->

### Automated Clean-Room Public Mirror & Public Issue/PR Repo (`shthed/capy` <-> `capyboop/paint`)
- Every merge to `shthed/capy` `main` triggers [`.github/workflows/publish-capyboop.yml`](./.github/workflows/publish-capyboop.yml), which invokes [`web/scripts/rebrand-persona.mjs`](./web/scripts/rebrand-persona.mjs) (`--stage-dir /tmp/capyboop-stage`) to export a clean-room copy of the codebase (including `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`, `CONTRIBUTING.md`, `SUPPORT.md`, and `SECURITY.md`) with all `shthed` references rewritten to `capyboop`, all dev-only docs (`AGENTS.md`, `CAPYBOOP.md`) and mirror/review workflows stripped, and a hard byte-level zero-leak check enforced before pushing a linear commit authored solely by `capyboop <354866242+capyboop@users.noreply.github.com>` and syncing the matching `v<version>` release tag to [capyboop/paint](https://github.com/capyboop/paint).
- **Public Issue Tracker, Two-Way PR Sync & Single-Origin Rule**:
  1. [capyboop/paint](https://github.com/capyboop/paint) is the canonical public-facing production repository accepting external issues ([capyboop/paint/issues](https://github.com/capyboop/paint/issues), linked from [capypaint.com](https://capypaint.com/) `Settings -> About`, [`privacy-policy.html`](./web/public/privacy-policy.html), and [`README.md`](./README.md)) and community Pull Requests. Preserve existing open public issues (`#2`--`#5`+) by keeping the repo intact (submit a **GitHub Support -> Detach Fork** ticket rather than deleting the repo whenever clearing the `forked from` label).
  2. **Two-Way PR Sync**: Because `publish-capyboop.yml` builds `capyboop/paint` `main`'s tree from `shthed/capy` `main` via `git commit-tree`, any external PR merged on `capyboop/paint` must be fetched and back-ported into `shthed/capy` (`beta -> main`) before the next `shthed/capy` `main` push so public contributions are never overwritten.
  3. Signed in as `capyboop`, create a Fine-Grained Personal Access Token scoped strictly to [capyboop/paint](https://github.com/capyboop/paint) with **Contents: Read and write** and **Workflows: Read and write**, then save it in [shthed/capy Actions Secrets](https://github.com/shthed/capy/settings/secrets/actions) as `CAPYBOOP_SYNC_TOKEN` so `publish-capyboop.yml` clean-room resets `main` automatically without touching Issues.
  4. **Single Deploy Origin (`shthed/capy`)**: Keep [capypaint.com](https://capypaint.com/) deploying strictly from [shthed/capy](https://github.com/shthed/capy) `main` and keep [capyboop/paint](https://github.com/capyboop/paint) disconnected from Cloudflare Workers Builds and without `CLOUDFLARE_API_TOKEN` secrets so both repositories never deploy to [capypaint.com](https://capypaint.com/) simultaneously.
<!-- capy-dev-only:end -->
