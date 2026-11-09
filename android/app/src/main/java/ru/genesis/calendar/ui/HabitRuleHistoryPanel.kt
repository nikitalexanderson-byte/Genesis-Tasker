package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.time.*
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale
import java.util.UUID
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*

@Composable
internal fun HabitRuleHistoryPanel(habit: Habit,date: LocalDate,disabled: Boolean,
    onChoose: (String,List<String>,String)->Unit) {
    val context=LocalContext.current;val language=LocalGenesisLanguage.current
    fun t(text: String)=translateGenesisText(context,text,language)
    val app=context.applicationContext as GenesisApplication
    val preferences=remember(app) { LocalPreferences(app,app.workspaceScope) }
    val prefs by preferences.values.collectAsStateWithLifecycle(UiPreferences())
    val frontier=HabitRuleHistory.state(habit,LocalDate.MAX).frontier;val conflict=frontier.size>1
    val current=HabitRuleHistory.state(habit,date)
    val history=habit.ruleHistory.ifEmpty { listOf(HabitMeasurements.rule(habit,habit.createdDate)) }
    var expanded by remember(habit.id) { mutableStateOf(conflict) };var limit by remember(habit.id) { mutableIntStateOf(20) }
    val operations=remember(habit.id) { mutableMapOf<String,String>() }
    val visible=(history.takeLast(limit)+frontier).map { it.id }.toSet()
    Column(Modifier.fillMaxWidth().testTag("habit-rule-history-${habit.id}"),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text("История целей и расписаний",style=MaterialTheme.typography.titleSmall)
        if(conflict) {
            Text("Правила изменены на нескольких устройствах. Выберите действующий вариант.",color=MaterialTheme.colorScheme.error)
            Text("До выбора спорные дни нейтральны; новые записи и награды приостановлены.")
        }
        TextButton(onClick={expanded=!expanded}) { Text("${t("Показать версии")} · ${history.size}") }
        if(expanded) history.asReversed().filter { it.id in visible }.forEach { rule ->
            HorizontalDivider()
            Text(when {
                conflict&&frontier.any { it.id==rule.id } -> "Конфликт правил"
                rule.selectedRuleId!=null -> "Выбор сохранён"
                rule.effectiveDate>date -> "Запланировано"
                current.appliedVersion.id==rule.id -> "Действует"
                else -> "Предыдущее правило"
            },style=MaterialTheme.typography.labelLarge)
            val goal=rule.periodGoal;val measurement=rule.measurement;val recurrence=rule.schedule.recurrence
            val mode=when(recurrence.mode) { "classic"->CalendarMode.PROFANE;"lunar"->CalendarMode.LUNAR;else->CalendarMode.SACRED }
            val saved=recurrence.calendarContext ?: CalendarContext(version=1,timeZone=rule.schedule.timezone)
            val calendar=remember(saved) { GenesisCalendar(ZoneId.of(saved.timeZone),saved.version,saved.gregorianYearStart) }
            fun amount(value: Long)="${HabitMeasurements.format(value,language)} ${if(measurement?.kind=="duration") t("мин") else measurement?.unit.orEmpty()}"
            val unit=if(goal?.metric=="sum") amount(goal.target) else goal?.target?.toString()
                ?: measurement?.let { amount(it.target) } ?: t("Выполнено / не выполнено")
            Text("${t(when(goal?.period) { "week"->"За неделю";"month"->"За месяц";else->"За день" })}: $unit")
            if(goal!=null) {
                Text(when(goal.metric) { "days"->"Разные дни";"entries"->"Отдельные выполнения";else->"Сумма значений" })
                Text("${t("Календарь цели")}: ${t(when(goal.calendar) { "profane"->"Григорианский";"lunar"->"Лунный";else->"Сакральный" })} · ${goal.context.timeZone}")
            }
            val pattern=when(recurrence.pattern) {
                "daily"->"Ежедневно";"weekdays"->"Дни недели";"monthly","month-days","lunar-days"->"Дни месяца"
                "yearly","lunar-yearly"->"Ежегодно";"pyata-days"->"Дни пяты";"lunar-decades"->"Декады"
                "lunar-decade-days"->"Дни внутри декад";else->"Фазы Луны"
            }
            Text("${t(when(mode) { CalendarMode.PROFANE->"Григорианский";CalendarMode.LUNAR->"Лунный";else->"Сакральный" })} · ${rule.schedule.timezone}")
            Text(if(recurrence.enabled) "${t(pattern)} · ${t("Интервал")}: ${recurrence.interval}" else t("Без повторения"))
            if(recurrence.enabled&&recurrence.pattern!="daily") {
                val days=recurrence.days.joinToString(", ") { if(recurrence.pattern=="weekdays") DayOfWeek.of(it).getDisplayName(TextStyle.SHORT,Locale.forLanguageTag(language)) else it.toString() }
                Text("${t("Дни")}: $days")
                if(recurrence.months.isNotEmpty()) Text("${t("Месяцы")}: ${recurrence.months.joinToString(", ")}")
                if(recurrence.pyatas.isNotEmpty()) Text("${t(if(recurrence.mode=="lunar") "Декады" else "Пяты")}: ${recurrence.pyatas.joinToString(", ")}")
            }
            Text("${t("Начало")}: ${calendar.formatDate(rule.schedule.startDate,mode)}"+
                (rule.schedule.endDate?.let { " · ${t("Конец")}: ${calendar.formatDate(it,mode)}" } ?: ""))
            Text("${t("Вступает в силу")}: ${calendar.formatDate(rule.effectiveDate,mode)}")
            if(rule.recordedAt!="1970-01-01T00:00:00.000Z") {
                val instant=Instant.parse(rule.recordedAt).atZone(ZoneId.of(rule.schedule.timezone))
                Text("${t("Записано")}: ${calendar.formatDate(instant.toLocalDate(),mode)} · ${instant.format(DateTimeFormatter.ofPattern(if(prefs.use24) "HH:mm" else "h:mm a",Locale.forLanguageTag(language)))}")
            }
            if(conflict&&frontier.any { it.id==rule.id }) OutlinedButton(enabled=!disabled,onClick={
                val heads=frontier.map { it.id }.sorted();val key=rule.id+heads.joinToString("|")
                onChoose(rule.id,heads,operations.getOrPut(key) { "rule-choice:${UUID.randomUUID()}" })
            },modifier=Modifier.testTag("choose-habit-rule-${rule.id}")) { Text("Выбрать это правило") }
        }
        if(expanded&&history.size>visible.size) TextButton(onClick={limit+=20}) { Text("Ещё версии") }
        Text("Выбор сохраняет альтернативы и прежние ID записей. Прошлые награды не начисляются повторно.",style=MaterialTheme.typography.bodySmall)
        if(conflict) Text("Выбор меняет только правило. Остальные несохранённые правки не применяются.",style=MaterialTheme.typography.bodySmall)
    }
}
