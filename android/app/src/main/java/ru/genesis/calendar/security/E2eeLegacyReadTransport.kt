package ru.genesis.calendar.security
import org.json.JSONObject

/** Read-only feature port shared by authenticated capture and original replay.
 * Neither implementation exposes arbitrary HTTP, writes or new root material. */
interface E2eeLegacyReadTransport{
    suspend fun legacyWorkspace(context:E2eeMigrationSourceContext):JSONObject
    suspend fun legacyAurora(context:E2eeMigrationSourceContext):JSONObject
    suspend fun legacyStoicheion(context:E2eeMigrationSourceContext):JSONObject
    suspend fun legacyAdvice(context:E2eeMigrationSourceContext):JSONObject
    suspend fun legacyTasks(context:E2eeMigrationSourceContext):JSONObject
    suspend fun legacyDiary(context:E2eeMigrationSourceContext):JSONObject
    suspend fun legacyMindmaps(context:E2eeMigrationSourceContext):JSONObject
    suspend fun legacyMindmapsPage(context:E2eeMigrationSourceContext,table:String,offset:Long):JSONObject
    suspend fun legacyPhysisPage(context:E2eeMigrationSourceContext,table:String,offset:Long):JSONObject
    suspend fun legacyRemindersPage(context:E2eeMigrationSourceContext,table:String,offset:Long):JSONObject
    suspend fun legacyArchiveFragment(context:E2eeMigrationSourceContext,table:String,offset:Long,byteOffset:Long):JSONObject
    suspend fun legacySharedMindmapsPage(context:E2eeMigrationSourceContext,table:String,offset:Long):JSONObject
    suspend fun legacyPrivatePathFragment(context:E2eeMigrationSourceContext,pathId:String,table:String,offset:Long,byteOffset:Long):JSONObject
    suspend fun legacyPrivatePathBatch(context:E2eeMigrationSourceContext,pathId:String,table:String,offset:Long,byteOffset:Long):JSONObject=legacyPrivatePathFragment(context,pathId,table,offset,byteOffset)
}
