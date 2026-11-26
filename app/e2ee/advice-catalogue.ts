import {exactKeys} from './keys.ts';
import {backupJson} from '../backup-format.ts';

export const ADVICE_CATALOGUE_LANGUAGES=['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja'] as const;
export type AdviceCatalogueLanguage=typeof ADVICE_CATALOGUE_LANGUAGES[number];
export type AdviceCatalogueKind='daily'|'philosophers';
export type AdviceCatalogueText={title:string;body:string;sources?:{kind:'quote'|'inspired';author?:string;work?:string;reference?:string;url?:string}[]};
type Edition={kind:AdviceCatalogueKind;version:string;language:AdviceCatalogueLanguage;sha256:string;bytes:number;path:string};
const MAX=8*1024*1024,decoder=new TextDecoder('utf-8',{fatal:true});
function invalid():never{throw new Error('E2EE_ADVICE_CATALOGUE_INVALID');}
function object(value:unknown):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function parse(bytes:Uint8Array,limit:number):unknown{
 if(!(bytes instanceof Uint8Array)||bytes.length<2||bytes.length>limit)invalid();
 try{return backupJson(decoder.decode(bytes),limit);}catch{return invalid();}
}
function reference(kind:unknown,version:unknown,language:unknown){
 if(!['daily','philosophers'].includes(String(kind))||typeof version!=='string'||!/^[-a-z0-9]{1,80}$/.test(version)
  ||kind==='philosophers'&&!/^philosophers-[-a-z0-9]{1,70}$/.test(version)||!ADVICE_CATALOGUE_LANGUAGES.includes(language as AdviceCatalogueLanguage))invalid();
}
function validateText(value:unknown,kind:AdviceCatalogueKind):asserts value is AdviceCatalogueText{
 exactKeys(value,kind==='daily'?['title','body']:['title','body','sources']);
 if(typeof value.title!=='string'||value.title.length>2000||typeof value.body!=='string'||!value.body.trim()||value.body.length>100000)invalid();
 if(kind==='philosophers'){
  if(!Array.isArray(value.sources)||value.sources.length>20)invalid();
  for(const row of value.sources){object(row);
   if(Object.keys(row).some(key=>!['kind','author','work','reference','url'].includes(key))||!['quote','inspired'].includes(String(row.kind))
    ||['author','work','reference','url'].some(key=>row[key]!==undefined&&(typeof row[key]!=='string'||row[key].length>2000))
    ||row.url&&!/^https?:\/\/[^\s]+$/u.test(String(row.url)))invalid();
  }
 }
}

/** Fetches complete PUBLIC editions, never a per-user/per-advice URL. The
 * release's manifest pins exact bytes for this client lifetime. This checks
 * transport corruption; it does not claim independence from a compromised web
 * origin. Selected identities and private preferences never enter the request. */
