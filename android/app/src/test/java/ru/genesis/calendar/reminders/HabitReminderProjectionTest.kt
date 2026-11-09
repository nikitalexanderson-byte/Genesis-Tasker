package ru.genesis.calendar.reminders

import java.io.File
import java.time.Instant
import java.time.ZoneId
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.CloudAccountImporter
import ru.genesis.calendar.data.HabitDocument

class HabitReminderProjectionTest {
    @Test fun webAndNativeUseTheSamePrivateProjectionAcrossZonesDstAndGoals() {
        val cases=JSONArray(File("../../tests/fixtures/habit-reminders-vectors.json").readText())
        for(index in 0 until cases.length()) {
            val item=cases.getJSONObject(index)
            val workspace=HabitDocument.decode(CloudAccountImporter.habitsDocument(item.getJSONObject("workspace")),0)
            val actual=habitReminderProjection(workspace,Instant.parse(item.getString("now")),ZoneId.of(item.getString("zone")),2)
            assertEquals(item.getString("id"),canonical(item.getJSONObject("plan")),canonical(actual))
            assertFalse(actual.toString().contains("PRIVATE"))
        }
    }
    private fun canonical(value: Any?): String=when(value) {
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(",","{","}"){ JSONObject.quote(it)+":"+canonical(value.get(it)) }
        is JSONArray -> (0 until value.length()).joinToString(",","[","]"){canonical(value.get(it))}
        is String -> JSONObject.quote(value)
        else -> value?.toString() ?: "null"
    }
}
