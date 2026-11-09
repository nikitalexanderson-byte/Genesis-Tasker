package ru.genesis.calendar.data

import java.math.BigDecimal
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.WorkspacePatch
import ru.genesis.calendar.domain.habits.*

internal data class HabitBackup(val createdAt: String, val checksum: String, val data: JSONObject) {
    fun text(): String = JSONObject().put("format", "genesis.habits.backup").put("version", 1)
        .put("createdAt", createdAt).put("checksum", checksum).put("data", data).toString()
    fun workspace(): LocalHabitWorkspace = HabitDocument.decode(CloudAccountImporter.habitsDocument(data), 0)
}

/** Portable schema shared with the web. Only the tracking allowlist enters a file. */
internal object HabitBackups {
    const val MAX_BYTES = 64 * 1024 * 1024
    val arrays = listOf("habits", "habitCompletions", "habitMeasurements", "habitTimers", "habitHistory", "dailyGoalRecords",
        "quests", "achievementUnlocks", "rewardTransactions", "streakFreezeTransactions", "hiddenDefaultTemplates")
    val keys = arrays + listOf("trackerSchemaVersion", "habitTimerEpoch", "userProgress", "habitSettings")
    fun state(workspace: LocalHabitWorkspace): JSONObject {
        val wire = WorkspacePatch.localDocument(WorkspacePatch.emptyDocument(), null, JSONObject(HabitDocument.encode(workspace)), null)
        return JSONObject().apply { keys.forEach { put(it, wire.get(it)) } }
    }
    fun fingerprint(workspace: LocalHabitWorkspace): String = digest(state(workspace))
    fun create(workspace: LocalHabitWorkspace, at: String = Instant.now().toString()): HabitBackup {
        Instant.parse(at)
        val data = state(workspace)
        for (habit in data.getJSONArray("habits").objects()) habit.getJSONObject("reminder")
            .put("syncToGoogleTasks", false).put("showInGoogleCalendar", false)
            .put("googleTaskId", JSONObject.NULL).put("googleEventId", JSONObject.NULL)
        validate(data)
        return HabitBackup(at, digest(data), data)
    }
    fun parse(text: String): HabitBackup {
        require(text.length <= MAX_BYTES && text.toByteArray(Charsets.UTF_8).size <= MAX_BYTES) { "HABIT_BACKUP_TOO_LARGE" }
        // Reject unreasonable nesting before Android's recursive JSON parser runs.
        var depth = 0; var quoted = false; var escaped = false
        for (char in text) {
            if (quoted) { if (escaped) escaped = false else if (char == '\\') escaped = true else if (char == '"') quoted = false }
            else when (char) { '"' -> quoted = true; '{', '[' -> { depth++; require(depth <= 128) { "HABIT_BACKUP_INVALID" } }; '}', ']' -> depth-- }
        }
        val root = JSONObject(text)
        canonical(root)
        require(root.getString("format") == "genesis.habits.backup") { "HABIT_BACKUP_INVALID" }
        require(root.getInt("version") == 1) { "HABIT_BACKUP_VERSION" }
        val at = root.getString("createdAt"); Instant.parse(at)
        val checksum = root.getString("checksum")
        require(Regex("[a-f0-9]{64}").matches(checksum)) { "HABIT_BACKUP_INVALID" }
        val data = root.getJSONObject("data")
        validate(data)
        require(digest(data) == checksum) { "HABIT_BACKUP_INTEGRITY" }
        return HabitBackup(at, checksum, JSONObject(data.toString()))
    }
    private fun validate(data: JSONObject) {
        require(data.keys().asSequence().toSet() == keys.toSet() && data.getInt("trackerSchemaVersion") == 16) { "HABIT_BACKUP_INVALID" }
        HabitTimers.epoch(data.getString("habitTimerEpoch"))
        for (key in arrays) {
            val rows = data.getJSONArray(key)
            require(rows.length() <= 100_000) { "HABIT_BACKUP_TOO_LARGE" }
            val ids = hashSetOf<String>()
            for (index in 0 until rows.length()) {
                val id = if (key == "hiddenDefaultTemplates") rows.getString(index) else rows.getJSONObject(index).getString(when (key) {
                    "dailyGoalRecords" -> "date"; "achievementUnlocks" -> "achievementId"
                    "rewardTransactions", "streakFreezeTransactions" -> "idempotencyKey"; else -> "id"
                })
                require(id.length in 1..1024 && ids.add(id)) { "HABIT_BACKUP_INVALID" }
            }
        }
        val workspace = HabitDocument.decode(CloudAccountImporter.habitsDocument(data), 0)
        val habits = workspace.habits.associateBy { it.id }
        for (habit in workspace.habits) {
            require(habit.title.isNotBlank() && habit.title.length <= 500 && habit.entity.version > 0) { "HABIT_BACKUP_INVALID" }
            Instant.parse(habit.entity.createdAt); Instant.parse(habit.entity.updatedAt); ZoneId.of(habit.schedule.timezone)
            require(!habit.reminder.syncToGoogleTasks && !habit.reminder.showInGoogleCalendar
                && habit.reminder.googleTaskId == null && habit.reminder.googleEventId == null) { "HABIT_BACKUP_INVALID" }
            HabitLifecycle.project(habit); HabitRuleHistory.state(habit, LocalDate.MAX)
        }
        for (key in listOf("habitCompletions", "habitMeasurements", "habitHistory")) for (row in data.getJSONArray(key).objects()) {
            val habit = requireNotNull(habits[row.getString("habitId")]) { "HABIT_BACKUP_INVALID" }
            require(LocalDate.parse(row.getString("date")) >= habit.createdDate) { "HABIT_BACKUP_INVALID" }
            Instant.parse(row.getString("createdAt"))
        }
        require(workspace.measurements.size == data.getJSONArray("habitMeasurements").length()
            && workspace.achievementUnlocks.size == data.getJSONArray("achievementUnlocks").length()
            && workspace.quests.size == data.getJSONArray("quests").length()
            && workspace.streakFreezeTransactions.size == data.getJSONArray("streakFreezeTransactions").length()) { "HABIT_BACKUP_INVALID" }
        for (row in workspace.completions) {
            require(row.xpAwarded in 0..20 && row.note.length <= 2000 && row.entity.version > 0) { "HABIT_BACKUP_INVALID" }
            Instant.parse(row.entity.updatedAt); HabitHistory.validate(HabitHistory.value(row))
        }
        HabitHistory.merge(workspace.history)
        for (row in workspace.measurements) HabitMeasurements.progress(habits.getValue(row.habitId), row.date, workspace.measurements)
        for (row in workspace.timers) require(habits.containsKey(row.habitId)) { "HABIT_BACKUP_INVALID" }
        for (row in workspace.quests) require(row.habitId == null || habits.containsKey(row.habitId)) { "HABIT_BACKUP_INVALID" }
        for (row in workspace.rewards) Instant.parse(row.createdAt)
        require(workspace.progress.lifetimeXp >= 0 && workspace.progress.laurelsBalance >= 0) { "HABIT_BACKUP_INVALID" }
    }
    fun digest(value: Any?): String = MessageDigest.getInstance("SHA-256").digest(canonical(value).toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it.toInt() and 255) }

    /** JSON.stringify-compatible escaping and key order, including literal HTML and non-BMP text. */
    fun canonical(value: Any?, depth: Int = 0): String {
        require(depth <= 128) { "HABIT_BACKUP_INVALID" }
        return when (value) {
            null, JSONObject.NULL -> "null"
            is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(",", "{", "}") { key ->
                require(key !in setOf("__proto__", "constructor", "prototype")) { "HABIT_BACKUP_INVALID" }
                quote(key) + ":" + canonical(value.get(key), depth + 1)
            }
            is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { canonical(value.get(it), depth + 1) }
            is String -> quote(value)
            is Boolean -> value.toString()
            is Number -> {
                val number = value.toDouble(); require(number.isFinite()) { "HABIT_BACKUP_INVALID" }
                val decimal = BigDecimal.valueOf(number).stripTrailingZeros()
                if (number == 0.0) "0" else if (kotlin.math.abs(number) >= 1e-6 && kotlin.math.abs(number) < 1e21) decimal.toPlainString()
                else decimal.toString().replace("E", "e").replace(Regex("e(-?)0+"), "e$1")
            }
            else -> error("HABIT_BACKUP_INVALID")
        }
    }
    private fun quote(value: String): String = buildString {
        append('"')
        for (index in value.indices) {
            val char = value[index]
            when (char) {
                '"' -> append("\\\""); '\\' -> append("\\\\"); '\b' -> append("\\b"); '\u000c' -> append("\\f")
                '\n' -> append("\\n"); '\r' -> append("\\r"); '\t' -> append("\\t")
                else -> if (char.code < 32 || char.isHighSurrogate() && (index + 1 == value.length || !value[index + 1].isLowSurrogate())
                    || char.isLowSurrogate() && (index == 0 || !value[index - 1].isHighSurrogate())) append("\\u%04x".format(char.code)) else append(char)
            }
        }
        append('"')
    }
}

internal fun JSONArray.objects(): List<JSONObject> = (0 until length()).map(::getJSONObject)
