package ru.genesis.calendar.ui

import ru.genesis.calendar.auth.CloudAccountSnapshot

/** Auth identity arrives before its encrypted Room scope is activated. */
internal fun mindmapAccountUid(uid: String?, ready: Boolean, activeScope: String): String? =
    uid?.takeIf { ready && activeScope == CloudAccountSnapshot.scopeFor(it) }
