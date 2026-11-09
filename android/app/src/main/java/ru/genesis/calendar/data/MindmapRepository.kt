package ru.genesis.calendar.data

import androidx.room.withTransaction
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import ru.genesis.calendar.security.WorkspaceCipher

internal interface MindmapTransport { suspend fun workspace():JSONObject; suspend fun request(path:String,body:JSONObject?=null):JSONObject; fun check() }
internal data class NativeMapRecord(val document:MindmapDocument,val revision:Long,val pending:JSONObject?=null,val pendingDocument:MindmapDocument?=null,val dirty:Boolean=false) {
    val unsynced get()=dirty || pending!=null || revision==0L
    fun json()=JSONObject().put("document",document.json()).put("revision",revision).put("pending",pending ?: JSONObject.NULL).put("pendingDocument",pendingDocument?.json() ?: JSONObject.NULL).put("dirty",dirty)
}
/** Uses the existing scoped encrypted Room documents; task rows remain in TaskRepository. */
internal class MindmapRepository(private val db:GenesisDatabase,private val scope:String,private val uid:String,private val transport:MindmapTransport,
    private val featureAccess: () -> ru.genesis.calendar.auth.FeatureAccess = { ru.genesis.calendar.auth.FeatureAccess() },
    private val dataExchangeAccess: () -> ru.genesis.calendar.auth.FeatureAccess = featureAccess) {
    private val mutex=Mutex();private val cipher=LocalCipher();private val mutable=MutableStateFlow<List<NativeMapRecord>>(emptyList());val records=mutable.asStateFlow()
    private val mutation=ru.genesis.calendar.auth.NativeBackupMutationGuard(scope)
    private fun check() { mutation.check();transport.check() }
    fun requireDataExchange() { check(); dataExchangeAccess().requireDataExchange() }
    fun exportJson(document: MindmapDocument): String {
        requireDataExchange()
        return JSONObject().put("format", "genesis-mindmap").put("version", 1).put("document", document.json()).toString(2)
    }
    suspend fun importJson(text: String): MindmapDocument {
        requireDataExchange()
        val file = JSONObject(text)
        require(file.getString("format") == "genesis-mindmap" && file.getInt("version") == 1)
        val copy = MindmapDocument.parse(file.getJSONObject("document")).copy(id = UUID.randomUUID().toString())
        requireDataExchange(); save(copy)
        return copy
    }
    private suspend fun persist(rows:List<NativeMapRecord>) { db.withTransaction { check();db.dao().putDocument(DocumentRecord(scope,"mindmaps",cipher.encrypt(JSONArray(rows.map { it.json() }).toString(),"$scope/mindmaps"),System.currentTimeMillis()));check() };check();mutable.value=rows }
    suspend fun loadCached()=mutex.withLock { check();val stored=db.dao().document(scope,"mindmaps") ?: return@withLock
        val raw=JSONArray(cipher.decrypt(stored.encrypted,"$scope/mindmaps"));val cached=(0 until raw.length()).map { val row=raw.getJSONObject(it);NativeMapRecord(MindmapDocument.parse(row.getJSONObject("document")),row.getLong("revision"),row.optJSONObject("pending"),row.optJSONObject("pendingDocument")?.let(MindmapDocument::parse),row.optBoolean("dirty")) };check();mutable.value=cached }
    private suspend fun key():ByteArray { check();val w=transport.workspace().getJSONObject("workspace");check();require(w.getString("keyMode")=="account") { "Разблокируйте пространство с кодом восстановления на сайте. Карты не изменены." };return WorkspaceCipher.decodeKey(w.getString("key")) }
    private fun aad(id:String)="genesis-mindmap-v1:$uid:map:$id".toByteArray()
    private fun open(row:JSONObject,key:ByteArray):NativeMapRecord { require(row.getInt("schemaVersion") in 1..2);val id=row.getString("id")
        val bytes=WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(row.getString("ciphertext"),row.getString("iv")),key,aad(id))
        return try { NativeMapRecord(MindmapDocument.parse(JSONObject(bytes.toString(Charsets.UTF_8))),row.getLong("revision")).also { require(it.document.id==id) } } finally { bytes.fill(0) } }
    suspend fun refresh()=mutex.withLock { val key=key();try { val raw=transport.request("/mindmaps").getJSONArray("maps");check()
        val remote=(0 until raw.length()).map { open(raw.getJSONObject(it),key) };val drafts=mutable.value.filter { it.unsynced }
        persist(remote.filterNot { r->drafts.any { it.document.id==r.document.id } }+drafts) } finally { key.fill(0) } }
    suspend fun save(document:MindmapDocument)=mutex.withLock { val clean=MindmapDocument.parse(document.json());check();val old=mutable.value.firstOrNull { it.document.id==clean.id }
        require(old!=null || featureAccess().canCreate("mindmaps",mutable.value.size)) { "Достигнут лимит тарифа. Существующие данные сохраняются. Изменить тариф можно в настройках аккаунта." }
        // Persist the newer text before attempting recovery of an earlier uncertain request.
        val draft=NativeMapRecord(clean,old?.revision ?: 0,old?.pending,old?.pendingDocument,dirty=true);replace(draft)
        send(draft)
    }
    suspend fun retry(id:String)=mutex.withLock { send(mutable.value.first { it.document.id==id }) }
    private suspend fun replace(row:NativeMapRecord)=persist(mutable.value.filterNot { it.document.id==row.document.id }+row)
    private suspend fun send(initial:NativeMapRecord) {
        var row=initial;val key=key()
        try {
            if(row.pending!=null) { val result=transport.request("/mindmaps/${row.document.id}",row.pending);check();val revision=result.getLong("revision")
                val alreadySaved=row.pendingDocument?.json()?.toString()==row.document.json().toString();row=NativeMapRecord(row.document,revision,dirty=!alreadySaved);replace(row);if(alreadySaved)return }
            val sealed=WorkspaceCipher.encrypt(row.document.json().toString().toByteArray(),key,aad(row.document.id))
            val pending=JSONObject().put("schemaVersion",2).put("expectedRevision",row.revision).put("operationId",UUID.randomUUID().toString()).put("iv",sealed.iv).put("ciphertext",sealed.ciphertext)
            row=row.copy(pending=pending,pendingDocument=row.document);replace(row)
            val result=transport.request("/mindmaps/${row.document.id}",pending);check();replace(NativeMapRecord(row.document,result.getLong("revision")))
        } finally { key.fill(0) }
    }
    suspend fun history(id:String):List<NativeMapRecord> { val key=key();return try { val rows=transport.request("/mindmaps/$id/history").getJSONArray("versions");check();(0 until rows.length()).map { open(rows.getJSONObject(it),key) } } finally { key.fill(0) } }
    suspend fun serverVersion(id:String):NativeMapRecord { val key=key();return try { val rows=transport.request("/mindmaps").getJSONArray("maps");check();open((0 until rows.length()).map { rows.getJSONObject(it) }.first { it.getString("id")==id },key) } finally { key.fill(0) } }
    suspend fun fork(document:MindmapDocument):MindmapDocument { val copy=document.copy(id=UUID.randomUUID().toString(),title=document.title.take(1985)+" · копия");save(copy);return copy }
    suspend fun adoptServer(id:String) = mutex.withLock {
        val remote=serverVersion(id);check()
        // The local draft is retained as a separate encrypted map before adoption.
        val local=mutable.value.firstOrNull {it.document.id==id}
        val copy=local?.takeIf {it.unsynced}?.let {NativeMapRecord(it.document.copy(id=UUID.randomUUID().toString(),title=it.document.title.take(1985)+" · копия"),0)}
        persist(mutable.value.filterNot {it.document.id==id}+listOfNotNull(copy,remote))
    }
    suspend fun saveConversionDraft(task:LocalTask) { db.withTransaction { check();db.dao().putDocument(DocumentRecord(scope,"mindmap-conversion",cipher.encrypt(task.json(),"$scope/mindmap-conversion"),0));check() } }
    suspend fun conversionDraft():LocalTask? { check();val row=db.dao().document(scope,"mindmap-conversion") ?: return null
        val raw=cipher.decrypt(row.encrypted,"$scope/mindmap-conversion");val json=JSONObject(raw);check();return LocalTask.from(TaskRecord(scope,json.getString("id"),"",0,false),raw) }
    suspend fun clearConversionDraft() {db.withTransaction {check();db.dao().deleteDocument(scope,"mindmap-conversion");check()}}
    suspend fun saveView(id:String,view:JSONObject) { db.withTransaction { check();db.dao().putDocument(DocumentRecord(scope,"mindmap-view:$id",cipher.encrypt(view.toString(),"$scope/mindmap-view:$id"),1));check() } }
    suspend fun view(id:String):JSONObject? { check();return db.dao().document(scope,"mindmap-view:$id")?.let { JSONObject(cipher.decrypt(it.encrypted,"$scope/mindmap-view:$id")) } }
}
