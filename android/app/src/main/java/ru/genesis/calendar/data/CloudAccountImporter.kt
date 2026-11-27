package ru.genesis.calendar.data

import ru.genesis.calendar.data.withTransaction
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONException
import java.time.DateTimeException
import java.security.MessageDigest
import java.util.Base64
import ru.genesis.calendar.auth.CloudAccountSnapshot
import ru.genesis.calendar.reminders.ReminderScheduler

/** Pulls verified server data into an account-only encrypted cache; never touches isolated drafts. */
internal class CloudAccountImporter(private val db: GenesisDatabase, private val scheduler: ReminderScheduler? = null) {
    enum class Result { IMPORTED, IMPORTED_WITH_GOOGLE_WARNING, IMPORTED_WITH_TASK_WARNING, PENDING_LOCAL_CHANGES }

    private data class ImportedTask(val record: TaskRecord, val json: String, val reminders: List<Pair<String, Long>>)

    // Remember only fingerprints in RAM. A local edit, a restored database or a different
    // remote body invalidates the proof even when Google reuses the task's timestamp.
    private val verifiedBodies = android.util.LruCache<String, String>(2048)
    private fun fingerprint(encrypted: String, json: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(encrypted.toByteArray(Charsets.US_ASCII))
        digest.update(0.toByte())
        return Base64.getEncoder().encodeToString(digest.digest(json.toByteArray(Charsets.UTF_8)))
    }

    private fun matchesBody(encrypted: String, json: String, cipher: LocalCipher, context: String): Boolean {
        val proof = fingerprint(encrypted, json)
        if (verifiedBodies.get(context) == proof) return true
        val decoded = try { cipher.decrypt(encrypted, context) }
            catch (_: IllegalArgumentException) { return false }
            catch (_: javax.crypto.AEADBadTagException) { return false }
        if (decoded != json) return false
        verifiedBodies.put(context, proof)
        return true
    }

    private suspend fun cacheDocument(scope: String, kind: String, json: String, revision: Long, cipher: LocalCipher) {
        val context = "$scope/$kind"
        val existing = db.dao().document(scope, kind)
        if (existing != null && matchesBody(existing.encrypted, json, cipher, context)) {
            if (existing.revision != revision) db.dao().putDocument(existing.copy(revision = revision))
            return
        }
        val encrypted = cipher.encrypt(json, context)
        db.dao().putDocument(DocumentRecord(scope, kind, encrypted, revision))
        verifiedBodies.put(context, fingerprint(encrypted, json))
    }

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

