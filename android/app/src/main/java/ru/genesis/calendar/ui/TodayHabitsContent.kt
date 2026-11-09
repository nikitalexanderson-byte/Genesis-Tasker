package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.HabitsRepository
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.Habit
import ru.genesis.calendar.domain.habits.HabitEngine
import ru.genesis.calendar.domain.habits.habitIntervalMarks
import ru.genesis.calendar.domain.habits.HabitMeasurements

/** Uses each habit's saved schedule, independently of the display calendar. */
@Composable
internal fun TodayHabitsContent(app: GenesisApplication, date: LocalDate,
    workspace: LocalHabitWorkspace, onOpenHabits: () -> Unit,
    showTopDivider: Boolean = true) {
    val repository = remember(app) { HabitsRepository(app) }
    val engine = remember { HabitEngine(GenesisCalendar()) }
    val scheduled = remember(workspace.habits, workspace.completions, date) { workspace.habits.filter { engine.isScheduled(it, date, workspace.completions)
        || it.active&&date>=it.createdDate&&HabitMeasurements.rule(it,date).periodGoal!=null } }
    val entries = workspace.completions.filter { it.date == date }.associateBy { it.habitId }
    val completed = scheduled.count { entries[it.id]?.completed == true }
    val scope = rememberCoroutineScope()
    val language = LocalGenesisLanguage.current
    val english = language == "en"
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var ratingHabit by remember(date) { mutableStateOf<Habit?>(null) }
    var timerHabitId by remember { mutableStateOf<String?>(null) }
    var allHabitsExpanded by rememberSaveable(app.workspaceScope, date.toString()) { mutableStateOf(false) }
    fun complete(habit: Habit, checked: Boolean, quality: Double?) {
        if (busy || date != LocalDate.now()) return
        busy = true
        scope.launch {
            try {
                repository.complete(habit.id, checked, quality, date)
                error = null
            } catch (e: CancellationException) { throw e }
            catch (e: IllegalArgumentException) { error = e.message }
            catch (_: Exception) { error = "Не удалось сохранить отметку привычки. Повторите попытку." }
            finally { busy = false }
        }
    }
    fun markInterval(habit: Habit,time: String,checked: Boolean) {
        if(busy || date!=LocalDate.now()) return
        busy=true
        scope.launch {
            try {
                repository.completeInterval(habit.id,time,checked,date)
                error=null
                if(checked) {
                    val marks=habitIntervalMarks(habit,entries[habit.id]).toMutableSet().apply { add(time) }
                    if(habit.scoringMode.startsWith("quality") && entries[habit.id]?.qualityValue==null &&
                        habit.intervalSchedule!!.times().all { it in marks }) ratingHabit=habit
                }
            }
            catch(e: CancellationException) { throw e }
            catch(e: IllegalArgumentException) { error=e.message }
            catch(_: Exception) { error="Не удалось сохранить отметку привычки. Повторите попытку." }
            finally { busy=false }
        }
    }
    Column(Modifier.fillMaxWidth().testTag("today-habits-section"),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (showTopDivider) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp),verticalAlignment=Alignment.CenterVertically) {
            Surface(Modifier.size(44.dp),shape=AffairsLayout.shape,color=if(LocalEveningTheme.current)
                MaterialTheme.colorScheme.secondaryContainer else Color(0xff123b36)) {
                Box(contentAlignment=Alignment.Center) {
                    GenesisVectorIcon(GenesisPageIcon.HABITS,Modifier.size(28.dp),if(LocalEveningTheme.current)
                        MaterialTheme.colorScheme.onSecondaryContainer else Color(0xfff3d68f),animated=true)
                }
            }
            Column(Modifier.weight(1f)) {
                Text("Трекер привычек", style = MaterialTheme.typography.titleLarge)
                Text("$completed из ${scheduled.size} выполнено", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Button(onClick=onOpenHabits,modifier=Modifier.heightIn(min=48.dp).testTag("today-habits-open")) { Text("Открыть") }
        }
        if (scheduled.isNotEmpty()) LinearProgressIndicator(
            progress = { completed.toFloat() / scheduled.size }, modifier = Modifier.fillMaxWidth())
        Text("Привычки дня", style = MaterialTheme.typography.titleMedium)
        HabitTimerShelf(workspace, repository.timerOwner, null, { timerHabitId = null }, !busy,
            excludedHabitIds = scheduled.mapTo(hashSetOf()) { it.id }) {
            repository.applyTimer(it); Unit
        }
        if (scheduled.isEmpty()) Text("На этот день привычек нет.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        scheduled.take(if (allHabitsExpanded) scheduled.size else 5).forEach { habit ->
            val entry = entries[habit.id]
            Surface(Modifier.fillMaxWidth().testTag("today-habit-${habit.id}"),
                shape = AffairsLayout.shape, color = MaterialTheme.colorScheme.surfaceContainerLowest,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text(habitDisplayTitle(habit), Modifier.testTag("today-habit-title-${habit.id}"),
                            style = MaterialTheme.typography.titleMedium)
                        if (entry?.completed == true) Text("Выполнено · ${entry.score} баллов",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                    }
                    Checkbox(checked = entry?.completed == true, enabled = !busy && date == LocalDate.now() && engine.isScheduled(habit,date,workspace.completions) && HabitMeasurements.effective(HabitMeasurements.rule(habit,date))==null,
                        modifier = Modifier.size(48.dp).testTag("today-habit-check-${habit.id}"),
                        onCheckedChange = { checked ->
                            if (checked && habit.scoringMode.startsWith("quality")) ratingHabit = habit
                            else complete(habit, checked, entry?.qualityValue)
                        })
                }
                val inlineTimer = habit.timerEnabled && habit.intervalSchedule?.completionMode == "each" && habit.measurement == null
                val timer: @Composable () -> Unit = {
                    AffairsIconButton(genesisTranslate("Таймер") + " · " + habitDisplayTitle(habit), AffairsAction.TIMER,
                        { timerHabitId = if (timerHabitId == habit.id) null else habit.id },
                        Modifier.testTag("habit-timer-open-${habit.id}"),
                        !busy && date == LocalDate.now() && engine.isScheduled(habit, date, workspace.completions), outlined = false)
                }
                HabitIntervalMarks(habit,entry,!busy&&date==LocalDate.now(), trailing=if(inlineTimer) timer else null) { time,checked -> markInterval(habit,time,checked) }
                if(HabitMeasurements.effective(HabitMeasurements.rule(habit,date))!=null) HabitMeasurementInputs(habit,workspace.measurements,date,entry,
                    !busy&&date==LocalDate.now()&&engine.isScheduled(habit,date,workspace.completions),onRecord={amount,entryId,replaces,note ->
                        repository.recordMeasurement(habit.id,date,amount,entryId,replaces,note);Unit
                    },onQuality={quality -> repository.complete(habit.id,true,quality,date);Unit})
                HabitPeriodGoalProgress(habit,workspace.measurements,workspace.completions,date)
                if (habit.timerEnabled && !inlineTimer) timer()
                if (habit.timerEnabled && timerHabitId == habit.id) Box(Modifier.testTag("habit-timer-inline-${habit.id}")) {
                    HabitTimerShelf(workspace, repository.timerOwner, habit.id, { timerHabitId = null }, !busy, embedded = true) {
                        repository.applyTimer(it); Unit
                    }
                }
                }
            }
        }
        if (scheduled.size > 5) FilledTonalButton(
            onClick = { allHabitsExpanded = !allHabitsExpanded }, shape = AffairsLayout.shape,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("today-habits-more")) {
            Text(if (allHabitsExpanded) "Свернуть" else "Показать ещё", Modifier.weight(1f), maxLines = 1)
            UntranslatedText("${scheduled.size - 5}", style = MaterialTheme.typography.labelLarge)
            Spacer(Modifier.width(8.dp))
            GenesisLucideIcon(if (allHabitsExpanded) "chevron-up" else "chevron-down", Modifier.size(20.dp))
        }
        if(date != LocalDate.now()) Text("Отметки выполнения доступны в день практики.",
            style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
    ratingHabit?.let { habit ->
        var quality by remember(habit.id) { mutableFloatStateOf(
            (entries[habit.id]?.qualityValue ?: if (habit.scoringMode == "quality-ten") 5.0 else 0.0).toFloat()) }
        AlertDialog(onDismissRequest = { ratingHabit = null }, title = { Text(habitDisplayTitle(habit)) },
            text = { Column {
                Text("Качество выполнения · ${quality.toInt()}")
                Slider(value = quality, onValueChange = { quality = it },
                    valueRange = if (habit.scoringMode == "quality-ten") 1f..10f else -5f..5f,
                    steps = if (habit.scoringMode == "quality-ten") 8 else 9)
            } }, confirmButton = { TextButton(onClick = {
                ratingHabit = null; complete(habit, true, quality.toDouble())
            }) { Text("Выполнено") } },
            dismissButton = { TextButton(onClick = { ratingHabit = null }) { Text("Отмена") } })
    }
}
