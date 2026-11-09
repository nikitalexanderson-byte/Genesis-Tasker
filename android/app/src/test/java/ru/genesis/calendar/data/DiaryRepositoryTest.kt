package ru.genesis.calendar.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.AuthFailure
import ru.genesis.calendar.auth.DiaryGateway
import ru.genesis.calendar.auth.DiaryProtocol
import ru.genesis.calendar.security.WorkspaceCipher

private class DiaryMemoryStore : DiaryStore {
    var raw: String? = null
    var writes = 0
    var full = false
    var failOnWrite: Int? = null
    override suspend fun read() = raw
    override suspend fun write(ciphertext: String) { if (full || writes + 1 == failOnWrite) error("QUOTA"); writes++; raw = ciphertext }
}
private class DiaryTestCipher : DiaryCacheCipher {
    private val key = ByteArray(32) { (it + 40).toByte() }
    override fun encrypt(plaintext: String): String = WorkspaceCipher.encrypt(plaintext.toByteArray(), key, "local-diary-fixture".toByteArray()).let {
        JSONObject().put("iv", it.iv).put("ciphertext", it.ciphertext).toString()
    }
    override fun decrypt(ciphertext: String): String = JSONObject(ciphertext).let {
        WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(it.getString("ciphertext"), it.getString("iv")), key, "local-diary-fixture".toByteArray()).toString(Charsets.UTF_8)
    }
}
private class DiaryServer : DiaryGateway {
    val key = ByteArray(32) { it.toByte() }
    val remote = mutableMapOf<String, JSONObject>()
    val sent = mutableListOf<String>()
    var lostReply = false
    var unavailable = false
    var unauthorized = false
    var active = true
    var expireAfterSend = false
    var invalidReceipt = false
    var futureSchema = false
    var mutations = 0
    var syncEnabled = true
    var policyRevision = 0L
    var policyWrites = 0
    var dreamSettings = DreamSettings()
    var metadataReads = 0
    var fullReads = 0
    private var lastPolicy: String? = null
    private val deleted = mutableMapOf<String, JSONObject>()
    private fun snapshot() = java.security.MessageDigest.getInstance("SHA-256")
        .digest(("$policyRevision:" + remote.keys.sorted().joinToString()).toByteArray())
        .joinToString("") { "%02x".format(it.toInt() and 255) }
    private fun metadata() = JSONObject().put("settings", JSONObject().put("syncEnabled", syncEnabled).put("revision", policyRevision))
        .put("dreamSettings", dreamSettings.json())
        .put("snapshot", snapshot()).put("deleted", JSONArray(deleted.values.toList()))
    override fun check() { if (!active) throw CancellationException("Account changed") }
    override suspend fun workspace(): JSONObject { check(); if (unavailable) throw AuthFailure(AuthFailure.Kind.NETWORK)
        return JSONObject().put("workspace", JSONObject().put("keyMode", "account").put("key", java.util.Base64.getEncoder().encodeToString(key))) }
    override suspend fun request(path: String, body: JSONObject?): JSONObject {
        check(); if (unavailable) throw AuthFailure(AuthFailure.Kind.NETWORK)
        if (unauthorized) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED, 401)
        if (body == null) {
            if (path == "/diary/settings") { metadataReads++; return metadata() }
            fullReads++
            return metadata().put("notes", JSONArray(remote.values.map { row -> JSONObject(row.toString()).also { if (futureSchema) it.put("schemaVersion", 2) } }))
        }
        if (path == "/diary/dream-settings") {
            if(body.getLong("expectedRevision")!=dreamSettings.revision)throw AuthFailure(AuthFailure.Kind.CONFLICT,409)
            dreamSettings=DreamSettings(body.getString("todayMode"),dreamSettings.revision+1)
            return JSONObject().put("dreamSettings",dreamSettings.json())
        }
        if (path == "/diary/settings") {
            if (lastPolicy != body.toString()) {
                require(body.getLong("expectedRevision") == policyRevision && body.getString("expectedSnapshot") == snapshot()) { "DIARY_REVISION_CONFLICT" }
                syncEnabled = body.getBoolean("syncEnabled"); policyRevision++; policyWrites++; lastPolicy = body.toString()
                if (!syncEnabled) {
                    remote.forEach { (id, row) -> deleted[id] = JSONObject().put("id", id).put("revision", row.getLong("revision") + 1)
                        .put("updatedAt", "2026-10-26T12:00:00Z").put("localOnly", true) }
                    remote.clear()
                }
            }
            return metadata()
        }
        if (!syncEnabled || deleted.containsKey(path.substringAfterLast('/'))) throw AuthFailure(AuthFailure.Kind.CONFLICT, 409)
        require(DiaryProtocol.allowedRoute("PUT", path)); DiaryProtocol.pending(JSONObject(body.toString()).apply { remove("dream") })
        sent += body.toString(); val id = path.substringAfterLast('/'); val previous = remote[id]
        val now = "2026-10-26T12:00:00Z"
        val same = previous != null && previous.getString("iv") == body.getString("iv") && previous.getString("ciphertext") == body.getString("ciphertext") && previous.getLong("expectedRevision") == body.getLong("expectedRevision")
        if (!same) {
            if ((previous?.getLong("revision") ?: 0) != body.getLong("expectedRevision")) throw AuthFailure(AuthFailure.Kind.CONFLICT, 409)
            mutations++
            remote[id] = JSONObject(body.toString()).put("id", id).put("revision", body.getLong("expectedRevision") + 1).put("updatedAt", now)
        }
        val receipt = JSONObject().put("revision", remote.getValue(id).getLong("revision")).put("updatedAt", now)
        if (expireAfterSend) active = false
        if (lostReply) { lostReply = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
        if (invalidReceipt) receipt.put("revision", 99)
        return receipt
    }
    override suspend fun remove(id: String, expectedRevision: Long): JSONObject {
        check(); if (unavailable) throw AuthFailure(AuthFailure.Kind.NETWORK)
        val prior = deleted[id]
        if (prior == null) {
            require(remote[id]?.getLong("revision") == expectedRevision) { "DIARY_REVISION_CONFLICT" }
            remote.remove(id)
            deleted[id] = JSONObject().put("id", id).put("revision", expectedRevision + 1)
                .put("updatedAt", "2026-10-26T12:00:00Z").put("localOnly", false)
        }
        return JSONObject(deleted.getValue(id).toString()).put("deleted", true)
    }
}

