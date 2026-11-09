package ru.genesis.calendar.ui

import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextDecoration
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.data.isTaskOverdue
import java.time.LocalDate
import java.time.Instant
import kotlinx.coroutines.delay
import androidx.compose.ui.unit.dp

internal val completedTaskSurface = Color(0xffecebe7)
internal val completedTaskInk = Color(0xff626967)

@Composable
internal fun TaskTitle(task: LocalTask, modifier: Modifier = Modifier,
    style: TextStyle = LocalTextStyle.current, color: Color = Color.Unspecified,
    completedColor: Color = completedTaskInk, maxLines: Int = Int.MAX_VALUE,
    label: String = task.title, occurrenceDate: LocalDate? = null) {
    val now by produceState(Instant.now()) { while(true) { value=Instant.now();delay(30_000) } }
    val overdue=remember(task,now,occurrenceDate) { isTaskOverdue(task,now,occurrenceDate) }
    val unread=personalUnreadComments(task)
    Column(verticalArrangement=Arrangement.spacedBy(4.dp)) {
    Text(label, modifier = modifier, style = if(unread>0)style.copy(fontWeight=androidx.compose.ui.text.font.FontWeight.Bold) else style,
        color = if (task.done) completedColor else color, maxLines = maxLines,
        textDecoration = if (task.done) TextDecoration.LineThrough else TextDecoration.None)
    UnreadCommentBadge(unread)
    if(overdue) {
        val dark=LocalEveningTheme.current
        androidx.compose.material3.Surface(shape=RoundedCornerShape(8.dp),
            color=if(dark) Color(0xff542c31) else Color(0xfffae2e2),
            border=BorderStroke(1.dp,Color(0xffb6424e))) {
            UntranslatedText(genesisTranslate("Просрочено"),Modifier.padding(horizontal=8.dp,vertical=3.dp),
                color=if(dark) Color(0xfff3b9bb) else Color(0xff9e2634),style=MaterialTheme.typography.labelSmall)
        }
    }
    }
}
