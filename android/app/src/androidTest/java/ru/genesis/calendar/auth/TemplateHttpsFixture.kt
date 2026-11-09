package ru.genesis.calendar.auth

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.data.LocalCipher
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

/** A real Android client and Keystore journal against the existing isolated PHP fixture. */
internal class TemplateHttpsFixture : AutoCloseable {
    val app: Context = InstrumentationRegistry.getInstrumentation().targetContext
    lateinit var client: AuthSessionClient; private set
    var generation = 0L; private set
    lateinit var space: String; private set
    lateinit var project: String; private set
    lateinit var actor: String; private set
    private var previousTls: SSLSocketFactory? = null
    private var cookie = ""
    private var csrf = ""
    private val title = "C1 Android HTTPS ${UUID.randomUUID()}"
    private val journal by lazy { PlanningJournal(PlanningDraftStore(app, "templates"), contract = SharedTemplateJournalContract) }
    fun open() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue("Local HTTPS fixture is opt-in", args.getString("genesisPlanningHttps") == "true")
        check(app.packageName == "ru.genesis.calendar.ghttps.debug" && BuildConfig.DEBUG && AUTH_ORIGIN == "https://localhost:4443")
        val certificate = CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(Base64.getDecoder().decode(requireNotNull(args.getString("genesisFixtureCa")))))
        val trust = KeyStore.getInstance(KeyStore.getDefaultType()).apply { load(null); setCertificateEntry("loopback-fixture", certificate) }
        val managers = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(trust) }
        previousTls = HttpsURLConnection.getDefaultSSLSocketFactory()
        HttpsURLConnection.setDefaultSSLSocketFactory(SSLContext.getInstance("TLS").apply { init(null, managers.trustManagers, null) }.socketFactory)
        check(raw("GET", "/health").getBoolean("fixture"))
        signIn("editor")
        val session = raw("GET", "/api/session")
        check(session.getJSONObject("user").getString("email") == "improvements-editor@example.invalid")
        actor = session.getJSONObject("user").getString("uid"); csrf = AuthProtocol.csrf(session.getString("csrf")); installSession()
        client = AuthSessionClient(app); generation = client.begin()
        assertEquals(actor, client.session(generation).getJSONObject("user").getString("uid"))
        space = raw("POST", "/api/shared/spaces", JSONObject().put("title", title)).getJSONObject("space").getString("id")
        project = client.createSharedProject(generation, space, JSONObject().put("title", "Template library").put("layout", "board")).getJSONObject("project").getString("id")
    }
    private fun signIn(who: String) {
        require(who in setOf("editor", "viewer"))
        val connection = URL("$AUTH_ORIGIN/__fixture/sign-in?actor=$who").openConnection() as HttpsURLConnection
        try {
            connection.instanceFollowRedirects = false; assertEquals(302, connection.responseCode)
            val value = requireNotNull(connection.getHeaderField("Set-Cookie")).substringBefore(';')
            check(value.startsWith("$SESSION_COOKIE=")); cookie = value.substringAfter('=')
            check(cookie.matches(Regex("[A-Za-z0-9,-]{16,256}")))
        } finally { connection.disconnect() }
    }
    private fun installSession() {
        val secret = JSONObject().put("cookie", cookie).put("csrf", csrf).put("expiresAt", System.currentTimeMillis() + 3_600_000)
        check(app.getSharedPreferences("genesis.native.auth.v1", Context.MODE_PRIVATE).edit().putString("session", LocalCipher().encrypt(secret.toString(), "genesis.native.auth.v2")).commit())
    }
    fun <T> viewer(action: (AuthSessionClient, Long) -> T): T {
        val editorCookie = cookie; val editorCsrf = csrf
        try {
            signIn("viewer"); val session = raw("GET", "/api/session")
            check(session.getJSONObject("user").getString("email") == "improvements-viewer@example.invalid")
            csrf = AuthProtocol.csrf(session.getString("csrf")); installSession()
            val viewer = AuthSessionClient(app); val token = viewer.begin(); viewer.session(token)
            return action(viewer, token)
        } finally { cookie = editorCookie; csrf = editorCsrf; installSession() }
    }
    fun raw(method: String, path: String, body: JSONObject? = null): JSONObject {
        check(path.startsWith('/') && !path.contains(".."))
        val connection = URL("$AUTH_ORIGIN$path").openConnection() as HttpsURLConnection
        try {
            connection.instanceFollowRedirects = false; connection.connectTimeout = 15_000; connection.readTimeout = 60_000; connection.requestMethod = method
            if (cookie.isNotEmpty()) connection.setRequestProperty("Cookie", "$SESSION_COOKIE=$cookie")
            if (body != null) {
                connection.setRequestProperty("Content-Type", "application/json")
                if (csrf.isNotEmpty()) connection.setRequestProperty("X-CSRF-Token", csrf)
                connection.doOutput = true; connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            check(connection.responseCode in 200..299) { "Synthetic fixture HTTP ${connection.responseCode}" }
            return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally { connection.disconnect() }
    }
    fun source(id: String, language: String = "ru", deleted: Boolean = false) = client.sharedTemplate(generation, space, id, language, deleted)
    fun preview(id: String, request: JSONObject) = client.previewSharedTemplate(generation, space, id, request)
    fun service(loseReply: (() -> Boolean)? = null) = SharedTemplateDraftService(journal, actor, object : SharedTemplateAccess {
        override fun check() { check(client.currentGeneration() == generation) }
        override fun project(id: String) = client.sharedProject(generation, id).getJSONObject("project")
        override fun source(space: String, id: String, language: String, deleted: Boolean) = client.sharedTemplate(generation, space, id, language, deleted)
        override fun preview(id: String, request: JSONObject) = this@TemplateHttpsFixture.preview(id, request)
        override fun hasTaskQueue() = false
        override fun send(command: JSONObject): JSONObject = client.sharedTemplateCommand(generation, command).also { if (loseReply?.invoke() == true) throw AuthFailure(AuthFailure.Kind.NETWORK) }
    })
    val gateway = object : SharedWorkspaceGateway {
        private suspend fun <T> io(action: () -> T): T = withContext(Dispatchers.IO) { action() }
        override suspend fun sharedProject(projectId: String) = io { client.sharedProject(generation, projectId) }
        override suspend fun sharedTemplates(space: String, language: String, deleted: Boolean, cursor: String?) = io { client.sharedTemplates(generation, space, language, deleted, cursor) }
        override suspend fun sharedTemplate(space: String, id: String, language: String, deleted: Boolean) = io { client.sharedTemplate(generation, space, id, language, deleted) }
        override suspend fun previewSharedTemplate(space: String, id: String, request: JSONObject) = io { preview(id, request) }
        override suspend fun sharedTemplateDraft(project: String) = io { service().load(project) }
        override suspend fun sharedTemplateCopies(project: String) = io { service().copies(project) }
        override suspend fun saveSharedTemplateDraft(project: String, stamp: String?, edit: JSONObject) = io { service().save(project, stamp, edit) }
        override suspend fun prepareSharedTemplateDraft(project: String, stamp: String) = io { service().prepare(project, stamp) }
        override suspend fun sendSharedTemplateDraft(project: String, stamp: String) = io { service().send(project, stamp) }
        override suspend fun removeSharedTemplateDraft(project: String, stamp: String): Unit = io { service().remove(project, stamp) }
        override suspend fun saveSharedTemplateCopy(project: String, id: String, stamp: String?, edit: JSONObject) = io { service().saveCopy(project, id, stamp, edit) }
        override suspend fun useSharedTemplateCopy(project: String, id: String, copyStamp: String, stamp: String?) = io { service().useCopy(project, id, copyStamp, stamp) }
        override suspend fun removeSharedTemplateCopy(project: String, id: String, stamp: String): Unit = io { service().removeCopy(project, id, stamp) }
    }
    override fun close() {
        try {
            if (::space.isInitialized) {
                val current = raw("GET", "/api/shared/spaces/$space").getJSONObject("space"); check(current.getString("title") == title)
                raw("DELETE", "/api/shared/spaces/$space", JSONObject().put("expectedRevision", current.getInt("revision")))
            }
            if (::client.isInitialized) { service().load(project)?.let { service().remove(project, it.getString("stamp")) }; client.clear(client.currentGeneration()) }
        } finally { previousTls?.let(HttpsURLConnection::setDefaultSSLSocketFactory); cookie = ""; csrf = "" }
    }
}
