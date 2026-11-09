package ru.genesis.calendar.reminders

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import ru.genesis.calendar.R
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.MainActivity
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.CloudAccountSnapshot

/** Local device notification after a server claim. No push, mail or hidden charge. */
internal object SupportTipsNotifications{
    private const val CHANNEL="genesis.support.v1"
    private const val ID=7422
    suspend fun deliver(context:Context,controller:AuthController){
        if(!NotificationManagerCompat.from(context).areNotificationsEnabled())return
        if(Build.VERSION.SDK_INT>=33&&context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return
        val before=controller.state.value
        val uid=before.user?.uid?:return
        if(!before.ready||before.requiresSignIn)return
        val app=context.applicationContext as GenesisApplication
        val scope=CloudAccountSnapshot.scopeFor(uid)
        if(app.workspaceScope!=scope)return
        val manager=context.getSystemService(NotificationManager::class.java)
        if(Build.VERSION.SDK_INT>=26){
            manager.createNotificationChannel(NotificationChannel(CHANNEL,"GENESIS",NotificationManager.IMPORTANCE_DEFAULT))
            if(manager.getNotificationChannel(CHANNEL)?.importance==NotificationManager.IMPORTANCE_NONE)return
        }
        try{
            val result=controller.claimSupportNotice(uid,"phone")
            if(!result.getBoolean("show")||controller.state.value.user?.uid!=uid||app.workspaceScope!=scope)return
            val language=before.accountSettings?.language?:"ru"
            val copy=context.assets.open("originals/i18n/support-notice-copy.json").bufferedReader(Charsets.UTF_8).use{JSONObject(it.readText()).getJSONObject(language)}
            val intent=supportTipsOpenIntent(context,scope)
            val action=PendingIntent.getActivity(context,ID,intent,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val note=NotificationCompat.Builder(context,CHANNEL).setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(copy.getString("title")).setContentText(copy.getString("body"))
                .setStyle(NotificationCompat.BigTextStyle().bigText(copy.getString("body")))
                .setContentIntent(action).addAction(0,copy.getString("action"),action).setAutoCancel(true).build()
            NotificationManagerCompat.from(context).notify("genesis-support",ID,note)
        }catch(cancelled:CancellationException){throw cancelled}catch(_:Exception){/* Background retry occurs in the next scheduled sync. */}
    }
}

/** Notification delivery never creates an invoice; the primary settings button handles the explicit click. */
internal fun supportTipsOpenIntent(context:Context,scope:String)=Intent(context,MainActivity::class.java).apply{
    data=Uri.Builder().scheme("genesis").authority("section").appendPath("donation").appendPath(scope).build()
    putExtra("scope",scope)
    putExtra("openSection","donation")
    flags=Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
}
