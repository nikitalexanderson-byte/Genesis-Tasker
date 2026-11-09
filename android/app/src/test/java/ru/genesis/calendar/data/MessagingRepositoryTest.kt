package ru.genesis.calendar.data

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.MessagingGateway
import ru.genesis.calendar.auth.AuthApiError
import ru.genesis.calendar.auth.AuthFailure
import ru.genesis.calendar.auth.FeatureAccess
import ru.genesis.calendar.security.MessagingCrypto
import ru.genesis.calendar.security.MessageContext
import java.io.IOException
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.util.UUID

private fun messagingBackupPaidAccess() = FeatureAccess(enforcementEnabled = true, effectivePlan = "standart",
    validUntil = Instant.parse("2100-01-01T00:00:00Z"), allowedFeatures = setOf("data-export"))

private class MessagingMemoryStore : MessagingStore {
    val values = mutableMapOf<String, String>()
    var failDelete = false
    var failIdentityWrite = false
    var failDraftWrite = false
    override suspend fun read(key: String) = values[key]
    override suspend fun write(key: String, value: String) {
        if (key == "identity" && failIdentityWrite) { failIdentityWrite = false; throw IOException("disk") }
        if (key.startsWith("draft/") && failDraftWrite) { failDraftWrite = false; throw IOException("draft disk") }
        values[key] = value
    }
    override suspend fun delete(key: String) { if (failDelete) { failDelete = false; throw IOException("disk") }; values.remove(key) }
}
private class MessagingFixtureGateway : MessagingGateway {
    var access = FeatureAccess()
    var requests = 0
    var onKeyRead: (() -> Unit)? = null
    val space = "10000000-0000-0000-0000-000000000001"
    var conversation = "20000000-0000-0000-0000-000000000002"
    var status = "accepted"
    var messageReadFailure: Exception? = null
    var messageReads = 0
    var key: JSONObject? = null
    var peer = MessagingCrypto.createIdentity()
    var keyPosts = 0; var messagePosts = 0; var uploads = 0; var invalidSession = false
    var loseReceipt = false
    var failReceiptReconciliation = false
    var failNextRead = false
    var expireBeforeMessage = false
    var conflictNextPatch = false
    val payloads = mutableListOf<String>()
    val messages = mutableMapOf<String, JSONObject>()
    val boundFiles = mutableSetOf<String>()
    val fileChunks = mutableMapOf<String, String>()
    override fun check() { check(!invalidSession) { "SESSION_CHANGED" } }
    override fun featureAccess() = access
    private fun notice() = JSONObject().put("id", conversation).put("spaceId", space).put("peerId", "peer").put("peerName", "Друг").put("spaceTitle", "Команда").put("unread", 0)
    override suspend fun request(method: String, path: String, body: JSONObject?): JSONObject {
        check()
        requests++
        if (path == "/shared/messaging/key") {
            if (method == "GET") onKeyRead?.invoke()
            if (method == "POST") { keyPosts++; check(key == null || MessagingCrypto.fingerprint(key!!) == MessagingCrypto.fingerprint(body!!.getJSONObject("publicKey"))); key = body!!.getJSONObject("publicKey") }
            return JSONObject().put("keyId", key?.let(MessagingCrypto::fingerprint) ?: JSONObject.NULL).put("publicKey", key ?: JSONObject.NULL)
        }
        if (path == "/shared/messaging/inbox") return JSONObject().put("conversations", JSONArray().put(notice())).put("invitations", JSONArray())
        if (path.endsWith("/participants")) return JSONObject().put("members", JSONArray().put(JSONObject().put("userId", "peer").put("displayName", "Друг").put("viewing", true).put("keyId", peer.keyId).put("publicKey", JSONObject(peer.publicJson))))
        if (path.endsWith("/private-conversations")) return JSONObject().put("id", conversation).put("spaceId", space).put("status", status).put("initiatorId", "owner")
        if (method == "GET" && "/messages?before=" in path) {
            messageReads++; messageReadFailure?.let { throw it }
            if (failNextRead) { failNextRead = false; throw IOException("read unavailable") }
            val before = path.substringAfter("before=").toLong()
            val eligible = messages.values.filter { before == 0L || it.getLong("seq") < before }.sortedBy { it.getLong("seq") }
            val rows = eligible.takeLast(50)
            return JSONObject().put("messages", JSONArray(rows)).put("nextCursor", if (eligible.size > 50) rows.first().getLong("seq") else JSONObject.NULL)
        }
        if (path.endsWith("/read")) return JSONObject().put("ok", true)
        if (method == "PUT" && "/files/" in path) {
            val file = path.substringAfter("/files/").substringBefore('/')
            check(file !in boundFiles) { "BOUND_FILE_REUPLOAD" }; uploads++; fileChunks[path] = body!!.getString("ciphertext")
            return JSONObject().put("ok", true)
        }
        if (method == "GET" && "/files/" in path) {
            val file = path.substringAfter("/files/").substringBefore('/')
            if (file !in boundFiles) throw AuthFailure(AuthFailure.Kind.NOT_DEPLOYED, 404)
            return JSONObject().put("ciphertext", fileChunks[path] ?: throw AuthFailure(AuthFailure.Kind.NOT_DEPLOYED, 404))
        }
        if ("/messages" in path) {
            if (expireBeforeMessage && method == "POST") { expireBeforeMessage = false; fileChunks.clear(); throw AuthApiError("PRIVATE_FILE_NOT_READY") }
            val id = body?.optString("id")?.takeIf { it.isNotBlank() } ?: path.substringAfterLast('/')
            val existing = messages[id]
            val oldRevision = existing?.getLong("revision") ?: 0L
            if (method == "PATCH" && conflictNextPatch) {
                conflictNextPatch = false
                val context = MessageContext(space, conversation, id, "owner", oldRevision + 1)
                val ids = mapOf("owner" to MessagingCrypto.fingerprint(key!!), "peer" to peer.keyId)
                val conversationKey = MessagingCrypto.conversationKey(peer, key!!, conversation, space)
                val original = MessagingCrypto.decryptMessage(conversationKey, context.copy(revision = oldRevision), existing!!.getJSONObject("payload"), ids)
                existing.put("revision", oldRevision + 1).put("payload", MessagingCrypto.encryptMessage(conversationKey, context, original, ids))
                throw AuthApiError("MESSAGE_REVISION_CONFLICT")
            }
            if (method != "POST" && body!!.getLong("expectedRevision") != oldRevision) throw IOException("conflict")
            if (method == "POST") {
                messagePosts++; payloads += body!!.getJSONObject("payload").toString()
                if (existing != null) check(existing.getJSONObject("payload").toString() == body.getJSONObject("payload").toString()) { "DUPLICATE_PAYLOAD_CHANGED" }
            }
            if (method != "POST" || existing == null) messages[id] = JSONObject().put("seq", existing?.getLong("seq") ?: (messages.size + 1).toLong()).put("id", id).put("senderId", "owner").put("revision", oldRevision + 1).put("payload", body!!.optJSONObject("payload") ?: JSONObject.NULL).put("deletedAt", if (method == "DELETE") "2026-10-26T12:00:00Z" else JSONObject.NULL)
            body!!.optJSONArray("attachmentIds")?.let { rows -> repeat(rows.length()) { boundFiles += rows.getString(it) } }
            if (loseReceipt) { loseReceipt = false; failNextRead = failReceiptReconciliation; throw IOException("lost reply") }
            return JSONObject().put("ok", true).put("id", id)
        }
        error("Unexpected fixture route")
    }
    fun incoming(text: String) {
        val id = UUID.randomUUID().toString()
        val conversationKey = MessagingCrypto.conversationKey(peer, key!!, conversation, space)
        val ids = mapOf("owner" to MessagingCrypto.fingerprint(key!!), "peer" to peer.keyId)
        val payload = MessagingCrypto.encryptMessage(conversationKey, MessageContext(space, conversation, id, "peer", 1), text, ids)
        messages[id] = JSONObject().put("id", id).put("seq", messages.size + 1).put("senderId", "peer").put("revision", 1).put("payload", payload).put("deletedAt", JSONObject.NULL)
    }
}

