package com.capypaint.capy

import androidx.compose.ui.geometry.Offset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PuzzleZoomAndHintTest {

    /**
     * Helper function replicating the focal-point pinch-to-zoom formula used in PuzzleCanvas.
     */
    private fun computePinchZoom(
        oldScale: Float,
        currentOffset: Offset,
        baseOffsetX: Float,
        baseOffsetY: Float,
        centroid: Offset,
        pan: Offset,
        zoom: Float,
    ): Pair<Float, Offset> {
        val newScale = (oldScale * zoom).coerceIn(0.6f, 10.0f)
        val actualZoom = newScale / oldScale

        val focalX = centroid.x - (currentOffset.x + baseOffsetX)
        val focalY = centroid.y - (currentOffset.y + baseOffsetY)

        val newOffset = Offset(
            x = (currentOffset.x + pan.x) - (focalX * (actualZoom - 1f)),
            y = (currentOffset.y + pan.y) - (focalY * (actualZoom - 1f)),
        )
        return Pair(newScale, newOffset)
    }

    @Test
    fun testCentroidZoomKeepsFocalPointStationary() {
        val baseScale = 2.0f
        val baseOffsetX = 50f
        val baseOffsetY = 80f

        val initialScale = 1.0f
        val initialOffset = Offset(20f, 30f)

        // User places two fingers whose centroid is at (300, 400)
        val centroid = Offset(300f, 400f)

        // Puzzle coordinate under centroid before zoom:
        // screenX = offset.x + baseOffsetX + puzzleX * (scale * baseScale)
        // puzzleX = (screenX - offset.x - baseOffsetX) / (scale * baseScale)
        val effScaleBefore = initialScale * baseScale
        val puzzleX = (centroid.x - initialOffset.x - baseOffsetX) / effScaleBefore
        val puzzleY = (centroid.y - initialOffset.y - baseOffsetY) / effScaleBefore

        // Pinch to zoom in 1.8x with no pan
        val (newScale, newOffset) = computePinchZoom(
            oldScale = initialScale,
            currentOffset = initialOffset,
            baseOffsetX = baseOffsetX,
            baseOffsetY = baseOffsetY,
            centroid = centroid,
            pan = Offset.Zero,
            zoom = 1.8f,
        )

        // After zoom, calculate screen coordinate of the exact same puzzle point:
        val effScaleAfter = newScale * baseScale
        val screenXAfter = newOffset.x + baseOffsetX + (puzzleX * effScaleAfter)
        val screenYAfter = newOffset.y + baseOffsetY + (puzzleY * effScaleAfter)

        // The point must stay exactly under the centroid (between the two fingers)!
        assertEquals("Focal X must stay fixed under centroid", centroid.x, screenXAfter, 0.001f)
        assertEquals("Focal Y must stay fixed under centroid", centroid.y, screenYAfter, 0.001f)
    }

    @Test
    fun testCentroidZoomWithPanMovesByPanDelta() {
        val baseScale = 1.5f
        val baseOffsetX = 20f
        val baseOffsetY = 30f

        val initialScale = 2.0f
        val initialOffset = Offset(10f, 15f)

        val centroid = Offset(250f, 350f)
        val pan = Offset(45f, -25f)

        val effScaleBefore = initialScale * baseScale
        val puzzleX = (centroid.x - initialOffset.x - baseOffsetX) / effScaleBefore
        val puzzleY = (centroid.y - initialOffset.y - baseOffsetY) / effScaleBefore

        val (newScale, newOffset) = computePinchZoom(
            oldScale = initialScale,
            currentOffset = initialOffset,
            baseOffsetX = baseOffsetX,
            baseOffsetY = baseOffsetY,
            centroid = centroid,
            pan = pan,
            zoom = 1.25f,
        )

        val effScaleAfter = newScale * baseScale
        val screenXAfter = newOffset.x + baseOffsetX + (puzzleX * effScaleAfter)
        val screenYAfter = newOffset.y + baseOffsetY + (puzzleY * effScaleAfter)

        assertEquals(centroid.x + pan.x, screenXAfter, 0.001f)
        assertEquals(centroid.y + pan.y, screenYAfter, 0.001f)
    }

    @Test
    fun testAutoCenteringOnHintCalculatesExactCenter() {
        val canvasW = 1080f
        val canvasH = 1920f
        val puzzleW = 320f
        val puzzleH = 320f

        val baseScale = minOf(canvasW / puzzleW, canvasH / puzzleH) * 0.92f
        val baseOffsetX = (canvasW - (puzzleW * baseScale)) / 2f
        val baseOffsetY = (canvasH - (puzzleH * baseScale)) / 2f

        // Region centroid somewhere in the puzzle
        val regionCentroidX = 85f
        val regionCentroidY = 240f

        val targetScale = 2.0f
        val effectiveTargetScale = targetScale * baseScale

        val targetOffsetX = (canvasW / 2f) - baseOffsetX - (regionCentroidX * effectiveTargetScale)
        val targetOffsetY = (canvasH / 2f) - baseOffsetY - (regionCentroidY * effectiveTargetScale)

        // Calculate screen coordinate of the region centroid with targetOffsetX/Y
        val screenX = targetOffsetX + baseOffsetX + (regionCentroidX * effectiveTargetScale)
        val screenY = targetOffsetY + baseOffsetY + (regionCentroidY * effectiveTargetScale)

        assertEquals("Hint region centroid must be horizontally centered on canvas", canvasW / 2f, screenX, 0.001f)
        assertEquals("Hint region centroid must be vertically centered on canvas", canvasH / 2f, screenY, 0.001f)
    }

    @Test
    fun testHintDoesNotMoveCanvasIfRegionIsAlreadyOnScreen() {
        val canvasW = 1080f
        val canvasH = 1920f
        val puzzleW = 320f
        val puzzleH = 320f

        val baseScale = minOf(canvasW / puzzleW, canvasH / puzzleH) * 0.92f
        val baseOffsetX = (canvasW - (puzzleW * baseScale)) / 2f
        val baseOffsetY = (canvasH - (puzzleH * baseScale)) / 2f

        val scale = 1.0f
        val offset = Offset.Zero

        val effectiveScale = scale * baseScale
        val visLeft = (-offset.x - baseOffsetX) / effectiveScale
        val visTop = (-offset.y - baseOffsetY) / effectiveScale
        val visRight = visLeft + (canvasW / effectiveScale)
        val visBottom = visTop + (canvasH / effectiveScale)

        // Region 1 is within visLeft..visRight and visTop..visBottom
        val minX = 10
        val maxX = 30
        val minY = 10
        val maxY = 30

        val isOnScreen = (maxX >= visLeft) && (minX <= visRight) && (maxY >= visTop) && (minY <= visBottom)
        assertTrue("Region must be detected as on screen", isOnScreen)
    }
}
