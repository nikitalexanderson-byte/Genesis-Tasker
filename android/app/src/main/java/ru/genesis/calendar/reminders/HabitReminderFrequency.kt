package ru.genesis.calendar.reminders

import android.content.Context

/** Delivery preferences belong to this device, like Android notification permissions. */
internal data class HabitReminderFrequency(val maxPerDay: Int = 128, val snoozeMinutes: Int = 10)

internal fun habitReminderFrequency(context: Context, scope: String): HabitReminderFrequency {
    val saved = context.getSharedPreferences("genesis_habit_reminder_preferences", Context.MODE_PRIVATE)
    return HabitReminderFrequency(saved.getInt("$scope:max", 128).takeIf { it in setOf(4, 12, 24, 64, 128) } ?: 128,
        saved.getInt("$scope:snooze", 10).takeIf { it in setOf(5, 10, 15, 30, 60) } ?: 10)
}

internal suspend fun saveHabitReminderFrequency(context: Context, scope: String, value: HabitReminderFrequency) {
    if(ru.genesis.calendar.security.NativePrivateProducts.isProtected(scope)) {
        val app=context.applicationContext as ru.genesis.calendar.GenesisApplication
        val account=ru.genesis.calendar.security.NativePrivateProducts.currentAccount(scope);account.requireOpen();check(app.workspaceScope==scope)
        require(value.maxPerDay in setOf(4,12,24,64,128)&&value.snoozeMinutes in setOf(5,10,15,30,60))
        check(context.getSharedPreferences("genesis_habit_reminder_preferences",Context.MODE_PRIVATE).edit().putInt("$scope:max",value.maxPerDay).putInt("$scope:snooze",value.snoozeMinutes).commit())
        account.requireOpen();ru.genesis.calendar.security.NativePrivateProducts.changed(scope);return
    }
    legacyReminderOperation(context,scope){
    require(value.maxPerDay in setOf(4, 12, 24, 64, 128) && value.snoozeMinutes in setOf(5, 10, 15, 30, 60))
    check(context.getSharedPreferences("genesis_habit_reminder_preferences", Context.MODE_PRIVATE).edit()
        .putInt("$scope:max", value.maxPerDay).putInt("$scope:snooze", value.snoozeMinutes).commit())
    }
}
