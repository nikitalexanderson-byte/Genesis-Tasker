package ru.genesis.calendar.data

import ru.genesis.calendar.data.withTransaction
import java.time.*
import java.util.UUID
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.Dispatchers
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.RecurrenceConfig
import ru.genesis.calendar.domain.RecurrenceEngine
import ru.genesis.calendar.reminders.ReminderScheduler

data class LocalTask(
    val id: String = UUID.randomUUID().toString(),
    val title: String,
    val description: String = "",
    val date: String = LocalDate.now().toString(),
    val time: String = "",
    val zoneId: String = ZoneId.systemDefault().id,
    val priority: Int = 5,
    val done: Boolean = false,
    val reminderAt: Long? = null,
    val revision: Long = 0,
    val projectId: String? = null,
    val categoryId: String? = null,
    val project: String = "",
    val recurrence: RecurrenceConfig = RecurrenceConfig(),
    val recurrenceExcludedDates: List<String> = emptyList(),
    /** Retains web fields that the native editor does not yet expose. Always encrypted at rest. */
    val sourceFieldsJson: String = "{}",
    val reminders: List<TaskReminder>? = null,
) {
    fun json(): String {
        val source = JSONObject(sourceFieldsJson)
        if(source.optString("createdAt").isBlank())source.put("createdAt",Instant.now().toString())
        val previousDone = source.optBoolean("done")
        val oldDate = runCatching { LocalDate.parse(source.optString("dueDate")) }.getOrNull()
        val oldEnd = runCatching { LocalDate.parse(source.optString("endDate")) }.getOrNull()
        val endDate = if(date.isBlank()) "" else if (oldDate != null && oldEnd != null && oldEnd >= oldDate && oldDate.toString() != date)
            runCatching { LocalDate.parse(date).plusDays(java.time.temporal.ChronoUnit.DAYS.between(oldDate, oldEnd)).toString() }
                .getOrDefault(date)
        else oldEnd?.toString() ?: date
        val previousReminder = if (source.isNull("reminderAt")) null else source.optLong("reminderAt")
        val selectedReminders = reminders ?: if (previousReminder != reminderAt)
            reminderAt?.let { listOf(TaskReminder.absolute(it)) } ?: emptyList()
            else TaskReminder.from(source)
        source.put("id", id).put("done", done)
            .put("title", title).put("description", description)
            .put("dueDate", date).put("endDate", endDate)
            .put("time", time).put("zoneId", zoneId).put("priority", priority)
            .put("updatedAt", System.currentTimeMillis())
            .put("completedAt", if (done) source.optString("completedAt").takeIf {
                previousDone && it.isNotBlank() && it != "null"
            } ?: java.time.Instant.now().toString() else JSONObject.NULL)
            .put("reminderAt", selectedReminders.firstOrNull { it.kind == "absolute" }?.at ?: JSONObject.NULL)
            .put("reminderMinutes", selectedReminders.firstOrNull { it.kind == "relative" }?.minutes ?: JSONObject.NULL)
            .put("reminders", TaskReminder.array(selectedReminders))
            .put("projectId", projectId ?: JSONObject.NULL).put("categoryId", categoryId ?: JSONObject.NULL)
            .put("project", project)
            .put("recurrence", "none")
            .put("recurrenceMode", if (recurrence.enabled) recurrence.mode else "none")
            .put("recurrencePattern", if (recurrence.enabled) recurrence.pattern else "none")
            .put("recurrenceDays", JSONArray(if (recurrence.enabled) recurrence.days else emptyList<Int>()))
            .put("recurrenceInterval", recurrence.interval)
            .put("recurrenceStartDate", recurrence.rangeStart.takeIf { recurrence.enabled && it.isNotBlank() } ?: JSONObject.NULL)
            .put("recurrenceEndDate", recurrence.rangeEnd.takeIf { recurrence.enabled && it.isNotBlank() } ?: JSONObject.NULL)
            .put("recurrenceMonths", JSONArray(if (recurrence.enabled) recurrence.months else emptyList<Int>()))
            .put("recurrencePyatas", JSONArray(if (recurrence.enabled) recurrence.pyatas else emptyList<Int>()))
            .put("recurrenceContext", calendarContextJson(recurrence.calendarContext))
            .put("recurrenceInvalidDayPolicy", "skip")
            .put("recurrenceExcludedDates", JSONArray(if (recurrence.enabled) recurrenceExcludedDates else emptyList<String>()))
        return source.toString()
    }
    companion object {
        private fun ints(array: JSONArray?) = if (array == null) emptyList() else
            (0 until array.length()).mapNotNull { index -> array.optInt(index).takeIf { it > 0 } }
        private fun strings(array: JSONArray?) = if (array == null) emptyList() else
            (0 until array.length()).mapNotNull { index -> array.optString(index).takeIf { it.matches(Regex("\\d{4}-\\d{2}-\\d{2}")) } }
        fun from(record: TaskRecord, json: String): LocalTask {
            val v = JSONObject(json)
            val mode = v.optString("recurrenceMode").takeIf { it in setOf("classic", "genesis", "lunar") }
                ?: if (v.optString("recurrence") in setOf("daily", "weekly", "monthly", "yearly")) "classic" else "genesis"
            val enabled = if (v.has("recurrenceMode")) v.optString("recurrenceMode") in setOf("classic", "genesis", "lunar")
                else v.optString("recurrence") in setOf("daily", "weekly", "monthly", "yearly")
            val recurrence = RecurrenceConfig(enabled, mode,
                v.optString("recurrencePattern").takeUnless { it.isBlank() || it == "none" } ?: when (mode) {
                    "classic" -> v.optString("recurrence").takeIf { it in setOf("daily", "monthly", "yearly") } ?: "weekdays"
                    "lunar" -> "lunar-days"
                    else -> "pyata-days"
                }, ints(v.optJSONArray("recurrenceDays")).ifEmpty { listOf(1) },
                v.optInt("recurrenceInterval", 1), v.optString("recurrenceStartDate").takeUnless { it == "null" } ?: "",
                v.optString("recurrenceEndDate").takeUnless { it == "null" } ?: "",
                ints(v.optJSONArray("recurrenceMonths")), ints(v.optJSONArray("recurrencePyatas")), calendarContextFromJson(v.optJSONObject("recurrenceContext")))
            return LocalTask(record.id, v.getString("title"), v.optString("description"),
                v.getString("dueDate"), v.optString("time"), v.getString("zoneId"),
                v.getInt("priority"), record.done,
                if (v.isNull("reminderAt")) null else v.getLong("reminderAt"), record.revision,
                if (v.isNull("projectId")) null else v.getString("projectId"),
                if (v.isNull("categoryId")) null else v.getString("categoryId"), v.optString("project"),
                recurrence, strings(v.optJSONArray("recurrenceExcludedDates")), json, TaskReminder.from(v))
        }
    }
}

