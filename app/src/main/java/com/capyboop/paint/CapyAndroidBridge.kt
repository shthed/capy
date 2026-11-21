package com.capyboop.paint

import android.annotation.TargetApi
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
    private val originGuard: () -> Boolean = { true },
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
        if (!originGuard()) return
        val view = rootViewProvider()
        view?.post {
            performHaptic(context, view, type)
        }
    }

    @JavascriptInterface
    fun setModalOpen(isOpen: Boolean) {
        if (!originGuard()) return
        Log.d(TAG, "Modal state updated: isOpen=$isOpen")
        isModalOpen = isOpen
        onModalStateChanged(isOpen)
    }

    @JavascriptInterface
    fun saveBackup(key: String, data: String): Boolean {
        if (!originGuard()) return false
        return saveBackupToDir(backupDir, key, data)
    }

    @JavascriptInterface
    fun loadBackup(key: String): String? {
        if (!originGuard()) return null
        return loadBackupFromDir(backupDir, key)
    }

    fun saveLocalCloudSnapshotOnly(slotKey: String, payloadJson: String): Boolean {
        return saveBackupToDir(cloudDir, slotKey, payloadJson)
    }

    @JavascriptInterface
    fun saveCloudSnapshot(slotKey: String, payloadJson: String): Boolean {
        if (!originGuard()) return false
        val savedLocal = saveBackupToDir(cloudDir, slotKey, payloadJson)
        onSaveCloudSnapshot?.invoke(slotKey, payloadJson)
        return savedLocal
    }

    @JavascriptInterface
    fun loadCloudSnapshot(slotKey: String): String? {
        if (!originGuard()) return null
        return loadBackupFromDir(cloudDir, slotKey)
    }

    @JavascriptInterface
    fun saveCloudBinaryChunk(
        blobKey: String,
        chunkIndex: Int,
        totalChunks: Int,
        base64Chunk: String,
    ): Boolean {
        if (!originGuard()) return false
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
        if (!originGuard()) return null
        return loadCloudBinaryChunkFromDir(cloudDir, blobKey, chunkIndex)
    }

    @JavascriptInterface
    fun isPlayGamesConfigured(): Boolean {
        if (!originGuard()) return false
        return try {
            isPlayGamesConfiguredProvider()
        } catch (_: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun requestCloudSnapshotPull(slotKey: String): Boolean {
        if (!originGuard()) return false
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
        if (!originGuard()) return null
        Log.d(TAG, "Play Games v2 sign-in requested")
        onRequestPlayGamesSignIn?.invoke()
        return loadCachedPlayGamesProfileJson()
    }

    @JavascriptInterface
    fun consumePendingSharedImage(): String? {
        if (!originGuard()) return null
        val pending = pendingSharedImageJson
        pendingSharedImageJson = null
        return pending
    }

    @Volatile
    var pendingOAuthCallbackUrl: String? = null

    fun consumePendingOAuthCallbackInternal(): String? {
        val pending = pendingOAuthCallbackUrl
        pendingOAuthCallbackUrl = null
        return pending
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
        if (!originGuard()) return
        if (!isAllowedShareTextUrl(url)) {
            Log.w(TAG, "Blocked unsafe shareTextLink URL: $url")
            return
        }
        val safeTitle = sanitizeShareTitle(title)
        try {
            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_SUBJECT, safeTitle)
                putExtra(Intent.EXTRA_TITLE, safeTitle)
                putExtra(Intent.EXTRA_TEXT, url.trim())
            }
            val chooser = Intent.createChooser(shareIntent, safeTitle).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(chooser)
            Log.i(TAG, "Dispatched text link share chooser for '$safeTitle'")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to share text link '$safeTitle'", e)
        }
    }

    @JavascriptInterface
    fun shareImage(title: String, dataUrl: String) {
        if (!originGuard()) return
        val spec = resolveShareImageSpec(dataUrl)
        shareFile(title, spec.fileName, spec.mimeType, spec.base64Payload)
    }

    @JavascriptInterface
    fun shareFile(title: String, fileName: String, mimeType: String, base64Data: String) {
        if (!originGuard()) return
        try {
            if (base64Data.length > MAX_SHARE_BASE64_CHARS) {
                Log.w(TAG, "Rejected oversized share payload (${base64Data.length} chars)")
                return
            }
            val commaIndex = base64Data.indexOf(',')
            val base64Part = if (commaIndex >= 0) base64Data.substring(commaIndex + 1) else base64Data
            val bytes = Base64.decode(base64Part, Base64.DEFAULT)
            if (bytes.isEmpty() || bytes.size > MAX_SHARE_FILE_BYTES) {
                Log.w(TAG, "Rejected invalid share byte length (${bytes.size} bytes)")
                return
            }

            val shareFile = prepareSharedExportFile(context.cacheDir, fileName)
            shareFile.writeBytes(bytes)

            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                shareFile,
            )

            val resolvedMime = resolveAllowedExportMimeType(mimeType)
            val safeTitle = sanitizeShareTitle(title)
            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = resolvedMime
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_TITLE, safeTitle)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(shareIntent, safeTitle).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(chooser)
            Log.i(TAG, "Dispatched share chooser for '${shareFile.name}' ($resolvedMime, ${bytes.size} bytes)")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to share file '$fileName'", e)
        }
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
            return try {
                Files.move(
                    source.toPath(),
                    target.toPath(),
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE,
                )
                true
            } catch (_: Exception) {
                try {
                    Files.move(
                        source.toPath(),
                        target.toPath(),
                        StandardCopyOption.REPLACE_EXISTING,
                    )
                    true
                } catch (_: Exception) {
                    false
                }
            }
        }
    }

    companion object {
        const val TAG = "CapyBridge"
        const val BACKUP_FOLDER_NAME = "capy_saves"
        const val CLOUD_FOLDER_NAME = "capy_cloud"
        const val SHARE_FOLDER_NAME = "shared"
        const val SHARED_FILE_MAX_AGE_MS = 24L * 60L * 60L * 1000L
        const val PLAY_GAMES_PREFS_NAME = "capy_play_games_prefs"
        const val KEY_PLAY_GAMES_PLAYER_ID = "player_id"
        const val KEY_PLAY_GAMES_DISPLAY_NAME = "display_name"
        const val ALLOWED_DEEP_LINK_HOST = "capypaint.com"
        const val APP_ASSETS_HOST = "appassets.androidplatform.net"
        const val APP_ASSETS_ORIGIN = "https://$APP_ASSETS_HOST"
        const val MAX_BACKUP_PAYLOAD_CHARS = 16 * 1024 * 1024
        const val MAX_SHARE_FILE_BYTES = 16 * 1024 * 1024
        const val MAX_SHARE_BASE64_CHARS = 24 * 1024 * 1024
        val ROOT_DEEP_LINK_HOSTS = setOf("capypaint.com", "www.capypaint.com", "paint.capyboop.com")
        val GITHUB_PAGES_DEEP_LINK_HOSTS = setOf("shthed.github.io", "capyboop.github.io")
        private val FILE_IO_LOCK = Any()
        private val ALLOWED_EXPORT_MIME_TYPES = setOf(
            "image/png",
            "image/jpeg",
            "image/webp",
            "image/gif",
            "image/svg+xml",
            "application/json",
            "text/plain",
            "application/octet-stream",
        )

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

        private fun isInsideDirectory(dir: File, target: File): Boolean {
            return try {
                val basePath = dir.canonicalFile.path
                val targetPath = target.canonicalFile.path
                targetPath.startsWith("$basePath${File.separator}")
            } catch (_: Exception) {
                false
            }
        }

        internal fun shouldUseAtomicNioMove(sdkInt: Int = Build.VERSION.SDK_INT): Boolean {
            return sdkInt >= Build.VERSION_CODES.O
        }

        private fun replaceFileAtomically(source: File, target: File) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (Api26FileMover.moveReplacing(source, target)) {
                    return
                }
            }
            if (!source.renameTo(target)) {
                throw IllegalStateException("Failed to rename ${source.name} to ${target.name}")
            }
        }

        fun saveBackupToDir(dir: File, key: String, data: String): Boolean {
            if (data.length > MAX_BACKUP_PAYLOAD_CHARS) {
                Log.w(TAG, "Rejected oversized backup payload for key: $key (${data.length} chars)")
                return false
            }
            val safeKey = sanitizeKey(key)
            val tmpPrefix = if (safeKey.length >= 3) safeKey.take(40) else "capy_$safeKey"
            return synchronized(FILE_IO_LOCK) {
                var tmpFile: File? = null
                try {
                    if (!dir.exists() && !dir.mkdirs()) {
                        Log.e(TAG, "Failed to create backup directory: ${dir.absolutePath}")
                        return@synchronized false
                    }
                    val targetFile = File(dir, "$safeKey.json")
                    if (!isInsideDirectory(dir, targetFile)) {
                        Log.e(TAG, "Rejected path escape attempt for backup key: $key")
                        return@synchronized false
                    }
                    val createdTmp = File.createTempFile("$tmpPrefix.", ".json.tmp", dir)
                    tmpFile = createdTmp
                    if (!isInsideDirectory(dir, createdTmp)) {
                        Log.e(TAG, "Rejected temp path escape attempt for backup key: $key")
                        return@synchronized false
                    }
                    FileOutputStream(createdTmp).use { fos ->
                        fos.write(data.toByteArray(Charsets.UTF_8))
                        fos.flush()
                        fos.fd.sync()
                    }
                    replaceFileAtomically(createdTmp, targetFile)
                    Log.d(TAG, "Saved backup: $key (${data.length} chars)")
                    true
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to save backup: $key", e)
                    false
                } finally {
                    tmpFile?.let {
                        if (it.exists()) {
                            it.delete()
                        }
                    }
                }
            }
        }

        fun loadBackupFromDir(dir: File, key: String): String? {
            return synchronized(FILE_IO_LOCK) {
                try {
                    val targetFile = File(dir, "${sanitizeKey(key)}.json")
                    if (!isInsideDirectory(dir, targetFile) || !targetFile.exists()) {
                        Log.d(TAG, "No backup file found for key: $key")
                        return@synchronized null
                    }
                    val content = targetFile.readText(Charsets.UTF_8)
                    Log.d(TAG, "Loaded backup: $key (${content.length} chars)")
                    content
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to load backup: $key", e)
                    null
                }
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
            return synchronized(FILE_IO_LOCK) {
                val slotKey = formatCloudBinaryChunkSlotKey(blobKey, chunkIndex)
                val saved = saveBackupToDir(dir, slotKey, base64Chunk)
                if (!saved) return@synchronized false

                if (chunkIndex == totalChunks - 1) {
                    val safePrefix = sanitizeKey(blobKey)
                    for (staleIdx in totalChunks until MAX_CLOUD_BINARY_CHUNKS) {
                        val staleFile = File(dir, "${safePrefix}_part_$staleIdx.json")
                        if (isInsideDirectory(dir, staleFile) && staleFile.exists()) {
                            staleFile.delete()
                        }
                    }
                }
                true
            }
        }

        fun loadCloudBinaryChunkFromDir(dir: File, blobKey: String, chunkIndex: Int): String? {
            if ((blobKey.isBlank()) || (chunkIndex < 0) || (chunkIndex >= MAX_CLOUD_BINARY_CHUNKS)) {
                return null
            }
            return synchronized(FILE_IO_LOCK) {
                loadBackupFromDir(dir, formatCloudBinaryChunkSlotKey(blobKey, chunkIndex))
            }
        }

        private fun writeAtomicBytesFile(dir: File, fileName: String, bytes: ByteArray): Boolean {
            val safeFileName = sanitizeFileName(fileName)
            val tmpPrefix = if (safeFileName.length >= 3) safeFileName.take(40) else "capy_$safeFileName"
            return synchronized(FILE_IO_LOCK) {
                var tmpFile: File? = null
                try {
                    if ((!dir.exists()) && (!dir.mkdirs())) return@synchronized false
                    val targetFile = File(dir, safeFileName)
                    if (!isInsideDirectory(dir, targetFile)) return@synchronized false
                    val createdTmp = File.createTempFile("$tmpPrefix.", ".tmp", dir)
                    tmpFile = createdTmp
                    if (!isInsideDirectory(dir, createdTmp)) return@synchronized false
                    FileOutputStream(createdTmp).use { fos ->
                        fos.write(bytes)
                        fos.flush()
                        fos.fd.sync()
                    }
                    replaceFileAtomically(createdTmp, targetFile)
                    true
                } catch (e: Exception) {
                    Log.e(TAG, "Failed writing atomic binary chunk: $safeFileName", e)
                    false
                } finally {
                    tmpFile?.let {
                        if (it.exists()) {
                            it.delete()
                        }
                    }
                }
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
            return synchronized(FILE_IO_LOCK) {
                for (i in 0 until totalChunks) {
                    val start = i * chunkSizeBytes
                    val end = minOf(bytes.size, start + chunkSizeBytes)
                    val slice = bytes.copyOfRange(start, end)
                    if (!writeAtomicBytesFile(dir, "${safeKey}_bin_$i.bin", slice)) {
                        return@synchronized 0
                    }
                }
                val metaText = "$totalChunks:${bytes.size}"
                if (!saveBackupToDir(dir, "${safeKey}_bin_meta", metaText)) {
                    return@synchronized 0
                }
                for (staleIdx in totalChunks until MAX_CLOUD_BINARY_CHUNKS) {
                    val staleFile = File(dir, "${safeKey}_bin_$staleIdx.bin")
                    if (isInsideDirectory(dir, staleFile) && staleFile.exists()) {
                        staleFile.delete()
                    }
                }
                totalChunks
            }
        }

        fun loadCloudBinaryBytesFromDir(dir: File, blobKey: String): ByteArray? {
            if (blobKey.isBlank()) return null
            val safeKey = sanitizeKey(blobKey)
            return synchronized(FILE_IO_LOCK) {
                val metaText = loadBackupFromDir(dir, "${safeKey}_bin_meta") ?: return@synchronized null
                val parts = metaText.split(':')
                if (parts.size != 2) return@synchronized null
                val totalChunks = parts[0].toIntOrNull() ?: return@synchronized null
                val expectedBytes = parts[1].toIntOrNull() ?: return@synchronized null
                if (
                    (totalChunks !in 1..MAX_CLOUD_BINARY_CHUNKS) ||
                    (expectedBytes !in 1..MAX_CLOUD_BINARY_TOTAL_BYTES)
                ) {
                    return@synchronized null
                }

                try {
                    val out = ByteArray(expectedBytes)
                    var writeOffset = 0
                    for (i in 0 until totalChunks) {
                        val chunkFile = File(dir, "${safeKey}_bin_$i.bin")
                        if (!isInsideDirectory(dir, chunkFile) || !chunkFile.exists()) {
                            return@synchronized null
                        }
                        val chunkBytes = chunkFile.readBytes()
                        if ((chunkBytes.isEmpty()) || ((writeOffset + chunkBytes.size) > expectedBytes)) {
                            return@synchronized null
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
        }

        fun resolveShareImageSpec(dataUrl: String): ShareImageSpec {
            val trimmed = dataUrl.trim()
            val commaIndex = trimmed.indexOf(',')
            if (commaIndex < 0) {
                return ShareImageSpec(
                    fileName = "capy_shared_artwork.png",
                    mimeType = "image/png",
                    base64Payload = trimmed,
                )
            }
            val header = trimmed.substring(0, commaIndex).lowercase()
            val payload = trimmed.substring(commaIndex + 1)
            val mimeMatch = Regex("^data:(image/[a-z0-9.+-]+)").find(header)
            val rawMime = mimeMatch?.groupValues?.get(1) ?: "image/png"
            val (normalizedMime, ext) = when (rawMime) {
                "image/jpeg", "image/jpg" -> "image/jpeg" to "jpg"
                "image/webp" -> "image/webp" to "webp"
                "image/gif" -> "image/gif" to "gif"
                "image/svg+xml" -> "image/svg+xml" to "svg"
                else -> "image/png" to "png"
            }
            return ShareImageSpec(
                fileName = "capy_shared_artwork.$ext",
                mimeType = normalizedMime,
                base64Payload = payload,
            )
        }

        fun prepareSharedExportFile(
            cacheDir: File,
            fileName: String,
            nowMs: Long = System.currentTimeMillis(),
            maxAgeMs: Long = SHARED_FILE_MAX_AGE_MS,
        ): File {
            val sharedDir = File(cacheDir, SHARE_FOLDER_NAME)
            if (!sharedDir.exists()) {
                sharedDir.mkdirs()
            } else {
                sharedDir.listFiles()?.forEach { existing ->
                    if (existing.isFile && (nowMs - existing.lastModified()) > maxAgeMs) {
                        existing.delete()
                    }
                }
            }
            val safeName = sanitizeFileName(fileName)
            return File(sharedDir, safeName)
        }

        fun sanitizeShareTitle(
            rawTitle: String?,
            fallback: String = "",
            maxLength: Int = 120,
        ): String {
            if (rawTitle.isNullOrBlank()) return fallback
            val sb = StringBuilder(minOf(rawTitle.length, maxLength))
            var lastWasSpace = true
            for (ch in rawTitle) {
                if (ch.isISOControl() || ch.isWhitespace()) {
                    if (!lastWasSpace && sb.length < maxLength) {
                        sb.append(' ')
                        lastWasSpace = true
                    }
                } else {
                    if (sb.length >= maxLength) break
                    sb.append(ch)
                    lastWasSpace = false
                }
            }
            val cleaned = sb.toString().trim()
            return cleaned.ifEmpty { fallback }
        }

        fun resolveAllowedExportMimeType(rawMime: String?): String {
            val clean = rawMime?.trim()?.lowercase()?.substringBefore(';')?.trim() ?: ""
            return if (clean in ALLOWED_EXPORT_MIME_TYPES) clean else "application/octet-stream"
        }

        fun normalizeSharedImageMimeType(rawMime: String?): String {
            val clean = rawMime?.trim()?.lowercase()?.substringBefore(';')?.trim() ?: ""
            return when (clean) {
                "image/jpeg", "image/jpg" -> "image/jpeg"
                "image/webp" -> "image/webp"
                "image/gif" -> "image/gif"
                else -> "image/png"
            }
        }

        fun isAllowedSharedImageDataUrl(dataUrl: String?): Boolean {
            if (dataUrl.isNullOrBlank()) return false
            val trimmed = dataUrl.trim()
            if (trimmed.any { it.isISOControl() }) return false
            return Regex("^data:image/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$", RegexOption.IGNORE_CASE)
                .matches(trimmed)
        }

        fun isAllowedShareTextUrl(rawUrl: String?): Boolean {
            if (rawUrl.isNullOrBlank()) return false
            val trimmed = rawUrl.trim()
            if (trimmed.any { it.isWhitespace() || it.isISOControl() }) return false
            return try {
                val uri = URI(trimmed)
                val scheme = uri.scheme?.lowercase() ?: return false
                val host = uri.host?.lowercase() ?: return false
                if (uri.userInfo != null) return false
                when (scheme) {
                    "https" -> host.isNotBlank()
                    "http" -> (host == "localhost" || host == "127.0.0.1")
                    else -> false
                }
            } catch (_: Exception) {
                false
            }
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
            val trimmed = raw?.trim() ?: return false
            return trimmed.startsWith("{") && trimmed.endsWith("}")
        }

        fun decideSnapshotPushAction(
            slotKey: String,
            existingRemotePayload: String?,
            lastKnownRemotePayload: String?,
            incomingPayload: String,
        ): SnapshotPushDecision {
            val safeSlot = sanitizeKey(slotKey)
            if (safeSlot.startsWith("pgblob_")) {
                return if (existingRemotePayload == incomingPayload) {
                    SnapshotPushDecision.SKIP_IDENTICAL
                } else {
                    SnapshotPushDecision.COMMIT_INCOMING
                }
            }
            if (!existingRemotePayload.isNullOrBlank()) {
                if (existingRemotePayload == incomingPayload) {
                    return SnapshotPushDecision.SKIP_IDENTICAL
                }
                if (looksLikeJsonObject(existingRemotePayload) && existingRemotePayload != lastKnownRemotePayload) {
                    return SnapshotPushDecision.MERGE_UNSEEN_REMOTE
                }
            }
            return SnapshotPushDecision.COMMIT_INCOMING
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
            val escapedTitle = escapeJsonString(title, replaceNewlinesWithSpace = true)
            val escapedUrl = escapeJsonString(dataUrl)
            return """{"title":"$escapedTitle","dataUrl":"$escapedUrl"}"""
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
            val safeId = escapeJsonString(playerId.trim(), replaceNewlinesWithSpace = true)
            val safeName = escapeJsonString(displayName.trim(), replaceNewlinesWithSpace = true)
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
