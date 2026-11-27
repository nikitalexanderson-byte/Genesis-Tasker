package ru.genesis.calendar.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountSyncConcurrencyTest {
    @Test fun independentForegroundRestoreAcquiresItsOwnPermitOnTheSameThread() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), GenesisDatabase::class.java).build()
        val scope = "account-" + "a".repeat(32)
        val foreground = this
        try {
            val restore = NativeLegacyOperationPermit.run(db, scope, {}) {
                val syncOwner = requireNotNull(NativeLegacyOperationPermit.current())
                foreground.async(start = CoroutineStart.UNDISPATCHED) {
                    NativeLegacyOperationPermit.run(db, scope, {}) {
                        val owner = requireNotNull(NativeLegacyOperationPermit.current())
                        assertTrue(owner !== syncOwner)
                        owner.check()
                        "restored"
                    }
                }.also { assertTrue("Independent foreground work must wait for the sync owner", !it.isCompleted) }
            }
            assertEquals("restored", withTimeout(3000) { restore.await() })
        } finally { db.close() }
    }

    @Test fun pendingPullLeavesCacheAvailableToTheOperationHoldingTheAccountPermit() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), GenesisDatabase::class.java).build()
        val scope = "account-" + "a".repeat(32)
        val cache = Mutex()
        try {
            val owner = NativeLegacyOperationPermit.acquire(db, scope) {}
            val entered = CompletableDeferred<Unit>()
            val pull = async(start = CoroutineStart.UNDISPATCHED) {
                cache.withAccountSync(db, scope, { entered.complete(Unit) }) {
                    assertNotNull(NativeLegacyOperationPermit.current())
                    NativeLegacyTransportGate(db).request(scope, {}) { "loaded" }
                }
            }
            try {
                entered.await()
                // The upload owns the permit and still needs the cache to commit its receipt.
                assertTrue("A waiting download already holds the cache mutex", cache.tryLock())
                cache.unlock()
                withTimeout(3000) { owner.borrow { cache.withLock { owner.check() } } }
            } finally { owner.finish() }
            assertEquals("loaded", withTimeout(3000) { pull.await() })
        } finally { db.close() }
    }
}
