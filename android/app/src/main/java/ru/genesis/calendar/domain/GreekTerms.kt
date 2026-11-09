package ru.genesis.calendar.domain

/** Localize authored glossary words; individual alphabet symbols stay Greek. */
internal fun formatGreekTerms(text: String, language: String): String {
    if (language == "el") return text
    val alphabet = "αβγδεζηθικλμνξοπρστυφχψως"
    val latin = listOf("a","b","g","d","e","z","e","th","i","k","l","m","n","x","o","p","r","s","t","y","ph","ch","ps","o","s")
    val cyrillic = listOf("а","б","г","д","е","з","е","т","и","к","л","м","н","кс","о","п","р","с","т","и","ф","х","пс","о","с")
    val letters = if (language in setOf("ru", "uk", "sr")) cyrillic else latin
    return Regex("\\p{sc=Greek}[\\p{sc=Greek}\\p{M}]+").replace(text) { match ->
        val plain = java.text.Normalizer.normalize(match.value, java.text.Normalizer.Form.NFD).replace(Regex("\\p{M}"), "")
        val converted = plain.lowercase(java.util.Locale.ROOT).map { char ->
            alphabet.indexOf(char).takeIf { it >= 0 }?.let { letters[it] } ?: char.toString()
        }.joinToString("")
        if (plain.first().isUpperCase()) converted.replaceFirstChar { it.uppercase() } else converted
    }
}
