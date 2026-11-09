package ru.genesis.calendar.ui

import android.Manifest
import android.content.res.Configuration
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.stateDescription
import androidx.core.view.WindowInsetsControllerCompat
import androidx.compose.ui.unit.dp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextAlign
import ru.genesis.calendar.ui.Dialog
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.*
import ru.genesis.calendar.auth.GoogleServicesFirstRunModal
import ru.genesis.calendar.auth.YandexCalendarFirstRunDialog
import ru.genesis.calendar.auth.activity
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import java.time.*
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID
import ru.genesis.calendar.domain.habits.Habit
import ru.genesis.calendar.domain.habits.HabitEngine
import ru.genesis.calendar.domain.habits.TrackerEntity
import ru.genesis.calendar.domain.trackers.MoodTracker
import ru.genesis.calendar.domain.trackers.SleepPlan

internal val standart = lightColorScheme(primary=Color(0xff255b59), onPrimary=Color(0xfffffdf8),
    background=Color(0xffeee9dc), onBackground=Color(0xff132426), surface=Color(0xfffffdf8),
    onSurface=Color(0xff132426), onSurfaceVariant=Color(0xff526263),
    secondary=Color(0xff8c672b), onSecondary=Color(0xfffffdf8), secondaryContainer=Color(0xffeee2c7),
    onSecondaryContainer=Color(0xff513b17), primaryContainer=Color(0xffdce8e2), onPrimaryContainer=Color(0xff163e38),
    surfaceVariant=Color(0xffe9e3d6), surfaceContainer=Color(0xfff8f5ed), surfaceContainerLow=Color(0xfff8f5ed),
    surfaceContainerLowest=Color(0xfffffdf8), surfaceContainerHigh=Color(0xffefe8d9), surfaceContainerHighest=Color(0xffe9e1d0),
    outline=Color(0xff7c847e), outlineVariant=Color(0xffd3d7cd))

@Composable
fun GenesisApp(app: GenesisApplication, openedTask: String?, openedSection: String? = null,
    testWorkspace: Boolean = false, openedHabit: ru.genesis.calendar.reminders.HabitReminderOpenRequest? = null,
    openedAdvice: ru.genesis.calendar.reminders.AdviceNotificationOpenRequest? = null) {
    require(!testWorkspace || BuildConfig.DEBUG)
    val activeScope by app.scopeFlow.collectAsStateWithLifecycle()
    key(activeScope) { GenesisWorkspaceContent(app, openedTask, openedSection, activeScope, testWorkspace, openedHabit, openedAdvice) }
}

