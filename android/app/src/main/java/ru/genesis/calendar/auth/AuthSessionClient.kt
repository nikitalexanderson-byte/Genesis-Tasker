package ru.genesis.calendar.auth

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import org.json.JSONArray
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.data.LocalCipher
import java.io.ByteArrayOutputStream
import java.net.URL
import java.util.TimeZone
import java.util.UUID
import javax.net.ssl.HttpsURLConnection

internal open class AuthFailure(val kind: Kind, val httpStatus: Int? = null) : Exception("Authentication request failed") {
    enum class Kind { NOT_DEPLOYED, UNAUTHORIZED, RATE_LIMIT, NETWORK, PROTOCOL, STORAGE, CONFLICT, SERVER }
}
internal class AuthApiError(val code: String) : Exception(code)

/** The actual transport guard; keep account routes testable without opening a connection. */
internal fun allowedAuthSessionRoute(method: String, path: String): Boolean =
    path in setOf("/session", "/auth/providers", "/workspace", "/bootstrap", "/stoicheion/draws", "/auth/google/native/challenge",
        "/auth/yandex/native", "/account/yandex-calendar/connect", "/account/yandex-calendar/disconnect",
        "/auth/google/native", "/auth/google/native/services/config", "/auth/google/native/services",
        "/auth/logout", "/account/preferences", "/admin/stats", "/feature-usage") ||
    (path == "/account/email/verification" && method in setOf("GET", "POST")) ||
    (path == "/account/email/verification/dismiss" && method == "POST") ||
    (path == "/account/support-notice" && method == "POST") ||
    (path == "/donations/cloudtips/checkout" && method == "POST") ||
    (path == "/weather/v1/current" && method == "POST") ||
    (path == "/account/plan-guidance" && method == "GET") ||
    (path in setOf("/account/plan-guidance/claim", "/account/plan-guidance/shown", "/account/plan-guidance/read", "/account/plan-guidance/release") && method == "POST") ||
    (method == "GET" && path.matches(Regex("/ads/today\\?language=[a-z]{2}&country=[A-Z]{0,2}&platform=android"))) ||
    (method == "POST" && path in setOf("/advice/today", "/advice/next", "/advice/view", "/advice/dismiss")) ||
    (method == "GET" && path.matches(Regex("/advice/saved\\?id=advice-[a-f0-9]{24}&dayKey=[0-9]{4}-[0-9]{2}-[0-9]{2}&collection=(?:aurora|philosophers)"))) ||
    (path == "/task-lists" && method == "POST") ||
    (method in setOf("PATCH", "DELETE") && path.matches(Regex("/task-lists/[A-Za-z0-9_%.-]{1,1500}"))) ||
    (method in setOf("PUT", "DELETE") && path.matches(Regex("/tasks/[A-Za-z0-9_-]{1,100}"))) ||
    (method == "DELETE" && path.matches(Regex("/admin/users/[A-Za-z0-9_-]{1,100}"))) ||
    (method == "DELETE" && path.matches(Regex("/account/google-accounts/[A-Za-z0-9_-]{1,100}"))) ||
    (method in setOf("GET", "PUT") && path.matches(Regex("/mindmaps(?:/[A-Za-z0-9_-]{1,100}(?:/history)?)?"))) ||
    DiaryProtocol.allowedRoute(method, path) || AuroraProtocol.allowedRoute(method, path) || BackupProtocol.allowedRoute(method,path) || allowedBillingRoute(method, path) || allowedAssistantRoute(method, path) ||
    allowedAdminExtensionRoute(method, path) || allowedSharedRoute(method, path)

internal fun allowedSharedRoute(method: String, path: String): Boolean {
    if (allowedSharedMindmapRoute(method, path)) return true
    if (MessagingProtocol.allowedRoute(method, path)) return true
    if (allowedSharedTaskExtensionRoute(method, path)) return true
    if (path.matches(Regex("/shared/views(?:\\?cursor=[A-Za-z0-9%+_.~*-]+)?"))) return method == "GET" || path == "/shared/views" && method == "POST"
    if (path.matches(Regex("/shared/views/[a-f0-9-]{36}"))) return method in setOf("GET", "PATCH", "DELETE")
    if (path.matches(Regex("/shared/spaces/[a-f0-9-]{36}/custom-fields"))) return method == "PUT"
    if (path.matches(Regex("/shared/spaces/[a-f0-9-]{36}/custom-fields\\?projectId=[a-f0-9-]{36}&archived=(?:true|false)"))) return method == "GET"
    if (path.matches(Regex("/shared/spaces/[a-f0-9-]{36}/custom-fields\\?archived=true"))) return method == "GET"
    if (path.matches(Regex("/shared/spaces/[a-f0-9-]{36}/custom-fields/preview"))) return method == "POST"
    if (path.matches(Regex("/shared/custom-fields/[A-Za-z0-9_-]{1,100}/history"))) return method == "GET"
    val templateLanguage = "(?:ru|en|el|de|fr|es|it|pt|pl|sr|uk|zh|tr|ja)"
    val templateKey = "(?:[a-f0-9-]{36}|system%3A(?:event|publication|launch|control))"
    if (path.matches(Regex("/shared/spaces/[a-f0-9-]{36}/templates\\?language=$templateLanguage&deleted=(?:true|false)(?:&cursor=[A-Za-z0-9%+_.~*-]+)?"))) return method == "GET"
    if (path.matches(Regex("/shared/spaces/[a-f0-9-]{36}/templates"))) return method == "POST"
    if (path.matches(Regex("/shared/spaces/[a-f0-9-]{36}/templates/[a-f0-9-]{36}"))) return method == "PATCH"
    if (path.matches(Regex("/shared/templates/$templateKey\\?language=$templateLanguage&deleted=(?:true|false)"))) return method == "GET"
    if (path.matches(Regex("/shared/templates/$templateKey/(?:preview|apply)"))) return method == "POST"
    if (path.matches(Regex("/shared/spaces/[a-f0-9-]{36}"))) return method == "GET"
    if (path.matches(Regex("/shared/spaces/[a-f0-9-]{36}/members/[A-Za-z0-9_-]{1,100}/project-access"))) return method in setOf("GET", "POST", "PATCH")
    if (path in setOf("/shared/reports", "/shared/reports/check", "/shared/reports/tasks")) return method == "POST"
    if (path in setOf("/shared/spaces", "/shared/invitations", "/shared/invitations/accept",
            "/shared/notifications", "/shared/notifications/read")) return method in setOf("GET", "POST")
    if (method == "GET" && path.matches(Regex("/shared/calendar/tasks\\?from=\\d{4}-\\d{2}-\\d{2}&to=\\d{4}-\\d{2}-\\d{2}"))) return true
    if (method == "GET" && path.matches(Regex("/shared/tasks\\?filter=[A-Za-z0-9%+_.~-]+(?:&cursor=[A-Za-z0-9%+_.~-]+)?(?:&sort=(?:position|createdAt|createdAtAsc|dueDate|updatedAt|title|priority|custom%3A[A-Za-z0-9_-]{1,100}%3A(?:asc|desc)))?"))) return true
    if (path in setOf("/shared/bulk/scope", "/shared/bulk/preview")) return method == "POST"
    if (path.matches(Regex("/shared/bulk(?:\\?cursor=[A-Za-z0-9%+_.~*-]+)?"))) return method == "GET"
    if (path.matches(Regex("/shared/bulk/[a-f0-9-]{36}\\?after=(?:0|[1-9][0-9]{0,15})"))) return method == "GET"
    if (path.matches(Regex("/shared/bulk/[a-f0-9-]{36}/(?:confirm|cancel|advance|resume)"))) return method == "POST"
    if (path.matches(Regex("/shared/views/options\\?kind=(?:projects|statuses|assignees|labels)&filter=[A-Za-z0-9%+_.~*-]+(?:&cursor=[A-Za-z0-9%+_.~*-]+)?"))) return method == "GET"
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/automations\\?deleted=(?:true|false)(?:&cursor=[a-f0-9-]{36})?"))) return method == "GET"
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/automations(?:/preview)?"))) return method == "POST"
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/automations/[a-f0-9-]{36}"))) return method in setOf("GET", "PATCH")
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/automations/[a-f0-9-]{36}/runs(?:\\?cursor=[a-f0-9-]{36})?"))) return method == "GET"
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/automations/[a-f0-9-]{36}/runs/[a-f0-9-]{36}/retry"))) return method == "POST"
    if (path.matches(Regex("/shared/templates/[A-Za-z0-9_%.-]{1,300}\\?language=(?:ru|en|el|de|fr|es|it|pt|pl|sr|uk|zh|tr|ja)"))) return method == "GET"
    if (path == "/shared/notification-settings") return method in setOf("GET", "PUT")
    if (path == "/shared/notification-settings/retry") return method == "POST"
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/tasks/[a-f0-9-]{36}/watch"))) return method in setOf("GET", "PUT")
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/tasks/[a-f0-9-]{36}/convert-checklist"))) return method == "POST"
    if (path.matches(Regex("/shared/invitations/[a-f0-9-]{36}"))) return method == "POST"
    if (path == "/shared/task-lists") return method == "GET"
    if (path.matches(Regex("/shared/spaces/[a-f0-9-]{36}/data-export"))) return method == "POST"
    if (path in setOf("/shared/data/preview?view=native-v1", "/shared/data/apply?view=native-v1")) return method == "POST"
    if (path.matches(Regex("/shared/spaces/[a-f0-9-]{36}/data-imports\\?view=native-v1(?:&cursor=[a-f0-9-]{36})?"))) return method == "GET"
    if (path.matches(Regex("/shared/data-imports/[a-f0-9-]{36}/undo"))) return method == "POST"
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/data-history(?:\\?cursor=[1-9][0-9]{0,17})?"))) return method == "GET"
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/planning"))) return method in setOf("GET", "PUT")
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/workflow"))) return method in setOf("GET", "PUT")
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/workflow/history(?:\\?before=[1-9][0-9]{0,9})?"))) return method == "GET"
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/planning/sprints"))) return method == "POST"
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/planning/sprints/[a-f0-9-]{36}"))) return method == "PATCH"
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/planning/sprints/[a-f0-9-]{36}/transition"))) return method == "POST"
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/planning/sprints/[a-f0-9-]{36}/report(?:/(?:check|sources))?"))) return method == "POST"
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/tasks/[a-f0-9-]{36}\\?archived=true"))) return method == "GET"
    if (path.matches(Regex("/shared/spaces/[a-f0-9-]{36}/ui"))) return method in setOf("GET", "PATCH")
    if (path.matches(Regex("/shared/spaces/[a-f0-9-]{36}/invitations"))) return method == "POST"
    if (path.matches(Regex("/shared/spaces/[a-f0-9-]{36}/projects"))) return method in setOf("GET", "POST")
    if (path.matches(Regex("/shared/spaces/[a-f0-9-]{36}/import-project"))) return method == "POST"
    if (path.matches(Regex("/shared/spaces/[a-f0-9-]{36}/archived-projects"))) return method == "GET"
    if (path.matches(Regex("/shared/spaces/[a-f0-9-]{36}/trash"))) return method == "GET"
    if (path.matches(Regex("/shared/spaces/[a-f0-9-]{36}/members/[A-Za-z0-9_-]{1,100}"))) return method == "POST"
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}"))) return method in setOf("GET", "POST")
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/google"))) return method in setOf("GET", "POST")
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/google/sync"))) return method == "POST"
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/(archive|restore)"))) return method == "POST"
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/statuses"))) return method == "POST"
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/statuses/[a-f0-9-]{36}"))) return method in setOf("POST", "DELETE")
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/categories"))) return method == "POST"
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/categories/[a-f0-9-]{36}"))) return method in setOf("POST", "DELETE")
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/members/[A-Za-z0-9_-]{1,100}"))) return method in setOf("POST", "DELETE")
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/(tasks|invitations)"))) return method == "POST"
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/tasks/[a-f0-9-]{36}"))) return method in setOf("GET", "POST")
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/tasks/[a-f0-9-]{36}/move"))) return method == "POST"
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/tasks/[a-f0-9-]{36}/read"))) return method == "POST"
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/tasks/[a-f0-9-]{36}/comments"))) return method in setOf("GET", "POST")
    if (path.matches(Regex("/shared/projects/[a-f0-9-]{36}/tasks/[a-f0-9-]{36}/comments\\?before=[a-f0-9-]{36}"))) return method == "GET"
    return false
}

