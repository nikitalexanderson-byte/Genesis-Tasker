package ru.genesis.calendar.security

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.util.UUID

/** UI references only. No key, device approval, consent or network authority. */
internal object NativeMembershipUiState {
    data class View(val id:String,val owner:String,val language:String,val mode:String,val intentId:String?=null,val fingerprint:String?=null)
    private val mutable=MutableStateFlow<View?>(null);val state=mutable.asStateFlow();private val waiting=mutableMapOf<String,CompletableDeferred<JSONObject>>()
    @Synchronized fun showOperation(owner:String,language:String,intent:String){E2eeKeys.technical(owner);E2eeKeys.technical(intent);check(mutable.value==null){"E2EE_MEMBERSHIP_UI_BUSY"};mutable.value=View(UUID.randomUUID().toString(),owner,language,"operation",intent)}
    @Synchronized fun showOwner(owner:String,language:String,fingerprint:String){E2eeKeys.technical(owner);E2eeEnvelope.decode(fingerprint,32);check(mutable.value==null){"E2EE_MEMBERSHIP_UI_BUSY"};mutable.value=View(UUID.randomUUID().toString(),owner,language,"owner",fingerprint=fingerprint)}
    suspend fun waitForOperation(owner:String,language:String,intent:String):JSONObject {
        val pending=CompletableDeferred<JSONObject>();synchronized(this){check(mutable.value==null&&intent !in waiting){"E2EE_MEMBERSHIP_UI_BUSY"};showOperation(owner,language,intent);waiting[intent]=pending}
        try{return pending.await()}finally{synchronized(this){waiting.entries.filter{it.value===pending}.map{it.key}.forEach{waiting.remove(it)}}}
    }
    @Synchronized fun close(id:String,reason:String="E2EE_MEMBERSHIP_OPERATION_PAUSED"){
        val view=mutable.value?:return;if(view.id!=id)return;view.intentId?.let{waiting.remove(it)?.completeExceptionally(IllegalStateException(reason))};mutable.value=null
    }
    @Synchronized fun clearOwner(owner:String){mutable.value?.takeIf{it.owner==owner}?.let{close(it.id,"E2EE_ACCOUNT_CHANGED")}}
    @Synchronized fun complete(id:String,result:JSONObject){val view=mutable.value?:error("E2EE_ACCOUNT_CHANGED");check(view.id==id&&view.intentId!=null){"E2EE_ACCOUNT_CHANGED"};waiting.remove(requireNotNull(view.intentId))?.complete(JSONObject(result.toString()));mutable.value=null}
    @Synchronized fun replace(id:String,intent:String){val view=mutable.value?:error("E2EE_ACCOUNT_CHANGED");check(view.id==id&&view.intentId!=null){"E2EE_ACCOUNT_CHANGED"};E2eeKeys.technical(intent);check(intent !in waiting){"E2EE_MEMBERSHIP_UI_BUSY"};waiting.remove(requireNotNull(view.intentId))?.let{waiting[intent]=it};mutable.value=view.copy(id=UUID.randomUUID().toString(),intentId=intent)}
}
