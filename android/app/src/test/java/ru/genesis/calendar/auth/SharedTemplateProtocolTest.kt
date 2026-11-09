package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

internal const val templateSpace = "10000000-0000-4000-8000-000000000001"
internal const val templateProject = "10000000-0000-4000-8000-000000000002"
internal const val templateId = "10000000-0000-4000-8000-000000000003"
internal fun templateFile(name: String) = requireNotNull(SharedTemplateProtocolTest::class.java.getResourceAsStream("/templates/$name.json")).bufferedReader().use { it.readText() }
internal fun templateRich() = JSONObject(templateFile("rich-manifest"))
internal fun templateStarters(language: String = "ru") = JSONObject(templateFile("starters")).getJSONArray(language)
internal fun templateSave(manifest: JSONObject = templateRich()): JSONObject = SharedTemplateProtocol.newEdit(templateSpace, templateProject, "template-save", null,
    JSONObject().put("projectId", templateProject).put("title", "Own portable content").put("manifest", manifest))
internal fun templateOptions() = JSONObject().put("spaceId", templateSpace).put("language", "ru").put("anchorDate", "2026-10-20")

class SharedTemplateProtocolTest {
    @Test fun archivedLegacyChoicesRemainPortableWithoutAllowingMoreActiveChoices() {
        val manifest = templateRich()
        val field = JSONObject().put("key", "legacy-extra").put("projectKey", manifest.getJSONArray("projects").getJSONObject(0).getString("key"))
            .put("title", "Legacy choices").put("type", "select").put("required", false).put("showCard", true).put("showList", true).put("position", 0)
            .put("options", JSONArray((0..200).map { index -> JSONObject().put("id", "legacy-$index").put("title", "Choice $index").put("archived", index == 0) }))
        manifest.getJSONArray("fields").put(field)
        val parsed = SharedTemplateManifest.validate(manifest)
        assertEquals(201, parsed.getJSONArray("fields").getJSONObject(parsed.getJSONArray("fields").length() - 1).getJSONArray("options").length())
        field.getJSONArray("options").getJSONObject(0).put("archived", false)
        assertThrows(Exception::class.java) { SharedTemplateManifest.validate(manifest) }
    }

    private fun rejected(block: () -> Unit) { assertTrue(runCatching(block).isFailure) }
    private fun summary(index: Int) = JSONObject(templateStarters().getJSONObject(0).toString()).put("id", UUID.nameUUIDFromBytes("template-$index".toByteArray()).toString())
        .put("system", false).put("canEdit", true).put("spaceId", templateSpace).put("projectId", templateProject).put("ownerId", "synthetic-owner")
    private fun page(from: Int, size: Int, total: Int, next: String?) = JSONObject().put("templates", JSONArray((from until from + size).map(::summary)))
        .put("systemTemplates", templateStarters()).put("total", total).put("hasMore", next != null).put("nextCursor", next ?: JSONObject.NULL)

    @Test fun allFiftySixRealPhpSourcesRoundTripAcrossEverySupportedLanguage() {
        val corpus = JSONObject(templateFile("starters"))
        assertEquals(SharedTemplateProtocol.languages, corpus.keys().asSequence().toSet())
        for (language in SharedTemplateProtocol.languages) {
            val sources = corpus.getJSONArray(language)
            assertEquals(4, sources.length())
            for (index in 0 until sources.length()) {
                val raw = sources.getJSONObject(index)
                val source = SharedTemplateProtocol.source(templateSpace, raw.getString("id"), raw)
                assertEquals(PlanningLifecycle.canonical(raw), PlanningLifecycle.canonical(source))
                assertEquals(3, source.getInt("taskCount")); assertFalse(source.getBoolean("canEdit"))
            }
        }
    }

