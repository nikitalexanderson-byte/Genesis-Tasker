package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

/** A display preference scoped to the account and owning workspace/project, never task data. */
@Composable internal fun rememberSharedChaosLayout(owner: String): Pair<PersonalInboxLayout, (PersonalInboxLayout) -> Unit> {
    val context=LocalContext.current;val account=LocalGenesisUserId.current
    val prefs=remember(context) {context.getSharedPreferences("genesis.shared-inbox-layout.v1",0)}
    val key="$account:$owner"
    var layout by remember(key) {mutableStateOf(PersonalInboxLayout(prefs.getBoolean("$key:hidden",false),prefs.getBoolean("$key:bottom",false)))}
    return layout to {next->layout=next;prefs.edit().putBoolean("$key:hidden",next.hidden).putBoolean("$key:bottom",next.atBottom).apply()}
}

/** Same hierarchy as the personal inbox: heading, count, ordinary task/list rows and direct layout controls. */
@Composable internal fun SharedChaosBox(taskCount:Int,listCount:Int,layout:PersonalInboxLayout,
    onLayout:(PersonalInboxLayout)->Unit,modifier:Modifier=Modifier,content:@Composable ColumnScope.()->Unit) {
    if(layout.hidden) {
        OutlinedButton(onClick={onLayout(layout.copy(hidden=false))},modifier=modifier.fillMaxWidth().testTag("shared-show-inbox")) {
            AffairsActionIcon(AffairsAction.VIEW);Spacer(Modifier.width(8.dp));Text("Показать хаос-бокс")
        }
        return
    }
    Surface(modifier.fillMaxWidth().testTag("shared-project-inbox"),shape=AffairsLayout.shape,
        color=chaosBoxColor(),border=BorderStroke(1.dp,chaosBoxBorder())) {
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    Text("Хаос-бокс",style=MaterialTheme.typography.titleMedium)
                    Text("$taskCount задач · "+genesisTranslate("Списки задач")+": $listCount",
                        style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    AffairsIconButton(if(layout.atBottom) "Переместить вверх" else "Переместить вниз",
                        if(layout.atBottom) AffairsAction.MOVE_UP else AffairsAction.MOVE_DOWN,
                        {onLayout(layout.copy(atBottom=!layout.atBottom))},Modifier.testTag("shared-move-inbox"), outlined=false)
                    AffairsIconButton("Скрыть хаос-бокс",AffairsAction.HIDE,
                        {onLayout(layout.copy(hidden=true))},Modifier.testTag("shared-hide-inbox"), outlined=false)
                }
            }
            content()
        }
    }
}
