# Technical Architecture: Capy Android Unified Launcher (`APP.md`)

This document details the architecture, `@JavascriptInterface` native-to-web bridge, Google Play Games Services v2 `SnapshotsClient` integration, safe-area inset handling, and Gradle build lifecycle for the native Android launcher in [`app/`](./app/) (`com.capypaint.capy`, `:app` in Gradle).

**Related Guides**: [`README.md`](./README.md) | [`ROADMAP.md`](./ROADMAP.md) | [`DEV.md`](./DEV.md) | [`AGENTS.md`](./AGENTS.md) | [`TODO.md`](./TODO.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`CLOUD.md`](./CLOUD.md) | [`TESTING.md`](./TESTING.md) | [`CHANGELOG.md`](./CHANGELOG.md)

**Table of Contents**:
1. [Overview & Strategy](#1-overview--strategy)
2. [Component & `@JavascriptInterface` Reference](#2-component--javascriptinterface-reference)
3. [Safe-Area Inset Architecture (Pixel 7 / Cutouts)](#3-safe-area-inset-architecture-pixel-7--cutouts)
4. [Build & Gradle Lifecycle](#4-build--gradle-lifecycle)
5. [Build, Test & Run Commands](#5-build-test--run-commands)
6. [Android Studio & Local Debugging](#6-android-studio--local-debugging)

---

## 1. Overview & Strategy

The Android application in [`app/`](./app/) is a lightweight, zero-overhead native Android launcher that hosts the single-source-of-truth TypeScript/React game engine compiled into `web/dist/`.

Instead of maintaining a duplicate Kotlin implementation of vector quantization, segmentation, and canvas rendering, all gameplay, Web Worker generation, and CRDT codecs live once in [`web/`](./web/). The Android native layer handles OS-specific capabilities:
- **Offline HTTPS Asset Serving** via `androidx.webkit.WebViewAssetLoader` (`https://appassets.androidplatform.net/assets/www/index.html`)
- **Native Hardware Haptic Feedback** (`Vibrator` / `VibrationEffect` / `VibrationAttributes.USAGE_TOUCH` on API 33+)
- **System Safe Area & Cutout Inset Bridge** (`WindowInsetsCompat` $\rightarrow$ CSS custom properties)
- **Predictive System Back Navigation** (`OnBackPressedCallback` synced with the LIFO modal stack in [`NativeBridge.ts`](./web/src/services/NativeBridge.ts))
- **Native Photo Picker & SAF Document Chooser** (`PickVisualMedia` for images, `OpenDocument` for `.capy`/`.json` saves)
- **OS Share Sheet & Background-Downsampled Incoming Share Intents** (`Intent.ACTION_SEND` with `image/*` and binary `.capy` exports via `FileProvider`)
- **Google Play Games Services v2 Sign-In & Saved Games Sync** (`GamesSignInClient`, `PlayersClient`, and `SnapshotsClient`)
- **Persistent Internal Disk Backups** (`filesDir/capy_saves/` and `filesDir/capy_cloud/`)
- **Network Capability** (`android.permission.INTERNET` declared in [`AndroidManifest.xml`](./app/src/main/AndroidManifest.xml) for cloud sync, co-op rooms, and remote URLs)

---

## 2. Component & `@JavascriptInterface` Reference

### [`MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt)
Extends `androidx.activity.ComponentActivity` using `enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT), navigationBarStyle = SystemBarStyle.dark(Color.BLACK))`.
- **`WebViewAssetLoader` & Navigation Security**: Resolves local assets at `https://appassets.androidplatform.net/assets/www/index.html` with `safeBrowsingEnabled = true`, `allowFileAccess = false`, and `allowContentAccess = false`. `shouldOverrideUrlLoading` delegates URL classification to `CapyAndroidBridge.classifyWebViewNavigation`—allowing only `appassets.androidplatform.net` / `about:blank` inside the WebView, opening external `http`/`https` links via `Intent.ACTION_VIEW` so `@JavascriptInterface` is never exposed to third-party origins, and blocking unsafe schemes (`javascript:`, `file:`, `content:`).
- **`OnApplyWindowInsetsListener` & IME Insets**: Intercepts `WindowInsetsCompat.Type.systemBars() or displayCutout() or ime()`, converts physical pixels (`px / density`), and injects `--safe-area-top`, `--safe-area-bottom`, `--safe-area-left`, and `--safe-area-right` into `document.documentElement.style` (returning `windowInsets` unconsumed so Chromium adjusts focused inputs smoothly when the soft keyboard opens, alongside fallback `status_bar_height` / `navigation_bar_height` queries during `onCreate`).
- **System Back & State Restoration (`OnBackPressedCallback` + `onSaveInstanceState`)**: Tracks both `bridge.isModalOpen` and `webView.canGoBack()` via `updateBackCallbackState()` (updated in `doUpdateVisitedHistory`, `onPageFinished`, and modal changes), resets modal state in `onPageStarted`, and preserves WebView state across Activity recreation via `onSaveInstanceState` / `restoreState`.
- **Dual File Chooser Routing (`PickVisualMedia` & `OpenDocument`)**: Intercepts `WebChromeClient.onShowFileChooser` and checks `CapyAndroidBridge.shouldUsePhotoPicker(acceptTypes)`—routing `image/*` uploads to Android's system `PickVisualMedia` picker and `.capy`/`.json` imports to SAF `OpenDocument`.
- **Incoming Share Intents, Verified App Links & Google Play Games Services v2**:
  - `Intent.ACTION_SEND` (`image/*`, `BF-5`): Extracts `Intent.EXTRA_STREAM` in `onCreate` and `onNewIntent`, offloads decoding onto `shareDecodeExecutor`, subsamples via `calculateInSampleSize` / `calculateTargetDimensions` (`<= 2048px`), scales via `decoded.scale(targetW, targetH)`, and delivers buffered payloads safely even if WebView listeners mount after page load ([`NativeBridge.ts`](./web/src/services/NativeBridge.ts) cold-start queues).
  - `Intent.ACTION_VIEW` (`https://capypaint.com/...`, `https://www.capypaint.com/...`, and `https://shthed.github.io/capy...` with `android:autoVerify="${appLinksAutoVerify}"` in [`AndroidManifest.xml`](./app/src/main/AndroidManifest.xml), dynamically enabled by [`app/build.gradle.kts`](./app/build.gradle.kts) and `CapyAndroidBridge.isAppLinksCertConfigured` when `CAPY_ANDROID_SHA256_CERT_FINGERPRINTS` is set): Validates incoming HTTPS App Links via `CapyAndroidBridge.isAllowedCapyDeepLink` (`ROOT_DEEP_LINK_HOSTS` + `GITHUB_PAGES_DEEP_LINK_HOSTS`) and forwards `#s=<token>` and `?room=<ROOM6>` links to `window.__capyReceiveDeepLink`.
  - **Google Play Games Services v2 (`com.google.android.gms:play-services-games-v2:22.1.0`) & Live `SnapshotsClient` Sync**: When a real Play Console Project ID is configured (`@string/game_services_project_id` / `CAPY_PLAY_GAMES_APP_ID`), `MainActivity` initializes `PlayGamesSdk.initialize(this)`, checks `PlayGames.getGamesSignInClient(this).isAuthenticated` (automatically invoking `requestPlayGamesSignIn()` on launch if not yet signed in), queries `PlayGames.getPlayersClient(this).currentPlayer` (`displayName`, `playerId`), caches the profile in `SharedPreferences` (`capy_play_games_prefs`), pushes it to `window.__capyReceivePlayGamesProfile(...)`, and actively syncs cloud save slots (`capy_cloud_manifest_v2` plus multi-chunk `pgblob_*_part_<i>` binary slots) against `PlayGames.getSnapshotsClient(this)` using `SnapshotsClient.RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED`, pushing remote snapshot payloads into the WebView via `window.__capyReceiveCloudSnapshot(slotKey, payloadJson)`. Android WebView auth stays strictly on Play Games v2 (never falling back to web Google GIS popups) and hides browser APK download cards (`!NativeBridge.isAndroid`). See [`CLOUD.md`](./CLOUD.md) for full details.
- **Foreground / Background WebView Lifecycle Guard (`onPause` / `onResume` / `onDestroy`)**: `MainActivity` overrides `onPause()` (`webView?.onPause()`) and `onResume()` (`webView?.onResume()`) alongside `onDestroy()` (`shareDecodeExecutor.shutdownNow()`, `webView?.destroy()`) so Android WebView rendering, `requestAnimationFrame` loops, and Web Audio (`SoundService.ts`) suspend cleanly at the OS layer whenever the app is backgrounded or the screen locks.

### [`CapyAndroidBridge.kt`](./app/src/main/java/com/capypaint/capy/CapyAndroidBridge.kt)
Registered via `webView.addJavascriptInterface(bridge, "CapyAndroid")` (with `webView.isHapticFeedbackEnabled = true` in [`MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt) and `@JavascriptInterface` <-> `CapyAndroidInterface` parity enforced by `npm run test:sanity`). Also exposes pure companion helpers (`MAX_SHARED_IMAGE_DIMENSION = 2048`, `MAX_RAW_SHARED_IMAGE_BYTES = 4 * 1024 * 1024`, `DEFAULT_CLOUD_BINARY_CHUNK_BYTES = 180_000`, `MAX_CLOUD_BINARY_CHUNKS = 32`, `MAX_CLOUD_BINARY_TOTAL_BYTES = 3 * 1024 * 1024`, `calculateInSampleSize`, `calculateTargetDimensions`, `resolveHapticSpec`, `resolveShareImageSpec`, `prepareSharedExportFile`, `classifyWebViewNavigation`, `escapeJsonString`, `saveCloudBinaryChunkToDir`, `loadCloudBinaryChunkFromDir`, `saveCloudBinaryBytesToDir`, `loadCloudBinaryBytesFromDir`, `isPlayGamesAppIdConfigured`, `isAppLinksCertConfigured`).

All `@JavascriptInterface` methods exposed on `window.CapyAndroid`:
- **`haptic(type: String)`**: Resolves tactile parameters via `CapyAndroidBridge.resolveHapticSpec(type)` (`HapticSpec`, with content-based `equals`/`hashCode` for waveform arrays) and dispatches hardware haptics across Android API levels:
  - `"tick"`: `VibrationEffect.EFFECT_TICK` (API 29+) / `HapticFeedbackConstants.CLOCK_TICK` / 10ms pulse.
  - `"success"`: Custom 4-step waveform (`[0, 14, 45, 24]`).
  - `"warning"`: `VibrationEffect.EFFECT_HEAVY_CLICK` (API 29+) / direct `vibrateOneShot(18L)` fallback on older APIs (intentionally bypassing `view.performHapticFeedback` so warning pulses feel distinct from long-press UI menus).
  - `"error"`: Custom double-pulse waveform (`[0, 28, 50, 28]`).
  - Default (`"click"` fallback): `VibrationEffect.EFFECT_CLICK` (API 29+) / `HapticFeedbackConstants.KEYBOARD_TAP` / 12ms pulse.
  - **API 33+ Touch Usage Routing (`BF-7`)**: Attaches `VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH)` on Android 13+ (API 33+) and `AudioAttributes.USAGE_ASSISTANCE_SONIFICATION` on API 26--32, plus `HapticFeedbackConstants.FLAG_IGNORE_VIEW_SETTING` on view fallbacks, so Pixel linear resonant actuators (LRAs) never mute game haptics under notification rules.
- **`getSafeAreaInsets(): String`**: Synchronously returns `{"top":...,"bottom":...,"left":...,"right":...}` in CSS pixels.
- **`setModalOpen(isOpen: Boolean)`**: Updates `isModalOpen` and toggles `backPressedCallback.isEnabled` on the UI thread.
- **`saveBackup(key: String, data: String): Boolean`**: Writes UTF-8 JSON snapshot backups to `filesDir/capy_saves/<sanitized_key>.json` via `saveBackupToDir` (writing to `<sanitized_key>.json.tmp`, flushing and `fd.sync()`ing the `FileOutputStream`, and atomically replacing `<sanitized_key>.json` via `Files.move(..., REPLACE_EXISTING, ATOMIC_MOVE)` with fallback move/rename and `.tmp` cleanup on failure).
- **`loadBackup(key: String): String?`**: Reads UTF-8 JSON backup data from `filesDir/capy_saves/<sanitized_key>.json`.
- **`saveCloudSnapshot(slotKey: String, payloadJson: String): Boolean`**: Writes CRDT cloud state to local cache `filesDir/capy_cloud/<sanitized_slotKey>.json` and invokes `onSaveCloudSnapshot(slotKey, payloadJson)` on `MainActivity` to commit the snapshot asynchronously via `PlayGames.getSnapshotsClient(activity)`.
- **`loadCloudSnapshot(slotKey: String): String?`**: Reads cached CRDT cloud state from `filesDir/capy_cloud/<sanitized_slotKey>.json` while `MainActivity` reconciles remote Play Games snapshots via `window.__capyReceiveCloudSnapshot`.
- **`saveCloudBinaryChunk(blobKey: String, chunkIndex: Int, totalChunks: Int, base64Chunk: String): Boolean`**: Atomically persists `<= 180 KB` raw (`<= 300,000` Base64 chars, up to `32` chunks / `3 MB` total) binary save parts to `filesDir/capy_cloud/<sanitized_blobKey>_part_<chunkIndex>.json`, prunes stale trailing chunk files on the final part, and forwards `<sanitized_blobKey>_part_<chunkIndex>` to `PlayGames.getSnapshotsClient(activity)`.
- **`loadCloudBinaryChunk(blobKey: String, chunkIndex: Int): String?`**: Synchronously reads cached Base64 binary chunk `<sanitized_blobKey>_part_<chunkIndex>` from `filesDir/capy_cloud/`.
- **`requestCloudSnapshotPull(slotKey: String): Boolean`**: Requests an on-demand asynchronous pull of `<sanitized_slotKey>` from `PlayGames.getSnapshotsClient(activity)` into `window.__capyReceiveCloudSnapshot` when a remote multi-chunk binary save has not yet been cached locally (returning `false` immediately when `isPlayGamesConfigured()` is `false`).
- **`isPlayGamesConfigured(): Boolean`**: Synchronously reports whether `@string/game_services_project_id` holds a real Play Console numeric Project ID (`isPlayGamesAppIdConfigured`), allowing `PlayGamesAndroidDriver` to fall back immediately when unconfigured or when native sign-in reports `window.__capyReceivePlayGamesError`.
- **`signInPlayGames(): String?`**: Triggers `onRequestPlayGamesSignIn` (`GamesSignInClient.signIn()` + `PlayersClient.currentPlayer`) and synchronously returns any cached `{"playerId":"...","displayName":"..."}` JSON from `capy_play_games_prefs`.
- **`showRewardedAd(): Boolean`**: Hook for strictly opt-in rewarded AI credit video ads; returns `false` when no ad SDK is bundled (100% ad-free core gameplay).
- **`consumePendingSharedImage(): String?`**: Atomically retrieves and clears any cold-start `Intent.ACTION_SEND` shared image JSON (`{"title":"...","dataUrl":"..."}`) queued before WebView hydration.
- **`consumePendingDeepLink(): String?`**: Atomically retrieves and clears any cold-start verified App Link URL (`#s=<token>` or `?room=<ROOM6>`).
- **`shareTextLink(title: String, url: String)`**: Launches Android's `Intent.ACTION_SEND` (`text/plain`) chooser for `< 2 KB` progress links and Co-op room invites.
- **`shareImage(title: String, dataUrl: String)`**: Resolves MIME type (`image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/svg+xml`) via `resolveShareImageSpec`, writes `cacheDir/shared/capy_shared_artwork.<ext>`, and opens Android's Share chooser via AndroidX `FileProvider`.
- **`shareFile(title: String, fileName: String, mimeType: String, base64Data: String)`**: Writes arbitrary binary or text exports (such as `.capy` v2 archives and images) into `cacheDir/shared/<sanitized_fileName>` via `prepareSharedExportFile` (pruning expired exports older than 24h) scoped strictly by [`file_paths.xml`](./app/src/main/res/xml/file_paths.xml) and opens Android's Share / Save chooser via `FileProvider`.
- **`getAppVersion(): String`**: Returns `BuildConfig.VERSION_NAME` (synchronized automatically from [`web/package.json`](./web/package.json) at Gradle configure time, failing loudly if missing or malformed).

---

## 3. Safe-Area Inset Architecture (Pixel 7 / Cutouts)

On modern edge-to-edge Android devices (Pixel 7, Galaxy S23/S24, punch-hole cutouts):
1. The Android window uses `enableEdgeToEdge(...)` with transparent status bar and dark navigation bar.
2. Android `WebView` does **not** reliably populate CSS `env(safe-area-inset-*)` on all OEM builds.
3. [`MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt) bridges exact physical insets (`systemBars`, `displayCutout`, and `ime`) into CSS custom properties (`--safe-area-top` ~48px, `--safe-area-bottom` ~24px+).
4. In [`web/src/index.css`](./web/src/index.css):
   ```css
   :root {
     --sat: max(env(safe-area-inset-top, 0px), var(--safe-area-top, 0px));
     --sab: max(env(safe-area-inset-bottom, 0px), var(--safe-area-bottom, 0px));
   }
   .safe-top {
     padding-top: max(0.75rem, calc(var(--sat) + 0.5rem));
   }
   .safe-bottom-raised {
     padding-bottom: max(1.5rem, calc(var(--sab) + 1.25rem));
   }
   ```
   - `.safe-top` keeps `GameTopBar` clear of status bar icons and camera cutouts.
   - `.safe-bottom-raised` floats `PaletteDock` comfortably above the system gesture pill and soft keyboard.

---

## 4. Build & Gradle Lifecycle

- **Web Bundle Compilation & Synchronization ([`app/build.gradle.kts`](./app/build.gradle.kts))**:
  - `:app:buildWeb`: Runs `npm run build` in `web/` with Gradle input/output caching across `web/src/`, `web/public/`, `web/package.json`, and Vite/TS configs.
  - `:app:syncWebAssets`: Validates `web/dist/index.html` (throwing an actionable `GradleException` if missing) and syncs `web/dist/` into `app/src/main/assets/www/` automatically before `preBuild`.
  - **Single-Source Versioning**: Parses `"version"` from `../web/package.json` at configuration time (throwing `GradleException` if missing/unparseable) to set `versionName` and `versionCode = (MAJOR * 10000) + (MINOR * 100) + PATCH`.
- **Auto Backup & Data Extraction Rules**: [`backup_rules.xml`](./app/src/main/res/xml/backup_rules.xml) and [`data_extraction_rules.xml`](./app/src/main/res/xml/data_extraction_rules.xml) preserve local `capy_saves/` while excluding ephemeral `capy_play_games_prefs.xml` and `capy_cloud/` caches.
- **R8 / ProGuard ([`app/proguard-rules.pro`](./app/proguard-rules.pro)) & Release Signing**:
  ```proguard
  -keepclassmembers class * {
      @android.webkit.JavascriptInterface <methods>;
  }
  -keepattributes JavascriptInterface
  -keep class com.capypaint.capy.CapyAndroidBridge { *; }
  ```
  - Release builds enable `isMinifyEnabled = true` and `isShrinkResources = true`.
  - [`.github/workflows/release.yml`](./.github/workflows/release.yml) requires `CAPY_KEYSTORE_BASE64`, `CAPY_KEYSTORE_PASSWORD`, `CAPY_KEY_ALIAS`, and `CAPY_KEY_PASSWORD` for tagged release builds and runs `./gradlew app:testDebugUnitTest app:lintVitalRelease app:assembleRelease app:bundleRelease` (failing loudly rather than substituting unsigned/debug binaries).
  - Privacy Policy and Data Safety disclosures live at `https://capypaint.com/privacy-policy.html` ([`web/public/privacy-policy.html`](./web/public/privacy-policy.html)).

---

## 5. Build, Test & Run Commands

```bash
# Build web frontend bundle (via npm or Gradle)
cd web && npm ci && npm run build
# OR directly via Gradle:
./gradlew app:buildWeb

# Run JUnit4 unit tests for the Android launcher
./gradlew app:testDebugUnitTest

# Build Debug APK (outputs to app/build/outputs/apk/debug/app-debug.apk)
./gradlew app:assembleDebug

# Build signed Play Store Release AAB (when CAPY_KEYSTORE_* env vars are set; automated on v*.*.* tags via .github/workflows/release.yml)
./gradlew app:bundleRelease

# Deploy to connected USB/Wi-Fi Android device (ONLY run when explicitly asked by user)
./gradlew app:installDebug
```

---

## 6. Android Studio & Local Debugging

### Opening the Project in Android Studio
1. Open Android Studio and select **Open** (`File > Open...`).
2. Select the **monorepo root directory** (`/path/to/capy`), **not** the `/app` subdirectory.
   - [`settings.gradle.kts`](./settings.gradle.kts) registers the unified `:app` module.
3. Gradle Sync configures **JDK 17** and Android SDK **API 37** (`compileSdk = 37`, `minSdk = 24`, `targetSdk = 36`).

### Running & Debugging Locally
1. Select the **`app`** run configuration and a **Pixel 7 (API 34/35/36)** emulator or USB-connected Android device.
2. Run `./gradlew app:buildWeb` first if `web/dist/` has not been built yet, then click **Run** (`Shift+F10`) or **Debug 'app'** (`Shift+F9`).
3. **Native Kotlin Debugging**: Set breakpoints in [`MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt) or [`CapyAndroidBridge.kt`](./app/src/main/java/com/capypaint/capy/CapyAndroidBridge.kt) to inspect incoming share intents, window insets, modal back-press states, Play Games `SnapshotsClient` sync, and internal disk backup reads/writes.
4. **WebView Chrome DevTools**: Debug builds enable `WebView.setWebContentsDebuggingEnabled(true)`. Open `chrome://inspect/#devices` in desktop Chrome/Edge and click **Inspect** under `com.capypaint.capy` to inspect live console logs, DOM/`--sat`/`--sab` CSS variables, Web Worker threads, and `https://appassets.androidplatform.net/assets/www/*` asset loads.
5. **Logcat Filtering**:
   - `tag:CapyApp`: Activity lifecycle, forwarded `[WebView:filename:line]` JS console output, `ACTION_SEND` background image downsampling, and Play Games sign-in/snapshot events.
   - `tag:CapyBridge`: Haptic dispatch (`haptic`), safe-area insets, modal state (`setModalOpen`), disk backup reads/writes (`saveBackup`, `loadBackup`), and `FileProvider` share intents.
   ```bash
   adb logcat -c && adb logcat -s CapyApp:V CapyBridge:V
   ```
