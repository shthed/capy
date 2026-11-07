package com.capypaint.capy.ui.icons

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * Custom lightweight ImageVector definitions for icons previously imported from
 * `material-icons-extended` to reduce build size and bytecode bloat.
 */
object AppIcons {
    val Visibility: ImageVector by lazy {
        ImageVector.Builder(
            name = "Visibility",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(fill = SolidColor(Color.Black)) {
                moveTo(12f, 4.5f)
                curveTo(7f, 4.5f, 2.73f, 7.61f, 1f, 12f)
                curveTo(2.73f, 16.39f, 7f, 19.5f, 12f, 19.5f)
                curveTo(17f, 19.5f, 21.27f, 16.39f, 23f, 12f)
                curveTo(21.27f, 7.61f, 17f, 4.5f, 12f, 4.5f)
                close()
                moveTo(12f, 17f)
                curveTo(9.24f, 17f, 7f, 14.76f, 7f, 12f)
                curveTo(7f, 9.24f, 9.24f, 7f, 12f, 7f)
                curveTo(14.76f, 7f, 17f, 9.24f, 17f, 12f)
                curveTo(17f, 14.76f, 14.76f, 17f, 12f, 17f)
                close()
                moveTo(12f, 9f)
                curveTo(10.34f, 9f, 9f, 10.34f, 9f, 12f)
                curveTo(9f, 13.66f, 10.34f, 15f, 12f, 15f)
                curveTo(13.66f, 15f, 15f, 13.66f, 15f, 12f)
                curveTo(15f, 10.34f, 13.66f, 9f, 12f, 9f)
                close()
            }
        }.build()
    }

    val VisibilityOff: ImageVector by lazy {
        ImageVector.Builder(
            name = "VisibilityOff",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(fill = SolidColor(Color.Black)) {
                moveTo(12f, 7f)
                curveTo(14.76f, 7f, 17f, 9.24f, 17f, 12f)
                curveTo(17f, 12.64f, 16.87f, 13.26f, 16.64f, 13.82f)
                lineTo(19.57f, 16.75f)
                curveTo(21.07f, 15.5f, 22.27f, 13.86f, 23f, 12f)
                curveTo(21.27f, 7.61f, 17f, 4.5f, 12f, 4.5f)
                curveTo(10.73f, 4.5f, 9.51f, 4.75f, 8.39f, 5.21f)
                lineTo(10.18f, 7f)
                curveTo(10.74f, 6.87f, 11.36f, 6.8f, 12f, 6.8f)
                close()
                moveTo(3.27f, 2.27f)
                lineTo(2f, 3.54f)
                lineTo(5.17f, 6.71f)
                curveTo(3.46f, 8.08f, 2.05f, 9.9f, 1f, 12f)
                curveTo(2.73f, 16.39f, 7f, 19.5f, 12f, 19.5f)
                curveTo(13.88f, 19.5f, 15.65f, 19.04f, 17.21f, 18.23f)
                lineTo(20.46f, 21.48f)
                lineTo(21.73f, 20.21f)
                lineTo(3.27f, 2.27f)
                close()
                moveTo(12f, 17f)
                curveTo(9.24f, 17f, 7f, 14.76f, 7f, 12f)
                curveTo(7f, 11.23f, 7.23f, 10.52f, 7.62f, 9.93f)
                lineTo(14.07f, 16.38f)
                curveTo(13.48f, 16.77f, 12.77f, 17f, 12f, 17f)
                close()
            }
        }.build()
    }

    val AddPhotoAlternate: ImageVector by lazy {
        ImageVector.Builder(
            name = "AddPhotoAlternate",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(fill = SolidColor(Color.Black)) {
                moveTo(19f, 7f)
                verticalLineTo(4f)
                horizontalLineTo(17f)
                verticalLineTo(2f)
                horizontalLineTo(19f)
                verticalLineTo(0f)
                horizontalLineTo(21f)
                verticalLineTo(2f)
                horizontalLineTo(23f)
                verticalLineTo(4f)
                horizontalLineTo(21f)
                verticalLineTo(7f)
                horizontalLineTo(19f)
                close()
                moveTo(16f, 9f)
                verticalLineTo(6f)
                horizontalLineTo(13f)
                verticalLineTo(4f)
                horizontalLineTo(5f)
                curveTo(3.9f, 4f, 3f, 4.9f, 3f, 6f)
                verticalLineTo(18f)
                curveTo(3f, 19.1f, 3.9f, 20f, 5f, 20f)
                horizontalLineTo(19f)
                curveTo(20.1f, 20f, 21f, 19.1f, 21f, 18f)
                verticalLineTo(11f)
                horizontalLineTo(19f)
                verticalLineTo(18f)
                horizontalLineTo(5f)
                lineTo(8.5f, 13.5f)
                lineTo(11f, 16.5f)
                lineTo(14.5f, 12f)
                lineTo(16f, 14f)
                verticalLineTo(9f)
                close()
            }
        }.build()
    }

