plugins {
    alias(libs.plugins.android.application)
}

val webPackageJson = layout.projectDirectory.file("../web/package.json").asFile
val semverMatch = if (webPackageJson.exists()) {
    Regex(""""version"\s*:\s*"(\d+)\.(\d+)\.(\d+)"""").find(webPackageJson.readText())
} else {
    null
}
val verMajor = semverMatch?.groupValues?.get(1)?.toIntOrNull() ?: 2
val verMinor = semverMatch?.groupValues?.get(2)?.toIntOrNull() ?: 5
val verPatch = semverMatch?.groupValues?.get(3)?.toIntOrNull() ?: 0
val capyVersionName = "$verMajor.$verMinor.$verPatch"
val capyVersionCode = (verMajor * 10000) + (verMinor * 100) + verPatch

android {
    namespace = "com.capypaint.capy"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.capypaint.capy"
        minSdk = 24
        targetSdk = 35
        versionCode = capyVersionCode
        versionName = capyVersionName

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        val playGamesAppId = System.getenv("CAPY_PLAY_GAMES_APP_ID")?.trim()
        if (!playGamesAppId.isNullOrEmpty()) {
            resValue("string", "game_services_project_id", playGamesAppId)
        }
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
    implementation(libs.androidx.webkit)
    implementation(libs.play.services.games.v2)

    testImplementation(libs.junit)
}
