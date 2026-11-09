package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun SolarPlaceSettings(focusCity: Boolean = false, onFocusHandled: () -> Unit = {}) {
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    val preferences = remember(context) { SolarPlaceStore.preferences(context) }
    var selected by remember { mutableStateOf(SolarPlaceStore.readSelected(preferences)) }
    var automatic by remember { mutableStateOf(SolarPlaceStore.readAutomatic(preferences)) }
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<SolarPlace>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val cityFocus = remember { FocusRequester() }
    val cityIntoView = remember { BringIntoViewRequester() }
    LaunchedEffect(focusCity) {
        if (focusCity) {
            withFrameNanos { }
            cityIntoView.bringIntoView()
            cityFocus.requestFocus()
            onFocusHandled()
        }
    }

    fun copy(ru: String, en: String): String = when (language) {
        "ru" -> ru
        "en" -> en
        else -> translateGenesisText(context, ru, language).let { if (it == ru) en else it }
    }
    fun choose(place: SolarPlace) {
        SolarPlaceStore.save(preferences, place)
        selected = place.location()
        query = ""
        results = emptyList()
        error = null
    }

    DisposableEffect(preferences) {
        val listener = android.content.SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
            selected = SolarPlaceStore.readSelected(preferences)
            automatic = SolarPlaceStore.readAutomatic(preferences)
        }
        preferences.registerOnSharedPreferenceChangeListener(listener)
        onDispose { preferences.unregisterOnSharedPreferenceChangeListener(listener) }
    }
    LaunchedEffect(language, preferences) {
        val localized = runCatching {
            withContext(Dispatchers.IO) { SolarPlaceStore.localizeSelected(preferences, language) }
        }.getOrNull()
        if (localized != null) selected = localized
    }
    LaunchedEffect(query, language) {
        val term = query.trim()
        results = emptyList()
        error = null
        loading = false
        if (term.length < 2) return@LaunchedEffect
        delay(300)
        loading = true
        try {
            results = withContext(Dispatchers.IO) { SolarPlaceStore.search(term, language) }
            if (results.isEmpty()) error = copy("Город не найден. Уточните название.",
                "No places found. Try a different name.")
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            error = copy("Не удалось найти город. Проверьте подключение.",
                "Could not search places. Check your connection.")
        } finally {
            loading = false
        }
    }

    SettingsSection("☀", copy("Место для восхода и заката", "Sunrise and sunset location"),
        copy("Выберите город для точного времени по его часовому поясу.",
            "Choose a city for accurate times in its local time zone."),
        MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.testTag("solar-place-settings")) {
        if (selected != null) {
            Card(Modifier.fillMaxWidth(), shape = AffairsLayout.shape,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                Row(Modifier.fillMaxWidth().padding(14.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(copy("Выбранный город", "Selected city"),
                            style = MaterialTheme.typography.labelMedium)
                        UntranslatedText(selected?.placeName.orEmpty(),
                            style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        UntranslatedText(selected?.timeZoneId.orEmpty(),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    TextButton(onClick = {
                        SolarPlaceStore.clear(preferences)
                        selected = null
                        query = ""
                        if (SolarPlaceStore.needsAutomaticRefresh(preferences)) scope.launch {
                            withContext(Dispatchers.IO) { SolarPlaceStore.refreshAutomatic(preferences) }
                        }
                    }, modifier = Modifier.testTag("solar-place-clear")) {
                        Text(copy("Сбросить", "Clear"))
                    }
                }
            }
        } else {
            Text(automatic?.placeName?.let { "≈ $it · ${automatic?.timeZoneId.orEmpty()}" }
                ?: copy("Город не выбран · время с символом ≈ приблизительно",
                    "No city selected · times marked ≈ are approximate"),
                style = MaterialTheme.typography.bodyMedium)
        }

        OutlinedTextField(value = query, onValueChange = { query = it },
            label = { Text(copy("Найти город", "Find a city")) },
            placeholder = { Text(copy("Начните вводить название города",
                "Start typing a city name")) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().bringIntoViewRequester(cityIntoView)
                .focusRequester(cityFocus).testTag("solar-place-query"))
        Text(copy("Введите минимум 2 буквы на своём языке или на английском и выберите город из подсказок.",
            "Type at least 2 letters in your language or English, then choose a suggestion."),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall)
        if (loading) WorkspaceLoadingLine(Modifier.fillMaxWidth().testTag("solar-place-loading"))
        error?.let { Text(it, color = MaterialTheme.colorScheme.error,
            modifier = Modifier.testTag("solar-place-error")) }
        if (results.isNotEmpty()) {
            Card(Modifier.fillMaxWidth().testTag("solar-place-suggestions"),
                shape = AffairsLayout.shape,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                results.forEachIndexed { index, place ->
                    if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Column(Modifier.fillMaxWidth().clickable { choose(place) }
                        .testTag("solar-place-option-${place.id ?: index}")
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        UntranslatedText(place.name,
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.SemiBold)
                        UntranslatedText(
                            listOf(place.region, place.country).filter(String::isNotBlank)
                                .distinct().joinToString(", "),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}
