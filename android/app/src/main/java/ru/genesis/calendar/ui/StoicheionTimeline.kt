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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import org.json.JSONObject
import ru.genesis.calendar.data.StoicheionDraw
import ru.genesis.calendar.domain.StoicheionReading

internal data class StoicheionTimePosition(val id: String, val title: String, val meaning: String)

/** Both clients read the same authored explanation and temporal order. */
@Composable internal fun stoicheionTimelineCopy(): JSONObject {
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    return remember(context, language) {
        JSONObject(context.assets.open("originals/catalogs/stoicheion-timeline.json").bufferedReader().use { it.readText() })
            .let { it.optJSONObject(language) ?: it.getJSONObject("en") }
    }
}

@Composable internal fun StoicheionTimelinePanel(letters: List<StoicheionLetter>, draw: StoicheionDraw?,
    ready: Boolean, now: Long, busy: Boolean, onBegin: () -> Unit, onSelect: (StoicheionSelection) -> Unit) {
    val copy = stoicheionTimelineCopy()
    val allowed=LocalFeatureAccess.current.allows("stoicheion-timeline")
    var helpOpen by rememberSaveable { mutableStateOf(false) }
    val cards = remember(letters, draw?.seed) { draw?.let { StoicheionReading.spread(letters, it.seed, 3) } }
    val actionModifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
    StoicheionSection(OracleTone.SAGE, "stoicheion-timeline-block") {
        UntranslatedText(copy.getString("title"), style = MaterialTheme.typography.titleLarge)
        UntranslatedText(copy.getString("subtitle"), style = MaterialTheme.typography.bodyMedium)
        if(!allowed) {
            Text(if(LocalGenesisLanguage.current=="en") "Three-card divination is available with Standard and above." else "Прорицание по трём картам доступно в Standard и выше.")
            val openUpgrade = LocalNativeUpgrade.current
            if (openUpgrade != null) NativeUpgradeSidebarButton({ openUpgrade("stoicheion-timeline") }, actionModifier,
                label = if (LocalGenesisLanguage.current == "en") "Compare plans" else genesisTranslate("Сравнить тарифы"),
                compact = true, tag = "upgrade-prompt-stoicheion-timeline")
        }
        if (cards == null) Button(onBegin, enabled = allowed && ready && !busy,
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
