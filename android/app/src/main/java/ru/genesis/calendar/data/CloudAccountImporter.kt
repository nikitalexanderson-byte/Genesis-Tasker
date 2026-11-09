package ru.genesis.calendar.data

import androidx.room.withTransaction
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONException
import java.time.DateTimeException
import ru.genesis.calendar.auth.CloudAccountSnapshot
import ru.genesis.calendar.reminders.ReminderScheduler

/** Pulls verified server data into an account-only encrypted cache; never touches isolated drafts. */
internal class CloudAccountImporter(private val db: GenesisDatabase, private val scheduler: ReminderScheduler? = null) {
    enum class Result { IMPORTED, IMPORTED_WITH_GOOGLE_WARNING, IMPORTED_WITH_TASK_WARNING, PENDING_LOCAL_CHANGES }

    private data class ImportedTask(val record: TaskRecord, val reminders: List<Pair<String, Long>>)

    companion object {
        fun structureDocument(document: JSONObject): String = JSONObject()
            .put("projects", document.getJSONArray("projects"))
            .put("categories", document.getJSONArray("categories"))
            .put("taskListLinks", document.getJSONArray("taskListLinks"))
            .put("taskLists", document.optJSONArray("taskLists") ?: JSONArray()).toString()

        fun habitsDocument(document: JSONObject): String = JSONObject().put("localSchema", 1)
            .put("habits", document.getJSONArray("habits"))
            .put("completions", document.getJSONArray("habitCompletions"))
            .put("measurements", if(document.isNull("habitMeasurements")) JSONArray() else document.getJSONArray("habitMeasurements"))
            .put("timers", if(document.isNull("habitTimers")) JSONArray() else document.getJSONArray("habitTimers"))
            .put("history", document.optJSONArray("habitHistory") ?: JSONArray())
            .put("timerEpoch", if(document.isNull("habitTimerEpoch")) "" else document.getString("habitTimerEpoch"))
            .put("goals", document.getJSONArray("dailyGoalRecords"))
            .put("rewards", document.getJSONArray("rewardTransactions"))
            .put("achievementUnlocks", document.optJSONArray("achievementUnlocks") ?: JSONArray())
            .put("streakFreezeTransactions", document.optJSONArray("streakFreezeTransactions") ?: JSONArray())
            .put("quests", document.optJSONArray("quests") ?: JSONArray())
            .put("settings", document.optJSONObject("habitSettings") ?: JSONObject())
            .put("hiddenDefaultTemplates", document.optJSONArray("hiddenDefaultTemplates") ?: JSONArray())
            .put("progress", document.getJSONObject("userProgress")).toString()

        fun trackersDocument(document: JSONObject): String = JSONObject().put("localSchema", 1)
            .put("sleepPlans", document.getJSONArray("sleepPlans"))
            .put("sleepEntries", document.getJSONArray("sleepEntries"))
            .put("moodEntries", document.getJSONArray("moodEntries"))
            .put("addictionTrackers", document.optJSONArray("addictionTrackers") ?: JSONArray())
            .put("addictionEntries", document.optJSONArray("addictionEntries") ?: JSONArray()).toString()
    }

