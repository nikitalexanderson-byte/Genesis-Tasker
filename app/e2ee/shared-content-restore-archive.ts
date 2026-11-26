import {validateContentArchivePayload,openContentArchiveValue,type ContentArchiveSection} from './content-archive.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {sharedFileReference} from './shared-file-values.ts';
import {validateSharedRestoreSource,type SharedRestoreSource} from './shared-content-restore.ts';
import type {SharedRecordBody} from './shared-domain.ts';

export async function sharedRestoreArchiveSource(ownerId:string,input:unknown,sectionIndex:number,entryIndex:number,versionId:string,current:()=>void){
 const payload=await validateContentArchivePayload(input);current();if(payload.ownerId!==ownerId)throw new Error('BACKUP_OWNER');if(!Number.isSafeInteger(sectionIndex)||!Number.isSafeInteger(entryIndex)||sectionIndex<0||entryIndex<0)throw new Error('E2EE_RESTORE_CONTENT_INVALID');
 const section=payload.sections[sectionIndex],entries=(section?.data as ContentArchiveSection|undefined)?.entries,entry=entries?.[entryIndex];if(section?.id!=='shared-drafts'||!entry?.scope||!['project','space'].includes(entry.scope.kind)||entry.domain==='attachment')throw new Error('E2EE_RESTORE_DOMAIN_REQUIRED');
 const versions=[entry.current,...entry.history].filter(row=>row.id===versionId);if(versions.length!==1)throw new Error('E2EE_RESTORE_CONTENT_INVALID');const opened=await openContentArchiveValue(versions[0],current);current();
 try{const raw=parseLegacyMigrationJson(new TextDecoder('utf-8',{fatal:true}).decode(opened.bytes),'E2EE_RESTORE_CONTENT_INVALID',64*1024*1024) as Record<string,unknown>;
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.deleted===true)throw new Error('E2EE_RESTORE_DOMAIN_REQUIRED');const values=Array.isArray(raw.records)?raw.records:[raw.body??raw],binding={scopeId:entry.scope.scopeId,kind:entry.scope.kind as 'project'|'space',resourceId:entry.scope.resourceId};
  const records=values as SharedRecordBody[],files:SharedRestoreSource['files']=[],ids=new Set<string>();for(const record of records)for(const table of ['shared_task_attachments','shared_task_images'])for(const child of record.related?.[table]??[]){const file=sharedFileReference(child);if(ids.has(file.objectId))continue;ids.add(file.objectId);
   const candidates=entries!.filter(item=>item.scope?.scopeId===binding.scopeId&&item.scope.kind===binding.kind&&item.scope.resourceId===binding.resourceId&&item.domain==='attachment'&&item.objectId===file.objectId);if(!candidates.length||candidates.some(item=>item.current.sha256!==candidates[0].current.sha256||item.current.size!==file.size||item.current.filename!==file.filename||item.current.mediaType!==file.mediaType))throw new Error('E2EE_RESTORE_FILE_REQUIRED');files.push({objectId:file.objectId,value:candidates[0].current});
  }
  return{backupId:payload.backupId,source:validateSharedRestoreSource({binding,records,files})};
 }finally{opened.bytes.fill(0);}
}
