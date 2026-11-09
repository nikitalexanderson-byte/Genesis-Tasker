package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.*

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun HabitMeasurementFields(value: HabitMeasurement?, existing: Boolean, onChange: (HabitMeasurement?) -> Unit,
    onValidity: (Boolean) -> Unit, periodGoal: HabitPeriodGoal? = null, hadPeriodGoal: Boolean = false) {
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    var target by remember { mutableStateOf(HabitMeasurements.editValue(value?.target ?: 1000)) }
    var step by remember { mutableStateOf(HabitMeasurements.editValue(value?.quickAdd ?: 1000)) }
    var unit by remember { mutableStateOf(value?.unit.orEmpty()) }
    var invalid by remember { mutableStateOf(false) }
    fun change(kind: String?, targetText: String = target, stepText: String = step, unitText: String = unit) {
        if (kind == null) { invalid = false; onValidity(true); onChange(null); return }
        val goal = HabitMeasurements.parse(targetText); val increment = HabitMeasurements.parse(stepText)
        val valid = goal != null && increment != null && unitText.isNotBlank()
        invalid = !valid; onValidity(valid)
        if(valid) onChange(HabitMeasurement(kind,unitText.trim(),goal!!,increment!!))
    }
    var kind by remember { mutableStateOf(value?.kind) }
    Column(Modifier.fillMaxWidth().testTag("habit-measurement-fields"),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text("Учёт выполнения",style=MaterialTheme.typography.titleMedium)
        Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
            FilterChip(selected=kind==null,enabled=periodGoal?.metric!="sum",onClick={kind=null;change(null)},
                modifier=Modifier.fillMaxWidth().testTag("habit-measurement-binary"),
                label={Text("Выполнено / не выполнено",Modifier.fillMaxWidth(),textAlign=TextAlign.Center)})
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                listOf("quantity" to "Количество", "duration" to "Длительность").forEach { (key,label) ->
                    FilterChip(selected=kind==key,onClick={kind=key;if(key=="duration") unit="min";change(key)},
                        modifier=Modifier.weight(1f).fillMaxHeight().testTag("habit-measurement-$key"),
                        label={Text(label,Modifier.fillMaxWidth(),textAlign=TextAlign.Center)})
                }
            }
        }
        if(kind != null) {
            OutlinedTextField(value=if(kind=="duration") translateGenesisText(context,"мин",language) else unit,
                onValueChange={unit=it.take(40);change(kind)},enabled=kind!="duration",label={Text("Единица")},modifier=Modifier.fillMaxWidth())
            if(periodGoal==null||periodGoal.metric=="days") OutlinedTextField(value=target,onValueChange={target=it.take(16);change(kind)},label={Text("Цель за день")},
                keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal),isError=invalid&&HabitMeasurements.parse(target)==null,modifier=Modifier.fillMaxWidth())
            OutlinedTextField(value=step,onValueChange={step=it.take(16);change(kind)},label={Text("Быстрое добавление")},
                keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal),isError=invalid&&HabitMeasurements.parse(step)==null,modifier=Modifier.fillMaxWidth())
        }
        if(invalid) Text("Укажите единицу и положительные значения с точностью до трёх знаков после запятой.",color=MaterialTheme.colorScheme.error)
        if(existing&&periodGoal==null&&!hadPeriodGoal) Text("Изменения цели и расписания действуют со следующего дня. История сохраняется.",style=MaterialTheme.typography.bodySmall)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun HabitMeasurementInputs(habit: Habit, events: List<HabitMeasurementEvent>, date: LocalDate,
    completion: HabitCompletion?, enabled: Boolean,
    onRecord: suspend (Long?,String?,List<String>,String) -> Unit, onQuality: suspend (Double) -> Unit,
    compact: Boolean = false) {
    val state = remember(habit,events,date) { HabitMeasurements.progress(habit,date,events) }
    val definition = HabitMeasurements.effective(state.rule) ?: return
    val countOnly = state.rule.measurement==null
    val periodicVolume = state.rule.periodGoal?.metric?.let { it!="days" }==true
    val language = LocalGenesisLanguage.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val app = context.applicationContext as GenesisApplication
    val preferences = remember(app) { LocalPreferences(app,app.workspaceScope) }
    val prefs by preferences.values.collectAsStateWithLifecycle(UiPreferences())
    val calendar = remember(state.rule.schedule.timezone) { GenesisCalendar(ZoneId.of(state.rule.schedule.timezone)) }
    var value by rememberSaveable(habit.id,date.toString()) { mutableStateOf("") }
    var note by rememberSaveable(habit.id,date.toString()) { mutableStateOf("") }
    var editing by rememberSaveable(habit.id,date.toString()) { mutableStateOf<String?>(null) }
    var expanded by rememberSaveable(habit.id,date.toString()) { mutableStateOf(false) }
    var manualOpen by rememberSaveable(habit.id,date.toString()) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(false) }
    val clock = remember(language,prefs.use24,state.rule.schedule.timezone) { DateTimeFormatter.ofPattern(if(prefs.use24) "HH:mm" else "hh:mm a",Locale.ROOT)
        .withLocale(Locale.forLanguageTag(language)).withZone(ZoneId.of(state.rule.schedule.timezone)) }
    fun formatFor(amount: Long,measurement: HabitMeasurement) = "${HabitMeasurements.format(amount,language)} ${if(measurement.kind=="duration") translateGenesisText(context,"мин",language) else measurement.unit}"
    fun format(amount: Long) = if(countOnly) HabitMeasurements.format(amount,language) else formatFor(amount,definition)
    fun formatEntry(event: HabitMeasurementEvent) = event.value?.let { amount -> if(countOnly) format(amount) else formatFor(amount,
        habit.ruleHistory.firstOrNull { it.id==event.ruleId }?.measurement ?: definition) }
        ?: translateGenesisText(context,"Запись удалена",language)
    fun save(amount: Long?, entry: HabitMeasurementEntry? = null) {
        if(busy || !enabled) return
        busy = true; error = false
        scope.launch {
            try { onRecord(amount,entry?.id,entry?.heads?.map { it.entity.id }.orEmpty(),note)
                value="";note="";editing=null;manualOpen=false
            } catch(e: CancellationException) { throw e }
            catch(_: Exception) { error=true }
            finally { busy=false }
        }
    }
    Column(Modifier.fillMaxWidth().padding(if (compact) 0.dp else 12.dp).testTag("habit-measurement-${habit.id}"),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text(if(periodicVolume) "${translateGenesisText(context,"Записано сегодня",language)}: ${format(state.total)}" else "${format(state.total)} / ${format(state.target)}",style=MaterialTheme.typography.titleMedium)
        if(!periodicVolume) Text(if(state.completed) "Цель достигнута" else "${translateGenesisText(context,"Осталось",language)}: ${format(state.remaining)}",style=MaterialTheme.typography.bodySmall)
        if(enabled) {
            FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                if(editing==null) OutlinedButton(enabled=!busy,onClick={save(definition.quickAdd)},
                    modifier=Modifier.heightIn(min=48.dp).testTag("habit-measurement-quick-${habit.id}")) {
                    Text(if(countOnly) "Добавить выполнение" else "+ ${format(definition.quickAdd)}")
                }
                if(compact && editing==null) TextButton(enabled=!busy,onClick={manualOpen=!manualOpen},
                    modifier=Modifier.heightIn(min=48.dp).testTag("habit-measurement-manual-${habit.id}")) {
                    Text(if(manualOpen) "Свернуть ввод" else if(countOnly) "Заметка" else "Ввести значение")
                }
            }
            if(!compact || manualOpen || editing!=null) {
            if(!countOnly) OutlinedTextField(value=value,onValueChange={value=it.take(16)},label={Text("Значение")},enabled=!busy,
                keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal),modifier=Modifier.fillMaxWidth())
            OutlinedTextField(value=note,onValueChange={note=it.take(2000)},label={Text("Заметка")},enabled=!busy,
                modifier=Modifier.fillMaxWidth().testTag("habit-measurement-note-${habit.id}"))
            FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                Button(enabled=!busy&&(countOnly||HabitMeasurements.parse(value)!=null),onClick={save(if(countOnly) 1000L else HabitMeasurements.parse(value),state.entries.firstOrNull { it.id==editing })},
                    modifier=Modifier.heightIn(min=48.dp).testTag("habit-measurement-save-${habit.id}")) {
                    Text(if(editing!=null) "Сохранить" else if(countOnly) "Добавить выполнение" else "Добавить значение")
                }
                if(editing!=null) TextButton(onClick={editing=null;value="";note="";manualOpen=false}) { Text("Отмена") }
            }
            }
        }
        if(error) Text("Не удалось сохранить запись. Проверьте значение и повторите.",color=MaterialTheme.colorScheme.error)
        if(state.incompatible) Text("Часть записей относится к другой версии цели. Проверьте единицы и исправьте значения.",color=MaterialTheme.colorScheme.error)
        if(state.completed && habit.qualityScale!="none") {
            if(completion?.qualityConfirmedAt!=null) Text("${translateGenesisText(context,"Качество",language)}: ${completion.qualityValue}")
            else {
                var quality by remember { mutableFloatStateOf(if(habit.qualityScale=="ten") 5f else 0f) }
                Text("Качество выполнения")
                Slider(value=quality,onValueChange={quality=it},enabled=enabled&&!busy,
                    valueRange=if(habit.qualityScale=="ten") 1f..10f else -5f..5f,steps=if(habit.qualityScale=="ten") 8 else 9)
                Button(enabled=enabled&&!busy,onClick={busy=true;scope.launch {
                    try { onQuality(quality.toDouble()) } catch(e: CancellationException) { throw e }
                    catch(_: Exception) { error=true } finally { busy=false }
                }}) { Text("Сохранить") }
            }
        }
        if(!compact || state.entries.isNotEmpty()) TextButton(onClick={expanded=!expanded},
            contentPadding=PaddingValues(vertical=8.dp),modifier=Modifier.heightIn(min=48.dp)) {
            Text("${translateGenesisText(context,"Записи",language)} · ${state.entries.size}")
        }
        if(expanded) state.entries.forEach { entry ->
            HorizontalDivider()
            if(entry.conflict) {
                Text("Одновременные исправления. Выберите правильное значение.",color=MaterialTheme.colorScheme.error)
                entry.heads.forEach { head -> OutlinedButton(enabled=enabled&&!busy,onClick={save(head.value,entry)}) {
                    Text(translateGenesisText(context,"Оставить {value}",language).replace("{value}",formatEntry(head)))
                } }
            } else {
                entry.current?.let { Text(formatEntry(it));Text(clock.format(Instant.parse(it.entity.createdAt)),style=MaterialTheme.typography.bodySmall) }
                entry.current?.note?.takeIf { it.isNotBlank() }?.let { Text(it,style=MaterialTheme.typography.bodySmall) }
                if(enabled) FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    TextButton(enabled=!busy,onClick={editing=entry.id;value=HabitMeasurements.editValue(entry.current?.value ?: entry.revisions.firstNotNullOfOrNull { it.value } ?: 1000L);note=entry.current?.note.orEmpty()}) {
                        Text(if(entry.current?.value==null) "Восстановить запись" else "Изменить")
                    }
                    if(entry.current?.value!=null) TextButton(enabled=!busy,onClick={save(null,entry)}) { Text("Удалить запись") }
                }
                if(entry.revisions.size>1) {
                    Text("История исправлений",style=MaterialTheme.typography.labelMedium)
                    entry.revisions.forEach { revision ->
                        val instant = Instant.parse(revision.entity.createdAt)
                        val day = instant.atZone(ZoneId.of(state.rule.schedule.timezone)).toLocalDate()
                        Text("${calendar.formatDate(day,prefs.display)} · ${clock.format(instant)} · ${formatEntry(revision)}",style=MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        if(expanded&&state.entries.isEmpty()) Text("Записей пока нет")
    }
}
