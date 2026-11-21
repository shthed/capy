package com.capyboop.paint

import java.io.File
import javax.imageio.ImageIO
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element

class AndroidTvManifestAndBridgeTest {

    private companion object {
        const val ANDROID_NS = "http://schemas.android.com/apk/res/android"
    }

    private fun resolveRepoFile(relativePath: String): File {
        var dir: File? = File(System.getProperty("user.dir") ?: ".").canonicalFile
        repeat(8) {
            val current = dir ?: return@repeat
            val candidate = File(current, relativePath)
            if (candidate.exists()) {
                return candidate
            }
            dir = current.parentFile
        }
        throw AssertionError("Unable to locate repository file '$relativePath' from '${System.getProperty("user.dir")}'")
    }

    private fun androidAttr(element: Element, localName: String): String {
        val nsValue = element.getAttributeNS(ANDROID_NS, localName)
        if (nsValue.isNotEmpty()) return nsValue
        return element.getAttribute("android:$localName")
    }

    private fun directChildElements(parent: Element, tagName: String): List<Element> {
        val out = mutableListOf<Element>()
        val children = parent.childNodes
        for (i in 0 until children.length) {
            val node = children.item(i)
            if (node is Element && node.tagName == tagName) {
                out.add(node)
            }
        }
        return out
    }

    @Test
    fun `AndroidManifest declares optional touchscreen and leanback features and tv_banner`() {
        val manifestFile = resolveRepoFile("app/src/main/AndroidManifest.xml")
        val docFactory = DocumentBuilderFactory.newInstance().apply {
            isNamespaceAware = true
        }
        val doc = docFactory.newDocumentBuilder().parse(manifestFile)
        val manifestEl = doc.documentElement

        val usesFeatures = directChildElements(manifestEl, "uses-feature").associate { el ->
            androidAttr(el, "name") to androidAttr(el, "required")
        }
        assertEquals("false", usesFeatures["android.hardware.touchscreen"])
        assertEquals("false", usesFeatures["android.software.leanback"])

        val appEl = directChildElements(manifestEl, "application").single()
        assertEquals("@drawable/tv_banner", androidAttr(appEl, "banner"))
        assertEquals("false", androidAttr(appEl, "usesCleartextTraffic"))
    }

