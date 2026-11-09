package ru.genesis.calendar.ui

import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.SharedBulkProtocol
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

internal fun bulkHistoryTimestamp(value: String, language: String, zone: ZoneId): String {
    val at = Instant.parse(value).atZone(zone)
    val date = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
        .withLocale(Locale.forLanguageTag(language)).format(at)
    val offset = if (at.offset.id == "Z") "UTC" else "UTC${at.offset.id}"
    return "$date · ${zone.id} ($offset)"
}

internal typealias SharedBulkForm = ru.genesis.calendar.auth.SharedBulkFormData
