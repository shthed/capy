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

    @Test
    fun `isAllowedCapyDeepLink accepts verified capy HTTPS app links and rejects untrusted URIs`() {
        assertTrue(CapyAndroidBridge.isAllowedCapyDeepLink("https://shthed.github.io/capy/#s=abc123_XYZ-9"))
        assertTrue(CapyAndroidBridge.isAllowedCapyDeepLink("https://shthed.github.io/capy/?room=ABC123#s=abc123"))
        assertTrue(CapyAndroidBridge.isAllowedCapyDeepLink("https://shthed.github.io/capy"))
        assertTrue(CapyAndroidBridge.isAllowedCapyDeepLink("https://shthed.github.io/capy/pull/459/#s=token"))

        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink(null))
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink(""))
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("javascript:alert(1)"))
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("http://shthed.github.io/capy/#s=insecure"))
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("https://evil.example.com/capy/#s=abc"))
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("https://shthed.github.io/other-repo/#s=abc"))
    }

    @Test
    fun `formatPlayGamesIdentityJson escapes quotes and angle brackets safely`() {
        val json = CapyAndroidBridge.formatPlayGamesIdentityJson(
            playerId = "pg_12345",
            displayName = "Capy \"Painter\" <Pro>",
        )
        assertEquals(
            """{"playerId":"pg_12345","displayName":"Capy \"Painter\" \u003cPro\u003e"}""",
            json,
        )
    }

    @Test
    fun `cloud snapshot directory round-trips CRDT progress envelopes independently from local saves`() {
        val cloudDir = tempFolder.newFolder(CapyAndroidBridge.CLOUD_FOLDER_NAME)
        val payload = """{"version":1,"slotKey":"sample_capybara","updatedAt":1700000000000,"token":"abc"}"""

        assertTrue(CapyAndroidBridge.saveBackupToDir(cloudDir, "sample_capybara", payload))
        assertEquals(payload, CapyAndroidBridge.loadBackupFromDir(cloudDir, "sample_capybara"))
    }
}
