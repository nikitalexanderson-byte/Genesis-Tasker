package ru.genesis.calendar.data

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class DiaryRoomStoreTest {
    @Test fun largeCiphertextUsesBoundedRowsAndReplacesPreviousGeneration() = runBlocking {
        val database = Room.inMemoryDatabaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext, GenesisDatabase::class.java).build()
        try {
            val store = DiaryRoomStore(database, "fixture")
            database.dao().putDocument(DocumentRecord("fixture", "diary-v1", "legacy-ciphertext", 1))
            assertEquals("legacy-ciphertext", store.read())
            val large = "0123456789abcdef".repeat(200_000)
            store.write(large)
            assertEquals(large, store.read())
            val previous = database.dao().document("fixture", "diary-v1")!!.encrypted
            assertTrue(previous.length < 200)
            val oldGeneration = org.json.JSONArray(previous.substringAfter(':')).getString(0)
            store.write("replacement")
            assertEquals("replacement", store.read())
            assertNull(database.dao().document("fixture", "diary-v1/$oldGeneration/0"))
        } finally { database.close() }
    }
}
