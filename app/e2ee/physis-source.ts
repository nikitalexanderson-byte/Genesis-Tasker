import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {canonicalJson} from '../aurora/forecast.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {readLegacyPhysisRecord,unlockLegacyPhysisSource,validateLegacyPhysisEnvelope,validateLegacyPhysisVault,
  type PhysisLegacyUnlockPorts} from './physis-legacy.ts';
import {validatePhysisRecord} from '../physis/validation.ts';
import type {PhysisVault,PhysisEnvelope} from '../physis/crypto.ts';
import type {PhysisMigrationStoreMemory} from '../physis/store.ts';
import {E2EE_MIGRATION_BYTE_BUDGET,type MigrationContent,type MigrationSourceContext} from './migration.ts';
import type {PrivatePathAdapter} from './migration-sources.ts';

type Row=Record<string,unknown>;
export type PhysisMigrationMemory={ownerId:string;generation:number;reconciliationRequired:boolean;legacyKey:string;
 stores:{vault:PhysisVault;state:PhysisMigrationStoreMemory}[]};
export type PhysisMigrationVariant={source:string;record:Row|null;revision:number;deleted:boolean};
export type PhysisMigrationConflict={id:string;variants:readonly PhysisMigrationVariant[]};
export type PhysisSourcePorts={memory:()=>Promise<PhysisMigrationMemory>;assertCurrent:()=>void;
 legacyPhysis:(context:MigrationSourceContext)=>Promise<unknown>;
 independentUnlock?:PhysisLegacyUnlockPorts['independentUnlock'];
 /** Native keeps its old keys outside JavaScript. Each capability is restricted
  * to the exact validated captured vault and envelopes, never a general oracle. */
 openVault?:(vault:PhysisVault)=>Promise<(id:string,envelope:PhysisEnvelope)=>Promise<unknown>>;
 review?:(conflicts:readonly PhysisMigrationConflict[])=>Promise<Record<string,string>>};
type Snapshot={protocol:1;ownerId:string;scopeId:string;capturedAt:string;memory:PhysisMigrationMemory};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),MAX=48*1024*1024,RECORD_MAX=256*1024-16;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function invalid():never{throw new Error('E2EE_PHYSIS_SOURCE_INVALID');}
function object(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function integer(value:unknown,min=0):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>=Number.MAX_SAFE_INTEGER)invalid();}
function text(value:unknown,max=MAX):asserts value is string{if(typeof value!=='string'||value.length>max)invalid();}
function id(value:unknown):asserts value is string{if(typeof value!=='string'||!UUID.test(value))invalid();}
function time(value:unknown):asserts value is string{text(value,64);if(!Number.isFinite(Date.parse(value)))invalid();}
function list(value:unknown,max=10000):asserts value is unknown[]{if(!Array.isArray(value)||value.length>max)invalid();}
function unique<T>(values:readonly T[],identity:(row:T)=>string){if(new Set(values.map(identity)).size!==values.length)invalid();}
function base64(value:unknown,length:number):Uint8Array<ArrayBuffer>{text(value,4*Math.ceil(length/3));let raw:string;
 try{raw=atob(value);}catch{return invalid();}if(raw.length!==length||btoa(raw)!==value)invalid();return Uint8Array.from(raw,char=>char.charCodeAt(0));}
export function parsePhysisMigrationJson(value:unknown,maximum=MAX):unknown{return parseLegacyMigrationJson(value,'E2EE_PHYSIS_SOURCE_INVALID',maximum);}
function record(value:unknown,identity?:string):Row{
 object(value);if(!validatePhysisRecord(value)||identity!==undefined&&value.id!==identity||encoder.encode(JSON.stringify(value)).length>RECORD_MAX)invalid();
 // The product validator checks supported records; preserve every original field.
 return structuredClone(value);
}
function wire(value:unknown,keyVersion:number):Row{
 exactKeys(value,['id','revision','sequence','updatedAt','deletedAt','envelope']);id(value.id);integer(value.revision,1);integer(value.sequence,1);time(value.updatedAt);
 if(value.deletedAt===null)validateLegacyPhysisEnvelope(value.envelope,keyVersion);
 else{time(value.deletedAt);if(value.envelope!==null)invalid();}return value;
}
function result(value:unknown):Row{exactKeys(value,['revision','cursor','keyVersion']);integer(value.revision,1);integer(value.cursor);integer(value.keyVersion,1);return value;}
function acknowledgement(value:unknown):Row{
 exactKeys(value,['id','revision','sequence','updatedAt','deletedAt']);id(value.id);integer(value.revision,1);integer(value.sequence,1);time(value.updatedAt);
 if(value.deletedAt!==null)time(value.deletedAt);return value;
}
function receiptResponse(value:unknown):Row{
 object(value);if(Object.hasOwn(value,'records')){exactKeys(value,['records','cursor']);list(value.records,100);integer(value.cursor);value.records.forEach(acknowledgement);unique(value.records,row=>(row as Row).id as string);}
 else if(Object.hasOwn(value,'keyVersion'))result(value);
 else{exactKeys(value,['revision']);integer(value.revision,1);}return value;
}

