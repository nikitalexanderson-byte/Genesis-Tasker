package ru.genesis.calendar.reminders

import android.content.SharedPreferences
import java.time.Instant
import java.time.LocalDate
import org.json.JSONObject
import ru.genesis.calendar.domain.habits.HabitReminderTarget

internal data class HabitReminderSnooze(val scope: String, val requestId: String,
    val target: HabitReminderTarget, val until: Instant) {
    fun encode(): String = JSONObject().put("scope", scope).put("requestId", requestId)
        .put("habitId", target.habitId).put("date", target.date.toString()).put("at", target.at.toEpochMilli())
        .put("ruleId", target.ruleId).put("time", target.intervalTime).put("until", until.toEpochMilli()).toString()
}

/** Only opaque targeting metadata is retained; notification text is rebuilt from the current workspace. */
internal fun habitReminderSnoozes(registry: SharedPreferences): List<HabitReminderSnooze> =
    registry.getStringSet("snoozes", emptySet()).orEmpty().mapNotNull { raw -> runCatching {
        val value = JSONObject(raw)
        HabitReminderSnooze(value.getString("scope"), value.getString("requestId"),
            HabitReminderTarget(value.getString("habitId"), LocalDate.parse(value.getString("date")),
                Instant.ofEpochMilli(value.getLong("at")), value.getString("ruleId"),
                if (value.isNull("time")) null else value.getString("time")), Instant.ofEpochMilli(value.getLong("until")))
    }.getOrNull() }
