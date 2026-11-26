package ru.genesis.calendar.security

import org.json.JSONObject

/** Historical custody can verify and decrypt; it has no signing identity,
 * writer, enrollment or network transport. */
interface E2eeDeviceReadView{
    val ownerId:String
    val deviceId:String
    val authorityPin:JSONObject
    val vault:E2eeDeviceReadVault
    fun requireOpen()
    fun readKeys():E2eeKeys.ReadKeys
    fun readSavedDirectory(scopeId:String,onVerified:((E2eeDirectory.Verified)->Unit)?=null):E2eeDirectory.Verified?
}
interface E2eeDeviceReadVault:E2eeSourceReadVault{
    fun listMigrationOriginalParts():List<String>
    fun listMigrationHistoryCopies():List<String>
    fun listMigrationStateRoles():List<String>
    fun listProductJobHistory():List<String>
    fun listProductControlHistory():List<String>
    fun listMigrationPlanOutputs():Pair<List<String>,List<String>>
}
