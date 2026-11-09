package ru.genesis.calendar.ui

import android.animation.ValueAnimator
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.*
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import kotlin.math.*

internal enum class GenesisPageIcon { TODAY, TASKS, TASK_LISTS, PROJECTS, PROJECTS_SHARED, MINDMAPS, DIARY, MESSAGES, CALENDAR, MONTH, YEAR, HABITS, SACRED, ORACLE, STOICHEION, THEOKYKLOS, SETTINGS, TRACKERS,
    SETTINGS_APPEARANCE, SETTINGS_HABITS, SETTINGS_REMINDERS, SETTINGS_SHARED, SETTINGS_REGION, SETTINGS_ACCOUNT, SETTINGS_LINKS, FUTURE_MODELING }

internal fun genesisPageIcon(title: String): GenesisPageIcon = when (title.trim()) {
    "Сегодня", "Today" -> GenesisPageIcon.TODAY
    "Задачи", "Tasks" -> GenesisPageIcon.TASKS
    "Списки задач", "Task lists" -> GenesisPageIcon.TASK_LISTS
    "Проекты", "Projects" -> GenesisPageIcon.PROJECTS
    "Проекты - личные", "Projects - personal" -> GenesisPageIcon.PROJECTS
    "Проекты - общие", "Projects - shared" -> GenesisPageIcon.PROJECTS_SHARED
    "Календарь", "Calendar" -> GenesisPageIcon.CALENDAR
    "Календарь - месяц", "Calendar - month" -> GenesisPageIcon.MONTH
    "Календарь - год", "Calendar - year" -> GenesisPageIcon.YEAR
    "Привычки", "Habits" -> GenesisPageIcon.HABITS
    "Сакральное", "Sacred" -> GenesisPageIcon.SACRED
    "Оракул", "Oracle" -> GenesisPageIcon.ORACLE
    "Стойхейон", "Stoicheion" -> GenesisPageIcon.STOICHEION
    "Теокиклос", "Theokyklos" -> GenesisPageIcon.THEOKYKLOS
    "Сон и настроение", "Sleep & mood" -> GenesisPageIcon.TRACKERS
    else -> GenesisPageIcon.SETTINGS
}

@Composable
internal fun rememberIconPhase(label: String, durationMillis: Int, animated: Boolean = true): Float {
    if (!animated || !ValueAnimator.areAnimatorsEnabled()) return 0f
    return rememberInfiniteTransition(label = label).animateFloat(0f, 1f,
        infiniteRepeatable(tween(durationMillis, easing = LinearEasing)), label = "$label-motion").value
}

private fun inkProgress(phase: Float, index: Int = 0): Float {
    val drawStart = index * .13f
    val eraseStart = .62f + index * .12f
    return minOf(((phase - drawStart) / .18f).coerceIn(0f, 1f),
        (1f - (phase - eraseStart) / .13f).coerceIn(0f, 1f))
}

/** Original vector paths on a 24-unit grid. Buttons and headings share the same geometry. */
@Composable
internal fun GenesisVectorIcon(icon: GenesisPageIcon, modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current, animated: Boolean = false) {
    GenesisLucideIcon(icon.lucideName(), modifier.testTag(
        "genesis-icon-${icon.name.lowercase()}-${if (animated) "animated" else "static"}"), tint = eveningInk(tint))
}
