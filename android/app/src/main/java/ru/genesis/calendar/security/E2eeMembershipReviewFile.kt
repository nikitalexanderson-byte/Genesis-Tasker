package ru.genesis.calendar.security

import java.io.InputStream
import java.io.OutputStream
import org.json.JSONObject

/** Matching bounded, exact-EOF review file transport. No imported value
 * becomes a pin, consent, root or executable outbox through this reader. */
internal object E2eeMembershipReviewFile {
    private val magic="GENESIS-MEMBERSHIP-REVIEW-2\n".toByteArray(Charsets.UTF_8)
    private const val MAX=6*1024*1024
    private fun invalid():Nothing=error("E2EE_MEMBERSHIP_REVIEW_MISMATCH")
    private fun write(output:OutputStream,value:JSONObject,current:()->Unit){
        current();val bytes=value.toString().toByteArray(Charsets.UTF_8);try{
            check(bytes.size in 1..MAX){"E2EE_MEMBERSHIP_PAGE_TOO_LARGE"};val count=bytes.size;output.write(byteArrayOf((count ushr 24).toByte(),(count ushr 16).toByte(),(count ushr 8).toByte(),count.toByte()));output.write(bytes);current()
        }finally{bytes.fill(0)}
    }
    fun writeFile(fingerprint:String,store:E2eeMembershipAtomicOwnerReviews,output:OutputStream,current:()->Unit){
        current();val request=store.inspect(fingerprint).getJSONObject("request");if(E2eeMembershipAtomicReview.fingerprint(request)!=fingerprint)invalid();output.write(magic)
        write(output,JSONObject().put("kind","header").put("request",request),current);var count=0
        for(kind in listOf("plan","preview","products")){
            val refs=when(kind){"plan"->request.getJSONObject("plan").getJSONArray("pages");"preview"->request.getJSONArray("previewPages");else->request.getJSONArray("productPages")}
            for(index in 0 until refs.length()){write(output,JSONObject().put("kind","part").put("part",store.part(fingerprint,kind,index)),current);count++}
        };write(output,JSONObject().put("kind","end").put("fingerprint",fingerprint).put("parts",count),current);output.flush();current()
    }
    suspend fun readFile(input:InputStream,store:E2eeMembershipAtomicOwnerReviews,current:()->Unit):JSONObject {
        fun read(size:Int):ByteArray {val value=ByteArray(size);var at=0;try{
            while(at<size){current();val count=input.read(value,at,size-at);current();if(count<0)error("E2EE_MEMBERSHIP_FILE_TRUNCATED");if(count==0){val one=input.read();if(one<0)error("E2EE_MEMBERSHIP_FILE_TRUNCATED");value[at++]=one.toByte()}else at+=count};return value
        }catch(error:Throwable){value.fill(0);throw error}}
        if(!read(magic.size).contentEquals(magic))invalid();var fingerprint:String?=null;var count=0;var planCount=0;var previewCount=0;var expected=0;var ended=false
        while(!ended){val prefix=read(4);val length=prefix.fold(0L){value,byte->(value shl 8)+(byte.toInt() and 255)};if(length !in 1..MAX.toLong())error("E2EE_MEMBERSHIP_PAGE_TOO_LARGE")
            val bytes=read(length.toInt());val record=try{E2eeFileManifestJson.readPrivateDocument(bytes)}finally{bytes.fill(0)}
            if(fingerprint==null){E2eeKeys.exact(record,setOf("kind","request"));if(record.get("kind")!="header")invalid();val request=E2eeMembershipAtomicReview.request(record.getJSONObject("request"));fingerprint=store.create(request);current();if(fingerprint!=E2eeMembershipAtomicReview.fingerprint(request))invalid()
                planCount=request.getJSONObject("plan").getJSONArray("pages").length();previewCount=request.getJSONArray("previewPages").length();expected=planCount+previewCount+request.getJSONArray("productPages").length()
            }else if(record.get("kind")=="part"){
                E2eeKeys.exact(record,setOf("kind","part"));if(count>=expected)invalid();val part=record.getJSONObject("part");E2eeKeys.exact(part,setOf("format","fingerprint","kind","index","page"))
                val kind=if(count<planCount)"plan"else if(count<planCount+previewCount)"preview"else"products";val index=if(count<planCount)count else if(count<planCount+previewCount)count-planCount else count-planCount-previewCount
                if(part.get("kind")!=kind||E2eeCommands.integer(part.get("index"))!=index.toLong()||part.get("fingerprint")!=fingerprint)invalid();store.putPart(part);current();count++
            }else{E2eeKeys.exact(record,setOf("kind","fingerprint","parts"));if(record.get("kind")!="end"||record.get("fingerprint")!=fingerprint||E2eeCommands.integer(record.get("parts"))!=count.toLong()||count!=expected)invalid();ended=true}
        }
        current();if(input.read()!=-1)invalid();current();val reviewed=store.review(fingerprint?:invalid());current()
        return JSONObject().put("fingerprint",fingerprint).put("scopeCount",reviewed.getJSONArray("scopes").length()).put("productCount",reviewed.getJSONArray("products").length())
    }
}