@OptIn(FlowPreview::class)
@Composable
private fun GenesisWorkspaceContent(app: GenesisApplication, openedTask: String?, openedSection: String?,
    activeScope: String, testWorkspace: Boolean, openedHabit: ru.genesis.calendar.reminders.HabitReminderOpenRequest?,
    openedAdvice: ru.genesis.calendar.reminders.AdviceNotificationOpenRequest?) {
    var closedAdviceNonce by rememberSaveable(activeScope) { mutableStateOf<Long?>(null) }
    // Derive this before the first Today composition: an effect would allow an accidental draw underneath the reader.
    val activeAdviceRequest = openedAdvice?.takeIf { it.scope == activeScope && it.nonce != closedAdviceNonce }
    val model: GenesisViewModel = viewModel(key = "genesis-$activeScope")
    val tasks by model.tasks.collectAsStateWithLifecycle()
    val error by model.error.collectAsStateWithLifecycle()
    val savingTask by model.saving.collectAsStateWithLifecycle()
    val structureRepo = remember(app, activeScope) { WorkspaceStructureRepository(app) }
    val structure by structureRepo.workspace.collectAsStateWithLifecycle(WorkspaceStructure())
    val taskListsRepo = remember(app, activeScope) { TaskListsRepository(app) }
    val cachedTaskLists by taskListsRepo.lists.collectAsStateWithLifecycle(emptyList())
    val taskLists = remember(cachedTaskLists,tasks) { taskListsForTasks(cachedTaskLists,tasks) }
    val authController = remember(app) { ru.genesis.calendar.auth.AuthController.get(app) }
    val authState by authController.state.collectAsStateWithLifecycle()
    var playTestingChecked by remember(authState.user?.uid){mutableStateOf(false)}
    LaunchedEffect(authState.ready,authState.user?.uid,authState.accountSettings?.featureAccess?.lifetimePremium) {
        if(BuildConfig.PLAY_DISTRIBUTION && !testWorkspace && !playTestingChecked && authState.ready && !authState.requiresSignIn
            && authState.user!=null && authState.accountSettings?.featureAccess?.lifetimePremium!=true) {
            playTestingChecked=true
            try {if(ru.genesis.calendar.auth.claimPlayTestingAccess(app,authController))authController.checkSession()}
            catch(cancelled:kotlinx.coroutines.CancellationException){throw cancelled}catch(_:Exception){ }
        }
    }
    val diaryOwner = authState.user?.uid?.takeUnless { testWorkspace }
    val nativeAdminGateway = remember(authController, diaryOwner) { diaryOwner?.let(authController::adminGateway) }
    val diaryRepository = remember(app, activeScope, diaryOwner) {
        diaryOwner?.let { DiaryRepository.room(app.database, activeScope, it, authController.diaryGateway(it)) }
    }
    val prefsStore=remember(app, activeScope) { LocalPreferences(app,activeScope) }
    val savedPrefs by prefsStore.values.collectAsStateWithLifecycle(UiPreferences())
    val sacredFeaturesEnabled = authState.accountSettings?.uiVisibility?.sacredFeaturesEnabled != false
    val visibleCalendarChoices = authState.accountSettings?.uiVisibility?.visibleCalendars ?: setOf("profane", "lunar")
    val fallbackCalendar = CalendarMode.entries.firstOrNull { it.wireValue in visibleCalendarChoices } ?: CalendarMode.PROFANE
    // Retain legacy stored values for compatibility; the Android workspace has one menu layout.
    val prefs = (if (sacredFeaturesEnabled) savedPrefs else savedPrefs.copy(
        display = savedPrefs.display.takeIf { it.wireValue in visibleCalendarChoices } ?: fallbackCalendar,
        input = savedPrefs.input.takeIf { it.wireValue in visibleCalendarChoices } ?: fallbackCalendar))
        .copy(navigationLabels = true, settingsSubmenuEnabled = true)
    val pendingPreferences by prefsStore.pending.collectAsStateWithLifecycle(emptyMap())
    val pendingWrites by remember(app, activeScope) {
        app.database.dao().observeOutbox(activeScope).map { it.size }
    }.collectAsStateWithLifecycle(-1)
    val menuSwipeState = rememberSaveable(activeScope, saver = MenuSwipeStateSaver) { MenuSwipeState() }
    val settingsScrollStates = remember(activeScope) { mutableMapOf<String, ScrollState>() }
    var menuVisibilityExpanded by rememberSaveable(activeScope) { mutableStateOf(false) }
    var focusSolarPlace by rememberSaveable(activeScope) { mutableStateOf(false) }
    val habitSettingsRepository = remember(app, activeScope) { HabitsRepository(app) }
    val trackersRepository = remember(app, activeScope) { TrackersRepository(app) }
    val habitWorkspace by habitSettingsRepository.workspace.collectAsStateWithLifecycle(LocalHabitWorkspace())
    val habitExpiryLifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(activeScope,habitWorkspace.revision,habitExpiryLifecycle) {
        habitExpiryLifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) {
            while(isActive) {
                try { habitSettingsRepository.expireIdleHabits() }
                catch(cancel: CancellationException) { throw cancel }
                catch(error: Exception) { android.util.Log.w("GenesisHabits","Automatic deletion deferred",error) }
                delay(60_000)
            }
        }
    }
    val habitTrackingEnabled = habitWorkspace.settings.enabled
    val welcomePrefsStore=remember(app) { LocalPreferences(app,"welcome") }
    val welcomePrefs by welcomePrefsStore.values.collectAsStateWithLifecycle(
        UiPreferences(language = regionalLanguageForDevice()))
    val taskSync by authController.taskSync.collectAsStateWithLifecycle()
    val accountTaskSync = taskSync.takeIf { it.scope == activeScope }
    val scope=rememberCoroutineScope()
    LaunchedEffect(activeScope) {
        ru.genesis.calendar.reminders.MoonReminderScheduler.restore(app)
        runCatching { ru.genesis.calendar.reminders.SleepReminderScheduler.restore(app) }
    }
    var preferredWelcomeLanguage by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(authController, testWorkspace) { if (!testWorkspace) authController.ensureSession() }
    LaunchedEffect(activeScope, authState.user, authState.busy) {
        if (!testWorkspace && activeScope.startsWith("account-") && authState.user != null && !authState.busy) {
            app.database.dao().observeOutbox(activeScope).debounce(800).collectLatest { pending ->
                if (pending.isNotEmpty()) authController.syncPending()
            }
        }
    }
    LaunchedEffect(authState.accountSettings) {
        authState.accountSettings?.let { remote ->
            if (remote.calendarMode in setOf("sacred", "lunar", "profane")) prefsStore.setRemote("display", remote.calendarMode)
            if (remote.taskCalendarMode in setOf("sacred", "lunar", "profane")) prefsStore.setRemote("input", remote.taskCalendarMode)
            if (remote.timeFormat in setOf("12h", "24h")) prefsStore.setRemote("time", remote.timeFormat)
            if (remote.theme in setOf("standart", "standart-dark", "experimental", "experimental-dark")) prefsStore.setRemote("theme", remote.theme)
            prefsStore.setRemote("darkPalette", remote.darkPalette)
            if (remote.weekStart in setOf("sunday", "monday")) prefsStore.setRemote("weekStart", remote.weekStart)
            if (remote.gregorianYearStart in setOf("january", "march"))
                prefsStore.setRemote("gregorianYearStart", remote.gregorianYearStart)
            if (remote.language in setOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")) prefsStore.setRemote("language", remote.language)
            prefsStore.setRemote("stoicheionDivinationDisabled", remote.divinationDisabled.toString())
        }
    }
    LaunchedEffect(activeScope, authState.user, authState.ready) {
        if (!testWorkspace && activeScope.startsWith("account-") && authState.ready) {
            prefsStore.pending.debounce(800).collectLatest { if (it.isNotEmpty()) authController.syncPending() }
        }
    }
    var tab by rememberSaveable { mutableStateOf("Сегодня") }
    val backActivity=androidx.activity.compose.LocalActivity.current
    val routeHistory = rememberScreenBackHistory(workspaceBackDestination(tab,menuSwipeState))
    fun navigateBack() {
        val previous=routeHistory.pop()
        if(previous==null) backActivity?.finish() else tab=restoreWorkspaceBackDestination(previous,menuSwipeState)
    }
    BackHandler(routeHistory.canGoBack) { navigateBack() }
    var highlightedPage by remember { mutableStateOf(tab) }
    var highlightedSection by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(tab, menuSwipeState.section(tab)) {
        highlightedPage = tab; highlightedSection = menuSwipeState.section(tab)
    }
    fun openPersonalTasks(lists: Boolean = false) {
        menuSwipeState.projectArea = "personal"
        menuSwipeState.tasks = if (lists) "lists" else "tasks"
        menuSwipeState.personalView = "projects"
        tab="Проекты"
    }
    var serverAssistantOpen by rememberSaveable(activeScope) { mutableStateOf(false) }
    var messagingSpaceId by rememberSaveable(activeScope) { mutableStateOf<String?>(null) }
    var messagingProjectId by rememberSaveable(activeScope) { mutableStateOf<String?>(null) }
    var serverAssistantAvailable by remember(activeScope) { mutableStateOf(false) }
    val hasAssistantPlan by remember(app, activeScope) {
        app.database.dao().observeDocument(activeScope, "assistant-plan-v1").map { it != null }
    }.collectAsStateWithLifecycle(false)
    val assistantGateway = remember(authController, diaryOwner) { diaryOwner?.let(authController::assistantGateway) }
    LaunchedEffect(assistantGateway, authState.checkedAt) {
        serverAssistantAvailable = try { assistantGateway?.status()?.optBoolean("available") == true }
        catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
        catch (_: Exception) { false }
    }
    var requestedSacredHabits by rememberSaveable { mutableStateOf(false) }
    var requestedHeroPath by rememberSaveable { mutableStateOf(false) }
    var editId by rememberSaveable { mutableStateOf<String?>(null) }
    var transferTask by remember { mutableStateOf<LocalTask?>(null) }
    var creating by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(activeAdviceRequest?.nonce) {
        if (activeAdviceRequest != null) { tab = "Сегодня"; creating = false; editId = null }
    }
    LaunchedEffect(creating, editId) { if (creating || editId != null) model.error.value = null }
    var mindmapsOpen by rememberSaveable { mutableStateOf(false) }
    var mindmapProjectId by rememberSaveable { mutableStateOf<String?>(null) }
    var requestedMindmapProject by rememberSaveable {mutableStateOf<String?>(null)}
    var mindmapTaskDraft by remember { mutableStateOf<LocalTask?>(null) }
    var auroraTaskDraft by remember { mutableStateOf<LocalTask?>(null) }
    var creatingSharedTask by rememberSaveable { mutableStateOf(false) }
    var newTaskProjectId by rememberSaveable { mutableStateOf<String?>(null) }
    var newTaskEntryType by rememberSaveable { mutableStateOf("task") }
    var newTaskListId by rememberSaveable { mutableStateOf<String?>(null) }
    val mindmapUid=mindmapAccountUid(authState.user?.uid,authState.ready,activeScope)
    val mapsAccess=rememberUpdatedState(authState.accountSettings?.featureAccess ?: ru.genesis.calendar.auth.FeatureAccess())
    val mapsRepo=remember(mindmapUid,activeScope) {mindmapUid?.let {uid->ru.genesis.calendar.data.MindmapRepository(app.database,activeScope,uid,authController.mindmapTransport(uid),{ mapsAccess.value })}}
    LaunchedEffect(mapsRepo) {
        val repository=mapsRepo ?: return@LaunchedEffect
        try {
            repository.conversionDraft()?.let { draft ->
                if(app.repository.get(draft.id)==null) {
                    mindmapTaskDraft=draft;newTaskProjectId=draft.projectId;newTaskListId=null;editId=null;creating=true;mindmapsOpen=true
                } else repository.clearConversionDraft()
            }
        } catch(error:kotlinx.coroutines.CancellationException) { throw error }
        catch(error:Exception) {
            // Startup/session transitions must preserve a failed draft without crashing sign-in.
            android.util.Log.e("GenesisMaps", "DRAFT_RECOVERY: ${error.javaClass.simpleName}")
        }
    }
    var requestedPersonalListId by rememberSaveable { mutableStateOf<String?>(null) }
    var creatingTaskList by rememberSaveable { mutableStateOf(false) }
    var sharedListRefreshKey by remember { mutableIntStateOf(0) }
    var requestedTheokyklosSector by rememberSaveable { mutableStateOf<String?>(null) }
    var requestedStoicheionCard by rememberSaveable { mutableStateOf<String?>(null) }
    var todayPageDate by remember { mutableStateOf(LocalDate.now().toString()) }
    LaunchedEffect(Unit) {
        while (isActive) {
            todayPageDate = LocalDate.now().toString()
            delay(60_000)
        }
    }
    var selected by rememberSaveable { mutableStateOf(LocalDate.now().toString()) }
    var calendarEntryRequest by rememberSaveable { mutableIntStateOf(0) }
    LaunchedEffect(habitTrackingEnabled, tab) {
        if (!habitTrackingEnabled && tab == "Привычки") tab = "Сегодня"
    }
    LaunchedEffect(openedTask) { if(openedTask!=null) { editId=openedTask; creating=false; openPersonalTasks() } }
    LaunchedEffect(openedSection) {
        if (openedSection?.substringBefore('#') == "habits" && habitTrackingEnabled) {
            menuSwipeState.habits = "Привычки"; tab = "Привычки"
        }
        if (openedSection?.substringBefore('#') == "sleep" && habitTrackingEnabled) {
            menuSwipeState.habits = "Сон и настроение"
            tab = "Привычки"
        }
        if (openedSection?.substringBefore('#') == "donation") {
            menuSwipeState.settings = "links"; tab = "Настройки"
        }
    }
    val configuration = LocalConfiguration.current
    val isLandscape = configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    val shortWindow = compactWindowHeight()
    val compactHeader = isLandscape || configuration.screenWidthDp >= 600
    val navigationOnLeft = shouldUseNavigationRail(configuration.screenWidthDp,
        isLandscape, prefs.wideNavigationOnLeft)
    val portraitAutoScroll = !isLandscape && prefs.navigationLabels && prefs.navigationAutoScroll
    val portraitMenuSwipe = false // 3.0: horizontal gestures belong to calendars and mindmaps.
    var pendingSharedProjectsToggle by remember(authState.user?.uid) { mutableStateOf<Boolean?>(null) }
    var invitationDestination by remember { mutableStateOf<SharedInvitationDestination?>(null) }
    var sharedTaskOpenRequest by remember { mutableIntStateOf(0) }
    val accountAccess = authState.accountSettings?.featureAccess ?: ru.genesis.calendar.auth.FeatureAccess()
    val sharedProjectsEnabled = !testWorkspace && accountAccess.allows("shared-projects") &&
        authState.accountSettings?.sharedProjectsEligible == true &&
        (pendingSharedProjectsToggle ?: (pendingPreferences["sharedProjectsEnabled"] != "false" &&
            authState.accountSettings?.sharedProjectsEnabled == true))
    LaunchedEffect(authState.busy, authState.accountSettings?.sharedProjectsEnabled,
        pendingSharedProjectsToggle) {
        if (!authState.busy && pendingSharedProjectsToggle != null &&
            authState.accountSettings?.sharedProjectsEnabled == pendingSharedProjectsToggle)
            pendingSharedProjectsToggle = null
    }
    var sharedCalendarEntries by remember { mutableStateOf<List<SharedCalendarEntry>>(emptyList()) }
    var sharedCalendarCounts by remember { mutableStateOf<Map<String,Int>>(emptyMap()) }
    val sharedCalendarYear = selected.take(4)
    LaunchedEffect(sharedProjectsEnabled, tab, sharedCalendarYear, authState.user) {
        if (!sharedProjectsEnabled || tab != "Календарь") {
            if (!sharedProjectsEnabled) { sharedCalendarEntries = emptyList(); sharedCalendarCounts = emptyMap() }
            return@LaunchedEffect
        }
        val year = sharedCalendarYear.toIntOrNull() ?: LocalDate.now().year
        while (isActive) {
            runCatching {
                val result = authController.sharedCalendarTasks("${year - 1}-01-01", "${year + 1}-12-31")
                val counts = result.optJSONObject("dateCounts") ?: org.json.JSONObject()
                sharedCalendarCounts = counts.keys().asSequence().associateWith { counts.optInt(it) }
            }.onFailure { sharedCalendarCounts = emptyMap() }
            delay(30_000)
        }
    }
    LaunchedEffect(sharedProjectsEnabled, tab, selected, authState.user) {
        sharedCalendarEntries = emptyList()
        if (!sharedProjectsEnabled || tab != "Календарь") return@LaunchedEffect
        val filter = org.json.JSONObject().put("dueFrom", selected).put("dueTo", selected).put("completion", "open")
        while (isActive) {
            runCatching {
                var cursor: String? = null
                val entries = mutableListOf<SharedCalendarEntry>()
                do {
                    val page = authController.querySharedTasks(filter, cursor)
                    val rows = page.getJSONArray("tasks")
                    for (index in 0 until rows.length()) rows.getJSONObject(index).let { row ->
                        entries += SharedCalendarEntry(row.getString("id"), row.getString("title"), row.getString("dueDate"),
                            row.optString("projectTitle"), !row.isNull("completedAt"), row.getString("projectId"), row.getString("spaceId"))
                    }
                    cursor = page.optString("nextCursor").takeUnless { it.isBlank() || it == "null" }
                } while (cursor != null)
                entries.toList()
            }.onSuccess { sharedCalendarEntries = it }.onFailure { sharedCalendarEntries = emptyList() }
            delay(5_000)
        }
    }
    val serverUiVisibility = authState.accountSettings?.uiVisibility ?: ru.genesis.calendar.auth.UiVisibility()
    var pendingUiVisibility by remember(authState.user?.uid) {
        mutableStateOf<ru.genesis.calendar.auth.UiVisibility?>(null)
    }
    val uiVisibility = pendingUiVisibility ?: serverUiVisibility
    LaunchedEffect(authState.busy, serverUiVisibility, pendingUiVisibility) {
        if (!authState.busy && pendingUiVisibility != null &&
            serverUiVisibility == pendingUiVisibility) pendingUiVisibility = null
    }
    val visiblePages = listOf("Сегодня", "Проекты", "Календарь", "Привычки", "Сакральное", "Настройки", "Дневник", "Сообщения")
        .filter { (it != "Дневник" || !testWorkspace && authState.user != null) &&
            (it != "Сообщения" || !testWorkspace && authState.user != null && accountAccess.allows("messenger")) &&
            (habitTrackingEnabled || it != "Привычки") && menuVisibilityId(it) !in uiVisibility.hiddenMenuItems &&
            (it != "Сакральное" || (uiVisibility.sacredFeaturesEnabled && !("stoicheion" in uiVisibility.hiddenMenuItems &&
                "theokyklos" in uiVisibility.hiddenMenuItems))) }
    LaunchedEffect(sharedProjectsEnabled) {
        if (!sharedProjectsEnabled) menuSwipeState.projectArea = "personal"
    }
    LaunchedEffect(visiblePages, uiVisibility.hiddenSubmenus, sharedProjectsEnabled) {
        if (tab !in visiblePages) tab = "Сегодня"
        if ("tasks.${menuSwipeState.tasks}" in uiVisibility.hiddenSubmenus) {
            menuSwipeState.tasks = if (menuSwipeState.tasks == "tasks") "lists" else "tasks"
            if (menuSwipeState.personalView != "projects") menuSwipeState.personalView = menuSwipeState.tasks
        }
        if ("calendar.${menuSwipeState.calendar}" in uiVisibility.hiddenSubmenus)
            menuSwipeState.calendar = if (menuSwipeState.calendar == "month") "year" else "month"
        if ("projects.${menuSwipeState.projectArea}" in uiVisibility.hiddenSubmenus)
            menuSwipeState.projectArea = if (menuSwipeState.projectArea == "personal") "shared" else "personal"
        if ((if (menuSwipeState.habits == "Привычки") "habits.habits" else "habits.sleep") in uiVisibility.hiddenSubmenus)
            menuSwipeState.habits = if (menuSwipeState.habits == "Привычки") "Сон и настроение" else "Привычки"
        if ("sacred.${menuSwipeState.sacred}" in uiVisibility.hiddenSubmenus ||
            menuSwipeState.sacred in uiVisibility.hiddenMenuItems)
            menuSwipeState.sacred = if (menuSwipeState.sacred == "stoicheion") "theokyklos" else "stoicheion"
    }
    val swipeSequence = remember(prefs.menuSwipeSubmenus, prefs.settingsSubmenuEnabled,
        habitTrackingEnabled, sharedProjectsEnabled,
        uiVisibility.hiddenMenuItems, uiVisibility.hiddenSubmenus, uiVisibility.sacredFeaturesEnabled) {
        menuSwipeSequence(prefs.menuSwipeSubmenus, habitTrackingEnabled, sharedProjectsEnabled,
            uiVisibility.hiddenMenuItems, uiVisibility.hiddenSubmenus,
            prefs.settingsSubmenuEnabled, uiVisibility.sacredFeaturesEnabled)
    }
    val swipeSection = if (prefs.menuSwipeSubmenus &&
        (tab != "Настройки" || prefs.settingsSubmenuEnabled))
        menuSwipeState.section(tab) else null
    val currentSwipeDestination = remember(tab, swipeSection) { SwipeDestination(tab, swipeSection) }
    val usageSection = if (tab == "Проекты") menuSwipeState.projectArea else menuSwipeState.section(tab)
    LaunchedEffect(activeScope, authState.ready, authState.requiresSignIn, authState.user?.uid,
        tab, usageSection, prefs.display, testWorkspace) {
        if (!testWorkspace && authState.ready && !authState.requiresSignIn && authState.user != null) {
            val features = when (tab) {
                "Сегодня" -> listOf("menu.today")
                "Задачи" -> listOf("menu.tasks", "submenu.tasks.${menuSwipeState.tasks}")
                "Проекты" -> listOf("menu.projects", "submenu.projects.${menuSwipeState.projectArea}")
                "Календарь" -> listOf("menu.calendar", "submenu.calendar.${menuSwipeState.calendar}",
                    "calendar.${prefs.display.wireValue}")
                "Привычки" -> listOf("menu.habits", "submenu.habits.${if (menuSwipeState.habits == "Привычки") "habits" else "sleep"}")
                "Сакральное" -> listOf("menu.sacred", "submenu.sacred.${menuSwipeState.sacred}")
                "Настройки" -> listOf("menu.settings", "submenu.settings.${menuSwipeState.settings}")
                else -> emptyList()
            }
            if (features.isNotEmpty()) runCatching { authController.recordFeatureUsage(features) }
        }
    }
    val eveningTheme = rememberEveningTheme(AppearanceSettings.read(habitWorkspace.settings.rawJson, prefs.theme))
    val darkPalette = prefs.darkPalette.takeIf { accountAccess.allows("dark-palettes") } ?: "green"
    val darkScheme = remember(darkPalette) { eveningPalette(darkPalette) }
    val lightScheme = remember(darkPalette) { daylightPalette(darkPalette) }
    var themeSwitchBusy by remember { mutableStateOf(false) }
    var themeSwitchError by remember { mutableStateOf<String?>(null) }
    var updateCheckMessage by remember { mutableStateOf<String?>(null) }
    val accountGate = !testWorkspace && (!activeScope.startsWith("account-") || authState.user == null || !authState.ready)
    val welcomeVisible = accountGate && !(authState.busy && authState.user != null)
    val window = LocalContext.current.activity()?.window
    val changeDisplayCalendar: (CalendarMode) -> Unit = { next ->
        if (!testWorkspace && authState.user != null) authController.updateSharedPreference("display", next.wireValue)
        else scope.launch { prefsStore.set("display", next.wireValue) }
    }
    SideEffect { window?.let { systemWindow ->
        // Before Android10 there is no automatic navigation-bar contrast scrim.
        // Its background must follow the same in-app theme as the button brightness.
        if (Build.VERSION.SDK_INT < 29) {
            @Suppress("DEPRECATION")
            systemWindow.navigationBarColor = (if (eveningTheme || welcomeVisible) darkScheme else lightScheme).background.toArgb()
        }
        WindowInsetsControllerCompat(systemWindow,systemWindow.decorView).apply {
            isAppearanceLightStatusBars = !eveningTheme && !welcomeVisible
            isAppearanceLightNavigationBars = !eveningTheme && !welcomeVisible
        }
    } }
    val language = if (testWorkspace || activeScope.startsWith("account-")) prefs.language else welcomePrefs.language
    val frameworkConfiguration = remember(configuration, language) {
        Configuration(configuration).apply { setLocale(java.util.Locale.forLanguageTag(language)) }
    }
    val context = LocalContext.current
    val frameworkContext = remember(context, frameworkConfiguration) { GenesisLocaleContext(context, frameworkConfiguration) }
    val guidanceSurfaces = remember { NativeGuidanceSurfaces() }
    val nativeGuidance = rememberNativePlanGuidance(authController, authState.user?.uid, language,
        enabled = !testWorkspace && !accountGate && !authState.requiresSignIn &&
            ru.genesis.calendar.auth.nativePlanGuidanceEligible(accountAccess) &&
            authState.accountSettings?.emailVerification?.required != true)
    val nativeUpgrade = rememberNativeUpgrade(authController, authState.user?.uid, accountAccess, language,
        enabled = !testWorkspace && !accountGate, surfaces = guidanceSurfaces,
        onContext = { nativeGuidance?.contextual(it) }, onVisibility = { nativeGuidance?.comparisonVisible = it })
    MaterialTheme(colorScheme=if (eveningTheme) darkScheme else lightScheme, typography = GenesisTypography,
        shapes = GenesisShapes) {
      CompositionLocalProvider(LocalEveningTheme provides eveningTheme, LocalDarkPalette provides darkPalette) {
      CompositionLocalProvider(LocalGenesisLanguage provides language,
          LocalWeatherDisplayUnits provides WeatherDisplayUnits(WeatherTemperatureUnit.fromWire(prefs.weatherTemperatureUnit),
              WeatherPressureUnit.fromWire(prefs.weatherPressureUnit)),
          LocalContext provides frameworkContext, LocalConfiguration provides frameworkConfiguration,
          LocalEnabledCalendars provides CalendarMode.entries
              .filter { it.wireValue in uiVisibility.visibleCalendars }.toSet(),
          LocalSacredFeaturesEnabled provides uiVisibility.sacredFeaturesEnabled,
          LocalDreamJournalEnabled provides uiVisibility.dreamJournalEnabled,
          LocalDreamRepository provides diaryRepository,
          LocalFeatureAccess provides (authState.accountSettings?.featureAccess ?: ru.genesis.calendar.auth.FeatureAccess()),
          LocalNativeUpgrade provides nativeUpgrade?.feature,
          LocalNativePlanGuidance provides nativeGuidance,
          LocalNativeGuidanceSurfaces provides guidanceSurfaces,
          LocalTimerDisplayMode provides prefs.display,
          LocalTimerUse24 provides prefs.use24,
          LocalGenesisUserId provides (authState.user?.uid?:"local")) {
        if (!accountGate) {
            NativeTrialExpiryPrompt(authState.user?.uid, authState.accountSettings?.featureAccess ?: ru.genesis.calendar.auth.FeatureAccess())
            HabitFeedbackHost(app, activeScope)
        }
        Surface(Modifier.fillMaxSize().nativeGuidanceInteraction(guidanceSurfaces)
            .testTag(if (eveningTheme) "app-theme-Evening" else "app-theme-Standart"),color=MaterialTheme.colorScheme.background) {
            if (accountGate) {
                if (authState.busy && authState.user != null) AuthTransitionScreen(authState.message)
                else WelcomeScreen(authState,authController,welcomePrefs.language,preferredWelcomeLanguage) { language ->
                        preferredWelcomeLanguage = language
                        scope.launch { welcomePrefsStore.set("language",language) }
                    }
            } else {
            val accountStatus = if (activeScope.startsWith("account-"))
                "Аккаунт Genesis.\nЗащищенная локальная копия."
            else if(BuildConfig.DEBUG) "Изолированное тестовое пространство · только на этом устройстве"
            else "Локальные черновики · аккаунт не подключён"
            val saveStatus = when {
                testWorkspace -> "Сохранено на этом устройстве"
                authState.outgoingSyncIssue != null || accountTaskSync?.issue != null -> "Ошибка синхронизации"
                authState.requiresSignIn -> "Сохранено на устройстве · требуется вход"
                pendingWrites > 0 || pendingPreferences.isNotEmpty() -> "Сохранено на устройстве · ожидает синхронизации"
                authState.busy || accountTaskSync?.loading == true -> "Синхронизация…"
                pendingWrites == 0 && accountTaskSync?.confirmed == true && authState.checkedAt != null -> "Синхронизировано."
                else -> "Сохранено на этом устройстве"
            }
            val destinations = mobileDestinations(visiblePages, uiVisibility, sharedProjectsEnabled,
                prefs.settingsSubmenuEnabled)
            var editingTodayBlocks by rememberSaveable { mutableStateOf(false) }
            val guidanceTopic = when {
                mindmapsOpen -> "mindmaps"
                usageSection?.contains("dream", ignoreCase = true) == true -> "dreams"
                tab == "Дневник" -> "diary"
                tab == "Привычки" || tab == "Настройки" && usageSection == "habits" -> "habits"
                tab in setOf("Проекты", "Задачи") -> "projects"
                else -> "overview"
            }
            NativePlanGuidanceHost(nativeGuidance, guidanceSurfaces, guidanceTopic,
                blocked = creating || editId != null || creatingTaskList || creatingSharedTask || serverAssistantOpen ||
                    activeAdviceRequest != null || editingTodayBlocks || savingTask || authState.busy || authState.offerGoogleServices,
                openedSection = openedSection, upgrade = nativeUpgrade)
            val screenStates = rememberSaveableStateHolder()
            MobileWorkspaceShell(tab, menuSwipeState.section(tab), destinations, "$accountStatus\n$saveStatus",
                footerStatusLines = if (activeScope.startsWith("account-")) listOf(
                    genesisTranslate("Аккаунт Genesis.").trimEnd('.') + " · " + genesisTranslate(when {
                        authState.outgoingSyncIssue != null || accountTaskSync?.issue != null -> "Ошибка синхронизации"
                        authState.requiresSignIn -> "Требуется вход"
                        pendingWrites > 0 || pendingPreferences.isNotEmpty() || authState.busy || accountTaskSync?.loading == true -> "Синхронизация…"
                        else -> "Синхронизировано."
                    }).trimEnd('.'), genesisTranslate("Защищенная локальная копия.").trimEnd('.')) else null,
                calendarMode = prefs.display,
                gesturesEnabled = !mindmapsOpen,
                onNavigate = { destination ->
                    if (destination.page == "Календарь") {
                        calendarEntryRequest++
                        if ("calendar.month" !in uiVisibility.hiddenSubmenus) menuSwipeState.calendar = "month"
                    }
                    destination.section?.let { menuSwipeState.select(destination.page, it) }
                    tab = destination.page
                }, actions = {
                    if(tab=="Сегодня")WorkspaceHeaderButton(if(editingTodayBlocks) "Готово" else "Порядок блоков","today-order-toggle",onClick={editingTodayBlocks=!editingTodayBlocks}){
                        GenesisLucideIcon(if(editingTodayBlocks)"check" else "arrow-up-down",Modifier.size(22.dp))
                    }
                    Box(Modifier.testTag("global-calendar-switch")) {
                        CalendarModeSwitcher(prefs.display, {
                            changeDisplayCalendar(nextAvailableCalendarMode(prefs.display,
                                CalendarMode.entries.filter { it.wireValue in uiVisibility.visibleCalendars }.toSet()))
                        }, size = 48.dp, interactive = uiVisibility.visibleCalendars.size > 1)
                    }
                }, footerActions = {
                    TodayThemeButton(eveningTheme, !themeSwitchBusy, plainIcon = true) {
                        themeSwitchBusy = true
                        scope.launch {
                            try {
                                val next = AppearanceSettings.read(habitWorkspace.settings.rawJson, prefs.theme)
                                    .copy(mode = if (eveningTheme) "light" else "evening")
                                habitSettingsRepository.updateAppearance(next.json())
                                themeSwitchError = null
                                val theme = if (next.mode == "evening") "standart-dark" else "standart"
                                if (!testWorkspace && authState.user != null) authController.updateSharedPreference("theme", theme)
                                else prefsStore.set("theme", theme)
                            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
                            catch (_: Exception) { themeSwitchError = "Не удалось сохранить тему. Повторите попытку." }
                            finally { themeSwitchBusy = false }
                        }
                    }
                    AndroidUpdateCheckAction(plainIcon = true, onStatus = { updateCheckMessage = it })
                    val refreshBusy = !testWorkspace && (authState.busy || accountTaskSync?.loading == true)
                    WorkspaceAccountRefreshButton(genesisTranslate(if (refreshBusy)
                        "Получаем изменения с сервера…" else "$saveStatus. Обновить аккаунт"),
                        enabled = !refreshBusy, onClick = { if (!testWorkspace) authController.refresh() })
                }, footerDetails = {
                    if (prefs.updateRemindersEnabled) AndroidUpdateBanner(compact = true)
                    updateCheckMessage?.let { WorkspaceStatusNotice(it,
                        Modifier.padding(horizontal = 16.dp, vertical = 4.dp).testTag("drawer-update-status")) }
                    if (!testWorkspace && authState.requiresSignIn) WorkspaceStatusNotice(
                        "Для синхронизации повторите вход. Данные и напоминания доступны на устройстве.",
                        Modifier.padding(horizontal = 16.dp, vertical = 4.dp).testTag("drawer-sign-in-notice")) {
                        TextButton(onClick = { authController.checkSession(); tab = "Настройки" }) {
                            Text("Открыть вход через Google")
                        }
                    }
                    themeSwitchError?.let { WorkspaceStatusNotice(it,
                        Modifier.padding(horizontal = 16.dp, vertical = 4.dp), isError = true) }
                    NativePlanGuidanceNotice(nativeGuidance, nativeUpgrade,
                        Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
                    if (!testWorkspace) ru.genesis.calendar.auth.WorkspaceSyncNotice(authState,
                        authController::syncPending, authController::keepLocalWorkspaceChanges,
                        authController::keepRemoteWorkspaceChanges)
                    if (!testWorkspace && accountTaskSync != null) {
                        ru.genesis.calendar.auth.AccountTaskSyncNotice(accountTaskSync,
                            Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
                    }
                }) {
                if (!testWorkspace && authState.user != null && authState.accountSettings != null) {
                    key(authState.user!!.uid) { EmailVerificationNotice(authState.user!!.uid, authState.user!!.email,
                        authState.accountSettings!!.emailVerification, authController)
                        SupportNotice(authState.user!!.uid,authState.accountSettings!!.emailVerification,authController) }
                }
                HabitNotificationAccessNotice(app,habitTrackingEnabled &&
                    habitWorkspace.habits.any { it.reminder.enabled })
                val personalAffairsContent: @Composable (MenuSwipeState) -> Unit = { visibleSwipeState ->
                    if(mindmapsOpen && authState.user!=null) {
                        val uid=authState.user!!.uid
                        val currentMapsRepo=mapsRepo ?: error("Карта недоступна.")
                        key(uid) {MindmapsScreen(currentMapsRepo,tasks,structure.projects,mindmapProjectId,
                            onBack={mindmapsOpen=false},onTask={task,date->if(task.recurrence.enabled&&date!=null){val draft=ru.genesis.calendar.data.TaskOccurrences.standaloneDraft(task,date);scope.launch {currentMapsRepo.saveConversionDraft(draft);mindmapTaskDraft=draft;newTaskProjectId=draft.projectId;newTaskListId=null;editId=null;creating=true}}else {editId=task.id;creating=false}},
                            onCreate={draft->scope.launch {currentMapsRepo.saveConversionDraft(draft);mindmapTaskDraft=draft;newTaskProjectId=draft.projectId;newTaskListId=null;editId=null;creating=true}},
                            onComplete={task,date->if(task.recurrence.enabled&&date!=null)model.completeOccurrence(task,date)else model.complete(task)},onProject={requestedMindmapProject=it;mindmapsOpen=false})}
                    } else {
                    ProjectsScreen(app,tasks,true, taskLists=taskLists, use24=prefs.use24,
                        onMindmaps={mindmapProjectId=it;mindmapsOpen=true},
                        initialProjectId=requestedMindmapProject,onInitialProjectConsumed={requestedMindmapProject=null},
                        onOpenTask={ editId=it;creating=false },
                        onCreateTask={ newTaskEntryType="task";newTaskProjectId=it;newTaskListId=null;editId=null;creating=true },
                        onCreateEntry={ project, kind -> newTaskEntryType=kind;newTaskProjectId=project;newTaskListId=null;editId=null;creating=true },
                        onCreateList={creatingTaskList=true},
                        onCreateListTask={ list -> newTaskListId=list.id;newTaskProjectId=structure.taskListLinks
                            .firstOrNull { it.taskListId==list.id }?.projectId;editId=null;creating=true },
                        onDeleteTask=model::delete,onCompleteTask=model::complete,
                        onUpdateList={ list,title ->
                            val updated=authController.updateTaskList(list,title)
                            tasks.filter { it.taskListId()==list.id }.forEach { task ->
                                val fields=org.json.JSONObject(task.sourceFieldsJson)
                                if(list.accountId==null || fields.optString("googleAccountId")==list.accountId)
                                    app.repository.save(task.copy(sourceFieldsJson=fields.put("googleTaskListTitle",updated.title).toString()))
                            }
                            authController.syncPending()
                        },
                        onDeleteList={ list ->
                            authController.deleteTaskList(list)
                            tasks.filter { it.taskListId()==list.id }.forEach { task ->
                                val fields=org.json.JSONObject(task.sourceFieldsJson)
                                if(list.accountId==null || fields.optString("googleAccountId")==list.accountId)
                                    app.repository.delete(task.id)
                            }
                            authController.syncPending()
                        },
                        menuSwipeState=visibleSwipeState,
                        initialListId=requestedPersonalListId,onInitialListConsumed={requestedPersonalListId=null},
                        sharedController=authController.takeIf { sharedProjectsEnabled },
                        sharedAccount=authState.accountSettings)
                    }
                }
                val pageContent: @Composable (String, MenuSwipeState) -> Unit = { visibleTab, visibleSwipeState ->
                  Column(Modifier.fillMaxSize()) {
                  error?.let { Text(it,color=MaterialTheme.colorScheme.error,modifier=Modifier.padding(12.dp)) }
                  when(visibleTab) {
                    "Привычки" -> HabitsScreen(app,true,prefs.input,prefs.display,authState.accountSettings,taskLists,visibleSwipeState,
                        openSacredHabits=requestedSacredHabits,
                        onSacredHabitsOpened={requestedSacredHabits=false},
                        openHeroPath=requestedHeroPath,
                        onHeroPathOpened={requestedHeroPath=false},
                        hiddenSubmenus=uiVisibility.hiddenSubmenus, reminderRequest=openedHabit, diaryRepository=diaryRepository)
                    "Сакральное" -> Column(Modifier.fillMaxSize()) {
                        val sacredSubmenus = listOf(
                            SubmenuItem("stoicheion", if (prefs.language == "en") "Stoicheion" else "Стойхейон"),
                            SubmenuItem("theokyklos", if (prefs.language == "en") "Theokyklos" else "Теокиклос"))
                            .filter { "sacred.${it.id}" !in uiVisibility.hiddenSubmenus &&
                                it.id !in uiVisibility.hiddenMenuItems }
                        if (sacredSubmenus.size > 1) ConnectedSubmenu(sacredSubmenus,
                            visibleSwipeState.sacred, { menuSwipeState.sacred = it },
                            Modifier.testTag("sacred-submenu"))
                        if (visibleSwipeState.sacred == "theokyklos")
                            TheokyklosScreen(app, prefs.input,
                                onOpenHabits = { requestedSacredHabits = true; tab = "Привычки" },
                                initialSectorId = requestedTheokyklosSector,
                                onInitialSectorConsumed = { requestedTheokyklosSector = null },
                                onOpenStoicheion = { menuSwipeState.sacred = "stoicheion" })
                        else StoicheionScreen(app, prefs.divinationDisabled,
                            inputCalendarMode = prefs.input,
                            onModelingTask = { request ->
                                auroraTaskDraft=LocalTask(title=request.title,description=request.description,
                                    date=request.dueDate.orEmpty(),time=request.dueTime.orEmpty(),
                                    zoneId=request.zoneId?:java.time.ZoneId.systemDefault().id,
                                    sourceFieldsJson=org.json.JSONObject().put("auroraSourceId",request.sourceId).toString())
                                mindmapTaskDraft=null;newTaskProjectId=null;newTaskListId=null;newTaskEntryType="task";editId=null;creating=true
                                menuSwipeState.projectArea="personal";tab="Проекты"
                            },
                            onOpenHabits = { requestedSacredHabits = true; tab = "Привычки" },
                            initialCardId = requestedStoicheionCard,
                            onInitialCardOpened = { requestedStoicheionCard = null },
                            onOpenTheokyklosSector = { sectorId ->
                                requestedTheokyklosSector = sectorId
                                menuSwipeState.sacred = "theokyklos"; tab = "Сакральное"
                            })
                    }
                    "Проекты" -> Column(Modifier.fillMaxSize()) {
                        val projectSubmenus = listOf(
                            SubmenuItem("personal", if(prefs.language=="en") "Personal" else "Личные"),
                            SubmenuItem("shared", if(prefs.language=="en") "Shared" else "Общие"))
                            .filter { "projects.${it.id}" !in uiVisibility.hiddenSubmenus }
                        if (sharedProjectsEnabled && projectSubmenus.size > 1) ConnectedSubmenu(projectSubmenus,
                            visibleSwipeState.projectArea, { menuSwipeState.projectArea = it },
                            Modifier.testTag("projects-area-switch"))
                        if(sharedProjectsEnabled && visibleSwipeState.projectArea=="shared") key(invitationDestination, sharedTaskOpenRequest) {
                            SharedProjectsScreen(authController,prefs.language,invitationDestination,prefs,
                                onPrivateMessages={ space -> messagingSpaceId=space;tab="Сообщения" },
                                onProjectChat={ project -> messagingProjectId=project;tab="Сообщения" })
                        }
                        else personalAffairsContent(visibleSwipeState)
                    }
                    "Дневник" -> diaryRepository?.let { diary ->
                        DiaryScreen(diary, onClose = ::navigateBack)
                    }
                    "Сообщения" -> authState.user?.uid?.let { uid ->
                        val repository = remember(app, activeScope, uid) {
                            ru.genesis.calendar.data.MessagingRepository.room(app.database, activeScope, uid, authController.messagingGateway(uid))
                        }
                        val messenger = remember(app, activeScope, uid) {
                            ru.genesis.calendar.data.MessengerRepository.room(app.database, activeScope, uid, authController.messagingGateway(uid))
                        }
                        MessengerScreen(messenger, prefs.language, initialProjectId=messagingProjectId,
                            onInitialProjectOpened={messagingProjectId=null},
                            legacy = if(sharedProjectsEnabled) ({ back -> MessagingScreen(repository, messagingSpaceId, back) }) else null,
                            onClose=::navigateBack)
                    }
                    "Задачи" -> personalAffairsContent(visibleSwipeState)
                    "Настройки" -> SettingsScreen(app, prefs, visibleSwipeState.settings,
                        onSection = { menuSwipeState.settings = it }, authState.busy && !testWorkspace,
                        authState.accountSettings, sharedProjectsEnabled,
                        uiVisibility,
                        authController.takeIf { authState.accountSettings?.sharedProjectsEligible == true && accountAccess.allows("shared-projects") },
                        canOpenAdmin = !testWorkspace && authState.ready && !authState.requiresSignIn &&
                            authState.user != null && authState.accountSettings?.isAdmin == true,
                        adminLoad = authController::adminStats,
                        adminDelete = authController::deleteAdminUser,
                        adminGateway = nativeAdminGateway,
                        onOpenAssistant = if ((authState.accountSettings?.featureAccess ?: ru.genesis.calendar.auth.FeatureAccess()).allows("assistant") && (serverAssistantAvailable || hasAssistantPlan)) ({ serverAssistantOpen = true }) else null,
                        onSetVisibility = { next ->
                            pendingUiVisibility = next
                            authController.updateUiVisibility(next)
                        },
                        onSet = { name, value ->
                            if (name == "sharedProjectsEnabled") pendingSharedProjectsToggle = value == "true"
                            if (!testWorkspace && authState.user != null) authController.updateSharedPreference(name, value)
                            else scope.launch { prefsStore.set(name, value) }
                        }, onSetLocal = { name, value -> scope.launch { prefsStore.set(name, value) } },
                        scrollState = settingsScrollStates.getOrPut(
                            if (prefs.settingsSubmenuEnabled) visibleSwipeState.settings else "all") {
                            ScrollState(0)
                        },
                        menuVisibilityExpanded = menuVisibilityExpanded,
                        onMenuVisibilityExpanded = { menuVisibilityExpanded = it },
                        focusSolarPlace = focusSolarPlace, onSolarPlaceFocused = { focusSolarPlace = false })
                    "Календарь" -> CalendarScreen(LocalDate.parse(selected),prefs.display,
                        entryRequest = calendarEntryRequest,
                        onSelect={selected=it.toString()},
                        onModeChange=changeDisplayCalendar,
                        experimental=true, tasks=tasks, use24=prefs.use24,
                        sharedTasks=sharedCalendarEntries, sharedCounts=sharedCalendarCounts,
                        onOpenSharedProjects={ menuSwipeState.projectArea="shared"; tab="Проекты"; menuSwipeState.personalView="projects" },
                        loadSharedDay={ day ->
                            val entries = mutableListOf<SharedCalendarEntry>()
                            var cursor: String? = null
                            do {
                                val result = authController.querySharedTasks(org.json.JSONObject()
                                    .put("dueFrom", day.toString()).put("dueTo", day.toString()).put("completion", "any"), cursor)
                                val rows = result.getJSONArray("tasks")
                                for (i in 0 until rows.length()) rows.getJSONObject(i).let { row ->
                                    entries += SharedCalendarEntry(row.getString("id"), row.getString("title"), row.getString("dueDate"),
                                        row.optString("projectTitle"), !row.isNull("completedAt"), row.getString("projectId"), row.getString("spaceId"))
                                }
                                cursor = result.optString("nextCursor").takeUnless { it.isBlank() || it == "null" }
                            } while (cursor != null)
                            entries
                        },
                        onOpenSharedTask={ task ->
                            invitationDestination = SharedInvitationDestination(task.spaceId, task.projectId, task.id)
                            menuSwipeState.projectArea="shared"; tab="Проекты"; menuSwipeState.personalView="projects"
                        },
                        weekStartsOnSunday=prefs.weekStartsOnSunday,
                        gregorianYearStartsInMarch=prefs.gregorianYearStartsInMarch,
                        onStartGregorianYearInMarch={
                            if (!testWorkspace && authState.user != null)
                                authController.updateSharedPreference("gregorianYearStart", "march")
                            else scope.launch { prefsStore.set("gregorianYearStart", "march") }
                        },
                        regionalSeasonArt=prefs.regionalSeasonArt,
                        seasonRegionZone=selectedSeasonZone(prefs),
                        onCompleteTask=model::complete,
                        onCreateTask={ date ->
                            selected=date.toString(); editId=null; creating=true
                            newTaskProjectId=null; newTaskListId=null
                        },
                        onEditTask={ task, date -> selected=date.toString();editId=task.id;creating=false },
                        onDeleteTask=model::delete,
                        onDeleteOccurrence={ task, date -> model.excludeOccurrence(task,date.toString()) {} },
                        dayHabits=if(habitTrackingEnabled) { { date -> TodayHabitsContent(app,date,habitWorkspace,
                            onOpenHabits={tab="Привычки"}, showTopDivider=false) } } else null,
                        menuSwipeState=visibleSwipeState,
                        periodSwipeEnabled=!portraitMenuSwipe,
                        hiddenSubmenus=uiVisibility.hiddenSubmenus)
                    else -> SortableTodayWorkspace(savedOrder = prefs.todayBlockOrder, editing = editingTodayBlocks,
                        onOrder = { order -> scope.launch { prefsStore.set("todayBlockOrder", order.joinToString(",")) } },
                        header = {
                            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                DayHeader(LocalDate.parse(todayPageDate), prefs.display,
                                    selectedSeasonZone(prefs).takeIf { prefs.regionSource in setOf("manual", "ip") },
                                    weatherController = authController.takeUnless { testWorkspace }, use24Hour = prefs.use24,
                                    onChooseCity = { focusSolarPlace = true; menuSwipeState.settings = "region"; tab = "Настройки" })
                                if ("tasks" in uiVisibility.hiddenTodayBlocks && "quickCreate" !in uiVisibility.hiddenTodayBlocks)
                                    Button(onClick = { selected=todayPageDate; creating=true; editId=null;
                                        newTaskProjectId=null; newTaskListId=null }) {
                                        Text(if (prefs.language == "en") "Create today's task" else "Создать задачу на сегодня")
                                    }
                            }
                    }, blocks = buildList {
                            if (uiVisibility.sacredFeaturesEnabled && "rhythm" !in uiVisibility.hiddenTodayBlocks)
                                add(TodayBlock("rhythm", "Сакральное время") { DayRhythmPanel(prefs.use24) })
                            if (!testWorkspace && activeAdviceRequest == null && authState.ready && !authState.requiresSignIn) {
                                authState.user?.uid?.let { uid ->
                                    add(TodayBlock("advice", "Совет дня") {
                                    val adviceGateway = remember(authController, uid) { authController.dailyAdviceTransport(uid) }
                                    TodayAdvicePanel(adviceGateway, uid, todayPageDate, prefs.language,
                                        authState.accountSettings?.advicePreferences ?: ru.genesis.calendar.auth.AdvicePreferences(),
                                        habitWorkspace.habits, authState.checkedAt, tasks = tasks, diary = diaryRepository,
                                        onOpenDiary = { tab = "Дневник" })
                                    })
                                }
                            }
                            if (!testWorkspace && authState.ready) {
                                diaryRepository?.takeIf { uiVisibility.dreamJournalEnabled }?.let { diary -> add(TodayBlock("dream", "Дневник сновидений") {
                                    TodayDreamJournal(app, diary, prefs.display)
                                }) }
                                add(TodayBlock("ad", "Объявление") {
                                    TodayAdPanel(authController, authState.user?.uid, prefs.language)
                                })
                            }
                            if (uiVisibility.sacredFeaturesEnabled && prefs.display == CalendarMode.SACRED &&
                                "details" !in uiVisibility.hiddenTodayBlocks) {
                                add(TodayBlock("details", "О дне") {
                                Box(Modifier.fillMaxWidth().testTag("today-day-details")) {
                                    DayKnowledgePanel(LocalDate.parse(todayPageDate), prefs.display)
                                }
                                })
                            }
                        val todayDate=LocalDate.parse(todayPageDate)
                        val shown = tasks.filter { TaskOccurrences.occursOn(it, todayDate) }
                            val missed=if (prefs.showMissedTasksToday)
                                missedTasksForToday(tasks,todayDate) else emptyList()
                            if ("tasks" !in uiVisibility.hiddenTodayBlocks) add(TodayBlock("tasks", "Задачи дня") {
                                TodayTasksPanel(shown, missed, todayPageDate, prefs.use24, structure,
                                onCreate = { selected=todayPageDate;creating=true;editId=null;newTaskProjectId=null;newTaskListId=null },
                                onComplete = model::complete,
                                onMoveToToday = { task -> model.save(task.copy(date=todayDate.toString())) {} },
                                onOpen = { taskId -> selected=todayPageDate;editId=taskId;creating=false },
                                showCreate = "quickCreate" !in uiVisibility.hiddenTodayBlocks,
                                sharedController = authController.takeIf { sharedProjectsEnabled },
                                onOpenShared = { task ->
                                    sharedTaskOpenRequest++
                                    invitationDestination = SharedInvitationDestination(task.spaceId, task.projectId, task.id)
                                    menuSwipeState.projectArea="shared"; tab="Проекты"; menuSwipeState.personalView="projects"
                                })
                            })
                            if ("habits" !in uiVisibility.hiddenTodayBlocks) add(TodayBlock("habits", "Трекер привычек") { TodayHabitTrackerBlock {
                                if (habitTrackingEnabled) TodayHabitsContent(app, todayDate, habitWorkspace,
                                    onOpenHabits = { tab = "Привычки" }, showTopDivider = false)
                                TodayTrackersContent(app, todayDate, prefs)
                            } })
                    })
                  }
                  }
                }
                // Save each workspace's scroll/form UI state when another drawer destination opens.
                // No horizontal root pager: it would intercept map and calendar gestures.
                // Month and year share one date owner. Restoring a separate month subtree
                // would overwrite the date just chosen in the year overview.
                val screenKey = workspaceScreenStateKey(tab, menuSwipeState)
                Box(Modifier.fillMaxWidth().weight(1f).testTag("main-content")) {
                    screenStates.SaveableStateProvider(screenKey) {
                        CompositionLocalProvider(LocalFixedSubmenu provides true,
                            LocalCompactSubmenus provides true,
                            LocalNavigationPageContext provides NavigationPageContext(tab, true)) {
                            pageContent(tab, menuSwipeState)
                        }
                    }
                }
            }
            if (!testWorkspace && authState.ready && !authState.requiresSignIn &&
                authState.user != null && authState.accountSettings?.sharedProjectsEligible == true && accountAccess.allows("shared-projects")) {
                Box(Modifier.fillMaxSize().safeDrawingPadding().padding(start=12.dp,end=12.dp,bottom=100.dp), contentAlignment=Alignment.BottomStart) {
                    SharedInvitationNotices(authController,authState.user!!.uid,prefs.language) { destination ->
                        pendingSharedProjectsToggle = true
                        invitationDestination = destination
                        menuSwipeState.projectArea = "shared"
                        tab = "Проекты"
                    }
                }
            }
            val existing=tasks.find { it.id==editId }
            if(creating || existing!=null) TaskEditor(existing ?: mindmapTaskDraft ?: auroraTaskDraft,selected,prefs,structure,newTaskProjectId,
                authState.accountSettings,taskLists,newTaskListId,
                onDismiss={creating=false;editId=null;newTaskEntryType="task";mindmapTaskDraft=null;auroraTaskDraft=null;scope.launch {mapsRepo?.clearConversionDraft()}},
                onSave={draft -> model.saveEditor(draft){creating=false;editId=null;newTaskEntryType="task";mindmapTaskDraft=null;auroraTaskDraft=null;scope.launch {mapsRepo?.clearConversionDraft()}}},
                onSwitchToShared=if(existing==null && tab=="Проекты" && sharedProjectsEnabled) ({
                    creating=false; creatingSharedTask=true
                }) else null,
                onTransfer=existing?.takeIf { sharedProjectsEnabled }?.let { selectedTask ->
                    { transferTask=selectedTask;creating=false;editId=null }
                },
                onDelete=existing?.let{{model.delete(it);creating=false;editId=null}},
                onDeleteOccurrence=existing?.takeIf { it.recurrence.enabled }?.let { series ->
                    { date -> model.excludeOccurrence(series,date) { creating=false;editId=null } }
                },
                showSelectedOccurrence=tab=="Сегодня" || tab=="Календарь",
                saveError=error, saving=savingTask, initialEntryType=newTaskEntryType)
            if (creatingSharedTask && sharedProjectsEnabled) SharedTaskCreateDialog(authController,prefs.language,
                onDismiss={creatingSharedTask=false}, onSwitchToPersonal={creatingSharedTask=false;creating=true})
            transferTask?.let { privateTask ->
                PersonalTaskTransferDialog(privateTask,authController,authState.accountSettings,prefs.language,
                    onDismiss={transferTask=null},onMoved={ task ->
                        require(app.workspaceScope==activeScope) { "Аккаунт изменился. Откройте форму заново." }
                        app.repository.delete(task.id,task.revision)
                    })
            }
            if(creatingTaskList) TaskListEditor(structure,authState.accountSettings,prefs,
                canCreate=authState.ready && !authState.requiresSignIn && authState.user!=null &&
                    (authState.accountSettings?.authProvider != "yandex" || authState.accountSettings?.calendarConnected == true),
                sharedCanCreate=authState.ready && !authState.requiresSignIn && authState.user!=null && sharedProjectsEnabled,
                onDismiss={creatingTaskList=false;sharedListRefreshKey++},onCreate=authController::createTaskList,
                sharedController=authController.takeIf { sharedProjectsEnabled },
                onSaveTasks={list,projectId,date,rows,options ->
                    require(app.workspaceScope==activeScope) { "Аккаунт изменился. Откройте форму заново." }
                    saveListDraftTasks(app,list,projectId,date,prefs.input,rows,options);authController.syncPending()
                })
            if(serverAssistantOpen && (authState.accountSettings?.featureAccess ?: ru.genesis.calendar.auth.FeatureAccess()).allows("assistant") && diaryOwner != null && assistantGateway != null)
                ServerAssistantDialog(app,diaryOwner,assistantGateway,structure,taskLists,authState.accountSettings?.accounts.orEmpty(),
                    prefs.input,prefs.language,authController::createTaskList,
                    onDismiss={serverAssistantOpen=false},onSaved={serverAssistantOpen=false;authController.syncPending();openPersonalTasks()})
            }
        }
        if (!testWorkspace && activeAdviceRequest != null && authState.ready) {
            authState.user?.uid?.takeIf { ru.genesis.calendar.auth.CloudAccountSnapshot.scopeFor(it) == activeScope }?.let { uid ->
                val gateway = remember(authController, uid) { authController.dailyAdviceTransport(uid) }
                SavedAdviceNotificationDialog(activeAdviceRequest, gateway, prefs.language,
                    authState.accountSettings?.advicePreferences ?: ru.genesis.calendar.auth.AdvicePreferences()) {
                    closedAdviceNonce = activeAdviceRequest.nonce
                }
            }
        }
        if (!testWorkspace) GoogleServicesFirstRunModal(authState, authController)
        if (!testWorkspace && !accountGate) YandexCalendarFirstRunDialog(authState, authController)
        ReleaseNotesAutoDialog(!testWorkspace && !accountGate && !authState.offerGoogleServices)
        AndroidUpdatePrompt(app, authState.checkedAt,
            !testWorkspace && !authState.offerGoogleServices,
            offerOptional = prefs.updateRemindersEnabled)
      }
      }
    }
    LaunchedEffect(prefs.language) { app.scheduler.createChannels(prefs.language) }
}

internal fun shouldUseNavigationRail(screenWidthDp: Int, landscape: Boolean,
    wideNavigationOnLeft: Boolean): Boolean = wideNavigationOnLeft && (landscape || screenWidthDp >= 600)

@Composable
private fun AuthTransitionScreen(message: String) {
    Box(Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp)) {
            WorkspaceLoadingIndicator()
            Text("Открываем защищённое пространство", style = MaterialTheme.typography.titleMedium)
            Text(message, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun TodayTasksPanel(tasks: List<LocalTask>, missedTasks: List<LocalTask>, selected: String, use24: Boolean,
    structure: WorkspaceStructure, onCreate: () -> Unit, onComplete: (LocalTask) -> Unit,
    onMoveToToday: (LocalTask) -> Unit, onOpen: (String) -> Unit,
    showCreate: Boolean = true,
    sharedController: ru.genesis.calendar.auth.SharedWorkspaceGateway? = null,
    onOpenShared: (SharedCalendarEntry) -> Unit = {}) {
    val sharedReader = sharedController?.let { controller ->
        rememberSharedTaskListReader(controller).also { reader ->
            ObserveSharedTaskList(reader, JSONObject().put("dueFrom", selected).put("dueTo", selected)
                .put("completion", "any"), "position", "today:$selected", true, true) {}
        }
    }
    val hasShared = (sharedReader?.pageState?.value?.optInt("total") ?: 0) > 0
    Card(Modifier.fillMaxWidth().testTag("today-tasks-section"), shape = AffairsLayout.shape,
        colors = CardDefaults.cardColors(containerColor = if (LocalEveningTheme.current) MaterialTheme.colorScheme.surfaceContainerHigh else MaterialTheme.colorScheme.primaryContainer)) {
        Column(Modifier.padding(AffairsLayout.gutter), verticalArrangement = Arrangement.spacedBy((10f / 1.5f).dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Surface(Modifier.size(40.dp), shape = AffairsLayout.controlShape,
                    color = MaterialTheme.colorScheme.primaryContainer) {
                    Box(contentAlignment = Alignment.Center) {
                        GenesisVectorIcon(GenesisPageIcon.TASKS, Modifier.size(24.dp), MaterialTheme.colorScheme.primary)
                    }
                }
                Column(Modifier.weight(1f)) {
                    Text("Задачи дня", style = MaterialTheme.typography.titleLarge)
                    Text(if (tasks.isEmpty() && !hasShared) "День свободен для нового замысла" else
                        "${tasks.count { it.done }} из ${tasks.size} выполнено",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (showCreate) Button(onClick = onCreate, modifier = Modifier.heightIn(min = 48.dp).testTag("create-task")) {
                    Text("Создать")
                }
            }
            TodayTaskGroup("Личные", Modifier.testTag("today-personal-tasks"),
                titleModifier = Modifier.testTag("today-personal-tasks-title")) {
            if (tasks.isEmpty()) {
                Surface(Modifier.fillMaxWidth(), shape = AffairsLayout.shape, color = MaterialTheme.colorScheme.surface) {
                    Text(if (hasShared) "${genesisTranslate("Личные")} · 0" else "На сегодня задач нет. Можно оставить день свободным или создать задачу.",
                        Modifier.padding(14.dp), style = MaterialTheme.typography.bodyMedium)
                }
            } else tasks.forEach { task ->
                TodayTaskRow(task.done, { onOpen(task.id) }, Modifier.testTag("task-${task.id}"),
                    onComplete = { onComplete(task) }) {
                            TaskTitle(task, Modifier.testTag("task-title-${task.id}"),
                                style = MaterialTheme.typography.titleMedium,occurrenceDate=LocalDate.parse(selected))
                            Text("$selected ${timeLabel(task.time, use24)} · Приоритет ${task.priority}" +
                                if (task.recurrence.enabled) " · Повторяется" else "",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            task.projectId?.let { projectId ->
                                Text(structure.projects.firstOrNull { it.id == projectId }?.title
                                    ?: task.project.ifBlank { "Проект" },
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (task.done) completedTaskInk else MaterialTheme.colorScheme.primary)
                            }
                }
            }
            TodayMissedTasksCard(missedTasks, onComplete, onMoveToToday)
            }
            sharedReader?.let { TodaySharedTasks(it, selected, onOpenShared) }
        }
    }
}

@Composable
internal fun TodayHabitTrackerBlock(content: @Composable ColumnScope.() -> Unit) {
    Surface(Modifier.fillMaxWidth().testTag("today-habit-tracker-block"), shape = AffairsLayout.shape,
        color = if (LocalEveningTheme.current) MaterialTheme.colorScheme.surfaceContainerHigh else MaterialTheme.colorScheme.secondaryContainer) {
        Column(Modifier.padding(AffairsLayout.gutter), verticalArrangement = Arrangement.spacedBy((10f / 1.5f).dp), content = content)
    }
}

@Composable
internal fun GenesisBrandLogo(modifier: Modifier = Modifier) {
    val assets = LocalContext.current.assets
    // The fixed 192px identity mark is tiny: decode once without a transient empty async slot.
    val bitmap = remember(assets) { assets.open("originals/icons/icon-192.png").use {
        android.graphics.BitmapFactory.decodeStream(it)
    }.asImageBitmap() }
    Box(modifier.shadow(3.dp, CircleShape).clip(CircleShape)
        .background(MaterialTheme.colorScheme.surface)
        .border(1.dp, Brush.linearGradient(listOf(Color(0xffe4c78c), Color(0xff203e35))), CircleShape)
        .padding(2.dp).testTag("drawer-brand-logo")) {
        Image(bitmap, "GENESIS", Modifier.fillMaxSize().clip(CircleShape), contentScale = ContentScale.Crop)
    }
}

@Composable
fun OriginalImage(path: String, description: String?, modifier: Modifier=Modifier, dimInDarkTheme: Boolean = true,
    darkThemeBrightness: Float = 1f, lightThemeBrightness: Float = 1f, artworkTint: Color? = null,
    alignment: Alignment = Alignment.Center) {
    val context=LocalContext.current
    var imageWidth by remember(path) { mutableIntStateOf(0) }
    var imageHeight by remember(path) { mutableIntStateOf(0) }
    // Buckets avoid restarting a decode on small layout changes while scrolling.
    val bucketWidth = ((imageWidth + 127) / 128) * 128
    val bucketHeight = ((imageHeight + 127) / 128) * 128
    var bitmap by remember(path,bucketWidth,bucketHeight) {
        mutableStateOf(OriginalImageLoader.cached(path, bucketWidth, bucketHeight))
    }
    LaunchedEffect(path,bucketWidth,bucketHeight) {
        if (bitmap == null) bitmap=withContext(Dispatchers.IO) {
            runCatching { OriginalImageLoader.load(context.assets, path, bucketWidth, bucketHeight) }.getOrNull()
        }
    }
    val localizedDescription = description?.let { genesisTranslate(it) }
    val brightness = if (LocalEveningTheme.current) darkThemeBrightness else lightThemeBrightness
    Box((if(LocalEveningTheme.current && dimInDarkTheme) modifier.alpha(.86f) else modifier)
        .then(if (artworkTint != null) Modifier.graphicsLayer {
            compositingStrategy = androidx.compose.ui.graphics.CompositingStrategy.Offscreen
        } else Modifier).onSizeChanged {
        imageWidth = it.width; imageHeight = it.height
    }) {
        bitmap?.let { image -> Image(image.asImageBitmap(),localizedDescription,
            Modifier.fillMaxSize(),contentScale=ContentScale.Crop, alignment=alignment,
            colorFilter = if (brightness != 1f)
                androidx.compose.ui.graphics.ColorFilter.colorMatrix(androidx.compose.ui.graphics.ColorMatrix().apply {
                    setToScale(brightness, brightness, brightness, 1f)
                }) else null)
            if (artworkTint != null) Image(image.asImageBitmap(), null,
                Modifier.fillMaxSize().graphicsLayer {
                    blendMode = androidx.compose.ui.graphics.BlendMode.Color
                }, contentScale = ContentScale.Crop, alignment=alignment,
                colorFilter = androidx.compose.ui.graphics.ColorFilter.colorMatrix(todayHeroArtworkMask(artworkTint)))
        }
    }
}

/** The display calendar is controlled by the shared app bar, never by this day card. */
@Composable
internal fun DayHeader(date: LocalDate, mode: CalendarMode, explicitSeasonZone: ZoneId? = null,
    weatherController: ru.genesis.calendar.auth.AuthController? = null, use24Hour: Boolean = true,
    onChooseCity: () -> Unit = {}) {
    val calendar = remember { GenesisCalendar() }
    val solarLocation by rememberAutomaticSolarLocation(calendar.zoneId)
    val language = LocalGenesisLanguage.current
    val sacredFeaturesEnabled = LocalSacredFeaturesEnabled.current
    val copy = remember(date, mode, language, sacredFeaturesEnabled) {
        todayHeroCopy(date, if (sacredFeaturesEnabled) mode else CalendarMode.PROFANE, calendar, language)
    }
    val civilDate = date.format(DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.forLanguageTag(language)))
    val lightHero = !LocalEveningTheme.current
    val heroSecondary = if (lightHero) MaterialTheme.colorScheme.onSurface.copy(alpha = .90f) else Color(0xfffff8e9)
    val moon = if (sacredFeaturesEnabled && mode == CalendarMode.LUNAR) remember(date) { calendar.moonInfo(date) } else null
    Card(Modifier.fillMaxWidth().testTag("today-hero"), shape = AffairsLayout.shape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        if (!sacredFeaturesEnabled) {
            val regionZone = explicitSeasonZone
                ?: runCatching { solarLocation.timeZoneId?.let(ZoneId::of) }.getOrNull() ?: calendar.zoneId
            CivilTodayHero(solarLocation, calendar, regionZone, weatherController, use24Hour, onChooseCity)
        } else Box(Modifier.fillMaxWidth()) {
            OriginalImage(copy.imagePath,
                null, Modifier.matchParentSize().testTag("today-calendar-image"), dimInDarkTheme = false,
                lightThemeBrightness = 1f,
                artworkTint = todayHeroArtworkTint(mode, LocalEveningTheme.current, LocalDarkPalette.current),
                alignment = if (mode == CalendarMode.LUNAR) Alignment.CenterEnd else Alignment.Center)
            Box(Modifier.matchParentSize().background(
                if (lightHero) Color.Transparent else Color.Black.copy(alpha = .16f)))
            CompositionLocalProvider(LocalPreserveCalendarColors provides true,
                LocalTodayHeroTint provides MaterialTheme.colorScheme.primaryContainer.copy(alpha=if(mode==CalendarMode.PROFANE).15f else .10f)) {
            androidx.compose.material3.Surface(Modifier.fillMaxWidth().testTag("today-hero-copy"),
                shape = AffairsLayout.shape, border = BorderStroke(1.dp, Color(0x80dfc17e)),
                color = if (lightHero) Color.Transparent else Color.Black.copy(alpha = .48f),
                contentColor = if (lightHero) MaterialTheme.colorScheme.onSurface else Color.White) {
                    Column(Modifier.padding(6.dp), verticalArrangement = Arrangement.spacedBy(AffairsLayout.gap)) {
                        TodayHeroGroup("today-hero-context") {
                            if (mode == CalendarMode.LUNAR) {
                                // Only the day/date reserve room for the moon; month context gets the full width.
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top,
                                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Text(copy.title, style = MaterialTheme.typography.headlineSmall, fontFamily = GenesisHeadingFont)
                                        Text(copy.footerDate, Modifier.testTag("today-civil-date"),
                                            style = MaterialTheme.typography.bodyMedium)
                                    }
                                    moon?.let {
                                        Column(Modifier.width(96.dp).testTag("today-lunar-phase"), horizontalAlignment = Alignment.CenterHorizontally,
                                            verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                            MoonPhaseIcon(it.phaseStep, Modifier.testTag("today-lunar-disc"), size = 80.dp)
                                            Text(lunarTriadCopyForDay(it.day).getString("name"),
                                                Modifier.testTag("today-lunar-epithet"), style = MaterialTheme.typography.labelLarge,
                                                color = heroSecondary, translate = false, maxLines = 1)
                                        }
                                    }
                                }
                                Text(mobileCalendarCopy(language).calendarName(mode), Modifier.testTag("today-calendar-name"),
                                    style = MaterialTheme.typography.labelMedium, color = heroSecondary)
                                val monthLine = copy.lunarContext?.let {
                                    "${genesisTranslate(copy.month)} — ${genesisTranslate(it.monthTitle)}"
                                } ?: genesisTranslate(copy.month)
                                Text(monthLine, Modifier.fillMaxWidth().testTag("today-hero-month"),
                                    style = MaterialTheme.typography.labelLarge, color = heroSecondary,
                                    maxLines = 1, softWrap = false, translate = false)
                                copy.lunarContext?.let {
                                    Text(it.progress, Modifier.testTag("today-lunar-progress"),
                                        style = MaterialTheme.typography.bodySmall, color = heroSecondary)
                                }
                                moon?.let {
                                    Text("${it.direction} · ${it.phase} · ${it.illumination}%", Modifier.testTag("today-lunar-description"),
                                        style = MaterialTheme.typography.bodyMedium)
                                }
                                copy.badge?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = heroSecondary) }
                            } else {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top,
                                horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text(copy.title, style = MaterialTheme.typography.headlineSmall, fontFamily = GenesisHeadingFont)
                                    Text(if (mode == CalendarMode.PROFANE) civilDate else copy.footerDate,
                                        Modifier.testTag("today-civil-date"), style = MaterialTheme.typography.bodyMedium)
                                    if (mode == CalendarMode.PROFANE) Text(copy.footerDate, Modifier.testTag("today-hero-date"),
                                        style = MaterialTheme.typography.labelMedium, color = heroSecondary)
                                    Text(mobileCalendarCopy(language).calendarName(mode), Modifier.testTag("today-calendar-name"),
                                        style = MaterialTheme.typography.labelMedium, color = heroSecondary)
                                    Text(copy.month.uppercase(Locale.forLanguageTag(language)), Modifier.testTag("today-hero-month"),
                                        style = MaterialTheme.typography.labelLarge, color = heroSecondary)
                                    if (mode == CalendarMode.PROFANE) Text(gregorianYearPosition(date, language),
                                        Modifier.testTag("today-gregorian-year-position"),
                                        style = MaterialTheme.typography.bodySmall, color = heroSecondary)
                                }
                                moon?.let {
                                    Box(Modifier.size(64.dp).testTag("today-lunar-phase"), contentAlignment = Alignment.Center) {
                                        MoonPhaseIcon(it.phaseStep, size = 48.dp)
                                    }
                                }
                            }
                            moon?.let {
                                Text(it.epithet, Modifier.testTag("today-lunar-epithet"),
                                    style = MaterialTheme.typography.titleMedium, color = heroSecondary)
                                Text("${it.direction} · ${it.phase} · ${it.illumination}%", Modifier.testTag("today-lunar-description"),
                                    style = MaterialTheme.typography.bodyMedium)
                            }
                            }
                        }
                        TodayHeroGroup("today-hero-meaning") {
                            copy.subtitle?.takeIf { mode != CalendarMode.PROFANE }?.let {
                                Text(it, style = MaterialTheme.typography.titleMedium)
                            }
                            Text(copy.description, Modifier.testTag("today-hero-description"), style = MaterialTheme.typography.bodyMedium)
                            if (mode == CalendarMode.PROFANE) copy.details.firstOrNull()?.let {
                                Text(it, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                        // Today stays compact; the full day reference remains in Month.
                        val additionalDetails = if (mode == CalendarMode.SACRED) copy.details else emptyList()
                        if (additionalDetails.isNotEmpty()) TodayHeroGroup("today-hero-details") {
                            additionalDetails.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
                        }
                        TodaySolarTimes(date, solarLocation, calendar)
                        copy.badge?.takeIf { mode != CalendarMode.LUNAR }?.let {
                            Text(it, style = MaterialTheme.typography.labelMedium, color = heroSecondary)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TodayHeroGroup(tag: String, content: @Composable ColumnScope.() -> Unit) {
    androidx.compose.material3.Surface(Modifier.fillMaxWidth().testTag(tag), shape = AffairsLayout.shape,
        color = todayHeroBlockBackground(),
        contentColor = if (LocalEveningTheme.current) Color.White else MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, if (LocalEveningTheme.current) Color(0xffffe7ae).copy(alpha = .18f)
            else MaterialTheme.colorScheme.outlineVariant.copy(alpha=.6f))) {
        Column(Modifier.padding(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp), content = content)
    }
}

@Composable
internal fun TaskEditor(task:LocalTask?,selected:String,prefs:UiPreferences,structure:WorkspaceStructure,initialProjectId:String?,
    accountSettings:ru.genesis.calendar.auth.AccountSettings?, taskLists:List<GoogleTaskList>, initialTaskListId:String?, onDismiss:()->Unit,
    onSave:(LocalTask)->Unit,onSwitchToShared:(()->Unit)?=null,onTransfer:(()->Unit)?,onDelete:(()->Unit)?,onDeleteOccurrence:((String)->Unit)?,showSelectedOccurrence:Boolean,
    startDeleteConfirmation:Boolean=false, saveError:String?=null, saving:Boolean=false, initialEntryType:String="task") {
    var title by rememberSaveable(task?.id) { mutableStateOf(task?.title ?: "") }
    var description by rememberSaveable(task?.id) { mutableStateOf(task?.description ?: "") }
    var date by rememberSaveable(task?.id) { mutableStateOf(task?.date ?: selected) }
    var formCalendarMode by rememberSaveable(task?.id) { mutableStateOf(
        task?.sourceFieldsJson?.let { raw -> runCatching { JSONObject(raw).optString("calendarMode") }.getOrNull() }
            ?.takeIf { it in setOf("profane", "sacred", "lunar") }?.let(CalendarMode::fromWire) ?: prefs.input) }
    var time by rememberSaveable(task?.id) { mutableStateOf(task?.time ?: "") }
    var priority by rememberSaveable(task?.id) { mutableIntStateOf(task?.priority ?: 5) }
    var recurrence by remember(task?.id) { mutableStateOf(task?.recurrence ?: defaultTaskRecurrence(task?.date ?: selected, prefs.input)) }
    var projectId by rememberSaveable(task?.id,initialProjectId) { mutableStateOf(if (task != null) task.projectId else initialProjectId) }
    var listId by rememberSaveable(task?.id,initialTaskListId) { mutableStateOf(if (task != null) task.taskListId() else initialTaskListId) }
    val selectedList = taskLists.firstOrNull { it.id==listId }
    val routing=accountSettings?.routing
    val originalTargets=remember(task?.id,accountSettings) {
        task?.sourceFieldsJson?.let { raw -> runCatching { JSONObject(raw).optJSONArray("syncAccountIds") }.getOrNull() }
            ?.let { array -> (0 until array.length()).map { array.optString(it) } }
            ?.takeIf { it.isNotEmpty() } ?: routing?.defaultAccountIds.orEmpty()
    }
    var syncTargets by remember(task?.id,accountSettings) { mutableStateOf(originalTargets) }
    var reminders by remember(task?.id) { mutableStateOf(task?.reminders ?: task?.reminderAt?.let {
        listOf(TaskReminder.absolute(it)) } ?: emptyList()) }
    var customReminder by remember { mutableStateOf(false) }
    var customRelative by remember { mutableStateOf(true) }
    var customAmount by rememberSaveable { mutableStateOf("1") }
    var customUnit by remember { mutableIntStateOf(60) }
    var absoluteDate by rememberSaveable { mutableStateOf(date) }
    var absoluteTime by rememberSaveable { mutableStateOf(time.ifBlank { "09:00" }) }
    var absoluteCalendarMode by rememberSaveable(task?.id) { mutableStateOf(prefs.input) }
    val yandex = accountSettings?.authProvider == "yandex"
    val yandexFields = remember(task?.id) { JSONObject(task?.sourceFieldsJson ?: "{}") }
    var entryType by rememberSaveable(task?.id, initialEntryType) { mutableStateOf(yandexFields.optString("entryType", initialEntryType)) }
    var yandexEntryType by rememberSaveable(task?.id) { mutableStateOf(yandexFields.optString("yandexEntryType", if (entryType in setOf("event", "meeting")) "meeting" else "task")) }
    var yandexEndDate by rememberSaveable(task?.id) { mutableStateOf(yandexFields.optString("endDate").takeIf { it.matches(Regex("\\d{4}-\\d{2}-\\d{2}")) } ?: date) }
    var yandexEndTime by rememberSaveable(task?.id) { mutableStateOf(yandexFields.optString("yandexEndTime", yandexFields.optString("endTime"))) }
    var yandexLocation by rememberSaveable(task?.id) { mutableStateOf(yandexFields.optString("yandexLocation")) }
    var yandexTelemost by rememberSaveable(task?.id) { mutableStateOf(yandexFields.optString("yandexTelemostUrl")) }
    var yandexAttendees by rememberSaveable(task?.id) { mutableStateOf(yandexFields.optJSONArray("yandexAttendees")?.let { rows ->
        (0 until rows.length()).joinToString(", ") { rows.optString(it) } } ?: "") }
    var yandexOptionalAttendees by rememberSaveable(task?.id) { mutableStateOf(yandexFields.optJSONArray("yandexOptionalAttendees")?.let { rows ->
        (0 until rows.length()).joinToString(", ") { rows.optString(it) } } ?: "") }
    var yandexBusy by rememberSaveable(task?.id) { mutableStateOf(yandexFields.optBoolean("yandexBusy", true)) }
    var yandexVisibility by rememberSaveable(task?.id) { mutableStateOf(yandexFields.optString("yandexVisibility", "private")) }
    var yandexReminders by remember(task?.id) { mutableStateOf<List<Int>>(yandexFields.optJSONArray("yandexReminders")?.let { rows ->
        (0 until rows.length()).map { rows.optInt(it) } } ?: emptyList()) }
    val googleTaskBacked = accountSettings?.authProvider == "google" && (listId!=null || task?.sourceFieldsJson?.let { raw ->
        runCatching { JSONObject(raw).optString("googleTaskId") }.getOrNull()?.let {
            it.isNotBlank() && it != "null"
        } ?: false
    } ?: false)
    var confirmDelete by remember(task?.id) { mutableStateOf(task != null && startDeleteConfirmation) }
    var validation by remember { mutableStateOf<String?>(null) }
    var optionsExpanded by rememberSaveable(task?.id) { mutableStateOf(
        routing?.mode == "choose" && accountSettings?.multiAccountEnabled == true && syncTargets.isEmpty()) }
    val occurrenceDate = if (task?.recurrence?.enabled == true && showSelectedOccurrence &&
        runCatching { TaskOccurrences.occursOn(task,LocalDate.parse(selected)) }.getOrDefault(false)) selected
        else task?.date ?: selected
    val draftFingerprint = listOf(title, description, date, time, priority, projectId, listId,
        recurrence, reminders, syncTargets, formCalendarMode, entryType, yandexEntryType, yandexEndDate,
        yandexEndTime, yandexLocation, yandexTelemost, yandexAttendees, yandexOptionalAttendees,
        yandexBusy, yandexVisibility, yandexReminders).joinToString("\u001f")
    val originalFingerprint = rememberSaveable(task?.id) { draftFingerprint }
    var pendingExit by remember { mutableStateOf<(() -> Unit)?>(null) }
    fun requestExit(action: () -> Unit) {
        if (saving) return
        if (draftFingerprint != originalFingerprint) pendingExit = action else action()
    }
    Dialog(onDismissRequest={ requestExit(onDismiss) },properties=androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth=false)) {
        Surface(Modifier.widthIn(max = 840.dp).fillMaxWidth().padding(8.dp),shape=AffairsLayout.shape) {
            Column(Modifier.padding(horizontal = 8.dp, vertical = 16.dp).imePadding()) {
                Box(Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
                EditorDialogHeader(if (yandex) (if(task==null) "Новая запись Яндекс.Календаря" else "Изменить запись Яндекс.Календаря")
                    else if(task==null) when (entryType) { "event" -> "Новое событие"; "meeting" -> "Новая встреча"; else -> "Новая задача" } else "Изменить задачу",
                    "close-task-editor", { requestExit(onDismiss) })
                }
              Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())
                .testTag("task-editor-scroll"),
                verticalArrangement=Arrangement.spacedBy(8.dp)) {
                if (task == null && onSwitchToShared != null) Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected=true,onClick={},label={Text(if(prefs.language=="en") "Personal task" else "Личная задача")})
                    FilterChip(selected=false,onClick={ requestExit(onSwitchToShared) },
                        label={Text(if(prefs.language=="en") "Team task" else "Общая задача")},
                        modifier=Modifier.testTag("create-shared-task-switch"))
                }
                EditorSection("Основное") {
                    task?.let { PersonalTaskDiscussion(it) }
                    if (!yandex) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf("task" to "Задача", "event" to "Событие", "meeting" to "Встреча").forEach { (kind, label) ->
                            FilterChip(entryType == kind, { entryType = kind }, { Text(label) },
                                modifier = Modifier.testTag("personal-entry-$kind"))
                        }
                    }

                    OutlinedTextField(title,{title=it},label={Text("Название")},modifier=Modifier.fillMaxWidth().testTag("task-title"))
                    OutlinedTextField(description,{description=it},label={Text("Описание")},modifier=Modifier.fillMaxWidth())
                    if (yandex) {
                        Row(horizontalArrangement=Arrangement.spacedBy(6.dp)) {
                            FilterChip(yandexEntryType=="task", { yandexEntryType="task" }, label={Text("Задача")})
                            FilterChip(yandexEntryType=="meeting", { yandexEntryType="meeting" }, label={Text("Встреча")})
                        }
                    }
                }
                EditorSection("Дата и время", Modifier.testTag("task-date-time-section")) {
                    if (!yandex) Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = date.isBlank(), onCheckedChange = { blank ->
                            date = if (blank) "" else LocalDate.now().toString()
                            if (blank) { time = ""; reminders = emptyList(); recurrence = recurrence.copy(enabled = false) }
                        })
                        Text("Без даты")
                    }
                    if (date.isNotBlank()) {
                        EditorCalendarModePicker(formCalendarMode, { formCalendarMode = it }, tag = "task-form-calendar")
                        if (yandex) Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = time.isBlank(), onCheckedChange = { allDay ->
                                time = if (allDay) "" else "09:00"
                                yandexEndTime = if (allDay) "" else "09:30"
                            })
                            Text("Весь день")
                        }
                        Row(Modifier.fillMaxWidth().testTag("task-date-time-row"),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            AuthorDatePicker(date, formCalendarMode,
                                modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("task-date-picker")) { date = it }
                            if (!yandex || time.isNotBlank()) AuthorTimePicker(time, prefs.use24,
                                modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("task-time-picker")) { time = it }
                        }
                    }
                }
                EditorOptionsDisclosure(optionsExpanded, { optionsExpanded = it }) {
                ProjectHierarchyPicker(structure.projects, projectId) { projectId = it }
                if(userTaskLists(taskLists).isNotEmpty() && task==null) {
                    EditorSection("Список задач") {
                    var choosingList by remember { mutableStateOf(false) }
                    Box {
                        OutlinedButton({choosingList=true},Modifier.fillMaxWidth().testTag("task-list-picker")) {
                            Text(selectedList?.title ?: "Не добавлять в список задач")
                        }
                        DropdownMenu(choosingList,{choosingList=false}) {
                            DropdownMenuItem(text={Text("Не добавлять в список задач")},onClick={listId=null;choosingList=false})
                            userTaskLists(taskLists).forEach { list -> DropdownMenuItem(text={Text(list.title)},onClick={
                                listId=list.id
                                if (accountSettings?.authProvider == "google") { reminders=emptyList();customReminder=false }
                                if (accountSettings?.authProvider == "google") recurrence=recurrence.copy(enabled=false)
                                choosingList=false
                                projectId=structure.taskListLinks.firstOrNull{it.taskListId==list.id}?.projectId
                            }) }
                        }
                    }
                    Text("Выберите список, если задача должна находиться среди его задач.",
                        style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if(accountSettings?.multiAccountEnabled==true && accountSettings.accounts.size>1 && routing?.mode=="choose") {
                    EditorSection("Аккаунты для размещения",Modifier.testTag("task-account-section")) {
                    Text("Выберите один или несколько аккаунтов для этой задачи.",
                        style=MaterialTheme.typography.bodySmall)
                    accountSettings.accounts.forEach { account ->
                        Row(Modifier.fillMaxWidth().heightIn(min=48.dp),verticalAlignment=Alignment.CenterVertically) {
                            Checkbox(checked=account.id in syncTargets,onCheckedChange={ checked ->
                                syncTargets=if(checked) (syncTargets+account.id).distinct()
                                    else syncTargets.filterNot { it==account.id }
                            })
                            Text(account.email,style=MaterialTheme.typography.bodyMedium)
                        }
                    }
                    }
                }
                if (!yandex && entryType in setOf("event", "meeting") && date.isNotBlank()) EditorSection("Окончание") {
                    AuthorDatePicker(yandexEndDate, formCalendarMode, minDate = LocalDate.parse(date),
                        modifier = Modifier.fillMaxWidth().testTag("personal-entry-end-date")) { yandexEndDate = it }
                    if (time.isNotBlank()) AuthorTimePicker(yandexEndTime, prefs.use24) { yandexEndTime = it }
                }
                if (yandex) {
                    if (yandexEntryType == "meeting") {
                        EditorSection("Детали встречи") {
                        Text("Окончание встречи")
                        AuthorDatePicker(yandexEndDate, formCalendarMode) { yandexEndDate=it }
                        if (time.isNotBlank()) AuthorTimePicker(yandexEndTime, prefs.use24) { yandexEndTime=it }
                        OutlinedTextField(yandexAttendees,{yandexAttendees=it},label={Text("Участники · адреса через запятую")},modifier=Modifier.fillMaxWidth())
                        OutlinedTextField(yandexOptionalAttendees,{yandexOptionalAttendees=it},label={Text("Необязательные участники")},modifier=Modifier.fillMaxWidth())
                        OutlinedTextField(yandexLocation,{yandexLocation=it},label={Text("Место")},modifier=Modifier.fillMaxWidth())
                        OutlinedTextField(yandexTelemost,{yandexTelemost=it},label={Text("Ссылка на Телемост")},modifier=Modifier.fillMaxWidth())
                        }
                    }
                    EditorSection("Настройки Яндекс.Календаря") {
                    Text("Занятость")
                    Row(horizontalArrangement=Arrangement.spacedBy(6.dp)) {
                        FilterChip(yandexBusy,{yandexBusy=true},label={Text("Занят")})
                        FilterChip(!yandexBusy,{yandexBusy=false},label={Text("Свободен")})
                    }
                    Text("Видимость")
                    Row(horizontalArrangement=Arrangement.spacedBy(6.dp)) {
                        FilterChip(yandexVisibility=="private",{yandexVisibility="private"},label={Text("Только участники")})
                        FilterChip(yandexVisibility=="public",{yandexVisibility="public"},label={Text("Все")})
                    }
                    Text("Напоминания Яндекс.Календаря",style=MaterialTheme.typography.titleMedium)
                    Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(6.dp)) {
                        listOf(0 to "В момент",10 to "10 мин",30 to "30 мин",60 to "1 час",1440 to "1 день").forEach { (minutes,label) ->
                            FilterChip(minutes in yandexReminders,{ yandexReminders=if(minutes in yandexReminders)
                                yandexReminders.filterNot { it==minutes } else (yandexReminders+minutes).take(5) },label={Text(label)})
                        }
                    }
                    Text("Выбранные даты преобразуются в григорианские по часовому поясу устройства.",style=MaterialTheme.typography.bodySmall)
                    }
                }
                EditorSection("Приоритет") { PriorityControl(priority){priority=it} }
                if(task?.recurrence?.enabled==true) Text(
                    "Сохранение изменит всю серию. При удалении можно выбрать только $occurrenceDate.",
                    style=MaterialTheme.typography.bodySmall,
                    color=MaterialTheme.colorScheme.onSurfaceVariant)
                if(!googleTaskBacked && date.isNotBlank()) TaskRecurrenceEditor(recurrence,date,prefs.input) { recurrence=it;validation=null }
                EditorSection("Напоминания") {
                Text((if (yandex) "Дополнительные напоминания GENESIS" else "Напомнить") + " · ${reminders.size}/5",style=MaterialTheme.typography.titleMedium)
                Text(if (yandex) "Эти напоминания показываются самим GENESIS на устройстве; настройки выше отправляются в Яндекс.Календарь."
                    else "Число показывает, сколько напоминаний добавлено. Для события Google Calendar доступно не более пяти.",
                    style=MaterialTheme.typography.bodySmall,
                    color=MaterialTheme.colorScheme.onSurfaceVariant)
                if(googleTaskBacked) Text("Для задачи из списка Google Tasks напоминания здесь недоступны; они поддерживаются для событий Google Calendar.",
                    style=MaterialTheme.typography.bodySmall)
                if(reminders.isEmpty()) Text("Без напоминания",style=MaterialTheme.typography.bodySmall)
                reminders.forEach { reminder ->
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                        Text(if(reminder.kind=="relative") ru.genesis.calendar.data.formatRelativeTaskReminder(requireNotNull(reminder.minutes),LocalGenesisLanguage.current) else
                            Instant.ofEpochMilli(requireNotNull(reminder.at)).atZone(ZoneId.systemDefault())
                                .format(DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm")),Modifier.weight(1f))
                        TextButton(enabled=!googleTaskBacked,onClick={reminders=reminders.filterNot { it.key==reminder.key }}) { Text("Убрать") }
                    }
                }
                Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(4.dp)) {
                    listOf(10 to "10 мин",30 to "30 мин",60 to "1 час",1440 to "1 день").forEach { (minutes,label) ->
                        FilterChip(selected=reminders.any{it.kind=="relative" && it.minutes==minutes},
                            enabled=!googleTaskBacked && date.isNotBlank() && (reminders.size<5 || reminders.any{it.kind=="relative" && it.minutes==minutes}),
                            onClick={ val spec=TaskReminder.relative(minutes)
                                reminders=if(reminders.any{it.key==spec.key}) reminders.filterNot{it.key==spec.key}
                                    else reminders+spec },label={Text(label)})
                    }
                }
                OutlinedButton(enabled=customReminder || (!googleTaskBacked && reminders.size<5),
                    onClick={customReminder=!customReminder},
                    modifier=Modifier.testTag("custom-reminder-toggle")) {
                    Text(if(customReminder) "Свернуть" else "+ Своё напоминание")
                }
                if(customReminder && !googleTaskBacked && date.isNotBlank()) {
                    Row { FilterChip(selected=customRelative,onClick={customRelative=true},label={Text("За время до задачи")})
                        FilterChip(selected=!customRelative,onClick={customRelative=false},label={Text("Точная дата и время")}) }
                    if(customRelative) {
                        OutlinedTextField(customAmount,{customAmount=it},label={Text("Целое число")},singleLine=true)
                        Row(Modifier.horizontalScroll(rememberScrollState())) {
                            listOf(1 to "Мин",60 to "Часы",1440 to "Дни",10080 to "Недели").forEach { (unit,label) ->
                                FilterChip(selected=customUnit==unit,onClick={customUnit=unit},label={Text(label)})
                            }
                        }
                    } else {
                        EditorCalendarModePicker(absoluteCalendarMode,
                            { absoluteCalendarMode=it }, tag="reminder-form-calendar")
                        Text("Дата напоминания · ${calendarModeLabel(absoluteCalendarMode)}")
                        AuthorDatePicker(absoluteDate,absoluteCalendarMode){absoluteDate=it}
                        AuthorTimePicker(absoluteTime,prefs.use24){absoluteTime=it}
                    }
                    Row {
                        TextButton(onClick={customReminder=false}) { Text("Отмена") }
                        Button(onClick={
                            val spec=if(customRelative) customAmount.toIntOrNull()?.let { count ->
                                (count.toLong()*customUnit).takeIf { it in 0..40_320 }?.let { TaskReminder.relative(it.toInt()) }
                            } else runCatching { TaskReminder.absolute(LocalDate.parse(absoluteDate)
                                .atTime(LocalTime.parse(absoluteTime)).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()) }.getOrNull()
                            val start=runCatching { LocalDate.parse(date).atTime(LocalTime.parse(time.ifBlank { "00:00" }))
                                .atZone(ZoneId.systemDefault()).toInstant().toEpochMilli() }.getOrNull()
                            validation=when {
                                spec==null || start==null -> "Введите корректную дату, время и интервал до четырёх недель."
                                spec.kind=="absolute" && (requireNotNull(spec.at)>start || start-requireNotNull(spec.at)>40_320L*60_000) ->
                                    "Точная дата должна быть не позже задачи и не раньше четырёх недель до неё."
                                reminders.any{it.key==spec.key} -> "Такое напоминание уже добавлено."
                                else -> null
                            }
                            if(validation==null && spec!=null) { reminders=reminders+spec;customReminder=false }
                        }) { Text("Добавить") }
                    }
                }
                }
                onDelete?.let { TextButton(onClick={confirmDelete=true},enabled=!saving){Text("Удалить задачу")} }
                onTransfer?.let { TextButton(onClick=it,enabled=!saving){Text(if(prefs.language=="en") "Move to shared" else "Переместить в общие")} }
                }
              }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                saveError?.let { Text(it, color=MaterialTheme.colorScheme.error,
                    modifier=Modifier.testTag("task-save-error"), style=MaterialTheme.typography.bodySmall) }
                validation?.let { Text(it,color=MaterialTheme.colorScheme.error) }
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
                    TextButton(onClick={ requestExit(onDismiss) },enabled=!saving){Text("Отмена")}
                    Button(enabled=!saving && title.isNotBlank() && (routing?.mode!="choose" ||
                        accountSettings?.multiAccountEnabled!=true || syncTargets.isNotEmpty()),onClick={
                        val start = runCatching { LocalDate.parse(date) }.getOrNull()
                        val end = runCatching { LocalDate.parse(recurrence.rangeEnd) }.getOrNull()
                        val occurrenceCount = if (!recurrence.enabled || googleTaskBacked) 1 else runCatching {
                            RecurrenceEngine(GenesisCalendar()).buildDates(date, recurrence.copy(rangeStart = date)).size
                        }.getOrDefault(0)
                        validation = when {
                            date.isNotBlank() && start == null -> "Выберите корректную дату задачи."
                            (entryType in setOf("event", "meeting") || yandex && yandexEntryType == "meeting") && time.isNotBlank() &&
                                (runCatching { LocalDateTime.parse("${yandexEndDate}T${yandexEndTime}") }.getOrNull()
                                    ?.isAfter(runCatching { LocalDateTime.parse("${date}T${time}") }.getOrNull()) != true) ->
                                "Окончание встречи должно быть позже её начала."
                            (entryType in setOf("event", "meeting") || yandex && yandexEntryType == "meeting") && yandexEndDate < date ->
                                "Окончание встречи должно быть позже её начала."
                            yandex && yandexEntryType == "meeting" &&
                                (yandexAttendees + "," + yandexOptionalAttendees).split(',', ';', '\n')
                                    .map(String::trim).filter(String::isNotBlank).any { !android.util.Patterns.EMAIL_ADDRESS.matcher(it).matches() } ->
                                "Проверьте адреса участников встречи."
                            yandex && yandexTelemost.isNotBlank() &&
                                !Regex("https://telemost\\.yandex\\.[a-z.]+/[A-Za-z0-9/_?=&%-]+").matches(yandexTelemost.trim()) ->
                                "Укажите корректную ссылку Яндекс Телемоста."
                            recurrence.enabled && (start == null || end == null || end < start || end > start.plusYears(5).minusDays(1)) ->
                                "Период повторения — от даты задачи до пяти лет."
                            recurrence.enabled && occurrenceCount !in 1..500 ->
                                "Серия должна содержать от 1 до 500 повторений."
                            else -> null
                        }
                        val source = JSONObject(task?.sourceFieldsJson ?: "{}")
                        source.put("calendarMode",formCalendarMode.wireValue).put("entryType", if (entryType == "birthday") entryType else if (yandex) if (yandexEntryType == "meeting") "meeting" else "task" else entryType)
                        if (!yandex && entryType in setOf("event", "meeting")) source.put("endDate", yandexEndDate).put("endTime", yandexEndTime)
                        if (yandex) {
                            source.put("yandexEntryType", yandexEntryType)
                                .put("yandexEndTime", yandexEndTime).put("yandexLocation", yandexLocation.trim())
                                .put("yandexTelemostUrl", yandexTelemost.trim())
                                .put("yandexBusy", yandexBusy).put("yandexVisibility", yandexVisibility)
                                .put("yandexReminders", JSONArray(yandexReminders))
                                .put("yandexAttendees", JSONArray(yandexAttendees.split(',', ';', '\n').map(String::trim).filter(String::isNotBlank)))
                                .put("yandexOptionalAttendees", JSONArray(yandexOptionalAttendees.split(',', ';', '\n').map(String::trim).filter(String::isNotBlank)))
                                .put("dueDate", date).put("endDate", if (yandexEntryType == "meeting") yandexEndDate else date)
                        }
                        if((task==null || task.revision==0L) && selectedList!=null) {
                            val listFields=listTaskFields(selectedList,prefs.input)
                            listFields.keys().forEach { field -> source.put(field,listFields.get(field)) }
                        } else if(routing?.mode=="choose" && accountSettings?.multiAccountEnabled==true && accountSettings.accounts.size>1)
                            source.put("syncAccountIds",JSONArray(syncTargets))
                        else if(task==null || task.categoryId!=structure.projects.firstOrNull{it.id==projectId}?.categoryId)
                            source.remove("syncAccountIds")
                        if (validation != null) optionsExpanded = true
                        if (validation == null) onSave((task ?: LocalTask(title=title)).copy(title=title.trim(),description=description,date=date,time=time,priority=priority,
                            reminderAt=reminders.firstOrNull{it.kind=="absolute"}?.at,reminders=reminders,
                            projectId=projectId,categoryId=structure.projects.firstOrNull{it.id==projectId}?.categoryId,
                            recurrence=if (recurrence.enabled && !googleTaskBacked) RecurrenceEngine(GenesisCalendar()).resolve(date,recurrence.copy(rangeStart=date))
                                else recurrence.copy(enabled=false,rangeStart="",rangeEnd=""),
                            recurrenceExcludedDates=if(recurrence.enabled) task?.recurrenceExcludedDates ?: emptyList() else emptyList(),
                            sourceFieldsJson=source.toString()))
                    },modifier=Modifier.testTag("save-task")){Text("Сохранить")}
                }
            }
        }
    }
    pendingExit?.let { action -> AlertDialog(onDismissRequest = { pendingExit = null },
        title = { Text("Отменить изменения?") },
        text = { Text("Несохранённые изменения будут потеряны.") },
        confirmButton = { TextButton(onClick = { pendingExit = null; action() },
            modifier = Modifier.testTag("discard-task-draft")) { Text("Отменить изменения") } },
        dismissButton = { TextButton(onClick = { pendingExit = null },
            modifier = Modifier.testTag("keep-task-draft")) { Text("Продолжить редактирование") } }) }
    if(confirmDelete && task != null && onDelete != null) AlertDialog(onDismissRequest={confirmDelete=false},
        title={Text(if(onDeleteOccurrence!=null) "Удалить повторение?" else "Удалить задачу?")},
        text={Text(if(onDeleteOccurrence!=null) "Можно удалить только $occurrenceDate или всю серию."
            else "Напоминание этой задачи будет отменено.")},
        confirmButton={ if (onDeleteOccurrence != null) DialogActionRow(
            DialogIconAction("Отмена", AffairsAction.BACK, { confirmDelete = false }),
            DialogIconAction("Только этот день", AffairsAction.CALENDAR,
                { onDeleteOccurrence(occurrenceDate); confirmDelete = false }, destructive = true,
                modifier = Modifier.testTag("delete-occurrence")),
            DialogIconAction("Вся серия", AffairsAction.DELETE, { onDelete?.invoke(); confirmDelete = false },
                destructive = true, modifier = Modifier.testTag("delete-series"))
        ) else TextButton(onClick = { onDelete?.invoke(); confirmDelete = false },
            modifier = Modifier.testTag("delete-series")) { Text("Удалить") }
        },
        dismissButton=if(onDeleteOccurrence != null) null else ({TextButton(onClick={confirmDelete=false}){Text("Отмена")}}))
}

