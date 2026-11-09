package ru.genesis.calendar.auth

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import java.io.ByteArrayInputStream
import java.net.URL
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.util.Base64
import java.util.UUID
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.*
import ru.genesis.calendar.security.WorkspaceCipher

/** Native transport + encrypted Room + real isolated PHP/SQLite. Google identity is a
 * guarded server fixture, never a mocked application endpoint or a provider login claim. */
class FullQaNativeHttpsTest {
    @Test fun freeNativeEncryptedRoundTrip() = exercise("free")
    @Test fun standartNativeEncryptedRoundTrip() = exercise("standart")
    @Test fun premiumNativeEncryptedRoundTrip() = exercise("premium")
    @Test fun businessNativeEncryptedRoundTrip() = exercise("business")
    @Test fun lifetimeNativeEncryptedRoundTrip() = exercise("premium4life")

    private val app get() = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
    private var cookie = ""
    private var csrf = ""
    private fun request(path: String, method: String = "GET", body: JSONObject? = null): JSONObject {
        check(path.startsWith("/api/") && !path.contains(".."))
        val connection = URL("$AUTH_ORIGIN$path").openConnection() as HttpsURLConnection
        try {
            connection.instanceFollowRedirects = false; connection.connectTimeout = 10_000; connection.readTimeout = 20_000
            connection.requestMethod = method
            if (cookie.isNotEmpty()) connection.setRequestProperty("Cookie", "$SESSION_COOKIE=$cookie")
            if (body != null) {
                connection.setRequestProperty("X-CSRF-Token", csrf)
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.doOutput = true
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            assertEquals("Synthetic fixture endpoint", 200, connection.responseCode)
            connection.getHeaderField("Set-Cookie")?.substringBefore(';')?.let {
                check(it.startsWith("$SESSION_COOKIE=")); cookie = it.substringAfter('=')
                check(cookie.matches(Regex("[A-Za-z0-9,-]{16,256}")))
            }
            return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally { connection.disconnect() }
    }
    private fun signIn(plan: String): Pair<AuthSessionClient, Long> {
        cookie = ""
        assertTrue(request("/api/qa/login?tier=$plan").getBoolean("synthetic"))
        val session = request("/api/session")
        val user = session.getJSONObject("user")
        check(user.getString("email").endsWith("@example.invalid"))
        check(!user.optBoolean("isAdmin"))
        csrf = AuthProtocol.csrf(session.getString("csrf"))
        val secret = JSONObject().put("cookie", cookie).put("csrf", csrf).put("expiresAt", System.currentTimeMillis() + 3_600_000)
        check(app.getSharedPreferences("genesis.native.auth.v1", Context.MODE_PRIVATE).edit()
            .putString("session", LocalCipher().encrypt(secret.toString(), "genesis.native.auth.v2")).commit())
        return AuthSessionClient(app).let { it to it.begin() }
    }
    private fun exercise(plan: String) = runBlocking {
        val args = InstrumentationRegistry.getArguments()
        check(args.getString("genesisFullQaHttps") == "true") { "Start the owned localhost HTTPS fixture" }
        check(app.packageName == "ru.genesis.calendar.qa1103.debug" && BuildConfig.DEBUG && AUTH_ORIGIN == "https://localhost:4443")
        val certificate = CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(
            Base64.getDecoder().decode(requireNotNull(args.getString("genesisFixtureCa")))))
        val trust = KeyStore.getInstance(KeyStore.getDefaultType()).apply { load(null); setCertificateEntry("owned-loopback", certificate) }
        val managers = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(trust) }
        val previous: SSLSocketFactory = HttpsURLConnection.getDefaultSSLSocketFactory()
        HttpsURLConnection.setDefaultSSLSocketFactory(SSLContext.getInstance("TLS").apply { init(null, managers.trustManagers, null) }.socketFactory)
        var ownerScope: String? = null
        try {
            val (client, generation) = signIn(plan)
            val session = client.session(generation)
            val uid = session.getJSONObject("user").getString("uid")
            val settings = requireNotNull(AccountSettings.fromResponse(session))
            assertFalse(settings.isAdmin)
            assertEquals(plan, settings.featureAccess.declaredPlan)
            assertTrue(settings.featureAccess.enforcementEnabled)
            assertTrue(settings.featureAccess.allows("calendar-sync"))
            assertFalse(settings.featureAccess.allows("assistant"))
            val paidTeam = plan in setOf("business", "premium4life")
            assertEquals(paidTeam, settings.featureAccess.allows("shared-projects"))
            // Read/export of existing shared data deliberately survives a downgrade.
            // The subscription boundary applies to creation and edits, not GET.
            val beforeSpaces = client.sharedSpaces(generation).getJSONArray("spaces")
            if (paidTeam) {
                val space = client.createSharedSpace(generation, JSONObject()
                    .put("title", "Native QA $plan ${UUID.randomUUID()}")).getJSONObject("space")
                try {
                    val afterSpaces = client.sharedSpaces(generation).getJSONArray("spaces")
                    assertTrue((0 until afterSpaces.length()).any { afterSpaces.getJSONObject(it).getString("id") == space.getString("id") })
                } finally {
                    assertTrue(request("/api/shared/spaces/${space.getString("id")}", "DELETE",
                        JSONObject().put("expectedRevision", space.getLong("revision"))).getBoolean("ok"))
                }
            } else {
                try { client.createSharedSpace(generation, JSONObject().put("title", "Denied native QA $plan")); fail("Ordinary $plan must not create business collaboration") }
                catch (failure: AuthApiError) { assertEquals("FEATURE_SUBSCRIPTION_REQUIRED", failure.code) }
                assertEquals("Denied creation has no side effects", beforeSpaces.toString(), client.sharedSpaces(generation).getJSONArray("spaces").toString())
            }
            val snapshot = CloudAccountSnapshot.fromBootstrap(client.accountBootstrap(generation, session))
            assertEquals(CloudAccountImporter.Result.IMPORTED, CloudAccountImporter(app.database).import(snapshot))
            app.activateAccount(uid)
            val scope = app.workspaceScope.also { ownerScope = it }
            app.rememberFeatureAccess(scope, settings.featureAccess)
            val repo = WorkspaceStructureRepository(app)
            val id = UUID.randomUUID().toString()
            val title = "Native HTTPS $plan · Кириллица 🧪"
            repo.saveProject(GenesisProject(id, null, "personal", title, "Данные после холодного чтения", emptyList(), "active", 0))
            val sync = CloudWorkspaceSync(app.database, object : CloudWorkspaceTransport {
                override fun get() = client.workspace(generation)
                override fun put(body: JSONObject) = client.putWorkspace(generation, body)
            })
            assertEquals(1, sync.flush(scope)); assertEquals(0, sync.flush(scope))
            assertTrue(app.database.dao().outbox(scope).isEmpty())
            // A fresh native client reopens the encrypted native session and the server's saved envelope.
            val fresh = AuthSessionClient(app); val token = fresh.begin()
            assertEquals(uid, fresh.session(token).getJSONObject("user").getString("uid"))
            val workspace = fresh.workspace(token).getJSONObject("workspace")
            val key = WorkspaceCipher.decodeKey(workspace.getString("key"))
            try {
                val envelope = workspace.getJSONObject("envelope")
                val plain = WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(envelope.getString("ciphertext"), envelope.getString("iv")), key)
                try {
                    val document = JSONObject(plain.toString(Charsets.UTF_8))
                    val rows = document.getJSONArray("projects")
                    assertTrue((0 until rows.length()).any { rows.getJSONObject(it).getString("id") == id && rows.getJSONObject(it).getString("title") == title })
                } finally { plain.fill(0) }
            } finally { key.fill(0) }
            assertTrue(WorkspaceStructureRepository(app).workspace.first().projects.any { it.id == id && it.title == title })
            assertFalse(app.database.dao().document(scope, "structure")!!.encrypted.contains(title))
            // Log into another ordinary account. Its server workspace must not contain this user's data.
            val (outsider, outsiderGeneration) = signIn("outsider")
            assertNotEquals(uid, outsider.session(outsiderGeneration).getJSONObject("user").getString("uid"))
            val outsiderWorkspace = outsider.workspace(outsiderGeneration).getJSONObject("workspace")
            assertTrue("Owned fixture outsider must have no user's envelope", outsiderWorkspace.isNull("envelope"))
            val (restored, restoredGeneration) = signIn(plan)
            repo.deleteProject(id)
            val cleanup = CloudWorkspaceSync(app.database, object : CloudWorkspaceTransport {
                override fun get() = restored.workspace(restoredGeneration)
                override fun put(body: JSONObject) = restored.putWorkspace(restoredGeneration, body)
            })
            assertEquals(1, cleanup.flush(scope))
            assertFalse(repo.workspace.first().projects.any { it.id == id })
            // Exercise the official authenticated native billing transport after
            // the existing base-tier assertions. Trial never changes paid fields.
            restored.setTrialForeground(true)
            assertEquals(uid, restored.session(restoredGeneration).getJSONObject("user").getString("uid"))
            val trialPlan = mapOf("free" to "standart", "standart" to "premium", "premium" to "business")[plan]
            if (trialPlan != null) {
                val grant = restored.billing(restoredGeneration, "POST", "/billing/trial", JSONObject().put("plan", trialPlan))
                val trial = grant.getJSONObject("trial")
                assertEquals("active", trial.getString("status"))
                assertEquals(mapOf("standart" to "Trial-Standart", "premium" to "Trial-Premium", "business" to "Trial-Business")[trialPlan], trial.getString("label"))
                assertEquals(259200, trial.getInt("durationSeconds"))
                assertEquals(259200L, java.time.Duration.between(java.time.Instant.parse(trial.getString("startsAt")), java.time.Instant.parse(trial.getString("endsAt"))).seconds)
                val updated = grant.getJSONObject("user")
                assertEquals(plan, updated.getString("subscriptionPlan"))
                val overlay = updated.getJSONObject("featureAccess")
                assertEquals("trial", overlay.getString("source"))
                assertEquals(trialPlan, overlay.getString("effectivePlan"))
                assertEquals(plan, overlay.getJSONObject("paidAccess").getString("effectivePlan"))
                val extraFeature = mapOf("standart" to "habit-timer", "premium" to "stoicheion-spread", "business" to "shared-projects").getValue(trialPlan)
                val receipt = requireNotNull(restored.liveReceipt(grant))
                val liveAccess = requireNotNull(AccountSettings.fromResponse(grant, receipt.proof, receipt)).featureAccess
                assertTrue("Live authenticated native response grants trial-only feature", liveAccess.allows(extraFeature))
                assertFalse("A cached JSON clone has no runtime trial proof", FeatureAccess.fromJson(JSONObject(overlay.toString())).allows(extraFeature))
                restored.setTrialForeground(false)
                assertFalse("Background invalidates live trial proof", liveAccess.allows(extraFeature))
                restored.setTrialForeground(true)
                assertFalse("Resume alone cannot recreate a live trial proof", liveAccess.allows(extraFeature))
                val resumed = restored.session(restoredGeneration)
                val resumedReceipt = requireNotNull(restored.liveReceipt(resumed))
                assertTrue("Resume requires a new authenticated response", requireNotNull(AccountSettings.fromResponse(resumed, resumedReceipt.proof, resumedReceipt)).featureAccess.allows(extraFeature))
                val replay = restored.billing(restoredGeneration, "POST", "/billing/trial", JSONObject().put("plan", trialPlan)).getJSONObject("trial")
                assertEquals(trial.getString("startsAt"), replay.getString("startsAt"))
                assertEquals(trial.getString("endsAt"), replay.getString("endsAt"))
                var switched = false
                try { restored.billing(restoredGeneration, "POST", "/billing/trial", JSONObject().put("plan", if (trialPlan == "business") "premium" else "business")) }
                catch (failure: AuthApiError) { switched = true; assertEquals("TRIAL_ALREADY_USED", failure.code) }
                assertTrue("A second chosen tier cannot start a new trial", switched)
                val reread = restored.session(restoredGeneration).getJSONObject("user")
                assertEquals(trial.getString("endsAt"), reread.getJSONObject("trial").getString("endsAt"))
                assertEquals(plan, reread.getString("subscriptionPlan"))
            } else {
                var denied = false
                try { restored.billing(restoredGeneration, "POST", "/billing/trial", JSONObject().put("plan", "premium")) }
                catch (failure: AuthApiError) { denied = true; assertEquals("TRIAL_NOT_AN_UPGRADE", failure.code) }
                assertTrue("Business and Elite cannot waste/downgrade a trial", denied)
                assertEquals(plan, restored.session(restoredGeneration).getJSONObject("user").getString("subscriptionPlan"))
            }
            restored.setTrialForeground(false)
            println("GENESIS_FULL_QA_HTTPS=" + JSONObject().put("plan", plan).put("status", "PASS")
                .put("ordinaryUser", true).put("realNativeTransport", true).put("realPhpSqlite", true)
                .put("providerLogin", "synthetic-server-fixture").put("roundTrip", "create-sync-cold-read-delete-sync")
                .put("outsiderIsolated", true).put("sharedRead", "allow-preserved")
                .put("sharedCreate", if (paidTeam) "allow" else "deny-without-side-effects")
                .put("trialTarget", trialPlan ?: JSONObject.NULL).put("trialServerDurationSeconds", if (trialPlan != null) 259200 else JSONObject.NULL)
                .put("trialReplaysChecked", trialPlan != null).put("paidPlanPreserved", true))
        } finally {
            app.getSharedPreferences("genesis.native.auth.v1", Context.MODE_PRIVATE).edit().clear().commit()
            app.activateAccount(null)
            ownerScope?.let { scope ->
                for (kind in listOf("structure", "cloud-base", "habits", "trackers")) app.database.dao().deleteDocument(scope, kind)
                app.database.dao().clearAccountTaskCache(scope); app.database.dao().clearReminders(scope)
                for (row in app.database.dao().outbox(scope)) app.database.dao().acknowledgeOutbox(scope, row.entityId, row.revision, row.operationId)
            }
            cookie = ""; csrf = ""; HttpsURLConnection.setDefaultSSLSocketFactory(previous)
        }
    }
}
