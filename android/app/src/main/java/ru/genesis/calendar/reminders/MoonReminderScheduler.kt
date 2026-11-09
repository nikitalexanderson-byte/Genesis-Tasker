package ru.genesis.calendar.reminders

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.MainActivity
import ru.genesis.calendar.R
import ru.genesis.calendar.data.LocalPreferences
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

internal object MoonReminderScheduler {
    private const val CHANNEL = "genesis.moon.v1"
    private const val ACTION = "ru.genesis.calendar.MOON_REMINDER"
    private const val LATE_SECONDS = 6 * 60 * 60L
    private val mutex = Mutex()

    private fun registry(context: Context) = context.getSharedPreferences("genesis_moon_alarm_registry", Context.MODE_PRIVATE)
    private fun uri(scope: String, plan: PlannedMoonReminder) = Uri.Builder().scheme("genesis")
        .authority("moon-reminder").appendPath(scope).appendPath(plan.kind)
        .appendPath(plan.eventDate.toString()).appendPath(plan.leadDays.toString()).build()
    private fun intent(context: Context, raw: Uri) = Intent(context, MoonReminderReceiver::class.java).apply {
        action = ACTION
        data = raw
    }
    private fun pending(context: Context, raw: Uri, create: Boolean = true): PendingIntent? =
        PendingIntent.getBroadcast(context, 0, intent(context, raw),
            (if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE) or
                PendingIntent.FLAG_IMMUTABLE)

    suspend fun restore(context: Context) = mutex.withLock {
        val app = context.applicationContext as GenesisApplication
        val scope = app.workspaceScope
        val prefs = LocalPreferences(context, scope).values.first()
        val now = Instant.now()
        val zone = ZoneId.systemDefault()
        val storage = registry(context)
        val delivered = storage.getStringSet("delivered", emptySet()).orEmpty()
        val plan = planMoonReminders(now.minusSeconds(LATE_SECONDS), zone,
            prefs.fullMoonLeadDays, prefs.newMoonLeadDays)
        plan.filter { it.at <= now }.forEach { candidate ->
            val key = uri(scope, candidate).toString()
            if (key !in delivered) post(context, scope, candidate, key, storage)
        }
        val future = plan.filter { it.at > now }
        val scheduled = future.mapTo(linkedSetOf()) { uri(scope, it).toString() }
        val alarms = context.getSystemService(AlarmManager::class.java)
        storage.getStringSet("alarms", emptySet()).orEmpty().filterNot { it in scheduled }
            .forEach { raw -> pending(context, Uri.parse(raw), false)?.let(alarms::cancel) }
        future.forEach { candidate ->
            val operation = pending(context, uri(scope, candidate)) ?: return@forEach
            try {
                if (app.scheduler.exactAllowed())
                    alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, candidate.at.toEpochMilli(), operation)
                else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, candidate.at.toEpochMilli(), operation)
            } catch (_: SecurityException) {
                alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, candidate.at.toEpochMilli(), operation)
            }
        }
        storage.edit().putStringSet("alarms", scheduled).apply()
    }

    suspend fun deliver(context: Context, received: Intent) = mutex.withLock {
        val app = context.applicationContext as GenesisApplication
        val raw = received.data ?: return@withLock
        if (received.action != ACTION || raw.scheme != "genesis" || raw.authority != "moon-reminder") return@withLock
        val parts = raw.pathSegments
        if (parts.size != 4 || parts[0] != app.workspaceScope || parts[1] !in setOf("full", "new")) return@withLock
        val eventDate = runCatching { LocalDate.parse(parts[2]) }.getOrNull() ?: return@withLock
        val leadDays = parts[3].toIntOrNull()?.takeIf { it in 1..3 } ?: return@withLock
        val prefs = LocalPreferences(context, app.workspaceScope).values.first()
        val now = Instant.now()
        val candidate = planMoonReminders(now.minusSeconds(LATE_SECONDS), ZoneId.systemDefault(),
            prefs.fullMoonLeadDays, prefs.newMoonLeadDays, 7)
            .firstOrNull { it.kind == parts[1] && it.eventDate == eventDate && it.leadDays == leadDays && it.at <= now }
            ?: return@withLock
        post(context, app.workspaceScope, candidate, raw.toString(), registry(context))
    }

    private suspend fun post(context: Context, scope: String, candidate: PlannedMoonReminder,
        key: String, storage: android.content.SharedPreferences) {
        if ((context.applicationContext as GenesisApplication).workspaceScope != scope) return
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled() || Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val delivered = storage.getStringSet("delivered", emptySet()).orEmpty()
        if (key in delivered) return
        val language = LocalPreferences(context, scope).values.first().language
        val english = language != "ru"
        val title = if (candidate.kind == "full") {
            if (english) "Full moon" else "Полнолуние"
        } else if (english) "New moon" else "Новолуние"
        val date = candidate.eventDate.format(DateTimeFormatter.ofPattern("dd.MM.yyyy"))
        val body = if (english) "$title on $date · in ${candidate.leadDays} day${if(candidate.leadDays==1) "" else "s"}"
            else "$title $date · за ${candidate.leadDays} ${if(candidate.leadDays==1) "сутки" else "суток"}"
        val notifications = context.getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(NotificationChannel(CHANNEL,
            if (english) "Lunar events" else "Лунные события", NotificationManager.IMPORTANCE_DEFAULT).apply {
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        })
        if (notifications.getNotificationChannel(CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) return
        val open = PendingIntent.getActivity(context, 7390,
            Intent(context, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val note = NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("GENESIS · $title").setContentText(body).setContentIntent(open)
            .setCategory(NotificationCompat.CATEGORY_REMINDER).setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build()
        try {
            manager.notify(key, 7391, note)
            storage.edit().putStringSet("delivered", (delivered + key).toList().takeLast(256).toSet()).apply()
        } catch (_: SecurityException) { }
    }
}

class MoonReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        val app = context.applicationContext as GenesisApplication
        app.appScope.launch {
            try {
                MoonReminderScheduler.deliver(context, intent)
                MoonReminderScheduler.restore(context)
            } finally { pending.finish() }
        }
    }
}
