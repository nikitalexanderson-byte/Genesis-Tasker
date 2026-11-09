package ru.genesis.calendar.ui

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SharedPlanningStateTest {
    @Test fun newSprintUsesAServerCompatibleDeviceZoneWithoutChangingItsCivilDuration() {
        val original = java.util.TimeZone.getDefault()
        try {
            for (zone in listOf("GMT", "UTC", "Europe/Berlin", "Pacific/Kiritimati")) {
                java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone(zone))
                val draft = newPlanningSprint(ru.genesis.calendar.data.UiPreferences()).getJSONObject("draft")
                assertEquals(if (zone == "GMT") "UTC" else zone, draft.getJSONObject("calendarContext").getString("timeZone"))
                assertEquals(13L, java.time.temporal.ChronoUnit.DAYS.between(java.time.LocalDate.parse(draft.getString("startDate")), java.time.LocalDate.parse(draft.getString("endDate"))))
            }
        } finally { java.util.TimeZone.setDefault(original) }
    }
    private fun totals() = JSONObject().put("count",131).put("completed",1)
        .put("points",JSONObject().put("value",0).put("unestimated",130))
        .put("hours",JSONObject().put("value",2.5).put("unestimated",129))
    private fun snapshot() = JSONObject().put("config",JSONObject().put("enabled",true).put("estimateUnit","points"))
        .put("context",JSONObject().put("permissions",JSONObject().put("editTasks",true).put("organizeTasks",true).put("manageProjects",false)))
        .put("sprints",JSONArray().put(JSONObject().put("id","sprint").put("projectId","project").put("state","planning")
            .put("startDate","2026-03-20").put("endDate","2026-03-27").put("calendarMode","sacred")
            .put("calendarContext",JSONObject().put("version",1).put("timeZone","Europe/Moscow").put("gregorianYearStart","march"))))
        .put("totals",JSONObject().put("backlog",totals()).put("sprint",totals()))
        .put("byAssignee",JSONObject().put("backlog",JSONObject().put("unassigned",totals())))
    private fun page(from:Int,to:Int,version:String="v1")=JSONObject().put("queryVersion",version).put("total",131)
        .put("nextCursor",if(to<131)"next" else JSONObject.NULL).put("tasks",JSONArray((from until to).map{
            JSONObject().put("id","task-$it").put("projectId","project").put("revision",1)
        }))
    private fun rejected(block:()->Unit){assertTrue(runCatching(block).isFailure)}
    @Test fun projectionPreservesIndependentTotalsAndSavedCalendarContext() {
        val data=validatePlanning("project",snapshot())
        assertEquals(0.0,data.getJSONObject("totals").getJSONObject("backlog").getJSONObject("points").getDouble("value"),0.0)
        assertEquals(130,data.getJSONObject("totals").getJSONObject("backlog").getJSONObject("points").getInt("unestimated"))
        assertEquals(1,data.getJSONArray("sprints").getJSONObject(0).getJSONObject("calendarContext").getInt("version"))
        rejected{validatePlanning("another",snapshot())}
        rejected{validatePlanning("project",snapshot().apply{getJSONObject("totals").getJSONObject("backlog").getJSONObject("points").put("unestimated",132)})}
        rejected{validatePlanning("project",snapshot().apply{getJSONObject("context").getJSONObject("permissions").remove("organizeTasks")})}
    }
    @Test fun oneHundredAndThirtyOneTasksHaveNoLostOrDuplicateRows() {
        val first=mergePlanningPage("project",null,page(0,100),false)
        val full=mergePlanningPage("project",first,page(100,131),true)
        assertEquals(131,full.getJSONArray("tasks").length());assertTrue(full.isNull("nextCursor"))
        rejected{mergePlanningPage("project",first,page(100,131,"changed"),true)}
        rejected{mergePlanningPage("project",first,page(99,130),true)}
        rejected{mergePlanningPage("other",null,page(0,100),false)}
        assertEquals(31,mergePlanningPage("project",first,page(100,131,"changed"),false).getJSONArray("tasks").length())
    }
    @Test fun bucketFiltersUseExistingBackendCriteria() {
        val backlog=planningTaskFilter("project","backlog");assertTrue(backlog.getBoolean("backlog"));assertFalse(backlog.has("sprintId"))
        val sprint=planningTaskFilter("project","sprint");assertEquals("sprint",sprint.getString("sprintId"));assertFalse(sprint.has("backlog"))
    }
    @Test fun assignmentRechecksPermissionsPendingAndDestinationWithoutTouchingEstimates() {
        val task=JSONObject().put("id","task").put("projectId","project").put("revision",8).put("sprintId",JSONObject.NULL)
            .put("storyPoints",0).put("estimateHours",2.5)
        val patch=planningAssignment(snapshot(),"project",task,"sprint",false)
        assertEquals(setOf("sprintId","expectedRevision"),patch.keys().asSequence().toSet())
        assertEquals(8,patch.getInt("expectedRevision"));assertEquals("sprint",patch.getString("sprintId"))
        rejected{planningAssignment(snapshot(),"project",task,"sprint",true)}
        rejected{planningAssignment(snapshot().put("offlineCache",true),"project",task,"sprint",false)}
        rejected{planningAssignment(snapshot().apply{getJSONObject("context").getJSONObject("permissions").put("organizeTasks",false)},"project",task,"sprint",false)}
        rejected{planningAssignment(snapshot().apply{getJSONArray("sprints").getJSONObject(0).put("state","completed")},"project",task,"sprint",false)}
        rejected{planningAssignment(snapshot(),"project",task,null,false)}
        val clear=planningAssignment(snapshot(),"project",JSONObject(task.toString()).put("sprintId","sprint"),null,false)
        assertTrue(clear.isNull("sprintId"))
    }
}
