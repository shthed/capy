# Modular Cloud Sync, Google Account / Play Games v2 & Multiplayer Sharing (`CLOUD.md`)

This document explains how modular multi-platform cloud login (`Google`, `Google Play Games v2`, `Steam`, `Microsoft`, `Apple`), conflict-free cross-device Save Library sync, shareable progress links, simultaneous Co-op multiplayer rooms, and Cloudflare Workers edge hosting (`capypaint.com`) work across the **Capy** monorepo (`web/`, `app/`, and `worker/`).

**Related Guides**: [`README.md`](./README.md) | [`CONTRIBUTING.md`](./CONTRIBUTING.md) | [`SUPPORT.md`](./SUPPORT.md) | [`SECURITY.md`](./SECURITY.md) | [`ROADMAP.md`](./ROADMAP.md) | [`DEV.md`](./DEV.md) | [`AGENTS.md`](./AGENTS.md) | [`TODO.md`](./TODO.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`APP.md`](./APP.md) | [`TESTING.md`](./TESTING.md) | [`CHANGELOG.md`](./CHANGELOG.md)

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
- **`'steam'` (`SteamCloudDriver`) -- Modular Driver Ready (`ICE-1` in [`ROADMAP.md`](./ROADMAP.md))**:
  - *Auth & Storage*: Steamworks Auth Session Ticket (`window.__capySteamBridge`) + `ISteamRemoteStorage` (`fileWriteAsync` / `fileReadAsync`), awaiting the Tauri desktop wrapper.
- **`'microsoft'` (`MicrosoftCloudDriver`) -- Modular Driver Ready (`ICE-3` in [`ROADMAP.md`](./ROADMAP.md))**:
  - *Auth & Storage*: Microsoft Entra ID / MSA OAuth 2.0 PKCE (`Files.ReadWrite.AppFolder`) + OneDrive `special/approot` / Xbox Connected Storage.
- **`'apple'` (`AppleCloudDriver`) -- Modular Driver Ready (`ICE-2` in [`ROADMAP.md`](./ROADMAP.md))**:
  - *Auth & Storage*: Sign in with Apple JS / Native GameKit (`GKLocalPlayer`) + CloudKit `privateCloudDatabase` / iCloud `GKSavedGame`.

### B. How Automatic Google Account & Play Games Login Works
1. **Instant Local Profile (Zero Friction)**:
   - Every player starts immediately with a local profile (for example, `Sunny Capy` with a chosen avatar color) stored in `localStorage` under `capy_player_identity_v1`. No account is required to play, save, or share links.
2. **Opt-In Google Account Login & Silent Sync on Web / Desktop (`attemptAutoSignIn`)**:
   - On startup (`App.tsx`), `ProviderRegistry.auth.attemptAutoSignIn()` and `NativeBridge.onCloudSnapshot(...)` only run when Cloud/Co-op UI is opted in (`showCloudCoopUi` via `isCloudCoopUiEnabled()` or `?room=`). When enabled, `attemptAutoSignIn()` checks for a valid cached Google OAuth session (`GOOGLE_TOKEN_STORAGE_KEY` `'capy_google_oauth_token_v1'` stored in `sessionStorage` in [`GoogleCloudSyncClient.ts`](./web/src/services/providers/GoogleCloudSyncClient.ts), migrating and clearing any legacy `localStorage` token) or invokes **Google Identity Services One Tap** (`google.accounts.id.initialize({ auto_select: true, cancel_on_tap_outside: false, use_fedcm_for_prompt: true })` + `google.accounts.id.prompt()`) and silent OAuth token refresh (`prompt: ''`) unless the player explicitly clicked **Sign Out** (`capy_cloud_explicit_signout_v1`).
   - Players are **never** asked to paste an OAuth Client ID inside the game; the Web OAuth 2.0 Client ID is baked into the build via `VITE_GOOGLE_CLIENT_ID` (developers testing custom sandboxes locally can optionally override `capy_google_oauth_client_id_v1` via `setGoogleClientId` in [`GoogleCloudSyncClient.ts`](./web/src/services/providers/GoogleCloudSyncClient.ts)).
   - When the user clicks **Google Login** in **Settings -> Saves** (or when opt-in silent sign-in succeeds on startup), [`GoogleCloudDriver`](./web/src/services/providers/CloudProviderDrivers.ts) fetches `/oauth2/v3/userinfo` (`sub`, `name`, `email`, `picture`) and runs `ProviderRegistry.cloudSave.syncFullLibrary(snapshots)` against their private Google Drive `appDataFolder`, enforcing `isValidGoogleDriveFileId` (`assertValidFileId`) on all file IDs and `findFileByName` responses to block `.` / `..` / traversal characters.
