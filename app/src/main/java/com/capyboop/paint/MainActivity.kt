package com.capyboop.paint

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.RequiresApi
import androidx.core.graphics.scale
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.google.android.gms.games.PlayGames
import com.google.android.gms.games.PlayGamesSdk
import com.google.android.gms.games.SnapshotsClient
import com.google.android.gms.games.snapshot.Snapshot
import com.google.android.gms.games.snapshot.SnapshotMetadataChange
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

class MainActivity : ComponentActivity() {

    private lateinit var rootContainer: FrameLayout
    private lateinit var assetLoader: WebViewAssetLoader
    @Volatile
    private var webView: WebView? = null
    private var fallbackView: LinearLayout? = null
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    private lateinit var bridge: CapyAndroidBridge
    private val rendererCrashGuard = RendererCrashGuard()
    private var isPageLoaded: Boolean = false
    private var isActivityPaused: Boolean = false
    private var pendingRendererRecovery: Boolean = false
    @Volatile
    private var isTrustedPageLoaded: Boolean = false
    private val lastKnownRemotePayloads = ConcurrentHashMap<String, String>()
    private val shareDecodeExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "CapyShareDecode").apply { isDaemon = true }
    }
    private val playGamesIoExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "CapyPlayGamesIO").apply { isDaemon = true }
    }

    private fun runOnActiveUiThread(block: () -> Unit) {
        if (isDestroyed || isFinishing) return
        runOnUiThread {
            if (isDestroyed || isFinishing) return@runOnUiThread
            block()
        }
    }

    private fun submitPlayGamesIo(onRejected: (() -> Unit)? = null, task: () -> Unit) {
        if (isDestroyed || isFinishing || playGamesIoExecutor.isShutdown) {
            onRejected?.invoke()
            return
        }
        try {
            playGamesIoExecutor.execute {
                if (isDestroyed || isFinishing) {
                    onRejected?.invoke()
                    return@execute
                }
                task()
            }
        } catch (e: RejectedExecutionException) {
            Log.w(TAG, "Play Games I/O task rejected during activity teardown", e)
            onRejected?.invoke()
        }
    }

    private fun updateBackCallbackState() {
        backPressedCallback.isEnabled = bridge.isModalOpen || (webView?.canGoBack() == true)
    }

    private fun cancelFileUploadCallback() {
        val callback = fileUploadCallback
        fileUploadCallback = null
        try {
            callback?.onReceiveValue(null)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to cancel pending file upload callback", e)
        }
    }

    /**
     * Launches external HTTP(S) URLs (such as the Privacy Policy) in an installed external browser
     * package excluding this app's own packageName, preventing autoVerify App Links from looping
     * back into MainActivity.onNewIntent().
     */
    private fun openExternalBrowserUrl(uri: Uri) {
        val viewIntent = Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
        val probeIntent = Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com"))
            .addCategory(Intent.CATEGORY_BROWSABLE)
        val resolvedBrowsers = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            packageManager.queryIntentActivities(
                probeIntent,
                PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY.toLong()),
            )
        } else {
            @Suppress("DEPRECATION")
            packageManager.queryIntentActivities(probeIntent, PackageManager.MATCH_DEFAULT_ONLY)
        }
        val externalBrowserPkg = resolvedBrowsers
            .mapNotNull { it.activityInfo?.packageName?.takeIf(String::isNotBlank) }
            .firstOrNull { it != packageName && it != "android" }
        if (externalBrowserPkg != null) {
            viewIntent.setPackage(externalBrowserPkg)
        }
        try {
            startActivity(viewIntent)
        } catch (e: ActivityNotFoundException) {
            if (externalBrowserPkg != null) {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
                } catch (fallbackError: Exception) {
                    Log.w(TAG, "No handler available for external URL: $uri", fallbackError)
                }
            } else {
                Log.w(TAG, "No handler available for external URL: $uri", e)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to open external URL: $uri", e)
        }
    }

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
                evaluateOnTrustedPage("window.__capyCloseModal && window.__capyCloseModal();")
            } else if ((wv != null) && wv.canGoBack()) {
                wv.goBack()
                updateBackCallbackState()
            } else {
                isEnabled = false
                onBackPressedDispatcher.onBackPressed()
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)

        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        onBackPressedDispatcher.addCallback(this, backPressedCallback)

        bridge = CapyAndroidBridge(
            context = applicationContext,
            rootViewProvider = {
                if (::rootContainer.isInitialized) rootContainer else webView
            },
            onModalStateChanged = { _ ->
                runOnActiveUiThread {
                    updateBackCallbackState()
                }
            },
            onRequestPlayGamesSignIn = {
                runOnActiveUiThread {
                    requestPlayGamesSignIn()
                }
            },
            onSaveCloudSnapshot = { slotKey, payloadJson ->
                runOnActiveUiThread {
                    pushSnapshotToPlayGames(slotKey, payloadJson)
                }
            },
            onRequestCloudSnapshotPull = { slotKey ->
                runOnActiveUiThread {
                    pullSnapshotFromPlayGames(slotKey)
                }
            },
            originGuard = { isTrustedPageLoaded },
        )

        initializePlayGamesIfConfigured()

        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        rootContainer = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            setBackgroundColor(Color.BLACK)
        }

        val density = resources.displayMetrics.density
        val defaultTop = (getStatusBarHeight() / density).toInt()
        val defaultBottom = (getNavigationBarHeight() / density).toInt()
        bridge.updateSafeAreaInsets(defaultTop, defaultBottom, 0, 0)

        ViewCompat.setOnApplyWindowInsetsListener(rootContainer) { _, windowInsets ->
            val insets = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime(),
            )
            val d = resources.displayMetrics.density
            val topCss = (insets.top / d).toInt()
            val bottomCss = (insets.bottom / d).toInt()
            val leftCss = (insets.left / d).toInt()
            val rightCss = (insets.right / d).toInt()

            bridge.updateSafeAreaInsets(topCss, bottomCss, leftCss, rightCss)
            applySafeAreaInsetsToWebView()
            fallbackView?.let { applyFallbackSafeAreaPadding(it) }
            windowInsets
        }

        setContentView(rootContainer)

        handleIncomingIntent(intent)
        mountWebView(savedInstanceState)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(): WebView {
        return WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
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
                allowContentAccess = false
                @Suppress("DEPRECATION")
                allowFileAccessFromFileURLs = false
                @Suppress("DEPRECATION")
                allowUniversalAccessFromFileURLs = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                mediaPlaybackRequiresUserGesture = false
                cacheMode = WebSettings.LOAD_DEFAULT
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
                textZoom = 100
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    safeBrowsingEnabled = true
                }
            }

            addJavascriptInterface(bridge, "CapyAndroid")

            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                WebViewCompat.addWebMessageListener(
                    this,
                    "CapyAndroidChannel",
                    setOf(CapyAndroidBridge.APP_ASSETS_ORIGIN),
                ) { _, message, sourceOrigin, isMainFrame, _ ->
                    if (!CapyAndroidBridge.isTrustedBridgeOrigin(sourceOrigin.toString(), isMainFrame)) {
                        Log.w(TAG, "Ignored untrusted WebMessage from $sourceOrigin (mainFrame=$isMainFrame)")
                        return@addWebMessageListener
                    }
                    if (message.type == WebMessageCompat.TYPE_STRING) {
                        val data = message.data ?: return@addWebMessageListener
                        if (data == "ping") {
                            Log.d(TAG, "Verified WebMessage channel ping from $sourceOrigin")
                        }
                    }
                }
            }

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest,
                ): WebResourceResponse? {
                    val reqUrl = request.url ?: return null
                    if (
                        BuildConfig.DEBUG &&
                        request.isForMainFrame &&
                        isDebugCrashTestUrl(reqUrl.toString())
                    ) {
                        return null
                    }
                    val scheme = reqUrl.scheme?.lowercase()
                    val secFetchDest = request.requestHeaders?.get("Sec-Fetch-Dest")
                        ?: request.requestHeaders?.get("sec-fetch-dest")
                    if (
                        scheme == "file" ||
                        scheme == "content" ||
                        CapyAndroidBridge.shouldBlockDocumentRequest(
                            reqUrl.toString(),
                            request.isForMainFrame,
                            secFetchDest,
                        )
                    ) {
                        Log.w(TAG, "Blocked untrusted WebView request: $reqUrl (mainFrame=${request.isForMainFrame})")
                        return WebResourceResponse(
                            "text/plain",
                            "utf-8",
                            403,
                            "Forbidden",
                            emptyMap(),
                            ByteArrayInputStream(ByteArray(0)),
                        )
                    }
                    if (scheme != "https" || reqUrl.host?.lowercase() != CapyAndroidBridge.APP_ASSETS_HOST) {
                        return null
                    }
                    val assetResponse = assetLoader.shouldInterceptRequest(reqUrl) ?: return null
                    val mergedHeaders = LinkedHashMap<String, String>()
                    assetResponse.responseHeaders?.let { mergedHeaders.putAll(it) }
                    mergedHeaders.putAll(
                        CapyAndroidBridge.buildWebViewAssetResponseHeaders(
                            mimeType = assetResponse.mimeType,
                            path = reqUrl.path,
                        ),
                    )
                    assetResponse.responseHeaders = mergedHeaders
                    return assetResponse
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest,
                ): Boolean {
                    if (view !== webView) return true
                    val targetUrl = request.url?.toString()
                    if (
                        BuildConfig.DEBUG &&
                        request.isForMainFrame &&
                        isDebugCrashTestUrl(targetUrl)
                    ) {
                        return false
                    }
                    return when (CapyAndroidBridge.classifyWebViewNavigation(targetUrl)) {
                        CapyAndroidBridge.WebViewNavigationAction.ALLOW_INTERNAL -> false
                        CapyAndroidBridge.WebViewNavigationAction.OPEN_EXTERNAL -> {
                            if (request.isForMainFrame) {
                                request.url?.let { openExternalBrowserUrl(it) }
                            }
                            true
                        }
                        CapyAndroidBridge.WebViewNavigationAction.BLOCK -> {
                            Log.w(TAG, "Blocked unsafe WebView navigation URL: $targetUrl")
                            true
                        }
                    }
                }

                override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    if (view !== webView) return
                    isPageLoaded = false
                    bridge.setModalOpen(false)
                    isTrustedPageLoaded = CapyAndroidBridge.isTrustedPageUrl(url)
                }

                override fun doUpdateVisitedHistory(view: WebView?, url: String?, isReload: Boolean) {
                    super.doUpdateVisitedHistory(view, url, isReload)
                    if (view !== webView) return
                    updateBackCallbackState()
                }

                override fun onPageFinished(view: WebView, url: String?) {
                    super.onPageFinished(view, url)
                    if (view !== webView) return
                    val trusted = CapyAndroidBridge.isTrustedPageUrl(url)
                    isTrustedPageLoaded = trusted
                    isPageLoaded = trusted
                    updateBackCallbackState()
                    Log.d(TAG, "WebView page finished loading: $url")
                    if (!trusted) return
                    applySafeAreaInsetsToWebView()
                    deliverPendingSharedImageIfNeeded()
                    deliverPendingDeepLinkIfNeeded()
                    deliverPendingOAuthCallbackIfNeeded()
                }

                override fun onReceivedError(
                    view: WebView,
                    request: WebResourceRequest,
                    error: WebResourceError,
                ) {
                    super.onReceivedError(view, request, error)
                    Log.e(TAG, "WebView error loading ${request.url}: ${error.description} (code: ${error.errorCode})")
                }

                @RequiresApi(Build.VERSION_CODES.O)
                override fun onRenderProcessGone(
                    view: WebView,
                    detail: RenderProcessGoneDetail,
                ): Boolean {
                    return handleRenderProcessGone(
                        view = view,
                        didCrash = detail.didCrash(),
                        rendererPriorityAtExit = detail.rendererPriorityAtExit(),
                    )
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
                    if (webView !== this@MainActivity.webView) {
                        try {
                            filePathCallback?.onReceiveValue(null)
                        } catch (e: Exception) {
                            Log.w(TAG, "Failed to cancel stale WebView file chooser callback", e)
                        }
                        return true
                    }
                    cancelFileUploadCallback()
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
    }

    private fun mountWebView(savedInstanceState: Bundle? = null) {
        if (isDestroyed || isFinishing) return
        pendingRendererRecovery = false
        isPageLoaded = false
        fallbackView = null
        val previous = webView
        webView = null
        if (previous != null) {
            (previous.parent as? ViewGroup)?.removeView(previous)
            destroyWebViewSafely(previous)
        }
        rootContainer.removeAllViews()

        var created: WebView? = null
        try {
            val wv = createWebView()
            created = wv
            webView = wv
            rootContainer.addView(wv)
            ViewCompat.requestApplyInsets(rootContainer)

            val restored = if (savedInstanceState != null) wv.restoreState(savedInstanceState) else null
            if (restored == null) {
                isTrustedPageLoaded = true
                wv.loadUrl(START_URL)
            } else {
                val restoredOk = CapyAndroidBridge.isTrustedPageUrl(wv.url)
                isTrustedPageLoaded = restoredOk
                if (!restoredOk) {
                    isTrustedPageLoaded = true
                    wv.loadUrl(START_URL)
                }
            }
            if (isActivityPaused) {
                wv.onPause()
            }
            updateBackCallbackState()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to create or mount WebView", e)
            isPageLoaded = false
            isTrustedPageLoaded = false
            webView = null
            if (created != null) {
                (created.parent as? ViewGroup)?.removeView(created)
                destroyWebViewSafely(created)
            }
            updateBackCallbackState()
            showRendererCrashFallback()
        }
    }

    private fun handleRenderProcessGone(
        view: WebView,
        didCrash: Boolean,
        rendererPriorityAtExit: Int,
    ): Boolean {
        if (view !== webView) {
            Log.w(
                TAG,
                "Stale WebView renderer terminated (didCrash=$didCrash, priority=$rendererPriorityAtExit); destroying detached instance",
            )
            (view.parent as? ViewGroup)?.removeView(view)
            destroyWebViewSafely(view)
            return true
        }

        isPageLoaded = false
        isTrustedPageLoaded = false
        webView = null
        bridge.resetModalState()
        cancelFileUploadCallback()
        updateBackCallbackState()

        (view.parent as? ViewGroup)?.removeView(view)
        destroyWebViewSafely(view)

        if (isDestroyed || isFinishing) {
            Log.w(
                TAG,
                "WebView renderer terminated during activity teardown (didCrash=$didCrash, priority=$rendererPriorityAtExit)",
            )
            return true
        }

        if (isActivityPaused) {
            pendingRendererRecovery = true
            val deferredTelemetry = "WebView renderer terminated while paused " +
                "(didCrash=$didCrash, priority=$rendererPriorityAtExit, " +
                "recentRecoveries=${rendererCrashGuard.recentRecoveryCount()}, " +
                "totalExits=${rendererCrashGuard.totalExitCount()}, action=DEFER_UNTIL_RESUME)"
            if (didCrash) {
                Log.e(TAG, deferredTelemetry)
            } else {
                Log.w(TAG, deferredTelemetry)
            }
            return true
        }

        val record = rendererCrashGuard.recordExit()
        val telemetry = "WebView renderer terminated (didCrash=$didCrash, priority=$rendererPriorityAtExit, " +
            "recentRecoveries=${record.recentRecoveryCount}, totalExits=${record.totalExitCount}, action=${record.decision})"
        if (didCrash) {
            Log.e(TAG, telemetry)
        } else {
            Log.w(TAG, telemetry)
        }

        when (record.decision) {
            RendererCrashGuard.Decision.RECOVER -> mountWebView(savedInstanceState = null)
            RendererCrashGuard.Decision.SHOW_FALLBACK -> showRendererCrashFallback()
        }
        return true
    }

    private fun destroyWebViewSafely(view: WebView) {
        try {
            view.destroy()
        } catch (e: Exception) {
            Log.w(TAG, "Error destroying terminated WebView", e)
        }
    }

    private fun applyFallbackSafeAreaPadding(layout: LinearLayout) {
        val density = resources.displayMetrics.density
        val safeLeft = bridge.safeAreaLeftCss.coerceIn(0, MAX_FALLBACK_INSET_CSS)
        val safeRight = bridge.safeAreaRightCss.coerceIn(0, MAX_FALLBACK_INSET_CSS)
        val safeTop = bridge.safeAreaTopCss.coerceIn(0, MAX_FALLBACK_INSET_CSS)
        val safeBottom = bridge.safeAreaBottomCss.coerceIn(0, MAX_FALLBACK_INSET_CSS)
        val padLeft = ((safeLeft + 24) * density).toInt()
        val padRight = ((safeRight + 24) * density).toInt()
        val padTop = ((safeTop + 24) * density).toInt()
        val padBottom = ((safeBottom + 24) * density).toInt()
        layout.setPadding(padLeft, padTop, padRight, padBottom)
    }

    private fun showRendererCrashFallback() {
        if (isDestroyed || isFinishing) return
        pendingRendererRecovery = false
        rootContainer.removeAllViews()

        val density = resources.displayMetrics.density
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.BLACK)
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        }
        applyFallbackSafeAreaPadding(layout)

        val titleView = TextView(this).apply {
            text = "Capy Paint paused"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.CENTER
        }

        val messageView = TextView(this).apply {
            text = "The display engine stopped unexpectedly. Your saved progress is safe on this device."
            setTextColor(Color.parseColor("#D1D5DB"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply {
                topMargin = (12 * density).toInt()
                bottomMargin = (24 * density).toInt()
            }
        }

        val reloadButton = Button(this).apply {
            text = "Tap to reload"
            contentDescription = "Tap to reload Capy Paint"
            isAllCaps = false
            setTextColor(Color.parseColor("#111827"))
            setBackgroundColor(Color.parseColor("#F59E0B"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setTypeface(typeface, Typeface.BOLD)
            minHeight = (48 * density).toInt()
            setPadding(
                (28 * density).toInt(),
                (12 * density).toInt(),
                (28 * density).toInt(),
                (12 * density).toInt(),
            )
            setOnClickListener { button ->
                button.isEnabled = false
                rendererCrashGuard.reset()
                mountWebView(savedInstanceState = null)
            }
        }

        layout.addView(titleView)
        layout.addView(messageView)
        layout.addView(reloadButton)
        fallbackView = layout
        rootContainer.addView(layout)
        reloadButton.requestFocus()
    }

    private fun evaluateOnTrustedPage(script: String) {
        val wv = webView ?: return
        wv.post {
            if (isDestroyed || isFinishing || (wv !== webView)) return@post
            if (!CapyAndroidBridge.isTrustedPageUrl(wv.url)) {
                Log.w(TAG, "Blocked JS evaluation on untrusted WebView URL: ${wv.url}")
                return@post
            }
            wv.evaluateJavascript(script, null)
        }
    }

    private fun applySafeAreaInsetsToWebView() {
        val topCss = bridge.safeAreaTopCss
        val bottomCss = bridge.safeAreaBottomCss
        val leftCss = bridge.safeAreaLeftCss
        val rightCss = bridge.safeAreaRightCss
        evaluateOnTrustedPage(
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
        )
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
            if (CapyAndroidBridge.isAllowedOAuthCallbackUrl(dataUri) && (dataUri != null)) {
                Log.i(TAG, "Received verified OAuth PKCE callback URI")
                bridge.pendingOAuthCallbackUrl = dataUri
                if (isPageLoaded) {
                    deliverPendingOAuthCallbackIfNeeded()
                }
            } else if (CapyAndroidBridge.isAllowedCapyDeepLink(dataUri) && (dataUri != null)) {
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
        if (!CapyAndroidBridge.isAllowedIncomingShareUriScheme(imageUri.scheme)) {
            Log.w(TAG, "Rejected incoming ACTION_SEND URI with unsupported scheme: ${imageUri.scheme}")
            return
        }

        val title = CapyAndroidBridge.sanitizeShareTitle(
            imageUri.lastPathSegment?.substringAfterLast('/'),
            fallback = "Shared Photo",
            maxLength = 80,
        )
        val appResolver = applicationContext.contentResolver
        if (isDestroyed || isFinishing || shareDecodeExecutor.isShutdown) return
        try {
            shareDecodeExecutor.execute {
                if (isDestroyed || isFinishing) return@execute
                try {
                    val dataUrl = decodeAndDownsampleSharedImage(appResolver, imageUri, type) ?: return@execute
                    if (!CapyAndroidBridge.isAllowedSharedImageDataUrl(dataUrl)) {
                        Log.w(TAG, "Rejected unsafe shared image data URL")
                        return@execute
                    }
                    runOnActiveUiThread {
                        bridge.pendingSharedImageJson = CapyAndroidBridge.formatSharedImageJson(title, dataUrl)
                        if (isPageLoaded) {
                            deliverPendingSharedImageIfNeeded()
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to resolve incoming share image URI: $imageUri", e)
                }
            }
        } catch (e: RejectedExecutionException) {
            Log.w(TAG, "Incoming share decode rejected during activity teardown", e)
        }
    }

    private fun decodeAndDownsampleSharedImage(
        resolver: android.content.ContentResolver,
        imageUri: Uri,
        mimeType: String,
    ): String? {
        val header = ByteArray(CapyAndroidBridge.IMAGE_MAGIC_HEADER_BYTES)
        val headerRead = resolver.openInputStream(imageUri)?.use { stream ->
            var offset = 0
            while (offset < header.size) {
                val read = stream.read(header, offset, header.size - offset)
                if (read <= 0) break
                offset += read
            }
            offset
        } ?: return null
        if (!CapyAndroidBridge.isValidImageMagicBytes(header, headerRead)) {
            Log.w(TAG, "Rejected incoming ACTION_SEND payload with invalid image magic bytes")
            return null
        }

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
                    val scaled = decoded.scale(targetW, targetH)
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
        val safeMime = CapyAndroidBridge.normalizeSharedImageMimeType(mimeType)
        val base64 = Base64.encodeToString(rawBytes, Base64.NO_WRAP)
        return "data:$safeMime;base64,$base64"
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
        val escapedJson = CapyAndroidBridge.escapeJsString(pendingJson)
        evaluateOnTrustedPage(
            """
            (function() {
                try {
                    var payload = JSON.parse("$escapedJson");
                    if (window.__capyReceiveSharedImage && payload && payload.dataUrl) {
                        window.__capyReceiveSharedImage(payload.title || "Shared Photo", payload.dataUrl);
                    }
                } catch (e) {}
            })();
            """.trimIndent(),
        )
    }

    private fun deliverPendingDeepLinkIfNeeded() {
        val pendingUrl = bridge.consumePendingDeepLink() ?: return
        if (!CapyAndroidBridge.isAllowedCapyDeepLink(pendingUrl)) return
        val escapedUrl = CapyAndroidBridge.escapeJsString(pendingUrl)
        evaluateOnTrustedPage(
            """
            (function() {
                try {
                    if (window.__capyReceiveDeepLink) {
                        window.__capyReceiveDeepLink("$escapedUrl");
                    }
                } catch (e) {}
            })();
            """.trimIndent(),
        )
    }

    private fun deliverPendingOAuthCallbackIfNeeded() {
        val pendingUrl = bridge.consumePendingOAuthCallbackInternal() ?: return
        if (!CapyAndroidBridge.isAllowedOAuthCallbackUrl(pendingUrl)) return
        val escapedUrl = CapyAndroidBridge.escapeJsString(pendingUrl)
        evaluateOnTrustedPage(
            """
            (function() {
                try {
                    if (window.__capyReceiveOAuthCallback) {
                        window.__capyReceiveOAuthCallback("$escapedUrl");
                    }
                } catch (e) {}
            })();
            """.trimIndent(),
        )
    }

    private fun initializePlayGamesIfConfigured() {
        val appId = getString(R.string.game_services_project_id)
        if (!CapyAndroidBridge.isPlayGamesAppIdConfigured(appId)) {
            Log.d(TAG, "Google Play Games App ID not configured ($appId); skipping PlayGamesSdk init")
            return
        }
        try {
            // Only initialize PlayGamesSdk in onCreate(); defer signIn(), profile fetch, and
            // SnapshotsClient pulls until WebView explicitly invokes CapyAndroid.signInPlayGames().
            PlayGamesSdk.initialize(this)
        } catch (e: Exception) {
            Log.w(TAG, "PlayGamesSdk initialization skipped or unavailable", e)
        }
    }

    private fun requestPlayGamesSignIn() {
        val appId = getString(R.string.game_services_project_id)
        if (!CapyAndroidBridge.isPlayGamesAppIdConfigured(appId)) {
            Log.d(TAG, "Play Games sign-in requested without configured Project ID; checking cached profile")
            if (bridge.loadCachedPlayGamesProfileJson() != null) {
                deliverCachedPlayGamesProfileIfNeeded()
            } else {
                deliverPlayGamesSignInError("PLAY_GAMES_UNCONFIGURED")
            }
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
                    deliverPlayGamesSignInError("PLAY_GAMES_UNAVAILABLE")
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to invoke Play Games interactive signIn()", e)
            deliverPlayGamesSignInError("PLAY_GAMES_UNAVAILABLE")
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
                deliverPlayGamesSignInError("PLAY_GAMES_UNAVAILABLE")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error querying PlayGames PlayersClient", e)
            deliverPlayGamesSignInError("PLAY_GAMES_UNAVAILABLE")
        }
    }

    private fun deliverCachedPlayGamesProfileIfNeeded() {
        val profileJson = bridge.loadCachedPlayGamesProfileJson() ?: return
        val escapedJson = CapyAndroidBridge.escapeJsString(profileJson)
        evaluateOnTrustedPage(
            """
            (function() {
                try {
                    if (window.__capyReceivePlayGamesProfile) {
                        window.__capyReceivePlayGamesProfile(JSON.parse("$escapedJson"));
                    }
                } catch (e) {}
            })();
            """.trimIndent(),
        )
    }

    private fun deliverPlayGamesSignInError(reasonCode: String) {
        val safeReason = CapyAndroidBridge.escapeJsString(reasonCode)
        evaluateOnTrustedPage(
            """
            (function() {
                try {
                    if (window.__capyReceivePlayGamesError) {
                        window.__capyReceivePlayGamesError("$safeReason");
                    }
                } catch (e) {}
            })();
            """.trimIndent(),
        )
    }

    private fun deliverCloudSnapshotErrorToWebView(slotKey: String, reasonCode: String) {
        val safeSlot = CapyAndroidBridge.escapeJsString(slotKey)
        val safeReason = CapyAndroidBridge.escapeJsString(reasonCode)
        evaluateOnTrustedPage(
            """
            (function() {
                try {
                    if (window.__capyReceiveCloudSnapshotError) {
                        window.__capyReceiveCloudSnapshotError("$safeSlot", "$safeReason");
                    }
                } catch (e) {}
            })();
            """.trimIndent(),
        )
    }

    private fun commitSnapshotPayloadOnIoThread(
        snapshotsClient: SnapshotsClient,
        snapshot: Snapshot,
        slotKey: String,
        safeSlot: String,
        payloadJson: String,
    ) {
        try {
            snapshot.snapshotContents.writeBytes(payloadJson.toByteArray(Charsets.UTF_8))
            val metadataChange = SnapshotMetadataChange.Builder()
                .setDescription("Capy Paint Cloud Save ($safeSlot)")
                .build()
            snapshotsClient.commitAndClose(snapshot, metadataChange)
                .addOnSuccessListener {
                    lastKnownRemotePayloads[safeSlot] = payloadJson
                }
                .addOnFailureListener { err ->
                    Log.w(TAG, "Failed to commit Play Games snapshot '$safeSlot'", err)
                    runOnActiveUiThread {
                        deliverCloudSnapshotErrorToWebView(slotKey, "PLAY_GAMES_SNAPSHOT_COMMIT_FAILED")
                    }
                }
        } catch (e: Exception) {
            Log.w(TAG, "Error writing Play Games snapshot payload '$safeSlot'", e)
            try {
                snapshotsClient.discardAndClose(snapshot)
            } catch (_: Exception) {
                // Ignore cleanup error
            }
            runOnActiveUiThread {
                deliverCloudSnapshotErrorToWebView(slotKey, "PLAY_GAMES_SNAPSHOT_COMMIT_FAILED")
            }
        }
    }

    private fun handlePlayGamesSnapshotConflict(
        snapshotsClient: SnapshotsClient,
        slotKey: String,
        safeSlot: String,
        conflictId: String,
        serverSnapshot: Snapshot,
        conflictingSnapshot: Snapshot,
    ) {
        submitPlayGamesIo(
            onRejected = {
                try {
                    snapshotsClient.discardAndClose(serverSnapshot)
                } catch (_: Exception) {
                    // Ignore cleanup error
                }
                try {
                    snapshotsClient.discardAndClose(conflictingSnapshot)
                } catch (_: Exception) {
                    // Ignore cleanup error
                }
            },
        ) {
            try {
                val serverBytes = serverSnapshot.snapshotContents.readFully()
                val otherBytes = conflictingSnapshot.snapshotContents.readFully()
                val serverJson = if (serverBytes.isNotEmpty()) String(serverBytes, Charsets.UTF_8) else null
                val otherJson = if (otherBytes.isNotEmpty()) String(otherBytes, Charsets.UTF_8) else null
                val chosenJson = serverJson ?: otherJson
                if (chosenJson != null) {
                    lastKnownRemotePayloads[safeSlot] = chosenJson
                }
                if (!safeSlot.startsWith("pgblob_")) {
                    if (serverJson != null) {
                        bridge.saveLocalCloudSnapshotOnly(slotKey, serverJson)
                        runOnActiveUiThread {
                            deliverCloudSnapshotToWebView(slotKey, serverJson)
                        }
                    }
                    if (otherJson != null && otherJson != serverJson) {
                        bridge.saveLocalCloudSnapshotOnly(slotKey, otherJson)
                        runOnActiveUiThread {
                            deliverCloudSnapshotToWebView(slotKey, otherJson)
                        }
                    }
                } else if (chosenJson != null) {
                    bridge.saveLocalCloudSnapshotOnly(slotKey, chosenJson)
                    runOnActiveUiThread {
                        deliverCloudSnapshotToWebView(slotKey, chosenJson)
                    }
                }
                snapshotsClient.resolveConflict(conflictId, serverSnapshot)
                    .addOnSuccessListener { resolved ->
                        resolved.data?.let { s ->
                            try {
                                snapshotsClient.discardAndClose(s)
                            } catch (_: Exception) {
                                // Ignore if already closed
                            }
                        }
                    }
                    .addOnFailureListener { err ->
                        Log.w(TAG, "Failed resolving Play Games snapshot conflict '$safeSlot'", err)
                        runOnActiveUiThread {
                            deliverCloudSnapshotErrorToWebView(slotKey, "PLAY_GAMES_SNAPSHOT_CONFLICT_FAILED")
                        }
                    }
            } catch (e: Exception) {
                Log.w(TAG, "Error resolving Play Games snapshot conflict '$safeSlot'", e)
                runOnActiveUiThread {
                    deliverCloudSnapshotErrorToWebView(slotKey, "PLAY_GAMES_SNAPSHOT_CONFLICT_FAILED")
                }
            }
        }
    }

    private fun pushSnapshotToPlayGames(slotKey: String, payloadJson: String) {
        val appId = getString(R.string.game_services_project_id)
        if (!CapyAndroidBridge.isPlayGamesAppIdConfigured(appId)) return
        val safeSlot = CapyAndroidBridge.sanitizeKey(slotKey)
        val resolutionPolicy = if (safeSlot.startsWith("pgblob_")) {
            SnapshotsClient.RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED
        } else {
            SnapshotsClient.RESOLUTION_POLICY_MANUAL
        }
        try {
            val snapshotsClient = PlayGames.getSnapshotsClient(this)
            snapshotsClient.open(
                safeSlot,
                true,
                resolutionPolicy,
            ).addOnSuccessListener { dataOrConflict ->
                if (dataOrConflict.isConflict) {
                    val conflict = dataOrConflict.conflict
                    if (conflict != null) {
                        handlePlayGamesSnapshotConflict(
                            snapshotsClient = snapshotsClient,
                            slotKey = slotKey,
                            safeSlot = safeSlot,
                            conflictId = conflict.conflictId,
                            serverSnapshot = conflict.snapshot,
                            conflictingSnapshot = conflict.conflictingSnapshot,
                        )
                    } else {
                        deliverCloudSnapshotErrorToWebView(slotKey, "PLAY_GAMES_SNAPSHOT_CONFLICT_FAILED")
                    }
                    return@addOnSuccessListener
                }
                val snapshot = dataOrConflict.data
                if (snapshot == null) {
                    deliverCloudSnapshotErrorToWebView(slotKey, "PLAY_GAMES_SNAPSHOT_UNAVAILABLE")
                    return@addOnSuccessListener
                }
                submitPlayGamesIo(
                    onRejected = {
                        try {
                            snapshotsClient.discardAndClose(snapshot)
                        } catch (_: Exception) {
                            // Ignore cleanup error
                        }
                    },
                ) {
                    try {
                        val existingBytes = snapshot.snapshotContents.readFully()
                        val existingJson = if (existingBytes.isEmpty()) null else String(existingBytes, Charsets.UTF_8)
                        when (
                            CapyAndroidBridge.decideSnapshotPushAction(
                                slotKey = slotKey,
                                existingRemotePayload = existingJson,
                                lastKnownRemotePayload = lastKnownRemotePayloads[safeSlot],
                                incomingPayload = payloadJson,
                            )
                        ) {
                            CapyAndroidBridge.SnapshotPushDecision.SKIP_IDENTICAL -> {
                                lastKnownRemotePayloads[safeSlot] = payloadJson
                                snapshotsClient.discardAndClose(snapshot)
                            }
                            CapyAndroidBridge.SnapshotPushDecision.MERGE_UNSEEN_REMOTE -> {
                                val remotePayload = existingJson!!
                                lastKnownRemotePayloads[safeSlot] = remotePayload
                                bridge.saveLocalCloudSnapshotOnly(slotKey, remotePayload)
                                runOnActiveUiThread {
                                    deliverCloudSnapshotToWebView(slotKey, remotePayload)
                                }
                                snapshotsClient.discardAndClose(snapshot)
                            }
                            CapyAndroidBridge.SnapshotPushDecision.COMMIT_INCOMING -> {
                                commitSnapshotPayloadOnIoThread(
                                    snapshotsClient = snapshotsClient,
                                    snapshot = snapshot,
                                    slotKey = slotKey,
                                    safeSlot = safeSlot,
                                    payloadJson = payloadJson,
                                )
                            }
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed inspecting Play Games snapshot '$safeSlot' before commit", e)
                        try {
                            snapshotsClient.discardAndClose(snapshot)
                        } catch (_: Exception) {
                            // Ignore cleanup error
                        }
                        runOnActiveUiThread {
                            deliverCloudSnapshotErrorToWebView(slotKey, "PLAY_GAMES_SNAPSHOT_WRITE_FAILED")
                        }
                    }
                }
            }.addOnFailureListener { err ->
                Log.w(TAG, "Failed to open Play Games snapshot '$safeSlot' for writing", err)
                deliverCloudSnapshotErrorToWebView(slotKey, "PLAY_GAMES_SNAPSHOT_WRITE_FAILED")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error pushing Play Games snapshot '$safeSlot'", e)
            deliverCloudSnapshotErrorToWebView(slotKey, "PLAY_GAMES_SNAPSHOT_WRITE_FAILED")
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
                SnapshotsClient.RESOLUTION_POLICY_MANUAL,
            ).addOnSuccessListener { dataOrConflict ->
                if (dataOrConflict.isConflict) {
                    val conflict = dataOrConflict.conflict
                    if (conflict != null) {
                        handlePlayGamesSnapshotConflict(
                            snapshotsClient = snapshotsClient,
                            slotKey = slotKey,
                            safeSlot = safeSlot,
                            conflictId = conflict.conflictId,
                            serverSnapshot = conflict.snapshot,
                            conflictingSnapshot = conflict.conflictingSnapshot,
                        )
                    } else {
                        deliverCloudSnapshotErrorToWebView(slotKey, "PLAY_GAMES_SNAPSHOT_CONFLICT_FAILED")
                    }
                    return@addOnSuccessListener
                }
                val snapshot = dataOrConflict.data
                if (snapshot != null) {
                    submitPlayGamesIo(
                        onRejected = {
                            try {
                                snapshotsClient.discardAndClose(snapshot)
                            } catch (_: Exception) {
                                // Ignore cleanup error
                            }
                        },
                    ) {
                        try {
                            val bytes = snapshot.snapshotContents.readFully()
                            snapshotsClient.discardAndClose(snapshot)
                            if (bytes.isNotEmpty()) {
                                val payloadJson = String(bytes, Charsets.UTF_8)
                                lastKnownRemotePayloads[safeSlot] = payloadJson
                                bridge.saveLocalCloudSnapshotOnly(slotKey, payloadJson)
                                runOnActiveUiThread {
                                    deliverCloudSnapshotToWebView(slotKey, payloadJson)
                                }
                            }
                        } catch (e: Exception) {
                            Log.w(TAG, "Failed reading Play Games snapshot '$safeSlot'", e)
                            try {
                                snapshotsClient.discardAndClose(snapshot)
                            } catch (_: Exception) {
                                // Ignore cleanup error
                            }
                            runOnActiveUiThread {
                                deliverCloudSnapshotErrorToWebView(slotKey, "PLAY_GAMES_SNAPSHOT_READ_FAILED")
                            }
                        }
                    }
                }
            }.addOnFailureListener { err ->
                Log.d(TAG, "No existing Play Games snapshot found for '$safeSlot'", err)
                deliverCloudSnapshotErrorToWebView(slotKey, "PLAY_GAMES_SNAPSHOT_READ_FAILED")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error pulling Play Games snapshot '$safeSlot'", e)
            deliverCloudSnapshotErrorToWebView(slotKey, "PLAY_GAMES_SNAPSHOT_READ_FAILED")
        }
    }

    private fun deliverCloudSnapshotToWebView(slotKey: String, payloadJson: String) {
        if (!isPageLoaded) return
        val safeSlot = CapyAndroidBridge.escapeJsString(slotKey)
        val safePayload = CapyAndroidBridge.escapeJsString(payloadJson)
        evaluateOnTrustedPage(
            """
            (function() {
                try {
                    if (window.__capyReceiveCloudSnapshot) {
                        window.__capyReceiveCloudSnapshot("$safeSlot", "$safePayload");
                    }
                } catch (e) {}
            })();
            """.trimIndent(),
        )
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView?.saveState(outState)
    }

    override fun onPause() {
        isActivityPaused = true
        webView?.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        isActivityPaused = false
        if (pendingRendererRecovery) {
            pendingRendererRecovery = false
            if (!isDestroyed && !isFinishing) {
                val record = rendererCrashGuard.recordExit()
                Log.w(
                    TAG,
                    "Completing deferred WebView renderer recovery on resume " +
                        "(recentRecoveries=${record.recentRecoveryCount}, " +
                        "totalExits=${record.totalExitCount}, action=${record.decision})",
                )
                when (record.decision) {
                    RendererCrashGuard.Decision.RECOVER -> mountWebView(savedInstanceState = null)
                    RendererCrashGuard.Decision.SHOW_FALLBACK -> showRendererCrashFallback()
                }
            }
            return
        }
        webView?.onResume()
    }

    override fun onDestroy() {
        isPageLoaded = false
        isTrustedPageLoaded = false
        pendingRendererRecovery = false
        fallbackView = null
        shareDecodeExecutor.shutdownNow()
        playGamesIoExecutor.shutdownNow()
        cancelFileUploadCallback()
        val wv = webView
        webView = null
        if (wv != null) {
            (wv.parent as? ViewGroup)?.removeView(wv)
            destroyWebViewSafely(wv)
        }
        if (::rootContainer.isInitialized) {
            rootContainer.removeAllViews()
        }
        super.onDestroy()
    }

    companion object {
        const val TAG = "CapyApp"
        const val START_URL = "https://appassets.androidplatform.net/assets/www/index.html"
        const val CLOUD_MANIFEST_SLOT_KEY = "capy_cloud_manifest_v2"
        private const val MAX_FALLBACK_INSET_CSS = 128

        internal fun isDebugCrashTestUrl(url: String?): Boolean {
            val candidate = url ?: return false
            return candidate.equals("chrome://crash", ignoreCase = true) ||
                candidate.equals("chrome://crash/", ignoreCase = true)
        }
    }
}
