package com.capypaint.capy.engine

import android.graphics.Bitmap
import androidx.compose.ui.graphics.Color
import com.capypaint.capy.util.CapyLogger
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ForkJoinPool
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.random.Random

object ColorQuantizer {

    private val cpuCores = Runtime.getRuntime().availableProcessors().coerceAtLeast(1)

    private inline fun parallelFor(
        total: Int,
        minChunkSize: Int = 4096,
        crossinline action: (start: Int, end: Int) -> Unit,
    ) {
        if ((cpuCores <= 1) || (total < (minChunkSize * 2))) {
            action(0, total)
            return
        }

        val numChunks = minOf(cpuCores, total / minChunkSize)
        val chunkSize = total / numChunks
        val latch = CountDownLatch(numChunks)

        for (c in 0 until numChunks) {
            val start = c * chunkSize
            val end = if (c == (numChunks - 1)) total else (c + 1) * chunkSize
            ForkJoinPool.commonPool().execute {
                try {
                    action(start, end)
                } finally {
                    latch.countDown()
                }
            }
        }
        latch.await()
    }

    data class Rgb(val r: Int, val g: Int, val b: Int) {
        fun toColor(): Color = Color(r, g, b)

        fun isLight(): Boolean {
            val lum = (0.299 * r) + (0.587 * g) + (0.114 * b)
            return lum > 140
        }

        fun toHex(): String = String.format("#%02X%02X%02X", r, g, b)

        fun toArgb(): Int = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
    }

    /**
     * Fast red-mean perceptual color distance (approximates CIELAB Delta-E)
     */
    fun perceptualDistanceSq(r1: Int, g1: Int, b1: Int, r2: Int, g2: Int, b2: Int): Int {
        val rMean = (r1 + r2) shr 1
        val dr = r1 - r2
        val dg = g1 - g2
        val db = b1 - b2
        val weightR = 2 + (rMean shr 8)
        val weightG = 4
        val weightB = 2 + ((255 - rMean) shr 8)
        return (weightR * dr * dr) + (weightG * dg * dg) + (weightB * db * db)
    }

    /**
     * Fast in-place insertion sort for 9-element array without Quicksort method overhead
     */
    private fun sort9(a: IntArray) {
        for (i in 1..8) {
            val key = a[i]
            var j = i - 1
            while ((j >= 0) && (a[j] > key)) {
                a[j + 1] = a[j]
                j--
            }
            a[j + 1] = key
        }
    }

    /**
     * Parallel edge-preserving 3x3 median filter pass to remove raster noise while preserving outlines
     */
    fun applyMedianFilter(pixels: IntArray, width: Int, height: Int): IntArray {
        val result = pixels.copyOf()
        val rowsToProcess = height - 2
        if (rowsToProcess <= 0) return result

        parallelFor(rowsToProcess, minChunkSize = 8) { startRow, endRow ->
            val rVals = IntArray(9)
            val gVals = IntArray(9)
            val bVals = IntArray(9)

            for (r in startRow until endRow) {
                val y = r + 1
                val yRow = y * width
                for (x in 1 until (width - 1)) {
                    val idx = yRow + x
                    var k = 0
                    for (ny in (y - 1)..(y + 1)) {
                        val nRow = ny * width
                        for (nx in (x - 1)..(x + 1)) {
                            val p = pixels[nRow + nx]
                            rVals[k] = (p shr 16) and 0xFF
                            gVals[k] = (p shr 8) and 0xFF
                            bVals[k] = p and 0xFF
                            k++
                        }
                    }
                    sort9(rVals)
                    sort9(gVals)
                    sort9(bVals)
                    val medR = rVals[4]
                    val medG = gVals[4]
                    val medB = bVals[4]
                    result[idx] = (0xFF shl 24) or (medR shl 16) or (medG shl 8) or medB
                }
            }
        }
        return result
    }

    fun quantize(
        bitmap: Bitmap,
        k: Int = 14,
        maxIterations: Int = 12,
        applySmoothing: Boolean = true,
        usePerceptualDistance: Boolean = true,
        onProgress: ((Float, String) -> Unit)? = null,
    ): Pair<List<PaletteColor>, IntArray> {
        val t0 = System.currentTimeMillis()
        val width = bitmap.width
        val height = bitmap.height
        val totalPixels = width * height
        CapyLogger.d("CapyEngine", "ColorQuantizer.quantize() START -> k=$k, dimensions=${width}x$height ($totalPixels px)")
        onProgress?.invoke(0.05f, "Preparing image bitmap...")
        val pixels = IntArray(totalPixels)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)

