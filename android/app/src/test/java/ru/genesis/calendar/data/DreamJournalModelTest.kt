package ru.genesis.calendar.data

import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.domain.RecurrenceConfig
import ru.genesis.calendar.domain.habits.TrackerEntity
import ru.genesis.calendar.domain.habits.TrackerSchedule
import ru.genesis.calendar.domain.trackers.*
import java.time.*

class DreamJournalModelTest {
    @Test fun draftIdentityDrivesSearchAndFlagsWithoutCountingTheSavedVersionAgain() {
        val saved=DiaryNote.create("Старая река").changed {
            put("dream",org.json.JSONObject().put("day","2026-11-05").put("timeZone","UTC").put("lucid",true));put("reaction","favorite")
        }
        val draft=saved.changed{put("body","Новый лес");put("reaction",org.json.JSONObject.NULL);getJSONObject("dream").put("lucid",false)}
        val rows=DreamJournalModel.uniqueDreams(listOf(DiaryRecord(saved,1),DiaryRecord(draft,1,"draft:writer:${saved.id}")))
        assertEquals(1,rows.size);assertTrue(rows.single().draft)
        assertEquals(0,rows.count{it.note.lucid||it.note.reaction=="favorite"})
        assertTrue(DreamJournalModel.matches(rows.single().note,"лес"));assertFalse(DreamJournalModel.matches(rows.single().note,"река"))
    }
    private fun plan(zone:String="Europe/Moscow",wake:String="07:00") = SleepPlan(TrackerEntity.create("sleep",id="sleep"),
        TrackerSchedule(LocalDate.parse("2026-01-01"),timezone=zone,recurrence=RecurrenceConfig(enabled=true,mode="classic",pattern="daily")),targetWakeTime=LocalTime.parse(wake))
    @Test fun actualWakeOverridesPlanAndThreeHoursEndsExactly() {
        val p=plan();val e=SleepTracker.entry(TrackerEntity.create("entry"),p,LocalDate.parse("2026-11-04"),LocalTime.of(23,30),LocalTime.of(9,0),null,"")
        fun at(time:String)=OffsetDateTime.parse("2026-11-05T$time:00+03:00").toInstant()
        assertTrue(DreamJournalModel.morning(listOf(p),emptyList(),at("07:00")).visible)
        assertFalse(DreamJournalModel.morning(listOf(p),listOf(e),at("07:30")).visible)
        assertTrue(DreamJournalModel.morning(listOf(p),listOf(e),at("11:59")).visible)
        assertFalse(DreamJournalModel.morning(listOf(p),listOf(e),at("12:00")).visible)
        assertNull(DreamJournalModel.morning(emptyList(),emptyList(),at("08:00")).source)
    }
    @Test fun daylightSavingGapIsSkippedAndOverlapUsesFirstOccurrence() {
        assertNull(DreamJournalModel.morning(listOf(plan("America/New_York","02:30")),emptyList(),Instant.parse("2026-03-08T08:00:00Z")).source)
        val plans=listOf(plan("America/New_York","01:30"))
        assertTrue(DreamJournalModel.morning(plans,emptyList(),Instant.parse("2026-11-01T05:45:00Z")).visible)
        assertFalse(DreamJournalModel.morning(plans,emptyList(),Instant.parse("2026-11-01T08:30:00Z")).visible)
    }
}
