package ru.genesis.calendar

import android.app.DownloadManager
import android.content.Intent
import android.net.Uri
import android.os.Environment
import androidx.core.content.FileProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import androidx.test.uiautomator.By
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.Assume.assumeTrue
import org.junit.runner.RunWith
import ru.genesis.calendar.ui.updateInstallIntent
import ru.genesis.calendar.ui.newerAndroidRelease
import ru.genesis.calendar.ui.verifiedApk
import java.io.File
import java.net.URL

@RunWith(AndroidJUnit4::class)
class AndroidUpdateInstallTest {
    private fun waitForInstallConfirmation(device: UiDevice): Boolean {
        repeat(20) {
            if (listOf("Update", "Install", "Обновить", "Установить")
                    .any { label -> device.hasObject(By.text(label)) }) return true
            Thread.sleep(500)
        }
        return false
    }

    @Test fun sharesTheDownloadedApkWithTheSystemInstaller() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = requireNotNull(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS))
        val apk = File(directory, "GENESIS-provider-test.apk")
        val bytes = byteArrayOf(1, 2, 3, 4)
        try {
            apk.writeBytes(bytes)
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", apk)
            val intent = updateInstallIntent(context, uri)
            assertEquals("content", uri.scheme)
            assertEquals(Intent.ACTION_INSTALL_PACKAGE, intent.action)
            assertEquals(uri, intent.data)
            assertEquals(uri, intent.clipData?.getItemAt(0)?.uri)
            assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
            assertArrayEquals(bytes, context.contentResolver.openInputStream(uri)!!.use { it.readBytes() })
        } finally {
            apk.delete()
        }
    }

    /** Run manually with -e genesisManualInstaller true to inspect the OEM installer. */
    @Test fun systemInstallerOpensTheAppProvidedApk() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("genesisManualInstaller") == "true")
        val context = instrumentation.targetContext
        val directory = requireNotNull(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS))
        val apk = File(directory, "GENESIS-installer-fixture.apk")
        try {
            File(context.applicationInfo.sourceDir).copyTo(apk, overwrite = true)
            assertEquals(context.packageName,
                context.packageManager.getPackageArchiveInfo(apk.absolutePath, 0)?.packageName)
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", apk)
            context.startActivity(updateInstallIntent(context, uri))
            val device = UiDevice.getInstance(instrumentation)
            device.wait(Until.hasObject(By.pkg("com.google.android.packageinstaller")), 10_000)
            assertTrue(device.currentPackageName?.contains("installer", ignoreCase = true) == true)
            assertTrue(waitForInstallConfirmation(device))
            device.takeScreenshot(File(directory, "GENESIS-installer-screen.png"))
            assertTrue(!device.hasObject(By.textContains("Не удалось обработать пакет")))
            assertTrue(!device.hasObject(By.textContains("There was a problem parsing")))
            device.pressBack()
        } finally {
            apk.delete()
        }
    }

    /** Manual end-to-end check against the public release and DownloadManager. */
    @Test fun downloadsAndOpensThePublishedRelease() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("genesisManualDownload") == "true")
        val context = instrumentation.targetContext
        val release = requireNotNull(newerAndroidRelease(
            URL("${BuildConfig.GENESIS_ORIGIN}/android-update.json").readText(), 0))
        val directory = requireNotNull(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS))
        val apk = File(directory, "GENESIS-network-fixture-${release.versionName}.apk")
        val manager = context.getSystemService(DownloadManager::class.java)
        val url = "${BuildConfig.GENESIS_ORIGIN}/downloads/GENESIS-Android-Native-${release.versionName}.apk"
        val request = DownloadManager.Request(Uri.parse(url))
            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, apk.name)
        val id = manager.enqueue(request)
        try {
            var complete = false
            for (attempt in 0 until 240) {
                manager.query(DownloadManager.Query().setFilterById(id)).use { cursor ->
                    assertTrue(cursor.moveToFirst())
                    when (cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))) {
                        DownloadManager.STATUS_SUCCESSFUL -> complete = true
                        DownloadManager.STATUS_FAILED -> fail("Android DownloadManager could not fetch $url")
                    }
                }
                if (complete) break
                Thread.sleep(1_000)
            }
            assertTrue("Download timed out", complete)
            assertTrue("APK checksum differs from release metadata", verifiedApk(apk, release.sha256))
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", apk)
            context.startActivity(updateInstallIntent(context, uri))
            val device = UiDevice.getInstance(instrumentation)
            assertTrue(waitForInstallConfirmation(device))
            device.takeScreenshot(File(directory, "GENESIS-network-installer-screen.png"))
            device.pressBack()
        } finally {
            manager.remove(id)
            apk.delete()
        }
    }
}
