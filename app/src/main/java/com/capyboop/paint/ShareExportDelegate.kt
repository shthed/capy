package com.capyboop.paint

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.util.Base64
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File
import java.net.URI
import java.util.UUID

internal class ShareExportDelegate(
    private val context: Context,
    private val cacheDirProvider: () -> File = { context.cacheDir },
) {
    fun shareTextLink(title: String, url: String) {
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

    fun shareImage(title: String, dataUrl: String) {
        val spec = resolveShareImageSpec(dataUrl)
        shareFile(title, spec.fileName, spec.mimeType, spec.base64Payload)
    }

    fun shareFile(title: String, fileName: String, mimeType: String, base64Data: String) {
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

            val shareFile = prepareSharedExportFile(cacheDirProvider(), fileName)
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
                clipData = ClipData.newRawUri(safeTitle, uri)
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

    companion object {
        const val TAG = CapyAndroidBridge.TAG
        const val SHARE_FOLDER_NAME = "shared"
        const val SHARED_FILE_MAX_AGE_MS = 24L * 60L * 60L * 1000L
        const val MAX_SHARE_FILE_BYTES = 16 * 1024 * 1024
        const val MAX_SHARE_BASE64_CHARS = 24 * 1024 * 1024
        const val MAX_SHARED_IMAGE_DIMENSION = 2048
        const val MAX_RAW_SHARED_IMAGE_BYTES = 4 * 1024 * 1024
        const val IMAGE_MAGIC_HEADER_BYTES = 12
        const val MAX_EXPORT_BASE_NAME_LENGTH = 120
        const val MAX_EXPORT_EXTENSION_LENGTH = 32

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

        private val ALLOWED_ISO_BMFF_IMAGE_BRANDS = setOf(
            "heic",
            "heix",
            "hevc",
            "hevx",
            "heim",
            "heis",
            "mif1",
            "msf1",
            "avif",
            "avis",
        )

        fun resolveShareImageSpec(dataUrl: String): CapyAndroidBridge.ShareImageSpec {
            val trimmed = dataUrl.trim()
            val commaIndex = trimmed.indexOf(',')
            if (commaIndex < 0) {
                return CapyAndroidBridge.ShareImageSpec(
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
            return CapyAndroidBridge.ShareImageSpec(
                fileName = "capy_shared_artwork.$ext",
                mimeType = normalizedMime,
                base64Payload = payload,
            )
        }

        internal fun buildUniqueExportFileName(
            safeName: String,
            nowMs: Long,
            uniqueToken: String = UUID.randomUUID().toString().replace("-", "").take(12),
        ): String {
            val dotIndex = safeName.lastIndexOf('.')
            val suffix = "${nowMs}_$uniqueToken"
            return if ((dotIndex > 0) && (dotIndex < safeName.length - 1)) {
                val baseName = safeName.substring(0, dotIndex).take(MAX_EXPORT_BASE_NAME_LENGTH)
                val extension = safeName.substring(dotIndex).take(MAX_EXPORT_EXTENSION_LENGTH)
                "${baseName}_${suffix}${extension}"
            } else {
                val baseName = safeName.take(MAX_EXPORT_BASE_NAME_LENGTH)
                "${baseName}_${suffix}"
            }
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
            val safeName = BackupStorageDelegate.sanitizeFileName(fileName)
            val uniqueName = buildUniqueExportFileName(safeName, nowMs)
            return File(sharedDir, uniqueName)
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

        fun isAllowedIncomingShareUriScheme(scheme: String?): Boolean {
            return scheme == "content"
        }

        fun isValidImageMagicBytes(header: ByteArray, length: Int = header.size): Boolean {
            val len = minOf(length, header.size)
            if (len < 2) return false

            // PNG: 89 50 4E 47 0D 0A 1A 0A
            if (
                (len >= 8) &&
                (header[0] == 0x89.toByte()) &&
                (header[1] == 0x50.toByte()) &&
                (header[2] == 0x4E.toByte()) &&
                (header[3] == 0x47.toByte()) &&
                (header[4] == 0x0D.toByte()) &&
                (header[5] == 0x0A.toByte()) &&
                (header[6] == 0x1A.toByte()) &&
                (header[7] == 0x0A.toByte())
            ) {
                return true
            }

            // JPEG: FF D8 FF
            if (
                (len >= 3) &&
                (header[0] == 0xFF.toByte()) &&
                (header[1] == 0xD8.toByte()) &&
                (header[2] == 0xFF.toByte())
            ) {
                return true
            }

            // GIF: GIF87a or GIF89a
            if (
                (len >= 6) &&
                (header[0] == 'G'.code.toByte()) &&
                (header[1] == 'I'.code.toByte()) &&
                (header[2] == 'F'.code.toByte()) &&
                (header[3] == '8'.code.toByte()) &&
                ((header[4] == '7'.code.toByte()) || (header[4] == '9'.code.toByte())) &&
                (header[5] == 'a'.code.toByte())
            ) {
                return true
            }

            // WebP: RIFF....WEBP
            if (
                (len >= 12) &&
                (header[0] == 'R'.code.toByte()) &&
                (header[1] == 'I'.code.toByte()) &&
                (header[2] == 'F'.code.toByte()) &&
                (header[3] == 'F'.code.toByte()) &&
                (header[8] == 'W'.code.toByte()) &&
                (header[9] == 'E'.code.toByte()) &&
                (header[10] == 'B'.code.toByte()) &&
                (header[11] == 'P'.code.toByte())
            ) {
                return true
            }

            // BMP: 42 4D ("BM") + 4-byte file size header
            if ((len >= 6) && (header[0] == 0x42.toByte()) && (header[1] == 0x4D.toByte())) {
                return true
            }

            // HEIF / AVIF (ISO BMFF): ....ftyp<brand>
            if (
                (len >= 12) &&
                (header[4] == 'f'.code.toByte()) &&
                (header[5] == 't'.code.toByte()) &&
                (header[6] == 'y'.code.toByte()) &&
                (header[7] == 'p'.code.toByte())
            ) {
                val brand = String(header, 8, 4, Charsets.US_ASCII).lowercase()
                if (brand in ALLOWED_ISO_BMFF_IMAGE_BRANDS) {
                    return true
                }
            }

            return false
        }

        fun formatSharedImageJson(title: String, dataUrl: String): String {
            val escapedTitle = CapyAndroidBridge.escapeJsonString(title, replaceNewlinesWithSpace = true)
            val escapedUrl = CapyAndroidBridge.escapeJsonString(dataUrl)
            return """{"title":"$escapedTitle","dataUrl":"$escapedUrl"}"""
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
    }
}
