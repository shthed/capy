package com.capypaint.capy.data

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import com.capypaint.capy.util.CapyLogger
import java.util.Locale
import java.util.UUID
import androidx.compose.ui.graphics.Color
import com.capypaint.capy.engine.PaletteColor
import com.capypaint.capy.engine.PuzzleData
import com.capypaint.capy.engine.Region
import com.capypaint.capy.model.CanvasBgColor
import com.capypaint.capy.model.Difficulty
import com.capypaint.capy.model.GeneratorConfig
import com.capypaint.capy.model.GeneratorPreset
import com.capypaint.capy.model.HintFillStyle
import com.capypaint.capy.model.ImageType
import com.capypaint.capy.model.PaletteDetail
import com.capypaint.capy.model.PaletteSortOrder
import com.capypaint.capy.model.RegionColorMode
import com.capypaint.capy.model.RegionHighlightStyle
import com.capypaint.capy.model.SampleGallery
import com.capypaint.capy.model.SaveSortOrder
import com.capypaint.capy.model.SavedSnapshot
import com.capypaint.capy.model.ThemeMode
import com.capypaint.capy.model.UserSettings
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import kotlin.math.roundToInt
import androidx.core.graphics.scale
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream

private const val CAPY_BINARY_MAGIC = 0x43415059

data class ActiveGameState(
    val activeSnapshotId: String? = null,
    val filledRegionIds: Set<Int> = emptySet(),
    val activeColorId: Int = 1,
    val hasActivePuzzle: Boolean = false,
    val zoomScale: Float = 1.0f,
    val panOffsetX: Float = 0.0f,
    val panOffsetY: Float = 0.0f,
)

