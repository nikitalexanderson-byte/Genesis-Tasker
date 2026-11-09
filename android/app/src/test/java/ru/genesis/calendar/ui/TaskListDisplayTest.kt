package ru.genesis.calendar.ui

import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.LocalTask

class TaskListDisplayTest {
    @Test fun creationSortUsesOriginalTimestampAndDoesNotRewriteStoredOrder() {
        val tasks=listOf(LocalTask(id="old",title="Old",sourceFieldsJson="""{"createdAt":"2026-01-01T00:00:00Z"}"""),
            LocalTask(id="new-a",title="New A",sourceFieldsJson="""{"createdAt":"2026-10-16T00:00:00Z"}"""),
            LocalTask(id="new-b",title="New B",sourceFieldsJson="""{"createdAt":"2026-10-16T00:00:00Z"}"""),LocalTask(id="legacy",title="Legacy"))
        assertEquals(listOf("new-a","new-b","old","legacy"),orderPersonalTasks(tasks,TaskListSort.NEWEST).map { it.id })
        assertEquals(listOf("old","new-a","new-b","legacy"),tasks.map { it.id })
    }
    @Test fun undatedTasksFollowTheNearestDeadline() {
        val tasks=listOf(LocalTask(id="none",title="None",date=""),LocalTask(id="later",title="Later",date="2026-10-20"),LocalTask(id="soon",title="Soon",date="2026-10-17"))
        assertEquals(listOf("soon","later","none"),orderPersonalTasks(tasks,TaskListSort.DUE).map { it.id })
    }
}