3. **Demand-Driven Google Play Games Services v2 Login & Saved Games (`SnapshotsClient`) on Android**:
   - On Android (`app/`), [`AndroidManifest.xml`](./app/src/main/AndroidManifest.xml) sets `SUPPRESS_GAME_PROFILE_CREATION="true"` and [`MainActivity.kt`](./app/src/main/java/com/capyboop/paint/MainActivity.kt) only calls `PlayGamesSdk.initialize(this)` in `onCreate()` when `CAPY_PLAY_GAMES_APP_ID` is configured (`CapyAndroidBridge.isPlayGamesConfigured()`), without invoking `requestPlayGamesSignIn()`, profile lookups, or `SnapshotsClient` pulls automatically on startup.
   - Only when the WebView explicitly invokes `CapyAndroid.signInPlayGames()` (when `showCloudCoopUi` is enabled) does `MainActivity.kt` call `requestPlayGamesSignIn()`; if unconfigured, offline, or unavailable, native sign-in immediately notifies `window.__capyReceivePlayGamesError(...)` so `PlayGamesAndroidDriver` fails fast without blocking UI spinners.
   - Once authenticated, `MainActivity.kt` resolves `PlayGames.getPlayersClient(this).currentPlayer` (`displayName`, `playerId`), caches them in `capy_play_games_prefs`, pushes them to `window.__capyReceivePlayGamesProfile(...)`, and reconciles `capy_cloud_manifest_v2` via `PlayGames.getSnapshotsClient(this)` (`SnapshotsClient.RESOLUTION_POLICY_MANUAL`, `decideSnapshotPushAction`, `window.__capyReceiveCloudSnapshot`, and `window.__capyReceiveCloudSnapshotError`).

### C. Four Complementary Ways Data Is Shared Between Players

1. **Shareable Progress Link (`#s=<token>`)**:
   - *Transport*: Compresses painted region IDs, Free Colour overrides, `isFreeColor`, `updatedAt`, and `sourceRef` directly into the URL fragment (`https://capypaint.com/#s=...` via `CANONICAL_PRODUCTION_URL` in [`ShareLinkService.ts`](./web/src/services/ShareLinkService.ts)).
   - *Size & Infrastructure*: `~100--400 bytes` (`< 2 KB` budget); **zero server required**; works across separate devices immediately for built-in Gallery artworks.
2. **Local / Same-Browser Co-op Room (`?room=<ROOM6>`)**:
   - *Transport*: Uses native `BroadcastChannel` (`capy_coop_room_<channel>_<ROOM6>` via `resolveCoopBroadcastChannelName` so `/capy/`, `/capy/beta/`, and `/capy/alpha/<num>/` never collide on shared origins) to stream real-time `HELLO`, `WELCOME_STATE`, `PAINT_EVENT`, `UNFILL_EVENT`, `HEARTBEAT`, and `LEAVE` frames (`~120 bytes` per tap/undo) between tabs/windows on the same device with **zero server required**.
