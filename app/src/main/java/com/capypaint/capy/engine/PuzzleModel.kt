package com.capypaint.capy.engine

import androidx.compose.ui.graphics.Color

data class PaletteColor(
    val id: Int,
    val color: Color,
    val hex: String,
    val isLight: Boolean,
    val argb: Int = 0,
)

data class Region(
    val id: Int,
    val colorId: Int,
    val centroidX: Float,
    val centroidY: Float,
    val area: Int,
    val minX: Int = 0,
    val maxX: Int = 0,
    val minY: Int = 0,
    val maxY: Int = 0,
    val maxRadius: Float = 0f,
    val pixels: IntArray = intArrayOf(),
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false
        other as Region
        return id == other.id
    }

    override fun hashCode(): Int = id
}

data class PuzzleData(
    val width: Int,
    val height: Int,
    val palette: List<PaletteColor>,
    val regions: List<Region>,
    val regionMap: IntArray,
    val borderMap: BooleanArray,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false
        other as PuzzleData
        return (width == other.width) &&
                (height == other.height) &&
                (palette == other.palette) &&
                (regions == other.regions) &&
                regionMap.contentEquals(other.regionMap) &&
                borderMap.contentEquals(other.borderMap)
    }

    override fun hashCode(): Int {
        var result = width
        result = (31 * result) + height
        result = (31 * result) + palette.hashCode()
        result = (31 * result) + regions.hashCode()
        result = (31 * result) + regionMap.contentHashCode()
        result = (31 * result) + borderMap.contentHashCode()
        return result
    }
}
