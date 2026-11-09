package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import ru.genesis.calendar.data.MindmapDocument
import ru.genesis.calendar.data.MindmapNode

/** Show destinations in tree order and distinguish equally named branches without exposing IDs. */
internal fun mindmapBranchChoices(map:MindmapDocument,movingId:String,label:(MindmapNode)->String):List<Pair<String,String>> {
    val blocked=map.descendants(movingId)
    val labels=map.nodes.associate {it.id to label(it)}
    val names=mutableMapOf<String,String>()
    map.nodes.groupBy {it.parentId to labels.getValue(it.id)}.values.forEach {siblings->
        siblings.forEachIndexed {index,node->
            val title=labels.getValue(node.id)
            names[node.id]=if(siblings.size>1) "$title · ${index+1}" else title
        }
    }
    val paths=mutableMapOf<String,String>()
    return map.rows().map {(node,_)->
        val prefix=node.parentId?.let(paths::get)
        val path=if(prefix==null)names.getValue(node.id) else "$prefix › ${names.getValue(node.id)}"
        paths[node.id]=path
        node.id to path
    }.filter {it.first !in blocked}
}

@Composable internal fun MapIconButton(label:String,kind:Int,onClick:()->Unit,enabled:Boolean=true) {
    AffairsIconButton(label,when(kind) {
        0 -> AffairsAction.MINDMAP
        1 -> AffairsAction.LIST
        2 -> AffairsAction.SUBTASK
        3 -> AffairsAction.ADD
        4 -> AffairsAction.TASK
        5 -> AffairsAction.VIEW
        6 -> AffairsAction.COLLAPSE
        7 -> AffairsAction.MOVE_UP
        8 -> AffairsAction.MOVE_DOWN
        9 -> AffairsAction.DELETE
        10 -> AffairsAction.BACK
        else -> AffairsAction.LINK
    },onClick,enabled=enabled)
    }

