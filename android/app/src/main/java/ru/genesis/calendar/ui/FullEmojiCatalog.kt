package ru.genesis.calendar.ui

import android.content.Context
import org.json.JSONArray

internal data class FullEmojiCategory(val id: String, val label: String,
    val labelEn: String, val emojis: List<String>, val variants: Map<String,List<String>> = emptyMap())

internal fun emojiVariantKey(value: String): String = buildString {
    value.codePoints().forEach { if(it !in 0x1f3fb..0x1f3ff && it != 0xfe0f) appendCodePoint(it) }
}
internal fun groupEmojiVariants(values: List<String>): List<Pair<String,List<String>>> {
    return values.groupBy(::emojiVariantKey).values.map { group ->
        val neutral=group.firstOrNull { emoji -> emoji.codePoints().noneMatch { it in 0x1f3fb..0x1f3ff } }
            ?: buildString { group.first().codePoints().forEach { if(it !in 0x1f3fb..0x1f3ff)appendCodePoint(it) } }
        neutral to (listOf(neutral)+group).distinct()
    }
}

internal fun fullEmojiCatalog(context: Context): List<FullEmojiCategory> {
    val raw = context.assets.open("originals/i18n/emoji-full-catalog.json")
        .bufferedReader().use { it.readText() }
    val rows = JSONArray(raw)
    return (0 until rows.length()).map { index ->
        val row = rows.getJSONObject(index)
        val emojis = row.getJSONArray("emojis")
        val groups=groupEmojiVariants((0 until emojis.length()).map(emojis::getString))
        FullEmojiCategory(row.getString("id"), row.getString("label"), row.getString("labelEn"),
            groups.map { it.first }, groups.associate { emojiVariantKey(it.first) to it.second })
    }
}
