package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.MessagingGateway
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.data.*
import java.io.File

private class Messenger310Store : MessagingStore {
    private val values=mutableMapOf<String,String>()
    override suspend fun read(key:String)=values[key]
    override suspend fun write(key:String,value:String){values[key]=value}
    override suspend fun delete(key:String){values.remove(key)}
}
private class Messenger310Gateway : MessagingGateway {
    val cid="31000000-0000-0000-0000-000000000001"
    val chat=JSONObject().put("id",cid).put("kind","direct").put("title","Анна").put("members",JSONArray()
        .put(JSONObject().put("userId","owner").put("name","Вы").put("role","owner").put("status","active"))
        .put(JSONObject().put("userId","peer").put("name","Анна").put("role","member").put("status","active")))
    val rows=mutableListOf<JSONObject>()
    var hidden=false
    var deleted=false
    val routes=mutableListOf<String>()
    override fun check()=Unit
    override suspend fun request(method:String,path:String,body:JSONObject?):JSONObject {
        routes+=path
        return when {
            path=="/shared/messenger/conversations"->if(method=="GET")JSONObject()
                .put("conversations",JSONArray().apply{if(!hidden&&!deleted)put(chat)})
                .put("hiddenConversations",JSONArray().apply{if(hidden&&!deleted)put(chat)})else chat
            path.endsWith("/visibility")->{when(requireNotNull(body).getString("action")){"hide"->hidden=true;"show"->hidden=false;"delete"->{deleted=true;hidden=false}};JSONObject().put("ok",true)}
            path=="/shared/messenger/conversations/$cid"->chat
            path.contains("/messages?before=")->JSONObject().put("messages",JSONArray(rows)).put("nextCursor",JSONObject.NULL)
            path.endsWith("/messages")&&method=="POST"->{val input=requireNotNull(body);rows+=JSONObject().put("id",input.getString("id")).put("seq",rows.size+1).put("senderId","owner").put("revision",1).put("text",input.getString("text"));JSONObject().put("ok",true)}
            path.endsWith("/read")->JSONObject().put("ok",true)
            path.endsWith("/projects")->JSONObject().put("projects",JSONArray())
            path.endsWith("/contacts")->JSONObject().put("contacts",JSONArray().put(JSONObject().put("userId","peer").put("name","Анна").put("email","anna@example.com")))
            else->error("Unexpected messenger route $method $path")
        }
    }
}
class Messenger310Test {
    @Test fun contactFieldAndAddButtonShareHeightAndHaveASpaceBetweenThem() {
        content()
        compose.waitUntil(15000) { repository.state.value.ready }
        compose.onNodeWithText("Контакты").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("messenger-contact-email").fetchSemanticsNodes().isNotEmpty() }
        val field = compose.onNodeWithTag("messenger-contact-email").fetchSemanticsNode().boundsInRoot
        val add = compose.onNodeWithTag("messenger-contact-add").fetchSemanticsNode().boundsInRoot
        assertEquals(field.height, add.height, 1f)
        assertTrue(add.left > field.right)
        assertEquals(field.center.y, add.center.y, 1f)
        capture("contacts-aligned")
    }
    @get:Rule val compose=createAndroidComposeRule<PagerTestActivity>()
    private val gateway=Messenger310Gateway()
    private val repository=MessengerRepository("owner",gateway,Messenger310Store())
    private val width get()=InstrumentationRegistry.getArguments().getString("genesisWidth")?.toIntOrNull()?:390
    private val dark get()=InstrumentationRegistry.getArguments().getString("genesisEvening")=="true"
    private fun content(){compose.setContent{
        CompositionLocalProvider(LocalDensity provides Density(compose.activity.resources.displayMetrics.widthPixels.toFloat()/width,1f),LocalGenesisLanguage provides "ru",LocalEveningTheme provides dark){
            MaterialTheme(colorScheme=if(dark)evening else standart,typography=GenesisTypography,shapes=GenesisShapes){
                Surface(Modifier.fillMaxSize()){MobileWorkspaceShell("Сообщения",null,emptyList(),"Synthetic messenger fixture",true,onNavigate={},actions={}){MessengerScreen(repository,"ru",onClose={})}}
            }
        }
    }}
    private fun capture(name:String){compose.waitForIdle();assertEquals(compose.activity.packageName,UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).currentPackageName);captureNativeWindow(File(compose.activity.getExternalFilesDir(null),"messenger310-$width-${if(dark)"dark"else"light"}-$name.png"))}
    @Test fun ordinaryChatUsesTheAccountWithoutAnyKeyRecovery(){
        content();compose.waitUntil(15000){repository.state.value.ready}
        compose.onNodeWithText("Восстановите ключ сообщений").assertDoesNotExist();capture("inbox")
        compose.onNodeWithTag("messenger-chat-${gateway.cid}").performClick();compose.waitUntil(10000){repository.state.value.selected!=null}
        compose.onNodeWithTag("messenger-draft").performTextInput("Единый аккаунт")
        compose.onNodeWithContentDescription("Отправить").performClick();compose.waitUntil(10000){repository.state.value.rows.isNotEmpty()}
        compose.onNodeWithText("Единый аккаунт").assertExists();assertTrue(gateway.routes.none{it.contains("/key")||it.contains("/devices")});capture("chat")
    }
    @Test fun newChatDialogAndContactsNeedNoAdditionalLogin(){
        content();compose.waitUntil(15000){repository.state.value.ready}
        compose.onNodeWithTag("messenger-actions").performClick();compose.onNodeWithText("Новый чат").performClick();compose.onNodeWithContentDescription("Секретный чат").assertExists();compose.onNodeWithContentDescription("Личный чат").assertExists();capture("new-chat")
        compose.onNodeWithText("Отмена").performClick()
        compose.waitUntil(10000){runCatching{compose.onNodeWithText("Контакты").assertIsEnabled()}.isSuccess}
        compose.onNodeWithText("Контакты").performClick()
        compose.waitUntil(10000){compose.onAllNodesWithText("anna@example.com").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithText("anna@example.com").assertExists();capture("contacts")
    }
    @Test fun chatCanBeHiddenRestoredAndDeletedOnlyAfterConfirmation(){
        content();compose.waitUntil(15000){repository.state.value.ready}
        compose.onNodeWithTag("messenger-chat-hide-${gateway.cid}").assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp).performClick()
        compose.waitUntil(10000){repository.state.value.chats.isEmpty()&&repository.state.value.hiddenChats.size==1}
        compose.onNodeWithTag("messenger-chat-${gateway.cid}").assertDoesNotExist()
        compose.onNodeWithTag("messenger-actions").performClick();compose.onNodeWithText("Скрытые чаты").performClick()
        compose.onNodeWithTag("messenger-chat-${gateway.cid}").assertExists();capture("hidden-chat")
        compose.onNodeWithTag("messenger-chat-hide-${gateway.cid}").performClick()
        compose.waitUntil(10000){repository.state.value.chats.size==1&&repository.state.value.hiddenChats.isEmpty()}
        compose.activityRule.scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        compose.onNodeWithTag("messenger-chat-delete-${gateway.cid}").assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithTag("messenger-chat-delete-confirm").assertExists();compose.onNodeWithText("Отмена").performClick()
        compose.runOnIdle{assertFalse(gateway.deleted)}
        compose.onNodeWithTag("messenger-chat-delete-${gateway.cid}").performClick();capture("confirm-chat-delete")
        compose.onNodeWithTag("messenger-chat-delete-confirm").performClick()
        compose.waitUntil(10000){repository.state.value.chats.isEmpty()&&repository.state.value.hiddenChats.isEmpty()}
        compose.onNodeWithTag("messenger-chat-${gateway.cid}").assertDoesNotExist()
        assertTrue(gateway.deleted);assertTrue(gateway.routes.any{it.endsWith("/visibility")})
    }
}

