package ru.genesis.calendar.reminders

import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HabitNotificationCopyTest {
    @Test fun notificationTonesProduceDistinctRussianAndEnglishPreviews() {
        val tones = listOf("calm", "heroic", "ironic")
        val russian = tones.map { habitNotificationBody(it, "habit", 1, false) }
        val english = tones.map { habitNotificationBody(it, "habit", 1, true) }
        assertTrue(russian.all(String::isNotBlank))
        assertTrue(english.all(String::isNotBlank))
        assertNotEquals(russian[0], russian[1])
        assertNotEquals(russian[1], russian[2])
        assertNotEquals(english[0], english[1])
        assertNotEquals(english[1], english[2])
    }

    @Test fun dailyGoalKeepsMeaningfulCountButPracticeLabelHasNoCounterSuffix() {
        assertTrue(habitNotificationBody("heroic", "goal", 1, false).contains("1"))
        assertTrue(!habitNotificationBody("ironic", "habit", 3, false).contains("(3)"))
        assertTrue(!habitNotificationBody("calm", "habit", 3, true).contains("(3)"))
    }

    @Test fun eachToneVariesAcrossDaysWithoutTonePrefixes() {
        listOf("calm", "heroic", "ironic").forEach { tone ->
            listOf(false, true).forEach { english ->
                val messages = (1..100).map { habitNotificationBody(tone, "habit", 1, english, "day-$it", "Reading") }
                assertTrue(messages.distinct().size >= 8)
                assertTrue(messages.all { !it.contains("Героический зов:") && !it.contains("Спокойное напоминание:") && !it.contains("Heroic call:") })
                assertTrue(messages.all { it.contains("Reading") })
            }
        }
    }
}
