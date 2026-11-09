package ru.genesis.calendar.ui

import androidx.compose.runtime.Composable
import org.json.JSONObject
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import java.time.LocalDate
import kotlin.math.floor

internal data class SharedGanttData(val scheduled: SharedTaskListReader, val unscheduled: SharedTaskListReader,
    val completed: SharedTaskListReader)

@Composable internal fun rememberSharedGanttData(gateway: SharedWorkspaceGateway, filter: JSONObject,
    periods: List<SharedGanttPeriod>, scale: SharedGanttScale, metadata: String): SharedGanttData {
    val scheduled = rememberSharedTaskListReader(gateway)
    val unscheduled = rememberSharedTaskListReader(gateway)
    val completed = rememberSharedTaskListReader(gateway)
    fun base() = JSONObject(filter.toString()).apply {
        remove("dueFrom"); remove("dueTo"); remove("undated"); remove("completion")
    }
    val timed = if (scale == SharedGanttScale.HOURS) "time" else "date"
    ObserveSharedTaskList(scheduled, base().put("completion", "open").put("scheduled", timed)
        .put("from", LocalDate.ofEpochDay(floor(periods.first().start).toLong()).toString())
        .put("to", LocalDate.ofEpochDay(floor(periods.last().end - 1e-7).toLong()).toString()),
        "position", metadata, true, true, {})
    ObserveSharedTaskList(unscheduled, base().put("completion", "open").put("unscheduled", timed), "position", metadata, true, true, {})
    ObserveSharedTaskList(completed, base().put("completion", "completed"), "updatedAt", metadata, true, true, {})
    return SharedGanttData(scheduled, unscheduled, completed)
}

internal fun SharedTaskListReader.ganttRows(): List<JSONObject> = pageState.value?.optJSONArray("tasks")?.let { array ->
    (0 until array.length()).map(array::getJSONObject)
}.orEmpty()
