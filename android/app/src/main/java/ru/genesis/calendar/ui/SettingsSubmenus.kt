package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

internal data class SettingsSectionDestination(
    val id: String, val ru: String, val en: String, val icon: GenesisPageIcon,
    val descriptionRu: String, val descriptionEn: String
) {
    fun title(language: String) = if (language == "en") en else ru
    fun description(language: String) = if (language == "en") descriptionEn else descriptionRu
}

internal val settingsSections = listOf(
    SettingsSectionDestination("appearance", "Оформление", "Appearance", GenesisPageIcon.SETTINGS_APPEARANCE,
        "Темы, меню, язык, календари и время", "Themes, menus, language, calendars and time"),
    SettingsSectionDestination("habits", "Привычки", "Habits", GenesisPageIcon.SETTINGS_HABITS,
        "Трекинг, уведомления и отклик на выполнение", "Tracking, notifications and completion feedback"),
    SettingsSectionDestination("reminders", "Напоминания", "Reminders", GenesisPageIcon.SETTINGS_REMINDERS,
        "Лунные и системные напоминания", "Lunar and system reminders"),
    SettingsSectionDestination("shared", "Общие дела", "Shared affairs", GenesisPageIcon.SETTINGS_SHARED,
        "Доступ, приглашения и события команды", "Access, invitations and team activity"),
    SettingsSectionDestination("region", "Регион", "Region", GenesisPageIcon.SETTINGS_REGION,
        "Регион и место для восхода и заката", "Region and sunrise and sunset location"),
    SettingsSectionDestination("account", "Аккаунт GENESIS", "GENESIS account", GenesisPageIcon.SETTINGS_ACCOUNT,
        "Вход и синхронизация", "Sign in and synchronization"),
    SettingsSectionDestination("links", "Ссылки", "Links", GenesisPageIcon.SETTINGS_LINKS,
        "Академия, поддержка и веб-версия", "Academy, support and web version")
)

@Composable
internal fun SettingsSubmenu(selectedId: String, language: String, showLabels: Boolean,
    onSelect: (String) -> Unit) {
    val selectedIndex = settingsSections.indexOfFirst { it.id == selectedId }.coerceAtLeast(0)
    val outlined = LocalSubmenuOutlineMode.current
    val outlineColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha =
        if (LocalEveningTheme.current) .62f else .76f)
    val listState = rememberLazyListState()
    LaunchedEffect(selectedIndex, showLabels) {
        if (showLabels) listState.scrollToItem(selectedIndex)
    }
    BoxWithConstraints(Modifier.fillMaxWidth()
        .then(if (outlined) Modifier.padding(horizontal = 8.dp, vertical = 5.dp)
            .then(navigationSubmenuGroupAnchor())
            .border(1.dp, outlineColor, AffairsLayout.shape)
            .padding(horizontal = 5.dp, vertical = 4.dp) else Modifier)
        .testTag("settings-submenu")) {
        if (!showLabels) {
            // Seven fixed icons fit in one row from 360 dp upward. Below that width,
            // remove gutters before reducing the targets so the menu never scrolls.
            val narrow = maxWidth < 360.dp
            Row(Modifier.fillMaxWidth().height(52.dp).padding(
                start = if (narrow) 0.dp else 2.dp, end = if (narrow) 0.dp else 2.dp,
                top = 2.dp, bottom = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(if (narrow) 0.dp else 2.dp),
                verticalAlignment = Alignment.CenterVertically) {
                settingsSections.forEachIndexed { index, item ->
                    SettingsSubmenuButton(item, index == selectedIndex, language, false,
                        onSelect, Modifier.weight(1f))
                }
            }
        } else LazyRow(state = listState,
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.height(82.dp)) {
            items(settingsSections.size, key = { settingsSections[it].id }) { index ->
                SettingsSubmenuButton(settingsSections[index], index == selectedIndex,
                    language, showLabels, onSelect)
            }
        }
    }
}

@Composable
private fun SettingsSubmenuButton(item: SettingsSectionDestination, picked: Boolean,
    language: String, showLabels: Boolean, onSelect: (String) -> Unit,
    modifier: Modifier = Modifier) {
    val localizedTitle = genesisTranslate(item.title(language))
    Surface(onClick = { onSelect(item.id) }, shape = AffairsLayout.shape,
        color = selectedControlContainer(picked, fallback = MaterialTheme.colorScheme.surface),
        border = selectedControlBorder(picked, fallback = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)),
        modifier = modifier.then(if (showLabels) Modifier.widthIn(min = 52.dp).heightIn(min = 54.dp)
            else Modifier.height(44.dp))
            .testTag("settings-submenu-${item.id}")
            .then(navigationSubmenuAnchor(item.id))
            .semantics {
                selected = picked
                role = Role.Tab
                contentDescription = localizedTitle
            }) {
        if (showLabels) {
            Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                GenesisVectorIcon(item.icon, Modifier.size(25.dp),
                    tint = if (picked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                Text(item.title(language), maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.labelMedium,
                    color = if (picked) MaterialTheme.colorScheme.onPrimaryContainer
                        else MaterialTheme.colorScheme.onSurface)
            }
        } else {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                GenesisVectorIcon(item.icon, Modifier.size(22.dp),
                    tint = if (picked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
            }
        }
    }
}
