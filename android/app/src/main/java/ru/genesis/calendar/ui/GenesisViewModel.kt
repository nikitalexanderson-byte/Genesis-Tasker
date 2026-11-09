package ru.genesis.calendar.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.data.TaskOccurrences
import ru.genesis.calendar.data.TaskRepository

class GenesisViewModel(application: Application) : AndroidViewModel(application) {
    private val app = application as GenesisApplication
    private val completions = mutableMapOf<Pair<String, String?>, Job>()
    val error = MutableStateFlow<String?>(null)
    val saving = MutableStateFlow(false)
    val tasks = app.repository.tasks.catch { error.value = "Не удалось открыть защищённые данные: ключ недоступен." }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    fun save(task: LocalTask, onSaved: () -> Unit) = viewModelScope.launch { saveTask(task, onSaved) }
    fun saveEditor(task: LocalTask, onSaved: () -> Unit) {
        if (saving.value) return
        saving.value = true
        viewModelScope.launch {
            try { saveTask(task, onSaved) } finally { saving.value = false }
        }
    }
    private suspend fun saveTask(task: LocalTask, onSaved: () -> Unit,
        prepare: suspend (TaskRepository) -> LocalTask = { task }) {
        try {
            val repository = app.repository
            val draft = prepare(repository)
            if (org.json.JSONObject(draft.sourceFieldsJson).has("mindmapOccurrenceParentRevision"))
                repository.saveOccurrence(draft) else repository.save(draft)
            error.value = null
            onSaved()
        }
        catch (e: CancellationException) { throw e }
        catch (e: IllegalArgumentException) { error.value = e.message ?: "Проверьте данные задачи." }
        catch (_: Exception) { error.value = "Не удалось сохранить. Введённые данные остаются в форме." }
    }
    fun complete(task: LocalTask): Job = completeTask(task, null)
    fun completeOccurrence(task: LocalTask, date: String): Job = completeTask(task, date)

    private fun completeTask(task: LocalTask, date: String?): Job {
        val request = task.id to date
        completions[request]?.takeUnless { it.isCompleted }?.let { return it }
        // A second tap while persistence is pending represents the same checkbox request.
        // Build occurrence drafts inside the guarded coroutine too: imported metadata and
        // invalid dates must never throw directly from an Android click callback.
        val job = viewModelScope.launch(start = CoroutineStart.LAZY) {
            try {
                saveTask(task, {}, prepare = { repository ->
                    val current = repository.get(task.id)
                        ?: throw IllegalArgumentException("Задача больше недоступна.")
                    require(current.revision == task.revision) { "Запись изменилась. Откройте её заново." }
                    val draft = if (date == null) current else TaskOccurrences.standaloneDraft(current, date)
                    draft.copy(done = !task.done)
                })
            } finally { completions.remove(request) }
        }
        completions[request] = job
        job.start()
        return job
    }
    fun delete(task: LocalTask) = viewModelScope.launch {
        try { app.repository.delete(task.id, task.revision); error.value = null }
        catch(e: CancellationException) { throw e }
        catch(e: IllegalArgumentException) { error.value = e.message ?: "Запись изменилась. Откройте её заново." }
        catch(_: Exception) { error.value = "Не удалось удалить задачу. Повторите попытку." }
    }
    fun excludeOccurrence(task: LocalTask, date: String, onSaved: () -> Unit) = viewModelScope.launch {
        try { app.repository.excludeOccurrence(task.id, task.revision, date); error.value = null; onSaved() }
        catch (e: CancellationException) { throw e }
        catch (e: IllegalArgumentException) { error.value = e.message ?: "Проверьте дату повторения." }
        catch (_: Exception) { error.value = "Не удалось удалить это повторение." }
    }
}
