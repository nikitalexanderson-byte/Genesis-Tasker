package ru.genesis.calendar.ui

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Dialog
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.time.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.collect
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.auth.AccountSettings
import ru.genesis.calendar.auth.AuthController

@Composable
internal fun HabitsScreen(app: GenesisApplication, experimental: Boolean, inputCalendarMode: CalendarMode = CalendarMode.SACRED,
    displayCalendarMode: CalendarMode = CalendarMode.SACRED,
    accountSettings: AccountSettings? = null, taskLists: List<GoogleTaskList> = emptyList(),
    menuSwipeState: MenuSwipeState? = null, openSacredHabits: Boolean = false,
    onSacredHabitsOpened: () -> Unit = {}, voiceRequest: NativeVoiceAction? = null,
    onVoiceRequestConsumed: () -> Unit = {}, openHeroPath: Boolean = false,
    onHeroPathOpened: () -> Unit = {}, hiddenSubmenus: Set<String> = emptySet(),
    reminderRequest: ru.genesis.calendar.reminders.HabitReminderOpenRequest? = null, diaryRepository: DiaryRepository? = null) {
    var localSection by rememberSaveable { mutableStateOf("Привычки") }
    val section = (menuSwipeState?.habits ?: localSection).takeIf {
        (if (it == "Привычки") "habits.habits" else "habits.sleep") !in hiddenSubmenus
    } ?: if ("habits.habits" !in hiddenSubmenus) "Привычки" else "Сон и настроение"
    Column(Modifier.fillMaxSize()) {
        val submenuItems = listOf(SubmenuItem("Привычки", "Привычки"), SubmenuItem("Сон и настроение", "Сон и настроение"))
            .filter { (if (it.id == "Привычки") "habits.habits" else "habits.sleep") !in hiddenSubmenus }
        if (!LocalFixedSubmenu.current && submenuItems.size > 1) ConnectedSubmenu(submenuItems,
            section, { localSection = it; menuSwipeState?.habits = it })
        Box(Modifier.weight(1f)) {
            if (section == "Привычки") HabitWorkspaceContent(app, experimental, inputCalendarMode, displayCalendarMode,
                accountSettings,taskLists,
                openSacredHabits,onSacredHabitsOpened,voiceRequest,onVoiceRequestConsumed,
                openHeroPath,onHeroPathOpened,reminderRequest) else TrackersScreen(app, experimental, diaryRepository)
        }
    }
}

