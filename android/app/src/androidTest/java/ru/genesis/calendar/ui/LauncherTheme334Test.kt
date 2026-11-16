package ru.genesis.calendar.ui

import android.app.ActivityManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Launch through the actual icon, not a test Activity that masks Samsung task removal. */
@RunWith(AndroidJUnit4::class)
class LauncherTheme334Test {
    @Test fun launcherEntryUsesStableActivityWhileAllEightIconsChange() {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val context=instrumentation.targetContext
        check(context.packageName.endsWith(".debug"))
        val device=UiDevice.getInstance(instrumentation)
        val manager=context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        fun mainTask()=manager.appTasks.mapNotNull {it.taskInfo}.firstOrNull {
            it.baseActivity?.packageName==context.packageName && it.baseActivity?.className=="ru.genesis.calendar.MainActivity"
        }
        val launcher=Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setPackage(context.packageName)
        val initial=context.packageManager.queryIntentActivities(launcher,0).single().activityInfo.name
        context.startActivity(Intent.makeMainActivity(ComponentName(context.packageName,initial)))
        device.waitForIdle()
        val deadline=System.currentTimeMillis()+10000
        while(mainTask()==null && System.currentTimeMillis()<deadline)Thread.sleep(100)
        assertNotNull("Icon must transfer the task to the permanent MainActivity",mainTask())
        val taskId=mainTask()!!.id
        try {
            for(palette in GenesisBrandIcon.palettes)for(dark in listOf(false,true)) {
                runBlocking {GenesisBrandIcon.updateLauncher(context,palette,dark)}
                // Samsung finishes a task asynchronously after the package-change broadcast.
                Thread.sleep(1400)
                assertEquals("Task survives $palette/$dark",taskId,mainTask()?.id)
                assertEquals("One launcher icon",1,context.packageManager.queryIntentActivities(launcher,0).size)
                assertEquals(GenesisBrandIcon.alias(palette,dark),context.packageManager.queryIntentActivities(launcher,0).single().activityInfo.name)
            }
        } finally {
            runBlocking {GenesisBrandIcon.updateLauncher(context,"green",false)}
        }
    }
}
