package ru.genesis.calendar.auth

/** Deliberately separate from the old Stoicheion/archive protocols. */
internal object AuroraProtocol {
    fun allowedRoute(method: String, path: String): Boolean =
        path == "/aurora-workspace" && method in setOf("GET", "PUT") ||
        path == "/aurora-results" && method == "POST"
    fun allowedBilling(method: String, path: String): Boolean =
        allowedBillingRoute(method, path) && path.startsWith("/billing/modeling/")
    fun allowedScope(scope: String): Boolean = scope in setOf("aurora-workspace:v1", "aurora-workspace-base:v1") ||
        scope.matches(Regex("aurora-result:v1:[a-f0-9-]{36}"))
    fun cacheKind(owner: String, key: String): String {
        val prefix = "genesis-aurora-workspace-v1:$owner:"
        require(key.startsWith(prefix)) { "AURORA_CACHE_OWNER_MISMATCH" }
        val suffix = key.removePrefix(prefix)
        require(suffix in setOf("pending", "cache")) { "AURORA_CACHE_KEY_INVALID" }
        return "aurora-$suffix"
    }
}
