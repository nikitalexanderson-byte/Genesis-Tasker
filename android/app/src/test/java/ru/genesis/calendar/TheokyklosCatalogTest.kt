package ru.genesis.calendar

import java.io.File
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.TheokyklosCatalogSource
import ru.genesis.calendar.domain.habits.HabitEngine
import ru.genesis.calendar.ui.toHabit
import ru.genesis.calendar.ui.standardSacredHabit
import ru.genesis.calendar.ui.canRestoreSacredHabit
import ru.genesis.calendar.ui.restoreSacredHabitContent
import ru.genesis.calendar.domain.StoicheionRestoration
import ru.genesis.calendar.domain.StoicheionRestorationTest
import java.time.LocalDate

class TheokyklosCatalogTest {
    @Test fun restoringCustomizedSacredContentKeepsIdentityScheduleAndHistoryReferences() {
        val practice = catalog.practices.first()
        val original = practice.toHabit(CalendarMode.SACRED)
        val edited = original.copy(title = "Моё название", description = "Моя инструкция", emoji = "🌿", color = "#123456", active = false)
        val restored = restoreSacredHabitContent(edited, practice, false)
        assertTrue(canRestoreSacredHabit(edited, practice))
        assertEquals(edited.copy(title = practice.title.ru, description = practice.description.ru,
            emoji = practice.emoji, color = practice.color), restored)
        assertFalse(canRestoreSacredHabit(restored, practice))
        val reading = edited.copy(stoicheionRestoration = StoicheionRestorationTest.fixture())
        assertSame(reading, restoreSacredHabitContent(reading, practice, false))
    }
    private val catalog by lazy {
        TheokyklosCatalogSource.parse(File("src/main/assets/catalogs/theokyklos.json").readText(Charsets.UTF_8))
    }

    @Test fun allOriginalSectorsAndPracticesAreLinked() {
        assertEquals(TheokyklosCatalogSource.ids, catalog.sectors.map { it.id })
        assertEquals(28, catalog.practices.size)
        assertEquals((TheokyklosCatalogSource.ids.take(8) + "center").toSet(),
            catalog.guidanceById.keys)
        assertTrue(catalog.guidanceById.values.all {
            it.upright.ru.isNotBlank() && it.reversed.ru.isNotBlank()
        })
        for (sector in catalog.sectors) {
            assertEquals(4, sector.words.size)
            assertTrue(sector.title.ru.isNotBlank())
            assertTrue(sector.description.ru.isNotBlank())
            assertTrue(File("../../public/${sector.art}").isFile)
            assertTrue(File("../../public/${sector.symbolArt}").isFile)
            assertEquals(2, catalog.practicesFor(sector.id).size)
        }
    }

    @Test fun invalidCatalogCannotSilentlyDropMandalaMarkers() {
        val missingZenith = File("src/main/assets/catalogs/theokyklos.json").readText(Charsets.UTF_8)
            .replaceFirst("\"id\": \"zenith\"", "\"id\": \"missing\"")
        assertThrows(IllegalArgumentException::class.java) {
            TheokyklosCatalogSource.parse(missingZenith)
        }
    }

    @Test fun readingHabitNeverReplacesEitherStandardPractice() {
        val practices = catalog.practicesFor("north")
        val regular = practices.first().toHabit(CalendarMode.SACRED)
        val reading = regular.copy(entity = ru.genesis.calendar.domain.habits.TrackerEntity.create("habit"),
            title = "Практика из расклада", description = "Личная практика",
            stoicheionRestoration = StoicheionRestorationTest.fixture())
        assertNull(standardSacredHabit(listOf(reading), practices.first().id))
        assertNull(standardSacredHabit(listOf(reading), practices.last().id))
        for (habits in listOf(listOf(reading, regular), listOf(regular, reading))) {
            assertEquals(regular, standardSacredHabit(habits, practices.first().id))
            assertEquals(listOf(reading), StoicheionRestoration.visibleHabits(habits))
            assertEquals("Личная практика", reading.description)
        }
    }

    @Test fun practiceBecomesTrackableHabitWithoutLosingSacredLinks() {
        val practice = catalog.practicesFor("zenith").first()
        val habit = practice.toHabit(CalendarMode.SACRED)
        assertEquals(practice.id, habit.sacredPracticeId)
        assertEquals("zenith", habit.sacredSectorId)
        assertEquals(practice.suggestedTime, habit.preferredTime)
        assertEquals(practice.priority, habit.priority)
        assertTrue(HabitEngine(GenesisCalendar()).isScheduled(habit, LocalDate.now()))
    }

    @Test fun everySacredPracticeDefaultsToOneCompletionBeforeItsDeadline() {
        val engine = HabitEngine(GenesisCalendar())
        for (mode in CalendarMode.entries) for (practice in catalog.practices) {
            val habit = practice.toHabit(mode)
            assertEquals(1,habit.practiceGoal?.requiredCompletions)
            assertEquals(practice.id, habit.sacredPracticeId)
            assertEquals(practice.sectorId, habit.sacredSectorId)
            assertTrue(engine.isScheduled(habit, habit.createdDate))
            assertFalse(engine.isScheduled(habit, habit.createdDate.minusDays(1)))
            assertTrue(engine.isScheduled(habit, habit.createdDate.plusDays(1)))
            assertFalse(engine.isScheduled(habit, habit.createdDate.plusDays(2)))
            val completed=engine.updateCompletion(emptyList(),habit,habit.createdDate,habit.createdDate,true,null,"")
            assertFalse(engine.isScheduled(habit,habit.createdDate.plusDays(1),completed))
        }
    }

    @Test fun renamedPracticeRecognizesSavedDefaultsInEveryLanguageAndKeepsPersonalNames() {
        val raw = File("src/main/assets/catalogs/theokyklos.json").readText(Charsets.UTF_8)
        val original = catalog.practices.single { it.id == "persephone-new-seed" }
        assertEquals(14, original.previousTitles.size)
        for (language in listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")) {
            val translations = if (language in listOf("ru", "en")) null else JSONObject(
                File("../../app/catalog-translations/$language.json").readText(Charsets.UTF_8)).getJSONObject("theokyklos")
            val practice = TheokyklosCatalogSource.parse(raw, translations, null)
                .practices.single { it.id == original.id }
            val expected = if (language == "en") original.title.en else translations?.getString(original.title.ru) ?: original.title.ru
            for (previous in original.previousTitles) assertEquals(expected, practice.displayTitle(previous, language == "en"))
            assertEquals("Мой собственный ритуал", practice.displayTitle("Мой собственный ритуал", language == "en"))
        }
    }
}