/** Read-only full retained Physis source. Old keys live only in the protected
 * input journal. The output contains newly encrypted content and inert recovery
 * history; no bootstrap, old request replay, receipt acknowledgement or pruning. */
export class PersonalPhysisSource implements PrivatePathAdapter{
 readonly id='personal.physis';#owner:string;#scope:string;#ports:PhysisSourcePorts;
 constructor(ownerId:string,scopeId:string,ports:PhysisSourcePorts){assertTechnical(ownerId);assertTechnical(scopeId);this.#owner=ownerId;this.#scope=scopeId;this.#ports=ports;}
 async captureLocal():Promise<Uint8Array>{
  this.#ports.assertCurrent();const memory=await this.#ports.memory();this.#ports.assertCurrent();
  if(memory.ownerId!==this.#owner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  const bytes=encoder.encode(JSON.stringify({protocol:1,ownerId:this.#owner,scopeId:this.#scope,capturedAt:new Date().toISOString(),memory}));
  if(bytes.length>MAX){bytes.fill(0);throw new Error('E2EE_SNAPSHOT_TOO_LARGE');}return bytes;
 }
 #decode(bytes:Uint8Array):Snapshot{
  if(bytes.length<1||bytes.length>MAX)invalid();const value=parsePhysisMigrationJson(decoder.decode(bytes));exactKeys(value,['protocol','ownerId','scopeId','capturedAt','memory']);
  if(value.protocol!==1||value.ownerId!==this.#owner||value.scopeId!==this.#scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');time(value.capturedAt);
  exactKeys(value.memory,['ownerId','generation','reconciliationRequired','legacyKey','stores']);const memory=value.memory;
  if(memory.ownerId!==this.#owner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');integer(memory.generation);text(memory.legacyKey,44);
  if(typeof memory.reconciliationRequired!=='boolean')invalid();if(memory.reconciliationRequired)throw new Error('E2EE_PHYSIS_GENERATION_REVIEW_REQUIRED');list(memory.stores,32);
  if(memory.legacyKey)base64(memory.legacyKey,32).fill(0);return value as Snapshot;
 }
 async reconcile(local:Uint8Array,previous:readonly Uint8Array[],context?:MigrationSourceContext){
  this.#ports.assertCurrent();if(!context||context.ownerId!==this.#owner||context.scopeId!==this.#scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  if(previous.length>32||local.length+previous.reduce((size,bytes)=>size+bytes.length,0)>E2EE_MIGRATION_BYTE_BUDGET)throw new Error('E2EE_MIGRATION_HISTORY_LIMIT');
  const snapshot=this.#decode(local),stable=(value:Snapshot)=>({...value,capturedAt:''});
  for(const old of previous)if(canonicalJson(stable(this.#decode(old)))!==canonicalJson(stable(snapshot)))throw new Error('E2EE_PHYSIS_HISTORY_REVIEW_REQUIRED');
  const remote=structuredClone(await this.#ports.legacyPhysis(context));this.#ports.assertCurrent();
  exactKeys(remote,['protocol','ownerId','scopeId','migrationId','fence','sourceHash','legacyGeneration','checkpointHash','directoryRevision','owners','records','usedIds','receipts','legacyKey']);
  if(remote.protocol!==1||remote.ownerId!==this.#owner||remote.scopeId!==this.#scope||remote.migrationId!==context.migrationId||remote.fence!==context.fence||remote.sourceHash!==context.sourceHash)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  integer(remote.legacyGeneration);integer(remote.directoryRevision,1);decodeE2eeBytes(remote.checkpointHash,32).fill(0);
  if(remote.legacyGeneration!==snapshot.memory.generation||context.generation<=remote.legacyGeneration)throw new Error('E2EE_PHYSIS_GENERATION_REVIEW_REQUIRED');
  for(const name of ['owners','records','usedIds','receipts'])list(remote[name],1000000);
  if((remote.owners as unknown[]).length>1||encoder.encode(JSON.stringify(remote)).length>E2EE_MIGRATION_BYTE_BUDGET)throw new Error('E2EE_SOURCE_TOO_LARGE');
  exactKeys(remote.legacyKey,['keyMode','key']);if(!['account','client','empty'].includes(String(remote.legacyKey.keyMode)))invalid();
  if(remote.legacyKey.keyMode==='account'){if(remote.legacyKey.key!==null)base64(remote.legacyKey.key,32).fill(0);else if(!this.#ports.openVault)invalid();}
  else if(remote.legacyKey.key!==null)invalid();
  const owner=(remote.owners as Row[])[0];let vault:PhysisVault|null=null;
  if(owner){exactKeys(owner,['current_cursor','min_cursor','vault_json','vault_revision','key_version']);for(const name of ['current_cursor','min_cursor','vault_revision','key_version'])integer(owner[name]);
   if((owner.min_cursor as number)>(owner.current_cursor as number))invalid();
   if(owner.vault_json===null){if(owner.vault_revision!==0||owner.key_version!==0)invalid();}
   else{vault=validateLegacyPhysisVault(parsePhysisMigrationJson(owner.vault_json,8192));if(vault.keyVersion!==owner.key_version||owner.vault_revision===0)invalid();}
  }
  if(!owner&&(['records','usedIds','receipts'] as const).some(name=>(remote[name] as unknown[]).length)||!vault&&(['records','usedIds','receipts'] as const).some(name=>(remote[name] as unknown[]).length))invalid();
  const used=new Set<string>();for(const row of remote.usedIds as Row[]){exactKeys(row,['id']);id(row.id);if(used.has(row.id))invalid();used.add(row.id);}
  const receipts=new Map<string,{raw:Row;response:Row}>();
  for(const row of remote.receipts as Row[]){exactKeys(row,['request_id','payload_hash','response_json','created_at']);id(row.request_id);time(row.created_at);
   if(typeof row.payload_hash!=='string'||!/^[a-f0-9]{64}$/.test(row.payload_hash)||receipts.has(row.request_id))invalid();
   const response=receiptResponse(parsePhysisMigrationJson(row.response_json));if(response.cursor!==undefined&&owner&&(response.cursor as number)>(owner.current_cursor as number))invalid();
   receipts.set(row.request_id,{raw:row,response});
  }
  const content:MigrationContent[]=[],localContent:MigrationContent[]=[],groups=new Map<string,PhysisMigrationVariant[]>(),history:Row[]=[];
  const retained=new Map<string,CryptoKey>(),retainedValues=new Map<string,string>(),accountKeys:CryptoKey[]=[],stores:Row[]=[];let size=0,complete=false;
  const output=(placement:'remote'|'local',objectId:string,value:unknown)=>{
   const bytes=encoder.encode(JSON.stringify(value));size+=bytes.length;if(bytes.length>64*1024*1024||size>E2EE_MIGRATION_BYTE_BUDGET||content.length+localContent.length>=10000){bytes.fill(0);throw new Error('E2EE_SOURCE_TOO_LARGE');}
   (placement==='remote'?content:localContent).push({domain:'physis',objectId,bytes});
  };
  const add=(identity:string,variant:PhysisMigrationVariant)=>{id(identity);const values=groups.get(identity)??[];if(values.some(value=>value.source===variant.source))invalid();values.push(variant);groups.set(identity,values);};
  const importKey=async(value:unknown)=>{const bytes=base64(value,32);try{const key=await crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['decrypt']);this.#ports.assertCurrent();return key;}finally{bytes.fill(0);}};
  const retain=(vault:PhysisVault,value:string,key:CryptoKey)=>{const identity=canonicalJson(vault);
   if(retainedValues.has(identity)&&retainedValues.get(identity)!==value)invalid();retainedValues.set(identity,value);retained.set(identity,key);};
  const openWith=async(key:CryptoKey,identity:string,keyVersion:number,envelope:unknown)=>record(await readLegacyPhysisRecord(this.#owner,identity,keyVersion,key,envelope,this.#ports.assertCurrent),identity);
  const checkReceipt=async(operation:string,request:Row)=>{
   const known=receipts.get(request.requestId as string);if(!known)return null;
   const bytes=encoder.encode(operation+'\0'+canonicalJson(request));let hash:string;
   try{hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}finally{bytes.fill(0);}
   this.#ports.assertCurrent();if(hash!==known.raw.payload_hash)throw new Error('E2EE_PHYSIS_RECEIPT_CONFLICT');return known.response;
  };
  try{
   if(snapshot.memory.legacyKey)accountKeys.push(await importKey(snapshot.memory.legacyKey));
   if(typeof remote.legacyKey.key==='string')accountKeys.push(await importKey(remote.legacyKey.key));
   for(const [index,input]of snapshot.memory.stores.entries()){
    exactKeys(input,['vault','state']);const savedVault=validateLegacyPhysisVault(input.vault),state=input.state;
    exactKeys(state,['ownerId','keyVersion','key','cursor','localGeneration','reloadGeneration','records','pending','confirmed','status','error','editors','rotation']);
    if(state.ownerId!==this.#owner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');integer(state.keyVersion,1);if(savedVault.keyVersion!==state.keyVersion)invalid();
    for(const name of ['cursor','localGeneration','reloadGeneration'] as const)integer(state[name]);text(state.error,4096);
    if(!['saved','saving','offline','error','conflict'].includes(state.status))invalid();
    if(state.status==='saving')throw new Error('E2EE_PHYSIS_OPERATION_PENDING');
    list(state.records);list(state.pending);list(state.confirmed);list(state.editors);
    const key=await importKey(state.key);retain(savedVault,state.key,key);
    const confirmed=new Map<string,{wire:Row;record:Row|null}>();
    for(const raw of state.confirmed){const row=wire(raw,state.keyVersion);if(confirmed.has(row.id as string)||(row.sequence as number)>state.cursor)invalid();
     const decoded=row.deletedAt===null?await openWith(key,row.id as string,state.keyVersion,row.envelope):null;confirmed.set(row.id as string,{wire:row,record:decoded});
    }
    unique([...confirmed.values()],row=>String(row.wire.sequence));
    unique(state.records,row=>record(row).id as string);unique(state.pending,row=>row.requestId);const dirty=new Set<string>(),pending:Row[]=[];
    for(const item of state.pending){object(item);const fields=['requestId','records','deletes'];if(Object.hasOwn(item,'changes'))fields.push('changes');exactKeys(item,fields);
     id(item.requestId);list(item.records,100);list(item.deletes,100);if(item.records.length+item.deletes.length<1||item.records.length+item.deletes.length>100)invalid();
     const submitted=new Map(item.records.map(value=>{const row=record(value);return[row.id as string,row] as const;}));unique(item.records,value=>(value as Row).id as string);
     unique(item.deletes,value=>{id(value);return value;});for(const identity of item.deletes){id(identity);if(submitted.has(identity))invalid();dirty.add(identity);}for(const identity of submitted.keys())dirty.add(identity);
     const decoded:Row[]=[];
     if(item.changes!==undefined){list(item.changes,100);if(item.changes.length!==item.records.length+item.deletes.length)invalid();unique(item.changes,value=>{object(value);id(value.id);return value.id;});
      for(const change of item.changes){object(change);const deletion=change.operation==='delete';exactKeys(change,deletion?['id','operation','expectedRevision']:['id','operation','expectedRevision','envelope']);
       id(change.id);integer(change.expectedRevision);if(!['create','update','delete'].includes(String(change.operation))||change.operation==='create'&&change.expectedRevision!==0||change.operation!=='create'&&change.expectedRevision===0)invalid();
       if(deletion){if(!item.deletes.includes(change.id))invalid();decoded.push({id:change.id,record:null});}
       else{if(!submitted.has(change.id))invalid();const value=await openWith(key,change.id,state.keyVersion,change.envelope);if(canonicalJson(value)!==canonicalJson(submitted.get(change.id)!))invalid();decoded.push({id:change.id,record:value});}
      }
      const known=await checkReceipt('records',{requestId:item.requestId,changes:item.changes});
      if(known){if(!Array.isArray(known.records)||known.records.length!==item.changes.length)invalid();
       for(const raw of known.records){const ack=acknowledgement(raw),change=(item.changes as Row[]).find(row=>row.id===ack.id);if(!change||ack.revision!==(change.expectedRevision as number)+1||(change.operation==='delete')!==(ack.deletedAt!==null))invalid();}
      }
     }
     pending.push({...item,decoded,execution:'history-only'});
    }
    const editors:Row[]=[];for(const editor of state.editors){exactKeys(editor,['id','mounted','value']);id(editor.id);if(typeof editor.mounted!=='boolean')invalid();editors.push(structuredClone(editor));}unique(editors,row=>row.id as string);
    let rotation:Row|null=null;
    if(state.rotation!==null){const candidate=state.rotation;exactKeys(candidate,['key','vaultText','expectedRevision','payload','result','uncertain']);integer(candidate.expectedRevision,1);
     if(state.pending.length||typeof candidate.uncertain!=='boolean')invalid();const nextVault=validateLegacyPhysisVault(parsePhysisMigrationJson(candidate.vaultText,8192));
     if(nextVault.keyVersion!==state.keyVersion+1)invalid();const next=await importKey(candidate.key);retain(nextVault,candidate.key,next);
     const decoded:Row[]=[];
     if(candidate.payload!==null){const request=parsePhysisMigrationJson(candidate.payload);exactKeys(request,['requestId','expectedRevision','expectedCursor','vault','records']);id(request.requestId);
      if(request.expectedRevision!==candidate.expectedRevision||request.expectedCursor!==state.cursor||canonicalJson(request.vault)!==canonicalJson(nextVault))invalid();list(request.records);
      const live=[...confirmed].filter(([,value])=>value.wire.deletedAt===null);if(request.records.length!==live.length)invalid();unique(request.records,value=>{object(value);id(value.id);return value.id;});
      for(const raw of request.records){exactKeys(raw,['id','expectedRevision','envelope']);id(raw.id);const known=confirmed.get(raw.id);
       if(!known||known.wire.deletedAt!==null||raw.expectedRevision!==known.wire.revision)invalid();const value=await openWith(next,raw.id,nextVault.keyVersion,raw.envelope);
       if(canonicalJson(value)!==canonicalJson(known.record!))invalid();decoded.push({id:raw.id,record:value});
      }
      const known=await checkReceipt('rotate',request);
      if(known){result(known);if(known.revision!==candidate.expectedRevision+1||known.keyVersion!==nextVault.keyVersion||known.cursor!==state.cursor+live.length+1)invalid();}
      if(candidate.result!==null){const accepted=result(candidate.result);if(accepted.revision!==candidate.expectedRevision+1||accepted.keyVersion!==nextVault.keyVersion||accepted.cursor!==state.cursor+live.length+1||known&&canonicalJson(known)!==canonicalJson(accepted))invalid();}
     }else if(candidate.result!==null||candidate.uncertain)invalid();
     // Strip the old next DEK before any migration output is constructed.
     rotation={vaultText:candidate.vaultText,expectedRevision:candidate.expectedRevision,payload:candidate.payload,result:candidate.result,uncertain:candidate.uncertain,decoded,execution:'history-only'};
    }
    const current=new Map<string,Row>();for(const raw of state.records){const row=record(raw);current.set(row.id as string,row);}
    for(const [identity,value]of confirmed){if(dirty.has(identity))continue;const present=current.get(identity);
     if(value.record===null?present!==undefined:!present||canonicalJson(present)!==canonicalJson(value.record))invalid();}
    for(const identity of current.keys())if(!confirmed.has(identity)&&!dirty.has(identity))invalid();
    stores.push({source:`store:${index}`,vault:savedVault,keyVersion:state.keyVersion,cursor:state.cursor,localGeneration:state.localGeneration,reloadGeneration:state.reloadGeneration,
     status:state.status,error:state.error,records:state.records,confirmed:[...confirmed.values()],pending,editors,rotation,execution:'history-only'});
    for(const [identity,value]of confirmed)history.push({id:identity,source:`store:${index}:confirmed`,record:value.record,revision:value.wire.revision,deleted:value.record===null});
    for(const identity of dirty){const value=current.get(identity)??null,revision=(confirmed.get(identity)?.wire.revision as number|undefined)??0;
     add(identity,{source:`store:${index}:current`,record:value,revision,deleted:value===null});}
   }
   let open:((identity:string,envelope:PhysisEnvelope)=>Promise<unknown>)|null=null;
   if(vault){
    if(this.#ports.openVault){open=await this.#ports.openVault(vault);if(typeof open!=='function')invalid();}
    else{
     let key=retained.get(canonicalJson(vault));
     if(!key)key=await unlockLegacyPhysisSource(this.#owner,vault,{assertCurrent:this.#ports.assertCurrent,independentUnlock:this.#ports.independentUnlock,
      accountOpen:async(envelope,purpose)=>{const iv=base64(envelope.iv,12),cipher=base64(envelope.ciphertext,62);let plain:Uint8Array|undefined;
       try{for(const key of accountKeys){try{plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:encoder.encode(`genesis-mindmap-v1:${this.#owner}:${purpose}`)},key,cipher));break;}catch{/* Only retained account keys. */}}
        if(!plain)throw new Error('E2EE_PHYSIS_UNLOCK_REQUIRED');return parsePhysisMigrationJson(decoder.decode(plain),1024);
       }finally{iv.fill(0);cipher.fill(0);plain?.fill(0);}
      }});
     const captured=key,version=vault.keyVersion;open=(identity,envelope)=>openWith(captured,identity,version,envelope);
    }
    this.#ports.assertCurrent();
   }
   const serverIds=new Set<string>(),sequences=new Set<number>();
   for(const raw of remote.records as Row[]){exactKeys(raw,['id','revision','sequence','envelope_json','updated_at','deleted_at']);
    const row=wire({id:raw.id,revision:raw.revision,sequence:raw.sequence,updatedAt:raw.updated_at,deletedAt:raw.deleted_at,
     envelope:raw.envelope_json===null?null:parsePhysisMigrationJson(raw.envelope_json,400000)},vault!.keyVersion);
    const identity=row.id as string;if(serverIds.has(identity)||sequences.has(row.sequence as number)||!used.has(identity)||(row.sequence as number)>(owner!.current_cursor as number))invalid();
    serverIds.add(identity);sequences.add(row.sequence as number);
    let value:Row|null=null;if(row.deletedAt===null){const opened=await open!(identity,row.envelope as PhysisEnvelope);
     value=record(typeof opened==='string'?parsePhysisMigrationJson(opened,RECORD_MAX):opened,identity);}this.#ports.assertCurrent();
    add(identity,{source:'server',record:value,revision:row.revision as number,deleted:value===null});
   }
   for(const identity of used)if(!serverIds.has(identity)){
    // The ordinary retention path advances min_cursor in the same transaction
    // that removes tombstones. Missing content without that witness is corrupt,
    // not evidence that a record was deliberately deleted.
    if(!owner||owner.min_cursor===0)invalid();
    add(identity,{source:'server-pruned-deletion',record:null,revision:0,deleted:true});
   }
   for(const entry of history){const identity=entry.id as string,values=groups.get(identity)??[],server=values.find(row=>row.source.startsWith('server'));
    if(server&&!server.deleted&&(entry.revision as number)>=server.revision&&canonicalJson(entry.record)!==canonicalJson(server.record))add(identity,entry as PhysisMigrationVariant);
    else if(!server)add(identity,entry as PhysisMigrationVariant);
   }
   for(const values of groups.values())if(!values.some(row=>row.source.startsWith('server')))values.unshift({source:'server-absence',record:null,revision:0,deleted:true});
   const conflicts:PhysisMigrationConflict[]=[],selected=new Map<string,PhysisMigrationVariant>();
   const meaning=(value:PhysisMigrationVariant)=>canonicalJson({record:value.record,deleted:value.deleted});
   for(const [identity,values]of groups){const server=values.find(row=>row.source.startsWith('server'))!;
    if(values.every(value=>meaning(value)===meaning(server)))selected.set(identity,server);else conflicts.push({id:identity,variants:values});}
   if(conflicts.length){if(!this.#ports.review)throw new Error('E2EE_PHYSIS_CONFLICT_REVIEW_REQUIRED');
    const choices=await this.#ports.review(structuredClone(conflicts));this.#ports.assertCurrent();object(choices);
    if(Object.keys(choices).length!==conflicts.length)throw new Error('E2EE_PHYSIS_CONFLICT_REVIEW_REQUIRED');
    for(const conflict of conflicts){const chosen=conflict.variants.find(value=>value.source===choices[conflict.id]);if(!chosen)throw new Error('E2EE_PHYSIS_CONFLICT_REVIEW_REQUIRED');selected.set(conflict.id,chosen);}
   }
   const index:Row[]=[];for(const [identity,chosen]of [...selected].sort(([a],[b])=>a.localeCompare(b))){const objectId='personal-physis-record:'+crypto.randomUUID();
    index.push({id:identity,objectId,deleted:chosen.deleted});output('remote',objectId,{protocol:1,ownerId:this.#owner,id:identity,record:chosen.record,revision:chosen.revision,deleted:chosen.deleted});}
   output('remote','personal-physis-index-v1',{protocol:1,ownerId:this.#owner,records:index});
   output('remote','personal-physis-metadata-v1',{protocol:1,ownerId:this.#owner,currentCursor:owner?.current_cursor??0,minCursor:owner?.min_cursor??0,
    vaultRevision:owner?.vault_revision??0,keyVersion:owner?.key_version??0,usedIds:[...used],execution:'history-only'});
   output('local','personal-physis-local-history-v1',{protocol:1,ownerId:this.#owner,stores,confirmedHistory:history,variants:[...groups].map(([id,variants])=>({id,variants})),
    server:{owners:remote.owners,records:remote.records,usedIds:remote.usedIds,receipts:remote.receipts},execution:'history-only'});
   this.#ports.assertCurrent();complete=true;return{complete:true,content,localContent};
  }finally{retained.clear();retainedValues.clear();accountKeys.length=0;if(!complete)[...content,...localContent].forEach(row=>row.bytes.fill(0));}
 }
}

/** Acceptance/product readback uses the exact new-root records. Legacy keys,
 * vault methods and network mutation endpoints are not part of this interface. */
export async function readMigratedPhysis(readRemote:(domain:'physis',objectId:string)=>Promise<unknown>,readLocal:(domain:'physis',objectId:string)=>Promise<Uint8Array|null>,ownerId:string){
 assertTechnical(ownerId);const index=await readRemote('physis','personal-physis-index-v1');exactKeys(index,['protocol','ownerId','records']);
 if(index.protocol!==1||index.ownerId!==ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');list(index.records);const records:Row[]=[],seen=new Set<string>(),objects=new Set<string>();
 for(const entry of index.records){exactKeys(entry,['id','objectId','deleted']);id(entry.id);text(entry.objectId,80);
  if(!/^personal-physis-record:[a-f0-9-]{36}$/.test(entry.objectId)||seen.has(entry.id)||objects.has(entry.objectId)||typeof entry.deleted!=='boolean')invalid();seen.add(entry.id);objects.add(entry.objectId);
  const value=await readRemote('physis',entry.objectId);exactKeys(value,['protocol','ownerId','id','record','revision','deleted']);integer(value.revision);
  if(value.protocol!==1||value.ownerId!==ownerId||value.id!==entry.id||value.deleted!==entry.deleted)invalid();if(value.deleted){if(value.record!==null)invalid();}else record(value.record,entry.id);records.push(value);
 }
 const bytes=await readLocal('physis','personal-physis-local-history-v1');if(!bytes)throw new Error('E2EE_PHYSIS_LOCAL_CONTENT_REQUIRED');
 try{const local=parsePhysisMigrationJson(decoder.decode(bytes),64*1024*1024);exactKeys(local,['protocol','ownerId','stores','confirmedHistory','variants','server','execution']);
  if(local.protocol!==1||local.ownerId!==ownerId||local.execution!=='history-only')invalid();return{records,local};
 }finally{bytes.fill(0);}
}
