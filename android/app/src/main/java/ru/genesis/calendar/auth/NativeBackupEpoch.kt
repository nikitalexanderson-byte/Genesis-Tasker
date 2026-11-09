package ru.genesis.calendar.auth

import android.content.Context
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CancellationException

/** Retires every old transport after an explicit cache reconciliation. No authority comes from a file. */
internal object NativeBackupEpoch {
    private val epoch=AtomicLong()
    fun current(): Long=epoch.get()
    fun retireTransports() { epoch.incrementAndGet() }
}

/** Every writer captures its epoch before doing asynchronous work. */
internal class NativeBackupMutationGuard(private val scope: String) {
    private val epoch=NativeBackupEpoch.current()
    fun check() {
        if(scope.startsWith("account-")&&epoch!=NativeBackupEpoch.current())
            throw CancellationException("Backup reconciliation retired this local writer")
    }
}

internal class NativeBackupEpochStore(context: Context) {
    private val state=context.getSharedPreferences("genesis.native.backup.epoch.v1",Context.MODE_PRIVATE)
    private val scopes=context.getSharedPreferences("genesis.reminder.scope.v1",Context.MODE_PRIVATE)
    private fun active()=scopes.getString("workspace","").orEmpty()
    fun accepted(scope: String=active()): Long=state.getLong("accepted:$scope",0)
    fun pending(scope: String=active()): Long?=state.getLong("pending:$scope",-1).takeIf { it>=0 }
    fun observe(scope: String,generation: Long) {
        require(scope.matches(Regex("account-[a-f0-9]{32}"))&&generation>=0)
        if(generation!=accepted(scope))check(state.edit().putLong("pending:$scope",generation).commit())
    }
    fun acceptAfterProtectedReset(scope: String,generation: Long) {
        require(pending(scope)==generation)
        check(state.edit().putLong("accepted:$scope",generation).remove("pending:$scope").commit())
    }
}
