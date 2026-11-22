package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import ru.genesis.calendar.data.GenesisBackupContainer
import ru.genesis.calendar.auth.E2eeRemoteOriginal

/** Same inert content archive as web. No key store, directory, grant, service
 * outbox or executable restore/retry capability is exposed by this codec. */
internal class E2eeContentArchive(private val account:E2eeProductAccount){
    companion object{
        private const val MAX=GenesisBackupContainer.MAX_PLAIN
        private val modules=listOf("workspace","mindmaps","diary","stoicheion","aurora","physis","shared-drafts")
        private val domains=setOf("workspace","mindmap","diary","dream-journal","physis","aurora","stoicheion","advice","attachment","shared-project","shared-comment","local-snapshot")
        private fun deviceContent(id:String)=id in setOf("personal-diary-device-live-v1","personal-physis-editor-forms-v1")||listOf("shared-bulk-private:","shared-bulk-recovery:","shared-bulk-recovery-history:","shared-request:","shared-work-private:","shared-work-history:","product-tx:","product-approval:","mindmap-view:","mindmap-conversions:","shared-map-draft:","shared-map-local:","shared-map-conversion-journal:","shared-resource-create:","shared-project-create:","shared-project-resolution:","membership-operation:","personal-content-restore:","external-google-copy:","imported-legacy-content:").any(id::startsWith)
        private fun hash(bytes:ByteArray)=E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))
        private fun rows(value:JSONArray)=(0 until value.length()).map{value.getJSONObject(it)}
        private fun snapshot(id:String,bytes:ByteArray,filename:String="",mediaType:String="application/json")=JSONObject().put("id",id).put("encoding","base64url").put("bytes",E2eeEnvelope.encode(bytes)).put("sha256",hash(bytes)).put("size",bytes.size).put("filename",filename).put("mediaType",mediaType)
        private fun group(entry:JSONObject):String{
            if(entry.optJSONObject("scope")?.getString("kind")?.let{it!="personal"}==true||entry.getString("domain") in setOf("shared-project","shared-comment"))return "shared-drafts"
            return when(entry.getString("domain")){"mindmap"->"mindmaps";"diary"->"diary";"physis"->"physis";"aurora"->"aurora";"stoicheion"->"stoicheion";else->"workspace"}
        }
        fun validate(input:JSONObject):JSONObject{
            val value=JSONObject(input.toString());E2eeKeys.exact(value,setOf("schema","backupId","source","ownerId","createdAt","client","sections","billingEvidence"))
            check(E2eeCommands.integer(value.get("schema"))==1L&&value.getString("source") in setOf("device_snapshot","server_snapshot")&&value.getString("client") in setOf("web","android")&&value.isNull("billingEvidence")){"BACKUP_INVALID"}
            UUID.fromString(value.getString("backupId"));E2eeKeys.technical(value.getString("ownerId"));Instant.parse(value.getString("createdAt"));check(value.toString().toByteArray(Charsets.UTF_8).size<=MAX){"BACKUP_TOO_LARGE"}
            val sections=value.getJSONArray("sections");check(sections.length()<=7){"BACKUP_INVALID"};val seen=mutableSetOf<String>();val identities=mutableSetOf<String>();var total=0L
            for(section in rows(sections)){
                val module=section.getString("id");check(module in modules&&seen.add(module)){"BACKUP_INVALID"};val data=section.getJSONObject("data");E2eeKeys.exact(data,setOf("format","execution","entries"));check(data.getString("format")=="genesis-content-only-v1"&&data.getString("execution")=="history-only"){"BACKUP_INVALID"};val entries=data.getJSONArray("entries");check(entries.length()<=10000){"BACKUP_INVALID"}
                for(entry in rows(entries)){
                    E2eeKeys.exact(entry,setOf("placement","scope","domain","objectId","pending","current","history"));E2eeKeys.technical(entry.getString("objectId"));check(entry.get("pending") is Boolean){"BACKUP_INVALID"}
                    if(entry.getString("placement") in setOf("editor","remote")){
                        val scope=entry.getJSONObject("scope");E2eeKeys.exact(scope,setOf("scopeId","ownerId","kind","resourceId"));for(name in listOf("scopeId","ownerId","resourceId"))E2eeKeys.technical(scope.getString(name))
                        check(scope.getString("kind") in setOf("personal","project","space")&&entry.getString("domain") in domains){"BACKUP_INVALID"}
                    }else check(entry.getString("placement")=="device"&&entry.isNull("scope")&&entry.getString("domain")=="draft"&&deviceContent(entry.getString("objectId"))){"BACKUP_INVALID"}
                    val coordinates=entry.optJSONObject("scope");val identity=listOf(entry.getString("placement"),coordinates?.optString("scopeId"),entry.getString("domain"),entry.getString("objectId")).joinToString("\u0000");check(identities.add(identity)){"BACKUP_INVALID"}
                    val history=entry.getJSONArray("history");check(history.length()<=10000){"BACKUP_INVALID"};val ids=mutableSetOf<String>()
                    for(record in listOf(entry.getJSONObject("current"))+rows(history)){
                        E2eeKeys.exact(record,setOf("id","encoding","bytes","sha256","size","filename","mediaType"));check(ids.add(E2eeKeys.technical(record.getString("id")))&&record.getString("encoding")=="base64url"&&record.getString("filename").length<=512&&record.getString("mediaType").length<=128){"BACKUP_INVALID"}
                        val size=E2eeCommands.integer(record.get("size"));check(size in 0..MAX.toLong()){"BACKUP_TOO_LARGE"};val bytes=if(size==0L&&record.getString("bytes")=="")ByteArray(0)else E2eeEnvelope.decode(record.getString("bytes"),size.toInt())
                        try{total+=bytes.size;check(total<=MAX&&hash(bytes)==record.getString("sha256")){"BACKUP_INVALID"}}finally{bytes.fill(0)}
                    }
                }
            };return value
        }
        fun contentOnlyInput(original:JSONObject):JSONObject{
            val input=JSONObject(original.toString());val sections=JSONArray()
            for(section in rows(input.getJSONArray("sections"))){
                val data=section.optJSONObject("data")
                if(data?.optString("format")=="genesis-content-only-v1"){sections.put(section);continue}
                val entries=JSONArray();if(section.getString("completeness")!="unavailable"&&!section.isNull("data")){
                    val originalData=section.get("data");val bytes=(if(originalData is String)JSONObject.quote(originalData)else originalData.toString()).toByteArray(Charsets.UTF_8)
                    try{entries.put(JSONObject().put("placement","device").put("scope",JSONObject.NULL).put("domain","draft").put("objectId","imported-legacy-content:${input.getString("backupId")}:${section.getString("id")}").put("pending",false).put("current",snapshot("current",bytes)).put("history",JSONArray()))}finally{bytes.fill(0)}
                };section.put("data",JSONObject().put("format","genesis-content-only-v1").put("execution","history-only").put("entries",entries));sections.put(section)
            };input.put("sections",sections);input.remove("serverEvidence");return validate(input)
        }
    }
    private fun current(){account.requireOpen()}
    private fun document(id:String)=E2eeDeviceDocument(account.device,id,::validate,::current)
    fun capture():JSONObject{
        current();val scopes=account.contentScopes();val entries=mutableListOf<JSONObject>();var usage=0L
        fun append(entry:JSONObject){usage+=entry.toString().toByteArray(Charsets.UTF_8).size;check(usage<=MAX-65536&&entries.size<10000){"BACKUP_TOO_LARGE"};entries+=entry}
        for(key in account.device.vault.listLocal("draft","editor:")){
            val record=account.device.vault.read("draft",key)?:error("E2EE_BACKUP_CAPTURE_CHANGED")
            try{current();check(record.bytes.size<=4*1024*1024){"E2EE_CORRUPT_EDITOR"};val state=E2eeFileManifestJson.readPrivateDocument(record.bytes);val domain=state.getString("domain");if(domain !in domains)continue
                val scopeId=state.getString("scopeId");val id=state.getString("objectId");val scope=scopes.singleOrNull{it.directory.scopeId==scopeId}?:error("E2EE_BACKUP_SCOPE_UNLOCK_REQUIRED")
                check(key=="editor:"+hash("$scopeId\u0000$domain\u0000$id".toByteArray(Charsets.UTF_8))){"E2EE_CORRUPT_EDITOR"}
                val queue=E2eeEditorQueue(account.device,scope.client,scopeId,domain,id);val head=queue.load()?:error("E2EE_BACKUP_CAPTURE_CHANGED");check(head.serial==record.serial){"E2EE_BACKUP_CAPTURE_CHANGED"}
                val latest=try{snapshot("current",head.bytes,head.filename,head.mediaType)}finally{head.bytes.fill(0)};val history=JSONArray();var retained=latest.toString().toByteArray(Charsets.UTF_8).size.toLong();val pages=mutableSetOf<String>();val ids=mutableSetOf<String>();var cursor:JSONObject?=null;var pageNumber=0
                while(true){check(pageNumber++<10000){"E2EE_EDITOR_HISTORY_CORRUPT"};val page=queue.historyPage(cursor);current()
                    for(draft in rows(page.getJSONArray("drafts"))){val draftId=draft.getString("id");check(ids.add(draftId)){"E2EE_EDITOR_HISTORY_CORRUPT"};check(usage+retained+draft.getLong("size")*4/3<=MAX-65536){"BACKUP_TOO_LARGE"}
                        val opened=queue.openHistory(draftId,cursor);try{val item=snapshot(draftId,opened.bytes,opened.filename,opened.mediaType);retained+=item.toString().toByteArray(Charsets.UTF_8).size;check(usage+retained<=MAX-65536){"BACKUP_TOO_LARGE"};history.put(item)}finally{opened.bytes.fill(0)}}
                    cursor=page.optJSONObject("cursor");if(cursor==null)break;check(pages.add(cursor.getString("id"))){"E2EE_EDITOR_HISTORY_CORRUPT"}
                }
                val final=account.device.vault.read("draft",key)?:error("E2EE_BACKUP_CAPTURE_CHANGED");try{check(final.serial==record.serial&&final.bytes.contentEquals(record.bytes)){"E2EE_BACKUP_CAPTURE_CHANGED"}}finally{final.bytes.fill(0)}
                val binding=JSONObject().put("scopeId",scopeId).put("ownerId",scope.directory.ownerId).put("kind",scope.directory.kind).put("resourceId",scope.directory.resourceId)
                append(JSONObject().put("placement","editor").put("scope",binding).put("domain",domain).put("objectId",id).put("pending",head.pending).put("current",latest).put("history",history))
            }finally{record.bytes.fill(0)}
        }
        for(key in account.device.vault.listLocal("draft").filter(::deviceContent)){
            val store=E2eeDeviceDocument(account.device,key,{it},::current);val before=store.load()?:error("E2EE_BACKUP_CAPTURE_CHANGED");val bytes=before.value.toString().toByteArray(Charsets.UTF_8)
            try{val latest=snapshot("current",bytes);val after=store.load();check(after?.serial==before.serial){"E2EE_BACKUP_CAPTURE_CHANGED"};append(JSONObject().put("placement","device").put("scope",JSONObject.NULL).put("domain","draft").put("objectId",key).put("pending",true).put("current",latest).put("history",JSONArray()))}finally{bytes.fill(0)}
        }
        // Include old user values that are no longer in a mounted editor.
        // Control packets, source-opening material and incomplete encrypted
        // suffixes stay in protected custody; these entries are inert history.
        E2eeMigrationOwnershipCatalogue.open(E2eeMigrationOwnershipCatalogue.Options(account.device,account.inventory,
            E2eeRemoteOriginal.Capacity(128L*1024*1024,10000,1000,10000,128*1024*1024),::current,
            {current();E2eeStorageAdmission.admit(E2eeStorageAdmission.measure(account.device,::current),E2eeStorageAdmission.Growth(0,0,0,0),E2eeStorageAdmission.providerBudget)})).use{retained->
            for(item in retained.contents()){
                current();val size=E2eeCommands.integer(item.get("size")).toInt();check(usage.toLong()+size.toLong()*4/3+8192<=MAX-65536){"BACKUP_TOO_LARGE"};val bytes=ByteArray(size);var offset=0
                try{val metadata=retained.readContent(item.getString("id")){chunk->current();check(chunk.size<=bytes.size-offset){"BACKUP_INVALID"};chunk.copyInto(bytes,offset);offset+=chunk.size};current();check(offset==bytes.size&&hash(bytes)==item.get("sha256")){"BACKUP_INVALID"}
                    val content=snapshot(item.getString("id"),bytes,metadata.getString("filename"),metadata.getString("mediaType"))
                    append(JSONObject().put("placement","remote").put("scope",item.getJSONObject("scope")).put("domain",item.get("domain")).put("objectId",item.get("id")).put("pending",true).put("current",content).put("history",JSONArray()))
                }finally{bytes.fill(0)}
            };retained.assertUnchanged();current()
        }
        val at=Instant.now().toString();val sections=JSONArray();for(module in modules){val selected=entries.filter{group(it)==module};if(selected.isEmpty())continue
            sections.put(JSONObject().put("id",module).put("source","device").put("completeness","partial").put("capturedAt",at).put("revision",JSONObject.NULL).put("count",selected.size).put("pending",selected.count{it.getBoolean("pending")}).put("notices",JSONArray(listOf("CONTENT_ONLY_HISTORY_NOT_EXECUTABLE","LOCAL_OPENED_CONTENT_ONLY"))).put("data",JSONObject().put("format","genesis-content-only-v1").put("execution","history-only").put("entries",JSONArray(selected))))}
        val payload=validate(JSONObject().put("schema",1).put("backupId",UUID.randomUUID().toString()).put("source","device_snapshot").put("ownerId",account.ownerId).put("createdAt",at).put("client","android").put("sections",sections).put("billingEvidence",JSONObject.NULL))
        val safety=document("content-archive-safety:${payload.getString("backupId")}");safety.save(payload,null);current();check(E2eeProductJson.same(safety.load()?.value,payload)){"E2EE_BACKUP_UNVERIFIED"};return payload
    }
    fun retain(input:JSONObject):JSONObject{
        current();val payload=validate(input);current();val store=document("content-archive-import:${payload.getString("backupId")}");val old=store.load()
        if(old!=null){check(E2eeProductJson.same(old.value,payload)){"E2EE_IDEMPOTENCY_CONFLICT"};return payload}
        store.save(payload,null);current();check(E2eeProductJson.same(store.load()?.value,payload)){"E2EE_BACKUP_UNVERIFIED"};return payload
    }
    fun retained():List<String>{current();return account.device.vault.listLocal("draft","content-archive-import:").map{it.removePrefix("content-archive-import:")}.also{current()}}
    fun openRetained(id:String):JSONObject{current();E2eeKeys.technical(id);val row=document("content-archive-import:$id").load()?:error("BACKUP_INVALID");current();check(row.value.getString("backupId")==id){"BACKUP_INVALID"};return validate(row.value).also{current()}}
    fun captureRemote():JSONObject{
        current();check(!account.offline){"E2EE_ONLINE_REQUIRED"};val summaries=rows(account.scopeSummaries());val scopes=account.contentScopes();current()
        check(summaries.none{row->row.getString("state")=="active"&&scopes.none{it.directory.scopeId==row.getString("scopeId")}}
            &&scopes.none{scope->summaries.none{it.getString("scopeId")==scope.directory.scopeId&&it.getString("kind")==scope.directory.kind&&it.getString("resourceId")==scope.directory.resourceId}}){"E2EE_BACKUP_SCOPE_UNLOCK_REQUIRED"}
        val payload=capture();val sections=payload.getJSONArray("sections");var usage=payload.toString().toByteArray(Charsets.UTF_8).size.toLong();val manifests=mutableMapOf<String,String>()
        for(scope in scopes){scope.client.refresh();current();val catalogue=scope.client.contentHeads();current();manifests[scope.directory.scopeId]=catalogue.getString("manifestHash")
            val coordinates=JSONObject().put("scopeId",scope.directory.scopeId).put("ownerId",scope.directory.ownerId).put("kind",scope.directory.kind).put("resourceId",scope.directory.resourceId)
            for(head in rows(catalogue.getJSONArray("objects"))){val domain=head.getString("domain");val id=head.getString("objectId")
                if(domain=="attachment"&&id.matches(Regex("^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}:\\d{6}$")))continue
                check(domain in domains){"E2EE_BACKUP_CONTENT_CLASSIFICATION_REQUIRED"};val opened=scope.client.read(domain,id)?:error("E2EE_BACKUP_CAPTURE_CHANGED");current()
                val latest=try{check(opened.revision==head.getLong("revision")){"E2EE_BACKUP_CAPTURE_CHANGED"};snapshot("current",opened.bytes,opened.filename,opened.mediaType)}finally{opened.bytes.fill(0)}
                scope.client.assertObjectReference(domain,id,head.getLong("revision"),head.getString("payloadHash"));current()
                val entry=JSONObject().put("placement","remote").put("scope",JSONObject(coordinates.toString())).put("domain",domain).put("objectId",id).put("pending",false).put("current",latest).put("history",JSONArray())
                usage+=entry.toString().toByteArray(Charsets.UTF_8).size;check(usage<=MAX-65536){"BACKUP_TOO_LARGE"};val module=group(entry)
                var section=rows(sections).firstOrNull{it.getString("id")==module}
                if(section==null){section=JSONObject().put("id",module).put("source","server").put("completeness","available").put("capturedAt",payload.get("createdAt")).put("revision",JSONObject.NULL).put("count",0).put("pending",0).put("notices",JSONArray())
                    .put("data",JSONObject().put("format","genesis-content-only-v1").put("execution","history-only").put("entries",JSONArray()));sections.put(section)}
                section.getJSONObject("data").getJSONArray("entries").put(entry);section.put("count",section.getInt("count")+1)
            }
        }
        for(scope in scopes){val after=scope.client.contentHeads();current();check(after.getString("manifestHash")==manifests[scope.directory.scopeId]){"E2EE_BACKUP_CAPTURE_CHANGED"}}
        payload.put("backupId",UUID.randomUUID().toString()).put("source","server_snapshot")
        for(section in rows(sections))section.put("completeness","available").put("notices",JSONArray(listOf("CONTENT_ONLY_HISTORY_NOT_EXECUTABLE","REMOTE_CURRENT_AND_THIS_DEVICE_HISTORY")))
        val verified=validate(payload);val store=document("content-archive-safety:${verified.getString("backupId")}");store.save(verified,null);current();check(E2eeProductJson.same(store.load()?.value,verified)){"E2EE_BACKUP_UNVERIFIED"};return verified
    }
    override fun toString()="E2eeContentArchive([redacted])"
}