class GamePreferencesRepository(private val context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences("capy_settings", Context.MODE_PRIVATE)

    fun loadSettings(): UserSettings {
        val autoAdvance = prefs.getBoolean("auto_advance", true)
        val diffStr = prefs.getString("difficulty", Difficulty.EASY.name) ?: Difficulty.EASY.name
        val difficulty = try { Difficulty.valueOf(diffStr) } catch (_: Exception) { Difficulty.EASY }
        val isPaintMode = prefs.getBoolean("is_paint_mode", false)
        val raisePaletteDock = prefs.getBoolean("raise_palette_dock", true)
        val modeStr = prefs.getString("region_color_mode", RegionColorMode.DETAIL.name) ?: RegionColorMode.DETAIL.name
        val regionColorMode = try { RegionColorMode.valueOf(modeStr) } catch (_: Exception) { RegionColorMode.DETAIL }
        val showLabels = prefs.getBoolean("show_labels", true)
        val showPreviewLabels = prefs.getBoolean("show_preview_labels", true)
        val showPreviewBorders = prefs.getBoolean("show_preview_borders", true)
        val highlightMatching = prefs.getBoolean("highlight_matching", true)
        val animateHint = prefs.getBoolean("animate_hint", true)
        val hintIntensity = prefs.getFloat("hint_intensity", 0.65f)
        val labelScale = prefs.getFloat("label_scale", 1.0f)
        val sortStr = prefs.getString("palette_sort", PaletteSortOrder.NUMBER.name) ?: PaletteSortOrder.NUMBER.name
        val paletteSort = try { PaletteSortOrder.valueOf(sortStr) } catch (_: Exception) { PaletteSortOrder.NUMBER }
        val themeStr = prefs.getString("theme_mode", ThemeMode.DARK.name) ?: ThemeMode.DARK.name
        val themeMode = try { ThemeMode.valueOf(themeStr) } catch (_: Exception) { ThemeMode.DARK }

        val presetStr = prefs.getString("gen_preset", GeneratorPreset.MEDIUM.name) ?: GeneratorPreset.MEDIUM.name
        val preset = try { GeneratorPreset.valueOf(presetStr) } catch (_: Exception) { GeneratorPreset.MEDIUM }
        val detailStr = prefs.getString("gen_palette_detail", PaletteDetail.AUTO.name) ?: PaletteDetail.AUTO.name
        val paletteDetail = try { PaletteDetail.valueOf(detailStr) } catch (_: Exception) { PaletteDetail.AUTO }
        val imgTypeStr = prefs.getString("gen_image_type", ImageType.AUTO.name) ?: ImageType.AUTO.name
        val imageType = try { ImageType.valueOf(imgTypeStr) } catch (_: Exception) { ImageType.AUTO }

        val colorCount = prefs.getInt("gen_colors", 16)
        val minArea = prefs.getInt("gen_min_area", 35)
        val resolution = prefs.getInt("gen_resolution", GeneratorPreset.MEDIUM.resolution)
        val smoothing = prefs.getInt("gen_smoothing", 1)

        val bgStr = prefs.getString("canvas_bg_color", CanvasBgColor.BLACK.name) ?: CanvasBgColor.BLACK.name
        val defaultBgColor = try { CanvasBgColor.valueOf(bgStr) } catch (_: Exception) { CanvasBgColor.BLACK }
        val canvasBgArgb = prefs.getInt("canvas_bg_argb", defaultBgColor.argb)
        val canvasBgColor = CanvasBgColor.fromArgb(canvasBgArgb)
        val saveSortStr = prefs.getString("save_sort_order", SaveSortOrder.LAST_ACTIVE.name) ?: SaveSortOrder.LAST_ACTIVE.name
        val saveSortOrder = try { SaveSortOrder.valueOf(saveSortStr) } catch (_: Exception) { SaveSortOrder.LAST_ACTIVE }

        val showSavePreviews = prefs.getBoolean("show_save_previews", true)
        val styleStr = prefs.getString("highlight_style", RegionHighlightStyle.CENTROID_GLOW.name) ?: RegionHighlightStyle.CENTROID_GLOW.name
        val highlightStyle = try { RegionHighlightStyle.valueOf(styleStr) } catch (_: Exception) { RegionHighlightStyle.CENTROID_GLOW }
        val hintFillStyleStr = prefs.getString("hint_fill_style", HintFillStyle.CHECKER.name) ?: HintFillStyle.CHECKER.name
        val hintFillStyle = try { HintFillStyle.valueOf(hintFillStyleStr) } catch (_: Exception) { HintFillStyle.CHECKER }
        val hintColorArgb = prefs.getInt("hint_color_argb", 0xFFFBBF24.toInt())

        return UserSettings(
            autoAdvance = autoAdvance,
            difficulty = difficulty,
            isPaintMode = isPaintMode,
            raisePaletteDock = raisePaletteDock,
            regionColorMode = regionColorMode,
            canvasBgColor = canvasBgColor,
            canvasBgArgb = canvasBgArgb,
            saveSortOrder = saveSortOrder,
            showSavePreviews = showSavePreviews,
            highlightStyle = highlightStyle,
            hintFillStyle = hintFillStyle,
            hintColorArgb = hintColorArgb,
            showRegionLabels = showLabels,
            showPreviewLabels = showPreviewLabels,
            showPreviewBorders = showPreviewBorders,
            highlightMatching = highlightMatching,
            animateHint = animateHint,
            showNextRegionHint = prefs.getBoolean("show_next_region_hint", true),
            hintIntensity = hintIntensity,
            labelScale = labelScale,
            showZoomButtons = prefs.getBoolean("show_zoom_buttons", false),
            paletteSort = paletteSort,
            prioritizeOnScreen = prefs.getBoolean("prioritize_onscreen", true),
            themeMode = themeMode,
            generatorConfig = GeneratorConfig(
                preset = preset,
                paletteDetail = paletteDetail,
                imageType = imageType,
                colorCount = colorCount,
                minRegionArea = minArea,
                resolution = resolution,
                smoothingPasses = smoothing,
            ),
        )
    }

    fun saveSettings(settings: UserSettings) {
        prefs.edit {
            putBoolean("auto_advance", settings.autoAdvance)
            putString("difficulty", settings.difficulty.name)
            putBoolean("is_paint_mode", settings.isPaintMode)
            putBoolean("raise_palette_dock", settings.raisePaletteDock)
            putString("region_color_mode", settings.regionColorMode.name)
            putString("canvas_bg_color", settings.canvasBgColor.name)
            putInt("canvas_bg_argb", settings.canvasBgArgb)
            putString("save_sort_order", settings.saveSortOrder.name)
            putBoolean("show_save_previews", settings.showSavePreviews)
            putString("highlight_style", settings.highlightStyle.name)
            putString("hint_fill_style", settings.hintFillStyle.name)
            putInt("hint_color_argb", settings.hintColorArgb)
            putBoolean("show_labels", settings.showRegionLabels)
            putBoolean("show_preview_labels", settings.showPreviewLabels)
            putBoolean("show_preview_borders", settings.showPreviewBorders)
            putBoolean("highlight_matching", settings.highlightMatching)
            putBoolean("animate_hint", settings.animateHint)
            putBoolean("show_next_region_hint", settings.showNextRegionHint)
            putFloat("hint_intensity", settings.hintIntensity)
            putFloat("label_scale", settings.labelScale)
            putBoolean("show_zoom_buttons", settings.showZoomButtons)
            putString("palette_sort", settings.paletteSort.name)
            putBoolean("prioritize_onscreen", settings.prioritizeOnScreen)
            putString("theme_mode", settings.themeMode.name)
            putString("gen_preset", settings.generatorConfig.preset.name)
            putString("gen_palette_detail", settings.generatorConfig.paletteDetail.name)
            putString("gen_image_type", settings.generatorConfig.imageType.name)
            putInt("gen_colors", settings.generatorConfig.colorCount)
            putInt("gen_min_area", settings.generatorConfig.minRegionArea)
            putInt("gen_resolution", settings.generatorConfig.resolution)
            putInt("gen_smoothing", settings.generatorConfig.smoothingPasses)
        }
    }

    fun loadSnapshots(): List<SavedSnapshot> {
        val jsonStr = prefs.getString("saved_snapshots", "[]") ?: "[]"
        val list = mutableListOf<SavedSnapshot>()
        try {
            val array = JSONArray(jsonStr)
            for (i in 0 until array.length()) {
                val obj = array.getJSONObject(i)
                val id = obj.optString("id", "").takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString()
                val title = obj.optString("title", "Snapshot")
                val timestamp = obj.optLong("timestamp", 0L)
                val lastOpened = obj.optLong("lastOpened", timestamp)
                val filledCount = obj.optInt("filledCount", 0)
                val totalCount = obj.optInt("totalCount", 0)
                val idsArray = obj.optJSONArray("filledRegionIds") ?: JSONArray()
                val filledSet = mutableSetOf<Int>()
                for (j in 0 until idsArray.length()) {
                    filledSet.add(idsArray.getInt(j))
                }
                val isAutoSample = obj.optBoolean("isAutoSample", false)
                val sampleAssetPath = obj.optString("sampleAssetPath", "").takeIf { it.isNotEmpty() }
                val zoomScale = obj.optDouble("zoomScale", 1.0).toFloat()
                val panOffsetX = obj.optDouble("panOffsetX", 0.0).toFloat()
                val panOffsetY = obj.optDouble("panOffsetY", 0.0).toFloat()
                list.add(
                    SavedSnapshot(
                        id = id,
                        title = title,
                        timestamp = timestamp,
                        lastOpened = lastOpened,
                        filledCount = filledCount,
                        totalCount = totalCount,
                        filledRegionIds = filledSet,
                        isAutoSample = isAutoSample,
                        sampleAssetPath = sampleAssetPath,
                        zoomScale = zoomScale,
                        panOffsetX = panOffsetX,
                        panOffsetY = panOffsetY,
                    ),
                )
            }
        } catch (_: Exception) {}

        // Ensure all built-in sample gallery artworks appear as pre-created save slots
        val sampleDefaults = SampleGallery.samples.map { sample ->
            SavedSnapshot(
                id = sample.id,
                title = sample.title,
                timestamp = System.currentTimeMillis(),
                lastOpened = 0L,
                filledCount = 0,
                totalCount = 100,
                filledRegionIds = emptySet(),
                isAutoSample = true,
                sampleAssetPath = sample.assetPath,
            )
        }

        for (defaultSample in sampleDefaults) {
            if (list.none { (it.id == defaultSample.id) || it.title.equals(defaultSample.title, ignoreCase = true) }) {
                list.add(defaultSample)
            }
        }

        return list.asSequence().distinctBy { it.id }.sortedByDescending { it.lastOpened }.toList()
    }

    fun saveSnapshots(snapshots: List<SavedSnapshot>) {
        val array = JSONArray()
        for (snap in snapshots.distinctBy { it.id }) {
            val obj = JSONObject().apply {
                put("id", snap.id)
                put("title", snap.title)
                put("timestamp", snap.timestamp)
                put("lastOpened", snap.lastOpened)
                put("filledCount", snap.filledCount)
                put("totalCount", snap.totalCount)
                put("isAutoSample", snap.isAutoSample)
                snap.sampleAssetPath?.let { put("sampleAssetPath", it) }
                put("zoomScale", snap.zoomScale.toDouble())
                put("panOffsetX", snap.panOffsetX.toDouble())
                put("panOffsetY", snap.panOffsetY.toDouble())
                val idsArray = JSONArray()
                snap.filledRegionIds.forEach { idsArray.put(it) }
                put("filledRegionIds", idsArray)
            }
            array.put(obj)
        }
        prefs.edit { putString("saved_snapshots", array.toString()) }
    }

    fun addSnapshot(snapshot: SavedSnapshot): List<SavedSnapshot> {
        val current = loadSnapshots().asSequence().filterNot { it.id == snapshot.id }.toMutableList()
        current.add(0, snapshot)
        saveSnapshots(current)
        CapyLogger.d("CapyRepo", "addSnapshot() -> id='${snapshot.id}', title='${snapshot.title}', totalSnapshots=${current.size}")
        return current
    }

    fun renameSnapshot(id: String, newTitle: String): List<SavedSnapshot> {
        val current = loadSnapshots().map {
            if (it.id == id) it.copy(title = newTitle) else it
        }
        saveSnapshots(current)
        return current
    }

    fun updateSnapshotProgress(
        id: String,
        filledCount: Int,
        totalCount: Int,
        filledRegionIds: Set<Int>,
        zoomScale: Float? = null,
        panOffsetX: Float? = null,
        panOffsetY: Float? = null,
    ): List<SavedSnapshot> {
        val snapshots = loadSnapshots().toMutableList()
        val index = snapshots.indexOfFirst { it.id == id }
        if (index >= 0) {
            val existing = snapshots[index]
            val newZoom = zoomScale ?: existing.zoomScale
            val newPanX = panOffsetX ?: existing.panOffsetX
            val newPanY = panOffsetY ?: existing.panOffsetY
            snapshots[index] = existing.copy(
                filledCount = filledCount,
                totalCount = totalCount,
                filledRegionIds = filledRegionIds,
                lastOpened = System.currentTimeMillis(),
                zoomScale = newZoom,
                panOffsetX = newPanX,
                panOffsetY = newPanY,
            )
            saveSnapshots(snapshots)
            CapyLogger.d(
                "CapyRepo",
                "updateSnapshotProgress() -> id='$id', filledCount=$filledCount/$totalCount, viewExtent=[scale=%.3f, panX=%.1f, panY=%.1f]".format(
                    Locale.US, newZoom, newPanX, newPanY,
                ),
            )
        }
        return snapshots
    }

    fun deleteSnapshot(id: String): List<SavedSnapshot> {
        val updated = loadSnapshots().filterNot { it.id == id }
        saveSnapshots(updated)
        return updated
    }

    fun clearAllSnapshots() {
        prefs.edit { remove("saved_snapshots") }
    }

    @Suppress("DEPRECATION")
    private val webpCompressFormat: Bitmap.CompressFormat
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Bitmap.CompressFormat.WEBP_LOSSY
        } else {
            Bitmap.CompressFormat.WEBP
        }

    fun saveActiveImageBitmap(bitmap: Bitmap) {
        try {
            val fileWebp = File(context.filesDir, "active_puzzle_source.webp")
            val filePng = File(context.filesDir, "active_puzzle_source.png")
            if (filePng.exists()) try { filePng.delete() } catch (_: Exception) {}
            FileOutputStream(fileWebp).use { out ->
                bitmap.compress(webpCompressFormat, 85, out)
            }
        } catch (_: Exception) {}
    }

    fun loadActiveImageBitmap(): Bitmap? {
        return try {
            val fileWebp = File(context.filesDir, "active_puzzle_source.webp")
            if (fileWebp.exists()) {
                val bmp = BitmapFactory.decodeFile(fileWebp.absolutePath)
                if (bmp != null) return bmp
            }
            val filePng = File(context.filesDir, "active_puzzle_source.png")
            if (filePng.exists()) {
                BitmapFactory.decodeFile(filePng.absolutePath)
            } else null
        } catch (_: Exception) {
            null
        }
    }

    fun saveActiveGameState(state: ActiveGameState) {
        val obj = JSONObject().apply {
            put("hasActivePuzzle", state.hasActivePuzzle)
            put("activeSnapshotId", state.activeSnapshotId ?: "")
            put("activeColorId", state.activeColorId)
            put("zoomScale", state.zoomScale.toDouble())
            put("panOffsetX", state.panOffsetX.toDouble())
            put("panOffsetY", state.panOffsetY.toDouble())
            val idsArray = JSONArray()
            state.filledRegionIds.forEach { idsArray.put(it) }
            put("filledRegionIds", idsArray)
        }
        prefs.edit { putString("active_game_state", obj.toString()) }
        CapyLogger.d(
            "CapySave",
            "saveActiveGameState() -> activeSnapId='${state.activeSnapshotId}', filledCount=${state.filledRegionIds.size}, viewExtent=[scale=%.3f, panX=%.1f, panY=%.1f]".format(
                Locale.US, state.zoomScale, state.panOffsetX, state.panOffsetY,
            ),
        )
    }

    fun loadActiveGameState(): ActiveGameState? {
        val jsonStr = prefs.getString("active_game_state", null) ?: return null
        return try {
            val obj = JSONObject(jsonStr)
            val hasActive = obj.optBoolean("hasActivePuzzle", false)
            if (!hasActive) return null
            val activeSnapId = obj.optString("activeSnapshotId", "").takeIf { it.isNotEmpty() }
            val activeColorId = obj.optInt("activeColorId", 1)
            val zoomScale = obj.optDouble("zoomScale", 1.0).toFloat()
            val panOffsetX = obj.optDouble("panOffsetX", 0.0).toFloat()
            val panOffsetY = obj.optDouble("panOffsetY", 0.0).toFloat()
            val idsArray = obj.optJSONArray("filledRegionIds") ?: JSONArray()
            val filledSet = mutableSetOf<Int>()
            for (i in 0 until idsArray.length()) {
                filledSet.add(idsArray.getInt(i))
            }
            ActiveGameState(
                activeSnapshotId = activeSnapId,
                filledRegionIds = filledSet,
                activeColorId = activeColorId,
                hasActivePuzzle = true,
                zoomScale = zoomScale,
                panOffsetX = panOffsetX,
                panOffsetY = panOffsetY,
            )
        } catch (_: Exception) {
            null
        }
    }

    fun getSnapshotFileSize(snapshotId: String): Long {
        var size = 0L
        try {
            val f1Webp = File(context.filesDir, "puzzle_source_$snapshotId.webp")
            if (f1Webp.exists()) size += f1Webp.length()
            val f1Png = File(context.filesDir, "puzzle_source_$snapshotId.png")
            if (f1Png.exists()) size += f1Png.length()

            val f2 = File(context.filesDir, "puzzle_data_$snapshotId.bin")
            if (f2.exists()) size += f2.length()
            val f3 = File(context.filesDir, "puzzle_data_$snapshotId.json")
            if (f3.exists()) size += f3.length()

            val f4Webp = File(context.filesDir, "puzzle_preview_$snapshotId.webp")
            if (f4Webp.exists()) size += f4Webp.length()
            val f4Png = File(context.filesDir, "puzzle_preview_$snapshotId.png")
            if (f4Png.exists()) size += f4Png.length()
        } catch (_: Exception) {}
        return size
    }

    fun savePuzzlePreviewForSnapshot(snapshotId: String, previewBitmap: Bitmap) {
        try {
            val fileWebp = File(context.filesDir, "puzzle_preview_$snapshotId.webp")
            val filePng = File(context.filesDir, "puzzle_preview_$snapshotId.png")
            if (filePng.exists()) try { filePng.delete() } catch (_: Exception) {}

            val maxDim = 300
            val width = previewBitmap.width
            val height = previewBitmap.height
            val scaled = if ((width > 0) && (height > 0)) {
                val scale = maxDim.toFloat() / maxOf(width, height)
                if (scale < 1.0f) {
                    val targetW = (width * scale).roundToInt().coerceAtLeast(1)
                    val targetH = (height * scale).roundToInt().coerceAtLeast(1)
                    previewBitmap.scale(targetW, targetH)
                } else {
                    previewBitmap
                }
            } else {
                previewBitmap
            }
            FileOutputStream(fileWebp).use { out ->
                scaled.compress(webpCompressFormat, 80, out)
            }
            if (scaled != previewBitmap) {
                scaled.recycle()
            }
        } catch (_: Exception) {}
    }

    fun loadPuzzlePreviewForSnapshot(snapshotId: String): Bitmap? {
        return try {
            val fileWebp = File(context.filesDir, "puzzle_preview_$snapshotId.webp")
            if (fileWebp.exists()) {
                val bmp = BitmapFactory.decodeFile(fileWebp.absolutePath)
                if (bmp != null) return bmp
            }
            val filePng = File(context.filesDir, "puzzle_preview_$snapshotId.png")
            if (filePng.exists()) {
                BitmapFactory.decodeFile(filePng.absolutePath)
            } else null
        } catch (_: Exception) {
            null
        }
    }

    @Suppress("unused")
    fun clearActiveGameState() {
        prefs.edit { remove("active_game_state") }
        try {
            File(context.filesDir, "active_puzzle_source.webp").takeIf { it.exists() }?.delete()
            File(context.filesDir, "active_puzzle_source.png").takeIf { it.exists() }?.delete()
            File(context.filesDir, "active_puzzle_data.bin").takeIf { it.exists() }?.delete()
            File(context.filesDir, "active_puzzle_data.json").takeIf { it.exists() }?.delete()
        } catch (_: Exception) {}
    }

    fun saveActivePuzzleData(puzzle: PuzzleData) {
        val file = File(context.filesDir, "active_puzzle_data.bin")
        savePuzzleDataToBinaryFile(puzzle, file)
    }

    fun loadActivePuzzleData(): PuzzleData? {
        val binFile = File(context.filesDir, "active_puzzle_data.bin")
        if (binFile.exists()) {
            val data = loadPuzzleDataFromBinaryFile(binFile)
            data?.let { return it }
        }
        val jsonFile = File(context.filesDir, "active_puzzle_data.json")
        return if (jsonFile.exists()) loadPuzzleDataFromJsonFile(jsonFile) else null
    }

    fun savePuzzleBitmapForSnapshot(snapshotId: String, bitmap: Bitmap, isSample: Boolean = false) {
        val t0 = System.currentTimeMillis()
        val fileWebp = File(context.filesDir, "puzzle_source_$snapshotId.webp")
        val filePng = File(context.filesDir, "puzzle_source_$snapshotId.png")

        val snapshots = loadSnapshots()
        val snap = snapshots.find { it.id == snapshotId }
        val targetTitle = snap?.title ?: snapshotId

        val isSampleItem = isSample || ((snap != null) && snap.isAutoSample) || SampleGallery.samples.any {
            it.id.equals(snapshotId, ignoreCase = true) || it.title.equals(targetTitle, ignoreCase = true)
        }

        if (isSampleItem) {
            if (fileWebp.exists()) try { fileWebp.delete() } catch (_: Exception) {}
            if (filePng.exists()) try { filePng.delete() } catch (_: Exception) {}
            CapyLogger.d("CapyRepo", "savePuzzleBitmapForSnapshot() -> Skipped saving source bitmap for sample '$snapshotId' (reusing asset)")
            return
        }

        try {
            if (filePng.exists()) try { filePng.delete() } catch (_: Exception) {}
            FileOutputStream(fileWebp).use { out ->
                bitmap.compress(webpCompressFormat, 85, out)
            }
            val elapsed = System.currentTimeMillis() - t0
            CapyLogger.d(
                "CapyRepo",
                "savePuzzleBitmapForSnapshot() -> Saved WebP source bitmap for '$snapshotId' (${bitmap.width}x${bitmap.height}) in ${elapsed}ms (${fileWebp.length()} bytes)",
            )
        } catch (e: Exception) {
            CapyLogger.e("CapyRepo", "savePuzzleBitmapForSnapshot() -> Failed to save WebP bitmap for '$snapshotId'", e)
        }
    }

    fun loadPuzzleBitmapForSnapshot(snapshotId: String, title: String? = null): Bitmap? {
        val t0 = System.currentTimeMillis()
        return try {
            val snapshots = loadSnapshots()
            val snap = snapshots.find { it.id.equals(snapshotId, ignoreCase = true) || it.title.equals(snapshotId, ignoreCase = true) }
            val targetTitle = title ?: snap?.title ?: snapshotId

            val sample = SampleGallery.samples.find { s ->
                s.id.equals(snapshotId, ignoreCase = true) ||
                s.title.equals(snapshotId, ignoreCase = true) ||
                s.id.equals(targetTitle, ignoreCase = true) ||
                s.title.equals(targetTitle, ignoreCase = true) ||
                ((snap != null) && (s.id.equals(snap.id, ignoreCase = true) || s.title.equals(snap.title, ignoreCase = true)))
            }
            if (sample != null) {
                // Delete duplicate source bitmap files on disk if any exist from previous versions
                File(context.filesDir, "puzzle_source_$snapshotId.webp").takeIf { it.exists() }?.delete()
                File(context.filesDir, "puzzle_source_$snapshotId.png").takeIf { it.exists() }?.delete()
                return try {
                    context.assets.open(sample.assetPath).use { stream ->
                        val options = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 }
                        val bmp = BitmapFactory.decodeStream(stream, null, options)
                        if (bmp != null) {
                            val elapsed = System.currentTimeMillis() - t0
                            CapyLogger.d(
                                "CapyRepo",
                                "loadPuzzleBitmapForSnapshot() -> Loaded bitmap from sample asset '${sample.assetPath}' for '$targetTitle' in ${elapsed}ms (${bmp.width}x${bmp.height})",
                            )
                            return bmp
                        }
                    }
                    null
                } catch (e: Exception) {
                    CapyLogger.e("CapyRepo", "Failed to load sample asset '${sample.assetPath}'", e)
                    null
                }
            }

            val fileWebp = File(context.filesDir, "puzzle_source_$snapshotId.webp")
            if (fileWebp.exists()) {
                val bmp = BitmapFactory.decodeFile(fileWebp.absolutePath)
                if (bmp != null) {
                    val elapsed = System.currentTimeMillis() - t0
                    CapyLogger.d(
                        "CapyRepo",
                        "loadPuzzleBitmapForSnapshot() -> Loaded WebP bitmap from file for '$snapshotId' (${bmp.width}x${bmp.height}) in ${elapsed}ms (${fileWebp.length()} bytes)",
                    )
                    return bmp
                }
            }
            val filePng = File(context.filesDir, "puzzle_source_$snapshotId.png")
            if (filePng.exists()) {
                val bmp = BitmapFactory.decodeFile(filePng.absolutePath)
                if (bmp != null) {
                    val elapsed = System.currentTimeMillis() - t0
                    CapyLogger.d(
                        "CapyRepo",
                        "loadPuzzleBitmapForSnapshot() -> Loaded PNG bitmap from file for '$snapshotId' (${bmp.width}x${bmp.height}) in ${elapsed}ms (${filePng.length()} bytes)",
                    )
                    return bmp
                }
            }
            CapyLogger.w("CapyRepo", "loadPuzzleBitmapForSnapshot() -> No bitmap file or sample asset found for '$snapshotId' (title='$targetTitle')")
            null
        } catch (e: Exception) {
            CapyLogger.e("CapyRepo", "loadPuzzleBitmapForSnapshot() -> Error loading bitmap for '$snapshotId'", e)
            null
        }
    }

    fun savePuzzleDataForSnapshot(snapshotId: String, puzzle: PuzzleData) {
        val file = File(context.filesDir, "puzzle_data_$snapshotId.bin")
        savePuzzleDataToBinaryFile(puzzle, file)
    }

    fun loadPuzzleDataForSnapshot(snapshotId: String): PuzzleData? {
        val binFile = File(context.filesDir, "puzzle_data_$snapshotId.bin")
        if (binFile.exists()) {
            val data = loadPuzzleDataFromBinaryFile(binFile)
            data?.let { return it }
        }
        val jsonFile = File(context.filesDir, "puzzle_data_$snapshotId.json")
        return if (jsonFile.exists()) loadPuzzleDataFromJsonFile(jsonFile) else null
    }

    @Suppress("unused")
    fun deletePuzzleFilesForSnapshot(snapshotId: String) {
        try {
            val file1 = File(context.filesDir, "puzzle_source_$snapshotId.png")
            if (file1.exists()) file1.delete()
            val file2 = File(context.filesDir, "puzzle_data_$snapshotId.bin")
            if (file2.exists()) file2.delete()
            val file3 = File(context.filesDir, "puzzle_data_$snapshotId.json")
            if (file3.exists()) file3.delete()
            val file4 = File(context.filesDir, "puzzle_preview_$snapshotId.png")
            if (file4.exists()) file4.delete()
        } catch (_: Exception) {}
    }

    private fun savePuzzleDataToBinaryFile(puzzle: PuzzleData, file: File) {
        val t0 = System.currentTimeMillis()
        try {
            FileOutputStream(file).use { outputStream ->
                DataOutputStream(GZIPOutputStream(BufferedOutputStream(outputStream))).use { out ->
                    out.writeInt(CAPY_BINARY_MAGIC)
                    out.writeInt(3) // Version 3: Omit redundant region.pixels array

                    out.writeInt(puzzle.width)
                    out.writeInt(puzzle.height)

                    // Palette
                    out.writeInt(puzzle.palette.size)
                    for (pal in puzzle.palette) {
                        out.writeInt(pal.id)
                        out.writeInt(pal.argb)
                        out.writeBoolean(pal.isLight)
                        out.writeUTF(pal.hex)
                    }

                    // Regions (Metadata only; pixels reconstructed from regionMap on load)
                    out.writeInt(puzzle.regions.size)
                    for (reg in puzzle.regions) {
                        out.writeInt(reg.id)
                        out.writeInt(reg.colorId)
                        out.writeFloat(reg.centroidX)
                        out.writeFloat(reg.centroidY)
                        out.writeInt(reg.area)
                        out.writeInt(reg.minX)
                        out.writeInt(reg.maxX)
                        out.writeInt(reg.minY)
                        out.writeInt(reg.maxY)
                    }

                    // Region Map
                    out.writeInt(puzzle.regionMap.size)
                    for (r in puzzle.regionMap) {
                        out.writeInt(r)
                    }

                    // Border Map (Bit-packed)
                    val borderSize = puzzle.borderMap.size
                    out.writeInt(borderSize)
                    val borderBytes = ByteArray((borderSize + 7) / 8)
                    for (i in 0 until borderSize) {
                        if (puzzle.borderMap[i]) {
                            borderBytes[i / 8] = (borderBytes[i / 8].toInt() or (1 shl (i % 8))).toByte()
                        }
                    }
                    out.write(borderBytes)
                    out.flush()
                }
            }
            val elapsed = System.currentTimeMillis() - t0
            CapyLogger.d(
                "CapySave",
                "savePuzzleDataToBinaryFile() -> Saved Version 3 GZIP binary snapshot in ${elapsed}ms (${file.length()} bytes, regions=${puzzle.regions.size}, palette=${puzzle.palette.size})",
            )
        } catch (e: Exception) {
            CapyLogger.e("CapySave", "savePuzzleDataToBinaryFile() -> Failed to write binary file", e)
        }
    }

    private fun loadPuzzleDataFromBinaryFile(file: File): PuzzleData? {
        val t0 = System.currentTimeMillis()
        return try {
            var parseTime = 0L
            var reconstructTime = 0L
            val puzzle = FileInputStream(file).use { inputStream ->
                DataInputStream(GZIPInputStream(BufferedInputStream(inputStream))).use { input ->
                    val magic = input.readInt()
                    if (magic != CAPY_BINARY_MAGIC) return null
                    val version = input.readInt()

                    val width = input.readInt()
                    val height = input.readInt()

                    val paletteSize = input.readInt()
                    val palette = ArrayList<PaletteColor>(paletteSize)
                    repeat(paletteSize) {
                        val id = input.readInt()
                        val argb = input.readInt()
                        val isLight = input.readBoolean()
                        val hex = input.readUTF()
                        palette.add(PaletteColor(id, Color(argb), hex, isLight, argb))
                    }

                    val regionsSize = input.readInt()
                    val tempRegions = ArrayList<TempRegionModel>(regionsSize)
                    repeat(regionsSize) {
                        val id = input.readInt()
                        val colorId = input.readInt()
                        val centroidX = input.readFloat()
                        val centroidY = input.readFloat()
                        val area = input.readInt()
                        val minX = input.readInt()
                        val maxX = input.readInt()
                        val minY = input.readInt()
                        val maxY = input.readInt()

                        val pxArray = if (version < 3) {
                            val pxCount = input.readInt()
                            IntArray(pxCount) { input.readInt() }
                        } else {
                            IntArray(0)
                        }
                        tempRegions.add(TempRegionModel(id, colorId, centroidX, centroidY, area, minX, maxX, minY, maxY, pxArray))
                    }

                    val rMapSize = input.readInt()
                    val regionMap = IntArray(rMapSize)
                    for (i in 0 until rMapSize) {
                        regionMap[i] = input.readInt()
                    }

                    val bMapSize = input.readInt()
                    val borderMap = BooleanArray(bMapSize)
                    if (version >= 2) {
                        val borderBytes = ByteArray((bMapSize + 7) / 8)
                        input.readFully(borderBytes)
                        for (i in 0 until bMapSize) {
                            borderMap[i] = (borderBytes[i / 8].toInt() and (1 shl (i % 8))) != 0
                        }
                    } else {
                        for (i in 0 until bMapSize) {
                            borderMap[i] = input.readBoolean()
                        }
                    }

                    parseTime = System.currentTimeMillis() - t0

                    // Reconstruct region.pixels from regionMap for version 3+
                    val tReconstruct0 = System.currentTimeMillis()
                    val regions = ArrayList<Region>(regionsSize)
                    if (version >= 3) {
                        val pixelLists = HashMap<Int, IntArrayList>()
                        for (i in 0 until rMapSize) {
                            val rid = regionMap[i]
                            if (rid > 0) {
                                var list = pixelLists[rid]
                                if (list == null) {
                                    list = IntArrayList()
                                    pixelLists[rid] = list
                                }
                                list.add(i)
                            }
                        }
                        for (t in tempRegions) {
                            val pxList = pixelLists[t.id]
                            val pxArr = pxList?.toArray() ?: IntArray(0)
                            regions.add(Region(id = t.id, colorId = t.colorId, centroidX = t.centroidX, centroidY = t.centroidY, area = t.area, minX = t.minX, maxX = t.maxX, minY = t.minY, maxY = t.maxY, pixels = pxArr))
                        }
                    } else {
                        for (t in tempRegions) {
                            regions.add(Region(id = t.id, colorId = t.colorId, centroidX = t.centroidX, centroidY = t.centroidY, area = t.area, minX = t.minX, maxX = t.maxX, minY = t.minY, maxY = t.maxY, pixels = t.pixels))
                        }
                    }
                    reconstructTime = System.currentTimeMillis() - tReconstruct0

                    PuzzleData(width, height, palette, regions, regionMap, borderMap)
                }
            }

            val totalElapsed = System.currentTimeMillis() - t0
            CapyLogger.d(
                "CapySave",
                "loadPuzzleDataFromBinaryFile() -> Loaded Version 3 binary snapshot in ${totalElapsed}ms (parse=${parseTime}ms, reconstruct=${reconstructTime}ms, regions=${puzzle.regions.size}, size=${file.length()} bytes)",
            )
            puzzle
        } catch (e: Exception) {
            CapyLogger.e("CapySave", "loadPuzzleDataFromBinaryFile() -> Error reading binary snapshot", e)
            null
        }
    }

    private fun loadPuzzleDataFromJsonFile(file: File): PuzzleData? {
        return try {
            val jsonStr = file.readText(Charsets.UTF_8)
            val obj = JSONObject(jsonStr)
            val width = obj.getInt("width")
            val height = obj.getInt("height")

            val palArray = obj.getJSONArray("palette")
            val palette = mutableListOf<PaletteColor>()
            for (i in 0 until palArray.length()) {
                val palObj = palArray.getJSONObject(i)
                val id = palObj.getInt("id")
                val hex = palObj.getString("hex")
                val isLight = palObj.getBoolean("isLight")
                val argb = palObj.getInt("argb")
                palette.add(PaletteColor(id, Color(argb), hex, isLight, argb))
            }

            val regArray = obj.getJSONArray("regions")
            val regions = mutableListOf<Region>()
            for (i in 0 until regArray.length()) {
                val regObj = regArray.getJSONObject(i)
                val id = regObj.getInt("id")
                val colorId = regObj.getInt("colorId")
                val centroidX = regObj.getDouble("centroidX").toFloat()
                val centroidY = regObj.getDouble("centroidY").toFloat()
                val area = regObj.getInt("area")
                val minX = regObj.getInt("minX")
                val maxX = regObj.getInt("maxX")
                val minY = regObj.getInt("minY")
                val maxY = regObj.getInt("maxY")
                val pxArray = regObj.getJSONArray("pixels")
                val pixels = IntArray(pxArray.length()) { j -> pxArray.getInt(j) }
                regions.add(Region(id = id, colorId = colorId, centroidX = centroidX, centroidY = centroidY, area = area, minX = minX, maxX = maxX, minY = minY, maxY = maxY, pixels = pixels))
            }

            val rMapArray = obj.getJSONArray("regionMap")
            val regionMap = IntArray(rMapArray.length()) { i -> rMapArray.getInt(i) }

            val bMapArray = obj.getJSONArray("borderMap")
            val borderMap = BooleanArray(bMapArray.length()) { i -> bMapArray.getBoolean(i) }

            PuzzleData(width, height, palette, regions, regionMap, borderMap)
        } catch (_: Exception) {
            null
        }
    }
}

