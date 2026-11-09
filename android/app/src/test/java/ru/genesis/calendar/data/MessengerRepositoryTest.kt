package ru.genesis.calendar.data

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.MessagingGateway
import ru.genesis.calendar.auth.AuthFailure
import java.io.IOException

private class MessengerMemory : MessagingStore {
    val values=mutableMapOf<String,String>()
    override suspend fun read(key:String)=values[key]
    override suspend fun write(key:String,value:String){values[key]=value}
    override suspend fun delete(key:String){values.remove(key)}
}
private class MessengerServer : MessagingGateway {
    val id="21000000-0000-0000-0000-000000000001"
    val chat=JSONObject().put("id",id).put("kind","direct").put("title","Other").put("members",JSONArray().put(JSONObject().put("userId","owner").put("name","Me").put("role","owner").put("status","active")).put(JSONObject().put("userId","peer").put("name","Other").put("role","member").put("status","active")))
    val rows=linkedMapOf<String,JSONObject>();val commands=mutableListOf<String>();var loseAck=false;var account=true;var conflict=false
    override fun check(){check(account)}
    override suspend fun request(method:String,path:String,body:JSONObject?):JSONObject {
        check()
        return when {
            path=="/shared/messenger/conversations"->JSONObject().put("conversations",JSONArray().put(chat))
            path=="/shared/messenger/conversations/$id"->chat
            path.contains("/messages?before=")->JSONObject().put("messages",JSONArray(rows.values.toList())).put("nextCursor",JSONObject.NULL)
            path.endsWith("/read")->JSONObject().put("ok",true)
            path.endsWith("/messages")&&method=="POST"->{
                if(conflict)throw AuthFailure(AuthFailure.Kind.CONFLICT,409)
                val input=requireNotNull(body);commands+=input.toString();val mid=input.getString("id")
                if(!rows.containsKey(mid))rows[mid]=JSONObject().put("id",mid).put("seq",rows.size+1).put("senderId","owner").put("revision",1).put("text",input.getString("text"))
                if(loseAck){loseAck=false;throw IOException("Lost acknowledgement")}
                JSONObject().put("ok",true).put("id",mid).put("revision",1)
            }
            else->error("Unexpected request $method $path")
        }
    }
}
class MessengerRepositoryTest {
    @Test fun confirmedConflictCanReturnToDurableDraftButUnknownOutcomeCannot()=runBlocking {
        val server=MessengerServer();val store=MessengerMemory();var repository=MessengerRepository("owner",server,store)
        repository.initialize();repository.select(repository.state.value.chats.single());repository.saveDraft("Preserve rejected text")
        server.conflict=true
        assertTrue(runCatching{repository.send()}.isFailure);assertTrue(repository.state.value.pendingConflict)
        repository.recoverPendingConflict();assertFalse(repository.state.value.pending)
        repository=MessengerRepository("owner",server,store);repository.initialize();repository.select(repository.state.value.chats.single())
        assertEquals("Preserve rejected text",repository.state.value.draft)
        server.conflict=false;server.loseAck=true
        assertTrue(runCatching{repository.send()}.isFailure)
        assertTrue(runCatching{repository.recoverPendingConflict()}.isFailure)
        repository.send();assertEquals(1,server.rows.size)
    }
    @Test fun cloudChatNeverRequestsLegacyOrDeviceKeys()=runBlocking {
        val server=MessengerServer();val store=MessengerMemory();val repository=MessengerRepository("owner",server,store)
        repository.initialize();repository.select(repository.state.value.chats.single());repository.saveDraft("A normal conversation");repository.send()
        assertEquals("A normal conversation",repository.state.value.rows.single().text)
        assertFalse(store.values.keys.any{it.contains("device")||it=="identity"})
    }
    @Test fun unknownOutcomeRetriesTheExactCommandAfterRestart()=runBlocking {
        val server=MessengerServer();val store=MessengerMemory();var repository=MessengerRepository("owner",server,store)
        repository.initialize();repository.select(repository.state.value.chats.single());repository.saveDraft("Exactly once");server.loseAck=true
        try{repository.send();fail()}catch(_:IOException){}
        assertTrue(repository.state.value.pending);val command=server.commands.single()
        repository=MessengerRepository("owner",server,store);repository.initialize();repository.select(repository.state.value.chats.single());assertTrue(repository.state.value.pending)
        repository.send();assertEquals(listOf(command,command),server.commands);assertEquals(1,server.rows.size);assertFalse(repository.state.value.pending)
    }
    @Test fun accountChangePreventsFurtherWrites()=runBlocking {
        val server=MessengerServer();val store=MessengerMemory();val repository=MessengerRepository("owner",server,store)
        repository.initialize();repository.select(repository.state.value.chats.single());server.account=false
        try{repository.saveDraft("wrong account");fail()}catch(_:IllegalStateException){}
        assertTrue(server.commands.isEmpty())
    }
}
