package ru.genesis.calendar.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.domain.CalendarMode

/** Changes only the date-picker presentation in the open editor. */
@Composable
internal fun EditorCalendarModePicker(mode: CalendarMode, onModeChange: (CalendarMode) -> Unit,
    enabled: Boolean = true, compact: Boolean = false, preferredMode: CalendarMode = mode, tag: String) {
    if (!LocalSacredFeaturesEnabled.current) return
    Text("Отображение дат в этой форме", style = MaterialTheme.typography.titleSmall)
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.horizontalScroll(rememberScrollState())) {
        (listOf(preferredMode) + listOf(CalendarMode.SACRED, CalendarMode.PROFANE, CalendarMode.LUNAR)
            .filterNot { it == preferredMode }).forEach { option ->
            FilterChip(selected = mode == option, enabled = enabled,
                onClick = { onModeChange(option) },
                modifier = Modifier.heightIn(min = if (compact) 32.dp else 48.dp).testTag("$tag-${option.wireValue}"),
                label = { Text(calendarModeLabel(option)) })
        }
    }
}
