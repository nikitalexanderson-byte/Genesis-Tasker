package ru.genesis.calendar.data

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.domain.habits.*

internal data class HabitRestoreRow(val id: String, val targetId: String, val title: String, val kind: String,
    val records: Int, val currentTitle: String?, val currentRecords: Int, val changes: List<String>)
internal data class HabitRestorePreview(val backup: HabitBackup, val fingerprint: String, val empty: Boolean, val habits: List<HabitRestoreRow>)

/** All validation and transformation finishes before the repository starts its atomic write. */
internal object HabitBackupRestore {
    private fun empty(workspace: LocalHabitWorkspace): Boolean = HabitBackups.arrays.filter { it != "hiddenDefaultTemplates" }
        .all { HabitBackups.state(workspace).getJSONArray(it).length() == 0 } && workspace.progress.lifetimeXp == 0
        && workspace.progress.laurelsBalance == 0 && HabitTimers.epoch(workspace.timerEpoch).isEmpty()
    fun preview(workspace: LocalHabitWorkspace, text: String): HabitRestorePreview {
        val backup = HabitBackups.parse(text); val source = backup.workspace(); val prefix = "restore:${backup.checksum.take(32)}"
        val targetWire = HabitBackups.state(workspace); val sourceWire = backup.data
        fun records(w: LocalHabitWorkspace, id: String) = w.completions.count { it.habitId == id } + w.measurements.count { it.habitId == id }
        val rows = source.habits.mapIndexed { index, habit ->
            val current = workspace.habits.firstOrNull { it.id == habit.id }; val copyId = "$prefix:habit:$index"
            val restored = workspace.habits.any { it.id == copyId } || workspace.history.any { it.habitId == habit.id && it.entity.id.startsWith("$prefix:") }
                || current?.lifecycleHistory?.any { it.id.startsWith("$prefix:") } == true
            val sameRecords = listOf("habitCompletions", "habitMeasurements", "habitHistory").all { key ->
                fun related(w: JSONObject) = JSONArray(w.getJSONArray(key).objects().filter { it.getString("habitId") == habit.id })
                HabitBackups.canonical(related(targetWire)) == HabitBackups.canonical(related(sourceWire))
            }
            fun definition(h: Habit) = h.copy(entity = h.entity.copy(version = 1, syncState = "local", updatedAt = h.entity.createdAt))
            val kind = when { restored -> "restored"; current != null && definition(current) == definition(habit) && sameRecords -> "same"; current != null -> "conflict"; else -> "new" }
            val changes = if (current == null) emptyList() else buildList {
                if (current.title != habit.title || current.description != habit.description) add("Название и описание")
                if (current.measurement != habit.measurement || current.periodGoal != habit.periodGoal || current.schedule != habit.schedule || current.ruleHistory != habit.ruleHistory) add("Цель и расписание")
                if (current.lifecycleHistory != habit.lifecycleHistory || current.active != habit.active) add("Состояние привычки")
                if (!sameRecords) add("История выполнения")
            }
            HabitRestoreRow(habit.id, if (kind == "conflict") copyId else habit.id, habit.title, kind, records(source, habit.id), current?.title, records(workspace, habit.id), changes)
        }
        return HabitRestorePreview(backup, HabitBackups.fingerprint(workspace), empty(workspace), rows)
    }
    fun apply(workspace: LocalHabitWorkspace, preview: HabitRestorePreview, choices: Map<String, String>, at: String = Instant.now().toString()): LocalHabitWorkspace {
        val checked = HabitBackupRestore.preview(workspace, preview.backup.text())
        require(checked.fingerprint == preview.fingerprint) { "HABIT_RESTORE_STALE" }
        val now = Instant.parse(at); val snapshotAt = checked.backup.createdAt
        require(Instant.parse(snapshotAt) <= now) { "HABIT_RESTORE_FUTURE" }
        require(checked.habits.none { it.kind == "conflict" && choices[it.id] !in setOf("keep", "copy") }) { "HABIT_RESTORE_CHOICE_REQUIRED" }
        val selected = checked.habits.filter { it.kind == "new" || it.kind == "conflict" && choices[it.id] == "copy" }
        if (selected.isEmpty()) return workspace
        val source = checked.backup.workspace(); val recover = checked.empty; val prefix = "restore:${checked.backup.checksum.take(32)}"
        val ids = selected.associate { it.id to it.targetId }; val epoch = HabitTimers.epoch(if (recover) source.timerEpoch else workspace.timerEpoch)
        fun mapIds(rows: List<String>, name: String) = rows.mapIndexed { index, id -> id to if (recover) id else "$prefix:$name:$index" }.toMap()
        val lifecycleIds = mapIds(source.habits.flatMap { it.lifecycleHistory }.map { it.id }, "lifecycle")
        val historyIds = mapIds(source.history.map { it.entity.id }, "history")
        val measurementIds = mapIds(source.measurements.map { it.entity.id }, "measurement")
        val timerIds = mapIds(source.timers.map { it.id }, "timer").toMutableMap()
        val sessionIds = source.timers.map { it.sessionId }.distinct().associateWith { timerIds.getValue(it) }
        source.timers.filter { it.action == "save" }.forEach { timerIds[it.id] = "timer-saved:${sessionIds.getValue(it.sessionId)}" }
        val entryIds = source.measurements.map { it.entryId }.distinct().associateWith { measurementIds.getValue(it) }
        val habits = source.habits.filter { ids.containsKey(it.id) }.map { habit ->
            val index = checked.habits.indexOfFirst { it.id == habit.id }; val id = ids.getValue(habit.id)
            var imported = habit.copy(entity = habit.entity.copy(id = id), reminder = habit.reminder.copy(syncToGoogleTasks = false,
                showInGoogleCalendar = false, googleTaskId = null, googleEventId = null), lifecycleHistory = habit.lifecycleHistory.map { row ->
                row.copy(id = lifecycleIds.getValue(row.id), habitId = id, replaces = row.replaces.map(lifecycleIds::getValue), selectedId = row.selectedId?.let(lifecycleIds::getValue))
            })
            val state = HabitLifecycle.state(imported)
            if (state.status == "active") imported = HabitLifecycle.apply(imported, HabitLifecycleCommand("$prefix:pause:$index", id, snapshotAt, "pause", state.heads.map { it.id }))
            else if (imported.lifecycleHistory.isEmpty()) imported = HabitLifecycle.apply(imported, HabitLifecycleCommand("$prefix:observe:$index", id, snapshotAt, "observe", emptyList()))
            imported
        }
        val habitMap = habits.associateBy { it.id }
        fun rule(id: String, date: LocalDate, ruleId: String): String {
            val habit = habitMap.getValue(ids.getValue(id))
            return if (habit.ruleHistory.any { it.id == ruleId }) ruleId else HabitMeasurements.rule(habit, date).id
        }
        fun guardDate(id: String, date: LocalDate) {
            val habit = habitMap.getValue(ids.getValue(id))
            require(date <= now.atZone(ZoneId.of(habit.schedule.timezone)).toLocalDate()) { "HABIT_RESTORE_FUTURE" }
        }
        val measurements = source.measurements.filter { ids.containsKey(it.habitId) }.map { row ->
            guardDate(row.habitId, row.date)
            row.copy(entity = row.entity.copy(id = measurementIds.getValue(row.entity.id)), habitId = ids.getValue(row.habitId),
                entryId = entryIds.getValue(row.entryId), ruleId = rule(row.habitId, row.date, row.ruleId), replaces = row.replaces.map(measurementIds::getValue), historical = true, source = if (recover) row.source else "import")
        }
        val completions = source.completions.filter { ids.containsKey(it.habitId) }.mapIndexed { index, row ->
            guardDate(row.habitId, row.date)
            val id = ids.getValue(row.habitId)
            row.copy(entity = row.entity.copy(id = if (recover) row.entity.id else "habit-completion:$id:${row.date}", version = if (recover) row.entity.version else maxOf(1, index + 1)),
                habitId = id, xpAwarded = if (recover) row.xpAwarded else 0)
        }
        val history = source.history.filter { ids.containsKey(it.habitId) }.map { row ->
            guardDate(row.habitId, row.date)
            row.copy(entity = row.entity.copy(id = historyIds.getValue(row.entity.id)), habitId = ids.getValue(row.habitId), epoch = epoch,
                ruleId = rule(row.habitId, row.date, row.ruleId), replaces = row.replaces.map(historyIds::getValue),
                baseline = if (recover) row.baseline?.copy(habitId = ids.getValue(row.habitId)) else null, source = "import")
        }.toMutableList()
        val economy = if (recover) HabitHistory.economy(source) else null
        val dayIds = source.completions.mapIndexed { index, row -> "${row.habitId}:${row.date}" to "$prefix:day:$index" }.toMap()
        for (row in completions) {
            val original = selected.first { it.targetId == row.habitId }.id; val habit = habitMap.getValue(row.habitId)
            val baseline = economy?.completions?.firstOrNull { it.habitId == original && it.date == row.date }?.copy(habitId = row.habitId)
            history += HabitHistoryEdit(TrackerEntity(dayIds.getValue("$original:${row.date}"), snapshotAt, snapshotAt), row.habitId, row.date,
                HabitMeasurements.rule(habit, row.date).id, epoch, HabitHistory.state(history, row.habitId, row.date).heads.map { it.entity.id },
                HabitHistory.value(row), baseline, "import")
        }
        var timers = source.timers.filter { ids.containsKey(it.habitId) }.map { row -> row.copy(id = timerIds.getValue(row.id),
            sessionId = sessionIds.getValue(row.sessionId), habitId = ids.getValue(row.habitId), epoch = epoch, parents = row.parents.map(timerIds::getValue),
            plan = row.plan?.let { it.copy(ruleId = rule(row.habitId, Instant.parse(row.at).atZone(ZoneId.of(it.timeZone)).toLocalDate(), it.ruleId)) },
            allocations = row.allocations?.map { it.copy(ruleId = rule(row.habitId, it.date, it.ruleId)) }, branchId = row.branchId?.let(timerIds::getValue)) }
        for (session in HabitTimers.sessions(timers)) {
            val state = requireNotNull(session.state) { "HABIT_TIMER_CONFLICT" }
            if (state.status == "running") timers = HabitTimers.append(timers, session.id, session.root.owner, "pause", Instant.parse(snapshotAt), "$prefix:timer-pause:${session.id}")
        }
        val base = if (recover) source else workspace
        return base.copy(habits = workspace.habits + habits, measurements = workspace.measurements + measurements, completions = workspace.completions + completions,
            history = workspace.history + history, timers = workspace.timers + timers, timerEpoch = HabitTimers.workspaceEpoch(epoch, true, habits.any { it.lifecycleHistory.isNotEmpty() }), revision = workspace.revision)
    }
}
