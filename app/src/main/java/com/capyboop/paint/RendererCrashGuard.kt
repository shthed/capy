package com.capyboop.paint

/**
 * Sliding-window loop guard for Android WebView renderer terminations (`onRenderProcessGone`).
 *
 * Permits at most [maxRecoveries] automatic WebView recreations within [windowMs] so transient
 * memory pressure or renderer faults recover transparently, while repeated crashes within the
 * window fall back to a static user-triggered reload screen instead of entering a crash loop.
 */
class RendererCrashGuard(
    private val maxRecoveries: Int = DEFAULT_MAX_RECOVERIES,
    private val windowMs: Long = DEFAULT_WINDOW_MS,
    private val clockMs: () -> Long = DEFAULT_CLOCK_MS,
) {
    enum class Decision {
        RECOVER,
        SHOW_FALLBACK,
    }

    data class ExitRecord(
        val decision: Decision,
        val recentRecoveryCount: Int,
        val totalExitCount: Int,
    )

    private val recoveryTimestamps = ArrayDeque<Long>()
    private var totalExits: Int = 0

    init {
        require(maxRecoveries >= 0) { "maxRecoveries must be non-negative" }
        require(windowMs > 0L) { "windowMs must be positive" }
    }

    @Synchronized
    fun recordExit(): ExitRecord {
        val now = clockMs()
        pruneExpired(now)
        totalExits += 1
        return if (recoveryTimestamps.size < maxRecoveries) {
            recoveryTimestamps.addLast(now)
            ExitRecord(
                decision = Decision.RECOVER,
                recentRecoveryCount = recoveryTimestamps.size,
                totalExitCount = totalExits,
            )
        } else {
            ExitRecord(
                decision = Decision.SHOW_FALLBACK,
                recentRecoveryCount = recoveryTimestamps.size,
                totalExitCount = totalExits,
            )
        }
    }

    @Synchronized
    fun recentRecoveryCount(): Int {
        pruneExpired(clockMs())
        return recoveryTimestamps.size
    }

    @Synchronized
    fun totalExitCount(): Int = totalExits

    @Synchronized
    fun reset() {
        recoveryTimestamps.clear()
    }

    private fun pruneExpired(now: Long) {
        while (recoveryTimestamps.isNotEmpty()) {
            val oldest = recoveryTimestamps.first()
            val elapsed = now - oldest
            val expired = (now < oldest) || (elapsed < 0L) || (elapsed >= windowMs)
            if (expired) {
                recoveryTimestamps.removeFirst()
            } else {
                break
            }
        }
    }

    companion object {
        const val DEFAULT_MAX_RECOVERIES: Int = 2
        const val DEFAULT_WINDOW_MS: Long = 60_000L
        private val DEFAULT_CLOCK_MS: () -> Long = { System.nanoTime() / 1_000_000L }
    }
}
