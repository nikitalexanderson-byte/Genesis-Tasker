package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import org.json.JSONObject

internal interface SavedViewAccess {
    fun check()
    fun view(id: String): JSONObject
    fun preview(definition: JSONObject)
    fun send(command: JSONObject): JSONObject
}

/** A lost reply never becomes a second create, update or delete. */
internal class SavedViewDraftService(private val journal: PlanningJournal, private val account: String, private val access: SavedViewAccess) {
    private inline fun <T> checked(work: () -> T): T { access.check(); return work().also { access.check() } }
    private val scope = SavedViewProtocol.SCOPE
    fun load(): JSONObject? = checked { journal.load(account, scope) }
    fun save(stamp: String?, edit: JSONObject): JSONObject = checked { journal.save(account, scope, stamp, edit) }
    fun remove(stamp: String) = checked { journal.remove(account, scope, stamp) }
    private fun current(stamp: String) = requireNotNull(load()).also { require(it.getString("stamp") == stamp) { "PLANNING_DRAFT_CHANGED" } }
    private fun fresh(edit: JSONObject): JSONObject {
        val data = JSONObject()
        edit.optJSONObject("source")?.let { source -> data.put("view", checked { access.view(source.getString("id")) }) }
        if (edit.getString("kind") == "view-save") checked { access.preview(SavedViewProtocol.ready(edit.getJSONObject("definition"))) }
        return data
    }
    fun prepare(stamp: String): JSONObject {
        val record = current(stamp)
        require(record.getString("phase") == "editing") { "PLANNING_DRAFT_PENDING" }
        return checked { journal.prepare(account, scope, stamp, fresh(record.getJSONObject("edit")), false) }
    }
    fun rebase(stamp: String): JSONObject {
        val record = current(stamp)
        val source = requireNotNull(record.getJSONObject("edit").optJSONObject("source")) { "VIEW_INVALID" }
        val data = JSONObject().put("view", checked { access.view(source.getString("id")) })
        return checked { journal.rebase(account, scope, stamp, data) }
    }
    fun send(stamp: String): JSONObject {
        val record = current(stamp)
        if (record.getString("phase") == "received") return record
        require(record.getString("phase") == "pending") { "PLANNING_DRAFT_PENDING" }
        if (record.getInt("attempts") == 0) SavedViewJournalContract.verify(record.getJSONObject("edit"), fresh(record.getJSONObject("edit")), scope, false)
        val attempted = checked { journal.beginAttempt(account, scope, stamp) }
        try {
            val response = checked { access.send(JSONObject(attempted.getString("command"))) }
            return checked { journal.succeeded(account, scope, attempted.getString("stamp"), response) }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            access.check()
            val code = when (failure) { is AuthApiError -> failure.code; is AuthFailure -> sharedFailureCode(failure)
                else -> failure.message?.takeIf { Regex("[A-Z][A-Z0-9_]{0,99}").matches(it) } ?: "PROTOCOL" }
            checked { journal.failed(account, scope, attempted.getString("stamp"), code) }
            throw failure
        }
    }
}
