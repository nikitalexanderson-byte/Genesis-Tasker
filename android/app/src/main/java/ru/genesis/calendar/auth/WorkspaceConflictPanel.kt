package ru.genesis.calendar.auth

import ru.genesis.calendar.ui.AlertDialog

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.material3.Text as MaterialText
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import java.text.NumberFormat
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import ru.genesis.calendar.ui.*
import ru.genesis.calendar.ui.Text
import ru.genesis.calendar.ui.OutlinedButton

@Composable internal fun WorkspaceConflictSummary(preview: WorkspaceConflictPreview?, busy: Boolean, onOpen: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        val count = NumberFormat.getIntegerInstance(Locale.forLanguageTag(LocalGenesisLanguage.current)).format(preview?.fields?.size ?: 0)
        MaterialText(genesisTranslate("Поля с конфликтом") + ": " + count, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
        AffairsIconButton("Сравнить версии", AffairsAction.VIEW, onOpen, Modifier.testTag("workspace-conflict-review"), !busy && preview?.fields?.isNotEmpty() == true)
    }
}

private val conflictCollections = mapOf("projects" to "Проекты", "categories" to "Категории", "taskLists" to "Списки задач",
    "taskListLinks" to "Списки задач", "habits" to "Привычки", "habitCompletions" to "История отметок", "userProgress" to "Прогресс",
    "habitSettings" to "Настройки привычек", "dailyGoalRecords" to "Дневная цель", "quests" to "Квесты", "achievementUnlocks" to "Достижения",
    "rewardTransactions" to "Награды", "sleepPlans" to "Сон", "sleepEntries" to "Сон", "moodEntries" to "Настроение")
private val conflictProperties = mapOf("title" to "Название", "description" to "Описание", "active" to "Активность", "schedule" to "Расписание",
    "qualityValue" to "Качество", "lifetimeXp" to "XP", "laurelsBalance" to "Лавры", "currentStreak" to "Текущая серия", "longestStreak" to "Лучшая серия")

/** The exact immutable comparison opened by the user is also the confirmation guard. */
@Composable internal fun WorkspaceConflictDialog(preview: WorkspaceConflictPreview, busy: Boolean, onKeepLocal: () -> Unit,
    onKeepRemote: () -> Unit, onDismiss: () -> Unit) {
    var visible by rememberSaveable(preview.fingerprint) { mutableIntStateOf(5) }
    val phoneAction = genesisTranslate("Оставить изменения телефона")
    val websiteAction = genesisTranslate("Оставить изменения сайта")
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() }, shape = AffairsLayout.shape, modifier = Modifier.testTag("workspace-conflict-dialog"),
        title = { Text("Какую версию оставить?") },
        text = {
            Column(Modifier.fillMaxWidth().heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Выбор относится ко всем показанным конфликтам. Остальные изменения сохранятся.", style = MaterialTheme.typography.bodySmall)
                if (visible < preview.fields.size) Text("Покажите все конфликты перед выбором.", style = MaterialTheme.typography.bodySmall)
                for (field in preview.fields.take(visible)) key(preview.fingerprint, field.path) {
                    val parts = field.path.split('/')
                    val collection = genesisTranslate(conflictCollections[parts.first()] ?: "Данные")
                    val property = conflictProperties[parts.last()]?.let { genesisTranslate(it) }
                    MaterialText(listOfNotNull(collection, property).joinToString(" · "), Modifier.semantics { heading() }, style = MaterialTheme.typography.titleSmall)
                    field.title?.let { MaterialText(it, style = MaterialTheme.typography.bodySmall) }
                    ConflictValue("Версия телефона", field.localJson, "workspace-conflict-local-${field.path}")
                    ConflictValue("Версия сайта", field.remoteJson, "workspace-conflict-remote-${field.path}")
                    var original by rememberSaveable { mutableStateOf(false) }
                    AffairsIconButton("Исходная версия", AffairsAction.HISTORY, { original = !original }, enabled = !busy)
                    if (original) ConflictValue("Исходная версия", field.baseJson, "workspace-conflict-base-${field.path}")
                    HorizontalDivider()
                }
                if (visible < preview.fields.size) AffairsIconButton("Показать ещё", AffairsAction.EXPAND, { visible += 5 }, Modifier.testTag("workspace-conflict-more"), !busy)
            }
        },
        confirmButton = {
            DialogActionRow(
                DialogIconAction("Отмена", AffairsAction.BACK, onDismiss, enabled = !busy,
                    modifier = Modifier.testTag("workspace-conflict-cancel")),
                DialogIconAction(phoneAction, AffairsAction.PHONE, onKeepLocal, enabled = !busy && visible >= preview.fields.size,
                    modifier = Modifier.testTag("workspace-conflict-keep-local")),
                DialogIconAction(websiteAction, AffairsAction.WEBSITE, onKeepRemote, enabled = !busy && visible >= preview.fields.size,
                    modifier = Modifier.testTag("workspace-conflict-keep-remote")),
                modifier = Modifier.testTag("workspace-conflict-footer")
            )
        })
}

@Composable private fun ConflictValue(label: String, raw: String, tag: String) {
    val language = LocalGenesisLanguage.current
    val value = remember(raw) { JSONTokener(raw).nextValue() }
    val text = when (value) {
        JSONObject.NULL -> genesisTranslate("Не задано")
        is String -> value
        is Number -> NumberFormat.getNumberInstance(Locale.forLanguageTag(language)).apply { maximumFractionDigits = 12 }.format(value)
        is Boolean -> genesisTranslate(if (value) "Да" else "Нет")
        is JSONObject -> remember(raw) { value.toString(2) }
        is JSONArray -> remember(raw) { value.toString(2) }
        else -> raw
    }
    var length by rememberSaveable(raw) { mutableIntStateOf(1000) }
    Text(label, style = MaterialTheme.typography.labelMedium)
    SelectionContainer { MaterialText(text.take(length), Modifier.testTag(tag), style = MaterialTheme.typography.bodySmall) }
    if (length < text.length) AffairsIconButton("Показать ещё", AffairsAction.EXPAND, { length += 2000 })
}
