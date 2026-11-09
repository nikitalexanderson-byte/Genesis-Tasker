package ru.genesis.calendar.data

import java.io.File
import java.time.LocalDate
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.domain.habits.*

class HabitBackupTest {
    private val at = "2026-10-19T10:00:00.000Z"
    private fun file() = javaClass.getResource("/habit-backup-web.json")!!.readText()
    private fun source() = HabitBackups.parse(file()).workspace()
    @Test fun webChecksumHtmlUnicodeFractionalValuesAndNativeExportArePortable() {
        val backup = HabitBackups.parse(file()); val source = backup.workspace()
        assertEquals(100125L, source.measurements.single().value)
        assertEquals("Моя вода </script> 💧", source.habits.first().title)
        val native = HabitBackups.create(source, at)
        assertEquals(source, HabitBackups.parse(native.text()).workspace())
        assertFalse(native.text().contains("never-portable-link"))
        val directory = File("build/outputs/habit-interop").apply { mkdirs() }
        File(directory, "native-backup.json").writeText(native.text())
        File(directory, "native-history.csv").writeText(HabitHistoryCsv.build(source))
    }
    @Test fun damagedUnknownVersionPrototypeAndDuplicateInputNeverChangeTheSource() {
        val source = source(); val original = HabitDocument.encode(source)
        val bad = JSONObject(file()); bad.getJSONObject("data").getJSONArray("habits").getJSONObject(0).put("title", "changed")
        assertThrows(Exception::class.java) { HabitBackups.parse(bad.toString()) }
        assertThrows(Exception::class.java) { HabitBackups.parse(JSONObject(file()).put("version", 99).toString()) }
        assertThrows(Exception::class.java) { HabitBackups.parse(file().replace("\"data\":", "\"__proto__\":{},\"data\":")) }
        val duplicates = JSONObject(file()); val rows = duplicates.getJSONObject("data").getJSONArray("habits"); rows.put(rows.get(0))
        assertThrows(Exception::class.java) { HabitBackups.parse(duplicates.toString()) }
        assertThrows(Exception::class.java) { HabitBackups.parse("[".repeat(129) + "0" + "]".repeat(129)) }
        assertEquals(original, HabitDocument.encode(source))
    }
    @Test fun cleanRecoveryRetainsHistoryIdsEconomyArchiveAndAnExplicitPausedStart() {
        val source = source(); val empty = LocalHabitWorkspace()
        val preview = HabitBackupRestore.preview(empty, file())
        assertTrue(preview.empty)
        val result = HabitBackupRestore.apply(empty, preview, emptyMap(), at)
        assertEquals(source.habits.map { it.id }, result.habits.map { it.id })
        assertEquals("paused", HabitLifecycle.state(result.habits.first()).status)
        assertEquals("archived", HabitLifecycle.state(result.habits.last()).status)
        assertEquals(source.rewards, result.rewards); assertEquals(source.progress, result.progress)
        assertEquals(source.measurements.single().entity.id, result.measurements.single().entity.id)
        assertTrue(result.measurements.single().historical)
        assertTrue(HabitBackupRestore.preview(result, file()).habits.all { it.kind in setOf("restored", "same") })
        val again = HabitBackupRestore.apply(result, HabitBackupRestore.preview(result, file()), emptyMap(), at)
        assertSame(result, again)
        val directory = File("build/outputs/habit-interop").apply { mkdirs() }
        File(directory, "native-restored.json").writeText(HabitBackups.create(result, at).text())
    }
    @Test fun populatedRecoveryRequiresKeepOrCopyAndCannotReissueCredits() {
        val source = source(); val current = source.copy(habits = source.habits.map { it.copy(title = "Current " + it.title) })
        val preview = HabitBackupRestore.preview(current, file())
        assertTrue(preview.habits.all { it.kind == "conflict" })
        assertThrows(IllegalArgumentException::class.java) { HabitBackupRestore.apply(current, preview, emptyMap(), at) }
        assertSame(current, HabitBackupRestore.apply(current, preview, preview.habits.associate { it.id to "keep" }, at))
        val copied = HabitBackupRestore.apply(current, preview, preview.habits.associate { it.id to "copy" }, at)
        assertEquals(4, copied.habits.size); assertEquals(4, copied.habits.map { it.id }.distinct().size)
        assertEquals(current.progress, copied.progress); assertEquals(current.rewards, copied.rewards)
        assertEquals(0, copied.completions.last().xpAwarded)
        assertTrue(copied.measurements.last().historical)
        assertTrue(HabitBackupRestore.preview(copied, file()).habits.all { it.kind == "restored" })
    }
    @Test fun staleAndFutureRestoresRejectBeforeTransformation() {
        val source = source(); val preview = HabitBackupRestore.preview(LocalHabitWorkspace(), file())
        assertThrows(IllegalArgumentException::class.java) { HabitBackupRestore.apply(source, preview, emptyMap(), at) }
        assertThrows(IllegalArgumentException::class.java) { HabitBackupRestore.apply(LocalHabitWorkspace(), preview, emptyMap(), "2026-10-17T00:00:00Z") }
    }
    @Test fun csvIncludesFullHistoryUnitsGoalsStableIdsEscapedNotesAndNeutralizesFormulas() {
        val source = source(); val day = LocalDate.parse("2026-10-17")
        val withOld = source.copy(completions = source.completions + source.completions.first().copy(
            entity = source.completions.first().entity.copy(id = "older-entry"), date = day.minusDays(1)))
        val csv = HabitHistoryCsv.build(withOld)
        assertTrue(csv.startsWith("\uFEFF")); assertTrue(csv.contains("older-entry")); assertTrue(csv.contains("water-value"))
        assertTrue(csv.contains("100.125")); assertTrue(csv.contains("ml")); assertTrue(csv.contains("\"\"цитата\"\"\nстрока 2"))
        assertFalse(HabitHistoryCsv.build(withOld, from = day).contains("older-entry"))
        val title = "\t=HYPERLINK(\"https://example.test\")"
        assertTrue(HabitHistoryCsv.build(source.copy(habits = source.habits.map { it.copy(title = title) })).contains("\"'\t=HYPERLINK"))
        assertThrows(IllegalArgumentException::class.java) { HabitHistoryCsv.build(source, from = day, to = day.minusDays(1)) }
    }
    @Test fun canonicalJsonMatchesWebEscapingAndStableNumericSpellings() {
        assertEquals("{\"a\":0,\"b\":0.000001,\"c\":1e-7,\"z\":\"</script> 💧\"}",
            HabitBackups.canonical(JSONObject().put("z", "</script> 💧").put("c", 1e-7).put("a", -0.0).put("b", 1e-6)))
        assertEquals("[1,1.25,null]", HabitBackups.canonical(JSONArray().put(1.0).put(1.25).put(JSONObject.NULL)))
    }
}
