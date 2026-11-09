package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.ZoneId
import java.text.NumberFormat
import java.util.Locale
import ru.genesis.calendar.domain.CalendarContext
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.*

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun HabitPeriodGoalFields(goal: HabitPeriodGoal?, measurement: HabitMeasurement?, mode: CalendarMode,
    zone: String, existing: Boolean, onChange: (HabitPeriodGoal?) -> Unit, onValidity: (Boolean) -> Unit, hadPeriodGoal: Boolean = false) {
    var target by remember { mutableStateOf(if(goal?.metric=="sum") HabitMeasurements.editValue(goal.target) else (goal?.target ?: 3).toString()) }
    var invalid by remember { mutableStateOf(false) }
    fun change(next: HabitPeriodGoal?, text: String = target) {
        if(next==null) { invalid=false;onValidity(true);onChange(null);return }
        val amount=if(next.metric=="sum") HabitMeasurements.parse(text) else text.takeIf { it.matches(Regex("[0-9]+")) }?.toLongOrNull()
        val maximum=when(next.metric) { "days"->31L;"entries"->1_000_000L;else->MAX_HABIT_MEASUREMENT }
        val valid=amount!=null&&amount in 1..maximum
        invalid=!valid;onValidity(valid)
        if(valid) onChange(next.copy(target=amount!!))
    }
    Column(Modifier.fillMaxWidth().testTag("habit-period-fields"),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text("Период цели",style=MaterialTheme.typography.titleMedium)
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            listOf(null to "За день","week" to "За неделю","month" to "За месяц").forEach { (period,label) ->
                FilterChip(selected=goal?.period==period,onClick={
                    if(period==null) change(null)
                    else if(goal!=null) change(goal.copy(period=period))
                    else { target="3";change(HabitPeriodGoal(period=period,metric="days",target=3,calendar=mode.wireValue,context=CalendarContext(timeZone=zone))) }
                },modifier=Modifier.weight(1f).fillMaxHeight().testTag("habit-period-${period ?: "day"}"),
                    label={Text(label,Modifier.fillMaxWidth(),textAlign=TextAlign.Center)})
            }
        }
        if(goal!=null) {
            Text("Способ подсчёта",style=MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                listOf("days" to "Разные дни","entries" to "Отдельные выполнения","sum" to "Сумма значений").forEach { (metric,label) ->
                    FilterChip(selected=goal.metric==metric,enabled=metric!="sum"||measurement!=null,onClick={
                        val amount=if(metric=="sum") measurement?.target ?: 1000L else 3L
                        target=if(metric=="sum") HabitMeasurements.editValue(amount) else amount.toString()
                        change(goal.copy(metric=metric,target=amount))
                    },modifier=Modifier.testTag("habit-period-metric-$metric"),label={Text(label)})
                }
            }
            OutlinedTextField(value=target,onValueChange={target=it.take(16);change(goal,it)},label={Text("Цель за период")},
                keyboardOptions=KeyboardOptions(keyboardType=if(goal.metric=="sum") KeyboardType.Decimal else KeyboardType.Number),
                isError=invalid,modifier=Modifier.fillMaxWidth().testTag("habit-period-target"))
            if (LocalSacredFeaturesEnabled.current) {
            Text("Календарь цели",style=MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                listOf("profane" to "Григорианский","sacred" to "Сакральный","lunar" to "Лунный").forEach { (calendar,label) ->
                    FilterChip(selected=goal.calendar==calendar,onClick={change(goal.copy(calendar=calendar))},label={Text(label)})
                }
            }
            }
            Text(when(goal.metric) { "days"->"Один день считается один раз после достижения порога дня."
                "entries"->"Каждая отдельная запись считается одним выполнением, даже в один день."
                else->"Все значения разрешённых дней складываются за период." },style=MaterialTheme.typography.bodySmall)
            Text("Разрешённые дни задаются в расписании. Дни отдыха не прерывают серию.",style=MaterialTheme.typography.bodySmall)
            Text(goal.context.timeZone,style=MaterialTheme.typography.bodySmall)
        }
        if(invalid) Text("Укажите положительную цель: целое число дней или выполнений, либо сумму с точностью до трёх знаков.",color=MaterialTheme.colorScheme.error)
        if(existing&&(goal!=null||hadPeriodGoal)) Text("Изменения периодической цели и расписания действуют со следующей границы периода. История сохраняется.",style=MaterialTheme.typography.bodySmall)
    }
}

@Composable
internal fun HabitPeriodGoalProgress(habit: Habit, events: List<HabitMeasurementEvent>, completions: List<HabitCompletion>,date: LocalDate,
    showDetails: Boolean = true, compact: Boolean = false) {
    val state=remember(habit,events,completions,date) { HabitPeriodGoals.progress(habit,date,events,completions) } ?: return
    val language=LocalGenesisLanguage.current
    val context=LocalContext.current
    fun t(text: String)=translateGenesisText(context,text,language)
    val goal=state.goal
    val calendar=remember(goal.context) { GenesisCalendar(ZoneId.of(goal.context.timeZone),goal.context.version,goal.context.gregorianYearStart) }
    fun format(value: Long)=if(goal.metric=="sum") "${HabitMeasurements.format(value,language)} ${if(state.rule.measurement?.kind=="duration") t("мин") else state.rule.measurement?.unit.orEmpty()}"
        else NumberFormat.getIntegerInstance(Locale.forLanguageTag(language)).format(value)
    Column(Modifier.fillMaxWidth().padding(if (compact) 0.dp else 12.dp).testTag("habit-period-progress-${habit.id}"),verticalArrangement=Arrangement.spacedBy(6.dp)) {
        Text("${t(if(goal.period=="week") "За неделю" else "За месяц")}: ${format(state.value)} / ${format(goal.target)}",style=MaterialTheme.typography.titleMedium)
        Text(if(state.completed) "Цель достигнута" else "${t("Осталось")}: ${format(state.remaining)}")
        if(showDetails) {
        Text(when(goal.metric) { "days"->"Разные дни";"entries"->"Отдельные выполнения";else->"Сумма значений" },style=MaterialTheme.typography.bodySmall)
        val displayCalendar = if (LocalSacredFeaturesEnabled.current) CalendarMode.fromWire(goal.calendar) else CalendarMode.PROFANE
        Text("${calendar.formatDate(state.period.start,displayCalendar)} — ${calendar.formatDate(state.period.end.minusDays(1),displayCalendar)} · ${goal.context.timeZone}",style=MaterialTheme.typography.bodySmall)
        Text("Период засчитывается в серии, дневной цели и квестах в последний разрешённый день.",style=MaterialTheme.typography.bodySmall)
        }
        if(state.qualityPending) Text("Для завершения подтвердите качество выполнения.",style=MaterialTheme.typography.bodySmall)
        if(state.conflicts) Text("Одновременные исправления. Выберите правильное значение.",color=MaterialTheme.colorScheme.error)
        if(state.partial||state.unattainable) Text("Неполный период или недостаточно разрешённых дней: цель сохраняется, пропуск не прерывает серию.",style=MaterialTheme.typography.bodySmall)
        if(state.status=="missed") Text("Период завершён без достижения цели.",style=MaterialTheme.typography.bodySmall)
    }
}
