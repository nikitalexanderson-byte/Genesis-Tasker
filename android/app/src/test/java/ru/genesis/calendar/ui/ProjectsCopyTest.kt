package ru.genesis.calendar.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class ProjectsCopyTest {
    @Test fun nestedProjectsHaveVisibleHierarchyMarker() {
        assertEquals("Основной проект", projectTreeLabel("Основной проект", 0))
        assertEquals("— Подпроект", projectTreeLabel("Подпроект", 1))
        assertEquals("— Вложенный проект", projectTreeLabel("Вложенный проект", 2))
        assertEquals("↳ Подпроект", projectHierarchyLabel("Подпроект", 1))
        assertEquals("  ↳ Вложенный проект", projectHierarchyLabel("Вложенный проект", 2))
    }

    @Test fun russianProjectAndTaskCountsDeclineCorrectly() {
        fun noun(count: Int) = russianCount(count, "задача", "задачи", "задач")
        assertEquals("задач", noun(0))
        assertEquals("задача", noun(1))
        assertEquals("задачи", noun(2))
        assertEquals("задач", noun(5))
        assertEquals("задач", noun(11))
        assertEquals("задач", noun(14))
        assertEquals("задача", noun(21))
        assertEquals("задачи", noun(24))
    }
}
