package ru.genesis.calendar.ui

import androidx.compose.runtime.saveable.SaverScope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNull
import org.junit.Test

class MenuSwipeNavigationTest {
    @Test fun selectedSubmenusSurviveActivityRecreation() {
        val original = MenuSwipeState().apply {
            tasks = "lists"; personalView = "projects"; projects = "archived"
            projectArea = "shared"; calendar = "year"; habits = "Сон и настроение"
            sacred = "theokyklos"; settings = "reminders"
        }
        val scope = object : SaverScope { override fun canBeSaved(value: Any) = true }
        val saved = with(MenuSwipeStateSaver) { scope.save(original) }
        val restored = requireNotNull(MenuSwipeStateSaver.restore(requireNotNull(saved)))
        assertEquals("year", restored.section("Календарь"))
        assertEquals("shared", restored.section("Проекты"))
        assertEquals("Сон и настроение", restored.section("Привычки"))
        assertEquals("theokyklos", restored.section("Сакральное"))
        assertEquals("reminders", restored.section("Настройки"))
        assertEquals(original.tasks, restored.tasks)
        assertEquals(original.personalView, restored.personalView)
        assertEquals(original.projects, restored.projects)
    }

    @Test fun mainPagesIgnoreSubmenusWhenOptionIsOff() {
        val pages = menuSwipeSequence(false, true)
        assertEquals(listOf("Сегодня", "Проекты", "Календарь", "Привычки",
            "Сакральное", "Настройки"), pages.map { it.page })
        assertEquals(SwipeDestination("Календарь"),
            nextMenuSwipeDestination(pages, "Проекты", null, 1))
        assertNull(nextMenuSwipeDestination(pages, "Настройки", null, 1))
        assertNull(nextMenuSwipeDestination(pages, "Сегодня", null, -1))
    }

    @Test fun submenuOptionFlattensSectionsExceptProjectCategories() {
        val pages = menuSwipeSequence(true, true)
        assertEquals(SwipeDestination("Проекты", "personal-projects"),
            nextMenuSwipeDestination(pages, "Сегодня", null, 1))
        assertEquals(SwipeDestination("Календарь", "month"),
            nextMenuSwipeDestination(pages, "Проекты", "personal-projects", 1))
        assertEquals(SwipeDestination("Сегодня"),
            nextMenuSwipeDestination(pages, "Проекты", "work", -1))
        assertEquals(SwipeDestination("Календарь", "year"),
            nextMenuSwipeDestination(pages, "Календарь", "month", 1))
        assertEquals(SwipeDestination("Привычки", "Привычки"),
            nextMenuSwipeDestination(pages, "Календарь", "year", 1))
        assertEquals(SwipeDestination("Календарь", "year"),
            nextMenuSwipeDestination(pages, "Привычки", "Привычки", -1))
    }

    @Test fun disabledHabitsAreExcluded() {
        val pages = menuSwipeSequence(true, false)
        assertEquals(SwipeDestination("Сакральное", "stoicheion"),
            nextMenuSwipeDestination(pages, "Календарь", "year", 1))
    }

    @Test fun disabledSacredFeaturesExcludeOracleFromEverySwipeMode() {
        for (submenus in listOf(false, true)) for (habits in listOf(false, true)) {
            val pages = menuSwipeSequence(submenus, habits, sacredFeaturesEnabled = false)
            assertTrue(pages.none { it.page == "Сакральное" })
            val calendar = pages.last { it.page == "Календарь" }
            val next = nextMenuSwipeDestination(pages, calendar.page, calendar.section, 1)
            assertEquals(if (habits) "Привычки" else "Настройки", next?.page)
            assertEquals(calendar, nextMenuSwipeDestination(pages, next!!.page, next.section, -1))
        }
        assertTrue(menuSwipeSequence(true, true, sacredFeaturesEnabled = true).any { it.page == "Сакральное" })
    }

    @Test fun sharedProjectsAreAdjacentSwipeDestinationsWhenAvailable() {
        val pages = menuSwipeSequence(true, true, true)
        assertEquals(SwipeDestination("Проекты", "personal-projects"),
            nextMenuSwipeDestination(pages, "Сегодня", null, 1))
        assertEquals(SwipeDestination("Проекты", "shared"),
            nextMenuSwipeDestination(pages, "Проекты", "personal-projects", 1))
        assertEquals(SwipeDestination("Календарь", "month"),
            nextMenuSwipeDestination(pages, "Проекты", "shared", 1))
        assertEquals(SwipeDestination("Проекты", "personal-projects"),
            nextMenuSwipeDestination(pages, "Проекты", "shared", -1))
    }

    @Test fun hiddenSectionsAreSkippedWithoutBlankSwipePages() {
        val pages = menuSwipeSequence(true, true, true,
            hiddenMenuItems = setOf("stoicheion", "theokyklos"),
            hiddenSubmenus = setOf("tasks.lists", "projects.personal", "calendar.month", "habits.sleep"))
        assertEquals(listOf(SwipeDestination("Сегодня"),
            SwipeDestination("Проекты", "shared"), SwipeDestination("Календарь", "year"),
            SwipeDestination("Привычки", "Привычки")) + settingsSections.map { SwipeDestination("Настройки", it.id) }, pages)
        assertEquals(SwipeDestination("Настройки", "appearance"),
            nextMenuSwipeDestination(pages, "Привычки", "Привычки", 1))
    }

    @Test fun sacredSubsectionsSwipeInOrderAndRespectVisibility() {
        val pages = menuSwipeSequence(true, true)
        assertEquals(SwipeDestination("Сакральное", "theokyklos"),
            nextMenuSwipeDestination(pages, "Сакральное", "stoicheion", 1))
        assertEquals(SwipeDestination("Настройки", "appearance"),
            nextMenuSwipeDestination(pages, "Сакральное", "theokyklos", 1))
        val stoicheionHidden = menuSwipeSequence(true, true,
            hiddenSubmenus = setOf("sacred.stoicheion"))
        assertEquals(SwipeDestination("Сакральное", "theokyklos"),
            nextMenuSwipeDestination(stoicheionHidden, "Привычки", "Сон и настроение", 1))
    }

    @Test fun sequentialSettingsHaveOneSwipeDestination() {
        val pages = menuSwipeSequence(true, true, settingsSubmenuEnabled = false)
        assertEquals(listOf(SwipeDestination("Настройки")),
            pages.filter { it.page == "Настройки" })
        assertEquals(SwipeDestination("Настройки"),
            nextMenuSwipeDestination(pages, "Сакральное", "theokyklos", 1))
    }

    @Test fun primaryMenuTapReturnsToFirstVisibleSubmenu() {
        fun first(page: String, hidden: Set<String> = emptySet()) =
            firstVisibleSubmenu(page, true, true, emptySet(), hidden, true)
        assertNull(first("Задачи"))
        assertNull(first("Задачи", setOf("tasks.tasks")))
        assertEquals("personal-projects", first("Проекты"))
        assertEquals("shared", first("Проекты", setOf("projects.personal")))
        assertEquals("month", first("Календарь"))
        assertEquals("year", first("Календарь", setOf("calendar.month")))
        assertEquals("Привычки", first("Привычки"))
        assertEquals("stoicheion", first("Сакральное"))
        assertEquals("appearance", first("Настройки"))
        assertNull(first("Сегодня"))
    }
}
