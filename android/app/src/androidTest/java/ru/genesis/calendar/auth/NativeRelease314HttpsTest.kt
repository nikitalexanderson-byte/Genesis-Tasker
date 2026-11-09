package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import ru.genesis.calendar.data.StoicheionDrawWire

/** Real native client and an independent website-style session share a disposable account over TLS. */
class NativeRelease314HttpsTest {
    private val fixture = TemplateHttpsFixture()
    @Before fun open() = fixture.open()
    @After fun close() = fixture.close()
    private fun stableDraw(value: JSONObject): String = JSONObject(value.toString()).apply { remove("remainingSeconds") }.toString()

    private class WebsiteSession {
        private val cookie: String
        private val csrf: String
        val user: JSONObject
        init {
            val connection = URL("$AUTH_ORIGIN/__fixture/sign-in?actor=editor").openConnection() as HttpsURLConnection
            try {
                connection.instanceFollowRedirects = false
                assertEquals(302, connection.responseCode)
                cookie = requireNotNull(connection.getHeaderField("Set-Cookie")).substringBefore(';')
                check(cookie.startsWith("$SESSION_COOKIE="))
            } finally { connection.disconnect() }
            val session = request("GET", "/api/session")
            csrf = session.getString("csrf")
            user = session.getJSONObject("user")
        }
        fun request(method: String, path: String, body: JSONObject? = null): JSONObject {
            check(path.startsWith("/api/") && !path.contains(".."))
            val connection = URL("$AUTH_ORIGIN$path").openConnection() as HttpsURLConnection
            try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 15_000; connection.readTimeout = 60_000
                connection.requestMethod = method
                connection.setRequestProperty("Cookie", cookie)
                connection.setRequestProperty("X-Genesis-Time-Zone", java.util.TimeZone.getDefault().id)
                if (body != null) {
                    connection.setRequestProperty("X-CSRF-Token", csrf)
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.doOutput = true
                    connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                }
                check(connection.responseCode in 200..299) { "Website fixture HTTP ${connection.responseCode}" }
                return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
            } finally { connection.disconnect() }
        }
    }

    @Test fun timelineDrawSavesReloadsAndRerollsThroughTheActualClientWithoutChangingClassicDraws() {
        val client = fixture.client; val generation = fixture.generation
        assertFalse(StoicheionDrawWire.drawsObject(client.stoicheionDraws(generation)).has("timeline"))
        client.saveStoicheionDraw(generation, "daily", 17)
        client.saveStoicheionDraw(generation, "spread", 23)
        val classic = client.stoicheionDraws(generation).getJSONObject("draws")
        client.saveStoicheionDraw(generation, "timeline", 0xffff_ffffL)
        val first = client.stoicheionDraws(generation).getJSONObject("draws").getJSONObject("timeline")
        assertEquals(0xffff_ffffL, first.getLong("seed")); assertEquals(1, first.getInt("attempts"))
        assertTrue(first.getBoolean("canReroll"))
        val website = WebsiteSession()
        assertEquals(fixture.actor, website.user.getString("uid"))
        assertEquals(stableDraw(first), stableDraw(website.request("GET", "/api/stoicheion/draws").getJSONObject("draws").getJSONObject("timeline")))
        client.saveStoicheionDraw(generation, "timeline", 123456789)
        val fresh = AuthSessionClient(fixture.app); val token = fresh.begin()
        val all = fresh.stoicheionDraws(token).getJSONObject("draws")
        val second = all.getJSONObject("timeline")
        assertEquals(123456789L, second.getLong("seed")); assertEquals(2, second.getInt("attempts"))
        assertFalse(second.getBoolean("canReroll"))
        assertEquals(first.getString("firstDrawAt"), second.getString("firstDrawAt"))
        assertEquals(stableDraw(classic.getJSONObject("daily")), stableDraw(all.getJSONObject("daily")))
        assertEquals(stableDraw(classic.getJSONObject("spread")), stableDraw(all.getJSONObject("spread")))
        try { client.saveStoicheionDraw(generation, "timeline", 99); fail("A third draw must be rejected") }
        catch (expected: AuthFailure) { assertNotNull(expected.message) }
    }

    @Test fun orderedDailyAdviceIsIdenticalForNativeWebsiteAndFreshSessionAfterReachingTheLimit() {
        val client = fixture.client; val generation = fixture.generation
        val original = client.session(generation).getJSONObject("user")
        try {
            client.updatePreferences(generation, JSONObject().put("language", "ru").put("advicePreferences",
                JSONObject().put("enabled", true).put("smart", false).put("aphrodisiaAdult", true)
                    .put("categories", JSONArray(adviceCategories))))
            var result = DailyAdviceProtocol.parse(client.dailyAdvice(generation, JSONObject()))
            assertTrue(result.dailyLimit >= 3)
            while (result.canNext) {
                val card = requireNotNull(result.advice)
                result = DailyAdviceProtocol.parse(client.nextDailyAdvice(generation, JSONObject(), card.id, card.day))
            }
            assertEquals(result.sequence, result.history.size)
            assertTrue(result.history.size >= 3)
            assertEquals((1..result.sequence).toList(), result.history.map { it.sequence })
            val website = WebsiteSession()
            assertEquals(fixture.actor, website.user.getString("uid"))
            assertEquals(result, DailyAdviceProtocol.parse(website.request("POST", "/api/advice/today", JSONObject())))
            val older = result.history.first()
            website.request("POST", "/api/advice/view", DailyAdviceProtocol.record(older.id, older.day))
            assertEquals(result, DailyAdviceProtocol.parse(client.dailyAdvice(generation, JSONObject())))
            val fresh = AuthSessionClient(fixture.app); val token = fresh.begin()
            assertEquals(result, DailyAdviceProtocol.parse(fresh.dailyAdvice(token, JSONObject())))
            // A website request from an earlier displayed card cannot consume another slot or move the pointer.
            assertEquals(result, DailyAdviceProtocol.parse(website.request("POST", "/api/advice/next",
                JSONObject().put("fromId", older.id).put("dayKey", older.day))))
        } finally {
            client.updatePreferences(generation, JSONObject().put("language", original.getString("language"))
                .put("advicePreferences", original.getJSONObject("advicePreferences")))
        }
    }

    @Test fun adviceCollectionChoiceIsAccountScopedAndIdenticalInWebsiteAndNativeSessions() {
        val client=fixture.client;val generation=fixture.generation
        val original=client.session(generation).getJSONObject("user").getJSONObject("advicePreferences")
        try {
            val both=JSONArray(listOf("aurora","philosophers"))
            client.updatePreferences(generation,JSONObject().put("advicePreferences",JSONObject().put("collections",both)))
            val website=WebsiteSession()
            assertEquals(both.toString(),website.user.getJSONObject("advicePreferences").getJSONArray("collections").toString())
            val only=JSONArray(listOf("philosophers"))
            website.request("PUT","/api/account/preferences",JSONObject().put("advicePreferences",JSONObject().put("enabled",true).put("collections",only)))
            val fresh=AuthSessionClient(fixture.app);val token=fresh.begin()
            assertEquals(listOf("philosophers"),AdvicePreferences.fromJson(fresh.session(token).getJSONObject("user").getJSONObject("advicePreferences")).collections)
            val empty=DailyAdviceProtocol.parse(fresh.dailyAdvice(token,JSONObject()))
            assertNull(empty.advice);assertTrue(empty.history.isEmpty())
            assertFalse(empty.canNext)
        } finally { client.updatePreferences(generation,JSONObject().put("advicePreferences",original)) }
    }

    @Test fun automaticDeletionAndItsXpDeductionRoundTripTheRealEncryptedAccountAndRejectOldWriters() = kotlinx.coroutines.runBlocking {
        val client=fixture.client;val generation=fixture.generation
        val initial=client.workspace(generation).getJSONObject("workspace")
        val key=ru.genesis.calendar.security.WorkspaceCipher.decodeKey(initial.getString("key"))
        val cipher=ru.genesis.calendar.data.LocalCipher()
        val db=androidx.room.Room.inMemoryDatabaseBuilder(fixture.app,ru.genesis.calendar.data.GenesisDatabase::class.java).build()
        val account=CloudAccountSnapshot.scopeFor(fixture.actor)
        fun decrypt(workspace: JSONObject): JSONObject {
            if(workspace.isNull("envelope")) return WorkspacePatch.emptyDocument()
            val envelope=workspace.getJSONObject("envelope")
            val bytes=ru.genesis.calendar.security.WorkspaceCipher.decrypt(ru.genesis.calendar.security.WorkspaceCipher.Envelope(envelope.getString("ciphertext"),envelope.getString("iv")),key)
            return try { JSONObject(bytes.toString(Charsets.UTF_8)) } finally { bytes.fill(0) }
        }
        val original=decrypt(initial)
        fun upload(document: JSONObject,version: Long): JSONObject {
            val encrypted=ru.genesis.calendar.security.WorkspaceCipher.encrypt(document.toString().toByteArray(),key)
            return client.putWorkspace(generation,JSONObject().put("ciphertext",encrypted.ciphertext).put("iv",encrypted.iv)
                .put("expectedVersion",version).put("writerProtocol",8).put("minimumWriterProtocol",8))
        }
        try {
            val today=java.time.LocalDate.now(java.time.ZoneId.of("Europe/Moscow"))
            val start=today.minusDays(20)
            val engine=ru.genesis.calendar.domain.habits.HabitEngine(ru.genesis.calendar.domain.GenesisCalendar(java.time.ZoneId.of("Europe/Moscow")))
            val habit=ru.genesis.calendar.domain.habits.Habit(ru.genesis.calendar.domain.habits.TrackerEntity.create("qa314"),"Synthetic automatic expiry",start,
                engine.defaultSchedule(start,ru.genesis.calendar.domain.CalendarMode.PROFANE),autoDeletePolicy=ru.genesis.calendar.domain.habits.HabitAutoDeletePolicy(count=3,points="remove",startOn=today.minusDays(10)))
            val local=ru.genesis.calendar.data.LocalHabitWorkspace(habits=listOf(habit),completions=listOf(ru.genesis.calendar.domain.habits.HabitCompletion(
                ru.genesis.calendar.domain.habits.TrackerEntity.create("qa314-completion"),habit.id,start,true,score=10,xpAwarded=10,note="Preserve evidence")),
                progress=ru.genesis.calendar.domain.habits.UserProgress(lifetimeXp=10))
            val seed=WorkspacePatch.localDocument(original,null,JSONObject(ru.genesis.calendar.data.HabitDocument.encode(local)),null)
                .put("unknownWebSection",JSONObject().put("preserve",true))
            val seeded=upload(seed,initial.optJSONObject("envelope")?.getLong("version") ?: 0).getJSONObject("workspace").getLong("version")
            val expired=ru.genesis.calendar.data.HabitAutoDeleteWorkspace.apply(local)
            assertEquals(0,expired.progress.lifetimeXp)
            db.dao().putDocument(ru.genesis.calendar.data.DocumentRecord(account,"cloud-base",cipher.encrypt(seed.toString(),"$account/cloud-base"),seeded))
            db.dao().putDocument(ru.genesis.calendar.data.DocumentRecord(account,"habits",cipher.encrypt(ru.genesis.calendar.data.HabitDocument.encode(expired),"$account/habits"),seeded+1))
            db.dao().putOutbox(ru.genesis.calendar.data.OutboxRecord(account,"habits",seeded+1,"qa314-automatic"))
            val transport=object:CloudWorkspaceTransport {
                override fun get()=client.workspace(generation)
                override fun put(body: JSONObject):JSONObject { assertEquals(9,body.getInt("writerProtocol"));assertEquals(8,body.getInt("minimumWriterProtocol"));return client.putWorkspace(generation,body) }
            }
            val sync=CloudWorkspaceSync(db,transport)
            assertEquals(1,sync.flush(account));assertEquals(0,sync.flush(account))
            val website=WebsiteSession().request("GET","/api/workspace").getJSONObject("workspace")
            assertEquals(8,website.getJSONObject("envelope").getInt("minimumWriterProtocol"))
            val shared=decrypt(website)
            val confirmed=ru.genesis.calendar.data.HabitDocument.decode(ru.genesis.calendar.data.CloudAccountImporter.habitsDocument(shared),seeded+1)
            assertEquals(expired.habits.single().autoDeletePolicy,confirmed.habits.single().autoDeletePolicy)
            assertEquals("deleted",ru.genesis.calendar.domain.habits.HabitLifecycle.state(confirmed.habits.single()).status)
            assertEquals(0,confirmed.progress.lifetimeXp);assertEquals(10,confirmed.progress.grossLifetimeXp);assertEquals(10,confirmed.progress.forfeitedHabitXp)
            assertEquals(local.completions,confirmed.completions);assertTrue(shared.getJSONObject("unknownWebSection").getBoolean("preserve"))
            val old=ru.genesis.calendar.security.WorkspaceCipher.encrypt(seed.toString().toByteArray(),key)
            try { client.putWorkspace(generation,JSONObject().put("ciphertext",old.ciphertext).put("iv",old.iv).put("expectedVersion",seeded+1).put("writerProtocol",7));fail("Old writer erased automatic policy") }
            catch(expected: AuthFailure) { assertNotNull(expected.message) }
            assertEquals(seeded+1,client.workspace(generation).getJSONObject("workspace").getJSONObject("envelope").getLong("version"))
        } finally {
            val current=client.workspace(generation).getJSONObject("workspace").getJSONObject("envelope").getLong("version")
            upload(original,current);key.fill(0);db.close()
        }
    }
}
