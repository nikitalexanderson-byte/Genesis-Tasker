package ru.genesis.calendar

import android.app.Application
import androidx.room.Room
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import ru.genesis.calendar.data.*
import ru.genesis.calendar.reminders.ReminderScheduler

class GenesisApplication : Application() {
    private val feedback = kotlinx.coroutines.flow.MutableSharedFlow<HabitFeedbackEvent>(
        extraBufferCapacity = 8, onBufferOverflow = kotlinx.coroutines.channels.BufferOverflow.DROP_OLDEST)
    val habitFeedback = feedback.asSharedFlow()
    fun offerHabitFeedback(event: HabitFeedbackEvent) {
        if (event.scope == workspaceScope) feedback.tryEmit(event)
    }
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val localScope = if (BuildConfig.DEBUG) "internal-validation-v1" else "local-drafts-v1"
    private val activeScope = MutableStateFlow(localScope)
    val scopeFlow = activeScope.asStateFlow()
    val workspaceScope get() = activeScope.value
    // Process-local owner transition only, never a crypto/data generation.
    private val scopeEpoch = java.util.concurrent.atomic.AtomicLong()
    internal val workspaceEpoch get() = scopeEpoch.get()
    internal val backupMigrationMemory=BackupMigrationInventory{maximum->nativeBackupFormSpool(this,maximum)}
    internal val adviceNotificationGuard = Any()
    @Volatile private var featureSnapshot: Pair<String,ru.genesis.calendar.auth.FeatureAccess>? = null
    fun rememberFeatureAccess(scope: String, value: ru.genesis.calendar.auth.FeatureAccess) { featureSnapshot = scope to value }
    internal suspend fun featureAccess(scope: String = workspaceScope): ru.genesis.calendar.auth.FeatureAccess =
        featureSnapshot?.takeIf { it.first == scope }?.second
            ?: ru.genesis.calendar.auth.CachedAccountEntry(this).read(scope)?.settings?.featureAccess
            ?: if (scope.startsWith("account-")) ru.genesis.calendar.auth.FeatureAccess.unverifiedAccount()
            else ru.genesis.calendar.auth.FeatureAccess()
    internal suspend fun requireQuotaGrowth(resource: String, before: Int, after: Int, scope: String = workspaceScope) {
        val limit = featureAccess(scope).limit(resource)
        require(after <= before || limit == null || after <= limit) { "Достигнут лимит тарифа. Существующие данные сохраняются. Изменить тариф можно в настройках аккаунта." }
    }
    fun activateAccount(uid: String?) {
        val next = uid?.let(ru.genesis.calendar.auth.CloudAccountSnapshot::scopeFor) ?: localScope
        synchronized(adviceNotificationGuard) {
            if (next != activeScope.value) ru.genesis.calendar.reminders.AdviceReminderScheduler.cancel(this)
            // This contains only the hashed workspace key, never credentials or tokens.
            check(getSharedPreferences("genesis.reminder.scope.v1", MODE_PRIVATE).edit()
                .putString("workspace", next).commit())
            // Invalidate readers before cleanup can wait for a currently
            // publishing form's inventory monitor. Its bounded checkpoints can
            // then retire the original actor and release that monitor.
            if (next != activeScope.value) { scopeEpoch.incrementAndGet();backupMigrationMemory.clear() }
            activeScope.value = next
            if (featureSnapshot?.first != next) featureSnapshot = null
        }
        appScope.launch { runCatching { ru.genesis.calendar.reminders.PrivateReminderProjection.restore(this@GenesisApplication) };if(!ru.genesis.calendar.security.NativePrivateProducts.isProtected(workspaceScope))runCatching { ru.genesis.calendar.reminders.AdviceReminderScheduler.restore(this@GenesisApplication) } }
    }
    val database by lazy {
        Room.databaseBuilder(this, GenesisDatabase::class.java, "genesis.db")
            .addMigrations(ru.genesis.calendar.data.LegacyScopeFenceSql.migration1To2)
            .addCallback(ru.genesis.calendar.data.LegacyScopeFenceSql.callback).build()
    }
    val scheduler by lazy { ReminderScheduler(this) }
    val repository get() = TaskRepository(database, LocalCipher(), workspaceScope, scheduler)
    override fun onCreate() {
        super.onCreate()
        ru.genesis.calendar.security.NativePrivateProducts.initialize(this)
        ru.genesis.calendar.security.UpdateGate.initialize(this)
        LocalCipher.initialize(this)
        ru.genesis.calendar.auth.NativeAdviceAgeAccess.load(this)
        val saved = getSharedPreferences("genesis.reminder.scope.v1", MODE_PRIVATE).getString("workspace", localScope)
        activeScope.value = saved?.takeIf { it == localScope || Regex("account-[a-f0-9]{32}").matches(it) } ?: localScope
        appScope.launch {
            combine(scopeFlow,ru.genesis.calendar.security.NativePrivateProducts.revision){scope,_->scope}.collectLatest { scope ->
                if(!ru.genesis.calendar.security.NativePrivateProducts.isProtected(scope)||!ru.genesis.calendar.security.NativePrivateProducts.isOpen(scope))return@collectLatest
                try {
                    val account=ru.genesis.calendar.security.NativePrivateProducts.currentAccount(scope)
                    val revision=ru.genesis.calendar.security.NativePrivateProducts.contentRevision(scope)
                    fun current(){account.requireOpen();check(workspaceScope==scope&&ru.genesis.calendar.security.NativePrivateProducts.contentRevision(scope)==revision){"E2EE_REMINDER_PROJECTION_STALE"}}
                    current();val snapshot=ru.genesis.calendar.security.NativePrivateProducts.snapshot(scope);current()
                    ru.genesis.calendar.reminders.PrivateReminderProjection.refresh(this@GenesisApplication,scope,snapshot,::current)
                    ru.genesis.calendar.security.NativePrivateProducts.reminderProjectionFailed.value=false
                } catch(error:CancellationException){throw error}
                catch(_:Exception){ru.genesis.calendar.security.NativePrivateProducts.reminderProjectionFailed.value=true}
            }
        }
        scheduler.createChannels()
        ru.genesis.calendar.reminders.ReminderMaintenanceWorker.enqueue(this)
        ru.genesis.calendar.auth.CloudSyncWorker.enqueue(this)
        appScope.launch {
            if (ru.genesis.calendar.security.UpdateGate.blocked.value) return@launch
            if (ru.genesis.calendar.security.NativePrivateProducts.isProtected(workspaceScope)) { runCatching { ru.genesis.calendar.reminders.PrivateReminderProjection.restore(this@GenesisApplication) };return@launch }
            scheduler.restore(recoverOverdue = true)
            scheduler.restoreHabitNotifications()
            ru.genesis.calendar.reminders.MoonReminderScheduler.restore(this@GenesisApplication)
            runCatching { ru.genesis.calendar.reminders.SleepReminderScheduler.restore(this@GenesisApplication) }
            runCatching { ru.genesis.calendar.reminders.AdviceReminderScheduler.restore(this@GenesisApplication) }
        }
    }
}
