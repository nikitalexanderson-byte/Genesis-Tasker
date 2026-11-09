package ru.genesis.calendar.domain.habits

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatterBuilder
import java.util.UUID
import ru.genesis.calendar.domain.CalendarContext

data class HabitTimerPlan(val mode: String, val workMinutes: Int, val breakMinutes: Int,
    val timeZone: String, val calendarMode: String, val context: CalendarContext,
    val habitTitle: String, val ruleId: String) {
    init {
        require(mode in setOf("stopwatch", "pomodoro") && workMinutes in 1..180 && breakMinutes in 0..120)
        require(timeZone.length in 1..100 && context.timeZone == timeZone); ZoneId.of(timeZone)
        require(calendarMode in setOf("profane", "sacred", "lunar") && habitTitle.length in 1..2000 && ruleId.length in 1..256)
    }
}
data class HabitTimerAllocation(val date: LocalDate, val workMs: Long, val value: Long,
    val ruleId: String, val reason: String) {
    init {
        require(workMs > 0 && value >= 0 && ruleId.length in 1..256)
        require(reason in setOf("duration", "not-duration", "not-scheduled", "rule-conflict"))
    }
}
data class HabitTimerOperation(val id: String, val sessionId: String, val habitId: String,
    val owner: String, val action: String, val parents: List<String>, val at: String,
    val plan: HabitTimerPlan? = null, val allocations: List<HabitTimerAllocation>? = null,
    val branchId: String? = null, val timeOnly: Boolean? = null, val epoch: String = "")
data class HabitTimerSegment(val start: Long, val end: Long)
data class HabitTimerState(val root: HabitTimerOperation, val head: HabitTimerOperation, val status: String,
    val segments: List<HabitTimerSegment>, val runningSince: Long?, val finishedAt: String? = null,
    val allocations: List<HabitTimerAllocation>? = null, val timeOnly: Boolean = false)
data class HabitTimerSession(val id: String, val root: HabitTimerOperation, val heads: List<HabitTimerState>) {
    val state get() = heads.singleOrNull()
}
data class HabitTimerReading(val activeMs: Long, val workMs: Long, val breakMs: Long,
    val onBreak: Boolean, val phaseRemainingMs: Long)
data class HabitTimerDay(val date: LocalDate, val workMs: Long, val value: Long)

/** Wire-compatible timestamp accounting. A session is controlled by its originating installation. */
object HabitTimers {
    fun epoch(value: String?): String = (value ?: "").removePrefix("lifecycle7:").removePrefix("history6:").also {
        require(it.isEmpty() || Regex("\\d{12}-[a-zA-Z0-9-]{1,64}").matches(it)) { "INVALID_HABIT_TIMER" }
    }
    fun workspaceEpoch(value: String, hasHistory: Boolean, hasLifecycle: Boolean = false) =
        (if(hasLifecycle || value.startsWith("lifecycle7:")) "lifecycle7:" else if(hasHistory) "history6:" else "") + epoch(value)
    fun nextEpoch(previous: String): String {
        val generation = (epoch(previous).take(12).toLongOrNull() ?: 0) + 1
        require(generation <= 999_999_999_999L)
        return generation.toString().padStart(12, '0') + "-" + UUID.randomUUID()
    }
    private val instantFormat = DateTimeFormatterBuilder().appendInstant(3).toFormatter()
    fun instant(value: Instant): String = instantFormat.format(value)
    private val actions = setOf("start", "pause", "resume", "finish", "resolve", "save", "discard")

    fun merge(vararg sources: List<HabitTimerOperation>): List<HabitTimerOperation> {
        val result = linkedMapOf<String, HabitTimerOperation>()
        for (input in sources.flatMap { it }) {
            require(listOf(input.id, input.sessionId, input.habitId).all { it.length in 1..256 }
                && input.owner.length in 1..100 && input.action in actions) { "INVALID_HABIT_TIMER" }
            require(input.parents.size <= 64 && input.parents.distinct().size == input.parents.size
                && input.parents.all { it.length in 1..256 && it != input.id }) { "INVALID_HABIT_TIMER" }
            val op = input.copy(epoch = epoch(input.epoch), at = instant(Instant.ofEpochMilli(Instant.parse(input.at).toEpochMilli())),
                parents = input.parents.sorted(), plan = input.plan.takeIf { input.action == "start" },
                allocations = input.allocations.takeIf { input.action == "finish" },
                branchId = input.branchId.takeIf { input.action == "resolve" }, timeOnly = input.timeOnly.takeIf { input.action == "save" })
            when (op.action) {
                "start" -> require(op.id == op.sessionId && op.parents.isEmpty() && op.plan != null)
                "resolve" -> require(op.parents.size >= 2 && op.branchId in op.parents)
                else -> require(op.parents.size == 1)
            }
            if (op.action == "finish") require(op.allocations != null && op.allocations.size <= 3700)
            val prior = result[op.id]
            require(prior == null || prior == op) { "HABIT_TIMER_ID_CONFLICT" }
            result[op.id] = op
        }
        return result.values.sortedWith(compareBy<HabitTimerOperation> { it.at }.thenBy { it.id })
    }

