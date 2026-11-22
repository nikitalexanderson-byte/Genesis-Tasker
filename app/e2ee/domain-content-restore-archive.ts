import {validateContentArchivePayload,openContentArchiveValue,type ContentArchiveSection} from './content-archive.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {domainRestoreSourceFromJson,type RestoreDomain} from './domain-content-restore.ts';

export async function domainRestoreArchiveSource(ownerId:string,input:unknown,sectionIndex:number,entryIndex:number,versionId:string,current:()=>void){
 const payload=await validateContentArchivePayload(input);current();if(payload.ownerId!==ownerId)throw new Error('BACKUP_OWNER');
 if(!Number.isSafeInteger(sectionIndex)||!Number.isSafeInteger(entryIndex)||sectionIndex<0||entryIndex<0)throw new Error('E2EE_RESTORE_CONTENT_INVALID');
 const section=payload.sections[sectionIndex],entry=(section?.data as ContentArchiveSection|undefined)?.entries[entryIndex];
 if(!section||!entry||!['diary','mindmaps'].includes(section.id)&&entry.objectId!=='personal-diary-device-live-v1'||entry.scope&&(entry.scope.kind!=='personal'||entry.scope.ownerId!==ownerId))throw new Error('E2EE_RESTORE_DOMAIN_REQUIRED');
 const domain:RestoreDomain=section.id==='diary'||entry.objectId==='personal-diary-device-live-v1'?'diary':'mindmap';if(entry.domain!==domain&&!entry.objectId.startsWith('imported-legacy-content:')&&!(domain==='diary'&&entry.objectId==='personal-diary-device-live-v1'))throw new Error('E2EE_RESTORE_DOMAIN_REQUIRED');
 const versions=[entry.current,...entry.history].filter(row=>row.id===versionId);if(versions.length!==1)throw new Error('E2EE_RESTORE_CONTENT_INVALID');const opened=await openContentArchiveValue(versions[0],current);current();
 try{const value=parseLegacyMigrationJson(new TextDecoder('utf-8',{fatal:true}).decode(opened.bytes),'E2EE_RESTORE_CONTENT_INVALID',64*1024*1024);if(value&&typeof value==='object'&&Object.hasOwn(value,'ownerId')&&(value as {ownerId:unknown}).ownerId!==ownerId)throw new Error('BACKUP_OWNER');return{backupId:payload.backupId,source:domainRestoreSourceFromJson(domain,value)};}finally{opened.bytes.fill(0);}
}
