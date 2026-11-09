package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.HabitGoalComparison
import java.text.NumberFormat
import java.util.Locale

@Composable private fun comparisonCopy(source: String, vararg values: Pair<String, String>): String {
    var result = genesisTranslate(source)
    values.forEach { (key, value) -> result = result.replace("{$key}", value) }
    return result
}

/** Closed goals are counted separately from elapsed days; relative change uses the previous goal count. */
@Composable internal fun HabitComparisonDetails(data: HabitGoalComparison, calendar: GenesisCalendar, mode: CalendarMode) {
    val locale = Locale.forLanguageTag(LocalGenesisLanguage.current)
    val number = NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 1 }
    val percentage = NumberFormat.getPercentInstance(locale).apply { maximumFractionDigits = 1 }
    fun percent(value: Double?) = value?.let { percentage.format(it / 100) } ?: "—"
    Text("Сравниваются одинаковые прошедшие отрезки двух периодов. Сегодняшний день не учитывается.",
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (data.elapsed == 0) {
        Text("В этом периоде пока нет прошедших дней для сравнения.", Modifier.testTag("habit-comparison-empty"))
        return
    }
    listOf(Triple("Текущий период", data.start to data.start.plusDays(data.elapsed - 1L), data.current),
        Triple("Предыдущий период", data.previousStart to requireNotNull(data.previousEnd), data.previous)).forEachIndexed { index, (title, dates, part) ->
        if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Column(Modifier.fillMaxWidth().testTag(if (index == 0) "habit-comparison-current" else "habit-comparison-previous"),
            verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            UntranslatedText("${calendar.formatDate(dates.first, mode)} — ${calendar.formatDate(dates.second, mode)}",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            UntranslatedText(comparisonCopy("Выполнено {completed} из {planned} целей", "completed" to number.format(part.completed), "planned" to number.format(part.planned)),
                style = MaterialTheme.typography.bodyMedium)
            UntranslatedText(comparisonCopy("Доля выполнения: {percent}", "percent" to percent(part.percent)), style = MaterialTheme.typography.bodySmall)
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    Column(Modifier.fillMaxWidth().testTag("habit-comparison-change"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Изменение числа выполненных целей", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        val difference = (if (data.absoluteChange > 0) "+" else "") + number.format(data.absoluteChange)
        UntranslatedText(comparisonCopy("Разница: {count}", "count" to difference), style = MaterialTheme.typography.bodyMedium)
        if (data.changePercent == null) Text("Процентное сравнение недоступно: не хватает сопоставимых данных.", style = MaterialTheme.typography.bodySmall)
        else UntranslatedText(comparisonCopy("Изменение к предыдущему периоду: {percent}", "percent" to percent(data.changePercent)), style = MaterialTheme.typography.bodySmall)
    }
    if (data.current.unknown + data.previous.unknown > 0) UntranslatedText(
        comparisonCopy("Дни привычек с неизвестной историей пауз: {count}. Они исключены из расчёта.", "count" to number.format(data.current.unknown + data.previous.unknown)),
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
