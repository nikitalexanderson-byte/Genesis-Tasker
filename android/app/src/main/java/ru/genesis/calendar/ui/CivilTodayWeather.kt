package ru.genesis.calendar.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.domain.*
import java.math.RoundingMode
import java.text.NumberFormat
import java.time.Instant
import java.util.Locale

/** Confine the reading shade to the text so the landscape remains visible between groups. */
@Composable internal fun Modifier.civilReadingArea(): Modifier =
    (if (!LocalEveningTheme.current) this else
        background(if (LocalContentColor.current.luminance() > .5f) Color.Black.copy(alpha = .08f)
            else Color.White.copy(alpha = .16f), AffairsLayout.controlShape)).padding(3.dp)

/** All readings remain visible in the right column, beside the date and clock. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun CivilTodayWeather(state: CivilWeatherState, now: Instant, onChooseCity: () -> Unit = {},
    solar: @Composable () -> Unit = {}, header: @Composable () -> Unit) {
    if (!state.enabled) {
        Column(Modifier.fillMaxWidth().civilReadingArea(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            header()
            solar()
        }
        return
    }
    val language = LocalGenesisLanguage.current
    val copy = rememberWeatherCopy()
    val units = LocalWeatherDisplayUnits.current
    val weather = state.snapshot
    val current = weather?.displayCurrent(now)
    val ink = LocalContentColor.current
    val locale = remember(language) { Locale.forLanguageTag(language) }
    val number = remember(locale) { NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 1; isGroupingUsed = false } }
    val degrees = remember(locale) { NumberFormat.getNumberInstance(locale).apply {
        maximumFractionDigits = 0; isGroupingUsed = false; roundingMode = RoundingMode.HALF_UP } }
    Column(Modifier.fillMaxWidth().testTag("civil-weather-summary"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.TopStart) {
                Column(Modifier.fillMaxSize().civilReadingArea(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    header()
                    solar()
                }
            }
            if (current == null || weather == null) {
                val key = when {
                    state.requiresLocation || weather?.status == "requires-location" -> "requiresLocation"
                    weather == null && !state.failed -> "loading"
                    else -> "unavailable"
                }
                if (key == "requiresLocation") OutlinedButton(onClick = onChooseCity,
                    modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("civil-weather-choose-city")) {
                    Text(copy.getString(key), style = MaterialTheme.typography.bodySmall,
                        color = ink, translate = false, adjustInk = false)
                } else Text(copy.getString(key), Modifier.weight(1f).fillMaxHeight().civilReadingArea().testTag("civil-weather-status"),
                    style = MaterialTheme.typography.bodySmall, color = ink, translate = false, adjustInk = false)
            } else {
                val fresh = weather.isFresh(now)
                val condition = if (current.precipitationKind == "hail") "hail" else current.condition
                val conditions = copy.getJSONObject("conditions")
                Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.TopEnd) {
                Column(Modifier.fillMaxSize().civilReadingArea()
                    .testTag("civil-weather-current")
                    .semantics { stateDescription = if (fresh) "" else copy.getString("stale") },
                    horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        weatherTemperature(current.temperatureC, units.temperature)?.let { converted ->
                            val value = if (kotlin.math.abs(converted) < .5) 0.0 else converted
                            Text((if (value >= .5) "+" else "") + degrees.format(value) +
                                if (units.temperature == WeatherTemperatureUnit.FAHRENHEIT) "°F" else "°C",
                                Modifier.testTag("civil-weather-temperature"), style = MaterialTheme.typography.headlineSmall,
                                color = ink, translate = false, adjustInk = false)
                        }
                    Text(conditions.optString(condition, conditions.getString("unknown")),
                        style = MaterialTheme.typography.bodySmall, color = ink, textAlign = TextAlign.End,
                        translate = false, adjustInk = false)
                    current.windSpeedMps?.let { speed ->
                        Text(copy.getString("wind") + " " + number.format(speed) + " m/s",
                            style = MaterialTheme.typography.bodySmall, color = ink, textAlign = TextAlign.End,
                            translate = false, adjustInk = false)
                    }
                    Column(Modifier.fillMaxWidth().padding(top = 3.dp).testTag("civil-weather-details"),
                        horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        val rows = listOf(
                            "humidity" to current.humidityPercent?.let { number.format(it) + "%" },
                            "pressure" to weatherPressure(current.pressureMslHpa, units.pressure)?.let {
                                number.format(it) + " " + copy.getString(if (units.pressure == WeatherPressureUnit.MMHG) "mmHg" else "hPa") },
                            "precipitation" to current.precipitationRateMmH?.let { number.format(it) + " mm/h" },
                        )
                        rows.forEach { (key, value) -> if (value != null) {
                            Text(if (key == "pressure") value else copy.getString(key) + ": " + value,
                                Modifier.testTag("civil-weather-$key").semantics { contentDescription = copy.getString(key) + ": " + value },
                                style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.End,
                                color = ink, translate = false, adjustInk = false,
                                maxLines = if (key == "pressure") 1 else Int.MAX_VALUE)
                        } }
                    }
                    if (!fresh) Text(copy.getString("stale"), style = MaterialTheme.typography.labelMedium,
                        color = ink, textAlign = TextAlign.End, translate = false, adjustInk = false)
                }
                }
            }
        }
    }
}
