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
- **Native Photo Picker Contract** (`ActivityResultContracts.PickVisualMedia()`)
- **OS Share Sheet & Incoming Share Intents** (`Intent.ACTION_SEND` with `image/*`)
- **Persistent Disk Backups** (mirroring saves to `filesDir/capy_saves/`)

---

## 2. Component Reference

### [`MainActivity.kt`](../app/src/main/java/com/capypaint/capy/MainActivity.kt)
Extends `androidx.activity.ComponentActivity` with edge-to-edge window decor (`WindowCompat.setDecorFitsSystemWindows(window, false)`).
- **`WebViewAssetLoader`**: Resolves local assets at `https://appassets.androidplatform.net/assets/www/index.html`. This ensures ES module imports, Web Workers, and Fetch APIs run seamlessly within an offline HTTPS security origin without `file://` CORS restrictions.
- **`OnApplyWindowInsetsListener`**: Intercepts `WindowInsetsCompat.Type.systemBars() or displayCutout()`. Computes CSS pixel equivalents (`px / density`) and injects `--safe-area-top`, `--safe-area-bottom`, `--safe-area-left`, and `--safe-area-right` into `document.documentElement.style`. Also queries fallback dimension resources (`status_bar_height`, `navigation_bar_height`) on `onCreate` to prevent frame-0 layout shifts.
- **`OnBackPressedCallback`**: Cooperates with `bridge.isModalOpen`. When the player opens Settings or other sheets, the callback is enabled; pressing system back evaluates `window.__capyCloseModal && window.__capyCloseModal()` in the WebView rather than terminating the app.
- **`PickVisualMedia` Launcher**: Intercepts `WebChromeClient.onShowFileChooser` and delegates file picking to Android's modern photo picker contract.
- **Share Intent Receiver**: Extracts `Intent.EXTRA_STREAM` from incoming `Intent.ACTION_SEND` (`image/*`) intents in `onCreate` and `onNewIntent`, converting images to data URLs delivered to `window.__capyReceiveSharedImage`.

### [`CapyAndroidBridge.kt`](../app/src/main/java/com/capypaint/capy/CapyAndroidBridge.kt)
Class registered via `webView.addJavascriptInterface(bridge, "CapyAndroid")`.
- `@JavascriptInterface fun haptic(type: String)`: Dispatches tactile haptics:
  - `"tick"`: `HapticFeedbackConstants.CLOCK_TICK` via `view.performHapticFeedback()`
  - `"success"`: Custom 4-pulse waveform (`[0, 14, 45, 24]`)
  - `"warning"`: One-shot 18ms pulse
  - `"error"`: Double-pulse waveform (`[0, 28, 50, 28]`)
- `@JavascriptInterface fun getSafeAreaInsets(): String`: Returns `{"top":...,"bottom":...,"left":...,"right":...}` for immediate synchronous retrieval by [`NativeBridge.ts`](../web/src/services/NativeBridge.ts).
- `@JavascriptInterface fun setModalOpen(isOpen: Boolean)`: Updates `isModalOpen` and toggles `backPressedCallback.isEnabled`.
- `@JavascriptInterface fun saveBackup(key: String, data: String): Boolean`: Writes UTF-8 JSON data atomically to `filesDir/capy_saves/<sanitized_key>.json`.
- `@JavascriptInterface fun loadBackup(key: String): String?`: Reads backup data from `filesDir/capy_saves/<sanitized_key>.json`.
- `@JavascriptInterface fun shareImage(title: String, dataUrl: String)`: Decodes base64 data, caches `capy_shared_artwork.png` in `context.cacheDir`, and fires `Intent.createChooser` via AndroidX `FileProvider`.

---

## 3. Safe-Area Inset Architecture (Pixel 7 / Cutouts)

On modern edge-to-edge Android devices (e.g. Pixel 7, Galaxy S23, cutouts/punch-holes):
1. Android window is configured with transparent status and navigation bars.
2. Android `WebView` does **not** automatically respect view padding or populate CSS `env(safe-area-inset-*)`.
3. `MainActivity.kt` bridges the exact physical insets into CSS custom properties:
   - `--safe-area-top`: ~48px (status bar + camera cutout)
   - `--safe-area-bottom`: ~24px (gesture navigation pill)
4. In [`web/src/index.css`](../web/src/index.css):
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

- **Asset Synchronization**: [`app/build.gradle.kts`](../app/build.gradle.kts) defines:
  ```kotlin
  val syncWebAssets by tasks.registering(Sync::class) {
      from(layout.projectDirectory.dir("../web/dist")) {
          exclude("**/capy.png")
      }
      into(layout.projectDirectory.dir("src/main/assets/www"))
  }
  tasks.named("preBuild") {
      dependsOn(syncWebAssets)
  }
  ```
  Whenever `app` is built, the compiled assets in `web/dist/` are automatically synchronized into `src/main/assets/www/` before compilation.
- **R8 / ProGuard (`app/proguard-rules.pro`)**:
  ```proguard
  -keepclassmembers class * {
      @android.webkit.JavascriptInterface <methods>;
  }
  -keepattributes JavascriptInterface
  -keep class com.capypaint.capy.CapyAndroidBridge { *; }
  ```
  Ensures bridge methods and parameter signatures are preserved under R8 optimization.

---

## 5. Build, Test & Run Commands

```bash
# Run unit tests for the Android launcher
./gradlew app:testDebugUnitTest

# Build Debug APK (outputs to app/build/outputs/apk/debug/app-debug.apk)
./gradlew app:assembleDebug

# Deploy to connected USB/Wi-Fi Android device (ONLY run when explicitly asked by user)
./gradlew app:installDebug
```
