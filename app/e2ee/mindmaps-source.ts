import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {canonicalJson} from '../aurora/forecast.ts';
import {validateMindmap} from '../mindmaps-model.ts';
import {E2EE_MIGRATION_BYTE_BUDGET,type MigrationContent,type MigrationSourceContext} from './migration.ts';
import type {PrivatePathAdapter} from './migration-sources.ts';

type Row=Record<string,unknown>;
export type MindmapsMigrationMemory={ownerId:string;legacyKey:string;generation:number;reconciliationRequired:boolean;records:unknown[];editors:unknown[];localWork:unknown[]};
export type MindmapsMigrationVariant={source:string;document:Row|null;revision:number;deleted:boolean};
export type MindmapsMigrationConflict={id:string;variants:readonly MindmapsMigrationVariant[]};
export type MindmapsSourcePorts={storage:Pick<Storage,'getItem'|'key'|'length'>;memory:()=>MindmapsMigrationMemory;assertCurrent:()=>void;
 legacyMindmaps:(context:MigrationSourceContext)=>Promise<unknown>;openLegacy?:(envelope:{iv:string;ciphertext:string},purpose:string)=>Promise<unknown>;
 review?:(conflicts:readonly MindmapsMigrationConflict[])=>Promise<Record<string,string>>};
type Snapshot={protocol:1;ownerId:string;scopeId:string;capturedAt:string;entries:{key:string;value:string|null}[];memory:MindmapsMigrationMemory};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),MAX=16*1024*1024;
function invalid():never{throw new Error('E2EE_MINDMAPS_SOURCE_INVALID');}
function object(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function allowed(value:unknown,keys:readonly string[]):asserts value is Row{object(value);if(Object.keys(value).some(key=>!keys.includes(key)))throw new Error('E2EE_MINDMAPS_FORMAT_UNSUPPORTED');}
function integer(value:unknown,min=0):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>=Number.MAX_SAFE_INTEGER)invalid();}
function text(value:unknown,max=MAX):asserts value is string{if(typeof value!=='string'||value.length>max)invalid();}
function id(value:unknown):asserts value is string{if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value))invalid();}
function time(value:unknown):asserts value is string{text(value,64);if(!Number.isFinite(Date.parse(value)))invalid();}
function list(value:unknown,max=1000000):asserts value is unknown[]{if(!Array.isArray(value)||value.length>max)invalid();}
export function parseMindmapsMigrationJson(value:unknown):unknown{return parseLegacyMigrationJson(value,'E2EE_MINDMAPS_SOURCE_INVALID',MAX);}
/** Validation is not normalization: preserve optional empty arrays, flags and
 * text exactly. Unknown formats refuse rather than silently projecting fields. */
function document(value:unknown,draft=false):Row{
 allowed(value,['schemaVersion','id','title','description','projectId','pinned','archived','nodes','links','appearance']);
 if(value.schemaVersion!==1)throw new Error('E2EE_MINDMAPS_FORMAT_UNSUPPORTED');list(value.nodes,1000);list(value.links,2000);
 for(const node of value.nodes){allowed(node,['id','parentId','kind','text','refId','occurrenceDate','note','tags','style','presentation']);
  if(node.style!==undefined)allowed(node.style,['fill','border']);if(node.presentation!==undefined){allowed(node.presentation,['icon','align','width','layout','showNote','image']);if(node.presentation.image!==undefined)allowed(node.presentation.image,['data','alt','fit']);}
 }
 for(const link of value.links)allowed(link,['id','from','to','label','color']);if(value.appearance!==undefined)allowed(value.appearance,['lineColor']);
 try{validateMindmap(draft&&typeof value.title==='string'&&!value.title.trim()?{...value,title:'draft'}:value);}catch{invalid();}
 if(encoder.encode(JSON.stringify(value)).length>2000000)invalid();return structuredClone(value);
}
function base64(value:unknown,min:number,max=min):Uint8Array{
 text(value,Math.ceil(max/3)*4);if(value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))invalid();let bytes:Uint8Array;
 try{bytes=Uint8Array.from(atob(value),char=>char.charCodeAt(0));}catch{return invalid();}
 if(bytes.length<min||bytes.length>max||btoa(atob(value.slice(-4)))!==value.slice(-4)){bytes.fill(0);invalid();}return bytes;
}
function envelope(value:unknown,pending=false):asserts value is Row{
 allowed(value,pending?['schemaVersion','expectedRevision','operationId','iv','ciphertext']:['id','schemaVersion','revision','iv','ciphertext','updatedAt']);
 if(value.schemaVersion!==1&&value.schemaVersion!==2)throw new Error('E2EE_MINDMAPS_FORMAT_UNSUPPORTED');base64(value.iv,12).fill(0);base64(value.ciphertext,16,2100000).fill(0);
 if(pending){integer(value.expectedRevision);id(value.operationId);}else{id(value.id);integer(value.revision,1);time(value.updatedAt);}
}

