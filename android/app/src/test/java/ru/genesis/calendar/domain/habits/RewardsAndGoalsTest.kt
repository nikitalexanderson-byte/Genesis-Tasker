package ru.genesis.calendar.domain.habits

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

class RewardsAndGoalsTest {
    private val today=LocalDate.of(2026,9,23)
    private val stamp="2026-09-23T10:00:00.000Z"
    private fun history() = webHistoryStatuses.mapIndexed { index,status ->
        val date=LocalDate.of(2026,9,15+index)
        DailyGoalRecord(date,"rhythm","Europe/Moscow",5,when(status) { "perfect" -> 5; "qualified" -> 3; else -> 0 },3,status,"${date}T10:00:00.000Z")
    }

    @Test fun dailyGoalRecordsMatch60ActualWebVectors() {
        webDailyGoalVectors.forEach { line ->
            val v=line.split('|')
            val actual=DailyGoals.build(today.minusDays(1),v[0],"Europe/Moscow",v[1].toDouble(),v[2].toDouble(),today,stamp)
            assertEquals(line,listOf(v[0],v[1],v[2],actual.scheduledCount,actual.completedCount,actual.targetCount,actual.status).joinToString("|"))
        }
    }

    @Test fun historyStreakAndRhythmMatchActualWeb() {
        val actual=DailyGoals.streak(history(),today)
        assertEquals(webHistoryStreak,listOf(actual.currentStreak,actual.longestStreak,actual.lastQualifiedDate.toString()))
        assertEquals(webHistoryRhythm,DailyGoals.rhythmScore(history(),today))
    }

    @Test fun rewardReplayDropsRetiredMissedResetAndRetainsMastery() {
        var ledger=Rewards.reconcileDailyGoals(history(),emptyList(),today)
        fun check(index: Int) { assertEquals(webRewardStages[index],"${Rewards.balance(ledger)}|${ledger.joinToString(";") { "${it.idempotencyKey}=${it.amount}" }}") }
        check(0)
        ledger=Rewards.reconcileDailyGoals(history(),ledger,today); check(1)
        ledger=Rewards.normalize(ledger + RewardTransaction("legacy-missed",-18,"habit-missed-reset",
            "h1","habit-missed-reset:self:h1:2026-09-23",stamp)); check(2)
        ledger=Rewards.retainMastery(ledger,"h1","2026-09-23T10:01:00.000Z"); check(3)
        ledger=Rewards.retainMastery(ledger,"h1","2026-09-23T10:02:00.000Z"); check(4)
    }

    @Test fun duplicateRewardUsesEarliestVersionAndZeroMarkersSurvive() {
        val original=Rewards.create(5.0,"daily-goal","2026-09-23","daily-goal:self:2026-09-23",stamp)
        val replay=original.copy(amount=999,createdAt="2026-09-23T11:00:00.000Z")
        assertEquals(listOf(original),Rewards.normalize(listOf(replay,original,replay)))
        assertEquals(emptyList<RewardTransaction>(),Rewards.normalize(listOf(original.copy(amount=0))))
        assertEquals(1,Rewards.reset(emptyList(),"habit-deleted-reset","h1","reset-h1",stamp).size)
    }

    @Test fun futureAndUnqualifiedRecordsDoNotAwardAndStatusPrecedenceIsPreserved() {
        val future=DailyGoals.build(today.plusDays(1),"perfect","UTC",1.0,1.0,today,stamp)
        assertEquals(emptyList<RewardTransaction>(),Rewards.reconcileDailyGoals(listOf(future),emptyList(),today))
        assertEquals("rest",DailyGoals.build(today,"easy","",1.0,1.0,today,stamp,true,true,true).status)
        assertEquals("timezone-shift",DailyGoals.build(today,"easy","",1.0,1.0,today,stamp,false,true,true).status)
        assertEquals("protected",DailyGoals.build(today,"easy","",1.0,1.0,today,stamp,false,false,true).status)
        assertEquals("open",DailyGoals.build(today,"perfect","UTC",2.0,0.0,today,stamp).status)
    }

    @Test fun streakMilestonesAreOnceOnlyAndKeepPriorAwardsAfterBreak() {
        val start = LocalDate.of(2026, 9, 1)
        val records = (0..7).map { offset ->
            val day = start.plusDays(offset.toLong())
            DailyGoalRecord(day, "rhythm", "Europe/Moscow", 1, if (offset == 7) 0 else 1,
                1, if (offset == 7) "missed" else "perfect", "${day}T12:00:00.000Z")
        }
        val ledger = StreakRewards.reconcile(records, emptyList())
        assertEquals(listOf("3", "7"), ledger.map { it.sourceId })
        assertEquals(17, Rewards.balance(ledger))
        assertEquals(ledger, StreakRewards.reconcile(records, ledger))
        assertEquals(ledger, StreakRewards.reconcile(records.take(4), ledger))
    }

    @Test fun legacyMissedResetIsIgnoredWithoutErasingLegitimateLaurels() {
        val original = Rewards.create(5.0, "daily-goal", "2026-09-23", "daily-goal:self:2026-09-23", stamp)
        val legacy = RewardTransaction("legacy", -5, "habit-missed-reset", "h1",
            "habit-missed:self:h1:2026-09-23", stamp)
        assertEquals(listOf(original), Rewards.normalize(listOf(original, legacy)))
        assertEquals(5, Rewards.balance(listOf(original, legacy)))
    }

