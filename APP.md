# Technical Architecture: Capy Android Unified Launcher (`app/`)

This document details the architecture, native-to-web bridge, lifecycle management, safe-area inset handling, and storage specifications for the native Android launcher in `app/` (`com.capypaint.capy`, `:app` in Gradle).

---

## 1. Overview & Strategy

The Android application in `app/` is a lightweight, zero-overhead native Android launcher that hosts the single-source-of-truth TypeScript/React game engine from `web/dist/`. 

Instead of maintaining a separate duplicate implementation of the vector quantization, segmentation, and rendering engine in Kotlin, all gameplay, Web Worker generation, and palette algorithms are written once in `web/` and compiled into `web/dist/`. The Android native launcher takes responsibility exclusively for OS-specific tasks:
- **Offline HTTPS Asset Serving** via `WebViewAssetLoader`
- **Native Hardware Haptic Feedback** (`Vibrator` / `HapticFeedbackConstants`)
- **System Safe Area & Cutout Inset Bridge** (`WindowInsetsCompat` -> CSS custom properties)
- **Predictive System Back Navigation** (`OnBackPressedCallback` to dismiss open web modals)
- **Native Photo Picker & SAF Document Chooser** (`PickVisualMedia` for images, `OpenDocument` for `.capy`/`.json` saves)
- **OS Share Sheet & Incoming Share Intents** (`Intent.ACTION_SEND` with `image/*` and binary `.capy` exports)
- **Persistent Disk Backups** (mirroring saves to `filesDir/capy_saves/`)
- **Network Capability** (`android.permission.INTERNET` declared in `AndroidManifest.xml` for cloud catalog, co-op sync, and remote image URLs)

---

## 2. Component Reference

### [`MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt)
Extends `androidx.activity.ComponentActivity` with edge-to-edge window decor (`WindowCompat.setDecorFitsSystemWindows(window, false)`).
- **`WebViewAssetLoader`**: Resolves local assets at `https://appassets.androidplatform.net/assets/www/index.html`. This ensures ES module imports, Web Workers, and Fetch APIs run seamlessly within an offline HTTPS security origin without `file://` CORS restrictions.
- **`OnApplyWindowInsetsListener`**: Intercepts `WindowInsetsCompat.Type.systemBars() or displayCutout()`. Computes CSS pixel equivalents (`px / density`) and injects `--safe-area-top`, `--safe-area-bottom`, `--safe-area-left`, and `--safe-area-right` into `document.documentElement.style`. Also queries fallback dimension resources (`status_bar_height`, `navigation_bar_height`) on `onCreate` to prevent frame-0 layout shifts.
- **`OnBackPressedCallback`**: Cooperates with `bridge.isModalOpen` (backed by a LIFO overlay stack in `NativeBridge.ts`). When the player opens Settings or nested popovers, the callback is enabled; pressing system back evaluates `window.__capyCloseModal && window.__capyCloseModal()` in the WebView rather than terminating the app.
- **Dual File Chooser Routing (`PickVisualMedia` & `OpenDocument`)**: Intercepts `WebChromeClient.onShowFileChooser` and inspects `fileChooserParams.acceptTypes` via `CapyAndroidBridge.shouldUsePhotoPicker(acceptTypes)`. Image uploads (`image/*`) open Android's modern `PickVisualMedia` photo picker, whereas save imports (`.capy`, `.json`, `application/octet-stream`) open Android Storage Access Framework `ActivityResultContracts.OpenDocument`.
- **Share & Verified App Link Intent Receiver**:
  - `Intent.ACTION_SEND` (`image/*`): Extracts `Intent.EXTRA_STREAM` in `onCreate` and `onNewIntent`, converting images to data URLs delivered to `window.__capyReceiveSharedImage`.
  - `Intent.ACTION_VIEW` (`https://shthed.github.io/capy...` with `android:autoVerify="true"` in [`AndroidManifest.xml`](./app/src/main/AndroidManifest.xml)): Validates incoming HTTPS App Links via `CapyAndroidBridge.isAllowedCapyDeepLink` and forwards verified `#s=<token>` and `?room=<ROOM6>` deep links to `window.__capyReceiveDeepLink`.

