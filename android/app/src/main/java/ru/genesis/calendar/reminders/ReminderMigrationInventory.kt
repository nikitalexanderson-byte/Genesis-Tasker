package ru.genesis.calendar.reminders

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Read original registry values, never the ordinary pruning/normalizing readers.
 * Shared registries can include old account-scoped URI metadata. The protected
 * snapshot precedes strict shared-parser attribution; no foreign action runs. */
internal fun reminderMigrationRegistries(context:Context):JSONObject {
    val names=listOf("genesis_habit_reminder_preferences","genesis_habit_alarm_registry","genesis_sleep_alarm_registry",
        "genesis_moon_alarm_registry","genesis.advice.alarms.v1")
    return JSONObject().apply{for(name in names){
        val values=context.getSharedPreferences(name,Context.MODE_PRIVATE).all
        check(values.size<=10000){"E2EE_SOURCE_TOO_LARGE"}
        put(name,JSONObject().apply{for((key,value) in values.toSortedMap()){
            val raw=if(value is Set<*>){
                check(value.size<=10000&&value.all{it is String}){"E2EE_REMINDER_SOURCE_INVALID"}
                JSONArray(value.map{it as String}.sorted())
            }else value?:JSONObject.NULL
            put(key,raw)
        }})
    }}
}
