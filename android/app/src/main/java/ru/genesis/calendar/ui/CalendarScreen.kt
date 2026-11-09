package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Shadow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.TextStyle as ComposeTextStyle
import ru.genesis.calendar.ui.Dialog
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.CalendarRange
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.SacredCatalog
import ru.genesis.calendar.domain.SacredMonth
import ru.genesis.calendar.domain.MoonInfo
import ru.genesis.calendar.domain.lunarPatronForDay
import ru.genesis.calendar.domain.SolarEvent
import ru.genesis.calendar.domain.SolarLocation
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.data.TaskOccurrences
import java.time.LocalDate
import java.time.ZoneId
import java.time.Month
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.roundToInt

private val ru = Locale.forLanguageTag("ru")
private val calendarIncompleteColor = Color(0xffb63b42)
private val calendarCompletedColor = Color(0xff255b59)
data class SharedCalendarEntry(val id: String, val title: String, val dueDate: String,
    val projectTitle: String, val completed: Boolean, val projectId: String = "", val spaceId: String = "")
internal val LocalSharedCalendarCounts = compositionLocalOf<Map<String,Int>> { emptyMap() }
private val LocalOpenSharedCalendarDay = compositionLocalOf<(LocalDate) -> Unit> { {} }
private val LocalSharedCalendarTasks = compositionLocalOf<Map<String, List<SharedCalendarEntry>>> { emptyMap() }

private enum class GregorianSeason(val title: String, val englishTitle: String,
    val months: List<Int>, val background: Color, val accent: Color) {
    WINTER("Зима", "Winter", listOf(1, 2, 12), Color(0xfffffdf8), Color(0xff526263)),
    SPRING("Весна", "Spring", listOf(3, 4, 5), Color(0xffdfefdd), Color(0xff356239)),
    SUMMER("Лето", "Summer", listOf(6, 7, 8), Color(0xffdceff6), Color(0xff275f79)),
    AUTUMN("Осень", "Autumn", listOf(9, 10, 11), Color(0xfff5ded9), Color(0xff963f36)),
}
private fun seasonForGregorianMonth(month: Int, southern: Boolean): GregorianSeason = when (month) {
    12, 1, 2 -> if (southern) GregorianSeason.SUMMER else GregorianSeason.WINTER
    3, 4, 5 -> if (southern) GregorianSeason.AUTUMN else GregorianSeason.SPRING
    6, 7, 8 -> if (southern) GregorianSeason.WINTER else GregorianSeason.SUMMER
    else -> if (southern) GregorianSeason.SPRING else GregorianSeason.AUTUMN
}
@Composable private fun seasonSurface(season: GregorianSeason): Color = if (!LocalEveningTheme.current) season.background else when(season) {
    GregorianSeason.WINTER -> Color(0xff3c4643)
    GregorianSeason.SPRING -> Color(0xff2d4935)
    GregorianSeason.SUMMER -> Color(0xff2e495b)
    GregorianSeason.AUTUMN -> Color(0xff543630)
}
@Composable private fun seasonAccent(season: GregorianSeason): Color = if (!LocalEveningTheme.current) season.accent else when(season) {
    GregorianSeason.WINTER -> Color(0xffd6d8d3)
    GregorianSeason.SPRING -> Color(0xffabc8a2)
    GregorianSeason.SUMMER -> Color(0xffadc8d4)
    GregorianSeason.AUTUMN -> Color(0xffddb2a7)
}
private fun seasonHeaderTone(season: GregorianSeason): Color = when (season) {
    GregorianSeason.WINTER -> Color(0xff223b40)
    GregorianSeason.SPRING -> Color(0xff204a36)
    GregorianSeason.SUMMER -> Color(0xff17445b)
    GregorianSeason.AUTUMN -> Color(0xff613b35)
}
private data class YearSeasonGroup(
    val season: GregorianSeason?,
    val months: List<Triple<LocalDate, String, String>>,
    val firstOrdinal: Int,
)
private data class YearTaskCount(val total: Int, val completed: Int)
private fun dateLabel(locale: Locale) = DateTimeFormatter.ofPattern("d MMM yyyy", locale)

internal fun sacredMonthArtPath(index: Int): String {
    require(index in 0..12)
    return "month-art-v4/month-${(index + 1).toString().padStart(2, '0')}.webp"
}

internal fun lunarMonthArtPath(index: Int): String {
    require(index in 0..12)
    return "lunar-month-art-v1/month-${(index + 1).toString().padStart(2, '0')}.webp"
}

/** The display calendar controls this screen only; task input and recurrence remain independent. */
@Composable
fun CalendarScreen(date: LocalDate, mode: CalendarMode, onSelect: (LocalDate) -> Unit,
    onModeChange: (CalendarMode) -> Unit = {},
    experimental: Boolean = false, tasks: List<LocalTask> = emptyList(), use24: Boolean = true,
    weekStartsOnSunday: Boolean = true,
    gregorianYearStartsInMarch: Boolean = false, regionalSeasonArt: Boolean = false,
    onStartGregorianYearInMarch: () -> Unit = {},
    seasonRegionZone: ZoneId = ZoneId.systemDefault(),
    onCompleteTask: (LocalTask) -> Unit = {},
    onEditTask: (LocalTask, LocalDate) -> Unit = { _, _ -> },
    onDeleteTask: (LocalTask) -> Unit = {},
    onDeleteOccurrence: ((LocalTask, LocalDate) -> Unit)? = null,
    onCreateTask: (LocalDate) -> Unit = {},
    dayHabits: (@Composable (LocalDate) -> Unit)? = null,
    menuSwipeState: MenuSwipeState? = null, periodSwipeEnabled: Boolean = true,
    voiceRequest: NativeVoiceAction? = null, onVoiceRequestConsumed: () -> Unit = {},
    hiddenSubmenus: Set<String> = emptySet(), entryRequest: Int = 0,
    sharedTasks: List<SharedCalendarEntry> = emptyList(),
    sharedCounts: Map<String,Int> = emptyMap(),
    onOpenSharedProjects: () -> Unit = {},
    loadSharedDay: suspend (LocalDate) -> List<SharedCalendarEntry> = { day -> sharedTasks.filter { it.dueDate == day.toString() } },
    onOpenSharedTask: (SharedCalendarEntry) -> Unit = {}) {
    val mode = if (LocalSacredFeaturesEnabled.current) mode else CalendarMode.PROFANE
    WorkspaceScreenHeader(title = calendarScreenTitle(mode))
    val calendar = remember { GenesisCalendar() }
    var shown by rememberSaveable(mode, date) { mutableStateOf(date.toString()) }
    var selected by rememberSaveable(mode, date) { mutableStateOf(date.toString()) }
    var localYearView by rememberSaveable { mutableStateOf(false) }
    var lunarByDecade by rememberSaveable { mutableStateOf(true) }
    val yearView = if ("calendar.month" in hiddenSubmenus) true
        else if ("calendar.year" in hiddenSubmenus) false
        else menuSwipeState?.calendar == "year" || menuSwipeState == null && localYearView
    var sharedListDate by rememberSaveable { mutableStateOf<String?>(null) }
    var taskListDate by rememberSaveable { mutableStateOf<String?>(null) }
    var yearTaskMonth by rememberSaveable { mutableStateOf<String?>(null) }
    var yearTasksShared by rememberSaveable { mutableStateOf(false) }
    var focusDayRequest by rememberSaveable { mutableIntStateOf(0) }
    var appliedEntryRequest by rememberSaveable { mutableIntStateOf(0) }
    // rememberSaveable can restore an older period even when its input date changed
    // while this screen was absent. The externally selected day wins on re-entry.
    var appliedExternalDate by rememberSaveable { mutableStateOf(date.toString()) }
    // Internal period navigation must not be mistaken for an external request to reveal a day.
    fun selectDate(target: LocalDate, revealDay: Boolean = false) {
        shown = target.toString()
        selected = target.toString()
        appliedExternalDate = target.toString()
        focusDayRequest = if (revealDay) focusDayRequest + 1 else 0
        onSelect(target)
    }
    LaunchedEffect(date, entryRequest) {
        // A menu entry can arrive together with a restored/external date. Handle
        // both in one effect so the date cannot re-enable day focus afterwards.
        if (entryRequest > 0 && entryRequest != appliedEntryRequest) {
            appliedEntryRequest = entryRequest
            shown = date.toString(); selected = date.toString()
            appliedExternalDate = date.toString(); focusDayRequest = 0
        } else if (appliedExternalDate != date.toString()) {
            shown = date.toString(); selected = date.toString()
            appliedExternalDate = date.toString(); focusDayRequest++
        }
    }
    var deletingTaskId by rememberSaveable { mutableStateOf<String?>(null) }
    var deletingDate by rememberSaveable { mutableStateOf(date.toString()) }
    var voiceScrollToken by remember { mutableIntStateOf(0) }
    var voiceScrollDirection by remember { mutableStateOf("down") }
    val shownDate = LocalDate.parse(shown)
    val range = remember(shownDate, mode) { runCatching { calendar.monthRange(shownDate, mode) } }

    LaunchedEffect(voiceRequest) {
        when(val action=voiceRequest) {
            is NativeVoiceAction.CalendarModeChange -> onModeChange(action.mode)
            is NativeVoiceAction.CalendarView -> {
                localYearView=action.year; menuSwipeState?.calendar=if(action.year) "year" else "month"
            }
            is NativeVoiceAction.CalendarStep -> {
                val target=runCatching {
                    val current=LocalDate.parse(shown)
                    if(action.year) calendar.shiftYear(current, mode, action.step) else {
                        val period=calendar.monthRange(current,mode)
                        if(action.step>0) period.end.plusDays(1) else period.start.minusDays(1)
                    }
                }.getOrNull()
                if(target!=null && target.year in 1900..2100) selectDate(target)
                localYearView=action.year;menuSwipeState?.calendar=if(action.year) "year" else "month"
            }
            is NativeVoiceAction.CalendarSwipe -> {
                val current=LocalDate.parse(shown)
                val target=runCatching {
                    if(yearView) calendar.shiftYear(current, mode, action.step) else calendar.monthRange(current,mode).let {
                        if(action.step>0) it.end.plusDays(1) else it.start.minusDays(1)
                    }
                }.getOrNull()
                if(target!=null && target.year in 1900..2100) selectDate(target)
            }
            is NativeVoiceAction.CalendarDate -> {
                val target=runCatching { LocalDate.of(action.year,action.month,action.day) }.getOrNull()
                if(target!=null && target.year in 1900..2100) {
                    selectDate(target, revealDay = true)
                    localYearView=false;menuSwipeState?.calendar="month"
                }
            }
            is NativeVoiceAction.CalendarMonth -> {
                val current=LocalDate.parse(shown)
                val target=runCatching { when(mode) {
                    CalendarMode.SACRED -> calendar.gregorianDate(calendar.sacredDate(current).sacredYear,action.ordinal-1,1)
                    CalendarMode.PROFANE -> current.withMonth(action.ordinal).withDayOfMonth(1)
                    CalendarMode.LUNAR -> calendar.lunarDate(current).year.let { year ->
                        require(action.ordinal in 1..year.monthCount)
                        calendar.lunarMonthStart(year.startMonthIndex+action.ordinal-1)
                    }
                } }.getOrNull()
                if(target!=null && target.year in 1900..2100) {
                    selectDate(target)
                    localYearView=false;menuSwipeState?.calendar="month"
                }
            }
            is NativeVoiceAction.Scroll -> {
                voiceScrollDirection=action.direction;voiceScrollToken++
            }
            else -> Unit
        }
        if(voiceRequest!=null) onVoiceRequestConsumed()
    }

    val sharedTasksByDate = remember(sharedTasks) { sharedTasks.groupBy { it.dueDate } }
    CompositionLocalProvider(LocalCalendarPeriodSwipeEnabled provides periodSwipeEnabled,
        LocalSharedCalendarCounts provides sharedCounts, LocalSharedCalendarTasks provides sharedTasksByDate,
        LocalOpenSharedCalendarDay provides { sharedListDate = it.toString() }) {
    Column(Modifier.fillMaxSize()) {
        val submenuItems = listOf(SubmenuItem("month", "Месяц"), SubmenuItem("year", "Год"))
            .filter { "calendar.${it.id}" !in hiddenSubmenus }
        if (submenuItems.size > 1) ConnectedSubmenu(submenuItems,
            if (yearView) "year" else "month", {
                localYearView = it == "year"; menuSwipeState?.calendar = it
            }, Modifier.testTag("calendar-view-switch"))
        if (yearView) CalendarYearOverview(calendar, shownDate, mode, onModeChange, experimental, tasks,
            gregorianYearStartsInMarch, regionalSeasonArt, seasonRegionZone,
            onStartGregorianYearInMarch,voiceScrollToken,voiceScrollDirection,
            onMonth = {
                if ("calendar.month" !in hiddenSubmenus) {
                    selectDate(it)
                    localYearView = false
                    menuSwipeState?.calendar = "month"
                }
            },
            onDay = {
                if ("calendar.month" !in hiddenSubmenus) {
                    selectDate(it, revealDay = true)
                    localYearView = false
                    menuSwipeState?.calendar = "month"
                }
            },
            onYear = { selectDate(it) },
            onTasks = { month, shared -> yearTasksShared=shared;yearTaskMonth=month.toString() })
        else if (range.isFailure) Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Этот период вне диапазона офлайн-календаря.", color = MaterialTheme.colorScheme.error)
        }
        else CalendarMonthContent(calendar, range.getOrThrow(), mode, onModeChange,
            LocalDate.parse(selected), experimental, tasks, focusDayRequest, entryRequest,
            voiceScrollToken,voiceScrollDirection,seasonRegionZone,
            weekStartsOnSunday, lunarByDecade, onLunarLayoutChange={ lunarByDecade=it },
            onNavigate = { selectDate(it) },
            onChoose = { selectDate(it, revealDay = true) },
            onToday = { selectDate(LocalDate.now()) },
            onOpenTaskList = { taskListDate = it.toString() },
            taskActions = { day ->
                val dayTasks = TaskOccurrences.byDate(tasks, day, day)[day.toString()].orEmpty()
                CalendarInlineTasks(day, dayTasks, use24, onCompleteTask,
                    onCreate = { onCreateTask(day) },
                    onEdit = { onEditTask(it, day) },
                    onDelete = { deletingTaskId = it.id; deletingDate = day.toString() })
                sharedTasksByDate[day.toString()]?.takeIf { it.isNotEmpty() }?.let { shared ->
                    Card(Modifier.fillMaxWidth().testTag("calendar-shared-tasks-$day"),
                        border = BorderStroke(2.dp, Color(0xff167c91))) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(if (LocalGenesisLanguage.current == "en") "Shared tasks · ${shared.size}"
                                else "Общие задачи · ${shared.size}", style = MaterialTheme.typography.titleSmall)
                            shared.forEach { entry -> Text("${if (entry.completed) "✓ " else ""}${entry.title} · ${entry.projectTitle}",
                                style = MaterialTheme.typography.bodySmall) }
                            TextButton(onClick = onOpenSharedProjects) {
                                Text(if (LocalGenesisLanguage.current == "en") "Open shared projects" else "Открыть общие проекты")
                            }
                        }
                    }
                }
            }, habitActions = dayHabits)
    }
    }
    tasks.firstOrNull { it.id == deletingTaskId }?.let { task ->
        val occurrenceDate = LocalDate.parse(deletingDate)
        val recurring = task.recurrence.enabled && onDeleteOccurrence != null
        AlertDialog(onDismissRequest = { deletingTaskId = null },
            title = { Text(if (recurring) "Удалить повторение?" else "Удалить задачу?") },
            text = { Text(if (recurring) "Можно удалить только $occurrenceDate или всю серию."
                else "Напоминание этой задачи будет отменено.") },
            confirmButton = { if (recurring) DialogActionRow(
                DialogIconAction("Отмена", AffairsAction.BACK, { deletingTaskId = null }),
                DialogIconAction("Только этот день", AffairsAction.CALENDAR,
                    { onDeleteOccurrence?.invoke(task, occurrenceDate); deletingTaskId = null }, destructive = true),
                DialogIconAction("Вся серия", AffairsAction.DELETE, { onDeleteTask(task); deletingTaskId = null },
                    destructive = true, modifier = Modifier.testTag("calendar-inline-delete-confirm"))
            ) else TextButton({ onDeleteTask(task); deletingTaskId = null },
                    Modifier.testTag("calendar-inline-delete-confirm")) { Text(if (recurring) "Вся серия" else "Удалить") }
            }, dismissButton = if (recurring) null else ({ TextButton({ deletingTaskId = null }) { Text("Отмена") } }))
    }
    yearTaskMonth?.let { raw ->
        CalendarYearTasksDialog(calendar.monthRange(LocalDate.parse(raw), mode),tasks,use24,yearTasksShared,
            sharedCounts,loadSharedDay,onCompleteTask,
            onCreate={ day -> yearTaskMonth=null;onCreateTask(day) },
            onEdit={ task,day -> yearTaskMonth=null;onEditTask(task,day) },
            onDelete={ task,day -> yearTaskMonth=null;deletingTaskId=task.id;deletingDate=day.toString() },
            onShared={ entry -> yearTaskMonth=null;onOpenSharedTask(entry) },onClose={ yearTaskMonth=null })
    }
    sharedListDate?.let { rawDate ->
        CalendarSharedTaskListDialog(LocalDate.parse(rawDate), loadSharedDay,
            onDismiss = { sharedListDate = null }, onOpen = { sharedListDate = null; onOpenSharedTask(it) },
            onOpenDay = { sharedListDate = null; shown = rawDate; selected = rawDate; focusDayRequest++; onSelect(LocalDate.parse(rawDate)) })
    }
    taskListDate?.let { rawDate ->
        val taskDate = LocalDate.parse(rawDate)
        val dayTasks = remember(tasks, rawDate) {
            TaskOccurrences.byDate(tasks, taskDate, taskDate)[rawDate].orEmpty()
        }
        CalendarTaskListDialog(taskDate, dayTasks, use24, onDismiss = { taskListDate = null },
            onComplete = onCompleteTask,
            onEdit = { task -> taskListDate = null; onEditTask(task, taskDate) },
            onDelete = onDeleteTask,
            onDeleteOccurrence = onDeleteOccurrence?.let { callback -> { task -> callback(task, taskDate) } },
            onOpenDay = {
                taskListDate = null
                shown = taskDate.toString()
                selected = taskDate.toString()
                focusDayRequest++
                onSelect(taskDate)
            })
    }
}