        val actualK = k.coerceIn(2, minOf(totalPixels, 200))

        // Primitive arrays for centroids (R, G, B) to eliminate object allocations
        val centroidR = IntArray(actualK)
        val centroidG = IntArray(actualK)
        val centroidB = IntArray(actualK)

        // Seed first centroid randomly
        val firstIdx = Random.nextInt(totalPixels)
        val firstPixel = pixels[firstIdx]
        centroidR[0] = (firstPixel shr 16) and 0xFF
        centroidG[0] = (firstPixel shr 8) and 0xFF
        centroidB[0] = firstPixel and 0xFF
        var effectiveK = 1

        val minDistances = IntArray(totalPixels) { Int.MAX_VALUE }

        val tInit0 = System.currentTimeMillis()
        // K-Means++ initialization loop
        while ((effectiveK < actualK) && (effectiveK < totalPixels)) {
            val initPct = 0.05f + ((effectiveK.toFloat() / actualK) * 0.15f)
            onProgress?.invoke(initPct, "Initializing palette centroids...")

            val lastR = centroidR[effectiveK - 1]
            val lastG = centroidG[effectiveK - 1]
            val lastB = centroidB[effectiveK - 1]

            var sumDistances = 0L
            for (i in 0 until totalPixels) {
                val p = pixels[i]
                val pxR = (p shr 16) and 0xFF
                val pxG = (p shr 8) and 0xFF
                val pxB = p and 0xFF

                val dist = if (usePerceptualDistance) {
                    perceptualDistanceSq(pxR, pxG, pxB, lastR, lastG, lastB)
                } else {
                    val dr = pxR - lastR
                    val dg = pxG - lastG
                    val db = pxB - lastB
                    (dr * dr) + (dg * dg) + (db * db)
                }

                if (dist < minDistances[i]) {
                    minDistances[i] = dist
                }
                sumDistances += minDistances[i]
            }

            if (sumDistances <= 0L) break

            var target = Random.nextLong(sumDistances)
            var chosenIdx = 0
            for (i in 0 until totalPixels) {
                target -= minDistances[i]
                if (target <= 0L) {
                    chosenIdx = i
                    break
                }
            }

            val chosenPixel = pixels[chosenIdx]
            centroidR[effectiveK] = (chosenPixel shr 16) and 0xFF
            centroidG[effectiveK] = (chosenPixel shr 8) and 0xFF
            centroidB[effectiveK] = chosenPixel and 0xFF
            effectiveK++
        }
        val tInit = System.currentTimeMillis() - tInit0

        var assignments = IntArray(totalPixels)
        val sumsR = LongArray(effectiveK)
        val sumsG = LongArray(effectiveK)
        val sumsB = LongArray(effectiveK)
        val counts = IntArray(effectiveK)

