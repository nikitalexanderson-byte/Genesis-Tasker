package ru.genesis.calendar.auth

import kotlinx.coroutines.asContextElement
import java.util.UUID

/** A real resumed Activity owns the visit. Background work cannot manufacture account activity. */
internal object NativeActivityVisit {
    @Volatile private var visit: String? = null
    private val background = ThreadLocal<Boolean>()

    fun onResume() { visit = UUID.randomUUID().toString() }
    fun onPause() { visit = null }

    fun foregroundVisitId(): String? = visit.takeUnless { background.get() == true }

    fun requestContext(inBackground: Boolean = background.get() == true) = background.asContextElement(inBackground)

    fun headers(): Map<String, String> {
        val current = visit.takeUnless { background.get() == true }
        return if (current == null) mapOf("X-Genesis-Foreground" to "0")
        else mapOf("X-Genesis-Foreground" to "1", "X-Genesis-Visit" to current)
    }
}
