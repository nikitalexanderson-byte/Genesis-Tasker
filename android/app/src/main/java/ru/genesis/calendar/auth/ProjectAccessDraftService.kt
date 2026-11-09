package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import org.json.JSONObject

internal interface ProjectAccessDraftAccess {
    fun check()
    fun state(space: String, user: String): JSONObject
    fun preview(space: String, user: String, draft: JSONObject): JSONObject
    fun send(space: String, user: String, body: JSONObject): JSONObject
    fun hasTaskQueue(): Boolean
}

/** Permission writes require an explicitly reviewed preview; unresolved writes keep their exact body. */
internal class ProjectAccessDraftService(private val journal: PlanningJournal, private val account: String, private val access: ProjectAccessDraftAccess) {
    private fun <T> checked(action: () -> T): T { access.check(); return action().also { access.check() } }
    private fun scope(space: String, user: String) = ProjectAccessProtocol.scope(space, user)
    fun load(space: String, user: String) = checked { journal.load(account, scope(space, user)) }
    fun save(space: String, user: String, stamp: String?, edit: JSONObject): JSONObject = checked {
        require(edit.getString("spaceId") == space && edit.getString("userId") == user) { "INVALID_PROJECT_ACCESS" }
        journal.save(account, scope(space, user), stamp, edit)
    }
    fun remove(space: String, user: String, stamp: String) = checked { journal.remove(account, scope(space, user), stamp) }
    fun copies(space: String, user: String) = checked { journal.copies(account, scope(space, user)) }
    fun saveCopy(space: String, user: String, id: String, stamp: String?, edit: JSONObject): JSONObject = checked {
        require(edit.getString("spaceId") == space && edit.getString("userId") == user) { "INVALID_PROJECT_ACCESS" }
        journal.saveCopy(account, scope(space, user), id, stamp, edit)
    }
    fun useCopy(space: String, user: String, id: String, copyStamp: String, stamp: String?) = checked { journal.useCopy(account, scope(space, user), id, copyStamp, stamp) }
    fun removeCopy(space: String, user: String, id: String, stamp: String) = checked { journal.removeCopy(account, scope(space, user), id, stamp) }
    private fun current(space: String, user: String, stamp: String) = requireNotNull(load(space, user)).also {
        require(it.getString("stamp") == stamp) { "PLANNING_DRAFT_CHANGED" }
    }
    private fun freshPreview(space: String, user: String, edit: JSONObject) = checked {
        ProjectAccessProtocol.preview(edit, access.preview(space, user, ProjectAccessProtocol.draft(edit.getJSONObject("draft"), true)))
    }
    fun preview(space: String, user: String, stamp: String): JSONObject {
        val record = current(space, user, stamp)
        require(record.getString("phase") == "editing") { "PLANNING_DRAFT_PENDING" }
        val preview = freshPreview(space, user, record.getJSONObject("edit"))
        val reviewed = ProjectAccessProtocol.reviewed(record.getJSONObject("edit"), preview)
        return checked { JSONObject().put("record", journal.save(account, scope(space, user), stamp, reviewed)).put("preview", preview) }
    }
    fun prepare(space: String, user: String, stamp: String): JSONObject {
        val record = current(space, user, stamp)
        require(record.getString("phase") == "editing") { "PLANNING_DRAFT_PENDING" }
        val preview = freshPreview(space, user, record.getJSONObject("edit")); val queued = checked { access.hasTaskQueue() }
        return checked { journal.prepare(account, scope(space, user), stamp, preview, queued) }
    }
    fun rebase(space: String, user: String, stamp: String): JSONObject {
        current(space, user, stamp)
        val snapshot = checked { ProjectAccessProtocol.snapshot(space, user, access.state(space, user)) }
        require(snapshot.getString("memberRole") !in setOf("owner", "admin")) { "PROJECT_ACCESS_MANAGER_UNRESTRICTED" }
        return checked { JSONObject().put("record", journal.rebase(account, scope(space, user), stamp, snapshot)).put("state", snapshot) }
    }
    fun send(space: String, user: String, stamp: String): JSONObject {
        val record = current(space, user, stamp)
        if (record.getString("phase") == "received") return record
        require(record.getString("phase") == "pending") { "PLANNING_DRAFT_PENDING" }
        // Server GET rechecks current owner access, but never replaces a previously confirmed command.
        checked { ProjectAccessProtocol.snapshot(space, user, access.state(space, user)) }
        require(!checked { access.hasTaskQueue() }) { "PROJECT_ACCESS_LOCAL_QUEUE" }
        val attempted = checked { journal.beginAttempt(account, scope(space, user), stamp) }
        try {
            val response = checked { access.send(space, user, ProjectAccessProtocol.body(JSONObject(attempted.getString("command")))) }
            return checked { journal.succeeded(account, scope(space, user), attempted.getString("stamp"), response) }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            access.check()
            val code = when (failure) {
                is AuthApiError -> failure.code
                is AuthFailure -> sharedFailureCode(failure)
                else -> failure.message?.takeIf { it in ProjectAccessProtocol.errors || it == "PLANNING_DRAFT_STORAGE" } ?: "PROTOCOL"
            }
            journal.failed(account, scope(space, user), attempted.getString("stamp"), code)
            throw failure
        }
    }
}
