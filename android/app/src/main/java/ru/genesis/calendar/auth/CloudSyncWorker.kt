package ru.genesis.calendar.auth

import android.content.Context
import androidx.work.*
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import ru.genesis.calendar.BuildConfig

/** Network retry never blocks delivery from the local encrypted reminder schedule. */
class CloudSyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = try {
        if (BuildConfig.DEBUG && applicationContext.getSharedPreferences("genesis.validation.v1", Context.MODE_PRIVATE)
                .getBoolean("isolated", false)) Result.success()
        else {
            val controller=AuthController.get(applicationContext)
            if(controller.synchronizeInBackground()){
                ru.genesis.calendar.reminders.SupportTipsNotifications.deliver(applicationContext,controller)
                Result.success()
            }else Result.retry()
        }
    } catch (e: CancellationException) { throw e }
    catch (_: Exception) { Result.retry() }
    companion object {
        fun enqueue(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("genesis-cloud-sync-v1",
                ExistingPeriodicWorkPolicy.KEEP, PeriodicWorkRequestBuilder<CloudSyncWorker>(15, TimeUnit.MINUTES)
                    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
        }
    }
}
