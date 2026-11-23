package ru.genesis.calendar.ui

import android.content.Intent
import android.os.Bundle
import androidx.test.platform.app.InstrumentationRegistry
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
    private fun waitFor(operation:()->Boolean)=runBlocking{withTimeout(90000){while(!operation())delay(100)}}
    private fun showLock():JSONObject{
        check(InstrumentationRegistry.getArguments().getString("genesisFullQaHttps")=="true"&&BuildConfig.DEBUG&&app.packageName=="ru.genesis.calendar.qa1103.debug")
        app.startActivity(Intent(app,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
        instrumentation.runOnMainSync{auth.onTrialBackground();auth.onTrialForeground();auth.checkSession()}
        waitFor{auth.state.value.user?.privateVault==true&&!auth.state.value.requiresSignIn}
        assertFalse(NativePrivateProducts.isOpen(app.workspaceScope))
        val copy=text();assertTrue(device.wait(Until.hasObject(By.text(copy.getString("unlock"))),30000));return copy
    }
    private fun prompt(copy:JSONObject){
        requireNotNull(device.findObject(By.text(copy.getString("unlock")))).click()
        assertTrue("Real fingerprint prompt with screen-lock alternative must appear",device.wait(Until.hasObject(By.text(copy.getString("pin"))),20000))
    }
    private fun signal(mode:String){instrumentation.sendStatus(2,Bundle().apply{putString("stream","GENESIS_UNLOCK_UI_WAIT:$mode\n")})}
    private fun retainedContentAndBackgroundLock(){
        waitFor{NativePrivateProducts.isOpen(app.workspaceScope)}
        runBlocking{withTimeout(60000){WorkspaceStructureRepository(app).workspace.first{row->row.projects.any{it.title.startsWith("EDITED NATIVE PRIVATE ")}}}}
        device.pressHome();waitFor{!NativePrivateProducts.isOpen(app.workspaceScope)}
    }
    @Test fun a_cancelCannotOpenTheVault(){
        val copy=showLock();prompt(copy);device.pressBack()
        waitFor{!device.hasObject(By.text(copy.getString("pin")))}
        assertFalse(NativePrivateProducts.isOpen(app.workspaceScope))
    }
    @Test fun b_systemPinOpensRetainedContentAndBackgroundRelocks(){
        val copy=showLock();prompt(copy);requireNotNull(device.findObject(By.text(copy.getString("pin")))).click();signal("pin")
        retainedContentAndBackgroundLock()
    }
    @Test fun c_backgroundCannotAdmitAPendingFingerprint(){
        val copy=showLock();prompt(copy);device.pressHome()
        waitFor{!NativePrivateProducts.isOpen(app.workspaceScope)}
        app.startActivity(Intent(app,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
        assertTrue(device.wait(Until.hasObject(By.text(copy.getString("unlock"))),30000))
        assertFalse(NativePrivateProducts.isOpen(app.workspaceScope))
    }
    @Test fun d_hardwareFingerprintOpensRetainedContentAndBackgroundRelocks(){
        val copy=showLock();prompt(copy);signal("fingerprint");retainedContentAndBackgroundLock()
    }
}
