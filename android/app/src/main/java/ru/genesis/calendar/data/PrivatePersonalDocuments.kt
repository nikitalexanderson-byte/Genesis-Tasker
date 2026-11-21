package ru.genesis.calendar.data

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import org.json.JSONObject
import ru.genesis.calendar.auth.WorkspacePatch
import ru.genesis.calendar.security.NativePrivateProducts

/** Reuses the real native domain codecs and mutations over a new-root durable
 * product transaction. Neither readers nor writers open the retired Room copy. */
internal object PrivatePersonalDocuments{
    fun isProtected(scope:String)=NativePrivateProducts.isProtected(scope)
    private fun fragment(snapshot:JSONObject,kind:String):String=when(kind){
        "structure"->CloudAccountImporter.structureDocument(snapshot)
        "habits"->CloudAccountImporter.habitsDocument(snapshot)
        "trackers"->CloudAccountImporter.trackersDocument(snapshot)
        else->error("E2EE_PRIVATE_DOCUMENT_FORBIDDEN")
    }
    @OptIn(ExperimentalCoroutinesApi::class)
    fun <T> observe(scope:String,kind:String,legacy:Flow<T>,decode:(String,Long)->T):Flow<T> =
        NativePrivateProducts.revision.flatMapLatest{if(isProtected(scope))flowOf(decode(fragment(NativePrivateProducts.snapshot(scope),kind),NativePrivateProducts.contentRevision(scope)))else legacy}
    @OptIn(ExperimentalCoroutinesApi::class)
    fun <T> observeSnapshot(scope:String,legacy:Flow<T>,decode:(JSONObject)->T):Flow<T> =
        NativePrivateProducts.revision.flatMapLatest{if(isProtected(scope))flowOf(decode(NativePrivateProducts.snapshot(scope)))else legacy}
    suspend fun <T> mutate(scope:String,kind:String,change:suspend(String,Long)->Pair<String,T>):T=NativePrivateProducts.mutate(scope){snapshot->
        val (raw,result)=change(fragment(snapshot,kind),NativePrivateProducts.contentRevision(scope));val next=JSONObject(raw)
        WorkspacePatch.localDocument(snapshot,if(kind=="structure")next else null,if(kind=="habits")next else null,if(kind=="trackers")next else null) to result
    }
}
