package com.capypaint.capy

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Base64
import android.util.Log
import android.view.HapticFeedbackConstants
import android.view.View
import android.webkit.JavascriptInterface
import androidx.core.content.FileProvider
import androidx.core.content.edit
import java.io.File
import java.net.URI

class CapyAndroidBridge(
    private val context: Context,
    private val rootViewProvider: () -> View?,
    private val onModalStateChanged: (Boolean) -> Unit,
    private val onRequestPlayGamesSignIn: (() -> Unit)? = null,
    private val onSaveCloudSnapshot: ((String, String) -> Unit)? = null,
) {
    @Volatile
    var isModalOpen: Boolean = false
        private set

    @Volatile
    var pendingSharedImageJson: String? = null

    @Volatile
    var pendingDeepLinkUrl: String? = null

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

    private val backupDir: File
        get() = File(context.filesDir, BACKUP_FOLDER_NAME)

    private val cloudDir: File
        get() = File(context.filesDir, CLOUD_FOLDER_NAME)

    @JavascriptInterface
    fun haptic(type: String) {
        val view = rootViewProvider()
        view?.post {
            performHaptic(context, view, type)
        }
    }

    @JavascriptInterface
    fun setModalOpen(isOpen: Boolean) {
        Log.d(TAG, "Modal state updated: isOpen=$isOpen")
        isModalOpen = isOpen
        onModalStateChanged(isOpen)
    }

    @JavascriptInterface
    fun saveBackup(key: String, data: String): Boolean {
        return saveBackupToDir(backupDir, key, data)
    }

    @JavascriptInterface
    fun loadBackup(key: String): String? {
        return loadBackupFromDir(backupDir, key)
    }

    fun saveLocalCloudSnapshotOnly(slotKey: String, payloadJson: String): Boolean {
        return saveBackupToDir(cloudDir, slotKey, payloadJson)
    }

    @JavascriptInterface
    fun saveCloudSnapshot(slotKey: String, payloadJson: String): Boolean {
        val savedLocal = saveBackupToDir(cloudDir, slotKey, payloadJson)
        onSaveCloudSnapshot?.invoke(slotKey, payloadJson)
        return savedLocal
    }

    @JavascriptInterface
    fun loadCloudSnapshot(slotKey: String): String? {
        return loadBackupFromDir(cloudDir, slotKey)
    }

    fun cachePlayGamesProfile(playerId: String, displayName: String) {
        val cleanId = playerId.trim()
        val cleanName = displayName.trim()
        if ((cleanId.isEmpty()) || (cleanName.isEmpty())) return
        try {
            val prefs = context.getSharedPreferences(PLAY_GAMES_PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit {
                putString(KEY_PLAY_GAMES_PLAYER_ID, cleanId)
                putString(KEY_PLAY_GAMES_DISPLAY_NAME, cleanName)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to persist Play Games profile in SharedPreferences", e)
        }
    }

    fun loadCachedPlayGamesProfileJson(): String? {
        return try {
            val prefs = context.getSharedPreferences(PLAY_GAMES_PREFS_NAME, Context.MODE_PRIVATE)
            val playerId = prefs.getString(KEY_PLAY_GAMES_PLAYER_ID, null)?.trim()
            val displayName = prefs.getString(KEY_PLAY_GAMES_DISPLAY_NAME, null)?.trim()
            if ((!playerId.isNullOrEmpty()) && (!displayName.isNullOrEmpty())) {
                formatPlayGamesIdentityJson(playerId, displayName)
            } else {
                null
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to read cached Play Games profile", e)
            null
        }
    }

    @JavascriptInterface
    fun signInPlayGames(): String? {
        Log.d(TAG, "Play Games v2 sign-in requested")
        onRequestPlayGamesSignIn?.invoke()
        return loadCachedPlayGamesProfileJson()
    }

    @JavascriptInterface
    fun showRewardedAd(): Boolean {
        Log.d(TAG, "Opt-in rewarded ad requested; no ad SDK bundled, returning false")
        return false
    }

    @JavascriptInterface
    fun consumePendingSharedImage(): String? {
        val pending = pendingSharedImageJson
        pendingSharedImageJson = null
        return pending
    }

    @JavascriptInterface
    fun consumePendingDeepLink(): String? {
        val pending = pendingDeepLinkUrl
        pendingDeepLinkUrl = null
        return pending
    }

    @JavascriptInterface
    @Suppress("unused")
    fun getAppVersion(): String {
        return BuildConfig.VERSION_NAME
    }

    @JavascriptInterface
    fun shareTextLink(title: String, url: String) {
        try {
            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_SUBJECT, title)
                putExtra(Intent.EXTRA_TITLE, title)
                putExtra(Intent.EXTRA_TEXT, url)
            }
            val chooser = Intent.createChooser(shareIntent, title).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(chooser)
            Log.i(TAG, "Dispatched text link share chooser for '$title'")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to share text link '$title'", e)
        }
    }

    @JavascriptInterface
    fun shareImage(title: String, dataUrl: String) {
        val commaIndex = dataUrl.indexOf(',')
        val base64Part = if (commaIndex >= 0) dataUrl.substring(commaIndex + 1) else dataUrl
        shareFile(title, "capy_shared_artwork.png", "image/png", base64Part)
    }

    @JavascriptInterface
    fun shareFile(title: String, fileName: String, mimeType: String, base64Data: String) {
        try {
            val commaIndex = base64Data.indexOf(',')
            val base64Part = if (commaIndex >= 0) base64Data.substring(commaIndex + 1) else base64Data
            val bytes = Base64.decode(base64Part, Base64.DEFAULT)

            val safeName = sanitizeFileName(fileName)
            val shareFile = File(context.cacheDir, safeName)
            shareFile.writeBytes(bytes)

            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                shareFile,
            )

            val resolvedMime = mimeType.ifBlank { "application/octet-stream" }
            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = resolvedMime
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_TITLE, title)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(shareIntent, title).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(chooser)
            Log.i(TAG, "Dispatched share chooser for '$safeName' ($resolvedMime, ${bytes.size} bytes)")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to share file '$fileName'", e)
        }
    }

    companion object {
        const val TAG = "CapyBridge"
        const val BACKUP_FOLDER_NAME = "capy_saves"
        const val CLOUD_FOLDER_NAME = "capy_cloud"
        const val PLAY_GAMES_PREFS_NAME = "capy_play_games_prefs"
        const val KEY_PLAY_GAMES_PLAYER_ID = "player_id"
        const val KEY_PLAY_GAMES_DISPLAY_NAME = "display_name"
        const val ALLOWED_DEEP_LINK_HOST = "shthed.github.io"

        /**
         * Returns true when the Google Play Console Game Services Project ID is configured
         * with a real numeric ID rather than the default placeholder ("000000000000").
         */
        fun isPlayGamesAppIdConfigured(appId: String?): Boolean {
            if (appId.isNullOrBlank()) return false
            val trimmed = appId.trim()
            return (trimmed.length >= 6) &&
                trimmed.all { it.isDigit() } &&
                trimmed.any { it != '0' }
        }

        fun sanitizeKey(key: String): String {
            val cleaned = key.replace(Regex("[^a-zA-Z0-9._-]"), "_")
            return cleaned.ifEmpty { "default_key" }
        }

        fun sanitizeFileName(fileName: String): String {
            val cleaned = fileName.trim().replace(Regex("[^a-zA-Z0-9._-]"), "_").trimStart('.')
            return cleaned.ifEmpty { "capy_export.bin" }
        }

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

        fun saveBackupToDir(dir: File, key: String, data: String): Boolean {
            return try {
                if (!dir.exists() && !dir.mkdirs()) {
                    Log.e(TAG, "Failed to create backup directory: ${dir.absolutePath}")
                    return false
                }
                val targetFile = File(dir, "${sanitizeKey(key)}.json")
                targetFile.writeText(data, Charsets.UTF_8)
                Log.d(TAG, "Saved backup: $key (${data.length} chars)")
                true
            } catch (e: Exception) {
                Log.e(TAG, "Failed to save backup: $key", e)
                false
            }
        }

        fun loadBackupFromDir(dir: File, key: String): String? {
            return try {
                val targetFile = File(dir, "${sanitizeKey(key)}.json")
                if (!targetFile.exists()) {
                    Log.d(TAG, "No backup file found for key: $key")
                    return null
                }
                val content = targetFile.readText(Charsets.UTF_8)
                Log.d(TAG, "Loaded backup: $key (${content.length} chars)")
                content
            } catch (e: Exception) {
                Log.e(TAG, "Failed to load backup: $key", e)
                null
            }
        }

        fun formatSharedImageJson(title: String, dataUrl: String): String {
            val escapedTitle = title
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", " ")
                .replace("\r", " ")
            val escapedUrl = dataUrl
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
            return """{"title":"$escapedTitle","dataUrl":"$escapedUrl"}"""
        }

        fun escapeJsString(value: String): String {
            return value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("'", "\\'")
                .replace("\n", " ")
                .replace("\r", " ")
                .replace("<", "\\u003c")
                .replace(">", "\\u003e")
        }

        /**
         * Validates incoming Android App Link URIs so only HTTPS URLs under shthed.github.io/capy
         * are forwarded into the WebView deep-link handler.
         */
        fun isAllowedCapyDeepLink(rawUrl: String?): Boolean {
            if (rawUrl.isNullOrBlank()) return false
            val trimmed = rawUrl.trim()
            if (trimmed.any { it.isWhitespace() || it.isISOControl() }) return false
            return try {
                val uri = URI(trimmed)
                val scheme = uri.scheme?.lowercase()
                val host = uri.host?.lowercase()
                val path = uri.path ?: ""
                (scheme == "https") &&
                    (host == ALLOWED_DEEP_LINK_HOST) &&
                    ((path == "/capy") || path.startsWith("/capy/"))
            } catch (_: Exception) {
                false
            }
        }

        fun formatPlayGamesIdentityJson(playerId: String, displayName: String): String {
            val safeId = escapeJsString(playerId.trim())
            val safeName = escapeJsString(displayName.trim())
            return """{"playerId":"$safeId","displayName":"$safeName"}"""
        }

        fun formatSafeAreaInsetsJson(top: Int, bottom: Int, left: Int, right: Int): String {
            return """{"top":$top,"bottom":$bottom,"left":$left,"right":$right}"""
        }

        private fun performHaptic(context: Context, view: View, type: String) {
            try {
                Log.d(TAG, "Triggered haptic: $type")
                when (type) {
                    "tick" -> {
                        view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                    }
                    "success" -> {
                        vibratePattern(context, longArrayOf(0, 14, 45, 24))
                    }
                    "warning" -> {
                        vibrateOneShot(context, 18L)
                    }
                    "error" -> {
                        vibratePattern(context, longArrayOf(0, 28, 50, 28))
                    }
                    else -> {
                        view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Haptic vibration not supported or failed: $type", e)
            }
        }

        private fun getVibrator(context: Context): Vibrator? {
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val manager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                manager?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }
        }

        private fun vibrateOneShot(context: Context, durationMs: Long) {
            val vibrator = getVibrator(context) ?: return
            if (!vibrator.hasVibrator()) return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(
                    VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE),
                )
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(durationMs)
            }
        }

        private fun vibratePattern(context: Context, timings: LongArray) {
            val vibrator = getVibrator(context) ?: return
            if (!vibrator.hasVibrator()) return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(timings, -1))
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(timings, -1)
            }
        }
    }
}
