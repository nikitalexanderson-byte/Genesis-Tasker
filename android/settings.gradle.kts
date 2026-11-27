pluginManagement {
    repositories {
        google()
        // Gradle stops at a 429 after retries. Resolve Central artifacts through the
        // Google-hosted Central mirror before contacting the shared CI IP rate limit.
        maven("https://maven-central.storage-download.googleapis.com/maven2")
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        maven("https://maven-central.storage-download.googleapis.com/maven2")
        mavenCentral()
    }
}

rootProject.name = "GenesisCalendar"
include(":app")
