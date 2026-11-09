package ru.genesis.calendar.domain.trackers

import java.time.LocalDate
import ru.genesis.calendar.domain.habits.TrackerEntity
import ru.genesis.calendar.domain.habits.jsRound

data class MoodOption(val value: Int, val label: String, val labelEn: String, val symbol: String, val color: String)
data class MoodEntry(val entity: TrackerEntity, val date: LocalDate, val recordedAt: String,
    val moodValue: Int, val note: String = "", val tags: List<String> = emptyList(),
    val customLabel: String = "", val customEmoji: String = "")

object MoodTracker {
    private val legacy=mapOf("overwhelmed" to -5,"empty" to -4,"angry" to -3,"irritated" to -2,"anxious" to -2,
        "sad" to -3,"tired" to -1,"neutral" to 0,"tender" to 1,"curious" to 2,"grateful" to 3,"confident" to 3,
        "focused" to 2,"calm" to 1,"joy" to 4,"radiant" to 5,"custom" to 0)
    fun normalizedValue(value: Double? = null,legacyId: String? = null): Int {
        require(value==null||value.isFinite())
        return (value?.let(::jsRound) ?: legacy[legacyId ?: "neutral"] ?: 0).coerceIn(-5,6)
    }
    fun option(value: Double): MoodOption = MoodCatalog.options[normalizedValue(value)+5]
    fun entry(entity: TrackerEntity,date: LocalDate,recordedAt: String,value: Double?,legacyId: String? = null,
        note: String = "",tags: List<String> = emptyList(),customLabel: String = "",customEmoji: String = ""): MoodEntry =
        MoodEntry(entity,date,recordedAt,normalizedValue(value,legacyId),note,tags.take(20),
            customLabel.trim().take(40),customEmoji.trim().take(16))
    /** Last entry with the same ID wins, while distinct same-day observations remain. */
    fun normalizeEntries(entries: List<MoodEntry>): List<MoodEntry> {
        val result=linkedMapOf<String,MoodEntry>()
        entries.forEach { result[it.entity.id]=it.copy(moodValue=it.moodValue.coerceIn(-5,6),tags=it.tags.take(20),
            customLabel=it.customLabel.trim().take(40),customEmoji=it.customEmoji.trim().take(16)) }
        return result.values.toList()
    }
}
