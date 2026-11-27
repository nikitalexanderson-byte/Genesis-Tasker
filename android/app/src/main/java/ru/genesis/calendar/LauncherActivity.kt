package ru.genesis.calendar

import android.app.Activity
import android.app.ActivityManager
import android.content.Intent
import android.os.Bundle

/** Icon aliases belong to this short-lived task, never to the application window.
 * Android can remove a disabled alias's task without closing the user's workspace. */
class LauncherActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // An update can leave a previous version's alias-rooted task in Recents.
        // Retire that obsolete window before reusing the permanent task affinity.
        // Its encrypted repositories and saved workspace are left intact.
        val manager = getSystemService(ACTIVITY_SERVICE) as ActivityManager
        for (task in manager.appTasks) {
            val info = task.taskInfo ?: continue
            if (info.baseActivity?.className == MainActivity::class.java.name &&
                info.baseIntent.component?.className?.startsWith("ru.genesis.calendar.Launcher") == true) {
                task.finishAndRemoveTask()
            }
        }
        val destination = Intent(intent).setClass(this, MainActivity::class.java)
        destination.flags = (destination.flags and
            (Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK or
                Intent.FLAG_ACTIVITY_NEW_DOCUMENT or Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS or
                Intent.FLAG_ACTIVITY_NO_HISTORY).inv()) or Intent.FLAG_ACTIVITY_NEW_TASK
        startActivity(destination)
        finish()
    }
}
