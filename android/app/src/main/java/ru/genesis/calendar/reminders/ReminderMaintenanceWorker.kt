package ru.genesis.calendar.reminders

import android.content.Context
import androidx.work.*
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import ru.genesis.calendar.GenesisApplication

/** Rebuilds system alarms from the durable encrypted workspace without a screen or network. */
class ReminderMaintenanceWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val app = applicationContext as GenesisApplication
        return try {
            app.scheduler.restore(recoverOverdue = true)
            app.scheduler.restoreHabitNotifications()
            MoonReminderScheduler.restore(app)
            AdviceReminderScheduler.restore(app)
            Result.success()
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { Result.retry() }
    }
    companion object {
        private const val PERIODIC_WORK = "genesis-reminder-maintenance-v2"
        private const val IMMEDIATE_WORK = "genesis-reminder-recovery-now-v2"

        fun enqueue(context: Context) {
            val manager = WorkManager.getInstance(context)
            manager.cancelUniqueWork("genesis-reminder-maintenance-v1")
            manager.enqueueUniquePeriodicWork(PERIODIC_WORK,
                ExistingPeriodicWorkPolicy.UPDATE,
                PeriodicWorkRequestBuilder<ReminderMaintenanceWorker>(1, TimeUnit.HOURS)
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES)
                    .build())
        }

        fun enqueueImmediate(context: Context) {
            WorkManager.getInstance(context).enqueueUniqueWork(IMMEDIATE_WORK,
                ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<ReminderMaintenanceWorker>()
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
                    .build())
        }
    }
}

/** A second, persistent delivery path for OEMs that occasionally defer AlarmManager callbacks. */
class ReminderRecoveryWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val app = applicationContext as GenesisApplication
        return try {
            when (inputData.getString(KIND)) {
                HABITS -> app.scheduler.restoreHabitNotifications()
                TASKS -> app.scheduler.restore(recoverOverdue = true)
                else -> {
                    app.scheduler.restore(recoverOverdue = true)
                    app.scheduler.restoreHabitNotifications()
                    MoonReminderScheduler.restore(app)
                    AdviceReminderScheduler.restore(app)
                }
            }
            Result.success()
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { Result.retry() }
    }

    companion object {
        private const val KIND = "kind"
        private const val HABITS = "habits"
        private const val TASKS = "tasks"
        internal const val HABIT_WORK = "genesis-habit-delivery-backup-v2"
        internal const val TASK_WORK = "genesis-task-delivery-backup-v2"
        private const val FALLBACK_DELAY_MILLIS = 2 * 60 * 1000L

        fun scheduleHabits(context: Context, atMillis: Long?) = schedule(context, HABIT_WORK, HABITS, atMillis)
        fun scheduleTasks(context: Context, atMillis: Long?) = schedule(context, TASK_WORK, TASKS, atMillis)

        private fun schedule(context: Context, name: String, kind: String, atMillis: Long?) {
            val manager = WorkManager.getInstance(context)
            if (atMillis == null) {
                manager.cancelUniqueWork(name)
                return
            }
            val delay = (atMillis + FALLBACK_DELAY_MILLIS - System.currentTimeMillis()).coerceAtLeast(0)
            val request = OneTimeWorkRequestBuilder<ReminderRecoveryWorker>()
                .setInputData(workDataOf(KIND to kind))
                .setInitialDelay(delay, TimeUnit.MILLISECONDS)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
                .build()
            manager.enqueueUniqueWork(name, ExistingWorkPolicy.REPLACE, request)
        }
    }
}
