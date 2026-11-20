package ru.genesis.calendar.security

import org.json.JSONObject
import java.util.UUID

/** Authenticated requests are supplied by AuthController, not a second HTTP/session stack. */
class E2eeSignedMigrationTransport(private val device: E2eeScopeDevice, directory: E2eeDirectory.Verified, domains: Set<String>,
    private val request: suspend (String, JSONObject) -> JSONObject) : E2eeMigrationTransport {
    private val ownerId = directory.ownerId
    private val scopeId = directory.scopeId
    private val securityEpoch = directory.securityEpoch
    private val revision = directory.checkpoint.revision
    private val checkpoint = directory.checkpoint.hash
    private val domains = (domains + "attachment").toList()
    init { E2eeKeys.technical(ownerId); E2eeKeys.technical(scopeId); check(domains.isNotEmpty() && domains.all(E2eeEnvelope::supportsDomain)) { "E2EE_COVERAGE_REQUIRED" } }
    private suspend fun call(path: String, body: JSONObject): JSONObject {
        device.requireOpen(); val response = request(path,body); device.requireOpen(); return response
    }
    override suspend fun sourceHash(): String = call("/source",JSONObject().put("scopeId",scopeId)).getString("sourceHash").also { E2eeEnvelope.decode(it,32) }
    override suspend fun command(packet: JSONObject): JSONObject {
        val command = packet.getJSONObject("command")
        check(command.get("ownerId") == ownerId && command.get("scopeId") == scopeId && command.get("deviceId") == device.deviceId) { "E2EE_SCOPE_BINDING_MISMATCH" }
        return call("/command",packet)
    }
    suspend fun legacyWorkspace(context: E2eeMigrationSourceContext): JSONObject = legacyPersonal("legacy-workspace",context)
    suspend fun legacyAurora(context: E2eeMigrationSourceContext): JSONObject = legacyPersonal("legacy-aurora",context)
    suspend fun legacyStoicheion(context: E2eeMigrationSourceContext): JSONObject = legacyPersonal("legacy-stoicheion",context)
    suspend fun legacyAdvice(context: E2eeMigrationSourceContext): JSONObject = legacyPersonal("legacy-advice",context)
    suspend fun legacyTasks(context: E2eeMigrationSourceContext): JSONObject = legacyPersonal("legacy-tasks",context)
    suspend fun legacyDiary(context: E2eeMigrationSourceContext): JSONObject = legacyPersonal("legacy-diary",context)
    suspend fun legacyMindmaps(context: E2eeMigrationSourceContext): JSONObject = legacyPersonal("legacy-mindmaps",context)
    suspend fun legacyMindmapsPage(context:E2eeMigrationSourceContext,table:String,offset:Long):JSONObject {
        check(table in setOf("maps","versions","receipts","deletions")&&offset in 0..9007199254740990L){"E2EE_LEGACY_PAGE_INVALID"}
        return legacyPersonal("legacy-mindmaps",context,JSONObject().put("table",table).put("offset",offset))
    }
    suspend fun legacyPhysisPage(context:E2eeMigrationSourceContext,table:String,offset:Long):JSONObject {
        check(table in setOf("owners","records","usedIds","receipts")&&offset in 0..9007199254740990L){"E2EE_LEGACY_PAGE_INVALID"}
        return legacyPersonal("legacy-physis",context,JSONObject().put("table",table).put("offset",offset))
    }
    suspend fun legacyRemindersPage(context:E2eeMigrationSourceContext,table:String,offset:Long):JSONObject {
        check(table in setOf("habitProfiles","habitDevices","habitDeliveries","adviceDays","adviceDeliveries","sharedPreferences")&&offset in 0..9007199254740990L){"E2EE_LEGACY_PAGE_INVALID"}
        return legacyPersonal("legacy-reminders",context,JSONObject().put("table",table).put("offset",offset))
    }
    suspend fun legacyArchiveFragment(context:E2eeMigrationSourceContext,table:String,offset:Long,byteOffset:Long):JSONObject {
        check(table in setOf("stages","safety","receipts")&&offset in 0..9007199254740990L&&byteOffset in 0..64L*1024*1024){"E2EE_ARCHIVE_TRANSPORT_INVALID"}
        return legacyPersonal("legacy-archives",context,JSONObject().put("table",table).put("offset",offset).put("byteOffset",byteOffset))
    }
    private suspend fun legacyPersonal(action: String, context: E2eeMigrationSourceContext,page:JSONObject?=null): JSONObject {
        check(context.ownerId == ownerId && context.scopeId == scopeId) { "E2EE_SCOPE_BINDING_MISMATCH" }
        val packet = E2eeCommands.sign(JSONObject().put("protocol",1).put("ownerId",ownerId).put("scopeId",scopeId).put("deviceId",device.deviceId)
            .put("action",action).put("expectedRevision",revision).put("checkpointHash",checkpoint).put("securityEpoch",securityEpoch)
            .put("operationId",UUID.randomUUID().toString()).put("payload",JSONObject().put("migrationId",context.migrationId)
                .put("fence",context.fence).put("sourceHash",context.sourceHash).apply{page?.let{put("table",it.get("table"));put("offset",it.get("offset"));if(it.has("byteOffset"))put("byteOffset",it.get("byteOffset"))}}),device.keys().signing.private)
        val result = call("/read",packet)
        check(result.get("checkpointHash") == checkpoint && E2eeCommands.integer(result.get("directoryRevision"),1) == revision) { "E2EE_DIRECTORY_CONFLICT" }
        return result
    }
    private suspend fun read(action:String,payload:JSONObject):JSONObject {
        device.requireOpen()
        val packet=E2eeCommands.sign(JSONObject().put("protocol",1).put("ownerId",ownerId).put("scopeId",scopeId).put("deviceId",device.deviceId)
            .put("action",action).put("expectedRevision",revision).put("checkpointHash",checkpoint).put("securityEpoch",securityEpoch)
            .put("operationId",UUID.randomUUID().toString()).put("payload",payload),device.keys().signing.private)
        val page=call("/read",packet)
        check(E2eeCommands.integer(page.get("directoryRevision"),1)==revision&&page.get("checkpointHash")==checkpoint){"E2EE_DIRECTORY_CONFLICT"};return page
    }
    /** One bounded response, awaited sink, then the next request. The caller
     * still verifies exact expected hashes/context/signatures and plaintext. */
    override suspend fun forEachEnvelope(consume:suspend(E2eeEnvelope.Envelope)->Unit):Int=walk(1,consume)
    override suspend fun getEnvelope(domain:String,objectId:String):E2eeEnvelope.Envelope? {
        device.requireOpen();E2eeKeys.technical(objectId);check(domain in domains){"E2EE_SCOPE_BINDING_MISMATCH"}
        val page=read("get",JSONObject().put("domain",domain).put("objectId",objectId));val values=page.getJSONArray("envelopes");check(values.length()<=1){"E2EE_INVALID_RESPONSE"}
        if(values.length()==0)return null;val envelope=E2eeEnvelope.Envelope.fromJson(values.getJSONObject(0));val context=envelope.context.toJson()
        check(context.get("ownerId")==ownerId&&context.get("scopeId")==scopeId&&context.get("domain")==domain&&context.get("objectId")==objectId){"E2EE_INVALID_RESPONSE"};device.requireOpen();return envelope
    }
    private suspend fun walk(limit:Int,consume:suspend(E2eeEnvelope.Envelope)->Unit):Int {
        var count=0
        for (domain in domains) {
            var after = ""
            while (true) {
                device.requireOpen()
                val page=read("read",JSONObject().put("domain",domain).put("after",after).put("limit",limit))
                val envelopes = page.getJSONArray("envelopes"); check(envelopes.length() <= limit) { "E2EE_INVALID_RESPONSE" }
                if (envelopes.length() == 0) break
                check(count+envelopes.length()<=8000){"E2EE_MIGRATION_TOO_LARGE"}
                val bounded=(0 until envelopes.length()).map{E2eeEnvelope.Envelope.fromJson(envelopes.getJSONObject(it))};var cursor=after
                for(envelope in bounded){val context=envelope.context.toJson()
                    check(context.get("ownerId")==ownerId&&context.get("scopeId")==scopeId&&context.get("domain")==domain&&context.getString("objectId")>cursor){"E2EE_INVALID_RESPONSE"};cursor=context.getString("objectId")}
                for(envelope in bounded){
                    after=envelope.context.toJson().getString("objectId");device.requireOpen();consume(envelope);device.requireOpen();count++
                }
                // A short page may be due to the server byte cap. Continue until empty.
            }
        }
        device.requireOpen();return count
    }
    override suspend fun readAll(): List<E2eeEnvelope.Envelope> {
        val result=mutableListOf<E2eeEnvelope.Envelope>();var bytes=0L
        walk(50){envelope->bytes+=envelope.toJson().toString().length;check(bytes<=256L*1024*1024){"E2EE_MIGRATION_TOO_LARGE"};result+=envelope};return result
    }
    override fun toString() = "E2eeSignedMigrationTransport([redacted])"
}
