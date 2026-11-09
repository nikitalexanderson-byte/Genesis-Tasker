package ru.genesis.calendar.reminders

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.MainActivity
import ru.genesis.calendar.R
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.data.TrackersRepository
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.RecurrenceEngine
import ru.genesis.calendar.domain.trackers.SleepPlan

/** One next alarm per active plan. Restored after boot, app updates and account changes. */
internal object SleepReminderScheduler {
    private const val ACTION = "ru.genesis.calendar.SLEEP_REMINDER"
    private const val CHANNEL = "genesis.sleep.v1"
    private val mutex = Mutex()

    private fun registry(context: Context) = context.getSharedPreferences("genesis_sleep_alarm_registry", Context.MODE_PRIVATE)
    private fun uri(scope: String, planId: String, date: LocalDate) = Uri.Builder().scheme("genesis")
        .authority("sleep-reminder").appendPath(scope).appendPath(planId).appendPath(date.toString()).build()
    private fun pending(context: Context, raw: Uri, create: Boolean): PendingIntent? = PendingIntent.getBroadcast(context, 0,
        Intent(context, SleepReminderReceiver::class.java).apply { action=ACTION; data=raw },
        (if(create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE) or PendingIntent.FLAG_IMMUTABLE)

    internal fun plannedAt(plan: SleepPlan, date: LocalDate): Instant = date.atTime(plan.targetBedtime)
        .atZone(ZoneId.of(plan.schedule.timezone)).minusMinutes(plan.reminderMinutesBefore.toLong()).toInstant()

    internal fun next(plan: SleepPlan, now: Instant): Pair<LocalDate, Instant>? {
        if (!plan.active || !plan.reminderEnabled) return null
        val zone = runCatching { ZoneId.of(plan.schedule.timezone) }.getOrNull() ?: return null
        val recurrence = RecurrenceEngine(GenesisCalendar(zone))
        val firstDate = now.atZone(zone).toLocalDate().minusDays(1)
        return (0L..370L).asSequence().map { firstDate.plusDays(it) }
            .filter { it >= plan.schedule.startDate && (plan.schedule.endDate == null || it <= plan.schedule.endDate) }
            .filter { recurrence.matches(plan.schedule.startDate.toString(),plan.schedule.recurrence,
                it.toString(),ignoreRangeEnd=plan.schedule.endDate==null) }
            .map { it to plannedAt(plan,it) }.firstOrNull { it.second > now }
    }

    suspend fun restore(context: Context) = mutex.withLock {
        val app = context.applicationContext as GenesisApplication
        val scope = app.workspaceScope
        val plans = TrackersRepository(app).workspace.first().sleepPlans
        val alarms = context.getSystemService(AlarmManager::class.java)
        val future = plans.mapNotNull { plan -> next(plan,Instant.now())?.let { (date,at) ->
            Triple(uri(scope,plan.id,date),at,plan)
        } }
        val keys = future.mapTo(linkedSetOf()) { it.first.toString() }
        val storage = registry(context)
        storage.getStringSet("alarms",emptySet()).orEmpty().filterNot(keys::contains).forEach { raw ->
            pending(context,Uri.parse(raw),false)?.let(alarms::cancel)
        }
        future.forEach { (raw,at,_) ->
            val operation=pending(context,raw,true) ?: return@forEach
            try {
                if (app.scheduler.exactAllowed()) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at.toEpochMilli(),operation)
                else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at.toEpochMilli(),operation)
            } catch (_: SecurityException) {
                alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at.toEpochMilli(),operation)
            }
        }
        storage.edit().putStringSet("alarms",keys).apply()
    }

    suspend fun deliver(context: Context, intent: Intent) {
        val raw=intent.data ?: return
        val app=context.applicationContext as GenesisApplication
        if (intent.action!=ACTION || raw.scheme!="genesis" || raw.authority!="sleep-reminder") return
        val parts=raw.pathSegments
        if (parts.size!=3 || parts[0]!=app.workspaceScope) return
        val date=runCatching { LocalDate.parse(parts[2]) }.getOrNull() ?: return
        val plan=TrackersRepository(app).workspace.first().sleepPlans.firstOrNull { it.id==parts[1] } ?: return
        if (!plan.active || !plan.reminderEnabled || date < plan.schedule.startDate ||
            plan.schedule.endDate?.let { date > it } == true) return
        val zone=runCatching { ZoneId.of(plan.schedule.timezone) }.getOrNull() ?: return
        if (!RecurrenceEngine(GenesisCalendar(zone)).matches(plan.schedule.startDate.toString(),plan.schedule.recurrence,
            date.toString(),ignoreRangeEnd=plan.schedule.endDate==null)) return
        val now=Instant.now()
        val at=plannedAt(plan,date)
        if (now < at || now.isAfter(at.plusSeconds(6*60*60))) return
        val storage=registry(context)
        val key=raw.toString()
        val delivered=storage.getStringSet("delivered",emptySet()).orEmpty()
        if (key in delivered) return
        val manager=NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled() || Build.VERSION.SDK_INT>=33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) return
        val english=LocalPreferences(context,app.workspaceScope).values.first().language=="en"
        val notifications=context.getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(NotificationChannel(CHANNEL,
            if(english)"Sleep plan" else "План сна",NotificationManager.IMPORTANCE_DEFAULT))
        if (notifications.getNotificationChannel(CHANNEL)?.importance==NotificationManager.IMPORTANCE_NONE) return
        val open=PendingIntent.getActivity(context,7410,Intent(context,MainActivity::class.java).apply {
            putExtra("scope",app.workspaceScope);putExtra("openSection","sleep")
            flags=Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        },PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val note=NotificationCompat.Builder(context,CHANNEL).setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(if(english)"Time to get ready for sleep" else "Пора готовиться ко сну")
            .setContentText(plan.title).setContentIntent(open).setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setCategory(NotificationCompat.CATEGORY_REMINDER).build()
        try {
            manager.notify(key,7411,note)
            storage.edit().putStringSet("delivered",(delivered+key).toList().takeLast(256).toSet()).apply()
        } catch (_: SecurityException) { }
    }
}

class SleepReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context,intent: Intent) {
        val pending=goAsync()
        val app=context.applicationContext as GenesisApplication
        app.appScope.launch {
            try {
                SleepReminderScheduler.deliver(context,intent)
                SleepReminderScheduler.restore(context)
            } catch (error: Exception) {
                Log.e("GenesisSleep", "Reminder: ${error.javaClass.simpleName}")
            } finally { pending.finish() }
        }
    }
}
