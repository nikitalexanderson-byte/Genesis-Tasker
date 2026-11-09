package ru.genesis.calendar.domain.habits

import java.time.LocalDate

data class StreakFreezeTransaction(val amount: Int, val reason: String, val sourceId: String,
    val idempotencyKey: String, val createdAt: String)

data class ComebackSummary(val active: Boolean, val triggerDate: LocalDate?, val progress: Int,
    val lastCompletedDate: LocalDate?)

/** Local equivalent of app/streak-protection.ts. These records are not cloud-sync transactions. */
object StreakProtection {
    const val sparkCost = 120
    const val sparkMax = 2
    const val comebackTarget = 3
    const val comebackReward = 15

    fun normalize(items: List<StreakFreezeTransaction>): List<StreakFreezeTransaction> {
        val known = linkedMapOf<String, StreakFreezeTransaction>()
        items.forEach { item ->
            if (item.idempotencyKey.isBlank() || item.sourceId.isBlank() ||
                item.reason !in setOf("purchase", "automatic-use") ||
                item.amount !in setOf(1, -1)) return@forEach
            if ((known[item.idempotencyKey]?.createdAt ?: "~") > item.createdAt)
                known[item.idempotencyKey] = item
        }
        return known.values.sortedWith(compareBy<StreakFreezeTransaction> { it.createdAt }
            .thenBy { it.idempotencyKey })
    }

    fun count(items: List<StreakFreezeTransaction>) = normalize(items).fold(0) { balance, item ->
        (balance + item.amount).coerceIn(0, sparkMax)
    }

    fun purchase(rewards: List<RewardTransaction>, freezes: List<StreakFreezeTransaction>,
        purchaseId: String, timestamp: String): Pair<List<RewardTransaction>, List<StreakFreezeTransaction>> {
        val ledger = Rewards.normalize(rewards)
        val items = normalize(freezes)
        val key = "hestia-spark-purchase:self:$purchaseId"
        if (items.any { it.idempotencyKey == key }) return ledger to items
        require(count(items) < sparkMax) { "Запас Искр Гестии уже заполнен." }
        require(Rewards.balance(ledger) >= sparkCost) { "Для Искры Гестии нужно $sparkCost Лавров." }
        return Rewards.normalize(ledger + Rewards.create(-sparkCost.toDouble(), "hestia-spark",
            purchaseId, key, timestamp)) to normalize(items + StreakFreezeTransaction(1,
            "purchase", purchaseId, key, timestamp))
    }

    fun protect(records: List<DailyGoalRecord>, existing: List<StreakFreezeTransaction>,
        protectableDates: Set<LocalDate>, today: LocalDate, timestamp: String):
        Pair<List<DailyGoalRecord>, List<StreakFreezeTransaction>> {
        var transactions = normalize(existing)
        var available = count(transactions)
        var running = 0
        val result = DailyGoals.normalize(records).map { record ->
            if (record.date > today) return@map record
            if (record.status == "qualified" || record.status == "perfect") {
                running++
                return@map record
            }
            if (record.status == "protected" || record.status != "missed") return@map record
            val key = "hestia-spark-use:self:${record.date}"
            if (transactions.any { it.idempotencyKey == key }) return@map record.copy(status = "protected")
            if (record.date !in protectableDates || running == 0 || available == 0) {
                running = 0
                return@map record
            }
            transactions = normalize(transactions + StreakFreezeTransaction(-1, "automatic-use",
                record.date.toString(), key, timestamp))
            available = (available - 1).coerceAtLeast(0)
            record.copy(status = "protected", updatedAt = timestamp)
        }
        return DailyGoals.normalize(result) to transactions
    }

    private fun comebackCompletions(records: List<DailyGoalRecord>, today: LocalDate):
        Pair<Pair<LocalDate, Int>?, List<Pair<LocalDate, LocalDate>>> {
        var running = 0
        var active: Pair<LocalDate, Int>? = null
        val completions = mutableListOf<Pair<LocalDate, LocalDate>>()
        DailyGoals.normalize(records).forEach { record ->
            if (record.date > today) return@forEach
            if (record.status == "qualified" || record.status == "perfect") {
                running++
                active?.let { pending ->
                    val count = pending.second + 1
                    if (count >= comebackTarget) {
                        completions += pending.first to record.date
                        active = null
                    } else active = pending.first to count
                }
            } else if (record.status == "missed") {
                active = when {
                    active != null -> active!!.first to 0
                    running > 0 -> record.date to 0
                    else -> null
                }
                running = 0
            }
        }
        return active to completions
    }

    fun comebackSummary(records: List<DailyGoalRecord>, today: LocalDate): ComebackSummary {
        val (active, completed) = comebackCompletions(records, today)
        return ComebackSummary(active != null, active?.first, active?.second ?: 0,
            completed.lastOrNull()?.second)
    }

    fun reconcileComeback(records: List<DailyGoalRecord>, rewards: List<RewardTransaction>,
        today: LocalDate): List<RewardTransaction> {
        val result = Rewards.normalize(rewards).toMutableList()
        val known = result.map { it.idempotencyKey }.toMutableSet()
        comebackCompletions(records, today).second.forEach { (trigger, completed) ->
            val key = "comeback:self:$trigger"
            if (known.add(key)) result += Rewards.create(comebackReward.toDouble(), "comeback",
                trigger.toString(), key, "${completed}T23:59:59.000Z")
        }
        return Rewards.normalize(result)
    }
}
