package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.auth.SprintReportProtocol
import java.text.NumberFormat
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Requests belong to the screen, since choosing a metric removes its originating row. */
internal val LocalTeamReportChoose = staticCompositionLocalOf<(String) -> Unit> { error("Team report action owner is missing") }

@Composable internal fun TeamHeading(label: String) {
    Text(label, Modifier.semantics { heading() }, style = MaterialTheme.typography.titleMedium)
}
@Composable internal fun TeamMetric(state: TeamReportState, label: String, value: JSONObject, display: String? = null) {
    val choose = LocalTeamReportChoose.current; val number = NumberFormat.getIntegerInstance(Locale.forLanguageTag(LocalGenesisLanguage.current))
    val shown = display ?: number.format(value.getInt("count"))
    Column(Modifier.fillMaxWidth()) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        UntranslatedText(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        TextButton({ choose(value.getString("key")) }, enabled = state.ready,
            modifier = Modifier.heightIn(min = 48.dp).testTag("team-open-${value.getString("key")}").semantics { contentDescription = "$label: $shown" }) {
            UntranslatedText(shown, style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.width(8.dp)); AffairsActionIcon(AffairsAction.VIEW)
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    }
}
@Composable internal fun TeamReportSections(state: TeamReportState, pane: String) {
    val report = state.report ?: return
    val language = LocalGenesisLanguage.current
    val number = remember(language) { NumberFormat.getNumberInstance(Locale.forLanguageTag(language)).apply { maximumFractionDigits = 3 } }
    @Composable fun hours(value: Any?) = if (value == null || value == JSONObject.NULL) genesisTranslate("Нет данных") else number.format((value as Number).toDouble() / 3600) + " " + genesisTranslate("ч")
    @Composable fun member(id: String) = importRows(report.getJSONArray("members")).find { it.optString("id") == id }?.optString("title")?.takeUnless { it.isBlank() || it == "null" }
        ?: genesisTranslate(if (id == "unassigned") "Без исполнителя" else "Недоступно")
    val period = report.getJSONObject("period"); val context = period.getJSONObject("calendarContext")
    val calendar = remember(context.toString()) { GenesisCalendar(ZoneId.of(context.getString("timeZone")), 2, context.getString("gregorianYearStart")) }
    when (pane) {
        "summary" -> {
            TeamHeading("Состояние на")
            UntranslatedText(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(Locale.forLanguageTag(language))
                .withZone(ZoneId.of(context.getString("timeZone"))).format(SprintReportProtocol.instant(report.getString("asOf"))), style = MaterialTheme.typography.bodySmall)
            AffairsDisclosure("Период истории") {
                UntranslatedText(period.getString("from") + " — " + period.getString("to"), style = MaterialTheme.typography.bodyMedium)
                Text("Счётчики показывают выбранные задачи на момент отчёта. Период ограничивает историю, время этапов и завершённые циклы.", style = MaterialTheme.typography.bodyMedium)
            }
            for ((key, title) in listOf("all" to "Все задачи", "open" to "Открытые задачи", "completed" to "Завершённые задачи", "overdue" to "Просроченные задачи", "unassigned" to "Без исполнителя"))
                TeamMetric(state, genesisTranslate(title), report.getJSONObject("summary").getJSONObject(key))
            AffairsDisclosure("Возраст открытых задач") {
                Text("Возраст считается от сохранённой даты создания, в полных сутках по 24 часа.", style = MaterialTheme.typography.bodyMedium)
                val titles = mapOf("week" to "До 7 суток", "month" to "От 7 до 29 суток", "quarter" to "От 30 до 89 суток", "older" to "От 90 суток", "unknown" to "Нет данных")
                importRows(report.getJSONArray("ages")).forEach { TeamMetric(state, genesisTranslate(titles.getValue(it.getString("id"))), it.getJSONObject("tasks")) }
            }
        }
        "members" -> ImportBatch("Распределение задач по участникам", importRows(report.getJSONArray("members")), "team-members") { row ->
            UntranslatedText(member(row.getString("id")), style = MaterialTheme.typography.titleSmall)
            for ((key, title) in listOf("all" to "Все задачи", "open" to "Открытые задачи", "completed" to "Завершённые задачи")) TeamMetric(state, genesisTranslate(title), row.getJSONObject(key))
        }
        "time" -> {
            TeamHeading("Время цикла")
            Text("Последний непрерывный цикл: от входа в выбранный статус до завершения. Архив, перенос и неизвестный участок прерывают цикл.", style = MaterialTheme.typography.bodyMedium)
            val cycle = report.getJSONObject("cycle")
            for ((key, title) in listOf("meanSeconds" to "Среднее", "medianSeconds" to "Медиана"))
                TeamMetric(state, genesisTranslate(title), cycle.getJSONObject("known"), hours(cycle.opt(key)))
            TeamMetric(state, genesisTranslate("Измеренные циклы"), cycle.getJSONObject("known"))
            TeamMetric(state, genesisTranslate("Циклы без полной истории"), cycle.getJSONObject("unknown"))
            TeamMetric(state, genesisTranslate("История частично неизвестна"), report.getJSONObject("unknown"))
            if (report.getJSONArray("stages").length() == 0) Text("Нет подтверждённой истории этапов.")
            ImportBatch("Подтверждённое время по этапам", importRows(report.getJSONArray("stages")), "team-stages") { row ->
                TeamMetric(state, row.optString("title").takeUnless { it.isBlank() || it == "null" } ?: genesisTranslate("Недоступно"), row.getJSONObject("tasks"),
                    hours(row.get("seconds")) + " · " + number.format(row.getJSONObject("tasks").getInt("count")))
            }
        }
        "daily" -> {
            TeamHeading("Динамика выбранных задач")
            Text("Показаны подтверждённые события существующих выбранных задач. До появления истории — «Нет данных»; частичная история отмечается отдельно.", style = MaterialTheme.typography.bodyMedium)
            val days = importRows(report.getJSONArray("daily")); var limit by remember(report) { mutableIntStateOf(5) }
            days.take(limit).forEach { day -> key(day.getString("date")) {
                UntranslatedText(genesisTranslate(calendar.formatDate(LocalDate.parse(day.getString("date")), CalendarMode.fromWire(period.getString("calendarMode")))), style = MaterialTheme.typography.titleSmall)
                if (day.getString("coverage") in setOf("unknown", "future")) Text("Нет данных") else {
                    if (day.getString("coverage") == "partial") Text("История частично неизвестна")
                    for ((key, title) in listOf("created" to "Создано", "completed" to "Завершено", "reopened" to "Возвращено в работу", "unknown" to "Нет полной истории"))
                        TeamMetric(state, genesisTranslate(title), day.getJSONObject(key))
                }
            } }
            if (limit < days.size) OutlinedButton({ limit += 5 }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("team-days-more")) { Text("Показать ещё") }
        }
        "estimates" -> {
            val estimates = report.getJSONObject("estimates"); val planning = sharedPlanningCopy()
            TeamHeading(planning.getString("estimates"))
            ImportBatch("Проекты", importRows(estimates.getJSONArray("projects")), "team-estimates") { project ->
                val id = project.getString("projectId")
                UntranslatedText(importRows(report.getJSONObject("catalog").getJSONArray("projects")).find { it.getString("id") == id }?.getString("title") ?: genesisTranslate("Недоступно"), style = MaterialTheme.typography.titleSmall)
                @Composable fun Totals(group: JSONObject) {
                    TeamMetric(state, genesisTranslate("Все задачи"), group.getJSONObject("all"))
                    for (unit in listOf("points", "hours")) {
                        val value = group.getJSONObject(unit)
                        val estimated = value.getJSONObject("estimated").getInt("count")
                        TeamMetric(state, planning.getString(unit), value.getJSONObject("estimated"), if (estimated == 0) genesisTranslate("Нет данных") else number.format(value.getDouble("value")) + " · " + number.format(estimated))
                        TeamMetric(state, planning.getString("unestimated") + " · " + planning.getString(unit), value.getJSONObject("unestimated"))
                    }
                }
                Totals(project)
                ImportBatch("Распределение задач по участникам", importRows(project.getJSONArray("members")), "team-estimate-members-$id") { person ->
                    UntranslatedText(member(person.getString("id")), style = MaterialTheme.typography.titleSmall); Totals(person)
                }
            }
        }
    }
}
