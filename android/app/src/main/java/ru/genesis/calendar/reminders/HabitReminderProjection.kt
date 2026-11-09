package ru.genesis.calendar.reminders

import java.time.*
import java.time.format.DateTimeFormatterBuilder
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.*

internal data class HabitReminderGoalSettings(val changes: List<DailyGoalModeChange>,val rest: Set<LocalDate>)
internal fun habitReminderGoalSettings(workspace: LocalHabitWorkspace): HabitReminderGoalSettings {
    val raw=JSONObject(workspace.settings.rawJson)
    val changes=raw.optJSONArray("dailyGoalModeChanges")?.let { array -> (0 until array.length()).mapNotNull { index ->
        runCatching { array.getJSONObject(index).let { DailyGoalModeChange(LocalDate.parse(it.getString("effectiveFrom")),it.getString("mode"),it.getString("updatedAt")) } }.getOrNull()
    } }.orEmpty()
    val rest=raw.optJSONArray("plannedRestDays")?.let { array -> (0 until array.length()).mapNotNull { index ->
        runCatching { LocalDate.parse(array.getString(index)) }.getOrNull() }.toSet() }.orEmpty()
    return HabitReminderGoalSettings(DailyGoals.normalizeModeChanges(changes),rest)
}

/** Optional consented UTC metadata only. Never serialize habit titles, notes or measurement amounts. */
internal fun habitReminderProjection(workspace: LocalHabitWorkspace, now: Instant = Instant.now(),
    zone: ZoneId = ZoneId.systemDefault(), days: Int = 45): JSONObject {
    require(days in 1..45)
    val format = DateTimeFormatterBuilder().appendInstant(3).toFormatter()
    val settings = workspace.settings.notifications
    val goalSettings=habitReminderGoalSettings(workspace)
    val first = now.atZone(zone).toLocalDate()
    val engine = HabitEngine(GenesisCalendar(zone))
    val horizon = now.plusSeconds(days*86400L)
    val rows = mutableListOf<JSONObject>()
    if (workspace.settings.enabled) for (offset in -2..days+2) {
        val date = first.plusDays(offset.toLong())
        for (habit in workspace.habits) {
            if (!habit.active || !habit.reminder.enabled || !engine.isScheduled(habit,date,workspace.completions)
                || habit.reminder.syncToGoogleTasks && !habit.reminder.googleTaskId.isNullOrBlank()
                || habit.reminder.showInGoogleCalendar && !habit.reminder.googleEventId.isNullOrBlank()
                || workspace.completions.any { it.habitId == habit.id && it.date == date && it.completed }
                || HabitPeriodGoals.progress(habit,date,workspace.measurements,workspace.completions,now)?.completed == true) continue
            val rule = HabitMeasurements.rule(habit,date)
            val marks = habitIntervalMarks(habit,workspace.completions.firstOrNull { it.habitId == habit.id && it.date == date })
            for ((time, occurrence) in habitReminderOccurrences(habit,date)) {
                val at = occurrence.toInstant()
                if (at < now.minusSeconds(7200) || at >= horizon
                    || habit.reminder.timing != "custom" && habit.intervalSchedule?.completionMode == "each" && time.toString() in marks) continue
                rows += JSONObject().put("id","habit-reminder:${habit.id}:$date:${at.toEpochMilli()}").put("kind","habit")
                    .put("date",date.toString()).put("at",format.format(at)).put("timeZone",rule.schedule.timezone)
                    .put("allowDuringQuietHours",habit.reminder.allowDuringQuietHours).put("habitId",habit.id).put("ruleId",rule.id)
                    .put("action",if(HabitMeasurements.effective(rule)!=null || habit.qualityScale!="none") "input"
                        else if(habit.intervalSchedule?.completionMode=="each") "interval" else "complete")
                    .apply { if(habit.reminder.timing!="custom" && habit.intervalSchedule?.completionMode=="each") put("intervalTime",time.toString()) }
            }
        }
        if (settings.enabled && settings.motivational) {
            val goal = engine.dailyGoalForDate(workspace.habits,workspace.completions,workspace.goals,
                goalSettings.changes,goalSettings.rest,date,first,format.format(now),workspace.measurements)
            val remaining = (goal.targetCount-goal.completedCount).coerceAtLeast(0)
            val perfectRemaining = goal.scheduledCount-goal.completedCount
            if (goal.targetCount>0 && goal.status !in setOf("rest","neutral","protected") && (remaining>0 || perfectRemaining==1)) {
                val at = date.atTime(LocalTime.parse(settings.dailyGoalTime)).atZone(zone).toInstant()
                if(at>=now.minusSeconds(300) && at<horizon) rows += JSONObject().put("id","habit-goal:$date:${settings.dailyGoalTime}")
                    .put("kind","goal").put("date",date.toString()).put("at",format.format(at)).put("timeZone",zone.id)
                    .put("allowDuringQuietHours",false).put("localTime",settings.dailyGoalTime)
            }
        }
        if(rows.size>2048) {
            val prefix=rows.filter { Instant.parse(it.getString("at"))>=now }.sortedWith(compareBy({it.getString("at")},{it.getString("id")}))
            if(prefix.size>=2048 && date>Instant.parse(prefix[2047].getString("at")).atZone(zone).toLocalDate().plusDays(2)) break
        }
    }
    val unique = linkedMapOf<String,JSONObject>()
    for(row in rows) {
        val id=row.getString("id");val previous=unique[id]
        if(previous!=null && previous.optString("intervalTime")!=row.optString("intervalTime")) {
            previous.remove("intervalTime");previous.put("action","input")
        } else if(previous==null)unique[id]=row
    }
    val ordered = unique.values.sortedWith(compareBy({it.getString("at")},{it.getString("id")}))
    val recent=ordered.filter { Instant.parse(it.getString("at"))<now }.takeLast(256)
    val future=ordered.filter { Instant.parse(it.getString("at"))>=now }
    val selected=recent+future.take(2048-recent.size)
    val expires=if(future.size>2048-recent.size)maxOf(now.plusSeconds(60),Instant.parse(selected.last().getString("at")).plusSeconds(60)) else horizon
    return JSONObject().put("version",1).put("generatedAt",format.format(now)).put("expiresAt",format.format(expires))
        .put("timeZone",zone.id).put("tone",settings.tone).put("quietHoursStart",settings.quietHoursStart)
        .put("quietHoursEnd",settings.quietHoursEnd).put("rows",JSONArray(selected))
}
