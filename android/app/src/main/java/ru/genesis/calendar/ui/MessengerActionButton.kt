package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.PlainTooltip
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.rememberTooltipState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics

/** The row owns equal widths; names remain available to TalkBack and long-press tooltips. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun MessengerActionButton(label: String, icon: String, tag: String,
    modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    TooltipBox(modifier = modifier, positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
        tooltip = { PlainTooltip { Text(label) } }, state = rememberTooltipState()) {
        OutlinedButton(onClick, Modifier.fillMaxWidth().testTag(tag).semantics { contentDescription = label },
            enabled = enabled) { GenesisLucideIcon(icon) }
    }
}
