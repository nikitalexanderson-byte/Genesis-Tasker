package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.R

/** Official Lucide 1.61.0 geometry. ISC notices and source hashes: android/third-party-licenses. */
@Composable
fun GenesisLucideIcon(name: String, modifier: Modifier = Modifier.size(24.dp),
    tint: Color = LocalContentColor.current, filled: Boolean = false) {
    Icon(painter = painterResource(if (name == "star" && filled) R.drawable.genesis_star_filled else genesisLucideResource(name)), contentDescription = null,
        modifier = modifier, tint = tint)
}

internal fun genesisLucideResource(name: String): Int = when (name.replace('_', '-')) {
    "future-modeling" -> R.drawable.genesis_future_modeling
    "board-plus" -> R.drawable.genesis_board_plus
    "save-draft" -> R.drawable.genesis_save
    "phone-source" -> R.drawable.genesis_phone
    "file-plus-2" -> R.drawable.lucide_file_plus_2
    "message-circle" -> R.drawable.lucide_message_circle
    "paperclip" -> R.drawable.lucide_paperclip
    "send" -> R.drawable.lucide_send
    "share-2" -> R.drawable.lucide_share_2
    "key-round" -> R.drawable.lucide_key_round
    "lock-keyhole" -> R.drawable.lucide_lock_keyhole
    "bookmark" -> R.drawable.lucide_bookmark
    "file-json" -> R.drawable.lucide_file_json
    "file-text" -> R.drawable.lucide_file_text
    "focus" -> R.drawable.lucide_focus
    "pin" -> R.drawable.lucide_pin
    "star" -> R.drawable.lucide_star
    "thumbs-up" -> R.drawable.lucide_thumbs_up
    "thumbs-down" -> R.drawable.lucide_thumbs_down
    "menu" -> R.drawable.lucide_menu
    "x" -> R.drawable.lucide_x
    "chevron-left" -> R.drawable.lucide_chevron_left
    "chevron-right" -> R.drawable.lucide_chevron_right
    "chevron-down" -> R.drawable.lucide_chevron_down
    "chevron-up" -> R.drawable.lucide_chevron_up
    "ellipsis" -> R.drawable.lucide_ellipsis
    "search" -> R.drawable.lucide_search
    "sliders-horizontal" -> R.drawable.lucide_sliders_horizontal
    "arrow-up-down" -> R.drawable.lucide_arrow_up_down
    "refresh-cw" -> R.drawable.lucide_refresh_cw
    "plus" -> R.drawable.lucide_plus
    "minus" -> R.drawable.lucide_minus
    "pencil" -> R.drawable.lucide_pencil
    "trash-2" -> R.drawable.lucide_trash_2
    "folder" -> R.drawable.lucide_folder
    "folder-plus" -> R.drawable.lucide_folder_plus
    "list-checks" -> R.drawable.lucide_list_checks
    "list" -> R.drawable.lucide_list
    "layout-dashboard" -> R.drawable.lucide_layout_dashboard
    "calendar-days" -> R.drawable.lucide_calendar_days
    "calendar-range" -> R.drawable.lucide_calendar_range
    "sun" -> R.drawable.lucide_sun
    "moon" -> R.drawable.lucide_moon
    "sparkles" -> R.drawable.lucide_sparkles
    "settings" -> R.drawable.lucide_settings
    "user-round" -> R.drawable.lucide_user_round
    "bell" -> R.drawable.lucide_bell
    "globe" -> R.drawable.lucide_globe
    "external-link" -> R.drawable.lucide_external_link
    "heart-pulse" -> R.drawable.lucide_heart_pulse
    "network" -> R.drawable.lucide_network
    "check" -> R.drawable.lucide_check
    "check-check" -> R.drawable.lucide_check_check
    "mic" -> R.drawable.lucide_mic
    "download" -> R.drawable.lucide_download
    "upload" -> R.drawable.lucide_upload
    "archive" -> R.drawable.lucide_archive
    "archive-restore" -> R.drawable.lucide_archive_restore
    "history" -> R.drawable.lucide_history
    "eye" -> R.drawable.lucide_eye
    "eye-off" -> R.drawable.lucide_eye_off
    "move" -> R.drawable.lucide_move
    "arrow-up" -> R.drawable.lucide_arrow_up
    "arrow-down" -> R.drawable.lucide_arrow_down
    "undo-2" -> R.drawable.lucide_undo_2
    "chart-no-axes-column" -> R.drawable.lucide_chart_no_axes_column
    "inbox" -> R.drawable.lucide_inbox
    "copy" -> R.drawable.lucide_copy
    "git-branch" -> R.drawable.lucide_git_branch
    "link" -> R.drawable.lucide_link
    "play" -> R.drawable.lucide_play
    "pause" -> R.drawable.lucide_pause
    "timer" -> R.drawable.lucide_timer
    "wand-sparkles" -> R.drawable.lucide_wand_sparkles
    "alarm-clock" -> R.drawable.lucide_alarm_clock
    "shield-check" -> R.drawable.lucide_shield_check
    "book-open" -> R.drawable.lucide_book_open
    "log-out" -> R.drawable.lucide_log_out
    "chart-no-axes-gantt" -> R.drawable.lucide_chart_no_axes_gantt
    "layout-template" -> R.drawable.lucide_layout_template
    "list-tree" -> R.drawable.lucide_list_tree
    "palette" -> R.drawable.lucide_palette
    "users-round" -> R.drawable.lucide_users_round
    else -> error("Unknown bundled Lucide icon: $name")
}