    val Brush: ImageVector by lazy {
        ImageVector.Builder(
            name = "Brush",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(fill = SolidColor(Color.Black)) {
                moveTo(7f, 14f)
                curveTo(5.9f, 14f, 5f, 14.9f, 5f, 16f)
                curveTo(5f, 17.1f, 5.9f, 18f, 7f, 18f)
                curveTo(8.1f, 18f, 9f, 17.1f, 9f, 16f)
                curveTo(9f, 14.9f, 8.1f, 14f, 7f, 14f)
                close()
                moveTo(20.71f, 4.63f)
                lineTo(19.37f, 3.29f)
                curveTo(18.98f, 2.9f, 18.35f, 2.9f, 17.96f, 3.29f)
                lineTo(9f, 12.25f)
                verticalLineTo(15f)
                horizontalLineTo(11.75f)
                lineTo(20.71f, 6.04f)
                curveTo(21.1f, 5.65f, 21.1f, 5.02f, 20.71f, 4.63f)
                close()
            }
        }.build()
    }

    val GridView: ImageVector by lazy {
        ImageVector.Builder(
            name = "GridView",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(fill = SolidColor(Color.Black)) {
                moveTo(3f, 3f)
                verticalLineTo(11f)
                horizontalLineTo(11f)
                verticalLineTo(3f)
                horizontalLineTo(3f)
                close()
                moveTo(13f, 3f)
                verticalLineTo(11f)
                horizontalLineTo(21f)
                verticalLineTo(3f)
                horizontalLineTo(13f)
                close()
                moveTo(3f, 13f)
                verticalLineTo(21f)
                horizontalLineTo(11f)
                verticalLineTo(13f)
                horizontalLineTo(3f)
                close()
                moveTo(13f, 13f)
                verticalLineTo(21f)
                horizontalLineTo(21f)
                verticalLineTo(13f)
                horizontalLineTo(13f)
                close()
            }
        }.build()
    }

    val Lightbulb: ImageVector by lazy {
        ImageVector.Builder(
            name = "Lightbulb",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(fill = SolidColor(Color.Black)) {
                moveTo(9f, 21f)
                curveTo(9f, 21.55f, 9.45f, 22f, 10f, 22f)
                horizontalLineTo(14f)
                curveTo(14.55f, 22f, 15f, 21.55f, 15f, 21f)
                verticalLineTo(20f)
                horizontalLineTo(9f)
                verticalLineTo(21f)
                close()
                moveTo(12f, 2f)
                curveTo(7.86f, 2f, 4.5f, 5.36f, 4.5f, 9.5f)
                curveTo(4.5f, 12.1f, 5.8f, 14.41f, 7.8f, 15.8f)
                verticalLineTo(18f)
                curveTo(7.8f, 18.55f, 8.25f, 19f, 8.8f, 19f)
                horizontalLineTo(15.2f)
                curveTo(15.75f, 19f, 16.2f, 18.55f, 16.2f, 18f)
                verticalLineTo(15.8f)
                curveTo(18.2f, 14.41f, 19.5f, 12.1f, 19.5f, 9.5f)
                curveTo(19.5f, 5.36f, 16.14f, 2f, 12f, 2f)
                close()
            }
        }.build()
    }

    val Remove: ImageVector by lazy {
        ImageVector.Builder(
            name = "Remove",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(fill = SolidColor(Color.Black)) {
                moveTo(19f, 13f)
                horizontalLineTo(5f)
                verticalLineTo(11f)
                horizontalLineTo(19f)
                verticalLineTo(13f)
                close()
            }
        }.build()
    }

    val Save: ImageVector by lazy {
        ImageVector.Builder(
            name = "Save",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(fill = SolidColor(Color.Black)) {
                moveTo(17f, 3f)
                horizontalLineTo(5f)
                curveTo(3.89f, 3f, 3f, 3.9f, 3f, 5f)
                verticalLineTo(19f)
                curveTo(3f, 20.1f, 3.89f, 21f, 5f, 21f)
                horizontalLineTo(19f)
                curveTo(20.1f, 21f, 21f, 20.1f, 21f, 19f)
                verticalLineTo(7f)
                lineTo(17f, 3f)
                close()
                moveTo(12f, 19f)
                curveTo(10.34f, 19f, 9f, 17.66f, 9f, 16f)
                curveTo(9f, 14.34f, 10.34f, 13f, 12f, 13f)
                curveTo(13.66f, 13f, 15f, 14.34f, 15f, 16f)
                curveTo(15f, 17.66f, 13.66f, 19f, 12f, 19f)
                close()
                moveTo(15f, 9f)
                horizontalLineTo(5f)
                verticalLineTo(5f)
                horizontalLineTo(15f)
                verticalLineTo(9f)
                close()
            }
        }.build()
    }

