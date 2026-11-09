package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class DataExportProtocolTest {
    private val space = "11111111-1111-4111-8111-111111111111"
    private val project = "22222222-2222-4222-8222-222222222222"
    private fun request() = JSONObject().put("scope", "tree").put("projectId", project).put("format", "json")
        .put("from", JSONObject.NULL).put("to", JSONObject.NULL).put("undated", true).put("archived", false)
        .put("calendarMode", "sacred").put("calendarContext", JSONObject().put("version", 2)
            .put("timeZone", "America/New_York").put("gregorianYearStart", "march"))
    private fun response(format: String = "json", content: String = "{\"future\":{\"opaque\":true},\"tasks\":[{\"storyPoints\":0,\"estimateHours\":null}]}") =
        JSONObject().put("format", format).put("content", content).put("projectCount", 3).put("taskCount", 131).put("notices", JSONArray())
    private fun rejected(action: () -> Unit) { assertTrue(runCatching(action).isFailure) }

    @Test fun selectionUsesItsOwnCalendarContextAndSupportsUnboundedDatesAndAllThreeScopes() {
        for (scope in listOf("project", "tree", "space")) for (mode in listOf("profane", "sacred", "lunar")) {
            val result = DataExportProtocol.command(space, request().put("scope", scope).put("calendarMode", mode))
            assertEquals(scope, result.getString("scope")); assertEquals(mode, result.getString("calendarMode"))
            assertTrue(result.isNull("from") && result.isNull("to")); assertTrue(result.getBoolean("undated"))
            assertEquals("America/New_York", result.getJSONObject("calendarContext").getString("timeZone"))
            assertEquals("march", result.getJSONObject("calendarContext").getString("gregorianYearStart"))
        }
        assertTrue(DataExportProtocol.command(space, request().put("scope", "space").put("projectId", JSONObject.NULL)).isNull("projectId"))
    }

    @Test fun fileBytesAndFullCountsAreKeptWithoutAOneHundredTaskPageLimitOrReserialization() {
        val raw = response(); val expected = raw.getString("content")
        val result = DataExportProtocol.snapshot("json", raw)
        assertEquals(131, result.getInt("taskCount")); assertEquals(3, result.getInt("projectCount"))
        assertEquals(expected, result.getString("content"))
        assertArrayEquals(expected.toByteArray(Charsets.UTF_8), result.getString("content").toByteArray(Charsets.UTF_8))
    }

    @Test fun csvKeepsBomQuotedUnicodeAndExactNewlines() {
        val csv = "\uFEFFНазвание,Описание\r\n\"Проверка\",\"строка 1\nстрока 2, \\\"цитата\\\"\"\r\n"
        assertEquals(csv, DataExportProtocol.snapshot("csv", response("csv", csv)).getString("content"))
    }

    @Test fun twentyMebibyteLimitCountsUtf8InsteadOfCharacters() {
        val exact = "я".repeat(DataExportProtocol.FILE_LIMIT / 2)
        assertTrue(DataExportProtocol.utf8Within(exact, DataExportProtocol.FILE_LIMIT))
        assertFalse(DataExportProtocol.utf8Within(exact + "!", DataExportProtocol.FILE_LIMIT))
        assertTrue(DataExportProtocol.utf8Within("🌙", 4)); assertFalse(DataExportProtocol.utf8Within("🌙", 3))
        assertFalse(DataExportProtocol.utf8Within("\uD800", 100)); assertFalse(DataExportProtocol.utf8Within("\uDC00", 100))
    }

    @Test fun unsafeDestinationsUnsupportedFormatsAndInvalidTypesDoNotBecomeNetworkCommands() {
        rejected { DataExportProtocol.command("$space/../other", request()) }
        rejected { DataExportProtocol.command(space, request().put("projectId", "other")) }
        rejected { DataExportProtocol.command(space, request().put("scope", "other")) }
        rejected { DataExportProtocol.command(space, request().put("format", "xml")) }
        rejected { DataExportProtocol.command(space, request().put("undated", "true")) }
        rejected { DataExportProtocol.command(space, request().put("unexpected", true)) }
        rejected { DataExportProtocol.command(space, request().apply { getJSONObject("calendarContext").put("timeZone", "Bad/Zone") }) }
    }

    @Test fun invalidAndReversedDatesRemainAnExplicitDateError() {
        for ((from, to) in listOf("2026-10-21" to "2026-10-19", "0000-01-01" to "2026-10-19", "2026-02-30" to "2026-10-19",
            "1899-12-31" to "2026-10-19", "2026-10-19" to "2101-01-01")) {
            val error = runCatching { DataExportProtocol.command(space, request().put("from", from).put("to", to)) }.exceptionOrNull()
            assertTrue(error is AuthApiError); assertEquals("DATA_DATE_INVALID", (error as AuthApiError).code)
        }
    }

    @Test fun explicitTimeZonesFollowTheServerUtcAndIanaContractBeforePicker() {
        for (zone in listOf("UTC", "Europe/Moscow", "America/New_York", "Etc/GMT-3", "America/Argentina/Buenos_Aires")) {
            assertNotNull(zone, DataExportProtocol.timeZone(zone))
            assertEquals(zone, DataExportProtocol.command(space, request().apply { getJSONObject("calendarContext").put("timeZone", zone) })
                .getJSONObject("calendarContext").getString("timeZone"))
        }
        for (zone in listOf("GMT", "Z", "+03:00", "UTC+03:00", "GMT+03:00", "CET", "Bad/Zone", " UTC", "Europe/Moscow ")) {
            assertNull(zone, DataExportProtocol.timeZone(zone))
            val error = runCatching { DataExportProtocol.command(space, request().apply { getJSONObject("calendarContext").put("timeZone", zone) }) }.exceptionOrNull()
            assertTrue(zone, error is AuthApiError)
            assertEquals("INVALID_CALENDAR_TIME_ZONE", (error as AuthApiError).code)
        }
    }

    @Test fun countsCannotBeCoercedFromStringsNegativeValuesOrFloatingPoint() {
        rejected { DataExportProtocol.snapshot("json", response().put("taskCount", "131")) }
        rejected { DataExportProtocol.snapshot("json", response().put("taskCount", -1)) }
        rejected { DataExportProtocol.snapshot("json", response().put("projectCount", 0)) }
        rejected { DataExportProtocol.snapshot("json", response().put("taskCount", 1.0)) }
        rejected { DataExportProtocol.snapshot("csv", response()) }
    }

    @Test fun preparationFreezesMutableContextAndLocalizedColumnNames() {
        val raw = request().put("titles", JSONObject().put("title", "Название").put("storyPoints", "Оценка"))
        val prepared = DataExportProtocol.command(space, raw)
        raw.getJSONObject("calendarContext").put("gregorianYearStart", "january")
        raw.getJSONObject("titles").put("title", "Changed")
        assertEquals("march", prepared.getJSONObject("calendarContext").getString("gregorianYearStart"))
        assertEquals("Название", prepared.getJSONObject("titles").getString("title"))
        rejected { DataExportProtocol.command(space, request().put("titles", JSONObject().put("privateColumn", "Hidden"))) }
    }

    @Test fun noticeCodesAreKeptWithoutIntroducingArbitraryDisplayPayload() {
        val raw = response().put("notices", JSONArray().put(JSONObject().put("code", "DATA_FUTURE_NOTICE").put("field", "task.reference").put("secret", "ignored")))
        val notices = DataExportProtocol.snapshot("json", raw).getJSONArray("notices")
        assertEquals("DATA_FUTURE_NOTICE", notices.getJSONObject(0).getString("code")); assertFalse(notices.getJSONObject(0).has("secret"))
        rejected { DataExportProtocol.snapshot("json", response().put("notices", JSONArray().put(JSONObject().put("code", "<html>").put("field", "")))) }
    }
}
