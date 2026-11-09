package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Dialog
import androidx.compose.ui.window.DialogProperties
import java.time.LocalDate
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.TheokyklosCatalogSource
import ru.genesis.calendar.domain.TheokyklosPractice
import ru.genesis.calendar.domain.habits.Habit
import ru.genesis.calendar.domain.habits.HabitEngine

/** The same 14-sector catalog and practice identities used on the site and in Theokyklos. */
@Composable
internal fun SacredHabitsBlock(workspace: LocalHabitWorkspace, today: LocalDate, calendarMode: CalendarMode,
    disabled: Boolean, requestedOpen: Boolean, onRequestedOpenConsumed: () -> Unit,
    experimental: Boolean = false,
    onStart: (TheokyklosPractice) -> Unit, onEdit: (Habit) -> Unit,
    onComplete: (Habit,Boolean) -> Unit, onToggle: (Habit) -> Unit, onDelete: (Habit) -> Unit = {},
    onRestore: (Habit) -> Unit = {}) {
    val context=LocalContext.current
    val english=LocalGenesisLanguage.current=="en"
    val catalog=remember(context,english) {
        runCatching { TheokyklosCatalogSource.load(context,if(english)"en" else "ru") }.getOrNull()
    }
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(requestedOpen) {
        if(requestedOpen) onRequestedOpenConsumed()
    }
    Surface((if (experimental) Modifier.animateContentSize() else Modifier).fillMaxWidth()
        .testTag("sacred-habits-block"),shape=RoundedCornerShape(20.dp),
        color=if (experimental) Color(0xff103330) else MaterialTheme.colorScheme.surfaceContainerHigh,
        border=BorderStroke(1.dp,if (experimental) Color(0x99dfc17e) else MaterialTheme.colorScheme.outlineVariant),
        shadowElevation=if (experimental) 7.dp else 0.dp) {
        Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            if (experimental) {
                Row(Modifier.fillMaxWidth().testTag("sacred-habits-heading"),
                    verticalAlignment=Alignment.CenterVertically,
                    horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                    Surface(Modifier.size(68.dp),shape=RoundedCornerShape(18.dp),
                        color=Color(0xff244136),border=BorderStroke(1.dp,Color(0x99dfc17e))) {
                        OriginalImage("theokyklos-symbols/hearth-hestia.png",null,Modifier.fillMaxSize())
                    }
                    Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                        Text(if (english) "Sacred habits" else "Сакральные привычки",
                            style=MaterialTheme.typography.titleLarge,color=Color(0xfffff6e2))
                        Text(if (english) "Myth inspired daily practices from the Theokyklos."
                            else "Практики Теокиклоса: мифы и божества в ежедневном ритме.",
                            style=MaterialTheme.typography.bodySmall,color=Color(0xffc8d9d4))
                    }
                }
            } else Text(if (english) "Sacred habits" else "Сакральные привычки",
                style = MaterialTheme.typography.titleLarge)
            SacredHabitsExpandedGroup(experimental) {
                Text(if(english)"THEOKYKLOS · EMBODIED MYTH" else "ТЕОКИКЛОС · ВОПЛОЩЁННЫЙ МИФ",
                    style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.primary)
                Text(if(english)"Each practice is a trackable everyday action inspired by a myth and patron deity."
                    else "Каждая практика — отслеживаемое действие, связанное с мифом и божеством-покровителем.",
                    style=MaterialTheme.typography.bodySmall)
                if(catalog==null) Text(if(english)"The sacred practice catalog is unavailable."
                    else "Каталог сакральных практик недоступен.",color=MaterialTheme.colorScheme.error)
                else catalog.sectors.chunked(2).forEach { pair ->
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                        pair.forEach { sector ->
                            val started=catalog.practicesFor(sector.id).count { standardSacredHabit(workspace.habits, it.id) != null }
                            OutlinedCard(onClick={selectedId=sector.id},modifier=Modifier.weight(1f).heightIn(min=106.dp)
                                .testTag("sacred-sector-${sector.id}"),enabled=!disabled) {
                                Column(Modifier.padding(10.dp),verticalArrangement=Arrangement.spacedBy(3.dp)) {
                                    OriginalImage(sector.symbolArt,null,Modifier.size(28.dp))
                                    Text((if(english)sector.title.en else sector.title.ru).substringBefore(" · "),
                                        style=MaterialTheme.typography.titleSmall,maxLines=2)
                                    Text(if(started>0)"$started/${catalog.practicesFor(sector.id).size}"
                                        else if(english)sector.patrons.en else sector.patrons.ru,
                                        style=MaterialTheme.typography.labelSmall,maxLines=2)
                                }
                            }
                        }
                        if(pair.size==1) Spacer(Modifier.weight(1f))
                    }
                }
            }
        }
    }
    val sector=selectedId?.let { catalog?.byId?.get(it) }
    if(sector!=null && catalog!=null) {
        val engine=remember { HabitEngine(GenesisCalendar()) }
        Dialog(onDismissRequest={selectedId=null},properties=DialogProperties(usePlatformDefaultWidth=false)) {
            Surface(Modifier.fillMaxWidth(),shape=AffairsLayout.shape,
                color=MaterialTheme.colorScheme.surface) {
                Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),
                    verticalArrangement=Arrangement.spacedBy(12.dp)) {
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                        OriginalImage(sector.symbolArt,null,Modifier.size(42.dp))
                        Column(Modifier.weight(1f).padding(start=8.dp)) {
                            Text(if(english)sector.title.en else sector.title.ru,
                                style=MaterialTheme.typography.titleLarge)
                            Text(if(english)sector.patrons.en else sector.patrons.ru,
                                style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.primary)
                        }
                        AffairsIconButton("Закрыть", AffairsAction.CLOSE, { selectedId = null }, Modifier.testTag("sacred-sector-close"))
                    }
                    OriginalImage(sector.art,if(english)sector.title.en else sector.title.ru,
                        Modifier.fillMaxWidth().height(150.dp))
                    Text(if(english)sector.essence.en else sector.essence.ru,
                        style=MaterialTheme.typography.titleSmall)
                    Text(if(english)sector.description.en else sector.description.ru,
                        style=MaterialTheme.typography.bodySmall)
                    HorizontalDivider()
                    Text(if(english)"Choose a sacred habit" else "Выберите сакральную привычку",
                        style=MaterialTheme.typography.titleMedium)
                    val standard = catalog.practicesFor(sector.id)
                    val additional = ru.genesis.calendar.domain.StoicheionRestoration.visibleHabits(workspace.habits)
                        .filter { it.stoicheionRestoration?.sectorId == sector.id }
                    val rows = standard.map { it to standardSacredHabit(workspace.habits, it.id) } +
                        additional.mapNotNull { habit -> catalog.practices.firstOrNull {
                            it.id == habit.stoicheionRestoration?.practiceId }?.let { it to habit } }
                    rows.forEachIndexed { index, (practice, habit) ->
                        if (index == standard.size) {
                            HorizontalDivider()
                            Text(if (english) "Additional practices from readings" else "Дополнительные практики из раскладов",
                                style = MaterialTheme.typography.titleMedium)
                        }
                        val entry=habit?.let { found -> workspace.completions.firstOrNull {
                            it.habitId==found.id && it.date==today } }
                        val scheduled=habit?.let { runCatching { engine.isScheduled(it,today,workspace.completions) }.getOrDefault(false) } == true
                        Card(Modifier.fillMaxWidth().testTag(if (habit?.stoicheionRestoration != null) "sacred-restoration-${habit.id}" else "sacred-practice-${practice.id}"),
                            colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.surfaceContainerHigh)) {
                            Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(7.dp)) {
                                Text("${habit?.emoji ?: practice.emoji} ${habit?.let { habitDisplayTitle(it) } ?: if(english)practice.title.en else practice.title.ru}",
                                    style=MaterialTheme.typography.titleMedium)
                                Text(habit?.let { habitDisplayDescription(it) } ?: if(english)practice.description.en else practice.description.ru,
                                    style=MaterialTheme.typography.bodyMedium)
                                Text(if(english)practice.myth.en else practice.myth.ru,
                                    style=MaterialTheme.typography.bodySmall,
                                    color=MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(if(habit==null) {
                                    if(english)"Suggested ${practice.suggestedTime} · priority ${practice.priority}"
                                    else "Рекомендуется ${practice.suggestedTime} · приоритет ${practice.priority}"
                                } else {
                                    if(english) "${if(habit.active)"Active" else "Paused"} · " +
                                        (if(scheduled)"scheduled today" else "not scheduled today")
                                    else "${if(habit.active)"Активна" else "На паузе"} · " +
                                        (if(scheduled)"запланирована сегодня" else "сегодня не запланирована")
                                },style=MaterialTheme.typography.labelSmall)
                                if(habit==null) {
                                    UntranslatedText(habitPracticeCopy().getString("warning"),style=MaterialTheme.typography.bodySmall)
                                    Button(onClick={onStart(practice)},enabled=!disabled) { Text(if(english)"Begin practice" else "Начать практику") }
                                } else {
                                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(6.dp)) {
                                        TextButton(onClick={selectedId=null;onEdit(habit)},enabled=!disabled) {
                                            Text(if(english)"Edit" else "Изменить")
                                        }
                                        if (habit.stoicheionRestoration != null) AffairsIconButton("Удалить привычку", AffairsAction.DELETE,
                                            { selectedId = null; onDelete(habit) }, Modifier.testTag("sacred-restoration-delete-${habit.id}"),
                                            enabled = !disabled, contentColor = MaterialTheme.colorScheme.error, outlined = false)
                                        if(habit.active) {
                                            TextButton(onClick={onComplete(habit,entry?.completed!=true)},
                                                enabled=!disabled&&scheduled) {
                                                Text(if(entry?.completed==true)"✓ ${if(english)"Done" else "Выполнено"}"
                                                    else if(english)"Mark today" else "Отметить")
                                            }
                                        }
                                    }
                                    OutlinedButton(onClick={onToggle(habit)},enabled=!disabled) {
                                        Text(if(habit.active) { if(english)"Pause" else "Пауза" }
                                            else if(english)"Resume" else "Возобновить")
                                    }
                                    SacredHabitRestoreAction(habit, practice, disabled) {
                                        onRestore(restoreSacredHabitContent(habit, practice, english))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SacredHabitsExpandedGroup(experimental: Boolean, content: @Composable ColumnScope.() -> Unit) {
    if (experimental) Surface(shape=RoundedCornerShape(16.dp),color=Color(0xfff8f4e9)) {
        Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp),content=content)
    } else Column(verticalArrangement=Arrangement.spacedBy(10.dp),content=content)
}