@Composable
private fun CalendarMonthContent(calendar: GenesisCalendar, range: CalendarRange, mode: CalendarMode,
    onModeChange: (CalendarMode) -> Unit, selected: LocalDate, experimental: Boolean, tasks: List<LocalTask>,
    focusDayRequest: Int, entryRequest: Int, voiceScrollToken: Int, voiceScrollDirection: String, seasonRegionZone: ZoneId,
    weekStartsOnSunday: Boolean, lunarByDecade: Boolean,
    onLunarLayoutChange: (Boolean) -> Unit,
    onNavigate: (LocalDate) -> Unit, onChoose: (LocalDate) -> Unit, onToday: () -> Unit,
    onOpenTaskList: (LocalDate) -> Unit,
    taskActions: @Composable (LocalDate) -> Unit,
    habitActions: (@Composable (LocalDate) -> Unit)?) {
    val locale = Locale.forLanguageTag(LocalGenesisLanguage.current).takeIf { it.language.isNotBlank() } ?: ru
    val solarLocation by rememberAutomaticSolarLocation(calendar.zoneId)
    val scroll = rememberScrollState()
    LaunchedEffect(voiceScrollToken) {
        if(voiceScrollToken>0) scroll.animateScrollTo(when(voiceScrollDirection) {
            "top" -> 0
            "bottom" -> scroll.maxValue
            "up" -> (scroll.value-600).coerceAtLeast(0)
            else -> (scroll.value+600).coerceAtMost(scroll.maxValue)
        })
    }
    var previewRequested by remember(range.start) { mutableStateOf(false) }
    var selectedDayTop by remember(range.start) { mutableIntStateOf(-1) }
    var selectedDayHeight by remember(range.start) { mutableIntStateOf(0) }
    var viewportHeight by remember { mutableIntStateOf(0) }
    val density = LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxSize().testTag("calendar-month")) {
        val twoPanes = maxWidth >= 840.dp
        LaunchedEffect(range.start, focusDayRequest, entryRequest) {
            if (focusDayRequest > 0) previewRequested = true
            else { previewRequested = false; scroll.scrollTo(0) }
        }
        LaunchedEffect(selected, previewRequested, selectedDayTop, scroll.maxValue, twoPanes) {
            if (!twoPanes && previewRequested && selectedDayTop >= 0) scroll.animateScrollTo(selectedDayTop)
        }
        val choose: (LocalDate) -> Unit = { day -> previewRequested = true; onChoose(day) }
        val monthContent: @Composable () -> Unit = {
        CalendarPeriodPager(range,
            remember(range, mode) { runCatching { calendar.monthRange(range.start.minusDays(1), mode) }.getOrNull()?.takeIf { it.end.year >= 1900 } },
            remember(range, mode) { runCatching { calendar.monthRange(range.end.plusDays(1), mode) }.getOrNull()?.takeIf { it.start.year <= 2100 } },
            { onNavigate(range.start.minusDays(1)) },
            { onNavigate(range.end.plusDays(1)) }, Modifier.fillMaxWidth(),
            transitionMillis = if (android.animation.ValueAnimator.areAnimatorsEnabled()) 360 else 0) { page, previous, next ->
            val pageTasks = remember(tasks, page) { TaskOccurrences.byDate(tasks, page.start, page.end) }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val offerToday = calendarOffersToday(selected, page, LocalDate.now())
                val referenceDate = when {
                    selected >= page.start && selected <= page.end -> selected
                    page.end < range.start -> page.end
                    else -> page.start
                }
                if (mode == CalendarMode.PROFANE) CalendarMonthHero(calendar, referenceDate, mode,
                    seasonRegionZone, offerToday, onToday, previous, next)
                Card(Modifier.fillMaxWidth().testTag(if (mode == CalendarMode.SACRED) "sacred-month-pyatas"
                    else "calendar-month-panel-${mode.wireValue}"), shape = AffairsLayout.shape,
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.secondary.copy(alpha = .45f))) {
                if (mode != CalendarMode.PROFANE) CalendarMonthHero(calendar, referenceDate, mode,
                    seasonRegionZone, offerToday, onToday, previous, next)
                Column(Modifier.padding(horizontal = 10.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("${page.start.format(dateLabel(locale))} — ${page.end.format(dateLabel(locale))}",
                        style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if(mode == CalendarMode.LUNAR) Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                        horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                        FilterChip(lunarByDecade,onClick={onLunarLayoutChange(true)},
                            label={Text("Декады",Modifier.fillMaxWidth(),textAlign=androidx.compose.ui.text.style.TextAlign.Center)},
                            modifier=Modifier.weight(1f).fillMaxHeight().testTag("lunar-layout-decades"))
                        FilterChip(!lunarByDecade,onClick={onLunarLayoutChange(false)},
                            label={Text("Дни недели",Modifier.fillMaxWidth(),textAlign=androidx.compose.ui.text.style.TextAlign.Center)},
                            modifier=Modifier.weight(1f).fillMaxHeight().testTag("lunar-layout-weekdays"))
                    }
                    if (mode == CalendarMode.SACRED) SacredDayGrid(calendar, page, selected, choose, experimental,
                        pageTasks, onOpenTaskList, solarLocation)
                    else if(mode == CalendarMode.LUNAR && lunarByDecade) LunarDecadeGrid(calendar, page,
                        selected, choose, experimental, pageTasks, onOpenTaskList, solarLocation)
                    else SevenDayGrid(calendar, page, mode, selected, choose, experimental, pageTasks,
                        onOpenTaskList, solarLocation, weekStartsOnSunday)
                }
            }
            }
        }
        }
        val dayContent: @Composable () -> Unit = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SelectedDayCard(calendar, selected, mode, experimental, solarLocation)
                Card(Modifier.fillMaxWidth().testTag("calendar-day-actions"), shape = AffairsLayout.shape,
                    colors = CardDefaults.cardColors(containerColor = if (LocalEveningTheme.current)
                        Color(0xff302a1f) else MaterialTheme.colorScheme.primaryContainer)) {
                    Column(Modifier.padding(16.dp)) { taskActions(selected) }
                }
                habitActions?.let { habits ->
                    TodayHabitTrackerBlock {
                        Box(Modifier.testTag("calendar-habits-card")) { habits(selected) }
                    }
                }
            }
        }
        if (twoPanes) {
            Row(Modifier.fillMaxSize().padding(horizontal = 12.dp).testTag("calendar-two-pane"),
                horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Column(Modifier.weight(1.55f).fillMaxHeight().verticalScroll(scroll),
                    verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    monthContent()
                    Spacer(Modifier.height(16.dp))
                }
                Column(Modifier.weight(1f).fillMaxHeight().verticalScroll(rememberScrollState())
                    .padding(top = 8.dp).testTag("calendar-day-pane"),
                    verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    dayContent()
                    Spacer(Modifier.height(16.dp))
                }
            }
        } else {
            Column(Modifier.fillMaxSize().onSizeChanged { viewportHeight = it.height }
                .verticalScroll(scroll).testTag("calendar-month-scroll").padding(horizontal = 8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                monthContent()
                Box(Modifier.fillMaxWidth().onGloballyPositioned {
                    selectedDayTop = it.positionInParent().y.roundToInt(); selectedDayHeight = it.size.height
                }) { dayContent() }
                Spacer(Modifier.height(maxOf(16.dp, with(density) {
                    (viewportHeight - selectedDayHeight).coerceAtLeast(0).toDp()
                })))
            }
        }
    }
}

