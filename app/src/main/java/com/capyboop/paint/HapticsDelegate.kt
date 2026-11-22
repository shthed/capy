package com.capyboop.paint

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import android.view.HapticFeedbackConstants
import android.view.View

internal class HapticsDelegate(
    private val context: Context,
    private val rootViewProvider: () -> View?,
) {
    fun haptic(type: String) {
        val view = rootViewProvider()
        view?.post {
            performHaptic(context, view, type)
        }
    }

    companion object {
        const val TAG = CapyAndroidBridge.TAG

        fun resolveHapticSpec(type: String): CapyAndroidBridge.HapticSpec {
            return when (type.trim().lowercase()) {
                "tick" -> CapyAndroidBridge.HapticSpec(
                    normalizedType = "tick",
                    viewConstant = HapticFeedbackConstants.CLOCK_TICK,
                    predefinedEffectId = VibrationEffect.EFFECT_TICK,
                    oneShotDurationMs = 10L,
                    waveformTimings = null,
                )
                "success" -> CapyAndroidBridge.HapticSpec(
                    normalizedType = "success",
                    viewConstant = null,
                    predefinedEffectId = null,
                    oneShotDurationMs = null,
                    waveformTimings = longArrayOf(0L, 14L, 45L, 24L),
                )
                "warning" -> CapyAndroidBridge.HapticSpec(
                    normalizedType = "warning",
                    viewConstant = HapticFeedbackConstants.LONG_PRESS,
                    predefinedEffectId = VibrationEffect.EFFECT_HEAVY_CLICK,
                    oneShotDurationMs = 18L,
                    waveformTimings = null,
                )
                "error" -> CapyAndroidBridge.HapticSpec(
                    normalizedType = "error",
                    viewConstant = null,
                    predefinedEffectId = null,
                    oneShotDurationMs = null,
                    waveformTimings = longArrayOf(0L, 28L, 50L, 28L),
                )
                else -> CapyAndroidBridge.HapticSpec(
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
