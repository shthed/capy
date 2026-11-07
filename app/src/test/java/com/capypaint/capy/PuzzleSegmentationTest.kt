package com.capypaint.capy

import com.capypaint.capy.engine.PaletteColor
import com.capypaint.capy.engine.RegionSegmenter
import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PuzzleSegmentationTest {

    @Test
    fun testSegmentationCoversEveryPixel() {
        val width = 40
        val height = 40
        val total = width * height

        // 3 dummy colors
        val palette = listOf(
            PaletteColor(1, Color.Red, "#FF0000", isLight = false, argb = 0xFFFF0000.toInt()),
            PaletteColor(2, Color.Green, "#00FF00", isLight = true, argb = 0xFF00FF00.toInt()),
            PaletteColor(3, Color.Blue, "#0000FF", isLight = false, argb = 0xFF0000FF.toInt()),
        )

        // Create an artificial grid with some large areas and small noise spots
        val clusters = IntArray(total) { idx ->
            val x = idx % width
            val y = idx / width
            when {
                // Add a 2-pixel tiny noise island
                (x == 5) && (y == 5) -> 2
                (x < 20) && (y < 20) -> 0
                (x >= 20) && (y < 20) -> 1
                else -> 2
            }
        }

        val result = RegionSegmenter.segment(
            width = width,
            height = height,
            palette = palette,
            pixelClusters = clusters,
            minRegionArea = 10,
        )

        // 1. Check all pixels belong to a valid region (> 0)
        for (i in 0 until total) {
            assertTrue("Pixel $i must belong to a valid region > 0", result.regionMap[i] > 0)
        }

        // 2. Sum of region areas must equal total pixels (100% coverage, no holes)
        val totalArea = result.regions.sumOf { it.area }
        assertEquals("Total region area must equal total pixels", total, totalArea)

        // 3. Every region centroid must be within bounds and inside the region
        for (region in result.regions) {
            assertTrue((region.centroidX >= 0f) && (region.centroidX <= width))
            assertTrue((region.centroidY >= 0f) && (region.centroidY <= height))
            val px = region.centroidX.toInt().coerceIn(0, width - 1)
            val py = region.centroidY.toInt().coerceIn(0, height - 1)
            assertEquals("Centroid must be inside the region", region.id, result.regionMap[(py * width) + px])
        }

        // 4. Border map must have borders around region transitions
        assertTrue("Border map must contain borders", result.borderMap.any { it })
    }
}
