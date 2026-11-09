package ru.genesis.calendar.domain

import java.text.Normalizer
import java.time.Instant
import java.time.LocalDate
import java.util.Locale
import ru.genesis.calendar.domain.habits.HabitCompletion
import ru.genesis.calendar.domain.habits.Habit
import ru.genesis.calendar.domain.habits.HabitLifecycle
import ru.genesis.calendar.domain.habits.TrackerSchedule

data class RestorationLetter(val id: String, val symbol: String, val value: Int)
data class RestorationSupport(val id: String, val word: String, val value: Int)
data class RestorationEquation(val target: Int, val supportTotal: Int, val requiredRoot: Int,
    val supports: List<RestorationSupport>, val candidates: List<RestorationLetter>)
data class RestorationDrawCard(val letterId: String, val reversed: Boolean)

/** Optional cross-platform habit metadata. The original draw is never changed by a practice. */
data class StoicheionRestorationSnapshot(
    val version: Int = 1, val cycleId: String, val startedAt: String, val startedDate: String,
    val sourceDate: String, val sourceSeed: Long, val cards: List<RestorationDrawCard>,
    val sectorId: String, val letterId: String, val need: String, val supportIds: List<String>,
    val resourceLetterId: String, val practiceId: String, val spreadTotal: Int, val pythmen: Int,
    val intention: String, val action: String, val practiceText: String, val reflection: String = "",
    val excludeStartDate: Boolean = false,
)

/** Authorial GENESIS rule, using ancient letter values; not a surviving ancient ritual. */
object StoicheionRestoration {
    private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
    val positions = listOf("northwest", "north", "northeast", "west", "center", "east", "southwest", "south", "southeast")
    val needs = listOf("deficit", "excess", "conflict")
    val letters = listOf(
        RestorationLetter("alpha", "Α", 1), RestorationLetter("beta", "Β", 2),
        RestorationLetter("gamma", "Γ", 3), RestorationLetter("delta", "Δ", 4),
        RestorationLetter("epsilon", "Ε", 5), RestorationLetter("zeta", "Ζ", 7),
        RestorationLetter("eta", "Η", 8), RestorationLetter("theta", "Θ", 9),
        RestorationLetter("iota", "Ι", 10), RestorationLetter("kappa", "Κ", 20),
        RestorationLetter("lambda", "Λ", 30), RestorationLetter("mu", "Μ", 40),
        RestorationLetter("nu", "Ν", 50), RestorationLetter("xi", "Ξ", 60),
        RestorationLetter("omicron", "Ο", 70), RestorationLetter("pi", "Π", 80),
        RestorationLetter("rho", "Ρ", 100), RestorationLetter("sigma", "Σ", 200),
        RestorationLetter("tau", "Τ", 300), RestorationLetter("upsilon", "Υ", 400),
        RestorationLetter("phi", "Φ", 500), RestorationLetter("chi", "Χ", 600),
        RestorationLetter("psi", "Ψ", 700), RestorationLetter("omega", "Ω", 800),
    )
    val lettersById = letters.associateBy { it.id }
    val supports = listOf(
        RestorationSupport("entrance", "Αὐγή", 412), RestorationSupport("zenith", "Τάξις", 571),
        RestorationSupport("nadir", "Βάθος", 282), RestorationSupport("hearth", "Ἕδρα", 110),
        RestorationSupport("exit", "Σφραγίς", 1014),
    )
    val practiceIds = setOf("athena-three-intentions", "athena-evening-counsel", "artemis-wild-walk",
        "artemis-boundary", "hermes-clear-message", "peitho-listening", "hephaestus-small-repair",
        "aglaea-beautiful-workspace", "ares-deliberate-movement", "aphrodite-care", "demeter-nourishing-meal",
        "demeter-living-care", "poseidon-water-pause", "amphitrite-emotion-log", "apollo-morning-light",
        "apollo-harmonic-study", "ariadne-thread-journal", "dionysus-living-gesture", "zeus-sovereign-rule",
        "hera-kept-covenant", "persephone-new-seed", "hades-hidden-treasure", "hestia-tended-hearth",
        "hestia-five-quiet-minutes", "aether-clear-threshold", "hemera-first-light", "psyche-evening-seal",
        "eros-grateful-return")
    private val greekValues = mapOf('α' to 1, 'β' to 2, 'γ' to 3, 'δ' to 4, 'ε' to 5, 'ϛ' to 6, 'ϝ' to 6,
        'ζ' to 7, 'η' to 8, 'θ' to 9, 'ι' to 10, 'κ' to 20, 'λ' to 30, 'μ' to 40, 'ν' to 50, 'ξ' to 60,
        'ο' to 70, 'π' to 80, 'ϟ' to 90, 'ϙ' to 90, 'ρ' to 100, 'σ' to 200, 'ς' to 200, 'τ' to 300,
        'υ' to 400, 'φ' to 500, 'χ' to 600, 'ψ' to 700, 'ω' to 800, 'ϡ' to 900, 'ͳ' to 900)

