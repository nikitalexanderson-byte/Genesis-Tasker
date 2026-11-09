package ru.genesis.calendar.data

import java.math.BigDecimal
import java.time.LocalDate
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.domain.habits.HabitMeasurements

internal object HabitHistoryCsv {
    val columns = linkedMapOf("record_type" to "Тип записи", "habit_id" to "Идентификатор привычки", "habit_name" to "Название привычки",
        "record_id" to "Идентификатор записи", "entry_id" to "Идентификатор результата", "date" to "Дата выполнения", "value" to "Значение", "value_thousandths" to "Значение в тысячных",
        "unit" to "Единица", "completed" to "Выполнено", "quality" to "Качество", "note" to "Заметка", "created_at" to "Время внесения", "updated_at" to "Время изменения",
        "source" to "Источник", "historical" to "Историческая корректировка", "replaces" to "Предыдущие записи", "rule_id" to "Версия правила", "target_thousandths" to "Дневная цель в тысячных",
        "period" to "Период цели", "period_metric" to "Метрика цели", "period_target" to "Цель периода", "period_target_thousandths" to "Цель периода в тысячных",
        "calendar" to "Календарь", "time_zone" to "Часовой пояс", "year_start" to "Начало года", "quality_confirmed_at" to "Время подтверждения качества",
        "completed_times" to "Время выполнений", "calendar_version" to "Версия календаря", "skipped_at" to "Время осознанного пропуска")
    fun build(workspace: LocalHabitWorkspace, from: LocalDate? = null, to: LocalDate? = null, habitId: String? = null,
        label: (String) -> String = { it }): String {
        require(from == null || to == null || from <= to) { "HABIT_EXPORT_RANGE_INVALID" }
        val habits = workspace.habits.associateBy { it.id }; val output = mutableListOf<Map<String, Any?>>()
        fun accepts(id: String, date: LocalDate) = (habitId == null || id == habitId) && (from == null || date >= from) && (to == null || date <= to)
        fun decimal(value: Long?) = value?.let { BigDecimal.valueOf(it, 3).stripTrailingZeros().toPlainString() }.orEmpty()
        fun common(id: String, date: LocalDate, ruleId: String? = null): Map<String, Any?> {
            val habit = requireNotNull(habits[id]) { "HABIT_BACKUP_INVALID" }; val current = HabitMeasurements.rule(habit, date)
            val rule = if (ruleId == null) current else habit.ruleHistory.firstOrNull { it.id == ruleId } ?: current.also { require(it.id == ruleId) }
            val goal = rule.periodGoal
            return mapOf("habit_id" to id, "habit_name" to habit.title, "date" to date.toString(), "rule_id" to rule.id, "unit" to rule.measurement?.unit,
                "target_thousandths" to rule.measurement?.target, "period" to (goal?.period ?: "day"), "period_metric" to (goal?.metric ?: "days"),
                "period_target" to if (goal?.metric == "sum") decimal(goal.target) else goal?.target, "period_target_thousandths" to goal?.target?.takeIf { goal.metric == "sum" },
                "calendar" to (goal?.calendar ?: rule.schedule.recurrence.mode), "time_zone" to (goal?.context?.timeZone ?: rule.schedule.timezone),
                "year_start" to (goal?.context?.gregorianYearStart ?: rule.schedule.recurrence.calendarContext?.gregorianYearStart ?: "january"),
                "calendar_version" to (goal?.context?.version ?: rule.schedule.recurrence.calendarContext?.version))
        }
        for (row in workspace.completions) if (accepts(row.habitId, row.date)) output += common(row.habitId, row.date) + mapOf(
            "record_type" to "completion", "record_id" to row.entity.id, "completed" to row.completed, "quality" to row.qualityValue, "note" to row.note,
            "created_at" to row.entity.createdAt, "updated_at" to row.entity.updatedAt, "source" to "snapshot", "quality_confirmed_at" to row.qualityConfirmedAt,
            "completed_times" to HabitBackups.canonical(JSONArray(row.completedTimes)), "skipped_at" to row.skippedAt,
            "historical" to workspace.history.any { it.habitId == row.habitId && it.date == row.date && it.source != "decision" })
        for (row in workspace.measurements) if (accepts(row.habitId, row.date)) output += common(row.habitId, row.date, row.ruleId) + mapOf(
            "record_type" to "measurement", "record_id" to row.entity.id, "value" to decimal(row.value), "value_thousandths" to row.value, "entry_id" to row.entryId,
            "note" to row.note, "source" to row.source, "historical" to row.historical, "created_at" to row.entity.createdAt, "updated_at" to row.entity.createdAt,
            "replaces" to HabitBackups.canonical(JSONArray(row.replaces)))
        for (row in workspace.history) if (accepts(row.habitId, row.date)) output += common(row.habitId, row.date, row.ruleId) + mapOf(
            "record_type" to "history-edit", "record_id" to row.entity.id, "completed" to row.value.completed, "quality" to row.value.qualityValue,
            "note" to row.value.note, "source" to row.source, "historical" to (row.source != "decision"), "skipped_at" to row.value.skippedAt,
            "quality_confirmed_at" to row.value.qualityConfirmedAt, "completed_times" to HabitBackups.canonical(JSONArray(row.value.completedTimes)),
            "created_at" to row.entity.createdAt, "updated_at" to row.entity.updatedAt, "replaces" to HabitBackups.canonical(JSONArray(row.replaces)))
        val rows = output.sortedWith(compareBy<Map<String, Any?>> { it["date"].toString() }.thenBy { it["habit_id"].toString() }
            .thenBy { it["created_at"].toString() }.thenBy { it["record_id"].toString() })
        fun cell(value: Any?): String {
            var text = when (value) { null, JSONObject.NULL -> ""; is Number -> HabitBackups.canonical(value); else -> value.toString() }
            if (value is String && text.trimStart { it.isWhitespace() || it.code <= 32 }.firstOrNull() in listOf('=', '+', '-', '@')) text = "'$text"
            return "\"${text.replace("\"", "\"\"")}\""
        }
        return "\uFEFF" + (listOf(columns.map { (key, title) -> cell("$key [${label(title)}]") }.joinToString(",")) +
            rows.map { row -> columns.keys.joinToString(",") { cell(row[it]) } }).joinToString("\r\n") + "\r\n"
    }
}
