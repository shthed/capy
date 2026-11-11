# Modular Cloud Sync, Google Account / Play Games v2 & Multiplayer Data Sharing (`CLOUD.md`)

This document explains how modular multi-platform cloud login (`Google`, `Google Play Games v2`, `Steam`, `Microsoft`, `Apple`), conflict-free cross-device Save Library sync, shareable progress links, and simultaneous Co-op multiplayer rooms work across the **Capy** monorepo (`web/` and `app/`).

---

## 1. Plain-English Overview: How Everything Works

### A. Modular Cloud Provider Architecture (`CloudProviderDriver`)
Capy separates **CRDT save merging** (`CrdtCloudSaveAdapter` in [`ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts)) from **platform-specific authentication and cloud storage** via the modular [`CloudProviderDriver`](./web/src/services/providers/types.ts) interface implemented in [`CloudProviderDrivers.ts`](./web/src/services/providers/CloudProviderDrivers.ts):

| Provider ID (`CloudProviderId`) | Driver Class | Authentication Mechanism | Cloud Storage Backend | Status |
| :--- | :--- | :--- | :--- | :--- |
| `'google'` | `GoogleCloudDriver` | Google Identity Services OAuth 2.0 (`https://accounts.google.com/gsi/client`, `openid profile email drive.appdata`) | Google Drive `appDataFolder` REST API v3 (`capy_cloud_manifest_v2.json` + `.capy` v2 binaries) | **Active (Web, Desktop, iOS & Android)** |
| `'play_games_v2'` | `PlayGamesAndroidDriver` | Native Android Google Play Games Services v2 SDK (`GamesSignInClient` + `PlayersClient`) | Android `PlayGames.getSnapshotsClient(activity)` Saved Games API + local `filesDir/capy_cloud/` cache | **Active (Android App)** |
| `'steam'` | `SteamCloudDriver` | Steamworks Auth Session Ticket (`window.__capySteamBridge`) | Steam Cloud `ISteamRemoteStorage` (`fileWriteAsync` / `fileReadAsync`) | **Modular Driver Ready (Awaiting Desktop Tauri Wrapper)** |
| `'microsoft'` | `MicrosoftCloudDriver` | Microsoft Entra ID / MSA OAuth 2.0 PKCE (`Files.ReadWrite.AppFolder`) | Microsoft Graph OneDrive `special/approot` REST API / Xbox Connected Storage | **Modular Driver Ready (Planned)** |
| `'apple'` | `AppleCloudDriver` | Sign in with Apple JS / Native GameKit (`GKLocalPlayer`) | Apple CloudKit JS (`privateCloudDatabase`) / iCloud `GKSavedGame` | **Modular Driver Ready (Planned)** |

### B. How Automatic Google Account & Play Games Login Works
1. **Instant Local Profile (Zero Friction)**:
   - Every player starts immediately with a local profile (for example, `Sunny Capy` with a chosen avatar color) stored in `localStorage` under `capy_player_identity_v1`. No account is required to play, save, or share links.
2. **Automatic Google Account Login & Silent Sync on Web / Desktop (`attemptAutoSignIn`)**:
   - On startup (`App.tsx`), `ProviderRegistry.auth.attemptAutoSignIn()` automatically checks for a valid cached Google OAuth session or invokes **Google Identity Services One Tap** (`google.accounts.id.initialize({ auto_select: true, cancel_on_tap_outside: false, use_fedcm_for_prompt: true })` + `google.accounts.id.prompt()`) and silent OAuth token refresh (`prompt: ''`) unless the player explicitly clicked **Sign Out** (`capy_cloud_explicit_signout_v1`).
   - Players are **never** asked to paste an OAuth Client ID inside the game; the Web OAuth 2.0 Client ID is baked into the build via `VITE_GOOGLE_CLIENT_ID`.
   - When the user clicks **Google Login** in **Settings -> Saves** (or when One Tap / silent sign-in succeeds on startup), [`GoogleCloudDriver`](./web/src/services/providers/CloudProviderDrivers.ts) retrieves their Google Account `name`, `email`, `picture` (avatar URL), and `sub` (stable Google ID) and immediately runs `ProviderRegistry.cloudSave.syncFullLibrary(snapshots)` against their hidden Google Drive `appDataFolder`.
3. **Automatic Google Play Games Services v2 Login & Saved Games (`SnapshotsClient`) on Android**:
   - On Android (`app/`), [`MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt) initializes `PlayGamesSdk.initialize(this)` on app launch and checks `PlayGames.getGamesSignInClient(this).isAuthenticated`.
   - If the player is not yet authenticated on launch, `MainActivity.kt` automatically calls `PlayGames.getGamesSignInClient(this).signIn()` (`requestPlayGamesSignIn()`) so the native Google Play Games welcome banner signs them in automatically.
   - Once authenticated, `MainActivity.kt` queries `PlayGames.getPlayersClient(this).currentPlayer` for `player.displayName` and `player.playerId`, caches them via `bridge.cachePlayGamesProfile(playerId, displayName)`, delivers them to the WebView via `window.__capyReceivePlayGamesProfile(...)`, and syncs `capy_cloud_manifest_v2` via `PlayGames.getSnapshotsClient(this)`.

### C. How Data Is Shared Between Players
Capy supports **four complementary ways** to share puzzle data and paint together:

| Sharing Method | How Data Travels Between Players | Payload Size | Server Required? | Works Across Separate Devices? |
| :--- | :--- | :--- | :--- | :--- |
| **1. Shareable Progress Link (`#s=<token>`)** | All painted region IDs, Free Colour overrides, and the artwork ID are compressed into the URL hash itself (`https://shthed.github.io/capy/#s=...`). You send the link via SMS, WhatsApp, Discord, or email; the recipient's browser/app decodes the progress directly from the link. | `~100 - 400 bytes` (`< 2 KB`) | **No server required** (data lives inside the URL) | **Yes** (instant for built-in Gallery artworks) |
| **2. Local / Same-Browser Co-op Room (`?room=<ROOM6>`)** | Uses the browser's native `BroadcastChannel` (`capy_coop_room_<ROOM6>`) to stream real-time `PAINT_EVENT` strokes and `WELCOME_STATE` progress seeds between open tabs or windows on the same device. | `~120 bytes` per tap | **No server required** | Same device / browser profile |
| **3. Internet Cross-Device Co-op Room (`?room=<ROOM6>`)** | Uses `HybridCoopRoomAdapter` over WebSocket (`VITE_CAPY_ROOM_WS_URL`) to relay `HELLO`, `WELCOME_STATE`, `PAINT_EVENT`, and `HEARTBEAT` frames between players on different phones, tablets, or PCs. | `~120 bytes` per tap | **Yes** (requires `VITE_CAPY_ROOM_WS_URL` WebSocket relay) | **Yes** (when `VITE_CAPY_ROOM_WS_URL` is configured) |
| **4. Portable `.capy` v2 Binary File Export** | Exports a self-contained `CAPY\x02\x00` binary archive containing the source image, quantized segmentation map, and full undo/replay history via OS Share Sheet or file download. | `~15 KB - 45 KB` per puzzle | **No server required** | **Yes** (works for both Gallery and custom user photos) |

### D. How Full-Library Cloud Sync Merges Progress Without Losing Work (CRDT)
Traditional cloud saves overwrite File A with File B if you play on two devices offline. Capy instead syncs a unified `CloudLibraryManifestV2` (`capy_cloud_manifest_v2.json`) and merges each puzzle's progress as a **Conflict-Free Replicated Data Type (CRDT)** (`mergeProgressDeltas` in [`CapyCodec.ts`](./web/src/services/CapyCodec.ts)):
- **Full Save Library Sync (`syncFullLibrary`)**:
  - Every built-in sample save stores its compact `ProgressDeltaV2` token (`< 2 KB`) inside `capy_cloud_manifest_v2.json`.
  - Every custom user-uploaded photo save exports a compact `.capy` v2 binary (`~20-60 KB`, `StorageService.exportSnapshotBinary(id)`) uploaded to the active cloud driver (`capy_save_<snapshotId>.capy`) and referenced by `cloudBinaryRef` in `capy_cloud_manifest_v2.json`.
  - If Device B does not yet have a puzzle that was started on Device A, `syncFullLibrary` automatically imports the puzzle into `StorageService` on Device B.
- **Painted Regions (`filledRegionIds`) use a Grow-Only Set Union**:
  - If you paint regions `[1, 2, 3]` on your phone and regions `[3, 4, 5]` on your laptop, syncing merges both sets into `[1, 2, 3, 4, 5]`. Neither device's painted regions are ever lost.
- **Custom Free-Colour Overrides (`paintedRegionColors`) use Last-Writer-Wins (LWW)**:
  - If two devices paint the same region with different custom colors, the delta with the newer `updatedAt` timestamp wins deterministically.
- **Per-File Write Serialization & File-ID Caching (`BF-3`, `GoogleCloudDriver`)**:
  - `GoogleCloudDriver` in [`CloudProviderDrivers.ts`](./web/src/services/providers/CloudProviderDrivers.ts) maintains in-memory file-ID caches (`cachedManifestFileId`, `cachedSlotFileIds`, `cachedBlobFileIds`) and a per-filename async promise-queue mutex (`writeLocks` / `enqueueWrite`) across `writeManifest`, `writeSlotEnvelope`, and `writeBinaryBlob`. Concurrent or rapid back-to-back sync writes for the same slot or `.capy` blob serialize deterministically and reuse the resolved Google Drive `fileId` (`PATCH /upload/drive/v3/files/<fileId>`) instead of racing two `findFileByName` lookups and creating duplicate files in `appDataFolder`.

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
    Sync->>Driver: writeBinaryBlob() for any new custom photo .capy saves
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
        T_WS["WebSocket Relay (VITE_CAPY_ROOM_WS_URL)\n(Cross-Device Internet Co-op)"]
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

## 3. Step-by-Step Developer Guide: Provisioning Google Cloud OAuth 2.0 (`VITE_GOOGLE_CLIENT_ID`) & Play Games v2 (`CAPY_PLAY_GAMES_APP_ID`)

### Part A: Web / Cross-Device Google Login & Google Drive `appDataFolder` Sync
1. **Create or select a project in Google Cloud Console**:
   - Open `https://console.cloud.google.com/` and create or select your project (for example, `Capy Paint`).
2. **Enable the Google Drive API**:
   - Navigate to **APIs & Services -> Library**, search for **Google Drive API**, and click **Enable**.
3. **Configure the Google Auth Platform / OAuth Consent Screen**:
   - Navigate to **APIs & Services -> OAuth consent screen** (or **Google Auth Platform -> Branding / Audience / Data Access**).
   - Set **User Type** to **External** and set the Privacy Policy URL to `https://shthed.github.io/capy/privacy-policy.html`.
   - Under **Data Access / Scopes**, click **Add or Remove Scopes** and add:
     - `openid`
     - `.../auth/userinfo.profile`
     - `.../auth/userinfo.email`
     - `https://www.googleapis.com/auth/drive.appdata` (*View and manage its own configuration data in your Google Drive* — non-sensitive scope).
   - If the app is in **Testing** mode, add your Google account email under **Audience -> Test users** (or click **Publish App** so any Google account can sign in).
4. **Create the Web OAuth 2.0 Client ID**:
   - Navigate to **APIs & Services -> Credentials -> + Create Credentials -> OAuth client ID**.
   - Select **Application type**: `Web application`.
   - Under **Authorized JavaScript origins**, add:
     - `https://shthed.github.io`
     - `http://localhost:3000`
     - `http://localhost:4173`
   - Click **Create** and copy the generated Client ID (`1234567890-xxxxxxxx.apps.googleusercontent.com`).
5. **Save `VITE_GOOGLE_CLIENT_ID` in GitHub Repository Variables**:
   - Open `https://github.com/shthed/capy/settings/variables/actions` (**Settings -> Secrets and variables -> Actions -> Variables** tab).
   - Click **New repository variable**:
     - **Name**: `VITE_GOOGLE_CLIENT_ID`
     - **Value**: `<your-client-id>.apps.googleusercontent.com`
   - For local development, you can also add `VITE_GOOGLE_CLIENT_ID=<your-client-id>.apps.googleusercontent.com` to `web/.env.local`.

### Part B: Android Google Play Games Services v2 (`CAPY_PLAY_GAMES_APP_ID`)
1. **Enable Play Games Services & Saved Games in Google Play Console**:
   - Open `https://play.google.com/console/`, select your app (`com.capypaint.capy`), and navigate to **Grow users -> Play Games Services -> Setup and management -> Configuration**.
   - Link your Google Cloud Project from Part A, set **Saved Games** (`SnapshotsClient`) to **ON**, and copy your **12-digit Play Games Project ID (App ID)**.
2. **Register Android Signing Certificate SHA-1 Fingerprints**:
   - Under **Play Games Services -> Setup and management -> Configuration -> Credentials -> Add credential**, select **Android** (`com.capypaint.capy`).
   - Register the SHA-1 fingerprint for your debug/upload keystore (`keytool -list -v -alias androiddebugkey -keystore ~/.android/debug.keystore -storepass android -keypass android`) and your Play App Signing certificate (**Test and release -> Setup -> App signing**).
3. **Save `CAPY_PLAY_GAMES_APP_ID` in GitHub Repository Variables**:
   - Open `https://github.com/shthed/capy/settings/variables/actions` and create a repository variable:
     - **Name**: `CAPY_PLAY_GAMES_APP_ID`
     - **Value**: `<your-12-digit-play-games-app-id>`
   - [`.github/workflows/deploy-branch.yml`](./.github/workflows/deploy-branch.yml) automatically injects `VITE_GOOGLE_CLIENT_ID` and `CAPY_PLAY_GAMES_APP_ID` into every Web and Android build.

