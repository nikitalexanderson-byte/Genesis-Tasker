package ru.genesis.calendar.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Dialog

internal val habitColors = listOf(
    "#bb8f4a", "#2d7771", "#5271a8", "#8b5f83", "#9b5d4a", "#668b55", "#b06779",
    "#c7a84b", "#348c83", "#3d8fb0", "#3f5e98", "#7258a3", "#a65372", "#c8534f",
    "#cf713d", "#7e6a55", "#5f6f77", "#687271", "#294b4a", "#1f3c5a", "#2a2524",
)
private val habitEmojis = listOf("✨", "🎯", "💪", "🧠", "📚", "🧘", "🏃", "🌿", "💧", "🌙", "☀️", "🔥")
internal val habitRituals = listOf(
    "none" to "Без ритуала", "morning" to "Утро", "day" to "День",
    "evening" to "Вечер", "custom" to "Своя группа",
)

internal fun normalizedHabitColor(value: String): String? = value.trim().lowercase().takeIf {
    it.matches(Regex("#[0-9a-f]{6}"))
}
internal fun normalizedHabitEmoji(value: String): String? {
    val trimmed = value.trim()
    if (trimmed.isEmpty()) return null
    val segments = java.text.BreakIterator.getCharacterInstance(java.util.Locale.ROOT)
    segments.setText(trimmed)
    val end = segments.next()
    if (end == java.text.BreakIterator.DONE) return null
    val first = trimmed.substring(0,end)
    return first.takeIf { it.codePoints().anyMatch { codePoint ->
        Character.getType(codePoint) == Character.OTHER_SYMBOL.toInt()
    } }
}