/** Every owner cache/request/draft/view/conversion slot, plus mounted editors.
 * Pending requests/conversions are history, never executable provider commands. */
export class PersonalMindmapsSource implements PrivatePathAdapter{
 readonly id='personal.mindmaps';#owner:string;#scope:string;#ports:MindmapsSourcePorts;
 constructor(ownerId:string,scopeId:string,ports:MindmapsSourcePorts){assertTechnical(ownerId);assertTechnical(scopeId);this.#owner=ownerId;this.#scope=scopeId;this.#ports=ports;}
 #prefix(){return`genesis-mindmaps:${this.#owner}:`;}
 async captureLocal():Promise<Uint8Array>{
  this.#ports.assertCurrent();const keys=new Set([this.#prefix()+'cache']);for(let index=0;index<this.#ports.storage.length;index++){const key=this.#ports.storage.key(index);if(key?.startsWith(this.#prefix()))keys.add(key);}
  if(keys.size>10001)throw new Error('E2EE_SNAPSHOT_TOO_LARGE');
  const value:Snapshot={protocol:1,ownerId:this.#owner,scopeId:this.#scope,capturedAt:new Date().toISOString(),entries:[...keys].sort().map(key=>({key,value:this.#ports.storage.getItem(key)})),memory:this.#ports.memory()};
  if(value.memory.ownerId!==this.#owner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');const bytes=encoder.encode(JSON.stringify(value));this.#ports.assertCurrent();if(bytes.length>MAX){bytes.fill(0);throw new Error('E2EE_SNAPSHOT_TOO_LARGE');}return bytes;
 }
 #decode(bytes:Uint8Array):Snapshot{
  if(bytes.length<1||bytes.length>MAX)invalid();const value=parseMindmapsMigrationJson(decoder.decode(bytes));exactKeys(value,['protocol','ownerId','scopeId','capturedAt','entries','memory']);
  if(value.protocol!==1||value.ownerId!==this.#owner||value.scopeId!==this.#scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');time(value.capturedAt);list(value.entries,10001);const seen=new Set<string>();
  for(const row of value.entries){exactKeys(row,['key','value']);text(row.key,1024);if(!row.key.startsWith(this.#prefix())||seen.has(row.key)||row.value!==null&&typeof row.value!=='string')invalid();seen.add(row.key);
   const suffix=row.key.slice(this.#prefix().length);if(suffix!=='cache'&&!/^(?:draft|request):[^:]{1,100}:[a-zA-Z0-9_-]{1,100}$/.test(suffix)&&!/^view:[a-zA-Z0-9_-]{1,100}$/.test(suffix)&&!/^conversion:[a-zA-Z0-9_-]{1,100}:[a-zA-Z0-9_-]{1,100}$/.test(suffix))throw new Error('E2EE_MINDMAPS_FORMAT_UNSUPPORTED');
  }
  if(!seen.has(this.#prefix()+'cache'))invalid();exactKeys(value.memory,['ownerId','legacyKey','generation','reconciliationRequired','records','editors','localWork']);
  const memory=value.memory;if(memory.ownerId!==this.#owner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');text(memory.legacyKey,44);integer(memory.generation);if(typeof memory.reconciliationRequired!=='boolean')invalid();
  if(memory.reconciliationRequired)throw new Error('E2EE_MINDMAPS_GENERATION_REVIEW_REQUIRED');list(memory.records,10000);list(memory.editors,10000);list(memory.localWork,10000);return value as Snapshot;
 }
 async reconcile(local:Uint8Array,previous:readonly Uint8Array[],context?:MigrationSourceContext){
  this.#ports.assertCurrent();if(!context||context.ownerId!==this.#owner||context.scopeId!==this.#scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  if(previous.length>32||local.length+previous.reduce((size,bytes)=>size+bytes.length,0)>E2EE_MIGRATION_BYTE_BUDGET)throw new Error('E2EE_MIGRATION_HISTORY_LIMIT');
  const snapshot=this.#decode(local),stable=(value:Snapshot)=>({...value,capturedAt:''});
  for(const old of previous)if(canonicalJson(stable(this.#decode(old)))!==canonicalJson(stable(snapshot)))throw new Error('E2EE_MINDMAPS_HISTORY_REVIEW_REQUIRED');
  const remote=await this.#ports.legacyMindmaps(context);this.#ports.assertCurrent();exactKeys(remote,['protocol','ownerId','scopeId','migrationId','fence','sourceHash','legacyGeneration','checkpointHash','directoryRevision','maps','versions','receipts','deletions','legacyKey']);
  if(remote.protocol!==1||remote.ownerId!==this.#owner||remote.scopeId!==this.#scope||remote.migrationId!==context.migrationId||remote.fence!==context.fence||remote.sourceHash!==context.sourceHash)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  integer(remote.legacyGeneration);integer(remote.directoryRevision,1);decodeE2eeBytes(remote.checkpointHash,32).fill(0);
  if(remote.legacyGeneration!==snapshot.memory.generation||context.generation<=remote.legacyGeneration)throw new Error('E2EE_MINDMAPS_GENERATION_REVIEW_REQUIRED');
  for(const name of ['maps','versions','receipts','deletions'])list(remote[name]);if(encoder.encode(JSON.stringify(remote)).length>E2EE_MIGRATION_BYTE_BUDGET)throw new Error('E2EE_SOURCE_TOO_LARGE');
  const keys:CryptoKey[]=[],content:MigrationContent[]=[],localContent:MigrationContent[]=[];let complete=false,size=0;
  const groups=new Map<string,MindmapsMigrationVariant[]>(),history:Row[]=[],drafts:Row[]=[],views:Row[]=[],conversions:Row[]=[],editors:unknown[]=[],versions:Row[]=[];
  const add=(identity:string,variant:MindmapsMigrationVariant)=>{id(identity);const rows=groups.get(identity)??[];if(rows.some(row=>row.source===variant.source))invalid();rows.push(variant);groups.set(identity,rows);};
  const output=(placement:'remote'|'local',domain:'mindmap'|'attachment',objectId:string,value:unknown,metadata?:{filename:string;mediaType:string})=>{
   const bytes=value instanceof Uint8Array?new Uint8Array(value):encoder.encode(JSON.stringify(value));size+=bytes.length;
   if(bytes.length>64*1024*1024||size>E2EE_MIGRATION_BYTE_BUDGET||content.length+localContent.length>=10000){bytes.fill(0);throw new Error('E2EE_SOURCE_TOO_LARGE');}
   (placement==='remote'?content:localContent).push({domain,objectId,bytes,...metadata});
  };
  const open=async(row:Row,purpose:string)=>{
   const packet={iv:row.iv as string,ciphertext:row.ciphertext as string};let value:unknown;
   if(this.#ports.openLegacy)value=await this.#ports.openLegacy(packet,purpose);
   else{
    const iv=base64(packet.iv,12),cipher=base64(packet.ciphertext,16,2100000);let plain:Uint8Array|undefined;
    try{for(const key of keys)try{plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(iv),additionalData:encoder.encode(`genesis-mindmap-v1:${this.#owner}:${purpose}`)},key,new Uint8Array(cipher)));break;}catch{/* Only captured old keys. */}
     if(!plain)throw new Error(keys.length?'E2EE_LEGACY_MINDMAPS_CORRUPT':'E2EE_LEGACY_KEY_UNAVAILABLE');value=parseMindmapsMigrationJson(decoder.decode(plain));
    }finally{iv.fill(0);cipher.fill(0);plain?.fill(0);}
   }
   this.#ports.assertCurrent();return typeof value==='string'?parseMindmapsMigrationJson(value):value;
  };
  const images=new Map<string,{objectId:string;mediaType:string;size:number}>();
  const pack=(raw:Row)=>{
   const value=structuredClone(raw);for(const node of value.nodes as Row[]){const p=node.presentation as Row|undefined,image=p?.image as Row|undefined;if(!image)continue;
    text(image.data,350000);const match=/^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(image.data);if(!match)invalid();let reference=images.get(image.data);
    if(!reference){const bytes=base64(match[2],1,262500);try{reference={objectId:'personal-mindmap-image:'+crypto.randomUUID(),mediaType:'image/'+match[1],size:bytes.length};
      output('remote','attachment',reference.objectId,bytes,{filename:'embedded.'+match[1],mediaType:reference.mediaType});images.set(image.data,reference);
     }finally{bytes.fill(0);}}
    p!.image={alt:image.alt,fit:image.fit,dataRef:reference};
   }return value;
  };
  try{
   exactKeys(remote.legacyKey,['keyMode','key']);if(!['account','client','empty'].includes(String(remote.legacyKey.keyMode)))invalid();
   if(this.#ports.openLegacy){if(snapshot.memory.legacyKey!==''||remote.legacyKey.key!==null)throw new Error('E2EE_KEY_BRIDGE_FORBIDDEN');}
   else{
    if(remote.legacyKey.keyMode!=='account'&&remote.legacyKey.key!==null)invalid();
    for(const encoded of [...(snapshot.memory.legacyKey?[snapshot.memory.legacyKey]:[]),...(remote.legacyKey.keyMode==='account'?[remote.legacyKey.key]:[])]){const bytes=base64(encoded,32);try{keys.push(await crypto.subtle.importKey('raw',new Uint8Array(bytes),'AES-GCM',false,['decrypt']));}finally{bytes.fill(0);}}
   }
   const current=new Map<string,Row>(),deleted=new Map<string,Row>();
   for(const row of remote.deletions as unknown[]){exactKeys(row,['map_id','deleted_at']);id(row.map_id);time(row.deleted_at);if(deleted.has(row.map_id))invalid();deleted.set(row.map_id,row);add(row.map_id,{source:'server-deletion',document:null,revision:0,deleted:true});}
   const serverDocument=async(row:unknown,version=false)=>{
    exactKeys(row,version?['map_id','revision','schema_version','ciphertext','iv','updated_at']:['id','schema_version','revision','ciphertext','iv','updated_at']);
    const identity=version?row.map_id:row.id;id(identity);integer(row.revision,1);time(row.updated_at);envelope({id:identity,schemaVersion:row.schema_version,revision:row.revision,iv:row.iv,ciphertext:row.ciphertext,updatedAt:row.updated_at});
    const value=document(await open(row,'map:'+identity));if(value.id!==identity)invalid();return{identity,value,row};
   };
   for(const raw of remote.maps as unknown[]){const {identity,value,row}=await serverDocument(raw);if(current.has(identity)||deleted.has(identity))invalid();current.set(identity,row);add(identity,{source:'server',document:value,revision:row.revision as number,deleted:false});}
   const versionNames=new Set<string>();for(const raw of remote.versions as unknown[]){const {identity,value,row}=await serverDocument(raw,true),name=identity+':'+row.revision;
    const head=current.get(identity),headValue=groups.get(identity)?.find(variant=>variant.source==='server')?.document;
    if(head&&((row.revision as number)>(head.revision as number)||row.revision===head.revision&&canonicalJson(value)!==canonicalJson(headValue)))throw new Error('E2EE_MINDMAPS_HISTORY_REVIEW_REQUIRED');
    if(versionNames.has(name))invalid();versionNames.add(name);const objectId='personal-mindmap-version:'+crypto.randomUUID();
    output('remote','mindmap',objectId,{protocol:1,ownerId:this.#owner,id:identity,revision:row.revision,schemaVersion:row.schema_version,updatedAt:row.updated_at,document:pack(value)});
    versions.push({mapId:identity,revision:row.revision,schemaVersion:row.schema_version,updatedAt:row.updated_at,objectId});
   }
   const receipts:Row[]=[],receiptNames=new Set<string>();for(const row of remote.receipts as unknown[]){exactKeys(row,['map_id','operation_id','payload_hash','revision']);id(row.map_id);id(row.operation_id);integer(row.revision,1);
    if(typeof row.payload_hash!=='string'||!/^[a-f0-9]{64}$/.test(row.payload_hash)||receiptNames.has(row.map_id+':'+row.operation_id))invalid();receiptNames.add(row.map_id+':'+row.operation_id);receipts.push(row);
   }
   const values=new Map(snapshot.entries.map(row=>[row.key.slice(this.#prefix().length),row.value]));const rawCache=values.get('cache'),cache=rawCache===null?[]:parseMindmapsMigrationJson(rawCache);list(cache,10000);const cacheNames=new Set<string>();
   for(const row of cache){envelope(row);id(row.id);if(cacheNames.has(row.id))invalid();cacheNames.add(row.id);const value=document(await open(row,'map:'+row.id));if(value.id!==row.id)invalid();
    add(row.id,{source:'cache',document:value,revision:row.revision as number,deleted:false});history.push({source:'cache',document:value,revision:row.revision,updatedAt:row.updatedAt});
   }
   for(const [source,raw]of values)if(source!=='cache'){
    if(raw===null)invalid();const row=parseMindmapsMigrationJson(raw),parts=source.split(':');
    if(parts[0]==='draft'||parts[0]==='request'){envelope(row,true);const value=document(await open(row,'map:'+parts[2]),true);if(value.id!==parts[2])invalid();drafts.push({source,document:value,expectedRevision:row.expectedRevision,operationId:row.operationId,kind:parts[0]});}
    else{exactKeys(row,['iv','ciphertext']);base64(row.iv,12).fill(0);base64(row.ciphertext,16,2100000).fill(0);const value=await open(row,source);object(value);
     if(parts[0]==='view')views.push({source,mapId:parts[1],value});else{if(value.mapId!==parts[1]||value.nodeId!==parts[2])invalid();conversions.push({source,value,execution:'history-only'});}
    }
   }
   const memoryNames=new Set<string>();for(const row of snapshot.memory.records){allowed(row,['document','revision','updatedAt','pending','pendingDocument','dirty','draftKey','source']);const value=document(row.document,true);integer(row.revision);id(value.id);
    if(row.dirty!==undefined&&typeof row.dirty!=='boolean'||row.updatedAt!==undefined&&typeof row.updatedAt!=='string')invalid();
    const source='memory:'+String(row.source??row.draftKey??value.id);if(memoryNames.has(source))invalid();memoryNames.add(source);let pendingDocument:Row|null=null;
    if(row.pending!==undefined&&row.pending!==null&&typeof row.pending!=='boolean'){envelope(row.pending,true);if(row.pending.expectedRevision!==row.revision)invalid();pendingDocument=document(await open(row.pending,'map:'+value.id),true);if(pendingDocument.id!==value.id)invalid();}
    if(row.pendingDocument!==undefined&&row.pendingDocument!==null){const pending=document(row.pendingDocument,true);if(!pendingDocument||canonicalJson(pending)!==canonicalJson(pendingDocument))invalid();}
    const unsynced=row.revision===0||row.dirty===true||row.pending===true||pendingDocument!==null||row.draftKey!=null;
    if(row.draftKey!=null){text(row.draftKey,1024);if(!row.draftKey.endsWith(':'+value.id)||!row.draftKey.includes('draft:'))invalid();}
    if(unsynced)drafts.push({source,document:value,revision:row.revision,pendingDocument,kind:'memory'});
    else{document(value);add(value.id,{source,document:value,revision:row.revision as number,deleted:false});}
    history.push({source,document:value,revision:row.revision,pendingDocument,dirty:row.dirty??false,updatedAt:row.updatedAt??null});
   }
   const editorNames=new Set<string>();for(const row of snapshot.memory.editors){allowed(row,['source','document','revision','state']);text(row.source,1024);integer(row.revision);if(!row.source||editorNames.has(row.source))invalid();editorNames.add(row.source);editors.push({...row,document:row.document===null?null:document(row.document,true)});}
   for(const row of snapshot.memory.localWork){allowed(row,['source','kind','mapId','value']);text(row.source,1024);object(row.value);if(row.kind==='view'){id(row.mapId);views.push({source:row.source,mapId:row.mapId,value:row.value});}else if(row.kind==='conversion')conversions.push({source:row.source,value:row.value,execution:'history-only'});else invalid();}
   const conflicts:MindmapsMigrationConflict[]=[],selected=new Map<string,MindmapsMigrationVariant>();
   for(const [identity,variants]of groups){
    if(deleted.has(identity)){selected.set(identity,variants.find(row=>row.source==='server-deletion')!);continue;}
    const server=variants.find(row=>row.source==='server');
    if(!server){variants.push({source:'server-absence',document:null,revision:0,deleted:true});conflicts.push({id:identity,variants});continue;}
    const candidates=variants.filter(row=>row.revision>=server.revision);if(new Set(candidates.map(row=>canonicalJson(row.document))).size>1)conflicts.push({id:identity,variants});else selected.set(identity,server);
   }
   if(conflicts.length){if(!this.#ports.review)throw new Error('E2EE_MINDMAPS_CONFLICT_REVIEW_REQUIRED');const choices=await this.#ports.review(structuredClone(conflicts));this.#ports.assertCurrent();object(choices);
    if(Object.keys(choices).length!==conflicts.length||Object.keys(choices).some(identity=>!conflicts.some(row=>row.id===identity)))throw new Error('E2EE_MINDMAPS_CONFLICT_REVIEW_REQUIRED');
    for(const conflict of conflicts){const value=conflict.variants.find(row=>row.source===choices[conflict.id]);if(!value)throw new Error('E2EE_MINDMAPS_CONFLICT_REVIEW_REQUIRED');selected.set(conflict.id,value);}
   }
   const records:Row[]=[];for(const [identity,variants]of [...groups].sort(([a],[b])=>a.localeCompare(b))){const chosen=selected.get(identity);if(!chosen)invalid();const objectId='personal-mindmap-record:'+crypto.randomUUID();
    // A server tombstone or an explicit absence choice must not upload stale
    // cache plaintext again. Its full originals already remain device-local.
    const packed=(chosen.deleted?variants.filter(row=>row.deleted):variants).map(row=>({...row,document:row.document?pack(row.document):null})),winner=packed.find(row=>row.source===chosen.source);if(!winner)invalid();
    output('remote','mindmap',objectId,{protocol:1,ownerId:this.#owner,id:identity,selected:winner,variants:packed});records.push({id:identity,objectId,deleted:winner.deleted});
   }
   output('remote','mindmap','personal-mindmap-index-v1',{protocol:1,ownerId:this.#owner,records,versions});
   output('remote','mindmap','personal-mindmap-metadata-v1',{protocol:1,ownerId:this.#owner,receipts,deletions:[...deleted.values()],execution:'history-only'});
   output('local','mindmap','personal-mindmap-local-work-v1',{protocol:1,ownerId:this.#owner,history,drafts,views,conversions,editors,entries:snapshot.entries,execution:'history-only'});
   this.#ports.assertCurrent();complete=true;return{complete:true,content,localContent};
  }finally{if(!complete)[...content,...localContent].forEach(row=>row.bytes.fill(0));images.clear();}
 }
}

/** Cold current-generation reading. No old key, legacy endpoint, conversion or
 * upload replay. Missing device-only work/files is an error, never an empty map. */
export async function readMigratedMindmaps(readRemote:(domain:'mindmap',id:string)=>Promise<unknown>,
 readAttachment:(id:string)=>Promise<{bytes:Uint8Array;mediaType:string}|null>,readLocal:(domain:'mindmap',id:string)=>Promise<Uint8Array|null>,ownerId:string){
 const hydrate=async(raw:unknown)=>{
  object(raw);const value=structuredClone(raw);list(value.nodes,1000);
  for(const node of value.nodes){object(node);const p=node.presentation as Row|undefined,image=p?.image as Row|undefined;if(!image)continue;exactKeys(image,['alt','fit','dataRef']);
   exactKeys(image.dataRef,['objectId','mediaType','size']);const ref=image.dataRef;
   if(typeof ref.objectId!=='string'||!/^personal-mindmap-image:[a-f0-9-]{36}$/.test(ref.objectId)||!['image/png','image/jpeg','image/webp'].includes(String(ref.mediaType)))invalid();integer(ref.size,1);if(ref.size>262500)invalid();
   const file=await readAttachment(ref.objectId);if(!file)throw new Error('E2EE_MINDMAPS_ATTACHMENT_REQUIRED');
   try{if(file.bytes.length!==ref.size||file.mediaType!==ref.mediaType)invalid();let encoded='';for(let offset=0;offset<file.bytes.length;offset+=16384)encoded+=String.fromCharCode(...file.bytes.subarray(offset,offset+16384));
    p!.image={alt:image.alt,fit:image.fit,data:`data:${ref.mediaType};base64,${btoa(encoded)}`};
   }finally{file.bytes.fill(0);}
  }
  return document(value);
 };
 const index=await readRemote('mindmap','personal-mindmap-index-v1');exactKeys(index,['protocol','ownerId','records','versions']);if(index.protocol!==1||index.ownerId!==ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');list(index.records,10000);list(index.versions,10000);
 const records:{id:string;document:Row|null;revision:number;deleted:boolean}[]=[],versions:Row[]=[],names=new Set<string>();
 for(const entry of index.records){exactKeys(entry,['id','objectId','deleted']);id(entry.id);if(names.has(entry.id)||typeof entry.deleted!=='boolean'||typeof entry.objectId!=='string'||!/^personal-mindmap-record:[a-f0-9-]{36}$/.test(entry.objectId))invalid();names.add(entry.id);
  const row=await readRemote('mindmap',entry.objectId);exactKeys(row,['protocol','ownerId','id','selected','variants']);if(row.protocol!==1||row.ownerId!==ownerId||row.id!==entry.id)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');list(row.variants,10000);exactKeys(row.selected,['source','document','revision','deleted']);integer(row.selected.revision);text(row.selected.source,1024);
  if(row.selected.deleted!==entry.deleted||!row.variants.some(variant=>canonicalJson(variant)===canonicalJson(row.selected)))invalid();const value=entry.deleted?(row.selected.document===null?null:invalid()):await hydrate(row.selected.document);if(value&&value.id!==entry.id)invalid();records.push({id:entry.id,document:value,revision:row.selected.revision,deleted:entry.deleted});
 }
 const versionNames=new Set<string>();for(const entry of index.versions){exactKeys(entry,['mapId','revision','schemaVersion','updatedAt','objectId']);id(entry.mapId);integer(entry.revision,1);time(entry.updatedAt);
  if(entry.schemaVersion!==1&&entry.schemaVersion!==2)invalid();
  if(versionNames.has(entry.mapId+':'+entry.revision)||typeof entry.objectId!=='string'||!/^personal-mindmap-version:[a-f0-9-]{36}$/.test(entry.objectId))invalid();versionNames.add(entry.mapId+':'+entry.revision);
  const row=await readRemote('mindmap',entry.objectId);exactKeys(row,['protocol','ownerId','id','revision','schemaVersion','updatedAt','document']);
  if(row.protocol!==1||row.ownerId!==ownerId||row.id!==entry.mapId||row.revision!==entry.revision||row.schemaVersion!==entry.schemaVersion||row.updatedAt!==entry.updatedAt)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  const value=await hydrate(row.document);if(value.id!==entry.mapId)invalid();versions.push({...entry,document:value});
 }
 const bytes=await readLocal('mindmap','personal-mindmap-local-work-v1');if(!bytes)throw new Error('E2EE_MINDMAPS_LOCAL_CONTENT_REQUIRED');let local:unknown;
 try{local=parseLegacyMigrationJson(decoder.decode(bytes),'E2EE_MINDMAPS_SOURCE_INVALID',64*1024*1024);}finally{bytes.fill(0);}
 exactKeys(local,['protocol','ownerId','history','drafts','views','conversions','editors','entries','execution']);if(local.protocol!==1||local.ownerId!==ownerId||local.execution!=='history-only')throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 for(const name of ['history','drafts','views','conversions','editors','entries'])list(local[name],10000);
 return{records,versions,local};
}
