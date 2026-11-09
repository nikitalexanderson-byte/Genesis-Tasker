package ru.genesis.calendar.ui

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.*

class SprintReportChartTest {
    @Test fun unknownOrUnestimatedValuesRemainGapsAndObservedZeroIsReal() {
        assertNull(reportPlotValue(sprintMetric().put("value", JSONObject.NULL)))
        assertNull(reportPlotValue(sprintMetric().put("unestimated", 1)))
        assertEquals(0.0, reportPlotValue(sprintMetric(0, 0))!!, 0.0)
    }
    @Test fun positionsFollowActualTimeAndDisconnectionsSurviveProjection() {
        val rows = SprintReportProtocol.rows(sprintReportFixture().getJSONObject("flow").getJSONArray("series"))
        rows[1].put("connectPrevious", false)
        val plot = reportPlot(rows) { it.getJSONObject("remaining") }
        assertEquals(0.0, plot.first().x, 0.0); assertEquals(1.0, plot.last().x, 0.0); assertFalse(plot.last().connect)
        assertEquals(.5, reportPlot(listOf(rows[0])) { it.getJSONObject("remaining") }.single().x, 0.0)
    }
    @Test fun absentHistoricalStatusIsUnknownInPartialCoverage() {
        val point = sprintReportFixture().getJSONObject("flow").getJSONArray("series").getJSONObject(0)
        assertEquals(0.0, reportPlotValue(reportStatusMetric(point, "absent"))!!, 0.0)
        point.put("coverage", "partial"); assertNull(reportPlotValue(reportStatusMetric(point, "absent")))
    }
}