    suspend fun import(snapshot: CloudAccountSnapshot,assertCurrent:()->Unit={}):Result {
        val current={ru.genesis.calendar.security.UpdateGate.requireOpen();assertCurrent()}
        return if(scheduler==null)NativeLegacyOperationPermit.run(db,snapshot.scope,current){importLocked(snapshot,current)}
            else scheduler.withIncomingAccountMutation(snapshot.scope,current){importLocked(snapshot,current)}
    }
    private suspend fun importLocked(snapshot: CloudAccountSnapshot,assertCurrent:()->Unit): Result {
        assertCurrent()
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
            try {
                val value = CloudAccountSnapshot.nativeTaskJson(source)
                val id = value.getString("id")
                require(seenIds.add(id))
                val revision = value.optLong("updatedAt", 1).coerceAtLeast(1)
                val json = value.toString()
                val record = TaskRecord(scope, id, "", revision, value.optBoolean("done"))
                ImportedTask(record, json, TaskReminderPlan.times(LocalTask.from(record, json)))
            } catch (_: JSONException) { unreadable++; null }
              catch (_: IllegalArgumentException) { unreadable++; null }
              catch (_: DateTimeException) { unreadable++; null }
        }
        val dao = db.dao()
        val previousReminders = dao.reminders(scope)
        val existingReminderIds = previousReminders.mapTo(hashSetOf()) { it.id }
        val changedTaskIds = mutableSetOf<String>()
        val update: suspend () -> Result = { db.withTransaction {
            mutation.check();assertCurrent()
            val pending = dao.outbox(scope).map { it.entityId }.toSet()
            val cached = dao.document(scope, "cloud-base")
            val staleWorkspace = cached != null && cached.revision > snapshot.version
            if (!snapshot.tasksDeferred) {
                val remoteIds = tasks.map { it.record.id }.toSet()
                val fullList = !snapshot.googleSyncWarning && unreadable == 0
                val existingTasks = if (fullList) dao.backupTasks(scope).associateBy { it.id } else null
                existingTasks?.values?.filter {
                    !it.deleted && it.id !in remoteIds && it.id !in pending
                }?.forEach {
                    dao.deleteCachedTask(scope, it.id)
                    dao.deleteTaskReminders(scope, it.id)
                    changedTaskIds += it.id
                }
                tasks.forEach { (record, json, reminders) ->
                    // A partial response can add confirmed rows, but cannot erase or
                    // replace a cached task. Local edits and deletion tombstones win.
                    val cachedTask = if (existingTasks != null) existingTasks[record.id] else dao.task(scope, record.id)
                    if (record.id !in pending && cachedTask?.deleted != true &&
                        (!snapshot.googleSyncWarning || cachedTask == null)) {
                        val context = "$scope/${record.id}"
                        val unchanged = cachedTask != null && cachedTask.revision == record.revision &&
                            cachedTask.done == record.done && matchesBody(cachedTask.encrypted, json, cipher, context)
                        if (!unchanged) {
                            val encrypted = cipher.encrypt(json, context)
                            dao.putTask(record.copy(encrypted = encrypted))
                            verifiedBodies.put(context, fingerprint(encrypted, json))
                            dao.deleteTaskReminders(scope, record.id)
                            changedTaskIds += record.id
                        }
                        reminders.forEach { (occurrence, at) ->
                            val reminderId = record.id + ":" + occurrence
                            if (!unchanged || reminderId !in existingReminderIds) {
                                dao.putReminder(ReminderRecord(scope, reminderId, record.id,
                                    occurrence.substringBefore(':'), record.revision, at))
                            }
                        }
                    }
                }
            }
            if (!staleWorkspace) {
                if ("workspace-structure" !in pending)
                    cacheDocument(scope, "structure", structure, snapshot.version, cipher)
                if (document != null) {
                    if (snapshot.authProvider != "google" && document.optJSONArray("taskLists") != null && "workspace-structure" !in pending) {
                        val listRows = document.getJSONArray("taskLists")
                        val validLists = (0 until listRows.length()).map { GoogleTaskList.from(listRows.getJSONObject(it)) }
                        val listDocument = JSONArray().apply { validLists.forEach { put(it.json()) } }.toString()
                        cacheDocument(scope, "task-lists", listDocument, snapshot.version, cipher)
                    }
                    // Keep the original three-way-merge base while a document has local edits.
                    if (pending.none { it in setOf("workspace-structure", "habits", "trackers") })
                        cacheDocument(scope, "cloud-base", document.toString(), snapshot.version, cipher)
                    if ("habits" !in pending)
                        cacheDocument(scope, "habits", requireNotNull(habits), snapshot.version, cipher)
                    if ("trackers" !in pending)
                        cacheDocument(scope, "trackers", requireNotNull(trackers), snapshot.version, cipher)
                }
            }
            assertCurrent()
            if (unreadable > 0) Result.IMPORTED_WITH_TASK_WARNING
            else if (pending.isNotEmpty() || staleWorkspace) Result.PENDING_LOCAL_CHANGES
            else if (snapshot.googleSyncWarning) Result.IMPORTED_WITH_GOOGLE_WARNING else Result.IMPORTED
        } }
        val result = update().also {assertCurrent();if(scheduler!=null)previousReminders.filter { it.taskId in changedTaskIds }.forEach(scheduler::cancel)}
        return result
    }
}
