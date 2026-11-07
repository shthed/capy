package com.capypaint.capy.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.border
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.HorizontalDivider
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import com.capypaint.capy.ui.icons.AppIcons
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import com.capypaint.capy.util.CapyLogger
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import android.graphics.Bitmap
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.capypaint.capy.engine.PuzzleData
import com.capypaint.capy.model.CanvasBgColor
import android.graphics.BitmapFactory
import com.capypaint.capy.model.Difficulty
import com.capypaint.capy.model.HintFillStyle
import com.capypaint.capy.model.ImageType
import com.capypaint.capy.model.MinRegionOption
import com.capypaint.capy.model.PaletteDetail
import com.capypaint.capy.model.PaletteSortOrder
import com.capypaint.capy.model.RegionColorMode
import com.capypaint.capy.model.RegionHighlightStyle
import com.capypaint.capy.model.SampleArtwork
import com.capypaint.capy.model.SampleGallery
import com.capypaint.capy.model.SavedSnapshot
import com.capypaint.capy.model.ThemeMode
import com.capypaint.capy.model.UserSettings
import com.capypaint.capy.model.SaveSortOrder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs
import kotlin.math.log2
import kotlin.math.pow

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.saveable.rememberSaveable

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsMenuSheet(
    isOpen: Boolean,
    initialTab: Int = -1,
    settings: UserSettings,
    snapshots: List<SavedSnapshot>,
    puzzle: PuzzleData?,
    filledRegionIds: Set<Int>,
    originalBitmap: Bitmap? = null,
    onDismiss: () -> Unit,
    onUpdateSettings: (UserSettings) -> Unit,
    onLoadSnapshot: (SavedSnapshot) -> Unit,
    onRenameSnapshot: (String, String) -> Unit = { _, _ -> },
    onDeleteSnapshot: (String) -> Unit,
    onClearAllSnapshots: () -> Unit,
    onRegenerate: () -> Unit,
    onPickImage: () -> Unit,
    onTakePhoto: () -> Unit = {},
    onResetProgress: () -> Unit,
    onSelectSample: (SampleArtwork) -> Unit = {},
    onGetSnapshotFileSize: (String) -> Long = { 0L },
    onGetSnapshotPreview: (String) -> Bitmap? = { null },
) {
    var selectedTab by rememberSaveable { mutableIntStateOf(0) }

    LaunchedEffect(isOpen, initialTab) {
        if (isOpen && (initialTab != -1)) {
            selectedTab = initialTab
        }
    }

    if (!isOpen) return

    val context = LocalContext.current
    val clipboardManager = LocalClipboardManager.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var showDebugLogDialog by remember { mutableStateOf(value = false) }
    var showCrashReportDialog by remember { mutableStateOf(value = false) }
    val lastCrash = remember(showCrashReportDialog) { CapyLogger.getLastCrashDump(context) }

    if (showDebugLogDialog) {
        val logText = remember { CapyLogger.getLogHistoryFormatted() }
        AlertDialog(
            onDismissRequest = { showDebugLogDialog = false },
            title = { Text("Capy Debug & Diagnostics Log") },
            text = {
                Column(modifier = Modifier.fillMaxWidth().height(320.dp)) {
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        Text(
                            text = logText,
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier
                                .padding(8.dp)
                                .verticalScroll(rememberScrollState()),
                        )
                    }
                }
            },
            confirmButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = {
                            CapyLogger.shareLogText(context, logText, "Capy Paint Debug Log")
                            showDebugLogDialog = false
                        },
                    ) {
                        Text("Share Log")
                    }
                    Button(
                        onClick = {
                            clipboardManager.setText(AnnotatedString(logText))
                            showDebugLogDialog = false
                        },
                    ) {
                        Text("Copy")
                    }
                }
            },
            dismissButton = {
                TextButton(onClick = { showDebugLogDialog = false }) {
                    Text("Close")
                }
            },
        )
    }

    if (showCrashReportDialog && (lastCrash != null)) {
        AlertDialog(
            onDismissRequest = { showCrashReportDialog = false },
            title = { Text("Capy Paint Recent Crash Report") },
            text = {
                Column(modifier = Modifier.fillMaxWidth().height(320.dp)) {
                    Surface(
                        color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.2f),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        Text(
                            text = lastCrash,
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier
                                .padding(8.dp)
                                .verticalScroll(rememberScrollState()),
                        )
                    }
                }
            },
            confirmButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = {
                            CapyLogger.shareLogText(context, lastCrash, "Capy Paint Crash Report")
                            showCrashReportDialog = false
                        },
                    ) {
                        Text("Share Crash")
                    }
                    Button(
                        onClick = {
                            clipboardManager.setText(AnnotatedString(lastCrash))
                            showCrashReportDialog = false
                        },
                    ) {
                        Text("Copy")
                    }
                }
            },
            dismissButton = {
                Row {
                    TextButton(
                        onClick = {
                            CapyLogger.clearCrashDump(context)
                            showCrashReportDialog = false
                        },
                    ) {
                        Text("Clear Dump", color = MaterialTheme.colorScheme.error)
                    }
                    TextButton(onClick = { showCrashReportDialog = false }) {
                        Text("Close")
                    }
                }
            }
        )
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        dragHandle = null,
        containerColor = MaterialTheme.colorScheme.surface,
        modifier = Modifier.fillMaxSize()
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
        ) {
            // Header Bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 20.dp, end = 12.dp, top = 8.dp, bottom = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.Settings,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(24.dp)
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Text(
                        text = "Capy Settings & Controls",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                }
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, contentDescription = "Close")
                }
            }

            HorizontalDivider()

            // Tab Navigation
            val tabs = listOf(
                Pair("Settings", AppIcons.Tune),
                Pair("Hints", AppIcons.Lightbulb),
                Pair("Create", Icons.Default.Refresh),
                Pair("Saves", AppIcons.Save)
            )

            ScrollableTabRow(
                selectedTabIndex = selectedTab,
                edgePadding = 16.dp,
                divider = {}
            ) {
                tabs.forEachIndexed { index, pair ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        text = { Text(pair.first, fontWeight = if (selectedTab == index) FontWeight.Bold else FontWeight.Normal) },
                        icon = { Icon(pair.second, contentDescription = pair.first, modifier = Modifier.size(18.dp)) }
                    )
                }
            }

            HorizontalDivider()

            // Tab Content
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            ) {
                when (selectedTab) {
                    0 -> SettingsTabContent(
                        settings = settings,
                        onUpdateSettings = onUpdateSettings
                    )
                    1 -> HintsTabContent(
                        settings = settings,
                        onUpdateSettings = onUpdateSettings
                    )
                    2 -> CreateGeneratorTabContent(
                        settings = settings,
                        originalBitmap = originalBitmap,
                        onUpdateSettings = onUpdateSettings,
                        onRegenerate = {
                            onDismiss()
                            onRegenerate()
                        },
                        onPickImage = {
                            onDismiss()
                            onPickImage()
                        },
                        onTakePhoto = {
                            onDismiss()
                            onTakePhoto()
                        },
                        onSelectSample = {
                            onDismiss()
                            onSelectSample(it)
                        },
                        onShowDebugLog = { showDebugLogDialog = true },
                        onShowCrashLog = { showCrashReportDialog = true },
                        hasCrashDump = lastCrash != null
                    )
                    3 -> SavesTabContent(
                        snapshots = snapshots,
                        puzzle = puzzle,
                        filledRegionIds = filledRegionIds,
                        saveSortOrder = settings.saveSortOrder,
                        showSavePreviews = settings.showSavePreviews,
                        onUpdateSaveSortOrder = { onUpdateSettings(settings.copy(saveSortOrder = it)) },
                        onToggleSavePreviews = { onUpdateSettings(settings.copy(showSavePreviews = it)) },
                        onLoadSnapshot = {
                            onLoadSnapshot(it)
                            onDismiss()
                        },
                        onRenameSnapshot = onRenameSnapshot,
                        onDeleteSnapshot = onDeleteSnapshot,
                        onClearAllSnapshots = onClearAllSnapshots,
                        onResetProgress = {
                            onResetProgress()
                            onDismiss()
                        },
                        onGetSnapshotFileSize = onGetSnapshotFileSize,
                        onGetSnapshotPreview = onGetSnapshotPreview
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SettingsTabContent(
    settings: UserSettings,
    onUpdateSettings: (UserSettings) -> Unit
) {
    var activeTooltip by remember { mutableStateOf<Pair<String, String>?>(null) }

    if (activeTooltip != null) {
        AlertDialog(
            onDismissRequest = { activeTooltip = null },
            icon = { Icon(Icons.Default.Info, contentDescription = null, tint = MaterialTheme.colorScheme.primary) },
            title = { Text(activeTooltip!!.first, fontWeight = FontWeight.Bold) },
            text = { Text(activeTooltip!!.second, style = MaterialTheme.typography.bodyMedium) },
            confirmButton = {
                TextButton(onClick = { activeTooltip = null }) {
                    Text("Got it")
                }
            }
        )
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            SectionHeader(title = "Play Style & Controls")
        }

        // Region Fill Style Card
        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)),
                shape = RoundedCornerShape(10.dp)
            ) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    OptionHeaderWithInfo(
                        title = "Region Fill Style",
                        infoDescription = "Choose how regions fill when painted: Solid Fill uses flat palette colors, while Original Detail restores full photo texture.",
                        onShowInfo = { title, desc -> activeTooltip = Pair(title, desc) },
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        RegionColorMode.entries.forEach { mode ->
                            val isSelected = settings.regionColorMode == mode
                            StyledFilterChip(
                                selected = isSelected,
                                onClick = { onUpdateSettings(settings.copy(regionColorMode = mode)) },
                                label = mode.label
                            )
                        }
                    }
                }
            }
        }

        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)),
                shape = RoundedCornerShape(10.dp)
            ) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    OptionHeaderWithInfo(
                        title = "Tap Forgiveness / Difficulty",
                        infoDescription = "Easy mode selects and fills any tapped region immediately. Precise mode requires selecting the matching color swatch first.",
                        onShowInfo = { title, desc -> activeTooltip = Pair(title, desc) }
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Difficulty.entries.forEach { diff ->
                            val isSelected = settings.difficulty == diff
                            StyledFilterChip(
                                selected = isSelected,
                                onClick = { onUpdateSettings(settings.copy(difficulty = diff)) },
                                label = diff.label
                            )
                        }
                    }
                }
            }
        }

        // Palette Swatch Order under Play Style & Controls
        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)),
                shape = RoundedCornerShape(10.dp)
            ) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    OptionHeaderWithInfo(
                        title = "Colour Order",
                        infoDescription = "Sort colours numerically, by remaining regions count, by Rainbow Hue, or by Lightness. Display numbers update to reflect the chosen order.",
                        onShowInfo = { title, desc -> activeTooltip = Pair(title, desc) }
                    )
                    FlowRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        PaletteSortOrder.entries.forEach { order ->
                            val isSelected = settings.paletteSort == order
                            StyledFilterChip(
                                selected = isSelected,
                                onClick = { onUpdateSettings(settings.copy(paletteSort = order)) },
                                label = order.label
                            )
                        }
                    }
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Prioritise On-Screen Colours",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Switch(
                            checked = settings.prioritizeOnScreen,
                            onCheckedChange = { onUpdateSettings(settings.copy(prioritizeOnScreen = it)) }
                        )
                    }
                }
            }
        }

        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)),
                shape = RoundedCornerShape(10.dp)
            ) {
                Column(modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    SettingSwitchItem(
                        title = "Onscreen Zoom Buttons",
                        subtitle = "Displays floating + and - controls on screen for single-finger zoom",
                        checked = settings.showZoomButtons,
                        onCheckedChange = { onUpdateSettings(settings.copy(showZoomButtons = it)) },
                        onShowInfo = { title, desc -> activeTooltip = Pair(title, desc) }
                    )
                }
            }
        }

        item {
            SectionHeader(title = "UI")
        }

        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)),
                shape = RoundedCornerShape(10.dp)
            ) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                    OptionHeaderWithInfo(
                        title = "Number Label Size (${(20f * settings.labelScale).toInt()} px)",
                        infoDescription = "Adjust base font size of region numbers displayed on the canvas.",
                        onShowInfo = { title, desc -> activeTooltip = Pair(title, desc) }
                    )
                    Slider(
                        value = settings.labelScale,
                        onValueChange = { onUpdateSettings(settings.copy(labelScale = it)) },
                        valueRange = 0.6f..1.8f,
                        steps = 11
                    )
                }
            }
        }

        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)),
                shape = RoundedCornerShape(10.dp)
            ) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    OptionHeaderWithInfo(
                        title = "Canvas Background",
                        infoDescription = "Select canvas background color behind unfilled artwork.",
                        onShowInfo = { title, desc -> activeTooltip = Pair(title, desc) }
                    )
                    ColorSwatchPicker(
                        selectedArgb = settings.canvasBgArgb,
                        onColorSelected = { argb ->
                            val bgEnum = CanvasBgColor.fromArgb(argb)
                            onUpdateSettings(settings.copy(canvasBgArgb = argb, canvasBgColor = bgEnum))
                        },
                        dialogTitle = "Choose Custom Canvas Background"
                    )
                }
            }
        }

        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)),
                shape = RoundedCornerShape(10.dp)
            ) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    OptionHeaderWithInfo(
                        title = "Theme Appearance",
                        infoDescription = "Choose app user interface visual theme.",
                        onShowInfo = { title, desc -> activeTooltip = Pair(title, desc) }
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        ThemeMode.entries.forEach { mode ->
                            val isSelected = settings.themeMode == mode
                            StyledFilterChip(
                                selected = isSelected,
                                onClick = { onUpdateSettings(settings.copy(themeMode = mode)) },
                                label = mode.label
                            )
                        }
                    }
                }
            }
        }

        item {
            SettingSwitchItem(
                title = "Leave gap at bottom",
                subtitle = "Offset swatches higher to avoid system navigation gestures",
                checked = settings.raisePaletteDock,
                onCheckedChange = { onUpdateSettings(settings.copy(raisePaletteDock = it)) },
                onShowInfo = { title, desc -> activeTooltip = Pair(title, desc) }
            )
        }

        item {
            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HintsTabContent(
    settings: UserSettings,
    onUpdateSettings: (UserSettings) -> Unit
) {
    var activeTooltip by remember { mutableStateOf<Pair<String, String>?>(null) }

    if (activeTooltip != null) {
        AlertDialog(
            onDismissRequest = { activeTooltip = null },
            icon = { Icon(Icons.Default.Info, contentDescription = null, tint = MaterialTheme.colorScheme.primary) },
            title = { Text(activeTooltip!!.first, fontWeight = FontWeight.Bold) },
            text = { Text(activeTooltip!!.second, style = MaterialTheme.typography.bodyMedium) },
            confirmButton = {
                TextButton(onClick = { activeTooltip = null }) {
                    Text("Got it")
                }
            }
        )
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            SectionHeader(title = "Assists & Visual Hints")
        }

        item {
            SettingSwitchItem(
                title = "Show numbers on regions",
                subtitle = "Displays color number IDs centered inside each uncompleted region",
                checked = settings.showRegionLabels,
                onCheckedChange = { onUpdateSettings(settings.copy(showRegionLabels = it)) },
                onShowInfo = { title, desc -> activeTooltip = Pair(title, desc) }
            )
        }

        item {
            SettingSwitchItem(
                title = "Highlight active colour regions",
                subtitle = "Shows subtle glowing highlights over all uncompleted regions matching the active color",
                checked = settings.highlightMatching,
                onCheckedChange = { onUpdateSettings(settings.copy(highlightMatching = it)) },
                onShowInfo = { title, desc -> activeTooltip = Pair(title, desc) }
            )
        }

        item {
            SettingSwitchItem(
                title = "Animate hint pulses",
                subtitle = "Pulses glowing highlights smoothly for active regions and hint targets",
                checked = settings.animateHint,
                onCheckedChange = { onUpdateSettings(settings.copy(animateHint = it)) },
                onShowInfo = { title, desc -> activeTooltip = Pair(title, desc) }
            )
        }

        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)),
                shape = RoundedCornerShape(10.dp)
            ) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f).padding(end = 8.dp)) {
                            Text(
                                text = "Show Next Region Hint",
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Medium,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            Text(
                                text = "Pans to center the next region when requesting a hint",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Switch(
                            checked = settings.showNextRegionHint,
                            onCheckedChange = { onUpdateSettings(settings.copy(showNextRegionHint = it)) }
                        )
                    }
                }
            }
        }

        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)),
                shape = RoundedCornerShape(10.dp)
            ) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                    OptionHeaderWithInfo(
                        title = "Hint Intensity",
                        infoDescription = "Adjust opacity and brightness of region highlight pulses.",
                        onShowInfo = { title, desc -> activeTooltip = Pair(title, desc) }
                    )
                    Slider(
                        value = settings.hintIntensity,
                        onValueChange = { onUpdateSettings(settings.copy(hintIntensity = it)) },
                        valueRange = 0.2f..1.0f,
                        steps = 7
                    )
                }
            }
        }

        item {
            SectionHeader(title = "Highlight & Overlay Styles")
        }

        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)),
                shape = RoundedCornerShape(10.dp)
            ) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    OptionHeaderWithInfo(
                        title = "Highlight Style",
                        infoDescription = "Customize how uncompleted regions and active colors are highlighted on the canvas.",
                        onShowInfo = { title, desc -> activeTooltip = Pair(title, desc) }
                    )
                    FlowRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        RegionHighlightStyle.entries.forEach { style ->
                            val isSelected = settings.highlightStyle == style
                            StyledFilterChip(
                                selected = isSelected,
                                onClick = { onUpdateSettings(settings.copy(highlightStyle = style)) },
                                label = style.label
                            )
                        }
                    }

                    if ((settings.highlightStyle == RegionHighlightStyle.FULL_REGION) || (settings.highlightStyle == RegionHighlightStyle.BOUNDARY_ONLY)) {
                        HorizontalDivider(
                            modifier = Modifier.padding(vertical = 4.dp),
                            color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)
                        )

                        Text(
                            text = "Fill Pattern Style",
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        FlowRow(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            HintFillStyle.entries.forEach { pattern ->
                                val isSelected = settings.hintFillStyle == pattern
                                StyledFilterChip(
                                    selected = isSelected,
                                    onClick = { onUpdateSettings(settings.copy(hintFillStyle = pattern)) },
                                    label = pattern.label
                                )
                            }
                        }

                        ColorSwatchPicker(
                            title = "Fill Colour",
                            selectedArgb = settings.hintColorArgb,
                            onColorSelected = { argb ->
                                onUpdateSettings(settings.copy(hintColorArgb = argb))
                            },
                            dialogTitle = "Choose Custom Hint Colour"
                        )
                    }
                }
            }
        }

        item {
            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CreateGeneratorTabContent(
    settings: UserSettings,
    originalBitmap: Bitmap? = null,
    onUpdateSettings: (UserSettings) -> Unit,
    onRegenerate: () -> Unit,
    onPickImage: () -> Unit,
    onTakePhoto: () -> Unit = {},
    @Suppress("unused") onSelectSample: (SampleArtwork) -> Unit = {},
    onShowDebugLog: () -> Unit = {},
    onShowCrashLog: () -> Unit = {},
    hasCrashDump: Boolean = false
) {
    var activeTooltip by remember { mutableStateOf<Pair<String, String>?>(null) }

    if (activeTooltip != null) {
        AlertDialog(
            onDismissRequest = { activeTooltip = null },
            icon = { Icon(Icons.Default.Info, contentDescription = null, tint = MaterialTheme.colorScheme.primary) },
            title = { Text(activeTooltip!!.first, fontWeight = FontWeight.Bold) },
            text = { Text(activeTooltip!!.second, style = MaterialTheme.typography.bodyMedium) },
            confirmButton = {
                TextButton(onClick = { activeTooltip = null }) {
                    Text("Got it")
                }
            }
        )
    }

    val gen = settings.generatorConfig
    val maxSourceDim = if (originalBitmap != null) {
        maxOf(originalBitmap.width, originalBitmap.height, 2048)
    } else {
        2048
    }
    val defaultHalfRes = (maxSourceDim / 2).coerceAtLeast(240)

    val currentRes = gen.resolution.coerceIn(240, maxSourceDim)
    val activeMinOption = MinRegionOption.fromArea(gen.minRegionArea, currentRes)

    Column(modifier = Modifier.fillMaxSize()) {
        // Pinned Top Action Buttons Row (Always visible at top of Create tab)
        Surface(
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Button(
                    onClick = onRegenerate,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(10.dp),
                    contentPadding = PaddingValues(horizontal = 4.dp, vertical = 8.dp)
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Regenerate", fontSize = 12.sp, maxLines = 1)
                }

                OutlinedButton(
                    onClick = onPickImage,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(10.dp),
                    contentPadding = PaddingValues(horizontal = 4.dp, vertical = 8.dp)
                ) {
                    Icon(AppIcons.AddPhotoAlternate, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Import Image", fontSize = 12.sp, maxLines = 1)
                }

                OutlinedButton(
                    onClick = onTakePhoto,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(10.dp),
                    contentPadding = PaddingValues(horizontal = 4.dp, vertical = 8.dp)
                ) {
                    Icon(AppIcons.PhotoCamera, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Take Photo", fontSize = 12.sp, maxLines = 1)
                }
            }
        }

        HorizontalDivider()

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 14.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
        // Section 1: Image Style / Algorithm
        item {
            SectionHeader(title = "Artwork Style")
        }

        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)),
                shape = RoundedCornerShape(10.dp)
            ) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    OptionHeaderWithInfo(
                        title = "Image Classification",
                        infoDescription = "Choose how artwork lines and edges are analyzed. Drawing mode optimizes for clean line art, while Photo mode optimizes for natural color gradients.",
                        onShowInfo = { title, desc -> activeTooltip = Pair(title, desc) }
                    )
                    FlowRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        ImageType.entries.forEach { type ->
                            val isSelected = gen.imageType == type
                            StyledFilterChip(
                                selected = isSelected,
                                onClick = {
                                    onUpdateSettings(
                                        settings.copy(
                                            generatorConfig = gen.copy(imageType = type)
                                        )
                                    )
                                },
                                label = type.label
                            )
                        }
                    }
                    Text(
                        text = gen.imageType.description,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 11.sp
                    )
                }
            }
        }

        // Section 2: Palette Detail Level (Low, Medium, High, Auto, Custom)
        item {
            SectionHeader(title = "Palette Detail Level")
        }

        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)),
                shape = RoundedCornerShape(10.dp)
            ) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Colours & Regions", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    FlowRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        PaletteDetail.entries.forEach { detail ->
                            val isSelected = gen.paletteDetail == detail
                            FilterChip(
                                selected = isSelected,
                                onClick = {
                                    val newColorCount = when (detail) {
                                        PaletteDetail.LOW -> 8
                                        PaletteDetail.MEDIUM -> 16
                                        PaletteDetail.HIGH -> 32
                                        PaletteDetail.AUTO -> 18
                                        PaletteDetail.CUSTOM -> gen.colorCount
                                    }
                                    onUpdateSettings(
                                        settings.copy(
                                            generatorConfig = gen.copy(
                                                paletteDetail = detail,
                                                colorCount = newColorCount
                                            )
                                        )
                                    )
                                },
                                label = { Text(detail.label, fontSize = 12.sp) }
                            )
                        }
                    }
                    Text(
                        text = gen.paletteDetail.description,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 11.sp
                    )
                }
            }
        }

        // Manual Fine-Tune Controls (if Custom or expanded)
        if (gen.paletteDetail == PaletteDetail.CUSTOM) {
            item {
                SectionHeader(title = "Manual Fine-Tuning")
            }

            // Slider 1: Palette colours
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("Palette Colours (k)", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                            Text("${gen.colorCount} colours", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary, fontSize = 13.sp)
                        }
                        Slider(
                            value = gen.colorCount.toFloat(),
                            onValueChange = {
                                onUpdateSettings(
                                    settings.copy(
                                        generatorConfig = gen.copy(
                                            paletteDetail = PaletteDetail.CUSTOM,
                                            colorCount = it.toInt()
                                        )
                                    )
                                )
                            },
                            valueRange = 4f..200f
                        )
                    }
                }
            }

            // Slider 2: Minimum Region Area
            item {
                val maxAreaVal = maxOf(2048, ((maxSourceDim * maxSourceDim) * 0.005f).toInt()).coerceAtMost(4096)
                val minLog = 2.0 // log2(4)
                val maxLog = log2(maxAreaVal.toDouble())

                val currentMinArea = gen.minRegionArea.coerceIn(4, maxAreaVal)
                val sliderPos = ((log2(currentMinArea.toDouble()) - minLog) / (maxLog - minLog)).toFloat().coerceIn(0f, 1f)

                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("Region Size", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                            Text("$currentMinArea px²", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary, fontSize = 13.sp)
                        }

                        // Logarithmic Quick Area Presets
                        FlowRow(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            val quickAreaList = listOf(
                                Pair("4 px² (Fine)", 4),
                                Pair("32 px² (Medium)", 32),
                                Pair("128 px² (Large)", 128),
                                Pair("512 px² (Simple)", 512),
                                Pair("2048 px² (Very Simple)", minOf(2048, maxAreaVal))
                            )
                            quickAreaList.forEach { (label, areaVal) ->
                                val isSelected = abs(currentMinArea - areaVal) <= ((areaVal * 0.25).toInt())
                                FilterChip(
                                    selected = isSelected,
                                    onClick = {
                                        onUpdateSettings(
                                            settings.copy(
                                                generatorConfig = gen.copy(
                                                    paletteDetail = PaletteDetail.CUSTOM,
                                                    minRegionArea = areaVal
                                                )
                                            )
                                        )
                                    },
                                    label = { Text(label, fontSize = 11.sp) }
                                )
                            }
                        }

                        Slider(
                            value = sliderPos,
                            onValueChange = { newPos ->
                                val logVal = minLog + (newPos * (maxLog - minLog))
                                val newArea = 2.0.pow(logVal).toInt().coerceIn(4, maxAreaVal)
                                onUpdateSettings(
                                    settings.copy(
                                        generatorConfig = gen.copy(
                                            paletteDetail = PaletteDetail.CUSTOM,
                                            minRegionArea = newArea
                                        )
                                    )
                                )
                            },
                            valueRange = 0f..1f
                        )
                    }
                }
            }

            // Detail Resolution
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        val resText = when {
                            currentRes >= maxSourceDim -> "$currentRes px (Original)"
                            currentRes == defaultHalfRes -> "$currentRes px (Half Original)"
                            else -> "$currentRes px"
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("Detail Resolution", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                            Text(resText, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary, fontSize = 13.sp)
                        }

                        // Resolution Quick Chips
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            val quickResList = listOf(
                                Pair("320 px", 320),
                                Pair("$defaultHalfRes px (Half)", defaultHalfRes),
                                Pair("$maxSourceDim px (Full)", maxSourceDim)
                            )
                            quickResList.forEach { (label, resVal) ->
                                val isSelected = currentRes == resVal
                                FilterChip(
                                    selected = isSelected,
                                    onClick = {
                                        val scaledMinArea = activeMinOption.calculateArea(resVal)
                                        onUpdateSettings(
                                            settings.copy(
                                                generatorConfig = gen.copy(
                                                    paletteDetail = PaletteDetail.CUSTOM,
                                                    resolution = resVal,
                                                    minRegionArea = scaledMinArea
                                                )
                                            )
                                        )
                                    },
                                    label = { Text(label, fontSize = 11.sp) }
                                )
                            }
                        }

                        Slider(
                            value = currentRes.toFloat(),
                            onValueChange = { newResFloat ->
                                val newRes = newResFloat.toInt()
                                val autoScaledMinArea = activeMinOption.calculateArea(newRes)
                                onUpdateSettings(
                                    settings.copy(
                                        generatorConfig = gen.copy(
                                            paletteDetail = PaletteDetail.CUSTOM,
                                            resolution = newRes,
                                            minRegionArea = autoScaledMinArea
                                        )
                                    )
                                )
                            },
                            valueRange = 240f..maxSourceDim.toFloat()
                        )
                    }
                }
            }
        }



        item {
            SectionHeader(title = "Debug & Diagnostics")
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(
                    onClick = onShowDebugLog,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Icon(AppIcons.Tune, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Export Debug Log", fontSize = 12.sp)
                }

                if (hasCrashDump) {
                    Button(
                        onClick = onShowCrashLog,
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                    ) {
                        Text("View Crash Log", fontSize = 12.sp)
                    }
                }
            }
        }

        item {
            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}
}

