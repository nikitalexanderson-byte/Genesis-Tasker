package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** All settings use the habit preferences' paper, outline, type scale and spacing. */
@Composable
internal fun SettingsPreferenceCard(title: String, modifier: Modifier = Modifier,
    description: String? = null, eyebrow: String? = null,
    content: @Composable ColumnScope.() -> Unit) {
    Card(modifier.fillMaxWidth(), shape = AffairsLayout.shape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(AffairsLayout.gutter), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            eyebrow?.let { Text(it, style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary) }
            Text(title, Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall)
            description?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            content()
        }
    }
}