    @Test fun normalizedPhpGraphPreservesAllSevenTypesArchivedOptionsAndIndependentZeroNullEstimates() {
        val raw = templateRich(); val validated = SharedTemplateManifest.validate(raw)
        assertEquals(PlanningLifecycle.canonical(raw), PlanningLifecycle.canonical(validated))
        val tasks = validated.getJSONArray("tasks"); val parent = tasks.getJSONObject(0)
        assertEquals(0, parent.getInt("storyPoints")); assertEquals(1.25, parent.getDouble("estimateHours"), 0.0)
        assertTrue(tasks.getJSONObject(1).isNull("storyPoints")); assertEquals(0, tasks.getJSONObject(1).getInt("estimateHours"))
        assertEquals(false, parent.getJSONObject("customValues").get("field:checkbox"))
        val fields = SharedTemplateManifest.rows(validated.getJSONArray("fields"), 200)
        assertEquals(CustomFieldProtocol.types, fields.map { it.getString("type") }.toSet())
        fields.filter { it.getString("type") in setOf("select", "multi") }.forEach { field ->
            val value = parent.getJSONObject("customValues").get(field.getString("key"))
            val input = SharedTemplateManifest.optionValue(field, value, true)
            val back = SharedTemplateManifest.optionValue(field, input, false)
            assertEquals(value.toString(), back.toString())
            assertEquals(2, SharedTemplateManifest.fieldAdapter(field).getJSONArray("options").length())
        }
    }

    @Test fun graphValidationRejectsCyclesBrokenLinksCrossProjectParentsAndMissingDoneStatus() {
        val cycle = templateRich(); cycle.getJSONArray("tasks").getJSONObject(2).put("dependsOnKeys", JSONArray().put("task:parent"))
        assertEquals("TASK_RELATION_CYCLE", assertThrows(IllegalArgumentException::class.java) { SharedTemplateManifest.validate(cycle) }.message)
        val wrong = templateRich(); wrong.getJSONArray("tasks").getJSONObject(3).put("parentKey", "task:parent")
        rejected { SharedTemplateManifest.validate(wrong) }
        val link = templateRich(); link.getJSONArray("tasks").getJSONObject(0).getJSONArray("checklists").getJSONObject(0).getJSONArray("items").getJSONObject(0).put("linkedTaskKey", "missing")
        rejected { SharedTemplateManifest.validate(link) }
        val status = templateRich(); status.getJSONArray("projects").getJSONObject(0).getJSONArray("statuses").getJSONObject(1).put("isDone", false)
        rejected { SharedTemplateManifest.validate(status) }
    }

    @Test fun draftsKeepIncompleteInputButACommandRequiresCompleteValidContentAndPreciseEstimates() {
        val draft = templateSave(); draft.getJSONObject("request").getJSONObject("manifest").getJSONArray("tasks").getJSONObject(0).put("title", "")
        SharedTemplateProtocol.edit(draft)
        rejected { SharedTemplateProtocol.command(draft, UUID.randomUUID().toString()) }
        val valid = templateSave(); val inputs = valid.getJSONObject("inputs")
        inputs.put("estimate/task:parent/storyPoints", "0").put("estimate/task:parent/estimateHours", "1,25").put("estimate/task:child/estimateHours", "")
        val request = SharedTemplateProtocol.command(valid, UUID.randomUUID().toString()).getJSONObject("body").getJSONObject("request")
        val tasks = request.getJSONObject("manifest").getJSONArray("tasks")
        assertEquals(0.0, tasks.getJSONObject(0).getDouble("storyPoints"), 0.0); assertEquals(1.25, tasks.getJSONObject(0).getDouble("estimateHours"), 0.0)
        assertTrue(tasks.getJSONObject(1).isNull("estimateHours"))
        inputs.put("estimate/task:parent/estimateHours", "1,234"); SharedTemplateProtocol.edit(valid)
        rejected { SharedTemplateProtocol.command(valid, UUID.randomUUID().toString()) }
        assertEquals("1,234", valid.getJSONObject("inputs").getString("estimate/task:parent/estimateHours"))
        val missing = templateSave(); missing.getJSONObject("request").remove("manifest"); missing.getJSONObject("request").put("cloneTemplateId", "system:publication")
        assertEquals("TEMPLATE_MANIFEST_REQUIRED", assertThrows(IllegalArgumentException::class.java) { SharedTemplateProtocol.command(missing, UUID.randomUUID().toString()) }.message)
    }

