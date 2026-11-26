import {validateContentArchivePayload,openContentArchiveValue,type ContentArchiveSection} from './content-archive.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {validatePrivatePersonalTasks} from './personal-product.ts';
import {personalRestoreWorkspace,validatePersonalRestoreSource,type PersonalRestoreSource} from './personal-content-restore.ts';
import {exactKeys} from './keys.ts';
type Row=Record<string,unknown>;
const object=(input:unknown):Row=>{if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('E2EE_RESTORE_CONTENT_INVALID');return input as Row;};
/** A selected authenticated archive version becomes semantic input only.
 * No original packet, revision, account grant or key is adopted. */
export async function personalRestoreArchiveSource(ownerId:string,payloadInput:unknown,sectionIndex:number,entryIndex:number,versionId:string,current:()=>void){
 const payload=await validateContentArchivePayload(payloadInput);current();if(payload.ownerId!==ownerId)throw new Error('BACKUP_OWNER');
 if(!Number.isSafeInteger(sectionIndex)||!Number.isSafeInteger(entryIndex)||sectionIndex<0||entryIndex<0)throw new Error('E2EE_RESTORE_CONTENT_INVALID');const section=payload.sections[sectionIndex],entry=(section?.data as ContentArchiveSection|undefined)?.entries[entryIndex];
 if(!section||!entry||entry.scope&&entry.scope.kind!=='personal'||entry.scope&&entry.scope.ownerId!==ownerId||section.id!=='workspace'||entry.domain!=='workspace'&&!entry.objectId.startsWith('imported-legacy-content:'))throw new Error('E2EE_RESTORE_DOMAIN_REQUIRED');
 const matches=[entry.current,...entry.history].filter(row=>row.id===versionId);if(matches.length!==1)throw new Error('E2EE_RESTORE_CONTENT_INVALID');const opened=await openContentArchiveValue(matches[0],current);current();
 try{let value=object(parseLegacyMigrationJson(new TextDecoder('utf-8',{fatal:true}).decode(opened.bytes),'E2EE_RESTORE_CONTENT_INVALID',64*1024*1024));
  if(Object.hasOwn(value,'ownerId')&&value.ownerId!==ownerId)throw new Error('BACKUP_OWNER');let source:PersonalRestoreSource;
  if(value.protocol===1&&Object.hasOwn(value,'contentRevision')){exactKeys(value,['protocol','ownerId','contentRevision','workspace','tasks']);const tasks=validatePrivatePersonalTasks(value.tasks,ownerId);source={workspace:object(value.workspace),tasks:tasks.tasks.filter(row=>!row.deleted).map(row=>row.value!)};}
  else if(value.protocol===1&&value.externalCopy==='requires-new-consent'){const tasks=validatePrivatePersonalTasks(value,ownerId);source={workspace:null,tasks:tasks.tasks.filter(row=>!row.deleted).map(row=>row.value!)};}
  else{if(Object.hasOwn(value,'document'))value=object(value.document);const tasks=value.tasks,copy={...value};delete copy.tasks;source={workspace:personalRestoreWorkspace(copy),tasks:tasks===undefined?null:tasks as Row[]};}
  return{backupId:payload.backupId,source:validatePersonalRestoreSource(source)};
 }finally{opened.bytes.fill(0);}
}
