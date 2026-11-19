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
    private val activation=app.workspaceEpoch
    private fun check() { gateway.check();check(app.workspaceScope==scope) { "BACKUP_OWNER" } }
    /** Permit lifetime only, never a replacement for each action's gateway check.
     * The verified reset may retire its own HTTP generation while it drains. */
    fun checkOperationOwner(){check(app.workspaceScope==scope&&app.workspaceEpoch==activation){"BACKUP_OWNER"}}
    suspend fun beginLegacyOperation(assertView:()->Unit):NativeLegacyOperationPermit {
        check();checkOperationOwner()
        val permit=NativeLegacyOperationPermit.acquire(app.database,scope){assertView();checkOperationOwner()}
        try{check();return permit}catch(error:Throwable){permit.close();throw error}
    }
    fun <T> writeHistory(permit:NativeLegacyOperationPermit,write:()->T):T=permit.borrowTransport(app.database,scope,::check,write)
    private suspend fun <T> operation(action:suspend ()->T):T=NativeLegacyOperationPermit.run(app.database,scope,::check,action)
    private suspend fun key(): ByteArray {
        check();val workspace=gateway.request("GET","/workspace").getJSONObject("workspace");check()
        require(workspace.getString("keyMode")=="account") { "BACKUP_WORKSPACE_LOCKED" }
        return WorkspaceCipher.decodeKey(workspace.getString("key"))
    }
    suspend fun request(method: String,path: String,body: JSONObject?): JSONObject {
      val submitted=body?.let{JSONObject(it.toString())}
      return operation {
        check();require(BackupProtocol.allowedRoute(method,path)&&path!="/workspace") { "BACKUP_ROUTE" }
        if(method=="POST"&&path=="/backup/v1/commit")BackupSafetyStore(app,scope,::check).protectCurrent()
        val response=gateway.request(method,path,submitted);check()
        if(path=="/backup/v1/status"||path=="/backup/v1/commit")epochs.observe(scope,response.getLong("generation"))
        if(path=="/backup/v1/status"||path=="/backup/v1/commit")response.put("needsReconciliation",needsReconciliation())
        response
      }
    }
    suspend fun open(value: JSONObject,purpose: String): Any {
      val submitted=JSONObject(value.toString())
      return operation {
        check();require(BackupProtocol.allowedScope(purpose)) { "BACKUP_SCOPE" };val key=key()
        val aad=if(purpose=="workspace")byteArrayOf() else "genesis-mindmap-v1:$owner:$purpose".toByteArray(Charsets.UTF_8)
        val bytes=try { WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(submitted.getString("ciphertext"),submitted.getString("iv")),key,aad) } finally { key.fill(0) }
        try { check();JSONTokener(bytes.toString(Charsets.UTF_8)).nextValue() } finally { bytes.fill(0) }
      }
    }
    suspend fun seal(value: Any,purpose: String): JSONObject {
      val submitted=value.toString()
      return operation {
        check();require(BackupProtocol.allowedScope(purpose)) { "BACKUP_SCOPE" }
        val bytes=submitted.toByteArray(Charsets.UTF_8)
        try {
            // Refuse oversize content before obtaining the old account key, and
            // wipe the input even when its key request or size check fails.
            require(bytes.size<=GenesisBackupContainer.MAX_PLAIN) { "BACKUP_TOO_LARGE" }
            val key=key()
            val aad=if(purpose=="workspace")byteArrayOf() else "genesis-mindmap-v1:$owner:$purpose".toByteArray(Charsets.UTF_8)
            val sealed=try { WorkspaceCipher.encrypt(bytes,key,aad) } finally { key.fill(0) }
            check();JSONObject().put("iv",sealed.iv).put("ciphertext",sealed.ciphertext)
        } finally { bytes.fill(0) }
      }
    }
    suspend fun current(): JSONObject = operation {
        check();val workspace=gateway.request("GET","/workspace").getJSONObject("workspace");check()
        val envelope=workspace.optJSONObject("envelope")
        val recovered=gateway.request("GET","/recovered-tasks").getJSONArray("tasks")
        val tasks=JSONArray()
        for(index in 0 until recovered.length()) {
            val row=recovered.getJSONObject(index)
            tasks.put((open(row,"recovered-task:v1:${row.getString("id")}") as JSONObject).put("restoredRevision",row.getLong("revision")))
        }
        JSONObject().put("document",envelope?.let { open(it,"workspace") } ?: ru.genesis.calendar.auth.WorkspacePatch.emptyDocument())
            .put("version",envelope?.getLong("version") ?: 0).put("tasks",tasks)
    }
    suspend fun capture(): JSONObject = operation { GenesisBackupSnapshot(app).capture(owner) }
    suspend fun materialize(snapshot: JSONObject): JSONObject {
      val value=JSONObject(snapshot.toString())
      return operation {
        check();require(value.getString("ownerId")==owner) { "BACKUP_OWNER" }
        val sections=value.getJSONArray("sections")
        for(index in 0 until sections.length()) {
            val section=sections.getJSONObject(index);val data=section.optJSONObject("data")?:continue
            val envelopes=data.optJSONObject("nativeEnvelopes")?:continue
            require(section.getString("id")=="aurora") { "BACKUP_LOCAL_CACHE_INVALID" }
            val copies=JSONArray()
            for(kind in envelopes.keys()) {
                val key=ru.genesis.calendar.auth.AuroraProtocol.cacheKey(owner,kind)?:error("BACKUP_LOCAL_CACHE_INVALID")
                if(kind=="aurora-cache")continue
                val pending=envelopes.getJSONObject(kind)
                copies.put(JSONObject().put("key",key).put("document",open(pending.getJSONObject("envelope"),"aurora-workspace:v1"))
                    .put("base",open(pending.getJSONObject("base"),"aurora-workspace-base:v1"))
                    .put("expectedRevision",pending.getJSONObject("envelope").getLong("expectedRevision")))
            }
            val cache=envelopes.optJSONObject("aurora-cache")
            data.put("journalVersion",1).put("pendingCopies",copies).put("frozenStorage",envelopes)
                .put("cached",cache?.let { JSONObject().put("document",open(it,"aurora-workspace:v1")).put("revision",it.getLong("revision")) }?:JSONObject.NULL)
            data.remove("nativeEnvelopes")
        }
        check();value
      }
    }
    suspend fun retain(snapshot: JSONObject): Boolean {
      val submitted=JSONObject(snapshot.toString())
      return operation {
        check();require(submitted.getString("ownerId")==owner) { "BACKUP_OWNER" }
        BackupSafetyStore(app,scope,::check).protect(submitted);check();true
      }
    }
    fun needsReconciliation(): Boolean { check();return epochs.pending(scope)!=null }
    suspend fun reconcile(): Long {
        val generation=operation {
            val status=gateway.request("GET","/backup/v1/status");check()
            status.getLong("generation").also{epochs.observe(scope,it)}
        }
        if(epochs.pending(scope)==null)return generation
        val epoch=app.workspaceEpoch;gateway.quiesce()
        // quiesce deliberately retires authentication. The authorized local
        // protected reset still binds the SAME account activation; a switch
        // while it waits for the permit must leave that account's sources alone.
        BackupSafetyStore(app,scope,{check(app.workspaceScope==scope&&app.workspaceEpoch==epoch){"BACKUP_OWNER"}})
            .resetAfterProtection{epochs.acceptAfterProtectedReset(scope,generation)}
        return generation
    }
}