    @Test
    fun `MainActivity exposes LEANBACK_LAUNCHER while preserving LAUNCHER SEND and split VIEW filters`() {
        val manifestFile = resolveRepoFile("app/src/main/AndroidManifest.xml")
        val docFactory = DocumentBuilderFactory.newInstance().apply {
            isNamespaceAware = true
        }
        val doc = docFactory.newDocumentBuilder().parse(manifestFile)
        val appEl = directChildElements(doc.documentElement, "application").single()
        val mainActivity = directChildElements(appEl, "activity").firstOrNull { el ->
            androidAttr(el, "name") == "com.capyboop.paint.MainActivity"
        }
        assertNotNull(mainActivity)
        val activity = mainActivity!!
        assertEquals("true", androidAttr(activity, "exported"))
        assertEquals("singleTask", androidAttr(activity, "launchMode"))

        val configFlags = androidAttr(activity, "configChanges").split("|").toSet()
        for (requiredFlag in listOf("uiMode", "navigation", "keyboard", "keyboardHidden", "screenSize")) {
            assertTrue("Expected configChanges to contain $requiredFlag", configFlags.contains(requiredFlag))
        }

        val intentFilters = directChildElements(activity, "intent-filter")
        val mainFilter = intentFilters.firstOrNull { filter ->
            directChildElements(filter, "action").any {
                androidAttr(it, "name") == "android.intent.action.MAIN"
            }
        }
        assertNotNull(mainFilter)
        val mainCategories = directChildElements(mainFilter!!, "category")
            .map { androidAttr(it, "name") }
            .toSet()
        assertTrue(mainCategories.contains("android.intent.category.LAUNCHER"))
        assertTrue(mainCategories.contains("android.intent.category.LEANBACK_LAUNCHER"))

        val sendFilter = intentFilters.firstOrNull { filter ->
            directChildElements(filter, "action").any {
                androidAttr(it, "name") == "android.intent.action.SEND"
            }
        }
        assertNotNull(sendFilter)
        assertTrue(
            directChildElements(sendFilter!!, "data").any {
                androidAttr(it, "mimeType") == "image/*"
            }
        )

        val viewFilters = intentFilters.filter { filter ->
            directChildElements(filter, "action").any {
                androidAttr(it, "name") == "android.intent.action.VIEW"
            }
        }
        val autoVerifyFilter = viewFilters.firstOrNull { filter ->
            androidAttr(filter, "autoVerify") == "\${appLinksAutoVerify}"
        }
        assertNotNull("Expected dedicated autoVerify App Links intent-filter", autoVerifyFilter)
        val autoVerifyData = directChildElements(autoVerifyFilter!!, "data")
        assertTrue(
            autoVerifyData.any {
                androidAttr(it, "scheme") == "https" && androidAttr(it, "host") == "capypaint.com"
            }
        )
        assertTrue(
            autoVerifyData.any {
                androidAttr(it, "scheme") == "https" && androidAttr(it, "host") == "paint.capyboop.com"
            }
        )
        assertTrue(
            "autoVerify filter must not include redirecting www host",
            autoVerifyData.none { androidAttr(it, "host") == "www.capypaint.com" }
        )
        assertTrue(
            "autoVerify filter must not include GitHub Pages host",
            autoVerifyData.none { androidAttr(it, "host").endsWith(".github.io") }
        )

        val fallbackHttpsViewData = viewFilters
            .filter { androidAttr(it, "autoVerify").isEmpty() }
            .flatMap { directChildElements(it, "data") }
        assertTrue(
            fallbackHttpsViewData.any {
                androidAttr(it, "scheme") == "https" && androidAttr(it, "host") == "www.capypaint.com"
            }
        )
        assertTrue(
            fallbackHttpsViewData.any {
                androidAttr(it, "scheme") == "https" &&
                    androidAttr(it, "host").endsWith(".github.io") &&
                    androidAttr(it, "pathPrefix") == "/capy"
            }
        )

        // Ensure game_services_project_id is declared only via Gradle resValue (never duplicated in strings.xml)
        val stringsXml = resolveRepoFile("app/src/main/res/values/strings.xml").readText()
        assertTrue(
            "strings.xml must not statically declare game_services_project_id (would clash with Gradle resValue)",
            !stringsXml.contains("game_services_project_id")
        )
        val buildGradle = resolveRepoFile("app/build.gradle.kts").readText()
        assertTrue(
            "app/build.gradle.kts must unconditionally emit resValue for game_services_project_id",
            buildGradle.contains("""resValue("string", "game_services_project_id"""")
        )
    }

    @Test
    fun `tv_banner PNG asset exists at exact 320x180 dimensions`() {
        val bannerFile = resolveRepoFile("app/src/main/res/drawable-xhdpi/tv_banner.png")
        assertTrue("Expected drawable-xhdpi/tv_banner.png to exist", bannerFile.exists())
        val byteLen = bannerFile.length()
        assertTrue("Expected non-empty tv_banner.png <= 1MB, got $byteLen", byteLen in 101L..1_048_576L)

        val rawBytes = bannerFile.readBytes()
        val pngMagic = byteArrayOf(
            0x89.toByte(),
            0x50,
            0x4E,
            0x47,
            0x0D,
            0x0A,
            0x1A,
            0x0A,
        )
        assertTrue("tv_banner.png must start with PNG magic signature", rawBytes.size >= 24 && rawBytes.sliceArray(0 until 8).contentEquals(pngMagic))

        val bufferedImage = ImageIO.read(bannerFile)
        assertNotNull("ImageIO.read must decode tv_banner.png", bufferedImage)
        assertEquals(320, bufferedImage.width)
        assertEquals(180, bufferedImage.height)
    }

    @Test
    fun `AndroidManifest suppresses auto profile creation and MainActivity defers Play Games sign-in on launch`() {
        val manifestFile = resolveRepoFile("app/src/main/AndroidManifest.xml")
        val docFactory = DocumentBuilderFactory.newInstance().apply {
            isNamespaceAware = true
        }
        val doc = docFactory.newDocumentBuilder().parse(manifestFile)
        val appEl = directChildElements(doc.documentElement, "application").single()
        val metaDataMap = directChildElements(appEl, "meta-data").associate { el ->
            androidAttr(el, "name") to androidAttr(el, "value")
        }
        assertEquals("@string/game_services_project_id", metaDataMap["com.google.android.gms.games.APP_ID"])
        assertEquals("true", metaDataMap["com.google.android.gms.games.SUPPRESS_GAME_PROFILE_CREATION"])

        val mainActivitySrc = resolveRepoFile("app/src/main/java/com/capyboop/paint/MainActivity.kt").readText()
        val initMatch = Regex("""private fun initializePlayGamesIfConfigured\(\)\s*\{[\s\S]*?\n    \}""")
            .find(mainActivitySrc)
        assertNotNull("MainActivity must define initializePlayGamesIfConfigured()", initMatch)
        val initBody = initMatch!!.value
        assertTrue(initBody.contains("PlayGamesSdk.initialize(this)"))
        assertTrue(!initBody.contains("requestPlayGamesSignIn"))
        assertTrue(!initBody.contains("isAuthenticated"))
        assertTrue(!initBody.contains("pullSnapshotFromPlayGames"))

        val onPageFinishedMatch = Regex("""override fun onPageFinished\([^)]*\)\s*\{[\s\S]*?\n                \}""")
            .find(mainActivitySrc)
        assertNotNull("MainActivity must define onPageFinished()", onPageFinishedMatch)
        assertTrue(!onPageFinishedMatch!!.value.contains("deliverCachedPlayGamesProfileIfNeeded"))
    }
}
