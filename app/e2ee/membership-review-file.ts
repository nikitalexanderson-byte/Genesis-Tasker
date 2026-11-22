import {exactKeys} from './keys.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {validateMembershipAtomicReview,membershipAtomicReviewFingerprint} from './membership-atomic-review.ts';
import type {MembershipAtomicOwnerReviews} from './membership-atomic-owner.ts';

const MAGIC=new TextEncoder().encode('GENESIS-MEMBERSHIP-REVIEW-2\n'),MAX=6*1024*1024;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
type Store=Pick<MembershipAtomicOwnerReviews,'inspect'|'part'|'create'|'putPart'|'review'>;
function frame(value:unknown){const bytes=encoder.encode(JSON.stringify(value));if(!bytes.length||bytes.length>MAX)throw new Error('E2EE_MEMBERSHIP_PAGE_TOO_LARGE');const prefix=new Uint8Array(4);new DataView(prefix.buffer).setUint32(0,bytes.length);return[prefix,bytes];}
/** Public signed metadata/capsules only. Each frame is bounded and all pages
 * are retained; this is transport, never a new pin, approval or authority. */
export async function* exportMembershipReviewFile(fingerprint:string,store:Store,current:()=>void):AsyncGenerator<Uint8Array>{
 current();const {request}=await store.inspect(fingerprint);current();if(membershipAtomicReviewFingerprint(request)!==fingerprint)throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');yield new Uint8Array(MAGIC);
 for(const bytes of frame({kind:'header',request}))yield bytes;let count=0;
 for(const kind of ['plan','preview','products'] as const){const refs=kind==='plan'?request.plan.pages:kind==='preview'?request.previewPages:request.productPages;
  for(let index=0;index<refs.length;index++){const part=await store.part(fingerprint,kind,index);current();for(const bytes of frame({kind:'part',part}))yield bytes;count++;}}
 for(const bytes of frame({kind:'end',fingerprint,parts:count}))yield bytes;current();
}
/** Exact framing/EOF and the complete request precede signature/content
 * review. Interrupted imports stay typed inert partial inputs in the vault. */
export async function importMembershipReviewFile(chunks:AsyncIterable<Uint8Array>,store:Store,current:()=>void){
 const iterator=chunks[Symbol.asyncIterator]();let held=new Uint8Array(),offset=0,eof=false;
 const take=async(size:number,allowEof=false)=>{const result=new Uint8Array(size);let at=0;try{
  while(at<size){current();if(offset===held.length){const next=await iterator.next();current();if(next.done){eof=true;if(allowEof&&at===0)return null;throw new Error('E2EE_MEMBERSHIP_FILE_TRUNCATED');}if(!(next.value instanceof Uint8Array))throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');held=next.value;offset=0;if(!held.length)continue;}
   const count=Math.min(size-at,held.length-offset);result.set(held.subarray(offset,offset+count),at);at+=count;offset+=count;
  }return result;
 }catch(error){result.fill(0);throw error;}};
 try{const magic=await take(MAGIC.length);if(!magic||magic.some((byte,index)=>byte!==MAGIC[index]))throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');let fingerprint:string|null=null,count=0,expected=0,planCount=0,previewCount=0,ended=false;
  while(!ended){const prefix=await take(4),length=new DataView(prefix!.buffer,prefix!.byteOffset,4).getUint32(0);if(length<1||length>MAX)throw new Error('E2EE_MEMBERSHIP_PAGE_TOO_LARGE');const bytes=await take(length);let record:unknown;
   try{record=parseLegacyMigrationJson(decoder.decode(bytes!),'E2EE_MEMBERSHIP_REVIEW_MISMATCH',MAX);}finally{bytes?.fill(0);}
   if(!record||typeof record!=='object'||Array.isArray(record))throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');
   if(!fingerprint){exactKeys(record,['kind','request']);if(record.kind!=='header')throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');const request=validateMembershipAtomicReview(record.request);fingerprint=await store.create(request);current();if(fingerprint!==membershipAtomicReviewFingerprint(request))throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');planCount=request.plan.pages.length;previewCount=request.previewPages.length;expected=planCount+previewCount+request.productPages.length;}
   else if(record.kind==='part'){exactKeys(record,['kind','part']);if(count>=expected)throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');exactKeys(record.part,['format','fingerprint','kind','index','page']);
    const kind=count<planCount?'plan':count<planCount+previewCount?'preview':'products',index=count<planCount?count:count<planCount+previewCount?count-planCount:count-planCount-previewCount;
    if(record.part.kind!==kind||record.part.index!==index||record.part.fingerprint!==fingerprint)throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');await store.putPart(record.part as Parameters<Store['putPart']>[0]);current();count++;}
   else{exactKeys(record,['kind','fingerprint','parts']);if(record.kind!=='end'||record.fingerprint!==fingerprint||record.parts!==count||count!==expected)throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');ended=true;}
  }
  if(await take(1,true)!==null||!eof)throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');const reviewed=await store.review(fingerprint!);current();return{fingerprint:fingerprint!,scopeCount:reviewed.scopes.length,productCount:reviewed.products.length};
 }finally{await iterator.return?.();}
}
export async function* membershipReviewFileChunks(file:Blob){const reader=file.stream().getReader();try{for(;;){const next=await reader.read();if(next.done)return;yield next.value;}}finally{await reader.cancel();reader.releaseLock();}}
