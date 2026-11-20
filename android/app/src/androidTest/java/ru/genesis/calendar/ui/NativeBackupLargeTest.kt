package ru.genesis.calendar.ui

import android.view.View
import android.webkit.WebView
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.core.content.FileProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.UiController
import androidx.test.espresso.ViewAction
import androidx.test.espresso.matcher.RootMatchers.isDialog
import androidx.test.espresso.matcher.ViewMatchers.isAssignableFrom
import org.hamcrest.Matcher
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.data.BackupGateway
import ru.genesis.calendar.data.GenesisBackupContainer
import ru.genesis.calendar.security.WorkspaceCipher
import java.io.*
import java.security.DigestOutputStream
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import javax.crypto.Cipher
import javax.crypto.CipherOutputStream
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Actual production BackupPanel, native File transport, decrypt/validation,
 * prepareBackupRestore and JCA seal/preview. Only HTTP and picker choice are
 * synthetic. No large Room fixture or giant native plaintext JSON is created. */
class NativeBackupLargeTest {
    @get:Rule val compose=createAndroidComposeRule<PagerTestActivity>()
    private fun js(expression:String):String {
        val result=AtomicReference<String?>()
        onView(isAssignableFrom(WebView::class.java)).inRoot(isDialog()).perform(object:ViewAction {
            override fun getConstraints():Matcher<View> = isAssignableFrom(WebView::class.java)
            override fun getDescription()="Exercise near-limit synthetic backup"
            override fun perform(controller:UiController,view:View){(view as WebView).evaluateJavascript("String((function(){return $expression})())"){result.set(JSONTokener(it).nextValue() as? String)}}
        })
        compose.waitUntil(90000){result.get()!=null};return result.get()!!
    }
    private fun waitText(text:String){
        var body=""
        try{
            compose.waitUntil(180000){body=js("document.body.innerText");body.contains(text)||js("!!document.querySelector('[role=alert]')")=="true"}
            assertTrue("Expected synthetic backup phase: $text",body.contains(text))
        }catch(error:Throwable){
            val app=compose.activity.application as GenesisApplication
            File(app.getExternalFilesDir(null),"backup336-large-failed-phase.json").writeText(JSONObject().put("synthetic",true).put("expected",text)
                .put("body",body.take(16384)).put("error",error.javaClass.simpleName).toString(2))
            captureNativeWindow(File(app.getExternalFilesDir(null),"backup336-large-failed-phase.png"));throw error
        }
    }
    private fun click(text:String){assertEquals("true",js("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==${JSONObject.quote(text)});if(!b||b.disabled)return false;b.click();return true})()"))}
    private fun makeArchive(file:File,owner:String,secret:String):Pair<Int,List<String>> {
        val id=UUID.randomUUID().toString();val ids=(0 until 8).map{UUID.randomUUID().toString()}
        var dataKey=KeyGenerator.getInstance("AES").apply{init(256)}.generateKey()
        val wrap=Cipher.getInstance("AESWrap").apply{init(Cipher.WRAP_MODE,SecretKeySpec(Base64.getDecoder().decode(secret),"AES"))}
        var wrapped=Base64.getEncoder().encodeToString(wrap.wrap(dataKey));var attempts=1
        while(!wrapped.contains('/')&&attempts++<64){dataKey=KeyGenerator.getInstance("AES").apply{init(256)}.generateKey();wrapped=Base64.getEncoder().encodeToString(wrap.wrap(dataKey))}
        assertTrue("Large fixture must exercise the cross-platform solidus case",wrapped.contains('/'))
        val iv=ByteArray(12).also(java.security.SecureRandom()::nextBytes)
        val aad=GenesisBackupContainer.authenticatedHeader(id,wrapped)
        val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply{init(Cipher.ENCRYPT_MODE,dataKey,GCMParameterSpec(128,iv));updateAAD(aad)}
        val sha=MessageDigest.getInstance("SHA-256");var plain=0
        file.outputStream().buffered().use{output->
            fun write(text:String)=output.write(text.toByteArray(Charsets.UTF_8))
            write("{\"format\":\"genesisbackup\",\"schema\":1,\"backupId\":\"$id\",\"algorithm\":\"A256GCM+A256KW\",\"wrappedKey\":\"$wrapped\",\"iv\":\"${Base64.getEncoder().encodeToString(iv)}\",\"ciphertext\":\"")
            val unclosed=object:FilterOutputStream(output){override fun close(){flush()};override fun write(bytes:ByteArray,off:Int,len:Int){out.write(bytes,off,len)}}
            CipherOutputStream(DigestOutputStream(Base64.getEncoder().wrap(unclosed),sha),cipher).use{encrypted->
                fun emit(text:String){val bytes=text.toByteArray(Charsets.UTF_8);plain+=bytes.size;check(plain<=GenesisBackupContainer.MAX_PLAIN);encrypted.write(bytes);bytes.fill(0)}
                emit("{\"schema\":1,\"backupId\":\"$id\",\"source\":\"device_snapshot\",\"ownerId\":\"$owner\",\"createdAt\":\"2026-11-20T01:00:00Z\",\"client\":\"android\",\"billingEvidence\":null,\"sections\":[{\"id\":\"mindmaps\",\"source\":\"device\",\"completeness\":\"available\",\"capturedAt\":\"2026-11-20T01:00:00Z\",\"revision\":1,\"count\":8,\"pending\":0,\"notices\":[],\"data\":{\"records\":[")
                val note="n".repeat(12000)
                for((index,map) in ids.withIndex()){
                    if(index>0)emit(",")
                    emit("{\"id\":\"$map\",\"revision\":1,\"schemaVersion\":1,\"document\":{\"schemaVersion\":1,\"id\":\"$map\",\"title\":\"Synthetic large map $index\",\"projectId\":null,\"pinned\":false,\"archived\":false,\"nodes\":[{\"id\":\"root\",\"parentId\":null,\"kind\":\"idea\",\"text\":\"root\",\"note\":\"\"}")
                    for(node in 0 until 160)emit(",{\"id\":\"node-$node\",\"parentId\":\"root\",\"kind\":\"idea\",\"text\":\"Node $node\",\"note\":\"$note\"}")
                    emit("],\"links\":[]}}")
                }
                emit("]}}]}")
            }
            write("\",\"sha256\":\"${sha.digest().joinToString(""){"%02x".format(it)}}\"}")
        }
        assertTrue(file.length()<=GenesisBackupContainer.MAX_FILE);assertTrue(plain>15*1024*1024-500_000)
        return plain to ids
    }
    @Test fun historicalEscapedSolidusArchiveOpensInTheActualProductionWebView(){
        val fixture=JSONObject(InstrumentationRegistry.getInstrumentation().context.assets.open("backup-portability-v1.json").bufferedReader().use{it.readText()})
        val owner=fixture.getJSONObject("payload").getString("ownerId");val app=compose.activity.application as GenesisApplication;app.activateAccount(owner)
        val account=app.workspaceScope;val epoch=app.workspaceEpoch;val directory=File(app.cacheDir,"advice-shares");check(directory.isDirectory||directory.mkdirs())
        val file=File(directory,"QA336-legacy-${UUID.randomUUID()}.genesisbackup");file.writeText(fixture.getJSONObject("files").getJSONObject("androidLegacy").toString())
        val uri=FileProvider.getUriForFile(app,"${app.packageName}.updates",file)
        try{
            val gateway=object:BackupGateway {
                override fun check(){check(app.workspaceScope==account&&app.workspaceEpoch==epoch){"BACKUP_OWNER"}}
                override suspend fun quiesce()=error("No restore authorized")
                override suspend fun request(method:String,path:String,body:JSONObject?):JSONObject {
                    check();check(path in setOf("/backup/v1/status","/backup/v1/authorize"))
                    return JSONObject().put("enabled",true).put("generation",0).put("noticeVersion","backup-3.2.2-v1").put("serverSigningConfigured",false).put("driveEnabled",false)
                }
            }
            compose.setContent{CompositionLocalProvider(LocalGenesisLanguage provides "en",LocalEveningTheme provides true){MaterialTheme(colorScheme=evening,typography=GenesisTypography){
                NativeBackupDialog(owner,"Backups and restore",{},gateway,{save,_->check(!save);uri})
            }}}
            waitText("Generate key");js("document.querySelector('.backup-panel > .backup-check input').click()")
            val key=fixture.getString("recoveryKey")
            assertEquals("true",js("(()=>{const input=document.querySelector('textarea');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,${JSONObject.quote(key)});input.dispatchEvent(new Event('input',{bubbles:true}));return true})()"))
            js("document.querySelector('fieldset .backup-check input').click()");click("Choose file");waitText(file.name);click("Check and decrypt");waitText("File checked on this device.")
            var captured:JSONObject?=null;compose.waitUntil(10000){runCatching{app.backupMigrationMemory.capture(owner,epoch)}.getOrNull()?.also{captured=it}!=null}
            val source=requireNotNull(captured).getJSONArray("views").getJSONObject(0).getJSONObject("valueForm");val fields=JSONObject(source.getString("rawManifest")).getJSONArray("fields")
            val id=(0 until fields.length()).map{fields.getJSONObject(it)}.single{it.getString("name")=="payload"}.getString("id");val values=source.getJSONArray("values")
            val payload=JSONObject((0 until values.length()).map{values.getJSONObject(it)}.single{it.getString("id")==id}.getString("rawJson"));assertEquals(owner,payload.getString("ownerId"))
            File(app.getExternalFilesDir(null),"backup336-legacy-webview-proof.json").writeText(JSONObject().put("synthetic",true).put("legacyEscapedSolidusAuthenticated",true)
                .put("actualProductionBackupPanel",true).put("currentNativeValueManifestVerified",true).put("restoreExecuted",false).toString())
        }finally{file.delete();app.activateAccount(null)}
    }
    @Test fun nearLimitValidBackupDecryptsAndPreviewsAllEightMapsWithoutLosingAcceptedForm(){
        check(BuildConfig.DEBUG&&compose.activity.packageName=="ru.genesis.calendar.qa1103.debug")
        val app=compose.activity.application as GenesisApplication;val owner="large-backup-${UUID.randomUUID()}";app.activateAccount(owner)
        val account=app.workspaceScope;val epoch=app.workspaceEpoch;val secret=Base64.getEncoder().encodeToString(ByteArray(32){(it+3).toByte()})
        val oldKey=ByteArray(32){(it+11).toByte()};val previews=AtomicInteger();val documents=AtomicInteger()
        val directory=File(app.cacheDir,"advice-shares");check(directory.isDirectory||directory.mkdirs())
        val file=File(directory,"QA336-large-${UUID.randomUUID()}.genesisbackup");val started=android.os.SystemClock.elapsedRealtime()
        try{
            val (plain,ids)=makeArchive(file,owner,secret);val uri=FileProvider.getUriForFile(app,"${app.packageName}.updates",file)
            val gateway=object:BackupGateway {
                override fun check(){check(app.workspaceScope==account&&app.workspaceEpoch==epoch){"BACKUP_OWNER"}}
                override suspend fun quiesce()=error("No restore commit authorized")
                override suspend fun request(method:String,path:String,body:JSONObject?):JSONObject {
                    check();return when(path){
                        "/backup/v1/status","/backup/v1/authorize"->JSONObject().put("enabled",true).put("generation",0).put("noticeVersion","backup-3.2.2-v1").put("serverSigningConfigured",false).put("driveEnabled",false)
                        "/workspace"->JSONObject().put("workspace",JSONObject().put("keyMode","account").put("key",Base64.getEncoder().encodeToString(oldKey)).put("envelope",JSONObject.NULL))
                        "/recovered-tasks"->JSONObject().put("tasks",JSONArray())
                        "/mindmaps"->JSONObject().put("maps",JSONArray())
                        "/backup/v1/preview"->{
                            require(method=="POST");val operations=requireNotNull(body).getJSONArray("operations");assertEquals(8,operations.length())
                            for(index in 0 until operations.length()){
                                val operation=operations.getJSONObject(index);assertEquals("mindmaps",operation.getString("section"));assertEquals(ids[index],operation.getString("id"))
                                val input=operation.getJSONObject("input")
                                val bytes=WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(input.getString("ciphertext"),input.getString("iv")),oldKey,"genesis-mindmap-v1:$owner:map:${ids[index]}".toByteArray())
                                try{val doc=JSONObject(bytes.toString(Charsets.UTF_8));assertEquals(ids[index],doc.getString("id"));assertEquals(161,doc.getJSONArray("nodes").length())
                                    assertEquals("n".repeat(12000),doc.getJSONArray("nodes").getJSONObject(160).getString("note"));documents.incrementAndGet()
                                }finally{bytes.fill(0)}
                            }
                            previews.incrementAndGet();JSONObject().put("stageId","synthetic-large-stage").put("digest","c".repeat(64)).put("counts",JSONObject().put("mindmaps",8)).put("expiresIn",300)
                        }
                        else->error("Unexpected synthetic route $path")
                    }
                }
            }
            val visible=mutableStateOf(true)
            compose.setContent{CompositionLocalProvider(LocalGenesisLanguage provides "en",LocalEveningTheme provides true){
                MaterialTheme(colorScheme=evening,typography=GenesisTypography){if(visible.value)NativeBackupDialog(owner,"Backups and restore",{visible.value=false},gateway,{save,_->check(!save);uri})}
            }}
            waitText("Generate key");js("document.querySelector('.backup-panel > .backup-check input').click()")
            assertEquals("true",js("(()=>{const input=document.querySelector('textarea');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,${JSONObject.quote(secret)});input.dispatchEvent(new Event('input',{bubbles:true}));return true})()"))
            js("document.querySelector('fieldset .backup-check input').click()")
            click("Choose file")
            waitText(file.name)
            click("Check and decrypt")
            waitText("File checked on this device.")
            click("Preview restore")
            waitText("I confirm these changes.")
            assertEquals(1,previews.get());assertEquals(8,documents.get());assertFalse(js("document.body.innerText").contains("The operation could not finish"))
            val before=app.backupMigrationMemory.valueStatistics(owner,epoch).single();val editStarted=android.os.SystemClock.elapsedRealtime()
            // An unchanged decoded payload and encrypted plan must not cross
            // the synchronous bridge again for a small confirmation choice.
            assertEquals("true",js("(()=>{const input=document.querySelector('.backup-preview .backup-check input');input.click();return input.checked})()"))
            val editMs=android.os.SystemClock.elapsedRealtime()-editStarted;val after=app.backupMigrationMemory.valueStatistics(owner,epoch).single()
            assertEquals(1,after.values-before.values);assertEquals(1L,after.chunks-before.chunks);assertEquals(4L,after.characters-before.characters)
            assertEquals(1,after.manifests-before.manifests);assertTrue("Small input edit still blocked the UI for over five seconds: $editMs",editMs<5000)
            val sizes=app.backupMigrationMemory.retainedFormCharacters(owner,epoch);assertEquals(1,sizes.size);assertTrue(sizes.single()>32*1024*1024)
            js("(()=>{document.querySelector('.backup-preview').scrollIntoView({block:'start',behavior:'instant'});return true})()")
            captureNativeWindow(File(app.getExternalFilesDir(null),"backup336-large-preview.png"))
            compose.runOnIdle{visible.value=false};compose.waitForIdle()
            assertEquals(sizes,app.backupMigrationMemory.retainedFormCharacters(owner,epoch))
            val files=app.backupMigrationMemory.fileStatistics(owner,epoch)
            assertEquals(1,files.files);assertEquals(file.length(),files.bytes);assertEquals(0L,files.memoryBytes);assertEquals(0,files.pending)
            val refused=assertThrows(IllegalStateException::class.java){app.backupMigrationMemory.capture(owner,epoch)}
            assertEquals("E2EE_SNAPSHOT_TOO_LARGE",refused.message)
            File(app.getExternalFilesDir(null),"backup336-large-preview-proof.json").writeText(JSONObject().put("synthetic",true).put("plainBytes",plain).put("fileBytes",file.length())
                .put("formCharacters",sizes.single()).put("validatedAndSealedMaps",documents.get()).put("previews",previews.get()).put("retainedAfterClose",true)
                .put("retainedFileMemoryBytes",files.memoryBytes).put("retainedFileBytes",files.bytes)
                .put("smallEditMs",editMs).put("smallEditValueChunks",after.chunks-before.chunks).put("smallEditValueCharacters",after.characters-before.characters)
                .put("smallEditedField","confirmed")
                .put("totalValueChunks",after.chunks).put("totalValueCharacters",after.characters).put("acceptedValues",after.values).put("acceptedManifests",after.manifests)
                .put("largeAggregateCaptureGate","E2EE_SNAPSHOT_TOO_LARGE").put("elapsedMs",android.os.SystemClock.elapsedRealtime()-started).toString(2))
        }finally{oldKey.fill(0);file.delete();app.activateAccount(null)}
    }
}
