package ru.genesis.calendar.data

import org.junit.Assert.*
import org.junit.Test
import java.time.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.domain.trackers.*

class TrackersDocumentTest {
    private val date=LocalDate.of(2026,9,23)
    private val meta=TrackerEntity("plan1","2026-09-23T10:00:00.000Z","2026-09-23T10:00:00.000Z")
    private val schedule=HabitEngine(GenesisCalendar(ZoneId.of("Europe/Moscow"))).defaultSchedule(date,CalendarMode.SACRED)

    @Test fun oldCachedSleepMetricsAreRecomputedOnReadWithoutChangingTheObservation() {
        val plan=SleepPlan(meta,schedule,targetBedtime=LocalTime.of(1,0),targetWakeTime=LocalTime.of(9,0))
        val entry=SleepTracker.entry(meta.copy(id="saved"),plan,date,LocalTime.of(1,30),LocalTime.of(9,0),8.0,"Saved note")
        val old=entry.copy(durationMinutes=1,deviationMinutes=15)
        val restored=TrackersDocument.decode(TrackersDocument.encode(LocalTrackersWorkspace(listOf(plan),listOf(old))),7)
        assertEquals(entry,restored.sleepEntries.single());assertEquals(7L,restored.revision)
    }

    @Test fun partialSleepRetainsNullsAndCompleteSleepRetainsTimezoneDerivedValues() {
        val plan=SleepPlan(meta,schedule)
        val partial=SleepTracker.entry(meta.copy(id="entry1"),plan,date,LocalTime.of(23,0),null,null,"Время пробуждения ещё не указано")
        val full=SleepTracker.entry(meta.copy(id="entry2"),plan,date.minusDays(1),LocalTime.of(23,0),LocalTime.of(7,0),8.0,"Наблюдение")
        val original=LocalTrackersWorkspace(listOf(plan),listOf(partial,full),revision=7)
        val json=TrackersDocument.encode(original)
        val restored=TrackersDocument.decode(json,7)
        assertEquals(original,restored)
        assertNull(restored.sleepEntries[0].durationMinutes)
        assertNull(restored.sleepEntries[0].deviationMinutes)
        assertNull(restored.sleepEntries[0].quality)
        assertEquals(480,restored.sleepEntries[1].durationMinutes)
        assertEquals("Europe/Moscow",restored.sleepPlans.single().schedule.timezone)
    }

    @Test fun explicitlyNeutralMoodIsNotConfusedWithNoObservation() {
        val empty=TrackersDocument.decode(TrackersDocument.encode(LocalTrackersWorkspace()),0)
        assertTrue(empty.moodEntries.isEmpty())
        val neutral=MoodTracker.entry(meta.copy(id="mood1"),date,meta.updatedAt,0.0,note="Осознанно выбрано",tags=listOf("контекст"))
        val positive=neutral.copy(entity=meta.copy(id="mood2"),date=date.minusDays(1),moodValue=5)
        val data=LocalTrackersWorkspace(moodEntries=listOf(neutral,positive))
        assertEquals(data,TrackersDocument.decode(TrackersDocument.encode(data),0))
        assertEquals(0,data.moodEntries.first().moodValue)
        assertEquals("Осознанно выбрано",data.moodEntries.first().note)
    }

    @Test fun customMoodNameAndEmojiSurviveLocalRoundTrip() {
        val custom=MoodTracker.entry(meta.copy(id="custom-mood"),date,meta.updatedAt,2.0,
            customLabel="Вдохновение",customEmoji="🌅")
        val restored=TrackersDocument.decode(TrackersDocument.encode(LocalTrackersWorkspace(moodEntries=listOf(custom))),0)
        assertEquals(custom,restored.moodEntries.single())
    }

    @Test fun planRulesAndObservedValuesRoundTripWithoutAddingRewardFields() {
        val rule=SleepRule("rule1","wake","after",LocalTime.of(8,0),-1.5)
        val plan=SleepPlan(meta,schedule,active=false,scoringEnabled=true,rules=listOf(rule),
            reminderEnabled=true,reminderMinutesBefore=30)
        val entry=SleepTracker.entry(meta.copy(id="e1"),plan,date,LocalTime.of(23,0),LocalTime.of(9,0),null,"Тест \"заметки\"\nновая строка")
        val data=LocalTrackersWorkspace(listOf(plan),listOf(entry))
        val json=TrackersDocument.encode(data)
        assertEquals(data,TrackersDocument.decode(json,0))
        assertEquals(-1.5,entry.score,0.0)
        assertEquals(30,TrackersDocument.decode(json,0).sleepPlans.single().reminderMinutesBefore)
        assertFalse(json.contains("xpAwarded"));assertFalse(json.contains("laurelsBalance"))
    }

    @Test fun malformedOrFutureSchemaCannotSilentlyReplaceStoredData() {
        assertThrows(Exception::class.java) { TrackersDocument.decode("{}",0) }
        assertThrows(IllegalArgumentException::class.java) { TrackersDocument.decode("{\"localSchema\":2}",0) }
    }

    @Test fun abstinenceCloudImportAndLocalRoundTripRetainScheduleHistoryAndScores() {
        val tracker = AddictionTracker(meta.copy(id="abstinence"), schedule, "Test", "Context", "active", 12, 3, true, "19:45")
        val entry = AddictionTrackerRules.entry(meta.copy(id="observation"), tracker, date, true, false, 4.0, "Trigger", "Note", meta.updatedAt)
        val data = LocalTrackersWorkspace(addictionTrackers=listOf(tracker), addictionEntries=listOf(entry), addictionDataLoaded=true)
        val json = TrackersDocument.encode(data)
        assertEquals(data, TrackersDocument.decode(json, 0))
        val imported = TrackersDocument.decode(CloudAccountImporter.trackersDocument(org.json.JSONObject(json)), 0)
        assertEquals(data, imported)
        assertEquals(12, imported.addictionEntries.single().score)
        assertFalse(json.contains("xpAwarded"))
    }

    @Test fun oldNativeDocumentKeepsUnknownAbstinenceCollectionsAbsent() {
        val legacy = LocalTrackersWorkspace()
        val json = TrackersDocument.encode(TrackersDocument.decode(TrackersDocument.encode(legacy), 0))
        assertFalse(org.json.JSONObject(json).has("addictionTrackers"))
        assertFalse(org.json.JSONObject(json).has("addictionEntries"))
    }
}
