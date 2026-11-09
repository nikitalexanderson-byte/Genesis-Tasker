package ru.genesis.calendar.ui

import java.time.LocalDate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.first
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.AccountSettings
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.data.GoogleTaskList
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.data.TaskReminder
import ru.genesis.calendar.data.listTaskFields
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.Habit
import ru.genesis.calendar.domain.habits.HabitEngine
import ru.genesis.calendar.domain.habits.habitReminderTime

internal fun habitCalendarOccurrences(habit: Habit, first: LocalDate): List<LocalDate> {
    val engine = HabitEngine(GenesisCalendar())
    val scheduledHabit = habit.copy(active = true)
    val end = minOf(habit.schedule.endDate ?: first.plusYears(5).minusDays(1),
        first.plusYears(5).minusDays(1))
    val dates = ArrayList<LocalDate>()
    var date = first
    while (date <= end && dates.size < 500) {
        if (engine.isScheduled(scheduledHabit,date)) dates += date
        date = date.plusDays(1)
    }
    return dates
}

/** Uses the same encrypted task outbox as ordinary native tasks. IDs bind habits to those tasks. */
internal class HabitExternalSync(private val app: GenesisApplication, private val auth: AuthController) {
    private fun bindingId(habit: Habit, kind: String, route: String) =
        java.util.UUID.nameUUIDFromBytes("genesis-habit:${habit.id}:$kind:$route".toByteArray()).toString()

    suspend fun apply(habit: Habit, previous: Habit?, settings: AccountSettings?,
        taskLists: List<GoogleTaskList>, calendarMode: CalendarMode): Habit = withContext(Dispatchers.IO) {
        val tasksEnabled = habit.reminder.enabled && habit.reminder.syncToGoogleTasks
        val calendarEnabled = habit.reminder.enabled && habit.reminder.showInGoogleCalendar
        if (tasksEnabled || calendarEnabled) {
            require(app.workspaceScope.startsWith("account-") && settings?.authProvider == "google") {
                "Для синхронизации привычки войдите в аккаунт Google."
            }
        }
        val accounts = settings?.accounts.orEmpty()
        val taskAccount = settings?.routing?.defaultAccountIds?.firstOrNull { id ->
            accounts.any { it.id == id && it.tasksConnected }
        }?.let { id -> accounts.first { it.id == id } } ?: accounts.firstOrNull { it.tasksConnected }
        val calendarAccount = settings?.routing?.defaultAccountIds?.firstOrNull { id ->
            accounts.any { it.id == id && it.calendarConnected }
        }?.let { id -> accounts.first { it.id == id } } ?: accounts.firstOrNull { it.calendarConnected }
        require(!tasksEnabled || taskAccount != null) { "Подключите Google Tasks в настройках аккаунта." }
        require(!calendarEnabled || calendarAccount != null) { "Подключите Google Calendar в настройках аккаунта." }

        val nextDate = if (tasksEnabled || calendarEnabled) nextOccurrence(habit,LocalDate.now())
            ?: throw IllegalArgumentException("Для привычки не найдена ближайшая дата выполнения.") else null
        val title = "Привычка: ${habit.title}"
        val description = listOf(habit.description, "GENESIS является источником истины для этого повторения.",
            "Время напоминания: ${habitReminderTime(habit) ?: habit.reminder.time}")
            .filter(String::isNotBlank).joinToString("\n\n")
        var taskId: String? = null
        var eventId: String? = null
        if (tasksEnabled) {
            val account = requireNotNull(taskAccount)
            val list = taskLists.firstOrNull { it.accountId == account.id && it.title == "Привычки GENESIS" }
                ?: taskLists.firstOrNull { it.accountId == account.id && it.isDefault }
                ?: auth.createTaskList("Привычки GENESIS", account.id)
            val stableId = bindingId(habit,"task","${account.id}:${list.id}")
            val previousTask = previous?.reminder?.googleTaskId?.let { app.repository.get(it) }
            val existing = previousTask?.takeIf { old ->
                JSONObject(old.sourceFieldsJson).optString("googleTaskListId") == list.id
            } ?: app.repository.get(stableId)
            val fields = JSONObject(existing?.sourceFieldsJson ?: "{}")
            val routing = listTaskFields(list, calendarMode)
            routing.keys().forEach { key ->
                if (existing == null || key !in setOf("googleTaskId", "googleEventId", "googleLinks"))
                    fields.put(key, routing.get(key))
            }
            fields.put("tags", JSONArray().put("habit"))
                .put("habitOwnerId",habit.id).put("habitExternalKind","task")
            val saved = app.repository.save((existing ?: LocalTask(id = stableId,title = title)).copy(
                title = title, description = description, date = requireNotNull(nextDate).toString(),
                time = "", reminders = emptyList(), sourceFieldsJson = fields.toString()))
            taskId = saved.id
        }
        if (calendarEnabled) {
            val account = requireNotNull(calendarAccount)
            val stableId = bindingId(habit,"event",account.id)
            val previousEvent = previous?.reminder?.googleEventId?.let { app.repository.get(it) }
            val existing = previousEvent?.takeIf { old ->
                JSONObject(old.sourceFieldsJson).optJSONArray("syncAccountIds")?.let { ids ->
                    (0 until ids.length()).any { ids.optString(it) == account.id }
                } == true
            } ?: app.repository.get(stableId)
            val occurrences = habitCalendarOccurrences(habit,requireNotNull(nextDate))
            val recurrence = habit.schedule.recurrence.copy(enabled = occurrences.size > 1,
                rangeStart = requireNotNull(nextDate).toString(),
                rangeEnd = occurrences.lastOrNull()?.toString() ?: requireNotNull(nextDate).toString())
            val fields = JSONObject(existing?.sourceFieldsJson ?: "{}")
                .put("googleTaskListId", JSONObject.NULL).put("googleTaskListTitle", "")
                .put("googleAccountId", JSONObject.NULL).put("googleAccountEmail", "")
                .put("syncAccountIds", JSONArray().put(account.id))
                .put("syncToGoogle", true).put("createdIn", "genesis")
                .put("calendarMode", calendarMode.wireValue)
                .put("tags", JSONArray().put("habit"))
                .put("habitOwnerId",habit.id).put("habitExternalKind","event")
                .put("endDate", requireNotNull(nextDate).toString())
                .put("recurrenceDates", JSONArray(occurrences.map(LocalDate::toString)))
            val saved = app.repository.save((existing ?: LocalTask(id = stableId,title = title)).copy(
                title = title, description = description, date = requireNotNull(nextDate).toString(),
                time = (habitReminderTime(habit) ?: java.time.LocalTime.parse("09:00")).toString(),
                reminders = listOf(TaskReminder.relative(habit.reminder.minutesBefore)),
                recurrence = recurrence,
                sourceFieldsJson = fields.toString()))
            eventId = saved.id
        }
        val owned = app.repository.tasks.first().filter { task ->
            JSONObject(task.sourceFieldsJson).optString("habitOwnerId") == habit.id &&
                task.id != taskId && task.id != eventId
        }.map(LocalTask::id)
        (listOfNotNull(previous?.reminder?.googleTaskId?.takeIf { it != taskId },
            previous?.reminder?.googleEventId?.takeIf { it != eventId }) + owned).distinct().forEach { id ->
            app.repository.delete(id)
        }
        habit.copy(reminder = habit.reminder.copy(googleTaskId = taskId, googleEventId = eventId))
    }

