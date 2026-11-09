package ru.genesis.calendar.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
import org.json.JSONObject

@Composable internal fun StoicheionAlphabetToggle(expanded: Boolean, onToggle: () -> Unit) {
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    val copy = remember(context, language) {
        context.assets.open("originals/i18n/stoicheion-alphabet-copy.json").bufferedReader(Charsets.UTF_8).use {
            JSONObject(it.readText()).let { root -> root.optJSONObject(language) ?: root.getJSONObject("en") }
        }
    }
    val state = copy.getString(if (expanded) "expanded" else "collapsed")
    SacredYearDetailsButton(title = copy.getString("title"), subtitle = "",
        tag = "stoicheion-alphabet-toggle", icon = GenesisPageIcon.STOICHEION, expanded = expanded,
        modifier = Modifier.semantics { selected = expanded; stateDescription = state }, onClick = onToggle)
}
