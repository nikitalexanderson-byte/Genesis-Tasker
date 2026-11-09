package ru.genesis.calendar.data

import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.domain.CalendarMode

class PersonalAffairsSearchTest {
    private val list = GoogleTaskList("reading", "Чтение", "account-a")
    private val otherAccount = list.copy(accountId = "account-b", title = "Секретный список")
    private val structure = WorkspaceStructure(projects = listOf(
        GenesisProject("p", null, "work", "Редакция", "", emptyList(), "active", 0)))
    private val reading = LocalTask("a", "Прочитать главу", description = "Для обзора", projectId = "p",
        sourceFieldsJson = listTaskFields(list, CalendarMode.LUNAR).toString())
    private val loose = LocalTask("b", "Купить продукты", description = "Для пикника",
        sourceFieldsJson = """{"tags":["семья"],"comments":[{"text":"private marker"}]}""")

    @Test fun searchesDescriptionsTagsAndContextKeepingTheOriginalOrder() {
        fun search(q: String) = searchPersonalAffairs(listOf(loose, reading), structure,
            listOf(list, otherAccount), q, null).map { it.id }
        assertEquals(listOf("b"), search("  ПИКНИКА   #семья  "))
        assertEquals(listOf("a"), search("редакция чтение"))
        assertEquals(listOf("b", "a"), search("Для"))
        assertTrue(search("Секретный список").isEmpty())
        assertTrue(search("private marker").isEmpty())
        assertEquals(listOf("b", "a"), search("  "))
    }

    @Test fun categoryScopeAndExplicitChaosPlacementRemainIndependentOfSearch() {
        assertEquals(listOf(reading), searchPersonalAffairs(listOf(loose, reading), structure,
            listOf(list), "", "work"))
        assertTrue(searchPersonalAffairs(listOf(reading.copy(projectId = "__genesis_inbox__")), structure,
            listOf(list), "Редакция", null).isEmpty())
    }
}
