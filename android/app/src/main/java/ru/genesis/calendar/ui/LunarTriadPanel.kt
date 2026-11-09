package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import ru.genesis.calendar.domain.LunarPatron
import ru.genesis.calendar.domain.lunarPatronForDay

@Composable internal fun rememberLunarTriadCopy(): JSONObject {
    val assets = LocalContext.current.assets
    val language = LocalGenesisLanguage.current
    return remember(assets, language) {
        val catalog = assets.open("originals/i18n/lunar-triad-copy.json").bufferedReader(Charsets.UTF_8)
            .use { JSONObject(it.readText()) }
        catalog.optJSONObject(language) ?: catalog.getJSONObject("en")
    }
}

@Composable internal fun lunarTriadCopyForDay(day: Int): JSONObject =
    rememberLunarTriadCopy().getJSONObject(lunarPatronForDay(day).id)

/** Historical context belongs to the lunar year reference, away from the daily plan. */
@Composable internal fun LunarTriadDetails(modifier: Modifier = Modifier) {
    val copy = rememberLunarTriadCopy()
    val uri = LocalUriHandler.current
    Column(modifier.fillMaxWidth().testTag("lunar-triad"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(copy.getString("note"), style = MaterialTheme.typography.bodySmall, translate = false)
            LunarPatron.entries.forEachIndexed { index, patron ->
                val row = copy.getJSONObject(patron.id)
                Text(row.getString("name") + " · " + listOf("1–10", "11–20", "21–29/30")[index],
                    style = MaterialTheme.typography.titleSmall, translate = false)
                Text(row.getString("meaning"), style = MaterialTheme.typography.bodySmall, translate = false)
            }
            listOf(
                "Πλούταρχος · Σόλων 25.3" to "https://lexundria.com/plut_sol/25/prr",
                "Καλλίμαχος · Ὕμνος εἰς Ἄρτεμιν 1–40" to "https://www.theoi.com/Text/CallimachusHymns1.html",
                "Ὁμηρικὸς ὕμνος 27 · Ἄρτεμις" to "https://www.theoi.com/Text/HomericHymns3.html",
                "Ὁμηρικὸς ὕμνος 32 · Σελήνη 1–13" to "https://atlas.perseus.tufts.edu/library/passage/urn:cts:greekLit:tlg0013.tlg032.perseus-eng2:1-20/",
                "Ὁμηρικὸς ὕμνος 2 · Δήμητρα 24–25, 51–61, 438–440" to "https://www.theoi.com/Text/HomericHymns1.html",
                "Ἀριστοφάνης · Πλοῦτος 594–597" to "https://classics.mit.edu/Aristophanes/plutus.html",
                "Πορφύριος · Περὶ ἀγαλμάτων, fr. 8" to "https://classics.mit.edu/Porphyry/images.html",
            ).forEach { (label, url) ->
                TextButton({ uri.openUri(url) }, Modifier.fillMaxWidth()) {
                    Text(label, translate = false, style = MaterialTheme.typography.bodySmall)
                }
            }
    }
}
