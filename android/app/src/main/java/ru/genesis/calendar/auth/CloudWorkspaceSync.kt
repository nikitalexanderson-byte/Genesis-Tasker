package ru.genesis.calendar.auth

import androidx.room.withTransaction
import java.time.Instant
import java.time.LocalDate
import org.json.JSONObject
import org.json.JSONArray
import ru.genesis.calendar.data.CloudAccountImporter
import ru.genesis.calendar.data.DocumentRecord
import ru.genesis.calendar.data.GenesisDatabase
import ru.genesis.calendar.data.HabitDocument
import ru.genesis.calendar.data.LocalCipher
import ru.genesis.calendar.data.TrackersDocument
import ru.genesis.calendar.data.WorkspaceStructureCodec
import ru.genesis.calendar.security.WorkspaceCipher
import ru.genesis.calendar.domain.habits.HabitMeasurements
import ru.genesis.calendar.domain.habits.HabitHistory
import ru.genesis.calendar.domain.habits.HeroProgress

internal interface CloudWorkspaceTransport {
    fun get(): JSONObject
    fun put(body: JSONObject): JSONObject
    fun habitReminderConsent(): Boolean = false
}

/** Encrypts a three-way merge with CAS; unrelated website sections are never replaced by native defaults. */
internal class CloudWorkspaceSync(private val db: GenesisDatabase, private val transport: CloudWorkspaceTransport) {
    private val documentKinds = setOf("workspace-structure", "habits", "trackers")

    suspend fun flush(scope: String,
        conflictPolicy: WorkspacePatch.ConflictPolicy = WorkspacePatch.ConflictPolicy.STOP,
        expectedConflictFingerprint: String? = null): Int {
        require(scope.startsWith("account-") && scope.length == 40)
        val dao = db.dao()
        val cipher = LocalCipher()
        val pending = dao.outbox(scope).filter { it.entityId in documentKinds }
        if (pending.isEmpty()) return 0
        val baseRow = dao.document(scope, "cloud-base")
        val base = baseRow?.let { JSONObject(cipher.decrypt(it.encrypted, "$scope/cloud-base")) }
            ?: WorkspacePatch.emptyDocument()
        val structure = dao.document(scope, "structure")?.let { JSONObject(cipher.decrypt(it.encrypted, "$scope/structure")) }
        val habits = dao.document(scope, "habits")?.let { JSONObject(cipher.decrypt(it.encrypted, "$scope/habits")) }
        val trackers = dao.document(scope, "trackers")?.let { JSONObject(cipher.decrypt(it.encrypted, "$scope/trackers")) }
        val local = WorkspacePatch.localDocument(base, structure, habits, trackers)
        val timestamp = Instant.now().toString()
        val deviceId = "android-native"
        // Failure to read optional notification state cannot prevent a personal encrypted save.
        val reminderConsent = runCatching { transport.habitReminderConsent() }.getOrDefault(false)
        repeat(3) { attempt ->
            val remote = readRemote(transport.get())
            try {
                require(baseRow == null || remote.version >= baseRow.revision) {
                    "Remote workspace version moved backwards"
                }
                val conflicts = mutableListOf<WorkspaceConflictField>()
                val dirty = pending.map { it.entityId }.toSet()
                val inspected = WorkspacePatch.apply(base, local, remote.document, dirty, remote.version, timestamp, deviceId,
                    WorkspacePatch.ConflictPolicy.STOP, conflicts)
                val patch = if (conflicts.isEmpty()) inspected else {
                    val preview = WorkspaceConflictPreview.create(conflicts)
                    if (conflictPolicy == WorkspacePatch.ConflictPolicy.STOP || preview.fingerprint != expectedConflictFingerprint)
                        throw WorkspacePatch.Conflict(preview.fields.first().path, preview)
                    WorkspacePatch.apply(base, local, remote.document, dirty, remote.version, timestamp, deviceId, conflictPolicy)
                }
                val document = projectMeasurements(patch.document,timestamp)
                val changed = patch.changed || document.toString() != patch.document.toString()
                val version = if (!changed) remote.version else {
                    val requiredProtocol=minimumWriterProtocol(document)
                    // A preview must keep new fields local until the server supports their writer protocol.
                    require(requiredProtocol<=remote.supportedWriterProtocol) { "WORKSPACE_UPGRADE_REQUIRED" }
                    val encrypted = WorkspaceCipher.encrypt(document.toString().toByteArray(), remote.key)
                    val request = JSONObject().put("ciphertext", encrypted.ciphertext)
                        .put("iv", encrypted.iv).put("expectedVersion", remote.version)
                        .put("writerProtocol",minOf(9,remote.supportedWriterProtocol)).put("minimumWriterProtocol",requiredProtocol)
                    val quotaHabits=HabitDocument.decode(CloudAccountImporter.habitsDocument(document),remote.version)
                    request.put("quotaUsage",JSONObject()
                        .put("personal-projects",JSONArray((0 until (document.optJSONArray("projects")?.length() ?: 0)).map { document.getJSONArray("projects").getJSONObject(it).getString("id") }))
                        .put("habits",JSONArray(quotaHabits.habits.filter { ru.genesis.calendar.domain.habits.HabitLifecycle.state(it).status!="deleted" }.map { it.id })))
                    if(reminderConsent)runCatching {
                        val habits=HabitDocument.decode(CloudAccountImporter.habitsDocument(document),remote.version)
                        request.put("habitReminderPlan",ru.genesis.calendar.reminders.habitReminderProjection(habits))
                    }
                    val response = transport.put(request)
                    val saved = response.getJSONObject("workspace")
                    saved.getLong("version").also { require(it == remote.version + 1) }
                }
                return cacheConfirmed(scope, document, version, pending, cipher)
            } catch (error: AuthFailure) {
                if (error.kind != AuthFailure.Kind.CONFLICT || attempt == 2) throw error
            } finally { remote.key.fill(0) }
        }
        error("Workspace CAS retry exhausted")
    }

