pluginManagement {
    repositories {
        google()
        mavenCentral()
        // Some CI runners receive a missing POM from Central for published plugin markers.
        maven("https://maven-central.storage-download.googleapis.com/maven2")
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven("https://maven-central.storage-download.googleapis.com/maven2")
    }
}

rootProject.name = "GenesisCalendar"
include(":app")
