package ru.genesis.calendar.ui

import ru.genesis.calendar.auth.UiVisibility

/** Use the drawer's actual destinations and order, including the independent diary and messenger. */
internal fun menuVisibilityDestinations() = mobileDestinations(
    listOf("Сегодня", "Календарь", "Проекты", "Дневник", "Сообщения", "Привычки", "Сакральное", "Настройки"),
    UiVisibility(), sharedEnabled = true, settingsSubmenus = false)

internal fun menuDestinationVisible(destination: MobileDestination, visibility: UiVisibility): Boolean {
    if (menuVisibilityId(destination.page) in visibility.hiddenMenuItems) return false
    return when (destination.page) {
        "Привычки" -> (if (destination.section == "Сон и настроение") "habits.sleep" else "habits.habits") !in visibility.hiddenSubmenus
        "Сакральное" -> listOf("stoicheion", "theokyklos").any {
            it !in visibility.hiddenMenuItems && "sacred.$it" !in visibility.hiddenSubmenus }
        else -> true
    }
}

internal fun setMenuDestinationVisible(destination: MobileDestination, visibility: UiVisibility, visible: Boolean): UiVisibility {
    val parent = menuVisibilityId(destination.page)
    if (parent.isEmpty()) return visibility // Today and Settings cannot be hidden.
    if (destination.page == "Привычки") {
        val own = if (destination.section == "Сон и настроение") "habits.sleep" else "habits.habits"
        val sibling = if (own == "habits.sleep") "habits.habits" else "habits.sleep"
        return if (visible) visibility.copy(hiddenMenuItems = visibility.hiddenMenuItems - parent,
            hiddenSubmenus = (visibility.hiddenSubmenus - own).let {
                if (parent in visibility.hiddenMenuItems) it + sibling else it })
        else if (sibling in visibility.hiddenSubmenus) visibility.copy(hiddenMenuItems = visibility.hiddenMenuItems + parent)
        else visibility.copy(hiddenSubmenus = visibility.hiddenSubmenus + own)
    }
    return visibility.copy(hiddenMenuItems = if (visible) visibility.hiddenMenuItems -
        (if (parent == "sacred") setOf(parent, "stoicheion", "theokyklos") else setOf(parent)) else visibility.hiddenMenuItems + parent)
}