    @Test fun portableContentRejectsPrivateOrExecutableFieldsAndInvalidTimePairs() {
        for (key in listOf("permissions", "files", "comments", "automations", "notificationJobs")) {
            rejected { SharedTemplateManifest.validate(templateRich().put(key, JSONArray())) }
        }
        val broken = templateRich(); broken.getJSONArray("tasks").getJSONObject(0).put("endTime", JSONObject.NULL)
        rejected { SharedTemplateManifest.validate(broken) }
        for (value in listOf(-1, 1000001, 0.001, "0", true, Double.POSITIVE_INFINITY)) rejected { SharedTemplateManifest.estimate(value) }
        val label = templateRich(); label.getJSONArray("projects").getJSONObject(0).put("title", "🌿".repeat(160))
        SharedTemplateManifest.validate(label)
        label.getJSONArray("projects").getJSONObject(0).put("title", "🌿".repeat(161)); rejected { SharedTemplateManifest.validate(label) }
    }

    @Test fun typedFieldAndRelativeDateInputStayRecoverableUntilTheirFinalCommandIsValidated() {
        val draft = templateSave(); val task = draft.getJSONObject("request").getJSONObject("manifest").getJSONArray("tasks").getJSONObject(0)
        task.getJSONObject("customValues").put("field:number", "0,0")
        draft.getJSONObject("inputs").put("offset/task:parent/due/amount", "-2")
            .put("checklistOffset/task:parent/list:first/item:first/amount", "3")
        val frozen = SharedTemplateProtocol.command(draft, UUID.randomUUID().toString()).getJSONObject("body").getJSONObject("request").getJSONObject("manifest").getJSONArray("tasks").getJSONObject(0)
        assertEquals(0.0, frozen.getJSONObject("customValues").getDouble("field:number"), 0.0)
        assertEquals(-2, frozen.getJSONObject("due").getInt("amount"))
        assertEquals(3, frozen.getJSONArray("checklists").getJSONObject(0).getJSONArray("items").getJSONObject(0).getJSONObject("due").getInt("amount"))
        assertEquals("0,0", task.getJSONObject("customValues").getString("field:number"))
        draft.getJSONObject("inputs").put("offset/task:parent/due/amount", "-"); SharedTemplateProtocol.edit(draft)
        rejected { SharedTemplateProtocol.command(draft, UUID.randomUUID().toString()) }
        assertEquals("-", draft.getJSONObject("inputs").getString("offset/task:parent/due/amount"))
    }

    @Test fun libraryPaginationIsCompleteBeyondFiveHundredAndRejectsChangedOrRepeatedPages() {
        var library = SharedTemplateProtocol.library(templateSpace, page(0, 50, 501, "cursor-50"))
        for (from in 50 until 500 step 50) library = SharedTemplateProtocol.library(templateSpace, page(from, 50, 501, "cursor-${from + 50}"), library, "cursor-$from")
        val complete = SharedTemplateProtocol.library(templateSpace, page(500, 1, 501, null), library, "cursor-500")
        assertEquals(501, complete.getJSONArray("templates").length()); assertFalse(complete.getBoolean("hasMore"))
        rejected { SharedTemplateProtocol.library(templateSpace, page(500, 1, 502, null), library, "cursor-500") }
        rejected { SharedTemplateProtocol.library(templateSpace, page(499, 1, 501, null), library, "cursor-500") }
        rejected { SharedTemplateProtocol.library(templateSpace, page(500, 1, 501, "cursor-500"), library, "cursor-500") }
        rejected { SharedTemplateProtocol.library("10000000-0000-4000-8000-000000000099", page(500, 1, 501, null), library, "cursor-500") }
    }

