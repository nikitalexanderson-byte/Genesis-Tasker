package ru.genesis.calendar.domain.habits

import java.time.LocalDate

data class RewardTransaction(val id: String, val amount: Int, val reason: String, val sourceId: String,
    val idempotencyKey: String, val createdAt: String, val userId: String = "self", val currency: String = "laurels")

/** Port of app/rewards.ts. Rewards are immutable ledger entries, not a mutable counter. */
object Rewards {
    private fun instant(value: String): Long = runCatching { java.time.Instant.parse(value).toEpochMilli() }.getOrDefault(Long.MIN_VALUE)
    const val DAILY_GOAL_LAURELS = 5
    const val PERFECT_DAY_LAURELS = 3
    val resetReasons = setOf("habit-deleted-reset")
    private val reasons = setOf("daily-goal","perfect-day","daily-quest","weekly-quest","epic-quest",
        "streak-milestone","rank-up","achievement","comeback","hero-path-amphora","hestia-spark",
        "habit-mastery-retained","habit-deleted-reset","practice-expired")

    fun create(amount: Double, reason: String, sourceId: String, key: String, timestamp: String) =
        RewardTransaction("reward:$key",jsRound(amount),reason,sourceId,key,timestamp)

    fun normalize(items: List<RewardTransaction>): List<RewardTransaction> {
        val result = linkedMapOf<String,RewardTransaction>()
        items.forEach { item ->
            val key = item.idempotencyKey.trim(); val source = item.sourceId.trim()
            if(key.isEmpty() || source.isEmpty() || item.currency != "laurels" || item.reason !in reasons) return@forEach
            if(item.amount == 0 && item.reason !in resetReasons && item.reason != "habit-mastery-retained") return@forEach
            val transaction = item.copy(id=item.id.ifEmpty { "reward:$key" },sourceId=source,idempotencyKey=key,userId="self")
            if(result[key]?.let { instant(transaction.createdAt) < instant(it.createdAt) } != false) result[key]=transaction
        }
        return result.values.sortedWith(compareBy<RewardTransaction> { instant(it.createdAt) }
            .thenBy { if(it.reason in resetReasons) 1 else 0 }.thenBy { it.idempotencyKey })
    }

    fun balance(items: List<RewardTransaction>): Int = normalize(items).fold(0) { balance, tx ->
        if(tx.reason in resetReasons) 0 else balance+tx.amount
    }.coerceAtLeast(0)

    fun retainMastery(items: List<RewardTransaction>, habitId: String, timestamp: String): List<RewardTransaction> {
        val known=normalize(items); val key="habit-mastery-retained:self:$habitId"
        if(known.any { it.idempotencyKey==key }) return known
        return normalize(known+create(0.0,"habit-mastery-retained",habitId,key,timestamp))
    }

    fun reset(items: List<RewardTransaction>, reason: String, sourceId: String, key: String, timestamp: String): List<RewardTransaction> {
        require(reason in resetReasons)
        val known=normalize(items)
        if(known.any { it.idempotencyKey==key }) return known
        return normalize(known+create(-balance(known).toDouble(),reason,sourceId,key,timestamp))
    }

    fun laurelsForDailyGoal(status: String): Int = when(status) { "perfect" -> 8; "qualified" -> 5; else -> 0 }

    fun reconcileDailyGoals(records: List<DailyGoalRecord>, items: List<RewardTransaction>, today: LocalDate): List<RewardTransaction> {
        val transactions=normalize(items).toMutableList()
        val known=transactions.map { it.idempotencyKey }.toMutableSet()
        records.sortedBy { it.date }.forEach { record ->
            if(record.date > today || record.status !in setOf("qualified","perfect")) return@forEach
            fun award(reason: String, amount: Int) {
                val key="$reason:self:${record.date}"
                if(known.add(key)) transactions+=create(amount.toDouble(),reason,record.date.toString(),key,
                    record.updatedAt.ifEmpty { "${record.date}T00:00:00.000Z" })
            }
            award("daily-goal",5)
            if(record.status=="perfect") award("perfect-day",3)
        }
        return normalize(transactions)
    }
}

data class StreakRewardMilestone(val days: Int, val laurels: Int, val title: String)

/** Guaranteed, once-only rewards from app/streak-rewards.ts. A missed day does not erase Laurels. */
object StreakRewards {
    val milestones = listOf(
        StreakRewardMilestone(3, 5, "Первая нить"),
        StreakRewardMilestone(7, 12, "Семь восходов"),
        StreakRewardMilestone(14, 20, "Укреплённый ритм"),
        StreakRewardMilestone(30, 40, "Железный месяц"),
        StreakRewardMilestone(50, 60, "Пятьдесят шагов"),
        StreakRewardMilestone(100, 100, "Стодневный путь"),
        StreakRewardMilestone(180, 160, "Полугодовой круг"),
        StreakRewardMilestone(365, 300, "Полный оборот"),
        StreakRewardMilestone(500, 450, "Пятьсот восходов"),
        StreakRewardMilestone(1000, 1000, "Тысяча дней пути"),
    )

    fun reachedDates(records: List<DailyGoalRecord>): Map<Int, LocalDate> {
        val reached = mutableMapOf<Int, LocalDate>()
        var streak = 0
        DailyGoals.normalize(records).forEach { record ->
            when (record.status) {
                "qualified", "perfect" -> {
                    streak++
                    if (milestones.any { it.days == streak }) reached[streak] = record.date
                }
                "missed" -> streak = 0
            }
        }
        return reached
    }

    fun reconcile(records: List<DailyGoalRecord>, items: List<RewardTransaction>): List<RewardTransaction> {
        val ledger = Rewards.normalize(items).toMutableList()
        val known = ledger.map { it.idempotencyKey }.toMutableSet()
        val reached = reachedDates(records)
        milestones.forEach { milestone ->
            val date = reached[milestone.days] ?: return@forEach
            val key = "streak-milestone:self:${milestone.days}"
            if (known.add(key)) ledger += Rewards.create(milestone.laurels.toDouble(), "streak-milestone",
                milestone.days.toString(), key, "${date}T23:59:58.000Z")
        }
        return Rewards.normalize(ledger)
    }
}

/** Web claimHeroPathAmphora: claimable once after the matching XP threshold. */
object HeroPathRewards {
    fun claim(progress: UserProgress, items: List<RewardTransaction>, rankId: String,
        timestamp: String): List<RewardTransaction> {
        val checkpoint = HeroProgress.checkpoints.firstOrNull { it.rankId == rankId }
            ?: throw IllegalArgumentException("Амфора не найдена.")
        val rank = HeroRankCatalog.ranks.firstOrNull { it.id == rankId }
            ?: throw IllegalArgumentException("Ранг не найден.")
        require(progress.lifetimeXp >= rank.threshold) { "Этот рубеж ещё не достигнут." }
        val ledger = Rewards.normalize(items)
        val key = "hero-path-amphora:self:$rankId"
        if (ledger.any { it.idempotencyKey == key }) return ledger
        return Rewards.normalize(ledger + Rewards.create(checkpoint.rewardLaurels.toDouble(),
            "hero-path-amphora", rankId, key, timestamp))
    }
}
