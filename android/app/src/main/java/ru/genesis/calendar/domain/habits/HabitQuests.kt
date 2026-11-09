package ru.genesis.calendar.domain.habits

import java.time.LocalDate

data class HabitQuest(val entity: TrackerEntity, val cadence: String, val kind: String,
    val habitId: String?, val startDate: LocalDate, val endDate: LocalDate, val target: Int,
    val progress: Int, val rewardLaurels: Int, val completedAt: String?) {
    val id get() = entity.id
}

/** Local port of app/habit-quests.ts: attainable day/week/month trials and once-only Laurels. */
object HabitQuests {
    const val dailyLaurels = 3
    const val weeklyLaurels = 25
    const val epicLaurels = 80
    private val cadences = setOf("daily", "weekly", "epic")
    private val kinds = setOf("daily-goal", "weekly-completions", "daily-goals", "perfect-days",
        "habit-completions", "epic-completions")

    fun week(today: LocalDate): Pair<LocalDate, LocalDate> {
        val start = today.minusDays((today.dayOfWeek.value - 1).toLong())
        return start to start.plusDays(6)
    }

    fun month(today: LocalDate): Pair<LocalDate, LocalDate> {
        val start = today.withDayOfMonth(1)
        return start to today.withDayOfMonth(today.lengthOfMonth())
    }

    fun normalize(items: List<HabitQuest>): List<HabitQuest> {
        val known = linkedMapOf<String, HabitQuest>()
        items.forEach { item ->
            if (item.cadence !in cadences || item.kind !in kinds || item.endDate < item.startDate ||
                item.target < 1 || item.rewardLaurels < 1 || item.id.isBlank()) return@forEach
            val normalized = item.copy(progress = item.progress.coerceIn(0, item.target))
            val prior = known[item.id]
            if (prior == null || normalized.entity.version > prior.entity.version ||
                (normalized.entity.version == prior.entity.version &&
                    normalized.entity.updatedAt > prior.entity.updatedAt)) known[item.id] = normalized
        }
        return known.values.sortedWith(compareBy<HabitQuest> { it.startDate }.thenBy { it.cadence })
    }

    private fun dates(start: LocalDate, end: LocalDate): List<LocalDate> {
        val result = mutableListOf<LocalDate>()
        var date = start
        while (date <= end) { result += date; date = date.plusDays(1) }
        return result
    }

    private fun measured(quest: HabitQuest, completions: List<HabitCompletion>,
        goals: List<DailyGoalRecord>): Int {
        val records = goals.filter { it.date >= quest.startDate && it.date <= quest.endDate }
        return when (quest.kind) {
            "daily-goal" -> if (records.any { it.date == quest.startDate &&
                    it.status in setOf("qualified", "perfect") }) 1 else 0
            "daily-goals" -> records.count { it.status in setOf("qualified", "perfect") }
            "perfect-days" -> records.count { it.status == "perfect" }
            else -> completions.filter { it.completed && it.date >= quest.startDate &&
                it.date <= quest.endDate && (quest.habitId == null || it.habitId == quest.habitId) }
                .map { it.habitId to it.date }.toSet().size
        }
    }

    private fun update(quest: HabitQuest, completions: List<HabitCompletion>,
        goals: List<DailyGoalRecord>, timestamp: String): HabitQuest {
        val measured = measured(quest, completions, goals).coerceAtMost(quest.target)
        val progress = if (quest.completedAt == null) measured else maxOf(quest.progress, measured)
        val completed = quest.completedAt ?: if (progress >= quest.target) timestamp else null
        return if (progress == quest.progress && completed == quest.completedAt) quest else
            quest.copy(entity = quest.entity.changed(timestamp), progress = progress, completedAt = completed)
    }

    private fun create(cadence: String, kind: String, habitId: String?, start: LocalDate,
        end: LocalDate, target: Int, laurels: Int, timestamp: String) = HabitQuest(
        TrackerEntity("quest:$cadence:$start", timestamp, timestamp), cadence, kind, habitId,
        start, end, target.coerceAtLeast(1), 0, laurels, null)