    @Test fun applyOptionsNormalizePhpEmptyDictionariesButKeepFlagsAndRejectWrongTypes() {
        val options = templateOptions().put("include", JSONArray()).put("fieldMap", JSONArray())
        val normalized = SharedTemplateProtocol.options(options)
        assertEquals(SharedTemplateProtocol.transfer.size, normalized.getJSONObject("include").length())
        assertTrue(normalized.getJSONObject("include").getBoolean("dates")); assertEquals(0, normalized.getJSONObject("fieldMap").length())
        options.put("include", JSONObject().put("dates", false)); assertFalse(SharedTemplateProtocol.options(options).getJSONObject("include").getBoolean("dates"))
        rejected { SharedTemplateProtocol.options(templateOptions().put("include", JSONObject().put("dates", "false"))) }
        rejected { SharedTemplateProtocol.options(templateOptions().put("fieldMap", JSONArray().put("invalid"))) }
        rejected { SharedTemplateProtocol.options(templateOptions().put("anchorDate", "2026-02-30")) }
        rejected { SharedTemplateProtocol.options(templateOptions().put("language", "unknown")) }
        val reference = "new:" + "p".repeat(100) + ":" + "f".repeat(100)
        val largeReference = templateOptions().put("fieldValues", JSONObject().put("task", JSONObject().put(reference, 0)))
        assertEquals(0, SharedTemplateProtocol.options(largeReference).getJSONObject("fieldValues").getJSONObject("task").getInt(reference))
    }

    @Test fun nativeRouteAllowlistUsesEncodedSystemIdsExactMethodsAndLanguageWhitelist() {
        for (language in SharedTemplateProtocol.languages) for (id in SharedTemplateProtocol.starters) {
            val encoded = id.replace(":", "%3A")
            assertTrue(allowedSharedRoute("GET", "/shared/templates/$encoded?language=$language&deleted=false"))
            assertTrue(allowedSharedRoute("POST", "/shared/templates/$encoded/preview"))
            assertTrue(allowedSharedRoute("POST", "/shared/templates/$encoded/apply"))
            assertFalse(allowedSharedRoute("PATCH", "/shared/templates/$encoded/apply"))
        }
        assertTrue(allowedSharedRoute("GET", "/shared/spaces/$templateSpace/templates?language=ru&deleted=true&cursor=opaque%2Btoken"))
        assertTrue(allowedSharedRoute("PATCH", "/shared/spaces/$templateSpace/templates/$templateId"))
        for (path in listOf("/shared/templates/system%3Aunknown/apply", "/shared/templates/system:launch/apply", "/shared/templates/system%253Alaunch/apply", "/shared/templates/$templateId?language=xx&deleted=false", "/shared/templates/$templateId/apply?extra=1")) assertFalse(path, allowedSharedRoute("POST", path))
    }

    @Test fun previewOverridesNormalizeDecimalInputAndRequiredDestinationFieldsWhenSourceCopyIsDisabled() {
        val fieldId = "40000000-0000-4000-8000-000000000001"
        val field = JSONObject(templateRich().getJSONArray("fields").getJSONObject(1).toString()).put("id", fieldId).put("type", "number")
        val task = templateRich().getJSONArray("tasks").getJSONObject(0)
        val catalog = JSONObject().put("tasks", JSONArray().put(task)).put("fields", JSONArray().put(field)).put("newFields", JSONArray())
        val input = templateOptions().put("include", JSONObject().put("customFields", false))
            .put("fieldValues", JSONObject().put(task.getString("key"), JSONObject().put(fieldId, "0,0")))
        val normalized = SharedTemplateProtocol.fieldInputs(input, catalog)
        assertEquals(0.0, normalized.getJSONObject("fieldValues").getJSONObject(task.getString("key")).getDouble(fieldId), 0.0)
        assertEquals("0,0", input.getJSONObject("fieldValues").getJSONObject(task.getString("key")).getString(fieldId))
        input.getJSONObject("fieldValues").getJSONObject(task.getString("key")).put(fieldId, "-")
        rejected { SharedTemplateProtocol.fieldInputs(input, catalog) }
        input.getJSONObject("fieldValues").getJSONObject(task.getString("key")).put("unavailable", 1)
        rejected { SharedTemplateProtocol.fieldInputs(input, catalog) }
    }
}
