package ru.genesis.calendar.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AdaptiveNavigationTest {
    @Test fun leftMenuFollowsWideViewportAndUserPreference() {
        assertFalse(shouldUseNavigationRail(390, landscape = false, wideNavigationOnLeft = true))
        assertTrue(shouldUseNavigationRail(390, landscape = true, wideNavigationOnLeft = true))
        assertTrue(shouldUseNavigationRail(768, landscape = false, wideNavigationOnLeft = true))
        assertFalse(shouldUseNavigationRail(768, landscape = false, wideNavigationOnLeft = false))
        assertFalse(shouldUseNavigationRail(390, landscape = true, wideNavigationOnLeft = false))
    }
}