class DiaryRepositoryTest {
    @Test fun dreamFlagsArePrivateAndDraftDiscardCannotReturnAfterDelete() = runBlocking {
        val repository=repo()
        val note=DiaryNote.parse(DiaryNote.create("Synthetic dream").json().put("dream",JSONObject().put("day","2026-11-05").put("timeZone","UTC").put("lucid",true)).put("reaction","favorite"))
        val saved=repository.save(note)
        val metadata=JSONObject(server.sent.last()).getJSONObject("dream")
        assertEquals(setOf("day","timeZone"),metadata.keys().asSequence().toSet())
        repository.refresh();assertTrue(repository.state.value.records.single().note.lucid)
        val draft=repository.keepDraft(note.changed { put("body","Unfinished voice text") },saved.revision)
        repository.discardEditorDraft(note.id,draft.draftKey)
        assertFalse(repository.state.value.records.any{it.draft})
        repository.remove(saved)
        assertTrue(runCatching{repository.keepDraft(note,saved.revision)}.isFailure)
        assertTrue(repository.state.value.records.isEmpty())
    }
    @Test fun dreamSettingsPersistAndAStaleDeviceRefreshesInsteadOfOverwriting() = runBlocking {
        val repository=repo();repository.refresh();repository.setDreamTodayMode("morning")
        assertEquals("morning",repository.state.value.dreamSettings.todayMode)
        val offline=repo();server.unavailable=true;offline.loadCached()
        assertEquals("morning",offline.state.value.dreamSettings.todayMode);server.unavailable=false
        server.dreamSettings=DreamSettings("all-day",2)
        assertTrue(runCatching{repository.setDreamTodayMode("off")}.isFailure)
        assertEquals("all-day",repository.state.value.dreamSettings.todayMode)
    }
    private val store = DiaryMemoryStore()
    private val cipher = DiaryTestCipher()
    private val server = DiaryServer()
    private fun repo() = DiaryRepository("fixture-owner", server, store, cipher)
    private fun rejected(block: suspend () -> Unit) = runBlocking { assertTrue(runCatching { block() }.isFailure) }

