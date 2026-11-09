package ru.genesis.calendar.ui

import androidx.compose.runtime.*
import ru.genesis.calendar.GenesisApplication

/** Display preferences belong to the current Android workspace, never to task data. */
internal data class PersonalInboxLayout(val hidden: Boolean = false, val atBottom: Boolean = false)

@Composable
internal fun rememberPersonalInboxLayout(app: GenesisApplication): Pair<PersonalInboxLayout, (PersonalInboxLayout) -> Unit> {
    val prefs = remember(app) { app.getSharedPreferences("genesis.personal-layout.v1", 0) }
    val key = "${app.workspaceScope}:inbox"
    var layout by remember(key) {
        mutableStateOf(PersonalInboxLayout(prefs.getBoolean("$key:hidden", false),
            prefs.getBoolean("$key:bottom", false)))
    }
    return layout to { next ->
        layout = next
        prefs.edit().putBoolean("$key:hidden", next.hidden).putBoolean("$key:bottom", next.atBottom).apply()
    }
}
