package ru.genesis.calendar.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.WorkspacePatch

class PrivatePersonalDocumentsTest {
    private fun minimal()=JSONObject().put("projects",JSONArray()).put("categories",JSONArray()).put("taskListLinks",JSONArray()).put("taskLists",JSONArray()).put("tasks",JSONArray())
    @Test fun neverCreatedHabitFamilyProjectsThroughTheRealDomainCodecWithoutChangingItsSource(){
        val source=minimal();val before=source.toString()
        val decoded=HabitDocument.decode(PrivatePersonalDocuments.fragment(source,"habits"),7)
        assertTrue(decoded.habits.isEmpty());assertTrue(decoded.completions.isEmpty())
        assertEquals(before,source.toString());assertFalse(source.has("habits"))
    }
    @Test fun absentTrackerFamilyHasAllDeclaredEmptyCollections(){
        val source=minimal();val raw=JSONObject(PrivatePersonalDocuments.fragment(source,"trackers"))
        for(name in listOf("sleepPlans","sleepEntries","moodEntries","addictionTrackers","addictionEntries"))assertEquals(0,raw.getJSONArray(name).length())
        assertFalse(source.has("sleepEntries"))
    }
    @Test fun actualHabitProgressAndUnknownContentAreRetainedByTheProjection(){
        val source=WorkspacePatch.emptyDocument().put("privateExtra",JSONObject().put("retained","private source"))
        source.getJSONArray("habits").put(JSONObject().put("id","existing-habit").put("title","Retained habit"))
        source.getJSONObject("userProgress").put("lifetimeXp",73)
        val before=source.toString();val view=PrivatePersonalDocuments.projection(source)
        val habits=JSONObject(PrivatePersonalDocuments.fragment(source,"habits"))
        assertEquals("existing-habit",habits.getJSONArray("habits").getJSONObject(0).getString("id"))
        assertEquals(73,habits.getJSONObject("progress").getInt("lifetimeXp"))
        view.getJSONObject("privateExtra").put("retained","changed projection")
        assertEquals(before,source.toString())
    }
    @Test fun malformedPresentHabitDataCannotBecomeAnEmptyFamily(){
        val source=minimal().put("habits","malformed-present-data")
        try{PrivatePersonalDocuments.fragment(source,"habits");fail("Malformed data replaced by defaults")}
        catch(expected:org.json.JSONException){}
        assertEquals("malformed-present-data",source.getString("habits"))
    }
}
