package ru.genesis.calendar.reminders

import android.content.Context
import kotlinx.coroutines.CancellationException
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.AuthApiError
import ru.genesis.calendar.data.NativeLegacyOperationPermit
import ru.genesis.calendar.security.UpdateGate

/** Take the owner permit BEFORE scheduler/Room/DataStore locks, and retain it
 * through alarm/notification effects and their receipts. Offline account data
 * does not require a live identity session; a changed local scope still fails.
 * Guest reminders remain independent of personal-account E2EE migration. */
internal suspend fun <T> legacyReminderOperation(context:Context,scope:String,operation:suspend (()->Unit)->T):T {
    val app=context.applicationContext as GenesisApplication
    val epoch=app.workspaceEpoch
    fun current(){
        UpdateGate.requireOpen()
        if(app.workspaceScope!=scope||app.workspaceEpoch!=epoch)throw CancellationException("E2EE_ACCOUNT_CHANGED")
    }
    // These are expected invalidations of a background restore/receiver, not
    // unhandled application failures. Preserve the refusal and every original;
    // cancellation stops this coroutine without crashing its SupervisorJob.
    try {
        current()
        return if(scope.startsWith("account-"))NativeLegacyOperationPermit.run(app.database,scope,::current){operation(::current).also{current()}}
            else operation(::current).also{current()}
    } catch(error:AuthApiError) {
        if(error.code!="E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN" && error.code!="E2EE_INVALID_LEGACY_OPERATION")throw error
        throw CancellationException(error.code).apply { initCause(error) }
    }
}
