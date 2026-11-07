package com.capypaint.capy.util

import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentLinkedQueue

enum class LogLevel(@Suppress("unused") val priority: Int, val tagPrefix: String) {
    VERBOSE(Log.VERBOSE, "V"),
    DEBUG(Log.DEBUG, "D"),
    INFO(Log.INFO, "I"),
    WARN(Log.WARN, "W"),
    ERROR(Log.ERROR, "E"),
}

data class LogEntry(
    val timestamp: Long = System.currentTimeMillis(),
    val level: LogLevel,
    val tag: String,
    val message: String,
    val threadName: String = Thread.currentThread().name,
    val throwable: Throwable? = null,
) {
    fun format(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)
        val timeStr = sdf.format(Date(timestamp))
        val stackStr = if (throwable != null) {
            val sw = StringWriter()
            throwable.printStackTrace(PrintWriter(sw))
            "\n$sw"
        } else ""
        return "[$timeStr] [${level.tagPrefix}] [$tag] [$threadName]: $message$stackStr"
    }
}

@Suppress("unused")
object CapyLogger {

    private const val MAX_RING_BUFFER_ENTRIES = 1500
    private val ringBuffer = ConcurrentLinkedQueue<LogEntry>()
    private var appContext: Context? = null
    private val dateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)

    var isDebug: Boolean = com.capypaint.capy.BuildConfig.DEBUG

    fun init(context: Context) {
        appContext = context.applicationContext
        setupCrashHandler()
        i(
            "CapyLog",
            "CapyLogger initialized. App version 1.0, OS API ${Build.VERSION.SDK_INT}, Device: ${Build.MANUFACTURER} ${Build.MODEL}",
        )
    }

    private fun setupCrashHandler() {
        val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            e("CapyCrash", "FATAL UNCAUGHT EXCEPTION on thread '${thread.name}'", throwable)
            saveCrashDump(thread, throwable)
            defaultHandler?.uncaughtException(thread, throwable)
        }
    }

    fun v(tag: String, message: String, throwable: Throwable? = null) {
        if (!isDebug) return
        log(LogLevel.VERBOSE, tag, message, throwable)
    }

    fun d(tag: String, message: String, throwable: Throwable? = null) {
        if (!isDebug) return
        log(LogLevel.DEBUG, tag, message, throwable)
    }

    fun i(tag: String, message: String, throwable: Throwable? = null) {
        log(LogLevel.INFO, tag, message, throwable)
    }

    fun w(tag: String, message: String, throwable: Throwable? = null) {
        log(LogLevel.WARN, tag, message, throwable)
    }

    fun e(tag: String, message: String, throwable: Throwable? = null) {
        log(LogLevel.ERROR, tag, message, throwable)
    }

    private fun log(level: LogLevel, tag: String, message: String, throwable: Throwable? = null) {
        if (((level == LogLevel.VERBOSE) || (level == LogLevel.DEBUG)) && (!isDebug)) {
            return
        }

        try {
            when (level) {
                LogLevel.VERBOSE -> Log.v(tag, message, throwable)
                LogLevel.DEBUG -> Log.d(tag, message, throwable)
                LogLevel.INFO -> Log.i(tag, message, throwable)
                LogLevel.WARN -> Log.w(tag, message, throwable)
                LogLevel.ERROR -> Log.e(tag, message, throwable)
            }
        } catch (_: Throwable) {
            // Guard against unmocked android.util.Log in local JVM unit test environment
        }

        val entry = LogEntry(
            level = level,
            tag = tag,
            message = message,
            throwable = throwable,
        )

        ringBuffer.add(entry)
        while (ringBuffer.size > MAX_RING_BUFFER_ENTRIES) {
            ringBuffer.poll()
        }
    }

    fun clearLogs() {
        ringBuffer.clear()
    }

    fun getLogHistoryFormatted(): String {
        val sb = StringBuilder()
        sb.append("=== CAPY COLOR BY NUMBER DEBUG LOG ===\n")
        sb.append("Exported at: ").append(dateFormat.format(Date())).append("\n")
        sb.append("Device: ").append(Build.MANUFACTURER).append(" ").append(Build.MODEL).append("\n")
        sb.append("Android Version: ").append(Build.VERSION.RELEASE).append(" (API ").append(Build.VERSION.SDK_INT).append(")\n")
        sb.append("Total Buffered Entries: ").append(ringBuffer.size).append("\n")
        sb.append("--------------------------------------------------\n\n")

        val snapshot = ringBuffer.toList()
        for (entry in snapshot) {
            sb.append(entry.format()).append("\n")
        }
        return sb.toString()
    }

    private fun saveCrashDump(thread: Thread, throwable: Throwable) {
        val ctx = appContext ?: return
        try {
            val crashFile = File(ctx.filesDir, "capy_crash_dump.txt")
            val sb = StringBuilder()
            sb.append("=== CAPY FATAL CRASH DUMP ===\n")
            sb.append("Crash Time: ").append(dateFormat.format(Date())).append("\n")
            sb.append("Thread: ").append(thread.name).append(" (ID ").append(thread.id).append(")\n")
            sb.append("Device: ").append(Build.MANUFACTURER).append(" ").append(Build.MODEL).append("\n")
            sb.append("Android API: ").append(Build.VERSION.SDK_INT).append("\n\n")

            sb.append("=== UNCAUGHT EXCEPTION STACK TRACE ===\n")
            val sw = StringWriter()
            throwable.printStackTrace(PrintWriter(sw))
            sb.append(sw.toString()).append("\n\n")

            sb.append("=== RECENT LOG HISTORY PRIOR TO CRASH ===\n")
            val snapshot = ringBuffer.toList()
            for (entry in snapshot) {
                sb.append(entry.format()).append("\n")
            }

            FileOutputStream(crashFile).use { out ->
                out.write(sb.toString().toByteArray())
            }
            Log.e("CapyCrash", "Crash dump successfully written to '${crashFile.absolutePath}' (${crashFile.length()} bytes)")
        } catch (e: Exception) {
            Log.e("CapyCrash", "Failed to save crash dump", e)
        }
    }

    fun getLastCrashDump(context: Context): String? {
        return try {
            val crashFile = File(context.filesDir, "capy_crash_dump.txt")
            if (crashFile.exists()) crashFile.readText() else null
        } catch (_: Exception) {
            null
        }
    }

    fun clearCrashDump(context: Context) {
        try {
            val crashFile = File(context.filesDir, "capy_crash_dump.txt")
            if (crashFile.exists()) crashFile.delete()
        } catch (_: Exception) {}
    }

    fun shareLogText(context: Context, text: String, title: String = "Capy Paint Debug Log") {
        try {
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_SUBJECT, title)
                putExtra(Intent.EXTRA_TEXT, text)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            val chooserIntent = Intent.createChooser(intent, title).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(chooserIntent)
        } catch (e: Exception) {
            e("CapyLog", "Failed to share log text", e)
        }
    }
}