    private fun minimumWriterProtocol(document: JSONObject): Int {
        val automaticHabits=document.optJSONArray("habits")
        if ((0 until (automaticHabits?.length() ?: 0)).any { !automaticHabits!!.getJSONObject(it).isNull("timerPreferences") }) return 9
        if (!document.optJSONObject("userProgress").let { it == null || it.isNull("grossLifetimeXp") }
            || (0 until (automaticHabits?.length() ?: 0)).any { index -> automaticHabits!!.getJSONObject(index).let { habit ->
                !habit.isNull("autoDeletePolicy") || habit.optJSONArray("lifecycleHistory")?.let { rows ->
                    (0 until rows.length()).any { rows.getJSONObject(it).has("automaticPoints") || rows.getJSONObject(it).optString("id").startsWith("habit-auto-delete:") }
                } == true } }) return 8
        val decisions=document.optJSONArray("habitHistory")
        val completions=document.optJSONArray("habitCompletions")
        if ((0 until (decisions?.length() ?: 0)).any { decisions!!.getJSONObject(it).optString("source")=="decision" }
            || (0 until (completions?.length() ?: 0)).any { !completions!!.getJSONObject(it).isNull("skippedAt") }) return 7
        val lifecycleHabits=document.optJSONArray("habits")
        if ((0 until (lifecycleHabits?.length() ?: 0)).any { (lifecycleHabits!!.getJSONObject(it).optJSONArray("lifecycleHistory")?.length() ?: 0)>0 }) return 7
        if ((document.optJSONArray("habitHistory")?.length() ?: 0) > 0) return 6
        if ((document.optJSONArray("habitTimers")?.length() ?: 0) > 0 || ru.genesis.calendar.data.HabitTimerCodec.epoch(document, "habitTimerEpoch").isNotEmpty()) return 5
        val habits=document.optJSONArray("habits")
        if ((0 until (habits?.length() ?: 0)).any { index -> habits!!.getJSONObject(index).optJSONArray("ruleHistory")?.let { rules ->
            (0 until rules.length()).any { rules.getJSONObject(it).let { rule -> rule.has("supersedes") || rule.has("selectedRuleId") } }
        } == true }) return 4
        if ((0 until (habits?.length() ?: 0)).any { index -> habits!!.getJSONObject(index).let { habit ->
            habit.optJSONObject("periodGoal") != null || habit.optJSONArray("ruleHistory")?.let { rules ->
                (0 until rules.length()).any { rules.getJSONObject(it).optJSONObject("periodGoal") != null }
            } == true } }) return 3
        return if((document.optJSONArray("habitMeasurements")?.length() ?: 0)>0 ||
            (0 until (habits?.length() ?: 0)).any { index -> habits!!.getJSONObject(index).let {
                it.optJSONObject("measurement")!=null || (it.optJSONArray("ruleHistory")?.length() ?: 0)>0 } }) 2 else 1
    }

