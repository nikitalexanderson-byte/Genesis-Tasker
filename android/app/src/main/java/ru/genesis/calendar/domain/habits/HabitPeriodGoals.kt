package ru.genesis.calendar.domain.habits

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters
import ru.genesis.calendar.domain.CalendarContext
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar

data class HabitPeriodGoal(val version: Int = 1, val period: String, val metric: String,
    val target: Long, val calendar: String, val context: CalendarContext) {
    init {
        require(version == 1 && period in setOf("week", "month") && metric in setOf("days", "entries", "sum"))
        require(calendar in setOf("profane", "sacred", "lunar"))
        require(target in 1..when(metric) { "days" -> 31L; "entries" -> 1_000_000L; else -> MAX_HABIT_MEASUREMENT })
    }
}

data class HabitGoalPeriod(val start: LocalDate, val end: LocalDate)
data class HabitPeriodProgress(val goal: HabitPeriodGoal, val rule: HabitRuleVersion,
    val period: HabitGoalPeriod, val effectiveStart: LocalDate, val deadline: LocalDate?,
    val allowedDays: List<LocalDate>, val value: Long, val qualifiedValue: Long, val rewardValue: Long,
    val conflicts: Boolean, val partial: Boolean, val unattainable: Boolean, val status: String,
    val historicalResolution: Boolean = false) {
    val remaining get() = (goal.target - value).coerceAtLeast(0)
    val completed get() = qualifiedValue >= goal.target && !conflicts
    val rewardEligible get() = rewardValue >= goal.target && !conflicts && !historicalResolution
    val qualityPending get() = value >= goal.target && qualifiedValue < goal.target
}

object HabitPeriodGoals {
    fun period(goal: HabitPeriodGoal, date: LocalDate): HabitGoalPeriod {
        val context = goal.context
        val calendar = GenesisCalendar(ZoneId.of(context.timeZone),context.version,context.gregorianYearStart)
        if (goal.period == "month") return calendar.monthRange(date,CalendarMode.fromWire(goal.calendar))
            .let { HabitGoalPeriod(it.start,it.end.plusDays(1)) }
        if (goal.calendar == "sacred") {
            val sacred = calendar.sacredDate(date)
            if (sacred.monthIndex == 12) return calendar.monthRange(date,CalendarMode.SACRED)
                .let { HabitGoalPeriod(it.start,it.end.plusDays(1)) }
            val start = date.minusDays(((sacred.day - 1) % 5).toLong())
            return HabitGoalPeriod(start,start.plusDays(5))
        }
        val start = date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        return HabitGoalPeriod(start,start.plusDays(7))
    }

