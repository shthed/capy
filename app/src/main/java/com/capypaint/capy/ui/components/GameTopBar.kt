package com.capypaint.capy.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.capypaint.capy.R
import com.capypaint.capy.ui.icons.AppIcons

@Composable
fun FloatingIconButton(
    onClick: () -> Unit,
    icon: ImageVector,
    contentDescription: String,
    modifier: Modifier = Modifier,
    tint: Color = MaterialTheme.colorScheme.onSurface,
    containerColor: Color? = null,
) {
    Surface(
        onClick = onClick,
        modifier = modifier.size(40.dp),
        shape = CircleShape,
        color = containerColor ?: MaterialTheme.colorScheme.surface.copy(alpha = 0.82f),
        tonalElevation = 3.dp,
        shadowElevation = 2.dp,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                imageVector = icon,
                contentDescription = contentDescription,
                tint = tint,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

@Composable
fun GameTopBar(
    isPreviewMode: Boolean,
    progressPercentage: Int,
    onPickImage: () -> Unit,
    onTogglePreview: () -> Unit,
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier,
    activeSaveTitle: String? = null,
    isCompleted: Boolean = false,
    onOpenSaves: () -> Unit = {},
    @Suppress("unused") onRestart: () -> Unit = {},
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.End,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Single clean percentage/title pill badge (taps go directly to Saves page)
            Surface(
                onClick = onOpenSaves,
                shape = RoundedCornerShape(12.dp),
                color = if (isCompleted) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface.copy(alpha = 0.85f),
                tonalElevation = 3.dp,
                shadowElevation = 2.dp,
            ) {
                Text(
                    text = if (!activeSaveTitle.isNullOrBlank()) "$activeSaveTitle • $progressPercentage%" else "$progressPercentage%",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.ExtraBold,
                    color = if (isCompleted) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                )
            }

            FloatingIconButton(
                onClick = onTogglePreview,
                icon = if (isPreviewMode) AppIcons.VisibilityOff else AppIcons.Visibility,
                contentDescription = stringResource(R.string.menu_preview),
                tint = if (isPreviewMode) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
            )
            FloatingIconButton(
                onClick = onPickImage,
                icon = AppIcons.AddPhotoAlternate,
                contentDescription = stringResource(R.string.menu_pick_image),
            )
            FloatingIconButton(
                onClick = onOpenSettings,
                icon = Icons.Default.Settings,
                contentDescription = stringResource(R.string.menu_settings),
            )
        }
    }
}
