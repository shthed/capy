package com.capyboop.paint

import android.annotation.TargetApi
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import android.view.View
import android.webkit.JavascriptInterface
import java.io.File
import java.net.URI
import java.util.concurrent.atomic.AtomicReference

class CapyAndroidBridge(
    private val context: Context,
    private val rootViewProvider: () -> View?,
    private val onModalStateChanged: (Boolean) -> Unit,
    private val onRequestPlayGamesSignIn: (() -> Unit)? = null,
    private val onSaveCloudSnapshot: ((String, String) -> Unit)? = null,
    private val onRequestCloudSnapshotPull: ((String) -> Unit)? = null,
    private val isPlayGamesConfiguredProvider: () -> Boolean = {
        isPlayGamesAppIdConfigured(readPlayGamesAppId(context))
    },
    private val originGuard: () -> Boolean = { true },
) {
    private val backupStorageDelegate = BackupStorageDelegate(
        backupDirProvider = { File(context.filesDir, BACKUP_FOLDER_NAME) },
    )

    private val playGamesSnapshotDelegate = PlayGamesSnapshotDelegate(
        context = context,
        cloudDirProvider = { File(context.filesDir, CLOUD_FOLDER_NAME) },
        onRequestPlayGamesSignIn = onRequestPlayGamesSignIn,
        onSaveCloudSnapshot = onSaveCloudSnapshot,
        onRequestCloudSnapshotPull = onRequestCloudSnapshotPull,
        isPlayGamesConfiguredProvider = isPlayGamesConfiguredProvider,
    )

    private val shareExportDelegate = ShareExportDelegate(
        context = context,
        cacheDirProvider = { context.cacheDir },
    )

    private val hapticsDelegate = HapticsDelegate(
        context = context,
        rootViewProvider = rootViewProvider,
    )

    @Volatile
    var isModalOpen: Boolean = false
        private set

    private val pendingSharedImageRef = AtomicReference<String?>(null)
    private val pendingDeepLinkRef = AtomicReference<String?>(null)
    private val pendingOAuthCallbackRef = AtomicReference<String?>(null)

    var pendingSharedImageJson: String?
        get() = pendingSharedImageRef.get()
        set(value) {
            pendingSharedImageRef.set(value)
        }

    var pendingDeepLinkUrl: String?
        get() = pendingDeepLinkRef.get()
        set(value) {
            pendingDeepLinkRef.set(value)
        }

    var pendingOAuthCallbackUrl: String?
        get() = pendingOAuthCallbackRef.get()
        set(value) {
            pendingOAuthCallbackRef.set(value)
        }

    @Volatile
    var safeAreaTopCss: Int = 0

    @Volatile
    var safeAreaBottomCss: Int = 0

    @Volatile
    var safeAreaLeftCss: Int = 0

    @Volatile
    var safeAreaRightCss: Int = 0

    fun updateSafeAreaInsets(top: Int, bottom: Int, left: Int, right: Int) {
        safeAreaTopCss = top
        safeAreaBottomCss = bottom
        safeAreaLeftCss = left
        safeAreaRightCss = right
    }

    @JavascriptInterface
    fun getSafeAreaInsets(): String {
        return formatSafeAreaInsetsJson(safeAreaTopCss, safeAreaBottomCss, safeAreaLeftCss, safeAreaRightCss)
    }

    @JavascriptInterface
    fun haptic(type: String) {
        if (!originGuard()) return
        hapticsDelegate.haptic(type)
    }

    @JavascriptInterface
    fun setModalOpen(isOpen: Boolean) {
        if (!originGuard()) return
        Log.d(TAG, "Modal state updated: isOpen=$isOpen")
        isModalOpen = isOpen
        onModalStateChanged(isOpen)
    }

    internal fun resetModalState() {
        isModalOpen = false
        onModalStateChanged(false)
    }

    @JavascriptInterface
    fun saveBackup(key: String, data: String): Boolean {
        if (!originGuard()) return false
        return backupStorageDelegate.saveBackup(key, data)
    }

    @JavascriptInterface
    fun loadBackup(key: String): String? {
        if (!originGuard()) return null
        return backupStorageDelegate.loadBackup(key)
    }

    fun saveLocalCloudSnapshotOnly(slotKey: String, payloadJson: String): Boolean {
        return playGamesSnapshotDelegate.saveLocalCloudSnapshotOnly(slotKey, payloadJson)
    }

    @JavascriptInterface
    fun saveCloudSnapshot(slotKey: String, payloadJson: String): Boolean {
        if (!originGuard()) return false
        return playGamesSnapshotDelegate.saveCloudSnapshot(slotKey, payloadJson)
    }

    @JavascriptInterface
    fun loadCloudSnapshot(slotKey: String): String? {
        if (!originGuard()) return null
        return playGamesSnapshotDelegate.loadCloudSnapshot(slotKey)
    }

    @JavascriptInterface
    fun saveCloudBinaryChunk(
        blobKey: String,
        chunkIndex: Int,
        totalChunks: Int,
        base64Chunk: String,
    ): Boolean {
        if (!originGuard()) return false
        return playGamesSnapshotDelegate.saveCloudBinaryChunk(
            blobKey = blobKey,
            chunkIndex = chunkIndex,
            totalChunks = totalChunks,
            base64Chunk = base64Chunk,
        )
    }

    @JavascriptInterface
    fun loadCloudBinaryChunk(blobKey: String, chunkIndex: Int): String? {
        if (!originGuard()) return null
        return playGamesSnapshotDelegate.loadCloudBinaryChunk(blobKey, chunkIndex)
    }

    @JavascriptInterface
    fun isPlayGamesConfigured(): Boolean {
        if (!originGuard()) return false
        return playGamesSnapshotDelegate.isPlayGamesConfigured()
    }

    @JavascriptInterface
    fun requestCloudSnapshotPull(slotKey: String): Boolean {
        if (!originGuard()) return false
        return playGamesSnapshotDelegate.requestCloudSnapshotPull(slotKey)
    }

    fun cachePlayGamesProfile(playerId: String, displayName: String) {
        playGamesSnapshotDelegate.cachePlayGamesProfile(playerId, displayName)
    }

    fun loadCachedPlayGamesProfileJson(): String? {
        return playGamesSnapshotDelegate.loadCachedPlayGamesProfileJson()
    }

    @JavascriptInterface
    fun signInPlayGames(): String? {
        if (!originGuard()) return null
        return playGamesSnapshotDelegate.signInPlayGames()
    }

    @JavascriptInterface
    fun consumePendingSharedImage(): String? {
        if (!originGuard()) return null
        return pendingSharedImageRef.getAndSet(null)
    }

    fun consumePendingOAuthCallbackInternal(): String? {
        return pendingOAuthCallbackRef.getAndSet(null)
    }

    @JavascriptInterface
    fun openExternalOAuth(authUrl: String): Boolean {
        if (!originGuard()) return false
        if (!isAllowedExternalOAuthUrl(authUrl)) {
            Log.w(TAG, "Blocked untrusted external OAuth URL: $authUrl")
            return false
        }
        return try {
            val viewIntent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse(authUrl.trim())).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(viewIntent)
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch external OAuth browser", e)
            false
        }
    }

    @JavascriptInterface
    fun consumePendingDeepLink(): String? {
        if (!originGuard()) return null
        return pendingDeepLinkRef.getAndSet(null)
    }

    @JavascriptInterface
    @Suppress("unused")
    fun getAppVersion(): String {
        return BuildConfig.VERSION_NAME
    }

    @JavascriptInterface
    fun shareTextLink(title: String, url: String) {
        if (!originGuard()) return
        shareExportDelegate.shareTextLink(title, url)
    }

    @JavascriptInterface
    fun shareImage(title: String, dataUrl: String) {
        if (!originGuard()) return
        shareExportDelegate.shareImage(title, dataUrl)
    }

    @JavascriptInterface
    fun shareFile(title: String, fileName: String, mimeType: String, base64Data: String) {
        if (!originGuard()) return
        shareExportDelegate.shareFile(title, fileName, mimeType, base64Data)
    }

    enum class WebViewNavigationAction {
        ALLOW_INTERNAL,
        OPEN_EXTERNAL,
        BLOCK,
    }

    enum class SnapshotPushDecision {
        COMMIT_INCOMING,
        SKIP_IDENTICAL,
        MERGE_UNSEEN_REMOTE,
    }

    data class ShareImageSpec(
        val fileName: String,
        val mimeType: String,
        val base64Payload: String,
    )

    data class HapticSpec(
        val normalizedType: String,
        val viewConstant: Int?,
        val predefinedEffectId: Int?,
        val oneShotDurationMs: Long?,
        val waveformTimings: LongArray?,
    ) {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (javaClass != other?.javaClass) return false
            other as HapticSpec
            if (normalizedType != other.normalizedType) return false
            if (viewConstant != other.viewConstant) return false
            if (predefinedEffectId != other.predefinedEffectId) return false
            if (oneShotDurationMs != other.oneShotDurationMs) return false
            if (waveformTimings != null) {
                if (other.waveformTimings == null) return false
                if (!waveformTimings.contentEquals(other.waveformTimings)) return false
            } else if (other.waveformTimings != null) {
                return false
            }
            return true
        }

        override fun hashCode(): Int {
            var result = normalizedType.hashCode()
            result = 31 * result + (viewConstant ?: 0)
            result = 31 * result + (predefinedEffectId ?: 0)
            result = 31 * result + (oneShotDurationMs?.hashCode() ?: 0)
            result = 31 * result + (waveformTimings?.contentHashCode() ?: 0)
            return result
        }
    }

    internal object Api26FileMover {
        @TargetApi(Build.VERSION_CODES.O)
        fun moveReplacing(source: File, target: File): Boolean {
            return BackupStorageDelegate.Api26FileMover.moveReplacing(source, target)
        }
    }

    companion object {
        const val TAG = "CapyBridge"
        const val BACKUP_FOLDER_NAME = BackupStorageDelegate.BACKUP_FOLDER_NAME
        const val CLOUD_FOLDER_NAME = PlayGamesSnapshotDelegate.CLOUD_FOLDER_NAME
        const val SHARE_FOLDER_NAME = ShareExportDelegate.SHARE_FOLDER_NAME
        const val SHARED_FILE_MAX_AGE_MS = ShareExportDelegate.SHARED_FILE_MAX_AGE_MS
        const val PLAY_GAMES_PREFS_NAME = PlayGamesSnapshotDelegate.PLAY_GAMES_PREFS_NAME
        const val KEY_PLAY_GAMES_PLAYER_ID = PlayGamesSnapshotDelegate.KEY_PLAY_GAMES_PLAYER_ID
        const val KEY_PLAY_GAMES_DISPLAY_NAME = PlayGamesSnapshotDelegate.KEY_PLAY_GAMES_DISPLAY_NAME
        const val ALLOWED_DEEP_LINK_HOST = "capypaint.com"
        const val APP_ASSETS_HOST = "appassets.androidplatform.net"
        const val APP_ASSETS_ORIGIN = "https://$APP_ASSETS_HOST"
        const val MAX_BACKUP_PAYLOAD_CHARS = BackupStorageDelegate.MAX_BACKUP_PAYLOAD_CHARS
        const val MAX_SHARE_FILE_BYTES = ShareExportDelegate.MAX_SHARE_FILE_BYTES
        const val MAX_SHARE_BASE64_CHARS = ShareExportDelegate.MAX_SHARE_BASE64_CHARS
        const val MAX_SHARED_IMAGE_DIMENSION = ShareExportDelegate.MAX_SHARED_IMAGE_DIMENSION
        const val MAX_RAW_SHARED_IMAGE_BYTES = ShareExportDelegate.MAX_RAW_SHARED_IMAGE_BYTES
        const val IMAGE_MAGIC_HEADER_BYTES = ShareExportDelegate.IMAGE_MAGIC_HEADER_BYTES
        const val DEFAULT_CLOUD_BINARY_CHUNK_BYTES = PlayGamesSnapshotDelegate.DEFAULT_CLOUD_BINARY_CHUNK_BYTES
        const val MAX_CLOUD_BINARY_CHUNKS = PlayGamesSnapshotDelegate.MAX_CLOUD_BINARY_CHUNKS
        const val MAX_CLOUD_BINARY_TOTAL_BYTES = PlayGamesSnapshotDelegate.MAX_CLOUD_BINARY_TOTAL_BYTES
        const val MAX_CLOUD_BINARY_CHUNK_CHARS = PlayGamesSnapshotDelegate.MAX_CLOUD_BINARY_CHUNK_CHARS
        val ROOT_DEEP_LINK_HOSTS = setOf("capypaint.com", "www.capypaint.com", "paint.capyboop.com")
        val GITHUB_PAGES_DEEP_LINK_HOSTS = setOf("shthed.github.io", "capyboop.github.io")

        fun isPlayGamesAppIdConfigured(appId: String?): Boolean {
            return PlayGamesSnapshotDelegate.isPlayGamesAppIdConfigured(appId)
        }

        fun readPlayGamesAppId(context: Context): String? {
            return PlayGamesSnapshotDelegate.readPlayGamesAppId(context)
        }

        /**
         * Returns true when CAPY_ANDROID_SHA256_CERT_FINGERPRINTS contains at least one
         * valid non-zero SHA-256 certificate fingerprint (colon-separated or 64-char hex).
         */
        fun isAppLinksCertConfigured(fingerprintsEnv: String?): Boolean {
            if (fingerprintsEnv.isNullOrBlank()) return false
            val hex64Regex = Regex("^[0-9A-F]{64}$")
            val colonSha256Regex = Regex("^([0-9A-F]{2}:){31}[0-9A-F]{2}$")
            val allZeroRegex = Regex("^(00:){31}00$")
            return fingerprintsEnv
                .split(Regex("[,;\\s]+"))
                .map { token ->
                    val upper = token.trim().uppercase()
                    if (hex64Regex.matches(upper)) {
                        upper.chunked(2).joinToString(":")
                    } else {
                        upper
                    }
                }
                .any { candidate ->
                    colonSha256Regex.matches(candidate) && !allZeroRegex.matches(candidate)
                }
        }

        fun sanitizeKey(key: String): String = BackupStorageDelegate.sanitizeKey(key)

        fun sanitizeFileName(fileName: String): String = BackupStorageDelegate.sanitizeFileName(fileName)

        /**
         * Returns true when a WebView `<input type="file">` exclusively requests image media
         * (for example image MIME wildcards or extensions), and false when `.capy`, `.json`, or generic documents are requested.
         */
        fun shouldUsePhotoPicker(acceptTypes: Array<String>?): Boolean {
            if (acceptTypes == null) return false
            val nonBlank = acceptTypes
                .flatMap { it.split(',') }
                .map { it.trim().lowercase() }
                .filter { it.isNotEmpty() }
            if (nonBlank.isEmpty()) return false
            return nonBlank.all { token ->
                token.startsWith("image/") ||
                    token == ".png" ||
                    token == ".jpg" ||
                    token == ".jpeg" ||
                    token == ".webp" ||
                    token == ".gif" ||
                    token == ".bmp"
            }
        }

        internal fun shouldUseAtomicNioMove(sdkInt: Int = Build.VERSION.SDK_INT): Boolean {
            return BackupStorageDelegate.shouldUseAtomicNioMove(sdkInt)
        }

        fun saveBackupToDir(dir: File, key: String, data: String): Boolean {
            return BackupStorageDelegate.saveBackupToDir(dir, key, data)
        }

        fun loadBackupFromDir(dir: File, key: String): String? {
            return BackupStorageDelegate.loadBackupFromDir(dir, key)
        }

        fun formatCloudBinaryChunkSlotKey(blobKey: String, chunkIndex: Int): String {
            return PlayGamesSnapshotDelegate.formatCloudBinaryChunkSlotKey(blobKey, chunkIndex)
        }

        fun saveCloudBinaryChunkToDir(
            dir: File,
            blobKey: String,
            chunkIndex: Int,
            totalChunks: Int,
            base64Chunk: String,
        ): Boolean {
            return PlayGamesSnapshotDelegate.saveCloudBinaryChunkToDir(
                dir = dir,
                blobKey = blobKey,
                chunkIndex = chunkIndex,
                totalChunks = totalChunks,
                base64Chunk = base64Chunk,
            )
        }

        fun loadCloudBinaryChunkFromDir(dir: File, blobKey: String, chunkIndex: Int): String? {
            return PlayGamesSnapshotDelegate.loadCloudBinaryChunkFromDir(dir, blobKey, chunkIndex)
        }

        fun saveCloudBinaryBytesToDir(
            dir: File,
            blobKey: String,
            bytes: ByteArray,
            chunkSizeBytes: Int = DEFAULT_CLOUD_BINARY_CHUNK_BYTES,
        ): Int {
            return PlayGamesSnapshotDelegate.saveCloudBinaryBytesToDir(dir, blobKey, bytes, chunkSizeBytes)
        }

        fun loadCloudBinaryBytesFromDir(dir: File, blobKey: String): ByteArray? {
            return PlayGamesSnapshotDelegate.loadCloudBinaryBytesFromDir(dir, blobKey)
        }

        fun resolveShareImageSpec(dataUrl: String): ShareImageSpec {
            return ShareExportDelegate.resolveShareImageSpec(dataUrl)
        }

        fun prepareSharedExportFile(
            cacheDir: File,
            fileName: String,
            nowMs: Long = System.currentTimeMillis(),
            maxAgeMs: Long = SHARED_FILE_MAX_AGE_MS,
        ): File {
            return ShareExportDelegate.prepareSharedExportFile(cacheDir, fileName, nowMs, maxAgeMs)
        }

        fun sanitizeShareTitle(
            rawTitle: String?,
            fallback: String = "",
            maxLength: Int = 120,
        ): String {
            return ShareExportDelegate.sanitizeShareTitle(rawTitle, fallback, maxLength)
        }

        fun resolveAllowedExportMimeType(rawMime: String?): String {
            return ShareExportDelegate.resolveAllowedExportMimeType(rawMime)
        }

        fun normalizeSharedImageMimeType(rawMime: String?): String {
            return ShareExportDelegate.normalizeSharedImageMimeType(rawMime)
        }

        fun isAllowedSharedImageDataUrl(dataUrl: String?): Boolean {
            return ShareExportDelegate.isAllowedSharedImageDataUrl(dataUrl)
        }

        fun isAllowedShareTextUrl(rawUrl: String?): Boolean {
            return ShareExportDelegate.isAllowedShareTextUrl(rawUrl)
        }

        fun isAllowedIncomingShareUriScheme(scheme: String?): Boolean {
            return ShareExportDelegate.isAllowedIncomingShareUriScheme(scheme)
        }

        fun isValidImageMagicBytes(header: ByteArray, length: Int = header.size): Boolean {
            return ShareExportDelegate.isValidImageMagicBytes(header, length)
        }

        fun classifyWebViewNavigation(rawUrl: String?): WebViewNavigationAction {
            if (rawUrl.isNullOrBlank()) return WebViewNavigationAction.BLOCK
            val trimmed = rawUrl.trim()
            if (trimmed.equals("about:blank", ignoreCase = true)) {
                return WebViewNavigationAction.ALLOW_INTERNAL
            }
            if (trimmed.any { it.isISOControl() }) return WebViewNavigationAction.BLOCK
            return try {
                val uri = URI(trimmed)
                if (uri.userInfo != null) return WebViewNavigationAction.BLOCK
                val scheme = uri.scheme?.lowercase() ?: return WebViewNavigationAction.BLOCK
                val host = uri.host?.lowercase()
                when {
                    scheme == "https" &&
                        host == APP_ASSETS_HOST &&
                        (uri.port == -1 || uri.port == 443) -> WebViewNavigationAction.ALLOW_INTERNAL
                    (scheme == "https" || scheme == "http") && !host.isNullOrBlank() -> WebViewNavigationAction.OPEN_EXTERNAL
                    else -> WebViewNavigationAction.BLOCK
                }
            } catch (_: Exception) {
                WebViewNavigationAction.BLOCK
            }
        }

        fun isTrustedPageUrl(rawUrl: String?): Boolean {
            if (rawUrl.isNullOrBlank()) return false
            val trimmed = rawUrl.trim()
            if (trimmed.any { it.isWhitespace() || it.isISOControl() }) return false
            return try {
                val uri = URI(trimmed)
                val scheme = uri.scheme?.lowercase() ?: return false
                val host = uri.host?.lowercase() ?: return false
                val path = uri.path
                scheme == "https" &&
                    host == APP_ASSETS_HOST &&
                    (uri.port == -1 || uri.port == 443) &&
                    uri.userInfo == null &&
                    (path.isNullOrEmpty() || path.startsWith("/"))
            } catch (_: Exception) {
                false
            }
        }

        fun isTrustedBridgeOrigin(origin: String?, isMainFrame: Boolean): Boolean {
            if (!isMainFrame || origin.isNullOrBlank()) return false
            val trimmed = origin.trim()
            if (trimmed.any { it.isWhitespace() || it.isISOControl() }) return false
            return try {
                val uri = URI(trimmed)
                val scheme = uri.scheme?.lowercase() ?: return false
                val host = uri.host?.lowercase() ?: return false
                scheme == "https" &&
                    host == APP_ASSETS_HOST &&
                    (uri.port == -1 || uri.port == 443) &&
                    uri.userInfo == null &&
                    uri.path.isNullOrEmpty() &&
                    uri.query == null &&
                    uri.fragment == null
            } catch (_: Exception) {
                false
            }
        }

        const val WEBVIEW_CONTENT_SECURITY_POLICY =
            "default-src 'self'; " +
                "script-src 'self' 'sha256-Aq5koStiHs7iOXZ0FstBiuWUfXvNHn4fqzL7j4yX+0Y=' " +
                "'sha256-oyhhX5B/ChcdXFJ02Q3hzScXh6cePvaGt0Gqh/iqeyY=' https://accounts.google.com/gsi/client; " +
                "script-src-attr 'none'; " +
                "style-src 'self' 'unsafe-inline' https://accounts.google.com; " +
                "img-src 'self' data: blob: https://*.googleusercontent.com; " +
                "font-src 'self' data:; " +
                "connect-src 'self' data: blob: https://capypaint.com https://paint.capyboop.com " +
                "https://www.googleapis.com https://oauth2.googleapis.com https://accounts.google.com " +
                "https://generativelanguage.googleapis.com " +
                "https://openrouter.ai https://api.openai.com https://api.x.ai " +
                "https://graph.microsoft.com https://login.microsoftonline.com " +
                "wss://capypaint.com wss://*.capypaint.com wss://paint.capyboop.com; " +
                "worker-src 'self' blob:; " +
                "frame-src https://accounts.google.com; " +
                "manifest-src 'self'; " +
                "media-src 'none'; " +
                "form-action 'self'; " +
                "object-src 'none'; " +
                "base-uri 'self'; " +
                "frame-ancestors 'self';"

        const val WEBVIEW_PRIVACY_POLICY_CSP =
            "default-src 'none'; script-src 'none'; script-src-attr 'none'; style-src 'unsafe-inline'; " +
                "img-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'self';"

        fun buildWebViewAssetResponseHeaders(
            mimeType: String?,
            path: String? = null,
        ): Map<String, String> {
            val headers = linkedMapOf(
                "X-Content-Type-Options" to "nosniff",
                "Referrer-Policy" to "strict-origin-when-cross-origin",
            )
            val normalizedMime = mimeType?.trim()?.lowercase()?.substringBefore(';')?.trim() ?: ""
            val normalizedPath = path?.trim()?.lowercase() ?: ""
            if ((normalizedMime == "text/html") || normalizedPath.endsWith(".html")) {
                headers["X-Frame-Options"] = "SAMEORIGIN"
                headers["Content-Security-Policy"] = if (normalizedPath.endsWith("/privacy-policy.html")) {
                    WEBVIEW_PRIVACY_POLICY_CSP
                } else {
                    WEBVIEW_CONTENT_SECURITY_POLICY
                }
            }
            return headers
        }

        fun shouldBlockDocumentRequest(
            url: String?,
            isForMainFrame: Boolean,
            secFetchDest: String?,
        ): Boolean {
            if (url.isNullOrBlank()) return false
            val trimmed = url.trim()
            if (trimmed.equals("about:blank", ignoreCase = true)) return false
            if (isTrustedPageUrl(trimmed)) return false
            val dest = secFetchDest?.trim()?.lowercase()
            return isForMainFrame || dest == "iframe" || dest == "frame" || dest == "document"
        }

        fun looksLikeJsonObject(raw: String?): Boolean {
            return PlayGamesSnapshotDelegate.looksLikeJsonObject(raw)
        }

        fun decideSnapshotPushAction(
            slotKey: String,
            existingRemotePayload: String?,
            lastKnownRemotePayload: String?,
            incomingPayload: String,
        ): SnapshotPushDecision {
            return PlayGamesSnapshotDelegate.decideSnapshotPushAction(
                slotKey = slotKey,
                existingRemotePayload = existingRemotePayload,
                lastKnownRemotePayload = lastKnownRemotePayload,
                incomingPayload = incomingPayload,
            )
        }

        fun escapeJsonString(value: String, replaceNewlinesWithSpace: Boolean = false): String {
            val sb = StringBuilder(value.length + 16)
            for (ch in value) {
                when {
                    ch == '\\' -> sb.append("\\\\")
                    ch == '"' -> sb.append("\\\"")
                    ch == '\b' -> sb.append("\\b")
                    ch == '\u000C' -> sb.append("\\f")
                    ch == '\n' || ch == '\r' -> {
                        if (replaceNewlinesWithSpace) {
                            sb.append(' ')
                        } else if (ch == '\n') {
                            sb.append("\\n")
                        } else {
                            sb.append("\\r")
                        }
                    }
                    ch == '\t' -> sb.append("\\t")
                    ch == '<' -> sb.append("\\u003c")
                    ch == '>' -> sb.append("\\u003e")
                    ch < ' ' || ch == '\u2028' || ch == '\u2029' -> {
                        sb.append("\\u").append(ch.code.toString(16).padStart(4, '0'))
                    }
                    else -> sb.append(ch)
                }
            }
            return sb.toString()
        }

        fun formatSharedImageJson(title: String, dataUrl: String): String {
            return ShareExportDelegate.formatSharedImageJson(title, dataUrl)
        }

        fun escapeJsString(value: String): String {
            val escaped = escapeJsonString(value, replaceNewlinesWithSpace = true)
            return escaped.replace("'", "\\'")
        }

        /**
         * Validates incoming Android App Link URIs so only HTTPS URLs under `ROOT_DEEP_LINK_HOSTS`
         * (`capypaint.com`, `www.capypaint.com`, `paint.capyboop.com`) or verified GitHub Pages
         * `/capy` (and `capyboop.github.io/paint`) paths are forwarded into the WebView deep-link handler.
         */
        fun isAllowedCapyDeepLink(rawUrl: String?): Boolean {
            if (rawUrl.isNullOrBlank()) return false
            val trimmed = rawUrl.trim()
            if (trimmed.any { it.isWhitespace() || it.isISOControl() }) return false
            return try {
                val uri = URI(trimmed)
                val scheme = uri.scheme?.lowercase()
                val host = uri.host?.lowercase() ?: return false
                val path = uri.path ?: ""
                if (scheme != "https") return false
                if (uri.userInfo != null) return false
                if (uri.port != -1 && uri.port != 443) return false
                val normalizedPath = path.lowercase()
                if (normalizedPath == "/privacy-policy.html" || normalizedPath.endsWith("/privacy-policy.html")) {
                    return false
                }
                if (host in ROOT_DEEP_LINK_HOSTS) {
                    path.isEmpty() || path.startsWith("/")
                } else if (host in GITHUB_PAGES_DEEP_LINK_HOSTS) {
                    (path == "/capy") || path.startsWith("/capy/") ||
                        (host == "capyboop.github.io" && ((path == "/paint") || path.startsWith("/paint/")))
                } else {
                    false
                }
            } catch (_: Exception) {
                false
            }
        }

        private val ALLOWED_EXTERNAL_OAUTH_HOSTS = setOf(
            "accounts.google.com",
            "login.microsoftonline.com",
            "openrouter.ai",
        )

        private const val MAX_OAUTH_CALLBACK_URL_LENGTH = 4096

        /**
         * Strict HTTPS host allowlist for launching external browser OAuth PKCE sign-in.
         */
        fun isAllowedExternalOAuthUrl(rawUrl: String?): Boolean {
            if (rawUrl.isNullOrBlank()) return false
            val trimmed = rawUrl.trim()
            if (trimmed.length > MAX_OAUTH_CALLBACK_URL_LENGTH) return false
            if (trimmed.any { it.isWhitespace() || it.isISOControl() }) return false
            return try {
                val uri = URI(trimmed)
                val scheme = uri.scheme?.lowercase()
                val host = uri.host?.lowercase() ?: return false
                if (scheme != "https") return false
                if (uri.userInfo != null) return false
                if (uri.port != -1 && uri.port != 443) return false
                host in ALLOWED_EXTERNAL_OAUTH_HOSTS
            } catch (_: Exception) {
                false
            }
        }

        /**
         * Validates incoming `capypaint://oauth/callback` PKCE redirect URIs before forwarding to JS.
         */
        fun isAllowedOAuthCallbackUrl(rawUrl: String?): Boolean {
            if (rawUrl.isNullOrBlank()) return false
            val trimmed = rawUrl.trim()
            if (trimmed.length > MAX_OAUTH_CALLBACK_URL_LENGTH) return false
            if (trimmed.any { it.isWhitespace() || it.isISOControl() }) return false
            return try {
                val uri = URI(trimmed)
                val scheme = uri.scheme?.lowercase()
                val host = uri.host?.lowercase()
                val path = uri.path ?: ""
                scheme == "capypaint" && host == "oauth" && path == "/callback"
            } catch (_: Exception) {
                false
            }
        }

        fun formatPlayGamesIdentityJson(playerId: String, displayName: String): String {
            return PlayGamesSnapshotDelegate.formatPlayGamesIdentityJson(playerId, displayName)
        }

        fun formatSafeAreaInsetsJson(top: Int, bottom: Int, left: Int, right: Int): String {
            return """{"top":$top,"bottom":$bottom,"left":$left,"right":$right}"""
        }

        fun calculateInSampleSize(
            srcWidth: Int,
            srcHeight: Int,
            maxDimension: Int = MAX_SHARED_IMAGE_DIMENSION,
        ): Int {
            return ShareExportDelegate.calculateInSampleSize(srcWidth, srcHeight, maxDimension)
        }

        fun calculateTargetDimensions(
            srcWidth: Int,
            srcHeight: Int,
            maxDimension: Int = MAX_SHARED_IMAGE_DIMENSION,
        ): Pair<Int, Int> {
            return ShareExportDelegate.calculateTargetDimensions(srcWidth, srcHeight, maxDimension)
        }

        fun resolveHapticSpec(type: String): HapticSpec {
            return HapticsDelegate.resolveHapticSpec(type)
        }
    }
}
