package ru.genesis.calendar.data

import org.json.JSONObject
import ru.genesis.calendar.auth.FeatureAccess
import ru.genesis.calendar.security.E2eeProductAccount

/** Synchronous personal storage and suspending shared storage expose the same
 * editor operations; the repository always calls them on its IO dispatcher. */
internal interface NativeMapProduct{
    val account:E2eeProductAccount
    suspend fun load(refresh:Boolean=false)
    fun snapshot():List<NativeMapRecord>
    suspend fun requireNoConflict()
    suspend fun flush()
    suspend fun save(input:MindmapDocument,expected:Long,access:FeatureAccess)
    suspend fun history(id:String):List<NativeMapRecord>
    suspend fun serverVersion(id:String):NativeMapRecord
    suspend fun adoptServer(id:String,access:FeatureAccess)
    suspend fun fork(input:MindmapDocument,access:FeatureAccess):MindmapDocument
    suspend fun saveLocal(name: String, value: JSONObject?, replacingTaskId: String? = null)
    suspend fun readLocal(name:String):JSONObject?
    suspend fun readView(id:String):JSONObject?
}
internal class NativePersonalMapProduct(scope:String,owner:String,override val account:E2eeProductAccount):NativeMapProduct{
    private val delegate=NativePrivateMindmaps(scope,owner,account)
    override suspend fun load(refresh:Boolean)=delegate.load(refresh)
    override fun snapshot()=delegate.snapshot()
    override suspend fun requireNoConflict(){delegate.requireNoConflict()}
    override suspend fun flush()=delegate.flush()
    override suspend fun save(input:MindmapDocument,expected:Long,access:FeatureAccess)=delegate.save(input,expected,access)
    override suspend fun history(id:String)=delegate.history(id)
    override suspend fun serverVersion(id:String)=delegate.serverVersion(id)
    override suspend fun adoptServer(id:String,access:FeatureAccess){delegate.adoptServer(id,access)}
    override suspend fun fork(input:MindmapDocument,access:FeatureAccess)=delegate.fork(input,access)
    override suspend fun saveLocal(name: String, value: JSONObject?, replacingTaskId: String?) {
        delegate.saveLocal(name, value, replacingTaskId)
    }
    override suspend fun readLocal(name:String)=delegate.readLocal(name)
    override suspend fun readView(id:String)=delegate.readView(id)
}
