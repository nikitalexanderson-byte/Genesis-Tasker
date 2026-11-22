import {BACKUP_MAX_PLAIN,validateBackupPayload,type BackupPayload,type BackupModuleId} from '../backup-format.ts';
import {E2eeEditorQueue,type EditorHistoryCursor} from './editor-queue.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes,encodeE2eeBytes,type E2eeContext} from './envelope.ts';
import {openDeviceRetainedMigrationHistory} from './migration.ts';
import type {WebPrivateAccount} from './product-session.ts';

type ArchiveScope={scopeId:string;ownerId:string;kind:'personal'|'project'|'space';resourceId:string};
export type ContentArchiveValue={id:string;encoding:'base64url';bytes:string;sha256:string;size:number;filename:string;mediaType:string};
export type ContentArchiveEntry={placement:'editor'|'device'|'remote';scope:ArchiveScope|null;domain:string;objectId:string;pending:boolean;current:ContentArchiveValue;history:ContentArchiveValue[]};
export type ContentArchiveSection={format:'genesis-content-only-v1';execution:'history-only';entries:ContentArchiveEntry[]};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const domains=new Set(['workspace','mindmap','diary','dream-journal','physis','aurora','stoicheion','advice','attachment','shared-project','shared-comment','local-snapshot']);
const deviceContent=(id:string)=>id==='personal-diary-device-live-v1'||id==='personal-physis-editor-forms-v1'||['shared-transfer-private:','shared-bulk-private:','shared-bulk-recovery:','shared-bulk-recovery-history:','shared-request:','shared-work-private:','shared-work-history:','product-tx:','product-approval:','mindmap-view:','mindmap-conversions:','shared-map-draft:','shared-map-local:','shared-map-conversion-journal:','shared-resource-create:','shared-project-create:','shared-project-resolution:','membership-operation:','personal-content-restore:','domain-content-restore:','shared-content-restore:','external-google-copy:','imported-legacy-content:'].some(prefix=>id.startsWith(prefix));
const moduleFor=(domain:string,scope:ArchiveScope|null):BackupModuleId=>scope&&scope.kind!=='personal'||domain==='shared-project'||domain==='shared-comment'?'shared-drafts':domain==='mindmap'?'mindmaps':domain==='diary'?'diary':domain==='physis'?'physis':domain==='aurora'?'aurora':domain==='stoicheion'?'stoicheion':'workspace';
async function value(id:string,bytes:Uint8Array,metadata={filename:'',mediaType:'application/json'}):Promise<ContentArchiveValue>{
 return{id,encoding:'base64url',bytes:encodeE2eeBytes(bytes),sha256:encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))),size:bytes.length,...metadata};
}
/** Explicit file output is separate from restore: original bytes/metadata,
 * checked again at the selected version, with no command or authority replay. */
export async function openContentArchiveValue(input:ContentArchiveValue,current:()=>void){
 current();const row=structuredClone(input);exactKeys(row,['id','encoding','bytes','sha256','size','filename','mediaType']);assertTechnical(row.id);
 if(row.encoding!=='base64url'||!Number.isSafeInteger(row.size)||row.size<0||row.size>BACKUP_MAX_PLAIN||typeof row.filename!=='string'||row.filename.length>512||typeof row.mediaType!=='string'||row.mediaType.length>128)throw new Error('BACKUP_INVALID');
 const bytes=row.size===0&&row.bytes===''?new Uint8Array():decodeE2eeBytes(row.bytes,row.size);
 try{if(encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))!==row.sha256)throw new Error('BACKUP_INVALID');current();return{bytes,filename:row.filename,mediaType:row.mediaType};}
 catch(reason){bytes.fill(0);throw reason;}
}
/** Only semantic editor values and explicitly declared device-content cells
 * can enter this portable archive. Key bundles, directory pins, source-opening
 * material, enrollment/membership packets and service outboxes are excluded.
 * Imported entries have NO writer, session, grant or retry capability. */