### [`CapyAndroidBridge.kt`](./app/src/main/java/com/capypaint/capy/CapyAndroidBridge.kt)
Class registered via `webView.addJavascriptInterface(bridge, "CapyAndroid")`.
- `@JavascriptInterface fun haptic(type: String)`: Dispatches tactile haptics:
  - `"tick"`: `HapticFeedbackConstants.CLOCK_TICK` via `view.performHapticFeedback()`
  - `"success"`: Custom 4-pulse waveform (`[0, 14, 45, 24]`)
  - `"warning"`: One-shot 18ms pulse
  - `"error"`: Double-pulse waveform (`[0, 28, 50, 28]`)
- `@JavascriptInterface fun getSafeAreaInsets(): String`: Returns `{"top":...,"bottom":...,"left":...,"right":...}` for immediate synchronous retrieval by [`NativeBridge.ts`](./web/src/services/NativeBridge.ts).
- `@JavascriptInterface fun setModalOpen(isOpen: Boolean)`: Updates `isModalOpen` and toggles `backPressedCallback.isEnabled`.
- `@JavascriptInterface fun saveBackup(key: String, data: String): Boolean`: Writes UTF-8 JSON data atomically to `filesDir/capy_saves/<sanitized_key>.json`.
- `@JavascriptInterface fun loadBackup(key: String): String?`: Reads backup data from `filesDir/capy_saves/<sanitized_key>.json`.
- `@JavascriptInterface fun saveCloudSnapshot(slotKey: String, payloadJson: String): Boolean`: Persists CRDT `CloudSaveEnvelope` JSON payloads to `filesDir/capy_cloud/<sanitized_slotKey>.json` (ready for Google Play Games `SnapshotsClient` backing).
- `@JavascriptInterface fun loadCloudSnapshot(slotKey: String): String?`: Reads CRDT `CloudSaveEnvelope` JSON payloads from `filesDir/capy_cloud/<sanitized_slotKey>.json`.
- `@JavascriptInterface fun signInPlayGames(): String?`: Hook for Google Play Games Services v2 sign-in; returns `null` until a Play Console Game App ID is configured so [`ProviderRegistry.ts`](./web/src/services/providers/ProviderRegistry.ts) falls back cleanly to local profiles.
- `@JavascriptInterface fun showRewardedAd(): Boolean`: Hook for strictly opt-in rewarded AI credit ads; returns `false` when no ad SDK is bundled (100% ad-free gameplay).
- `@JavascriptInterface fun consumePendingDeepLink(): String?`: Atomically retrieves and clears any pending verified App Link URL captured during cold start.
- `@JavascriptInterface fun shareTextLink(title: String, url: String)`: Launches Android's `Intent.ACTION_SEND` (`text/plain`) chooser for sharing `< 2 KB` puzzle progress links and Co-op room invites.
- `@JavascriptInterface fun shareImage(title: String, dataUrl: String)`: Decodes base64 data, caches `capy_shared_artwork.png` in `context.cacheDir`, and fires `Intent.createChooser` via AndroidX `FileProvider`.
- `@JavascriptInterface fun shareFile(title: String, fileName: String, mimeType: String, base64Data: String)`: Decodes arbitrary binary or text exports (such as `.capy` v2 save files and PNG exports), writes them to `cacheDir/<sanitized_fileName>`, and launches Android's Share / Save chooser via `FileProvider`.

---

## 3. Safe-Area Inset Architecture (Pixel 7 / Cutouts)

