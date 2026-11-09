package ru.genesis.calendar.ui

/** Project tools stay in three predictable places, independent of the active view. */
internal enum class SharedProjectMenu(val title: String, val action: AffairsAction, val tag: String) {
    WORK("Работа с задачами", AffairsAction.TOOLS, "shared-work-actions"),
    TEAM("Совместная работа", AffairsAction.TEAM, "shared-team-actions"),
    SETTINGS("Настройки и данные", AffairsAction.SETTINGS, "shared-actions")
}
