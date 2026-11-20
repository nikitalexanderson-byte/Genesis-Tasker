package ru.genesis.calendar.ui

import android.view.View
import android.webkit.WebView
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.UiController
import androidx.test.espresso.ViewAction
import androidx.test.espresso.matcher.RootMatchers.isDialog
import androidx.test.espresso.matcher.ViewMatchers.isAssignableFrom
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import kotlinx.coroutines.runBlocking
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
import ru.genesis.calendar.data.AuroraGateway
import ru.genesis.calendar.data.AuroraNativeStore
import ru.genesis.calendar.data.BackupGateway
import ru.genesis.calendar.security.WorkspaceCipher
import java.io.File
import java.util.Base64
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.atomic.AtomicBoolean

/** Actual encrypted Room -> SAF archive -> native WebView -> selected encrypted
 * restore preview. All scopes/files are synthetic in the separate QA package. */
class BackupJournalChoiceTest {
    @get:Rule val compose=createAndroidComposeRule<PagerTestActivity>()
    private val args get()=InstrumentationRegistry.getArguments()
    private fun js(expression:String):String {
        val result=AtomicReference<String?>();val completed=AtomicBoolean(false)
        onView(isAssignableFrom(WebView::class.java)).inRoot(isDialog()).perform(object:ViewAction {
            override fun getConstraints():Matcher<View> = isAssignableFrom(WebView::class.java)
            override fun getDescription()="Exercise synthetic archive choices"
            override fun perform(controller:UiController,view:View) {
                (view as WebView).evaluateJavascript("String((function(){return $expression})())") { try{result.set(JSONTokener(it).nextValue() as? String)}finally{completed.set(true)} }
            }
        })
        compose.waitUntil(10000){completed.get()};return checkNotNull(result.get()){"Synthetic WebView evaluation did not return a String"}
    }
    private fun waitText(text:String){compose.waitUntil(30000){js("document.body?.innerText??''").contains(text)}}
    private fun click(label:String){assertEquals("true",js("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==${JSONObject.quote(label)});if(!b||b.disabled)return false;b.click();return true})()"))}
    private fun visualFrame(){
        val ready=java.util.concurrent.atomic.AtomicBoolean(false)
        onView(isAssignableFrom(WebView::class.java)).inRoot(isDialog()).perform(object:ViewAction{
            override fun getConstraints():Matcher<View> = isAssignableFrom(WebView::class.java)
            override fun getDescription()="Wait for archive choice frame"
            override fun perform(controller:UiController,view:View){(view as WebView).postVisualStateCallback(1,object:WebView.VisualStateCallback(){override fun onComplete(id:Long){ready.set(true)}})}
        });compose.waitUntil(10000){ready.get()}
    }
    @Test fun encryptedArchiveRetainsBranchesAndRequiresAReviewedVersionThroughRealSaf() {
        check(BuildConfig.DEBUG&&compose.activity.packageName.endsWith(".qa1103.debug"))
        val app=compose.activity.application as GenesisApplication;val owner="backup-journal-${UUID.randomUUID()}"
        app.activateAccount(owner);val account=app.workspaceScope;val rawKey=ByteArray(32){(it+7).toByte()}
        val previews=AtomicInteger();val selectedNote=AtomicReference<String>()
        val gateway=object:BackupGateway {
            override fun check(){check(app.workspaceScope==account){"BACKUP_OWNER"}}
            override suspend fun quiesce()=error("Synthetic test never commits a restore")
            override suspend fun request(method:String,path:String,body:JSONObject?):JSONObject {
                check()
                return when(path){
                    "/workspace"->JSONObject().put("workspace",JSONObject().put("keyMode","account").put("key",Base64.getEncoder().encodeToString(rawKey)).put("envelope",JSONObject.NULL))
                    "/recovered-tasks"->JSONObject().put("tasks",JSONArray())
                    "/aurora-workspace"->JSONObject().put("document",JSONObject.NULL)
                    "/backup/v1/status","/backup/v1/authorize"->JSONObject().put("enabled",true).put("generation",0).put("noticeVersion","backup-3.2.2-v1").put("serverSigningConfigured",false).put("driveEnabled",false)
                    "/backup/v1/preview"->{
                        require(method=="POST");val operations=requireNotNull(body).getJSONArray("operations");assertEquals(1,operations.length())
                        val operation=operations.getJSONObject(0);assertEquals("aurora",operation.getString("section"));val input=operation.getJSONObject("input")
                        val plain=WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(input.getString("ciphertext"),input.getString("iv")),rawKey,"genesis-mindmap-v1:$owner:aurora-workspace:v1".toByteArray())
                        try{selectedNote.set(JSONObject(plain.toString(Charsets.UTF_8)).getJSONArray("sessions").getJSONObject(0).getString("observationNote"))}finally{plain.fill(0)}
                        previews.incrementAndGet();JSONObject().put("stageId","synthetic-stage").put("digest","a".repeat(64)).put("counts",JSONObject()).put("expiresIn",300)
                    }
                    else->error("Unexpected synthetic backup route")
                }
            }
        }
        try {
            val fixture=JSONObject(InstrumentationRegistry.getInstrumentation().context.assets.open("backup-journal-aurora-v1.json").bufferedReader().use{it.readText()})
            assertTrue(fixture.getBoolean("synthetic"));assertEquals(1,fixture.getInt("protocol"))
            val doc=fixture.getJSONObject("document").put("ownerId",owner);doc.getJSONArray("sessions").getJSONObject(0).put("ownerId",owner)
            val auroraGateway=object:AuroraGateway {
                override fun check()=gateway.check()
                override suspend fun workspace()=gateway.request("GET","/workspace",null)
                override suspend fun request(method:String,path:String,body:JSONObject?)=error("Synthetic editor IO disabled")
                override suspend fun billing(method:String,path:String,body:JSONObject?)=error("Synthetic billing disabled")
            }
            runBlocking {
                val store=AuroraNativeStore(app,owner,account,auroraGateway)
                try {
                    val base=JSONObject().put("version",1).put("ownerId",owner).put("sessions",JSONArray()).put("removed",JSONArray())
                    for((index,note) in listOf("Earlier synthetic branch","Latest left synthetic branch","Independent right synthetic branch").withIndex()){
                        val value=JSONObject(doc.toString());value.getJSONArray("sessions").getJSONObject(0).put("observationNote",note)
                        val writer=if(index<2)"11111111-1111-4111-8111-111111111111" else "22222222-2222-4222-8222-222222222222"
                        val sequence=if(index==1)2 else 1
                        val pending=JSONObject().put("envelope",store.seal(value,"aurora-workspace:v1").put("expectedRevision",0)).put("base",store.seal(base,"aurora-workspace-base:v1"))
                        store.setItem("genesis-aurora-workspace-v1:$owner:pending:writer:$writer:$sequence:pending",pending.toString())
                    }
                } finally{store.close()}
            }
            val before=runBlocking{app.database.dao().backupDocuments(account).filter{it.kind.startsWith("aurora-pending:")}.associate{it.kind to it.encrypted}}
            assertEquals(3,before.size)
            val dark=args.getString("genesisDark")=="true"
            compose.setContent { val density=LocalDensity.current
                CompositionLocalProvider(LocalGenesisLanguage provides "en",LocalEveningTheme provides dark,LocalDensity provides Density(density.density,1.3f)) {
                    MaterialTheme(colorScheme=if(dark)evening else standart,typography=GenesisTypography) { NativeBackupDialog(owner,"Backups and restore",{},gateway) }
                }
            }
            waitText("Generate key");assertEquals("true",js("(()=>{document.querySelector('.backup-panel > .backup-check input').click();return true})()"))
            click("Generate key");js("document.querySelector('fieldset .backup-check input').click()")
            click("Back up this device")
            val device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            val filename="QA336-journal-${UUID.randomUUID()}.genesisbackup"
            val name=device.wait(Until.findObject(By.clazz("android.widget.EditText")),15000);assertNotNull("Real save picker",name);name.text=filename
            val save=device.wait(Until.findObject(By.res("android:id/button1")),10000);assertNotNull(save);save.click()
            waitText("Encrypted backup saved.")
            click("Choose file");val exported=device.wait(Until.findObject(By.text(filename)),15000);assertNotNull("Actual encrypted SAF file",exported);exported.click()
            waitText(filename);click("Check and decrypt");waitText("Choose a saved version")
            assertEquals("3",js("document.querySelectorAll('input[type=radio]').length"));assertEquals("0",js("document.querySelectorAll('input[type=radio]:checked').length"))
            assertEquals("true",js("document.querySelector('.backup-coverage > .backup-actions button').disabled"));assertEquals(0,previews.get())
            js("(()=>{for(const input of document.querySelectorAll('.backup-coverage > ul input'))if(input.checked&&!input.closest('label').textContent.includes('Gno Meter Basileia'))input.click();document.querySelectorAll('input[type=radio]')[2].click();return true})()")
            click("Preview restore");waitText("I confirm these changes.");assertEquals("Earlier synthetic branch",selectedNote.get());assertEquals(1,previews.get())
            js("document.querySelectorAll('input[type=radio]')[0].click()");assertEquals("false",js("!!document.querySelector('.backup-preview')"))
            click("Preview restore");waitText("I confirm these changes.");assertEquals("Latest left synthetic branch",selectedNote.get());assertEquals(2,previews.get())
            assertEquals("true",js("(()=>{document.querySelector('.backup-journal-choices').scrollIntoView({block:'start',behavior:'instant'});return document.documentElement.scrollWidth<=innerWidth+1})()"))
            compose.waitUntil(10000){js("String(Math.abs(document.querySelector('.backup-journal-choices').getBoundingClientRect().top)<2)")=="true"}
            visualFrame()
            captureNativeWindow(File(app.getExternalFilesDir(null),"backup336-journal-${if(dark)"dark" else "light"}.png"))
            val after=runBlocking{app.database.dao().backupDocuments(account).filter{it.kind.startsWith("aurora-pending:")}.associate{it.kind to it.encrypted}}
            assertEquals(before,after)
        } finally{rawKey.fill(0);app.activateAccount(null)}
    }
}
