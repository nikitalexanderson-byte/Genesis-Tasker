package ru.genesis.calendar.data

import java.time.LocalDate
import java.security.MessageDigest
import org.json.JSONObject
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.RecurrenceEngine

/** One stored task is projected into calendar days; no duplicate task records are generated. */
object TaskOccurrences {
    private val engine = RecurrenceEngine(GenesisCalendar())

    fun standaloneDraft(task:LocalTask,date:String):LocalTask {
        val occurrenceDate = LocalDate.parse(date)
        require(occursOn(task,occurrenceDate)) { "Этот день не входит в серию." }
        val id="occurrence-"+MessageDigest.getInstance("SHA-256").digest("${task.id}:$date".toByteArray()).joinToString("") {"%02x".format(it)}
        val source=JSONObject(task.sourceFieldsJson).apply {
            put("recurrenceSeriesId",task.id);put("recurrenceOriginalDate",date)
            put("mindmapOccurrenceParentRevision",task.revision)
            remove("googleEventId");remove("googleTaskId");put("googleLinks",JSONObject())
            val start = LocalDate.parse(task.date)
            // Match LocalTask.json(): absent/invalid imported end dates describe one day.
            val end = runCatching { LocalDate.parse(optString("endDate")) }.getOrNull()
                ?.takeIf { it >= start } ?: start
            put("endDate",occurrenceDate.plusDays(java.time.temporal.ChronoUnit.DAYS.between(start,end)).toString())
            // The range has already moved. LocalTask.json must not shift it again
            // relative to the parent's original dueDate when persisting the draft.
            put("dueDate", date)
        }
        return task.copy(id=id,date=date,revision=0,recurrence=task.recurrence.copy(enabled=false),recurrenceExcludedDates=emptyList(),sourceFieldsJson=source.toString(),reminderAt=null,reminders=task.reminders?.filter {it.kind=="relative"})
    }

    fun occursOn(task: LocalTask, date: LocalDate): Boolean {
        if (!task.recurrence.enabled) return task.date == date.toString()
        return date.toString() !in task.recurrenceExcludedDates &&
            engine.matches(task.date, task.recurrence, date.toString())
    }

    fun byDate(tasks: List<LocalTask>, start: LocalDate, end: LocalDate): Map<String, List<LocalTask>> {
        if (end < start) return emptyMap()
        val rows = linkedMapOf<String, MutableList<LocalTask>>()
        tasks.forEach { task ->
            val dates = if (task.recurrence.enabled) runCatching {
                engine.datesForTask(task.date, task.recurrence, excludedDates = task.recurrenceExcludedDates.toSet())
            }.getOrDefault(emptyList()) else listOf(task.date)
            dates.forEach { dateValue ->
                val date = runCatching { LocalDate.parse(dateValue) }.getOrNull()
                if (date != null && date in start..end) rows.getOrPut(dateValue) { mutableListOf() }.add(task)
            }
        }
        return rows
    }

    fun countInRange(tasks: List<LocalTask>, start: LocalDate, end: LocalDate): Int =
        byDate(tasks, start, end).values.sumOf { it.size }

    /** Web-compatible occurrence deletion: retain the unified series unless no dates remain. */
    fun withoutDate(task: LocalTask, date: String): LocalTask? {
        require(task.recurrence.enabled) { "Это не повторяющаяся задача." }
        val dates = engine.datesForTask(task.date, task.recurrence,
            excludedDates = task.recurrenceExcludedDates.toSet())
        require(date in dates) { "Этот день не входит в серию." }
        val remaining = dates.filterNot { it == date }
        if (remaining.isEmpty()) return null
        return task.copy(date = if (date == task.date) remaining.first() else task.date,
            recurrenceExcludedDates = (task.recurrenceExcludedDates + date).distinct().sorted(),
            reminderAt = if (date == task.date) null else task.reminderAt,
            reminders = if (date == task.date) task.reminders?.filter { it.kind == "relative" } else task.reminders)
    }
}