    private fun projectMeasurements(document: JSONObject,timestamp: String): JSONObject {
        if((document.optJSONArray("habitMeasurements")?.length() ?: 0)==0 && (document.optJSONArray("habitHistory")?.length() ?: 0)==0 && minimumWriterProtocol(document)<8) return document
        val local=HabitDocument.decode(CloudAccountImporter.habitsDocument(document),0)
        val completions=HabitHistory.project(local.habits,local.history,
            HabitMeasurements.project(local.habits,local.measurements,local.completions,LocalDate.now(),timestamp),local.measurements)
        val updated=ru.genesis.calendar.data.HabitAutoDeleteWorkspace.reconcilePoints(ru.genesis.calendar.data.HabitAutoDeleteWorkspace.reconcileEvidence(local.copy(completions=completions,progress=HeroProgress.reconcile(local.progress,ru.genesis.calendar.domain.habits.habitCompletionCredits(completions),timestamp))))
        val encoded=JSONObject(HabitDocument.encode(updated))
        val originalHabits=document.getJSONArray("habits")
        val projectedHabits=org.json.JSONArray((0 until originalHabits.length()).map { index ->
            val original=originalHabits.getJSONObject(index)
            val habit=updated.habits.first { it.id==original.getString("id") }
            JSONObject(original.toString()).put("active",habit.active).put("lifecycleHistory",ru.genesis.calendar.data.HabitLifecycleCodec.encode(habit.lifecycleHistory))
        })
        return JSONObject(document.toString()).put("habitCompletions",encoded.getJSONArray("completions"))
            .put("habits",projectedHabits)
            .put("userProgress",encoded.getJSONObject("progress"))
    }

    private data class Remote(val version: Long, val document: JSONObject, val key: ByteArray, val supportedWriterProtocol: Int)

    private fun readRemote(response: JSONObject): Remote {
        val workspace = response.getJSONObject("workspace")
        val supported=workspace.optInt("supportedWriterProtocol",7).coerceIn(1,9)
        if (workspace.getString("keyMode") != "account") throw CloudWorkspacePreview.RecoveryRequired()
        val key = WorkspaceCipher.decodeKey(workspace.getString("key"))
        try {
            if (workspace.isNull("envelope")) return Remote(0, WorkspacePatch.emptyDocument(), key,supported)
            val envelope = workspace.getJSONObject("envelope")
            val version = envelope.getLong("version")
            require(version > 0)
            val plain = WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(envelope.getString("ciphertext"),
                envelope.getString("iv")), key)
            val document = try { CloudWorkspaceMigration.normalize(JSONObject(plain.toString(Charsets.UTF_8))) }
                finally { plain.fill(0) }
            return Remote(version, document, key,supported)
        } catch (error: Exception) {
            key.fill(0)
            throw error
        }
    }

    private suspend fun cacheConfirmed(scope: String, document: JSONObject, version: Long,
        pending: List<ru.genesis.calendar.data.OutboxRecord>, cipher: LocalCipher): Int {
        val dao = db.dao()
        val fragments = mapOf(
            "workspace-structure" to ("structure" to CloudAccountImporter.structureDocument(document)),
            "habits" to ("habits" to CloudAccountImporter.habitsDocument(document)),
            "trackers" to ("trackers" to CloudAccountImporter.trackersDocument(document)),
        )
        WorkspaceStructureCodec.decode(fragments.getValue("workspace-structure").second)
        HabitDocument.decode(fragments.getValue("habits").second, version)
        TrackersDocument.decode(fragments.getValue("trackers").second, version)
        return db.withTransaction {
            var acknowledged = 0
            pending.forEach { entry ->
                acknowledged += dao.acknowledgeOutbox(scope, entry.entityId, entry.revision, entry.operationId)
            }
            dao.putDocument(DocumentRecord(scope, "cloud-base", cipher.encrypt(document.toString(), "$scope/cloud-base"), version))
            val stillPending = dao.outbox(scope).map { it.entityId }.toSet()
            fragments.forEach { (outboxId, pair) ->
                if (outboxId !in stillPending) {
                    val (kind, raw) = pair
                    val previous = dao.document(scope, kind)
                    dao.putDocument(DocumentRecord(scope, kind, cipher.encrypt(raw, "$scope/$kind"),
                        maxOf(version, previous?.revision ?: 0)))
                }
            }
            acknowledged
        }
    }
}