private fun projectPath(projects: List<GenesisProject>, selectedId: String?): List<GenesisProject> {
    val byId = projects.associateBy { it.id }
    val result = mutableListOf<GenesisProject>()
    val visited = mutableSetOf<String>()
    var cursor = selectedId?.let(byId::get)
    while (cursor != null && visited.add(cursor.id)) {
        result += cursor
        cursor = cursor.parentId?.let(byId::get)
    }
    return result.asReversed()
}

@Composable
internal fun ProjectHierarchyPicker(projects: List<GenesisProject>, selectedId: String?,
    onSelect: (String?) -> Unit) {
    val sorted = remember(projects) {
        projects.groupBy { it.parentId }.mapValues { (_, values) ->
            values.sortedWith(compareBy<GenesisProject> { it.position }.thenBy { it.title })
        }
    }
    val path = remember(projects, selectedId) { projectPath(projects, selectedId) }
    EditorSection("Проект", Modifier.testTag("project-picker-section")) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        FilterChip(selected = selectedId == null || selectedId == "__genesis_inbox__",
            onClick = { onSelect(null) }, label = { Text("Хаос-бокс") })
        sorted[null].orEmpty().forEach { project ->
            FilterChip(selected = selectedId == project.id, onClick = { onSelect(project.id) },
                label = { Text(project.title) })
        }
    }
    path.forEachIndexed { depth, parent ->
        val children = sorted[parent.id].orEmpty()
        if (children.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(if (depth == 0) "Подпроекты «${parent.title}»" else "Следующий уровень «${parent.title}»",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary)
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    children.forEach { child ->
                        FilterChip(selected = selectedId == child.id, onClick = { onSelect(child.id) },
                            label = { Text(child.title) })
                    }
                }
            }
        }
    }
    if (path.isNotEmpty()) {
        Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = AffairsLayout.shape) {
            Text("Выбрано: ${path.joinToString(" › ") { it.title }}",
                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 9.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer)
        }
    }
    }
}

