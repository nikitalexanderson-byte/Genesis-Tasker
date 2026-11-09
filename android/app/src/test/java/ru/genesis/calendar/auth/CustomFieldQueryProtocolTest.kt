package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class CustomFieldQueryProtocolTest {
    private val fields = customDefinitions()
    private fun field(type: String) = fields.first { it.getString("type") == type && !it.getBoolean("archived") }
    @Test fun theNativeRouteAllowsOnlyTheEncodedCustomSortContract() {
        val path = "/shared/tasks?filter=%7B%7D&cursor=page%3D%3D&sort=custom%3Afield_1%3Adesc"
        assertTrue(allowedSharedRoute("GET", path))
        assertTrue(allowedSharedRoute("GET", "/shared/tasks?filter=%7B%7D&sort=custom%3Afield-1%3Aasc"))
        for (candidate in listOf(path + "&limit=1000", path.replace("desc", "DESC"), path.replace("field_1", "..%2Fsecret"), path.replace("custom%3A", "custom:"), path.replace("field_1", "")))
            assertFalse(candidate, allowedSharedRoute("GET", candidate))
        assertFalse(allowedSharedRoute("POST", path)); assertFalse(allowedSharedRoute("PUT", path))
    }
    @Test fun zeroFalseAndAbsenceHaveDifferentWirePredicates() {
        val zero = CustomFieldQueryProtocol.criterion(field("number"), "eq", "0,0")
        val no = CustomFieldQueryProtocol.criterion(field("checkbox"), "eq", false)
        assertEquals(0.0, zero.getDouble("value"), 0.0); assertEquals(false, no.get("value"))
        for (op in listOf("missing", "exists")) assertFalse(CustomFieldQueryProtocol.criterion(field("checkbox"), op, false).has("value"))
        assertThrows(IllegalArgumentException::class.java) { CustomFieldQueryProtocol.criterion(field("number"), "eq", null) }
        assertThrows(IllegalArgumentException::class.java) { CustomFieldQueryProtocol.criterion(field("checkbox"), "eq", "false") }
    }
    @Test fun operatorsMatchEveryServerTypeAndInvalidDatesOrLinksStayOutOfQueries() {
        assertTrue("contains" in CustomFieldQueryProtocol.operations("multi")); assertFalse("gt" in CustomFieldQueryProtocol.operations("select"))
        assertTrue("lte" in CustomFieldQueryProtocol.operations("date")); assertFalse("contains" in CustomFieldQueryProtocol.operations("number"))
        for ((type, op, value) in listOf(Triple("checkbox", "gt", true), Triple("date", "eq", "2026-02-30"), Triple("url", "eq", "javascript:alert(1)")))
            assertThrows(IllegalArgumentException::class.java) { CustomFieldQueryProtocol.criterion(field(type), op, value) }
    }
    @Test fun archivedChoicesCanBeSearchedWithoutChangingTaskWriteRules() {
        val selected = field("select")
        assertEquals("retired", CustomFieldQueryProtocol.criterion(selected, "eq", "retired").getString("value"))
        assertThrows(IllegalArgumentException::class.java) { CustomFieldProtocol.normalize(selected, "retired", null) }
        assertEquals("[\"first\",\"retired\"]", CustomFieldQueryProtocol.criterion(field("multi"), "contains", JSONArray().put("retired").put("first").put("first")).getJSONArray("value").toString())
    }
    @Test fun baseSearchAndScopeRemainIntactAndOversizedOrUnknownQueriesFail() {
        val base = JSONObject().put("projectIds", JSONArray().put("project")).put("q", "needle").put("priority", JSONArray().put(3))
        val rows = JSONArray().put(CustomFieldQueryProtocol.criterion(field("checkbox"), "eq", false))
        val result = CustomFieldQueryProtocol.filter(base, rows, fields)
        assertEquals("needle", result.getString("q")); assertEquals("project", result.getJSONArray("projectIds").getString(0)); assertFalse(base.has("customFields"))
        assertThrows(IllegalArgumentException::class.java) { CustomFieldQueryProtocol.filter(base, JSONArray().put(JSONObject().put("fieldId", "unknown").put("op", "missing")), fields) }
        val huge = JSONArray().put(CustomFieldQueryProtocol.criterion(field("text"), "eq", "Ж".repeat(4500)))
        assertThrows(IllegalArgumentException::class.java) { CustomFieldQueryProtocol.filter(base, huge, fields) }
        assertThrows(IllegalArgumentException::class.java) { CustomFieldQueryProtocol.criteria(JSONArray((1..21).map { rows.getJSONObject(0) }), fields) }
    }
    @Test fun onlySingleValuedAccessibleFieldsCanBeSorted() {
        val number = field("number").getString("id")
        assertEquals("custom:$number:desc", CustomFieldQueryProtocol.sort("custom:$number:desc", fields))
        for (wire in listOf("custom:${field("multi").getString("id")}:asc", "custom:unknown:desc", "custom:$number:DESC", "custom:$number:asc&limit=1"))
            assertThrows(IllegalArgumentException::class.java) { CustomFieldQueryProtocol.sort(wire, fields) }
    }
}
