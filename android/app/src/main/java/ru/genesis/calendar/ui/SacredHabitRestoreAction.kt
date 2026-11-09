package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.domain.TheokyklosPractice
import ru.genesis.calendar.domain.habits.Habit

@Composable
internal fun SacredHabitRestoreAction(habit: Habit, practice: TheokyklosPractice,
    disabled: Boolean, onRestore: () -> Unit) {
    var confirming by remember(habit.id) { mutableStateOf(false) }
    if (!canRestoreSacredHabit(habit, practice)) return
    TextButton(onClick = { confirming = true }, enabled = !disabled,
        modifier = Modifier.testTag("sacred-restore-${habit.id}")) {
        GenesisLucideIcon("undo-2")
        Spacer(Modifier.width(8.dp))
        Text("Вернуть исходную")
    }
    if (confirming) AlertDialog(onDismissRequest = { confirming = false },
        title = { Text("Вернуть исходную привычку?") },
        text = { Text("Вернутся название, описание, значок и цвет. Расписание, статус и история выполнения сохранятся.") },
        confirmButton = { TextButton(onClick = { confirming = false; onRestore() }, enabled = !disabled,
            modifier = Modifier.testTag("sacred-restore-confirm")) { Text("Вернуть") } },
        dismissButton = { TextButton(onClick = { confirming = false }) { Text("Отмена") } })
}
