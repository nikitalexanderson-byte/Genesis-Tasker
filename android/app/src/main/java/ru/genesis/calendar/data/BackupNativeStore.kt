package ru.genesis.calendar.data

import org.json.JSONObject
import org.json.JSONArray
import org.json.JSONTokener
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.BackupProtocol
import ru.genesis.calendar.auth.NativeBackupEpochStore
import ru.genesis.calendar.security.WorkspaceCipher

internal interface BackupGateway {
    fun check()
    suspend fun request(method: String,path: String,body: JSONObject?=null): JSONObject
    suspend fun quiesce()
}

/** The offline view gets plaintext documents it is allowed to restore, never the account key or session. */
internal class BackupNativeStore(private val app: GenesisApplication,private val owner: String,private val scope: String,
    private val gateway: BackupGateway) {
    private val epochs=NativeBackupEpochStore(app)
    private fun check() { gateway.check();check(app.workspaceScope==scope) { "BACKUP_OWNER" } }
    private suspend fun key(): ByteArray {
        check();val workspace=gateway.request("GET","/workspace").getJSONObject("workspace");check()
        require(workspace.getString("keyMode")=="account") { "BACKUP_WORKSPACE_LOCKED" }
        return WorkspaceCipher.decodeKey(workspace.getString("key"))
    }
    suspend fun request(method: String,path: String,body: JSONObject?): JSONObject {
        check();require(BackupProtocol.allowedRoute(method,path)&&path!="/workspace") { "BACKUP_ROUTE" }
        if(method=="POST"&&path=="/backup/v1/commit")BackupSafetyStore(app,scope).protectCurrent()
        val response=gateway.request(method,path,body);check()
        if(path=="/backup/v1/status"||path=="/backup/v1/commit")epochs.observe(scope,response.getLong("generation"))
        if(path=="/backup/v1/status"||path=="/backup/v1/commit")response.put("needsReconciliation",needsReconciliation())
        return response
    }
    suspend fun open(value: JSONObject,purpose: String): Any {
        check();require(BackupProtocol.allowedScope(purpose)) { "BACKUP_SCOPE" };val key=key()
        val aad=if(purpose=="workspace")byteArrayOf() else "genesis-mindmap-v1:$owner:$purpose".toByteArray(Charsets.UTF_8)
        val bytes=try { WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(value.getString("ciphertext"),value.getString("iv")),key,aad) } finally { key.fill(0) }
        return try { check();JSONTokener(bytes.toString(Charsets.UTF_8)).nextValue() } finally { bytes.fill(0) }
    }
    suspend fun seal(value: Any,purpose: String): JSONObject {
        check();require(BackupProtocol.allowedScope(purpose)) { "BACKUP_SCOPE" };val key=key()
        val bytes=value.toString().toByteArray(Charsets.UTF_8)
        require(bytes.size<=GenesisBackupContainer.MAX_PLAIN) { "BACKUP_TOO_LARGE" }
        val aad=if(purpose=="workspace")byteArrayOf() else "genesis-mindmap-v1:$owner:$purpose".toByteArray(Charsets.UTF_8)
        val sealed=try { WorkspaceCipher.encrypt(bytes,key,aad) } finally { bytes.fill(0);key.fill(0) }
        check();return JSONObject().put("iv",sealed.iv).put("ciphertext",sealed.ciphertext)
    }
    suspend fun current(): JSONObject {
        check();val workspace=gateway.request("GET","/workspace").getJSONObject("workspace");check()
        val envelope=workspace.optJSONObject("envelope")
        val recovered=gateway.request("GET","/recovered-tasks").getJSONArray("tasks")
        val tasks=JSONArray()
        for(index in 0 until recovered.length()) {
            val row=recovered.getJSONObject(index)
            tasks.put((open(row,"recovered-task:v1:${row.getString("id")}") as JSONObject).put("restoredRevision",row.getLong("revision")))
        }
        return JSONObject().put("document",envelope?.let { open(it,"workspace") } ?: ru.genesis.calendar.auth.WorkspacePatch.emptyDocument())
            .put("version",envelope?.getLong("version") ?: 0).put("tasks",tasks)
    }
    suspend fun capture(): JSONObject { check();return GenesisBackupSnapshot(app).capture(owner).also { check() } }
    suspend fun materialize(snapshot: JSONObject): JSONObject {
        check();require(snapshot.getString("ownerId")==owner) { "BACKUP_OWNER" }
        val value=JSONObject(snapshot.toString());val sections=value.getJSONArray("sections")
        for(index in 0 until sections.length()) {
            val section=sections.getJSONObject(index);val data=section.optJSONObject("data")?:continue
            val envelopes=data.optJSONObject("nativeEnvelopes")?:continue
            val pending=envelopes.optJSONObject("aurora-pending")?.optJSONObject("envelope")
            val envelope=pending?:envelopes.optJSONObject("aurora-cache")
            if(envelope!=null)data.put("document",open(envelope,"aurora-workspace:v1")).put("frozenStorage",envelopes)
            data.remove("nativeEnvelopes")
        }
        check();return value
    }
    suspend fun retain(snapshot: JSONObject): Boolean {
        check();require(snapshot.getString("ownerId")==owner) { "BACKUP_OWNER" }
        BackupSafetyStore(app,scope).protect(snapshot);check();return true
    }
    fun needsReconciliation(): Boolean { check();return epochs.pending(scope)!=null }
    suspend fun reconcile(): Long {
        check();val status=gateway.request("GET","/backup/v1/status");check()
        val generation=status.getLong("generation");epochs.observe(scope,generation)
        if(epochs.pending(scope)==null)return generation
        gateway.quiesce()
        BackupSafetyStore(app,scope).resetAfterProtection()
        epochs.acceptAfterProtectedReset(scope,generation)
        return generation
    }
}