export async function captureLocalContentArchive(account:WebPrivateAccount):Promise<BackupPayload>{
 account.requireOpen();const scopes=account.contentScopes(),entries:ContentArchiveEntry[]=[];let used=0;
 const append=(entry:ContentArchiveEntry)=>{used+=encoder.encode(JSON.stringify(entry)).length;if(used>BACKUP_MAX_PLAIN-65536||entries.length>=10000)throw new Error('BACKUP_TOO_LARGE');entries.push(entry);};
 const keys=await account.device.vault.listLocal('draft','editor:');account.requireOpen();
 for(const key of keys){
  const record=await account.device.vault.read('draft',key);account.requireOpen();if(!record)throw new Error('E2EE_BACKUP_CAPTURE_CHANGED');
  try{const state=parseLegacyMigrationJson(decoder.decode(record.value),'E2EE_CORRUPT_EDITOR',4*1024*1024) as Record<string,unknown>;
   if(typeof state.domain!=='string'||typeof state.scopeId!=='string'||typeof state.objectId!=='string')throw new Error('E2EE_CORRUPT_EDITOR');
   if(!domains.has(state.domain))continue;const scope=scopes.find(row=>row.scopeId===state.scopeId);if(!scope)throw new Error('E2EE_BACKUP_SCOPE_UNLOCK_REQUIRED');
   const expected='editor:'+encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(`${state.scopeId}\0${state.domain}\0${state.objectId}`))));account.requireOpen();if(expected!==key)throw new Error('E2EE_CORRUPT_EDITOR');
   const queue=new E2eeEditorQueue(account.device,scope.client,state.scopeId,state.domain as E2eeContext['domain'],state.objectId),head=await queue.load();account.requireOpen();if(!head||head.serial!==record.serial)throw new Error('E2EE_BACKUP_CAPTURE_CHANGED');
   let current:ContentArchiveValue;try{current=await value('current',head.bytes,head.metadata);}finally{head.bytes.fill(0);}
   const history:ContentArchiveValue[]=[],pages=new Set<string>(),ids=new Set<string>();let cursor:EditorHistoryCursor|undefined,historyUsage=encoder.encode(JSON.stringify(current)).length;
   for(let page=0;;page++){
    if(page>=10000)throw new Error('E2EE_EDITOR_HISTORY_CORRUPT');const result=await queue.historyPage(cursor);account.requireOpen();
    for(const draft of result.drafts){if(ids.has(draft.id))throw new Error('E2EE_EDITOR_HISTORY_CORRUPT');ids.add(draft.id);if(used+history.reduce((sum,row)=>sum+row.bytes.length,0)+draft.size*4/3>BACKUP_MAX_PLAIN-65536)throw new Error('BACKUP_TOO_LARGE');
     const row=await queue.openHistory(draft.id,cursor);account.requireOpen();try{const retained=await value(draft.id,row.bytes,row.metadata);historyUsage+=encoder.encode(JSON.stringify(retained)).length;if(used+historyUsage>BACKUP_MAX_PLAIN-65536)throw new Error('BACKUP_TOO_LARGE');history.push(retained);}finally{row.bytes.fill(0);}
    }
    if(!result.cursor)break;if(pages.has(result.cursor.id))throw new Error('E2EE_EDITOR_HISTORY_CORRUPT');pages.add(result.cursor.id);cursor=result.cursor;
   }
   const final=await account.device.vault.read('draft',key);account.requireOpen();try{if(!final||final.serial!==record.serial||final.value.length!==record.value.length||final.value.some((byte,index)=>byte!==record.value[index]))throw new Error('E2EE_BACKUP_CAPTURE_CHANGED');}finally{final?.value.fill(0);}
   const {client:_,...coordinates}=scope;append({placement:'editor',scope:coordinates,domain:state.domain,objectId:state.objectId,pending:head.pending,current,history});
  }finally{record.value.fill(0);}
 }
 const localKeys=await account.device.vault.listLocal('draft');account.requireOpen();
 for(const key of localKeys.filter(deviceContent)){
  const document=new E2eeDeviceDocument(account.device,key,input=>input,()=>account.requireOpen()),before=await document.load();account.requireOpen();if(!before)throw new Error('E2EE_BACKUP_CAPTURE_CHANGED');
  const bytes=encoder.encode(JSON.stringify(before.value));try{const content=await value('current',bytes);account.requireOpen();const after=await document.load();if(!after||after.serial!==before.serial)throw new Error('E2EE_BACKUP_CAPTURE_CHANGED');append({placement:'device',scope:null,domain:'draft',objectId:key,pending:true,current:content,history:[]});}finally{bytes.fill(0);}
 }
 // Prior cancelled/completed migration plans can contain values no longer in
 // a mounted editor. Include their authenticated user bytes as inert versions;
 // their original requests/capsules and partial encrypted suffixes stay local.
 const retained=await openDeviceRetainedMigrationHistory(account.device,()=>account.requireOpen());
 try{
  for(const item of retained.contents){
   account.requireOpen();if(used+item.size*4/3+8192>BACKUP_MAX_PLAIN-65536)throw new Error('BACKUP_TOO_LARGE');
   const bytes=new Uint8Array(item.size);let at=0;
   try{
    const metadata=await retained.readContent(item.id,async chunk=>{account.requireOpen();if(chunk.length>bytes.length-at)throw new Error('BACKUP_INVALID');bytes.set(chunk,at);at+=chunk.length;});account.requireOpen();
    if(at!==bytes.length)throw new Error('BACKUP_INVALID');const content=await value(item.id,bytes,metadata);account.requireOpen();
    if(content.sha256!==item.sha256)throw new Error('BACKUP_INVALID');
    append({placement:'remote',scope:{scopeId:item.scope.scopeId,ownerId:item.scope.ownerId,kind:item.scope.kind,resourceId:item.scope.resourceId},domain:item.domain,objectId:item.id,pending:true,current:content,history:[]});
   }finally{bytes.fill(0);}
  }
  await retained.assertUnchanged();account.requireOpen();
 }finally{retained.close();}
 const at=new Date().toISOString(),payload:BackupPayload={schema:1,backupId:crypto.randomUUID(),source:'device_snapshot',ownerId:account.ownerId,createdAt:at,client:'web',billingEvidence:null,sections:[]};
 for(const id of ['workspace','mindmaps','diary','stoicheion','aurora','physis','shared-drafts'] as BackupModuleId[]){const rows=entries.filter(row=>moduleFor(row.domain,row.scope)===id);if(!rows.length)continue;
  payload.sections.push({id,source:'device',completeness:'partial',capturedAt:at,revision:null,count:rows.length,pending:rows.filter(row=>row.pending).length,notices:['CONTENT_ONLY_HISTORY_NOT_EXECUTABLE','LOCAL_OPENED_CONTENT_ONLY'],data:{format:'genesis-content-only-v1',execution:'history-only',entries:rows} satisfies ContentArchiveSection});
 }
 const size=encoder.encode(JSON.stringify(payload)).length;if(size>BACKUP_MAX_PLAIN)throw new Error('BACKUP_TOO_LARGE');account.requireOpen();
 // A read-back verified local safety copy precedes the portable file operation.
 const safety=new E2eeDeviceDocument(account.device,`content-archive-safety:${payload.backupId}`,validateBackupPayload,()=>account.requireOpen());await safety.save(payload,null);account.requireOpen();const persisted=await safety.load();if(!persisted||JSON.stringify(persisted.value)!==JSON.stringify(payload))throw new Error('E2EE_BACKUP_UNVERIFIED');return payload;
}
export async function validateContentArchivePayload(input:unknown){
 const payload=validateBackupPayload(structuredClone(input));if(Object.hasOwn(payload,'serverEvidence'))throw new Error('BACKUP_INVALID');if(encoder.encode(JSON.stringify(payload)).length>BACKUP_MAX_PLAIN)throw new Error('BACKUP_TOO_LARGE');let total=0;const identities=new Set<string>();
 for(const section of payload.sections){exactKeys(section.data,['format','execution','entries']);const data=section.data;if(data.format!=='genesis-content-only-v1'||data.execution!=='history-only'||!Array.isArray(data.entries)||data.entries.length>10000)throw new Error('BACKUP_INVALID');
  for(const entry of data.entries){exactKeys(entry,['placement','scope','domain','objectId','pending','current','history']);assertTechnical(entry.objectId);
   if(!['editor','device','remote'].includes(String(entry.placement))||typeof entry.pending!=='boolean'||!Array.isArray(entry.history)||entry.history.length>10000)throw new Error('BACKUP_INVALID');
   if(entry.placement==='editor'||entry.placement==='remote'){exactKeys(entry.scope,['scopeId','ownerId','kind','resourceId']);for(const key of ['scopeId','ownerId','resourceId'])assertTechnical(entry.scope[key]);if(!['personal','project','space'].includes(String(entry.scope.kind))||!domains.has(String(entry.domain)))throw new Error('BACKUP_INVALID');}
   else if(entry.scope!==null||entry.domain!=='draft'||!deviceContent(String(entry.objectId)))throw new Error('BACKUP_INVALID');
   const identity=JSON.stringify([entry.placement,entry.scope,entry.domain,entry.objectId]);if(identities.has(identity))throw new Error('BACKUP_INVALID');identities.add(identity);
   const ids=new Set<string>();for(const record of [entry.current,...entry.history]){exactKeys(record,['id','encoding','bytes','sha256','size','filename','mediaType']);assertTechnical(record.id);if(ids.has(record.id)||record.encoding!=='base64url'||!Number.isSafeInteger(record.size)||Number(record.size)<0||Number(record.size)>BACKUP_MAX_PLAIN||typeof record.filename!=='string'||record.filename.length>512||typeof record.mediaType!=='string'||record.mediaType.length>128)throw new Error('BACKUP_INVALID');ids.add(record.id);
    const bytes=record.size===0&&record.bytes===''?new Uint8Array():decodeE2eeBytes(record.bytes,Number(record.size));try{total+=bytes.length;if(total>BACKUP_MAX_PLAIN||encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))!==record.sha256)throw new Error('BACKUP_INVALID');}finally{bytes.fill(0);}
   }
  }
 }return payload;
}
/** Import has one local-only effect: retain authenticated user content as
 * inert history. Restoring an editor must separately validate and create a new
 * normal content operation under CURRENT identity, rights and quotas. */
