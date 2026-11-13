package ru.genesis.calendar.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.auth.UiVisibility
import ru.genesis.calendar.domain.CalendarMode

internal data class MobileDestination(val page: String, val section: String?, val title: String,
    val icon: GenesisPageIcon, val group: String) {
    val key: String get() = "$page-${section ?: "root"}"
}

internal class WorkspaceHeaderContent(val title: State<String>, val subtitle: State<String?>,
    val actions: State<@Composable () -> Unit>, val navigation: State<@Composable () -> Unit>,
    val singleLine: State<Boolean>, val titleIsUserContent: State<Boolean>, val expandSubtitle: State<Boolean>,
    val showThemeToggle: State<Boolean>)
internal val LocalWorkspaceHeader = staticCompositionLocalOf<MutableState<WorkspaceHeaderContent?>?> { null }
internal val LocalWorkspaceThemeToggleAllowed = staticCompositionLocalOf { true }

/** A screen owns its actions; the shell renders them before the shared calendar controls. */
@Composable
internal fun WorkspaceScreenHeader(title: String, subtitle: String? = null,
    navigation: @Composable () -> Unit = {}, singleLine: Boolean = false, titleIsUserContent: Boolean = false, expandSubtitle: Boolean = false,
    showThemeToggle: Boolean = true, actions: @Composable () -> Unit = {}): Boolean {
    val host = LocalWorkspaceHeader.current ?: return false
    val latestTitle = rememberUpdatedState(title)
    val latestSubtitle = rememberUpdatedState(subtitle)
    val latestActions = rememberUpdatedState(actions)
    val latestNavigation = rememberUpdatedState(navigation)
    val latestSingleLine = rememberUpdatedState(singleLine)
    val latestUserContent = rememberUpdatedState(titleIsUserContent)
    val latestExpandSubtitle = rememberUpdatedState(expandSubtitle)
    val latestThemeToggle = rememberUpdatedState(showThemeToggle)
    val entry = remember { WorkspaceHeaderContent(latestTitle, latestSubtitle, latestActions,
        latestNavigation, latestSingleLine, latestUserContent, latestExpandSubtitle, latestThemeToggle) }
    DisposableEffect(host) {
        host.value = entry
        onDispose { if (host.value === entry) host.value = null }
    }
    return true
}

/** The menu is derived from the same account visibility and role gates as the workspace. */
internal fun mobileDestinations(pages: List<String>, visibility: UiVisibility,
    sharedEnabled: Boolean, settingsSubmenus: Boolean): List<MobileDestination> = buildList {
    fun entry(page: String, section: String?, title: String, icon: GenesisPageIcon, group: String) {
        if (page in pages && menuVisibilityId(page) !in visibility.hiddenMenuItems) add(MobileDestination(page, section, title, icon, group))
    }
    entry("Сегодня", null, "Сегодня", GenesisPageIcon.TODAY, "Мой день")
    if (listOf("calendar.month", "calendar.year").any { it !in visibility.hiddenSubmenus })
        entry("Календарь", null, "Календарь", GenesisPageIcon.MONTH, "Мой день")
    if (!sharedEnabled || listOf("projects.personal", "projects.shared").any { it !in visibility.hiddenSubmenus })
        entry("Проекты", null, "Дела", GenesisPageIcon.PROJECTS, "Рабочее пространство")
    entry("Дневник", null, "Дневник", GenesisPageIcon.DIARY, "Рабочее пространство")
    entry("Сообщения", null, "Личные сообщения", GenesisPageIcon.MESSAGES, "Рабочее пространство")
    if ("habits.habits" !in visibility.hiddenSubmenus)
        entry("Привычки", "Привычки", "Привычки", GenesisPageIcon.HABITS, "Развитие")
    if ("habits.sleep" !in visibility.hiddenSubmenus)
        entry("Привычки", "Сон и настроение", "Сон и настроение", GenesisPageIcon.TRACKERS, "Развитие")
    if (("sacred.stoicheion" !in visibility.hiddenSubmenus && "stoicheion" !in visibility.hiddenMenuItems) ||
        ("sacred.theokyklos" !in visibility.hiddenSubmenus && "theokyklos" !in visibility.hiddenMenuItems))
        entry("Сакральное", null, "Оракул", GenesisPageIcon.ORACLE, "Развитие")
    if (settingsSubmenus) settingsSections.forEach { section ->
        entry("Настройки", section.id, if (section.id == "habits") "Настройки привычек" else section.ru, section.icon, "Настройки")
    } else entry("Настройки", null, "Настройки", GenesisPageIcon.SETTINGS, "Настройки")
}

