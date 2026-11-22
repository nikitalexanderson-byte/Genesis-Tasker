package ru.genesis.calendar.data

import ru.genesis.calendar.security.E2eeDirectory
import ru.genesis.calendar.security.E2eeKeys
import ru.genesis.calendar.security.E2eeMigration
import ru.genesis.calendar.security.E2eeProductMigrationFence

/** Shared scopes borrow the irreversible account barrier; no child directory
 * is ever passed to the personal fence's activate/release methods. */
internal class NativeSharedMigrationFence(private val primary:NativeLegacyScopeFence,private val ownerId:String,
    private val scopeId:String,private val kind:String,private val resourceId:String,
    private val personal:()->E2eeDirectory.Verified,private val current:()->Unit):E2eeProductMigrationFence{
    init{listOf(ownerId,scopeId,resourceId).forEach{E2eeKeys.technical(it)};check(kind in setOf("space","project")){"E2EE_SCOPE_BINDING_MISMATCH"}}
    private fun boundDirectory(value:E2eeDirectory.Verified,state:String){
        check(value.ownerId==ownerId&&value.scopeId==scopeId&&value.kind==kind&&value.resourceId==resourceId&&value.state==state){"E2EE_SCOPE_BINDING_MISMATCH"}
    }
    private suspend fun <T> active(operation:suspend()->T):T{
        current();val frame=personal();current();check(frame.ownerId==ownerId&&frame.scopeId!=scopeId&&frame.kind=="personal"&&frame.resourceId==ownerId&&frame.state=="active"){"E2EE_PERSONAL_SCOPE_REQUIRED"}
        return primary.withActivePersonalFence(frame){current();operation().also{current()}}
    }
    override suspend fun <T> withFence(operation:suspend()->T):T=active(operation)
    override suspend fun token():String?=active{primary.token()?:error("E2EE_LOCAL_FENCE_REQUIRED")}
    override suspend fun activate(directory:E2eeDirectory.Verified){active{boundDirectory(directory,"active")}}
    override suspend fun releaseCancelled(token:String,directory:E2eeDirectory.Verified,currentStatus:()->E2eeMigration.Status?){active{
        boundDirectory(directory,"preparing");check(primary.token()==token){"E2EE_LOCAL_DOWNGRADE_FORBIDDEN"}
        val status=currentStatus();current();check(status?.phase=="cancelled"&&status.pendingAction==null&&!status.resuming){"E2EE_LOCAL_DOWNGRADE_FORBIDDEN"}
        // Deliberately no DELETE/UPDATE of the personal row or memory release.
    }}
    override fun toString()="NativeSharedMigrationFence([redacted])"
}
