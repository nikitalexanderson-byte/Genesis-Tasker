package ru.genesis.calendar.data

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.MessagingGateway
import ru.genesis.calendar.security.MessageContext
import ru.genesis.calendar.security.MessagingCrypto

/** Actual current repository and P256/message cipher; synthetic transport and
 * in-memory durable cells. No provider login, HTTP or hardware store is claimed. */
class MessengerSecretPinTest {
    private class Store : MessagingStore {
        val cells = linkedMapOf<String, String>()
        override suspend fun read(key: String) = cells[key]
        override suspend fun write(key: String, value: String) { cells[key] = value }
        override suspend fun delete(key: String) { cells.remove(key) }
    }
    private class Server : MessagingGateway {
        val id = "22000000-0000-0000-0000-000000000001"
        val device = "22000000-0000-0000-0000-000000000002"
        val peerDevice = "22000000-0000-0000-0000-000000000003"
        val own = MessagingCrypto.createIdentity()
        val peer = MessagingCrypto.createIdentity()
        val replacement = MessagingCrypto.createIdentity()
        var changed = false
        var substituteOnly = false
        var messageWrites = 0
        val ids = mapOf("owner" to own.keyId, "peer" to peer.keyId)
        val originalPayload = MessagingCrypto.conversationKey(peer, JSONObject(own.publicJson), id, "messenger-secret-v1").let { key ->
            try { MessagingCrypto.encryptMessage(key, MessageContext("messenger-secret-v1", id, "22000000-0000-0000-0000-000000000004", "peer", 1), "Retained secret history", ids) }
            finally { key.fill(0) }
        }
        private fun member(user: String, did: String, keyId: String, publicJson: String) = JSONObject()
            .put("userId", user).put("name", user).put("role", "member").put("status", "active")
            .put("deviceId", did).put("keyId", keyId).put("publicKey", JSONObject(publicJson))
        private fun chat(): JSONObject {
            val visiblePeer = if (changed || substituteOnly) replacement else peer
            return JSONObject().put("id", id).put("kind", "secret").put("title", "Synthetic secret chat")
                .put("members", JSONArray().put(member("owner", device, own.keyId, own.publicJson))
                    .put(member("peer", peerDevice, if (substituteOnly) peer.keyId else visiblePeer.keyId, visiblePeer.publicJson)))
        }
        override fun check() = Unit
        override suspend fun request(method: String, path: String, body: JSONObject?): JSONObject = when {
            path == "/shared/messenger/conversations" -> JSONObject().put("conversations", JSONArray().put(chat()))
            path == "/shared/messenger/conversations/$id" -> chat()
            path == "/shared/messenger/devices" && method == "POST" -> {
                assertEquals(device, requireNotNull(body).getString("id"))
                assertFalse(body.getJSONObject("publicKey").has("d"))
                assertEquals(own.keyId, MessagingCrypto.fingerprint(body.getJSONObject("publicKey")))
                JSONObject().put("devices", JSONArray().put(JSONObject().put("id", device).put("keyId", own.keyId)))
            }
            path.startsWith("/shared/messenger/conversations/$id/messages?") -> JSONObject().put("messages", JSONArray()
                .put(JSONObject().put("id", "22000000-0000-0000-0000-000000000004").put("seq", 1).put("senderId", "peer")
                    .put("revision", 1).put("payload", JSONObject(originalPayload.toString())))).put("nextCursor", JSONObject.NULL)
            path.endsWith("/read") -> JSONObject().put("ok", true)
            path.endsWith("/messages") && method == "POST" -> { messageWrites++; error("Changed-key chat must not send") }
            else -> error("Unexpected synthetic secret-chat route")
        }
    }
    private fun store(server: Server) = Store().also { store ->
        store.cells["messenger/device"] = JSONObject().put("id", server.device)
            .put("privateKey", JSONObject(MessagingCrypto.privateJwk(server.own))).toString()
    }
    @Test fun realPeerKeyChangeBlocksSendingAndColdRestartWithoutReplacingPinOrDraft() = runBlocking {
        val server = Server(); val store = store(server)
        var repository = MessengerRepository("owner", server, store)
        repository.initialize(); repository.select(repository.state.value.chats.single())
        assertEquals("Retained secret history", repository.state.value.rows.single().text)
        assertNotNull(repository.state.value.securityCode)
        repository.saveDraft("Unsent secret draft")
        val original = store.cells.toMap()
        server.changed = true
        repository.refresh()
        assertEquals("MESSENGER_DEVICE_CHANGED", repository.state.value.secretError)
        assertNull(repository.state.value.securityCode)
        assertTrue(repository.state.value.rows.isEmpty())
        assertTrue(runCatching { repository.send() }.isFailure)
        assertEquals(0, server.messageWrites); assertEquals(original, store.cells)
        repository = MessengerRepository("owner", server, store)
        repository.initialize(); repository.select(repository.state.value.chats.single())
        assertEquals("MESSENGER_DEVICE_CHANGED", repository.state.value.secretError)
        assertEquals("Unsent secret draft", repository.state.value.draft)
        assertEquals(original, store.cells)
        server.changed = false; repository.refresh()
        assertNull(repository.state.value.secretError)
        assertEquals("Retained secret history", repository.state.value.rows.single().text)
        assertEquals("Unsent secret draft", repository.state.value.draft)
        assertEquals(original, store.cells)
    }
    @Test fun substitutedPublicKeyCannotReplaceAnAlreadyComparedPeer() = runBlocking {
        val server = Server(); val store = store(server)
        val repository = MessengerRepository("owner", server, store)
        repository.initialize(); repository.select(repository.state.value.chats.single()); repository.saveDraft("Preserve this draft")
        val original = store.cells.toMap(); server.substituteOnly = true
        repository.refresh()
        assertEquals("MESSENGER_DEVICE_CHANGED", repository.state.value.secretError)
        assertNull(repository.state.value.securityCode)
        assertTrue(runCatching { repository.send() }.isFailure)
        assertEquals(0, server.messageWrites); assertEquals(original, store.cells)
    }
}
