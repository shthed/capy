package com.capypaint.capy.engine

import android.graphics.Bitmap
import androidx.core.graphics.createBitmap
import androidx.core.graphics.scale
import com.capypaint.capy.model.GeneratorConfig
import com.capypaint.capy.model.ImageType
import com.capypaint.capy.util.CapyLogger

interface PuzzleGenerator {
    fun generate(
        bitmap: Bitmap,
        config: GeneratorConfig,
        onProgress: ((Float, String) -> Unit)? = null,
    ): PuzzleData
}

/**
 * Generator tailored for drawings, cartoons, vector graphics, and line art.
 * Applies pre-filtering to remove raster noise and dithering while preserving outlines,
 * uses perceptual posterization/quantization, and clean line-aware region segmentation.
 */
class DrawingPuzzleGenerator : PuzzleGenerator {

    override fun generate(
        bitmap: Bitmap,
        config: GeneratorConfig,
        onProgress: ((Float, String) -> Unit)?,
    ): PuzzleData {
        val tGen0 = System.currentTimeMillis()
        CapyLogger.d(
            "CapyEngine",
            "DrawingPuzzleGenerator.generate() START -> bitmap=${bitmap.width}x${bitmap.height}, config=[colors=${config.colorCount}, res=${config.resolution}, minArea=${config.minRegionArea}]",
        )
        onProgress?.invoke(0.05f, "Analyzing drawing canvas...")

        val maxSourceDim = maxOf(bitmap.width, bitmap.height)
        val maxDim = if (config.resolution > 0) config.resolution.coerceAtMost(4096) else maxSourceDim
        val scale = if ((bitmap.width > maxDim) || (bitmap.height > maxDim)) {
            val maxOriginal = maxSourceDim.toFloat()
            maxDim / maxOriginal
        } else 1.0f

        val scaledWidth = (bitmap.width * scale).toInt().coerceAtLeast(1)
        val scaledHeight = (bitmap.height * scale).toInt().coerceAtLeast(1)

        val tScale0 = System.currentTimeMillis()
        val workingBitmap = bitmap.scale(scaledWidth, scaledHeight)
        val tScale = System.currentTimeMillis() - tScale0
        CapyLogger.d(
            "CapyEngine",
            "Step 1/4: Canvas scale pass -> workingDim=${scaledWidth}x$scaledHeight (scale=$scale, took ${tScale}ms)",
        )

        // 1. Edge-preserving median filter to eliminate JPEG artifacts and line-art noise
        val totalPixels = scaledWidth * scaledHeight
        val origPixels = IntArray(totalPixels)
        workingBitmap.getPixels(origPixels, 0, scaledWidth, 0, 0, scaledWidth, scaledHeight)

        val tMed0 = System.currentTimeMillis()
        val filteredPixels = ColorQuantizer.applyMedianFilter(origPixels, scaledWidth, scaledHeight)
        val filteredBitmap = createBitmap(scaledWidth, scaledHeight, Bitmap.Config.ARGB_8888)
        filteredBitmap.setPixels(filteredPixels, 0, scaledWidth, 0, 0, scaledWidth, scaledHeight)
        val tMed = System.currentTimeMillis() - tMed0
        CapyLogger.d("CapyEngine", "Step 2/4: Edge-preserving 3x3 median filter -> took ${tMed}ms")

        // 2. Quantize drawing colors using perceptual color matching
        val tQuant0 = System.currentTimeMillis()
        val (palette, pixelClusters) = ColorQuantizer.quantize(
            bitmap = filteredBitmap,
            k = config.colorCount,
            maxIterations = 14,
            applySmoothing = true,
            usePerceptualDistance = true,
            onProgress = onProgress,
        )
        val tQuant = System.currentTimeMillis() - tQuant0
        CapyLogger.d(
            "CapyEngine",
            "Step 3/4: Drawing color quantization -> k=${config.colorCount}, paletteSize=${palette.size}, took ${tQuant}ms",
        )

        if ((workingBitmap != bitmap) && (!workingBitmap.isRecycled)) {
            workingBitmap.recycle()
        }
        if ((filteredBitmap != bitmap) && (!filteredBitmap.isRecycled)) {
            filteredBitmap.recycle()
        }

        // 3. Segment regions with strict noise suppression
        val minArea = config.minRegionArea.coerceAtLeast(15)
        val tSeg0 = System.currentTimeMillis()
        val segmentation = RegionSegmenter.segment(
            width = scaledWidth,
            height = scaledHeight,
            palette = palette,
            pixelClusters = pixelClusters,
            minRegionArea = minArea,
            maxMergePasses = 8,
            maxPerimeterToAreaRatio = 2.2f, // Allow drawing curves
            onProgress = onProgress,
        )
        val tSeg = System.currentTimeMillis() - tSeg0
        CapyLogger.d(
            "CapyEngine",
            "Step 4/4: Line-aware region segmentation -> generated ${segmentation.regions.size} regions, took ${tSeg}ms",
        )

        val totalElapsed = System.currentTimeMillis() - tGen0
        CapyLogger.d(
            "CapyEngine",
            "DrawingPuzzleGenerator.generate() FINISHED -> totalElapsed=${totalElapsed}ms, regions=${segmentation.regions.size}, palette=${palette.size}",
        )

        return PuzzleData(
            width = scaledWidth,
            height = scaledHeight,
            palette = palette,
            regions = segmentation.regions,
            regionMap = segmentation.regionMap,
            borderMap = segmentation.borderMap,
        )
    }
}

