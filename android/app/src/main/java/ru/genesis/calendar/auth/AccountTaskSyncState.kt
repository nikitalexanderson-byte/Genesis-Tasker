package ru.genesis.calendar.auth

/** Download status is independent of sign-in and outgoing mutations. */
data class AccountTaskSyncState(
    val scope: String = "",
    val loading: Boolean = false,
    val confirmed: Boolean = false,
    val issue: String? = null,
    val received: Int? = null,
    val available: Int? = null,
) {
    val notice: String? get() = issue ?: if (!confirmed && loading) "Загружаем задачи аккаунта…" else null
}
