package ru.genesis.calendar.data

import kotlinx.coroutines.asContextElement
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import ru.genesis.calendar.auth.AuthApiError

/** One owner operation may cross the local WebView bridge several times. Its
 * mutex belongs to this opaque native capability, not a JS/thread-local boolean.
 * Borrowed HTTP must not reacquire the mutex behind a waiting migration. */
internal class NativeLegacyOperationPermit private constructor(
    private val identity: String, private val mutex: Mutex, private val lockOwner: Any,
    private val assertCurrent: () -> Unit
) : AutoCloseable {
    private val monitor=Any()
    private var open=true
    private var pending=0
    private var released=false
    companion object {
        private val context=ThreadLocal<NativeLegacyOperationPermit?>()
        fun current()=context.get()
        suspend fun <T> run(db:GenesisDatabase,scope:String,assertCurrent:()->Unit,operation:suspend ()->T):T {
            val existing=current()
            if(existing!=null) {
                existing.bound(db,scope);assertCurrent()
                return existing.borrow { operation().also { assertCurrent() } }
            }
            val permit=acquire(db,scope,assertCurrent)
            try { return permit.borrow(operation) } finally { permit.finish() }
        }
        suspend fun acquire(db: GenesisDatabase, scope: String, assertCurrent: () -> Unit): NativeLegacyOperationPermit {
            require(scope.matches(Regex("account-[a-f0-9]{32}"))) { "E2EE_SCOPE_BINDING_MISMATCH" }
            if(current()!=null)throw AuthApiError("E2EE_NESTED_LEGACY_OPERATION")
            try { check(!genesisRoomTransactionActive()&&!db.inTransaction()) }
            catch(_: IllegalStateException) { throw AuthApiError("E2EE_LEGACY_TRANSACTION_IO_FORBIDDEN") }
            val mutex=LegacyScopeLocks.mutex(db,scope);val owner=Any()
            assertCurrent();mutex.lock(owner)
            try {
                assertCurrent()
                if(db.dao().legacyScopeFence(scope)!=null)throw AuthApiError("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN")
                assertCurrent()
                return NativeLegacyOperationPermit(LegacyScopeLocks.identity(db,scope),mutex,owner,assertCurrent)
            } catch(error: Throwable) { mutex.unlock(owner);throw error }
        }
    }
    private fun bound(db:GenesisDatabase,scope:String) {
        if(identity!=LegacyScopeLocks.identity(db,scope))throw AuthApiError("E2EE_INVALID_LEGACY_OPERATION")
    }
    fun check() {
        synchronized(monitor) { if(!open)throw AuthApiError("E2EE_INVALID_LEGACY_OPERATION") }
        assertCurrent()
    }
    private fun enter() {
        synchronized(monitor) { if(!open)throw AuthApiError("E2EE_INVALID_LEGACY_OPERATION");pending++ }
        try { check() } catch(error: Throwable) { leave();throw error }
    }
    private fun leave() {
        val unlock=synchronized(monitor) {
            check(pending>0);pending--
            if(!open && pending==0 && !released) { released=true;true } else false
        }
        if(unlock)mutex.unlock(lockOwner)
    }
    suspend fun <T> borrow(operation: suspend () -> T): T {
        enter()
        try { return withContext(context.asContextElement(this)) { check();operation().also { check() } } }
        finally { leave() }
    }
    fun <T> borrowTransport(db: GenesisDatabase, scope: String, current: () -> Unit, operation: () -> T): T {
        bound(db,scope)
        enter()
        try { current();return operation().also { check();current() } }
        finally { leave() }
    }
    /** Invalidate first, then drain actual native work. A destroyed/failed JS
     * callback cannot release the mutex while an old response is still arriving. */
    fun finish() {
        if(invalidate())throw AuthApiError("E2EE_UNAWAITED_LEGACY_OPERATION")
    }
    private fun invalidate():Boolean {
        val (unlock,unawaited)=synchronized(monitor) {
            open=false
            val unlock=if(pending==0 && !released) { released=true;true } else false
            unlock to (pending>0)
        }
        if(unlock)mutex.unlock(lockOwner)
        return unawaited
    }
    override fun close() { invalidate() }
    override fun toString()="NativeLegacyOperationPermit([redacted])"
}