@Composable
private fun HabitWorkspaceContent(app: GenesisApplication, experimental: Boolean, inputCalendarMode: CalendarMode,
    displayCalendarMode: CalendarMode, accountSettings: AccountSettings?, taskLists: List<GoogleTaskList>,
    openSacredHabits: Boolean, onSacredHabitsOpened: () -> Unit,
    voiceRequest: NativeVoiceAction?, onVoiceRequestConsumed: () -> Unit,
    openHeroPath: Boolean, onHeroPathOpened: () -> Unit,
    reminderRequest: ru.genesis.calendar.reminders.HabitReminderOpenRequest?) {
    val repository=remember(app) { HabitsRepository(app) }
    val externalSync=remember(app) { HabitExternalSync(app,AuthController.get(app)) }
    val scope=rememberCoroutineScope()
    var workspace by remember { mutableStateOf<LocalHabitWorkspace?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var storageError by remember { mutableStateOf(false) }
    var edit by remember { mutableStateOf<Habit?>(null) }
    var deleteCandidate by remember { mutableStateOf<Habit?>(null) }
    var editorOpen by remember { mutableStateOf(false) }
    var voiceDraftTitle by remember { mutableStateOf("") }
    var area by rememberSaveable { mutableStateOf(if(openHeroPath) "development" else if(openSacredHabits) "sacred" else "today") }
    val areaHistory=rememberScreenBackHistory(area)
    var workspaceArea by rememberSaveable { mutableStateOf("today") }
    var screenMenuOpen by remember { mutableStateOf(false) }
    var dataOpen by rememberSaveable { mutableStateOf(false) }
    val areaStates = rememberSaveableStateHolder()
    val habitCardStates = rememberSaveableStateHolder()
    // Keep one provider/card subtree when a habit moves between the remaining and completed grids.
    val movableHabitCards = remember(app.workspaceScope) {
        mutableMapOf<String, @Composable (Habit, @Composable (Habit) -> Unit) -> Unit>()
    }
    // A completed card moves between grids; keep its interval disclosure outside either grid subtree.
    var expandedIntervalHabitIds by rememberSaveable(app.workspaceScope) { mutableStateOf(arrayListOf<String>()) }
    var timerHabitId by remember { mutableStateOf<String?>(null) }
    var timerHistoryOpen by rememberSaveable { mutableStateOf(false) }
    val timerFocus = remember { BringIntoViewRequester() }
    var habitState by rememberSaveable { mutableStateOf("active") }
    var analysisHistory by remember { mutableStateOf<Pair<String,LocalDate>?>(null) }
    var historyHabitId by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(openHeroPath) {
        if (openHeroPath) { area="development";onHeroPathOpened() }
    }
    var busy by remember { mutableStateOf(false) }
    var today by remember { mutableStateOf(LocalDate.now()) }
    val language = LocalGenesisLanguage.current
    val english = language == "en"
    val engine=HabitEngine(GenesisCalendar())
    suspend fun runAction(action: suspend () -> Unit) {
        if (busy || storageError) return
        busy=true
        try { action(); error=null }
        catch(e: CancellationException) { throw e }
        catch(e: IllegalArgumentException) { error=habitLifecycleFailure(e.message) ?: "Проверьте введённые данные." }
        catch(_: Exception) { error="Не удалось сохранить привычки. Данные формы сохранены на экране." }
        finally { busy=false }
    }
    suspend fun changeAvailability(habit: Habit, action: String, selectedId: String? = null) {
        val command = HabitLifecycleCommand("habit-lifecycle:${java.util.UUID.randomUUID()}", habit.id,
            Instant.now().toString(), action, HabitLifecycle.state(habit).heads.map { it.id }, selectedId)
        val saved = repository.lifecycle(command).second.habits.first { it.id == habit.id }
        if (action == "delete") { deleteCandidate=null; if (edit?.id==habit.id) editorOpen=false }
        try {
            if (!saved.active) externalSync.remove(saved)
            else {
                val linked = externalSync.apply(saved, habit, accountSettings, taskLists, inputCalendarMode)
                if (linked.reminder != saved.reminder) repository.save(linked)
            }
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) {
            throw IllegalArgumentException("Привычка сохранена на устройстве. Синхронизация Google пока не завершена — повторите сохранение.")
        }
    }
    suspend fun recordCompletion(id: String, checked: Boolean, quality: Double?, settings: HabitFeedbackSettings) {
        repository.complete(id, checked, quality)
        if (checked) {
            workspace?.habits?.firstOrNull { it.id==id }?.let { externalSync.advanceTaskAfterCompletion(it,LocalDate.now()) }
        }
    }
    suspend fun recordInterval(habit: Habit, time: String, checked: Boolean, settings: HabitFeedbackSettings) {
        val previous=workspace?.completions?.firstOrNull { it.habitId==habit.id && it.date==LocalDate.now() }
        val marks=habitIntervalMarks(habit,previous).toMutableSet()
        if(checked) marks.add(time) else marks.remove(time)
        repository.completeInterval(habit.id,time,checked)
        if(checked) {
            if(previous?.completed!=true && habit.intervalSchedule!!.times().all { it in marks } &&
                (!habit.scoringMode.startsWith("quality") || previous?.qualityValue!=null))
                externalSync.advanceTaskAfterCompletion(habit,LocalDate.now())
        }
    }
    LaunchedEffect(repository) {
        try { repository.workspace.collect { workspace=it; storageError=false } }
        catch(e: CancellationException) { throw e }
        catch(_: Exception) { storageError=true; error="Защищённые привычки недоступны. Новые записи не заменят сохранённые данные." }
    }
    val lifecycle=LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle,repository) {
        val observer=LifecycleEventObserver { _,event -> if(event==Lifecycle.Event.ON_RESUME) {
            today=LocalDate.now(); scope.launch { runAction { repository.refresh() } }
        } }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(repository) { runAction { repository.refresh() } }
    LaunchedEffect(voiceRequest,workspace) {
        if(workspace!=null && voiceRequest!=null) {
            when(voiceRequest) {
                is NativeVoiceAction.CreateHabit -> { edit=null;voiceDraftTitle=voiceRequest.title;editorOpen=true }
                is NativeVoiceAction.EditHabit -> {
                    workspace?.habits?.firstOrNull { it.id==voiceRequest.id }?.let { edit=it;editorOpen=true }
                }
                is NativeVoiceAction.DeleteHabit -> {
                    workspace?.habits?.firstOrNull { it.id==voiceRequest.id }?.let { deleteCandidate=it }
                }
                is NativeVoiceAction.SetHabitDone -> {
                    workspace?.habits?.firstOrNull { it.id==voiceRequest.id }?.let { habit ->
                        scope.launch { runAction {
                            recordCompletion(habit.id,voiceRequest.done,null,
                                requireNotNull(workspace).settings.feedback)
                        } }
                    }
                }
                else -> Unit
            }
            onVoiceRequestConsumed()
        }
    }
    LaunchedEffect(openSacredHabits) { if (openSacredHabits) area = "sacred" }
    LaunchedEffect(timerHabitId) { if (timerHabitId != null) { withFrameNanos { }; timerFocus.bringIntoView() } }
    LaunchedEffect(reminderRequest?.nonce) { if (reminderRequest != null) { area = "today"; workspaceArea = "today" } }
    LaunchedEffect(area) { if (area == "data") { area = workspaceArea; dataOpen = true } }
    fun openArea(next: String) {
        if (next == "data") { dataOpen = true; screenMenuOpen = false; return }
        if (next == "history") historyHabitId = null
        if (next == "today" || next == "library") workspaceArea = next
        area = next
        screenMenuOpen = false
    }
    BackHandler(enabled = areaHistory.canGoBack && !editorOpen && !dataOpen) { areaHistory.pop()?.let { area=it } }
    val title = when (area) {
        "history" -> "История привычек"
        "development" -> "Путь Героя"
        "catalogue" -> "Подборка привычек"
        "sacred" -> "Сакральные практики"
        else -> "Привычки"
    }
    val subtitle = when (area) {
        "catalogue", "history" -> null
        "today", "library" -> GenesisCalendar().formatDate(today, displayCalendarMode)
        else -> "Привычки"
    }
    val headerNavigation: @Composable () -> Unit = {
        if (area !in setOf("today", "library")) WorkspaceHeaderButton("К привычкам", "habit-workspace-back",
            onClick = { area = workspaceArea }) { GenesisLucideIcon("chevron-left") }
    }
    val headerActions: @Composable () -> Unit = {
        if (area in setOf("today", "library")) WorkspaceHeaderButton("Новая привычка", "habit-create", !busy && !storageError && workspace != null,
            onClick = { edit = null; editorOpen = true }) { GenesisLucideIcon("plus") }
        Box {
            WorkspaceHeaderButton("Разделы и действия привычек", "habit-workspace-menu",
                onClick = { screenMenuOpen = true }) { GenesisLucideIcon("ellipsis") }
            DropdownMenu(screenMenuOpen, { screenMenuOpen = false }) {
                listOf(
                    Triple("library", "Все привычки", "list-checks"),
                    Triple("abstinence", "Воздержание", "shield-check"),
                    Triple("history", "История и статистика", "chart-no-axes-column"),
                    Triple("catalogue", "Подборка привычек", "layout-template"),
                    Triple("development", "Путь Героя и награды", "sparkles"),
                ).forEach { (id, label, icon) ->
                    DropdownMenuItem(text = { Text(label) }, leadingIcon = { GenesisLucideIcon(icon) },
                        onClick = { openArea(id) },
                        modifier = Modifier.testTag("habit-open-$id"))
                }
                if (LocalSacredFeaturesEnabled.current) DropdownMenuItem(text = { Text("Сакральные практики") },
                    leadingIcon = { GenesisLucideIcon("sun") }, onClick = { openArea("sacred") },
                    modifier = Modifier.testTag("habit-open-sacred"))
                HorizontalDivider()
                DropdownMenuItem(text = { Text("Данные привычек") }, leadingIcon = { GenesisLucideIcon("download") },
                    onClick = { openArea("data") }, modifier = Modifier.testTag("habit-open-data"))
            }
        }
    }
    if (area == "abstinence") {
        AbstinenceScreen(app) { area = workspaceArea }
        return
    }
    val headerInShell = WorkspaceScreenHeader(title, subtitle, navigation = headerNavigation, actions = headerActions,
        showThemeToggle = false)
    areaStates.SaveableStateProvider(area) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp).testTag("habit-workspace-$area"),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (!headerInShell) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            headerNavigation()
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleLarge)
                subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            headerActions()
        }
        error?.let { NativeAccessMessage(it, "habits") }
        val current = workspace
        if (current == null) {
            if (!storageError) WorkspaceLoadingIndicator()
        } else {
            if (area in setOf("today", "library")) {
                HabitWorkspaceTabs(area, ::openArea)
                HabitDaySummary(current, today) { openArea("history") }
                HabitReminderFocus(app, current, repository, reminderRequest)
                current.habits.filter { HabitRuleHistory.state(it, LocalDate.MAX).conflicts.isNotEmpty() }.forEach { habit ->
                    OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        UntranslatedText(habitDisplayTitle(habit), style = MaterialTheme.typography.titleSmall)
                        Text("Правила изменены на нескольких устройствах. Выберите действующий вариант.", color = MaterialTheme.colorScheme.error)
                        TextButton(onClick = { edit = habit; editorOpen = true }) { Text("Открыть историю правил") }
                    } }
                }
                val timerSessions = HabitTimers.sessions(current.timers).filter { session ->
                    current.habits.firstOrNull { it.id == session.root.habitId }?.timerEnabled != false
                }
                val inlineTimerIds = current.habits.filter { habit ->
                    val status = habitPracticeLibraryStatus(habit, current.completions)
                    if (area == "library") status == habitState && status !in setOf("archived", "deleted")
                    else status == "active" || status == "completed" && current.completions.any {
                        it.habitId == habit.id && it.date == today && it.completed }
                }.mapTo(hashSetOf()) { it.id }
                val pendingTimers = timerSessions.any { it.state?.status !in setOf("saved", "discarded") }
                if (!pendingTimers && timerHabitId == null && timerSessions.any { it.state?.status == "saved" })
                    OutlinedButton(onClick = { timerHistoryOpen = !timerHistoryOpen }, modifier = Modifier.fillMaxWidth()) {
                        Text(if (timerHistoryOpen) "Скрыть сессии таймера" else "Сессии таймера")
                    }
                if (pendingTimers || timerHistoryOpen) Box(Modifier.bringIntoViewRequester(timerFocus)) {
                HabitTimerShelf(current, repository.timerOwner, null, { timerHistoryOpen = false }, !busy && !storageError,
                    excludedHabitIds = if (timerHistoryOpen) emptySet() else inlineTimerIds) {
                    repository.applyTimer(it); Unit
                }
                }
                val habitCardContent: @Composable (Habit) -> Unit = { habit ->
                    val state = HabitLifecycle.state(habit)
                    val entry = current.completions.firstOrNull { it.habitId == habit.id && it.date == today }
                    val scheduled = runCatching { engine.isScheduled(habit, today, current.completions) }.getOrDefault(false)
                    habitCardStates.SaveableStateProvider("$area:${habit.id}") {
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        HabitLifecycleResolution(habit, !busy && !storageError) { selected ->
                            scope.launch { runAction { changeAvailability(habit, "resolve", selected) } }
                        }
                        ExperimentalHabitCard(habit, entry, scheduled, busy || storageError || state.conflict,
                            animate = current.settings.feedback.animations, today = today,
                            measurements = current.measurements, completions = current.completions,
                            onComplete = { checked, quality -> scope.launch { runAction {
                                recordCompletion(habit.id, checked, quality, current.settings.feedback)
                            } } },
                            onIntervalComplete = { time, checked -> scope.launch { runAction {
                                recordInterval(habit, time, checked, current.settings.feedback)
                            } } },
                            intervalExpanded = habit.id in expandedIntervalHabitIds,
                            onIntervalExpandedChange = { expanded ->
                                expandedIntervalHabitIds = ArrayList(if (expanded) (expandedIntervalHabitIds + habit.id).distinct()
                                    else expandedIntervalHabitIds - habit.id)
                            },
                            onRecord = { amount, entryId, replaces, note ->
                                repository.recordMeasurement(habit.id, today, amount, entryId, replaces, note); Unit
                            },
                            onQuality = { quality -> recordCompletion(habit.id, true, quality, current.settings.feedback) },
                            onHistory = { openArea("history"); historyHabitId = habit.id },
                            onEdit = { edit = habit; editorOpen = true },
                            onToggle = { scope.launch { runAction { changeAvailability(habit, if (habit.active) "pause" else "resume") } } },
                            onArchive = { scope.launch { runAction { changeAvailability(habit, "archive") } } },
                            onTimer = { timerHabitId = if (timerHabitId == habit.id) null else habit.id }, onDelete = { deleteCandidate = habit },
                            timerContent = if (habit.timerEnabled && timerHabitId == habit.id) { {
                                Box(Modifier.bringIntoViewRequester(timerFocus).testTag("habit-timer-inline-${habit.id}")) {
                                    HabitTimerShelf(current, repository.timerOwner, habit.id, { timerHabitId = null },
                                        !busy && !storageError, embedded = true) { repository.applyTimer(it); Unit }
                                }
                            } } else null)
                    }
                    }
                }
                val renderHabit: @Composable (Habit) -> Unit = { habit ->
                    val card = remember(movableHabitCards, area, habit.id) {
                        movableHabitCards.getOrPut("$area:${habit.id}") {
                            movableContentOf { item: Habit, render: @Composable (Habit) -> Unit -> render(item) }
                        }
                    }
                    // Pass the current renderer so workspace data and action callbacks never stay captured in the cache.
                    card(habit, habitCardContent)
                }
                if (area == "library") {
                    HabitLifecycleFilters(current, habitState) { habitState = it }
                    val listed = current.habits.filter { habitPracticeLibraryStatus(it, current.completions) == habitState }
                        .sortedWith(compareByDescending<Habit> { it.isKeyHabit }.thenByDescending { it.priority })
                    if (listed.isEmpty()) Text(if (current.habits.isEmpty()) "Создайте первую привычку или выберите идею из подборки."
                        else "В этом разделе пока нет привычек.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (habitState in setOf("archived", "deleted")) HabitRetiredRows(current, listed, !busy && !storageError,
                        onRestore = { habit -> scope.launch { runAction { changeAvailability(habit, "restore") } } },
                        onDelete = { deleteCandidate = it },
                        onResolve = { habit, selected -> scope.launch { runAction { changeAvailability(habit, "resolve", selected) } } })
                    else AdaptiveCardGrid(listed, { it.id }, renderHabit)
                } else {
                    val active = current.habits.filter { habit ->
                        val libraryStatus = habitPracticeLibraryStatus(habit, current.completions)
                        libraryStatus == "active" || libraryStatus == "completed" && current.completions.any {
                            it.habitId == habit.id && it.date == today && it.completed
                        }
                    }
                        .sortedWith(compareByDescending<Habit> { it.isKeyHabit }.thenByDescending { it.priority })
                    val scheduled = active.filter { runCatching { engine.isScheduled(it, today, current.completions) }.getOrDefault(false) }
                    val completed = scheduled.filter { habit -> current.completions.any { it.habitId == habit.id && it.date == today && it.completed } }
                    val remaining = scheduled.filterNot { it in completed }
                    val unscheduled = active.filterNot { it in scheduled }
                    if (remaining.isNotEmpty()) {
                        HabitSectionHeading("Запланировано сегодня", remaining.size)
                        AdaptiveCardGrid(remaining, { it.id }, renderHabit)
                    } else Text(if (scheduled.isNotEmpty()) "Все запланированные привычки выполнены."
                        else "На сегодня нет запланированных привычек.", Modifier.testTag("habit-today-empty"),
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (completed.isNotEmpty()) {
                        HabitSectionHeading("Выполнено", completed.size)
                        AdaptiveCardGrid(completed, { it.id }, renderHabit)
                    }
                    if (unscheduled.isNotEmpty()) {
                        var showUnscheduled by rememberSaveable { mutableStateOf(false) }
                        OutlinedButton(onClick = { showUnscheduled = !showUnscheduled }, shape = AffairsLayout.controlShape,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("habit-unscheduled-toggle")) {
                            Text("Не запланировано сегодня · ${unscheduled.size}", Modifier.weight(1f))
                            GenesisLucideIcon(if (showUnscheduled) "chevron-up" else "chevron-down")
                        }
                        if (showUnscheduled) AdaptiveCardGrid(unscheduled, { it.id }, renderHabit)
                    }
                    if (current.habits.isEmpty()) {
                        Button(onClick = { edit = null; editorOpen = true }, enabled = !busy && !storageError,
                            modifier = Modifier.fillMaxWidth()) { Text("Новая привычка") }
                        OutlinedButton(onClick = { openArea("catalogue") }, modifier = Modifier.fillMaxWidth()
                            .testTag("habit-catalogue")) { Text("Выбрать из подборки") }
                    }
                }
            }
            if (area == "catalogue") {
                Text("Готовые идеи можно настроить под свой ритм.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                HabitTemplateCatalog.templates.filterNot { it.id in current.hiddenDefaultTemplates }.forEach { template ->
                    Card(Modifier.fillMaxWidth().testTag("habit-template-${template.id}"), shape = AffairsLayout.shape,
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.secondary.copy(alpha = .5f))) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("${template.icon} ${template.title}", style = MaterialTheme.typography.titleMedium)
                            Text(template.description, style = MaterialTheme.typography.bodyMedium)
                            OutlinedButton(enabled = !busy && !storageError, onClick = {
                                val schedule = engine.defaultSchedule(today, CalendarMode.SACRED)
                                edit = Habit(TrackerEntity.create("habit"), template.title, today,
                                    schedule.copy(recurrence = schedule.recurrence.copy(days = listOf(1, 2, 3, 4, 5))),
                                    description = template.description, emoji = template.icon, color = template.color,
                                    sourceTemplateId = template.id, preferredTime = template.suggestedTime,
                                    ritualId = when (template.suggestedTime.take(2).toIntOrNull() ?: -1) {
                                        in 0..11 -> "morning"; in 18..23 -> "evening"; else -> "day"
                                    }, reminder = HabitReminder(time = template.suggestedTime))
                                editorOpen = true
                            }, modifier = Modifier.fillMaxWidth()) { Text("Добавить из библиотеки") }
                        }
                    }
                }
            }
            if (area == "history") {
                if (current.habits.isEmpty()) Text("История появится после создания первой привычки.")
                else {
                    HabitCompletionCalendar(current, today, displayCalendarMode,
                        onOpenHistory = { id, date -> analysisHistory = id to date },
                        onDecision = { command -> repository.decideDay(command) })
                    Card(Modifier.fillMaxWidth(), shape = AffairsLayout.shape,
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                        Box(Modifier.padding(16.dp)) {
                            HabitHistoryPanel(current, repository, displayCalendarMode, analysisHistory,
                                selectedHabitId = historyHabitId) { analysisHistory = null }
                        }
                    }
                }
            }
            if (area == "development") {
            if (current.settings.feedback.gamificationWidgets) {
                val motionEnabled = current.settings.feedback.animations
                val iconGlow = rememberIconPhase("hero-path-card-glow", 3_800, motionEnabled)
                CompositionLocalProvider(LocalPreserveCalendarColors provides true,
                    LocalContentColor provides Color(0xfffff6e2)) {
                Surface(Modifier.fillMaxWidth().testTag("habit-hero-path-section"),
                    shape = AffairsLayout.shape, color = Color(0xff0b1c36),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Color(0x99dfc17e)),
                    shadowElevation = 8.dp) {
                    Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                        Row(Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("habit-hero-path-heading"),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Surface(Modifier.size(68.dp).graphicsLayer {
                                val pulse = if (motionEnabled) kotlin.math.sin(iconGlow * 2f * Math.PI).toFloat() else 0f
                                scaleX = 1.09f + pulse * .025f
                                scaleY = 1.09f + pulse * .025f
                            }, shape = AffairsLayout.shape,
                                color = Color(0xff16304c),
                                border = androidx.compose.foundation.BorderStroke(1.dp,
                                    Color(0xffdfc17e).copy(alpha = .45f + iconGlow * .3f))) {
                                OriginalImage("hero-path/256/07_golden_horn_pathfinder.webp", null,
                                    Modifier.fillMaxSize().genesisDescription("Путь героя"))
                            }
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text("Путь Героя и награды",style=MaterialTheme.typography.titleMedium,
                                    color = Color(0xfffff6e2))
                                Text("Древо рангов, награды и полная статистика привычек. Накопленный XP не тратится.",
                                    style=MaterialTheme.typography.bodySmall,color=Color(0xffc8d9d4))
                            }
                        }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf(
                                Triple("XP",current.progress.lifetimeXp.toString(),"✦"),
                                Triple("Серия","${current.progress.currentStreak} дн.","🔥"),
                                Triple("Лавры",current.progress.laurelsBalance.toString(),"🌿"),
                            ).forEach { (label, value, icon) ->
                                Surface(Modifier.weight(1f), shape = AffairsLayout.shape,
                                    color = Color(0xff142e4b)) {
                                    Column(Modifier.padding(9.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                        Text(icon,style=MaterialTheme.typography.titleMedium)
                                        Text(value, color = Color(0xffffe4a6),
                                            style = MaterialTheme.typography.titleSmall)
                                        Text(label, color = Color(0xffb8ccc5),
                                            style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                            }
                        }
                    }
                }
                }
                HabitArtGallery(current, today, busy,
                    onClaimAmphora = { rankId -> scope.launch { runAction { repository.claimHeroPathAmphora(rankId) } } },
                    onRevealHiddenPath = { scope.launch { runAction { repository.revealHiddenHeroicPath() } } },
                    onBuySpark = { scope.launch { runAction { repository.buyHestiaSpark() } } },
                    showQuests = false)
            }

                if (current.settings.feedback.questsEnabled) HabitQuestPanel(current, today)
                if (!current.settings.feedback.gamificationWidgets) Text("Виджеты развития скрыты в настройках привычек. Накопленные награды и прогресс сохранены.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (area == "sacred") {
            if (LocalSacredFeaturesEnabled.current) SacredHabitsBlock(current,today,displayCalendarMode,busy || storageError,openSacredHabits,
                experimental = experimental,
                onRequestedOpenConsumed=onSacredHabitsOpened,
                onStart={ practice -> scope.launch { runAction { repository.save(practice.toHabit(inputCalendarMode,english)) } } },
                onEdit={ habit -> edit=habit;editorOpen=true },
                onComplete={ habit,checked -> scope.launch { runAction {
                    recordCompletion(habit.id,checked,null,current.settings.feedback)
                } } },
                onToggle={ habit -> scope.launch { runAction { repository.save(habit.copy(active=!habit.active)) } } },
                onDelete = { deleteCandidate = it },
                onRestore = { habit -> scope.launch { runAction { repository.save(habit) } } })

            }
        }
    }
    }
    if (dataOpen && workspace != null) AlertDialog(onDismissRequest = { dataOpen = false },
        modifier = Modifier.testTag("habit-data-dialog"), title = { Text("Данные привычек") },
        text = { Column(Modifier.fillMaxWidth().heightIn(max = 480.dp).verticalScroll(rememberScrollState())) {
            HabitBackupPanel(app, requireNotNull(workspace), inDialog = true)
        } }, confirmButton = {})
    if(editorOpen) HabitEditor(edit,busy,error,inputCalendarMode,accountSettings,voiceDraftTitle,
        onChooseRule={chosen,heads,operation -> scope.launch { runAction {
            try { repository.resolveRule(requireNotNull(edit).id,chosen,heads,operation);editorOpen=false }
            catch(e: CancellationException) { throw e }
            catch(_: Exception) { throw IllegalStateException("Не удалось сохранить выбор. Обновите данные и повторите.") }
        } }},
        onDismiss={if(!busy) { editorOpen=false;voiceDraftTitle="" }},onSave={ habit ->
        scope.launch { runAction {
            val previous=edit
            val saved=repository.save(habit).second.habits.first { it.id==habit.id }
            edit=saved
            try {
                val synced=externalSync.apply(saved,previous,accountSettings,taskLists,inputCalendarMode)
                if(synced.reminder!=saved.reminder) {
                    edit=repository.save(synced).second.habits.first { it.id==habit.id }
                }
            } catch(e: CancellationException) { throw e }
            catch(_: Exception) {
                throw IllegalArgumentException("Привычка сохранена на устройстве. Синхронизация Google пока не завершена — повторите сохранение.")
            }
            editorOpen=false; voiceDraftTitle=""
        } }
    })
    deleteCandidate?.let { habit ->
        val completionCount = workspace?.let { habitCompletionCount(HabitHistory.economy(it).completions, habit.id) } ?: 0
        val retainsLaurels = completionCount >= HABIT_LAUREL_RETENTION_COMPLETIONS
        val confirmationHeight=(LocalConfiguration.current.screenHeightDp*0.4f).coerceAtLeast(64f).dp
        AlertDialog(onDismissRequest={if(!busy) deleteCandidate=null},
            title={Text("Удалить привычку")},
            text={Column(Modifier.heightIn(max=confirmationHeight).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                if(HabitPracticeGoals.progress(habit,workspace?.completions.orEmpty(),LocalDate.now()) != null) UntranslatedText(habitPracticeCopy().getString("deleteNotice"))
                else Text(if(retainsLaurels) "Рубеж 50 дней достигнут: Лавры сохранятся. История останется доступной для восстановления."
                    else "Удаление до 50 уникальных дней выполнения обнуляет весь баланс Лавров. История останется доступной для восстановления.")
                UntranslatedText(habitDisplayTitle(habit))
            }},
            confirmButton={TextButton(enabled=!busy,onClick={scope.launch {
                runAction {
                    changeAvailability(habit,"delete")
                }
            }},modifier=Modifier.heightIn(min=48.dp).testTag("confirm-delete-habit"),
                colors=ButtonDefaults.textButtonColors(contentColor=MaterialTheme.colorScheme.error)) { Text("Удалить") }},
            dismissButton={TextButton(enabled=!busy,onClick={deleteCandidate=null},modifier=Modifier.heightIn(min=48.dp).testTag("cancel-delete-habit")) { Text("Отмена") }})
    }
}

