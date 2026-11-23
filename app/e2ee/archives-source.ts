import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {readLegacyArchiveOperations,readLegacyArchiveTables,type ArchiveContentReaderPorts} from './archives-content.ts';
import {E2EE_MIGRATION_BYTE_BUDGET,type MigrationContent,type MigrationSourceContext} from './migration.ts';
import type {PrivatePathAdapter} from './migration-sources.ts';
import type {WebArchiveInventory} from './archives-web-source.ts';
import {readLegacyPhysisRecordText,unlockLegacyPhysisSource,validateLegacyPhysisVault,type PhysisLegacyUnlockPorts} from './physis-legacy.ts';

type Row=Record<string,unknown>;
type Snapshot={protocol:1;ownerId:string;scopeId:string;capturedAt:string;
 memory:{ownerId:string;generation:number;reconciliationRequired:boolean;legacyKey:string;local:WebArchiveInventory;physis?:unknown[]}};
export type PortableArchiveCapture={protocol:2;ownerId:string;scopeId:string;capturedAt:string;generation:number;
 platform:'android';histories:readonly {source:string;value:unknown}[]};
export type ArchivesSourcePorts={assertCurrent:()=>void;captureLocal:()=>Promise<Uint8Array>;
 legacyArchives:(context:MigrationSourceContext)=>Promise<unknown>;
 /** Native binds this to exact captured originals. It returns original UTF-8
  * JSON, keeps old keys native, and never exposes a generic decrypt service. */
 openAccount?:ArchiveContentReaderPorts['openAccount'];openPhysis?:ArchiveContentReaderPorts['openPhysis'];
 legacyPhysis?:(context:MigrationSourceContext)=>Promise<unknown>;independentUnlock?:PhysisLegacyUnlockPorts['independentUnlock']};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),MAX=64*1024*1024;
function invalid():never{throw new Error('E2EE_ARCHIVE_SOURCE_INVALID');}
function object(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function integer(value:unknown):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<0)invalid();}
function parse(value:unknown){return parseLegacyMigrationJson(value,'E2EE_ARCHIVE_SOURCE_INVALID',MAX);}
function string(value:unknown,max=MAX):asserts value is string{if(typeof value!=='string'||value.length>max)invalid();}
function time(value:unknown){string(value,100);if(!Number.isFinite(Date.parse(value)))invalid();}
function base64(value:unknown,min:number,max=min){
 string(value,Math.ceil(max/3)*4);if(value.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))invalid();
 let binary:string;try{binary=atob(value);}catch{return invalid();}
 if(binary.length<min||binary.length>max||btoa(binary)!==value)invalid();
 return Uint8Array.from(binary,char=>char.charCodeAt(0));
}
function purposeAllowed(purpose:string){return purpose==='workspace'||['backup-device-safety:v1','backup-held-state:v1','aurora-workspace:v1',
 'aurora-workspace-base:v1','stoicheion-workspace:v1','stoicheion-pending-base:v1'].includes(purpose)
 ||/^(?:map:|diary-note:v1:|recovered-task:v1:)[A-Za-z0-9_-]{1,100}$/.test(purpose)||/^physis-vault:v2:[1-9][0-9]{0,15}$/.test(purpose);}

/** Import only retained old keys; no HTTP/key creation/legacy write fallback. */
export async function archiveAccountReader(ownerId:string,rawKeys:readonly string[],assertCurrent:()=>void):Promise<ArchiveContentReaderPorts['openAccount']>{
 assertTechnical(ownerId);const keys:CryptoKey[]=[];
 for(const encoded of new Set(rawKeys)){const raw=base64(encoded,32);try{assertCurrent();keys.push(await crypto.subtle.importKey('raw',new Uint8Array(raw),'AES-GCM',false,['decrypt']));assertCurrent();}finally{raw.fill(0);}}
 return async(owner,envelope,purpose)=>{
  assertCurrent();if(owner!==ownerId||!purposeAllowed(purpose))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  const iv=base64(envelope.iv,12),cipher=base64(envelope.ciphertext,16,MAX+16);let opened:Uint8Array|undefined;
  try{
   for(const key of keys){try{opened=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(iv),
    ...(purpose==='workspace'?{}:{additionalData:encoder.encode(`genesis-mindmap-v1:${ownerId}:${purpose}`)})},key,new Uint8Array(cipher)));break;}
    catch(error){if(!(error instanceof DOMException)||error.name!=='OperationError')throw error;}}
   assertCurrent();if(!opened)throw new Error(keys.length?'E2EE_ARCHIVE_CONTENT_CORRUPT':'E2EE_LEGACY_KEY_UNAVAILABLE');
   return decoder.decode(opened);
  }finally{iv.fill(0);cipher.fill(0);opened?.fill(0);}
 };
}

