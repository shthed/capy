package com.capypaint.capy.model

import java.util.UUID
import kotlin.math.abs

enum class Difficulty(val label: String, @Suppress("unused") val description: String) {
    NORMAL("Precise (Standard)", "Only fills when the tapped region matches the active colour"),
    EASY("Auto-Select Colour", "Tapping any region selects its colour and fills it immediately"),
}

enum class PaletteSortOrder(val label: String) {
    NUMBER("By Number (1, 2, 3...)"),
    REMAINING("Remaining Regions (Most left first)"),
    HUE("Rainbow Spectrum (Hue)"),
    LIGHTNESS("Lightness (Dark to Light)"),
}

enum class ThemeMode(val label: String) {
    DARK("Dark Canvas"),
    LIGHT("Light Clean"),
    COLORFUL("Vibrant Modern"),
}

enum class ImageType(val label: String, val description: String) {
    AUTO("Auto Detect", "Analyze image to choose best strategy"),
    DRAWING("Drawing / Line Art", "Optimized for clean edges and flat colors"),
    PHOTO("Photo / Realistic", "Optimized for smooth gradients and natural scenes"),
}

enum class PaletteDetail(val label: String, val description: String) {
    AUTO("Auto Recommended", "Optimal colours determined by image analysis"),
    LOW("Low Detail", "Fewer, larger regions (~8-12 colours)"),
    MEDIUM("Medium Detail", "Balanced regions and palette (~14-24 colours)"),
    HIGH("High Detail", "Rich, detailed artwork (~30-50 colours)"),
    CUSTOM("Custom", "Fine-tune sliders manually"),
}

data class SampleArtwork(
    val id: String,
    val title: String,
    val assetPath: String,
    val category: String = "Samples",
)

object SampleGallery {
    val samples = listOf(
        SampleArtwork("capybara_sample", "Capybara", "capybara.webp", "Animals"),
        SampleArtwork("capy_forest", "Capy Forest", "capy_forest.webp", "Nature"),
        SampleArtwork("snail_guitar", "Snail Guitar", "snail_guitar.webp", "Music"),
        SampleArtwork("mushrooms", "Mushroom Forest", "mushrooms.webp", "Coloring"),
    )
}

enum class MinRegionOption(@Suppress("unused") val label: String, @Suppress("unused") val scaleFactor: Float) {
    SMALL("Small", 0.0001f),
    MEDIUM("Medium", 0.00035f),
    LARGE("Large", 0.0008f),
    EXTRA_LARGE("Extra Large", 0.0016f);

    fun calculateArea(resolution: Int): Int {
        val baseResolution = 320f
        val scale = (resolution.toFloat() / baseResolution)
        val areaRatio = scale * scale
        val basePixels = when (this) {
            SMALL -> 15
            MEDIUM -> 35
            LARGE -> 80
            EXTRA_LARGE -> 160
        }
        return (basePixels * areaRatio).toInt().coerceAtLeast(10)
    }

    companion object {
        fun fromArea(area: Int, resolution: Int): MinRegionOption {
            return entries.minByOrNull { abs(it.calculateArea(resolution) - area) } ?: MEDIUM
        }
    }
}

enum class GeneratorPreset(
    @Suppress("unused") val label: String,
    @Suppress("unused") val description: String,
    val colors: Int,
    val minArea: Int,
    val resolution: Int,
) {
    LOW("Low Detail", "Fewer, larger regions (~8 colours)", 8, 80, 640),
    MEDIUM("Medium Detail", "Balanced regions and palette (~14 colours)", 14, 35, 1280),
    HIGH("High Detail", "Rich nuanced artwork (~100 colours)", 100, 128, 2048),
    CUSTOM("Custom", "Fine-tune sliders manually", 100, 128, 2048),
}

data class GeneratorConfig(
    val preset: GeneratorPreset = GeneratorPreset.MEDIUM,
    val paletteDetail: PaletteDetail = PaletteDetail.AUTO,
    val imageType: ImageType = ImageType.AUTO,
    val colorCount: Int = 16,
    val minRegionArea: Int = 35,
    val resolution: Int = 2048,
    val smoothingPasses: Int = 1,
)

