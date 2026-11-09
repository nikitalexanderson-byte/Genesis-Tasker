package ru.genesis.calendar.data

import java.time.LocalDate
import java.time.ZoneId
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.WorkspacePatch
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*

class StoicheionRestorationPersistenceTest {
    // Wire encoding canonicalizes UTC aliases; round-trip fixtures must use a stable zone.
    private val engine = HabitEngine(GenesisCalendar(ZoneId.of("Europe/Moscow")))

    @Test fun immutableSourceSnapshotSurvivesHabitEditsAndNativeWebNativeSynchronization() {
        val snapshot = StoicheionRestorationTest.fixture()
        val day = LocalDate.parse(snapshot.startedDate)
        val habit = Habit(TrackerEntity.create("habit", snapshot.startedAt, "restoration-habit"), "Synthetic practice", day,
            engine.defaultSchedule(day, CalendarMode.PROFANE),
            sacredPracticeId = snapshot.practiceId, sacredSectorId = snapshot.sectorId, stoicheionRestoration = snapshot)
        val workspace = LocalHabitWorkspace(habits = listOf(habit))
        val encoded = HabitDocument.encode(workspace)
        assertEquals(workspace, HabitDocument.decode(encoded, 0))
        assertFalse(StoicheionRestorationCodec.encode(snapshot).has("excludeStartDate"))
        val excluded = snapshot.copy(excludeStartDate = true)
        assertEquals(excluded, StoicheionRestorationCodec.decode(StoicheionRestorationCodec.encode(excluded)))
        assertEquals(snapshot, StoicheionRestorationCodec.decode(StoicheionRestorationCodec.encode(snapshot).put("excludeStartDate", "true")))
        val edited = preserveHabitCreationSettings(habit.copy(title = "Edited", stoicheionRestoration = null), habit, day)
        assertEquals(snapshot, edited.stoicheionRestoration)
        val web = WorkspacePatch.emptyDocument()
        val native = WorkspacePatch.localDocument(web, null, JSONObject(HabitDocument.encode(workspace.copy(habits = listOf(edited)))), null)
        val patched = WorkspacePatch.apply(web, native, web, setOf("habits"), 1, "2026-10-22T13:00:00Z", "restoration-test")
        val imported = HabitDocument.decode(CloudAccountImporter.habitsDocument(patched.document), 2)
        assertEquals(snapshot, imported.habits.single().stoicheionRestoration)
        assertEquals("Edited", imported.habits.single().title)
        val base = WorkspacePatch.localDocument(web, null, JSONObject(HabitDocument.encode(
            workspace.copy(habits = listOf(habit.copy(stoicheionRestoration = null))))), null)
        base.getJSONArray("habits").getJSONObject(0).put("ownerExtension", JSONObject().put("retained", true))
        val linked = WorkspacePatch.localDocument(base, null,
            JSONObject(HabitDocument.encode(workspace.copy(habits = listOf(edited)))), null)
        val linkedResult = WorkspacePatch.apply(base, linked, base, setOf("habits"), 2, "2026-10-22T14:00:00Z", "link-test")
        assertTrue(linkedResult.document.getJSONArray("habits").getJSONObject(0).getJSONObject("ownerExtension").getBoolean("retained"))
        assertEquals(snapshot, HabitDocument.decode(CloudAccountImporter.habitsDocument(linkedResult.document), 3)
            .habits.single().stoicheionRestoration)
    }

    @Test fun malformedOptionalMetadataCannotHideOrDestroyTheContainingHabit() {
        val snapshot = StoicheionRestorationTest.fixture()
        val date = LocalDate.parse(snapshot.startedDate)
        val habit = Habit(TrackerEntity.create("habit", snapshot.startedAt, "test"), "Existing habit", date,
            engine.defaultSchedule(date, CalendarMode.PROFANE))
        val base = JSONObject(HabitDocument.encode(LocalHabitWorkspace(habits = listOf(habit))))
        val variants = listOf<Any>("wrong type", JSONObject().put("version", 99),
            StoicheionRestorationCodec.encode(snapshot).put("spreadTotal", 50),
            StoicheionRestorationCodec.encode(snapshot).put("resourceLetterId", "alpha"),
            StoicheionRestorationCodec.encode(snapshot).put("cards", JSONArray()),
            StoicheionRestorationCodec.encode(snapshot).put("sourceSeed", 1.5),
            StoicheionRestorationCodec.encode(snapshot).put("startedDate", "2026-02-30"))
        for (variant in variants) {
            base.getJSONArray("habits").getJSONObject(0).put("stoicheionRestoration", variant)
            assertEquals(habit, HabitDocument.decode(base.toString(), 0).habits.single())
        }
    }

    @Test fun normalizationMatchesWebSupportOrderAndStrictReversedCardRequirements() {
        val snapshot = StoicheionRestorationTest.fixture()
        val json = StoicheionRestorationCodec.encode(snapshot)
        json.put("supportIds", JSONArray(listOf("hearth", "hearth")))
        assertEquals(snapshot, StoicheionRestorationCodec.decode(json))
        json.getJSONArray("cards").getJSONObject(1).put("reversed", false)
        assertNull(StoicheionRestorationCodec.decode(json))
        json.getJSONArray("cards").getJSONObject(1).put("reversed", "true")
        assertNull(StoicheionRestorationCodec.decode(json))
        json.getJSONArray("cards").getJSONObject(1).put("reversed", true)
        json.put("cycleId", "wrong")
        assertNull(StoicheionRestorationCodec.decode(json))
    }
}
