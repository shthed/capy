package com.capyboop.paint

import android.content.Context
import android.util.Log
import androidx.core.content.edit
import java.io.File

internal class PlayGamesSnapshotDelegate(
    private val context: Context,
    private val cloudDirProvider: () -> File,
    private val onRequestPlayGamesSignIn: (() -> Unit)? = null,
    private val onSaveCloudSnapshot: ((String, String) -> Unit)? = null,
    private val onRequestCloudSnapshotPull: ((String) -> Unit)? = null,
    private val isPlayGamesConfiguredProvider: () -> Boolean = {
        isPlayGamesAppIdConfigured(readPlayGamesAppId(context))
    },
) {
    fun saveLocalCloudSnapshotOnly(slotKey: String, payloadJson: String): Boolean {
        return BackupStorageDelegate.saveBackupToDir(cloudDirProvider(), slotKey, payloadJson)
    }

    fun saveCloudSnapshot(slotKey: String, payloadJson: String): Boolean {
        val savedLocal = BackupStorageDelegate.saveBackupToDir(cloudDirProvider(), slotKey, payloadJson)
        onSaveCloudSnapshot?.invoke(slotKey, payloadJson)
        return savedLocal
    }

    fun loadCloudSnapshot(slotKey: String): String? {
        return BackupStorageDelegate.loadBackupFromDir(cloudDirProvider(), slotKey)
    }

    fun saveCloudBinaryChunk(
        blobKey: String,
        chunkIndex: Int,
        totalChunks: Int,
        base64Chunk: String,
    ): Boolean {
        val savedLocal = saveCloudBinaryChunkToDir(
            dir = cloudDirProvider(),
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

    fun loadCloudBinaryChunk(blobKey: String, chunkIndex: Int): String? {
        return loadCloudBinaryChunkFromDir(cloudDirProvider(), blobKey, chunkIndex)
    }

    fun isPlayGamesConfigured(): Boolean {
        return try {
            isPlayGamesConfiguredProvider()
        } catch (_: Exception) {
            false
        }
    }

    fun requestCloudSnapshotPull(slotKey: String): Boolean {
        if (!isPlayGamesConfigured()) {
            return false
        }
        val safeKey = BackupStorageDelegate.sanitizeKey(slotKey)
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

    fun signInPlayGames(): String? {
        Log.d(TAG, "Play Games v2 sign-in requested")
        onRequestPlayGamesSignIn?.invoke()
        return loadCachedPlayGamesProfileJson()
    }

    companion object {
        const val TAG = CapyAndroidBridge.TAG
        const val CLOUD_FOLDER_NAME = "capy_cloud"
        const val PLAY_GAMES_PREFS_NAME = "capy_play_games_prefs"
        const val KEY_PLAY_GAMES_PLAYER_ID = "player_id"
        const val KEY_PLAY_GAMES_DISPLAY_NAME = "display_name"
        const val DEFAULT_CLOUD_BINARY_CHUNK_BYTES = 180_000
        const val MAX_CLOUD_BINARY_CHUNKS = 32
        const val MAX_CLOUD_BINARY_TOTAL_BYTES = 3 * 1024 * 1024
        const val MAX_CLOUD_BINARY_CHUNK_CHARS = 300_000

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

        fun formatCloudBinaryChunkSlotKey(blobKey: String, chunkIndex: Int): String {
            return "${BackupStorageDelegate.sanitizeKey(blobKey)}_part_$chunkIndex"
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
            return synchronized(BackupStorageDelegate.FILE_IO_LOCK) {
                val slotKey = formatCloudBinaryChunkSlotKey(blobKey, chunkIndex)
                val saved = BackupStorageDelegate.saveBackupToDir(dir, slotKey, base64Chunk)
                if (!saved) return@synchronized false

                if (chunkIndex == totalChunks - 1) {
                    val safePrefix = BackupStorageDelegate.sanitizeKey(blobKey)
                    for (staleIdx in totalChunks until MAX_CLOUD_BINARY_CHUNKS) {
                        val staleFile = File(dir, "${safePrefix}_part_$staleIdx.json")
                        if (BackupStorageDelegate.isInsideDirectory(dir, staleFile) && staleFile.exists()) {
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
            return synchronized(BackupStorageDelegate.FILE_IO_LOCK) {
                BackupStorageDelegate.loadBackupFromDir(dir, formatCloudBinaryChunkSlotKey(blobKey, chunkIndex))
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

            val safeKey = BackupStorageDelegate.sanitizeKey(blobKey)
            return synchronized(BackupStorageDelegate.FILE_IO_LOCK) {
                for (i in 0 until totalChunks) {
                    val start = i * chunkSizeBytes
                    val end = minOf(bytes.size, start + chunkSizeBytes)
                    val slice = bytes.copyOfRange(start, end)
                    if (!BackupStorageDelegate.writeAtomicBytesFile(dir, "${safeKey}_bin_$i.bin", slice)) {
                        return@synchronized 0
                    }
                }
                val metaText = "$totalChunks:${bytes.size}"
                if (!BackupStorageDelegate.saveBackupToDir(dir, "${safeKey}_bin_meta", metaText)) {
                    return@synchronized 0
                }
                for (staleIdx in totalChunks until MAX_CLOUD_BINARY_CHUNKS) {
                    val staleFile = File(dir, "${safeKey}_bin_$staleIdx.bin")
                    if (BackupStorageDelegate.isInsideDirectory(dir, staleFile) && staleFile.exists()) {
                        staleFile.delete()
                    }
                }
                totalChunks
            }
        }

        fun loadCloudBinaryBytesFromDir(dir: File, blobKey: String): ByteArray? {
            if (blobKey.isBlank()) return null
            val safeKey = BackupStorageDelegate.sanitizeKey(blobKey)
            return synchronized(BackupStorageDelegate.FILE_IO_LOCK) {
                val metaText = BackupStorageDelegate.loadBackupFromDir(dir, "${safeKey}_bin_meta")
                    ?: return@synchronized null
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
                        if (!BackupStorageDelegate.isInsideDirectory(dir, chunkFile) || !chunkFile.exists()) {
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

        fun looksLikeJsonObject(raw: String?): Boolean {
            val trimmed = raw?.trim() ?: return false
            return trimmed.startsWith("{") && trimmed.endsWith("}")
        }

        fun decideSnapshotPushAction(
            slotKey: String,
            existingRemotePayload: String?,
            lastKnownRemotePayload: String?,
            incomingPayload: String,
        ): CapyAndroidBridge.SnapshotPushDecision {
            val safeSlot = BackupStorageDelegate.sanitizeKey(slotKey)
            if (safeSlot.startsWith("pgblob_")) {
                return if (existingRemotePayload == incomingPayload) {
                    CapyAndroidBridge.SnapshotPushDecision.SKIP_IDENTICAL
                } else {
                    CapyAndroidBridge.SnapshotPushDecision.COMMIT_INCOMING
                }
            }
            if (!existingRemotePayload.isNullOrBlank()) {
                if (existingRemotePayload == incomingPayload) {
                    return CapyAndroidBridge.SnapshotPushDecision.SKIP_IDENTICAL
                }
                if (looksLikeJsonObject(existingRemotePayload) && existingRemotePayload != lastKnownRemotePayload) {
                    return CapyAndroidBridge.SnapshotPushDecision.MERGE_UNSEEN_REMOTE
                }
            }
            return CapyAndroidBridge.SnapshotPushDecision.COMMIT_INCOMING
        }

        fun formatPlayGamesIdentityJson(playerId: String, displayName: String): String {
            val safeId = CapyAndroidBridge.escapeJsonString(playerId.trim(), replaceNewlinesWithSpace = true)
            val safeName = CapyAndroidBridge.escapeJsonString(displayName.trim(), replaceNewlinesWithSpace = true)
            return """{"playerId":"$safeId","displayName":"$safeName"}"""
        }
    }
}
