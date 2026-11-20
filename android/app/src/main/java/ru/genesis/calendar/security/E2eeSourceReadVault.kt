package ru.genesis.calendar.security

/** Read-only source records. No signing key, commit, scope import or enrollment.
 * Capture/publication still require the separate active UnlockedE2eeVault. */
interface E2eeSourceReadVault {
    fun assertOpen()
    fun localIdentity(): UnlockedE2eeVault.LocalIdentity
    fun read(domain: String, objectId: String): UnlockedE2eeVault.Opened?
    fun listLocal(domain: String, objectPrefix: String): List<String>
}
