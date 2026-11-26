package ru.genesis.calendar.auth

import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.NativeLegacyOperationPermit
import ru.genesis.calendar.security.UpdateGate

/** The owner operation precedes controller/scheduler locks and remains active
 * through cache/notification processing, including offline reads. Nested store
 * and HTTP calls borrow the same capability instead of waiting behind migration. */
internal suspend fun <T> legacyAdviceOperation(app:GenesisApplication,scope:String,requireCurrent:()->Unit={},operation:suspend ()->T):T {
    val epoch=app.workspaceEpoch
    fun current(){
        UpdateGate.requireOpen()
        if(app.workspaceScope!=scope||app.workspaceEpoch!=epoch)throw AuthApiError("E2EE_ACCOUNT_CHANGED")
        requireCurrent()
    }
    return NativeLegacyOperationPermit.run(app.database,scope,::current){current();operation().also{current()}}
}

/** Scheduler denial is not network failure and must never enable cache fallback. */
internal fun legacyAdviceDenied(error:AuthApiError)=error.code in setOf("E2EE_ACCOUNT_CHANGED","E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN","E2EE_INVALID_LEGACY_OPERATION")
