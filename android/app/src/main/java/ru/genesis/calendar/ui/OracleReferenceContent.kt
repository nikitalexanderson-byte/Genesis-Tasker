package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.domain.StoicheionReading

@Composable private fun oracleReference(name: String): JSONObject {
    val context = LocalContext.current
    return remember(context, name) {
        JSONObject(context.assets.open("originals/catalogs/$name.json").bufferedReader().use { it.readText() })
    }
}

private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map(::getJSONObject)
private fun JSONObject.localized(language: String): String = optString(language).ifBlank { getString("en") }

@Composable private fun OlympianSymbol(deity: JSONObject, modifier: Modifier = Modifier) {
    val source = if (deity.getString("id") == "kronos") "calendar-art/saturn-cronus.webp"
        else "theokyklos-symbols/olympian-${deity.getString("id")}-v313.png"
    OriginalImage(source, null,
        modifier.testTag("olympian-symbol-${deity.getString("id")}"), dimInDarkTheme = false)
}

@Composable internal fun OlympianIsopsephy(onOpenStoicheion: () -> Unit) {
    val content = oracleReference("olympian-isopsephy")
    val language = LocalGenesisLanguage.current
    val copy = content.getJSONObject("locales").let { it.optJSONObject(language) ?: it.getJSONObject("en") }
    val deities = remember(content) { content.getJSONArray("deities").objects() }
    var expanded by rememberSaveable { mutableStateOf(false) }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    val catalogScroll = rememberScrollState()
    Column(Modifier.fillMaxWidth().testTag("olympian-isopsephy"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SacredYearDetailsButton(copy.getString("title"), copy.getString("subtitle"), "olympian-isopsephy-toggle",
            GenesisPageIcon.THEOKYKLOS, expanded = false) { expanded = true }
        if (expanded) {
            Dialog(onDismissRequest = { expanded = false; selected = null },
                properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Surface(Modifier.padding(16.dp).widthIn(max = 720.dp).fillMaxWidth(), shape = AffairsLayout.shape) {
            Column(Modifier.verticalScroll(catalogScroll).padding(16.dp).testTag("olympian-catalog-dialog"),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
            EditorDialogHeader(copy.getString("title"), "olympian-catalog-close") { expanded = false; selected = null }
            UntranslatedText(copy.getString("intro"), style = MaterialTheme.typography.bodyMedium)
            TextButton({ expanded = false; onOpenStoicheion() }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("olympian-stoicheion-link")) {
                UntranslatedText(copy.getString("link"), Modifier.weight(1f))
                GenesisLucideIcon("chevron-right")
            }
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val columns = if (maxWidth >= 600.dp) 3 else 2
                val rows = deities.filterNot { it.getString("id") == "dionysus" }.chunked(columns) +
                    listOf(deities.filter { it.getString("id") == "dionysus" })
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    rows.forEach { row ->
                        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            row.forEach { deity ->
                                Surface(onClick = { selected = deity.getString("id") },
                                    modifier = Modifier.weight(1f).fillMaxHeight().heightIn(min = 140.dp)
                                        .testTag("olympian-${deity.getString("id")}"), shape = AffairsLayout.shape,
                                    color = MaterialTheme.colorScheme.surfaceContainerLow,
                                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                        OlympianSymbol(deity, Modifier.size(48.dp))
                                        UntranslatedText("${deity.getJSONObject("name").localized(language)} · ${deity.getInt("number")}",
                                            style = MaterialTheme.typography.titleSmall, maxLines = 1)
                                        UntranslatedText(deity.getJSONObject("summary").localized(language), style = MaterialTheme.typography.bodySmall)
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
        }
    }
    deities.firstOrNull { it.getString("id") == selected }?.let { deity ->
        Dialog(onDismissRequest = { selected = null }) {
            Surface(Modifier.widthIn(max = 480.dp).fillMaxWidth(), shape = AffairsLayout.shape) {
                Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState()).testTag("olympian-dialog"),
                    verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    EditorDialogHeader(deity.getJSONObject("name").localized(language), "olympian-dialog-close") { selected = null }
                    OlympianSymbol(deity, Modifier.size(64.dp))
                    UntranslatedText("${deity.getString("greek")} · ${deity.getInt("number")}",
                        style = MaterialTheme.typography.titleLarge)
                    val summands = deity.getJSONArray("summands")
                    val calculatedNumber = deity.optInt("calculatedNumber", deity.getInt("number"))
                    UntranslatedText((0 until summands.length()).joinToString(" + ") { summands.getInt(it).toString() } +
                        " = $calculatedNumber", style = MaterialTheme.typography.bodySmall)
                    deity.optJSONObject("calculationNote")?.let {
                        UntranslatedText(it.localized(language), style = MaterialTheme.typography.bodySmall)
                    }
                    UntranslatedText(deity.getJSONObject("detail").localized(language), style = MaterialTheme.typography.bodyMedium)
                    UntranslatedText(copy.getString("root"), style = MaterialTheme.typography.labelMedium)
                    UntranslatedText(StoicheionReading.trace(calculatedNumber).joinToString(" → "),
                        Modifier.testTag("olympian-digital-root"), style = MaterialTheme.typography.labelLarge)
                    TextButton(onClick = { selected = null; expanded = false; onOpenStoicheion() }, Modifier.fillMaxWidth()) {
                        UntranslatedText(copy.getString("link"))
                    }
                }
            }
        }
    }
}

@Composable internal fun FutureModelingEntryButton(source: JSONObject?, signedIn: Boolean, onOpen: () -> Unit) {
    // Unlike legacy unrestricted surfaces, this paid method always needs a live
    // entitlement (including the explicit owner grant) and the saved nine cards.
    val access=LocalFeatureAccess.current.copy(enforcementEnabled=true)
    if(!signedIn || source?.optJSONArray("cards")?.length()!=9 || !access.allows("future-modeling"))return
    val content=oracleReference("future-modeling")
    val language=LocalGenesisLanguage.current
    val copy=content.getJSONObject("locales").let { it.optJSONObject(language) ?: it.getJSONObject("en") }
    SacredYearDetailsButton(copy.getString("title"),copy.optString("subtitle"),"future-modeling-open",GenesisPageIcon.FUTURE_MODELING) {
        if(access.allows("future-modeling"))onOpen()
    }
}

@Composable internal fun FutureModelingGuide(source: JSONObject? = null, onTask: (AuroraTaskDraft) -> Unit = {}) {
    val access=LocalFeatureAccess.current.copy(enforcementEnabled=true)
    val context=LocalContext.current
    val controller=remember(context){ru.genesis.calendar.auth.AuthController.get(context)}
    val account by controller.state.collectAsState()
    var open by rememberSaveable { mutableStateOf(false) }
    FutureModelingEntryButton(source,account.user!=null){open=true}
    if(open && source?.optJSONArray("cards")?.length()==9 && access.allows("future-modeling")) {
        val owner=account.user?.uid
        if(owner!=null) key(owner) { NativeAuroraDialog(owner,source,{open=false},onTask) }
    }
}