@Composable
private fun SavesTabContent(
    snapshots: List<SavedSnapshot>,
    @Suppress("unused") puzzle: PuzzleData?,
    @Suppress("unused") filledRegionIds: Set<Int>,
    saveSortOrder: SaveSortOrder,
    showSavePreviews: Boolean,
    onUpdateSaveSortOrder: (SaveSortOrder) -> Unit,
    onToggleSavePreviews: (Boolean) -> Unit,
    onLoadSnapshot: (SavedSnapshot) -> Unit,
    onRenameSnapshot: (String, String) -> Unit,
    onDeleteSnapshot: (String) -> Unit,
    onClearAllSnapshots: () -> Unit,
    onResetProgress: () -> Unit,
    onGetSnapshotFileSize: (String) -> Long = { 0L },
    onGetSnapshotPreview: (String) -> Bitmap? = { null }
) {
    var snapshotToRename by remember { mutableStateOf<SavedSnapshot?>(null) }
    var snapshotToDelete by remember { mutableStateOf<SavedSnapshot?>(null) }
    var showClearAllDialog by remember { mutableStateOf(value = false) }
    var renameText by remember { mutableStateOf("") }
    var sortMenuExpanded by remember { mutableStateOf(value = false) }
    val dateFormat = remember { SimpleDateFormat("MMM d, h:mm a", Locale.getDefault()) }

    if (snapshotToRename != null) {
        AlertDialog(
            onDismissRequest = { snapshotToRename = null },
            title = { Text("Rename Save") },
            text = {
                OutlinedTextField(
                    value = renameText,
                    onValueChange = { renameText = it },
                    singleLine = true,
                    label = { Text("Save Title") },
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        val target = snapshotToRename
                        if ((target != null) && renameText.isNotBlank()) {
                            onRenameSnapshot(target.id, renameText)
                        }
                        snapshotToRename = null
                    }
                ) {
                    Text("Save")
                }
            },
            dismissButton = {
                TextButton(onClick = { snapshotToRename = null }) {
                    Text("Cancel")
                }
            }
        )
    }

    if (snapshotToDelete != null) {
        val target = snapshotToDelete
        AlertDialog(
            onDismissRequest = { snapshotToDelete = null },
            title = { Text("Delete Saved Puzzle?") },
            text = { Text("Are you sure you want to delete '${target?.title}'? This action cannot be undone.") },
            confirmButton = {
                Button(
                    onClick = {
                        target?.let { onDeleteSnapshot(it.id) }
                        snapshotToDelete = null
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { snapshotToDelete = null }) {
                    Text("Cancel")
                }
            }
        )
    }

    if (showClearAllDialog) {
        AlertDialog(
            onDismissRequest = { showClearAllDialog = false },
            title = { Text("Delete All Saved Puzzles?") },
            text = { Text("Are you sure you want to delete all saved puzzles? This action cannot be undone.") },
            confirmButton = {
                Button(
                    onClick = {
                        showClearAllDialog = false
                        onClearAllSnapshots()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) {
                    Text("Delete All")
                }
            },
            dismissButton = {
                TextButton(onClick = { showClearAllDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    val sortedSnapshots = remember(snapshots, saveSortOrder) {
        val distinctSnapshots = snapshots.distinctBy { it.id }
        when (saveSortOrder) {
            SaveSortOrder.LAST_ACTIVE -> distinctSnapshots.sortedByDescending { it.lastOpened }
            SaveSortOrder.PERCENT_COMPLETE -> distinctSnapshots.sortedByDescending { it.progressPercentage }
            SaveSortOrder.DATE -> distinctSnapshots.sortedByDescending { it.timestamp }
        }
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Header Row with Reset Progress & Delete All buttons
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TextButton(onClick = onResetProgress) {
                        Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(15.dp), tint = MaterialTheme.colorScheme.error)
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Reset Progress", color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                    }
                    if (sortedSnapshots.isNotEmpty()) {
                        TextButton(onClick = { showClearAllDialog = true }) {
                            Text("Delete All", color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                        }
                    }
                }
            }
        }

        // Sorting & View Mode Row
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Sort by:", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Box {
                        Surface(
                            onClick = { sortMenuExpanded = true },
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f)
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Text(saveSortOrder.label, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
                                Icon(Icons.Default.ArrowDropDown, contentDescription = "Dropdown", modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
                            }
                        }
                        DropdownMenu(
                            expanded = sortMenuExpanded,
                            onDismissRequest = { sortMenuExpanded = false }
                        ) {
                            SaveSortOrder.entries.forEach { order ->
                                DropdownMenuItem(
                                    text = { Text(order.label, fontSize = 13.sp, fontWeight = if (saveSortOrder == order) FontWeight.Bold else FontWeight.Normal) },
                                    onClick = {
                                        onUpdateSaveSortOrder(order)
                                        sortMenuExpanded = false
                                    }
                                )
                            }
                        }
                    }
                }

                FilterChip(
                    selected = showSavePreviews,
                    onClick = { onToggleSavePreviews(!showSavePreviews) },
                    label = { Text(if (showSavePreviews) "Large Previews" else "Small Previews", fontSize = 11.sp) },
                    leadingIcon = {
                        Icon(
                            if (showSavePreviews) AppIcons.GridView else AppIcons.ViewList,
                            contentDescription = null,
                            modifier = Modifier.size(14.dp)
                        )
                    }
                )
            }
        }

        items(sortedSnapshots, key = { it.id }) { snapshot ->
            val isTopActive = sortedSnapshots.firstOrNull()?.id == snapshot.id
            val isUnstartedSample = snapshot.isAutoSample && (snapshot.lastOpened == 0L)

            val containerColor = if (isTopActive) {
                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f)
            } else {
                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)
            }

            Card(
                colors = CardDefaults.cardColors(containerColor = containerColor),
                shape = RoundedCornerShape(10.dp),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                        val context = LocalContext.current
                        val previewBmp = remember(snapshot.id) {
                            onGetSnapshotPreview(snapshot.id) ?: run {
                                val sampleAsset = snapshot.sampleAssetPath ?: SampleGallery.samples.find { s ->
                                    s.id.equals(snapshot.id, ignoreCase = true) || s.title.equals(snapshot.title, ignoreCase = true)
                                }?.assetPath
                                if (sampleAsset != null) {
                                    try {
                                        context.assets.open(sampleAsset).use { stream ->
                                            BitmapFactory.decodeStream(stream)
                                        }
                                    } catch (_: Exception) {
                                        null
                                    }
                                } else {
                                    null
                                }
                            }
                        }
                        if (previewBmp != null) {
                            val aspect = (previewBmp.width.toFloat() / previewBmp.height.coerceAtLeast(1).toFloat()).coerceIn(0.2f, 5.0f)
                            val imageSizeModifier = if (showSavePreviews) {
                                Modifier
                                    .heightIn(max = 105.dp)
                                    .widthIn(max = 140.dp)
                                    .aspectRatio(aspect)
                                    .clip(RoundedCornerShape(8.dp))
                            } else {
                                Modifier
                                    .heightIn(max = 52.dp)
                                    .widthIn(max = 52.dp)
                                    .aspectRatio(aspect)
                                    .clip(RoundedCornerShape(8.dp))
                            }
                            Box(
                                contentAlignment = Alignment.Center,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(MaterialTheme.colorScheme.surfaceContainerHigh),
                            ) {
                                Image(
                                    bitmap = previewBmp.asImageBitmap(),
                                    contentDescription = null,
                                    modifier = imageSizeModifier,
                                    contentScale = ContentScale.Fit,
                                )
                            }
                            Spacer(modifier = Modifier.width(10.dp))
                        }

                        Column {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(snapshot.title, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium)
                                IconButton(
                                    onClick = {
                                        snapshotToRename = snapshot
                                        renameText = snapshot.title
                                    },
                                    modifier = Modifier.size(24.dp),
                                ) {
                                    Icon(
                                        Icons.Default.Edit,
                                        contentDescription = "Rename",
                                        tint = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.size(15.dp),
                                    )
                                }
                            }
                            val sizeBytes = onGetSnapshotFileSize(snapshot.id)
                            val sizeStr = if (sizeBytes > 0L) {
                                val kb = sizeBytes / 1024.0
                                if (kb < 1024) String.format(Locale.getDefault(), "%.0f KB", kb) else String.format(Locale.getDefault(), "%.1f MB", kb / 1024.0)
                            } else ""
                            val timeStr = if (snapshot.lastOpened > 0L) dateFormat.format(Date(snapshot.lastOpened)) else ""
                            val progressStr = if (!isUnstartedSample) {
                                "${snapshot.progressPercentage}% (${snapshot.filledCount}/${snapshot.totalCount})"
                            } else {
                                null
                            }
                            val subtitleParts = listOfNotNull(
                                progressStr,
                                sizeStr.takeIf { it.isNotEmpty() },
                                timeStr.takeIf { it.isNotEmpty() },
                            )
                            val subtitleText = subtitleParts.joinToString(" • ").ifEmpty { "Sample Artwork" }
                            Text(
                                subtitleText,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }

                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (!isUnstartedSample) {
                            IconButton(
                                onClick = { snapshotToDelete = snapshot },
                                modifier = Modifier.size(32.dp),
                            ) {
                                Icon(Icons.Default.Delete, contentDescription = "Delete", tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(18.dp))
                            }
                        }
                        if (!isTopActive) {
                            Button(
                                onClick = { onLoadSnapshot(snapshot) },
                                shape = RoundedCornerShape(8.dp),
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 5.dp),
                            ) {
                                Text("Load", fontSize = 12.sp)
                            }
                        }
                    }
                }
            }
        }

        item {
            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 4.dp, bottom = 4.dp)
    )
}

