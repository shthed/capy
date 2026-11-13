package com.capypaint.capy

import java.io.File
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
        assertTrue(CapyAndroidBridge.isAllowedCapyDeepLink("https://capypaint.com/#s=abc123_XYZ-9"))
        assertTrue(CapyAndroidBridge.isAllowedCapyDeepLink("https://capypaint.com/?room=ABC123#s=abc123"))
        assertTrue(CapyAndroidBridge.isAllowedCapyDeepLink("https://capypaint.com"))
        assertTrue(CapyAndroidBridge.isAllowedCapyDeepLink("https://www.capypaint.com/#s=token"))
        assertTrue(CapyAndroidBridge.isAllowedCapyDeepLink("https://shthed.github.io/capy/#s=abc123_XYZ-9"))
        assertTrue(CapyAndroidBridge.isAllowedCapyDeepLink("https://shthed.github.io/capy/?room=ABC123#s=abc123"))
        assertTrue(CapyAndroidBridge.isAllowedCapyDeepLink("https://shthed.github.io/capy"))
        assertTrue(CapyAndroidBridge.isAllowedCapyDeepLink("https://shthed.github.io/capy/alpha/459/#s=token"))
        assertTrue(CapyAndroidBridge.isAllowedCapyDeepLink("https://shthed.github.io/capy/PR/459/#s=token"))
        assertTrue(CapyAndroidBridge.isAllowedCapyDeepLink("https://shthed.github.io/capy/pull/459/#s=token"))

        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink(null))
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink(""))
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("javascript:alert(1)"))
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("http://capypaint.com/#s=insecure"))
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("http://shthed.github.io/capy/#s=insecure"))
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("https://evil.example.com/capy/#s=abc"))
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("https://capypaint.com.evil.example/#s=abc"))
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
    fun `isAppLinksCertConfigured validates real SHA-256 certificate fingerprints and rejects zero placeholders`() {
        val validColon =
            "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99"
        val validHex64 = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899"
        val zeroColon =
            "00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00"

        assertTrue(CapyAndroidBridge.isAppLinksCertConfigured(validColon))
        assertTrue(CapyAndroidBridge.isAppLinksCertConfigured(validHex64))
        assertTrue(CapyAndroidBridge.isAppLinksCertConfigured("$zeroColon, $validColon"))

        assertFalse(CapyAndroidBridge.isAppLinksCertConfigured(null))
        assertFalse(CapyAndroidBridge.isAppLinksCertConfigured(""))
        assertFalse(CapyAndroidBridge.isAppLinksCertConfigured("   "))
        assertFalse(CapyAndroidBridge.isAppLinksCertConfigured(zeroColon))
        assertFalse(CapyAndroidBridge.isAppLinksCertConfigured("0".repeat(64)))
        assertFalse(CapyAndroidBridge.isAppLinksCertConfigured("not-a-sha256-fingerprint"))
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

    @Test
    fun `saveCloudBinaryChunkToDir and loadCloudBinaryChunkFromDir persist large multi-chunk saves above 180 KB and prune stale chunks`() {
        val cloudDir = tempFolder.newFolder("capy_cloud_chunks")
        val blobKey = "pgblob_save_large_photo"
        val chunk0 = "A".repeat(240_000) // ~180 KB raw binary encoded as Base64
        val chunk1 = "B".repeat(240_000) // ~360 KB cumulative
        val chunk2 = "C".repeat(64_000) // ~408 KB cumulative across 3 chunks

        assertTrue(CapyAndroidBridge.saveCloudBinaryChunkToDir(cloudDir, blobKey, 0, 3, chunk0))
        assertTrue(CapyAndroidBridge.saveCloudBinaryChunkToDir(cloudDir, blobKey, 1, 3, chunk1))
        assertTrue(CapyAndroidBridge.saveCloudBinaryChunkToDir(cloudDir, blobKey, 2, 3, chunk2))

        assertEquals(chunk0, CapyAndroidBridge.loadCloudBinaryChunkFromDir(cloudDir, blobKey, 0))
        assertEquals(chunk1, CapyAndroidBridge.loadCloudBinaryChunkFromDir(cloudDir, blobKey, 1))
        assertEquals(chunk2, CapyAndroidBridge.loadCloudBinaryChunkFromDir(cloudDir, blobKey, 2))

        // Overwrite with a 2-chunk save and verify stale part_2 is pruned atomically
        val updatedChunk1 = "D".repeat(80_000)
        assertTrue(CapyAndroidBridge.saveCloudBinaryChunkToDir(cloudDir, blobKey, 0, 2, chunk0))
        assertTrue(CapyAndroidBridge.saveCloudBinaryChunkToDir(cloudDir, blobKey, 1, 2, updatedChunk1))

        assertEquals(chunk0, CapyAndroidBridge.loadCloudBinaryChunkFromDir(cloudDir, blobKey, 0))
        assertEquals(updatedChunk1, CapyAndroidBridge.loadCloudBinaryChunkFromDir(cloudDir, blobKey, 1))
        assertNull(CapyAndroidBridge.loadCloudBinaryChunkFromDir(cloudDir, blobKey, 2))

        // Reject out-of-range indices, excessive chunk counts, or empty payloads
        assertFalse(CapyAndroidBridge.saveCloudBinaryChunkToDir(cloudDir, blobKey, -1, 2, "abc"))
        assertFalse(CapyAndroidBridge.saveCloudBinaryChunkToDir(cloudDir, blobKey, 2, 2, "abc"))
        assertFalse(
            CapyAndroidBridge.saveCloudBinaryChunkToDir(
                cloudDir,
                blobKey,
                0,
                CapyAndroidBridge.MAX_CLOUD_BINARY_CHUNKS + 1,
                "abc",
            ),
        )
        assertFalse(CapyAndroidBridge.saveCloudBinaryChunkToDir(cloudDir, blobKey, 0, 1, ""))
    }

    @Test
    fun `saveCloudBinaryBytesToDir and loadCloudBinaryBytesFromDir round-trip 420 KB raw binary save without corruption`() {
        val cloudDir = tempFolder.newFolder("capy_cloud_raw_bytes")
        val largePayload = ByteArray(420_000) { idx -> ((idx * 31 + 17) and 0xFF).toByte() }

        val chunkCount = CapyAndroidBridge.saveCloudBinaryBytesToDir(cloudDir, "custom_hd_artwork", largePayload)
        assertEquals(3, chunkCount)

        val restored = CapyAndroidBridge.loadCloudBinaryBytesFromDir(cloudDir, "custom_hd_artwork")
        assertNotNull(restored)
        assertEquals(largePayload.size, restored?.size)
        assertTrue(largePayload.contentEquals(restored))
    }

    @Test
    fun `loadCloudBinaryBytesFromDir rejects missing, truncated, oversized, or malformed metadata chunks cleanly`() {
        val cloudDir = tempFolder.newFolder("capy_cloud_corrupt_chunks")
        val payload = ByteArray(400_000) { idx -> ((idx * 19 + 7) and 0xFF).toByte() }
        assertEquals(3, CapyAndroidBridge.saveCloudBinaryBytesToDir(cloudDir, "corrupt_target", payload))

        // 1. Truncating middle chunk below expectedBytes must return null cleanly without throwing
        val chunk1File = File(cloudDir, "corrupt_target_bin_1.bin")
        chunk1File.writeBytes(ByteArray(12_000) { 0x42 })
        assertNull(CapyAndroidBridge.loadCloudBinaryBytesFromDir(cloudDir, "corrupt_target"))

        // 2. Oversized chunk exceeding expectedBytes must return null cleanly without ArrayIndexOutOfBoundsException
        assertEquals(3, CapyAndroidBridge.saveCloudBinaryBytesToDir(cloudDir, "corrupt_target", payload))
        chunk1File.writeBytes(ByteArray(300_000) { 0x7F })
        assertNull(CapyAndroidBridge.loadCloudBinaryBytesFromDir(cloudDir, "corrupt_target"))

        // 3. Missing chunk file must return null cleanly
        assertEquals(3, CapyAndroidBridge.saveCloudBinaryBytesToDir(cloudDir, "corrupt_target", payload))
        assertTrue(chunk1File.delete())
        assertNull(CapyAndroidBridge.loadCloudBinaryBytesFromDir(cloudDir, "corrupt_target"))

        // 4. Malformed metadata header must return null cleanly
        assertTrue(CapyAndroidBridge.saveBackupToDir(cloudDir, "corrupt_target_bin_meta", "not_valid_meta"))
        assertNull(CapyAndroidBridge.loadCloudBinaryBytesFromDir(cloudDir, "corrupt_target"))
    }
}
