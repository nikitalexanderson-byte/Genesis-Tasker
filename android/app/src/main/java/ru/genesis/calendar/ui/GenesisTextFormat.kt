package ru.genesis.calendar.ui

/** Insert values only after translating the complete template. Values remain literal. */
internal fun formatGenesisTemplate(template: String, vararg values: Pair<String, Any>): String {
    val replacements=values.toMap()
    return Regex("\\{(\\w+)\\}").replace(template) { match ->
        replacements[match.groupValues[1]]?.toString() ?: match.value
    }
}
