package ru.genesis.calendar.reminders

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.graphics.Color
import android.os.Build
import android.os.PowerManager
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.flow.first
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.MainActivity
import ru.genesis.calendar.R
import ru.genesis.calendar.data.ReminderRecord
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.data.HabitsRepository
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

class ReminderScheduler(private val context: Context) {
    // The application runs in one process. Serialize the DB transition and the
    // system side effect so an old delivery cannot race past an edit/cancel.
    private val mutation = Mutex()
    suspend fun <T> withMutation(block: suspend () -> T): T = mutation.withLock { block() }
    companion object {
        const val TASK_CHANNEL = "genesis.tasks.v2"
        const val HABIT_CHANNEL = "genesis.habits.v2"
        const val DAILY_GOAL_CHANNEL = "genesis.daily-goal.v1"
        const val ACHIEVEMENT_CHANNEL = "genesis.achievements.v1"
        internal const val HABIT_LATE_WINDOW_SECONDS = 6L * 60 * 60
        internal const val TASK_LATE_WINDOW_MILLIS = 6L * 60 * 60 * 1000
        internal const val DIAGNOSTIC_ACTION = "ru.genesis.calendar.NOTIFICATION_DIAGNOSTIC"
    }
    private val app get() = context.applicationContext as GenesisApplication
    private val alarms get() = context.getSystemService(AlarmManager::class.java)
    private val notifications get() = context.getSystemService(NotificationManager::class.java)
    private val diagnosticStore get() = context.getSharedPreferences("genesis.notification.diagnostics.v1", Context.MODE_PRIVATE)
    fun exactAllowed() = Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms()
    fun notificationsAllowed() = NotificationManagerCompat.from(context).areNotificationsEnabled() &&
        (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
    fun channelAllowed() = notifications.getNotificationChannel(TASK_CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
    fun channelAllowed(channel: String) = notifications.getNotificationChannel(channel)?.importance != NotificationManager.IMPORTANCE_NONE
    fun batteryOptimizationsIgnored() = context.getSystemService(PowerManager::class.java)
        .isIgnoringBatteryOptimizations(context.packageName)
    fun scheduledHabitAlarmCount() = context.getSharedPreferences("genesis_habit_alarm_registry", Context.MODE_PRIVATE)
        .getStringSet("alarms", emptySet()).orEmpty().size
    fun lastDiagnosticScheduledAt() = diagnosticStore.getLong("scheduledAt", 0)
    fun lastDiagnosticDeliveredAt() = diagnosticStore.getLong("deliveredAt", 0)
    fun lastRecoveryAt() = diagnosticStore.getLong("lastRecoveryAt", 0)
    private fun NotificationCompat.Builder.distinctPresentation(channel: String, body: String): NotificationCompat.Builder {
        val task = channel == TASK_CHANNEL
        val view = RemoteViews(context.packageName, R.layout.notification_reminder).apply {
            setInt(R.id.reminder_type_badge, "setBackgroundResource", if (task) R.drawable.notification_task_badge else R.drawable.notification_habit_badge)
            setImageViewResource(R.id.reminder_type_icon, if (task) R.drawable.ic_notification_task else R.drawable.ic_notification_habit)
            setTextViewText(R.id.reminder_type_label, notifications.getNotificationChannel(channel)?.name?.toString().orEmpty())
            setTextViewText(R.id.reminder_body, body)
        }
        return setStyle(NotificationCompat.DecoratedCustomViewStyle()).setCustomContentView(view).setCustomBigContentView(view)
    }
    fun createChannels(language: String = "ru", taskChannelId: String = TASK_CHANNEL, habitChannelId: String = HABIT_CHANNEL,
        legacyTaskChannelId: String = "genesis.tasks.v1", legacyHabitChannelId: String = "genesis.habits.v1") {
        context.getSharedPreferences("genesis.notification.locale.v1", Context.MODE_PRIVATE)
            .edit().putString("language", language).apply()
        val names = notificationChannelNames(language)
        val labels = listOf(taskChannelId, habitChannelId, DAILY_GOAL_CHANNEL, ACHIEVEMENT_CHANNEL).zip(names)
        labels.forEach { (id, label) ->
            val oldId = when (id) { taskChannelId -> legacyTaskChannelId; habitChannelId -> legacyHabitChannelId; else -> id }
            val legacy = notifications.getNotificationChannel(oldId)
            val channel = NotificationChannel(id, label, legacy?.importance ?: NotificationManager.IMPORTANCE_HIGH)
            val defaultSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            val customLegacy = legacy?.takeIf { (Build.VERSION.SDK_INT >= 30 && it.hasUserSetSound()) || (Build.VERSION.SDK_INT < 30 && it.sound != defaultSound) }
            val sound = when (id) {
                taskChannelId -> Uri.parse("android.resource://${context.packageName}/raw/genesis_task_notification")
                habitChannelId -> Uri.parse("android.resource://${context.packageName}/raw/genesis_habit_notification")
                else -> defaultSound
            }
            channel.setSound(if (customLegacy != null) customLegacy.sound else sound,
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build())
            channel.enableLights(true)
            channel.lightColor = if (id == taskChannelId) Color.rgb(37, 91, 89) else Color.rgb(140, 103, 43)
            channel.vibrationPattern = legacy?.vibrationPattern ?: if (id == taskChannelId) longArrayOf(0, 120, 80, 120) else longArrayOf(0, 60, 180, 60)
            channel.enableVibration(legacy?.shouldVibrate() ?: true)
            channel.lockscreenVisibility = Notification.VISIBILITY_PRIVATE
            notifications.createNotificationChannel(channel)
        }
        notifications.createNotificationChannel(NotificationChannel("genesis.sync.v1", names[4],
            NotificationManager.IMPORTANCE_LOW).apply { setSound(null, null) })
    }
    private fun openHabitsIntent() = PendingIntent.getActivity(context, 7300,
        habitNotificationOpenIntent(context, app.workspaceScope),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    fun showHabitTonePreview(tone: String, language: String): Boolean {
        createChannels(language)
        if (!notificationsAllowed() || !channelAllowed(HABIT_CHANNEL)) return false
        val body = habitNotificationBody(tone, "habit", 1, language, System.nanoTime().toString())
        val note = NotificationCompat.Builder(context, HABIT_CHANNEL)
            .setGroup("genesis.habits").setSubText(notifications.getNotificationChannel(HABIT_CHANNEL)?.name)
            .setColor(Color.rgb(140, 103, 43)).setSmallIcon(R.drawable.ic_notification_habit)
            .setContentTitle("GENESIS")
            .setContentText(body).distinctPresentation(HABIT_CHANNEL, body)
            .setContentIntent(openHabitsIntent()).setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setAutoCancel(true).build()
        return try {
            NotificationManagerCompat.from(context).notify("habit-tone-preview", 7301, note); true
        } catch (_: SecurityException) { false }
        catch (_: Exception) { false }
    }
    fun showHabitTonePreview(tone: String, english: Boolean): Boolean =
        showHabitTonePreview(tone, if (english) "en" else "ru")

    fun showFeedbackPreviewNotification(language: String, title: String, body: String): Boolean {
        createChannels(language)
        if (!notificationsAllowed() || !channelAllowed(ACHIEVEMENT_CHANNEL)) return false
        val note = NotificationCompat.Builder(context, ACHIEVEMENT_CHANNEL)
            // Foreground completion effects own audio/haptics; never add a second OS chime.
            .setSilent(true)
            .setSmallIcon(R.drawable.ic_notification).setContentTitle("GENESIS · $title")
            .setContentText(body).setContentIntent(openHabitsIntent())
            .setCategory(NotificationCompat.CATEGORY_STATUS).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true).build()
        return try {
            NotificationManagerCompat.from(context).notify("habit-feedback-test", 7303, note); true
        } catch (_: SecurityException) { false }
        catch (_: Exception) { false }
    }

    fun showAchievementNotification(count: Int, language: String): Boolean {
        if (count <= 0) return false
        createChannels(language)
        if (!notificationsAllowed() || !channelAllowed(ACHIEVEMENT_CHANNEL)) return false
        val body = achievementNotificationBody(language, count)
        val note = NotificationCompat.Builder(context, ACHIEVEMENT_CHANNEL)
            // Foreground completion effects own audio/haptics; never add a second OS chime.
            .setSilent(true)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("GENESIS · ${notificationAuxCopy(language).achievementTitle}")
            .setContentText(body).setContentIntent(openHabitsIntent())
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setAutoCancel(true).build()
        return try {
            NotificationManagerCompat.from(context).notify("habit-achievement", 7302, note); true
        } catch (_: SecurityException) { false }
        catch (_: Exception) { false }
    }
    fun showAchievementNotification(count: Int, english: Boolean): Boolean =
        showAchievementNotification(count, if (english) "en" else "ru")
    private fun diagnosticIntent(at: Long) = Intent(context, DiagnosticNotificationReceiver::class.java).apply {
        action = DIAGNOSTIC_ACTION
        data = Uri.Builder().scheme("genesis").authority("notification-diagnostic").appendPath(at.toString()).build()
        putExtra("at", at)
    }
    private fun diagnosticPending(at: Long) = PendingIntent.getBroadcast(context, 7380,
        diagnosticIntent(at), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    fun scheduleDiagnosticNotification(delayMillis: Long = 60_000): Long? {
        createChannels(context.getSharedPreferences("genesis.notification.locale.v1", Context.MODE_PRIVATE)
            .getString("language", "ru") ?: "ru")
        if (!notificationsAllowed() || !channelAllowed(HABIT_CHANNEL)) return null
        lastDiagnosticScheduledAt().takeIf { it > 0 }?.let { old -> alarms.cancel(diagnosticPending(old)) }
        val at = System.currentTimeMillis() + delayMillis.coerceAtLeast(1_000)
        diagnosticStore.edit().putLong("scheduledAt", at).remove("deliveredAt").commit()
        val pending = diagnosticPending(at)
        try {
            if (exactAllowed()) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
            else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
        } catch (_: SecurityException) {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
        }
        return at
    }
    fun deliverDiagnosticNotification(intent: Intent): Boolean {
        val at = intent.getLongExtra("at", 0)
        if (intent.action != DIAGNOSTIC_ACTION || at <= 0 || !notificationsAllowed() ||
            !channelAllowed(HABIT_CHANNEL)) return false
        // Keep the alarm receiver synchronous and independent of DataStore startup. This path is
        // also the user's test of whether Android can cold-start notification delivery.
        val language = context.getSharedPreferences("genesis.notification.locale.v1", Context.MODE_PRIVATE)
            .getString("language", Locale.getDefault().language) ?: "en"
        val copy = notificationAuxCopy(language)
        val body = copy.diagnosticBody
        val note = NotificationCompat.Builder(context, HABIT_CHANNEL)
            .setGroup("genesis.habits").setSubText(notifications.getNotificationChannel(HABIT_CHANNEL)?.name)
            .setColor(Color.rgb(140, 103, 43)).setSmallIcon(R.drawable.ic_notification_habit)
            .setContentTitle("GENESIS · ${copy.diagnosticTitle}")
            .setContentText(body).distinctPresentation(HABIT_CHANNEL, body)
            .setContentIntent(openHabitsIntent()).setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setAutoCancel(true).build()
        return try {
            NotificationManagerCompat.from(context).notify("notification-diagnostic", 7303, note)
            diagnosticStore.edit().putLong("deliveredAt", System.currentTimeMillis()).commit()
            true
        } catch (_: SecurityException) { false }
    }
    private fun intent(row: ReminderRecord, action: String, clazz: Class<*>) = Intent(context, clazz).apply {
        this.action = action
        data = Uri.Builder().scheme("genesis").authority("reminder").appendPath(row.scope).appendPath(row.id).appendPath(action).build()
        putExtra("scope", row.scope); putExtra("id", row.id); putExtra("revision", row.revision)
    }
    private fun alarmIntent(row: ReminderRecord) = PendingIntent.getBroadcast(context, 0,
        intent(row, "deliver", ReminderReceiver::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    fun schedule(row: ReminderRecord) {
        if (row.scope != app.workspaceScope || row.state != "pending") return
        // Missed alarms are shown as overdue in the diagnostics, never replayed in a sound storm.
        if (row.at <= System.currentTimeMillis()) return
        val pending = alarmIntent(row)
        try {
            if (exactAllowed()) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, row.at, pending)
            else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, row.at, pending)
        } catch (_: SecurityException) {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, row.at, pending)
        }
    }
    fun cancel(row: ReminderRecord) {
        alarms.cancel(alarmIntent(row))
        notifications.cancel(row.scope + "/" + row.id, 1)
    }
    /** Keep the nearest alarms active; later recurrence alarms are promoted after deliveries. */
    suspend fun scheduleUpcomingLocked(scope: String) {
        if (scope != app.workspaceScope) return
        val now = System.currentTimeMillis()
        val upcoming = app.database.dao().reminders(scope).asSequence()
            .filter { it.state == "pending" && it.at > now }
            .sortedBy { it.at }.take(100).toList()
        upcoming.forEach(::schedule)
        ReminderRecoveryWorker.scheduleTasks(context, upcoming.firstOrNull()?.at)
        // Recovery can replay at most four recent rows; older overdue rows remain visible in diagnostics.
    }
    suspend fun restore(recoverOverdue: Boolean = false) = withMutation {
        val scope = app.workspaceScope
        if (recoverOverdue) {
            val now = System.currentTimeMillis()
            app.database.dao().reminders(scope).asSequence()
                .filter { it.state == "pending" && it.at in (now - TASK_LATE_WINDOW_MILLIS)..now }
                .sortedBy { it.at }.toList().takeLast(4)
                .forEach { deliverLocked(scope, it.id, it.revision, scheduleNext = false) }
        }
        scheduleUpcomingLocked(scope)
        diagnosticStore.edit().putLong("lastRecoveryAt", System.currentTimeMillis()).apply()
    }

    /** System PendingIntents survive closing the UI and process recreation. */
    suspend fun restoreHabitNotifications() = withMutation {
        val scope = app.workspaceScope
        val workspace = runCatching { HabitsRepository(app).workspace.first() }.getOrNull() ?: return@withMutation
        val language = LocalPreferences(context, scope).values.first().language
        if (scope != app.workspaceScope) return@withMutation
        val zone = ZoneId.systemDefault()
        val registry = context.getSharedPreferences("genesis_habit_alarm_registry", Context.MODE_PRIVATE)
        val now = java.time.Instant.now()
        val from = now.minusSeconds(HABIT_LATE_WINDOW_SECONDS)
        val delivered = registry.getStringSet("delivered", emptySet()).orEmpty()
        val snoozedPlan = habitReminderSnoozes(registry).filter { it.scope == scope && it.until >= from }.mapNotNull { saved ->
            val habit = workspace.habits.firstOrNull { it.id == saved.target.habitId }
            if (ru.genesis.calendar.domain.habits.habitReminderAction(habit, saved.target, workspace.completions,
                    workspace.measurements, now) !in setOf("complete", "interval", "input")) return@mapNotNull null
            val original = planHabitNotifications(workspace, saved.target.date, saved.target.at.minusMillis(1), zone, language, 1)
                .firstOrNull { it.target == saved.target } ?: return@mapNotNull null
            if (habit?.reminder?.allowDuringQuietHours != true && quietHabitReminder(saved.until, workspace, zone)) return@mapNotNull null
            original.copy(at = saved.until)
        }
        val fullPlan = if (notificationsAllowed()) (planHabitNotifications(workspace, from.atZone(zone).toLocalDate(),
            from, zone, language, 9, habitReminderFrequency(context, scope).maxPerDay) + snoozedPlan).sortedBy { it.at }
            .filterNot { habitUri(it, scope) in delivered }.take(128) else emptyList()
        fullPlan.filter { !it.at.isAfter(now) }.takeLast(4).forEach { candidate ->
            postHabitNotification(candidate, scope, habitUri(candidate, scope), registry, language)
        }
        val deliveredAfterRecovery = registry.getStringSet("delivered", emptySet()).orEmpty()
        val plan = fullPlan.filter { it.at.isAfter(now) && habitUri(it, scope) !in deliveredAfterRecovery }
        val scheduledUris = plan.mapTo(linkedSetOf()) { candidate ->
            habitUri(candidate, scope)
        }
        fun pending(raw: String, candidate: PlannedHabitNotification): PendingIntent {
            val intent = Intent(context, HabitNotificationReceiver::class.java).apply {
                action = "ru.genesis.calendar.HABIT_NOTIFICATION"
                data = Uri.parse(raw)
                putExtra("scope", scope)
                candidate.let {
                    putExtra("date", it.date.toString()); putExtra("kind", it.kind)
                    putExtra("habitId", it.habitId); putExtra("at", it.at.toEpochMilli())
                    it.target?.let { target -> putHabitReminderTarget(target) }
                }
            }
            return PendingIntent.getBroadcast(context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        registry.getStringSet("alarms", emptySet()).orEmpty().filterNot { it in scheduledUris }
            .forEach(::cancelHabitAlarm)
        plan.zip(scheduledUris).forEach { (candidate, raw) ->
            val operation = pending(raw, candidate)
            val deliveryAt = candidate.at.toEpochMilli()
            try {
                if (exactAllowed()) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, deliveryAt, operation)
                else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, deliveryAt, operation)
            } catch (_: SecurityException) { alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, deliveryAt, operation) }
        }
        registry.edit().putStringSet("alarms", scheduledUris).commit()
        ReminderRecoveryWorker.scheduleHabits(context, plan.firstOrNull()?.at?.toEpochMilli())
        diagnosticStore.edit().putLong("lastRecoveryAt", System.currentTimeMillis()).apply()
    }

    private fun habitUri(candidate: PlannedHabitNotification, scope: String) = Uri.Builder().scheme("genesis")
        .authority("habit-reminder").appendPath(scope).appendPath(candidate.key).build().toString()

    private fun cancelHabitAlarm(raw: String) {
        // Cancellation must never replace the extras of an alarm already being delivered
        // during cold process startup.
        val operation = PendingIntent.getBroadcast(context, 0, Intent(context, HabitNotificationReceiver::class.java).apply {
            action = "ru.genesis.calendar.HABIT_NOTIFICATION"; data = Uri.parse(raw)
        }, PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE) ?: return
        alarms.cancel(operation)
    }

    suspend fun deliverHabitNotification(intent: Intent) = withMutation {
        val scope = intent.getStringExtra("scope")
        if (scope != app.workspaceScope || !notificationsAllowed()) return@withMutation
        val date = runCatching { LocalDate.parse(intent.getStringExtra("date")) }.getOrNull() ?: return@withMutation
        val at = java.time.Instant.ofEpochMilli(intent.getLongExtra("at", 0))
        val now = java.time.Instant.now()
        if (at > now.plusSeconds(1) || at < now.minusSeconds(HABIT_LATE_WINDOW_SECONDS)) return@withMutation
        val workspace = HabitsRepository(app).workspace.first()
        val language = LocalPreferences(context, app.workspaceScope).values.first().language
        val target = habitReminderTarget(intent)
        val snoozed = target?.takeIf { it.at != at }?.let { original ->
            habitReminderSnoozes(context.getSharedPreferences("genesis_habit_alarm_registry", Context.MODE_PRIVATE))
                .firstOrNull { it.scope == scope && it.target == original && it.until == at }
        }
        val sourceAt = snoozed?.target?.at ?: at
        val candidate = planHabitNotifications(workspace, date, sourceAt.minusMillis(1), ZoneId.systemDefault(), language, 1)
            .firstOrNull { it.kind == intent.getStringExtra("kind") && it.habitId == intent.getStringExtra("habitId") && it.at == sourceAt }
            ?: return@withMutation
        if (snoozed != null && candidate.target != null && ru.genesis.calendar.domain.habits.habitReminderAction(
                workspace.habits.firstOrNull { it.id == candidate.habitId }, candidate.target,
                workspace.completions, workspace.measurements, now) !in setOf("complete", "interval", "input")) return@withMutation
        if (snoozed != null && workspace.habits.firstOrNull { it.id == candidate.habitId }?.reminder?.allowDuringQuietHours != true
            && quietHabitReminder(now, workspace, ZoneId.systemDefault())) return@withMutation
        val registry = context.getSharedPreferences("genesis_habit_alarm_registry", Context.MODE_PRIVATE)
        val key = intent.data.toString()
        if (scope != app.workspaceScope) return@withMutation
        postHabitNotification(candidate.copy(at = at), scope, key, registry, language)
    }

    private fun postHabitNotification(candidate: PlannedHabitNotification, scope: String, key: String,
        registry: android.content.SharedPreferences, language: String): Boolean {
        if (scope != app.workspaceScope || !notificationsAllowed()) return false
        val channel = if (candidate.kind == "goal") DAILY_GOAL_CHANNEL else HABIT_CHANNEL
        if (!channelAllowed(channel)) return false
        val delivered = registry.getStringSet("delivered", emptySet()).orEmpty()
        if (key in delivered) return false
        val deliveredAt = System.currentTimeMillis()
        val deliveryTimes = registry.getStringSet("deliveryTimes", emptySet()).orEmpty().filter { record ->
            record.substringAfterLast('\t').toLongOrNull()?.let { it >= deliveredAt - 172800000 } == true
        }
        val countToday = habitDeliveryCount(registry, scope, java.time.Instant.ofEpochMilli(deliveredAt))
        if (countToday >= habitReminderFrequency(context, scope).maxPerDay) return false
        val builder = NotificationCompat.Builder(context, channel)
            .setGroup("genesis.habits").setSubText(notifications.getNotificationChannel(channel)?.name)
            .setColor(Color.rgb(140, 103, 43)).setSmallIcon(R.drawable.ic_notification_habit).setContentTitle(candidate.title)
            .setContentText(candidate.body).distinctPresentation(HABIT_CHANNEL, candidate.body)
            .setContentIntent(habitOpenAction(candidate, scope, "open")).setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setAutoCancel(true)
        if (candidate.target != null) {
            val primary = if (candidate.primaryAction == "complete") "Выполнено" else "Добавить значение"
            builder.addAction(0, ru.genesis.calendar.ui.translateGenesisText(context, primary, language),
                habitOpenAction(candidate, scope, candidate.primaryAction))
            val snoozeIntent = Intent(context, HabitReminderActionReceiver::class.java).apply {
                action = "ru.genesis.calendar.HABIT_SNOOZE"
                data = Uri.Builder().scheme("genesis").authority("habit-snooze").appendPath(scope).appendPath(candidate.key).build()
                putExtra("scope", scope); putExtra("requestId", key); putHabitReminderTarget(candidate.target)
            }
            builder.addAction(0, ru.genesis.calendar.ui.translateGenesisText(context, "Отложить", language),
                PendingIntent.getBroadcast(context, 0, snoozeIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        }
        val notification = builder.build()
        return try {
            NotificationManagerCompat.from(context).notify(key, 2, notification)
            registry.edit().putStringSet("delivered", (delivered + key).toList().takeLast(256).toSet())
                .putStringSet("deliveryTimes", (deliveryTimes + "$key\t$deliveredAt").takeLast(512).toSet()).commit()
            diagnosticStore.edit().putLong("lastDeliveryAt", System.currentTimeMillis()).apply()
            true
        } catch (_: SecurityException) { false }
    }

    private fun habitOpenAction(candidate: PlannedHabitNotification, scope: String, action: String): PendingIntent =
        PendingIntent.getActivity(context, 0, habitNotificationOpenIntent(context, scope, candidate.target, action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun quietHabitReminder(at: java.time.Instant, workspace: ru.genesis.calendar.data.LocalHabitWorkspace, zone: ZoneId): Boolean {
        val settings = workspace.settings.notifications
        val start = java.time.LocalTime.parse(settings.quietHoursStart); val end = java.time.LocalTime.parse(settings.quietHoursEnd)
        val time = at.atZone(zone).toLocalTime()
        return start != end && if (start < end) time >= start && time < end else time >= start || time < end
    }

    private fun habitDeliveryCount(registry: android.content.SharedPreferences, scope: String, now: java.time.Instant): Int {
        val today = now.atZone(ZoneId.systemDefault()).toLocalDate()
        return registry.getStringSet("deliveryTimes", emptySet()).orEmpty().count { record ->
            val deliveredAt = record.substringAfterLast('\t').toLongOrNull()
            deliveredAt != null && Uri.parse(record.substringBeforeLast('\t')).pathSegments.firstOrNull() == scope
                && java.time.Instant.ofEpochMilli(deliveredAt).atZone(ZoneId.systemDefault()).toLocalDate() == today
        }
    }

    suspend fun snoozeHabitNotification(intent: Intent): Boolean = withMutation {
        val scope = intent.getStringExtra("scope") ?: return@withMutation false
        if (scope != app.workspaceScope || !notificationsAllowed()) return@withMutation false
        val target = habitReminderTarget(intent) ?: return@withMutation false
        val requestId = intent.getStringExtra("requestId") ?: return@withMutation false
        if (!requestId.startsWith("genesis://habit-reminder/")) return@withMutation false
        val workspace = HabitsRepository(app).workspace.first()
        val habit = workspace.habits.firstOrNull { it.id == target.habitId }
        val now = java.time.Instant.now()
        if (ru.genesis.calendar.domain.habits.habitReminderAction(habit, target, workspace.completions,
                workspace.measurements, now) !in setOf("complete", "interval", "input")) return@withMutation false
        val registry = context.getSharedPreferences("genesis_habit_alarm_registry", Context.MODE_PRIVATE)
        val receipts = registry.getStringSet("snoozeRequests", emptySet()).orEmpty()
        if (requestId in receipts) return@withMutation true
        if (habitDeliveryCount(registry, scope, now) >= habitReminderFrequency(context, scope).maxPerDay) return@withMutation false
        val until = now.plusSeconds(habitReminderFrequency(context, scope).snoozeMinutes * 60L)
        if (until.atZone(ZoneId.of(ru.genesis.calendar.domain.habits.HabitMeasurements.rule(requireNotNull(habit),target.date).schedule.timezone)).toLocalDate() != target.date
            || !habit.reminder.allowDuringQuietHours && quietHabitReminder(until, workspace, ZoneId.systemDefault())) return@withMutation false
        val rows = habitReminderSnoozes(registry).filter { it.until > now.minusSeconds(86400) }
        val next = (rows + HabitReminderSnooze(scope, requestId, target, until)).takeLast(256).mapTo(linkedSetOf()) { it.encode() }
        check(registry.edit().putStringSet("snoozes", next).putStringSet("snoozeRequests", (receipts + requestId).toList().takeLast(256).toSet()).commit())
        notifications.cancel(requestId, 2)
        true
    }
    /** Remove account-specific system alarms/notifications when its session leaves the device. */
    suspend fun deactivate(scope: String) = withMutation {
        app.database.dao().reminders(scope).forEach(::cancel)
        val registry = context.getSharedPreferences("genesis_habit_alarm_registry", Context.MODE_PRIVATE)
        val all = registry.getStringSet("alarms", emptySet()).orEmpty()
        val removed = all.filter { Uri.parse(it).pathSegments.firstOrNull() == scope }
        removed.forEach(::cancelHabitAlarm)
        registry.edit().putStringSet("alarms", all - removed.toSet()).commit()
        notifications.activeNotifications.filter {
            it.tag?.let { tag -> Uri.parse(tag).authority == "habit-reminder" && Uri.parse(tag).pathSegments.firstOrNull() == scope } == true
        }.forEach { notifications.cancel(it.tag, it.id) }
    }
    suspend fun deliver(scope: String, id: String, revision: Long) = withMutation { deliverLocked(scope,id,revision) }
    private suspend fun deliverLocked(scope: String, id: String, revision: Long, scheduleNext: Boolean = true) {
        if (scope != app.workspaceScope) return
        val dao = app.database.dao()
        val row = dao.reminder(scope, id) ?: return
        if (row.revision != revision || row.state != "pending" || row.at > System.currentTimeMillis() + 1000) return
        val task = dao.task(scope, row.taskId) ?: return
        if (task.done || task.deleted || task.revision != revision) return
        val permitted = notificationsAllowed() && channelAllowed()
        // Keep the row pending while Android blocks notifications. Recovery can deliver it after
        // the user restores permission instead of permanently losing a transiently blocked alarm.
        if (!permitted) { if (scheduleNext) scheduleUpcomingLocked(scope); return }
        if (dao.claimReminder(scope, id, revision, "delivered", System.currentTimeMillis()) != 1) return
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java).apply {
            data = Uri.Builder().scheme("genesis").authority("task").appendPath(scope).appendPath(row.taskId).build()
            putExtra("scope", scope); putExtra("taskId", row.taskId)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        fun action(name: String) = PendingIntent.getBroadcast(context, 0,
            intent(row, name, ReminderActionReceiver::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val taskCopy = taskNotificationCopy(LocalPreferences(context, scope).values.first().language)
        val note = NotificationCompat.Builder(context, TASK_CHANNEL)
            .setGroup("genesis.tasks").setSubText(notifications.getNotificationChannel(TASK_CHANNEL)?.name)
            .setColor(Color.rgb(37, 91, 89)).setSmallIcon(R.drawable.ic_notification_task).setContentTitle("GENESIS")
            .setContentText(taskCopy[0]).distinctPresentation(TASK_CHANNEL, taskCopy[0]).setContentIntent(open)
            .setCategory(NotificationCompat.CATEGORY_REMINDER).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true).setOnlyAlertOnce(true)
            .addAction(0, taskCopy[1], action("complete"))
            .addAction(0, taskCopy[2], action("snooze"))
            .addAction(0, taskCopy[3], action("dismiss"))
            .build()
        try {
            notifications.notify(scope + "/" + id, 1, note)
            diagnosticStore.edit().putLong("lastDeliveryAt", System.currentTimeMillis()).apply()
        }
        catch (_: Exception) {
            // Notification permission/channel state can change between the check and notify().
            // Put the claimed row back so the periodic recovery path can try again.
            dao.releaseFailedReminder(scope, id, revision)
        }
        if (scheduleNext) scheduleUpcomingLocked(scope)
    }
}

internal fun habitNotificationOpenIntent(context: Context, scope: String,
    target: ru.genesis.calendar.domain.habits.HabitReminderTarget? = null, action: String = "open") =
    Intent(context, MainActivity::class.java).apply {
        data = Uri.Builder().scheme("genesis").authority("section").appendPath("habits").appendPath(scope).apply {
            target?.let { appendPath(it.operationKey); appendPath(action) }
        }.build()
        putExtra("scope", scope)
        putExtra("openSection", "habits")
        if (target != null) { putHabitReminderTarget(target); putExtra("habitAction", action) }
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
