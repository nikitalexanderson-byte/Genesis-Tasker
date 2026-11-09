package ru.genesis.calendar.data

import androidx.room.withTransaction
import java.security.SecureRandom
import java.time.Instant
import java.time.LocalDate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.AuthController

data class StoicheionDraw(val kind: String, val dayKey: String, val seed: Long,
    val attempts: Int, val firstAt: Long, val rerollDeadline: Long, val unlimited: Boolean = false) {
    fun remainingSeconds(now: Long): Int = if (attempts == 1)
        ((rerollDeadline - now + 999L) / 1000L).coerceAtLeast(0L).toInt() else 0
    fun canReroll(now: Long): Boolean = unlimited || attempts == 1 && now < rerollDeadline
}

data class StoicheionDraws(val daily: StoicheionDraw? = null, val spread: StoicheionDraw? = null,
    val timeline: StoicheionDraw? = null)

object StoicheionDrawRules {
    fun weekStart(dayKey: String): LocalDate { val date=LocalDate.parse(dayKey); return date.minusDays((date.dayOfWeek.value-1).toLong()) }
    fun inPeriod(kind: String, stored: String, dayKey: String): Boolean = if(kind=="daily") stored==dayKey else !LocalDate.parse(stored).isBefore(weekStart(dayKey)) && stored<=dayKey
    fun next(existing: StoicheionDraw?, kind: String, dayKey: String, seed: Long, now: Long): StoicheionDraw {
        require(kind in setOf("daily", "spread", "timeline")) { "Неизвестный вид расклада." }
        require(seed in 0..0xffff_ffffL) { "Зерно расклада указано неверно." }
        require(existing == null || inPeriod(kind,existing.dayKey,dayKey) && existing.kind == kind)
        if (existing != null) require(existing.canReroll(now)) {
            if (existing.attempts >= 2) "Переброс на сегодня уже использован."
            else "Трёхминутное окно для переброса завершилось."
        }
        return StoicheionDraw(kind, existing?.dayKey ?: dayKey, seed, if (existing == null) 1 else 2,
            existing?.firstAt ?: now, existing?.rerollDeadline ?: now + 180_000L)
    }
}

internal object StoicheionDrawWire {
    fun drawsObject(payload: JSONObject): JSONObject = when (val value = payload.get("draws")) {
        is JSONObject -> value
        is JSONArray -> JSONObject().also { require(value.length() == 0) }
        else -> error("Некорректный набор раскладов.")
    }

    fun fromServerJson(value: JSONObject): StoicheionDraw {
        val draw = StoicheionDraw(value.getString("kind"), value.getString("dayKey"),
            value.getLong("seed"), value.getInt("attempts"),
            Instant.parse(value.getString("firstDrawAt")).toEpochMilli(),
            Instant.parse(value.getString("rerollDeadline")).toEpochMilli(), value.optBoolean("unlimited"))
        require(draw.kind in setOf("daily", "spread", "timeline") && draw.seed in 0..0xffff_ffffL && draw.attempts in 1..2)
        LocalDate.parse(draw.dayKey)
        return draw
    }

    fun snapshot(payload: JSONObject): Pair<String, List<StoicheionDraw>> {
        val day = payload.getString("dayKey")
        LocalDate.parse(day)
        val values = drawsObject(payload)
        val draws = values.keys().asSequence().map { kind ->
            require(kind in setOf("daily", "spread", "timeline"))
            fromServerJson(values.getJSONObject(kind)).also { require(it.kind == kind && StoicheionDrawRules.inPeriod(kind,it.dayKey,day)) }
        }.toList()
        return day to draws
    }
}

/** Account scopes mirror the server draw API; local scopes retain the encrypted offline fallback. */
class StoicheionDrawRepository(private val app: GenesisApplication) {
    companion object {
        private val accountLocks = java.util.concurrent.ConcurrentHashMap<String, Mutex>()
    }
    private val dao = app.database.dao()
    private val scope = app.workspaceScope
    private val cipher = LocalCipher()
    private val kind = "stoicheion-draws"
    private val associatedData = "$scope/$kind"
    private val random = SecureRandom()
    private val accountLock = accountLocks.getOrPut(scope) { Mutex() }

    private fun checkScope() {
        if (app.workspaceScope != scope) throw CancellationException("Draw account changed")
    }

    val today = dao.observeDocument(scope, kind).map { record ->
        if (record == null) StoicheionDraws() else read(
            JSONObject(cipher.decrypt(record.encrypted, associatedData)), LocalDate.now().toString())
    }.flowOn(Dispatchers.IO)

    suspend fun refreshFromServer(): StoicheionDraws = accountLock.withLock {
        checkScope()
        require(scope.startsWith("account-")) { "Серверная синхронизация доступна после входа." }
        val payload = AuthController.get(app).loadStoicheionDraws()
        checkScope()
        replaceFromServer(payload)
    }