    fun reconcile(existing: List<HabitQuest>, habits: List<Habit>, completions: List<HabitCompletion>,
        goals: List<DailyGoalRecord>, today: LocalDate, timestamp: String,
        isScheduled: (Habit, LocalDate) -> Boolean): List<HabitQuest> {
        val normalized = normalize(existing)
        val quests = normalized.associate { it.id to update(it, completions, goals, timestamp) }.toMutableMap()
        val active = habits.filter { it.active }
        fun scheduled(habit: Habit, date: LocalDate) = isScheduled(habit, date)
        val todayScheduled = active.count { scheduled(it, today) }
        fun put(cadence: String, kind: String, habitId: String?, start: LocalDate,
            end: LocalDate, target: Int, laurels: Int) {
            if (target <= 0) return
            val id = "quest:$cadence:$start"
            if (id !in quests) quests[id] = update(create(cadence, kind, habitId, start, end,
                target, laurels, timestamp), completions, goals, timestamp)
        }
        if (todayScheduled > 0) put("daily", "daily-goal", null, today, today, 1, dailyLaurels)

        val (weekStart, weekEnd) = week(today)
        val weekDates = dates(weekStart, weekEnd)
        val completedKeys = completions.filter { it.completed }.map { it.habitId to it.date }.toSet()
        fun attainable(habitId: String?, range: List<LocalDate>) = active.sumOf { habit ->
            if (habitId != null && habit.id != habitId) 0 else range.count { date ->
                scheduled(habit, date) && (date >= today || (habit.id to date) in completedKeys)
            }
        }
        fun attainableGoals(range: List<LocalDate>, perfectOnly: Boolean) = range.count { date ->
            if (date < today) goals.any { it.date == date &&
                (if (perfectOnly) it.status == "perfect" else it.status in setOf("qualified", "perfect")) }
            else active.any { scheduled(it, date) }
        }
        val variant = weekStart.toString().filter(Char::isDigit).toInt() % 4
        when (variant) {
            1 -> put("weekly", "daily-goals", null, weekStart, weekEnd,
                attainableGoals(weekDates, false).coerceAtMost(5), weeklyLaurels)
            2 -> put("weekly", "perfect-days", null, weekStart, weekEnd,
                attainableGoals(weekDates, true).coerceAtMost(3), weeklyLaurels)
            3 -> {
                val chosen = active.map { it to attainable(it.id, weekDates) }
                    .filter { it.second > 0 }
                    .sortedWith(compareByDescending<Pair<Habit, Int>> { it.second }
                        .thenByDescending { it.first.priority }.thenBy { it.first.id }).firstOrNull()
                put("weekly", "habit-completions", chosen?.first?.id, weekStart, weekEnd,
                    (chosen?.second ?: 0).coerceAtMost(5), weeklyLaurels)
            }
            else -> put("weekly", "weekly-completions", null, weekStart, weekEnd,
                attainable(null, weekDates).coerceAtMost(10), weeklyLaurels)
        }

        val (monthStart, monthEnd) = month(today)
        put("epic", "epic-completions", null, monthStart, monthEnd,
            attainable(null, dates(monthStart, monthEnd)).coerceAtMost(30), epicLaurels)
        return normalize(quests.values.toList())
    }

    fun reconcileRewards(quests: List<HabitQuest>, rewards: List<RewardTransaction>): List<RewardTransaction> {
        val ledger = Rewards.normalize(rewards).toMutableList()
        val known = ledger.map { it.idempotencyKey }.toMutableSet()
        quests.filter { it.completedAt != null }.forEach { quest ->
            val key = "quest:self:${quest.id}"
            if (known.add(key)) ledger += Rewards.create(quest.rewardLaurels.toDouble(),
                when (quest.cadence) { "epic" -> "epic-quest"; "weekly" -> "weekly-quest"; else -> "daily-quest" },
                quest.id, key, quest.completedAt!!)
        }
        return Rewards.normalize(ledger)
    }

    fun current(items: List<HabitQuest>, today: LocalDate) = normalize(items)
        .filter { it.startDate <= today && it.endDate >= today }
        .sortedBy { when (it.cadence) { "daily" -> 0; "weekly" -> 1; else -> 2 } }
}
