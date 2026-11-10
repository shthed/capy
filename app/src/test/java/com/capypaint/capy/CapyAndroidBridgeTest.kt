package com.capypaint.capy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class CapyAndroidBridgeTest {

    @get:Rule
    val tempFolder = TemporaryFolder()

    @Test
    fun `sanitizeKey strips unsafe path characters`() {
        assertEquals("capy_user_settings_v8", CapyAndroidBridge.sanitizeKey("capy_user_settings_v8"))
        assertEquals(".._.._etc_passwd", CapyAndroidBridge.sanitizeKey("../../etc/passwd"))
        assertEquals("default_key", CapyAndroidBridge.sanitizeKey(""))
    }

    @Test
    fun `sanitizeFileName preserves safe extensions and prevents directory traversal`() {
        assertEquals("Capybara.capy", CapyAndroidBridge.sanitizeFileName("Capybara.capy"))
        assertEquals("_.._secret.capy", CapyAndroidBridge.sanitizeFileName("../../secret.capy"))
        assertEquals("capy_export.bin", CapyAndroidBridge.sanitizeFileName("   "))
        assertEquals("capy_export.bin", CapyAndroidBridge.sanitizeFileName("..."))
    }

    @Test
    fun `shouldUsePhotoPicker routes image accept types to photo picker and capy saves to SAF OpenDocument`() {
        assertTrue(CapyAndroidBridge.shouldUsePhotoPicker(arrayOf("image/*")))
        assertTrue(CapyAndroidBridge.shouldUsePhotoPicker(arrayOf(".png,.webp,image/jpeg")))

        assertFalse(CapyAndroidBridge.shouldUsePhotoPicker(null))
        assertFalse(CapyAndroidBridge.shouldUsePhotoPicker(emptyArray()))
        assertFalse(CapyAndroidBridge.shouldUsePhotoPicker(arrayOf("")))
        assertFalse(
            CapyAndroidBridge.shouldUsePhotoPicker(
                arrayOf(".capy,.json,application/json,application/octet-stream")
            )
        )
        assertFalse(CapyAndroidBridge.shouldUsePhotoPicker(arrayOf("image/*,.capy")))
    }

    @Test
    fun `saveBackupToDir and loadBackupFromDir round-trip JSON state`() {
        val backupDir = tempFolder.newFolder("capy_saves")
        val sampleJson = """{"autoAdvance":true,"difficulty":"EASY","hapticsEnabled":true}"""

        val saved = CapyAndroidBridge.saveBackupToDir(
            dir = backupDir,
            key = "capy_user_settings_v8",
            data = sampleJson,
        )
        assertTrue(saved)

        val loaded = CapyAndroidBridge.loadBackupFromDir(
            dir = backupDir,
            key = "capy_user_settings_v8",
        )
        assertNotNull(loaded)
        assertEquals(sampleJson, loaded)
    }

    @Test
    fun `loadBackupFromDir returns null when key does not exist`() {
        val backupDir = tempFolder.newFolder("capy_saves_empty")
        val loaded = CapyAndroidBridge.loadBackupFromDir(backupDir, "non_existent_key")
        assertNull(loaded)
    }

    @Test
    fun `formatSharedImageJson escapes quotes and newlines safely`() {
        val json = CapyAndroidBridge.formatSharedImageJson(
            title = "My \"Capy\"\nDrawing",
            dataUrl = "data:image/png;base64,iVBORw0KGgo=",
        )
        assertEquals(
            """{"title":"My \"Capy\" Drawing","dataUrl":"data:image/png;base64,iVBORw0KGgo="}""",
            json,
        )
    }

    @Test
    fun `formatSafeAreaInsetsJson formats CSS pixel insets correctly`() {
        val json = CapyAndroidBridge.formatSafeAreaInsetsJson(
            top = 48,
            bottom = 24,
            left = 0,
            right = 0,
        )
        assertEquals(
            """{"top":48,"bottom":24,"left":0,"right":0}""",
            json,
        )
    }
}
