package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import ru.genesis.calendar.data.HabitsRepository
import ru.genesis.calendar.domain.habits.Habit

/** Reuse the synchronized habit tombstone, retaining completion history and restoration. */
@Composable internal fun SavedCycleDeleteDialog(habit: Habit, repository: HabitsRepository, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    AlertDialog(onDismissRequest = { if (!busy) onClose() }, title = { Text("Удалить сохранённый цикл?") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            UntranslatedText(habitDisplayTitle(habit), style = MaterialTheme.typography.titleSmall)
            Text("Связанная практика переместится в корзину привычек. История выполнения сохранится; цикл можно восстановить вместе с практикой.")
            if (failed) Text("Не удалось удалить цикл. Повторите попытку.", color = MaterialTheme.colorScheme.error)
        } }, confirmButton = { TextButton(onClick = {
            if (!busy) { busy = true; failed = false; scope.launch {
                try { repository.delete(habit.id); onClose() }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { failed = true }
                finally { busy = false }
            } }
        }, enabled = !busy, modifier = Modifier.testTag("saved-cycle-delete-confirm")) { Text("Удалить цикл", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClose, enabled = !busy) { Text("Отмена") } })
}
