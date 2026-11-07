package com.capypaint.capy

import androidx.compose.ui.graphics.Color
import com.capypaint.capy.engine.PaletteColor
import com.capypaint.capy.engine.Region
import com.capypaint.capy.model.PaletteSortOrder
import com.capypaint.capy.ui.components.getDisplayNumberMap
import com.capypaint.capy.ui.components.getDockPalette
import com.capypaint.capy.ui.components.getVisiblePalette
import org.junit.Assert.assertEquals
import org.junit.Test

class PaletteOrderingTest {

    private val samplePalette = listOf(
        PaletteColor(id = 1, color = Color.Red, hex = "#FF0000", isLight = false, argb = 0xFFFF0000.toInt()),
        PaletteColor(id = 2, color = Color.Green, hex = "#00FF00", isLight = true, argb = 0xFF00FF00.toInt()),
        PaletteColor(id = 3, color = Color.Blue, hex = "#0000FF", isLight = false, argb = 0xFF0000FF.toInt()),
        PaletteColor(id = 4, color = Color.Yellow, hex = "#FFFF00", isLight = true, argb = 0xFFFFFF00.toInt()),
    )

    private val sampleRegions = listOf(
        Region(id = 10, colorId = 1, centroidX = 10f, centroidY = 10f, area = 100, minX = 0, maxX = 20, minY = 0, maxY = 20),
        Region(id = 20, colorId = 2, centroidX = 50f, centroidY = 50f, area = 200, minX = 40, maxX = 60, minY = 40, maxY = 60),
        Region(id = 30, colorId = 3, centroidX = 100f, centroidY = 100f, area = 300, minX = 90, maxX = 110, minY = 90, maxY = 110),
        Region(id = 40, colorId = 4, centroidX = 200f, centroidY = 200f, area = 400, minX = 190, maxX = 210, minY = 190, maxY = 210),
    )

    @Test
    fun testVisiblePaletteExcludesCompletedColors() {
        val filledRegionIds = setOf(10) // Region 10 (Color 1) is filled
        val base = getVisiblePalette(
            palette = samplePalette,
            regions = sampleRegions,
            filledRegionIds = filledRegionIds,
            sortOrder = PaletteSortOrder.NUMBER,
        )

        // Color 1 should be excluded because all its regions are filled
        assertEquals(3, base.size)
        assertEquals(2, base[0].id)
        assertEquals(3, base[1].id)
        assertEquals(4, base[2].id)
    }

    @Test
    fun testDockPalettePrioritizesOnScreenWithoutRenumbering() {
        // Base palette: [Color 1, Color 2, Color 3, Color 4]
        val base = getVisiblePalette(
            palette = samplePalette,
            regions = sampleRegions,
            filledRegionIds = emptySet(),
            sortOrder = PaletteSortOrder.NUMBER,
        )

        val displayNumberMap = getDisplayNumberMap(
            palette = samplePalette,
            regions = sampleRegions,
            sortOrder = PaletteSortOrder.NUMBER,
        )

        // Panning around: Colors 3 and 4 are visible on screen
        val visibleColorIds = setOf(3, 4)
        val dockPalette = getDockPalette(
            basePalette = base,
            prioritizeOnScreen = true,
            visibleColorIds = visibleColorIds,
        )

        assertEquals(4, dockPalette.size)
        // Onscreen colors 3 and 4 are placed first
        assertEquals(3, dockPalette[0].id)
        assertEquals(4, dockPalette[1].id)
        // Offscreen colors 1 and 2 are listed after
        assertEquals(1, dockPalette[2].id)
        assertEquals(2, dockPalette[3].id)

        // CRITICAL: Display numbers DO NOT change when reordered for dock display!
        assertEquals("3", displayNumberMap[dockPalette[0].id]) // Color 3 retains number "3"
        assertEquals("4", displayNumberMap[dockPalette[1].id]) // Color 4 retains number "4"
        assertEquals("1", displayNumberMap[dockPalette[2].id]) // Color 1 retains number "1"
        assertEquals("2", displayNumberMap[dockPalette[3].id]) // Color 2 retains number "2"
    }

    @Test
    fun testDisplayNumberMapRenumbersWhenSortOrderChanges() {
        // By Number
        val mapByNumber = getDisplayNumberMap(samplePalette, sampleRegions, PaletteSortOrder.NUMBER)
        assertEquals("1", mapByNumber[1])
        assertEquals("2", mapByNumber[2])
        assertEquals("3", mapByNumber[3])
        assertEquals("4", mapByNumber[4])

        // By Hue: Red (1), Yellow (4), Green (2), Blue (3) in HSV hue order
        val mapByHue = getDisplayNumberMap(samplePalette, sampleRegions, PaletteSortOrder.HUE)
        assertEquals("1", mapByHue[1]) // Red (0 deg) -> 1
        assertEquals("2", mapByHue[4]) // Yellow (60 deg) -> 2
        assertEquals("3", mapByHue[2]) // Green (120 deg) -> 3
        assertEquals("4", mapByHue[3]) // Blue (240 deg) -> 4
    }

    @Test
    fun testDisplayNumberMapIsStableWhenRegionsFilled() {
        // Initial map before filling
        val mapBefore = getDisplayNumberMap(samplePalette, sampleRegions, PaletteSortOrder.HUE)

        // Filling a region does NOT change the display numbers assigned to colors
        val filledRegionIds = setOf(10, 20)
        val baseAfterFill = getVisiblePalette(samplePalette, sampleRegions, filledRegionIds, PaletteSortOrder.HUE)
        val mapAfter = getDisplayNumberMap(samplePalette, sampleRegions, PaletteSortOrder.HUE)

        // Color IDs map to identical display numbers before and after filling
        assertEquals(mapBefore, mapAfter)
        assertEquals(2, baseAfterFill.size) // Color 1 and Color 2 completed, remaining 3 and 4
        assertEquals("4", mapAfter[3]) // Color 3 (Blue) retains its "4" label
        assertEquals("2", mapAfter[4]) // Color 4 (Yellow) retains its "2" label
    }
}
