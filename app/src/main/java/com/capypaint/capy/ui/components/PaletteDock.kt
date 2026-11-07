package com.capypaint.capy.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.capypaint.capy.engine.PaletteColor
import com.capypaint.capy.engine.Region
import com.capypaint.capy.model.PaletteSortOrder
import com.capypaint.capy.util.CapyLogger
import java.util.Locale

fun getDisplayNumberMap(
    palette: List<PaletteColor>,
    regions: List<Region>,
    sortOrder: PaletteSortOrder = PaletteSortOrder.NUMBER,
): Map<Int, String> {
    val sortedFull = when (sortOrder) {
        PaletteSortOrder.NUMBER -> palette.sortedBy { it.id }
        PaletteSortOrder.REMAINING -> palette.sortedByDescending { color ->
            regions.count { r -> r.colorId == color.id }
        }
        PaletteSortOrder.HUE -> palette.sortedBy { getHue(it.argb) }
        PaletteSortOrder.LIGHTNESS -> palette.sortedBy { if (it.isLight) 1 else 0 }
    }
    return sortedFull.mapIndexed { index, color ->
        color.id to (index + 1).toString()
    }.toMap()
}

fun getVisiblePalette(
    palette: List<PaletteColor>,
    regions: List<Region>,
    filledRegionIds: Set<Int>,
    sortOrder: PaletteSortOrder = PaletteSortOrder.NUMBER,
): List<PaletteColor> {
    val uncompleted = palette.filter { color ->
        regions.any { r -> (r.colorId == color.id) && (r.id !in filledRegionIds) }
    }
    return when (sortOrder) {
        PaletteSortOrder.NUMBER -> uncompleted.sortedBy { it.id }
        PaletteSortOrder.REMAINING -> uncompleted.sortedByDescending { color ->
            regions.count { r -> r.colorId == color.id }
        }
        PaletteSortOrder.HUE -> uncompleted.sortedBy { getHue(it.argb) }
        PaletteSortOrder.LIGHTNESS -> uncompleted.sortedBy { if (it.isLight) 1 else 0 }
    }
}

fun getDockPalette(
    basePalette: List<PaletteColor>,
    prioritizeOnScreen: Boolean = false,
    visibleColorIds: Set<Int> = emptySet(),
): List<PaletteColor> {
    if (!prioritizeOnScreen || visibleColorIds.isEmpty()) return basePalette
    val start = System.nanoTime()
    val sorted = basePalette.sortedWith(
        compareByDescending { it.id in visibleColorIds },
    )
    val elapsedMs = (System.nanoTime() - start) / 1_000_000.0
    val onScreenCount = sorted.count { it.id in visibleColorIds }
    CapyLogger.d(
        "CapyPerf",
        "getDockPalette() reordered swatches -> elapsed=${String.format(Locale.US, "%.3f", elapsedMs)}ms, baseSize=${basePalette.size}, visColorIdsCount=${visibleColorIds.size}, onScreenCount=$onScreenCount, offScreenCount=${sorted.size - onScreenCount}",
    )
    return sorted
}

