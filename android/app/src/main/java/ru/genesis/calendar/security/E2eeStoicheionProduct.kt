package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import ru.genesis.calendar.domain.StoicheionReading

/** New client content roots; server sees quota metadata and immutable references.
 * An unfinished operation requires explicit resume, never a second automatic roll. */
internal class E2eeStoicheionProduct(private val account:E2eeProductAccount){
    private val random=SecureRandom()
    private val ids=listOf("alpha","beta","gamma","delta","epsilon","zeta","eta","theta","iota","kappa","lambda","mu","nu","xi","omicron","pi","rho","sigma","tau","upsilon","phi","chi","psi","omega")
    private fun key()="stoicheion-state:${account.directory.scopeId}"
    private fun check(){account.requireOpen()}
    private fun number(value:JSONObject,name:String,min:Long=0,max:Long=9007199254740991):Long=E2eeCommands.integer(value.get(name),min).also{check(it<=max){"E2EE_STOICHEION_CONTENT_INVALID"}}
    private fun cards(seed:Long,size:Int=9)=JSONArray(StoicheionReading.spread(ids,seed,size).map{(id,reversed)->JSONObject().put("cardId",id).put("reversed",reversed)})
    private fun cardList(value:JSONArray){check(value.length()==9){"E2EE_STOICHEION_CONTENT_INVALID"};val seen=mutableSetOf<String>()
        for(at in 0 until value.length()){val row=value.getJSONObject(at);E2eeKeys.exact(row,setOf("cardId","reversed"));check(row.getString("cardId") in ids&&seen.add(row.getString("cardId"))&&row.get("reversed") is Boolean){"E2EE_STOICHEION_CONTENT_INVALID"}}}
    private fun validateContent(value:JSONObject):JSONObject{
        E2eeKeys.exact(value,setOf("protocol","ownerId","scopeId","intentId","kind","action","periodKey","expectedRevision","seed","cards"))
        check(value.getInt("protocol")==1&&value.getString("ownerId")==account.ownerId&&value.getString("scopeId")==account.directory.scopeId&&value.getString("kind") in setOf("daily","spread","timeline")
            &&value.getString("action") in setOf("draw","spread-card","reveal","reroll")){"E2EE_STOICHEION_CONTENT_INVALID"}
        E2eeKeys.technical(value.getString("intentId"));LocalDate.parse(value.getString("periodKey"));number(value,"expectedRevision");number(value,"seed",0,0xffff_ffffL)
        if(value.getString("kind")=="spread")cardList(value.getJSONArray("cards"))else check(value.isNull("cards")){"E2EE_STOICHEION_CONTENT_INVALID"};return value
    }
    private fun head(value:JSONObject,kind:String):JSONObject{
        check(value.getString("kind")==kind&&value.get("legacy") is Boolean&&value.getBoolean("legacy")==value.isNull("reference")){"E2EE_STOICHEION_CONTENT_INVALID"}
        LocalDate.parse(value.getString("dayKey"));LocalDate.parse(value.getString("periodKey"));Instant.parse(value.getString("firstDrawAt"));number(value,"revision",1)
        if(!value.isNull("reference")){val ref=value.getJSONObject("reference");E2eeKeys.exact(ref,setOf("objectId","payloadHash"));E2eeKeys.technical(ref.getString("objectId"));check(ref.getString("objectId").startsWith("stoicheion-live:"));E2eeEnvelope.decode(ref.getString("payloadHash"),32)}
        if(kind=="timeline"){val windows=value.getJSONArray("cards");check(windows.length()<=3);for(at in 0 until windows.length()){val window=windows.getJSONObject(at)
            check(window.getInt("position")==at&&window.get("rerolled") is Boolean&&window.get("canReroll") is Boolean&&window.get("unlimited") is Boolean);Instant.parse(window.getString("firstRevealedAt"));Instant.parse(window.getString("rerollDeadline"));number(window,"remainingSeconds",0,180)}}
        else{number(value,"attempts",1,2);number(value,"cardRevision");number(value,"remainingSeconds",0,180);Instant.parse(value.getString("rerollDeadline"));check(value.get("canReroll") is Boolean&&value.get("unlimited") is Boolean)};return value
    }
    private fun validateState(value:JSONObject):JSONObject{
        E2eeKeys.exact(value,setOf("dayKey","serverNow","draws","timeline","testingAccess","unlimitedDraws","periods","checkpointHash","directoryRevision"));LocalDate.parse(value.getString("dayKey"));Instant.parse(value.getString("serverNow"));number(value,"directoryRevision",1);E2eeEnvelope.decode(value.getString("checkpointHash"),32)
        check(value.get("testingAccess") is Boolean&&value.get("unlimitedDraws") is Boolean);val draws=value.getJSONObject("draws")
        for(kind in draws.keys()){check(kind in setOf("daily","spread"));head(draws.getJSONObject(kind),kind)};if(!value.isNull("timeline"))head(value.getJSONObject("timeline"),"timeline")
        val periods=value.getJSONObject("periods");E2eeKeys.exact(periods,setOf("daily","spread","timeline"));periods.keys().forEach{LocalDate.parse(periods.getString(it))};return value
    }
    private fun state(offline:Boolean=account.offline):JSONObject{check();val prior=account.device.vault.read("key-check",key())
        try{if(offline)return validateState(E2eeFileManifestJson.readPrivateDocument(prior?.bytes?:error("E2EE_OFFLINE_CONTENT_UNAVAILABLE")))
            val value=validateState(account.client.readStoicheionState());check()
            // Publish cache metadata only once every referenced body is locally
            // authenticated. A failed fetch leaves the previous view intact.
            val draws=value.getJSONObject("draws");for(kind in draws.keys())open(draws.getJSONObject(kind),false)
            if(!value.isNull("timeline"))open(value.getJSONObject("timeline"),false)
            writeState(value,prior?.serial);return value
        }finally{prior?.bytes?.fill(0)}}
    private fun writeState(value:JSONObject,serial:Long?){val bytes=value.toString().toByteArray(Charsets.UTF_8);try{account.device.vault.write(listOf(UnlockedE2eeVault.Write("key-check",key(),bytes,serial)));check()}finally{bytes.fill(0)}}
    private fun document(objectId:String)=E2eePrivateDocument(account.device,account.client,account.directory.scopeId,"stoicheion",objectId,::validateContent,::check,::check)
    private fun legacy(row:JSONObject,offline:Boolean):JSONObject{
        val document=E2eePrivateDocument(account.device,account.client,account.directory.scopeId,"stoicheion","personal-stoicheion-draw-history-v1",{value->
            E2eeKeys.exact(value,setOf("protocol","ownerId","server","device"));check(value.getInt("protocol")==1&&value.getString("ownerId")==account.ownerId){"E2EE_SCOPE_BINDING_MISMATCH"};value},::check,::check)
        val view=document.load(offline);check(!view.pending&&view.conflict==null){"E2EE_STOICHEION_HISTORY_REVIEW_REQUIRED"};val source=view.value.getJSONObject("server");val kind=row.getString("kind")
        fun find(rows:JSONArray,predicate:(JSONObject)->Boolean):JSONObject?=(0 until rows.length()).map{rows.getJSONObject(it)}.firstOrNull(predicate)
        val draw=(if(kind=="timeline")find(source.getJSONArray("timelineSessions")){it.getString("periodKey")==row.getString("periodKey")}else null)
            ?:find(source.getJSONArray("draws")){it.getString("kind")==kind&&it.getString("dayKey")==row.getString("dayKey")}?:error("E2EE_PRIVATE_SEED_REQUIRED")
        val seed=number(draw,"seed",0,0xffff_ffffL);val spread=if(kind=="spread")find(source.getJSONArray("spreadCards")){it.getString("dayKey")==row.getString("dayKey")&&it.getLong("sourceSeed")==seed}else null
        if(kind=="spread")check((spread?.getLong("revision")?:0)==row.getLong("cardRevision")){"E2EE_STOICHEION_HISTORY_REVIEW_REQUIRED"}
        val value=JSONObject().put("seed",seed).put("cards",if(kind=="spread")spread?.getJSONArray("cards")?:cards(seed)else JSONObject.NULL)
        if(kind=="spread")cardList(value.getJSONArray("cards"));return value
    }
    private fun open(row:JSONObject,offline:Boolean=account.offline):JSONObject{
        val kind=row.getString("kind");head(row,kind);if(row.getBoolean("legacy"))return legacy(row,offline)
        val ref=row.getJSONObject("reference");if(!offline)account.client.assertObjectReference("stoicheion",ref.getString("objectId"),1,ref.getString("payloadHash"));check()
        val view=document(ref.getString("objectId")).load(offline);val value=view.value;check()
        check(!view.pending&&view.conflict==null&&view.remoteRevision==1L&&ref.getString("objectId")=="stoicheion-live:${value.getString("intentId")}"&&value.getString("kind")==kind
            &&value.getString("periodKey")==row.getString("periodKey")&&value.getLong("expectedRevision")+1==row.getLong("revision")){"E2EE_STOICHEION_CONTENT_INVALID"};return value
    }
    private fun draw(row:JSONObject,offline:Boolean=account.offline):JSONObject{val value=open(row,offline);return JSONObject(row.toString()).put("seed",value.getLong("seed")).also{if(!value.isNull("cards"))it.put("cards",value.getJSONArray("cards"))}}
    private fun timeline(row:JSONObject,offline:Boolean=account.offline):JSONObject=JSONObject(row.toString()).put("seed",open(row,offline).getLong("seed"))
    @Synchronized fun loadDraws(offline:Boolean=account.offline):JSONObject{val current=state(offline);val source=current.getJSONObject("draws");val result=JSONObject()
        for(kind in source.keys())result.put(kind,draw(source.getJSONObject(kind),offline));return JSONObject().put("dayKey",current.get("dayKey")).put("draws",result).put("testingAccess",current.get("testingAccess")).put("unlimitedDraws",current.get("unlimitedDraws"))}
    @Synchronized fun loadTimeline(offline:Boolean=account.offline):JSONObject{val current=state(offline);return JSONObject().put("timeline",if(current.isNull("timeline"))JSONObject.NULL else timeline(current.getJSONObject("timeline"),offline)).put("serverNow",current.get("serverNow"))}
    @Synchronized fun hasLocalState():Boolean{check();val row=account.device.vault.read("key-check",key());return try{row!=null}finally{row?.bytes?.fill(0)}}
    private class Pending(val value:JSONObject,val serial:Long)
    private fun pending(kind:String):Pending?{val row=account.device.vault.read("outbox","stoicheion-job:$kind")?:return null
        try{val value=E2eeFileManifestJson.readPrivateDocument(row.bytes);E2eeKeys.exact(value,setOf("protocol","ownerId","kind","content","position","complete","result"));check(value.getInt("protocol")==1&&value.getString("ownerId")==account.ownerId&&value.getString("kind")==kind&&value.get("complete") is Boolean){"E2EE_CORRUPT_OUTBOX"};validateContent(value.getJSONObject("content"));return Pending(value,row.serial)}finally{row.bytes.fill(0)}}
    private fun saveJob(value:JSONObject,serial:Long?):Long{val bytes=value.toString().toByteArray(Charsets.UTF_8);try{account.device.vault.write(listOf(UnlockedE2eeVault.Write("outbox","stoicheion-job:${value.getString("kind")}",bytes,serial)));check();NativePrivateProducts.changed(ru.genesis.calendar.auth.CloudAccountSnapshot.scopeFor(account.ownerId))}finally{bytes.fill(0)};return(serial?:0)+1}
    private fun finish(job:JSONObject,serial:Long):JSONObject{
        if(job.getBoolean("complete"))return job.getJSONObject("result");check(!account.offline){"E2EE_ONLINE_REQUIRED"};val value=job.getJSONObject("content");val objectId="stoicheion-live:${value.getString("intentId")}";val document=document(objectId)
        val view=try{document.load()}catch(error:IllegalStateException){if(error.message!="E2EE_PRIVATE_DOCUMENT_MISSING")throw error;document.save(value,null,0);document.load(true)}
        check(view.conflict==null&&view.remoteRevision<=1&&E2eeProductJson.same(view.value,value)){"E2EE_STOICHEION_CONTENT_INVALID"};if(view.pending)document.flush()
        val ref=account.client.objectReference("stoicheion",objectId);check();val result=account.client.executeService("stoicheion-grant",JSONObject().put("kind",job.get("kind")).put("action",value.get("action")).put("position",job.get("position"))
            .put("expectedRevision",value.get("expectedRevision")).put("periodKey",value.get("periodKey")).put("objectId",objectId).put("payloadHash",ref.get("payloadHash")),value.getString("intentId"));check()
        check(result.getString("intentId")==value.getString("intentId")&&result.getString("kind")==job.getString("kind")){"E2EE_INVALID_RECEIPT"};val head=head(result.getJSONObject("head"),job.getString("kind"));val reference=head.getJSONObject("reference")
        check(reference.getString("objectId")==objectId&&reference.get("payloadHash")==ref.get("payloadHash")&&head.getLong("revision")==value.getLong("expectedRevision")+1){"E2EE_INVALID_RECEIPT"}
        job.put("complete",true).put("result",result);saveJob(job,serial)
        val prior=account.device.vault.read("key-check",key());try{if(prior!=null){val current=validateState(E2eeFileManifestJson.readPrivateDocument(prior.bytes));if(head.getString("kind")=="timeline")current.put("timeline",head)else current.getJSONObject("draws").put(head.getString("kind"),head);current.put("serverNow",result.get("serverNow"));writeState(current,prior.serial)}}finally{prior?.bytes?.fill(0)}
        return result
    }
    private fun mutate(kind:String,action:String,position:Int?,seed:Long?=null,expected:JSONObject?=null):JSONObject{
        check();check(!account.offline){"E2EE_ONLINE_REQUIRED"};val previous=pending(kind);check(previous==null||previous.value.getBoolean("complete")){"E2EE_STOICHEION_PENDING_RETRY_REQUIRED"}
        val current=state();val prior=if(kind=="timeline")current.optJSONObject("timeline")else current.getJSONObject("draws").optJSONObject(kind);val opened=prior?.let{open(it)}
        if(expected!=null)for(field in expected.keys()){val actual=if(field=="seed")opened?.opt(field)else prior?.opt(field)?:if(field in setOf("revision","cardRevision"))0L else null
            check(if(actual is Number&&expected.get(field) is Number)actual.toLong()==expected.getLong(field)else actual==expected.get(field)){"E2EE_STOICHEION_STALE"}}
        if(kind=="timeline"&&action=="reveal"&&prior!=null&&requireNotNull(position)<prior.getJSONArray("cards").length())return JSONObject().put("head",prior).put("serverNow",current.get("serverNow"))
        var nextSeed=seed?:random.nextInt().toUInt().toLong();var nextCards=if(kind=="spread")cards(nextSeed)else null
        if(action=="spread-card"){check(opened!=null&&position!=null&&position in 0..8);nextSeed=opened.getLong("seed");val replacement=JSONArray(opened.getJSONArray("cards").toString());val held=(0 until replacement.length()).map{replacement.getJSONObject(it).getString("cardId")};val pool=ids.filter{it !in held};replacement.put(position,JSONObject().put("cardId",pool[random.nextInt(pool.size)]).put("reversed",random.nextBoolean()));nextCards=replacement}
        if(kind=="timeline"&&opened!=null){nextSeed=opened.getLong("seed");if(action=="reroll"){val held=cards(nextSeed,3);var found=false
            for(attempt in 0 until 100000){val candidate=random.nextInt().toUInt().toLong();val draw=cards(candidate,3);val index=requireNotNull(position)
                if(draw.getJSONObject(index).getString("cardId")!=held.getJSONObject(index).getString("cardId")&&(0..2).all{it==index||E2eeProductJson.same(draw.getJSONObject(it),held.getJSONObject(it))}){nextSeed=candidate;found=true;break}}
            check(found){"E2EE_STOICHEION_RANDOM_UNAVAILABLE"}}}
        val value=JSONObject().put("protocol",1).put("ownerId",account.ownerId).put("scopeId",account.directory.scopeId).put("intentId",UUID.randomUUID().toString()).put("kind",kind).put("action",action)
            .put("periodKey",current.getJSONObject("periods").getString(kind)).put("expectedRevision",prior?.getLong("revision")?:0).put("seed",nextSeed).put("cards",nextCards?:JSONObject.NULL);validateContent(value)
        val job=JSONObject().put("protocol",1).put("ownerId",account.ownerId).put("kind",kind).put("content",value).put("position",position?:JSONObject.NULL).put("complete",false).put("result",JSONObject.NULL)
        if(previous!=null){val bytes=previous.value.toString().toByteArray(Charsets.UTF_8);try{account.device.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","stoicheion-history:${previous.value.getJSONObject("content").getString("intentId")}",bytes,null)))}finally{bytes.fill(0)}}
        return finish(job,saveJob(job,previous?.serial))
    }
    @Synchronized fun saveDraw(kind:String,seed:Long):JSONObject{check(kind in setOf("daily","spread"));return JSONObject().put("draw",draw(mutate(kind,"draw",null,seed).getJSONObject("head")))}
    @Synchronized fun spreadCard(position:Int,revision:Long,seed:Long,dayKey:String):JSONObject=JSONObject().put("draw",draw(mutate("spread","spread-card",position,expected=JSONObject().put("cardRevision",revision).put("seed",seed).put("dayKey",dayKey)).getJSONObject("head")))
    @Synchronized fun timelineCard(position:Int,action:String,revision:Long):JSONObject{check(position in 0..2&&action in setOf("reveal","reroll"));val result=mutate("timeline",action,position,expected=JSONObject().put("revision",revision));return JSONObject().put("timeline",timeline(result.getJSONObject("head"))).put("serverNow",result.get("serverNow"))}
    @Synchronized fun resume(kind:String):JSONObject{check(kind in setOf("daily","spread","timeline"));val value=pending(kind)?:error("E2EE_PENDING_SAVE_REQUIRED");return finish(value.value,value.serial)}
    @Synchronized fun pendingKinds():List<String>{check();return listOf("daily","spread","timeline").filter{kind->pending(kind)?.value?.getBoolean("complete")==false}}
    override fun toString()="E2eeStoicheionProduct([redacted])"
}
