package ru.genesis.calendar.reminders

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.MainActivity
import ru.genesis.calendar.R
import ru.genesis.calendar.data.CloudAccountImporter
import ru.genesis.calendar.data.HabitDocument
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.data.TaskRecord
import ru.genesis.calendar.data.TaskReminderPlan
import ru.genesis.calendar.security.NativePrivateProducts
import ru.genesis.calendar.security.UpdateGate
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Foreground-only compilation of an alarm projection. The independent local
 * key opens ONLY opaque delivery tokens/times, never vault keys or content.
 * Receivers/workers have no product reader, root, title, task ID or writer.
 * A bounded rolling plan survives lock, process death and reboot. */
internal object PrivateReminderProjection {
    private const val ALIAS = "genesis.private-reminder-projection.v1"
    private const val MAX_BYTES = 512 * 1024
    private const val CHANNEL = "genesis.private.unlock.v1"
    private val mutation = Any()
    private fun checkScope(value:String) = value.also { check(it.matches(Regex("account-[a-f0-9]{32}"))) { "E2EE_REMINDER_PROJECTION_INVALID" } }
    private fun file(context:Context,scope:String) = AtomicFile(File(context.noBackupFilesDir,"private-reminders-${checkScope(scope)}.v1"))
    private fun key(create:Boolean):SecretKey {
        val store=KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS,null) as? SecretKey)?.let { return it }
        check(create) { "E2EE_REMINDER_PROJECTION_UNAVAILABLE" }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    private fun aad(scope:String) = "GENESIS-PRIVATE-REMINDER-PROJECTION\u0000v1\u0000$scope".toByteArray(Charsets.UTF_8)
    private fun read(context:Context,scope:String):JSONObject? {
        val source=file(context,scope)
        if(!source.baseFile.exists()&&!File(source.baseFile.path+".bak").exists()&&!File(source.baseFile.path+".new").exists())return null
        val encrypted=source.openRead().use { input ->
            val buffer=ByteArray(MAX_BYTES+30);var size=0
            try { while(size<buffer.size){val count=input.read(buffer,size,buffer.size-size);if(count<0)break;size+=count};check(size in 30..MAX_BYTES+29) { "E2EE_REMINDER_PROJECTION_INVALID" };buffer.copyOf(size) } finally { buffer.fill(0) }
        }
        try {
            check(encrypted[0]==1.toByte()) { "E2EE_REMINDER_PROJECTION_INVALID" }
            val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(false),GCMParameterSpec(128,encrypted.copyOfRange(1,13)));cipher.updateAAD(aad(scope))
            val raw=cipher.doFinal(encrypted.copyOfRange(13,encrypted.size))
            try { return validate(JSONObject(raw.toString(Charsets.UTF_8)),scope) } finally { raw.fill(0) }
        } finally { encrypted.fill(0) }
    }
    private fun validate(value:JSONObject,scope:String):JSONObject {
        check(value.keys().asSequence().toSet()==setOf("version","scope","generatedAt","expiresAt","expiryNotified","rows")&&value.getInt("version")==1&&value.getString("scope")==scope) { "E2EE_REMINDER_PROJECTION_INVALID" };value.getBoolean("expiryNotified")
        val start=value.getLong("generatedAt");val end=value.getLong("expiresAt");check(start>0&&end>start&&end-start<=45L*86400000) { "E2EE_REMINDER_PROJECTION_INVALID" }
        val rows=value.getJSONArray("rows");check(rows.length()<=2048);val ids=mutableSetOf<String>()
        for(at in 0 until rows.length()) { val row=rows.getJSONObject(at);check(row.keys().asSequence().toSet()==setOf("token","at","delivered"));check(row.getString("token").matches(Regex("[a-f0-9]{64}"))&&ids.add(row.getString("token")));check(row.getLong("at") in start..end);row.getBoolean("delivered") }
        return value
    }
    private fun write(context:Context,scope:String,value:JSONObject) {
        val raw=validate(value,scope).toString().toByteArray(Charsets.UTF_8)
        try {
            check(raw.size<=MAX_BYTES);val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key(true));cipher.updateAAD(aad(scope));check(cipher.iv.size==12)
            val encrypted=byteArrayOf(1)+cipher.iv+cipher.doFinal(raw)
            try { val target=file(context,scope);val output=target.startWrite();try { output.write(encrypted);target.finishWrite(output) } catch(error:Exception) { target.failWrite(output);throw error } }
            finally { encrypted.fill(0) }
        } finally { raw.fill(0) }
    }
    private fun pending(context:Context)=PendingIntent.getBroadcast(context,7366,Intent(context,PrivateReminderReceiver::class.java).apply {
        action="ru.genesis.calendar.PRIVATE_REMINDER_WAKE";data=Uri.parse("genesis://private-reminder/wake")
    },PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    private fun schedule(context:Context,value:JSONObject?,now:Long) {
        val alarms=context.getSystemService(AlarmManager::class.java);val operation=pending(context);alarms.cancel(operation)
        if(UpdateGate.blocked.value||value==null||value.getLong("expiresAt")<=now)return
        val rows=value.getJSONArray("rows");var at=value.getLong("expiresAt")
        for(index in 0 until rows.length()) { val row=rows.getJSONObject(index);if(!row.getBoolean("delivered")&&row.getLong("at")>=now-6*3600000L)at=minOf(at,maxOf(now+1000,row.getLong("at"))) }
        try { if(Build.VERSION.SDK_INT<31||alarms.canScheduleExactAlarms())alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,operation) else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,operation) }
        catch(_:SecurityException) { alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,operation) }
    }
    /** Called only with a live foreground capability. Build from the ordinary
     * product codecs/rules; private task content never enters an OS Intent. */
    fun refresh(context:Context,scope:String,snapshot:JSONObject,current:()->Unit) {
        checkScope(scope);current();val now=System.currentTimeMillis();val expires=now+8*86400000L;val times=linkedMapOf<String,Long>()
        fun add(id:String,at:Long) { if(at in now..expires)times[id]=at }
        val tasks=snapshot.getJSONArray("tasks")
        for(index in 0 until tasks.length()) { current();val row=tasks.getJSONObject(index);val task=LocalTask.from(TaskRecord(scope,row.getString("id"),"",row.optLong("updatedAt"),row.optBoolean("done")),row.toString());for((occurrence,at)in TaskReminderPlan.times(task))add("task:${task.id}:$occurrence:$at",at) }
        current();val habits=HabitDocument.decode(CloudAccountImporter.habitsDocument(snapshot),0);val zone=ZoneId.systemDefault()
        for(row in planHabitNotifications(habits,Instant.ofEpochMilli(now).atZone(zone).toLocalDate(),Instant.ofEpochMilli(now),zone,"en",8,habitReminderFrequency(context,scope).maxPerDay))add("habit:${row.key}",row.at.toEpochMilli())
        current();synchronized(mutation) {
            current();val old=read(context,scope);val delivered=mutableSetOf<String>();old?.getJSONArray("rows")?.let { rows ->for(index in 0 until rows.length()){val row=rows.getJSONObject(index);if(row.getBoolean("delivered"))delivered+=row.getString("token")} }
            // The source digest stays inside the encrypted projection.
            val rows=JSONArray();for((id,at)in times.entries.sortedBy { it.value }.take(2048)) { val token=MessageDigest.getInstance("SHA-256").digest("$scope\u0000$id".toByteArray()).joinToString(""){"%02x".format(it)};rows.put(JSONObject().put("token",token).put("at",at).put("delivered",token in delivered)) }
            val last=if(times.size>2048)minOf(expires,rows.getJSONObject(rows.length()-1).getLong("at")+60000)else expires
            val next=JSONObject().put("version",1).put("scope",scope).put("generatedAt",now).put("expiresAt",maxOf(now+1000,last)).put("expiryNotified",false).put("rows",rows)
            current();write(context,scope,next);current();schedule(context,next,now)
        }
    }
    fun restore(context:Context) {
        val app=context.applicationContext as GenesisApplication;val scope=app.workspaceScope
        if(!NativePrivateProducts.isProtected(scope)){synchronized(mutation){schedule(context,null,System.currentTimeMillis())};return}
        synchronized(mutation) { schedule(context,read(context,scope),System.currentTimeMillis()) }
    }
    fun deliver(context:Context) {
        val app=context.applicationContext as GenesisApplication;val scope=app.workspaceScope
        if(UpdateGate.blocked.value||!NativePrivateProducts.isProtected(scope))return
        synchronized(mutation) {
            val value=read(context,scope)?:return;val now=System.currentTimeMillis();if(value.getLong("expiresAt")<=now){schedule(context,null,now);if(!value.getBoolean("expiryNotified")){value.put("expiryNotified",true);write(context,scope,value);synchronized(app.adviceNotificationGuard){if(app.workspaceScope==scope&&!UpdateGate.blocked.value)notify(context)}};return}
            val rows=value.getJSONArray("rows");var due=false
            for(index in 0 until rows.length()) { val row=rows.getJSONObject(index);if(!row.getBoolean("delivered")&&row.getLong("at")<=now){if(row.getLong("at")>=now-6*3600000L)due=true;row.put("delivered",true)} }
            // Persist the acknowledgement before the side effect: no replay
            // storm after process death. A crash can omit one generic alert.
            write(context,scope,value);schedule(context,value,now)
            if(due)synchronized(app.adviceNotificationGuard){if(app.workspaceScope==scope&&!UpdateGate.blocked.value)notify(context)}
        }
    }
    private fun notify(context:Context) {
        val manager=context.getSystemService(android.app.NotificationManager::class.java)
        manager.createNotificationChannel(android.app.NotificationChannel(CHANNEL,"GENESIS",android.app.NotificationManager.IMPORTANCE_DEFAULT))
        val open=PendingIntent.getActivity(context,7319,Intent(context,MainActivity::class.java).apply { data=Uri.parse("genesis://private-unlock");flags=Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP },PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val note=NotificationCompat.Builder(context,CHANNEL).setSmallIcon(R.drawable.ic_notification_task).setContentTitle("GENESIS").setContentIntent(open).setCategory(NotificationCompat.CATEGORY_REMINDER).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setAutoCancel(true).build()
        try { NotificationManagerCompat.from(context).notify("private-unlock",7319,note) } catch(_:SecurityException) { /* Android permission remains user-controlled. */ }
    }
}

class PrivateReminderReceiver:BroadcastReceiver() {
    override fun onReceive(context:Context,intent:Intent) {
        if(intent.action!="ru.genesis.calendar.PRIVATE_REMINDER_WAKE")return
        val pending=goAsync();val app=context.applicationContext as GenesisApplication
        app.appScope.launchPrivateReminder { try { PrivateReminderProjection.deliver(context) } finally { pending.finish() } }
    }
}

private fun kotlinx.coroutines.CoroutineScope.launchPrivateReminder(block:()->Unit) = launch { runCatching(block) }
