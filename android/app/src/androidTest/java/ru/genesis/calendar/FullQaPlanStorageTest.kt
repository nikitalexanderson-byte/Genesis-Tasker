package ru.genesis.calendar

import androidx.test.platform.app.InstrumentationRegistry
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import java.util.Base64
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.FeatureAccess
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.*

/** Real Room/Keystore/repository checks. The server snapshot is an explicit local fixture;
 * this is not a purchase test or a claim of authenticated server E2E coverage. */
class FullQaPlanStorageTest {
    private val base = setOf("calendar", "tasks", "habits", "trackers", "diary", "mindmaps",
        "stoicheion", "stoicheion-letters", "theokyklos", "calendar-sync")
    private val standard = base + setOf("habit-timer", "stoicheion-timeline", "theokyklos-olympians", "advice-settings", "data-export")
    private val premium = standard + setOf("stoicheion-spread", "stoicheion-restoration", "future-modeling")
    private val business = premium + setOf("shared-projects", "messenger", "automations")
    private val expected = mapOf("free" to base, "standart" to standard, "premium" to premium,
        "business" to business, "premium4life" to (business + "physis"))
    private val quotas = mapOf("free" to (5 to 5), "standart" to (20 to 10), "premium" to (100 to 20),
        "business" to (100 to 20), "premium4life" to (100 to 20))

    @Test fun freeRepositoryBoundariesAndPreservation() = exercise("free")
    @Test fun standartRepositoryBoundariesAndPreservation() = exercise("standart")
    @Test fun premiumRepositoryBoundariesAndPreservation() = exercise("premium")
    @Test fun businessRepositoryBoundariesAndPreservation() = exercise("business")
    @Test fun lifetimeRepositoryBoundariesAndPreservation() = exercise("premium4life")

    private fun snapshot(app: GenesisApplication, plan: String, expired: Boolean = false): FeatureAccess {
        val policy = app.assets.open("originals/catalogs/feature-access-policy.json").bufferedReader().use { JSONObject(it.readText()) }
        val effective = if (plan == "premium4life") "business" else plan
        val features = policy.getJSONObject("features")
        val allowed = features.keys().asSequence().filter { key ->
            val values = features.getJSONArray(key)
            (0 until values.length()).any { values.getString(it) in setOf(plan, effective) }
        }.toList()
        val free = features.keys().asSequence().filter { key ->
            val values = features.getJSONArray(key)
            (0 until values.length()).any { values.getString(it) == "free" }
        }.toList()
        return FeatureAccess.fromJson(JSONObject().put("schemaVersion", 1).put("enforcementEnabled", true)
            .put("declaredPlan", plan).put("effectivePlan", effective).put("lifetimePremium", plan == "premium4life")
            .put("validUntil", if (plan == "premium4life") JSONObject.NULL else if (expired) "2000-01-01T00:00:00Z" else "2100-01-01T00:00:00Z")
            .put("policyRevision", policy.getString("revision")).put("allowedFeatures", JSONArray(allowed))
            .put("freeFeatures", JSONArray(free)).put("disabledFeatures", policy.getJSONArray("disabledFeatures"))
            .put("limits", policy.getJSONObject("limits").getJSONObject(effective))
            .put("freeLimits", policy.getJSONObject("limits").getJSONObject("free")))
    }

