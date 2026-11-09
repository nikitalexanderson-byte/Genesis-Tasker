package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.size
import androidx.compose.foundation.BorderStroke
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.R

@Composable
internal fun TodayThemeButton(evening: Boolean, enabled: Boolean, calendar: Boolean = false,
    plainIcon: Boolean = false, onToggle: () -> Unit) {
    val gold = if(LocalEveningTheme.current) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onPrimaryContainer
    OutlinedIconButton(onClick = onToggle, enabled = enabled, shape = AffairsLayout.controlShape,
        border = if (plainIcon) null else BorderStroke(1.dp, gold.copy(alpha = if (enabled) .55f else .25f)),
        colors = if (plainIcon) IconButtonDefaults.outlinedIconButtonColors(contentColor = MaterialTheme.colorScheme.onSurfaceVariant)
            else IconButtonDefaults.outlinedIconButtonColors(
                containerColor = MaterialTheme.colorScheme.primaryContainer,
                contentColor = gold),
        modifier = Modifier.size(48.dp).testTag(if (plainIcon) "drawer-theme-toggle" else if (calendar) "calendar-theme-toggle" else "today-theme-toggle")) {
        Icon(painterResource(R.drawable.genesis_theme_contrast),
            contentDescription = genesisTranslate(if (evening) "Включить светлую тему" else "Включить тёмную тему"),
            modifier = Modifier.size(24.dp))
    }
}
