# Technical Architecture: Capy Android Unified Launcher (`APP.md`)

This document details the architecture, `@JavascriptInterface` native-to-web bridge, Google Play Games Services v2 `SnapshotsClient` integration, safe-area inset handling, and Gradle build lifecycle for the native Android launcher in [`app/`](./app/) (`com.capyboop.paint`, `:app` in Gradle).

**Related Guides**: [`README.md`](./README.md) | [`ROADMAP.md`](./ROADMAP.md) | [`DEV.md`](./DEV.md) | [`AGENTS.md`](./AGENTS.md) | [`WEB.md`](./WEB.md) | [`PUZZLE.md`](./PUZZLE.md) | [`CLOUD.md`](./CLOUD.md) | [`TESTING.md`](./TESTING.md) | [`CHANGELOG.md`](./CHANGELOG.md)

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
- **Android TV Leanback Launcher & Banner Support** (`android.intent.category.LEANBACK_LAUNCHER`, optional `android.hardware.touchscreen` & `android.software.leanback` `required="false"` declarations, and `320x180` [`tv_banner.png`](./app/src/main/res/drawable-xhdpi/tv_banner.png) referenced via `android:banner="@drawable/tv_banner"` in [`AndroidManifest.xml`](./app/src/main/AndroidManifest.xml) so phones, tablets, and Android TVs share one APK)
- **Network Capability** (`android.permission.INTERNET` declared in [`AndroidManifest.xml`](./app/src/main/AndroidManifest.xml) for cloud sync, co-op rooms, and remote URLs)

---

## 2. Component & `@JavascriptInterface` Reference

### [`MainActivity.kt`](./app/src/main/java/com/capyboop/paint/MainActivity.kt)
Extends `androidx.activity.ComponentActivity` using `enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT), navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT))`.
- **`WebViewAssetLoader`, Origin Guard & Document Blocking**:
  - Resolves local assets at `https://appassets.androidplatform.net/assets/www/index.html` with `safeBrowsingEnabled = true`, `allowFileAccess = false`, and `allowContentAccess = false`.
  - Tracks trusted page loads via `isTrustedPageLoaded` (`CapyAndroidBridge.isTrustedPageUrl`) and passes `originGuard = { isTrustedPageLoaded }` to `CapyAndroidBridge` so every `@JavascriptInterface` call, `evaluateOnTrustedPage` script execution, and `WebViewCompat.addWebMessageListener` (`CapyAndroidChannel`) frame message stays strictly gated to `appassets.androidplatform.net`.
  - In `shouldInterceptRequest`, `shouldBlockDocumentRequest` blocks untrusted `file:`/`content:` schemes and untrusted main-frame or iframe document requests (`403`).
  - In `shouldOverrideUrlLoading`, `classifyWebViewNavigation` permits only `appassets.androidplatform.net` and `about:blank` inside the WebView, blocks unsafe schemes (`javascript:`, `file:`, `content:`), and routes external `http`/`https` links (such as the Privacy Policy) to `openExternalBrowserUrl`—explicitly resolving an external browser package excluding `packageName` via `PackageManager.queryIntentActivities` + `<queries>` in [`AndroidManifest.xml`](./app/src/main/AndroidManifest.xml) so `autoVerify` App Links never loop back into `MainActivity`.
