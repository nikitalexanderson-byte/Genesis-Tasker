package ru.genesis.calendar.ui

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.*
import org.junit.Before
import org.junit.FixMethodOrder
import org.junit.Rule
import org.junit.Test
import org.junit.runners.MethodSorters
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.security.E2eeDeviceVault
import ru.genesis.calendar.security.NativeMigrationCredential
import java.util.UUID
import java.io.File
import java.util.regex.Pattern
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/** Component acceptance with the actual production confirmation composable and
 * auth-required Android Keystore vault. No migrated account or provider fixture
 * is needed. The owned AVD driver supplies only observed system PIN entry and
 * synthetic hardware touches; no authentication result is injected. */
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class NativeDeviceAuthenticationUiTest {
    @get:Rule val compose=createAndroidComposeRule<PagerTestActivity>()
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private val device get()=UiDevice.getInstance(instrumentation)
    private var request by mutableStateOf<NativeMigrationCredential?>(null)
    private val operations=AtomicInteger()
    private val outcome=AtomicReference<String?>(null)
    private lateinit var vault:E2eeDeviceVault
    private lateinit var owner:String
    private val content="GENESIS synthetic authentication component record".toByteArray()
    private val title="GENESIS device unlock QA"
    private val pin="Use device screen lock"
    private val pinSelector get()=By.text(Pattern.compile(Pattern.quote(pin),Pattern.CASE_INSENSITIVE or Pattern.UNICODE_CASE))

    @Before fun mountedRealCredentialComponent(){
        check(BuildConfig.DEBUG&&compose.activity.packageName=="ru.genesis.calendar.qa1103.debug")
        check(InstrumentationRegistry.getArguments().getString("genesisOwnedUnlockQa")=="true")
        compose.activity.runOnUiThread{compose.activity.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)}
        owner="device-unlock-${UUID.randomUUID()}"
        vault=E2eeDeviceVault(compose.activity,owner)
        // The runner verifies the pre-existing owned device credential before
        // this suite. This prepares a real protected record, never a fake key.
        vault.save(content,create=true)
        compose.setContent{
            CompositionLocalProvider(LocalGenesisLanguage provides "en"){
                MaterialTheme{Surface{
                    Text("GENESIS authentication component")
                    RecoveryCredentialActivity(request,title,"Unlock the synthetic protected record",
                        operation={_,_,current->
                            current();val opened=vault.unlock()
                            try{assertArrayEquals(content,opened);current();operations.incrementAndGet()}finally{opened.fill(0)}
                        },
                        finished={held,error->outcome.set(error?.message?:"OPENED");if(request===held)request=null})
                }}
            }
        }
    }
    private fun prompt(){
        compose.runOnIdle{request=NativeMigrationCredential.captureVault(owner,"component",1,"",null,false,false,SystemClock.elapsedRealtime()) {}}
        compose.waitForIdle()
        val visible=device.wait(Until.hasObject(pinSelector),20000)
        assertTrue("Actual biometric prompt or compat fingerprint dialog; lifecycle=${compose.activity.lifecycle.currentState}; outcome=${outcome.get()}",visible)
    }
    private fun signal(mode:String){
        if(mode=="pin"){
            // ConfirmDeviceCredential may first offer platform biometrics.
            // Select the observed system-owned PIN alternative as a user does.
            device.wait(Until.findObject(By.res("com.android.systemui:id/button_use_credential")),5000)?.click()
            val visible=device.wait(Until.hasObject(By.pkg(Pattern.compile("com\\.android\\.(settings|systemui)")).clazz(Pattern.compile(".*(EditText|PasswordTextView)"))),20000)
            device.dumpWindowHierarchy(File(compose.activity.getExternalFilesDir(null),"genesis-owned-unlock-pin-diagnostic.xml"))
            assertTrue("System PIN field; outcome=${outcome.get()}",visible)
        }
        device.dumpWindowHierarchy(File(compose.activity.getExternalFilesDir(null),"genesis-owned-unlock-prompt.xml"))
        instrumentation.sendStatus(2,Bundle().apply{putString("stream","GENESIS_UNLOCK_UI_WAIT:$mode\n")})
    }
    private fun waitOutcome(){compose.waitUntil(60000){outcome.get()!=null}}
    @Test fun a_cancelCannotRunTheOperation(){
        prompt();device.pressBack();waitOutcome()
        assertEquals(0,operations.get());assertNotEquals("OPENED",outcome.get())
    }
    @Test fun b_systemPinOpensTheRealProtectedRecord(){
        prompt();requireNotNull(device.findObject(pinSelector)).click();signal("pin");waitOutcome()
        assertEquals("OPENED",outcome.get());assertEquals(1,operations.get())
    }
    @Test fun c_backgroundCancelsAPendingFingerprint(){
        prompt();device.pressHome();waitOutcome()
        assertEquals(0,operations.get());assertNotEquals("OPENED",outcome.get())
        compose.activity.startActivity(Intent(compose.activity,PagerTestActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
    }
    @Test fun d_hardwareFingerprintOpensTheRealProtectedRecord(){
        prompt();signal("fingerprint");waitOutcome()
        assertEquals("OPENED",outcome.get());assertEquals(1,operations.get())
    }
    @Test fun e_expiredForegroundAuthenticationRequiresFreshSystemPin(){
        instrumentation.sendStatus(2,Bundle().apply{putString("stream","GENESIS_UNLOCK_UI_WAIT:expiry\n")})
        val until=SystemClock.elapsedRealtime()+305000L
        while(SystemClock.elapsedRealtime()<until)SystemClock.sleep(250)
        assertTrue(compose.activity.lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED))
        val refused=runCatching{vault.unlock().also{it.fill(0)}}.exceptionOrNull()
        assertEquals("E2EE_UNLOCK_REQUIRED",refused?.message);assertEquals(0,operations.get())
        prompt();requireNotNull(device.findObject(pinSelector)).click();signal("pin");waitOutcome()
        assertEquals("OPENED",outcome.get());assertEquals(1,operations.get())
    }
}
