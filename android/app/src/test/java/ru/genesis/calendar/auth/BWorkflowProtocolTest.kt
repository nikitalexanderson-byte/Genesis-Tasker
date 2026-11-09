package ru.genesis.calendar.auth

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class BWorkflowProtocolTest {
    @Test fun taskWatchAndChecklistConversionAcceptOnlyTheirScopedMethods() {
        val id="12345678-1234-1234-1234-123456789abc";val root="/shared/projects/$id/tasks/$id"
        for(method in listOf("GET","POST","PUT","PATCH","DELETE")) {
            assertEquals(method in setOf("GET","PUT"),allowedSharedRoute(method,"$root/watch"))
            assertEquals(method=="POST",allowedSharedRoute(method,"$root/convert-checklist"))
        }
        assertFalse(allowedSharedRoute("PUT","/shared/projects/invalid/tasks/$id/watch"))
        assertFalse(allowedSharedRoute("POST","$root/../convert-checklist"))
        assertFalse(allowedSharedRoute("PUT","$root/watch?other=project"))
    }
    private fun settings()=JSONObject("""{"types":{"assignment":true,"mentions":true},"channels":{"inbox":true,"push":false,"email":false},"quiet":{"enabled":false,"start":"22:00","end":"08:00"},"reminderDays":1,"timeZone":"Europe/Moscow"}""")
    @Test fun refreshPreservesTypedZeroFalseAndInvalidZoneAndLoadsTheOtherEditorsIndependentChoices() {
        val base=settings();val own=JSONObject(base.toString()).put("reminderDays",0).put("timeZone","Bad/typed-zone")
        own.getJSONObject("types").put("mentions",false);own.getJSONObject("quiet").put("start","23:00")
        val latest=JSONObject(base.toString());latest.getJSONObject("types").put("assignment",false);latest.getJSONObject("quiet").put("end","10:00")
        val source=own.toString();val rebased=rebaseNotificationSettings(base,own,latest)
        assertEquals(0,rebased.getInt("reminderDays"));assertEquals("Bad/typed-zone",rebased.getString("timeZone"))
        assertFalse(rebased.getJSONObject("types").getBoolean("mentions"));assertFalse(rebased.getJSONObject("types").getBoolean("assignment"))
        assertEquals("23:00",rebased.getJSONObject("quiet").getString("start"));assertEquals("10:00",rebased.getJSONObject("quiet").getString("end"))
        assertFalse(rebased.getJSONObject("channels").getBoolean("push"));assertFalse(rebased.getJSONObject("channels").getBoolean("email"))
        rebased.getJSONObject("quiet").put("start","01:00");assertEquals(source,own.toString())
    }
    @Test fun untouchedPreferencesFollowTheNewRevisionWithoutLosingNewEmailSettings() {
        val base=settings();val latest=JSONObject(base.toString()).put("emailTypes",JSONObject().put("messages",false))
        val refreshed=rebaseNotificationSettings(base,JSONObject(base.toString()),latest)
        assertEquals(latest.toString(),refreshed.toString());refreshed.getJSONObject("emailTypes").put("messages",true)
        assertFalse(latest.getJSONObject("emailTypes").getBoolean("messages"))
    }
}