- **`OnApplyWindowInsetsListener` & IME Insets**: Intercepts `WindowInsetsCompat.Type.systemBars() or displayCutout() or ime()`, converts physical pixels (`px / density`), and injects `--safe-area-top`, `--safe-area-bottom`, `--safe-area-left`, and `--safe-area-right` into `document.documentElement.style` (returning `windowInsets` unconsumed so Chromium adjusts focused inputs smoothly when the soft keyboard opens, alongside fallback `status_bar_height` / `navigation_bar_height` queries during `onCreate`).
- **System Back & State Restoration (`OnBackPressedCallback` + `onSaveInstanceState`)**: Tracks both `bridge.isModalOpen` and `webView.canGoBack()` via `updateBackCallbackState()` (updated in `doUpdateVisitedHistory`, `onPageFinished`, and modal changes), resets modal state in `onPageStarted`, and preserves WebView state across Activity recreation via `onSaveInstanceState` / `restoreState`.
- **Dual File Chooser Routing (`PickVisualMedia` & `OpenDocument`)**: Intercepts `WebChromeClient.onShowFileChooser` and checks `CapyAndroidBridge.shouldUsePhotoPicker(acceptTypes)`—routing `image/*` uploads to Android's system `PickVisualMedia` picker and `.capy`/`.json` imports to SAF `OpenDocument`.
- **Incoming Share Intents, Verified App Links & Google Play Games Services v2**:
  - `Intent.ACTION_SEND` (`image/*`): Extracts `Intent.EXTRA_STREAM` in `onCreate` and `onNewIntent`, enforces `content://`-only schemes (`isAllowedIncomingShareUriScheme`), offloads decoding onto `shareDecodeExecutor`, validates header magic bytes (`PNG`, `JPEG`, `GIF`, `WebP`, `BMP`, `HEIF`/`AVIF`), subsamples to `<= 2048px`, and buffers payloads safely for cold-start hydration in [`NativeBridge.ts`](./web/src/services/NativeBridge.ts). When returning a generated image from Google's Gemini app during Free Guided Gemini App Handoff (`GuidedGeminiHandoffModal.tsx`), the incoming `ACTION_SEND` payload is intercepted cleanly at the top of the LIFO `NativeBridge.pushSharedImageInterceptor` stack without creating an unrelated new puzzle snapshot.
  - `Intent.ACTION_VIEW` (verified App Links): Uses a dedicated `android:autoVerify="${appLinksAutoVerify}"` filter strictly for direct-200 `capypaint.com` and `paint.capyboop.com` hosts (enabled automatically by [`app/build.gradle.kts`](./app/build.gradle.kts) when `CAPY_ANDROID_SHA256_CERT_FINGERPRINTS` is configured), plus a non-`autoVerify` fallback filter for `www.capypaint.com` and GitHub Pages. `isAllowedCapyDeepLink` rejects userinfo spoofs, non-standard ports, and `/privacy-policy.html`, forwarding `#s=<token>` and `?room=<ROOM6>` links to `window.__capyReceiveDeepLink`.
  - **Google Play Games Services v2 (`play-services-games-v2:22.1.0`) & Off-UI-Thread `SnapshotsClient`**:
    - [`AndroidManifest.xml`](./app/src/main/AndroidManifest.xml) sets `SUPPRESS_GAME_PROFILE_CREATION="true"`; `MainActivity` only calls `PlayGamesSdk.initialize(this)` in `onCreate()` when `@string/game_services_project_id` (`CAPY_PLAY_GAMES_APP_ID`) is configured—never prompting sign-in or pulling snapshots on cold start.
    - Explicit `CapyAndroid.signInPlayGames()` calls run `GamesSignInClient.signIn()` + `PlayersClient.currentPlayer`, cache `{ playerId, displayName }` in `capy_play_games_prefs`, and push profile/error events back to the WebView.
    - All snapshot disk and fsync I/O runs off the UI thread on a dedicated single-thread `playGamesIoExecutor` (shut down cleanly in `onDestroy()` with `!isDestroyed && !isFinishing` guards before `runOnUiThread` dispatch).
    - Non-blob JSON slots use `RESOLUTION_POLICY_MANUAL` with read-before-write CRDT checks (`decideSnapshotPushAction`); immutable `pgblob_*` binary chunks use `RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED`. See [`CLOUD.md`](./CLOUD.md) for the full cross-device CRDT sync protocol.
    - Android WebView stays strictly on Play Games v2 for Google auth (never falling back to web GIS popups) and hides browser APK cards, `release-channel-card`, and web-only Fullscreen buttons via `!NativeBridge.isAndroid`.
- **Foreground / Background WebView Lifecycle Guard (`onPause` / `onResume` / `onDestroy`)**: `MainActivity` overrides `onPause()` (`webView?.onPause()`) and `onResume()` (`webView?.onResume()`) alongside `onDestroy()` (`shareDecodeExecutor.shutdownNow()`, `playGamesIoExecutor.shutdownNow()`, `webView?.destroy()`) so WebView rendering, `requestAnimationFrame` loops, and Web Audio suspend cleanly when backgrounded.

