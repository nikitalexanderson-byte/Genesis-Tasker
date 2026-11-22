package ru.genesis.calendar.security

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred
import org.json.JSONObject

/** UI intent only. No secret, key, file URI, session or migration authority. */
internal object NativeMigrationUiState{
    data class View(val id:String,val owner:String,val language:String,val resume:Boolean,val target:E2eeProductMigration.Target?=null,val creationId:String?=null)
    private val mutable=MutableStateFlow<View?>(null);val state=mutable.asStateFlow()
    private val creations=mutableMapOf<String,CompletableDeferred<JSONObject>>()
    @Synchronized fun show(owner:String,language:String,resume:Boolean,target:E2eeProductMigration.Target?=null,creationId:String?=null){
        E2eeKeys.technical(owner);target?.let{listOf(it.scopeId,it.resourceId).forEach{value->E2eeKeys.technical(value)};check(it.ownerId==owner&&it.kind in setOf("space","project")){"E2EE_SCOPE_BINDING_MISMATCH"}}
        creationId?.let{E2eeKeys.technical(it);check(target?.kind=="space"){"E2EE_SCOPE_BINDING_MISMATCH"}}
        if(mutable.value?.owner==owner)return;mutable.value=View(UUID.randomUUID().toString(),owner,language,resume,target,creationId)
    }
    @Synchronized fun close(id:String){if(mutable.value?.id==id){mutable.value?.creationId?.let{creations.remove(it)?.completeExceptionally(IllegalStateException("E2EE_RESOURCE_CREATION_PAUSED"))};mutable.value=null}}
    @Synchronized fun clearOwner(owner:String){if(mutable.value?.owner==owner)mutable.value?.let{close(it.id)}}
    suspend fun waitForCreation(owner:String,language:String,target:E2eeProductMigration.Target,id:String):JSONObject{
        val pending=CompletableDeferred<JSONObject>()
        synchronized(this){check(mutable.value==null&&id !in creations){"E2EE_MIGRATION_BUSY"};show(owner,language,true,target,id);creations[id]=pending}
        try{return pending.await()}finally{synchronized(this){if(creations[id]===pending)creations.remove(id)}}
    }
    @Synchronized fun completeCreation(viewId:String,result:JSONObject){
        val view=requireNotNull(mutable.value){"E2EE_RESOURCE_CREATION_CHANGED"};check(view.id==viewId&&view.creationId!=null){"E2EE_RESOURCE_CREATION_CHANGED"}
        creations.remove(requireNotNull(view.creationId))?.complete(JSONObject(result.toString()));mutable.value=null
    }
}