/** Portable sidecars preserve every opened envelope, including pending bases.
 * The original remains history; no historical HTTP command is ever executed. */
async function materializeStored(ownerId:string,key:string,value:unknown,ports:ArchiveContentReaderPorts):Promise<unknown>{
 if(key===`genesis-calendar-v2:${ownerId}`)return{original:value};
 if(key===`genesis-data-generation-v1:${ownerId}`){if(typeof value==='string'&&!/^\d+$/.test(value))invalid();return{original:value};}
 let purpose:string|null=null;
 for(const [prefix,scope] of [[`genesis-mindmaps:${ownerId}:`,'map:'],[`genesis-diary-v1:${ownerId}:`,'diary-note:v1:'],
  [`genesis-aurora-workspace-v1:${ownerId}:`,'aurora-workspace:v1'],[`genesis-stoicheion-workspace-v1:${ownerId}:`,'stoicheion-workspace:v1']] as const){
  if(key.startsWith(prefix))purpose=scope;
 }
 const pending=key===`genesis-pending-mutations-v2:${ownerId}`||key.startsWith(`genesis-pending-mutations-v2:${ownerId}:`);
 if(!purpose&&!pending)throw new Error('E2EE_ARCHIVE_FORMAT_UNSUPPORTED');
 const opened:{path:string;purpose:string;rawDocument:string}[]=[];let visited=0;
 async function walk(node:unknown,path:string,identity:string|null,base=false,depth=0):Promise<void>{
  ports.assertCurrent();if(depth>100||++visited>200000)throw new Error('E2EE_SOURCE_TOO_LARGE');
  if(Array.isArray(node)){for(let i=0;i<node.length;i++)await walk(node[i],`${path}/${i}`,identity,base,depth+1);return;}
  if(!node||typeof node!=='object')return;object(node);
  const id=typeof node.id==='string'?node.id:identity;
  if(Object.hasOwn(node,'iv')||Object.hasOwn(node,'ciphertext')){
   if(typeof node.iv!=='string'||typeof node.ciphertext!=='string')invalid();
   let scope=purpose;
   if(scope==='map:'||scope==='diary-note:v1:'){
    const record=id??key.split(':').at(-1);if(!record||!/^[A-Za-z0-9_-]{1,100}$/.test(record))invalid();scope+=record;
   }else if(base&&scope==='aurora-workspace:v1')scope='aurora-workspace-base:v1';
   else if(base&&scope==='stoicheion-workspace:v1')scope='stoicheion-pending-base:v1';
   if(pending)scope='workspace';if(!scope||!purposeAllowed(scope))invalid();
   const rawDocument=await ports.openAccount(ownerId,{iv:node.iv,ciphertext:node.ciphertext},scope);ports.assertCurrent();parse(rawDocument);
   opened.push({path,purpose:scope,rawDocument});return;
  }
  for(const [name,child] of Object.entries(node)){
   if(typeof child==='string'&&name==='body'&&pending){
    const body=parse(child);if(body&&typeof body==='object'&&!Array.isArray(body)&&(Object.hasOwn(body,'iv')||Object.hasOwn(body,'ciphertext')))await walk(body,`${path}/${name}`,id,base,depth+1);
   }else await walk(child,`${path}/${name}`,id,base||name==='base',depth+1);
  }
 }
 await walk(value,'',null);ports.assertCurrent();return{original:value,opened};
}
async function materializeFrozen(ownerId:string,input:unknown,ports:ArchiveContentReaderPorts){
 exactKeys(input,['owner','at','sources','sync','storage']);if(input.owner!==ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');time(input.at);object(input.sources);object(input.sync);object(input.storage);
 // CaptureSyncState intentionally excludes raw keys, credentials and headers.
 if(Object.keys(input.sync).some(name=>!['generation','version','metadata','baseMetadata','pending'].includes(name)))throw new Error('E2EE_ARCHIVE_FORMAT_UNSUPPORTED');
 if(!Array.isArray(input.sync.pending))invalid();const pending=[];
 for(const candidate of input.sync.pending){object(candidate);const row=structuredClone(candidate);
  if(row.kind==='workspace'&&row.operation==='save'){object(row.data);const data=row.data;
   if(typeof data.iv!=='string'||typeof data.ciphertext!=='string')invalid();
   row.materialized=await ports.openAccount(ownerId,{iv:data.iv,ciphertext:data.ciphertext},'workspace');parse(row.materialized);
  }else if(!['task','workspace'].includes(String(row.kind)))throw new Error('E2EE_ARCHIVE_FORMAT_UNSUPPORTED');pending.push(row);
 }
 const storage=[];for(const [key,value]of Object.entries(input.storage))storage.push({key,value:await materializeStored(ownerId,key,value,ports)});
 const sources=structuredClone(input.sources);
 if(sources.physis!==undefined)sources.physis=await materializeArchivedPhysis(ownerId,sources.physis,ports);
 ports.assertCurrent();return{ownerId,at:input.at,sources,sync:{...input.sync,pending},storage,execution:'history-only'};
}

/** Old independently encrypted Physis records inside otherwise portable
 * archives need their own authenticated plaintext sidecars too. */
export async function materializeArchivedPhysis(ownerId:string,input:unknown,ports:ArchiveContentReaderPorts){
 object(input);const original=structuredClone(input),opened:{source:string;rawDocument:string}[]=[];
 const open=async(id:unknown,packet:unknown,source:string)=>{
  string(id,100);object(packet);if(!ports.openPhysis)throw new Error('E2EE_ARCHIVE_PHYSIS_UNLOCK_REQUIRED');
  const rawDocument=await ports.openPhysis(ownerId,id,packet);ports.assertCurrent();parse(rawDocument);opened.push({source,rawDocument});
 };
 for(const family of ['wire','confirmed']){const rows=original[family];if(rows===undefined)continue;if(!Array.isArray(rows)||rows.length>50000)invalid();
  for(let i=0;i<rows.length;i++){const row=rows[i];object(row);
   if(row.envelope_json!==null&&row.envelope_json!==undefined)await open(row.id,parse(row.envelope_json),`${family}:${i}`);
   else if(row.envelope!==null&&row.envelope!==undefined)await open(row.id,row.envelope,`${family}:${i}`);
  }
 }
 if(original.pending!==undefined){if(!Array.isArray(original.pending)||original.pending.length>10000)invalid();
  for(let i=0;i<original.pending.length;i++){const row=original.pending[i];object(row);if(row.changes===undefined)continue;if(!Array.isArray(row.changes))invalid();
   for(let j=0;j<row.changes.length;j++){const change=row.changes[j];object(change);if(change.envelope!==null&&change.envelope!==undefined)await open(change.id,change.envelope,`pending:${i}:${j}`);}
  }
 }
 ports.assertCurrent();return{original,opened,execution:'history-only'};
}
export async function materializeLegacyBackupPayload(ownerId:string,input:unknown,ports:ArchiveContentReaderPorts){
 object(input);if(input.schema!==1||input.ownerId!==ownerId||!Array.isArray(input.sections)||input.sections.length>7)throw new Error('E2EE_ARCHIVE_FORMAT_UNSUPPORTED');
 const opened:unknown[]=[];const ids=new Set<string>();
 for(const candidate of input.sections){object(candidate);string(candidate.id,100);if(ids.has(candidate.id))invalid();ids.add(candidate.id);const data=candidate.data;
  if(data===null)continue;object(data);
  if(candidate.id==='physis')opened.push({section:candidate.id,value:await materializeArchivedPhysis(ownerId,data,ports)});
  if(candidate.id==='aurora'&&data.nativeEnvelopes!==undefined){object(data.nativeEnvelopes);const entries=[];
   for(const [kind,value]of Object.entries(data.nativeEnvelopes)){
    const scope=`genesis-aurora-workspace-v1:${ownerId}:`+(kind==='aurora-cache'?'cache':kind.replace(/^aurora-pending/,'pending'));
    entries.push({source:kind,value:await materializeStored(ownerId,scope,value,ports)});
   }opened.push({section:candidate.id,entries});
  }
  if(['mindmaps','diary','aurora','stoicheion'].includes(candidate.id)&&data.frozenStorage!==undefined){
   const frozen=data.frozenStorage,entries=[];
   if(input.client==='android'&&candidate.id==='mindmaps'){
    // GenesisBackupSnapshot stores the already opened native map rows as an
    // array. Numeric indexes are not web storage keys or absent documents.
    if(!Array.isArray(frozen)||frozen.length>10000)invalid();
    for(const row of frozen){object(row);for(const field of ['document','pendingDocument'])if(row[field]!==undefined&&row[field]!==null)object(row[field]);}
    opened.push({section:candidate.id,nativeRecords:structuredClone(frozen)});
   }else if(input.client==='android'&&candidate.id==='diary'){
    object(frozen);if(!Array.isArray(frozen.records)||frozen.records.length>10000||frozen.drafts!==undefined&&!Array.isArray(frozen.drafts))invalid();
    opened.push({section:candidate.id,nativeRecords:structuredClone(frozen)});
   }else{
    object(frozen);
    for(const [key,value]of Object.entries(frozen)){
     const storageKey=input.client==='android'&&candidate.id==='aurora'?`genesis-aurora-workspace-v1:${ownerId}:`+(key==='aurora-cache'?'cache':key.replace(/^aurora-pending/,'pending')):key;
     entries.push({key,value:await materializeStored(ownerId,storageKey,value,ports)});
    }opened.push({section:candidate.id,entries});
   }
  }
 }
 ports.assertCurrent();return{original:input,opened,execution:'history-only'};
}

export async function materializeWebArchiveInventory(ownerId:string,input:unknown,ports:ArchiveContentReaderPorts){
 exactKeys(input,['platform','inventoryVersion','entries','memorySafety','editors']);
 if(input.platform!=='web'||input.inventoryVersion!==1||!Array.isArray(input.entries)||input.entries.length>10000||!Array.isArray(input.editors)||input.editors.length>1000)invalid();
 const histories:{source:string;value:unknown}[]=[],seen=new Set<string>();
 for(const row of input.entries){
  exactKeys(row,['key','value']);string(row.key,1024);if(seen.has(row.key))invalid();seen.add(row.key);
  if(row.value===null||row.key===`genesis-workspace-device-key-v2:${ownerId}`)continue;string(row.value);
  if(row.key===`genesis-data-generation-v1:${ownerId}`){if(!/^\d+$/.test(row.value))invalid();continue;}
  const value=parse(row.value);
  if(row.key===`genesis-backup-history-v1:${ownerId}`){object(value);if(Object.keys(value).some(key=>!['attempt','success'].includes(key)))invalid();for(const at of Object.values(value))time(at);histories.push({source:row.key,value});continue;}
  const safety=row.key.startsWith(`genesis-backup-safety-v1:${ownerId}:`),held=row.key.startsWith(`genesis-backup-held-v1:${ownerId}:`);
  if(!safety&&!held)throw new Error('E2EE_ARCHIVE_FORMAT_UNSUPPORTED');
  exactKeys(value,safety?['createdAt','expiresAt','envelope']:['createdAt','generation','envelope']);time(value.createdAt);integer(safety?value.expiresAt:value.generation);object(value.envelope);
  const packet=value.envelope;if(typeof packet.iv!=='string'||typeof packet.ciphertext!=='string')invalid();
  const raw=await ports.openAccount(ownerId,{iv:packet.iv,ciphertext:packet.ciphertext},safety?'backup-device-safety:v1':'backup-held-state:v1');const decoded=parse(raw);
  let content:unknown;
  if(safety)content=await materializeFrozen(ownerId,decoded,ports);
  else{if(!Array.isArray(decoded)||decoded.length>10000)invalid();const rows=[],names=new Set<string>();
   for(const pair of decoded){if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||names.has(pair[0]))invalid();names.add(pair[0]);
    if(pair[1]!==null&&typeof pair[1]!=='string')invalid();rows.push({key:pair[0],value:pair[1]===null?null:await materializeStored(ownerId,pair[0],parse(pair[1]),ports)});}
   content=rows;
  }
  histories.push({source:row.key,value:{createdAt:value.createdAt,...safety?{expiresAt:value.expiresAt}:{generation:value.generation},content,execution:'history-only'}});
 }
 if(input.memorySafety!==null)histories.push({source:'memory-safety',value:await materializeFrozen(ownerId,input.memorySafety,ports)});
 for(let index=0;index<input.editors.length;index++){
  const editor:unknown=input.editors[index];exactKeys(editor,['source','mounted','settled','state','file']);
  if(editor.source!=='backup-panel'||typeof editor.mounted!=='boolean'||typeof editor.settled!=='boolean'||editor.mounted&&!editor.settled)throw new Error('E2EE_ARCHIVE_OPERATION_IN_PROGRESS');object(editor.state);
  const state=structuredClone(editor.state),plan=state.plan;
  // Recovery input remains only in the protected original. Never copy it beside
  // a portable archive or turn saved UI consent into restore authority.
  delete state.key;delete state.savedKey;delete state.consent;delete state.confirmed;
  if(state.payload!==null&&state.payload!==undefined)state.materializedPayload=await materializeLegacyBackupPayload(ownerId,state.payload,ports);
  if(plan!==null&&plan!==undefined){object(plan);if(!Array.isArray(plan.operations))invalid();state.materializedPlan=await readLegacyArchiveOperations(JSON.stringify(plan.operations),ownerId,ports);}
  if(editor.file!==null){object(editor.file);integer(editor.file.size);string(editor.file.bytes);const bytes=editor.file.size===0?new Uint8Array():decodeE2eeBytes(editor.file.bytes,editor.file.size);bytes.fill(0);}
  histories.push({source:`editor:${index}`,value:{...editor,state,execution:'history-only'}});
 }
 ports.assertCurrent();return histories;
}

