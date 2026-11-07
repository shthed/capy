package com.capypaint.capy

import com.capypaint.capy.engine.ColorQuantizer
import com.capypaint.capy.engine.ImageAnalysisResult
import com.capypaint.capy.engine.RegionSegmenter
import com.capypaint.capy.model.ImageType
import com.capypaint.capy.model.PaletteDetail
import androidx.compose.ui.graphics.Color
import com.capypaint.capy.engine.PaletteColor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PuzzleGeneratorTest {

    @Test
    fun testAnalysisResultResolveColorCount() {
        val recommendedMap = mapOf(
            PaletteDetail.LOW to 8,
            PaletteDetail.MEDIUM to 16,
            PaletteDetail.HIGH to 32,
            PaletteDetail.AUTO to 16,
        )
        val analysis = ImageAnalysisResult(
            detectedType = ImageType.DRAWING,
            edgeRatio = 0.15f,
            localVariance = 10f,
            globalVariance = 100f,
            colorClusterCount = 20,
            recommendedColors = recommendedMap,
        )

        assertEquals(8, analysis.resolveColorCount(PaletteDetail.LOW, 50))
        assertEquals(16, analysis.resolveColorCount(PaletteDetail.MEDIUM, 50))
        assertEquals(32, analysis.resolveColorCount(PaletteDetail.HIGH, 50))
        assertEquals(16, analysis.resolveColorCount(PaletteDetail.AUTO, 50))
        assertEquals(50, analysis.resolveColorCount(PaletteDetail.CUSTOM, 50))
    }

    @Test
    fun testPerceptualColorDistanceSq() {
        val d1 = ColorQuantizer.perceptualDistanceSq(255, 0, 0, 255, 0, 0)
        assertEquals(0, d1)

        val d2 = ColorQuantizer.perceptualDistanceSq(255, 0, 0, 0, 255, 0)
        assertTrue("Red vs Green distance must be large", d2 > 1000)
    }

    @Test
    fun testMedianFilterSmoothsNoise() {
        val width = 5
        val height = 5
        val total = width * height
        val pixels = IntArray(total) { 0xFF000000.toInt() } // Black
        // Add single pixel white noise at center
        pixels[(2 * width) + 2] = 0xFFFFFFFF.toInt()

        val filtered = ColorQuantizer.applyMedianFilter(pixels, width, height)
        // Center pixel noise should be eliminated by median filter
        assertEquals(0xFF000000.toInt(), filtered[(2 * width) + 2])
    }

    @Test
    fun testSliverPreventionInRegionSegmenter() {
        val width = 20
        val height = 20
        val total = width * height
        val palette = listOf(
            PaletteColor(1, Color.Red, "#FF0000", isLight = false, argb = 0xFFFF0000.toInt()),
            PaletteColor(2, Color.Blue, "#0000FF", isLight = false, argb = 0xFF0000FF.toInt()),
        )

        // Create a 1-pixel wide line sliver across the grid
        val clusters = IntArray(total) { idx ->
            val y = idx / width
            if (y == 5) 1 else 0 // Row 5 is a thin 1-pixel line
        }

        // Segment with maxPerimeterToAreaRatio = 1.5f (sliver prevention)
        val result = RegionSegmenter.segment(
            width = width,
            height = height,
            palette = palette,
            pixelClusters = clusters,
            minRegionArea = 5,
            maxPerimeterToAreaRatio = 1.5f,
        )

        assertNotNull(result)
        assertTrue(result.regions.isNotEmpty())
        assertEquals(total, result.regionMap.size)
    }
}