class TaskRepository(private val db: GenesisDatabase, private val cipher: LocalCipher,
    val scope: String, private val scheduler: ReminderScheduler) {
    private val mutation=ru.genesis.calendar.auth.NativeBackupMutationGuard(scope)
    private val dao get() = db.dao()
    private fun privateTask(value:JSONObject):LocalTask=LocalTask.from(TaskRecord(scope,value.getString("id"),"",value.optLong("updatedAt",0),value.optBoolean("done",false)),value.toString())
    val tasks = PrivatePersonalDocuments.observeSnapshot(scope,dao.observeTasks(scope).map { rows ->
        rows.map { LocalTask.from(it, cipher.decrypt(it.encrypted, "$scope/${it.id}")) }
            .sortedWith(compareBy<LocalTask> { it.done }.thenBy { it.date }.thenBy { it.time }.thenByDescending { it.priority })
    }){snapshot->val rows=snapshot.getJSONArray("tasks");(0 until rows.length()).map{privateTask(rows.getJSONObject(it))}
        .sortedWith(compareBy<LocalTask>{it.done}.thenBy{it.date}.thenBy{it.time}.thenByDescending{it.priority})}.flowOn(Dispatchers.IO)
    suspend fun get(id: String): LocalTask? {
      if(PrivatePersonalDocuments.isProtected(scope)){val rows=ru.genesis.calendar.security.NativePrivateProducts.snapshot(scope).getJSONArray("tasks");return(0 until rows.length()).map{rows.getJSONObject(it)}.find{it.getString("id")==id}?.let(::privateTask)}
      return dao.task(scope, id)?.takeUnless { it.deleted }?.let {
        LocalTask.from(it, cipher.decrypt(it.encrypted, "$scope/${it.id}"))
      }
    }
    private fun stagePrivateTask(snapshot:JSONObject,task:LocalTask):LocalTask{
        val rows=snapshot.getJSONArray("tasks");val values=(0 until rows.length()).map{rows.getJSONObject(it)};val prior=values.find{it.getString("id")==task.id}
        require(prior==null||prior.optLong("updatedAt",0)==task.revision){"E2EE_LOCAL_CONFLICT"}
        val structure=WorkspaceStructureCodec.decode(CloudAccountImporter.structureDocument(snapshot));val assigned=task.projectId?.takeUnless{it=="__genesis_inbox__"}?.let{id->structure.projects.find{it.id==id}?:error("E2EE_PROJECT_MISSING")}
        require(task.categoryId==null||task.categoryId in structure.categories.map{it.id}){"E2EE_CATEGORY_MISSING"}
        val revision=maxOf(System.currentTimeMillis(),(prior?.optLong("updatedAt",0)?:0)+1)
        val next=task.copy(revision=revision,project=assigned?.title?:"",categoryId=if(assigned!=null)assigned.categoryId else if(task.projectId=="__genesis_inbox__")null else task.categoryId)
        val value=JSONObject(next.json()).put("updatedAt",revision).put("syncToGoogle",false).put("syncAccountIds",JSONArray())
        value.remove("mindmapCreateOnly");value.remove("mindmapCreationPayload");value.remove("mindmapOccurrenceParentRevision")
        snapshot.put("tasks",JSONArray(values.filterNot{it.getString("id")==task.id}+value));return privateTask(value)
    }
    suspend fun save(task: LocalTask): LocalTask = scheduler.withMutation(scope) { saveLocked(task) }
    private suspend fun saveLocked(task: LocalTask, updateAlarms:Boolean=true): LocalTask {
        require(task.title.isNotBlank() && task.title.length <= 500)
        if(task.date.isNotBlank()) LocalDate.parse(task.date)
        else require(task.time.isBlank() && !task.recurrence.enabled && task.reminders.orEmpty().isEmpty() && task.reminderAt==null) { "Назначьте дату перед выбором времени, повторений и напоминаний." }
        if (task.time.isNotEmpty()) LocalTime.parse(task.time)
        ZoneId.of(task.zoneId)
        require(task.priority in 1..10)
        require((task.reminders?.size ?: 0) <= 5 && task.reminders?.distinctBy { it.key }?.size == task.reminders?.size)
        if (task.recurrence.enabled) {
            val dates = RecurrenceEngine(GenesisCalendar()).buildDates(task.date, task.recurrence)
            require(dates.isNotEmpty()) { "В выбранном периоде нет дат повторения." }
            require(dates.size <= 500) { "Серия может содержать не более 500 повторений." }
            require(task.recurrenceExcludedDates.all { runCatching { LocalDate.parse(it) }.isSuccess })
        }
        if(PrivatePersonalDocuments.isProtected(scope))return ru.genesis.calendar.security.NativePrivateProducts.mutate(scope){snapshot->snapshot to stagePrivateTask(snapshot,task)}
        val previous = dao.taskReminders(scope, task.id)
        val saved = db.withTransaction {
            mutation.check()
            val existing = dao.task(scope, task.id)
            require(existing == null || existing.revision == task.revision) { "Запись изменилась. Откройте её заново." }
            val structure = dao.document(scope, "structure")?.let { WorkspaceStructureCodec.decode(
                cipher.decrypt(it.encrypted, "$scope/structure"), it.revision) } ?: WorkspaceStructure()
            val assigned = task.projectId?.takeUnless { it == "__genesis_inbox__" }?.let { id ->
                structure.projects.find { it.id == id } ?: throw IllegalArgumentException("Проект не найден. Выберите его заново.")
            }
            require(task.categoryId == null || task.categoryId in structure.categories.map { it.id }) { "Категория не найдена." }
            val next = task.copy(revision = (existing?.revision ?: 0) + 1,
                project = assigned?.title ?: "",
                categoryId = if (assigned != null) assigned.categoryId else
                    if (task.projectId == "__genesis_inbox__") null else task.categoryId)
            val stored=JSONObject(next.json())
            if(stored.optBoolean("mindmapCreateOnly")&&!stored.has("mindmapCreationPayload"))stored.put("mindmapCreationPayload",JSONObject(stored.toString()).apply {remove("mindmapCreateOnly")})
            dao.putTask(TaskRecord(scope, task.id, cipher.encrypt(stored.toString(), "$scope/${task.id}"), next.revision, task.done))
            dao.putOutbox(OutboxRecord(scope, task.id, next.revision, UUID.randomUUID().toString()))
            dao.cancelReminders(scope, task.id)
            TaskReminderPlan.times(next).forEach { (occurrence, at) ->
                dao.putReminder(ReminderRecord(scope, task.id + ":" + occurrence, task.id,
                    occurrence.substringBefore(':'), next.revision, at))
            }
            next
        }
        if(updateAlarms) { previous.forEach(scheduler::cancel);scheduler.scheduleUpcomingLocked(scope) }
        return saved
    }
    suspend fun complete(id: String) {
        val task = get(id) ?: return
        if (!task.done) save(task.copy(done = true))
    }
    suspend fun saveOccurrence(draft:LocalTask):LocalTask = scheduler.withMutation(scope) {
        val meta=JSONObject(draft.sourceFieldsJson);val id=meta.getString("recurrenceSeriesId");val date=meta.getString("recurrenceOriginalDate")
        val parent=get(id) ?: throw IllegalArgumentException("Задача больше недоступна.")
        require(parent.revision==meta.getLong("mindmapOccurrenceParentRevision")) { "Запись изменилась. Откройте её заново." }
        val remaining=TaskOccurrences.withoutDate(parent,date)
        if(PrivatePersonalDocuments.isProtected(scope))return@withMutation ru.genesis.calendar.security.NativePrivateProducts.mutate(scope){snapshot->
            meta.remove("mindmapOccurrenceParentRevision")
            if(remaining!=null)stagePrivateTask(snapshot,remaining)else{
                val rows=snapshot.getJSONArray("tasks");snapshot.put("tasks",JSONArray((0 until rows.length()).map{rows.getJSONObject(it)}.filterNot{it.getString("id")==id}))
            }
            snapshot to stagePrivateTask(snapshot,draft.copy(sourceFieldsJson=meta.toString()))
        }
        val oldAlarms=dao.taskReminders(scope,id)+dao.taskReminders(scope,draft.id)
        meta.remove("mindmapOccurrenceParentRevision")
        val saved=db.withTransaction {
            mutation.check()
            if(remaining!=null) saveLocked(remaining,false)
            else {val row=requireNotNull(dao.task(scope,id));require(row.revision==parent.revision);dao.putTask(row.copy(deleted=true,revision=row.revision+1));dao.cancelReminders(scope,id);dao.putOutbox(OutboxRecord(scope,id,row.revision+1,UUID.randomUUID().toString()))}
            saveLocked(draft.copy(sourceFieldsJson=meta.toString()),false)
        }
        oldAlarms.forEach(scheduler::cancel);scheduler.scheduleUpcomingLocked(scope);saved
    }
    suspend fun excludeOccurrence(id: String, expectedRevision: Long, date: String) {
        val current = get(id) ?: throw IllegalArgumentException("Задача больше недоступна.")
        require(current.revision == expectedRevision) { "Запись изменилась. Откройте её заново." }
        val remaining = TaskOccurrences.withoutDate(current, date)
        if (remaining == null) delete(id, expectedRevision) else save(remaining)
    }
    suspend fun delete(id: String, expectedRevision: Long? = null) = scheduler.withMutation(scope) {
        if(PrivatePersonalDocuments.isProtected(scope))return@withMutation ru.genesis.calendar.security.NativePrivateProducts.mutate(scope){snapshot->
            val rows=snapshot.getJSONArray("tasks");val values=(0 until rows.length()).map{rows.getJSONObject(it)};val row=values.find{it.getString("id")==id}
            require(row==null||expectedRevision==null||row.optLong("updatedAt",0)==expectedRevision){"E2EE_LOCAL_CONFLICT"};snapshot.put("tasks",JSONArray(values.filterNot{it.getString("id")==id})) to Unit
        }
        val reminders = dao.taskReminders(scope, id)
        db.withTransaction {
            mutation.check()
            val row = dao.task(scope, id) ?: return@withTransaction
            require(expectedRevision == null || row.revision == expectedRevision) {
                "Запись изменилась. Откройте её заново."
            }
            dao.putTask(row.copy(deleted = true, revision = row.revision + 1))
            dao.cancelReminders(scope, id)
            dao.putOutbox(OutboxRecord(scope, id, row.revision + 1, UUID.randomUUID().toString()))
        }
        reminders.forEach(scheduler::cancel)
    }
    suspend fun snooze(id: String, revision: Long, durationMillis: Long = 10 * 60_000L): Boolean =
        reminderAction(id,revision,"snooze",durationMillis)

    suspend fun reminderAction(id: String, revision: Long, action: String,
        durationMillis: Long = 10 * 60_000L): Boolean = scheduler.withMutation(scope) {
        val reminder = dao.reminder(scope,id) ?: return@withMutation false
        if(reminder.revision!=revision || reminder.state!="delivered") return@withMutation false
        val task=get(reminder.taskId)?.takeUnless { it.done } ?: return@withMutation false
        if(task.revision!=revision) return@withMutation false
        if (action == "complete") { saveLocked(task.copy(done=true)); return@withMutation true }
        if (action !in setOf("snooze", "dismiss") || durationMillis <= 0) return@withMutation false
        val deferred = if (action == "snooze") ReminderRecord(scope, UUID.randomUUID().toString(),
            task.id, reminder.occurrenceId, revision, System.currentTimeMillis() + durationMillis) else null
        val claimed = db.withTransaction {
            mutation.check()
            if (dao.closeDeliveredReminder(scope, id, revision) != 1) false else {
                if (deferred != null) dao.putReminder(deferred)
                true
            }
        }
        if (claimed) {
            scheduler.cancel(reminder)
            scheduler.scheduleUpcomingLocked(scope)
        }
        claimed
    }
}
