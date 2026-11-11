package com.capypaint.capy

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import com.google.android.gms.games.PlayGames
import com.google.android.gms.games.PlayGamesSdk
import com.google.android.gms.games.SnapshotsClient
import com.google.android.gms.games.snapshot.SnapshotMetadataChange
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {

    private var webView: WebView? = null
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    private lateinit var bridge: CapyAndroidBridge
    private var isPageLoaded: Boolean = false
    private val shareDecodeExecutor = Executors.newSingleThreadExecutor()

    private val pickMediaLauncher = registerForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri: Uri? ->
        val callback = fileUploadCallback
        fileUploadCallback = null
        if (uri != null) {
            callback?.onReceiveValue(arrayOf(uri))
        } else {
            callback?.onReceiveValue(null)
        }
    }

    private val openDocumentLauncher = registerForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri: Uri? ->
        val callback = fileUploadCallback
        fileUploadCallback = null
        if (uri != null) {
            callback?.onReceiveValue(arrayOf(uri))
        } else {
            callback?.onReceiveValue(null)
        }
    }

    private val backPressedCallback = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() {
            val wv = webView
            if ((wv != null) && bridge.isModalOpen) {
                wv.evaluateJavascript("window.__capyCloseModal && window.__capyCloseModal();", null)
            } else {
                isEnabled = false
                onBackPressedDispatcher.onBackPressed()
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        WindowCompat.setDecorFitsSystemWindows(window, false)
        @Suppress("DEPRECATION")
        window.statusBarColor = Color.TRANSPARENT
        @Suppress("DEPRECATION")
        window.navigationBarColor = Color.BLACK

        onBackPressedDispatcher.addCallback(this, backPressedCallback)

        bridge = CapyAndroidBridge(
            context = applicationContext,
            rootViewProvider = { webView },
            onModalStateChanged = { isOpen ->
                runOnUiThread {
                    backPressedCallback.isEnabled = isOpen
                }
            },
            onRequestPlayGamesSignIn = {
                runOnUiThread {
                    requestPlayGamesSignIn()
                }
            },
            onSaveCloudSnapshot = { slotKey, payloadJson ->
                runOnUiThread {
                    pushSnapshotToPlayGames(slotKey, payloadJson)
                }
            },
        )

        initializePlayGamesIfConfigured()

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        val wv = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            setBackgroundColor(Color.BLACK)
            isHapticFeedbackEnabled = true
            overScrollMode = View.OVER_SCROLL_NEVER
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = false
                allowContentAccess = true
                mediaPlaybackRequiresUserGesture = false
                cacheMode = WebSettings.LOAD_DEFAULT
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
                textZoom = 100
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    safeBrowsingEnabled = false
                }
            }

            addJavascriptInterface(bridge, "CapyAndroid")

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest,
                ): WebResourceResponse? {
                    return assetLoader.shouldInterceptRequest(request.url)
                }

                override fun onPageFinished(view: WebView, url: String?) {
                    super.onPageFinished(view, url)
                    isPageLoaded = true
                    Log.d(TAG, "WebView page finished loading: $url")
                    applySafeAreaInsetsToWebView()
                    deliverPendingSharedImageIfNeeded()
                    deliverPendingDeepLinkIfNeeded()
                    deliverCachedPlayGamesProfileIfNeeded()
                }

                override fun onReceivedError(
                    view: WebView,
                    request: WebResourceRequest,
                    error: WebResourceError,
                ) {
                    super.onReceivedError(view, request, error)
                    Log.e(TAG, "WebView error loading ${request.url}: ${error.description} (code: ${error.errorCode})")
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                    if (BuildConfig.DEBUG && (consoleMessage != null)) {
                        val level = consoleMessage.messageLevel()
                        val text = "[WebView:${consoleMessage.sourceId()}:${consoleMessage.lineNumber()}] ${consoleMessage.message()}"
                        when (level) {
                            ConsoleMessage.MessageLevel.ERROR -> Log.e(TAG, text)
                            ConsoleMessage.MessageLevel.WARNING -> Log.w(TAG, text)
                            else -> Log.d(TAG, text)
                        }
                    }
                    return super.onConsoleMessage(consoleMessage)
                }

                override fun onShowFileChooser(
                    webView: WebView?,
                    filePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?,
                ): Boolean {
                    fileUploadCallback?.onReceiveValue(null)
                    fileUploadCallback = filePathCallback
                    return try {
                        if (CapyAndroidBridge.shouldUsePhotoPicker(fileChooserParams?.acceptTypes)) {
                            pickMediaLauncher.launch(
                                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                            )
                        } else {
                            openDocumentLauncher.launch(arrayOf("*/*"))
                        }
                        true
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to launch file picker", e)
                        fileUploadCallback = null
                        false
                    }
                }
            }
        }

        val density = resources.displayMetrics.density
        val defaultTop = (getStatusBarHeight() / density).toInt()
        val defaultBottom = (getNavigationBarHeight() / density).toInt()
        bridge.updateSafeAreaInsets(defaultTop, defaultBottom, 0, 0)

        ViewCompat.setOnApplyWindowInsetsListener(wv) { _, windowInsets ->
            val insets = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
            )
            val d = resources.displayMetrics.density
            val topCss = (insets.top / d).toInt()
            val bottomCss = (insets.bottom / d).toInt()
            val leftCss = (insets.left / d).toInt()
            val rightCss = (insets.right / d).toInt()

            bridge.updateSafeAreaInsets(topCss, bottomCss, leftCss, rightCss)
            applySafeAreaInsetsToWebView()
            WindowInsetsCompat.CONSUMED
        }

        webView = wv
        setContentView(wv)

        handleIncomingIntent(intent)
        wv.loadUrl(START_URL)
    }

    private fun applySafeAreaInsetsToWebView() {
        val wv = webView ?: return
        val topCss = bridge.safeAreaTopCss
        val bottomCss = bridge.safeAreaBottomCss
        val leftCss = bridge.safeAreaLeftCss
        val rightCss = bridge.safeAreaRightCss
        wv.post {
            wv.evaluateJavascript(
                """
                (function() {
                    try {
                        document.documentElement.style.setProperty('--safe-area-top', '${topCss}px');
                        document.documentElement.style.setProperty('--safe-area-bottom', '${bottomCss}px');
                        document.documentElement.style.setProperty('--safe-area-left', '${leftCss}px');
                        document.documentElement.style.setProperty('--safe-area-right', '${rightCss}px');
                    } catch (e) {}
                })();
                """.trimIndent(),
                null,
            )
        }
    }

    @SuppressLint("InternalInsetResource", "DiscouragedApi")
    private fun getStatusBarHeight(): Int {
        val resourceId = resources.getIdentifier("status_bar_height", "dimen", "android")
        return if (resourceId > 0) resources.getDimensionPixelSize(resourceId) else 0
    }

    @SuppressLint("InternalInsetResource", "DiscouragedApi")
    private fun getNavigationBarHeight(): Int {
        val resourceId = resources.getIdentifier("navigation_bar_height", "dimen", "android")
        return if (resourceId > 0) resources.getDimensionPixelSize(resourceId) else 0
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
    }

    private fun handleIncomingIntent(intent: Intent?) {
        if (intent == null) return

        if (intent.action == Intent.ACTION_VIEW) {
            val dataUri = intent.data?.toString()
            if (CapyAndroidBridge.isAllowedCapyDeepLink(dataUri) && (dataUri != null)) {
                Log.i(TAG, "Received verified Capy deep link: $dataUri")
                bridge.pendingDeepLinkUrl = dataUri
                if (isPageLoaded) {
                    deliverPendingDeepLinkIfNeeded()
                }
            } else if (!dataUri.isNullOrBlank()) {
                Log.w(TAG, "Ignored untrusted deep link URI: $dataUri")
            }
            return
        }

        if (intent.action != Intent.ACTION_SEND) return
        val type = intent.type ?: return
        if (!type.startsWith("image/")) return

        val imageUri: Uri? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(Intent.EXTRA_STREAM)
        }
        if (imageUri == null) return

        val title = imageUri.lastPathSegment?.substringAfterLast('/') ?: "Shared Photo"
        val appResolver = applicationContext.contentResolver
        shareDecodeExecutor.execute {
            try {
                val dataUrl = decodeAndDownsampleSharedImage(appResolver, imageUri, type) ?: return@execute
                runOnUiThread {
                    if (isDestroyed || isFinishing) return@runOnUiThread
                    bridge.pendingSharedImageJson = CapyAndroidBridge.formatSharedImageJson(title, dataUrl)
                    if (isPageLoaded) {
                        deliverPendingSharedImageIfNeeded()
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to resolve incoming share image URI: $imageUri", e)
            }
        }
    }

    private fun decodeAndDownsampleSharedImage(
        resolver: android.content.ContentResolver,
        imageUri: Uri,
        mimeType: String,
    ): String? {
        val boundsOptions = BitmapFactory.Options().apply {
            inJustDecodeBounds = true
        }
        resolver.openInputStream(imageUri)?.use { stream ->
            BitmapFactory.decodeStream(stream, null, boundsOptions)
        }

        val srcWidth = boundsOptions.outWidth
        val srcHeight = boundsOptions.outHeight
        if (srcWidth > 0 && srcHeight > 0) {
            val sampleSize = CapyAndroidBridge.calculateInSampleSize(
                srcWidth,
                srcHeight,
                CapyAndroidBridge.MAX_SHARED_IMAGE_DIMENSION,
            )
            val decodeOptions = BitmapFactory.Options().apply {
                inSampleSize = sampleSize
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }
            val decoded = resolver.openInputStream(imageUri)?.use { stream ->
                BitmapFactory.decodeStream(stream, null, decodeOptions)
            }
            if (decoded != null) {
                val (targetW, targetH) = CapyAndroidBridge.calculateTargetDimensions(
                    decoded.width,
                    decoded.height,
                    CapyAndroidBridge.MAX_SHARED_IMAGE_DIMENSION,
                )
                val finalBitmap = if (targetW != decoded.width || targetH != decoded.height) {
                    val scaled = Bitmap.createScaledBitmap(decoded, targetW, targetH, true)
                    if (scaled !== decoded) {
                        decoded.recycle()
                    }
                    scaled
                } else {
                    decoded
                }
                val isPngOrWebp = mimeType.contains("png", ignoreCase = true) ||
                    mimeType.contains("webp", ignoreCase = true)
                val outStream = ByteArrayOutputStream()
                val outMime = if (isPngOrWebp) {
                    finalBitmap.compress(Bitmap.CompressFormat.PNG, 100, outStream)
                    "image/png"
                } else {
                    finalBitmap.compress(Bitmap.CompressFormat.JPEG, 92, outStream)
                    "image/jpeg"
                }
                finalBitmap.recycle()
                val encodedBytes = outStream.toByteArray()
                val base64 = Base64.encodeToString(encodedBytes, Base64.NO_WRAP)
                Log.i(
                    TAG,
                    "Processed incoming shared image (${srcWidth}x${srcHeight} -> ${targetW}x${targetH}, ${encodedBytes.size} bytes)",
                )
                return "data:$outMime;base64,$base64"
            }
        }

        // Fallback for non-bitmap image streams (bounded to MAX_RAW_SHARED_IMAGE_BYTES to prevent OOM)
        val rawBytes = resolver.openInputStream(imageUri)?.use { stream ->
            readBoundedBytes(stream, CapyAndroidBridge.MAX_RAW_SHARED_IMAGE_BYTES)
        } ?: return null
        if (rawBytes.isEmpty()) return null
        val base64 = Base64.encodeToString(rawBytes, Base64.NO_WRAP)
        return "data:$mimeType;base64,$base64"
    }

    private fun readBoundedBytes(stream: InputStream, maxBytes: Int): ByteArray? {
        val buffer = ByteArrayOutputStream()
        val chunk = ByteArray(16 * 1024)
        var total = 0
        while (true) {
            val read = stream.read(chunk)
            if (read <= 0) break
            total += read
            if (total > maxBytes) {
                Log.w(TAG, "Shared raw image stream exceeded $maxBytes bytes; rejecting fallback read")
                return null
            }
            buffer.write(chunk, 0, read)
        }
        return buffer.toByteArray()
    }

    private fun deliverPendingSharedImageIfNeeded() {
        val pendingJson = bridge.consumePendingSharedImage() ?: return
        val wv = webView ?: return
        wv.post {
            wv.evaluateJavascript(
                """
                (function() {
                    try {
                        var payload = $pendingJson;
                        if (window.__capyReceiveSharedImage && payload && payload.dataUrl) {
                            window.__capyReceiveSharedImage(payload.title || "Shared Photo", payload.dataUrl);
                        }
                    } catch (e) {}
                })();
                """.trimIndent(),
                null,
            )
        }
    }

    private fun deliverPendingDeepLinkIfNeeded() {
        val pendingUrl = bridge.consumePendingDeepLink() ?: return
        if (!CapyAndroidBridge.isAllowedCapyDeepLink(pendingUrl)) return
        val wv = webView ?: return
        val escapedUrl = CapyAndroidBridge.escapeJsString(pendingUrl)
        wv.post {
            wv.evaluateJavascript(
                """
                (function() {
                    try {
                        if (window.__capyReceiveDeepLink) {
                            window.__capyReceiveDeepLink("$escapedUrl");
                        }
                    } catch (e) {}
                })();
                """.trimIndent(),
                null,
            )
        }
    }

    private fun initializePlayGamesIfConfigured() {
        val appId = getString(R.string.game_services_project_id)
        if (!CapyAndroidBridge.isPlayGamesAppIdConfigured(appId)) {
            Log.d(TAG, "Google Play Games App ID not configured ($appId); skipping PlayGamesSdk init")
            return
        }
        try {
            PlayGamesSdk.initialize(this)
            PlayGames.getGamesSignInClient(this).isAuthenticated.addOnCompleteListener { task ->
                val isAuthenticated = (task.isSuccessful) && (task.result?.isAuthenticated == true)
                if (isAuthenticated) {
                    fetchAndDeliverPlayGamesPlayerProfile()
                    pullSnapshotFromPlayGames(CLOUD_MANIFEST_SLOT_KEY)
                } else {
                    requestPlayGamesSignIn()
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "PlayGamesSdk initialization skipped or unavailable", e)
        }
    }

    private fun requestPlayGamesSignIn() {
        val appId = getString(R.string.game_services_project_id)
        if (!CapyAndroidBridge.isPlayGamesAppIdConfigured(appId)) {
            Log.d(TAG, "Play Games sign-in requested without configured Project ID; using cached or local profile")
            deliverCachedPlayGamesProfileIfNeeded()
            return
        }
        try {
            PlayGames.getGamesSignInClient(this).signIn().addOnCompleteListener { task ->
                val isAuthenticated = (task.isSuccessful) && (task.result?.isAuthenticated == true)
                if (isAuthenticated) {
                    fetchAndDeliverPlayGamesPlayerProfile()
                    pullSnapshotFromPlayGames(CLOUD_MANIFEST_SLOT_KEY)
                } else {
                    Log.w(TAG, "Play Games interactive sign-in did not authenticate", task.exception)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to invoke Play Games interactive signIn()", e)
        }
    }

    private fun fetchAndDeliverPlayGamesPlayerProfile() {
        try {
            PlayGames.getPlayersClient(this).currentPlayer.addOnSuccessListener { player ->
                val playerId = player.playerId
                val displayName = player.displayName
                Log.i(TAG, "Resolved Google Play Games profile: '$displayName' ($playerId)")
                bridge.cachePlayGamesProfile(playerId, displayName)
                if (isPageLoaded) {
                    deliverCachedPlayGamesProfileIfNeeded()
                }
            }.addOnFailureListener { err ->
                Log.w(TAG, "Failed to load Google Play Games currentPlayer profile", err)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error querying PlayGames PlayersClient", e)
        }
    }

    private fun deliverCachedPlayGamesProfileIfNeeded() {
        val profileJson = bridge.loadCachedPlayGamesProfileJson() ?: return
        val wv = webView ?: return
        wv.post {
            wv.evaluateJavascript(
                """
                (function() {
                    try {
                        if (window.__capyReceivePlayGamesProfile) {
                            window.__capyReceivePlayGamesProfile($profileJson);
                        }
                    } catch (e) {}
                })();
                """.trimIndent(),
                null,
            )
        }
    }

    private fun pushSnapshotToPlayGames(slotKey: String, payloadJson: String) {
        val appId = getString(R.string.game_services_project_id)
        if (!CapyAndroidBridge.isPlayGamesAppIdConfigured(appId)) return
        val safeSlot = CapyAndroidBridge.sanitizeKey(slotKey)
        try {
            val snapshotsClient = PlayGames.getSnapshotsClient(this)
            snapshotsClient.open(
                safeSlot,
                true,
                SnapshotsClient.RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED,
            ).addOnSuccessListener { dataOrConflict ->
                val snapshot = dataOrConflict.data
                if (snapshot != null) {
                    snapshot.snapshotContents.writeBytes(payloadJson.toByteArray(Charsets.UTF_8))
                    val metadataChange = SnapshotMetadataChange.Builder()
                        .setDescription("Capy Paint Cloud Save ($safeSlot)")
                        .build()
                    snapshotsClient.commitAndClose(snapshot, metadataChange)
                        .addOnFailureListener { err ->
                            Log.w(TAG, "Failed to commit Play Games snapshot '$safeSlot'", err)
                        }
                }
            }.addOnFailureListener { err ->
                Log.w(TAG, "Failed to open Play Games snapshot '$safeSlot' for writing", err)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error pushing Play Games snapshot '$safeSlot'", e)
        }
    }

    private fun pullSnapshotFromPlayGames(slotKey: String) {
        val appId = getString(R.string.game_services_project_id)
        if (!CapyAndroidBridge.isPlayGamesAppIdConfigured(appId)) return
        val safeSlot = CapyAndroidBridge.sanitizeKey(slotKey)
        try {
            val snapshotsClient = PlayGames.getSnapshotsClient(this)
            snapshotsClient.open(
                safeSlot,
                false,
                SnapshotsClient.RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED,
            ).addOnSuccessListener { dataOrConflict ->
                val snapshot = dataOrConflict.data
                if (snapshot != null) {
                    try {
                        val bytes = snapshot.snapshotContents.readFully()
                        snapshotsClient.discardAndClose(snapshot)
                        if (bytes.isNotEmpty()) {
                            val payloadJson = String(bytes, Charsets.UTF_8)
                            bridge.saveLocalCloudSnapshotOnly(slotKey, payloadJson)
                            deliverCloudSnapshotToWebView(slotKey, payloadJson)
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed reading Play Games snapshot '$safeSlot'", e)
                    }
                }
            }.addOnFailureListener { err ->
                Log.d(TAG, "No existing Play Games snapshot found for '$safeSlot'", err)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error pulling Play Games snapshot '$safeSlot'", e)
        }
    }

    private fun deliverCloudSnapshotToWebView(slotKey: String, payloadJson: String) {
        if (!isPageLoaded) return
        val wv = webView ?: return
        val safeSlot = CapyAndroidBridge.escapeJsString(slotKey)
        val safePayload = CapyAndroidBridge.escapeJsString(payloadJson)
        wv.post {
            wv.evaluateJavascript(
                """
                (function() {
                    try {
                        if (window.__capyReceiveCloudSnapshot) {
                            window.__capyReceiveCloudSnapshot("$safeSlot", "$safePayload");
                        }
                    } catch (e) {}
                })();
                """.trimIndent(),
                null,
            )
        }
    }

    override fun onDestroy() {
        shareDecodeExecutor.shutdownNow()
        webView?.destroy()
        webView = null
        super.onDestroy()
    }

    companion object {
        const val TAG = "CapyApp"
        const val START_URL = "https://appassets.androidplatform.net/assets/www/index.html"
        const val CLOUD_MANIFEST_SLOT_KEY = "capy_cloud_manifest_v2"
    }
}
