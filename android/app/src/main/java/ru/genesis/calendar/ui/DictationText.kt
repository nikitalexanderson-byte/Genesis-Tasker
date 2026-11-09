package ru.genesis.calendar.ui

/** Join recognition chunks without changing words or inventing a sentence at every service pause. */
internal fun appendDictationText(existing: String, recognized: String): String {
    val phrase = recognized.trim()
    if (phrase.isEmpty()) return existing
    if (existing.isEmpty()) return phrase
    val previous = existing.last()
    val next = phrase.first()
    val noGapBefore = next in ",.;:!?%…)]}»”’、。，；：！？）」』】"
    if (noGapBefore) return existing.trimEnd(' ', '\t') + phrase
    val noGapAfter = previous in "([{«“‘「『【"
    fun isCjk(char: Char) = Character.UnicodeScript.of(char.code) in setOf(
        Character.UnicodeScript.HAN, Character.UnicodeScript.HIRAGANA,
        Character.UnicodeScript.KATAKANA, Character.UnicodeScript.HANGUL)
    val separator = if (previous.isWhitespace() || noGapBefore || noGapAfter ||
        isCjk(previous) && isCjk(next) || previous in "。！？、" && isCjk(next)) "" else " "
    return existing + separator + phrase
}

/** Only recorded final phrases have tickets; manual edits invalidate them before any asynchronous reply. */
internal class DictationPatches {
    internal data class Ticket(val id: Long)
    private data class Span(var start: Int, val original: String)
    private var sequence = 0L
    private val pending = mutableMapOf<Long, Span>()

    fun track(body: String, original: String): Ticket? {
        val phrase = original.trim()
        if (phrase.isEmpty() || !body.endsWith(phrase)) return null
        val ticket = Ticket(++sequence)
        pending[ticket.id] = Span(body.length - phrase.length, phrase)
        return ticket
    }

    fun contains(ticket: Ticket) = pending.containsKey(ticket.id)
    fun discard(ticket: Ticket) { pending.remove(ticket.id) }
    fun clear() { pending.clear() }

    fun apply(body: String, ticket: Ticket, corrected: String): String? {
        val span = pending.remove(ticket.id) ?: return null
        val end = span.start + span.original.length
        if (span.start < 0 || end > body.length || body.substring(span.start, end) != span.original) return null
        val delta = corrected.length - span.original.length
        if (body.length + delta > 30_000) return null
        pending.values.filter { it.start >= end }.forEach { it.start += delta }
        return body.replaceRange(span.start, end, corrected)
    }
}
