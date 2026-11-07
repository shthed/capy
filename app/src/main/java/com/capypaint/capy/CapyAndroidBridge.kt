package com.capypaint.capy

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Base64
import android.view.HapticFeedbackConstants
import android.view.View
import android.webkit.JavascriptInterface
import androidx.core.content.FileProvider
import java.io.File

class CapyAndroidBridge(
    private val context: Context,
    private val rootViewProvider: () -> View?,
    private val onModalStateChanged: (Boolean) -> Unit,
) {
    @Volatile
    var isModalOpen: Boolean = false
        private set

    @Volatile
    var pendingSharedImageJson: String? = null

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

    @JavascriptInterface
    fun haptic(type: String) {
        val view = rootViewProvider()
        view?.post {
            performHaptic(context, view, type)
        }
    }

    @JavascriptInterface
    fun setModalOpen(isOpen: Boolean) {
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

    @JavascriptInterface
    fun consumePendingSharedImage(): String? {
        val pending = pendingSharedImageJson
        pendingSharedImageJson = null
        return pending
    }

    @JavascriptInterface
    @Suppress("unused")
    fun getAppVersion(): String {
        return BuildConfig.VERSION_NAME
    }

    @JavascriptInterface
    fun shareImage(title: String, dataUrl: String) {
        try {
            val commaIndex = dataUrl.indexOf(',')
            val base64Part = if (commaIndex >= 0) dataUrl.substring(commaIndex + 1) else dataUrl
            val bytes = Base64.decode(base64Part, Base64.DEFAULT)

            val shareFile = File(context.cacheDir, "capy_shared_artwork.png")
            shareFile.writeBytes(bytes)

            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                shareFile,
            )

            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "image/png"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_TITLE, title)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(shareIntent, title).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(chooser)
        } catch (_: Exception) {
            // Ignore share failure
        }
    }

    companion object {
        const val BACKUP_FOLDER_NAME = "capy_saves"

        fun sanitizeKey(key: String): String {
            val cleaned = key.replace(Regex("[^a-zA-Z0-9._-]"), "_")
            return cleaned.ifEmpty { "default_key" }
        }

        fun saveBackupToDir(dir: File, key: String, data: String): Boolean {
            return try {
                if (!dir.exists() && !dir.mkdirs()) {
                    return false
                }
                val targetFile = File(dir, "${sanitizeKey(key)}.json")
                targetFile.writeText(data, Charsets.UTF_8)
                true
            } catch (_: Exception) {
                false
            }
        }

        fun loadBackupFromDir(dir: File, key: String): String? {
            return try {
                val targetFile = File(dir, "${sanitizeKey(key)}.json")
                if (!targetFile.exists()) return null
                targetFile.readText(Charsets.UTF_8)
            } catch (_: Exception) {
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

        fun formatSafeAreaInsetsJson(top: Int, bottom: Int, left: Int, right: Int): String {
            return """{"top":$top,"bottom":$bottom,"left":$left,"right":$right}"""
        }

        private fun performHaptic(context: Context, view: View, type: String) {
            try {
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
            } catch (_: Exception) {
                // Ignore vibration errors on unsupported devices
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
