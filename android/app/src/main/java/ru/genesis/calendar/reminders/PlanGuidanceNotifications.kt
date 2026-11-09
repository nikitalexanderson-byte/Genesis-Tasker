package ru.genesis.calendar.reminders

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import ru.genesis.calendar.MainActivity
import ru.genesis.calendar.R
import ru.genesis.calendar.auth.CloudAccountSnapshot
import ru.genesis.calendar.auth.PlanGuidanceNotice

/** Optional delivery of an acknowledged foreground notice. No permission request or background poll. */
internal object PlanGuidanceNotifications {
    private const val CHANNEL = "genesis.plan-guidance.v1"
    private const val ID = 7423
    private fun tag(uid: String) = "genesis-plan-guidance:" + CloudAccountSnapshot.scopeFor(uid)

    fun deliver(context: Context, uid: String, notice: PlanGuidanceNotice, copy: JSONObject) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val scope = CloudAccountSnapshot.scopeFor(uid)
        val preferences = context.getSharedPreferences("genesis.plan.guidance.notifications.v1", Context.MODE_PRIVATE)
        val key = "$scope:${notice.id}"
        if (preferences.getBoolean(key, false)) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "GENESIS", NotificationManager.IMPORTANCE_DEFAULT))
        if (manager.getNotificationChannel(CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) return
        val intent = Intent(context, MainActivity::class.java).apply {
            data = Uri.Builder().scheme("genesis").authority("section").appendPath("plan-guidance").appendPath(scope).appendPath(notice.id).build()
            putExtra("scope", scope); putExtra("openSection", "plan-guidance")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val open = PendingIntent.getActivity(context, notice.id.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val body = copy.getString(notice.topic)
        val notification = NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(copy.getString("title")).setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body)).setContentIntent(open)
            .addAction(0, copy.getString("compare"), open).setAutoCancel(true).build()
        try {
            NotificationManagerCompat.from(context).notify(tag(uid), ID, notification)
            preferences.edit().putBoolean(key, true).apply()
        } catch (_: SecurityException) { /* Permission may be withdrawn between the check and delivery. */ }
    }

    fun clear(context: Context, uid: String) { NotificationManagerCompat.from(context).cancel(tag(uid), ID) }
}
