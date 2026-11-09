package ru.genesis.calendar.domain.habits

import java.time.Instant
import java.time.LocalDate

data class HeroicRank(val id: String, val title: String, val titleEn: String, val threshold: Int, val color: String, val path: String)
data class HeroPathCheckpoint(val rankId: String, val rewardLaurels: Int, val title: String, val titleEn: String)
data class UserProgress(val lifetimeXp: Int = 0, val laurelsBalance: Int = 0, val currentRankId: String? = null,
    val hiddenHeroicPathRevealedAt: String? = null, val currentStreak: Int = 0, val longestStreak: Int = 0,
    val lastQualifiedDate: LocalDate? = null, val streakGoalMode: String = "rhythm", val streakFreezeCount: Int = 0,
    val rhythmScore: Int = 0, val updatedAt: String = "", val grossLifetimeXp: Int? = null, val forfeitedHabitXp: Int? = null)

object HeroProgress {
    const val MAX_HABIT_XP_PER_COMPLETION = 20
    val unranked = HeroicRank("unranked","Путь ещё не начат","The path has not begun",0,"#70736d","overture")
    val checkpoints = listOf(
        HeroPathCheckpoint("icarus", 15, "Амфора стремления", "Amphora of aspiration"),
        HeroPathCheckpoint("mountain-tamer", 25, "Амфора стойкости", "Amphora of resolve"),
        HeroPathCheckpoint("iron-charioteer", 40, "Амфора мастерства", "Amphora of mastery"),
        HeroPathCheckpoint("risen-from-the-abyss", 60, "Амфора бездны", "Amphora of the abyss"),
        HeroPathCheckpoint("golden-argonaut", 90, "Амфора странствия", "Amphora of passage"),
        HeroPathCheckpoint("arcadian-arrow", 130, "Амфора точности", "Amphora of precision"),
        HeroPathCheckpoint("spear-of-athena", 180, "Амфора мудрости", "Amphora of wisdom"),
        HeroPathCheckpoint("calydonian-glory-bearer", 260, "Амфора славы", "Amphora of glory"),
    )
    fun hiddenUnlocked(xp: Int) = xp >= 10_500
    fun hiddenRevealed(progress: UserProgress) = hiddenUnlocked(progress.lifetimeXp) && validTimestamp(progress.hiddenHeroicPathRevealedAt)
    fun highestRank(xp: Int): HeroicRank? = HeroRankCatalog.ranks.lastOrNull { xp.coerceAtLeast(0) >= it.threshold }
    fun nextRank(xp: Int): HeroicRank? = HeroRankCatalog.ranks.firstOrNull { xp.coerceAtLeast(0) < it.threshold }
    fun visibleRanks(progress: UserProgress) = HeroRankCatalog.ranks.filter { hiddenRevealed(progress) || it.path != "hidden" }
    fun rankForProgress(progress: UserProgress) = visibleRanks(progress).lastOrNull { progress.lifetimeXp.coerceAtLeast(0) >= it.threshold } ?: unranked
    fun nextRankForProgress(progress: UserProgress) = visibleRanks(progress).firstOrNull { progress.lifetimeXp.coerceAtLeast(0) < it.threshold }

    /** Lifetime XP never decreases when an entry is unchecked/removed. This operation
     * consumes per-completion awards; it does not add today's score on every call.
     */
    fun reconcile(previous: UserProgress, awards: List<Int>, timestamp: String, streak: DailyGoalStreak? = null,
        laurelsBalance: Int = previous.laurelsBalance, streakFreezeCount: Int = previous.streakFreezeCount,
        rhythmScore: Int = previous.rhythmScore): UserProgress {
        val gross=maxOf(previous.grossLifetimeXp ?: previous.lifetimeXp.coerceAtLeast(0),awards.sumOf { it.coerceAtLeast(0) })
        val xp=(gross-(previous.forfeitedHabitXp ?: 0)).coerceAtLeast(0)
        val current=streak?.currentStreak ?: previous.currentStreak.coerceAtLeast(0)
        val next=previous.copy(lifetimeXp=xp,laurelsBalance=laurelsBalance,currentRankId=highestRank(xp)?.id,
            grossLifetimeXp=if(previous.grossLifetimeXp != null || previous.forfeitedHabitXp != null) gross else null,
            hiddenHeroicPathRevealedAt=previous.hiddenHeroicPathRevealedAt.takeIf(::validTimestamp),
            currentStreak=current,longestStreak=maxOf(streak?.longestStreak ?: previous.longestStreak.coerceAtLeast(0),current),
            lastQualifiedDate=streak?.lastQualifiedDate ?: previous.lastQualifiedDate,
            streakGoalMode=previous.streakGoalMode.takeIf { it in DailyGoals.modes } ?: "rhythm",
            streakFreezeCount=streakFreezeCount.coerceIn(0,2),rhythmScore=rhythmScore.coerceIn(0,100))
        return next.copy(updatedAt=if(next == previous && previous.updatedAt.isNotEmpty()) previous.updatedAt else timestamp)
    }

    private fun validTimestamp(value: String?): Boolean = value != null && runCatching { Instant.parse(value) }.isSuccess
}