@Composable internal fun MapColorField(label:String,color:String?,onColor:(String?)->Unit) {
    var open by remember { mutableStateOf(false) }
    val valid=color?.takeIf {Regex("#[a-fA-F0-9]{6}").matches(it)}
    val swatch=valid?.let {Color(android.graphics.Color.parseColor(it))} ?: MaterialTheme.colorScheme.surface
    val description=genesisTranslate("Выбрать цвет")+": "+genesisTranslate(label)
    Surface(onClick={open=true},shape=AffairsLayout.controlShape,
        border=BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant),
        modifier=Modifier.fillMaxWidth().heightIn(min=56.dp).testTag("mindmap-color-$label").semantics {contentDescription=description}) {
        Row(Modifier.padding(12.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            androidx.compose.material3.Surface(Modifier.size(32.dp),color=swatch,shape=AffairsLayout.controlShape,
                border=BorderStroke(1.dp,MaterialTheme.colorScheme.outline)) { }
            Column(Modifier.weight(1f)) {
                Text(label,style=MaterialTheme.typography.bodyMedium)
                Text(if (valid == null) "Цвет темы" else "Свой цвет",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            GenesisLucideIcon("palette")
        }
    }
    if(open) GenesisColorPicker(label,valid,onDismiss={open=false},onColor={onColor(it);open=false})
}

/** Full HSV palette with an explicit commit: moving a finger never writes the encrypted document. */
@Composable internal fun GenesisColorPicker(label:String,initial:String?,onDismiss:()->Unit,onColor:(String?)->Unit,
    allowThemeColor:Boolean=true,previewLabel:String="Мысль",tagPrefix:String="mindmap") {
    val initialHsv=remember(initial) { FloatArray(3).also {android.graphics.Color.colorToHSV(android.graphics.Color.parseColor(initial ?: "#255b59"),it)} }
    var hue by remember {mutableFloatStateOf(initialHsv[0])}
    var saturation by remember {mutableFloatStateOf(initialHsv[1])}
    var value by remember {mutableFloatStateOf(initialHsv[2])}
    val selected=Color.hsv(hue,saturation,value)
    fun currentHex()=String.format("#%02x%02x%02x",(selected.red*255).roundToInt(),(selected.green*255).roundToInt(),(selected.blue*255).roundToInt())
    fun choose(hex:String) {val hsv=FloatArray(3);android.graphics.Color.colorToHSV(android.graphics.Color.parseColor(hex),hsv);hue=hsv[0];saturation=hsv[1];value=hsv[2]}
    val svLabel=genesisTranslate("Насыщенность и яркость")
    AlertDialog(onDismissRequest=onDismiss,title={Text(label)},modifier=Modifier.testTag("$tagPrefix-color-picker"),
        text={Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            CompositionLocalProvider(LocalPreserveCalendarColors provides true) {
                Surface(Modifier.fillMaxWidth().height(56.dp).testTag("$tagPrefix-color-preview"),color=selected,
                    contentColor=if(selected.luminance()>.179f)Color.Black else Color.White,shape=AffairsLayout.controlShape) {
                    Box(contentAlignment=Alignment.Center) {Text(previewLabel,style=MaterialTheme.typography.labelLarge)}
                }
                Canvas(Modifier.fillMaxWidth().height(144.dp).testTag("$tagPrefix-color-sv").semantics {contentDescription=svLabel}
                    .pointerInput(Unit) {awaitEachGesture {
                        val down=awaitFirstDown();fun update(p:Offset) {saturation=(p.x/size.width).coerceIn(0f,1f);value=(1-p.y/size.height).coerceIn(0f,1f)}
                        update(down.position);down.consume()
                        do {val event=awaitPointerEvent();event.changes.firstOrNull()?.let {update(it.position)};event.changes.forEach {it.consume()}} while(event.changes.any {it.pressed})
                    }}) {
                    drawRect(Brush.horizontalGradient(listOf(Color.White,Color.hsv(hue,1f,1f))))
                    drawRect(Brush.verticalGradient(listOf(Color.Transparent,Color.Black)))
                    val point=Offset(saturation*size.width,(1-value)*size.height)
                    drawCircle(Color.Black,7.dp.toPx(),point,style=Stroke(3.dp.toPx()))
                    drawCircle(Color.White,7.dp.toPx(),point,style=Stroke(1.5.dp.toPx()))
                }
                Text("Оттенок",style=MaterialTheme.typography.labelLarge)
                Box(Modifier.fillMaxWidth().height(48.dp),contentAlignment=Alignment.Center) {
                    Box(Modifier.fillMaxWidth().padding(horizontal=12.dp).height(8.dp).background(
                        Brush.horizontalGradient((0..6).map {Color.hsv((it*60f).coerceAtMost(359.9f),1f,1f)}),AffairsLayout.controlShape))
                    Slider(hue,{hue=it},valueRange=0f..359.9f,modifier=Modifier.fillMaxWidth().testTag("$tagPrefix-color-hue"),
                        colors=SliderDefaults.colors(thumbColor=Color.hsv(hue,1f,1f),activeTrackColor=Color.Transparent,inactiveTrackColor=Color.Transparent))
                }
                val presets=listOf("#255b59","#dfc17e","#bb704b","#5e79ad","#8666a8","#70995c","#fffdf8","#17221b")
                presets.chunked(4).forEach {row->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    row.forEach {hex->
                        val picked=currentHex().equals(hex,true)
                        androidx.compose.material3.Surface(onClick={choose(hex)},color=Color(android.graphics.Color.parseColor(hex)),
                            contentColor=if(Color(android.graphics.Color.parseColor(hex)).luminance()>.179f)Color.Black else Color.White,
                            shape=AffairsLayout.controlShape,border=selectedControlBorder(picked,
                                fallback=BorderStroke(1.dp,MaterialTheme.colorScheme.outline),background=Color(android.graphics.Color.parseColor(hex))),
                            modifier=Modifier.weight(1f).height(48.dp).testTag("$tagPrefix-swatch-$hex")
                                .semantics {contentDescription=hex.uppercase();this.selected=picked}) {Box(contentAlignment=Alignment.Center) {if(picked) GenesisLucideIcon("check")}}
                    }
                } }
            }
            if(allowThemeColor) TextButton(onClick={onColor(null)},modifier=Modifier.fillMaxWidth().testTag("$tagPrefix-color-default")) {Text("Цвет темы")}
        }},
        confirmButton={Button(onClick={onColor(currentHex())},modifier=Modifier.testTag("$tagPrefix-color-apply")){Text("Применить")}},
        dismissButton={TextButton(onClick=onDismiss){Text("Отмена")}})
}
