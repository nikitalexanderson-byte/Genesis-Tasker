package ru.genesis.calendar.domain.habits

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.adviceCategories
import ru.genesis.calendar.auth.adviceTopics
import ru.genesis.calendar.domain.RecurrenceConfig
import java.time.LocalDate

class AdviceAffinityTest {
    private val day = LocalDate.parse("2026-10-23")
    private fun habit(title: String) = Habit(TrackerEntity("habit", "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z"),
        title, day.minusDays(1), TrackerSchedule(day.minusDays(1), timezone = "Europe/Moscow", recurrence = RecurrenceConfig()),
        priority = 0, sourceTemplateId = "water", sacredSectorId = "body", isKeyHabit = true)
    private fun rules(ids: List<String>, words: List<String>) = JSONObject().apply {
        ids.forEach { put(it, JSONObject().put("words", JSONArray(words)).put("templates", JSONArray().put("water"))
            .put("sectors", JSONArray().put("body"))) }
    }
    @Test fun privateNamesNeverLeaveTheDeviceAndSignalsHaveTheSameBoundedWeightsAsWeb() {
        val context = AdviceAffinity.context(listOf(habit("private eating 筋力トレーニング")),
            day, true, rules(adviceCategories, listOf("eat", "private", "筋力")), rules(adviceTopics, listOf("eat", "private", "筋力")))
        assertEquals(setOf("scores", "topics"), context.keys().asSequence().toSet())
        assertEquals(14.0, context.getJSONObject("scores").getDouble("aretology"), .0001)
        assertEquals(10.0, context.getJSONObject("topics").getDouble("training"), .0001)
        assertFalse(context.toString().contains("private")); assertFalse(context.toString().contains("habit"))
        val many = AdviceAffinity.context(List(1000) { habit("private") }, day, true,
            rules(adviceCategories, listOf("private")), rules(adviceTopics, listOf("private")))
        assertEquals(1000.0, many.getJSONObject("scores").getDouble("aretology"), 0.0)
    }
    @Test fun pauseFutureDatesAndManualChoiceExcludeHabitSignals() {
        val rows = listOf(habit("private").copy(active = false),
            habit("private").copy(createdDate = day.plusDays(1)),
            habit("private").copy(schedule = habit("private").schedule.copy(endDate = day.minusDays(1))))
        val result = AdviceAffinity.context(rows, day, true, rules(adviceCategories, listOf("private")), rules(adviceTopics, listOf("private")))
        assertEquals(0.0, result.getJSONObject("scores").getDouble("aretology"), 0.0)
        val manual = AdviceAffinity.context(listOf(habit("private")), day, false, JSONObject(), JSONObject())
        assertEquals(0, manual.getJSONObject("scores").length()); assertEquals(0, manual.getJSONObject("topics").length())
    }
    @Test fun privateTaskIntentionsWorkInManualModeAndIgnoreFinishedOrDistantPlans() {
        val topics = rules(adviceTopics, emptyList()).apply {
            put("clothing", JSONObject().put("words", JSONArray().put("clothes"))
                .put("shoppingWords", JSONArray().put("shopping")).put("shoppingExclusions", JSONArray().put("groceries")))
            put("cleaning", JSONObject().put("words", JSONArray().put("уборк")))
        }
        fun signals(title: String, done: Boolean = false, date: String = day.toString(), type: String = "task") =
            AdviceAffinity.context(emptyList(), day, false, JSONObject(), topics,
                listOf(AdviceTaskSignal(title, "", done, date, type))).getJSONObject("topics")
        assertTrue(signals("Buy clothes").getDouble("clothing") > 0)
        assertTrue(signals("Запланировать уборку").getDouble("cleaning") > 0)
        assertTrue(signals("Go shopping").getDouble("clothing") > 0)
        assertEquals(0.0, signals("Shopping for groceries").getDouble("clothing"), 0.0)
        assertTrue(signals("Shopping for clothes and groceries").getDouble("clothing") > 0)
        assertEquals(0.0, signals("Buy clothes", done = true).getDouble("clothing"), 0.0)
        assertEquals(0.0, signals("Buy clothes", date = day.plusDays(31).toString()).getDouble("clothing"), 0.0)
        assertEquals(0.0, signals("Buy clothes", type = "birthday").getDouble("clothing"), 0.0)
    }
}