export async function retainImportedContentArchive(account:WebPrivateAccount,input:unknown){
 account.requireOpen();const payload=await validateContentArchivePayload(input);account.requireOpen();const id='content-archive-import:'+payload.backupId;
 const document=new E2eeDeviceDocument(account.device,id,validateBackupPayload,()=>account.requireOpen()),old=await document.load();account.requireOpen();
 if(old){if(JSON.stringify(old.value)!==JSON.stringify(payload))throw new Error('E2EE_IDEMPOTENCY_CONFLICT');return payload;}
 await document.save(payload,null);account.requireOpen();const saved=await document.load();if(!saved||JSON.stringify(saved.value)!==JSON.stringify(payload))throw new Error('E2EE_BACKUP_UNVERIFIED');return payload;
}
export async function retainedContentArchives(account:WebPrivateAccount){
 account.requireOpen();const ids=await account.device.vault.listLocal('draft','content-archive-import:');account.requireOpen();return ids.map(id=>id.slice('content-archive-import:'.length));
}
export async function openRetainedContentArchive(account:WebPrivateAccount,id:string){
 account.requireOpen();assertTechnical(id);const store=new E2eeDeviceDocument(account.device,`content-archive-import:${id}`,validateBackupPayload,()=>account.requireOpen()),row=await store.load();account.requireOpen();
 if(!row||row.value.backupId!==id)throw new Error('BACKUP_INVALID');const verified=await validateContentArchivePayload(row.value);account.requireOpen();return verified;
}
/** Older user archives remain readable, but their historical commands or
 * serverEvidence are never adopted as a live operation or authority. */
