package ru.genesis.calendar.ui

import android.os.Bundle
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.FixMethodOrder
import org.junit.Test
import org.junit.Before
import org.junit.After
import org.junit.runners.MethodSorters
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.MainActivity
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.data.WorkspaceStructureRepository
import ru.genesis.calendar.security.NativePrivateProducts
import java.io.ByteArrayInputStream
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.util.Base64
import java.io.File
import java.util.regex.Pattern
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory

/** Follows NativePrivateProductHttpsTest in the SAME owned runtime and QA app.
 * PIN entry / emulated hardware touches are performed by the external owned-AVD
 * driver, after observing the actual platform surface. No success callback,
 * account, key or credential is injected by this test. */
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class NativePrivateVaultUnlockUiTest {
    private var previousTls:SSLSocketFactory?=null
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private val app get()=instrumentation.targetContext.applicationContext as GenesisApplication
    private val device get()=UiDevice.getInstance(instrumentation)
    private val auth get()=AuthController.get(app)
    @Before fun ownedLoopbackTrust(){
        check(InstrumentationRegistry.getArguments().getString("genesisFullQaHttps")=="true"&&BuildConfig.DEBUG&&app.packageName=="ru.genesis.calendar.qa1103.debug")
        val bytes=Base64.getDecoder().decode(requireNotNull(InstrumentationRegistry.getArguments().getString("genesisFixtureCa")))
        val certificate=CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(bytes))
        val trust=KeyStore.getInstance(KeyStore.getDefaultType()).apply{load(null);setCertificateEntry("owned-loopback",certificate)}
        val managers=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply{init(trust)}
        previousTls=HttpsURLConnection.getDefaultSSLSocketFactory()
        HttpsURLConnection.setDefaultSSLSocketFactory(SSLContext.getInstance("TLS").apply{init(null,managers.trustManagers,null)}.socketFactory)
    }
    @After fun restorePlatformTrust(){previousTls?.let(HttpsURLConnection::setDefaultSSLSocketFactory);previousTls=null}
    private fun text():JSONObject{
        val language=auth.state.value.accountSettings?.language?:"en"
        return app.assets.open("native-unlock-copy-v1.json").use{val copy=JSONObject(it.readBytes().toString(Charsets.UTF_8));copy.optJSONObject(language)?:copy.getJSONObject("en")}
    }
    private fun diagnostics(label:String){
        val stacks=Thread.getAllStackTraces().entries.take(60).joinToString("\n\n"){(thread,frames)->thread.name+" "+thread.state+"\n"+frames.take(32).joinToString("\n")}
        File(app.getExternalFilesDir(null),"genesis-unlock-$label-threads.txt").writeText(stacks)
        device.takeScreenshot(File(app.getExternalFilesDir(null),"genesis-unlock-$label.png"))
        stage("diagnostic-$label")
    }
    private fun waitFor(label:String="condition",operation:()->Boolean)=runBlocking{try{withTimeout(90000){while(!operation())delay(100)}}catch(error:Exception){diagnostics(label);throw error}}
    private fun stage(label:String){instrumentation.sendStatus(2,Bundle().apply{putString("stream","GENESIS_UNLOCK_UI_STAGE:$label\n")})}
    private fun unlockControl(copy:JSONObject):androidx.test.uiautomator.UiObject2?{
        var node=device.findObject(By.pkg(app.packageName).text(copy.getString("unlock")))?:return null
        // Compose may expose Text as a non-clickable child. Exercise the real
        // enabled button ancestor instead of treating that child's state as it.
        repeat(8){if(node.isClickable)return node.takeIf{it.isEnabled};node=node.parent?:return null}
        return null
    }
    private fun foregroundMain(label:String="entry"){
        stage("$label-launch")
        // The external driver performs one real launcher entry for this stage.
        // A second in-process start races the prompt and lifecycle under test.
        waitFor("$label-resumed"){
            var resumed=false
            instrumentation.runOnMainSync{resumed=ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).any{it is MainActivity}}
            resumed&&device.hasObject(By.pkg(app.packageName))
        }
        stage("$label-resumed")
    }
    private fun showLock():JSONObject{
        check(InstrumentationRegistry.getArguments().getString("genesisFullQaHttps")=="true"&&BuildConfig.DEBUG&&app.packageName=="ru.genesis.calendar.qa1103.debug")
        foregroundMain()
        // Exercise the real launcher/Activity lifecycle. Re-running auth and
        // synthesizing background callbacks here can race the prior unlock.
        waitFor("identity-ready"){val state=auth.state.value;state.user?.privateVault==true&&!state.requiresSignIn&&!state.busy&&app.workspaceScope==ru.genesis.calendar.auth.CloudAccountSnapshot.scopeFor(requireNotNull(state.user).uid)}
        stage("private-identity")
        assertFalse(NativePrivateProducts.isOpen(app.workspaceScope))
        val copy=text();waitFor("unlock-control"){unlockControl(copy)!=null};stage("lock-visible");return copy
    }
    private fun screenLock(copy:JSONObject)=By.text(Pattern.compile(Pattern.quote(copy.getString("pin")),Pattern.CASE_INSENSITIVE or Pattern.UNICODE_CASE))
    private fun prompt(copy:JSONObject){
        requireNotNull(unlockControl(copy)).click()
        val shown=device.wait(Until.hasObject(screenLock(copy)),20000)
        if(!shown)diagnostics("prompt-missing")
        assertTrue("Real fingerprint prompt with screen-lock alternative must appear",shown)
    }
    private fun signal(mode:String){
        if(mode=="pin"){
            device.wait(Until.findObject(By.res("com.android.systemui:id/button_use_credential")),5000)?.click()
            assertTrue(device.wait(Until.hasObject(By.pkg(Pattern.compile("com\\.android\\.(settings|systemui)")).clazz(Pattern.compile(".*(EditText|PasswordTextView)"))),20000))
        }
        device.dumpWindowHierarchy(File(app.getExternalFilesDir(null),"genesis-owned-unlock-prompt.xml"))
        instrumentation.sendStatus(2,Bundle().apply{putString("stream","GENESIS_UNLOCK_UI_WAIT:$mode\n")})
    }
    private fun retainedContentAndBackgroundLock(){
        waitFor{NativePrivateProducts.isOpen(app.workspaceScope)}
        runBlocking{withTimeout(60000){WorkspaceStructureRepository(app).workspace.first{row->row.projects.any{it.title.startsWith("EDITED NATIVE PRIVATE ")}}}}
        backgroundMain()
    }
    private fun backgroundMain(){
        device.pressHome();waitFor("background-locked"){!NativePrivateProducts.isOpen(app.workspaceScope)}
        waitFor("background-stopped"){
            var stopped=false
            instrumentation.runOnMainSync{stopped=ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.STOPPED).any{it is MainActivity}}
            stopped&&device.hasObject(By.pkg("com.google.android.apps.nexuslauncher"))
        }
    }
    @Test fun a_cancelCannotOpenTheVault(){
        val copy=showLock();prompt(copy);device.pressBack()
        waitFor{!device.hasObject(screenLock(copy))}
        assertFalse(NativePrivateProducts.isOpen(app.workspaceScope))
    }
    @Test fun b_systemPinOpensRetainedContentAndBackgroundRelocks(){
        val copy=showLock();prompt(copy);requireNotNull(device.findObject(screenLock(copy))).click();signal("pin")
        retainedContentAndBackgroundLock()
    }
    @Test fun c_backgroundCannotAdmitAPendingFingerprint(){
        val copy=showLock();prompt(copy);backgroundMain()
        foregroundMain("pending-biometric-return")
        assertTrue(device.wait(Until.hasObject(By.text(copy.getString("unlock"))),30000))
        assertFalse(NativePrivateProducts.isOpen(app.workspaceScope))
    }
    @Test fun d_hardwareFingerprintOpensRetainedContentAndBackgroundRelocks(){
        val copy=showLock();prompt(copy);signal("fingerprint");retainedContentAndBackgroundLock()
    }
}
