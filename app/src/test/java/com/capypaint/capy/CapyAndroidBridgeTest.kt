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
    fun `saveBackupToDir atomically overwrites existing backup and leaves zero tmp files`() {
        val backupDir = tempFolder.newFolder("capy_saves_atomic")
        val initialJson = """{"autoAdvance":true,"difficulty":"EASY","version":1}"""
        val updatedJson = """{"autoAdvance":false,"difficulty":"HARD","version":2}"""

        assertTrue(CapyAndroidBridge.saveBackupToDir(backupDir, "capy_snapshots_v8", initialJson))
        assertEquals(initialJson, CapyAndroidBridge.loadBackupFromDir(backupDir, "capy_snapshots_v8"))

        assertTrue(CapyAndroidBridge.saveBackupToDir(backupDir, "capy_snapshots_v8", updatedJson))
        assertEquals(updatedJson, CapyAndroidBridge.loadBackupFromDir(backupDir, "capy_snapshots_v8"))

        val remainingFiles = backupDir.listFiles()?.map { it.name } ?: emptyList()
        assertEquals(listOf("capy_snapshots_v8.json"), remainingFiles)
        assertTrue(remainingFiles.none { it.endsWith(".tmp") })
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
    fun `isPlayGamesAppIdConfigured detects real numeric Play Console Project IDs vs default placeholder`() {
        assertTrue(CapyAndroidBridge.isPlayGamesAppIdConfigured("123456789012"))
        assertTrue(CapyAndroidBridge.isPlayGamesAppIdConfigured(" 987654321098 "))

        assertFalse(CapyAndroidBridge.isPlayGamesAppIdConfigured(null))
        assertFalse(CapyAndroidBridge.isPlayGamesAppIdConfigured(""))
        assertFalse(CapyAndroidBridge.isPlayGamesAppIdConfigured("000000000000"))
        assertFalse(CapyAndroidBridge.isPlayGamesAppIdConfigured("000000"))
        assertFalse(CapyAndroidBridge.isPlayGamesAppIdConfigured("abc123456789"))
    }

    @Test
    fun `cloud snapshot directory round-trips CRDT progress envelopes independently from local saves`() {
        val cloudDir = tempFolder.newFolder(CapyAndroidBridge.CLOUD_FOLDER_NAME)
        val payload = """{"version":1,"slotKey":"sample_capybara","updatedAt":1700000000000,"token":"abc"}"""

        assertTrue(CapyAndroidBridge.saveBackupToDir(cloudDir, "sample_capybara", payload))
        assertEquals(payload, CapyAndroidBridge.loadBackupFromDir(cloudDir, "sample_capybara"))
    }

    @Test
    fun `resolveHapticSpec maps tactile haptic types to predefined effects view constants and waveforms`() {
        val tickSpec = CapyAndroidBridge.resolveHapticSpec("tick")
        assertEquals("tick", tickSpec.normalizedType)
        assertEquals(android.view.HapticFeedbackConstants.CLOCK_TICK, tickSpec.viewConstant)
        assertEquals(android.os.VibrationEffect.EFFECT_TICK, tickSpec.predefinedEffectId)
        assertEquals(10L, tickSpec.oneShotDurationMs)
        assertNull(tickSpec.waveformTimings)

        val warningSpec = CapyAndroidBridge.resolveHapticSpec("warning")
        assertEquals("warning", warningSpec.normalizedType)
        assertEquals(android.view.HapticFeedbackConstants.LONG_PRESS, warningSpec.viewConstant)
        assertEquals(android.os.VibrationEffect.EFFECT_HEAVY_CLICK, warningSpec.predefinedEffectId)
        assertEquals(18L, warningSpec.oneShotDurationMs)
        assertNull(warningSpec.waveformTimings)

        val successSpec = CapyAndroidBridge.resolveHapticSpec("success")
        assertEquals("success", successSpec.normalizedType)
        assertNull(successSpec.predefinedEffectId)
        assertNotNull(successSpec.waveformTimings)
        assertEquals(4, successSpec.waveformTimings?.size)

        val errorSpec = CapyAndroidBridge.resolveHapticSpec("error")
        assertEquals("error", errorSpec.normalizedType)
        assertNull(errorSpec.predefinedEffectId)
        assertNotNull(errorSpec.waveformTimings)
        assertEquals(4, errorSpec.waveformTimings?.size)

        val defaultSpec = CapyAndroidBridge.resolveHapticSpec("unknown_custom")
        assertEquals("click", defaultSpec.normalizedType)
        assertEquals(android.view.HapticFeedbackConstants.KEYBOARD_TAP, defaultSpec.viewConstant)
        assertEquals(android.os.VibrationEffect.EFFECT_CLICK, defaultSpec.predefinedEffectId)
        assertEquals(12L, defaultSpec.oneShotDurationMs)
        assertNull(defaultSpec.waveformTimings)
    }

    @Test
    fun `calculateInSampleSize and calculateTargetDimensions cap oversized shared camera images`() {
        assertEquals(1, CapyAndroidBridge.calculateInSampleSize(1024, 768, 2048))
        assertEquals(1, CapyAndroidBridge.calculateInSampleSize(2048, 2048, 2048))
        assertEquals(2, CapyAndroidBridge.calculateInSampleSize(4032, 3024, 2048))
        assertEquals(2, CapyAndroidBridge.calculateInSampleSize(4096, 3072, 2048))
        assertEquals(4, CapyAndroidBridge.calculateInSampleSize(8000, 6000, 2048))
        assertEquals(8, CapyAndroidBridge.calculateInSampleSize(16384, 12288, 2048))
        assertEquals(1, CapyAndroidBridge.calculateInSampleSize(0, -10, 2048))

        assertEquals(Pair(1024, 768), CapyAndroidBridge.calculateTargetDimensions(1024, 768, 2048))
        assertEquals(Pair(2048, 1536), CapyAndroidBridge.calculateTargetDimensions(4032, 3024, 2048))
        assertEquals(Pair(1536, 2048), CapyAndroidBridge.calculateTargetDimensions(3000, 4000, 2048))
        assertEquals(Pair(1, 1), CapyAndroidBridge.calculateTargetDimensions(0, 0, 2048))
    }
}