@Composable
private fun SettingsScreen(app:GenesisApplication,prefs:UiPreferences,sectionId:String,
    onSection:(String)->Unit,sharedBusy:Boolean,
    accountSettings:ru.genesis.calendar.auth.AccountSettings?,
    sharedProjectsEnabled:Boolean,
    visibility: ru.genesis.calendar.auth.UiVisibility,
    sharedController:ru.genesis.calendar.auth.AuthController?,
    canOpenAdmin: Boolean, adminLoad: suspend () -> JSONObject,
    adminDelete: suspend (String, Boolean) -> JSONObject,
    onSetVisibility:(ru.genesis.calendar.auth.UiVisibility)->Unit,
    onSet:(String,String)->Unit, onSetLocal:(String,String)->Unit,
    scrollState: ScrollState, menuVisibilityExpanded: Boolean,
    onMenuVisibilityExpanded: (Boolean) -> Unit, adminGateway: ru.genesis.calendar.auth.AdminGateway? = null,
    onOpenAssistant: (() -> Unit)? = null, focusSolarPlace: Boolean = false,
    onSolarPlaceFocused: () -> Unit = {}) {
    var refresh by remember { mutableIntStateOf(0) }
    var calendarReference by rememberSaveable { mutableStateOf<String?>(null) }
    var adminOpen by rememberSaveable { mutableStateOf(false) }
    var releaseNotesOpen by rememberSaveable { mutableStateOf(false) }
    val request=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()){refresh++}
    val scope=rememberCoroutineScope()
    val habits = remember(app, app.workspaceScope) { HabitsRepository(app) }
    val workspace by habits.workspace.collectAsStateWithLifecycle(LocalHabitWorkspace())
    val rows by produceState(emptyList<ReminderRecord>(),refresh) { value=withContext(Dispatchers.IO){app.database.dao().reminders(app.workspaceScope)} }
    val notificationsAllowed = rememberNotificationsAllowed(app)
    val batteryUnrestricted = app.scheduler.batteryOptimizationsIgnored()
    val diagnosticScheduledAt = app.scheduler.lastDiagnosticScheduledAt()
    val diagnosticDeliveredAt = app.scheduler.lastDiagnosticDeliveredAt()
    val futureTaskAlarms = rows.count { it.state == "pending" && it.at > System.currentTimeMillis() }
    fun diagnosticTime(value: Long) = Instant.ofEpochMilli(value).atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("dd.MM HH:mm"))
    val section = settingsSections.firstOrNull { it.id == sectionId } ?: settingsSections.first()
    Column(Modifier.fillMaxSize()) {
    if (prefs.settingsSubmenuEnabled && !LocalFixedSubmenu.current)
        SettingsSubmenu(section.id, prefs.language, prefs.settingsMenuLabels, onSection)
    SettingsPageSections(sequential = !prefs.settingsSubmenuEnabled,
        retainedScrollState = scrollState) {
        if (!prefs.settingsSubmenuEnabled) NativeAccountPlanHeader()
        (if (prefs.settingsSubmenuEnabled) listOf(section) else settingsSections).forEach { section ->
        val sectionContent: @Composable () -> Unit = {
        val sectionHeader: @Composable () -> Unit = {
            if (LocalWorkspaceHeader.current == null) GenesisPageHeader(if (prefs.settingsSubmenuEnabled)
                "${if (prefs.language == "en") "Settings" else "Настройки"} - ${section.title(prefs.language)}"
            else section.title(prefs.language),
            section.description(prefs.language), "⚙", icon = section.icon)
        }
        if (prefs.settingsSubmenuEnabled && LocalNativeUpgrade.current != null) Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            sectionHeader()
            NativeAccountPlanHeader()
        } else sectionHeader()
        when (section.id) {
        "appearance" -> {
        AppearancePanel(app, workspace, prefs.use24, prefs.theme, { onSet("theme", it) },
            darkPalette = prefs.darkPalette, onPalette = { onSet("darkPalette", it) })
        MenuDisplaySettings {
            MenuVisibilitySettings(prefs, accountSettings, sharedProjectsEnabled,
                visibility, onSetVisibility, menuVisibilityExpanded,
                onMenuVisibilityExpanded)
        }
        LanguageSettings(prefs.language) { onSet("language", it) }
        CalendarTimeSettings(prefs, visibility, sharedBusy, onSet, onSetLocal) {
            calendarReference = it
        }
        SettingsSection("Σ", "Стойхейон", "Управление картами без отключения алфавита",
            Color(0xffeee9f4)) {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Гадания по картам",style=MaterialTheme.typography.titleMedium)
                    Text("Карты дня и расклад можно скрыть; буквы и значения останутся доступны.",
                        style=MaterialTheme.typography.bodySmall,color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked=!prefs.divinationDisabled,
                    onCheckedChange={onSet("stoicheionDivinationDisabled",(!it).toString())},
                    enabled=!sharedBusy,
                    modifier=Modifier.testTag("stoicheion-divination-setting"))
            }
        }
        if (accountSettings != null && sharedController != null) {
            val adviceUser = sharedController.state.collectAsStateWithLifecycle().value.user?.uid
            if (adviceUser != null) key(adviceUser) {
                DailyAdviceSettings(accountSettings.advicePreferences, accountSettings.adviceAvailableCategories,
                    accountSettings.adviceCatalogAvailable, prefs.language, !sharedBusy,accountSettings.adviceCollectionsReady, use24 = prefs.use24) { patch ->
                    sharedController.saveAdvicePreferences(adviceUser, patch)
                }
            }
        }
        SettingsSection("!", "Пропущенные задачи", "Напоминание внутри раздела «Сегодня»",
            Color(0xffffebe4)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Напоминать о пропущенных задачах", style = MaterialTheme.typography.titleSmall)
                    Text("Показывать невыполненные задачи прошлых дней с возможностью перенести их на сегодня.",
                        style = MaterialTheme.typography.bodySmall)
                }
                Switch(checked = prefs.showMissedTasksToday,
                    onCheckedChange = { onSetLocal("showMissedTasksToday", it.toString()) },
                    modifier = Modifier.testTag("show-missed-tasks-today"))
            }
        }
        WeatherDisplaySettings(LocalWeatherDisplayUnits.current,
            onTemperature = { onSetLocal("weatherTemperatureUnit", it) },
            onPressure = { onSetLocal("weatherPressureUnit", it) })
        }
        "habits" -> HabitSettingsPanel(app, prefs.use24, visibility.dreamJournalEnabled, accountSettings!=null) { onSetVisibility(visibility.copy(dreamJournalEnabled=it)) }
        "reminders" -> {
        if (LocalSacredFeaturesEnabled.current) MoonReminderSettings(app, prefs, onSetLocal)
        sharedController?.let { EmailNotificationSettings(it,prefs.use24) }
        SettingsSection("◷", "Системные напоминания", "Проверка разрешений и точности Android",
            Color(0xfffff1cf)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SettingsStatusTile("Уведомления", if(notificationsAllowed) "Включены" else "Выключены",
                    notificationsAllowed, Modifier.weight(1f))
                SettingsStatusTile("Доставка", if(app.scheduler.exactAllowed()) "Точная" else "Приблизительная",
                    app.scheduler.exactAllowed(), Modifier.weight(1f))
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SettingsStatusTile("Резерв", "${app.scheduler.scheduledHabitAlarmCount() + futureTaskAlarms} событий",
                    notificationsAllowed, Modifier.weight(1f))
                SettingsStatusTile("Батарея", if(batteryUnrestricted) "Без оптимизации" else "Система",
                    batteryUnrestricted, Modifier.weight(1f))
            }
            Text("Каналы: задачи · ${if(app.scheduler.channelAllowed()) "включён" else "выключен"}; привычки · ${if(app.scheduler.channelAllowed(ru.genesis.calendar.reminders.ReminderScheduler.HABIT_CHANNEL)) "включены" else "выключены"}",
                style = MaterialTheme.typography.bodyMedium)
            Button(onClick={
                if(Build.VERSION.SDK_INT>=33 && !app.scheduler.notificationsAllowed()) request.launch(Manifest.permission.POST_NOTIFICATIONS)
                else app.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,app.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)){Text("Настроить уведомления")}
            if(Build.VERSION.SDK_INT in 31..32 && !app.scheduler.exactAllowed()) OutlinedButton(onClick={
                app.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:${app.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)){Text("Точное время напоминаний")}
            if(Build.VERSION.SDK_INT>=33 && !app.scheduler.exactAllowed())
                Text("Android может задерживать сигналы. Проверьте разрешения GENESIS в настройках устройства.",
                    style=MaterialTheme.typography.bodySmall,color = Color(0xff7a5521))
            Text("Точные системные сигналы дополнены резервной доставкой WorkManager. После перезагрузки, обновления и возврата из настроек расписание восстанавливается автоматически.",
                style = MaterialTheme.typography.bodySmall)
            app.scheduler.lastRecoveryAt().takeIf { it > 0 }?.let {
                Text("Последнее восстановление расписания · ${diagnosticTime(it)}",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.testTag("notification-last-recovery"))
            }
            OutlinedButton(onClick={scope.launch{app.scheduler.restore(recoverOverdue = true);app.scheduler.restoreHabitNotifications();refresh++}},
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)){Text("Проверить расписание")}
            OutlinedButton(onClick={app.scheduler.scheduleDiagnosticNotification();refresh++},
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("notification-diagnostic-schedule")) {
                Text("Проверить уведомление через 1 минуту")
            }
            if (diagnosticScheduledAt > 0) {
                Text(if (diagnosticDeliveredAt >= diagnosticScheduledAt)
                    "Последняя проверка доставлена · ${diagnosticTime(diagnosticDeliveredAt)}"
                else "Проверка назначена · ${diagnosticTime(diagnosticScheduledAt)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (diagnosticDeliveredAt >= diagnosticScheduledAt) Color(0xff255b59) else Color(0xff7a5521),
                    modifier = Modifier.testTag("notification-diagnostic-status"))
            }
            OutlinedButton(onClick={app.startActivity(appBatterySettingsIntent(app.packageName))},
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("notification-battery-settings")) {
                Text("Открыть системные настройки батареи")
            }
            samsungNeverSleepingAppsIntent()?.let { samsungIntent ->
                OutlinedButton(onClick={
                    if (runCatching { app.startActivity(samsungIntent); true }.getOrDefault(false).not())
                        app.startActivity(appBatterySettingsIntent(app.packageName))
                }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .testTag("notification-samsung-never-sleeping")) {
                    Text("Samsung: никогда не спящие приложения")
                }
                Text("One UI может снова перенести редко используемое приложение в сон. После обновления Samsung проверьте, что GENESIS остаётся в списке «Никогда не спящие приложения».",
                    style = MaterialTheme.typography.bodySmall)
            }
            Text("Принудительную остановку приложения Android не разрешает обходить. После неё откройте GENESIS один раз — расписание восстановится.",
                style = MaterialTheme.typography.bodySmall)
            rows.sortedBy{it.at}.takeLast(8).forEach{Text("Напоминание · ${it.state} · ${Instant.ofEpochMilli(it.at).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("dd.MM HH:mm"))}",style=MaterialTheme.typography.bodySmall)}
        }
        }
        "shared" -> SettingsSection("◈", "Общие дела", "Совместная работа в GENESIS", Color(0xffe9ede5)) {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Общие дела",style=MaterialTheme.typography.titleSmall)
                    Text(if(accountSettings?.sharedProjectsLifetimeAccess==true)
                        "Пожизненный бесплатный открытый доступ к функциям «Общие дела»."
                        else "Открыто всем аккаунтам GENESIS на время тестирования.",style=MaterialTheme.typography.bodySmall)
                }
                Switch(checked=sharedProjectsEnabled,
                    enabled=accountSettings?.sharedProjectsEligible==true && accountSettings.featureAccess.allows("shared-projects"),
                    onCheckedChange={onSet("sharedProjectsEnabled",it.toString())},
                    modifier=Modifier.testTag("shared-projects-toggle"))
            }
            if (sharedController != null) SharedInvitationInbox(sharedController, prefs.language, sharedProjectsEnabled)
        }
        "region" -> {
        SeasonRegionSettings(prefs, onSetLocal)
        SolarPlaceSettings(focusSolarPlace, onSolarPlaceFocused)
        }
        "account" -> {
        if (!BuildConfig.PLAY_DISTRIBUTION) {
            SettingsSection("↻", "Обновления приложения", "Уведомления о новых версиях GENESIS",
                Color(0xffe6f0eb)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Напоминать о новых версиях", style = MaterialTheme.typography.titleSmall)
                        Text("Показывать предложение после синхронизации и плашку в боковой панели.",
                            style = MaterialTheme.typography.bodySmall)
                    }
                    Switch(checked = prefs.updateRemindersEnabled,
                        onCheckedChange = { onSetLocal("updateRemindersEnabled", it.toString()) },
                        modifier = Modifier.testTag("update-reminders-toggle"))
                }
            }
            AndroidUpdateCheckAction(iconOnly = false)
        }
            ru.genesis.calendar.auth.AuthPanel(app, prefs.language)
            NativeBackupEntry()
            onOpenAssistant?.let { open ->
                OutlinedButton(onClick = open, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .testTag("open-server-assistant")) {
                    Text("Серверный помощник")
                }
            }
            if (canOpenAdmin) OutlinedButton(onClick = { adminOpen = true },
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("open-native-admin")) {
                Text("Админ-панель")
            }
        }
        "links" -> {
        SettingsSection("↗", "Ссылки GENESIS", "Академия, поддержка и веб-версия",
            Color(0xfffff5df)) {
            ru.genesis.calendar.auth.GenesisLinksPanel()
        }
        TextButton(onClick = { releaseNotesOpen = true },
            modifier = Modifier.fillMaxWidth().testTag("open-release-notes")) {
            Text("${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}) · ${releaseNotesTitle()}",
                style = MaterialTheme.typography.labelSmall)
        }
        }
        }
        }
        if (prefs.settingsSubmenuEnabled) sectionContent()
        else Surface(modifier = Modifier.fillMaxWidth().testTag("settings-section-${section.id}"),
            shape = AffairsLayout.shape,
            color = MaterialTheme.colorScheme.surfaceContainerLow,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                sectionContent()
            }
        }
        }
    }
    }
    calendarReference?.let { value ->
        CalendarReferenceDialog(CalendarMode.fromWire(value)) { calendarReference = null }
    }
    if (adminOpen && canOpenAdmin) NativeAdminPanel(onClose = { adminOpen = false },
        load = adminLoad, deleteUser = adminDelete, gateway = adminGateway, use24 = prefs.use24)
    if (releaseNotesOpen) ReleaseNotesDialog { releaseNotesOpen = false }
}

