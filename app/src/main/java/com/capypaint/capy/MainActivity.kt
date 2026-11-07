package com.capypaint.capy

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
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

class MainActivity : ComponentActivity() {

    private var webView: WebView? = null
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    private lateinit var bridge: CapyAndroidBridge
    private var isPageLoaded: Boolean = false

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
        )

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        val wv = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            setBackgroundColor(Color.BLACK)
            overScrollMode = View.OVER_SCROLL_NEVER
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
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
                    applySafeAreaInsetsToWebView()
                    deliverPendingSharedImageIfNeeded()
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    webView: WebView?,
                    filePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?,
                ): Boolean {
                    fileUploadCallback?.onReceiveValue(null)
                    fileUploadCallback = filePathCallback
                    return try {
                        pickMediaLauncher.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                        )
                        true
                    } catch (_: Exception) {
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
        if ((intent == null) || (intent.action != Intent.ACTION_SEND)) return
        val type = intent.type ?: return
        if (!type.startsWith("image/")) return

        val imageUri: Uri? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(Intent.EXTRA_STREAM)
        }
        if (imageUri == null) return

        try {
            val bytes = contentResolver.openInputStream(imageUri)?.use { it.readBytes() } ?: return
            val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
            val dataUrl = "data:$type;base64,$base64"
            val title = imageUri.lastPathSegment?.substringAfterLast('/') ?: "Shared Photo"
            bridge.pendingSharedImageJson = CapyAndroidBridge.formatSharedImageJson(title, dataUrl)
            if (isPageLoaded) {
                deliverPendingSharedImageIfNeeded()
            }
        } catch (_: Exception) {
            // Ignore unreadable URI
        }
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

    override fun onDestroy() {
        webView?.destroy()
        webView = null
        super.onDestroy()
    }

    companion object {
        const val START_URL = "https://appassets.androidplatform.net/assets/www/index.html"
    }
}