enum class RegionColorMode(val label: String, @Suppress("unused") val description: String) {
    DETAIL("Original Detail", "Full original image detail fills"),
    SOLID("Solid Fill", "Flat palette colour fills"),
}

enum class CanvasBgColor(@Suppress("unused") val label: String, val argb: Int) {
    BLACK("Deep Black", 0xFF000000.toInt()),
    DARK_SLATE("Dark Slate", 0xFF0F172A.toInt()),
    CHARCOAL("Charcoal", 0xFF18181B.toInt()),
    LIGHT_GRAY("Light Gray", 0xFFE2E8F0.toInt()),
    PURE_WHITE("Pure White", 0xFFFFFFFF.toInt());

    companion object {
        fun fromArgb(argb: Int): CanvasBgColor {
            return entries.find { it.argb == argb } ?: BLACK
        }
    }
}

enum class SaveSortOrder(val label: String) {
    LAST_ACTIVE("Last Active"),
    DATE("Date Created"),
    PERCENT_COMPLETE("Completion"),
}

enum class RegionHighlightStyle(val label: String, @Suppress("unused") val description: String) {
    CENTROID_GLOW("Centroid Glow", "Pulsing amber circle at region center"),
    NUMBER_ONLY("Number Badge", "Glowing badge container behind number label"),
    FULL_REGION("Entire Region Fill", "Highlights all pixels of matching regions without circles"),
    BOUNDARY_ONLY("Boundary Outline", "Glowing perimeter line along region boundary"),
}

enum class HintFillStyle(val label: String, @Suppress("unused") val description: String) {
    SOLID("Solid", "Uniform translucent colour tint across entire region"),
    CHECKER("Checker", "Alternating checker pattern overlay across region"),
    STRIPES("Diagonal", "Alternating diagonal stripe pattern across region"),
}

data class UserSettings(
    val autoAdvance: Boolean = true,
    val difficulty: Difficulty = Difficulty.EASY,
    val isPaintMode: Boolean = false,
    val raisePaletteDock: Boolean = true,
    val regionColorMode: RegionColorMode = RegionColorMode.DETAIL,
    val canvasBgColor: CanvasBgColor = CanvasBgColor.BLACK,
    val canvasBgArgb: Int = 0xFF000000.toInt(),
    val saveSortOrder: SaveSortOrder = SaveSortOrder.LAST_ACTIVE,
    val showSavePreviews: Boolean = true,
    val highlightStyle: RegionHighlightStyle = RegionHighlightStyle.CENTROID_GLOW,
    val hintFillStyle: HintFillStyle = HintFillStyle.CHECKER,
    val hintColorArgb: Int = 0xFFFBBF24.toInt(),
    val showRegionLabels: Boolean = true,
    val showPreviewLabels: Boolean = true,
    val showPreviewBorders: Boolean = true,
    val highlightMatching: Boolean = true,
    val animateHint: Boolean = true,
    val showNextRegionHint: Boolean = true,
    val hintIntensity: Float = 0.65f,
    val labelScale: Float = 1.0f,
    val showZoomButtons: Boolean = false,
    val paletteSort: PaletteSortOrder = PaletteSortOrder.NUMBER,
    val prioritizeOnScreen: Boolean = true,
    val themeMode: ThemeMode = ThemeMode.DARK,
    val generatorConfig: GeneratorConfig = GeneratorConfig(),
)

data class SavedSnapshot(
    val id: String = UUID.randomUUID().toString(),
    val title: String,
    val timestamp: Long = System.currentTimeMillis(),
    val lastOpened: Long = System.currentTimeMillis(),
    val filledCount: Int,
    val totalCount: Int,
    val filledRegionIds: Set<Int>,
    val isAutoSample: Boolean = false,
    val sampleAssetPath: String? = null,
    val zoomScale: Float = 1.0f,
    val panOffsetX: Float = 0.0f,
    val panOffsetY: Float = 0.0f,
) {
    val progressPercentage: Int
        get() = if (totalCount > 0) (filledCount * 100) / totalCount else 0
}
