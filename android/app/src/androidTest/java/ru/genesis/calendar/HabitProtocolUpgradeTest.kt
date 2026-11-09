package ru.genesis.calendar

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.IOException
import java.time.LocalDate
import java.time.ZoneId
import java.util.Base64
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.security.WorkspaceCipher

@RunWith(AndroidJUnit4::class)
class HabitProtocolUpgradeTest {
    @Test fun protocolSixOfflineOutboxMergesLifecycleSevenAndRecoversALostReplyWithoutNewCredits() = runBlocking {
        val scope = CloudAccountSnapshot.scopeFor("synthetic-protocol-six-upgrade")
        val key = ByteArray(32) { (it + 13).toByte() }; val cipher = LocalCipher()
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), GenesisDatabase::class.java).build()
        try {
            val date = LocalDate.parse("2026-10-19"); val at = "2026-10-19T12:00:00Z"
            val habit = Habit(TrackerEntity("old-client-habit", at, at), "До отключения сети", date,
                HabitEngine(GenesisCalendar(ZoneId.of("UTC"))).defaultSchedule(date, CalendarMode.PROFANE))
            val base = LocalHabitWorkspace(habits = listOf(habit))
            val completion = HabitCompletion(TrackerEntity("habit-completion:${habit.id}:$date", at, at), habit.id, date,
                completed = true, score = 10, xpAwarded = 10)
            val credit = Rewards.create(25.0, "comeback", habit.id, "legacy-offline-credit", at)
            val local = base.copy(habits = listOf(habit.copy(title = "Моё изменение без сети")), completions = listOf(completion),
                rewards = listOf(credit), progress = UserProgress(lifetimeXp = 10, laurelsBalance = 25))
            fun web(workspace: LocalHabitWorkspace) = WorkspacePatch.localDocument(WorkspacePatch.emptyDocument(), null,
                JSONObject(HabitDocument.encode(workspace)), null)
            val baseDocument = web(base)
            val paused = HabitLifecycleWorkspace.apply(base, HabitLifecycleCommand("remote-pause", habit.id, "2026-10-20T12:00:00Z", "pause", emptyList()))
            var remote = web(paused).put("unrelatedWebSection", JSONObject().put("retained", true)); var version = 2L; var accepted = 0
            db.dao().putDocument(DocumentRecord(scope, "cloud-base", cipher.encrypt(baseDocument.toString(), "$scope/cloud-base"), 1))
            db.dao().putDocument(DocumentRecord(scope, "habits", cipher.encrypt(HabitDocument.encode(local), "$scope/habits"), 2))
            db.dao().putOutbox(OutboxRecord(scope, "habits", 2, "legacy-protocol-six-operation"))
            val pending = db.dao().outbox(scope); val encrypted = db.dao().document(scope, "habits")
            val transport = object : CloudWorkspaceTransport {
                override fun get(): JSONObject {
                    val envelope = WorkspaceCipher.encrypt(remote.toString().toByteArray(), key)
                    return JSONObject().put("workspace", JSONObject().put("keyMode", "account").put("key", Base64.getEncoder().encodeToString(key))
                        .put("envelope", JSONObject().put("version", version).put("ciphertext", envelope.ciphertext).put("iv", envelope.iv)))
                }
                override fun put(body: JSONObject): JSONObject {
                    assertEquals(7, body.getInt("writerProtocol")); assertEquals(7, body.getInt("minimumWriterProtocol"))
                    assertEquals(version, body.getLong("expectedVersion"))
                    val bytes = WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(body.getString("ciphertext"), body.getString("iv")), key)
                    remote = try { JSONObject(bytes.toString(Charsets.UTF_8)) } finally { bytes.fill(0) }
                    version++; accepted++
                    if (accepted == 1) throw IOException("Synthetic lost response after server commit")
                    return JSONObject().put("workspace", JSONObject().put("version", version))
                }
            }
            assertThrows(IOException::class.java) { runBlocking { CloudWorkspaceSync(db, transport).flush(scope) } }
            assertEquals(pending, db.dao().outbox(scope)); assertEquals(encrypted, db.dao().document(scope, "habits"))
            assertEquals(1, CloudWorkspaceSync(db, transport).flush(scope)); assertTrue(db.dao().outbox(scope).isEmpty())
            val confirmed = HabitDocument.decode(CloudAccountImporter.habitsDocument(remote), version)
            assertEquals("Моё изменение без сети", confirmed.habits.single().title)
            assertEquals("paused", HabitLifecycle.state(confirmed.habits.single()).status)
            assertEquals(1, confirmed.completions.size); assertEquals(10, confirmed.completions.single().xpAwarded)
            assertEquals(10, confirmed.progress.lifetimeXp); assertEquals(listOf(credit), confirmed.rewards)
            assertTrue(remote.getJSONObject("unrelatedWebSection").getBoolean("retained"))
            val settled = db.dao().document(scope, "habits"); val count = accepted
            assertEquals(0, CloudWorkspaceSync(db, transport).flush(scope)); assertEquals(count, accepted)
            assertEquals(settled, db.dao().document(scope, "habits"))
        } finally { key.fill(0); db.close() }
    }
}