export async function contentOnlyBackupInput(input:unknown){
 const original=validateBackupPayload(structuredClone(input)),payload:BackupPayload={schema:1,backupId:original.backupId,source:original.source,ownerId:original.ownerId,createdAt:original.createdAt,client:original.client,billingEvidence:null,sections:[]};
 for(const section of original.sections){
  if(section.data&&typeof section.data==='object'&&'format'in section.data&&section.data.format==='genesis-content-only-v1'){payload.sections.push(structuredClone(section));continue;}
  if(section.completeness==='unavailable'||section.data===null){payload.sections.push({...structuredClone(section),data:{format:'genesis-content-only-v1',execution:'history-only',entries:[]}});continue;}
  const bytes=encoder.encode(JSON.stringify(section.data));try{const record=await value('current',bytes),entry:ContentArchiveEntry={placement:'device',scope:null,domain:'draft',objectId:`imported-legacy-content:${original.backupId}:${section.id}`,pending:false,current:record,history:[]};
   payload.sections.push({...structuredClone(section),notices:[...section.notices,'LEGACY_BACKUP_CONTENT_ONLY'],data:{format:'genesis-content-only-v1',execution:'history-only',entries:[entry]}});
  }finally{bytes.fill(0);}
 }
 return validateContentArchivePayload(payload);
}

