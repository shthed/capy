plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "com.capypaint.capy"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.capypaint.capy"
        minSdk = 24
        targetSdk = 35
        versionCode = 2
        versionName = "2.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
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
    buildFeatures {
        buildConfig = true
    }
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

val buildWebIfNeeded by tasks.registering(Exec::class) {
    workingDir = rootProject.file("web")
    val isWindows = System.getProperty("os.name").lowercase().contains("win")
    val npmCmd = if (isWindows) "npm.cmd" else "npm"
    commandLine(npmCmd, "run", "build")
    onlyIf {
        !rootProject.file("web/dist/index.html").exists()
    }
}

val syncWebAssets by tasks.registering(Sync::class) {
    dependsOn(buildWebIfNeeded)
    val webDistDir = rootProject.file("web/dist")
    from(webDistDir) {
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

    testImplementation(libs.junit)
}