@Composable
private fun OptionHeaderWithInfo(
    title: String,
    infoDescription: String? = null,
    onShowInfo: ((String, String) -> Unit)? = null
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        if ((infoDescription != null) && (onShowInfo != null)) {
            IconButton(
                onClick = { onShowInfo(title, infoDescription) },
                modifier = Modifier.size(22.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Info,
                    contentDescription = "Info",
                    tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.85f),
                    modifier = Modifier.size(16.dp)
                )
            }
        }
    }
}

@Composable
private fun StyledFilterChip(
    selected: Boolean,
    onClick: () -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    leadingIcon: @Composable (() -> Unit)? = null
) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        modifier = modifier,
        label = {
            Text(
                text = label,
                fontSize = 12.sp,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium
            )
        },
        leadingIcon = leadingIcon,
        border = FilterChipDefaults.filterChipBorder(
            enabled = true,
            selected = selected,
            borderColor = if (selected) Color(0xFFF97316) else MaterialTheme.colorScheme.outline.copy(alpha = 0.4f),
            selectedBorderColor = Color(0xFFF97316),
            selectedBorderWidth = 2.dp
        ),
        colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = Color(0xFFEA580C).copy(alpha = 0.22f),
            selectedLabelColor = MaterialTheme.colorScheme.onSurface,
            selectedLeadingIconColor = Color(0xFFEA580C)
        )
    )
}