    fun progress(habit: Habit, date: LocalDate, events: List<HabitMeasurementEvent>,
        completions: List<HabitCompletion>, now: Instant = Instant.now()): HabitPeriodProgress? {
        val ruleState=HabitRuleHistory.state(habit,date)
        val rule = ruleState.rule
        val goal = rule.periodGoal ?: return null
        val period = period(goal,date)
        val today = now.atZone(ZoneId.of(goal.context.timeZone)).toLocalDate()
        val first = maxOf(period.start,habit.createdDate,rule.effectiveDate)
        val engine = HabitEngine(GenesisCalendar(ZoneId.of(goal.context.timeZone),goal.context.version,goal.context.gregorianYearStart))
        val scheduledHabit=habit.copy(active=true,ruleHistory=emptyList(),schedule=rule.schedule,lifecycleHistory=emptyList())
        val allowed = mutableListOf<LocalDate>()
        var value = 0L; var qualified = 0L; var reward = 0L; var conflicts = ruleState.conflicts.isNotEmpty();var interrupted=false
        var day = first
        while (day < period.end) {
            val life=HabitLifecycle.state(habit,day)
            val planned=engine.isScheduled(scheduledHabit,day)
            val sameRule=HabitMeasurements.rule(habit,day).id==rule.id
            if(planned && (!sameRule || life.status!="active" || life.conflict)) interrupted=true
            if (sameRule && planned && life.status=="active" && !life.conflict) {
                allowed += day
                if (day <= today) {
                    val entry = completions.firstOrNull { it.habitId == habit.id && it.date == day }
                    val measurement = HabitMeasurements.effective(rule)
                    val measured = measurement?.let { HabitMeasurements.progress(habit,day,events) }
                    if (measured != null && (measured.incompatible || measured.entries.any { it.conflict })) conflicts = true
                    val quality = habit.qualityScale == "none" || entry?.qualityConfirmedAt != null
                    when (goal.metric) {
                        "sum" -> {
                            require(measurement != null) { "HABIT_PERIOD_MEASUREMENT_REQUIRED" }
                            value = Math.addExact(value,measured!!.total)
                            if (quality) { qualified = Math.addExact(qualified,measured.total); reward = Math.addExact(reward,measured.rewardTotal) }
                        }
                        "entries" -> measured?.entries?.forEach { item ->
                            val current = item.current
                            if (current?.value != null && current.ruleId == rule.id) {
                                value++
                                if (quality) qualified++
                                val root = item.revisions.firstOrNull { it.entity.id == item.id && it.replaces.isEmpty() }
                                if (quality && root != null && !root.historical && root.source != "import"
                                    && !current.historical && current.source != "import") reward++
                            }
                        }
                        else -> if (entry?.completed == true) {
                            value++; qualified++
                            if (measured?.let { it.rewardTotal >= it.target }
                                ?: (Instant.parse(entry.entity.createdAt).atZone(ZoneId.of(goal.context.timeZone)).toLocalDate() == day)) reward++
                        }
                    }
                    require(value in 0..MAX_HABIT_MEASUREMENT) { "HABIT_MEASUREMENT_TOTAL_TOO_LARGE" }
                }
            }
            day = day.plusDays(1)
        }
        val deadline = allowed.lastOrNull()
        val partial = interrupted || first > period.start || rule.schedule.endDate?.let { it < period.end.minusDays(1) } == true
        val unattainable = goal.metric == "days" && allowed.size < goal.target
        val completed = qualified >= goal.target && !conflicts
        val status = when {
            ruleState.conflicts.isNotEmpty() || (partial || unattainable) && !completed || deadline == null -> "neutral"
            completed -> "completed"
            today > deadline -> "missed"
            else -> "open"
        }
        val historicalResolution=ruleState.appliedVersion.selectedRuleId!=null&&deadline!=null&&
            Instant.parse(ruleState.appliedVersion.recordedAt).atZone(ZoneId.of(goal.context.timeZone)).toLocalDate()>deadline
        return HabitPeriodProgress(goal,rule,period,first,deadline,allowed,value,qualified,reward,conflicts,partial,unattainable,status,historicalResolution)
    }

    fun settlement(habit: Habit, date: LocalDate, events: List<HabitMeasurementEvent>, completions: List<HabitCompletion>,
        now: Instant = Instant.now()) = progress(habit,date,events,completions,now)?.takeIf { it.deadline == date && it.status != "neutral" }

    /** Only settled, reward-eligible periods enter quests and personal achievements. */
    fun goalCompletions(habits: List<Habit>, events: List<HabitMeasurementEvent>, completions: List<HabitCompletion>,
        start: LocalDate, end: LocalDate, now: Instant, rewardsOnly: Boolean = true): List<HabitCompletion> {
        val output = completions.filter { entry -> habits.firstOrNull { it.id==entry.habitId }
            ?.let { HabitMeasurements.rule(it,entry.date).periodGoal } == null }.toMutableList()
        habits.forEach { habit ->
            var date = maxOf(start,habit.createdDate)
            while(date<=end) {
                val result = progress(habit,date,events,completions,now)
                if(result==null) { date=date.plusDays(1); continue }
                val deadline = result.deadline
                if(deadline!=null && deadline>=start && deadline<=end && result.status!="neutral")
                    output += HabitCompletion(TrackerEntity.create("habit-period",now.toString(),"habit-period:${habit.id}:$deadline"),
                        habit.id,deadline,result.completed&&(!rewardsOnly || result.rewardEligible))
                date = habit.ruleHistory.firstOrNull { it.effectiveDate>date && it.effectiveDate<result.period.end }?.effectiveDate ?: result.period.end
            }
        }
        return output
    }

    fun streak(habit: Habit, date: LocalDate, events: List<HabitMeasurementEvent>, completions: List<HabitCompletion>,
        now: Instant = Instant.now()): Int {
        var count=0; var cursor=date
        repeat(750) {
            val state=progress(habit,cursor,events,completions,now) ?: return count
            if(state.period.end<=habit.createdDate || state.status=="missed") return count
            if(state.status=="completed" && state.deadline?.let { it<=date }==true) count++
            cursor=state.period.start.minusDays(1)
            if(cursor<habit.createdDate) return count
        }
        return count
    }
}
