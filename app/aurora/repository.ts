import {assertImmutableSession,validateDocument,type AuroraDocument} from './session';
import {canonicalJson} from './forecast';
import {mergePersonalLearning} from './personal-learning';
import {decodeAuroraStorage,encodeAuroraStorage} from './storage-compatibility';
export type Sealed={iv:string;ciphertext:string};
export type AuroraAccess={check:()=>void;request:<T>(path:string,init?:RequestInit)=>Promise<T>;seal:(value:unknown,scope:string)=>Promise<Sealed>;open:<T>(value:Sealed,scope:string)=>Promise<T>;
 withLegacyOperation:<T>(operation:(access:AuroraAccess)=>Promise<T>)=>Promise<T>;
 /** The native bridge binds its synchronous Room port to the exact operation. */
 storage?:AuroraStorage};
export type AuroraStorage=Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>;
type Envelope=Sealed&{revision:number};
type Pending={envelope:Sealed&{expectedRevision:number};base:Sealed};
export type AuroraConflict={local:AuroraDocument;remote:AuroraDocument;sessionIds:string[]};
const SCOPE='aurora-workspace:v1',BASE_SCOPE='aurora-workspace-base:v1';
export const emptyAuroraDocument=(ownerId:string):AuroraDocument=>({version:1,ownerId,sessions:[],removed:[]});
function retainedRemovals(...documents:AuroraDocument[]):AuroraDocument['removed'] {
 const rows=new Map<string,AuroraDocument['removed'][number]>();
 for(const document of documents)for(const row of document.removed){const old=rows.get(row.id);if(!old||Date.parse(row.removedAt)>Date.parse(old.removedAt))rows.set(row.id,row);}
 return [...rows.values()].sort((a,b)=>a.id.localeCompare(b.id,'en'));
}
export async function mergeAuroraDocuments(base:AuroraDocument,local:AuroraDocument,remote:AuroraDocument):Promise<AuroraDocument>{
 if(local.ownerId!==remote.ownerId||local.ownerId!==base.ownerId)throw new Error('AURORA_DOCUMENT_OWNER_CONFLICT');
 const same=(a:unknown,b:unknown)=>canonicalJson(a??null)===canonicalJson(b??null);
 const removed=retainedRemovals(base,remote,local),deleted=new Set(removed.map(r=>r.id));
 const rows=[...new Set([...local.sessions,...remote.sessions].map(s=>s.id))].flatMap(id=>{
  if(deleted.has(id))return [];
  const original=base.sessions.find(s=>s.id===id),left=local.sessions.find(s=>s.id===id),right=remote.sessions.find(s=>s.id===id);
  if(!same(left,original)&&!same(right,original)&&!same(left,right))throw new Error('AURORA_REVISION_CONFLICT');
  const chosen=!same(left,original)?left:right;if(original&&chosen)assertImmutableSession(original,chosen);return chosen?[chosen]:[];
 });const active=local.activeSessionId!==base.activeSessionId?local.activeSessionId:remote.activeSessionId;
 const learning=mergePersonalLearning(base.learning,local.learning,remote.learning);
 return validateDocument({version:1,ownerId:local.ownerId,activeSessionId:rows.some(s=>s.id===active)?active:rows.at(-1)?.id,sessions:rows,removed,...(learning?{learning}:{})},local.ownerId);
}
function errorStatus(error:unknown):number|null{
 return error&&typeof error==='object'&&'status' in error&&typeof error.status==='number'?error.status:null;
}
const protectionFailure=(error:unknown)=>error instanceof Error&&(/\bE2EE_[A-Z_]+\b/.test(error.message)||error.message==='AURORA_INVALID_RESPONSE');
export class AuroraRepository{
 private revision=0;private base:AuroraDocument;private serial:Promise<unknown>=Promise.resolve();private key:string;
 syncState:'saved'|'offline'|'conflict'='saved';
 constructor(private ownerId:string,private storage:AuroraStorage,private access:AuroraAccess){this.base=emptyAuroraDocument(ownerId);this.key=`genesis-aurora-workspace-v1:${ownerId}:`;}
 private disk(access:AuroraAccess){return access.storage??this.storage;}
 private enqueue<T>(operation:(access:AuroraAccess)=>Promise<T>):Promise<T>{
  const result=this.serial.catch(()=>{}).then(()=>this.access.withLegacyOperation(async access=>{
   access.check();const value=await operation(access);access.check();return value;
  }));this.serial=result;return result;
 }
 private async open(value:Sealed,scope:string,access:AuroraAccess):Promise<AuroraDocument>{
  const document=await validateDocument(await decodeAuroraStorage(await access.open<AuroraDocument>(value,scope)),this.ownerId);
  access.check();return document;
 }
 private async seal(value:AuroraDocument,scope:string,access:AuroraAccess):Promise<Sealed>{
  const encoded=await encodeAuroraStorage(value);access.check();return access.seal(encoded,scope);
 }
 private async remote(access:AuroraAccess):Promise<AuroraDocument>{
  const response=await access.request<{document:Envelope|null}>('/aurora-workspace',{cache:'no-store'});access.check();
  const value=response.document?await this.open(response.document,SCOPE,access):emptyAuroraDocument(this.ownerId);
  access.check();
  this.revision=response.document?.revision??0;this.base=value;
  if(response.document)this.disk(access).setItem(this.key+'cache',JSON.stringify(response.document));
  return structuredClone(value);
 }
 load():Promise<AuroraDocument>{return this.enqueue(access=>this.loadDocument(access));}
 private async loadDocument(access:AuroraAccess):Promise<AuroraDocument>{
  access.check();const raw=this.disk(access).getItem(this.key+'pending');let remote:AuroraDocument;
  try{remote=await this.remote(access);}
  catch(error){
   access.check();if(protectionFailure(error)||[400,401,403,404,422].includes(errorStatus(error)??0))throw error;
   if(raw){const pending=JSON.parse(raw) as Pending;this.revision=pending.envelope.expectedRevision;this.base=await this.open(pending.base,BASE_SCOPE,access);this.syncState='offline';return this.open(pending.envelope,SCOPE,access);}
   const cache=this.disk(access).getItem(this.key+'cache');if(!cache)throw error;
   const envelope=JSON.parse(cache) as Envelope;this.revision=envelope.revision;this.base=await this.open(envelope,SCOPE,access);this.syncState='offline';return structuredClone(this.base);
  }
  if(!raw)return remote;
  const pending=JSON.parse(raw) as Pending,local=await this.open(pending.envelope,SCOPE,access),base=await this.open(pending.base,BASE_SCOPE,access);
  try{await this.send(pending.envelope,local,access);return local;}
  catch(error){
   access.check();if(protectionFailure(error)||[400,401,403,404,413,422].includes(errorStatus(error)??0))throw error;
   if(!isConflict(error)){this.syncState='offline';return local;}
   try{return await this.saveDocument(await mergeAuroraDocuments(base,local,remote),access);}catch(conflict){this.syncState='conflict';throw conflict;}
  }
 }
 private async send(envelope:Sealed&{expectedRevision:number},value:AuroraDocument,access:AuroraAccess):Promise<void>{
  const response=await access.request<{revision:number}>('/aurora-workspace',{method:'PUT',body:JSON.stringify(envelope)});access.check();
  if(!Number.isSafeInteger(response?.revision)||response.revision!==envelope.expectedRevision+1)throw new Error('AURORA_INVALID_RESPONSE');
  this.revision=response.revision;this.base=structuredClone(value);this.disk(access).setItem(this.key+'cache',JSON.stringify({...envelope,revision:response.revision}));
  const raw=this.disk(access).getItem(this.key+'pending'),pending=raw?JSON.parse(raw) as Pending:null;
  if(pending?.envelope.iv===envelope.iv&&pending.envelope.ciphertext===envelope.ciphertext&&pending.envelope.expectedRevision===envelope.expectedRevision)this.disk(access).removeItem(this.key+'pending');
  this.syncState='saved';
 }
 save(input:AuroraDocument):Promise<AuroraDocument>{
  const snapshot=structuredClone(input);return this.enqueue(access=>this.saveDocument(snapshot,access));
 }
 private async saveDocument(input:AuroraDocument,access:AuroraAccess):Promise<AuroraDocument>{
   let value=await validateDocument(input,this.ownerId);access.check();
   const removed=retainedRemovals(this.base,value),deleted=new Set(removed.map(row=>row.id)),sessions=value.sessions.filter(row=>!deleted.has(row.id));
   value={...value,removed,sessions,activeSessionId:sessions.some(row=>row.id===value.activeSessionId)?value.activeSessionId:sessions.at(-1)?.id};
   for(const previous of this.base.sessions){const after=value.sessions.find(s=>s.id===previous.id);if(after)assertImmutableSession(previous,after);else if(!value.removed.some(r=>r.id===previous.id))throw new Error('AURORA_EXPLICIT_DELETION_REQUIRED');}
   const envelope={...await this.seal(value,SCOPE,access),expectedRevision:this.revision},base=await this.seal(this.base,BASE_SCOPE,access);access.check();
   this.disk(access).setItem(this.key+'pending',JSON.stringify({envelope,base}));
   try{await this.send(envelope,value,access);return structuredClone(value);}
   catch(error){
    access.check();if(!isConflict(error)){if(protectionFailure(error)||[400,401,403,404,413,422].includes(errorStatus(error)??0))throw error;this.syncState='offline';return value;}
    const previous=this.base,remote=await this.remote(access);let merged:AuroraDocument;
    try{merged=await mergeAuroraDocuments(previous,value,remote);}catch(conflict){this.syncState='conflict';throw conflict;}
    const retry={...await this.seal(merged,SCOPE,access),expectedRevision:this.revision},retryBase=await this.seal(remote,BASE_SCOPE,access);
    access.check();this.disk(access).setItem(this.key+'pending',JSON.stringify({envelope:retry,base:retryBase}));
    await this.send(retry,merged,access);return structuredClone(merged);
   }
 }
 conflictVersions():Promise<AuroraConflict|null>{return this.enqueue(access=>this.readConflict(access));}
 private async readConflict(access:AuroraAccess):Promise<AuroraConflict|null>{
  access.check();const raw=this.disk(access).getItem(this.key+'pending');if(!raw)return null;
  const pending=JSON.parse(raw) as Pending,local=await this.open(pending.envelope,SCOPE,access),
   base=await this.open(pending.base,BASE_SCOPE,access),remote=await this.remote(access);
  const same=(a:unknown,b:unknown)=>canonicalJson(a??null)===canonicalJson(b??null);
  return {local,remote,sessionIds:local.sessions.filter(left=>{
   const original=base.sessions.find(s=>s.id===left.id),right=remote.sessions.find(s=>s.id===left.id);
   return !same(left,original)&&!same(right,original)&&!same(left,right);
  }).map(s=>s.id)};
 }
 /** Explicitly keep both versions. Issued payloads and their original situation IDs stay intact. */
 recoverAsCopy(newIds:Readonly<Record<string,string>>,now:string):Promise<AuroraDocument>{
  const ids=structuredClone(newIds);return this.enqueue(access=>this.recoverDocument(ids,now,access));
 }
 private async recoverDocument(newIds:Readonly<Record<string,string>>,now:string,access:AuroraAccess):Promise<AuroraDocument>{
  const raw=this.disk(access).getItem(this.key+'pending');if(!raw)return this.loadDocument(access);
  const pending=JSON.parse(raw) as Pending,local=await this.open(pending.envelope,SCOPE,access),remote=await this.remote(access);
  const base=await this.open(pending.base,BASE_SCOPE,access);
  const copies=local.sessions.filter(s=>newIds[s.id]).map(s=>{
   const id=newIds[s.id];if(!id||remote.sessions.some(r=>r.id===id)||local.sessions.some(r=>r.id===id))throw new Error('AURORA_COPY_ID_COLLISION');
   return {...s,id,historyOrigins:[...new Set([...(s.historyOrigins??[]),s.id])],context:{...s.context,situationId:id,answerEvidence:s.context.answerEvidence.map(e=>({...e,situationId:id}))},updatedAt:now};
  });
  // Nonconflicting edits still merge normally. Remote deletions and issued history
  // are retained; the local conflicting branch lives in its explicitly named copy.
  const withoutCopies=(doc:AuroraDocument)=>({...doc,sessions:doc.sessions.filter(s=>!newIds[s.id])});
  const merged=await mergeAuroraDocuments(withoutCopies(base),withoutCopies(local),withoutCopies(remote));
  const kept=remote.sessions.filter(s=>newIds[s.id]);
  return this.saveDocument({...merged,activeSessionId:newIds[local.activeSessionId??'']??remote.activeSessionId,sessions:[...merged.sessions,...kept,...copies]},access);
 }
}
function isConflict(error:unknown):boolean{return error instanceof Error&&error.message.includes('AURORA_REVISION_CONFLICT');}
