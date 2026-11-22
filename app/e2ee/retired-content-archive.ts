import {BACKUP_MAX_PLAIN,type BackupPayload,type BackupModuleId} from '../backup-format.ts';
import {encodeE2eeBytes} from './envelope.ts';
import {E2eeEditorQueue} from './editor-queue.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import {contentArchiveDeviceId,contentArchiveModuleFor,validateContentArchivePayload,type ContentArchiveEntry,type ContentArchiveValue,type ContentArchiveSection} from './content-archive.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import type {UnlockedE2eeVault} from './storage.ts';
import type {openReadOnlyDeviceRetainedMigrationHistory} from './migration.ts';

/** Export only semantic editor/device values and catalogue-authenticated old
 * user content. Never export a protected key bundle or executable queue. */
export async function captureRetiredContentArchive(ownerId:string,vault:UnlockedE2eeVault,catalogue:Awaited<ReturnType<typeof openReadOnlyDeviceRetainedMigrationHistory>>,current:()=>void){
 const entries:ContentArchiveEntry[]=[];let used=0;const encoder=new TextEncoder();
 const value=async(id:string,bytes:Uint8Array,metadata={filename:'',mediaType:'application/json'}):Promise<ContentArchiveValue>=>{current();return{id,encoding:'base64url',bytes:encodeE2eeBytes(bytes),sha256:encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))),size:bytes.length,...metadata};};
 const append=(entry:ContentArchiveEntry)=>{used+=encoder.encode(JSON.stringify(entry)).length;if(used>BACKUP_MAX_PLAIN-65536||entries.length>=10000)throw new Error('BACKUP_TOO_LARGE');entries.push(entry);};
 for(const key of await vault.listLocal('draft','editor:')){
  current();const stateRow=await vault.read('draft',key);if(!stateRow)throw new Error('E2EE_BACKUP_CAPTURE_CHANGED');try{const state=parseLegacyMigrationJson(new TextDecoder('utf-8',{fatal:true}).decode(stateRow.value),'E2EE_CORRUPT_EDITOR',4*1024*1024) as {scopeId:string;domain:ContentArchiveEntry['domain'];objectId:string},scope=catalogue.scopes.find(scope=>scope.scopeId===state.scopeId);if(!scope)throw new Error('E2EE_BACKUP_SCOPE_UNLOCK_REQUIRED');const expected='editor:'+encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(`${state.scopeId}\0${state.domain}\0${state.objectId}`))));if(expected!==key)throw new Error('E2EE_CORRUPT_EDITOR');
   const queue=E2eeEditorQueue.readOnly(vault,state.scopeId,state.domain as Parameters<typeof E2eeEditorQueue.readOnly>[2],state.objectId),head=await queue.load();current();if(!head||head.serial!==stateRow.serial)throw new Error('E2EE_BACKUP_CAPTURE_CHANGED');let latest:ContentArchiveValue;try{latest=await value('current',head.bytes,head.metadata);}finally{head.bytes.fill(0);}
   const history:ContentArchiveValue[]=[],cursors=new Set<string>();let cursor:import('./editor-queue.ts').EditorHistoryCursor|undefined;do{const page=await queue.historyPage(cursor);current();for(const draft of page.drafts){if(used+history.reduce((sum,row)=>sum+row.bytes.length,0)+draft.size*4/3>BACKUP_MAX_PLAIN-65536)throw new Error('BACKUP_TOO_LARGE');const opened=await queue.openHistory(draft.id,cursor);try{history.push(await value(draft.id,opened.bytes,opened.metadata));}finally{opened.bytes.fill(0);}}if(!page.cursor)break;if(cursors.has(page.cursor.id))throw new Error('E2EE_EDITOR_HISTORY_CORRUPT');cursors.add(page.cursor.id);cursor=page.cursor;}while(true);
   const final=await vault.read('draft',key);try{if(!final||final.serial!==stateRow.serial||final.value.length!==stateRow.value.length||final.value.some((byte,at)=>byte!==stateRow.value[at]))throw new Error('E2EE_BACKUP_CAPTURE_CHANGED');}finally{final?.value.fill(0);}
   append({placement:'editor',scope:{scopeId:scope.scopeId,ownerId:scope.ownerId,kind:scope.kind,resourceId:scope.resourceId},domain:state.domain,objectId:state.objectId,pending:head.pending,current:latest,history});
  }finally{stateRow.value.fill(0);}
 }
 for(const id of(await vault.listLocal('draft','content')).filter(contentArchiveDeviceId))await addDevice(id);
 // Device journals have several declared prefixes; discover their exact roles
 // with the same allowlist used by the normal content archive, never raw keys.
 const prefixes=['personal-','shared-','product-','mindmap-','membership-','domain-content-restore:','external-google-copy:','imported-legacy-content:'];const seen=new Set(entries.filter(row=>row.placement==='device').map(row=>row.objectId));
 for(const prefix of prefixes)for(const id of await vault.listLocal('draft',prefix)){current();if(contentArchiveDeviceId(id)&&!seen.has(id)){seen.add(id);await addDevice(id);}}
 async function addDevice(id:string){const document=new E2eeDeviceDocument(null,id,input=>input,current,vault),before=await document.load();current();if(!before)throw new Error('E2EE_BACKUP_CAPTURE_CHANGED');const bytes=encoder.encode(JSON.stringify(before.value));try{const latest=await value('current',bytes),after=await document.load();if(after?.serial!==before.serial)throw new Error('E2EE_BACKUP_CAPTURE_CHANGED');append({placement:'device',scope:null,domain:'draft',objectId:id,pending:true,current:latest,history:[]});}finally{bytes.fill(0);}}
 for(const item of catalogue.contents){current();if(used+item.size*4/3+8192>BACKUP_MAX_PLAIN-65536)throw new Error('BACKUP_TOO_LARGE');const bytes=new Uint8Array(item.size);let offset=0;try{const metadata=await catalogue.readContent(item.id,async chunk=>{current();if(chunk.length>bytes.length-offset)throw new Error('BACKUP_INVALID');bytes.set(chunk,offset);offset+=chunk.length;});if(offset!==bytes.length)throw new Error('BACKUP_INVALID');const content=await value(item.id,bytes,metadata);if(content.sha256!==item.sha256)throw new Error('BACKUP_INVALID');append({placement:'remote',scope:item.scope,domain:item.domain,objectId:item.id,pending:true,current:content,history:[]});}finally{bytes.fill(0);}}
 await catalogue.assertUnchanged();current();const at=new Date().toISOString(),payload:BackupPayload={schema:1,backupId:crypto.randomUUID(),source:'device_snapshot',ownerId,createdAt:at,client:'web',billingEvidence:null,sections:[]};
 for(const id of ['workspace','mindmaps','diary','stoicheion','aurora','physis','shared-drafts'] as BackupModuleId[]){const rows=entries.filter(row=>contentArchiveModuleFor(row.domain,row.scope)===id);if(rows.length)payload.sections.push({id,source:'device',completeness:'partial',capturedAt:at,revision:null,count:rows.length,pending:rows.filter(row=>row.pending).length,notices:['CONTENT_ONLY_HISTORY_NOT_EXECUTABLE','RETIRED_DEVICE_LOCAL_CONTENT_ONLY'],data:{format:'genesis-content-only-v1',execution:'history-only',entries:rows} satisfies ContentArchiveSection});}
 const verified=await validateContentArchivePayload(payload);current();return verified;
}