private class IntArrayList(initialCapacity: Int = 32) {
    var data = IntArray(initialCapacity)
    var size = 0

    fun add(element: Int) {
        if (size == data.size) {
            data = data.copyOf(data.size * 2)
        }
        data[size++] = element
    }

    fun toArray(): IntArray {
        return data.copyOf(size)
    }
}

private data class TempRegionModel(
    val id: Int,
    val colorId: Int,
    val centroidX: Float,
    val centroidY: Float,
    val area: Int,
    val minX: Int,
    val maxX: Int,
    val minY: Int,
    val maxY: Int,
    val pixels: IntArray,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false
        other as TempRegionModel
        return (id == other.id) &&
                (colorId == other.colorId) &&
                (centroidX == other.centroidX) &&
                (centroidY == other.centroidY) &&
                (area == other.area) &&
                (minX == other.minX) &&
                (maxX == other.maxX) &&
                (minY == other.minY) &&
                (maxY == other.maxY) &&
                pixels.contentEquals(other.pixels)
    }

    override fun hashCode(): Int {
        var result = id
        result = (31 * result) + colorId
        result = (31 * result) + centroidX.hashCode()
        result = (31 * result) + centroidY.hashCode()
        result = (31 * result) + area
        result = (31 * result) + minX
        result = (31 * result) + maxX
        result = (31 * result) + minY
        result = (31 * result) + maxY
        result = (31 * result) + pixels.contentHashCode()
        return result
    }
}