/**
 * Generator tailored for photos, realistic scenes, portraits, and nature.
 * Uses perceptual CIELAB/weighted color clustering, spatial majority filtering,
 * and perimeter aspect ratio constraints to avoid thin, unclickable serpentine sliver regions.
 */
class PhotoPuzzleGenerator : PuzzleGenerator {

    override fun generate(
        bitmap: Bitmap,
        config: GeneratorConfig,
        onProgress: ((Float, String) -> Unit)?,
    ): PuzzleData {
        val tGen0 = System.currentTimeMillis()
        CapyLogger.d(
            "CapyEngine",
            "PhotoPuzzleGenerator.generate() START -> bitmap=${bitmap.width}x${bitmap.height}, config=[colors=${config.colorCount}, res=${config.resolution}, minArea=${config.minRegionArea}]",
        )
        onProgress?.invoke(0.05f, "Processing photo canvas...")

        val maxSourceDim = maxOf(bitmap.width, bitmap.height)
        val maxDim = if (config.resolution > 0) config.resolution.coerceAtMost(4096) else maxSourceDim
        val scale = if ((bitmap.width > maxDim) || (bitmap.height > maxDim)) {
            val maxOriginal = maxSourceDim.toFloat()
            maxDim / maxOriginal
        } else 1.0f

        val scaledWidth = (bitmap.width * scale).toInt().coerceAtLeast(1)
        val scaledHeight = (bitmap.height * scale).toInt().coerceAtLeast(1)

        val tScale0 = System.currentTimeMillis()
        val workingBitmap = bitmap.scale(scaledWidth, scaledHeight)
        val tScale = System.currentTimeMillis() - tScale0
        CapyLogger.d(
            "CapyEngine",
            "Step 1/3: Image scale pass -> workingDim=${scaledWidth}x$scaledHeight (scale=$scale, took ${tScale}ms)",
        )

        // 1. Quantize photo colors using perceptual CIELAB / red-mean distance
        val tQuant0 = System.currentTimeMillis()
        val (palette, pixelClusters) = ColorQuantizer.quantize(
            bitmap = workingBitmap,
            k = config.colorCount,
            maxIterations = 12,
            applySmoothing = config.smoothingPasses > 0,
            usePerceptualDistance = true,
            onProgress = onProgress,
        )
        val tQuant = System.currentTimeMillis() - tQuant0
        CapyLogger.d(
            "CapyEngine",
            "Step 2/3: Photo color quantization -> k=${config.colorCount}, paletteSize=${palette.size}, took ${tQuant}ms",
        )

        if ((workingBitmap != bitmap) && (!workingBitmap.isRecycled)) {
            workingBitmap.recycle()
        }

        // 2. Segment regions with perimeter-to-area sliver prevention
        val minArea = config.minRegionArea.coerceAtLeast(20)
        val tSeg0 = System.currentTimeMillis()
        val segmentation = RegionSegmenter.segment(
            width = scaledWidth,
            height = scaledHeight,
            palette = palette,
            pixelClusters = pixelClusters,
            minRegionArea = minArea,
            maxMergePasses = 6,
            maxPerimeterToAreaRatio = 1.6f, // Eliminate thin unclickable sliver regions
            onProgress = onProgress,
        )
        val tSeg = System.currentTimeMillis() - tSeg0
        CapyLogger.d(
            "CapyEngine",
            "Step 3/3: Photo region segmentation -> generated ${segmentation.regions.size} regions, took ${tSeg}ms",
        )

        val totalElapsed = System.currentTimeMillis() - tGen0
        CapyLogger.d(
            "CapyEngine",
            "PhotoPuzzleGenerator.generate() FINISHED -> totalElapsed=${totalElapsed}ms, regions=${segmentation.regions.size}, palette=${palette.size}",
        )

        return PuzzleData(
            width = scaledWidth,
            height = scaledHeight,
            palette = palette,
            regions = segmentation.regions,
            regionMap = segmentation.regionMap,
            borderMap = segmentation.borderMap,
        )
    }
}

