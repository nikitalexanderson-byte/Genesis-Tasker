package ru.genesis.calendar.ui

import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

/** One neutral tile per emoji; long press reveals authored Unicode tone variants. */
@Composable internal fun FullEmojiChoice(emoji: String,value: String,variants: List<String>,onChoose: (String)->Unit,
    modifier: Modifier=Modifier,enabled: Boolean=true) {
    var open by remember(emoji){mutableStateOf(false)}
    val context=LocalContext.current;val language=LocalGenesisLanguage.current
    val labels=remember(context,language){context.assets.open("originals/i18n/emoji-variant-copy.json").bufferedReader().use{JSONObject(it.readText()).let{it.optJSONArray(language)?:it.getJSONArray("en")}}}
    val selected=emojiVariantKey(value)==emojiVariantKey(emoji)
    val options=(listOf(emoji)+variants).distinct()
    Box {
        Surface(modifier.size(48.dp).combinedClickable(enabled=enabled,role=Role.Button,
            onClick={onChoose(emoji)},onLongClick=if(options.size>1)({open=true})else null,
            onLongClickLabel=if(options.size>1)labels.getString(0)else null)
            .semantics{contentDescription=emoji;this.selected=selected},
            shape=RoundedCornerShape(10.dp), color=selectedControlContainer(selected,enabled,MaterialTheme.colorScheme.surfaceContainerLow),
            border=selectedControlBorder(selected,enabled)) {
            Box(contentAlignment=Alignment.Center){UntranslatedText(emoji,fontSize=24.sp)
                if(options.size>1) GenesisLucideIcon("chevron-down",Modifier.size(10.dp).align(Alignment.BottomEnd).padding(1.dp))}
        }
        DropdownMenu(open,{open=false},modifier=Modifier.widthIn(max=288.dp)) {
            Text(labels.getString(0),Modifier.padding(horizontal=12.dp,vertical=4.dp),style=MaterialTheme.typography.labelMedium)
            FlowRow(Modifier.padding(8.dp).widthIn(max=264.dp),horizontalArrangement=Arrangement.spacedBy(4.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                options.forEach { option ->
                    Surface(Modifier.size(48.dp).combinedClickable(enabled=enabled,role=Role.Button,onClick={open=false;onChoose(option)})
                        .testTag("emoji-variant-$option").semantics{contentDescription=option;this.selected=value==option},shape=RoundedCornerShape(10.dp),
                        color=selectedControlContainer(value==option,enabled,MaterialTheme.colorScheme.surface),
                        border=selectedControlBorder(value==option,enabled)) {
                        Box(contentAlignment=Alignment.Center){UntranslatedText(option,fontSize=24.sp)}
                    }
                }
            }
        }
    }
}
