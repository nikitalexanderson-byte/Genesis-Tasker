package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import ru.genesis.calendar.domain.*

internal val LocalWeatherDisplayUnits = staticCompositionLocalOf { WeatherDisplayUnits() }

@Composable internal fun rememberWeatherCopy(): JSONObject {
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    return remember(context, language) {
        val catalog = context.assets.open("originals/i18n/weather-copy.json")
            .bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()) }
        catalog.optJSONObject(language) ?: catalog.getJSONObject("en")
    }
}

@Composable internal fun WeatherDisplaySettings(units: WeatherDisplayUnits,
    onTemperature: (String) -> Unit, onPressure: (String) -> Unit) {
    val copy = rememberWeatherCopy()
    val uri = LocalUriHandler.current
    SettingsPreferenceCard(copy.getString("displayTitle"), Modifier.layoutId(FULL_WIDTH_SETTINGS_SECTION)
        .testTag("appearance-weather-settings")) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val temperature: @Composable (Modifier, Boolean) -> Unit = { modifier, wide ->
                WeatherUnitGroup(copy.getString("temperatureUnit"), "temperature", units.temperature.wire,
                    listOf("celsius" to copy.getString("celsius"), "fahrenheit" to copy.getString("fahrenheit")),
                    onTemperature, modifier, wide)
            }
            val pressure: @Composable (Modifier, Boolean) -> Unit = { modifier, wide ->
                WeatherUnitGroup(copy.getString("pressure"), "pressure", units.pressure.wire,
                    listOf("hpa" to copy.getString("hectopascals"), "mmhg" to copy.getString("millimetersMercury")),
                    onPressure, modifier, wide)
            }
            if (maxWidth >= 600.dp) Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                temperature(Modifier.weight(1f).fillMaxHeight(), true)
                pressure(Modifier.weight(1f).fillMaxHeight(), true)
            } else Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                temperature(Modifier.fillMaxWidth(), false)
                pressure(Modifier.fillMaxWidth(), false)
            }
        }
        HorizontalDivider()
        Column(Modifier.fillMaxWidth().testTag("weather-attribution-settings"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(
                WeatherProviderV1("met-norway", "MET Norway", "https://www.met.no/", "https://creativecommons.org/licenses/by/4.0/", "forecast"),
                WeatherProviderV1("open-meteo", "Open-Meteo", "https://open-meteo.com/", "https://open-meteo.com/en/terms", "forecast")
            ).forEach { provider ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton({ uri.openUri(provider.attributionUrl) }, Modifier.weight(1f).heightIn(min = 48.dp)) {
                        Text(copy.getString("source") + ": " + provider.name, translate = false)
                    }
                    TextButton({ uri.openUri(provider.licenseUrl) }, Modifier.heightIn(min = 48.dp)) {
                        Text(copy.getString("license"), translate = false)
                    }
                }
            }
        }
    }
}

@Composable private fun WeatherUnitGroup(title: String, kind: String, selectedUnit: String,
    options: List<Pair<String, String>>, onChoose: (String) -> Unit, modifier: Modifier, wide: Boolean) {
    Column(modifier.testTag("weather-unit-group-$kind"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.labelLarge, translate = false)
        WeatherUnitChoices(kind, selectedUnit, options, onChoose, if (wide) Modifier.weight(1f) else Modifier)
    }
}

@Composable private fun WeatherUnitChoices(kind: String, selectedUnit: String,
    options: List<Pair<String, String>>, onChoose: (String) -> Unit, modifier: Modifier) {
    Row(modifier.fillMaxWidth().height(IntrinsicSize.Min).selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (unit, label) ->
            OutlinedButton({ onChoose(unit) }, Modifier.weight(1f).fillMaxHeight().heightIn(min = 48.dp)
                .testTag("weather-$kind-$unit").semantics { selected = unit == selectedUnit },
                selected = unit == selectedUnit, contentPadding = PaddingValues(8.dp)) {
                Text(label, textAlign = TextAlign.Center, style = MaterialTheme.typography.labelMedium, translate = false)
            }
        }
    }
}
