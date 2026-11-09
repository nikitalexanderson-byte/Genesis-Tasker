package ru.genesis.calendar.ui

import java.text.Normalizer

internal data class PhilosopherQuoteParts(val context: String, val quote: String, val author: String)

/** Also formats old offline snapshots without rewriting the quotation or its stable ID. */
internal fun philosopherQuoteParts(body: String, author: String): PhilosopherQuoteParts {
    fun signature(value: String) = Normalizer.normalize(value, Normalizer.Form.NFKC).trim()
        .removeSurrounding("(", ")").trim().removeSuffix(".").removeSuffix("。").replace(Regex("\\s+"), " ")
    val lines = body.trim().lines().toMutableList()
    val credit = author.trim()
    if (credit.isNotBlank() && lines.size > 1 && signature(lines.last()).equals(signature(credit), ignoreCase = true)) lines.removeAt(lines.lastIndex)
    var quote = lines.joinToString("\n").trim()
    var context = ""
    val opening = quote.firstOrNull()
    val closing = when (opening) { '(' -> ')'; '（' -> '）'; else -> null }
    if (closing != null) {
        var depth = 0
        for (index in quote.indices) {
            if (quote[index] == opening) depth++
            else if (quote[index] == closing && --depth == 0) {
                context = quote.substring(1, index).replace(Regex("[()（）]"), "").trim()
                quote = quote.substring(index + 1).trim()
                break
            }
        }
    }
    return PhilosopherQuoteParts(context, quote, credit)
}
