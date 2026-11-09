package ru.genesis.calendar.auth

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.CalendarContext
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.security.WorkspaceCipher
import java.io.File
import java.time.Instant
import java.time.LocalDate

/** Website -> encrypted API -> normal account import -> Room/outbox -> API -> website. */
class NativeHabitExchangeHttpsTest {
    private val fixture = TemplateHttpsFixture()
    private lateinit var app: GenesisApplication
    private lateinit var controller: AuthController
    private lateinit var repository: HabitsRepository
    @Before fun open() {
        fixture.open()
        app = fixture.app.applicationContext as GenesisApplication
        controller = AuthController.get(app)
        runBlocking {
            withContext(Dispatchers.Main) { controller.checkSession() }
            withTimeout(60_000) { controller.state.first { !it.busy && it.ready && !it.requiresSignIn && it.user?.uid == fixture.actor } }
        }
        repository = HabitsRepository(app)
    }
    @After fun close() = fixture.close()
    private fun read() = runBlocking { repository.workspace.first() }
    private fun sync() = runBlocking { withContext(Dispatchers.Main) { assertTrue(controller.synchronizeInBackground()) } }
    private fun lifecycle(id: String, action: String) = runBlocking {
        val habit = read().habits.single { it.id == id }
        repository.lifecycle(HabitLifecycleCommand("https-$action-$id", id, Instant.now().toString(), action,
            HabitLifecycle.state(habit).heads.map { it.id }))
    }
    private fun part(value: HabitComparisonPart) = JSONObject().put("completed", value.completed).put("planned", value.planned)
        .put("unknown", value.unknown).put("conflicts", value.conflicts)
    @Test fun portableRecoveryAndLifecycleKeepIdentityCreditsAndAllCalendarReportsAcrossRealClients() {
        val state = fixture.raw("GET", "/__fixture/state")
        val today = LocalDate.parse(state.getString("today"))
        assertEquals(LocalDate.now(), today)
        val source = read()
        assertEquals(setOf("efg-binary", "efg-quantity", "efg-duration", "efg-period"), source.habits.map { it.id }.toSet())
        assertEquals(state.getInt("xp"), source.progress.lifetimeXp)
        val backup = HabitBackups.parse(state.getString("backup"))
        assertEquals(4, backup.workspace().habits.size)
        val before = HabitBackups.fingerprint(source)
        assertThrows(IllegalArgumentException::class.java) { HabitBackups.parse(state.getString("backup").replace(backup.checksum, "0".repeat(64))) }
        assertEquals(before, HabitBackups.fingerprint(read()))
        runBlocking {
            repository.recordMeasurement("efg-quantity", today, 25000, operationId = "native-volume")
            repository.recordMeasurement("efg-quantity", today, 25000, operationId = "native-volume")
            repository.recordMeasurement("efg-duration", today, 30000, operationId = "native-duration")
            repository.recordMeasurement("efg-duration", today, 30000, operationId = "native-duration")
        }
        val earned = read()
        assertEquals(1, earned.measurements.count { it.entity.id == "native-volume" })
        assertEquals(1, earned.measurements.count { it.entity.id == "native-duration" })
        lifecycle("efg-quantity", "archive"); lifecycle("efg-duration", "pause")
        assertEquals(earned.rewards, read().rewards)
        assertEquals(earned.progress.lifetimeXp, read().progress.lifetimeXp)
        sync()
        assertTrue(runBlocking { app.database.dao().outbox(app.workspaceScope) }.none { it.entityId == "habits" })
        val service = HabitBackupService(app)
        runBlocking {
            val draft = service.prepare(state.getString("backup"), "website.json")
            for (habit in draft.preview.habits.filter { it.kind == "conflict" }) service.choose(draft.id, habit.id, if (habit.id == "efg-quantity") "copy" else "keep")
            service.apply(draft.id)
            val fingerprint = HabitBackups.fingerprint(service.current())
            service.apply(draft.id)
            assertEquals(fingerprint, HabitBackups.fingerprint(service.current()))
        }
        assertEquals(5, read().habits.size)
        assertEquals(earned.progress.lifetimeXp, read().progress.lifetimeXp)
        assertEquals(earned.rewards, read().rewards)
        sync()
        val final = read(); val now = Instant.now()
        val context = CalendarContext(version = 2, timeZone = "Europe/Moscow", gregorianYearStart = "march")
        val comparisons = JSONObject()
        for (mode in CalendarMode.entries) {
            val result = HabitAnalysis.comparison(final, today, mode, context, now)
            comparisons.put(mode.wireValue, JSONObject().put("current", part(result.current)).put("previous", part(result.previous))
                .put("elapsed", result.elapsed).put("open", result.open).put("absoluteChange", result.absoluteChange)
                .put("changePercent", result.changePercent ?: JSONObject.NULL))
        }
        File(app.cacheDir, "efg-native-backup.json").writeText(HabitBackups.create(final).text())
        File(app.cacheDir, "efg-native-history.csv").writeText(HabitHistoryCsv.build(final))
        File(app.cacheDir, "efg-native-metrics.json").writeText(JSONObject().put("now", now.toString())
            .put("xp", final.progress.lifetimeXp).put("balance", final.progress.laurelsBalance).put("comparisons", comparisons).toString())
    }
    @Test fun concurrentWebsiteAndOfflineNativeCreditsMergeOnceAndAvailabilityRequiresExplicitResolution() {
        val state = fixture.raw("GET", "/__fixture/state")
        val today = LocalDate.parse(state.getString("today"))
        assertTrue(read().habits.any { it.id == "efg-race-quantity" })
        runBlocking {
            repository.complete("efg-race-binary", true)
            repository.recordMeasurement("efg-race-quantity", today, 100000, operationId = "native-race-volume")
        }
        lifecycle("efg-binary", "pause")
        assertTrue(runBlocking { app.database.dao().outbox(app.workspaceScope) }.any { it.entityId == "habits" })
        val remote = fixture.client.workspace(fixture.generation).getJSONObject("workspace")
        val key = WorkspaceCipher.decodeKey(remote.getString("key"))
        val encrypted = try { WorkspaceCipher.encrypt(state.getJSONObject("webRace").toString().toByteArray(), key) } finally { key.fill(0) }
        fixture.client.putWorkspace(fixture.generation, JSONObject().put("ciphertext", encrypted.ciphertext).put("iv", encrypted.iv)
            .put("expectedVersion", remote.getJSONObject("envelope").getLong("version")).put("writerProtocol", 7).put("minimumWriterProtocol", 7))
        sync()
        val merged = read()
        assertEquals(state.getInt("baseXp") + 20, merged.progress.lifetimeXp)
        assertEquals(2, merged.measurements.count { it.habitId == "efg-race-quantity" })
        assertEquals(1, merged.completions.count { it.habitId == "efg-race-binary" })
        assertEquals(1, merged.completions.count { it.habitId == "efg-race-quantity" })
        val habit = merged.habits.single { it.id == "efg-binary" }; val conflict = HabitLifecycle.state(habit)
        assertTrue(conflict.conflict); assertFalse(habit.active)
        runBlocking { repository.lifecycle(HabitLifecycleCommand("native-race-resolve", habit.id, Instant.now().toString(), "resolve",
            conflict.heads.map { it.id }, "web-race-archive")) }
        sync()
        assertFalse(HabitLifecycle.state(read().habits.single { it.id == habit.id }).conflict)
        assertEquals("archived", HabitLifecycle.state(read().habits.single { it.id == habit.id }).status)
        assertEquals(state.getInt("baseXp") + 20, read().progress.lifetimeXp)
    }
}
