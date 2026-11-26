package ru.genesis.calendar.ui

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class NativeWebRuntimeTest {
    private val root=generateSequence(File(requireNotNull(System.getProperty("user.dir")))){it.parentFile}
        .first{File(it,"contracts/native-web-runtime-v1.json").isFile}
    private val policy=JSONObject(File(root,"contracts/native-web-runtime-v1.json").readText())
    @Test fun runtimeAcceptsThePackagedTargetAndFutureVersionsButFailsClosedForUnknownProviders(){
        val minimum=policy.getInt("minimumChromiumMajor")
        assertEquals("chrome$minimum",policy.getString("buildTarget"))
        for(version in listOf("$minimum.0.0.0","${minimum+1}.0.1.2","150.0.1.0 beta"))assertTrue(version,nativeWebVersionSupported(version,minimum))
        for(version in listOf(null,"","69.0.3497.100","${minimum-1}.0.0.0","999","111.0","111.0.bad.0","111.0.0.0evil"))assertFalse(version,nativeWebVersionSupported(version,minimum))
        assertFalse(nativeWebVersionSupported("150.0.0.0",0))
    }
    @Test fun everyAccountLanguageHasAnAuthoredOfflineRuntimeMessage(){
        val copy=JSONObject(File(root,"app/native-web-runtime-copy.json").readText())
        assertEquals(setOf("ru","en","de","fr","es","it","pt","pl","el","sr","uk","zh","tr","ja"),copy.keys().asSequence().toSet())
        for(language in copy.keys())assertTrue(language,copy.getString(language).contains("Android System WebView") && copy.getString(language).contains("Chrome"))
    }
}