@Composable
internal fun HabitPersonalizationFields(emoji: String, color: String, isKeyHabit: Boolean,
    ritualId: String, ritualName: String, enabled: Boolean,
    onEmoji: (String) -> Unit, onColor: (String) -> Unit, onKeyHabit: (Boolean) -> Unit,
    onRitual: (String) -> Unit, onRitualName: (String) -> Unit) {
    val context = LocalContext.current
    val emojiCategories = remember(context) { fullEmojiCatalog(context) }
    val english = LocalGenesisLanguage.current == "en"
    var emojiPickerOpen by rememberSaveable { mutableStateOf(false) }
    var emojiCategory by rememberSaveable { mutableStateOf("smileys-emotion") }
    var visibleEmojiCount by rememberSaveable { mutableIntStateOf(120) }
    var colorPickerOpen by rememberSaveable { mutableStateOf(false) }
    Text("Эмодзи привычки", style = MaterialTheme.typography.titleSmall)
    Row(Modifier.horizontalScroll(androidx.compose.foundation.rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        habitEmojis.forEach { option ->
            FullEmojiChoice(option,emoji,emojiCategories.firstNotNullOfOrNull { it.variants[emojiVariantKey(option)] }.orEmpty(),onEmoji,enabled=enabled)
        }
    }
    TextButton(onClick = { emojiPickerOpen = true }, enabled = enabled,
        modifier = Modifier.testTag("habit-emoji-picker-open")) {
        Text(if (english) "Choose from all emoji" else "Выбрать из полного набора эмодзи")
    }
    if (emojiPickerOpen) Dialog(onDismissRequest = { emojiPickerOpen = false }) {
        Surface(shape = MaterialTheme.shapes.large) {
            Column(Modifier.fillMaxWidth().heightIn(max = 560.dp).verticalScroll(
                androidx.compose.foundation.rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                EditorDialogHeader(if (english) "Habit emoji" else "Эмодзи привычки", "habit-emoji-close") { emojiPickerOpen = false }
                Row(Modifier.fillMaxWidth().horizontalScroll(androidx.compose.foundation.rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    emojiCategories.forEach { category -> FilterChip(emojiCategory == category.id,
                        onClick = { emojiCategory = category.id; visibleEmojiCount = 120 },
                        label = { Text(if (english) category.labelEn else category.label) }) }
                }
                emojiCategories.firstOrNull { it.id == emojiCategory }?.let { category ->
                    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        category.emojis.take(visibleEmojiCount).forEach { option ->
                            FullEmojiChoice(option,emoji,category.variants[emojiVariantKey(option)].orEmpty(),
                                { onEmoji(it); emojiPickerOpen=false }, Modifier.testTag("habit-emoji-choice-$option"), enabled)
                        }
                    }
                    if (visibleEmojiCount < category.emojis.size) TextButton(
                        onClick = { visibleEmojiCount += 120 },
                        modifier = Modifier.testTag("habit-emoji-more")) {
                        Text(if (english) "Show more emoji" else "Показать ещё эмодзи")
                    }
                }

            }
        }
    }
    OutlinedTextField(emoji, onEmoji, enabled = enabled, singleLine = true,
        isError = normalizedHabitEmoji(emoji) == null,
        label = { Text("Свой эмодзи") }, modifier = Modifier.fillMaxWidth().testTag("habit-emoji"))
    Text("Цвет привычки", style = MaterialTheme.typography.titleSmall)
    Row(Modifier.horizontalScroll(androidx.compose.foundation.rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        habitColors.forEach { option ->
            val selected = color.equals(option, ignoreCase = true)
            val swatch=Color(android.graphics.Color.parseColor(option))
            Box(Modifier.size(48.dp)
                .clickable(enabled = enabled) { onColor(option) }
                .genesisDescription("${genesisTranslate("Цвет")} $option").semantics { this.selected = selected }
                .testTag("habit-color-$option"), contentAlignment=Alignment.Center) {
                androidx.compose.material3.Surface(Modifier.size(if (selected) 38.dp else 32.dp), shape=CircleShape, color=swatch,
                    border=selectedControlBorder(selected,enabled,background=swatch)) {}
            }
        }
    }
    Surface(onClick = { colorPickerOpen = true }, enabled = enabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("habit-custom-color"),
        shape = AffairsLayout.controlShape, border = androidx.compose.foundation.BorderStroke(
            1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CompositionLocalProvider(LocalPreserveCalendarColors provides true) {
                androidx.compose.material3.Surface(Modifier.size(32.dp), shape = AffairsLayout.controlShape,
                    color = Color(android.graphics.Color.parseColor(normalizedHabitColor(color) ?: habitColors.first()))) {}
            }
            Text("Свой цвет", Modifier.weight(1f))
            GenesisLucideIcon("palette")
        }
    }
    if (colorPickerOpen) GenesisColorPicker("Цвет привычки", normalizedHabitColor(color) ?: habitColors.first(),
        onDismiss = { colorPickerOpen = false },
        onColor = { chosen -> chosen?.let(onColor); colorPickerOpen = false },
        allowThemeColor = false, previewLabel = "Привычка", tagPrefix = "habit")
    Row(verticalAlignment = Alignment.CenterVertically) {
        Switch(isKeyHabit, onKeyHabit, enabled = enabled, modifier = Modifier.testTag("habit-key-role"))
        Text("Главная привычка", Modifier.padding(start = 8.dp))
    }
    Text("В фокусе может быть только одна привычка. Дополнительный XP не начисляется.",
        style = MaterialTheme.typography.bodySmall)
    Text("Ритуал", style = MaterialTheme.typography.titleSmall)
    Row(Modifier.horizontalScroll(androidx.compose.foundation.rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        habitRituals.forEach { (id, title) ->
            FilterChip(selected = ritualId == id, onClick = { onRitual(id) }, enabled = enabled,
                label = { Text(title) }, modifier = Modifier.testTag("habit-ritual-$id"))
        }
    }
    if (ritualId == "custom") OutlinedTextField(ritualName, onRitualName, enabled = enabled,
        singleLine = true, label = { Text("Название группы") },
        modifier = Modifier.fillMaxWidth().testTag("habit-ritual-name"))
}
