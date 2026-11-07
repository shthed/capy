package com.capypaint.capy.engine

import android.graphics.Bitmap
import androidx.core.graphics.scale
import com.capypaint.capy.model.ImageType
import com.capypaint.capy.model.PaletteDetail
import com.capypaint.capy.util.CapyLogger
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max

data class ImageAnalysisResult(
    val detectedType: ImageType,
    val edgeRatio: Float,
    val localVariance: Float,
    val globalVariance: Float,
    val colorClusterCount: Int,
    val recommendedColors: Map<PaletteDetail, Int>,
) {
    fun resolveColorCount(detail: PaletteDetail, requestedColors: Int): Int {
        return when (detail) {
            PaletteDetail.LOW -> recommendedColors[PaletteDetail.LOW] ?: 10
            PaletteDetail.MEDIUM -> recommendedColors[PaletteDetail.MEDIUM] ?: 18
            PaletteDetail.HIGH -> recommendedColors[PaletteDetail.HIGH] ?: 32
            PaletteDetail.AUTO -> recommendedColors[PaletteDetail.AUTO] ?: 18
            PaletteDetail.CUSTOM -> requestedColors.coerceIn(4, 200)
        }
    }
}

object ImageAnalyzer {

    fun analyze(bitmap: Bitmap): ImageAnalysisResult {
        // Downsample to max 128x128 for ultra-fast performance (<5ms)
        val sampleDim = 128
        val scale = minOf(1.0f, sampleDim.toFloat() / maxOf(bitmap.width, bitmap.height))
        val sampleW = (bitmap.width * scale).toInt().coerceAtLeast(8)
        val sampleH = (bitmap.height * scale).toInt().coerceAtLeast(8)

        val scaledBitmap = if (scale < 1.0f) {
            bitmap.scale(sampleW, sampleH)
        } else {
            bitmap
        }

        val totalPixels = sampleW * sampleH
        val pixels = IntArray(totalPixels)
        scaledBitmap.getPixels(pixels, 0, sampleW, 0, 0, sampleW, sampleH)

        // 1. Calculate RGB Luminance channel array for edge / variance analysis
        val lum = IntArray(totalPixels)
        var sumR = 0L
        var sumG = 0L
        var sumB = 0L

        // Fast 5-bit color space histogram for color cluster count
        val colorHistogram = IntArray(32768) // 32x32x32 buckets

        for (i in 0 until totalPixels) {
            val p = pixels[i]
            val r = (p shr 16) and 0xFF
            val g = (p shr 8) and 0xFF
            val b = p and 0xFF

            lum[i] = ((0.299f * r) + (0.587f * g) + (0.114f * b)).toInt()
            sumR += r
            sumG += g
            sumB += b

            val r5 = r shr 3
            val g5 = g shr 3
            val b5 = b shr 3
            val key = (r5 shl 10) or (g5 shl 5) or b5
            colorHistogram[key]++
        }

        // Count unique color buckets with > 0.05% pixel presence
        val minClusterPixels = (totalPixels * 0.0005f).toInt().coerceAtLeast(1)
        var colorClusterCount = 0
        for (count in colorHistogram) {
            if (count >= minClusterPixels) {
                colorClusterCount++
            }
        }

        // 2. Global variance calculation
        val avgR = (sumR.toDouble() / totalPixels)
        val avgG = (sumG.toDouble() / totalPixels)
        val avgB = (sumB.toDouble() / totalPixels)

        var globalVarSum = 0.0
        for (i in 0 until totalPixels) {
            val p = pixels[i]
            val dr = ((p shr 16) and 0xFF) - avgR
            val dg = ((p shr 8) and 0xFF) - avgG
            val db = (p and 0xFF) - avgB
            globalVarSum += ((dr * dr) + (dg * dg) + (db * db))
        }
        val globalVariance = (globalVarSum / totalPixels).toFloat()

        // 3. Local variance & Sobel edge intensity calculation
        var edgeCount = 0
        var localVarSum = 0.0
        var evaluatedLocalPatches = 0

        val thresholdEdge = 48 // Sharp luminance gradient threshold

        for (y in 1 until (sampleH - 1)) {
            val row = y * sampleW
            for (x in 1 until (sampleW - 1)) {
                val idx = row + x

                // Sobel gradient magnitude
                val gx = (lum[(idx - sampleW) + 1] + (2 * lum[idx + 1]) + lum[(idx + sampleW) + 1]) -
                         (lum[(idx - sampleW) - 1] + (2 * lum[idx - 1]) + lum[(idx + sampleW) - 1])
                val gy = (lum[(idx + sampleW) - 1] + (2 * lum[idx + sampleW]) + lum[(idx + sampleW) + 1]) -
                         (lum[(idx - sampleW) - 1] + (2 * lum[idx - sampleW]) + lum[(idx - sampleW) + 1])

                val mag = abs(gx) + abs(gy)
                if (mag > thresholdEdge) {
                    edgeCount++
                }

                // 3x3 patch local variance
                var patchSum = 0
                val neighbors = intArrayOf(
                    lum[(idx - sampleW) - 1], lum[idx - sampleW], lum[(idx - sampleW) + 1],
                    lum[idx - 1], lum[idx], lum[idx + 1],
                    lum[(idx + sampleW) - 1], lum[idx + sampleW], lum[(idx + sampleW) + 1],
                )
                for (n in neighbors) patchSum += n
                val patchAvg = patchSum / 9.0
                var patchVar = 0.0
                for (n in neighbors) {
                    val diff = n - patchAvg
                    patchVar += diff * diff
                }
                localVarSum += (patchVar / 9.0)
                evaluatedLocalPatches++
            }
        }

        val edgeRatio = edgeCount.toFloat() / max(1, evaluatedLocalPatches)
        val localVariance = (localVarSum / max(1, evaluatedLocalPatches)).toFloat()

        // 4. Classification heuristic (Drawing vs Photo)
        val varRatio = if (globalVariance > 1f) localVariance / globalVariance else 1f
        val isDrawing = ((edgeRatio > 0.08f) && (varRatio < 0.22f)) ||
                         ((colorClusterCount < 28) && (edgeRatio > 0.05f)) ||
                         (colorClusterCount < 18)

        val detectedType = if (isDrawing) ImageType.DRAWING else ImageType.PHOTO

        // 5. Recommended color count mapping
        val lowColors: Int
        val medColors: Int
        val highColors: Int

        if (detectedType == ImageType.DRAWING) {
            lowColors = (colorClusterCount * 0.5f).toInt().coerceIn(6, 12)
            medColors = (colorClusterCount * 0.85f).toInt().coerceIn(12, 22)
            highColors = (colorClusterCount * 1.3f).toInt().coerceIn(20, 36)
        } else { // PHOTO
            lowColors = (colorClusterCount * 0.45f).toInt().coerceIn(10, 16)
            medColors = (colorClusterCount * 0.75f).toInt().coerceIn(16, 28)
            highColors = (colorClusterCount * 1.25f).toInt().coerceIn(28, 56)
        }

        val recommendedMap = mapOf(
            PaletteDetail.LOW to lowColors,
            PaletteDetail.MEDIUM to medColors,
            PaletteDetail.HIGH to highColors,
            PaletteDetail.AUTO to medColors,
        )

        val result = ImageAnalysisResult(
            detectedType = detectedType,
            edgeRatio = edgeRatio,
            localVariance = localVariance,
            globalVariance = globalVariance,
            colorClusterCount = colorClusterCount,
            recommendedColors = recommendedMap,
        )

        CapyLogger.d(
            "CapyEngine",
            "ImageAnalyzer.analyze() -> detectedType=$detectedType, clusters=$colorClusterCount, edgeRatio=${String.format(Locale.US, "%.3f", edgeRatio)}, autoColors=$medColors",
        )

        return result
    }
}
