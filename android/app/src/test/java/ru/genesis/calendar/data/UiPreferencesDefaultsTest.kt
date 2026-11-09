package ru.genesis.calendar.data

import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

class UiPreferencesDefaultsTest {
    @Test fun newInstallIncludesSubmenusInGeneralSwipe() {
        val preferences = UiPreferences()
        assertTrue(preferences.menuSwipeEnabled)
        assertTrue(preferences.menuSwipeSubmenus)
        assertFalse(preferences.menuThreadsEnabled)
        assertTrue(preferences.settingsSubmenuEnabled)
    }
}
