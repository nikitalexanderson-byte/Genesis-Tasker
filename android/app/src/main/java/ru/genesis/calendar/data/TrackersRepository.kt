package ru.genesis.calendar.data

import androidx.room.withTransaction
import java.time.*
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.domain.RecurrenceConfig
import ru.genesis.calendar.domain.habits.TrackerEntity
import ru.genesis.calendar.domain.habits.TrackerSchedule
import ru.genesis.calendar.domain.trackers.*

data class LocalTrackersWorkspace(val sleepPlans: List<SleepPlan> = emptyList(),val sleepEntries: List<SleepEntry> = emptyList(),
    val moodEntries: List<MoodEntry> = emptyList(),val revision: Long = 0,
    val addictionTrackers: List<AddictionTracker> = emptyList(),val addictionEntries: List<AddictionEntry> = emptyList(),
    // Older native documents never loaded these collections. Absence must not erase web records.
    val addictionDataLoaded: Boolean = false)

/** Local observations only. One authenticated encrypted document; no rewards or cloud writes. */
class TrackersRepository(app: GenesisApplication) {
    private val db=app.database
    private val dao=db.dao()
    private val scope=app.workspaceScope
    private val mutation=ru.genesis.calendar.auth.NativeBackupMutationGuard(scope)
    private val cipher=LocalCipher()
    val workspace=dao.observeDocument(scope,"trackers").map { row ->
        if(row==null)LocalTrackersWorkspace() else TrackersDocument.decode(cipher.decrypt(row.encrypted,"$scope/trackers"),row.revision)
    }.flowOn(Dispatchers.IO)
    private suspend fun mutate(change: (LocalTrackersWorkspace) -> LocalTrackersWorkspace) = db.withTransaction {
        mutation.check()
        val row=dao.document(scope,"trackers")
        val current=if(row==null)LocalTrackersWorkspace() else TrackersDocument.decode(cipher.decrypt(row.encrypted,"$scope/trackers"),row.revision)
        val next=change(current).copy(revision=current.revision+1)
        dao.putDocument(DocumentRecord(scope,"trackers",cipher.encrypt(TrackersDocument.encode(next),"$scope/trackers"),next.revision))
        if (scope.startsWith("account-")) dao.putOutbox(OutboxRecord(scope,"trackers",next.revision,UUID.randomUUID().toString()))
    }
    suspend fun savePlan(plan: SleepPlan) = mutate { current ->
        require(plan.title.isNotBlank()&&plan.title.length<=500) { "Введите название плана до 500 символов." }
        ZoneId.of(plan.schedule.timezone)
        require(plan.reminderMinutesBefore in 0..180) { "Выберите время уведомления до сна." }
        require(plan.rules.size <= 20 && plan.rules.all { it.field in setOf("bedtime", "wake") &&
            it.operator in setOf("on-or-before", "after") && it.points.isFinite() && it.points in -100.0..100.0 }) {
            "Проверьте правила баллов для сна."
        }
        val previous=current.sleepPlans.firstOrNull { it.id==plan.id }
        require(previous==null||previous.entity.version==plan.entity.version) { "План изменился. Откройте его заново." }
        val next=plan.copy(entity=plan.entity.changed(Instant.now().toString()))
        current.copy(sleepPlans=current.sleepPlans.filterNot { it.id==plan.id }+next,
            sleepEntries=current.sleepEntries.map { e -> if(e.planId!=plan.id)e else SleepTracker.entry(e.entity,next,e.date,e.fellAsleepAt,e.wokeAt,e.quality?.toDouble(),e.note) })
    }
    suspend fun saveSleep(planId: String,date: LocalDate,bedtime: LocalTime?,wake: LocalTime?,quality: Double?,note: String,expectedVersion: Int) = mutate { current ->
        val plan=current.sleepPlans.firstOrNull { it.id==planId } ?: error("План сна не найден")
        require(plan.active) { "План сна на паузе." }
        require(bedtime!=null||wake!=null||quality!=null||note.isNotBlank()) { "Заполните запись сна." }
        val existing=current.sleepEntries.firstOrNull { it.planId==planId&&it.date==date }
        require((existing?.entity?.version ?: 0)==expectedVersion) { "Запись изменилась. Откройте её заново." }
        val meta=(existing?.entity ?: TrackerEntity.create("sleep-entry")).changed(Instant.now().toString())
        val entry=SleepTracker.entry(meta,plan,date,bedtime,wake,quality,note)
        current.copy(sleepEntries=current.sleepEntries.filterNot { it.planId==planId&&it.date==date }+entry)
    }
    /** Mirrors web replaceMood: one visible entry per civil date, existing ID retained. */
    suspend fun saveMood(date: LocalDate,value: Int,note: String,tags: List<String>,expectedVersion: Int,
        customLabel: String = "", customEmoji: String = "") = mutate { current ->
        require(value in -5..6) { "Выберите настроение." }
        require(note.length<=200) { "Заметка должна быть не длиннее 200 символов." }
        require(customLabel.length<=40 && customEmoji.length<=16) { "Название или смайлик слишком длинные." }
        require((customLabel.isBlank() && customEmoji.isBlank()) || (customLabel.isNotBlank() && customEmoji.isNotBlank())) {
            "Укажите название и смайлик своего настроения."
        }
        val existing=current.moodEntries.firstOrNull { it.date==date }
        require((existing?.entity?.version ?: 0)==expectedVersion) { "Запись изменилась. Откройте её заново." }
        val stamp=Instant.now().toString()
        val meta=(existing?.entity ?: TrackerEntity.create("mood",stamp)).changed(stamp)
        val entry=MoodTracker.entry(meta,date,stamp,value.toDouble(),note=note,tags=tags,
            customLabel=customLabel,customEmoji=customEmoji)
        current.copy(moodEntries=current.moodEntries.filterNot { it.date==date }+entry)
    }
    suspend fun saveAddiction(tracker: AddictionTracker) = mutate { current ->
        require(tracker.trackedBehavior.isNotBlank() && tracker.trackedBehavior.length <= 500) { "Введите название до 500 символов." }
        require(tracker.status in setOf("active", "paused", "archived"))
        require(tracker.cleanDayPoints >= 0 && tracker.relapsePenalty >= 0)
        ZoneId.of(tracker.schedule.timezone)
        val previous = current.addictionTrackers.firstOrNull { it.id == tracker.id }
        require(previous == null || previous.entity.version == tracker.entity.version) { "Запись изменилась. Откройте её заново." }
        // A new local tracker can be merged by ID only after cloud collections have been imported.
        require(current.addictionDataLoaded || !scope.startsWith("account-")) { "Обновите данные аккаунта и повторите попытку." }
        current.copy(addictionDataLoaded = true, addictionTrackers = current.addictionTrackers.filterNot { it.id == tracker.id } +
            tracker.copy(entity = tracker.entity.changed(Instant.now().toString())))
    }
    suspend fun saveAbstinence(trackerId: String, date: LocalDate, cleanDay: Boolean, relapse: Boolean,
        craving: Int, trigger: String, note: String, expectedVersion: Int) = mutate { current ->
        val tracker = current.addictionTrackers.firstOrNull { it.id == trackerId } ?: error("Трекер не найден")
        require(tracker.status == "active") { "Трекер на паузе." }
        require(craving in 0..10)
        val previous = current.addictionEntries.firstOrNull { it.trackerId == trackerId && it.date == date }
        require((previous?.entity?.version ?: 0) == expectedVersion) { "Запись изменилась. Откройте её заново." }
        val stamp = Instant.now().toString()
        val meta = (previous?.entity ?: TrackerEntity.create("addiction-entry", stamp)).changed(stamp)
        val entry = AddictionTrackerRules.entry(meta, tracker, date, cleanDay, relapse, craving.toDouble(), trigger, note, stamp)
        current.copy(addictionEntries = current.addictionEntries.filterNot { it.trackerId == trackerId && it.date == date } + entry)
    }
    suspend fun resetTracking() = mutate { LocalTrackersWorkspace(revision = it.revision, addictionDataLoaded = it.addictionDataLoaded) }

