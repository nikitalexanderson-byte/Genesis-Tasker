package ru.genesis.calendar.data

import org.json.JSONObject
import ru.genesis.calendar.domain.CalendarContext
import java.time.ZoneId
import java.time.ZoneOffset

private fun calendarWireZone(zone: String) = if (ZoneId.of(zone).normalized() == ZoneOffset.UTC) "UTC" else zone

/** Missing fields retain legacy rules; only newly created rules opt in to V2. */
internal fun calendarContextFromJson(value: JSONObject?): CalendarContext? = value?.let {
    CalendarContext(it.getInt("version"), calendarWireZone(it.getString("timeZone")), it.optString("gregorianYearStart", "january"))
}

internal fun calendarContextJson(value: CalendarContext?): Any = value?.let {
    JSONObject().put("version", it.version).put("timeZone", calendarWireZone(it.timeZone)).put("gregorianYearStart", it.gregorianYearStart)
} ?: JSONObject.NULL