@Composable
private fun SettingsSubsection(title: String, modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit) {
    SettingsPreferenceCard(title, modifier, content = content)
}

@Composable
private fun LanguageSettings(language: String, onLanguage: (String) -> Unit) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    SettingsSubsection("Язык интерфейса") {
        OutlinedButton(onClick = { expanded = !expanded },
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                .testTag("appearance-language-toggle")) {
            Text(if (expanded) {
                if (language == "en") "Hide languages" else "Свернуть выбор языка"
            } else {
                if (language == "en") "Choose language" else "Выбрать язык"
            })
        }
        AnimatedVisibility(expanded) {
            LanguageChips(language, flagsOnly = true, onLanguage = onLanguage)
        }
    }
}

@Composable
private fun CalendarTimeSettings(prefs: UiPreferences,
    visibility: ru.genesis.calendar.auth.UiVisibility, sharedBusy: Boolean,
    onSet: (String, String) -> Unit, onSetLocal: (String, String) -> Unit,
    onOpenReference: (String) -> Unit) {
    SettingsSubsection("Календари и время", Modifier.testTag("calendar-settings-section")) {
            if (visibility.sacredFeaturesEnabled) {
            Text("Справочная информация", style = MaterialTheme.typography.titleSmall)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(CalendarMode.PROFANE to "Григорианский", CalendarMode.SACRED to "Сакральный",
                    CalendarMode.LUNAR to "Лунный").filter { it.first.wireValue in visibility.visibleCalendars }.forEach { (mode, label) ->
                    val accent = when (mode) {
                        CalendarMode.PROFANE -> if (LocalEveningTheme.current) Color(0xff73b8aa) else Color(0xff2d7065)
                        CalendarMode.SACRED -> if (LocalEveningTheme.current) Color(0xffe4bd64) else Color(0xff92621d)
                        CalendarMode.LUNAR -> if (LocalEveningTheme.current) Color(0xffb6a5df) else Color(0xff68539d)
                    }
                    OutlinedButton(onClick = { onOpenReference(mode.wireValue) },
                        modifier = Modifier.weight(1f).heightIn(min = 52.dp)
                            .testTag("calendar-reference-${mode.wireValue}"),
                        colors = ButtonDefaults.outlinedButtonColors(
                            containerColor = accent.copy(alpha = if (LocalEveningTheme.current) .16f else .12f),
                            contentColor = MaterialTheme.colorScheme.onSurface),
                        border = BorderStroke(1.dp, accent.copy(alpha = .82f)),
                        contentPadding = PaddingValues(horizontal = 3.dp, vertical = 7.dp)) {
                        CompactChoiceLabel(label)
                    }
                }
            }
            listOf("display" to "Календарь отображения","input" to "Календарь ввода и повторений").forEach{(key,label)->
                Text(label, style = MaterialTheme.typography.titleSmall)
                Row(Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)) { CalendarMode.entries
                        .filter { it.wireValue in visibility.visibleCalendars }.forEach { mode->
                    FilterChip(selected=(if(key=="display") prefs.display else prefs.input)==mode,onClick={onSet(key,mode.wireValue)},
                        enabled=!sharedBusy,
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                            .testTag("$key-calendar-${mode.wireValue}"),
                        label={CompactChoiceLabel(when(mode){CalendarMode.SACRED->"Сакральный";CalendarMode.LUNAR->"Лунный";else->"Григорианский"})})
                } }
            }
            }
            AnimatedVisibility(prefs.display == CalendarMode.PROFANE) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.testTag("gregorian-week-start-setting")) {
                    Text(genesisTranslate("Начало недели"), style = MaterialTheme.typography.titleSmall)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = !prefs.weekStartsOnSunday,
                            onClick = { onSet("weekStart", "monday") },
                            enabled = !sharedBusy,
                            modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                                .testTag("week-start-monday"),
                            label = { Text(genesisTranslate("Понедельник")) })
                        FilterChip(selected = prefs.weekStartsOnSunday,
                            onClick = { onSet("weekStart", "sunday") },
                            enabled = !sharedBusy,
                            modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                                .testTag("week-start-sunday"),
                            label = { Text(genesisTranslate("Воскресенье")) })
                    }
                    Text("Начало григорианского года", style = MaterialTheme.typography.titleSmall)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = !prefs.gregorianYearStartsInMarch,
                            onClick = { onSet("gregorianYearStart", "january") }, enabled = !sharedBusy,
                            modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("year-start-january"),
                            label = { Text("С января") })
                        FilterChip(selected = prefs.gregorianYearStartsInMarch,
                            onClick = { onSet("gregorianYearStart", "march") }, enabled = !sharedBusy,
                            modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("year-start-march"),
                            label = { Text("С марта") })
                    }
                    Text("Март был первым месяцем древнеримского года: сентябрь означал «седьмой», октябрь — «восьмой». Январь назван в честь Януса, божества начал и переходов.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("Иллюстрации времён года", style = MaterialTheme.typography.titleSmall)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = !prefs.regionalSeasonArt,
                            onClick = { onSetLocal("seasonArtMode", "static") },
                            modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("season-art-static"),
                            label = { Text("Статичные") })
                        FilterChip(selected = prefs.regionalSeasonArt,
                            onClick = { onSetLocal("seasonArtMode", "regional") },
                            modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("season-art-regional"),
                            label = { Text("По региону") })
                    }
                    Text("Выбор действует для григорианского и сакрального календарей. У Апейрона одна космическая иллюстрация для всех регионов. Источник региона выбирается выше; в григорианском календаре Южного полушария сезоны меняются местами.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Text("Формат времени", style = MaterialTheme.typography.titleSmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf("24h","12h").forEach {
                FilterChip(selected=prefs.use24==(it=="24h"),onClick={onSet("time",it)},
                    enabled=!sharedBusy,label={Text(it)})
            } }
        }
}

