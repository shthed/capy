package com.capypaint.capy

import org.junit.Assert.assertEquals
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
}