export class PublicAdviceCatalogues{
 #fetch:(path:string)=>Promise<Uint8Array>;#check:()=>void;
 #manifest:Promise<Edition[]>|undefined;#pending=new Map<string,Promise<Record<string,AdviceCatalogueText>>>();
 #cache=new Map<string,{bytes:number;texts:Record<string,AdviceCatalogueText>}>();#size=0;
 constructor(fetchPublicBytes:(path:string)=>Promise<Uint8Array>,assertCurrent:()=>void){this.#fetch=fetchPublicBytes;this.#check=assertCurrent;}
 async #editions():Promise<Edition[]>{
  this.#check();if(!this.#manifest)this.#manifest=(async()=>{
   const raw=await this.#fetch('advice-catalogues/v1/manifest.json');this.#check();const value=parse(raw,1024*1024);exactKeys(value,['protocol','catalogues']);
   if(value.protocol!==1||!Array.isArray(value.catalogues)||value.catalogues.length<1||value.catalogues.length>2048)invalid();
   const names=new Set<string>(),editions=new Map<string,Set<string>>();
   for(const row of value.catalogues){exactKeys(row,['kind','version','language','sha256','bytes','path']);reference(row.kind,row.version,row.language);
    if(typeof row.sha256!=='string'||!/^([a-f0-9]{64})$/.test(row.sha256)||!Number.isSafeInteger(row.bytes)||(row.bytes as number)<2||(row.bytes as number)>MAX
     ||row.path!==`advice-catalogues/v1/${row.kind}/${row.version}/${row.language}.${row.sha256}.json`)invalid();
    const name=`${row.kind}:${row.version}:${row.language}`;if(names.has(name))invalid();names.add(name);
    const key=`${row.kind}:${row.version}`;if(!editions.has(key))editions.set(key,new Set());editions.get(key)!.add(row.language as string);
   }
   if([...editions.values()].some(languages=>languages.size!==ADVICE_CATALOGUE_LANGUAGES.length))throw new Error('E2EE_ADVICE_CATALOGUE_UNAVAILABLE');
   return value.catalogues as Edition[];
  })();
  return this.#manifest;
 }
 async #texts(edition:Edition):Promise<Record<string,AdviceCatalogueText>>{
  this.#check();const cached=this.#cache.get(edition.path);if(cached){this.#cache.delete(edition.path);this.#cache.set(edition.path,cached);return cached.texts;}
  const pending=this.#pending.get(edition.path);if(pending)return pending;
  if(this.#pending.size>=4)throw new Error('E2EE_ADVICE_CATALOGUE_BUSY');
  const job=(async()=>{
   const bytes=await this.#fetch(edition.path);this.#check();if(!(bytes instanceof Uint8Array)||bytes.length!==edition.bytes)invalid();
   const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)));this.#check();
   if([...hash].map(value=>value.toString(16).padStart(2,'0')).join('')!==edition.sha256)throw new Error('E2EE_ADVICE_CATALOGUE_INTEGRITY');
   const value=parse(bytes,MAX);object(value);const rows=Object.entries(value);if(rows.length<1||rows.length>10000)invalid();
   for(const [id,text]of rows){if(!/^advice-[a-f0-9]{24}$/.test(id))invalid();validateText(text,edition.kind);}
   const texts=value as Record<string,AdviceCatalogueText>;this.#check();
   while(this.#size+edition.bytes>32*1024*1024&&this.#cache.size){const first=this.#cache.keys().next().value!;this.#size-=this.#cache.get(first)!.bytes;this.#cache.delete(first);}
   this.#cache.set(edition.path,{bytes:edition.bytes,texts});this.#size+=edition.bytes;return texts;
  })();
  this.#pending.set(edition.path,job);try{return await job;}finally{this.#pending.delete(edition.path);}
 }
 async resolve(kind:AdviceCatalogueKind,version:string,language:AdviceCatalogueLanguage,id:string):Promise<AdviceCatalogueText>{
  this.#check();reference(kind,version,language);if(!/^advice-[a-f0-9]{24}$/.test(id))invalid();
  const editions=await this.#editions();this.#check();const edition=editions.find(row=>row.kind===kind&&row.version===version&&row.language===language);
  if(!edition)throw new Error('E2EE_ADVICE_CATALOGUE_UNAVAILABLE');
  const texts=await this.#texts(edition);this.#check();const text=texts[id];if(!text)throw new Error('E2EE_ADVICE_TRANSLATION_MISSING');
  return structuredClone(text);
 }
 toString(){return 'PublicAdviceCatalogues([public editions])';}
}

/** Same-origin public downloads with no session cookies or referrer. A missing
 * edition/redirect/oversize response never falls back to a current translation. */
export function publicAdviceCatalogueReader(base:URL,assertCurrent:()=>void,request:typeof fetch=fetch){
 if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(base.hostname)))invalid();
 const directory=new URL(base.href.endsWith('/')?base.href:base.href+'/');
 return async(path:string):Promise<Uint8Array>=>{
  assertCurrent();if(!/^advice-catalogues\/v1\/(?:manifest\.json|metadata\.[a-f0-9]{64}\.json|(?:daily|philosophers)\/[-a-z0-9]{1,80}\/[a-z]{2}\.[a-f0-9]{64}\.json)$/.test(path))invalid();
  const limit=path.endsWith('/manifest.json')?1024*1024:MAX;
  const response=await request(new URL(path,directory),{credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:path.endsWith('/manifest.json')?'no-cache':'force-cache'});assertCurrent();
  if(response.status!==200||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw new Error('E2EE_ADVICE_CATALOGUE_UNAVAILABLE');
  const declared=response.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>limit))invalid();
  const reader=response.body?.getReader();if(!reader)invalid();const chunks:Uint8Array[]=[];let length=0,complete=false;
  try{
   for(;;){assertCurrent();const {value,done}=await reader.read();assertCurrent();if(done){complete=true;break;}length+=value.length;if(length>limit)invalid();chunks.push(value);}
   const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return bytes;
  }finally{if(!complete)await reader.cancel().catch(()=>undefined);reader.releaseLock();}
 };
}
