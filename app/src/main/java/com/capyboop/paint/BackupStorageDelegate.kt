package com.capyboop.paint

import android.annotation.TargetApi
import android.os.Build
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption

internal class BackupStorageDelegate(
    private val backupDirProvider: () -> File,
) {
    fun saveBackup(key: String, data: String): Boolean {
        return saveBackupToDir(backupDirProvider(), key, data)
    }

    fun loadBackup(key: String): String? {
        return loadBackupFromDir(backupDirProvider(), key)
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
        const val TAG = CapyAndroidBridge.TAG
        const val BACKUP_FOLDER_NAME = "capy_saves"
        const val MAX_BACKUP_PAYLOAD_CHARS = 16 * 1024 * 1024
        internal val FILE_IO_LOCK = Any()

        fun sanitizeKey(key: String): String {
            val cleaned = key.replace(Regex("[^a-zA-Z0-9._-]"), "_")
            return cleaned.ifEmpty { "default_key" }
        }

        fun sanitizeFileName(fileName: String): String {
            val cleaned = fileName.trim().replace(Regex("[^a-zA-Z0-9._-]"), "_").trimStart('.')
            return cleaned.ifEmpty { "capy_export.bin" }
        }

        internal fun isInsideDirectory(dir: File, target: File): Boolean {
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

        internal fun writeAtomicBytesFile(dir: File, fileName: String, bytes: ByteArray): Boolean {
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
    }
}