    @Test fun permanentDeletionSurvivesRefreshAndReopenAndStaleEditCanBeSavedAsCopy() = runBlocking {
        val repository = repo(); val original = repository.save(DiaryNote.create("Keep my unsent edit"))
        repository.remove(original); repository.refresh()
        val reopened = repo(); reopened.loadCached(); reopened.refresh()
        assertTrue(reopened.state.value.records.isEmpty()); assertTrue(server.remote.isEmpty())
        assertEquals("DIARY_NOTE_DELETED", runCatching { reopened.save(original.note, 1) }.exceptionOrNull()?.message)
        val copied = reopened.saveCopy(original.note, null)
        assertNotEquals(original.note.id, copied.note.id); assertEquals(original.note.body, copied.note.body)
    }

    @Test fun disablingSyncRetainsLocalNotesOfflineAndExplicitEnableRecoversLostUploadReply() = runBlocking {
        val repository = repo(); val original = repository.save(DiaryNote.create("Saved before privacy switch"))
        repository.setSyncEnabled(false)
        assertFalse(repository.state.value.syncEnabled); assertFalse(server.syncEnabled); assertTrue(server.remote.isEmpty())
        server.unavailable = true
        val local = repository.state.value.records.single()
        repository.save(local.note.changed { put("body", "Offline local edit") }, local.revision)
        val reopened = repo(); reopened.loadCached(); reopened.refresh()
        assertFalse(reopened.state.value.syncEnabled); assertEquals("Offline local edit", reopened.state.value.records.single().note.body)
        server.unavailable = false; server.lostReply = true
        assertTrue(runCatching { reopened.setSyncEnabled(true) }.isFailure)
        val afterCrash = repo(); afterCrash.loadCached(); afterCrash.setSyncEnabled(true)
        assertTrue(afterCrash.state.value.syncEnabled); assertEquals(1, server.remote.size)
        assertNotEquals(original.note.id, server.remote.keys.single())
        assertEquals("Offline local edit", afterCrash.state.value.records.single().note.body)
        assertFalse(afterCrash.state.value.records.single().localOnly)
        assertEquals(2, server.mutations); assertEquals(2, server.sent.size) // Refresh reconciled the acknowledged ciphertext without a duplicate upload.
    }

    @Test fun storageFailureBeforeDisablePreventsDestructivePolicyRequest() = runBlocking {
        val repository = repo(); repository.save(DiaryNote.create("Must retain remote until local persistence succeeds"))
        store.full = true
        assertTrue(runCatching { repository.setSyncEnabled(false) }.isFailure)
        assertTrue(server.syncEnabled); assertEquals(1, server.remote.size); assertEquals(0, server.policyWrites)
    }

    @Test fun anotherDeviceReenablingDoesNotSilentlyUploadThisDevicesLocalNotes() = runBlocking {
        val first = repo(); first.save(DiaryNote.create("Shared before disabling"))
        val second = DiaryRepository("fixture-owner", server, DiaryMemoryStore(), cipher); second.refresh()
        first.setSyncEnabled(false); second.refresh()
        assertFalse(second.state.value.syncEnabled); assertTrue(second.state.value.records.single().localOnly)
        first.setSyncEnabled(true)
        val writes = server.mutations; val fullReads = server.fullReads
        second.refresh()
        val local = second.state.value.records.single(); second.save(local.note.changed { put("body", "Stay only on second device") }, 0)
        assertFalse(second.state.value.syncEnabled); assertEquals(writes, server.mutations)
        assertEquals(fullReads, server.fullReads); assertTrue(server.metadataReads > 0)
    }

    @Test fun customPaletteColorSurvivesEncryptedCacheAndRemoteRoundTrip() = runBlocking {
        val repository = repo()
        val note = DiaryNote.create("Palette fixture").changed { put("color", "rose"); put("customColor", "#15aB73") }
        repository.save(note)
        val reopened = repo(); reopened.loadCached(); reopened.refresh()
        val restored = reopened.state.value.records.single().note
        assertEquals("#15aB73", restored.customColor); assertEquals("rose", restored.color)
        assertEquals("#15aB73", restored.asCopy().customColor)
        assertFalse(store.raw!!.contains("#15aB73")); assertTrue(server.sent.none { it.contains("#15aB73") })
        listOf<Any>("red", "#123", "#12345678", "url(secret)", 123, JSONObject()).forEach { invalid ->
            assertTrue(runCatching { DiaryNote.parse(note.json().put("customColor", invalid)) }.isFailure)
        }
    }

