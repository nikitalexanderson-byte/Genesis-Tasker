package ru.genesis.calendar.data

import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import ru.genesis.calendar.auth.AuthApiError
import java.util.concurrent.ConcurrentHashMap

/** All account imports, Google list changes and outbox sends take the scope permit before
 * the controller mutex. Nested protected HTTP and Room work borrow that same permit. */
internal suspend fun <T> Mutex.withAccountSync(db: GenesisDatabase, scope: String,
    assertCurrent: () -> Unit, operation: suspend () -> T): T =
    NativeLegacyOperationPermit.run(db, scope, assertCurrent) {
        withLock { assertCurrent(); operation() }
    }

/** Current Android app/WorkManager writers use one process (no :process services).
 * Controllers and independent Room instances must use the SAME scope mutex.
 * SQLite separately enforces persistent storage barriers across connections. */
internal object LegacyScopeLocks {
    private val locks = ConcurrentHashMap<String, Mutex>()
    private class MemoryGate { var frozen=false }
    private val memory=ConcurrentHashMap<String,MemoryGate>()
    fun identity(db: GenesisDatabase, scope: String) =
        "${db.openHelper.databaseName ?: "memory:${System.identityHashCode(db)}"}\u0000$scope"
    fun mutex(db: GenesisDatabase, scope: String): Mutex = locks.getOrPut(identity(db,scope)) { Mutex() }
    private fun memoryGate(db:GenesisDatabase,scope:String)=memory.getOrPut(identity(db,scope)){MemoryGate()}
    /** Memory input must not wait for the scope mutex on a WebView bridge
     * thread: migration can need that thread for its offline reconciler. Freeze
     * under this monitor BEFORE installing the durable deny and taking capture.
     * Ordinary legacy IO may hold the scope mutex without freezing UI input. */
    fun freezeMemory(db:GenesisDatabase,scope:String){val gate=memoryGate(db,scope);synchronized(gate){gate.frozen=true}}
    fun releaseCancelledMemory(db:GenesisDatabase,scope:String){val gate=memoryGate(db,scope);synchronized(gate){gate.frozen=false}}
    fun <T> memoryWrite(db:GenesisDatabase,scope:String,assertCurrent:()->Unit,operation:()->T):T {
        require(scope.matches(Regex("account-[a-f0-9]{32}"))){"E2EE_SCOPE_BINDING_MISMATCH"}
        val gate=memoryGate(db,scope)
        return synchronized(gate){
            assertCurrent();if(gate.frozen)throw AuthApiError("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN")
            try{check(!genesisRoomTransactionActive()&&!db.inTransaction())}
            catch(_:IllegalStateException){throw AuthApiError("E2EE_LEGACY_TRANSACTION_IO_FORBIDDEN")}
            // Also honor a preparing/active marker restored in a fresh process.
            runBlocking(Dispatchers.IO){if(db.dao().legacyScopeFence(scope)!=null)throw AuthApiError("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN")}
            assertCurrent();operation().also{assertCurrent()}
        }
    }
}

/** Blocks before any legacy personal socket is created; keeps its permit until
 * the complete response/cleanup, so migration cannot snapshot behind a late IO.
 * This is NOT an endpoint allowlist, a shared-scope guard or external consent. */
internal class NativeLegacyTransportGate(private val db: GenesisDatabase) {
    fun <T> request(scope: String, assertCurrent: () -> Unit, operation: () -> T): T {
        require(scope.matches(Regex("account-[a-f0-9]{32}"))) { "E2EE_SCOPE_BINDING_MISMATCH" }
        // Lock order is scope -> Room. Network inside a Room transaction would
        // invert it and deadlock against preparation. Reject before taking a lock
        // (also detects suspended transactions on a different coroutine context).
        try {
            check(!genesisRoomTransactionActive()&&!db.inTransaction())
        } catch (_: IllegalStateException) {
            throw AuthApiError("E2EE_LEGACY_TRANSACTION_IO_FORBIDDEN")
        }
        NativeLegacyOperationPermit.current()?.let { permit ->
            return permit.borrowTransport(db,scope,assertCurrent,operation)
        }
        return runBlocking {
            LegacyScopeLocks.mutex(db, scope).withLock {
                assertCurrent()
                if (db.dao().legacyScopeFence(scope) != null)
                    throw AuthApiError("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN")
                assertCurrent()
                operation().also { assertCurrent() }
            }
        }
    }
}
