package ru.genesis.calendar.ui

import android.view.View
import android.webkit.WebView
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.UiController
import androidx.test.espresso.ViewAction
import androidx.test.espresso.matcher.ViewMatchers.isAssignableFrom
import androidx.test.espresso.matcher.RootMatchers.isDialog
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.hamcrest.Matcher
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
import java.io.File
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

/** Real SAF and production WebView bridge; only a unique account in a separate QA package. */
class NativeBackupSafTest {
    @get:Rule val compose=createAndroidComposeRule<PagerTestActivity>()
    private fun js(expression:String):String {
        val result=AtomicReference<String?>()
        onView(isAssignableFrom(WebView::class.java)).inRoot(isDialog()).perform(object:ViewAction {
            override fun getConstraints():Matcher<View> = isAssignableFrom(WebView::class.java)
            override fun getDescription()="Exercise isolated backup UI"
            override fun perform(controller:UiController,view:View) {
                (view as WebView).evaluateJavascript("String((function(){return $expression})())") {
                    result.set(JSONTokener(it).nextValue() as? String)
                }
            }
        })
        compose.waitUntil(10000){result.get()!=null};return result.get()!!
    }
    private fun body()=js("document.body.innerText")
    private fun click(label:String) {
        assertEquals("true",js("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==${JSONObject.quote(label)});if(!b||b.disabled)return false;b.click();return true})()"))
    }
    private fun waitText(text:String) { compose.waitUntil(30000){body().contains(text)} }
    @Test fun realDocumentPickersCancelExportAndReopenEncryptedPersonalArchive() {
        check(BuildConfig.DEBUG&&compose.activity.packageName.endsWith(".qa322.debug"))
        val app=compose.activity.application as GenesisApplication
        val owner="saf-qa-${UUID.randomUUID()}"
        app.activateAccount(owner)
        var authorizations=0
        val gateway=object:BackupGateway {
            override fun check()=Unit
            override suspend fun quiesce()=error("No restore commit is authorized by this fixture")
            override suspend fun request(method:String,path:String,body:JSONObject?):JSONObject {
                require(path in setOf("/backup/v1/status","/backup/v1/authorize")) { "Unexpected network route $path" }
                if(path.endsWith("authorize"))authorizations++
                return JSONObject().put("enabled",true).put("generation",0).put("noticeVersion","backup-3.2.2-v1")
                    .put("serverSigningConfigured",false).put("driveEnabled",false)
            }
        }
        val device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val documents=By.pkg(java.util.regex.Pattern.compile("com\\.(google\\.)?android\\.documentsui"))
        fun picker(){assertTrue("System document picker did not open",device.wait(Until.hasObject(documents),15000))}
        fun cancel(){device.pressBack();if(device.hasObject(documents))device.pressBack();assertTrue(device.wait(Until.gone(documents),10000));waitText("Action cancelled.")}
        try {
            compose.setContent { CompositionLocalProvider(LocalGenesisLanguage provides "en",LocalEveningTheme provides true) {
                MaterialTheme(colorScheme=evening,typography=GenesisTypography) { NativeBackupDialog(owner,"Backups and restore",{},gateway) }
            } }
            waitText("Generate key")
            assertEquals("true",js("(()=>{document.querySelector('.backup-check input').click();return true})()"))
            click("Generate key")
            assertEquals("true",js("(()=>{document.querySelector('fieldset .backup-check input').click();return true})()"))
            click("Choose file");picker();cancel()
            click("Back up this device");picker();cancel()
            assertFalse(body().contains("Encrypted backup saved."))
            click("Back up this device");picker()
            val beforeWrite=authorizations
            val name=device.wait(Until.findObject(By.clazz("android.widget.EditText")),10000)
            assertNotNull(name)
            val filename="QA322-${UUID.randomUUID()}.genesisbackup"
            name.text=filename
            val save=device.wait(Until.findObject(By.res("android:id/button1")),10000)
            assertNotNull(save);save.click()
            waitText("Encrypted backup saved.")
            assertTrue("SAF write must reauthorize after the picker",authorizations>beforeWrite)
            click("Choose file");picker()
            val exported=device.wait(Until.findObject(By.text(filename)),15000)
            assertNotNull("The real exported archive must be offered by OpenDocument",exported);exported.click()
            waitText("import.genesisbackup")
            click("Check and decrypt")
            waitText("File checked on this device.")
            assertFalse(body().contains("The operation could not finish"))
            captureNativeWindow(File(app.getExternalFilesDir(null),"backup322-saf-decrypted.png"))
            File(app.getExternalFilesDir(null),"backup322-saf-proof.json").writeText(JSONObject().put("synthetic",true)
                .put("cancelledOpenAndSave",true).put("actualEncryptedExportAndOpen",true).put("decryptedByProductionWebView",true)
                .put("authorizedAfterSavePicker",true).put("filename",filename).toString(2))
        } finally { app.activateAccount(null) }
    }
}
