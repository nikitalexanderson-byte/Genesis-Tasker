package ru.genesis.calendar.data

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AdminDraftRepositoryTest {
    @Test fun encryptedIntentSurvivesRestartAndOlderAutosaveCannotReplaceResetOrSentBody() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext, GenesisDatabase::class.java).build()
        try {
            var active = true
            fun repository(account: String = "account-one") = AdminDraftRepository(db, account, "admin") { check(active) }
            fun draft(id: String, generation: Long) = JSONObject().put("schemaVersion", 1).put("draftId", id).put("generation", generation)
                .put("form", JSONObject().put("title", "Private unpublished title")).put("sentBody", JSONObject.NULL)
            val first = draft("draft-one", 1)
            assertTrue(repository().save(first))
            val sent = draft("draft-one", 2).put("sentBody", JSONObject().put("fingerprint", "immutable-content-digest").put("draftId", "draft-one"))
            assertTrue(repository().save(sent))
            assertFalse(repository().save(first))
            assertEquals("immutable-content-digest", repository().load()!!.getJSONObject("sentBody").getString("fingerprint"))
            val stored = db.dao().document("account-one", "admin-ad-draft-v1")!!.encrypted
            assertFalse(stored.contains("Private unpublished title")); assertFalse(stored.contains("immutable-content-digest"))
            assertNull(repository("account-two").load())
            assertTrue(repository().save(draft("new-draft", 3)))
            assertFalse(repository().save(sent)); assertFalse(repository().save(draft("other-draft", 3)))
            assertEquals("new-draft", repository().load()!!.getString("draftId"))
            active = false
            assertTrue(runCatching { repository().load() }.isFailure)
            assertTrue(runCatching { repository().save(draft("must-not-write", 4)) }.isFailure)
        } finally { db.close() }
    }
}
