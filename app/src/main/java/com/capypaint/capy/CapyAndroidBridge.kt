package com.capypaint.capy

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationAttributes
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
import java.io.FileOutputStream
import java.net.URI
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption

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

    @JavascriptInterface
    fun saveCloudBinaryChunk(
        blobKey: String,
        chunkIndex: Int,
        totalChunks: Int,
        base64Chunk: String,
    ): Boolean {
        val savedLocal = saveCloudBinaryChunkToDir(
            dir = cloudDir,
            blobKey = blobKey,
            chunkIndex = chunkIndex,
            totalChunks = totalChunks,
            base64Chunk = base64Chunk,
        )
        if (savedLocal) {
            onSaveCloudSnapshot?.invoke(formatCloudBinaryChunkSlotKey(blobKey, chunkIndex), base64Chunk)
        }
        return savedLocal
    }

    @JavascriptInterface
    fun loadCloudBinaryChunk(blobKey: String, chunkIndex: Int): String? {
        return loadCloudBinaryChunkFromDir(cloudDir, blobKey, chunkIndex)
    }

    @JavascriptInterface
    fun isPlayGamesConfigured(): Boolean {
        return try {
            isPlayGamesConfiguredProvider()
        } catch (_: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun requestCloudSnapshotPull(slotKey: String): Boolean {
        if (!isPlayGamesConfigured()) {
            return false
        }
        val safeKey = sanitizeKey(slotKey)
        val callback = onRequestCloudSnapshotPull ?: return false
        callback.invoke(safeKey)
        return true
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
        const val ALLOWED_DEEP_LINK_HOST = "capypaint.com"
        val ROOT_DEEP_LINK_HOSTS = setOf("capypaint.com", "www.capypaint.com")
        val GITHUB_PAGES_DEEP_LINK_HOSTS = setOf("shthed.github.io")

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

        fun readPlayGamesAppId(context: Context): String? {
            return try {
                val resId = context.resources.getIdentifier(
                    "game_services_project_id",
                    "string",
                    context.packageName,
                )
                if (resId == 0) return null
                context.getString(resId)
            } catch (_: Exception) {
                null
            }
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
            val safeKey = sanitizeKey(key)
            val tmpFile = File(dir, "$safeKey.json.tmp")
            return try {
                if (!dir.exists() && !dir.mkdirs()) {
                    Log.e(TAG, "Failed to create backup directory: ${dir.absolutePath}")
                    return false
                }
                val targetFile = File(dir, "$safeKey.json")
                FileOutputStream(tmpFile).use { fos ->
                    fos.write(data.toByteArray(Charsets.UTF_8))
                    fos.flush()
                    fos.fd.sync()
                }
                try {
                    Files.move(
                        tmpFile.toPath(),
                        targetFile.toPath(),
                        StandardCopyOption.REPLACE_EXISTING,
                        StandardCopyOption.ATOMIC_MOVE,
                    )
                } catch (_: AtomicMoveNotSupportedException) {
                    try {
                        Files.move(
                            tmpFile.toPath(),
                            targetFile.toPath(),
                            StandardCopyOption.REPLACE_EXISTING,
                        )
                    } catch (_: Exception) {
                        if (!tmpFile.renameTo(targetFile)) {
                            throw IllegalStateException("Failed to rename ${tmpFile.name} to ${targetFile.name}")
                        }
                    }
                }
                Log.d(TAG, "Saved backup: $key (${data.length} chars)")
                true
            } catch (e: Exception) {
                if (tmpFile.exists()) {
                    tmpFile.delete()
                }
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

        const val DEFAULT_CLOUD_BINARY_CHUNK_BYTES = 180_000
        const val MAX_CLOUD_BINARY_CHUNKS = 32
        const val MAX_CLOUD_BINARY_TOTAL_BYTES = 3 * 1024 * 1024
        const val MAX_CLOUD_BINARY_CHUNK_CHARS = 300_000

        fun formatCloudBinaryChunkSlotKey(blobKey: String, chunkIndex: Int): String {
            return "${sanitizeKey(blobKey)}_part_$chunkIndex"
        }

        fun saveCloudBinaryChunkToDir(
            dir: File,
            blobKey: String,
            chunkIndex: Int,
            totalChunks: Int,
            base64Chunk: String,
        ): Boolean {
            if (
                (blobKey.isBlank()) ||
                (totalChunks < 1) ||
                (totalChunks > MAX_CLOUD_BINARY_CHUNKS) ||
                (chunkIndex < 0) ||
                (chunkIndex >= totalChunks) ||
                (base64Chunk.isEmpty()) ||
                (base64Chunk.length > MAX_CLOUD_BINARY_CHUNK_CHARS)
            ) {
                return false
            }
            val slotKey = formatCloudBinaryChunkSlotKey(blobKey, chunkIndex)
            val saved = saveBackupToDir(dir, slotKey, base64Chunk)
            if (!saved) return false

            if (chunkIndex == totalChunks - 1) {
                val safePrefix = sanitizeKey(blobKey)
                for (staleIdx in totalChunks until MAX_CLOUD_BINARY_CHUNKS) {
                    val staleFile = File(dir, "${safePrefix}_part_$staleIdx.json")
                    if (staleFile.exists()) {
                        staleFile.delete()
                    }
                }
            }
            return true
        }

        fun loadCloudBinaryChunkFromDir(dir: File, blobKey: String, chunkIndex: Int): String? {
            if ((blobKey.isBlank()) || (chunkIndex < 0) || (chunkIndex >= MAX_CLOUD_BINARY_CHUNKS)) {
                return null
            }
            return loadBackupFromDir(dir, formatCloudBinaryChunkSlotKey(blobKey, chunkIndex))
        }

        private fun writeAtomicBytesFile(dir: File, fileName: String, bytes: ByteArray): Boolean {
            val tmpFile = File(dir, "$fileName.tmp")
            return try {
                if ((!dir.exists()) && (!dir.mkdirs())) return false
                val targetFile = File(dir, fileName)
                FileOutputStream(tmpFile).use { fos ->
                    fos.write(bytes)
                    fos.flush()
                    fos.fd.sync()
                }
                try {
                    Files.move(
                        tmpFile.toPath(),
                        targetFile.toPath(),
                        StandardCopyOption.REPLACE_EXISTING,
                        StandardCopyOption.ATOMIC_MOVE,
                    )
                } catch (_: AtomicMoveNotSupportedException) {
                    try {
                        Files.move(
                            tmpFile.toPath(),
                            targetFile.toPath(),
                            StandardCopyOption.REPLACE_EXISTING,
                        )
                    } catch (_: Exception) {
                        if (!tmpFile.renameTo(targetFile)) {
                            throw IllegalStateException("Failed to rename ${tmpFile.name}")
                        }
                    }
                }
                true
            } catch (e: Exception) {
                if (tmpFile.exists()) tmpFile.delete()
                Log.e(TAG, "Failed writing atomic binary chunk: $fileName", e)
                false
            }
        }

        fun saveCloudBinaryBytesToDir(
            dir: File,
            blobKey: String,
            bytes: ByteArray,
            chunkSizeBytes: Int = DEFAULT_CLOUD_BINARY_CHUNK_BYTES,
        ): Int {
            if (
                (blobKey.isBlank()) ||
                (bytes.isEmpty()) ||
                (bytes.size > MAX_CLOUD_BINARY_TOTAL_BYTES) ||
                (chunkSizeBytes <= 0)
            ) {
                return 0
            }
            val totalChunks = (bytes.size + chunkSizeBytes - 1) / chunkSizeBytes
            if ((totalChunks < 1) || (totalChunks > MAX_CLOUD_BINARY_CHUNKS)) return 0

            val safeKey = sanitizeKey(blobKey)
            for (i in 0 until totalChunks) {
                val start = i * chunkSizeBytes
                val end = minOf(bytes.size, start + chunkSizeBytes)
                val slice = bytes.copyOfRange(start, end)
                if (!writeAtomicBytesFile(dir, "${safeKey}_bin_$i.bin", slice)) {
                    return 0
                }
            }
            val metaText = "$totalChunks:${bytes.size}"
            if (!saveBackupToDir(dir, "${safeKey}_bin_meta", metaText)) {
                return 0
            }
            for (staleIdx in totalChunks until MAX_CLOUD_BINARY_CHUNKS) {
                val staleFile = File(dir, "${safeKey}_bin_$staleIdx.bin")
                if (staleFile.exists()) staleFile.delete()
            }
            return totalChunks
        }

        fun loadCloudBinaryBytesFromDir(dir: File, blobKey: String): ByteArray? {
            if (blobKey.isBlank()) return null
            val safeKey = sanitizeKey(blobKey)
            val metaText = loadBackupFromDir(dir, "${safeKey}_bin_meta") ?: return null
            val parts = metaText.split(':')
            if (parts.size != 2) return null
            val totalChunks = parts[0].toIntOrNull() ?: return null
            val expectedBytes = parts[1].toIntOrNull() ?: return null
            if (
                (totalChunks !in 1..MAX_CLOUD_BINARY_CHUNKS) ||
                (expectedBytes !in 1..MAX_CLOUD_BINARY_TOTAL_BYTES)
            ) {
                return null
            }

            return try {
                val out = ByteArray(expectedBytes)
                var writeOffset = 0
                for (i in 0 until totalChunks) {
                    val chunkFile = File(dir, "${safeKey}_bin_$i.bin")
                    if (!chunkFile.exists()) return null
                    val chunkBytes = chunkFile.readBytes()
                    if ((chunkBytes.isEmpty()) || ((writeOffset + chunkBytes.size) > expectedBytes)) {
                        return null
                    }
                    System.arraycopy(chunkBytes, 0, out, writeOffset, chunkBytes.size)
                    writeOffset += chunkBytes.size
                }
                if (writeOffset == expectedBytes) out else null
            } catch (e: Exception) {
                Log.e(TAG, "Failed loading chunked cloud binary: $blobKey", e)
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
         * Validates incoming Android App Link URIs so only HTTPS URLs under capypaint.com
         * (or verified GitHub Pages /capy paths) are forwarded into the WebView deep-link handler.
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
                if (host in ROOT_DEEP_LINK_HOSTS) {
                    path.isEmpty() || path.startsWith("/")
                } else if (host in GITHUB_PAGES_DEEP_LINK_HOSTS) {
                    (path == "/capy") || path.startsWith("/capy/")
                } else {
                    false
                }
            } catch (_: Exception) {
                false
            }
        }

        fun formatPlayGamesIdentityJson(playerId: String, displayName: String): String {
            val safeId = escapeJsString(playerId.trim())
            val safeName = escapeJsString(displayName.trim())
            return """{"playerId":"$safeId","displayName":"$safeName"}"""
        }

        const val MAX_SHARED_IMAGE_DIMENSION = 2048
        const val MAX_RAW_SHARED_IMAGE_BYTES = 4 * 1024 * 1024

        fun formatSafeAreaInsetsJson(top: Int, bottom: Int, left: Int, right: Int): String {
            return """{"top":$top,"bottom":$bottom,"left":$left,"right":$right}"""
        }

        fun calculateInSampleSize(
            srcWidth: Int,
            srcHeight: Int,
            maxDimension: Int = MAX_SHARED_IMAGE_DIMENSION,
        ): Int {
            var inSampleSize = 1
            if (srcWidth <= 0 || srcHeight <= 0 || maxDimension <= 0) {
                return inSampleSize
            }
            while ((srcWidth / inSampleSize) > maxDimension || (srcHeight / inSampleSize) > maxDimension) {
                inSampleSize *= 2
            }
            return inSampleSize
        }

        fun calculateTargetDimensions(
            srcWidth: Int,
            srcHeight: Int,
            maxDimension: Int = MAX_SHARED_IMAGE_DIMENSION,
        ): Pair<Int, Int> {
            if (srcWidth <= 0 || srcHeight <= 0 || maxDimension <= 0) {
                return Pair(1, 1)
            }
            val maxSrc = maxOf(srcWidth, srcHeight)
            if (maxSrc <= maxDimension) {
                return Pair(srcWidth, srcHeight)
            }
            val scale = maxDimension.toDouble() / maxSrc.toDouble()
            val targetW = maxOf(1, Math.round(srcWidth * scale).toInt())
            val targetH = maxOf(1, Math.round(srcHeight * scale).toInt())
            return Pair(targetW, targetH)
        }

        data class HapticSpec(
            val normalizedType: String,
            val viewConstant: Int?,
            val predefinedEffectId: Int?,
            val oneShotDurationMs: Long?,
            val waveformTimings: LongArray?,
        )

        fun resolveHapticSpec(type: String): HapticSpec {
            return when (type.trim().lowercase()) {
                "tick" -> HapticSpec(
                    normalizedType = "tick",
                    viewConstant = HapticFeedbackConstants.CLOCK_TICK,
                    predefinedEffectId = VibrationEffect.EFFECT_TICK,
                    oneShotDurationMs = 10L,
                    waveformTimings = null,
                )
                "success" -> HapticSpec(
                    normalizedType = "success",
                    viewConstant = null,
                    predefinedEffectId = null,
                    oneShotDurationMs = null,
                    waveformTimings = longArrayOf(0L, 14L, 45L, 24L),
                )
                "warning" -> HapticSpec(
                    normalizedType = "warning",
                    viewConstant = HapticFeedbackConstants.LONG_PRESS,
                    predefinedEffectId = VibrationEffect.EFFECT_HEAVY_CLICK,
                    oneShotDurationMs = 18L,
                    waveformTimings = null,
                )
                "error" -> HapticSpec(
                    normalizedType = "error",
                    viewConstant = null,
                    predefinedEffectId = null,
                    oneShotDurationMs = null,
                    waveformTimings = longArrayOf(0L, 28L, 50L, 28L),
                )
                else -> HapticSpec(
                    normalizedType = "click",
                    viewConstant = HapticFeedbackConstants.KEYBOARD_TAP,
                    predefinedEffectId = VibrationEffect.EFFECT_CLICK,
                    oneShotDurationMs = 12L,
                    waveformTimings = null,
                )
            }
        }

        private fun performHaptic(context: Context, view: View, type: String) {
            try {
                val spec = resolveHapticSpec(type)
                Log.d(TAG, "Triggered haptic: ${spec.normalizedType} (raw=$type)")
                if (spec.waveformTimings != null) {
                    vibratePattern(context, spec.waveformTimings)
                    return
                }

                // On API 29+ (Android 10+, including Pixel API 33+), prefer hardware-calibrated
                // predefined VibrationEffects with USAGE_TOUCH attributes so touch haptics are never
                // silently suppressed by view settings or notification vibration sliders.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && spec.predefinedEffectId != null) {
                    if (vibratePredefined(context, spec.predefinedEffectId)) {
                        return
                    }
                }

                if (spec.viewConstant != null && spec.normalizedType != "warning") {
                    val performed = view.performHapticFeedback(
                        spec.viewConstant,
                        HapticFeedbackConstants.FLAG_IGNORE_VIEW_SETTING,
                    )
                    if (performed) {
                        return
                    }
                }

                if (spec.oneShotDurationMs != null) {
                    vibrateOneShot(context, spec.oneShotDurationMs)
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

        private fun vibrateEffectWithTouchAttributes(vibrator: Vibrator, effect: VibrationEffect) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val attrs = VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH)
                vibrator.vibrate(effect, attrs)
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val audioAttrs = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
                @Suppress("DEPRECATION")
                vibrator.vibrate(effect, audioAttrs)
            }
        }

        private fun vibratePredefined(context: Context, effectId: Int): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
            val vibrator = getVibrator(context) ?: return false
            if (!vibrator.hasVibrator()) return false
            val effect = VibrationEffect.createPredefined(effectId)
            vibrateEffectWithTouchAttributes(vibrator, effect)
            return true
        }

        private fun vibrateOneShot(context: Context, durationMs: Long) {
            val vibrator = getVibrator(context) ?: return
            if (!vibrator.hasVibrator()) return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val effect = VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE)
                vibrateEffectWithTouchAttributes(vibrator, effect)
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(durationMs)
            }
        }

        private fun vibratePattern(context: Context, timings: LongArray) {
            val vibrator = getVibrator(context) ?: return
            if (!vibrator.hasVibrator()) return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val effect = VibrationEffect.createWaveform(timings, -1)
                vibrateEffectWithTouchAttributes(vibrator, effect)
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(timings, -1)
            }
        }
    }
}
