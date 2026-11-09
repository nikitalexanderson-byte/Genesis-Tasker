package ru.genesis.calendar.domain.habits

import org.json.JSONObject
import ru.genesis.calendar.auth.adviceCategories
import ru.genesis.calendar.auth.adviceTopics
import java.text.Normalizer
import java.time.LocalDate
import java.util.Locale

/** Identical dictionaries and bounded numeric signals to web; habit text never leaves the device. */
internal data class AdviceTaskSignal(val title: String, val description: String, val done: Boolean, val date: String, val entryType: String = "task")

internal object AdviceAffinity {
    private val separator = Regex("[^\\p{L}\\p{N}]+")
    // Android 9's ICU rejects Java's IsHan/IsHiragana regex aliases.
    private fun containsCjk(value: String): Boolean {
        var offset = 0
        while (offset < value.length) {
            val point = value.codePointAt(offset)
            val script = Character.UnicodeScript.of(point)
            if (script == Character.UnicodeScript.HAN || script == Character.UnicodeScript.HIRAGANA ||
                script == Character.UnicodeScript.KATAKANA) return true
            offset += Character.charCount(point)
        }
        return false
    }
    private val shortLatin = Regex("[a-z]+")
    fun context(habits: List<Habit>, day: LocalDate, smart: Boolean, categories: JSONObject, topics: JSONObject,
        tasks: List<AdviceTaskSignal> = emptyList()): JSONObject {
        val scores = JSONObject(); val topicScores = JSONObject()
        if (!smart && tasks.isEmpty()) return JSONObject().put("scores", scores).put("topics", topicScores)
        adviceCategories.forEach { scores.put(it, 0.0) }; adviceTopics.forEach { topicScores.put(it, 0.0) }
        for (habit in if (smart) habits else emptyList()) {
            val state = HabitLifecycle.state(habit, day)
            if (state.status != "active" || state.conflict || habit.createdDate > day || habit.schedule.startDate > day ||
                habit.schedule.endDate?.let { it < day } == true) continue
            val tokens = Normalizer.normalize(habit.title + " " + habit.description + " " + habit.ritualName,
                Normalizer.Form.NFKC).lowercase(Locale.ROOT).split(separator)
            val weight = 1.0 + (if (habit.isKeyHabit) 1 else 0) + habit.priority.coerceIn(0, 3) / 3.0
            fun score(rule: JSONObject, sectors: Boolean): Double {
                fun match(key: String, value: String?) = value != null && rule.optJSONArray(key)?.let { rows ->
                    (0 until rows.length()).any { rows.getString(it) == value }
                } == true
                val words = rule.getJSONArray("words")
                val matches = (0 until words.length()).count { index ->
                    val word = words.getString(index)
                    tokens.any { token -> when {
                        containsCjk(word) -> token.contains(word)
                        word.length <= 4 && shortLatin.matches(word) -> token == word
                        else -> token.startsWith(word)
                    } }
                }.coerceAtMost(3)
                return weight * ((if (match("templates", habit.sourceTemplateId)) 3 else 0) +
                    (if (sectors && match("sectors", habit.sacredSectorId)) 2 else 0) + matches)
            }
            adviceCategories.forEach { scores.put(it, (scores.getDouble(it) + score(categories.getJSONObject(it), true)).coerceAtMost(1000.0)) }
            adviceTopics.forEach { topicScores.put(it, (topicScores.getDouble(it) + score(topics.getJSONObject(it), false)).coerceAtMost(1000.0)) }
        }
        for (task in tasks) {
            if (task.done || task.entryType != "task") continue
            val due = runCatching { LocalDate.parse(task.date) }.getOrNull()
            if (due != null && due > day.plusDays(30)) continue
            val tokens = Normalizer.normalize(task.title + " " + task.description, Normalizer.Form.NFKC).lowercase(Locale.ROOT).split(separator)
            fun wordsMatch(words: List<String>) = words.count { word -> tokens.any { token -> when {
                containsCjk(word) -> token.contains(word)
                word.length <= 4 && shortLatin.matches(word) -> token == word
                else -> token.startsWith(word)
            } } }
            for (topic in listOf("clothing", "attributes", "cleaning", "home_order")) {
                val rule = topics.getJSONObject(topic)
                fun words(name: String): List<String> = rule.optJSONArray(name)?.let { array ->
                    (0 until array.length()).map { array.getString(it) }
                } ?: emptyList()
                var matches = wordsMatch(words("words"))
                if (topic == "clothing" && wordsMatch(words("shoppingExclusions")) == 0)
                    matches += wordsMatch(words("shoppingWords"))
                val count = matches.coerceAtMost(3)
                if (count > 0) {
                    topicScores.put(topic, (topicScores.getDouble(topic) + count * 4).coerceAtMost(1000.0))
                    scores.put("hestiology", (scores.getDouble("hestiology") + 4).coerceAtMost(1000.0))
                }
            }
            val attributeRule = topics.getJSONObject("attributes")
            fun attributeWords(name: String): List<String> = attributeRule.optJSONArray(name)?.let { array ->
                (0 until array.length()).map { array.getString(it) }
            } ?: emptyList()
            if (wordsMatch(attributeWords("purchaseWords")) > 0 && wordsMatch(attributeWords("genericWords")) > 0) {
                topicScores.put("attributes", (topicScores.getDouble("attributes") + 8).coerceAtMost(1000.0))
                scores.put("hestiology", (scores.getDouble("hestiology") + 4).coerceAtMost(1000.0))
            }
        }
        return JSONObject().put("scores", scores).put("topics", topicScores)
    }
}
