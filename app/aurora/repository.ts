import {assertImmutableSession,validateDocument,type AuroraDocument} from './session';
import {canonicalJson} from './forecast';
import {mergePersonalLearning} from './personal-learning';
import {decodeAuroraStorage,encodeAuroraStorage} from './storage-compatibility';
import {EncryptedPendingJournal,type EncryptedJournalBranch,type EncryptedJournalStorage} from '../encrypted-pending-journal';
export type Sealed={iv:string;ciphertext:string};
export type AuroraAccess={check:()=>void;request:<T>(path:string,init?:RequestInit)=>Promise<T>;seal:(value:unknown,scope:string)=>Promise<Sealed>;open:<T>(value:Sealed,scope:string)=>Promise<T>;
 withLegacyOperation:<T>(operation:(access:AuroraAccess)=>Promise<T>)=>Promise<T>;
 /** The native bridge binds its synchronous Room port to the exact operation. */
 storage?:AuroraStorage};
export type AuroraStorage=EncryptedJournalStorage;
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
 private journal:EncryptedPendingJournal;private conflictBranch:EncryptedJournalBranch|null=null;
 syncState:'saved'|'offline'|'conflict'='saved';
 constructor(private ownerId:string,private storage:AuroraStorage,private access:AuroraAccess){this.base=emptyAuroraDocument(ownerId);this.key=`genesis-aurora-workspace-v1:${ownerId}:`;this.journal=new EncryptedPendingJournal(this.key+'pending');}
 private disk(access:AuroraAccess){return access.storage??this.storage;}
 /** Read-only mounted source capture. The coordinator supplies the exclusive
  * migration fence; this method never drains a queue or acquires that lock. */
 captureMigrationState(current:AuroraDocument|null){
  this.access.check();if(current===null)return null;
  return structuredClone({document:current,base:this.base,revision:this.revision});
 }
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
  if(response.document&&(!Number.isSafeInteger(response.document.revision)||response.document.revision<1))throw new Error('AURORA_INVALID_RESPONSE');
  const value=response.document?await this.open(response.document,SCOPE,access):emptyAuroraDocument(this.ownerId);
  access.check();
  this.revision=response.document?.revision??0;this.base=value;
  if(response.document)this.disk(access).setItem(this.key+'cache',JSON.stringify(response.document));
  return structuredClone(value);
 }
 load():Promise<AuroraDocument>{return this.enqueue(access=>this.loadDocument(access));}
 private pending(branch:EncryptedJournalBranch):Pending{
  const value=JSON.parse(branch.head.raw) as Pending;
  if(!Number.isSafeInteger(value?.envelope?.expectedRevision)||value.envelope.expectedRevision<0||value.envelope.expectedRevision>=Number.MAX_SAFE_INTEGER||!value.base)throw new Error('AURORA_INVALID_RESPONSE');
  return value;
 }
 private async offlineDocument(branches:readonly EncryptedJournalBranch[],access:AuroraAccess){
  let value=structuredClone(this.base);
  for(const branch of branches){const pending=this.pending(branch);try{value=await mergeAuroraDocuments(await this.open(pending.base,BASE_SCOPE,access),await this.open(pending.envelope,SCOPE,access),value);}catch(conflict){this.conflictBranch=branch;this.syncState='conflict';throw conflict;}}
  this.syncState='offline';return value;
 }
 private retainedConflict(access:AuroraAccess){
  const branches=this.journal.read(this.disk(access));
  return branches.find(branch=>branch.head.key===this.conflictBranch?.head.key)??branches[0];
 }
 private async loadDocument(access:AuroraAccess):Promise<AuroraDocument>{
  access.check();const branches=this.journal.read(this.disk(access));
  try{await this.remote(access);}
  catch(error){
   access.check();if(protectionFailure(error)||[400,401,403,404,422].includes(errorStatus(error)??0))throw error;
   const cache=this.disk(access).getItem(this.key+'cache');
   if(cache){const envelope=JSON.parse(cache) as Envelope;if(!Number.isSafeInteger(envelope.revision)||envelope.revision<1)throw new Error('AURORA_INVALID_RESPONSE');this.revision=envelope.revision;this.base=await this.open(envelope,SCOPE,access);}
   else if(branches.length){const newest=[...branches].sort((a,b)=>this.pending(b).envelope.expectedRevision-this.pending(a).envelope.expectedRevision)[0],pending=this.pending(newest);this.revision=pending.envelope.expectedRevision;this.base=await this.open(pending.base,BASE_SCOPE,access);}
   else throw error;
   return this.offlineDocument(branches,access);
  }
  for(const branch of branches){
   const pending=this.pending(branch),local=await this.open(pending.envelope,SCOPE,access),base=await this.open(pending.base,BASE_SCOPE,access);
   try{await this.send(pending.envelope,local,branch,access);}
   catch(error){
    access.check();if(protectionFailure(error)||[400,401,403,404,413,422].includes(errorStatus(error)??0))throw error;
    if(!isConflict(error))return this.offlineDocument(this.journal.read(this.disk(access)),access);
    try{const value=await this.saveDocument(await mergeAuroraDocuments(base,local,this.base),access,new EncryptedPendingJournal(this.key+'pending'));if(this.syncState!=='saved')return value;this.journal.acknowledge(this.disk(access),branch);}
    catch(conflict){this.conflictBranch=branch;this.syncState='conflict';throw conflict;}
   }
  }
  this.syncState='saved';this.conflictBranch=null;return structuredClone(this.base);
 }
 private async send(envelope:Sealed&{expectedRevision:number},value:AuroraDocument,branch:EncryptedJournalBranch,access:AuroraAccess):Promise<void>{
  const response=await access.request<{revision:number}>('/aurora-workspace',{method:'PUT',body:JSON.stringify(envelope)});access.check();
  if(!Number.isSafeInteger(response?.revision)||response.revision!==envelope.expectedRevision+1)throw new Error('AURORA_INVALID_RESPONSE');
  // An idempotent old receipt may arrive after a newer remote revision. It
  // acknowledges its bytes without rolling the editor/cache back to that head.
  if(response.revision>=this.revision){this.revision=response.revision;this.base=structuredClone(value);this.disk(access).setItem(this.key+'cache',JSON.stringify({...envelope,revision:response.revision}));}
  this.journal.acknowledge(this.disk(access),branch);
  this.syncState='saved';
 }
 save(input:AuroraDocument):Promise<AuroraDocument>{
  const snapshot=structuredClone(input);return this.enqueue(access=>this.saveDocument(snapshot,access));
 }
 private async saveDocument(input:AuroraDocument,access:AuroraAccess,journal=this.journal):Promise<AuroraDocument>{
   let value=await validateDocument(input,this.ownerId);access.check();
   const removed=retainedRemovals(this.base,value),deleted=new Set(removed.map(row=>row.id)),sessions=value.sessions.filter(row=>!deleted.has(row.id));
   value={...value,removed,sessions,activeSessionId:sessions.some(row=>row.id===value.activeSessionId)?value.activeSessionId:sessions.at(-1)?.id};
   for(const previous of this.base.sessions){const after=value.sessions.find(s=>s.id===previous.id);if(after)assertImmutableSession(previous,after);else if(!value.removed.some(r=>r.id===previous.id))throw new Error('AURORA_EXPLICIT_DELETION_REQUIRED');}
   const envelope={...await this.seal(value,SCOPE,access),expectedRevision:this.revision},base=await this.seal(this.base,BASE_SCOPE,access);access.check();
   const branch=journal.stage(this.disk(access),JSON.stringify({envelope,base}));
   try{await this.send(envelope,value,branch,access);return structuredClone(this.base);}
   catch(error){
    access.check();if(!isConflict(error)){if(protectionFailure(error)||[400,401,403,404,413,422].includes(errorStatus(error)??0))throw error;this.syncState='offline';return value;}
    const previous=this.base,remote=await this.remote(access);let merged:AuroraDocument;
    try{merged=await mergeAuroraDocuments(previous,value,remote);}catch(conflict){this.conflictBranch=branch;this.syncState='conflict';throw conflict;}
    const retry={...await this.seal(merged,SCOPE,access),expectedRevision:this.revision},retryBase=await this.seal(remote,BASE_SCOPE,access);
    access.check();const retryBranch=journal.stage(this.disk(access),JSON.stringify({envelope:retry,base:retryBase}));
    await this.send(retry,merged,retryBranch,access);return structuredClone(this.base);
   }
 }
 conflictVersions():Promise<AuroraConflict|null>{return this.enqueue(access=>this.readConflict(access));}
 private async readConflict(access:AuroraAccess):Promise<AuroraConflict|null>{
  access.check();const branch=this.retainedConflict(access);if(!branch)return null;
  const pending=this.pending(branch),local=await this.open(pending.envelope,SCOPE,access),
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
  const branch=this.retainedConflict(access);if(!branch)return this.loadDocument(access);
  const pending=this.pending(branch),local=await this.open(pending.envelope,SCOPE,access),remote=await this.remote(access);
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
  const value=await this.saveDocument({...merged,activeSessionId:newIds[local.activeSessionId??'']??remote.activeSessionId,sessions:[...merged.sessions,...kept,...copies]},access,new EncryptedPendingJournal(this.key+'pending'));
  if(this.syncState==='saved'){this.journal.acknowledge(this.disk(access),branch);this.conflictBranch=null;return this.loadDocument(access);}return value;
 }
}
function isConflict(error:unknown):boolean{return error instanceof Error&&error.message.includes('AURORA_REVISION_CONFLICT');}
