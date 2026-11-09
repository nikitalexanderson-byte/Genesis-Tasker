package ru.genesis.calendar.data

import org.json.JSONObject
import java.time.*
import ru.genesis.calendar.domain.trackers.SleepPlan
import ru.genesis.calendar.domain.trackers.SleepEntry
import ru.genesis.calendar.domain.trackers.TrackerSchedules

internal data class DreamSettings(val todayMode: String = "off", val revision: Long = 0) {
    fun json() = JSONObject().put("todayMode", todayMode).put("revision", revision)
    companion object {
        fun parse(row: JSONObject): DreamSettings {
            val mode = row.getString("todayMode"); val revision = row.opt("revision")
            require(mode in setOf("off", "morning", "all-day") && revision is Number && revision.toDouble() == revision.toLong().toDouble() && revision.toLong() >= 0) { "DREAM_INVALID_SETTINGS" }
            return DreamSettings(mode, revision.toLong())
        }
    }
}
internal data class DreamMorningWindow(val visible: Boolean, val source: String?)
internal object DreamJournalModel {
    fun uniqueDreams(records: List<DiaryRecord>): List<DiaryRecord> = records.filter { it.note.dreamDay != null && !it.note.archived }
        .groupBy { it.note.id }.values.map { rows -> rows.maxWith(compareBy<DiaryRecord> { it.draft }.thenBy { it.note.updatedAt }) }
    fun matches(note: DiaryNote, query: String): Boolean = query.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
        .all { (note.title + "\n" + note.body).contains(it, ignoreCase = true) }
    private fun localInstant(day: LocalDate, time: LocalTime, zone: ZoneId): Instant? {
        val local = day.atTime(time)
        return zone.rules.getValidOffsets(local).map { local.toInstant(it) }.minOrNull()
    }
    fun morning(plans: List<SleepPlan>, entries: List<SleepEntry>, now: Instant): DreamMorningWindow {
        val actual = mutableListOf<Instant>(); val planned = mutableListOf<Instant>()
        plans.forEach { plan -> runCatching {
            val zone = ZoneId.of(plan.schedule.timezone); val today = now.atZone(zone).toLocalDate()
            entries.filter { it.planId == plan.id && it.wokeAt != null }.forEach { entry ->
                val wake = entry.wokeAt!!; val bed = entry.fellAsleepAt ?: plan.targetBedtime
                val day = if (wake <= bed) entry.date.plusDays(1) else entry.date
                localInstant(day, wake, zone)?.let { stamp ->
                    if (day == today || stamp <= now && Duration.between(stamp, now) < Duration.ofHours(3)) actual += stamp
                }
            }
            if (plan.active) {
                val sleepDay = if (plan.targetWakeTime <= plan.targetBedtime) today.minusDays(1) else today
                if (TrackerSchedules.isScheduled(plan.schedule, sleepDay)) localInstant(today, plan.targetWakeTime, zone)?.let { planned += it }
            }
        } }
        val wake = (actual.ifEmpty { planned }).maxOrNull()
        return DreamMorningWindow(wake != null && now >= wake && now < wake.plusSeconds(10800), if (actual.isNotEmpty()) "actual" else if (planned.isNotEmpty()) "planned" else null)
    }
}
