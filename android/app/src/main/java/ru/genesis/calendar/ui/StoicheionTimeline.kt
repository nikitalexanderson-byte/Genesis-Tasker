package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.Hyphens
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import org.json.JSONObject
import ru.genesis.calendar.data.StoicheionDraw
import ru.genesis.calendar.data.StoicheionTimelineState
import ru.genesis.calendar.domain.StoicheionReading

internal data class StoicheionTimePosition(val id: String, val title: String, val meaning: String)

/** Both clients read the same authored explanation and temporal order. */
@Composable internal fun stoicheionTimelineCopy(): JSONObject {
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    return remember(context, language) {
        JSONObject(context.assets.open("originals/catalogs/stoicheion-timeline.json").bufferedReader().use { it.readText() })
            .let { it.optJSONObject(language) ?: it.getJSONObject("en") }.also { copy ->
                val extra = JSONObject(context.assets.open("originals/catalogs/stoicheion-timeline-web.json")
                    .bufferedReader().use { it.readText() }).let { it.optJSONObject(language) ?: it.getJSONObject("en") }
                extra.keys().forEach { key -> copy.put(key, extra.get(key)) }
            }
    }
}

@Composable internal fun StoicheionTimelinePanel(letters: List<StoicheionLetter>, draw: StoicheionDraw?,
    ready: Boolean, now: Long, busy: Boolean, onBegin: () -> Unit, onSelect: (StoicheionSelection) -> Unit,
    session: StoicheionTimelineState? = null, onCardAction: ((Int, String) -> Unit)? = null) {
    val copy = stoicheionTimelineCopy()
    val allowed=LocalFeatureAccess.current.allows("stoicheion-timeline")
    var helpOpen by rememberSaveable { mutableStateOf(false) }
    val cards = remember(letters, draw?.seed) { draw?.let { StoicheionReading.spread(letters, it.seed, 3) } }
    val actionModifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
    StoicheionSection(OracleTone.SAGE, "stoicheion-timeline-block") {
        UntranslatedText(copy.getString("title"), style = MaterialTheme.typography.titleLarge)
        UntranslatedText(copy.getString("subtitle"), style = MaterialTheme.typography.bodyMedium)
        UntranslatedText(copy.getString("weeklyRule"), style = MaterialTheme.typography.bodySmall)
        if(!allowed) {
            Text(if(LocalGenesisLanguage.current=="en") "Three-card divination is available with Standard and above." else "Прорицание по трём картам доступно в Standard и выше.")
            val openUpgrade = LocalNativeUpgrade.current
            if (openUpgrade != null) NativeUpgradeSidebarButton({ openUpgrade("stoicheion-timeline") }, actionModifier,
                label = if (LocalGenesisLanguage.current == "en") "Compare plans" else genesisTranslate("Сравнить тарифы"),
                compact = true, tag = "upgrade-prompt-stoicheion-timeline")
        }
        if (onCardAction != null) {
            UntranslatedText(copy.getString("perCardRule"), style = MaterialTheme.typography.bodySmall)
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val density = LocalDensity.current
                val measurer = rememberTextMeasurer()
                val captionStyle = MaterialTheme.typography.labelSmall.copy(hyphens = Hyphens.None)
                val titleStyle = MaterialTheme.typography.labelMedium
                // Reserve the same text space even before the cards are opened. The longest
                // localized instruction and the revealed name/orientation must both fit.
                val textWidth = with(density) { ((maxWidth - 12.dp) / 3 - 10.dp).roundToPx().coerceAtLeast(1) }
                val footerHeight = with(density) {
                    val constraints = Constraints(maxWidth = textWidth)
                    val instructionHeight = listOf("openCard", "waiting").maxOf {
                        measurer.measure(copy.getString(it), captionStyle, constraints = constraints).size.height
                    }
                    val nameHeight = measurer.measure("Ag", captionStyle, maxLines = 1).size.height
                    val orientationHeight = listOf("upright", "reversed").maxOf {
                        measurer.measure(copy.getString(it), captionStyle, constraints = constraints).size.height
                    }
                    maxOf(instructionHeight, nameHeight + 6.dp.roundToPx() + orientationHeight).toDp()
                }
                val titleHeight = with(density) { measurer.measure("Ag", titleStyle, maxLines = 1).size.height.toDp() }
                Row(Modifier.fillMaxWidth().testTag("stoicheion-timeline-cards"), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (index in 0..2) {
                    val data = copy.getJSONArray("positions").getJSONObject(index)
                    val position = StoicheionTimePosition(data.getString("id"), data.getString("title"), data.getString("meaning"))
                    val revealed = index < (session?.cards?.size ?: 0)
                    val card = cards?.getOrNull(index).takeIf { revealed }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Card(onClick = {
                            if (card != null) onSelect(StoicheionSelection(card.first, card.second, timePosition = position))
                            else onCardAction(index, "reveal")
                        }, enabled = card != null || allowed && ready && !busy && index == (session?.cards?.size ?: 0),
                            modifier = Modifier.fillMaxWidth().testTag("stoicheion-timeline-${position.id}")) {
                            Column(Modifier.padding(5.dp), horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                UntranslatedText(position.title, Modifier.heightIn(min = titleHeight), maxLines = 1, style = titleStyle)
                                if (card != null) {
                                    StoicheionCardFace(card.first, Modifier.fillMaxWidth().graphicsLayer { rotationZ = if (card.second) 180f else 0f })
                                } else {
                                    Box(Modifier.fillMaxWidth().aspectRatio(2f / 3f), contentAlignment = Alignment.Center) { GenesisLucideIcon("eye") }
                                }
                                Column(Modifier.fillMaxWidth().height(footerHeight), horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    if (card != null) {
                                        UntranslatedText(card.first.name, maxLines = 1, style = captionStyle)
                                        UntranslatedText(copy.getString(if (card.second) "reversed" else "upright"), style = captionStyle)
                                    } else {
                                        UntranslatedText(copy.getString(if (index == (session?.cards?.size ?: 0)) "openCard" else "waiting"), style = captionStyle)
                                    }
                                }
                            }
                        }
                        if (card != null) {
                            val remaining = session?.remainingSeconds(index, now) ?: 0
                            val canReroll = session?.canReroll(index, now) == true
                            OutlinedButton(onClick = { onCardAction(index, "reroll") }, enabled = allowed && !busy && canReroll,
                                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("stoicheion-reroll-timeline-$index")) {
                                UntranslatedText(if (canReroll && session?.cards?.get(index)?.unlimited == true) copy.getString("rerollCard")
                                    else if (remaining > 0) "${copy.getString("rerollCard")} · ${countdown(remaining)}"
                                    else copy.getString(if (session?.cards?.get(index)?.rerolled == true) "rerollUsed" else "rerollExpired"),
                                    style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                }
            }
            }
        } else if (cards == null) Button(onBegin, enabled = allowed && ready && !busy,
            modifier = actionModifier.testTag("stoicheion-draw-timeline")) {
            UntranslatedText(copy.getString("begin"), maxLines = 1)
        } else {
            Row(Modifier.fillMaxWidth().testTag("stoicheion-timeline-cards"), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                cards.forEachIndexed { index, (letter, reversed) ->
                    val data = copy.getJSONArray("positions").getJSONObject(index)
                    val position = StoicheionTimePosition(data.getString("id"), data.getString("title"), data.getString("meaning"))
                    Card(onClick = { onSelect(StoicheionSelection(letter, reversed, timePosition = position)) },
                        colors = CardDefaults.cardColors(containerColor = stoicheionCardSurface(reversed, MaterialTheme.colorScheme.surfaceContainerLow)),
                        modifier = Modifier.weight(1f).testTag("stoicheion-timeline-${position.id}")) {
                        Column(Modifier.padding(5.dp), horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            UntranslatedText(position.title, maxLines = 1, style = MaterialTheme.typography.labelMedium)
                            StoicheionCardFace(letter, Modifier.fillMaxWidth().graphicsLayer { rotationZ = if (reversed) 180f else 0f })
                            UntranslatedText(letter.name, maxLines = 1, style = MaterialTheme.typography.labelSmall)
                            UntranslatedText(copy.getString(if (reversed) "reversed" else "upright"),
                                style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
            if (draw != null) RerollAction(draw, now, busy || !allowed, copy.getString("reroll"), tone = OracleTone.MAUVE, onClick = onBegin)
        }
        OutlinedButton(onClick = { helpOpen = true }, shape = AffairsLayout.controlShape,
            modifier = actionModifier.testTag("stoicheion-timeline-help"),
            colors = ButtonDefaults.outlinedButtonColors(containerColor = MaterialTheme.colorScheme.primary.copy(alpha = .08f))) {
            UntranslatedText(copy.getString("method"), maxLines = 1)
        }
    }
    if (helpOpen) Dialog(onDismissRequest = { helpOpen = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.widthIn(max = 640.dp).fillMaxWidth().heightIn(max = 720.dp).padding(12.dp), shape = AffairsLayout.shape) {
            Column(Modifier.padding(16.dp).testTag("stoicheion-timeline-help-dialog"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                EditorDialogHeader(copy.getString("method"), "stoicheion-timeline-help-close") { helpOpen = false }
                Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    val paragraphs = copy.getJSONArray("paragraphs")
                    for (index in 0 until paragraphs.length()) UntranslatedText(paragraphs.getString(index), style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}
