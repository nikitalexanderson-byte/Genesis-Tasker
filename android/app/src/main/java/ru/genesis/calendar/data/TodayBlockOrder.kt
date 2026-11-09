package ru.genesis.calendar.data

/** The day header is deliberately absent: it can never become a move target. */
val defaultTodayBlockOrder = listOf("tasks", "habits", "rhythm", "advice", "dream", "ad", "details")

fun normalizeTodayBlockOrder(saved: String): List<String> =
    (saved.split(',').filter { it in defaultTodayBlockOrder }.distinct() + defaultTodayBlockOrder).distinct()

fun moveTodayBlock(order: List<String>, source: String, target: String): List<String> {
    val normalized = normalizeTodayBlockOrder(order.joinToString(","))
    if (source !in normalized || target !in normalized || source == target) return normalized
    val destination = normalized.indexOf(target)
    return normalized.toMutableList().apply { remove(source); add(destination, source) }
}