    private fun exercise(plan: String) = runBlocking {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".qa1103.debug") && BuildConfig.GENESIS_HOST == "localhost")
        val previousScope = app.workspaceScope
        check(previousScope == "internal-validation-v1") { "Never reuse a signed-in workspace" }
        app.activateAccount("full-qa-$plan-${UUID.randomUUID()}")
        val scope = app.workspaceScope
        val dao = app.database.dao()
        val cipher = LocalCipher()
        val access = snapshot(app, plan)
        var mapAccess = access
        app.rememberFeatureAccess(scope, access)
        val (projectQuota, habitQuota) = quotas.getValue(plan)
        val operations = mutableListOf<String>()
        suspend fun rejectedWithoutWrite(kind: String, action: suspend () -> Unit) {
            val before = dao.document(scope, kind)
            val queue = dao.outbox(scope)
            try { action(); fail("$plan $kind must reject creation over the published quota") }
            catch (failure: IllegalArgumentException) { assertTrue(failure.message.orEmpty().contains("лимит")) }
            assertEquals("Rejected mutation must preserve ciphertext and revision", before, dao.document(scope, kind))
            assertEquals("Rejected mutation must not enqueue a write", queue, dao.outbox(scope))
        }
        try {
            for (feature in business + setOf("physis", "assistant")) {
                assertEquals("$plan/$feature", feature in expected.getValue(plan), access.allows(feature))
                operations += "feature:$feature:${if (access.allows(feature)) "allow" else "deny"}"
            }
            assertEquals(projectQuota, access.limit("personal-projects"))
            assertEquals(habitQuota, access.limit("habits"))
            val projects = (0 until projectQuota - 1).map { i ->
                GenesisProject("qa-project-$i", null, "personal", "Синтетический проект $i 🧪", "Сохранить описание", emptyList(), "active", i)
            }
            dao.putDocument(DocumentRecord(scope, "structure", cipher.encrypt(WorkspaceStructureCodec.encode(
                WorkspaceStructure(projects = projects)), "$scope/structure"), 1))
            val structure = WorkspaceStructureRepository(app)
            val lastProject = GenesisProject("qa-project-last", null, "personal", "Граница тарифа 🧪", "Сохранить описание", emptyList(), "active", projectQuota)
            structure.saveProject(lastProject)
            assertEquals(projectQuota, structure.workspace.first().projects.size)
            assertEquals(projectQuota, WorkspaceStructureRepository(app).workspace.first().projects.size)
            operations += "projects:create-at-limit:persist"
            rejectedWithoutWrite("structure") { structure.saveProject(lastProject.copy(id = "qa-project-over")) }
            operations += "projects:reject-over-limit:unchanged-document-and-outbox"
            val today = LocalDate.now()
            val engine = HabitEngine(GenesisCalendar())
            fun habit(i: Int) = Habit(TrackerEntity.create("habit", id = "qa-habit-$i"), "Привычка $i 🧪", today,
                engine.defaultSchedule(today, CalendarMode.PROFANE), measurement = HabitMeasurement("duration", "min", 1000, 1000))
            val habits = (0 until habitQuota - 1).map(::habit)
            dao.putDocument(DocumentRecord(scope, "habits", cipher.encrypt(HabitDocument.encode(
                LocalHabitWorkspace(habits = habits)), "$scope/habits"), 1))
            val repository = HabitsRepository(app)
            repository.save(habit(habitQuota - 1))
            assertEquals(habitQuota, repository.workspace.first().habits.size)
            assertEquals(habitQuota, HabitsRepository(app).workspace.first().habits.size)
            operations += "habits:create-at-limit:persist"
            rejectedWithoutWrite("habits") { repository.save(habit(habitQuota)) }
            operations += "habits:reject-over-limit:unchanged-document-and-outbox"

            val mapQuota = when (plan) { "free" -> 1; "standart" -> 5; else -> 100 }
            assertEquals(mapQuota, access.limit("mindmaps"))
            val mapsSeed = (0 until mapQuota - 1).map { NativeMapRecord(MindmapDocument.new("Тестовая карта $it"), 1) }
            dao.putDocument(DocumentRecord(scope, "mindmaps", cipher.encrypt(JSONArray(mapsSeed.map { it.json() }).toString(), "$scope/mindmaps"), 1))
            var mapWrites = 0
            val transport = object : MindmapTransport {
                override fun check() { check(app.workspaceScope == scope) }
                override suspend fun workspace() = JSONObject().put("workspace", JSONObject().put("keyMode", "account")
                    .put("key", Base64.getEncoder().encodeToString(ByteArray(32) { (it + 17).toByte() })))
                override suspend fun request(path: String, body: JSONObject?): JSONObject {
                    require(path.startsWith("/mindmaps/") && body != null)
                    mapWrites++
                    return JSONObject().put("revision", body.getLong("expectedRevision") + 1)
                }
            }
            val maps = MindmapRepository(app.database, scope, "full-qa-local-map-owner", transport, { mapAccess })
            maps.loadCached()
            val lastMap = MindmapDocument.new("Граница карт $plan")
            maps.save(lastMap)
            assertEquals(mapQuota, maps.records.value.size)
            rejectedWithoutWrite("mindmaps") { maps.save(MindmapDocument.new("За пределом квоты")) }
            assertEquals("Rejected map must never reach transport", 1, mapWrites)
            operations += "mindmaps:create-at-limit-and-deny-overflow-before-transport:$mapQuota"

            val backup = HabitBackupService(app)
            suspend fun deniedExchange(action: suspend () -> Unit) {
                val documents = listOf("habits", "mindmaps", "habit-restore-draft").associateWith { dao.document(scope, it) }
                val queue = dao.outbox(scope)
                try { action(); fail("$plan portable data must require an active paid plan") }
                catch (failure: IllegalArgumentException) { assertEquals("FEATURE_SUBSCRIPTION_REQUIRED", failure.message) }
                documents.forEach { (kind, value) -> assertEquals(value, dao.document(scope, kind)) }
                assertEquals(queue, dao.outbox(scope))
            }
            if (plan == "free") {
                deniedExchange { backup.export("json") }
                deniedExchange { backup.prepare("invalid", "denied-before-parse.json") }
                deniedExchange { maps.exportJson(lastMap) }
                deniedExchange { maps.importJson("invalid") }
            } else {
                assertTrue(backup.export("json").contains("checksum"))
                assertEquals("genesis-mindmap", JSONObject(maps.exportJson(lastMap)).getString("format"))
            }
            operations += "portable-data:${if (plan == "free") "deny" else "allow"}:repository-guard"

            val beforeTimer = dao.document(scope, "habits")
            val timer = HabitTimerCommand("start", repository.timerOwner, Instant.now().toString(), "qa-timer", habitId = habits.first().id)
            if (plan == "free") {
                try { repository.applyTimer(timer); fail("Free must not start a paid habit timer") }
                catch (failure: IllegalArgumentException) { assertEquals("FEATURE_SUBSCRIPTION_REQUIRED", failure.message) }
                assertEquals(beforeTimer, dao.document(scope, "habits"))
                operations += "timer:deny-free:unchanged-document"
            } else {
                repository.applyTimer(timer)
                assertEquals("running", HabitTimers.sessions(repository.workspace.first().timers).single().state?.status)
                operations += "timer:start-paid:persist"
            }

            // A downgrade keeps all rows readable/editable while refusing growth.
            app.rememberFeatureAccess(scope, snapshot(app, "free"))
            mapAccess = snapshot(app, "free")
            maps.save(lastMap.copy(title = "Сохранённая карта после понижения"))
            assertEquals(mapQuota, maps.records.value.size)
            deniedExchange { backup.export("csv") }
            deniedExchange { maps.exportJson(lastMap) }
            deniedExchange { maps.importJson("invalid") }
            structure.saveProject(lastProject.copy(title = "Название после понижения 🧪"))
            val editedHabit = repository.workspace.first().habits.first().copy(title = "Привычка после понижения 🧪")
            repository.save(editedHabit)
            assertEquals(projectQuota, structure.workspace.first().projects.size)
            assertEquals(habitQuota, repository.workspace.first().habits.size)
            assertTrue(structure.workspace.first().projects.any { it.title == "Название после понижения 🧪" })
            assertTrue(repository.workspace.first().habits.any { it.title == editedHabit.title })
            rejectedWithoutWrite("structure") { structure.saveProject(lastProject.copy(id = "qa-after-downgrade")) }
            rejectedWithoutWrite("habits") { repository.save(habit(habitQuota + 1)) }
            operations += "downgrade:retain-all-edit-and-deny-growth"
            if (plan != "free" && plan != "premium4life") {
                app.rememberFeatureAccess(scope, snapshot(app, plan, expired = true))
                rejectedWithoutWrite("structure") { structure.saveProject(lastProject.copy(id = "qa-after-expiry")) }
                rejectedWithoutWrite("habits") { repository.save(habit(habitQuota + 2)) }
                assertFalse(app.featureAccess(scope).allows("habit-timer"))
                operations += "expiry:fall-back-to-free-retain-data"
            }
            if (plan == "premium4life") {
                assertTrue(access.allows("physis", Instant.parse("2200-01-01T00:00:00Z")))
                operations += "lifetime:no-expiry"
            }
            assertFalse("Stored documents must be encrypted", dao.document(scope, "structure")!!.encrypted.contains("Название"))
            assertFalse("Stored documents must be encrypted", dao.document(scope, "habits")!!.encrypted.contains("Привычка"))
            operations += "encrypted-storage"
            println("GENESIS_FULL_QA_PLAN=" + JSONObject().put("plan", plan).put("status", "PASS")
                .put("layer", "native-repository-local-entitlement-fixture").put("operations", JSONArray(operations)))
        } finally {
            dao.deleteDocument(scope, "structure")
            dao.deleteDocument(scope, "habits")
            dao.deleteDocument(scope, "mindmaps")
            dao.clearReminders(scope)
            for (row in dao.outbox(scope)) dao.acknowledgeOutbox(scope, row.entityId, row.revision, row.operationId)
            app.activateAccount(null)
        }
    }
}
