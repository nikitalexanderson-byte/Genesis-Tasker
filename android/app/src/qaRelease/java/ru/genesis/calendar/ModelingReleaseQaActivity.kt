package ru.genesis.calendar

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.data.AuroraGateway
import ru.genesis.calendar.domain.StoicheionReading
import ru.genesis.calendar.ui.*
import java.util.Base64

/** Isolated, minified QA host: no login, public API, billing or user workspace. */
class ModelingReleaseQaActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        check(packageName.endsWith(".qa1103.release"))
        WebView.setWebContentsDebuggingEnabled(true)
        val language=intent.getStringExtra("language")?.takeIf { it in listOf("ru","en","el","de","fr","es","it","pt","pl","sr","uk","zh","tr","ja") }?:"ru"
        val dark=intent.getBooleanExtra("dark",false)
        val palette=intent.getStringExtra("palette")?.takeIf { it in listOf("green","blue","burgundy","violet") }?:"blue"
        val ids="alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega".split(" ")
        val seed=intent.getLongExtra("seed",2L)
        val source=JSONObject().put("id","qa334-$seed").put("seed",seed).put("day","2026-11-16")
            .put("createdAt","2026-11-16T09:00:00Z").put("cards",JSONArray(StoicheionReading.spread(ids,seed).map { (id,reversed) ->
                JSONObject().put("cardId",id).put("reversed",reversed)
            }))
        val gateway=object:AuroraGateway {
            var envelope:JSONObject?=null
            override fun check(){}
            override suspend fun workspace()=JSONObject().put("workspace",JSONObject().put("keyMode","account")
                .put("key",Base64.getEncoder().encodeToString(ByteArray(32){(it+1).toByte()})))
            override suspend fun request(method:String,path:String,body:JSONObject?):JSONObject {
                require(path=="/aurora-workspace")
                if(method=="GET")return JSONObject().put("document",envelope?:JSONObject.NULL)
                envelope=JSONObject(requireNotNull(body).toString()).put("revision",(envelope?.optLong("revision")?:0)+1)
                return JSONObject().put("revision",envelope!!.getLong("revision"))
            }
            override suspend fun billing(method:String,path:String,body:JSONObject?)=error("QA billing disabled")
        }
        setContent {
            CompositionLocalProvider(LocalGenesisLanguage provides language,LocalEveningTheme provides dark,LocalDarkPalette provides palette) {
                MaterialTheme(colorScheme=if(dark)eveningPalette(palette)else daylightPalette(palette),typography=GenesisTypography,shapes=GenesisShapes) {
                    NativeAuroraDialog("release334-synthetic-owner",source,{finish()},{},gateway,
                        temporal=JSONObject().put("id","qa334-triad").put("seed",0xffff_ffffL).put("createdAt","2026-11-16T09:00:00Z"))
                }
            }
        }
    }
}
