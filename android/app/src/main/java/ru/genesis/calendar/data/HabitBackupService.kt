package ru.genesis.calendar.data

import androidx.room.withTransaction
import java.time.Instant
import java.util.UUID
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication

internal data class HabitRestoreDraft(val id: String, val filename: String, val preview: HabitRestorePreview,
    val choices: Map<String, String>, val stale: Boolean)

/** Scoped encrypted recovery. Chunking avoids Android's CursorWindow limit for portable files. */
internal class HabitBackupService(private val app: GenesisApplication, private val beforeCommit: () -> Unit = {}) {
    private val scope = app.workspaceScope
    private val db = app.database
    private val dao = db.dao()
    private val cipher = LocalCipher()
    private val draftKind = "habit-restore-draft"
    private val receiptKind = "habit-restore-receipt"
    private fun guard() = check(app.workspaceScope == scope) { "HABIT_RESTORE_STALE" }
    suspend fun requireDataExchange() { guard(); app.featureAccess(scope).requireDataExchange(); guard() }
    suspend fun export(format: String, label: (String) -> String = { it }): String {
        requireDataExchange()
        require(format in setOf("json", "csv"))
        val workspace = current()
        val result = if (format == "csv") HabitHistoryCsv.build(workspace, label = label) else HabitBackups.create(workspace).text()
        requireDataExchange()
        return result
    }
    private fun part(id: String, index: Int) = "habit-restore-part:$id:$index"
    private suspend fun read(kind: String): JSONObject? = dao.document(scope, kind)?.let { JSONObject(cipher.decrypt(it.encrypted, "$scope/$kind")) }
    private suspend fun write(kind: String, value: JSONObject) {
        val revision = (dao.document(scope, kind)?.revision ?: 0) + 1
        dao.putDocument(DocumentRecord(scope, kind, cipher.encrypt(value.toString(), "$scope/$kind"), revision))
    }
    suspend fun current(): LocalHabitWorkspace {
        guard()
        return dao.document(scope, "habits")?.let { HabitDocument.decode(cipher.decrypt(it.encrypted, "$scope/habits"), it.revision) } ?: LocalHabitWorkspace()
    }
    private suspend fun text(root: JSONObject): String = buildString {
        val count = root.getInt("parts"); require(count in 1..4096) { "HABIT_BACKUP_INVALID" }
        repeat(count) { index -> append(requireNotNull(read(part(root.getString("id"), index))).getString("text")) }
        require(length <= HabitBackups.MAX_BYTES) { "HABIT_BACKUP_TOO_LARGE" }
    }
    private fun choices(root: JSONObject): Map<String, String> = root.getJSONObject("choices").let { rows -> rows.keys().asSequence().associateWith { rows.getString(it) } }
    private suspend fun draft(root: JSONObject): HabitRestoreDraft {
        val preview = HabitBackupRestore.preview(current(), text(root))
        val original = root.getString("fingerprint")
        return HabitRestoreDraft(root.getString("id"), root.getString("filename"), preview.copy(fingerprint = original), choices(root), preview.fingerprint != original)
    }
    suspend fun load(): HabitRestoreDraft? = db.withTransaction { guard(); read(draftKind)?.let { draft(it) } }
    private suspend fun clear(root: JSONObject) {
        repeat(root.getInt("parts")) { dao.deleteDocument(scope, part(root.getString("id"), it)) }
        dao.deleteDocument(scope, draftKind)
    }
    suspend fun prepare(text: String, filename: String): HabitRestoreDraft {
        requireDataExchange(); HabitBackups.parse(text)
        return db.withTransaction {
            requireDataExchange()
            val preview = HabitBackupRestore.preview(current(), text)
            val id = UUID.randomUUID().toString(); var count = 0; var start = 0
            read(draftKind)?.let { clear(it) }
            while (start < text.length) {
                var end = minOf(start + 32_768, text.length)
                if (end < text.length && text[end - 1].isHighSurrogate()) end--
                write(part(id, count++), JSONObject().put("text", text.substring(start, end)))
                start = end
            }
            val root = JSONObject().put("id", id).put("filename", filename.take(250)).put("parts", count)
                .put("fingerprint", preview.fingerprint).put("choices", JSONObject())
            write(draftKind, root); guard()
            HabitRestoreDraft(id, filename.take(250), preview, emptyMap(), false)
        }
    }
    suspend fun choose(id: String, habitId: String, choice: String): HabitRestoreDraft = db.withTransaction {
        requireDataExchange(); require(choice in setOf("keep", "copy"))
        val root = requireNotNull(read(draftKind)); require(root.getString("id") == id) { "HABIT_RESTORE_STALE" }
        val value = draft(root); require(value.preview.habits.any { it.id == habitId && it.kind == "conflict" })
        root.getJSONObject("choices").put(habitId, choice); write(draftKind, root)
        value.copy(choices = choices(root))
    }
    suspend fun refresh(id: String): HabitRestoreDraft = db.withTransaction {
        requireDataExchange(); val root = requireNotNull(read(draftKind)); require(root.getString("id") == id) { "HABIT_RESTORE_STALE" }
        val preview = HabitBackupRestore.preview(current(), text(root))
        root.put("fingerprint", preview.fingerprint)
        // A renewed preview always asks for an explicit decision about every current conflict.
        root.put("choices", JSONObject()); write(draftKind, root)
        draft(root)
    }
    suspend fun cancel(id: String) {
        db.withTransaction {
            guard(); read(draftKind)?.let { require(it.getString("id") == id) { "HABIT_RESTORE_STALE" }; clear(it) }
        }
    }
    suspend fun apply(id: String) {
        db.withTransaction {
            requireDataExchange()
            val root = read(draftKind)
            if (root == null) { require(read(receiptKind)?.optString("id") == id) { "HABIT_RESTORE_STALE" }; return@withTransaction }
            require(root.getString("id") == id) { "HABIT_RESTORE_STALE" }
            val current = current(); val request = draft(root)
            val next = HabitBackupRestore.apply(current, request.preview, request.choices)
            app.requireQuotaGrowth("habits", current.habits.count { ru.genesis.calendar.domain.habits.HabitLifecycle.state(it).status != "deleted" },
                next.habits.count { ru.genesis.calendar.domain.habits.HabitLifecycle.state(it).status != "deleted" }, scope)
            if (next !== current) {
                val revision = current.revision + 1
                dao.putDocument(DocumentRecord(scope, "habits", cipher.encrypt(HabitDocument.encode(next), "$scope/habits"), revision))
                if (scope.startsWith("account-")) dao.putOutbox(OutboxRecord(scope, "habits", revision, id))
            }
            write(receiptKind, JSONObject().put("id", id).put("checksum", request.preview.backup.checksum).put("at", Instant.now().toString()))
            clear(root); requireDataExchange(); beforeCommit()
        }
        app.scheduler.restoreHabitNotifications()
    }
}