    val Tune: ImageVector by lazy {
        ImageVector.Builder(
            name = "Tune",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(fill = SolidColor(Color.Black)) {
                moveTo(3f, 17f)
                verticalLineTo(19f)
                horizontalLineTo(9f)
                verticalLineTo(17f)
                horizontalLineTo(3f)
                close()
                moveTo(3f, 5f)
                verticalLineTo(7f)
                horizontalLineTo(13f)
                verticalLineTo(5f)
                horizontalLineTo(3f)
                close()
                moveTo(13f, 21f)
                verticalLineTo(19f)
                horizontalLineTo(21f)
                verticalLineTo(17f)
                horizontalLineTo(13f)
                verticalLineTo(15f)
                horizontalLineTo(11f)
                verticalLineTo(21f)
                horizontalLineTo(13f)
                close()
                moveTo(7f, 9f)
                verticalLineTo(11f)
                horizontalLineTo(3f)
                verticalLineTo(13f)
                horizontalLineTo(7f)
                verticalLineTo(15f)
                horizontalLineTo(9f)
                verticalLineTo(9f)
                horizontalLineTo(7f)
                close()
                moveTo(21f, 13f)
                verticalLineTo(11f)
                horizontalLineTo(11f)
                verticalLineTo(13f)
                horizontalLineTo(21f)
                close()
                moveTo(15f, 9f)
                horizontalLineTo(17f)
                verticalLineTo(7f)
                horizontalLineTo(21f)
                verticalLineTo(5f)
                horizontalLineTo(17f)
                verticalLineTo(3f)
                horizontalLineTo(15f)
                verticalLineTo(9f)
                close()
            }
        }.build()
    }

    val ViewList: ImageVector by lazy {
        ImageVector.Builder(
            name = "ViewList",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(fill = SolidColor(Color.Black)) {
                moveTo(4f, 14f)
                horizontalLineTo(8f)
                verticalLineTo(10f)
                horizontalLineTo(4f)
                verticalLineTo(14f)
                close()
                moveTo(4f, 19f)
                horizontalLineTo(8f)
                verticalLineTo(15f)
                horizontalLineTo(4f)
                verticalLineTo(19f)
                close()
                moveTo(4f, 9f)
                horizontalLineTo(8f)
                verticalLineTo(5f)
                horizontalLineTo(4f)
                verticalLineTo(9f)
                close()
                moveTo(9f, 14f)
                horizontalLineTo(21f)
                verticalLineTo(10f)
                horizontalLineTo(9f)
                verticalLineTo(14f)
                close()
                moveTo(9f, 19f)
                horizontalLineTo(21f)
                verticalLineTo(15f)
                horizontalLineTo(9f)
                verticalLineTo(19f)
                close()
                moveTo(9f, 5f)
                verticalLineTo(9f)
                horizontalLineTo(21f)
                verticalLineTo(5f)
                horizontalLineTo(9f)
                close()
            }
        }.build()
    }

    val PhotoCamera: ImageVector by lazy {
        ImageVector.Builder(
            name = "PhotoCamera",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(fill = SolidColor(Color.Black)) {
                moveTo(12f, 15f)
                curveTo(13.66f, 15f, 15f, 13.66f, 15f, 12f)
                curveTo(15f, 10.34f, 13.66f, 9f, 12f, 9f)
                curveTo(10.34f, 9f, 9f, 10.34f, 9f, 12f)
                curveTo(9f, 13.66f, 10.34f, 15f, 12f, 15f)
                close()
                moveTo(9f, 2f)
                lineTo(7.17f, 4f)
                horizontalLineTo(4f)
                curveTo(2.9f, 4f, 2f, 4.9f, 2f, 6f)
                verticalLineTo(18f)
                curveTo(2f, 19.1f, 2.9f, 20f, 4f, 20f)
                horizontalLineTo(20f)
                curveTo(21.1f, 20f, 22f, 19.1f, 22f, 18f)
                verticalLineTo(6f)
                curveTo(22f, 4.9f, 21.1f, 4f, 20f, 4f)
                horizontalLineTo(16.83f)
                lineTo(15f, 2f)
                horizontalLineTo(9f)
                close()
                moveTo(12f, 17f)
                curveTo(9.24f, 17f, 7f, 14.76f, 7f, 12f)
                curveTo(7f, 9.24f, 9.24f, 7f, 12f, 7f)
                curveTo(14.76f, 7f, 17f, 9.24f, 17f, 12f)
                curveTo(17f, 14.76f, 14.76f, 17f, 12f, 17f)
                close()
            }
        }.build()
    }
}
