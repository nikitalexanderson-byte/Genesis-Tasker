package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.auth.SprintReportProtocol
import java.text.NumberFormat
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

@Composable internal fun SharedSprintReportScreen(controller: SharedWorkspaceGateway, projectId: String, sprintId: String,
    initialUnit: String, onClose: () -> Unit, onLost: () -> Unit) {
    key(controller, projectId, sprintId, LocalGenesisUserId.current) {
        SprintReportContent(controller, projectId, sprintId, initialUnit, onClose, onLost)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun SprintReportContent(controller: SharedWorkspaceGateway, projectId: String, sprintId: String,
    initialUnit: String, onClose: () -> Unit, onLost: () -> Unit) {
    val copy = sharedWorkflowCopy("sprint-report-translations.json"); val planning = sharedPlanningCopy()
    val language = LocalGenesisLanguage.current; val locale = remember(language) { Locale.forLanguageTag(language) }
    val number = remember(locale) { NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 2 } }
    val scope = rememberCoroutineScope(); val lost by rememberUpdatedState(onLost)
    val state = remember { SprintReportState(controller, projectId, sprintId, initialUnit) { lost() } }
    val lifecycle = LocalLifecycleOwner.current.lifecycle.currentStateAsState().value
    var wipStatus by rememberSaveable { mutableStateOf("all") }; var dailyLimit by remember { mutableIntStateOf(50) }
    DisposableEffect(state) { onDispose { state.close() } }
    LaunchedEffect(state) { state.refresh() }
    LaunchedEffect(state, lifecycle.isAtLeast(Lifecycle.State.STARTED)) {
        if (!lifecycle.isAtLeast(Lifecycle.State.STARTED)) return@LaunchedEffect
        state.check()
        while (isActive) { delay(30000); state.check() }
    }
    val report = state.report; val flow = report?.getJSONObject("flow"); val available = flow?.getBoolean("available") == true
    val points = remember(report) { if (available) SprintReportProtocol.rows(flow!!.getJSONArray("series")) else emptyList() }
    val statuses = remember(report, copy) {
        val known = report?.let { SprintReportProtocol.rows(it.getJSONArray("statuses")) }.orEmpty()
        points.flatMap { it.getJSONObject("statuses").keys().asSequence().toList() }.distinct()
            .sortedBy { id -> known.find { it.getString("id") == id }?.getLong("position") ?: Long.MAX_VALUE }
            .map { id -> id to (known.find { it.getString("id") == id }?.getString("title") ?: copy.getString("historicalStatus")) }
    }
    val wipIds = remember(report) { points.flatMap { it.getJSONObject("wipStatuses").keys().asSequence().toList() }.distinct() }
    val selectedWip = wipStatus.takeIf { it == "all" || it in wipIds } ?: "all"
    val launch = report?.getJSONObject("launch")
    fun date(raw: String) = launch?.let { planningPeriod(JSONObject(it.toString()).put("startDate", raw).put("endDate", raw), language).substringBefore(" — ") } ?: raw
    fun stamp(raw: String): String = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale)
        .withZone(ZoneId.of(launch?.getJSONObject("calendarContext")?.getString("timeZone") ?: "UTC")).format(SprintReportProtocol.instant(raw))
    fun metricValue(metric: JSONObject): String = if (metric.isNull("value") || !metric.isNull("tasks") && metric.getLong("tasks") > 0 && metric.optLong("unestimated") == metric.getLong("tasks"))
        copy.getString("unknown") else number.format(metric.getDouble("value"))
    fun metricDetail(metric: JSONObject) = buildList {
        add(planning.getString("count") + ": " + if (metric.isNull("tasks")) copy.getString("unknown") else number.format(metric.getLong("tasks")))
        if (metric.optLong("unestimated") > 0) add(planning.getString("unestimated") + ": " + number.format(metric.getLong("unestimated")))
        if (!metric.isNull("value") && metric.optLong("unestimated") > 0 && metric.optLong("unestimated") != metric.optLong("tasks")) add(copy.getString("knownPart"))
    }.joinToString(" · ")
    fun choose(query: JSONObject, more: Boolean = false) { scope.launch { state.choose(query, more) } }
    fun back() { when { state.task != null -> state.backToSources(); state.pane == "sources" -> state.closeSources(); else -> onClose() } }
    @Composable fun Heading(label: String) { UntranslatedText(label, Modifier.semantics { heading() }, style = MaterialTheme.typography.titleMedium) }
    @Composable fun Metric(label: String, metric: JSONObject, key: String? = null) {
        Column(Modifier.fillMaxWidth().testTag("report-metric-${key ?: label}"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                UntranslatedText(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                if (key != null) TextButton({ choose(SprintReportProtocol.query("tasks", key)) }, enabled = state.ready,
                    modifier = Modifier.heightIn(min = 48.dp).testTag("report-open-$key")) {
                    UntranslatedText(metricValue(metric), style = MaterialTheme.typography.titleMedium)
                } else UntranslatedText(metricValue(metric), style = MaterialTheme.typography.titleSmall)
            }
            UntranslatedText(metricDetail(metric), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
    @Composable fun Navigation(modifier: Modifier) {
        Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            ReportChoice(copy.getString("unit"), SprintReportProtocol.units.map { it to planning.getString(if (it == "tasks") "count" else it) },
                state.unit, !state.busy && !state.lost, "report-unit") { scope.launch { state.refresh(it) } }
            val panes = listOf("overview" to genesisTranslate("Обзор"), "charts" to copy.getString("flow"), "data" to copy.getString("data")) +
                if (state.selection != null) listOf("sources" to copy.getString("sources")) else emptyList()
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                panes.forEach { (id, label) ->
                    FilterChip(selected = state.pane == id, onClick = { state.backToSources(); state.pane = id },
                        enabled = report != null, label = { UntranslatedText(label) },
                        modifier = Modifier.heightIn(min = 48.dp).testTag("report-pane-$id"))
                }
            }
            if (report != null) {
                UntranslatedText(planningPeriod(report.getJSONObject("launch"), language), style = MaterialTheme.typography.bodyMedium)
                UntranslatedText(stamp(report.getString("asOf")), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                UntranslatedText(report.getJSONObject("launch").getJSONObject("calendarContext").getString("timeZone"), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
    @Composable fun Observation(value: JSONObject) {
        SharedTaskEstimates(value, sharedTaskDetailDraft(value), true, false, true, {})
    }
    @Composable fun Source(item: JSONObject) {
        val task = item.optJSONObject("task") ?: item.takeIf { it.has("projectId") && it.has("title") }
        Column(Modifier.fillMaxWidth().testTag("report-source-${item.getString("id")}"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (task != null) TextButton({ scope.launch { state.openTask(task) } }, enabled = state.ready,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("report-source-open-${task.getString("id")}")) {
                UntranslatedText(task.getString("title"), Modifier.fillMaxWidth(), style = MaterialTheme.typography.titleSmall)
            } else UntranslatedText(copy.getString(if (item.optBoolean("unavailable")) "unavailable" else when (item.optString("action")) {
                "sprint.started" -> "startEvent"; "sprint.completed" -> "closeEvent"; else -> "stateEvent"
            }), style = MaterialTheme.typography.titleSmall)
            item.optString("at").takeIf { it.isNotBlank() }?.let { UntranslatedText(stamp(it), style = MaterialTheme.typography.bodySmall) }
            val kind = when {
                item.optBoolean("completionCarry") -> "carryEvent"
                item.optBoolean("leftScope") || item.optString("kind") == "removed" -> "removed"
                item.optString("kind") == "added" -> "added"
                item.optString("kind") == "estimate" -> "estimateDelta"
                else -> null
            }
            kind?.let { UntranslatedText(copy.getString(it), style = MaterialTheme.typography.bodySmall) }
            if (item.optString("kind") == "estimate" && item.optJSONObject("before") != null && item.optJSONObject("after") != null) {
                for (key in listOf("before", "after")) { UntranslatedText(copy.getString(key), style = MaterialTheme.typography.labelLarge); Observation(item.getJSONObject(key)) }
            } else (item.optJSONObject("observed") ?: item.optJSONObject("after") ?: item.optJSONObject("before"))?.let { Observation(it) }
            HorizontalDivider()
        }
    }
    @Composable fun Content(modifier: Modifier, compact: Boolean) {
        val list = androidx.compose.foundation.lazy.rememberLazyListState()
        LaunchedEffect(state.pane, state.task) { list.scrollToItem(0) }
        LazyColumn(modifier.testTag("report-content"), state = list, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (compact) item { Navigation(Modifier.fillMaxWidth()) }
            if (state.busy) item { WorkspaceLoadingLine(Modifier.fillMaxWidth().testTag("report-loading")) }
            if (state.error.isNotBlank()) item {
                val message = when (state.error) {
                    "REPORT_CHANGED", "REPORT_TOKEN_INVALID" -> copy.getString("stale")
                    "NETWORK" -> copy.getString("offline")
                    "UNAUTHORIZED", "NOT_DEPLOYED" -> genesisTranslate("Нет доступа")
                    "SOURCE_UNAVAILABLE" -> copy.getString("unavailable")
                    "SPRINT_REPORT_TOO_LARGE" -> copy.getString("tooLarge")
                    "SPRINT_REPORT_HISTORY_INVALID" -> copy.getString("partial")
                    else -> planning.getString("error")
                }
                UntranslatedText(message, Modifier.testTag("report-error"), color = MaterialTheme.colorScheme.error)
            }
            if (state.offline) item { UntranslatedText(copy.getString("stale"), Modifier.testTag("report-offline"), color = MaterialTheme.colorScheme.onSurfaceVariant) }
            val actual = state.task
            when {
                actual != null -> item {
                    Column(Modifier.fillMaxWidth().testTag("report-actual-task"), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        Heading(genesisTranslate("Задача"))
                        UntranslatedText(actual.getString("title"), style = MaterialTheme.typography.titleLarge)
                        if (actual.optString("description").isNotBlank()) UntranslatedText(actual.getString("description"))
                        if (!actual.isNull("archivedAt")) Text("Архив")
                        SharedTaskEstimates(actual, sharedTaskDetailDraft(actual), true, false, true, {})
                        SharedTaskDetailsFields(actual, sharedTaskDetailDraft(actual), {}, true)
                    }
                }
                state.pane == "sources" -> {
                    item { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Heading(copy.getString(when (state.selection?.optString("kind")) { "events" -> "events"; "changes" -> "changes"; else -> "sources" }))
                        state.selection?.optString("date")?.takeIf { it.isNotBlank() }?.let { UntranslatedText(date(it)) }
                        state.sources?.let { source ->
                            UntranslatedText(number.format(source.getJSONArray("items").length()) + " / " + number.format(source.getLong("total")), Modifier.testTag("report-source-count"))
                            if (source.getLong("unavailable") > 0) UntranslatedText(copy.getString("unavailable") + " · " + number.format(source.getLong("unavailable")))
                            if (source.getJSONArray("items").length() == 0) UntranslatedText(copy.getString("empty"))
                        }
                    } }
                    items(state.sources?.let { SprintReportProtocol.rows(it.getJSONArray("items")) }.orEmpty(), key = { "source-" + it.getString("id") }) { Source(it) }
                    if (state.sources?.isNull("nextCursor") == false) item { TextButton({ state.selection?.let { choose(it, true) } }, enabled = state.ready,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("report-more-sources")) { Text("Показать ещё") } }
                }
                report != null && !available -> item {
                    UntranslatedText(copy.getString(when {
                        report.getJSONObject("sprint").getString("state") == "planning" -> "notStarted"
                        flow!!.optString("reason") == "terminal-observation-missing" -> "missingEnd"
                        else -> "missingStart"
                    }), Modifier.testTag("report-unavailable"))
                }
                available -> when (state.pane) {
                    "overview" -> {
                        val summary = flow!!.getJSONObject("summary")
                        item { Column(Modifier.testTag("report-overview"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            if (!flow.getBoolean("historyComplete")) UntranslatedText(copy.getString("partial"), Modifier.testTag("report-partial"))
                            for (key in listOf("plan", "alreadyDone", "delivered", "remaining", "carried", "scope"))
                                Metric(copy.getString(if (key == "remaining" && flow.getBoolean("terminal")) "closedRemaining" else key), summary.getJSONObject(key), key)
                            AffairsDisclosure(copy.getString("changes"), Modifier.testTag("report-scope-details")) {
                                for (key in listOf("added", "removed")) Metric(copy.getString(key), summary.getJSONObject(key))
                                val observed = summary.getString("scopeChangeCoverage") == "observed"
                                for (key in listOf("estimateDelta", "unestimatedDelta")) {
                                    UntranslatedText(copy.getString(key), style = MaterialTheme.typography.labelLarge)
                                    UntranslatedText(if (observed) number.format(summary.getDouble(key)) else copy.getString("unknown"))
                                }
                            }
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                for (kind in listOf("events", "changes")) OutlinedButton({ choose(SprintReportProtocol.query(kind)) }, enabled = state.ready,
                                    modifier = Modifier.heightIn(min = 48.dp).testTag("report-open-$kind")) { UntranslatedText(copy.getString(kind)) }
                            }
                        } }
                    }
                    "charts" -> {
                        item { UntranslatedText(copy.getString("daily"), style = MaterialTheme.typography.bodySmall) }
                        if (!flow!!.getBoolean("historyComplete")) item { UntranslatedText(copy.getString("partial")) }
                        item { ReportChoice(copy.getString("wip"), listOf("all" to copy.getString("allStatuses")) + wipIds.map { id -> id to (statuses.find { it.first == id }?.second ?: copy.getString("historicalStatus")) }, selectedWip, true, "report-wip") { wipStatus = it } }
                        for (key in listOf("burndown", "wip", "flow")) item {
                            SprintReportChart(key, copy.getString(key), planning.getString(if (state.unit == "tasks") "count" else state.unit), points, statuses,
                                read = { point -> when (key) { "burndown" -> point.getJSONObject("remaining"); "wip" -> if (selectedWip == "all") point.getJSONObject("wip") else reportStatusMetric(point, selectedWip, true); else -> point.getJSONObject("scope") } },
                                stack = key == "flow", language = language, date = ::date)
                        }
                    }
                    "data" -> {
                        item { Heading(copy.getString("data")); UntranslatedText(copy.getString("daily"), style = MaterialTheme.typography.bodySmall) }
                        items(points.take(dailyLimit).indices.toList(), key = { "day-$it" }) { index ->
                            val point = points[index]
                            Column(Modifier.fillMaxWidth().testTag("report-day-$index"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Heading(date(point.getString("date")))
                                if (point.getString("sourceKind") == "current-snapshot") UntranslatedText(copy.getString("snapshot"), style = MaterialTheme.typography.bodySmall)
                                if (point.getString("coverage") == "partial" || point.optBoolean("gapWithinBucket")) UntranslatedText(copy.getString("knownPart"))
                                for ((key, label) in listOf("scope" to copy.getString("scope"), "remaining" to copy.getString("burndown"), "done" to genesisTranslate("Завершено"), "wip" to copy.getString("wip"))) Metric(label, point.getJSONObject(key))
                                AffairsDisclosure(copy.getString("flow")) { statuses.forEach { Metric(it.second, reportStatusMetric(point, it.first)) } }
                                OutlinedButton({ choose(SprintReportProtocol.query("events", date = point.getString("date"))) }, enabled = state.ready,
                                    modifier = Modifier.heightIn(min = 48.dp).testTag("report-day-sources-$index")) { UntranslatedText(copy.getString("events")) }
                            }
                        }
                        if (dailyLimit < points.size) item { TextButton({ dailyLimit += 50 }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Показать ещё") } }
                    }
                }
            }
        }
    }
    Dialog(onDismissRequest = ::back, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        GenesisModalFrame(::back) {
            Column(Modifier.fillMaxWidth().padding(16.dp).testTag("shared-sprint-report"), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                AffairsPageHeader(report?.getJSONObject("sprint")?.getString("title") ?: copy.getString("heading"),
                    if (report == null) "" else copy.getString("heading"), titleIsUserContent = true, onBack = ::back, actions = {
                        AffairsIconButton("Обновить", AffairsAction.REFRESH, { scope.launch { state.refresh() } }, Modifier.testTag("report-refresh"), !state.busy && !state.lost)
                        AffairsIconButton("Закрыть", AffairsAction.CLOSE, ::back)
                    })
                BoxWithConstraints(Modifier.weight(1f, fill = false).fillMaxWidth()) {
                    if (maxWidth >= 720.dp) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                        Navigation(Modifier.width(248.dp).verticalScroll(rememberScrollState()))
                        Content(Modifier.weight(1f), false)
                    } else Content(Modifier.fillMaxWidth(), true)
                }
            }
        }
    }
}

@Composable private fun ReportChoice(label: String, choices: List<Pair<String, String>>, selected: String,
    enabled: Boolean, tag: String, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        UntranslatedText(label, style = MaterialTheme.typography.labelLarge)
        Box {
            OutlinedButton({ expanded = true }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(tag)) {
                UntranslatedText(choices.find { it.first == selected }?.second ?: label, Modifier.weight(1f))
                AffairsActionIcon(AffairsAction.EXPAND)
            }
            DropdownMenu(expanded, { expanded = false }) { choices.forEach { (id, title) ->
                DropdownMenuItem(text = { UntranslatedText(title) }, onClick = { expanded = false; onSelect(id) }, modifier = Modifier.testTag("$tag-$id"))
            } }
        }
    }
}