    fun workPrefix(activeMs: Long, plan: HabitTimerPlan): Long {
        require(activeMs >= 0) { "HABIT_TIMER_CLOCK_CHANGED" }
        if (plan.mode == "stopwatch") return activeMs
        val work = plan.workMinutes * 60_000L; val cycle = work + plan.breakMinutes * 60_000L
        return activeMs / cycle * work + minOf(activeMs % cycle, work)
    }
    private fun closed(state: HabitTimerState, end: Long): List<HabitTimerSegment> {
        val start = state.runningSince ?: return state.segments
        require(end >= start) { "HABIT_TIMER_CLOCK_CHANGED" }
        return if (end == start) state.segments else state.segments + HabitTimerSegment(start, end)
    }
    fun reading(state: HabitTimerState, now: Instant = Instant.now()): HabitTimerReading {
        val activeMs = closed(state, now.toEpochMilli()).sumOf { it.end - it.start }
        val plan = requireNotNull(state.root.plan); val workMs = workPrefix(activeMs, plan)
        val cycle = (plan.workMinutes + plan.breakMinutes) * 60_000L
        val position = activeMs % cycle
        val onBreak = plan.mode == "pomodoro" && position >= plan.workMinutes * 60_000L
        return HabitTimerReading(activeMs, workMs, activeMs - workMs, onBreak,
            if (plan.mode == "stopwatch") 0 else (if (onBreak) cycle else plan.workMinutes * 60_000L) - position)
    }
    fun days(state: HabitTimerState, end: Instant): List<HabitTimerDay> {
        val plan = requireNotNull(state.root.plan); val zone = ZoneId.of(plan.timeZone)
        val totals = sortedMapOf<LocalDate, Long>(); var elapsed = 0L; var iterations = 0
        for (segment in closed(state, end.toEpochMilli())) {
            var cursor = segment.start
            while (cursor < segment.end) {
                require(++iterations <= 100_000 && totals.size <= 3700) { "HABIT_TIMER_RANGE_TOO_LARGE" }
                val date = Instant.ofEpochMilli(cursor).atZone(zone).toLocalDate()
                val boundary = date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
                val until = minOf(segment.end, boundary)
                require(until > cursor) { "HABIT_TIMER_CLOCK_CHANGED" }
                val work = workPrefix(elapsed + until - segment.start, plan) - workPrefix(elapsed + cursor - segment.start, plan)
                if (work > 0) totals[date] = (totals[date] ?: 0) + work
                cursor = until
            }
            elapsed += segment.end - segment.start
        }
        var accumulated = 0L
        return totals.map { (date, ms) ->
            val before = accumulated / 60; accumulated += ms
            HabitTimerDay(date, ms, accumulated / 60 - before)
        }
    }

