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
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.*
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.MainActivity
import ru.genesis.calendar.R
import ru.genesis.calendar.auth.*

data class AdviceNotificationOpenRequest(val scope: String, val id: String, val day: String,
    val collection: String, val nonce: Long = System.nanoTime())

/** Explicit notification intents use the same stable link as web, guarded by the local account scope. */
internal fun adviceNotificationRequest(intent: Intent, scope: String): AdviceNotificationOpenRequest? = runCatching {
    val link = intent.data ?: return@runCatching null
    if (intent.action != Intent.ACTION_VIEW || intent.getStringExtra("scope") != scope ||
        !Regex("account-[a-f0-9]{32}").matches(scope) || link.scheme != "https" || link.host != AUTH_HOST ||
        link.port !in setOf(-1, 443) || link.userInfo != null || link.path !in setOf("", "/") || link.fragment != "today" ||
        link.queryParameterNames != setOf("advice", "adviceDay", "adviceCollection") ||
        link.queryParameterNames.any { link.getQueryParameters(it).size != 1 }) return@runCatching null
    val id = link.getQueryParameter("advice") ?: return@runCatching null
    val day = link.getQueryParameter("adviceDay") ?: return@runCatching null
    val collection = link.getQueryParameter("adviceCollection") ?: return@runCatching null
    DailyAdviceProtocol.savedPath(id, day, collection)
    AdviceNotificationOpenRequest(scope, id, day, collection)
}.getOrNull()

/** One daily account-time-zone alarm with a persistent WorkManager backup; no network in receivers. */
internal object AdviceReminderScheduler {
    internal const val CHANNEL = "genesis.advice.v1"
    private const val ACTION = "ru.genesis.calendar.ADVICE_REMINDER"
    private const val WORK_TAG = "genesis-advice-v1"
    private const val FALLBACK_WORK = "genesis-advice-fallback-v1"
    private const val NOTE_ID = 7421
    private val scheduleMutex = Mutex()
    private val deliveryMutex = Mutex()
    private fun registry(context: Context) = context.getSharedPreferences("genesis.advice.alarms.v1", Context.MODE_PRIVATE)
    fun cancelDay(context: Context, scope: String, day: String) {
        NotificationManagerCompat.from(context).cancel("advice:$scope:$day", NOTE_ID)
    }
    private fun alarmUri(scope: String, day: String, settings: AdviceNotificationPreferences): Uri = Uri.Builder()
        .scheme("genesis").authority("advice-reminder").appendPath(scope).appendPath(day)
        .appendPath(settings.time).appendPath(settings.timeZone).build()
    private fun pending(context: Context, raw: Uri, create: Boolean): PendingIntent? = PendingIntent.getBroadcast(context, 0,
        Intent(context, AdviceReminderReceiver::class.java).apply { action = ACTION; data = raw },
        (if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE) or PendingIntent.FLAG_IMMUTABLE)

    internal fun plannedAt(day: LocalDate, settings: AdviceNotificationPreferences): Instant =
        day.atTime(LocalTime.parse(settings.time)).atZone(ZoneId.of(settings.timeZone)).toInstant()
    internal fun withinWindow(day: LocalDate, settings: AdviceNotificationPreferences, now: Instant): Boolean {
        val zone = ZoneId.of(settings.timeZone)
        val at = plannedAt(day, settings)
        val expiry = minOf(at.plusSeconds(2 * 60 * 60), day.plusDays(1).atStartOfDay(zone).toInstant())
        return now.atZone(zone).toLocalDate() == day && now >= at && now < expiry
    }