internal fun habitCompletionDescription(context: Context, language: String, title: String, completed: Boolean): String =
    translateGenesisText(context, if (completed) "{title}: снять отметку" else "{title}: отметить выполнение", language)
        .replace("{title}", title)

internal fun habitTimerDescription(context: Context, language: String, title: String): String =
    translateGenesisText(context, "Таймер привычки {title}", language).replace("{title}", title)

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ExperimentalHabitCard(habit: Habit, entry: HabitCompletion?, scheduled: Boolean, disabled: Boolean,
    animate: Boolean, today: LocalDate, measurements: List<HabitMeasurementEvent>, completions: List<HabitCompletion>,
    onComplete: (Boolean, Double?) -> Unit, onEdit: () -> Unit, onIntervalComplete: (String, Boolean) -> Unit,
    intervalExpanded: Boolean, onIntervalExpandedChange: (Boolean) -> Unit,
    onRecord: suspend (Long?, String?, List<String>, String) -> Unit, onQuality: suspend (Double) -> Unit,
    onHistory: () -> Unit, onToggle: () -> Unit, onArchive: () -> Unit, onTimer: () -> Unit, onDelete: () -> Unit, timerContent: (@Composable () -> Unit)? = null) {
    val rule = HabitMeasurements.rule(habit, today)
    val displayTitle = habitDisplayTitle(habit)
    val measured = HabitMeasurements.effective(rule) != null
    val completed = entry?.completed == true
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    val completionDescription = habitCompletionDescription(context, language, displayTitle, completed)
    val timerDescription = habitTimerDescription(context, language, displayTitle)
    val status = when {
        !habit.active -> "На паузе"
        completed -> "Выполнено сегодня"
        scheduled -> "Запланировано сегодня"
        else -> "Сегодня не запланировано"
    }
    val calendar = when (rule.schedule.recurrence.mode) {
        "classic" -> "Григорианский ритм"
        "lunar" -> "Лунный ритм"
        else -> "Сакральный ритм"
    }
    val cardModifier = if (animate) Modifier.fillMaxWidth().animateContentSize() else Modifier.fillMaxWidth()
    var detailsOpen by rememberSaveable(habit.id) { mutableStateOf(false) }
    Card(cardModifier.testTag("habit-card-${habit.id}"), shape = AffairsLayout.shape,
        border = androidx.compose.foundation.BorderStroke(1.dp,
            if (completed) MaterialTheme.colorScheme.primary.copy(alpha = .4f) else MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Surface(Modifier.padding(top = 4.dp).size(32.dp), shape = AffairsLayout.shape,
                    color = MaterialTheme.colorScheme.primaryContainer) {
                    Box(contentAlignment = Alignment.Center) { Text(habit.emoji, style = MaterialTheme.typography.titleMedium) }
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    UntranslatedText(displayTitle, style = MaterialTheme.typography.titleMedium)
                    Text(status, style = MaterialTheme.typography.bodySmall,
                        color = if (completed) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                    if (habit.preferredTime.isNotBlank() || habit.isKeyHabit) Text(
                        listOfNotNull(if (habit.isKeyHabit) "Главная привычка" else null, habit.preferredTime.takeIf { it.isNotBlank() }).joinToString(" · "),
                        style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                HabitCardActions(habit, !disabled, false, onEdit, onToggle, onArchive, onTimer, onDelete)
            }
            HabitPracticeStatus(habit, completions)
            if (measured) HabitMeasurementInputs(habit, measurements, today, entry, scheduled && !disabled,
                onRecord = onRecord, onQuality = onQuality, compact = true)
            else if (habit.scoringMode.startsWith("quality") && scheduled) {
                var quality by rememberSaveable(habit.id, entry?.qualityValue) {
                    mutableFloatStateOf((entry?.qualityValue ?: if (habit.scoringMode == "quality-ten") 5.0 else 0.0).toFloat())
                }
                Text("Качество выполнения · ${quality.toInt()}", style = MaterialTheme.typography.bodyMedium)
                Slider(value = quality, onValueChange = { quality = it }, enabled = !disabled,
                    valueRange = if (habit.scoringMode == "quality-ten") 1f..10f else -5f..5f,
                    steps = if (habit.scoringMode == "quality-ten") 8 else 9,
                    modifier = Modifier.testTag("habit-quality-${habit.id}"))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(enabled = !disabled, onClick = { onComplete(true, quality.toDouble()) }) {
                        Text(if (completed) "Обновить оценку" else "Выполнено")
                    }
                    if (completed) TextButton(enabled = !disabled,
                        onClick = { onComplete(false, entry?.qualityValue) }) { Text("Снять отметку") }
                }
            } else if (scheduled || completed) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (completed) if (habit.scoringMode == "none") "Выполнено" else "Выполнено · ${entry?.score ?: 0} баллов"
                    else if (habit.intervalSchedule?.completionMode == "each") "Отметить все повторения" else "Отметить выполнение",
                    Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                Checkbox(checked = completed, enabled = scheduled && !disabled,
                    onCheckedChange = { onComplete(it, null) },
                    modifier = Modifier.size(48.dp).testTag("habit-complete-${habit.id}")
                        .semantics { contentDescription = completionDescription })
            }
            HabitIntervalMarks(habit, entry, scheduled && !disabled, expanded = intervalExpanded,
                onExpandedChange = onIntervalExpandedChange, onMark = onIntervalComplete)
            HabitPeriodGoalProgress(habit, measurements, completions, today, showDetails = detailsOpen, compact = true)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { detailsOpen = !detailsOpen }, contentPadding = PaddingValues(vertical = 8.dp),
                    modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("habit-details-${habit.id}")) {
                    Text(if (detailsOpen) "Свернуть" else "Подробнее", Modifier.weight(1f))
                    AffairsActionIcon(if (detailsOpen) AffairsAction.COLLAPSE else AffairsAction.EXPAND)
                }
                if (scheduled && habit.timerEnabled) AffairsIconButton(timerDescription, AffairsAction.TIMER,
                    onTimer, Modifier.testTag("habit-timer-open-${habit.id}"), !disabled, outlined = false, translate = false)
            }
            timerContent?.invoke()
            if (detailsOpen) {
                HorizontalDivider()
                if (habit.description.isNotEmpty()) UntranslatedText(habitDisplayDescription(habit), style = MaterialTheme.typography.bodyMedium)
                Text(calendar + " · " + genesisTranslate("Приоритет") + ": ${habit.priority}/10",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (habit.ritualId != "none") Text(if (habit.ritualId == "custom") habit.ritualName
                    else habitRituals.firstOrNull { it.first == habit.ritualId }?.second.orEmpty(),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = onHistory, modifier = Modifier.heightIn(min = 48.dp)
                    .testTag("habit-history-open-${habit.id}")) {
                    GenesisLucideIcon("history"); Spacer(Modifier.width(8.dp)); Text("История и статистика")
                }
            }
        }
    }
}

