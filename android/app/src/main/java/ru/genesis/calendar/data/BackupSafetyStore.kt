package ru.genesis.calendar.data

import ru.genesis.calendar.data.withTransaction
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

/** Internal Keystore-protected rescue state. It is never a downloadable file or an active queue. */
internal class BackupSafetyStore(private val app: ru.genesis.calendar.GenesisApplication,private val scope: String,
    private val assertCurrent:()->Unit={}) {
    private val database=app.database
    private val preferences=LocalPreferences(app,scope)
    private val cipher=LocalCipher()
    private val prefix="backup-safety:"
    private val mutation=ru.genesis.calendar.auth.NativeBackupMutationGuard(scope)
    private suspend fun <T> write(operation:suspend ()->T):T=NativeLegacyOperationPermit.run(database,scope,{mutation.check();assertCurrent()},operation)
    suspend fun protect(value: JSONObject): String {
      // Freeze submitted input before waiting for the owner permit. Capture of
      // current device state instead happens inside protectCurrent's permit.
      val plain=value.toString()
      return write { database.withTransaction {
        val id=Instant.now().toString()+":"+UUID.randomUUID();val kind=prefix+id
        require(plain.toByteArray(Charsets.UTF_8).size<=64*1024*1024) { "BACKUP_TOO_LARGE" }
        val encrypted=cipher.encrypt(plain,"$scope/$kind");val chunks=encrypted.chunked(256*1024)
        val previous=database.dao().backupDocuments(scope).filter { it.kind.startsWith(prefix)&&!it.kind.contains("/chunk/") }.sortedBy { it.kind }
        chunks.forEachIndexed { index,chunk -> database.dao().putDocument(DocumentRecord(scope,"$kind/chunk/$index",chunk,1)) }
        database.dao().putDocument(DocumentRecord(scope,kind,JSONObject().put("chunks",chunks.size).put("length",encrypted.length).toString(),1))
        // A valid new copy is present before old copies are pruned. The only good copy is never removed.
        for(old in previous.dropLast(1)) {
            val manifest=JSONObject(old.encrypted)
            repeat(manifest.getInt("chunks")) { database.dao().deleteDocument(scope,"${old.kind}/chunk/$it") }
            database.dao().deleteDocument(scope,old.kind)
        }
        id
      }}
    }
    suspend fun captureRaw(): JSONObject = database.withTransaction {
        val dao=database.dao()
        JSONObject().put("format","native-protected-state-v1").put("scope",scope).put("capturedAt",Instant.now().toString())
            .put("preferences",preferences.backupRaw())
            .put("documents",JSONArray(dao.backupDocuments(scope).filterNot { it.kind.startsWith(prefix) }.map {
                JSONObject().put("kind",it.kind).put("encrypted",it.encrypted).put("revision",it.revision)
            })).put("tasks",JSONArray(dao.backupTasks(scope).map {
                JSONObject().put("id",it.id).put("encrypted",it.encrypted).put("revision",it.revision).put("deleted",it.deleted)
            })).put("outbox",JSONArray(dao.outbox(scope).map {
                JSONObject().put("entityId",it.entityId).put("revision",it.revision).put("operationId",it.operationId).put("state",it.state)
            }))
    }
    suspend fun protectCurrent(): String = write { database.withTransaction { protect(captureRaw()) } }
    suspend fun hasLocalState(): Boolean = database.withTransaction {
        database.dao().backupTasks(scope).isNotEmpty()||database.dao().outbox(scope).isNotEmpty()||
            database.dao().backupDocuments(scope).any { !it.kind.startsWith(prefix)&&it.kind!="account-entry" }||
            preferences.backupRaw().keys().asSequence().any { it.startsWith("pending:") }
    }
    suspend fun resetAfterProtection(accept:suspend ()->Unit={}): String = write {
        val frozen=captureRaw()
        val id=database.withTransaction {
            val saved=protect(frozen);val dao=database.dao()
            dao.clearAccountTaskCache(scope);dao.clearReminders(scope);dao.clearBackupHeldOutbox(scope)
            for(row in dao.backupDocuments(scope).filter { personalKind(it.kind) })dao.deleteDocument(scope,row.kind)
            saved
        }
        // Room and DataStore are separate stores: the protected copy is durable before
        // clearing pending preferences, and a concurrent change stops acceptance.
        preferences.holdPending(frozen.getJSONObject("preferences"))
        mutation.check();assertCurrent();accept()
        id
    }
    private fun personalKind(kind: String): Boolean = kind in setOf("structure","habits","trackers","cloud-base","task-lists","mindmaps","mindmap-conversion","stoicheion-draws")||
        kind.startsWith("mindmap-view:")||kind=="diary-v1"||kind.startsWith("diary-v1/")||kind.startsWith("aurora-")
}
