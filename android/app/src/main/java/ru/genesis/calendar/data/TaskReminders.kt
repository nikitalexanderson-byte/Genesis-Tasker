package ru.genesis.calendar.data

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.RecurrenceEngine

fun formatRelativeTaskReminder(minutes: Int, language: String = "ru"): String {
    if (minutes == 0) return if (language == "en") "At task start" else "В момент начала задачи"
    val divisor = listOf(10_080, 1_440, 60, 1).first { minutes >= it && minutes % it == 0 }
    val amount = minutes / divisor
    val forms = when (divisor) {
        10_080 -> listOf("неделю", "недели", "недель")
        1_440 -> listOf("день", "дня", "дней")
        60 -> listOf("час", "часа", "часов")
        else -> listOf("минуту", "минуты", "минут")
    }
    if (language == "en") {
        val unit = when (divisor) { 10_080 -> "week"; 1_440 -> "day"; 60 -> "hour"; else -> "minute" }
        return "$amount $unit${if (amount == 1) "" else "s"} before the task"
    }
    val form = if (amount % 100 in 11..19) forms[2] else when (amount % 10) { 1 -> forms[0]; in 2..4 -> forms[1]; else -> forms[2] }
    return "За $amount $form до задачи"
}

/** The website's reminder payload is the source of truth; reminderAt is legacy compatibility. */
data class TaskReminder(val kind: String, val minutes: Int? = null, val at: Long? = null) {
    init {
        require((kind == "relative" && minutes != null && minutes in 0..40_320 && at == null) ||
            (kind == "absolute" && at != null && minutes == null))
    }
    val key get() = if (kind == "relative") "relative:$minutes" else "absolute:$at"
    fun json() = if (kind == "relative") JSONObject().put("kind", kind).put("minutes", minutes)
        else JSONObject().put("kind", kind).put("at", Instant.ofEpochMilli(requireNotNull(at)).toString())

    companion object {
        fun relative(minutes: Int) = TaskReminder("relative", minutes = minutes)
        fun absolute(at: Long) = TaskReminder("absolute", at = at)
        fun parse(value: JSONObject): TaskReminder? = when (value.optString("kind")) {
            "relative" -> value.optInt("minutes", -1).takeIf { it in 0..40_320 }?.let(::relative)
            "absolute" -> runCatching { Instant.parse(value.getString("at")).toEpochMilli() }
                .getOrNull()?.let(::absolute)
            else -> null
        }
        fun from(source: JSONObject): List<TaskReminder> {
            val array = source.optJSONArray("reminders")
            val result = (0 until (array?.length() ?: 0)).mapNotNull { index ->
                array?.optJSONObject(index)?.let(::parse)
            }.distinctBy { it.key }.take(5)
            if (result.isNotEmpty()) return result
            val legacyMinutes = source.optInt("reminderMinutes", -1)
            if (legacyMinutes in 0..40_320) return listOf(relative(legacyMinutes))
            return source.optLong("reminderAt").takeIf { !source.isNull("reminderAt") && it > 0 }
                ?.let { listOf(absolute(it)) } ?: emptyList()
        }
        fun array(value: List<TaskReminder>) = JSONArray().apply { value.forEach { put(it.json()) } }
    }
}

object TaskReminderPlan {
    fun times(task: LocalTask): List<Pair<String, Long>> {
        if (task.done) return emptyList()
        val specs = task.reminders ?: task.reminderAt?.let { listOf(TaskReminder.absolute(it)) } ?: emptyList()
        if (specs.isEmpty()) return emptyList()
        // Google Tasks may have no due date. They are valid inbox entries, but cannot
        // produce a local dated alarm until the user assigns a date.
        if (runCatching { LocalDate.parse(task.date) }.isFailure) return emptyList()
        val dates = if (task.recurrence.enabled) RecurrenceEngine(GenesisCalendar()).datesForTask(
            task.date, task.recurrence,
            googleTaskListId = JSONObject(task.sourceFieldsJson).optString("googleTaskListId"),
            recurrenceSeriesId = JSONObject(task.sourceFieldsJson).optString("recurrenceSeriesId"),
            excludedDates = task.recurrenceExcludedDates.toSet()) else listOf(task.date)
        val zone = ZoneId.of(task.recurrence.calendarContext?.takeIf { task.recurrence.enabled && it.version == 2 }?.timeZone ?: task.zoneId)
        val time = task.time.takeIf { it.isNotBlank() }?.let(LocalTime::parse) ?: LocalTime.MIDNIGHT
        return dates.flatMap { date ->
            val start = LocalDate.parse(date).atTime(time).atZone(zone).toInstant().toEpochMilli()
            specs.mapIndexedNotNull { index, spec ->
                if (spec.kind == "absolute" && date != task.date) null
                else "$date:$index" to (if (spec.kind == "relative") start - requireNotNull(spec.minutes) * 60_000L
                    else requireNotNull(spec.at))
            }
        }.distinctBy { it.first }
    }
}
