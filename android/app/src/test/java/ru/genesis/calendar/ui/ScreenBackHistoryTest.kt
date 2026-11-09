package ru.genesis.calendar.ui

import org.junit.Assert.*
import org.junit.Test

class ScreenBackHistoryTest {
    @Test fun everyObservedEntryReturnsToItsRealPredecessorWithoutAnArtificialHome() {
        val history=ScreenBackHistory("today")
        listOf("calendar-month","personal-projects","diary","settings-account").forEach(history::observe)
        assertEquals("diary",history.pop());history.observe("diary")
        assertEquals("personal-projects",history.pop());history.observe("personal-projects")
        assertEquals("calendar-month",history.pop());history.observe("calendar-month")
        assertEquals("today",history.pop());history.observe("today")
        assertFalse(history.canGoBack);assertNull(history.pop())
    }
    @Test fun aDifferentPathAfterBackDoesNotReopenAnAbandonedForwardScreen() {
        val history=ScreenBackHistory("today")
        history.observe("projects");history.observe("messenger");assertEquals("projects",history.pop())
        history.observe("projects");history.observe("diary")
        assertEquals("projects",history.pop());assertEquals("today",history.pop());assertNull(history.pop())
    }
    @Test fun submenuRestorationPreservesPersonalAndSharedDestinations() {
        val menu=MenuSwipeState();menu.personalView="categories";menu.tasks="lists"
        val personal=workspaceBackDestination("Проекты",menu)
        menu.projectArea="shared";menu.personalView="projects";menu.tasks="tasks"
        assertEquals("Проекты",restoreWorkspaceBackDestination(personal,menu))
        assertEquals("personal",menu.projectArea);assertEquals("categories",menu.personalView);assertEquals("lists",menu.tasks)
        menu.settings="account";val settings=workspaceBackDestination("Настройки",menu);menu.settings="appearance"
        assertEquals("Настройки",restoreWorkspaceBackDestination(settings,menu));assertEquals("account",menu.settings)
    }
    @Test fun duplicateRecompositionsDoNotAddBackStepsAndHistoryIsRestorable() {
        val history=ScreenBackHistory("board");repeat(20){history.observe("board")}
        history.observe("favorites");history.observe("archive")
        val restored=ScreenBackHistory(history.current,history.previous)
        assertEquals("favorites",restored.pop());assertEquals("board",restored.pop());assertNull(restored.pop())
    }
}