    suspend fun save(drawKind: String, seed: Long = random.nextInt().toUInt().toLong()): StoicheionDraw = accountLock.withLock {
        checkScope()
        val feature = when (drawKind) { "spread" -> "stoicheion-spread"; "timeline" -> "stoicheion-timeline"; else -> "stoicheion" }
        require(app.featureAccess(scope).allows(feature)) { "FEATURE_SUBSCRIPTION_REQUIRED" }
        if (scope.startsWith("account-")) {
            val payload = AuthController.get(app).saveStoicheionDraw(drawKind, seed)
            checkScope()
            return@withLock mergeServerDraw(payload.getJSONObject("draw"))
        }
        app.database.withTransaction {
            val dayKey = LocalDate.now().toString()
            val row = dao.document(scope, kind)
            val root = if (row == null) JSONObject().put("days", JSONObject())
                else JSONObject(cipher.decrypt(row.encrypted, associatedData))
            val days = root.optJSONObject("days") ?: JSONObject().also { root.put("days", it) }
            val values = days.optJSONObject(dayKey) ?: JSONObject().also { days.put(dayKey, it) }
            val current=read(root,dayKey)
            val previous=when(drawKind){"daily"->current.daily;"spread"->current.spread;else->current.timeline}
            val next = StoicheionDrawRules.next(previous, drawKind, dayKey, seed, System.currentTimeMillis())
            val target=days.optJSONObject(next.dayKey) ?: JSONObject().also { days.put(next.dayKey,it) }
            target.put(drawKind,localJson(next))
            dao.putDocument(DocumentRecord(scope, kind, cipher.encrypt(root.toString(), associatedData),
                (row?.revision ?: 0L) + 1L))
            next
        }
    }

    internal suspend fun replaceFromServer(payload: JSONObject): StoicheionDraws = app.database.withTransaction {
        checkScope()
        val (dayKey, draws) = StoicheionDrawWire.snapshot(payload)
        val root = currentRoot()
        val days = root.optJSONObject("days") ?: JSONObject().also { root.put("days", it) }
        // A server snapshot replaces this period, including an explicit absence.
        for(key in days.keys().asSequence().toList()) {
            val values=days.optJSONObject(key)?:continue
            for(drawKind in listOf("daily","spread","timeline"))if(StoicheionDrawRules.inPeriod(drawKind,key,dayKey))values.remove(drawKind)
        }
        draws.forEach { draw -> val values=days.optJSONObject(draw.dayKey)?:JSONObject().also { days.put(draw.dayKey,it) };values.put(draw.kind,localJson(draw)) }
        persist(root)
        read(root, dayKey)
    }

    private suspend fun mergeServerDraw(value: JSONObject): StoicheionDraw = app.database.withTransaction {
        val draw = StoicheionDrawWire.fromServerJson(value)
        val root = currentRoot()
        val days = root.optJSONObject("days") ?: JSONObject().also { root.put("days", it) }
        val values = days.optJSONObject(draw.dayKey) ?: JSONObject().also { days.put(draw.dayKey, it) }
        values.put(draw.kind, localJson(draw))
        persist(root)
        draw
    }

    private suspend fun currentRoot(): JSONObject {
        val row = dao.document(scope, kind)
        return if (row == null) JSONObject().put("days", JSONObject())
            else JSONObject(cipher.decrypt(row.encrypted, associatedData))
    }

    private suspend fun persist(root: JSONObject) {
        val row = dao.document(scope, kind)
        dao.putDocument(DocumentRecord(scope, kind, cipher.encrypt(root.toString(), associatedData),
            (row?.revision ?: 0L) + 1L))
    }

    private fun localJson(draw: StoicheionDraw) = JSONObject().put("seed", draw.seed)
        .put("attempts", draw.attempts).put("firstAt", draw.firstAt)
        .put("rerollDeadline", draw.rerollDeadline).put("unlimited",draw.unlimited)

    private fun read(root: JSONObject, dayKey: String): StoicheionDraws {
        val days=root.optJSONObject("days")?:return StoicheionDraws()
        fun latest(drawKind:String):StoicheionDraw?=days.keys().asSequence().filter { runCatching { StoicheionDrawRules.inPeriod(drawKind,it,dayKey) }.getOrDefault(false) }
            .sortedDescending().mapNotNull { key -> days.optJSONObject(key)?.optJSONObject(drawKind)?.let { fromJson(drawKind,key,it) } }.firstOrNull()
        return StoicheionDraws(latest("daily"),latest("spread"),latest("timeline"))
    }

    private fun fromJson(drawKind: String, dayKey: String, value: JSONObject): StoicheionDraw? = runCatching {
        StoicheionDraw(drawKind, dayKey, value.getLong("seed"), value.getInt("attempts"),
            value.getLong("firstAt"), value.getLong("rerollDeadline"), value.optBoolean("unlimited")).takeIf {
            it.seed in 0..0xffff_ffffL && it.attempts in 1..2
        }
    }.getOrNull()
}
