package com.capypaint.capy.engine

import com.capypaint.capy.util.CapyLogger
import kotlin.math.roundToInt
import kotlin.math.sqrt

data class SegmentationResult(
    val regions: List<Region>,
    val regionMap: IntArray,
    val borderMap: BooleanArray,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false
        other as SegmentationResult
        return (regions == other.regions) &&
                regionMap.contentEquals(other.regionMap) &&
                borderMap.contentEquals(other.borderMap)
    }

    override fun hashCode(): Int {
        var result = regions.hashCode()
        result = (31 * result) + regionMap.contentHashCode()
        result = (31 * result) + borderMap.contentHashCode()
        return result
    }
}

object RegionSegmenter {

    private class TempRegion(
        val id: Int,
        var clusterId: Int,
        val pixels: IntArrayList,
    )

    // Primitive int array list with fast doubling
    private class IntArrayList(initialCapacity: Int = 128) {
        var data = IntArray(initialCapacity)
        var size = 0

        fun add(value: Int) {
            if (size == data.size) {
                data = data.copyOf(data.size shl 1)
            }
            data[size++] = value
        }

        fun toIntArray(): IntArray = data.copyOf(size)
    }

    fun segment(
        width: Int,
        height: Int,
        palette: List<PaletteColor>,
        pixelClusters: IntArray,
        minRegionArea: Int = 30,
        maxMergePasses: Int = 6,
        maxPerimeterToAreaRatio: Float = 1.8f,
        onProgress: ((Float, String) -> Unit)? = null,
    ): SegmentationResult {
        val t0 = System.currentTimeMillis()
        val total = width * height
        CapyLogger.d(
            "CapyEngine",
            "RegionSegmenter.segment() START -> dimensions=${width}x$height, minRegionArea=$minRegionArea, maxMergePasses=$maxMergePasses",
        )
        val currentClusters = pixelClusters.copyOf()
        val paletteSize = palette.size

        val queueBuffer = IntArray(total)

        val tFlood0 = System.currentTimeMillis()
        var (finalRegions, finalRegionMap) = floodFill(width, height, currentClusters, queueBuffer)
        val tFlood = System.currentTimeMillis() - tFlood0
        CapyLogger.d(
            "CapyEngine",
            "RegionSegmenter: Initial flood fill generated ${finalRegions.size} raw regions in ${tFlood}ms",
        )

        val tMerge0 = System.currentTimeMillis()
        var actualMergePasses = 0
        for (pass in 0 until maxMergePasses) {
            actualMergePasses = pass + 1
            val passPct = 0.60f + (((pass + 1).toFloat() / maxMergePasses) * 0.30f)
            onProgress?.invoke(passPct, "Merging small regions...")
            val (regions, regionMap) = floodFill(width, height, currentClusters, queueBuffer)

            // Compute perimeter for each region to catch thin/spindly sliver regions
            val perimeters = IntArray(regions.size)
            if (maxPerimeterToAreaRatio > 0f) {
                for (idx in 0 until total) {
                    val rId = regionMap[idx]
                    if ((rId < 0) || (rId >= regions.size)) continue
                    val px = idx % width
                    val py = idx / width
                    var edges = 0
                    if ((px == 0) || (regionMap[idx - 1] != rId)) edges++
                    if ((px == (width - 1)) || (regionMap[idx + 1] != rId)) edges++
                    if ((py == 0) || (regionMap[idx - width] != rId)) edges++
                    if ((py == (height - 1)) || (regionMap[idx + width] != rId)) edges++
                    perimeters[rId] += edges
                }
            }

            val smallRegions = regions.filter { reg ->
                val p = perimeters.getOrElse(reg.id) { 0 }
                val isSliver = (maxPerimeterToAreaRatio > 0f) && (reg.pixels.size > 0) &&
                        ((p.toFloat() / reg.pixels.size) >= maxPerimeterToAreaRatio)
                (reg.pixels.size < minRegionArea) || isSliver
            }

            if (smallRegions.isEmpty()) {
                break
            }

            var mergedCount = 0
            val neighborClusterCounts = IntArray(paletteSize)

            for (small in smallRegions) {
                neighborClusterCounts.fill(0)
                val currCluster = small.clusterId

                val count = small.pixels.size
                val pixelData = small.pixels.data
                for (i in 0 until count) {
                    val idx = pixelData[i]
                    val px = idx % width
                    val py = idx / width

                    if (px > 0) {
                        val c = currentClusters[idx - 1]
                        if ((c != currCluster) && (c in (0 until paletteSize))) neighborClusterCounts[c]++
                    }
                    if (px < (width - 1)) {
                        val c = currentClusters[idx + 1]
                        if ((c != currCluster) && (c in (0 until paletteSize))) neighborClusterCounts[c]++
                    }
                    if (py > 0) {
                        val c = currentClusters[idx - width]
                        if ((c != currCluster) && (c in (0 until paletteSize))) neighborClusterCounts[c]++
                    }
                    if (py < (height - 1)) {
                        val c = currentClusters[idx + width]
                        if ((c != currCluster) && (c in (0 until paletteSize))) neighborClusterCounts[c]++
                    }
                }

                var bestCluster = -1
                var maxContact = 0
                for (c in 0 until paletteSize) {
                    if (neighborClusterCounts[c] > maxContact) {
                        maxContact = neighborClusterCounts[c]
                        bestCluster = c
                    }
                }

                if (bestCluster >= 0) {
                    for (i in 0 until count) {
                        currentClusters[pixelData[i]] = bestCluster
                    }
                    mergedCount++
                }
            }

            if (mergedCount == 0) break
        }

        // Final pass to ensure connected components are clean
        val (cleanRegions, cleanRegionMap) = floodFill(width, height, currentClusters, queueBuffer)
        finalRegions = cleanRegions
        finalRegionMap = cleanRegionMap

        // Merge any remaining tiny isolated regions into adjacent region
        val remainingSmall = finalRegions.filter { it.pixels.size < minRegionArea }
        if (remainingSmall.isNotEmpty() && (finalRegions.size > 1)) {
            val maxRegionId = finalRegions.maxOfOrNull { it.id } ?: 0
            val contactCounts = IntArray(maxRegionId + 1)

            for (small in remainingSmall) {
                contactCounts.fill(0)
                val count = small.pixels.size
                val pixelData = small.pixels.data
                for (i in 0 until count) {
                    val idx = pixelData[i]
                    val px = idx % width
                    val py = idx / width

                    if (px > 0) {
                        val r = finalRegionMap[idx - 1]
                        if ((r != small.id) && (r in (0..maxRegionId))) contactCounts[r]++
                    }
                    if (px < (width - 1)) {
                        val r = finalRegionMap[idx + 1]
                        if ((r != small.id) && (r in (0..maxRegionId))) contactCounts[r]++
                    }
                    if (py > 0) {
                        val r = finalRegionMap[idx - width]
                        if ((r != small.id) && (r in (0..maxRegionId))) contactCounts[r]++
                    }
                    if (py < (height - 1)) {
                        val r = finalRegionMap[idx + width]
                        if ((r != small.id) && (r in (0..maxRegionId))) contactCounts[r]++
                    }
                }

                var bestNeighborRegionId = -1
                var maxContact = 0
                for (r in 0..maxRegionId) {
                    if (contactCounts[r] > maxContact) {
                        maxContact = contactCounts[r]
                        bestNeighborRegionId = r
                    }
                }

                if (bestNeighborRegionId >= 0) {
                    val targetRegion = finalRegions.find { it.id == bestNeighborRegionId }
                    if (targetRegion != null) {
                        for (i in 0 until count) {
                            val idx = pixelData[i]
                            finalRegionMap[idx] = targetRegion.id
                            targetRegion.pixels.add(idx)
                        }
                    }
                }
            }
            finalRegions = finalRegions.filter { it.pixels.size >= minRegionArea }
        }
        val tMerge = System.currentTimeMillis() - tMerge0
        CapyLogger.d(
            "CapyEngine",
            "RegionSegmenter: Merge passes ($actualMergePasses passes) reduced regions to ${finalRegions.size} in ${tMerge}ms",
        )

        val tBorder0 = System.currentTimeMillis()
        // Build borderMap with clean 1-pixel hairline borders
        val borderMap = BooleanArray(total)
        for (y in 0 until height) {
            val yRow = y * width
            val isFirstRow = (y == 0)
            val isLastRow = (y == (height - 1))
            for (x in 0 until width) {
                val idx = yRow + x
                val rid = finalRegionMap[idx]

                val isBorder = (x == 0) || (x == (width - 1)) || isFirstRow || isLastRow ||
                        ((x < (width - 1)) && (finalRegionMap[idx + 1] != rid)) ||
                        ((y < (height - 1)) && (finalRegionMap[idx + width] != rid))

                borderMap[idx] = isBorder
            }
        }
        val tBorder = System.currentTimeMillis() - tBorder0
        CapyLogger.d("CapyEngine", "RegionSegmenter: Border map generation took ${tBorder}ms")

        val tCentroid0 = System.currentTimeMillis()
        // Convert to final Region models with guaranteed interior centroid
        val regions = finalRegions.mapIndexed { index, temp ->
            val regionId = index + 1
            val count = temp.pixels.size
            val pixelData = temp.pixels.data

            var sumX = 0L
            var sumY = 0L
            var minX = Int.MAX_VALUE
            var maxX = Int.MIN_VALUE
            var minY = Int.MAX_VALUE
            var maxY = Int.MIN_VALUE

            for (i in 0 until count) {
                val idx = pixelData[i]
                finalRegionMap[idx] = regionId // Remap to 1-based sequential ID

                val px = idx % width
                val py = idx / width

                sumX += px
                sumY += py
                if (px < minX) minX = px
                if (px > maxX) maxX = px
                if (py < minY) minY = py
                if (py > maxY) maxY = py
            }

            // Calculate Pole of Inaccessibility (Maximum Interior Clearance Centroid)
            val bestPx: Int
            val bestPy: Int
            val maxDistance: Float

            if (count == 1) {
                bestPx = pixelData[0] % width
                bestPy = pixelData[0] / width
                maxDistance = 0.5f
            } else if (count <= 9) {
                val avgX = (sumX.toDouble() / count).toFloat()
                val avgY = (sumY.toDouble() / count).toFloat()
                val testX = avgX.roundToInt().coerceIn(0, width - 1)
                val testY = avgY.roundToInt().coerceIn(0, height - 1)
                if (finalRegionMap[(testY * width) + testX] == regionId) {
                    bestPx = testX
                    bestPy = testY
                } else {
                    bestPx = pixelData[0] % width
                    bestPy = pixelData[0] / width
                }
                maxDistance = sqrt(count.toFloat()) * 0.5f
            } else {
                val distArray = IntArray(count) { -1 }
                val queue = IntArray(count)
                var head = 0
                var tail = 0

                // Enqueue boundary pixels (adjacent to a non-region pixel or image border)
                for (i in 0 until count) {
                    val idx = pixelData[i]
                    val px = idx % width
                    val py = idx / width

                    val isBoundary = (px == 0) || (px == (width - 1)) || (py == 0) || (py == (height - 1)) ||
                        borderMap[idx] ||
                        (finalRegionMap[idx - 1] != regionId) ||
                        (finalRegionMap[idx + 1] != regionId) ||
                        (finalRegionMap[idx - width] != regionId) ||
                        (finalRegionMap[idx + width] != regionId)

                    if (isBoundary) {
                        distArray[i] = 1
                        queue[tail++] = i
                    }
                }

                val idxToPos = HashMap<Int, Int>(count * 2)
                for (i in 0 until count) {
                    idxToPos[pixelData[i]] = i
                }

                var maxDist = 1
                var maxPos = if (tail > 0) queue[0] else 0

                while (head < tail) {
                    val pos = queue[head++]
                    val d = distArray[pos]
                    val idx = pixelData[pos]
                    val px = idx % width
                    val py = idx / width

                    val n1 = idxToPos[idx - 1]
                    if ((px > 0) && (n1 != null) && (distArray[n1] == -1)) {
                        distArray[n1] = d + 1
                        queue[tail++] = n1
                        if ((d + 1) > maxDist) { maxDist = d + 1; maxPos = n1 }
                    }
                    val n2 = idxToPos[idx + 1]
                    if ((px < (width - 1)) && (n2 != null) && (distArray[n2] == -1)) {
                        distArray[n2] = d + 1
                        queue[tail++] = n2
                        if ((d + 1) > maxDist) { maxDist = d + 1; maxPos = n2 }
                    }
                    val n3 = idxToPos[idx - width]
                    if ((py > 0) && (n3 != null) && (distArray[n3] == -1)) {
                        distArray[n3] = d + 1
                        queue[tail++] = n3
                        if ((d + 1) > maxDist) { maxDist = d + 1; maxPos = n3 }
                    }
                    val n4 = idxToPos[idx + width]
                    if ((py < (height - 1)) && (n4 != null) && (distArray[n4] == -1)) {
                        distArray[n4] = d + 1
                        queue[tail++] = n4
                        if ((d + 1) > maxDist) { maxDist = d + 1; maxPos = n4 }
                    }
                }

                bestPx = pixelData[maxPos] % width
                bestPy = pixelData[maxPos] / width
                maxDistance = maxDist.toFloat()
            }

            Region(
                id = regionId,
                colorId = temp.clusterId + 1,
                centroidX = bestPx + 0.5f,
                centroidY = bestPy + 0.5f,
                area = count,
                minX = minX,
                maxX = maxX,
                minY = minY,
                maxY = maxY,
                maxRadius = maxDistance,
                pixels = temp.pixels.toIntArray(),
            )
        }
        val tCentroid = System.currentTimeMillis() - tCentroid0
        val totalElapsed = System.currentTimeMillis() - t0

        CapyLogger.d(
            "CapyEngine",
            "RegionSegmenter.segment() FINISHED -> generated ${regions.size} vector regions in ${totalElapsed}ms (floodFill=${tFlood}ms, merge=${tMerge}ms [$actualMergePasses passes], borders=${tBorder}ms, centroids=${tCentroid}ms)",
        )

        return SegmentationResult(
            regions = regions,
            regionMap = finalRegionMap,
            borderMap = borderMap,
        )
    }