/** Complete mappings keep existing navigation, test IDs and permissions at their call sites. */
internal fun GenesisPageIcon.lucideName(): String = when (this) {
    GenesisPageIcon.MESSAGES -> "message-circle"
    GenesisPageIcon.MINDMAPS -> "network"
    GenesisPageIcon.TODAY -> "sun"
    GenesisPageIcon.TASKS -> "list-checks"
    GenesisPageIcon.TASK_LISTS -> "list"
    GenesisPageIcon.PROJECTS -> "folder"
    GenesisPageIcon.PROJECTS_SHARED, GenesisPageIcon.SETTINGS_SHARED -> "users-round"
    GenesisPageIcon.CALENDAR, GenesisPageIcon.MONTH -> "calendar-days"
    GenesisPageIcon.YEAR -> "calendar-range"
    GenesisPageIcon.HABITS, GenesisPageIcon.SETTINGS_HABITS -> "check-check"
    GenesisPageIcon.SACRED -> "sparkles"
    GenesisPageIcon.ORACLE -> "eye"
    GenesisPageIcon.STOICHEION, GenesisPageIcon.DIARY -> "book-open"
    GenesisPageIcon.FUTURE_MODELING -> "future-modeling"
    GenesisPageIcon.THEOKYKLOS -> "sun"
    GenesisPageIcon.SETTINGS -> "settings"
    GenesisPageIcon.TRACKERS -> "heart-pulse"
    GenesisPageIcon.SETTINGS_APPEARANCE -> "palette"
    GenesisPageIcon.SETTINGS_REMINDERS -> "bell"
    GenesisPageIcon.SETTINGS_REGION -> "globe"
    GenesisPageIcon.SETTINGS_ACCOUNT -> "user-round"
    GenesisPageIcon.SETTINGS_LINKS -> "external-link"
}

internal fun AffairsAction.lucideName(): String = when (this) {
    AffairsAction.BACK -> "chevron-left"
    AffairsAction.NEXT -> "chevron-right"
    AffairsAction.MORE -> "ellipsis"
    AffairsAction.CENTER -> "focus"
    AffairsAction.CLOSE -> "x"
    AffairsAction.SEARCH -> "search"
    AffairsAction.FILTER -> "sliders-horizontal"
    AffairsAction.SORT -> "arrow-up-down"
    AffairsAction.EXPAND -> "chevron-down"
    AffairsAction.COLLAPSE -> "chevron-up"
    AffairsAction.REFRESH -> "refresh-cw"
    AffairsAction.MOVE -> "move"
    AffairsAction.MOVE_UP -> "arrow-up"
    AffairsAction.MOVE_DOWN -> "arrow-down"
    AffairsAction.ADD -> "plus"
    AffairsAction.EDIT -> "pencil"
    AffairsAction.SETTINGS -> "settings"
    AffairsAction.DELETE -> "trash-2"
    AffairsAction.REPORT -> "chart-no-axes-column"
    AffairsAction.IMPORT -> "upload"
    AffairsAction.HISTORY -> "history"
    AffairsAction.VIEW -> "eye"
    AffairsAction.HIDE -> "eye-off"
    AffairsAction.LINK -> "link"
    AffairsAction.TEAM -> "users-round"
    AffairsAction.MINDMAP -> "network"
    AffairsAction.COPY -> "copy"
    AffairsAction.SAVE -> "save-draft"
    AffairsAction.PHONE -> "phone-source"
    AffairsAction.WEBSITE -> "globe"
    AffairsAction.LIST -> "list"
    AffairsAction.BOARD -> "layout-dashboard"
    AffairsAction.CREATE_BOARD -> "board-plus"
    AffairsAction.TOOLS -> "sliders-horizontal"
    AffairsAction.CALENDAR -> "calendar-days"
    AffairsAction.GANTT -> "chart-no-axes-gantt"
    AffairsAction.PROJECT -> "folder"
    AffairsAction.TASK_LIST, AffairsAction.TASK -> "list-checks"
    AffairsAction.CREATE_TASK -> "file-plus-2"
    AffairsAction.UNDO -> "undo-2"
    AffairsAction.TEMPLATE -> "layout-template"
    AffairsAction.SUBTASK -> "list-tree"
    AffairsAction.DECREASE -> "minus"
    AffairsAction.AUTOMATION -> "wand-sparkles"
    AffairsAction.PAUSE -> "pause"
    AffairsAction.RESUME -> "play"
    AffairsAction.ARCHIVE -> "archive"
    AffairsAction.RESTORE -> "archive-restore"
    AffairsAction.TIMER -> "timer"
}
