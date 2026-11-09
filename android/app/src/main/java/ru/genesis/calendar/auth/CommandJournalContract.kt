package ru.genesis.calendar.auth

import org.json.JSONObject

/** A separate purpose keeps commands from different features out of the same CAS/AAD scope. */
internal interface CommandJournalContract {
    val namespace: String
    val definitiveErrors: Set<String>
    fun validateEdit(edit: JSONObject): JSONObject
    fun command(edit: JSONObject, requestId: String): JSONObject
    fun verify(edit: JSONObject, data: JSONObject, project: String, queued: Boolean)
    fun rebase(edit: JSONObject, data: JSONObject, project: String): JSONObject
    fun receipt(command: JSONObject, response: JSONObject): JSONObject
}

internal object WorkflowJournalContract : CommandJournalContract {
    override val namespace = "workflow-v1"
    override val definitiveErrors = WorkflowLifecycle.errors
    override fun validateEdit(edit: JSONObject) = WorkflowLifecycle.validateEdit(edit)
    override fun command(edit: JSONObject, requestId: String) = WorkflowLifecycle.command(edit, requestId)
    override fun verify(edit: JSONObject, data: JSONObject, project: String, queued: Boolean) = WorkflowLifecycle.verify(edit, data, project, queued)
    override fun rebase(edit: JSONObject, data: JSONObject, project: String) = WorkflowLifecycle.rebase(edit, data, project)
    override fun receipt(command: JSONObject, response: JSONObject) = WorkflowLifecycle.receipt(command, response)
}
