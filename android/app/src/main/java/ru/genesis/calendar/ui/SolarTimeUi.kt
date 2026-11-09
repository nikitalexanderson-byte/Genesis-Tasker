package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.SolarLocation
import ru.genesis.calendar.domain.SolarTimes
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
internal fun rememberAutomaticSolarLocation(zoneId: ZoneId): State<SolarLocation> =
    run {
        val context = LocalContext.current
        val preferences = remember(context) { SolarPlaceStore.preferences(context) }
        val location = remember(zoneId, preferences) {
            mutableStateOf(SolarPlaceStore.read(preferences) ?: SolarTimes.fallbackLocation(zoneId))
        }
        DisposableEffect(zoneId, preferences) {
            val listener = android.content.SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
                location.value = SolarPlaceStore.read(preferences) ?: SolarTimes.fallbackLocation(zoneId)
            }
            preferences.registerOnSharedPreferenceChangeListener(listener)
            onDispose { preferences.unregisterOnSharedPreferenceChangeListener(listener) }
        }
        LaunchedEffect(zoneId, preferences) {
            if (SolarPlaceStore.readSelected(preferences) == null &&
                SolarPlaceStore.needsAutomaticRefresh(preferences)) {
                withContext(Dispatchers.IO) { SolarPlaceStore.refreshAutomatic(preferences) }
                location.value = SolarPlaceStore.read(preferences) ?: SolarTimes.fallbackLocation(zoneId)
            }
        }
        location
    }

internal fun solarTimeLabels(date: LocalDate, location: SolarLocation, calendar: GenesisCalendar): Pair<String, String>? {
    val zone = runCatching { location.timeZoneId?.let(ZoneId::of) }.getOrNull() ?: calendar.zoneId
    val times = SolarTimes.sunriseSunset(date, location, zone) ?: return null
    val formatter = DateTimeFormatter.ofPattern("HH:mm")
    val prefix = if (location.approximate) "≈" else ""
    return prefix + formatter.format(times.sunrise.atZone(zone)) to
        prefix + formatter.format(times.sunset.atZone(zone))
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun SunriseSunsetLine(date: LocalDate, location: SolarLocation, calendar: GenesisCalendar,
    accent: Color = MaterialTheme.colorScheme.primary,
    textColor: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    preserveInk: Boolean = false,
    modifier: Modifier = Modifier) {
    val labels = solarTimeLabels(date, location, calendar)
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (labels == null) Text("☀ Полярный день или ночь", style = MaterialTheme.typography.labelMedium,
            color = textColor, adjustInk = !preserveInk)
        else {
            Text("↗ Восход ${labels.first}", style = MaterialTheme.typography.labelMedium, color = accent, adjustInk = !preserveInk)
            Text("↘ Закат ${labels.second}", style = MaterialTheme.typography.labelMedium, color = textColor, adjustInk = !preserveInk)
        }
    }
}
