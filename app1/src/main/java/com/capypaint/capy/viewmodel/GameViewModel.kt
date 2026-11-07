package com.capypaint.capy.viewmodel

import android.app.Application
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.core.graphics.createBitmap
import androidx.core.graphics.scale
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.capypaint.capy.data.ActiveGameState
import com.capypaint.capy.data.GamePreferencesRepository
import com.capypaint.capy.engine.AutoPuzzleGenerator
import com.capypaint.capy.engine.PuzzleData
import com.capypaint.capy.model.Difficulty
import com.capypaint.capy.model.GeneratorConfig
import com.capypaint.capy.model.RegionColorMode
import com.capypaint.capy.model.SampleArtwork
import com.capypaint.capy.model.SampleGallery
import com.capypaint.capy.model.SavedSnapshot
import com.capypaint.capy.model.UserSettings
import com.capypaint.capy.ui.components.getDockPalette
import com.capypaint.capy.ui.components.getVisiblePalette
import com.capypaint.capy.util.CapyLogger
import java.util.Locale
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class GameUiState(
    val isLoading: Boolean = false,
    val loadingProgress: Float = 0f,
    val loadingStatus: String = "Loading...",
    val puzzle: PuzzleData? = null,
    val activeColorId: Int = 1,
    val filledRegionIds: Set<Int> = emptySet(),
    val hintRegionId: Int? = null,
    val isPreviewMode: Boolean = false,
    val isPaintMode: Boolean = false,
    val originalBitmap: Bitmap? = null,
    val previewBitmap: Bitmap? = null,
    val displayBitmap: Bitmap? = null,
    val bitmapRevision: Int = 0,
    val isCompleted: Boolean = false,
    val resetZoomTrigger: Int = 0,
    val zoomInTrigger: Int = 0,
    val zoomOutTrigger: Int = 0,
    val zoomScale: Float = 1.0f,
    val panOffsetX: Float = 0.0f,
    val panOffsetY: Float = 0.0f,
)

class GameViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = GamePreferencesRepository(application)

    private val _settings = MutableStateFlow(repository.loadSettings())
    val settings: StateFlow<UserSettings> = _settings.asStateFlow()

    private val _snapshots = MutableStateFlow(repository.loadSnapshots())
    val snapshots: StateFlow<List<SavedSnapshot>> = _snapshots.asStateFlow()

    private val _uiState = MutableStateFlow(GameUiState())
    val uiState: StateFlow<GameUiState> = _uiState.asStateFlow()

    private var currentPixels: IntArray = IntArray(0)
    private var originalPixels: IntArray = IntArray(0)
    var activeSnapshotId: String? = null
        private set
    private var generationJob: Job? = null

    private data class GeneratedPuzzleBundle(
        val puzzle: PuzzleData,
        val displayBitmap: Bitmap,
        val previewBitmap: Bitmap,
        val pixels: IntArray,
        val origPixels: IntArray,
    ) {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (javaClass != other?.javaClass) return false
            other as GeneratedPuzzleBundle
            return (puzzle == other.puzzle) &&
                    (displayBitmap == other.displayBitmap) &&
                    (previewBitmap == other.previewBitmap) &&
                    pixels.contentEquals(other.pixels) &&
                    origPixels.contentEquals(other.origPixels)
        }

        override fun hashCode(): Int {
            var result = puzzle.hashCode()
            result = (31 * result) + displayBitmap.hashCode()
            result = (31 * result) + previewBitmap.hashCode()
            result = (31 * result) + pixels.contentHashCode()
            result = (31 * result) + origPixels.contentHashCode()
            return result
        }
    }

    init {
        _uiState.update { it.copy(isPaintMode = _settings.value.isPaintMode) }
        val initialSnapshots = repository.loadSnapshots()
        val activeState = repository.loadActiveGameState()
        if (activeState?.activeSnapshotId != null) {
            activeSnapshotId = activeState.activeSnapshotId
        }
        _snapshots.value = sortSnapshots(initialSnapshots)
    }

    fun updateSettings(newSettings: UserSettings) {
        val oldColorMode = _settings.value.regionColorMode
        _settings.value = newSettings
        _uiState.update { it.copy(isPaintMode = newSettings.isPaintMode) }
        repository.saveSettings(newSettings)

        if (oldColorMode != newSettings.regionColorMode) {
            refreshDisplayBitmapForColorMode()
        }
    }

    fun loadBitmap(
        bitmap: Bitmap,
        config: GeneratorConfig = _settings.value.generatorConfig,
        initialFilledRegionIds: Set<Int> = emptySet(),
        initialActiveColorId: Int? = null,
        saveBitmapToDisk: Boolean = true,
        title: String? = null,
    ) {
        val startTime = System.currentTimeMillis()
        CapyLogger.d(
            "CapyVM",
            "loadBitmap() START -> title='$title', bitmap=${bitmap.width}x${bitmap.height}, filledCount=${initialFilledRegionIds.size}",
        )

        val autoTitle = title?.takeIf { it.isNotBlank() } ?: "Capybara"
        val isSample = SampleGallery.samples.any { (it.title.equals(autoTitle, ignoreCase = true)) || (it.id.equals(autoTitle, ignoreCase = true)) } || (autoTitle == "Capybara") || (autoTitle == "Capybara Sample")

        // 1. Pre-register snapshot IMMEDIATELY at 0ms so it appears in Saves list right away
        val currentList = repository.loadSnapshots()
        val existing = currentList.find { it.title == autoTitle }
        val initialSnapshot = existing?.copy(
            lastOpened = System.currentTimeMillis(),
            filledCount = initialFilledRegionIds.size,
            filledRegionIds = initialFilledRegionIds,
            zoomScale = if ((existing.zoomScale != 1.0f) || (existing.panOffsetX != 0f) || (existing.panOffsetY != 0f)) existing.zoomScale else _uiState.value.zoomScale,
            panOffsetX = if (existing.panOffsetX != 0f) existing.panOffsetX else _uiState.value.panOffsetX,
            panOffsetY = if (existing.panOffsetY != 0f) existing.panOffsetY else _uiState.value.panOffsetY,
        ) ?: SavedSnapshot(
            title = autoTitle,
            filledCount = initialFilledRegionIds.size,
            totalCount = 100,
            filledRegionIds = initialFilledRegionIds,
            isAutoSample = isSample,
            sampleAssetPath = SampleGallery.samples.find { it.title.equals(autoTitle, ignoreCase = true) || it.id.equals(autoTitle, ignoreCase = true) }?.assetPath,
            zoomScale = _uiState.value.zoomScale,
            panOffsetX = _uiState.value.panOffsetX,
            panOffsetY = _uiState.value.panOffsetY,
        )
        activeSnapshotId = initialSnapshot.id

        val preList = repository.addSnapshot(initialSnapshot)
        _snapshots.value = sortSnapshots(preList)
        CapyLogger.d(
            "CapyVM",
            "loadBitmap() Step 1/4: Pre-registered snapshot id='${initialSnapshot.id}', title='${initialSnapshot.title}' in _snapshots at 0ms",
        )

        generationJob?.cancel()
        generationJob = viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isLoading = true,
                    puzzle = null,
                    loadingProgress = 0.05f,
                    loadingStatus = "Initializing image canvas...",
                    originalBitmap = bitmap,
                    isCompleted = false,
                )
            }

            if (saveBitmapToDisk) {
                val tSaveImg0 = System.currentTimeMillis()
                withContext(Dispatchers.IO) {
                    repository.saveActiveImageBitmap(bitmap)
                }
                CapyLogger.d("CapyVM", "loadBitmap() Step 2/4: Saved active image bitmap to disk in ${System.currentTimeMillis() - tSaveImg0}ms")
            }

            val tGen0 = System.currentTimeMillis()
            val bundle = withContext(Dispatchers.Default) {
                val generator = AutoPuzzleGenerator()
                val puzzleData = generator.generate(
                    bitmap = bitmap,
                    config = config,
                ) { prog, status ->
                    _uiState.update { it.copy(loadingProgress = prog, loadingStatus = status) }
                }

                val w = puzzleData.width
                val h = puzzleData.height

                _uiState.update { it.copy(loadingProgress = 0.95f, loadingStatus = "Rendering canvas...") }

                val tRender0 = System.currentTimeMillis()
                val dispPixels = renderDisplayPixels(puzzleData, initialFilledRegionIds, _settings.value.regionColorMode)
                val dispBmp = createBitmap(w, h, Bitmap.Config.ARGB_8888)
                dispBmp.setPixels(dispPixels, 0, w, 0, 0, w, h)

                val prevPixels = renderPreviewPixels(puzzleData)
                val prevBmp = createBitmap(w, h, Bitmap.Config.ARGB_8888)
                prevBmp.setPixels(prevPixels, 0, w, 0, 0, w, h)
                CapyLogger.d("CapyVM", "loadBitmap() Canvas bitmap creation and pixel rendering took ${System.currentTimeMillis() - tRender0}ms")

                GeneratedPuzzleBundle(puzzleData, dispBmp, prevBmp, dispPixels, IntArray(0))
            }
            CapyLogger.d(
                "CapyVM",
                "loadBitmap() Step 3/4: Generation & canvas render phase finished in ${System.currentTimeMillis() - tGen0}ms -> regions=${bundle.puzzle.regions.size}, palette=${bundle.puzzle.palette.size}",
            )

            currentPixels = bundle.pixels
            originalPixels = IntArray(0)

            val targetActiveColor = initialActiveColorId ?: bundle.puzzle.palette.firstOrNull()?.id ?: 1
            val isCompletedNow = initialFilledRegionIds.size >= bundle.puzzle.regions.size

            _uiState.update {
                it.copy(
                    isLoading = false,
                    loadingProgress = 1.0f,
                    loadingStatus = "Complete",
                    puzzle = bundle.puzzle,
                    displayBitmap = bundle.displayBitmap,
                    previewBitmap = bundle.previewBitmap,
                    bitmapRevision = it.bitmapRevision + 1,
                    activeColorId = targetActiveColor,
                    filledRegionIds = initialFilledRegionIds,
                    hintRegionId = null,
                    isCompleted = isCompletedNow,
                )
            }

            val tDiskSave0 = System.currentTimeMillis()
            withContext(Dispatchers.IO) {
                repository.saveActivePuzzleData(bundle.puzzle)
            }
            saveCurrentActiveState()

            val finalSnapshot = initialSnapshot.copy(
                lastOpened = System.currentTimeMillis(),
                filledCount = initialFilledRegionIds.size,
                totalCount = bundle.puzzle.regions.size,
                filledRegionIds = initialFilledRegionIds,
                zoomScale = _uiState.value.zoomScale,
                panOffsetX = _uiState.value.panOffsetX,
                panOffsetY = _uiState.value.panOffsetY,
            )

            val progressPreviewBmp = if (initialFilledRegionIds.isEmpty()) {
                bundle.displayBitmap
            } else {
                generateProgressPreviewBitmap(
                    bundle.puzzle,
                    bitmap,
                    initialFilledRegionIds,
                    _settings.value.regionColorMode,
                )
            }

            withContext(Dispatchers.IO) {
                repository.saveActivePuzzleData(bundle.puzzle)
                repository.savePuzzleBitmapForSnapshot(finalSnapshot.id, bitmap, isSample = finalSnapshot.isAutoSample)
                repository.savePuzzleDataForSnapshot(finalSnapshot.id, bundle.puzzle)
                repository.savePuzzlePreviewForSnapshot(finalSnapshot.id, progressPreviewBmp)
            }
            saveCurrentActiveState()

            val finalList = repository.addSnapshot(finalSnapshot)
            _snapshots.value = sortSnapshots(finalList)
            CapyLogger.d(
                "CapyVM",
                "loadBitmap() Step 4/4: Snapshot persistence took ${System.currentTimeMillis() - tDiskSave0}ms",
            )
            CapyLogger.d(
                "CapyVM",
                "loadBitmap() FINISHED total for '${finalSnapshot.title}' in ${System.currentTimeMillis() - startTime}ms. Finalized snapshot id='${finalSnapshot.id}', totalRegions=${bundle.puzzle.regions.size}",
            )
        }
    }

    private fun renderDisplayPixels(
        puzzle: PuzzleData,
        filledRegionIds: Set<Int>,
        regionColorMode: RegionColorMode,
    ): IntArray {
        val width = puzzle.width.coerceAtLeast(1)
        val height = puzzle.height.coerceAtLeast(1)
        val total = width * height
        val pixels = IntArray(total)

        val borderMap = puzzle.borderMap
        val regionMap = puzzle.regionMap
        val paletteMap = puzzle.palette.associateBy { it.id }
        val unfilledColor = 0xFFF8FAFC.toInt()
        val isDetailMode = regionColorMode == RegionColorMode.DETAIL

        val regionColorArray = IntArray(puzzle.regions.size + 1)
        for (reg in puzzle.regions) {
            regionColorArray[reg.id] = paletteMap[reg.colorId]?.argb ?: 0xFF64748B.toInt()
        }

        val regionLookup = puzzle.regions.associateBy { it.id }

        for (i in 0 until total) {
            val rId = regionMap[i]
            if (rId in filledRegionIds) {
                if (isDetailMode) {
                    pixels[i] = 0x00000000 // Transparent: reveals originalBitmap underneath in full resolution!
                } else {
                    if (!borderMap[i]) {
                        val reg = regionLookup[rId]
                        val solidColor = paletteMap[reg?.colorId]?.argb ?: 0xFF64748B.toInt()
                        pixels[i] = solidColor
                    } else {
                        pixels[i] = if (rId in regionColorArray.indices) regionColorArray[rId] else 0xFF64748B.toInt()
                    }
                }
            } else {
                if (borderMap[i]) {
                    pixels[i] = if (rId in regionColorArray.indices) regionColorArray[rId] else 0xFF64748B.toInt()
                } else {
                    pixels[i] = unfilledColor
                }
            }
        }
        return pixels
    }

    private fun renderPreviewPixels(
        puzzle: PuzzleData,
    ): IntArray {
        val width = puzzle.width.coerceAtLeast(1)
        val height = puzzle.height.coerceAtLeast(1)
        val total = width * height
        val pixels = IntArray(total)

        val borderMap = puzzle.borderMap
        val regionMap = puzzle.regionMap
        val paletteMap = puzzle.palette.associateBy { it.id }
        val regionLookup = puzzle.regions.associateBy { it.id }

        for (i in 0 until total) {
            val rId = regionMap[i]
            val reg = regionLookup[rId]
            val color = paletteMap[reg?.colorId]?.argb ?: 0xFFCBD5E1.toInt()
            if (borderMap[i]) {
                val r = ((color shr 16 and 0xFF) * 0.82f).toInt()
                val g = ((color shr 8 and 0xFF) * 0.82f).toInt()
                val b = ((color and 0xFF) * 0.82f).toInt()
                pixels[i] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
            } else {
                pixels[i] = color
            }
        }
        return pixels
    }

    private fun generateProgressPreviewBitmap(
        puzzle: PuzzleData,
        sourceBitmap: Bitmap,
        filledRegionIds: Set<Int>,
        regionColorMode: RegionColorMode,
    ): Bitmap {
        val pWidth = puzzle.width.coerceAtLeast(1)
        val pHeight = puzzle.height.coerceAtLeast(1)
        val total = pWidth * pHeight

        return try {
            if (sourceBitmap.isRecycled) return createBitmap(pWidth, pHeight, Bitmap.Config.ARGB_8888)

            // Scale sourceBitmap to match puzzle grid dimensions so we can sample source pixels directly
            val scaledSource = if ((sourceBitmap.width == pWidth) && (sourceBitmap.height == pHeight)) {
                sourceBitmap
            } else {
                sourceBitmap.scale(pWidth, pHeight)
            }

            val sourcePixels = IntArray(total)
            scaledSource.getPixels(sourcePixels, 0, pWidth, 0, 0, pWidth, pHeight)
            if (scaledSource != sourceBitmap) {
                scaledSource.recycle()
            }

            val borderMap = puzzle.borderMap
            val regionMap = puzzle.regionMap
            val paletteMap = puzzle.palette.associateBy { it.id }
            val unfilledColor = 0xFFF8FAFC.toInt()
            val isDetailMode = regionColorMode == RegionColorMode.DETAIL

            val regionColorArray = IntArray(puzzle.regions.size + 1)
            for (reg in puzzle.regions) {
                regionColorArray[reg.id] = paletteMap[reg.colorId]?.argb ?: 0xFF64748B.toInt()
            }
            val regionLookup = puzzle.regions.associateBy { it.id }

            val resultPixels = IntArray(total)
            for (i in 0 until total) {
                val rId = regionMap[i]
                if (rId in filledRegionIds) {
                    // Completed region: show the original source image artwork for this region
                    if (isDetailMode) {
                        resultPixels[i] = sourcePixels[i]
                    } else {
                        if (!borderMap[i]) {
                            val reg = regionLookup[rId]
                            resultPixels[i] = paletteMap[reg?.colorId]?.argb ?: sourcePixels[i]
                        } else {
                            resultPixels[i] = if (rId in regionColorArray.indices) regionColorArray[rId] else 0xFF64748B.toInt()
                        }
                    }
                } else {
                    // Unfilled region: show off-white background + hairline region border
                    if (borderMap[i]) {
                        resultPixels[i] = if (rId in regionColorArray.indices) regionColorArray[rId] else 0xFF64748B.toInt()
                    } else {
                        resultPixels[i] = unfilledColor
                    }
                }
            }

            val resultBmp = createBitmap(pWidth, pHeight, Bitmap.Config.ARGB_8888)
            resultBmp.setPixels(resultPixels, 0, pWidth, 0, 0, pWidth, pHeight)
            resultBmp
        } catch (_: Exception) {
            createBitmap(pWidth, pHeight, Bitmap.Config.ARGB_8888)
        }
    }

    fun getSnapshotPreview(snapshotId: String): Bitmap? {
        val prev = repository.loadPuzzlePreviewForSnapshot(snapshotId)
        if (prev != null) {
            // Re-generate progress preview if it was saved as a legacy 120x120 square
            if ((prev.width == 120) && (prev.height == 120)) {
                val progressBmp = generateProgressPreviewForSnapshot(snapshotId)
                if ((progressBmp != null) && (progressBmp.width != progressBmp.height)) {
                    repository.savePuzzlePreviewForSnapshot(snapshotId, progressBmp)
                    return progressBmp
                }
            }
            return prev
        }
        val progressBmp = generateProgressPreviewForSnapshot(snapshotId)
        if (progressBmp != null) {
            repository.savePuzzlePreviewForSnapshot(snapshotId, progressBmp)
            return progressBmp
        }

        val snap = repository.loadSnapshots().find { it.id == snapshotId }
        val sampleAssetPath = snap?.sampleAssetPath ?: SampleGallery.samples.find { s ->
            s.id.equals(snapshotId, ignoreCase = true) || s.title.equals(snap?.title, ignoreCase = true)
        }?.assetPath

        if (sampleAssetPath != null) {
            try {
                val app = getApplication<Application>()
                return app.assets.open(sampleAssetPath).use { stream ->
                    BitmapFactory.decodeStream(stream)
                }
            } catch (e: Exception) {
                CapyLogger.w("CapyVM", "getSnapshotPreview() -> Failed to load sample asset '$sampleAssetPath'", e)
            }
        }

        return null
    }

    private fun generateProgressPreviewForSnapshot(snapshotId: String): Bitmap? {
        val puzzle = repository.loadPuzzleDataForSnapshot(snapshotId) ?: return null
        val sourceBmp = repository.loadPuzzleBitmapForSnapshot(snapshotId) ?: return null
        val snapshot = repository.loadSnapshots().find { it.id == snapshotId }
        val filledRegionIds = snapshot?.filledRegionIds ?: emptySet()
        return generateProgressPreviewBitmap(
            puzzle,
            sourceBmp,
            filledRegionIds,
            _settings.value.regionColorMode,
        )
    }

    fun regenerateCurrentArtwork() {
        val original = _uiState.value.originalBitmap ?: return
        loadBitmap(original, _settings.value.generatorConfig)
    }

    fun restoreActiveGameSession(onResult: (Boolean) -> Unit = {}) {
        val tRestore0 = System.currentTimeMillis()
        CapyLogger.d("CapyPerf", "restoreActiveGameSession() START [0ms]")
        _uiState.update { it.copy(isLoading = true, loadingProgress = 0.05f, loadingStatus = "Loading Capy...") }

        viewModelScope.launch {
            val tIo0 = System.currentTimeMillis()
            val (savedState, savedBitmap, cachedPuzzle) = withContext(Dispatchers.IO) {
                val state = repository.loadActiveGameState()
                val snapId = state?.activeSnapshotId
                val bmp = snapId?.let { repository.loadPuzzleBitmapForSnapshot(it) } ?: repository.loadActiveImageBitmap()
                val puzzle = snapId?.let { repository.loadPuzzleDataForSnapshot(it) } ?: repository.loadActivePuzzleData()
                Triple(state, bmp, puzzle)
            }
            val tIo = System.currentTimeMillis() - tIo0
            CapyLogger.d(
                "CapyPerf",
                "restoreActiveGameSession() Step 1/4: Session disk I/O took ${tIo}ms -> activeSnapId='${savedState?.activeSnapshotId}', bmpFound=${savedBitmap != null}, puzzleFound=${cachedPuzzle != null}",
            )

            if ((savedState == null) || (savedBitmap == null)) {
                val defaultSample = SampleGallery.samples.firstOrNull() ?: SampleArtwork("capybara_sample", "Capybara", "capybara.webp", "Animals")
                CapyLogger.d("CapyPerf", "restoreActiveGameSession() -> No saved state found. Auto-loading ${defaultSample.title}...")
                val app = getApplication<Application>()
                val tSample0 = System.currentTimeMillis()
                val defaultBitmap: Bitmap? = withContext(Dispatchers.IO) {
                    try {
                        app.assets.open(defaultSample.assetPath).use { stream ->
                            val options = BitmapFactory.Options().apply {
                                inPreferredConfig = Bitmap.Config.ARGB_8888
                            }
                            BitmapFactory.decodeStream(stream, null, options)
                        }
                    } catch (e: Exception) {
                        CapyLogger.e("CapyVM", "Failed to load ${defaultSample.assetPath} sample asset", e)
                        null
                    }
                }
                CapyLogger.d("CapyPerf", "Sample asset ${defaultSample.assetPath} load took ${System.currentTimeMillis() - tSample0}ms")

                if (defaultBitmap != null) {
                    loadBitmap(defaultBitmap, _settings.value.generatorConfig, title = defaultSample.title)
                    onResult(true)
                } else {
                    _uiState.update { it.copy(isLoading = false) }
                    onResult(false)
                }
                return@launch
            }

            activeSnapshotId = savedState.activeSnapshotId
            val snapInList = _snapshots.value.find { it.id == savedState.activeSnapshotId }
            val effectiveFilledRegionIds = if ((snapInList != null) && (snapInList.filledRegionIds.size > savedState.filledRegionIds.size)) {
                snapInList.filledRegionIds
            } else {
                savedState.filledRegionIds
            }

            CapyLogger.d(
                "CapySave",
                "restoreActiveGameSession() Step 2/4: Restored activeSnapshotId='${savedState.activeSnapshotId}', title='${snapInList?.title}', filledCount=${effectiveFilledRegionIds.size}",
            )

            _uiState.update {
                it.copy(
                    originalBitmap = savedBitmap,
                    previewBitmap = savedBitmap,
                    loadingProgress = 0.25f,
                    loadingStatus = "Restoring saved puzzle...",
                    zoomScale = savedState.zoomScale,
                    panOffsetX = savedState.panOffsetX,
                    panOffsetY = savedState.panOffsetY,
                )
            }

            if (cachedPuzzle == null) {
                CapyLogger.d("CapyPerf", "restoreActiveGameSession() -> No cached puzzle data found on disk; triggering re-generation...")
                loadBitmap(
                    bitmap = savedBitmap,
                    config = _settings.value.generatorConfig,
                    initialFilledRegionIds = effectiveFilledRegionIds,
                    initialActiveColorId = savedState.activeColorId,
                    saveBitmapToDisk = false,
                )
                onResult(true)
                return@launch
            }

            _uiState.update { it.copy(loadingProgress = 0.35f, loadingStatus = "Restoring saved regions...") }

            val tRender0 = System.currentTimeMillis()
            val restoredBundle = withContext(Dispatchers.Default) {
                _uiState.update { it.copy(loadingProgress = 0.55f, loadingStatus = "Restoring saved regions...") }

                val w = cachedPuzzle.width
                val h = cachedPuzzle.height

                val dispPixels = renderDisplayPixels(cachedPuzzle, effectiveFilledRegionIds, _settings.value.regionColorMode)
                val dispBmp = createBitmap(w, h, Bitmap.Config.ARGB_8888)
                dispBmp.setPixels(dispPixels, 0, w, 0, 0, w, h)

                val prevPixels = renderPreviewPixels(cachedPuzzle)
                val prevBmp = createBitmap(w, h, Bitmap.Config.ARGB_8888)
                prevBmp.setPixels(prevPixels, 0, w, 0, 0, w, h)

                _uiState.update { it.copy(loadingProgress = 0.85f, loadingStatus = "Rendering canvas...") }

                Pair(dispBmp, Pair(prevBmp, Pair(dispPixels, IntArray(0))))
            }
            val tRender = System.currentTimeMillis() - tRender0
            CapyLogger.d("CapyPerf", "restoreActiveGameSession() Step 3/4: Canvas pixel rendering took ${tRender}ms -> width=${cachedPuzzle.width}, height=${cachedPuzzle.height}")

            currentPixels = restoredBundle.second.second.first
            originalPixels = restoredBundle.second.second.second

            val targetActiveColor = savedState.activeColorId
            val isCompletedNow = effectiveFilledRegionIds.size >= cachedPuzzle.regions.size

            _uiState.update {
                it.copy(
                    isLoading = false,
                    loadingProgress = 1.0f,
                    loadingStatus = "Complete",
                    puzzle = cachedPuzzle,
                    originalBitmap = savedBitmap,
                    displayBitmap = restoredBundle.first,
                    previewBitmap = restoredBundle.second.first,
                    bitmapRevision = it.bitmapRevision + 1,
                    activeColorId = targetActiveColor,
                    filledRegionIds = effectiveFilledRegionIds,
                    hintRegionId = null,
                    isCompleted = isCompletedNow,
                )
            }
            saveCurrentActiveState(debounceMs = 0L)
            CapyLogger.d(
                "CapyPerf",
                "restoreActiveGameSession() Step 4/4: FINISHED total in ${System.currentTimeMillis() - tRestore0}ms",
            )
            onResult(true)
        }
    }

    fun flushActiveGameState() {
        saveCurrentActiveState(debounceMs = 0L)
    }

    private var saveStateJob: Job? = null

    private fun saveCurrentActiveState(debounceMs: Long = 300L) {
        val state = _uiState.value
        val snapId = activeSnapshotId
        if (state.puzzle != null) {
            saveStateJob?.cancel()
            saveStateJob = viewModelScope.launch(Dispatchers.IO) {
                if (debounceMs > 0) {
                    delay(debounceMs.milliseconds)
                }
                CapyLogger.d(
                    "CapySave",
                    "saveCurrentActiveState(debounceMs=$debounceMs) -> snapId='$snapId', viewExtent=[scale=%.3f, panX=%.1f, panY=%.1f]".format(
                        Locale.US, state.zoomScale, state.panOffsetX, state.panOffsetY,
                    ),
                )
                repository.saveActiveGameState(
                    ActiveGameState(
                        activeSnapshotId = snapId,
                        filledRegionIds = state.filledRegionIds,
                        activeColorId = state.activeColorId,
                        hasActivePuzzle = true,
                        zoomScale = state.zoomScale,
                        panOffsetX = state.panOffsetX,
                        panOffsetY = state.panOffsetY,
                    ),
                )
                if (snapId != null) {
                    val updated = repository.updateSnapshotProgress(
                        id = snapId,
                        filledCount = state.filledRegionIds.size,
                        totalCount = state.puzzle.regions.size,
                        filledRegionIds = state.filledRegionIds,
                        zoomScale = state.zoomScale,
                        panOffsetX = state.panOffsetX,
                        panOffsetY = state.panOffsetY,
                    )
                    _snapshots.value = sortSnapshots(updated)
                }
            }
        }
    }

    fun getSnapshotFileSize(snapshotId: String): Long {
        return repository.getSnapshotFileSize(snapshotId)
    }

    fun selectColor(colorId: Int) {
        _uiState.update { it.copy(activeColorId = colorId, hintRegionId = null) }
        saveCurrentActiveState()
    }

    fun attemptBatchFillRegions(regionIds: Set<Int>, visibleColorIds: Set<Int> = emptySet()): Boolean {
        if (regionIds.isEmpty()) return false
        val state = _uiState.value
        val puzzle = state.puzzle ?: return false

        val currentDifficulty = _settings.value.difficulty
        val isEasy = currentDifficulty == Difficulty.EASY
        val isPaintMode = state.isPaintMode
        val isDetailMode = _settings.value.regionColorMode == RegionColorMode.DETAIL
        val paletteMap = puzzle.palette.associateBy { it.id }
        val borderMap = puzzle.borderMap
        val activeColor = state.activeColorId

        var filledAny = false
        val newlyFilledSet = HashSet(state.filledRegionIds)

        for (regionId in regionIds) {
            if (regionId in newlyFilledSet) continue
            val region = puzzle.regions.find { it.id == regionId } ?: continue

            val canFill = if (isEasy) true else (region.colorId == activeColor)
            if (canFill) {
                if (isEasy && !isPaintMode && (state.activeColorId != region.colorId)) {
                    _uiState.update { it.copy(activeColorId = region.colorId) }
                }
                val palColor = paletteMap[region.colorId]
                val solidColor = palColor?.argb ?: 0xFF64748B.toInt()
                val regPixels = region.pixels

                for (i in regPixels.indices) {
                    val idx = regPixels[i]
                    if (isDetailMode) {
                        currentPixels[idx] = 0x00000000 // Transparent: reveals originalBitmap underneath in full resolution!
                    } else {
                        if (!borderMap[idx]) {
                            currentPixels[idx] = solidColor
                        }
                    }
                }
                newlyFilledSet.add(regionId)
                filledAny = true
            }
        }

        if (filledAny) {
            var minX = puzzle.width
            var maxX = 0
            var minY = puzzle.height
            var maxY = 0
            for (regionId in regionIds) {
                val reg = puzzle.regions.find { it.id == regionId } ?: continue
                if (reg.minX < minX) minX = reg.minX
                if (reg.maxX > maxX) maxX = reg.maxX
                if (reg.minY < minY) minY = reg.minY
                if (reg.maxY > maxY) maxY = reg.maxY
            }
            if ((minX <= maxX) && (minY <= maxY)) {
                val boundW = (maxX - minX) + 1
                val boundH = (maxY - minY) + 1
                val offset = (minY * puzzle.width) + minX
                state.displayBitmap?.setPixels(currentPixels, offset, puzzle.width, minX, minY, boundW, boundH)
            } else {
                state.displayBitmap?.setPixels(currentPixels, 0, puzzle.width, 0, 0, puzzle.width, puzzle.height)
            }

            val isNowComplete = newlyFilledSet.size >= puzzle.regions.size
            if (isNowComplete) {
                setPaintMode(enabled = false)
            }

            _uiState.update {
                it.copy(
                    filledRegionIds = newlyFilledSet,
                    hintRegionId = null,
                    bitmapRevision = it.bitmapRevision + 1,
                    isCompleted = isNowComplete,
                    isPaintMode = if (isNowComplete) false else it.isPaintMode,
                )
            }

            saveCurrentActiveState()

            val currSnapId = activeSnapshotId ?: _snapshots.value.firstOrNull()?.id
            updateSnapshotProgressDebounced(currSnapId, newlyFilledSet, puzzle, state.originalBitmap)

            if (_settings.value.autoAdvance && !isNowComplete) {
                checkAutoAdvance(visibleColorIds)
            }
        }
        return filledAny
    }

    private var updateSnapshotJob: Job? = null

    private fun updateSnapshotProgressDebounced(
        snapshotId: String?,
        filledRegionIds: Set<Int>,
        puzzle: PuzzleData,
        originalBitmap: Bitmap?,
    ) {
        if (snapshotId == null) return
        updateSnapshotJob?.cancel()
        updateSnapshotJob = viewModelScope.launch(Dispatchers.IO) {
            delay(300.milliseconds)

            val updated = repository.updateSnapshotProgress(
                id = snapshotId,
                filledCount = filledRegionIds.size,
                totalCount = puzzle.regions.size,
                filledRegionIds = filledRegionIds,
            )
            _snapshots.value = sortSnapshots(updated)

            if ((originalBitmap != null) && (!originalBitmap.isRecycled)) {
                val progressPreviewBmp = generateProgressPreviewBitmap(
                    puzzle,
                    originalBitmap,
                    filledRegionIds,
                    _settings.value.regionColorMode,
                )
                repository.savePuzzlePreviewForSnapshot(snapshotId, progressPreviewBmp)
            }
        }
    }

    fun attemptFillRegion(regionId: Int, visibleColorIds: Set<Int> = emptySet()): Boolean {
        return attemptBatchFillRegions(setOf(regionId), visibleColorIds)
    }

    private fun sortSnapshots(list: List<SavedSnapshot>): List<SavedSnapshot> {
        val distinctList = list.distinctBy { it.id }
        val activeId = activeSnapshotId ?: return distinctList
        val activeItem = distinctList.find { it.id == activeId } ?: return distinctList
        val rest = distinctList.filterNot { it.id == activeId }
        return listOf(activeItem) + rest
    }

    fun renameSnapshot(id: String, newTitle: String) {
        val updated = repository.renameSnapshot(id, newTitle)
        _snapshots.value = sortSnapshots(updated)
    }

    fun triggerHint(colorId: Int? = null, visibleRegionIds: Set<Int> = emptySet()) {
        val state = _uiState.value
        val puzzle = state.puzzle ?: return
        val targetColor = colorId ?: state.activeColorId
        if ((colorId != null) && (state.activeColorId != colorId)) {
            selectColor(colorId)
        }
        val unfilledForActive = puzzle.regions.filter { (it.colorId == targetColor) && (it.id !in state.filledRegionIds) }
        if (unfilledForActive.isEmpty()) return

        val onScreenTarget = unfilledForActive.firstOrNull { it.id in visibleRegionIds }
        val target = onScreenTarget ?: unfilledForActive.first()
        _uiState.update { it.copy(hintRegionId = target.id) }
    }

    fun togglePreview() {
        _uiState.update { it.copy(isPreviewMode = !it.isPreviewMode) }
    }

    fun togglePaintMode() {
        val next = !_settings.value.isPaintMode
        updateSettings(_settings.value.copy(isPaintMode = next))
    }

    fun setPaintMode(enabled: Boolean) {
        updateSettings(_settings.value.copy(isPaintMode = enabled))
    }

    @Suppress("unused")
    fun triggerResetZoom() {
        _uiState.update { it.copy(resetZoomTrigger = it.resetZoomTrigger + 1) }
    }

    fun zoomIn() {
        _uiState.update { it.copy(zoomInTrigger = it.zoomInTrigger + 1) }
    }

    fun zoomOut() {
        _uiState.update { it.copy(zoomOutTrigger = it.zoomOutTrigger + 1) }
    }

    fun updateViewExtent(zoomScale: Float, panOffsetX: Float, panOffsetY: Float) {
        _uiState.update {
            it.copy(
                zoomScale = zoomScale,
                panOffsetX = panOffsetX,
                panOffsetY = panOffsetY,
            )
        }
        saveCurrentActiveState()
    }

    fun resetProgress() {
        val state = _uiState.value
        val puzzle = state.puzzle ?: return

        val newPixels = renderDisplayPixels(puzzle, emptySet(), _settings.value.regionColorMode)
        System.arraycopy(newPixels, 0, currentPixels, 0, newPixels.size.coerceAtMost(currentPixels.size))

        state.displayBitmap?.setPixels(currentPixels, 0, puzzle.width, 0, 0, puzzle.width, puzzle.height)

        _uiState.update {
            it.copy(
                filledRegionIds = emptySet(),
                hintRegionId = null,
                bitmapRevision = it.bitmapRevision + 1,
                isCompleted = false,
            )
        }

        val snapId = activeSnapshotId
        snapId?.let { updateSnapshotProgressDebounced(it, emptySet(), puzzle, state.originalBitmap) }
        saveCurrentActiveState()
    }

    @Suppress("unused")
    fun saveCurrentSnapshot(customTitle: String? = null) {
        val state = _uiState.value
        val puzzle = state.puzzle ?: return
        val count = state.filledRegionIds.size
        val total = puzzle.regions.size
        val pct = if (total > 0) (count * 100) / total else 0
        val title = customTitle?.takeIf { it.isNotBlank() } ?: "Snapshot ($pct%)"

        val snapshot = SavedSnapshot(
            title = title,
            filledCount = count,
            totalCount = total,
            filledRegionIds = state.filledRegionIds,
            zoomScale = state.zoomScale,
            panOffsetX = state.panOffsetX,
            panOffsetY = state.panOffsetY,
        )

        val updated = repository.addSnapshot(snapshot)
        _snapshots.value = updated
        CapyLogger.d(
            "CapySave",
            "saveCurrentSnapshot() -> id='${snapshot.id}', title='$title', viewExtent=[scale=%.3f, panX=%.1f, panY=%.1f]".format(
                Locale.US, state.zoomScale, state.panOffsetX, state.panOffsetY,
            ),
        )
    }

    fun loadSnapshot(snapshot: SavedSnapshot) {
        val tLoadSnapshotStart = System.currentTimeMillis()
        CapyLogger.d(
            "CapySave",
            "loadSnapshot() START -> id='${snapshot.id}', title='${snapshot.title}', filledCount=${snapshot.filledCount}, viewExtent=[scale=%.3f, panX=%.1f, panY=%.1f]".format(
                Locale.US, snapshot.zoomScale, snapshot.panOffsetX, snapshot.panOffsetY,
            ),
        )

        // 1. Immediately mark active save, set loading state, and update snapshots list at 0ms
        activeSnapshotId = snapshot.id
        _snapshots.value = sortSnapshots(_snapshots.value)
        _uiState.update {
            it.copy(
                isLoading = true,
                puzzle = null,
                loadingProgress = 0.05f,
                loadingStatus = "Loading ${snapshot.title}...",
                isCompleted = false,
                zoomScale = snapshot.zoomScale,
                panOffsetX = snapshot.panOffsetX,
                panOffsetY = snapshot.panOffsetY,
            )
        }

        generationJob?.cancel()
        generationJob = viewModelScope.launch(Dispatchers.Default) {
            _uiState.update { it.copy(loadingProgress = 0.15f, loadingStatus = "Reading ${snapshot.title}...") }

            val (snapshotBitmap, snapshotPuzzle, cachedPreview) = withContext(Dispatchers.IO) {
                val tBmp = System.currentTimeMillis()
                val bmp = repository.loadPuzzleBitmapForSnapshot(snapshot.id, snapshot.title)
                CapyLogger.d("CapySave", "loadSnapshot() -> Bitmap disk load for '${snapshot.title}' took ${System.currentTimeMillis() - tBmp}ms (found=${bmp != null})")

                val tData = System.currentTimeMillis()
                val data = repository.loadPuzzleDataForSnapshot(snapshot.id)
                CapyLogger.d("CapySave", "loadSnapshot() -> GZIP binary data load took ${System.currentTimeMillis() - tData}ms (found=${data != null})")

                val tPrev = System.currentTimeMillis()
                val prev = repository.loadPuzzlePreviewForSnapshot(snapshot.id)
                CapyLogger.d("CapySave", "loadSnapshot() -> Preview thumbnail load took ${System.currentTimeMillis() - tPrev}ms (found=${prev != null})")

                if (bmp != null) {
                    Triple(bmp, data, prev)
                } else {
                    val sample = SampleGallery.samples.find { s ->
                        s.id.equals(snapshot.id, ignoreCase = true) ||
                        s.title.equals(snapshot.title, ignoreCase = true) ||
                        s.id.equals(snapshot.title, ignoreCase = true) ||
                        s.title.equals(snapshot.id, ignoreCase = true) ||
                        ((snapshot.sampleAssetPath != null) && s.assetPath.equals(snapshot.sampleAssetPath, ignoreCase = true))
                    }
                    if (sample != null) {
                        CapyLogger.d("CapySave", "loadSnapshot() -> Loading asset '${sample.assetPath}' for '${snapshot.title}'")
                        val app = getApplication<Application>()
                        val sampleBmp = try {
                            app.assets.open(sample.assetPath).use { stream ->
                                BitmapFactory.decodeStream(stream)
                            }
                        } catch (e: Exception) {
                            CapyLogger.e("CapySave", "loadSnapshot() -> Failed to load asset '${sample.assetPath}'", e)
                            null
                        }
                        Triple(sampleBmp, data, prev)
                    } else {
                        CapyLogger.e("CapySave", "loadSnapshot() -> No source bitmap or sample asset found for '${snapshot.title}' (id='${snapshot.id}')")
                        Triple(null, data, prev)
                    }
                }
            }
            CapyLogger.d("CapySave", "loadSnapshot() -> Disk I/O phase for '${snapshot.title}' finished in ${System.currentTimeMillis() - tLoadSnapshotStart}ms")

            val activeBitmap = snapshotBitmap ?: cachedPreview
            _uiState.update {
                it.copy(
                    isLoading = true,
                    originalBitmap = activeBitmap,
                    previewBitmap = cachedPreview ?: activeBitmap,
                    displayBitmap = null,
                )
            }

            if ((snapshotBitmap != null) && (snapshotPuzzle != null)) {
                restoreSnapshotDataAndBitmap(snapshot, snapshotPuzzle, snapshotBitmap, cachedPreview)
            } else if (snapshotBitmap != null) {
                loadBitmap(
                    bitmap = snapshotBitmap,
                    config = _settings.value.generatorConfig,
                    initialFilledRegionIds = snapshot.filledRegionIds,
                    title = snapshot.title,
                )
            } else {
                _uiState.update { it.copy(isLoading = false) }
            }
            CapyLogger.d("CapySave", "loadSnapshot() FINISHED total for '${snapshot.title}' in ${System.currentTimeMillis() - tLoadSnapshotStart}ms")
        }
    }

    fun loadSampleArtwork(sample: SampleArtwork) {
        val currentList = repository.loadSnapshots()
        val existing = currentList.find { (it.title == sample.title) || (it.id == sample.id) }
        if (existing != null) {
            loadSnapshot(existing)
        } else {
            val app = getApplication<Application>()
            val defaultBitmap: Bitmap? = try {
                app.assets.open(sample.assetPath).use { stream ->
                    BitmapFactory.decodeStream(stream)
                }
            } catch (_: Exception) { null }

            defaultBitmap?.let {
                loadBitmap(
                    bitmap = it,
                    config = _settings.value.generatorConfig,
                    title = sample.title,
                )
            }
        }
    }

    private suspend fun restoreSnapshotDataAndBitmap(
        snapshot: SavedSnapshot,
        puzzleData: PuzzleData,
        sourceBitmap: Bitmap,
        cachedPreviewBitmap: Bitmap? = null,
    ) {
        val tRestore0 = System.currentTimeMillis()
        CapyLogger.d("CapySave", "restoreSnapshotDataAndBitmap() START -> id='${snapshot.id}', title='${snapshot.title}' (${sourceBitmap.width}x${sourceBitmap.height})")

        _uiState.update {
            it.copy(
                originalBitmap = sourceBitmap,
                previewBitmap = cachedPreviewBitmap ?: sourceBitmap,
                loadingProgress = 0.25f,
                loadingStatus = "Restoring ${snapshot.title}...",
            )
        }

        val tRender0 = System.currentTimeMillis()
        val restoredBundle = withContext(Dispatchers.Default) {
            _uiState.update { it.copy(loadingProgress = 0.45f, loadingStatus = "Restoring saved region fills...") }

            val w = puzzleData.width
            val h = puzzleData.height

            val dispPixels = renderDisplayPixels(puzzleData, snapshot.filledRegionIds, _settings.value.regionColorMode)
            val dispBmp = createBitmap(w, h, Bitmap.Config.ARGB_8888)
            dispBmp.setPixels(dispPixels, 0, w, 0, 0, w, h)

            val prevBmp = cachedPreviewBitmap ?: generateProgressPreviewBitmap(
                puzzleData,
                sourceBitmap,
                snapshot.filledRegionIds,
                _settings.value.regionColorMode,
            )

            _uiState.update { it.copy(loadingProgress = 0.85f, loadingStatus = "Rendering canvas...") }

            Pair(dispBmp, Pair(prevBmp, Pair(dispPixels, IntArray(0))))
        }
        val tRender = System.currentTimeMillis() - tRender0
        CapyLogger.d(
            "CapySave",
            "restoreSnapshotDataAndBitmap() Step 1/2: Rendered canvas display bitmap (${puzzleData.width}x${puzzleData.height}) in ${tRender}ms",
        )

        currentPixels = restoredBundle.second.second.first
        originalPixels = IntArray(0)

        val isCompletedNow = snapshot.filledRegionIds.size >= puzzleData.regions.size

        val updatedSnapshots = repository.updateSnapshotProgress(
            id = snapshot.id,
            filledCount = snapshot.filledRegionIds.size,
            totalCount = puzzleData.regions.size,
            filledRegionIds = snapshot.filledRegionIds,
        )
        _snapshots.value = sortSnapshots(updatedSnapshots)

        _uiState.update {
            it.copy(
                isLoading = false,
                loadingProgress = 1.0f,
                loadingStatus = "Complete",
                puzzle = puzzleData,
                originalBitmap = sourceBitmap,
                displayBitmap = restoredBundle.first,
                previewBitmap = restoredBundle.second.first,
                bitmapRevision = it.bitmapRevision + 1,
                activeColorId = puzzleData.palette.firstOrNull()?.id ?: 1,
                filledRegionIds = snapshot.filledRegionIds,
                hintRegionId = null,
                isCompleted = isCompletedNow,
            )
        }

        // Asynchronously save active state files to disk in background AFTER UI is active
        viewModelScope.launch(Dispatchers.IO) {
            val tSave = System.currentTimeMillis()
            repository.saveActiveImageBitmap(sourceBitmap)
            repository.saveActivePuzzleData(puzzleData)
            saveCurrentActiveState(debounceMs = 0L)
            CapyLogger.d("CapySave", "restoreSnapshotDataAndBitmap() Step 2/2: Background active state save took ${System.currentTimeMillis() - tSave}ms")
        }

        CapyLogger.d(
            "CapySave",
            "restoreSnapshotDataAndBitmap() FINISHED total for '${snapshot.title}' in ${System.currentTimeMillis() - tRestore0}ms",
        )
    }

    private fun refreshDisplayBitmapForColorMode() {
        val state = _uiState.value
        val puzzle = state.puzzle ?: return

        val newPixels = renderDisplayPixels(puzzle, state.filledRegionIds, _settings.value.regionColorMode)
        System.arraycopy(newPixels, 0, currentPixels, 0, newPixels.size.coerceAtMost(currentPixels.size))

        state.displayBitmap?.setPixels(currentPixels, 0, puzzle.width, 0, 0, puzzle.width, puzzle.height)
        _uiState.update { it.copy(bitmapRevision = it.bitmapRevision + 1) }
    }

    fun deleteSnapshot(id: String) {
        val wasActive = (id == activeSnapshotId)
        val updated = repository.deleteSnapshot(id)

        if (wasActive) {
            val nextSave = updated.firstOrNull()
            if (nextSave != null) {
                loadSnapshot(nextSave)
            } else {
                recreateCapySample()
            }
        } else {
            _snapshots.value = sortSnapshots(updated)
        }
    }

    fun clearAllSnapshots() {
        repository.clearAllSnapshots()
        _snapshots.value = emptyList()
        recreateCapySample()
    }

    private fun recreateCapySample() {
        val app = getApplication<Application>()
        val defaultBitmap: Bitmap? = try {
            app.assets.open("capybara.webp").use { stream ->
                BitmapFactory.decodeStream(stream)
            }
        } catch (_: Exception) {
            null
        }
        defaultBitmap?.let {
            loadBitmap(it, _settings.value.generatorConfig, title = "Capybara")
        }
    }

    private fun checkAutoAdvance(visibleColorIds: Set<Int> = emptySet()) {
        val state = _uiState.value
        val puzzle = state.puzzle ?: return
        val active = state.activeColorId

        val remainingActive = puzzle.regions.count { (it.colorId == active) && (it.id !in state.filledRegionIds) }
        if (remainingActive == 0) {
            val settings = _settings.value
            val basePalette =
                getVisiblePalette(puzzle.palette, puzzle.regions, state.filledRegionIds, settings.paletteSort)
            val dockPalette =
                getDockPalette(basePalette, settings.prioritizeOnScreen, visibleColorIds)

            val nextColor = dockPalette.firstOrNull() ?: basePalette.firstOrNull()
            if (nextColor != null) {
                _uiState.update { it.copy(activeColorId = nextColor.id) }
            }
        }
    }
}
