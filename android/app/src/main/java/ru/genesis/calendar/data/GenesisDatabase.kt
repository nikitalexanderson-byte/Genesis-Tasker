package ru.genesis.calendar.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "tasks", primaryKeys = ["scope", "id"])
data class TaskRecord(val scope: String, val id: String, val encrypted: String,
    val revision: Long, val done: Boolean, val deleted: Boolean = false)

@Entity(tableName = "reminders", primaryKeys = ["scope", "id"], indices = [Index("taskId")])
data class ReminderRecord(val scope: String, val id: String, val taskId: String,
    val occurrenceId: String, val revision: Long, val at: Long, val state: String = "pending",
    val deliveredAt: Long? = null)

@Entity(tableName = "outbox", primaryKeys = ["scope", "entityId"])
data class OutboxRecord(val scope: String, val entityId: String, val revision: Long,
    val operationId: String, val state: String = "local")

@Entity(tableName = "documents", primaryKeys = ["scope", "kind"])
data class DocumentRecord(val scope: String, val kind: String, val encrypted: String, val revision: Long)

/** Technical deny state, never imported from a content archive. */
@Entity(tableName = "e2ee_legacy_fences", primaryKeys = ["scope"])
data class LegacyScopeFenceRecord(val scope: String, val ownerId: String, val remoteScopeId: String, val phase: String, val token: String) {
    override fun toString() = "LegacyScopeFenceRecord([redacted])"
}

@Dao
interface GenesisDao {
    @Query("SELECT * FROM e2ee_legacy_fences WHERE scope=:scope")
    suspend fun legacyScopeFence(scope: String): LegacyScopeFenceRecord?
    @Insert suspend fun insertLegacyScopeFence(record: LegacyScopeFenceRecord)
    @Query("UPDATE e2ee_legacy_fences SET phase='active' WHERE scope=:scope AND token=:token AND phase='preparing'")
    suspend fun activateLegacyScopeFence(scope: String, token: String): Int
    @Query("DELETE FROM e2ee_legacy_fences WHERE scope=:scope AND token=:token AND phase='preparing'")
    suspend fun cancelLegacyScopeFence(scope: String, token: String): Int
    @Query("SELECT * FROM documents WHERE scope=:scope")
    suspend fun backupDocuments(scope: String): List<DocumentRecord>
    @Query("SELECT kind FROM documents WHERE scope=:scope ORDER BY kind")
    suspend fun documentKinds(scope: String): List<String>
    @Query("DELETE FROM outbox WHERE scope=:scope")
    suspend fun clearBackupHeldOutbox(scope: String)
    @Query("SELECT * FROM tasks WHERE scope=:scope")
    suspend fun backupTasks(scope: String): List<TaskRecord>
    @Query("SELECT * FROM documents WHERE scope=:scope AND kind=:kind")
    fun observeDocument(scope: String, kind: String): Flow<DocumentRecord?>
    @Query("SELECT * FROM documents WHERE scope=:scope AND kind=:kind")
    suspend fun document(scope: String, kind: String): DocumentRecord?
    @Upsert suspend fun putDocument(document: DocumentRecord)
    @Query("DELETE FROM documents WHERE scope=:scope AND kind=:kind")
    suspend fun deleteDocument(scope: String, kind: String)
    @Query("SELECT * FROM tasks WHERE scope=:scope AND deleted=0")
    fun observeTasks(scope: String): Flow<List<TaskRecord>>
    @Query("SELECT * FROM tasks WHERE scope=:scope AND id=:id")
    suspend fun task(scope: String, id: String): TaskRecord?
    @Query("DELETE FROM tasks WHERE scope=:scope")
    suspend fun clearAccountTaskCache(scope: String)
    @Query("DELETE FROM tasks WHERE scope=:scope AND id=:id")
    suspend fun deleteCachedTask(scope: String, id: String)
    @Query("DELETE FROM reminders WHERE scope=:scope AND taskId=:id")
    suspend fun deleteTaskReminders(scope: String, id: String)
    @Query("SELECT * FROM tasks WHERE scope=:scope AND deleted=0")
    suspend fun accountTasks(scope: String): List<TaskRecord>
    @Upsert suspend fun putTask(task: TaskRecord)
    @Upsert suspend fun putOutbox(operation: OutboxRecord)
    @Query("SELECT * FROM reminders WHERE scope=:scope")
    suspend fun reminders(scope: String): List<ReminderRecord>
    @Query("SELECT * FROM reminders WHERE scope=:scope AND id=:id")
    suspend fun reminder(scope: String, id: String): ReminderRecord?
    @Query("SELECT * FROM reminders WHERE scope=:scope AND taskId=:task")
    suspend fun taskReminders(scope: String, task: String): List<ReminderRecord>
    @Query("DELETE FROM reminders WHERE scope=:scope")
    suspend fun clearReminders(scope: String)
    @Upsert suspend fun putReminder(reminder: ReminderRecord)
    @Query("UPDATE reminders SET state='cancelled', revision=revision+1 WHERE scope=:scope AND taskId=:task")
    suspend fun cancelReminders(scope: String, task: String)
    @Query("UPDATE reminders SET state=:state, deliveredAt=:now WHERE scope=:scope AND id=:id AND revision=:revision AND state='pending'")
    suspend fun claimReminder(scope: String, id: String, revision: Long, state: String, now: Long): Int
    @Query("UPDATE reminders SET state='pending', deliveredAt=NULL WHERE scope=:scope AND id=:id AND revision=:revision AND state='delivered'")
    suspend fun releaseFailedReminder(scope: String, id: String, revision: Long): Int
    @Query("UPDATE reminders SET state='cancelled' WHERE scope=:scope AND id=:id AND revision=:revision AND state='delivered'")
    suspend fun closeDeliveredReminder(scope: String, id: String, revision: Long): Int
    @Query("SELECT * FROM outbox WHERE scope=:scope")
    suspend fun outbox(scope: String): List<OutboxRecord>
    @Query("SELECT * FROM outbox WHERE scope=:scope")
    fun observeOutbox(scope: String): Flow<List<OutboxRecord>>
    @Query("DELETE FROM outbox WHERE scope=:scope AND entityId=:entityId AND revision=:revision AND operationId=:operationId")
    suspend fun acknowledgeOutbox(scope: String, entityId: String, revision: Long, operationId: String): Int
}

@Database(entities = [TaskRecord::class, ReminderRecord::class, OutboxRecord::class, DocumentRecord::class, LegacyScopeFenceRecord::class],
    version = 2, exportSchema = true)
abstract class GenesisDatabase : RoomDatabase() {
    abstract fun dao(): GenesisDao
}