        var totalItersExecuted = 0
        val tLoop0 = System.currentTimeMillis()
        // Fast parallel primitive K-Means main loop
        for (iter in 0 until maxIterations) {
            totalItersExecuted = iter + 1
            val iterPct = 0.10f + (((iter + 1).toFloat() / maxIterations) * 0.45f)
            onProgress?.invoke(iterPct, "Clustering palette colours...")

            val changedFlag = AtomicBoolean(false)

            parallelFor(totalPixels, minChunkSize = 4096) { startIdx, endIdx ->
                var localChanged = false
                for (i in startIdx until endIdx) {
                    val p = pixels[i]
                    val pxR = (p shr 16) and 0xFF
                    val pxG = (p shr 8) and 0xFF
                    val pxB = p and 0xFF

                    var bestDist = Int.MAX_VALUE
                    var bestCluster = 0

                    for (c in 0 until effectiveK) {
                        val cR = centroidR[c]
                        val cG = centroidG[c]
                        val cB = centroidB[c]

                        val dist = if (usePerceptualDistance) {
                            perceptualDistanceSq(pxR, pxG, pxB, cR, cG, cB)
                        } else {
                            val dr = pxR - cR
                            val dg = pxG - cG
                            val db = pxB - cB
                            (dr * dr) + (dg * dg) + (db * db)
                        }

                        if (dist < bestDist) {
                            bestDist = dist
                            bestCluster = c
                        }
                    }

                    if (assignments[i] != bestCluster) {
                        assignments[i] = bestCluster
                        localChanged = true
                    }
                }
                if (localChanged) {
                    changedFlag.set(true)
                }
            }

            if (!changedFlag.get()) break

            sumsR.fill(0L)
            sumsG.fill(0L)
            sumsB.fill(0L)
            counts.fill(0)

            for (i in 0 until totalPixels) {
                val p = pixels[i]
                val cluster = assignments[i]
                sumsR[cluster] += ((p shr 16) and 0xFF).toLong()
                sumsG[cluster] += ((p shr 8) and 0xFF).toLong()
                sumsB[cluster] += (p and 0xFF).toLong()
                counts[cluster]++
            }

            for (c in 0 until effectiveK) {
                val cnt = counts[c]
                if (cnt > 0) {
                    centroidR[c] = (sumsR[c] / cnt).toInt()
                    centroidG[c] = (sumsG[c] / cnt).toInt()
                    centroidB[c] = (sumsB[c] / cnt).toInt()
                }
            }
        }
        val tLoop = System.currentTimeMillis() - tLoop0

        var tSmooth = 0L
        // Fast parallel spatial majority-filter smoothing pass
        if (applySmoothing) {
            val tSmooth0 = System.currentTimeMillis()
            val smoothed = IntArray(totalPixels)

            parallelFor(height, minChunkSize = 8) { startY, endY ->
                val neighborFreq = IntArray(effectiveK)

                for (y in startY until endY) {
                    val yRow = y * width
                    val yMin = maxOf(0, y - 1)
                    val yMax = minOf(height - 1, y + 1)

                    for (x in 0 until width) {
                        val idx = yRow + x
                        neighborFreq.fill(0)

                        val xMin = maxOf(0, x - 1)
                        val xMax = minOf(width - 1, x + 1)

                        for (ny in yMin..yMax) {
                            val nyRow = ny * width
                            for (nx in xMin..xMax) {
                                neighborFreq[assignments[nyRow + nx]]++
                            }
                        }

                        var maxCount = 0
                        var bestCluster = assignments[idx]
                        for (c in 0 until effectiveK) {
                            if (neighborFreq[c] > maxCount) {
                                maxCount = neighborFreq[c]
                                bestCluster = c
                            }
                        }
                        smoothed[idx] = bestCluster
                    }
                }
            }
            assignments = smoothed

            // Recompute final centroids after spatial smoothing
            sumsR.fill(0L)
            sumsG.fill(0L)
            sumsB.fill(0L)
            counts.fill(0)

            for (i in 0 until totalPixels) {
                val p = pixels[i]
                val cluster = assignments[i]
                sumsR[cluster] += ((p shr 16) and 0xFF).toLong()
                sumsG[cluster] += ((p shr 8) and 0xFF).toLong()
                sumsB[cluster] += (p and 0xFF).toLong()
                counts[cluster]++
            }

            for (c in 0 until effectiveK) {
                val cnt = counts[c]
                if (cnt > 0) {
                    centroidR[c] = (sumsR[c] / cnt).toInt()
                    centroidG[c] = (sumsG[c] / cnt).toInt()
                    centroidB[c] = (sumsB[c] / cnt).toInt()
                }
            }
            tSmooth = System.currentTimeMillis() - tSmooth0
        }

        val palette = List(effectiveK) { idx ->
            val rgb = Rgb(centroidR[idx], centroidG[idx], centroidB[idx])
            PaletteColor(
                id = idx + 1,
                color = rgb.toColor(),
                hex = rgb.toHex(),
                isLight = rgb.isLight(),
                argb = rgb.toArgb(),
            )
        }

        val totalElapsed = System.currentTimeMillis() - t0
        CapyLogger.d(
            "CapyEngine",
            "ColorQuantizer.quantize() END -> totalElapsed=${totalElapsed}ms (kMeansInit=${tInit}ms, kMeansLoop=${tLoop}ms [$totalItersExecuted iters], smoothing=${tSmooth}ms), effectiveK=$effectiveK",
        )
        return Pair(palette, assignments)
    }
}