@Composable
fun PaletteDock(
    palette: List<PaletteColor>,
    regions: List<Region>,
    activeColorId: Int,
    filledRegionIds: Set<Int>,
    onColorSelected: (Int) -> Unit,
    modifier: Modifier = Modifier,
    sortOrder: PaletteSortOrder = PaletteSortOrder.NUMBER,
    prioritizeOnScreen: Boolean = true,
    visibleColorIds: Set<Int> = emptySet(),
    raiseDock: Boolean = true,
    onColorHintRequested: (Int) -> Unit = {},
) {
    val remainingCountMap = remember(regions, filledRegionIds) {
        val start = System.nanoTime()
        val map = HashMap<Int, Int>()
        for (i in regions.indices) {
            val r = regions[i]
            if (r.id !in filledRegionIds) {
                map[r.colorId] = (map[r.colorId] ?: 0) + 1
            }
        }
        val elapsedMs = (System.nanoTime() - start) / 1_000_000.0
        CapyLogger.d(
            "CapyPerf",
            "PaletteDock: Built remainingCountMap -> elapsed=${String.format(Locale.US, "%.3f", elapsedMs)}ms, totalRegions=${regions.size}, filledCount=${filledRegionIds.size}, uncompletedColorCount=${map.size}",
        )
        map
    }

    val basePalette = remember(palette, regions, filledRegionIds, sortOrder) {
        getVisiblePalette(palette, regions, filledRegionIds, sortOrder)
    }

    val displayNumberMap = remember(palette, regions, sortOrder) {
        getDisplayNumberMap(palette, regions, sortOrder)
    }

    val dockPalette = remember(basePalette, prioritizeOnScreen, visibleColorIds) {
        getDockPalette(basePalette, prioritizeOnScreen, visibleColorIds)
    }

    if (dockPalette.isEmpty()) return

    // Pinned Active Selected Item on the far left
    val activeItem = remember(dockPalette, activeColorId) {
        dockPalette.find { it.id == activeColorId } ?: dockPalette.firstOrNull()
    }

    // Remaining scrollable palette swatches (excluding activeItem)
    val scrollablePalette = remember(dockPalette, activeItem) {
        if (activeItem != null) dockPalette.filterNot { it.id == activeItem.id } else dockPalette
    }

    val onScreenGroup = remember(scrollablePalette, visibleColorIds, prioritizeOnScreen) {
        if (!prioritizeOnScreen || visibleColorIds.isEmpty()) emptyList()
        else scrollablePalette.filter { it.id in visibleColorIds }
    }

    val offScreenGroup = remember(scrollablePalette, visibleColorIds, prioritizeOnScreen) {
        if (!prioritizeOnScreen || visibleColorIds.isEmpty()) scrollablePalette
        else scrollablePalette.filter { it.id !in visibleColorIds }
    }

    val lazyListState = rememberLazyListState()

    // Keep swatches scrolled all the way to the left when on-screen colors set changes
    LaunchedEffect(dockPalette.firstOrNull()?.id) {
        if (dockPalette.isNotEmpty()) {
            lazyListState.scrollToItem(0)
        }
    }

    val swatchShape = RoundedCornerShape(8.dp)
    val containerShape = RoundedCornerShape(12.dp)
    val bottomPadding = if (raiseDock) 22.dp else 4.dp

    Surface(
        modifier = modifier.fillMaxWidth(),
        color = Color.Transparent,
        tonalElevation = 0.dp,
        shadowElevation = 0.dp,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 4.dp, bottom = bottomPadding, start = 12.dp, end = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Pinned Active Selected Swatch on the far left
            if (activeItem != null) {
                Box(
                    modifier = Modifier.padding(end = 4.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    SwatchItem(
                        item = activeItem,
                        remainingCount = remainingCountMap[activeItem.id] ?: 0,
                        isSelected = true,
                        displayNumber = displayNumberMap[activeItem.id] ?: activeItem.id.toString(),
                        swatchShape = swatchShape,
                        onColorSelected = onColorSelected,
                        onColorHintRequested = onColorHintRequested,
                    )
                }
            }

            // Scrollable remaining swatches
            LazyRow(
                state = lazyListState,
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (onScreenGroup.isNotEmpty()) {
                    item(key = "onScreenContainer") {
                        Surface(
                            shape = containerShape,
                            color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f),
                            border = BorderStroke(width = 1.5.dp, color = MaterialTheme.colorScheme.primary),
                            tonalElevation = 0.dp,
                            shadowElevation = 0.dp,
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 6.dp),
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                onScreenGroup.forEach { item ->
                                    SwatchItem(
                                        item = item,
                                        remainingCount = remainingCountMap[item.id] ?: 0,
                                        isSelected = false,
                                        displayNumber = displayNumberMap[item.id] ?: item.id.toString(),
                                        swatchShape = swatchShape,
                                        onColorSelected = onColorSelected,
                                        onColorHintRequested = onColorHintRequested,
                                    )
                                }
                            }
                        }
                    }

                    items(offScreenGroup, key = { it.id }) { item ->
                        Box(modifier = Modifier.padding(vertical = 6.dp)) {
                            SwatchItem(
                                item = item,
                                remainingCount = remainingCountMap[item.id] ?: 0,
                                isSelected = false,
                                displayNumber = displayNumberMap[item.id] ?: item.id.toString(),
                                swatchShape = swatchShape,
                                onColorSelected = onColorSelected,
                                onColorHintRequested = onColorHintRequested,
                            )
                        }
                    }
                } else {
                    items(scrollablePalette, key = { it.id }) { item ->
                        Box(modifier = Modifier.padding(vertical = 6.dp)) {
                            SwatchItem(
                                item = item,
                                remainingCount = remainingCountMap[item.id] ?: 0,
                                isSelected = false,
                                displayNumber = displayNumberMap[item.id] ?: item.id.toString(),
                                swatchShape = swatchShape,
                                onColorSelected = onColorSelected,
                                onColorHintRequested = onColorHintRequested,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SwatchItem(
    item: PaletteColor,
    remainingCount: Int,
    isSelected: Boolean,
    displayNumber: String,
    swatchShape: RoundedCornerShape,
    onColorSelected: (Int) -> Unit,
    onColorHintRequested: (Int) -> Unit,
) {
    val textColor = if (item.isLight) Color.Black else Color.White
    val subTextColor = if (item.isLight) Color.Black.copy(alpha = 0.75f) else Color.White.copy(alpha = 0.85f)

    Box(
        modifier = Modifier
            .size(width = 42.dp, height = 36.dp)
            .clip(swatchShape)
            .background(item.color)
            .border(
                width = if (isSelected) 2.5.dp else 1.dp,
                color = if (isSelected) MaterialTheme.colorScheme.primary else Color.Black.copy(alpha = 0.25f),
                shape = swatchShape,
            )
            .clickable {
                if (isSelected) {
                    onColorHintRequested(item.id)
                } else {
                    onColorSelected(item.id)
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = displayNumber,
                color = textColor,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 12.5.sp,
                lineHeight = 12.5.sp,
            )
            Text(
                text = remainingCount.toString(),
                color = subTextColor,
                fontWeight = FontWeight.Bold,
                fontSize = 9.5.sp,
                lineHeight = 9.5.sp,
            )
        }
    }
}

private fun getHue(argb: Int): Float {
    val r = ((argb shr 16) and 0xFF) / 255f
    val g = ((argb shr 8) and 0xFF) / 255f
    val b = (argb and 0xFF) / 255f

    val max = maxOf(r, maxOf(g, b))
    val min = minOf(r, minOf(g, b))
    val delta = max - min

    if (delta == 0f) return 0f

    val hue = when (max) {
        r -> ((g - b) / delta) % 6f
        g -> ((b - r) / delta) + 2f
        else -> ((r - g) / delta) + 4f
    } * 60f

    return if (hue < 0f) hue + 360f else hue
}
