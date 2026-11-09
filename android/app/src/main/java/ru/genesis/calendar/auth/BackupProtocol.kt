package ru.genesis.calendar.auth

/** Backup planning has read access to personal sources, never arbitrary CRUD or external URLs. */
internal object BackupProtocol {
    fun allowedRoute(method: String,path: String): Boolean =
        method=="GET"&&path in setOf("/backup/v1/status","/workspace","/recovered-tasks","/mindmaps","/diary","/stoicheion-workspace","/aurora-workspace") ||
        method=="POST"&&path in setOf("/backup/v1/authorize","/backup/v1/server-snapshot","/backup/v1/preview","/backup/v1/commit")
    fun allowedScope(scope: String): Boolean = scope in setOf("workspace","stoicheion-workspace:v1","aurora-workspace:v1") ||
        scope.matches(Regex("(?:map:|diary-note:v1:)[A-Za-z0-9_-]{1,100}")) ||
        scope.matches(Regex("recovered-task:v1:restored-[a-f0-9]{32}"))
    fun personalWrite(method: String,path: String): Boolean = method!="GET"&&
        Regex("^/(?:workspace|tasks|mindmaps|diary|stoicheion-workspace|aurora-workspace|physis|recovered-tasks)(?:/|$)").containsMatchIn(path)
}