    fun sessions(input: List<HabitTimerOperation>): List<HabitTimerSession> {
        val byId = input.associateBy { it.id }; val states = mutableMapOf<String, HabitTimerState>()
        val visiting = hashSetOf<String>()
        fun evaluate(op: HabitTimerOperation): HabitTimerState {
            states[op.id]?.let { return it }
            require(visiting.add(op.id)) { "INVALID_HABIT_TIMER" }
            val at = Instant.parse(op.at).toEpochMilli()
            val state = if (op.action == "start") HabitTimerState(op, op, "running", emptyList(), at) else {
                val parents = op.parents.map { id ->
                    val parent = requireNotNull(byId[id]) { "HABIT_TIMER_HISTORY_CONFLICT" }
                    require(parent.epoch == op.epoch && parent.sessionId == op.sessionId && parent.habitId == op.habitId && parent.owner == op.owner
                        && Instant.parse(parent.at).toEpochMilli() <= at) { "HABIT_TIMER_HISTORY_CONFLICT" }
                    evaluate(parent)
                }
                val base = parents.firstOrNull { it.head.id == op.branchId } ?: parents.first()
                val next = base.copy(head = op)
                when (op.action) {
                    "pause" -> { require(base.status == "running"); next.copy(segments = closed(base, at), runningSince = null, status = "paused") }
                    "resume" -> { require(base.status == "paused"); next.copy(runningSince = at, status = "running") }
                    "finish" -> {
                        require(base.status in setOf("running", "paused"))
                        require(days(base, Instant.parse(op.at)) == op.allocations!!.map { HabitTimerDay(it.date, it.workMs, it.value) })
                        next.copy(segments = closed(base, at), runningSince = null, status = "finished", finishedAt = op.at, allocations = op.allocations)
                    }
                    "save" -> { require(base.status == "finished"); next.copy(status = "saved", timeOnly = op.timeOnly == true) }
                    "discard" -> {
                        require(base.status !in setOf("saved", "discarded"))
                        next.copy(segments = closed(base, at), runningSince = null, status = "discarded")
                    }
                    "resolve" -> {
                        require(parents.none { it.status == "saved" } || base.status == "saved") { "HABIT_TIMER_ALREADY_SAVED" }
                        if (base.status == "running") next.copy(segments = closed(base, at), runningSince = null, status = "paused") else next
                    }
                    else -> error("INVALID_HABIT_TIMER")
                }
            }
            visiting.remove(op.id); states[op.id] = state; return state
        }
        val referenced = input.flatMap { it.parents }.toSet()
        input.forEach(::evaluate)
        return input.filter { it.action == "start" }.map { root ->
            val heads = input.filter { it.sessionId == root.id && it.id !in referenced }.map(::evaluate)
            require(heads.isNotEmpty())
            HabitTimerSession(root.id, root, heads)
        }.sortedWith(compareByDescending<HabitTimerSession> { it.root.at }.thenBy { it.id })
    }

    fun measurementIds(operations: List<HabitTimerOperation>): Set<String> = sessions(operations).flatMap { session ->
        session.heads.filter { it.status == "saved" && !it.timeOnly }.flatMap { state -> state.allocations.orEmpty()
            .filter { it.reason == "duration" && it.value > 0 }.map { "timer-value:${session.id}:${it.date}" } }
    }.toSet()

    fun start(operations: List<HabitTimerOperation>, habitId: String, owner: String, plan: HabitTimerPlan,
        at: Instant = Instant.now(), id: String = "habit-timer-${UUID.randomUUID()}", epoch: String = ""): List<HabitTimerOperation> {
        operations.firstOrNull { it.id == id }?.let {
            require(it.epoch == epoch(epoch) && it.owner == owner && it.habitId == habitId && it.at == instant(at) && it.plan == plan) { "HABIT_TIMER_ID_CONFLICT" }
            return operations
        }
        require(sessions(operations).none { it.root.owner == owner && it.state?.status !in setOf("saved", "discarded") }) { "HABIT_TIMER_ACTIVE" }
        return merge(operations, listOf(HabitTimerOperation(id, id, habitId, owner, "start", emptyList(), instant(at), plan, epoch = epoch)))
    }
    fun append(operations: List<HabitTimerOperation>, sessionId: String, owner: String, action: String,
        at: Instant = Instant.now(), id: String = "timer-op-${UUID.randomUUID()}", allocations: List<HabitTimerAllocation>? = null,
        branchId: String? = null, timeOnly: Boolean = false): List<HabitTimerOperation> {
        val session = sessions(operations).firstOrNull { it.id == sessionId }
        require(session != null && session.root.owner == owner) { "HABIT_TIMER_OTHER_DEVICE" }
        operations.firstOrNull { it.id == id }?.let {
            require(it.owner == owner && it.sessionId == sessionId && it.action == action && it.at == instant(at)) { "HABIT_TIMER_ID_CONFLICT" }
            return operations
        }
        val state = session.state
        require(state != null || action == "resolve") { "HABIT_TIMER_CONFLICT" }
        if (state != null && (state.status == "saved" && action in setOf("save", "finish")
            || state.status == "finished" && action == "finish" || state.status == "paused" && action == "pause"
            || state.status == "running" && action == "resume" || state.status == "discarded" && action == "discard")) return operations
        val op = HabitTimerOperation(if (action == "save") "timer-saved:$sessionId" else id, sessionId,
            session.root.habitId, owner, action, session.heads.map { it.head.id }.sorted(),
            if (action == "save") requireNotNull(state).head.at else instant(at), allocations = allocations,
            branchId = branchId, timeOnly = timeOnly.takeIf { action == "save" }, epoch = session.root.epoch)
        return merge(operations, listOf(op)).also { sessions(it) }
    }
}
