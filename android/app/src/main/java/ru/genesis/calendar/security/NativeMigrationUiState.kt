package ru.genesis.calendar.security

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID

/** UI intent only. No secret, key, file URI, session or migration authority. */
internal object NativeMigrationUiState{
    data class View(val id:String,val owner:String,val language:String,val resume:Boolean)
    private val mutable=MutableStateFlow<View?>(null);val state=mutable.asStateFlow()
    @Synchronized fun show(owner:String,language:String,resume:Boolean){E2eeKeys.technical(owner);if(mutable.value?.owner==owner)return;mutable.value=View(UUID.randomUUID().toString(),owner,language,resume)}
    @Synchronized fun close(id:String){if(mutable.value?.id==id)mutable.value=null}
    @Synchronized fun clearOwner(owner:String){if(mutable.value?.owner==owner)mutable.value=null}
}
