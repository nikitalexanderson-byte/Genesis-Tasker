package ru.genesis.calendar.data

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.flow
import org.json.JSONObject
import ru.genesis.calendar.auth.WorkspacePatch
import ru.genesis.calendar.security.NativePrivateProducts

/** Reuses the real native domain codecs and mutations over a new-root durable
 * product transaction. Neither readers nor writers open the retired Room copy. */
internal object PrivatePersonalDocuments{
    fun isProtected(scope:String)=NativePrivateProducts.isProtected(scope)
    /** A migrated workspace may never have contained a habits/tracker family.
     * Supply its existing domain defaults only in this read projection. Present
     * values, including malformed values, remain exact; no source is rewritten. */
    internal fun projection(snapshot:JSONObject):JSONObject {
        val result=WorkspacePatch.emptyDocument()
        val owned=JSONObject(snapshot.toString())
        for(name in owned.keys())result.put(name,owned.get(name))
        return result
    }
    internal fun fragment(snapshot:JSONObject,kind:String):String {
        val view=projection(snapshot)
        return when(kind){
            "structure"->CloudAccountImporter.structureDocument(view)
            "habits"->CloudAccountImporter.habitsDocument(view)
            "trackers"->CloudAccountImporter.trackersDocument(view)
            else->error("E2EE_PRIVATE_DOCUMENT_FORBIDDEN")
        }
    }
    private fun <T> privateView(scope:String,read:()->T):Flow<T> = flow {
        val held=try{NativePrivateProducts.currentAccount(scope)}catch(error:IllegalStateException){
            if(!NativePrivateProducts.isOpen(scope))return@flow
            throw error
        }
        fun current()=try{NativePrivateProducts.currentAccount(scope)===held&&NativePrivateProducts.isOpen(scope)}catch(_:IllegalStateException){false}
        val value=try{held.requireOpen();read()}catch(error:IllegalStateException){
            if(!current())return@flow
            throw error
        }
        // Closing/replacing an account while decoding retires this collector;
        // it never subscribes to the old Room document as a fallback.
        if(current())emit(value)
    }
    @OptIn(ExperimentalCoroutinesApi::class)
    fun <T> observe(scope:String,kind:String,legacy:Flow<T>,decode:(String,Long)->T):Flow<T> =
        NativePrivateProducts.revision.flatMapLatest{if(isProtected(scope))privateView(scope){decode(fragment(NativePrivateProducts.snapshot(scope),kind),NativePrivateProducts.contentRevision(scope))}else legacy}
    @OptIn(ExperimentalCoroutinesApi::class)
    fun observePendingWrites(scope: String, legacy: Flow<Boolean>): Flow<Boolean> =
        NativePrivateProducts.revision.flatMapLatest {
            if (isProtected(scope)) privateView(scope) { NativePrivateProducts.hasPendingPersonalChanges(scope) } else legacy
        }

    @OptIn(ExperimentalCoroutinesApi::class)
    fun <T> observeSnapshot(scope:String,legacy:Flow<T>,decode:(JSONObject)->T):Flow<T> =
        NativePrivateProducts.revision.flatMapLatest{if(isProtected(scope))privateView(scope){decode(projection(NativePrivateProducts.snapshot(scope)))}else legacy}
    suspend fun <T> mutate(scope:String,kind:String,change:suspend(String,Long)->Pair<String,T>):T=NativePrivateProducts.mutate(scope){snapshot->
        val (raw,result)=change(fragment(snapshot,kind),NativePrivateProducts.contentRevision(scope));val next=JSONObject(raw)
        WorkspacePatch.localDocument(snapshot,if(kind=="structure")next else null,if(kind=="habits")next else null,if(kind=="trackers")next else null) to result
    }
}
