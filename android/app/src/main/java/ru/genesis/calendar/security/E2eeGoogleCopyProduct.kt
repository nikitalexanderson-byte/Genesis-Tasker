package ru.genesis.calendar.security

import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/** Separate immutable, user-reviewed Google copies. These device records have
 * no background retry or executable archive-import path. */
internal class E2eeGoogleCopyProduct(private val account:E2eeProductAccount){
    companion object{
        fun content(input:JSONObject):JSONObject{
            val value=JSONObject(input.toString());for(key in listOf("dueDate","startDate","startTime","endTime","completedAt"))if(value.opt(key)=="")value.put(key,JSONObject.NULL)
            E2eeKeys.exact(value,setOf("title","description","dueDate","startDate","startTime","endTime","timeZone","completedAt"));check(value.getString("title").isNotBlank()&&value.getString("title").length<=2000&&value.getString("description").length<=100000){"E2EE_EXTERNAL_COPY_INVALID"}
            for(key in listOf("dueDate","startDate"))if(!value.isNull(key))check(LocalDate.parse(value.getString(key)).toString()==value.getString(key)){"E2EE_EXTERNAL_COPY_INVALID"}
            for(key in listOf("startTime","endTime"))if(!value.isNull(key))check(value.getString(key).matches(Regex("(?:[01]\\d|2[0-3]):[0-5]\\d"))){"E2EE_EXTERNAL_COPY_INVALID"}
            ZoneId.of(value.getString("timeZone"));if(!value.isNull("completedAt"))Instant.parse(value.getString("completedAt"));return value
        }
        private fun payload(input:JSONObject):JSONObject{
            E2eeKeys.exact(input,setOf("operationId","provider","accountId","copy"));check(UUID.fromString(input.getString("operationId")).toString()==input.getString("operationId")&&input.getString("provider") in setOf("google-tasks","google-calendar")){"E2EE_EXTERNAL_COPY_INVALID"};E2eeKeys.technical(input.getString("accountId"));val copy=content(input.getJSONObject("copy"))
            if(input.getString("provider")=="google-calendar")check(!copy.isNull("dueDate")&&copy.isNull("startTime")==copy.isNull("endTime")&&(copy.isNull("startDate")||copy.getString("startDate")<=copy.getString("dueDate"))){"E2EE_EXTERNAL_COPY_DATE_REQUIRED"};return JSONObject(input.toString()).put("copy",copy)
        }
    }
    private fun current(){account.requireOpen()}
    private fun document(id:String)=E2eeDeviceDocument(account.device,"external-google-copy:$id",{input->
        E2eeKeys.exact(input,setOf("protocol","ownerId","payload","state","externalId","createdAt"));val body=payload(input.getJSONObject("payload"));check(input.getInt("protocol")==1&&input.getString("ownerId")==account.ownerId&&body.getString("operationId")==id&&input.getString("state") in setOf("prepared","complete","uncertain")){"E2EE_EXTERNAL_COPY_INVALID"};Instant.parse(input.getString("createdAt"));if(!input.isNull("externalId"))check(input.getString("externalId").length in 1..2048){"E2EE_EXTERNAL_COPY_INVALID"};check(input.getString("state")!="complete"||!input.isNull("externalId")){"E2EE_EXTERNAL_COPY_INVALID"};JSONObject(input.toString()).put("payload",body)
    },::current)
    fun prepare(provider:String,accountId:String,copy:JSONObject):JSONObject{
        current();check(!account.offline){"E2EE_ONLINE_REQUIRED"};val id=UUID.randomUUID().toString();val body=payload(JSONObject().put("operationId",id).put("provider",provider).put("accountId",accountId).put("copy",content(copy)))
        val job=JSONObject().put("protocol",1).put("ownerId",account.ownerId).put("payload",body).put("state","prepared").put("externalId",JSONObject.NULL).put("createdAt",Instant.now().toString());document(id).save(job,null);current();return job
    }
    suspend fun send(job:JSONObject,confirmed:Boolean,transport:suspend(JSONObject,ExternalCopyConsent)->JSONObject):JSONObject{
        current();val body=payload(job.getJSONObject("payload"));val store=document(body.getString("operationId"));val old=store.load()?:error("E2EE_EXTERNAL_COPY_INVALID");check(E2eeProductJson.same(old.value,job)){"E2EE_EXTERNAL_COPY_CHANGED"};if(job.getString("state")=="complete")return JSONObject(job.toString())
        val consent=ExternalCopyConsent.approve(account,body.getString("provider"),"google-copy:${body.getString("accountId")}",body,confirmed);val receipt=transport(JSONObject(body.toString()),consent);current();E2eeKeys.exact(receipt,setOf("operationId","provider","state","externalId"))
        check(receipt.get("operationId")==body.get("operationId")&&receipt.get("provider")==body.get("provider")&&receipt.getString("state") in setOf("complete","uncertain")){"E2EE_INVALID_RECEIPT"}
        val next=JSONObject(job.toString()).put("state",receipt.get("state")).put("externalId",receipt.get("externalId"));store.save(next,old.serial);current();return next
    }
    fun retained():List<JSONObject>{current();return account.device.vault.listLocal("draft","external-google-copy:").map{id->document(id.removePrefix("external-google-copy:")).load()?.value?:error("E2EE_EXTERNAL_COPY_INVALID")}.sortedByDescending{it.getString("createdAt")}.also{current()}}
    override fun toString()="E2eeGoogleCopyProduct([redacted])"
}
