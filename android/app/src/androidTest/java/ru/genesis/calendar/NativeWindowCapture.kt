package ru.genesis.calendar

import android.graphics.BitmapFactory
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.json.JSONObject

/** Captures the composed Android window, including Dialog/Popup roots and the IME. */
internal fun captureNativeWindow(file: File) {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val automation = instrumentation.uiAutomation
    instrumentation.waitForIdleSync()
    automation.waitForIdle(100, 5_000)
    val keyguard = instrumentation.targetContext.getSystemService(android.app.KeyguardManager::class.java)
    check(keyguard?.isKeyguardLocked == false) { "Capture blocked while the keyguard state is locked or unknown" }
    // Unlike Compose PixelCopy, shell screencap needs the submitted frame to reach the compositor.
    SystemClock.sleep(150)
    ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("screencap -p")).use { input ->
        file.outputStream().use { output -> input.copyTo(output); output.fd.sync() }
    }
    check(file.length() > 1024) { "Native screenshot is empty: ${file.name}" }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    check(bounds.outWidth > 0 && bounds.outHeight > 0) { "Invalid PNG: ${file.name}" }
    File(file.absolutePath + ".json").writeText(JSONObject()
        .put("capture", "Android screencap: complete window, dialogs/popups and IME")
        .put("runId", InstrumentationRegistry.getArguments().getString("genesisRunId", "manual"))
        .put("versionName", BuildConfig.VERSION_NAME).put("versionCode", BuildConfig.VERSION_CODE)
        .put("file", file.name).put("widthPx", bounds.outWidth).put("heightPx", bounds.outHeight).toString(2))
}
