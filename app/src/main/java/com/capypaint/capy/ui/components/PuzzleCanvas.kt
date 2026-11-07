package com.capypaint.capy.ui.components

import android.graphics.Bitmap
import android.graphics.Color
import androidx.core.graphics.createBitmap
import androidx.core.graphics.withTranslation
import kotlin.time.Duration.Companion.milliseconds
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.view.MotionEvent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.ui.input.pointer.changedToUp
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.foundation.focusable
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.pointerInteropFilter
import com.capypaint.capy.engine.PuzzleData
import com.capypaint.capy.model.CanvasBgColor
import com.capypaint.capy.model.HintFillStyle
import com.capypaint.capy.model.PaletteSortOrder
import com.capypaint.capy.model.RegionHighlightStyle
import com.capypaint.capy.util.CapyLogger
import kotlinx.coroutines.delay
import java.util.Locale
import kotlin.math.hypot

@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun PuzzleCanvas(
    puzzle: PuzzleData?,
    displayBitmap: Bitmap?,
    bitmapRevision: Int,
    activeColorId: Int,
    filledRegionIds: Set<Int>,
    hintRegionId: Int?,
    onRegionClicked: (Int) -> Unit,
    modifier: Modifier = Modifier,
    previewBitmap: Bitmap? = null,
    originalBitmap: Bitmap? = null,
    isPreviewMode: Boolean = false,
    isPaintMode: Boolean = false,
    canvasBgColor: CanvasBgColor = CanvasBgColor.BLACK,
    canvasBgArgb: Int = canvasBgColor.argb,
    sortOrder: PaletteSortOrder = PaletteSortOrder.NUMBER,
    showRegionLabels: Boolean = true,
    showPreviewLabels: Boolean = true,
    showPreviewBorders: Boolean = false,
    labelScale: Float = 1.0f,
    highlightMatching: Boolean = true,
    highlightStyle: RegionHighlightStyle = RegionHighlightStyle.CENTROID_GLOW,
    hintColorArgb: Int = 0xFFFBBF24.toInt(),
    hintFillStyle: HintFillStyle = HintFillStyle.CHECKER,
    animateHint: Boolean = true,
    showNextRegionHint: Boolean = true,
    hintIntensity: Float = 0.65f,
    targetResolution: Int = 640,
    resetZoomTrigger: Int = 0,
    zoomInTrigger: Int = 0,
    zoomOutTrigger: Int = 0,
    initialZoomScale: Float = 1.0f,
    initialPanOffsetX: Float = 0.0f,
    initialPanOffsetY: Float = 0.0f,
    onViewExtentChanged: (zoomScale: Float, panOffsetX: Float, panOffsetY: Float) -> Unit = { _, _, _ -> },
    onBatchRegionsClicked: (Set<Int>) -> Unit = { set -> set.forEach(onRegionClicked) },
    onVisibleColorIdsChanged: (Set<Int>) -> Unit = {},
    onVisibleRegionIdsChanged: (Set<Int>) -> Unit = {},
    onTogglePreview: () -> Unit = {},
    @Suppress("unused") onTogglePaintMode: () -> Unit = {},
) {
    var scale by remember(puzzle) { mutableFloatStateOf(initialZoomScale) }
    var offset by remember(puzzle) { mutableStateOf(Offset(initialPanOffsetX, initialPanOffsetY)) }

    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        try {
            focusRequester.requestFocus()
            CapyLogger.d("CapyInput", "PuzzleCanvas focus requested successfully")
        } catch (e: Exception) {
            CapyLogger.d("CapyInput", "Failed to request focus on PuzzleCanvas: ${e.message}")
        }
    }

    LaunchedEffect(resetZoomTrigger) {
        if (resetZoomTrigger > 0) {
            scale = 1.0f
            offset = Offset.Zero
            CapyLogger.d("CapyInput", "Reset zoom triggered -> scale reset to 1.0")
        }
    }

    val infiniteTransition = rememberInfiniteTransition(label = "hintPulse")
    val pulseAlpha by infiniteTransition.animateFloat(
        initialValue = 0.35f,
        targetValue = 0.95f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 750),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "alpha",
    )

    val textPaint = remember {
        Paint().apply {
            isAntiAlias = true
            isSubpixelText = true
            textAlign = Paint.Align.CENTER
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        }
    }

    val activeBadgePaint = remember {
        Paint().apply {
            isAntiAlias = true
            style = Paint.Style.FILL
            color = Color.argb(220, 255, 243, 199) // Light amber container
        }
    }

    val normalBadgePaint = remember {
        Paint().apply {
            isAntiAlias = true
            style = Paint.Style.FILL
            color = Color.argb(190, 255, 255, 255) // White pill
        }
    }

    val hintRegionPaint = remember {
        Paint().apply {
            isAntiAlias = false
            style = Paint.Style.FILL
        }
    }

    val matchingGlowPaint = remember {
        Paint().apply {
            isAntiAlias = true
            style = Paint.Style.FILL
        }
    }

    val bitmapPaint = remember {
        Paint().apply {
            isFilterBitmap = true
            isDither = true
        }
    }

    val tapDotPaint = remember {
        Paint().apply {
            isAntiAlias = true
            style = Paint.Style.FILL
        }
    }

    var tapDotLocation by remember { mutableStateOf<Offset?>(null) }
    val tapDotAnimatable = remember { Animatable(0f) }
    val coroutineScope = rememberCoroutineScope()

    val isEffectivePreviewMode = isPreviewMode || (puzzle == null) || (displayBitmap == null)

    val borderBitmap = remember(puzzle, filledRegionIds, bitmapRevision, isEffectivePreviewMode, showPreviewBorders) {
        if ((puzzle == null) || (!isEffectivePreviewMode) || (!showPreviewBorders)) null
        else {
            val w = puzzle.width
            val h = puzzle.height
            val total = w * h
            val pixels = IntArray(total)
            val borderMap = puzzle.borderMap
            val regionMap = puzzle.regionMap
            val borderArgb = 0xCC000000.toInt()

            for (i in 0 until total) {
                if (borderMap[i]) {
                    val rId = regionMap[i]
                    // Only draw boundary pixel if its region or an adjacent region is UNCOMPLETED
                    if (rId !in filledRegionIds) {
                        pixels[i] = borderArgb
                    } else {
                        val x = i % w
                        val y = i / w
                        val leftUncompleted = (x > 0) && (regionMap[i - 1] !in filledRegionIds)
                        val rightUncompleted = (x < (w - 1)) && (regionMap[i + 1] !in filledRegionIds)
                        val topUncompleted = (y > 0) && (regionMap[i - w] !in filledRegionIds)
                        val bottomUncompleted = (y < (h - 1)) && (regionMap[i + w] !in filledRegionIds)

                        if (leftUncompleted || rightUncompleted || topUncompleted || bottomUncompleted) {
                            pixels[i] = borderArgb
                        }
                    }
                }
            }
            val bmp = createBitmap(w, h, Bitmap.Config.ARGB_8888)
            bmp.setPixels(pixels, 0, w, 0, 0, w, h)
            bmp
        }
    }

    val highlightBitmap = remember(
        puzzle,
        activeColorId,
        filledRegionIds,
        hintRegionId,
        highlightMatching,
        highlightStyle,
        hintColorArgb,
        hintFillStyle,
    ) {
        if ((puzzle == null) || (!highlightMatching && (hintRegionId == null))) null
        else if ((highlightStyle != RegionHighlightStyle.FULL_REGION) && (highlightStyle != RegionHighlightStyle.BOUNDARY_ONLY)) null
        else {
            val w = puzzle.width
            val h = puzzle.height
            val total = w * h
            val pixels = IntArray(total)

            val isFullRegion = highlightStyle == RegionHighlightStyle.FULL_REGION
            val borderMap = puzzle.borderMap

            val r = (hintColorArgb shr 16) and 0xFF
            val g = (hintColorArgb shr 8) and 0xFF
            val b = hintColorArgb and 0xFF

            // Square A: The exact user-chosen colour!
            val squareA = Color.argb(240, r, g, b)

            // Square B: High-contrast paired shade of the chosen colour for PNG-style checker and stripes
            val luminance = ((0.299f * r) + (0.587f * g) + (0.114f * b))
            val squareB = if (luminance < 128) {
                val r2 = ((r * 0.3f) + 200).toInt().coerceIn(0, 255)
                val g2 = ((g * 0.3f) + 200).toInt().coerceIn(0, 255)
                val b2 = ((b * 0.3f) + 200).toInt().coerceIn(0, 255)
                Color.argb(240, r2, g2, b2)
            } else {
                val r2 = (r * 0.3f).toInt().coerceIn(0, 255)
                val g2 = (g * 0.3f).toInt().coerceIn(0, 255)
                val b2 = (b * 0.3f).toInt().coerceIn(0, 255)
                Color.argb(240, r2, g2, b2)
            }

            val borderArgb = Color.argb(240, (r * 0.6f).toInt(), (g * 0.6f).toInt(), (b * 0.6f).toInt())
            val checkSize = 8

            var paintedAny = false
            for (region in puzzle.regions) {
                if (region.id in filledRegionIds) continue
                val isActive = (region.colorId == activeColorId) && highlightMatching
                val isHinted = region.id == hintRegionId

                if (isActive || isHinted) {
                    val regPixels = region.pixels
                    for (i in regPixels.indices) {
                        val px = regPixels[i]
                        if (isFullRegion) {
                            if (borderMap[px]) {
                                pixels[px] = borderArgb
                            } else {
                                val x = px % w
                                val y = px / w
                                val pixelColor = when (hintFillStyle) {
                                    HintFillStyle.SOLID -> squareA
                                    HintFillStyle.CHECKER -> {
                                        val isCheck = (((x / checkSize) + (y / checkSize)) % 2) == 0
                                        if (isCheck) squareA else squareB
                                    }
                                    HintFillStyle.STRIPES -> {
                                        val isStripe = (((x + y) / 6) % 2) == 0
                                        if (isStripe) squareA else squareB
                                    }
                                }
                                pixels[px] = pixelColor
                            }
                            paintedAny = true
                        } else {
                            if (borderMap[px]) {
                                pixels[px] = squareA
                                paintedAny = true
                            }
                        }
                    }
                }
            }

            if (!paintedAny) null
            else {
                val bmp = createBitmap(w, h, Bitmap.Config.ARGB_8888)
                bmp.setPixels(pixels, 0, w, 0, 0, w, h)
                bmp
            }
        }
    }

    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val canvasW = constraints.maxWidth.toFloat()
        val canvasH = constraints.maxHeight.toFloat()

        val pWidth = puzzle?.width ?: run {
            val bmp = originalBitmap ?: previewBitmap ?: displayBitmap
            if (bmp != null) calculateTargetDimensions(bmp.width, bmp.height, targetResolution).first else targetResolution
        }
        val pHeight = puzzle?.height ?: run {
            val bmp = originalBitmap ?: previewBitmap ?: displayBitmap
            if (bmp != null) calculateTargetDimensions(bmp.width, bmp.height, targetResolution).second else targetResolution
        }

        val baseScale = if ((pWidth > 0) && (pHeight > 0)) {
            minOf(canvasW / pWidth, canvasH / pHeight) * 0.92f
        } else 1f

        val baseOffsetX = (canvasW - (pWidth * baseScale)) / 2f
        val baseOffsetY = (canvasH - (pHeight * baseScale)) / 2f

        LaunchedEffect(zoomInTrigger) {
            if (zoomInTrigger > 0) {
                val oldScale = scale
                val newScale = (oldScale * 1.35f).coerceIn(0.6f, 10.0f)
                val actualZoom = newScale / oldScale

                val focalX = (canvasW / 2f) - (offset.x + baseOffsetX)
                val focalY = (canvasH / 2f) - (offset.y + baseOffsetY)

                offset = Offset(
                    x = offset.x - (focalX * (actualZoom - 1f)),
                    y = offset.y - (focalY * (actualZoom - 1f)),
                )
                scale = newScale
                CapyLogger.d("CapyInput", "Zoom In (+) button triggered -> oldScale=$oldScale, newScale=$newScale")
            }
        }

        LaunchedEffect(zoomOutTrigger) {
            if (zoomOutTrigger > 0) {
                val oldScale = scale
                val newScale = (oldScale / 1.35f).coerceIn(0.6f, 10.0f)
                val actualZoom = newScale / oldScale

                val focalX = (canvasW / 2f) - (offset.x + baseOffsetX)
                val focalY = (canvasH / 2f) - (offset.y + baseOffsetY)

                offset = Offset(
                    x = offset.x - (focalX * (actualZoom - 1f)),
                    y = offset.y - (focalY * (actualZoom - 1f)),
                )
                scale = newScale
                CapyLogger.d("CapyInput", "Zoom Out (-) button triggered -> oldScale=$oldScale, newScale=$newScale")
            }
        }

        LaunchedEffect(canvasW, canvasH, pWidth, pHeight, baseScale, baseOffsetX, baseOffsetY, puzzle != null) {
            val isPuzzleReady = puzzle != null
            val drawTop = offset.y + baseOffsetY
            val drawLeft = offset.x + baseOffsetX
            val drawWidth = pWidth * baseScale * scale
            val drawHeight = pHeight * baseScale * scale
            val baseScaleFormatted = String.format(Locale.US, "%.3f", baseScale)
            CapyLogger.d(
                "CapyCanvas",
                "PuzzleCanvas Layout -> puzzleReady=$isPuzzleReady, canvas=${canvasW.toInt()}x${canvasH.toInt()}, pDim=${pWidth}x$pHeight, baseScale=$baseScaleFormatted, drawRect=[top=${drawTop.toInt()}, left=${drawLeft.toInt()}, w=${drawWidth.toInt()}, h=${drawHeight.toInt()}]",
            )
        }

        // Pan to center hinted region if showNextRegionHint is enabled OR if the region is off-screen
        LaunchedEffect(hintRegionId) {
            if ((puzzle != null) && (hintRegionId != null) && (canvasW > 0) && (canvasH > 0)) {
                val region = puzzle.regions.firstOrNull { it.id == hintRegionId }
                if (region != null) {
                    val effectiveScale = scale * baseScale
                    if (effectiveScale > 0f) {
                        val visLeft = (-offset.x - baseOffsetX) / effectiveScale
                        val visTop = (-offset.y - baseOffsetY) / effectiveScale
                        val visRight = visLeft + (canvasW / effectiveScale)
                        val visBottom = visTop + (canvasH / effectiveScale)

                        val isOnScreen = (region.maxX >= visLeft) && (region.minX <= visRight) &&
                                        (region.maxY >= visTop) && (region.minY <= visBottom)

                        if (showNextRegionHint || !isOnScreen) {
                            // Pan to center the region (preserving current user zoom level, do NOT change scale!)
                            val targetOffsetX = (canvasW / 2f) - baseOffsetX - (region.centroidX * effectiveScale)
                            val targetOffsetY = (canvasH / 2f) - baseOffsetY - (region.centroidY * effectiveScale)
                            offset = Offset(targetOffsetX, targetOffsetY)
                        }
                    }
                }
            }
        }

        // Instantly notify ViewModel of view extent updates (scale/pan offset) for persistent state saving
        LaunchedEffect(scale, offset) {
            onViewExtentChanged(scale, offset.x, offset.y)
        }

        // Calculate spatial visibility asynchronously on Dispatchers.Default (background thread pool)
        // with 100ms gesture debouncing to eliminate palette dock recomposition churn while panning/zooming!
        LaunchedEffect(scale, offset, canvasW, canvasH, puzzle, filledRegionIds, baseScale, baseOffsetX, baseOffsetY) {
            if ((puzzle == null) || (canvasW <= 0f) || (canvasH <= 0f)) {
                onVisibleColorIdsChanged(emptySet())
                onVisibleRegionIdsChanged(emptySet())
                return@LaunchedEffect
            }

            // Debounce active pan/zoom gesture frames by 100ms. If new gesture positions arrive while dragging,
            // LaunchedEffect automatically cancels this coroutine before any calculations or emissions occur.
            delay(100.milliseconds)

            val (colorSet, regionSet) = withContext(Dispatchers.Default) {
                val start = System.nanoTime()
                val effectiveScale = scale * baseScale
                if (effectiveScale <= 0f) {
                    Pair(emptySet<Int>(), emptySet<Int>())
                } else {
                    val visLeft = (-offset.x - baseOffsetX) / effectiveScale
                    val visTop = (-offset.y - baseOffsetY) / effectiveScale
                    val visRight = visLeft + (canvasW / effectiveScale)
                    val visBottom = visTop + (canvasH / effectiveScale)

                    val colorSet = HashSet<Int>()
                    val regionSet = HashSet<Int>()
                    var checkedCount = 0
                    val regions = puzzle.regions
                    for (i in regions.indices) {
                        if (!isActive) break // Cooperative cancellation if user moved gesture position mid-calculation
                        val region = regions[i]
                        if (region.id in filledRegionIds) continue
                        checkedCount++
                        if ((region.maxX >= visLeft) && (region.minX <= visRight) &&
                            (region.maxY >= visTop) && (region.minY <= visBottom)) {
                            colorSet.add(region.colorId)
                            regionSet.add(region.id)
                        }
                    }
                    val elapsedMs = (System.nanoTime() - start) / 1_000_000.0
                    CapyLogger.d(
                        "CapyPerf",
                        "PuzzleCanvas [BG Thread ${Thread.currentThread().name}]: Spatial visibility computed -> elapsed=${String.format(Locale.US, "%.3f", elapsedMs)}ms, totalRegions=${regions.size}, checkedUnfilled=$checkedCount, visRegions=${regionSet.size}, visColors=${colorSet.size} ($colorSet)",
                    )
                    Pair(colorSet, regionSet)
                }
            }

            CapyLogger.d(
                "CapyPerf",
                "PuzzleCanvas: Posting off-main-thread spatial results to UI -> visColorsCount=${colorSet.size}, visRegionsCount=${regionSet.size}",
            )
            onVisibleColorIdsChanged(colorSet)
            onVisibleRegionIdsChanged(regionSet)
        }

        val displayNumberMap = remember(puzzle?.palette, puzzle?.regions, sortOrder) {
            if (puzzle == null) emptyMap()
            else getDisplayNumberMap(puzzle.palette, puzzle.regions, sortOrder)
        }

        val isEffectivePreviewMode = isPreviewMode || (puzzle == null) || (displayBitmap == null)

        val currentBaseOffsetX by rememberUpdatedState(baseOffsetX)
        val currentBaseOffsetY by rememberUpdatedState(baseOffsetY)
        val currentBaseScale by rememberUpdatedState(baseScale)
        val currentScale by rememberUpdatedState(scale)
        val currentOffset by rememberUpdatedState(offset)
        val currentIsPreview by rememberUpdatedState(isEffectivePreviewMode)
        val currentIsPaintMode by rememberUpdatedState(isPaintMode)

        var lastDragPosition by remember { mutableStateOf<Offset?>(null) }

        fun hitTestAndPaintLine(fromScreen: Offset, toScreen: Offset) {
            if (currentIsPreview || (puzzle == null)) return
            val effectiveScale = currentScale * currentBaseScale
            if (effectiveScale <= 0f) return

            val x1 = (fromScreen.x - currentOffset.x - currentBaseOffsetX) / effectiveScale
            val y1 = (fromScreen.y - currentOffset.y - currentBaseOffsetY) / effectiveScale
            val x2 = (toScreen.x - currentOffset.x - currentBaseOffsetX) / effectiveScale
            val y2 = (toScreen.y - currentOffset.y - currentBaseOffsetY) / effectiveScale

            // Animate fading feedback dot at the current touch location
            tapDotLocation = Offset(x2, y2)
            coroutineScope.launch {
                tapDotAnimatable.snapTo(1f)
                tapDotAnimatable.animateTo(0f, tween(300))
            }

            val width = puzzle.width
            val height = puzzle.height
            val regionMap = puzzle.regionMap
            if ((width <= 0) || (height <= 0)) return

            val dx = x2 - x1
            val dy = y2 - y1
            val distance = hypot(dx, dy)
            val steps = maxOf(1, (distance * 0.8f).toInt())

            val intersectedRegions = HashSet<Int>()
            for (i in 0..steps) {
                val t = i.toFloat() / steps
                val lx = (x1 + (t * dx)).toInt()
                val ly = (y1 + (t * dy)).toInt()

                if ((lx in (0 until width)) && (ly in (0 until height))) {
                    val rid = regionMap[(ly * width) + lx]
                    if (rid > 0) {
                        intersectedRegions.add(rid)
                    }
                }
            }

            if (intersectedRegions.isNotEmpty()) {
                CapyLogger.d("CapyInput", "hitTestAndPaintLine -> screen=(${toScreen.x.toInt()}, ${toScreen.y.toInt()}), canvas=(${x2.toInt()}, ${y2.toInt()}), intersected=${intersectedRegions.size} regions ($intersectedRegions)")
                onBatchRegionsClicked(intersectedRegions)
            }
        }

        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .focusRequester(focusRequester)
                .focusable()
                .pointerInteropFilter { motionEvent ->
                    val actionName = MotionEvent.actionToString(motionEvent.action)
                    val vScroll = motionEvent.getAxisValue(MotionEvent.AXIS_VSCROLL)
                    val hScroll = motionEvent.getAxisValue(MotionEvent.AXIS_HSCROLL)

                    CapyLogger.d("CapyInput", "pointerInteropFilter -> action=$actionName (${motionEvent.action}), pos=(${motionEvent.x.toInt()}, ${motionEvent.y.toInt()}), vScroll=$vScroll, hScroll=$hScroll")

                    if ((motionEvent.actionMasked == MotionEvent.ACTION_SCROLL) || (motionEvent.action == MotionEvent.ACTION_SCROLL)) {
                        val scrollVal = if (vScroll != 0f) vScroll else hScroll
                        CapyLogger.d("CapyInput", "SCROLL MotionEvent intercepted! -> scrollVal=$scrollVal")

                        if (scrollVal != 0f) {
                            val zoomFactor = if (scrollVal > 0f) 1.25f else 0.8f
                            val oldScale = scale
                            val newScale = (oldScale * zoomFactor).coerceIn(0.6f, 10.0f)
                            val actualZoom = newScale / oldScale

                            val mouseX = motionEvent.x
                            val mouseY = motionEvent.y
                            val focalX = mouseX - (offset.x + currentBaseOffsetX)
                            val focalY = mouseY - (offset.y + currentBaseOffsetY)

                            offset = Offset(
                                x = offset.x - (focalX * (actualZoom - 1f)),
                                y = offset.y - (focalY * (actualZoom - 1f)),
                            )
                            scale = newScale
                            CapyLogger.d("CapyInput", "Mousewheel zoom applied via pointerInteropFilter -> oldScale=$oldScale, newScale=$newScale, zoomFactor=$zoomFactor")
                            true
                        } else false
                    } else false
                }
                .pointerInput(puzzle, isPaintMode, isEffectivePreviewMode) {
                    detectTransformGestures { centroid, pan, zoom, _ ->
                        val oldScale = scale
                        val newScale = (oldScale * zoom).coerceIn(0.6f, 10.0f)
                        val actualZoom = newScale / oldScale

                        val focalX = centroid.x - (offset.x + currentBaseOffsetX)
                        val focalY = centroid.y - (offset.y + currentBaseOffsetY)

                        offset = Offset(
                            x = (offset.x + pan.x) - (focalX * (actualZoom - 1f)),
                            y = (offset.y + pan.y) - (focalY * (actualZoom - 1f)),
                        )
                        scale = newScale
                        CapyLogger.d("CapyInput", "Pinch/Pan transform -> pan=(${pan.x.toInt()}, ${pan.y.toInt()}), zoom=$zoom, newScale=$newScale")
                    }
                }
                .pointerInput(puzzle, isPaintMode, isEffectivePreviewMode) {
                    awaitPointerEventScope {
                        var wasMultiTouch = false
                        var downPos: Offset? = null
                        var totalDragDistance = 0f

                        while (true) {
                            val event = awaitPointerEvent()

                            if (event.type == PointerEventType.Scroll) {
                                val change = event.changes.firstOrNull()
                                val scrollDelta = change?.scrollDelta?.y ?: 0f
                                CapyLogger.d("CapyInput", "PointerEventType.Scroll in scope -> scrollDelta=$scrollDelta")

                                if (scrollDelta != 0f) {
                                    val zoomFactor = if (scrollDelta < 0f) 1.25f else 0.8f
                                    val oldScale = scale
                                    val newScale = (oldScale * zoomFactor).coerceIn(0.6f, 10.0f)
                                    val actualZoom = newScale / oldScale

                                    val centerPos = change?.position ?: Offset(canvasW / 2f, canvasH / 2f)
                                    val focalX = centerPos.x - (offset.x + currentBaseOffsetX)
                                    val focalY = centerPos.y - (offset.y + currentBaseOffsetY)

                                    offset = Offset(
                                        x = offset.x - (focalX * (actualZoom - 1f)),
                                        y = offset.y - (focalY * (actualZoom - 1f)),
                                    )
                                    scale = newScale
                                    CapyLogger.d("CapyInput", "Compose Scroll delta zoom applied -> oldScale=$oldScale, newScale=$newScale")
                                    change?.consume()
                                }
                            }

                            val pointers = event.changes

                            if (pointers.isEmpty()) continue

                            // 1. Detect multi-touch zoom/pinch gesture
                            if (pointers.size >= 2) {
                                wasMultiTouch = true
                                lastDragPosition = null
                            }

                            val pointer = pointers.first()

                            // 2. Track pointer movement & handle drag-to-paint
                            if (pointer.pressed) {
                                if (downPos == null) {
                                    downPos = pointer.position
                                    totalDragDistance = 0f
                                } else {
                                    val prev = lastDragPosition ?: pointer.position
                                    val dx = pointer.position.x - prev.x
                                    val dy = pointer.position.y - prev.y
                                    totalDragDistance += hypot(dx, dy)
                                }

                                if (currentIsPaintMode && (!currentIsPreview) && (!wasMultiTouch) && (pointers.size == 1)) {
                                    val currentPos = pointer.position
                                    val prevPos = lastDragPosition ?: currentPos
                                    hitTestAndPaintLine(prevPos, currentPos)
                                    pointer.consume()
                                }
                                lastDragPosition = pointer.position
                            }

                            // 3. Handle single tap on pointer release
                            if (pointer.changedToUp()) {
                                val upPos = pointer.position
                                val directDist = if (downPos != null) hypot(upPos.x - downPos.x, upPos.y - downPos.y) else totalDragDistance

                                if ((!wasMultiTouch) && (totalDragDistance < 20f) && (directDist < 20f)) {
                                    if (currentIsPreview) {
                                        if (puzzle != null) {
                                            onTogglePreview()
                                            pointer.consume()
                                        }
                                    } else if (!currentIsPaintMode) {
                                        hitTestAndPaintLine(upPos, upPos)
                                        pointer.consume()
                                    }
                                }
                            }

                            // 4. Reset gesture state when ALL pointers have been released
                            val anyStillPressed = pointers.any { it.pressed }
                            if (!anyStillPressed) {
                                wasMultiTouch = false
                                downPos = null
                                totalDragDistance = 0f
                                lastDragPosition = null
                            }
                        }
                    }
                },
        ) {
            drawRect(androidx.compose.ui.graphics.Color(canvasBgArgb))

            val effectiveScale = scale * baseScale
            val native = drawContext.canvas.nativeCanvas

            native.withTranslation(offset.x + baseOffsetX, offset.y + baseOffsetY) {
                scale(effectiveScale, effectiveScale)

                if (isEffectivePreviewMode) {
                // Unified Preview Mode rendering path
                val hintBmp = originalBitmap ?: previewBitmap ?: displayBitmap
                hintBmp?.let {
                    if ((it.width == pWidth) && (it.height == pHeight)) {
                        native.drawBitmap(it, 0f, 0f, bitmapPaint)
                    } else {
                        val src = Rect(0, 0, it.width, it.height)
                        val dst = RectF(0f, 0f, pWidth.toFloat(), pHeight.toFloat())
                        native.drawBitmap(it, src, dst, bitmapPaint)
                    }
                }
                // Optional Hairline Region Boundary Overlay in Preview Mode
                if (showPreviewBorders && (borderBitmap != null)) {
                    if ((borderBitmap.width == pWidth) && (borderBitmap.height == pHeight)) {
                        native.drawBitmap(borderBitmap, 0f, 0f, bitmapPaint)
                    } else {
                        val src = Rect(0, 0, borderBitmap.width, borderBitmap.height)
                        val dst = RectF(0f, 0f, pWidth.toFloat(), pHeight.toFloat())
                        native.drawBitmap(borderBitmap, src, dst, bitmapPaint)
                    }
                }
            } else {
                // 1. Draw full resolution original source image underneath (Layer 1)
                if (originalBitmap != null) {
                    val src = Rect(0, 0, originalBitmap.width, originalBitmap.height)
                    val dst = RectF(0f, 0f, pWidth.toFloat(), pHeight.toFloat())
                    native.drawBitmap(originalBitmap, src, dst, bitmapPaint)
                }

                // 2. Draw puzzle overlay bitmap on top (Layer 2)
                displayBitmap.let { bmp ->
                    if ((bmp.width == pWidth) && (bmp.height == pHeight)) {
                        native.drawBitmap(bmp, 0f, 0f, bitmapPaint)
                    } else {
                        val src = Rect(0, 0, bmp.width, bmp.height)
                        val dst = RectF(0f, 0f, pWidth.toFloat(), pHeight.toFloat())
                        native.drawBitmap(bmp, src, dst, bitmapPaint)
                    }
                }

                // 3. Draw hint / active region highlights on top (Layer 3)
                if (highlightBitmap != null) {
                    if (animateHint) {
                        bitmapPaint.alpha = (pulseAlpha * 255).toInt().coerceIn(120, 255)
                    } else {
                        bitmapPaint.alpha = 255
                    }
                    if ((highlightBitmap.width == pWidth) && (highlightBitmap.height == pHeight)) {
                        native.drawBitmap(highlightBitmap, 0f, 0f, bitmapPaint)
                    } else {
                        val src = Rect(0, 0, highlightBitmap.width, highlightBitmap.height)
                        val dst = RectF(0f, 0f, pWidth.toFloat(), pHeight.toFloat())
                        native.drawBitmap(highlightBitmap, src, dst, bitmapPaint)
                    }
                    bitmapPaint.alpha = 255
                }
            }

            val drawLabelsNow = if (isEffectivePreviewMode) (showRegionLabels && showPreviewLabels) else showRegionLabels

            // Draw hint, active region highlights, and number labels for uncompleted regions
            if ((puzzle != null) && (drawLabelsNow || highlightMatching || (hintRegionId != null))) {
                val drawGlowCircle = highlightStyle == RegionHighlightStyle.CENTROID_GLOW
                val isNumberOnly = highlightStyle == RegionHighlightStyle.NUMBER_ONLY

                // Calculate visible image bounds in image coordinate space for viewport culling
                val visLeft = (-offset.x - baseOffsetX) / effectiveScale
                val visTop = (-offset.y - baseOffsetY) / effectiveScale
                val visRight = visLeft + (canvasW / effectiveScale)
                val visBottom = visTop + (canvasH / effectiveScale)

                for (region in puzzle.regions) {
                    if (region.id in filledRegionIds) continue

                    val isActive = region.colorId == activeColorId
                    val isHinted = region.id == hintRegionId

                    // Viewport culling: Skip off-screen regions unless active or hinted
                    if (!isActive && !isHinted) {
                        if ((region.centroidX !in (visLeft..visRight)) ||
                            (region.centroidY !in (visTop..visBottom))) {
                            continue
                        }
                    }

                    val regionWidth = ((region.maxX - region.minX) + 1).toFloat()
                    val regionHeight = ((region.maxY - region.minY) + 1).toFloat()
                    val minDimension = minOf(regionWidth, regionHeight)

                    // Draw glowing highlight on matching regions if highlightMatching is true
                    if (isActive && highlightMatching && drawGlowCircle) {
                        val alpha = if (animateHint) (pulseAlpha * hintIntensity * 255).toInt().coerceIn(30, 240)
                                    else (hintIntensity * 200).toInt().coerceIn(30, 240)
                        matchingGlowPaint.color = Color.argb(alpha, 251, 191, 36) // Warm gold
                        val radius = maxOf(4f / effectiveScale, minDimension * 0.18f)
                        native.drawCircle(region.centroidX, region.centroidY, radius, matchingGlowPaint)
                    }

                    // Highlight hinted region with high-performance glowing highlight
                    if (isHinted && (drawGlowCircle || isNumberOnly)) {
                        val hintAlpha = if (animateHint) (pulseAlpha * hintIntensity * 255).toInt().coerceIn(80, 240)
                                        else (hintIntensity * 220).toInt().coerceIn(80, 240)
                        hintRegionPaint.color = Color.argb(hintAlpha, 245, 158, 11) // Vibrant warm amber highlight

                        val radius = maxOf(8f / effectiveScale, minDimension * 0.45f)
                        native.drawCircle(region.centroidX, region.centroidY, radius, hintRegionPaint)
                    }

                    if (!drawLabelsNow) continue

                    // Skip number for tiny regions if user is zoomed way out, unless active or hinted
                    if (((minDimension * effectiveScale) < 6f) && (!isActive) && (!isHinted)) {
                        continue
                    }

                    // Label sizing scaled by labelScale setting and region interior clearance (shrinks for small regions)
                    val baseFontSize = if (isActive || isHinted) 19f else 16f
                    val defaultTextSize = (baseFontSize * labelScale) / effectiveScale

                    val regionMaxTextSize = if (region.maxRadius > 0f) {
                        (region.maxRadius * 1.35f * labelScale)
                    } else defaultTextSize

                    val targetTextSize = minOf(defaultTextSize, regionMaxTextSize).coerceIn(
                        (6f * labelScale) / effectiveScale,
                        (24f * labelScale) / effectiveScale,
                    )

                    val r = (hintColorArgb shr 16) and 0xFF
                    val g = (hintColorArgb shr 8) and 0xFF
                    val b = hintColorArgb and 0xFF
                    val fillLuminance = ((0.299f * r) + (0.587f * g) + (0.114f * b))

                    textPaint.textSize = targetTextSize
                    textPaint.isFakeBoldText = false
                    textPaint.color = when {
                        isHinted && (highlightStyle == RegionHighlightStyle.FULL_REGION) -> {
                            if (fillLuminance > 130) Color.rgb(15, 23, 42) else Color.rgb(255, 255, 255)
                        }
                        isHinted -> Color.rgb(180, 83, 9)
                        isActive && (highlightStyle == RegionHighlightStyle.FULL_REGION) -> {
                            if (fillLuminance > 130) Color.rgb(15, 23, 42) else Color.rgb(255, 255, 255)
                        }
                        isActive -> Color.rgb(251, 191, 36)
                        isEffectivePreviewMode -> Color.rgb(15, 23, 42)
                        else -> Color.rgb(51, 65, 85)
                    }

                    // Draw background badge circle ONLY in vector puzzle mode (suppressed in preview mode or for full region fill)
                    if (!isEffectivePreviewMode) {
                        val bgRadius = targetTextSize * 0.60f
                        val isFullRegionFill = highlightStyle == RegionHighlightStyle.FULL_REGION

                        if (isNumberOnly && (isActive || isHinted)) {
                            val pulseColor = if (isHinted) Color.argb((pulseAlpha * 240).toInt(), 245, 158, 11)
                                             else Color.argb((pulseAlpha * 220).toInt(), 251, 191, 36)
                            activeBadgePaint.color = pulseColor
                            native.drawCircle(region.centroidX, region.centroidY, bgRadius, activeBadgePaint)
                        } else if (!isFullRegionFill && (isActive || isHinted)) {
                            activeBadgePaint.color = Color.argb(220, 255, 243, 199)
                            native.drawCircle(region.centroidX, region.centroidY, bgRadius, activeBadgePaint)
                        } else if (!isActive && !isHinted) {
                            native.drawCircle(region.centroidX, region.centroidY, bgRadius, normalBadgePaint)
                        }
                    }

                    val textOffset = targetTextSize * 0.35f
                    val labelText = displayNumberMap[region.colorId] ?: region.colorId.toString()
                    native.drawText(
                        labelText,
                        region.centroidX,
                        region.centroidY + textOffset,
                        textPaint,
                    )
                }
            }

            // Draw fading tap feedback dot if active
            val dotAlpha = tapDotAnimatable.value
            val dotLoc = tapDotLocation
            if ((dotAlpha > 0f) && (dotLoc != null)) {
                val alphaInt = (dotAlpha * 240).toInt().coerceIn(0, 255)
                tapDotPaint.color = Color.argb(alphaInt, 56, 189, 248) // Vibrant sky blue glow
                val dotRadius = 7f / effectiveScale
                native.drawCircle(dotLoc.x, dotLoc.y, dotRadius, tapDotPaint)
            }
            }
        }
    }
}

private fun calculateTargetDimensions(bitmapWidth: Int, bitmapHeight: Int, maxResolution: Int = 2048): Pair<Int, Int> {
    if ((bitmapWidth <= 0) || (bitmapHeight <= 0)) return Pair(2048, 2048)
    val maxSourceDim = maxOf(bitmapWidth, bitmapHeight)
    val maxDim = if (maxResolution > 0) maxResolution.coerceAtMost(4096) else maxSourceDim
    val scale = if ((bitmapWidth > maxDim) || (bitmapHeight > maxDim)) {
        val maxOriginal = maxSourceDim.toFloat()
        maxDim / maxOriginal
    } else 1.0f

    val scaledWidth = (bitmapWidth * scale).toInt().coerceAtLeast(1)
    val scaledHeight = (bitmapHeight * scale).toInt().coerceAtLeast(1)
    return Pair(scaledWidth, scaledHeight)
}