@Composable internal fun CalendarHeroContrast(modifier: Modifier = Modifier, paletteToned: Boolean = true) {
    val darkBase = if (paletteToned) MaterialTheme.colorScheme.background else Color(0xff040e10)
    Box(modifier.background(if (!LocalEveningTheme.current) Brush.verticalGradient(
        0f to MaterialTheme.colorScheme.surface.copy(alpha = .68f * .85f),
        1f to MaterialTheme.colorScheme.surface.copy(alpha = .78f * .85f))
        else Brush.verticalGradient(
            // Increase the image's visible contribution by 15% only in the evening scheme.
            0f to darkBase.copy(alpha = 1f - (1f - 0xb3 / 255f) * 1.15f),
            1f to darkBase.copy(alpha = 1f - (1f - 0xd6 / 255f) * 1.15f))))
}

@Composable
private fun SacredDayGrid(calendar: GenesisCalendar, range: CalendarRange, selected: LocalDate,
    onChoose: (LocalDate) -> Unit, experimental: Boolean, tasksByDate: Map<String, List<LocalTask>>,
    onOpenTaskList: (LocalDate) -> Unit, solarLocation: SolarLocation) {
    var expandedPyatas by remember(range.start) { mutableStateOf(emptySet<Int>()) }
    range.dates().chunked(5).forEachIndexed { rowIndex, dates ->
        val first = calendar.sacredDate(dates.first())
        val day = SacredCatalog.months[first.monthIndex].days[first.day - 1]
        if (experimental && first.monthIndex != 12) {
            TextButton(onClick = { expandedPyatas = if (rowIndex in expandedPyatas)
                expandedPyatas - rowIndex else expandedPyatas + rowIndex },
                modifier = Modifier.fillMaxWidth().testTag("pyata-${rowIndex + 1}")) {
                Text("ПЯТА ${rowIndex + 1} · ${day.pyataTitle}  ${if (rowIndex in expandedPyatas) "⌃" else "⌄"}",
                    modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
            }
            if (rowIndex in expandedPyatas) Text(pyataDescriptions[rowIndex.coerceIn(0, 5)],
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                style = MaterialTheme.typography.bodyMedium)
        } else Text(if (first.monthIndex == 12) "Вне времени" else "Пята ${rowIndex + 1} · ${day.pyataTitle}",
            style = MaterialTheme.typography.titleSmall)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            dates.forEach { date ->
                val sacred = calendar.sacredDate(date)
                val definition = SacredCatalog.months[sacred.monthIndex].days[sacred.day - 1]
                CalendarDay(calendar, date, sacred.day, listOf("I", "II", "III", "IIII", "V")[(sacred.day - 1) % 5],
                    definition.name, date == selected, onChoose, Modifier.weight(1f),
                    if (experimental) calendar.moonInfo(date) else null,
                    if (experimental) "${date.dayOfMonth}.${date.monthValue}" else null,
                    if (experimental) tasksByDate[date.toString()].orEmpty().size else 0,
                    if (experimental && LocalSacredFeaturesEnabled.current) calendar.solarEvent(date) else null,
                    onTaskBadgeClick = onOpenTaskList,
                    completedTaskCount = if (experimental) tasksByDate[date.toString()].orEmpty().count { it.done } else 0)
            }
            repeat(5 - dates.size) { Spacer(Modifier.weight(1f)) }
        }
    }
}

@Composable
private fun SevenDayGrid(calendar: GenesisCalendar, range: CalendarRange, mode: CalendarMode,
    selected: LocalDate, onChoose: (LocalDate) -> Unit, experimental: Boolean,
    tasksByDate: Map<String, List<LocalTask>>, onOpenTaskList: (LocalDate) -> Unit,
    solarLocation: SolarLocation, weekStartsOnSunday: Boolean) {
    val sundayFirst = mode == CalendarMode.PROFANE && weekStartsOnSunday
    val english = LocalGenesisLanguage.current == "en"
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(1.dp)) {
        (if (sundayFirst && english) listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
            else if (english) listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
            else if (sundayFirst) listOf("Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб")
            else listOf("Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс")).forEach {
            Text(it, Modifier.weight(1f), style = MaterialTheme.typography.labelSmall)
        }
    }
    val leading = weekLeadingOffset(range.start, mode, weekStartsOnSunday)
    val days: List<LocalDate?> = when (mode) {
        CalendarMode.PROFANE -> gregorianGridDates(range, weekStartsOnSunday)
        CalendarMode.LUNAR -> lunarGridDates(range)
        CalendarMode.SACRED -> List(leading) { null } + range.dates()
    }
    days.chunked(7).forEachIndexed { weekIndex, week ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(1.dp)) {
            week.forEachIndexed { dayIndex, date ->
                if (date == null) Spacer(Modifier.weight(1f))
                else if (mode == CalendarMode.LUNAR) {
                    val absoluteIndex = weekIndex * 7 + dayIndex
                    val adjacent = date !in range.start..range.end
                    val adjacentAlpha = lunarAdjacentAlpha(absoluteIndex, leading,
                        range.dates().size, days.size)
                    LunarCalendarDay(calendar, date, date == selected, onChoose, Modifier.weight(1f),
                        if (experimental && !adjacent) tasksByDate[date.toString()].orEmpty().size else 0,
                        adjacent, adjacentAlpha, onOpenTaskList,
                        if (experimental) solarLocation else null,
                        completedTaskCount = if (experimental && !adjacent) tasksByDate[date.toString()].orEmpty().count { it.done } else 0)
                } else CalendarDay(calendar, date,
                    if (mode == CalendarMode.LUNAR) calendar.lunarDate(date).day else date.dayOfMonth,
                    null, calendar.formatDate(date, mode), date == selected, onChoose, Modifier.weight(1f),
                    if (experimental) calendar.moonInfo(date) else null,
                    if (experimental && mode != CalendarMode.PROFANE) calendar.sacredDate(date).let { "${it.day} · ${SacredCatalog.months[it.monthIndex].name}" } else null,
                    if (experimental && date in range.start..range.end) tasksByDate[date.toString()].orEmpty().size else 0,
                    if (experimental && LocalSacredFeaturesEnabled.current) calendar.solarEvent(date) else null,
                    patron = if (mode == CalendarMode.PROFANE) weekdayPatronMark(date) else null,
                    adjacent = mode == CalendarMode.PROFANE && date !in range.start..range.end,
                    onTaskBadgeClick = onOpenTaskList,
                    completedTaskCount = if (experimental && date in range.start..range.end)
                        tasksByDate[date.toString()].orEmpty().count { it.done } else 0)
            }
            repeat(7 - week.size) { Spacer(Modifier.weight(1f)) }
        }
    }
}