### [`CapyAndroidBridge.kt`](./app/src/main/java/com/capyboop/paint/CapyAndroidBridge.kt) & Internal Delegates
Registered via `webView.addJavascriptInterface(bridge, "CapyAndroid")` with `originGuard = { isTrustedPageLoaded }`. `WebViewAssetLoader` responses attach strict `Content-Security-Policy` (`WEBVIEW_CONTENT_SECURITY_POLICY` permits `https://generativelanguage.googleapis.com`, `https://openrouter.ai`, `https://api.openai.com`, and `https://api.x.ai` in `connect-src` for optional client-direct AI BYOK/OpenRouter requests while strictly excluding `https://js.puter.com/v2/` and `*.puter.com` across `script-src`, `img-src`, `connect-src`, and `frame-src` to uphold Google Play's zero-remote-JS policy), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `X-Frame-Options` headers, and bridge callbacks pass escaped JSON literals through `JSON.parse`. Strict `19`-method `@JavascriptInterface` <-> `CapyAndroidInterface` parity is enforced by `npm run test:sanity` (with `showRewardedAd` permanently removed).

Subsystem logic is delegated to four package-internal classes while keeping the `CapyAndroid` JS surface and `CapyAndroidBridge.Companion` helpers 100% backward-compatible:
- [`BackupStorageDelegate.kt`](./app/src/main/java/com/capyboop/paint/BackupStorageDelegate.kt): Local backup storage (`filesDir/capy_saves/`), key/filename sanitization, containment checks, and atomic fsync replacement.
- [`PlayGamesSnapshotDelegate.kt`](./app/src/main/java/com/capyboop/paint/PlayGamesSnapshotDelegate.kt): Play Games local cloud cache (`filesDir/capy_cloud/`), multi-chunk binary parts (`<= 180 KB` raw, up to `32` chunks / `3 MB`), `capy_play_games_prefs` profile cache, and CRDT push conflict decisions.
- [`ShareExportDelegate.kt`](./app/src/main/java/com/capyboop/paint/ShareExportDelegate.kt): Outgoing `FileProvider` share/export intents with collision-free filenames and `ClipData.newRawUri` URI grants, plus incoming `ACTION_SEND` `content://` scheme and image magic-byte validation (`<= 2048px`, `<= 4 MB` raw).
- [`HapticsDelegate.kt`](./app/src/main/java/com/capyboop/paint/HapticsDelegate.kt): Tactile `HapticSpec` resolution and API-level hardware vibration dispatch (`VibrationAttributes.USAGE_TOUCH` on API 33+).

Pure testable helper constants and validators on `CapyAndroidBridge.Companion` (verified by `CapyAndroidBridgeTest.kt`) cover four areas:
- **Security & Navigation**: CSP header builders (`WEBVIEW_CONTENT_SECURITY_POLICY`, `WEBVIEW_PRIVACY_POLICY_CSP`), trusted-origin checks, document request blocking, WebView navigation classification, and OAuth/deep-link/share URL allowlists.
- **Image & Export Validation**: Incoming share scheme/magic-byte validation, subsampling/target dimension math (`MAX_SHARED_IMAGE_DIMENSION = 2048`), export MIME allowlisting, share-title/JSON escaping, and collision-free cache file preparation.
- **Atomic File & Cloud Binary I/O**: API 26+ atomic NIO moves (`shouldUseAtomicNioMove`), chunked cloud binary save/load helpers (`DEFAULT_CLOUD_BINARY_CHUNK_BYTES = 180_000`, `MAX_CLOUD_BINARY_CHUNKS = 32`, `MAX_CLOUD_BINARY_TOTAL_BYTES = 3 MiB`), and CRDT push conflict decisions (`decideSnapshotPushAction`).
- **Build & Runtime Config**: Play Games App ID validation (`isPlayGamesAppIdConfigured`), App Links fingerprint verification (`isAppLinksCertConfigured`), and haptic waveform specs (`resolveHapticSpec`).

All `19` `@JavascriptInterface` methods exposed on `window.CapyAndroid`:
- **`haptic(type: String)`**: Resolves tactile parameters via `resolveHapticSpec(type)` and dispatches hardware haptics across Android API levels:
  - `"tick"`: `EFFECT_TICK` (API 29+) / `CLOCK_TICK` / 10ms pulse.
  - `"success"`: Custom 4-step waveform (`[0, 14, 45, 24]`).
  - `"warning"`: `EFFECT_HEAVY_CLICK` (API 29+) / direct `vibrateOneShot(18L)` fallback on older APIs.
  - `"error"`: Custom double-pulse waveform (`[0, 28, 50, 28]`).
  - Default (`"click"`): `EFFECT_CLICK` (API 29+) / `KEYBOARD_TAP` / 12ms pulse.
  - **API 33+ Touch Usage Routing**: Attaches `VibrationAttributes.USAGE_TOUCH` on Android 13+ (API 33+) and `AudioAttributes.USAGE_ASSISTANCE_SONIFICATION` on API 26--32, plus `FLAG_IGNORE_VIEW_SETTING` on view fallbacks, so Pixel linear resonant actuators never mute game haptics under notification rules.
- **`getSafeAreaInsets(): String`**: Synchronously returns `{"top":...,"bottom":...,"left":...,"right":...}` in CSS pixels.
- **`setModalOpen(isOpen: Boolean)`**: Updates `isModalOpen` and toggles `backPressedCallback.isEnabled` on the UI thread.
- **`saveBackup(key: String, data: String): Boolean`**: Writes UTF-8 JSON snapshot backups (`<= MAX_BACKUP_PAYLOAD_CHARS`) to `filesDir/capy_saves/<sanitized_key>.json` under `synchronized(FILE_IO_LOCK)` using `isInsideDirectory` containment checks, `File.createTempFile`, `fd.sync()`, and atomic replacement (`Files.move(..., REPLACE_EXISTING, ATOMIC_MOVE)` on API 26+ with fallback on API 24/25).
- **`loadBackup(key: String): String?`**: Reads UTF-8 JSON backup data from `filesDir/capy_saves/<sanitized_key>.json` under `synchronized(FILE_IO_LOCK)` after verifying `isInsideDirectory`.
- **`saveCloudSnapshot(slotKey: String, payloadJson: String): Boolean`**: Writes CRDT cloud state to `filesDir/capy_cloud/<sanitized_slotKey>.json` and commits asynchronously via `PlayGames.getSnapshotsClient(activity)`.
- **`loadCloudSnapshot(slotKey: String): String?`**: Reads cached CRDT cloud state from `filesDir/capy_cloud/<sanitized_slotKey>.json` while `MainActivity` reconciles remote Play Games snapshots via `window.__capyReceiveCloudSnapshot`.
- **`saveCloudBinaryChunk(blobKey: String, chunkIndex: Int, totalChunks: Int, base64Chunk: String): Boolean`**: Atomically persists `<= 180 KB` raw (`<= 300,000` Base64 chars, up to `32` chunks / `3 MB` total) binary save parts to `filesDir/capy_cloud/<sanitized_blobKey>_part_<chunkIndex>.json`, prunes stale trailing chunks on the final part, and forwards each part to `SnapshotsClient`.
- **`loadCloudBinaryChunk(blobKey: String, chunkIndex: Int): String?`**: Synchronously reads cached Base64 binary chunk `<sanitized_blobKey>_part_<chunkIndex>` from `filesDir/capy_cloud/`.
- **`requestCloudSnapshotPull(slotKey: String): Boolean`**: Requests an on-demand asynchronous pull of `<sanitized_slotKey>` from `SnapshotsClient` into `window.__capyReceiveCloudSnapshot` (or `window.__capyReceiveCloudSnapshotError` on failure), returning `false` immediately when Play Games is unconfigured.
- **`isPlayGamesConfigured(): Boolean`**: Synchronously reports whether `@string/game_services_project_id` holds a real Play Console numeric Project ID.
- **`signInPlayGames(): String?`**: Triggers `GamesSignInClient.signIn()` + `PlayersClient.currentPlayer` and synchronously returns any cached `{"playerId":"...","displayName":"..."}` JSON from `capy_play_games_prefs`.
- **`consumePendingSharedImage(): String?`**: Atomically retrieves and clears (`AtomicReference.getAndSet(null)`) any cold-start `Intent.ACTION_SEND` shared image JSON queued before WebView hydration.
- **`consumePendingDeepLink(): String?`**: Atomically retrieves and clears (`AtomicReference.getAndSet(null)`) any cold-start verified App Link URL (`#s=<token>` or `?room=<ROOM6>`).
- **`openExternalOAuth(authUrl: String): Boolean`**: Enforces `originGuard()` and strict `isAllowedExternalOAuthUrl` (`https://accounts.google.com`, `https://login.microsoftonline.com`, and `https://openrouter.ai` only) before launching `Intent.ACTION_VIEW` in the system browser for Google Drive, Microsoft OneDrive, or OpenRouter PKCE sign-in; `MainActivity` receives `capypaint://oauth/callback` and forwards it to `window.__capyReceiveOAuthCallback(...)`.
- **`shareTextLink(title: String, url: String)`**: Checks `originGuard()`, validates `url` via `isAllowedShareTextUrl` (`https://` hosts plus `http://localhost`/`http://127.0.0.1`, rejecting control chars and `userInfo`), and launches Android's `Intent.ACTION_SEND` (`text/plain`) chooser for `< 2 KB` progress links and Co-op room invites.
- **`shareImage(title: String, dataUrl: String)`**: Checks `originGuard()`, resolves the output filename (`capy_shared_artwork.<ext>`), MIME type (`image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/svg+xml`), and Base64 payload, then delegates to `shareFile`; also reused by Free Guided AI App Handoff (`NanoBananaService.launchGeminiHandoff`) to share prepared infill/outpaint templates into Gemini, ChatGPT, or Grok apps while keeping `19`-method bridge parity. Incoming `ACTION_SEND` validation (`isAllowedSharedImageDataUrl`) excludes `image/svg+xml`.
- **`shareFile(title: String, fileName: String, mimeType: String, base64Data: String)`**: Checks `originGuard()`, enforces payload size/MIME allowlists, writes exports (`.capy` v2 archives, `.svg`, images) to collision-free timestamped files under `cacheDir/shared/` (with 24-hour expiry pruning and strict [`file_paths.xml`](./app/src/main/res/xml/file_paths.xml) scoping), and opens Android's Share Sheet via `FileProvider` with `ClipData.newRawUri` and `FLAG_GRANT_READ_URI_PERMISSION`.
- **`getAppVersion(): String`**: Returns `BuildConfig.VERSION_NAME` (synchronized automatically from [`web/package.json`](./web/package.json) at Gradle configure time, failing loudly if missing or malformed).

---

## 3. Safe-Area Inset Architecture (Pixel 7 / Cutouts)

On modern edge-to-edge Android devices (Pixel 7, Galaxy S23/S24, punch-hole cutouts):
1. The Android window uses `enableEdgeToEdge(...)` with transparent status bar and dark navigation bar.
2. Android `WebView` does **not** reliably populate CSS `env(safe-area-inset-*)` on all OEM builds.
3. [`MainActivity.kt`](./app/src/main/java/com/capyboop/paint/MainActivity.kt) bridges exact physical insets (`systemBars`, `displayCutout`, and `ime`) into CSS custom properties (`--safe-area-top` ~48px, `--safe-area-bottom` ~24px+).
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

- **Toolchain & Dependency Pins ([`gradle/libs.versions.toml`](./gradle/libs.versions.toml), [`gradle/wrapper/gradle-wrapper.properties`](./gradle/wrapper/gradle-wrapper.properties))**:
  - Android Gradle Plugin `9.5.2`, Gradle Wrapper `9.9.2`, JDK `17`, `compileSdk = 37`, `minSdk = 24`, `targetSdk = 36`.
  - Explicitly pins `androidx.fragment:fragment-ktx:1.9.1` (overriding the older transitive Fragment pulled by `play-services-games-v2:22.1.0`), `androidx.core:core-ktx:1.19.1`, `androidx.activity:activity-ktx:1.9.3`, and `androidx.webkit:webkit:1.12.1`.
- **Web Bundle Compilation & Synchronization ([`app/build.gradle.kts`](./app/build.gradle.kts))**:
  - `:app:buildWeb`: Runs `npm run build` in `web/` with Gradle input/output caching across `web/src/`, `web/public/`, `web/package.json`, and Vite/TS configs.
  - `:app:syncWebAssets`: Validates `web/dist/index.html` (throwing an actionable `GradleException` if missing) and syncs `web/dist/` into `app/src/main/assets/www/` automatically before `preBuild`.
  - **Single-Source Versioning**: Parses `"version"` from `../web/package.json` at configuration time (throwing `GradleException` if missing/unparseable) to set `versionName` and `versionCode = (MAJOR * 10000) + (MINOR * 100) + PATCH`.
- **Auto Backup & Data Extraction Rules**: [`backup_rules.xml`](./app/src/main/res/xml/backup_rules.xml) and [`data_extraction_rules.xml`](./app/src/main/res/xml/data_extraction_rules.xml) explicitly allowlist `<include domain="file" path="capy_saves" />` (so `app_webview/` and arbitrary files are excluded by default) while explicitly retaining exclusions for `capy_play_games_prefs.xml` and `capy_cloud/`.
- **R8 / ProGuard ([`app/proguard-rules.pro`](./app/proguard-rules.pro)) & Release Signing**:
  ```proguard
  -keepclassmembers class * {
      @android.webkit.JavascriptInterface <methods>;
  }
  -keepattributes JavascriptInterface
  -keep class com.capyboop.paint.CapyAndroidBridge { *; }
  ```
  - Release builds enable `isMinifyEnabled = true` and `isShrinkResources = true`.
  - [`.github/workflows/release.yml`](./.github/workflows/release.yml) requires `CAPY_KEYSTORE_BASE64`, `CAPY_KEYSTORE_PASSWORD`, `CAPY_KEY_ALIAS`, and `CAPY_KEY_PASSWORD` for tagged release builds and runs `./gradlew app:testDebugUnitTest app:lintVitalRelease app:assembleRelease app:bundleRelease` (failing loudly rather than substituting unsigned/debug binaries).
  - Privacy Policy and Data Safety disclosures live at [capypaint.com/privacy-policy.html](https://capypaint.com/privacy-policy.html) ([`web/public/privacy-policy.html`](./web/public/privacy-policy.html)). Play Store icon, feature graphic, phone/tablet screenshots, and copy live in [`docs/play-store/`](./docs/play-store/) ([`PLAY_STORE_LISTING.md`](./docs/play-store/PLAY_STORE_LISTING.md))—upload Phone and Tablet form factors only and keep Android TV unchecked in Play Console until TV D-pad navigation ships post-launch.

---

## 5. Build, Test & Run Commands

```bash
# Build web frontend bundle (via npm or Gradle)
cd web && npm ci && npm run build
# OR directly via Gradle:
./gradlew app:buildWeb

# Run JUnit4 unit tests for the Android launcher (`CapyAndroidBridgeTest.kt` + `AndroidTvManifestAndBridgeTest.kt`)
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
3. **Native Kotlin Debugging**: Set breakpoints in [`MainActivity.kt`](./app/src/main/java/com/capyboop/paint/MainActivity.kt) or [`CapyAndroidBridge.kt`](./app/src/main/java/com/capyboop/paint/CapyAndroidBridge.kt) to inspect incoming share intents, window insets, modal back-press states, Play Games `SnapshotsClient` sync, and internal disk backup reads/writes.
4. **WebView Chrome DevTools**: Debug builds enable `WebView.setWebContentsDebuggingEnabled(true)`. Open `chrome://inspect/#devices` in desktop Chrome/Edge and click **Inspect** under `com.capyboop.paint` to inspect live console logs, DOM/`--sat`/`--sab` CSS variables, Web Worker threads, and `https://appassets.androidplatform.net/assets/www/*` asset loads.
5. **Logcat Filtering**:
   - `tag:CapyApp`: Activity lifecycle, forwarded `[WebView:filename:line]` JS console output, `ACTION_SEND` background image downsampling, and Play Games sign-in/snapshot events.
   - `tag:CapyBridge`: Haptic dispatch (`haptic`), safe-area insets, modal state (`setModalOpen`), disk backup reads/writes (`saveBackup`, `loadBackup`), and `FileProvider` share intents.
   ```bash
   adb logcat -c && adb logcat -s CapyApp:V CapyBridge:V
   ```
