package ru.genesis.calendar.ui

import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.UiVisibility

class MenuVisibilityOptionsTest {
    @Test fun optionsFollowTheDrawerAndIncludeDiaryAndMessagesWithoutSharedProjects() {
        val options = menuVisibilityDestinations()
        assertEquals(listOf("Сегодня", "Календарь", "Дела", "Дневник", "Личные сообщения", "Привычки", "Сон и настроение", "Оракул", "Настройки"), options.map { it.title })
        val pages = options.map { it.page }.distinct()
        assertTrue(mobileDestinations(pages, UiVisibility(), false, false).any { it.page == "Сообщения" })
        for (page in listOf("Дневник", "Сообщения")) {
            val destination = options.first { it.page == page }
            val hidden = setMenuDestinationVisible(destination, UiVisibility(), false)
            assertFalse(menuDestinationVisible(destination, hidden))
            assertFalse(mobileDestinations(pages, hidden, false, false).any { it.page == page })
            assertTrue(menuDestinationVisible(destination, setMenuDestinationVisible(destination, hidden, true)))
        }
    }
    @Test fun habitsAndSleepCanBeHiddenIndependentlyWithoutBreakingLegacySubmenuConstraints() {
        val options = menuVisibilityDestinations()
        val habits = options.first { it.title == "Привычки" }
        val sleep = options.first { it.title == "Сон и настроение" }
        var visibility = setMenuDestinationVisible(habits, UiVisibility(), false)
        assertFalse(menuDestinationVisible(habits, visibility)); assertTrue(menuDestinationVisible(sleep, visibility))
        visibility = setMenuDestinationVisible(sleep, visibility, false)
        assertFalse(menuDestinationVisible(habits, visibility)); assertFalse(menuDestinationVisible(sleep, visibility))
        assertFalse(setOf("habits.habits", "habits.sleep").all { it in visibility.hiddenSubmenus })
        visibility = setMenuDestinationVisible(habits, visibility, true)
        assertTrue(menuDestinationVisible(habits, visibility)); assertFalse(menuDestinationVisible(sleep, visibility))
        for(page in listOf("Сегодня", "Настройки"))assertEquals(visibility, setMenuDestinationVisible(options.first { it.page == page }, visibility, false))
    }
}
