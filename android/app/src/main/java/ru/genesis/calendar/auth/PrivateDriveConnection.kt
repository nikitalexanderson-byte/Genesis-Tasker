package ru.genesis.calendar.auth

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID

/** Memory-only OAuth handoff. Process death never recreates consent/admission. */
internal object PrivateDriveConnection{
    data class Attempt(val id:String,val owner:String,val phase:String)
    private val mutable=MutableStateFlow<Attempt?>(null);val state=mutable.asStateFlow()
    @Synchronized fun request(owner:String){
        check(mutable.value?.phase.let{it==null||it in setOf("complete","failed")}){"DRIVE_BUSY"}
        mutable.value=Attempt(UUID.randomUUID().toString(),owner,"requested")
    }
    @Synchronized fun transition(id:String,phase:String){
        val old=requireNotNull(mutable.value){"DRIVE_AUTH_STALE"};check(old.id==id&&old.phase !in setOf("complete","failed")){"DRIVE_AUTH_STALE"};mutable.value=old.copy(phase=phase)
    }
    @Synchronized fun failed(id:String){mutable.value?.takeIf{it.id==id&&it.phase!="complete"}?.let{mutable.value=it.copy(phase="failed")}}
}
