package ru.genesis.calendar.data

import ru.genesis.calendar.data.withTransaction
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.SharedMindmapProtocol
import ru.genesis.calendar.auth.SharedTaskLifecycleProtocol
import ru.genesis.calendar.security.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** Intent precedes task creation; receipt precedes the map mutation. Server mindmapSource deduplicates retries. */
internal class SharedMindmapConversionJournal(private val db: GenesisDatabase, private val scope: String,private val privateShared:PrivateSharedMapBinding?=null) {
    private val cipher = LocalCipher()
    private val kind = "shared-mindmap-conversions"
    private val aad = "$scope/$kind"
    private val mutex=Mutex()
    private val protected get()=privateShared?.let{NativePrivateProducts.isProtected(it.storageScope)}==true
    private suspend fun <T> operation(action:suspend()->T):T=if(protected)withContext(Dispatchers.IO){mutex.withLock{val binding=checkNotNull(privateShared);val account=NativePrivateProducts.account(binding.storageScope,binding.owner);account.requireOpen();action().also{account.requireOpen();check(NativePrivateProducts.account(binding.storageScope,binding.owner)===account){"E2EE_ACCOUNT_CHANGED"}}}}else db.withTransaction{action()}
    private fun privateStore():E2eeDeviceDocument?{
        if(!protected)return null;val binding=checkNotNull(privateShared);val account=NativePrivateProducts.account(binding.storageScope,binding.owner)
        return E2eeDeviceDocument(account.device,"shared-map-conversion-journal:${binding.spaceId}",{value->E2eeKeys.exact(value,setOf("protocol","ownerId","spaceId","entries","legacyHistory"));check(value.getInt("protocol")==1&&value.getString("ownerId")==binding.owner&&value.getString("spaceId")==binding.spaceId&&value.getJSONArray("entries").length()<=1000&&value.getJSONArray("legacyHistory").length()<=1000){"E2EE_SHARED_REQUEST_INVALID"};value},{account.requireOpen();check(NativePrivateProducts.account(binding.storageScope,binding.owner)===account){"E2EE_ACCOUNT_CHANGED"}})
    }
    suspend fun entries(): List<JSONObject> = operation { read() }
    private suspend fun read(): List<JSONObject> {
        privateStore()?.let{store->
            val row=store.load();if(row!=null)return (0 until row.value.getJSONArray("entries").length()).map{row.value.getJSONArray("entries").getJSONObject(it)}
            // Old uncertain operations are kept as inert history. They cannot
            // resume task creation merely because the new editor was opened.
            val binding=checkNotNull(privateShared);val original=readLegacy();if(original.isNotEmpty())store.save(JSONObject().put("protocol",1).put("ownerId",binding.owner).put("spaceId",binding.spaceId).put("entries",JSONArray()).put("legacyHistory",JSONArray(original)),null)
            return emptyList()
        }
        return readLegacy()
    }
    private suspend fun readLegacy():List<JSONObject>{
        val stored = db.dao().document(scope, kind) ?: return emptyList()
        val rows = JSONArray(cipher.decrypt(stored.encrypted, aad)); require(rows.length() <= 1000)
        return (0 until rows.length()).map { rows.getJSONObject(it).also { row ->
            SharedMindmapProtocol.mapId(row.getString("mapId")); SharedMindmapProtocol.mapId(row.getString("nodeId"))
            SharedTaskLifecycleProtocol.id(row.getString("projectId"))
        } }
    }
    private suspend fun write(rows: List<JSONObject>) {
        privateStore()?.let{store->val binding=checkNotNull(privateShared);val old=store.load();store.save(JSONObject().put("protocol",1).put("ownerId",binding.owner).put("spaceId",binding.spaceId).put("entries",JSONArray(rows)).put("legacyHistory",old?.value?.getJSONArray("legacyHistory")?:JSONArray()),old?.serial);return}
        if (rows.isEmpty()) db.dao().deleteDocument(scope, kind)
        else db.dao().putDocument(DocumentRecord(scope, kind, cipher.encrypt(JSONArray(rows).toString(), aad), System.currentTimeMillis()))
    }
    suspend fun intent(map: String, node: String, project: String, fields: JSONObject) = operation {
        SharedMindmapProtocol.mapId(map); SharedMindmapProtocol.mapId(node); SharedTaskLifecycleProtocol.id(project)
        val previous = read()
        val existing = previous.firstOrNull { it.getString("mapId") == map && it.getString("nodeId") == node }
        if (existing?.optString("taskId")?.isNotBlank() == true) return@operation
        val entry = JSONObject().put("mapId", map).put("nodeId", node).put("projectId", project).put("fields", JSONObject(fields.toString()))
        write(previous.filterNot { it.getString("mapId") == map && it.getString("nodeId") == node } + entry)
    }
    suspend fun acknowledge(map: String, node: String, task: JSONObject) = operation {
        require(!task.optBoolean("pending")); SharedTaskLifecycleProtocol.task(task)
        val rows = read()
        val current = rows.first { it.getString("mapId") == map && it.getString("nodeId") == node }
        require(task.getString("projectId") == current.getString("projectId")) { "MAP_REVISION_CONFLICT" }
        val next = JSONObject(current.toString()).put("taskId", task.getString("id"))
        write(rows.map { if (it.getString("mapId") == map && it.getString("nodeId") == node) next else it })
    }
    suspend fun clear(map: String, node: String) = operation {
        write(read().filterNot { it.getString("mapId") == map && it.getString("nodeId") == node })
    }
}