    suspend fun import(snapshot: CloudAccountSnapshot): Result {
        val scope = snapshot.scope
        val mutation=ru.genesis.calendar.auth.NativeBackupMutationGuard(scope)
        require(scope.startsWith("account-") && scope.length == 40)
        val cipher = LocalCipher()
        val document = snapshot.document
        val structure = document?.let(::structureDocument) ?: WorkspaceStructureCodec.encode(WorkspaceStructure())
        WorkspaceStructureCodec.decode(structure)
        val habits = document?.let(::habitsDocument)
        if (habits != null) HabitDocument.decode(habits, snapshot.version)
        val trackers = document?.let(::trackersDocument)
        if (trackers != null) TrackersDocument.decode(trackers, snapshot.version)
        var unreadable = snapshot.unreadableTaskCount
        val seenIds = mutableSetOf<String>()
        val tasks = snapshot.tasks.mapNotNull { source ->
            val decoded = try {
                val value = CloudAccountSnapshot.nativeTaskJson(source)
                val id = value.getString("id")
                require(seenIds.add(id))
                val revision = value.optLong("updatedAt", 1).coerceAtLeast(1)
                val json = value.toString()
                val record = TaskRecord(scope, id, "", revision, value.optBoolean("done"))
                Triple(record, json, TaskReminderPlan.times(LocalTask.from(record, json)))
            } catch (_: JSONException) { unreadable++; null }
              catch (_: IllegalArgumentException) { unreadable++; null }
              catch (_: DateTimeException) { unreadable++; null }
            decoded?.let { (record, json, reminders) ->
                // Storage/Keystore failures still abort the transaction. They are
                // not malformed remote rows and must never be silently ignored.
                ImportedTask(record.copy(encrypted = cipher.encrypt(json, "$scope/${record.id}")), reminders)
            }
        }
        val dao = db.dao()
        val previousReminders = dao.reminders(scope)
        val changedTaskIds = mutableSetOf<String>()
        val update: suspend () -> Result = { db.withTransaction {
            mutation.check()
            val pending = dao.outbox(scope).map { it.entityId }.toSet()
            val cached = dao.document(scope, "cloud-base")
            val staleWorkspace = cached != null && cached.revision > snapshot.version
            if (!snapshot.tasksDeferred) {
                val remoteIds = tasks.map { it.record.id }.toSet()
                if (!snapshot.googleSyncWarning && unreadable == 0) dao.accountTasks(scope).filter {
                    it.id !in remoteIds && it.id !in pending
                }.forEach {
                    dao.deleteCachedTask(scope, it.id)
                    dao.deleteTaskReminders(scope, it.id)
                    changedTaskIds += it.id
                }
                tasks.forEach { (record, reminders) ->
                    // A partial response can add confirmed rows, but cannot erase or
                    // replace a cached task. Local edits and deletion tombstones win.
                    val cachedTask = dao.task(scope, record.id)
                    if (record.id !in pending && cachedTask?.deleted != true &&
                        (!snapshot.googleSyncWarning || cachedTask == null)) {
                        dao.putTask(record)
                        dao.deleteTaskReminders(scope, record.id)
                        changedTaskIds += record.id
                        reminders.forEach { (occurrence, at) ->
                            dao.putReminder(ReminderRecord(scope, record.id + ":" + occurrence, record.id,
                                occurrence.substringBefore(':'), record.revision, at))
                        }
                    }
                }
            }
            if (!staleWorkspace) {
                if ("workspace-structure" !in pending)
                    dao.putDocument(DocumentRecord(scope, "structure", cipher.encrypt(structure, "$scope/structure"), snapshot.version))
                if (document != null) {
                    if (snapshot.authProvider != "google" && document.optJSONArray("taskLists") != null && "workspace-structure" !in pending) {
                        val listRows = document.getJSONArray("taskLists")
                        val validLists = (0 until listRows.length()).map { GoogleTaskList.from(listRows.getJSONObject(it)) }
                        val listDocument = JSONArray().apply { validLists.forEach { put(it.json()) } }.toString()
                        dao.putDocument(DocumentRecord(scope, "task-lists", cipher.encrypt(listDocument, "$scope/task-lists"), snapshot.version))
                    }
                    // Keep the original three-way-merge base while a document has local edits.
                    if (pending.none { it in setOf("workspace-structure", "habits", "trackers") })
                        dao.putDocument(DocumentRecord(scope, "cloud-base", cipher.encrypt(document.toString(), "$scope/cloud-base"), snapshot.version))
                    if ("habits" !in pending)
                        dao.putDocument(DocumentRecord(scope, "habits", cipher.encrypt(requireNotNull(habits), "$scope/habits"), snapshot.version))
                    if ("trackers" !in pending)
                        dao.putDocument(DocumentRecord(scope, "trackers", cipher.encrypt(requireNotNull(trackers), "$scope/trackers"), snapshot.version))
                }
            }
            if (unreadable > 0) Result.IMPORTED_WITH_TASK_WARNING
            else if (pending.isNotEmpty() || staleWorkspace) Result.PENDING_LOCAL_CHANGES
            else if (snapshot.googleSyncWarning) Result.IMPORTED_WITH_GOOGLE_WARNING else Result.IMPORTED
        } }
        val result = if (scheduler == null) update() else scheduler.withMutation {
            update().also { previousReminders.filter { it.taskId in changedTaskIds }.forEach(scheduler::cancel) }
        }
        return result
    }
}
