package ru.genesis.calendar.reminders

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.MainActivity
import ru.genesis.calendar.R
import ru.genesis.calendar.security.NativePrivateProducts

/** A retained alarm/action may wake a locked private account. It must not
 * open legacy Room content or mutate a task with an unavailable device key.
 * A generic notification offers a foreground entry and carries no source ID. */
internal fun privateReminderForegroundOnly(context:Context,intent:Intent):Boolean{
    val app=context.applicationContext as GenesisApplication;val scope=intent.getStringExtra("scope")?:app.workspaceScope
    if(!NativePrivateProducts.isProtected(scope))return false
    if(scope!=app.workspaceScope)return true
    val channel="genesis.private.unlock.v1";val manager=context.getSystemService(android.app.NotificationManager::class.java)
    manager.createNotificationChannel(android.app.NotificationChannel(channel,"GENESIS",android.app.NotificationManager.IMPORTANCE_DEFAULT))
    val open=PendingIntent.getActivity(context,7319,Intent(context,MainActivity::class.java).apply{data=Uri.parse("genesis://private-unlock");flags=Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP},PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val note=NotificationCompat.Builder(context,channel).setSmallIcon(R.drawable.ic_notification_task).setContentTitle("GENESIS").setContentIntent(open).setCategory(NotificationCompat.CATEGORY_REMINDER).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setAutoCancel(true).setOnlyAlertOnce(true).build()
    try{NotificationManagerCompat.from(context).notify("private-unlock",7319,note)}catch(_:SecurityException){/* Keep the encrypted input and queues unchanged. */}
    return true
}
