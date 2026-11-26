package ru.genesis.calendar.auth

/** Deliberately separate from the old Stoicheion/archive protocols. */
internal object AuroraProtocol {
    private val journalSuffix=Regex("pending:writer:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}:[1-9][0-9]{0,15}:pending")
    private fun validCacheSuffix(suffix:String):Boolean = suffix in setOf("pending","cache") ||
        journalSuffix.matches(suffix) && (suffix.split(':')[3].toLongOrNull()?:Long.MAX_VALUE)<=9_007_199_254_740_991L
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
        require(validCacheSuffix(suffix)) { "AURORA_CACHE_KEY_INVALID" }
        return "aurora-$suffix"
    }
    fun cacheKey(owner:String,kind:String):String? {
        if(!kind.startsWith("aurora-"))return null
        val suffix=kind.removePrefix("aurora-")
        return if(validCacheSuffix(suffix))"genesis-aurora-workspace-v1:$owner:$suffix" else null
    }
}
