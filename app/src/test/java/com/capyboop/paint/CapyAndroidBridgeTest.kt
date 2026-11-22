package com.capyboop.paint

import android.annotation.TargetApi
import android.os.Build
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
        assertTrue(CapyAndroidBridge.isAllowedCapyDeepLink("https://paint.capyboop.com/#s=abc123_XYZ-9"))
        assertTrue(CapyAndroidBridge.isAllowedCapyDeepLink("https://paint.capyboop.com/?room=ABC123#s=abc123"))
        assertTrue(CapyAndroidBridge.isAllowedCapyDeepLink("https://paint.capyboop.com"))
        assertTrue(CapyAndroidBridge.isAllowedCapyDeepLink("https://www.capypaint.com/#s=token"))
        assertTrue(CapyAndroidBridge.isAllowedCapyDeepLink("https://capyboop.github.io/paint/#s=token"))
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
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("http://paint.capyboop.com/#s=insecure"))
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("http://shthed.github.io/capy/#s=insecure"))
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("https://evil.example.com/capy/#s=abc"))
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("https://capypaint.com.evil.example/#s=abc"))
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("https://paint.capyboop.com.evil.example/#s=abc"))
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("https://evil@paint.capyboop.com/#s=abc"))
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("https://shthed.github.io/other-repo/#s=abc"))
        /* capy-dev-only:start */
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("https://shthed.github.io/paint/#s=abc"))
        /* capy-dev-only:end */
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("https://capypaint.com/privacy-policy.html"))
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("https://paint.capyboop.com/privacy-policy.html"))
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

    @Test
    fun `isPlayGamesAppIdConfigured rejects whitespace and placeholder values`() {
        assertFalse(CapyAndroidBridge.isPlayGamesAppIdConfigured("   "))
        assertFalse(CapyAndroidBridge.isPlayGamesAppIdConfigured("12345"))
        assertTrue(CapyAndroidBridge.isPlayGamesAppIdConfigured("123456"))
    }

    @Test
    fun `resolveShareImageSpec preserves JPEG WEBP GIF and SVG MIME types and extensions`() {
        val jpegSpec = CapyAndroidBridge.resolveShareImageSpec("data:image/jpeg;base64,/9j/4AAQ")
        assertEquals("capy_shared_artwork.jpg", jpegSpec.fileName)
        assertEquals("image/jpeg", jpegSpec.mimeType)
        assertEquals("/9j/4AAQ", jpegSpec.base64Payload)

        val webpSpec = CapyAndroidBridge.resolveShareImageSpec("data:image/webp;base64,UklGRg==")
        assertEquals("capy_shared_artwork.webp", webpSpec.fileName)
        assertEquals("image/webp", webpSpec.mimeType)

        val pngSpec = CapyAndroidBridge.resolveShareImageSpec("iVBORw0KGgo=")
        assertEquals("capy_shared_artwork.png", pngSpec.fileName)
        assertEquals("image/png", pngSpec.mimeType)
        assertEquals("iVBORw0KGgo=", pngSpec.base64Payload)
    }

    @Test
    fun `prepareSharedExportFile isolates exports under cacheDir shared and prunes stale files`() {
        val cacheDir = tempFolder.newFolder("capy_cache_shared")
        val sharedDir = File(cacheDir, CapyAndroidBridge.SHARE_FOLDER_NAME)
        assertTrue(sharedDir.mkdirs())

        val staleFile = File(sharedDir, "stale_export.png")
        staleFile.writeBytes(byteArrayOf(1, 2, 3))
        staleFile.setLastModified(1_000L)

        val freshFile = File(sharedDir, "recent_export.capy")
        freshFile.writeBytes(byteArrayOf(4, 5, 6))
        val nowMs = 1_000_000_000L
        freshFile.setLastModified(nowMs - 60_000L)

        val target = CapyAndroidBridge.prepareSharedExportFile(
            cacheDir = cacheDir,
            fileName = "../../my export.png",
            nowMs = nowMs,
            maxAgeMs = 86_400_000L,
        )
        assertEquals(sharedDir, target.parentFile)
        assertEquals("_.._my_export.png", target.name)
        assertFalse("Stale shared export older than maxAgeMs should be pruned", staleFile.exists())
        assertTrue("Fresh shared export should be preserved", freshFile.exists())
    }

    @Test
    fun `classifyWebViewNavigation allows appassets and about blank opens http externally and blocks unsafe schemes`() {
        assertEquals(
            CapyAndroidBridge.WebViewNavigationAction.ALLOW_INTERNAL,
            CapyAndroidBridge.classifyWebViewNavigation("https://appassets.androidplatform.net/assets/www/index.html"),
        )
        assertEquals(
            CapyAndroidBridge.WebViewNavigationAction.ALLOW_INTERNAL,
            CapyAndroidBridge.classifyWebViewNavigation("about:blank"),
        )
        assertEquals(
            CapyAndroidBridge.WebViewNavigationAction.OPEN_EXTERNAL,
            CapyAndroidBridge.classifyWebViewNavigation("https://capypaint.com/privacy-policy.html"),
        )
        assertEquals(
            CapyAndroidBridge.WebViewNavigationAction.OPEN_EXTERNAL,
            CapyAndroidBridge.classifyWebViewNavigation("http://example.com/help"),
        )
        assertEquals(
            CapyAndroidBridge.WebViewNavigationAction.BLOCK,
            CapyAndroidBridge.classifyWebViewNavigation("javascript:alert(1)"),
        )
        assertEquals(
            CapyAndroidBridge.WebViewNavigationAction.BLOCK,
            CapyAndroidBridge.classifyWebViewNavigation("file:///data/data/com.capyboop.paint/shared_prefs"),
        )
        assertEquals(
            CapyAndroidBridge.WebViewNavigationAction.BLOCK,
            CapyAndroidBridge.classifyWebViewNavigation("content://com.android.contacts/data/1"),
        )
        assertEquals(
            CapyAndroidBridge.WebViewNavigationAction.BLOCK,
            CapyAndroidBridge.classifyWebViewNavigation(null),
        )
    }

    @Test
    fun `formatSharedImageJson escapes control characters tabs and script tags`() {
        val json = CapyAndroidBridge.formatSharedImageJson(
            title = "Col\tTitle</script>",
            dataUrl = "data:image/png;base64,AA==",
        )
        assertEquals(
            """{"title":"Col\tTitle\u003c/script\u003e","dataUrl":"data:image/png;base64,AA=="}""",
            json,
        )
    }

    @Test
    fun `HapticSpec implements content-based equals and hashCode for waveform arrays`() {
        val first = CapyAndroidBridge.resolveHapticSpec("success")
        val second = CapyAndroidBridge.resolveHapticSpec("success")
        assertEquals(first, second)
        assertEquals(first.hashCode(), second.hashCode())
    }

    @Test
    fun `isAllowedCapyDeepLink rejects userinfo spoofs and non-standard ports while accepting capyboop pages`() {
        assertTrue(CapyAndroidBridge.isAllowedCapyDeepLink("https://capyboop.github.io/capy/#s=abc123"))
        assertTrue(CapyAndroidBridge.isAllowedCapyDeepLink("https://capypaint.com:443/#s=abc123"))

        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("https://evil.example@capypaint.com/#s=abc"))
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("https://capypaint.com:8443/#s=abc"))
        assertFalse(CapyAndroidBridge.isAllowedCapyDeepLink("https://capyboop.github.io/other-repo/#s=abc"))
    }

    @Test
    fun `isAllowedShareTextUrl and export MIME helpers block unsafe schemes and MIME injection`() {
        assertTrue(CapyAndroidBridge.isAllowedShareTextUrl("https://capypaint.com/#s=abc"))
        assertTrue(CapyAndroidBridge.isAllowedShareTextUrl("http://localhost:3000/#s=abc"))
        assertFalse(CapyAndroidBridge.isAllowedShareTextUrl("javascript:alert(1)"))
        assertFalse(CapyAndroidBridge.isAllowedShareTextUrl("file:///etc/passwd"))
        assertFalse(CapyAndroidBridge.isAllowedShareTextUrl("http://evil.example/phish"))
        assertFalse(CapyAndroidBridge.isAllowedShareTextUrl("https://evil@capypaint.com/"))

        assertEquals("image/png", CapyAndroidBridge.resolveAllowedExportMimeType(" image/PNG "))
        assertEquals("application/octet-stream", CapyAndroidBridge.resolveAllowedExportMimeType("text/html"))
        assertEquals("application/octet-stream", CapyAndroidBridge.resolveAllowedExportMimeType("image/png\r\nX-Injected: 1"))

        assertEquals("image/webp", CapyAndroidBridge.normalizeSharedImageMimeType("image/webp;charset=utf-8"))
        assertEquals("image/png", CapyAndroidBridge.normalizeSharedImageMimeType("image/svg+xml;xss=1"))
        assertTrue(CapyAndroidBridge.isAllowedSharedImageDataUrl("data:image/png;base64,AA=="))
        assertFalse(CapyAndroidBridge.isAllowedSharedImageDataUrl("data:image/svg+xml,<svg/>"))
        assertFalse(CapyAndroidBridge.isAllowedSharedImageDataUrl("javascript:alert(1)"))

        assertEquals(
            CapyAndroidBridge.WebViewNavigationAction.BLOCK,
            CapyAndroidBridge.classifyWebViewNavigation("https://evil@appassets.androidplatform.net/assets/www/index.html"),
        )
        assertEquals(
            CapyAndroidBridge.WebViewNavigationAction.OPEN_EXTERNAL,
            CapyAndroidBridge.classifyWebViewNavigation("https://appassets.androidplatform.net:8443/"),
        )
        assertEquals(
            "Hello Capy",
            CapyAndroidBridge.sanitizeShareTitle("  Hello\r\n\u0000\tCapy  "),
        )
        assertEquals(
            "Shared Photo",
            CapyAndroidBridge.sanitizeShareTitle("\n\t", fallback = "Shared Photo"),
        )
    }

    @Test
    fun `isTrustedPageUrl and isTrustedBridgeOrigin strictly permit only appassets origin`() {
        assertTrue(CapyAndroidBridge.isTrustedPageUrl("https://appassets.androidplatform.net/assets/www/index.html"))
        assertTrue(CapyAndroidBridge.isTrustedPageUrl("https://appassets.androidplatform.net/assets/www/index.html?skipTutorial=1"))
        assertFalse(CapyAndroidBridge.isTrustedPageUrl(null))
        assertFalse(CapyAndroidBridge.isTrustedPageUrl("about:blank"))
        assertFalse(CapyAndroidBridge.isTrustedPageUrl("http://appassets.androidplatform.net/assets/www/index.html"))
        assertFalse(CapyAndroidBridge.isTrustedPageUrl("https://appassets.androidplatform.net.evil.com/assets/www/index.html"))
        assertFalse(CapyAndroidBridge.isTrustedPageUrl("https://evil@appassets.androidplatform.net/assets/www/index.html"))
        assertFalse(CapyAndroidBridge.isTrustedPageUrl("file:///assets/www/index.html"))
        assertFalse(CapyAndroidBridge.isTrustedPageUrl("javascript:alert(1)"))

        assertTrue(CapyAndroidBridge.isTrustedBridgeOrigin("https://appassets.androidplatform.net", isMainFrame = true))
        assertFalse(CapyAndroidBridge.isTrustedBridgeOrigin("https://appassets.androidplatform.net", isMainFrame = false))
        assertFalse(CapyAndroidBridge.isTrustedBridgeOrigin("https://appassets.androidplatform.net/assets/", isMainFrame = true))
        assertFalse(CapyAndroidBridge.isTrustedBridgeOrigin("https://appassets.androidplatform.net?foo=1", isMainFrame = true))
        assertFalse(CapyAndroidBridge.isTrustedBridgeOrigin("https://capypaint.com", isMainFrame = true))
        assertFalse(CapyAndroidBridge.isTrustedBridgeOrigin("https://appassets.androidplatform.net.evil.com", isMainFrame = true))
        assertFalse(CapyAndroidBridge.isTrustedBridgeOrigin(null, isMainFrame = true))
    }

    @Test
    fun `shouldBlockDocumentRequest blocks untrusted mainFrame and iframe loads while permitting appassets and subresources`() {
        assertFalse(CapyAndroidBridge.shouldBlockDocumentRequest("https://appassets.androidplatform.net/assets/www/index.html", true, "document"))
        assertFalse(CapyAndroidBridge.shouldBlockDocumentRequest("about:blank", false, "iframe"))
        assertFalse(CapyAndroidBridge.shouldBlockDocumentRequest("https://accounts.google.com/gsi/client", false, "script"))
        assertFalse(CapyAndroidBridge.shouldBlockDocumentRequest("https://capypaint.com/api", false, "empty"))

        assertTrue(CapyAndroidBridge.shouldBlockDocumentRequest("https://evil.example/phish.html", true, "document"))
        assertTrue(CapyAndroidBridge.shouldBlockDocumentRequest("https://evil.example/frame.html", false, "iframe"))
        assertTrue(CapyAndroidBridge.shouldBlockDocumentRequest("https://evil.example/frame.html", false, "frame"))
        assertTrue(CapyAndroidBridge.shouldBlockDocumentRequest("https://evil.example/doc.html", false, "DOCUMENT"))
    }

    @Test
    fun `decideSnapshotPushAction prevents blind overwrites when unseen remote JSON exists`() {
        assertTrue(CapyAndroidBridge.looksLikeJsonObject("""{"version":2}"""))
        assertFalse(CapyAndroidBridge.looksLikeJsonObject("not-json"))
        assertFalse(CapyAndroidBridge.looksLikeJsonObject("   "))

        assertEquals(
            CapyAndroidBridge.SnapshotPushDecision.COMMIT_INCOMING,
            CapyAndroidBridge.decideSnapshotPushAction(
                slotKey = "capy_cloud_manifest_v2",
                existingRemotePayload = null,
                lastKnownRemotePayload = null,
                incomingPayload = """{"version":2,"entries":{"a":1}}""",
            ),
        )
        assertEquals(
            CapyAndroidBridge.SnapshotPushDecision.COMMIT_INCOMING,
            CapyAndroidBridge.decideSnapshotPushAction(
                slotKey = "capy_cloud_manifest_v2",
                existingRemotePayload = "corrupt-text",
                lastKnownRemotePayload = null,
                incomingPayload = """{"version":2,"entries":{"a":1}}""",
            ),
        )
        assertEquals(
            CapyAndroidBridge.SnapshotPushDecision.SKIP_IDENTICAL,
            CapyAndroidBridge.decideSnapshotPushAction(
                slotKey = "capy_cloud_manifest_v2",
                existingRemotePayload = """{"version":2,"entries":{"a":1}}""",
                lastKnownRemotePayload = null,
                incomingPayload = """{"version":2,"entries":{"a":1}}""",
            ),
        )
        assertEquals(
            CapyAndroidBridge.SnapshotPushDecision.MERGE_UNSEEN_REMOTE,
            CapyAndroidBridge.decideSnapshotPushAction(
                slotKey = "capy_cloud_manifest_v2",
                existingRemotePayload = """{"version":2,"entries":{"remote":1}}""",
                lastKnownRemotePayload = """{"version":2,"entries":{"older":1}}""",
                incomingPayload = """{"version":2,"entries":{"local":1}}""",
            ),
        )
        assertEquals(
            CapyAndroidBridge.SnapshotPushDecision.COMMIT_INCOMING,
            CapyAndroidBridge.decideSnapshotPushAction(
                slotKey = "capy_cloud_manifest_v2",
                existingRemotePayload = """{"version":2,"entries":{"remote":1}}""",
                lastKnownRemotePayload = """{"version":2,"entries":{"remote":1}}""",
                incomingPayload = """{"version":2,"entries":{"merged":1}}""",
            ),
        )
        assertEquals(
            CapyAndroidBridge.SnapshotPushDecision.COMMIT_INCOMING,
            CapyAndroidBridge.decideSnapshotPushAction(
                slotKey = "pgblob_save_1_part_0",
                existingRemotePayload = "AAAA",
                lastKnownRemotePayload = null,
                incomingPayload = "BBBB",
            ),
        )
    }

    @Test
    fun `concurrent saveBackupToDir and loadBackupFromDir serialize safely without tmp residue`() {
        val backupDir = tempFolder.newFolder("capy_concurrent_io")
        val threadCount = 8
        val iterations = 25
        val errors = java.util.concurrent.CopyOnWriteArrayList<Throwable>()
        val latch = java.util.concurrent.CountDownLatch(1)
        val threads = (0 until threadCount).map { tid ->
            Thread {
                try {
                    latch.await()
                    for (iter in 0 until iterations) {
                        val payload = """{"thread":$tid,"iter":$iter,"pad":"${"x".repeat(64)}"}"""
                        val saved = CapyAndroidBridge.saveBackupToDir(
                            dir = backupDir,
                            key = "capy_cloud_manifest_v2",
                            data = payload,
                        )
                        assertTrue(saved)
                        val readBack = CapyAndroidBridge.loadBackupFromDir(
                            dir = backupDir,
                            key = "capy_cloud_manifest_v2",
                        )
                        assertNotNull(readBack)
                        assertTrue(readBack!!.startsWith("""{"thread":""") && readBack.endsWith("""xxx"}"""))
                    }
                } catch (t: Throwable) {
                    errors.add(t)
                }
            }
        }
        threads.forEach { it.start() }
        latch.countDown()
        threads.forEach { it.join(15_000) }
        assertTrue("Unexpected thread errors: $errors", errors.isEmpty())

        val remainingFiles = backupDir.listFiles()?.map { it.name } ?: emptyList()
        assertEquals(listOf("capy_cloud_manifest_v2.json"), remainingFiles)
        assertTrue(remainingFiles.none { it.endsWith(".tmp") })
    }

    @Test
    fun `shouldUseAtomicNioMove enforces API 26 Build_VERSION_CODES_O threshold`() {
        assertFalse(CapyAndroidBridge.shouldUseAtomicNioMove(24))
        assertFalse(CapyAndroidBridge.shouldUseAtomicNioMove(25))
        assertTrue(CapyAndroidBridge.shouldUseAtomicNioMove(Build.VERSION_CODES.O))
        assertTrue(CapyAndroidBridge.shouldUseAtomicNioMove(Build.VERSION_CODES.TIRAMISU))
    }

    @Test
    @TargetApi(Build.VERSION_CODES.O)
    fun `Api26FileMover moveReplacing atomically replaces existing target without tmp residue`() {
        val dir = tempFolder.newFolder("capy_api26_mover")
        val target = File(dir, "snapshot.json")
        val src1 = File.createTempFile("capy_m1.", ".tmp", dir)
        src1.writeText("""{"v":1}""", Charsets.UTF_8)
        assertTrue(CapyAndroidBridge.Api26FileMover.moveReplacing(src1, target))
        assertEquals("""{"v":1}""", target.readText(Charsets.UTF_8))
        assertFalse(src1.exists())

        val src2 = File.createTempFile("capy_m2.", ".tmp", dir)
        src2.writeText("""{"v":2}""", Charsets.UTF_8)
        assertTrue(CapyAndroidBridge.Api26FileMover.moveReplacing(src2, target))
        assertEquals("""{"v":2}""", target.readText(Charsets.UTF_8))
        assertFalse(src2.exists())

        assertTrue(CapyAndroidBridge.saveBackupToDir(dir, "fallback_check", """{"mode":"rename_1"}"""))
        assertTrue(CapyAndroidBridge.saveBackupToDir(dir, "fallback_check", """{"mode":"rename_2"}"""))
        assertEquals("""{"mode":"rename_2"}""", CapyAndroidBridge.loadBackupFromDir(dir, "fallback_check"))

        val names = dir.listFiles()?.map { it.name }?.sorted() ?: emptyList()
        assertEquals(listOf("fallback_check.json", "snapshot.json"), names)
    }

    @Test
    fun `isAllowedExternalOAuthUrl strictly allows HTTPS Google and Microsoft OAuth hosts only`() {
        assertTrue(
            CapyAndroidBridge.isAllowedExternalOAuthUrl(
                "https://accounts.google.com/o/oauth2/v2/auth?client_id=abc&response_type=code&code_challenge=xyz&code_challenge_method=S256"
            )
        )
        assertTrue(
            CapyAndroidBridge.isAllowedExternalOAuthUrl(
                "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=abc&response_type=code&code_challenge=xyz&code_challenge_method=S256"
            )
        )

        assertFalse(CapyAndroidBridge.isAllowedExternalOAuthUrl(null))
        assertFalse(CapyAndroidBridge.isAllowedExternalOAuthUrl(""))
        assertFalse(CapyAndroidBridge.isAllowedExternalOAuthUrl("http://accounts.google.com/o/oauth2/v2/auth"))
        assertFalse(CapyAndroidBridge.isAllowedExternalOAuthUrl("http://login.microsoftonline.com/consumers/oauth2/v2.0/authorize"))
        assertFalse(CapyAndroidBridge.isAllowedExternalOAuthUrl("https://evil.example.com/oauth"))
        assertFalse(CapyAndroidBridge.isAllowedExternalOAuthUrl("https://accounts.google.com.evil.example/oauth"))
        assertFalse(CapyAndroidBridge.isAllowedExternalOAuthUrl("https://user:pass@accounts.google.com/oauth"))
        assertFalse(CapyAndroidBridge.isAllowedExternalOAuthUrl("https://accounts.google.com:8443/oauth"))
        assertFalse(CapyAndroidBridge.isAllowedExternalOAuthUrl("javascript:alert(1)"))
        assertFalse(CapyAndroidBridge.isAllowedExternalOAuthUrl("https://accounts.google.com/oauth\nfoo"))
    }

    @Test
    fun `isAllowedOAuthCallbackUrl validates capypaint oauth callback scheme and rejects unsafe URIs`() {
        assertTrue(
            CapyAndroidBridge.isAllowedOAuthCallbackUrl(
                "capypaint://oauth/callback?code=auth_code_123&state=csrf_state_abc"
            )
        )
        assertTrue(
            CapyAndroidBridge.isAllowedOAuthCallbackUrl(
                "capypaint://oauth/callback?error=access_denied&state=csrf_state_abc"
            )
        )

        assertFalse(CapyAndroidBridge.isAllowedOAuthCallbackUrl(null))
        assertFalse(CapyAndroidBridge.isAllowedOAuthCallbackUrl(""))
        assertFalse(CapyAndroidBridge.isAllowedOAuthCallbackUrl("https://capypaint.com/oauth/callback?code=1"))
        assertFalse(CapyAndroidBridge.isAllowedOAuthCallbackUrl("capypaint://other/callback?code=1"))
        assertFalse(CapyAndroidBridge.isAllowedOAuthCallbackUrl("capypaint://oauth/evil?code=1"))
        assertFalse(CapyAndroidBridge.isAllowedOAuthCallbackUrl("capypaint://oauth/callback?code=1\r\ninject"))
        assertFalse(
            CapyAndroidBridge.isAllowedOAuthCallbackUrl(
                "capypaint://oauth/callback?code=" + "a".repeat(5000)
            )
        )
    }

    @Test
    fun `buildWebViewAssetResponseHeaders attaches strict CSP on HTML assets and nosniff on all assets`() {
        val indexHeaders = CapyAndroidBridge.buildWebViewAssetResponseHeaders(
            mimeType = "text/html",
            path = "/assets/www/index.html",
        )
        assertEquals("nosniff", indexHeaders["X-Content-Type-Options"])
        assertEquals("strict-origin-when-cross-origin", indexHeaders["Referrer-Policy"])
        assertEquals("SAMEORIGIN", indexHeaders["X-Frame-Options"])
        val indexCsp = indexHeaders["Content-Security-Policy"] ?: ""
        assertTrue(indexCsp.contains("script-src 'self'"))
        assertTrue(indexCsp.contains("https://accounts.google.com/gsi/client"))
        assertTrue(indexCsp.contains("script-src-attr 'none'"))
        assertTrue(indexCsp.contains("https://capypaint.com"))
        assertTrue(indexCsp.contains("object-src 'none'"))
        assertFalse(indexCsp.contains("script-src 'unsafe-inline'"))
        assertFalse(indexCsp.contains("'unsafe-eval'"))

        val privacyHeaders = CapyAndroidBridge.buildWebViewAssetResponseHeaders(
            mimeType = "text/html",
            path = "/assets/www/privacy-policy.html",
        )
        assertEquals(CapyAndroidBridge.WEBVIEW_PRIVACY_POLICY_CSP, privacyHeaders["Content-Security-Policy"])
        assertTrue(privacyHeaders["Content-Security-Policy"]?.contains("script-src 'none'") == true)

        val jsHeaders = CapyAndroidBridge.buildWebViewAssetResponseHeaders(
            mimeType = "application/javascript",
            path = "/assets/www/assets/index.js",
        )
        assertEquals("nosniff", jsHeaders["X-Content-Type-Options"])
        assertEquals("strict-origin-when-cross-origin", jsHeaders["Referrer-Policy"])
        assertFalse(jsHeaders.containsKey("Content-Security-Policy"))
    }
}


