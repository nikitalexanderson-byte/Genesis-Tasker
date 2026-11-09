package ru.genesis.calendar.reminders

import android.content.Intent
import java.time.Instant
import java.time.LocalDate
import ru.genesis.calendar.domain.habits.HabitReminderTarget

data class HabitReminderOpenRequest(val scope: String, val target: HabitReminderTarget, val action: String,
    val nonce: Long = System.nanoTime())

internal fun Intent.putHabitReminderTarget(target: HabitReminderTarget): Intent = apply {
    putExtra("habitId", target.habitId); putExtra("practiceDate", target.date.toString())
    putExtra("originalAt", target.at.toEpochMilli()); putExtra("habitRuleId", target.ruleId)
    putExtra("intervalTime", target.intervalTime)
}

internal fun habitReminderTarget(intent: Intent): HabitReminderTarget? = runCatching {
    HabitReminderTarget(requireNotNull(intent.getStringExtra("habitId")),
        LocalDate.parse(intent.getStringExtra("practiceDate")), Instant.ofEpochMilli(intent.getLongExtra("originalAt", 0)),
        requireNotNull(intent.getStringExtra("habitRuleId")), intent.getStringExtra("intervalTime"))
}.getOrNull()

internal fun habitReminderRequest(intent: Intent, scope: String): HabitReminderOpenRequest? {
    if (intent.getStringExtra("scope") != scope || intent.getStringExtra("openSection") != "habits") return null
    val action = intent.getStringExtra("habitAction") ?: return null
    if (action !in setOf("open", "complete", "input")) return null
    return habitReminderTarget(intent)?.let { HabitReminderOpenRequest(scope, it, action) }
}
