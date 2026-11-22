package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.io.FilterInputStream
import java.io.InputStream
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.util.UUID
import javax.crypto.SecretKey
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/** Local encrypted quarantine only. A complete plan does not grant transport,
 * restore, enrollment or replay authority; the coordinator owns source/lease/CAS. */
internal object E2eeContentPlan {
    private const val MAX_METADATA=4*1024*1024
    data class Capacity(val maximumBytes:Long,val maximumEnvelopes:Int,val maximumLocalParts:Int)
    data class Admission(val bytes:Long,val envelopes:Int,val localParts:Int,val metadataBytes:Int,val additionalStorageBytes:Long)
    data class Reference(val attemptId:String,val manifestHash:String)
    class Inspection(val phase:String,val reference:Reference?,val records:Int,val bytes:Long,val metadataBytes:Int,val metadataIds:List<String>) {
        override fun toString()="E2eeContentPlan.Inspection([redacted])"
    }
    class ReadbackReceipt(val reference:Reference,val envelopes:Int,val remoteRecords:Int,val localRecords:Int) {
        override fun toString()="E2eeContentPlan.ReadbackReceipt([redacted])"
    }
    class ReadOptions(val vault:E2eeSourceReadVault,val root:SecretKey,val signer:PublicKey,val context:E2eeEnvelope.Context,
        val target:E2eeSourceStage.Target,val migrationId:String,val sourceHash:String,val paths:List<String>,val inventory:E2eePrivatePaths,val assertCurrent:()->Unit) {
        override fun toString()="E2eeContentPlan.ReadOptions([redacted])"
    }
    class Options(val read:ReadOptions,val signingKey:PrivateKey,val capacity:Capacity,val admit:(Admission)->Unit,
        val ensureDurableKeys:()->Unit,val assertSourceComplete:()->Unit) {
        override fun toString()="E2eeContentPlan.Options([redacted])"
    }
    class Record(val placement:String,val domain:String,val objectId:String,val size:Int,val source:InputStream,
        val filename:String="",val mediaType:String="application/json") {
        override fun toString()="E2eeContentPlan.Record([redacted])"
    }
    class Opened internal constructor(internal val manifest:JSONObject) {
        val attemptId:String get()=manifest.getString("attemptId")
        override fun toString()="E2eeContentPlan.Opened([redacted])"
    }
    internal class Binding(input:ReadOptions) {
        val vault=input.vault;val root=input.root;val signer=input.signer;val context=input.context;val target=input.target.copy()
        val migrationId=input.migrationId;val sourceHash=input.sourceHash;val paths=input.paths.toList();val guard=input.assertCurrent
        val allowed=input.inventory.required(target.kind).associate{it.id to it.domains.toSet()}
        fun current(){guard();vault.assertOpen()}
        init{
            current();E2eeKeys.technical(migrationId);E2eeEnvelope.decode(sourceHash,32);val base=context.toJson()
            check(base.get("ownerId")==target.ownerId&&base.get("scopeId")==target.scopeId&&base.get("deviceId")==vault.localIdentity().deviceId&&E2eeCommands.integer(base.get("schemaVersion"),1)==1L
                &&E2eeCommands.integer(base.get("revision"),1)==1L){"E2EE_CORRUPT_CONTENT_PLAN"}
            check(paths==allowed.keys.toList()){"E2EE_SOURCE_ADAPTER_REQUIRED"}
        }
    }
    private fun invalid():Nothing=throw IllegalStateException("E2EE_CORRUPT_CONTENT_PLAN")
    private fun hash(bytes:ByteArray)=E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))
    private fun id(attempt:String,suffix:String)="content-plan:$attempt:$suffix"
    private fun copy(value:JSONObject)=JSONObject(value.toString())
    private fun text(value:JSONObject,name:String)=value.get(name) as? String?:invalid()
    private fun integer(value:JSONObject,name:String,minimum:Long=0)=E2eeCommands.integer(value.get(name),minimum)
    private fun fields(value:JSONObject,expected:JSONObject):Boolean {
        E2eeKeys.exact(value,expected.keys().asSequence().toSet())
        return expected.keys().asSequence().all{key->val left=value.get(key);val right=expected.get(key)
            if(left is Number&&right is Number)E2eeCommands.integer(left)==E2eeCommands.integer(right)else left==right}
    }
    private fun actor(binding:Binding)=binding.vault.localIdentity().let{JSONObject().put("ownerId",it.ownerId).put("scopeId",it.scopeId).put("deviceId",it.deviceId)}
    private fun target(binding:Binding)=JSONObject().put("ownerId",binding.target.ownerId).put("scopeId",binding.target.scopeId).put("kind",binding.target.kind)
    private fun encoded(value:JSONObject):ByteArray {
        // Preserve every private filename/mediaType UTF16 unit before UTF8.
        val safe=buildString{for(char in value.toString())if(char.isSurrogate()){
            append("\\u");val hex="0123456789abcdef";append(hex[char.code ushr 12]).append(hex[char.code ushr 8 and 15]).append(hex[char.code ushr 4 and 15]).append(hex[char.code and 15])
        }else append(char)}
        val bytes=safe.toByteArray(Charsets.UTF_8);if(bytes.size>MAX_METADATA){bytes.fill(0);error("E2EE_CONTENT_PLAN_METADATA_LIMIT")};return bytes
    }
    private fun write(objectId:String,value:JSONObject,expected:Long?)=UnlockedE2eeVault.Write("local-snapshot",objectId,encoded(value),expected)
    private fun commit(vault:UnlockedE2eeVault,writes:List<UnlockedE2eeVault.Write>,assertCurrent:()->Unit){try{assertCurrent();vault.write(writes,assertCurrent);assertCurrent()}finally{writes.forEach{it.bytes.fill(0)}}}
    private fun metadata(binding:Binding,objectId:String):Pair<Long,Pair<ByteArray,JSONObject>> {
        binding.current();val row=binding.vault.read("local-snapshot",objectId)?:invalid()
        try{binding.current();if(row.bytes.size>MAX_METADATA)invalid();val value=try{E2eeFileManifestJson.readContentPlan(row.bytes)}catch(_:Exception){invalid()};return row.serial to(row.bytes.copyOf() to value)}
        finally{row.bytes.fill(0)}
    }
    private fun sealed(binding:Binding,item:JSONObject):E2eeEnvelope.Envelope {
        binding.current();val row=binding.vault.read("outbox",text(item,"recordId"))?:invalid()
        try{
            binding.current();if(row.serial!=1L)invalid();val value=E2eeEnvelope.Envelope.fromJson(JSONObject(row.bytes.toString(Charsets.UTF_8)));val ctx=value.context.toJson()
            if(ctx.get("domain")!=item.get("domain")||ctx.get("objectId")!=item.get("objectId")||E2eeEnvelope.payloadHash(value)!=item.get("hash"))invalid()
            val expected=binding.context.toJson().put("domain",item.get("domain")).put("objectId",item.get("objectId")).put("operationId",ctx.get("operationId"))
            if(!fields(ctx,expected))invalid();binding.current();return value
        }finally{row.bytes.fill(0)}
    }
    private fun validate(binding:Binding,value:JSONObject,attempt:String,allowEmpty:Boolean=false):JSONObject {
        E2eeKeys.exact(value,setOf("protocol","attemptId","migrationId","sourceHash","target","actor","context","paths","coverage","plan","logical","local"))
        if(integer(value,"protocol",1)!=1L||text(value,"attemptId")!=attempt||runCatching{UUID.fromString(attempt).toString()==attempt}.getOrDefault(false)!=true
            ||text(value,"migrationId")!=binding.migrationId||text(value,"sourceHash")!=binding.sourceHash||!fields(value.getJSONObject("target"),target(binding))
            ||!fields(value.getJSONObject("actor"),actor(binding))||!fields(value.getJSONObject("context"),binding.context.toJson()))invalid()
        val paths=value.getJSONArray("paths");if((0 until paths.length()).map{paths.get(it)}!=binding.paths)invalid()
        val coverage=value.getJSONArray("coverage");if(coverage.length()!=binding.paths.size)invalid()
        for(index in binding.paths.indices){val row=coverage.getJSONObject(index);E2eeKeys.exact(row,setOf("domain","complete"));if(row.get("domain")!=binding.paths[index]||row.get("complete")!=true)invalid()}
        val plan=value.getJSONArray("plan");val logical=value.getJSONArray("logical");val local=value.getJSONArray("local")
        if(plan.length()>8000||logical.length()+local.length() !in (if(allowEmpty)0 else 1)..10000)invalid()
        val envelopes=mutableSetOf<String>();val identities=mutableSetOf<String>();val byRecord=mutableMapOf<String,JSONObject>()
        for(index in 0 until plan.length()){
            val row=plan.getJSONObject(index);E2eeKeys.exact(row,setOf("recordId","domain","objectId","hash"));val domain=text(row,"domain");val objectId=E2eeKeys.technical(text(row,"objectId"));E2eeEnvelope.decode(text(row,"hash"),32)
            val recordId=text(row,"recordId");if(recordId!="$attempt:upload:$index"||!E2eeEnvelope.supportsDomain(domain)||!envelopes.add("$domain\u0000$objectId"))invalid();byRecord[recordId]=row
        }
        val allowed=binding.allowed.values.flatten().toSet()
        for(index in 0 until logical.length()){
            val row=logical.getJSONObject(index);E2eeKeys.exact(row,setOf("domain","objectId","plaintextHash","size","filename","mediaType","manifestRecordId"))
            val domain=text(row,"domain");val objectId=E2eeKeys.technical(text(row,"objectId"));val size=integer(row,"size");E2eeEnvelope.decode(text(row,"plaintextHash"),32)
            if(domain !in allowed||size>E2eeFiles.MAX_FILE_BYTES||domain=="shared-comment"&&size>65536||text(row,"filename").length>512||text(row,"mediaType").length>128||!identities.add("$domain\u0000$objectId"))invalid()
            val manifest=byRecord[text(row,"manifestRecordId")]?:invalid();if(manifest.get("domain")!=domain||manifest.get("objectId")!=objectId)invalid()
        }
        for(row in E2eeMigrationLocal.validate(local,attempt,allowed))if(!identities.add(row.domain+"\u0000"+row.objectId))invalid()
        return value
    }
    private fun verifyRecords(binding:Binding,value:JSONObject) {
        val plan=value.getJSONArray("plan");val logical=value.getJSONArray("logical");val local=value.getJSONArray("local")
        val byId=(0 until plan.length()).associate{plan.getJSONObject(it).let{row->text(row,"domain")+"\u0000"+text(row,"objectId") to row}}
        val byRecord=(0 until plan.length()).associate{plan.getJSONObject(it).let{row->text(row,"recordId") to row}};val used=mutableSetOf<String>()
        for(index in 0 until logical.length()){
            val row=logical.getJSONObject(index);val descriptor=byRecord[text(row,"manifestRecordId")]?:invalid();val manifest=sealed(binding,descriptor);val digest=MessageDigest.getInstance("SHA-256");var size=0L
            if(text(row,"domain")=="shared-comment"){
                val bytes=E2eeEnvelope.open(binding.root,binding.signer,manifest.context,manifest);try{binding.current();digest.update(bytes);size=bytes.size.toLong()}finally{bytes.fill(0)}
            }else{
                val opened=E2eeFiles.openStream(binding.root,binding.signer,manifest.context,manifest,{objectId->val item=byId["attachment\u0000$objectId"]?:invalid();if(!used.add(text(item,"recordId")))invalid();sealed(binding,item)},binding::current,{bytes->digest.update(bytes);size+=bytes.size})
                if(opened.size!=integer(row,"size")||opened.filename!=text(row,"filename")||opened.mediaType!=text(row,"mediaType"))invalid()
            }
            val bytes=digest.digest();try{if(size!=integer(row,"size")||E2eeEnvelope.encode(bytes)!=text(row,"plaintextHash"))invalid()}finally{bytes.fill(0)}
            if(!used.add(text(descriptor,"recordId")))invalid();binding.current()
        }
        if(used.size!=plan.length())invalid()
        for(index in 0 until local.length()){
            val row=local.getJSONObject(index);val digest=MessageDigest.getInstance("SHA-256");var size=0L
            for(part in 0 until integer(row,"parts").toInt()){
                binding.current();val chunk=binding.vault.read("local-snapshot","${text(row,"recordId")}:$part")?:invalid()
                try{binding.current();if(chunk.serial!=1L||chunk.bytes.size.toLong()!=minOf(E2eeFiles.CHUNK_BYTES.toLong(),integer(row,"size")-size))invalid();digest.update(chunk.bytes);size+=chunk.bytes.size}finally{chunk.bytes.fill(0)}
            }
            val bytes=digest.digest();try{if(size!=integer(row,"size")||E2eeEnvelope.encode(bytes)!=text(row,"plaintextHash"))invalid()}finally{bytes.fill(0)};binding.current()
        }
    }
    private fun inventory(binding:Binding,value:JSONObject,complete:Boolean){
        val attempt=text(value,"attemptId");val plan=value.getJSONArray("plan");val local=value.getJSONArray("local")
        fun exact(domain:String,prefix:String,expected:Set<String>){binding.current();val actual=binding.vault.listLocal(domain,prefix);binding.current();if(actual.size!=expected.size||actual.any{it !in expected})invalid()}
        exact("outbox","$attempt:",(0 until plan.length()).map{plan.getJSONObject(it).getString("recordId")}.toSet())
        val parts=mutableSetOf<String>();for(index in 0 until local.length()){val row=local.getJSONObject(index);for(part in 0 until integer(row,"parts").toInt())parts+="${text(row,"recordId")}:$part"}
        exact("local-snapshot","$attempt:",parts);exact("local-snapshot","content-plan:$attempt:",setOf(id(attempt,"journal"))+if(complete)setOf(id(attempt,"manifest"))else emptySet())
    }
    fun open(input:ReadOptions,reference:Reference):Opened {
        val binding=Binding(input);if(runCatching{UUID.fromString(reference.attemptId).toString()==reference.attemptId}.getOrDefault(false)!=true)invalid();E2eeEnvelope.decode(reference.manifestHash,32)
        val marker=metadata(binding,id(reference.attemptId,"journal"));try{val row=marker.second.second;E2eeKeys.exact(row,setOf("protocol","attemptId","phase","manifestHash"));if(integer(row,"protocol",1)!=1L||row.get("attemptId")!=reference.attemptId||row.get("phase")!="complete"||row.get("manifestHash")!=reference.manifestHash)invalid()}finally{marker.second.first.fill(0)}
        val stored=metadata(binding,id(reference.attemptId,"manifest"));try{
            if(stored.first!=1L||hash(stored.second.first)!=reference.manifestHash)invalid();binding.current();val value=validate(binding,stored.second.second,reference.attemptId)
            inventory(binding,value,true);verifyRecords(binding,value);inventory(binding,value,true);binding.current();return Opened(copy(value))
        }finally{stored.second.first.fill(0)}
    }
    /** User values of a retained attempt, without source-opening/control data.
     * A writing journal contributes only its completed records. Its encrypted
     * pending suffix is retained separately and never becomes invented EOF. */
    fun retainedValues(input:ReadOptions,attempt:String,reference:Reference?):JSONObject {
        val found=inspect(input,attempt,reference);val binding=Binding(input);binding.current()
        val value=if(found.reference!=null)open(input,found.reference).manifest
            else if(found.phase=="missing")return JSONObject().put("plan",JSONArray()).put("logical",JSONArray()).put("local",JSONArray())
            else{val stored=metadata(binding,id(attempt,"journal"));try{val journal=copy(stored.second.second);if(journal.get("phase")!="writing")invalid();journal}finally{stored.second.first.fill(0)}}
        val plan=value.getJSONArray("plan");val logical=value.getJSONArray("logical");val last=if(logical.length()==0)null else logical.getJSONObject(logical.length()-1)
        val end=if(last==null)0 else (0 until plan.length()).firstOrNull{plan.getJSONObject(it).get("recordId")==last.get("manifestRecordId")}?.plus(1)?:invalid()
        val complete=JSONArray();for(at in 0 until end)complete.put(JSONObject(plan.getJSONObject(at).toString()))
        return JSONObject().put("plan",complete).put("logical",JSONArray(logical.toString())).put("local",JSONArray(value.getJSONArray("local").toString()))
    }
    /** Exact reserved-role discovery. Interrupted file suffixes authenticate the
     * envelope/signature and outer vault; absence of a final per-file-key
     * manifest never becomes plaintext completeness or a transport permit. */
    fun inspect(input:ReadOptions,attempt:String,reference:Reference?):Inspection {
        val binding=Binding(input)
        if(runCatching{UUID.fromString(attempt).toString()==attempt}.getOrDefault(false)!=true)invalid()
        reference?.let{if(it.attemptId!=attempt)invalid();E2eeEnvelope.decode(it.manifestHash,32)}
        val names=binding.vault.listLocal("local-snapshot","content-plan:$attempt:");binding.current()
        if(id(attempt,"journal") !in names){
            if(reference!=null||names.isNotEmpty())invalid()
            for(domain in listOf("outbox","local-snapshot")){val outputs=binding.vault.listLocal(domain,"$attempt:");binding.current();if(outputs.isNotEmpty())invalid()}
            return Inspection("missing",null,0,0,0,emptyList())
        }
        val marker=metadata(binding,id(attempt,"journal"));var complete:Reference?=null
        try{
            val value=marker.second.second
            if(value.opt("phase")=="complete"){
                E2eeKeys.exact(value,setOf("protocol","attemptId","phase","manifestHash"))
                if(integer(value,"protocol",1)!=1L||text(value,"attemptId")!=attempt||marker.first<2)invalid()
                complete=Reference(attempt,text(value,"manifestHash"));E2eeEnvelope.decode(complete.manifestHash,32)
                if(reference!=null&&reference!=complete)invalid();open(input,complete);binding.current()
            }else{
                if(reference!=null)invalid()
                E2eeKeys.exact(value,setOf("protocol","attemptId","migrationId","sourceHash","target","actor","context","paths","phase","pending","bytes","localParts","plan","logical","local"))
                if(value.get("phase")!="writing")invalid()
                val manifest=copy(value);for(key in listOf("phase","pending","bytes","localParts"))manifest.remove(key)
                manifest.put("coverage",JSONArray(binding.paths.map{JSONObject().put("domain",it).put("complete",true)}));validate(binding,manifest,attempt,true)
                val plan=value.getJSONArray("plan");val logical=value.getJSONArray("logical");val local=value.getJSONArray("local")
                val pending=if(value.isNull("pending"))null else value.getJSONObject("pending")
                val countedLocal=JSONArray(local.toString());var expectedBytes=0L;var expectedParts=0L
                for(rows in listOf(logical,local))for(index in 0 until rows.length())expectedBytes+=integer(rows.getJSONObject(index),"size")
                for(index in 0 until local.length())expectedParts+=integer(local.getJSONObject(index),"parts")
                if(pending!=null){
                    E2eeKeys.exact(pending,setOf("path","placement","domain","objectId","size","filename","mediaType","recordId","parts"))
                    val domain=text(pending,"domain");val objectId=E2eeKeys.technical(text(pending,"objectId"));val size=integer(pending,"size");val parts=integer(pending,"parts")
                    if(domain !in(binding.allowed[text(pending,"path")]?:emptySet())||text(pending,"placement") !in setOf("remote","local")||size>E2eeFiles.MAX_FILE_BYTES
                        ||domain=="shared-comment"&&size>65536||text(pending,"filename").length>512||text(pending,"mediaType").length>128||parts>8000
                        ||listOf(logical,local).any{rows->(0 until rows.length()).any{rows.getJSONObject(it).let{row->row.get("domain")==domain&&row.get("objectId")==objectId}}})invalid()
                    if(pending.get("placement")=="remote"){if(pending.get("recordId")!=""||parts!=0L)invalid()}
                    else{
                        if(pending.get("recordId")!="$attempt:private:${local.length()}"||parts>(size+E2eeFiles.CHUNK_BYTES-1)/E2eeFiles.CHUNK_BYTES)invalid()
                        countedLocal.put(copy(pending).put("plaintextHash",E2eeEnvelope.encode(ByteArray(32))));expectedParts+=parts
                    };expectedBytes+=size
                }
                if(integer(value,"bytes")!=expectedBytes||integer(value,"localParts")!=expectedParts||expectedParts>8000)invalid()
                inventory(binding,copy(value).put("local",countedLocal),false);binding.current()
                val end=if(logical.length()==0)0 else (0 until plan.length()).single{plan.getJSONObject(it).get("recordId")==logical.getJSONObject(logical.length()-1).get("manifestRecordId")}+1
                if((pending==null||pending.get("placement")!="remote")&&end!=plan.length())invalid()
                verifyRecords(binding,copy(value).put("plan",JSONArray((0 until end).map{plan.getJSONObject(it)})));binding.current()
                for(index in end until plan.length()){val envelope=sealed(binding,plan.getJSONObject(index));E2eeEnvelope.verify(envelope,envelope.context,binding.signer);binding.current()}
                if(pending?.get("placement")=="local")for(part in 0 until integer(pending,"parts").toInt()){
                    val row=binding.vault.read("local-snapshot","${text(pending,"recordId")}:$part")?:invalid()
                    try{binding.current();if(row.serial!=1L||row.bytes.size.toLong()!=minOf(E2eeFiles.CHUNK_BYTES.toLong(),integer(pending,"size")-part.toLong()*E2eeFiles.CHUNK_BYTES))invalid()}finally{row.bytes.fill(0)}
                }
            }
            var records=0;var bytes=0L;var metadataBytes=0
            fun count(domain:String,ids:List<String>,metadata:Boolean=false){for(objectId in ids){
                val row=binding.vault.read(domain,objectId)?:invalid();try{binding.current();records++;bytes+=row.bytes.size;if(metadata)metadataBytes+=row.bytes.size}finally{row.bytes.fill(0)}
            }}
            val outbox=binding.vault.listLocal("outbox","$attempt:");val local=binding.vault.listLocal("local-snapshot","$attempt:");binding.current()
            count("outbox",outbox);count("local-snapshot",local);count("local-snapshot",names,true);binding.current()
            return Inspection(if(complete==null)"writing"else"complete",complete,records,bytes,metadataBytes,names.toList())
        }finally{marker.second.first.fill(0)}
    }
    /** Full expected inventory/signature and original-byte readback, with no
     * aggregate ciphertext or file buffer. The coordinator supplies the pinned
     * generation transport and still owns source/lease/CAS and activation. */
    suspend fun verifyReadback(input:ReadOptions,reference:Reference,port:E2eeBoundedMigrationReadback):ReadbackReceipt {
        val job=currentCoroutineContext()
        val read=ReadOptions(input.vault,input.root,input.signer,input.context,input.target.copy(),input.migrationId,input.sourceHash,input.paths.toList(),input.inventory){job.ensureActive();input.assertCurrent()}
        val binding=Binding(read);val value=open(read,reference).manifest;binding.current()
        val plan=value.getJSONArray("plan");val logical=value.getJSONArray("logical")
        val expected=(0 until plan.length()).associate{plan.getJSONObject(it).let{row->text(row,"domain")+"\u0000"+text(row,"objectId") to row}}
        val byRecord=(0 until plan.length()).associate{plan.getJSONObject(it).let{row->text(row,"recordId") to row}}
        fun mismatch():Nothing=error("E2EE_CONTENT_READBACK_MISMATCH")
        fun checked(item:JSONObject,raw:E2eeEnvelope.Envelope?):E2eeEnvelope.Envelope {
            binding.current();if(raw==null)mismatch();val envelope=E2eeEnvelope.Envelope.fromJson(raw.toJson());val ctx=envelope.context.toJson()
            val context=E2eeEnvelope.Context.fromJson(binding.context.toJson().put("domain",item.get("domain")).put("objectId",item.get("objectId")).put("operationId",ctx.get("operationId")))
            // The payload hash excludes the signature. Both are mandatory.
            val valid=E2eeEnvelope.verify(envelope,context,binding.signer);binding.current();if(E2eeEnvelope.payloadHash(valid)!=item.get("hash"))mismatch();binding.current();return valid
        }
        val gate=Any();val seen=mutableSetOf<String>();var closed=false;var busy=false;var failure:Throwable?=null
        try{
            val count=port.forEachEnvelope{raw->
                var entered=false
                try{
                    synchronized(gate){check(!closed){"E2EE_READBACK_CLOSED"};binding.current();failure?.let{throw it};check(!busy){"E2EE_READBACK_BUSY"};busy=true;entered=true}
                    val envelope=E2eeEnvelope.Envelope.fromJson(raw.toJson());val ctx=envelope.context.toJson();val key=text(ctx,"domain")+"\u0000"+text(ctx,"objectId")
                    val item=synchronized(gate){if(key in seen)mismatch();expected[key]?:mismatch()};checked(item,envelope)
                    synchronized(gate){check(!closed){"E2EE_READBACK_CLOSED"};binding.current();seen.add(key)}
                }catch(error:Throwable){synchronized(gate){if(failure==null)failure=error};throw error}
                finally{if(entered)synchronized(gate){busy=false}}
            }
            synchronized(gate){binding.current();failure?.let{throw it};if(busy||count!=plan.length()||seen.size!=plan.length())mismatch()}
        }finally{synchronized(gate){closed=true}}
        suspend fun load(item:JSONObject):E2eeEnvelope.Envelope {
            binding.current();val raw=port.getEnvelope(text(item,"domain"),text(item,"objectId"));binding.current();return checked(item,raw)
        }
        val used=mutableSetOf<String>()
        for(index in 0 until logical.length()){
            binding.current();val row=logical.getJSONObject(index);val descriptor=byRecord[text(row,"manifestRecordId")]?:mismatch();val manifest=load(descriptor)
            val digest=MessageDigest.getInstance("SHA-256");var size=0L
            if(text(row,"domain")=="shared-comment"){
                val bytes=E2eeEnvelope.open(binding.root,binding.signer,manifest.context,manifest);try{binding.current();digest.update(bytes);size=bytes.size.toLong()}finally{bytes.fill(0)}
            }else{
                val opened=E2eeFiles.openStreamSuspending(binding.root,binding.signer,manifest.context,manifest,{objectId->
                    val item=expected["attachment\u0000$objectId"]?:mismatch();if(!used.add(text(item,"recordId")))mismatch();load(item)
                },binding::current,{bytes->digest.update(bytes);size+=bytes.size})
                if(opened.size!=integer(row,"size")||opened.filename!=text(row,"filename")||opened.mediaType!=text(row,"mediaType"))mismatch()
            }
            val bytes=digest.digest();try{if(size!=integer(row,"size")||E2eeEnvelope.encode(bytes)!=text(row,"plaintextHash"))mismatch()}finally{bytes.fill(0)}
            if(!used.add(text(descriptor,"recordId")))mismatch();binding.current()
        }
        if(used.size!=plan.length())mismatch()
        // Re-authenticate the exact reference after all remote awaits, including
        // every protected local-only part. No success if quarantine disappeared.
        open(read,reference);binding.current();return ReadbackReceipt(reference,plan.length(),logical.length(),value.getJSONArray("local").length())
    }
    fun create(input:Options,attemptId:String=UUID.randomUUID().toString()):Writer {
        val binding=Binding(input.read);val vault=binding.vault as? UnlockedE2eeVault?:error("E2EE_CONTENT_PLAN_WRITE_REQUIRED");val capacity=input.capacity.copy()
        check(capacity.maximumBytes in 1..9007199254740991L&&capacity.maximumEnvelopes in 1..8000&&capacity.maximumLocalParts in 1..8000){"E2EE_CONTENT_PLAN_CAPACITY"}
        check(runCatching{UUID.fromString(attemptId).toString()==attemptId}.getOrDefault(false)){"E2EE_CORRUPT_CONTENT_PLAN"}
        val attempt=attemptId;val journal=JSONObject().put("protocol",1).put("attemptId",attempt).put("migrationId",binding.migrationId).put("sourceHash",binding.sourceHash)
            .put("target",target(binding)).put("actor",actor(binding)).put("context",binding.context.toJson()).put("paths",JSONArray(binding.paths)).put("phase","writing").put("pending",JSONObject.NULL)
            .put("bytes",0).put("localParts",0).put("plan",JSONArray()).put("logical",JSONArray()).put("local",JSONArray())
        val writer=Writer(binding,vault,input.signingKey,capacity,input.admit,input.assertSourceComplete,journal)
        input.ensureDurableKeys();binding.current();writer.initialize();return writer
    }
    class Writer internal constructor(private val binding:Binding,private val vault:UnlockedE2eeVault,private val signingKey:PrivateKey,private val capacity:Capacity,
        private val admit:(Admission)->Unit,private val assertSourceComplete:()->Unit,private var journal:JSONObject) {
        private var serial=1L;private var busy=false;private var broken=false;private var finished=false
        val attemptId:String get()=journal.getString("attemptId")
        private fun current(){binding.current();check(!broken&&!finished){"E2EE_CONTENT_PLAN_CLOSED"}}
        private fun store(next:JSONObject,extra:List<UnlockedE2eeVault.Write> = emptyList(),initial:Boolean=false){
            val writes=extra.toMutableList()
            try{writes+=write(id(attemptId,"journal"),next,if(initial)null else serial)
                val metadataBytes=writes.last().bytes.size;admit(Admission(integer(next,"bytes"),next.getJSONArray("plan").length(),integer(next,"localParts").toInt(),metadataBytes,writes.sumOf{it.bytes.size.toLong()}*2+8192L*writes.size));current()
                commit(vault,writes,::current);journal=next;if(!initial)serial++
            }finally{writes.forEach{it.bytes.fill(0)}}
        }
        internal fun initialize(){store(journal,initial=true)}
        private fun remote(envelope:E2eeEnvelope.Envelope):String {
            current();val next=copy(journal);val plan=next.getJSONArray("plan");check(plan.length()<capacity.maximumEnvelopes){"E2EE_CONTENT_PLAN_CAPACITY"}
            val recordId="$attemptId:upload:${plan.length()}";val ctx=envelope.context.toJson();val hash=E2eeEnvelope.payloadHash(envelope);current()
            plan.put(JSONObject().put("recordId",recordId).put("domain",ctx.get("domain")).put("objectId",ctx.get("objectId")).put("hash",hash))
            store(next,listOf(UnlockedE2eeVault.Write("outbox",recordId,encoded(envelope.toJson()),null)));return recordId
        }
        private fun local(bytes:ByteArray,count:Int){
            current();val next=copy(journal);val pending=next.getJSONObject("pending");check(integer(next,"localParts")<capacity.maximumLocalParts){"E2EE_CONTENT_PLAN_CAPACITY"}
            val part=integer(pending,"parts");pending.put("parts",part+1);next.put("localParts",integer(next,"localParts")+1)
            store(next,listOf(UnlockedE2eeVault.Write("local-snapshot","${text(pending,"recordId")}:$part",bytes.copyOf(count),null)))
        }
        @Synchronized fun append(path:String,record:Record){
            current();check(!busy){"E2EE_CONTENT_PLAN_BUSY"};E2eeKeys.technical(record.objectId)
            check(record.domain in(binding.allowed[path]?:emptySet())&&path in binding.paths&&record.placement in setOf("remote","local")&&record.size in 0..E2eeFiles.MAX_FILE_BYTES
                &&(record.domain!="shared-comment"||record.size<=65536)&&record.filename.length<=512&&record.mediaType.length<=128){"E2EE_INVALID_SOURCE_RESULT"}
            val logical=journal.getJSONArray("logical");val locals=journal.getJSONArray("local")
            check(logical.length()+locals.length()<10000&&(listOf(logical,locals).none{rows->(0 until rows.length()).any{rows.getJSONObject(it).let{row->row.get("domain")==record.domain&&row.get("objectId")==record.objectId}}})){"E2EE_INVALID_SOURCE_RESULT"}
            check(integer(journal,"bytes")+record.size<=capacity.maximumBytes){"E2EE_CONTENT_PLAN_CAPACITY"};busy=true
            val digest=MessageDigest.getInstance("SHA-256");var total=0;var ended=false
            val source=object:FilterInputStream(record.source){
                override fun read():Int {val one=ByteArray(1);return try{if(read(one,0,1)<0)-1 else one[0].toInt() and 255}finally{one.fill(0)}}
                override fun read(output:ByteArray,offset:Int,length:Int):Int {
                    require(offset>=0&&length>=0&&offset<=output.size-length);current();if(length==0)return 0
                    try{val count=`in`.read(output,offset,length);current();if(count<0){check(total==record.size){"E2EE_INVALID_FILE_STREAM"};ended=true;return -1}
                        check(count in 1..length&&total.toLong()+count<=record.size){"E2EE_INVALID_FILE_STREAM"};digest.update(output,offset,count);total+=count;return count
                    }catch(error:Exception){output.fill(0,offset,offset+length);throw error}
                }
                override fun close()=Unit // Caller owns the authenticated original.
            }
            try{
                val next=copy(journal);val pending=JSONObject().put("path",path).put("placement",record.placement).put("domain",record.domain).put("objectId",record.objectId).put("size",record.size)
                    .put("filename",record.filename).put("mediaType",record.mediaType).put("recordId",if(record.placement=="local")"$attemptId:private:${locals.length()}" else "").put("parts",0)
                next.put("pending",pending).put("bytes",integer(next,"bytes")+record.size);store(next);var manifestRecordId=""
                if(record.placement=="remote"){
                    val expected=E2eeEnvelope.Context.fromJson(binding.context.toJson().put("domain",record.domain).put("objectId",record.objectId).put("operationId",UUID.randomUUID().toString()))
                    if(record.domain=="shared-comment"){
                        val bytes=ByteArray(record.size);var at=0;val probe=ByteArray(1);try{while(at<bytes.size){val count=source.read(bytes,at,bytes.size-at);if(count<0)break;at+=count};check(source.read(probe)==-1){"E2EE_INVALID_FILE_STREAM"};current();manifestRecordId=remote(E2eeEnvelope.seal(binding.root,signingKey,expected,bytes))}finally{bytes.fill(0);probe.fill(0)}
                    }else{val manifest=E2eeFiles.sealStream(binding.root,signingKey,expected,source,record.size.toLong(),record.filename,record.mediaType,::current,{remote(it)});manifestRecordId=remote(manifest)}
                }else{
                    val buffer=ByteArray(E2eeFiles.CHUNK_BYTES);var filled=0;try{while(true){val count=source.read(buffer,filled,buffer.size-filled);if(count<0)break;filled+=count;if(filled==buffer.size){local(buffer,filled);buffer.fill(0);filled=0}};if(filled>0)local(buffer,filled)}finally{buffer.fill(0)}
                }
                current();check(ended&&total==record.size){"E2EE_INVALID_FILE_STREAM"};val digestBytes=digest.digest();val plaintextHash=try{E2eeEnvelope.encode(digestBytes)}finally{digestBytes.fill(0)}
                val completed=copy(journal);val retained=completed.getJSONObject("pending");completed.put("pending",JSONObject.NULL)
                val row=JSONObject().put("domain",record.domain).put("objectId",record.objectId).put("size",record.size).put("plaintextHash",plaintextHash).put("filename",record.filename).put("mediaType",record.mediaType)
                val just=JSONObject().put("attemptId",attemptId).put("plan",JSONArray()).put("logical",JSONArray()).put("local",JSONArray())
                if(record.placement=="remote"){
                    row.put("manifestRecordId",manifestRecordId);completed.getJSONArray("logical").put(row);just.getJSONArray("logical").put(row)
                    val plans=completed.getJSONArray("plan");val previous=journal.getJSONArray("logical");var start=0
                    if(previous.length()>0){val previousId=previous.getJSONObject(previous.length()-1).getString("manifestRecordId");start=(0 until plans.length()).single{plans.getJSONObject(it).get("recordId")==previousId}+1}
                    for(index in start until plans.length())just.getJSONArray("plan").put(plans.getJSONObject(index))
                }else{row.put("recordId",retained.get("recordId")).put("parts",retained.get("parts"));completed.getJSONArray("local").put(row);just.getJSONArray("local").put(row)}
                verifyRecords(binding,just);current();store(completed)
            }catch(error:Exception){broken=true;throw error}finally{digest.reset();busy=false}
        }
        @Synchronized fun finish(coverage:List<Pair<String,Boolean>>):Reference {
            current();check(!busy&&journal.isNull("pending")){"E2EE_CONTENT_PLAN_BUSY"};busy=true
            try{
                val manifest=copy(journal);for(key in listOf("phase","pending","bytes","localParts"))manifest.remove(key)
                manifest.put("coverage",JSONArray(coverage.map{(path,complete)->JSONObject().put("domain",path).put("complete",complete)}))
                validate(binding,manifest,attemptId);assertSourceComplete();current();inventory(binding,manifest,false);verifyRecords(binding,manifest);current()
                val bytes=encoded(manifest);try{
                    val manifestHash=hash(bytes);current();val marker=JSONObject().put("protocol",1).put("attemptId",attemptId).put("phase","complete").put("manifestHash",manifestHash)
                    val writes=listOf(UnlockedE2eeVault.Write("local-snapshot",id(attemptId,"manifest"),bytes,null),write(id(attemptId,"journal"),marker,serial))
                    try{val metadataBytes=writes.sumOf{it.bytes.size};admit(Admission(integer(journal,"bytes"),manifest.getJSONArray("plan").length(),integer(journal,"localParts").toInt(),metadataBytes,metadataBytes*2L+16384));current();assertSourceComplete();current();commit(vault,writes,::current);finished=true}finally{writes.forEach{it.bytes.fill(0)}}
                    return Reference(attemptId,manifestHash)
                }finally{bytes.fill(0)}
            }catch(error:Exception){broken=true;throw error}finally{busy=false}
        }
        @Synchronized fun close(){broken=true}
        override fun toString()="E2eeContentPlan.Writer([redacted])"
    }
}
