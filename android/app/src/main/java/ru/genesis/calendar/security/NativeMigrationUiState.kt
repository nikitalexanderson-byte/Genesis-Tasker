package ru.genesis.calendar.security

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID

/** UI intent only. No secret, key, file URI, session or migration authority. */
internal object NativeMigrationUiState{
    data class View(val id:String,val owner:String,val language:String,val resume:Boolean,val target:E2eeProductMigration.Target?=null)
    private val mutable=MutableStateFlow<View?>(null);val state=mutable.asStateFlow()
    @Synchronized fun show(owner:String,language:String,resume:Boolean,target:E2eeProductMigration.Target?=null){
        E2eeKeys.technical(owner);target?.let{listOf(it.scopeId,it.resourceId).forEach{value->E2eeKeys.technical(value)};check(it.ownerId==owner&&it.kind in setOf("space","project")){"E2EE_SCOPE_BINDING_MISMATCH"}}
        if(mutable.value?.owner==owner)return;mutable.value=View(UUID.randomUUID().toString(),owner,language,resume,target)
    }
    @Synchronized fun close(id:String){if(mutable.value?.id==id)mutable.value=null}
    @Synchronized fun clearOwner(owner:String){if(mutable.value?.owner==owner)mutable.value=null}
}