@Composable
private fun LunarDecadeGrid(calendar: GenesisCalendar, range: CalendarRange,
    selected: LocalDate, onChoose: (LocalDate) -> Unit, experimental: Boolean,
    tasksByDate: Map<String, List<LocalTask>>, onOpenTaskList: (LocalDate) -> Unit,
    solarLocation: SolarLocation) {
    val english = LocalGenesisLanguage.current == "en"
    range.dates().chunked(10).forEachIndexed { decadeIndex, decade ->
        Text(if(english) listOf("Growth", "Fullness", "Waning")[decadeIndex]
            else listOf("Декада Роста", "Декада Полноты", "Декада Исхода")[decadeIndex],
            modifier=Modifier.testTag("lunar-decade-${decadeIndex + 1}"),
            style=MaterialTheme.typography.titleSmall,color=MaterialTheme.colorScheme.primary)
        decade.chunked(5).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement=Arrangement.spacedBy(2.dp)) {
                row.forEach { day ->
                    val dayTasks=if(experimental) tasksByDate[day.toString()].orEmpty() else emptyList()
                    LunarCalendarDay(calendar,day,day==selected,onChoose,Modifier.weight(1f),
                        dayTasks.size,false,1f,onOpenTaskList,
                        if(experimental) solarLocation else null,
                        completedTaskCount=dayTasks.count { it.done })
                }
                repeat(5-row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

internal fun weekLeadingOffset(date: LocalDate, mode: CalendarMode,
    weekStartsOnSunday: Boolean = true): Int =
    if (mode == CalendarMode.PROFANE && weekStartsOnSunday) date.dayOfWeek.value % 7
    else date.dayOfWeek.value - 1

/** Gregorian rows include the previous/next month's dates as read-only, fading context. */
internal fun gregorianGridDates(range: CalendarRange, weekStartsOnSunday: Boolean = true): List<LocalDate> {
    val leading = weekLeadingOffset(range.start, CalendarMode.PROFANE, weekStartsOnSunday)
    val trailing = (7 - (leading + range.dates().size) % 7) % 7
    return (leading downTo 1).map { range.start.minusDays(it.toLong()) } + range.dates() +
        (1..trailing).map { range.end.plusDays(it.toLong()) }
}

/** Lunar rows are symmetrical: both neighbouring months are read-only fading context. */
internal fun lunarGridDates(range: CalendarRange): List<LocalDate> {
    val leading = weekLeadingOffset(range.start, CalendarMode.LUNAR)
    val trailing = (7 - (leading + range.dates().size) % 7) % 7
    return (leading downTo 1).map { range.start.minusDays(it.toLong()) } + range.dates() +
        (1..trailing).map { range.end.plusDays(it.toLong()) }
}

internal fun lunarAdjacentAlpha(index: Int, leading: Int, currentDays: Int, totalDays: Int): Float {
    val firstCurrent = leading
    val firstTrailing = leading + currentDays
    return when {
        index in firstCurrent until firstTrailing -> 1f
        index < firstCurrent && leading > 0 ->
            (0.18f + 0.28f * ((index + 1f) / leading.toFloat())).coerceIn(.18f, .46f)
        index >= firstTrailing -> {
            val trailing = (totalDays - firstTrailing).coerceAtLeast(1)
            val position = index - firstTrailing
            (0.46f - 0.28f * ((position + 1f) / trailing.toFloat())).coerceIn(.18f, .46f)
        }
        else -> 1f
    }
}

internal fun genesisRoman(value: Int): String {
    require(value in 1..3999)
    var rest = value
    val output = StringBuilder()
    listOf(1000 to "M", 900 to "CM", 500 to "D", 400 to "CD", 100 to "C", 90 to "XC",
        50 to "L", 40 to "XL", 10 to "X", 9 to "VIIII", 5 to "V", 4 to "IIII", 1 to "I")
        .forEach { (amount, symbol) -> while (rest >= amount) { output.append(symbol); rest -= amount } }
    return output.toString()
}

private val genesisMonthRomans = listOf(
    "I", "II", "III", "IIII", "V", "VI", "VII", "VIII", "VIIII", "X", "XI", "XII", "O",
)

internal fun lunarSacredDateLabel(sacredDay: Int, pyata: Int, monthIndex: Int): String {
    require(sacredDay in 1..30 && monthIndex in genesisMonthRomans.indices &&
        (pyata in 1..6 || (monthIndex == 12 && pyata == 0)))
    // Apeiron stands outside the pentads; its real catalog uses pyata = 0.
    if (monthIndex == 12 && pyata == 0) return "${genesisRoman(sacredDay)}/O"
    val dayInsidePyata = (sacredDay - 1) % 5 + 1
    return "${genesisRoman(dayInsidePyata)}/$pyata/${genesisMonthRomans[monthIndex]}"
}

@Composable
internal fun LunarCalendarDay(calendar: GenesisCalendar, date: LocalDate, selected: Boolean,
    onChoose: (LocalDate) -> Unit, modifier: Modifier, taskCount: Int, adjacent: Boolean,
    adjacentAlpha: Float, onTaskBadgeClick: (LocalDate) -> Unit, solarLocation: SolarLocation?,
    completedTaskCount: Int = 0) {
    val lunar = calendar.lunarDate(date)
    val moon = calendar.moonInfo(date)
    val locale = Locale.forLanguageTag(LocalGenesisLanguage.current)
    val weekday = date.dayOfWeek.getDisplayName(TextStyle.SHORT, locale).removeSuffix(".")
    val gregorian = date.format(DateTimeFormatter.ofPattern(if (LocalGenesisLanguage.current == "en") "d MMM" else "d MMM", locale))
    val description = genesisTranslate("${lunar.day} лунный день · ${moon.phase} · $gregorian · $weekday" +
        (if (adjacent) " · Другой месяц, только просмотр" else ""))
    Surface(onClick = { onChoose(date) }, enabled = !adjacent,
        modifier = modifier.heightIn(min = 72.dp)
            .then(if (adjacent) Modifier.alpha(adjacentAlpha) else Modifier)
            .semantics { contentDescription = description; this.selected = selected }.testTag("calendar-day-$date"),
        shape = MaterialTheme.shapes.medium,
        color = selectedControlContainer(selected, !adjacent, MaterialTheme.colorScheme.surface),
        border = selectedControlBorder(selected, !adjacent, fallback = BorderStroke(if (selected || !adjacent && date == LocalDate.now()) 2.dp else 1.dp,
            if (selected || !adjacent && date == LocalDate.now()) MaterialTheme.colorScheme.primary
            else MaterialTheme.colorScheme.secondary.copy(alpha = if (LocalEveningTheme.current) .65f else .5f)))) {
        Box(Modifier.fillMaxWidth().padding(3.dp)) {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.Start,
                verticalArrangement = Arrangement.spacedBy(2.dp)) {
                androidx.compose.foundation.text.BasicText(lunar.day.toString(), Modifier.fillMaxWidth().padding(end = 18.dp),
                    style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp, lineHeight = 18.sp, color = MaterialTheme.colorScheme.onSurface),
                    maxLines = 1, autoSize = TextAutoSize.StepBased(minFontSize = 12.sp, maxFontSize = 14.sp))
                MoonPhaseIcon(moon.phaseStep, size = 18.dp)
                Text(gregorian, fontSize = 9.sp, lineHeight = 10.sp, maxLines = 1)
                Text(weekday, fontSize = 9.sp, lineHeight = 10.sp, maxLines = 1,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            CalendarMonthTaskRail(date, if (adjacent) 0 else taskCount, completedTaskCount, !adjacent,
                onTaskBadgeClick)
        }
    }
}

@Composable
internal fun CalendarDay(calendar: GenesisCalendar, date: LocalDate, number: Int, sublabel: String?, fullName: String,
    selected: Boolean, onChoose: (LocalDate) -> Unit, modifier: Modifier,
    moon: MoonInfo?, crossDate: String?, taskCount: Int, solar: SolarEvent?,
    patron: WeekdayPatronMark? = null, adjacent: Boolean = false,
    onTaskBadgeClick: (LocalDate) -> Unit = {},
    completedTaskCount: Int = 0) {
    val palette = patron
    val civil = !LocalSacredFeaturesEnabled.current
    val patron = patron.takeIf { LocalSacredFeaturesEnabled.current }
    val crossDate = crossDate.takeIf { LocalSacredFeaturesEnabled.current }
    val moon = moon.takeIf { LocalSacredFeaturesEnabled.current }
    val today = !adjacent && date == LocalDate.now()
    val locale = Locale.forLanguageTag(LocalGenesisLanguage.current)
    val dayDescription = genesisTranslate("$number · $fullName · ${date.format(dateLabel(locale))}" +
        (patron?.let { " · ${it.symbol} ${it.patrons}" } ?: "") +
        (moon?.let { " · ${it.day} лунный день · ${it.phase}, ${it.illumination}%" } ?: "") +
        (if (taskCount > 0) " · $taskCount задач" else "") +
        (solar?.let { " · ${it.name}" } ?: "") +
        (if (adjacent) " · Другой месяц, только просмотр" else ""))
    val foreground = if (selected && palette != null) palette.selectedForeground else
        if (palette != null && !LocalEveningTheme.current) Color(0xff132426) else MaterialTheme.colorScheme.onSurface
    CompositionLocalProvider(LocalPreserveCalendarColors provides (palette != null)) {
    Surface(onClick = { onChoose(date) }, enabled = !adjacent,
        modifier = modifier.heightIn(min = if (civil || crossDate != null) 72.dp else 60.dp)
        .then(if (adjacent) Modifier.alpha(0.42f) else Modifier)
        .semantics { contentDescription = dayDescription; this.selected = selected }
        .testTag("calendar-day-$date"),
        shape = MaterialTheme.shapes.medium,
        color = when {
            adjacent -> MaterialTheme.colorScheme.surface
            selected && palette != null -> palette.selectedBackground
            selected -> selectedControlContainer(true, !adjacent)
            palette != null -> if(LocalEveningTheme.current) weekdayEveningWash(date) else palette.wash
            else -> MaterialTheme.colorScheme.surface
        },
        border = selectedControlBorder(selected, !adjacent, fallback = BorderStroke(if (today || selected) 2.dp else 1.dp,
            if (today || selected) palette?.accent ?: MaterialTheme.colorScheme.primary
            else MaterialTheme.colorScheme.secondary.copy(alpha = if (LocalEveningTheme.current) .65f else .5f)),
            background = if (selected && palette != null) palette.selectedBackground else null)) {
        Box(Modifier.fillMaxWidth().padding(3.dp)) {
            Column(Modifier.fillMaxWidth()) {
                androidx.compose.foundation.text.BasicText(number.toString(), Modifier.fillMaxWidth()
                    .heightIn(min = if (civil) 24.dp else 0.dp).padding(end = if (civil) 24.dp else 18.dp),
                    style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp, lineHeight = 20.sp, color = foreground),
                    maxLines = 1, autoSize = TextAutoSize.StepBased(minFontSize = 12.sp, maxFontSize = 14.sp))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(1.dp)) {
                        Text(if (adjacent) date.month.getDisplayName(TextStyle.SHORT_STANDALONE, locale)
                            else sublabel ?: date.dayOfWeek.getDisplayName(TextStyle.SHORT, locale),
                            fontSize = 10.sp, lineHeight = 14.sp, maxLines = 1, color = foreground)
                        solar?.let { Text(it.symbol, fontSize = 8.sp, lineHeight = 14.sp, maxLines = 1, color = foreground) }
                    }
                    patron?.let { Text(it.symbol, fontSize = 12.sp, lineHeight = 14.sp, maxLines = 1,
                        modifier = Modifier.testTag("calendar-patron-$date"), color = if(selected || LocalEveningTheme.current) foreground else it.accent) }
                }
                if (moon != null) {
                    Row(Modifier.padding(end = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                        MoonPhaseIcon(moon.phaseStep, size = if (crossDate != null) 12.dp else 10.dp)
                        androidx.compose.foundation.text.BasicText(moon.day.toString(), Modifier.weight(1f),
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp, lineHeight = 18.sp, color = foreground),
                            maxLines = 1, autoSize = TextAutoSize.StepBased(minFontSize = 7.sp, maxFontSize = 9.sp))
                    }
                }
                if (crossDate != null) Text(crossDate, fontSize = 10.sp, lineHeight = 14.sp,
                    maxLines = 1, color = if (selected && patron != null) foreground else MaterialTheme.colorScheme.onSurfaceVariant)
            }
            CalendarMonthTaskRail(date, if (adjacent) 0 else taskCount, completedTaskCount, !adjacent,
                onTaskBadgeClick)
        }
    }
    }
}

@Composable
private fun CalendarPersonalCountDisc(total: Int, completed: Int, size: androidx.compose.ui.unit.Dp,
    modifier: Modifier = Modifier) {
    val done = completed.coerceIn(0, total)
    val openColor = if (LocalEveningTheme.current) Color(0xffd64a54) else calendarIncompleteColor
    val doneColor = if (LocalEveningTheme.current) Color(0xff287a57) else calendarCompletedColor
    val description = "${genesisTranslate("Не выполнено")}: ${total - done}. ${genesisTranslate("Выполнено")}: $done"
    CompositionLocalProvider(LocalPreserveCalendarColors provides true) {
        Surface(modifier.size(size).semantics { contentDescription = description }, shape = CircleShape,
            color = Color.Transparent, shadowElevation = if (size > 18.dp) 3.dp else 0.dp) {
            Box(contentAlignment = Alignment.Center) {
                androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
                    drawCircle(openColor)
                    if (done > 0) drawArc(doneColor, -90f, 360f * done / total, useCenter = true)
                }
                Text(if (total > 99) "99+" else total.toString(), color = Color.White,
                    fontSize = if (total > 99) 7.sp else if (size > 18.dp) 12.sp else 9.sp, lineHeight = 14.sp, maxLines = 1)
            }
        }
    }
}