class MessagingRepositoryTest {
    @Test fun existingServerKeyRequiresImportAndIsNeverReplaced() = runBlocking {
        val gateway = MessagingFixtureGateway().apply { key = JSONObject(MessagingCrypto.createIdentity().publicJson) }
        val repository = MessagingRepository("owner", gateway, MessagingMemoryStore())
        repository.initialize()
        assertTrue(repository.state.value.restoreRequired); assertFalse(repository.state.value.keyReady); assertEquals(0, gateway.keyPosts)
    }
    @Test fun lostCreateReceiptReusesExactPayloadAndDoesNotReuploadBoundFiles() = runBlocking {
        val gateway = MessagingFixtureGateway(); val store = MessagingMemoryStore(); var repository = MessagingRepository("owner", gateway, store)
        repository.initialize(); repository.open(gateway.space, "peer")
        repository.attach("файл.txt", "text/plain", ByteArray(300_000) { 71 }); repository.saveDraft("Привет")
        gateway.loseReceipt = true
        gateway.failReceiptReconciliation = true
        try { repository.send(); fail("lost reply") } catch (_: IOException) { }
        assertTrue(repository.state.value.pending); assertEquals(2, gateway.uploads)
        repository = MessagingRepository("owner", gateway, store); repository.initialize(); repository.open(gateway.space, "peer")
        repository.send()
        assertEquals(1, gateway.messages.size); assertEquals(2, gateway.messagePosts); assertEquals(gateway.payloads[0], gateway.payloads[1]); assertEquals(2, gateway.uploads)
        assertFalse(repository.state.value.pending); assertEquals("Привет", repository.state.value.messages.single().content!!.text)
    }
    @Test fun lostEditAndDeleteReceiptsAreProvenByStableSequence() = runBlocking {
        val gateway = MessagingFixtureGateway(); val repository = MessagingRepository("owner", gateway, MessagingMemoryStore())
        repository.initialize(); repository.open(gateway.space, "peer"); repository.send("Первая версия")
        repository.edit(repository.state.value.messages.single()); gateway.loseReceipt = true
        repository.send("Вторая версия")
        assertFalse(repository.state.value.pending); assertEquals(2L, repository.state.value.messages.single().revision)
        assertEquals("Вторая версия", repository.state.value.messages.single().content!!.text)
        gateway.loseReceipt = true; repository.delete(repository.state.value.messages.single())
        assertTrue(repository.state.value.messages.single().deleted); assertFalse(repository.state.value.pending)
    }
    @Test fun changedPeerPinBlocksSendAndRetainsDurableDraft() = runBlocking {
        val gateway = MessagingFixtureGateway(); val store = MessagingMemoryStore(); val repository = MessagingRepository("owner", gateway, store)
        repository.initialize(); repository.open(gateway.space, "peer"); repository.saveDraft("Сохранить")
        gateway.peer = MessagingCrypto.createIdentity()
        try { repository.send(); fail("must block") } catch (_: IllegalStateException) { }
        assertTrue(repository.state.value.keyChanged); assertEquals(0, gateway.messagePosts); assertTrue(store.values.keys.any { it.startsWith("draft/") })
    }
    @Test fun cleanupFailureUsesDoneMarkerWithoutRepeatedMutation() = runBlocking {
        val gateway = MessagingFixtureGateway(); val store = MessagingMemoryStore(); val repository = MessagingRepository("owner", gateway, store)
        repository.initialize(); repository.open(gateway.space, "peer"); store.failDelete = true
        try { repository.send("Текст"); fail("disk") } catch (_: IOException) { }
        assertEquals(1, gateway.messagePosts); repository.send(); assertEquals(1, gateway.messagePosts); assertFalse(repository.state.value.pending)
    }
    @Test fun sessionLossCannotRegisterOrSend() = runBlocking {
        val gateway = MessagingFixtureGateway(); val repository = MessagingRepository("owner", gateway, MessagingMemoryStore()); gateway.invalidSession = true
        try { repository.initialize(); fail("must block") } catch (_: IllegalStateException) { }
        assertEquals(0, gateway.keyPosts); assertEquals(0, gateway.messagePosts)
    }
    @Test fun rejectsBackupFromAnotherRegisteredIdentity() = runBlocking {
        val gateway = MessagingFixtureGateway().apply { access = messagingBackupPaidAccess() }
        val store = MessagingMemoryStore(); val repository = MessagingRepository("owner", gateway, store)
        repository.initialize(); val original = store.values["identity"]
        val other = MessagingCrypto.exportBackup(MessagingCrypto.createIdentity(), "A sufficiently long password")
        try { repository.importBackup(other, "A sufficiently long password"); fail("must block") } catch (_: IllegalArgumentException) { }
        assertEquals(original, store.values["identity"]); assertEquals(1, gateway.keyPosts)
    }
    @Test fun freeAndExpiredPlansDenyKeyBackupsBeforeParsingNetworkOrStorage() = runBlocking {
        for (access in listOf(FeatureAccess(), messagingBackupPaidAccess().copy(validUntil = Instant.EPOCH))) {
            val gateway = MessagingFixtureGateway().apply { this.access = access }
            val store = MessagingMemoryStore(); val repository = MessagingRepository("owner", gateway, store)
            repository.initialize()
            val before = store.values.toMap(); val requests = gateway.requests
            val imported = assertThrows(IllegalArgumentException::class.java) { runBlocking { repository.importBackup("{invalid", "bad") } }
            val exported = assertThrows(IllegalArgumentException::class.java) { runBlocking { repository.exportBackup("bad") } }
            var opened = false
            val saved = assertThrows(IllegalArgumentException::class.java) {
                repository.writeBackup("prepared-before-expiry") { opened = true; ByteArrayOutputStream() }
            }
            for (failure in listOf(imported, exported, saved)) assertEquals("FEATURE_SUBSCRIPTION_REQUIRED", failure.message)
            assertFalse(opened); assertEquals(requests, gateway.requests); assertEquals(before, store.values)
            assertTrue(repository.state.value.keyReady)
        }
    }
    @Test fun paidKeyBackupRoundtripWorksAndExpiryDuringPickerCannotOpenOutput() = runBlocking {
        val gateway = MessagingFixtureGateway().apply { access = messagingBackupPaidAccess() }
        val store = MessagingMemoryStore(); val repository = MessagingRepository("owner", gateway, store)
        repository.initialize()
        val password = "A sufficiently long password"
        val exported = repository.exportBackup(password)
        val output = ByteArrayOutputStream()
        repository.writeBackup(exported) { output }
        assertEquals(MessagingCrypto.fingerprint(gateway.key!!), MessagingCrypto.importBackup(output.toString("UTF-8"), password).keyId)
        val restoredStore = MessagingMemoryStore()
        val restored = MessagingRepository("owner", gateway, restoredStore)
        restored.importBackup(exported, password)
        assertTrue(restored.state.value.keyReady); assertNotNull(restoredStore.values["identity"])
        assertEquals(1, gateway.keyPosts)
        gateway.access = gateway.access.copy(validUntil = Instant.EPOCH)
        var opened = false
        val failure = assertThrows(IllegalArgumentException::class.java) {
            repository.writeBackup(exported) { opened = true; ByteArrayOutputStream() }
        }
        assertEquals("FEATURE_SUBSCRIPTION_REQUIRED", failure.message); assertFalse(opened)
        assertTrue(repository.state.value.keyReady)
    }
    @Test fun downgradeWhileCheckingAnImportedKeyCannotWriteOrRegisterIt() = runBlocking {
        val identity = MessagingCrypto.createIdentity(); val password = "A sufficiently long password"
        val exported = MessagingCrypto.exportBackup(identity, password)
        val gateway = MessagingFixtureGateway().apply {
            access = messagingBackupPaidAccess()
            onKeyRead = { access = FeatureAccess() }
        }
        val store = MessagingMemoryStore(); val repository = MessagingRepository("owner", gateway, store)
        val failure = assertThrows(IllegalArgumentException::class.java) { runBlocking { repository.importBackup(exported, password) } }
        assertEquals("FEATURE_SUBSCRIPTION_REQUIRED", failure.message)
        assertTrue(store.values.isEmpty()); assertEquals(0, gateway.keyPosts); assertNull(gateway.key)
        assertEquals(1, gateway.requests)
    }
    @Test fun expiredUnboundUploadIsReconciledAndReuploadedWithSameEnvelope() = runBlocking {
        val gateway = MessagingFixtureGateway(); val repository = MessagingRepository("owner", gateway, MessagingMemoryStore())
        repository.initialize(); repository.open(gateway.space, "peer"); repository.attach("large.bin", "application/octet-stream", ByteArray(300_000) { 17 })
        val fileId = repository.state.value.draft!!.files.single().id
        gateway.expireBeforeMessage = true; repository.send("Файл после длительного отсутствия сети")
        assertEquals(4, gateway.uploads); assertEquals(1, gateway.messages.size); assertFalse(repository.state.value.pending)
        assertEquals(fileId, repository.state.value.messages.single().content!!.files.single().id)
    }
    @Test fun editingCannotOverwriteUnsentDraftAndRemovingFileDeletesLocalChunks() = runBlocking {
        val gateway = MessagingFixtureGateway(); val store = MessagingMemoryStore(); val repository = MessagingRepository("owner", gateway, store)
        repository.initialize(); repository.open(gateway.space, "peer"); repository.send("Отправлено")
        val row = repository.state.value.messages.single()
        repository.saveDraft("Незаконченная новая мысль"); repository.attach("local.txt", "text/plain", byteArrayOf(1, 2))
        val file = repository.state.value.draft!!.files.single()
        try { repository.edit(row); fail("must retain") } catch (_: IllegalArgumentException) { }
        assertEquals("Незаконченная новая мысль", repository.state.value.draft!!.text)
        repository.removeFile(file.id); assertFalse(store.values.keys.any { it.startsWith("file/${file.id}/") })
        assertEquals("Незаконченная новая мысль", repository.state.value.draft!!.text)
    }
    @Test fun failedIdentityPersistenceNeverRegistersAnEphemeralKey() = runBlocking {
        val gateway = MessagingFixtureGateway(); val store = MessagingMemoryStore().apply { failIdentityWrite = true }
        val repository = MessagingRepository("owner", gateway, store)
        try { repository.initialize(); fail("disk") } catch (_: IOException) { }
        assertEquals(0, gateway.keyPosts); assertNull(store.values["identity"])
        store.failIdentityWrite = true
        try { repository.initialize(); fail("disk again") } catch (_: IOException) { }
        assertEquals(0, gateway.keyPosts)
        repository.initialize(); assertEquals(1, gateway.keyPosts); assertNotNull(store.values["identity"])
    }
    @Test fun deletingSentMessageKeepsIndependentUnsentComposition() = runBlocking {
        val gateway = MessagingFixtureGateway(); val repository = MessagingRepository("owner", gateway, MessagingMemoryStore())
        repository.initialize(); repository.open(gateway.space, "peer"); repository.send("Первая отправка")
        val sent = repository.state.value.messages.single()
        repository.saveDraft("Новая незаконченная мысль"); repository.attach("new.txt", "text/plain", byteArrayOf(5, 6))
        val draft = repository.state.value.draft!!
        repository.delete(sent)
        assertEquals(draft, repository.state.value.draft); assertFalse(repository.state.value.pending)
        repository.send(); assertEquals("Новая незаконченная мысль", repository.state.value.messages.last().content!!.text)
    }
    @Test fun remoteConflictCopyReencryptsExistingAttachmentForNewMessageAad() = runBlocking {
        val gateway = MessagingFixtureGateway(); val store = MessagingMemoryStore(); var repository = MessagingRepository("owner", gateway, store)
        repository.initialize(); repository.open(gateway.space, "peer"); repository.attach("kept.txt", "text/plain", "Файл из исходной версии".toByteArray())
        repository.send("Исходная версия")
        val original = repository.state.value.messages.single(); val oldFile = original.content!!.files.single()
        repository.edit(original); gateway.conflictNextPatch = true
        try { repository.send("Моя версия после конфликта"); fail("conflict") } catch (_: AuthApiError) { }
        assertTrue(repository.state.value.pending)
        store.failDraftWrite = true
        try { repository.recoverPending(); fail("disk") } catch (_: IOException) { }
        assertTrue(repository.state.value.pending)
        repository = MessagingRepository("owner", gateway, store); repository.initialize(); repository.open(gateway.space, "peer")
        repository.send() // Completes the durable recovery transition; does not send a new message yet.
        assertEquals(1, gateway.messages.size)
        assertFalse(repository.state.value.pending); assertNotEquals(original.id, repository.state.value.draft!!.id)
        assertNotEquals(oldFile.id, repository.state.value.draft!!.files.single().id)
        assertEquals("Моя версия после конфликта", repository.state.value.draft!!.text)
        repository.send()
        assertEquals(2, gateway.messages.size)
        val copy = repository.state.value.messages.last()
        assertEquals("Моя версия после конфликта", copy.content!!.text)
        assertEquals("Файл из исходной версии", repository.download(copy, copy.content.files.single()).toString(Charsets.UTF_8))
    }
    @Test fun delayedAutosaveStaysWithCapturedConversationAndCannotResurrectSentText() = runBlocking {
        val gateway = MessagingFixtureGateway(); val repository = MessagingRepository("owner", gateway, MessagingMemoryStore())
        repository.initialize(); repository.open(gateway.space, "peer")
        val firstConversation = gateway.conversation; val firstDraft = repository.state.value.draft!!
        repository.saveDraft("Начало", firstConversation, firstDraft.id, firstDraft.revision)
        gateway.conversation = "20000000-0000-0000-0000-000000000099"; repository.open(gateway.space, "peer")
        val secondDraft = repository.state.value.draft!!
        repository.saveDraft("Последний ввод первого чата", firstConversation, firstDraft.id, firstDraft.revision)
        assertEquals(secondDraft, repository.state.value.draft)
        val reads = gateway.messageReads; repository.refreshConversation(firstConversation); assertEquals(reads, gateway.messageReads)
        gateway.conversation = firstConversation; repository.open(gateway.space, "peer")
        assertEquals("Последний ввод первого чата", repository.state.value.draft!!.text)
        repository.send("Отправленный окончательный текст")
        val fresh = repository.state.value.draft!!
        repository.saveDraft("Устаревший callback", firstConversation, firstDraft.id, firstDraft.revision)
        assertEquals(fresh, repository.state.value.draft); assertTrue(fresh.text.isEmpty())
    }
    @Test fun declinedConversationIsNeverTreatedAsPendingInvitation() = runBlocking {
        val gateway = MessagingFixtureGateway().apply { status = "declined" }
        val repository = MessagingRepository("owner", gateway, MessagingMemoryStore()); repository.initialize(); repository.open(gateway.space, "peer")
        assertTrue(repository.state.value.declined); assertFalse(repository.state.value.accepted); assertEquals(0, gateway.messageReads)
    }
    @Test fun foregroundRefreshKeepsLoadedHistoryAndDraftAndClearsRevokedAccess() = runBlocking {
        val gateway = MessagingFixtureGateway(); val repository = MessagingRepository("owner", gateway, MessagingMemoryStore())
        repository.initialize(); repository.open(gateway.space, "peer")
        repeat(55) { repository.send("Сообщение $it") }
        repository.messages(true); assertEquals(55, repository.state.value.messages.size)
        repository.saveDraft("Незавершённый текст во время опроса")
        val draft = repository.state.value.draft!!; gateway.incoming("Ответ собеседника")
        repository.refreshConversation(gateway.conversation)
        assertEquals(56, repository.state.value.messages.size); assertNull(repository.state.value.before); assertEquals(draft, repository.state.value.draft)
        assertEquals("Ответ собеседника", repository.state.value.messages.last().content!!.text)
        gateway.messageReadFailure = AuthFailure(AuthFailure.Kind.NETWORK)
        repository.refreshConversation(gateway.conversation)
        assertTrue(repository.state.value.offline); assertEquals(56, repository.state.value.messages.size); assertEquals(draft, repository.state.value.draft)
        gateway.messageReadFailure = AuthFailure(AuthFailure.Kind.UNAUTHORIZED, 403)
        repository.refreshConversation(gateway.conversation)
        assertTrue(repository.state.value.accessBlocked); assertTrue(repository.state.value.messages.isEmpty()); assertEquals(draft, repository.state.value.draft)
        val reads = gateway.messageReads; repository.refreshConversation(gateway.conversation); assertEquals(reads, gateway.messageReads)
    }
}
