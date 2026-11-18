package ru.genesis.calendar.data

import androidx.room.withTransaction
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import ru.genesis.calendar.auth.AuthApiError
import ru.genesis.calendar.auth.CloudAccountSnapshot
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Real Room/coroutine ordering with synthetic IO callbacks. No provider/socket
 * traffic, no main app database and no real identity or signing keys. */
@RunWith(AndroidJUnit4::class)
class E2eeLegacyTransportGateTest {
    private val fixture=E2eeLegacyScopeFenceTest()
    private suspend fun reject(code: String, operation: suspend () -> Unit) {
        try { operation();fail("Protected transport was accepted") }
        catch(error: AuthApiError) { assertEquals(code,error.code) }
    }
    @Test fun preparationWaitsForTheWholeLegacyResponseAndRejectsLaterIoAcrossControllers() = runBlocking {
        val name="qa-e2ee-transport-${UUID.randomUUID()}.db";val first=fixture.open(name);val second=fixture.open(name)
        val release=CountDownLatch(1)
        try {
            first.dao().putOutbox(OutboxRecord(fixture.scope,"task",1,"original-operation"))
            val started=CompletableDeferred<Unit>();val io=AtomicInteger()
            val old=async(Dispatchers.IO) { NativeLegacyTransportGate(first).request(fixture.scope,{}) {
                io.incrementAndGet();started.complete(Unit)
                check(release.await(10,TimeUnit.SECONDS));"complete-response"
            } }
            withTimeout(10_000) { started.await() }
            val entered=CompletableDeferred<Unit>()
            val migration=async(Dispatchers.IO) { NativeLegacyScopeFence(second,fixture.owner,fixture.remote,{}).withFence { entered.complete(Unit) } }
            assertNull(withTimeoutOrNull(150) { entered.await() })
            release.countDown();assertEquals("complete-response",old.await());withTimeout(10_000) { migration.await() }
            reject("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN") { withContext(Dispatchers.IO) {
                NativeLegacyTransportGate(first).request(fixture.scope,{}) { io.incrementAndGet() }
            } }
            assertEquals(1,io.get());assertEquals("original-operation",first.dao().outbox(fixture.scope).single().operationId)
            val unrelated=CloudAccountSnapshot.scopeFor("other-owner")
            assertEquals("free",withContext(Dispatchers.IO) { NativeLegacyTransportGate(first).request(unrelated,{}) { "free" } })
        } finally { release.countDown();first.close();second.close();fixture.context.deleteDatabase(name) }
    }
    @Test fun failedPreparationRetainsDenyAfterAWaitingRequestAndConnectionReopen() = runBlocking {
        val name="qa-e2ee-transport-${UUID.randomUUID()}.db";var room=fixture.open(name)
        try {
            val gate=NativeLegacyTransportGate(room);val entered=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>();val io=AtomicInteger()
            val migration=async(Dispatchers.IO) {
                try { NativeLegacyScopeFence(room,fixture.owner,fixture.remote,{}).withFence {
                    entered.complete(Unit);release.await();error("SYNTHETIC_INTERRUPTION")
                } } catch(error: IllegalStateException) { assertEquals("SYNTHETIC_INTERRUPTION",error.message) }
            }
            withTimeout(10_000) { entered.await() }
            val request=async(Dispatchers.IO) { reject("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN") { gate.request(fixture.scope,{}) { io.incrementAndGet() } } }
            assertNull(withTimeoutOrNull(150) { request.await() });release.complete(Unit)
            withTimeout(10_000) { migration.await();request.await() };assertEquals(0,io.get())
            room.close();room=fixture.open(name)
            reject("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN") { withContext(Dispatchers.IO) { NativeLegacyTransportGate(room).request(fixture.scope,{}) { io.incrementAndGet() } } }
            assertEquals(0,io.get())
        } finally { room.close();fixture.context.deleteDatabase(name) }
    }
    @Test fun roomTransactionIoIsRejectedBeforeLockInversionAndAChangedAccountNeverSends() = runBlocking {
        val name="qa-e2ee-transport-${UUID.randomUUID()}.db";val room=fixture.open(name);val io=AtomicInteger()
        try {
            val gate=NativeLegacyTransportGate(room)
            room.withTransaction { reject("E2EE_LEGACY_TRANSACTION_IO_FORBIDDEN") { gate.request(fixture.scope,{}) { io.incrementAndGet() } } }
            assertEquals(0,io.get())
            try { withContext(Dispatchers.IO) { gate.request(fixture.scope,{ throw CancellationException("synthetic account changed") }) { io.incrementAndGet() } };fail("Changed account sent") }
            catch(_: CancellationException) { /* no IO */ }
            assertEquals(0,io.get())
            assertEquals("ordinary-legacy",withContext(Dispatchers.IO) { gate.request(fixture.scope,{}) { "ordinary-legacy" } })
        } finally { room.close();fixture.context.deleteDatabase(name) }
    }
}
