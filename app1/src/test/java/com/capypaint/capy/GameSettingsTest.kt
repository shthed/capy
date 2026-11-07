package com.capypaint.capy

import com.capypaint.capy.model.CanvasBgColor
import com.capypaint.capy.model.Difficulty
import com.capypaint.capy.model.GeneratorPreset
import com.capypaint.capy.model.ImageType
import com.capypaint.capy.model.PaletteDetail
import com.capypaint.capy.model.PaletteSortOrder
import com.capypaint.capy.model.RegionColorMode
import com.capypaint.capy.model.RegionHighlightStyle
import com.capypaint.capy.model.SavedSnapshot
import com.capypaint.capy.model.ThemeMode
import com.capypaint.capy.model.UserSettings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GameSettingsTest {

    @Test
    fun testDefaultSettings() {
        val settings = UserSettings()
        assertTrue(settings.autoAdvance)
        assertEquals(Difficulty.EASY, settings.difficulty)
        assertFalse(settings.isPaintMode)
        assertTrue(settings.showRegionLabels)
        assertTrue(settings.showSavePreviews)
        assertEquals(RegionHighlightStyle.CENTROID_GLOW, settings.highlightStyle)
        assertTrue(settings.highlightMatching)
        assertTrue(settings.animateHint)
        assertEquals(1.0f, settings.labelScale, 0.001f)
        assertEquals(PaletteSortOrder.NUMBER, settings.paletteSort)
        assertEquals(ThemeMode.DARK, settings.themeMode)
        assertTrue(settings.showPreviewLabels)
        assertTrue(settings.showPreviewBorders)
        assertEquals(GeneratorPreset.MEDIUM, settings.generatorConfig.preset)
        assertEquals(PaletteDetail.AUTO, settings.generatorConfig.paletteDetail)
        assertEquals(ImageType.AUTO, settings.generatorConfig.imageType)
    }

    @Test
    fun testGeneratorPresets() {
        val low = GeneratorPreset.LOW
        assertEquals(8, low.colors)
        assertTrue(low.minArea >= 50)

        val medium = GeneratorPreset.MEDIUM
        assertEquals(14, medium.colors)

        val high = GeneratorPreset.HIGH
        assertEquals(100, high.colors)
    }

    @Test
    fun testSavedSnapshotProgressCalculation() {
        val snap = SavedSnapshot(
            title = "Halfway",
            filledCount = 50,
            totalCount = 100,
            filledRegionIds = setOf(1, 2, 3),
        )
        assertEquals(50, snap.progressPercentage)

        val completed = SavedSnapshot(
            title = "Done",
            filledCount = 120,
            totalCount = 120,
            filledRegionIds = emptySet(),
        )
        assertEquals(100, completed.progressPercentage)
    }

    @Test
    fun testDifficultyModes() {
        val normal = Difficulty.NORMAL
        val easy = Difficulty.EASY
        assertNotEquals(normal, easy)
        assertTrue(easy.label.contains("Auto-Select", ignoreCase = true))
    }

    @Test
    fun testPaintModeSetting() {
        val defaultSettings = UserSettings()
        assertFalse(defaultSettings.isPaintMode)

        val paintSettings = defaultSettings.copy(isPaintMode = true)
        assertTrue(paintSettings.isPaintMode)
    }

    @Test
    fun testRegionColorModeSetting() {
        val defaultSettings = UserSettings()
        assertEquals(RegionColorMode.DETAIL, defaultSettings.regionColorMode)

        val solidSettings = defaultSettings.copy(regionColorMode = RegionColorMode.SOLID)
        assertEquals(RegionColorMode.SOLID, solidSettings.regionColorMode)
    }

    @Test
    fun testCanvasBgColorSetting() {
        val defaultSettings = UserSettings()
        assertEquals(CanvasBgColor.BLACK, defaultSettings.canvasBgColor)
        assertEquals(0xFF000000.toInt(), defaultSettings.canvasBgArgb)

        val customArgb = 0xFF3B2F2F.toInt()
        val customSettings = defaultSettings.copy(canvasBgArgb = customArgb, canvasBgColor = CanvasBgColor.fromArgb(customArgb))
        assertEquals(customArgb, customSettings.canvasBgArgb)
    }

    @Test
    fun testDefaultCapySnapshot() {
        val sample = SavedSnapshot(title = "Capybara", filledCount = 0, totalCount = 100, filledRegionIds = emptySet())
        assertEquals("Capybara", sample.title)
    }

    @Test
    fun testFullRegionHighlightStyle() {
        val settings = UserSettings(highlightStyle = RegionHighlightStyle.FULL_REGION)
        assertEquals(RegionHighlightStyle.FULL_REGION, settings.highlightStyle)
        assertEquals("Entire Region Fill", settings.highlightStyle.label)
    }

    @Test
    fun testPreviewAspectRatioCalculation() {
        val maxDim = 300

        // Landscape aspect ratio (1920x1080 -> ~1.777)
        val wLandscape = 1920
        val hLandscape = 1080
        val scaleL = maxDim.toFloat() / maxOf(wLandscape, hLandscape)
        val targetWl = (wLandscape * scaleL).toInt()
        val targetHl = (hLandscape * scaleL).toInt()
        assertEquals(300, targetWl)
        assertEquals(168, targetHl)
        assertEquals(wLandscape.toFloat() / hLandscape, targetWl.toFloat() / targetHl, 0.02f)

        // Portrait aspect ratio (1080x1920 -> ~0.5625)
        val wPortrait = 1080
        val hPortrait = 1920
        val scaleP = maxDim.toFloat() / maxOf(wPortrait, hPortrait)
        val targetWp = (wPortrait * scaleP).toInt()
        val targetHp = (hPortrait * scaleP).toInt()
        assertEquals(168, targetWp)
        assertEquals(300, targetHp)
        assertEquals(wPortrait.toFloat() / hPortrait, targetWp.toFloat() / targetHp, 0.02f)
    }
}
