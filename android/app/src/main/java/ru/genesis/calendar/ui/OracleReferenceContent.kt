package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import org.json.JSONObject

@Composable private fun oracleReference(name: String): JSONObject {
    val context = LocalContext.current
    return remember(context, name) {
        JSONObject(context.assets.open("originals/catalogs/$name.json").bufferedReader().use { it.readText() })
    }
}

@Composable internal fun OlympianIsopsephy(onOpenStoicheion: () -> Unit,
    onOpenLetter: (String?) -> Unit = { onOpenStoicheion() }, onOpenSector: (String) -> Unit = {}) {
    val content = oracleReference("olympian-isopsephy")
    val language = LocalGenesisLanguage.current
    val copy = content.getJSONObject("locales").let { it.optJSONObject(language) ?: it.getJSONObject("en") }
    var expanded by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().testTag("olympian-isopsephy")) {
        SacredYearDetailsButton(copy.getString("title"), copy.getString("subtitle"), "olympian-isopsephy-toggle",
            GenesisPageIcon.THEOKYKLOS, expanded = false) { expanded = true }
    }
    if (expanded) NativeOlympianDialog(copy.getString("title"), { expanded = false },
        { id -> expanded = false; onOpenLetter(id) }, { id -> expanded = false; onOpenSector(id) })
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

@Composable internal fun FutureModelingGuide(source: JSONObject? = null, onTask: (AuroraTaskDraft) -> Unit = {},
    temporal: JSONObject? = null) {
    val access=LocalFeatureAccess.current.copy(enforcementEnabled=true)
    val context=LocalContext.current
    val controller=remember(context){ru.genesis.calendar.auth.AuthController.get(context)}
    val account by controller.state.collectAsState()
    var open by rememberSaveable { mutableStateOf(false) }
    FutureModelingEntryButton(source,account.user!=null){open=true}
    if(open && source?.optJSONArray("cards")?.length()==9 && access.allows("future-modeling")) {
        val owner=account.user?.uid
        if(owner!=null) key(owner) { NativeAuroraDialog(owner,source,{open=false},onTask,temporal=temporal) }
    }
}
