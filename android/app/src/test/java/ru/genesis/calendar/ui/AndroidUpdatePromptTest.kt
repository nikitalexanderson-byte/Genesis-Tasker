package ru.genesis.calendar.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class AndroidUpdatePromptTest {
    @Test fun requiresThe273UpdateFor272Installations() {
        val hash = "a".repeat(64)
        val body = """{"versionCode":79,"versionName":"2.7.3","sha256":"$hash","minimumSupportedVersionCode":79}"""
        assertTrue(requireNotNull(newerAndroidRelease(body, 78)).required)
        assertNull(newerAndroidRelease(body, 79))
    }
    @Test fun offersOnlyNewerWellFormedReleases() {
        val hash = "a".repeat(64)
        val body = """{"versionCode":49,"versionName":"2.4.3","sha256":"$hash"}"""
        assertEquals(AndroidRelease(49, "2.4.3", hash), newerAndroidRelease(body, 48))
        assertNull(newerAndroidRelease(body, 49))
        assertTrue(runCatching {newerAndroidRelease("""{"versionCode":49,"versionName":"../unsafe","sha256":"$hash"}""", 48)}.isFailure)
        assertTrue(runCatching {newerAndroidRelease("""{"versionCode":49,"versionName":"2.4.3","sha256":"bad"}""", 48)}.isFailure)
    }

    @Test fun rejectsDamagedDownloadedApk() {
        val file = File.createTempFile("genesis-update", ".apk")
        try {
            file.writeText("abc")
            val hash = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
            assertTrue(verifiedApk(file, hash))
            file.appendText("truncated or changed")
            assertFalse(verifiedApk(file, hash))
        } finally {
            file.delete()
        }
    }

    @Test fun minimumSupportRequiresUpdateOnlyBelowThePublishedFloor() {
        val hash = "a".repeat(64)
        val body = """{"versionCode":76,"versionName":"2.7.0","sha256":"$hash","minimumSupportedVersionCode":76}"""
        assertTrue(requireNotNull(newerAndroidRelease(body, 75)).required)
        assertNull(newerAndroidRelease(body, 76))
        assertFalse(requireNotNull(newerAndroidRelease(body.replace(":76}", ":74}"), 75)).required)
        assertTrue(runCatching {newerAndroidRelease(body.replace(":76}", ":77}"), 75)}.isFailure)
    }

    @Test fun damagedMetadataNeverMeansTheInstalledAppIsCurrent() {
        val hash="a".repeat(64)
        assertTrue(runCatching {newerAndroidRelease("""{"versionCode":1,"versionName":"3.1.1","sha256":"bad"}""",117)}.isFailure)
        assertTrue(runCatching {newerAndroidRelease("""{"versionCode":0,"versionName":"3.1.1","sha256":"$hash"}""",117)}.isFailure)
        assertTrue(runCatching {newerAndroidRelease("<html>server error</html>",117)}.isFailure)
        assertNull(newerAndroidRelease("""{"versionCode":117,"versionName":"3.1.0","sha256":"$hash"}""",117))
    }
}