/**
 * Auto-detecting Puzzle Generator.
 * Analyzes the input image, determines if it is a DRAWING or PHOTO, resolves the optimal color count
 * based on PaletteDetail, and delegates to the appropriate generator implementation.
 */
class AutoPuzzleGenerator : PuzzleGenerator {

    override fun generate(
        bitmap: Bitmap,
        config: GeneratorConfig,
        onProgress: ((Float, String) -> Unit)?,
    ): PuzzleData {
        val tAuto0 = System.currentTimeMillis()
        CapyLogger.d(
            "CapyEngine",
            "AutoPuzzleGenerator.generate() START -> bitmap=${bitmap.width}x${bitmap.height}, config=[detail=${config.paletteDetail}, colors=${config.colorCount}, type=${config.imageType}]",
        )
        onProgress?.invoke(0.02f, "Analyzing image style and palette...")

        val tAnalyze0 = System.currentTimeMillis()
        val analysis = ImageAnalyzer.analyze(bitmap)
        val tAnalyze = System.currentTimeMillis() - tAnalyze0

        val resolvedType = if (config.imageType == ImageType.AUTO) {
            analysis.detectedType
        } else {
            config.imageType
        }

        val resolvedColors = analysis.resolveColorCount(config.paletteDetail, config.colorCount)
        CapyLogger.d(
            "CapyEngine",
            "AutoPuzzleGenerator analysis phase took ${tAnalyze}ms -> detectedType=$resolvedType (from ${analysis.detectedType}), resolvedColors=$resolvedColors",
        )

        val effectiveConfig = config.copy(
            imageType = resolvedType,
            colorCount = resolvedColors,
        )

        val delegate: PuzzleGenerator = when (resolvedType) {
            ImageType.DRAWING -> DrawingPuzzleGenerator()
            ImageType.PHOTO, ImageType.AUTO -> PhotoPuzzleGenerator()
        }

        val result = delegate.generate(bitmap, effectiveConfig, onProgress)
        CapyLogger.d(
            "CapyEngine",
            "AutoPuzzleGenerator.generate() FINISHED -> totalElapsed=${System.currentTimeMillis() - tAuto0}ms",
        )
        return result
    }
}

@Suppress("unused")
object PuzzleGeneratorFactory {
    fun create(type: ImageType = ImageType.AUTO): PuzzleGenerator {
        return when (type) {
            ImageType.AUTO -> AutoPuzzleGenerator()
            ImageType.DRAWING -> DrawingPuzzleGenerator()
            ImageType.PHOTO -> PhotoPuzzleGenerator()
        }
    }
}
