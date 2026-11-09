package ru.genesis.calendar.ui

import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop

internal data class SwipeDestination(val page: String, val section: String? = null)

internal fun workspaceScreenStateKey(page: String, state: MenuSwipeState): String =
    if (page == "Календарь") "calendar" else "$page-${state.section(page) ?: "root"}"

class MenuSwipeState {
    var tasks by mutableStateOf("tasks")
    var personalView by mutableStateOf("projects")
    var projects by mutableStateOf("all")
    var projectArea by mutableStateOf("personal")
    var calendar by mutableStateOf("month")
    var habits by mutableStateOf("Привычки")
    var sacred by mutableStateOf("stoicheion")
    var settings by mutableStateOf("appearance")

    fun section(page: String): String? = when (page) {
        "Задачи" -> tasks
        "Проекты" -> if (projectArea == "shared") "shared" else "personal-projects"
        "Календарь" -> calendar
        "Привычки" -> habits
        "Сакральное" -> sacred
        "Настройки" -> settings
        else -> null
    }

    fun select(page: String, section: String) {
        when (page) {
            "Задачи" -> tasks = section
            "Проекты" -> {
                projectArea = if (section == "shared") "shared" else "personal"
                if (section.startsWith("personal-")) {
                    personalView = "projects"
                }
            }
            "Календарь" -> calendar = section
            "Привычки" -> habits = section
            "Сакральное" -> sacred = section
            "Настройки" -> settings = section
        }
    }
}

/** Keep the selected submenu when Android recreates the activity after a font-size change. */
internal val MenuSwipeStateSaver = listSaver<MenuSwipeState, String>(
    save = { listOf(it.tasks, it.personalView, it.projects, it.projectArea, it.calendar,
        it.habits, it.sacred, it.settings) },
    restore = { saved -> MenuSwipeState().apply {
        saved.getOrNull(0)?.let { tasks = it }
        saved.getOrNull(1)?.let { personalView = it }
        saved.getOrNull(2)?.let { projects = it }
        saved.getOrNull(3)?.let { projectArea = it }
        saved.getOrNull(4)?.let { calendar = it }
        saved.getOrNull(5)?.let { habits = it }
        saved.getOrNull(6)?.let { sacred = it }
        saved.getOrNull(7)?.let { settings = it }
    } }
)

internal fun menuSwipeSequence(includeSubmenus: Boolean, habitsEnabled: Boolean,
    sharedProjectsEnabled: Boolean = false, hiddenMenuItems: Set<String> = emptySet(),
    hiddenSubmenus: Set<String> = emptySet(),
    settingsSubmenuEnabled: Boolean = true,
    sacredFeaturesEnabled: Boolean = true): List<SwipeDestination> {
    val pages = listOf("Сегодня", "Проекты", "Календарь", "Привычки", "Сакральное", "Настройки")
        .filter { (habitsEnabled || it != "Привычки") && menuVisibilityId(it) !in hiddenMenuItems &&
            (it != "Сакральное" || (sacredFeaturesEnabled && !("stoicheion" in hiddenMenuItems && "theokyklos" in hiddenMenuItems))) }
    if (!includeSubmenus) return pages.map { SwipeDestination(it) }
    return pages.flatMap { page -> when (page) {
        "Задачи" -> listOf("tasks", "lists").filter { "tasks.$it" !in hiddenSubmenus }
            .map { SwipeDestination(page, it) }
        "Проекты" -> buildList {
            if ("projects.personal" !in hiddenSubmenus || !sharedProjectsEnabled) {
                add(SwipeDestination(page, "personal-projects"))
            }
            if (sharedProjectsEnabled && "projects.shared" !in hiddenSubmenus) add(SwipeDestination(page, "shared"))
        }
        "Календарь" -> listOf("month", "year").filter { "calendar.$it" !in hiddenSubmenus }
            .map { SwipeDestination(page, it) }
        "Привычки" -> listOf("Привычки", "Сон и настроение")
            .filter { (if (it == "Привычки") "habits.habits" else "habits.sleep") !in hiddenSubmenus }
            .map { SwipeDestination(page, it) }
        "Сакральное" -> listOf("stoicheion", "theokyklos")
            .filter { "sacred.$it" !in hiddenSubmenus && it !in hiddenMenuItems }
            .map { SwipeDestination(page, it) }
        "Настройки" -> if (settingsSubmenuEnabled)
            settingsSections.map { SwipeDestination(page, it.id) }
            else listOf(SwipeDestination(page))
        else -> listOf(SwipeDestination(page))
    } }
}