    private fun positive(value: Long) { require(value in 1..MAX_SAFE_INTEGER) }
    private fun add(left: Long, right: Long) = Math.addExact(left, right).also(::positive)
    fun root(value: Long): Int { positive(value); return ((value - 1) % 9 + 1).toInt() }
    fun trace(value: Long): List<Long> {
        positive(value)
        val result = mutableListOf(value)
        while (result.last() > 9) result += result.last().toString().sumOf { it.digitToInt().toLong() }
        return result
    }
    fun isopsephy(word: String): Long {
        val normalized = Normalizer.normalize(word, Normalizer.Form.NFD).replace(Regex("\\p{M}"), "")
            .lowercase(Locale.ROOT).trim()
        require(normalized.isNotEmpty())
        return normalized.fold(0L) { total, letter -> add(total, requireNotNull(greekValues[letter]).toLong()) }
    }
    fun equation(cardValue: Int, spreadTotal: Int, supportIds: List<String>): RestorationEquation {
        positive(cardValue.toLong()); positive(spreadTotal.toLong())
        require(supportIds.all { id -> supports.any { it.id == id } })
        val chosen = supports.filter { it.id in supportIds }
        val supportTotal = chosen.sumOf { it.value }
        val target = root(spreadTotal.toLong())
        val requiredRoot = (target - root(cardValue.toLong() + supportTotal) + 8) % 9 + 1
        return RestorationEquation(target, supportTotal, requiredRoot, chosen,
            letters.filter { root(it.value.toLong()) == requiredRoot })
    }
    fun cycleId(date: String, seed: Long, sectorId: String, letterId: String) = "$date:$seed:$sectorId:$letterId"

    fun visibleHabits(habits: List<Habit>) = habits.filter {
        it.stoicheionRestoration != null && HabitLifecycle.state(it).status != "deleted"
    }
    fun habitById(habits: List<Habit>, habitId: String?) = visibleHabits(habits).firstOrNull { it.id == habitId }
    fun eligibleHabits(habits: List<Habit>) = habits.filter {
        it.active && HabitLifecycle.state(it).status == "active" && it.stoicheionRestoration == null && it.sacredPracticeId == null && it.practiceGoal == null &&
            it.schedule.recurrence.enabled && it.measurement == null && it.intervalSchedule == null &&
            it.periodGoal == null && it.scoringMode in listOf("none", "binary")
    }
    /** Every day inside the finite practice window remains an opportunity until completion. */
    fun dailySchedule(schedule: TrackerSchedule): TrackerSchedule {
        val recurrence = schedule.recurrence
        val (pattern, days) = when (recurrence.mode) {
            "classic" -> "daily" to (1..7).toList()
            "genesis" -> "pyata-days" to (1..5).toList()
            "lunar" -> "lunar-days" to (1..30).toList()
            else -> error("INVALID_RESTORATION_CALENDAR")
        }
        return schedule.copy(recurrence = recurrence.copy(enabled = true, pattern = pattern, days = days, interval = 1,
            months = emptyList(), pyatas = emptyList()))
    }
    fun canAttach(habits: List<Habit>, habitId: String, previous: StoicheionRestorationSnapshot?,
        snapshot: StoicheionRestorationSnapshot) = previous != null || visibleHabits(habits).none {
        it.id != habitId && it.stoicheionRestoration?.cycleId == snapshot.cycleId
    }

    /** Ten distinct, real completed days after this cycle began. Future and old marks do not count. */
    fun completionDates(snapshot: StoicheionRestorationSnapshot, habitId: String,
        completions: List<HabitCompletion>, today: LocalDate): List<LocalDate> {
        val started = Instant.parse(snapshot.startedAt)
        val firstDay = LocalDate.parse(snapshot.startedDate)
        return completions.asSequence().filter { it.habitId == habitId && it.completed && it.date >= firstDay && it.date <= today }
            .filter { !snapshot.excludeStartDate || it.date != firstDay }
            .filter { runCatching { Instant.parse(it.entity.updatedAt) >= started }.getOrDefault(false) }
            .map { it.date }.distinct().sorted().take(10).toList()
    }
}
