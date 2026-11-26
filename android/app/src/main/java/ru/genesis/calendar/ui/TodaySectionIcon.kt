package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

/** Decorative section marks share geometry and muted ink, without an action surface. */
@Composable internal fun TodaySectionIcon(icon: GenesisPageIcon, tag: String) {
    Box(Modifier.size(40.dp).testTag(tag), contentAlignment = Alignment.Center) {
        GenesisVectorIcon(icon, Modifier.size(24.dp),
            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .85f))
    }
}