@Composable
private fun BoxScope.CalendarMonthTaskRail(date: LocalDate, total: Int, completed: Int, enabled: Boolean,
    onTasks: (LocalDate) -> Unit) {
    val shared = if (enabled) LocalSharedCalendarCounts.current[date.toString()] ?: 0 else 0
    if (total == 0 && shared == 0) return
    val openShared = LocalOpenSharedCalendarDay.current
    val locale = Locale.forLanguageTag(LocalGenesisLanguage.current)
    val taskDescription = genesisTranslate("$total задач на ${date.format(dateLabel(locale))}. Открыть список.")
    val discSize = if (LocalSacredFeaturesEnabled.current) 18.dp else 24.dp
    // An overlay keeps both anchors independent without contributing to the cell's measured size.
    Box(Modifier.matchParentSize()) {
        if (total > 0) Box(Modifier.align(Alignment.TopEnd).width(discSize).heightIn(min = 48.dp)
            .testTag("calendar-task-count-$date").clickable { onTasks(date) }
            .semantics { contentDescription = taskDescription }) {
            CalendarPersonalCountDisc(total, completed, discSize, Modifier.testTag("calendar-task-count-disc-$date"))
        }
        if (shared > 0) SharedTaskCountDisc(shared, "$shared ${genesisTranslate("общих задач")}",
            Modifier.align(Alignment.BottomEnd).testTag("calendar-shared-count-$date")
                .clickable { openShared(date) }, discSize, elevated = discSize > 18.dp)
    }
}

@Composable
private fun CalendarSharedBadge(date: LocalDate, modifier: Modifier = Modifier) {
    val count = LocalSharedCalendarCounts.current[date.toString()] ?: 0
    if (count == 0) return
    val openShared = LocalOpenSharedCalendarDay.current
    val label = if (LocalGenesisLanguage.current == "en") "shared tasks" else "общих задач"
    SharedTaskCountDisc(count, "$count $label", modifier.padding(3.dp).testTag("calendar-shared-count-$date").clickable { openShared(date) })
}

@Composable
private fun SharedTaskCountDisc(count: Int, description: String, modifier: Modifier = Modifier,
    size: androidx.compose.ui.unit.Dp = 23.dp, elevated: Boolean = false) {
    val evening = LocalEveningTheme.current
    CompositionLocalProvider(LocalPreserveCalendarColors provides true) {
    Surface(modifier.size(size).semantics { contentDescription = description },
        shape = CircleShape, color = if (evening) Color(0xffc4a4ef) else Color(0xff7350a2), shadowElevation = if (elevated) 3.dp else 0.dp) {
        Box(contentAlignment = Alignment.Center) {
            Text(if (count > 99) "99+" else count.toString(),
                color = if (evening) Color(0xff241335) else Color.White,
                fontSize = if (count > 99) 7.sp else if (elevated) 12.sp else 9.sp, lineHeight = 14.sp, maxLines = 1)
        }
    }
    }
}

@Composable
private fun CalendarTaskBadge(date: LocalDate, total: Int, completed: Int, size: androidx.compose.ui.unit.Dp,
    modifier: Modifier, alignment: Alignment, onClick: (LocalDate) -> Unit) {
    val locale = Locale.forLanguageTag(LocalGenesisLanguage.current)
    val description = genesisTranslate("$total задач на ${date.format(dateLabel(locale))}. Открыть список.")
    Box(modifier.size(48.dp).testTag("calendar-task-count-$date")
        .clickable { onClick(date) }.semantics { contentDescription = description }) {
        CalendarTaskStatusDiscs(total, completed, size, "calendar-task", date.toString(),
            Modifier.align(alignment).padding(1.dp))
    }
}

@Composable
private fun CalendarTaskStatusDiscs(total: Int, completed: Int, size: androidx.compose.ui.unit.Dp,
    prefix: String, key: String, modifier: Modifier = Modifier) {
    val counts = listOf(false to total - completed, true to completed).filter { it.second > 0 }
    val discSize = if (counts.size > 1) 20.dp else size
    CompositionLocalProvider(LocalPreserveCalendarColors provides true) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        counts.forEachIndexed { index, (done, count) ->
            val status = if (done) "done" else "open"
            val stateLabel = genesisTranslate(if (done) "Выполнено" else "Не выполнено")
            Box(if (index == 0) Modifier.testTag("$prefix-count-disc-$key") else Modifier) {
                Surface(Modifier.size(discSize).testTag("$prefix-$status-count-$key")
                    .semantics { contentDescription = "$stateLabel: $count" }, shape = CircleShape,
                    color = if (LocalEveningTheme.current) {
                        if (done) Color(0xff287a57) else Color(0xffd64a54)
                    } else if (done) calendarCompletedColor else calendarIncompleteColor, shadowElevation = 3.dp) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(if (count > 99) "99+" else count.toString(), color = Color.White,
                            fontSize = if (counts.size > 1 || count > 99) 8.sp else 12.sp, maxLines = 1)
                    }
                }
            }
        }
    }
    }
}

@Composable
private fun CalendarTaskListDialog(date: LocalDate, tasks: List<LocalTask>, use24: Boolean,
    onDismiss: () -> Unit, onComplete: (LocalTask) -> Unit, onEdit: (LocalTask) -> Unit,
    onDelete: (LocalTask) -> Unit, onDeleteOccurrence: ((LocalTask) -> Unit)?, onOpenDay: () -> Unit) {
    val locale = Locale.forLanguageTag(LocalGenesisLanguage.current)
    var deletingId by rememberSaveable(date) { mutableStateOf<String?>(null) }
    Dialog(onDismissRequest = onDismiss) {
        Surface(Modifier.fillMaxWidth().heightIn(max = 560.dp).testTag("calendar-task-list-dialog"),
            shape = AffairsLayout.shape, color = Color(0xfffffbf2),
            border = BorderStroke(1.dp, Color(0x66b28a4a)), shadowElevation = 18.dp) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CalendarTaskStatusDiscs(tasks.size, tasks.count { it.done }, 44.dp,
                        "calendar-dialog-task", date.toString())
                    Column(Modifier.weight(1f)) {
                        Text("Задачи дня", style = MaterialTheme.typography.titleLarge)
                        Text(date.format(dateLabel(locale)), style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    AffairsIconButton("Закрыть", AffairsAction.CLOSE, onDismiss)
                }
                HorizontalDivider(color = Color(0x44b28a4a))
                LazyColumn(Modifier.weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (tasks.isEmpty()) item {
                        Text("На этот день задач больше нет.", Modifier.padding(vertical = 12.dp),
                            style = MaterialTheme.typography.bodyMedium)
                    }
                    items(tasks, key = { it.id }) { task ->
                        val completionDescription = genesisTranslate(if (task.done)
                            "Вернуть в работу" else "Выполнить задачу") + ": " + task.title
                        Surface(Modifier.fillMaxWidth().testTag("calendar-task-${task.id}"), shape = AffairsLayout.shape,
                            color = if (task.done) completedTaskSurface else Color(0xfff4ecdc)) {
                            Column {
                            Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 12.dp, top = 8.dp),
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                                verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(checked = task.done, onCheckedChange = { onComplete(task) },
                                    modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                                        .testTag("calendar-task-complete-${task.id}").semantics {
                                            contentDescription = completionDescription
                                        })
                                Column(Modifier.weight(1f)) {
                                    TaskTitle(task,
                                        style = MaterialTheme.typography.titleSmall, maxLines = 2,
                                        color = if (task.done) calendarCompletedColor else calendarIncompleteColor,
                                        occurrenceDate = date)
                                    Text(listOfNotNull(task.time.takeIf { it.isNotBlank() }?.let { timeLabel(it, use24) },
                                        task.project.takeIf { it.isNotBlank() }).joinToString(" · ").ifBlank { "Без времени" },
                                        style = MaterialTheme.typography.bodySmall,
                                         color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(if (task.done) "Выполнено" else "Выполнить задачу",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = if (task.done) calendarCompletedColor else calendarIncompleteColor)
                                }
                            }
                            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TextButton(onClick = { onEdit(task) }, modifier = Modifier.weight(1f)
                                    .heightIn(min = 48.dp).testTag("calendar-task-edit-${task.id}")) {
                                    Text("Редактировать")
                                }
                                TextButton(onClick = { deletingId = task.id }, modifier = Modifier.weight(1f)
                                    .heightIn(min = 48.dp).testTag("calendar-task-delete-${task.id}"),
                                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
                                    Text("Удалить")
                                }
                            }
                            }
                        }
                    }
                }
                Button(onClick = onOpenDay,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("calendar-dialog-show-day")) {
                    Text("Показать день в календаре")
                }
            }
        }
    }
    tasks.firstOrNull { it.id == deletingId }?.let { task ->
        val recurring = task.recurrence.enabled && onDeleteOccurrence != null
        AlertDialog(onDismissRequest = { deletingId = null },
            title = { Text(if (recurring) "Удалить повторение?" else "Удалить задачу?") },
            text = { Text(if (recurring) "Можно удалить только ${date} или всю серию."
                else "Напоминание этой задачи будет отменено.") },
            confirmButton = { if (recurring) DialogActionRow(
                DialogIconAction("Отмена", AffairsAction.BACK, { deletingId = null }),
                DialogIconAction("Только этот день", AffairsAction.CALENDAR,
                    { onDeleteOccurrence?.invoke(task); deletingId = null }, destructive = true,
                    modifier = Modifier.testTag("calendar-delete-occurrence")),
                DialogIconAction("Вся серия", AffairsAction.DELETE, { onDelete(task); deletingId = null },
                    destructive = true, modifier = Modifier.testTag("calendar-delete-confirm"))
            ) else TextButton(onClick = { onDelete(task); deletingId = null },
                        modifier = Modifier.heightIn(min = 48.dp).testTag("calendar-delete-confirm")) {
                        Text("Удалить")
                    }
            },
            dismissButton = if (recurring) null else ({ TextButton(onClick = { deletingId = null },
                modifier = Modifier.heightIn(min = 48.dp)) { Text("Отмена") } }))
    }
}

