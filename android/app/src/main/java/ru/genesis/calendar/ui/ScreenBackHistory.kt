package ru.genesis.calendar.ui

import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable

/** Records screens that actually reached composition, regardless of the button that opened them. */
@Stable internal class ScreenBackHistory(initial: String, previous: List<String> = emptyList()) {
    var current by mutableStateOf(initial); private set
    var previous by mutableStateOf(previous); private set
    val canGoBack get() = previous.isNotEmpty()
    fun observe(screen: String) {
        if (screen == current) return
        previous = previous + current
        current = screen
    }
    fun pop(): String? {
        val target = previous.lastOrNull() ?: return null
        previous = previous.dropLast(1)
        current = target
        return target
    }
}

@Composable internal fun rememberScreenBackHistory(screen: String): ScreenBackHistory {
    val history = rememberSaveable(saver = listSaver(
        save = { listOf(it.current) + it.previous },
        restore = { ScreenBackHistory(it.first(), it.drop(1)) })) { ScreenBackHistory(screen) }
    SideEffect { history.observe(screen) }
    return history
}

internal fun workspaceBackDestination(page: String, menu: MenuSwipeState): String = when(page) {
    "Проекты" -> listOf(page,menu.projectArea,menu.personalView,menu.tasks).joinToString("|")
    "Задачи" -> listOf(page,menu.tasks,menu.personalView).joinToString("|")
    else -> "$page|${menu.section(page).orEmpty()}"
}

internal fun restoreWorkspaceBackDestination(value: String, menu: MenuSwipeState): String {
    val parts=value.split('|');val page=parts.first()
    when(page) {
        "Проекты" -> {menu.projectArea=parts.getOrElse(1){"personal"};menu.personalView=parts.getOrElse(2){"projects"};menu.tasks=parts.getOrElse(3){"tasks"}}
        "Задачи" -> {menu.tasks=parts.getOrElse(1){"tasks"};menu.personalView=parts.getOrElse(2){"projects"}}
        else -> parts.getOrNull(1)?.takeIf { it.isNotBlank() }?.let { menu.select(page,it) }
    }
    return page
}