    @Test fun amphoraRequiresItsRankAndCanBeClaimedOnlyOnce() {
        assertEquals(8, HeroProgress.checkpoints.size)
        assertThrows(IllegalArgumentException::class.java) {
            HeroPathRewards.claim(UserProgress(lifetimeXp = 159), emptyList(), "icarus", stamp)
        }
        val awarded = HeroPathRewards.claim(UserProgress(lifetimeXp = 160), emptyList(), "icarus", stamp)
        assertEquals(15, Rewards.balance(awarded))
        assertEquals(awarded, HeroPathRewards.claim(UserProgress(lifetimeXp = 999), awarded, "icarus", stamp))
        assertEquals("hero-path-amphora:self:icarus", awarded.single().idempotencyKey)
    }

    @Test fun hestiaPurchaseIsIdempotentCappedAndRequiresLaurels() {
        val awarded = listOf(Rewards.create(250.0, "comeback", "d1", "seed", stamp))
        assertThrows(IllegalArgumentException::class.java) {
            StreakProtection.purchase(emptyList(), emptyList(), "p1", stamp)
        }
        val first = StreakProtection.purchase(awarded, emptyList(), "p1", stamp)
        assertEquals(1, StreakProtection.count(first.second))
        assertEquals(130, Rewards.balance(first.first))
        assertEquals(first, StreakProtection.purchase(first.first, first.second, "p1", stamp))
        val second = StreakProtection.purchase(first.first, first.second, "p2", stamp)
        assertEquals(2, StreakProtection.count(second.second))
        assertEquals(10, Rewards.balance(second.first))
        assertThrows(IllegalArgumentException::class.java) {
            StreakProtection.purchase(second.first, second.second, "p3", stamp)
        }
    }

    @Test fun hestiaProtectsNewMissOnlyOnceWithoutFabricatingCompletionOrXp() {
        val start = LocalDate.of(2026, 9, 1)
        fun record(offset: Long, status: String) = DailyGoalRecord(start.plusDays(offset), "rhythm",
            "Europe/Moscow", 1, if (status == "perfect") 1 else 0, 1, status, stamp)
        val purchase = StreakFreezeTransaction(1, "purchase", "p1", "hestia-spark-purchase:self:p1", stamp)
        val records = listOf(record(0, "perfect"), record(1, "missed"), record(2, "perfect"))
        val protected = StreakProtection.protect(records, listOf(purchase),
            setOf(start.plusDays(1)), start.plusDays(2), stamp)
        assertEquals(listOf("perfect", "protected", "perfect"), protected.first.map { it.status })
        assertEquals(0, protected.first[1].completedCount)
        assertEquals(0, StreakProtection.count(protected.second))
        assertEquals(1, protected.second.count { it.reason == "automatic-use" })
        assertEquals(protected, StreakProtection.protect(protected.first, protected.second,
            emptySet(), start.plusDays(2), stamp))
        assertEquals(2, DailyGoals.streak(protected.first, start.plusDays(2)).currentStreak)
        val oldMiss = StreakProtection.protect(records, listOf(purchase), emptySet(),
            start.plusDays(2), stamp)
        assertEquals("missed", oldMiss.first[1].status)
        assertEquals(1, StreakProtection.count(oldMiss.second))
    }

    @Test fun comebackPaysOnceAfterThreeQualifiedDaysAndNeverRestoresOldStreak() {
        val start = LocalDate.of(2026, 9, 1)
        val statuses = listOf("perfect", "missed", "qualified", "perfect", "qualified")
        val records = statuses.mapIndexed { index, status ->
            DailyGoalRecord(start.plusDays(index.toLong()), "rhythm", "Europe/Moscow", 1,
                if (status in setOf("qualified", "perfect")) 1 else 0, 1, status, stamp)
        }
        val halfway = StreakProtection.comebackSummary(records.take(4), start.plusDays(3))
        assertTrue(halfway.active)
        assertEquals(2, halfway.progress)
        val ledger = StreakProtection.reconcileComeback(records, emptyList(), start.plusDays(4))
        assertEquals(15, Rewards.balance(ledger))
        assertEquals("comeback:self:${start.plusDays(1)}", ledger.single().idempotencyKey)
        assertEquals(ledger, StreakProtection.reconcileComeback(records, ledger, start.plusDays(4)))
        assertEquals(3, DailyGoals.streak(records, start.plusDays(4)).currentStreak)
        assertEquals(start.plusDays(4), StreakProtection.comebackSummary(records, start.plusDays(4)).lastCompletedDate)
    }

    @Test fun modeAndHistoryNormalizationChooseLatestTimestamp() {
        val changes=listOf(DailyGoalModeChange(today,"perfect",stamp),DailyGoalModeChange(today,"easy","2026-09-23T11:00:00.000Z"))
        assertEquals("easy",DailyGoals.modeForDate(DailyGoals.normalizeModeChanges(changes),today))
        val old=history().first()
        val newer=old.copy(status="qualified",updatedAt=stamp)
        assertEquals(listOf(newer),DailyGoals.normalize(listOf(newer,old)))
    }
}
