package ru.genesis.calendar.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.ui.UntranslatedText as NativeText
import java.util.Locale

@Composable internal fun AdvicePsychopompiaControls(value: AdvicePsychopompiaPreferences, language: String,
    enabled: Boolean, errorMessage: String? = null, onChange: (AdvicePsychopompiaPreferences) -> Unit) {
    val context = LocalContext.current
    val copy = remember(context, language) { context.assets.open("originals/i18n/advice-psychopompia-copy.json")
        .bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()).getJSONObject(language) } }
    val policy = NativeAdviceAgeAccess.policy
    val countries = policy?.optJSONObject("jurisdictions") ?: JSONObject()
    val declaration = value.alcohol
    val country = countries.optJSONObject(declaration.countryCode)
    val subdivisions = country?.optJSONObject("subdivisions") ?: JSONObject()
    val jurisdiction = NativeAdviceAgeAccess.jurisdiction(declaration.countryCode, declaration.subdivisionCode)
    val canChange = enabled && value.adultConfirmed
    val displayLocale = Locale.forLanguageTag(language)
    fun countryName(code: String) = Locale.Builder().setRegion(code).build().getDisplayCountry(displayLocale)
    fun declare(code: String, subdivision: String) = onChange(value.copy(alcohol = declaration.copy(countryCode = code,
        subdivisionCode = subdivision, consent = false, ageAtLeast = null, policyVersion = NativeAdviceAgeAccess.policyVersion)))
    @Composable fun checkbox(label: String, checked: Boolean, active: Boolean, tag: String, action: (Boolean) -> Unit) {
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(tag).toggleable(checked, enabled = active, role = Role.Checkbox, onValueChange = action),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Checkbox(checked, null, enabled = active)
            NativeText(label, Modifier.weight(1f))
        }
    }
    var open by rememberSaveable { mutableStateOf(false) }
    OutlinedButton(onClick = { open = true }, enabled = enabled,
        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.primary),
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("psychopompia-settings-open")) {
        NativeText(copy.getString("title"), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
    if (open) AlertDialog(onDismissRequest = { open = false },
        modifier = Modifier.testTag("psychopompia-settings-dialog"), title = { NativeText(copy.getString("title")) },
        confirmButton = {}, text = { Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
        checkbox(copy.getString("adult"), value.adultConfirmed, enabled, "psychopompia-adult") { onChange(value.copy(adultConfirmed = it)) }
        NativeText(copy.getString("hint"), style = MaterialTheme.typography.bodySmall)
        if (policy?.optBoolean("corpusEnabled") != true) NativeText(copy.getString("pending"), style = MaterialTheme.typography.bodySmall)
        AffairsDisclosure(copy.getString("sections")) {
            NativeAdviceAgeAccess.subcategoryIds.forEach { id ->
                checkbox(copy.getJSONObject("subcategories").getString(id), id in value.subcategories, canChange, "psychopompia-subcategory-$id") { checked ->
                    onChange(value.copy(subcategories = NativeAdviceAgeAccess.subcategoryIds.filter { if (it == id) checked else it in value.subcategories }))
                }
            }
        }
        NativeText(copy.getString("wine"), style = MaterialTheme.typography.titleSmall)
        PsychopompiaChoice(copy.getString("country"), declaration.countryCode,
            countries.keys().asSequence().toList().map { it to countryName(it) }.sortedBy { it.second },
            copy.getString("choose"), canChange) { declare(it, "") }
        if (country?.optString("status") == "subdivision-required") PsychopompiaChoice(copy.getString("region"), declaration.subdivisionCode,
            subdivisions.keys().asSequence().toList().map { it to subdivisions.getJSONObject(it).optString("name", it) },
            copy.getString("choose"), canChange) { declare(declaration.countryCode, it) }
        checkbox(if (jurisdiction.minimumAge == null) copy.getString("wine") else copy.getString("age").replace("{age}", jurisdiction.minimumAge.toString()),
            NativeAdviceAgeAccess.alcoholAllowed(value), canChange && jurisdiction.state == "verified", "psychopompia-wine-consent") {
            onChange(value.copy(alcohol = declaration.copy(consent = it, ageAtLeast = if (it) jurisdiction.minimumAge else null,
                policyVersion = NativeAdviceAgeAccess.policyVersion)))
        }
        if (jurisdiction.state != "verified") NativeText(copy.getString(if (jurisdiction.state == "blocked") "blocked" else "unknown"),
            style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("psychopompia-jurisdiction-unavailable"))
        val currentRule = if (declaration.subdivisionCode.isEmpty()) country else subdivisions.optJSONObject(declaration.subdivisionCode)
        val sources = currentRule?.optJSONArray("sourceIds")
        if (sources != null && sources.length() > 0) AffairsDisclosure(copy.getString("sources")) {
            for (index in 0 until sources.length()) {
                val source = policy?.optJSONObject("sources")?.optJSONObject(sources.getString(index)) ?: continue
                val uri = Uri.parse(source.getString("url"))
                TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) }, modifier = Modifier.heightIn(min = 48.dp)) {
                    NativeText(uri.host ?: "Source")
                }
            }
        }
        NativeText(copy.getString("privacy"), style = MaterialTheme.typography.bodySmall)
        errorMessage?.let { NativeText(it, color = MaterialTheme.colorScheme.error,
            modifier = Modifier.testTag("psychopompia-settings-error")) }
    } })
}

@Composable private fun PsychopompiaChoice(label: String, value: String, options: List<Pair<String,String>>, choose: String,
    enabled: Boolean, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    NativeText(label, style = MaterialTheme.typography.titleSmall)
    OutlinedButton(onClick = { open = true }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
        NativeText(options.firstOrNull { it.first == value }?.second ?: choose)
    }
    if (open) AlertDialog(onDismissRequest = { open = false }, title = { NativeText(label) },
        text = { Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
            (listOf("" to choose) + options).forEach { (id, title) ->
                TextButton(onClick = { open = false; onChange(id) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { NativeText(title) }
            }
        } }, confirmButton = {})
}
