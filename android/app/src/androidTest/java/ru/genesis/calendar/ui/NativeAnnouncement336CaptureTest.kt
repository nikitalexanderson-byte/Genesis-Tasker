package ru.genesis.calendar.ui

import android.os.SystemClock
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.AccountSettings
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.AuthPanelState
import ru.genesis.calendar.auth.ServerIdentity
import ru.genesis.calendar.auth.SyncRouting
import ru.genesis.calendar.security.E2eeKeys
import ru.genesis.calendar.security.NativeMigrationCredential
import ru.genesis.calendar.security.UnlockedE2eeDevice
import java.io.File
import java.util.UUID

/** Opt-in announcement captures of production UI with synthetic identities.
 * Presentation fixtures grant no session, scope, entitlement or decryption
 * authority. No network action or successful-unlock callback is simulated.
 * These screenshots are not migration/security acceptance evidence. */
class NativeAnnouncement336CaptureTest {
    @get:Rule val compose=createAndroidComposeRule<PagerTestActivity>()
    @Test fun productionLockRecoveryAndDeviceEntryScreensWithNoPrivateContent(){
        val args=InstrumentationRegistry.getArguments()
        check(args.getString("genesisAnnouncement336")=="true"&&BuildConfig.DEBUG)
        val app=compose.activity.applicationContext as GenesisApplication
        check(app.packageName=="ru.genesis.calendar.qa1103.debug")
        val language=args.getString("genesisAnnouncementLanguage")?:"ru"
        fun copy(name:String)=app.assets.open(name).use{JSONObject(it.readBytes().toString(Charsets.UTF_8)).getJSONObject(language)}
        val vaultCopy=copy("vault-copy-v1.json");val unlockCopy=copy("native-unlock-copy-v1.json");val entryCopy=copy("personal-device-entry-copy-v1.json")
        val owner="announcement-${UUID.randomUUID()}";val newOwner="$owner-new"
        val kit=E2eeKeys.createRecoveryKit(owner)
        try{UnlockedE2eeDevice.provision(app,owner,kit.secret,kit.kit).lock()}finally{kit.secret.fill(0)}
        val controller=AuthController.get(app)
        val device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val folder=File(app.getExternalFilesDir(null),"announcement336").apply{mkdirs()}
        var dark by mutableStateOf(true)
        var needsRecovery by mutableStateOf(false)
        var epoch by mutableIntStateOf(0)
        var credential by mutableStateOf<NativeMigrationCredential?>(null)
        val settings=AccountSettings(emptyList(),SyncRouting("fixed",emptyList(),emptyMap()),false,"STANDART",0,"profane","profane","24h",false,language,darkPalette="blue")
        compose.setContent{
            CompositionLocalProvider(LocalGenesisLanguage provides language,LocalEveningTheme provides dark,
                LocalDarkPalette provides "blue",LocalDensity provides Density(app.resources.displayMetrics.widthPixels/390f,1f)){
                MaterialTheme(colorScheme=if(dark)eveningPalette("blue")else daylightPalette("blue"),typography=GenesisTypography,shapes=GenesisShapes){
                    key(epoch){PrivateVaultGate(controller,AuthPanelState(user=ServerIdentity(if(needsRecovery)newOwner else owner,"GENESIS","demo@example.invalid",true),accountSettings=settings))}
                    RecoveryCredentialActivity(credential,vaultCopy.getString("title"),vaultCopy.getString("description"),
                        operation={_,_,_->error("ANNOUNCEMENT_CAPTURE_ONLY")},finished={_,_->credential=null})
                }
            }
        }
        fun reset(recovery:Boolean){compose.runOnIdle{needsRecovery=recovery;epoch++};compose.waitForIdle()}
        fun shot(name:String){compose.waitForIdle();assertTrue(device.takeScreenshot(File(folder,"$language-$name-${if(dark)"dark"else"light"}.png")))}
        for(night in listOf(true,false)){
            compose.runOnIdle{dark=night}
            reset(false);shot("01-lock")
            reset(true);shot("02-recovery")
            reset(false);compose.onNodeWithText(entryCopy.getString("title")).performClick();shot("03-device-entry")
            reset(false)
            compose.runOnIdle{credential=NativeMigrationCredential.captureVault(owner,"announcement",1,"",null,false,false,SystemClock.elapsedRealtime()){}}
            compose.waitForIdle()
            assertTrue(device.wait(Until.hasObject(By.text(unlockCopy.getString("pin"))),20000))
            assertTrue(device.takeScreenshot(File(folder,"$language-04-fingerprint-${if(dark)"dark"else"light"}.png")))
            device.pressBack();compose.waitUntil(20000){credential==null}
        }
    }
}
