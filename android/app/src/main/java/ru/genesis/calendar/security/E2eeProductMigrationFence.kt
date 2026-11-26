package ru.genesis.calendar.security

/** Product finalization is deliberately separate from the coordinator's write
 * exclusion. A shared cancellation must keep the active personal deny fence. */
internal interface E2eeProductMigrationFence:E2eeMigrationFence{
    suspend fun token():String?
    suspend fun activate(directory:E2eeDirectory.Verified)
    suspend fun releaseCancelled(token:String,directory:E2eeDirectory.Verified,currentStatus:()->E2eeMigration.Status?)
}
