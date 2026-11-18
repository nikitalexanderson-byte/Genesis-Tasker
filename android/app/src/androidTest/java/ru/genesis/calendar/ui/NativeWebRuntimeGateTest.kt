package ru.genesis.calendar.ui

import android.webkit.WebView
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.assertion.ViewAssertions.doesNotExist
import androidx.test.espresso.matcher.ViewMatchers.isAssignableFrom
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.data.*
import java.io.File
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger

/** Run on the task-owned API26 image with its original Chromium69 provider. */
class NativeWebRuntimeGateTest {
    @get:Rule val compose=createAndroidComposeRule<PagerTestActivity>()
    @Test fun oldProviderShowsAllLocalizedFallbacksWithoutOpeningAnEditorOrChangingData(){
        val app=compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.contains(".qa"))
        assertNotNull(nativeWebRuntimeProblem(app,"en"))
        val copy=app.assets.open("originals/i18n/native-web-runtime-copy.json").bufferedReader(Charsets.UTF_8).use{JSONObject(it.readText())}
        val owner="runtime-gate-${UUID.randomUUID()}";app.activateAccount(owner)
        val source=DocumentRecord(app.workspaceScope,"aurora-pending","retained-opaque-source",7)
        runBlocking{app.database.dao().putDocument(source)}
        val io=AtomicInteger()
        val aurora=object: AuroraGateway {
            override fun check(){}
            override suspend fun workspace():JSONObject{io.incrementAndGet();error("Unexpected legacy IO")}
            override suspend fun request(method:String,path:String,body:JSONObject?):JSONObject{io.incrementAndGet();error("Unexpected legacy IO")}
            override suspend fun billing(method:String,path:String,body:JSONObject?):JSONObject{io.incrementAndGet();error("Unexpected billing IO")}
        }
        val backup=object: BackupGateway {
            override fun check(){}
            override suspend fun request(method:String,path:String,body:JSONObject?):JSONObject{io.incrementAndGet();error("Unexpected backup IO")}
            override suspend fun quiesce(){io.incrementAndGet();error("Unexpected backup mutation")}
        }
        var language by mutableStateOf("en");var dark by mutableStateOf(false);var module by mutableStateOf("aurora")
        try {
            compose.setContent {
                val density=LocalDensity.current
                CompositionLocalProvider(LocalGenesisLanguage provides language,LocalEveningTheme provides dark,LocalDensity provides Density(density.density,1.3f)){
                    MaterialTheme(colorScheme=if(dark)evening else standart,typography=GenesisTypography,shapes=GenesisShapes){
                        key(module,language,dark){when(module){
                            "aurora"->NativeAuroraDialog(owner,null,{},{},aurora)
                            "backup"->NativeBackupDialog(owner,"Backup",{},backup)
                            else->NativeOlympianDialog("Catalogue",{},{},{})
                        }}
                    }
                }
            }
            for(scheme in listOf(false,true))for(lang in copy.keys())for(feature in listOf("aurora","backup","olympian")){
                compose.runOnIdle{language=lang;dark=scheme;module=feature}
                val tag=when(feature){"aurora"->"aurora-native-error";"backup"->"backup-native-runtime-required";else->"olympian-native-runtime-required"}
                compose.onNodeWithTag(tag).assertIsDisplayed().assertTextEquals(copy.getString(lang))
                onView(isAssignableFrom(WebView::class.java)).check(doesNotExist())
                captureNativeWindow(File(compose.activity.getExternalFilesDir(null),"web-runtime-${if(scheme)"dark" else "light"}-$lang-$feature.png"))
            }
            assertEquals(0,io.get())
            assertEquals(source,runBlocking{app.database.dao().document(source.scope,source.kind)})
        } finally {app.activateAccount(null)}
    }
}
