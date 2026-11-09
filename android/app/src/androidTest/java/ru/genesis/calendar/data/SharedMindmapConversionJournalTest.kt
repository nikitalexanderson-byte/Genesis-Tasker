package ru.genesis.calendar.data

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.SharedMindmapProtocol

class SharedMindmapConversionJournalTest {
    @Test fun uncertainCreationAndAcknowledgementSurviveRepositoryRestartWithoutCrossSpaceLeaks() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext, GenesisDatabase::class.java).build()
        try {
            val space = "10000000-0000-4000-8000-000000000001"
            val project = "10000000-0000-4000-8000-000000000002"
            val task = "10000000-0000-4000-8000-000000000003"
            val cache = SharedMindmapProtocol.scope("test-account", space)
            SharedMindmapConversionJournal(db, cache).intent("map-one", "node-one", project, JSONObject().put("title", "Private draft"))
            val stored = requireNotNull(db.dao().document(cache, "shared-mindmap-conversions"))
            assertFalse(stored.encrypted.contains("Private draft")); assertFalse(stored.encrypted.contains("node-one"))
            val restarted = SharedMindmapConversionJournal(db, cache)
            assertEquals("Private draft", restarted.entries().single().getJSONObject("fields").getString("title"))
            assertTrue(SharedMindmapConversionJournal(db, SharedMindmapProtocol.scope("other-account", space)).entries().isEmpty())
            restarted.acknowledge("map-one", "node-one", JSONObject().put("id", task).put("projectId", project).put("revision", 1))
            // A retried stale form must preserve the receipt instead of resetting task identity.
            restarted.intent("map-one", "node-one", project, JSONObject().put("title", "Changed title"))
            val receipt = SharedMindmapConversionJournal(db, cache).entries().single()
            assertEquals(task, receipt.getString("taskId")); assertEquals("Private draft", receipt.getJSONObject("fields").getString("title"))
            restarted.clear("map-one", "node-one")
            assertTrue(SharedMindmapConversionJournal(db, cache).entries().isEmpty())
        } finally { db.close() }
    }
}
