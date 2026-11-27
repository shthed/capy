plugins {
    alias(libs.plugins.android.application)
}

val webPackageJson = layout.projectDirectory.file("../web/package.json").asFile
if (!webPackageJson.exists()) {
    throw GradleException("Missing web/package.json at '${webPackageJson.absolutePath}'.")
}
val semverMatch = Regex(""""version"\s*:\s*"(\d+)\.(\d+)\.(\d+)"""").find(webPackageJson.readText())
    ?: throw GradleException("Unable to parse SemVer 'version' field from '${webPackageJson.absolutePath}'.")
val verMajor = semverMatch.groupValues[1].toInt()
val verMinor = semverMatch.groupValues[2].toInt()
val verPatch = semverMatch.groupValues[3].toInt()
val capyVersionName = "$verMajor.$verMinor.$verPatch"
val capyVersionCode = (verMajor * 10000) + (verMinor * 100) + verPatch

android {
    namespace = "com.capyboop.paint"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.capyboop.paint"
        minSdk = 24
        targetSdk = 37
        versionCode = capyVersionCode
        versionName = capyVersionName

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        val rawPlayGamesAppId = System.getenv("CAPY_PLAY_GAMES_APP_ID")?.trim().orEmpty()
        val resolvedPlayGamesAppId = if (rawPlayGamesAppId.isEmpty()) {
            "000000000000"
        } else {
            if (!Regex("^[0-9]{6,}$").matches(rawPlayGamesAppId)) {
                throw GradleException("CAPY_PLAY_GAMES_APP_ID must be a numeric Play Games project ID (>= 6 digits).")
            }
            rawPlayGamesAppId
        }
        resValue("string", "game_services_project_id", resolvedPlayGamesAppId)

        val rawCertFingerprints = System.getenv("CAPY_ANDROID_SHA256_CERT_FINGERPRINTS")?.trim().orEmpty()
        val hasValidCertFingerprints = rawCertFingerprints
            .split(Regex("[,;\\s]+"))
            .map { token ->
                val upper = token.trim().uppercase()
                if (Regex("^[0-9A-F]{64}$").matches(upper)) {
                    upper.chunked(2).joinToString(":")
                } else {
                    upper
                }
            }
            .any { candidate ->
                Regex("^([0-9A-F]{2}:){31}[0-9A-F]{2}$").matches(candidate) &&
                    !Regex("^(00:){31}00$").matches(candidate)
            }
        manifestPlaceholders["appLinksAutoVerify"] = hasValidCertFingerprints.toString()
    }

    val releaseKeystorePath = System.getenv("CAPY_KEYSTORE_PATH")
    signingConfigs {
        if (!releaseKeystorePath.isNullOrBlank()) {
            create("release") {
                storeFile = file(releaseKeystorePath)
                storePassword = System.getenv("CAPY_KEYSTORE_PASSWORD") ?: ""
                keyAlias = System.getenv("CAPY_KEY_ALIAS") ?: ""
                keyPassword = System.getenv("CAPY_KEY_PASSWORD") ?: ""
            }
        }
    }

    buildTypes {
        debug {
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            if (!releaseKeystorePath.isNullOrBlank()) {
                signingConfig = signingConfigs.getByName("release")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions {
        unitTests {
            isReturnDefaultValues = true
        }
    }
    buildFeatures {
        buildConfig = true
        resValues = true
    }
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

val buildWeb = tasks.register<Exec>("buildWeb") {
    description = "Builds the web/ TypeScript/Vite frontend bundle into web/dist."
    group = "build"
    workingDir = layout.projectDirectory.dir("../web").asFile

    val isWindows = System.getProperty("os.name").lowercase().contains("windows")
    commandLine(if (isWindows) listOf("cmd", "/c", "npm", "run", "build") else listOf("npm", "run", "build"))

    inputs.dir(layout.projectDirectory.dir("../web/src"))
    inputs.dir(layout.projectDirectory.dir("../web/public"))
    inputs.file(layout.projectDirectory.file("../web/package.json"))
    inputs.file(layout.projectDirectory.file("../web/vite.config.ts"))
    inputs.file(layout.projectDirectory.file("../web/index.html"))
    outputs.dir(layout.projectDirectory.dir("../web/dist"))
}

val syncWebAssets = tasks.register<Sync>("syncWebAssets") {
    val distIndex = layout.projectDirectory.file("../web/dist/index.html").asFile
    doFirst {
        if (!distIndex.exists()) {
            throw GradleException(
                "Missing web frontend distribution bundle at '${distIndex.absolutePath}'.\n" +
                "Before compiling the Android launcher, please build the web assets by running:\n" +
                "  cd web && npm ci && npm run build\n" +
                "or run the Gradle task ':app:buildWeb' (if Node.js / npm is installed)."
            )
        }
    }
    from(layout.projectDirectory.dir("../web/dist")) {
        exclude("**/capy.png")
    }
    into(layout.projectDirectory.dir("src/main/assets/www"))
}

tasks.named("preBuild") {
    dependsOn(syncWebAssets)
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.ktx)
    // Pin Fragment >= 1.3.0: play-services-games-v2 pulls an old transitive androidx.fragment,
    // which fails lintVitalRelease (InvalidFragmentVersionForActivityResult) on registerForActivityResult.
    implementation(libs.androidx.fragment.ktx)
    implementation(libs.androidx.webkit)
    implementation(libs.play.services.games.v2)

    testImplementation(libs.junit)
}