On modern edge-to-edge Android devices (e.g. Pixel 7, Galaxy S23, cutouts/punch-holes):
1. Android window is configured with transparent status and navigation bars.
2. Android `WebView` does **not** automatically respect view padding or populate CSS `env(safe-area-inset-*)`.
3. `MainActivity.kt` bridges the exact physical insets into CSS custom properties:
   - `--safe-area-top`: ~48px (status bar + camera cutout)
   - `--safe-area-bottom`: ~24px (gesture navigation pill)
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
   - On Pixel 7, `.safe-top` evaluates to `56px`, keeping all top buttons (`GameTopBar`) comfortably below the status bar clock, Wi-Fi, and battery icons.
   - `.safe-bottom-raised` evaluates to `44px`, floating palette swatches safely above the white system gesture bar.

---

## 4. Build & Gradle Lifecycle

- **Web Bundle Compilation & Synchronization**: [`app/build.gradle.kts`](./app/build.gradle.kts) provides:
  - `:app:buildWeb`: An `Exec` task that invokes `npm run build` in `web/` with incremental caching tracking `web/src/`, `web/public/`, `package.json`, and config files.
  - `:app:syncWebAssets`: A `Sync` task that validates the presence of `web/dist/index.html` (throwing an actionable error if the frontend bundle hasn't been built yet) and synchronizes `web/dist/` into `src/main/assets/www/` before compilation.
  ```kotlin
  val syncWebAssets = tasks.register<Sync>("syncWebAssets") {
      val distIndex = layout.projectDirectory.file("../web/dist/index.html").asFile
      doFirst {
          if (!distIndex.exists()) {
              throw GradleException(
                  "Missing web frontend distribution bundle at '${distIndex.absolutePath}'.\n" +
                  "Before compiling the Android launcher, please build the web assets by running:\n" +
                  "  cd web && npm ci && npm run build\n" +
                  "or run the Gradle task ':app:buildWeb' (if Node.js / npm is installed)."
              )
          }
      }
      from(layout.projectDirectory.dir("../web/dist")) {
          exclude("**/capy.png")
      }
      into(layout.projectDirectory.dir("src/main/assets/www"))
  }
  tasks.named("preBuild") {
      dependsOn(syncWebAssets)
  }
  ```
  Whenever `:app` is compiled or tested, `web/dist/` is validated and synced into `src/main/assets/www/`.
- **R8 / ProGuard (`app/proguard-rules.pro`) & Release Signing (`app/build.gradle.kts`)**:
  ```proguard
  -keepclassmembers class * {
      @android.webkit.JavascriptInterface <methods>;
  }
  -keepattributes JavascriptInterface
  -keep class com.capypaint.capy.CapyAndroidBridge { *; }
  ```
  - Release builds enable R8 minification and resource shrinking (`isMinifyEnabled = true`, `isShrinkResources = true`).
  - When `CAPY_KEYSTORE_PATH`, `CAPY_KEYSTORE_PASSWORD`, `CAPY_KEY_ALIAS`, and `CAPY_KEY_PASSWORD` environment variables are set, `:app` automatically configures a `release` signing config for Google Play Store Android App Bundle (`:app:bundleRelease`) builds.
  - Play Store Data Safety and Privacy Policy declarations are published at `https://shthed.github.io/capy/privacy-policy.html` ([`web/public/privacy-policy.html`](./web/public/privacy-policy.html)).

---

## 5. Build, Test & Run Commands

```bash
# Build web frontend bundle (via npm or Gradle)
cd web && npm ci && npm run build
# OR directly via Gradle:
./gradlew app:buildWeb

# Run unit tests for the Android launcher
./gradlew app:testDebugUnitTest

# Build Debug APK (outputs to app/build/outputs/apk/debug/app-debug.apk)
./gradlew app:assembleDebug

# Build signed Play Store Release AAB (when CAPY_KEYSTORE_* env vars are set)
./gradlew app:bundleRelease

# Deploy to connected USB/Wi-Fi Android device (ONLY run when explicitly asked by user)
./gradlew app:installDebug
```

---

## 6. Android Studio & Local Debugging

### Opening the Project in Android Studio
1. Open Android Studio and select **Open** (or `File > Open...`).
2. Select the **monorepo root directory** (`/path/to/capy`), **NOT** the `/app` subdirectory.
   - Gradle discovers both `:app` (unified modern launcher) and `:app1` (legacy Jetpack Compose implementation).
3. Android Studio will automatically perform a Gradle Sync. The project specifies:
   - Gradle Daemon JVM / Toolchain: **JDK 17** (or compatible vendor toolchain resolved automatically via Foojay).
   - SDK: Android API 35 (`compileSdk = 35`, `minSdk = 24`, `targetSdk = 35`).

### Running the App Locally
1. In the top toolbar run configuration selector, choose **`app`**.
2. Select an Android emulator (recommended: **Pixel 7** running API 34 or 35) or a physical Android device connected with USB debugging.
3. Click the **Run** button (green play icon / `Shift+F10`).
   - If `web/dist` has not been generated yet, run `./gradlew app:buildWeb` or double-click `Tasks > build > buildWeb` in the Android Studio Gradle panel.

### Debugging the Native Kotlin Layer
- Set breakpoints in [`MainActivity.kt`](./app/src/main/java/com/capypaint/capy/MainActivity.kt) or [`CapyAndroidBridge.kt`](./app/src/main/java/com/capypaint/capy/CapyAndroidBridge.kt).
- Click **Debug 'app'** (green bug icon / `Shift+F9`).
- You can inspect incoming share intents, window insets, modal back-press states, and atomic disk backup reads/writes.

### Debugging the Frontend WebView (Chrome DevTools)
In debug builds (`BuildConfig.DEBUG == true`), `MainActivity` enables `WebView.setWebContentsDebuggingEnabled(true)`:
1. Launch the app in an emulator or physical device.
2. Open desktop Google Chrome (or Microsoft Edge) and navigate to:
   ```
   chrome://inspect/#devices
   ```
3. Locate `com.capypaint.capy` under **Remote Target** and click **Inspect**.
4. You get full Chrome Developer Tools inside the running Android WebView:
   - **Console**: View `console.log`, `console.warn`, and unhandled errors. Test bridge calls live (e.g. `CapyAndroid.getSafeAreaInsets()` or `CapyAndroid.haptic("tick")`).
   - **Elements**: Inspect live DOM tree, canvas nodes, and CSS variables (`--safe-area-top`, `--sat`, `--sab`).
   - **Sources**: Set breakpoints in TypeScript source code and Web Workers.
   - **Network**: Monitor offline `WebViewAssetLoader` asset resolutions (`https://appassets.androidplatform.net/assets/www/*`).

### Logging & Logcat Inspection
`MainActivity.kt` and `CapyAndroidBridge.kt` provide structured `android.util.Log` output and route JavaScript console messages into Android Studio's **Logcat** tool window:

1. **Web Console Forwarding**:
   - `WebChromeClient.onConsoleMessage` catches all `console.log()`, `console.warn()`, and `console.error()` calls from Vite, React 19, and TypeScript.
   - Messages appear formatted as `[WebView:filename:line] message` under `tag:CapyApp`.
2. **Logcat Tags**:
   - `tag:CapyApp`: Android Activity lifecycle events, WebView page finish/error events (`onReceivedError`), incoming share intent processing (`Intent.ACTION_SEND`), and photo picker launches.
   - `tag:CapyBridge`: Native bridge operations including haptic triggers (`haptic`), safe-area insets retrieval, modal state changes (`setModalOpen`), atomic disk backup writes/reads (`saveBackup`, `loadBackup`), and OS share chooser dispatch (`shareImage`).
3. **Recommended Logcat Query Filters**:
   - Filter all Capy logs: `package:com.capypaint.capy` or `package:mine`
   - Filter bridge and app logs only: `tag:CapyApp | tag:CapyBridge`
   - Filter web console errors: `tag:CapyApp level:error`
4. **Command Line Logcat (via adb)**:
   ```bash
   # Stream all Capy native and web logs
   adb logcat -s CapyApp:V CapyBridge:V

   # Clear Logcat buffer and start fresh
   adb logcat -c && adb logcat -s CapyApp:V CapyBridge:V
   ```