    internal fun createChannel(context: Context, language: String) {
        val copy = notificationCopy(context, language)
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, copy.getString("enable"), NotificationManager.IMPORTANCE_DEFAULT)
                .apply { lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE })
    }
    internal fun allowed(context: Context): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled() &&
        (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
        context.getSystemService(NotificationManager::class.java).getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE

    /** Called synchronously when the account or advice settings change, before async cache writes. */
    fun cancel(context: Context) {
        val storage = registry(context)
        storage.getString("scheduled", null)?.let { raw ->
            pending(context, Uri.parse(raw), false)?.let { operation ->
                context.getSystemService(AlarmManager::class.java).cancel(operation); operation.cancel()
            }
        }
        storage.edit().clear().commit()
        WorkManager.getInstance(context).cancelAllWorkByTag(WORK_TAG)
        context.getSystemService(NotificationManager::class.java).activeNotifications
            .filter { it.notification.channelId == CHANNEL }.forEach { note ->
                NotificationManagerCompat.from(context).cancel(note.tag, note.id)
            }
    }

    suspend fun restore(context: Context) = withContext(Dispatchers.IO) { scheduleMutex.withLock {
        val app = context.applicationContext as GenesisApplication
        val scope = app.workspaceScope
        if (!scope.startsWith("account-")) { cancel(context); return@withLock }
        val account = AuthController.get(context).cachedAdviceNotificationAccount(scope)
        if (app.workspaceScope != scope) return@withLock
        val preferences = account?.settings?.advicePreferences
        if (account == null || preferences == null || !preferences.enabled || !preferences.notifications.enabled ||
            preferences.collections.none { it in account.settings.adviceCollectionsReady }) {
            cancel(context); return@withLock
        }
        createChannel(context, account.settings.language)
        if (!allowed(context) || app.workspaceScope != scope) { cancel(context); return@withLock }
        val settings = preferences.notifications
        val now = Instant.now()
        val today = now.atZone(ZoneId.of(settings.timeZone)).toLocalDate()
        val store = AdviceSnapshotStore(app)
        val day = if (now < plannedAt(today, settings) || withinWindow(today, settings, now) && !store.delivered(scope, today.toString()))
            today else today.plusDays(1)
        val at = plannedAt(day, settings)
        val raw = alarmUri(scope, day.toString(), settings)
        val storage = registry(context)
        val old = storage.getString("scheduled", null)
        if (old != raw.toString()) {
            old?.let { pending(context, Uri.parse(it), false)?.let { alarm ->
                context.getSystemService(AlarmManager::class.java).cancel(alarm); alarm.cancel()
            } }
            WorkManager.getInstance(context).enqueueUniqueWork(FALLBACK_WORK, ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<AdviceReminderBackupWorker>()
                    .setInputData(workDataOf("alarm" to raw.toString())).addTag(WORK_TAG)
                    .setInitialDelay((at.toEpochMilli() + 120_000 - System.currentTimeMillis()).coerceAtLeast(0), TimeUnit.MILLISECONDS)
                    .build())
            storage.edit().putString("scheduled", raw.toString()).commit()
        }
        if (app.workspaceScope != scope) return@withLock
        // Do not re-arm an already fired alarm at now+1s on each worker completion.
        // The unique delivery work owns retries; maintenance may recover a lost callback.
        if (at > now || old != raw.toString()) {
            val operation = pending(context, raw, true) ?: return@withLock
            val alarms = context.getSystemService(AlarmManager::class.java)
            val atMillis = maxOf(at.toEpochMilli(), System.currentTimeMillis() + 1_000)
            try {
                if (app.scheduler.exactAllowed()) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, operation)
                else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, operation)
            } catch (_: SecurityException) { alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, operation) }
        }
        if (withinWindow(day, settings, now)) enqueueDelivery(context, raw)
    } }

    fun enqueueDelivery(context: Context, raw: Uri) {
        val parts = raw.pathSegments
        if (raw.scheme != "genesis" || raw.authority != "advice-reminder" || parts.size != 4 ||
            !Regex("account-[a-f0-9]{32}").matches(parts[0])) return
        if (runCatching { LocalDate.parse(parts[1]); AdviceNotificationPreferences(true, parts[2], parts[3]) }.isFailure) return
        val app = context.applicationContext as GenesisApplication
        if (parts[0] != app.workspaceScope) return
        WorkManager.getInstance(context).enqueueUniqueWork("genesis-advice-delivery-${parts[0]}-${parts[1]}", ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<AdviceReminderWorker>().setInputData(workDataOf("alarm" to raw.toString()))
                .addTag(WORK_TAG).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES).build())
    }

    /** True asks WorkManager to retry, only inside today's two-hour delivery window. */
    suspend fun deliver(context: Context, raw: Uri): Boolean = deliveryMutex.withLock {
        val app = context.applicationContext as GenesisApplication
        val parts = raw.pathSegments
        if (raw.scheme != "genesis" || raw.authority != "advice-reminder" || parts.size != 4 || parts[0] != app.workspaceScope) return@withLock false
        if (BuildConfig.DEBUG && app.getSharedPreferences("genesis.validation.v1", Context.MODE_PRIVATE).getBoolean("isolated", false)) return@withLock false
        val scope = parts[0]
        val day = LocalDate.parse(parts[1])
        val scheduled = AdviceNotificationPreferences(true, parts[2], parts[3])
        val controller = AuthController.get(app)
        val store = AdviceSnapshotStore(app)
        var account = controller.cachedAdviceNotificationAccount(scope) ?: return@withLock false
        createChannel(context, account.settings.language)
        fun valid(settings: AccountSettings): Boolean = settings.advicePreferences.enabled &&
            settings.advicePreferences.notifications == scheduled && withinWindow(day, scheduled, Instant.now())
        if (!valid(account.settings) || store.delivered(scope, day.toString()) || !allowed(context)) return@withLock false
        var online = true
        try { account = controller.adviceNotificationAccount(scope) }
        catch (error: AuthFailure) {
            if (error.kind == AuthFailure.Kind.NETWORK) online = false
            else return@withLock error.kind in setOf(AuthFailure.Kind.CONFLICT, AuthFailure.Kind.RATE_LIMIT, AuthFailure.Kind.SERVER)
        }
        if (!valid(account.settings) || app.workspaceScope != scope || !allowed(context)) return@withLock false
        val selected = store.notificationTarget(scope, day.toString(), null)
        val response = try {
            when {
                selected != null && online -> {
                    val card = DailyAdviceProtocol.parse(selected).advice ?: return@withLock false
                    controller.notificationSavedAdvice(scope, card.id, card.day, card.collection)
                }
                selected != null -> selected
                online -> controller.notificationDailyAdvice(scope, scheduled.timeZone)
                else -> store.latest(scope, day.toString(), account.settings.language)
            }
        } catch (error: AuthFailure) {
            if (error.kind == AuthFailure.Kind.NETWORK) selected ?: store.latest(scope, day.toString(), account.settings.language)
            else return@withLock error.kind in setOf(AuthFailure.Kind.CONFLICT, AuthFailure.Kind.RATE_LIMIT, AuthFailure.Kind.SERVER)
        } ?: return@withLock true // Offline and no exact current-day snapshot: wait for connectivity, never invent content.
        val card = DailyAdviceProtocol.parse(response).advice
        if (card == null) {
            store.markDelivered(scope, day.toString())
            return@withLock false
        }
        if (card.day != day.toString() || card.language != account.settings.language ||
            !NativeAdviceAgeAccess.notificationSafe(card) || card.collection !in account.settings.adviceCollectionsReady || !DailyAdviceProtocol.visible(card, account.settings.advicePreferences)) return@withLock false
        val target = store.notificationTarget(scope, day.toString(), card) ?: return@withLock false
        val exact = DailyAdviceProtocol.parse(target).advice ?: return@withLock false
        val latest = controller.cachedAdviceNotificationAccount(scope)?.settings ?: return@withLock false
        if (app.workspaceScope != scope || !valid(latest) || latest.advicePreferences != account.settings.advicePreferences ||
            latest.language != exact.language || !DailyAdviceProtocol.visible(exact, latest.advicePreferences) || !allowed(context)) return@withLock false
        val link = Uri.parse(AUTH_ORIGIN).buildUpon().path("/").clearQuery()
            .appendQueryParameter("advice", exact.id).appendQueryParameter("adviceDay", exact.day)
            .appendQueryParameter("adviceCollection", exact.collection).fragment("today").build()
        val open = PendingIntent.getActivity(context, 7420, Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW; data = link; putExtra("scope", scope)
            addCategory("${context.packageName}.advice.$scope")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        // Android's Binder has a payload limit. The tap still opens the full exact saved text.
        val preview = exact.body.take(8_000)
        val note = NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(exact.title.ifBlank { notificationCopy(context, latest.language).getString("enable") }.take(300))
            .setContentText(preview).setStyle(NotificationCompat.BigTextStyle().bigText(preview))
            .setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setWhen(plannedAt(day, scheduled).toEpochMilli()).build()
        try {
            val posted = synchronized(app.adviceNotificationGuard) {
                if (!controller.adviceNotificationStillVisible(scope, exact, latest) || !allowed(context) ||
                    !withinWindow(day, scheduled, Instant.now())) false
                else { NotificationManagerCompat.from(context).notify("advice:$scope:$day", NOTE_ID, note); true }
            }
            if (!posted) return@withLock false
            store.markDelivered(scope, day.toString())
        } catch (_: SecurityException) { return@withLock false }
        false
    }

    internal fun notificationCopy(context: Context, language: String): JSONObject =
        context.assets.open("originals/i18n/advice-notification-copy.json").bufferedReader(Charsets.UTF_8).use {
            val all = JSONObject(it.readText()); all.optJSONObject(language) ?: all.getJSONObject("en")
        }
}

class AdviceReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == "ru.genesis.calendar.ADVICE_REMINDER") intent.data?.let { AdviceReminderScheduler.enqueueDelivery(context, it) }
    }
}

class AdviceReminderBackupWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        inputData.getString("alarm")?.let { AdviceReminderScheduler.enqueueDelivery(applicationContext, Uri.parse(it)) }
        return Result.success()
    }
}

class AdviceReminderWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        return try {
            val alarm = inputData.getString("alarm") ?: return Result.success()
            if (AdviceReminderScheduler.deliver(applicationContext, Uri.parse(alarm))) Result.retry() else Result.success()
        } catch (error: CancellationException) { throw error }
        catch (_: Exception) { Result.retry() }
        finally { withContext(NonCancellable) { runCatching { AdviceReminderScheduler.restore(applicationContext) } } }
    }
}
