package ru.genesis.calendar.data

import java.time.*
import org.json.JSONObject
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.RecurrenceEngine

/** Derived status only: never changes done, dates, reminders or cloud records. */
internal fun isTaskOverdue(task: LocalTask, now: Instant = Instant.now(), occurrenceDate: LocalDate? = null): Boolean {
    if(task.done) return false
    val start=runCatching { LocalDate.parse(task.date) }.getOrNull() ?: return false
    val source=runCatching { JSONObject(task.sourceFieldsJson) }.getOrNull()
    val googleList=source?.optString("googleTaskListId")?.takeUnless { source.isNull("googleTaskListId") || it.isBlank() }
    val externalSeries=source?.optString("recurrenceSeriesId")?.takeUnless { source.isNull("recurrenceSeriesId") || it.isBlank() }
    val last=if(occurrenceDate!=null) occurrenceDate else if(task.recurrence.enabled && googleList==null && externalSeries==null) {
        val dates=runCatching { RecurrenceEngine(GenesisCalendar()).datesForTask(task.date,task.recurrence,
            excludedDates=task.recurrenceExcludedDates.toSet()) }.getOrDefault(emptyList())
        dates.lastOrNull()?.let { LocalDate.parse(it) } ?: return false
    } else source?.optString("endDate")?.let { runCatching { LocalDate.parse(it) }.getOrNull() }?.takeIf { it>=start } ?: start
    val zone=runCatching { ZoneId.of(task.zoneId) }.getOrDefault(ZoneId.systemDefault())
    val time=task.time.takeIf(String::isNotBlank)?.let { runCatching { LocalTime.parse(it) }.getOrNull() }
    val deadline=if(time==null) last.plusDays(1).atStartOfDay(zone).toInstant() else last.atTime(time).atZone(zone).toInstant()
    return now>=deadline
}
