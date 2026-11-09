package ru.genesis.calendar.auth

internal object DataImportCsv {
    fun headers(content: String, delimiter: String): List<String> {
        require(delimiter in setOf(",", ";", "\t")) { "DATA_CSV_INVALID" }
        val text = content.removePrefix("\uFEFF"); val values = mutableListOf<String>(); val cell = StringBuilder(); var quoted = false; var index = 0
        while (index < text.length) {
            val char = text[index++]
            when {
                char == '"' -> if (quoted && index < text.length && text[index] == '"') { cell.append('"'); index++ } else quoted = !quoted
                !quoted && char == delimiter[0] -> { values += cell.toString(); cell.setLength(0); require(values.size < 500) { "DATA_CSV_INVALID" } }
                !quoted && char in "\r\n" -> break
                else -> cell.append(char)
            }
            require(cell.length <= 200_000) { "DATA_CSV_INVALID" }
        }
        require(!quoted) { "DATA_CSV_INVALID" }; values += cell.toString(); return values
    }
    fun inferred(headers: List<String>, key: String): Int? = headers.indexOfFirst { it == key || it.endsWith("[$key]") }.takeIf { it >= 0 }
}
