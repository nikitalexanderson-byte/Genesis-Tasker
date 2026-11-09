package ru.genesis.calendar.ui

import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class GenesisLucideCoverageTest {
    @Test fun everyNavigationAndWorkspaceActionResolvesToBundledDrawable() {
        // New enum values must have both a semantic mapping and a packaged drawable.
        val names = GenesisPageIcon.entries.map { it.lucideName() } +
            AffairsAction.entries.map { it.lucideName() }
        names.forEach { name -> assertNotEquals("Unresolved icon: $name", 0, genesisLucideResource(name)) }
    }

    @Test fun restoreAndDeleteRemainVisuallyDistinct() {
        assertNotEquals(genesisLucideResource("thumbs-up"), genesisLucideResource("thumbs-down"))
        assertNotEquals(genesisLucideResource(AffairsAction.DELETE.lucideName()),
            genesisLucideResource(AffairsAction.RESTORE.lucideName()))
        assertNotEquals(genesisLucideResource(AffairsAction.ARCHIVE.lucideName()),
            genesisLucideResource(AffairsAction.RESTORE.lucideName()))
        assertEquals(genesisLucideResource("arrow-up-down"), genesisLucideResource("arrow_up_down"))
    }

    @Test(expected = IllegalStateException::class)
    fun unknownNameCannotSilentlyBecomeEmptyIcon() {
        genesisLucideResource("missing-icon")
    }
}