/** A dedicated, encrypted native cookie jar; never shared with Custom Tabs or the local drafts DB. */
internal class AuthSessionClient(context: Context) {
    private val backupEpoch=NativeBackupEpochStore(context)
    private val transportEpoch=NativeBackupEpoch.current()
    private val backupApplication=context.applicationContext as? ru.genesis.calendar.GenesisApplication
    private val preferences = context.getSharedPreferences("genesis.native.auth.v1", Context.MODE_PRIVATE)
    private val installationId: String by lazy {
        val install = context.getSharedPreferences("genesis.native.install.v1", Context.MODE_PRIVATE)
        install.getString("id", null) ?: UUID.randomUUID().toString().also {
            install.edit().putString("id", it).apply()
        }
    }
    private val cipher = LocalCipher()
    // The encryption context stays stable when the service moves to another domain.
    private val aad = "genesis.native.auth.v2"
    private val legacyAad = "genesis.native.auth.v1|https://genesiscalendar.ru"
    private val guard = Any()
    private var generation = 0L
    private var trialForeground = false
    private var trialEpoch = 0L
    private val trialReceipts = java.util.WeakHashMap<JSONObject, LiveAccountReceipt>()
    private val trialProfileOrder = TrialProfileOrder()

    fun setTrialForeground(active: Boolean) = synchronized(guard) {
        trialForeground = active
        trialEpoch++
        // Receipts still reject stale whole profiles; their trial proofs lose the old epoch.
    }

    fun liveReceipt(response: JSONObject): LiveAccountReceipt? = synchronized(guard) { trialReceipts[response] }
    fun isTrialForeground(): Boolean = synchronized(guard) { trialForeground }

    private fun registerLiveProfile(expected: Long, epoch: Long, started: Long, sequence: Long, payload: JSONObject) {
        val user = payload.optJSONObject("user") ?: return
        val uid = user.optString("uid").takeIf { it.isNotBlank() } ?: return
        val access = user.optJSONObject("featureAccess")
        val trial = runCatching { TrialAccess.fromJson(access?.optJSONObject("trial")) }.getOrNull()
        val evaluated = runCatching { java.time.Instant.parse(access?.getString("evaluatedAt")) }.getOrNull()
        val serverNow = trial?.serverNow
        val now = if (serverNow == null) evaluated else evaluated?.let { if (it.isAfter(serverNow)) it else serverNow } ?: serverNow
        synchronized(guard) {
            check(expected)
            val stamp = trialProfileOrder.accept(uid, sequence, now, trial)
                ?: throw CancellationException("Authenticated profile superseded")
            val currentProfile = { synchronized(guard) { generation == expected && trialProfileOrder.isCurrent(stamp) } }
            val proof = if (trialForeground && trialEpoch == epoch && access?.optString("source") == "trial" &&
                trial?.status == "active" && now != null) TrialLiveProof(uid, now, started, trial,
                    { synchronized(guard) { currentProfile() && trialForeground && trialEpoch == epoch } }) else null
            trialReceipts[payload] = LiveAccountReceipt(uid, proof, currentProfile)
        }
    }
    private var loaded = false
    private var session = SessionSecret("", 0, "")
    private val connections = mutableSetOf<HttpsURLConnection>()

    fun begin(): Long {
        val (next, obsolete) = synchronized(guard) {
            trialProfileOrder.invalidate()
            trialReceipts.clear()
            ++generation to connections.toList()
        }
        // Cancel the actual socket too: a superseded slow Google pull must not
        // hold the account's import lock until its read timeout expires.
        obsolete.forEach { runCatching { it.disconnect() } }
        return next
    }
    fun currentGeneration(): Long = synchronized(guard) { generation }
    fun isCurrent(expected: Long): Boolean = synchronized(guard) { generation == expected && transportEpoch==NativeBackupEpoch.current() }

    private fun check(expected: Long) {
        if (generation != expected||transportEpoch!=NativeBackupEpoch.current()) throw CancellationException("Authentication operation superseded")
    }

    private fun load(expected: Long): SessionSecret = synchronized(guard) {
        check(expected)
        if (!loaded) {
            try {
                preferences.getString("session", null)?.let {
                    val plain = runCatching { cipher.decrypt(it, aad) }
                        .getOrElse { _ -> cipher.decrypt(it, legacyAad) }
                    val saved = JSONObject(plain)
                    val value = saved.getString("cookie")
                    require(value.matches(Regex("[A-Za-z0-9,-]{16,256}")))
                    session = SessionSecret(value, saved.getLong("expiresAt"), AuthProtocol.csrf(saved.getString("csrf")))
                }
                loaded = true
            } catch (_: Exception) {
                session = SessionSecret("", 0, "")
                loaded = true
                preferences.edit().remove("session").commit()
                throw AuthFailure(AuthFailure.Kind.STORAGE)
            }
        }
        if (session.expiresAt <= System.currentTimeMillis()) session = SessionSecret("", 0, "")
        session
    }

    private fun save(expected: Long, value: SessionSecret) = synchronized(guard) {
        check(expected)
        try {
            val editor = preferences.edit()
            if (value.cookie.isBlank() || value.csrf.isBlank()) editor.remove("session")
            else editor.putString("session", cipher.encrypt(JSONObject().put("cookie", value.cookie)
                .put("expiresAt", value.expiresAt).put("csrf", value.csrf).toString(), aad))
            if (!editor.commit()) throw AuthFailure(AuthFailure.Kind.STORAGE)
            session = value
            loaded = true
        } catch (error: Exception) {
            session = SessionSecret("", 0, "")
            preferences.edit().remove("session").commit()
            throw if (error is AuthFailure) error else AuthFailure(AuthFailure.Kind.STORAGE)
        }
    }

