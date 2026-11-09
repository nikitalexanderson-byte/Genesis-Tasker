package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.unit.dp
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.StoicheionGestureActivity
import ru.genesis.calendar.domain.CalendarMode

class SharedGanttUiTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private val task = JSONObject().put("id", "qa-gantt").put("projectId", "qa-project").put("title", "Проверить сроки")
        .put("statusId", "todo").put("revision", 4)
    private val statuses = listOf(JSONObject().put("id", "todo").put("isDone", 0), JSONObject().put("id", "done").put("isDone", 1))

    private fun acknowledged(row: JSONObject, patch: JSONObject) = JSONObject(row.toString()).apply {
        patch.keys().forEach { put(it, patch.get(it)) }; put("revision", row.getInt("revision") + 1)
    }

    @Test fun longPressMovesDatesWhilePreservingDurationAndTaskIdentity() {
        val start = java.time.LocalDate.now().let { it.minusDays(it.dayOfWeek.value - 1L) }
        val scheduled = JSONObject(task.toString()).put("startDate", start.toString()).put("dueDate", start.plusDays(1).toString())
        var saved: JSONObject? = null
        compose.setContent { MaterialTheme(colorScheme = standart) { Surface {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                SharedGanttView(listOf(scheduled), statuses, CalendarMode.PROFANE, CalendarMode.PROFANE, true, true, false,
                    onOpen = {}, onSchedule = { row, patch -> assertEquals("qa-gantt", row.getString("id")); saved = patch; acknowledged(row, patch) })
            }
        } } }
        compose.onNodeWithTag("gantt-bar-qa-gantt").performScrollTo().performTouchInput { down(center) }
        compose.mainClock.advanceTimeBy(800)
        compose.onNodeWithTag("gantt-bar-qa-gantt").performTouchInput {
            moveBy(androidx.compose.ui.geometry.Offset(width * 2f, 0f)); up()
        }
        compose.waitUntil(5000) { saved != null }
        assertEquals(start.plusDays(7).toString(), saved!!.getString("startDate"))
        assertEquals(start.plusDays(8).toString(), saved!!.getString("dueDate"))
        assertEquals(start.toString(), scheduled.getString("startDate"))
    }

    @Test fun unscheduledTaskUsesTheExistingCalendarFormAndKeepsItsIdentity() {
        var savedTask: JSONObject? = null
        var savedPatch: JSONObject? = null
        compose.setContent { MaterialTheme(colorScheme = standart) {
            Surface { Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                SharedGanttView(listOf(task), statuses, CalendarMode.PROFANE, CalendarMode.PROFANE, true, true, false,
                    onOpen = {}, onSchedule = { row, patch -> savedTask = row; savedPatch = patch; acknowledged(row, patch) })
            } }
        } }
        compose.onNodeWithTag("gantt-schedule-qa-gantt").performScrollTo().performClick()
        compose.onNodeWithTag("gantt-start-date").assertExists()
        compose.onNodeWithTag("gantt-end-date").assertExists()
        compose.onNodeWithTag("gantt-save-schedule").performClick()
        compose.waitUntil { savedPatch != null }
        assertEquals(task.toString(), savedTask!!.toString())
        assertEquals(4, savedTask!!.getInt("revision"))
        assertEquals(4, task.getInt("revision"))
        assertEquals(savedPatch!!.getString("startDate"), savedPatch!!.getString("dueDate"))
        assertTrue(savedPatch!!.isNull("startTime"))
        compose.onNodeWithTag("gantt-save-schedule").assertDoesNotExist()
    }

    @Test fun viewerCanOpenTasksWithoutSchedulingAndCompletedRowsAreCollapsed() {
        var opened = ""
        val completed = JSONObject(task.toString()).put("id", "qa-done").put("title", "Выполненная работа").put("statusId", "done")
        compose.setContent { MaterialTheme(colorScheme = standart) {
            Surface { Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                SharedGanttView(listOf(task, completed), statuses, CalendarMode.PROFANE, CalendarMode.PROFANE, true, false, false,
                    onOpen = { opened = it.getString("id") }, onSchedule = { _, _ -> error("Viewer must not change dates") })
            } }
        } }
        compose.onNodeWithTag("gantt-schedule-qa-gantt").assertDoesNotExist()
        compose.onNodeWithText(task.getString("title")).performScrollTo().performClick()
        assertEquals("qa-gantt", opened)
        compose.onNodeWithText("Выполненная работа").assertDoesNotExist()
        compose.onNodeWithText("Завершённые").performScrollTo().performClick()
        compose.onNodeWithText("Выполненная работа").assertExists()
    }
    @Test fun draggingTheEndHandleExtendsOnlyTheDueDate() {
        val start = java.time.LocalDate.now().let { it.minusDays(it.dayOfWeek.value - 1L) }
        val scheduled = JSONObject(task.toString()).put("startDate", start.toString()).put("dueDate", start.plusDays(1).toString())
        var patch: JSONObject? = null
        compose.setContent { MaterialTheme(colorScheme = standart) { Surface {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                SharedGanttView(listOf(scheduled), statuses, CalendarMode.PROFANE, CalendarMode.PROFANE, true, true, false,
                    onOpen = {}, onSchedule = { row, changes -> assertEquals(4, row.getInt("revision")); patch = changes; acknowledged(row, changes) })
            }
        } } }
        compose.onNodeWithTag("gantt-bar-qa-gantt").performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(400)
        compose.waitUntil(5000) { compose.onAllNodesWithTag("gantt-resize-end-qa-gantt").fetchSemanticsNodes().isNotEmpty() }
        val handle = compose.onNodeWithTag("gantt-resize-end-qa-gantt").performScrollTo().assertHeightIsAtLeast(48.dp)
        handle.performTouchInput { down(center) }
        compose.mainClock.advanceTimeBy(800)
        val weekPixels = 96f * compose.activity.resources.displayMetrics.density
        handle.performTouchInput { moveBy(androidx.compose.ui.geometry.Offset(weekPixels, 0f)); up() }
        compose.waitUntil(5000) { patch != null }
        assertEquals(start.toString(), patch!!.getString("startDate"))
        assertEquals(start.plusDays(8).toString(), patch!!.getString("dueDate"))
        assertEquals(start.plusDays(1).toString(), scheduled.getString("dueDate"))
    }

}
