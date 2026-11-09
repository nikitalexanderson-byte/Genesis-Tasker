package ru.genesis.calendar

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.TextLayoutResult
import ru.genesis.calendar.ui.GenesisApp
import ru.genesis.calendar.ui.LocalGenesisTextLayoutAudit

/** Non-exported debug-only host for isolated UI tests. Never used by the launcher. */
class TestWorkspaceActivity : ComponentActivity() {
    // Tests observe the existing composition instead of replacing the live GenesisApp root.
    internal var textLayoutObserver by mutableStateOf<((String, TextLayoutResult) -> Unit)?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            CompositionLocalProvider(LocalGenesisTextLayoutAudit provides textLayoutObserver) {
                GenesisApp(application as GenesisApplication, null, testWorkspace = true)
            }
        }
    }
}
