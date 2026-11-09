package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class CustomFieldDefinitionProtocolTest {
    @Test fun legacyArchivedOptionsSurviveCatalogAndOwnEditorWithoutAllowing201ActiveChoices() {
        val source = JSONObject(customDefinitions().first { it.getString("type") == "select" }.toString())
        val options = JSONArray((0..200).map { index -> JSONObject().put("id", "option-$index").put("title", "Legacy choice $index").put("archived", index == 0) })
        source.put("options", options)
        val space = source.getString("spaceId"); val project = source.getString("projectId")
        val parsed = CustomFieldProtocol.definitions(space, project, JSONArray().put(source)).single()
        assertEquals(201, parsed.getJSONArray("options").length()); assertTrue(parsed.getJSONArray("options").getJSONObject(0).getBoolean("archived"))
        val own = CustomFieldEditorProtocol.newEdit(space, project, parsed)
        assertEquals(201, CustomFieldEditorProtocol.edit(own).getJSONObject("draft").getJSONArray("options").length())
        options.getJSONObject(0).put("archived", false)
        assertThrows(Exception::class.java) { CustomFieldProtocol.definitions(space, project, JSONArray().put(source)) }
    }

    private val fields = customDefinitions()
    private val sample = fields.first { it.getString("type") == "number" }
    private val space = sample.getString("spaceId")
    private val project = sample.getString("projectId")
    private fun copy(value: JSONObject) = JSONObject(value.toString())
    private fun next() = copy(sample).apply { remove("revision"); remove("predecessorId") }
    private fun request() = next().apply { remove("spaceId"); put("expectedRevision", sample.getInt("revision")) }
    private fun preview() = JSONObject().put("field", next()).put("fingerprint", "a".repeat(64)).put("valueCount", 0)
        .put("replaceType", false).put("previousRevision", sample.getInt("revision")).put("preservesPreviousValues", true)

    @Test fun phpCatalogKeepsAllTypesAndArchivedDefinitionsWithoutTranslatingNames() {
        val raw = JSONObject().put("fields", JSONArray(fields))
        val parsed = CustomFieldDefinitionProtocol.catalog(space, project, raw, true).getJSONArray("fields")
        assertEquals(fields.size, parsed.length()); assertEquals(CustomFieldProtocol.types, PlanningLifecycle.rows(parsed).map { it.getString("type") }.toSet())
        parsed.getJSONObject(0).put("title", "Local change")
        assertNotEquals("Local change", raw.getJSONArray("fields").getJSONObject(0).getString("title"))
        assertThrows(IllegalArgumentException::class.java) { CustomFieldDefinitionProtocol.catalog(space, project, raw, false) }
    }
    @Test fun aForeignCatalogOrUntypedVisibilityCannotBeAdopted() {
        for (bad in listOf(copy(sample).put("spaceId", "other"), copy(sample).put("projectId", "other"), copy(sample).put("showList", "false"))) {
            assertThrows(IllegalArgumentException::class.java) { CustomFieldDefinitionProtocol.catalog(space, project, JSONObject().put("fields", JSONArray().put(bad)), true) }
        }
    }
    @Test fun historyCanKeepAnEarlierScopeAndMoreThanTwoHundredRevisions() {
        val versions = JSONArray((201 downTo 1).map { revision -> JSONObject().put("field", copy(sample).put("revision", revision)
            .put("projectId", if (revision == 201) project else "earlier-project")).put("createdAt", "2026-10-21T09:00:00Z") })
        val parsed = CustomFieldDefinitionProtocol.history(space, sample.getString("id"), JSONObject().put("versions", versions))
        assertEquals(201, parsed.getJSONArray("versions").length())
        assertEquals("earlier-project", parsed.getJSONArray("versions").getJSONObject(1).getJSONObject("field").getString("projectId"))
    }
    @Test fun historyCannotMixFieldsSpacesOrRepeatedRevisions() {
        val first = JSONObject().put("field", copy(sample).put("revision", 2)).put("createdAt", "2026-10-21T09:00:00Z")
        for (bad in listOf(copy(sample).put("id", "other"), copy(sample).put("spaceId", "other"), copy(sample).put("revision", 2))) {
            val raw = JSONObject().put("versions", JSONArray().put(first).put(JSONObject().put("field", bad).put("createdAt", "2026-10-21T09:00:00Z")))
            assertThrows(IllegalArgumentException::class.java) { CustomFieldDefinitionProtocol.history(space, sample.getString("id"), raw) }
        }
    }
    @Test fun previewKeepsTheServersNormalizedNamesAndExplicitFalseWithoutChangingTheRequest() {
        val body = request().put("title", "  Own\nname  ").put("required", false).put("showList", false)
        val raw = preview().apply { getJSONObject("field").put("title", "Own name").put("required", false).put("showList", false) }
        val before = body.toString(); val parsed = CustomFieldDefinitionProtocol.preview(space, project, body, raw)
        assertEquals(before, body.toString()); assertEquals("Own name", parsed.getJSONObject("field").getString("title"))
        assertEquals(false, parsed.getJSONObject("field").get("showList")); assertEquals(0, parsed.getInt("valueCount"))
    }
    @Test fun incompatibleRevisionScopeAndTypeTransitionCannotBecomeAReview() {
        for (bad in listOf(preview().put("previousRevision", 0), preview().put("preservesPreviousValues", false),
            preview().put("replaceType", true), preview().put("fingerprint", "wrong"),
            preview().apply { getJSONObject("field").put("projectId", "other") }, preview().apply { getJSONObject("field").put("type", "text") })) {
            assertThrows(IllegalArgumentException::class.java) { CustomFieldDefinitionProtocol.preview(space, project, request(), bad) }
        }
        val transition = preview().put("replaceType", true).put("valueCount", 1)
        assertTrue(CustomFieldDefinitionProtocol.preview(space, project, request(), transition).getBoolean("replaceType"))
    }
    @Test fun omittedChoicesCanReturnAsArchivedButCannotBeSilentlyReintroducedAsActive() {
        val source = copy(fields.first { it.getString("type") == "select" })
        val revision = source.getInt("revision"); source.remove("revision"); source.remove("predecessorId")
        source.put("options", JSONArray().put(JSONObject().put("id", "removed").put("title", "Старый выбор").put("archived", true)))
        val body = copy(source).apply { remove("spaceId"); put("expectedRevision", revision); put("options", JSONArray()) }
        val raw = preview().put("field", source).put("previousRevision", revision).put("valueCount", 1)
        assertTrue(CustomFieldDefinitionProtocol.preview(space, project, body, raw).getJSONObject("field").getJSONArray("options").getJSONObject(0).getBoolean("archived"))
        raw.getJSONObject("field").getJSONArray("options").getJSONObject(0).put("archived", false)
        assertThrows(IllegalArgumentException::class.java) { CustomFieldDefinitionProtocol.preview(space, project, body, raw) }
    }
}