@Composable
private fun MenuDisplaySettings(visibilityContent: @Composable ColumnScope.() -> Unit) {
    SettingsSubsection("Отображение меню") {
            Text("Основные разделы открываются кнопкой меню. Смахивания внутри календаря переключают период, а внутри карты перемещают полотно.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            visibilityContent()
    }
}

@Composable
private fun MenuVisibilitySettings(prefs: UiPreferences,
    accountSettings: ru.genesis.calendar.auth.AccountSettings?,
    sharedProjectsEnabled: Boolean, visibility: ru.genesis.calendar.auth.UiVisibility,
    onSetVisibility: (ru.genesis.calendar.auth.UiVisibility) -> Unit,
    expanded: Boolean, onExpandedChange: (Boolean) -> Unit) {

    fun submenuHidden(id: String): Boolean = id in visibility.hiddenSubmenus ||
        (id.startsWith("sacred.") && id.substringAfter('.') in visibility.hiddenMenuItems)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                Text(genesisTranslate("Сакральные функции"), Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                Switch(checked = visibility.sacredFeaturesEnabled, enabled = accountSettings != null,
                    onCheckedChange = { onSetVisibility(visibility.copy(sacredFeaturesEnabled = it)) },
                    modifier = Modifier.testTag("sacred-features-toggle"))
            }
            Text(genesisTranslate("Оракул, сакральный календарь и практики. Отключение скрывает эти функции, сохраняя ваши задачи, привычки и настройки."),
                style = MaterialTheme.typography.bodySmall)
            Text(if (prefs.language == "en") "Menu item display" else "Отображение элементов меню",
                style = MaterialTheme.typography.titleMedium)
            OutlinedButton(onClick = { onExpandedChange(!expanded) },
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .testTag("appearance-menu-toggle")) {
                Text(if (expanded) {
                    if (prefs.language == "en") "Hide menu item settings" else "Свернуть настройки элементов меню"
                } else {
                    if (prefs.language == "en") "Customize menu items" else "Настроить элементы меню"
                })
            }
            AnimatedVisibility(expanded) {
                Column(Modifier.fillMaxWidth().testTag("appearance-menu-content"),
                    verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(if (prefs.language == "en") "Today and Settings always remain available."
                else "«Сегодня» и «Настройки» всегда доступны.", style = MaterialTheme.typography.bodySmall)
            Text(if (prefs.language == "en") "Main menu" else "Главное меню", style = MaterialTheme.typography.titleSmall)
            menuVisibilityDestinations().forEach { destination ->
                val fixed = destination.page in setOf("Сегодня", "Настройки")
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    GenesisVectorIcon(destination.icon, Modifier.size(24.dp), animated = false)
                    Text(genesisTranslate(destination.title), Modifier.weight(1f))
                    Switch(checked = fixed || menuDestinationVisible(destination, visibility),
                        enabled = !fixed && accountSettings != null,
                        onCheckedChange = { onSetVisibility(setMenuDestinationVisible(destination, visibility, it)) },
                        modifier = Modifier.testTag("menu-visibility-${destination.page}-${destination.section}"))
                }
            }
            Text(if (prefs.language == "en") "Submenus" else "Подменю", style = MaterialTheme.typography.titleSmall)
            val submenus = listOf("Личные дела" to "projects.personal", "Общие дела" to "projects.shared",
                "Месяц" to "calendar.month", "Год" to "calendar.year",
                "Стойхейон" to "sacred.stoicheion", "Теокиклос" to "sacred.theokyklos")
            submenus.forEach { (label, id) ->
                val group = id.substringBefore('.')
                val lastVisible = !submenuHidden(id) && submenus.count {
                    it.second.startsWith("$group.") && !submenuHidden(it.second) } == 1
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(genesisTranslate(label), Modifier.weight(1f))
                    Switch(checked = !submenuHidden(id), enabled = accountSettings != null && !lastVisible &&
                        !(id == "projects.personal" && !sharedProjectsEnabled),
                        onCheckedChange = { checked -> onSetVisibility(visibility.copy(
                            hiddenMenuItems = if (checked && id.startsWith("sacred."))
                                visibility.hiddenMenuItems - id.substringAfter('.') else visibility.hiddenMenuItems,
                            hiddenSubmenus = if (checked) visibility.hiddenSubmenus - id else visibility.hiddenSubmenus + id)) },
                        modifier = Modifier.testTag("submenu-visibility-$id"))
                }
            }
            Text(if (prefs.language == "en") "Today" else "Экран «Сегодня»", style = MaterialTheme.typography.titleSmall)
            listOf("Ритм дня" to "rhythm", "Быстрое создание" to "quickCreate",
                "Задачи дня" to "tasks", "Трекер привычек" to "habits", "Подробности дня" to "details")
                .forEach { (label, id) ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(genesisTranslate(label), Modifier.weight(1f))
                        Switch(checked = id !in visibility.hiddenTodayBlocks,
                            enabled = accountSettings != null,
                            onCheckedChange = { checked -> onSetVisibility(visibility.copy(
                                hiddenTodayBlocks = if (checked) visibility.hiddenTodayBlocks - id
                                    else visibility.hiddenTodayBlocks + id)) },
                            modifier = Modifier.testTag("today-visibility-$id"))
                    }
                }
            Text(if (prefs.language == "en") "Available calendars" else "Доступные календари",
                style = MaterialTheme.typography.titleSmall)
            listOf(CalendarMode.PROFANE to "Григорианский", CalendarMode.SACRED to "Сакральный",
                CalendarMode.LUNAR to "Лунный").forEach { (mode, label) ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(genesisTranslate(label), Modifier.weight(1f))
                    Switch(checked = mode.wireValue in visibility.visibleCalendars,
                        enabled = accountSettings != null && visibility.sacredFeaturesEnabled &&
                            !(visibility.enabledCalendars.size == 1 && mode.wireValue in visibility.enabledCalendars),
                        onCheckedChange = { checked -> onSetVisibility(visibility.copy(
                            enabledCalendars = if (checked) visibility.enabledCalendars + mode.wireValue
                                else visibility.enabledCalendars - mode.wireValue)) },
                        modifier = Modifier.testTag("calendar-visibility-${mode.wireValue}"))
                }
            }

                }
            }
    }
}

@Composable
internal fun SettingsSection(symbol: String, title: String, subtitle: String, color: Color,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit) {
    SettingsPreferenceCard(title, modifier, description = subtitle, content = content)
}

@Composable
private fun SettingsStatusTile(label: String, value: String, active: Boolean, modifier: Modifier = Modifier) {
    val accessibleLabel = genesisTranslate(label)
    val accessibleValue = genesisTranslate(value)
    val accessibleState = genesisTranslate(if (active) "Работает" else "Требует внимания")
    Surface(modifier.semantics(mergeDescendants = true) {
        contentDescription = "$accessibleLabel: $accessibleValue"
        stateDescription = accessibleState
    }, shape = AffairsLayout.shape,
        color = if(active) Color(0xffe4efe9) else Color(0xffffe0d6),
        border = BorderStroke(1.dp, if(active) Color(0x66255b59) else Color(0x66a5543f))) {
        Column(Modifier.padding(11.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(if(active) "✓" else "!", color = if(active) Color(0xff255b59) else Color(0xffa5543f),
                style = MaterialTheme.typography.titleMedium)
            Text(label, style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.titleSmall)
        }
    }
}
