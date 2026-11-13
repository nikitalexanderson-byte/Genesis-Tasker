package ru.genesis.calendar.ui

import android.icu.text.TimeZoneNames
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

internal data class TimeZoneChoice(val id: String, val city: String, val offset: String) {
    fun matches(query: String): Boolean = query.trim().split(Regex("\\s+"))
        .all { token -> "$id $city $offset".contains(token, ignoreCase = true) }
}

/** System-localized city names, IANA identifiers and current UTC offsets are all searchable. */
internal fun timeZoneChoices(locale: Locale, now: Instant = Instant.now()): List<TimeZoneChoice> {
    val names = TimeZoneNames.getInstance(locale)
    return ZoneId.getAvailableZoneIds().map { id ->
        val offset = ZoneId.of(id).rules.getOffset(now).id.let { if (it == "Z") "+00:00" else it }
        TimeZoneChoice(id, names.getExemplarLocationName(id) ?: id.substringAfterLast('/').replace('_', ' '), "UTC$offset")
    }.sortedWith(compareBy({ it.city.lowercase(locale) }, { it.id }))
}

@Composable internal fun TimeZonePicker(value: String, enabled: Boolean, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    val locale = Locale.forLanguageTag(LocalGenesisLanguage.current)
    val choices = remember(locale) { timeZoneChoices(locale) }
    val selected = choices.firstOrNull { it.id == value }
    OutlinedButton({ query = ""; open = true }, enabled = enabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("abstinence-time-zone")) {
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.Start) {
            Text("Часовой пояс", style = MaterialTheme.typography.labelSmall)
            Text(selected?.let { "${it.city} · ${it.offset}" } ?: value, translate = false)
            Text(value, style = MaterialTheme.typography.bodySmall, translate = false)
        }
        GenesisLucideIcon("search")
    }
    if (open) Dialog(onDismissRequest = { open = false }) { GenesisModalFrame({ open = false }) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            EditorDialogHeader("Часовой пояс", "time-zone-close") { open = false }
            OutlinedTextField(query, { query = it.take(100) }, label = { Text("Поиск") }, singleLine = true,
                leadingIcon = { GenesisLucideIcon("search") }, modifier = Modifier.fillMaxWidth().testTag("time-zone-search"))
            val filtered = remember(choices, query, value) {
                choices.filter { it.matches(query) }.sortedBy { if (it.id == value) 0 else 1 }
            }
            LazyColumn(Modifier.fillMaxWidth().weight(1f, fill = false).heightIn(max = 440.dp).testTag("time-zone-results")) {
                items(filtered, key = { it.id }) { choice ->
                    TextButton({ onChange(choice.id); open = false },
                        Modifier.fillMaxWidth().heightIn(min = 64.dp).testTag("time-zone-${choice.id}")) {
                        Column(Modifier.weight(1f), horizontalAlignment = Alignment.Start) {
                            Text("${choice.city} · ${choice.offset}", translate = false)
                            Text(choice.id, style = MaterialTheme.typography.bodySmall, translate = false)
                        }
                        if (choice.id == value) GenesisLucideIcon("check")
                    }
                }
                if (filtered.isEmpty()) item { Text("Ничего не найдено", Modifier.padding(12.dp)) }
            }
        }
    } }
}