    fun clear(expected: Long) {
        synchronized(guard) { check(expected); trialEpoch++; trialReceipts.clear(); trialProfileOrder.invalidate() }
        save(expected, SessionSecret("", 0, ""))
    }

    /** Returns the old secret only to revoke that same server session after local logout. */
    fun takeForLogout(expected: Long): SessionSecret {
        val old = load(expected)
        clear(expected)
        return old
    }

    fun session(expected: Long): JSONObject = request(expected, "/session", null)
    fun providers(expected: Long): JSONObject = request(expected, "/auth/providers", null)
    fun dailyAdvice(expected: Long, context: JSONObject, timeZone: String? = null): JSONObject =
        request(expected, "/advice/today", JSONObject(context.toString()).put("maxDailyCards", 9), timeZone = timeZone)
    fun savedDailyAdvice(expected: Long, id: String, day: String, collection: String): JSONObject =
        request(expected, DailyAdviceProtocol.savedPath(id, day, collection), null)
    fun nextDailyAdvice(expected: Long, context: JSONObject, id: String, day: String): JSONObject =
        request(expected, "/advice/next", JSONObject(context.toString()).put("fromId", id).put("dayKey", day).put("maxDailyCards", 9))
    fun recordAdvice(expected: Long, id: String, day: String, dismiss: Boolean): JSONObject =
        request(expected, if (dismiss) "/advice/dismiss" else "/advice/view", DailyAdviceProtocol.record(id, day))
    fun workspace(expected: Long): JSONObject = request(expected, "/workspace", null)
    fun donationCheckout(expected: Long): JSONObject = request(expected, "/donations/cloudtips/checkout", JSONObject())
    fun weather(expected: Long, location: ru.genesis.calendar.domain.WeatherRequestV1, call: ForegroundAccountCall): JSONObject =
        request(expected, "/weather/v1/current", location.json(), foregroundCall = call)
    fun planGuidance(expected: Long, path: String, body: JSONObject?, call: ForegroundAccountCall): JSONObject {
        require(path == "/account/plan-guidance" && body == null ||
            path in setOf("/account/plan-guidance/claim", "/account/plan-guidance/shown", "/account/plan-guidance/read") && body != null)
        return request(expected, path, body, foregroundCall = call)
    }
    fun releasePlanGuidance(expected: Long, token: String): JSONObject =
        request(expected, "/account/plan-guidance/release", JSONObject().put("token", token))
    fun backup(expected: Long,method: String,path: String,body: JSONObject?): JSONObject {
        require(BackupProtocol.allowedRoute(method,path))
        return request(expected,path,body,method=method)
    }
    fun aurora(expected: Long, method: String, path: String, body: JSONObject?): JSONObject {
        require(AuroraProtocol.allowedRoute(method, path))
        return request(expected, path, body, method=method)
    }
    fun billing(expected:Long,method:String,path:String,body:JSONObject?=null):JSONObject {
        require(allowedBillingRoute(method,path))
        return request(expected,path,body,method=method)
    }
    fun habitReminderStatus(expected: Long): JSONObject = request(expected, "/habit-reminders/status", null)
    fun mindmaps(expected: Long, path:String, body:JSONObject?=null):JSONObject = request(expected,path,body,method=if(body==null)"GET" else "PUT")
    fun diary(expected: Long, path: String, body: JSONObject? = null, method: String = if (body == null) "GET" else "PUT"): JSONObject {
        require(DiaryProtocol.allowedRoute(method, path))
        return request(expected, path, body, method = method)
    }

