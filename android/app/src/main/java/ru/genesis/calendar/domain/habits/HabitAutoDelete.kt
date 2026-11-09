package ru.genesis.calendar.domain.habits

import java.time.LocalDate
import java.util.UUID

data class HabitAutoDeletePolicy(val version: Int = 1, val id: String = UUID.randomUUID().toString(),
    val count: Int = 7, val unit: String = "days", val points: String = "keep", val startOn: LocalDate = LocalDate.now()) {
    init { require(version == 1 && Regex("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}").matches(id)
        && count in 1..365 && unit in setOf("days", "weeks", "months") && points in setOf("keep", "remove")
        && startOn.year in 1..9999) { "INVALID_HABIT_AUTO_DELETE" } }
}

object HabitAutoDelete {
    fun prepare(value: HabitAutoDeletePolicy?, previous: HabitAutoDeletePolicy?, today: LocalDate): HabitAutoDeletePolicy? {
        if(value == null) return null
        if(previous != null && value.count == previous.count && value.unit == previous.unit && value.points == previous.points) return previous
        return value.copy(id = UUID.randomUUID().toString(), startOn = today)
    }
    fun deadline(start: LocalDate, policy: HabitAutoDeletePolicy): LocalDate = when(policy.unit) {
        "months" -> start.plusMonths(policy.count.toLong())
        "weeks" -> start.plusWeeks(policy.count.toLong())
        else -> start.plusDays(policy.count.toLong())
    }
    data class Due(val firstMissed: LocalDate, val deadline: LocalDate, val id: String)
    fun due(policy: HabitAutoDeletePolicy, startDate: LocalDate, today: LocalDate, completions: List<HabitCompletion>,
        state: (LocalDate) -> HabitLifecycle.State, scheduled: (LocalDate) -> Boolean): Due? {
        var start = maxOf(policy.startOn, startDate)
        if(start >= today) return null
        completions.filter { it.completed && it.date >= start && it.date <= today }.maxOfOrNull { it.date }?.let { start = it.plusDays(1) }
        var firstMissed: LocalDate? = null
        var day = start; var steps = 0
        while(day < today) {
            if(steps++ >= 74000) return null
            val availability = state(day)
            if(availability.conflict || availability.unknown || availability.status != "active") firstMissed = null
            else if(firstMissed == null && scheduled(day)) firstMissed = day
            day = day.plusDays(1)
        }
        val missed = firstMissed ?: return null
        val end = deadline(missed, policy)
        return if(today >= end) Due(missed, end, "habit-auto-delete:${policy.id}:$missed:$end:${policy.points}") else null
    }
    fun automaticPoints(id: String, action: String, metadata: String? = null): String? = if(action != "delete") null else
        metadata ?: Regex("habit-auto-delete:[a-f0-9-]{36}:\\d{4}-\\d{2}-\\d{2}:\\d{4}-\\d{2}-\\d{2}:(keep|remove)").matchEntire(id)?.groupValues?.get(1)
}
