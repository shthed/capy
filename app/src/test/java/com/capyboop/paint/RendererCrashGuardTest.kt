package com.capyboop.paint

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RendererCrashGuardTest {

    @Test
    fun `allows up to two automatic recoveries within 60 seconds then falls back on third crash`() {
        var nowMs = 1_000L
        val guard = RendererCrashGuard(clockMs = { nowMs })

        val first = guard.recordExit()
        assertEquals(RendererCrashGuard.Decision.RECOVER, first.decision)
        assertEquals(1, first.recentRecoveryCount)
        assertEquals(1, first.totalExitCount)

        nowMs += 15_000L
        val second = guard.recordExit()
        assertEquals(RendererCrashGuard.Decision.RECOVER, second.decision)
        assertEquals(2, second.recentRecoveryCount)
        assertEquals(2, second.totalExitCount)

        nowMs += 15_000L
        val third = guard.recordExit()
        assertEquals(RendererCrashGuard.Decision.SHOW_FALLBACK, third.decision)
        assertEquals(2, third.recentRecoveryCount)
        assertEquals(3, third.totalExitCount)
    }

    @Test
    fun `prunes expired recoveries once 60 second window elapses`() {
        var nowMs = 0L
        val guard = RendererCrashGuard(clockMs = { nowMs })

        assertEquals(RendererCrashGuard.Decision.RECOVER, guard.recordExit().decision)
        nowMs = 10_000L
        assertEquals(RendererCrashGuard.Decision.RECOVER, guard.recordExit().decision)

        // Still inside the 60s window for both recoveries
        nowMs = 59_999L
        assertEquals(RendererCrashGuard.Decision.SHOW_FALLBACK, guard.recordExit().decision)
        assertEquals(2, guard.recentRecoveryCount())

        // Exactly 60s after the first recovery: first expires, freeing one slot
        nowMs = 60_000L
        assertEquals(1, guard.recentRecoveryCount())
        val recovered = guard.recordExit()
        assertEquals(RendererCrashGuard.Decision.RECOVER, recovered.decision)
        assertEquals(2, recovered.recentRecoveryCount)
        assertEquals(4, recovered.totalExitCount)
    }

    @Test
    fun `reset clears recent recovery budget while preserving total telemetry exit count`() {
        var nowMs = 5_000L
        val guard = RendererCrashGuard(clockMs = { nowMs })

        assertEquals(RendererCrashGuard.Decision.RECOVER, guard.recordExit().decision)
        assertEquals(RendererCrashGuard.Decision.RECOVER, guard.recordExit().decision)
        assertEquals(RendererCrashGuard.Decision.SHOW_FALLBACK, guard.recordExit().decision)

        guard.reset()
        assertEquals(0, guard.recentRecoveryCount())
        assertEquals(3, guard.totalExitCount())

        nowMs += 1_000L
        val afterReset = guard.recordExit()
        assertEquals(RendererCrashGuard.Decision.RECOVER, afterReset.decision)
        assertEquals(1, afterReset.recentRecoveryCount)
        assertEquals(4, afterReset.totalExitCount)
    }

    @Test
    fun `zero maxRecoveries immediately shows fallback`() {
        val guard = RendererCrashGuard(maxRecoveries = 0, windowMs = 60_000L, clockMs = { 0L })
        val record = guard.recordExit()
        assertEquals(RendererCrashGuard.Decision.SHOW_FALLBACK, record.decision)
        assertEquals(0, record.recentRecoveryCount)
        assertEquals(1, record.totalExitCount)
    }

    @Test
    fun `repeated fallback exits do not extend recovery window expiration`() {
        var nowMs = 1_000L
        val guard = RendererCrashGuard(clockMs = { nowMs })

        assertEquals(RendererCrashGuard.Decision.RECOVER, guard.recordExit().decision)
        nowMs = 11_000L
        assertEquals(RendererCrashGuard.Decision.RECOVER, guard.recordExit().decision)

        // Multiple fallback exits inside the window must not append recovery timestamps
        nowMs = 30_000L
        assertEquals(RendererCrashGuard.Decision.SHOW_FALLBACK, guard.recordExit().decision)
        nowMs = 50_000L
        assertEquals(RendererCrashGuard.Decision.SHOW_FALLBACK, guard.recordExit().decision)
        assertEquals(2, guard.recentRecoveryCount())
        assertEquals(4, guard.totalExitCount())

        // 60s after the first recovery (1_000 + 60_000 = 61_000): first slot expires despite fallback exits
        nowMs = 61_000L
        assertEquals(1, guard.recentRecoveryCount())
        val recovered = guard.recordExit()
        assertEquals(RendererCrashGuard.Decision.RECOVER, recovered.decision)
        assertEquals(2, recovered.recentRecoveryCount)
        assertEquals(5, recovered.totalExitCount)
    }

    @Test
    fun `handles signed 64-bit subtraction overflow and backwards clock jumps safely`() {
        // Case 1: oldest = -10L, now = Long.MAX_VALUE (now - oldest overflows signed 64-bit Long)
        var nowMs = -10L
        val overflowGuard = RendererCrashGuard(maxRecoveries = 1, windowMs = 60_000L, clockMs = { nowMs })
        assertEquals(RendererCrashGuard.Decision.RECOVER, overflowGuard.recordExit().decision)
        nowMs = Long.MAX_VALUE
        assertEquals(0, overflowGuard.recentRecoveryCount())
        assertEquals(RendererCrashGuard.Decision.RECOVER, overflowGuard.recordExit().decision)

        // Case 2: oldest = Long.MIN_VALUE, now = 0L (0L - Long.MIN_VALUE == Long.MIN_VALUE < 0L)
        nowMs = Long.MIN_VALUE
        val minValueGuard = RendererCrashGuard(maxRecoveries = 1, windowMs = 60_000L, clockMs = { nowMs })
        assertEquals(RendererCrashGuard.Decision.RECOVER, minValueGuard.recordExit().decision)
        nowMs = 0L
        assertEquals(0, minValueGuard.recentRecoveryCount())
        assertEquals(RendererCrashGuard.Decision.RECOVER, minValueGuard.recordExit().decision)

        // Case 3: nanoTime() / 1_000_000L wraparound from positive max to negative min
        nowMs = Long.MAX_VALUE / 1_000_000L
        val wrapGuard = RendererCrashGuard(maxRecoveries = 1, windowMs = 60_000L, clockMs = { nowMs })
        assertEquals(RendererCrashGuard.Decision.RECOVER, wrapGuard.recordExit().decision)
        nowMs = (Long.MIN_VALUE / 1_000_000L) + 120_000L
        assertEquals(0, wrapGuard.recentRecoveryCount())
        assertEquals(RendererCrashGuard.Decision.RECOVER, wrapGuard.recordExit().decision)

        // Case 4: backwards clock jump must never pin a stale entry at the deque head
        nowMs = 100_000L
        val jumpGuard = RendererCrashGuard(maxRecoveries = 2, windowMs = 60_000L, clockMs = { nowMs })
        assertEquals(RendererCrashGuard.Decision.RECOVER, jumpGuard.recordExit().decision)
        nowMs = 50_000L
        val afterJump = jumpGuard.recordExit()
        assertEquals(RendererCrashGuard.Decision.RECOVER, afterJump.decision)
        assertEquals(1, afterJump.recentRecoveryCount)
        nowMs = 115_000L
        assertEquals(0, jumpGuard.recentRecoveryCount())

        // Case 5: windowMs = Long.MAX_VALUE preserves exact boundary behavior
        nowMs = 0L
        val maxWindowGuard = RendererCrashGuard(maxRecoveries = 1, windowMs = Long.MAX_VALUE, clockMs = { nowMs })
        assertEquals(RendererCrashGuard.Decision.RECOVER, maxWindowGuard.recordExit().decision)
        nowMs = Long.MAX_VALUE - 1L
        assertEquals(RendererCrashGuard.Decision.SHOW_FALLBACK, maxWindowGuard.recordExit().decision)
        nowMs = Long.MAX_VALUE
        assertEquals(0, maxWindowGuard.recentRecoveryCount())
        assertEquals(RendererCrashGuard.Decision.RECOVER, maxWindowGuard.recordExit().decision)
    }

    @Test
    fun `rejects invalid guard parameters`() {
        assertThrows(IllegalArgumentException::class.java) {
            RendererCrashGuard(maxRecoveries = -1)
        }
        assertThrows(IllegalArgumentException::class.java) {
            RendererCrashGuard(windowMs = 0L)
        }
        assertThrows(IllegalArgumentException::class.java) {
            RendererCrashGuard(windowMs = -1_000L)
        }
    }

    @Test
    fun `isDebugCrashTestUrl matches canonicalized chrome crash URLs and rejects all other inputs`() {
        assertTrue(MainActivity.isDebugCrashTestUrl("chrome://crash"))
        assertTrue(MainActivity.isDebugCrashTestUrl("chrome://crash/"))
        assertTrue(MainActivity.isDebugCrashTestUrl("CHROME://CRASH"))
        assertTrue(MainActivity.isDebugCrashTestUrl("CHROME://CRASH/"))

        assertFalse(MainActivity.isDebugCrashTestUrl("chrome://crash?x=1"))
        assertFalse(MainActivity.isDebugCrashTestUrl("chrome://crash#bar"))
        assertFalse(MainActivity.isDebugCrashTestUrl("chrome://crash/sub"))
        assertFalse(MainActivity.isDebugCrashTestUrl("chrome://version"))
        assertFalse(MainActivity.isDebugCrashTestUrl(" chrome://crash "))
        assertFalse(MainActivity.isDebugCrashTestUrl("chrome://crash\n"))
        assertFalse(MainActivity.isDebugCrashTestUrl(""))
        assertFalse(MainActivity.isDebugCrashTestUrl(null))
    }

    @Test
    fun `MainActivity handles onRenderProcessGone by destroying dead WebView and recreating via createWebView`() {
        val mainActivitySrc = resolveRepoFile("app/src/main/java/com/capyboop/paint/MainActivity.kt").readText()

        assertTrue(
            "MainActivity must override onRenderProcessGone to prevent app termination",
            mainActivitySrc.contains("override fun onRenderProcessGone("),
        )
        assertTrue(
            "MainActivity must construct WebViews via reusable createWebView() with CapyAndroidBridge attached",
            mainActivitySrc.contains("private fun createWebView(): WebView") &&
                mainActivitySrc.contains("addJavascriptInterface(bridge, \"CapyAndroid\")"),
        )
        assertTrue(
            "MainActivity must guard renderer recoveries with RendererCrashGuard",
            mainActivitySrc.contains("RendererCrashGuard()") &&
                mainActivitySrc.contains("RendererCrashGuard.Decision.RECOVER") &&
                mainActivitySrc.contains("RendererCrashGuard.Decision.SHOW_FALLBACK"),
        )
        assertTrue(
            "MainActivity must show a Tap to reload fallback when crash recovery budget is exhausted",
            mainActivitySrc.contains("Tap to reload") &&
                mainActivitySrc.contains("rendererCrashGuard.reset()"),
        )
        assertTrue(
            "MainActivity must destroy the terminated WebView during recovery",
            mainActivitySrc.contains("destroyWebViewSafely(view)"),
        )

        val handleRenderProcessGoneMatch = Regex(
            """private fun handleRenderProcessGone\([\s\S]*?\n    \}""",
        ).find(mainActivitySrc)
        assertTrue(
            "MainActivity must define handleRenderProcessGone()",
            handleRenderProcessGoneMatch != null,
        )
        val handleBody = handleRenderProcessGoneMatch!!.value
        val webViewNullIdx = handleBody.indexOf("webView = null")
        val resetModalIdx = handleBody.indexOf("bridge.resetModalState()")
        assertTrue(
            "handleRenderProcessGone must null webView BEFORE calling bridge.resetModalState()",
            (webViewNullIdx >= 0) && (resetModalIdx > webViewNullIdx),
        )
        assertTrue(
            "handleRenderProcessGone must reset modal state unconditionally via bridge.resetModalState()",
            !handleBody.contains("bridge.setModalOpen(false)"),
        )
        assertTrue(
            "handleRenderProcessGone must cancel pending fileUploadCallback via cancelFileUploadCallback()",
            handleBody.contains("cancelFileUploadCallback()"),
        )
        assertTrue(
            "handleRenderProcessGone must defer recovery when activity is paused",
            handleBody.contains("if (isActivityPaused)") &&
                handleBody.contains("pendingRendererRecovery = true") &&
                handleBody.contains("action=DEFER_UNTIL_RESUME"),
        )

        val cancelFileUploadMatch = Regex(
            """private fun cancelFileUploadCallback\(\)\s*\{[\s\S]*?\n    \}""",
        ).find(mainActivitySrc)
        assertTrue("MainActivity must define cancelFileUploadCallback()", cancelFileUploadMatch != null)
        val cancelBody = cancelFileUploadMatch!!.value
        val clearFieldIdx = cancelBody.indexOf("fileUploadCallback = null")
        val invokeCallbackIdx = cancelBody.indexOf("callback?.onReceiveValue(null)")
        assertTrue(
            "cancelFileUploadCallback must clear fileUploadCallback before invoking onReceiveValue(null) inside try/catch",
            (clearFieldIdx >= 0) &&
                (invokeCallbackIdx > clearFieldIdx) &&
                cancelBody.contains("try {") &&
                cancelBody.contains("catch (e: Exception)"),
        )

        val onDestroyMatch = Regex(
            """override fun onDestroy\(\)\s*\{[\s\S]*?\n    \}""",
        ).find(mainActivitySrc)
        assertTrue("MainActivity must override onDestroy()", onDestroyMatch != null)
        val onDestroyBody = onDestroyMatch!!.value
        assertTrue(
            "onDestroy must cancel fileUploadCallback, clear fallback/pending state, detach webView, and call destroyWebViewSafely",
            onDestroyBody.contains("cancelFileUploadCallback()") &&
                onDestroyBody.contains("fallbackView = null") &&
                onDestroyBody.contains("pendingRendererRecovery = false") &&
                onDestroyBody.contains("removeView(wv)") &&
                onDestroyBody.contains("destroyWebViewSafely(wv)"),
        )

        val onPauseMatch = Regex(
            """override fun onPause\(\)\s*\{[\s\S]*?\n    \}""",
        ).find(mainActivitySrc)
        assertTrue("MainActivity must override onPause()", onPauseMatch != null)
        val onPauseBody = onPauseMatch!!.value
        assertTrue(
            "onPause must set isActivityPaused = true before pausing WebView",
            onPauseBody.indexOf("isActivityPaused = true") in 0 until onPauseBody.indexOf("webView?.onPause()"),
        )

        val onResumeMatch = Regex(
            """override fun onResume\(\)\s*\{[\s\S]*?\n    \}""",
        ).find(mainActivitySrc)
        assertTrue("MainActivity must override onResume()", onResumeMatch != null)
        val onResumeBody = onResumeMatch!!.value
        assertTrue(
            "onResume must clear isActivityPaused and complete pendingRendererRecovery via rendererCrashGuard",
            onResumeBody.contains("isActivityPaused = false") &&
                onResumeBody.contains("if (pendingRendererRecovery)") &&
                onResumeBody.contains("pendingRendererRecovery = false") &&
                onResumeBody.contains("rendererCrashGuard.recordExit()"),
        )

        val mountWebViewMatch = Regex(
            """private fun mountWebView\([\s\S]*?\n    \}""",
        ).find(mainActivitySrc)
        assertTrue("MainActivity must define mountWebView()", mountWebViewMatch != null)
        val mountBody = mountWebViewMatch!!.value
        assertTrue(
            "mountWebView must catch WebView creation/mount exceptions and fall back to showRendererCrashFallback()",
            mountBody.contains("try {") &&
                mountBody.contains("catch (e: Exception)") &&
                mountBody.contains("showRendererCrashFallback()"),
        )

        val onShowFileChooserMatch = Regex(
            """override fun onShowFileChooser\([\s\S]*?\n                \}""",
        ).find(mainActivitySrc)
        assertTrue("MainActivity must override onShowFileChooser()", onShowFileChooserMatch != null)
        val fileChooserBody = onShowFileChooserMatch!!.value
        val staleGuardMatch = Regex(
            """if \(webView !== this@MainActivity\.webView\)\s*\{[\s\S]*?return true\s*\}""",
        ).find(fileChooserBody)
        assertTrue(
            "onShowFileChooser stale-WebView guard must invoke onReceiveValue(null) safely and return true",
            (staleGuardMatch != null) &&
                staleGuardMatch.value.contains("filePathCallback?.onReceiveValue(null)") &&
                !staleGuardMatch.value.contains("return false"),
        )

        val applyPaddingMatch = Regex(
            """private fun applyFallbackSafeAreaPadding\([\s\S]*?\n    \}""",
        ).find(mainActivitySrc)
        assertTrue("MainActivity must define applyFallbackSafeAreaPadding()", applyPaddingMatch != null)
        val applyPaddingBody = applyPaddingMatch!!.value
        assertTrue(
            "applyFallbackSafeAreaPadding must clamp all 4 safe-area insets with coerceIn",
            applyPaddingBody.contains("bridge.safeAreaLeftCss.coerceIn(0, MAX_FALLBACK_INSET_CSS)") &&
                applyPaddingBody.contains("bridge.safeAreaRightCss.coerceIn(0, MAX_FALLBACK_INSET_CSS)") &&
                applyPaddingBody.contains("bridge.safeAreaTopCss.coerceIn(0, MAX_FALLBACK_INSET_CSS)") &&
                applyPaddingBody.contains("bridge.safeAreaBottomCss.coerceIn(0, MAX_FALLBACK_INSET_CSS)"),
        )
        assertTrue(
            "OnApplyWindowInsetsListener must update active fallbackView padding live on rotation/resize",
            mainActivitySrc.contains("fallbackView?.let { applyFallbackSafeAreaPadding(it) }"),
        )

        val evaluateMatch = Regex(
            """private fun evaluateOnTrustedPage\([^)]*\)\s*\{[\s\S]*?\n    \}""",
        ).find(mainActivitySrc)
        assertTrue("MainActivity must define evaluateOnTrustedPage()", evaluateMatch != null)
        assertTrue(
            "evaluateOnTrustedPage must guard against stale or torn-down WebViews inside wv.post",
            evaluateMatch!!.value.contains("wv !== webView"),
        )

        val shouldInterceptMatch = Regex(
            """override fun shouldInterceptRequest\([\s\S]*?\n                \}""",
        ).find(mainActivitySrc)
        assertTrue("MainActivity must override shouldInterceptRequest()", shouldInterceptMatch != null)
        val shouldInterceptBody = shouldInterceptMatch!!.value
        assertTrue(
            "shouldInterceptRequest must gate isDebugCrashTestUrl behind BuildConfig.DEBUG and request.isForMainFrame",
            shouldInterceptBody.contains("BuildConfig.DEBUG") &&
                shouldInterceptBody.contains("request.isForMainFrame") &&
                shouldInterceptBody.contains("isDebugCrashTestUrl(reqUrl.toString())"),
        )

        val shouldOverrideMatch = Regex(
            """override fun shouldOverrideUrlLoading\([\s\S]*?\n                \}""",
        ).find(mainActivitySrc)
        assertTrue("MainActivity must override shouldOverrideUrlLoading()", shouldOverrideMatch != null)
        val shouldOverrideBody = shouldOverrideMatch!!.value
        assertTrue(
            "shouldOverrideUrlLoading must ignore stale WebViews and gate isDebugCrashTestUrl behind BuildConfig.DEBUG and request.isForMainFrame",
            shouldOverrideBody.contains("if (view !== webView) return true") &&
                shouldOverrideBody.contains("BuildConfig.DEBUG") &&
                shouldOverrideBody.contains("request.isForMainFrame") &&
                shouldOverrideBody.contains("isDebugCrashTestUrl(targetUrl)"),
        )
    }

    private fun resolveRepoFile(relativePath: String): File {
        val candidates = listOf(
            File(relativePath),
            File("..", relativePath),
        )
        return candidates.firstOrNull { it.exists() }
            ?: error("Could not locate $relativePath from ${File(".").absolutePath}")
    }
}