internal fun menuVisibilityId(page: String): String = when (page) {
    "Задачи" -> "tasks"; "Проекты" -> "projects"; "Календарь" -> "calendar"
    "Привычки" -> "habits"; "Сакральное" -> "sacred"
    "Дневник" -> "diary"; "Сообщения" -> "messages"
    else -> ""
}

internal fun firstVisibleSubmenu(page: String, habitsEnabled: Boolean,
    sharedProjectsEnabled: Boolean, hiddenMenuItems: Set<String>,
    hiddenSubmenus: Set<String>, settingsSubmenuEnabled: Boolean): String? =
    menuSwipeSequence(true, habitsEnabled, sharedProjectsEnabled, hiddenMenuItems,
        hiddenSubmenus, settingsSubmenuEnabled).firstOrNull { it.page == page }?.section

internal fun nextMenuSwipeDestination(sequence: List<SwipeDestination>, page: String,
    section: String?, step: Int): SwipeDestination? {
    require(step == -1 || step == 1)
    val current = sequence.indexOf(SwipeDestination(page, section)).takeIf { it >= 0 }
        ?: sequence.indexOfFirst { it.page == page }
    if (current < 0) return null
    return sequence.getOrNull(current + step)
}

/** Compose's pager keeps adjacent destinations ready before the finger reaches them. */
@Composable
internal fun MenuSwipePager(current: SwipeDestination, sequence: List<SwipeDestination>,
    enabled: Boolean, onNavigate: (SwipeDestination) -> Unit,
    onPreview: (SwipeDestination) -> Unit = {},
    modifier: Modifier = Modifier, content: @Composable (SwipeDestination) -> Unit) {
    val currentIndex = sequence.indexOf(current).takeIf { it >= 0 }
        ?: sequence.indexOfFirst { it.page == current.page }.coerceAtLeast(0)
    key(sequence) {
    val pagerState = rememberPagerState(initialPage = currentIndex) { sequence.size }
    val latestCurrent = rememberUpdatedState(current)
    val latestNavigate = rememberUpdatedState(onNavigate)
    val latestPreview = rememberUpdatedState(onPreview)
    LaunchedEffect(pagerState, currentIndex) {
        // A visibility change can assign a different destination to the same page index.
        // Align by destination before either observer starts, so that index is never
        // interpreted using the new sequence while the pager still holds the old one.
        if (pagerState.settledPage != currentIndex) pagerState.scrollToPage(currentIndex)
    }
    LaunchedEffect(pagerState, sequence) {
            snapshotFlow { pagerState.settledPage }.distinctUntilChanged().drop(1).collect { index ->
                sequence.getOrNull(index)?.takeIf { it != latestCurrent.value }?.let(latestNavigate.value)
            }
    }
    LaunchedEffect(pagerState, sequence) {
        // Preview after touch slop, before half of the next page has crossed the screen.
        // Keep the already crossed page selected while its offset returns toward zero.
        snapshotFlow {
            when {
                !pagerState.isScrollInProgress -> pagerState.settledPage
                pagerState.currentPage != pagerState.settledPage -> pagerState.currentPage
                kotlin.math.abs(pagerState.currentPageOffsetFraction) > .02f ->
                    pagerState.currentPage + if (pagerState.currentPageOffsetFraction > 0) 1 else -1
                else -> pagerState.currentPage
            }.coerceIn(0, sequence.lastIndex)
        }.distinctUntilChanged().collect { index ->
            sequence.getOrNull(index)?.let(latestPreview.value)
        }
    }
    HorizontalPager(state = pagerState, modifier = modifier.fillMaxSize(),
        userScrollEnabled = enabled, beyondViewportPageCount = 1,
        key = { index -> sequence.getOrNull(index)?.let { "${it.page}:${it.section.orEmpty()}" }
            ?: "removed:$index" }) { index ->
        sequence.getOrNull(index)?.let { destination ->
            Box(Modifier.fillMaxSize().then(if (index == pagerState.settledPage) Modifier
                else Modifier.clearAndSetSemantics { })) {
                content(destination)
            }
        }
    }
    }
}