@Composable
private fun SettingSwitchItem(
    title: String,
    subtitle: String? = null,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    onShowInfo: ((String, String) -> Unit)? = null
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)),
        shape = RoundedCornerShape(10.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(end = 8.dp)
                    .then(
                        if ((subtitle != null) && (onShowInfo != null)) {
                            Modifier.clickable { onShowInfo(title, subtitle) }
                        } else Modifier,
                    )
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                    if ((subtitle != null) && (onShowInfo != null)) {
                        Icon(
                            imageVector = Icons.Default.Info,
                            contentDescription = "Info",
                            tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.85f),
                            modifier = Modifier.size(15.dp)
                        )
                    }
                }
                if (!subtitle.isNullOrBlank()) {
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Switch(checked = checked, onCheckedChange = onCheckedChange)
        }
    }
}

private val PRESET_SWATCH_COLORS = listOf(
    Pair("Deep Black", 0xFF000000.toInt()),
    Pair("Dark Slate", 0xFF0F172A.toInt()),
    Pair("Charcoal", 0xFF18181B.toInt()),
    Pair("Dark Brown", 0xFF3B2F2F.toInt()),
    Pair("Deep Purple", 0xFF311B92.toInt()),
    Pair("Dark Navy", 0xFF0B192C.toInt()),
    Pair("Dark Green", 0xFF14532D.toInt()),
    Pair("Grey", 0xFF6B7280.toInt()),
    Pair("Light Slate", 0xFF94A3B8.toInt()),
    Pair("Light Gray", 0xFFE2E8F0.toInt()),
    Pair("Pure White", 0xFFFFFFFF.toInt()),
    Pair("Gold", 0xFFFBBF24.toInt()),
    Pair("Yellow", 0xFFFACC15.toInt()),
    Pair("Orange", 0xFFF97316.toInt()),
    Pair("Coral", 0xFFFB7185.toInt()),
    Pair("Pink", 0xFFF472B6.toInt()),
    Pair("Violet", 0xFFA855F7.toInt()),
    Pair("Indigo", 0xFF6366F1.toInt()),
    Pair("Cyan", 0xFF38BDF8.toInt()),
    Pair("Teal", 0xFF14B8A6.toInt()),
    Pair("Green", 0xFF34D399.toInt()),
    Pair("Lime", 0xFFA3E635.toInt())
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ColorSwatchPicker(
    selectedArgb: Int,
    onColorSelected: (Int) -> Unit,
    dialogTitle: String,
    modifier: Modifier = Modifier,
    title: String? = null
) {
    var showColorPickerDialog by remember { mutableStateOf(value = false) }

    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        title?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(top = 4.dp),
            )
        }

        val isCustomSelected = remember(selectedArgb) {
            PRESET_SWATCH_COLORS.none { it.second == selectedArgb }
        }

        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            PRESET_SWATCH_COLORS.forEach { (_, colorArgb) ->
                val isSelected = selectedArgb == colorArgb
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .background(Color(colorArgb))
                        .border(
                            width = if (isSelected) 2.5.dp else 1.dp,
                            color = if (isSelected) MaterialTheme.colorScheme.primary else Color.Black.copy(alpha = 0.3f),
                            shape = CircleShape
                        )
                        .clickable { onColorSelected(colorArgb) },
                    contentAlignment = Alignment.Center
                ) {
                    if (isSelected) {
                        val r = (colorArgb shr 16) and 0xFF
                        val g = (colorArgb shr 8) and 0xFF
                        val b = colorArgb and 0xFF
                        val isLight = (((0.299f * r) + (0.587f * g) + (0.114f * b))) > 128
                        Icon(
                            imageVector = Icons.Default.Check,
                            contentDescription = "Selected",
                            modifier = Modifier.size(16.dp),
                            tint = if (isLight) Color.Black else Color.White
                        )
                    }
                }
            }

            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(CircleShape)
                    .background(
                        brush = Brush.sweepGradient(
                            listOf(
                                Color(0xFFFF0000),
                                Color(0xFFFFFF00),
                                Color(0xFF00FF00),
                                Color(0xFF00FFFF),
                                Color(0xFF0000FF),
                                Color(0xFFFF00FF),
                                Color(0xFFFF0000)
                            )
                        )
                    )
                    .border(
                        width = if (isCustomSelected) 2.5.dp else 1.dp,
                        color = if (isCustomSelected) MaterialTheme.colorScheme.primary else Color.Black.copy(alpha = 0.3f),
                        shape = CircleShape
                    )
                    .clickable { showColorPickerDialog = true },
                contentAlignment = Alignment.Center
            ) {
                Box(
                    modifier = Modifier
                        .size(20.dp)
                        .clip(CircleShape)
                        .background(Color(selectedArgb))
                        .border(0.5.dp, Color.White.copy(alpha = 0.8f), CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    val r = (selectedArgb shr 16) and 0xFF
                    val g = (selectedArgb shr 8) and 0xFF
                    val b = selectedArgb and 0xFF
                    val isLight = (((0.299f * r) + (0.587f * g) + (0.114f * b))) > 128
                    Icon(
                        imageVector = AppIcons.Tune,
                        contentDescription = "Custom Colour Picker",
                        modifier = Modifier.size(12.dp),
                        tint = if (isLight) Color.Black else Color.White
                    )
                }
            }
        }
    }

    if (showColorPickerDialog) {
        val initialHsv = remember(selectedArgb) {
            FloatArray(3).also { android.graphics.Color.colorToHSV(selectedArgb, it) }
        }
        var hue by remember { mutableFloatStateOf(initialHsv[0]) }
        var saturation by remember { mutableFloatStateOf(initialHsv[1]) }
        var value by remember { mutableFloatStateOf(initialHsv[2]) }

        val currentCustomArgb = remember(hue, saturation, value) {
            android.graphics.Color.HSVToColor(floatArrayOf(hue, saturation, value))
        }
        val currentCustomColor = Color(currentCustomArgb)

        AlertDialog(
            onDismissRequest = { showColorPickerDialog = false },
            title = { Text(dialogTitle) },
            text = {
                Column(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(currentCustomColor)
                            .border(1.5.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp)),
                        contentAlignment = Alignment.Center
                    ) {
                        val r = (currentCustomArgb shr 16) and 0xFF
                        val g = (currentCustomArgb shr 8) and 0xFF
                        val b = currentCustomArgb and 0xFF
                        val isLight = (((0.299f * r) + (0.587f * g) + (0.114f * b))) > 128
                        Text(
                            text = String.format(Locale.US, "#%02X%02X%02X", r, g, b),
                            color = if (isLight) Color.Black else Color.White,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("Hue (Colour)", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                            Text("${hue.toInt()}°", style = MaterialTheme.typography.labelMedium)
                        }
                        GradientSliderWithIndicator(
                            value = hue,
                            onValueChange = { hue = it },
                            valueRange = 0f..360f,
                            backgroundBrush = Brush.horizontalGradient(
                                listOf(
                                    Color(0xFFFF0000),
                                    Color(0xFFFFFF00),
                                    Color(0xFF00FF00),
                                    Color(0xFF00FFFF),
                                    Color(0xFF0000FF),
                                    Color(0xFFFF00FF),
                                    Color(0xFFFF0000)
                                )
                            )
                        )
                    }

                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("Saturation", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                            Text("${(saturation * 100).toInt()}%", style = MaterialTheme.typography.labelMedium)
                        }
                        GradientSliderWithIndicator(
                            value = saturation,
                            onValueChange = { saturation = it },
                            valueRange = 0f..1f,
                            backgroundBrush = Brush.horizontalGradient(
                                listOf(
                                    Color.hsv(hue, 0f, value),
                                    Color.hsv(hue, 1f, value)
                                )
                            )
                        )
                    }

                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("Brightness", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                            Text("${(value * 100).toInt()}%", style = MaterialTheme.typography.labelMedium)
                        }
                        GradientSliderWithIndicator(
                            value = value,
                            onValueChange = { value = it },
                            valueRange = 0f..1f,
                            backgroundBrush = Brush.horizontalGradient(
                                listOf(
                                    Color.hsv(hue, saturation, 0f),
                                    Color.hsv(hue, saturation, 1f)
                                )
                            )
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        onColorSelected(currentCustomArgb)
                        showColorPickerDialog = false
                    }
                ) {
                    Text("Apply Colour")
                }
            },
            dismissButton = {
                TextButton(onClick = { showColorPickerDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }
}

@Composable
private fun GradientSliderWithIndicator(
    value: Float,
    onValueChange: (Float) -> Unit,
    valueRange: ClosedFloatingPointRange<Float>,
    backgroundBrush: Brush
) {
    BoxWithConstraints(
        modifier = Modifier
            .fillMaxWidth()
            .height(32.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(backgroundBrush)
            .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.5f), RoundedCornerShape(8.dp)),
        contentAlignment = Alignment.Center
    ) {
        val density = LocalDensity.current
        val widthPx = with(density) { this@BoxWithConstraints.maxWidth.toPx() }
        val fraction = if (valueRange.endInclusive > valueRange.start) {
            ((value - valueRange.start) / (valueRange.endInclusive - valueRange.start)).coerceIn(0f, 1f)
        } else 0f

        val edgePaddingDp = 12.dp
        val edgePaddingPx = with(density) { edgePaddingDp.toPx() }
        val lineXPx = edgePaddingPx + (fraction * (widthPx - (2 * edgePaddingPx)))
        val lineXDp = with(density) { lineXPx.toDp() }

        Box(
            modifier = Modifier
                .align(Alignment.CenterStart)
                .offset(x = lineXDp - 2.5.dp)
                .width(5.dp)
                .height(28.dp)
                .clip(RoundedCornerShape(2.5.dp))
                .background(Color.White)
                .border(1.dp, Color.Black.copy(alpha = 0.8f), RoundedCornerShape(2.5.dp))
        )

        Slider(
            value = value,
            onValueChange = onValueChange,
            valueRange = valueRange,
            colors = SliderDefaults.colors(
                thumbColor = Color.Transparent,
                activeTrackColor = Color.Transparent,
                inactiveTrackColor = Color.Transparent
            ),
            modifier = Modifier.fillMaxWidth()
        )
    }
}