@Composable
private fun SelectedDayCard(calendar: GenesisCalendar, date: LocalDate, mode: CalendarMode,
    experimental: Boolean, solarLocation: SolarLocation) {
    if (experimental) {
        ExperimentalSelectedDayCard(calendar, date, mode, solarLocation)
        return
    }
    val sacred = calendar.sacredDate(date)
    val month = SacredCatalog.months[sacred.monthIndex]
    val day = month.days[sacred.day - 1]
    val locale = Locale.forLanguageTag(LocalGenesisLanguage.current)
    val weekday = if (mode == CalendarMode.PROFANE && LocalSacredFeaturesEnabled.current) todayHeroCopy(date, mode, calendar,
        LocalGenesisLanguage.current) else null
    Card(Modifier.fillMaxWidth().testTag("calendar-selected-day")) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            weekday?.let { OriginalImage(it.imagePath, "Иллюстрация дня недели: ${it.title}",
                Modifier.fillMaxWidth().height(196.dp).testTag("calendar-weekday-art")) }
            if (experimental && mode == CalendarMode.SACRED) OriginalImage("day-art-v1/month-${(sacred.monthIndex + 1).toString().padStart(2, '0')}/day-${sacred.day.toString().padStart(2, '0')}.webp",
                "Иллюстрация дня ${day.name}", Modifier.fillMaxWidth().height(136.dp))
            Text(when (mode) {
                CalendarMode.PROFANE -> "ГРИГОРИАНСКИЙ ДЕНЬ"
                CalendarMode.LUNAR -> "ЛУННЫЙ ДЕНЬ"
                CalendarMode.SACRED -> "САКРАЛЬНЫЙ ДЕНЬ"
            }, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            Text(when (mode) {
                CalendarMode.PROFANE -> date.format(DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy", locale))
                    .replaceFirstChar { it.titlecase(locale) }
                CalendarMode.LUNAR -> calendar.lunarDate(date).let { "${it.day} · ${it.month.name}" }
                CalendarMode.SACRED -> "${sacred.day} · ${month.name}"
            }, style = MaterialTheme.typography.titleLarge, modifier = Modifier.testTag("calendar-selected-primary-date"))
            if (mode == CalendarMode.PROFANE && LocalSacredFeaturesEnabled.current) {
                val patron = weekdayPatronMark(date)
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.testTag("calendar-selected-patron")) {
                    Text(patron.symbol, style = MaterialTheme.typography.headlineMedium, color = patron.accent)
                    Column {
                        Text(patron.guidance, style = MaterialTheme.typography.titleSmall, color = patron.accent)
                        Text(patron.patrons, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            weekday?.let {
                Text(it.description, style = MaterialTheme.typography.titleMedium)
                it.details.forEach { detail -> Text(detail, style = MaterialTheme.typography.bodySmall) }
            }
            if (mode != CalendarMode.PROFANE) Text(date.format(dateLabel(locale)), style = MaterialTheme.typography.labelMedium)
            if (mode == CalendarMode.SACRED) {
                Text(day.name, style = MaterialTheme.typography.titleSmall)
                Text(day.description, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun ExperimentalSelectedDayCard(calendar: GenesisCalendar, date: LocalDate, mode: CalendarMode,
    solarLocation: SolarLocation) {
    if (!LocalSacredFeaturesEnabled.current) {
        val locale = Locale.forLanguageTag(LocalGenesisLanguage.current)
        Card(Modifier.fillMaxWidth().testTag("calendar-selected-day"), shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("ГРИГОРИАНСКИЙ ДЕНЬ", style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary)
                Text(date.format(DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy", locale))
                    .replaceFirstChar { it.titlecase(locale) }, style = MaterialTheme.typography.headlineSmall,
                    modifier = Modifier.testTag("calendar-selected-primary-date"))
            }
        }
        return
    }
    val sacred = calendar.sacredDate(date)
    val month = SacredCatalog.months[sacred.monthIndex]
    val day = month.days[sacred.day - 1]
    val lunar = calendar.lunarDate(date)
    val locale = Locale.forLanguageTag(LocalGenesisLanguage.current)
    val weekday = if (mode == CalendarMode.PROFANE) todayHeroCopy(date, mode, calendar,
        LocalGenesisLanguage.current) else null
    val primaryDate = when (mode) {
        CalendarMode.PROFANE -> date.format(DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy", locale))
            .replaceFirstChar { it.titlecase(locale) }
        CalendarMode.LUNAR -> "${lunar.day} · ${lunar.month.name}"
        CalendarMode.SACRED -> "${sacred.day} · ${month.name}"
    }
    val modeTitle = when (mode) {
        CalendarMode.PROFANE -> "ГРИГОРИАНСКИЙ ДЕНЬ"
        CalendarMode.LUNAR -> "ЛУННЫЙ ДЕНЬ"
        CalendarMode.SACRED -> "САКРАЛЬНЫЙ ДЕНЬ"
    }
    val moon = if(mode==CalendarMode.LUNAR) calendar.moonInfo(date) else null
    val heroPath = when(mode) {
        CalendarMode.LUNAR -> lunarPatronForDay(moon!!.day).artPath
        CalendarMode.PROFANE -> weekday!!.imagePath
        CalendarMode.SACRED -> "day-art-v1/month-${(sacred.monthIndex + 1).toString().padStart(2, '0')}/day-${sacred.day.toString().padStart(2, '0')}.webp"
    }
    val heroTitle = when(mode) {
        CalendarMode.LUNAR -> "${moon!!.day} лунный день · ${moon.epithet}"
        CalendarMode.PROFANE -> weekday!!.title
        CalendarMode.SACRED -> day.name
    }
    val heroDescription = when(mode) {
        CalendarMode.LUNAR -> "${moon!!.direction} · ${moon.phase} · освещённость ${moon.illumination}%. " +
            "${lunar.month.name} · ${lunar.decade}${if(lunar.isThreshold) " · Рубеж" else ""}. ${lunar.month.description}"
        CalendarMode.PROFANE -> weekday!!.description
        CalendarMode.SACRED -> day.description
    }
    val lightHero = !LocalEveningTheme.current
    val heroInk = if (!lightHero && mode == CalendarMode.PROFANE) Color(0xfff9f2e2) else MaterialTheme.colorScheme.onSurface
    val heroSecondary = if (lightHero) MaterialTheme.colorScheme.onSurface else if (mode == CalendarMode.PROFANE) Color(0xffeee6d7) else MaterialTheme.colorScheme.onSurfaceVariant
    val heroAccent = if (!lightHero && mode == CalendarMode.PROFANE) Color(0xffdfc17e) else MaterialTheme.colorScheme.primary
    Card(Modifier.fillMaxWidth().testTag("calendar-selected-day"), shape = RoundedCornerShape(20.dp),
        border = BorderStroke(1.dp, Color(0x66dfc17e)),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
            Box(Modifier.fillMaxWidth().height(calendarDayHeroHeight(mode)).testTag("calendar-day-hero")) {
                OriginalImage(heroPath, heroTitle, Modifier.matchParentSize().testTag("calendar-weekday-art"),
                    lightThemeBrightness=1f)
                CalendarHeroContrast(Modifier.matchParentSize(), mode != CalendarMode.PROFANE)
                Column(Modifier.fillMaxSize().padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(modeTitle, style = MaterialTheme.typography.labelMedium, color = heroAccent, maxLines = 1)
                    Text(primaryDate, style = MaterialTheme.typography.headlineSmall.copy(lineHeight = 1.1.em),
                        color = heroInk, modifier = Modifier.heightIn(max = 62.dp).testTag("calendar-selected-primary-date"),
                        maxLines = 2, autoSize = CalendarHeroTextAutoSize(MaterialTheme.typography.headlineSmall.fontSize))
                    if (mode == CalendarMode.PROFANE) {
                        Column(Modifier.weight(1f).testTag("calendar-selected-gregorian"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("${date.dayOfYear}-й из ${date.lengthOfYear()} дней года · ${date.lengthOfMonth()} дней в месяце",
                                style = MaterialTheme.typography.bodySmall, color = heroSecondary)
                            SunriseSunsetLine(date, solarLocation, calendar, heroAccent, heroSecondary)
                            calendar.solarEvent(date)?.let { event ->
                                Text("${event.symbol} ${event.name} · ${event.instant.atZone(calendar.zoneId).format(DateTimeFormatter.ofPattern("HH:mm z", locale))}",
                                    style = MaterialTheme.typography.labelMedium, color = heroAccent)
                            }
                        }
                    } else {
                        Text(heroTitle, Modifier.heightIn(max = 40.dp), style = MaterialTheme.typography.titleMedium.copy(lineHeight = 1.15.em),
                            color = heroInk, maxLines = 2, autoSize = CalendarHeroTextAutoSize(MaterialTheme.typography.titleMedium.fontSize))
                        Text(heroDescription, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium.copy(lineHeight = 1.25.em),
                            color = heroSecondary, autoSize = CalendarHeroTextAutoSize(MaterialTheme.typography.bodyMedium.fontSize))
                    }
                    moon?.event?.takeIf { it.isNotBlank() }?.let { event ->
                        Text(event, Modifier.heightIn(max = 30.dp), style=MaterialTheme.typography.labelMedium.copy(lineHeight = 1.15.em),
                            color=heroAccent, maxLines = 2, autoSize = CalendarHeroTextAutoSize(MaterialTheme.typography.labelMedium.fontSize))
                    }
                }
            }
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (mode == CalendarMode.PROFANE && LocalSacredFeaturesEnabled.current) {
                    val patron = weekdayPatronMark(date)
                    Row(Modifier.fillMaxWidth().testTag("calendar-selected-patron"), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(patron.symbol, style = MaterialTheme.typography.headlineMedium, color = patron.accent)
                        Column {
                            Text(patron.guidance, style = MaterialTheme.typography.titleSmall, color = patron.accent)
                            Text(patron.patrons, style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurface)
                        }
                    }
                    weekday?.details?.forEach { detail ->
                        Text(detail, style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } else Text(date.format(dateLabel(locale)), style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary)

                CalendarSelectedDayFacts(date, calendar, solarLocation, mode)
            }
        }
    }
}

@Composable
private fun CalendarYearOverview(calendar: GenesisCalendar, shown: LocalDate, mode: CalendarMode,
    onModeChange: (CalendarMode) -> Unit,
    experimental: Boolean, tasks: List<LocalTask>,
    gregorianYearStartsInMarch: Boolean, regionalSeasonArt: Boolean, seasonRegionZone: ZoneId,
    onStartGregorianYearInMarch: () -> Unit,
    voiceScrollToken: Int, voiceScrollDirection: String,
    onMonth: (LocalDate) -> Unit, onDay: (LocalDate) -> Unit, onYear: (LocalDate) -> Unit,
    onTasks: (LocalDate, Boolean) -> Unit) {
    val period = if (mode == CalendarMode.PROFANE) LocalDate.of(
        shown.year - if (gregorianYearStartsInMarch && shown.monthValue < 3) 1 else 0,
        if (gregorianYearStartsInMarch) 3 else 1, 1)
        else calendar.yearRange(shown, mode).start
    val context = LocalContext.current
    val suggestionPrefs = remember(context) { context.getSharedPreferences("genesis.calendar-suggestions", android.content.Context.MODE_PRIVATE) }
    var springSuggestionDismissed by remember { mutableStateOf(suggestionPrefs.getBoolean("spring-year-dismissed", false)) }
    Box(Modifier.fillMaxSize().padding(horizontal = 8.dp)) {
        CalendarPeriodPager(period,
            runCatching { calendar.shiftYear(period, mode, -1) }.getOrNull()?.takeIf { calendar.yearRange(it,mode).end.year >= 1900 },
            runCatching { calendar.shiftYear(period, mode, 1) }.getOrNull()?.takeIf { it.year <= 2100 },
            { onYear(calendar.shiftYear(period, mode, -1)) }, { onYear(calendar.shiftYear(period, mode, 1)) },
            Modifier.fillMaxSize(), fillHeight = true) { page, previous, next ->
            CalendarYearPanel(calendar, page, mode, onModeChange, experimental, tasks,
                gregorianYearStartsInMarch, regionalSeasonArt, seasonRegionZone,
                springSuggestionDismissed, onStartGregorianYearInMarch,
                { springSuggestionDismissed = true; suggestionPrefs.edit().putBoolean("spring-year-dismissed", true).apply() },
                onMonth, onDay, onTasks, previous, next,voiceScrollToken,voiceScrollDirection,page==period)
        }
    }
}

@Composable
private fun CalendarYearPanel(calendar: GenesisCalendar, shown: LocalDate, mode: CalendarMode,
    onModeChange: (CalendarMode) -> Unit, experimental: Boolean, tasks: List<LocalTask>,
    gregorianYearStartsInMarch: Boolean, regionalSeasonArt: Boolean, seasonRegionZone: ZoneId,
    springSuggestionDismissed: Boolean, onStartGregorianYearInMarch: () -> Unit,
    onDismissSpringSuggestion: () -> Unit,
    onMonth: (LocalDate) -> Unit, onDay: (LocalDate) -> Unit, onTasks: (LocalDate, Boolean) -> Unit,
    onPrevious: () -> Unit, onNext: () -> Unit,
    voiceScrollToken: Int, voiceScrollDirection: String, activePage: Boolean) {
    val locale = Locale.forLanguageTag(LocalGenesisLanguage.current)
    val sacredFeaturesEnabled = LocalSacredFeaturesEnabled.current
    val sacredYear = if (mode == CalendarMode.LUNAR) calendar.lunarDate(shown).year.sacredYear else calendar.sacredDate(shown).sacredYear
    val yearLabel = if (mode == CalendarMode.PROFANE && gregorianYearStartsInMarch)
        "${shown.year}–${shown.year + 1}" else if (mode == CalendarMode.PROFANE) shown.year.toString() else sacredYear.toString()
    val entries = remember(shown, mode, locale, gregorianYearStartsInMarch) { runCatching {
        when (mode) {
            CalendarMode.SACRED -> SacredCatalog.months.map { month ->
                Triple(calendar.gregorianDate(sacredYear, month.index, 1), month.name, month.title)
            }
            CalendarMode.PROFANE -> (0..11).map { offset ->
                val monthStart = shown.plusMonths(offset.toLong()).withDayOfMonth(1)
                Triple(monthStart, Month.of(monthStart.monthValue)
                    .getDisplayName(TextStyle.FULL_STANDALONE, locale).replaceFirstChar { it.titlecase(locale) }, "")
            }
            CalendarMode.LUNAR -> calendar.lunarYear(sacredYear).let { year ->
                (0 until year.monthCount).map { ordinal ->
                    Triple(calendar.lunarMonthStart(year.startMonthIndex + ordinal),
                        SacredCatalog.lunarMonths[ordinal].name, SacredCatalog.lunarMonths[ordinal].title)
                }
            }
        }
    } }
    if (entries.isFailure) {
        Column(Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            CalendarPeriodNavigation(yearLabel, true, onPrevious, onNext)
            Text("Этот год вне диапазона офлайн-календаря.", color = MaterialTheme.colorScheme.error)
        }
        return
    }
    val months = entries.getOrThrow()
    // Recurrences are expanded once per year, rather than once for every month card.
    val taskCounts = remember(tasks, months, mode) {
        val ranges = months.map { calendar.monthRange(it.first, mode) }
        val occurrences = TaskOccurrences.byDate(tasks, ranges.first().start, ranges.last().end)
        months.zip(ranges).associate { (entry, range) ->
            val monthTasks = range.dates().flatMap { occurrences[it.toString()].orEmpty() }
            entry.first to YearTaskCount(monthTasks.size, monthTasks.count { it.done })
        }
    }
    val yearSeasonGroups = remember(months, mode, seasonRegionZone) {
        if (mode == CalendarMode.SACRED) {
            months.chunked(3).mapIndexed { index, group ->
                YearSeasonGroup(when (index) {
                        0 -> GregorianSeason.SPRING
                        1 -> GregorianSeason.SUMMER
                        2 -> GregorianSeason.AUTUMN
                        3 -> GregorianSeason.WINTER
                        else -> null
                    }, group, index * 3)
            }
        } else {
        val southern = isSouthernSeasonRegion(seasonRegionZone)
        val groups = mutableListOf<Pair<GregorianSeason, MutableList<Triple<LocalDate, String, String>>>>()
        months.forEach { entry ->
            val season = seasonForGregorianMonth(entry.first.monthValue, southern)
            if (groups.lastOrNull()?.first != season) groups.add(season to mutableListOf())
            groups.last().second.add(entry)
        }
        groups.map { (season, entries) -> YearSeasonGroup(season, entries, 0) }
        }
    }
    BoxWithConstraints(Modifier.fillMaxSize().testTag("calendar-year-panel")) {
        val yearColumns = if (maxWidth >= 780.dp) 2 else 1
        val yearListState = rememberLazyListState()
        LaunchedEffect(voiceScrollToken,activePage) {
            if(voiceScrollToken>0 && activePage) {
                val target=when(voiceScrollDirection) {
                    "top" -> 0
                    "bottom" -> yearListState.layoutInfo.totalItemsCount-1
                    "up" -> yearListState.firstVisibleItemIndex-3
                    else -> yearListState.firstVisibleItemIndex+3
                }.coerceIn(0,(yearListState.layoutInfo.totalItemsCount-1).coerceAtLeast(0))
                yearListState.animateScrollToItem(target)
            }
        }
            LazyColumn(Modifier.fillMaxSize().testTag("calendar-year"), state = yearListState,
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(bottom = 12.dp)) {
                item(key = "year-navigation") {
                    Surface(Modifier.fillMaxWidth().testTag("calendar-year-navigation-card"),
                        shape = AffairsLayout.shape, color = MaterialTheme.colorScheme.surface) {
                        CalendarPeriodNavigation(yearLabel, true, onPrevious, onNext)
                    }
                }
        if (experimental && sacredFeaturesEnabled) {
            item(key = "year-solar-points") {
                var solarExpanded by rememberSaveable(shown.toString(), mode) { mutableStateOf(false) }
                val solarState = genesisTranslate(if (solarExpanded) "Развернуто" else "Свернуто")
                Card(Modifier.fillMaxWidth().testTag("calendar-year-solar-card"), shape = AffairsLayout.shape,
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest)) {
                    TextButton(onClick = { solarExpanded = !solarExpanded },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("calendar-year-solar-toggle")
                            .semantics { stateDescription = solarState },
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)) {
                        Text("Солнечные точки года", Modifier.weight(1f), style = MaterialTheme.typography.labelLarge)
                        GenesisLucideIcon(if (solarExpanded) "chevron-up" else "chevron-down", Modifier.size(20.dp))
                    }
                    if (solarExpanded) {
                        val events = remember(shown, mode, sacredYear) {
                            calendar.solarEvents(if (mode == CalendarMode.PROFANE) shown.year else sacredYear)
                        }
                        Column(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp)
                            .testTag("calendar-year-solar-points"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            events.chunked(if (yearColumns == 2) 4 else 2).forEach { pair ->
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    pair.forEach { event -> SolarPointTile(event, calendar, onDay, Modifier.weight(1f)) }
                                }
                            }
                        }
                    }
                }
            }
        }
        if (mode == CalendarMode.PROFANE || mode == CalendarMode.SACRED) {
            yearSeasonGroups.withIndex().toList().chunked(yearColumns).forEachIndexed { rowIndex, row ->
              item(key = "year-season-$rowIndex") {
              Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                row.forEach { (groupIndex, group) ->
                  val season = group.season
                  val apeiron = season == null
                  val seasonKey = season?.name?.lowercase() ?: "apeiron"
                  val prefix = if (mode == CalendarMode.SACRED) "sacred" else "gregorian"
                  val accent = if (apeiron) Color(0xffc9a5e8) else seasonAccent(season!!)
                  val headerTone = if (apeiron) Color(0xff281740) else seasonHeaderTone(season!!)
                  Box(Modifier.weight(1f)) {
                    CompositionLocalProvider(LocalPreserveCalendarColors provides true) {
                    Card(Modifier.fillMaxWidth().testTag(
                        "$prefix-season-$seasonKey${if (mode == CalendarMode.PROFANE && groupIndex > 0 && season == GregorianSeason.WINTER) "-end" else ""}"),
                        shape = RoundedCornerShape(22.dp),
                        colors = CardDefaults.cardColors(containerColor = if (apeiron) Color(0xff372452)
                            else seasonSurface(season!!).copy(alpha = if (LocalEveningTheme.current) .22f else .78f)),
                        border = BorderStroke(1.dp, accent.copy(alpha = .48f))) {
                        Box {
                        OriginalImage(if (apeiron) "gregorian-seasons/apeiron.png"
                            else gregorianSeasonArtPath(seasonKey, seasonRegionZone, regionalSeasonArt), null,
                            Modifier.matchParentSize().alpha(if (apeiron) .76f else if (LocalEveningTheme.current) .78f else .39f)
                                .testTag("$prefix-season-art-$seasonKey"), darkThemeBrightness = .82f)
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Box(Modifier.fillMaxWidth().height(56.dp).background(
                                Brush.verticalGradient(listOf(
                                    headerTone.copy(alpha = .97f),
                                    headerTone.copy(alpha = .80f),
                                    headerTone.copy(alpha = .37f),
                                    headerTone.copy(alpha = 0f))))) {
                            Text(if (apeiron) {
                                if (LocalGenesisLanguage.current == "en") "Timelessness" else "Безвременье"
                            } else if (LocalGenesisLanguage.current == "en") season!!.englishTitle else season!!.title,
                                Modifier.padding(start = 18.dp, top = 16.dp)
                                    .testTag("$prefix-season-heading-$seasonKey"),
                                style = MaterialTheme.typography.titleLarge.copy(
                                    shadow = Shadow(color = Color.Black.copy(alpha = .65f),
                                        offset = Offset(0f, 2f), blurRadius = 6f)),
                                color = Color(0xfffff9ed))
                            }
                            Column(Modifier.padding(start = 10.dp, end = 10.dp, bottom = 10.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            group.months.forEachIndexed { index, (start, name, title) ->
                                if (index > 0) HorizontalDivider(color = accent.copy(alpha = .28f))
                                CalendarYearMonthCard(calendar, start, mode,
                                    if (mode == CalendarMode.SACRED) group.firstOrdinal + index + 1
                                    else gregorianMonthOrdinal(start.monthValue, gregorianYearStartsInMarch),
                                    name, title,
                                    taskCounts[start] ?: YearTaskCount(0, 0), onMonth, onTasks, locale, seasonRegionZone, shown.year)
                            }
                            }
                        }
                        }
                    }
                    }
                  }
                }
                if (row.size < yearColumns) Spacer(Modifier.weight(1f))
              }
              }
            }
        } else months.withIndex().toList().chunked(yearColumns).forEachIndexed { rowIndex, row ->
            item(key = "year-lunar-$rowIndex") {
            Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                row.forEach { (ordinal, entry) ->
                    val (start, name, title) = entry
                    Box(Modifier.weight(1f)) {
                        CalendarYearMonthCard(calendar, start, mode, ordinal + 1, name, title,
                            taskCounts[start] ?: YearTaskCount(0, 0), onMonth, onTasks, locale, seasonRegionZone, shown.year)
                    }
                }
                if (row.size < yearColumns) Spacer(Modifier.weight(1f))
            }
            }
        }
        if (mode == CalendarMode.PROFANE && !gregorianYearStartsInMarch && !springSuggestionDismissed) {
            item(key = "year-spring-suggestion") {
            val copy = springYearCopy(LocalGenesisLanguage.current)
            Card(Modifier.fillMaxWidth().padding(horizontal = 10.dp).testTag("spring-year-suggestion"),
                shape = AffairsLayout.shape,
                colors = CardDefaults.cardColors(containerColor = Color(0xff173b38)),
                border = BorderStroke(1.dp, Color(0xffdfc17e).copy(alpha = .65f))) {
                Row(Modifier.fillMaxWidth().padding(12.dp),
                    verticalAlignment = Alignment.Top,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        UntranslatedText(copy.title, color = Color(0xfffff5df),
                            style = MaterialTheme.typography.titleMedium)
                        UntranslatedText(copy.body, color = Color(0xffc8d9d4),
                            style = MaterialTheme.typography.bodySmall)
                        TextButton(onClick = onStartGregorianYearInMarch,
                            modifier = Modifier.testTag("spring-year-switch")) {
                            UntranslatedText(copy.action, color = Color(0xffdfc17e))
                        }
                    }
                    IconButton(onClick = onDismissSpringSuggestion,
                        modifier = Modifier.size(48.dp).testTag("spring-year-dismiss")) {
                        UntranslatedText("×", color = Color(0xffdfc17e),
                            style = MaterialTheme.typography.headlineSmall,
                            modifier = Modifier.semantics { contentDescription = copy.dismiss })
                    }
                }
            }
            }
        }
        item(key = "year-description") {
        Box(Modifier.padding(horizontal = 10.dp)) {
            CalendarYearDescriptionCard(calendar, shown, mode, gregorianYearStartsInMarch, onDay)
        }
        }
            }
    }
}

private fun yearTileRange(range: CalendarRange, locale: Locale): String =
    range.start.format(DateTimeFormatter.ofPattern("d MMM", locale)) + " — " +
        range.end.format(DateTimeFormatter.ofPattern("d MMM yyyy", locale))

@Composable
private fun CalendarYearMonthCard(calendar: GenesisCalendar, start: LocalDate, mode: CalendarMode, ordinal: Int,
    name: String, title: String, taskCount: YearTaskCount, onMonth: (LocalDate) -> Unit,
    onTasks: (LocalDate, Boolean) -> Unit, locale: Locale, seasonRegionZone: ZoneId, geometryYear: Int) {
    val english = LocalGenesisLanguage.current == "en"
    val range = calendar.monthRange(start, mode)
    val sacredIndex = if (mode == CalendarMode.SACRED) calendar.sacredDate(start).monthIndex else -1
    val monthTag = when (mode) {
        CalendarMode.SACRED -> "sacred-year-month-$sacredIndex"
        CalendarMode.PROFANE -> "calendar-year-month-$start"
        CalendarMode.LUNAR -> "lunar-year-month-$ordinal"
    }
    val sharedCount = LocalSharedCalendarCounts.current.let { byDate -> range.dates().sumOf { byDate[it.toString()] ?: 0 } }
    val season = GregorianSeason.entries.first { start.monthValue in it.months }
    val mainInk = if (LocalEveningTheme.current) MaterialTheme.colorScheme.onSurface else Color(0xff102b2c)
    val detailInk = if (LocalEveningTheme.current) MaterialTheme.colorScheme.onSurfaceVariant else Color(0xff405b59)
    val gold = if (LocalEveningTheme.current) Color(0xffdfc17e) else Color(0xff8b6727)
    val type = MaterialTheme.typography
    val density = LocalDensity.current
    val measurer = rememberTextMeasurer()
    val noteContext = LocalContext.current
    val noteLanguage = LocalGenesisLanguage.current
    fun label(index: Int): String = when (mode) {
        CalendarMode.LUNAR -> if (english) "LUNAR MONTH ${index + 1}" else "ЛУННЫЙ МЕСЯЦ ${index + 1}"
        CalendarMode.PROFANE -> ""
        CalendarMode.SACRED -> if (index == 12) { if (english) "OUTSIDE TIME" else "ВНЕ ВРЕМЕНИ" }
            else if (english) "SACRED MONTH ${SacredCatalog.months[index].roman}"
            else "САКРАЛЬНЫЙ МЕСЯЦ ${SacredCatalog.months[index].roman}"
    }
    val year = calendar.sacredDate(LocalDate.of(geometryYear, 7, 1)).sacredYear
    val allMonths = remember(year, geometryYear) {
        val sacred = SacredCatalog.months.indices.map { CalendarMode.SACRED to calendar.gregorianDate(year, it, 1) }
        val lunar = calendar.lunarYear(year).let { y -> (0 until y.monthCount).map { CalendarMode.LUNAR to calendar.lunarMonthStart(y.startMonthIndex + it) } }
        sacred + lunar + (1..12).map { CalendarMode.PROFANE to LocalDate.of(geometryYear, it, 1) }
    }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val artWidth = 76.dp
        val textWidth = with(density) { (maxWidth - artWidth - 91.dp).coerceAtLeast(64.dp).roundToPx() }
        val tileHeight = remember(textWidth, year, type, density.fontScale, locale, seasonRegionZone, noteLanguage) {
            fun translate(value: String) = translateGenesisText(noteContext, value, noteLanguage)
            fun height(text: String, style: ComposeTextStyle, lines: Int = Int.MAX_VALUE): Int =
                measurer.measure(AnnotatedString(text), style, maxLines = lines,
                    constraints = Constraints(maxWidth = textWidth)).size.height
            val tallest = allMonths.maxOf { (candidate, day) ->
                val info = when (candidate) {
                    CalendarMode.SACRED -> SacredCatalog.months[calendar.sacredDate(day).monthIndex].let { it.name to it.title }
                    CalendarMode.LUNAR -> calendar.lunarDate(day).month.let { it.name to it.title }
                    CalendarMode.PROFANE -> day.month.getDisplayName(TextStyle.FULL_STANDALONE, locale) to ""
                }
                height("САКРАЛЬНЫЙ МЕСЯЦ XIII", type.labelSmall) + height(translate(info.first), type.titleLarge) +
                    if (candidate == CalendarMode.PROFANE) height(translate(gregorianMonthOrigin(day.monthValue)), type.bodySmall) +
                        height(translate(gregorianMonthNature(day.monthValue, seasonRegionZone)), type.bodySmall) + height("31", type.labelSmall)
                    else height(translate(info.second), type.bodySmall) + height(yearTileRange(calendar.monthRange(day, candidate), locale), type.labelMedium) +
                        if (candidate == CalendarMode.LUNAR) height("30", type.labelSmall) else 0
            }
            maxOf(112.dp, with(density) { tallest.toDp() } + 6.dp) + 24.dp
        }
        Card(onClick = { onMonth(start) }, modifier = Modifier.fillMaxWidth().height(tileHeight).testTag(monthTag),
            shape = AffairsLayout.shape,
            colors = CardDefaults.cardColors(containerColor = if (mode == CalendarMode.PROFANE)
                seasonSurface(season).copy(alpha = if (LocalEveningTheme.current) .62f else 1f)
                else MaterialTheme.colorScheme.surfaceContainerLow),
            border = if (mode == CalendarMode.PROFANE) null else BorderStroke(1.dp, gold.copy(alpha = .5f))) {
            Row(Modifier.fillMaxSize().padding(12.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                when (mode) {
                    CalendarMode.SACRED -> OriginalImage(sacredMonthArtPath(sacredIndex), "Иллюстрация месяца $name",
                        Modifier.width(artWidth).height(112.dp).clip(AffairsLayout.controlShape), darkThemeBrightness = .82f)
                    CalendarMode.LUNAR -> OriginalImage(lunarMonthArtPath(ordinal - 1), "Иллюстрация месяца $name",
                        Modifier.width(artWidth).height(112.dp).clip(AffairsLayout.controlShape).testTag("lunar-year-art-$ordinal"), darkThemeBrightness = .82f)
                    CalendarMode.PROFANE -> OriginalImage(gregorianMonthArtPath(start.monthValue - 1, seasonRegionZone),
                        "Иллюстрация месяца $name", Modifier.width(artWidth).height(112.dp)
                            .clip(AffairsLayout.controlShape).testTag("gregorian-year-art-$start"), darkThemeBrightness = .82f)
                }
                Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.Center) {
                    if (mode == CalendarMode.PROFANE) Text(ordinal.toString(), color = gold,
                        style = type.labelSmall, modifier = Modifier.testTag("gregorian-year-month-number-${start.monthValue}"))
                    if (mode != CalendarMode.PROFANE) Text(label(if (mode == CalendarMode.SACRED) sacredIndex else ordinal - 1),
                        color = gold, style = type.labelSmall)
                    Text(name, color = mainInk, style = type.titleLarge)
                    if (mode == CalendarMode.PROFANE) {
                        UntranslatedText(genesisTranslate(gregorianMonthOrigin(start.monthValue)), color = detailInk,
                            style = type.bodySmall.copy(lineBreak = androidx.compose.ui.text.style.LineBreak.Heading), maxLines = 2,
                            autoSize = TextAutoSize.StepBased(minFontSize = 10.sp, maxFontSize = 12.sp))
                        Text(gregorianMonthNature(start.monthValue, seasonRegionZone), color = detailInk, style = type.bodySmall)
                    }
                    if (title.isNotBlank()) Text(title, color = detailInk, style = type.bodySmall)
                    if (mode != CalendarMode.PROFANE) Text(yearTileRange(range, locale), color = mainInk, style = type.labelMedium,
                        modifier = Modifier.testTag(if (mode == CalendarMode.LUNAR) "lunar-year-range-$ordinal" else "sacred-year-range-$sacredIndex"))
                    if (mode != CalendarMode.SACRED) Text(if (english) "${range.dates().size} days" else "${range.dates().size} дней",
                        Modifier.padding(top = 6.dp).testTag("calendar-year-days-$ordinal"), color = detailInk, style = type.labelSmall)
                }
                Column(Modifier.width(48.dp).testTag("calendar-year-counts-$ordinal"), horizontalAlignment=Alignment.CenterHorizontally) {
                    if (taskCount.total > 0) Box(Modifier.size(48.dp).testTag("calendar-year-open-tasks-$ordinal")
                        .clickable(onClickLabel=genesisTranslate("Задачи месяца")) { onTasks(start,false) },contentAlignment=Alignment.Center) {
                        CalendarPersonalCountDisc(taskCount.total, taskCount.completed, 23.dp,
                            Modifier.testTag("calendar-year-task-count-disc-$ordinal"))
                    }
                    if (sharedCount > 0) Box(Modifier.size(48.dp).testTag("calendar-year-open-shared-$ordinal")
                        .clickable(onClickLabel=genesisTranslate("Общие задачи месяца")) { onTasks(start,true) },contentAlignment=Alignment.Center) {
                        SharedTaskCountDisc(sharedCount,
                            if (english) "$sharedCount shared tasks" else "$sharedCount общих задач",
                            Modifier.testTag("calendar-year-shared-count-$ordinal"), elevated = true)
                    }
                }
            }
        }
    }
}

@Composable
private fun SolarPointTile(event: SolarEvent, calendar: GenesisCalendar,
    onMonth: (LocalDate) -> Unit, modifier: Modifier = Modifier) {
    val locale = Locale.forLanguageTag(LocalGenesisLanguage.current)
    val tileHeight = (148f * maxOf(1f, LocalDensity.current.fontScale)).dp
    val evening = LocalEveningTheme.current
    val solarAccent = if (evening) Color(0xffdfc17e) else Color(0xff715923)
    val solarInk = if (evening) Color(0xfffff5df) else Color(0xff253a36)
    Surface(onClick = { onMonth(event.date) }, modifier = modifier.height(tileHeight)
        .testTag("solar-point-${event.date}"), shape = MaterialTheme.shapes.medium,
        color = if (evening) Color(0xff183432) else Color(0xfff5ecd6),
        border = BorderStroke(1.dp, Color(0xffd7bd79))) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(event.symbol, style = MaterialTheme.typography.titleLarge, color = solarAccent)
            androidx.compose.foundation.text.BasicText(genesisTranslate(event.shortName),
                style = MaterialTheme.typography.labelMedium.copy(color = solarAccent),
                maxLines = 1, softWrap = false,
                autoSize = TextAutoSize.StepBased(minFontSize = 9.sp, maxFontSize = 12.sp))
            Text(event.date.dayOfWeek.getDisplayName(TextStyle.FULL, locale),
                style = MaterialTheme.typography.bodySmall, color = solarInk)
            Text(event.date.format(DateTimeFormatter.ofPattern("d MMMM yyyy", locale)),
                style = MaterialTheme.typography.titleSmall, color = solarInk)
            Text(event.instant.atZone(calendar.zoneId).format(DateTimeFormatter.ofPattern("HH:mm z", locale)),
                style = MaterialTheme.typography.labelSmall, color = solarAccent)
        }
    }
}