    fun putWorkspace(expected: Long, envelope: JSONObject): JSONObject =
        request(expected, "/workspace", envelope, method = "PUT")
    fun bootstrap(expected: Long): JSONObject = request(expected, "/bootstrap", null)
    /** Account entry must not wait for Google task-list enumeration. */
    fun accountBootstrap(expected: Long, verifiedSession: JSONObject): JSONObject =
        JSONObject(verifiedSession.toString())
            .put("workspace", workspace(expected).getJSONObject("workspace"))
            .put("tasks", JSONArray()).put("tasksDeferred", true).also { composite ->
                // This copy retains only the original live response's clock; it does not renew it.
                synchronized(guard) {
                    check(expected)
                    trialReceipts[verifiedSession]?.let { trialReceipts[composite] = it }
                }
            }
    fun stoicheionDraws(expected: Long): JSONObject = request(expected, "/stoicheion/draws", null)
    fun saveStoicheionDraw(expected: Long, kind: String, seed: Long): JSONObject {
        require(kind in setOf("daily", "spread", "timeline")) { "Неизвестный вид расклада." }
        require(seed in 0..0xffff_ffffL)
        return request(expected, "/stoicheion/draws", JSONObject().put("kind", kind).put("seed", seed))
    }
    fun putTask(expected: Long, id: String, task: JSONObject): JSONObject {
        val creation=if(task.optBoolean("mindmapCreateOnly")) task.optJSONObject("mindmapCreationPayload") ?: task else task
        val mutation = CloudTaskIdentity.mutation(id, creation)
        if(task.optBoolean("mindmapCreateOnly")) mutation.body.put("createOnly",true)
        return mutation.confirmed(request(expected, "/tasks/${mutation.remoteId}", mutation.body, method = "PUT"))
    }
    fun deleteTask(expected: Long, id: String, task: JSONObject): JSONObject {
        val mutation = CloudTaskIdentity.mutation(id, task)
        return request(expected, "/tasks/${mutation.remoteId}", mutation.body, method = "DELETE")
    }
    fun createTaskList(expected: Long, title: String, accountId: String): JSONObject {
        require(title.trim().length in 1..300 && accountId.matches(Regex("[A-Za-z0-9_-]{1,100}")))
        return request(expected, "/task-lists", JSONObject().put("title", title.trim()).put("accountId", accountId))
    }
    fun updateTaskList(expected: Long, id: String, title: String, accountId: String): JSONObject {
        require(id.isNotBlank() && id.length <= 500 && title.trim().length in 1..300)
        return request(expected, "/task-lists/${android.net.Uri.encode(id)}",
            JSONObject().put("title",title.trim()).put("accountId",accountId),method="PATCH")
    }
    fun deleteTaskList(expected: Long, id: String, accountId: String): JSONObject {
        require(id.isNotBlank() && id.length <= 500)
        return request(expected, "/task-lists/${android.net.Uri.encode(id)}",
            JSONObject().put("accountId",accountId),method="DELETE")
    }
    fun challenge(expected: Long): JSONObject = request(expected, "/auth/google/native/challenge", JSONObject())
    fun googleServicesConfig(expected: Long): JSONObject =
        request(expected, "/auth/google/native/services/config", JSONObject())
    fun authorizeGoogleServices(expected: Long, serverAuthCode: String): JSONObject {
        require(serverAuthCode.length in 1..8192)
        return request(expected, "/auth/google/native/services",
            JSONObject().put("serverAuthCode", serverAuthCode))
    }
    fun updateRouting(expected: Long, routing: SyncRouting): JSONObject =
        request(expected, "/account/preferences", JSONObject().put("syncRouting", routing.toJson()), method = "PUT")
    fun updatePreferences(expected: Long, changes: JSONObject): JSONObject =
        request(expected, "/account/preferences", changes, method = "PUT")
    fun emailVerification(expected: Long, send: Boolean, dismiss: Boolean = false): JSONObject =
        request(expected, if(dismiss) "/account/email/verification/dismiss" else "/account/email/verification", if(send||dismiss) JSONObject() else null)
    fun claimSupportNotice(expected:Long,surface:String):JSONObject{
        require(surface in setOf("android","phone"))
        return request(expected,"/account/support-notice",JSONObject().put("surface",surface))
    }
    fun sharedSpaceUi(expected: Long, spaceId: String): JSONObject =
        request(expected, "/shared/spaces/$spaceId/ui", null)
    fun saveSharedSpaceUi(expected: Long, spaceId: String, ids: List<String>): JSONObject =
        request(expected, "/shared/spaces/$spaceId/ui", JSONObject().put("expandedIds", JSONArray(ids)), method = "PATCH")
    fun inviteSharedSpaceMember(expected: Long, spaceId: String, email: String, role: String): JSONObject =
        request(expected, "/shared/spaces/$spaceId/invitations", JSONObject().put("email", email).put("role", role))
    fun sharedSpaces(expected: Long): JSONObject = request(expected, "/shared/spaces", null)
    fun sharedFieldDefinitions(expected: Long, space: String, project: String, archived: Boolean): JSONObject =
        CustomFieldDefinitionProtocol.catalog(space, project, request(expected,
            "/shared/spaces/${SharedTemplateProtocol.id(space)}/custom-fields?projectId=${SharedTemplateProtocol.id(project)}&archived=$archived", null), archived)
    fun sharedFieldHistory(expected: Long, space: String, id: String): JSONObject {
        SharedTemplateProtocol.id(space)
        return CustomFieldDefinitionProtocol.history(space, id, request(expected, "/shared/custom-fields/${CustomFieldProtocol.id(id)}/history", null))
    }
    fun previewSharedFieldDefinition(expected: Long, space: String, project: String, body: JSONObject): JSONObject {
        SharedTemplateProtocol.id(space); SharedTemplateProtocol.id(project)
        val snapshot = JSONObject(body.toString())
        return CustomFieldDefinitionProtocol.preview(space, project, snapshot,
            request(expected, "/shared/spaces/$space/custom-fields/preview", snapshot))
    }
    fun sharedFieldEditorContext(expected: Long, space: String, project: String): JSONObject {
        CustomFieldProtocol.id(space); CustomFieldProtocol.id(project)
        val raw = sharedProject(expected, project); val child = raw.getJSONObject("project")
        val data = JSONObject().put("project", child).put("space", JSONObject().put("id", child.getString("spaceId")).put("role", child.getString("spaceRole")))
        require(!raw.optBoolean("offlineCache")) { "CUSTOM_FIELD_SCOPE_CHANGED" }
        CustomFieldEditorProtocol.authorize(space, project, data)
        return data
    }
    fun saveSharedFieldDefinition(expected: Long, space: String, payload: JSONObject): JSONObject =
        request(expected, "/shared/spaces/${CustomFieldProtocol.id(space)}/custom-fields", payload, method = "PUT")
    fun sharedTaskLists(expected: Long): JSONObject = request(expected, "/shared/task-lists", null)
    fun sharedSavedViews(expected: Long, cursor: String?): JSONObject = SavedViewProtocol.page(request(expected,
        "/shared/views" + (cursor?.let { "?cursor=" + java.net.URLEncoder.encode(it, "UTF-8") } ?: ""), null))
    fun sharedSavedView(expected: Long, id: String): JSONObject = SavedViewProtocol.view(request(expected,
        "/shared/views/${CustomFieldProtocol.id(id)}", null).getJSONObject("view")).also { require(it.getString("id") == id) { "VIEW_PROTOCOL" } }
    fun sharedSavedViewFields(expected: Long, space: String): JSONObject {
        val response = request(expected, "/shared/spaces/${CustomFieldProtocol.id(space)}/custom-fields?archived=true", null)
        val fields = response.getJSONArray("fields"); val ids = mutableSetOf<String>()
        for (index in 0 until fields.length()) {
            val field = fields.getJSONObject(index)
            val parsed = CustomFieldProtocol.definitions(space, field.optString("projectId").takeUnless { it == "null" || it.isBlank() } ?: SavedViewProtocol.SCOPE, JSONArray().put(field)).single()
            require(ids.add(parsed.getString("id"))) { "CUSTOM_FIELD_PROTOCOL" }; fields.put(index, parsed)
        }
        return response
    }
    fun sendSharedSavedView(expected: Long, command: JSONObject): JSONObject {
        val kind = command.getString("kind")
        require(kind in setOf("view-create", "view-update", "view-delete")) { "VIEW_INVALID" }
        val path = "/shared/views" + (if (kind == "view-create") "" else "/${CustomFieldProtocol.id(command.getString("sprintId"))}")
        return request(expected, path, command.getJSONObject("body"), method = when (kind) { "view-create" -> "POST"; "view-delete" -> "DELETE"; else -> "PATCH" })
    }
    fun sharedCalendarTasks(expected: Long, from: String, to: String): JSONObject =
        request(expected, "/shared/calendar/tasks?from=$from&to=$to", null)
    fun createSharedSpace(expected: Long, body: JSONObject): JSONObject =
        request(expected, "/shared/spaces", body)
    fun sharedProjects(expected: Long, spaceId: String): JSONObject =
        request(expected, "/shared/spaces/$spaceId/projects", null)
    fun archivedSharedProjects(expected: Long, spaceId: String): JSONObject =
        request(expected, "/shared/spaces/$spaceId/archived-projects", null)
    fun createSharedProject(expected: Long, spaceId: String, body: JSONObject): JSONObject =
        request(expected, "/shared/spaces/$spaceId/projects", body)
    fun importSharedProject(expected: Long, spaceId: String, body: JSONObject): JSONObject =
        request(expected, "/shared/spaces/$spaceId/import-project", body)
    fun querySharedTasks(expected: Long, filter: JSONObject, cursor: String?,sort:String="position"): JSONObject {
        val query = java.net.URLEncoder.encode(filter.toString(), "UTF-8")
        val continuation = cursor?.let { "&cursor=" + java.net.URLEncoder.encode(it, "UTF-8") } ?: ""
        return request(expected, "/shared/tasks?filter=$query$continuation&sort=${java.net.URLEncoder.encode(sort,"UTF-8")}", null)
    }
    fun sharedAutomations(expected: Long, project: String, deleted: Boolean, cursor: String?): JSONObject = SharedAutomationProtocol.list(request(expected,
        "/shared/projects/${SharedAutomationProtocol.id(project)}/automations?deleted=$deleted" + (cursor?.let { "&cursor=${SharedAutomationProtocol.id(it)}" } ?: ""), null), project)
    fun sharedAutomation(expected: Long, project: String, rule: String): JSONObject {
        val response = request(expected, "/shared/projects/${SharedAutomationProtocol.id(project)}/automations/${SharedAutomationProtocol.id(rule)}", null)
        require(response.keys().asSequence().toSet() == setOf("rule")) { "AUTOMATION_PROTOCOL" }
        return JSONObject().put("rule", SharedAutomationProtocol.rule(response.getJSONObject("rule"), project).also { require(it.getString("id") == rule) { "AUTOMATION_SCOPE_CHANGED" } })
    }
    fun sharedAutomationRuns(expected: Long, project: String, rule: String, cursor: String?): JSONObject = SharedAutomationProtocol.runs(request(expected,
        "/shared/projects/${SharedAutomationProtocol.id(project)}/automations/${SharedAutomationProtocol.id(rule)}/runs" + (cursor?.let { "?cursor=${SharedAutomationProtocol.id(it)}" } ?: ""), null), rule)
    fun sharedAutomationCommand(expected: Long, project: String, rule: String, run: String?, body: JSONObject): JSONObject = request(expected,
        "/shared/projects/${SharedAutomationProtocol.id(project)}/automations/${SharedAutomationProtocol.id(rule)}" + (run?.let { "/runs/${SharedAutomationProtocol.id(it)}/retry" } ?: ""),
        body, method = if (run == null) "PATCH" else "POST")
    fun saveSharedAutomation(expected: Long, project: String, rule: String?, payload: JSONObject): JSONObject = request(expected,
        "/shared/projects/${SharedAutomationProtocol.id(project)}/automations" + (rule?.let { "/${SharedAutomationProtocol.id(it)}" } ?: ""),
        payload, method = if (rule == null) "POST" else "PATCH")
    fun previewSharedAutomation(expected: Long, project: String, definition: JSONObject, owner: String, task: String?): JSONObject =
        SharedAutomationProtocol.preview(request(expected, "/shared/projects/${SharedAutomationProtocol.id(project)}/automations/preview",
            JSONObject().put("definition", SharedAutomationProtocol.definition(definition)).put("ownerId", SharedAutomationProtocol.id(owner))
                .put("taskId", task?.let(SharedAutomationProtocol::id) ?: JSONObject.NULL)), owner, task)
    fun sharedAutomationTemplate(expected: Long, template: String, language: String): JSONObject {
        require(language in setOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"))
        val raw = request(expected, "/shared/templates/" + java.net.URLEncoder.encode(SharedAutomationProtocol.templateId(template), "UTF-8") + "?language=$language", null).getJSONObject("template")
        require(raw.optString("id") == template && raw.optString("kind") == "task" && raw.opt("title") is String && raw.getString("title").length <= 5000) { "AUTOMATION_PROTOCOL" }
        return JSONObject().put("id", template).put("title", raw.getString("title"))
    }
    fun sharedBulkScope(expected: Long, selection: JSONObject, cursor: String?): JSONObject = SharedBulkProtocol.scope(request(expected,
        "/shared/bulk/scope", JSONObject().put("selection", SharedBulkProtocol.selection(selection)).apply { if (cursor != null) put("cursor", SharedBulkProtocol.cursor(cursor)) }))
    fun sharedBulkPreview(expected: Long, body: JSONObject): JSONObject = SharedBulkProtocol.report(request(expected, "/shared/bulk/preview", body))
    fun sharedBulkReport(expected: Long, id: String, after: Long): JSONObject {
        require(after in 0..9_007_199_254_740_991L)
        return SharedBulkProtocol.report(request(expected, "/shared/bulk/${SharedBulkProtocol.operation(id)}?after=$after", null), id, after)
    }
    fun sharedBulkHistory(expected: Long, cursor: String?): JSONObject = SharedBulkProtocol.history(request(expected, "/shared/bulk" +
        (SharedBulkProtocol.cursor(cursor)?.let { "?cursor=" + java.net.URLEncoder.encode(it, "UTF-8") } ?: ""), null))
    fun sharedBulkCommand(expected: Long, id: String, command: String, after: Long): JSONObject {
        require(command in SharedBulkProtocol.commands && after in 0..9_007_199_254_740_991L)
        return SharedBulkProtocol.report(request(expected, "/shared/bulk/${SharedBulkProtocol.operation(id)}/$command", JSONObject().put("after", after)), id, after)
    }
    fun sharedBulkOptions(expected: Long, kind: String, filter: JSONObject, cursor: String?): JSONObject {
        require(kind in setOf("projects", "statuses", "assignees", "labels") && filter.keys().asSequence().all { it in setOf("projectIds", "spaceId") })
        return SharedBulkProtocol.options(request(expected, "/shared/views/options?kind=$kind&filter=" + java.net.URLEncoder.encode(filter.toString(), "UTF-8") +
            (SharedBulkProtocol.cursor(cursor)?.let { "&cursor=" + java.net.URLEncoder.encode(it, "UTF-8") } ?: ""), null))
    }
    fun readSharedTaskUpdates(expected:Long,projectId:String,taskId:String,commentIds:List<String>):JSONObject=
        request(expected,"/shared/projects/$projectId/tasks/$taskId/read",JSONObject().put("commentIds",org.json.JSONArray(commentIds)))
    fun notificationSettings(expected:Long):JSONObject=request(expected,"/shared/notification-settings",null)
    fun convertSharedChecklist(expected:Long,project:String,task:String,item:String,revision:Int,requestId:String):JSONObject = request(expected,
        "/shared/projects/${SharedTemplateProtocol.id(project)}/tasks/${SharedTemplateProtocol.id(task)}/convert-checklist",
        JSONObject().put("itemId",item).put("expectedRevision",revision).put("requestId",SharedTemplateProtocol.id(requestId)))
    fun sharedTaskWatch(expected:Long,project:String,task:String,watching:Boolean?):JSONObject = request(expected,
        "/shared/projects/${SharedTemplateProtocol.id(project)}/tasks/${SharedTemplateProtocol.id(task)}/watch",
        watching?.let { JSONObject().put("watching",it) },method=if(watching==null)"GET" else "PUT")
    fun saveNotificationSettings(expected:Long,settings:JSONObject,revision:Int):JSONObject=
        request(expected,"/shared/notification-settings",JSONObject().put("settings",settings).put("expectedRevision",revision),method="PUT")
    fun sharedTask(expected: Long, projectId: String, taskId: String): JSONObject =
        // Explicit task links (including bulk/history results) can refer to an archived task.
        // The API still applies the current project ACL; archived cards remain read-only.
        request(expected, "/shared/projects/$projectId/tasks/$taskId?archived=true", null)
    fun sharedProject(expected: Long, projectId: String): JSONObject =
        request(expected, "/shared/projects/$projectId", null)
    fun sharedPlanning(expected: Long, projectId: String): JSONObject =
        request(expected, "/shared/projects/$projectId/planning", null)
    fun sharedTemplates(expected: Long, space: String, language: String, deleted: Boolean, cursor: String?): JSONObject {
        val path = "/shared/spaces/${SharedTemplateProtocol.id(space)}/templates?language=${SharedTemplateProtocol.language(language)}&deleted=$deleted" +
            (SharedTemplateProtocol.cursor(cursor)?.let { "&cursor=${java.net.URLEncoder.encode(it, "UTF-8")}" } ?: "")
        return request(expected, path, null)
    }
    private fun templatePath(id: String): String = "/shared/templates/" + java.net.URLEncoder.encode(SharedTemplateProtocol.templateId(id), "UTF-8")
    fun sharedTemplate(expected: Long, space: String, id: String, language: String, deleted: Boolean): JSONObject =
        SharedTemplateProtocol.source(space, id, request(expected, "${templatePath(id)}?language=${SharedTemplateProtocol.language(language)}&deleted=$deleted", null).getJSONObject("template"))
    fun previewSharedTemplate(expected: Long, space: String, id: String, input: JSONObject): JSONObject =
        SharedTemplateProtocol.preview(space, id, input, request(expected, "${templatePath(id)}/preview", SharedTemplateProtocol.options(input)))
    fun sharedTemplateCommand(expected: Long, command: JSONObject): JSONObject {
        val body = command.getJSONObject("body"); val space = SharedTemplateProtocol.id(body.getString("spaceId"))
        val input = body.getJSONObject("request")
        require(input.getString("operationId") == body.getString("requestId")) { "TEMPLATE_DRAFT_INVALID" }
        val response = when (command.getString("kind")) {
            "template-save" -> {
                val suffix = if (command.isNull("sprintId")) "" else "/${SharedTemplateProtocol.id(command.getString("sprintId"))}"
                request(expected, "/shared/spaces/$space/templates$suffix", input, method = if (suffix.isEmpty()) "POST" else "PATCH")
            }
            "template-apply" -> request(expected, "${templatePath(command.getString("sprintId"))}/apply", input)
            else -> throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        }
        return SharedTemplateProtocol.receipt(command, response)
    }
    fun sharedSprintReport(expected: Long, projectId: String, sprintId: String, unit: String): JSONObject {
        require(unit in SprintReportProtocol.units)
        return request(expected, "/shared/projects/$projectId/planning/sprints/$sprintId/report", JSONObject().put("unit", unit))
    }
    fun checkSharedSprintReport(expected: Long, projectId: String, sprintId: String, token: String): JSONObject =
        request(expected, "/shared/projects/$projectId/planning/sprints/$sprintId/report/check", JSONObject().put("token", token))
    fun sharedSprintReportSources(expected: Long, projectId: String, sprintId: String, token: String, query: JSONObject, cursor: String?): JSONObject {
        val selection = SprintReportProtocol.query(query.getString("kind"), query.optString("metric", "scope"), query.optString("date").takeIf { it.isNotEmpty() })
        val body = JSONObject(selection.toString()).put("token", token)
        if (cursor != null) { require(cursor.length in 1..32000); body.put("cursor", cursor) }
        return request(expected, "/shared/projects/$projectId/planning/sprints/$sprintId/report/sources", body)
    }
    fun sharedSprintSourceTask(expected: Long, projectId: String, taskId: String, archived: Boolean): JSONObject =
        request(expected, "/shared/projects/$projectId/tasks/$taskId" + if (archived) "?archived=true" else "", null)
    fun sharedWorkflow(expected: Long, projectId: String): JSONObject = request(expected, "/shared/projects/$projectId/workflow", null)
    fun sharedWorkflowRepairProjects(expected: Long, spaceId: String): JSONObject = request(expected, "/shared/spaces/$spaceId/trash", null)
    fun sharedWorkflowHistory(expected: Long, projectId: String, before: Long?): JSONObject =
        request(expected, "/shared/projects/$projectId/workflow/history" + (before?.let { "?before=$it" } ?: ""), null)
    fun saveSharedWorkflow(expected: Long, projectId: String, body: JSONObject): JSONObject =
        request(expected, "/shared/projects/$projectId/workflow", body, method = "PUT")
    fun sharedPlanningCommand(expected: Long, projectId: String, command: JSONObject): JSONObject {
        val path = "/shared/projects/$projectId/planning"
        val body = command.getJSONObject("body")
        return when (command.getString("kind")) {
            "settings" -> request(expected, path, body, method = "PUT")
            "sprint" -> if (command.isNull("sprintId")) request(expected, "$path/sprints", body)
                else request(expected, "$path/sprints/${command.getString("sprintId")}", body, method = "PATCH")
            "transition" -> request(expected, "$path/sprints/${command.getString("sprintId")}/transition", body)
            else -> throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        }
    }
    fun sharedGoogleSettings(expected: Long, projectId: String): JSONObject =
        request(expected, "/shared/projects/$projectId/google", null)
    fun updateSharedGoogleSettings(expected: Long, projectId: String, body: JSONObject): JSONObject =
        request(expected, "/shared/projects/$projectId/google", body)
    fun syncSharedGoogle(expected: Long, projectId: String): JSONObject =
        request(expected, "/shared/projects/$projectId/google/sync", JSONObject())
    fun updateSharedProject(expected: Long, projectId: String, body: JSONObject): JSONObject =
        request(expected, "/shared/projects/$projectId", body)
    fun exportSharedData(expected: Long, spaceId: String, input: JSONObject): JSONObject {
        val command = DataExportProtocol.command(spaceId, input)
        return request(expected, "/shared/spaces/$spaceId/data-export", command,
            responseReader = { DataExportStream.read(it, command.getString("format")) })
    }
    fun sharedProjectAccessMembers(expected: Long, space: String): JSONObject = ProjectAccessProtocol.members(space, request(expected, "/shared/spaces/${ProjectAccessProtocol.id(space)}", null))
    fun sharedProjectAccess(expected: Long, space: String, user: String): JSONObject = ProjectAccessProtocol.snapshot(space, user,
        request(expected, "/shared/spaces/${ProjectAccessProtocol.id(space)}/members/${ProjectAccessProtocol.id(user)}/project-access", null))
    fun previewSharedProjectAccess(expected: Long, space: String, user: String, draft: JSONObject): JSONObject =
        request(expected, "/shared/spaces/${ProjectAccessProtocol.id(space)}/members/${ProjectAccessProtocol.id(user)}/project-access", ProjectAccessProtocol.draft(draft, true))
    fun saveSharedProjectAccess(expected: Long, space: String, user: String, body: JSONObject): JSONObject =
        request(expected, "/shared/spaces/${ProjectAccessProtocol.id(space)}/members/${ProjectAccessProtocol.id(user)}/project-access", body, method = "PATCH")
    fun sharedTeamReport(expected: Long, options: JSONObject): JSONObject = request(expected, "/shared/reports", TeamReportProtocol.options(options))
    fun checkSharedTeamReport(expected: Long, token: String): JSONObject = request(expected, "/shared/reports/check", JSONObject().put("token", TeamReportProtocol.token(token)))
    fun sharedTeamReportTasks(expected: Long, token: String, metric: String, cursor: String?): JSONObject {
        require(metric.isNotBlank() && metric.length <= 300 && (cursor == null || cursor.isNotBlank() && cursor.length < 4096))
        return request(expected, "/shared/reports/tasks", JSONObject().put("token", TeamReportProtocol.token(token)).put("metric", metric).put("cursor", cursor ?: JSONObject.NULL))
    }
    fun previewSharedData(expected: Long, selection: JSONObject, content: String): JSONObject {
        val command = DataImportProtocol.selection(selection)
        return request(expected, "/shared/data/preview?view=native-v1", command, importBody = DataImportBody(command, content))
    }
    fun applySharedData(expected: Long, selection: JSONObject, content: String, operation: String, fingerprint: String): JSONObject {
        require(PlanningLifecycle.id(operation) && fingerprint.matches(Regex("[a-f0-9]{64}")))
        val command = DataImportProtocol.selection(selection).put("operationId", operation).put("fingerprint", fingerprint)
        return request(expected, "/shared/data/apply?view=native-v1", command, importBody = DataImportBody(command, content))
    }
    fun sharedDataImports(expected: Long, space: String, cursor: String?): JSONObject {
        require(PlanningLifecycle.id(space) && (cursor == null || PlanningLifecycle.id(cursor)))
        return request(expected, "/shared/spaces/$space/data-imports?view=native-v1" + (cursor?.let { "&cursor=$it" } ?: ""), null)
    }
    fun undoSharedData(expected: Long, import: String): JSONObject {
        require(PlanningLifecycle.id(import)); return request(expected, "/shared/data-imports/$import/undo", JSONObject())
    }
    fun sharedDataHistory(expected: Long, project: String, cursor: String?): JSONObject {
        require(PlanningLifecycle.id(project) && (cursor == null || cursor.matches(Regex("[1-9][0-9]{0,17}"))))
        return request(expected, "/shared/projects/$project/data-history" + (cursor?.let { "?cursor=$it" } ?: ""), null)
    }
    fun setSharedProjectArchived(expected: Long, projectId: String, archived: Boolean): JSONObject =
        request(expected, "/shared/projects/$projectId/${if (archived) "archive" else "restore"}", JSONObject())
    fun createSharedStatus(expected: Long, projectId: String, body: JSONObject): JSONObject =
        request(expected, "/shared/projects/$projectId/statuses", body)
    fun updateSharedStatus(expected: Long, projectId: String, statusId: String, body: JSONObject): JSONObject =
        request(expected, "/shared/projects/$projectId/statuses/$statusId", body)
    fun deleteSharedStatus(expected: Long, projectId: String, statusId: String, body: JSONObject): JSONObject =
        request(expected, "/shared/projects/$projectId/statuses/$statusId", body, method = "DELETE")
    fun createSharedCategory(expected: Long, projectId: String, body: JSONObject): JSONObject =
        request(expected, "/shared/projects/$projectId/categories", body)
    fun updateSharedCategory(expected: Long, projectId: String, categoryId: String, body: JSONObject): JSONObject =
        request(expected, "/shared/projects/$projectId/categories/$categoryId", body)
    fun deleteSharedCategory(expected: Long, projectId: String, categoryId: String, body: JSONObject): JSONObject =
        request(expected, "/shared/projects/$projectId/categories/$categoryId", body, method = "DELETE")
    fun changeSharedMemberRole(expected: Long, projectId: String, userId: String, role: String): JSONObject =
        request(expected, "/shared/projects/$projectId/members/$userId", JSONObject().put("role", role))
    fun changeSharedSpaceRole(expected: Long, spaceId: String, userId: String, role: String,
        canOrganizeTasks: Boolean? = null): JSONObject =
        request(expected, "/shared/spaces/$spaceId/members/$userId", JSONObject().put("role", role).apply {
            if (canOrganizeTasks != null) put("canOrganizeTasks", canOrganizeTasks)
        })
    fun removeSharedMember(expected: Long, projectId: String, userId: String): JSONObject =
        request(expected, "/shared/projects/$projectId/members/$userId", JSONObject(), method = "DELETE")
    fun createSharedTask(expected: Long, projectId: String, body: JSONObject): JSONObject =
        request(expected, "/shared/projects/$projectId/tasks", body)
    fun updateSharedTask(expected: Long, projectId: String, taskId: String, body: JSONObject): JSONObject =
        request(expected, "/shared/projects/$projectId/tasks/$taskId", body)
    fun moveSharedTask(expected: Long, projectId: String, taskId: String, body: JSONObject): JSONObject =
        request(expected, "/shared/projects/$projectId/tasks/$taskId/move", body)
    fun inviteSharedMember(expected: Long, projectId: String, body: JSONObject): JSONObject =
        request(expected, "/shared/projects/$projectId/invitations", body)
    fun acceptSharedInvitation(expected: Long, body: JSONObject): JSONObject =
        request(expected, "/shared/invitations/accept", body)
    fun sharedInvitations(expected: Long): JSONObject = request(expected, "/shared/invitations", null)
    fun sharedNotifications(expected: Long): JSONObject = request(expected, "/shared/notifications", null)
    fun readSharedNotifications(expected: Long, eventIds: JSONArray): JSONObject =
        request(expected, "/shared/notifications/read", JSONObject().put("eventIds", eventIds))
    fun rejectSharedInvitation(expected: Long, id: String): JSONObject =
        request(expected, "/shared/invitations/$id", JSONObject())
    fun sharedComments(expected: Long, projectId: String, taskId: String): JSONObject =
        request(expected, "/shared/projects/$projectId/tasks/$taskId/comments", null)
    fun olderSharedComments(expected: Long, projectId: String, taskId: String, before: String): JSONObject =
        request(expected, "/shared/projects/$projectId/tasks/$taskId/comments?before=${java.net.URLEncoder.encode(before, "UTF-8")}", null)
    fun addSharedComment(expected: Long, projectId: String, taskId: String, body: JSONObject): JSONObject =
        request(expected, "/shared/projects/$projectId/tasks/$taskId/comments", body)
    fun adminStats(expected: Long): JSONObject = request(expected, "/admin/stats", null)
    fun adminExtension(expected: Long, method: String, path: String, body: JSONObject?): JSONObject {
        require(allowedAdminExtensionRoute(method, path))
        return request(expected, path, body, method = method)
    }
    fun recordFeatureUsage(expected: Long, features: List<String>): JSONObject =
        request(expected, "/feature-usage", JSONObject().put("platform", "android")
            .put("features", JSONArray(features)))
    fun todayAds(expected: Long, language: String, country: String): JSONObject {
        require(language.matches(Regex("[a-z]{2}")) && country.matches(Regex("[A-Z]{0,2}")))
        return request(expected, "/ads/today?language=$language&country=$country&platform=android", null)
    }
    fun deleteAdminUser(expected: Long, userId: String, blacklist: Boolean): JSONObject {
        require(userId.matches(Regex("[A-Za-z0-9_-]{1,100}")))
        return request(expected, "/admin/users/$userId", JSONObject().put("blacklist", blacklist), method = "DELETE")
    }
    fun removeLinkedAccount(expected: Long, accountId: String): JSONObject {
        require(accountId.matches(Regex("[A-Za-z0-9_-]{1,100}")))
        return request(expected, "/account/google-accounts/$accountId", JSONObject(), method = "DELETE")
    }
    fun authenticate(expected: Long, idToken: String): JSONObject {
        require(idToken.length in 1..16384)
        return request(expected, "/auth/google/native", JSONObject().put("idToken", idToken))
    }
    fun authenticateYandex(expected: Long, accessToken: String): JSONObject {
        require(accessToken.length in 1..16384)
        return request(expected, "/auth/yandex/native", JSONObject().put("accessToken", accessToken))
    }
    fun connectYandexCalendar(expected: Long, accessToken: String, expiresIn: Long, accountId: String? = null): JSONObject =
        request(expected, "/account/yandex-calendar/connect",
            JSONObject().put("accessToken", accessToken).put("expiresIn", expiresIn).put("accountId", accountId))
    fun disconnectYandexCalendar(expected: Long, accountId: String? = null): JSONObject =
        request(expected, "/account/yandex-calendar/disconnect", JSONObject().put("accountId", accountId))

    fun revoke(expected: Long, old: SessionSecret) {
        if (old.cookie.isBlank() || old.csrf.isBlank()) return
        request(expected, "/auth/logout", JSONObject(), old, persist = false)
    }

    fun sharedTaskExtension(expected: Long, method: String, path: String, body: JSONObject? = null): JSONObject {
        require(allowedSharedTaskExtensionRoute(method, path))
        return request(expected, path, body, method = method)
    }

    fun assistant(expected: Long, body: JSONObject? = null): JSONObject =
        request(expected, if (body == null) "/assistant/status" else "/assistant/plan", body)

    fun messaging(expected: Long, method: String, path: String, body: JSONObject?): JSONObject {
        require(MessagingProtocol.allowedRoute(method, path))
        return request(expected, path, body, method = method)
    }

    fun sharedMindmapDocument(expected: Long, space: String, path: String, body: JSONObject?, method: String): JSONObject =
        request(expected, SharedMindmapProtocol.route(space, path, method), body, method = method)

    /** Authenticated binary download; metadata URLs never leave the native session. */
    fun sharedTaskFile(expected: Long, task: String, file: String): ByteArray {
        val path = "/shared/tasks/${SharedTaskLifecycleProtocol.id(task)}/attachments/${SharedTaskLifecycleProtocol.id(file)}"
        require(allowedSharedTaskExtensionRoute("GET", path))
        val current = load(expected)
        if (current.cookie.isBlank()) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        val connection = URL("$AUTH_ORIGIN/api$path").openConnection() as HttpsURLConnection
        synchronized(guard) { check(expected); connections += connection }
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.useCaches = false
            connection.requestMethod = "GET"
            connection.setRequestProperty("Accept", "application/octet-stream")
            connection.setRequestProperty("Cache-Control", "no-store")
            connection.setRequestProperty("Cookie", "$SESSION_COOKIE=${current.cookie}")
            connection.setRequestProperty("X-Genesis-App-Version", BuildConfig.VERSION_NAME)
            NativeActivityVisit.headers().forEach { (name, value) -> connection.setRequestProperty(name, value) }
            synchronized(guard) { check(expected) }
            val status = connection.responseCode
            if (status != 200) throw AuthFailure(when (status) {
                401, 403 -> AuthFailure.Kind.UNAUTHORIZED
                404, 405 -> AuthFailure.Kind.NOT_DEPLOYED
                429 -> AuthFailure.Kind.RATE_LIMIT
                in 300..399 -> AuthFailure.Kind.PROTOCOL
                else -> AuthFailure.Kind.SERVER
            }, status)
            if (connection.contentLengthLong > SharedTaskFilesProtocol.limit) throw AuthFailure(AuthFailure.Kind.PROTOCOL)
            val output = ByteArrayOutputStream()
            connection.inputStream.use { input ->
                val buffer = ByteArray(8192)
                while (true) {
                    synchronized(guard) { check(expected) }
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > SharedTaskFilesProtocol.limit) throw AuthFailure(AuthFailure.Kind.PROTOCOL)
                    output.write(buffer, 0, count)
                }
            }
            synchronized(guard) { check(expected) }
            if (output.size() == 0) throw AuthFailure(AuthFailure.Kind.PROTOCOL)
            return output.toByteArray()
        } catch (error: CancellationException) { throw error
        } catch (error: AuthFailure) { throw error
        } catch (_: java.io.IOException) { throw AuthFailure(AuthFailure.Kind.NETWORK)
        } finally {
            synchronized(guard) { connections -= connection }
            connection.disconnect()
        }
    }

    /** Blocking; the controller always calls on Dispatchers.IO. Default platform TLS verification. */
    private fun request(expected: Long, path: String, body: JSONObject?, secret: SessionSecret? = null,
        persist: Boolean = true, method: String = if (body == null) "GET" else "POST",
        responseReader: ((java.io.InputStream) -> JSONObject)? = null, importBody: DataImportBody? = null,
        timeZone: String? = null, foregroundCall: ForegroundAccountCall? = null): JSONObject {
        val trialStarted = android.os.SystemClock.elapsedRealtime()
        val (requestTrialEpoch, requestSequence) = synchronized(guard) { check(expected); trialEpoch to trialProfileOrder.beginRequest() }
        require(allowedAuthSessionRoute(method, path))
        if(BackupProtocol.personalWrite(method,path)&&backupEpoch.pending()!=null)throw AuthApiError("BACKUP_RECONCILIATION_REQUIRED")
        require(method in setOf("GET", "POST", "PUT", "PATCH", "DELETE") && (method == "GET") == (body == null))
        val current = secret ?: load(expected)
        if (body != null && (current.cookie.isBlank() || current.csrf.isBlank())) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        val connection = URL("$AUTH_ORIGIN/api$path").openConnection() as HttpsURLConnection
        synchronized(guard) { check(expected); connections += connection }
        var phase = "prepare"
        try {
            foregroundCall?.attach(connection)
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 15_000
            connection.readTimeout = if (path == "/bootstrap" || path == "/assistant/plan" || path.startsWith("/shared/data/") || path.startsWith("/shared/reports") || path.startsWith("/shared/") && path.contains("/templates")) 120_000 else 30_000
            connection.useCaches = false
            connection.requestMethod = method
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Cache-Control", "no-store")
            require(timeZone == null || timeZone in java.time.ZoneId.getAvailableZoneIds())
            connection.setRequestProperty("X-Genesis-Time-Zone", timeZone ?: TimeZone.getDefault().id)
            connection.setRequestProperty("X-Genesis-App-Version", BuildConfig.VERSION_NAME)
            NativeActivityVisit.headers().forEach { (name, value) -> connection.setRequestProperty(name, value) }
            connection.setRequestProperty("X-Genesis-Data-Generation",backupEpoch.accepted().toString())
            connection.setRequestProperty("X-Genesis-Installation-Id", installationId)
            if (current.cookie.isNotBlank()) connection.setRequestProperty("Cookie", "$SESSION_COOKIE=${current.cookie}")
            if (body != null) {
                connection.setRequestProperty("X-CSRF-Token", current.csrf)
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.doOutput = true
                val bytes = if (importBody == null) body.toString().toByteArray(Charsets.UTF_8) else null
                connection.setFixedLengthStreamingMode(importBody?.length ?: requireNotNull(bytes).size)
                synchronized(guard) { check(expected) }
                phase = "write"
                connection.outputStream.use { output ->
                    if (importBody == null) output.write(requireNotNull(bytes))
                    else importBody.write(output) { synchronized(guard) { check(expected) } }
                }
            }
            synchronized(guard) { check(expected) }
            phase = "status"
            val status = connection.responseCode
            if (status !in 200..299) {
                if (status == 403 || status == 409 && (BackupProtocol.allowedRoute(method,path)||BackupProtocol.personalWrite(method,path)||method == "POST" && path in setOf("/billing/orders", "/billing/trial"))) {
                    val accessCode = runCatching {
                        val output = ByteArrayOutputStream()
                        connection.errorStream?.use { input ->
                            val buffer = ByteArray(512)
                            while (output.size() < 4096) {
                                val count = input.read(buffer, 0, minOf(buffer.size, 4096 - output.size()))
                                if (count < 0) break
                                output.write(buffer, 0, count)
                            }
                        }
                        JSONObject(output.toString(Charsets.UTF_8.name())).optString("error")
                    }.getOrDefault("")
                    // Preserve only known public access/price codes; other HTTP handling stays unchanged.
                    if (status == 403 && accessCode in setOf("FEATURE_SUBSCRIPTION_REQUIRED", "SUBSCRIPTION_QUOTA_personal-projects",
                            "SUBSCRIPTION_QUOTA_habits", "SUBSCRIPTION_QUOTA_mindmaps", "SUBSCRIPTION_QUOTA_diary",
                            "SUBSCRIPTION_QUOTA_shared-projects", "SUBSCRIPTION_QUOTA_shared-mindmaps")) throw AuthApiError(accessCode)
                    if (path == "/billing/trial" && accessCode in setOf("TRIAL_ALREADY_USED", "TRIAL_NOT_AN_UPGRADE", "TRIAL_ACCESS_REVOKED"))
                        throw AuthApiError(accessCode)
                    if (status == 409 && accessCode == "BILLING_QUOTE_CHANGED") throw AuthApiError(accessCode)
                    if(accessCode.matches(Regex("BACKUP_[A-Z_]+")))throw AuthApiError(accessCode)
                    if (status == 409 && path == "/billing/modeling/orders" && accessCode == "MODELING_PAYMENT_NOT_REQUIRED")
                        throw AuthApiError(accessCode)
                    if (AuroraProtocol.allowedRoute(method, path) && accessCode in setOf("AURORA_REVISION_CONFLICT", "MODELING_RESULT_IMMUTABLE", "AURORA_RESULT_INVALID", "AURORA_ENVELOPE_INVALID"))
                        throw AuthApiError(accessCode)
                }
                if (allowedAdminExtensionRoute(method, path) && status in 400..499 && status !in setOf(401, 403, 404, 405, 429)) {
                    val failure = runCatching {
                        val output = ByteArrayOutputStream()
                        connection.errorStream?.use { input ->
                            val buffer = ByteArray(1024)
                            while (output.size() < 8192) {
                                val count = input.read(buffer, 0, minOf(buffer.size, 8192 - output.size()))
                                if (count < 0) break
                                output.write(buffer, 0, count)
                            }
                        }
                        val code = JSONObject(output.toString(Charsets.UTF_8.name())).optString("error")
                        if (code == "SUBSCRIPTION_STATUS_CONFLICT") AuthApiError(code) else null
                    }.getOrNull()
                    if (failure != null) throw failure
                }
                if (path.startsWith("/shared/") && status in 400..499 && status !in setOf(401, 403, 404, 405, 429) && !path.contains("/planning") && !path.contains("/invitations")) {
                    val failure = runCatching {
                        val output = ByteArrayOutputStream()
                        connection.errorStream?.use { input ->
                            val buffer = ByteArray(1024)
                            while (output.size() < 8192) {
                                val count = input.read(buffer, 0, minOf(buffer.size, 8192 - output.size()))
                                if (count < 0) break
                                output.write(buffer, 0, count)
                            }
                        }
                        val payload = JSONObject(output.toString(Charsets.UTF_8.name()))
                        val code = payload.optString("error")
                        if (path.contains("/templates") && code in SharedTemplateProtocol.errors && !code.startsWith("WORKFLOW_") && !code.startsWith("CUSTOM_FIELD_") ||
                            path.startsWith("/shared/tasks?") && code in SavedViewProtocol.errors ||
                            path.startsWith("/shared/views") && code in SavedViewProtocol.errors ||
                            path.endsWith("/data-export") && code in DataExportProtocol.errors ||
                            (path.startsWith("/shared/data/") || path.startsWith("/shared/data-imports/")) && DataImportProtocol.errorCode(code) ||
                            path.startsWith("/shared/reports") && (code in TeamReportProtocol.errors || code.startsWith("CUSTOM_FIELD_")) ||
                            path.endsWith("/project-access") && code in ProjectAccessProtocol.errors ||
                            (path.startsWith("/shared/bulk") || path.startsWith("/shared/views/options")) && SharedBulkProtocol.errorCode(code) ||
                            path.contains("/automations") && SharedAutomationProtocol.errorCode(code)) AuthApiError(code)
                        else if (path.startsWith("/shared/messenger/") && (code.startsWith("MESSENGER_") || code in MessagingProtocol.errors || code.startsWith("INVALID_"))) AuthApiError(code)
                        else if ((path.startsWith("/shared/private-conversations/") || path == "/shared/messaging/key") && code in MessagingProtocol.errors) AuthApiError(code)
                        else if (path.startsWith("/shared/projects/") && path.contains("/tasks") && code in sharedTaskDetailErrors) AuthApiError(code)
                        else customFieldFailure(status, payload) ?: workflowFailure(status, payload)
                    }.getOrNull()
                    if (failure != null) throw failure
                }
                if (method != "GET" && path.contains("/planning") && status in 400..499 && status !in setOf(401, 403, 404, 405, 429)) {
                    val code = runCatching {
                        val output = ByteArrayOutputStream()
                        connection.errorStream?.use { input ->
                            val buffer = ByteArray(1024)
                            while (output.size() < 8192) {
                                val count = input.read(buffer, 0, minOf(buffer.size, 8192 - output.size()))
                                if (count < 0) break
                                output.write(buffer, 0, count)
                            }
                        }
                        JSONObject(output.toString(Charsets.UTF_8.name())).optString("error")
                    }.getOrDefault("")
                    if (code in PlanningJournal.DEFINITIVE_ERRORS || path.matches(Regex("/shared/projects/[a-f0-9-]{36}/planning/sprints/[a-f0-9-]{36}/report(?:/(?:check|sources))?")) && code in SprintReportProtocol.errors) throw AuthApiError(code)
                }
                if (path.contains("/invitations")) {
                    val code = runCatching { JSONObject(connection.errorStream?.bufferedReader()?.use { it.readText() }
                        ?: "{}").optString("error") }.getOrDefault("")
                    if (code in setOf("INVITEE_ACCOUNT_UNSUPPORTED", "INVITEE_ACCOUNT_NOT_FOUND",
                            "ALREADY_PROJECT_MEMBER", "INVALID_INVITATION")) throw AuthApiError(code)
                }
                throw AuthFailure(when (status) {
                    404, 405 -> AuthFailure.Kind.NOT_DEPLOYED
                    401, 403 -> AuthFailure.Kind.UNAUTHORIZED
                    429 -> AuthFailure.Kind.RATE_LIMIT
                    409 -> AuthFailure.Kind.CONFLICT
                    in 300..399 -> AuthFailure.Kind.PROTOCOL
                    else -> AuthFailure.Kind.SERVER
                }, httpStatus = status)
            }
            if (!connection.contentType.orEmpty().substringBefore(';').trim().equals("application/json", true))
                throw AuthFailure(AuthFailure.Kind.PROTOCOL)
            phase = "read"
            val payload = connection.inputStream.use { input ->
                if (responseReader != null) return@use responseReader(input)
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(4096)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    val maximumBytes = when (path) {
                        "/workspace" -> 11_000_000
                        "/bootstrap" -> 24_000_000
                        "/admin/stats" -> 4_000_000
                        "/admin/ads" -> 32_000_000
                        "/assistant/plan" -> 1_000_000
                        else -> if (path.startsWith("/backup/v1/")||path in setOf("/recovered-tasks","/mindmaps","/diary","/aurora-workspace","/stoicheion-workspace")) 32_000_000 else if (path.startsWith("/shared/")) 32_000_000 else if (path.startsWith("/ads/today?")) 4_000_000 else if (path.startsWith("/admin/ads/")) 1_000_000 else 131_072
                    }
                    if (output.size() + read > maximumBytes) throw AuthFailure(AuthFailure.Kind.PROTOCOL)
                    output.write(buffer, 0, read)
                }
                JSONObject(output.toString(Charsets.UTF_8.name()))
            }
            if (persist) {
                val headers = connection.headerFields.filterKeys { it?.equals("Set-Cookie", true) == true }.values.flatten()
                val update = AuthProtocol.cookie(headers, System.currentTimeMillis())
                if (update.present && update.value.isBlank()) {
                    clear(expected)
                    throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
                }
                val csrf = if (payload.has("csrf")) AuthProtocol.csrf(payload.getString("csrf")) else current.csrf
                val next = SessionSecret(if (update.present) update.value else current.cookie,
                    if (update.present) update.expiresAt else current.expiresAt, csrf)
                if (next.cookie.isBlank() || next.csrf.isBlank()) throw AuthFailure(AuthFailure.Kind.PROTOCOL)
                save(expected, next)
            }
            synchronized(guard) { check(expected) }
            // A changed server generation must not reach import/bootstrap before local work is protected.
            payload.optJSONObject("user")?.takeIf { it.has("dataGeneration") }?.let { user ->
                val accountScope=CloudAccountSnapshot.scopeFor(user.getString("uid"))
                backupEpoch.observe(accountScope,user.getLong("dataGeneration"))
                if(backupEpoch.pending(accountScope)!=null && path=="/bootstrap") {
                    backupApplication?.let { app -> kotlinx.coroutines.runBlocking(kotlinx.coroutines.Dispatchers.IO) {
                        ru.genesis.calendar.data.BackupSafetyStore(app,accountScope).protectCurrent()
                    } }
                }
            }
            // Catalogs/quotes/orders cannot mint a live trial lease even if they contain metadata.
            if (persist && (!path.startsWith("/billing/") || path == "/billing/trial"))
                registerLiveProfile(expected, requestTrialEpoch, trialStarted, requestSequence, payload)
            return payload
        } catch (error: CancellationException) {
            throw error
        } catch (error: AuthFailure) {
            throw error
        } catch (error: AuthApiError) {
            throw error
        } catch (error: java.io.IOException) {
            if (BuildConfig.DEBUG) Log.w("GenesisAuth", "HTTPS transport failed at $path/$phase: ${error.javaClass.simpleName}")
            throw AuthFailure(AuthFailure.Kind.NETWORK)
        } catch (_: Exception) {
            throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        } finally {
            synchronized(guard) { connections -= connection }
            connection.disconnect()
        }
    }
}