private fun sacredHabitCadence(config: ru.genesis.calendar.domain.RecurrenceConfig): String = when {
    config.pattern == "month-days" && config.months.size == 1 -> "yearly"
    config.pattern == "month-days" -> "monthly"
    config.pyatas == listOf(1, 3, 5) || config.pyatas == listOf(2, 4, 6) -> "parity"
    config.days.sorted() == listOf(1, 2, 3, 4, 5) && config.pyatas.isEmpty() && config.months.isEmpty() -> "daily"
    else -> "pyata-days"
}

@Composable
internal fun HabitEditor(existing: Habit?, busy: Boolean, error: String?, inputCalendarMode: CalendarMode,
    accountSettings: AccountSettings?,
    initialTitle: String = "",
    onDismiss: () -> Unit, onSave: (Habit) -> Unit,
    onChooseRule: (String,List<String>,String)->Unit) {
    val engineCalendar=remember { GenesisCalendar() }
    val engine=remember(engineCalendar) { HabitEngine(engineCalendar) }
    val initial=remember(existing,initialTitle) { existing ?: Habit(TrackerEntity.create("habit"),initialTitle,LocalDate.now(),engine.defaultSchedule(LocalDate.now(),inputCalendarMode),timerEnabled=false) }
    val displayTitle = habitDisplayTitle(initial)
    val editorInitialTitle = rememberSaveable(initial.id) { displayTitle }
    var title by rememberSaveable(initial.id) { mutableStateOf(editorInitialTitle) }
    var description by rememberSaveable(initial.id) { mutableStateOf(initial.description) }
    var emoji by rememberSaveable(initial.id) { mutableStateOf(initial.emoji) }
    var color by rememberSaveable(initial.id) { mutableStateOf(initial.color) }
    var isKeyHabit by rememberSaveable(initial.id) { mutableStateOf(initial.isKeyHabit) }
    var ritualId by rememberSaveable(initial.id) { mutableStateOf(initial.ritualId) }
    var ritualName by rememberSaveable(initial.id) { mutableStateOf(initial.ritualName) }
    var preferredTime by rememberSaveable(initial.id) { mutableStateOf(initial.preferredTime) }
    var timerEnabled by rememberSaveable(initial.id) { mutableStateOf(initial.timerEnabled) }
    var timerPreferences by remember(initial.id) { mutableStateOf(initial.timerPreferences ?: HabitTimerPreferences()) }
    var timerPreferencesValid by remember(initial.id) { mutableStateOf(true) }
    var autoDeletePolicy by remember(initial.id) { mutableStateOf(initial.autoDeletePolicy) }
    var autoDeleteValid by remember(initial.id) { mutableStateOf(true) }
    var reminder by remember(initial.id) { mutableStateOf(initial.reminder) }
    var intervalSchedule by remember(initial.id) { mutableStateOf(initial.intervalSchedule) }
    var measurement by remember(initial.id) { mutableStateOf(initial.measurement) }
    var measurementValid by remember(initial.id) { mutableStateOf(true) }
    var periodGoal by remember(initial.id) { mutableStateOf(initial.periodGoal) }
    var periodValid by remember(initial.id) { mutableStateOf(true) }
    var priority by rememberSaveable(initial.id) { mutableIntStateOf(initial.priority) }
    var scoring by rememberSaveable(initial.id) { mutableStateOf(initial.scoringMode) }
    var start by rememberSaveable(initial.id) { mutableStateOf(initial.schedule.startDate.toString()) }
    var end by rememberSaveable(initial.id) { mutableStateOf(initial.schedule.endDate?.toString() ?: "") }
    var formCalendarMode by rememberSaveable(initial.id) { mutableStateOf(
        if (existing == null) inputCalendarMode else when(initial.schedule.recurrence.mode) {
            "classic" -> CalendarMode.PROFANE
            "lunar" -> CalendarMode.LUNAR
            else -> CalendarMode.SACRED
        }) }
    var config by remember(initial.id) { mutableStateOf(initial.schedule.recurrence) }
    var sacredCadence by remember(initial.id) { mutableStateOf(sacredHabitCadence(initial.schedule.recurrence)) }
    val mode=formCalendarMode
    val lunarDaily = config.pattern == "lunar-days" && config.days == (1..30).toList() && config.months.isEmpty()
    val limit=when {
        mode==CalendarMode.SACRED -> when(sacredCadence) {"pyata-days"->5;"monthly","yearly"->30;else->0}
        mode==CalendarMode.LUNAR -> when(config.pattern) {"lunar-decades"->3;"lunar-decade-days"->10;"lunar-phases"->0
            else -> if(lunarDaily) 0 else 30}
        config.pattern=="weekdays" -> 7
        else -> 0
    }
    var discardConfirmation by rememberSaveable(initial.id) { mutableStateOf(false) }
    val hasChanges = title != editorInitialTitle || description != initial.description || emoji != initial.emoji || color != initial.color ||
        isKeyHabit != initial.isKeyHabit || ritualId != initial.ritualId || ritualName != initial.ritualName ||
        preferredTime != initial.preferredTime || timerEnabled != initial.timerEnabled || timerPreferences != (initial.timerPreferences ?: HabitTimerPreferences()) || autoDeletePolicy != initial.autoDeletePolicy || reminder != initial.reminder || intervalSchedule != initial.intervalSchedule ||
        measurement != initial.measurement || periodGoal != initial.periodGoal || priority != initial.priority || scoring != initial.scoringMode ||
        start != initial.schedule.startDate.toString() || end != initial.schedule.endDate?.toString().orEmpty() || config != initial.schedule.recurrence
    fun requestDismiss() { if (!busy) { if (hasChanges) discardConfirmation = true else onDismiss() } }
    Dialog(onDismissRequest=::requestDismiss, properties=androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth=false)) { Surface(Modifier.widthIn(max=720.dp).fillMaxWidth(),shape=MaterialTheme.shapes.large) {
        Column(Modifier.padding(horizontal=10.dp,vertical=16.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            GenesisDialogHeader(closeTag = "habit-editor-close", onClose = ::requestDismiss, enabled = !busy) {
                Text(if(existing==null) "Новая привычка" else "Изменить привычку",
                    style=MaterialTheme.typography.titleLarge)
            }
            EditorSection("Основное") {
            if(initial.practiceGoal != null) {
                UntranslatedText(habitPracticeCopy().getString("warning"),style=MaterialTheme.typography.bodySmall)
                UntranslatedText(habitPracticeCopy().getString("deadline") + ": $end · ${initial.schedule.timezone}")
            }
            OutlinedTextField(title,{title=it},label={Text("Название")},modifier=Modifier.fillMaxWidth(),enabled=!busy)
            OutlinedTextField(description,{description=it},label={Text("Описание")},modifier=Modifier.fillMaxWidth(),enabled=!busy)
            HabitMeasurementFields(measurement,existing!=null,onChange={measurement=it},onValidity={measurementValid=it},periodGoal=periodGoal,
                hadPeriodGoal=initial.periodGoal!=null||initial.ruleHistory.any { it.periodGoal!=null })
            HabitPeriodGoalFields(periodGoal,measurement,mode,initial.schedule.timezone,existing!=null,
                onChange={periodGoal=it},onValidity={periodValid=it},hadPeriodGoal=initial.periodGoal!=null||initial.ruleHistory.any { it.periodGoal!=null })
            if(existing!=null) HabitRuleHistoryPanel(existing,LocalDate.now(),busy,onChooseRule)
            HabitPersonalizationFields(emoji,color,isKeyHabit,ritualId,ritualName,!busy,
                onEmoji={ emoji=it.take(32) },onColor={ color=it.take(7) },
                onKeyHabit={ isKeyHabit=it },
                onRitual={ ritualId=it; if(it!="custom") ritualName="" },
                onRitualName={ ritualName=it.take(60) })
            PriorityControl(priority) { if(!busy) priority=it }
            HabitTimerPreferenceFields(timerEnabled, { timerEnabled = it }, timerPreferences, !busy,
                { timerPreferences = it }, { timerPreferencesValid = it })
            }
            EditorSection("Календарь и срок") {
            if (LocalSacredFeaturesEnabled.current) {
            Text("Календарь привычки", style=MaterialTheme.typography.titleSmall)
            Text("Определяет повторение и вид дат этой привычки.",
                style=MaterialTheme.typography.bodySmall,
                color=MaterialTheme.colorScheme.onSurfaceVariant)
            Row(Modifier.horizontalScroll(rememberScrollState())) {
                (listOf(inputCalendarMode) + listOf(CalendarMode.SACRED,CalendarMode.PROFANE,CalendarMode.LUNAR)
                    .filterNot { it==inputCalendarMode }).filter { LocalSacredFeaturesEnabled.current || it!=CalendarMode.SACRED || mode==CalendarMode.SACRED }.forEach { option ->
                    val label=when(option) {CalendarMode.SACRED->"Сакральный";CalendarMode.PROFANE->"Григорианский";CalendarMode.LUNAR->"Лунный"}
                    FilterChip(selected=mode==option,enabled=!busy,onClick={
                        config=engine.defaultSchedule(LocalDate.parse(start),option).recurrence
                        formCalendarMode=option
                        if(option==CalendarMode.SACRED) sacredCadence="pyata-days"
                    },modifier=Modifier.testTag("habit-calendar-${option.wireValue}"),label={Text(label)})
                }
            }
            }
            Text("Начало")
            if(existing==null) AuthorDatePicker(start,formCalendarMode,minDate=LocalDate.now()) {
                if(!busy && LocalDate.parse(it)>=LocalDate.now()) {
                    start=it
                    if(end.isNotEmpty() && end<start) end=start
                    config=config.copy(rangeStart=start)
                }
            } else {
                Text(engineCalendar.formatDate(existing.schedule.startDate,
                    if (LocalSacredFeaturesEnabled.current) formCalendarMode else CalendarMode.PROFANE),
                    modifier=Modifier.testTag("habit-start-locked"))
                Text("🔒 Дата начала зафиксирована при создании.",style=MaterialTheme.typography.bodySmall)
            }
            if(initial.practiceGoal==null) Row { Checkbox(checked=end.isNotEmpty(),enabled=!busy,onCheckedChange={end=if(it) start else ""}); Text("Ограничить срок",Modifier.padding(top=12.dp)) }
            if(end.isNotEmpty()) AuthorDatePicker(end,formCalendarMode,minDate=LocalDate.parse(start)) { if(!busy) end=it }
            }
            EditorSection("Повторение") {
            if(mode==CalendarMode.PROFANE) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                listOf("daily" to "Ежедневно","weekdays" to "Дни недели","monthly" to "Ежемесячно","yearly" to "Ежегодно").forEach { (pattern,label) ->
                    FilterChip(config.pattern==pattern,{config=config.copy(pattern=pattern)},enabled=!busy,label={Text(label)})
                }
            }
            if(mode==CalendarMode.SACRED) {
                Text("Повторение по сакральному календарю")
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    listOf("daily" to "Ежедневно", "pyata-days" to "Дни пяты",
                        "parity" to "Чётная/нечётная", "monthly" to "Ежемесячно",
                        "yearly" to "Ежегодно").forEach { (cadence,label) ->
                        FilterChip(sacredCadence==cadence,onClick={
                            sacredCadence=cadence
                            val sacred=engineCalendar.sacredDate(LocalDate.parse(start))
                            val day=if(sacred.monthIndex<12) sacred.day else 1
                            config=when(cadence) {
                                "daily" -> config.copy(pattern="pyata-days",days=(1..5).toList(),months=emptyList(),pyatas=emptyList())
                                "pyata-days" -> config.copy(pattern="pyata-days",days=listOf(1),months=emptyList(),pyatas=emptyList())
                                "parity" -> config.copy(pattern="pyata-days",days=(1..5).toList(),months=emptyList(),pyatas=listOf(1,3,5))
                                "monthly" -> config.copy(pattern="month-days",days=listOf(day),months=emptyList(),pyatas=emptyList())
                                else -> config.copy(pattern="month-days",days=listOf(day),months=listOf(if(sacred.monthIndex<12) sacred.monthIndex+1 else 1),pyatas=emptyList())
                            }
                        },enabled=!busy,label={Text(label)})
                    }
                }
                if(sacredCadence=="parity") Row(horizontalArrangement=Arrangement.spacedBy(6.dp)) {
                    FilterChip(config.pyatas==listOf(1,3,5),onClick={config=config.copy(pyatas=listOf(1,3,5))},enabled=!busy,label={Text("Нечётные пяты")})
                    FilterChip(config.pyatas==listOf(2,4,6),onClick={config=config.copy(pyatas=listOf(2,4,6))},enabled=!busy,label={Text("Чётные пяты")})
                }
                if(sacredCadence=="yearly") {
                    Text("Сакральный месяц")
                    (1..12).chunked(4).forEach { row -> Row(horizontalArrangement=Arrangement.spacedBy(4.dp)) {
                        row.forEach { month -> FilterChip(month in config.months,onClick={config=config.copy(months=listOf(month))},enabled=!busy,label={Text(month.toString())}) }
                    } }
                }
                if(sacredCadence=="monthly" || sacredCadence=="yearly") Text("Апейрон исключён из расписания")
            }
            if(mode==CalendarMode.LUNAR) {
                Text("Повторение по лунному календарю")
                Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    listOf("daily" to "Ежедневно", "lunar-days" to "Дни месяца",
                        "lunar-decades" to "Декады", "lunar-decade-days" to "Дни декады",
                        "lunar-phases" to "Новолуние / полнолуние", "lunar-yearly" to "Ежегодно").forEach { (cadence,label) ->
                        FilterChip(if(cadence=="daily") lunarDaily else !lunarDaily&&config.pattern==cadence,
                            onClick={
                                val lunar=engineCalendar.lunarDate(LocalDate.parse(start))
                                config=when(cadence) {
                                    "daily" -> config.copy(pattern="lunar-days",days=(1..30).toList(),months=emptyList(),pyatas=emptyList())
                                    "lunar-decades" -> config.copy(pattern=cadence,days=listOf((lunar.day-1)/10+1),months=emptyList(),pyatas=emptyList())
                                    "lunar-decade-days" -> config.copy(pattern=cadence,days=listOf((lunar.day-1)%10+1),months=emptyList(),pyatas=listOf((lunar.day-1)/10+1))
                                    "lunar-phases" -> config.copy(pattern=cadence,days=listOf(1),months=emptyList(),pyatas=emptyList())
                                    "lunar-yearly" -> config.copy(pattern=cadence,days=listOf(lunar.day),months=listOf(lunar.monthOrdinal),pyatas=emptyList())
                                    else -> config.copy(pattern="lunar-days",days=listOf(lunar.day),months=emptyList(),pyatas=emptyList())
                                }
                            },enabled=!busy,modifier=Modifier.testTag("habit-lunar-cadence-$cadence"),label={Text(label)})
                    }
                }
                if(config.pattern=="lunar-decade-days") {
                    Text("В каких декадах месяца")
                    Row(horizontalArrangement=Arrangement.spacedBy(6.dp)) { (1..3).forEach { decade ->
                        FilterChip(decade in config.pyatas,onClick={
                            val next=if(decade in config.pyatas) config.pyatas.filterNot { it==decade } else config.pyatas+decade
                            if(next.isNotEmpty()) config=config.copy(pyatas=next)
                        },enabled=!busy,label={Text("$decade декада")})
                    } }
                }
                if(config.pattern=="lunar-phases") {
                    Row(horizontalArrangement=Arrangement.spacedBy(6.dp)) {
                        listOf(1 to "Новолуние",2 to "Полнолуние").forEach { (phase,label) ->
                            FilterChip(phase in config.days,onClick={
                                val next=if(phase in config.days) config.days.filterNot { it==phase } else config.days+phase
                                if(next.isNotEmpty()) config=config.copy(days=next)
                            },enabled=!busy,label={Text(label)})
                        }
                    }
                }
                if(config.pattern=="lunar-yearly") {
                    Text("Лунный месяц года · 13-й бывает не каждый год")
                    (1..13).chunked(5).forEach { row -> Row(horizontalArrangement=Arrangement.spacedBy(4.dp)) {
                        row.forEach { month -> FilterChip(month in config.months,onClick={config=config.copy(months=listOf(month))},
                            enabled=!busy,label={Text(month.toString())}) }
                    } }
                }
            }
            if(limit>0) {
                Text(when {
                    mode==CalendarMode.SACRED && sacredCadence=="pyata-days" -> "Дни внутри пяты"
                    mode==CalendarMode.LUNAR && config.pattern=="lunar-decades" -> "Декады месяца"
                    mode==CalendarMode.LUNAR && config.pattern=="lunar-decade-days" -> "Дни внутри выбранных декад"
                    else -> "Дни расписания"
                })
                val daysPerRow = if(limit==7) 7 else 5
                (1..limit).chunked(daysPerRow).forEach { row -> Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min),horizontalArrangement=Arrangement.spacedBy(4.dp)) { row.forEach { day ->
                    FilterChip(day in config.days,onClick={
                        if(mode==CalendarMode.SACRED && sacredCadence in setOf("monthly","yearly")) config=config.copy(days=listOf(day))
                        else if(day !in config.days || config.days.size>1) config=config.copy(days=if(day in config.days) config.days.filterNot { it==day } else config.days+day)
                    },enabled=!busy,modifier=Modifier.weight(1f).fillMaxHeight().testTag("habit-schedule-day-$day"),
                        label={Text(if(mode==CalendarMode.SACRED&&sacredCadence=="pyata-days") listOf("I","II","III","IIII","V")[day-1] else day.toString(),
                            Modifier.fillMaxWidth(),textAlign=androidx.compose.ui.text.style.TextAlign.Center,maxLines=1)})
                } } }
            }
            }
            EditorSection("Время и напоминание") {
            HabitIntervalFields(intervalSchedule,!busy) { interval ->
                intervalSchedule=interval
                if(interval!=null) { preferredTime=""; reminder=reminder.copy(timing="habit") }
            }
            HabitReminderFields(preferredTime, reminder, !busy,
                intervalSchedule=intervalSchedule,
                googleTasksReady=accountSettings?.authProvider=="google" && accountSettings.accounts.any { it.tasksConnected },
                googleCalendarReady=accountSettings?.authProvider=="google" && accountSettings.accounts.any { it.calendarConnected },
                onTime = {
                preferredTime = it
                if(it.isEmpty() && reminder.timing=="habit") reminder=reminder.copy(timing="custom")
            }, onReminder = { reminder = it })
            }
            EditorSection("Начисление XP") {
            if(existing!=null) Text("🔒 Начисление XP зафиксировано при создании. Для другой формулы удалите привычку и создайте новую.",style=MaterialTheme.typography.bodySmall)
            if(existing==null) Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
                listOf("none" to "Без баллов","binary" to "Выполнение · 10","quality-ten" to "Качество · 1–10","quality-bipolar" to "Качество · −5…+5").chunked(2).forEach { row ->
                    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                        row.forEach { (value,label) ->
                            FilterChip(scoring==value,{scoring=value},enabled=!busy,
                                modifier=Modifier.weight(1f).fillMaxHeight().testTag("habit-scoring-$value"),
                                label={Text(label,Modifier.fillMaxWidth(),textAlign=androidx.compose.ui.text.style.TextAlign.Center)})
                        }
                    }
                }
            } else Text(when(scoring) {"none"->"Без баллов";"quality-ten"->"Качество · 1–10";"quality-bipolar"->"Качество · −5…+5";else->"Выполнение · 10"})
            }
            HabitAutoDeleteFields(autoDeletePolicy,!busy,onChange={autoDeletePolicy=it},onValidity={autoDeleteValid=it})
            error?.let { NativeAccessMessage(it, "habits") }
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                TextButton(enabled=!busy,onClick=::requestDismiss) { Text("Отмена") }
                Button(enabled=!busy&&timerPreferencesValid&&autoDeleteValid&&HabitRuleHistory.state(initial,LocalDate.MAX).conflicts.isEmpty()&&measurementValid&&periodValid&&title.isNotBlank()&&normalizedHabitColor(color)!=null&&normalizedHabitEmoji(emoji)!=null&&
                    (ritualId!="custom"||ritualName.isNotBlank())&&
                    (limit==0||config.days.isNotEmpty())&&(end.isEmpty()||end>=start)&&(initial.practiceGoal==null||end.isNotEmpty())&&intervalSchedule?.valid()!=false,onClick={
                    onSave(initial.copy(title=if (title.trim() == editorInitialTitle) initial.title else title.trim(),description=description,priority=priority,scoringMode=scoring,timerEnabled=timerEnabled,timerPreferences=timerPreferences,autoDeletePolicy=autoDeletePolicy,
                        createdDate=if(existing==null) LocalDate.parse(start) else initial.createdDate,
                        emoji=requireNotNull(normalizedHabitEmoji(emoji)),color=requireNotNull(normalizedHabitColor(color)),
                        isKeyHabit=isKeyHabit,ritualId=ritualId,ritualName=if(ritualId=="custom") ritualName.trim() else "",
                        preferredTime=preferredTime,reminder=reminder,measurement=measurement,periodGoal=periodGoal,
                        intervalSchedule=if(measurement!=null||periodGoal!=null) intervalSchedule?.copy(completionMode="day") else intervalSchedule,
                        qualityScale=when(scoring){"quality-ten"->"ten";"quality-bipolar"->"bipolar";else->"none"},
                        schedule=initial.schedule.copy(startDate=LocalDate.parse(start),endDate=end.takeIf(String::isNotEmpty)?.let(LocalDate::parse),recurrence=config)))
                }) { Text(if(busy) "Сохранение…" else "Сохранить") }
            }
        }
    } }
    if (discardConfirmation) AlertDialog(onDismissRequest = { discardConfirmation = false },
        title = { Text("Закрыть без сохранения?") },
        text = { Text("Изменения привычки ещё не сохранены.") },
        confirmButton = { TextButton(onClick = { discardConfirmation = false; onDismiss() },
            modifier = Modifier.heightIn(min = 48.dp).testTag("habit-discard-confirm")) { Text("Не сохранять") } },
        dismissButton = { TextButton(onClick = { discardConfirmation = false },
            modifier = Modifier.heightIn(min = 48.dp).testTag("habit-discard-cancel")) { Text("Продолжить") } })
}
