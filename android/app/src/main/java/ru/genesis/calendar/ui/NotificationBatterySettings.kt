package ru.genesis.calendar.ui

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings

internal fun appBatterySettingsIntent(packageName: String) =
    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

/** Samsung documents this deep link for its Never sleeping apps list. */
internal fun samsungNeverSleepingAppsIntent(manufacturer: String = Build.MANUFACTURER): Intent? =
    if (manufacturer.equals("samsung", ignoreCase = true)) {
        Intent("com.samsung.android.sm.ACTION_OPEN_CHECKABLE_LISTACTIVITY")
            .setPackage("com.samsung.android.lool")
            .putExtra("activity_type", 2)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    } else null
