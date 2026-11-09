package ru.genesis.calendar.ui

import java.time.LocalTime
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject

class AppearanceSettingsTest {
    @Test fun manualAccountThemeUpdatesNativeButAutomaticModesKeepTheirSchedule() {
        val raw=JSONObject().put("nativeAppearance",AppearanceSettings("light").json()).toString()
        assertEquals("evening",AppearanceSettings.read(raw,"standart-dark").mode)
        assertEquals("light",AppearanceSettings.read(raw,"standart").mode)
        assertEquals("evening",AppearanceSettings.read("{}","experimental-dark").mode)
        for(mode in listOf("scheduled","system")) {
            val automatic=AppearanceSettings(mode,"08:30","20:30")
            val stored=JSONObject().put("nativeAppearance",automatic.json()).toString()
            assertEquals(automatic,AppearanceSettings.read(stored,"standart-dark"))
            assertEquals(automatic,AppearanceSettings.read(stored,"standart"))
        }
    }
    @Test fun eveningScheduleCrossesMidnightAndUsesExactBoundaries() {
        val settings=AppearanceSettings("scheduled","07:00","21:00")
        assertFalse(settings.isEvening(LocalTime.of(20,59),false))
        assertTrue(settings.isEvening(LocalTime.of(21,0),false))
        assertTrue(settings.isEvening(LocalTime.of(6,59),false))
        assertFalse(settings.isEvening(LocalTime.of(7,0),false))
    }
    @Test fun daytimeDarkScheduleAndDeviceThemeHaveIndependentRules() {
        val settings=AppearanceSettings("scheduled","18:00","08:00")
        assertTrue(settings.isEvening(LocalTime.NOON,false))
        assertFalse(settings.isEvening(LocalTime.of(19,0),true))
        assertTrue(settings.copy(mode="system").isEvening(LocalTime.NOON,true))
        assertFalse(settings.copy(mode="light").isEvening(LocalTime.MIDNIGHT,true))
        assertTrue(settings.copy(mode="evening").isEvening(LocalTime.NOON,false))
    }
    @Test fun legacyAndMalformedCloudSettingsKeepUsableDefaults() {
        assertEquals(AppearanceSettings(),AppearanceSettings.read("{}"))
        val invalid=JSONObject().put("nativeAppearance",JSONObject().put("mode","unknown")
            .put("lightAt","25:00").put("darkAt","07:00"))
        val result=AppearanceSettings.read(invalid.toString())
        assertEquals("scheduled",result.mode)
        assertNotEquals(result.lightAt,result.darkAt)
    }
}