    private fun floodFill(
        width: Int,
        height: Int,
        clusters: IntArray,
        queueBuffer: IntArray,
    ): Pair<List<TempRegion>, IntArray> {
        val total = width * height
        val regionMap = IntArray(total) { -1 }
        val regions = mutableListOf<TempRegion>()
        var regionCounter = 0

        for (y in 0 until height) {
            val yRow = y * width
            for (x in 0 until width) {
                val startIdx = yRow + x
                if (regionMap[startIdx] != -1) continue

                val targetCluster = clusters[startIdx]
                val regionPixels = IntArrayList()
                val currentRegionId = regionCounter++

                regionMap[startIdx] = currentRegionId

                var head = 0
                var tail = 0
                queueBuffer[tail++] = startIdx

                while (head < tail) {
                    val curr = queueBuffer[head++]
                    regionPixels.add(curr)

                    val cx = curr % width
                    val cy = curr / width

                    if (cx > 0) {
                        val n = curr - 1
                        if ((regionMap[n] == -1) && (clusters[n] == targetCluster)) {
                            regionMap[n] = currentRegionId
                            queueBuffer[tail++] = n
                        }
                    }
                    if (cx < (width - 1)) {
                        val n = curr + 1
                        if ((regionMap[n] == -1) && (clusters[n] == targetCluster)) {
                            regionMap[n] = currentRegionId
                            queueBuffer[tail++] = n
                        }
                    }
                    if (cy > 0) {
                        val n = curr - width
                        if ((regionMap[n] == -1) && (clusters[n] == targetCluster)) {
                            regionMap[n] = currentRegionId
                            queueBuffer[tail++] = n
                        }
                    }
                    if (cy < (height - 1)) {
                        val n = curr + width
                        if ((regionMap[n] == -1) && (clusters[n] == targetCluster)) {
                            regionMap[n] = currentRegionId
                            queueBuffer[tail++] = n
                        }
                    }
                }

                regions.add(TempRegion(currentRegionId, targetCluster, regionPixels))
            }
        }

        return Pair(regions, regionMap)
    }
}
