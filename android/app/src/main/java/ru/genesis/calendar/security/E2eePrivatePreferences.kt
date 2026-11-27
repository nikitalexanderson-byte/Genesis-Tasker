package ru.genesis.calendar.security

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.AdvicePreferences
import ru.genesis.calendar.auth.AccountSettings
import ru.genesis.calendar.auth.UiVisibility
import ru.genesis.calendar.auth.SyncRouting

/** Private preference projections are independent of profile receipts, billing
 * and linked-account authority. Native patches preserve web-only layout fields. */
internal class E2eePrivatePreferences(context:Context,private val account:E2eeProductAccount){
    private val defaults=context.assets.open("private-preferences-v1.json").bufferedReader(Charsets.UTF_8).use{JSONObject(it.readText()).getJSONObject("uiDefaults")}
    private var current:JSONObject?=null
    private fun readOriginal(id:String):JSONObject{account.requireOpen();val row=account.client.read("workspace",id)?:error("E2EE_PRIVATE_SEED_REQUIRED")
        try{account.requireOpen();return E2eeFileManifestJson.readPrivateDocument(row.bytes)}finally{row.bytes.fill(0)}}
    private fun strings(value:JSONArray):List<String>{check(value.length()<=10000){"E2EE_PRIVATE_PREFERENCES_INVALID"};val rows=(0 until value.length()).map{value.get(it).also{entry->check(entry is String&&entry.isNotEmpty()&&entry.length<=256){"E2EE_PRIVATE_PREFERENCES_INVALID"}} as String}
        check(rows.size==rows.toSet().size){"E2EE_PRIVATE_PREFERENCES_INVALID"};return rows}
    private fun preserved(raw:Any?,normalized:Any?):Boolean=when(raw){
        is JSONObject->normalized is JSONObject&&raw.keys().asSequence().all{normalized.has(it)&&preserved(raw.get(it),normalized.get(it))}
        is JSONArray->normalized is JSONArray&&raw.length()==normalized.length()&&(0 until raw.length()).all{left->(0 until normalized.length()).any{right->preserved(raw.get(left),normalized.get(right))}}
        else->E2eeProductJson.same(raw,normalized)
    }
    private fun visibility(input:JSONObject):JSONObject{
        check(input.keys().asSequence().all(defaults::has)){"E2EE_PRIVATE_PREFERENCES_REVIEW_REQUIRED"};val output=JSONObject(defaults.toString())
        for(key in input.keys()){val value=input.get(key);val default=defaults.get(key)
            when(default){is Boolean->check(value is Boolean);is Number->check(value is Number&&value.toDouble().isFinite()&&value.toDouble()%1.0==0.0);is String->check(value is String);is JSONArray->strings(value as? JSONArray?:error("E2EE_PRIVATE_PREFERENCES_INVALID"));JSONObject.NULL->check(value==JSONObject.NULL||value is JSONArray&&strings(value).size<=10000)}
            output.put(key,value)
        }
        fun number(key:String,min:Int,max:Int){check(output.getInt(key) in min..max){"E2EE_PRIVATE_PREFERENCES_INVALID"}}
        number("sidebarWidth",56,240);for(key in listOf("personalInboxWidth","sharedInboxWidth"))number(key,300,5000)
        for(key in listOf("notificationDockX","notificationDockY"))number(key,-1,10000)
        check(output.getInt("sidebarAutoCollapseSeconds") in setOf(0,15,30,60,120,300)){"E2EE_PRIVATE_PREFERENCES_INVALID"}
        for(key in listOf("personalInboxPosition","sharedInboxPosition"))check(output.getString(key) in setOf("top","right","left","bottom")){"E2EE_PRIVATE_PREFERENCES_INVALID"}
        for(key in listOf("personalCategoriesView","sharedCategoriesView"))check(output.getString(key) in setOf("cards","list")){"E2EE_PRIVATE_PREFERENCES_INVALID"}
        for(key in listOf("enabledCalendars","displayCalendarOrder")){val values=strings(output.getJSONArray(key));check(values.isNotEmpty()&&values.all{it in setOf("profane","sacred","lunar")}){"E2EE_PRIVATE_PREFERENCES_INVALID"}}
        return output
    }
    private fun routing(value:JSONObject):JSONObject{E2eeKeys.exact(value,setOf("mode","defaultAccountIds","categoryAccountIds"));check(value.getString("mode") in setOf("fixed","choose","category")){"E2EE_PRIVATE_PREFERENCES_INVALID"}
        strings(value.getJSONArray("defaultAccountIds"));val categories=value.getJSONObject("categoryAccountIds");check(categories.length()<=10000){"E2EE_PRIVATE_PREFERENCES_INVALID"}
        for(key in categories.keys()){check(key.isNotEmpty()&&key.length<=256&&key !in setOf("__proto__","prototype","constructor")){"E2EE_PRIVATE_PREFERENCES_INVALID"};strings(categories.getJSONArray(key))};return value}
    private fun validate(value:JSONObject):JSONObject{E2eeKeys.exact(value,setOf("protocol","ownerId","advicePreferences","uiVisibility","syncRouting"));check(value.get("protocol")==1&&value.get("ownerId")==account.ownerId){"E2EE_SCOPE_BINDING_MISMATCH"}
        val advice=value.getJSONObject("advicePreferences");val normalized=AdvicePreferences.fromJson(advice).toJson();check(preserved(advice,normalized)){"E2EE_ADVICE_PREFERENCES_REVIEW_REQUIRED"}
        return JSONObject(value.toString()).put("advicePreferences",normalized).put("uiVisibility",visibility(value.getJSONObject("uiVisibility"))).put("syncRouting",routing(value.getJSONObject("syncRouting")))}
    private val document=E2eeFeatureDocument(account,"workspace","personal-preferences-live-v1",::validate,{
        val source=readOriginal("personal-private-preferences-v1");E2eeKeys.exact(source,setOf("protocol","ownerId","original"));check(source.get("protocol")==1&&source.get("ownerId")==account.ownerId){"E2EE_SCOPE_BINDING_MISMATCH"}
        val raw=source.getJSONObject("original");E2eeKeys.exact(raw,setOf("categoryMapJson","visibilityJson","routingMode","routingTargetsJson"))
        fun parsed(name:String,fallback:Any):Any=if(raw.isNull(name))fallback else E2eeFileManifestJson.readPrivateValue(raw.getString(name).toByteArray(Charsets.UTF_8))
        var categories=parsed("categoryMapJson",JSONObject());if(categories is JSONArray&&categories.length()==0)categories=JSONObject()
        val targets=parsed("routingTargetsJson",JSONArray()) as? JSONArray?:error("E2EE_PRIVATE_PREFERENCES_INVALID");if(targets.length()==0)targets.put(account.ownerId)
        val advice=readOriginal("personal-advice-preferences-v1");check(advice.get("protocol")==1&&advice.get("ownerId")==account.ownerId){"E2EE_SCOPE_BINDING_MISMATCH"}
        JSONObject().put("protocol",1).put("ownerId",account.ownerId).put("advicePreferences",advice.getJSONObject("preferences"))
            .put("uiVisibility",parsed("visibilityJson",JSONObject())).put("syncRouting",JSONObject().put("mode",if(raw.isNull("routingMode"))"fixed"else raw.getString("routingMode")).put("defaultAccountIds",targets).put("categoryAccountIds",categories))
    },account::requireOpen)
    @Synchronized fun load():JSONObject{val view=document.read();check(view.isNull("conflict")){"E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED"};val value=validate(view.getJSONObject("document"));current=value;return JSONObject(value.toString())}
    @Synchronized fun snapshot():JSONObject{account.requireOpen();return JSONObject(checkNotNull(current){"E2EE_PRODUCT_READ_REQUIRED"}.toString())}
    @Synchronized fun update(patch:JSONObject):JSONObject{
        check(patch.keys().asSequence().all{it in setOf("advicePreferences","uiVisibility","uiLayout","syncRouting")}){"E2EE_PRIVATE_PREFERENCES_INVALID"};val prior=load()
        for(key in listOf("advicePreferences","uiVisibility"))patch.optJSONObject(key)?.let{change->val value=prior.getJSONObject(key);for(name in change.keys())value.put(name,change.get(name))}
        patch.optJSONObject("uiLayout")?.let{change->val value=prior.getJSONObject("uiVisibility");for(name in change.keys())value.put(name,change.get(name))}
        patch.optJSONObject("syncRouting")?.let{prior.put("syncRouting",it)};document.write(validate(prior));val saved=document.flush();check(saved.isNull("conflict")){"E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED"}
        current=validate(saved.getJSONObject("document"));return snapshot()
    }
    @Synchronized fun flush(refresh: Boolean = false) {
        val saved = document.flush()
        check(saved.isNull("conflict")) { "E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED" }
        current = validate(saved.getJSONObject("document"))
        if (refresh) load()
    }
    fun apply(profile:JSONObject):JSONObject{check(profile.getString("uid")==account.ownerId){"E2EE_SCOPE_BINDING_MISMATCH"};val value=snapshot();return JSONObject(profile.toString())
        .put("advicePreferences",value.get("advicePreferences")).put("uiVisibility",value.get("uiVisibility")).put("syncRouting",value.get("syncRouting"))}
    fun project(settings:AccountSettings):AccountSettings{val value=snapshot();val route=value.getJSONObject("syncRouting");val valid=settings.accounts.map{it.id}.toSet()
        val targets=strings(route.getJSONArray("defaultAccountIds")).filter{it in valid}.ifEmpty{listOf(settings.accounts.firstOrNull{it.isPrimary}?.id?:settings.accounts.first().id)}
        val categories=route.getJSONObject("categoryAccountIds");val mapping=categories.keys().asSequence().associateWith{strings(categories.getJSONArray(it)).filter{it in valid}}
        return settings.copy(routing=SyncRouting(route.getString("mode"),targets,mapping),uiVisibility=UiVisibility.fromJson(value.getJSONObject("uiVisibility")),advicePreferences=AdvicePreferences.fromJson(value.getJSONObject("advicePreferences")))}
    override fun toString()="E2eePrivatePreferences([redacted])"
}
