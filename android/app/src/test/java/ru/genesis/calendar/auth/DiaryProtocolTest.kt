package ru.genesis.calendar.auth

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.DiaryNote
import ru.genesis.calendar.security.WorkspaceCipher

class DiaryProtocolTest {
    private val key = ByteArray(32) { it.toByte() }
    @Test fun adviceIdMatchesRealWebCryptoDefault512BitHmacKey() {
        // Generated with the exact deriveKey/sign calls in personalDocumentAccess (no HMAC length option).
        assertEquals("68e55f599bf5623b15247c3dd1247c576c105bead070cf0239f314deed9e012a",
            DiaryProtocol.privateAdviceId(key, "fixture-owner", "advice-fixture"))
        assertNotEquals(DiaryProtocol.privateAdviceId(key, "fixture-owner", "advice-fixture"),
            DiaryProtocol.privateAdviceId(key, "other-owner", "advice-fixture"))
    }
    @Test fun diaryAadIsolatedFromOtherOwnersNotesAndMindmaps() {
        val note = DiaryNote.create("Original advice — исходный текст", "Fixture")
        val pending = DiaryProtocol.seal("fixture-owner", note, 2, key)
        val envelope = DiaryEnvelope(note.id, 3, note.updatedAt, pending.toString())
        assertEquals(note.body, DiaryProtocol.open("fixture-owner", envelope, key).body)
        assertTrue(runCatching { DiaryProtocol.open("other-owner", envelope, key) }.isFailure)
        assertTrue(runCatching { DiaryProtocol.open("fixture-owner", envelope.copy(id = "other-note"), key) }.isFailure)
        assertTrue(runCatching { WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(pending.getString("ciphertext"), pending.getString("iv")), key,
            "genesis-mindmap-v1:fixture-owner:map:${note.id}".toByteArray()) }.isFailure)
    }
    @Test fun onlyCurrentWireEnvelopeAndRealReceiptAreAccepted() {
        val note = DiaryNote.create("Draft body")
        val pending = DiaryProtocol.seal("fixture-owner", note, 0, key)
        assertEquals(setOf("expectedRevision", "schemaVersion", "iv", "ciphertext"), pending.keys().asSequence().toSet())
        assertTrue(runCatching { DiaryProtocol.pending(JSONObject(pending.toString()).put("operationId", "not-allowed")) }.isFailure)
        assertTrue(runCatching { DiaryProtocol.pending(JSONObject(pending.toString()).put("schemaVersion", 2)) }.isFailure)
        assertTrue(runCatching { DiaryProtocol.pending(JSONObject(pending.toString()).put("expectedRevision", .5)) }.isFailure)
        assertTrue(runCatching { DiaryProtocol.receipt(JSONObject().put("revision", 99).put("updatedAt", note.updatedAt), 0) }.isFailure)
        assertEquals(1L, DiaryProtocol.receipt(JSONObject().put("revision", 1).put("updatedAt", note.updatedAt), 0))
    }
    @Test fun routeAllowlistRestrictsDeletionAndSettingsToDiary() {
        assertTrue(DiaryProtocol.allowedRoute("GET", "/diary"))
        assertTrue(DiaryProtocol.allowedRoute("PUT", "/diary/note-1"))
        assertTrue(DiaryProtocol.allowedRoute("DELETE", "/diary/note-1"))
        assertTrue(DiaryProtocol.allowedRoute("GET", "/diary/settings"))
        assertTrue(DiaryProtocol.allowedRoute("PUT", "/diary/settings"))
        assertFalse(DiaryProtocol.allowedRoute("DELETE", "/diary/settings"))
        for ((method, path) in listOf( "GET" to "/diary/note-1", "PUT" to "/diary", "PUT" to "/diary/../config", "PUT" to "/mindmaps/note-1"))
            assertFalse(DiaryProtocol.allowedRoute(method, path))
    }
    @Test fun adviceSnapshotsUnknownFieldsAndReversibleArchiveSurviveEdits() {
        val advice = JSONObject().put("id", "advice-fixture").put("body", "Original source text").put("title", "Source")
            .put("language", "el").put("categories", org.json.JSONArray().put("aretology"))
            .put("sources", org.json.JSONArray().put(JSONObject().put("kind", "quote").put("work", "Original work")))
        val original = DiaryNote.reaction(advice, "private-id", "favorite").changed { put("futureOptionalField", "keep") }
        val edited = original.changed { put("body", "Personal annotation") }
        assertEquals("Original source text", edited.json().getJSONObject("advice").getString("body"))
        assertEquals("keep", edited.json().getString("futureOptionalField"))
        val disliked = DiaryNote.reaction(advice, original.id, "dislike", edited)
        assertTrue(disliked.archived); assertEquals("Personal annotation", disliked.body)
        assertFalse(disliked.restored().archived); assertNull(disliked.restored().reaction)
        assertTrue(runCatching { DiaryNote.parse(edited.json().put("version", 2)) }.isFailure)
        assertTrue(runCatching { DiaryNote.parse(edited.json().put("body", "   ")) }.isFailure)
    }
}
