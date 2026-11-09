package ru.genesis.calendar.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import ru.genesis.calendar.auth.SprintReportProtocol
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.text.NumberFormat
import java.util.Locale

internal fun reportPlotValue(metric: JSONObject?): Double? = metric?.takeUnless { it.isNull("value") || it.optLong("unestimated") > 0 }?.getDouble("value")
internal fun reportStatusMetric(point: JSONObject, id: String, wip: Boolean = false): JSONObject =
    point.getJSONObject(if (wip) "wipStatuses" else "statuses").optJSONObject(id) ?: SprintReportProtocol.emptyMetric(point.getString("coverage") == "observed")

internal data class ReportPlotPoint(val x: Double, val value: Double?, val connect: Boolean)
internal fun reportPlot(points: List<JSONObject>, read: (JSONObject) -> JSONObject?): List<ReportPlotPoint> {
    if (points.isEmpty()) return emptyList()
    val times = points.map { SprintReportProtocol.instant(it.getString("at")).toEpochMilli().toDouble() }
    val first = times.first(); val span = times.last() - first
    return points.mapIndexed { index, point -> ReportPlotPoint(if (span == 0.0) .5 else (times[index] - first) / span,
        reportPlotValue(read(point)), point.getBoolean("connectPrevious")) }
}

/** Values, gaps and day labels also have a complete text representation in the Data pane. */
@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun SprintReportChart(id: String, title: String, unit: String, points: List<JSONObject>, statuses: List<Pair<String, String>>,
    read: (JSONObject) -> JSONObject?, stack: Boolean, language: String, date: (String) -> String) {
    val values = reportPlot(points, read)
    val ceiling = maxOf(1.0, values.mapNotNull { it.value }.maxOrNull() ?: 0.0)
    val number = remember(language, ceiling >= 10000) {
        if (ceiling >= 10000) DecimalFormat("0.##E0", DecimalFormatSymbols(Locale.forLanguageTag(language)))
        else NumberFormat.getNumberInstance(Locale.forLanguageTag(language)).apply { maximumFractionDigits = 2 }
    }
    val scheme = MaterialTheme.colorScheme
    val palette = listOf(scheme.primary, scheme.secondary, scheme.tertiary, scheme.onSurfaceVariant)
    Column(Modifier.fillMaxWidth().testTag("report-chart-$id"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        UntranslatedText("$title · $unit", style = MaterialTheme.typography.titleSmall)
        if (values.none { it.value != null }) Text("Нет данных") else {
            Row(Modifier.fillMaxWidth().height(184.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.width(64.dp).fillMaxHeight(), verticalArrangement = Arrangement.SpaceBetween) {
                    for (fraction in listOf(1.0, .5, 0.0)) UntranslatedText(number.format(ceiling * fraction),
                        style = MaterialTheme.typography.labelSmall, color = scheme.onSurfaceVariant)
                }
                Canvas(Modifier.weight(1f).fillMaxHeight().semantics { contentDescription = "$title · $unit" }) {
                    val inset = 6.dp.toPx(); val width = (size.width - inset * 2).coerceAtLeast(1f); val height = size.height - inset * 2
                    fun x(index: Int) = inset + (values[index].x * width).toFloat()
                    fun y(value: Double) = size.height - inset - (value / ceiling * height).toFloat()
                    for (fraction in listOf(0.0, .5, 1.0)) drawLine(scheme.outlineVariant, Offset(inset, y(ceiling * fraction)), Offset(size.width - inset, y(ceiling * fraction)), 1.dp.toPx())
                    if (!stack) {
                        val path = Path(); var previous: Int? = null
                        values.forEachIndexed { index, point ->
                            val value = point.value
                            if (value == null) previous = null else {
                                if (previous == null || !point.connect) path.moveTo(x(index), y(value))
                                else { path.lineTo(x(index), y(requireNotNull(values[previous!!].value))); path.lineTo(x(index), y(value)) }
                                drawCircle(scheme.primary, 3.dp.toPx(), Offset(x(index), y(value))); previous = index
                            }
                        }
                        drawPath(path, scheme.primary, style = Stroke(2.dp.toPx()))
                    } else {
                        val known = points.mapIndexed { index, point -> values[index].value != null && statuses.all { reportPlotValue(reportStatusMetric(point, it.first)) != null } }
                        val groups = mutableListOf<MutableList<Int>>()
                        points.indices.forEach { index ->
                            if (known[index]) {
                                if (index == 0 || !known[index - 1] || !values[index].connect) groups.add(mutableListOf())
                                groups.last().add(index)
                            }
                        }
                        statuses.forEachIndexed { statusIndex, status ->
                            fun low(index: Int) = statuses.take(statusIndex).sumOf { reportPlotValue(reportStatusMetric(points[index], it.first)) ?: 0.0 }
                            fun high(index: Int) = low(index) + (reportPlotValue(reportStatusMetric(points[index], status.first)) ?: 0.0)
                            val ink = palette[statusIndex % palette.size]
                            groups.forEach { group ->
                                val path = Path(); path.moveTo(x(group.first()), y(high(group.first())))
                                group.drop(1).forEachIndexed { step, index -> path.lineTo(x(index), y(high(group[step]))); path.lineTo(x(index), y(high(index))) }
                                path.lineTo(x(group.last()), y(low(group.last())))
                                for (step in group.lastIndex downTo 1) { path.lineTo(x(group[step]), y(low(group[step - 1]))); path.lineTo(x(group[step - 1]), y(low(group[step - 1]))) }
                                path.close(); drawPath(path, ink.copy(alpha = .55f)); drawPath(path, ink, style = Stroke(1.dp.toPx()))
                                if (group.size == 1) drawCircle(ink, 3.dp.toPx(), Offset(x(group.first()), y(high(group.first()))))
                            }
                        }
                    }
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                UntranslatedText(date(points.first().getString("date")), Modifier.weight(1f), style = MaterialTheme.typography.labelSmall)
                if (points.size > 1) UntranslatedText(date(points.last().getString("date")), Modifier.weight(1f), style = MaterialTheme.typography.labelSmall)
            }
        }
        if (stack) FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            statuses.forEachIndexed { index, status -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Canvas(Modifier.size(12.dp).padding(top = 3.dp)) { drawCircle(palette[index % palette.size]) }
                UntranslatedText(status.second, style = MaterialTheme.typography.bodySmall)
            } }
        }
    }
}