    suspend fun deleteAddiction(id: String, expectedVersion: Int) = mutate { current ->
        val tracker = current.addictionTrackers.firstOrNull { it.id == id } ?: error("Трекер не найден")
        require(tracker.entity.version == expectedVersion) { "Запись изменилась. Откройте её заново." }
        require(current.addictionDataLoaded || !scope.startsWith("account-")) { "Обновите данные аккаунта и повторите попытку." }
        current.copy(addictionDataLoaded = true, addictionTrackers = current.addictionTrackers.filterNot { it.id == id },
            addictionEntries = current.addictionEntries.filterNot { it.trackerId == id })
    }
}

internal object TrackersDocument {
    private fun JSONArray.objects()=(0 until length()).map { getJSONObject(it) }
    private fun ints(array: JSONArray)=(0 until array.length()).map { array.getInt(it) }
    // Web schema 16 represents unfilled sleep times as ""; native drafts use null.
    // Both mean "not recorded", including quality-only and note-only sleep entries.
    private fun JSONObject.nullable(key: String)=if(isNull(key))null else getString(key).takeIf(String::isNotBlank)
    private fun entity(e: TrackerEntity)=JSONObject().put("id",e.id).put("createdAt",e.createdAt).put("updatedAt",e.updatedAt).put("version",e.version).put("syncState",e.syncState)
    private fun entity(v: JSONObject)=TrackerEntity(v.getString("id"),v.getString("createdAt"),v.getString("updatedAt"),v.getInt("version"),v.getString("syncState"))
    private fun schedule(s: TrackerSchedule): JSONObject {
        val r=s.recurrence
        return JSONObject().put("startDate",s.startDate.toString()).put("endDate",s.endDate?.toString() ?: JSONObject.NULL).put("timezone",s.timezone)
            .put("recurrence",JSONObject().put("enabled",r.enabled).put("mode",r.mode).put("pattern",r.pattern).put("days",JSONArray(r.days))
                .put("interval",r.interval).put("rangeStart",r.rangeStart).put("rangeEnd",r.rangeEnd).put("months",JSONArray(r.months)).put("pyatas",JSONArray(r.pyatas)).put("calendarContext",calendarContextJson(r.calendarContext)).put("invalidDayPolicy","skip"))
    }
    private fun schedule(s: JSONObject): TrackerSchedule {
        val r=s.getJSONObject("recurrence")
        return TrackerSchedule(LocalDate.parse(s.getString("startDate")),s.nullable("endDate")?.let(LocalDate::parse),s.getString("timezone"),
            RecurrenceConfig(r.getBoolean("enabled"),r.getString("mode"),r.getString("pattern"),ints(r.getJSONArray("days")),r.getInt("interval"),
                r.getString("rangeStart"),r.getString("rangeEnd"),ints(r.getJSONArray("months")),ints(r.getJSONArray("pyatas")),calendarContextFromJson(r.optJSONObject("calendarContext"))))
    }
    fun encode(w: LocalTrackersWorkspace): String = JSONObject().put("localSchema",1)
        .put("sleepPlans",JSONArray(w.sleepPlans.map { p -> entity(p.entity).put("title",p.title).put("active",p.active).put("schedule",schedule(p.schedule))
            .put("targetBedtime",p.targetBedtime.toString()).put("targetWakeTime",p.targetWakeTime.toString()).put("qualityEnabled",p.qualityEnabled).put("scoringEnabled",p.scoringEnabled)
            .put("reminderEnabled",p.reminderEnabled).put("reminderMinutesBefore",p.reminderMinutesBefore)
            .put("rules",JSONArray(p.rules.map { r -> JSONObject().put("id",r.id).put("field",r.field).put("operator",r.operator).put("threshold",r.threshold.toString()).put("points",r.points) })) }))
        .put("sleepEntries",JSONArray(w.sleepEntries.map { e -> entity(e.entity).put("planId",e.planId).put("date",e.date.toString()).put("fellAsleepAt",e.fellAsleepAt?.toString() ?: "")
            .put("wokeAt",e.wokeAt?.toString() ?: "").put("durationMinutes",e.durationMinutes ?: JSONObject.NULL).put("quality",e.quality ?: JSONObject.NULL)
            .put("deviationMinutes",e.deviationMinutes ?: JSONObject.NULL).put("note",e.note).put("score",e.score) }))
        .put("moodEntries",JSONArray(w.moodEntries.map { e -> entity(e.entity).put("date",e.date.toString()).put("recordedAt",e.recordedAt).put("moodValue",e.moodValue)
            .put("note",e.note).put("tags",JSONArray(e.tags)).put("customLabel",e.customLabel).put("customEmoji",e.customEmoji) }))
        .apply { if (w.addictionDataLoaded) {
            put("addictionTrackers", JSONArray(w.addictionTrackers.map { t -> entity(t.entity).put("schedule", schedule(t.schedule))
                .put("trackedBehavior", t.trackedBehavior).put("description", t.description).put("status", t.status)
                .put("cleanDayPoints", t.cleanDayPoints).put("relapsePenalty", t.relapsePenalty)
                .put("reminderEnabled", t.reminderEnabled).put("reminderTime", t.reminderTime) }))
            put("addictionEntries", JSONArray(w.addictionEntries.map { e -> entity(e.entity).put("trackerId", e.trackerId)
                .put("date", e.date.toString()).put("cleanDay", e.cleanDay).put("relapse", e.relapse)
                .put("cravingIntensity", e.cravingIntensity).put("trigger", e.trigger).put("note", e.note)
                .put("timestamp", e.timestamp).put("score", e.score) }))
        } }.toString()
    fun decode(json: String,revision: Long): LocalTrackersWorkspace {
        val v=JSONObject(json); require(v.getInt("localSchema")==1) { "Неподдерживаемая версия трекеров" }
        return LocalTrackersWorkspace(
            v.getJSONArray("sleepPlans").objects().map { p -> SleepPlan(entity(p),schedule(p.getJSONObject("schedule")),p.getString("title"),p.getBoolean("active"),
                LocalTime.parse(p.getString("targetBedtime")),LocalTime.parse(p.getString("targetWakeTime")),p.getBoolean("qualityEnabled"),p.getBoolean("scoringEnabled"),
                p.getJSONArray("rules").objects().map { r -> SleepRule(r.getString("id"),r.getString("field"),r.getString("operator"),LocalTime.parse(r.getString("threshold")),r.getDouble("points")) },
                p.optBoolean("reminderEnabled",false),p.optInt("reminderMinutesBefore",15).coerceIn(0,180)) },
            v.getJSONArray("sleepEntries").objects().map { e -> SleepEntry(entity(e),e.getString("planId"),LocalDate.parse(e.getString("date")),e.nullable("fellAsleepAt")?.let(LocalTime::parse),
                e.nullable("wokeAt")?.let(LocalTime::parse),if(e.isNull("durationMinutes"))null else e.getInt("durationMinutes"),if(e.isNull("quality"))null else e.getInt("quality"),
                if(e.isNull("deviationMinutes"))null else e.getInt("deviationMinutes"),e.getString("note"),e.getDouble("score")) },
            v.getJSONArray("moodEntries").objects().map { e -> val tags=e.getJSONArray("tags")
                MoodEntry(entity(e),LocalDate.parse(e.getString("date")),e.getString("recordedAt"),e.getInt("moodValue"),e.getString("note"),
                    (0 until tags.length()).map(tags::getString),e.optString("customLabel"),e.optString("customEmoji")) },revision,
            (v.optJSONArray("addictionTrackers") ?: JSONArray()).objects().map { t -> AddictionTracker(entity(t), schedule(t.getJSONObject("schedule")),
                t.getString("trackedBehavior"), t.optString("description"), t.getString("status"), t.getInt("cleanDayPoints"),
                t.getInt("relapsePenalty"), t.optBoolean("reminderEnabled"), t.optString("reminderTime", "20:00")) },
            (v.optJSONArray("addictionEntries") ?: JSONArray()).objects().map { e -> AddictionEntry(entity(e), e.getString("trackerId"),
                LocalDate.parse(e.getString("date")), e.getBoolean("cleanDay"), e.getBoolean("relapse"), e.getInt("cravingIntensity"),
                e.optString("trigger"), e.optString("note"), e.getString("timestamp"), e.getInt("score")) },
            v.has("addictionTrackers") && v.has("addictionEntries")).let { workspace ->
                val plans=workspace.sleepPlans.associateBy { it.id }
                workspace.copy(sleepEntries=workspace.sleepEntries.map { entry ->
                    plans[entry.planId]?.let { SleepTracker.recalculate(entry,it) } ?: entry
                })
            }
    }
}