@Composable internal fun MobileWorkspaceShell(selectedPage: String, selectedSection: String?,
    destinations: List<MobileDestination>, accountStatus: String, gesturesEnabled: Boolean,
    calendarMode: CalendarMode = CalendarMode.PROFANE,
    titleOverride: String? = null, subtitle: String? = null,
    onNavigate: (MobileDestination) -> Unit, actions: @Composable RowScope.() -> Unit,
    footerActions: @Composable RowScope.() -> Unit = {},
    footerDetails: @Composable () -> Unit = {},
    footerStatusLines: List<String>? = null,
    content: @Composable ColumnScope.() -> Unit) {
    val drawer = rememberDrawerState(DrawerValue.Closed)
    if (drawer.isOpen || drawer.targetValue != DrawerValue.Closed) NativeGuidanceBlockingSurface()
    val scope = rememberCoroutineScope()
    val backgroundStatuses = remember { mutableStateMapOf<Any, String>() }
    val pageNotices = remember { mutableStateMapOf<Any, WorkspacePageNoticeContent>() }
    val screenHeader = remember(selectedPage, selectedSection) { mutableStateOf<WorkspaceHeaderContent?>(null) }
    val current = destinations.firstOrNull { it.page == selectedPage && it.section == selectedSection }
        ?: destinations.firstOrNull { it.page == selectedPage }
    val title = titleOverride ?: if (selectedPage == "Календарь") "Календарь"
        else if (selectedPage == "Настройки") "Настройки\n${current?.title?.removePrefix("Настройки ") ?: selectedPage}"
        else current?.title ?: selectedPage
    val menuLabel = genesisTranslate("Открыть меню")
    BackHandler(drawer.isOpen) { scope.launch { drawer.close() } }
    // An open drawer can always be dismissed; closed-screen gestures belong to each feature.
    ModalNavigationDrawer(drawerState = drawer, gesturesEnabled = drawer.isOpen,
        drawerContent = {
            // Leave the underlying screen visible without reserving an empty strip in the menu.
            // Larger accessibility fonts get room to wrap instead of being clipped.
            val configuration = LocalConfiguration.current
            val preferredWidth = if (configuration.fontScale > 1.15f) 304 else 264
            val width = (configuration.screenWidthDp - 56).coerceAtMost(preferredWidth).dp
            ModalDrawerSheet(Modifier.width(width).testTag("workspace-drawer"),
                drawerShape = RoundedCornerShape(topEnd = 10.dp, bottomEnd = 10.dp),
                drawerContainerColor = MaterialTheme.colorScheme.surface,
                drawerTonalElevation = 0.dp) {
                Column(Modifier.fillMaxHeight()) {
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp, vertical = 8.dp)) {
                    Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        GenesisBrandLogo(Modifier.size(36.dp))
                        Text("Genesis Tasker", Modifier.weight(1f).padding(start = 8.dp),
                            style = MaterialTheme.typography.titleLarge)
                        val closeLabel = genesisTranslate("Закрыть меню")
                        IconButton(onClick = { scope.launch { drawer.close() } },
                            modifier = Modifier.size(48.dp).testTag("drawer-close")
                                .semantics { contentDescription = closeLabel }) {
                            AffairsActionIcon(AffairsAction.CLOSE)
                        }
                    }
                    destinations.groupBy { it.group }.forEach { (group, entries) ->
                        if (group.isNotEmpty()) Text(group, Modifier.padding(start = 16.dp, top = 16.dp, bottom = 8.dp),
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        else Spacer(Modifier.height(16.dp))
                        entries.forEach { destination ->
                            val picked = destination == current
                            val name = genesisTranslate(destination.title)
                            val selection = selectedControlColors()
                            NavigationDrawerItem(label = {
                                Text(destination.title,
                                    style = MaterialTheme.typography.bodyMedium)
                            }, icon = {
                                GenesisVectorIcon(destination.icon, Modifier.size(24.dp),
                                    tint = if (picked) selection.content
                                        else MaterialTheme.colorScheme.onSurfaceVariant)
                            }, selected = picked, onClick = {
                                onNavigate(destination)
                                scope.launch { drawer.close() }
                            }, shape = AffairsLayout.controlShape,
                                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                                    .selectedControlDecoration(picked)
                                    .testTag("drawer-${destination.page}-${destination.section ?: "root"}")
                                    .semantics { contentDescription = name },
                                colors = NavigationDrawerItemDefaults.colors(
                                    selectedContainerColor = selection.container,
                                    selectedTextColor = selection.content,
                                    selectedIconColor = selection.content,
                                    unselectedContainerColor = MaterialTheme.colorScheme.surface))
                        }
                    }
                    HorizontalDivider(Modifier.padding(top = 16.dp, bottom = 8.dp),
                        color = MaterialTheme.colorScheme.outlineVariant)
                    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)
                        .testTag("drawer-account-row"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        (footerStatusLines ?: accountStatus.lines()).filter { it.isNotBlank() }.forEachIndexed { index, line ->
                            Text(line, Modifier.fillMaxWidth().testTag("drawer-account-status-$index"), maxLines = 1,
                                style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    footerDetails()
                    pageNotices.values.forEach { notice ->
                        WorkspacePageNoticeCard(notice, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                            tag = "drawer-${notice.tag}")
                    }
                    if (backgroundStatuses.isNotEmpty()) Surface(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).testTag("drawer-background-status"),
                        shape = AffairsLayout.shape, color = MaterialTheme.colorScheme.surfaceContainerHigh,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            backgroundStatuses.values.distinct().forEach { message ->
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    androidx.compose.material3.CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                                    Text(message, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                    }
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).testTag("drawer-actions"),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                        content = footerActions)
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)
                        .testTag("drawer-version-row"), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Genesis Tasker ${BuildConfig.VERSION_NAME}\nСборка · ${BuildConfig.VERSION_CODE}",
                            Modifier.weight(1f).testTag("trial-build-info"),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.labelSmall)
                    }
                }
                NativeSidebarUpgradeAction({ scope.launch { drawer.close() } },
                    Modifier.padding(horizontal = 12.dp, vertical = 12.dp))
                }
            }
        }) {
        CompositionLocalProvider(LocalWorkspaceHeader provides screenHeader, LocalWorkspaceBackgroundStatuses provides backgroundStatuses,
            LocalWorkspacePageNotices provides pageNotices) {
        Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
            Surface(color = MaterialTheme.colorScheme.surface) {
                Row(Modifier.fillMaxWidth().heightIn(min = 72.dp).padding(horizontal = 4.dp, vertical = 6.dp)
                    .testTag("app-header"), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { scope.launch { drawer.open() } },
                        modifier = Modifier.size(48.dp).testTag("workspace-menu")
                            .semantics { contentDescription = menuLabel }) {
                        GenesisLucideIcon("menu", Modifier.size(24.dp))
                    }
                    screenHeader.value?.navigation?.value?.invoke()
                    Row(Modifier.weight(1f).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        val compactTitle = screenHeader.value?.singleLine?.value == true
                        val currentTitle = screenHeader.value?.title?.value ?: title
                        val currentSubtitle = if (screenHeader.value != null) screenHeader.value?.subtitle?.value else subtitle
                        UntranslatedText(
                            if (screenHeader.value?.titleIsUserContent?.value == true) currentTitle else genesisTranslate(currentTitle),
                            Modifier.testTag("workspace-title").then(if (compactTitle && android.animation.ValueAnimator.areAnimatorsEnabled())
                                Modifier.basicMarquee(iterations = Int.MAX_VALUE, initialDelayMillis = 1800) else Modifier),
                            maxLines = if (compactTitle || !currentSubtitle.isNullOrBlank()) 1 else 2,
                            overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
                        currentSubtitle?.takeIf { it.isNotBlank() }?.let { Text(it, Modifier.testTag("workspace-subtitle"),
                            maxLines = if (screenHeader.value?.expandSubtitle?.value == true) Int.MAX_VALUE else 1, overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                        screenHeader.value?.actions?.value?.invoke()
                        CompositionLocalProvider(LocalWorkspaceThemeToggleAllowed provides
                            (screenHeader.value?.showThemeToggle?.value != false)) { actions() }
                    }
                }
            }
            content()
        }
        }
    }
}

@Composable
internal fun WorkspaceAccountRefreshButton(description: String, enabled: Boolean = true,
    onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled,
        modifier = Modifier.size(48.dp).testTag("account-refresh")
            .semantics { contentDescription = description },
        colors = IconButtonDefaults.iconButtonColors(contentColor = MaterialTheme.colorScheme.onSurfaceVariant)) {
        if (enabled) GenesisLucideIcon("refresh-cw", Modifier.size(22.dp))
        else CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = LocalContentColor.current)
    }
}

@Composable
internal fun WorkspaceHeaderButton(description: String, tag: String, enabled: Boolean = true,
    onClick: () -> Unit, content: @Composable () -> Unit) {
    val localizedDescription = genesisTranslate(description)
    androidx.compose.material3.Surface(onClick = onClick, enabled = enabled,
        modifier = Modifier.size(48.dp).testTag(tag).semantics { contentDescription = localizedDescription },
        shape = AffairsLayout.controlShape,
        color = MaterialTheme.colorScheme.primaryContainer.let { it.copy(alpha = it.alpha * .5f) },
        contentColor = MaterialTheme.colorScheme.onPrimaryContainer) {
        Box(contentAlignment = Alignment.Center) { content() }
    }
}
