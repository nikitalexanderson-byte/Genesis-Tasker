package ru.genesis.calendar.auth

import org.json.JSONObject

/** Persisted theme intent uses the revision seen when the person selected it. */
internal object PreferencePatch {
    fun request(changes: Map<String, String>): JSONObject = JSONObject().apply {
        changes.forEach { (name, value) -> when (name) {
            "display" -> put("calendarMode", value)
            "input" -> put("taskCalendarMode", value)
            "time" -> put("timeFormat", value)
            "weekStart", "gregorianYearStart", "language" -> put(name, value)
            "stoicheionDivinationDisabled", "sharedProjectsEnabled" -> put(name, value.toBooleanStrict())
            "darkPalette" -> { require(value in setOf("green", "burgundy", "blue", "violet")); put(name, value) }
            "theme" -> {
                require(value in setOf("standart", "standart-dark"))
                put("theme", value)
                put("expectedThemeRevision", requireNotNull(changes["themeRevision"]?.toIntOrNull()).also { require(it >= 0) })
            }
            "themeRevision" -> require(changes.containsKey("theme"))
            else -> error("Unknown account preference")
        } }
    }
}
