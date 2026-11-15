package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.AuthFailure
import ru.genesis.calendar.data.*
import java.util.Base64

class MindmapRead333Test {
    @get:Rule val compose=createAndroidComposeRule<PagerTestActivity>()
    private class Gateway:MindmapTransport {
        var offline=false;var writes=0
        val rows=mutableListOf<JSONObject>()
        override fun check(){}
        override suspend fun workspace():JSONObject {
            if(offline)throw AuthFailure(AuthFailure.Kind.NETWORK)
            return JSONObject().put("workspace",JSONObject().put("keyMode","account")
                .put("key",Base64.getEncoder().encodeToString(ByteArray(32){it.toByte()})))
        }
        override suspend fun request(path:String,body:JSONObject?):JSONObject {
            if(offline)throw AuthFailure(AuthFailure.Kind.NETWORK)
            if(body==null)return JSONObject().put("maps",JSONArray(rows))
            writes++
            rows.add(JSONObject(body.toString()).put("id",path.substringAfterLast('/')).put("revision",writes))
            return JSONObject().put("revision",writes)
        }
    }
    @Test fun failedReadKeepsCachedMapAndRetryLoadsWithoutSendingASave() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val db=Room.inMemoryDatabaseBuilder(context,GenesisDatabase::class.java).build()
        val gateway=Gateway()
        val repo=MindmapRepository(db,"read333-isolated","read333-owner",gateway)
        val map=MindmapDocument.new("Проверка сохранённой карты")
        runBlocking {repo.save(map)}
        gateway.offline=true
        compose.setContent {MaterialTheme {Surface(Modifier.fillMaxSize()) {
            MindmapsScreen(repo,emptyList(),emptyList(),null,{}, {_,_->},{},{_,_->},{})
        }}}
        try {
            compose.waitUntil(15000){compose.onAllNodesWithTag("mindmaps-retry-load").fetchSemanticsNodes().isNotEmpty()}
            compose.onNodeWithTag("mindmap-open-${map.id}").performClick()
            compose.onNodeWithText("Authentication request failed").assertDoesNotExist()
            compose.onNodeWithText("Повторить сохранение").assertDoesNotExist()
            compose.onNodeWithText("Нет подтверждения от сервера. Проверьте сеть и повторите.").assertExists()
            assertEquals(1,gateway.writes)
            assertEquals(map.json().toString(),repo.records.value.single().document.json().toString())
            gateway.offline=false
            compose.onNodeWithTag("mindmaps-retry-load").performClick()
            compose.waitUntil(15000){compose.onAllNodesWithTag("mindmaps-retry-load").fetchSemanticsNodes().isEmpty()}
            assertEquals("A reload is never an unintended save",1,gateway.writes)
            assertFalse(repo.records.value.single().unsynced)
        } finally {db.close()}
    }
}
