package ru.genesis.calendar.ui

import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.GenesisProject
import ru.genesis.calendar.data.GoogleTaskList

class NativeVoicePlanTest {
    private val today=LocalDate.of(2026,10,4)

    @Test fun russianCommandCreatesEditableTaskDraftsWithRealDatesAndRouting() {
        val project=GenesisProject("p1",null,"work","Работа","",emptyList(),"active",0)
        val list=GoogleTaskList("l1","Дела")
        val tasks=parseNativeVoicePlan("Создай задачу купить хлеб завтра в 18:30 приоритет 7 #дом; Добавь задачу отправить отчёт 20.10.2026 в проекте Работа в списке Дела",
            today,listOf(project),listOf(list))
        assertEquals(2,tasks.size)
        assertEquals("купить хлеб",tasks[0].title)
        assertEquals(today.plusDays(1),tasks[0].date)
        assertEquals("18:30",tasks[0].time)
        assertEquals(7,tasks[0].priority)
        assertEquals(listOf("дом"),tasks[0].tags)
        assertEquals(LocalDate.of(2026,10,20),tasks[1].date)
        assertEquals("p1",tasks[1].projectId)
        assertEquals("l1",tasks[1].taskListId)
    }

    @Test fun emptyTitleIsRejectedBeforeAnyTaskIsSaved() {
        assertThrows(IllegalArgumentException::class.java) {
            parseNativeVoicePlan("создай задачу",today,emptyList(),emptyList())
        }
    }

    @Test fun namingPhrasesDoNotBecomePartOfRussianOrEnglishTaskTitles() {
        val russian=listOf("создай задачу под названием Задача номер 1",
            "добавь задачу с названием Задача номер 1",
            "создай задачу, назови её Задача номер 1")
        russian.forEach { phrase ->
            assertEquals(phrase,"Задача номер 1",
                parseNativeVoicePlan(phrase,today,emptyList(),emptyList()).single().title)
        }
        val english=listOf("create a task named Task number 1",
            "add a task called Task number 1",
            "make a task with the title Task number 1")
        english.forEach { phrase ->
            assertEquals(phrase,"Task number 1",
                parseNativeVoicePlan(phrase,today,emptyList(),emptyList()).single().title)
        }
    }
}