/** One category, composed with the existing signed fragment reader and actual
 * local capture. All variants survive as history; no preview/apply/prune route. */
export class PersonalArchivesSource implements PrivatePathAdapter{
 readonly id='personal.archives';#owner:string;#scope:string;#ports:ArchivesSourcePorts;
 constructor(ownerId:string,scopeId:string,ports:ArchivesSourcePorts){assertTechnical(ownerId);assertTechnical(scopeId);this.#owner=ownerId;this.#scope=scopeId;this.#ports=ports;}
 captureLocal(){return this.#ports.captureLocal();}
 #decode(bytes:Uint8Array):Snapshot|PortableArchiveCapture{
  if(bytes.length<1||bytes.length>MAX)invalid();const value=parse(decoder.decode(bytes));object(value);
  if(value.ownerId!==this.#owner||value.scopeId!==this.#scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');time(value.capturedAt);
  if(value.protocol===2){exactKeys(value,['protocol','ownerId','scopeId','capturedAt','generation','platform','histories']);integer(value.generation);
   if(value.platform!=='android'||!Array.isArray(value.histories)||value.histories.length>10000)invalid();for(const row of value.histories){exactKeys(row,['source','value']);string(row.source,1024);}return value as PortableArchiveCapture;}
  exactKeys(value,['protocol','ownerId','scopeId','capturedAt','memory']);if(value.protocol!==1)invalid();object(value.memory);exactKeys(value.memory,['ownerId','generation','reconciliationRequired','legacyKey','local',...(Object.hasOwn(value.memory,'physis')?['physis']:[])]);
  if(value.memory.physis!==undefined&&(!Array.isArray(value.memory.physis)||value.memory.physis.length>1000))invalid();
  if(value.memory.ownerId!==this.#owner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');integer(value.memory.generation);string(value.memory.legacyKey,44);
  if(value.memory.reconciliationRequired!==false)throw new Error('E2EE_ARCHIVE_GENERATION_REVIEW_REQUIRED');return value as Snapshot;
 }
 async reconcile(local:Uint8Array,previous:readonly Uint8Array[],context?:MigrationSourceContext){
  this.#ports.assertCurrent();if(!context||context.ownerId!==this.#owner||context.scopeId!==this.#scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  if(previous.length>32||local.length+previous.reduce((sum,value)=>sum+value.length,0)>E2EE_MIGRATION_BYTE_BUDGET)throw new Error('E2EE_MIGRATION_HISTORY_LIMIT');
  const snapshots=[this.#decode(local),...previous.map(value=>this.#decode(value))],remote=structuredClone(await this.#ports.legacyArchives(context));this.#ports.assertCurrent();
  exactKeys(remote,['protocol','ownerId','scopeId','migrationId','fence','sourceHash','legacyGeneration','checkpointHash','directoryRevision','stages','safety','receipts','legacyKey']);
  if(remote.protocol!==1||remote.ownerId!==this.#owner||remote.scopeId!==this.#scope||remote.migrationId!==context.migrationId||remote.fence!==context.fence||remote.sourceHash!==context.sourceHash)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  integer(remote.legacyGeneration);integer(remote.directoryRevision);decodeE2eeBytes(remote.checkpointHash,32).fill(0);
  if(context.generation<=remote.legacyGeneration||snapshots.some(value=>(value.protocol===1?value.memory.generation:value.generation)!==remote.legacyGeneration))throw new Error('E2EE_ARCHIVE_GENERATION_REVIEW_REQUIRED');
  exactKeys(remote.legacyKey,['keyMode','key']);if(!['account','client','empty'].includes(String(remote.legacyKey.keyMode)))invalid();
  const keys:string[]=[];
  for(const snapshot of snapshots)if(snapshot.protocol===1){if(snapshot.memory.legacyKey)keys.push(snapshot.memory.legacyKey);
   for(const row of snapshot.memory.local.entries)if(row.key===`genesis-workspace-device-key-v2:${this.#owner}`&&row.value!==null){const value=parse(row.value);object(value);string(value.key,44);keys.push(value.key);}}
  if(this.#ports.openAccount){if(keys.length||remote.legacyKey.key!==null)throw new Error('E2EE_KEY_BRIDGE_FORBIDDEN');}
  else if(remote.legacyKey.keyMode==='account'){string(remote.legacyKey.key,44);keys.push(remote.legacyKey.key);}else if(remote.legacyKey.key!==null)invalid();
  const readers:ArchiveContentReaderPorts={assertCurrent:this.#ports.assertCurrent,openAccount:this.#ports.openAccount??await archiveAccountReader(this.#owner,keys,this.#ports.assertCurrent),openPhysis:this.#ports.openPhysis};
  if(!readers.openPhysis&&!this.#ports.openAccount){
   const retained=new Map<number,CryptoKey[]>();let loaded=false;
   const retain=async(version:number,encoded:unknown)=>{integer(version);if(version<1)invalid();const bytes=base64(encoded,32);
    try{const key=await crypto.subtle.importKey('raw',new Uint8Array(bytes),'AES-GCM',false,['decrypt']);this.#ports.assertCurrent();const group=retained.get(version)??[];group.push(key);retained.set(version,group);}finally{bytes.fill(0);}};
   for(const snapshot of snapshots)if(snapshot.protocol===1)for(const candidate of snapshot.memory.physis??[]){object(candidate);object(candidate.state);
    if(candidate.state.ownerId!==this.#owner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');integer(candidate.state.keyVersion);await retain(candidate.state.keyVersion,candidate.state.key);
    if(candidate.state.rotation!==null&&candidate.state.rotation!==undefined){object(candidate.state.rotation);await retain(candidate.state.keyVersion+1,candidate.state.rotation.key);}
   }
   readers.openPhysis=async(ownerId,id,envelope)=>{
    if(ownerId!==this.#owner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');object(envelope);integer(envelope.keyVersion);const version=envelope.keyVersion;
    if(!retained.has(version)&&!loaded){
     loaded=true;if(this.#ports.legacyPhysis){
      const source=await this.#ports.legacyPhysis(context);this.#ports.assertCurrent();object(source);
      if(source.ownerId!==this.#owner||source.scopeId!==this.#scope||source.sourceHash!==context.sourceHash||source.migrationId!==context.migrationId||source.fence!==context.fence||!Array.isArray(source.owners)||source.owners.length>1)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
      if(source.owners.length){const row=source.owners[0];object(row);if(row.vault_json!==null){
       const vault=validateLegacyPhysisVault(parse(row.vault_json));const key=await unlockLegacyPhysisSource(this.#owner,vault,{assertCurrent:this.#ports.assertCurrent,
        accountOpen:async(packet,purpose)=>parse(await readers.openAccount(this.#owner,packet,purpose)),independentUnlock:this.#ports.independentUnlock});retained.set(vault.keyVersion,[...retained.get(vault.keyVersion)??[],key]);
      }}
     }
    }
    const candidates=retained.get(version);if(!candidates?.length)throw new Error('E2EE_ARCHIVE_PHYSIS_UNLOCK_REQUIRED');
    for(const key of candidates){try{return await readLegacyPhysisRecordText(this.#owner,id,version,key,envelope,this.#ports.assertCurrent);}
     catch(error){this.#ports.assertCurrent();if(!(error instanceof Error)||error.message!=='E2EE_LEGACY_PHYSIS_CORRUPT')throw error;}}
    throw new Error('E2EE_LEGACY_PHYSIS_CORRUPT');
   };
  }
  const content:MigrationContent[]=[];let size=0;const index:{objectId:string;source:string}[]=[];
  const add=(source:string,value:unknown)=>{const objectId='personal-archive:'+crypto.randomUUID(),bytes=encoder.encode(JSON.stringify({format:'genesis-private-archive-history-v1',ownerId:this.#owner,execution:'history-only',source,value}));
   size+=bytes.length;if(bytes.length>MAX||size>E2EE_MIGRATION_BYTE_BUDGET||content.length>=9999){bytes.fill(0);throw new Error('E2EE_SOURCE_TOO_LARGE');}content.push({domain:'local-snapshot',objectId,bytes});index.push({objectId,source});};
  try{
   for(let attempt=0;attempt<snapshots.length;attempt++){const snapshot=snapshots[attempt],histories=snapshot.protocol===1?await materializeWebArchiveInventory(this.#owner,snapshot.memory.local,readers):snapshot.histories;
    for(const row of histories)add(`capture:${attempt}:${row.source}`,row.value);}
   const seen=new Set<string>();
   for(const table of ['stages','safety','receipts'] as const){const rows:unknown=remote[table];if(!Array.isArray(rows)||rows.length>50000)invalid();
    for(const row of rows){this.#ports.assertCurrent();exactKeys(row,table==='stages'?['id','payload_hash','generation','revision_hash','payload_enc','created_at','expires_at','payload_json']:
     table==='safety'?['id','snapshot_enc','created_at','expires_at','snapshot_json']:['operation_id','payload_hash','generation','created_at']);
     const identity=table==='receipts'?row.operation_id:row.id;string(identity,256);const source=`server:${table}:${identity}`;if(!identity||seen.has(source))invalid();seen.add(source);time(row.created_at);
     if(table!=='receipts')integer(row.expires_at);if(table!=='safety'){integer(row.generation);string(row.payload_hash,64);if(!/^[a-f0-9]{64}$/.test(row.payload_hash))invalid();}
     const value=table==='stages'?await readLegacyArchiveOperations(row.payload_json,this.#owner,readers):table==='safety'?await readLegacyArchiveTables(row.snapshot_json,this.#owner,readers):null;
     const metadata=Object.fromEntries(Object.entries(row).filter(([name])=>!['payload_enc','snapshot_enc','payload_json','snapshot_json'].includes(name)));add(source,{metadata,content:value,execution:'history-only'});
    }
   }
   const bytes=encoder.encode(JSON.stringify({format:'genesis-private-archive-index-v1',ownerId:this.#owner,execution:'history-only',entries:index}));size+=bytes.length;
   if(size>E2EE_MIGRATION_BYTE_BUDGET){bytes.fill(0);throw new Error('E2EE_SOURCE_TOO_LARGE');}content.push({domain:'local-snapshot',objectId:'personal-archive-index-v1',bytes});
   this.#ports.assertCurrent();return{complete:true,content,localContent:[]};
  }catch(error){content.forEach(row=>row.bytes.fill(0));throw error;}
 }
}