    suspend fun advanceTaskAfterCompletion(habit: Habit, completedDate: LocalDate) = withContext(Dispatchers.IO) {
        val id = habit.reminder.googleTaskId ?: return@withContext
        val task = app.repository.get(id) ?: return@withContext
        if (LocalDate.parse(task.date) > completedDate) return@withContext
        val next = nextOccurrence(habit,maxOf(LocalDate.now(),completedDate.plusDays(1)))
        if (next == null) app.repository.save(task.copy(done = true))
        else app.repository.save(task.copy(date = next.toString(),done = false))
    }

    suspend fun remove(habit: Habit) = withContext(Dispatchers.IO) {
        val owned = app.repository.tasks.first().filter { task ->
            JSONObject(task.sourceFieldsJson).optString("habitOwnerId") == habit.id
        }.map(LocalTask::id)
        (listOfNotNull(habit.reminder.googleTaskId,habit.reminder.googleEventId) + owned)
            .distinct().forEach { app.repository.delete(it) }
    }

    private fun nextOccurrence(habit: Habit, from: LocalDate): LocalDate? {
        val engine = HabitEngine(GenesisCalendar())
        val scheduledHabit = habit.copy(active = true)
        val start = maxOf(from, habit.schedule.startDate)
        for (offset in 0L until 20_000L) {
            val date = start.plusDays(offset)
            if (habit.schedule.endDate?.let { date > it } == true) return null
            if (engine.isScheduled(scheduledHabit, date)) return date
        }
        return null
    }
}
