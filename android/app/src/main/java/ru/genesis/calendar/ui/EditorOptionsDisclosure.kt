package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp

/** Form values belong to the editor, so collapsing options never discards a draft. */
@Composable internal fun EditorOptionsDisclosure(expanded: Boolean, onExpandedChange: (Boolean) -> Unit,
    content: @Composable ColumnScope.() -> Unit) {
    val stateLabel = genesisTranslate(if (expanded) "Развернуто" else "Свернуто")
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(onClick = { onExpandedChange(!expanded) },
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("task-options-toggle")
                .semantics { stateDescription = stateLabel },
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Подробности и настройки", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                GenesisLucideIcon(if (expanded) "chevron-up" else "chevron-down", Modifier.size(20.dp))
            }
        }
        if (expanded) Column(Modifier.fillMaxWidth().testTag("task-options"),
            verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
    }
}
