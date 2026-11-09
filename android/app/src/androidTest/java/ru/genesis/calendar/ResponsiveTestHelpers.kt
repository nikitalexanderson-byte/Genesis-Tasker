package ru.genesis.calendar

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.ComposeContentTestRule

/** Reach the same drawer and connected submenu used on the shipped mobile workspace. */
internal fun ComposeContentTestRule.openWorkspacePage(page: String, section: String? = null) {
    waitUntil(10_000) { onAllNodesWithTag("workspace-menu").fetchSemanticsNodes().isNotEmpty() }
    if (!onNodeWithTag("workspace-drawer").isDisplayed())
        onNodeWithTag("workspace-menu").assertIsDisplayed().performClick()
    waitUntil(5_000) { onNodeWithTag("workspace-drawer").isDisplayed() }
    val drawerSection = when (page) {
        "Привычки" -> section ?: "Привычки"
        "Настройки" -> section
        else -> null
    }
    onNodeWithTag("drawer-$page-${drawerSection ?: "root"}").performScrollTo().assertIsEnabled().performClick()
    waitUntil(5_000) { !onNodeWithTag("workspace-drawer").isDisplayed() }
    if (page == "Календарь")
        onNodeWithTag("submenu-${section ?: "month"}").assertIsEnabled().performClick().assertIsSelected()
    if (page == "Сакральное" && section != null)
        onNodeWithTag("submenu-$section").assertIsEnabled().performClick().assertIsSelected()
    if (page == "Проекты" && onAllNodesWithTag("submenu-personal").fetchSemanticsNodes().isNotEmpty())
        onNodeWithTag("submenu-personal").assertIsEnabled().performClick().assertIsSelected()
}

/** Reorderable Today uses one lazy grid on both phones and tablets. */
internal fun ComposeContentTestRule.scrollToTodayNode(matcher: SemanticsMatcher) {
    if (onAllNodesWithTag("today-two-pane").fetchSemanticsNodes().isEmpty()) {
        onNodeWithTag("today-list").performScrollToNode(matcher)
    } else {
        onNodeWithTag("today-two-pane").performScrollToNode(matcher)
    }
}
