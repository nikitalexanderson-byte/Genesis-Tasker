package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import org.json.JSONObject


@Composable internal fun SharedTaskCoreConflict(details: JSONObject, enabled: Boolean, onResolve: (Boolean) -> Unit) {
    val copy = listOf("Эти поля изменены с двух сторон. Выберите значения перед сохранением. Остальные правки сохранены.", "Мой вариант", "С сайта").map { genesisTranslate(it) }
    Column(Modifier.fillMaxWidth().testTag("shared-task-core-conflict"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        UntranslatedText(copy[0], color = MaterialTheme.colorScheme.error)
        val conflicts = details.getJSONArray(SHARED_TASK_CORE_CONFLICTS)
        for (index in 0 until conflicts.length()) Text(when (conflicts.getString(index)) {
            "priority" -> "Приоритет"
            "parentTaskId" -> "Родительская задача"
            "checklists" -> "Чек-листы"
            "title" -> "Название"
            "description" -> "Описание"
            "dueDate" -> "Срок"
            else -> "Категория"
        }, style = MaterialTheme.typography.titleSmall)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton({ onResolve(true) }, enabled = enabled,
                modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("shared-core-keep-local")) {
                UntranslatedText(copy[1])
            }
            OutlinedButton({ onResolve(false) }, enabled = enabled,
                modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("shared-core-use-server")) {
                UntranslatedText(copy[2])
            }
        }
    }
}
