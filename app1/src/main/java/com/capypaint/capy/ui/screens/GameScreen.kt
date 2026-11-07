package com.capypaint.capy.ui.screens

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import com.capypaint.capy.ui.icons.AppIcons
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import com.capypaint.capy.model.SampleGallery
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.capypaint.capy.R
import com.capypaint.capy.ui.components.FloatingIconButton
import com.capypaint.capy.ui.components.GameTopBar
import com.capypaint.capy.ui.components.PaletteDock
import com.capypaint.capy.ui.components.PuzzleCanvas
import com.capypaint.capy.ui.components.SettingsMenuSheet
import com.capypaint.capy.viewmodel.GameViewModel

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.ui.draw.clip
import android.provider.OpenableColumns
import androidx.compose.runtime.mutableIntStateOf
import com.capypaint.capy.util.CapyLogger

import androidx.core.content.FileProvider
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun GameScreen(
    viewModel: GameViewModel = viewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val settings by viewModel.settings.collectAsState()
    val snapshots by viewModel.snapshots.collectAsState()
    val context = LocalContext.current

    var showSettingsSheet by remember { mutableStateOf(value = false) }
    var settingsInitialTab by remember { mutableIntStateOf(-1) }
    var visibleColorIds by remember { mutableStateOf<Set<Int>>(emptySet()) }
    val currentVisibleColorIds = rememberUpdatedState(visibleColorIds)
    val visibleRegionIdsState = remember { mutableStateOf<Set<Int>>(emptySet()) }

    var tempCameraPhotoUri by remember { mutableStateOf<Uri?>(null) }

    val photoPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickVisualMedia(),
    ) { uri ->
        uri?.let {
            val filename = queryImageFilename(context, it)
            val bitmap = loadBitmapFromUri(context, it)
            viewModel.loadBitmap(bitmap, settings.generatorConfig, title = filename)
        }
    }

    val takePictureLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.TakePicture(),
    ) { success ->
        if (success) {
            tempCameraPhotoUri?.let { uri ->
                try {
                    val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
                    val filename = "Photo $timestamp"
                    val bitmap = loadBitmapFromUri(context, uri)
                    viewModel.loadBitmap(bitmap, settings.generatorConfig, title = filename)
                } catch (e: Exception) {
                    CapyLogger.e("GameScreen", "Failed to decode camera photo: ${e.message}")
                }
            }
        }
    }

    // Load initial or restored game state on launch
    LaunchedEffect(Unit) {
        if ((uiState.puzzle == null) && (!uiState.isLoading)) {
            viewModel.restoreActiveGameSession()
        }
    }

    val activeSaveTitle = remember(snapshots, uiState.puzzle, uiState.filledRegionIds) {
        val activeId = viewModel.activeSnapshotId
        snapshots.find { it.id == activeId }?.title ?: snapshots.firstOrNull()?.title
    }

    val totalRegions = uiState.puzzle?.regions?.size ?: 0
    val filledCount = uiState.filledRegionIds.size
    val progressPct = if (totalRegions > 0) (filledCount * 100) / totalRegions else 0

    val isEffectivePreview = uiState.isPreviewMode || (uiState.puzzle == null) || uiState.isLoading

    Box(
        modifier = Modifier.fillMaxSize(),
    ) {
        val splashBitmap = uiState.originalBitmap ?: remember(context) {
            try {
                val sampleAsset = SampleGallery.samples.firstOrNull()?.assetPath ?: "capybara.webp"
                context.assets.open(sampleAsset).use { stream ->
                    val options = BitmapFactory.Options().apply {
                        inPreferredConfig = Bitmap.Config.ARGB_8888
                    }
                    BitmapFactory.decodeStream(stream, null, options)
                }
            } catch (_: Exception) {
                null
            }
        }

        // Full Screen Interactive Canvas (Extends edge-to-edge behind headers & dock)
        PuzzleCanvas(
            puzzle = uiState.puzzle,
            displayBitmap = uiState.displayBitmap,
            previewBitmap = uiState.previewBitmap ?: splashBitmap,
            originalBitmap = uiState.originalBitmap ?: splashBitmap,
            bitmapRevision = uiState.bitmapRevision,
            activeColorId = uiState.activeColorId,
            filledRegionIds = uiState.filledRegionIds,
            hintRegionId = uiState.hintRegionId,
            isPreviewMode = isEffectivePreview,
            isPaintMode = uiState.isPaintMode,
            canvasBgColor = settings.canvasBgColor,
            canvasBgArgb = settings.canvasBgArgb,
            sortOrder = settings.paletteSort,
            highlightStyle = settings.highlightStyle,
            hintColorArgb = settings.hintColorArgb,
            hintFillStyle = settings.hintFillStyle,
            showRegionLabels = settings.showRegionLabels,
            showPreviewLabels = settings.showPreviewLabels,
            showPreviewBorders = settings.showPreviewBorders,
            labelScale = settings.labelScale,
            highlightMatching = settings.highlightMatching,
            animateHint = settings.animateHint,
            showNextRegionHint = settings.showNextRegionHint,
            hintIntensity = settings.hintIntensity,
            targetResolution = settings.generatorConfig.resolution,
            resetZoomTrigger = uiState.resetZoomTrigger,
            zoomInTrigger = uiState.zoomInTrigger,
            zoomOutTrigger = uiState.zoomOutTrigger,
            initialZoomScale = uiState.zoomScale,
            initialPanOffsetX = uiState.panOffsetX,
            initialPanOffsetY = uiState.panOffsetY,
            onViewExtentChanged = { zoom, offsetX, offsetY ->
                viewModel.updateViewExtent(zoom, offsetX, offsetY)
            },
            onRegionClicked = { regionId ->
                viewModel.attemptFillRegion(regionId, currentVisibleColorIds.value)
            },
            onBatchRegionsClicked = { regionIds ->
                viewModel.attemptBatchFillRegions(regionIds, currentVisibleColorIds.value)
            },
            onVisibleColorIdsChanged = { newColors ->
                if (visibleColorIds != newColors) {
                    CapyLogger.d("CapyPerf", "GameScreen: visibleColorIds state updated -> prev=${visibleColorIds.size}, new=${newColors.size}, colors=$newColors")
                    visibleColorIds = newColors
                }
            },
            onVisibleRegionIdsChanged = { newRegions ->
                visibleRegionIdsState.value = newRegions
            },
            onTogglePreview = {
                viewModel.togglePreview()
            },
            onTogglePaintMode = {
                viewModel.togglePaintMode()
            },
            modifier = Modifier.fillMaxSize(),
        )

        // Floating GameTopBar (Non-touch-blocking header)
        GameTopBar(
            activeSaveTitle = activeSaveTitle,
            isPreviewMode = isEffectivePreview,
            isCompleted = uiState.isCompleted,
            progressPercentage = progressPct,
            onPickImage = {
                photoPickerLauncher.launch(
                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                )
            },
            onTogglePreview = { viewModel.togglePreview() },
            onOpenSettings = {
                settingsInitialTab = -1
                showSettingsSheet = true
            },
            onOpenSaves = {
                settingsInitialTab = 3
                showSettingsSheet = true
            },
            onRestart = { viewModel.resetProgress() },
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth(),
        )

        // Floating Palette Dock at bottom
        val puzzle = uiState.puzzle
        if (puzzle != null) {
            Box(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .height(if (settings.raisePaletteDock) 83.dp else 65.dp),
            ) {
                PaletteDock(
                    palette = puzzle.palette,
                    regions = puzzle.regions,
                    activeColorId = uiState.activeColorId,
                    filledRegionIds = uiState.filledRegionIds,
                    sortOrder = settings.paletteSort,
                    prioritizeOnScreen = settings.prioritizeOnScreen,
                    visibleColorIds = visibleColorIds,
                    raiseDock = settings.raisePaletteDock,
                    onColorSelected = { viewModel.selectColor(it) },
                    onColorHintRequested = { colorId -> viewModel.triggerHint(colorId = colorId, visibleRegionIds = visibleRegionIdsState.value) },
                )
            }
        }

        // Floating action controls in bottom right corner (above Palette Dock)
        if ((uiState.puzzle != null) && (!uiState.isLoading)) {
            Column(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 16.dp, bottom = if (settings.raisePaletteDock) 115.dp else 90.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                horizontalAlignment = Alignment.End,
            ) {
                if (settings.showZoomButtons) {
                    FloatingIconButton(
                        onClick = {
                            CapyLogger.d("CapyInput", "UI Zoom In (+) button clicked")
                            viewModel.zoomIn()
                        },
                        icon = Icons.Default.Add,
                        contentDescription = "Zoom In",
                    )
                    FloatingIconButton(
                        onClick = {
                            CapyLogger.d("CapyInput", "UI Zoom Out (-) button clicked")
                            viewModel.zoomOut()
                        },
                        icon = AppIcons.Remove,
                        contentDescription = "Zoom Out",
                    )
                }
                FloatingIconButton(
                    onClick = {
                        CapyLogger.d("CapyInput", "UI Hint button clicked")
                        viewModel.triggerHint(visibleRegionIds = visibleRegionIdsState.value)
                    },
                    icon = AppIcons.Lightbulb,
                    contentDescription = stringResource(R.string.menu_hint),
                    tint = MaterialTheme.colorScheme.primary,
                )
                FloatingIconButton(
                    onClick = {
                        CapyLogger.d("CapyInput", "UI Toggle Paint Mode button clicked")
                        viewModel.togglePaintMode()
                    },
                    icon = AppIcons.Brush,
                    contentDescription = "Toggle Paint Mode",
                    tint = if (uiState.isPaintMode) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
                    containerColor = if (uiState.isPaintMode) MaterialTheme.colorScheme.primaryContainer else null,
                )
            }
        }

            // Floating status card during puzzle loading / save restoration / generation
            AnimatedVisibility(
                visible = uiState.isLoading,
                enter = fadeIn(animationSpec = tween(100)) + slideInVertically(animationSpec = tween(100)) { it / 2 },
                exit = fadeOut(animationSpec = tween(250)) + slideOutVertically(animationSpec = tween(250)) { it / 2 },
                modifier = Modifier
                    .align(if (uiState.puzzle == null) Alignment.Center else Alignment.BottomCenter)
                    .padding(
                        bottom = if (uiState.puzzle == null) 0.dp else if (settings.raisePaletteDock) 110.dp else 85.dp,
                        start = 24.dp,
                        end = 24.dp,
                    ),
            ) {
                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.94f),
                    tonalElevation = 6.dp,
                    shadowElevation = 8.dp,
                    modifier = Modifier.widthIn(min = 220.dp, max = 340.dp),
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(horizontal = 18.dp, vertical = 12.dp),
                    ) {
                        Text(
                            text = uiState.loadingStatus,
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurface,
                        )

                        LinearProgressIndicator(
                            progress = { uiState.loadingProgress.coerceIn(0f, 1f) },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(6.dp)
                                .clip(RoundedCornerShape(3.dp)),
                            color = MaterialTheme.colorScheme.primary,
                            trackColor = MaterialTheme.colorScheme.surfaceVariant,
                        )
                    }
                }
            }

            // Settings Modal Bottom Sheet
            SettingsMenuSheet(
                isOpen = showSettingsSheet,
                initialTab = settingsInitialTab,
                settings = settings,
                snapshots = snapshots,
                puzzle = uiState.puzzle,
                filledRegionIds = uiState.filledRegionIds,
                originalBitmap = uiState.originalBitmap,
                onDismiss = { showSettingsSheet = false },
                onUpdateSettings = { viewModel.updateSettings(it) },
                onLoadSnapshot = { viewModel.loadSnapshot(it) },
                onRenameSnapshot = { id, newTitle -> viewModel.renameSnapshot(id, newTitle) },
                onDeleteSnapshot = { viewModel.deleteSnapshot(it) },
                onClearAllSnapshots = { viewModel.clearAllSnapshots() },
                onRegenerate = { viewModel.regenerateCurrentArtwork() },
                onPickImage = {
                    photoPickerLauncher.launch(
                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                    )
                },
                onTakePhoto = {
                    try {
                        val photoFile = File(context.cacheDir, "camera_photo.jpg")
                        val uri = FileProvider.getUriForFile(
                            context,
                            "${context.packageName}.fileprovider",
                            photoFile,
                        )
                        tempCameraPhotoUri = uri
                        takePictureLauncher.launch(uri)
                    } catch (e: Exception) {
                        CapyLogger.e("GameScreen", "Failed to launch camera: ${e.message}")
                    }
                },
                onResetProgress = { viewModel.resetProgress() },
                onSelectSample = { viewModel.loadSampleArtwork(it) },
                onGetSnapshotFileSize = { id -> viewModel.getSnapshotFileSize(id) },
                onGetSnapshotPreview = viewModel::getSnapshotPreview,
            )
        }
}

private fun loadBitmapFromUri(context: Context, uri: Uri): Bitmap {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, _, _ ->
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            decoder.isMutableRequired = true
        }
    } else {
        @Suppress("DEPRECATION")
        MediaStore.Images.Media.getBitmap(context.contentResolver, uri)
    }
}

private fun queryImageFilename(context: Context, uri: Uri): String {
    return try {
        var name: String? = null
        if (uri.scheme == "content") {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIndex >= 0) {
                        name = cursor.getString(nameIndex)
                    }
                }
            }
        }
        name ?: uri.lastPathSegment ?: "Imported Image"
    } catch (_: Exception) {
        "Imported Image"
    }
}


