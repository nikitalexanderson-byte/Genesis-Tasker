package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Switch
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag

/** The same Android preference is edited here and by the eyes in Today's layout mode. */
@Composable internal fun TodayBlockVisibilitySettings(hidden: Set<String>, onHidden: (Set<String>) -> Unit) {
    Text("Экран «Сегодня»", style = MaterialTheme.typography.titleSmall)
    listOf("Ритм дня" to "rhythm", "Быстрое создание" to "quickCreate",
        "Задачи дня" to "tasks", "Трекер привычек" to "habits", "Подробности дня" to "details",
        "Совет дня" to "advice", "Дневник сновидений" to "dream", "Объявление" to "ad")
        .forEach { (label, id) ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(label, Modifier.weight(1f))
                Switch(checked = id !in hidden,
                    onCheckedChange = { checked -> onHidden(if (checked) hidden - id else hidden + id) },
                    modifier = Modifier.testTag("today-visibility-$id"))
            }
        }
}