/** Enumerate every active, explicitly trusted scope, then materialize complete
 * files (never their DEK-bearing manifests) and immutable historical objects.
 * Concurrent remote changes or a bounded-format overflow refuse the whole
 * export. No entry is silently truncated. Other devices' unsent edits cannot
 * be part of this snapshot. Imported copies remain inert content. */
export async function captureRemoteContentArchive(account:WebPrivateAccount):Promise<BackupPayload>{
 account.requireOpen();if(account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');
 const summaries=await account.scopeSummaries(),scopes=account.contentScopes();account.requireOpen();
 if(summaries.some(row=>row.state==='active'&&!scopes.some(open=>open.scopeId===row.scopeId))||scopes.some(open=>!summaries.some(row=>row.scopeId===open.scopeId&&row.kind===open.kind&&row.resourceId===open.resourceId)))throw new Error('E2EE_BACKUP_SCOPE_UNLOCK_REQUIRED');
 const payload=await captureLocalContentArchive(account),heads=new Map<string,string>();let used=encoder.encode(JSON.stringify(payload)).length;
 for(const scope of scopes){await scope.client.refresh();account.requireOpen();const catalogue=await scope.client.contentHeads();account.requireOpen();heads.set(scope.scopeId,catalogue.manifestHash);
  const {client,...coordinates}=scope;
  for(const row of catalogue.objects){
   // v1 reserves this exact namespace for per-file encrypted chunks. Their
   // bytes are authenticated through the containing manifest's full read.
   if(row.domain==='attachment'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}:\d{6}$/.test(row.objectId))continue;
   if(!domains.has(row.domain))throw new Error('E2EE_BACKUP_CONTENT_CLASSIFICATION_REQUIRED');
   const opened=await client.read(row.domain as E2eeContext['domain'],row.objectId);account.requireOpen();if(!opened)throw new Error('E2EE_BACKUP_CAPTURE_CHANGED');
   let current:ContentArchiveValue;try{if(opened.revision!==row.revision)throw new Error('E2EE_BACKUP_CAPTURE_CHANGED');current=await value('current',opened.bytes,{filename:opened.filename,mediaType:opened.mediaType});}finally{opened.bytes.fill(0);}
   await client.assertObjectReference(row.domain as E2eeContext['domain'],row.objectId,row.revision,row.payloadHash);account.requireOpen();
   const entry:ContentArchiveEntry={placement:'remote',scope:coordinates,domain:row.domain,objectId:row.objectId,pending:false,current,history:[]};
   used+=encoder.encode(JSON.stringify(entry)).length;if(used>BACKUP_MAX_PLAIN-65536)throw new Error('BACKUP_TOO_LARGE');
   const id=moduleFor(row.domain,coordinates);let section=payload.sections.find(section=>section.id===id);
   if(!section){section={id,source:'server',completeness:'available',capturedAt:payload.createdAt,revision:null,count:0,pending:0,notices:[],data:{format:'genesis-content-only-v1',execution:'history-only',entries:[]} satisfies ContentArchiveSection};payload.sections.push(section);}
   (section.data as ContentArchiveSection).entries.push(entry);section.count++;
  }
 }
 for(const scope of scopes){const after=await scope.client.contentHeads();account.requireOpen();if(after.manifestHash!==heads.get(scope.scopeId))throw new Error('E2EE_BACKUP_CAPTURE_CHANGED');}
 payload.backupId=crypto.randomUUID();payload.source='server_snapshot';for(const section of payload.sections){section.completeness='available';section.notices=['CONTENT_ONLY_HISTORY_NOT_EXECUTABLE','REMOTE_CURRENT_AND_THIS_DEVICE_HISTORY'];}
 const verified=await validateContentArchivePayload(payload);account.requireOpen();const store=new E2eeDeviceDocument(account.device,`content-archive-safety:${verified.backupId}`,validateBackupPayload,()=>account.requireOpen());await store.save(verified,null);account.requireOpen();
 if(JSON.stringify((await store.load())?.value)!==JSON.stringify(verified))throw new Error('E2EE_BACKUP_UNVERIFIED');return verified;
}
