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
    private suspend fun legacyPersonal(action: String, context: E2eeMigrationSourceContext): JSONObject {
        check(context.ownerId == ownerId && context.scopeId == scopeId) { "E2EE_SCOPE_BINDING_MISMATCH" }
        val packet = E2eeCommands.sign(JSONObject().put("protocol",1).put("ownerId",ownerId).put("scopeId",scopeId).put("deviceId",device.deviceId)
            .put("action",action).put("expectedRevision",revision).put("checkpointHash",checkpoint).put("securityEpoch",securityEpoch)
            .put("operationId",UUID.randomUUID().toString()).put("payload",JSONObject().put("migrationId",context.migrationId)
                .put("fence",context.fence).put("sourceHash",context.sourceHash)),device.keys().signing.private)
        val result = call("/read",packet)
        check(result.get("checkpointHash") == checkpoint && E2eeCommands.integer(result.get("directoryRevision"),1) == revision) { "E2EE_DIRECTORY_CONFLICT" }
        return result
    }
    override suspend fun readAll(): List<E2eeEnvelope.Envelope> {
        val result = mutableListOf<E2eeEnvelope.Envelope>(); var bytes = 0L
        for (domain in domains) {
            var after = ""
            while (true) {
                device.requireOpen()
                val packet = E2eeCommands.sign(JSONObject().put("protocol",1).put("ownerId",ownerId).put("scopeId",scopeId).put("deviceId",device.deviceId)
                    .put("action","read").put("expectedRevision",revision).put("checkpointHash",checkpoint).put("securityEpoch",securityEpoch)
                    .put("operationId",UUID.randomUUID().toString()).put("payload",JSONObject().put("domain",domain).put("after",after).put("limit",50)),device.keys().signing.private)
                val page = call("/read",packet)
                check(E2eeCommands.integer(page.get("directoryRevision"),1) == revision && page.get("checkpointHash") == checkpoint) { "E2EE_DIRECTORY_CONFLICT" }
                val envelopes = page.getJSONArray("envelopes"); check(envelopes.length() <= 50) { "E2EE_INVALID_RESPONSE" }
                if (envelopes.length() == 0) break
                for (index in 0 until envelopes.length()) {
                    val envelope = E2eeEnvelope.Envelope.fromJson(envelopes.getJSONObject(index)); val ctx = envelope.context.toJson()
                    check(ctx.get("ownerId") == ownerId && ctx.get("scopeId") == scopeId && ctx.get("domain") == domain && ctx.getString("objectId") > after) { "E2EE_INVALID_RESPONSE" }
                    after = ctx.getString("objectId"); bytes += envelope.toJson().toString().length
                    check(result.size < 8000 && bytes <= 256L*1024*1024) { "E2EE_MIGRATION_TOO_LARGE" }; result += envelope
                }
                // A short page may be due to the server byte cap. Continue until empty.
            }
        }
        return result
    }
    override fun toString() = "E2eeSignedMigrationTransport([redacted])"
}