    @Test fun savedNotesAndDraftsReopenFromEncryptedStorageWithoutNetwork() = runBlocking {
        val repository = repo(); val note = DiaryNote.create("Private body never in storage", "Private title")
        repository.save(note)
        val draft = repository.keepDraft(note.changed { put("body", "Unsent local edit") }, 1)
        assertFalse(store.raw!!.contains("Private")); assertFalse(store.raw!!.contains("Unsent"))
        assertTrue(server.sent.none { it.contains("Private") })
        server.unavailable = true
        val reopened = repo(); reopened.loadCached(); reopened.refresh()
        assertEquals(2, reopened.state.value.records.size)
        assertTrue(reopened.state.value.offline)
        assertEquals("Unsent local edit", reopened.state.value.records.single { it.draftKey == draft.draftKey }.note.body)
    }
    @Test fun lostReplyReplaysExactEnvelopeAfterProcessRecoveryOnlyOnce() = runBlocking {
        val first = repo(); val note = DiaryNote.create("Original pending text")
        server.lostReply = true
        assertTrue(runCatching { first.save(note) }.isFailure)
        val reopened = repo(); reopened.loadCached()
        val row = reopened.state.value.records.single { it.draft }
        reopened.save(row.note, row.revision, row.draftKey)
        assertEquals(1, server.mutations); assertEquals(server.sent[0], server.sent[1])
        assertFalse(reopened.state.value.records.any { it.draft })
        assertEquals(1L, reopened.state.value.records.single().revision)
    }
    @Test fun editingAfterLostReplyRecoversOldWriteThenSendsNewText() = runBlocking {
        val repository = repo(); val note = DiaryNote.create("First edit")
        server.lostReply = true; assertTrue(runCatching { repository.save(note) }.isFailure)
        val draft = repository.state.value.records.single { it.draft }
        repository.save(note.changed { put("body", "Newer edit") }, draft.revision, draft.draftKey)
        assertEquals(2, server.mutations); assertEquals(server.sent[0], server.sent[1])
        assertEquals("Newer edit", repository.state.value.records.single().note.body)
        assertEquals(2L, repository.state.value.records.single().revision)
    }
    @Test fun staleEditKeepsBothTextsAndSaveCopyDoesNotOverwriteRemote() = runBlocking {
        val repository = repo(); val note = DiaryNote.create("Original text")
        val base = repository.save(note)
        val remoteEdit = note.changed { put("body", "Other device text") }
        server.request("/diary/${note.id}", DiaryProtocol.seal("fixture-owner", remoteEdit, 1, server.key))
        val own = note.changed { put("body", "My unsent text") }
        val failure = runCatching { repository.save(own, base.revision) }.exceptionOrNull()
        assertTrue(failure is DiaryConflict)
        val draft = repository.state.value.records.single { it.draft }
        val copy = repository.saveCopy(own, draft.draftKey)
        assertNotEquals(note.id, copy.note.id); assertEquals("My unsent text", copy.note.body)
        repository.refresh()
        assertEquals(setOf("Other device text", "My unsent text"), repository.state.value.records.map { it.note.body }.toSet())
        assertFalse(repository.state.value.records.any { it.draft })
    }
    @Test fun lostReplyWhileSavingCopyReusesItsIdAndCiphertext() = runBlocking {
        val repository = repo(); val note = DiaryNote.create("Copy source")
        val draft = repository.keepDraft(note)
        server.lostReply = true
        assertTrue(runCatching { repository.saveCopy(note, draft.draftKey) }.isFailure)
        repository.saveCopy(note, draft.draftKey)
        assertEquals(1, server.mutations); assertEquals(server.sent[0], server.sent[1])
        assertEquals(1, server.remote.size); assertFalse(repository.state.value.records.any { it.draft })
    }
    @Test fun storageFailurePreventsNetworkWrite() = runBlocking {
        store.full = true
        assertTrue(runCatching { repo().save(DiaryNote.create("Must not leave device")) }.isFailure)
        assertEquals(0, server.sent.size); assertEquals(0, server.mutations)
    }
    @Test fun invalidReceiptAndLateSessionDoNotClearEncryptedDraft() = runBlocking {
        val repository = repo(); val note = DiaryNote.create("Preserve uncertain draft")
        server.invalidReceipt = true
        assertTrue(runCatching { repository.save(note) }.isFailure)
        assertTrue(repository.state.value.records.single().draft)
        val rawBefore = store.raw
        server.invalidReceipt = false; server.expireAfterSend = true
        val draft = repository.state.value.records.single()
        assertTrue(runCatching { repository.save(draft.note, draft.revision, draft.draftKey) }.exceptionOrNull() is CancellationException)
        assertNotNull(store.raw); assertTrue(cipher.decrypt(store.raw!!).contains("Preserve uncertain draft"))
        server.active = true; server.expireAfterSend = false
        val reopened = repo(); reopened.loadCached()
        assertTrue(reopened.state.value.records.single().draft)
        assertNotNull(rawBefore)
    }
    @Test fun unknownRemoteSchemaProtectsKnownCacheAndRejectsWrites() = runBlocking {
        val repository = repo(); val saved = repository.save(DiaryNote.create("Known good note"))
        val before = store.raw; server.futureSchema = true
        assertTrue(runCatching { repository.refresh() }.isFailure)
        assertTrue(repository.state.value.protected); assertEquals(before, store.raw)
        assertTrue(runCatching { repository.save(saved.note.changed { put("body", "Do not overwrite future data") }, 1) }.isFailure)
        assertEquals(1, server.mutations)
    }
    @Test fun unknownLocalSchemaIsNeverReplacedWithEmptyCache() = runBlocking {
        store.raw = cipher.encrypt(JSONObject().put("version", 99).put("owner", "fixture-owner").put("records", JSONArray()).toString())
        val before = store.raw; val repository = repo()
        assertTrue(runCatching { repository.loadCached() }.isFailure)
        assertTrue(runCatching { repository.save(DiaryNote.create("Do not erase future cache")) }.isFailure)
        assertEquals(before, store.raw); assertEquals(0, server.mutations)
    }
    @Test fun unauthorizedResponseDoesNotMasqueradeAsOfflineSuccess() = runBlocking {
        val repository = repo(); repository.save(DiaryNote.create("Cached note")); server.unauthorized = true
        assertTrue(runCatching { repository.refresh() }.isFailure)
        assertFalse(repository.state.value.offline); assertEquals("Cached note", repository.state.value.records.single().note.body)
    }
    @Test fun confirmedCopySurvivesFailureWhileDiscardingOriginalDraftWithoutAnotherCopy() = runBlocking {
        val repository = repo(); val note = DiaryNote.create("Copy once even when disk fills")
        val draft = repository.keepDraft(note)
        store.failOnWrite = 5
        assertTrue(runCatching { repository.saveCopy(note, draft.draftKey) }.isFailure)
        assertEquals(1, server.mutations)
        store.failOnWrite = null
        repository.saveCopy(note, draft.draftKey)
        assertEquals(1, server.mutations); assertFalse(repository.state.value.records.any { it.draft })
    }
    @Test fun adviceReactionRefreshesExistingWebNoteAndPreservesIndependentEditorDraft() = runBlocking {
        val advice = JSONObject().put("id", "advice-fixture").put("body", "Original public text").put("title", "Original advice")
            .put("language", "en").put("categories", JSONArray().put("aretology"))
            .put("sources", JSONArray().put(JSONObject().put("kind", "quote").put("work", "Original source")))
        val id = DiaryProtocol.privateAdviceId(server.key, "fixture-owner", "advice-fixture")
        val webNote = DiaryNote.reaction(advice, id, "favorite").changed { put("body", "My saved annotation") }
        server.request("/diary/$id", DiaryProtocol.seal("fixture-owner", webNote, 0, server.key))
        val repository = repo(); repository.refresh()
        val editor = repository.keepDraft(webNote.changed { put("body", "Unsent editor annotation") }, 1)
        repository.react(advice, "dislike")
        assertEquals("My saved annotation", repository.state.value.records.single { !it.draft }.note.body)
        assertTrue(repository.state.value.records.single { !it.draft }.note.archived)
        assertEquals("Unsent editor annotation", repository.state.value.records.single { it.draftKey == editor.draftKey }.note.body)
    }

}
