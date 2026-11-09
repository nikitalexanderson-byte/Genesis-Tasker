package ru.genesis.calendar.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.SideEffect
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.data.UiPreferences

/** Keep the feature's restored destination outside the workspace's large composition method. */
internal class SharedProjectToolNavigation(private val automation: MutableState<String>, val fields: MutableState<String>, val views: MutableState<Boolean>) {
    var value: String get() = automation.value; set(value) { automation.value = value }
}
@Composable internal fun rememberSharedAutomationNavigation(gateway: SharedWorkspaceGateway, preferences: UiPreferences, space: String, currentProject: String, spaces: List<org.json.JSONObject>,
    onLost: () -> Unit, onChanged: () -> Unit, onTask: (String, String) -> Unit): SharedProjectToolNavigation {
    val destination = rememberSaveable { mutableStateOf("") }
    val fields = rememberSaveable(space, LocalGenesisUserId.current) { mutableStateOf("") }
    val views = rememberSaveable(LocalGenesisUserId.current) { mutableStateOf(false) }
    if (views.value) SharedSavedViewsScreen(gateway, spaces, preferences, onClose = { views.value = false }, onTask = { project, task -> views.value = false; onTask(project, task) })
    val project = destination.value
    if (project.isNotBlank()) SharedAutomationsScreen(gateway, project, preferences = preferences,
        onClose = { destination.value = "" }, onLost = { destination.value = ""; onLost() },
        onChanged = onChanged, onTask = { destination.value = ""; onTask(project, it) })
    val selected = fields.value
    if (selected.isNotBlank() && selected == currentProject && space.isNotBlank()) SharedFieldsScreen(gateway, space, selected,
        onClose = { fields.value = "" }, onChanged = onChanged, onLost = { fields.value = ""; onLost() })
    if (selected.isNotBlank() && selected != currentProject) SideEffect { fields.value = "" }
    return SharedProjectToolNavigation(destination, fields, views)
}
