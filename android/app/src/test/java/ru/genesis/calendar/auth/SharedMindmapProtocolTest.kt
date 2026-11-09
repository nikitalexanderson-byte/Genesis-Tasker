package ru.genesis.calendar.auth

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.MindmapDocument
import ru.genesis.calendar.data.SharedMindmapTransport
import ru.genesis.calendar.security.WorkspaceCipher
import java.util.Base64

class SharedMindmapProtocolTest {
    private val space = "10000000-0000-4000-8000-000000000001"
    private val otherSpace = "10000000-0000-4000-8000-000000000002"
    private val key = ByteArray(32) { it.toByte() }
    private fun map(): MindmapDocument = MindmapDocument.new("Командное решение").let { document ->
        document.copy(nodes = document.nodes.map { it.copy(extensions = JSONObject().put("tags", JSONArray().put("Решение"))
            .put("presentation", JSONObject().put("icon", "target").put("width", 320).put("align", "left")).toString()) })
    }
    private class Gateway(val key: ByteArray, var document: MindmapDocument) : SharedMindmapGateway {
        var active = true
        var callCount = 0
        var command: JSONObject? = null
        override fun checkSharedMindmapAccount(uid: String) { check(active && uid == "member") }
        override suspend fun sharedMindmapWorkspace() = JSONObject().put("workspace", JSONObject().put("keyMode", "account").put("key", Base64.getEncoder().encodeToString(key)))
        override suspend fun sharedMindmapDocument(space: String, path: String, body: JSONObject?, method: String): JSONObject {
            callCount++
            if (method == "PUT") { command = JSONObject(requireNotNull(body).toString()); return JSONObject().put("revision", 8) }
            return JSONObject().put(if (path.endsWith("/history")) "versions" else "maps", JSONArray().put(JSONObject()
                .put("id", document.id).put("schemaVersion", 1).put("revision", 7).put("document", document.json())))
        }
    }
    @Test fun routesRejectTraversalQueriesWrongScopesAndHistoryMutation() {
        assertTrue(allowedSharedMindmapRoute("GET", "/shared/spaces/$space/mindmaps"))
        assertTrue(allowedSharedMindmapRoute("PUT", "/shared/spaces/$space/mindmaps/map-one"))
        assertTrue(allowedSharedMindmapRoute("GET", "/shared/spaces/$space/mindmaps/map-one/history"))
        listOf("/shared/spaces/$space/mindmaps/../tasks", "/shared/spaces/$space/mindmaps?spaceId=$otherSpace",
            "/shared/spaces/not-a-space/mindmaps", "/shared/spaces/$space/mindmaps/map%2Fone").forEach { assertFalse(allowedSharedMindmapRoute("GET", it)) }
        assertFalse(allowedSharedMindmapRoute("PUT", "/shared/spaces/$space/mindmaps/map-one/history"))
        assertFalse(allowedSharedMindmapRoute("POST", "/shared/spaces/$space/mindmaps/map-one"))
    }
    @Test fun cacheAndAuthenticatedEncryptionAreBoundToAccountSpaceAndMap() {
        assertNotEquals(SharedMindmapProtocol.scope("account-one", space), SharedMindmapProtocol.scope("account-two", space))
        assertNotEquals(SharedMindmapProtocol.scope("account-one", space), SharedMindmapProtocol.scope("account-one", otherSpace))
        val envelope = WorkspaceCipher.encrypt("private draft".toByteArray(), key, SharedMindmapProtocol.aad("member", space, "map-one"))
        assertEquals("private draft", WorkspaceCipher.decrypt(envelope, key, SharedMindmapProtocol.aad("member", space, "map-one")).toString(Charsets.UTF_8))
        assertTrue(runCatching { WorkspaceCipher.decrypt(envelope, key, SharedMindmapProtocol.aad("other-member", space, "map-one")) }.isFailure)
        assertTrue(runCatching { WorkspaceCipher.decrypt(envelope, key, SharedMindmapProtocol.aad("member", otherSpace, "map-one")) }.isFailure)
    }
    @Test fun adapterReadsServerJsonIntoScopedEnvelopeWithoutLosingPresentation() = runBlocking {
        val document = map(); val gateway = Gateway(key, document); val transport = SharedMindmapTransport(gateway, "member", space)
        val row = transport.request("/mindmaps").getJSONArray("maps").getJSONObject(0)
        assertFalse(row.has("document")); assertEquals(7, row.getInt("revision"))
        val plaintext = WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(row.getString("ciphertext"), row.getString("iv")), key, SharedMindmapProtocol.aad("member", space, document.id))
        val restored = MindmapDocument.parse(JSONObject(plaintext.toString(Charsets.UTF_8)))
        assertEquals("target", restored.nodes.single().json().getJSONObject("presentation").getString("icon"))
        assertEquals("Решение", restored.nodes.single().json().getJSONArray("tags").getString(0))
        assertEquals(document.title, restored.title)
    }
    @Test fun adapterSendsSharedDocumentWithSameRevisionAndRetryIdentity() = runBlocking {
        val document = map(); val gateway = Gateway(key, document); val transport = SharedMindmapTransport(gateway, "member", space)
        val envelope = WorkspaceCipher.encrypt(document.json().toString().toByteArray(), key, SharedMindmapProtocol.aad("member", space, document.id))
        val pending = JSONObject().put("schemaVersion", 2).put("expectedRevision", 7).put("operationId", "retry-one")
            .put("iv", envelope.iv).put("ciphertext", envelope.ciphertext)
        transport.request("/mindmaps/${document.id}", pending)
        val command = requireNotNull(gateway.command)
        assertEquals(1, command.getInt("schemaVersion")); assertEquals(7, command.getInt("expectedRevision")); assertEquals("retry-one", command.getString("operationId"))
        assertFalse(command.has("ciphertext")); assertFalse(command.has("key")); assertEquals(document.id, command.getJSONObject("document").getString("id"))
        transport.request("/mindmaps/${document.id}", pending)
        assertEquals(command.toString(), requireNotNull(gateway.command).toString())
        val foreign = WorkspaceCipher.encrypt(document.json().toString().toByteArray(), key, SharedMindmapProtocol.aad("member", otherSpace, document.id))
        assertTrue(runCatching { transport.request("/mindmaps/${document.id}", JSONObject(pending.toString()).put("iv", foreign.iv).put("ciphertext", foreign.ciphertext)) }.isFailure)
        assertEquals(2, gateway.callCount)
    }
    @Test fun accountSwitchStopsBeforeReadingOrSendingSharedContent() = runBlocking {
        val gateway = Gateway(key, map()); var hidden = false
        val transport = SharedMindmapTransport(gateway, "member", space, onAccessLost = { hidden = true })
        gateway.active = false
        assertTrue(runCatching { transport.request("/mindmaps") }.isFailure)
        assertTrue(hidden); assertEquals(0, gateway.callCount)
    }
}