3. **Internet Cross-Device Co-op Room (`?room=<ROOM6>`)**:
   - *Transport*: Uses `HybridCoopRoomClient` (aliased as `HybridCoopRoomAdapter` in [`HybridCoopRoomClient.ts`](./web/src/services/coop/HybridCoopRoomClient.ts) and re-exported by [`ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts)) over WebSocket (`resolveCoopRoomWsUrl`) with a `hasOwnProperty`-guarded declarative wire dispatch map, strict field whitelisting on `PAINT_EVENT`/`UNFILL_EVENT`/`CoopParticipant` (zero object spread), a `24`-peer cap with oldest-non-self eviction, and `10`-minute WS peer pruning (`WS_PEER_STALE_MS` alongside `18s` BroadcastChannel pruning). Relays `HELLO`, `WELCOME_STATE`, `PAINT_EVENT`, `UNFILL_EVENT`, and `LEAVE` frames (`~120 bytes` per tap/undo, `<= 6 KB` enforced by [`worker/coopRoomProtocol.ts`](./worker/coopRoomProtocol.ts)) through [`CoopRoomDurableObject`](./worker/index.ts), automatically connecting to `wss://capypaint.com/api/room` on `capypaint.com`, `*.capypaint.com`, and Android `appassets.androidplatform.net` (or any custom `VITE_CAPY_ROOM_WS_URL`), hibernating with `0` idle CPU ms between strokes via C++ `WebSocketRequestResponsePair('PING', 'PONG')` and falling back cleanly to `BroadcastChannel` on `localhost` or `github.io`.
4. **Portable `.capy` v2 Binary File Export**:
   - *Transport*: Exports a self-contained `CAPY\x02<flags>` binary archive (`flags`: `0x01` `FLAG_GZIP` single save, `0x03` `FLAG_GZIP | FLAG_ARCHIVE` multi-save library bundle, `0x00` uncompressed) containing the source image, quantized RLE segmentation map, custom palette, and undo/replay chronology via OS Share Sheet or file download.
   - *Size & Infrastructure*: `~15--45 KB` for built-in/line-art saves and `~45--95 KB` for custom photographic saves; **zero server required**; works offline across all devices.

### D. How Full-Library Cloud Sync Merges Progress Without Losing Work (CRDT)
Traditional cloud saves overwrite File A with File B if you play on two devices offline. Capy instead syncs a unified `CloudLibraryManifestV2` (`capy_cloud_manifest_v2.json`, mirrored locally in `capy_cloud_library_manifest_v2` via [`CloudLibrarySyncOrchestrator.ts`](./web/src/services/cloud/CloudLibrarySyncOrchestrator.ts)) and merges each puzzle's progress as a **Conflict-Free Replicated Data Type (CRDT)** (`mergeProgressDeltas` in [`CapyCodec.ts`](./web/src/services/CapyCodec.ts)):
- **Full Save Library Sync (`syncFullLibrary`)**:
  - Every built-in sample save stores its compact `ProgressDeltaV2` token (`< 2 KB`) inside `capy_cloud_manifest_v2.json`.
  - Every custom user-uploaded photo save exports a `.capy` v2 binary (`StorageService.exportSnapshotBinary(id)`):
    - Drivers with multi-file blob storage (`GoogleCloudDriver`) upload `capy_save_<snapshotId>.capy` to `appDataFolder` and store its `cloudBinaryRef` in `capy_cloud_manifest_v2.json`.
    - `PlayGamesAndroidDriver` (`SnapshotsClient`) embeds small custom `.capy` binaries `<= 180 KB` inline via `inlineBinaryB64` and splits larger custom photo saves (`> 180 KB`, up to `3 MB` across `32` chunks of `180 KB` each) across atomic `pgblob_<slot>_part_<i>` Play Games snapshot slots (`pgblob:<blobKey>:<totalChunks>:<totalBytes>` via shared chunk-transfer helpers and `PLAY_GAMES_CHUNK_PULL_TIMEOUT_MS = 10_000` in [`CloudProviderDrivers.ts`](./web/src/services/providers/CloudProviderDrivers.ts)), registering slot-filtered `NativeBridge.onCloudSnapshot` and `onCloudSnapshotError` listeners (while preserving unmatched live slots and throwing `once: true` cleanup), rejecting `..` dot-segments symmetrically in `readBinaryBlob` and `writeBinaryBlob`, and reassembling/validating byte lengths bit-exact on restore while pruning stale trailing chunks on overwrite.
  - If Device B does not yet have a puzzle started on Device A, `syncFullLibrary` automatically imports it into `StorageService` on Device B.
  - **Per-Slot Deletion Tombstones & Cross-Account Isolation**: `SnapshotStorage.deleteSnapshot(id)` records a per-slot deletion timestamp (`capy_cloud_tombstones_v1`, synced in `CloudLibraryManifestV2.tombstones`) via [`slotKey.ts`](./web/src/services/cloud/slotKey.ts) so deleted saves never resurrect from stale remote manifests while newer re-creates (`lastOpened > deletedAt`) clear the tombstone. `AuthManager.signOut()` ([`AuthManager.ts`](./web/src/services/auth/AuthManager.ts)) invokes `onSignOut` before resetting identity so `CloudLibrarySyncOrchestrator.clearLocalCloudCache()` clears `capy_cloud_vault_v1`, `capy_cloud_library_manifest_v2`, and `capy_cloud_tombstones_v1` across account switches.
- **Epoch-Scoped Grow-Only Set Union (`filledRegionIds` + `resetEpoch`)**:
  - Within the same `resetEpoch`, painting regions `[1, 2, 3]` on your phone and `[3, 4, 5]` on your laptop merges cleanly into `[1, 2, 3, 4, 5]`—neither device's work is ever lost. Both `pullRemoteLibraryManifest()` and `syncFullLibrary()` merge via `mergeProgressDeltas()`, and `hasPendingLocalChanges` compares full snapshot + tombstone content fingerprints pre-push vs. post-push.
  - Clicking **Reset Progress** increments monotonic `resetEpoch` (`ProgressDeltaV2` flag bit `8`, `SavedSnapshot.resetEpoch`, `CloudSaveEnvelope.resetEpoch`, and `CloudSaveEntryV2.resetEpoch`). Whenever two deltas carry different `resetEpoch` values, `mergeProgressDeltas` deterministically selects the higher epoch so stale pre-reset cloud saves or Co-op peers never resurrect cleared regions.
- **Custom Free-Colour Overrides (`paintedRegionColors`) use Last-Writer-Wins (LWW)**:
  - Concurrent custom-color edits on the same region within the active `resetEpoch` resolve deterministically in favor of the newer `updatedAt` timestamp.
- **Per-File Write Serialization, `404` Recovery & `401` Session Invalidation (`BF-3`, `GoogleCloudDriver`)**:
  - `GoogleCloudDriver`, `MicrosoftCloudDriver`, and `AppleCloudDriver` in [`CloudProviderDrivers.ts`](./web/src/services/providers/CloudProviderDrivers.ts) share `KeyedWriteQueue` to serialize concurrent writes per filename. `GoogleCloudDriver` maintains in-memory file-ID caches (`cachedManifestFileId`, `cachedSlotFileIds`, `cachedBlobFileIds`) and automatically invalidates + re-looks up + retries once whenever Google Drive returns HTTP `404` (`GoogleDriveHttpError`). On HTTP `401`, [`GoogleCloudSyncClient.ts`](./web/src/services/providers/GoogleCloudSyncClient.ts) fires `onGoogleSessionInvalidated` so `AuthManager` immediately downgrades stale Google sessions to guest and notifies UI subscribers. One Tap ID tokens require a 3-part JWT with valid `iss`, non-expired `exp`, matching `aud`, and a non-empty OAuth2 `accessToken`.

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
- **Edge Static Assets, Rate Limiting & API Security Headers**: `wrangler.jsonc` (`workers_dev: false`, `preview_urls: false`) serves `./web/dist` (`not_found_handling: "single-page-application"`, `run_worker_first: ["/api/*"]`) with immutable hashed bundle caching (`Cache-Control: public, max-age=31536000, immutable` on `/assets/*` and `! Cache-Control` revalidation overrides on unhashed sample/icon files in [`web/public/_headers`](./web/public/_headers)). [`wrangler.jsonc`](./wrangler.jsonc) binds `API_RATE_LIMITER` (`60` requests / `60s` per client IP bucket via `checkApiRateLimit`, returning `429` with `Retry-After: 60`) and `FEEDBACK_RATE_LIMITER` (`5` requests / `60s` per client IP for `/api/feedback`), while [`worker/index.ts`](./worker/index.ts) wraps non-`101` `/api/*` responses with deduplicated `API_SECURITY_HEADERS` via `withApiSecurityHeaders` / `mergeApiSecurityHeaders` (`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, HSTS).
- **SPA Fallback vs. [`web/public/_redirects`](./web/public/_redirects)**: [`web/public/_redirects`](./web/public/_redirects) handles only the `/capy.apk` `302` release redirect, while [`wrangler.jsonc`](./wrangler.jsonc) `not_found_handling: "single-page-application"` handles SPA fallback (`/* /index.html 200` is intentionally omitted from `_redirects` because Cloudflare Static Assets rejects wildcard-to-index rules with an infinite-loop warning).
- **SQLite-Backed WebSocket Hibernation (`CoopRoomDurableObject`)**: `/api/room?room=<ROOM6>` performs pre-DO `GET`, `Upgrade: websocket`, canonical `4-8`-char `room` validation (zero `.slice(0, 8)` truncation), and `Origin` checks (`capypaint.com`, `*.capypaint.com`, `paint.capyboop.com`, `capyboop.github.io`, <!-- capy-dev-only:start -->`shthed.github.io`, <!-- capy-dev-only:end -->`appassets.androidplatform.net`, optional `ALLOWED_EXTRA_ORIGINS`, plus `localhost`/`127.0.0.1`/`[::1]` ONLY when `ALLOW_LOCALHOST_ORIGINS === 'true'`) before upgrading to a per-room Durable Object using `new_sqlite_classes` (supported on both **Cloudflare Workers Free and Paid plans**). Sockets hibernate between strokes (`0` idle CPU ms via C++ `WebSocketRequestResponsePair('PING', 'PONG')`), defer SQLite schema creation/writes and the `24h` `ROOM_STATE_TTL_MS` alarm until a valid `HELLO` is processed, enforce a `10s` unjoined handshake timeout (`UNJOINED_HANDSHAKE_TIMEOUT_MS`) and per-IP unjoined connection cap (`MAX_UNJOINED_SOCKETS_PER_IP = 4`) so idle unjoined sockets cannot squat room slots, skip unjoined peers (`!peerAttachment?.joinedAt`) in all room broadcasts, validate incoming frames through the declarative `COOP_FRAME_VALIDATORS` table in [`worker/coopRoomProtocol.ts`](./worker/coopRoomProtocol.ts), drop pre-`HELLO` frames cleanly, reject spoofed `RESERVED_RELAY_PLAYER_ID` senders and duplicate active `boundPlayerId` values (`resolveBoundSocketSender`), issue a server-generated `hostToken` (`HOST_GRANTED`, never relayed to peers) to enforce `isSeedAuthority` host seed-lock (`evaluateRoomSeedAction`), hand off host authority to the earliest remaining joined peer (or clear host lock when the room empties) on host disconnect, enforce `<= 6 KB` UTF-8 frames, `<= 4096`-char Base64URL+header `seedToken` checks, and `40 frames / 5s` sliding-window rate limits, persist debounced `WELCOME_STATE` `'pending_seed'` checkpoints in SQLite (`5s`) so hibernation never drops pending checkpoints, clear expired rows on both `alarm()` and hibernation wake, and broadcast `LEAVE` to joined peers on disconnect.
- **Anonymous In-Game Feedback Relay (`POST` / `OPTIONS /api/feedback`, [`worker/feedbackProtocol.ts`](./worker/feedbackProtocol.ts))**:
  - Enforces `isAllowedRelayOrigin` CORS allowlisting (including `capypaint.com`, `*.capypaint.com`, `paint.capyboop.com`, `capyboop.github.io`, and `appassets.androidplatform.net`), `FEEDBACK_RATE_LIMITER` (`5` requests / `60s`, falling back to `API_RATE_LIMITER`), `application/json` content type (`415`), `<= 8192`-byte UTF-8 body cap (`413`), hidden `website` honeypot (`202` silent accept), control-char / triple-backtick / `@mention` neutralization, and category-to-label mapping (`bug` -> `['bug']`, `feature` / `puzzle_idea` -> `['enhancement']`, `general` -> `['question']`).
  - Creates anonymous issues in `capyboop/paint` (overrideable via `CAPYBOOP_FEEDBACK_REPO`) using the Cloudflare Worker secret `CAPYBOOP_FEEDBACK_TOKEN` (a fine-grained GitHub PAT scoped strictly to `capyboop/paint` with **Issues: Read and write** and **Metadata: Read-only**). Provision once via `npx wrangler secret put CAPYBOOP_FEEDBACK_TOKEN` (or Cloudflare Dashboard -> Workers & Pages -> `capy-paint` -> Settings -> Variables and Secrets).
  - When `CAPYBOOP_FEEDBACK_TOKEN` is absent or GitHub is unreachable, returns structured `503` (`feedback_unconfigured`) or `502` (`upstream_error`) JSON with a prefilled `fallbackUrl` (`https://github.com/capyboop/paint/issues/new?...`) so players never lose their typed feedback.
- **Canonical Domain Redirect, `/capy.apk` Download & Health Check**:
  - [`web/index.html`](./web/index.html) executes a synchronous pre-React redirect from [www.capypaint.com](https://www.capypaint.com/) to [capypaint.com](https://capypaint.com/) preserving path, query, and `#s=` hash fragments, [`worker/index.ts`](./worker/index.ts) `301`-redirects `/api/*` requests on [www.capypaint.com](https://www.capypaint.com/), and [`web/public/_redirects`](./web/public/_redirects) `302`-redirects `/capy.apk` to `releases/latest/download/capy.apk` (uploaded on stable tags by [`release.yml`](./.github/workflows/release.yml)).
  - **Recommended 1-Click Cloudflare Edge `301` Rule**: Because `run_worker_first` is scoped strictly to `["/api/*"]` so static assets consume `0` Worker invocations, add a **Cloudflare Dashboard -> Rules -> Redirect Rules -> Single Redirect** matching `Hostname equals www.capypaint.com` -> Dynamic `301` redirect to `concat("https://capypaint.com", http.request.uri.path)` with **Preserve query string** enabled so `www` redirects at the CDN edge before Static Assets.
  - `GET /api/health` ([capypaint.com/api/health](https://capypaint.com/api/health)) returns JSON service status (`{"ok":true,"service":"capy-paint","domain":"<request-hostname>",...}`) echoing `url.hostname`.

### Do I Really Need `CLOUDFLARE_API_TOKEN`?
- **No — for Option 1 (Cloudflare Workers Builds Git Integration)**: Cloudflare connects to GitHub via its official OAuth GitHub App and builds/deploys automatically on push with **zero** GitHub repository secrets (`CLOUDFLARE_API_TOKEN` is not needed).
- **Yes — only for Option 2 (GitHub Actions [`.github/workflows/deploy-cloudflare.yml`](./.github/workflows/deploy-cloudflare.yml)) or non-interactive CLI deploys**: GitHub Actions runners and headless `npx wrangler deploy` scripts need `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` stored in repository Actions Secrets.
- **Never Enable Both Auto-Deploy Paths Simultaneously**: Pick **either** Option 1 (Workers Builds) **or** Option 2 (GitHub Actions `CLOUDFLARE_API_TOKEN`) for [capypaint.com](https://capypaint.com/)—never both at once, or every push to `main` will trigger duplicate racing deployments.

### Connecting to Cloudflare Workers ([capypaint.com](https://capypaint.com/))
Choose either native Cloudflare Git builds (Option 1, zero GitHub secrets) or GitHub Actions deployment (Option 2, per [#543 — Production capypaint.com DNS, Cloudflare Worker & /env-setup cutover](../../issues/543)):

- **Option 1 -- Cloudflare Workers Builds Git Integration (Recommended, Zero Token)**:
  1. Add [capypaint.com](https://capypaint.com/) as a zone in [Cloudflare Dashboard](https://dash.cloudflare.com/), verify registrar nameservers (`guy.ns.cloudflare.com` and `maleah.ns.cloudflare.com`), and delete legacy Squarespace `A`/`AAAA`/`CNAME` records on `@` and `www` so `wrangler.jsonc` `custom_domain: true` can attach cleanly.
  2. Open **Compute (Workers) -> Workers & Pages -> Create application -> Import a repository**, select [shthed/capy](https://github.com/shthed/capy) (branch `main`), and keep Project Name `capy-paint`.
  3. Root [`package.json`](./package.json) provides `"build": "npm --prefix web ci && npm --prefix web run build"` and `"deploy": "wrangler deploy"` (`wrangler@^4.160.1`), so either `npm run build` + `npx wrangler deploy` or `npm --prefix web ci && npm --prefix web run build` + `npx wrangler deploy` works out of the box from Root directory `/`.
  4. Click **Save and Deploy**. Cloudflare automatically provisions custom domains [capypaint.com](https://capypaint.com/) and [www.capypaint.com](https://www.capypaint.com/) (`custom_domain: true` in [`wrangler.jsonc`](./wrangler.jsonc)) with managed SSL certificates and runs the `v1` SQLite Durable Object migration.
- **Option 2 -- GitHub Actions Workflow ([`.github/workflows/deploy-cloudflare.yml`](./.github/workflows/deploy-cloudflare.yml))**:
  1. In [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens), either start from the **Edit Cloudflare Workers** template and add `Zone -> DNS: Edit` (scoped strictly to [capypaint.com](https://capypaint.com/)) — plus `Zone -> SSL and Certificates: Edit` if initial `custom_domain: true` certificate attachment returns an auth error — **or** create a **Custom Token** with these exact least-privilege permissions (the unmodified **Edit Cloudflare Workers** template omits `DNS: Edit` and `SSL and Certificates: Edit`):
     - **Account Permissions** (Account Resources scoped to your target account): `Workers Scripts: Edit` and `Account Settings: Read`.
     - **Zone Permissions** (Zone Resources scoped strictly to [capypaint.com](https://capypaint.com/)): `Zone: Read`, `Workers Routes: Edit`, and `DNS: Edit` (required for `custom_domain: true` route and DNS provisioning in [`wrangler.jsonc`](./wrangler.jsonc) and for the one-time `replace_dns` cutover), plus `SSL and Certificates: Edit` if needed on initial certificate attachment.
  2. Copy `CLOUDFLARE_ACCOUNT_ID` from the [Cloudflare Dashboard](https://dash.cloudflare.com/) URL path (`/<ACCOUNT_ID>/...`), the **Account ID** panel on **Workers & Pages -> Overview**, or `npx wrangler whoami` locally.
  3. In [shthed/capy Actions Secrets](https://github.com/shthed/capy/settings/secrets/actions), save `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (and optionally add `VITE_GOOGLE_CLIENT_ID` and `CAPY_ANDROID_SHA256_CERT_FINGERPRINTS` under **Variables**). Never paste secrets into chat or commit them to files.
  4. Every push to `main` (or manual `workflow_dispatch`) runs `npm run test:sanity`, `npm run lint`, and `npm run build`, deploys via `cloudflare/wrangler-action@v4` (`wranglerVersion: '4.160.1'`), and verifies [capypaint.com/api/health](https://capypaint.com/api/health). Repositories without Cloudflare secrets skip cleanly in `< 2s`.
  5. **One-time DNS cutover**: Worker custom domains fail with Cloudflare error `100117` ("Hostname already has externally managed DNS records") while the old Squarespace `A`/`AAAA`/`CNAME` records for `capypaint.com` and `www` exist. Run the first deploy with `gh workflow run deploy-cloudflare.yml -R shthed/capy --ref main -f replace_dns=true`, which deletes only non-read-only `A`/`AAAA`/`CNAME` records on those two hostnames (never `MX`/`TXT` or Worker-managed records) immediately before `wrangler deploy` and lists each deletion in the run summary. Normal push deploys never touch DNS.
  6. **Canonical `www` & HTTPS edge redirects (`capypaint.com`)**: Because [`wrangler.jsonc`](./wrangler.jsonc) uses `"run_worker_first": ["/api/*"]` so static page hits never consume Worker requests, add a **Rules -> Redirect Rules -> Single Redirect** (`www.capypaint.com/*` -> `https://capypaint.com/$1`, `301`, Preserve query string) and enable **SSL/TLS -> Edge Certificates -> Always Use HTTPS** in [Cloudflare Dashboard](https://dash.cloudflare.com/).

### Companion Studio Domain ([capyboop.com](https://capyboop.com/)) -- Deferred
- **Status**: Deferred out of active Sprint 1 scope while prioritizing [capypaint.com](https://capypaint.com/) and [capyboop/paint](https://github.com/capyboop/paint/issues).
- **Target Architecture**: [capypaint.com](https://capypaint.com/) hosts **Capy Paint** (`capy-paint` Worker + `CoopRoomDurableObject`), while [capyboop.com](https://capyboop.com/) is reserved for **CapyGame** ([shthed/capygame](https://github.com/shthed/capygame) / [CapyGame GitHub Pages](https://shthed.github.io/capygame/)) using Cloudflare Workers Static Assets + `public/_headers` (`COOP`/`COEP` headers for `SharedArrayBuffer`) when revisited.
<!-- capy-dev-only:start -->

### Automated Clean-Room Public Mirror & Public Issue/PR Repo (`shthed/capy` <-> `capyboop/paint`)
- Every merge to `shthed/capy` `main` triggers [`.github/workflows/publish-capyboop.yml`](./.github/workflows/publish-capyboop.yml), which invokes [`web/scripts/rebrand-persona.mjs`](./web/scripts/rebrand-persona.mjs) (`--stage-dir /tmp/capyboop-stage`) to export a clean-room copy of the codebase (including `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`, `CONTRIBUTING.md`, `SUPPORT.md`, and `SECURITY.md`) with all `shthed` references rewritten to `capyboop`, all dev-only docs (`AGENTS.md`, `CAPYBOOP.md`) and mirror/review workflows stripped, and a hard byte-level zero-leak check enforced before pushing a linear commit authored solely by `capyboop <354866242+capyboop@users.noreply.github.com>` and syncing the matching `v<version>` release tag to [capyboop/paint](https://github.com/capyboop/paint).
- **Public Issue Tracker, Two-Way PR Sync & Single-Origin Rule**:
  1. [capyboop/paint](https://github.com/capyboop/paint) is the canonical public-facing production repository accepting external issues ([capyboop/paint/issues](https://github.com/capyboop/paint/issues), linked from [capypaint.com](https://capypaint.com/) `Settings -> About`, [`privacy-policy.html`](./web/public/privacy-policy.html), and [`README.md`](./README.md)) and community Pull Requests. Preserve existing open public issues (`#2`--`#5`+) by keeping the repo intact (submit a **GitHub Support -> Detach Fork** ticket rather than deleting the repo whenever clearing the `forked from` label).
  2. **Two-Way PR Sync**: Because `publish-capyboop.yml` builds `capyboop/paint` `main`'s tree from `shthed/capy` `main` via `git commit-tree`, any external PR merged on `capyboop/paint` must be fetched and back-ported into `shthed/capy` (`beta -> main`) before the next `shthed/capy` `main` push so public contributions are never overwritten.
  3. Signed in as `capyboop`, create a Fine-Grained Personal Access Token scoped strictly to [capyboop/paint](https://github.com/capyboop/paint) with **Contents: Read and write** and **Workflows: Read and write**, then save it in [shthed/capy Actions Secrets](https://github.com/shthed/capy/settings/secrets/actions) as `CAPYBOOP_SYNC_TOKEN` so `publish-capyboop.yml` clean-room resets `main` automatically without touching Issues.
  4. **Single Deploy Origin (`shthed/capy`)**: Keep [capypaint.com](https://capypaint.com/) deploying strictly from [shthed/capy](https://github.com/shthed/capy) `main` and keep [capyboop/paint](https://github.com/capyboop/paint) disconnected from Cloudflare Workers Builds and without `CLOUDFLARE_API_TOKEN` secrets so both repositories never deploy to [capypaint.com](https://capypaint.com/) simultaneously.
<!-- capy-dev-only:end -->
